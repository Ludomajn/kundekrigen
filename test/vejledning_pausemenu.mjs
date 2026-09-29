/* Kundekrigen — test: pausemenuens "Vis vejledningen igen" og "Alle taster"
 * (ui/menu.js visPause), med en lille falsk DOM og uden jsdom.
 *
 *   node --no-warnings --test test/vejledning_pausemenu.mjs
 *
 * Vejledningens slutkort og oversigten siger, at vejledningen kan vises igen
 * fra pausemenuen — og Esc gemmer flaget, så pausemenuen er den eneste vej
 * tilbage. Her tegnes den rigtige menu (lavMenu), og knapperne trykkes med
 * klik og med piletaster + Enter (menuNav) — først mod en spion, så mod
 * main.js' egen api og en rigtig vært (bordet fra vejledning_hjaelp.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavBord } from './vejledning_hjaelp.mjs';
import { NOEGLE, GRUPPER, kortHTML } from '../static/js/ui/hjaelp.js';

// ------------------------------------------------------------------ falsk DOM

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'wbr']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const afkod = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? m);

/** Én sammensat vælger uden mellemrum: tag, #id, .klasse, [attr], [attr=v], :not(…). */
function vaelger(s) {
  assert.ok(!/\s/.test(s.replace(/\[[^\]]*\]/g, '')), `falsk DOM: kun sammensatte vælgere (${s})`);
  const dele = [];
  const not = [];
  s = s.replace(/:not\(([^)]*)\)/g, (_, x) => { not.push(vaelger(x)); return ''; });
  for (const [, tag] of s.matchAll(/^([a-z][a-z0-9-]*)/g)) dele.push((el) => el.tag === tag);
  for (const [, id] of s.matchAll(/#([\w-]+)/g)) dele.push((el) => el.attr.get('id') === id);
  for (const [, kl] of s.matchAll(/\.([\w-]+)/g)) dele.push((el) => el.classList.contains(kl));
  for (const [, a, v] of s.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
    dele.push((el) => el.attr.has(a) && (v === undefined || el.attr.get(a) === v));
  }
  return (el) => dele.every((f) => f(el)) && !not.some((f) => f(el));
}

const dokument = { activeElement: null, addEventListener() {}, removeEventListener() {}, hidden: false };

class El {
  constructor(tag, attr = new Map()) {
    this.tag = tag; this.attr = attr; this.kids = []; this.parent = null;
    this.lyttere = {}; this.style = {};
    this.classList = {
      liste: () => (this.attr.get('class') || '').split(/\s+/).filter(Boolean),
      contains: (c) => this.classList.liste().includes(c),
      add: (...cs) => this.attr.set('class', [...new Set([...this.classList.liste(), ...cs])].join(' ')),
      remove: (...cs) => this.attr.set('class', this.classList.liste().filter((c) => !cs.includes(c)).join(' ')),
      toggle: (c, v = !this.classList.contains(c)) => { if (v) this.classList.add(c); else this.classList.remove(c); return v; },
    };
  }
  get id() { return this.attr.get('id') ?? ''; }
  get className() { return this.attr.get('class') ?? ''; }
  set className(v) { this.attr.set('class', v); }
  get dataset() {
    return Object.fromEntries([...this.attr].filter(([k]) => k.startsWith('data-'))
      .map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()), v]));
  }
  get textContent() { return this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); }
  get elementer() { return this.kids.filter((k) => typeof k !== 'string'); }
  get nextElementSibling() { const s = this.parent?.elementer; return s ? s[s.indexOf(this) + 1] ?? null : null; }
  get innerHTML() { return this._html ?? ''; }
  set innerHTML(html) {
    this._html = html;
    for (const k of this.elementer) k.parent = null;
    this.kids = [];
    const stak = [this];
    const re = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    for (const [hel, slut, tag, attrs, selvlukket, tekst] of html.matchAll(re)) {
      const top = stak.at(-1);
      if (tekst !== undefined) { top.kids.push(afkod(tekst)); continue; }
      if (slut) {
        const i = stak.findLastIndex((e) => e.tag === slut.toLowerCase());
        assert.ok(i > 0, `falsk DOM: </${slut}> uden start`);
        stak.length = i;
        continue;
      }
      if (!tag) { assert.ok(hel.startsWith('<!--')); continue; }
      const a = new Map();
      for (const [, k, v1, v2, v3] of attrs.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        a.set(k.toLowerCase(), afkod(v1 ?? v2 ?? v3 ?? ''));
      }
      const el = new El(tag.toLowerCase(), a);
      el.parent = top;
      top.kids.push(el);
      if (!selvlukket && !VOID.has(el.tag)) stak.push(el);
    }
  }
  *alle() { for (const k of this.elementer) { yield k; yield* k.alle(); } }
  querySelectorAll(s) { const f = vaelger(s); return [...this.alle()].filter(f); }
  querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
  matches(s) { return vaelger(s)(this); }
  closest(s) { for (let e = this; e; e = e.parent) if (e instanceof El && e.matches(s)) return e; return null; }
  contains(el) { for (let e = el; e; e = e.parent) if (e === this) return true; return false; }
  addEventListener(t, f) { (this.lyttere[t] ??= []).push(f); }
  removeEventListener(t, f) { this.lyttere[t] = (this.lyttere[t] || []).filter((x) => x !== f); }
  /** Bobler op gennem forfædrene, som i browseren. */
  send(t, e) { for (let el = this; el; el = el.parent) for (const f of el.lyttere[t] || []) f(e); }
  click() { this.onclick?.({ target: this }); this.send('click', { target: this }); }
  focus() { dokument.activeElement = this; }
  blur() { if (dokument.activeElement === this) dokument.activeElement = null; }
  scrollIntoView() {}
}

/** Et tastetryk på det element, der har fokus (menuNav lytter på #ml). */
function tast(code, key = code) {
  const e = { code, key, forhindret: false, preventDefault() { this.forhindret = true; } };
  (dokument.activeElement || rod).send('keydown', e);
  return e;
}

// ------------------------------------------------------------------ menu.js i node

// lyd.js lytter på window ved import (lås lyden op); localStorage til profilen.
const lager = new Map();
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = dokument;
globalThis.localStorage = {
  getItem: (k) => lager.get(k) ?? null, setItem: (k, v) => lager.set(k, String(v)), removeItem: (k) => lager.delete(k),
};
const { lavMenu } = await import('../static/js/ui/menu.js');

const rod = new El('div');

/** Den rigtige menu mod en api-spion. */
function lavSpion() {
  const kald = [];
  const api = new Proxy({}, { get: (_, navn) => (...a) => kald.push([navn, ...a]) });
  const menu = lavMenu(rod, api);
  return { menu, kald: () => kald.map(([n]) => n) };
}

const punkter = () => rod.querySelectorAll('[data-nav]:not([disabled])');

// ------------------------------------------------------------------ tests

test('pausemenuen har "Vis vejledningen igen" og "Alle taster" lige efter Fortsæt', () => {
  const { menu } = lavSpion();
  menu.vis('pause');
  assert.equal(menu.skaerm, 'pause');
  assert.equal(rod.classList.contains('hide'), false);
  const vejl = rod.querySelector('#pVejl'), taster = rod.querySelector('#pTaster');
  assert.ok(vejl, '#pVejl findes');
  assert.ok(taster, '#pTaster findes');
  assert.equal(vejl.textContent.trim(), 'Vis vejledningen igen');
  assert.equal(taster.textContent.trim(), 'Alle taster');
  // Rækkefølgen i menuNavs liste (skyderne er også data-nav, efter knapperne).
  const ids = punkter().map((p) => p.id).filter(Boolean);
  assert.deepEqual(ids, ['pFort', 'pVejl', 'pTaster', 'pOpt', 'pForlad']);
  assert.ok(vejl.attr.has('data-nav') && taster.attr.has('data-nav'), 'begge er data-nav');
  assert.equal(dokument.activeElement, rod.querySelector('#pFort'), 'Fortsæt har fokus fra start');
});

test('klik kalder visVejledning og visTaster', () => {
  const { menu, kald } = lavSpion();
  menu.vis('pause');
  rod.querySelector('#pVejl').click();
  assert.deepEqual(kald(), ['visVejledning']);
  menu.vis('pause');
  rod.querySelector('#pTaster').click();
  assert.deepEqual(kald(), ['visVejledning', 'visTaster']);
  menu.vis('pause');
  rod.querySelector('#pFort').click();
  assert.deepEqual(kald(), ['visVejledning', 'visTaster', 'fortsaet'], 'Fortsæt er uændret');
});

test('piletasterne når knapperne (menuNav), og Enter trykker dem', () => {
  const { menu, kald } = lavSpion();
  menu.vis('pause');
  assert.equal(tast('ArrowDown').forhindret, true);
  assert.equal(dokument.activeElement.id, 'pVejl');
  assert.ok(dokument.activeElement.classList.contains('nav-paa'));
  tast('Enter');
  assert.deepEqual(kald(), ['visVejledning']);
  menu.vis('pause');
  tast('ArrowDown'); tast('ArrowDown');
  assert.equal(dokument.activeElement.id, 'pTaster');
  tast('Enter');
  assert.deepEqual(kald(), ['visVejledning', 'visTaster']);
  // Og op igen fra Indstillinger.
  menu.vis('pause');
  tast('ArrowDown'); tast('ArrowDown'); tast('ArrowDown');
  assert.equal(dokument.activeElement.id, 'pOpt');
  tast('ArrowUp');
  assert.equal(dokument.activeElement.id, 'pTaster');
  // Esc er stadig Fortsæt.
  tast('Escape');
  assert.deepEqual(kald(), ['visVejledning', 'visTaster', 'fortsaet']);
});

test('det, vejledningen siger om pausemenuen, findes i pausemenuen', () => {
  const { menu } = lavSpion();
  menu.vis('pause');
  const knapper = punkter().map((p) => p.textContent.trim());
  // Oversigtens række og slutkortets fodnote peger begge derhen.
  const andet = new Map(GRUPPER.find(([n]) => n === 'Andet')[1]);
  assert.equal(andet.get('Pausemenuen'), 'Vis vejledningen igen');
  assert.ok(knapper.includes(andet.get('Pausemenuen')), 'oversigtens række har en knap');
  const slut = kortHTML({ kort: 'slut', nr: 5, antal: 5, pips: [], tekst: '', mangler: [], mellemrumErSpil: false });
  assert.match(slut, /Vejledningen kan vises igen fra pausemenuen/);
  assert.ok(knapper.includes('Vis vejledningen igen'), 'slutkortets fodnote har en knap');
  assert.ok(knapper.includes('Alle taster'));
});

/** Ét tastatur: to lokale spillere (som vejledning_input.mjs). */
const LOKALT = [
  { farve: 'roed', navn: 'A', spillere: ['p1'], baevere: [{ navn: 'Ingrid', udseende: null, ejer: 'p1' }] },
  { farve: 'blaa', navn: 'B', spillere: ['p2'], baevere: [{ navn: 'Bo', udseende: null, ejer: 'p2' }] },
];

test('hele vejen: Esc sprang over, og pausemenuens knap viser vejledningen igen', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  const synlig = () => !k.dom.boks.classList.contains('hide');
  const vj = () => k.log.afsendt.filter((c) => c.h === 'vejledning').map((c) => c.aktiv);
  assert.ok(bord.til(synlig));
  bord.tick(3);
  // Spilleren springer over med Esc: flaget gemmes.
  k.tryk('Escape'); k.slip('Escape');
  assert.equal(k.lager.get(NOEGLE), '1');
  assert.equal(synlig(), false);
  bord.tick(15);                                       // forbi pauseSlut-vagten
  // Esc igen er pausen; main.js viser den rigtige menu med sin egen api.
  k.tryk('Escape'); k.slip('Escape');
  assert.equal(k.S.pause, true);
  const menu = lavMenu(rod, k.m.api);
  menu.vis('pause');
  tast('ArrowDown');
  assert.equal(dokument.activeElement.id, 'pVejl');
  tast('Enter');
  assert.equal(k.S.pause, false, 'knappen lukker pausen');
  assert.deepEqual(vj(), [true, false, true], 'og uret venter igen (min tur)');
  bord.tick(2);
  assert.equal(synlig(), true, 'vejledningen er fremme igen');
  assert.match(k.dom.boks.innerHTML, /1\/5/);
  assert.equal(k.lager.get(NOEGLE), '1', 'flaget røres ikke');
  // "Alle taster": oversigten åbnes, og pausen lukkes.
  bord.tick(15);
  k.S.pause = true;
  menu.vis('pause');
  rod.querySelector('#pTaster').click();
  assert.equal(k.S.pause, false);
  assert.equal(k.hjaelp.oversigtErAaben, true);
});
