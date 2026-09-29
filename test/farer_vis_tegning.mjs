/* Kundekrigen — test: farernes tegning (render/fare_view.js).
 *
 *   node --no-warnings --test test/farer_vis_tegning.mjs
 *
 * Uden browser: three-scenen bygges i Node, og en lille software-rasterer
 * (farer_vis_hjaelp.mjs) tegner quads med art directorens atlas, så testen
 * kan måle, hvor tegningen står, og lægge et kontaktark i
 * test/billeder/farer_vis.png (kun når dwebp og ffmpeg findes).
 *
 * 1. Hver tilstand har sine frames: idle, aktiv (brand), fald (luft), land
 *    (luft -> jord, og støvsugeren, der vågner), udloes (KORTSLUTNING, NOM,
 *    LEVERET!, en ny brand) og doed (asken, batteriet, ilden, der går ud).
 * 2. Rullen: vinklen er −x / r på jorden, i luften tumler den videre og
 *    bremser, og en brændende Kabelsalat vugger (flammerne bliver oppe).
 * 3. Fodlinjen (y 118 i cellen) står på fodpunktet, tegningen står på
 *    jorden, og lagene er designets: jorden med genstandene, dronen under
 *    projektilerne, ilden under effekterne, græsset under pynten.
 * 4. Dronen uden kasse (leveret eller skudt ned): kun cellens øverste stykke,
 *    og efter LEVERET! flyver kassen hen til skytten og er væk.
 * 5. Det brændte græs: efter ilden, blødt ind, væk efter et minut, væk med
 *    jorden, højst GRAES_MAKS.
 * 6. Mangler kunsten, tegnes intet (og intet fejler), til den kommer.
 * 7. Over nettet (hver 3. delta) går farerne glat, og en fare, der er meldt
 *    væk (dronens nedslag, vandet, kanten), tegnes aldrig igen, mens
 *    spejlet halter efter hændelsen.
 * 8. En rigtig kamp med farer hvert 15. s: tegningen følger spejlet, intet
 *    hænger, intet er NaN, og fjern() rydder scenen.
 * 9. Kontaktarket: hver tilstand og hver fare på en rigtig bane.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Scene } from '../static/js/three.js';
import { lavFareView, FARE_BREDDE } from '../static/js/render/fare_view.js';
import { Z } from '../static/js/render/renderer.js';
import { OBJEKT_RIG } from '../static/js/render/objekt_rig.js';
import { lavBus } from '../static/js/core/bus.js';
import { kobFarer } from '../static/js/ui/farer.js';
import { billeder, tegnScene, underkant, falskFx, falskLyd, falskHud, falskKamera, falskRenderer, falskDom,
         atlas, VAERKTOEJ, spejlFra } from './farer_vis_hjaelp.mjs';
import { skrivPng, kontaktark, skrivTekst } from './kort_hjaelp.mjs';
import { aktivVerden, kabelsalatPaaJorden, antaend, FA, fladPlads, lavHold, hurtigeFarer,
         skriptetKamp, koer, jordVed } from './farer_hjaelp.mjs';
import { lavVerden } from '../static/js/sim/world.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';

const FRAMES = OBJEKT_RIG.frames;
const frameNavn = (m) => FRAMES[m.userData.objekt.frame] || '?';
const JORD_Y = 600;
/** En flad bane til de syntetiske scener: jorden til og med y 600. */
const fladBane = () => ({ w: 5120, h: 1792, vandNiveau: 300, fast: (x, y) => y >= 0 && y <= JORD_Y, hent: () => 1 });

const ks = (o = {}) => ({ id: 1, type: 'fare', slags: 'kabelsalat', hud: 'kabelsalat', x: 1000, y: JORD_Y + 1, r: 14, hy: 15,
                          tilst: 'jord', ret: 1, brand: 0, styrt: 0, pakke: null, spam: 0, ...o });
const rs = (o = {}) => ({ id: 2, type: 'fare', slags: 'stoevsuger', hud: 'robotstoevsuger', x: 1000, y: JORD_Y + 1, r: 14, hy: 7,
                          tilst: 'koer', ret: 1, brand: 0, styrt: 0, pakke: null, spam: 0, ...o });
const dr = (o = {}) => ({ id: 3, type: 'fare', slags: 'drone', hud: 'pakkedrone', x: 1000, y: JORD_Y + 60, r: 20, hy: 21,
                          tilst: 'flyv', ret: 1, brand: 0, styrt: 0, pakke: 'grenroer', spam: 0, ...o });
const plet = (id, x, o = {}) => ({ id, x, y: JORD_Y + 1, rest: 200, ...o });

/** En visning med uret i hånden: k.frem(s, farer, ild) går s sekunder frem i 60 Hz. */
function lavKoersel({ billede = billeder(), terraen = fladBane(), figur = null } = {}) {
  const scene = new Scene();
  const fx = falskFx();
  const vis = lavFareView(scene, { fx, billede });
  let t = 100, tick = 0;
  const o = { tick: 0, terraen, figur };
  const k = {
    scene, vis, fx, o,
    get t() { return t; },
    frem(s, farer = [], ild = [], hvert = null) {
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) {
        t += 1 / 60; o.tick = ++tick;
        if (hvert) hvert(i);
        vis.opdater(farer, ild, t, o);
      }
    },
    post: (id) => vis._poster.get(id),
  };
  return k;
}

test('hver tilstand har sine frames', () => {
  // Kabelsalaten: idle, fald, land, idle, KORTSLUTNING (udloes), aktiv, aske.
  const k = lavKoersel();
  const f = ks();
  k.frem(0.5, [f]);
  assert.match(frameNavn(k.post(1).m), /^idle_/);
  f.tilst = 'luft'; f.y += 40;
  k.frem(0.2, [f]);
  assert.match(frameNavn(k.post(1).m), /^fald_/, 'i luften');
  f.tilst = 'jord'; f.y = JORD_Y + 1;
  k.frem(1 / 60, [f]);
  assert.match(frameNavn(k.post(1).m), /^land_/, 'landingen');
  k.frem(0.3, [f]);
  assert.match(frameNavn(k.post(1).m), /^idle_/, 'efter landingen');
  k.vis.haendelse('fareAntaendt', { id: 1, slags: 'kabelsalat', x: f.x, y: f.y }, k.t);
  f.brand = 120;
  k.frem(0.1, [f]);
  assert.match(frameNavn(k.post(1).m), /^udloes_/, 'KORTSLUTNING-glimtet');
  k.frem(0.4, [f]);
  assert.match(frameNavn(k.post(1).m), /^aktiv_/, 'brænder');
  const set = new Set();
  k.frem(1, [f], [], () => set.add(frameNavn(k.post(1).m)));
  assert.ok(set.size >= 3, `brandens løkke skifter frame (${[...set]})`);
  k.vis.haendelse('fareVaek', { id: 1, slags: 'kabelsalat', grund: 'brag', x: f.x, y: f.y }, k.t);
  k.frem(0.2, []);
  assert.match(frameNavn(k.post(1).m), /^doed_/, 'asken');
  k.frem(0.6, []);
  assert.equal(frameNavn(k.post(1).m), 'doed_3', 'asken står på sidste frame');
  k.frem(1.2, []);
  assert.ok(!(k.post(1)), 'asken er tonet ud og fjernet');

  // Robotstøvsugeren: vågner (land), kører (idle), pause (blinker blåt), luft (fald), NOM, overophedet, batteri.
  const s = lavKoersel();
  const v = rs();
  s.frem(1 / 60, [v]);
  assert.match(frameNavn(s.post(2).m), /^land_/, 'den vågner med et hop');
  s.frem(0.4, [v]);
  assert.match(frameNavn(s.post(2).m), /^idle_/);
  v.tilst = 'pause';
  let mindst = 1;
  s.frem(0.6, [v], [], () => { mindst = Math.min(mindst, s.post(2).m.material.color.r); });
  assert.ok(mindst < 0.7, `tvangsopdateret: den blinker blåt (${mindst.toFixed(2)})`);
  v.tilst = 'luft';
  s.frem(0.1, [v]);
  assert.match(frameNavn(s.post(2).m), /^fald_/, 'vendt om i luften');
  v.tilst = 'koer';
  s.frem(0.3, [v]);
  s.vis.haendelse('fareSpiste', { id: 2, mine: 9, x: v.x, y: v.y, spam: 1 }, s.t);
  s.frem(0.3, [v]);
  assert.match(frameNavn(s.post(2).m), /^udloes_/, 'NOM');
  s.frem(0.5, [v]);
  assert.match(frameNavn(s.post(2).m), /^idle_/, 'NOM er ovre');
  v.brand = 60; v.spam = 2;
  s.frem(0.2, [v]);
  assert.match(frameNavn(s.post(2).m), /^aktiv_/, 'overophedet');
  assert.ok(s.post(2).g.scale.y > 1.05, 'batteriet buler med to spiste miner');
  s.vis.haendelse('fareVaek', { id: 2, slags: 'stoevsuger', grund: 'brag', x: v.x, y: v.y }, s.t);
  s.frem(0.5, []);
  assert.equal(frameNavn(s.post(2).m), 'doed_3', 'batteriet er sprunget');

  // Ilden: tændes (land), brænder (idle), blusser op (aktiv), en ny brand (udloes), går ud (doed).
  const i = lavKoersel();
  i.vis.haendelse('ildTaendt', { id: 21, x: 1024, y: JORD_Y + 1 }, i.t);
  i.frem(1 / 60, [], [plet(20, 1000), plet(21, 1024)]);
  assert.match(frameNavn(i.vis._pletter.get(20).m), /^land_/, 'en plet tændes med et puf');
  assert.match(frameNavn(i.vis._pletter.get(21).m), /^udloes_/, 'en ny brand blusser op (ildTaendt kom før deltaen)');
  i.frem(0.5, [], [plet(20, 1000), plet(21, 1024)]);
  assert.match(frameNavn(i.vis._pletter.get(20).m), /^idle_/);
  i.vis.blus(1003, JORD_Y + 1);
  i.frem(0.1, [], [plet(20, 1000), plet(21, 1024)]);
  assert.match(frameNavn(i.vis._pletter.get(20).m), /^aktiv_/, 'skadetakten: den nærmeste blusser op');
  assert.match(frameNavn(i.vis._pletter.get(21).m), /^idle_/, 'kun den nærmeste');
  i.frem(0.1, [], [plet(21, 1024)]);
  assert.match(frameNavn(i.vis._pletter.get(20).m), /^doed_/, 'pletten går ud');
  i.frem(1.1, [], [plet(21, 1024)]);
  assert.ok(!(i.vis._pletter.get(20)), 'og er væk');
});

test('rullen: −x / r på jorden, tumlen i luften, vuggen i brand', () => {
  const k = lavKoersel();
  const f = ks();
  k.frem(1 / 60, [f]);
  const v0 = k.post(1).drej.rotation.z;
  k.frem(28 / 60, [f], [], () => { f.x += 1; });
  k.frem(0.1, [f]);                               // de glattede prøver indhenter spejlet
  const drejet = k.post(1).drej.rotation.z - v0;
  assert.ok(Math.abs(drejet + 28 / 14) < 0.02, `28 wu til højre = −2 rad (${drejet.toFixed(3)})`);
  // I luften: tumler videre, men bremser, og x ændrer den ikke.
  k.frem(0.25, [f], [], () => { f.x += 1; });
  f.tilst = 'luft';
  k.frem(0.1, [f], [], () => { f.x += 3; });
  const a = k.post(1).drej.rotation.z;
  k.frem(0.5, [f]);
  const b = k.post(1).drej.rotation.z;
  k.frem(0.5, [f]);
  const c = k.post(1).drej.rotation.z;
  assert.ok(Math.abs(c - b) < Math.abs(b - a) + 1e-9 && Math.abs(c - b) > 0, 'i luften tumler den og bremser');
  // I brand: vuggen (højst ~0,3 rad), så flammerne står op.
  f.tilst = 'jord'; f.brand = 120;
  let stoerst = 0;
  k.frem(0.4, [f], [], () => { f.x += 2; });
  k.frem(1, [f], [], () => { f.x += 2; stoerst = Math.max(stoerst, Math.abs(k.post(1).drej.rotation.z)); });
  assert.ok(stoerst <= 0.31, `brændende vugger den (${stoerst.toFixed(2)} rad)`);
  assert.ok(k.fx.tal.ild > 5, 'og der er flammer bag den');
});

test('fodlinjen står på fodpunktet, og lagene er designets', () => {
  const k = lavKoersel();
  const farer = [ks({ id: 1, x: 900 }), rs({ id: 2, x: 1100 }), dr({ id: 3, x: 1300 })];
  k.frem(0.5, farer, [plet(10, 700)]);
  k.scene.updateMatrixWorld(true);
  for (const f of farer) {
    const p = k.post(f.id);
    // Quadens origo er fodpunktet: cellens række 118 er dens y = 0.
    const e = p.m.matrixWorld.elements;
    if (f.slags !== 'drone') assert.ok(Math.abs(e[13] - f.y) < 0.6, `${f.hud}: foden i y ${e[13].toFixed(2)}, ikke ${f.y}`);
    const pos = p.m.geometry.attributes.position;
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 4; i++) { y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
    const s = p.m.userData.objekt.s;
    assert.ok(Math.abs(y0 + (128 - 118) * s) < 1e-4 && Math.abs(y1 - 118 * s) < 1e-4,
              `${f.hud}: cellen strækker sig fra fodlinjen (${y0.toFixed(2)}..${y1.toFixed(2)})`);
    assert.equal(p.m.userData.objekt.navn, f.hud);
  }
  const { jord, luft, flammer, graes } = k.vis._grupper;
  assert.equal(jord.position.z, Z.genstande);
  assert.equal(luft.position.z, Z.projektiler - 1, 'dronen lige under projektilerne');
  assert.equal(flammer.position.z, Z.fx - 1, 'ilden lige under effekterne');
  assert.ok(graes.position.z < Z.genstande && graes.position.z > Z.terraen, 'græsset mellem terrænet og genstandene');
  assert.ok(k.post(1).m.renderOrder > Z.genstande && k.post(1).m.renderOrder < Z.baevere);
  assert.equal(k.post(3).m.renderOrder, Z.projektiler - 1);
  assert.equal(k.vis._pletter.get(10).m.renderOrder, Z.fx - 1);
  for (const [, e] of k.vis._maerker) assert.ok(e.m.renderOrder < Z.genstande - 1, 'græsset under pynten');
  // Bredderne: kuglen er lige så stor som træfcirklen (r 14).
  const [x0, , x1] = OBJEKT_RIG.modeller.kabelsalat.indhold;
  assert.ok(Math.abs(FARE_BREDDE.kabelsalat / (x1 - x0) * 75 - 28) < 1.5, 'kuglen (~75 px) er ~28 wu');
});

test('tegningen står på jorden (de rigtige atlas)', { skip: !VAERKTOEJ.dwebp && 'dwebp mangler' }, () => {
  const k = lavKoersel();
  const farer = [ks({ id: 1, x: 900 }), rs({ id: 2, x: 1000 }), dr({ id: 3, x: 1100, y: JORD_Y + 1 })];
  k.frem(0.3, farer, [plet(10, 1200)]);
  const ud = { x0: 860, y0: JORD_Y - 20, b: 380, h: 110, s: 3 };
  const b = tegnScene(k.scene, ud);
  for (const [navn, x] of [['kabelsalat', 900], ['robotstoevsuger', 1000], ['pakkedrone', 1100], ['ild', 1200]]) {
    const u = underkant(b, ud, x - 10, x + 10);
    assert.ok(u !== null && Math.abs(u - (JORD_Y + 1)) < 2.5, `${navn}: tegningens underkant ${u?.toFixed(1)} er på jorden (${JORD_Y + 1})`);
  }
  // En hel omgang: stikkene går aldrig ned i jorden, og kuglen letter aldrig.
  for (const hud of ['kabelsalat', 'nullermand']) {
    const r = lavKoersel();
    const f = ks({ hud, x: 1000 });
    let laveste = Infinity, hoejeste = -Infinity;
    for (let i = 0; i < 24; i++) {
      r.frem(4 / 60, [f], [], () => { f.x += 14 * Math.PI * 2 / 96; });
      const ur = { x0: 900, y0: JORD_Y - 20, b: 200, h: 80, s: 3 };
      const u = underkant(tegnScene(r.scene, ur), ur, f.x - 30, f.x + 30);
      laveste = Math.min(laveste, u); hoejeste = Math.max(hoejeste, u);
    }
    assert.ok(laveste > JORD_Y - 1, `${hud}: intet stik under jorden (laveste ${laveste.toFixed(1)})`);
    assert.ok(hoejeste < JORD_Y + 4, `${hud}: den ruller på jorden (højeste underkant ${hoejeste.toFixed(1)})`);
  }
});

test('dronen uden kasse: leveret, og skudt ned', () => {
  const figur = { id: 7, x: 700, y: JORD_Y + 1 };
  const k = lavKoersel({ figur: (id) => (id === 7 ? figur : null) });
  const f = dr();
  k.frem(0.3, [f]);
  assert.ok(k.post(3).m.visible && !k.post(3).klip, 'med pakken: hele tegningen');
  k.vis.haendelse('fareLeveret', { id: 3, x: f.x, y: f.y, baever: 7, vaaben: 'grenroer', antal: 1 }, k.t);
  f.pakke = null;
  k.frem(0.15, [f]);
  assert.match(frameNavn(k.post(3).m), /^udloes_/, 'dronen slipper pakken');
  assert.ok(k.post(3).m.visible && !k.post(3).klip?.visible);
  k.frem(0.25, [f]);
  const p = k.post(3);
  assert.ok(!p.m.visible && p.klip.visible, 'så kun dronen');
  const kl = p.klip.userData.objekt;
  assert.ok(kl.y0 === 0 && kl.y1 <= 56, `dronen er cellens øverste stykke (${kl.y0}-${kl.y1})`);
  const flyv = [];
  k.vis._grupper.luft.traverse((m) => { if (m.isMesh && m.userData.objekt?.y0 >= 50) flyv.push(m); });
  assert.equal(flyv.length, 1, 'kassen flyver hen til skytten');
  const x0 = flyv[0].position.x;
  k.frem(0.3, [f]);
  assert.ok(Math.abs(flyv[0].position.x - figur.x) < Math.abs(x0 - figur.x), 'mod skytten');
  k.frem(0.4, [f]);
  const tilbage = [];
  k.vis._grupper.luft.traverse((m) => { if (m.isMesh && m.userData.objekt?.y0 >= 50) tilbage.push(m); });
  assert.equal(tilbage.length, 0, 'og er væk');

  // Skudt ned: ingen kasse (den er en rigtig våbenkasse nu), og den tumler om sig selv.
  const n = lavKoersel();
  const g = dr();
  n.frem(0.3, [g]);
  n.vis.haendelse('fareAntaendt', { id: 3, slags: 'drone', nedskudt: true, kasse: 44, x: g.x, y: g.y }, n.t);
  g.pakke = null; g.tilst = 'styrt'; g.styrt = 240;
  n.frem(0.2, [g]);
  const r1 = Math.abs(n.post(3).drej.rotation.z);
  n.frem(0.4, [g]);
  const r2 = Math.abs(n.post(3).drej.rotation.z);
  assert.ok(!n.post(3).m.visible && n.post(3).klip.visible, 'nedskudt: dronen alene');
  assert.ok(r2 > r1 && r2 > 0.8, `den tumler (${r1.toFixed(2)} -> ${r2.toFixed(2)} rad)`);
  assert.ok(n.fx.tal.spor > 5, 'og ryger');
  n.vis.haendelse('fareVaek', { id: 3, slags: 'drone', grund: 'styrt', x: g.x, y: g.y }, n.t);
  n.frem(1 / 60, []);
  assert.ok(!(n.post(3)), 'nedslaget: braget dækker, dronen er væk');
});

test('det brændte græs: efter ilden, et minut, væk med jorden, et loft', () => {
  let hul = false;
  const bane = fladBane();
  const fast = bane.fast;
  bane.fast = (x, y) => !(hul && x > 1040 && x < 1080) && fast(x, y);
  const k = lavKoersel({ terraen: bane });
  const ild = [plet(10, 1000), plet(11, 1060)];
  k.frem(0.2, [], ild);
  assert.equal(k.vis._maerker.size, 0, 'ikke før ilden har brændt lidt');
  k.frem(0.3, [], ild);
  assert.equal(k.vis._maerker.size, 2);
  const [a] = k.vis._maerker.values();
  assert.ok(a.m.material.opacity < 1, 'det kommer blødt');
  k.frem(1.5, [], []);
  assert.equal(k.vis._maerker.size, 2, 'græsset bliver, når ilden er gået ud');
  assert.ok(Math.abs(a.m.material.opacity - 1) < 1e-9);
  hul = true;
  k.frem(1, [], []);
  assert.equal(k.vis._maerker.size, 1, 'jorden under det ene er skudt væk');
  k.frem(64, [], []);
  assert.equal(k.vis._maerker.size, 0, 'efter et minut er det tonet ud');
  // Loftet: de ældste går først.
  const mange = Array.from({ length: 80 }, (_, i) => plet(100 + i, 200 + i * 24));
  k.frem(0.5, [], mange);
  assert.equal(k.vis._maerker.size, 60);
});

test('mangler kunsten, tegnes intet, til den kommer', () => {
  let findes = false;
  const b = billeder();
  const k = lavKoersel({ billede: (n) => (findes ? b(n) : null) });
  k.frem(0.2, [ks(), dr({ pakke: null })], [plet(10, 900)]);
  assert.ok(!k.post(1).m.visible && !k.post(3).m.visible && !k.post(3).klip?.visible, 'usynlig uden billede');
  assert.ok(!k.vis._pletter.get(10).m.visible);
  findes = true;
  k.frem(0.1, [ks(), dr({ pakke: null })], [plet(10, 900)]);
  assert.ok(k.post(1).m.visible && k.post(3).klip.visible && k.vis._pletter.get(10).m.visible, 'synlig, når billedet kommer');
  assert.ok(k.post(1).m.material.map, 'atlasset sidder på quaden');
});

test('over nettet (hver 3. delta): glat bevægelse', () => {
  const k = lavKoersel();
  const f = ks();
  const trin = [];
  let sidst = null;
  // 60 wu/s: spejlet får en ny delta hver 3. tick (20 Hz; deltaens tick springer 3),
  // tegningen 60 gange i sekundet.
  let tick = 1000;
  k.frem(2, [f], [], (i) => {
    if (i % 3 === 0) { f.x += 3; tick += 3; }
    k.o.tick = tick;
    const p = k.post(1);
    if (p && sidst !== null && i > 30) trin.push(p.x - sidst);
    if (p) sidst = p.x;
  });
  const snit = trin.reduce((s, x) => s + x, 0) / trin.length;
  const vaerst = Math.max(...trin.map((x) => Math.abs(x - snit)));
  assert.ok(Math.abs(snit - 1) < 0.05, `1 wu pr. frame i snit (${snit.toFixed(3)})`);
  assert.ok(vaerst < 0.35, `ingen hop på 3 wu (største afvigelse ${vaerst.toFixed(2)})`);
});

test('over nettet (hver 3. delta): en fare, der er meldt væk, tegnes aldrig igen', () => {
  // Gæstens vej: værten sender hændelserne straks, men kun hver 3. delta, så
  // fareVaek kommer 1-2 tick før deltaen, der fjerner faren fra spejlet. Ved
  // dronens nedslag, vandet og kanten er dødsforløbet én frame; bagefter må
  // spejlets forældede drone ikke blive tegnet som en ny (oprejst, hel og med
  // kantpil), der så toner ud oven på sit eget brag.
  const opsaet = { froe: 9, banetype: 'aaben', hold: lavHold(2, 1) };
  for (const grund of ['styrt', 'vand', 'kant']) {
    let haltede = 0;
    for (const forskud of [0, 1, 2]) {          // hændelsens tick mod deltaernes takt
      const v = aktivVerden({ froe: 9, bane: 'aaben', hold: [2, 1] });
      const b = v.aktivBaever();
      let d;
      if (grund === 'kant') {
        // På vej ud over højre kant: væk om et par tick.
        d = FA.tving(v, 'drone', { side: 'v', pakke: null }, [], { x: v.terraen.w + FA.DR_UD - 8 - forskud * 2, ret: 1 });
      } else {
        let x = null;
        if (grund === 'vand') {
          // Havet ved banens kant (dronen flyver ind over land, væk fra kanten).
          for (let xx = 20; xx < v.terraen.w - 20 && x === null; xx += 20) if (jordVed(v, xx, 1500, 0) < v.vandNiveau - 60) x = xx;
        } else x = fladPlads(v, 300).x;
        assert.ok(x !== null, `${grund}: et sted til dronen`);
        const y = grund === 'vand' ? v.vandNiveau + 150 : jordVed(v, x, 1500, 0) + 200;
        d = FA.tving(v, 'drone', { side: 'v', pakke: null }, [], { x, y, hoejdeMaal: y });
        // Et brag ved dronen skyder den ned (som i farer_fysik.mjs).
        v.eksplosionsKoe.push({ x: d.x, y: d.y + d.hy - 10, radius: 30, skade: 0, knockback: 0, carve: false,
                                kilde: { kaedeId: 5, kildeHold: b.hold, kildeBaever: b.id, kaede: 0 } });
        koer(v, forskud);
      }
      const bus = lavBus();
      const { spejl, skridt } = spejlFra(v, opsaet, { bus, hvert: 3 });
      const vis = lavFareView(new Scene(), { fx: falskFx(), billede: billeder({ tomme: true }) });
      let t = 0, meldt = null, postVed = null, halt = 0;
      for (const navn of ['fareAntaendt', 'fareVaek', 'fareSpiste', 'fareLeveret', 'ildTaendt']) {
        bus.paa(navn, (e) => {
          vis.haendelse(navn, e, t);
          if (navn === 'fareVaek' && e.id === d.id) { meldt = e.grund; postVed = vis._poster.get(d.id) || null; }
        });
      }
      const o = { tick: 0, terraen: spejl.terraen };
      for (let i = 0; i < 480; i++) {
        skridt();
        t += 1 / 60; o.tick = spejl.tick;
        vis.opdater(spejl.farer, spejl.ild, t, o);
        if (meldt === null) continue;
        if (spejl.farer.some((f) => f.id === d.id)) halt++;
        const p = vis._poster.get(d.id);
        assert.ok(!p || p === postVed, `${grund} (${forskud}): dronen tegnes igen, ${halt} tick efter hændelsen`);
        assert.equal(vis.vist(d.id), null, `${grund} (${forskud}): pilen og skiltet ser en fare, der er væk`);
      }
      assert.equal(meldt, grund, `${grund} (${forskud}): scenariet`);
      assert.ok(!vis._poster.has(d.id), `${grund} (${forskud}): dronen er væk til sidst`);
      if (halt >= 2) haltede++;
    }
    assert.ok(haltede >= 1, `${grund}: spejlet haltede aldrig 2 tick efter hændelsen (testen prøver ikke vejen)`);
  }
  // Et snapshot, der kortvarigt mangler en fare ('ukendt'), er ingen gravsten:
  // kommer faren igen i spejlet, tegnes den igen.
  const k = lavKoersel();
  const f = ks();
  k.frem(0.2, [f]);
  k.frem(0.05, []);
  assert.equal(k.post(1)?.vaek?.grund, 'ukendt');
  k.frem(0.5, []);
  assert.ok(!k.post(1));
  k.frem(0.1, [f]);
  assert.ok(k.post(1) && !k.post(1).vaek && k.vis.vist(1), 'tegnet igen');
});

test('en rigtig kamp: tegningen følger spejlet, og intet hænger', () => {
  // Skriptede kampe (farer_hjaelp.mjs), der går efter farerne med scanneren,
  // med en fare hvert 15. s. Spejlet får snapshottet, så hændelserne og
  // deltaen hvert tick (som workeren sender dem); tegningen og brugerfladen
  // kører på spejlet, 60 frames i sekundet.
  const W = falskDom();
  const sum = { kom: 0, brand: 0, ild: 0, vaek: 0 };
  for (const [bane, froe] of [['aaben', 3], ['hule', 5], ['fort', 2]]) {
    const opsaet = { froe, banetype: bane, hold: lavHold(3, 3), cfg: { banetype: bane, turTicks: 1500, kampTicks: 43200 } };
    const bus = lavBus();
    const scene = new Scene();
    const fx = falskFx(), lyd = falskLyd(), hud = falskHud(), kamera = falskKamera();
    const vis = lavFareView(scene, { fx, billede: billeder({ tomme: true }) });
    const r = falskRenderer({ cx: 2560, cy: 700 });
    let spejl = null, ui = null, t = 0, maksPoster = 0, maksPletter = 0;
    const vaek = new Set();
    bus.paa('fareKommer', () => sum.kom++);
    bus.paa('fareAntaendt', () => sum.brand++);
    bus.paa('ildTaendt', () => sum.ild++);
    bus.paa('fareVaek', (e) => { sum.vaek++; vaek.add(e.id); });
    const o = { tick: 0, terraen: null, figur: (id) => spejl?.baevere.find((b) => b.id === id) };
    skriptetKamp({ froe, bane, hold: [3, 3], ticks: 30000, foerTick: hurtigeFarer, efter(v, h) {
      if (!spejl) {
        spejl = lavVerden({ ...opsaet, cfg: JSON.parse(JSON.stringify(v.cfg)) });
        spejl.genskab(JSON.parse(JSON.stringify(v.oejebliksbillede())));
        ui = kobFarer({ bus, hud, lyd, visning: { fx, farer: vis, kamera }, S: { verden: spejl, tilstand: 'spil', skudId: null }, r, rod: W.rod });
      }
      for (const e of h) bus.send(e.navn, JSON.parse(JSON.stringify(e)));
      anvendDelta(spejl, JSON.parse(JSON.stringify(v.delta())));
      t += 1 / 60; o.tick = spejl.tick; o.terraen = spejl.terraen;
      vis.opdater(spejl.farer, spejl.ild, t, o);
      ui.opdater(spejl);
      // Hver fare på spejlet har en tegning; en tegning uden fare er ved at dø.
      for (const f of spejl.farer) assert.ok(vis._poster.has(f.id) || vaek.has(f.id), `${bane}: fare ${f.id} tegnes ikke`);
      for (const [id, p] of vis._poster) {
        assert.ok(Number.isFinite(p.g.position.x) && Number.isFinite(p.g.position.y) && Number.isFinite(p.drej.rotation.z), `${bane}: NaN`);
        if (!p.vaek) assert.ok(spejl.farer.some((f) => f.id === id), `${bane}: fare ${id} er væk, men tegnes stadig`);
      }
      for (const [id, pl] of vis._pletter) assert.ok(pl.vaek !== null || spejl.ild.some((q) => q.id === id), `${bane}: plet ${id}`);
      maksPoster = Math.max(maksPoster, vis._poster.size);
      maksPletter = Math.max(maksPletter, [...vis._pletter.values()].filter((pl) => pl.vaek === null).length);
    } });
    assert.ok(maksPoster <= 2, `${bane}: højst én fare og én, der er ved at dø (${maksPoster})`);
    assert.ok(maksPletter <= 40, `${bane}: højst ILD_MAKS pletter tegnet (${maksPletter})`);
    assert.ok(vis._maerker.size <= 60);
    // Efter 3 s uden farer og ild er alt ryddet op, og fjern() rydder scenen.
    for (let i = 0; i < 180; i++) { t += 1 / 60; vis.opdater([], [], t, o); }
    assert.ok(vis._poster.size === 0 && vis._pletter.size === 0, `${bane}: ryddet op`);
    vis.fjern();
    assert.equal(scene.children.length, 0, `${bane}: fjern() rydder scenen`);
  }
  assert.ok(sum.kom >= 6 && sum.brand >= 1 && sum.vaek >= 3, `scenariet virker (${JSON.stringify(sum)})`);
});

// ------------------------------------------------------------ kontaktarket

/** Kør n tick hos værten og spejlet; tegningen hver tick. */
function koerVaert(v, opsaet, n, { hvert = null } = {}) {
  const bus = lavBus();
  const { spejl, skridt } = spejlFra(v, opsaet, { bus });
  const scene = new Scene();
  const vis = lavFareView(scene, { fx: falskFx(), billede: billeder() });
  for (const navn of ['fareAntaendt', 'fareVaek', 'fareSpiste', 'fareLeveret', 'ildTaendt']) bus.paa(navn, (e) => vis.haendelse(navn, e, t));
  let t = 0;
  const o = { tick: 0, terraen: spejl.terraen };
  const trin = (m) => {
    for (let i = 0; i < m; i++) {
      skridt(hvert);
      t += 1 / 60; o.tick = spejl.tick;
      vis.opdater(spejl.farer, spejl.ild, t, o);
    }
  };
  trin(n);
  return { scene, vis, spejl, trin };
}

test('kontaktarket: hver tilstand, og hver fare på en rigtig bane', { skip: !VAERKTOEJ.dwebp && 'dwebp mangler' }, () => {
  const celler = [];
  const S = 3;
  function celle(tekst, k, cx, cy, { terraen = fladBane(), vand = null, ringe = [] } = {}) {
    const ud = { x0: cx - 60, y0: cy - 20, b: 120, h: 90, s: S };
    const b = tegnScene(k.scene, { ...ud, terraen, vand, ringe });
    let daekket = 0;
    for (const a of b.alfa) if (a > 0.5) daekket++;
    assert.ok(daekket > 150, `${tekst}: der er tegnet noget (${daekket} px)`);
    skrivTekst(b, 4, 4, tekst, [255, 255, 255], 2);
    celler.push(b);
    return { b, ud };
  }
  const ring = (f) => [{ x: f.x, y: f.y + f.hy, r: f.r }];
  /** En syntetisk scene: trin er [sekunder, fn(k, i)?]; listerne gælder alle trin,
   *  undtagen når et trin har sine egne ([sekunder, fn, farer, ild]). */
  const syn = (tekst, farer, ild, trin, cy = JORD_Y) => {
    const k = lavKoersel();
    for (const [s, fn, fa = farer, il = ild] of trin) k.frem(s, fa, il, fn && ((i) => fn(k, i)));
    celle(tekst, k, 1000, cy, { ringe: farer.flatMap(ring) });
  };
  const f1 = ks();
  syn('kabelsalat', [f1], [], [[0.5]]);
  const f2 = ks();
  syn('ruller', [f2], [], [[0.7, (k, i) => { f2.x = 980 + i * 0.5; }]]);
  const f3 = ks();
  syn('kortslutning', [f3], [], [[0.2], [1 / 60, (k) => { if (!f3.brand) { k.vis.haendelse('fareAntaendt', { id: 1 }, k.t); f3.brand = 120; } }], [0.12]]);
  syn('brand', [ks({ brand: 90 })], [], [[0.8]]);
  syn('fald', [ks({ tilst: 'luft', y: JORD_Y + 30 })], [], [[0.3]]);
  const f4 = ks({ tilst: 'luft', y: JORD_Y + 30 });
  syn('land', [f4], [], [[0.3], [1 / 60, () => { f4.tilst = 'jord'; f4.y = JORD_Y + 1; }], [0.07]]);
  syn('nullermand', [ks({ hud: 'nullermand' })], [], [[0.5]]);
  syn('nullermand brand', [ks({ hud: 'nullermand', brand: 90 })], [], [[0.8]]);
  syn('stoevsuger', [rs()], [], [[0.6]]);
  syn('opdateres', [rs({ tilst: 'pause' })], [], [[0.55]]);
  syn('overophedet', [rs({ brand: 60 })], [], [[0.6]]);
  const f5 = rs();
  syn('nom', [f5], [], [[0.5], [1 / 60, (k) => k.vis.haendelse('fareSpiste', { id: 2 }, k.t)], [0.25]]);
  const LUFT = JORD_Y + 40;
  syn('drone', [dr()], [], [[0.5]], LUFT);
  const f6 = dr();
  syn('leveret', [f6], [], [[0.3], [1 / 60, (k) => { k.vis.haendelse('fareLeveret', { id: 3, baever: -1 }, k.t); f6.pakke = null; }], [0.2]], LUFT);
  syn('uden pakke', [dr({ pakke: null })], [], [[0.5]], LUFT);
  syn('nedskudt', [dr({ pakke: null, tilst: 'styrt', styrt: 200 })], [], [[1 / 60, (k) => k.vis.haendelse('fareAntaendt', { id: 3, nedskudt: true }, k.t)], [0.35]], LUFT);
  const ild = [plet(10, 964), plet(11, 988), plet(12, 1012), plet(13, 1036)];
  syn('ild', [], ild, [[0.8]]);
  syn('braendt graes', [], ild, [[0.8], [3, null, [], []]]);
  const f7 = ks();
  syn('aske', [f7], [], [[0.3], [1 / 60, (k) => k.vis.haendelse('fareVaek', { id: 1, grund: 'brag', x: f7.x, y: f7.y }, k.t)], [0.7]]);
  const f8 = rs();
  syn('batteri', [f8], [], [[0.3], [1 / 60, (k) => k.vis.haendelse('fareVaek', { id: 2, grund: 'brag', x: f8.x, y: f8.y }, k.t)], [0.45]]);

  // Rigtige baner: Kabelsalaten på den åbne bane, Nullermanden i grotten,
  // støvsugeren på fortet og dronen over øerne. Træfcirklen er stiplet.
  const rigtig = (bane, froe, lav, n, tekst, { brand = false } = {}) => {
    const hold = [2, 2];
    const opsaet = { froe, banetype: bane, hold: lavHold(...hold), cfg: { banetype: bane, turTicks: 108000, kampTicks: 43200, haendelseChance: 0, kasseChance: 0 } };
    const v = aktivVerden({ froe, bane, hold });
    const f = lav(v);
    const k = koerVaert(v, opsaet, n);
    if (brand) { const g = v.farer.find((q) => q.id === f.id); if (g) antaend(v, g); k.trin(150); }
    const q = k.spejl.farer.find((x) => x.id === f.id) || f;
    const ild = k.spejl.ild[0];
    const cx = ild && !k.spejl.farer.length ? ild.x : q.x, cy = ild && !k.spejl.farer.length ? ild.y : q.y;
    celle(tekst, k, cx, cy - 10, { terraen: v.terraen, vand: v.vandNiveau, ringe: k.spejl.farer.flatMap(ring) });
  };
  rigtig('aaben', 5, (v) => { const p = fladPlads(v, 300); return kabelsalatPaaJorden(v, p.x, p.y); }, 90, 'aaben: kabelsalat');
  rigtig('hule', 4, (v) => { const p = FA.steder(v).kabelsalat[0]; return FA.tving(v, 'kabelsalat', p); }, 260, 'hule: nullermand');
  rigtig('fort', 3, (v) => { const p = FA.steder(v).stoevsuger[0]; return FA.tving(v, 'stoevsuger', p); }, 120, 'fort: stoevsuger');
  rigtig('oeer', 6, (v) => FA.tving(v, 'drone', { side: 'v' }), 400, 'oeer: drone');
  rigtig('aaben', 5, (v) => { const p = fladPlads(v, 300); return kabelsalatPaaJorden(v, p.x, p.y); }, 30, 'aaben: ild og graes', { brand: true });

  const ark = kontaktark(celler, 5);
  const mappe = fileURLToPath(new URL('./billeder/', import.meta.url));
  mkdirSync(mappe, { recursive: true });
  skrivPng(`${mappe}farer_vis.png`, ark.w, ark.h, ark.rgb);
  assert.ok(atlas('kabelsalat') && atlas('braendt_graes'), 'atlasserne blev læst');
});
