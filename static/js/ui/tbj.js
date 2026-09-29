/* Kundekrigen — tålmodighedsbjælken (WoW-stil): navn og tal INDE i en bjælke i
 * holdets farve, fyldt efter procent. Samme komponent tre steder: skiltet over
 * kunden, den aktive kunde øverst og holdlisten (docs/udkast/hp_design.md).
 *
 * Lagene er fuld bredde og skubbes med translateX (ingen layout, og
 * fyldets mørke højrekant forbliver skarp): tab (det lige tabte, rødt; løber
 * ned med tallet), fyld (resten), smitte (næste COVID-tik) og over (piller
 * over 100). Rammen og teksturen er art directorens (static/grafik/hud/);
 * mangler filerne, står CSS-udgaven (app.css, "tålmodighedsbjælken").
 *
 * Ingen DOM ved import og intet three.js: de rene funktioner øverst testes i
 * node (test/hp_bjaelke.mjs). */
'use strict';

import { MAKS_HP } from '../sim/entities.js';
import { SMITTE_SKADE } from '../sim/damage.js';
import { PERSONALE } from '../core/klinikker.js';
import { esc } from './tekst.js';

export const LAV_HP = 25;          // én middel træffer fra at lægge på
export const TAB_HOLD_MS = 280;    // fyldet falder straks; det tabte og tallet venter et øjeblik

// (hp · 100) / MAKS_HP og ikke (hp / MAKS_HP) · 100: så er hele point hele
// procenter (7 / 100 · 100 er 7,000000000000001).
export const pct = (hp) => (hp <= 0 ? 0 : hp >= MAKS_HP ? 100 : (hp * 100) / MAKS_HP);
export const overPct = (hp) => pct(hp - MAKS_HP);                 // 150 = halv strimmel
/** Smittelaget er SMITTE_SKADE bredt; dets højrekant står ved fyldet. I % af
 *  lagets egen bredde (det er translateX's enhed). */
export const smitteX = (fyld) => ((Math.min(fyld, MAKS_HP) - SMITTE_SKADE) / SMITTE_SKADE) * 100;

/* Romertallet (core/roster.js ROMER, " 9" og op) må aldrig klippes væk. */
const NR = / (?:[IVX]+|\d+)$/;
export function delNavn(navn) {
  const s = String(navn ?? ''), m = NR.exec(s);
  return m ? [s.slice(0, m.index), m[0]] : [s, ''];
}
/* Skiltets og holdlistens navn: personalets kaldenavn + romertallet. Egne
 * navne står, som de er. Kun til visning; over nettet rejser kun navn. */
const KALDENAVN = new Map(Object.values(PERSONALE).flat().filter((p) => p.kort).map((p) => [p.navn, p.kort]));
export function kortNavn(navn) {
  const [stamme, nr] = delNavn(navn);
  const k = KALDENAVN.get(stamme);
  return k ? k + nr : String(navn ?? '');
}

/** Nedtællingen (main.js taelSkade): samme sluttid som før, men holdet først. */
export function skadeForloeb(fra, til, nu) {
  const ialt = Math.min(2200, 900 + (fra - til) * 18);
  return { fra, til, start: nu + TAB_HOLD_MS, varighed: Math.max(400, ialt - TAB_HOLD_MS) };
}
/** 0 i holdet (ellers skyder tallet OVER fra), 1 ved slut. */
export const skadeK = (t, nu) => Math.max(0, Math.min(1, (nu - t.start) / t.varighed));

/* ---- DOM */
const hex = (n) => '#' + n.toString(16).padStart(6, '0');         // = palette.hexStr, uden three
// Hele procenter (tålmodighed er heltal) har færdige strenge: nedtællingen
// skriver et nyt transform hver frame uden at bygge en streng.
const FLYT = Array.from({ length: 101 }, (_, p) => 'translateX(' + (p - 100) + '%)');
const flyt = (p) => (p === (p | 0) && p >= 0 && p <= 100 ? FLYT[p] : 'translateX(' + (Math.round(p * 100) / 100 - 100) + '%)');
const SMITTE_B = (SMITTE_SKADE / MAKS_HP) * 100;

/** f: holdFarve(...) ({ css, kant }). Lagenes rækkefølge er fast (tbjRefs). */
export function tbjHTML(f, navn, klasse = '') {
  const [stamme, nr] = delNavn(navn);
  return `<div class="tbj${klasse ? ' ' + klasse : ''}" style="--hf:${f.css};--hk:${hex(f.kant)}">` +
    `<i class="tbj-tab"></i><i class="tbj-fyld"></i>` +
    `<i class="tbj-smitte" style="width:${SMITTE_B}%"></i><i class="tbj-over"></i>` +
    `<span class="tbj-navn"><span class="tbj-stamme">${esc(stamme)}</span>` +
    (nr ? `<span class="tbj-nr">${esc(nr)}</span>` : '') + `</span><span class="tbj-tal num"></span></div>`;
}
/** Lagene i fast rækkefølge. De sidst skrevne værdier caches (NaN: intet endnu). */
export function tbjRefs(el) {
  const c = el.children;
  return {
    el, tab: c[0], fyld: c[1], smitte: c[2], over: c[3], tal: c[5],
    v: NaN, f: NaN, s: NaN, pt: NaN, pf: NaN, po: NaN, ps: NaN, lav: false, overs: false, ramt: false,
  };
}
/** vist = tallet (tæller ned), fyld = resten (<= vist; 0 for en død), smitte =
 *  vis næste COVID-tik. Skriver KUN ved ændring: et kald pr. frame koster intet
 *  i ro, og under nedtællingen kun tallet og det tabte. */
export function saetTbj(t, vist, fyld, smitte) {
  vist = vist > 0 ? vist : 0;
  fyld = fyld > 0 ? (fyld < vist ? fyld : vist) : 0;
  if (vist !== t.v) {
    t.v = vist;
    t.tal.textContent = vist;
    const p = pct(vist), o = overPct(vist);
    if (p !== t.pt) { t.pt = p; t.tab.style.transform = flyt(p); }
    if (o !== t.po) { t.po = o; t.over.style.transform = flyt(o); }
    const lav = vist > 0 && vist <= LAV_HP, over = vist > MAKS_HP;
    if (lav !== t.lav) { t.lav = lav; t.el.classList.toggle('lav', lav); }
    if (over !== t.overs) { t.overs = over; t.el.classList.toggle('over', over); }
  }
  if (fyld !== t.f) {
    t.f = fyld;
    const p = pct(fyld);
    if (p !== t.pf) { t.pf = p; t.fyld.style.transform = flyt(p); }
  }
  // Over 100 er fyldet fuldt, og det næste tik tager af overskuddet.
  const s = smitte && fyld <= MAKS_HP ? smitteX(fyld) : -200;
  if (s !== t.ps) { t.ps = s; t.smitte.style.transform = 'translateX(' + Math.round(s * 100) / 100 + '%)'; }
}
/** Rød kant, mens tallet tæller ned (holdlisten og den aktive øverst). */
export function saetTbjRamt(t, ramt) {
  if (ramt !== t.ramt) { t.ramt = ramt; t.el.classList.toggle('ramt', ramt); }
}

/* ---- Art directorens ramme og tekstur. CSS-udgaven står, indtil begge er
 * hentet; så slår klassen .tbj-grafik på roden kunsten til. Mangler en fil,
 * bliver det ved CSS-udgaven (ingen halv, gennemsigtig ramme). */
export const TBJ_GRAFIK = ['/grafik/hud/tbj_ramme.svg', '/grafik/hud/tbj_tekstur.png'];
let grafikHentet = false;
export function hentTbjGrafik(rod = globalThis.document?.documentElement) {
  if (grafikHentet || !rod || typeof Image !== 'function') return;
  grafikHentet = true;
  let mangler = TBJ_GRAFIK.length;
  for (const src of TBJ_GRAFIK) {
    const img = new Image();
    img.onload = () => { if (--mangler === 0) rod.classList.add('tbj-grafik'); };
    img.onerror = () => { mangler = -1; };
    img.src = src;
  }
}
