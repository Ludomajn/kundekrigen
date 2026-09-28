/* Kundekrigen — kamera.
 *
 * Kameraet er RENT præsentation. Det læser spejlets positioner (figurer,
 * projektiler, terrænets fast()) og skriver kun til three-kameraet — aldrig
 * til verden, og det rører aldrig rngSim. Rystelserne har deres egen PRNG.
 *
 * Tæt på, og levende som i Worms W.M.D. Ved standardzoom fylder en figur
 * (46 wu) 10 % af skærmhøjden (VERDEN_H = 460, se renderer.js), og kameraet
 * zoomer og indrammer selv efter, hvad der sker:
 *
 *   turstart   etablering: en kort glidning hen til kunden, lidt ude, og en
 *              blød zoom ind — længere væk fra, længere ude
 *   gang       kigger frem i den retning, kunden vender
 *   sigte      zoomer gradvist ud og skubber billedet i sigteretningen, mere
 *              jo hårdere der lades — med et loft, så figuren kan læses. Det
 *              er en RETNING, ikke en forudsagt bane: kameraet må ikke blive
 *              en sigtehjælp, der viser, hvor skuddet lander.
 *   skud       200 ms efter affyringen: følger med fart-forspring og zoomer ud
 *              med fart og højde, så buen og jorden under den er med. Klynger
 *              og luftangreb rammes ind sammen.
 *   nedslag    et kort punch-in og en rystelse efter sprængradius (de store
 *              brag får et spark oveni); main.js holder over krateret i
 *              NEDSLAG_HOLD_MS, før kameraet vender tilbage
 *   dødsfald   et kort fokus på den, der lægger på
 *   markør     rammer kunden og markøren ind sammen (teleport, luftangreb)
 *   ro         en næsten umærkelig "vejrtrækning", så billedet aldrig fryser
 *
 * Alt glides med kritisk dæmpede fjedre (glatDaemp) — position, zoom og
 * indramning hver for sig — så et skift af mål aldrig giver et ryk. Zoomen
 * fjedres i log-rum, så ud og ind føles lige hurtigt.
 *
 * Z/X er manuelle trin, der ganges på den dynamiske zoom; H viser hele banen;
 * WASD panorerer frit. prefers-reduced-motion: ingen vejrtrækning, ingen
 * ekstra baggrundsbevægelse og mindre rystelser, punch og spark.
 *
 * Ingen allokeringer i opdater(): alt skrives i genbrugte variabler.
 * Konstanterne, målingerne og hvorfor: docs/kamera.md.
 */
'use strict';

import { glatDaemp, glatTrin, klem, lerp } from '../core/math.js';
import { lavRng } from '../core/rng.js';

/* ------------------------------------------------------------ konstanter */

export const FIGUR_H = 46;                 // = entities.HITBOX.hoejde
const FIGUR_LOEFT = 40;                    // billedets midte over fødderne: luft over hovedet

// Manuelle zoomtrin, ganget på den dynamiske zoom. Et lavere tal viser mindre
// og er dermed tættere på: X (zoomInd) vælger et lavere trin, Z (zoomUd) et
// højere (ui/keyboard.js).
export const ZOOMTRIN = [0.8, 1.0, 1.3, 1.7];
const ZOOM_START = 1;

// Følgebevægelsen. Dødzonen er en andel af udsnittet: små gangskridt og
// hop må ikke ryste billedet.
const DOEDZONE_X = 0.06, DOEDZONE_Y = 0.16;
const FOELG_TID = 0.42;                    // blødt, så skift mellem mål ikke rykker
const FOELG_TID_ETABLER = 0.62;            // turstartens glidning
const FOELG_TID_SKUD = 0.15;               // strammere: et skud flyver 1500 wu/s
const FOELG_TID_MARKOER = 0.3;
const FOELG_TID_DOED = 0.45;
const FOELG_TID_KIG = 0.35;
const RAMME_TID = 0.65;                    // indramningens forskydning (fremkig, sigte)
const ZOOM_TID = 0.5, ZOOM_TID_SKUD = 0.4, ZOOM_TID_KIG = 0.38;

// Turstart: start lidt ude og glid ind. Længere rejser starter længere ude
// (en kranbevægelse), så farten på skærmen holder sig nede. Står kameraet
// allerede ved kunden, trækker det sig ikke tilbage først (ETABLER_NAER).
const ETABLER_ZOOM = 1.25, ETABLER_NAER = 600, ETABLER_AFSTAND = 2600, ETABLER_EKSTRA = 0.4, ETABLER_LOFT = 1.7;
const ETABLER_TID = 1.7;                   // s; turstarten varer 2,5 s (TUR_START_TICKS)
const FOKUS_KRAN = 1.2;                    // udsnitsbredder: længere fokus-rejser får kranen

// Gang
const GANG_FREM = 0.15;                    // fremkig: andel af udsnittets bredde
const GANG_FULD = 80;                      // wu/s for fuldt fremkig (gangfarten er 105)
const GANG_ZOOM = 0.04;

// Havet: billedet trækkes højst 20 % ned for at få 30 wu hav med
const VAND_TRAEK = 0.2, VAND_SE = 30;

// Sigte. Loftet gælder både ganget på det manuelle trin og absolut, så en
// figur aldrig bliver mindre end ~5 % af skærmhøjden, mens man sigter.
export const SIGTE_ZOOM = 1.2, SIGTE_ZOOM_KRAFT = 0.4, SIGTE_ZOOM_LOFT = 1.6, SIGTE_ABS_LOFT = 2.0;
const SIGTE_FREM = 0.12, SIGTE_FREM_KRAFT = 0.12;           // andel af udsnittet
const SIGTE_FREM_MAKS = 0.26, SIGTE_OP_MAKS = 0.24, SIGTE_NED_MAKS = 0.12;
// rad fra vinklen, da sigtet sidst var i ro: sigtet er rørt. Mod en fast
// reference, ikke forrige frame, så det ikke afhænger af billedfrekvensen
// (simulationen drejer 1° pr. tick, finsigtet 0,25°).
const SIGTE_VINKEL_TAERSKEL = 0.012;

// Skud
const SKUD_VENT = 0.2;                     // s: mundingsglimtet ses, før kameraet drejer
const SKUD_FREM_X = 0.22, SKUD_FREM_Y = 0.14;   // s fart-forspring
const SKUD_ZOOM_FART = 0.3;                // ekstra zoom pr. 1000 wu/s
export const SKUD_ZOOM_LOFT = 1.9;
const SKUD_KANT = 0.13;                    // margen i indramningen (andel pr. side)
const SKUD_INDRE = 0.34;                   // hovedprojektilet holdes inden for ±34 % fra midten
const SKUD_JORD_MAKS = 1400;               // wu: så langt ned ledes der efter jorden
const SKUD_JORD_TRIN = 16;
export const SKUD_TOP_EKSTRA = 2600;       // wu over banen: et lodret skud på 1500 wu/s fra toppen når 2350 op
const SKUD_SIDE_EKSTRA = 320;              // wu ud over siderne: et skud fjernes 200 wu ude
const NEDSLAG_ZOOM = 1.1;

// Markør og kort indramning (scannerens træfpunkt)
const MARKOER_LOFT = 1.8, MARKOER_KANT = 0.15, MARKOER_INDRE = 0.36;
const INDRAM_TID = 1.4;                    // s; kun når træfpunktet er uden for billedet

// Nedslag: punch-in, rystelse og (store brag) spark
const PUNCH_LILLE = 0.035, PUNCH_STOR = 0.085, PUNCH_HALV = 0.12, PUNCH_TID = 0.05;
const STOR_RADIUS = 70;                    // Datalæk-bomben (74) og opefter
const STOR_EKSTRA_RYST = 0.35;
const SPARK_STOR = 0.22;                   // udsnitshøjder pr. sekund, væk fra braget
export const RYST_ANDEL = 14 / 860;        // største udsving (andel af udsnitshøjden): som før
const RYST_HALV = 0.25;                    // s halveringstid
const RYST_FREK_A = 43, RYST_FREK_B = 71;  // rad/s: 7 og 11 Hz, ikke billedfrekvensens hvide støj
const RYST_FALD = 0.6;                     // halvt så meget ~0,6 skærmbredde væk

// Dødsfald: det sorte hul varer 1,3 s (SORT_HUL_TICKS), så liget smælder
const DOED_FOKUS = 1.9, DOED_ZOOM = 0.92;

// Ro: vejrtrækningen
export const AANDE_ZOOM = 0.006, AANDE_X = 3.5, AANDE_Y = 2.2;
const AANDE_PERIODE_Z = 7.3, AANDE_PERIODE_X = 11.1, AANDE_PERIODE_Y = 8.3;
const RO_TID = 0.8;

// prefers-reduced-motion
export const REDUCERET_RYST = 0.35;
const REDUCERET_PUNCH = 0.3, REDUCERET_ETABLER = 0.4;

const KANT = 60;                           // hvor langt ud over banen kameraet må se
const TAU = Math.PI * 2;

/* ------------------------------------------------------------ hjælpere */

let mq = null;
/** prefers-reduced-motion, live. Uden matchMedia (node): fuld bevægelse. */
export function reduceretBevaegelse() {
  if (mq === null) {
    try { mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || false; } catch { mq = false; }
  }
  return !!(mq && mq.matches);
}

/**
 * Perspektiv på baggrunden: et lag med parallaksefaktor f ved zoom 1, set
 * ved zoom z — som om kameraet kørte frem og tilbage i stedet for at zoome.
 * Returnerer lagets effektive faktor g; laget skal skaleres g / f. Fjerne lag
 * (lille f) skifter derfor næsten ikke størrelse på skærmen, nære lag gør.
 */
export function dybdeFaktor(f, z) {
  if (!(f < 1)) return 1;
  if (!(f > 0)) return 0;
  return (z * f) / (z * f + 1 - f);
}

/** Glat støj i [-1, 1] — en rystelse, ikke billedfrekvensens hvide støj. */
const stoej = (t, fase) => 0.6 * Math.sin(t * RYST_FREK_A + fase) + 0.4 * Math.sin(t * RYST_FREK_B + fase * 2.3 + 1.7);

/** Højden over jorden (eller havet) under et punkt. Groft (16 wu), billigt. */
function hoejdeOverJord(t, x, y, vand) {
  const gulv = Math.max(vand, y - SKUD_JORD_MAKS);
  for (let yy = Math.min(y, t.h - 1); yy > gulv; yy -= SKUD_JORD_TRIN) {
    if (t.fast(x, yy)) return Math.max(0, y - yy);
  }
  return Math.max(0, y - gulv);
}

/* ------------------------------------------------------------ kameraet */

/**
 * r: renderen (renderer.js) — kamera, tilpas(zoom), bredde, hoejde, enhed.
 * terraen: spejlets terræn (w, h, vandNiveau, fast).
 * opt.figur(id): slå en figur op igen (et snapshot udskifter objekterne).
 * opt.terraen(): det aktuelle terræn, hvis spejlet bygger det om.
 * opt.reduceret: tving prefers-reduced-motion (test); ellers matchMedia.
 */
export function lavKamera(r, terraen, opt = {}) {
  const rngFx = lavRng(0xC0FFEE);          // ALDRIG del af simulationen
  const hentFigur = typeof opt.figur === 'function' ? opt.figur : null;
  const hentTerraen = typeof opt.terraen === 'function' ? opt.terraen : null;
  let tvungenReduceret = typeof opt.reduceret === 'boolean' ? opt.reduceret : null;
  const reduceret = () => (tvungenReduceret ?? reduceretBevaegelse());

  const p = r.kamera.position;
  let ur = 0;                               // kameraets eget ur (s); aldrig vægur

  // Hvem og hvad
  let laas = null, laasId = null;           // figuren vi følger
  let ankerX = terraen.w / 2, ankerY = terraen.h / 2;   // figuren med dødzone
  let fri = false, friX = 0, friY = 0;
  let friFoer = false;                      // var fri panorering slået til sidste frame?
  let traekDy = 0;                          // havets træk og hovedets klemme på my sidste frame
  let kig = false, kigT = 0;
  let zoomIdx = ZOOM_START;
  let vand = terraen.vandNiveau ?? 300;

  // Fjedre
  const hastX = { v: 0 }, hastY = { v: 0 }, hastZ = { v: 0 };
  let rX = 0, rY = 0;                       // indramningens forskydning
  const rhX = { v: 0 }, rhY = { v: 0 };
  let lz = 0;                               // log(zoom), fjedret
  let zoomNu = 1;                           // vist zoom (med punch og vejrtrækning)

  // Turstart
  let etablerT = 0, etablerZoom = ETABLER_ZOOM;

  // Gang og sigte (aflæst af figurens bevægelse og vinkel)
  let gangV = 0, forrigeX = NaN;
  let sigteType = null, sigteId = null, kraft = 0;
  let sigter = false, sigteRef = NaN;

  // Skud
  let skud = null, skudListe = null, skudVent = 0, skudBevaegede = false;

  // Markør, kort indramning og kort fokus
  let markoer = false, markoerX = 0, markoerY = 0;
  let markoerVX = 0, markoerVY = 0, markoerFoer = false;   // flytning siden sidste frame
  let markoerFartX = 0, markoerFartY = 0;                  // glattet fart (wu/s)
  let indramX = 0, indramY = 0, indramTil = -1;
  let fokusX = 0, fokusY = 0, fokusTil = -1, fokusAktiv = false;

  // Nedslag
  let ryst = 0, rystFaseX = 0, rystFaseY = 0;
  let punchMaal = 0, punchNu = 0;
  const punchV = { v: 0 };

  // Ro
  let roVaegt = 0;

  // Uden rystelse og vejrtrækning — til test og fejlfinding. Genbruges.
  const glat = { x: p.x, y: p.y, zoom: 1, tilstand: 'ro' };
  const k = { x: 0, y: 0 };

  function enhedB() { return r.enhed ? r.enhed.b : r.bredde / (r.zoom || 1); }
  function enhedH() { return r.enhed ? r.enhed.h : r.hoejde / (r.zoom || 1); }

  function klemTilBane(t, x, y, halvB, halvH, top, side) {
    const x0 = -KANT - side + halvB, x1 = t.w + KANT + side - halvB;
    const y0 = -KANT + halvH, y1 = t.h + KANT + top - halvH;
    k.x = x0 > x1 ? t.w / 2 : klem(x, x0, x1);
    k.y = y0 > y1 ? (y0 + y1) / 2 : klem(y, y0, y1);
  }

  function bevaeger(q) { return !!q && ((q.vx || 0) !== 0 || (q.vy || 0) !== 0) && !q.sover; }

  function nulstilAflaesning() {
    forrigeX = NaN; gangV = 0; sigteRef = NaN; sigter = false;
  }

  function afstandTil(e) { return Math.abs(e.x - glat.x) + Math.abs(e.y + FIGUR_LOEFT - glat.y); }

  /** Etableringens zoom: lidt ude, og længere ude jo længere rejsen er. */
  function startKran(e) {
    const afstand = afstandTil(e);
    let z = Math.min(ETABLER_LOFT, 1 + (ETABLER_ZOOM - 1) * Math.min(1, afstand / ETABLER_NAER) +
                                   ETABLER_EKSTRA * afstand / ETABLER_AFSTAND);
    if (reduceret()) z = 1 + (z - 1) * REDUCERET_ETABLER;
    etablerZoom = z;
    etablerT = 1;
  }

  function saetLaas(e) {
    if (e !== laas) nulstilAflaesning();
    laas = e || null;
    laasId = e?.id ?? null;
  }

  const api = {
    /** Den viste zoom (1 = standard; større er længere ude). */
    get zoom() { return zoomNu; },
    /** Kameraet uden rystelse og vejrtrækning (genbrugt objekt). */
    get glat() { return glat; },
    get tilstand() { return glat.tilstand; },
    get zoomTrin() { return zoomIdx; },

    /** Følg en figur (C: centrér på den). */
    foelg(e) {
      saetLaas(e); skud = null;
      if (e) { ankerX = e.x; ankerY = e.y + FIGUR_LOEFT; }
    },

    /** Følg et skud tæt og lidt foran i flyveretningen — også selvom man
     *  stod og panorerede frit. `liste` er alt i luften: klynger og
     *  luftangreb rammes ind sammen. Et punkt uden fart (selve nedslaget)
     *  holdes bare i billedet. Kaldes hver frame, mens der er noget i luften. */
    foelgSkud(q, liste = null) {
      const bev = bevaeger(q);
      if (bev && !skudBevaegede) skudVent = SKUD_VENT;
      skudBevaegede = bev;
      skud = q || null; skudListe = liste;
      fri = false; friX = 0; friY = 0;
    },
    slipSkud() { skud = null; skudListe = null; skudBevaegede = false; },
    get foelgerSkud() { return !!skud; },

    /** Glid hen til en figur og følg den (T, sejren, efter nedslaget). */
    fokus(e) {
      if (!e) return;
      // En lang rejse (tilbage fra et fjernt nedslag, T, sejren) får samme
      // kranbevægelse som turstarten: ud, glid, ind — ikke et piskesmæld.
      if (afstandTil(e) > FOKUS_KRAN * r.bredde) startKran(e);
      saetLaas(e); nulstilAflaesning();
      skud = null; skudListe = null; skudBevaegede = false;
      fri = false; friX = 0; friY = 0;
      ankerX = e.x; ankerY = e.y + FIGUR_LOEFT;
    },

    /** Turskifte: etableringen. Ophæv fri panorering, glid HELT hen til
     *  kunden — lidt ude, og længere ude jo længere væk — og zoom blødt ind. */
    etabler(e) {
      if (!e) return;
      startKran(e);
      fokusTil = -1; indramTil = -1;
      api.fokus(e);
    },

    /** Gammel API: se på en figur (holdet ignoreres). */
    sigtMod(e) { api.foelg(e); },
    slipHold() {},

    saetMaal(x, y) { ankerX = x; ankerY = y; },
    snap(x, y) {
      ankerX = x; ankerY = y;
      p.x = x; p.y = y;
      hastX.v = 0; hastY.v = 0;
      glat.x = x; glat.y = y;
    },

    friTilstand(paa) { fri = !!paa; if (!paa) { friX = 0; friY = 0; } },
    // Ikke under H og introen: oversigten står fast på banens midte, så en
    // panorering dér ville hobe sig op usynligt og kaste billedet af sted,
    // når man slipper H.
    panorer(dx, dy) { if (fri && !kig) { friX += dx; friY += dy; } },
    erFri() { return fri; },

    kigPaaBanen(paa) { kig = !!paa; },

    zoomInd() { zoomIdx = Math.max(0, zoomIdx - 1); },
    zoomUd() { zoomIdx = Math.min(ZOOMTRIN.length - 1, zoomIdx + 1); },

    /** Hvad den aktive kunde sigter med ('vinkel+kraft', 'vinkel' eller null)
     *  og hvor hårdt der lades (0-1, kun kendt lokalt). id: den aktive kunde —
     *  kigger kameraet på en anden (T), indrammes der ikke efter sigtet. */
    saetSigte(type, kraft01 = 0, id = null) {
      sigteType = type || null;
      sigteId = id;
      kraft = sigteType ? klem(kraft01 || 0, 0, 1) : 0;
    },
    /** Markørtilstand: markøren og kunden rammes ind sammen. */
    saetMarkoer(paa, x = 0, y = 0) {
      const dx = x - markoerX, dy = y - markoerY;
      // Summeres til næste opdater. Et spring (T til næste fjende) er ingen fart.
      if (paa && markoerFoer && Math.abs(dx) < 80 && Math.abs(dy) < 80) { markoerVX += dx; markoerVY += dy; }
      else { markoerVX = 0; markoerVY = 0; markoerFartX = 0; markoerFartY = 0; }
      markoer = !!paa; markoerFoer = markoer; markoerX = x; markoerY = y;
    },
    /** Havets overflade (stiger ved pludselig død). */
    saetVand(y) { if (Number.isFinite(y)) vand = y; },
    saetReduceret(paa) { tvungenReduceret = typeof paa === 'boolean' ? paa : null; },

    /** Et kort fokus på et punkt (et dødsfald). Et skud i luften går forud. */
    kortFokus(x, y, sek = DOED_FOKUS) { fokusX = x; fokusY = y; fokusTil = ur + sek; },
    /** Ram kunden og et punkt ind sammen et øjeblik (scannerens træf). */
    rammeInd(x, y, sek = INDRAM_TID) {
      if (Math.abs(x - p.x) < 0.4 * r.bredde && Math.abs(y - p.y) < 0.4 * r.hoejde) return;   // ses allerede
      indramX = x; indramY = y; indramTil = ur + sek;
    },

    /** Additiv rystelse, forsvinder med en halveringstid på 0,25 s.
     *  afstand i wu fra kameraet; længere væk ryster mindre. */
    rystelse(styrke, afstand = 0) {
      const fald = 1 / (1 + afstand / (RYST_FALD * Math.max(1, r.bredde)));
      if (ryst < 0.02) { rystFaseX = rngFx() * TAU; rystFaseY = rngFx() * TAU; }
      ryst = Math.min(1, ryst + styrke * fald);
    },

    /** En eksplosion: rystelse efter radius, et kort punch-in og — ved de
     *  store brag — et spark væk fra braget. */
    eksplosion(x, y, radius) {
      const dx = p.x - x, dy = p.y - y;
      const afstand = Math.sqrt(dx * dx + dy * dy);
      const stor = radius >= STOR_RADIUS;
      api.rystelse(Math.min(1, radius / 60) + (stor ? STOR_EKSTRA_RYST : 0), afstand);
      const fald = 1 / (1 + afstand / (RYST_FALD * Math.max(1, r.bredde)));
      const red = reduceret() ? REDUCERET_PUNCH : 1;
      const punch = (stor ? PUNCH_STOR : PUNCH_LILLE * Math.min(1, radius / 50)) * fald * red;
      punchMaal = Math.max(punchMaal, punch);
      if (stor) {
        // Væk fra braget; står vi lige over det, et stød opad.
        const l = afstand > 1 ? afstand : 1;
        const ux = afstand > 1 ? dx / l : 0, uy = afstand > 1 ? dy / l : 1;
        const s = SPARK_STOR * r.hoejde * fald * red;
        hastX.v += ux * s; hastY.v += uy * s;
      }
    },

    opdater(dt) {
      dt = dt > 0 ? Math.min(dt, 0.25) : 0;
      ur += dt;
      const t = (hentTerraen && hentTerraen()) || terraen;
      const cw = enhedB(), ch = enhedH();
      const manuel = ZOOMTRIN[zoomIdx];
      const red = reduceret();

      // Et snapshot kan have udskiftet figurobjektet: slå det op igen.
      if (hentFigur && laasId !== null) { const f = hentFigur(laasId); if (f) laas = f; }

      // ---- aflæsning: går kunden, og sigter den? (afledt af spejlet)
      let gang = 0, gangRetning = 1;
      if (laas) {
        const dx = laas.x - forrigeX;
        if (dt > 0 && Math.abs(dx) < 60) gangV += (dx / dt - gangV) * (1 - Math.exp(-dt / 0.12));
        else gangV = 0;                     // første frame, eller et spring (teleport)
        forrigeX = laas.x;
        gang = klem((Math.abs(gangV) - 15) / (GANG_FULD - 15), 0, 1);
        gangRetning = laas.paaJorden === false && Math.abs(gangV) > 150 ? Math.sign(gangV) : (laas.retning || 1);
        const minSigte = sigteType && !laas.doed && (sigteId === null || sigteId === laasId);
        const v = laas.vinkel ?? 0;
        // Referencen er vinklen, da sigtet sidst var i ro: den følger kun med,
        // når der ikke kan sigtes, eller når gangen har afbrudt sigtet.
        if (!Number.isFinite(sigteRef) || !minSigte) sigteRef = v;
        if (minSigte) {
          if (kraft > 0 || Math.abs(v - sigteRef) > SIGTE_VINKEL_TAERSKEL) sigter = true;
          if (gang > 0.5 && kraft <= 0) { sigter = false; sigteRef = v; }   // går man, sigter man ikke
        } else sigter = false;
      }

      // Markørens fart: flytningen siden sidste frame, glattet.
      if (dt > 0 && markoer) {
        const a = 1 - Math.exp(-dt / 0.1);
        markoerFartX += (markoerVX / dt - markoerFartX) * a;
        markoerFartY += (markoerVY / dt - markoerFartY) * a;
      } else { markoerFartX = 0; markoerFartY = 0; }
      markoerVX = 0; markoerVY = 0;

      if (fokusAktiv && !(fokusTil > ur)) {
        fokusAktiv = false;
        if (laas && afstandTil(laas) > FOKUS_KRAN * r.bredde) startKran(laas);
      }
      if (etablerT > 0) etablerT = Math.max(0, etablerT - dt / ETABLER_TID);
      if (skudVent > 0) skudVent = Math.max(0, skudVent - dt);
      kigT = lerp(kigT, kig ? 1 : 0, 1 - Math.pow(0.001, dt));

      // ---- mål: hvor skal billedets midte hen, og hvor langt ude?
      let mx = ankerX, my = ankerY;
      let dyn = 1, fitAbs = 0, loft = ETABLER_LOFT, absLoft = Infinity;
      let ft = FOELG_TID, zt = ZOOM_TID, tilstand = 'ro';
      let top = 0, side = 0;
      let harPrim = false, primX = 0, primY = 0, indre = 0.5;
      let rammeMaalX = 0, rammeMaalY = 0, figurRamme = false;

      const skudFlyver = bevaeger(skud);
      if (skudFlyver && skudVent > 0) {
        // Rytmen: mundingsglimtet først. Men slip aldrig skuddet ud af billedet.
        if (Math.abs(skud.x - p.x) > 0.36 * r.bredde || Math.abs(skud.y - p.y) > 0.36 * r.hoejde) skudVent = 0;
      }

      if (skudFlyver && skudVent <= 0) {
        // ---- skud i luften: følg med forspring, ram klyngen ind, se jorden
        const vx = skud.vx || 0, vy = skud.vy || 0;
        const fart = Math.sqrt(vx * vx + vy * vy);
        let x0 = skud.x, x1 = skud.x, y0 = skud.y, y1 = skud.y;
        const lx = skud.x + vx * SKUD_FREM_X, ly = skud.y + vy * SKUD_FREM_Y;
        if (lx < x0) x0 = lx; if (lx > x1) x1 = lx;
        if (ly < y0) y0 = ly; if (ly > y1) y1 = ly;
        if (skudListe) {
          for (let i = 0; i < skudListe.length; i++) {
            const q = skudListe[i];
            if (!q || q === skud) continue;
            const qx = q.x + (q.vx || 0) * SKUD_FREM_X, qy = q.y + (q.vy || 0) * SKUD_FREM_Y;
            if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
            if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
            if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
            if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
          }
        }
        // Jorden under skuddet: landingsområdet skal med. Er skuddet for højt
        // til, at begge kan være der (loftet), holdes skuddet i billedet, og
        // zoomen bliver ude — den dykker ikke ind ved toppen af buen.
        const alt = hoejdeOverJord(t, skud.x, skud.y, vand);
        if (skud.y - alt - 30 < y0) y0 = skud.y - alt - 30;
        mx = (x0 + x1) / 2; my = (y0 + y1) / 2;
        fitAbs = Math.max((x1 - x0) / (cw * (1 - 2 * SKUD_KANT)), (y1 - y0) / (ch * (1 - 2 * SKUD_KANT)));
        dyn = 1 + SKUD_ZOOM_FART * fart / 1000;
        loft = SKUD_ZOOM_LOFT;
        // Fjederen halter fart * tid bagefter; det er dét punkt, der skal
        // holdes inde i billedet, ikke projektilets egen position.
        harPrim = true; primX = skud.x + vx * FOELG_TID_SKUD; primY = skud.y + vy * FOELG_TID_SKUD;
        indre = SKUD_INDRE;
        ft = FOELG_TID_SKUD; zt = ZOOM_TID_SKUD; tilstand = 'skud';
        top = SKUD_TOP_EKSTRA; side = SKUD_SIDE_EKSTRA;
      } else if (fokusTil > ur && !skudFlyver) {
        // ---- dødsfald: et kort fokus
        fokusAktiv = true;
        mx = fokusX; my = fokusY + 20;
        dyn = DOED_ZOOM; loft = 1;
        ft = FOELG_TID_DOED; tilstand = 'doed';
      } else if (skud && !skudFlyver) {
        // ---- nedslaget (eller en bombe, der ligger og venter): hold den
        mx = skud.x; my = skud.y + 30;
        dyn = NEDSLAG_ZOOM; loft = NEDSLAG_ZOOM;
        tilstand = 'nedslag';
      } else if (laas && (markoer || indramTil > ur)) {
        // ---- markøren (eller scannerens træfpunkt) og kunden sammen
        const px = markoer ? markoerX : indramX, py = markoer ? markoerY : indramY;
        const fx = laas.x, fy = laas.y + FIGUR_H / 2;
        const x0 = Math.min(px, fx), x1 = Math.max(px, fx);
        const y0 = Math.min(py, fy), y1 = Math.max(py, fy);
        mx = (x0 + x1) / 2; my = (y0 + y1) / 2;
        fitAbs = Math.max((x1 - x0) / (cw * (1 - 2 * MARKOER_KANT)), (y1 - y0) / (ch * (1 - 2 * MARKOER_KANT)));
        loft = MARKOER_LOFT;
        harPrim = true; indre = MARKOER_INDRE;
        // Markøren flyttes med piletasterne (560 wu/s): hold dér, hvor
        // fjederen halter efter den, inde i billedet — som med skuddet.
        if (markoer) { primX = px + markoerFartX * FOELG_TID_MARKOER; primY = py + markoerFartY * FOELG_TID_MARKOER; }
        else { primX = fx; primY = fy; }
        ft = FOELG_TID_MARKOER; zt = ZOOM_TID_SKUD; tilstand = 'markoer';
      } else if (laas) {
        // ---- figuren: dødzone, fremkig, sigte
        figurRamme = true;
        if (!fri) {
          const dzx = DOEDZONE_X * r.bredde / 2, dzy = DOEDZONE_Y * r.hoejde / 2;
          const fy = laas.y + FIGUR_LOEFT;
          if (laas.x - ankerX > dzx) ankerX = laas.x - dzx; else if (ankerX - laas.x > dzx) ankerX = laas.x + dzx;
          if (fy - ankerY > dzy) ankerY = fy - dzy; else if (ankerY - fy > dzy) ankerY = fy + dzy;
        }
        mx = ankerX; my = ankerY;
        if (sigter) {
          dyn = Math.min(SIGTE_ZOOM + SIGTE_ZOOM_KRAFT * kraft, SIGTE_ZOOM_LOFT);
          loft = SIGTE_ZOOM_LOFT; absLoft = SIGTE_ABS_LOFT;
          tilstand = 'sigte';
        } else if (gang > 0) {
          dyn = 1 + GANG_ZOOM * gang;
          tilstand = 'gang';
        }
        if (fri) tilstand = 'fri';
      }
      if (etablerT > 0 && (tilstand === 'ro' || tilstand === 'gang' || tilstand === 'sigte')) {
        // Turstarten: ude først, så blødt ind. Den første tredjedel holdes ude.
        dyn = Math.max(dyn, 1 + (etablerZoom - 1) * glatTrin(0, 0.7, etablerT));
        loft = Math.max(loft, etablerZoom);
        ft = FOELG_TID_ETABLER;
        if (tilstand === 'ro') tilstand = 'etabler';
      }

      // ---- zoommålet: manuelt trin x dynamik, med lofter
      let zMaal = Math.max(manuel * dyn, fitAbs);
      zMaal = Math.min(zMaal, manuel * loft, Math.max(manuel, absLoft));
      const vwM = zMaal * cw, vhM = zMaal * ch;

      // ---- indramningen (fremkig og sigte), i målets udsnit
      if (figurRamme && !fri) {
        if (sigter) {
          const v = laas.vinkel ?? 0;
          const ax = Math.cos(v) * (laas.retning || 1), ay = Math.sin(v);
          const andel = SIGTE_FREM + SIGTE_FREM_KRAFT * kraft;
          rammeMaalX = klem(ax * andel * vwM, -SIGTE_FREM_MAKS * vwM, SIGTE_FREM_MAKS * vwM);
          rammeMaalY = klem(ay * andel * vhM, -SIGTE_NED_MAKS * vhM, SIGTE_OP_MAKS * vhM);
        } else if (gang > 0) {
          // Plus farten gange fjederens tid: ellers æder følgeforsinkelsen
          // (105 wu/s * 0,42 s) det meste af fremkigget.
          rammeMaalX = gangRetning * GANG_FREM * vwM * gang + gangV * FOELG_TID;
        }
      }
      // Fri panorering begynder: indramningen, som den så ud sidste frame
      // (fremkig, sigte, havets træk), lægges over i den frie forskydning, så
      // billedet starter præcis dér, hvor det var. Ellers glider den tilbage,
      // og en panorering lodret flytter også billedet vandret.
      if (fri && !friFoer && figurRamme) {
        friX += rX; friY += rY + traekDy;
        rX = 0; rY = 0; rhX.v = 0; rhY.v = 0;
      }
      friFoer = fri;
      rX = glatDaemp(rX, rammeMaalX, rhX, RAMME_TID, dt);
      rY = glatDaemp(rY, rammeMaalY, rhY, RAMME_TID, dt);
      traekDy = 0;
      if (figurRamme) {
        mx += rX + friX; my += rY + friY;
        if (!fri) {
          // Havet trækker billedet ned: man skal kunne se det vand, man kan
          // falde i — men hovedet bliver i billedet.
          // Kan havet ikke nås inden for VAND_TRAEK, slipper trækket blødt
          // igen: så er det bedre at stå i midten end halvvejs uden hav.
          const my0 = my;
          const mangler = my - vhM / 2 - (vand - VAND_SE);
          const traek = VAND_TRAEK * vhM;
          if (mangler > 0) my -= mangler <= traek ? mangler : traek * (1 - glatTrin(traek, 1.8 * traek, mangler));
          my = Math.max(my, laas.y + FIGUR_H - (0.5 - 0.12) * vhM);
          traekDy = my - my0;
        }
      }
      if (harPrim) {
        // Det vigtigste (skuddet, markøren) bliver i den indre del af billedet
        // — målt i det mindste af det nuværende og det ønskede udsnit, for
        // zoomen halter også, når der zoomes ud.
        const ib = indre * Math.min(vwM, r.bredde), ih = indre * Math.min(vhM, r.hoejde);
        mx = klem(mx, primX - ib, primX + ib);
        my = klem(my, primY - ih, primY + ih);
      }

      // ---- H og introen: hele banen, blødt blandet ind
      let lzMaal = Math.log(zMaal);
      if (kigT > 0.0005) {
        const zKig = Math.max(t.w / cw, t.h / ch) * 1.04;
        lzMaal = lerp(lzMaal, Math.log(zKig), kigT);
        mx = lerp(mx, t.w / 2, kigT); my = lerp(my, t.h / 2, kigT);
        // Oversigten er banen, ikke skuddets ekstra himmel: flugtens margen
        // over og ud til siderne blandes væk med den. Ellers klemmes midten
        // op, når oversigten er højere end banen, og banen sidder i bunden.
        const ud = 1 - kigT;
        top *= ud; side *= ud;
        if (kigT > 0.5) { ft = FOELG_TID_KIG; zt = ZOOM_TID_KIG; tilstand = 'kig'; }
      }

      // ---- zoom: fjeder i log-rum, så punch-in og vejrtrækning
      lz = glatDaemp(lz, lzMaal, hastZ, zt, dt);
      punchMaal *= Math.pow(0.5, dt / PUNCH_HALV);
      punchNu = glatDaemp(punchNu, punchMaal, punchV, PUNCH_TID, dt);
      const roMaal = red || kig ? 0
        : tilstand === 'ro' ? 1 : tilstand === 'sigte' && kraft <= 0 ? 0.5 : 0;
      roVaegt += (roMaal * (1 - kigT) - roVaegt) * (1 - Math.exp(-dt / RO_TID));
      const aandeZ = roVaegt * AANDE_ZOOM * Math.sin(ur * TAU / AANDE_PERIODE_Z);
      const zGlat = Math.exp(lz);
      zoomNu = zGlat * (1 - punchNu) * (1 + aandeZ);
      r.tilpas(zoomNu);

      // ---- position: klem til banen, så fjederen
      klemTilBane(t, mx, my, r.bredde / 2, r.hoejde / 2, top, side);
      if (fri && figurRamme && kigT <= 0.0005) {
        // Panorer man ud over kanten, må forskydningen ikke hobe sig op.
        friX += k.x - mx; friY += k.y - my;
      }
      glat.x = glatDaemp(glat.x, k.x, hastX, ft, dt);
      glat.y = glatDaemp(glat.y, k.y, hastY, ft, dt);
      glat.zoom = zGlat;
      glat.tilstand = tilstand;

      let x = glat.x, y = glat.y;
      if (roVaegt > 0.001) {
        x += roVaegt * AANDE_X * Math.sin(ur * TAU / AANDE_PERIODE_X);
        y += roVaegt * AANDE_Y * Math.sin(ur * TAU / AANDE_PERIODE_Y + 1.3);
      }
      if (ryst > 0.001) {
        ryst *= Math.pow(0.5, dt / RYST_HALV);
        const amp = ryst * RYST_ANDEL * r.hoejde * (red ? REDUCERET_RYST : 1);
        x += amp * stoej(ur, rystFaseX);
        y += amp * stoej(ur * 0.87, rystFaseY);
      } else ryst = 0;
      p.x = x; p.y = y;
    },
  };

  glat.x = p.x; glat.y = p.y;
  return api;
}
