/* Kundekrigen — test: tururet venter på vejledningen (simulationen).
 *
 *   node --no-warnings --test test/vejledning_sim.mjs
 *
 * Kommandoen 'vejledning' {aktiv} (sim/commands.js) lader tururet vente,
 * mens vejledningen står i spillerens egen tur — højst VEJLEDNING_LOFT tick
 * pr. kundeejer pr. kamp (sim/turn.js). En rigtig verden (sim/world.js):
 *
 * 1. valider: kun den, der ejer den aktive kunde, og kun med aktiv som boolean.
 * 2. Uret: kvoten bruges før arsenalets pause (PANEL_PAUSE_LOFT).
 * 3. Kvoten hører til kundens ejer og gælder hele kampen; flaget nulstilles pr. tur.
 * 4. aktiv:false starter uret igen, og deltaen melder intet.
 * 5. Replikering: snapshot → genskab → anvendDelta, og snapshottet er en kopi.
 * 6. Determinisme: en skriptet kamp med og uden vejledningens pause giver
 *    samme tilstand i hvert tick, bortset fra uret — og rngSim kaldes lige
 *    mange gange i hvert tick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavVerden, T, K } from '../static/js/sim/world.js';
import { valider } from '../static/js/sim/commands.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';
import { VEJLEDNING_LOFT, PANEL_PAUSE_LOFT } from '../static/js/sim/turn.js';

const CFG = { turTicks: 30 * 60, kampTicks: 600 * 60, vind: true, vejr: 'auto', banetype: 'aaben' };

/** To klinikker med hver sin ejer (som over nettet: ejer = spillerens pid). */
const HOLD = [
  { farve: 'roed', navn: 'A', spillere: [], baevere: [{ navn: 'a1', udseende: null, ejer: 'pA' }] },
  { farve: 'blaa', navn: 'B', spillere: [], baevere: [{ navn: 'b1', udseende: null, ejer: 'pB' }] },
];

function lavKamp(hold = HOLD, cfg = CFG, froe = 12345) {
  const v = lavVerden({ froe, banetype: 'aaben', hold: structuredClone(hold), cfg });
  v.startKamp();
  return v;
}

/** Kør til simulationen melder 'dinTur' (kontrollen er givet). */
function tilDinTur(v) {
  for (let i = 0; i < 6000; i++) {
    const h = v.skridt();
    if (h.some((e) => e.navn === 'dinTur')) return v.aktivBaever();
  }
  throw new Error('ingen dinTur');
}

const vejl = (seq, aktiv) => ({ k: 'handling', seq, h: 'vejledning', aktiv });
const koer = (v, n) => { for (let i = 0; i < n; i++) v.skridt(); };

test('valider: kun ejeren, kun med aktiv som boolean', () => {
  const v = lavKamp();
  // Før kampen har nogen tur: ingen aktiv kunde.
  assert.deepEqual(valider(v, vejl(1, true), 'pA'), { ok: false, fejl: 'ingen aktiv bæver' });
  const b = tilDinTur(v);
  const anden = b.ejer === 'pA' ? 'pB' : 'pA';
  assert.deepEqual(v.udfoerKommando(vejl(1, true), b.ejer), { ok: true });
  assert.deepEqual(v.udfoerKommando(vejl(2, true), anden), { ok: false, fejl: 'ikke din bæver' });
  assert.deepEqual(v.udfoerKommando(vejl(3, 'ja'), b.ejer), { ok: false, fejl: 'ugyldig vejledning' });
  assert.deepEqual(v.udfoerKommando({ k: 'handling', seq: 4, h: 'vejledning' }, b.ejer), { ok: false, fejl: 'ugyldig vejledning' });
  // Ét tastatur (pid null): valider tjekker ikke ejerskab.
  assert.deepEqual(v.udfoerKommando(vejl(5, false), null), { ok: true });
});

test('uret: kvoten bruges før arsenalets pause', () => {
  const v = lavKamp();
  const b = tilDinTur(v);
  v.udfoerKommando(vejl(1, true), b.ejer);
  v.udfoerKommando({ k: 'handling', seq: 2, h: 'panel', aaben: true }, b.ejer);
  let t0 = v.tur.tickTilbage;
  koer(v, VEJLEDNING_LOFT);
  assert.equal(v.tur.tilstand, T.SPILLER_AKTIV);
  assert.equal(t0 - v.tur.tickTilbage, 0, 'uret stod stille i hele kvoten');
  assert.equal(v.tur.pausetTick, 0, 'arsenalets 5 s er urørte');
  assert.equal(v.tur.vejledningBrugt[b.ejer], VEJLEDNING_LOFT);
  assert.equal(v.vejledningTilbage(), 0);
  // Kvoten er brugt: nu arsenalets 300 tick, og så går uret.
  t0 = v.tur.tickTilbage;
  koer(v, 400);
  assert.equal(t0 - v.tur.tickTilbage, 400 - PANEL_PAUSE_LOFT);
  assert.equal(v.tur.pausetTick, PANEL_PAUSE_LOFT);
});

test('kvoten: pr. ejer pr. kamp, og flaget nulstilles ved hver tur', () => {
  const v = lavKamp();
  let b = tilDinTur(v);
  const foerste = b.ejer;
  v.udfoerKommando(vejl(1, true), b.ejer);
  koer(v, 1200);
  assert.equal(v.tur.vejledningBrugt[foerste], 1200);
  v.udfoerKommando({ k: 'handling', seq: 2, h: 'staaOver' }, b.ejer);
  b = tilDinTur(v);
  assert.notEqual(b.ejer, foerste);
  assert.equal(v.tur.vejledning, null, '_turStart nulstiller flaget');
  // Uden ny kommando går uret som altid.
  let t0 = v.tur.tickTilbage;
  koer(v, 60);
  assert.equal(t0 - v.tur.tickTilbage, 60);
  // Den anden ejer har sin egen kvote.
  v.udfoerKommando(vejl(3, true), b.ejer);
  v.skridt();
  t0 = v.tur.tickTilbage;
  koer(v, 120);
  assert.equal(t0 - v.tur.tickTilbage, 0, 'den anden ejer har sin egen kvote');
  v.udfoerKommando({ k: 'handling', seq: 4, h: 'staaOver' }, b.ejer);
  // Den første ejer igen: kun 600 tick tilbage af kvoten.
  b = tilDinTur(v);
  assert.equal(b.ejer, foerste);
  v.udfoerKommando(vejl(5, true), b.ejer);
  v.skridt();
  assert.equal(v.vejledningTilbage(), VEJLEDNING_LOFT - 1200 - 1);
  t0 = v.tur.tickTilbage;
  koer(v, 700);
  assert.equal(t0 - v.tur.tickTilbage, 101, 'kvoten slap op midt i turen (599 tick venter, 101 går)');
  // Gentagne kommandoer giver ikke mere tid.
  v.udfoerKommando(vejl(6, true), b.ejer);
  t0 = v.tur.tickTilbage;
  koer(v, 60);
  assert.equal(t0 - v.tur.tickTilbage, 60);
});

test('en fremmed spillers kommando rører ikke uret', () => {
  const v = lavKamp();
  const b = tilDinTur(v);
  const anden = b.ejer === 'pA' ? 'pB' : 'pA';
  v.udfoerKommando(vejl(1, true), anden);
  const t0 = v.tur.tickTilbage;
  koer(v, 120);
  assert.equal(t0 - v.tur.tickTilbage, 120);
  assert.deepEqual(v.tur.vejledningBrugt, {});
});

test('uden ejer (hold uden spillere) hører kvoten til holdet', () => {
  const hold = HOLD.map((h) => ({ ...h, baevere: h.baevere.map((x) => ({ ...x, ejer: null })) }));
  const v = lavKamp(hold);
  const b = tilDinTur(v);
  v.udfoerKommando(vejl(1, true), null);
  koer(v, 10);
  assert.equal(v.tur.vejledning, `hold${b.hold}`);
  assert.equal(v.tur.vejledningBrugt[`hold${b.hold}`], 10, 'kommandoen virker fra det første tick');
});

test('aktiv:false starter uret igen, og deltaen melder intet', () => {
  const v = lavKamp();
  const b = tilDinTur(v);
  v.udfoerKommando(vejl(1, true), b.ejer);
  koer(v, 30);
  assert.ok(v.delta().h.vj > 0, 'deltaen melder ventetiden');
  v.udfoerKommando(vejl(2, false), b.ejer);
  const t0 = v.tur.tickTilbage;
  v.skridt();
  assert.equal(t0 - v.tur.tickTilbage, 1, 'uret går igen i næste tick');
  assert.equal(v.delta().h.vj, undefined);
  assert.equal(v.vejledningTilbage(), 0);
});

test('ventetiden meldes kun i SPILLER_AKTIV — ikke efter skuddet', () => {
  const v = lavKamp();
  const b = tilDinTur(v);
  v.udfoerKommando(vejl(1, true), b.ejer);
  koer(v, 30);
  v.udfoerKommando({ k: 'handling', seq: 2, h: 'affyr', kraft: 0.6 }, b.ejer);
  koer(v, 3);
  assert.notEqual(v.tur.tilstand, T.SPILLER_AKTIV);
  assert.equal(v.delta().h.vj, undefined);
});

test('replikering: snapshot → genskab → anvendDelta, og snapshottet er en kopi', () => {
  const v = lavKamp();
  const spejl = lavVerden({ froe: 12345, banetype: 'aaben', hold: structuredClone(HOLD), cfg: CFG });
  const b = tilDinTur(v);
  v.udfoerKommando(vejl(1, true), b.ejer);
  koer(v, 600);
  // Kommandoen virker fra det første tick: 600 tick er brugt, 1200 tilbage.
  const d = structuredClone(v.delta());
  assert.equal(d.h.vj, VEJLEDNING_LOFT - 600);
  const snap = v.oejebliksbillede();
  spejl.genskab(structuredClone(snap));
  anvendDelta(spejl, d);
  assert.equal(spejl.tur.vejledningRest, 1200);
  assert.deepEqual(spejl.tur.vejledningBrugt, { [b.ejer]: 600 });
  // En rigtig kopi: ændres snapshottet, ændres værten ikke — og heller ikke
  // en verden, der er genskabt fra det samme objekt.
  const spejl2 = lavVerden({ froe: 12345, banetype: 'aaben', hold: structuredClone(HOLD), cfg: CFG });
  spejl2.genskab(snap);
  snap.tur.vejledningBrugt[b.ejer] = 0;
  assert.equal(v.tur.vejledningBrugt[b.ejer], 600);
  assert.equal(spejl2.tur.vejledningBrugt[b.ejer], 600);
  // Uret venter ikke længere: deltaen nulstiller spejlets tal.
  v.udfoerKommando(vejl(2, false), b.ejer);
  v.skridt();
  anvendDelta(spejl, structuredClone(v.delta()));
  assert.equal(spejl.tur.vejledningRest, 0);
});

test('et gammelt snapshot uden felterne virker stadig', () => {
  const v = lavKamp();
  const b = tilDinTur(v);
  const snap = structuredClone(v.oejebliksbillede());
  delete snap.tur.vejledning;
  delete snap.tur.vejledningBrugt;
  const w = lavVerden({ froe: 12345, banetype: 'aaben', hold: structuredClone(HOLD), cfg: CFG });
  w.genskab(snap);
  assert.deepEqual(w.tur.vejledningBrugt, {});
  // Værten genskabt fra det gamle snapshot kan stadig give kvoten.
  w.udfoerKommando(vejl(1, true), b.ejer);
  const t0 = w.tur.tickTilbage;
  koer(w, 30);
  assert.equal(t0 - w.tur.tickTilbage, 0);
  const d = structuredClone(w.delta());
  delete d.h.vj;
  anvendDelta(w, d);
  assert.equal(w.tur.vejledningRest, 0);
});

/**
 * En skriptet kamp på 90 s. Første tur er en rigtig vejledning: gå, hop,
 * sigt, vælg våben og skyd — i alt knap 12 s. Resten af turene: sigt op, lad,
 * skyd. medPause: vejledningen sender aktiv:true ved dinTur og aktiv:false
 * efter skuddet, som main.js gør. Kommandoerne ligger i inputstrømmen, så
 * resten af kampen skal være præcis den samme.
 */
function skriptetKamp(medPause) {
  const hold = [
    { farve: 'roed', navn: 'A', spillere: [], baevere: [{ navn: 'a1', udseende: null, ejer: 'pA' }, { navn: 'a2', udseende: null, ejer: 'pA' }] },
    { farve: 'blaa', navn: 'B', spillere: [], baevere: [{ navn: 'b1', udseende: null, ejer: 'pB' }, { navn: 'b2', udseende: null, ejer: 'pB' }] },
  ];
  const v = lavKamp(hold, { ...CFG, turTicks: 20 * 60 }, 777);
  // rngSim tælles pr. tick: den nye gren må ikke trække et tal.
  let kald = 0;
  const orig = v.rngSim;
  const vagt = function () { kald++; return orig(); };
  Object.assign(vagt, orig);
  v.rngSim = vagt;

  const spor = [], ure = [], rngKald = [];
  let seq = 0, skudt = -1, foersteTur = null, vejledt = 0;
  const cmd = (c) => v.udfoerKommando({ ...c, seq: seq++ }, v.aktivBaever()?.ejer ?? null);
  for (let t = 0; t < 60 * 90; t++) {
    if (v.tur.tilstand === T.SPILLER_AKTIV) {
      const i = v.tur.tilstandTick;
      foersteTur ??= v.tur.turNr;
      if (v.tur.turNr === foersteTur) {
        if (i === 1 && medPause) { cmd({ k: 'handling', h: 'vejledning', aktiv: true }); vejledt++; }
        if (i === 5) cmd({ k: 'hold', b: K.HOEJRE });
        if (i === 60) cmd({ k: 'hold', b: 0 });
        if (i === 80) cmd({ k: 'hold', b: K.HOP });
        if (i === 140) cmd({ k: 'hold', b: K.SIGT_OP });
        if (i === 170) cmd({ k: 'hold', b: 0 });
        if (i === 400) cmd({ k: 'handling', h: 'vaelgVaaben', id: 'grenroer' });
        if (i === 690 && skudt !== v.tur.turNr) {
          skudt = v.tur.turNr;
          cmd({ k: 'handling', h: 'affyr', kraft: 0.7 });
          if (medPause) cmd({ k: 'handling', h: 'vejledning', aktiv: false });
        }
      } else {
        if (i === 5) cmd({ k: 'hold', b: K.SIGT_OP });
        if (i === 25) cmd({ k: 'hold', b: 0 });
        if (i === 40 && skudt !== v.tur.turNr) { skudt = v.tur.turNr; cmd({ k: 'handling', h: 'affyr', kraft: 0.7 }); }
      }
    }
    kald = 0;
    v.skridt();
    rngKald.push(kald);
    ure.push(v.tur.tickTilbage);
    const { tickTilbage, vejledning, vejledningBrugt, ...tur } = v.tur;
    spor.push(JSON.stringify([v.tick, v.rngSim.tilstand(), tur, v.vind, v.vandNiveau, v.valgtVaaben,
      v.terraen.ops.length, v.terraen.aftryk(), v.aftryk(),
      v.baevere.map((b) => [b.x, b.y, b.vx, b.vy, b.hp, b.doed, b.vinkel, b.retning]),
      v.projektiler.map((p) => [p.id, p.x, p.y])]));
  }
  return { spor, ure, rngKald, ops: v.terraen.ops.length, ture: v.tur.turNr, vejledt, brugt: v.tur.vejledningBrugt };
}

test('determinisme: med og uden vejledningens pause — samme kamp, bortset fra uret', () => {
  const uden = skriptetKamp(false), med = skriptetKamp(true);
  assert.equal(med.vejledt, 1, 'vejledningen kørte i første tur');
  assert.ok(med.brugt.pA > 600 || med.brugt.pB > 600, `kvoten blev brugt (${JSON.stringify(med.brugt)})`);
  assert.deepEqual(uden.brugt, {});
  assert.ok(uden.ture >= 4, `flere ture (${uden.ture})`);
  assert.ok(uden.ops > 0, 'terrænet blev ramt (scenariet virker)');
  assert.equal(med.spor.length, uden.spor.length);
  let urForskel = 0;
  for (let i = 0; i < uden.spor.length; i++) {
    assert.equal(med.spor[i], uden.spor[i], `tick ${i}`);
    assert.equal(med.rngKald[i], uden.rngKald[i], `rngSim-kald i tick ${i}`);
    if (med.ure[i] !== uden.ure[i]) urForskel++;
  }
  assert.ok(urForskel > 0, 'uret var den eneste forskel — og der var en');
});

test('samme skriptede kamp to gange med pausen giver det samme', () => {
  const a = skriptetKamp(true), b = skriptetKamp(true);
  assert.deepEqual(a.ure, b.ure);
  for (let i = 0; i < a.spor.length; i++) assert.equal(a.spor[i], b.spor[i], `tick ${i}`);
});
