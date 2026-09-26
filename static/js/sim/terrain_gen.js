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
import { Terraen, LUFT, JORD, FJELD } from './terrain.js';

export const BANE_B = 5120;          // længere afstande
export const BANE_H = 1792;          // mere højde
export const VAND_NIVEAU = 300;      // havets overflade i world units
const SKALA = 4;
const FJELD_BUND = 16;

export const BANE_TYPER = ['aaben', 'hule', 'oeer'];

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

export function genererBane(froe, type = 'aaben', bBredde = BANE_B, bHoejde = BANE_H) {
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

/** Generér, og prøv igen med nyt frø hvis banen ikke kan huse bæverne. */
export function genererSpilbar(froe, type, antalBaevere, forsoeg = 8) {
  let sidste = null;
  for (let i = 0; i < forsoeg; i++) {
    const f = (froe + i * 7919) >>> 0;
    const terraen = genererBane(f, type);
    const pladser = findStartpladser(terraen);
    sidste = { terraen, pladser, froe: f };
    if (pladser.length >= antalBaevere * 3) return sidste;
  }
  return sidste;
}
