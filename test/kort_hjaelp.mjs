/* Kundekrigen — fælles hjælpere til banetestene (test/kort_*.mjs).
 *
 * En lille PNG-koder (zlib fra Node, ingen pakker) og en tegner, der maler
 * en genereret bane som et kort: himmel, hav, jord med græs, grundfjeld,
 * murværk, fortenes bagvæg, startpladser og pynt. Kun til test og billeder;
 * spillet bruger den ikke.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { LUFT, JORD, FJELD, MUR } from '../static/js/sim/terrain.js';

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Skriv et RGB-billede (Uint8Array w*h*3) som PNG. */
export function skrivPng(sti, w, h, rgb) {
  const raa = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raa[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raa, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raa, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(sti, png);
}

const FARVE = {
  himmel: [150, 196, 230], hav: [40, 92, 150], havDyb: [24, 60, 110],
  jord: [128, 88, 52], graes: [92, 160, 60], fjeld: [70, 72, 76],
  mur: [176, 166, 150], murKant: [120, 110, 98], bag: [92, 80, 72],
};

/** Mal banen nedskaleret med faktor s (gennemsnit af s x s pixels, så
 *  tynde broer og tinder stadig kan ses). Returnerer { w, h, rgb }. */
export function malBane(t, s = 4, { pladser = [], pynt = [], udstyr = [] } = {}) {
  const W = Math.floor(t.w / s), H = Math.floor(t.h / s);
  const rgb = new Uint8Array(W * H * 3);
  const vand = t.vandNiveau ?? 300;
  const rum = t.fort?.rum || [];
  // Bagvæg pr. pixel (kun fortet): et lille bitfelt i lav opløsning.
  const bag = new Uint8Array(W * H);
  for (const r of rum) {
    for (let y = Math.floor(r.y0 / s); y <= Math.floor(r.y1 / s); y++) {
      for (let x = Math.floor(r.x0 / s); x <= Math.floor(r.x1 / s); x++) {
        const Y = H - 1 - y;
        if (x >= 0 && x < W && Y >= 0 && Y < H) bag[Y * W + x] = 1;
      }
    }
  }
  const { maske, w } = t;
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let n = [0, 0, 0, 0], graes = 0;
      for (let dy = 0; dy < s; dy++) {
        const r = (Y * s + dy) * w;
        for (let dx = 0; dx < s; dx++) {
          const i = r + X * s + dx;
          const v = maske[i];
          n[v]++;
          if (v === JORD && (i - w < 0 || maske[i - w] === LUFT)) graes++;
        }
      }
      const yv = (H - 1 - Y) * s;
      let c;
      const fast = n[1] + n[2] + n[3];
      if (fast * 2 < s * s) c = yv < vand ? (yv < vand - 400 ? FARVE.havDyb : FARVE.hav) : bag[Y * W + X] ? FARVE.bag : FARVE.himmel;
      else if (n[3] >= n[1] && n[3] >= n[2]) c = FARVE.mur;
      else if (n[2] > n[1]) c = FARVE.fjeld;
      else c = graes && yv > vand ? FARVE.graes : FARVE.jord;
      // Under vandet ses terrænet gennem havet.
      if (fast * 2 >= s * s && yv < vand) c = [c[0] * 0.45 + FARVE.hav[0] * 0.55, c[1] * 0.45 + FARVE.hav[1] * 0.55, c[2] * 0.45 + FARVE.hav[2] * 0.55];
      const k = (Y * W + X) * 3;
      rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2];
    }
  }
  // Murværkets kanter lidt mørkere, så tårne og tinder skiller sig ud.
  const kopi = rgb.slice();
  const erMur = (X, Y) => X >= 0 && Y >= 0 && X < W && Y < H && kopi[(Y * W + X) * 3] === FARVE.mur[0] && kopi[(Y * W + X) * 3 + 1] === FARVE.mur[1];
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    if (!erMur(X, Y)) continue;
    if (!erMur(X - 1, Y) || !erMur(X + 1, Y) || !erMur(X, Y - 1) || !erMur(X, Y + 1)) {
      const k = (Y * W + X) * 3; rgb[k] = FARVE.murKant[0]; rgb[k + 1] = FARVE.murKant[1]; rgb[k + 2] = FARVE.murKant[2];
    }
  }
  const prik = (x, y, c, r = 2) => {
    const X0 = Math.round(x / s), Y0 = H - 1 - Math.round(y / s);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = X0 + dx, Y = Y0 + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const k = (Y * W + X) * 3; rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2];
    }
  };
  for (const p of pynt) prik(p.x, p.y + 4, [30, 110, 30], 1);
  for (const p of udstyr) prik(p.x, p.y + 6, [240, 200, 40], 1);
  const HOLDF = [[220, 40, 40], [40, 80, 230], [40, 180, 60], [230, 140, 20], [160, 60, 200], [20, 200, 200]];
  for (const p of pladser) prik(p.x, p.y + 12, p.hold != null ? HOLDF[p.hold % 6] : [255, 255, 255], 2);
  return { w: W, h: H, rgb };
}

/** Sæt billeder sammen i et gitter med en mørk kant imellem. */
export function kontaktark(billeder, kol, kant = 6) {
  const bw = Math.max(...billeder.map((b) => b.w)), bh = Math.max(...billeder.map((b) => b.h));
  const rk = Math.ceil(billeder.length / kol);
  const W = kol * bw + (kol + 1) * kant, H = rk * bh + (rk + 1) * kant;
  const rgb = new Uint8Array(W * H * 3).fill(30);
  billeder.forEach((b, i) => {
    const ox = kant + (i % kol) * (bw + kant), oy = kant + Math.floor(i / kol) * (bh + kant);
    for (let y = 0; y < b.h; y++) rgb.set(b.rgb.subarray(y * b.w * 3, (y + 1) * b.w * 3), ((oy + y) * W + ox) * 3);
  });
  return { w: W, h: H, rgb };
}

/* En lille 3x5-skrift til etiketter på kontaktarkene (kun små bogstaver). */
const SKRIFT = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111',
  f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010',
  k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010',
  p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010',
  z: '111001010100111', 'æ': '011110111110111', 'ø': '011101111101110', 'å': '010000010101111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001',
  5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '/': '001001010100100', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', ' ': '000000000000000',
  '(': '010100100100010', ')': '010001001001010', '+': '000010111010000', '=': '000111000111000', '%': '101001010100101',
};

/** Skriv tekst ind i et { w, h, rgb }-billede (øverste venstre hjørne x, y). */
export function skrivTekst(b, x, y, tekst, farve = [255, 255, 255], s = 2, bund = [20, 20, 20]) {
  const tegn = [...String(tekst).toLowerCase()];
  // mørk baggrund bag teksten, så den kan læses på himlen
  const bw = tegn.length * 4 * s + s, bh = 7 * s;
  for (let yy = y - s; yy < y - s + bh; yy++) for (let xx = x - s; xx < x - s + bw; xx++) {
    if (xx < 0 || yy < 0 || xx >= b.w || yy >= b.h) continue;
    const k = (yy * b.w + xx) * 3; b.rgb[k] = bund[0]; b.rgb[k + 1] = bund[1]; b.rgb[k + 2] = bund[2];
  }
  tegn.forEach((c, i) => {
    const g = SKRIFT[c] || SKRIFT[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) {
      if (g[r * 3 + q] !== '1') continue;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
        const X = x + (i * 4 + q) * s + dx, Y = y + r * s + dy;
        if (X < 0 || Y < 0 || X >= b.w || Y >= b.h) continue;
        const k = (Y * b.w + X) * 3; b.rgb[k] = farve[0]; b.rgb[k + 1] = farve[1]; b.rgb[k + 2] = farve[2];
      }
    }
  });
}

/** Beskær et billede. */
export function beskaer(b, x0, y0, w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) rgb.set(b.rgb.subarray(((y0 + y) * b.w + x0) * 3, ((y0 + y) * b.w + x0 + w) * 3), y * w * 3);
  return { w, h, rgb };
}

/** Frø nr. i til testene: spredte, faste 32-bit frø. */
export const testFroe = (i) => (Math.imul(i + 1, 2654435761) + 0x5bd1e995) >>> 0;

/* ------------------------------------------------------------ testene */

let fejl = 0, ok = 0;
/** En kontrol: skriv ok/FEJL og tæl. Sætter afslutningskoden ved fejl. */
export function tjek(navn, betingelse, detalje = '') {
  if (betingelse) { ok++; console.log(`  ok    ${navn}${detalje ? ` — ${detalje}` : ''}`); }
  else { fejl++; process.exitCode = 1; console.log(`  FEJL  ${navn}${detalje ? ` — ${detalje}` : ''}`); }
  return !!betingelse;
}
export function overskrift(tekst) { console.log(`\n${tekst}`); }
export function status() { return { ok, fejl }; }

/** Banens faste stof over vandet i et groft gitter (celler på c wu) — til at
 *  måle, hvor forskellige to baner er. */
export function silhuet(t, c = 64, luft = false) {
  // luft: tæl hulrummene i stedet for klippen (grotten er mest klippe)
  const W = Math.floor(t.w / c), H = Math.floor(t.h / c);
  const ud = new Uint8Array(W * H);
  const vand = t.vandNiveau ?? 300;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let n = 0;
    for (let dy = 0; dy < c; dy += 8) for (let dx = 0; dx < c; dx += 8) {
      const y = j * c + dy;
      if (y >= vand && (t.maske[(t.h - 1 - y) * t.w + i * c + dx] !== LUFT) !== luft) n++;
    }
    ud[j * W + i] = n * 2 >= (c / 8) * (c / 8) ? 1 : 0;
  }
  return ud;
}

/** Kun selve borgen (fortets første): murværket i celler på c wu, rettet ind
 *  efter facaden og stueetagens gulv (y[0]), i et vindue på wd x hd wu bag
 *  facaden — så landskabet, afstanden og løftet ikke tæller med. Til at måle,
 *  hvor forskellige to borge med samme siluet er. */
export function borgSilhuet(t, c = 24, wd = 1400, hd = 1500) {
  const f = t.fort.forter[0], fac = f.facade;
  const W = Math.floor(wd / c), H = Math.floor(hd / c), ud = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let n = 0, m = 0;
    for (let dy = 0; dy < c; dy += 4) for (let dx = 0; dx < c; dx += 4) {
      const x = fac - wd + i * c + dx, y = t.fort.base - 120 + j * c + dy;
      if (x < 0 || x >= t.w || y >= t.h) continue;
      m++; if (t.maske[(t.h - 1 - y) * t.w + x] === MUR) n++;
    }
    ud[j * W + i] = m && n * 2 >= m ? 1 : 0;
  }
  return ud;
}

/** Jaccard-afstanden mellem to silhuetter: 0 = ens, 1 = intet til fælles. */
export function afstand(a, b) {
  let fael = 0, en = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) fael++; if (a[i] || b[i]) en++; }
  return en ? 1 - fael / en : 0;
}

/** FNV over hele masken (til at se, om to baner er identiske). */
export function maskeHash(t) {
  let h = 0x811c9dc5;
  const m = t.maske;
  for (let i = 0; i < m.length; i += 7) { h ^= m[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Hold til lavVerden, som main.js bygger dem: antalHold hold med prHold kunder. */
export function lavHold(antalHold, prHold) {
  const farver = ['blaa', 'roed', 'groen', 'gul', 'lilla', 'orange'];
  const hold = [];
  for (let i = 0; i < antalHold; i++) {
    const baevere = [];
    for (let j = 0; j < prHold; j++) baevere.push({ navn: `k${i}${j}`, udseende: {}, ejer: `p${i}` });
    hold.push({ farve: farver[i], navn: `Hold ${i}`, spillere: [`p${i}`], baevere });
  }
  return hold;
}

/** Percentil af en talliste. */
export function percentil(liste, p) {
  const s = liste.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
