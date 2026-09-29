/* Kundekrigen — test: farerne i brugerfladen (ui/farer.js) og main.js' kroge.
 *
 *   node --no-warnings --test test/farer_vis_ui.mjs
 *
 * I en lille falsk DOM med falsk lyd, fx, HUD og kamera (farer_vis_hjaelp.mjs):
 * 1. Varslet: bannerets tekst og pil (retningen), varslets lyd på normal
 *    kanal (aldrig vigtig, D9), Nullermandens egen lyd, og kantpilen: i
 *    kanten mod stedet, over stedet i billedet, pulserende under varslet.
 * 2. Faren er her: pilen kun uden for billedet (stille efter 6 s, fuld igen i
 *    brand), navneskiltet i 5 s, "SKYD MIG!" én gang pr. profil og slags.
 * 3. Ordene og lydene: KORTSLUTNING!, OVEROPHEDET!, NEDSKUDT!/KONFETTI!,
 *    LEVERET!, GENSTART!, PSST, BZZT!, plasket; NOM højst hver anden gang.
 * 4. En lyd, der kommer, mens kanalen er optaget, venter på en fri kanal
 *    (og lader de vigtige gå først) og falder bort efter fristen.
 * 5. KÆDE ×n! ved kaede >= 2.
 * 6. SYGT PLAY!: én gang pr. kæde; 2 fjender skadet (egne tæller ikke) eller
 *    én dræbt (også druknet i samme tur); en fare eller ild i kæden, eller 2
 *    led; banneret navngiver skytten; speakeren, når optagelsen findes.
 * 7. Kameraet: intet i SPILLER_AKTIV; i OPLOESNING uden skud et glimt
 *    (rammeInd), højst hvert 2. s; og kun kald, som kameraets API har. Under
 *    nedslagets hold venter glimtet og kommer helt bagefter (med det rigtige
 *    kamera: ét helt glimt, ingen rest, der pumper zoomen).
 * 8. Ildens knitren: løkken efter afstanden, og aldrig uden for kampen.
 *    Pilen og skiltet: væk under sejren og i menuen (også et frosset varsel),
 *    og ikonet i pilen har farve (.fp-ikon fylder med currentColor).
 * 9. main.js' kroge (skåret ud af kildekoden): ingen lyd og kun én replik pr.
 *    tur for ild, rosen kun for skyttens egen kæde, kun rystelse ved et
 *    kædebrag under sigtet, og "Pakken falder!".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavBus } from '../static/js/core/bus.js';
import { kobFarer } from '../static/js/ui/farer.js';
import { lavKamera } from '../static/js/render/camera.js';
import { SPEAKER_SENERE, ALLE_STEMMER } from '../static/js/ui/stemmer.js';
import { T as TIL } from '../static/js/sim/turn.js';
import { lavFalskRenderer, lavBane, lavOpsaetning, lavFigur, iBilledet } from './kamera_hjaelp.mjs';
import { falskDom, falskFx, falskLyd, falskHud, falskKamera, falskRenderer, kilde } from './farer_vis_hjaelp.mjs';

// Uret: spilSnart, glimtet og skiltet læser performance.now().
const ur = { ms: 1e6 };
performance.now = () => ur.ms;
const frem = (ms, ui, v) => { const n = Math.max(1, Math.round(ms / 16)); for (let i = 0; i < n; i++) { ur.ms += ms / n; ui?.opdater(v); } };

const kunde = (id, hold, x, y, navn) => ({ id, hold, x, y, navn, doed: false });

/** En brugerflade på et falsk spejl. Kameraet står i (1000, 650): billedet er
 *  x 500-1500 (1600 px) og y 420-880 (900 px). */
function lavUi({ tilstand = TIL.SPILLER_AKTIV, lager = null } = {}) {
  const dom = falskDom();
  if (lager) for (const [k, v] of lager) dom.lager.set(k, v);
  const bus = lavBus(), fx = falskFx(), lyd = falskLyd(), hud = falskHud(), kamera = falskKamera();
  const r = falskRenderer({ cx: 1000, cy: 650 });
  const vist = [];
  const farer = {
    haendelser: [], blusset: [],
    haendelse(navn, e) { this.haendelser.push([navn, e]); },
    blus(x, y) { this.blusset.push([x, y]); },
    vist: (id) => v.farer.find((f) => f.id === id) || null,
  };
  const v = {
    farer: [], ild: [], farePlan: { varsel: null }, vandNiveau: 300,
    baevere: [kunde(1, 0, 900, 601, 'Ingrid'), kunde(2, 1, 1100, 601, 'Jan'), kunde(3, 1, 1200, 601, 'Hansen'),
              kunde(4, 0, 800, 601, 'Bente')],
    tur: { tilstand, turNr: 4, baeverId: 1 },
    aktivBaever() { return this.baevere[0]; },
  };
  const S = { verden: v, tilstand: 'spil', skudId: null };
  const ui = kobFarer({ bus, hud, lyd, visning: { fx, farer, kamera }, S, r, rod: dom.rod });
  const pil = dom.rod.boern[0].querySelector('.fare-pil');
  const skilt = dom.rod.boern[0].querySelector('.fare-skilt');
  return { dom, bus, fx, lyd, hud, kamera, r, farer, v, S, ui, pil, skilt, vist,
           opdater: () => ui.opdater(v), send: (n, e) => bus.send(n, { navn: n, ...e }) };
}
const pilXY = (pil) => {
  const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(pil.style.transform);
  return m ? { x: +m[1], y: +m[2] } : null;
};
const pilVinkel = (u) => +/rotate\((-?[\d.]+)deg\)/.exec(u.dom.rod.boern[0].querySelector('.fp-spids').style.transform)[1];
const ks = (o = {}) => ({ id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x: 1100, y: 601, r: 14, hy: 15, tilst: 'jord',
                          ret: 1, brand: 0, styrt: 0, pakke: null, spam: 0, ...o });

test('varslet: banneret, lyden på normal kanal og pilen', () => {
  const u = lavUi();
  u.send('fareVarsel', { slags: 'kabelsalat', hud: 'kabelsalat', x: 2200, y: 700, ret: -1, rest: 180 });
  assert.deepEqual(u.hud.bannere[0], { tekst: 'KABELSALAT ← · Skyd den, så går den i brand', ms: 2800, klasse: 'advarsel' });
  const l = u.lyd.spillet[0];
  assert.equal(l.navn, 'fare_kabelsalat');
  assert.ok(!l.vigtig, 'varslet er ikke vigtigt (D9)');
  assert.equal(l.maksSek, 1.5);
  assert.ok(l.pan > 0.5, 'til højre, hvor den kommer');
  for (const [hud, slags, ret, tekst, lyd] of [
    ['nullermand', 'kabelsalat', 1, 'NULLERMAND! En støvtot drysser ned fra loftet · meget brændbar', 'fare_nullermand'],
    ['pakkedrone', 'drone', 1, 'PAKKEDRONE → · Skyd pakken ned, eller scan den, så er den din', 'fare_drone'],
    ['robotstoevsuger', 'stoevsuger', 1, 'ROBOTSTØVSUGEREN ER VÅGNET · Den æder mails, og batteriet tåler ikke skud', 'fare_stoevsuger'],
  ]) {
    u.send('fareVarsel', { slags, hud, x: 900, y: 650, ret, rest: 180 });
    assert.equal(u.hud.bannere.at(-1).tekst, tekst);
    assert.equal(u.lyd.spillet.at(-1).navn, lyd);
    assert.ok(!u.lyd.spillet.at(-1).vigtig);
  }
  // Pilen: stedet er til højre uden for billedet -> i højre kant, pegende mod højre.
  u.v.farePlan.varsel = { slags: 'kabelsalat', hud: 'kabelsalat', x: 2200, y: 700, ret: -1, rest: 120 };
  u.opdater();
  assert.ok(!u.pil.classList.contains('hide'), 'pilen vises');
  assert.ok(u.pil.classList.contains('varsel'), 'og pulserer under varslet');
  const p = pilXY(u.pil);
  assert.ok(p.x >= 1600 - 44 - 1 && p.x <= 1600 - 44 + 1 && p.y > 104 && p.y < 900 - 180, `i højre kant (${p.x}, ${p.y})`);
  assert.ok(Math.abs(pilVinkel(u)) <= 10, `peger mod højre (${pilVinkel(u)}°)`);
  const brug = u.dom.rod.boern[0].querySelector('.fp-ikon use');
  assert.equal(brug.attr.href, '#i-kabelsalat');
  // Dronen fra venstre kant, højt oppe: i venstre side og ikonet er dronens.
  u.v.farePlan.varsel = { slags: 'drone', hud: 'pakkedrone', x: -60, y: 1000, ret: 1, rest: 120 };
  u.opdater();
  const q = pilXY(u.pil);
  assert.ok(q.x < 800 && q.y <= 900 / 2, `op mod venstre (${q.x}, ${q.y})`);
  assert.equal(brug.attr.href, '#i-drone');
  // Stedet er i billedet: pilen står over det og peger ned.
  u.v.farePlan.varsel = { slags: 'stoevsuger', hud: 'robotstoevsuger', x: 1100, y: 600, ret: 1, rest: 120 };
  u.opdater();
  const s = u.r.tilSkaerm(1100, 600);
  const o = pilXY(u.pil);
  assert.ok(Math.abs(o.x - s.x) < 1 && o.y < s.y - 40, `over stedet (${o.x}, ${o.y}) mod (${s.x}, ${s.y})`);
  assert.equal(pilVinkel(u), 90, 'peger ned');
  assert.equal(brug.attr.href, '#i-stoevsuger');
  u.v.farePlan.varsel = null;
  u.opdater();
  assert.ok(u.pil.classList.contains('hide'), 'væk, når varslet er slut og ingen fare er kommet');
});

test('faren er her: pilen kun uden for billedet, skiltet i 5 s, SKYD MIG! én gang', () => {
  const u = lavUi();
  const f = ks();
  u.send('fareKommer', { id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x: f.x, y: f.y, ret: 1, pakke: null });
  u.v.farer = [f];
  u.opdater();
  assert.ok(u.pil.classList.contains('hide'), 'i billedet: ingen pil');
  assert.ok(!u.skilt.classList.contains('hide') && u.skilt.textContent === 'Kabelsalaten', 'navneskiltet');
  assert.equal(u.fx.ord.filter((o) => o.tekst === 'SKYD MIG!').length, 1, 'SKYD MIG! første gang');
  assert.equal(u.dom.lager.get('kk_fare_set_kabelsalat'), '1');
  frem(3000, u.ui, u.v);
  assert.ok(!u.skilt.classList.contains('hide'), 'skiltet står stadig efter 3 s');
  frem(2200, u.ui, u.v);
  assert.ok(u.skilt.classList.contains('hide'), 'og er væk efter 5 s');
  assert.equal(u.fx.ord.filter((o) => o.tekst === 'SKYD MIG!').length, 1, 'kun én gang');
  // Uden for billedet: pilen i kanten, stille efter 6 s, fuld igen, når den brænder.
  f.x = 2600;
  u.opdater();
  assert.ok(!u.pil.classList.contains('hide') && !u.pil.classList.contains('varsel') && !u.pil.classList.contains('stille'));
  frem(1500, u.ui, u.v);
  assert.ok(u.pil.classList.contains('stille'), 'stille, når den længe har været der');
  f.brand = 60;
  u.opdater();
  assert.ok(!u.pil.classList.contains('stille'), 'fuld igen, når den brænder');
  // Profilen husker den: næste kamp, samme slags, ingen SKYD MIG!.
  const w = lavUi({ lager: u.dom.lager });
  w.send('fareKommer', { id: 9, slags: 'kabelsalat', hud: 'kabelsalat', x: 1100, y: 601, ret: 1 });
  w.v.farer = [ks({ id: 9 })];
  w.opdater();
  assert.equal(w.fx.ord.filter((o) => o.tekst === 'SKYD MIG!').length, 0);
  // En anden slags er ny.
  w.v.farer = [ks({ id: 10, slags: 'stoevsuger', hud: 'robotstoevsuger', hy: 7, tilst: 'koer' })];
  w.send('fareKommer', { id: 10, slags: 'stoevsuger', hud: 'robotstoevsuger', x: 1100, y: 601, ret: 1 });
  w.opdater();
  assert.equal(w.fx.ord.filter((o) => o.tekst === 'SKYD MIG!').length, 1);
  assert.equal(w.skilt.textContent, 'Rune · robotstøvsuger');
});

test('ordene og lydene', () => {
  const u = lavUi();
  const ord = () => u.fx.ord.map((o) => o.tekst);
  const lyde = () => u.lyd.spillet.map((l) => l.navn);
  u.send('fareAntaendt', { id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x: 1000, y: 601, aarsag: 'eksplosion' });
  u.send('fareAntaendt', { id: 8, slags: 'stoevsuger', hud: 'robotstoevsuger', x: 1000, y: 601, aarsag: 'straale' });
  u.send('fareAntaendt', { id: 9, slags: 'drone', hud: 'pakkedrone', x: 1000, y: 800, nedskudt: true, kasse: 3, konfetti: false });
  u.send('fareAntaendt', { id: 9, slags: 'drone', hud: 'pakkedrone', x: 1000, y: 800, nedskudt: true, kasse: null, konfetti: true });
  assert.deepEqual(ord(), ['KORTSLUTNING!', 'OVEROPHEDET!', 'NEDSKUDT!', 'KONFETTI!']);
  assert.deepEqual(lyde(), ['kortslutning', 'stoevsuger_alarm']);
  u.send('fareLeveret', { id: 9, x: 1000, y: 800, hold: 0, baever: 1, vaaben: 'grenroer', antal: 2 });
  assert.equal(ord().at(-1), 'LEVERET!');
  assert.match(u.hud.bannere.at(-1).tekst, /^LEVERET! Ingrid: \+2 /);
  assert.equal(lyde().at(-1), 'vaaben_samlet');
  assert.ok(!u.lyd.spillet.at(-1).vigtig, 'LEVERET! er ikke vigtig (D9)');
  u.send('fareOpdateres', { id: 8, x: 1000, y: 601, fra: 1, tick: 300 });
  assert.equal(ord().at(-1), 'GENSTART!');
  assert.equal(lyde().at(-1), 'opdatering_ramt');
  u.send('fareVaek', { id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x: 1000, y: 296, grund: 'slukket' });
  assert.equal(ord().at(-1), 'PSST');
  assert.equal(lyde().at(-1), 'plask', 'i vandet plasker det');
  u.send('fareVaek', { id: 8, slags: 'stoevsuger', hud: 'robotstoevsuger', x: 1000, y: 296, grund: 'kortsluttet' });
  assert.equal(ord().at(-1), 'BZZT!');
  const n = u.fx.plasket.length;
  u.send('fareVaek', { id: 9, slags: 'drone', hud: 'pakkedrone', x: 1000, y: 290, grund: 'vand' });
  assert.equal(u.fx.plasket.length, n + 1, 'dronen plasker');
  // NOM: den spiser to miner lige efter hinanden -> én lyd; efter lang stilhed igen.
  const f = lyde().length;
  u.send('fareSpiste', { id: 8, mine: 30, x: 1000, y: 601, spam: 1 });
  u.send('fareSpiste', { id: 8, mine: 31, x: 1000, y: 601, spam: 2 });
  assert.deepEqual(lyde().slice(f), ['nom']);
  ur.ms += 21000;
  u.send('fareSpiste', { id: 8, mine: 32, x: 1000, y: 601, spam: 2 });
  assert.deepEqual(lyde().slice(f), ['nom', 'nom']);
  // Alt, der skal tegnes, er givet videre til tegningen.
  const videre = new Set(u.farer.haendelser.map(([navn]) => navn));
  for (const navn of ['fareAntaendt', 'fareLeveret', 'fareSpiste', 'fareVaek']) assert.ok(videre.has(navn), navn);
  u.send('ildTaendt', { id: 40, x: 1000, y: 601 });
  assert.ok(u.farer.haendelser.some(([navn]) => navn === 'ildTaendt'));
  u.send('skade', { baever: 2, skade: 4, aarsag: 'ild', x: 1100, y: 601 });
  assert.deepEqual(u.farer.blusset, [[1100, 601]], 'ilden blusser op, dér hvor den skadede');
  assert.ok(u.lyd.spillet.every((l) => !l.vigtig), 'intet her er vigtigt');
});

test('en lyd på en optaget kanal venter på en fri kanal og falder bort efter fristen', () => {
  const u = lavUi();
  u.lyd.fri = false;
  u.send('fareAntaendt', { id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x: 1000, y: 601, aarsag: 'eksplosion' });
  assert.equal(u.lyd.spillet.length, 0, 'braget har kanalen: KORTSLUTNING venter');
  frem(300, u.ui, u.v);
  assert.equal(u.lyd.spillet.length, 0, 'mens kanalen er optaget');
  u.lyd.fri = true;
  frem(60, u.ui, u.v);
  assert.equal(u.lyd.spillet.length, 0, 'de vigtige lyde i køen får kanalen først');
  frem(100, u.ui, u.v);
  assert.deepEqual(u.lyd.spillet.map((l) => l.navn), ['kortslutning'], 'så kommer den');
  assert.equal(u.lyd.afvist.length, 1, 'den blev kun prøvet én gang på en optaget kanal');
  // Fristen: kanalen bliver ikke fri i tide -> den falder bort.
  u.lyd.fri = false;
  u.send('fareAntaendt', { id: 8, slags: 'stoevsuger', hud: 'robotstoevsuger', x: 1000, y: 601, aarsag: 'eksplosion' });
  frem(1000, u.ui, u.v);
  u.lyd.fri = true;
  frem(400, u.ui, u.v);
  assert.deepEqual(u.lyd.spillet.map((l) => l.navn), ['kortslutning'], 'for sent: alarmen spilles ikke');
});

test('KÆDE ×n! ved hvert brag, der er mindst 2 led inde', () => {
  const u = lavUi();
  for (const kaede of [0, 1, 2, 3]) u.send('eksplosion', { x: 1000, y: 601, radius: 44, kaede, kaedeId: 5, kildeHold: 0, kildeBaever: 1 });
  u.send('eksplosion', { x: 1000, y: 601, radius: 30 });
  assert.deepEqual(u.fx.ord.map((o) => o.tekst), ['KÆDE ×2!', 'KÆDE ×3!']);
});

test('SYGT PLAY!: én gang pr. kæde, når den skader 2 fjender eller dræber én', () => {
  const kaede = (id, o = {}) => ({ kaedeId: id, kildeHold: 0, kildeBaever: 1, ...o });
  const sygt = (u) => u.hud.bannere.filter((b) => b.klasse === 'sygt');
  // En Kabelsalat i kæden (flammebraget), to fjender skadet.
  const u = lavUi();
  u.send('eksplosion', { x: 1100, y: 601, radius: 44, fare: 'kabelsalat', ...kaede(5, { kaede: 1 }) });
  u.send('skade', { baever: 2, skade: 22, aarsag: 'eksplosion', x: 1100, y: 601, ...kaede(5, { kaede: 1 }) });
  assert.equal(sygt(u).length, 0, 'én fjende er ikke nok');
  u.send('skade', { baever: 4, skade: 22, aarsag: 'eksplosion', x: 800, y: 601, ...kaede(5, { kaede: 1 }) });
  assert.equal(sygt(u).length, 0, 'egne kunder tæller ikke');
  u.send('skade', { baever: 3, skade: 22, aarsag: 'eksplosion', x: 1200, y: 601, ...kaede(5, { kaede: 1 }) });
  assert.deepEqual(sygt(u).map((b) => b.tekst), ['SYGT PLAY! Ingrid'], 'banneret navngiver skytten');
  assert.ok(u.fx.ord.some((o) => o.tekst === 'SYGT PLAY!'));
  const l = u.lyd.spillet.at(-1);
  assert.ok(l.navn === 'intro_slam' && l.vigtig, 'uden optagelsen: introens slag, vigtig');
  u.send('skade', { baever: 2, skade: 4, aarsag: 'ild', x: 1100, y: 601, ...kaede(5, { kaede: 2 }) });
  assert.equal(sygt(u).length, 1, 'kun én gang pr. kæde');
  // Speakerens replik, når den er optaget; og et drab er nok (skade med drab).
  const w = lavUi();
  w.lyd.filer.add(SPEAKER_SENERE.sygt_play);
  w.send('fareAntaendt', { id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x: 1100, y: 601, ...kaede(6, { kaede: 1 }) });
  w.send('skade', { baever: 2, skade: 22, aarsag: 'eksplosion', x: 1100, y: 601, drab: true, ...kaede(6, { kaede: 1 }) });
  assert.equal(sygt(w).length, 1);
  assert.ok(w.lyd.spillet.some((x) => x.navn === SPEAKER_SENERE.sygt_play && x.stemme && x.vigtig));
  assert.ok(!ALLE_STEMMER.includes(SPEAKER_SENERE.sygt_play), 'optagelsen står ikke blandt dem, der skal findes');
  assert.ok(w.lyd.hentet.some((h) => h.navne.includes(SPEAKER_SENERE.sygt_play) && h.valgfri), 'den hentes, hvis den findes');
  // Druknet i samme tur efter kædens skade: et drab. I en senere tur: ikke.
  const d = lavUi();
  d.send('ildTaendt', { id: 40, x: 1100, y: 601, ...kaede(7, { kaede: 1 }) });
  d.send('skade', { baever: 2, skade: 4, aarsag: 'ild', x: 1100, y: 601, ...kaede(7, { kaede: 1 }) });
  d.send('drukner', { baever: 2, x: 1100, y: 290 });
  assert.equal(sygt(d).length, 1, 'druknet efter kædens skade');
  d.send('ildTaendt', { id: 41, x: 1200, y: 601, ...kaede(8, { kaede: 1 }) });
  d.send('skade', { baever: 3, skade: 4, aarsag: 'ild', x: 1200, y: 601, ...kaede(8, { kaede: 1 }) });
  d.v.tur.turNr++;
  d.send('doedsfald', { baever: 3, x: 1200, y: 601 });
  assert.equal(sygt(d).length, 1, 'død i en senere tur tæller ikke');
  // En printer, skuddet satte af (1 led, ingen fare, ingen ild): ikke sygt. To led: sygt.
  const p = lavUi();
  for (const b of [2, 3]) p.send('skade', { baever: b, skade: 62, aarsag: 'eksplosion', x: 1100, y: 601, ...kaede(9, { kaede: 1 }) });
  assert.equal(sygt(p).length, 0, 'et almindeligt printerskud er ikke et sygt play');
  p.send('eksplosion', { x: 1150, y: 601, radius: 96, ...kaede(10, { kaede: 2 }) });
  for (const b of [2, 3]) p.send('skade', { baever: b, skade: 62, aarsag: 'eksplosion', x: 1100, y: 601, ...kaede(10, { kaede: 2 }) });
  assert.equal(sygt(p).length, 1, 'printer -> printer (2 led) er');
  // Skuddets eget brag (dybde 0) og skader uden skytte tæller aldrig.
  const q = lavUi();
  q.send('eksplosion', { x: 1100, y: 601, radius: 44, fare: 'kabelsalat', ...kaede(11, { kaede: 1 }) });
  for (const b of [2, 3]) q.send('skade', { baever: b, skade: 40, aarsag: 'eksplosion', x: 1100, y: 601, ...kaede(11, { kaede: 0 }) });
  for (const b of [2, 3]) q.send('skade', { baever: b, skade: 40, aarsag: 'eksplosion', x: 1100, y: 601, kaede: 1, kaedeId: null, kildeHold: null });
  assert.equal(sygt(q).length, 0);
});

test('kameraet: intet under sigtet, et kort glimt i opløsningen', () => {
  const u = lavUi({ tilstand: TIL.SPILLER_AKTIV });
  const antaend = (x = 1100) => u.send('fareAntaendt', { id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x, y: 601, kaede: 1 });
  antaend();
  u.send('eksplosion', { x: 1100, y: 601, radius: 96, kaede: 1, kaedeId: 3, kildeHold: 0 });
  assert.deepEqual(u.kamera.kald, [], 'SPILLER_AKTIV: intet');
  u.v.tur.tilstand = TIL.TUR_START;
  antaend();
  assert.deepEqual(u.kamera.kald, [], 'TUR_START: intet');
  u.v.tur.tilstand = TIL.OPLOESNING;
  u.S.skudId = 12;
  antaend();
  assert.deepEqual(u.kamera.kald, [], 'et skud i luften går forud');
  u.S.skudId = null;
  antaend(1300);
  assert.equal(u.kamera.kald.length, 1);
  const [navn, x, , sek] = u.kamera.kald[0];
  assert.ok(navn === 'rammeInd' && x === 1300 && sek === 1.2, JSON.stringify(u.kamera.kald[0]));
  ur.ms += 1500;
  u.send('eksplosion', { x: 1100, y: 601, radius: 44, kaede: 1, kaedeId: 3, kildeHold: 0 });
  assert.equal(u.kamera.kald.length, 1, 'højst hvert 2. s');
  ur.ms += 600;
  u.send('eksplosion', { x: 1100, y: 601, radius: 44, kaede: 1, kaedeId: 3, kildeHold: 0 });
  assert.equal(u.kamera.kald.length, 2);
  u.send('eksplosion', { x: 1100, y: 601, radius: 44, kaede: 0, kaedeId: 3, kildeHold: 0 });
  ur.ms += 2500;
  u.send('eksplosion', { x: 1100, y: 601, radius: 44, kaede: 0, kaedeId: 3, kildeHold: 0 });
  assert.equal(u.kamera.kald.length, 2, 'skuddets eget brag er kameraets sag');
  assert.ok(u.kamera.kald.every(([n]) => n === 'rammeInd'), 'aldrig foelg, fokus, etabler, kortFokus eller foelgSkud');
  // Kun kald, kameraets API har (som kamera_determinisme.mjs' liste for main.js og ui/).
  const kam = lavKamera(lavFalskRenderer(), lavBane(), { reduceret: false });
  const brugt = [...kilde('../static/js/ui/farer.js').matchAll(/\bkamera\.([a-zA-Z]+)\b/g)].map((m) => m[1])
    .filter((n) => !['position', 'left', 'right', 'top', 'bottom'].includes(n));
  assert.ok(brugt.includes('rammeInd'));
  for (const n of brugt) assert.ok(n in kam, `ui/farer.js kalder kamera.${n}, som ikke findes`);
});

test('kameraet: et glimt under nedslagets hold venter på holdet og kommer helt', () => {
  const u = lavUi({ tilstand: TIL.OPLOESNING });
  const kaedeBrag = (x) => u.send('eksplosion', { x, y: 601, radius: 44, kaede: 1, kaedeId: 3, kildeHold: 0 });
  // Skuddet er slået ned (S.skudId er null), og kameraet holder over krateret.
  u.kamera.foelgerSkud = true;
  kaedeBrag(1300);
  frem(300, u.ui, u.v);
  kaedeBrag(1400);
  frem(500, u.ui, u.v);
  assert.deepEqual(u.kamera.kald, [], 'intet, mens kameraet holder over nedslaget');
  u.kamera.foelgerSkud = false;                       // main.js: holdet er slut (fokus)
  u.opdater();
  assert.equal(u.kamera.kald.length, 1, 'glimtet kommer, når holdet slipper');
  const [navn, x, , sek] = u.kamera.kald[0];
  assert.ok(navn === 'rammeInd' && x === 1400 && sek === 1.2, `det nyeste brag, helt (${JSON.stringify(u.kamera.kald[0])})`);
  frem(100, u.ui, u.v);
  assert.equal(u.kamera.kald.length, 1, 'kun én gang');
  // Har det ventet for længe, hører det ikke længere til braget.
  ur.ms += 2500;
  u.kamera.foelgerSkud = true;
  kaedeBrag(1300);
  frem(1700, u.ui, u.v);
  u.kamera.foelgerSkud = false;
  frem(100, u.ui, u.v);
  assert.equal(u.kamera.kald.length, 1, 'for gammelt');
  // Et nyt skud i luften går forud.
  ur.ms += 2500;
  u.kamera.foelgerSkud = true;
  kaedeBrag(1300);
  u.S.skudId = 9;
  u.opdater();
  u.S.skudId = null; u.kamera.foelgerSkud = false;
  frem(100, u.ui, u.v);
  assert.equal(u.kamera.kald.length, 1, 'et nyt skud går forud');

  // Med det rigtige kamera (som main.js: foelgSkud(nedslaget), fokus efter
  // NEDSLAG_HOLD_MS 1,5 s; kameraet opdateres før ui/farer.js). Kom glimtet med
  // det samme, var kun 0,1-0,2 s af det tilbage efter holdet: markoer et
  // øjeblik, og zoomen pumpede ud og ind. Nu er det et helt glimt.
  function scenarie(tBrag, hold = true) {
    const dom = falskDom();
    const { kam, r } = lavOpsaetning();
    const akt = lavFigur(1, 1000, 601);
    kam.etabler(akt); kam.snap(1000, 640);
    const v = { farer: [], ild: [], farePlan: { varsel: null }, vandNiveau: 300, baevere: [akt], projektiler: [],
                tur: { tilstand: TIL.OPLOESNING, turNr: 3 }, aktivBaever: () => akt };
    const bus = lavBus();
    const ui = kobFarer({ bus, hud: falskHud(), lyd: falskLyd(), visning: { fx: falskFx(), farer: null, kamera: kam },
                          S: { verden: v, tilstand: 'spil', skudId: null }, r: falskRenderer(), rod: dom.rod });
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) kam.opdater(dt);
    if (hold) kam.foelgSkud({ x: 1500, y: 601, vx: 0, vy: 0 });
    const ud = [];
    for (let i = 0; i < 240; i++) {
      const tid = i * dt;
      ur.ms += 1000 * dt;
      // Kædebraget 700 wu fra krateret: uden for holdets billede.
      if (i === Math.round(tBrag * 60)) bus.send('eksplosion', { navn: 'eksplosion', x: 2200, y: 640, radius: 44, kaede: 1, kaedeId: 3, kildeHold: 0 });
      if (hold && i === 90) kam.fokus(akt);
      kam.opdater(dt);
      ui.opdater(v);
      ud.push({ tid, zoom: kam.glat.zoom, tilstand: kam.glat.tilstand, set: iBilledet(r, 2200, 640) });
    }
    return ud.filter((p) => p.tid >= (hold ? 1.5 : tBrag));
  }
  const maal = (ud) => {
    let markoer = 0, vend = 0, fv = 0;
    for (let i = 0; i < ud.length; i++) {
      if (ud[i].tilstand === 'markoer') markoer += 1 / 60;
      const d = i ? ud[i].zoom - ud[i - 1].zoom : 0;
      if (Math.abs(d) > 1e-5) { if (fv && Math.sign(d) !== Math.sign(fv)) vend++; fv = d; }
    }
    return { markoer, vend, zoom: Math.max(...ud.map((p) => p.zoom)), set: ud.some((p) => p.set) };
  };
  const alm = maal(scenarie(0.5, false));
  assert.ok(alm.markoer > 1.1 && alm.vend === 1 && alm.set, `et almindeligt glimt (${JSON.stringify(alm)})`);
  for (const t of [0.1, 0.5, 1.0, 1.4]) {
    const m = maal(scenarie(t));
    assert.ok(m.markoer > 1.1, `brag ${t} s inde i holdet: et helt glimt bagefter, ikke en rest (${m.markoer.toFixed(2)} s)`);
    assert.equal(m.vend, 1, `brag ${t} s inde i holdet: zoomen går ud og ind én gang`);
    assert.ok(m.set && Math.abs(m.zoom - alm.zoom) < 0.02, `brag ${t} s inde: som et almindeligt glimt (${m.zoom.toFixed(2)})`);
  }
});

test('pilen og skiltet er væk under sejren og i menuen', () => {
  const u = lavUi();
  const f = ks({ x: 2600 });
  u.send('fareKommer', { id: 7, slags: 'kabelsalat', hud: 'kabelsalat', x: f.x, y: f.y, ret: 1, pakke: null });
  u.v.farer = [f];
  u.opdater();
  assert.ok(!u.pil.classList.contains('hide'), 'pilen i kanten under kampen');
  u.S.tilstand = 'sejr';
  u.opdater();
  assert.ok(u.pil.classList.contains('hide'), 'væk under sejren');
  // Vinderskuddet landede under et varsel: varslet står frosset i spejlet.
  u.v.farePlan.varsel = { slags: 'drone', hud: 'pakkedrone', x: -60, y: 1000, ret: 1, rest: 120 };
  frem(3000, u.ui, u.v);
  assert.ok(u.pil.classList.contains('hide'), 'et frosset varsel pulserer ikke under festen');
  u.S.tilstand = 'menu';
  u.opdater();
  assert.ok(u.pil.classList.contains('hide'), 'heller ikke i resultatmenuen');
  // Skiltet: faren i billedet under kampen, så sejren.
  const w = lavUi();
  w.send('fareKommer', { id: 9, slags: 'kabelsalat', hud: 'kabelsalat', x: 1100, y: 601, ret: 1, pakke: null });
  w.v.farer = [ks({ id: 9 })];
  w.opdater();
  assert.ok(!w.skilt.classList.contains('hide'), 'skiltet under kampen');
  w.S.tilstand = 'sejr';
  w.opdater();
  assert.ok(w.skilt.classList.contains('hide') && w.pil.classList.contains('hide'), 'væk under sejren');
  w.S.tilstand = 'spil';
  w.opdater();
  assert.ok(!w.skilt.classList.contains('hide'), 'og tilbage i kampen');
});

test('kantpilens ikon har farve: .fp-ikon fylder med currentColor', () => {
  // Art directorens symboler er som #i-arrow: formerne har ingen fyldfarve og
  // arver den fra den, der bruger ikonet. Uden en regel er de sorte (SVG's
  // standard): usynlige på det mørkeblå mærke og sorte på varslets røde.
  const html = kilde('../static/index.html');
  for (const id of ['i-kabelsalat', 'i-drone', 'i-stoevsuger']) {
    const sym = new RegExp(`<symbol id="${id}"[^>]*>([\\s\\S]*?)</symbol>`).exec(html)?.[1];
    assert.ok(sym, `index.html: #${id}`);
    const arver = sym.replace(/<g\b[^>]*\bfill="[^"]*"[^>]*>[\s\S]*?<\/g>/g, '')
      .match(/<(path|circle|rect|ellipse|polygon)\b(?![^>]*\bfill=)[^>]*>/g) || [];
    assert.ok(arver.length > 0, `#${id} har former, der arver fyldet`);
  }
  const css = kilde('../static/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const regler = [...css.matchAll(/(?<=^|[{};])\s*([^{}@;]+?)\s*\{([^{}]*)\}/g)]
    .map(([, sel, krop]) => ({ sel: sel.split(',').map((s) => s.trim()), krop: krop.replace(/\s+/g, '') }));
  const ikon = regler.filter((q) => q.sel.some((s) => /\.fp-ikon$/.test(s)));
  assert.ok(ikon.length > 0, 'app.css har en regel for .fp-ikon');
  const fyld = ikon.flatMap((q) => [...q.krop.matchAll(/(?:^|;)fill:([^;]+)/g)].map((m) => m[1]));
  assert.deepEqual(fyld, ['currentColor'], '.fp-ikon fylder med currentColor');
  // Og farven er mærkets: gul på det mørkeblå, hvid på varslets røde.
  const farve = (sel) => regler.find((q) => q.sel.includes(sel))?.krop.match(/(?:^|;)color:([^;]+)/)?.[1];
  assert.equal(farve('.fp-rund'), 'var(--kk-yellow)');
  assert.equal(farve('.fare-pil.varsel .fp-rund'), '#fff');
});

test('ildens knitren: løkken efter afstanden, og kun i kampen', () => {
  const u = lavUi();
  const ild = () => u.lyd.loekker.get('ild');
  u.opdater();
  assert.ok(!ild().til, 'ingen ild');
  u.v.ild = [{ id: 1, x: 1400, y: 601, rest: 200 }];
  u.opdater();
  const langt = ild().vol;
  assert.ok(ild().til && langt > 0, 'ild i nærheden');
  u.v.ild = [{ id: 1, x: 1010, y: 601, rest: 200 }];
  u.opdater();
  const taet = ild().vol;
  assert.ok(taet > langt, `tættere på er højere (${langt.toFixed(2)} -> ${taet.toFixed(2)})`);
  u.v.ild = Array.from({ length: 8 }, (_, i) => ({ id: i, x: 1010 + i * 24, y: 601, rest: 200 }));
  u.opdater();
  assert.ok(ild().vol > taet, 'flere pletter er kraftigere');
  u.v.ild = [{ id: 1, x: 4000, y: 601, rest: 200 }];
  u.opdater();
  assert.ok(!ild().til, 'for langt væk');
  u.v.ild = [{ id: 1, x: 1010, y: 601, rest: 200 }];
  u.S.tilstand = 'sejr';
  u.opdater();
  assert.ok(!ild().til, 'aldrig uden for kampen');
  u.S.tilstand = 'spil';
  u.ui.fjern();
  assert.ok(!ild().til, 'fjern() tager løkken med');
});

// ------------------------------------------------------------ main.js' kroge

const MAIN = kilde('../static/js/main.js');
function blok(start) {
  const i = MAIN.indexOf(start);
  assert.ok(i >= 0, `main.js: fandt ikke ${start}`);
  const j = MAIN.indexOf('\n  });\n', i);
  return MAIN.slice(i, j + 7);
}

/** main.js' skade-, eksplosion- og kasseFalder-lyttere med falske moduler. */
function mainKroge(tilstand = TIL.SPILLER_AKTIV) {
  const H = {};
  const bus = { paa: (n, f) => { H[n] = f; } };
  const lyd = falskLyd(), hud = falskHud(), kamera = falskKamera(), fx = falskFx();
  const ramt = [], replikker = [];
  const S = { verden: { baevere: [kunde(1, 0, 900, 601, 'Ingrid'), kunde(2, 1, 1100, 601, 'Jan')], tur: { tilstand, turNr: 3 } },
              skudUde: { skytte: 1, ramte: false }, ildReplik: new Map() };
  const r = { kamera: { position: { x: 1000, y: 650 } } };
  const kode = [blok("  bus.paa('eksplosion', (e) => {"), blok("  bus.paa('skade', (e) => {"), blok("  bus.paa('kasseFalder', (e) => {")].join('\n');
  new Function('bus', 'lyd', 'hud', 'visning', 'S', 'r', 'TIL', 'rumlig', 'effektLyd', 'skudRamte', 'replik', kode)(
    bus, lyd, hud, { fx, kamera }, S, r, TIL, () => ({ vol: 1, pan: 0 }), (g) => `stemme_${g}`,
    (id) => ramt.push(id), (b, situation) => replikker.push([b.id, situation]));
  return { H, lyd, hud, kamera, S, ramt, replikker };
}

test('main.js: ild giver ingen lyd og kun én replik pr. tur, og rosen er skyttens', () => {
  const m = mainKroge();
  m.H.skade({ baever: 2, skade: 4, aarsag: 'ild', kaede: 1, kaedeId: 5, kildeHold: 0, kildeBaever: 1 });
  m.H.skade({ baever: 2, skade: 4, aarsag: 'ild', kaede: 1, kaedeId: 5, kildeHold: 0, kildeBaever: 1 });
  assert.equal(m.lyd.spillet.length, 0, 'ild tikker lydløst i lytteren');
  assert.deepEqual(m.replikker, [[2, 'av']], 'én replik til ilden i turen (D21)');
  m.S.verden.tur.turNr++;
  m.H.skade({ baever: 2, skade: 4, aarsag: 'ild', kaede: 1, kaedeId: 5, kildeHold: 0, kildeBaever: 1 });
  assert.equal(m.replikker.length, 2, 'og igen i næste tur');
  assert.deepEqual(m.ramt, [2, 2, 2], 'skyttens egen kæde er et træf');
  // Ilden fra en andens skud tæller ikke som skyttens træf; en skade uden skytte gør.
  m.H.skade({ baever: 2, skade: 4, aarsag: 'ild', kaede: 1, kaedeId: 9, kildeHold: 1, kildeBaever: 2 });
  assert.equal(m.ramt.length, 3);
  m.H.skade({ baever: 2, skade: 12, aarsag: 'fald' });
  assert.equal(m.ramt.length, 4);
  assert.deepEqual(m.lyd.spillet.map((l) => l.navn), ['tungt_fald'], 'alt andet lyder som før');
  assert.deepEqual(m.replikker.at(-1), [2, 'av']);
});

test('main.js: et kædebrag under sigtet ryster kun kameraet', () => {
  const m = mainKroge(TIL.SPILLER_AKTIV);
  m.H.eksplosion({ x: 1200, y: 601, radius: 96, kaede: 1, kaedeId: 5, kildeHold: 0 });
  assert.deepEqual(m.kamera.kald.map(([n]) => n), ['rystelse'], 'intet punch og intet spark (D17)');
  assert.ok(m.kamera.kald[0][1] <= 1 && m.kamera.kald[0][2] > 0, 'rystelse efter radius og afstand');
  m.H.eksplosion({ x: 1200, y: 601, radius: 96, kaede: 0, kaedeId: 5, kildeHold: 0 });
  m.H.eksplosion({ x: 1200, y: 601, radius: 96 });
  m.S.verden.tur.tilstand = TIL.OPLOESNING;
  m.H.eksplosion({ x: 1200, y: 601, radius: 96, kaede: 2, kaedeId: 5, kildeHold: 0 });
  assert.deepEqual(m.kamera.kald.map(([n]) => n), ['rystelse', 'eksplosion', 'eksplosion', 'eksplosion']);
  assert.ok(m.lyd.spillet.length === 4 && m.lyd.spillet.every((l) => l.forrang), 'braget lyder hver gang, med forrang');
});

test('main.js: "Pakken falder!" ved den nedskudte drones pakke', () => {
  const m = mainKroge();
  m.H.kasseFalder({ id: 3, x: 1000, y: 900, slags: 'vaaben', fald: true });
  assert.deepEqual(m.hud.bannere.map((b) => b.tekst), ['Pakken falder!']);
  assert.equal(m.lyd.spillet.length, 0, 'ingen faldskærm, ingen faldskærmslyd');
  m.H.kasseFalder({ id: 4, x: 1000, y: 900, slags: 'vaaben' });
  assert.deepEqual(m.hud.bannere.map((b) => b.tekst), ['Pakken falder!', 'Forsyningskasse på vej!']);
  assert.deepEqual(m.lyd.spillet.map((l) => l.navn), ['kasse_falder']);
});
