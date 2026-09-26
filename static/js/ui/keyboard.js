/* Kundekrigen — tastatur.
 *
 * Spillet skal kunne spilles UDELUKKENDE på tastatur, inklusive våbenvalg fra
 * et arsenal på femten. Kernen er favoritbjælken med ti pladser (1–0): ét
 * tastetryk er normaltilfældet, og resten ligger i arsenalskuffen (Tab).
 *
 * Tre mekaniske valg der betyder mere end de ser ud til:
 *
 *  1. Vi binder på e.code (FYSISK placering), ikke e.key. Ellers opfører et
 *     dansk layout sig anderledes end et engelsk.
 *  2. Vi ignorerer e.repeat helt og lader simulationen læse et `holdt`-sæt
 *     hvert tick. Bruger man tastegentagelse, bliver sigtehastigheden
 *     afhængig af den enkelte maskines indstillinger.
 *  3. Ved window.blur ryddes HELE holdt-sættet. Ellers går bæveren i vandet,
 *     mens man alt-tabber.
 */
'use strict';

import { K } from '../sim/commands.js';

export const STANDARD_BINDING = {
  venstre: ['ArrowLeft'],
  hoejre: ['ArrowRight'],
  sigtOp: ['ArrowUp'],
  sigtNed: ['ArrowDown'],
  lad: ['Space'],
  hop: ['Enter', 'NumpadEnter'],
  salto: ['Backspace'],
  fin: ['ShiftLeft', 'ShiftRight'],
  lunte: ['KeyF'],
  panel: ['Tab'],
  forrigeVaaben: ['KeyQ'],
  naesteVaaben: ['KeyE'],
  reb: ['KeyR'],
  naesteFjende: ['KeyT'],
  panVenstre: ['KeyA'],
  panHoejre: ['KeyD'],
  panOp: ['KeyW'],
  panNed: ['KeyS'],
  centrer: ['KeyC'],
  zoomUd: ['KeyZ'],
  zoomInd: ['KeyX'],
  kig: ['KeyH'],
  staaOver: ['KeyK'],
  lydFra: ['KeyM'],
  pause: ['Escape'],
  debug: ['F3'],
};

/* Ti pladser, talrækken 1–0. Minus og lighedstegn er droppet: de sidder
 * forskelligt på danske og engelske tastaturer, og ti er nok, når resten af
 * arsenalet er ét Tab væk. I arsenalet lægger Shift + tal et våben på pladsen. */
export const FAVORIT_TASTER = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
];
export const FAVORIT_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
export const ANTAL_FAVORITTER = FAVORIT_TASTER.length;

// Taster browseren ellers gør noget med.
const STOP = new Set(['Tab', 'Space', 'Backspace', 'ArrowUp', 'ArrowDown',
                      'ArrowLeft', 'ArrowRight', 'F3', 'Enter']);

export function lavTastatur(binding = STANDARD_BINDING) {
  const holdt = new Set();
  const lyttere = { tryk: [], slip: [] };
  let aktiv = true;
  let tekstfelt = false;

  const kodeTilHandling = new Map();
  for (const [handling, koder] of Object.entries(binding)) {
    for (const k of koder) kodeTilHandling.set(k, handling);
  }
  FAVORIT_TASTER.forEach((k, i) => kodeTilHandling.set(k, `favorit${i}`));

  function paaTryk(e) {
    if (!aktiv) return;
    // Mens et tekstfelt har fokus, er kun Escape og Enter globale.
    if (tekstfelt && e.code !== 'Escape' && e.code !== 'Enter') return;
    if (STOP.has(e.code)) e.preventDefault();
    if (e.repeat) return;                    // se punkt 2 i filhovedet
    holdt.add(e.code);
    const h = kodeTilHandling.get(e.code);
    for (const cb of lyttere.tryk) cb(h, e);
  }

  function paaSlip(e) {
    if (!aktiv) return;
    holdt.delete(e.code);
    const h = kodeTilHandling.get(e.code);
    for (const cb of lyttere.slip) cb(h, e);
  }

  function rydAlt() {
    const havde = [...holdt];
    holdt.clear();
    for (const k of havde) {
      const h = kodeTilHandling.get(k);
      for (const cb of lyttere.slip) cb(h, { code: k, syntetisk: true });
    }
  }

  window.addEventListener('keydown', paaTryk);
  window.addEventListener('keyup', paaSlip);
  window.addEventListener('blur', rydAlt);          // se punkt 3
  document.addEventListener('visibilitychange', () => { if (document.hidden) rydAlt(); });

  const nede = (handling) => (binding[handling] || []).some((k) => holdt.has(k));

  return {
    holdt,
    nede,
    erNede: (kode) => holdt.has(kode),
    paaTryk(cb) { lyttere.tryk.push(cb); },
    paaSlip(cb) { lyttere.slip.push(cb); },
    saetAktiv(v) { aktiv = v; if (!v) rydAlt(); },
    saetTekstfelt(v) { tekstfelt = v; if (v) rydAlt(); },
    rydAlt,

    /** Byg bitmasken simulationen læser. */
    bitmaske() {
      let b = 0;
      if (nede('venstre')) b |= K.VENSTRE;
      if (nede('hoejre')) b |= K.HOEJRE;
      if (nede('sigtOp')) b |= K.SIGT_OP;
      if (nede('sigtNed')) b |= K.SIGT_NED;
      if (nede('lad')) b |= K.LAD;
      if (nede('fin')) b |= K.FIN;
      return b;
    },

    binding,
    saetBinding(ny) {
      Object.assign(binding, ny);
      kodeTilHandling.clear();
      for (const [h, koder] of Object.entries(binding)) for (const k of koder) kodeTilHandling.set(k, h);
      FAVORIT_TASTER.forEach((k, i) => kodeTilHandling.set(k, `favorit${i}`));
    },

    fjern() {
      window.removeEventListener('keydown', paaTryk);
      window.removeEventListener('keyup', paaSlip);
      window.removeEventListener('blur', rydAlt);
    },
  };
}

/** Fælles menunavigation: piletaster, Enter, Esc, og bogstavspring. */
export function menuNav(el, opt = {}) {
  const punkter = () => [...el.querySelectorAll('[data-nav]:not([disabled])')];
  let i = 0;
  const marker = () => {
    const p = punkter();
    p.forEach((n, j) => n.classList.toggle('nav-paa', j === i));
    p[i]?.scrollIntoView({ block: 'nearest' });
    p[i]?.focus?.({ preventScroll: true });
  };
  const flyt = (d) => { const p = punkter(); if (!p.length) return; i = (i + d + p.length) % p.length; marker(); };

  function tast(e) {
    const p = punkter();
    if (!p.length) return;
    const kol = opt.kolonner || 1;
    switch (e.code) {
      case 'ArrowDown': e.preventDefault(); flyt(kol); break;
      case 'ArrowUp': e.preventDefault(); flyt(-kol); break;
      case 'ArrowRight': if (kol > 1) { e.preventDefault(); flyt(1); } break;
      case 'ArrowLeft': if (kol > 1) { e.preventDefault(); flyt(-1); } break;
      case 'Enter': case 'NumpadEnter':
        e.preventDefault(); p[i]?.click(); break;
      case 'Escape':
        if (opt.tilbage) { e.preventDefault(); opt.tilbage(); } break;
      default: {
        if (e.key && e.key.length === 1 && /\S/.test(e.key)) {
          const t = e.key.toLowerCase();
          const j = p.findIndex((n, idx) => idx > i && n.textContent.trim().toLowerCase().startsWith(t));
          const k = j >= 0 ? j : p.findIndex((n) => n.textContent.trim().toLowerCase().startsWith(t));
          if (k >= 0) { i = k; marker(); }
        }
      }
    }
  }

  el.addEventListener('keydown', tast);
  marker();
  return {
    marker,
    saetIndeks(n) { i = n; marker(); },
    fjern() { el.removeEventListener('keydown', tast); },
  };
}
