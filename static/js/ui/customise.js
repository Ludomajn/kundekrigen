/* Kundekrigen — profil, klinik og tilpasning af kunderne.
 *
 * Alt gemmes i localStorage. Hver læsning går gennem indlaesProfil(), som
 * try/catcher, tjekker version og migrerer. Slår noget fejl, returnerer den et
 * friskgenereret hold — så en helt ny browser er spilbar med det samme og uden
 * opsætning.
 */
'use strict';

import { standardUdseende, normaliserUdseende, tegnFigur, grafikKlar, indlaesGrafik, MAKS, VALG_NAVNE } from '../render/figur_view.js';
import { FAVORITTER, FAVORITTER_V1, VAABEN } from '../sim/weapons.js';
import { esc } from './tekst.js';
import { ANTAL_FAVORITTER } from './keyboard.js';
import { holdFarve } from '../render/palette.js';

const NOEGLE = 'baevere.profil.v1';
const SESSION = 'baevere.session.v1';
export const PROFIL_V = 1;

/* Kundernes navne: titler og ordspil fra klinikkens verden. */
export const NAVNEPULJE = [
  'Lægevikar Lars',
  'Anders Endetarm',
  'Hanne Lin',
  'Rita Lin',
  'Ib Uprofen',
  'Pia Cebo',
  'Anna Stesi',
  'Karen Tæne',
  'Per Forering',
  'Kaj Ropraktor',
  'Inge Fektion',
  'Ane Mia',
  'Bent Brud',
  'Gitte Gigt',
  'Mogens Migræne',
  'Egon Eksem',
  'Birgit Blodprop',
  'Otto Skop',
  'Dorthe Dryp',
  'Frode Fnat',
  'Viggo Vorte',
  'Sekretær Susse',
  'Klinik-Karen',
  'Sure Søren',
  'Overlæge Ole',
  'Praksis-Poul',
  'Tovholder Tine',
  'Reservelæge Bo',
];

/* Navnene fra før ordspillene. Står de stadig i en profil, er de ikke
 * valgt af spilleren, og de skiftes ud ved indlæsning. */
const GAMLE_STANDARDNAVNE = new Set(['Dr. Dorthe', 'Sekretær Lis', 'Klinikchef Kim', 'Dr. Hansen',
  'Sygepl. Sanne', 'Dr. Vibeke', 'Dr. Frost', 'Receptionist R', 'Dr. Mogensen', 'Bæver', 'Kunde']);

export function tilfaeldigtNavn(brugte = new Set()) {
  const frie = NAVNEPULJE.filter((n) => !brugte.has(n));
  const pulje = frie.length ? frie : NAVNEPULJE;
  return pulje[Math.floor(Math.random() * pulje.length)];
}

function nytHold(antal = 3) {
  const brugte = new Set();
  return Array.from({ length: antal }, () => {
    const navn = tilfaeldigtNavn(brugte);
    brugte.add(navn);
    return { navn, udseende: standardUdseende() };
  });
}

export function friskProfil() {
  return {
    v: PROFIL_V,
    spillernavn: '',
    baevere: nytHold(4),
    favoritter: FAVORITTER.slice(0, ANTAL_FAVORITTER),
    indstillinger: { lyd: 0.7, rystelser: true, sigteassistent: false },
  };
}

export function indlaesProfil() {
  try {
    const raa = localStorage.getItem(NOEGLE);
    // Gem det friske hold med det samme — ellers fik man nye navne ved
    // hver genindlæsning, indtil man selv ændrede noget.
    if (!raa) { const ny = friskProfil(); gemProfil(ny); return ny; }
    const p = JSON.parse(raa);
    if (!p || typeof p !== 'object') return friskProfil();
    if (p.v !== PROFIL_V) return migrer(p);
    if (!Array.isArray(p.baevere) || !p.baevere.length) p.baevere = nytHold(4);
    // Ældre udseender oversættes til en tegneseriekunde; navnene beholdes —
    // undtagen de gamle standardnavne, som bliver til de nye ordspil.
    const brugte = new Set(p.baevere.map((b) => b.navn));
    let omdoebt = false;
    for (const b of p.baevere) {
      b.udseende = normaliserUdseende(b.udseende);
      if (GAMLE_STANDARDNAVNE.has(b.navn) && !NAVNEPULJE.includes(b.navn)) {
        b.navn = tilfaeldigtNavn(brugte);
        brugte.add(b.navn);
        omdoebt = true;
      }
    }
    // Favoritbjælken rettes HER, i v1-stien: at hæve PROFIL_V ville sende
    // profilen gennem migrer() og smide kunderne og indstillingerne væk.
    const fav = normaliserFavoritter(p.favoritter);
    const favAendret = !Array.isArray(p.favoritter) || fav.length !== p.favoritter.length ||
                       fav.some((id, i) => id !== p.favoritter[i]);
    if (favAendret) p.favoritter = fav;
    if (omdoebt || favAendret) gemProfil(p);
    p.indstillinger = { ...friskProfil().indstillinger, ...(p.indstillinger || {}) };
    return p;
  } catch {
    return friskProfil();
  }
}

/**
 * Favoritbjælken har ti pladser (1–0). Ældre profiler har tolv, og nogle id'er
 * findes ikke længere (Serverracket). Reglerne:
 *
 *  - En uberørt gammel standardbjælke skiftes helt ud med den nye.
 *  - Ellers beholder spilleren sin rækkefølge — og pladserne 1–0 beholder
 *    deres våben, så tasterne sidder, hvor fingrene forventer dem. Ukendte
 *    id'er, meta-valg og dubletter bliver til huller.
 *  - Huller fyldes først med det, der lå på de gamle ekstrataster (+ og ´),
 *    derefter fra standardbjælken. Resten skæres væk.
 */
export function normaliserFavoritter(liste) {
  if (!Array.isArray(liste) || !liste.length) return FAVORITTER.slice(0, ANTAL_FAVORITTER);
  if (liste.length === FAVORITTER_V1.length && liste.every((id, i) => id === FAVORITTER_V1[i])) {
    return FAVORITTER.slice(0, ANTAL_FAVORITTER);
  }
  const gyldig = (id) => typeof id === 'string' && !!VAABEN[id] && VAABEN[id].kategori !== 'meta';
  const brugt = new Set();
  const ud = [];
  for (let i = 0; i < ANTAL_FAVORITTER; i++) {
    const id = liste[i];
    if (gyldig(id) && !brugt.has(id)) { ud.push(id); brugt.add(id); } else ud.push(null);
  }
  const reserve = [...liste.slice(ANTAL_FAVORITTER), ...FAVORITTER];
  for (let i = 0; i < ud.length; i++) {
    if (ud[i]) continue;
    const id = reserve.find((x) => gyldig(x) && !brugt.has(x));
    if (!id) break;
    ud[i] = id;
    brugt.add(id);
  }
  return ud;
}

function migrer(gammel) {
  const ny = friskProfil();
  if (typeof gammel.spillernavn === 'string') ny.spillernavn = gammel.spillernavn;
  return ny;
}

export function gemProfil(p) {
  try { localStorage.setItem(NOEGLE, JSON.stringify(p)); } catch { /* privat vindue */ }
}

export function gemSession(s) {
  try { sessionStorage.setItem(SESSION, JSON.stringify(s)); } catch { /* ignoreres */ }
}
export function hentSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION) || 'null'); } catch { return null; }
}

/* ------------------------------------------------------------- editor */

const FELTER = [
  // Holdfarven sidder i trøjen og følger klinikken — typen er frit valg.
  { n: 'figur', label: 'Kundetype', maks: MAKS.figur, navne: VALG_NAVNE.figur },
];

/** Kunde-editor. Tastaturnavigerbar: op/ned vælger felt, venstre/højre ændrer. */
export function lavEditor(rod, profil, holdIdx, vedAendring) {
  let valgtBaever = 0;
  let felt = 0;

  function tegn() {
    const b = profil.baevere[valgtBaever];
    rod.innerHTML = `
      <div class="ed-top">
        <div class="ed-baevere">
          ${profil.baevere.map((x, i) => `
            <button class="ed-fane ${i === valgtBaever ? 'paa' : ''}" data-b="${i}">${esc(x.navn)}</button>
          `).join('')}
          <button class="ed-fane ed-tilfoej" data-tilfoej="1" ${profil.baevere.length >= 6 ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <div class="ed-krop">
        <div class="ed-forhaand"><canvas id="edCanvas" width="128" height="128"></canvas></div>
        <div class="ed-felter">
          <label class="ed-navn">
            <span class="lbl">Navn</span>
            <input type="text" id="edNavn" maxlength="16" value="${esc(b.navn)}">
          </label>
          ${FELTER.map((f, i) => `
            <div class="ed-raekke ${i === felt ? 'paa' : ''}" data-felt="${i}">
              <span class="lbl">${f.label}</span>
              <button class="ed-pil" data-d="-1" data-f="${f.n}">‹</button>
              <span class="ed-vaerdi ${f.navne ? '' : 'num'}">${f.navne ? esc(f.navne[b.udseende[f.n] ?? 0]) : `${(b.udseende[f.n] ?? 0) + 1} / ${f.maks}`}</span>
              <button class="ed-pil" data-d="1" data-f="${f.n}">›</button>
            </div>`).join('')}
          <button class="btn" id="edTilfaeldig">Overrask mig</button>
        </div>
      </div>`;

    forhaandsvis();

    rod.querySelectorAll('[data-b]').forEach((n) => {
      n.onclick = () => { valgtBaever = +n.dataset.b; tegn(); };
    });
    const tilfoej = rod.querySelector('[data-tilfoej]');
    if (tilfoej) tilfoej.onclick = () => {
      if (profil.baevere.length >= 6) return;
      const brugte = new Set(profil.baevere.map((x) => x.navn));
      profil.baevere.push({ navn: tilfaeldigtNavn(brugte), udseende: standardUdseende() });
      valgtBaever = profil.baevere.length - 1;
      gemOgTegn();
    };
    rod.querySelectorAll('.ed-pil').forEach((n) => {
      n.onclick = () => aendr(n.dataset.f, +n.dataset.d);
    });
    rod.querySelector('#edTilfaeldig').onclick = () => {
      profil.baevere[valgtBaever].udseende = standardUdseende();
      gemOgTegn();
    };
    const navn = rod.querySelector('#edNavn');
    navn.oninput = () => {
      profil.baevere[valgtBaever].navn = navn.value.slice(0, 16) || tilfaeldigtNavn();
      gemProfil(profil); vedAendring?.(profil);
    };
    navn.onfocus = () => rod.dispatchEvent(new CustomEvent('tekstfelt', { detail: true, bubbles: true }));
    navn.onblur = () => rod.dispatchEvent(new CustomEvent('tekstfelt', { detail: false, bubbles: true }));
    rod.querySelectorAll('[data-felt]').forEach((n) => {
      n.onclick = () => { felt = +n.dataset.felt; tegn(); };
    });
  }

  function aendr(navn, d) {
    const f = FELTER.find((x) => x.n === navn);
    const b = profil.baevere[valgtBaever];
    b.udseende[navn] = (((b.udseende[navn] ?? 0) + d) % f.maks + f.maks) % f.maks;
    gemOgTegn();
  }

  function gemOgTegn() { gemProfil(profil); tegn(); vedAendring?.(profil); }

  /** Forhåndsvisning: figuren samles af de indlæste dele. */
  function forhaandsvis() {
    const c = rod.querySelector('#edCanvas');
    if (!c) return;
    const b = profil.baevere[valgtBaever];
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    const tegn = () => tegnFigur(g, holdIdx, b.udseende, 64, 120, 110);
    if (!grafikKlar()) {
      // Første visning kan komme før grafikken: hent den, og tegn så.
      indlaesGrafik().then(() => { if (rod.querySelector('#edCanvas') === c) tegn(); });
      return;
    }
    tegn();
  }

  function tast(e) {
    const b = profil.baevere[valgtBaever];
    switch (e.code) {
      case 'ArrowDown': felt = (felt + 1) % FELTER.length; tegn(); return true;
      case 'ArrowUp': felt = (felt - 1 + FELTER.length) % FELTER.length; tegn(); return true;
      case 'ArrowLeft': aendr(FELTER[felt].n, -1); return true;
      case 'ArrowRight': aendr(FELTER[felt].n, 1); return true;
      case 'PageDown': valgtBaever = (valgtBaever + 1) % profil.baevere.length; tegn(); return true;
      case 'PageUp': valgtBaever = (valgtBaever - 1 + profil.baevere.length) % profil.baevere.length; tegn(); return true;
    }
    return false;
  }

  tegn();
  return { tegn, tast, get valgt() { return valgtBaever; } };
}
