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
 * Hver klinik står på sit eget fort: et tårn af murværk (MUR) på en vold af
 * jord, med lige så mange etager som klinikken har kunder — 2v2 giver to,
 * 3v3 tre — én kunde pr. etage nedefra. Over fire etager står de ekstra
 * kunder side om side på de nederste etager, som så er bredere.
 *
 * Et rum er ikke en lukket kasse: begge ydervægge har en lav brystning
 * (dækning for benene) og et vindue op til en overligger under dækket, så
 * man kan skyde ud til siden. Hvert dæk har en lem, skiftevis i venstre og
 * højre side, så man kan falde én etage ned uden faldskade (132 wu < 150);
 * kunderne står hverken på en lem eller lige under en.
 * Taget er åbent mod himlen med en tinde i hver ende — derfra skyder man
 * over modstanderens fort. Alt murværk er destruktibelt; kun havbunden er
 * FJELD, som på de andre baner.
 *
 * Mellem fortene ligger lavt, ujævnt land med kanaler ned i havet, så fortene
 * dominerer. Selve fortene er ens (dem i højre halvdel spejlvendt) og
 * afhænger KUN af layoutet — aldrig af frøet — så ingen klinik får et bedre
 * fort end de andre.
 */
const FORT = {
  lavBasis: VAND_NIVEAU + 140, lavAmp: 150, knold: 44,  // lavlandet mellem fortene
  base: VAND_NIVEAU + 290,     // gulvet i stueetagen: soklens øverste række
  etage: 132,                  // fra gulv til gulv; rummet er 110 wu højt
  daek: 22,                    // etagedækkets tykkelse
  mur: 14,                     // ydervæggenes tykkelse
  bryst: 26,                   // brystningen: dækker benene, ikke skuddet
  overligger: 12,              // under dækket; vinduet er mellem de to
  indvendig: 150,              // rummets bredde med én kunde pr. etage …
  ekstraPrKunde: 70,           // … og for hver ekstra kunde side om side
  lem: 34, lemInd: 14, lemKant: 10,  // lemmen: bredde, afstand til væggen, luft til kunden
  sokkel: 26, soklUd: 8,       // soklen, stueetagen står på
  hylde: 70,                   // flad gård rundt om tårnet
  skraaning: 560,              // volden: fra gulvhøjde ned til havbunden
  tinde: 34, tindeB: 26, tindeUd: 6, skaar: 10, skaarB: 8,
  kantHav: 0.07,
};

/** Normalisér layoutet: 1-6 klinikker, 1-8 kunder pr. klinik. */
export function fortLayout(layout, antalBaevere = 4) {
  const antalHold = Math.max(1, Math.min(6, Math.round(layout?.antalHold) || 2));
  const prHold = Math.max(1, Math.min(8,
    Math.round(layout?.prHold) || Math.ceil(antalBaevere / antalHold)));
  return { antalHold, prHold };
}

/** Fortenes geometri. Ren funktion af layout og banebredde. */
export function fortPlan(layout, bBredde = BANE_B) {
  const L = fortLayout(layout);
  const n = Math.max(1, Math.min(4, L.prHold));
  const antal = [];                                  // kunder pr. etage, nedefra
  for (let k = 0; k < n; k++) antal.push(Math.floor(L.prHold / n) + (k < L.prHold % n ? 1 : 0));
  const prEtage = Math.max(...antal);
  const bredde = FORT.indvendig + FORT.ekstraPrKunde * (prEtage - 1);
  const halv = bredde / 2;
  const Ho = halv + FORT.mur;
  const afstand = bBredde / (L.antalHold + 0.6);
  const forter = [];
  for (let i = 0; i < L.antalHold; i++) {
    const cx = Math.round(bBredde / 2 + (i - (L.antalHold - 1) / 2) * afstand);
    const xL = cx - halv, xR = cx + halv - 1;        // rummets første og sidste luftkolonne
    const etager = [];
    // Lemmen i dæk k (gulvet på etage k): tagets lem i den inderste side (mod
    // banens midte), så tagkunden står i den yderste halvdel med tinden mod
    // fjenden foran sig; nedad skiftevis. Fortene i højre halvdel er dermed
    // spejlvendt, så alle klinikker har samme fort set mod modstanderen.
    const yderstTilVenstre = cx <= bBredde / 2;
    const lemI = (k) => k < 1 || k >= n ? null : ((n - 1 - k) % 2 === 0) !== yderstTilVenstre
      ? [xL + FORT.lemInd, xL + FORT.lemInd + FORT.lem - 1]
      : [xR - FORT.lemInd - FORT.lem + 1, xR - FORT.lemInd];
    for (let k = 0; k < n; k++) {
      const y = FORT.base + k * FORT.etage;          // gulvets øverste faste række
      const tag = k === n - 1;
      let a = tag ? xL + FORT.tindeUd + 2 : xL, b = tag ? xR - FORT.tindeUd - 2 : xR;
      const lem = lemI(k);
      // Kunden står hverken på lemmen i gulvet eller lige under lemmen i
      // loftet — ellers kunne man skyde ned på den gennem hullet ovenfra.
      for (const l of [lem, lemI(k + 1)]) {
        if (!l) continue;
        if (l[0] - xL < xR - l[1]) a = Math.max(a, l[1] + 1 + FORT.lemKant);
        else b = Math.min(b, l[0] - 1 - FORT.lemKant);
      }
      const c = antal[k];
      const pladser = [];
      for (let j = 0; j < c; j++) pladser.push({ x: Math.round(a + (b - a) * (j + 1) / (c + 1)), y, etage: k });
      etager.push({ y, lem, pladser, loft: tag ? null : y + FORT.etage - FORT.daek });
    }
    forter.push({ cx, xL, xR, Ho, fodHalv: Ho + FORT.hylde, etager,
                  pladser: etager.flatMap((e) => e.pladser) });
  }
  return { layout: L, etager: n, antal, prEtage, bredde, base: FORT.base, etageHoejde: FORT.etage,
           top: FORT.base + (n - 1) * FORT.etage, forter };
}

function genererFort(froe, layout, bBredde, bHoejde) {
  const plan = fortPlan(layout, bBredde);
  const t = new Terraen(bBredde, bHoejde);
  const fw = Math.ceil(bBredde / SKALA), fh = Math.ceil(bHoejde / SKALA);
  const hFroe = (froe ^ 0x9e3779b9) >>> 0;
  const wFroe = (froe * 2654435761) >>> 0;
  const kFroe = (froe ^ 0x27d4eb2f) >>> 0;
  const havbund = VAND_NIVEAU - 150;

  // --- 1. lavlandet: lavt og ujævnt, let terrasseret
  const raa = new Float32Array(fw);
  for (let x = 0; x < fw; x++) {
    // Lange bølger giver bakker og dale, korte giver knolde og skrænter.
    const n = fbm1(x * SKALA * 0.0016, hFroe, 4, 0.5);
    const r = fbm1(x * SKALA * 0.0065 + 17.3, hFroe ^ 0x3c6ef372, 2, 0.5);
    const h = FORT.lavBasis + (n - 0.5) * 2 * FORT.lavAmp + (r - 0.5) * 2 * FORT.knold;
    const snappet = Math.round(h / 40) * 40;
    raa[x] = h + (snappet - h) * 0.3;
  }
  const hoejde = boksBlur(raa, 3);

  // --- 2. kanaler: mindst én mellem hvert par forter, måske en voldgrav bag
  // de yderste. Aldrig under en vold.
  const rng = lavRng(kFroe);
  const fod = (f) => f.fodHalv + FORT.skraaning * 0.35;
  const spand = [];
  const F0 = plan.forter[0], Fn = plan.forter[plan.forter.length - 1];
  spand.push([bBredde * FORT.kantHav + 160, F0.cx - fod(F0), 0.5]);
  for (let i = 0; i + 1 < plan.forter.length; i++) {
    const a = plan.forter[i], b = plan.forter[i + 1];
    spand.push([a.cx + fod(a), b.cx - fod(b), 1]);
  }
  spand.push([Fn.cx + fod(Fn), bBredde * (1 - FORT.kantHav) - 160, 0.5]);
  const kanaler = [];
  for (const [a, b, chance] of spand) {
    const bred = b - a;
    const rul = rng();
    if (bred < 260 || rul >= chance) continue;
    const antal = chance >= 1 && bred > 900 && rng() < 0.6 ? 2 : 1;
    for (let j = 0; j < antal; j++) {
      const midte = a + bred * (j + 0.5) / antal + (rng() - 0.5) * 0.4 * bred / antal;
      const halvBredde = Math.min(bred / antal * 0.4, 90 + rng() * 80);
      kanaler.push({ midte: midte / SKALA, halvBredde: halvBredde / SKALA });
    }
  }
  for (let x = 0; x < fw; x++) {
    for (const kan of kanaler) {
      const d = Math.abs(x - kan.midte) / kan.halvBredde;
      if (d >= 1) continue;
      const dyb = 0.5 + 0.5 * Math.cos(d * Math.PI);
      const maal = havbund + (1 - dyb) * 200;
      hoejde[x] = Math.min(hoejde[x], hoejde[x] + (maal - hoejde[x]) * dyb);
    }
    const kant = Math.min(x, fw - 1 - x) / (fw * FORT.kantHav);
    if (kant < 1) {
      const t2 = 1 - kant;
      hoejde[x] = Math.min(hoejde[x], hoejde[x] + (havbund - hoejde[x]) * t2 * t2);
    }
  }

  // --- 3. voldene: flad gård i gulvhøjde, skråninger man kan gå op ad
  const glat = (s) => s * s * (3 - 2 * s);
  const warpSkala = new Float32Array(fw).fill(1);
  for (let x = 0; x < fw; x++) {
    const wx = x * SKALA;
    for (const f of plan.forter) {
      const d = Math.abs(wx - f.cx) - f.fodHalv;
      const m = d <= 0 ? FORT.base : FORT.base - (FORT.base - havbund) * glat(Math.min(1, d / FORT.skraaning));
      if (m > hoejde[x]) hoejde[x] = m;
      // Ingen forvrængning på gården og lidt op ad volden: tårnet skal stå lige.
      warpSkala[x] = Math.min(warpSkala[x], glat(Math.max(0, Math.min(1, d / 260))));
    }
  }

  // --- 4. densitetsfelt: dæmpet forvrængning, ingen huler
  const felt = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    const wy = y * SKALA;
    for (let x = 0; x < fw; x++) {
      const wx = x * SKALA;
      const ws = warpSkala[x] * 36;
      const w1 = (fbm2(wx * 0.0015, wy * 0.0015, wFroe, 2) - 0.5) * 2;
      const w2 = (fbm2(wx * 0.0015 + 5.2, wy * 0.0015 + 1.7, wFroe ^ 0x55, 2) - 0.5) * 2;
      const px = wx + w1 * ws, py = wy + w2 * ws;
      const hx = Math.min(fw - 1, Math.max(0, Math.round(px / SKALA)));
      const d = hoejde[hx] - py;
      felt[y * fw + x] = d > 240 ? 240 : d;
    }
  }
  taerskel(t, felt, fw, fh, froe);
  despeckle(t);
  fjernSmaaStumper(t, 900);

  // --- 5. fortene: ret gården af, og byg tårnet af murværk
  const rum = [];
  for (const f of plan.forter) {
    rekt(t, f.cx - f.fodHalv, f.cx + f.fodHalv, FORT.base + 1, bHoejde - 1, LUFT);
    rekt(t, f.cx - f.fodHalv, f.cx + f.fodHalv, FORT.base - 70, FORT.base, JORD);
    bygFort(t, f, plan, rum);
  }

  // --- 6. havbund: grundfjeld helt i bunden
  for (let y = 0; y < FJELD_BUND; y++) {
    const raekke = (bHoejde - 1 - y) * bBredde;
    for (let x = 0; x < bBredde; x++) t.maske[raekke + x] = FJELD;
  }

  t.fort = { ...plan, rum };
  t.snavs = { x0: 0, y0: 0, x1: bBredde - 1, y1: bHoejde - 1 };
  t.vandNiveau = VAND_NIVEAU;
  return t;
}

/** Ét tårn: sokkel, dæk med lem, brystninger, overliggere og tinder. */
function bygFort(t, f, plan, rum) {
  const { xL, xR } = f;
  const M = FORT.mur;
  rekt(t, xL - M - FORT.soklUd, xR + M + FORT.soklUd, FORT.base - FORT.sokkel + 1, FORT.base, MUR);
  for (let k = 0; k < plan.etager; k++) {
    const e = f.etager[k];
    const y = e.y;
    if (k >= 1) {
      rekt(t, xL - M, xR + M, y - FORT.daek + 1, y, MUR);
      rekt(t, e.lem[0], e.lem[1], y - FORT.daek + 1, y, LUFT);
    }
    if (e.loft !== null) {
      for (const [a, b] of [[xL - M, xL - 1], [xR + 1, xR + M]]) {
        rekt(t, a, b, y + 1, y + FORT.bryst, MUR);
        rekt(t, a, b, e.loft - FORT.overligger + 1, e.loft, MUR);
      }
    } else {
      // Taget: en tinde i hver ende, med et skår i toppen.
      for (const s of [-1, 1]) {
        const a = s < 0 ? xL - M - FORT.tindeUd : xR + M + FORT.tindeUd - FORT.tindeB + 1;
        const b = a + FORT.tindeB - 1;
        rekt(t, a, b, y + 1, y + FORT.tinde, MUR);
        const m = (a + b + 1) >> 1;
        rekt(t, m - FORT.skaarB / 2, m + FORT.skaarB / 2 - 1, y + FORT.tinde - FORT.skaar + 1, y + FORT.tinde, LUFT);
      }
    }
  }
  // Rummene og lemmene mellem væggene: her tegner terrain_view.js en bagvæg
  // (kun grafik), så tårnet læses som en bygning og ikke som svævende dæk.
  if (plan.etager > 1) rum.push({ x0: xL, x1: xR, y0: FORT.base + 1, y1: plan.top });
}

/** Sæt et aksealignet rektangel (inklusive grænser) til ét materiale. */
function rekt(t, x0, x1, y0, y1, mat) {
  x0 = Math.max(0, x0 | 0); x1 = Math.min(t.w - 1, x1 | 0);
  y0 = Math.max(0, y0 | 0); y1 = Math.min(t.h - 1, y1 | 0);
  for (let y = y0; y <= y1; y++) {
    const r = (t.h - 1 - y) * t.w;
    for (let x = x0; x <= x1; x++) t.maske[r + x] = mat;
  }
}

/** Tærskling med bilineær opskalering og let dither (som i genererBane). */
function taerskel(t, felt, fw, fh, froe) {
  const { w, h } = t;
  for (let y = 0; y < h; y++) {
    const fy = y / SKALA;
    const y0 = Math.min(fh - 1, Math.floor(fy)), y1 = Math.min(fh - 1, y0 + 1);
    const ty = fy - y0;
    const raekke = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
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
}
