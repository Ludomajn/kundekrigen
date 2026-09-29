/* Kundekrigen — test: farernes fysik og opførsel.
 *
 *   node --no-warnings --test test/farer_fysik.mjs
 *
 * 1. Pakken: FA.skridtPakke fra 200 og 420 wu over fortets lag lander altid
 *    på det øverste lag (physics.skridtFaldende prøver kun to punkter).
 * 2. Begravet: en Papirbunke, en Kabelbakke eller Byggeskum over en fare —
 *    fri efter ét aktivt tick.
 * 3. Skuddene: et projektil sprænger på Kabelsalaten, men ikke de første
 *    8 tick over skytten; Papirbunken og COVID flyver igennem; hoppende
 *    granater rører den ikke; klasket slår den væk uden at antænde.
 *    Scanneren antænder ikke en Kabelsalat, der ruller gennem skytten, når
 *    der sigtes væk fra den (den har ingen tolerance ved skytten), men et
 *    skud lige på den antænder den stadig.
 * 4. Pakkedronen: flyver over terrænet og aldrig i det, forsvinder ved
 *    kanten, LEVERET! med scanneren, nedskudt falder pakken, og dronen smælder.
 * 5. Robotstøvsugeren: vender ved væg, skrænt og kunde, æder kun banens miner
 *    (højst 2), overophedes og springer større for hver mine, tvangsopdateres,
 *    kortslutter i vandet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skridtFaldende } from '../static/js/sim/physics.js';
import { lavProjektil, lavKasse } from '../static/js/sim/entities.js';
import { mundingsPunkt } from '../static/js/sim/behaviours.js';
import { aktivVerden, FA, T, VAABEN, koer, kabelsalatPaaJorden, antaend, laegPlaceret, jordVed, frieSteder,
         sigtPaa, fritSyn, affyr } from './farer_hjaelp.mjs';

/** Et fladt stykke jord langt fra kunderne og banens ting. */
function fladPlads(v, fra = 350) {
  for (const p of frieSteder(v, fra)) {
    if ([...v.placerede, ...v.kasser].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 160)) continue;
    const g = [-80, -40, 0, 40, 80].map((dx) => jordVed(v, p.x + dx, p.y, 40));
    if (g.every((y) => Math.abs(y - p.y) < 10 && y > v.vandNiveau + 40) && !v.terraen.fast(p.x, p.y + 80)) return p;
  }
  return null;
}

test('pakken falder aldrig gennem fortets tynde lag (fejet fald)', () => {
  let fald = 0, gennemFejet = 0, gennemGammel = 0;
  for (const froe of [3, 7, 11, 19]) {
    const v = aktivVerden({ froe, bane: 'fort', hold: [2, 2] });
    const t = v.terraen;
    for (let x = 40; x < t.w - 40; x += 13) {
      const top = t.overflade(x);
      if (top < v.vandNiveau + 20) continue;
      for (const over of [200, 420]) {
        const y0 = Math.min(t.h - 4, top + over);
        const a = lavKasse(1, { slags: 'vaaben', indhold: 'grenroer', x, y: y0 });
        const b = lavKasse(2, { slags: 'vaaben', indhold: 'grenroer', x, y: y0 });
        for (let i = 0; i < 300 && !a.landet; i++) FA.skridtPakke(t, a);
        for (let i = 0; i < 300 && !b.landet; i++) skridtFaldende(t, b);
        fald++;
        // Øverste lag: det første faste under startpunktet.
        const lag = t.jordUnder(x, Math.round(y0));
        if (Math.round(a.y) !== lag + 1) gennemFejet++;
        if (Math.round(b.y) < lag - 1) gennemGammel++;
      }
    }
  }
  assert.ok(fald > 1000, `${fald} fald`);
  assert.equal(gennemFejet, 0, `${gennemFejet} af ${fald} pakker landede ikke på det øverste lag (skridtFaldende: ${gennemGammel})`);
});

test('begravet af Papirbunke, Kabelbakke eller Byggeskum: fri efter ét aktivt tick', () => {
  for (const hvad of ['papir', 'skum', 'rampe']) {
    for (const slags of ['kabelsalat', 'stoevsuger']) {
      const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
      const p = fladPlads(v, 250);
      const f = slags === 'kabelsalat' ? kabelsalatPaaJorden(v, p.x, p.y, { stille: true })
        : FA.tving(v, slags, { x: p.x, y: p.y, ret: 1 }, [], { pause: 1000 });
      const cx = Math.round(f.x), cy = Math.round(f.y + f.hy);
      if (hvad === 'papir') v.terraen.fyld(cx, cy, 36);
      else if (hvad === 'skum') v.terraen.fyld(cx, cy, 44);
      else v.terraen.bjaelke(cx, cy, 60, 5, 0.5);
      const fri = () => (slags === 'kabelsalat' ? FA.rundFri(v.terraen, f.x, f.y, f.r)
        : v.terraen && !v.terraen.fast(Math.round(f.x), Math.round(f.y) + 5));
      assert.ok(!fri(), `${hvad}/${slags}: ikke begravet i testen`);
      v.skridt();
      assert.ok(fri(), `${hvad}/${slags}: stadig begravet efter ét tick (y ${f.y})`);
    }
  }
});

/** Et projektil, som våbnet affyrer det, fra (x, y) med farten (vx, vy). */
function skud(v, vaaben, x, y, vx, vy, ejer = null) {
  const w = VAABEN[vaaben];
  const b = ejer != null ? v.baevere.find((q) => q.id === ejer) : null;
  const p = lavProjektil(v.nytId(), { x, y, vx, vy, r: w.projektil.r, vindFaktor: 0, hop: w.projektil.hop,
    rammerBaevere: w.projektil.rammerBaevere, detonation: w.detonation || null, fyld: w.fyld || null,
    smitte: w.smitte || null, klynge: w.klynge || null, lunte: w.projektil.lunte ? 120 : w.lunte ? 180 : -1,
    ejer, ejerHold: b?.hold ?? null, sprite: w.projektil.sprite });
  v.projektiler.push(p);
  return p;
}

test('skuddene: sprænger på Kabelsalaten; Papirbunken, COVID og granater går igennem', () => {
  const vaerdi = {};
  for (const vaaben of ['grenroer', 'papirbunke', 'covid', 'egegranat']) {
    const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
    v.vejr = 'solskin';
    const p = fladPlads(v, 250);
    const f = kabelsalatPaaJorden(v, p.x, p.y, { stille: true });
    // Vandret ind mod midten fra 120 wu.
    const q = skud(v, vaaben, f.x - 120, f.y + f.hy, 600, 0);
    let brag = null;
    koer(v, 30, { hvert: () => {}, stop: (vv, h) => { const e = h.find((x) => x.navn === 'eksplosion'); if (e) { brag = e; return true; } return false; } });
    vaerdi[vaaben] = { brag, antaendt: f.antaendt || !!f.ramt, q };
  }
  const g = vaerdi.grenroer;
  assert.ok(g.brag && Math.abs(g.brag.x - (g.q.x)) < 1, 'raketten sprang ikke');
  assert.ok(g.antaendt, 'raketten antændte ikke Kabelsalaten');
  for (const vaaben of ['papirbunke', 'covid', 'egegranat']) {
    assert.ok(!vaerdi[vaaben].antaendt, `${vaaben} antændte den`);
  }
});

test('skyttens pause: de første 8 tick sprænger skuddet ikke på en fare over skytten', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  const b = v.aktivBaever();
  const f = kabelsalatPaaJorden(v, b.x + 4, b.y, { stille: true });
  const q = skud(v, 'grenroer', b.x + 10, b.y + 20, 900, 150, b.id);
  let foerst = null;
  koer(v, 40, { stop: (vv, h) => { if (h.some((x) => x.navn === 'eksplosion')) { foerst = vv.tick; return true; } return false; } });
  assert.ok(Math.hypot(q.x - f.x, q.y - f.y) > f.r + 30, `skuddet sprang ved mundingen (${q.x - f.x}, ${q.y - f.y})`);
  // Uden skytten tæt på sprænger det samme skud på faren.
  const w = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  const b2 = w.aktivBaever();
  const f2 = kabelsalatPaaJorden(w, b2.x + 150, b2.y, { stille: true });
  const fx = f2.x;                     // braget skubber den bagefter
  skud(w, 'grenroer', fx - 30, f2.y + f2.hy, 900, 0, b2.id);
  const e = koer(w, 10).find((x) => x.navn === 'eksplosion');
  assert.ok(e && Math.abs(e.x - fx) < f2.r + 10, 'skuddet sprang ikke på faren');
});

test('scanneren antænder ikke en Kabelsalat, der ruller gennem skytten, når der sigtes væk fra den', () => {
  // Strålen starter ved mundingen, kun 22 wu fra skulderen, og Kabelsalatens
  // midte sidder i skulderhøjde: med tolerancen (FARE_STRAALE_TOL) blev den
  // "ramt" i afstand 0, braget kom ved fødderne, og scanningen var spildt.
  for (const vinkel of [0.7, 0.59, 0.99, 1.4]) {
    for (const medFjende of [false, true]) {
      const hvad = `${vinkel} rad${medFjende ? ' mod en fjende' : ''}`;
      const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
      v.vind = 0; v.vejr = 'solskin';
      const b = v.aktivBaever();
      const f = kabelsalatPaaJorden(v, b.x + 6, b.y, { stille: true, vx: 0 });
      koer(v, 40);                        // forbi ildens startpause
      b.retning = 1; b.vinkel = vinkel;
      const m = mundingsPunkt(b);
      // Forudsætningen: strålen går uden om kroppen, kun tolerancen rammer den.
      assert.equal(FA.foersteFare(v, m, m.dx, m.dy, 1100).fare, f, `${hvad}: tolerancen rammer den ikke`);
      assert.equal(FA.foersteFare(v, m, m.dx, m.dy, 1100, null, 0).fare, null, `${hvad}: strålen går gennem den`);
      let fj = null;
      if (medFjende) {
        // En fjende oppe til højre: brystet (y + 23) på strålen, 160 wu ude.
        fj = v.baevere.find((q) => q.hold !== b.hold && !q.doed);
        fj.x = m.x + m.dx * 160; fj.y = m.y + m.dy * 160 - 23; fj.vx = 0; fj.vy = 0;
      }
      const hp0 = b.hp;
      affyr(v, 'splintboesse', { vinkel, retning: 1 });
      const alle = koer(v, FA.KS_BRAND + 40);
      const st = alle.find((e) => e.navn === 'straale');
      assert.ok(st && st.fare == null, `${hvad}: strålen stoppede ved Kabelsalaten: ${JSON.stringify(st)}`);
      assert.ok(Math.hypot(st.x1 - st.x0, st.y1 - st.y0) > 30, `${hvad}: strålen stoppede ved mundingen`);
      if (medFjende) assert.equal(st.baever, fj.id, `${hvad}: fjenden blev ikke ramt`);
      assert.ok(!alle.some((e) => e.navn === 'fareAntaendt') && !f.antaendt, `${hvad}: Kabelsalaten blev antændt`);
      assert.equal(b.hp, hp0, `${hvad}: skytten tog skade`);
    }
  }
  // Et bevidst skud lige på den (lige foran mundingen) antænder den stadig.
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vind = 0;
  const b = v.aktivBaever();
  const f = kabelsalatPaaJorden(v, b.x + 24, b.y, { stille: true, vx: 0 });
  sigtPaa(b, f.x, f.y + f.hy);
  affyr(v, 'splintboesse', { vinkel: b.vinkel, retning: b.retning });
  const alle = koer(v, 3);
  assert.ok(alle.some((e) => e.navn === 'fareAntaendt' && e.id === f.id && e.aarsag === 'straale'), 'skuddet lige på den antændte den ikke');
});

test('klageklasket slår Kabelsalaten væk og antænder den ikke; støvsugeren vender', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  const b = v.aktivBaever();
  b.retning = 1;
  const f = kabelsalatPaaJorden(v, b.x + 20, b.y, { stille: true });
  affyr(v, 'halesmaek', { retning: 1 });
  const alle = koer(v, 20);
  const k = alle.find((e) => e.navn === 'klask');
  assert.ok(k?.farer?.includes(f.id), `klasket ramte ikke faren: ${JSON.stringify(k)}`);
  assert.ok(f.vx > 150 && f.tilst === 'luft' && !f.antaendt, `vx ${f.vx}, ${f.tilst}, antændt ${f.antaendt}`);
  const w = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  const b2 = w.aktivBaever();
  b2.retning = 1;
  const s = FA.tving(w, 'stoevsuger', { x: b2.x + 24, y: b2.y, ret: -1 }, [], { pause: 100 });
  affyr(w, 'halesmaek', { retning: 1 });
  koer(w, 20);
  assert.equal(s.ret, 1, 'støvsugeren vendte ikke');
});

test('Pakkedronen: flyver i DR_HOEJDE over terrænet, aldrig i det, og forsvinder ved kanten', () => {
  for (const bane of ['aaben', 'oeer', 'fort']) {
    for (const side of ['v', 'h']) {
      const v = aktivVerden({ froe: 9, bane, hold: [2, 1] });
      const d = FA.tving(v, 'drone', { side });
      let inde = 0, lavest = Infinity, vaek = null, n = 0;
      for (let i = 0; i < 60 * 70 && !vaek; i++) {
        for (const e of v.skridt()) if (e.navn === 'fareVaek') vaek = e.grund;
        if (vaek) break;
        n++;
        if (!FA.rundFri(v.terraen, d.x, d.y, d.r)) inde++;
        const xx = Math.round(d.x);
        if (xx > 0 && xx < v.terraen.w) lavest = Math.min(lavest, d.y - v.terraen.overflade(xx));
      }
      assert.equal(vaek, 'kant', `${bane}/${side}: ${vaek}`);
      assert.equal(inde, 0, `${bane}/${side}: ${inde} tick inde i terrænet`);
      assert.ok(lavest > 40, `${bane}/${side}: kun ${lavest.toFixed(0)} wu over terrænet`);
      assert.ok(n < FA.DR_LIV, `${bane}/${side}: ${n} tick`);
    }
  }
});

test('LEVERET!: scanneren giver skyttens klinik lasten, og dronen flyver videre', () => {
  const v = aktivVerden({ froe: 9, bane: 'aaben', hold: [2, 1] });
  const b = v.aktivBaever();
  const d = FA.tving(v, 'drone', { side: 'v', pakke: 'koglebombe' }, [], { x: b.x + 200, y: b.y + 150, hoejdeMaal: b.y + 150 });
  const foer = v.ammoFor(b.hold, 'koglebombe');
  assert.ok(fritSyn(v, b, d.x + d.vx / 60, d.y + d.hy), 'intet frit syn');
  affyr(v, 'splintboesse', { vinkel: b.vinkel, retning: b.retning });
  const alle = koer(v, 5);
  const lev = alle.find((e) => e.navn === 'fareLeveret');
  assert.ok(lev && lev.hold === b.hold && lev.baever === b.id && lev.vaaben === 'koglebombe', JSON.stringify(lev));
  assert.equal(v.ammoFor(b.hold, 'koglebombe'), foer + lev.antal);
  assert.ok(alle.some((e) => e.navn === 'ammoAendret' && e.vaaben === 'koglebombe'));
  assert.ok(d.pakke === null && !(d.styrt > 0) && v.farer.includes(d), 'dronen styrtede');
  assert.ok(!alle.some((e) => e.navn === 'skade'), 'scanningen skadede nogen');
});

test('nedskudt: pakken falder som en våbenkasse, dronen smælder med 2 pletter; uden plads konfetti', () => {
  for (const plads of [true, false]) {
    const v = aktivVerden({ froe: 9, bane: 'aaben', hold: [2, 1] });
    v.vejr = 'regn';
    const p = fladPlads(v, 300);
    if (!plads) for (let i = 0; i < 4; i++) v.kasser.push({ ...lavKasse(v.nytId(), { slags: 'vaaben', indhold: 'grenroer', x: 60 + i * 30, y: 2000 }), landet: true });
    const d = FA.tving(v, 'drone', { side: 'v', pakke: 'egegranat' }, [], { x: p.x, y: p.y + 250, hoejdeMaal: p.y + 250 });
    const b = v.aktivBaever();
    v.eksplosionsKoe.push({ x: d.x, y: d.y + d.hy - 10, radius: 30, skade: 0, knockback: 0, carve: false,
                            kilde: { kaedeId: 5, kildeHold: b.hold, kildeBaever: b.id, kaede: 0 } });
    const alle = koer(v, 400);
    const ned = alle.find((e) => e.navn === 'fareAntaendt');
    assert.ok(ned?.nedskudt && ned.kaede === 1 && ned.kildeBaever === b.id, JSON.stringify(ned));
    assert.equal(!!ned.konfetti, !plads);
    const fald = alle.find((e) => e.navn === 'kasseFalder' && e.fald);
    assert.equal(!!fald, plads, 'pakken');
    if (plads) {
      const k = v.kasser.find((q) => q.id === fald.id);
      assert.ok(k.landet && k.indhold === 'egegranat');
    }
    const vaek = alle.find((e) => e.navn === 'fareVaek');
    assert.equal(vaek?.grund, 'styrt');
    const brag = alle.find((e) => e.navn === 'eksplosion' && e.fare === 'drone');
    assert.ok(brag && brag.radius === FA.DR_BRAG.radius && brag.kaede === 1, JSON.stringify(brag));
    assert.ok(alle.filter((e) => e.navn === 'krater').length >= 1, 'intet krater');
  }
});

test('Robotstøvsugeren: vender ved væg, skrænt og kunde og falder ikke ned', () => {
  for (const bane of ['aaben', 'fort', 'hule']) {
    const v = aktivVerden({ froe: 6, bane, hold: [2, 2] });
    const S = FA.steder(v).stoevsuger;
    const p = S[0] || frieSteder(v, 200)[0];
    const s = FA.tving(v, 'stoevsuger', { x: p.x, y: p.y, ret: 1 });
    let vend = 0, sidst = s.ret, dybest = 0;
    const y0 = s.y;
    for (let i = 0; i < 60 * 30; i++) {
      v.skridt();
      if (!v.farer.includes(s)) break;
      if (s.ret !== sidst) { vend++; sidst = s.ret; }
      dybest = Math.max(dybest, y0 - s.y);
    }
    assert.ok(v.farer.includes(s), `${bane}: støvsugeren forsvandt`);
    assert.ok(vend >= 1, `${bane}: den vendte aldrig`);
    assert.ok(s.tilst === 'koer' && s.paaJorden, `${bane}: ${s.tilst}`);
  }
});

test('spamfilteret: kun banens miner, højst 2, og batteriet springer større for hver', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  v.vejr = 'regn';
  const p = fladPlads(v, 300);
  const s = FA.tving(v, 'stoevsuger', { x: p.x, y: p.y, ret: 1 });
  const egen = laegPlaceret(v, 'mine', p.x + 30, p.y);
  egen.ejer = v.aktivBaever().id; egen.ejerHold = 0;
  const miner = [laegPlaceret(v, 'mine', p.x + 50, p.y), laegPlaceret(v, 'mine', p.x + 70, p.y), laegPlaceret(v, 'mine', p.x + 90, p.y)];
  for (const m of [egen, ...miner]) m.naerhed = 0;           // ingen går af af kunderne i testen
  const alle = koer(v, 400);
  const spist = alle.filter((e) => e.navn === 'fareSpiste').map((e) => e.mine);
  assert.deepEqual(spist, [miner[0].id, miner[1].id], `spiste ${spist}`);
  assert.ok(!egen.doed && v.placerede.includes(egen), 'den åd spillerens egen mine');
  assert.ok(!miner[2].doed, 'den åd en tredje');
  assert.equal(s.spam, 2);
  antaend(v, s);
  const efter = koer(v, FA.RS_OVERHED + 20);
  assert.ok(efter.some((e) => e.navn === 'fareAntaendt' && e.slags === 'stoevsuger'));
  const brag = efter.find((e) => e.navn === 'eksplosion' && e.fare === 'stoevsuger');
  assert.ok(brag && brag.radius === FA.RS_BATTERI.radius + 2 * FA.RS_SPAM_R, JSON.stringify(brag));
  assert.ok(efter.some((e) => e.navn === 'fareVaek' && e.grund === 'brag'));
});

test('tvangsopdateringen sætter støvsugeren på pause; vandet kortslutter den', () => {
  const v = aktivVerden({ froe: 5, bane: 'aaben', hold: [2, 1] });
  const b = v.aktivBaever();
  const s = FA.tving(v, 'stoevsuger', { x: b.x + 70, y: jordVed(v, b.x + 70, b.y), ret: 1 }, [], { pause: 5 });
  sigtPaa(b, s.x, s.y + s.hy);
  affyr(v, 'daemningsdynamit', { vinkel: b.vinkel, retning: b.retning });
  const alle = koer(v, 3);
  assert.ok(alle.some((e) => e.navn === 'fareOpdateres' && e.id === s.id), 'ingen tvangsopdatering');
  assert.ok(!alle.some((e) => e.navn === 'opdateringRamt'), 'strålen ramte en kunde');
  const x0 = s.x;
  koer(v, 200);
  assert.ok(Math.abs(s.x - x0) < 1 && s.tilst === 'pause', `den kørte (${s.x - x0}) i pausen`);
  koer(v, FA.RS_OPDATERING);
  assert.equal(s.tilst, 'koer');
  // Over åbent hav: den falder i og kortslutter uden brag.
  const t = v.terraen;
  let x = 200;
  while (x < t.w - 200 && t.overflade(x) > v.vandNiveau - 60) x += 20;
  s.x = x; s.y = v.vandNiveau + 40; s.paaJorden = false;
  const efter = koer(v, 60);
  const vaek = efter.find((e) => e.navn === 'fareVaek');
  assert.equal(vaek?.grund, 'kortsluttet');
  assert.ok(!efter.some((e) => e.navn === 'eksplosion'), 'den sprang i vandet');
});
