/* Kundekrigen — tålmodighedsbjælken (ui/tbj.js, ui/hud.js; docs/udkast/hp_design.md):
 * fyldt efter procent, det tabte stykke, død, piller over 100, COVID,
 * kaldenavne — og at skiltene intet skriver i ro, ikke tvinger layout og
 * ikke allokerer pr. frame.
 *
 *   node --expose-gc --no-warnings --test test/hp_bjaelke.mjs
 *
 * Ingen browser og ingen jsdom: en lille falsk DOM herunder (kun det, HUD'en
 * bruger) tæller skrivninger og layoutlæsninger. Allokeringstesten kræver
 * --expose-gc og springes ellers over.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PerformanceObserver } from 'node:perf_hooks';
import { homedir } from 'node:os';

/* ------------------------------------------------------------ falsk DOM */

const dom = { skriv: 0, snavset: false, tvunget: 0, laes: 0 };
const skrev = () => { dom.skriv++; dom.snavset = true; };
/** En læsning, der kræver layout: tvunget, hvis der er skrevet siden sidste frame. */
const layoutLaes = () => { dom.laes++; if (dom.snavset) dom.tvunget++; };
/** Browseren har tegnet: layoutet er rent igen. */
const nyFrame = () => { dom.snavset = false; };

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'wbr']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", shy: '­', nbsp: ' ' };
const afkod = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? m);

class Tekst {
  constructor(t) { this.data = t; this.parent = null; }
  get textContent() { return this.data; }
}

/** Inline-stil: hver tildeling tæller som en skrivning (uden Proxy, så
 *  allokeringstesten kun måler HUD'en). */
class Stil {
  setProperty(k, v) { skrev(); this['_' + k] = String(v); }
}
for (const k of ['transform', 'visibility', 'width', 'top', 'left', 'background', 'color', 'opacity']) {
  const felt = '_' + k;
  Object.defineProperty(Stil.prototype, k, {
    get() { return this[felt] ?? ''; },
    set(v) { skrev(); this[felt] = typeof v === 'string' ? v : String(v); },
  });
}

class El {
  constructor(tag) {
    this.tag = tag.toLowerCase(); this.attr = new Map(); this.kids = []; this.parent = null;
    this.style = new Stil();
    // Klasserne caches som liste (kun en ændring bygger en ny), så en
    // toggle uden ændring intet allokerer — som i browseren.
    let cache = null, kilde = null;
    const kl = () => { const a = this.attr.get('class') || ''; if (a !== kilde) { kilde = a; cache = a.split(/\s+/).filter(Boolean); } return cache; };
    const saet = (l) => { skrev(); this.attr.set('class', l.join(' ')); };
    this.classList = {
      contains: (c) => kl().includes(c),
      add: (...cs) => { for (const c of cs) if (!kl().includes(c)) saet([...kl(), c]); },
      remove: (...cs) => { for (const c of cs) if (kl().includes(c)) saet(kl().filter((x) => x !== c)); },
      toggle: (c, f) => {
        const har = kl().includes(c), skal = f === undefined ? !har : !!f;
        if (skal !== har) { if (skal) this.classList.add(c); else this.classList.remove(c); }
        return skal;
      },
    };
  }
  get className() { return this.attr.get('class') || ''; }
  set className(v) { if (v !== this.className) { skrev(); this.attr.set('class', String(v)); } }
  get id() { return this.attr.get('id') || ''; }
  get children() { return this.kids.filter((k) => k instanceof El); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get textContent() { return this.kids.map((k) => k.textContent).join(''); }
  set textContent(v) {
    skrev();
    const t = typeof v === 'string' ? v : String(v);
    if (this.kids.length === 1 && this.kids[0] instanceof Tekst) { this.kids[0].data = t; return; }
    const n = new Tekst(t); n.parent = this; this.kids = [n];
  }
  set innerHTML(html) { skrev(); this.kids = []; parse(String(html), this); }
  get dataset() {
    const d = {};
    for (const [k, v] of this.attr) if (k.startsWith('data-')) d[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v;
    return d;
  }
  getAttribute(k) { return this.attr.has(k) ? this.attr.get(k) : null; }
  setAttribute(k, v) { skrev(); this.attr.set(k, String(v)); }
  appendChild(n) { n.remove(); n.parent = this; this.kids.push(n); skrev(); return n; }
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; skrev(); } }
  insertAdjacentElement(hvor, n) {
    assert.equal(hvor, 'afterend');
    n.remove(); const p = this.parent; p.kids.splice(p.kids.indexOf(this) + 1, 0, n); n.parent = p; skrev();
  }
  addEventListener() {} removeEventListener() {} blur() {}
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e === document.documentElement; }
  get offsetHeight() { layoutLaes(); return 20; }
  get offsetWidth() { layoutLaes(); return 120; }
  get clientWidth() { layoutLaes(); return 1920; }
  get clientHeight() { layoutLaes(); return 1080; }
  matcher(sel) {
    const m = /^([a-z0-9-]*)((?:[#.][\w-]+)*)$/i.exec(sel);
    assert.ok(m, `den falske DOM kender kun enkle vælgere (${sel})`);
    if (m[1] && this.tag !== m[1].toLowerCase()) return false;
    for (const d of m[2].match(/[#.][\w-]+/g) || []) {
      if (d[0] === '#' ? this.id !== d.slice(1) : !this.classList.contains(d.slice(1))) return false;
    }
    return true;
  }
  querySelectorAll(sel) {
    const ud = [];
    const gaa = (e) => { for (const k of e.children) { if (k.matcher(sel)) ud.push(k); gaa(k); } };
    gaa(this);
    return ud;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let e = this; while (e && !(e instanceof El && e.matcher(sel))) e = e.parent; return e || null; }
}

function parse(html, rod) {
  const stak = [rod];
  const RE = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = RE.exec(html))) {
    const top = stak[stak.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stak.length - 1; i > 0; i--) if (stak[i].tag === tag) { stak.length = i; break; }
    } else if (m[2]) {
      const e = new El(m[2]);
      for (const a of m[3].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
        e.attr.set(a[1].toLowerCase(), afkod(a[2] ?? a[3] ?? a[4] ?? ''));
      }
      e.parent = top; top.kids.push(e);
      if (!m[4] && !VOID.has(e.tag)) stak.push(e);
    } else if (m[5]) {
      const t = new Tekst(afkod(m[5])); t.parent = top; top.kids.push(t);
    }
  }
}

const document = { createElement: (t) => new El(t), documentElement: new El('html') };
const body = document.documentElement.appendChild(new El('body'));
globalThis.document = document;
// Vinduets mål er også en layoutlæsning i browseren (rullebjælker).
globalThis.window = { get innerWidth() { layoutLaes(); return 1920; }, get innerHeight() { layoutLaes(); return 1080; } };
// Kunsten "hentes" med det samme (tbj.js hentTbjGrafik).
globalThis.Image = class { set src(s) { this._src = s; queueMicrotask(() => (existsSync(STATIC + s) ? this.onload : this.onerror)?.()); } };
let NU = 1000;
performance.now = () => NU;

const STATIC = new URL('../static', import.meta.url).pathname;
const { lavHud, ETIKET_WU, ETIKET_PX } = await import('../static/js/ui/hud.js');
const tbj = await import('../static/js/ui/tbj.js');
const { pct, overPct, smitteX, delNavn, kortNavn, skadeForloeb, skadeK, saetTbj, tbjRefs, TAB_HOLD_MS, LAV_HP, TBJ_GRAFIK } = tbj;
const { MAKS_HP } = await import('../static/js/sim/entities.js');
const { SMITTE_SKADE } = await import('../static/js/sim/damage.js');
const { PERSONALE } = await import('../static/js/core/klinikker.js');
const { ROSTER, rosterNavn } = await import('../static/js/core/roster.js');
const { HOLD } = await import('../static/js/render/palette.js');
const { HZ } = await import('../static/js/core/tick.js');

/* ------------------------------------------------------------ en lille kamp */

function lavB(id, hold, navn, ejer, x) {
  return { id, hold, navn, ejer, x, y: 500, hp: MAKS_HP, doed: false, skjold: false, springOver: 0, smittet: 0 };
}
function lavVerden() {
  const baevere = [
    lavB(1, 0, 'Skrankepaven Ingrid', 'p1', 300), lavB(2, 0, 'Skrankepaven Ingrid II', 'p1', 700),
    lavB(3, 1, 'Dr. Jan fra Mors', 'p2', 1200), lavB(4, 1, 'Dr. Jan fra Mors II', 'p2', 1600),
  ];
  return {
    baevere, tick: 0, cfg: { kampTicks: 30 * 60 * 60 }, pludseligDoed: false, vind: 0, vindNu: () => 0,
    tur: { tilstand: 'spiller_aktiv', baeverId: 1, holdIdx: 0, tickTilbage: 1800, retreatTil: null, turNr: 1 },
    valgtVaaben: 'ingen', valgtLunte: 3, hold: [{ ammo: {} }, { ammo: {} }],
    aktivBaever() { for (const b of this.baevere) if (b.id === this.tur.baeverId) return b; return null; },
    vaabenNu: () => null, ammoFor: () => 0,
    pidPaaHold: (pid, h) => (pid === 'p1' && h === 0) || (pid === 'p2' && h === 1),
  };
}
/** Renderen: tilSkaerm læser lærredets størrelse (som renderer.js). delt:
 *  genbrug resultatet, så allokeringstesten kun måler HUD'en. */
function lavR({ delt = false } = {}) {
  const laerred = new El('canvas'), p = { x: 0, y: 0 };
  const r = {
    kamX: 0,
    tilSkaerm(x, y) {
      const w = laerred.clientWidth, h = laerred.clientHeight;
      const q = delt ? p : {};
      q.x = x - r.kamX; q.y = h - y; if (w < 0) q.x = 0;
      return q;
    },
  };
  return r;
}

/* main.js' egen taelSkade og fyldet, skåret ud af kilden (som i
 * vejledning_hjaelp.mjs) og kørt med den rigtige HUD: skaden holdes tilbage
 * under skuddet, så afsløres den. Lyden, reaktionen og skadetallet logges
 * (det rigtige skadeTal læser layout på et løst element, som den falske DOM
 * ville tælle som tvunget). */
const MAIN = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
function blok(start, slut) {
  const i = MAIN.indexOf(start);
  assert.ok(i >= 0, `main.js: fandt ikke ${start}`);
  const j = MAIN.indexOf(slut, i + start.length);
  assert.ok(j >= 0, `main.js: fandt ikke slutningen på ${start}`);
  return MAIN.slice(i, j + slut.length);
}
const lavTaelSkade = new Function('S', 'hud', 'lyd', 'r', 'skadeForloeb', 'skadeK', [
  blok('hud.saetVisHp(', ');\n'),
  blok('hud.saetFyldHp(', '});\n'),
  blok('const UROLIG = new Set(', '\n}\n'),
  'return taelSkade;',
].join('\n'));
function lavTaeller(hud, r) {
  const log = { tal: [], lyd: [], ramt: [] };
  const S = { visHp: new Map(), sidsteTik: 0 };
  const hudF = {
    saetVisHp: (f) => hud.saetVisHp(f), saetFyldHp: (f) => hud.saetFyldHp(f),
    markerRamt: (id, paa) => hud.markerRamt(id, paa),
    skadeTal: (b, tal) => log.tal.push({ id: b.id, tal, nu: NU }),
  };
  const lyd = { afspil: (navn) => log.lyd.push(navn) };
  const vi = { baevere: { get: (id) => ({ ramt: () => log.ramt.push(id) }) } };
  const taelSkade = lavTaelSkade(S, hudF, lyd, r, skadeForloeb, skadeK);
  return { log, tael: (v, nu) => taelSkade(v, vi, nu) };
}

function lavKamp(ropt) {
  const rod = body.appendChild(new El('div'));
  const r = lavR(ropt), v = lavVerden();
  const hud = lavHud(rod, r);
  const { tael, log } = lavTaeller(hud, r);
  const frame = (ms = 1000 / 60, pid = 'p1') => {
    NU += ms; nyFrame();
    tael(v, NU);
    hud.opdater(v, pid, null, false, 0, true);
  };
  return { rod, r, v, hud, frame, el: hud.el, log };
}
const skilte = (k) => k.el.etiketter.children.filter((n) => n.classList.contains('etiket'));
function skilt(k, navn) { return skilte(k).find((n) => n.querySelector('.tbj-navn').textContent === navn) || null; }
function lag(n) {
  const t = n.classList.contains('tbj') ? n : n.querySelector('.tbj');
  const tx = (c) => t.querySelector(c).style.transform;
  return { t, fyld: tx('.tbj-fyld'), tab: tx('.tbj-tab'), over: tx('.tbj-over'), smitte: tx('.tbj-smitte'), tal: t.querySelector('.tbj-tal').textContent };
}
const x = (p) => `translateX(${p - 100}%)`;
const sx = (fyld) => `translateX(${Math.round(smitteX(fyld) * 100) / 100}%)`;

/* ------------------------------------------------------------ rene funktioner */

test('procent: fyldet er hp/100, klemt; overskuddet og smitten i samme skala', () => {
  assert.deepEqual([-5, 0, 68, 100, 150].map(pct), [0, 0, 68, 100, 100]);
  assert.equal(overPct(150), 50); assert.equal(overPct(80), 0);
  assert.equal(smitteX(SMITTE_SKADE), 0);
  assert.ok(smitteX(3) < 0, 'under 6: klippes af bjælkens kant');
  assert.equal(smitteX(160), smitteX(100), 'over 100: tikket tager af overskuddet, laget står ved fuld');
});

test('navne: romertallet bevares, kaldenavnene findes for hele personalet', () => {
  for (const r of ROSTER) {
    for (let nr = 0; nr < 10; nr++) {
      const navn = rosterNavn(r.figur, nr), [stamme, suffiks] = delNavn(navn);
      assert.equal(stamme + suffiks, navn);
      assert.equal(stamme, r.navn, `${navn}: stammen er rosternavnet`);
      assert.equal(kortNavn(navn).endsWith(suffiks), true, `${navn}: ${kortNavn(navn)}`);
    }
  }
  assert.deepEqual(delNavn('Systemsygeplejerske 2.0'), ['Systemsygeplejerske 2.0', ''], 'intet falsk romertal');
  const kort = Object.values(PERSONALE).flat().map((p) => kortNavn(p.navn));
  assert.deepEqual(kort, ['Ingrid', 'Bente', 'Dr. Hansen', 'Trine', 'System 2.0', 'Dr. Jan']);
  assert.equal(kortNavn('Dr. Jan fra Mors III'), 'Dr. Jan III');
  assert.equal(kortNavn('Bo IV'), 'Bo IV', 'egne navne står, som de er');
});

test('nedtællingen: samme sluttid, tallet står stille i holdet og skyder aldrig over', () => {
  const t = skadeForloeb(80, 32, 0);
  assert.equal(t.start + t.varighed, Math.min(2200, 900 + 48 * 18), 'samme sluttid som før');
  assert.equal(t.start, TAB_HOLD_MS);
  let forrige = 80;
  for (let nu = 0; nu <= t.start + t.varighed + 50; nu += 5) {
    const k = skadeK(t, nu), vist = Math.round(80 + (32 - 80) * (1 - (1 - k) ** 2));
    if (nu < t.start) assert.equal(vist, 80, `i holdet (${nu} ms)`);
    assert.ok(vist <= forrige && vist <= 80 && vist >= 32, `${nu} ms: ${vist}`);
    forrige = vist;
  }
  assert.equal(forrige, 32);
  // Klemmen er nødvendig: uden den giver holdet k < 0, og tallet skyder over 80.
  const raa = (nu) => (nu - t.start) / t.varighed;
  assert.ok(80 + (32 - 80) * (1 - (1 - raa(0)) ** 2) > 80);
  // Små skader holder mindst 400 ms nedtælling efter holdet.
  const lille = skadeForloeb(10, 6, 0);
  assert.ok(lille.varighed >= 400);
});

/* ------------------------------------------------------------ saetTbj skriver kun ændringer */

function falskTbj() {
  const el = new El('div');
  for (const c of ['tbj-tab', 'tbj-fyld', 'tbj-smitte', 'tbj-over']) el.appendChild(new El('i')).className = c;
  el.appendChild(new El('span')).className = 'tbj-navn';
  el.appendChild(new El('span')).className = 'tbj-tal';
  return tbjRefs(el);
}

test('saetTbj: første kald skriver lagene, i ro intet, kun det ændrede', () => {
  const t = falskTbj();
  dom.skriv = 0; saetTbj(t, 68, 68, false);
  assert.equal(dom.skriv, 5, 'tal, tab, over, fyld og smitte');
  assert.equal(t.tal.textContent, '68');
  assert.equal(t.fyld.style.transform, 'translateX(-32%)');
  dom.skriv = 0;
  for (let i = 0; i < 10000; i++) saetTbj(t, 68, 68, false);
  assert.equal(dom.skriv, 0, 'samme værdier: ingen skrivninger');
  saetTbj(t, 68, 32, false);
  assert.equal(dom.skriv, 1, 'kun fyldet');
  assert.equal(t.fyld.style.transform, 'translateX(-68%)');
  assert.equal(t.tab.style.transform, 'translateX(-32%)', 'det tabte står ved tallet');
  // Død: fyldet er tomt, det tabte følger tallet; negative tal bliver 0.
  saetTbj(t, 80, 0, false);
  assert.equal(t.fyld.style.transform, 'translateX(-100%)');
  assert.equal(t.tab.style.transform, 'translateX(-20%)');
  saetTbj(t, -12, 0, false);
  assert.equal(t.tal.textContent, '0');
  // Fyldet er aldrig mere end tallet.
  saetTbj(t, 40, 90, false);
  assert.equal(t.fyld.style.transform, 'translateX(-60%)');
  // Piller over 100: strimlen viser overskuddet i samme skala.
  saetTbj(t, 150, 150, false);
  assert.equal(t.over.style.transform, 'translateX(-50%)');
  assert.ok(t.el.classList.contains('over'));
  saetTbj(t, 20, 20, false);
  assert.ok(t.el.classList.contains('lav') && !t.el.classList.contains('over'), `lav ved ${LAV_HP} og under`);
  // COVID: de sidste SMITTE_SKADE af fyldet, højrekanten ved fyldet.
  saetTbj(t, 68, 68, true);
  const tx = parseFloat(/translateX\((-?[\d.]+)%\)/.exec(t.smitte.style.transform)[1]);
  const hoejre = ((tx / 100) * SMITTE_SKADE + SMITTE_SKADE);       // i % af bjælken
  assert.ok(Math.abs(hoejre - 68) < 0.01, `smittens højrekant ved ${hoejre.toFixed(2)} %`);
  saetTbj(t, 68, 68, false);
  assert.equal(t.smitte.style.transform, 'translateX(-200%)', 'rask: ude af syne');
});

/* ------------------------------------------------------------ HUD'en i den falske DOM */

test('skiltet: kaldenavn og tal i bjælken, holdfarven og luften over hovedet', async () => {
  const k = lavKamp();
  k.frame();
  await Promise.resolve();
  assert.ok(document.documentElement.classList.contains('tbj-grafik'), 'kunsten er slået til, når begge filer findes');
  assert.equal(skilte(k).length, 4);
  const n = skilt(k, 'Ingrid II');
  assert.ok(n, 'kaldenavn + romertal på skiltet');
  const l = lag(n);
  assert.equal(l.tal, '100');
  assert.equal(l.fyld, x(100));
  assert.match(l.t.getAttribute('style'), /--hf:#10546B;--hk:#0d3145/, 'holdets farve og kant');
  // Ankeret er kameraets (kamera_fri.mjs): tilSkaerm(x, y + 58) - 8 px.
  const b = k.v.baevere[1], p = k.r.tilSkaerm(b.x, b.y + ETIKET_WU);
  assert.equal(n.style.transform, `translate3d(${p.x | 0}px, ${(p.y - ETIKET_PX) | 0}px, 0) translate(-50%, -100%)`);
  // Den aktive og egen kunde.
  const a = skilt(k, 'Ingrid');
  assert.ok(a.classList.contains('aktiv') && a.classList.contains('egen'));
  assert.ok(!skilt(k, 'Dr. Jan').classList.contains('egen'));
  // Den aktive øverst: det fulde navn; holdlisten: kaldenavnene.
  assert.equal(k.el.aktiv.querySelector('.tbj-stamme').textContent, 'Skrankepaven Ingrid');
  assert.deepEqual(k.el.hold.querySelectorAll('.tbj-navn').map((e) => e.textContent), ['Ingrid', 'Ingrid II', 'Dr. Jan', 'Dr. Jan II']);
  assert.deepEqual(k.el.hold.querySelectorAll('.hn-hp').map((e) => e.textContent), ['200', '200']);
});

test('i ro: ingen skrivninger og ingen innerHTML pr. frame', () => {
  const k = lavKamp();
  for (let i = 0; i < 3; i++) k.frame();
  dom.skriv = 0;
  for (let i = 0; i < 600; i++) k.frame();
  assert.equal(dom.skriv, 0, `${dom.skriv} skrivninger på 600 frames i ro`);
  // Kameraet flytter sig: kun skiltenes transform.
  k.r.kamX = 40; dom.skriv = 0; k.frame();
  assert.equal(dom.skriv, 4, 'én transform pr. skilt');
});

test('træf: fyldet falder straks, det tabte og tallet venter og tæller ned, uden tvunget layout', () => {
  const k = lavKamp();
  k.frame();
  const b = k.v.baevere[2];                     // Dr. Jan
  // Skuddet: simulationen har trukket skaden, men den vises ikke endnu.
  k.v.tur.tilstand = 'oploesning'; b.hp = 32;
  for (let i = 0; i < 30; i++) k.frame();
  let l = lag(skilt(k, 'Dr. Jan'));
  assert.deepEqual([l.tal, l.fyld, l.tab], ['100', x(100), x(100)], 'Worms: tilbageholdt under skuddet');
  // Verden i ro: afsløringen.
  k.v.tur.tilstand = 'skade';
  dom.tvunget = 0;
  k.frame();
  const n = skilt(k, 'Dr. Jan');
  l = lag(n);
  assert.deepEqual([l.tal, l.fyld, l.tab], ['100', x(32), x(100)], 'fyldet falder straks, det tabte viser 32-100');
  assert.ok(n.classList.contains('ramt'));
  const raekke = k.el.hold.querySelectorAll('.hbaever').find((r) => r.dataset.id === '3');
  assert.ok(lag(raekke).t.classList.contains('ramt'), 'holdlisten ser også træffet');
  // Holdet: tallet står stille.
  k.frame(TAB_HOLD_MS - 40);
  assert.equal(lag(n).tal, '100');
  // Nedtællingen: tallet og det tabte løber ned sammen; fyldet står.
  const set = [];
  for (let i = 0; i < 200; i++) { k.frame(); const q = lag(n); set.push(+q.tal); assert.equal(q.fyld, x(32)); assert.equal(q.tab, x(+q.tal)); }
  assert.ok(set.every((v, i) => i === 0 || v <= set[i - 1]), 'falder aldrig i stigning');
  assert.equal(set.at(-1), 32);
  assert.ok(!n.classList.contains('ramt'), 'rystelsen stopper ved slut');
  assert.equal(k.el.hold.querySelectorAll('.hn-hp')[1].textContent, '132');
  assert.equal(dom.tvunget, 0, 'ingen layoutlæsning efter en skrivning i samme frame');
});

/* Stregkodescanneren (brugPrTur 2, slutter ikke turen): første scan afsløres
 * i spiller_aktiv, og nedtællingen kører endnu, når andet scan lander i
 * samme tick som affyringen. Før blev den nye skade foldet ind i den kørende
 * kurve: fyldet faldt midt i skuddet, intet nyt tal og ingen lyd, og tallet
 * sprang (12 point på én frame; 28 med kun "roligt &&" på foldningen). */
test('ny skade midt i en nedtælling: fyldet holder under skuddet, så et nyt tal fra det, der står', () => {
  const k = lavKamp();
  k.frame();
  const b = k.v.baevere[2];                     // Dr. Jan
  const n = skilt(k, 'Dr. Jan');
  const raekke = () => k.el.hold.querySelectorAll('.hbaever').find((r) => r.dataset.id === '3');
  const skader = () => k.log.lyd.filter((l) => l === 'skade').length;
  b.hp = 66; k.frame();
  const t0 = NU;
  assert.deepEqual(k.log.tal.map((t) => t.tal), [34], 'første scan: −34 i ro');
  assert.equal(lag(n).fyld, x(66));
  let forrige = 100, maksFald = 0;
  const trin = () => {
    k.frame();
    const tal = +lag(n).tal;
    assert.ok(tal <= forrige, `tallet stiger aldrig (${forrige} → ${tal})`);
    maksFald = Math.max(maksFald, forrige - tal);
    forrige = tal;
    return tal;
  };
  for (let i = 0; i < 11; i++) trin();
  // Andet scan: skaden lander i affyringens tick.
  k.v.tur.tilstand = 'affyring'; b.hp = 32;
  for (let i = 0; i < 6; i++) trin();
  k.v.tur.tilstand = 'oploesning';
  while (NU - t0 < 1100) {
    const tal = trin();
    assert.equal(lag(n).fyld, x(66), `${Math.round(NU - t0)} ms: fyldet holder under skuddet`);
    assert.equal(lag(raekke()).fyld, x(66), 'også i holdlisten');
    assert.ok(tal >= 66, 'tallet løber kun mod det første mål');
  }
  assert.equal(k.log.tal.length, 1, 'intet nyt tal under skuddet');
  assert.equal(skader(), 1, 'ingen skadelyd under skuddet');
  assert.ok(forrige > 66, 'den første nedtælling kører stadig, når der bliver ro');
  // Ro: en ny afsløring med sit eget tal, fra det tal, der står nu.
  k.v.tur.tilstand = 'skade';
  const stod = forrige, ro = NU + 1000 / 60;
  trin();
  assert.deepEqual(k.log.tal.map((t) => t.tal), [34, 34], 'andet scan: sit eget −34');
  // Skadelyden højst hvert SKADELYD_MS (1,2 s) pr. kunde (ilden tikker hvert
  // halve sekund): andet scan kom kort efter det første, så kun tallet.
  assert.equal(skader(), NU - t0 >= 1200 ? 2 : 1, 'skadelyd kun, hvis der er gået 1,2 s');
  assert.deepEqual(k.log.ramt, [3, 3], 'og sin reaktion');
  assert.equal(lag(n).fyld, x(32), 'fyldet falder først nu');
  assert.equal(lag(n).tal, String(stod), 'tallet springer ikke');
  assert.equal(lag(n).tab, x(stod), 'det tabte fra det viste tal');
  assert.ok(n.classList.contains('ramt'));
  while ((lag(n).tal !== '32' || n.classList.contains('ramt')) && NU - ro < 3000) { trin(); assert.equal(lag(n).fyld, x(32)); }
  assert.equal(lag(n).tal, '32');
  assert.ok(!n.classList.contains('ramt'), 'rystelsen stopper ved slut');
  assert.ok(maksFald <= 1, `tallet falder højst 1 pr. frame (${maksFald})`);
  const efterspil = +/EFTERSPIL_SKADE = (\d+)/.exec(readFileSync(new URL('../static/js/sim/world.js', import.meta.url), 'utf8'))[1];
  assert.ok(NU - ro <= (efterspil / HZ) * 1000, `talt ned på ${Math.round(NU - ro)} ms, inden for efterspillet`);
  assert.equal(k.log.tal.length, 2);
});

test('ild under en nedtælling i ro: tikket får sit eget tal med det samme', () => {
  const k = lavKamp();
  k.frame();
  const b = k.v.baevere[3];                     // Dr. Jan II
  const n = skilt(k, 'Dr. Jan II');
  b.hp = 70; k.frame();
  for (let i = 0; i < 20; i++) k.frame();
  const stod = +lag(n).tal;
  assert.ok(stod > 70, 'nedtællingen kører');
  b.hp = 67; k.frame();                         // et ildtik i spiller_aktiv
  assert.deepEqual(k.log.tal.map((t) => t.tal), [30, 3]);
  assert.equal(lag(n).fyld, x(67));
  assert.ok(+lag(n).tal >= stod - 1, 'intet spring');
  for (let i = 0; i < 200; i++) k.frame();
  assert.equal(lag(n).tal, '67');
});

test('lav tålmodighed: skiltet gløder fra 25 og ned', () => {
  const k = lavKamp();
  k.frame();
  k.v.baevere[3].hp = 26;
  for (let i = 0; i < 200; i++) k.frame();
  assert.ok(!skilt(k, 'Dr. Jan II').classList.contains('lav'));
  k.v.baevere[3].hp = 25;
  for (let i = 0; i < 200; i++) k.frame();
  assert.ok(skilt(k, 'Dr. Jan II').classList.contains('lav'));
});

test('død: fyldet tomt med det samme, tallet tæller ned, så toner skiltet ud og fjernes', () => {
  const k = lavKamp();
  k.frame();
  const b = k.v.baevere[3];                     // Dr. Jan II
  k.v.tur.tilstand = 'oploesning'; b.hp = 0; b.doed = true;
  k.frame();
  let n = skilt(k, 'Dr. Jan II');
  assert.deepEqual([lag(n).tal, lag(n).fyld, lag(n).tab], ['100', x(0), x(100)], 'det gamle tal som rødt tabt stykke');
  assert.ok(n.classList.contains('doed') && !n.classList.contains('ude'));
  const raekke = () => k.el.hold.querySelectorAll('.hbaever').find((r) => r.dataset.id === '4');
  assert.ok(!raekke().classList.contains('doed'), 'holdlisten: først død, når tallet er talt ned');
  k.v.tur.tilstand = 'skade';
  for (let i = 0; i < 160 && lag(n).tal !== '0'; i++) k.frame();
  assert.equal(lag(n).tal, '0');
  k.frame();
  assert.ok(n.classList.contains('ude'), 'toner ud');
  assert.ok(raekke().classList.contains('doed'));
  assert.equal(k.el.hold.querySelectorAll('.hn-tal')[1].textContent, '1/2');
  for (let i = 0; i < 45; i++) k.frame();
  assert.equal(skilt(k, 'Dr. Jan II'), null, 'fjernet efter udtoningen');
  for (let i = 0; i < 60; i++) k.frame();
  assert.equal(skilt(k, 'Dr. Jan II'), null, 'og kommer ikke igen');
});

test('en kunde, der allerede var død i snapshottet, får aldrig et skilt', () => {
  const k = lavKamp();
  Object.assign(k.v.baevere[0], { hp: 0, doed: true });
  k.v.tur.baeverId = 2;
  for (let i = 0; i < 5; i++) k.frame();
  assert.equal(skilt(k, 'Ingrid'), null);
  assert.equal(skilte(k).length, 3);
});

test('piller over 100: tallet og fyldet med det samme, strimlen viser overskuddet', () => {
  const k = lavKamp();
  k.frame();
  const b = k.v.baevere[0];
  b.hp = 60; for (let i = 0; i < 200; i++) k.frame();
  b.hp = 110; k.frame();
  const l = lag(skilt(k, 'Ingrid'));
  assert.deepEqual([l.tal, l.fyld, l.over], ['110', x(100), x(10)]);
  assert.ok(l.t.classList.contains('over'));
  const top = lag(k.el.aktiv);
  assert.equal(top.tal, '110', 'den aktive øverst');
  assert.equal(top.over, x(10));
});

test('COVID: næste tik står skraveret i enden af fyldet; kraftfeltet blokerer det', () => {
  const k = lavKamp();
  k.frame();
  const b = k.v.baevere[2];
  b.smittet = 2; k.frame();
  const n = skilt(k, 'Dr. Jan');
  assert.equal(lag(n).smitte, sx(100));
  assert.ok(k.el.hold.querySelector('.hb-ikon.smittet'), 'ikonet i holdlisten');
  b.skjold = true; k.frame();
  assert.equal(lag(n).smitte, 'translateX(-200%)', 'kraftfeltet tager COVID-tikket');
  // Turslut: tikket bliver det tabte stykke gennem den samme afsløring.
  b.skjold = false; b.hp = 100 - SMITTE_SKADE; k.v.tur.tilstand = 'tur_slut';
  k.frame();
  assert.deepEqual([lag(n).tal, lag(n).fyld], ['100', x(100 - SMITTE_SKADE)]);
  assert.equal(lag(n).smitte, sx(100 - SMITTE_SKADE));
});

test('den aktive øverst og holdlisten bygges kun om, når nøglen skifter', () => {
  const k = lavKamp();
  k.frame();
  let byg = 0, bygHold = 0;
  const top = k.el.aktiv, hold = k.el.hold;
  const tael = (e, f) => { const d = Object.getOwnPropertyDescriptor(El.prototype, 'innerHTML');
    Object.defineProperty(e, 'innerHTML', { set(h) { f(); d.set.call(this, h); }, configurable: true }); };
  tael(top, () => byg++); tael(hold, () => bygHold++);
  // Et træf med nedtælling: tallene skrives på stedet.
  k.v.tur.tilstand = 'skade'; k.v.baevere[0].hp = 40;
  for (let i = 0; i < 200; i++) k.frame();
  assert.equal(lag(top).tal, '40');
  assert.deepEqual([byg, bygHold], [0, 0], 'ingen innerHTML under nedtællingen');
  // Turskift: begge bygges én gang.
  k.v.tur.baeverId = 3; k.v.tur.holdIdx = 1;
  for (let i = 0; i < 10; i++) k.frame(undefined, 'p2');
  assert.deepEqual([byg, bygHold], [1, 1]);
  assert.equal(top.querySelector('.tbj-stamme').textContent, 'Dr. Jan fra Mors');
  assert.ok(top.classList.contains('dinTur') && top.querySelector('.dintur-mark'));
  // Status (kraftfelt) står under bjælken.
  k.v.baevere[2].skjold = true; k.frame(undefined, 'p2');
  assert.ok(top.querySelector('.ak-under')?.querySelector('.hb-ikon.skjold'));
  assert.deepEqual([byg, bygHold], [2, 2]);
});

test('allokering: skiltene allokerer intet pr. frame i ro og under nedtælling (kræver --expose-gc)',
  { skip: typeof globalThis.gc !== 'function' }, async () => {
    const k = lavKamp({ delt: true });
    NU = Math.round(NU);                          // heltal: testens eget ur må ikke allokere
    const koer = (n) => { for (let i = 0; i < n; i++) { NU += 16; nyFrame(); k.hud.opdaterEtiketter(k.v, k.r); } };
    koer(3000);                                   // varm op (JIT)
    const iRo = await bytesPrFrame(() => koer(1), 4000);
    // Nedtælling: tallet og det tabte skifter hver frame, fyldet ind imellem.
    // Tallene kommer fra et Int32Array (ikke testens kopi af taelSkade, der
    // selv allokerer), så kun HUD'en måles. Over LAV_HP: den falske DOM's
    // classList allokerer selv, når en klasse skifter.
    const vist = new Int32Array(8).fill(100), fyld = new Int32Array(8).fill(100);
    k.hud.saetVisHp((b) => vist[b.id]);
    k.hud.saetFyldHp((b) => fyld[b.id]);
    let i = 0;
    const nedtael = () => {
      NU += 16; nyFrame(); i++;
      vist[3] = 100 - (i % 70); fyld[3] = 30 + ((i >> 5) % 60);
      k.hud.opdaterEtiketter(k.v, k.r);
    };
    for (let j = 0; j < 3000; j++) nedtael();
    const under = await bytesPrFrame(nedtael, 2000);
    // Hele HUD'en i ro, til orientering (våbenbjælkens nøgle er stadig en streng).
    const hel = await bytesPrFrame(() => { NU += 16; nyFrame(); k.hud.opdater(k.v, 'p1', null, false, 0, true); }, 2000);
    console.log(`# skiltene: ${iRo.toFixed(1)} B/frame i ro, ${under.toFixed(1)} B/frame under nedtælling; hele HUD'en i ro: ${hel.toFixed(1)} B/frame`);
    assert.ok(iRo < 16, `i ro: ${iRo.toFixed(1)} B/frame`);
    assert.ok(under < 32, `under nedtælling: ${under.toFixed(1)} B/frame`);
  });

/** Allokerede bytes pr. kald: heapens vækst uden GC undervejs (en GC under
 *  målingen kasseres). Mindste af tre målinger, så en JIT-omkompilering, der
 *  tilfældigvis lander i målingen, ikke tæller som frame-allokering. */
async function bytesPrFrame(fn, n) {
  let gcs = 0;
  const obs = new PerformanceObserver((l) => { gcs += l.getEntries().length; });
  obs.observe({ entryTypes: ['gc'] });
  const vent = () => new Promise((r) => setImmediate(r));
  const gode = [];
  try {
    for (let forsoeg = 0; forsoeg < 12 && gode.length < 3; forsoeg++) {
      globalThis.gc(); globalThis.gc();
      await vent(); await vent(); gcs = 0;
      const foer = process.memoryUsage().heapUsed;
      for (let i = 0; i < n; i++) fn();
      const efter = process.memoryUsage().heapUsed;
      await vent(); await vent();
      if (gcs === 0) gode.push(Math.max(0, efter - foer) / n);
      else n = Math.max(200, n >> 1);
    }
    return gode.length ? Math.min(...gode) : NaN;
  } finally { obs.disconnect(); }
}

/* ------------------------------------------------------------ kildevagter */

const kilde = (sti) => readFileSync(new URL(sti, import.meta.url), 'utf8');

test('main.js: nedtællingen og fyldet bruger tbj.js', () => {
  const main = kilde('../static/js/main.js');
  assert.match(main, /e\.t = skadeForloeb\(e\.vist, b\.hp, nu\)/);
  assert.match(main, /const k = skadeK\(e\.t, nu\)/);
  assert.match(main, /hud\.saetFyldHp\(/);
});

/** app.css som regler: { vaelger, krop, media }. */
function cssRegler(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const ud = [];
  const gaa = (s, media) => {
    let i = 0;
    while (i < s.length) {
      const aab = s.indexOf('{', i);
      if (aab < 0) break;
      const vaelger = s.slice(i, aab).trim();
      let dybde = 1, j = aab + 1;
      while (j < s.length && dybde) { if (s[j] === '{') dybde++; else if (s[j] === '}') dybde--; j++; }
      const krop = s.slice(aab + 1, j - 1);
      if (vaelger.startsWith('@media')) gaa(krop, vaelger);
      else if (!vaelger.startsWith('@keyframes')) ud.push({ vaelger, krop, media });
      else ud.push({ vaelger, krop, media, keyframes: true });
      i = j;
    }
  };
  gaa(css, '');
  return ud;
}

test('app.css: ingen margin-rystelse, ingen dobbeltskalering, kun hentede vægte, reduceret bevægelse', () => {
  const css = kilde('../static/app.css'), regler = cssRegler(css);
  const kf = regler.find((r) => r.keyframes && /etiketRamt/.test(r.vaelger));
  assert.ok(kf && !/margin/.test(kf.krop), 'rystelsen bruger translate, ikke margin');
  for (const r of regler) {
    if (/\.hud-aktiv \.tbj|\.hbaever \.tbj/.test(r.vaelger)) assert.ok(!/--ui/.test(r.krop), `${r.vaelger}: skaleres allerede af beholderen`);
  }
  // Vægtene i bjælkens regler findes i Poppins-linket.
  const html = kilde('../static/index.html');
  const hentet = /Poppins:wght@([\d;]+)/.exec(html)[1].split(';').map(Number);
  for (const r of regler.filter((q) => /\.tbj/.test(q.vaelger))) {
    for (const m of r.krop.matchAll(/font(?:-weight)?:\s*(\d{3})/g)) {
      assert.ok(hentet.includes(+m[1]), `${r.vaelger}: vægt ${m[1]} er ikke hentet (${hentet})`);
    }
  }
  assert.ok(hentet.includes(800), 'navnet er 800 (art directoren)');
  // Reduceret bevægelse: gløden står fast på .8 (ellers er den usynlig uden animationen).
  const ro = regler.filter((r) => /prefers-reduced-motion/.test(r.media));
  const gloed = ro.find((r) => r.vaelger === '.etiket.lav::before');
  assert.ok(gloed && /opacity:\s*\.8/.test(gloed.krop), 'gløden står fast på .8');
  assert.ok(ro.some((r) => /(^|,)\s*\*\s*$/.test(r.vaelger) && /animation:none!important/.test(r.krop)) ||
            ro.some((r) => /\.dintur-mark/.test(r.vaelger)), 'DIN TUR-pulsen er slået fra');
  // Den globale *-regel rammer ikke pseudo-elementer: hvert ::before/::after
  // med en animation i skiltets og bjælkens regler slås fra for sig (eller
  // af en global regel, der også nævner *::before/*::after).
  for (const r of regler) {
    if (r.media || r.keyframes || !/::(before|after)/.test(r.vaelger) || !/\.(etiket|tbj|hbaever|hud-aktiv)/.test(r.vaelger)) continue;
    if (!/animation:(?!\s*none)/.test(r.krop)) continue;
    const pseudo = /::(before|after)/.exec(r.vaelger)[0];
    const slaaet = ro.some((q) => /animation:\s*none/.test(q.krop) &&
      (q.vaelger === r.vaelger || q.vaelger.split(',').some((s) => s.trim() === '*' + pseudo)));
    assert.ok(slaaet, `${r.vaelger}: animationen kører videre med reduceret bevægelse`);
  }
  assert.match(gloed.krop, /animation:\s*none/, 'gløden pulserer ikke');
  // Sporet: 20 % holdfarve på #060E14 (hp_design.md §2), så blå og rød kan
  // skelnes, også når bjælken er næsten tom (12 % på #0B141A gav rødt gråt).
  const spor = regler.find((r) => r.vaelger === '.tbj');
  const sm = /background:\s*color-mix\(in srgb,\s*var\(--hf\)\s*(\d+)%,\s*(#[0-9a-f]{6})\)/i.exec(spor.krop);
  assert.ok(sm, 'sporet er en color-mix af holdfarven');
  assert.deepEqual([+sm[1], sm[2].toUpperCase()], [20, '#060E14']);
  assert.match(spor.krop, /background:\s*#060E14\s*;/i, 'uden color-mix: den samme mørke bund');
  // Skiltets bjælke har en fast størrelse (contain:strict).
  assert.ok(regler.some((r) => r.vaelger === '.etiketter .tbj' && /contain:strict/.test(r.krop)));
});

test('kunsten: filerne findes, og CSS og tbj.js peger på dem', () => {
  const css = kilde('../static/app.css');
  for (const f of TBJ_GRAFIK) assert.ok(existsSync(STATIC + f), `${f} findes`);
  for (const m of css.matchAll(/url\((grafik\/hud\/[^)]+)\)/g)) {
    assert.ok(TBJ_GRAFIK.includes('/' + m[1]), `${m[1]} hentes også af tbj.js`);
  }
  assert.match(css, /border-image:url\(grafik\/hud\/tbj_ramme\.svg\) 5 fill stretch/);
  assert.match(css, /background-blend-mode:multiply/);
});

/* ---- farver: WCAG-kontrast og CIE76-ΔE, som hp_design.md §2 måler dem */

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** color-mix(in srgb, a p%, b): kanal for kanal i sRGB (gammakodet). */
const bland = (a, b, p) => a.map((v, i) => v * p / 100 + b[i] * (1 - p / 100));
const rgbAf = (s) => { s = s.replace('#', ''); if (s.length === 3) s = [...s].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
function lab(c) {
  const [r, g, b] = c.map(lin);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

/** Rækkernes middelfarve i en 8-bit PNG (gråtone, RGB, med eller uden alfa). */
function pngRaekker(sti) {
  const png = readFileSync(sti), idat = [];
  let w = 0, h = 0, bpp = 0;
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o), type = png.toString('latin1', o + 4, o + 8), d = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      assert.equal(d[8], 8, 'teksturen er 8 bit'); assert.equal(d[12], 0, 'teksturen er ikke interlaced');
      bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[d[9]];
      assert.ok(bpp, `farvetype ${d[9]}`);
    }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const raa = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raa[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = i >= bpp && y ? px[(y - 1) * stride + i - bpp] : 0;
      let v = raa[y * (stride + 1) + 1 + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + i] = v & 255;
    }
  }
  const raekker = [];
  for (let y = 0; y < h; y++) {
    const s = [0, 0, 0];
    for (let x = 0; x < w; x++) {
      const o = y * stride + x * bpp;
      if (bpp <= 2) { s[0] += px[o]; s[1] += px[o]; s[2] += px[o]; } else { s[0] += px[o]; s[1] += px[o + 1]; s[2] += px[o + 2]; }
    }
    raekker.push(s.map((v) => v / w));
  }
  return raekker;
}

test('farver: fyld mod spor mindst 3:1 for hvert hold, også med kunstens tekstur, og tomme spor skilles', () => {
  const regler = cssRegler(kilde('../static/app.css'));
  const regel = (v) => regler.find((r) => r.vaelger === v && !r.media);
  const [, sporP, sporBund] = /background:\s*color-mix\(in srgb,\s*var\(--hf\)\s*(\d+)%,\s*(#[0-9a-f]{3,6})\)/i.exec(regel('.tbj').krop);
  // CSS-udgaven: gradientens midte (50 %).
  const cssMidt = +/color-mix\(in srgb,\s*var\(--hf\)\s*(\d+)%,\s*#fff\)\s*50%/i.exec(regel('.tbj-fyld').krop)[1];
  // Kunsten: den lysnede holdfarve ganget med teksturen (multiply).
  const kunst = regel('.tbj-grafik .tbj-fyld').krop;
  assert.match(kunst, /background:\s*var\(--hf\) url\(grafik\/hud\/tbj_tekstur\.png\)[^;]*;[\s\S]*background:\s*color-mix/,
    'først ren holdfarve (uden color-mix), så den lysnede');
  const kunstP = +/background:\s*color-mix\(in srgb,\s*var\(--hf\)\s*(\d+)%,\s*#fff\)\s*url\(grafik\/hud\/tbj_tekstur\.png\)/i.exec(kunst)[1];
  const raekker = pngRaekker(STATIC + '/grafik/hud/tbj_tekstur.png');
  const middel = [0, 1, 2].map((i) => raekker.reduce((s, r) => s + r[i], 0) / raekker.length);
  const moerkest = raekker.reduce((a, r) => (lum(r) < lum(a) ? r : a));
  const hvid = [255, 255, 255];
  const spor = {};
  for (const [navn, h] of Object.entries(HOLD)) {
    const hf = rgbAf(h.css);
    spor[navn] = bland(hf, rgbAf(sporBund), +sporP);
    const lys = bland(hf, hvid, kunstP);
    const maal = {
      css: kontrast(bland(hf, hvid, cssMidt), spor[navn]),
      kunst: kontrast(lys.map((v, i) => v * middel[i] / 255), spor[navn]),
      'kunst, mørkeste række': kontrast(lys.map((v, i) => v * moerkest[i] / 255), spor[navn]),
    };
    for (const [hvor, k] of Object.entries(maal)) assert.ok(k >= 3, `${navn} (${hvor}): fyld mod spor ${k.toFixed(2)}:1`);
  }
  // Næsten tom: kun sporet (og kanten) bærer holdet. §2 målte ΔE 16,0; 12 % på #0B141A gav 9,2.
  const dE = deltaE(spor.blaa, spor.roed);
  assert.ok(dE >= 15, `blåt og rødt spor: ΔE ${dE.toFixed(1)}`);
  // Holdkanten i kunsten: under lagene (intet z-index, før dem i træet) og
  // bredere end rammens streg, så den ses på sporet lige inden for stregen —
  // men ikke over fyldet eller teksten. Kunstens ::after lægger ingen ring.
  const kant = regel('.tbj-grafik .tbj::before');
  assert.ok(kant, 'kunsten har en holdkant');
  assert.match(kant.krop, /box-shadow:\s*inset 0 0 0 calc\([\d.]+px\*var\(--s\)\) var\(--hk/);
  assert.ok(!/z-index/.test(kant.krop), 'under lagene');
  const bredde = +/calc\(([\d.]+)px\*var\(--s\)\)/.exec(kant.krop)[1];
  // Rammens streg: fra kanten til rect.x + stroke-width/2 i SVG'ens enheder,
  // skaleret med border-image (slice → --tbj-kant).
  const svg = readFileSync(STATIC + '/grafik/hud/tbj_ramme.svg', 'utf8');
  const [, rx, rs] = /<rect[^>]*\sx="([\d.]+)"[^>]*\sstroke-width="([\d.]+)"/.exec(svg);
  const css = kilde('../static/app.css');
  const slice = +/tbj_ramme\.svg\) (\d+) fill/.exec(css)[1];
  const kanter = [...css.matchAll(/--tbj-kant:\s*([\d.]+)px/g)].map((m) => +m[1]);
  assert.ok(kanter.length >= 2, 'skiltets og holdlistens --tbj-kant');
  for (const k of kanter) {
    const streg = ((+rx + rs / 2) * k) / slice;
    assert.ok(bredde > streg && bredde <= k, `--tbj-kant ${k}px: kanten ${bredde}px, stregen ${streg}px`);
  }
  assert.match(regel('.tbj-grafik .tbj::after').krop, /box-shadow:\s*none/);
});

/* ------------------------------------------------------------ bredder (kun lokalt) */

/** Fremføringsbredden i px for tekst i en TTF (cmap 4 + hmtx; uden kerning). */
function ttfBredde(sti) {
  const b = readFileSync(sti), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), tab = {};
  for (let i = 0; i < dv.getUint16(4); i++) { const o = 12 + i * 16; tab[b.toString('latin1', o, o + 4)] = dv.getUint32(o + 8); }
  const upem = dv.getUint16(tab.head + 18), nH = dv.getUint16(tab.hhea + 34), c = tab.cmap;
  let sub = -1;
  for (let i = 0; i < dv.getUint16(c + 2); i++) {
    const off = dv.getUint32(c + 8 + i * 8);
    if (dv.getUint16(c + 4 + i * 8) === 3 && dv.getUint16(c + 6 + i * 8) === 1 && dv.getUint16(c + off) === 4) sub = c + off;
  }
  const seg = dv.getUint16(sub + 6) / 2, ends = sub + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
  const glyf = (cp) => {
    for (let i = 0; i < seg; i++) {
      if (cp > dv.getUint16(ends + i * 2)) continue;
      const s = dv.getUint16(starts + i * 2); if (cp < s) return 0;
      const d = dv.getInt16(deltas + i * 2), r = dv.getUint16(ranges + i * 2);
      if (!r) return (cp + d) & 0xffff;
      const g = dv.getUint16(ranges + i * 2 + r + (cp - s) * 2); return g ? (g + d) & 0xffff : 0;
    }
    return 0;
  };
  return (tekst, px) => { let w = 0; for (const ch of tekst) w += dv.getUint16(tab.hmtx + Math.min(glyf(ch.codePointAt(0)), nH - 1) * 4); return (w / upem) * px; };
}
const FONTE = homedir() + '/Library/Fonts/';
const harFonte = existsSync(FONTE + 'Poppins-ExtraBold.ttf') && existsSync(FONTE + 'Poppins-Black.ttf');

test('bredder: kaldenavn + IV kan være på skiltet, fulde navne + II øverst', { skip: !harFonte && 'Poppins er ikke installeret lokalt' }, () => {
  const navn = ttfBredde(FONTE + 'Poppins-ExtraBold.ttf'), tal = ttfBredde(FONTE + 'Poppins-Black.ttf');
  // Skiltet 120 px: polstring 2 · 7, mellemrum 6, tallet "100" i 13 px/900.
  const skilt = 120 - 14 - 6 - tal('100', 13);
  // Øverst 240 px: polstring 2 · 9, mellemrum 6, tallet i 16 px/900.
  const top = 240 - 18 - 6 - tal('100', 16);
  // Holdlisten: kortets 216 px − kant 5 − polstring 18 − markør 11 − 2 mellemrum 5 − ikoner 24; så bjælkens egen polstring 10, mellemrum 5, tallet i 10,5 px/900.
  const liste = 216 - 5 - 18 - 11 - 10 - 24 - 10 - 5 - tal('100', 10.5);
  for (const r of ROSTER) {
    const s = kortNavn(rosterNavn(r.figur, 3));
    assert.ok(navn(s, 11) <= skilt, `skiltet: "${s}" er ${navn(s, 11).toFixed(1)} px, plads til ${skilt.toFixed(1)}`);
    assert.ok(navn(s, 10) <= liste, `holdlisten: "${s}" er ${navn(s, 10).toFixed(1)} px, plads til ${liste.toFixed(1)}`);
    const f = rosterNavn(r.figur, 1);
    assert.ok(navn(f, 13) <= top, `øverst: "${f}" er ${navn(f, 13).toFixed(1)} px, plads til ${top.toFixed(1)}`);
  }
});
