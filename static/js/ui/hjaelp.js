/* Kundekrigen — kontroloversigt og kontekstuel hjælp.
 *
 * Feedback fra playtest: "Jeg ved ikke, hvordan jeg hopper, skyder, sigter
 * eller vælger våben."
 *
 * Tre lag, i den rækkefølge en ny spiller møder dem:
 *   1. TASTEBJÆLKEN — altid synlig nederst, viser de fire handlinger man
 *      bruger hvert eneste sekund. Den fylder næsten intet og forsvinder ikke,
 *      for det er dét, man kigger efter, når man er i tvivl.
 *   2. FØRSTE TUR — en kort sekvens af bobler der peger på sigte, kraft og
 *      våbenvalg, mens man rent faktisk har turen. Vises kun én gang.
 *   3. OVERSIGTEN — hele tastaturet på ét skærmbillede, åbnes med ? eller F1
 *      og fra pausemenuen.
 */
'use strict';

import { esc } from './tekst.js';

const NOEGLE = 'baevere.hjaelpVist.v1';

/** De fire ting man bruger konstant. Vises permanent. */
const KERNE = [
  { taster: ['←', '→'], hvad: 'Gå' },
  { taster: ['↑', '↓'], hvad: 'Sigt' },
  { taster: ['MELLEMRUM'], hvad: 'Hold og slip = skyd', fremhaev: true },
  { taster: ['ENTER'], hvad: 'Hop' },
  { taster: ['1', '…', '+'], hvad: 'Vælg våben' },
  { taster: ['?'], hvad: 'Alle taster' },
];

/** Kameraet — vises i tastebjælken efter kernetasterne. */
const KAMERA = [
  { taster: ['W', 'A', 'S', 'D'], hvad: 'Panorér' },
  { taster: ['Z', 'X'], hvad: 'Zoom' },
  { taster: ['C'], hvad: 'Centrér' },
  { taster: ['H'], hvad: 'Overblik' },
];

/** Hele tastaturet, grupperet. */
const GRUPPER = [
  ['Bevægelse', [
    ['← →', 'Gå til venstre eller højre'],
    ['Enter', 'Hop fremad'],
    ['Backspace', 'Baglæns saltomortale'],
  ]],
  ['Sigte og skud', [
    ['↑ ↓', 'Hæv eller sænk sigtet'],
    ['Shift + ↑ ↓', 'Finsigte'],
    ['Mellemrum (hold)', 'Lad kraften op — slip for at affyre'],
    ['F / Shift+F', 'Lunte 1–5 sekunder på granater'],
    ['T / Shift+T', 'Spring sigtemarkøren til næste fjende'],
  ]],
  ['Våben', [
    ['1 2 3 … 0 + ´', 'Vælg våben 1–12 fra bjælken'],
    ['Tab', 'Åbn våbenpanelet (uret står stille)'],
    ['Q / E', 'Forrige eller næste våben i samme kategori'],
  ]],
  ['Kamera', [
    ['W A S D', 'Panorér frit'],
    ['C', 'Centrér på din kunde'],
    ['Z / X', 'Zoom ud eller ind'],
    ['H (hold)', 'Kig over hele banen'],
  ]],
  ['Visning', [
    ['Indstillinger', 'UI-størrelse: gør knapper og tekst større'],
    ['Ctrl/⌘ + / −', 'Browserens zoom — forstørrer hele brugerfladen'],
  ]],
  ['Andet', [
    ['K', 'Sæt på hold og afslut turen'],
    ['M', 'Lyd til/fra (knappen øverst til højre har skydere)'],
    ['Esc', 'Pause'],
    ['F3', 'Fejlfindingsoverlay'],
  ]],
];

/** Bobler på første tur. Vises i rækkefølge, én ad gangen. */
const FOERSTE_TUR = [
  { tekst: 'Det er din tur. Gå med ← og →.', ms: 4200, plads: 'midt' },
  { tekst: 'Sigt med ↑ og ↓ — sigtekornet viser retningen. Hop med Enter.', ms: 4600, plads: 'midt' },
  { tekst: 'Hold MELLEMRUM for at lade op. Jo længere, jo længere skyder du. Slip for at affyre.', ms: 6000, plads: 'midt' },
  { tekst: 'Skift våben med tasterne 1–9 nederst, eller åbn hele panelet med Tab.', ms: 5200, plads: 'bund' },
];

export function lavHjaelp(rod) {
  let boks = null;
  let koe = [];
  let timer = null;
  let oversigtAaben = false;

  rod.innerHTML = `
    <div class="tastebjaelke" id="hjTaster">
      ${KERNE.map((k) => `
        <span class="tb-punkt ${k.fremhaev ? 'frem' : ''}">
          ${k.taster.map((t) => `<kbd>${esc(t)}</kbd>`).join('')}
          <span class="tb-hvad">${esc(k.hvad)}</span>
        </span>`).join('')}
      <span class="tb-skille">Kamera</span>
      ${KAMERA.map((k) => `
        <span class="tb-punkt">
          ${k.taster.map((t) => `<kbd>${esc(t)}</kbd>`).join('')}
          <span class="tb-hvad">${esc(k.hvad)}</span>
        </span>`).join('')}
    </div>
    <div class="hjboble hide" id="hjBoble"></div>
    <div class="oversigt hide" id="hjOversigt">
      <div class="ov-kort">
        <h2>Sådan spiller du</h2>
        <p class="ov-intro">Spillet styres udelukkende på tastatur. Du behøver ikke musen.</p>
        <div class="ov-grupper">
          ${GRUPPER.map(([navn, raekker]) => `
            <section>
              <h3>${esc(navn)}</h3>
              <table>${raekker.map(([t, h]) =>
                `<tr><td class="ov-tast">${esc(t)}</td><td>${esc(h)}</td></tr>`).join('')}</table>
            </section>`).join('')}
        </div>
        <p class="ov-fod">Luk med <kbd>?</kbd> eller <kbd>Esc</kbd></p>
      </div>
    </div>`;

  boks = rod.querySelector('#hjBoble');
  const oversigt = rod.querySelector('#hjOversigt');

  function visBoble(tekst, ms, plads = 'midt') {
    boks.className = `hjboble ${plads}`;
    boks.innerHTML = `<span>${esc(tekst)}</span>`;
    clearTimeout(timer);
    timer = setTimeout(naeste, ms);
  }

  function naeste() {
    if (!koe.length) { boks.classList.add('hide'); return; }
    const n = koe.shift();
    visBoble(n.tekst, n.ms, n.plads);
  }

  return {
    /** Kaldes når spilleren får sin allerførste tur. Vises kun én gang. */
    foersteTur() {
      let vist = false;
      try { vist = localStorage.getItem(NOEGLE) === '1'; } catch { /* privat vindue */ }
      if (vist) return;
      try { localStorage.setItem(NOEGLE, '1'); } catch { /* ignoreres */ }
      koe = FOERSTE_TUR.slice();
      naeste();
    },

    /** Genvis introen (fra pausemenuen). */
    visIgen() { koe = FOERSTE_TUR.slice(); naeste(); },

    hint(tekst, ms = 3000) { koe = []; visBoble(tekst, ms); },

    skiftOversigt() {
      oversigtAaben = !oversigtAaben;
      oversigt.classList.toggle('hide', !oversigtAaben);
      return oversigtAaben;
    },
    lukOversigt() { oversigtAaben = false; oversigt.classList.add('hide'); },
    get oversigtErAaben() { return oversigtAaben; },

    saetSynlig(v) { rod.classList.toggle('hide', !v); },
    ryd() { clearTimeout(timer); koe = []; boks.classList.add('hide'); },
  };
}

export { GRUPPER };
