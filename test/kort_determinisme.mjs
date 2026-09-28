/* Kundekrigen — test: banerne er deterministiske.
 *
 *   - samme frø giver præcis den samme maske, pynt og fortplan
 *   - værtens vej (Worker: lavVerden + startKamp) og gæstens vej (lavVerden
 *     fra 'start'-beskeden, og genskab fra et snapshot over netværket, også
 *     fra en forkert, gammel bane) giver den samme bane — også efter kratere
 *   - et snapshot pr. turskift bygger ikke banen om igen, heller ikke når
 *     genererSpilbar måtte prøve et afledt frø (froeBrugt !== froe)
 *
 *   node --no-warnings test/kort_determinisme.mjs
 */
import { genererSpilbar, BANE_TYPER } from '../static/js/sim/terrain_gen.js';
import { lavVerden } from '../static/js/sim/world.js';
import { tjek, overskrift, testFroe, lavHold, maskeHash } from './kort_hjaelp.mjs';

const ens = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const LAYOUT = { antalHold: 2, prHold: 2 };

overskrift('Determinisme: samme frø, samme bane');
for (const type of BANE_TYPER) {
  let alle = true, pyntEns = true, fortEns = true;
  for (let i = 0; i < 6; i++) {
    const froe = testFroe(100 + i);
    const a = genererSpilbar(froe, type, 4, type === 'fort' ? LAYOUT : null);
    const b = genererSpilbar(froe, type, 4, type === 'fort' ? LAYOUT : null);
    if (!ens(a.terraen.maske, b.terraen.maske) || a.froe !== b.froe) alle = false;
    if (JSON.stringify(a.terraen.pynt) !== JSON.stringify(b.terraen.pynt)) pyntEns = false;
    if (type === 'fort' && JSON.stringify(a.terraen.fort) !== JSON.stringify(b.terraen.fort)) fortEns = false;
  }
  tjek(`${type}: masken er ens for samme frø (6 frø)`, alle);
  tjek(`${type}: pynten er ens`, pyntEns);
  if (type === 'fort') tjek('fort: fortplanen (pladser, udstyr, rum) er ens', fortEns);
}

overskrift('Værtens og gæstens vej giver den samme bane');
const cfgFor = (type) => ({ turTicks: 45 * 60, kampTicks: 1800 * 60, vind: true, vejr: 'auto', banetype: type });
for (const type of BANE_TYPER) {
  for (const [antalHold, prHold] of type === 'fort' ? [[2, 2], [3, 2], [4, 1]] : [[2, 2]]) {
    const froe = testFroe(200 + antalHold * 10 + prHold);
    const hold = lavHold(antalHold, prHold);
    // Værten (Workeren) og værtens spejl på hovedtråden.
    const vaert = lavVerden({ froe, banetype: type, hold, cfg: cfgFor(type) });
    const spejl = lavVerden({ froe, banetype: type, hold, cfg: cfgFor(type) });
    vaert.startKamp();
    tjek(`${type} ${antalHold}x${prHold}: værtens spejl bygger den samme bane`, ens(vaert.terraen.maske, spejl.terraen.maske));
    // Kratere, så snapshottet har ops at afspille.
    const w = vaert.terraen.w;
    for (let k = 0; k < 6; k++) vaert.terraen.carve(Math.round(w * (0.1 + 0.13 * k)), 500 + 40 * k, 36 + k * 4);
    const snap = JSON.parse(JSON.stringify(vaert.oejebliksbillede()));
    // Gæsten starter fra en helt anden bane (gammel kamp) og får snapshottet.
    const gaest = lavVerden({ froe: froe ^ 0x5a5a5a5a, banetype: type === 'fort' ? 'hule' : 'fort', hold, cfg: cfgFor(type) });
    gaest.genskab(snap);
    tjek(`${type} ${antalHold}x${prHold}: gæsten (genskab fra snapshot) har den samme maske`, ens(vaert.terraen.maske, gaest.terraen.maske),
      `aftryk ${vaert.terraen.aftryk()} / ${gaest.terraen.aftryk()}`);
    tjek(`${type} ${antalHold}x${prHold}: kunderne står det samme sted`, JSON.stringify(vaert.baevere.map((b) => [b.x, b.y])) === JSON.stringify(gaest.baevere.map((b) => [b.x, b.y])));
    // Næste turskift: et nyt snapshot må ikke bygge banen om.
    const foer = gaest.terraen;
    vaert.terraen.carve(Math.round(w * 0.5), 600, 40);
    gaest.genskab(JSON.parse(JSON.stringify(vaert.oejebliksbillede())));
    tjek(`${type} ${antalHold}x${prHold}: næste snapshot bygger ikke banen om`, gaest.terraen === foer && ens(vaert.terraen.maske, gaest.terraen.maske));
  }
}

overskrift('Et afledt frø (nyt forsøg i genererSpilbar) bygges heller ikke om');
{
  // Find en naturbane, hvor første forsøg blev afvist.
  let fundet = null;
  for (let i = 0; i < 200 && !fundet; i++) {
    for (const type of ['hule', 'oeer', 'aaben']) {
      const froe = testFroe(1000 + i);
      const r = genererSpilbar(froe, type, 4);
      if (r.froe !== froe) { fundet = { froe, type }; break; }
    }
  }
  if (tjek('der findes et frø, hvor genererSpilbar prøvede igen', !!fundet, fundet ? `${fundet.type} ${fundet.froe}` : '')) {
    const hold = lavHold(2, 2);
    const vaert = lavVerden({ froe: fundet.froe, banetype: fundet.type, hold, cfg: cfgFor(fundet.type) });
    vaert.startKamp();
    const gaest = lavVerden({ froe: fundet.froe, banetype: fundet.type, hold, cfg: cfgFor(fundet.type) });
    const foer = gaest.terraen;
    gaest.genskab(JSON.parse(JSON.stringify(vaert.oejebliksbillede())));
    tjek('gæsten beholder sin bane ved snapshottet (ingen ombygning ved hvert turskift)', gaest.terraen === foer);
    tjek('og den er den samme som værtens', maskeHash(gaest.terraen) === maskeHash(vaert.terraen) && vaert.froeBrugt !== vaert.froe);
  }
}
