/* Kundekrigen — banereglerne (MapGEN-stil).
 *
 * Som i Worms' MapGEN har hver banetype ét SKEMA: et par ARKETYPER, hver med
 * faste regler og tilfældige parametre. Frøet vælger arketypen og trækker
 * parametrene, så to kampe aldrig får den samme bane — men hver bane følger
 * de samme regler og er altid spilbar. Reglerne står på dansk i docs/baner.md.
 *
 * Her bor det, alle banetyper deler:
 *   - banens mål og havet
 *   - skemaerne og valget af arketype (vaegtet, kun fra frøet)
 *   - hoppets rækkevidde (så ingen kan hoppe over til fjenden på fortet)
 *   - oprydning: løse stumper og små luftbobler fjernes
 *   - standpladser: alle steder, en kunde kan stå — også under et loft
 *   - pynten: planter og sten med rigtig kontakt, spejling og tæthed
 *   - broer og bjælker af murværk (MUR), som kan sprænges
 *
 * Hovedløs og deterministisk: ingen Math.random, ingen DOM. Alt afhænger
 * kun af frøet, så vært, spejl og gæster bygger præcis den samme bane.
 */
'use strict';

import { lavRng } from '../core/rng.js';
import { LUFT, JORD, FJELD, MUR } from './terrain.js';

export const BANE_B = 5120;          // længere afstande
export const BANE_H = 1792;          // mere højde
export const VAND_NIVEAU = 300;      // havets overflade i world units
export const FJELD_BUND = 16;        // grundfjeld i bunden (og i hulens loft)

/* ------------------------------------------------------------ skemaerne
 *
 * Vægtene er lod: arketypen trækkes med en rng, der kun afhænger af frøet.
 * Fortets landskab og siluet trækkes hver for sig (terrain_gen.fortStil),
 * så 12 kampe på fortet viser mange forskellige kombinationer.
 */
export const SKEMAER = {
  fort: {
    siluetter: [['borg', 3], ['tvillinger', 3], ['spir', 3], ['ringmur', 3], ['bastion', 3]],
    landskaber: [['hav', 3], ['skaer', 2], ['oe', 3], ['bakke', 3], ['bro', 3], ['kloeft', 3], ['soe', 3]],
  },
  oeer: {
    arketyper: [['skaergaard', 4], ['hovedoe', 3], ['tvillinger', 3]],
    temaer: [['eng', 3], ['skov', 3], ['klippe', 2], ['strand', 2]],
  },
  hule: {
    arketyper: [['storhal', 3], ['kamre', 4], ['tunnelnet', 3]],
    temaer: [['hule', 1]],
  },
  aaben: {
    arketyper: [['bjergkaede', 3], ['dale', 4], ['plateauer', 3]],
    temaer: [['eng', 3], ['skov', 3], ['klippe', 1]],
  },
};

/** Træk et navn fra [[navn, vægt], …] med rng. */
export function vaelgVaegtet(rng, liste) {
  let sum = 0;
  for (const [, v] of liste) sum += v;
  let r = rng() * sum;
  for (const [navn, v] of liste) { if ((r -= v) < 0) return navn; }
  return liste[liste.length - 1][0];
}

/** Arketype og tema for en natur-banetype — kun fra frøet. */
export function vaelgArketype(type, froe) {
  const S = SKEMAER[type];
  const rng = lavRng((froe ^ 0x1b873593) >>> 0);
  return { arketype: vaelgVaegtet(rng, S.arketyper), tema: vaelgVaegtet(rng, S.temaer) };
}

/** En rng med de små hjælpere, trukket fra frøet og et salt. */
export function traekker(froe, salt) {
  const r = lavRng(((froe >>> 0) ^ salt) >>> 0);
  r.mellem = (a, b) => a + r() * (b - a);
  r.heltal = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.chance = (p) => r() < p;
  return r;
}

/* ------------------------------------------------------------ hoppet
 *
 * Hop: HOP_VX 160, HOP_VY 235; salto: 90 baglæns, 330 op; tyngde 480, maks
 * faldfart 780 (physics.js). raekkevidde(d) er, hvor langt vandret en kunde
 * højst når, når hun lander d wu LAVERE (d < 0: højere) — plus kapslens
 * bredde. Salto'en er med, hvor den når højere op end hoppet.
 */
const HOP_VX = 160, HOP_VY = 235, SALTO_VX = 90, SALTO_VY = 330, G = 480, VMAKS = 780;
const KAPSEL = 16;

function flyvetid(vy, d) {
  // Tid, til man er d under startpunktet (på vej ned), med loft på
  // faldfarten: frit fald fra toppen, til farten når VMAKS, derefter jævnt.
  const apex = vy * vy / (2 * G);
  if (-d > apex) return -1;                             // så højt når man ikke op
  const tTop = vy / G;
  const faldFraTop = apex + d;
  const fri = VMAKS * VMAKS / (2 * G);
  if (faldFraTop <= fri) return tTop + Math.sqrt(2 * faldFraTop / G);
  return tTop + VMAKS / G + (faldFraTop - fri) / VMAKS;
}

export function raekkevidde(d) {
  const tH = flyvetid(HOP_VY, d), tS = flyvetid(SALTO_VY, d);
  const x = Math.max(tH >= 0 ? HOP_VX * tH : -1, tS >= 0 ? SALTO_VX * tS : -1);
  return x < 0 ? 0 : x + KAPSEL;
}

/** Det største fald d, hvor raekkevidde(d) <= x (til konvolutten). */
export function raekkeviddeInv(x) {
  if (raekkevidde(0) > x) return -1;
  let lo = 0, hi = 4000;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (raekkevidde(m) <= x) lo = m; else hi = m; }
  return lo;
}

/* ------------------------------------------------------------ oprydning
 *
 * Forbundne komponenter over RÆKKE-LØB (union-find), ikke pixel for pixel:
 * banen har ~20.000 løb mod ~5 mio. faste pixels, så det er en brøkdel af
 * prisen. Løse klatter under `mindste` px fjernes; store svævende øer
 * beholdes (MapGEN: ingen små flydende stumper). Med luftMindste lukkes
 * også små, helt indelukkede luftbobler (mørke prikker inde i klippen).
 */
export function ryddOp(t, mindste = 900, luftMindste = 0) {
  if (mindste > 0) komponenter(t, true, mindste);
  if (luftMindste > 0) komponenter(t, false, luftMindste);
}

function komponenter(t, fast, mindste) {
  const { w, h, maske } = t;
  // Løbene: [række, a, b] i tre typed arrays, der vokser efter behov.
  let kap = 65536, n = 0;
  let R = new Int32Array(kap), A = new Int32Array(kap), B = new Int32Array(kap);
  const start = new Int32Array(h + 1);
  // Ord på fire pixels: 0 = fire gange luft; uden nul-byte = fire gange fast.
  const ord = (w & 3) === 0 && (maske.byteOffset & 3) === 0 ? new Uint32Array(maske.buffer, maske.byteOffset, maske.length >> 2) : null;
  const alleFaste = (v) => ((v - 0x01010101) & ~v & 0x80808080) === 0;
  const springLuft = (o, x) => {                  // til første faste pixel
    while (x < w && (x & 3) !== 0 && maske[o + x] === LUFT) x++;
    if (ord && x < w && maske[o + x] === LUFT) while (x + 4 <= w && ord[(o + x) >> 2] === 0) x += 4;
    while (x < w && maske[o + x] === LUFT) x++;
    return x;
  };
  const springFast = (o, x) => {                  // til første luftpixel
    while (x < w && (x & 3) !== 0 && maske[o + x] !== LUFT) x++;
    if (ord && x < w && maske[o + x] !== LUFT) while (x + 4 <= w && alleFaste(ord[(o + x) >> 2])) x += 4;
    while (x < w && maske[o + x] !== LUFT) x++;
    return x;
  };
  for (let r = 0; r < h; r++) {
    start[r] = n;
    const o = r * w;
    let x = 0;
    while (x < w) {
      // spring hen til næste pixel af den søgte slags
      x = fast ? springLuft(o, x) : springFast(o, x);
      if (x >= w) break;
      const a = x;
      x = fast ? springFast(o, x) : springLuft(o, x);
      if (n === kap) {
        kap *= 2;
        const R2 = new Int32Array(kap), A2 = new Int32Array(kap), B2 = new Int32Array(kap);
        R2.set(R); A2.set(A); B2.set(B); R = R2; A = A2; B = B2;
      }
      R[n] = r; A[n] = a; B[n] = x - 1; n++;
    }
  }
  start[h] = n;
  const far = new Int32Array(n);
  for (let i = 0; i < n; i++) far[i] = i;
  const find = (i) => { while (far[i] !== i) { far[i] = far[far[i]]; i = far[i]; } return i; };
  // Forbind med overlappende løb i rækken ovenover (4-naboskab).
  for (let r = 1; r < h; r++) {
    let j = start[r - 1];
    const jEnd = start[r];
    for (let i = start[r]; i < start[r + 1]; i++) {
      while (j < jEnd && B[j] < A[i]) j++;
      for (let k = j; k < jEnd && A[k] <= B[i]; k++) {
        const a = find(i), b = find(k);
        if (a !== b) far[a] = b;
      }
    }
  }
  const areal = new Float64Array(n);
  const kant = new Uint8Array(n);           // luft: rører banens kant (himlen) — aldrig en boble
  for (let i = 0; i < n; i++) {
    const rod = find(i);
    areal[rod] += B[i] - A[i] + 1;
    if (!fast && (R[i] === 0 || A[i] === 0 || B[i] === w - 1)) kant[rod] = 1;
  }
  const fyld = fast ? LUFT : JORD;
  for (let i = 0; i < n; i++) {
    const rod = find(i);
    if (areal[rod] >= mindste || kant[rod]) continue;
    const o = R[i] * w;
    // Grundfjeld røres aldrig (havbunden og hulens loft).
    for (let x = A[i]; x <= B[i]; x++) if (maske[o + x] !== FJELD) maske[o + x] = fyld;
  }
}

/** Fjern enkeltpixel-støj og luk 1 px sprækker (4-naboskabet). Med kanter
 *  (felterne, taerskel gav tilbage) kun dér — resten af banen er ren luft
 *  eller rent fast og kan ikke have støj. */
export function despeckle(t, kanter = null) {
  const { w, h, maske } = t;
  const kopi = maske.slice();
  const pixel = (x, y) => {
    const r = (h - 1 - y) * w, i = r + x;
    const c = kopi[i];
    const vn = kopi[i - 1] !== LUFT, hn = kopi[i + 1] !== LUFT;
    const on = kopi[i - w] !== LUFT, nn = kopi[i + w] !== LUFT;
    if (c !== LUFT) { if (!vn && !hn && !on && !nn) maske[i] = LUFT; }
    else if ((vn && hn) || (on && nn)) maske[i] = vn && hn ? (kopi[i - 1] || JORD) : (kopi[i - w] || JORD);
  };
  if (!kanter) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) pixel(x, y);
    return;
  }
  const S = SKALA;
  for (let k = 0; k < kanter.length; k += 2) {
    const x0 = Math.max(1, kanter[k] * S - 1), y0 = Math.max(1, kanter[k + 1] * S - 1);
    const x1 = Math.min(w - 2, kanter[k] * S + S), y1 = Math.min(h - 2, kanter[k + 1] * S + S);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixel(x, y);
  }
}

/* ------------------------------------------------------------ standpladser
 *
 * Alle steder, en kunde kan stå: fast under, 30 wu fri kapsel over (46 til
 * hovedet i fortets rum), over vandet. Til forskel fra overflade() finder
 * den også gulve under et loft — hulens kamre, under overhæng og broer.
 * Resultatet er en flad Int32Array [x, y, x, y, …] sorteret efter x.
 */
export function standpladser(t, trin = 4, frihoejde = 32, vand = VAND_NIVEAU) {
  const { w, h, maske } = t;
  const kol = Math.floor((w - 1) / trin) + 1;
  const luft = new Int32Array(kol).fill(1 << 20);  // luft over i kolonnen (toppen er fri himmel)
  const ud = [];
  for (let r = 0; r < h; r++) {
    const y = h - 1 - r, o = r * w;
    for (let k = 0; k < kol; k++) {
      const x = k * trin;
      if (maske[o + x] === LUFT) { luft[k]++; continue; }
      if (luft[k] >= frihoejde && y >= vand) ud.push(x, y + 1);
      luft[k] = 0;
    }
  }
  // Sortér efter x (så efter y) — naboopslag bliver billige.
  const n = ud.length / 2, idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => ud[2 * a] - ud[2 * b] || ud[2 * a + 1] - ud[2 * b + 1]);
  const s = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) { s[2 * i] = ud[2 * idx[i]]; s[2 * i + 1] = ud[2 * idx[i] + 1]; }
  return s;
}

/* ------------------------------------------------------------ krydsning
 *
 * Kan en kunde hoppe fra et område over i et andet? områdeAf(x, y) giver
 * områdets nummer (-1 = tæller ikke). To standpladser i hvert sit område er
 * en krydsning, når den vandrette afstand er under raekkevidde(fald) + margen.
 * Bruges af fortet (ingen må hoppe over til fjenden eller ud på en ø midt i
 * havet) og af testene. Returnerer den første krydsning eller null.
 */
export function findKrydsning(pladser, omraadeAf, margen = 8, maksDx = 760) {
  const n = pladser.length / 2;
  const om = new Int32Array(n);
  for (let i = 0; i < n; i++) om[i] = omraadeAf(pladser[2 * i], pladser[2 * i + 1]);
  // Tabel over fald -> rækkevidde i trin af 8 wu (billigere end at regne).
  const tab = new Float32Array(600);
  for (let i = 0; i < 600; i++) tab[i] = raekkevidde((i - 150) * 8);
  const rv = (d) => { const i = Math.round(d / 8) + 150; return tab[i < 0 ? 0 : i > 599 ? 599 : i]; };
  let j0 = 0;
  for (let i = 0; i < n; i++) {
    const oi = om[i];
    if (oi < 0) continue;
    const xi = pladser[2 * i], yi = pladser[2 * i + 1];
    while (pladser[2 * j0] < xi - maksDx) j0++;
    for (let j = j0; j < n && pladser[2 * j] <= xi + maksDx; j++) {
      const oj = om[j];
      if (oj < 0 || oj === oi) continue;
      const dx = Math.abs(pladser[2 * j] - xi);
      if (dx < rv(yi - pladser[2 * j + 1]) + margen) return { fra: { x: xi, y: yi, omraade: oi }, til: { x: pladser[2 * j], y: pladser[2 * j + 1], omraade: oj }, dx };
    }
  }
  return null;
}

/* ------------------------------------------------------------ pynten
 *
 * Genbrug af de eksisterende pyntegrafik (render/kunst.js PYNT_TYPER):
 * græstotter, blomster, svampe, sten, busk, siv, kogle, pindebunke, bregne
 * og kløver. Der findes ingen træer eller andre dekorative genstande —
 * printere, miner, telefoner og kasser er spilgenstande, ikke pynt.
 *
 * MapGEN-reglerne:
 *   - RIGTIG kontakt: foden skal have fast grund under begge sider af
 *     tingen, fri luft lige over grunden og plads til hele højden (intet
 *     loft, der skærer den over). Aldrig svævende.
 *   - tilfældig spejling og størrelse
 *   - tæthed pr. tema (gennemsnitlig afstand), og ALDRIG klumper: en
 *     mindsteafstand mellem to ting, der er større for de store ting, og
 *     højst én stor ting pr. strækning.
 *   - aldrig på en startplads: world.js vælger ikke startpladser og udstyr
 *     under en stor ting (PYNT_STOR), og fortets kunder står i rum af mur.
 * Størrelserne er de tegnede (1 wu = 3 px i atlasset, cellen er 128 px).
 */
export const PYNT = {
  tot1: { w: 30, h: 24 }, tot2: { w: 34, h: 28 }, tot3: { w: 26, h: 20 }, tot4: { w: 38, h: 30 },
  blomst_gul: { w: 22, h: 34 }, blomst_hvid: { w: 22, h: 30 },
  svamp: { w: 24, h: 24 }, svampe: { w: 30, h: 22 },
  sten1: { w: 26, h: 18 }, sten2: { w: 34, h: 22 },
  busk: { w: 56, h: 42, stor: true }, siv: { w: 30, h: 56, stor: true },
  kogle: { w: 18, h: 16 }, pinde: { w: 50, h: 26, stor: true },
  bregne: { w: 40, h: 34, stor: true }, kloever: { w: 30, h: 20 },
};
export const PYNT_STOR = 44;     // så langt fra en stor ting står ingen kunde fra start

/* Temaerne (MapGEN: ø-baner har valgbare temaer). afstand = gennemsnitlig
 * afstand mellem ting i wu; kyst = det, der gror nær vandet. */
export const PYNT_TEMAER = {
  eng:    { afstand: 22, vaegte: { tot1: 14, tot2: 12, tot3: 10, tot4: 8, blomst_gul: 9, blomst_hvid: 8, kloever: 9, busk: 3, bregne: 2, sten1: 3, svamp: 1 },
            kyst: { siv: 30, tot4: 12, tot1: 8, sten1: 4 } },
  skov:   { afstand: 20, vaegte: { tot1: 8, tot2: 8, tot4: 6, bregne: 12, svamp: 6, svampe: 6, kogle: 7, pinde: 4, busk: 6, sten2: 2, kloever: 3 },
            kyst: { siv: 24, bregne: 6, tot4: 8 } },
  klippe: { afstand: 34, vaegte: { sten1: 14, sten2: 12, tot3: 8, tot1: 5, kogle: 2, busk: 2, kloever: 2 },
            kyst: { sten1: 10, sten2: 6, siv: 6 } },
  strand: { afstand: 28, vaegte: { tot4: 10, tot3: 8, sten1: 8, sten2: 5, siv: 6, kloever: 4, blomst_hvid: 3 },
            kyst: { siv: 26, sten1: 8, tot4: 8 } },
  hule:   { afstand: 32, vaegte: { svamp: 14, svampe: 12, sten1: 12, sten2: 9, kogle: 4, pinde: 3, tot3: 3 },
            kyst: { sten1: 10, svampe: 6 } },
};

/** Placér pynt på banens græsflader efter temaet. Returnerer en liste af
 *  { x, y, navn, str, spejl } (str: tingens tegnede skala, 1 = normal). */
export function placerPynt(t, temaNavn, froe, vand = VAND_NIVEAU) {
  const tema = PYNT_TEMAER[temaNavn] || PYNT_TEMAER.eng;
  const rng = traekker(froe, 0x9a7e51);
  const { w, h, maske } = t;
  const fast = (x, y) => x >= 0 && x < w && y >= 0 && y < h && maske[(h - 1 - y) * w + x] !== LUFT;
  const jord = (x, y) => x >= 0 && x < w && y >= 0 && y < h && maske[(h - 1 - y) * w + x] === JORD;
  const vaelg = (vaegte) => {
    const liste = Object.entries(vaegte);
    return () => vaelgVaegtet(rng, liste);
  };
  const inde = vaelg(tema.vaegte), kyst = vaelg(tema.kyst);
  // Græsflader: jord med mindst 40 wu luft over (som græsset i kunst.js).
  const flader = standpladser(t, 3, 40, vand + 6);
  const ting = [];
  const sidste = new Map();                // navn -> x for den seneste af slagsen
  let sidsteStor = -1e9;
  let naesteX = -1e9;
  for (let i = 0; i < flader.length; i += 2) {
    const x = flader[i], y = flader[i + 1] - 1;
    if (x < naesteX || x < 30 || x > w - 30) continue;
    if (!jord(x, y)) continue;              // kun på jord: ikke på mur, bro eller grundfjeld
    const vedKyst = y < vand + 70;
    const navn = (vedKyst ? kyst : inde)();
    const P = PYNT[navn];
    const str = Math.round((0.8 + rng() * 0.45) * 100) / 100;
    const hb = Math.max(6, Math.round(P.w * str * 0.3));      // foden: 60 % af bredden
    const hoej = Math.round(P.h * str) + 6;
    // Rigtig kontakt: grund under begge sider af foden, fri luft lige over,
    // og intet loft i hele tingens højde.
    let ok = fast(x - hb, y - 3) && fast(x + hb, y - 3) && !fast(x - hb, y + 8) && !fast(x + hb, y + 8);
    for (let yy = y + 2; ok && yy <= y + hoej; yy += 4) if (fast(x, yy) || fast(x - hb, yy + 6) || fast(x + hb, yy + 6)) ok = false;
    if (!ok) continue;
    // Aldrig klumper: afstand til sin egen slags og til den seneste store.
    const min = P.stor ? 150 : 12 + P.w * 0.35;
    if (sidste.has(navn) && x - sidste.get(navn) < min) continue;
    if (P.stor && x - sidsteStor < 150) continue;
    const forrige = ting[ting.length - 1];
    if (forrige && Math.abs(forrige.y - y) < 60 && x - forrige.x < (PYNT[forrige.navn].w * forrige.str + P.w * str) * 0.42) continue;
    ting.push({ x, y: y + 1, navn, str, spejl: rng() < 0.5 ? -1 : 1 });
    sidste.set(navn, x);
    if (P.stor) sidsteStor = x;
    naesteX = x + Math.round(tema.afstand * (0.45 + rng() * 1.1));
  }
  return ting;
}

/* ------------------------------------------------------------ broer
 *
 * En bro er et dæk af murværk (MUR) — destruktibelt som jord, og tegnet med
 * planker, fordi det er tyndt (terrain_view.bagFortFelt). Dækket ligger med
 * oversiden i y, og enderne hviler på land. Med stolper ned til bunden,
 * hvis `stolper` er sat (en bro over vand står på pæle).
 */
export function bygBro(t, x0, x1, y, tyk = 16, stolper = 0) {
  const { w, h, maske } = t;
  const saet = (x, yy, v) => { if (x >= 0 && x < w && yy >= 0 && yy < h) maske[(h - 1 - yy) * w + x] = v; };
  for (let x = x0; x <= x1; x++) for (let yy = y - tyk + 1; yy <= y; yy++) saet(x, yy, MUR);
  if (stolper > 0) {
    const n = Math.max(1, Math.round((x1 - x0) / stolper));
    for (let i = 1; i < n; i++) {
      const px = Math.round(x0 + (x1 - x0) * i / n);
      for (let yy = y - tyk; yy >= FJELD_BUND; yy--) {
        if (maske[(h - 1 - yy) * w + px] !== LUFT && maske[(h - 1 - yy) * w + px] !== MUR) break;
        for (let dx = -5; dx <= 5; dx++) saet(px + dx, yy, MUR);
      }
    }
  }
}

/* ------------------------------------------------------------ felter
 *
 * Naturbanerne bygges som et tæthedsfelt i kvart opløsning (> 0 er fast) og
 * tærskles bilineært op til fuld opløsning. Blokke, hvor alle fire hjørner
 * er klart faste eller klart luft, fyldes uden interpolation — det er dér,
 * tiden spares (det meste af banen er langt fra en kant).
 */
export const SKALA = 4;

export function taerskel(t, felt, fw, fh, mat = JORD) {
  const { w, h, maske } = t;
  const S = SKALA;
  const klasse = new Uint8Array(fw);          // 0 luft, 1 fast, 2 kant
  const kanter = [];
  for (let cy = 0; cy < fh - 1; cy++) {
    const o0 = cy * fw, o1 = o0 + fw;
    for (let cx = 0; cx < fw - 1; cx++) {
      const a = felt[o0 + cx], b = felt[o0 + cx + 1], c = felt[o1 + cx], d = felt[o1 + cx + 1];
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      klasse[cx] = hi <= 0 ? 0 : lo > 0 ? 1 : 2;
      if (klasse[cx] === 2) kanter.push(cx, cy);
    }
    klasse[fw - 1] = 0;
    for (let dy = 0; dy < S; dy++) {
      const yy = cy * S + dy;
      if (yy >= h) break;
      const o = (h - 1 - yy) * w;
      const ty = dy / S;
      for (let cx = 0; cx < fw - 1;) {
        const k = klasse[cx];
        if (k === 0) { cx++; continue; }
        if (k === 1) {
          // et løb af faste felter i ét kald
          let cx2 = cx + 1;
          while (cx2 < fw - 1 && klasse[cx2] === 1) cx2++;
          maske.fill(mat, o + cx * S, o + Math.min(w, cx2 * S));
          cx = cx2;
          continue;
        }
        const a = felt[o0 + cx], b = felt[o0 + cx + 1], c = felt[o1 + cx], d = felt[o1 + cx + 1];
        const l = a + (c - a) * ty, r = b + (d - b) * ty;
        const x0 = cx * S;
        for (let dx = 0; dx < S && x0 + dx < w; dx++) {
          const v = l + (r - l) * (dx / S);
          // Lille ordnet dither, så kanten ikke bliver helt glat.
          const dith = (((dx * 5 + dy * 3 + cx * 7 + cy * 11) & 7) - 3.5) * 0.12;
          if (v + dith > 0) maske[o + x0 + dx] = mat;
        }
        cx++;
      }
    }
  }
  return kanter;
}

/** Støj i et groft gitter (hvert `trin` felt), bilineært op til feltet.
 *  fn(wx, wy) får world-koordinater. Lavfrekvent støj koster derved en
 *  brøkdel af at regne den i hver celle. */
export function grofStoej(fw, fh, trin, fn) {
  const gw = Math.ceil(fw / trin) + 1, gh = Math.ceil(fh / trin) + 1;
  const g = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = fn(i * trin * SKALA, j * trin * SKALA);
  const ud = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    const gy = y / trin, j = Math.min(gh - 2, Math.floor(gy)), ty = gy - j;
    for (let x = 0; x < fw; x++) {
      const gx = x / trin, i = Math.min(gw - 2, Math.floor(gx)), tx = gx - i;
      const a = g[j * gw + i], b = g[j * gw + i + 1], c = g[(j + 1) * gw + i], d = g[(j + 1) * gw + i + 1];
      ud[y * fw + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return ud;
}

/** Glat trinovergang 0-1. */
export const glat = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Grundfjeld i bunden (havbunden) og, for hulen, i loftet. */
export function grundfjeld(t, loft = false) {
  const { w, h, maske } = t;
  for (let y = 0; y < FJELD_BUND; y++) maske.fill(FJELD, (h - 1 - y) * w, (h - y) * w);
  if (loft) for (let y = h - FJELD_BUND; y < h; y++) maske.fill(FJELD, (h - 1 - y) * w, (h - y) * w);
}
