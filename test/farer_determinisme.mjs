/* Kundekrigen — test: farerne er deterministiske, og uden farer er
 * simulationen den gamle.
 *
 *   node --no-warnings --test test/farer_determinisme.mjs
 *
 * 1. Samme frø og input giver samme aftryk tick for tick i 20 000 tick —
 *    med mindst 3 farer og mindst én brand i kampene.
 * 2. Med cfg.farer: [] er sporet (aftryk og rngSim hvert 120. tick) bit for
 *    bit referencesporet, der blev optaget før farerne (test/farer_lav_spor.mjs,
 *    test/farer_fra_spor.json). Gendan det med den kommando, når
 *    banegeneratoren med vilje ændrer kampene.
 * 3. Værten og spejlet: et spejl, der kun får snapshots og deltaer (som
 *    hovedtråden og gæsterne), har de samme farer, den samme ild og det samme
 *    varsel som værten — også en sen deltager, der kommer midt i en brand.
 * 4. sim/farer.js bruger hverken Math.random, Date, performance, document
 *    eller window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lavVerden } from '../static/js/sim/world.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';
import { skriptetKamp, lavHold, FA, BANER, antaend } from './farer_hjaelp.mjs';
import { SPOR_FIL, SPOR_KAMPE, koerSporKamp } from './farer_lav_spor.mjs';

/** Farerne tættere i testen: pausen kortes ned til 15 s aktiv tid (ens i begge kørsler). */
const hurtig = (v) => { const P = v.farePlan; if (P.naeste != null && P.naeste - P.aktiv > 900) P.naeste = P.aktiv + 900; };

/** Botten rammer ikke altid: den første Kabelsalat, der ruller i en spillers
 *  tur, sættes i brand, som scanneren ville (ens i begge kørsler). */
function tvingBrand(v) {
  if (v._tvungetBrand) return;
  const ks = v.farer.find((f) => f.slags === 'kabelsalat' && !f.antaendt && f.tilst === 'jord' && !f.ramt);
  if (ks && v.tur.tilstand === 'spiller_aktiv' && v.tur.tilstandTick > 200) { antaend(v, ks); v._tvungetBrand = true; }
}

const KAMPE = [
  { froe: 9, bane: 'aaben' }, { froe: 5, bane: 'oeer' }, { froe: 14, bane: 'hule' }, { froe: 9, bane: 'fort' },
];

test('samme frø og input giver samme aftryk tick for tick, med farer og brande', () => {
  let farer = 0, brande = 0, ild = 0;
  for (const k of KAMPE) {
    const spor = [[], []];
    const res = [0, 1].map((i) => skriptetKamp({ ...k, ticks: 20000, foerTick: hurtig,
      efter: (v) => { tvingBrand(v); if (v.tick % 50 === 0) spor[i].push(v.aftryk()); } }));
    assert.equal(res[0].tick, res[1].tick, `${k.bane}/${k.froe}`);
    assert.equal(res[0].aftryk, res[1].aftryk, `${k.bane}/${k.froe}: aftrykket afviger til sidst`);
    const i = spor[0].findIndex((a, j) => a !== spor[1][j]);
    assert.equal(i, -1, `${k.bane}/${k.froe}: afviger fra tick ${i * 50}`);
    assert.ok(res[0].farer >= 3, `${k.bane}/${k.froe}: kun ${res[0].farer} farer`);
    farer += res[0].farer; brande += res[0].braende; ild += res[0].ild;
  }
  assert.ok(farer >= 12 && brande >= 2 && ild >= 2, `farer ${farer}, brande ${brande}, ild ${ild}`);
});

test('uden farer (cfg.farer: []) er sporet bit for bit det gamle', () => {
  const ref = JSON.parse(readFileSync(SPOR_FIL, 'utf8'));
  for (const k of SPOR_KAMPE) {
    const navn = `${k.bane}/${k.froe}`;
    const nu = koerSporKamp(k, { farer: [] });
    const gl = ref.kampe[navn];
    assert.ok(gl, `${navn} mangler i referencesporet`);
    const i = nu.findIndex((r, j) => !gl[j] || r[0] !== gl[j][0] || r[1] !== gl[j][1] || r[2] !== gl[j][2]);
    assert.equal(i, -1, `${navn}: afviger fra prøve ${i} (tick ${nu[i]?.[0]}) — node test/farer_lav_spor.mjs --tjek`);
    assert.equal(nu.length, gl.length, `${navn}: ${nu.length} prøver mod ${gl.length}`);
  }
});

test('uden farer trækkes der aldrig til dem, og der kommer ingen', () => {
  for (const bane of BANER) {
    const k = skriptetKamp({ froe: 4, bane, ticks: 20000, cfg: { farer: [] } });
    assert.equal(k.farer + k.varsler + k.ild, 0, bane);
    assert.equal(k.v.farePlan.naeste, null, `${bane}: planlæggeren trak en pause`);
  }
});

/** Sammenlign spejlets farer, ild og varsel med værtens. */
function sammenlign(vaert, spejl, navn) {
  assert.equal(spejl.farer.length, vaert.farer.length, `${navn}: ${spejl.farer.length} farer mod ${vaert.farer.length}`);
  vaert.farer.forEach((f, i) => {
    const g = spejl.farer[i];
    assert.ok(g.id === f.id && g.slags === f.slags && g.hud === f.hud && g.tilst === f.tilst && g.ret === f.ret,
      `${navn}: fare ${f.id} (${g.slags}/${g.tilst} mod ${f.slags}/${f.tilst})`);
    assert.ok(Math.abs(g.x - f.x) <= 1 / 16 && Math.abs(g.y - f.y) <= 1 / 16, `${navn}: fare ${f.id} står et andet sted`);
    assert.equal(g.brand > 0, f.brand > 0, `${navn}: branden`);
    assert.equal(!!g.pakke, !!f.pakke, `${navn}: pakken`);
  });
  assert.deepEqual(spejl.ild.map((p) => [p.id, p.x | 0, p.y | 0]), vaert.ild.map((p) => [p.id, p.x | 0, p.y | 0]), `${navn}: ilden`);
  const a = vaert.farePlan.varsel, b = spejl.farePlan.varsel;
  assert.equal(!!b, !!a, `${navn}: varslet (${!!b} mod ${!!a})`);
  if (a) assert.ok(a.slags === b.slags && a.rest === b.rest && a.ret === b.ret, `${navn}: varslet`);
}

test('værten og spejlet: snapshots og deltaer giver de samme farer, den samme ild og det samme varsel', () => {
  for (const k of [KAMPE[0], KAMPE[2]]) {
    const opsaet = { froe: k.froe, banetype: k.bane, hold: lavHold(3, 3),
                     cfg: { banetype: k.bane, turTicks: 1500, kampTicks: 43200 } };
    let spejl = null, sen = null, farerSet = 0, ildSet = 0, varsler = 0, tomEfter = 0, senSet = 0;
    const net = (x) => JSON.parse(JSON.stringify(x));
    let tvunget = 0;
    skriptetKamp({ ...k, ticks: 20000, foerTick: hurtig, efter: (v, h) => {
      if (!spejl) { spejl = lavVerden(opsaet); spejl.genskab(net(v.oejebliksbillede())); }
      // Botten rammer ikke altid: de to første Kabelsalater, der ruller i en
      // spillers tur, sættes i brand, som scanneren ville — så der er en brand
      // og ild at sende, uanset hvordan kampen går.
      const ks = v.farer.find((f) => f.slags === 'kabelsalat' && !f.antaendt && f.tilst === 'jord' && !f.ramt);
      if (ks && tvunget < 2 && v.tur.tilstand === 'spiller_aktiv' && v.tur.tilstandTick > 200) { antaend(v, ks); tvunget++; }
      // Værten sender et snapshot ved hver tur (worker.js) og deltaer hvert tick.
      if (h.some((e) => e.navn === 'turStart')) spejl.genskab(net(v.oejebliksbillede()));
      anvendDelta(spejl, net(v.delta()));
      sammenlign(v, spejl, `${k.bane}/${k.froe} tick ${v.tick}`);
      if (v.farer.length) farerSet++;
      if (v.ild.length) ildSet++;
      if (v.farePlan.varsel) varsler++;
      // En sen deltager (snap_bed) midt i det hele: et snapshot, så deltaer.
      if (!sen && (v.ild.length || v.farer.some((f) => f.brand > 0))) {
        senSet++;
        sen = lavVerden(opsaet);
        sen.genskab(net(v.oejebliksbillede()));
      } else if (sen) {
        anvendDelta(sen, net(v.delta()));
        sammenlign(v, sen, `sen ${k.bane}/${k.froe} tick ${v.tick}`);
      }
      if (!v.farer.length && spejl.farer.length === 0 && farerSet) tomEfter++;
    } });
    assert.ok(farerSet > 100 && varsler > 100, `${k.bane}: farer i ${farerSet} tick, varsel i ${varsler}`);
    assert.ok(tomEfter > 0, `${k.bane}: den sidste fare forsvandt aldrig på spejlet`);
    assert.ok(ildSet > 0 && senSet === 1, `${k.bane}: ild i ${ildSet} tick, sen deltager ${senSet}`);
  }
});

test('sim/farer.js er hovedløs og deterministisk', () => {
  const k = readFileSync(fileURLToPath(new URL('../static/js/sim/farer.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbudt of ['Math.random', 'Date', 'performance', 'document', 'window', 'globalThis']) {
    assert.ok(!k.includes(forbudt), `farer.js bruger ${forbudt}`);
  }
  // Ingen iteration over Map eller Set, der kan påvirke resultatet (entities.js).
  assert.ok(!/for\s*\(\s*const\s+\[[^\]]+\]\s+of\s+(?!RING|nye)/.test(k), 'iteration over en Map');
});
