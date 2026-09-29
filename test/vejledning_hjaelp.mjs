/* Kundekrigen — fælles hjælpere til vejledningens test (ikke en test).
 *
 * falskDom: lige nok DOM til ui/hjaelp.js' lavHjaelp.
 * lavBord:  main.js' indputvej og vejledningens kobling i processen — skåret
 *           ud af kildekoden (som komisk-testen gør) og kørt mod en rigtig
 *           værtsverden, et spejl fodret med snapshot og deltaer, det rigtige
 *           tastatur (ui/keyboard.js) og den rigtige lavHjaelp.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lavVerden, T as TIL, K } from '../static/js/sim/world.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';
import { VAABEN, FAVORITTER } from '../static/js/sim/weapons.js';
import { lavHjaelp, VEJLEDNING_HAENDELSER } from '../static/js/ui/hjaelp.js';
import { lavTastatur } from '../static/js/ui/keyboard.js';
import { lavBus } from '../static/js/core/bus.js';
import { HZ } from '../static/js/core/tick.js';
import { T } from '../static/js/ui/tekst.js';

// ------------------------------------------------------------------ falsk DOM

const klasser = (start = '') => {
  const s = new Set(start.split(/\s+/).filter(Boolean));
  return {
    s,
    add: (...c) => c.forEach((x) => s.add(x)),
    remove: (...c) => c.forEach((x) => s.delete(x)),
    toggle: (c, v = !s.has(c)) => { if (v) s.add(c); else s.delete(c); return v; },
    contains: (c) => s.has(c),
  };
};

function element() {
  const el = { lyttere: {}, style: {}, offsetWidth: 0, offsetHeight: 0, dataset: {}, skrevet: 0, _html: '' };
  el.classList = klasser();
  Object.defineProperty(el, 'className', {
    get: () => [...el.classList.s].join(' '),
    set: (v) => { el.classList = klasser(v); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html,
    set: (v) => { el._html = v; el.skrevet++; },
  });
  el.addEventListener = (t, f) => { el.lyttere[t] = f; };
  return el;
}

/** rod (#hjaelp), boks (#hjBoble) og tastebjælkens punkter med data-trin. */
export function falskDom() {
  const rod = element();
  const boks = element(), oversigt = element(), taster = element();
  let punkter = null;
  // Elementets klasser, som rodens HTML giver dem (class="…" før id="…").
  const medKlasser = (el, id) => {
    el.className = rod.innerHTML.match(new RegExp(`class="([^"]*)"[^>]*id="${id}"`))?.[1] ?? '';
    return el;
  };
  rod.querySelector = (q) => ({
    '#hjBoble': () => medKlasser(boks, 'hjBoble'),
    '#hjOversigt': () => medKlasser(oversigt, 'hjOversigt'),
    '#hjTaster': () => taster,
  })[q]?.() ?? null;
  rod.querySelectorAll = (q) => {
    assert.equal(q, '.tb-punkt[data-trin]');
    punkter ??= [...rod.innerHTML.matchAll(/data-trin="([a-z]+)"/g)].map(([, trin]) => {
      const p = element(); p.dataset.trin = trin; return p;
    });
    return punkter;
  };
  return { rod, boks, oversigt, punkter: () => punkter };
}

// ------------------------------------------------------------------ main.js i processen

let MAIN = null;

/** Et stykke af main.js fra start til og med slut (eller til før, uden). */
function blok(start, slut, medSlut = true) {
  MAIN ??= readFileSync(fileURLToPath(new URL('../static/js/main.js', import.meta.url)), 'utf8');
  const i = MAIN.indexOf(start);
  assert.ok(i >= 0, `main.js: fandt ikke ${start}`);
  const j = MAIN.indexOf(slut, i + start.length);
  assert.ok(j >= 0, `main.js: fandt ikke slutningen på ${start}`);
  return MAIN.slice(i, medSlut ? j + slut.length : j);
}

/** main.js' stykker som én funktion af det, de bruger (skåret ud første gang). */
let lavMainFn = null;
function lavMain(...args) {
  lavMainFn ??= lavMainKode();
  return lavMainFn(...args);
}
const lavMainKode = () => new Function(...NAVNE, [
  blok('const erMin = (b) =>', ';\n'),
  blok('function mellemrumErSpil() {', '\n}\n'),
  blok('function vejledningUr(aktiv) {', '\n}\n'),
  blok('function lukPause() {', '\n'),
  blok('function holdNu() {', '\n}\n'),
  blok('function sendInput() {', '\n}\n'),
  blok('tast.paaTryk((handling, e) => {', '\n});\n'),
  blok('tast.paaSlip((handling) => {', '\n});\n'),
  'const api = {',
  blok('  fortsaet() {', '\n'),
  blok('  visVejledning() {', '\n'),
  blok('  visTaster() {', '\n'),
  '};',
  'function koblHaendelser() {',
  blok('  // Vejledningen kommer først, når spilleren', "  bus.paa('sejr'", false),
  '}',
  'function frame(dt) {',
  '  const v = S.verden, aktNu = v.aktivBaever(), minTur = !!(aktNu && erMin(aktNu));',
  blok('  // Vejledningen: gå- og sigtetrinnet klares', '  // Brugte man sidste Hjemmearbejde', false),
  '}',
  'return { api, frame, koblHaendelser, erMin, mellemrumErSpil, holdNu, vejledningUr };',
].join('\n'));

const NAVNE = ['S', 'tast', 'panel', 'springFilm', 'stopForhaand', 'visResultat', 'menu', 'hjaelp', 'lyd',
  'TIL', 'VAABEN', 'hud', 'visning', 'saetLydIndstilling', 'aabnArsenal', 'afsend', 'confirm', 'T', 'K',
  'springMarkoer', 'cyklVaaben', 'vaelgVaaben', 'performance', 'lokalKraft', 'bus', 'VEJLEDNING_HAENDELSER', 'HZ', 'r'];

/** Et falsk vindue til ui/keyboard.js (lytterne på keydown/keyup/blur). */
function falskVindue() {
  const l = {};
  return { l, addEventListener: (t, f) => { l[t] = f; }, removeEventListener() {} };
}

/**
 * Et "bord": én vært (den rigtige simulation) og en eller flere klienter,
 * hver med sit spejl, sin bus, sit tastatur og sin vejledning.
 *   hold: holdene til lavVerden (ejer = spillerens pid)
 */
export function lavBord({ hold, froe = 12345, cfg } = {}) {
  cfg ??= { turTicks: 30 * HZ, kampTicks: 600 * HZ, vind: true, vejr: 'auto', banetype: 'aaben' };
  const vaert = lavVerden({ froe, banetype: 'aaben', hold: structuredClone(hold), cfg });
  vaert.startKamp();
  let nu = 1000;
  const performance = { now: () => nu };
  const klienter = [];
  const kommandoer = [];

  function lavKlient({ erNet = false, pid = null, lager = new Map() } = {}) {
    const spejl = lavVerden({ froe, banetype: 'aaben', hold: structuredClone(hold), cfg });
    spejl.genskab(structuredClone(vaert.oejebliksbillede()));
    const log = { afsendt: [], bannere: [], lyde: [], menu: [] };
    const S = {
      tilstand: 'spil', erNet, erVaert: !erNet, pid, seq: 0, sidsteBitmaske: -1,
      oplader: false, opladFra: 0, markoerTilstand: false, markoer: { x: 0, y: 0, vinkel: 0, retning: 1 },
      pause: false, profil: { favoritter: FAVORITTER.slice(0, 10) }, verden: spejl,
    };
    const hud = { banner: (t, ms, k) => log.bannere.push(t) };
    const lyd = { afspil: (n) => log.lyde.push(n), ladelyd() {}, erLydFra: () => false };
    const menu = { vis: (s) => log.menu.push(`vis:${s}`), skjul: () => log.menu.push('skjul'), tast() {} };
    const panel = { aaben: false, tast: () => false, luk() {} };
    const dom = falskDom();
    const L = { hent: (k) => lager.get(k) ?? null, gem: (k, v) => lager.set(k, v) };
    let m = null;                      // main.js' lukning (vejledningUr er i den)
    const hjaelp = lavHjaelp(dom.rod, { ur: (a) => m.vejledningUr(a), besked: (t) => hud.banner(t, 2000), lager: L });
    // Kommandoerne går til værten, som main.js' afsend (med pid over nettet).
    const afsend = (cmd) => {
      log.afsendt.push(cmd);
      kommandoer.push({ cmd, pid: erNet ? pid : null, res: vaert.udfoerKommando(cmd, erNet ? pid : null) });
    };
    const vaelgVaaben = (id) => afsend({ k: 'handling', seq: S.seq++, h: 'vaelgVaaben', id });
    const bus = lavBus();
    const vindue = falskVindue();
    const gemt = { window: globalThis.window, document: globalThis.document };
    globalThis.window = vindue;
    globalThis.document = { addEventListener() {}, hidden: false };
    const tast = lavTastatur();
    globalThis.window = gemt.window; globalThis.document = gemt.document;
    const nop = () => {};
    m = lavMain(S, tast, panel, nop, nop, nop, menu, hjaelp, lyd, TIL, VAABEN, hud, null, nop, nop, afsend,
      () => false, T, K, nop, nop, vaelgVaaben, performance, () => 0.6, bus, VEJLEDNING_HAENDELSER, HZ,
      { tilSkaerm: () => ({ x: 0, y: 0 }) });
    m.koblHaendelser();
    const tryk = (code, o = {}) => vindue.l.keydown({ code, key: o.key ?? code, repeat: false, shiftKey: !!o.shift, preventDefault() {} });
    const slip = (code) => vindue.l.keyup({ code, key: code, preventDefault() {} });
    const k = { S, spejl, log, hjaelp, dom, lager, tast, bus, m, tryk, slip, blur: () => vindue.l.blur() };
    klienter.push(k);
    return k;
  }

  /** Ét tick: værten simulerer; hændelserne, så deltaen, når hver klient
   *  (som sim/worker.js sender dem); så en frame hos hver klient. */
  function tick(n = 1) {
    for (let i = 0; i < n; i++) {
      const h = vaert.skridt();
      const snap = h.some((e) => e.navn === 'turStart') ? structuredClone(vaert.oejebliksbillede()) : null;
      const d = structuredClone(vaert.delta());
      for (const k of klienter) {
        if (snap) k.spejl.genskab(structuredClone(snap));
        for (const e of h) k.bus.send(e.navn, e);
        anvendDelta(k.spejl, structuredClone(d));
      }
      nu += 1000 / HZ;
      for (const k of klienter) k.m.frame(1 / HZ);
    }
  }
  /** Tick, til betingelsen holder (højst n tick). */
  function til(bet, n = 6000) {
    for (let i = 0; i < n; i++) { if (bet()) return true; tick(); }
    return bet();
  }

  return { vaert, lavKlient, tick, til, kommandoer, get nu() { return nu; } };
}
