/* Kundekrigen — test: de fire nye våben (story 002).
 *
 *   node --test test/vaaben_nye.mjs
 *
 * Hvert våben køres i den hovedløse simulation to gange med samme frø og
 * samme input: forløbet (aftryk, rng, kunder, projektiler, ild) skal være
 * bit for bit ens. Derudover én grundlæggende opførsel pr. våben.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aktivVerden, koer } from './farer_hjaelp.mjs';
import { VAABEN } from '../static/js/sim/weapons.js';
import { K } from '../static/js/sim/world.js';

const LOFT = 1500;                       // tick efter affyring

/** Giv den aktive kunde våbnet, kør forberedelsen, affyr og kør til næste
 *  tur starter (eller loftet). Returnerer spor og hændelser. */
function forloeb(id, { forbered = () => {}, undervejs = null, kraft = 0.6 } = {}) {
  const v = aktivVerden({ froe: 21, bane: 'aaben' });
  const b = v.aktivBaever();
  v.hold[b.hold].ammo[id] = 1;
  v.udfoerKommando({ k: 'handling', h: 'vaelgVaaben', id }, b.ejer);
  forbered(v, b);
  v.udfoerKommando({ k: 'handling', h: 'affyr', kraft }, b.ejer);
  const start = { x: b.x, y: b.y };
  const spor = [];
  const h = koer(v, LOFT, {
    hvert: (vv) => {
      undervejs?.(vv, b);
      spor.push(JSON.stringify([vv.tick, vv.rngSim.tilstand(), vv.aftryk(), vv.tur.tilstand,
        vv.baevere.map((x) => [x.x, x.y, x.hp]), vv.projektiler.map((p) => [p.id, p.x, p.y]),
        vv.ild.map((p) => [p.id, p.x, p.y])]));
    },
    stop: (vv, hh) => hh.some((e) => e.navn === 'turStart'),
  });
  return { v, b, start, spor, h };
}

function deterministisk(id, o) {
  const a = forloeb(id, o), b = forloeb(id, o);
  assert.equal(a.spor.length, b.spor.length, `${id}: lige mange tick`);
  for (let i = 0; i < a.spor.length; i++) assert.equal(a.spor[i], b.spor[i], `${id}: tick ${i}`);
  assert.equal(a.v.hold[a.b.hold].ammo[id], 0, `${id}: ammunitionen er brugt`);
  return a;
}

test('Frugtordningen: deterministisk, springer i fem bananer, der går af', () => {
  const r = deterministisk('frugtordning', { forbered: (v, b) => { b.vinkel = 0.8; } });
  const delt = r.h.find((e) => e.navn === 'klyngeDelt');
  assert.ok(delt, 'kurven delte sig');
  assert.equal(delt.antal, VAABEN.frugtordning.klynge.antal);
  const brag = r.h.filter((e) => e.navn === 'eksplosion' && e.tick > delt.tick);
  assert.ok(brag.length >= VAABEN.frugtordning.klynge.antal, `bananerne gik af (${brag.length} brag)`);
});

/** Markøren på den nærmeste fjende (som T i spillet). */
function markerFjende(v, b) {
  const fj = v.baevere.filter((x) => !x.doed && x.hold !== b.hold)
    .sort((p, q) => Math.abs(p.x - b.x) - Math.abs(q.x - b.x))[0];
  v.udfoerKommando({ k: 'handling', h: 'markoer', x: fj.x, y: fj.y + 20, retning: fj.x > b.x ? 1 : -1 }, b.ejer);
  return fj;
}

test('Kaffeulykken: deterministisk, tænder ild i den fælles ild ved målet', () => {
  let fj = null;
  const pletter = new Map();
  const r = deterministisk('kaffeulykke', {
    forbered: (v, b) => { fj = markerFjende(v, b); },
    undervejs: (v) => { for (const p of v.ild) pletter.set(p.id, p); },
  });
  const ild = [...pletter.values()];
  assert.ok(ild.length >= 3, `der kom ild (${ild.length} pletter)`);
  const naermest = Math.min(...ild.map((p) => Math.abs(p.x - fj.x)));
  assert.ok(naermest < 100, `ilden er ved målet (${naermest | 0} wu fra)`);
  assert.ok(ild.every((p) => p.kildeHold === r.b.hold), 'ilden er skyttens (kæden)');
});

test('Mødeindkaldelsen: deterministisk, og den søgende ender tættere på målet end et ustyret skud', () => {
  let fj = null;
  const forbered = (v, b) => { fj = markerFjende(v, b); b.retning = fj.x > b.x ? 1 : -1; b.vinkel = 0.7; };
  const brag = (r) => r.h.find((e) => e.navn === 'eksplosion');
  const styret = deterministisk('moedeindkaldelse', { forbered, kraft: 0.5 });
  const ustyret = forloeb('moedeindkaldelse', { forbered, kraft: 0.5,
    undervejs: (v) => { for (const p of v.projektiler) p.soeg = null; } });
  const a = brag(styret), u = brag(ustyret);
  assert.ok(a && u, 'begge skud gik af');
  const d = (e) => Math.hypot(e.x - fj.x, e.y - (fj.y + 20));
  assert.ok(d(a) < d(u), `styret ${d(a) | 0} wu fra målet, ustyret ${d(u) | 0} wu`);
  assert.ok(d(a) < 80, `styret ramte ved målet (${d(a) | 0} wu)`);
});

test('Turbostolen: deterministisk, flytter kunden og afslutter turen ved landing', () => {
  let n = 0, retning = 1;
  const r = deterministisk('turbostol', {
    forbered: (v, b) => { n = 0; retning = b.x < v.terraen.w / 2 ? 1 : -1; },
    // Et sekund gas opad, så et sekund til siden, så slip.
    undervejs: (v, b) => {
      n++;
      const tast = n < 60 ? K.SIGT_OP : n < 120 ? (K.SIGT_OP | (retning > 0 ? K.HOEJRE : K.VENSTRE)) : 0;
      v.udfoerKommando({ k: 'hold', b: tast }, b.ejer);
    },
  });
  assert.ok(r.h.some((e) => e.navn === 'redskabStart' && e.slags === 'turbo'), 'stolen startede');
  const slut = r.h.find((e) => e.navn === 'redskabSlut' && e.slags === 'turbo');
  assert.ok(slut, 'flyvningen sluttede');
  assert.ok(Math.abs(r.b.x - r.start.x) > 60, `kunden fløj ${Math.abs(r.b.x - r.start.x) | 0} wu`);
  assert.ok(r.h.some((e) => e.navn === 'turStart' && e.tick > slut.tick), 'og turen gik videre');
});
