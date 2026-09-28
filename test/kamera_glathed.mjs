/* Kundekrigen — kameraet: glathed, vejrtrækning, reduceret bevægelse, allokering.
 *
 *   node test/kamera_glathed.mjs
 *   node --expose-gc test/kamera_glathed.mjs     (også allokeringstesten)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavOpsaetning, lavFigur, koer } from './kamera_hjaelp.mjs';
import { koerForloeb } from './kamera_forloeb.mjs';
import { AANDE_X, AANDE_Y, AANDE_ZOOM, REDUCERET_RYST } from '../static/js/render/camera.js';

// Grænserne er målt på forløbet (docs/kamera.md) med lidt luft: hurtigste
// glidning 3,35 udsnitsbredder/s, største acceleration 34 bredder/s², og
// zoomen højst 2,96/s i log (introens oversigt). De er uafhængige af hz.
const MAKS_FART = 4.0;          // udsnitsbredder pr. sekund
const MAKS_ACC = 50;            // udsnitsbredder pr. sekund²: ingen ryk
const MAKS_ZOOMFART = 3.5;      // log-zoom pr. sekund

test('glathed: begrænset ændring pr. frame gennem en hel tur — 30, 60 og 144 Hz', () => {
  for (const hz of [30, 60, 144]) {
    const { proever: s } = koerForloeb(hz);
    let maksV = 0, maksA = 0, maksZ = 0, maksVist = 0;
    for (let i = 2; i < s.length; i++) {
      const q = s[i], f = s[i - 1], ff = s[i - 2];
      maksV = Math.max(maksV, Math.hypot(q.x - f.x, q.y - f.y) / f.b * hz);
      maksA = Math.max(maksA, Math.hypot(q.x - 2 * f.x + ff.x, q.y - 2 * f.y + ff.y) / f.b * hz * hz);
      maksZ = Math.max(maksZ, Math.abs(Math.log(q.zoom / f.zoom)) * hz);
      maksVist = Math.max(maksVist, Math.abs(Math.log(q.vist / f.vist)) * hz);
    }
    assert.ok(maksV <= MAKS_FART, `${hz} Hz: fart ${maksV.toFixed(2)} bredder/s`);
    assert.ok(maksA <= MAKS_ACC, `${hz} Hz: acceleration ${maksA.toFixed(1)} bredder/s²`);
    assert.ok(maksZ <= MAKS_ZOOMFART, `${hz} Hz: zoom ${maksZ.toFixed(2)}/s`);
    assert.ok(maksVist <= MAKS_ZOOMFART, `${hz} Hz: vist zoom (med punch) ${maksVist.toFixed(2)}/s`);
    // Ingen NaN og ingen uendeligheder nogen steder.
    assert.ok(s.every((q) => Number.isFinite(q.px) && Number.isFinite(q.py) && Number.isFinite(q.vist)));
  }
});

test('glathed: samme forløb ser ens ud ved 30, 60 og 144 Hz', () => {
  const a = koerForloeb(60).proever, b = koerForloeb(144).proever, c = koerForloeb(30).proever;
  // Sammenlign på tid: kameraet skal ikke afhænge af billedfrekvensen. En
  // hændelse (nedslaget, holdets slut) lander på en hel frame, så ved 30 Hz
  // kan den komme op til én frame senere: sammenlign inden for ±1/30 s.
  const naermest = (spor, q, felt) => {
    let bedst = Infinity;
    for (const r of spor) if (Math.abs(r.tid - q.tid) <= 1 / 30 + 1e-9) bedst = Math.min(bedst, Math.abs(r[felt] - q[felt]));
    return bedst;
  };
  for (const tid of [5, 9, 12, 14.5, 16, 21, 25]) {
    for (const [spor, navn] of [[b, '144'], [c, '30']]) {
      const q = spor.find((x) => x.tid >= tid);
      const dx = naermest(a, q, 'x') / q.b;
      const dz = Math.min(...a.filter((r) => Math.abs(r.tid - q.tid) <= 1 / 30 + 1e-9).map((r) => Math.abs(Math.log(r.zoom / q.zoom))));
      assert.ok(dx < 0.03, `${navn} Hz mod 60 Hz, x ved ${tid} s: ${(dx * 100).toFixed(1)} % af bredden`);
      assert.ok(dz < 0.03, `${navn} Hz mod 60 Hz, zoom ved ${tid} s: ${(dz * 100).toFixed(1)} %`);
    }
  }
});

test('ro: en næsten umærkelig vejrtrækning — aldrig helt stille, aldrig i vejen', () => {
  const ops = lavOpsaetning();
  const f = lavFigur(1, 1500, 640);
  ops.kam.snap(f.x, f.y + 40); ops.kam.fokus(f);
  koer(ops, 4);
  const s = koer(ops, 12);
  const xs = s.map((q) => q.px), ys = s.map((q) => q.py), zs = s.map((q) => q.vist);
  const spaend = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(spaend(xs) > 2 && spaend(xs) <= 2 * AANDE_X + 0.5, `vandret ${spaend(xs).toFixed(2)} wu`);
  assert.ok(spaend(ys) > 1 && spaend(ys) <= 2 * AANDE_Y + 0.5, `lodret ${spaend(ys).toFixed(2)} wu`);
  const zMid = zs.reduce((a, b) => a + b, 0) / zs.length;
  assert.ok(spaend(zs) / zMid > 0.004 && spaend(zs) / zMid <= 2 * AANDE_ZOOM + 0.001, `zoom ±${(spaend(zs) / zMid * 50).toFixed(2)} %`);
  // Mens der lades op, holder den vejret.
  ops.kam.saetSigte('vinkel+kraft', 0.5, f.id);
  koer(ops, 3);
  const s2 = koer(ops, 3);
  assert.ok(spaend(s2.map((q) => q.px - q.x)) < 0.3, 'ingen vejrtrækning under opladning');
});

test('prefers-reduced-motion: ingen vejrtrækning og mindre rystelser', () => {
  const stille = lavOpsaetning({ kamOpt: { reduceret: true } });
  const f = lavFigur(1, 1500, 640);
  stille.kam.snap(f.x, f.y + 40); stille.kam.fokus(f);
  koer(stille, 4);
  const s = koer(stille, 10);
  const spaend = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(spaend(s.map((q) => q.px)) < 0.01 && spaend(s.map((q) => q.py)) < 0.01, 'står helt stille');
  assert.ok(spaend(s.map((q) => q.vist)) < 1e-6, 'zoomen står stille');

  const maksRyst = (reduceret) => {
    const ops = lavOpsaetning({ kamOpt: { reduceret: true } });
    const g = lavFigur(1, 1500, 640);
    ops.kam.snap(g.x, g.y + 40); ops.kam.fokus(g);
    koer(ops, 4);
    ops.kam.saetReduceret(reduceret);
    ops.kam.rystelse(1, 0);
    return Math.max(...koer(ops, 1).map((q) => Math.hypot(q.px - q.x, q.py - q.y)));
  };
  const fuld = maksRyst(false), lille = maksRyst(true);
  assert.ok(fuld > 3, `en fuld rystelse kan ses (${fuld.toFixed(1)} wu)`);
  assert.ok(lille <= fuld * REDUCERET_RYST * 1.05, `reduceret: ${lille.toFixed(2)} ≤ ${(fuld * REDUCERET_RYST).toFixed(2)} wu`);
});

test('ingen ekstra allokeringer pr. frame (kræver --expose-gc)', { skip: typeof globalThis.gc !== 'function' }, () => {
  const { ops } = koerForloeb(60);
  const { kam } = ops;
  const f = lavFigur(1, 1500, 640);
  const p = { id: 9, x: 1500, y: 900, vx: 800, vy: 100 };
  const liste = [p, { id: 10, x: 1600, y: 950, vx: 700, vy: 50 }];
  kam.fokus(f);
  kam.saetSigte('vinkel+kraft', 0.5, f.id);
  const koerN = (n) => {
    for (let i = 0; i < n; i++) {
      p.x = 1500 + (i % 600); p.y = 900 + (i % 300);
      if (i % 2) kam.foelgSkud(p, liste); else kam.slipSkud();
      kam.saetMarkoer(i % 7 === 0, 1800 + (i % 50), 700);
      kam.opdater(1 / 60);
    }
  };
  koerN(20000);                              // varm op (JIT)
  globalThis.gc(); globalThis.gc();
  const foer = process.memoryUsage().heapUsed;
  koerN(200000);
  globalThis.gc(); globalThis.gc();
  const efter = process.memoryUsage().heapUsed;
  assert.ok(efter - foer < 256 * 1024, `heap voksede ${(efter - foer) / 1024 | 0} KB over 200.000 frames`);
});
