/* Kundekrigen — test: farernes lyde (ui/lyd.js, ui/farer.js, vaerktoej/kontorlyde.py).
 *
 *   node --no-warnings --test test/farer_vis_lyd.mjs
 *
 * Den RIGTIGE ui/lyd.js i et falsk lydmiljø (en AudioContext med styret ur;
 * varighederne læses af de rigtige .ogg-filer), med den rigtige ui/farer.js
 * ovenpå:
 * 1. Filerne: hver gruppe i lyd.js' GRUPPER har sine k_<gruppe>_n.ogg og en
 *    GRUPPE_VOL, og farernes grupper står i kontorlyde.py.
 * 2. Én lyd ad gangen: KORTSLUTNING lige efter braget, der tændte den, kommer
 *    efter braget, aldrig oven i det; varslet under en vigtig replik venter
 *    eller falder bort, men tager aldrig en af de vigtige pladser.
 * 3. Ildens knitren er en løkke, der tier (gain 0), mens en anden lyd spiller:
 *    kanalens lyde, men også flyvelyden (lyd.flyvelyd) og boret ('bor'-løkken),
 *    der ikke går gennem kanalen — og til de er tonet ud.
 * 4. lyd.har: grupper og filer, og en valgfri lyd, der mangler, advarer ikke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STATIC, kilde, falskDom, falskFx, falskHud, falskKamera, falskRenderer } from './farer_vis_hjaelp.mjs';

// ------------------------------------------------------------ det falske lydmiljø

const ur = { nu: 0 };
const spillet = [];                     // { navn, t0, slut, stoppet }
const aktive = new Set();
const timere = [];
let timerId = 1;

function oggVarighed(buf) {
  const i = buf.indexOf(Buffer.from('\x01vorbis', 'latin1'));
  if (i < 0) return 0.5;
  const rate = buf.readUInt32LE(i + 12);
  const j = buf.lastIndexOf(Buffer.from('OggS', 'latin1'));
  return Number(buf.readBigInt64LE(j + 6)) / rate;
}
class Param { constructor(v = 0) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {}
  cancelScheduledValues() {} setTargetAtTime(v) { this.value = v; } }
class Node { connect(n) { this.ud = n; } disconnect() {} }
class Kilde extends Node {
  constructor() { super(); this.playbackRate = new Param(1); this.buffer = null; this.onended = null; this.loop = false; }
  start() {
    this.slut = this.loop ? Infinity : ur.nu + this.buffer.duration / this.playbackRate.value;
    this.rec = { navn: this.buffer.navn, t0: ur.nu, slut: this.slut, stoppet: false, kilde: this };
    spillet.push(this.rec);
    aktive.add(this);
  }
  stop(t) { const s = Math.max(ur.nu, t ?? ur.nu); if (s < this.slut) { this.slut = s; this.rec.slut = s; this.rec.stoppet = true; } }
}
const gains = [];                       // alle gain-knuder i oprettelsesorden (den første er master)
class AC {
  constructor() { this.state = 'running'; this.destination = new Node(); this.sampleRate = 44100; }
  get currentTime() { return ur.nu; }
  createGain() { const n = new Node(); n.gain = new Param(1); gains.push(n); return n; }
  createBufferSource() { return new Kilde(); }
  createStereoPanner() { const n = new Node(); n.pan = new Param(0); return n; }
  createMediaElementSource() { return new Node(); }
  // Til flyvelyden (støj gennem et filter, en tone og en LFO).
  createBiquadFilter() { const n = new Node(); n.frequency = new Param(0); n.Q = new Param(0); return n; }
  createOscillator() { const n = new Node(); n.frequency = new Param(0); n.start = () => {}; return n; }
  createBuffer(kanaler, n, rate) { return { duration: n / rate, getChannelData: () => new Float32Array(n) }; }
  resume() { return Promise.resolve(); }
  decodeAudioData(b) { return Promise.resolve(b); }
}
class Audio { constructor() { this.readyState = 4; this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} }

const advarsler = [];
const aegteWarn = console.warn;
console.warn = (...a) => { advarsler.push(a.join(' ')); };
falskDom();                              // document, window og localStorage til ui/farer.js
Object.assign(globalThis.window, { addEventListener() {}, AudioContext: AC });
globalThis.location = { search: '' };
globalThis.Audio = Audio;
try { Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }); } catch { /* findes */ }
globalThis.fetch = async (url) => {
  const navn = String(url).split('/').pop().replace(/\.ogg$/, '');
  const p = `${STATIC}lyd/${navn}.ogg`;
  if (!fs.existsSync(p)) return { ok: false, status: 404, arrayBuffer: async () => { throw new Error('404'); } };
  const d = oggVarighed(fs.readFileSync(p));
  return { ok: true, arrayBuffer: async () => ({ duration: d, navn }) };
};
const aegteSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0) => { const id = timerId++; timere.push({ due: ur.nu + ms / 1000, fn, id }); return id; };
globalThis.clearTimeout = (id) => { const i = timere.findIndex((t) => t.id === id); if (i >= 0) timere.splice(i, 1); };
performance.now = () => ur.nu * 1000;
const vent = () => new Promise((r) => aegteSetTimeout(r, 0));

const lyd = await import('../static/js/ui/lyd.js');
const { kobFarer } = await import('../static/js/ui/farer.js');
const { lavBus } = await import('../static/js/core/bus.js');
for (let i = 0; i < 50; i++) await vent();                 // lydene hentes (NAVNE)
lyd.hentLyde(['stemme_eksplosion', 'stemme_eksplosion_3', 'stemme_announcer_doed', 'stemme_ingrid_tur']);   // main.js henter ALLE_STEMMER
for (let i = 0; i < 50; i++) await vent();
console.warn = aegteWarn;

/** Gå tiden frem i trin på 16 ms: lyde slutter, timere fyrer, brugerfladen opdateres. */
function gaa(dt, ui = null, v = null) {
  const maal = ur.nu + dt;
  while (ur.nu < maal - 1e-9) {
    const trin = Math.min(0.016, maal - ur.nu), til = ur.nu + trin;
    for (;;) {
      let naeste = Infinity, hvad = null;
      for (const k of aktive) if (k.slut <= til && k.slut < naeste) { naeste = k.slut; hvad = ['k', k]; }
      for (const t of timere) if (t.due <= til && t.due < naeste) { naeste = t.due; hvad = ['t', t]; }
      if (!hvad) break;
      ur.nu = Math.max(ur.nu, naeste);
      if (hvad[0] === 'k') { aktive.delete(hvad[1]); hvad[1].onended?.(); } else { timere.splice(timere.indexOf(hvad[1]), 1); hvad[1].fn(); }
    }
    ur.nu = til;
    ui?.opdater(v);
  }
}
/** Lyde, der lød samtidig (bortset fra 40-50 ms udtoning, når en lyd tages af forrang). Løkker tæller ikke. */
function overlap(fra = 0) {
  const s = spillet.filter((x) => x.t0 >= fra && x.slut !== Infinity).sort((a, b) => a.t0 - b.t0);
  const ud = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    if (s[j].t0 >= s[i].slut - 1e-9) continue;
    if (s[i].stoppet && s[i].slut - s[j].t0 <= 0.051) continue;
    ud.push(`${s[i].navn}@${s[i].t0.toFixed(2)} / ${s[j].navn}@${s[j].t0.toFixed(2)}`);
  }
  return ud;
}

function lavUi() {
  const dom = falskDom();
  Object.assign(globalThis.window, { addEventListener() {}, AudioContext: AC });
  const bus = lavBus();
  const v = { farer: [], ild: [], farePlan: { varsel: null }, vandNiveau: 300, baevere: [], tur: { tilstand: 'oploesning', turNr: 2 },
              aktivBaever: () => null };
  const S = { verden: v, tilstand: 'spil', skudId: null };
  const ui = kobFarer({ bus, hud: falskHud(), lyd, visning: { fx: falskFx(), farer: null, kamera: falskKamera() }, S,
                        r: falskRenderer({ cx: 1000, cy: 650 }), rod: dom.rod });
  return { bus, ui, v, S, send: (n, e) => bus.send(n, { navn: n, ...e }) };
}

// ------------------------------------------------------------ testene

const GRUPPER = new Function(`return ${/const GRUPPER = (\{[\s\S]*?\});/.exec(kilde('../static/js/ui/lyd.js'))[1]}`)();
const GRUPPE_VOL = new Function(`return ${/const GRUPPE_VOL = (\{[\s\S]*?\});/.exec(kilde('../static/js/ui/lyd.js'))[1]}`)();
const FARE_GRUPPER = ['fare_kabelsalat', 'fare_nullermand', 'fare_drone', 'fare_stoevsuger', 'kortslutning',
  'stoevsuger_alarm', 'nom', 'ild'];

test('filerne: hver gruppe har sine filer og sin styrke, og værktøjet laver farernes', () => {
  for (const [g, n] of Object.entries(GRUPPER)) {
    for (let i = 1; i <= n; i++) assert.ok(fs.existsSync(`${STATIC}lyd/k_${g}_${i}.ogg`), `k_${g}_${i}.ogg mangler`);
    assert.ok(!fs.existsSync(`${STATIC}lyd/k_${g}_${n + 1}.ogg`) || g === 'faktura', `k_${g}_${n + 1}.ogg findes, men GRUPPER siger ${n}`);
    assert.ok(GRUPPE_VOL[g] > 0 && GRUPPE_VOL[g] <= 1, `GRUPPE_VOL.${g}`);
  }
  const py = kilde('../vaerktoej/kontorlyde.py');
  for (const g of FARE_GRUPPER) {
    assert.ok(g in GRUPPER, `${g} står i lyd.js`);
    assert.match(py, new RegExp(`\\('${g}', [\\d.]+, '(svag|let|signal|begivenhed|slag)'`), `${g} laves af kontorlyde.py`);
  }
  // Ingen chiptune: ingen af farernes kilder er fra pakkens Retro- eller 8-bit-mapper.
  const kilder = [...py.matchAll(/\('(fare_\w+|kortslutning|stoevsuger_alarm|nom)', [^\n]*/g)].map((m) => m[0]).join('\n');
  assert.ok(!/Retro\/|8_bit|select_[14]/.test(kilder), 'kontorlyde, ikke chiptune');
  // Ildens løkke er en løkke: ingen udtoning i enden (længden passer med byg_ild).
  const d = oggVarighed(fs.readFileSync(`${STATIC}lyd/k_ild_1.ogg`));
  assert.ok(d > 1 && d < 2.5, `ildens løkke er ${d.toFixed(2)} s`);
});

test('har(): grupper og filer, og en valgfri lyd advarer ikke', async () => {
  assert.ok(lyd.har('kortslutning') && lyd.har('ild') && lyd.har('fare_drone'));
  assert.ok(lyd.har('stemme_eksplosion'));
  assert.ok(!lyd.har('stemme_announcer_sygt_play'), 'optagelsen findes ikke endnu');
  const foer = advarsler.length;
  console.warn = (...a) => { advarsler.push(a.join(' ')); };
  lyd.hentLyde(['stemme_announcer_sygt_play'], { valgfri: true });
  lyd.hentLyde(['stemme_findes_ikke'], {});
  for (let i = 0; i < 20; i++) await vent();
  console.warn = aegteWarn;
  const nye = advarsler.slice(foer);
  assert.ok(!nye.some((a) => a.includes('sygt_play')), 'den valgfri advarer ikke');
  assert.ok(nye.some((a) => a.includes('stemme_findes_ikke')), 'en almindelig gør');
});

test('én lyd ad gangen: KORTSLUTNING efter braget, varslet aldrig som vigtig', () => {
  const u = lavUi();
  gaa(3);
  const fra = ur.nu;
  // Skuddets brag (forrang, 1 s), og tick efter antændes Kabelsalaten.
  assert.ok(lyd.afspil('brag', { forrang: true }), 'braget spiller');
  const brag = spillet.at(-1);
  gaa(0.016, u.ui, u.v);
  u.send('fareAntaendt', { id: 1, slags: 'kabelsalat', hud: 'kabelsalat', x: 1000, y: 600, aarsag: 'eksplosion' });
  gaa(3, u.ui, u.v);
  const ks = spillet.filter((x) => x.t0 >= fra && /^k_kortslutning_/.test(x.navn));
  assert.equal(ks.length, 1, 'KORTSLUTNING lød');
  assert.ok(ks[0].t0 >= brag.slut - 1e-9, `efter braget (${ks[0].t0.toFixed(2)} >= ${brag.slut.toFixed(2)})`);
  assert.ok(ks[0].t0 - brag.slut < 0.2, 'lige efter');
  assert.deepEqual(overlap(fra), []);
  // Et langt brag (2,4 s): så er KORTSLUTNING for sent, og den falder bort.
  const fraL = ur.nu;
  lyd.afspil('stemme_eksplosion_3', { forrang: true });
  gaa(0.016, u.ui, u.v);
  u.send('fareAntaendt', { id: 2, slags: 'kabelsalat', hud: 'kabelsalat', x: 1000, y: 600, aarsag: 'eksplosion' });
  gaa(4, u.ui, u.v);
  assert.equal(spillet.filter((x) => x.t0 >= fraL && /^k_kortslutning_/.test(x.navn)).length, 0, 'aldrig for sent');
  assert.deepEqual(overlap(fraL), []);
  // Varslet under en vigtig replik: det venter eller falder bort, og de vigtige
  // (to i køen) kommer i den rækkefølge, de blev sat i — uden varslet imellem.
  const fra2 = ur.nu;
  lyd.stemme('stemme_announcer_doed', { vigtig: true });
  lyd.afspil('sort_hul', { vigtig: true });
  lyd.stemme('stemme_ingrid_tur', { vigtig: true });
  u.send('fareVarsel', { slags: 'drone', hud: 'pakkedrone', x: -60, y: 900, ret: 1, rest: 180 });
  gaa(8, u.ui, u.v);
  const raekke = spillet.filter((x) => x.t0 >= fra2).map((x) => x.navn);
  assert.deepEqual(raekke.filter((n) => !/^k_fare_/.test(n)), ['stemme_announcer_doed', 'k_sort_hul_1', 'stemme_ingrid_tur']);
  assert.ok(!raekke.slice(0, 2).some((n) => /^k_fare_/.test(n)), 'varslet sniger sig ikke ind mellem de vigtige');
  assert.deepEqual(overlap(fra2), []);
  // Varslet på en fri kanal: med det samme.
  const fra3 = ur.nu;
  u.send('fareVarsel', { slags: 'kabelsalat', hud: 'nullermand', x: 900, y: 900, ret: 1, rest: 180 });
  gaa(0.05, u.ui, u.v);
  assert.match(spillet.filter((x) => x.t0 >= fra3)[0]?.navn || '', /^k_fare_nullermand_/);
  gaa(3, u.ui, u.v);
});

test('ildens knitren tier, mens en anden lyd spiller', () => {
  const u = lavUi();
  gaa(3);
  u.v.ild = [{ id: 1, x: 1000, y: 650, rest: 200 }];
  gaa(0.1, u.ui, u.v);
  const loekke = spillet.find((x) => x.navn === 'k_ild_1' && x.slut === Infinity);
  assert.ok(loekke, 'knitren kører som løkke');
  const gain = loekke.kilde.ud.gain;
  assert.ok(gain.value > 0.05, `og kan høres (${gain.value.toFixed(2)})`);
  lyd.afspil('stemme_eksplosion', { forrang: true });
  gaa(0.05, u.ui, u.v);
  assert.equal(gain.value, 0, 'tier under braget');
  gaa(3, u.ui, u.v);
  assert.ok(gain.value > 0.05, 'og kommer igen bagefter');
  u.v.ild = [];
  gaa(0.3, u.ui, u.v);
  assert.ok(loekke.stoppet, 'løkken stoppes, når ilden er gået ud');
});

test('ildens knitren tier under flyvelyden og boret, og til de er tonet ud', () => {
  // Flyvelyden og boret er løbende lyde uden for kanalen: kanalFri() er sand,
  // mens de lyder, så lyd.loop lader ikke selv ilden tie for dem.
  const u = lavUi();
  gaa(3);
  // Flyvelydens graf bygges ved første kald: suset og fløjtet er dens udgange til master.
  const n0 = gains.length;
  lyd.flyvelyd({ vx: 0, vy: 0 });
  const flyv = gains.slice(n0).filter((g) => g.ud === gains[0]);
  assert.equal(flyv.length, 2, 'suset og fløjtet');
  const skud = { id: 50, x: 900, y: 720, vx: 0, vy: 0, sover: false };
  const kunde = { id: 1, hold: 0, x: 1000, y: 601, graver: false, doed: false };
  u.v.projektiler = [];
  u.v.baevere = [kunde];
  u.v.ild = [{ id: 1, x: 1000, y: 650, rest: 200 }];
  // Hvad der kan høres i hver frame. Suset toner ud med setTargetAtTime(0, t,
  // 0,05) — den falske Param springer, så halen (3 tidskonstanter) lægges til.
  let susSlut = -Infinity, susFoer = false;
  const loekke = (navn) => spillet.findLast((x) => x.navn === navn && x.slut > ur.nu + 1e-9) || null;
  const frames = [];
  // main.js' rækkefølge: foelgSkud (flyvelyden), ui/farer.js, så 'bor'-løkken.
  const main = {
    opdater(v) {
      const p = v.projektiler[0];
      lyd.flyvelyd(p && !p.sover ? { vx: p.vx, vy: p.vy, raket: false, tumler: true } : null);
      u.ui.opdater(v);
      const borer = v.baevere.some((b) => b.graver && !b.doed);
      lyd.loop('bor', borer, borer ? 1.1 : 0);
      const sus = flyv.some((g) => g.gain.value > 1e-3);
      if (susFoer && !sus) susSlut = ur.nu + 0.15;
      susFoer = sus;
      const ild = loekke('k_ild_1'), bor = loekke('k_bor_1');
      frames.push({ t: ur.nu, fase, sus: sus || ur.nu < susSlut, kanal: !lyd.kanalFri(),
                    ild: !!ild && ild.kilde.ud.gain.value > 1e-3, bor: !!bor && (bor.stoppet || bor.kilde.ud.gain.value > 1e-3) });
    },
  };
  let fase = 'ild';
  gaa(0.5, main, u.v);
  // Et skud: kastelyden i kanalen, så suser det i 1,5 s og slår ned med et brag.
  fase = 'skud';
  lyd.afspil('kast');
  skud.vx = 900; skud.vy = 120;
  u.v.projektiler = [skud];
  gaa(1.5, main, u.v);
  fase = 'brag';
  u.v.projektiler = [];
  lyd.afspil('brag', { forrang: true });
  gaa(1.5, main, u.v);
  // En granat, der ruller langsomt (under 40 wu/s) eller ligger og venter, suser ikke.
  fase = 'ruller';
  u.v.projektiler = [{ ...skud, vx: 20, vy: 0 }];
  gaa(0.5, main, u.v);
  u.v.projektiler = [{ ...skud, vx: 300, vy: 0, sover: true }];
  gaa(0.5, main, u.v);
  u.v.projektiler = [];
  // Systemnedbrud: kunden borer i 1 s.
  fase = 'bor';
  kunde.graver = true;
  gaa(1, main, u.v);
  fase = 'efter';
  kunde.graver = false;
  gaa(1, main, u.v);

  const sammen = frames.filter((f) => f.ild && (f.sus || f.bor || f.kanal));
  assert.deepEqual(sammen.slice(0, 3).map((f) => `${f.fase}@${f.t.toFixed(2)}${f.sus ? ' sus' : ''}${f.bor ? ' bor' : ''}${f.kanal ? ' kanal' : ''}`), [],
    'ilden knitrer oven i en anden lyd');
  const i = (fase, hvad) => frames.some((f) => f.fase === fase && f[hvad]);
  assert.ok(i('ild', 'ild'), 'ilden kan høres før skuddet');
  assert.ok(i('skud', 'sus') && !i('skud', 'ild'), 'skuddet suser, og ilden tier imens');
  assert.ok(i('brag', 'ild'), 'ilden kommer igen efter braget');
  assert.ok(i('ruller', 'ild') && !i('ruller', 'sus'), 'en granat, der ikke suser, lader ilden knitre');
  assert.ok(i('bor', 'bor') && !i('bor', 'ild'), 'boret summer, og ilden tier imens');
  assert.ok(i('efter', 'ild'), 'og kommer igen, når boret er tonet ud');
  lyd.flyvelyd(null);
  lyd.loop('bor', false);
  u.v.ild = [];
  gaa(0.3, u.ui, u.v);
});
