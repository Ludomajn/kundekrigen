/* Kundekrigen — procedurel banegenerering.
 *
 * Designmål (efter playtest): FÆRRE SPIDSER, STØRRE FLADER, LÆNGERE
 * AFSTANDE, MERE HØJDE — og vand i bunden man kan falde i.
 *
 * Opskriften og hvorfor hvert trin er der:
 *   1. Højdekurven bruger få oktaver og lav frekvens. Mange oktaver gav et
 *      savtakket landskab, hvor der ikke var plads til at stå.
 *   2. Kurven TERRASSERES og glattes vandret. Det er dét, der skaber de store
 *      flader, man kan gå og kæmpe på, i stedet for konstante skrænter.
 *   3. Brede KANALER skæres ned gennem havoverfladen, så banen falder i
 *      adskilte landmasser med rigtigt vand imellem — det gør det muligt
 *      (og farligt) at blive skubbet ud over kanten.
 *   4. Densitetsfeltet regnes i kvart opløsning; skarphed kommer af at
 *      tærskle et bilineært opskaleret felt, ikke af feltets opløsning.
 *   5. Domæneforvrængningen er dæmpet kraftigt i forhold til før. Lidt giver
 *      overhæng og karakter; meget gav uspilleligt krat.
 *   6. Til sidst valideres at der ER flade nok til at sætte bævere.
 */
'use strict';

import { lavRng, fbm1, fbm2, hash2 } from '../core/rng.js';
import { Terraen, LUFT, JORD, FJELD, MUR } from './terrain.js';

export const BANE_B = 5120;          // længere afstande
export const BANE_H = 1792;          // mere højde
export const VAND_NIVEAU = 300;      // havets overflade i world units
const SKALA = 4;
const FJELD_BUND = 16;

// Fortet først: det er standardbanen og står øverst i lobbyen.
export const BANE_TYPER = ['fort', 'aaben', 'hule', 'oeer'];

const TYPE = {
  // basis/amp er andele af banehøjden. De er sat, så landet ligger LAVT nok
  // til at havet er med i billedet, når man står på et plateau — ellers ser
  // man aldrig det vand, man kan falde i. Faldhøjden fra top til vand er
  // stadig 500-600 wu, altså næsten en skærm.
  aaben: { basis: 0.36, amp: 0.17, terrasse: 120, blod: 28, kanal: 0.40, kanalDybde: 1300,
           kanaler: [3, 5], huleTaerskel: 0.66, warp: 42 },
  hule:  { basis: 0.45, amp: 0.13, terrasse: 150, blod: 38, kanal: 0.26, kanalDybde: 1000,
           kanaler: [2, 3], huleTaerskel: 0.56, warp: 48 },
  oeer:  { basis: 0.38, amp: 0.19, terrasse: 105, blod: 24, kanal: 0.52, kanalDybde: 1900,
           kanaler: [5, 8], huleTaerskel: 0.70, warp: 38 },
};

export function genererBane(froe, type = 'aaben', bBredde = BANE_B, bHoejde = BANE_H, layout = null) {
  if (type === 'fort') return genererFort(froe, layout, bBredde, bHoejde);
  const P = TYPE[type] || TYPE.aaben;
  const t = new Terraen(bBredde, bHoejde);
  const fw = Math.ceil(bBredde / SKALA), fh = Math.ceil(bHoejde / SKALA);

  const hFroe = (froe ^ 0x9e3779b9) >>> 0;
  const wFroe = (froe * 2654435761) >>> 0;
  const cFroe = (froe ^ 0x85ebca6b) >>> 0;
  const kFroe = (froe ^ 0x27d4eb2f) >>> 0;

  // --- 1. rå højdekurve: få oktaver, lav frekvens
  const raa = new Float32Array(fw);
  const basis = bHoejde * P.basis;
  const amp = bHoejde * P.amp;
  for (let x = 0; x < fw; x++) {
    const wx = x * SKALA;
    const n = fbm1(wx * 0.00055, hFroe, 3, 0.45);
    raa[x] = basis + (n - 0.5) * 2 * amp;
  }

  // --- 2. terrassering + vandret udglatning = store flader
  const terr = new Float32Array(fw);
  for (let x = 0; x < fw; x++) {
    const h = raa[x];
    const snappet = Math.round(h / P.terrasse) * P.terrasse;
    terr[x] = h + (snappet - h) * 0.62;
  }
  const hoejde = boksBlur(terr, P.blod);

  // --- 3. kanaler ned gennem havet, så landet deles i massiver
  //
  // Støjbaserede kanaler alene var ikke til at stole på: på mange frø gav de
  // slet ingen vandgennembrud, og så var havet kun en kant man aldrig så.
  // Derfor GARANTERES et antal kanaler, og støjen lægges ovenpå som variation.
  const rng = lavRng(kFroe);
  const antalKanaler = P.kanaler[0] + Math.floor(rng() * (P.kanaler[1] - P.kanaler[0] + 1));
  const kanaler = [];
  for (let n = 0; n < antalKanaler; n++) {
    // Spredt ud over banen med lidt slør, så de ikke står på række.
    const t0 = (n + 0.5) / antalKanaler;
    const midte = (t0 + (rng() - 0.5) * 0.5 / antalKanaler) * fw;
    const halvBredde = (150 + rng() * 230) / SKALA;
    kanaler.push({ midte, halvBredde });
  }

  const havbund = VAND_NIVEAU - 150;       // godt under vandlinjen

  for (let x = 0; x < fw; x++) {
    const wx = x * SKALA;

    // (a) garanterede kanaler — cosinusprofil, så kanterne skråner i vandet
    for (const kan of kanaler) {
      const d = Math.abs(x - kan.midte) / kan.halvBredde;
      if (d >= 1) continue;
      const dyb = 0.5 + 0.5 * Math.cos(d * Math.PI);        // 1 i midten, 0 i kanten
      const maal = havbund + (1 - dyb) * 260;
      hoejde[x] = Math.min(hoejde[x], hoejde[x] + (maal - hoejde[x]) * dyb);
    }

    // (b) støjkanaler ovenpå, som variation
    const k = fbm1(wx * 0.00042 + 31.7, kFroe, 2, 0.55);
    if (k < P.kanal) {
      const dybde = (P.kanal - k) / P.kanal;
      hoejde[x] -= dybde * P.kanalDybde;
    }

    // (c) begge bankanter ender altid i havet, så ingen kan campe i hjørnet
    const kant = Math.min(x, fw - 1 - x) / (fw * 0.07);
    if (kant < 1) {
      const t2 = 1 - kant;
      hoejde[x] = Math.min(hoejde[x], hoejde[x] + (havbund - hoejde[x]) * t2 * t2);
    }
  }

  // --- 4. densitetsfelt med dæmpet forvrængning
  const felt = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    const wy = y * SKALA;
    for (let x = 0; x < fw; x++) {
      const wx = x * SKALA;
      const w1 = (fbm2(wx * 0.0013, wy * 0.0013, wFroe, 2) - 0.5) * 2;
      const w2 = (fbm2(wx * 0.0013 + 5.2, wy * 0.0013 + 1.7, wFroe ^ 0x55, 2) - 0.5) * 2;
      const px = wx + w1 * P.warp, py = wy + w2 * P.warp;

      const hx = Math.min(fw - 1, Math.max(0, Math.round(px / SKALA)));
      let d = hoejde[hx] - py;

      // Mætning: dybere end 240 er lige så fast som 240. Uden den vokser
      // densiteten ubegrænset nedad, og hulestøjen kan aldrig bryde igennem.
      if (d > 240) d = 240;

      const dybde = hoejde[hx] - py;
      if (dybde > 90) {
        const c = fbm2(px * 0.0022, py * 0.0030, cFroe, 3);
        const styrke = Math.min(1, (dybde - 90) / 220);
        if (c > P.huleTaerskel) d -= (c - P.huleTaerskel) * 2600 * styrke;
      }
      felt[y * fw + x] = d;
    }
  }

  // --- 5. tærskling med bilineær opskalering og let dither
  for (let y = 0; y < bHoejde; y++) {
    const fy = y / SKALA;
    const y0 = Math.min(fh - 1, Math.floor(fy)), y1 = Math.min(fh - 1, y0 + 1);
    const ty = fy - y0;
    const raekke = (bHoejde - 1 - y) * bBredde;
    for (let x = 0; x < bBredde; x++) {
      const fx = x / SKALA;
      const x0 = Math.min(fw - 1, Math.floor(fx)), x1 = Math.min(fw - 1, x0 + 1);
      const tx = fx - x0;
      const a = felt[y0 * fw + x0], b = felt[y0 * fw + x1];
      const c = felt[y1 * fw + x0], d2 = felt[y1 * fw + x1];
      const oe = a + (b - a) * tx, ne = c + (d2 - c) * tx;
      const v = oe + (ne - oe) * ty;
      const dither = (hash2(x, y, froe) - 0.5) * 1.2;
      t.maske[raekke + x] = (v + dither) > 0 ? JORD : LUFT;
    }
  }

  despeckle(t);
  fjernSmaaStumper(t, 900);

  // --- 6. havbund: grundfjeld helt i bunden, godt under vandlinjen
  for (let y = 0; y < FJELD_BUND; y++) {
    const raekke = (bHoejde - 1 - y) * bBredde;
    for (let x = 0; x < bBredde; x++) t.maske[raekke + x] = FJELD;
  }

  t.snavs = { x0: 0, y0: 0, x1: bBredde - 1, y1: bHoejde - 1 };
  t.vandNiveau = VAND_NIVEAU;
  return t;
}

/** Vandret boksblur — dét, der forvandler takker til flader. */
function boksBlur(kilde, radius) {
  const n = kilde.length;
  const ud = new Float32Array(n);
  const vindue = radius * 2 + 1;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += kilde[klemIdx(i, n)];
  for (let x = 0; x < n; x++) {
    ud[x] = sum / vindue;
    sum -= kilde[klemIdx(x - radius, n)];
    sum += kilde[klemIdx(x + radius + 1, n)];
  }
  return ud;
}
const klemIdx = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

/** Fjern enkeltpixel-støj over 4-naboskabet. En fuld 3x3-lukning kostede
 *  187 ms i closure-kald; det her giver visuelt det samme for en brøkdel. */
function despeckle(t) {
  const { w, h, maske } = t;
  const kopi = maske.slice();
  for (let y = 1; y < h - 1; y++) {
    const r = (h - 1 - y) * w;
    const op = r - w, ned = r + w;
    for (let x = 1; x < w - 1; x++) {
      const n = (kopi[op + x] !== LUFT ? 1 : 0) + (kopi[ned + x] !== LUFT ? 1 : 0)
              + (kopi[r + x - 1] !== LUFT ? 1 : 0) + (kopi[r + x + 1] !== LUFT ? 1 : 0);
      if (kopi[r + x] !== LUFT) { if (n === 0) maske[r + x] = LUFT; }
      else if (n === 4) maske[r + x] = JORD;
      // 1 px sprækker mellem to faste sider lukkes også: med konturen i
      // terrænshaderen ville de ellers stå som mørke hårstreger.
      else if ((kopi[r + x - 1] !== LUFT && kopi[r + x + 1] !== LUFT) ||
               (kopi[op + x] !== LUFT && kopi[ned + x] !== LUFT)) maske[r + x] = JORD;
    }
  }
}

/** Fjern løsrevne klatter under en størrelse. Store svævende øer BEHOLDES.
 *
 *  Hver komponent fyldes HELT, også når den tydeligvis er stor. En tidligere
 *  udgave stoppede ved et loft for at spare tid — men så lå halvt besøgte
 *  pixels tilbage som mure, og den næste fyldning inde i samme landmasse så
 *  en "lille klat" mellem dem og slettede den. Resultatet var 1 px brede,
 *  hundredvis af pixels lange revner lodret ned gennem bjergene. */
function fjernSmaaStumper(t, mindste) {
  const { w, h, maske } = t;
  const set = new Uint8Array(maske.length);
  const stak = [];
  const komponent = [];
  for (let start = 0; start < maske.length; start++) {
    if (set[start] || maske[start] === LUFT) continue;
    let n = 0;
    stak.length = 0;
    komponent.length = 0;
    stak.push(start); set[start] = 1;
    while (stak.length) {
      const i = stak.pop();
      if (n < mindste) komponent.push(i);
      n++;
      const cx = i % w;
      // Indeks-naboer: samme række +-1, rækken over/under +-w.
      if (cx + 1 < w) { const j = i + 1; if (!set[j] && maske[j] !== LUFT) { set[j] = 1; stak.push(j); } }
      if (cx > 0) { const j = i - 1; if (!set[j] && maske[j] !== LUFT) { set[j] = 1; stak.push(j); } }
      if (i + w < maske.length) { const j = i + w; if (!set[j] && maske[j] !== LUFT) { set[j] = 1; stak.push(j); } }
      if (i - w >= 0) { const j = i - w; if (!set[j] && maske[j] !== LUFT) { set[j] = 1; stak.push(j); } }
    }
    if (n < mindste) for (const i of komponent) maske[i] = LUFT;
  }
}

/** Find overfladepunkter der er flade nok og højt nok over vandet. */
export function findStartpladser(t, vandNiveau = VAND_NIVEAU) {
  const pladser = [];
  const TRIN = 16;
  for (let x = 80; x < t.w - 80; x += TRIN) {
    const y = t.overflade(x);
    if (y < 0 || y < vandNiveau + 90) continue;
    let flad = true;
    for (let dx = -24; dx <= 24; dx += 12) {
      const yy = t.overflade(x + dx);
      if (yy < 0 || Math.abs(yy - y) > 18) { flad = false; break; }
    }
    if (!flad) continue;
    let frit = true;
    for (let dy = 1; dy <= 34; dy++) if (t.fast(x, y + dy)) { frit = false; break; }
    if (frit) pladser.push({ x, y: y + 1 });
  }
  return pladser;
}

/** Generér, og prøv igen med nyt frø hvis banen ikke kan huse bæverne.
 *  layout ({ antalHold, prHold }) bruges kun af fortet og SKAL være det samme
 *  hos værten, spejlet og gæsterne — ellers bygges der andre forter. */
export function genererSpilbar(froe, type, antalBaevere, layout = null, forsoeg = 8) {
  if (typeof layout === 'number') { forsoeg = layout; layout = null; }
  const lay = type === 'fort' ? fortLayout(layout, antalBaevere) : null;
  let sidste = null;
  for (let i = 0; i < forsoeg; i++) {
    const f = (froe + i * 7919) >>> 0;
    const terraen = genererBane(f, type, BANE_B, BANE_H, lay);
    const pladser = findStartpladser(terraen);
    sidste = { terraen, pladser, froe: f };
    // Fortets startpladser er bygget ind i planen og findes altid; første
    // forsøg holder desuden froeBrugt === froe, som snapshottet forudsætter.
    if (lay || pladser.length >= antalBaevere * 3) return sidste;
  }
  return sidste;
}

/* ------------------------------------------------------------------ fortet
 *
 * Fort-tilstand som i Worms: to (eller tre-fire) store, klodsede borge over
 * åbent hav. Der er intet land imellem — hullet er hav, man drukner, hvis man
 * falder i, og ingen kan gå eller hoppe over til fjenden. Hver klinik har sin
 * egen borg med lige så mange ETAGER, som klinikken har kunder (1-4; over
 * fire står de ekstra side om side på de nederste etager), og kunderne
 * starter én pr. etage nedefra.
 *
 * Borgen set fra siden med fjenden til højre (de spejlvendte er ens):
 *
 *                                                         ┌┐┌┐┌┐┌┐┌┐
 *      ┌┐                                                 │  ⌒  ⌒  │ fortårnet:
 *      ││┌┐┌┐┌┐ keep            ┌┐┌┐┌┐ porttårn           │ ▯  ▯   │ højest, mod
 *    ┌┐││ ╲    │                │ ⌒⌒ │                    ├────────┤ fjenden
 *    │ └┘  ╲rampe dør          ┌┤▯  ▯├┐                   │ udkig ▯│ skydeskår
 *    │ ∩  ████████════════════ tag ═══════════════════════┤dør     │
 *    │    ███ ∩∩ ████╲╲ løb  ⌒⌒ hal ⌒ ▯ ⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒ dør│ rum   ▯│
 *   ┌┤ ∩∩ ███████████████╲╲ ═ hul ═══════════════════════════╪════════╡ gesims
 *   ││    ████ ∩ ███ ∩ ███████╲╲ ▁▁ kamre ▁│▁ ▁▁▁▁▁▁▁▁▁▁▁▁ dør│ rum   ▯│
 *   │an-  ▓▓∩▓▓▓▓∩▓▓▓▓∩▓▓▓▓▓▓▓▓▓▓▓▓▓▓ massiv sokkel ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ plint
 *  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ hav
 *
 * - Borgen er mest MASSIV STEN med rum skåret ind (som i Worms): tykke mure
 *   (facade 52, ydermure 40, indervægge 34) og dæk på 36 wu.
 * - FORTÅRNET mod fjenden er borgens højeste tårn. Det har kundernes rum, ét
 *   pr. etage, under en rund bue med et skydeskår i facaden over en
 *   brystning på 48 wu (højere end en kunde, 46; 18 wu tyk, så mundingen når
 *   ud over den, når man står helt fremme). Skåret vider sig ud udad. Et lige
 *   skud fra fjendens tilsvarende etage kan derfor ikke nå kunden (det skulle
 *   op over begge brystninger og ned igen), mens kunden selv skyder ud i en
 *   bue. En dør fører ind til etagens hal. Over taget har tårnet et
 *   udkigskammer med dør fra taget og samme skydeskår; derover er det
 *   massivt med vinduer, man ser igennem, og en udkraget krone med tinder og
 *   måske et vagttårn på det forreste hjørne — toppen er kun til pynt.
 * - HALLERNE forbinder trappen med rummene: hvælvede haller eller lave gange
 *   med høje kamre, måske delt af en skillevæg med en dør, lavere over de
 *   nederste løb, og med vinduer i bagvæggen (en åben arkade: i alle fag).
 * - TRAPPELØBENE (60°) går op mod bagsiden som tunneler i murværket — sten
 *   under og over, kun frihøjde over løbet. Løbene flytter sig ét løb + en
 *   repos bagud pr. etage, og det øverste ender på taget foran keepen. I 2D
 *   er det den eneste trappe, man kan gå hele vejen op ad. Dækket over hvert
 *   løbs top har et hul (~37 wu i oversiden). Op en etage: gå mod bagsiden
 *   (falder man i hullet, lander man på løbet og går videre op); oppe vender
 *   man og hopper over hullet ud mod facaden.
 * - Under og bag trappen er borgen massiv med buer: nogle man ser himlen
 *   igennem (også en høj over to etager), andre blændede og mørke, i grupper
 *   af forskellig bredde pr. etage.
 * - KEEPEN bagest er lavere end fortårnet (siluetten trappes ned væk fra
 *   fjenden): en rampe inde i den fra en dør på taget op til toppen, eller en
 *   skrå forside, man går op ad (altid, når keepen er lav). Måske et
 *   kronetårn på det bageste hjørne. Er keepen trukket ind, trappes bagsiden
 *   med en terrasse med tinder, og bagerst står måske et lavere anneks. Midt
 *   på taget står måske et porttårn, man går igennem.
 * - Soklen er massiv under hele den forreste del (intet hul til havet under
 *   kunderne); havbuerne sidder kun under den bageste del. Gesimser markerer
 *   etagerne, og der er altaner med skråstiver.
 *
 * Med tre klinikker (og fem) er midterborgen DOBBELTSIDET: den samme borg
 * skåret i keepen og spejlet, så den har et fortårn i hver ende; kunderne
 * skifter side pr. etage (to på en etage: én i hver side). Med fire (og
 * seks) står borgene parvis facade mod facade: → ← → ←.
 *
 * Havet mellem to borge er mindst så bredt, at et hop eller en salto fra
 * borgens højeste punkt ikke når den næste (fortPlan, rakkevidde); er der
 * ikke plads på banen, skæres pynt, der koster bredde, væk (trim).
 *
 * Alt murværk er MUR og destruktibelt; kun havbunden er FJELD. Alle borge er
 * samme variant (spejlet, også på pixelniveau for fysikken — se fortPlan) og
 * afhænger kun af (frø, layout).
 *
 * Til terrain_view.js: fort.rum er rektangler, hvor LUFT er bygningens indre
 * (bagvæg, G = 128): hver etage fra dens løb til facadens inderside (haller,
 * rum, løbenes tunneler og hullerne), udkigskammeret, keepens indre over
 * taget, porttårnets gennemgang og de blændede buer. Vinduerne i hallernes
 * bagvæg, skydeskårene i facaden, buerne man ser igennem, havbuerne,
 * vinduerne i tårnene, terrasserne og alt over taget er ikke med: dér ser man
 * himlen. Masken selv er kun MUR og LUFT (og JORD/FJELD i havbunden).
 */
const FORT = {
  bund: VAND_NIVEAU + 110,     // stueetagens gulv (+40 med én etage)
  daek: 36,                    // etagedæk og tårntoppe
  mur: 40,                     // ydermure
  facade: 52,                  // fortårnets facade mod fjenden
  indermur: 34,                // indervægge
  bryst: 48,                   // brystningen under skydeskåret: over en kundes 46
  brystB: 18,                  // … og tynd nok til, at mundingen når ud over den
  doer: 66,                    // døråbninger
  hoved: 46,                   // frihøjde over løb og ramper (figuren er 46)
  ankomst: 34,                 // plads til at stå ved en rampes top
  sokkel: VAND_NIVEAU - 70,    // soklens underkant, godt under vandlinjen
  klippe: VAND_NIVEAU - 50,    // klippens top under borgen
  havbund: 110,                // havbunden mellem borgene
  tand: 44, tandB: 36, skaar: 30,   // tinder: højde, bredde, skår
  krone: 16,                   // tårntoppenes udkragning
  gesims: 20,                  // gesimserne ved hvert dæk
  plint: 18,                   // plinten foran facaden ved vandlinjen
  forrest: 62,                 // første kunde: så langt inde bag facaden
  side: 76,                    // næste kunde side om side
  kant: 100,                   // mindst så meget åbent hav ud mod banens ender
  sT: 1.7,                     // keeprampens stigning (som trappeløbene)
};
/* Toppen over vandet med 1-4 etager (± 20; P.top trækker fra med flere borge). */
const TOP_MAAL = [0, 650, 770, 880, 990];
/* Pr. antal klinikker: etagehøjde E, løbenes stigning s (1,7 = 60°), reposen
 * mellem løbene, fortårnets mindste bredde, hal 0's længde, borgens mindste
 * bredde med én etage (+50 pr. etage), keepens højde over taget (brøker af
 * E), toppens fradrag, havet mellem to facader og mellem to bagsider
 * (mindst; se rakkevidde), og pynten, der koster bredde: keepen trukket ind,
 * facaden trappet (sandsynlighed, min, maks), anneks bagpå (sandsynlighed,
 * bredde, trin) og altanen bagpå. */
const FORT_HOLD = [null,
  { E: 160, s: 1.7, repos: 30, ft: 240, hal: [90, 150], Wmin: 820, tk: [0.35, 0.7], top: 0, hav: 430, havB: 300,
    ki: 0.6, trinF: [0.5, 30, 50], anneks: [1, 70, 110, 0.6], bagAltan: 56 },
  { E: 160, s: 1.7, repos: 30, ft: 240, hal: [90, 150], Wmin: 820, tk: [0.35, 0.7], top: 0, hav: 430, havB: 300,
    ki: 0.6, trinF: [0.5, 30, 50], anneks: [1, 70, 110, 0.6], bagAltan: 56 },
  { E: 156, s: 1.8, repos: 28, ft: 232, hal: [50, 90], Wmin: 700, tk: [0.3, 0.6], top: -20, hav: 420, havB: 300,
    ki: 0.5, trinF: [0.4, 28, 44], anneks: [0.8, 60, 90, 0.4], bagAltan: 46 },
  { E: 150, s: 2.0, repos: 24, ft: 216, hal: [30, 50], Wmin: 600, tk: [0.3, 0.5], top: -40, hav: 420, havB: 260,
    ki: 0.3, trinF: [0.3, 24, 36], anneks: [0, 0, 0, 0], bagAltan: 30 },
  { E: 144, s: 2.0, repos: 24, ft: 200, hal: [26, 30], Wmin: 500, tk: [0.3, 0.4], top: -80, hav: 200, havB: 120,
    ki: 0, trinF: [0, 0, 0], anneks: [0, 0, 0, 0], bagAltan: 0 },
  { E: 140, s: 2.1, repos: 22, ft: 190, hal: [26, 30], Wmin: 450, tk: [0.3, 0.4], top: -100, hav: 150, havB: 80,
    ki: 0, trinF: [0, 0, 0], anneks: [0, 0, 0, 0], bagAltan: 0 },
];

/** Normalisér layoutet: 1-6 klinikker, 1-8 kunder pr. klinik. */
export function fortLayout(layout, antalBaevere = 4) {
  const antalHold = Math.max(1, Math.min(6, Math.round(layout?.antalHold) || 2));
  const prHold = Math.max(1, Math.min(8,
    Math.round(layout?.prHold) || Math.ceil(antalBaevere / antalHold)));
  return { antalHold, prHold };
}

/** Hvor langt et hop (HOP_VX 160, HOP_VY 235, tyngde 480, maks faldfart
 *  780) når frem, når man lander d wu lavere — plus kapslens bredde. */
function rakkevidde(d) {
  const tCap = (235 + 780) / 480, dCap = 780 * 780 / 960 - 235 * 235 / 960;   // 576 wu
  const t = d <= dCap ? (235 + Math.sqrt(235 * 235 + 960 * d)) / 480 : tCap + (d - dCap) / 780;
  return 160 * t + 16;
}

/** Borgens variant i LOKALE koordinater: lx = 0 er bagsiden, lx = W-1 er
 *  stueetagens facade mod fjenden, y som på banen. Ren funktion af layout,
 *  frø og trim: alle tilfældige tal trækkes først, og trim (0-4) skærer
 *  bagefter pynt væk, der koster bredde, hvis borgene ikke kan stå på banen
 *  med hav nok imellem (fortPlan prøver 0, 1, 2 …). */
function fortVariant(L, froe, trim = 0) {
  const n = Math.max(1, Math.min(4, L.prHold));
  const P = FORT_HOLD[L.antalHold];
  const rng = lavRng((froe ^ 0x3243f6a8) >>> 0);
  const tal = [];
  for (let i = 0; i < 40; i++) tal.push(rng());
  let ti = 0;
  const r = () => tal[ti++];
  const mellem = (ab) => ab[0] + r() * (ab[1] - ab[0]);
  const heltal = (a, b) => a + Math.floor(r() * (b - a + 1));
  const { E, s, repos } = P;
  const M = FORT.mur, MI = FORT.indermur, D = FORT.daek, MF = FORT.facade, K = FORT.krone, TD = FORT.tand, sT = FORT.sT;
  const Top = VAND_NIVEAU + 1000;
  const y = [];
  const bund = FORT.bund + (n === 1 ? 40 : 0);
  for (let k = 0; k <= n; k++) y.push(bund + k * E);
  const Ls = Math.round(E / s);                           // et løbs vandrette længde
  const hulB = Math.ceil((D + FORT.hoved) / s) + 10;      // hullet over løbets top
  const hulT = Math.ceil((D + FORT.hoved) / sT) + 10;     // … og over tårnrampernes
  // --- trækningerne (samme rækkefølge uanset trim)
  const rKi = r(), rKiB = heltal(40, 84);
  const tk = Math.round(E * mellem(P.tk));
  const rVt = r(), vtB = heltal(26, 34), vtUd = heltal(18, 26), vtH = heltal(56, 80);
  const rKt = r(), ktB = heltal(40, 48), ktH = heltal(60, 90);
  const topJ = heltal(-20, 20);
  const rTrin = r(), trinB = heltal(P.trinF[1], P.trinF[2]), rFra = r();
  const hal0 = heltal(P.hal[0], P.hal[1]), wJ = heltal(-20, 20);
  const rKU = r();
  const gb = heltal(100, 140), gp = r(), gh = Math.round(E * (0.68 + r() * 0.22)), rPort = r();
  const altanR = r(), altanL = heltal(30, 42);
  const rAn = r(), anB = heltal(P.anneks[1], P.anneks[2]), anH = Math.round(E * (0.45 + r() * 0.5)), rAnT = r(), anT = heltal(50, 86);
  const rBA = r(), baL = heltal(30, Math.max(30, P.bagAltan)), baK = Math.min(n, 1 + Math.floor(r() * n));
  const bagR = r();

  // Keepen bagest, måske trukket ind fra bagsiden (ki): lavere end fortårnet.
  const ki = trim < 1 && rKi < P.ki ? rKiB : 0;
  const Lk = Math.round(tk / sT);
  // Vagttårnet på fortårnets forreste hjørne tager noget af tårnets højde.
  let vt = trim < 3 && rVt < 0.5 ? { b: vtB, ud: vtUd, h: vtH } : null;
  // Fortårnet mod fjenden er højest. Over taget har det et udkigskammer med
  // skydeskår (dør fra taget) og er massivt derover; toppen er kun pynt.
  const tf = Math.max(Math.round(0.9 * E), 190, Math.min(Math.round(2.2 * E), Top - TD - y[n],
    TOP_MAAL[n] + P.top + topJ - (vt ? 30 : 0) - (y[n] - VAND_NIVEAU) - TD));
  const yK = y[n] + tk, yF = y[n] + tf;
  if (vt) { const h = Math.min(vt.h, Top - TD - yF); vt = h >= 40 ? { ...vt, h } : null; }
  const kammerH = 112;                                    // udkigskammerets loft over taget
  // Facaden trappes måske: de øvre etager og tårnet trukket tilbage.
  const trin1 = trim < 3 && rTrin < P.trinF[0] ? trinB : 0;
  const fra1 = n >= 3 && rFra < 0.5 ? 2 : 1;
  const af = [];
  for (let k = 0; k <= n; k++) af.push(k >= fra1 ? trin1 : 0);
  let hal = trim >= 2 ? P.hal[0] : hal0;
  const ft = P.ft - (trim >= 4 ? 16 : 0);
  // Keepens rampe: inde i keepen (en tunnel fra døren på taget) eller
  // udenpå (keepens forside er skrå, og man går op ad den).
  // Bredden: keep + trappe + hal 0 + fortårn; er borgen for smal, får hallen
  // lidt og keepen resten (mere massiv sten bagtil).
  let KB = ki + M + FORT.ankomst + Lk + 12 + MI;          // keepens forside
  const keepUde = rKU < 0.45 || tk < FORT.doer + D + 4;       // en lav keep har altid rampen udenpå
  if (keepUde) KB = ki + M + FORT.ankomst + 24 + Lk;      // toppen: bag rampen, der går ned til KB
  const W0 = KB + FORT.ankomst + (n - 1) * (Ls + repos) + Ls + hal + ft + af[n];
  const Wmin = P.Wmin + 50 * (n - 1) + wJ - (trim >= 2 ? 80 : 0);
  if (W0 < Wmin) { const ekstra = Wmin - W0, h1 = Math.min(ekstra, 40); hal += h1; KB += ekstra - h1; }
  // Løbene: løb k går fra (A[k] + Ls, y[k]) op mod bagsiden til (A[k], y[k+1]).
  const A = [];
  A[n - 1] = KB + FORT.ankomst;
  for (let k = n - 2; k >= 0; k--) A[k] = A[k + 1] + Ls + repos;
  const W = A[0] + Ls + hal + ft + af[n];
  const FT0 = W - af[n] - ft;                              // fortårnets bagside
  const Wk = af.map((a) => W - a);                        // etagernes facade

  // Kronetårnet på keepens bageste hjørne, udkraget over bagsiden (lavere
  // end fortårnet). Keepens krone rager kun ud over taget, hvis keepen er
  // høj nok til, at man kan gå under den.
  let kt = rKt < 0.6 ? { b: ktB, h: ktH } : null;
  const keepKrone = tk - D - FORT.krone >= 54;
  if (kt) { const h = Math.min(kt.h, yF - 24 - TD - yK, Top - TD - yK); kt = h >= 44 ? { ...kt, h } : null; }
  // Porttårnet midt på taget: gennemgang med døre i begge ender.
  const tagA = A[n - 1] + hulB + 50, tagB = FT0 - 70;
  const port = tagB - tagA >= gb + 20 && rPort < 0.75
    ? { a: Math.round(tagA + (tagB - tagA - gb) * (0.3 + 0.4 * gp)), h: gh } : null;
  if (port) port.b = port.a + gb - 1;
  // Altan med skråstiver på facaden (et dæk uden terrasse), kort, og en bagpå.
  const altanDaek = [];
  for (let k = 1; k < n; k++) if (Wk[k] === Wk[k - 1]) altanDaek.push(k);
  const altan = trim < 3 && altanDaek.length && altanR < 0.7 ? { k: altanDaek[Math.floor(altanR / 0.7 * altanDaek.length)], l: altanL } : null;
  const anneks = trim < 1 && rAn < P.anneks[0] ? { b: anB, h: anH, trin: rAnT < P.anneks[3] ? anT : 0 } : null;
  const bagAltan = trim < 1 && P.bagAltan && rBA < 0.6 ? { l: baL, k: baK } : null;
  // Er keepen trukket ind, står bagsiden kun op til dæk bagTrin — en
  // terrasse med tinder, og keepen rejser sig bag den.
  let bagTrin = n;
  if (ki && n >= 2 && bagR < 0.7) bagTrin = 1 + Math.floor(bagR / 0.7 * (n - 1));
  if (anneks && y[bagTrin] < y[0] + anneks.h + 40) bagTrin = n;
  const vindue = [Math.min(104, E - D - 20), Math.min(116, E - 30)];   // skydeskårets overligger inde/ude

  const v = { n, E, s, repos, ft, y, Ls, hulB, hulT, ki, tk, Lk, KB, A, af, W, FT0, Wk, tf, sT, kammerH,
              yK, yF, kronetaarn: kt, vagttaarn: vt, port, altan, anneks, bagAltan, bagTrin, vindue,
              keepUde, keepKrone, trim };
  fortPynt(v, lavRng((froe ^ 0x7f4a7c15) >>> 0));
  v.top = Math.max(yF + TD + (vt ? vt.h : 0), yK + TD + (kt ? kt.h : 0), port ? y[n] + port.h + TD : 0);
  // Steder bagtil, man kan stå på (oppe på en tinde), og hvor langt de er
  // fra bagsiden — til havet mellem to bagsider.
  v.bagPunkter = [{ lx: ki - K, y: yK + TD }];
  if (kt) v.bagPunkter.push({ lx: ki - kt.b, y: yK + kt.h + TD });
  if (ki >= 30) v.bagPunkter.push({ lx: -K, y: y[bagTrin] + TD });
  if (anneks) v.bagPunkter.push({ lx: -anneks.b - 8, y: y[0] + anneks.h + TD });
  if (bagAltan) v.bagPunkter.push({ lx: (bagAltan.k > bagTrin ? ki : 0) - bagAltan.l, y: y[bagAltan.k] + 24 });
  v.bagPunkter.push({ lx: -FORT.gesims, y: y[bagTrin] });
  return v;
}

/** Løb k's overflade i lokal x: y[k+1] bag toppen, y[k] foran foden. */
function loebY(v, k, lx) {
  const fod = v.A[k] + v.Ls;
  if (lx <= v.A[k]) return v.y[k + 1];
  if (lx >= fod) return v.y[k];
  return v.y[k] + (fod - lx) * v.s;
}

/** Fag fra a til b med piller (pb) imellem: skiftevis brede og smalle fag
 *  eller lige brede, skaleret så de fylder det hele. */
function lavFag(a, b, bred, smal, pb, skift) {
  const len = b - a + 1;
  const bredde = (j) => (skift && j % 2 ? smal : bred);
  let m = 1;
  for (;;) { let sum = m * pb; for (let j = 0; j <= m; j++) sum += bredde(j); if (sum > len) break; m++; }
  let sum = 0;
  for (let j = 0; j < m; j++) sum += bredde(j);
  const skala = (len - (m - 1) * pb) / sum;
  const ud = [];
  let x = a;
  for (let j = 0; j < m; j++) {
    const e = j === m - 1 ? b : Math.round(x + bredde(j) * skala) - 1;
    ud.push([x, e]);
    x = e + 1 + pb;
  }
  return ud;
}

/** Hallerne, buerne i den massive bagdel og havbuerne — data til bygBorg og
 *  fortIndhold, trukket af den samme rng. */
function fortPynt(v, rng) {
  const { n, y, E, A, Ls, ki, FT0, bagTrin } = v;
  const M = FORT.mur, D = FORT.daek;
  const heltal = (a, b) => a + Math.floor(rng() * (b - a + 1));
  // --- hallerne: hvælv, lave gange med høje kamre, eller én åben arkade
  v.haller = [];
  let arkade = false;
  for (let k = 0; k < n; k++) {
    const a = A[k] + v.Ls, b = FT0 - 1, len = b - a + 1;
    const r = rng();
    let stil = r < 0.42 ? 'hvaelv' : r < 0.78 ? 'kamre' : 'arkade';
    if (stil === 'arkade' && (arkade || k === 0 || len < 180)) stil = 'hvaelv';
    if (k > 0 && stil === v.haller[k - 1].stil && rng() < 0.65) stil = stil === 'kamre' ? 'hvaelv' : 'kamre';
    if (stil === 'arkade') arkade = true;
    const hal = { stil, a, b, vl: heltal(84, 94) };
    if (stil === 'kamre') {
      hal.lav = 100;
      hal.kamre = [];
      const antal = len > 300 ? 2 : len > 110 ? 1 : 0;
      for (let j = 0; j < antal; j++) {
        const s0 = a + Math.round(len * j / antal), s1 = a + Math.round(len * (j + 1) / antal) - 1;
        const cw = Math.min(heltal(64, 104), s1 - s0 - 40);
        if (cw < 44) continue;
        const c0 = s0 + 20 + Math.floor(rng() * (s1 - s0 - 40 - cw + 1));
        hal.kamre.push([c0, c0 + cw - 1]);
      }
    } else {
      hal.fag = lavFag(a + 8, b, heltal(96, 136), heltal(46, 70), heltal(26, 40), rng() < 0.55);
    }
    // En skillevæg med en dør deler måske hallen: en af hvælvets piller går
    // helt ned, eller en væg i gangen mellem kamrene. Aldrig ved hullet,
    // man hopper over, eller ved døren ind til rummet.
    hal.vaegge = [];
    const ha = k === 0 ? A[0] + v.Ls : A[k - 1] + v.hulB;
    const rV = rng(), rJ = rng(), rVin = rng(), rLav = rng();
    // Over de nederste løb er hallen en lavere gang (mere sten over den).
    hal.lavTil = k > 0 && rLav < 0.7 ? A[k - 1] + v.Ls + 10 : null;
    // Vinduer i bagvæggen: i hvert andet fag (eller i kamrene) ser man himlen
    // over en mørk brystning — arkaden er alle fag.
    hal.vinduer = [];
    const halvt = rVin < 0.5 ? 0 : 1;
    const hoej = (a0) => hal.lavTil == null || a0 > hal.lavTil;
    const vB = heltal(30, 44);
    const vindue = (a0, b0) => { const w = Math.min(vB, b0 - a0 - 24), c = Math.round((a0 + b0) / 2); if (w >= 22) hal.vinduer.push([c - (w >> 1), c - (w >> 1) + w - 1]); };
    if (hal.fag) hal.fag.forEach(([fa, fb], j) => {
      if (!hoej(fa)) return;
      if (stil === 'arkade' || (rVin < 0.75 && hal.fag.length >= 2 && j % 2 === halvt)) vindue(fa, fb);
    });
    else if (rVin < 0.6) for (const [c0, c1] of hal.kamre) if (hoej(c0)) vindue(c0, c1);
    if (hal.fag && hal.fag.length >= 3 && rV < 0.65) {
      const kand = [];
      for (let j = 1; j < hal.fag.length; j++) {
        const pa = hal.fag[j - 1][1] + 1 - 4, pb = hal.fag[j][0] - 1 + 4;
        if (pa - ha >= 70 && FT0 - pb >= 60) kand.push([pa, pb]);
      }
      if (kand.length) hal.vaegge.push(kand[Math.floor(rJ * kand.length)]);
    } else if (stil === 'kamre' && rV < 0.55) {
      const tw = 36, lo = ha + 70, hi = FT0 - 60 - tw;
      for (let i = 0; i < 6 && hi > lo; i++) {
        const x = lo + Math.floor(((rJ + i * 0.37) % 1) * (hi - lo));
        if (hal.kamre.every(([c0, c1]) => x + tw - 1 < c0 - 16 || x > c1 + 16)) { hal.vaegge.push([x, x + tw - 1]); break; }
      }
    }
    v.haller.push(hal);
  }
  // --- buer i den massive bagdel: pr. etage grupper af 1-3 buer af samme
  // bredde, skiftevis nogle man ser himlen igennem og blændede (mørke), og
  // måske én høj bue over to etager.
  v.buer = [];
  const bagX = (k) => (k >= bagTrin ? ki : 0) + M + 22;
  const optaget = [];                                        // [k, a, b]
  if (n >= 2 && rng() < 0.45) {
    const k = Math.floor(rng() * (n - 1));
    const xa = Math.max(bagX(k), bagX(k + 1)), xb = A[k + 1] - 46;
    const w = heltal(70, 108);
    if (xb - xa >= w) {
      const a = xa + Math.floor(rng() * (xb - xa - w + 1));
      v.buer.push({ a, b: a + w - 1, y0: y[k] + 18, y1: y[k + 2] - D - 18, slags: 'gennem' });
      optaget.push([k, a, a + w - 1], [k + 1, a, a + w - 1]);
    }
  }
  for (let k = 0; k < n; k++) {
    const xa = bagX(k), xb = A[k] - 46;
    let x = xa + heltal(0, 36);
    let slags = rng() < 0.6 ? 'gennem' : 'blind';
    while (x < xb - 40) {
      const c = rng() < 0.45 ? 1 : rng() < 0.65 ? 2 : 3;
      const w = c === 1 ? heltal(60, 124) : heltal(40, 78), p = heltal(22, 38);
      let bb = Math.min(c, Math.floor((xb - x + p) / (w + p)));
      if (bb < 1) break;
      const ende = x + bb * w + (bb - 1) * p - 1;
      const kolli = optaget.find(([kk, a, b]) => kk === k && a <= ende + 24 && b >= x - 24);
      if (kolli) { x = kolli[2] + 30 + heltal(0, 30); continue; }
      for (let j = 0; j < bb; j++) {
        const a = x + j * (w + p);
        v.buer.push({ a, b: a + w - 1, y0: y[k] + 18, y1: y[k + 1] - D - 18, slags });
      }
      x = ende + 1 + heltal(34, 80);
      slags = slags === 'gennem' ? (rng() < 0.7 ? 'blind' : 'gennem') : 'gennem';
    }
  }
  // --- havbuer: kun under den bageste del, aldrig under hallerne og rummene
  v.havbuer = [];
  {
    let x = (v.anneks ? 0 : -8) + 16 + heltal(0, 20);
    const xb = A[0] - 60;
    while (x < xb) {
      const w = heltal(46, 100), p = heltal(26, 52);
      if (x + w - 1 > xb) break;
      v.havbuer.push([x, x + w - 1]);
      x += w + p;
    }
  }
  // --- tårnvinduer (man ser igennem): i fortårnet over udkigskammeret
  v.vinduer = [];
  const { yF, tf, Wk, tk } = v;
  const WF = Wk[n], yR = y[n];
  {
    const y0 = yR + v.kammerH + D + 14, y1 = yF - D - 16;
    const a = FT0 + 24, b = WF - 24;
    if (y1 - y0 >= 56) {
      const to = b - a >= 150 && rng() < 0.6;
      const w = to ? heltal(34, 44) : Math.min(heltal(40, 56), b - a);
      if (to) {
        const g = heltal(24, 40), c = Math.round((a + b) / 2);
        v.vinduer.push({ a: c - g / 2 - w, b: c - g / 2 - 1, y0, y1 }, { a: c + g / 2, b: c + g / 2 + w - 1, y0, y1 });
      } else {
        const c = a + (w >> 1) + Math.floor(rng() * Math.max(1, b - a - w));
        v.vinduer.push({ a: c - (w >> 1), b: c - (w >> 1) + w - 1, y0, y1 });
      }
    } else if (y1 - y0 >= 40) {
      const r0 = Math.min(18, (y1 - y0) >> 1), c = Math.round((a + b) / 2);
      v.vinduer.push({ a: c - r0, b: c + r0, y0: y0, y1: y0 + 2 * r0, rund: true });
    }
  }
  {
    // keepen: en smal åbning i bagmuren over taget
    const { KB, Lk } = v;
    const kb = v.keepUde ? KB - Lk : KB - FORT.indermur - 12 - Lk;
    const c = ki + Math.round((kb - ki) / 2);
    if (tk >= 70 && kb - ki >= 50) v.vinduer.push({ a: c - 6, b: c + 6, y0: yR + 30, y1: yR + Math.min(tk - D - 20, 96), keep: true });
  }
}

/** Rektanglet r minus hullerne (rektangler) som en liste af rektangler. */
function minusHuller(r, huller) {
  const xs = [r.a, r.b + 1];
  for (const hh of huller) if (hh.x1 >= r.a && hh.x0 <= r.b) xs.push(Math.max(r.a, hh.x0), Math.min(r.b, hh.x1) + 1);
  xs.sort((p, q) => p - q);
  const ud = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1] - 1;
    if (b < a) continue;
    const iv = huller.filter((hh) => hh.x0 <= a && hh.x1 >= b).map((hh) => [hh.y0, hh.y1]).sort((p, q) => p[0] - q[0]);
    let y0 = r.y0;
    for (const [h0, h1] of iv) { if (h0 > y0) ud.push({ a, b, y0, y1: Math.min(r.y1, h0 - 1) }); y0 = Math.max(y0, h1 + 1); }
    if (y0 <= r.y1) ud.push({ a, b, y0, y1: r.y1 });
  }
  return ud;
}

/** Kunder, udstyrspladser, kasser, rum, trapper — alt i lokale koordinater
 *  for den enkeltsidede borg (facaden i lx = W). */
function fortIndhold(v, L) {
  const { n, y, FT0, KB, A, Ls, hulB, hulT, Wk } = v;
  const MI = FORT.indermur, MF = FORT.facade, K = FORT.krone, T = FORT.tandB;
  const antal = [];                                  // kunder pr. etage, nedefra
  for (let k = 0; k < n; k++) antal.push(Math.floor(L.prHold / n) + (k < L.prHold % n ? 1 : 0));
  const rA = FT0 + MI;
  const rum = [];                                    // kundernes rum pr. etage [a, b]
  const pladser = [];                                // pr. etage: forrest og bagerst
  for (let k = 0; k < n; k++) {
    const x1 = Wk[k] - MF - 1 - FORT.forrest;
    rum.push([rA, Wk[k] - MF - 1]);
    pladser.push([x1, Math.max(rA + 12, x1 - FORT.side)]);
  }
  // Udstyr: hallernes gulve foran løb og huller, taget foran hullet og
  // keepens top (aldrig i kundernes rum eller udkigskammeret).
  const kand = [];
  const linje = (a, b, yy, trin = 40) => { for (let x = Math.round(a); x <= b; x += trin) kand.push({ lx: x, y: yy }); };
  for (let k = 0; k < n; k++) linje((k === 0 ? A[0] + Ls : A[k - 1] + hulB) + 18, FT0 - 22, y[k]);
  const g = v.port;
  // Keepens rampe går mod bagsiden.
  const ka = v.keepUde ? KB : KB - MI - 12, kb = ka - v.Lk;
  const tagA = A[n - 1] + hulB + 18, tagB = FT0 - 22;
  for (let x = tagA; x <= tagB; x += 40) if (!(g && x >= g.a - 20 && x <= g.b + 20)) kand.push({ lx: x, y: y[n] });
  const keepBag = [v.kronetaarn ? v.ki + v.kronetaarn.b + 10 : v.ki - K + T + 10, kb - 12];
  if (keepBag[1] - keepBag[0] >= 0) kand.push({ lx: Math.round((keepBag[0] + keepBag[1]) / 2), y: v.yK, top: true });
  // Forsyningskasser slippes over taget og keepens top (ikke over
  // porttårnet, kronetårnet og fortårnet, som man ikke kan komme op på).
  const kasser = [];
  for (let x = tagA; x <= tagB; x += 20) if (!(g && x >= g.a - 24 && x <= g.b + 24)) kasser.push(x);
  for (let x = keepBag[0]; x <= keepBag[1]; x += 20) kasser.push(x);
  // Bagvæg: hver etage fra dens løb til facadens inderside (tunnelen, hullet
  // og dækket over med) minus vinduerne i bagvæggen; udkigskammeret, keepens
  // indre (når rampen er inde), porttårnet og de blændede buer.
  const vinduer = v.vinduer.map((w) => ({ x0: w.a, x1: w.b, y0: w.y0, y1: w.y1 }));
  const bag = [];
  for (let k = 0; k < n; k++) {
    const hal = v.haller[k];
    const r = { a: A[k] - 12, b: Wk[k] - MF - 1, y0: y[k] + 1, y1: y[k + 1] };
    // Vinduerne i bagvæggen: man ser himlen gennem en trappet rundbue over en
    // mørk brystning (bagvæggen er rektangler, så buen er trin).
    const huller = [];
    for (const [a, b] of hal.vinduer) {
      const top = y[k] + Math.min(hal.stil === 'kamre' ? 112 : hal.vl + 20, y[k + 1] - FORT.daek - y[k] - 4), bund = y[k] + 44;
      const hb = (b - a + 1) / 2;
      huller.push({ x0: a, x1: b, y0: bund, y1: Math.round(top - hb * 0.7) });
      for (const [ind, h0, h1] of [[0.13, 0.7, 0.42], [0.3, 0.42, 0.2], [0.55, 0.2, 0]]) {
        huller.push({ x0: Math.round(a + hb * ind), x1: Math.round(b - hb * ind), y0: Math.round(top - hb * h0) + 1, y1: Math.round(top - hb * h1) });
      }
    }
    bag.push(...minusHuller(r, huller));
  }
  if (!v.keepUde) bag.push(...minusHuller({ a: v.ki, b: KB - 1, y0: y[n] + 1, y1: v.yK }, vinduer));
  bag.push({ a: FT0, b: Wk[n] - MF - 1, y0: y[n] + 1, y1: y[n] + v.kammerH });
  if (g) bag.push({ a: g.a, b: g.b, y0: y[n] + 1, y1: y[n] + g.h - FORT.daek });
  for (const bu of v.buer) if (bu.slags === 'blind') bag.push({ a: bu.a, b: bu.b, y0: bu.y0, y1: bu.y1 });
  // Trapperne til testene: løb og huller, keepens rampe og udkigskammeret.
  const trapper = [];
  // hul: åbningen i dækkets overside (tunnelen skærer dækket nedefra lidt længere frem)
  const hulTop = Math.ceil(10 + FORT.hoved / v.s);
  for (let k = 0; k < n; k++) trapper.push({ fra: y[k], til: y[k + 1], top: A[k], fod: A[k] + Ls, hul: [A[k], A[k] + hulTop] });
  const ramper = { keep: { fod: ka, top: kb, fra: y[n], til: v.yK, hul: v.keepUde ? [kb, kb] : [kb, kb + hulT], ude: v.keepUde },
                   udkig: { fod: rA, top: Wk[n] - MF - 1, fra: y[n], til: y[n], hul: [rA, rA] } };
  return { antal, pladser, rum, kand, kasser, bag, trapper, ramper };
}

/** Fortenes geometri og placering. Ren funktion af layout, banebredde og frø.
 *
 *  Retning pr. borg: 1 = facaden mod højre, -1 = mod venstre, 0 =
 *  dobbeltsidet (midterborgen med et ulige antal). Med et lige antal står
 *  borgene parvis facade mod facade. Havet mellem to borge er mindst så
 *  bredt, at et hop fra borgens højeste punkt (eller en salto) ikke når
 *  over: rakkevidde fra toppen ned til den andens plint + 24 (mellem to
 *  bagsider fra det højeste, man kan stå på bagtil). Passer det ikke på
 *  banen, prøves trim 1-4 (fortVariant). */
export function fortPlan(layout, bBredde = BANE_B, froe = 0) {
  const L = fortLayout(layout);
  let plan = null;
  for (let trim = 0; trim <= 4 && !(plan && plan.passer); trim++) plan = fortPlanTrim(L, bBredde, froe, trim);
  return plan;
}

function fortPlanTrim(L, bBredde, froe, trim) {
  const v = fortVariant(L, froe, trim);
  const ind = fortIndhold(v, L);
  const P = FORT_HOLD[L.antalHold];
  const H = L.antalHold, n = v.n;
  // Borgens fodaftryk i lokale koordinater: anneks/altan bagtil og
  // plint/altan/gesims/krone/vagttårn fortil.
  const bag = Math.max(FORT.krone, FORT.gesims, v.anneks ? v.anneks.b + Math.max(8, v.anneks.trin) : 0, v.bagAltan ? v.bagAltan.l : 0,
    v.kronetaarn ? v.kronetaarn.b - v.ki : 0);
  const for_ = Math.max(FORT.plint, FORT.krone, FORT.gesims, v.altan ? v.altan.l : 0, v.vagttaarn ? v.vagttaarn.ud : 0);
  v.lx0 = -bag - 100; v.lx1 = v.W - 1 + for_ + 100;          // byggegitteret (med klippens skrænter)
  const f0 = -bag, f1 = v.W - 1 + for_;                       // fodaftrykket
  // Den dobbeltsidede borg: den samme borg skåret i keepen (c) og spejlet —
  // eller, hvis der ikke er plads, lige foran keepen (så er der ingen keep).
  const c = trim >= 2 ? v.KB : v.KB - Math.max(70, FORT.indermur + 44);
  v.c = c;
  const retn = [];
  for (let i = 0; i < H; i++) {
    if (H === 1) retn.push(1);
    else if (H % 2 && 2 * i === H - 1) retn.push(0);
    else if (2 * i < H) retn.push(i % 2 ? -1 : 1);
    else retn.push(-retn[H - 1 - i]);
  }
  const bredde = (r) => (r === 0 ? 2 * (f1 - c + 1) : f1 - f0 + 1);
  // Havet: foran (en facade vender ind i hullet) og bagtil (to bagsider).
  const yLand = v.y[0] - 40;
  const havF = Math.max(P.hav, Math.ceil(rakkevidde(v.top - yLand) + 24));
  const havB = Math.max(P.havB, ...v.bagPunkter.map((p) => Math.ceil(rakkevidde(p.y - yLand) + 24 - (p.lx + bag))));
  const gab = [];
  for (let i = 0; i + 1 < H; i++) gab.push(retn[i] === -1 && retn[i + 1] === 1 ? havB : havF);
  let sum = 0;
  for (let i = 0; i < H; i++) sum += bredde(retn[i]);
  let gSum = gab.reduce((a, b) => a + b, 0);
  const passer = sum + gSum <= bBredde - 2 * FORT.kant;
  // Passer det ikke (heller ikke med trim 4), må havet give sig (ned til 40)
  // — kun med 5-6 klinikker.
  if (!passer && trim >= 4 && gSum > 0) {
    const f = Math.max(0, (bBredde - 2 * FORT.kant - sum) / gSum);
    for (let i = 0; i < gab.length; i++) gab[i] = Math.max(40, Math.floor(gab[i] * f));
    gSum = gab.reduce((a, b) => a + b, 0);
  }
  // Venstre kant af hver borgs fodaftryk; højre halvdel spejles præcist.
  const venstre = [];
  let x = Math.floor((bBredde - sum - gSum) / 2);
  for (let i = 0; i < H; i++) { venstre.push(x); x += bredde(retn[i]) + (gab[i] || 0); }
  const forter = [];
  const formNavn = (r) => (r === 0 ? 'dobbelt' : 'enkelt');
  for (let i = 0; i < H; i++) {
    const r = retn[i];
    let off;
    if (r === 0) off = bBredde / 2 - c;                                  // lx c-½ på banens midte
    else if (2 * i + 1 < H || H === 1) off = r > 0 ? venstre[i] - f0 : venstre[i] + f1;
    else off = bBredde - 1 - forter[H - 1 - i].off;                     // spejlet af makkeren
    // lokal lx -> banens x. Pixelkolonnen lx spejles til off-lx, men et
    // PUNKT (en kundes x, en mundings x) spejles om kolonnens kant til
    // off+1-lx: kapslen tester kolonnerne x-8..x+7, og projektiler afrunder
    // nedad. Punkter i de spejlvendte borge ligger derfor én til højre, så
    // fysikken bliver præcis spejlet, og ingen side har en pixel til gode.
    // Den dobbeltsidede borgs venstre halvdel er spejlet om c (punkter:
    // 2c-lx).
    const tilX = r >= 0 ? (lx) => lx + off : (lx) => off - lx;
    const tilP = r >= 0 ? tilX : (lx) => off + 1 - lx;
    const sider = r === 0 ? [1, -1] : [r];
    // Et lokalt punkt på side sd (1 = som den enkeltsidede borg) -> banen.
    const punkt = (sd, lx) => (r === 0 ? (sd > 0 ? lx : 2 * c - lx) + off : tilP(lx));
    const spand = (sd, a, b) => { const p = punkt(sd, a), q = punkt(sd, b); return [Math.min(p, q), Math.max(p, q)]; };
    const sideInfo = sider.map((sd) => ({
      retning: r === 0 ? sd : r,
      facade: r === 0 ? (sd > 0 ? v.W - 1 + off : 2 * c - v.W + off) : tilX(v.W - 1),
      rumX: ind.rum.map(([a, b]) => spand(sd, a, b)),
      trapper: ind.trapper.map((t) => ({ ...t, top: punkt(sd, t.top), fod: punkt(sd, t.fod), hul: spand(sd, t.hul[0], t.hul[1]) })),
      ramper: Object.fromEntries(Object.entries(ind.ramper)
        .filter(([k]) => !(r === 0 && k === 'keep'))
        .map(([k, t]) => [k, { ...t, top: punkt(sd, t.top), fod: punkt(sd, t.fod), hul: spand(sd, t.hul[0], t.hul[1]) }])),
    }));
    // Kunderne: én pr. etage nedefra; to på en etage står side om side —
    // i den dobbeltsidede borg én i hver side, ellers skifter de side pr. etage.
    const pladser = [];
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < ind.antal[k]; j++) {
        let si = 0, lx = ind.pladser[k][j];
        if (r === 0) { si = ind.antal[k] === 2 ? j : k % 2 === 0 ? 1 : 0; lx = ind.pladser[k][0]; }
        const S = sideInfo[si];
        pladser.push({ x: punkt(r === 0 ? S.retning : 1, lx), y: v.y[k], etage: k, retning: S.retning, rumX: S.rumX[k] });
      }
    }
    const etager = [];
    for (let k = 0; k < n; k++) {
      const pl = pladser.filter((p) => p.etage === k);
      etager.push({ y: v.y[k], pladser: pl, rumX: pl[0] ? pl[0].rumX : sideInfo[0].rumX[k] });
    }
    // Udstyrspladser (mindst 120 wu fra kunderne); i den dobbeltsidede borg
    // i begge sider, men ikke på den massive keep.
    const kand = [];
    for (const S of sideInfo) {
      const sd = r === 0 ? S.retning : 1;
      for (const q of ind.kand) if (!(r === 0 && q.lx < c + 20)) kand.push({ x: punkt(sd, q.lx), y: q.y });
    }
    const udstyr = kand.filter((p) => pladser.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 120))
      .map((p) => ({ ...p, langt: pladser.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 170) }));
    const kasser = [];
    for (const S of sideInfo) {
      const sd = r === 0 ? S.retning : 1;
      for (const lx of ind.kasser) if (!(r === 0 && lx < c + 20)) kasser.push(punkt(sd, lx));
    }
    const lxA = r === 0 ? 2 * c - v.W : 0, lxB = v.W - 1;
    const fodL = r === 0 ? [2 * c - 1 - f1, f1] : [f0, f1];
    const xs = [tilX(lxA), tilX(lxB)], fs = [tilX(fodL[0]), tilX(fodL[1])];
    forter.push({
      off, retning: r, form: formNavn(r),
      facade: sideInfo[0].facade,
      cx: Math.round((xs[0] + xs[1]) / 2),
      x0: Math.min(...xs), x1: Math.max(...xs),          // hovedbygningen
      fod: [Math.min(...fs), Math.max(...fs)],           // med anneks, altaner og plint
      rumX: sideInfo[0].rumX[0],
      etager, pladser, udstyr, kasser, sider: sideInfo,
      trapper: sideInfo[0].trapper, ramper: sideInfo[0].ramper,
    });
  }
  // Bagvæggen på banen.
  const rum = [];
  for (const f of forter) {
    const stykker = f.retning === 0
      ? [...ind.bag.filter((q) => q.b >= c).map((q) => ({ ...q, a: Math.max(q.a, c) })),
         ...ind.bag.filter((q) => q.b >= c).map((q) => ({ a: 2 * c - 1 - q.b, b: 2 * c - 1 - Math.max(q.a, c), y0: q.y0, y1: q.y1 }))]
      : ind.bag;
    const tilX = f.retning >= 0 ? (lx) => lx + f.off : (lx) => f.off - lx;
    for (const q of stykker) {
      const a = tilX(q.a), b = tilX(q.b);
      rum.push({ x0: Math.min(a, b), x1: Math.max(a, b), y0: Math.round(q.y0), y1: Math.round(q.y1) });
    }
  }
  return { layout: L, etager: n, antal: ind.antal, prEtage: Math.max(...ind.antal),
           base: v.y[0], etageHoejde: v.E, tag: v.y[n], top: v.top, bredde: v.W,
           hav: Math.min(...(gab.length ? gab : [0])), havF: gab.length ? havF : 0, havB, gab, retninger: retn,
           variant: v, forter, rum, passer, trim };
}

function genererFort(froe, layout, bBredde, bHoejde) {
  const plan = fortPlan(layout, bBredde, froe);
  const v = plan.variant;
  const t = new Terraen(bBredde, bHoejde);
  const { maske } = t;

  // --- 1. havbunden: lav og jævn, spejlet om midten ligesom borgene
  const bFroe = (froe ^ 0x9e3779b9) >>> 0;
  for (let x = 0; x < bBredde; x++) {
    const s = Math.min(x, bBredde - 1 - x);
    const hb = Math.round(FORT.havbund + (fbm1(s * 0.004, bFroe, 3, 0.5) - 0.5) * 70);
    for (let y = FJELD_BUND; y <= hb; y++) maske[(bHoejde - 1 - y) * bBredde + x] = JORD;
  }

  // --- 2. borgen bygges én gang lokalt og stemples (spejlet) ind for hver
  // klinik; den dobbeltsidede er den samme borg med massiv keep, spejlet om c
  const gitre = {};
  for (const f of plan.forter) {
    const lok = gitre[f.form] ||= bygBorg(v, froe, bHoejde, f.form === 'dobbelt');
    for (let ly = 0; ly < lok.h; ly++) {
      const raekke = (bHoejde - 1 - ly) * bBredde, kilde = ly * lok.w;
      for (let i = 0; i < lok.w; i++) {
        let lx = lok.x0 + i;
        if (f.retning === 0) {
          if (lx < v.c) continue;
          const k = lok.d[kilde + i];
          if (!k) continue;
          for (const x of [lx + f.off, 2 * v.c - 1 - lx + f.off]) if (x >= 0 && x < bBredde) maske[raekke + x] = LOKAL_MAT[k];
          continue;
        }
        const k = lok.d[kilde + i];
        if (!k) continue;
        const x = f.retning > 0 ? lx + f.off : f.off - lx;
        if (x >= 0 && x < bBredde) maske[raekke + x] = LOKAL_MAT[k];
      }
    }
  }

  // --- 3. havbund: grundfjeld helt i bunden
  for (let y = 0; y < FJELD_BUND; y++) {
    const raekke = (bHoejde - 1 - y) * bBredde;
    for (let x = 0; x < bBredde; x++) maske[raekke + x] = FJELD;
  }

  // --- 4. kun udstyrspladser, man kan stå på (fast under, fri kapsel over)
  // — og kun dem, der holder i alle borge af samme form, så listerne stadig
  // står i samme (spejlede) rækkefølge.
  const kanStaa = (p) => {
    if (!t.fast(p.x, p.y)) return false;
    for (let yy = p.y + 1; yy <= p.y + 46; yy += 3) for (let dx = -9; dx <= 9; dx += 3) if (t.fast(p.x + dx, yy)) return false;
    return true;
  };
  for (const form of ['enkelt', 'dobbelt']) {
    const fs = plan.forter.filter((f) => f.form === form);
    if (!fs.length) continue;
    const god = fs[0].udstyr.map((_, j) => fs.every((f) => kanStaa(f.udstyr[j])));
    for (const f of fs) f.udstyr = f.udstyr.filter((_, j) => god[j]);
  }

  const { variant, ...fort } = plan;
  for (const f of fort.forter) delete f.off;
  t.fort = fort;
  t.snavs = { x0: 0, y0: 0, x1: bBredde - 1, y1: bHoejde - 1 };
  t.vandNiveau = VAND_NIVEAU;
  return t;
}

// Lokale koder i borgens byggegitter: 0 = rør ikke banen.
const L_LUFT = 1, L_MUR = 2, L_JORD = 3;
const LOKAL_MAT = [LUFT, LUFT, MUR, JORD];

/** Byg én borg i et lokalt gitter (lx fra bagsiden, y som banen). Med
 *  massivKeep er keepen uden dør og rampe (den dobbeltsidede borgs midte). */
function bygBorg(v, froe, bHoejde, massivKeep = false) {
  const { n, y, W, FT0, KB, A, Ls, Wk, ki } = v;
  const M = FORT.mur, MI = FORT.indermur, D = FORT.daek, MF = FORT.facade, K = FORT.krone, T = FORT.tandB;
  const x0 = v.lx0, x1 = v.lx1;
  const w = x1 - x0 + 1, h = Math.min(bHoejde, v.top + 20);
  const d = new Uint8Array(w * h);
  const rekt = (a, b, ya, yb, k) => {
    a = Math.max(x0, Math.round(a)); b = Math.min(x1, Math.round(b));
    ya = Math.max(0, Math.round(ya)); yb = Math.min(h - 1, Math.round(yb));
    for (let yy = ya; yy <= yb; yy++) { const r = yy * w - x0; for (let x = a; x <= b; x++) d[r + x] = k; }
  };
  const soejle = (x, ya, yb, k) => rekt(x, x, ya, yb, k);
  const hent = (x, yy) => (x < x0 || x > x1 || yy < 0 || yy >= h) ? 0 : d[yy * w - x0 + x];
  // Bueåbning: rektangel [a,b] x [ya,ys] med en halv ellipse (pil) ovenpå.
  const bue = (a, b, ya, ys, pil, k = L_LUFT) => {
    const c = (a + b) / 2, hb = (b - a) / 2 + 0.5;
    for (let x = Math.round(a); x <= Math.round(b); x++) {
      const u = (x - c) / hb;
      soejle(x, ya, ys + pil * Math.sqrt(Math.max(0, 1 - u * u)), k);
    }
  };
  // Rundbue med toppen i yTop: halvcirkel, fladere, hvis der ikke er plads.
  const rundbue = (a, b, ya, yTop, k = L_LUFT) => {
    const pil = Math.min((b - a + 1) / 2, Math.max(0, yTop - ya - 16));
    bue(a, b, ya, yTop - pil, pil, k);
  };
  // Frihøjde over en rampe: luft fra overfladen og FORT.hoved op, også i
  // kapslens bredde til begge sider — det er dét, der skærer tunnelen og
  // hullet i dækket over den.
  const frihoejde = (a, b, f) => {
    for (let x = a; x <= b; x++) {
      const topY = Math.max(f(x - 10), f(x + 10), f(x)) + FORT.hoved;
      soejle(x, Math.floor(f(x)) + 1, topY, L_LUFT);
    }
  };
  // Konsol under et udhæng: spids ved udhængets yderkant (retn = den side,
  // udhænget peger mod), l wu dyb ind mod væggen og lige så høj dér.
  const konsol = (spids, retn, l, yU) => {
    for (let i = 0; i < l; i++) soejle(spids - retn * i, yU - i, yU, L_MUR);
  };
  const vfroe = (froe ^ 0x6a09e667) >>> 0;
  const yR = y[n];
  const an = v.anneks;
  const bagKant = an ? -an.b - an.trin : -12;

  // --- klippen under borgen (under vandet), med ujævne skrænter
  for (let x = x0; x <= x1; x++) {
    const ude = x < bagKant ? bagKant - x : x >= W + FORT.plint ? x - (W - 1 + FORT.plint) : 0;
    const t = Math.min(1, ude / 90);
    const topY = FORT.klippe - 180 * t * t * (3 - 2 * t) + (fbm1((x - x0) * 0.02, vfroe, 2, 0.5) - 0.5) * 30 * (0.3 + t);
    if (topY > FORT.havbund - 40) soejle(x, FJELD_BUND, topY, L_JORD);
  }

  // --- sokkel og hovedbygning (massiv), trappet facade og bagside, og de to
  // tårne over taget
  rekt(-12, W - 1, FORT.sokkel, y[0] - D, L_MUR);
  rekt(W, W - 1 + FORT.plint, FORT.sokkel, y[0] - 30, L_MUR);       // plinten ved vandlinjen
  rekt(0, W - 1, y[0] - D + 1, yR, L_MUR);
  for (let k = 1; k < n; k++) if (Wk[k] < W) rekt(Wk[k], W - 1, y[k] + 1, y[k + 1], L_LUFT);
  if (ki && v.bagTrin < n) rekt(0, ki - 1, y[v.bagTrin] + 1, yR, L_LUFT);
  rekt(ki, KB - 1, yR + 1, v.yK, L_MUR);
  rekt(FT0, Wk[n] - 1, yR + 1, v.yF, L_MUR);

  // --- hallerne
  for (let k = 0; k < n; k++) {
    const hal = v.haller[k];
    const loft = y[k + 1] - D;
    let vTop;
    if (hal.stil === 'kamre') {
      rekt(hal.a, hal.b, y[k] + 1, y[k] + hal.lav, L_LUFT);
      for (const [a, b] of hal.kamre) if (hal.lavTil == null || a > hal.lavTil) rundbue(a, b, y[k] + 1, loft);
      vTop = y[k] + hal.lav;
    } else {
      const sp = y[k] + hal.vl;
      rekt(hal.a, hal.b, y[k] + 1, sp, L_LUFT);
      for (const [a, b] of hal.fag) if (hal.lavTil == null || a > hal.lavTil) bue(a, b, sp, sp, loft - sp);
      vTop = sp;
    }
    for (const [a, b] of hal.vaegge) {
      rekt(a, b, y[k] + 1, vTop, L_MUR);
      rundbue(a, b, y[k] + 1, y[k] + 76);                          // døren
    }
  }
  // --- trappeløbene: tunneler op mod bagsiden (sten under og over)
  for (let k = 0; k < n; k++) frihoejde(A[k] - 2, A[k] + Ls + 2, (x) => loebY(v, k, x));

  // --- fortårnet: kundernes rum under en rund bue, brystning og skydeskår i
  // facaden, der vider sig ud udad, og en dør til hallen; terrasse, hvor
  // facaden trappes (dér står brystningen ude på terrassens kant). Over
  // taget (k = n) er det udkigskammeret med dør fra taget.
  const rA = FT0 + MI;
  for (let k = 0; k <= n; k++) {
    const loft = k < n ? y[k + 1] - D : yR + v.kammerH, sp = y[k] + Math.min(84, loft - y[k] - 24), fa = Wk[k];
    const vi = Math.min(v.vindue[0], loft - y[k] - 12), vo = Math.min(v.vindue[1], loft - y[k] + 4);
    const terrasse = k > 0 && Wk[k] < Wk[k - 1];
    bue(rA, fa - MF - 1, y[k] + 1, sp, loft - sp);
    rekt(fa - MF, terrasse ? fa - 1 : fa - FORT.brystB - 1, y[k] + 1, y[k] + FORT.bryst, L_LUFT);
    for (let x = fa - MF; x < fa; x++) {
      const u = (x - (fa - MF)) / (MF - 1);
      soejle(x, y[k] + FORT.bryst + 1, y[k] + vi + u * (vo - vi), L_LUFT);
    }
    rekt(FT0, rA - 1, y[k] + 1, y[k] + FORT.doer, L_LUFT);
    if (terrasse) rekt(Wk[k - 1] - FORT.brystB, Wk[k - 1] - 1, y[k] + 1, y[k] + FORT.bryst, L_MUR);
  }

  // --- fortårnet over udkigskammeret: massivt med vinduer, man ser igennem,
  // en udkraget krone og tinder
  const WF = Wk[n];
  const vt = v.vagttaarn;
  const tStop = vt ? WF - vt.b : null;
  rekt(FT0 - K, WF - 1 + K, v.yF - D + 1, v.yF, L_MUR);               // kronen
  for (const vv of v.vinduer) {
    if (vv.keep) continue;
    if (vv.rund) {
      const c = (vv.a + vv.b) / 2, cy = (vv.y0 + vv.y1) / 2, r0 = (vv.b - vv.a) / 2;
      for (let yy = -r0; yy <= r0; yy++) { const sp = Math.sqrt(r0 * r0 - yy * yy); rekt(c - sp, c + sp, cy + yy, cy + yy, L_LUFT); }
    } else rundbue(vv.a, vv.b, vv.y0, vv.y1);
  }
  taarntop(FT0 - K, WF - 1 + K, v.yF, null, tStop);
  if (vt) {
    // Vagttårnet på det forreste hjørne: dækning for den, der står deroppe,
    // med et skydeskår mod fjenden og en konsol under udkragningen.
    const a = WF - vt.b, b = WF - 1 + vt.ud, yb = v.yF + vt.h;
    rekt(a, b, v.yF + 1, yb, L_MUR);
    rekt(WF - 1 + K + 1, b, v.yF - D + 1, v.yF, L_MUR);
    konsol(b, 1, b - (WF - 1 + K), v.yF - D);
    rekt(b - 16, b - 8, v.yF + 18, yb - 24, L_LUFT);
    tinder(a, b, yb, null);
  }

  // --- porttårnet på taget: gennemgang med døre i begge ender
  if (v.port) {
    const { a, b, h: gh } = v.port;
    rekt(a, b, yR + 1, yR + gh, L_MUR);
    bue(a + MI, b - MI, yR + 1, yR + 70, Math.max(0, gh - D - 70));
    rekt(a, a + MI - 1, yR + 1, yR + FORT.doer, L_LUFT);
    rekt(b - MI + 1, b, yR + 1, yR + FORT.doer, L_LUFT);
    rekt(a - K, b + K, yR + gh - D + 1, yR + gh, L_MUR);
    konsol(a - K, -1, K, yR + gh - D); konsol(b + K, 1, K, yR + gh - D);
    tinder(a - K, b + K, yR + gh, null);
  }

  // --- keepen over taget: dør fra taget og en rampe op mod bagsiden, eller
  // en skrå forside, man går op ad (i den dobbeltsidede borg er keepen massiv)
  const ka = v.keepUde ? KB : KB - MI - 12, kb = ka - v.Lk;
  const kY = (x) => x >= ka ? yR : x <= kb ? v.yK : yR + (ka - x) / v.Lk * v.tk;   // præcis op til toppen
  const udenKeep = massivKeep && v.c >= KB;
  if (udenKeep) {
    // intet: den dobbeltsidede borg uden keep
  } else if (!massivKeep && v.keepUde) {
    for (let x = kb; x < KB; x++) soejle(x, Math.floor(kY(x)) + 1, v.yK, L_LUFT);
    rekt(ki - K, kb - 1, v.yK - D + 1, v.yK, L_MUR);                // kronen, kun bagtil
    for (const vv of v.vinduer) if (vv.keep) rekt(vv.a, vv.b, vv.y0, vv.y1, L_LUFT);
  } else {
    rekt(ki - K, KB - 1 + (v.keepKrone ? K : 0), v.yK - D + 1, v.yK, L_MUR);   // kronen
    if (!massivKeep) {
      rekt(ka, KB - 1, yR + 1, yR + FORT.doer, L_LUFT);
      frihoejde(kb - 2, ka + 2, kY);
      for (const vv of v.vinduer) if (vv.keep) rekt(vv.a, vv.b, vv.y0, vv.y1, L_LUFT);
    } else {
      // midt i den dobbeltsidede borg: et højt vindue i keepen
      rundbue(v.c - 14, v.c + 13, yR + 30, v.yK - D - 22);
    }
  }
  const kt = udenKeep ? null : v.kronetaarn;
  const kF = v.keepKrone ? K : 0;                                   // kronens udkragning mod taget
  if (udenKeep) {
    // intet
  } else if (massivKeep) {
    // tinderne spejles om c: en tand midt over aksen
    tinder(v.c - (T >> 1), KB - 1 + kF, v.yK, null, FORT.tand, true);
    if (kF) konsol(KB - 1 + K, 1, K, v.yK - D);
  } else {
    const bagA = kt ? ki + kt.b : ki - K;
    if (!kt) konsol(ki - K, -1, K, v.yK - D);
    if (v.keepUde) tinder(bagA, kb - 1, v.yK, [kb - 20, kb + 40], FORT.tand, false, !kt);
    else {
      if (kF) konsol(KB - 1 + K, 1, K, v.yK - D);
      tinder(bagA, KB - 1 + kF, v.yK, [kb - 2, kb + v.hulT], FORT.tand, true, !kt);
    }
  }
  if (kt) {
    // Kronetårnet på keepens bageste hjørne, udkraget over bagsiden, med et kighul.
    const a = ki - kt.b, b = ki + kt.b - 1, yb = v.yK + kt.h;
    rekt(a, b, v.yK + 1, yb, L_MUR);
    rekt(a, ki - K - 1, v.yK - D + 1, v.yK, L_MUR);
    konsol(a, -1, ki - K - a, v.yK - D);
    bue(ki - 11, ki + 11, v.yK + 22, yb - 30 - 11, 11);
    tinder(a, b, yb, null);
  }
  // En terrasse med tinder bag keepen, hvis den er trukket ind.
  if (ki >= 30) {
    const yt = y[v.bagTrin];
    rekt(-K, -1, yt - 12, yt, L_MUR);
    konsol(-K, -1, K, yt - 12);
    tinder(-K, ki - 1, yt, null, FORT.tand - 6, false);
  }

  // --- buerne i den massive bagdel: nogle ser man himlen igennem, andre er
  // blændede (mørke, se fort.rum)
  for (const bu of v.buer) rundbue(bu.a, bu.b, bu.y0, bu.y1);

  // --- gesimser på facaden og bagsiden, havbuerne under den bageste del
  for (let k = 1; k <= n; k++) {
    rekt(Wk[k - 1], Wk[k - 1] - 1 + FORT.gesims, y[k] - 14, y[k], L_MUR);
    const bx = k > v.bagTrin ? ki : 0;
    if (!(an && y[k] <= y[0] + an.h + 30) && k !== v.bagTrin) rekt(bx - FORT.gesims, bx - 1, y[k] - 14, y[k], L_MUR);
  }
  for (const [a, b] of v.havbuer) rundbue(a, b, FORT.klippe - 8, y[0] - D - 18);

  // --- altan med skråstiver på ét dæk
  if (v.altan) {
    const { k, l } = v.altan, yy = y[k], fa2 = Wk[k - 1];
    rekt(fa2, fa2 - 1 + l, yy - D + 1, yy, L_MUR);
    rekt(fa2 - 1 + l - 15, fa2 - 1 + l, yy + 1, yy + 26, L_MUR);            // lav brystning ude for enden
    konsol(fa2 - 1 + Math.round(l * 0.75), 1, Math.round(l * 0.75), yy - D);
  }

  // --- anneks og altan på bagsiden: en trappet siluet mod det åbne hav
  if (an) {
    const yt = y[0] + an.h;
    rekt(-an.b, -1, FORT.sokkel, yt, L_MUR);
    rekt(-an.b - 8, -1, yt - 12, yt, L_MUR);
    konsol(-an.b - 8, -1, 8, yt - 12);
    if (an.h >= 110) rundbue(-an.b + 22, -24, y[0] + 20, yt - 30);
    rundbue(-an.b + 16, -16, FORT.klippe - 8, y[0] - 40);
    tinder(-an.b - 8, -1, yt, null);
    if (an.trin) {
      const b0 = -an.b - an.trin;
      rekt(b0, -an.b - 1, FORT.sokkel, y[0] - 18, L_MUR);
      tinder(b0, -an.b - 1, y[0] - 18, null, 26);
    }
  }
  if (v.bagAltan) {
    const k = v.bagAltan.k, yy = y[k], l = v.bagAltan.l, bx = k > v.bagTrin ? ki : 0;
    if ((!an || yy - D > y[0] + an.h + 40) && k !== v.bagTrin) {
      rekt(bx - l, bx - 1, yy - D + 1, yy, L_MUR);
      rekt(bx - l, bx - l + 13, yy + 1, yy + 24, L_MUR);
      konsol(bx - Math.round(l * 0.8), -1, Math.round(l * 0.8), yy - D);
    }
  }

  return { x0, w, h, d };

  /** Tårntop (kronen er lagt, og rampens hul skåret): konsoller under
   *  udkragningen og tinder; hullet og alt fra `stop` og frem lades uden
   *  tinder (dér står kronetårnet/vagttårnet). */
  function taarntop(a, b, yTop, hul, stop) {
    for (const sg of [-1, 1]) {
      if (sg > 0 && stop != null) continue;
      konsol(sg < 0 ? a : b, sg, K, yTop - D);
    }
    tinder(a, stop != null ? stop - 1 : b, yTop, hul, FORT.tand, stop == null);
  }

  /** Tinder langs en top fra a til b: en tand i hver ende og ellers så mange,
   *  der er plads til — aldrig over trappehullet eller ud over kanten. */
  function tinder(a, b, yTop, hul, hoejde = FORT.tand, hoejreEnde = true, venstreEnde = true) {
    const S = FORT.skaar;
    const tag = [], kand = [];
    if (venstreEnde) tag.push(a);
    if (hoejreEnde) tag.push(b - T + 1);
    for (let j = 1; a + j * (S + T) + T - 1 <= b - T - S; j++) kand.push(a + j * (S + T));
    for (let j = 1; b - T + 1 - j * (S + T) >= a + T + S; j++) kand.push(b - T + 1 - j * (S + T));
    for (const x of kand) {
      if (tag.some((q) => Math.abs(q - x) < T + S)) continue;
      if (hul && x + T - 1 >= hul[0] - 24 && x <= hul[1] + 24) continue;
      if (hent(x, yTop) !== L_MUR || hent(x + T - 1, yTop) !== L_MUR) continue;
      tag.push(x);
    }
    for (const x of tag) rekt(x, x + T - 1, yTop + 1, yTop + hoejde, L_MUR);
  }
}
