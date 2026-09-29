/* Kundekrigen — test: vejledningens trin og kort (ui/hjaelp.js).
 *
 *   node --no-warnings --test test/vejledning_trin.mjs
 *
 * Playtest: "svært at tyde, om tutorial-beskederne progressede, fordi man
 * klikkede, eller om der var en timer." Trinmaskinen (lavVejledning) er ren
 * og får tiden ind som dt, så den kan køres her uden DOM og uden ur.
 *
 * 1. Intet skifter af sig selv: to minutter uden handling står stadig på 1/5.
 * 2. Hvert trin klares af sin handling, med "✓ Sådan!" i 450 ms (0 ved
 *    reduceret bevægelse); et trin gjort før tid springes over. Telefonens
 *    teleport (Omstillingen) er ikke spillerens og klarer intet.
 * 3. Skuddet: uret går igen, flaget gemmes, og slutkortet kommer først, når
 *    verden er i ro — med de trin, der mangler.
 * 4. Tasterne: Esc springer over (markøren går forud), mellemrummet tages kun
 *    på slutkortet, når det ikke er spillets.
 * 5. Flaget: én gang pr. browser, læst ved første dinTur; halvvejs er forfra.
 * 6. Teksterne og kortets HTML; lavHjaelp tegner med en lille falsk DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lavVejledning, lavHjaelp, kortHTML, TRIN, NOEGLE, KVITTER_S, SPRUNGET, SLUT, GRUPPER, VEJLEDNING_HAENDELSER,
} from '../static/js/ui/hjaelp.js';
import { falskDom } from './vejledning_hjaelp.mjs';

const DT = 1 / 60;

/** Et lager som localStorage, og en vejledning med log over ur og beskeder. */
function lav({ reduceret = false, lager = new Map() } = {}) {
  const ur = [], beskeder = [];
  const L = { hent: (k) => lager.get(k) ?? null, gem: (k, v) => lager.set(k, v) };
  const vj = lavVejledning({ lager: L, ur: (a) => ur.push(a), besked: (t) => beskeder.push(t), reduceret: () => reduceret });
  return { vj, ur, beskeder, lager };
}

const TONER = { navn: 'Tonerkanon', sigte: 'vinkel+kraft', kategori: 'skyts' };
/** Min egen tur, mellemrummet er spillets. */
const egen = (o = {}) => ({ dt: DT, tilstand: 'spiller_aktiv', egenTur: true, vaaben: TONER, gaar: false, sigter: false, uretVenter: true, ...o });
const andres = (tilstand, o = {}) => egen({ tilstand, egenTur: false, uretVenter: false, ...o });

/** n frames med samme ctx; den sidste visning. */
function frames(vj, n, ctx) { let vis = null; for (let i = 0; i < n; i++) vis = vj.opdater(ctx); return vis; }

test('intet skifter af sig selv: to minutter uden handling står stadig på gå, 1/5', () => {
  const { vj, ur } = lav();
  vj.dinTur();
  assert.deepEqual(ur, [true], 'uret venter fra starten');
  const vis = frames(vj, 60 * 120, egen());
  assert.equal(vis.kort, 'trin');
  assert.equal(vis.id, 'gaa');
  assert.equal(`${vis.nr}/${vis.antal}`, '1/5');
  assert.equal(vis.ok, false);
  assert.deepEqual(vis.pips, ['nu', '', '', '', '']);
  assert.deepEqual(ur, [true], 'ingen skjult timer har rørt uret');
});

test('gå i 0,5 s: ✓ i 450 ms, så hop 2/5', () => {
  const { vj } = lav();
  vj.dinTur();
  frames(vj, 10, egen());
  let vis = frames(vj, 29, egen({ gaar: true }));
  assert.equal(vis.id, 'gaa'); assert.equal(vis.ok, false, '0,48 s er ikke nok');
  vis = frames(vj, 1, egen({ gaar: true }));
  assert.equal(vis.id, 'gaa'); assert.equal(vis.ok, true, '0,5 s: klaret');
  assert.deepEqual(vis.pips, ['nu', '', '', '', ''], 'det klarede trin blinker ikke over til næste');
  // Kvitteringen står ~450 ms — og kun den (gangen tæller ikke mere).
  let ok = 1;
  for (let i = 0; i < 60; i++) { vis = vj.opdater(egen()); if (vis.ok) ok++; else break; }
  assert.ok(Math.abs(ok * DT - KVITTER_S) <= 2 * DT, `✓ stod ${Math.round(ok * DT * 1000)} ms`);
  assert.equal(vis.id, 'hop');
  assert.equal(`${vis.nr}/${vis.antal}`, '2/5');
  assert.deepEqual(vis.pips, ['ok', 'nu', '', '', '']);
});

test('gangen tæller sammen, men kun i egen tur', () => {
  const { vj } = lav();
  vj.dinTur();
  frames(vj, 20, egen({ gaar: true }));
  frames(vj, 60, andres('oploesning', { gaar: true }));
  let vis = frames(vj, 9, egen({ gaar: true }));
  assert.equal(vis.ok, false);
  vis = frames(vj, 1, egen({ gaar: true }));
  assert.equal(vis.ok, true);
});

test('et trin gjort før tid springes over, og tælleren hopper', () => {
  const { vj } = lav();
  vj.dinTur();
  vj.opdater(egen());
  vj.noter('vaabenValgt');                      // våbnet valgt, mens gå-trinnet står
  let vis = vj.opdater(egen());
  assert.equal(vis.id, 'gaa'); assert.equal(vis.ok, false, 'ingen kvittering for et trin, der ikke står fremme');
  assert.deepEqual(vis.pips, ['nu', '', '', 'ok', '']);
  frames(vj, 31, egen({ gaar: true }));
  frames(vj, 30, egen());
  vj.noter('salto');                            // baglæns saltomortale klarer hop
  vis = vj.opdater(egen());
  assert.equal(vis.id, 'hop'); assert.equal(vis.ok, true);
  vis = frames(vj, 30, egen());
  assert.equal(vis.id, 'sigt'); assert.equal(`${vis.nr}/5`, '3/5');
  frames(vj, 25, egen({ sigter: true }));
  vis = frames(vj, 30, egen());
  assert.equal(vis.id, 'skyd', 'våben-trinnet er gjort og springes over');
  assert.equal(`${vis.nr}/5`, '5/5');
  assert.deepEqual(vis.pips, ['ok', 'ok', 'ok', 'ok', 'nu']);
});

test('reduceret bevægelse: ✓ skifter med det samme', () => {
  const { vj } = lav({ reduceret: true });
  vj.dinTur();
  vj.opdater(egen());
  vj.noter('hop');
  let vis = frames(vj, 29, egen({ gaar: true }));
  assert.equal(vis.id, 'gaa');
  vis = vj.opdater(egen({ gaar: true }));
  assert.equal(vis.id, 'sigt', 'gå klaret, hop allerede gjort — ingen pause imellem');
  assert.equal(vis.ok, false);
});

test('skuddet: uret går, flaget gemmes, og slutkortet kommer først i ro', () => {
  const { vj, ur, lager, beskeder } = lav();
  vj.dinTur();
  frames(vj, 31, egen({ gaar: true }));
  frames(vj, 30, egen());
  assert.equal(vj.opdater(egen()).id, 'hop');
  vj.noter('skudAffyret');
  assert.deepEqual(ur, [true, false], 'klientens pause er slået fra');
  assert.equal(lager.get(NOEGLE), '1');
  let vis = vj.opdater(andres('affyring'));
  assert.equal(vis, null, 'hop stod fremme, ikke skyd: ingen kvittering');
  vis = frames(vj, 120, andres('oploesning'));
  assert.equal(vis, null, 'ikke under opløsningen');
  vis = vj.opdater(andres('skade'));
  assert.equal(vis.kort, 'slut');
  assert.equal(`${vis.nr}/${vis.antal}`, '2/5');
  assert.deepEqual(vis.pips, ['ok', '', '', '', 'ok']);
  assert.deepEqual(vis.mangler.map((t) => t.id), ['hop', 'sigt', 'vaaben']);
  assert.equal(vis.mellemrumErSpil, false);
  assert.equal(vis.tekst, SLUT.tekst);
  assert.deepEqual(beskeder, []);
});

test('skuddet, mens skyd-trinnet står: ✓ på det, så slutkortet', () => {
  const { vj } = lav();
  vj.dinTur();
  for (const n of ['hop', 'vaabenValgt']) vj.noter(n);
  frames(vj, 31, egen({ gaar: true, sigter: true }));
  let vis = frames(vj, 30, egen());
  assert.equal(vis.id, 'skyd');
  vj.noter('redskabStart');                     // boret er også et "skud"
  vis = vj.opdater(andres('affyring'));
  assert.equal(vis.id, 'skyd'); assert.equal(vis.ok, true);
  vis = frames(vj, 30, andres('oploesning'));
  assert.equal(vis, null);
  vis = vj.opdater(andres('tur_slut'));
  assert.equal(vis.kort, 'slut');
  assert.deepEqual(vis.mangler, [], 'alle trin er gjort');
  assert.equal(`${vis.nr}/5`, '5/5');
});

test('et våben, der beholder turen: slutkortet venter, til turen er forbi', () => {
  const { vj } = lav();
  vj.dinTur();
  vj.opdater(egen());
  vj.noter('skjoldOp');                         // Hjemmearbejde: turen fortsætter
  assert.equal(frames(vj, 60, egen()), null, 'i min tur (mellemrummet er spillets): intet kort');
  assert.equal(vj.opdater(andres('skade')).kort, 'slut');
  // Når det først er fremme, bliver det — også i næste spillers tur.
  const vis = vj.opdater(egen());
  assert.equal(vis.kort, 'slut');
  assert.equal(vis.mellemrumErSpil, true);
});

test('mellemrum og Esc', () => {
  const { vj, ur, lager, beskeder } = lav();
  vj.dinTur();
  assert.equal(vj.tast('Escape', { egenTur: true }), null, 'intet kort fremme endnu');
  vj.opdater(egen());
  assert.equal(vj.tast('Space', { egenTur: true }), null, 'mellemrummet på et trinkort er spillets');
  assert.equal(vj.tast('Space', { egenTur: false }), null, 'og ikke "videre" på et trinkort');
  assert.equal(vj.tast('Enter', { egenTur: true }), null);
  assert.equal(vj.tast('Escape', { egenTur: true, markoer: true }), null, 'markøren går forud');
  assert.equal(vj.aktiv, true);
  assert.equal(vj.tast('Escape', { egenTur: true }), 'sprunget');
  assert.equal(vj.aktiv, false);
  assert.deepEqual(ur, [true, false]);
  assert.equal(lager.get(NOEGLE), '1');
  assert.deepEqual(beskeder, [SPRUNGET]);
  assert.equal(SPRUNGET, 'Vejledningen er sprunget over · ? viser alle taster');
  assert.equal(vj.opdater(egen()), null);
  assert.equal(vj.tast('Escape', { egenTur: true }), null, 'næste Esc er pausen');
});

test('slutkortet: mellemrum kun, når det ikke er spillets; Esc lukker uden banner', () => {
  // Over nettet / i ro: mellemrum går videre.
  {
    const { vj } = lav();
    vj.dinTur(); vj.opdater(egen()); vj.noter('skudAffyret');
    vj.opdater(andres('skade'));
    assert.equal(vj.tast('Space', { egenTur: false }), 'videre');
    assert.equal(vj.opdater(andres('skade')), null);
  }
  // Ét tastatur: næste spillers tur er begyndt — mellemrummet er spillets.
  {
    const { vj, beskeder, ur } = lav();
    vj.dinTur(); vj.opdater(egen()); vj.noter('skudAffyret');
    vj.opdater(andres('skade'));
    const vis = vj.opdater(egen());
    assert.equal(vis.kort, 'slut');
    assert.match(kortHTML(vis), /Tryk <kbd>Esc<\/kbd> for at lukke/);
    assert.equal(vj.tast('Space', { egenTur: true }), null, 'mellemrummet lader op for spiller 2');
    assert.equal(vj.tast('Escape', { egenTur: true, markoer: true }), null, 'markøren går forud');
    assert.equal(vj.tast('Escape', { egenTur: true }), 'lukket');
    assert.deepEqual(beskeder, [], 'intet "sprunget over"');
    assert.deepEqual(ur, [true, false], 'intet nyt til uret');
    assert.equal(vj.opdater(egen()), null);
  }
});

test('turen slutter uden skud: skjult, og samme trin ved næste dinTur', () => {
  const { vj, ur } = lav();
  vj.dinTur();
  frames(vj, 31, egen({ gaar: true }));
  let vis = frames(vj, 30, egen());
  assert.equal(vis.id, 'hop');
  // Stå over / tiden løber ud: modspillerens tur.
  assert.equal(frames(vj, 300, andres('spiller_aktiv')), null);
  assert.equal(vj.tast('Escape', { egenTur: false }), null, 'intet kort fremme: Esc er pausen');
  vj.dinTur();
  assert.deepEqual(ur, [true, true], 'uret venter igen i den nye tur');
  vis = vj.opdater(egen());
  assert.equal(vis.id, 'hop');
  assert.equal(`${vis.nr}/5`, '2/5');
});

test('flaget: én gang pr. browser, læst ved første dinTur, halvvejs er forfra', () => {
  const lager = new Map();
  // Kampen slutter midt i: intet gemmes.
  let k = lav({ lager });
  k.vj.dinTur(); k.vj.opdater(egen());
  k.vj.ryd();
  assert.equal(lager.get(NOEGLE), undefined);
  k.vj.dinTur();
  assert.equal(k.vj.opdater(egen()).id, 'gaa', 'næste kamp: forfra');
  // Springes den over, kommer den ikke igen — heller ikke i en ny kamp.
  k.vj.tast('Escape', { egenTur: true });
  k.vj.dinTur();
  assert.equal(k.vj.opdater(egen()), null);
  const ny = lav({ lager });
  ny.vj.dinTur();
  assert.equal(ny.vj.aktiv, false);
  assert.deepEqual(ny.ur, [], 'flaget er sat: ingen pause');
  assert.equal(ny.vj.opdater(egen()), null);
  // Den gamle nøgle (v1, på et ur) tæller ikke.
  const gammel = lav({ lager: new Map([['baevere.hjaelpVist.v1', '1']]) });
  gammel.vj.dinTur();
  assert.equal(gammel.vj.aktiv, true);
  assert.equal(NOEGLE, 'baevere.hjaelpVist.v2');
});

test('flaget læses kun ved kampens første dinTur', () => {
  const lager = new Map();
  const { vj } = lav({ lager });
  vj.dinTur(); vj.opdater(egen());
  vj.noter('skudAffyret');
  vj.opdater(andres('skade'));
  vj.tast('Space', { egenTur: false });
  lager.delete(NOEGLE);                         // fx en anden fane
  vj.dinTur();
  assert.equal(vj.aktiv, false, 'én gang pr. kamp');
});

test('visIgen: forfra fra 1/5 og rører ikke flaget', () => {
  const lager = new Map([[NOEGLE, '1']]);
  const { vj, ur } = lav({ lager });
  vj.dinTur();
  assert.equal(vj.aktiv, false);
  vj.visIgen();
  assert.deepEqual(ur, [], 'uret sendes af main.js (kun i egen tur)');
  assert.equal(vj.opdater(andres('spiller_aktiv')), null, 'i modstanderens tur: vises i min næste');
  vj.dinTur();
  assert.deepEqual(ur, [true]);
  const vis = vj.opdater(egen());
  assert.equal(vis.id, 'gaa'); assert.equal(vis.nr, 1);
  assert.equal(lager.get(NOEGLE), '1');
});

test('skyd-trinnet følger våbnet i hånden', () => {
  const { vj } = lav({ reduceret: true });
  vj.dinTur();
  for (const n of ['hop', 'vaabenValgt']) vj.noter(n);
  vj.opdater(egen({ gaar: true, sigter: true, dt: 1 }));
  const med = (vaaben) => vj.opdater(egen({ vaaben }));
  let v = med(TONER);
  assert.equal(v.id, 'skyd');
  assert.equal(v.tekst, 'Jo længere du holder, jo længere flyver skuddet. Vinden tager det med.');
  assert.equal(v.goer, 'Hold for at lade op — slip for at skyde');
  assert.deepEqual(v.taster, ['MELLEMRUM']); assert.equal(v.tastTrin, 'skyd');
  v = med({ navn: 'Splintbøsse', sigte: 'vinkel' });
  assert.equal(v.tekst, 'Splintbøsse skyder lige ud i sigteretningen.'); assert.equal(v.goer, 'Tryk for at skyde');
  v = med({ navn: 'Fjernsupport', sigte: 'markoer' });
  assert.equal(v.tekst, 'Første tryk viser en markør. Flyt den med piletasterne — T springer til næste fjende.');
  assert.equal(v.goer, 'Tryk, flyt markøren, tryk igen');
  v = med({ navn: 'Phishing-mine', sigte: 'ingen' });
  assert.equal(v.tekst, 'Phishing-mine bruges dér, hvor du står.'); assert.equal(v.goer, 'Tryk for at bruge den');
  v = med({ navn: 'Klageklask', sigte: 'retning' });
  assert.equal(v.tekst, 'Klageklask rammer den, der står lige foran dig.'); assert.equal(v.goer, 'Tryk for at slå');
  v = med({ navn: 'Sæt på hold', sigte: 'ingen', kategori: 'meta' });
  assert.equal(v.tekst, 'Sæt på hold afslutter bare turen. Vælg et rigtigt våben for at prøve et skud.');
  assert.deepEqual(v.taster, ['1', '…', '0']); assert.equal(v.goer, 'Vælg et våben');
  assert.equal(v.tastTrin, 'vaaben', 'tastebjælken peger på tallene');
  v = med(null);
  assert.equal(v.goer, 'Hold for at lade op — slip for at skyde', 'uden våben: standardteksten');
});

test('hændelserne: hvert navn klarer sit trin', () => {
  assert.deepEqual(VEJLEDNING_HAENDELSER.sort(),
    ['hop', 'redskabStart', 'salto', 'skjoldOp', 'skudAffyret', 'teleport', 'terraenBygget', 'vaabenValgt'].sort());
  for (const [navn, trin] of [['hop', 'hop'], ['salto', 'hop'], ['vaabenValgt', 'vaaben'], ['teleport', 'skyd'], ['terraenBygget', 'skyd']]) {
    const { vj } = lav();
    vj.dinTur(); vj.opdater(egen());
    vj.noter(navn);
    assert.ok(vj.klaret.includes(trin), `${navn} → ${trin}`);
  }
  const { vj } = lav();
  vj.noter('skudAffyret');
  assert.equal(vj.aktiv, false, 'uden vejledning: ingenting');
  vj.dinTur(); vj.opdater(egen());
  vj.noter('eksplosion');
  assert.deepEqual(vj.klaret, []);
});

test('hændelserne: Omstillingens teleport (telefonen) klarer intet — Fjernsupports gør', () => {
  const { vj, ur, lager } = lav();
  vj.dinTur(); vj.opdater(egen());
  vj.noter('teleport', { navn: 'teleport', baever: 1, kilde: 'telefon', fraX: 0, fraY: 0, x: 900, y: 500 });
  assert.equal(vj.fase, 'trin');
  assert.deepEqual(vj.klaret, []);
  assert.deepEqual(ur, [true], 'uret venter stadig');
  assert.equal(lager.has(NOEGLE), false);
  vj.noter('teleport', { navn: 'teleport', baever: 1, fraX: 0, fraY: 0, x: 900, y: 500 });
  assert.equal(vj.fase, 'slut');
  assert.deepEqual(ur, [true, false]);
  assert.equal(lager.get(NOEGLE), '1');
});

test('teksterne: trinene og kortets HTML', () => {
  assert.deepEqual(TRIN.map((t) => t.id), ['gaa', 'hop', 'sigt', 'vaaben', 'skyd']);
  assert.equal(TRIN[0].tekst, 'Det er din tur. Flyt din kunde derhen, hvor du vil stå.');
  assert.equal(TRIN[1].tekst, 'Hop op på kanter og over huller. Backspace er en baglæns saltomortale.');
  assert.equal(TRIN[2].tekst, 'Sigtekornet foran kunden viser, hvor du skyder hen. Hold Shift for at finsigte.');
  assert.equal(TRIN[3].tekst, 'Tallene vælger våben på bjælken nederst. Tab — eller «Flere våben» i venstre side — åbner hele arsenalet.');
  const { vj } = lav();
  vj.dinTur();
  let h = kortHTML(vj.opdater(egen()));
  assert.match(h, /<span class="vj-navn">Vejledning<\/span>/);
  assert.match(h, /<span class="vj-venter">Uret venter<\/span>/);
  assert.match(h, /<span class="vj-tal num">1\/5<\/span>/);
  assert.match(h, /<span class="vj-lbl">Gør det<\/span><kbd>←<\/kbd><kbd>→<\/kbd>/);
  assert.match(h, /<span class="vj-hvad">Gå<\/span><span class="vj-ok" aria-hidden="true">✓ Sådan!<\/span>/);
  assert.match(h, /data-vj="spring"><kbd>Esc<\/kbd> spring vejledningen over<\/button>/);
  assert.match(h, /tabindex="-1"/);
  h = kortHTML(vj.opdater(egen({ uretVenter: false })));
  assert.doesNotMatch(h, /Uret venter/, 'kun mens kvoten løber');
  // Våben-trinnet: "…" står mellem tastebillederne.
  for (const n of ['hop']) vj.noter(n);
  vj.opdater(egen({ gaar: true, sigter: true, dt: 1 }));
  h = kortHTML(frames(vj, 30, egen()));
  assert.match(h, /<kbd>1<\/kbd>…<kbd>0<\/kbd>/);
  // Slutkortet.
  vj.noter('skudAffyret');
  const slut = vj.opdater(andres('skade'));
  h = kortHTML(slut);
  assert.match(h, /Vejledning · klar/);
  assert.match(h, /<span class="vj-tal num">4\/5<\/span>/);
  assert.match(h, /Sådan! Våbnene har få skud\. Forsyningskasser daler ned i faldskærm — gå hen og saml dem op, så får du flere\./);
  assert.match(h, /<p class="vj-husk">Husk også: <kbd>1<\/kbd>…<kbd>0<\/kbd> våben<\/p>/);
  assert.match(h, /data-vj="videre">Tryk <kbd class="lang">MELLEMRUM<\/kbd> for at fortsætte<\/button>/);
  assert.match(h, /<kbd>\?<\/kbd> alle taster · Vejledningen kan vises igen fra pausemenuen/);
  assert.doesNotMatch(h, /spring vejledningen over/);
  // Alt er escapet.
  assert.match(kortHTML({ ...slut, tekst: '<b>' }), /&lt;b&gt;/);
});

test('oversigten: Esc-rækken og pausemenuen', () => {
  const andet = new Map(GRUPPER.find(([n]) => n === 'Andet')[1]);
  assert.equal(andet.get('Esc'), 'Pause — eller spring vejledningen over, mens den står fremme');
  assert.equal(andet.get('Pausemenuen'), 'Vis vejledningen igen');
});

test('kildekoden: ingen timere, intet vægur og ingen hint() i vejledningen', () => {
  const k = readFileSync(fileURLToPath(new URL('../static/js/ui/hjaelp.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbudt of ['setTimeout', 'setInterval', 'performance.', 'Date.now', 'hint(', 'FOERSTE_TUR', 'visBoble']) {
    assert.ok(!k.includes(forbudt), `hjaelp.js bruger ${forbudt}`);
  }
});

// ------------------------------------------------------------------ lavHjaelp med en lille falsk DOM

test('lavHjaelp: kortet tegnes kun om, når det ændrer sig, og tastebjælken peger', () => {
  const { rod, boks, punkter } = falskDom();
  const lager = new Map();
  const ur = [];
  const hj = lavHjaelp(rod, { ur: (a) => ur.push(a), besked: () => {},
    lager: { hent: (k) => lager.get(k) ?? null, gem: (k, v) => lager.set(k, v) } });
  assert.match(rod.innerHTML, /id="hjBoble" role="status" aria-live="polite"/);
  assert.deepEqual(punkter().map((p) => p.dataset.trin), ['gaa', 'sigt', 'skyd', 'hop', 'vaaben']);
  assert.equal('hint' in hj, false, 'hint() er væk');
  hj.dinTur();
  for (let i = 0; i < 10; i++) hj.opdater(egen());
  assert.equal(boks.className, 'hjboble vejl bund');
  assert.equal(boks.skrevet, 1, 'samme kort: ét skriv');
  assert.deepEqual(punkter().filter((p) => p.classList.contains('nu')).map((p) => p.dataset.trin), ['gaa']);
  for (let i = 0; i < 31; i++) hj.opdater(egen({ gaar: true }));
  assert.equal(boks.className, 'hjboble vejl bund klaret');
  for (let i = 0; i < 30; i++) hj.opdater(egen());
  assert.match(boks.innerHTML, /2\/5/);
  assert.deepEqual(punkter().filter((p) => p.classList.contains('nu')).map((p) => p.dataset.trin), ['hop']);
  assert.equal(boks.skrevet, 3, 'gå, gå ✓ og hop');
  // Klik på "spring over" gør det samme som Esc.
  let blur = 0;
  boks.lyttere.click({ target: { closest: () => ({ dataset: { vj: 'spring' }, blur: () => blur++ }) } });
  assert.equal(blur, 1, 'knappen beholder ikke fokus');
  assert.equal(boks.className, 'hjboble hide');
  assert.deepEqual(ur, [true, false]);
  assert.equal(lager.get(NOEGLE), '1');
  assert.equal(punkter().some((p) => p.classList.contains('nu')), false);
  hj.opdater(egen());
  assert.equal(boks.className, 'hjboble hide');
});

test('lavHjaelp: slutkortet lukkes med et klik eller mellemrum, og tast siger hvad der skete', () => {
  const { rod, boks } = falskDom();
  const hj = lavHjaelp(rod, { lager: { hent: () => null, gem: () => {} } });
  hj.dinTur(); hj.opdater(egen());
  hj.noter('skudAffyret');
  hj.opdater(andres('oploesning'));
  assert.equal(boks.className, 'hjboble hide');
  hj.opdater(andres('skade'));
  assert.equal(boks.className, 'hjboble vejl bund slut');
  assert.equal(hj.tast({ code: 'Space' }, { egenTur: true }), null);
  assert.equal(hj.tast({ code: 'Space' }, { egenTur: false }), 'videre');
  assert.equal(boks.className, 'hjboble hide');
  // Et nyt forløb (pausemenuen), og slutkortet lukkes med et klik.
  hj.visIgen(); hj.dinTur(); hj.opdater(egen()); hj.noter('skudAffyret');
  hj.opdater(andres('skade'));
  boks.lyttere.click({ target: { closest: () => ({ dataset: { vj: 'videre' }, blur() {} }) } });
  assert.equal(boks.className, 'hjboble hide');
  assert.equal(hj.vejledning.aktiv, false);
  // Et klik ved siden af knapperne gør intet.
  hj.visIgen(); hj.dinTur(); hj.opdater(egen());
  boks.lyttere.click({ target: { closest: () => null } });
  assert.equal(hj.vejledning.aktiv, true);
  hj.ryd();
  assert.equal(boks.className, 'hjboble hide');
});

test('lavHjaelp: kortet flytter op, når den aktive kunde står bag det, og ned igen (hysterese)', () => {
  const { rod, boks } = falskDom();
  // Skærmen er 768 høj; kortet nederst står fra 404 til 561 (som målt i browseren).
  const gemtVindue = globalThis.window;
  globalThis.window = { innerHeight: 768 };
  boks.getBoundingClientRect = () => ({ top: 404, bottom: 561, height: 157 });
  try {
    const hj = lavHjaelp(rod, { lager: { hent: () => null, gem: () => {} } });
    hj.dinTur();
    hj.opdater({ ...egen(), fodY: 300 });
    assert.equal(boks.className, 'hjboble vejl bund', 'kunden står over kortet: nederst');
    hj.opdater({ ...egen(), fodY: 483 });
    assert.equal(boks.className, 'hjboble vejl oppe', 'kunden står bag kortet: op');
    hj.opdater({ ...egen(), fodY: 380 });
    assert.equal(boks.className, 'hjboble vejl oppe', 'lige over kanten: bliver oppe (hysterese)');
    hj.opdater({ ...egen(), fodY: 300 });
    assert.equal(boks.className, 'hjboble vejl bund', 'langt over: ned igen');
    hj.opdater({ ...egen(), fodY: null });
    assert.equal(boks.className, 'hjboble vejl bund', 'ingen kunde: nederst');
  } finally {
    globalThis.window = gemtVindue;
  }
});
