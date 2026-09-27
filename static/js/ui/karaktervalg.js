/* Kundekrigen — karaktervalget: opsætningen før kampen i Tekken-stil.
 *
 * Fire trin i en trinbjælke øverst: Karakterer · Bane · Regler · Klar
 * (docs/karaktervalg.md). Én figur pr. spiller: man vælger SIN fighter og
 * SIT hold, blåt (venstre) eller rødt (højre). Begge holds fightere står
 * stort på hver sin side, som i Tekken og Street Fighter: den forreste i
 * bevægelse med et navneskilt, holdkammeraterne bag ham. Holdpanelerne
 * viser holdenes spillere, og rosteret står i midten med holdvalget over
 * sig og Tilfældig ("?") i midten af rækken.
 *
 * Trinnet og markøren er UI-tilstand; valg, hold, stemmer og regler er
 * fælles og kommer med lobbybeskeden. Over nettet går hver spiller selv
 * gennem trinnene. Ved ét tastatur vælger de lokale spillere efter tur: den
 * første, der ikke er klar, handler; trykker han Klar, starter den næste på
 * Karakterer. Når alle er klar, tæller rummet selv 3-2-1 ned, og skærmen
 * viser nedtællingen og den trukne bane oven på det hele.
 *
 * Skærmen bygges ÉN gang. Hver lobbybesked opdaterer kun de dele, der viser
 * fælles tilstand, og en del skrives kun om, når dens HTML faktisk er
 * ændret (saetHtml). Så overlever markør, trin og fokus, musen står stille
 * på sit felt, og portrætter og klip hentes kun én gang pr. figur.
 *
 * ARBEJDSDELING (som filmintroen): denne fil bygger DOM'en med faste
 * klassenavne og data-attributter og skifter dem. Alt udseende ligger i
 * static/karaktervalg.css, som art directoren ejer (se "DOM og CSS" i
 * docs/karaktervalg.md).
 *
 * TASTATURET: tasterne kommer fra main.js (menu.tast), og tastaturet
 * forhindrer browserens egen Tab og Enter. Markøren er derfor vores egen og
 * står i en af zonerne top (link, trin, lokale spillere), hold (blåt/rødt),
 * gitter (trinnets indhold) og fod (Tilbage, Indstillinger, Forlad, Næste).
 * ↑↓ i kanten af en zone og Tab går til den næste, og markøren tager
 * DOM-fokus med, så :focus-visible står, hvor den er. I holdvalget skifter
 * ←→ hold, og markøren bliver; Enter og ↓ går videre. Mus og taster går
 * gennem samme udfoer(). Tastetrykket, der åbnede skærmen, når også hertil
 * og ignoreres (skabt i lavKaraktervalg).
 */
'use strict';

import { T, esc, BANE_NAVN, VEJR_NAVN } from './tekst.js';
import { HOLD, HOLD_ORDEN } from '../render/palette.js';
import { ROSTER, rosterFigur, rosterUdseende, BANE_VALG } from '../core/roster.js';
import { VEJRTYPER } from '../sim/turn.js';
import { hentFilmData } from './filmintro.js';
import { indlaesGrafik, tegnFigur } from '../render/figur_view.js';
import * as lyd from './lyd.js';
import { karakterLyd } from './stemmer.js';

const TRIN = ['karakterer', 'bane', 'regler', 'klar'];
const MAPPE = '/grafik/intro/';
const MAKS_LOKALE = 8;

/* Rosterets felter: de seks ansatte med Tilfældig i midten (mellem figur 18
 * og 19), som "?" i et fightingspil. Felterne står i DOM'en i denne
 * rækkefølge, og ←→ går gennem den, så det, man ser, og tasterne passer. */
const feltAf = (r) => ({ figur: r.figur, navn: r.navn, rolle: r.rolle, klinik: r.klinik, aaben: r.aaben });
const MIDTEN = Math.ceil(ROSTER.length / 2);
const FELTER = [
  ...ROSTER.slice(0, MIDTEN).map(feltAf),
  { figur: 'tilfaeldig', navn: T.kv.tilfaeldig, rolle: T.kv.tilfaeldigRolle, klinik: null, aaben: true },
  ...ROSTER.slice(MIDTEN).map(feltAf),
];
const feltIndeks = (figur) => FELTER.findIndex((f) => f.figur === figur);

/* Reglerne, værten kan sætte. Samme semantik som den gamle lobbys raekke():
 * knapperne bærer data-indst og data-v, og api.indstilling får strengen. */
const REGLER = [
  { navn: 'turtid', label: T.lobby.turtid, valg: [15, 20, 30, 45, 60], vaerdi: (t) => t.indst.turtid,
    fmt: (v) => `${v} s` },
  { navn: 'kamptid', label: T.lobby.kamptid, valg: [600, 1200, 1800, 2700], vaerdi: (t) => t.indst.kamptid,
    fmt: (v) => `${v / 60} min` },
  { navn: 'vejr', label: T.lobby.vejr, valg: ['auto', ...VEJRTYPER], vaerdi: (t) => t.indst.vejr || 'auto',
    fmt: (v) => VEJR_NAVN[v] || v },
  { navn: 'vind', label: T.lobby.vind, valg: [0, 1], vaerdi: (t) => (t.indst.vind ? 1 : 0),
    fmt: (v) => (v ? T.kv.til : T.kv.fra) },
];
const RUL = REGLER.length;               // rækken efter reglerne: 🎲 Tilfældige regler

const baneNavn = (b) => (b === 'tilfaeldig' ? T.kv.tilfaeldig : BANE_NAVN[b] || b);
const figurNavn = (f) => (f === 'tilfaeldig' ? T.kv.tilfaeldig : typeof f === 'number' ? rosterFigur(f)?.navn || '' : '');
const reduceret = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const PILE = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const OK = new Set(['Enter', 'NumpadEnter', 'Space']);

/** En plads' valg: rummets, eller deltagerens, hvis pladsen ikke har det. */
const pladsValg = (b, d) => (b && b.valg !== undefined ? b.valg : d?.valg ?? null);

/** "Thomas Emil Sørensen" -> "TS", "Bo" -> "BO". */
function initialer(navn) {
  const ord = String(navn || '?').trim().split(/\s+/).filter(Boolean);
  const s = ord.length > 1 ? ord[0][0] + ord[ord.length - 1][0] : (ord[0] || '?').slice(0, 2);
  return s.toUpperCase();
}

/* ============================================================ ADAPTER
 *
 * HVEM HANDLER, og hvad han vælger til. Resten af skærmen spørger kun
 * vaelgerTil(t) og sender handlinger med dens som. Skifter modellen, rettes
 * kun denne blok.
 *
 * Over nettet handler jeg selv (t.dig). Ved ét tastatur (t.kode == null)
 * handler den første lokale spiller, der ikke er klar; er alle klar, den
 * sidste, så Esc og Ikke klar under nedtællingen tager ham ud igen.
 */

const lokale = (t) => t.deltagere.filter((d) => d.lokal);

/** Aktøren: deltageren, der sidder ved skærmen nu. */
export function aktoer(t) {
  if (t.kode == null) {
    const l = lokale(t);
    if (l.length) return l.find((d) => !d.klar) || l[l.length - 1];
  }
  return t.deltagere.find((d) => d.pid === t.dig) || null;
}

/**
 * Det, aktøren vælger til: { pid, navn, hold, valg, stemme, klar, plads,
 * som, lokalNr }. plads er hans plads i hold[].baevere (med fighterens navn
 * og romertal), som er det, api'et skal have med (kun lokalt), og lokalNr
 * hans nummer blandt de lokale spillere (-1 over nettet).
 */
export function vaelgerTil(t) {
  const a = aktoer(t);
  if (!a) return null;
  const hold = a.hold === 0 || a.hold === 1 ? a.hold : null;
  const plads = hold != null ? t.hold[hold]?.baevere.find((b) => b.ejer === a.pid) || null : null;
  return {
    pid: a.pid, navn: a.navn, hold, valg: a.valg ?? null, stemme: a.stemme ?? null, klar: !!a.klar, plads,
    som: t.kode == null ? a.pid : undefined,
    lokalNr: t.kode == null ? lokale(t).indexOf(a) : -1,
  };
}

/** Værten: over nettet rummets vært; ved ét tastatur spiller 1. */
const vaertPid = (t) => (t.kode == null ? lokale(t)[0]?.pid ?? t.vaert : t.vaert);

/* To hold: blåt (0) til venstre, rødt (1) til højre. Farven er holdets id i
 * beskeden (HOLD_ORDEN i core/klinikker.js); kort er "Blåt hold", navn klinikken. */
const SIDE = { blaa: 'venstre', roed: 'hoejre' };
function holdVisning(t) {
  return t.hold.map((h, hi) => {
    const farve = HOLD[h.farve] ? h.farve : HOLD_ORDEN[hi % HOLD_ORDEN.length];
    const p = HOLD[farve];
    return { hi, farve, side: SIDE[farve] || (hi % 2 ? 'hoejre' : 'venstre'),
             css: p.css, tekst: p.tekst, navn: h.navn || p.navn, kort: T.kv.holdFarve[farve] || p.navn };
  });
}
const farveStil = (v) => (v ? `--klinik-farve:${v.css};--klinik-tekst:${v.tekst}` : '');

/* ------------------------------------------------------------ portrætter
 *
 * De små portrætter (felter, spillere, opsummering): art directorens portræt
 * fra intro.json (960×1120, fødderne på underkanten), ellers kunden tegnet fra
 * figurarket — ligesom filmintroens pladsholdere. Begge ender som en URL, så
 * alle steder kan bruge et <img>, og cachen lever på tværs af skærme. */

let filmData = null;                    // intro.json, når den er hentet
const portraetUrl = new Map();          // figur -> URL
const portraetHent = new Map();         // figur -> Promise<URL|null>
const billeder = [];                    // holder de afkodede billeder i live

function hentBillede(src) {
  return new Promise((res) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { billeder.push(img); res(src); };
    img.onerror = () => res(null);
    img.src = src;
  });
}

async function tegnPladsholder(figur) {
  await indlaesGrafik();
  const c = document.createElement('canvas');
  c.width = 480; c.height = 560;
  const g = c.getContext('2d');
  if (!tegnFigur(g, 0, { v: 5, figur, fast: true }, c.width / 2, c.height - 16, c.height * 0.92, 1, 'idle_0')) return null;
  return new Promise((res) => c.toBlob((b) => res(b ? URL.createObjectURL(b) : null), 'image/png'));
}

function hentPortraet(figur) {
  if (!portraetHent.has(figur)) {
    portraetHent.set(figur, hentFilmData()
      .then((d) => { filmData = d || {}; return d?.figurer?.[figur]?.portraet; })
      .then((fil) => (fil ? hentBillede(MAPPE + fil) : null))
      .then((url) => url || tegnPladsholder(figur))
      .then((url) => { if (url) portraetUrl.set(figur, url); return url; })
      .catch(() => null));
  }
  return portraetHent.get(figur);
}

/** Et lille portræt som HTML: billede, "?" for Tilfældig, eller en tom ramme. */
function portraet(figur, klasse) {
  if (figur === 'tilfaeldig') return `<span class="${klasse}-tegn" aria-hidden="true">?</span>`;
  const url = figur == null ? null : portraetUrl.get(figur);
  if (!url) return `<span class="${klasse}-tom" aria-hidden="true"></span>`;
  return `<img class="${klasse}-billede" src="${esc(url)}" alt="" draggable="false">`;
}

/* ------------------------------------------------------------ fighterne
 *
 * En stor figur: fighteren i bevægelse og et navneskilt. Tre kilder, i
 * denne rækkefølge (intro.json → figurer[figur]):
 *   1. valg_video (+ valg_video_safari) — et gennemsigtigt loop: <video muted loop>
 *   2. portraet   — billedet med et CSS-åndedræt (.kv-aande)
 *   3. figurarket — spillets egne tomgangsframes idle_0-3, ca. 4 pr. sekund
 * Kun holdets forreste fighter (data-nr 0) får loopet; de bagved starter
 * ved portrættet. Mediet skiftes kun, når figuren (eller kilden) skifter.
 * Et klip, der ikke kan spilles, og et portræt, der ikke kan hentes, falder
 * videre ned. */

/* Klippene genbruges på tværs af skærme: ét <video> pr. figur, og et ekstra,
 * når samme figur står forrest på begge hold (spejlkamp) — et element kan
 * kun stå ét sted i DOM'en. iBrug er dem, en fighter viser lige nu. */
const videoer = new Map();              // figur -> [<video>, …]
const iBrug = new Set();
const videoFejl = new Set();
const portraetFejl = new Set();
let vedVideoFejl = null;                // skærmens planlaeg, så en fejl tegnes om

/*
 * Klippene er gennemsigtige i to udgaver: HEVC med alfa (.mov) til Safari og
 * VP9 med alfa (.webm) til resten. Browseren tager den første <source>, den
 * kan spille. WebKit (Safari og alle browsere på iOS) kan spille WebM, men
 * uden alfa — sort baggrund — så dér står HEVC først. Andre browsere får
 * WebM først: Chrome på Mac kan afkode HEVC, men ikke med sikkerhed dens alfa.
 */
const WEBKIT = typeof navigator !== 'undefined' && /Apple/.test(navigator.vendor || '');

/** Et ledigt klip til figuren; findes der ikke et, laves et nyt. */
function videoTil(figur) {
  const liste = videoer.get(figur) || [];
  return liste.find((v) => !iBrug.has(v)) || lavVideo(figur);
}

function lavVideo(figur) {
  const d = filmData?.figurer?.[figur] || {};
  const v = document.createElement('video');
  v.className = 'kv-fighter-video';
  v.muted = true; v.loop = true; v.playsInline = true;
  for (const a of ['muted', 'loop', 'playsinline']) v.setAttribute(a, '');
  v.disablePictureInPicture = true;
  v.preload = 'auto';
  const kilder = [
    d.valg_video_safari && { src: MAPPE + d.valg_video_safari, type: 'video/mp4; codecs="hvc1"' },
    d.valg_video && { src: MAPPE + d.valg_video, type: 'video/webm' },
  ].filter(Boolean);
  if (!WEBKIT) kilder.reverse();
  for (const k of kilder) {
    const s = document.createElement('source');
    s.src = k.src; s.type = k.type;
    v.appendChild(s);
  }
  // Fejler den sidste kilde, kan klippet ikke spilles: videre til portrættet.
  v.lastElementChild?.addEventListener('error', () => { videoFejl.add(figur); vedVideoFejl?.(); });
  if (!videoer.has(figur)) videoer.set(figur, []);
  videoer.get(figur).push(v);
  return v;
}

/** De åbne karakterers loops hentes i forvejen, så markøren skifter uden
 *  ventetid. Kun klip, der laves her, får load(): et genbrugt klip med
 *  autoplay ville ellers starte igen, også uden for dokumentet. */
function forvarmKlip() {
  for (const r of ROSTER) {
    const d = filmData?.figurer?.[r.figur];
    if (r.aaben && (d?.valg_video || d?.valg_video_safari) && !videoer.has(r.figur)) lavVideo(r.figur).load();
  }
}

/** Alle klip holder op, når skærmen forlades (kampstart, Indstillinger, menuen). */
function stopAlleKlip() {
  for (const liste of videoer.values()) for (const v of liste) { v.autoplay = false; v.pause(); }
  iBrug.clear();
}

/** Kilden til figur; medVideo: false (holdkammeraterne bagved) springer loopet over. */
function kildeFor(figur, medVideo = true) {
  if (figur == null) return 'tom';
  if (figur === 'tilfaeldig') return 'tilfaeldig';
  if (!filmData) return 'venter';
  const d = filmData.figurer?.[figur] || {};
  if (medVideo && (d.valg_video || d.valg_video_safari) && !videoFejl.has(figur)) return 'video';
  if (d.portraet && !portraetFejl.has(figur)) return 'portraet';
  return 'figur';
}

function lavFighter(n, planlaeg) {
  const scene = n.querySelector('.kv-fighter-scene');
  let noegle = null;                    // "kilde:figur" for mediet, der står nu
  let video = null, timer = 0;

  function stop() {
    clearInterval(timer); timer = 0;
    if (video) {
      video.autoplay = false;           // ellers starter det igen ved næste load()
      video.pause();
      iBrug.delete(video);
      video = null;
    }
  }

  function medie(kilde, figur, hi) {
    if (kilde === 'tilfaeldig') {
      const s = document.createElement('span');
      s.className = 'kv-fighter-tegn';
      s.textContent = '?';
      return s;
    }
    if (kilde === 'video') {
      const v = videoTil(figur);
      iBrug.add(v);
      // Uden bevægelse står klippet stille på første billede.
      v.autoplay = !reduceret();
      video = v;
      return v;
    }
    if (kilde === 'portraet') {
      const img = document.createElement('img');
      img.className = 'kv-fighter-billede kv-aande';
      img.alt = ''; img.draggable = false; img.decoding = 'async';
      img.onerror = () => { portraetFejl.add(figur); planlaeg(); };
      img.src = MAPPE + filmData.figurer[figur].portraet;
      return img;
    }
    if (kilde === 'figur') {
      const c = document.createElement('canvas');
      c.className = 'kv-fighter-figur';
      c.width = 366; c.height = 420;
      const g = c.getContext('2d');
      let i = 0;
      const tegnFrame = () => {
        g.clearRect(0, 0, c.width, c.height);
        tegnFigur(g, hi, { v: 5, figur, fast: true }, c.width / 2, c.height - 8, c.height * 0.9, 1, `idle_${i++ % 4}`);
      };
      indlaesGrafik().then(() => {
        if (scene.firstChild !== c) return;            // skiftet imens
        tegnFrame();
        if (!reduceret()) timer = setInterval(tegnFrame, 250);
      });
      return c;
    }
    return null;                                       // tom eller venter på intro.json
  }

  return {
    /** Vis figur (tal, 'tilfaeldig' eller null) for hold hi (0, 1 eller null);
     *  medVideo: false giver portrættet i stedet for loopet. */
    vis(figur, hi, medVideo = true) {
      const kilde = kildeFor(figur, medVideo);
      const ny = `${kilde}:${figur}`;
      if (ny === noegle) return;
      stop();
      noegle = ny;
      const m = medie(kilde, figur, hi ?? 0);
      scene.replaceChildren(...(m ? [m] : []));
      n.dataset.kilde = kilde;
      // Først når klippet står i dokumentet (en skjult fane starter det, når den vises).
      if (video && !reduceret()) video.play().catch(() => {});
    },
    /** Klippet hviler, mens Karakterer-trinnet ikke vises. */
    aktiv(ja) {
      if (!video || reduceret()) return;
      if (!ja) video.pause();
      else if (video.paused) video.play().catch(() => {});
    },
    fjern() { stop(); scene.replaceChildren(); noegle = null; },
  };
}

/* ------------------------------------------------------------ skærmen */

/**
 * Byg karaktervalget i rod. api er menuens api (main.js); opt.indstillinger
 * åbner profilens indstillinger, og opt.gemt er UI-tilstanden fra gem(), når
 * spilleren kommer tilbage fra dem. opt.trin ('klar' ved Spil igen) er
 * trinnet, skærmen åbner på.
 */
export function lavKaraktervalg(rod, api, opt = {}) {
  // Tasten, der åbnede skærmen (Enter på Lokalt spil eller Spil igen, Enter
  // eller Esc i Indstillinger), når også frem til tast(): menuNav stopper den
  // ikke. Den er ældre end skærmen og ignoreres (se tast()).
  const skabt = performance.now();
  const ui = {
    kode: undefined,
    aktoer: undefined,       // pid'en, UI-tilstanden hører til (skifter ved ét tastatur)
    trin: 0,
    zone: 'gitter',          // hvor markøren står: top | hold | gitter | fod
    top: 0,                  // indeks i toplinjen (bruges, når knappen i topNoegle er væk)
    topNoegle: null,         // toplinjens knap efter det, den gør (se topNoegle())
    fod: 'naeste',           // fodlinjens knap (data-handling)
    markoer: Math.max(0, FELTER.findIndex((f) => f.aaben)),
    bane: 0,
    regel: 0,
    tastatur: false,         // sidste handling kom fra tastaturet (så følger fokus og rul med)
  };
  let gemt = opt.gemt || null;
  let t = null;
  let m = null;              // vaelgerTil(t)
  let hv = [];               // holdVisning(t)
  let besked = null;         // { tekst, til, advarsel } — fejl og afvisninger i statuslinjen
  let beskedTimer = 0, kopiTimer = 0, rouletteTimer = 0, raf = 0, planlagt = 0;
  let frist = null, visTal = 0, trukket;
  let reglerNoegle = '';
  // Spil igen: nye aktører ved ét tastatur starter på dette trin, til nogen
  // trykker eller klikker (-1: Karakterer som ellers).
  let omkamp = TRIN.indexOf(opt.trin);
  /* Mine valg, som rummet ikke har bekræftet endnu: { pid, til, valg?, hold?,
   * stemme? }. Over nettet går der et øjeblik, før lobbybeskeden viser dem;
   * så længe viser skærmen dem, som om de var bekræftet. */
  let ventende = null, ventTimer = 0;
  const sidst = new WeakMap();

  const kv = document.createElement('div');
  kv.className = 'kv';
  kv.innerHTML = `
    <header class="kv-top">
      <div class="kv-rum"></div>
      <nav class="kv-trin" aria-label="${esc(T.kv.trinLabel)}"></nav>
      <ul class="kv-deltagere" aria-label="${esc(T.lobby.deltagere)}"></ul>
    </header>

    <main class="kv-midt">
      <section class="kv-skaerm kv-karakterer" data-trin="karakterer">
        <div class="kv-side" data-side="venstre"></div>
        <div class="kv-vaelger">
          <div class="kv-aktoer"></div>
          <div class="kv-fighter-plads" data-side="midt"></div>
          <div class="kv-holdvalg" role="radiogroup" aria-label="${esc(T.kv.holdValg)}"></div>
          <div class="kv-rooster" role="group" aria-label="${esc(T.kv.trin[0])}"></div>
          <div class="kv-rooster-note"></div>
          <div class="kv-uden-hold"></div>
        </div>
        <div class="kv-side" data-side="hoejre"></div>
      </section>

      <section class="kv-skaerm kv-banevalg" data-trin="bane" hidden>
        <h2 class="kv-overskrift">${esc(T.kv.baneTitel)}</h2>
        <div class="kv-baner" role="group" aria-label="${esc(T.kv.trin[1])}"></div>
        <p class="kv-note">${esc(T.kv.baneNote)}</p>
      </section>

      <section class="kv-skaerm kv-regelvalg" data-trin="regler" hidden>
        <h2 class="kv-overskrift">${esc(T.kv.reglerTitel)}</h2>
        <p class="kv-note kv-regler-hvem"></p>
        <div class="kv-regler"></div>
        <p class="kv-note kv-regler-note">${esc(T.kv.reglerNote)}</p>
      </section>

      <section class="kv-skaerm kv-klarside" data-trin="klar" hidden>
        <div class="kv-opsummering"></div>
        <div class="kv-klar-boks">
          <h2 class="kv-overskrift">${esc(T.kv.klarTitel)}</h2>
          <button type="button" class="btn pri stor kv-klar-knap" data-handling="klar"></button>
          <p class="kv-note kv-klar-note"></p>
          <ul class="kv-klar-deltagere" aria-label="${esc(T.lobby.deltagere)}"></ul>
        </div>
      </section>
    </main>

    <footer class="kv-fod">
      <button type="button" class="btn sek kv-tilbage" data-handling="tilbage">${esc(T.menu.tilbage)}</button>
      <div class="kv-fod-midt">
        <div class="venter kv-status" id="lStatus" role="status" aria-live="polite"></div>
        <div class="kv-taster"></div>
      </div>
      <div class="kv-fod-knapper">
        <button type="button" class="btn sek kv-opt" data-handling="indstillinger">${esc(T.menu.indstillinger)}</button>
        <button type="button" class="btn sek kv-forlad" data-handling="forlad">${esc(T.kv.forlad)}</button>
        <button type="button" class="btn kv-naeste" data-handling="naeste"></button>
      </div>
    </footer>

    <div class="kv-nedtaelling" hidden>
      <div class="kv-nedtaelling-tal" aria-live="assertive"></div>
      <div class="kv-nedtaelling-bane">
        <span class="kv-nedtaelling-lbl">${esc(T.kv.banen)}</span>
        <b class="kv-nedtaelling-navn"></b>
      </div>
      <button type="button" class="btn sek kv-annuller" data-handling="annuller">${esc(T.kv.annuller)}</button>
    </div>`;
  rod.appendChild(kv);

  /* Fighterne: ét element pr. spiller, nøglet på pid, hver med sin egen
   * lavFighter. Elementet flyttes med spilleren mellem holdene og midten og
   * fjernes (med sine klip sat på pause), når han ikke længere står der. */
  const fightere = new Map();           // pid -> { n, f, skilt }

  function fighterTil(pid) {
    let x = fightere.get(pid);
    if (x) return x;
    const n = document.createElement('div');
    n.className = 'kv-fighter';
    n.innerHTML = `
      <div class="kv-fighter-scene"></div>
      <div class="kv-navneskilt">
        <span class="kv-navneskilt-klinik"></span>
        <span class="kv-navneskilt-navn"></span>
        <span class="kv-navneskilt-rolle"></span>
        <span class="kv-navneskilt-spiller"></span>
      </div>`;
    const s = (k) => n.querySelector(`.kv-navneskilt-${k}`);
    x = { n, f: lavFighter(n, planlaeg), skilt: { klinik: s('klinik'), navn: s('navn'), rolle: s('rolle'), spiller: s('spiller') } };
    fightere.set(pid, x);
    return x;
  }

  function fjernFighter(pid) {
    const x = fightere.get(pid);
    if (!x) return;
    x.f.fjern();
    x.n.remove();
    fightere.delete(pid);
  }

  const $ = (s) => kv.querySelector(s);
  const el = {
    top: $('.kv-top'), rum: $('.kv-rum'), trin: $('.kv-trin'), deltagere: $('.kv-deltagere'),
    skaerme: [...kv.querySelectorAll('.kv-skaerm')],
    karakterer: $('.kv-karakterer'),
    sider: { venstre: $('.kv-side[data-side=venstre]'), hoejre: $('.kv-side[data-side=hoejre]') },
    aktoer: $('.kv-aktoer'), midtPlads: $('.kv-fighter-plads[data-side=midt]'),
    holdvalg: $('.kv-holdvalg'), rooster: $('.kv-rooster'), roosterNote: $('.kv-rooster-note'),
    udenHold: $('.kv-uden-hold'),
    baner: $('.kv-baner'),
    reglerHvem: $('.kv-regler-hvem'), regler: $('.kv-regler'),
    opsummering: $('.kv-opsummering'), klarKnap: $('.kv-klar-knap'), klarNote: $('.kv-klar-note'),
    klarDeltagere: $('.kv-klar-deltagere'),
    fod: $('.kv-fod'), tilbage: $('.kv-tilbage'), naeste: $('.kv-naeste'), status: $('#lStatus'),
    taster: $('.kv-taster'),
    ned: $('.kv-nedtaelling'), nedTal: $('.kv-nedtaelling-tal'), nedBane: $('.kv-nedtaelling-bane'),
    nedNavn: $('.kv-nedtaelling-navn'), annuller: $('.kv-annuller'),
    felter: [], baneFelter: [],
  };

  /** Skriv kun om, når indholdet er ændret: bevarer DOM, fokus og hover. */
  function saetHtml(n, html) {
    if (n && sidst.get(n) !== html) { n.innerHTML = html; sidst.set(n, html); }
  }
  function saetAttr(n, k, v) {
    if (v == null) { if (n.hasAttribute(k)) n.removeAttribute(k); }
    else if (n.getAttribute(k) !== String(v)) n.setAttribute(k, v);
  }
  function saetTekst(n, s) { if (n.textContent !== s) n.textContent = s; }

  // Rosterets og banernes felter er faste og bygges én gang.
  el.rooster.innerHTML = FELTER.map((f, i) => `
    <button type="button" class="kv-felt" data-i="${i}" data-figur="${f.figur}"
            ${f.klinik ? `data-klinik="${esc(f.klinik)}"` : ''} data-aaben="${f.aaben ? 1 : 0}">
      <span class="kv-felt-portraet"></span>
      <span class="kv-felt-navn">${esc(f.navn)}</span>
      <span class="kv-felt-rolle">${esc(f.aaben ? f.rolle : T.kv.kommerSnart)}</span>
      ${f.aaben ? '' : `<span class="kv-felt-laas">${esc(T.kv.kommerSnart)}</span>`}
      <span class="kv-felt-maerker"></span>
    </button>`).join('');
  el.felter = [...el.rooster.querySelectorAll('.kv-felt')];

  el.baner.innerHTML = BANE_VALG.map((b, i) => `
    <button type="button" class="kv-bane" data-i="${i}" data-bane="${b}">
      <span class="kv-bane-billede" aria-hidden="true"></span>
      <span class="kv-bane-navn">${esc(baneNavn(b))}</span>
      <span class="kv-bane-antal"></span>
      <span class="kv-bane-stemmer"></span>
    </button>`).join('');
  el.baneFelter = [...el.baner.querySelectorAll('.kv-bane')];

  // intro.json, portrætterne og de åbne karakterers loops hentes med det
  // samme; hvert tegnes ind, når det er klar.
  vedVideoFejl = planlaeg;
  hentFilmData().then((d) => { filmData = d || {}; forvarmKlip(); planlaeg(); });
  for (const f of FELTER) if (f.figur !== 'tilfaeldig') hentPortraet(f.figur).then(planlaeg);

  /* ---------------------------------------------------------- ventende valg */

  const VALGFELTER = ['valg', 'hold', 'stemme'];
  const VENT_MS = 1500;
  const venter = (pid) => !!ventende && ventende.pid === pid && performance.now() <= ventende.til;

  /** Et valg er sendt til rummet: vis det med det samme (felt: valg, hold eller stemme). */
  function husk(felt, v) {
    if (!m) return;
    if (!ventende || ventende.pid !== m.pid) ventende = { pid: m.pid };
    ventende[felt] = v;
    ventende.til = performance.now() + VENT_MS;
    clearTimeout(ventTimer);
    // Svarer rummet ikke (eller afviser), står rummets tilstand der igen.
    ventTimer = setTimeout(() => { ventende = null; planlaeg(); }, VENT_MS + 20);
    m = aktuel();
  }

  /** Ny lobbybesked: det, den viser, venter ikke længere. */
  function afstem() {
    if (!ventende) return;
    const d = t.deltagere.find((x) => x.pid === ventende.pid);
    if (d) for (const k of VALGFELTER) if (k in ventende && (d[k] ?? null) === ventende[k]) delete ventende[k];
    if (!d || !VALGFELTER.some((k) => k in ventende)) { ventende = null; clearTimeout(ventTimer); }
  }

  /** vaelgerTil(t) med aktørens ventende valg. plads er kun rummets egen,
   *  når den stadig passer (ellers null). */
  function aktuel() {
    const a = vaelgerTil(t);
    if (!a || !venter(a.pid)) return a;
    const b = { ...a };
    for (const k of VALGFELTER) if (k in ventende) b[k] = ventende[k];
    if (b.hold !== a.hold || b.valg !== a.valg) b.plads = null;
    return b;
  }

  /** En deltager, som skærmen viser ham: aktøren med sine ventende valg. */
  const nu = (d) => (d && m && d.pid === m.pid ? { ...d, hold: m.hold, valg: m.valg, stemme: m.stemme } : d);
  const deltagereNu = () => t.deltagere.map(nu);

  /** Holdets pladser (hold[].baevere) med aktørens ventende hold og valg:
   *  han står på det hold, han har valgt, i den rækkefølge, han kom ind. */
  function pladserFor(hi) {
    const liste = t.hold[hi]?.baevere || [];
    if (!m || !venter(m.pid)) return liste;
    const egen = liste.find((b) => b.ejer === m.pid) || null;
    const andre = liste.filter((b) => b.ejer !== m.pid);
    if (m.hold !== hi) return andre;
    const mig = { id: `b_${m.pid}`, udseende: {}, ...egen, ejer: m.pid, valg: m.valg,
      navn: egen && egen.valg === m.valg ? egen.navn : figurNavn(m.valg) };
    const orden = (pid) => t.deltagere.findIndex((d) => d.pid === pid);
    const i = andre.findIndex((b) => orden(b.ejer) > orden(m.pid));
    return i < 0 ? [...andre, mig] : [...andre.slice(0, i), mig, ...andre.slice(i)];
  }

  /** Holdets spillere forfra: aktøren er forrest, når han er på holdet,
   *  ellers den første, der kom ind; resten følger i den rækkefølge. */
  function holdOrden(hi) {
    const pids = pladserFor(hi).map((b) => b.ejer);
    const i = m ? pids.indexOf(m.pid) : -1;
    return i > 0 ? [pids[i], ...pids.slice(0, i), ...pids.slice(i + 1)] : pids;
  }

  /* ---------------------------------------------------------- afledt */

  const erNet = () => t?.kode != null;
  const erVaert = () => !!m && m.pid === vaertPid(t);
  const laast = () => !!m?.klar;                   // klar: fighter, hold og stemme står fast
  const kanRedigereRegler = () => erVaert() && !laast();
  const sidsteRegel = () => (erVaert() ? RUL : RUL - 1);
  const deltager = (pid) => t.deltagere.find((d) => d.pid === pid) || null;
  const aktive = () => t.deltagere.filter((d) => !d.tilskuer && d.forbundet !== false);
  /** Lokalt springer spillerne efter den første reglerne over. */
  const trinRaekke = () => (!erNet() && m?.lokalNr > 0 ? [0, 1, 3] : [0, 1, 2, 3]);
  const naesteTrin = (d) => {
    const r = trinRaekke();
    const i = r.indexOf(ui.trin);
    return i < 0 ? Math.max(0, Math.min(3, ui.trin + d)) : r[Math.max(0, Math.min(r.length - 1, i + d))];
  };

  /** Trinnet, en ny aktør ved ét tastatur starter på. Er han allerede klar,
   *  Klar-trinnet, hvor han kan fortryde; ved Spil igen (til nogen trykker)
   *  det ønskede trin, når hans fighter og hold står der; ellers Karakterer. */
  function startTrin() {
    const a = aktuel();
    if (a?.klar) return TRIN.length - 1;
    if (omkamp >= 0 && a?.hold != null && a?.valg != null) return omkamp;
    return 0;
  }

  /** Er trinnet gjort? Bruges af trinbjælken og Næste-knappen. */
  function trinFaerdigt(i) {
    if (!m) return false;
    if (i === 0) return m.hold != null && m.valg != null;
    if (i === 1) return m.stemme != null;
    if (i === 2) return true;
    return m.klar;
  }

  /* ---------------------------------------------------------- tegning */

  function planlaeg() {
    if (planlagt || !t) return;
    planlagt = requestAnimationFrame(() => { planlagt = 0; tegn(); });
  }

  function tegn() {
    if (!t) return;
    const havdeFokus = kv.contains(document.activeElement);
    const trin = TRIN[ui.trin];
    m = aktuel();
    hv = holdVisning(t);
    kv.dataset.trin = trin;
    kv.dataset.zone = ui.zone;
    kv.dataset.net = erNet() ? '1' : '0';
    kv.dataset.vaert = erVaert() ? '1' : '0';
    kv.dataset.laast = laast() ? '1' : '0';
    el.skaerme.forEach((s) => { s.hidden = s.dataset.trin !== trin; });
    for (const x of fightere.values()) x.f.aktiv(trin === 'karakterer');

    tegnTop();
    if (trin === 'karakterer') tegnKarakterer();
    else if (trin === 'bane') tegnBaner();
    else if (trin === 'regler') tegnRegler();
    else tegnKlar();
    tegnFod();

    // Markøren i top-, hold- og fodlinjen (gitterets markør sætter trinnet selv).
    const mk = ui.zone === 'gitter' ? null : markoerElement();
    // Toplinjen: huskes efter det, knappen gør; er den væk, står markøren på
    // knappen på samme plads, og den huskes så i stedet.
    if (ui.zone === 'top' && mk) { ui.top = topKnapper().indexOf(mk); ui.topNoegle = topNoegle(mk); }
    for (const n of kv.querySelectorAll('.kv-top button, .kv-fod button, .kv-holdknap')) n.classList.toggle('fokus', n === mk);

    // Er det fokuserede element skrevet om, får markøren fokus igen.
    if (havdeFokus && !kv.contains(document.activeElement)) fokuser(false);
  }

  function tegnTop() {
    const link = erNet() ? `${location.origin}/spil/${t.kode}` : '';
    saetHtml(el.rum, `
      <h1 class="kv-titel">${esc(T.lobby.titel)}</h1>
      ${erNet() ? `
        <div class="kv-rumkode">
          <span class="lbl">${esc(T.lobby.rumkode)}</span>
          <b class="kv-kode">${esc(t.kode)}</b>
          <button type="button" class="btn sm kv-kopier" data-handling="kopier" data-link="${esc(link)}"
                  title="${esc(link)}">${esc(T.kv.kopierLink)}</button>
          <span class="kv-kopieret" hidden>${esc(T.lobby.kopieret)}</span>
        </div>` : `<div class="kv-rumkode kv-lokalt">${esc(T.kv.lokalt)}</div>`}`);

    const r = trinRaekke();
    saetHtml(el.trin, T.kv.trin.map((navn, i) => `
      <button type="button" class="kv-trin-knap" data-trin-knap="${i}" data-trin="${TRIN[i]}"
              ${i === ui.trin ? 'aria-current="step"' : ''} data-faerdig="${trinFaerdigt(i) ? 1 : 0}"
              ${r.includes(i) ? '' : 'data-sprunget="1"'}>
        <span class="kv-trin-nr">${i + 1}</span><span class="kv-trin-navn">${esc(navn)}</span>
      </button>`).join('<span class="kv-trin-skille" aria-hidden="true">·</span>'));

    saetHtml(el.deltagere, deltagerListe(true));
  }

  /** Deltagerne med flueben. Ved ét tastatur (knapper) kan en klar spiller
   *  klikkes Ikke klar igen, de ekstra spillere fjernes, og der kan komme flere. */
  function deltagerListe(knapper) {
    const lok = erNet() ? [] : lokale(t).map((d) => d.pid);
    const linjer = deltagereNu().map((d) => {
      const hold = d.hold === 0 || d.hold === 1 ? hv[d.hold] : null;
      const nr = lok.indexOf(d.pid);
      const indhold = `
        <span class="kv-deltager-klar" aria-hidden="true">${d.klar ? '✓' : ''}</span>
        <span class="kv-deltager-navn">${esc(d.navn)}</span>`;
      const hoved = knapper && nr >= 0
        ? `<button type="button" class="kv-deltager-knap" data-uklar="${esc(d.pid)}" ${d.klar && nr >= 0 ? '' : 'disabled'}
             title="${esc(d.klar ? T.kv.fraKlar(d.navn) : d.navn)}">${indhold}</button>`
        : indhold;
      const fjern = knapper && nr >= 2
        ? `<button type="button" class="kv-deltager-fjern" data-fjern="${esc(d.pid)}"
             aria-label="${esc(T.kv.fjernSpiller(d.navn))}" title="${esc(T.kv.fjernSpiller(d.navn))}">×</button>`
        : '';
      return `<li class="kv-deltager" data-pid="${esc(d.pid)}" data-klar="${d.klar ? 1 : 0}"
          data-mig="${d.pid === m?.pid ? 1 : 0}" data-vaert="${d.pid === vaertPid(t) ? 1 : 0}"
          data-tilskuer="${d.tilskuer ? 1 : 0}" data-forbundet="${d.forbundet === false ? 0 : 1}"
          data-lokal="${nr >= 0 ? 1 : 0}" ${hold ? `data-klinik="${hold.farve}" style="${farveStil(hold)}"` : 'data-klinik="ingen"'}>
        ${hoved}
        ${erNet() && d.pid === t.vaert ? `<i class="badge">${esc(T.lobby.vaert)}</i>` : ''}
        ${d.tilskuer ? `<i class="badge sek">${esc(T.lobby.tilskuer)}</i>` : ''}
        ${d.forbundet === false ? `<i class="badge advarsel">${esc(T.lobby.afbrudt)}</i>` : ''}
        ${fjern}
      </li>`;
    });
    if (knapper && !erNet() && lok.length < MAKS_LOKALE) {
      linjer.push(`<li class="kv-deltager-ny"><button type="button" class="btn sm kv-ny-spiller"
        data-handling="nySpiller">${esc(T.kv.nySpiller)}</button></li>`);
    }
    return linjer.join('');
  }

  /* ---- trin 1: karakterer */

  function tegnKarakterer() {
    // Holdpanelerne: skelettet afhænger kun af holdene.
    for (const side of ['venstre', 'hoejre']) {
      saetHtml(el.sider[side], hv.filter((v) => v.side === side).map((v) => `
        <section class="kv-hold" data-hold="${v.hi}" data-side="${side}" data-klinik="${v.farve}" style="${farveStil(v)}">
          <h3 class="kv-hold-navn"><span class="kv-hold-farve">${esc(v.kort)}</span> ${esc(v.navn)}</h3>
          <div class="kv-hold-fightere" data-side="${side}"></div>
          <ul class="kv-spillere" aria-label="${esc(v.navn)}"></ul>
        </section>`).join(''));
    }
    for (const panel of el.karakterer.querySelectorAll('.kv-hold')) {
      const hi = +panel.dataset.hold;
      panel.classList.toggle('mit', m?.hold === hi);
      const pladser = pladserFor(hi);
      saetHtml(panel.querySelector('.kv-spillere'), pladser.length
        ? pladser.map(spillerHtml).join('')
        : `<li class="kv-spiller tom">${esc(T.kv.ingenSpillere)}</li>`);
    }

    // Ved ét tastatur: hvem vælger nu?
    saetHtml(el.aktoer, !erNet() && m ? `<b>${esc(T.kv.vaelger(m.navn))}</b>` : '');

    tegnFightere();

    // Holdvalget: blåt eller rødt, som en vippeknap over rosteret.
    saetHtml(el.holdvalg, hv.map((v, i) => `${i ? '<span class="kv-holdvalg-vs" aria-hidden="true">VS</span>' : ''}
      <button type="button" class="kv-holdknap" role="radio" data-vaelg-hold="${v.hi}" data-klinik="${v.farve}"
              data-side="${v.side}" style="${farveStil(v)}" aria-checked="${m?.hold === v.hi}"
              ${laast() ? 'aria-disabled="true"' : ''}>
        <span class="kv-holdknap-farve">${esc(v.kort)}</span>
        <span class="kv-holdknap-navn">${esc(v.navn)}</span>
      </button>`).join(''));

    const note = !m ? '' : laast() ? T.kv.laastKlar
      : m.hold == null && m.valg != null ? T.kv.vaelgHold
        : trinFaerdigt(0) ? T.kv.alleValgt : '';
    saetHtml(el.roosterNote, note ? `<p class="kv-note">${esc(note)}</p>` : '');

    const uden = aktive().map(nu).filter((d) => d.hold !== 0 && d.hold !== 1);
    saetHtml(el.udenHold, uden.length ? `<span class="lbl">${esc(T.kv.udenHold)}</span>
      ${uden.map((d) => `<span class="kv-uden-hold-navn${d.pid === m?.pid ? ' mig' : ''}" data-pid="${esc(d.pid)}">${esc(d.navn)}</span>`).join('')}` : '');

    // Felterne: markør, mit valg, og hvem der har valgt dem (i holdets farve).
    const alle = deltagereNu();
    el.felter.forEach((n, i) => {
      const f = FELTER[i];
      n.classList.toggle('markoer', i === ui.markoer);
      n.classList.toggle('valgt', m?.valg === f.figur);
      saetAttr(n, 'aria-disabled', !f.aaben || laast() ? 'true' : null);
      saetAttr(n, 'aria-pressed', m?.valg === f.figur ? 'true' : 'false');
      saetHtml(n.querySelector('.kv-felt-portraet'), portraet(f.figur, 'kv-felt-portraet'));
      saetHtml(n.querySelector('.kv-felt-maerker'), alle.filter((d) => d.valg === f.figur).map((d) => {
        const v = d.hold === 0 || d.hold === 1 ? hv[d.hold] : null;
        return `<i class="kv-maerke${d.pid === m?.pid ? ' mit' : ''}" data-pid="${esc(d.pid)}"
          data-klinik="${v ? v.farve : 'ingen'}" ${v ? `style="${farveStil(v)}"` : ''} title="${esc(d.navn)}">${esc(initialer(d.navn))}</i>`;
      }).join(''));
    });
  }

  /** Holdenes fightere i .kv-hold-fightere (data-nr 0 forrest, se holdOrden),
   *  og aktørens i midten, før han har valgt hold. Andre uden hold har ingen. */
  function tegnFightere() {
    const vist = new Set();
    const saet = (plads, pid, nr, hi) => {
      const x = fighterTil(pid);
      if (plads.children[nr] !== x.n) plads.insertBefore(x.n, plads.children[nr] || null);
      tegnFighter(x, pid, nr, hi);
      vist.add(pid);
    };
    for (const plads of el.karakterer.querySelectorAll('.kv-hold-fightere')) {
      const hi = +plads.closest('.kv-hold').dataset.hold;
      const pids = holdOrden(hi);
      pids.forEach((pid, nr) => saet(plads, pid, nr, hi));
      saetAttr(plads, 'data-antal', pids.length);
    }
    const iMidten = !!m && m.hold == null;
    if (iMidten) saet(el.midtPlads, m.pid, 0, null);
    el.midtPlads.hidden = !iMidten;
    for (const pid of [...fightere.keys()]) if (!vist.has(pid)) fjernFighter(pid);
  }

  /** Én fighter: spillerens eget valg. Aktørens viser markørens karakter,
   *  mens han kigger i rosteret. Kun nr 0 får loopet. */
  function tegnFighter({ n, f, skilt }, pid, nr, hi) {
    const v = hi != null ? hv[hi] : null;
    const d = nu(deltager(pid));
    const plads = hi != null ? pladserFor(hi).find((b) => b.ejer === pid) || null : null;
    const mig = pid === m?.pid;
    const eget = mig ? m.valg : pladsValg(plads, d);
    const kigger = mig && ui.zone === 'gitter' && !laast();
    const figur = kigger ? FELTER[ui.markoer].figur : eget;
    const forhaand = kigger && figur !== eget;
    const r = typeof figur === 'number' ? rosterFigur(figur) : null;
    f.vis(figur, hi, nr === 0);
    saetAttr(n, 'data-nr', nr);
    saetAttr(n, 'data-pid', pid);
    saetAttr(n, 'data-side', v ? v.side : 'midt');
    saetAttr(n, 'data-klinik', v ? v.farve : 'ingen');
    saetAttr(n, 'style', v ? farveStil(v) : null);
    saetAttr(n, 'data-figur', figur ?? '');
    saetAttr(n, 'data-aaben', !r || r.aaben ? '1' : '0');
    saetAttr(n, 'data-forhaand', forhaand ? '1' : '0');
    // Navneskiltet: rummets navn på pladsen (med romertal), når det er hans fighter.
    const navn = !forhaand && plads?.navn && pladsValg(plads, d) === figur ? plads.navn : figurNavn(figur);
    saetTekst(skilt.klinik, v ? v.navn : T.kv.holdValg);
    saetTekst(skilt.navn, navn || T.kv.intetValg);
    saetTekst(skilt.rolle, figur === 'tilfaeldig' ? T.kv.tilfaeldigRolle : r ? (r.aaben ? r.rolle : T.kv.kommerSnart) : '');
    saetTekst(skilt.spiller, d?.navn || '');
  }

  /** En spiller i holdpanelet: lille portræt, fighter, navn og flueben. */
  function spillerHtml(b) {
    const d = deltager(b.ejer);
    const v = pladsValg(b, d);
    const klasser = ['kv-spiller', b.ejer === m?.pid && 'mig', d?.klar && 'klar', v != null && 'valgt',
      v === 'tilfaeldig' && 'tilfaeldig', d?.lokal && 'lokal'].filter(Boolean).join(' ');
    return `<li class="${klasser}" data-pid="${esc(b.ejer)}" data-figur="${esc(v ?? '')}">
      <span class="kv-spiller-portraet">${portraet(v, 'kv-spiller')}</span>
      <span class="kv-spiller-tekst">
        <span class="kv-spiller-fighter">${esc(b.navn || figurNavn(v) || T.kv.intetValg)}</span>
        <span class="kv-spiller-navn">${esc(d?.navn || '—')}</span>
      </span>
      <span class="kv-spiller-klar" ${d?.klar ? `aria-label="${esc(T.menu.klar)}"` : 'aria-hidden="true"'}>${d?.klar ? '✓' : ''}</span>
    </li>`;
  }

  /* ---- trin 2: bane */

  function tegnBaner() {
    const alle = deltagereNu();
    el.baneFelter.forEach((n, i) => {
      const b = BANE_VALG[i];
      const stemmer = alle.filter((d) => d.stemme === b);
      n.classList.toggle('markoer', i === ui.bane);
      n.classList.toggle('min-stemme', m?.stemme === b);
      saetAttr(n, 'data-stemmer', stemmer.length);
      saetAttr(n, 'aria-pressed', m?.stemme === b ? 'true' : 'false');
      saetAttr(n, 'aria-disabled', laast() ? 'true' : null);
      saetHtml(n.querySelector('.kv-bane-antal'), stemmer.length ? esc(T.kv.stemmer(stemmer.length)) : '');
      saetHtml(n.querySelector('.kv-bane-stemmer'), stemmer.map((d) => `
        <i class="kv-stemme${d.pid === m?.pid ? ' mit' : ''}" data-pid="${esc(d.pid)}" title="${esc(d.navn)}">${esc(initialer(d.navn))}</i>`).join(''));
    });
  }

  /* ---- trin 3: regler */

  function tegnRegler() {
    const kan = kanRedigereRegler();
    const vaert = deltager(vaertPid(t));
    el.reglerHvem.textContent = erVaert() ? (laast() ? T.kv.laastKlar : T.kv.reglerVaert)
      : erNet() || !vaert ? T.kv.reglerGaest : T.kv.reglerSaetter(vaert.navn);
    // Rækkerne bygges kun om, når redigeringsretten skifter; ellers flyttes .paa.
    const noegle = `${kan}|${erVaert()}`;
    if (noegle !== reglerNoegle) {
      reglerNoegle = noegle;
      el.regler.classList.toggle('laast', !kan);
      el.regler.innerHTML = REGLER.map((r, ri) => `
        <div class="ir kv-regel" data-regel="${ri}" data-navn="${esc(r.navn)}">
          <span class="kv-regel-navn">${esc(r.label)}</span>
          <div class="ir-valg">
            ${r.valg.map((v) => `<button type="button" class="ir-knap" data-indst="${esc(r.navn)}" data-v="${esc(v)}"
                ${kan ? '' : 'disabled'}>${esc((r.fmt || String)(v))}</button>`).join('')}
          </div>
        </div>`).join('')
        + (erVaert() ? `<button type="button" class="btn kv-tilfaeldige-regler" data-regel="${RUL}"
             data-handling="tilfaeldigeRegler" title="${esc(T.kv.tilfaeldigeReglerTitel)}"
             ${kan ? '' : 'disabled'}>${esc(T.kv.tilfaeldigeRegler)}</button>` : '');
    }
    for (const raekke of el.regler.querySelectorAll('.kv-regel')) {
      const r = REGLER[+raekke.dataset.regel];
      const nu = String(r.vaerdi(t));
      raekke.classList.toggle('fokus', ui.zone === 'gitter' && +raekke.dataset.regel === ui.regel);
      for (const k of raekke.querySelectorAll('.ir-knap')) {
        k.classList.toggle('paa', k.dataset.v === nu);
        saetAttr(k, 'aria-pressed', k.dataset.v === nu ? 'true' : 'false');
      }
    }
    el.regler.querySelector('.kv-tilfaeldige-regler')?.classList.toggle('fokus', ui.zone === 'gitter' && ui.regel === RUL);
  }

  /* ---- trin 4: klar */

  function tegnKlar() {
    const klar = !!m?.klar;
    saetTekst(el.klarKnap, klar ? T.menu.ikkeKlar : T.menu.klar);
    saetAttr(el.klarKnap, 'data-klar', klar ? '1' : '0');
    saetAttr(el.klarKnap, 'aria-pressed', klar ? 'true' : 'false');
    el.klarKnap.classList.toggle('fokus', ui.zone === 'gitter');
    saetTekst(el.klarNote, klar ? T.kv.laastKlar : m && m.hold == null ? T.kv.vaelgHoldFoerst : '');
    saetHtml(el.klarDeltagere, deltagerListe(false));

    const hold = hv.map((v) => {
      const pladser = pladserFor(v.hi);
      return `<div class="kv-ops-klinik" data-hold="${v.hi}" data-klinik="${v.farve}" data-side="${v.side}" style="${farveStil(v)}">
        <h3><span class="kv-hold-farve">${esc(v.kort)}</span> ${esc(v.navn)}</h3>
        <ol>${pladser.length ? pladser.map((b) => {
          const d = deltager(b.ejer);
          const vg = pladsValg(b, d);
          return `<li data-pid="${esc(b.ejer)}" data-figur="${esc(vg ?? '')}"${vg == null ? ' class="tom"' : ''}>
            <span class="kv-ops-portraet">${portraet(vg, 'kv-ops')}</span>
            <span class="kv-ops-navn">${esc(b.navn || figurNavn(vg) || T.kv.intetValg)}</span>
            <span class="kv-ops-ejer">${esc(d?.navn || '—')}</span>
            <span class="kv-ops-klar" aria-hidden="true">${d?.klar ? '✓' : ''}</span></li>`;
        }).join('') : `<li class="tom">${esc(T.kv.ingenSpillere)}</li>`}</ol>
      </div>`;
    }).join('');

    const alle = deltagereNu();
    const baner = BANE_VALG.map((b) => ({ b, n: alle.filter((d) => d.stemme === b).length }))
      .filter((x) => x.n > 0);
    const regler = REGLER.map((r) => `
      <div class="kv-ops-regel" data-navn="${esc(r.navn)}"><dt>${esc(r.label)}</dt>
        <dd>${esc((r.fmt || String)(r.vaerdi(t)))}</dd></div>`).join('');

    saetHtml(el.opsummering, `
      <section class="kv-ops kv-ops-hold">${hold}</section>
      <section class="kv-ops kv-ops-baner">
        <h3>${esc(T.kv.trin[1])}</h3>
        ${baner.length
          ? `<ul>${baner.map((x) => `<li data-bane="${x.b}"${x.b === m?.stemme ? ' class="mit"' : ''}>
               <span>${esc(baneNavn(x.b))}</span> <b>${x.n}</b></li>`).join('')}</ul>`
          : `<p class="kv-note">${esc(T.kv.ingenStemmer)} · ${esc(baneNavn(t.indst.banetype || 'fort'))}</p>`}
      </section>
      <section class="kv-ops kv-ops-regler">
        <h3>${esc(T.kv.trin[2])}</h3>
        <dl>${regler}</dl>
      </section>`);
  }

  /* ---- fod og status */

  function tegnFod() {
    const sidste = ui.trin === TRIN.length - 1;
    el.tilbage.disabled = ui.trin === 0;
    el.naeste.hidden = sidste;
    if (!sidste) saetTekst(el.naeste, T.kv.naeste(T.kv.trin[naesteTrin(1)]));
    // Er trinnet gjort, er Næste skærmens hovedhandling (og pulserer).
    const cta = !sidste && trinFaerdigt(ui.trin);
    el.naeste.classList.toggle('pri', cta);
    saetAttr(el.naeste, 'data-cta', cta ? '1' : '0');

    const trin = TRIN[ui.trin];
    const tip = trin === 'karakterer' ? T.kv.taster.karakterer
      : trin === 'bane' ? T.kv.taster.bane
        : trin === 'regler' ? regelTip()
          : T.kv.taster.klar;
    const taster = tip ? [tip] : [];
    if (ui.trin > 0) taster.push(T.kv.taster.tilbage);
    saetHtml(el.taster, taster.map((s) => `<span>${esc(s)}</span>`).join(''));
    tegnStatus();
  }

  /** Regeltrinnets tastetip følger markøren: i listen skifter Enter reglen
   *  (på 🎲 trækkes nye), og kun på Næste går Enter videre. */
  function regelTip() {
    const kan = kanRedigereRegler();
    if (kan && ui.zone === 'gitter') return ui.regel === RUL ? T.kv.taster.reglerRul : T.kv.taster.reglerListe;
    if (ui.zone === 'fod' && markoerElement() === el.naeste) return kan ? T.kv.taster.reglerNaesteVaert : T.kv.taster.reglerNaeste;
    return kan ? T.kv.taster.reglerVaert : '';
  }

  function statusTekst() {
    if (t.nedtaelling_ms != null) return T.kv.starter;
    const mangler = aktive().filter((d) => !d.klar);
    if (!mangler.length) return t.hold.every((h) => h.baevere.length > 0) ? T.kv.alleKlar : T.kv.toHold;
    if (m && !m.klar) {
      const andre = mangler.length - 1;
      const her = erNet() ? T.kv.trykKlar : T.kv.vaelger(m.navn);
      return andre > 0 ? `${her} · ${T.kv.venterPaa(andre)}` : her;
    }
    return T.kv.venterPaa(mangler.length);
  }

  function tegnStatus() {
    const b = besked && besked.til > performance.now() ? besked : null;
    saetTekst(el.status, b ? b.tekst : statusTekst());
    el.status.classList.toggle('advarsel', !!b?.advarsel);
    el.status.classList.remove('hide');
  }

  /** En kort besked i statuslinjen (fejl fra rummet, afviste valg). */
  function visBesked(tekst, advarsel = true, ms = 3500) {
    besked = { tekst, advarsel, til: performance.now() + ms };
    clearTimeout(beskedTimer);
    beskedTimer = setTimeout(() => { besked = null; if (t) tegnStatus(); }, ms + 20);
    if (t) tegnStatus();
    else { el.status.textContent = tekst; el.status.classList.toggle('advarsel', advarsel); }
  }

  /* ---------------------------------------------------------- nedtællingen */

  function opdaterNedtaelling() {
    const ms = t.nedtaelling_ms;
    if (typeof ms !== 'number') {
      if (!el.ned.hidden) skjulNedtaelling();
      return;
    }
    // Fristen sættes igen ved hver besked; rummets tal er sandheden.
    frist = performance.now() + ms;
    const ny = el.ned.hidden;
    el.ned.hidden = false;
    kv.dataset.nedtaelling = '1';
    el.annuller.hidden = !m?.klar;
    if (ny || t.bane_trukket !== trukket) roulette(t.bane_trukket);
    if (ny) { visTal = 0; fokuser(false); }
    if (!raf) tik();                    // "3" står der med det samme, ikke først ved næste billede
  }

  function tik() {
    raf = 0;
    if (frist == null) return;
    const n = Math.max(1, Math.min(3, Math.ceil((frist - performance.now()) / 1000)));
    if (n !== visTal) {
      visTal = n;
      el.ned.dataset.tal = n;
      // Et nyt element pr. tal, så CSS-animationen starter forfra.
      el.nedTal.innerHTML = `<span class="kv-tal" data-tal="${n}">${n}</span>`;
      lyd.afspil('nedtael', { vigtig: true, tone: 1 + (3 - n) * 0.09 });
    }
    raf = requestAnimationFrame(tik);
  }

  /** Banen afsløres efter en kort rulle gennem banerne (uden bevægelse: straks). */
  function roulette(bane) {
    clearTimeout(rouletteTimer);
    trukket = bane ?? null;
    el.nedBane.classList.remove('afsloeret');
    if (!bane) { el.nedBane.dataset.bane = ''; el.nedNavn.textContent = '…'; return; }
    const afsloer = () => {
      el.nedBane.dataset.bane = bane;
      el.nedNavn.textContent = baneNavn(bane);
      el.nedBane.classList.add('afsloeret');
    };
    if (reduceret()) { afsloer(); return; }
    const raekke = BANE_VALG.filter((b) => b !== 'tilfaeldig');
    let i = Math.floor(Math.random() * raekke.length), n = 0;
    const drej = () => {
      if (++n > 8) { afsloer(); return; }
      const b = raekke[i++ % raekke.length];
      el.nedBane.dataset.bane = b;
      el.nedNavn.textContent = baneNavn(b);
      rouletteTimer = setTimeout(drej, 40 + n * n * 3);   // ca. 0,9 s, langsommere mod slutningen
    };
    drej();
  }

  function skjulNedtaelling() {
    frist = null; visTal = 0; trukket = undefined;
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(rouletteTimer);
    el.ned.hidden = true;
    delete kv.dataset.nedtaelling;
    delete el.ned.dataset.tal;
    el.nedTal.innerHTML = '';
    el.nedBane.classList.remove('afsloeret');
    if (kv.contains(document.activeElement) || document.activeElement === document.body) fokuser(false);
  }

  /** Esc eller Annullér under nedtællingen: aktøren er ikke længere klar
   *  (ved ét tastatur den sidste lokale spiller). */
  function annuller() {
    if (m?.klar) { api.klar(m.som); lyd.afspil('klik', { tone: 0.8 }); }
  }

  /* ---------------------------------------------------------- handlinger */

  const klik = () => lyd.afspil('klik');

  /** Afvist: dyb klik-lyd, en kort besked og et ryst af feltet. */
  function naegt(tekst, n) {
    lyd.afspil('klik', { tone: 0.6 });
    if (tekst) visBesked(tekst, true, 2500);
    if (n && !reduceret()) {
      n.classList.remove('afvist');
      void n.offsetWidth;               // genstart animationen
      n.classList.add('afvist');
      setTimeout(() => n.classList.remove('afvist'), 450);
    }
  }

  /** Til trin i. Er trinnet allerede gjort, står markøren på Næste. */
  function gaaTil(i, lydOgFokus = true) {
    ui.trin = Math.max(0, Math.min(TRIN.length - 1, i));
    m = aktuel();
    const trin = TRIN[ui.trin];
    ui.fod = 'naeste';
    if (trin === 'karakterer') {
      if (m?.valg != null && feltIndeks(m.valg) >= 0) ui.markoer = feltIndeks(m.valg);
      ui.zone = trinFaerdigt(0) ? 'fod' : m?.valg != null ? 'hold' : 'gitter';
    } else if (trin === 'bane') {
      if (m?.stemme) ui.bane = Math.max(0, BANE_VALG.indexOf(m.stemme));
      ui.zone = m?.stemme ? 'fod' : 'gitter';
    } else if (trin === 'regler') {
      ui.zone = 'fod';
    } else {
      ui.zone = 'gitter';               // Klar-knappen
    }
    if (lydOgFokus) klik();
    tegn();
    if (lydOgFokus) fokuser(ui.tastatur);
  }

  function vaelgFelt(i) {
    const n = el.felter[i];
    const f = FELTER[i];
    if (!m) return naegt();
    if (laast()) return naegt(T.kv.laastKlar, n);
    if (!f.aaben) return naegt(`${f.navn}: ${T.kv.kommerSnart}`, n);
    if (m.valg !== f.figur) { api.vaelg(f.figur, m.som); husk('valg', f.figur); }
    // Som i Tekken: den valgte karakter siger en af sine egne replikker (ikke
    // vigtig, så den springes over, hvis noget andet spiller). Tilfældig: kast.
    const replik = typeof f.figur === 'number' ? karakterLyd({ udseende: rosterUdseende(f.figur) }, 'glad') : null;
    if (replik) lyd.stemme(replik);
    else lyd.afspil('kast', { vol: 1.2 });
    // Med hold er trinnet gjort (videre til Næste); ellers vælges holdet nu.
    if (m.hold != null) { ui.zone = 'fod'; ui.fod = 'naeste'; }
    else ui.zone = 'hold';
    tegn();
    if (ui.tastatur) fokuser(true);
  }

  function rydValg() {
    if (!m || m.valg == null) return naegt();
    if (laast()) return naegt(T.kv.laastKlar);
    api.vaelg(null, m.som);
    husk('valg', null);
    ui.zone = 'gitter';
    klik();
    tegn();
    fokuser(true);
  }

  /** Blåt eller rødt hold (Q/E, ←→ i holdvalget, klik på knap eller panel).
   *  I holdvalget bliver markøren stående (videre med Enter eller ↓); ellers
   *  går den til Næste, når han også har en fighter. */
  function vaelgHold(hi) {
    if (!m || !t.hold[hi]) return naegt();
    if (laast()) return naegt(T.kv.laastKlar);
    if (m.hold === hi) { klik(); return; }
    api.hold(hi, m.som);
    husk('hold', hi);
    lyd.afspil('kast', { vol: 1.2 });
    if (ui.zone !== 'hold' && m.valg != null) { ui.zone = 'fod'; ui.fod = 'naeste'; }
    tegn();
    if (ui.tastatur) fokuser(true);
  }

  /** Enter i holdvalget: holdet under markøren (har han intet endnu), og så
   *  videre — til Næste, når han har en fighter, ellers til rosteret. */
  function holdVidere() {
    if (m && m.hold == null && !laast()) {
      const mk = markoerElement();
      if (mk?.dataset.vaelgHold != null) vaelgHold(+mk.dataset.vaelgHold);
    } else klik();
    if (m?.hold != null && m.valg != null) { ui.zone = 'fod'; ui.fod = 'naeste'; }
    else ui.zone = 'gitter';
  }

  function stemPaa(i) {
    const n = el.baneFelter[i];
    if (!m) return naegt();
    if (laast()) return naegt(T.kv.laastKlar, n);
    const b = BANE_VALG[i];
    if (m.stemme === b) {                // samme bane igen: fjern stemmen
      api.stem(null, m.som);
      husk('stemme', null);
      klik();
      ui.zone = 'gitter';
    } else {
      api.stem(b, m.som);
      husk('stemme', b);
      lyd.afspil('kast', { vol: 1.2 });
      ui.zone = 'fod'; ui.fod = 'naeste';
    }
    tegn();
    if (ui.tastatur) fokuser(true);
  }

  function saetRegel(ri, v) {
    if (!kanRedigereRegler()) return naegt(erVaert() ? T.kv.laastKlar : T.kv.reglerGaest);
    const r = REGLER[ri];
    if (String(v) === String(r.vaerdi(t))) return;
    api.indstilling(r.navn, String(v));
    klik();
  }

  /** ←→ på en regel: nabo-værdien (stopper i enderne); Enter: rundt. */
  function skiftRegel(ri, d, rundt = false) {
    const r = REGLER[ri];
    const k = Math.max(0, r.valg.findIndex((v) => String(v) === String(r.vaerdi(t))));
    const j = rundt ? (k + d + r.valg.length) % r.valg.length : Math.max(0, Math.min(r.valg.length - 1, k + d));
    if (j === k) return naegt();
    saetRegel(ri, r.valg[j]);
  }

  function tilfaeldigeRegler() {
    if (!kanRedigereRegler()) return naegt(erVaert() ? T.kv.laastKlar : T.kv.reglerGaest);
    api.randomStart();
    lyd.afspil('kast', { vol: 1.2 });
  }

  /** Klar kræver et hold; uden fighter bliver det Tilfældig. */
  function skiftKlar() {
    if (!m) return naegt();
    if (m.klar) { klik(); api.klar(m.som); return; }
    if (m.hold == null) return naegt(T.kv.vaelgHoldFoerst, el.klarKnap);
    if (m.valg == null) { api.vaelg('tilfaeldig', m.som); husk('valg', 'tilfaeldig'); }
    lyd.afspil('intro_slam');
    api.klar(m.som);
  }

  async function kopierLink(knap) {
    try { await navigator.clipboard.writeText(knap.dataset.link); } catch { /* ingen adgang */ }
    const vis = (v) => { const n = el.rum.querySelector('.kv-kopieret'); if (n) n.hidden = !v; };
    vis(true);
    clearTimeout(kopiTimer);
    kopiTimer = setTimeout(() => vis(false), 2200);
  }

  /** Én knap trykket, med musen eller Enter: gør det, den står for. */
  function udfoer(n) {
    if (!n || n.disabled || !kv.contains(n)) return;
    if (n.classList.contains('kv-felt')) { ui.markoer = +n.dataset.i; ui.zone = 'gitter'; vaelgFelt(ui.markoer); return; }
    if (n.classList.contains('kv-bane')) { ui.bane = +n.dataset.i; ui.zone = 'gitter'; stemPaa(ui.bane); return; }
    if (n.dataset.vaelgHold != null) { vaelgHold(+n.dataset.vaelgHold); return; }
    if (n.dataset.uklar) {
      // Ét tastatur: en spiller, der er klar, trykkes Ikke klar igen (og får turen).
      if (deltager(n.dataset.uklar)?.klar) { api.klar(n.dataset.uklar); klik(); }
      return;
    }
    if (n.dataset.fjern) { api.fjernSpiller(n.dataset.fjern); klik(); return; }
    if (n.dataset.indst) {
      ui.regel = +n.closest('.kv-regel').dataset.regel;
      ui.zone = 'gitter';
      saetRegel(ui.regel, n.dataset.v);
      tegn();
      return;
    }
    if (n.dataset.trinKnap != null) { gaaTil(+n.dataset.trinKnap); return; }
    switch (n.dataset.handling) {
      case 'tilbage': gaaTil(naesteTrin(-1)); break;
      case 'naeste': gaaTil(naesteTrin(1)); break;
      case 'klar': ui.zone = 'gitter'; skiftKlar(); tegn(); break;
      case 'annuller': annuller(); break;
      case 'kopier': kopierLink(n); break;
      case 'nySpiller': api.nySpiller(); klik(); break;
      case 'tilfaeldigeRegler': ui.regel = RUL; ui.zone = 'gitter'; tilfaeldigeRegler(); tegn(); break;
      case 'indstillinger': klik(); opt.indstillinger?.(); break;
      case 'forlad': api.forlad(); break;
      default: break;
    }
  }

  /* ---------------------------------------------------------- markør og fokus */

  const topKnapper = () => [...el.top.querySelectorAll('button:not([disabled])')];
  const fodKnapper = () => [...el.fod.querySelectorAll('button:not([disabled]):not([hidden])')];
  const holdKnapper = () => [...el.holdvalg.querySelectorAll('.kv-holdknap')];

  /** Toplinjens knap efter det, den gør — ikke dens plads, som skifter, når
   *  der kommer en spiller til ("+ Tilføj spiller" rykker, og "×" kommer ind). */
  function topNoegle(n) {
    const d = n?.dataset;
    if (!d) return null;
    if (d.handling) return `handling:${d.handling}`;
    if (d.fjern) return `fjern:${d.fjern}`;
    if (d.uklar) return `uklar:${d.uklar}`;
    if (d.trinKnap != null) return `trin:${d.trinKnap}`;
    return null;
  }

  /** Trinnets gitter: de elementer, piletasterne flytter imellem. */
  function gitterElement() {
    const trin = TRIN[ui.trin];
    if (trin === 'karakterer') return el.felter[ui.markoer];
    if (trin === 'bane') return el.baneFelter[ui.bane];
    if (trin === 'regler') {
      if (!kanRedigereRegler()) return null;
      if (ui.regel === RUL) return el.regler.querySelector('.kv-tilfaeldige-regler');
      const r = el.regler.querySelector(`.kv-regel[data-regel="${ui.regel}"]`);
      return r?.querySelector('.ir-knap.paa') || r?.querySelector('.ir-knap');
    }
    return el.klarKnap;
  }

  /** Elementet, markøren står på. */
  function markoerElement() {
    if (!el.ned.hidden) return el.annuller.hidden ? null : el.annuller;
    if (ui.zone === 'top') {
      const l = topKnapper();
      return (ui.topNoegle && l.find((n) => topNoegle(n) === ui.topNoegle)) || l[Math.min(ui.top, l.length - 1)] || null;
    }
    if (ui.zone === 'fod') {
      // Er knappen væk (Næste på Klar-trinnet), står markøren på Tilbage — aldrig på Forlad.
      const l = fodKnapper();
      return l.find((n) => n.dataset.handling === ui.fod) || l.find((n) => n.dataset.handling === 'tilbage') || l[0] || null;
    }
    if (ui.zone === 'hold') {
      const l = holdKnapper();
      return l.find((n) => +n.dataset.vaelgHold === m?.hold) || l[0] || null;
    }
    return gitterElement();
  }

  /** Giv markøren DOM-fokus, så :focus-visible står på den. Et tekstfelt
   *  uden for skærmen beholder altid sit fokus. rul: hold den i billedet. */
  function fokuser(rul) {
    const a = document.activeElement;
    if (a && !kv.contains(a) && a.matches?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const mk = markoerElement();
    if (!mk) return;
    if (a !== mk) mk.focus({ preventScroll: true });
    if (rul) mk.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /** Naboen over eller under i et gitter, efter hvor felterne faktisk står
   *  (layoutet skifter med skærmen). -1: der er ingen række dér. */
  function naboLodret(felter, i, ned) {
    const r = felter.map((n) => n.getBoundingClientRect());
    const nu = r[i];
    if (!nu) return -1;
    const cx = nu.left + nu.width / 2;
    const kand = r.map((b, j) => ({ b, j })).filter(({ b, j }) => j !== i && b.width > 0
      && (ned ? b.top >= nu.bottom - 2 : b.bottom <= nu.top + 2));
    if (!kand.length) return -1;
    const y = ned ? Math.min(...kand.map((k) => k.b.top)) : Math.max(...kand.map((k) => k.b.top));
    return kand.filter((k) => Math.abs(k.b.top - y) < 6)
      .sort((a, b) => Math.abs(a.b.left + a.b.width / 2 - cx) - Math.abs(b.b.left + b.b.width / 2 - cx))[0].j;
  }

  /* Zonernes rækkefølge oppefra: top, (hold), gitter, fod. */
  const zoner = () => (TRIN[ui.trin] === 'karakterer' ? ['top', 'hold', 'gitter', 'fod'] : ['top', 'gitter', 'fod']);

  /** Én zone op eller ned (rundt med Tab). Har trinnet intet gitter, springes det over. */
  function skiftZone(d, rundt = false) {
    const z = zoner();
    let i = z.indexOf(ui.zone) + d;
    if (rundt) i = (i + z.length) % z.length;
    if (z[i] === 'gitter' && TRIN[ui.trin] === 'regler') ui.regel = d > 0 ? 0 : sidsteRegel();
    if (z[i] === 'gitter' && !gitterElement()) i = rundt ? (i + d + z.length) % z.length : i + d;
    if (i < 0 || i >= z.length) return;
    ui.zone = z[i];
    if (ui.zone === 'fod') ui.fod = 'naeste';
    klik();
  }

  /** Piletaster i et gitter (rosteret, banerne). Kanterne fører videre til næste zone. */
  function flytIGitter(k, felter, nu) {
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      klik();
      return (nu + (k === 'ArrowRight' ? 1 : -1) + felter.length) % felter.length;
    }
    const j = naboLodret(felter, nu, k === 'ArrowDown');
    if (j >= 0) { klik(); return j; }
    skiftZone(k === 'ArrowDown' ? 1 : -1);
    return nu;
  }

  /* ---------------------------------------------------------- taster */

  function tast(e) {
    if (!t) return false;
    // Tastetrykket, der åbnede skærmen (menuNav klikkede, og så boblede det
    // videre hertil): det er ældre end skærmen og må ikke også handle her.
    if (typeof e.timeStamp === 'number' && e.timeStamp > 0 && e.timeStamp < skabt + 1) return true;
    const k = e.code;
    ui.tastatur = true;
    omkamp = -1;
    if (PILE.has(k) || OK.has(k) || k === 'Tab' || k === 'Escape') e.preventDefault?.();
    // Under nedtællingen: kun Esc (annullér).
    if (!el.ned.hidden) {
      if (k === 'Escape') annuller();
      return true;
    }
    if (k === 'Escape') {
      if (ui.trin > 0) gaaTil(naesteTrin(-1));
      return true;
    }
    const trin = TRIN[ui.trin];
    if (k === 'Tab') { skiftZone(e.shiftKey ? -1 : 1, true); tegn(); fokuser(true); return true; }

    // Karakterer: hold og ryd, uanset hvor markøren står.
    if (trin === 'karakterer') {
      if (k === 'KeyQ') { vaelgHold(0); return true; }
      if (k === 'KeyE') { vaelgHold(1); return true; }
      if (k === 'Backspace' || k === 'Delete') { rydValg(); return true; }
    }

    if (ui.zone === 'top' || ui.zone === 'fod') {
      const liste = ui.zone === 'top' ? topKnapper() : fodKnapper();
      const nu = Math.max(0, liste.indexOf(markoerElement()));
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const n = liste[(nu + (k === 'ArrowRight' ? 1 : -1) + liste.length) % liste.length];
        if (ui.zone === 'top') { ui.top = liste.indexOf(n); ui.topNoegle = topNoegle(n); }
        else ui.fod = n?.dataset.handling || 'naeste';
        klik();
      } else if (k === 'ArrowDown' || k === 'ArrowUp') {
        skiftZone(k === 'ArrowDown' ? 1 : -1);
      } else if (OK.has(k)) {
        udfoer(liste[nu]);
        if (ui.tastatur) fokuser(true);
        return true;
      } else return false;
    } else if (ui.zone === 'hold') {
      // ←→ skifter hold, og markøren bliver her; Enter og ↓ går videre.
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const l = holdKnapper();
        const n = k === 'ArrowLeft' ? l[0] : l[l.length - 1];
        if (n) vaelgHold(+n.dataset.vaelgHold);
        return true;
      }
      if (k === 'ArrowUp') skiftZone(-1);
      else if (k === 'ArrowDown') skiftZone(1);
      else if (OK.has(k)) holdVidere();
      else return false;
    } else if (trin === 'karakterer') {
      if (PILE.has(k)) ui.markoer = flytIGitter(k, el.felter, ui.markoer);
      else if (OK.has(k)) { vaelgFelt(ui.markoer); return true; }
      else return false;
    } else if (trin === 'bane') {
      if (PILE.has(k)) ui.bane = flytIGitter(k, el.baneFelter, ui.bane);
      else if (OK.has(k)) { stemPaa(ui.bane); return true; }
      else return false;
    } else if (trin === 'regler') {
      // Her er gitteret rækkerne: ↑↓ vælger regel, ←→ skifter værdi.
      if (k === 'ArrowUp') {
        if (ui.regel > 0) { ui.regel--; klik(); } else skiftZone(-1);
      } else if (k === 'ArrowDown') {
        if (ui.regel < sidsteRegel()) { ui.regel++; klik(); } else skiftZone(1);
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (ui.regel < RUL) skiftRegel(ui.regel, k === 'ArrowRight' ? 1 : -1);
      } else if (OK.has(k)) {
        if (ui.regel === RUL) tilfaeldigeRegler();
        else skiftRegel(ui.regel, 1, true);
      } else return false;
    } else {
      // Klar: Enter skifter; ↑↓ til top- og fodlinjen.
      if (OK.has(k)) skiftKlar();
      else if (k === 'ArrowUp' || k === 'ArrowDown') skiftZone(k === 'ArrowUp' ? -1 : 1);
      else if (!PILE.has(k)) return false;
    }
    tegn();
    fokuser(true);
    return true;
  }

  /* ---------------------------------------------------------- mus */

  kv.addEventListener('click', (e) => {
    ui.tastatur = false;
    omkamp = -1;
    const n = e.target.closest('button');
    if (n) { udfoer(n); return; }
    // Et klik på et holdpanel vælger holdet.
    const panel = e.target.closest('.kv-hold');
    if (panel && TRIN[ui.trin] === 'karakterer' && +panel.dataset.hold !== m?.hold) vaelgHold(+panel.dataset.hold);
  });

  // Musen over et felt flytter markøren (fighteren viser karakteren). Kun
  // når musen faktisk bevæger sig, så en ny tegning under en stille mus ikke
  // rykker markøren.
  kv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || (!e.movementX && !e.movementY)) return;
    const felt = e.target.closest('.kv-felt, .kv-bane');
    if (!felt) return;
    const i = +felt.dataset.i;
    const erBane = felt.classList.contains('kv-bane');
    if ((erBane ? ui.bane : ui.markoer) === i && ui.zone === 'gitter') return;
    ui.tastatur = false;
    if (erBane) ui.bane = i; else ui.markoer = i;
    ui.zone = 'gitter';
    tegn();
  });

  /* ---------------------------------------------------------- udadtil */

  return {
    /** Ny lobbybesked: opdatér på stedet; trin, markør og fokus bliver.
     *  o.trin ('klar' ved Spil igen) går til det trin. */
    opdater(tilstand, o = {}) {
      if (!tilstand) return;
      const foerste = !t;
      t = tilstand;
      afstem();
      if (foerste) {
        ui.kode = t.kode;
        if (gemt && gemt.kode === t.kode) Object.assign(ui, gemt, { tastatur: false });
        gemt = null;
      }
      const oensket = TRIN.indexOf(o?.trin ?? (foerste ? opt.trin : undefined));
      if (oensket >= 0) omkamp = oensket;
      // Ved ét tastatur: er det en anden spillers tur, starter han forfra (startTrin).
      const a = aktoer(t)?.pid ?? null;
      const nyAktoer = ui.aktoer !== undefined && a !== ui.aktoer;
      ui.aktoer = a;
      if (nyAktoer) {
        const v = vaelgerTil(t)?.valg;
        ui.markoer = v != null && feltIndeks(v) >= 0 ? feltIndeks(v) : Math.max(0, FELTER.findIndex((f) => f.aaben));
        ui.bane = 0; ui.regel = 0;
      }
      if (oensket >= 0) gaaTil(oensket, false);
      else if (foerste || nyAktoer) gaaTil(nyAktoer ? startTrin() : ui.trin, false);
      else tegn();
      if ((nyAktoer || oensket >= 0) && ui.tastatur) fokuser(true);
      opdaterNedtaelling();
    },
    tast,
    /** Fejl fra rummet (menu.fejl): står i statuslinjen (#lStatus) et øjeblik. */
    fejl(tekst) { visBesked(tekst, true); },
    /** UI-tilstanden, så trinnet står der igen efter Indstillinger. */
    gem() { return { ...ui }; },
    /** Skærmen forlades (kampstart, Indstillinger, menuen): fighterne og
     *  deres klip ryddes, og ingen klip spiller videre uden for dokumentet. */
    fjern() {
      cancelAnimationFrame(raf); cancelAnimationFrame(planlagt);
      clearTimeout(rouletteTimer); clearTimeout(beskedTimer); clearTimeout(kopiTimer); clearTimeout(ventTimer);
      for (const pid of [...fightere.keys()]) fjernFighter(pid);
      stopAlleKlip();
      if (vedVideoFejl === planlaeg) vedVideoFejl = null;
      ventende = null;
      raf = planlagt = 0; frist = null; t = null;
      kv.remove();
    },
  };
}
