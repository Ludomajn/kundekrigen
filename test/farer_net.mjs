/* Kundekrigen — test: farerne over nettet.
 *
 *   node --no-warnings --test test/farer_net.mjs
 *
 * 1. Hver hændelse, farerne melder (sim/farer.js, tvungenRo i turn.js og
 *    printerSprang i world.js), står i VIDERESEND (sim/worker.js) — ellers når
 *    den aldrig hovedtråden og gæsterne.
 * 2. Hændelserne er ren data (de går gennem postMessage og JSON).
 * 3. Gæster ser verden ~80 ms bagud (net/client.js). En scanning mod dronens
 *    og Kabelsalatens position forskudt 20 wu rammer stadig (FARE_STRAALE_TOL);
 *    uden tolerancen misser den forskudte stråle. Tolerancen gælder kun, når
 *    strålen ingen kunde rammer: en Kabelsalat eller støvsuger lige bag en
 *    fjende tager ikke et rent træf fra den.
 * 4. Et spejl, der kun får hver tredje delta (20 Hz) og et snapshot ved hvert
 *    turskift, har altid værtens farer, ild og varsel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lavVerden } from '../static/js/sim/world.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';
import { mundingsPunkt } from '../static/js/sim/behaviours.js';
import { afstandTilHitbox } from '../static/js/sim/entities.js';
import { aktivVerden, FA, T, koer, affyr, sigtPaa, skriptetKamp, hurtigeFarer, lavHold, BANER, jordVed,
         kabelsalatPaaJorden, fladPlads } from './farer_hjaelp.mjs';

const kilde = (sti) => readFileSync(fileURLToPath(new URL(sti, import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const net = (x) => JSON.parse(JSON.stringify(x));

test('hver farehændelse står i VIDERESEND', () => {
  const w = kilde('../static/js/sim/worker.js');
  const blok = w.match(/const VIDERESEND = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(blok, 'VIDERESEND ikke fundet');
  const videre = new Set([...blok[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const meldte = new Set();
  for (const m of kilde('../static/js/sim/farer.js').matchAll(/push\(\{\s*navn:\s*'([^']+)'/g)) meldte.add(m[1]);
  assert.ok(meldte.size >= 9, `kun ${[...meldte]}`);
  // tvungenRo fjerner brændende og styrtende farer; lunten melder printerSprang.
  assert.match(kilde('../static/js/sim/turn.js'), /navn:\s*'fareVaek'/);
  meldte.add('fareVaek'); meldte.add('printerSprang'); meldte.add('eksplosion'); meldte.add('skade');
  for (const navn of meldte) assert.ok(videre.has(navn), `${navn} står ikke i VIDERESEND`);
});

test('farehændelserne er ren data', () => {
  const navne = new Set();
  let n = 0;
  for (const bane of ['aaben', 'hule']) {
    skriptetKamp({ froe: 5, bane, hold: [3, 3], ticks: 20000, foerTick: hurtigeFarer, efter: (v, h) => {
      for (const e of h) {
        if (!/^(fare|ild)/.test(e.navn) && !(e.navn === 'eksplosion' && e.kaedeId !== undefined)) continue;
        assert.deepEqual(net(e), e, `${e.navn} er ikke ren data`);
        navne.add(e.navn); n++;
      }
    } });
  }
  assert.ok(n > 20 && navne.has('fareVarsel') && navne.has('fareKommer') && navne.has('fareVaek'), `${n}: ${[...navne]}`);
});

/** Stråle fra kunden b's munding mod (x, y). */
function straaleMod(b, x, y) {
  sigtPaa(b, x, y);
  const m = mundingsPunkt(b);
  return { m, dx: m.dx, dy: m.dy };
}

test('scanneren rammer en fare, som gæsten ser 20 wu bagud — uden tolerancen misser den', () => {
  const v = aktivVerden({ froe: 9, bane: 'aaben', hold: [2, 1] });
  const b = v.aktivBaever();
  const d = FA.tving(v, 'drone', { side: 'v', pakke: 'koglebombe' }, [], { x: b.x + 90, y: b.y + 240, hoejdeMaal: b.y + 240 });
  const cy = d.y + d.hy;
  let medTol = 0, udenTol = 0;
  for (const bag of [0, 10, 20]) {
    const { m, dx, dy } = straaleMod(b, d.x - d.ret * bag, cy);
    if (FA.foersteFare(v, m, dx, dy, 1100).fare === d) medTol++;
  }
  assert.equal(medTol, 3, 'en scanning 20 wu bagud missede');
  // 30 wu bagud: kun tolerancen gør forskellen (dronens r er 20).
  const s = straaleMod(b, d.x - d.ret * 30, cy);
  assert.equal(FA.foersteFare(v, s.m, s.dx, s.dy, 1100).fare, d, 'med tolerancen');
  if (!FA.foersteFare(v, s.m, s.dx, s.dy, 1100, null, 0).fare) udenTol++;
  assert.equal(udenTol, 1, 'uden tolerancen ramte den forskudte stråle alligevel');

  // Hele vejen gennem kommandoen: gæsten sigter på dronen, som den så ud for 5 tick siden.
  const spor = [];
  for (let i = 0; i < 5; i++) { spor.push([d.x, d.y]); koer(v, 1); }
  const [sx, sy] = spor[0];
  assert.ok(Math.abs(d.x - sx) > 8, 'dronen flyttede sig ikke');
  sigtPaa(b, sx, sy + d.hy);
  affyr(v, 'splintboesse', { vinkel: b.vinkel, retning: b.retning });
  const alle = koer(v, 3);
  assert.ok(alle.some((e) => e.navn === 'fareLeveret' && e.id === d.id), 'LEVERET! udeblev for gæsten');
});

test('Kabelsalaten: en scanning 20 wu bagud antænder den stadig', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vind = 0.6;
  const b = v.aktivBaever();
  const p = fladPlads(v, 120) || { x: b.x + 200, y: b.y };
  const f = kabelsalatPaaJorden(v, b.x + 160, b.y);
  koer(v, 40);                          // den ruller op i fart
  assert.ok(Math.abs(f.vx) > 20, `vx ${f.vx}`);
  sigtPaa(b, f.x - f.ret * 20, f.y + f.hy);
  affyr(v, 'splintboesse', { vinkel: b.vinkel, retning: b.retning });
  const alle = koer(v, 3);
  assert.ok(alle.some((e) => e.navn === 'fareAntaendt' && e.id === f.id && e.aarsag === 'straale'),
    `ikke antændt (${p.x})`);
});

/** Hvor langt strålen går, før den rammer kundens træfzone (som
 *  behaviours.foersteKunde: trin på 3 wu), eller Infinity. */
function tilKunde(maal, m, dx, dy, maks = 1100) {
  for (let s = 0; s < maks; s += 3) if (afstandTilHitbox(maal, m.x + dx * s, m.y + dy * s) <= 0.5) return s;
  return Infinity;
}

test('tolerancen stjæler ikke et rent træf: en fare lige bag fjenden', () => {
  // Scanneren: en fjende 200 wu væk, en stille Kabelsalat 8 wu bag den.
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vind = 0;
  v.placerede.length = 0; v.kasser.length = 0;       // banens miner og kasser af vejen
  const b = v.aktivBaever();
  const fj = v.baevere.find((q) => q.hold !== b.hold && !q.doed);
  fj.x = b.x + 200; fj.y = jordVed(v, fj.x, b.y) + 1; fj.paaJorden = true; fj.vx = 0; fj.vy = 0;
  const f = kabelsalatPaaJorden(v, fj.x + 8, fj.y, { stille: true, vx: 0 });
  const { m, dx, dy } = straaleMod(b, fj.x, fj.y + 23);        // på brystet
  assert.ok(!v.terraen.straale(m.x, m.y, dx, dy, tilKunde(fj, m, dx, dy), 2), 'intet frit syn');
  // Forudsætningen: den brede træfcirkel begynder før fjendens træfzone.
  const tol = FA.foersteFare(v, m, dx, dy, 1100);
  assert.ok(tol.fare === f && tol.d < tilKunde(fj, m, dx, dy), `tolerancen når ikke faren først (${tol.d})`);
  const hp0 = fj.hp;
  affyr(v, 'splintboesse', { vinkel: b.vinkel, retning: b.retning });
  const alle = koer(v, 3);
  const st = alle.find((e) => e.navn === 'straale');
  assert.ok(st && st.baever === fj.id && st.skade === 34 && st.fare == null, JSON.stringify(st));
  assert.equal(fj.hp, hp0 - 34, 'fjenden tog ikke skaden');
  assert.ok(!alle.some((e) => e.navn === 'fareAntaendt') && !f.antaendt, 'Kabelsalaten blev antændt');

  // Tvangsopdateringen: en fjende 100 wu væk, en støvsuger (på pause) 8 wu bag den.
  const w = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  w.placerede.length = 0; w.kasser.length = 0;
  const b2 = w.aktivBaever();
  const fj2 = w.baevere.find((q) => q.hold !== b2.hold && !q.doed);
  fj2.x = b2.x + 100; fj2.y = jordVed(w, fj2.x, b2.y) + 1; fj2.paaJorden = true; fj2.vx = 0; fj2.vy = 0;
  const s = FA.tving(w, 'stoevsuger', { x: fj2.x + 8, y: fj2.y, ret: 1 }, [], { pause: 1000 });
  const r2 = straaleMod(b2, fj2.x, fj2.y + 23);
  const tol2 = FA.foersteFare(w, r2.m, r2.dx, r2.dy, 150, 'stoevsuger');
  assert.ok(tol2.fare === s && tol2.d < tilKunde(fj2, r2.m, r2.dx, r2.dy, 150), `tolerancen når ikke støvsugeren først (${tol2.d})`);
  affyr(w, 'daemningsdynamit', { vinkel: b2.vinkel, retning: b2.retning });
  const alle2 = koer(w, 3);
  assert.ok(alle2.some((e) => e.navn === 'opdateringRamt' && e.baever === fj2.id), 'fjenden blev ikke tvangsopdateret');
  assert.ok(!alle2.some((e) => e.navn === 'fareOpdateres'), 'støvsugeren tog træffet');
  assert.equal(fj2.springOver, 1);
});

test('et spejl med hver tredje delta (20 Hz) har altid værtens farer, ild og varsel', () => {
  let farer = 0, ild = 0, varsel = 0;
  for (const bane of BANER) {
    const opsaet = { froe: 8, banetype: bane, hold: lavHold(3, 3), cfg: { banetype: bane, turTicks: 1500, kampTicks: 43200 } };
    let spejl = null, n = 0;
    skriptetKamp({ froe: 8, bane, hold: [3, 3], ticks: 20000, foerTick: hurtigeFarer, efter: (v, h) => {
      if (!spejl) { spejl = lavVerden(net(opsaet)); spejl.genskab(net(v.oejebliksbillede())); }
      if (h.some((e) => e.navn === 'turStart')) spejl.genskab(net(v.oejebliksbillede()));
      if (++n % 3) return;
      anvendDelta(spejl, net(v.delta()));
      assert.deepEqual(spejl.farer.map((f) => [f.id, f.slags, f.hud, f.tilst]), v.farer.map((f) => [f.id, f.slags, f.hud, f.tilst]),
        `${bane} tick ${v.tick}: farerne`);
      for (const f of v.farer) {
        const g = spejl.farer.find((x) => x.id === f.id);
        assert.ok(Math.abs(g.x - f.x) <= 1 / 16 && Math.abs(g.y - f.y) <= 1 / 16, `${bane} tick ${v.tick}: positionen`);
      }
      assert.deepEqual(spejl.ild.map((p) => p.id), v.ild.map((p) => p.id), `${bane} tick ${v.tick}: ilden`);
      assert.equal(!!spejl.farePlan.varsel, !!v.farePlan.varsel, `${bane} tick ${v.tick}: varslet`);
      if (v.farer.length) farer++;
      if (v.ild.length) ild++;
      if (v.farePlan.varsel) varsel++;
    } });
  }
  assert.ok(farer > 300 && varsel > 100, `farer ${farer}, ild ${ild}, varsel ${varsel}`);
});

test('deltaens farer og ild er små: 40 pletter og en fare under 1,2 kB', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'solskin';
  const p = fladPlads(v, 200);
  // Over hele banen, på jorden under hver celle (søgt oppefra).
  for (let i = 0; i < 80; i++) { const x = p.x - 900 + i * 24; FA.taendIld(v, x, jordVed(v, x, p.y, 300), 0, null, []); }
  FA.tving(v, 'drone', { side: 'v' });
  koer(v, 1);
  const d = v.delta();
  const str = JSON.stringify({ fa: d.fa, il: d.il, fv: d.h.fv });
  assert.ok(v.ild.length > 20, `${v.ild.length} pletter`);
  assert.ok(str.length < 1200, `${str.length} bytes for ${v.ild.length} pletter`);
  assert.equal(T.SPILLER_AKTIV, v.tur.tilstand);
});
