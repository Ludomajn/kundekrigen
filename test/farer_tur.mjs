/* Kundekrigen — test: farerne holder aldrig turen åben, og hele kæden
 * afvikles i skyttens egen tur.
 *
 *   node --no-warnings --test test/farer_tur.mjs
 *
 * Urene (brand, luft og styrt), lunterne og ild, der truer: hvert af dem
 * holder OPLOESNING højst sit loft åben, og vagthunden (RO_VAGTHUND) griber
 * aldrig ind på grund af en fare. Farerne står stille uden for aktiv tid, og
 * skriptede kampe på 10 minutter pr. banetype viser det i praksis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavRng } from '../static/js/core/rng.js';
import { RO_HYSTERESE, RO_VAGTHUND } from '../static/js/sim/turn.js';
import * as HN from '../static/js/sim/haendelser.js';
import { aktivVerden, FA, T, koer, kabelsalatPaaJorden, antaend, laegPlaceret, jordVed, frieSteder,
         skriptetKamp, hurtigeFarer, BANER } from './farer_hjaelp.mjs';

/** Afslut turen (Sæt på hold) og kør til SKADE — eller til loftet. */
function tilSkade(v, loft = 2000) {
  const b = v.aktivBaever();
  v.udfoerKommando({ k: 'handling', h: 'staaOver' }, b?.ejer);
  const start = v.tick;
  const alle = koer(v, loft, { stop: (vv) => vv.tur.tilstand === T.SKADE || vv.tur.tilstand === T.SEJR });
  return { alle, ticks: v.tick - start };
}

/** En plads langt fra kunderne og banens ting, på et fladt stykke jord. */
function fladPlads(v, fra = 350) {
  for (const p of frieSteder(v, fra)) {
    if ([...v.placerede, ...v.kasser].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 160)) continue;
    const g = [-60, -30, 0, 30, 60].map((dx) => jordVed(v, p.x + dx, p.y, 40));
    if (g.every((y) => Math.abs(y - p.y) < 12 && y > v.vandNiveau + 40) && !v.terraen.fast(p.x, p.y + 60)) return p;
  }
  return null;
}

/** Uden farer: hvor længe tager opløsningen efter Sæt på hold? */
function grundlinje(o) {
  const v = aktivVerden(o);
  return tilSkade(v).ticks;
}

test('en landet Kabelsalat i evig vind forsinker ikke SKADE', () => {
  for (const bane of ['aaben', 'fort']) {
    const o = { froe: 3, bane, hold: [2, 1] };
    const uden = grundlinje(o);
    const v = aktivVerden(o);
    const p = fladPlads(v, 250) || frieSteder(v, 250)[0];
    const f = kabelsalatPaaJorden(v, p.x, p.y);
    v.vind = 1;
    koer(v, 30);                       // den ruller
    assert.equal(f.tilst, 'jord');
    const { ticks } = tilSkade(v);
    assert.ok(ticks <= Math.max(uden, RO_HYSTERESE) + 5, `${bane}: ${ticks} tick (uden fare ${uden})`);
    assert.ok(!v.farer.length || Math.abs(f.vx) > 1, 'den stod stille');
  }
});

test('en Kabelsalat, der kommer ind i luften, venter højst FARE_LUFT_URO og lander først', () => {
  for (const bane of BANER) {
    const v = aktivVerden({ froe: 4, bane, hold: [2, 1] });
    const p = FA.steder(v).kabelsalat[0] || frieSteder(v, 250)[0];
    const f = FA.tving(v, 'kabelsalat', { x: p.x, y: p.y, ret: 1 });
    assert.ok(f.luft === FA.FARE_LUFT_URO && f.tilst === 'luft');
    const { ticks } = tilSkade(v);
    assert.equal(v.tur.tilstand, T.SKADE, bane);
    assert.ok(ticks <= FA.FARE_LUFT_URO + RO_HYSTERESE + 5, `${bane}: ${ticks} tick`);
    if (v.farer.includes(f)) assert.ok(f.luft === 0 && f.tilst !== 'luft', `${bane}: ${f.tilst}, luft ${f.luft}`);
  }
});

test('en brændende Kabelsalat forsinker højst KS_BRAND + 10, og braget kommer i turen', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'regn';
  const p = fladPlads(v);
  const f = kabelsalatPaaJorden(v, p.x, p.y, { stille: true });
  antaend(v, f);
  const { alle, ticks } = tilSkade(v);
  assert.ok(alle.some((e) => e.navn === 'fareVaek' && e.grund === 'brag'), 'intet flammebrag før SKADE');
  assert.ok(ticks <= FA.KS_BRAND + FA.BRAND_URO_EKSTRA + RO_HYSTERESE + 5, `${ticks} tick`);
});

test('D1: et nyt brag kaster den brændende Kabelsalat op — turen venter stadig på flammebraget', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'regn';
  const p = fladPlads(v);
  const f = kabelsalatPaaJorden(v, p.x, p.y, { stille: true });
  antaend(v, f);
  const b = v.aktivBaever();
  v.udfoerKommando({ k: 'handling', h: 'staaOver' }, b.ejer);
  koer(v, 10);
  assert.ok(f.brand > 0 && f.tilst === 'jord');
  v.eksplosionsKoe.push({ x: f.x - 6, y: f.y - 4, radius: 40, skade: 0, knockback: 100, carve: false });
  let landet = false, luft = false;
  const alle = koer(v, 600, {
    stop: (vv) => vv.tur.tilstand === T.SKADE,
    hvert: () => { if (f.tilst === 'luft') luft = true; if (luft && f.tilst === 'jord') landet = true; },
  });
  assert.ok(luft && landet, `kastet op: ${luft}, landet igen: ${landet}`);
  const iBrag = alle.findIndex((e) => e.navn === 'fareVaek' && e.grund === 'brag');
  assert.ok(iBrag >= 0, 'SKADE kom før flammebraget');
  assert.equal(v.tur.tilstand, T.SKADE);
});

test('D2: ild ved en utændt printer får printeren til at gå af i skyttens tur', () => {
  for (const vind of [0, 0.6]) {
    const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
    v.vejr = 'solskin'; v.vind = vind;
    const p = fladPlads(v);
    const x0 = Math.round(p.x / FA.ILD_CELLE) * FA.ILD_CELLE;
    const printer = laegPlaceret(v, 'toende', x0 + 2 * FA.ILD_CELLE + 10, p.y);
    FA.taendIld(v, x0, p.y, 0, null, []);
    koer(v, 1);
    assert.ok(v.ild[0].truer, `vind ${vind}: pletten truer ikke`);
    const { alle } = tilSkade(v);
    assert.ok(alle.some((e) => e.navn === 'printerSprang'), `vind ${vind}: printeren gik ikke af i turen`);
    assert.ok(printer.antaendt);
  }
});

test('vagthunden reagerer aldrig i 200 scenarier', () => {
  const rng = lavRng(4242);
  const slags = ['kabelsalat', 'kabelsalat', 'drone', 'stoevsuger'];
  let luftige = 0, brande = 0, styrt = 0, pakker = 0;
  for (let n = 0; n < 200; n++) {
    const bane = BANER[n % 4];
    const v = aktivVerden({ froe: 1 + Math.floor(rng() * 30), bane, hold: [2, 1 + (n % 3)] });
    v.vejr = ['solskin', 'regn', 'sne', 'overskyet'][Math.floor(rng() * 4)];
    v.vind = Math.round((rng() - 0.5) * 2 * 20) / 20;
    const s = slags[Math.floor(rng() * slags.length)];
    if (s === 'drone' && bane === 'hule') continue;
    const steder = frieSteder(v, 100 + rng() * 300);
    if (!steder.length) continue;
    const p = steder[Math.floor(rng() * steder.length)];
    const f = s === 'drone' ? FA.tving(v, 'drone', { side: rng() < 0.5 ? 'v' : 'h' }, [], { x: p.x, y: p.y + 120 + rng() * 200 })
      : rng() < 0.5 ? FA.tving(v, s, { x: p.x, y: p.y, ret: 1 }) : s === 'kabelsalat' ? kabelsalatPaaJorden(v, p.x, p.y)
      : FA.tving(v, s, { x: p.x, y: p.y, ret: -1 });
    for (let i = 0; i < Math.floor(rng() * 6); i++) laegPlaceret(v, rng() < 0.5 ? 'toende' : 'mine', p.x + (rng() - 0.5) * 300, p.y);
    for (let i = 0; i < Math.floor(rng() * 6); i++) FA.taendIld(v, p.x + (rng() - 0.5) * 300, p.y, Math.floor(rng() * 3), null, []);
    const hvad = rng();
    if (hvad < 0.4) antaend(v, f);
    else if (hvad < 0.8) v.eksplosionsKoe.push({ x: f.x + (rng() - 0.5) * 30, y: f.y + f.hy - 10, radius: 30 + rng() * 60,
                                                 skade: 20, knockback: 100 + rng() * 300, carve: rng() < 0.5 });
    if (f.luft > 0 || hvad >= 0.4) luftige++;
    const { alle, ticks } = tilSkade(v, RO_VAGTHUND + 300);
    assert.ok(!alle.some((e) => e.navn === 'tvungenRo'), `${bane}/${n} (${s}): vagthunden greb ind efter ${ticks} tick`);
    assert.equal(v.tur.tilstand, T.SKADE, `${bane}/${n}`);
    assert.ok(v.farer.every((q) => !(q.luft > 0) && !(q.uro > 0)), `${bane}/${n}: uro ved SKADE`);
    brande += alle.filter((e) => e.navn === 'fareAntaendt' && !e.nedskudt).length;
    styrt += alle.filter((e) => e.navn === 'fareAntaendt' && e.nedskudt).length;
    pakker += alle.filter((e) => e.navn === 'kasseFalder' && e.fald).length;
  }
  assert.ok(brande > 40 && styrt > 5 && pakker > 3, `brande ${brande}, styrt ${styrt}, pakker ${pakker}`);
});

test('en aktiv kunde, der dør af ild, giver "kunden døde"; startpausen gælder de første 30 tick', () => {
  const v = aktivVerden({ froe: 9, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'regn';
  const b = v.aktivBaever();
  b.hp = 3;
  const start = v.tick - v.tur.tilstandTick;       // SPILLER_AKTIV begyndte her
  FA.taendIld(v, b.x, b.y, 2, null, []);
  const alle = koer(v, 200, { stop: (vv) => vv.tur.tilstand !== T.SPILLER_AKTIV });
  const skade = alle.find((e) => e.navn === 'skade' && e.baever === b.id);
  assert.ok(skade && skade.aarsag === 'ild' && skade.drab, JSON.stringify(skade));
  assert.ok(skade.tick - start >= FA.ILD_START_PAUSE, `ildskade ${skade.tick - start} tick inde i turen`);
  const slut = alle.find((e) => e.navn === 'turAfsluttet');
  assert.equal(slut?.grund, 'kunden døde');
});

test('en nedskudt pakke lander uden tvang', () => {
  for (const bane of ['aaben', 'fort', 'oeer']) {
    const v = aktivVerden({ froe: 11, bane, hold: [2, 1] });
    const p = frieSteder(v, 200)[0];
    const d = FA.tving(v, 'drone', { side: 'v', pakke: 'egegranat' }, [], { x: p.x, y: p.y + 260, hoejdeMaal: p.y + 260 });
    v.eksplosionsKoe.push({ x: d.x, y: d.y + d.hy, radius: 20, skade: 0, knockback: 0, carve: false });
    const { alle } = tilSkade(v, RO_VAGTHUND + 60);
    assert.ok(!alle.some((e) => e.navn === 'tvungenRo'), `${bane}: vagthunden`);
    const fald = alle.find((e) => e.navn === 'kasseFalder' && e.fald);
    assert.ok(fald, `${bane}: ingen pakke`);
    const k = v.kasser.find((q) => q.id === fald.id);
    if (k) {
      assert.ok(k.landet && v.terraen.fast(Math.round(k.x), Math.round(k.y) - 1) && !v.terraen.fast(Math.round(k.x), Math.round(k.y)),
        `${bane}: pakken ligger ikke på jorden (${k.x}, ${k.y})`);
    }
    assert.ok(alle.some((e) => e.navn === 'fareVaek' && (e.grund === 'styrt' || e.grund === 'vand')), `${bane}: dronen styrtede ikke`);
  }
});

test('brandøvelsen slukker al ild, før kunderne flyttes', () => {
  const v = aktivVerden({ froe: 13, bane: 'aaben', hold: [2, 2] });
  const p = fladPlads(v, 200);
  for (let i = 0; i < 6; i++) FA.taendIld(v, p.x + i * 24, p.y, 0, null, []);
  assert.ok(v.ild.length >= 4);
  const n = v.ild.length;
  const h = [];
  const e = HN.udloes(v, 'brandoevelse', h);
  assert.equal(v.ild.length, 0);
  assert.equal(e.slukket, n);
});

/** Skriptede kampe med kontroller pr. tick. */
function kampMedKontrol({ froe, bane, hold = [2, 2], ticks = 36000, foerTick = null }) {
  const fejl = [];
  const foedt = new Map();             // plettens id -> turNr
  const lunteFoer = new Map();
  const turStartPos = new Map();
  let farerFoerRunde2 = 0, ildskadeIPausen = 0, luftVedSkade = 0, frosset = 0, tidligLunte = 0;
  const FROSNE = new Set([T.TUR_START, T.SKADE, T.TUR_SLUT, T.UDSAET, T.FILM, T.SEJR]);
  const k = skriptetKamp({ froe, bane, hold, ticks, foerTick, efter: (vv, h, foer) => {
    const tilst = vv.tur.tilstand;
    for (const e of h) {
      if ((e.navn === 'fareVarsel' || e.navn === 'fareKommer') && (vv.tur.runde | 0) < FA.FARE_FRA_RUNDE) farerFoerRunde2++;
      if (e.navn === 'skade' && e.aarsag === 'ild' && e.baever === vv.tur.baeverId &&
          tilst === T.SPILLER_AKTIV && vv.tur.tilstandTick < FA.ILD_START_PAUSE) ildskadeIPausen++;
      if (e.navn === 'turStart') for (const q of vv.placerede) turStartPos.set(q.id, [q.x, q.y]);
    }
    for (const p of vv.ild) if (!foedt.has(p.id)) foedt.set(p.id, vv.tur.turNr);
    if (tilst === T.SKADE && vv.farer.some((f) => f.luft > 0)) luftVedSkade++;
    for (const b of vv.baevere) if (b.ildTur > FA.ILD_LOFT) fejl.push(`ildTur ${b.ildTur}`);
    if (FROSNE.has(tilst)) {
      for (const f of vv.farer) {
        const g = foer.farer.get(f.id);
        if (g && (g[0] !== f.x || g[1] !== f.y || g[2] !== f.alder)) frosset++;
      }
      for (const p of vv.ild) { const g = foer.ild.get(p.id); if (g !== undefined && g !== p.alder) frosset++; }
      if (foer.aktiv !== vv.farePlan.aktiv) frosset++;
    }
    // D2: en printer eller mine, der får lunte af en plet fra en tidligere tur
    // (uden at have flyttet sig, og uden en brændende fare ved sig).
    for (const q of vv.placerede) {
      const foerL = lunteFoer.get(q.id) || 0;
      if (q.lunte > 0 && foerL === 0 && q.antaendt) {
        const naer = vv.ild.filter((p) => Math.hypot(p.x - q.x, p.y - q.y) <= FA.ILD_PLAC_R);
        const pos = turStartPos.get(q.id);
        const flyttet = !pos || Math.hypot(pos[0] - q.x, pos[1] - q.y) > 1;
        const fare = vv.farer.some((f) => f.brand > 0);
        if (!flyttet && !fare && naer.length && naer.every((p) => foedt.get(p.id) < vv.tur.turNr)) tidligLunte++;
      }
      lunteFoer.set(q.id, q.lunte);
    }
  } });
  return { ...k, fejl, farerFoerRunde2, ildskadeIPausen, luftVedSkade, frosset, tidligLunte };
}

for (const bane of BANER) {
  test(`skriptede kampe på 10 minutter (${bane}): ingen tvungen ro fra farerne, alt står stille uden for aktiv tid`, () => {
    let farer = 0, brande = 0, ild = 0, lange = 0;
    // To kampe med planlæggerens egne pauser (2×2) og to med en fare hvert
    // 15. s aktiv tid (3×3, så kampen varer hele de 10 minutter).
    for (const [froe, hold, foerTick] of [[3, [2, 2], null], [8, [2, 2], null], [3, [3, 3], hurtigeFarer], [8, [3, 3], hurtigeFarer]]) {
      const k = kampMedKontrol({ froe, bane, hold, foerTick });
      if (k.tick >= 36000) lange++;
      const navn = `${bane}/${froe}`;
      assert.equal(k.tvungneFarer, 0, `${navn}: vagthunden greb ind ${k.tvungneFarer} gange på grund af farerne`);
      assert.ok(k.maxOpl < RO_VAGTHUND || k.tvungne > 0, navn);
      assert.equal(k.farerFoerRunde2, 0, `${navn}: fare før runde 2`);
      assert.equal(k.ildskadeIPausen, 0, `${navn}: ildskade i startpausen`);
      assert.equal(k.luftVedSkade, 0, `${navn}: en fare i luften ved SKADE`);
      assert.equal(k.frosset, 0, `${navn}: farerne bevægede sig uden for aktiv tid (${k.frosset})`);
      assert.equal(k.tidligLunte, 0, `${navn}: lunte fra en plet fra en tidligere tur`);
      assert.deepEqual(k.fejl, [], navn);
      assert.ok(k.maxFarer <= FA.FARE_MAKS, `${navn}: ${k.maxFarer} farer på én gang`);
      assert.ok(k.maxIld <= FA.ILD_MAKS, navn);
      farer += k.farer; brande += k.braende; ild += k.ild;
    }
    assert.ok(farer >= 8, `${bane}: kun ${farer} farer på 40 minutter`);
    assert.ok(lange >= 2, `${bane}: kun ${lange} kampe varede 10 minutter`);
  });
}
