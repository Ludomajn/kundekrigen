/* Kundekrigen — test: banerne er forskellige fra frø til frø.
 *
 * For hver type bygges 50 baner. Forskellen måles som Jaccard-afstanden
 * mellem banernes silhuetter (fast stof over vandet i celler på 64 wu; for
 * grotten hulrummene, for den er mest klippe): 0 = ens, 1 = intet til
 * fælles. Ingen to baner må være ens, og de fleste skal være tydeligt
 * forskellige. Arketyperne (og fortets siluetter og landskaber) skal alle
 * forekomme, og ingen må fylde det hele.
 *
 * Selve borgene måles for sig (fortets siluet og landskab tæller ikke): 100
 * frø med 2 x 2, murværket i celler på 24 wu rettet ind efter facaden og
 * stueetagens gulv, og Jaccard-afstanden mellem to borge med SAMME siluet.
 * Ellers kan to kampe, der trækker samme siluet, få næsten samme borg med
 * rummene, trapperne og keepen samme sted.
 *
 *   node --no-warnings test/kort_variation.mjs
 */
import { genererSpilbar, BANE_TYPER } from '../static/js/sim/terrain_gen.js';
import { SKEMAER } from '../static/js/sim/baneregler.js';
import { tjek, overskrift, testFroe, silhuet, afstand, percentil, maskeHash, borgSilhuet } from './kort_hjaelp.mjs';

const N = 50;
const KRAV = {                    // [mindste afstand, median] — målt: se docs/baner.md
  fort: [0.15, 0.5], aaben: [0.1, 0.4], hule: [0.08, 0.45], oeer: [0.1, 0.5],
};

for (const type of BANE_TYPER) {
  overskrift(`Variation: ${type} (${N} frø)`);
  const s = [], hash = new Set(), tael = {}, tael2 = {};
  for (let i = 0; i < N; i++) {
    const t = genererSpilbar(testFroe(i), type, 4, type === 'fort' ? { antalHold: 2, prHold: 2 } : null).terraen;
    s.push(silhuet(t, 64, type === 'hule'));
    hash.add(maskeHash(t));
    if (type === 'fort') {
      tael[t.fort.siluet] = (tael[t.fort.siluet] || 0) + 1;
      tael2[t.fort.landskab.navn] = (tael2[t.fort.landskab.navn] || 0) + 1;
    } else tael[t.arketype] = (tael[t.arketype] || 0) + 1;
  }
  const d = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) d.push(afstand(s[i], s[j]));
  const [kMin, kMed] = KRAV[type];
  tjek(`ingen to af de ${N} baner er ens`, hash.size === N, `${hash.size} forskellige`);
  tjek(`mindste afstand mellem to baner >= ${kMin}`, percentil(d, 0) >= kMin, `min ${percentil(d, 0).toFixed(3)}, 5 % ${percentil(d, 0.05).toFixed(3)}`);
  tjek(`median-afstand >= ${kMed}`, percentil(d, 0.5) >= kMed, `median ${percentil(d, 0.5).toFixed(3)}`);
  const fordel = (flertal, ental, t, alle) => {
    const txt = Object.entries(t).map(([k, v]) => `${k} ${v}`).join(', ');
    tjek(`alle ${flertal} forekommer`, alle.every(([k]) => t[k] > 0), txt);
    tjek(`${ental} fylder over 60 %`, Object.values(t).every((v) => v <= N * 0.6));
  };
  if (type === 'fort') {
    fordel('siluetter', 'ingen siluet', tael, SKEMAER.fort.siluetter);
    fordel('landskaber', 'intet landskab', tael2, SKEMAER.fort.landskaber);
  } else fordel('arketyper', 'ingen arketype', tael, SKEMAER[type].arketyper);
}

// ---------------------------------------------------------------- selve borgene

{
  const NB = 100;
  const BORG_KRAV = { median: 0.35, under: 0.25, andel: 0.15 };   // målt: se docs/baner.md
  overskrift(`Variation: selve borgene inden for én siluet (${NB} frø, 2 x 2)`);
  const borge = [];
  for (let i = 0; i < NB; i++) {
    const t = genererSpilbar(testFroe(i), 'fort', 4, { antalHold: 2, prHold: 2 }).terraen;
    borge.push({ sil: t.fort.siluet, b: borgSilhuet(t) });
  }
  const prSil = {};
  for (let i = 0; i < NB; i++) for (let j = i + 1; j < NB; j++) {
    if (borge[i].sil === borge[j].sil) (prSil[borge[i].sil] ||= []).push(afstand(borge[i].b, borge[j].b));
  }
  for (const [sil] of SKEMAER.fort.siluetter) {
    const d = prSil[sil] || [];
    const med = d.length ? percentil(d, 0.5) : 0, andel = d.length ? d.filter((x) => x < BORG_KRAV.under).length / d.length : 1;
    tjek(`${sil}: median >= ${BORG_KRAV.median} og højst ${BORG_KRAV.andel * 100} % af parrene under ${BORG_KRAV.under}`,
      d.length >= 10 && med >= BORG_KRAV.median && andel <= BORG_KRAV.andel,
      `${d.length} par, median ${med.toFixed(3)}, under ${BORG_KRAV.under}: ${(100 * andel).toFixed(0)} %, min ${d.length ? percentil(d, 0).toFixed(3) : '-'}`);
  }
}
