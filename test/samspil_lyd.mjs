/* Kundekrigen — test: lydkanalen med farerne, tålmodighedsbjælken og vejledningen.
 *
 *   node --no-warnings --test test/samspil_lyd.mjs
 *
 * Den RIGTIGE ui/lyd.js i et falsk lydmiljø (en AudioContext med styret ur,
 * som i test/farer_vis_lyd.mjs), den rigtige ui/farer.js og main.js' egen
 * taelSkade (skåret ud af kilden) på en rigtig kamp: ild under kunderne (hvert
 * ildtik et skadetal med skadelyd og nedtællingens tik), en Kabelsalat, der
 * varsles, kommer og antændes (KORTSLUTNING), flammebraget (forrang, som
 * main.js' eksplosion-lytter) og vejledningens slutkort (klik). Alt går
 * gennem den ene kanal: intet lyder oven i noget andet (bortset fra de 40-50 ms
 * udtoning ved forrang), ildens knitren tier, hver gang kanalen er optaget,
 * og farernes varsel og KORTSLUTNING kommer igennem, selv om bjælken tæller.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STATIC, kilde, falskDom, falskFx, falskHud, falskKamera, falskRenderer } from './farer_vis_hjaelp.mjs';

// ------------------------------------------------------------ det falske lydmiljø

const ur = { nu: 0 };
const spillet = [];                     // { navn, t0, slut, stoppet, kilde }
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
class AC {
  constructor() { this.state = 'running'; this.destination = new Node(); this.sampleRate = 44100; }
  get currentTime() { return ur.nu; }
  createGain() { const n = new Node(); n.gain = new Param(1); return n; }
  createBufferSource() { return new Kilde(); }
  createStereoPanner() { const n = new Node(); n.pan = new Param(0); return n; }
  createMediaElementSource() { return new Node(); }
  createBiquadFilter() { const n = new Node(); n.frequency = new Param(0); n.Q = new Param(0); return n; }
  createOscillator() { const n = new Node(); n.frequency = new Param(0); n.start = () => {}; return n; }
  createBuffer(kanaler, n, rate) { return { duration: n / rate, getChannelData: () => new Float32Array(n) }; }
  resume() { return Promise.resolve(); }
  decodeAudioData(b) { return Promise.resolve(b); }
}
class Audio { constructor() { this.readyState = 4; this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} }

const aegteWarn = console.warn;
console.warn = () => {};
const dom = falskDom();                  // document, window og localStorage til ui/farer.js
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
const { effektLyd, ALLE_STEMMER } = await import('../static/js/ui/stemmer.js');
const { kobFarer } = await import('../static/js/ui/farer.js');
const { lavBus } = await import('../static/js/core/bus.js');
const { lavVerden } = await import('../static/js/sim/world.js');
const { anvendDelta } = await import('../static/js/sim/snapshot.js');
const { skadeForloeb, skadeK } = await import('../static/js/ui/tbj.js');
const { HZ } = await import('../static/js/core/tick.js');
const { T, FA, lavHold, aktivVerden, antaend } = await import('./farer_hjaelp.mjs');
for (let i = 0; i < 50; i++) await vent();                 // lydene hentes (NAVNE)
lyd.hentLyde(ALLE_STEMMER.filter((n) => /eksplosion/.test(n)));   // brugerens brag (main.js henter ALLE_STEMMER)
for (let i = 0; i < 50; i++) await vent();
console.warn = aegteWarn;

/** Gå tiden frem: lyde slutter og timere fyrer i rækkefølge. */
function gaa(dt) {
  const maal = ur.nu + dt;
  for (;;) {
    let naeste = Infinity, hvad = null;
    for (const k of aktive) if (k.slut <= maal && k.slut < naeste) { naeste = k.slut; hvad = ['k', k]; }
    for (const t of timere) if (t.due <= maal && t.due < naeste) { naeste = t.due; hvad = ['t', t]; }
    if (!hvad) break;
    ur.nu = Math.max(ur.nu, naeste);
    if (hvad[0] === 'k') { aktive.delete(hvad[1]); hvad[1].onended?.(); } else { timere.splice(timere.indexOf(hvad[1]), 1); hvad[1].fn(); }
  }
  ur.nu = maal;
}
/** Lyde, der lød samtidig (bortset fra udtoningen ved forrang). Løkker tæller ikke. */
function overlap(fra = 0) {
  const s = spillet.filter((x) => x.t0 >= fra && !x.kilde.loop).sort((a, b) => a.t0 - b.t0);
  const ud = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    if (s[j].t0 >= s[i].slut - 1e-9) continue;
    if (s[i].stoppet && s[i].slut - s[j].t0 <= 0.051) continue;
    ud.push(`${s[i].navn}@${s[i].t0.toFixed(2)} / ${s[j].navn}@${s[j].t0.toFixed(2)}`);
  }
  return ud;
}

// ------------------------------------------------------------ main.js' stykker

const MAIN = kilde('../static/js/main.js');
function blok(start, slut) {
  const i = MAIN.indexOf(start);
  assert.ok(i >= 0, `main.js: fandt ikke ${start}`);
  const j = MAIN.indexOf(slut, i + start.length);
  return MAIN.slice(i, j + slut.length);
}
const lavTaelSkade = new Function('S', 'hud', 'lyd', 'r', 'skadeForloeb', 'skadeK', [
  blok('hud.saetVisHp(', ');\n'), blok('hud.saetFyldHp(', '});\n'), blok('const UROLIG = new Set(', '\n}\n'),
  'return taelSkade;',
].join('\n'));

// ------------------------------------------------------------ testen

test('én kanal: ild, bjælkens nedtælling, farernes lyde og vejledningens klik lyder aldrig oven i hinanden', () => {
  gaa(3);
  const fra = ur.nu;
  const net = (x) => JSON.parse(JSON.stringify(x));
  const v = aktivVerden({ froe: 11, bane: 'aaben', cfg: { turTicks: 14 * HZ, farer: ['kabelsalat'] } });
  const spejl = lavVerden({ froe: 11, banetype: 'aaben', hold: lavHold(2, 2), cfg: net(v.cfg) });
  spejl.genskab(net(v.oejebliksbillede()));
  const b = v.aktivBaever(), fj = v.baevere.find((x) => x.hold !== b.hold && !x.doed);
  FA.taendIld(v, b.x, b.y + 2, 0, { kaede: 0, kaedeId: 1, kildeHold: fj.hold, kildeBaever: fj.id }, []);
  FA.taendIld(v, fj.x, fj.y + 2, 0, { kaede: 0, kaedeId: 1, kildeHold: b.hold, kildeBaever: b.id }, []);
  v.farePlan.naeste = v.farePlan.aktiv + 30;             // varslet om et halvt sekund

  const bus = lavBus();
  // main.js' lyttere: braget med forrang (efter størrelsen), og skadelyden ikke for ild.
  bus.paa('eksplosion', (e) => {
    const g = e.radius >= 70 ? 'kaempe_eksplosion' : e.radius >= 50 ? 'eksplosion_stor' : 'eksplosion';
    lyd.afspil(effektLyd(g), { vol: 1, forrang: true });
  });
  bus.paa('skade', (e) => { if (e.aarsag !== 'ild') lyd.afspil('skade'); });
  const S = { verden: spejl, tilstand: 'spil', skudId: null, visHp: new Map(), sidsteTik: 0 };
  const r = falskRenderer({ cx: b.x, cy: b.y + 60, b: 2400, h: 1100 });
  const ui = kobFarer({ bus, hud: falskHud(), lyd, visning: { fx: falskFx(), farer: null, kamera: falskKamera() }, S, r, rod: dom.rod });
  const tal = [];
  const hud = { saetVisHp() {}, saetFyldHp() {}, markerRamt() {}, skadeTal: (x, n) => tal.push(n) };
  const taelSkade = lavTaelSkade(S, hud, lyd, r, skadeForloeb, skadeK);
  const vi = { baevere: { get: () => ({ ramt() {} }) } };

  const set = { antaendt: 0, brag: 0, klik: 0 };
  let klikket = false, braender = false;
  const frames = [];
  for (let i = 0; i < 30 * HZ && !klikket; i++) {
    const f = v.farer[0];
    // Kabelsalaten er landet: scanneren antænder den, og skytten står over,
    // så opløsningen venter på flammebraget.
    if (f && !braender && f.tilst === 'jord' && !(f.luft > 0)) {
      braender = true;
      antaend(v, f);
      v.udfoerKommando({ k: 'handling', h: 'staaOver' }, b.ejer);
    }
    for (const e of v.skridt()) {
      if (e.navn === 'fareAntaendt') set.antaendt++;
      if (e.navn === 'eksplosion') set.brag++;
      bus.send(e.navn, net(e));
    }
    if (v.tur.tilstand === T.SKADE && braender && !klikket) {
      // Vejledningens slutkort: mellemrummet lukker det (main.js: lyd.afspil('klik')).
      klikket = true;
      lyd.afspil('klik');
    }
    anvendDelta(spejl, net(v.delta()));
    taelSkade(spejl, vi, performance.now());
    ui.opdater(spejl);
    const loekke = spillet.findLast((x) => x.navn === 'k_ild_1' && x.kilde.loop);
    // Optaget af en lyd, der har spillet i mere end de 40-50 ms, en løkke har til at tone ud.
    const optaget = spillet.some((x) => !x.kilde.loop && x.t0 <= ur.nu - 0.051 && x.slut > ur.nu + 1e-9);
    frames.push({ t: ur.nu, ild: !!loekke && loekke.slut > ur.nu && loekke.kilde.ud.gain.value > 1e-3, optaget });
    gaa(1 / HZ);
  }
  gaa(3);
  ui.opdater(spejl);
  const navne = spillet.filter((x) => x.t0 >= fra).map((x) => x.navn);
  assert.ok(set.antaendt >= 1 && set.brag >= 1, `Kabelsalaten brændte og sprang (${JSON.stringify(set)})`);
  assert.ok(klikket, 'turen blev afviklet til slutkortet');
  assert.ok(tal.length >= 4, `ilden gav skadetal (${tal.length})`);
  for (const [gruppe, navn] of [['skade', /^k_skade_/], ['tael', /^k_tael_/], ['varslet', /^k_fare_kabelsalat_/],
                                ['KORTSLUTNING', /^k_kortslutning_/], ['braget', /eksplosion/]]) {
    assert.ok(navne.some((n) => navn.test(n)), `${gruppe} lød (${navne.join(' ')})`);
  }
  assert.ok(frames.some((x) => x.ild), 'ilden knitrede');
  assert.deepEqual(overlap(fra), [], 'intet oven i hinanden');
  const sammen = frames.filter((x) => x.ild && x.optaget);
  assert.deepEqual(sammen.slice(0, 3).map((x) => x.t.toFixed(2)), [], 'ilden knitrede oven i en lyd i kanalen');
});
