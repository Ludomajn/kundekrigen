/* Kundekrigen — test: enhver kæde slutter, og alt er begrænset.
 *
 *   node --no-warnings --test test/farer_kaede.mjs
 *
 * 1. Det patologiske kort: en brændende Kabelsalat midt i en klump printere,
 *    miner og kunder. Opløsningen slutter inden for 1500 tick, der er aldrig
 *    over ILD_MAKS pletter, dybden er højst KAEDE_MAKS, og hver ting springer
 *    højst én gang. 200 opstillinger trukket med lavRng.
 * 2. Regn og slud: ingen spredning og halv levetid. Sne: ingen spredning.
 * 3. Vandet: en brændende Kabelsalat, der rammer vandet, er slukket uden brag.
 * 4. Kraftfeltet: ingen ildskade og ingen skjoldBlok fra ild.
 * 5. Kæden: skud → brand → flammebrag → ild → printer bærer skyttens kaedeId,
 *    kildeHold og kildeBaever, og dybden stiger ét led ad gangen.
 * 6. Dvalen: en mine, som ilden tændte, og som vagthunden (tvungenRo) har
 *    slukket, er sin egen start, når en kunde senere går ind på den — ikke
 *    ildens gamle kæde. Brænder lunten ud, bærer braget ildens kæde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavRng } from '../static/js/core/rng.js';
import { RO_VAGTHUND, tvungenRo } from '../static/js/sim/turn.js';
import { aktivVerden, FA, T, koer, kabelsalatPaaJorden, antaend, laegPlaceret, jordVed, frieSteder } from './farer_hjaelp.mjs';

/** Afslut turen (Sæt på hold) og kør til SKADE — eller til loftet. */
function tilSkade(v, loft = 2000) {
  const b = v.aktivBaever();
  v.udfoerKommando({ k: 'handling', h: 'staaOver' }, b?.ejer);
  const start = v.tick;
  let maksIld = 0;
  const alle = koer(v, loft, { stop: (vv) => { maksIld = Math.max(maksIld, vv.ild.length); return vv.tur.tilstand === T.SKADE || vv.tur.tilstand === T.SEJR; } });
  return { alle, ticks: v.tick - start, maksIld };
}

/** En plads langt fra kunderne på et stykke jord, der er fladt nok. */
function fladPlads(v, fra = 350) {
  const t = v.terraen;
  for (const p of frieSteder(v, fra)) {
    if ([...v.placerede, ...v.kasser].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 160)) continue;
    const g = [-60, -30, 0, 30, 60].map((dx) => jordVed(v, p.x + dx, p.y, 40));
    if (g.every((y) => Math.abs(y - p.y) < 12 && y > v.vandNiveau + 40) && !t.fast(p.x, p.y + 60)) return p;
  }
  return null;
}

test('det patologiske kort: 200 opstillinger slutter, og alt er begrænset', () => {
  const rng = lavRng(20260928);
  const baner = ['aaben', 'oeer', 'hule', 'fort'];
  let braende = 0, printere = 0, lunter = 0, maksIld = 0, maksKaede = 0, fuldIld = 0;
  for (let n = 0; n < 200; n++) {
    const bane = baner[n % 4];
    const v = aktivVerden({ froe: 1 + Math.floor(rng() * 40), bane, hold: [2, 2] });
    v.vejr = ['solskin', 'overskyet', 'taage', 'regn', 'sne'][Math.floor(rng() * 5)];
    v.vind = Math.round((rng() - 0.5) * 2 * 20) / 20;
    const p = fladPlads(v, 150 + rng() * 200) || frieSteder(v, 100)[0];
    if (!p) continue;
    // Kabelsalaten (eller støvsugeren) midt i en klump printere og miner.
    const slags = rng() < 0.75 ? 'kabelsalat' : 'stoevsuger';
    const f = slags === 'kabelsalat' ? kabelsalatPaaJorden(v, p.x, p.y)
      : FA.tving(v, 'stoevsuger', { x: p.x, y: p.y, ret: 1 });
    const antal = 3 + Math.floor(rng() * 8);
    const placerede = [];
    for (let i = 0; i < antal; i++) {
      placerede.push(laegPlaceret(v, rng() < 0.5 ? 'toende' : 'mine', p.x + (rng() - 0.5) * 360, p.y));
    }
    // Lidt ild i forvejen, som en tidligere brand.
    for (let i = 0; i < Math.floor(rng() * 12); i++) FA.taendIld(v, p.x + (rng() - 0.5) * 400, p.y, Math.floor(rng() * 3), { kaede: Math.floor(rng() * 5) }, []);
    antaend(v, f);
    const { alle, ticks, maksIld: mi } = tilSkade(v, 1500);
    const navn = `${bane}/${n}`;
    maksIld = Math.max(maksIld, mi);
    assert.ok(mi <= FA.ILD_MAKS, `${navn}: ${mi} pletter`);
    assert.equal(v.tur.tilstand, T.SKADE, `${navn}: opløsningen sluttede ikke inden for 1500 tick (${v.tur.tilstand})`);
    assert.ok(ticks < RO_VAGTHUND, `${navn}: ${ticks} tick`);
    assert.ok(!alle.some((e) => e.navn === 'tvungenRo'), `${navn}: vagthunden greb ind`);
    // Hver ting antændes og springer højst én gang.
    const antaendt = alle.filter((e) => e.navn === 'fareAntaendt');
    assert.ok(antaendt.length <= 1, `${navn}: faren blev antændt ${antaendt.length} gange`);
    const brag = alle.filter((e) => e.navn === 'eksplosion').length;
    assert.ok(brag <= placerede.length + v.kasser.length + 1 + v.baevere.length + 6,
      `${navn}: ${brag} brag fra ${placerede.length} ting`);
    for (const e of alle) {
      if (e.navn === 'fareAntaendt' || e.navn === 'ildTaendt') maksKaede = Math.max(maksKaede, e.kaede);
    }
    for (const q of placerede) if (q.kaede) maksKaede = Math.max(maksKaede, q.kaede);
    for (const q of v.placerede) assert.ok(!(q.lunte > 0), `${navn}: en lunte brænder stadig ved SKADE`);
    braende += antaendt.length;
    printere += alle.filter((e) => e.navn === 'printerSprang').length;
    lunter += placerede.filter((q) => q.antaendt).length;
    if (mi === FA.ILD_MAKS) fuldIld++;
  }
  assert.ok(maksKaede <= FA.KAEDE_MAKS, `dybden nåede ${maksKaede}`);
  // Scenarierne skal faktisk opstå, ellers beviser testen intet.
  assert.ok(braende > 100, `kun ${braende} brande`);
  assert.ok(printere > 20, `kun ${printere} printere sprang`);
  assert.ok(lunter > 10, `kun ${lunter} ting fik lunte af ilden`);
});

test('pletterne holder sig under ILD_MAKS, selv når alt brænder', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'solskin'; v.vind = 0;
  const p = fladPlads(v, 200);
  // Over hele banen, på jorden under hver celle (søgt oppefra).
  for (let i = 0; i < 80; i++) { const x = p.x - 900 + i * 24; FA.taendIld(v, x, jordVed(v, x, p.y, 300), 0, null, []); }
  assert.equal(v.ild.length, FA.ILD_MAKS, `${v.ild.length} pletter: loftet blev ikke nået`);
  let maks = 0;
  koer(v, 200, { hvert: (vv) => { maks = Math.max(maks, vv.ild.length); } });
  assert.ok(maks <= FA.ILD_MAKS, `${maks} pletter`);
  // Og ilden er endelig: efter højst ILD_LIV + 45 + 2·45 tick er den væk.
  koer(v, FA.ILD_LIV + 45 + 2 * FA.ILD_SPRED_ALDER + 10 - 200);
  assert.equal(v.ild.length, 0, 'ilden brændte ikke ud');
});

test('vejret: regn og slud giver halv levetid og ingen spredning, sne ingen spredning', () => {
  for (const vejr of ['solskin', 'regn', 'slud', 'sne']) {
    const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
    v.vejr = vejr; v.vind = 0.5;
    const p = fladPlads(v, 200);
    const plet = FA.taendIld(v, p.x, p.y, 0, null, []);
    assert.ok(plet, `${vejr}: ingen plet`);
    let maks = 0, levede = 0;
    for (let i = 0; i < 400; i++) {
      v.skridt();
      maks = Math.max(maks, v.ild.length);
      if (v.ild.includes(plet)) levede = i + 1;
    }
    if (vejr === 'solskin') {
      assert.ok(maks >= 2, `solskin: ilden spredte sig ikke (${maks})`);
      assert.ok(levede >= FA.ILD_LIV - 1, `solskin: levede kun ${levede}`);
    } else {
      assert.equal(maks, 1, `${vejr}: ilden spredte sig`);
      if (vejr !== 'sne') assert.ok(levede <= plet.liv / 2 + 1 && levede >= plet.liv / 2 - 1, `${vejr}: levede ${levede} af ${plet.liv}`);
    }
  }
});

test('ilden spreder sig i vindens retning, begge veje i vindstille, højst to generationer', () => {
  for (const vind of [0.6, -0.6, 0]) {
    const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
    v.vejr = 'solskin'; v.vind = vind;
    const p = fladPlads(v, 250);
    const x0 = Math.round(p.x / FA.ILD_CELLE) * FA.ILD_CELLE;
    FA.taendIld(v, x0, p.y, 0, null, []);
    const set = new Set();
    koer(v, 200, { hvert: (vv) => { for (const q of vv.ild) set.add(q.x - x0); } });
    const dx = [...set].sort((a, b) => a - b);
    const C = FA.ILD_CELLE;
    if (vind > 0) assert.deepEqual(dx, [0, C, 2 * C], `vind ${vind}: ${dx}`);
    else if (vind < 0) assert.deepEqual(dx, [-2 * C, -C, 0], `vind ${vind}: ${dx}`);
    else assert.deepEqual(dx, [-2 * C, -C, 0, C, 2 * C], `vindstille: ${dx}`);
  }
});

test('vandet: en brændende Kabelsalat slukkes uden brag, ild under vandet går ud', () => {
  const v = aktivVerden({ froe: 7, bane: 'oeer', hold: [2, 1] });
  const t = v.terraen;
  // En kolonne med åbent hav under sig.
  let x = null;
  for (let xx = 200; xx < t.w - 200 && x == null; xx += 40) {
    if (t.overflade(xx) < v.vandNiveau - 60 && v.baevere.every((b) => Math.abs(b.x - xx) > 300)) x = xx;
  }
  assert.ok(x != null, 'intet hav');
  const f = FA.tving(v, 'kabelsalat', { x, y: v.vandNiveau + 30, ret: 1 });
  antaend(v, f);
  const alle = koer(v, 200);
  const vaek = alle.find((e) => e.navn === 'fareVaek' && e.id === f.id);
  assert.equal(vaek?.grund, 'slukket', JSON.stringify(vaek));
  assert.ok(!alle.some((e) => e.navn === 'eksplosion'), 'den sprang i vandet');
  // Antændt, mens den allerede flyder: også slukket med det samme.
  const g = FA.tving(v, 'kabelsalat', { x, y: v.vandNiveau + 30, ret: 1 });
  const flyder = koer(v, 200, { stop: () => g.tilst === 'vand' });
  assert.equal(g.tilst, 'vand', 'den flyder ikke');
  assert.ok(!flyder.some((e) => e.navn === 'fareVaek'));
  antaend(v, g);
  const efter = koer(v, 5);
  assert.equal(efter.find((e) => e.navn === 'fareVaek' && e.id === g.id)?.grund, 'slukket');
  assert.ok(!efter.some((e) => e.navn === 'eksplosion') && !v.farer.includes(g), 'den brændte videre i vandet');
  // Vandet stiger over en plet: den går ud ved næste 10.-tick.
  const p = fladPlads(v, 100);
  const plet = FA.taendIld(v, p.x, p.y, 0, null, []);
  v.vandNiveau = plet.y + 5;
  koer(v, 11);
  assert.ok(!v.ild.includes(plet), 'pletten brænder under vandet');
});

test('kraftfeltet holder ilden ude uden skjoldBlok; startpausen skåner den aktive kunde', () => {
  const v = aktivVerden({ froe: 9, bane: 'aaben', hold: [2, 2] });
  v.vejr = 'regn';                       // ingen spredning, så kun pletterne under dem brænder
  const [a, b] = v.baevere.filter((x) => x.id !== v.tur.baeverId);
  b.skjold = true;
  for (const k of [a, b]) FA.taendIld(v, k.x, k.y, 2, null, []);
  const alle = koer(v, 200);
  const ild = alle.filter((e) => e.aarsag === 'ild');
  assert.ok(ild.some((e) => e.navn === 'skade' && e.baever === a.id), 'kunden i ilden tog ingen skade');
  assert.ok(!ild.some((e) => e.baever === b.id), `kraftfeltet: ${JSON.stringify(ild.filter((e) => e.baever === b.id))}`);
  assert.ok(!alle.some((e) => e.navn === 'skjoldBlok'), 'ilden gav en skjoldBlok');
  assert.ok(ild.every((e) => e.navn === 'skade' && e.skade <= FA.ILD_SKADE));
  assert.ok(a.ildTur <= FA.ILD_LOFT);
});

test('kæden: skud → brand → flammebrag → ild → printer bærer skytten, ét led ad gangen', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'solskin'; v.vind = 0;
  const skytte = v.aktivBaever();
  const p = fladPlads(v, 300);
  const f = kabelsalatPaaJorden(v, p.x, p.y, { stille: true });
  const printer = laegPlaceret(v, 'toende', p.x + 2 * FA.ILD_CELLE + 60, p.y);
  // Et skud (dybde 0) sprænger ved faren.
  v.eksplosionsKoe.push({ x: f.x, y: f.y + f.hy, radius: 20, skade: 0, knockback: 0, carve: false,
                          kilde: { kaedeId: 777, kildeHold: skytte.hold, kildeBaever: skytte.id, kaede: 0 } });
  const { alle } = tilSkade(v, 1500);
  const ant = alle.find((e) => e.navn === 'fareAntaendt');
  assert.ok(ant, 'faren blev ikke antændt');
  assert.deepEqual([ant.kaede, ant.kaedeId, ant.kildeHold, ant.kildeBaever], [1, 777, skytte.hold, skytte.id]);
  const flamme = alle.find((e) => e.navn === 'eksplosion' && e.fare === 'kabelsalat');
  assert.ok(flamme && flamme.kaede === 1 && flamme.kaedeId === 777, JSON.stringify(flamme));
  assert.ok(printer.antaendt && printer.kaede === 2 && printer.kaedeId === 777, `printeren: ${JSON.stringify(printer)}`);
  const sprang = alle.find((e) => e.navn === 'printerSprang');
  assert.ok(sprang && sprang.kaede === 2 && sprang.kildeBaever === skytte.id, JSON.stringify(sprang));
  // Det hele skete i skyttens tur: SKADE kom først efter printeren.
  assert.ok(alle.findIndex((e) => e.navn === 'printerSprang') >= 0 && v.tur.tilstand === T.SKADE);
});

test('dybden: en antændelse dybere end KAEDE_MAKS sker ikke', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'regn';
  const p = fladPlads(v, 300);
  const f = kabelsalatPaaJorden(v, p.x, p.y, { stille: true });
  FA.taendIld(v, f.x, f.y, 2, { kaede: FA.KAEDE_MAKS }, []);
  const printer = laegPlaceret(v, 'mine', f.x + 8, p.y);
  printer.naerhed = 0;
  koer(v, 30);
  assert.ok(!f.antaendt && !(f.brand > 0), 'faren blev antændt på dybde 6');
  assert.ok(!printer.antaendt, 'minen fik lunte på dybde 6');
  const f2 = kabelsalatPaaJorden(v, p.x + 200, p.y, { stille: true });
  FA.taendIld(v, f2.x, f2.y, 2, { kaede: FA.KAEDE_MAKS - 1 }, []);
  koer(v, 5);
  assert.ok(f2.antaendt && f2.kaede === FA.KAEDE_MAKS, `dybde ${f2.kaede}`);
});

test('dvalen: en mine, som vagthunden slukkede, er sin egen start, når en kunde senere går ind på den', () => {
  const ild = (b) => ({ kaedeId: 4242, kildeHold: b.hold, kildeBaever: b.id, kaede: 1 });
  // Kontrollen: brænder lunten ud, bærer minens brag ildens kæde, ét led dybere.
  const w = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  w.vejr = 'solskin'; w.vind = 0;
  const pw = fladPlads(w, 250);
  const mw = laegPlaceret(w, 'mine', pw.x, pw.y);
  mw.naerhed = 0;
  FA.taendIld(w, mw.x, mw.y, 0, ild(w.aktivBaever()), []);
  const ew = koer(w, FA.ILD_LUNTE.mine + 10).find((e) => e.navn === 'eksplosion');
  assert.ok(ew && ew.kaedeId === 4242 && ew.kaede === 2 && ew.kildeBaever === w.aktivBaever().id, `lunten: ${JSON.stringify(ew)}`);

  // Dvalen: vagthunden slukker lunten midt i den; turer senere går en fjende ind på minen.
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'solskin'; v.vind = 0;
  const skytte = v.aktivBaever();
  const p = fladPlads(v, 250);
  const mine = laegPlaceret(v, 'mine', p.x, p.y);
  FA.taendIld(v, mine.x, mine.y, 0, ild(skytte), []);
  koer(v, 2);
  assert.ok(mine.lunte > 0 && mine.antaendt && mine.kaedeId === 4242 && mine.kaede === 2, `ikke tændt: ${JSON.stringify(mine)}`);
  tvungenRo(v, []);
  v.ild.length = 0;
  assert.equal(mine.lunte, 0, 'tvungenRo slukkede ikke lunten');
  koer(v, 30);
  assert.ok(v.placerede.includes(mine) && !mine.doed, 'minen gik af i dvalen');
  const fj = v.baevere.find((q) => q.hold !== skytte.hold && !q.doed);
  fj.x = mine.x; fj.y = mine.y; fj.vx = 0; fj.vy = 0; fj.paaJorden = true;
  const alle = koer(v, 5);
  const e = alle.find((x) => x.navn === 'eksplosion');
  assert.ok(e, 'minen gik ikke af');
  assert.deepEqual([e.kaedeId, e.kaede, e.kildeHold, e.kildeBaever], [mine.id, 0, null, null], `braget: ${JSON.stringify(e)}`);
  const skade = alle.filter((x) => x.navn === 'skade' && x.baever === fj.id);
  assert.ok(skade.length && skade.every((x) => x.kaedeId === mine.id && x.kaede === 0), `skaden: ${JSON.stringify(skade)}`);
});
