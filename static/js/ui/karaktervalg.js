/* Kundekrigen — karaktervalget: opsætningen før kampen i Tekken-stil.
 *
 * Tre trin i en trinbjælke øverst: Karakterer · Bane · Regler
 * (docs/karaktervalg.md). Én figur pr. spiller: man vælger SIN fighter og
 * SIT hold, blåt (venstre) eller rødt (højre). Begge holds fightere står
 * stort på hver sin side, som i Tekken og Street Fighter: den forreste i
 * bevægelse med et navneskilt, holdkammeraterne bag ham. Holdpanelerne
 * viser holdenes spillere, og rosteret står i midten med holdvalget over
 * sig og Tilfældig ("?") i midten af rækken. Reglerne har den store
 * Start-knap: kampen starter, så snart alle har trykket på den.
 *
 * Trinnet og markøren er UI-tilstand; valg, hold, stemmer og regler er
 * fælles og kommer med lobbybeskeden.
 *
 * GRUPPEN FØLGES AD. Ingen kommer længere end gruppens trin: det første
 * trin, som ikke alle aktive deltagere har gjort (gruppeTrin). Karakterer
 * er gjort med fighter og hold, Bane med en stemme, Regler med Start (klar).
 * Har spilleren gjort sit trin, og kommer gruppen forbi det, går skærmen
 * selv videre efter et kort øjeblik (så man når at se valget); ellers venter
 * han på trinnet: "Venter på Bo …". Skærmen går aldrig selv tilbage: kommer
 * der en ny deltager, bliver de andre, hvor de er, til han har indhentet
 * dem. Man kan selv gå tilbage og ændre et valg; så går skærmen igen videre
 * til det fjerneste trin, gruppen er nået.
 *
 * HOLDET: med højst to aktive spillere giver rummet den, der vælger fighter
 * uden hold, det ledige hold. Skærmen viser det med det samme (et gæt blandt
 * de ventende valg, som rummets svar afløser). Med flere skal man selv
 * vælge hold, før man kan gå videre.
 *
 * ÉT TASTATUR: de lokale spillere handler efter tur inden for hvert trin:
 * den første, der ikke har gjort gruppens trin. På Regler sætter værten
 * (spiller 1) reglerne, og ét tryk på Start gør alle ved tastaturet klar.
 * Et klik på en spiller i toplinjen giver ham turen, så han kan ændre sit.
 * Den, der lige har valgt, beholder turen et øjeblik (overdrag), så et
 * dobbeltklik eller Q/E lige efter valget gælder ham og ikke den næste.
 *
 * TILSKUERE (kom ind midt i en kamp) tæller med på deres egen skærm, så de
 * kommer igennem trinnene selv; for de andre tæller de først efter kampen.
 *
 * Når alle er klar, tæller rummet selv 3-2-1 ned, og skærmen viser
 * nedtællingen og den trukne bane oven på det hele.
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
 * gitter (trinnets indhold: rosteret, banerne, reglerne og Start) og fod
 * (Tilbage, Indstillinger, Forlad, Næste).
 * ↑↓ i kanten af en zone og Tab går til den næste, og markøren tager
 * DOM-fokus med, så :focus-visible står, hvor den er. I holdvalget skifter
 * ←→ hold, og markøren bliver; Enter og ↓ går videre. Mus og taster går
 * gennem samme udfoer(). Tastetrykket, der åbnede skærmen, når også hertil
 * og ignoreres (skabt i lavKaraktervalg).
 */
'use strict';

import { T, esc, opremse, BANE_NAVN, VEJR_NAVN } from './tekst.js';
import { HOLD, HOLD_ORDEN } from '../render/palette.js';
import { ROSTER, rosterFigur, rosterUdseende, BANE_VALG } from '../core/roster.js';
import { VEJRTYPER } from '../sim/turn.js';
import { hentFilmData } from './filmintro.js';
import { indlaesGrafik, tegnFigur } from '../render/figur_view.js';
import * as lyd from './lyd.js';
import { karakterLyd } from './stemmer.js';

export const TRIN = ['karakterer', 'bane', 'regler'];
const SIDSTE = TRIN.length - 1;         // Regler, hvor Start står
/** Trinnet efter navn. 'klar' (det gamle fjerde trin) er Regler, hvor Start står nu. */
const trinIndeks = (navn) => TRIN.indexOf(navn === 'klar' ? 'regler' : navn);
const MAPPE = '/grafik/intro/';
const MAKS_LOKALE = 8;
/** Så længe står et gjort trin, før skærmen selv går videre (valget skal ses). */
const VIDERE_MS = 900;

/* Rosterets felter: de ansatte, der kan vælges eller vises som utilgængelige
 * (core/roster.js status) — de låste ("Kommer snart") vises slet ikke — med
 * Tilfældig i midten, som "?" i et fightingspil. Felterne står i DOM'en i
 * denne rækkefølge, og ←→ går gennem den, så det, man ser, og tasterne passer. */
const feltAf = (r) => ({ figur: r.figur, navn: r.navn, rolle: r.rolle, klinik: r.klinik, aaben: r.aaben, status: r.status });
const VISTE = ROSTER.filter((r) => r.status !== 'laast');
const MIDTEN = Math.ceil(VISTE.length / 2);
const FELTER = [
  ...VISTE.slice(0, MIDTEN).map(feltAf),
  { figur: 'tilfaeldig', navn: T.kv.tilfaeldig, rolle: T.kv.tilfaeldigRolle, klinik: null, aaben: true, status: 'aaben' },
  ...VISTE.slice(MIDTEN).map(feltAf),
];
/** Banneret over en karakter, der ikke kan vælges: "Utilgængelig" eller "Kommer snart". */
const spaerretTekst = (r) => (r?.status === 'utilgaengelig' ? T.kv.utilgaengelig : T.kv.kommerSnart);
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
const RUL = REGLER.length;               // rækken efter reglerne: 🎲 Tilfældige regler (kun værten)
const START = RUL + 1;                   // og til sidst den store Start-knap (alle)

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
 * HVEM HANDLER, hvor langt hver er nået, og hvad aktøren vælger til. Resten
 * af skærmen spørger kun her og sender handlinger med vaelgerTil's som.
 * Skifter modellen, rettes kun denne blok.
 *
 * Et trin er gjort: Karakterer med fighter OG hold, Bane med en stemme,
 * Regler med Start (klar). Klar tæller som alle tre: han har trykket Start
 * (eller Spil igen), og rummet starter, når alle er klar. Gruppens trin er
 * det første, som ikke alle aktive deltagere (ikke tilskuere, tilsluttede)
 * har gjort; ingen går videre end det.
 *
 * Over nettet handler jeg selv (t.dig). Ved ét tastatur (t.kode == null)
 * handler den første lokale spiller, der ikke har gjort gruppens trin; på
 * Regler værten (spiller 1), som sætter reglerne og trykker Start for alle.
 * tur er en lokal spiller, der har fået turen med et klik (se ui.tur).
 */

const lokale = (t) => t.deltagere.filter((d) => d.lokal);
const harHold = (d) => d?.hold === 0 || d?.hold === 1;
const aktiveAf = (deltagere) => deltagere.filter((d) => !d.tilskuer && d.forbundet !== false);

/** Hvor mange af trinnene deltageren har gjort, i rækkefølge: 0–3. */
export function faerdigeTrin(d) {
  if (!d) return 0;
  if (d.klar) return TRIN.length;
  if (d.valg == null || !harHold(d)) return 0;
  return d.stemme == null ? 1 : 2;
}

/** Gruppens trin (0–2): det første trin, som ikke alle aktive har gjort. */
export function gruppeTrin(deltagere) {
  const a = aktiveAf(deltagere);
  return a.length ? Math.min(SIDSTE, ...a.map(faerdigeTrin)) : SIDSTE;
}

/** Aktøren: deltageren, der sidder ved skærmen nu. */
export function aktoer(t, tur = null) {
  if (t.kode == null) {
    const l = lokale(t);
    if (l.length) {
      const valgt = tur != null ? l.find((d) => d.pid === tur) : null;
      if (valgt) return valgt;
      const g = gruppeTrin(t.deltagere);
      if (g === SIDSTE) return l[0];
      return l.find((d) => faerdigeTrin(d) <= g) || l[0];
    }
  }
  return t.deltagere.find((d) => d.pid === t.dig) || null;
}

/**
 * Det, aktøren vælger til: { pid, navn, hold, valg, stemme, klar, plads,
 * som, lokalNr }. plads er hans plads i hold[].baevere (med fighterens navn
 * og romertal), som er det, api'et skal have med (kun lokalt), og lokalNr
 * hans nummer blandt de lokale spillere (-1 over nettet).
 */
export function vaelgerTil(t, tur = null) {
  const a = aktoer(t, tur);
  if (!a) return null;
  const hold = harHold(a) ? a.hold : null;
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
    if (r.status !== 'laast' && (d?.valg_video || d?.valg_video_safari) && !videoer.has(r.figur)) lavVideo(r.figur).load();
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
 * spilleren kommer tilbage fra dem. opt.trin ('regler' ved Spil igen; 'klar'
 * er det samme) er trinnet, skærmen åbner på, højst gruppens trin.
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
    bagud: false,            // selv gået tilbage for at se eller ændre: skærmen går ikke selv videre
    tur: null,               // ét tastatur: den lokale spiller, der har fået turen med et klik
    turValgt: false,         // han har valgt noget, siden han fik den
    zone: 'gitter',          // hvor markøren står: top | hold | gitter | fod
    top: 0,                  // indeks i toplinjen (bruges, når knappen i topNoegle er væk)
    topNoegle: null,         // toplinjens knap efter det, den gør (se topNoegle())
    fod: 'naeste',           // fodlinjens knap (data-handling)
    markoer: Math.max(0, FELTER.findIndex((f) => f.aaben)),
    bane: 0,
    regel: START,
    tastatur: false,         // sidste handling kom fra tastaturet (så følger fokus og rul med)
  };
  let gemt = opt.gemt || null;
  let t = null;
  let m = null;              // vaelgerTil(t) med aktørens ventende valg (aktuel())
  let hv = [];               // holdVisning(t)
  let besked = null;         // { tekst, til, advarsel } — fejl og afvisninger i statuslinjen
  let beskedTimer = 0, kopiTimer = 0, rouletteTimer = 0, raf = 0, planlagt = 0;
  let frist = null, visTal = 0, trukket;
  let reglerNoegle = '';
  // Automatisk videre: timeren løber, mens det gjorte trin ses (VIDERE_MS);
  // videreKlar, når den er løbet ud, og skærmen kun venter på rummets svar.
  let videreTimer = 0, videreKlar = false;
  let flyttet = false;       // trinnet eller aktøren er skiftet: markøren får fokus efter tegningen
  /* Mine valg, som rummet ikke har bekræftet endnu: { pid, til, valg?, hold?,
   * stemme?, gaetHold? }. Over nettet går der et øjeblik, før lobbybeskeden
   * viser dem; så længe viser skærmen dem, som om de var bekræftet. gaetHold:
   * holdet er rummets automatiske hold, som skærmen gætter på. */
  let ventende = null, ventTimer = 0;
  // Et valg, rummet ikke svarede på inden VENT_MS: lobbyen, skærmen har, er
  // ældre end valget, så den fører ikke videre (foelg), før der kommer en ny.
  let forsinket = false;
  /* Ét tastatur: den lokale spiller, der lige har valgt, beholder turen et
   * øjeblik (VIDERE_MS, forfra ved hvert nyt valg). Så gælder et dobbeltklik,
   * to hurtige Enter og Q/E lige efter valget ham og ikke den næste, og
   * pausen viser hans valg. Flytter hans valg gruppen videre, beholder han
   * turen, til skærmen går videre (foelg). */
  let overdrag = null, overdragTimer = 0;
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
          <p class="kv-venter" hidden></p>
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
        <div class="kv-aktoer"></div>
        <div class="kv-baner" role="group" aria-label="${esc(T.kv.trin[1])}"></div>
        <p class="kv-venter" hidden></p>
        <p class="kv-note">${esc(T.kv.baneNote)}</p>
      </section>

      <section class="kv-skaerm kv-regelvalg" data-trin="regler" hidden>
        <h2 class="kv-overskrift">${esc(T.kv.reglerTitel)}</h2>
        <p class="kv-note kv-regler-hvem"></p>
        <div class="kv-regler"></div>
        <p class="kv-note kv-regler-note">${esc(T.kv.reglerNote)}</p>
        <div class="kv-start-boks">
          <button type="button" class="btn pri stor kv-start-knap" data-handling="start"></button>
          <p class="kv-venter" hidden></p>
          <p class="kv-note kv-start-note">${esc(T.kv.startNote)}</p>
          <ul class="kv-start-deltagere" aria-label="${esc(T.lobby.deltagere)}"></ul>
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
      <div class="kv-fighter-banner" aria-hidden="true"></div>
      <div class="kv-navneskilt">
        <span class="kv-navneskilt-klinik"></span>
        <span class="kv-navneskilt-navn"></span>
        <span class="kv-navneskilt-rolle"></span>
        <span class="kv-navneskilt-spiller"></span>
      </div>`;
    const s = (k) => n.querySelector(`.kv-navneskilt-${k}`);
    x = { n, f: lavFighter(n, planlaeg), banner: n.querySelector('.kv-fighter-banner'),
          skilt: { klinik: s('klinik'), navn: s('navn'), rolle: s('rolle'), spiller: s('spiller') } };
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
    midt: $('.kv-midt'),
    skaerme: [...kv.querySelectorAll('.kv-skaerm')],
    karakterer: $('.kv-karakterer'),
    sider: { venstre: $('.kv-side[data-side=venstre]'), hoejre: $('.kv-side[data-side=hoejre]') },
    aktoerer: [...kv.querySelectorAll('.kv-aktoer')], midtPlads: $('.kv-fighter-plads[data-side=midt]'),
    venter: [...kv.querySelectorAll('.kv-venter')],
    holdvalg: $('.kv-holdvalg'), rooster: $('.kv-rooster'), roosterNote: $('.kv-rooster-note'),
    udenHold: $('.kv-uden-hold'),
    baner: $('.kv-baner'),
    reglerHvem: $('.kv-regler-hvem'), regler: $('.kv-regler'),
    startBoks: $('.kv-start-boks'), startKnap: $('.kv-start-knap'), startDeltagere: $('.kv-start-deltagere'),
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
            ${f.klinik ? `data-klinik="${esc(f.klinik)}"` : ''} data-aaben="${f.aaben ? 1 : 0}" data-status="${f.status}">
      <span class="kv-felt-portraet"></span>
      <span class="kv-felt-navn">${esc(f.navn)}</span>
      <span class="kv-felt-rolle">${esc(f.aaben || f.status === 'utilgaengelig' ? f.rolle : T.kv.kommerSnart)}</span>
      ${f.aaben ? '' : `<span class="kv-felt-laas">${esc(spaerretTekst(f))}</span>`}
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

  /** Et valg er sendt til rummet: vis det med det samme (felt: valg, hold
   *  eller stemme). gaet: holdet er rummets automatiske hold, ikke sendt. */
  function husk(felt, v, gaet = false) {
    if (!m) return;
    if (!ventende || ventende.pid !== m.pid) ventende = { pid: m.pid };
    ventende[felt] = v;
    if (felt === 'hold') ventende.gaetHold = gaet;
    ventende.til = performance.now() + VENT_MS;
    clearTimeout(ventTimer);
    // Svarer rummet ikke (eller afviser), står rummets tilstand der igen, men
    // den er ældre end valget: skærmen går ikke videre på den (forsinket).
    ventTimer = setTimeout(() => { ventende = null; forsinket = true; planlaeg(); }, VENT_MS + 20);
    m = aktuel();
  }

  /** Ny lobbybesked: det, den viser, venter ikke længere. Et gættet hold
   *  afløses af rummets, så snart rummet har set fighteren: det var i samme
   *  besked, rummet gav (eller ikke gav) holdet. */
  function afstem() {
    if (!ventende) return;
    const d = t.deltagere.find((x) => x.pid === ventende.pid);
    if (d) for (const k of VALGFELTER) if (k in ventende && (d[k] ?? null) === ventende[k]) delete ventende[k];
    if (ventende.gaetHold && !('valg' in ventende)) delete ventende.hold;
    if (!('hold' in ventende)) delete ventende.gaetHold;
    if (!d || !VALGFELTER.some((k) => k in ventende)) { ventende = null; clearTimeout(ventTimer); }
  }

  /** Holdet, rummet giver aktøren, når han vælger fighter uden hold: med
   *  højst to aktive spillere (ham selv medregnet) det med færrest spillere,
   *  blåt ved lige; ellers null (så vælger han selv). Som _ledigt_hold i
   *  rum.py: holdene tælles som til nedtællingens holdregel, så en afbrudt
   *  spiller, der stadig står på sit hold, tæller med. */
  function ledigtHold() {
    if (!m || m.hold != null) return null;
    const mig = deltager(m.pid);
    if (mig?.tilskuer && t.fase === 'i_gang') return null;
    if (aktive().filter((d) => d.pid !== m.pid).length + 1 > 2) return null;
    const paaHold = t.deltagere.filter((d) => d.pid !== m.pid && !d.tilskuer);
    const antal = [0, 1].map((hi) => paaHold.filter((d) => d.hold === hi).length);
    return antal[1] < antal[0] ? 1 : 0;
  }

  /** vaelgerTil(t) med aktørens ventende valg. plads er kun rummets egen,
   *  når den stadig passer (ellers null). Et ventende valg gør ham ikke
   *  længere klar, som i rummet: ellers talte en gammel klar stadig som alle
   *  tre trin, og skærmen gik videre, mens han lige havde ryddet sin fighter. */
  function aktuel() {
    const a = vaelgerTil(t, turPid());
    if (!a || !venter(a.pid)) return a;
    const b = { ...a };
    let valgt = false;
    for (const k of VALGFELTER) if (k in ventende) { b[k] = ventende[k]; valgt = true; }
    if (valgt) b.klar = false;
    if (b.hold !== a.hold || b.valg !== a.valg) b.plads = null;
    return b;
  }

  /** En deltager, som skærmen viser ham: aktøren med sine ventende valg. */
  const nu = (d) => (d && m && d.pid === m.pid ? { ...d, hold: m.hold, valg: m.valg, stemme: m.stemme, klar: m.klar } : d);
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
  const kanRedigereRegler = () => erVaert();
  /** Regeltrinnets første række: reglerne for værten, ellers kun Start. */
  const foersteRegel = () => (kanRedigereRegler() ? 0 : START);
  const deltager = (pid) => t.deltagere.find((d) => d.pid === pid) || null;
  const aktive = () => aktiveAf(t.deltagere);

  /** Ét tastatur: den, der har turen: en, der har fået den med et klik, ellers
   *  den, der lige har valgt og beholder den et øjeblik (overdrag). */
  const turPid = () => ui.tur ?? overdrag;

  /** Deltagerne til gruppens trin. Er aktøren selv tilskuer (han kom ind midt
   *  i en kamp), tæller han med for sig selv: så åbner skærmen på hans eget
   *  trin, og han kommer ikke videre end det, han selv har gjort. For de
   *  andre er han stadig ikke med, før kampen er slut. */
  const medMig = (liste) => liste.map((d) => (d.pid === m?.pid && d.tilskuer ? { ...d, tilskuer: false } : d));
  /** Gruppens trin, som skærmen viser det: med aktørens ventende valg. */
  const gruppe = () => gruppeTrin(medMig(deltagereNu()));
  /** Gruppens trin efter rummets seneste lobby (uden ventende valg). */
  const bekraeftetGruppe = () => gruppeTrin(medMig(t.deltagere));
  /**
   * Gruppens trin, som man må GÅ til: som gruppe(), men et hold, skærmen kun
   * gætter på (rummets automatiske hold, ventende.gaetHold), tæller ikke.
   * Kun et hold, rummet har bekræftet, eller som han selv har valgt, fører
   * ham fra Karakterer (så kommer han videre af sig selv, når svaret kommer).
   */
  function gruppeFrem() {
    if (!m || !ventende?.gaetHold || !venter(m.pid)) return gruppe();
    const bekr = deltager(m.pid)?.hold ?? null;
    return gruppeTrin(medMig(deltagereNu().map((d) => (d.pid === m.pid ? { ...d, hold: bekr } : d))));
  }
  /** Har aktøren gjort trin i (med sine ventende valg)? */
  const faerdig = (i) => faerdigeTrin(m) > i;
  /** Må aktøren gå til trin i? Tilbage altid; frem højst til gruppens trin. */
  const tilladt = (i, G = gruppeFrem()) => i <= Math.max(G, ui.trin);
  /** Kan han gå ét trin frem herfra? */
  const kanFrem = () => ui.trin < SIDSTE && ui.trin + 1 <= gruppeFrem();
  /** Står han som tilskuer i en kamp, der er i gang (han er med i den næste)? */
  const tilskuerIKamp = () => !!m && t.fase === 'i_gang' && !!deltager(m.pid)?.tilskuer;

  /** De aktive, der ikke har gjort trin i endnu (aktøren selv ikke med): dem, han venter på. */
  const blokkere = (i) => aktive().map(nu).filter((d) => d.pid !== m?.pid && faerdigeTrin(d) <= i);

  /** Start-knappens tilstand: over nettet er jeg klar; ved ét tastatur er alle ved tastaturet. */
  function startKlar() {
    if (!erNet()) { const l = lokale(t); return l.length > 0 && l.every((d) => d.klar); }
    return !!m?.klar;
  }
  /** Dem, Annullér og Ikke klar tager ud igen: mig, eller alle klare ved tastaturet (som-pid'er). */
  function mineKlare() {
    if (!erNet()) return lokale(t).filter((d) => d.klar).map((d) => d.pid);
    return m?.klar ? [m.som] : [];
  }

  /** Hvad aktøren mangler for at have gjort trin i (en besked), eller ''. */
  function mangler(i) {
    if (!m || faerdig(i)) return '';
    if (i === 0) return m.valg == null ? T.kv.vaelgFighterFoerst : T.kv.vaelgHoldFoerst;
    if (i === 1) return T.kv.stemFoerst;
    return '';
  }

  /** Hvorfor trin i ikke kan nås endnu: det, aktøren selv mangler, ellers dem, han venter på. */
  function spaerret(i) {
    for (let j = 0; j < i; j++) { const s = mangler(j); if (s) return s; }
    const b = blokkere(i - 1);
    return b.length ? T.kv.venterPaa(b.map((d) => d.navn)) : '';
  }

  /** Mangler aktøren noget på et trin FØR det, han står på? { tekst, trin }
   *  eller null. Det sker kun, når rummets svar siger noget andet end det,
   *  skærmen troede (intet automatisk hold alligevel, et sent svar): så står
   *  det i ventelinjen og statuslinjen i stedet for trinnets eget. */
  function manglerFoer() {
    for (let j = 0; j < ui.trin; j++) { const s = mangler(j); if (s) return { tekst: s, trin: j }; }
    return null;
  }

  /** Ét tastatur: den, der får turen, når aktøren slipper den (overdrag), eller null. */
  function naesteTur() {
    if (erNet() || overdrag == null || ui.tur != null || !m) return null;
    const n = aktoer(t, null);
    return n && n.pid !== m.pid ? n : null;
  }

  /** Ét tastatur: aktøren har valgt og beholder turen i VIDERE_MS (forfra ved
   *  hvert valg). Når tiden er gået, får den næste turen, medmindre skærmen
   *  selv er på vej videre af hans valg: så slipper foelg() den. På Regler
   *  handler værten for alle, så dér er der ingen tur at overdrage. */
  function holdTur() {
    if (erNet() || !m || ui.trin >= SIDSTE) return;
    overdrag = m.pid;
    clearTimeout(overdragTimer);
    overdragTimer = setTimeout(() => {
      overdragTimer = 0;
      if (t && !ui.bagud && t.nedtaelling_ms == null && bekraeftetGruppe() > ui.trin) return;
      slipTur();
    }, VIDERE_MS);
  }

  function slipTur(tegnOm = true) {
    clearTimeout(overdragTimer);
    overdragTimer = 0;
    if (overdrag == null) return;
    overdrag = null;
    if (tegnOm) planlaeg();
  }

  /* ---------------------------------------------------------- tegning */

  function planlaeg() {
    if (planlagt || !t) return;
    planlagt = requestAnimationFrame(() => { planlagt = 0; tegn(); });
  }

  function tegn() {
    if (!t) return;
    const havdeFokus = kv.contains(document.activeElement);
    tjekAktoer();
    m = aktuel();
    foelg();                            // videre til gruppens trin
    tjekAktoer();                       // ved ét tastatur kan turen skifte med (eller er sluppet)
    m = aktuel();
    const trin = TRIN[ui.trin];
    const G = gruppe();
    const Gf = gruppeFrem();            // det, man må gå til (uden et gættet hold)
    const s = venteTilstand(G);
    hv = holdVisning(t);
    kv.dataset.trin = trin;
    kv.dataset.gruppe = TRIN[G];
    kv.dataset.zone = ui.zone;
    kv.dataset.net = erNet() ? '1' : '0';
    kv.dataset.vaert = erVaert() ? '1' : '0';
    kv.dataset.klar = startKlar() ? '1' : '0';
    kv.dataset.venter = s.tilstand === 'venter' || s.tilstand === 'hold' ? '1' : '0';
    kv.dataset.videre = s.tilstand === 'videre' ? '1' : '0';
    el.skaerme.forEach((n) => { n.hidden = n.dataset.trin !== trin; });
    for (const x of fightere.values()) x.f.aktiv(trin === 'karakterer');

    tegnTop(G, Gf, s);
    if (trin === 'karakterer') tegnKarakterer();
    else if (trin === 'bane') tegnBaner();
    else tegnRegler(s);
    tegnVenter(s, G);
    tegnFod(G, Gf, s);

    // Markøren i top-, hold- og fodlinjen (gitterets markør sætter trinnet selv).
    const mk = ui.zone === 'gitter' ? null : markoerElement();
    // Toplinjen: huskes efter det, knappen gør; er den væk, står markøren på
    // knappen på samme plads, og den huskes så i stedet.
    if (ui.zone === 'top' && mk) { ui.top = topKnapper().indexOf(mk); ui.topNoegle = topNoegle(mk); }
    for (const n of kv.querySelectorAll('.kv-top button, .kv-fod button, .kv-holdknap')) n.classList.toggle('fokus', n === mk);

    // Nyt trin eller ny aktør: markøren får fokus (rul kun med tastaturet).
    // Er det fokuserede element skrevet om, får markøren også fokus igen.
    if (flyttet) {
      flyttet = false;
      if (ui.tastatur || havdeFokus) fokuser(ui.tastatur);
    } else if (havdeFokus && !kv.contains(document.activeElement)) fokuser(false);
  }

  /* ---- gruppen følges ad */

  /** Ved ét tastatur: er det en anden spillers tur, starter han på gruppens
   *  trin (eller bliver her, hvis det er før), med markøren på sine egne valg. */
  function tjekAktoer() {
    if (ui.tur != null && (erNet() || !lokale(t).some((d) => d.pid === ui.tur))) { ui.tur = null; ui.turValgt = false; }
    if (overdrag != null && (erNet() || !lokale(t).some((d) => d.pid === overdrag))) slipTur(false);
    // Den, der fik turen, har valgt og gjort trinnet, og gruppen går ikke
    // videre af det: turen går tilbage til den, hvis tur det er (efter
    // overdragelsens øjeblik, se holdTur).
    if (ui.tur != null && ui.turValgt) {
      const d = deltager(ui.tur);
      if (faerdigeTrin(d) > ui.trin && gruppeTrin(t.deltagere) <= ui.trin) { ui.tur = null; ui.turValgt = false; }
    }
    const a = aktoer(t, turPid())?.pid ?? null;
    const ny = ui.aktoer !== undefined && a !== ui.aktoer;
    ui.aktoer = a;
    if (!ny) return;
    const v = vaelgerTil(t, turPid());
    ui.markoer = v?.valg != null && feltIndeks(v.valg) >= 0 ? feltIndeks(v.valg) : Math.max(0, FELTER.findIndex((f) => f.aaben));
    ui.bane = v?.stemme ? Math.max(0, BANE_VALG.indexOf(v.stemme)) : 0;
    m = aktuel();
    saetTrin(Math.min(ui.trin, gruppe()), ui.bagud ? 'tilbage' : 'frem');
    flyttet = true;
  }

  /**
   * Automatisk videre. Har aktøren gjort sit trin, og er gruppen forbi det
   * (og han ikke selv er gået tilbage for at kigge), går skærmen til
   * gruppens trin: først efter VIDERE_MS, så valget ses, og først når rummet
   * har bekræftet det (ikke kun på et ventende valg eller et gættet hold).
   * Efter et valg, rummet ikke svarede på i tide (forsinket), går den ikke
   * videre på den gamle lobby, men venter på den næste. Skærmen går aldrig
   * selv tilbage. Sand, når den gik videre.
   */
  function foelg() {
    const skal = !!m && !ui.bagud && !forsinket && t.nedtaelling_ms == null && gruppe() > ui.trin;
    if (!skal) {
      stopVidere();
      // Turen, overdragelsen holdt til skærmen gik videre: den går ikke videre alligevel.
      if (overdrag != null && !overdragTimer) slipTur(false);
      return false;
    }
    if (!videreTimer && !videreKlar) {
      videreTimer = setTimeout(() => { videreTimer = 0; videreKlar = true; planlaeg(); }, VIDERE_MS);
    }
    if (!videreKlar) return false;
    const bekraeftet = bekraeftetGruppe();
    if (bekraeftet <= ui.trin) return false;      // venter på rummets svar
    ui.tur = null; ui.turValgt = false;            // turen, han fik med et klik, slutter her
    slipTur(false);                                // og den, han beholdt efter sit valg
    saetTrin(bekraeftet, 'frem');
    flyttet = true;
    return true;
  }

  function stopVidere() {
    clearTimeout(videreTimer);
    videreTimer = 0;
    videreKlar = false;
  }

  /**
   * Hvad aktøren venter på, efter trinnet her: { tilstand, blok }.
   * tilstand: 'videre' (alle har gjort trinnet, skærmen går videre), 'venter'
   * (han har gjort det, blok er dem, han venter på), 'hold' (alle har trykket
   * Start, men et hold er tomt), 'mangler' (han står et trin længere fremme
   * end det, han har gjort: mangel er { tekst, trin }, se manglerFoer), eller
   * '' (han skal selv handle, eller er gået tilbage for at ændre noget).
   * Ved ét tastatur under overdragelsen er tur den, der får turen.
   */
  function venteTilstand(G) {
    if (!m || t.nedtaelling_ms != null) return { tilstand: '', blok: [] };
    const mangel = manglerFoer();
    if (mangel) return { tilstand: 'mangler', blok: [], mangel };
    if (videreTimer || videreKlar) return { tilstand: 'videre', blok: [] };
    const tur = naesteTur();
    if (tur) return { tilstand: '', blok: [], tur };
    if (tilskuerIKamp()) return { tilstand: '', blok: [] };
    if (!faerdig(ui.trin) || ui.trin < G) return { tilstand: '', blok: [] };
    const blok = blokkere(ui.trin);
    if (blok.length) return { tilstand: 'venter', blok };
    return { tilstand: ui.trin === SIDSTE && startKlar() ? 'hold' : '', blok };
  }

  function tegnTop(G, Gf, s) {
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

    saetHtml(el.trin, T.kv.trin.map((navn, i) => `
      <button type="button" class="kv-trin-knap" data-trin-knap="${i}" data-trin="${TRIN[i]}"
              ${i === ui.trin ? 'aria-current="step"' : ''} data-faerdig="${faerdig(i) ? 1 : 0}"
              data-tilladt="${tilladt(i, Gf) ? 1 : 0}" ${tilladt(i, Gf) ? '' : 'aria-disabled="true"'}
              ${i === G ? 'data-gruppe="1"' : ''}>
        <span class="kv-trin-nr">${i + 1}</span><span class="kv-trin-navn">${esc(navn)}</span>
      </button>`).join('<span class="kv-trin-skille" aria-hidden="true">·</span>'));

    saetHtml(el.deltagere, deltagerListe(true, s.blok));
  }

  /** Deltagerne med flueben og hvor langt de er nået. Ved ét tastatur
   *  (knapper) giver et klik på en spiller ham turen, de ekstra spillere kan
   *  fjernes, og der kan komme flere. blok: dem, aktøren venter på. */
  function deltagerListe(knapper, blok = []) {
    const lok = erNet() ? [] : lokale(t).map((d) => d.pid);
    const nedtaelling = t.nedtaelling_ms != null;
    const linjer = deltagereNu().map((d) => {
      const hold = harHold(d) ? hv[d.hold] : null;
      const nr = lok.indexOf(d.pid);
      const indhold = `
        <span class="kv-deltager-klar" aria-hidden="true">${d.klar ? '✓' : ''}</span>
        <span class="kv-deltager-navn">${esc(d.navn)}</span>`;
      const hoved = knapper && nr >= 0
        ? `<button type="button" class="kv-deltager-knap" data-tur="${esc(d.pid)}"
             ${d.pid === m?.pid || nedtaelling ? 'disabled' : ''} title="${esc(T.kv.givTur(d.navn))}">${indhold}</button>`
        : indhold;
      const fjern = knapper && nr >= 2
        ? `<button type="button" class="kv-deltager-fjern" data-fjern="${esc(d.pid)}"
             aria-label="${esc(T.kv.fjernSpiller(d.navn))}" title="${esc(T.kv.fjernSpiller(d.navn))}">×</button>`
        : '';
      return `<li class="kv-deltager" data-pid="${esc(d.pid)}" data-klar="${d.klar ? 1 : 0}"
          data-mig="${d.pid === m?.pid ? 1 : 0}" data-vaert="${d.pid === vaertPid(t) ? 1 : 0}"
          data-tilskuer="${d.tilskuer ? 1 : 0}" data-forbundet="${d.forbundet === false ? 0 : 1}"
          data-fremskridt="${faerdigeTrin(d)}" data-mangler="${blok.some((b) => b.pid === d.pid) ? 1 : 0}"
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

    tegnAktoer(T.kv.vaelger);
    tegnFightere();

    // Holdvalget: blåt eller rødt, som en vippeknap over rosteret.
    saetHtml(el.holdvalg, hv.map((v, i) => `${i ? '<span class="kv-holdvalg-vs" aria-hidden="true">VS</span>' : ''}
      <button type="button" class="kv-holdknap" role="radio" data-vaelg-hold="${v.hi}" data-klinik="${v.farve}"
              data-side="${v.side}" style="${farveStil(v)}" aria-checked="${m?.hold === v.hi}">
        <span class="kv-holdknap-farve">${esc(v.kort)}</span>
        <span class="kv-holdknap-navn">${esc(v.navn)}</span>
      </button>`).join(''));

    // Uden hold kan han ikke gå videre (med flere end to spillere giver
    // rummet ikke et hold): det står her, i statuslinjen og på Næste.
    const note = !m ? '' : m.klar ? T.kv.klarAendr
      : m.hold == null && m.valg != null ? T.kv.vaelgHold
        : faerdig(0) ? T.kv.alleValgt : '';
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
      saetAttr(n, 'aria-disabled', !f.aaben ? 'true' : null);
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
  function tegnFighter({ n, f, skilt, banner }, pid, nr, hi) {
    const v = hi != null ? hv[hi] : null;
    const d = nu(deltager(pid));
    const plads = hi != null ? pladserFor(hi).find((b) => b.ejer === pid) || null : null;
    const mig = pid === m?.pid;
    const eget = mig ? m.valg : pladsValg(plads, d);
    const kigger = mig && ui.zone === 'gitter' && TRIN[ui.trin] === 'karakterer';
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
    saetAttr(n, 'data-status', r ? r.status : 'aaben');
    saetTekst(banner, r && !r.aaben ? spaerretTekst(r) : '');
    saetAttr(n, 'data-forhaand', forhaand ? '1' : '0');
    // Navneskiltet: rummets navn på pladsen (med romertal), når det er hans fighter.
    const navn = !forhaand && plads?.navn && pladsValg(plads, d) === figur ? plads.navn : figurNavn(figur);
    saetTekst(skilt.klinik, v ? v.navn : T.kv.holdValg);
    saetTekst(skilt.navn, navn || T.kv.intetValg);
    saetTekst(skilt.rolle, figur === 'tilfaeldig' ? T.kv.tilfaeldigRolle : r ? (r.status === 'laast' ? T.kv.kommerSnart : r.rolle) : '');
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
    tegnAktoer(T.kv.stemmerNu);
    const alle = deltagereNu();
    el.baneFelter.forEach((n, i) => {
      const b = BANE_VALG[i];
      const stemmer = alle.filter((d) => d.stemme === b);
      n.classList.toggle('markoer', i === ui.bane);
      n.classList.toggle('min-stemme', m?.stemme === b);
      saetAttr(n, 'data-stemmer', stemmer.length);
      saetAttr(n, 'aria-pressed', m?.stemme === b ? 'true' : 'false');
      saetHtml(n.querySelector('.kv-bane-antal'), stemmer.length ? esc(T.kv.stemmer(stemmer.length)) : '');
      saetHtml(n.querySelector('.kv-bane-stemmer'), stemmer.map((d) => `
        <i class="kv-stemme${d.pid === m?.pid ? ' mit' : ''}" data-pid="${esc(d.pid)}" title="${esc(d.navn)}">${esc(initialer(d.navn))}</i>`).join(''));
    });
  }

  /* ---- trin 3: regler og Start */

  function tegnRegler(s) {
    const kan = kanRedigereRegler();
    const vaert = deltager(vaertPid(t));
    el.reglerHvem.textContent = erVaert() ? T.kv.reglerVaert
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

    // Start: det gamle Klar. Trykket igen er man ikke længere klar.
    const klar = startKlar();
    saetTekst(el.startKnap, klar ? T.kv.ikkeKlar : T.kv.start);
    saetAttr(el.startKnap, 'data-klar', klar ? '1' : '0');
    saetAttr(el.startKnap, 'aria-pressed', klar ? 'true' : 'false');
    saetAttr(el.startBoks, 'data-klar', klar ? '1' : '0');
    el.startKnap.classList.toggle('fokus', ui.zone === 'gitter' && ui.regel === START);
    saetHtml(el.startDeltagere, deltagerListe(false, s.blok));
  }

  /** Ved ét tastatur: hvem handler på trinnet nu? (tekst: T.kv.vaelger eller
   *  stemmerNu). Mens den, der lige har valgt, beholder turen et øjeblik,
   *  står der, hvis tur det bliver ("Spiller 2s tur …"). */
  function tegnAktoer(tekst) {
    const vis = !erNet() && m && !videreTimer && !videreKlar;
    const tur = vis ? naesteTur() : null;
    const html = !vis ? '' : tur ? `<b>${esc(T.kv.turTil(tur.navn))}</b>` : `<b>${esc(tekst(m.navn))}</b>`;
    for (const n of el.aktoerer) {
      saetHtml(n, html);
      saetAttr(n, 'data-overdrag', tur ? '1' : null);
    }
  }

  /** Ventelinjen på trinnet (.kv-venter): hvem aktøren venter på, eller at skærmen går videre. */
  function tegnVenter(s, G) {
    let html = '';
    if (s.tilstand === 'videre') {
      html = `<span class="kv-venter-lbl">${esc(T.kv.videreTil)}</span> <b class="kv-venter-trin">${esc(T.kv.trin[G])}</b> …`;
    } else if (s.tilstand === 'venter') {
      html = `<span class="kv-venter-lbl">${esc(T.kv.venterLbl)}</span> ${opremse(s.blok.map((d) => {
        const v = harHold(d) ? hv[d.hold] : null;
        return `<b class="kv-venter-navn" data-pid="${esc(d.pid)}" data-klinik="${v ? v.farve : 'ingen'}"${v ? ` style="${farveStil(v)}"` : ''}>${esc(d.navn)}</b>`;
      }))} …`;
    } else if (s.tilstand === 'hold') {
      html = `<span class="kv-venter-lbl">${esc(holdTekst())}</span>`;
    } else if (s.tilstand === 'mangler') {
      html = `<span class="kv-venter-lbl">${esc(s.mangel.tekst)}</span> <b class="kv-venter-trin">${esc(T.kv.tilbageTil(T.kv.trin[s.mangel.trin]))}</b>`;
    }
    const trin = TRIN[ui.trin];
    for (const n of el.venter) {
      const her = n.closest('.kv-skaerm')?.dataset.trin === trin;
      saetHtml(n, her ? html : '');
      n.hidden = !her || !html;
      saetAttr(n, 'data-tilstand', her && html ? s.tilstand : null);
    }
  }

  /** Alle har trykket Start, men rummet tæller ikke ned: alene i rummet, eller et tomt hold. */
  const holdTekst = () => (aktive().length < 2 ? T.kv.venterModstander
    : t.hold.some((h) => !h.baevere.length) ? T.kv.toHold : T.kv.alleKlar);

  /* ---- fod og status */

  function tegnFod(G, Gf, s) {
    const sidste = ui.trin === SIDSTE;
    el.tilbage.disabled = ui.trin === 0;
    el.naeste.hidden = sidste;
    // Næste når kun til gruppens trin. Står den stille, siger et tryk hvorfor.
    const kan = !sidste && ui.trin + 1 <= Gf;
    if (!sidste) saetTekst(el.naeste, T.kv.naeste(T.kv.trin[ui.trin + 1]));
    el.naeste.classList.toggle('pri', kan);
    saetAttr(el.naeste, 'data-cta', kan ? '1' : '0');
    saetAttr(el.naeste, 'aria-disabled', sidste || kan ? null : 'true');

    const trin = TRIN[ui.trin];
    const tip = trin === 'karakterer' ? T.kv.taster.karakterer
      : trin === 'bane' ? T.kv.taster.bane
        : regelTip();
    const taster = tip ? [tip] : [];
    if (ui.trin > 0) taster.push(T.kv.taster.tilbage);
    saetHtml(el.taster, taster.map((x) => `<span>${esc(x)}</span>`).join(''));
    tegnStatus(G, s);
  }

  /** Regeltrinnets tastetip følger markøren: i listen skifter Enter reglen,
   *  på 🎲 trækkes nye, og på Start er man klar (eller ikke længere). */
  function regelTip() {
    const kan = kanRedigereRegler();
    if (ui.zone === 'gitter') {
      if (ui.regel === START) return kan ? T.kv.taster.startVaert : T.kv.taster.start;
      if (kan) return ui.regel === RUL ? T.kv.taster.reglerRul : T.kv.taster.reglerListe;
    }
    return kan ? T.kv.taster.reglerVaert : '';
  }

  function statusTekst(G, s) {
    if (t.nedtaelling_ms != null) return T.kv.starter;
    if (!m) return '';
    if (s.tilstand === 'videre') return T.kv.videre(T.kv.trin[G]);
    if (s.tilstand === 'venter') return T.kv.venterPaa(s.blok.map((d) => d.navn));
    if (s.tilstand === 'hold') return holdTekst();
    if (s.tilstand === 'mangler') return T.kv.manglerFoer(s.mangel.tekst, T.kv.trin[s.mangel.trin]);
    if (s.tur) return T.kv.turTil(s.tur.navn);               // ét tastatur: turen går videre om et øjeblik
    if (ui.trin < G) return T.kv.retValg(T.kv.trin[G]);     // gået tilbage for at ændre noget
    const trin = TRIN[ui.trin];
    if (trin === 'regler' && tilskuerIKamp()) return T.kv.kampIGang;
    if (trin === 'karakterer') {
      if (!erNet()) return T.kv.vaelger(m.navn);
      return m.valg == null ? T.kv.vaelgFighter : m.hold == null ? T.kv.vaelgHold : '';
    }
    if (trin === 'bane') return erNet() ? T.kv.stemPaaBane : T.kv.stemmerNu(m.navn);
    return erNet() ? T.kv.trykStart : T.kv.trykStartLokalt;
  }

  function tegnStatus(G = gruppe(), s = venteTilstand(G)) {
    const b = besked && besked.til > performance.now() ? besked : null;
    saetTekst(el.status, b ? b.tekst : statusTekst(G, s));
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
    el.annuller.hidden = !mineKlare().length;
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

  /** Esc eller Annullér under nedtællingen: jeg er ikke længere klar (ved
   *  ét tastatur ingen ved tastaturet, som ét tryk på Start gjorde klar). */
  function annuller() {
    const klare = mineKlare();
    if (!klare.length) return;
    for (const som of klare) api.klar(som);
    lyd.afspil('klik', { tone: 0.8 });
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

  /**
   * Trin i som UI-tilstand (uden tegning): markøren står, hvor trinnet
   * begynder for aktøren. maade: 'frem' (åbning, automatisk videre, ny
   * aktør), 'naeste' (selv frem) eller 'tilbage' (selv tilbage: skærmen går
   * ikke selv videre, før han vælger noget eller selv går frem).
   */
  function saetTrin(i, maade = 'frem') {
    const ny = Math.max(0, Math.min(SIDSTE, i));
    if (ny !== ui.trin) besked = null;  // en afvisning gjaldt det trin, han forlader
    ui.trin = ny;
    m = aktuel();
    if (maade === 'tilbage') ui.bagud = true;
    else if (maade === 'naeste') ui.bagud = ui.trin < gruppe();
    else ui.bagud = false;
    stopVidere();
    const trin = TRIN[ui.trin];
    const selv = maade === 'tilbage';     // tilbage for at ændre: markøren på valget
    ui.fod = 'naeste';
    if (trin === 'karakterer') {
      if (m?.valg != null && feltIndeks(m.valg) >= 0) ui.markoer = feltIndeks(m.valg);
      ui.zone = selv || m?.valg == null ? 'gitter' : m.hold == null ? 'hold' : kanFrem() ? 'fod' : 'hold';
    } else if (trin === 'bane') {
      if (m?.stemme) ui.bane = Math.max(0, BANE_VALG.indexOf(m.stemme));
      ui.zone = !selv && m?.stemme && kanFrem() ? 'fod' : 'gitter';
    } else {
      ui.zone = 'gitter';               // Start-knappen
      ui.regel = START;
    }
  }

  /** Til trin i, som spilleren selv vælger (Næste, Tilbage, Esc, trinbjælken). */
  function gaaTil(i, maade) {
    saetTrin(i, maade);
    klik();
    tegn();
    fokuser(ui.tastatur);
  }

  /** Aktøren har valgt noget: skærmen følger gruppen igen (og går selv videre
   *  til det fjerneste trin, gruppen er nået), og en tur fra et klik er brugt.
   *  Et nyt valg, mens skærmen er på vej videre, giver det nye valg sit
   *  øjeblik (timeren starter forfra). Ved ét tastatur beholder han turen et
   *  øjeblik (holdTur), så et dobbeltklik eller Q/E lige efter gælder ham. */
  function valgt() {
    ui.bagud = false;
    stopVidere();
    if (ui.tur != null && ui.tur === m?.pid) ui.turValgt = true;
    holdTur();
  }

  /** Næste: ét trin frem, men højst til gruppens trin. Ellers siges hvorfor. */
  function naeste() {
    if (ui.trin >= SIDSTE) return;
    if (!kanFrem()) return naegt(spaerret(ui.trin + 1) || mangler(ui.trin), el.naeste);
    gaaTil(ui.trin + 1, 'naeste');
  }

  /** Trinbjælken: tilbage altid, frem højst til gruppens trin. */
  function tilTrin(i, n) {
    if (i === ui.trin) { klik(); return; }
    if (i < ui.trin) { gaaTil(i, 'tilbage'); return; }
    if (!tilladt(i)) return naegt(spaerret(i), n);
    gaaTil(i, 'naeste');
  }

  function vaelgFelt(i) {
    const n = el.felter[i];
    const f = FELTER[i];
    if (!m) return naegt();
    if (!f.aaben) return naegt(`${f.navn}: ${spaerretTekst(f)}`, n);
    valgt();
    // Uden hold og højst to spillere giver rummet ham det ledige hold (vises
    // med det samme som et gæt). Samme fighter igen sendes også, så rummet
    // kan give holdet, hvis det ikke er sket.
    const auto = ledigtHold();
    if (m.valg !== f.figur || auto != null) {
      api.vaelg(f.figur, m.som);
      husk('valg', f.figur);
      if (auto != null) husk('hold', auto, true);
    }
    // Som i Tekken: den valgte karakter siger en af sine egne replikker (ikke
    // vigtig, så den springes over, hvis noget andet spiller). Tilfældig: kast.
    const replik = typeof f.figur === 'number' ? karakterLyd({ udseende: rosterUdseende(f.figur) }, 'glad') : null;
    if (replik) lyd.stemme(replik);
    else lyd.afspil('kast', { vol: 1.2 });
    // Uden hold vælges holdet nu. Med hold er trinnet gjort: Næste, når
    // gruppen også er færdig (og skærmen går selv videre), ellers venter
    // markøren i holdvalget, hvor han kan skifte hold.
    ui.zone = m.hold != null && kanFrem() ? 'fod' : 'hold';
    ui.fod = 'naeste';
    tegn();
    if (ui.tastatur) fokuser(true);
  }

  function rydValg() {
    if (!m || m.valg == null) return naegt();
    valgt();
    api.vaelg(null, m.som);
    husk('valg', null);
    ui.zone = 'gitter';
    klik();
    tegn();
    fokuser(true);
  }

  /** Blåt eller rødt hold (Q/E, ←→ i holdvalget, klik på knap eller panel).
   *  I holdvalget bliver markøren stående (videre med Enter eller ↓); ellers
   *  går den til Næste, når han også har en fighter, og gruppen er færdig. */
  function vaelgHold(hi) {
    if (!m || !t.hold[hi]) return naegt();
    valgt();
    if (m.hold === hi) { klik(); tegn(); return; }
    api.hold(hi, m.som);
    husk('hold', hi);
    lyd.afspil('kast', { vol: 1.2 });
    if (ui.zone !== 'hold' && m.valg != null) { ui.zone = kanFrem() ? 'fod' : 'hold'; ui.fod = 'naeste'; }
    tegn();
    if (ui.tastatur) fokuser(true);
  }

  /** Enter i holdvalget: holdet under markøren (har han intet endnu), og så
   *  videre — til Næste, når han har en fighter, ellers til rosteret. */
  function holdVidere() {
    if (m && m.hold == null) {
      const mk = markoerElement();
      if (mk?.dataset.vaelgHold != null) vaelgHold(+mk.dataset.vaelgHold);
    } else klik();
    if (m?.hold != null && m.valg != null) { ui.zone = 'fod'; ui.fod = 'naeste'; }
    else ui.zone = 'gitter';
  }

  /** En stemme. Samme bane igen fjerner den ikke (en stemme skal der til for
   *  at komme videre); det bekræfter den og følger gruppen igen. */
  function stemPaa(i) {
    if (!m) return naegt();
    valgt();
    const b = BANE_VALG[i];
    if (m.stemme !== b) {
      api.stem(b, m.som);
      husk('stemme', b);
      lyd.afspil('kast', { vol: 1.2 });
    } else klik();
    ui.zone = kanFrem() ? 'fod' : 'gitter';
    ui.fod = 'naeste';
    tegn();
    if (ui.tastatur) fokuser(true);
  }

  function saetRegel(ri, v) {
    if (!kanRedigereRegler()) return naegt(T.kv.reglerGaest);
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
    if (!kanRedigereRegler()) return naegt(T.kv.reglerGaest);
    api.randomStart();
    lyd.afspil('kast', { vol: 1.2 });
  }

  /** Start (det gamle Klar): klar kræver et hold, og uden fighter bliver det
   *  Tilfældig. Trykket igen er man ikke længere klar. Ved ét tastatur gør ét
   *  tryk alle ved tastaturet klar (og det næste ingen). Rummet tæller selv
   *  ned, når alle er klar. */
  function skiftKlar() {
    if (!m) return naegt();
    valgt();
    const klar = startKlar();
    const hvem = erNet() ? [m] : lokale(t).map(nu);
    if (klar) { klik(); for (const som of mineKlare()) api.klar(som); return; }
    if (hvem.some((d) => !d.klar && !harHold(d))) return naegt(T.kv.vaelgHoldFoerst, el.startKnap);
    // Klar tæller som alle tre trin: uden fighter bliver det Tilfældig
    // (nedenfor), men uden stemme (han står for langt fremme, se manglerFoer)
    // siger Start, hvad der mangler, i stedet for at gøre ham klar.
    if (hvem.some((d) => !d.klar && d.stemme == null)) {
      return naegt(T.kv.manglerFoer(T.kv.stemFoerst, T.kv.trin[1]), el.startKnap);
    }
    lyd.afspil('intro_slam');
    for (const d of hvem) {
      if (d.klar) continue;
      const som = erNet() ? m.som : d.pid;
      if (d.valg == null) {
        api.vaelg('tilfaeldig', som);
        if (d.pid === m.pid) husk('valg', 'tilfaeldig');
      }
      api.klar(som);
    }
  }

  /** Ét tastatur: giv en lokal spiller turen (et klik på ham i toplinjen). */
  function givTur(pid) {
    if (erNet() || pid === m?.pid || !lokale(t).some((d) => d.pid === pid)) return naegt();
    ui.tur = pid;
    ui.turValgt = false;
    slipTur(false);                     // han har turen nu, ikke den, der lige valgte
    klik();
    tegn();
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
    if (n.dataset.tur) { givTur(n.dataset.tur); return; }   // ét tastatur: han får turen
    if (n.dataset.fjern) { api.fjernSpiller(n.dataset.fjern); klik(); return; }
    if (n.dataset.indst) {
      ui.regel = +n.closest('.kv-regel').dataset.regel;
      ui.zone = 'gitter';
      saetRegel(ui.regel, n.dataset.v);
      tegn();
      return;
    }
    if (n.dataset.trinKnap != null) { tilTrin(+n.dataset.trinKnap, n); return; }
    switch (n.dataset.handling) {
      case 'tilbage': if (ui.trin > 0) gaaTil(ui.trin - 1, 'tilbage'); break;
      case 'naeste': naeste(); break;
      case 'start': ui.zone = 'gitter'; ui.regel = START; skiftKlar(); tegn(); break;
      case 'annuller': annuller(); break;
      case 'kopier': kopierLink(n); break;
      case 'nySpiller': slipTur(false); api.nySpiller(); klik(); break;
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
    if (d.tur) return `tur:${d.tur}`;
    if (d.trinKnap != null) return `trin:${d.trinKnap}`;
    return null;
  }

  /** Trinnets gitter: de elementer, piletasterne flytter imellem. */
  function gitterElement() {
    const trin = TRIN[ui.trin];
    if (trin === 'karakterer') return el.felter[ui.markoer];
    if (trin === 'bane') return el.baneFelter[ui.bane];
    // Regler: rækkerne (værten), 🎲 (værten) og til sidst Start (alle).
    if (ui.regel === START || !kanRedigereRegler()) return el.startKnap;
    if (ui.regel === RUL) return el.regler.querySelector('.kv-tilfaeldige-regler');
    const r = el.regler.querySelector(`.kv-regel[data-regel="${ui.regel}"]`);
    return r?.querySelector('.ir-knap.paa') || r?.querySelector('.ir-knap');
  }

  /** Elementet, markøren står på. */
  function markoerElement() {
    if (!el.ned.hidden) return el.annuller.hidden ? null : el.annuller;
    if (ui.zone === 'top') {
      const l = topKnapper();
      return (ui.topNoegle && l.find((n) => topNoegle(n) === ui.topNoegle)) || l[Math.min(ui.top, l.length - 1)] || null;
    }
    if (ui.zone === 'fod') {
      // Er knappen væk (Næste på Regler-trinnet), står markøren på Tilbage — aldrig på Forlad.
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
    if (!rul) return;
    mk.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // På Regler står Start-bjælken fast i bunden af midten (sticky), og
    // scrollIntoView regner ikke med den: en regel eller 🎲 lige over den
    // ender under den (en liggende telefon). Rul midten, så markøren står over.
    if (TRIN[ui.trin] === 'regler' && !el.startBoks.contains(mk)) {
      const over = mk.getBoundingClientRect().bottom - el.startBoks.getBoundingClientRect().top;
      if (over > 0) {
        const luft = over + 8;
        if (typeof el.midt.scrollBy === 'function') el.midt.scrollBy({ top: luft });
        else el.midt.scrollTop += luft;
      }
    }
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
    if (z[i] === 'gitter' && TRIN[ui.trin] === 'regler') ui.regel = d > 0 ? foersteRegel() : START;
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
    if (PILE.has(k) || OK.has(k) || k === 'Tab' || k === 'Escape') e.preventDefault?.();
    // Under nedtællingen: kun Esc (annullér).
    if (!el.ned.hidden) {
      if (k === 'Escape') annuller();
      return true;
    }
    if (k === 'Escape') {
      if (ui.trin > 0) gaaTil(ui.trin - 1, 'tilbage');
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
    } else {
      // Regler: gitteret er rækkerne (værten), 🎲 og Start. ↑↓ vælger række,
      // ←→ skifter værdi, Enter skifter værdi, trækker nye regler eller er Start.
      if (!kanRedigereRegler()) ui.regel = START;
      if (k === 'ArrowUp') {
        if (ui.regel > foersteRegel()) { ui.regel--; klik(); } else skiftZone(-1);
      } else if (k === 'ArrowDown') {
        if (ui.regel < START) { ui.regel++; klik(); } else skiftZone(1);
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (ui.regel < RUL) skiftRegel(ui.regel, k === 'ArrowRight' ? 1 : -1);
      } else if (OK.has(k)) {
        if (ui.regel === START) skiftKlar();
        else if (ui.regel === RUL) tilfaeldigeRegler();
        else skiftRegel(ui.regel, 1, true);
      } else return false;
    }
    tegn();
    fokuser(true);
    return true;
  }

  /* ---------------------------------------------------------- mus */

  kv.addEventListener('click', (e) => {
    ui.tastatur = false;
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
    /** Ny lobbybesked: opdatér på stedet; trin, markør og fokus bliver, og
     *  skærmen går selv videre, når gruppen er forbi trinnet (foelg). Første
     *  gang åbner den på gruppens trin. o.trin ('regler' ved Spil igen; 'klar'
     *  er det samme) går til det trin, højst gruppens. */
    opdater(tilstand, o = {}) {
      if (!tilstand) return;
      const foerste = !t;
      t = tilstand;
      forsinket = false;                 // en ny lobby: den er nyere end valget, der ikke fik svar
      afstem();
      let gendannet = false;
      if (foerste) {
        ui.kode = t.kode;
        if (gemt && gemt.kode === t.kode) { Object.assign(ui, gemt, { tastatur: false }); gendannet = true; }
        gemt = null;
      }
      const oensket = trinIndeks(o?.trin ?? (foerste ? opt.trin : undefined));
      if (foerste || oensket >= 0) {
        tjekAktoer();
        m = aktuel();
        if (oensket >= 0) saetTrin(Math.min(oensket, gruppe()), 'frem');
        else if (!gendannet) saetTrin(gruppe(), 'frem');
        flyttet = true;
      }
      tegn();
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
      stopVidere();
      clearTimeout(overdragTimer); overdrag = null;
      for (const pid of [...fightere.keys()]) fjernFighter(pid);
      stopAlleKlip();
      if (vedVideoFejl === planlaeg) vedVideoFejl = null;
      ventende = null;
      raf = planlagt = 0; frist = null; t = null;
      kv.remove();
    },
  };
}
