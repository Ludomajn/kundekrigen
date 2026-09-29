/* Kundekrigen — test: farerne, ilden og planlæggeren i snapshottet og deltaen.
 *
 *   node --no-warnings --test test/farer_snapshot.mjs
 *
 * 1. Rundtur midt i en brand: på et tick med tom kø (køen, forsinkede og
 *    dødskøen er IKKE med i snapshottet, docs/farer.md) giver
 *    snapshot → JSON → genskab en verden, der derefter går 600 tick med
 *    præcis samme aftryk som værten.
 * 2. Det samme ved turskift i en rigtig kamp med farer (dér sender værten sine
 *    snapshots), og midt i et varsel.
 * 3. Gamle snapshots uden farer, ild og planlægger kan indlæses og spilles videre.
 * 4. tagDelta → anvendDelta: id, slags, hud og position inden for 1/8, `fv`
 *    bliver null på spejlet, når varslet er slut, den sidste fare og den
 *    sidste plet forsvinder, og listerne sendes altid — også tomme.
 *    Dronens flyvehøjde hedder hoejdeMaal: maalX/maalY er interpolationens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavVerden } from '../static/js/sim/world.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';
import { aktivVerden, lavTestVerden, FA, T, koer, kabelsalatPaaJorden, antaend, laegPlaceret, fladPlads,
         botTick, hurtigeFarer, lavHold, BANER } from './farer_hjaelp.mjs';

const net = (x) => JSON.parse(JSON.stringify(x));
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;

/* Turens flygtige felter (holdte taster, opladning, brugt i turen …) er ikke
 * med i snapshottet: værten genskaber aldrig, og ved turskift er de nulstillet.
 * Midt i en tur kopieres de, så testen kun prøver farernes del. */
const FLYGTIGE = ['holdt', 'opladning', 'opladerNu', 'brugtIDenneTur', 'brugtPrVaaben', 'panelAabent',
                  'skadeITur', '_sigteTael', 'markoer', 'slut'];

/** Er køerne tomme og kunderne i ro, så snapshottet er tabsfrit? */
const tabsfrit = (v) => !v.eksplosionsKoe.length && !v.forsinkede.length && !v.doedskoe.length &&
  !v.projektiler.length && v.baevere.every((b) => b.doed || (b.paaJorden && !b.redskab && !b.vx && !b.vy));

/** Rund værtens kunder til snapshottets præcision (snapshot.js: r1 og r3), så
 *  rundturen kan være bit for bit — farerne og ilden rundes ALDRIG. */
function rundKunder(v) {
  for (const b of v.baevere) { b.x = r1(b.x); b.y = r1(b.y); b.vx = r1(b.vx); b.vy = r1(b.vy); b.vinkel = r3(b.vinkel); }
}

/** snapshot → JSON → genskab i en ny verden med samme opsætning. */
function rundtur(v, opsaet, flygtige = true) {
  rundKunder(v);
  const snap = net(v.oejebliksbillede());
  const w = lavVerden(opsaet);
  w.genskab(snap);
  if (flygtige) for (const k of FLYGTIGE) w[k] = structuredClone(v[k]);
  return w;
}

/** Kør værten og kopien side om side (samme bot) og sammenlign hvert tick. */
function sideOmSide(a, b, n, { foer = null } = {}) {
  for (let i = 0; i < n; i++) {
    for (const v of [a, b]) { if (foer) foer(v); botTick(v); }
    const ha = a.skridt(), hb = b.skridt();
    assert.equal(b.aftryk(), a.aftryk(), `aftrykket afviger ${i + 1} tick efter rundturen (tick ${a.tick})`);
    assert.deepEqual(hb.map((e) => e.navn), ha.map((e) => e.navn), `hændelserne afviger ved tick ${a.tick}`);
    // Hele farernes tilstand, ikke kun aftrykkets id og position: urene, alderen, planen.
    if (i % 10 === 0) {
      assert.equal(JSON.stringify(b.farer), JSON.stringify(a.farer), `farerne afviger ved tick ${a.tick}`);
      assert.equal(JSON.stringify(b.ild), JSON.stringify(a.ild), `ilden afviger ved tick ${a.tick}`);
      assert.equal(JSON.stringify(b.farePlan), JSON.stringify(a.farePlan), `planen afviger ved tick ${a.tick}`);
    }
  }
  assert.deepEqual(net(b.farer), net(a.farer), 'farerne');
  assert.deepEqual(net(b.ild), net(a.ild), 'ilden');
  assert.deepEqual(net(b.farePlan), net(a.farePlan), 'planlæggeren');
}

test('rundtur midt i en brand: 600 tick med samme aftryk bagefter', () => {
  for (const bane of ['aaben', 'hule']) {
    const o = { froe: 5, bane, hold: [2, 2] };
    const v = aktivVerden(o);
    v.vejr = 'solskin'; v.vind = 0.3;
    const p = fladPlads(v, 300) || FA.steder(v).kabelsalat[0];
    assert.ok(p, `${bane}: ingen plads`);
    const f = kabelsalatPaaJorden(v, p.x, p.y);
    laegPlaceret(v, 'toende', p.x + 3 * FA.ILD_CELLE, p.y);
    if (bane !== 'hule') FA.tving(v, 'drone', { side: 'v', pakke: 'koglebombe' });
    else FA.tving(v, 'stoevsuger', FA.steder(v).stoevsuger[0] || { x: p.x - 200, y: p.y, ret: -1 });
    koer(v, 20);
    antaend(v, f);
    // Til den brænder, har lagt ild, og køen er tom.
    koer(v, 400, { stop: (vv) => f.brand > 0 && vv.ild.length > 0 && tabsfrit(vv) });
    assert.ok(f.brand > 0 && v.ild.length > 0 && tabsfrit(v), `${bane}: ingen brand med ild og tom kø (brand ${f.brand}, ild ${v.ild.length})`);
    const opsaet = { froe: o.froe, banetype: bane, hold: lavHold(2, 2), cfg: net(v.cfg) };
    const w = rundtur(v, opsaet);
    assert.equal(w.aftryk(), v.aftryk(), `${bane}: aftrykket lige efter genskab`);
    assert.ok(w.farer.length === v.farer.length && w.farer.every((g) => g !== v.farer.find((x) => x.id === g.id)),
      'genskab deler objekter med værten');
    sideOmSide(v, w, 600);
  }
});

test('rundtur ved turskift i en rigtig kamp og midt i et varsel', () => {
  let medFare = 0, medIld = 0, medVarsel = 0;
  for (const bane of BANER) {
    for (const froe of [4, 9]) {
      const opsaet = { froe, banetype: bane, hold: lavHold(3, 2),
                       cfg: { banetype: bane, turTicks: 1500, kampTicks: 43200 } };
      const v = lavVerden(net(opsaet));
      v.startKamp();
      let gjort = 0, varselGjort = false;
      for (let i = 0; i < 30000 && gjort < 2 && v.tur.tilstand !== T.SEJR; i++) {
        hurtigeFarer(v); botTick(v);
        const h = v.skridt();
        const turStart = h.some((e) => e.navn === 'turStart');
        // Ved turskift (værten sender et snapshot) med en fare eller ild på banen.
        if (turStart && (v.farer.length || v.ild.length) && tabsfrit(v)) {
          if (v.farer.length) medFare++;
          if (v.ild.length) medIld++;
          const w = rundtur(v, opsaet, false);
          sideOmSide(v, w, 600, { foer: hurtigeFarer });
          gjort++;
        } else if (!varselGjort && v.farePlan.varsel && v.farePlan.varsel.rest > 60 && tabsfrit(v)) {
          // Midt i et varsel: kantpilen og faren, der kommer, er de samme.
          varselGjort = true;
          medVarsel++;
          const w = rundtur(v, opsaet);
          assert.deepEqual(net(w.farePlan), net(v.farePlan), 'varslet');
          sideOmSide(v, w, 600, { foer: hurtigeFarer });
        }
      }
    }
  }
  console.log(`  rundture: med fare ${medFare}, med ild ${medIld}, i et varsel ${medVarsel}`);
  assert.ok(medFare >= 4 && medVarsel >= 4, `rundture med fare ${medFare}, med ild ${medIld}, i et varsel ${medVarsel}`);
});

test('gamle snapshots uden farer, ild og planlægger kan indlæses og spilles videre', () => {
  const v = lavTestVerden({ froe: 6, bane: 'aaben', hold: [2, 2] });
  koer(v, 3000, { hvert: botTick });
  const snap = net(v.oejebliksbillede());
  delete snap.farer; delete snap.ild; delete snap.farePlan; delete snap.cfg.farer;
  for (const b of snap.baevere) delete b.ildTur;
  for (const p of snap.projektiler) delete p.kaedeId;
  const w = lavVerden({ froe: 6, banetype: 'aaben', hold: lavHold(2, 2), cfg: { banetype: 'aaben' } });
  w.genskab(snap);
  assert.deepEqual(w.farer, []);
  assert.deepEqual(w.ild, []);
  assert.deepEqual(w.farePlan, FA.nyPlan());
  // cfg.farer mangler: alle farer (som STANDARD_CFG). Planlæggeren går i gang.
  let farer = 0;
  for (let i = 0; i < 30000 && w.tur.tilstand !== T.SEJR; i++) {
    hurtigeFarer(w); botTick(w);
    for (const e of w.skridt()) if (e.navn === 'fareKommer') farer++;
  }
  assert.ok(farer >= 1, `${farer} farer efter et gammelt snapshot`);
});

test('tagDelta → anvendDelta: farer, ild og varsel følger med og forsvinder igen', () => {
  const v = aktivVerden({ froe: 7, bane: 'aaben', hold: [2, 2] });
  const spejl = lavVerden({ froe: 7, banetype: 'aaben', hold: lavHold(2, 2), cfg: net(v.cfg) });
  spejl.genskab(net(v.oejebliksbillede()));
  const send = () => { const d = net(v.delta()); anvendDelta(spejl, d); return d; };

  // Tomme lister sendes også — og varslet er null, ikke udeladt.
  let d = send();
  assert.ok(Array.isArray(d.fa) && Array.isArray(d.il) && d.fa.length === 0 && d.il.length === 0, 'fa/il mangler');
  assert.ok('fv' in d.h && d.h.fv === null, 'fv mangler');

  // Et varsel: kantpilen står på spejlet, og forsvinder, når faren kommer.
  v.farePlan.naeste = v.farePlan.aktiv + 1;
  let varslet = false, kom = false, lige = 0;
  for (let i = 0; i < 400 && !kom; i++) {
    const h = v.skridt();
    send();
    if (v.farePlan.varsel) {
      varslet = true;
      const a = v.farePlan.varsel, b = spejl.farePlan.varsel;
      assert.ok(b && b.slags === a.slags && b.rest === a.rest && b.ret === a.ret && b.hud === a.hud, 'varslet på spejlet');
      assert.ok(Math.abs(b.x - a.x) <= 0.5 && Math.abs(b.y - a.y) <= 0.5);
    }
    if (h.some((e) => e.navn === 'fareKommer')) {
      kom = true;
      assert.equal(spejl.farePlan.varsel, null, 'varslet hænger på spejlet');
    }
  }
  assert.ok(varslet && kom, `varsel ${varslet}, kom ${kom}`);

  // Faren (og en drone) på spejlet: id, slags, hud og position inden for 1/8.
  const d2 = FA.tving(v, 'drone', { side: 'h', pakke: 'egegranat' });
  const p = fladPlads(v, 200);
  FA.taendIld(v, p.x, p.y, 0, null, []);
  FA.taendIld(v, p.x + 24, p.y, 0, null, []);
  for (let i = 0; i < 30; i++) {
    v.skridt(); send();
    assert.equal(spejl.farer.length, v.farer.length);
    for (const f of v.farer) {
      const g = spejl.farer.find((x) => x.id === f.id);
      assert.ok(g && g.slags === f.slags && g.hud === f.hud && g.tilst === f.tilst && g.ret === f.ret, `fare ${f.id}`);
      assert.ok(Math.abs(g.x - f.x) <= 1 / 16 && Math.abs(g.y - f.y) <= 1 / 16, `fare ${f.id}: position`);
      assert.equal(g.maalY, g.y, 'maalY er interpolationens (positionen)');
      assert.equal(!!g.pakke, !!f.pakke);
    }
    assert.deepEqual(spejl.ild.map((q) => q.id), v.ild.map((q) => q.id));
  }
  // Dronen: flyvehøjden hedder hoejdeMaal i simulationen, aldrig maalY.
  assert.ok('hoejdeMaal' in d2 && !('maalY' in d2) && !('maalX' in d2), 'navnekollision med interpolationen');
  const g = spejl.farer.find((x) => x.id === d2.id);
  assert.ok(g && !('hoejdeMaal' in g), 'spejlet fik hoejdeMaal med deltaen');

  // Genbrug pr. id: spejlets objekt bevares (interpolationens historik).
  const foer = spejl.farer.find((x) => x.id === d2.id);
  foer.hist = [[1, 2, 3]];
  v.skridt(); send();
  assert.equal(spejl.farer.find((x) => x.id === d2.id), foer, 'objektet blev udskiftet');

  // Den sidste fare og den sidste plet forsvinder på spejlet.
  v.farer.length = 0; v.ild.length = 0;
  d = send();
  assert.deepEqual([d.fa, d.il, spejl.farer, spejl.ild], [[], [], [], []]);

  // En delta fra en ældre vært (uden fa, il og fv): ingen farer, intet varsel.
  FA.tving(v, 'drone', { side: 'v' });
  send();
  assert.equal(spejl.farer.length, 1);
  const gl = net(v.delta());
  delete gl.fa; delete gl.il; delete gl.h.fv;
  spejl.farePlan.varsel = { slags: 'drone', x: 0, y: 0, ret: 1, rest: 9 };
  anvendDelta(spejl, gl);
  assert.deepEqual([spejl.farer, spejl.ild, spejl.farePlan.varsel], [[], [], null]);
});

test('Nullermanden: grotten sender huden med, og spejlet viser den', () => {
  const v = aktivVerden({ froe: 3, bane: 'hule', hold: [2, 2] });
  const spejl = lavVerden({ froe: 3, banetype: 'hule', hold: lavHold(2, 2), cfg: net(v.cfg) });
  spejl.genskab(net(v.oejebliksbillede()));
  const p = FA.steder(v).kabelsalat[0];
  assert.ok(p, 'ingen plads i grotten');
  const f = FA.tving(v, 'kabelsalat', { x: p.x, y: p.y, ret: 1 });
  assert.equal(f.hud, 'nullermand');
  v.skridt();
  anvendDelta(spejl, net(v.delta()));
  assert.equal(spejl.farer[0].hud, 'nullermand');
  assert.equal(spejl.farer[0].slags, 'kabelsalat');
});
