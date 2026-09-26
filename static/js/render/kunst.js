/* Kundekrigen — illustreret grafik, tegnet i canvas ved opstart.
 *
 * Målet er det visuelle sprog fra nyere Worms-spil: tekstureret jord med sten
 * og rødder, frodigt græs med tjavset underkant, ting begravet i jorden, og en
 * overflade fuld af småplanter. Alt tegnes her som bitmaps og bruges derefter
 * som teksturer — ingen billedfiler, og alt følger banens frø.
 *
 * Stilregler, der går igen i hele filen:
 *   - Lyset kommer oppefra til venstre. Højlys øverst til venstre, skygge
 *     nederst til højre — samme retning som solen i himlen.
 *   - Alt får en mørk kontur. Det er konturen, der gør en lille figur læsbar
 *     og får tingene til at ligne illustration frem for foto.
 *   - Farverne holder sig i en jordtone- og grønfamilie, bare mættet nok
 *     til at kunne læses på en skærm.
 */
'use strict';

import { tegnFejlvindue } from './fejl40.js';

import { lavRng, fbm1, fbm2, hash2 } from '../core/rng.js';
import { LUFT, FJELD, MUR } from '../sim/terrain.js';

export const KANT = '#1E1610';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ------------------------------------------------------------ jordtekstur */

/**
 * Sømløs jordtekstur, 1024 x 1024. Gentages over hele banen.
 *
 * Alt der tegnes tæt på en kant, tegnes også forskudt med én teksturbredde,
 * ellers ville man se sømmen, hver gang teksturen gentages.
 */
export function lavJordtekstur(froe) {
  const S = 1024;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rng = lavRng((froe ^ 0x5eed) >>> 0);

  const omkring = (x, y, r, tegn) => {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const px = x + ox, py = y + oy;
        if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
        tegn(px, py);
      }
    }
  };

  // Grundfarve
  g.fillStyle = '#7B5B3D';
  g.fillRect(0, 0, S, S);

  // Store bløde skjolder — farvevariation, så jorden ikke er én flade
  const skjold = ['#6A4C31', '#8C6A48', '#5E432B', '#97754F', '#72543A'];
  for (let i = 0; i < 80; i++) {
    const x = rng() * S, y = rng() * S, r = 50 + rng() * 170;
    const farve = skjold[Math.floor(rng() * skjold.length)];
    const a = 0.10 + rng() * 0.16;
    omkring(x, y, r, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, hexA(farve, a));
      gr.addColorStop(1, hexA(farve, 0));
      g.fillStyle = gr;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }

  // Klumper: små uregelmæssige knolde med lys overkant — det er dem, der
  // giver jorden sin knoldede Worms-struktur i stedet for en glat flade.
  for (let i = 0; i < 700; i++) {
    const x = rng() * S, y = rng() * S, r = 2.5 + rng() * 5;
    omkring(x, y, r + 2, (px, py) => {
      g.fillStyle = 'rgba(62,42,26,.38)';
      g.beginPath(); g.ellipse(px + 0.8, py + 1.2, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(150,118,84,.30)';
      g.beginPath(); g.ellipse(px - 0.6, py - 0.9, r * 0.7, r * 0.5, 0, 0, Math.PI * 2); g.fill();
    });
  }

  // Grus
  for (let i = 0; i < 5000; i++) {
    const x = rng() * S, y = rng() * S;
    g.fillStyle = rng() < 0.5 ? 'rgba(40,28,18,.35)' : 'rgba(170,140,104,.28)';
    const s = 1 + rng() * 1.6;
    g.fillRect(x, y, s, s);
  }

  // Rødder
  for (let i = 0; i < 16; i++) {
    const x0 = rng() * S, y0 = rng() * S;
    const len = 60 + rng() * 120, v = rng() * Math.PI * 2;
    const tyk = 2 + rng() * 2.4;
    const x1 = x0 + Math.cos(v) * len, y1 = y0 + Math.sin(v) * len;
    const cx = (x0 + x1) / 2 + (rng() - 0.5) * 60, cy = (y0 + y1) / 2 + (rng() - 0.5) * 60;
    omkring((x0 + x1) / 2, (y0 + y1) / 2, len, (px, py) => {
      const dx = px - (x0 + x1) / 2, dy = py - (y0 + y1) / 2;
      g.lineCap = 'round';
      g.strokeStyle = '#3F2B1C'; g.lineWidth = tyk + 1.5;
      g.beginPath(); g.moveTo(x0 + dx, y0 + dy); g.quadraticCurveTo(cx + dx, cy + dy, x1 + dx, y1 + dy); g.stroke();
      g.strokeStyle = '#6E4F35'; g.lineWidth = tyk;
      g.beginPath(); g.moveTo(x0 + dx, y0 + dy); g.quadraticCurveTo(cx + dx, cy + dy, x1 + dx, y1 + dy); g.stroke();
      g.strokeStyle = 'rgba(160,126,90,.55)'; g.lineWidth = Math.max(0.8, tyk * 0.35);
      g.beginPath(); g.moveTo(x0 + dx - 0.8, y0 + dy - 0.8);
      g.quadraticCurveTo(cx + dx - 0.8, cy + dy - 0.8, x1 + dx - 0.8, y1 + dy - 0.8); g.stroke();
    });
  }

  // Sten — det enkeltelement, der sælger Worms-jorden mest. Hver sten har
  // slagskygge, gradient fra lys til mørk, kontur og et lille højlys.
  const stenfarver = ['#A89C88', '#9A8F7E', '#B8AE9A', '#8D8374', '#C2B59C', '#877B6A'];
  for (let i = 0; i < 280; i++) {
    const x = rng() * S, y = rng() * S;
    const r = 3.5 + Math.pow(rng(), 2.2) * 14;
    const rx = r * (0.8 + rng() * 0.5), ry = r * (0.6 + rng() * 0.35);
    const rot = rng() * Math.PI;
    const farve = stenfarver[Math.floor(rng() * stenfarver.length)];
    omkring(x, y, r + 4, (px, py) => tegnSten(g, px, py, rx, ry, rot, farve));
  }

  return c;
}

function tegnSten(g, x, y, rx, ry, rot, farve, kant = '#35271A') {
  g.save();
  g.translate(x, y); g.rotate(rot);
  // slagskygge
  g.fillStyle = 'rgba(35,24,14,.5)';
  g.beginPath(); g.ellipse(1.4, 2, rx, ry, 0, 0, Math.PI * 2); g.fill();
  // selve stenen
  const gr = g.createLinearGradient(-rx, -ry, rx, ry);
  gr.addColorStop(0, lysere(farve, 34));
  gr.addColorStop(0.55, farve);
  gr.addColorStop(1, lysere(farve, -38));
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = kant; g.lineWidth = Math.max(1, Math.min(2.2, rx * 0.16));
  g.stroke();
  // højlys
  g.fillStyle = 'rgba(255,250,235,.42)';
  g.beginPath(); g.ellipse(-rx * 0.35, -ry * 0.38, rx * 0.32, ry * 0.22, -0.4, 0, Math.PI * 2); g.fill();
  g.restore();
}

/* ------------------------------------------------------- terrænets pynt */

/**
 * Bag banens unikke lag i fuld opløsning:
 *   - græs på alle opadvendte flader af det OPRINDELIGE terræn
 *   - ting begravet i jorden (sten, stammer, fossiler, knogler, rødder, kister)
 *
 * Returnerer lærredet (alfa = hvor laget dækker jordteksturen) og listen af
 * overfladepunkter, som pyntelaget bruger til at placere planter.
 *
 * Græsset bages kun på den oprindelige overflade. Graver et krater sig ned
 * gennem græsset, viser shaderen bar, svedet jord — Worms-opførsel.
 */
export function bagTerraenPynt(terraen, froe, vandNiveau) {
  const { w, h, maske } = terraen;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;

  // Græstykkelse med tjavset underkant: en langsom bølge plus hængende tunger.
  const tyk = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const tunge = Math.max(0, Math.sin(x * 0.11 + fbm1(x * 0.004, froe ^ 0x47, 2) * 6));
    tyk[x] = 11 + fbm1(x * 0.013, froe ^ 0x31, 3) * 7 + Math.pow(tunge, 3) * 8;
  }

  const overflader = [];     // [x, y, x, y, ...] i verdenskoordinater
  const GRAES_TOP = [180, 210, 122];
  const GRAES_A = [140, 179, 90];
  const GRAES_B = [94, 142, 58];
  const GRAES_C = [63, 108, 43];
  const GRAES_KANT = [39, 74, 30];

  // Rækkevis gennemløb med tilstand per kolonne. Kolonnevis ville være mere
  // ligetil, men springer w bytes for hver pixel: 1,9 s mod 70 ms på en bane.
  const siden = new Int32Array(w).fill(-1);   // pixels ned i jorden fra overfladen
  const luft = new Int32Array(w).fill(1 << 30); // luft lige over; små huler får intet græs
  const graes = new Uint8Array(w);
  const straa = new Uint8Array(w);
  for (let x = 0; x < w; x++) straa[x] = hash2(x, 7, froe) > 0.68 ? 1 : 0;

  for (let r = 0; r < h; r++) {
    const y = h - 1 - r;
    const raekke = r * w;
    for (let x = 0; x < w; x++) {
      const i = raekke + x;
      const v = maske[i];
      if (v === LUFT) { luft[x] = siden[x] < 0 ? luft[x] + 1 : 1; siden[x] = -1; continue; }
      const sd = siden[x] = siden[x] < 0 ? 0 : siden[x] + 1;
      // Murværk (fortene): intet græs, og jorden lige under muren heller
      // ikke. Selve murstenene tegner terrænshaderen (terrain_view.js).
      if (v === MUR) { graes[x] = 0; continue; }

      if (sd === 0) {
        graes[x] = luft[x] >= 40 ? 1 : 0;
        if (graes[x] && y > vandNiveau + 2) overflader.push(x, y);
      }
      const k = i * 4;
      if (v === FJELD) {
        // Grundfjeld: mørk sten, så havbunden ikke ligner jord.
        const n = hash2(x >> 2, r >> 2, froe) * 18;
        d[k] = 62 + n; d[k + 1] = 64 + n; d[k + 2] = 66 + n; d[k + 3] = 255;
        continue;
      }
      const t = tyk[x];
      if (!graes[x] || sd >= t || y < vandNiveau + 3) continue;

      let farve;
      if (sd < 2) farve = GRAES_TOP;
      else if (sd >= t - 2) farve = GRAES_KANT;
      else {
        const f = sd / t;
        farve = f < 0.55 ? blandRgb(GRAES_A, GRAES_B, f / 0.55)
                         : blandRgb(GRAES_B, GRAES_C, (f - 0.55) / 0.45);
        if (straa[x] && f > 0.15) farve = blandRgb(farve, GRAES_C, 0.45);
      }
      d[k] = farve[0]; d[k + 1] = farve[1]; d[k + 2] = farve[2]; d[k + 3] = 255;
    }
  }

  // Græsfrynser: korte strå, der stikker OP i luften over overfladen. De
  // ligger i luftpixels, så shaderen tegner dem kun, så længe der stadig er
  // jord lige under — graver et krater græsset væk, forsvinder strået med.
  const GRAES_LYS = [204, 230, 140];
  const frynse = (x) => {
    const b = Math.floor(x / 4), pos = x - b * 4;
    const H = 3 + Math.floor(hash2(b, 3, froe) * 7);
    return pos === 0 ? 0 : pos === 2 ? H : Math.max(1, H - 3);
  };
  for (let k = 0; k < overflader.length; k += 2) {
    const x = overflader[k], y = overflader[k + 1];
    if (y < vandNiveau + 4) continue;
    const r = h - 1 - y;
    const f = frynse(x), fv = frynse(x - 1), fh = frynse(x + 1);
    for (let j = 1; j <= f; j++) {
      const rr = r - j;
      if (rr < 0) break;
      const i = rr * w + x;
      if (maske[i] !== LUFT) break;
      const kant = j === f || j > fv || j > fh;
      const farve = kant ? GRAES_KANT : j > f - 2 ? GRAES_LYS : GRAES_TOP;
      const q = i * 4;
      d[q] = farve[0]; d[q + 1] = farve[1]; d[q + 2] = farve[2]; d[q + 3] = 255;
    }
  }

  g.putImageData(img, 0, 0);

  // Ting begravet i jorden. Tegnes EFTER græsset med canvas-API, så de er
  // skarpe; de placeres kun dybt inde, så de aldrig skærer ind i græsset.
  placerBegravet(g, terraen, froe, vandNiveau, tyk);

  return { canvas: c, overflader };
}

function placerBegravet(g, t, froe, vandNiveau, tyk) {
  const { w, h } = t;
  const rng = lavRng((froe ^ 0xb0e5) >>> 0);
  const antal = Math.round((w * h) / 360000);
  const typer = [
    // Sten og rødder er naturen; resten er det IT-skrot, klinikkerne har
    // gravet ned gennem årene.
    ['kampesten', 34], ['stamme', 14], ['diskette', 10], ['kabel', 9],
    ['cd', 9], ['mobil', 9], ['kiste', 3], ['flaske', 3],
  ];
  const sum = typer.reduce((s, [, v]) => s + v, 0);
  const vaelg = () => {
    let r = rng() * sum;
    for (const [n, v] of typer) { if ((r -= v) < 0) return n; }
    return 'kampesten';
  };
  const STR = { kampesten: [18, 34], stamme: [28, 46], diskette: [12, 16], kabel: [18, 26],
                cd: [11, 15], mobil: [10, 14], kiste: [16, 21], flaske: [10, 14] };

  let lagt = 0;
  for (let forsoeg = 0; forsoeg < antal * 30 && lagt < antal; forsoeg++) {
    const type = vaelg();
    const [a, b] = STR[type];
    const R = a + rng() * (b - a);
    const x = R + 20 + rng() * (w - 2 * R - 40);
    const y = vandNiveau + R + 30 + rng() * (h - vandNiveau - 2 * R - 60);

    // Helt inde i massen: centrum og en ring rundt om skal være fast, og der
    // skal være jord et godt stykke over, så tingen aldrig rammer græsset.
    // Kun i jord: en kampesten midt i en mur ville se malet på ud.
    const jord = (px, py) => { const m = t.hent(px, py); return m !== LUFT && m !== MUR; };
    let ok = jord(x, y) && jord(x, y + R + 38);
    for (let k = 0; ok && k < 12; k++) {
      const v = (k / 12) * Math.PI * 2;
      ok = jord(x + Math.cos(v) * (R + 10), y + Math.sin(v) * (R + 10));
    }
    if (!ok) continue;

    const cx = x, cy = h - 1 - y;          // canvas-koordinater (y nedad)
    const rot = (rng() - 0.5) * 1.2;
    tegnBegravet(g, type, cx, cy, R, rot, rng);
    lagt++;
  }
}

function tegnBegravet(g, type, x, y, R, rot, rng) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.lineJoin = 'round'; g.lineCap = 'round';

  // Hulrum: en tynd mørk rand rundt om, så tingen ser indlejret ud frem for
  // pålagt. Ikke om kablet — omkring en tynd ting ligner randen et hul.
  if (type !== 'kabel') {
    g.fillStyle = 'rgba(38,26,16,.32)';
    g.beginPath(); g.ellipse(1.5, 2.5, R * 1.02, R * 0.78, 0, 0, Math.PI * 2); g.fill();
  }

  switch (type) {
    case 'kampesten':
      tegnSten(g, 0, 0, R, R * 0.74, 0, ['#A09483', '#948A7A', '#ADA290'][Math.floor(rng() * 3)]);
      // revner
      g.strokeStyle = 'rgba(53,39,26,.7)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-R * 0.2, -R * 0.5); g.lineTo(R * 0.05, -R * 0.05); g.lineTo(-R * 0.1, R * 0.35); g.stroke();
      break;

    case 'stamme': {
      const L = R * 1.3, T = R * 0.42;
      const gr = g.createLinearGradient(0, -T, 0, T);
      gr.addColorStop(0, '#8A6644'); gr.addColorStop(0.5, '#6E4E33'); gr.addColorStop(1, '#4A3322');
      g.fillStyle = gr;
      g.beginPath(); g.roundRect(-L, -T, L * 2, T * 2, T); g.fill();
      g.strokeStyle = KANT; g.lineWidth = 2.2; g.stroke();
      g.strokeStyle = 'rgba(40,26,16,.55)'; g.lineWidth = 1.3;
      for (let i = -3; i <= 3; i++) {
        g.beginPath(); g.moveTo(-L + T + i * 6, -T * 0.6 + i * 2);
        g.lineTo(L - T + i * 4, -T * 0.4 + i * 3); g.stroke();
      }
      // endeflade med årringe
      g.fillStyle = '#C9A677';
      g.beginPath(); g.ellipse(L - T * 0.2, 0, T * 0.55, T * 0.95, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = KANT; g.lineWidth = 1.8; g.stroke();
      g.strokeStyle = 'rgba(120,84,50,.8)'; g.lineWidth = 1;
      for (const s of [0.65, 0.4, 0.18]) {
        g.beginPath(); g.ellipse(L - T * 0.2, 0, T * 0.55 * s, T * 0.95 * s, 0, 0, Math.PI * 2); g.stroke();
      }
      break;
    }

    case 'diskette': {
      const d = R * 1.6;
      g.fillStyle = '#2E3438';
      g.beginPath(); g.roundRect(-d / 2, -d / 2, d, d, 2); g.fill();
      g.fillStyle = '#9BA3AA';
      g.fillRect(-d * 0.28, -d / 2, d * 0.5, d * 0.34);
      g.fillStyle = '#2E3438';
      g.fillRect(-d * 0.06, -d * 0.44, d * 0.1, d * 0.22);
      g.fillStyle = '#E9ECEF';
      g.fillRect(-d * 0.36, d * 0.02, d * 0.72, d * 0.42);
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect(-d / 2, -d / 2, d, d * 0.12);
      break;
    }
    case 'kabel': {
      g.lineCap = 'round';
      g.strokeStyle = '#2E3438'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(-R, -R * 0.3);
      g.bezierCurveTo(-R * 0.3, R * 0.6, R * 0.2, -R * 0.8, R, R * 0.2); g.stroke();
      g.strokeStyle = '#5C6670'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-R, -R * 0.3);
      g.bezierCurveTo(-R * 0.3, R * 0.6, R * 0.2, -R * 0.8, R, R * 0.2); g.stroke();
      g.fillStyle = '#C9CED3';
      g.beginPath(); g.roundRect(R - 2, R * 0.2 - 4, 9, 8, 1.5); g.fill();
      break;
    }
    case 'cd': {
      const gr = g.createLinearGradient(-R, -R, R, R);
      gr.addColorStop(0, '#E8F4F8'); gr.addColorStop(0.35, '#C9B8E8');
      gr.addColorStop(0.6, '#B8E8D0'); gr.addColorStop(1, '#D8DDE2');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(46,52,56,.9)';
      g.beginPath(); g.arc(0, 0, R * 0.22, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.beginPath(); g.ellipse(-R * 0.35, -R * 0.4, R * 0.25, R * 0.12, -0.6, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'mobil': {
      g.fillStyle = '#3A424A';
      g.beginPath(); g.roundRect(-R * 0.55, -R, R * 1.1, R * 2, R * 0.3); g.fill();
      g.fillStyle = '#9FC0A0';
      g.fillRect(-R * 0.38, -R * 0.78, R * 0.76, R * 0.6);
      g.fillStyle = '#6E7880';
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
        g.beginPath(); g.arc(-R * 0.26 + k * R * 0.26, R * 0.1 + r * R * 0.26, R * 0.08, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'kiste': {
      const B = R * 1.2, H = R * 0.8;
      g.fillStyle = '#7A4E2C'; g.strokeStyle = KANT; g.lineWidth = 2.2;
      g.beginPath(); g.roundRect(-B, -H * 0.4, B * 2, H * 1.2, 3); g.fill(); g.stroke();
      g.fillStyle = '#8E5E36';
      g.beginPath(); g.moveTo(-B, -H * 0.4); g.quadraticCurveTo(0, -H * 1.3, B, -H * 0.4); g.closePath();
      g.fill(); g.stroke();
      g.fillStyle = '#D9B04A';
      g.fillRect(-B, -H * 0.1, B * 2, H * 0.18);
      g.beginPath(); g.roundRect(-4, -H * 0.3, 8, 10, 2); g.fill(); g.stroke();
      break;
    }

    case 'flaske':
      g.fillStyle = 'rgba(96,150,120,.85)'; g.strokeStyle = KANT; g.lineWidth = 1.8;
      g.beginPath(); g.roundRect(-R * 0.4, -R, R * 0.8, R * 1.6, R * 0.3); g.fill(); g.stroke();
      g.beginPath(); g.roundRect(-R * 0.18, -R * 1.45, R * 0.36, R * 0.5, 2); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.fillRect(-R * 0.25, -R * 0.8, R * 0.12, R * 1.1);
      break;

    default: break;
  }
  g.restore();
}

/* ------------------------------------------------------ overfladepynt */

/**
 * Atlas med småplanter og sten, der står OVEN PÅ terrænet: græstotter,
 * blomster, svampe, bregner, buske, siv, kogler og en bæverpindebunke.
 * Hver celle er 128 x 128 med foden midt forneden.
 */
export const PYNT_CELLE = 128;
export const PYNT_KOL = 8;
export const PYNT_TYPER = [
  { navn: 'tot1', w: 30, h: 24, svaj: 1 },
  { navn: 'tot2', w: 34, h: 28, svaj: 1 },
  { navn: 'tot3', w: 26, h: 20, svaj: 1 },
  { navn: 'tot4', w: 38, h: 30, svaj: 1 },
  { navn: 'blomst_gul', w: 22, h: 34, svaj: 1 },
  { navn: 'blomst_hvid', w: 22, h: 30, svaj: 1 },
  { navn: 'svamp', w: 24, h: 24, svaj: 0 },
  { navn: 'svampe', w: 30, h: 22, svaj: 0 },
  { navn: 'sten1', w: 26, h: 18, svaj: 0 },
  { navn: 'sten2', w: 34, h: 22, svaj: 0 },
  { navn: 'busk', w: 56, h: 42, svaj: 0.35 },
  { navn: 'siv', w: 30, h: 56, svaj: 1 },
  { navn: 'kogle', w: 18, h: 16, svaj: 0 },
  { navn: 'pinde', w: 50, h: 26, svaj: 0 },
  { navn: 'bregne', w: 40, h: 34, svaj: 0.8 },
  { navn: 'kloever', w: 30, h: 20, svaj: 0.6 },
];

export function lavPyntAtlas() {
  const C = PYNT_CELLE;
  const rk = Math.ceil(PYNT_TYPER.length / PYNT_KOL);
  const c = canvas(C * PYNT_KOL, C * rk);
  const g = c.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  const rng = lavRng(0xf10e);

  PYNT_TYPER.forEach((t, i) => {
    g.save();
    g.translate((i % PYNT_KOL) * C + C / 2, Math.floor(i / PYNT_KOL) * C + C - 4);
    // Tegn i en fast "tegneskala": 1 wu = 3 px, så den skaleres pænt ned.
    g.scale(3, 3);
    tegnPynt(g, t.navn, rng);
    g.restore();
  });
  return c;
}

function blad(g, x0, y0, x1, y1, bredde, farve, kant = '#1F3A18') {
  // Et spidst blad/strå fra (x0,y0) til (x1,y1) med bredde ved roden.
  const nx = -(y1 - y0), ny = x1 - x0;
  const l = Math.hypot(nx, ny) || 1;
  const ox = (nx / l) * bredde, oy = (ny / l) * bredde;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  g.beginPath();
  g.moveTo(x0 - ox, y0 - oy);
  g.quadraticCurveTo(mx - ox * 0.6, my - oy * 0.6, x1, y1);
  g.quadraticCurveTo(mx + ox * 0.6, my + oy * 0.6, x0 + ox, y0 + oy);
  g.closePath();
  g.fillStyle = farve; g.fill();
  g.strokeStyle = kant; g.lineWidth = 0.7; g.stroke();
}

function tegnPynt(g, navn, rng) {
  const GR = ['#9CC062', '#86B350', '#6FA043', '#5A8C38'];
  switch (navn) {
    case 'tot1': case 'tot2': case 'tot3': case 'tot4': {
      const n = navn === 'tot4' ? 11 : navn === 'tot2' ? 9 : navn === 'tot3' ? 6 : 8;
      const hoej = navn === 'tot4' ? 30 : navn === 'tot2' ? 27 : navn === 'tot3' ? 19 : 23;
      // Bagerste strå mørkest, forreste lysest: dybde inde i totten.
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const v = (t - 0.5) * 2.2 + (rng() - 0.5) * 0.3;
        const l = hoej * (0.6 + rng() * 0.4) * (1 - Math.abs(t - 0.5) * 0.5);
        const x1 = Math.sin(v) * l * 0.75, y1 = -Math.cos(v * 0.8) * l;
        const lag = i % 3;
        blad(g, (t - 0.5) * 8, 0, x1, y1, 1.6, GR[3 - lag]);
      }
      // Lyse spidser
      g.strokeStyle = 'rgba(210,235,160,.6)'; g.lineWidth = 0.6;
      break;
    }

    case 'blomst_gul': case 'blomst_hvid': {
      const krone = navn === 'blomst_gul' ? '#F2C94C' : '#EEF4F4';
      const midte = navn === 'blomst_gul' ? '#B5651D' : '#F2C94C';
      g.strokeStyle = '#3F6C2B'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(2, -14, -1, -26); g.stroke();
      blad(g, 0, -6, -8, -12, 1.8, '#6FA043');
      blad(g, 0, -10, 7, -16, 1.6, '#86B350');
      for (let i = 0; i < 6; i++) {
        const v = (i / 6) * Math.PI * 2;
        g.fillStyle = krone; g.strokeStyle = '#6B4E1F'; g.lineWidth = 0.6;
        g.beginPath(); g.ellipse(-1 + Math.cos(v) * 3.6, -26 + Math.sin(v) * 3.6, 3, 2, v, 0, Math.PI * 2);
        g.fill(); g.stroke();
      }
      g.fillStyle = midte;
      g.beginPath(); g.arc(-1, -26, 2.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = KANT; g.lineWidth = 0.6; g.stroke();
      break;
    }

    case 'svamp': {
      g.fillStyle = '#EDE3CF'; g.strokeStyle = KANT; g.lineWidth = 0.9;
      g.beginPath(); g.roundRect(-2.6, -12, 5.2, 12, 2); g.fill(); g.stroke();
      const gr = g.createLinearGradient(-9, -20, 9, -10);
      gr.addColorStop(0, '#D0643A'); gr.addColorStop(1, '#8E3A20');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(-10, -11); g.quadraticCurveTo(-9, -22, 0, -22);
      g.quadraticCurveTo(9, -22, 10, -11); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#F4EFE4';
      for (const [px, py, r] of [[-4, -17, 1.6], [3, -18, 1.3], [5, -13, 1.1], [-6, -13, 1]]) {
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      }
      break;
    }

    case 'svampe':
      for (const [ox, s] of [[-7, 0.8], [2, 1], [9, 0.6]]) {
        g.save(); g.translate(ox, 0); g.scale(s, s);
        g.fillStyle = '#E4D6BC'; g.strokeStyle = KANT; g.lineWidth = 0.9 / s;
        g.beginPath(); g.roundRect(-2, -10, 4, 10, 1.5); g.fill(); g.stroke();
        g.fillStyle = '#9A7148';
        g.beginPath(); g.ellipse(0, -10, 7, 4, 0, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,240,210,.35)';
        g.beginPath(); g.ellipse(-2.5, -12, 2, 1, -0.3, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      break;

    case 'sten1':
      tegnSten(g, 0, -5, 11, 6.5, 0.1, '#A89C88', KANT);
      break;
    case 'sten2':
      tegnSten(g, 5, -5, 11, 6.5, -0.1, '#9A8F7E', KANT);
      tegnSten(g, -7, -4, 8, 5, 0.2, '#B8AE9A', KANT);
      break;

    case 'busk': {
      const klumper = [[-14, -12, 11], [0, -20, 14], [14, -12, 11], [-6, -8, 10], [8, -8, 10]];
      g.fillStyle = '#2E4F22';
      for (const [x, y, r] of klumper) { g.beginPath(); g.arc(x + 1.2, y + 1.5, r, 0, Math.PI * 2); g.fill(); }
      for (const [x, y, r] of klumper) {
        const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
        gr.addColorStop(0, '#8DB85A'); gr.addColorStop(1, '#4C7A31');
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1F3A18'; g.lineWidth = 0.9; g.stroke();
      }
      g.fillStyle = '#B5332B';
      for (const [x, y] of [[-10, -15], [5, -23], [12, -10], [-2, -9]]) {
        g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fill();
      }
      break;
    }

    case 'siv':
      for (let i = 0; i < 6; i++) {
        const x = (i - 2.5) * 3.2;
        blad(g, x, 0, x + (i - 2.5) * 2.4, -30 - rng() * 14, 1.2, i % 2 ? '#6FA043' : '#5A8C38');
      }
      for (const [x, hh] of [[-3, -42], [4, -48]]) {
        g.strokeStyle = '#4C6B32'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh - 4); g.stroke();
        g.fillStyle = '#6B4424'; g.strokeStyle = KANT; g.lineWidth = 0.8;
        g.beginPath(); g.roundRect(x - 2.2, hh - 4, 4.4, 12, 2.2); g.fill(); g.stroke();
      }
      break;

    case 'kogle': {
      g.fillStyle = '#7A5230'; g.strokeStyle = KANT; g.lineWidth = 0.9;
      g.beginPath(); g.ellipse(0, -7, 6, 7.5, 0.3, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(40,24,12,.8)'; g.lineWidth = 0.6;
      for (let r = -2; r <= 2; r++) {
        g.beginPath(); g.moveTo(-5, -7 + r * 2.4); g.lineTo(5, -8 + r * 2.4); g.stroke();
      }
      break;
    }

    case 'pinde':
      // Bæverens egen byggeplads: en lille bunke afgnavede pinde.
      for (let i = 0; i < 7; i++) {
        const y = -3 - (i % 3) * 4, v = (rng() - 0.5) * 0.5;
        g.save(); g.translate((rng() - 0.5) * 10, y); g.rotate(v);
        g.fillStyle = i % 2 ? '#8A6644' : '#6E4E33'; g.strokeStyle = KANT; g.lineWidth = 0.8;
        g.beginPath(); g.roundRect(-18, -2, 36, 4, 2); g.fill(); g.stroke();
        g.fillStyle = '#D6B888';
        g.beginPath(); g.ellipse(18, 0, 1.4, 2, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      break;

    case 'bregne':
      for (const [v, l] of [[-0.9, 26], [-0.35, 32], [0.3, 30], [0.85, 24]]) {
        const x1 = Math.sin(v) * l, y1 = -Math.cos(v) * l;
        g.strokeStyle = '#3F6C2B'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(x1 * 0.4, y1 * 0.7, x1, y1); g.stroke();
        for (let k = 1; k < 7; k++) {
          const t = k / 7;
          const px = x1 * t * (1 - 0.15 * t), py = y1 * t;
          const s = 5 * (1 - t * 0.7);
          blad(g, px, py, px - s * Math.cos(v) - 2, py - s * Math.sin(v) + 1, 1.1, '#6FA043');
          blad(g, px, py, px + s * Math.cos(v) + 2, py + s * Math.sin(v) - 1, 1.1, '#86B350');
        }
      }
      break;

    case 'kloever':
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 5, y = -6 - (i % 2) * 5;
        g.strokeStyle = '#3F6C2B'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, y); g.stroke();
        for (let k = 0; k < 3; k++) {
          const v = (k / 3) * Math.PI * 2 - Math.PI / 2;
          g.fillStyle = k === 0 ? '#86B350' : '#6FA043'; g.strokeStyle = '#1F3A18'; g.lineWidth = 0.6;
          g.beginPath(); g.arc(x + Math.cos(v) * 2.4, y + Math.sin(v) * 2.4, 2.4, 0, Math.PI * 2);
          g.fill(); g.stroke();
        }
      }
      break;

    default: break;
  }
}

/* ------------------------------------------------------------ genstande */

/*
 * Projektiler, placerede våben, kasser og gravsten i ét atlas. Hver celle er
 * GEN_CELLE px med tingen centreret; visningen skalerer efter en fast
 * størrelse i wu per slags (se GEN_STR i fx.js).
 */
export const GEN_CELLE = 128;
export const GEN_KOL = 8;
export const GEN_NAVNE = ['gren', 'agern', 'kogle', 'frø', 'dynamit', 'mine', 'mine_lys', 'stamme',
  'toende', 'sten', 'kasse_vaaben', 'kasse_helbred', 'kasse_hjaelp', 'faldskaerm', 'gravsten', 'gnist',
  'roer', 'boesse'];

export function lavGenstandAtlas() {
  const C = GEN_CELLE;
  const c = canvas(C * GEN_KOL, C * Math.ceil(GEN_NAVNE.length / GEN_KOL));
  const g = c.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  GEN_NAVNE.forEach((navn, i) => {
    g.save();
    g.translate((i % GEN_KOL) * C + C / 2, Math.floor(i / GEN_KOL) * C + C / 2);
    g.scale(C / 96, C / 96);
    tegnGenstand(g, navn);
    g.restore();
  });
  return c;
}

function celle(g, sti, farve, skygge, lw = 3) {
  sti(); g.fillStyle = skygge; g.fill();
  g.save(); sti(); g.clip(); g.translate(-3, -4); sti(); g.fillStyle = farve; g.fill(); g.restore();
  sti(); g.strokeStyle = KANT; g.lineWidth = lw; g.stroke();
}

function tegnGenstand(g, navn) {
  const E = (x, y, rx, ry, rot = 0) => () => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); };
  const R = (x, y, w, h, r) => () => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  switch (navn) {
    case 'gren': {
      // Grenraket, peger mod højre: stamme, spids af lyst træ, blade som finner.
      for (const [dy, rot] of [[-9, -0.5], [9, 0.5]]) {
        celle(g, E(-30, dy, 12, 5, rot), '#7FB04E', '#4F7A30', 2.4);
      }
      celle(g, R(-30, -8, 50, 16, 7), '#8A6644', '#5E432B');
      g.strokeStyle = 'rgba(40,26,16,.6)'; g.lineWidth = 1.6;
      for (const x of [-20, -8, 4]) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x + 5, 6); g.stroke(); }
      celle(g, () => { g.beginPath(); g.moveTo(18, -8); g.quadraticCurveTo(38, -4, 40, 0);
        g.quadraticCurveTo(38, 4, 18, 8); g.closePath(); }, '#E3C48E', '#B89560');
      break;
    }
    case 'agern':
      celle(g, E(0, 7, 17, 21), '#B7773E', '#8A5428');
      celle(g, () => { g.beginPath(); g.ellipse(0, -9, 21, 12, 0, Math.PI * 0.95, Math.PI * 2.05); g.closePath(); },
            '#6E5238', '#4E3A28');
      g.strokeStyle = 'rgba(30,20,10,.55)'; g.lineWidth = 1.4;
      for (let x = -15; x <= 15; x += 6) { g.beginPath(); g.moveTo(x, -18); g.lineTo(x + 4, -6); g.stroke(); }
      celle(g, R(-2.5, -28, 5, 9, 2), '#5E432B', '#3F2B1C', 2.2);
      glansP(g, -7, 6, 4, 8);
      break;
    case 'kogle': {
      celle(g, E(0, 0, 17, 24), '#8A5C32', '#5E3E22');
      g.fillStyle = '#A8743F'; g.strokeStyle = KANT; g.lineWidth = 1.6;
      for (let r = -3; r <= 3; r++) {
        for (let k = -1; k <= 1; k++) {
          const x = k * 9 + (r % 2 ? 4.5 : 0), y = r * 6.5;
          if (Math.hypot(x / 16, y / 23) > 0.95) continue;
          g.beginPath(); g.moveTo(x - 5, y - 2); g.quadraticCurveTo(x, y + 6, x + 5, y - 2); g.closePath(); g.fill(); g.stroke();
        }
      }
      celle(g, R(-2.5, -30, 5, 8, 2), '#5E432B', '#3F2B1C', 2.2);
      // Lille lunte-gnist i toppen: det er en bombe.
      break;
    }
    case 'frø':
      celle(g, E(0, 0, 11, 16, 0.3), '#D9C08A', '#A88E5A');
      g.strokeStyle = 'rgba(60,40,20,.6)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-2, -12); g.lineTo(3, 12); g.stroke();
      glansP(g, -4, -4, 2.5, 5);
      break;
    case 'dynamit': {
      // Kenney-stil: flade felter, ingen kontur — en mørkere sideskygge og
      // et blankt højlys gør formen, ligesom i tank-pakken.
      for (const x of [-14, 0, 14]) {
        g.fillStyle = '#D9453A';
        g.beginPath(); g.roundRect(x - 7, -22, 14, 44, 6); g.fill();
        g.fillStyle = '#B93529';
        g.beginPath(); g.roundRect(x + 1, -22, 6, 44, [0, 6, 6, 0]); g.fill();
        g.fillStyle = 'rgba(255,255,255,.35)';
        g.beginPath(); g.roundRect(x - 5, -18, 3, 22, 2); g.fill();
      }
      g.fillStyle = '#E8D5AC';
      g.beginPath(); g.roundRect(-23, -8, 46, 10, 4); g.fill();
      g.fillStyle = '#CDB88C';
      g.beginPath(); g.roundRect(-23, -3, 46, 5, [0, 0, 4, 4]); g.fill();
      g.strokeStyle = '#8E9196'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, -22); g.quadraticCurveTo(7, -32, 15, -34); g.stroke();
      g.fillStyle = '#FFD86F';
      g.beginPath(); g.arc(16, -34, 3.4, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'mine': case 'mine_lys':
      celle(g, R(-26, 6, 52, 10, 4), '#4A4F52', '#2E3234');
      celle(g, () => { g.beginPath(); g.ellipse(0, 7, 22, 20, 0, Math.PI, 0); g.closePath(); }, '#5D6468', '#383D40');
      g.fillStyle = '#2E3234';
      for (const x of [-14, 0, 14]) { g.beginPath(); g.arc(x, -2, 2.4, 0, Math.PI * 2); g.fill(); }
      if (navn === 'mine_lys') {
        const gr = g.createRadialGradient(0, -14, 1, 0, -14, 16);
        gr.addColorStop(0, 'rgba(255,90,60,.95)'); gr.addColorStop(1, 'rgba(255,60,30,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(0, -14, 16, 0, Math.PI * 2); g.fill();
      }
      celle(g, E(0, -14, 5, 5), navn === 'mine_lys' ? '#FF6A4A' : '#8E2E1E', '#6E1E12', 2.2);
      break;
    case 'stamme': {
      celle(g, R(-42, -13, 80, 26, 12), '#8A6644', '#5E432B');
      g.strokeStyle = 'rgba(40,26,16,.55)'; g.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-34 + i * 14, -8); g.lineTo(-24 + i * 14, 8); g.stroke(); }
      celle(g, E(38, 0, 8, 13), '#D9B888', '#B8945E', 2.4);
      g.strokeStyle = 'rgba(120,84,50,.9)'; g.lineWidth = 1.2;
      for (const k of [0.6, 0.3]) { g.beginPath(); g.ellipse(38, 0, 8 * k, 13 * k, 0, 0, Math.PI * 2); g.stroke(); }
      break;
    }
    case 'toende':
      celle(g, R(-20, -28, 40, 56, 6), '#A34526', '#7A3520');
      g.save(); R(-20, -28, 40, 56, 6)(); g.clip();
      g.fillStyle = '#FFD86F';
      for (let i = -3; i < 4; i++) { g.beginPath(); g.moveTo(-24 + i * 14, 10); g.lineTo(-16 + i * 14, 10);
        g.lineTo(-4 + i * 14, -6); g.lineTo(-12 + i * 14, -6); g.closePath(); g.fill(); }
      g.restore();
      g.strokeStyle = KANT; g.lineWidth = 2.6;
      for (const y of [-6, 10]) { g.beginPath(); g.moveTo(-20, y); g.lineTo(20, y); g.stroke(); }
      R(-20, -28, 40, 56, 6)(); g.stroke();
      celle(g, R(-22, -31, 44, 7, 3), '#7A3520', '#5A2515', 2.4);
      glansP(g, -12, -16, 3, 7);
      break;
    case 'sten': {
      g.fillStyle = '#A8ABB0';
      g.beginPath(); g.ellipse(0, 0, 20, 15, 0.15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8C9095';
      g.beginPath(); g.ellipse(4, 4, 16, 11, 0.15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#BEC1C6';
      g.beginPath(); g.ellipse(-5, -5, 10, 6.5, 0.2, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'kasse_vaaben': case 'kasse_helbred': case 'kasse_hjaelp': {
      const farve = navn === 'kasse_vaaben' ? '#B98A52' : navn === 'kasse_helbred' ? '#EEF3F4' : '#F2C94C';
      const skygge = navn === 'kasse_vaaben' ? '#8A6238' : navn === 'kasse_helbred' ? '#BFCBD0' : '#C99A28';
      celle(g, R(-28, -28, 56, 56, 5), farve, skygge);
      g.strokeStyle = 'rgba(40,26,16,.55)'; g.lineWidth = 2.4;
      if (navn === 'kasse_vaaben') {
        for (const y of [-10, 8]) { g.beginPath(); g.moveTo(-26, y); g.lineTo(26, y); g.stroke(); }
        g.strokeStyle = KANT; g.lineWidth = 3;
        g.beginPath(); g.moveTo(-24, -24); g.lineTo(24, 24); g.moveTo(24, -24); g.lineTo(-24, 24); g.stroke();
        g.strokeStyle = '#8A6238'; g.lineWidth = 5.5;
        g.beginPath(); g.moveTo(-22, -22); g.lineTo(22, 22); g.moveTo(22, -22); g.lineTo(-22, 22); g.stroke();
      } else if (navn === 'kasse_helbred') {
        celle(g, () => { g.beginPath(); g.moveTo(-6, -18); g.lineTo(6, -18); g.lineTo(6, -6); g.lineTo(18, -6); g.lineTo(18, 6);
          g.lineTo(6, 6); g.lineTo(6, 18); g.lineTo(-6, 18); g.lineTo(-6, 6); g.lineTo(-18, 6); g.lineTo(-18, -6);
          g.lineTo(-6, -6); g.closePath(); }, '#C24E2C', '#8E3520', 2.4);
      } else {
        g.font = '900 38px Poppins, Calibri, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 6; g.strokeStyle = KANT; g.strokeText('?', 0, 2);
        g.fillStyle = '#FFFFFF'; g.fillText('?', 0, 2);
      }
      // Hjørnebeslag
      g.fillStyle = '#5A5A5A';
      for (const [x, y] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
      glansP(g, -16, -18, 6, 3);
      break;
    }
    case 'faldskaerm': {
      const sk = () => { g.beginPath(); g.moveTo(-42, 0); g.bezierCurveTo(-40, -44, 40, -44, 42, 0);
        g.quadraticCurveTo(28, -8, 14, 0); g.quadraticCurveTo(0, -8, -14, 0); g.quadraticCurveTo(-28, -8, -42, 0); g.closePath(); };
      g.fillStyle = '#EFF3F4'; sk(); g.fill();
      g.save(); sk(); g.clip();
      g.fillStyle = '#6FB4CE';
      for (const x of [-28, 0, 28]) {
        g.beginPath(); g.moveTo(x - 7, 2); g.lineTo(x * 0.3 - 3, -42); g.lineTo(x * 0.3 + 3, -42); g.lineTo(x + 7, 2); g.closePath(); g.fill();
      }
      g.fillStyle = 'rgba(30,60,80,.12)';
      g.beginPath(); g.rect(-44, -12, 88, 14); g.fill();
      g.restore();
      g.strokeStyle = '#9BA6AC'; g.lineWidth = 1.6; g.lineCap = 'round';
      for (const x of [-42, -14, 14, 42]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x * 0.25, 46); g.stroke(); }
      break;
    }
    case 'gravsten': {
      // Hvor en kunde døde, står et lille skilt: fejlvinduet "FEJL 40" på en pæl.
      g.fillStyle = '#7DA157';
      for (let i = -4; i <= 4; i++) {
        g.beginPath(); g.ellipse(i * 6, 27, 3.4, 6, (i % 3) * 0.2, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#1E1610'; g.beginPath(); g.roundRect(-4.5, -6, 9, 34, 3); g.fill();
      g.fillStyle = '#8A6A45'; g.beginPath(); g.roundRect(-2.5, -6, 5, 33, 2); g.fill();
      g.save(); g.translate(-42, -50); tegnFejlvindue(g, 84, 50); g.restore();
      break;
    }
    case 'gnist': {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.3, 'rgba(255,216,111,.9)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
      break;
    }
    default: break;
  }
}

function glansP(g, x, y, rx, ry) {
  g.save(); g.globalAlpha = 0.45; g.fillStyle = '#FFFFFF';
  g.beginPath(); g.ellipse(x, y, rx, ry, -0.3, 0, Math.PI * 2); g.fill(); g.restore();
}


/** Tonerkanonen i flad Kenney-stil: rør, TONER-mærkat, mundingsring og greb.
 *  Tegnes 256 x 64; roden (bæreenden) er til venstre. */
export function lavBazooka() {
  const c = canvas(256, 64);
  const g = c.getContext('2d');
  // rør
  g.fillStyle = '#5C6670';
  g.beginPath(); g.roundRect(8, 18, 232, 28, 14); g.fill();
  // mørk underside
  g.fillStyle = '#48515A';
  g.beginPath(); g.roundRect(8, 32, 232, 14, [0, 0, 14, 14]); g.fill();
  // lys overside
  g.fillStyle = '#79848F';
  g.beginPath(); g.roundRect(14, 20, 218, 8, 4); g.fill();
  // bagende (udstødning)
  g.fillStyle = '#3A424A';
  g.beginPath(); g.roundRect(2, 14, 18, 36, 6); g.fill();
  // mundingsring
  g.fillStyle = '#F28C28';
  g.beginPath(); g.roundRect(228, 12, 20, 40, 8); g.fill();
  g.fillStyle = '#D9771C';
  g.beginPath(); g.roundRect(238, 12, 10, 40, [0, 8, 8, 0]); g.fill();
  g.fillStyle = '#2E353B';
  g.beginPath(); g.ellipse(247, 32, 5, 14, 0, 0, Math.PI * 2); g.fill();
  // TONER-mærkat på røret
  g.fillStyle = '#F28C28';
  g.beginPath(); g.roundRect(150, 22, 56, 20, 4); g.fill();
  g.fillStyle = '#2A3036'; g.font = '900 13px Poppins, Calibri, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TONER', 178, 33);
  // greb og sigtekorn
  g.fillStyle = '#3A424A';
  g.beginPath(); g.roundRect(96, 42, 12, 18, 4); g.fill();
  g.beginPath(); g.roundRect(140, 6, 8, 14, 3); g.fill();
  g.fillStyle = '#FFD86F';
  g.beginPath(); g.arc(144, 7, 4, 0, Math.PI * 2); g.fill();
  return c;
}


/* ------------------------------------------------------ håndvåben (flade) */

/*
 * Det figuren holder, pr. våben — i tank-pakkens flade formsprog: flade
 * farvefelter, en mørkere underside, et lyst højlys, ingen konturer.
 * Hvert lærred er 256 x 128. Våben, der sigtes med, peger mod højre med
 * grebet i venstre side; ting, der holdes i hånden, er centreret.
 * Kasteting (granat, kogle) tegnes også som projektil, så det man holder,
 * er det man kaster.
 */
const HV_B = 256, HV_H = 128;

function hvFelt(g, farve, sti) { g.fillStyle = farve; sti(); g.fill(); }

/* Faste punkter i tegningerne (lærredets pixels), som visningen skal kende:
 * bombens midte og radius (den drejer om kuglen, ikke om lunten) og luntens
 * glødende ende, hvor gnisten sidder. */
export const TEGNE_PUNKTER = {
  bombe: { midt: [118, 73], r: 42, lunte: [176, 19] },
};

export const HAANDVAABEN = {
  granat(g) {
    const cx = 128, cy = 72;
    hvFelt(g, '#5E7A3A', () => { g.beginPath(); g.ellipse(cx, cy, 38, 44, 0, 0, Math.PI * 2); });
    hvFelt(g, '#4C6530', () => { g.beginPath(); g.ellipse(cx + 12, cy + 8, 26, 34, 0, 0, Math.PI * 2); });
    g.fillStyle = 'rgba(0,0,0,.14)';
    for (const y of [-18, 0, 18]) { g.fillRect(cx - 38, cy + y - 2, 76, 4); }
    hvFelt(g, '#8FAE5C', () => { g.beginPath(); g.ellipse(cx - 14, cy - 18, 12, 9, -0.5, 0, Math.PI * 2); });
    hvFelt(g, '#8E9196', () => { g.beginPath(); g.roundRect(cx - 14, cy - 58, 28, 18, 4); });
    hvFelt(g, '#6E7176', () => { g.beginPath(); g.roundRect(cx + 10, cy - 60, 30, 8, 4); });
    g.strokeStyle = '#C9CCD0'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx - 20, cy - 52, 9, 0, Math.PI * 2); g.stroke();
  },
  kogle(g) {
    const cx = 128, cy = 70;
    hvFelt(g, '#8A5A30', () => { g.beginPath(); g.ellipse(cx, cy, 32, 46, 0, 0, Math.PI * 2); });
    hvFelt(g, '#744A26', () => { g.beginPath(); g.ellipse(cx + 10, cy + 6, 22, 38, 0, 0, Math.PI * 2); });
    g.fillStyle = '#A8723E';
    for (let r = -3; r <= 3; r++) {
      for (let k = -1; k <= 1; k++) {
        const x = cx + k * 16 + (r % 2 ? 8 : 0), y = cy + r * 12;
        if (Math.hypot((x - cx) / 30, (y - cy) / 43) > 0.9) continue;
        g.beginPath(); g.moveTo(x - 9, y - 2); g.quadraticCurveTo(x, y + 10, x + 9, y - 2); g.closePath(); g.fill();
      }
    }
    hvFelt(g, '#5E432B', () => { g.beginPath(); g.roundRect(cx - 5, cy - 60, 10, 16, 4); });
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.arc(cx + 2, cy - 62, 5, 0, Math.PI * 2); });
  },
  boesse(g) {                               // splintbøsse: to løb, træskæfte
    hvFelt(g, '#8A5F3A', () => { g.beginPath(); g.moveTo(8, 58); g.lineTo(84, 50); g.lineTo(96, 76);
      g.lineTo(20, 96); g.closePath(); });
    hvFelt(g, '#6E4A2C', () => { g.beginPath(); g.moveTo(20, 96); g.lineTo(96, 76); g.lineTo(92, 70);
      g.lineTo(16, 88); g.closePath(); });
    for (const y of [46, 60]) {
      hvFelt(g, '#6B737B', () => { g.beginPath(); g.roundRect(84, y, 164, 12, 6); });
      hvFelt(g, '#8B939A', () => { g.beginPath(); g.roundRect(90, y + 1, 150, 4, 2); });
    }
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(78, 42, 24, 36, 5); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(108, 74, 30, 12, 5); });
  },
  dynamit(g) {
    const cx = 128, cy = 66;
    for (const x of [-26, 0, 26]) {
      hvFelt(g, '#D9453A', () => { g.beginPath(); g.roundRect(cx + x - 13, cy - 40, 26, 84, 10); });
      hvFelt(g, '#B93529', () => { g.beginPath(); g.roundRect(cx + x + 1, cy - 40, 12, 84, [0, 10, 10, 0]); });
      hvFelt(g, 'rgba(255,255,255,.35)', () => { g.beginPath(); g.roundRect(cx + x - 9, cy - 32, 5, 40, 3); });
    }
    hvFelt(g, '#E8D5AC', () => { g.beginPath(); g.roundRect(cx - 42, cy - 4, 84, 16, 5); });
    g.strokeStyle = '#8E9196'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy - 40); g.quadraticCurveTo(cx + 12, cy - 56, cx + 28, cy - 58); g.stroke();
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.arc(cx + 30, cy - 58, 7, 0, Math.PI * 2); });
  },
  handske(g) {                              // halesmæk: boksehandske
    const cx = 122, cy = 66;
    hvFelt(g, '#D9453A', () => { g.beginPath(); g.ellipse(cx + 10, cy, 52, 42, 0, 0, Math.PI * 2); });
    hvFelt(g, '#B93529', () => { g.beginPath(); g.ellipse(cx + 18, cy + 14, 40, 26, 0, 0, Math.PI * 2); });
    hvFelt(g, '#E8675A', () => { g.beginPath(); g.ellipse(cx - 6, cy - 18, 20, 12, -0.3, 0, Math.PI * 2); });
    hvFelt(g, '#F2F2F2', () => { g.beginPath(); g.roundRect(cx - 62, cy - 26, 26, 52, 8); });
    hvFelt(g, '#D6D6D6', () => { g.beginPath(); g.roundRect(cx - 62, cy + 6, 26, 20, [0, 0, 8, 8]); });
  },
  broender(g) {                             // gnavetand: skærebrænder
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.roundRect(12, 40, 70, 48, 16); });
    hvFelt(g, '#C74634', () => { g.beginPath(); g.roundRect(12, 66, 70, 22, [0, 0, 16, 16]); });
    hvFelt(g, '#6B737B', () => { g.beginPath(); g.roundRect(78, 56, 120, 16, 6); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(192, 50, 30, 28, 6); });
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.moveTo(222, 52); g.quadraticCurveTo(256, 64, 222, 76); g.closePath(); });
    hvFelt(g, '#6FB4CE', () => { g.beginPath(); g.moveTo(222, 58); g.quadraticCurveTo(244, 64, 222, 70); g.closePath(); });
  },
  bor(g) {                                  // nedgravning: trykluftbor, peger ned-frem
    hvFelt(g, '#F2C230', () => { g.beginPath(); g.roundRect(20, 34, 110, 60, 14); });
    hvFelt(g, '#D4A620', () => { g.beginPath(); g.roundRect(20, 70, 110, 24, [0, 0, 14, 14]); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(4, 24, 24, 80, 8); });
    hvFelt(g, '#6B737B', () => { g.beginPath(); g.roundRect(126, 54, 70, 20, 6); });
    hvFelt(g, '#8B939A', () => { g.beginPath(); g.moveTo(196, 50); g.lineTo(250, 64); g.lineTo(196, 78); g.closePath(); });
    // Snoningen på borespidsen, så den ser ud til at dreje.
    g.strokeStyle = '#5C6670'; g.lineWidth = 3; g.lineCap = 'round';
    for (const x of [204, 216, 228]) {
      const h = (250 - x) * 0.26;
      g.beginPath(); g.moveTo(x, 64 - h); g.lineTo(x + 7, 64 + h); g.stroke();
    }
  },
  fjernbetjening(g) {                       // gangtunnel: teleporter
    const cx = 128, cy = 70;
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(cx - 24, cy - 42, 48, 88, 12); });
    hvFelt(g, '#2A3036', () => { g.beginPath(); g.roundRect(cx + 4, cy - 42, 20, 88, [0, 12, 12, 0]); });
    hvFelt(g, '#6FB4CE', () => { g.beginPath(); g.roundRect(cx - 16, cy - 32, 32, 22, 4); });
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.arc(cx - 8, cy + 14, 7, 0, Math.PI * 2); });
    hvFelt(g, '#7DC06A', () => { g.beginPath(); g.arc(cx + 9, cy + 14, 7, 0, Math.PI * 2); });
    hvFelt(g, '#8B939A', () => { g.beginPath(); g.roundRect(cx - 3, cy - 64, 6, 24, 3); });
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.arc(cx, cy - 66, 6, 0, Math.PI * 2); });
  },
  printer(g) {                              // klinikkens printer — den, der altid er i stykker
    const cx = 128, cy = 78;
    hvFelt(g, '#E4E7EA', () => { g.beginPath(); g.roundRect(cx - 52, cy - 22, 104, 50, 10); });
    hvFelt(g, '#C4C9CE', () => { g.beginPath(); g.roundRect(cx - 52, cy + 8, 104, 20, [0, 0, 10, 10]); });
    // Papirbakken ovenpå med et halvt udprintet ark.
    hvFelt(g, '#9AA2A9', () => { g.beginPath(); g.roundRect(cx - 38, cy - 34, 76, 14, 5); });
    hvFelt(g, '#FFFFFF', () => { g.beginPath(); g.moveTo(cx - 26, cy - 34); g.lineTo(cx - 30, cy - 60);
      g.lineTo(cx + 22, cy - 64); g.lineTo(cx + 26, cy - 34); g.closePath(); });
    g.fillStyle = '#B9C1C8';
    for (let i = 0; i < 3; i++) g.fillRect(cx - 20, cy - 56 + i * 7, 34 - i * 6, 2.5);
    // Udskriftsåbning, display og lamper.
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(cx - 40, cy + 12, 80, 7, 3); });
    hvFelt(g, '#6FB4CE', () => { g.beginPath(); g.roundRect(cx + 10, cy - 14, 30, 14, 3); });
    hvFelt(g, '#E8412C', () => { g.beginPath(); g.arc(cx - 34, cy - 6, 5, 0, Math.PI * 2); });
    hvFelt(g, '#7DC06A', () => { g.beginPath(); g.arc(cx - 20, cy - 6, 5, 0, Math.PI * 2); });
  },
  printer_alarm(g) {                        // samme printer, lampen lyser: PAPIRSTOP
    HAANDVAABEN.printer(g);
    hvFelt(g, 'rgba(255,90,60,.55)', () => { g.beginPath(); g.arc(128 - 34, 78 - 6, 11, 0, Math.PI * 2); });
    hvFelt(g, '#FF5A3C', () => { g.beginPath(); g.arc(128 - 34, 78 - 6, 5.5, 0, Math.PI * 2); });
  },
  bordtelefon(g) {                          // telefonen, der ringer: rød bordtelefon med drejeskive
    const cx = 128, cy = 76;
    // Kroppen: et trapez med afrundede hjørner.
    hvFelt(g, '#D8402C', () => { g.beginPath(); g.moveTo(cx - 44, cy + 34); g.lineTo(cx - 30, cy - 14);
      g.lineTo(cx + 30, cy - 14); g.lineTo(cx + 44, cy + 34); g.closePath(); });
    hvFelt(g, '#B23222', () => { g.beginPath(); g.moveTo(cx + 8, cy + 34); g.lineTo(cx + 12, cy - 14);
      g.lineTo(cx + 30, cy - 14); g.lineTo(cx + 44, cy + 34); g.closePath(); });
    // Drejeskiven med huller.
    hvFelt(g, '#F4F1EA', () => { g.beginPath(); g.arc(cx - 2, cy + 12, 17, 0, Math.PI * 2); });
    g.fillStyle = '#B23222';
    for (let i = 0; i < 8; i++) {
      const v = -2.4 + i * 0.62;
      g.beginPath(); g.arc(cx - 2 + Math.cos(v) * 11, cy + 12 + Math.sin(v) * 11, 2.6, 0, Math.PI * 2); g.fill();
    }
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.arc(cx - 2, cy + 12, 4, 0, Math.PI * 2); });
    // Røret på gaflen.
    hvFelt(g, '#8E2418', () => { g.beginPath(); g.roundRect(cx - 50, cy - 30, 100, 16, 8); });
    hvFelt(g, '#8E2418', () => { g.beginPath(); g.roundRect(cx - 54, cy - 36, 24, 26, 9); });
    hvFelt(g, '#8E2418', () => { g.beginPath(); g.roundRect(cx + 30, cy - 36, 24, 26, 9); });
    hvFelt(g, 'rgba(255,255,255,.35)', () => { g.beginPath(); g.roundRect(cx - 44, cy - 27, 60, 4, 2); });
  },
  radio(g) {                                // træstammeregn: walkie-talkie
    const cx = 128, cy = 72;
    hvFelt(g, '#5E7A3A', () => { g.beginPath(); g.roundRect(cx - 28, cy - 40, 56, 84, 12); });
    hvFelt(g, '#4C6530', () => { g.beginPath(); g.roundRect(cx + 4, cy - 40, 24, 84, [0, 12, 12, 0]); });
    g.fillStyle = '#3A4A2A';
    for (const y of [-26, -16, -6]) g.fillRect(cx - 18, cy + y, 36, 5);
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.roundRect(cx - 14, cy + 10, 28, 18, 4); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(cx + 12, cy - 72, 8, 34, 4); });
  },
  mus(g) {                                  // musegranat: trådløs mus med lunte
    const cx = 128, cy = 70;
    hvFelt(g, '#E9ECEF', () => { g.beginPath(); g.ellipse(cx, cy, 34, 46, 0, 0, Math.PI * 2); });
    hvFelt(g, '#C9CED3', () => { g.beginPath(); g.ellipse(cx + 10, cy + 8, 22, 36, 0, 0, Math.PI * 2); });
    hvFelt(g, '#B5BBC1', () => { g.beginPath(); g.roundRect(cx - 2, cy - 44, 4, 30, 2); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(cx - 5, cy - 34, 10, 16, 5); });
    hvFelt(g, 'rgba(255,255,255,.7)', () => { g.beginPath(); g.ellipse(cx - 14, cy - 20, 8, 12, -0.3, 0, Math.PI * 2); });
    g.strokeStyle = '#8E9196'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy - 46); g.quadraticCurveTo(cx + 14, cy - 62, cx + 30, cy - 60); g.stroke();
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.arc(cx + 32, cy - 60, 7, 0, Math.PI * 2); });
  },
  tastatur(g) {                             // tastaturbombe
    const cx = 128, cy = 70;
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(cx - 70, cy - 30, 140, 60, 10); });
    hvFelt(g, '#2A3036', () => { g.beginPath(); g.roundRect(cx - 70, cy + 10, 140, 20, [0, 0, 10, 10]); });
    g.fillStyle = '#C9CED3';
    for (let r = 0; r < 3; r++) for (let k = 0; k < 8; k++) {
      g.beginPath(); g.roundRect(cx - 62 + k * 16 + (r === 1 ? 4 : 0), cy - 24 + r * 14, 12, 10, 2); g.fill();
    }
    hvFelt(g, '#C9CED3', () => { g.beginPath(); g.roundRect(cx - 34, cy + 17, 68, 8, 3); });
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.arc(cx + 58, cy - 38, 8, 0, Math.PI * 2); });
  },
  tast(g) {                                 // én løs tast (tastaturbombens splinter)
    const cx = 128, cy = 64;
    hvFelt(g, '#C9CED3', () => { g.beginPath(); g.roundRect(cx - 30, cy - 30, 60, 60, 10); });
    hvFelt(g, '#E9ECEF', () => { g.beginPath(); g.roundRect(cx - 22, cy - 26, 44, 40, 8); });
    g.fillStyle = '#3A424A'; g.font = '900 30px Poppins, Calibri, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('F5', cx, cy - 5);
  },
  scanner(g) {                              // stregkodescanner (pistolgreb)
    hvFelt(g, '#F2C230', () => { g.beginPath(); g.moveTo(40, 40); g.lineTo(200, 34); g.lineTo(236, 50);
      g.lineTo(236, 76); g.lineTo(40, 76); g.closePath(); });
    hvFelt(g, '#D4A620', () => { g.beginPath(); g.rect(40, 62, 196, 14); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.moveTo(70, 74); g.lineTo(106, 74); g.lineTo(92, 124); g.lineTo(60, 124); g.closePath(); });
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.roundRect(228, 46, 12, 30, 4); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(100, 44, 60, 12, 4); });
  },
  opdatering(g) {                           // tvangsopdatering: bombe med statuslinje
    const cx = 128, cy = 72;
    hvFelt(g, '#2E6DB4', () => { g.beginPath(); g.roundRect(cx - 50, cy - 40, 100, 80, 12); });
    hvFelt(g, '#255A96', () => { g.beginPath(); g.roundRect(cx + 10, cy - 40, 40, 80, [0, 12, 12, 0]); });
    hvFelt(g, '#E9ECEF', () => { g.beginPath(); g.roundRect(cx - 38, cy + 6, 76, 14, 7); });
    hvFelt(g, '#7DC06A', () => { g.beginPath(); g.roundRect(cx - 36, cy + 8, 50, 10, 5); });
    g.strokeStyle = '#E9ECEF'; g.lineWidth = 8; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy - 14, 16, -Math.PI * 0.2, Math.PI * 1.25); g.stroke();
    hvFelt(g, '#E9ECEF', () => { g.beginPath(); g.moveTo(cx + 12, cy - 30); g.lineTo(cx + 22, cy - 18); g.lineTo(cx + 6, cy - 16); g.closePath(); });
    g.strokeStyle = '#8E9196'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx, cy - 40); g.quadraticCurveTo(cx + 12, cy - 56, cx + 28, cy - 58); g.stroke();
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.arc(cx + 30, cy - 58, 7, 0, Math.PI * 2); });
  },
  mail(g) {                                 // phishing-mine: en mistænkelig mail
    const cx = 128, cy = 80;
    hvFelt(g, '#F4F4F2', () => { g.beginPath(); g.roundRect(cx - 50, cy - 32, 100, 64, 6); });
    hvFelt(g, '#D8D8D4', () => { g.beginPath(); g.roundRect(cx - 50, cy + 10, 100, 22, [0, 0, 6, 6]); });
    hvFelt(g, '#C9CED3', () => { g.beginPath(); g.moveTo(cx - 50, cy - 30); g.lineTo(cx, cy + 4); g.lineTo(cx + 50, cy - 30); g.lineTo(cx + 50, cy - 20); g.lineTo(cx, cy + 14); g.lineTo(cx - 50, cy - 20); g.closePath(); });
    hvFelt(g, '#8E9196', () => { g.beginPath(); g.moveTo(cx + 30, cy - 34); g.quadraticCurveTo(cx + 44, cy - 56, cx + 30, cy - 62); g.lineTo(cx + 26, cy - 58); g.quadraticCurveTo(cx + 36, cy - 52, cx + 26, cy - 36); g.closePath(); });
  },
  mail_alarm(g) {                           // samme mail med blinkende rødt udråbstegn
    HAANDVAABEN.mail(g);
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.arc(88, 44, 20, 0, Math.PI * 2); });
    g.fillStyle = '#FFFFFF'; g.font = '900 28px Poppins, Calibri, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 88, 45);
  },
  ringbind(g) {                             // ringbindsslag
    const cx = 128, cy = 66;
    hvFelt(g, '#2E6DB4', () => { g.beginPath(); g.roundRect(cx - 40, cy - 52, 80, 104, 6); });
    hvFelt(g, '#255A96', () => { g.beginPath(); g.roundRect(cx - 40, cy - 52, 18, 104, [6, 0, 0, 6]); });
    hvFelt(g, '#E9ECEF', () => { g.beginPath(); g.roundRect(cx - 10, cy - 30, 40, 26, 3); });
    hvFelt(g, '#C9CED3', () => { g.beginPath(); g.arc(cx - 31, cy + 26, 6, 0, Math.PI * 2); });
    g.fillStyle = '#3A424A'; g.font = '800 11px Poppins, Calibri, sans-serif';
    g.textAlign = 'center'; g.fillText('JOURNAL', cx + 10, cy - 13);
  },
  loddekolbe(g) {                           // loddekolbe
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(12, 46, 96, 36, 16); });
    hvFelt(g, '#2A3036', () => { g.beginPath(); g.roundRect(12, 64, 96, 18, [0, 0, 16, 16]); });
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.roundRect(100, 50, 22, 28, 6); });
    hvFelt(g, '#B5BBC1', () => { g.beginPath(); g.roundRect(120, 58, 96, 12, 5); });
    hvFelt(g, '#8B939A', () => { g.beginPath(); g.moveTo(214, 56); g.lineTo(250, 64); g.lineTo(214, 72); g.closePath(); });
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.arc(250, 64, 5, 0, Math.PI * 2); });
    g.strokeStyle = '#3A424A'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(14, 64); g.quadraticCurveTo(0, 90, 10, 120); g.stroke();
  },
  bombe(g) {                                // Datalæk-bomben: en stor, rund bombe fuld af data
    const [cx, cy] = TEGNE_PUNKTER.bombe.midt, r = TEGNE_PUNKTER.bombe.r;
    const [tx, ty] = TEGNE_PUNKTER.bombe.lunte;
    const kugle = () => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); };
    // Kuglen: mørk rand nederst til højre, lysere krop og et blankt højlys.
    hvFelt(g, '#1B2025', kugle);
    g.save(); kugle(); g.clip();
    hvFelt(g, '#313A42', () => { g.beginPath(); g.arc(cx - 7, cy - 8, r - 3, 0, Math.PI * 2); });
    hvFelt(g, '#3E4852', () => { g.beginPath(); g.arc(cx - 15, cy - 16, r - 16, 0, Math.PI * 2); });
    // Data, der siver ud: grønne nuller og ettaller på overfladen.
    g.fillStyle = 'rgba(125,220,106,.8)'; g.font = '800 11px Menlo, Consolas, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [x, y, s] of [[cx + 14, cy - 27, '1011'], [cx - 13, cy + 28, '0110'], [cx + 22, cy + 22, '01']]) {
      g.fillText(s, x, y);
    }
    // Mærkaten tværs over: gul som en advarsel, med DATA i sort.
    g.save(); g.translate(cx, cy + 3); g.rotate(-0.2);
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.rect(-r - 4, -12, r * 2 + 8, 24); });
    hvFelt(g, '#E0A93A', () => { g.beginPath(); g.rect(-r - 4, 6, r * 2 + 8, 6); });
    g.fillStyle = '#1E1610'; g.font = '900 19px Poppins, Calibri, sans-serif';
    g.fillText('DATA', 0, -1);
    g.restore();
    g.restore();
    hvFelt(g, 'rgba(255,255,255,.55)', () => { g.beginPath(); g.ellipse(cx - 20, cy - 23, 11, 6, -0.7, 0, Math.PI * 2); });
    hvFelt(g, 'rgba(255,255,255,.8)', () => { g.beginPath(); g.arc(cx - 29, cy - 12, 3, 0, Math.PI * 2); });
    // Tændhætten sidder skråt oppe til højre og peger væk fra midten.
    const v = -0.88, hx = cx + Math.cos(v) * (r - 3), hy = cy + Math.sin(v) * (r - 3);
    g.save(); g.translate(hx, hy); g.rotate(v + Math.PI / 2);
    hvFelt(g, '#8E9196', () => { g.beginPath(); g.roundRect(-10, -12, 20, 16, 4); });
    hvFelt(g, '#6E7176', () => { g.beginPath(); g.roundRect(2, -12, 8, 16, [0, 4, 4, 0]); });
    hvFelt(g, '#B5BBC1', () => { g.beginPath(); g.roundRect(-12, -15, 24, 6, 3); });
    g.restore();
    // Lunten: en snoet snor fra hætten ud til den glødende ende.
    const lx = hx + Math.cos(v) * 12, ly = hy + Math.sin(v) * 12;
    const lunte = () => { g.beginPath(); g.moveTo(lx, ly); g.quadraticCurveTo(lx + 4, ty + 2, tx, ty); };
    g.lineCap = 'round';
    g.strokeStyle = '#B98A52'; g.lineWidth = 6; lunte(); g.stroke();
    g.strokeStyle = '#7A5A30'; g.lineWidth = 2; g.setLineDash([3, 4]); lunte(); g.stroke(); g.setLineDash([]);
    hvFelt(g, '#F08A2C', () => { g.beginPath(); g.arc(tx, ty, 5, 0, Math.PI * 2); });
    hvFelt(g, '#FFE9A0', () => { g.beginPath(); g.arc(tx, ty, 2.6, 0, Math.PI * 2); });
  },
  faktura(g) {                              // kvartalsopkrævningen: en forfalden faktura (stående A4)
    const x0 = 92, y0 = 14, w = 72, h = 100, fold = 16;
    const ark = () => { g.beginPath(); g.moveTo(x0 + 3, y0); g.lineTo(x0 + w - fold, y0); g.lineTo(x0 + w, y0 + fold);
      g.lineTo(x0 + w, y0 + h - 3); g.quadraticCurveTo(x0 + w, y0 + h, x0 + w - 3, y0 + h);
      g.lineTo(x0 + 3, y0 + h); g.quadraticCurveTo(x0, y0 + h, x0, y0 + h - 3);
      g.lineTo(x0, y0 + 3); g.quadraticCurveTo(x0, y0, x0 + 3, y0); g.closePath(); };
    hvFelt(g, '#FFFFFF', ark);
    g.save(); ark(); g.clip();
    hvFelt(g, '#E6E9EC', () => { g.beginPath(); g.rect(x0, y0 + h - 12, w, 12); });
    // Blå overskrift med FAKTURA.
    hvFelt(g, '#2E6DB4', () => { g.beginPath(); g.rect(x0, y0, w, 19); });
    g.fillStyle = '#FFFFFF'; g.font = '900 9px Poppins, Calibri, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('FAKTURA', x0 + 5, y0 + 10);
    g.restore();
    hvFelt(g, '#C9D0D6', () => { g.beginPath(); g.moveTo(x0 + w - fold, y0); g.lineTo(x0 + w - fold, y0 + fold);
      g.lineTo(x0 + w, y0 + fold); g.closePath(); });
    // Linjer med poster og beløb.
    g.fillStyle = '#C9CED3';
    for (let i = 0; i < 4; i++) {
      const y = y0 + 27 + i * 8;
      g.fillRect(x0 + 7, y, 30 - (i % 2) * 8, 3);
      g.fillRect(x0 + w - 21, y, 14, 3);
    }
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.rect(x0 + 7, y0 + 64, w - 14, 2); });
    g.fillStyle = '#1E1610'; g.font = '900 10px Poppins, Calibri, sans-serif';
    g.textAlign = 'right'; g.fillText('9.999 kr', x0 + w - 7, y0 + 76);
    // Det røde stempel: FORFALDEN.
    g.save(); g.translate(x0 + w / 2, y0 + 50); g.rotate(-0.32);
    g.globalAlpha = 0.9;
    g.strokeStyle = '#D8402C'; g.lineWidth = 2.5;
    g.beginPath(); g.roundRect(-32, -8, 64, 16, 3); g.stroke();
    g.fillStyle = '#D8402C'; g.font = '900 8px Poppins, Calibri, sans-serif';
    g.textAlign = 'center'; g.fillText('FORFALDEN', 0, 0.5);
    g.restore();
  },
  laptop(g) {                               // hjemmearbejde: den bærbare med et hus på skærmen
    const cx = 128;
    // Skærmen: mørk ramme, lyseblå skærm med et hus og et wifi-signal.
    hvFelt(g, '#2A3036', () => { g.beginPath(); g.roundRect(cx - 54, 14, 108, 72, 8); });
    hvFelt(g, '#6FB4CE', () => { g.beginPath(); g.roundRect(cx - 47, 21, 94, 58, 4); });
    hvFelt(g, '#8FCBE0', () => { g.beginPath(); g.moveTo(cx - 47, 21); g.lineTo(cx + 5, 21); g.lineTo(cx - 25, 79); g.lineTo(cx - 47, 79); g.closePath(); });
    const hx = cx - 4, hy = 58;
    hvFelt(g, '#FFFFFF', () => { g.beginPath(); g.moveTo(hx - 22, hy - 4); g.lineTo(hx, hy - 24); g.lineTo(hx + 22, hy - 4); g.closePath(); });
    hvFelt(g, '#FFFFFF', () => { g.beginPath(); g.rect(hx - 16, hy - 6, 32, 20); });
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.roundRect(hx - 5, hy + 2, 10, 12, [4, 4, 0, 0]); });
    hvFelt(g, '#FFD86F', () => { g.beginPath(); g.rect(hx + 7, hy - 2, 6, 6); });
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 3; g.lineCap = 'round';
    for (const rr of [6, 11]) { g.beginPath(); g.arc(cx + 30, 40, rr, -Math.PI * 0.8, -Math.PI * 0.2); g.stroke(); }
    hvFelt(g, '#FFFFFF', () => { g.beginPath(); g.arc(cx + 30, 40, 2.4, 0, Math.PI * 2); });
    // Hængslet og tastaturdelen i perspektiv.
    hvFelt(g, '#1E2328', () => { g.beginPath(); g.roundRect(cx - 50, 85, 100, 5, 2); });
    hvFelt(g, '#B5BBC1', () => { g.beginPath(); g.moveTo(cx - 58, 90); g.lineTo(cx + 58, 90);
      g.lineTo(cx + 74, 108); g.lineTo(cx - 74, 108); g.closePath(); });
    hvFelt(g, '#8B939A', () => { g.beginPath(); g.roundRect(cx - 74, 106, 148, 7, [0, 0, 4, 4]); });
    g.fillStyle = '#6E767D';
    for (let r = 0; r < 2; r++) {
      const y = 93 + r * 6, ind = 56 + r * 5;
      for (let k = 0; k < 9; k++) g.fillRect(cx - ind + 4 + k * (ind * 2 - 8) / 9, y, (ind * 2 - 8) / 9 - 3, 3.5);
    }
    hvFelt(g, '#9AA2A9', () => { g.beginPath(); g.roundRect(cx - 14, 102, 28, 3, 1.5); });
  },
  virus(g) {                                // COVID: en grøn, pigget og meget sur virus
    const cx = 128, cy = 64, r = 30;
    // Piggene: stilk og knop hele vejen rundt.
    for (let i = 0; i < 12; i++) {
      const v = i / 12 * Math.PI * 2 + 0.13;
      const c = Math.cos(v), s = Math.sin(v);
      g.strokeStyle = '#2E8C4A'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx + c * (r - 4), cy + s * (r - 4)); g.lineTo(cx + c * (r + 10), cy + s * (r + 10)); g.stroke();
      hvFelt(g, '#2E8C4A', () => { g.beginPath(); g.arc(cx + c * (r + 13), cy + s * (r + 13), 7, 0, Math.PI * 2); });
      hvFelt(g, '#A6EB7C', () => { g.beginPath(); g.arc(cx + c * (r + 13) - 1.2, cy + s * (r + 13) - 1.2, 4.6, 0, Math.PI * 2); });
    }
    const krop = () => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); };
    hvFelt(g, '#2E8C4A', krop);
    g.save(); krop(); g.clip();
    hvFelt(g, '#58B947', () => { g.beginPath(); g.arc(cx - 5, cy - 5, r - 2, 0, Math.PI * 2); });
    hvFelt(g, '#7DDC6A', () => { g.beginPath(); g.arc(cx - 11, cy - 12, r - 14, 0, Math.PI * 2); });
    g.fillStyle = 'rgba(30,90,40,.45)';
    for (const [x, y, rr] of [[cx + 16, cy + 12, 5], [cx - 18, cy + 15, 3.5], [cx + 19, cy - 13, 3]]) {
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // Et surt ansigt: vrede bryn, hvide øjne og et skævt grin.
    for (const sx of [-1, 1]) {
      hvFelt(g, '#FFFFFF', () => { g.beginPath(); g.ellipse(cx + sx * 10, cy - 2, 6.5, 7.5, 0, 0, Math.PI * 2); });
      hvFelt(g, '#1E1610', () => { g.beginPath(); g.arc(cx + sx * 10 - sx * 1.5, cy, 3.4, 0, Math.PI * 2); });
      hvFelt(g, '#1E1610', () => { g.beginPath(); g.moveTo(cx + sx * 3, cy - 9); g.lineTo(cx + sx * 18, cy - 15);
        g.lineTo(cx + sx * 18, cy - 11); g.lineTo(cx + sx * 4, cy - 5); g.closePath(); });
    }
    g.strokeStyle = '#1E1610'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 9, cy + 15); g.quadraticCurveTo(cx + 1, cy + 9, cx + 11, cy + 14); g.stroke();
    hvFelt(g, 'rgba(255,255,255,.55)', () => { g.beginPath(); g.ellipse(cx - 15, cy - 19, 7, 4, -0.6, 0, Math.PI * 2); });
  },
  tonerpatron(g) {                          // tonerkanonens projektil
    hvFelt(g, '#2A3036', () => { g.beginPath(); g.roundRect(30, 44, 170, 40, 12); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(30, 44, 170, 16, [12, 12, 0, 0]); });
    hvFelt(g, '#F28C28', () => { g.beginPath(); g.roundRect(150, 44, 26, 40, 3); });
    hvFelt(g, '#8B939A', () => { g.beginPath(); g.moveTo(200, 50); g.lineTo(232, 64); g.lineTo(200, 78); g.closePath(); });
  },
  faxmaskine(g) {                           // faxregnens projektil
    const cx = 128, cy = 72;
    hvFelt(g, '#C9CED3', () => { g.beginPath(); g.roundRect(cx - 60, cy - 26, 120, 54, 8); });
    hvFelt(g, '#A8AEB4', () => { g.beginPath(); g.roundRect(cx - 60, cy + 8, 120, 20, [0, 0, 8, 8]); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(cx - 40, cy - 16, 44, 18, 3); });
    g.fillStyle = '#5C6670';
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(cx + 20 + k * 12, cy - 12 + r * 12, 4, 0, Math.PI * 2); g.fill(); }
    hvFelt(g, '#F4F4F2', () => { g.beginPath(); g.moveTo(cx - 34, cy - 26); g.lineTo(cx - 28, cy - 54); g.lineTo(cx + 14, cy - 54); g.lineTo(cx + 10, cy - 26); g.closePath(); });
    g.strokeStyle = '#C9CED3'; g.lineWidth = 3;
    for (const y of [-46, -38]) { g.beginPath(); g.moveTo(cx - 24, cy + y); g.lineTo(cx + 6, cy + y); g.stroke(); }
  },
  papirbunke(g) {                           // papirbunke: en bunke A4 med elastik
    const cx = 128, cy = 70;
    const ark = [[-6, 22, '#D9D9D4'], [4, 12, '#E6E6E1'], [-3, 2, '#EFEFEA'], [5, -8, '#F7F7F3'], [0, -18, '#FFFFFF']];
    for (const [dx, dy, f] of ark) {
      hvFelt(g, '#B9BDC0', () => { g.beginPath(); g.roundRect(cx - 62 + dx, cy + dy + 2, 124, 12, 2); });
      hvFelt(g, f, () => { g.beginPath(); g.roundRect(cx - 62 + dx, cy + dy - 2, 124, 12, 2); });
    }
    g.strokeStyle = '#C9CED3'; g.lineWidth = 2.5;
    for (const y of [-14, -10]) { g.beginPath(); g.moveTo(cx - 44, cy + y); g.lineTo(cx + 30, cy + y); g.stroke(); }
    hvFelt(g, '#E8543F', () => { g.beginPath(); g.roundRect(cx + 26, cy - 22, 10, 50, 3); });
  },
  kabelbakke(g) {                           // kabelbakke: perforeret stålrende med kabler
    hvFelt(g, '#8B939A', () => { g.beginPath(); g.roundRect(6, 50, 244, 40, 4); });
    hvFelt(g, '#B5BBC1', () => { g.beginPath(); g.roundRect(6, 50, 244, 12, [4, 4, 0, 0]); });
    hvFelt(g, '#6E767D', () => { g.beginPath(); g.roundRect(6, 80, 244, 10, [0, 0, 4, 4]); });
    g.fillStyle = '#5C6670';
    for (let x = 20; x < 244; x += 22) { g.beginPath(); g.roundRect(x, 66, 12, 6, 3); g.fill(); }
    g.lineCap = 'round'; g.lineWidth = 7;
    for (const [f, y, b] of [['#2E6DB4', 48, 10], ['#FFD86F', 44, -8], ['#E8543F', 47, 6]]) {
      g.strokeStyle = f; g.beginPath(); g.moveTo(10, y);
      g.bezierCurveTo(80, y - b, 170, y + b, 246, y); g.stroke();
    }
  },
  skumpistol(g) {                           // byggeskum: dåse på skumpistol
    hvFelt(g, '#F2C230', () => { g.beginPath(); g.roundRect(22, 16, 66, 82, 12); });
    hvFelt(g, '#D9A91C', () => { g.beginPath(); g.roundRect(22, 16, 20, 82, [12, 0, 0, 12]); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.roundRect(34, 40, 42, 26, 4); });
    g.fillStyle = '#FFFFFF'; g.font = '800 13px Poppins, Calibri, sans-serif';
    g.textAlign = 'center'; g.fillText('PU', 55, 58);
    hvFelt(g, '#2A3036', () => { g.beginPath(); g.roundRect(80, 86, 132, 18, 6); });
    hvFelt(g, '#3A424A', () => { g.beginPath(); g.moveTo(100, 102); g.lineTo(124, 102); g.lineTo(116, 126); g.lineTo(94, 126); g.closePath(); });
    hvFelt(g, '#8B939A', () => { g.beginPath(); g.roundRect(208, 90, 34, 8, 4); });
    hvFelt(g, '#FFF3C4', () => { g.beginPath(); g.arc(246, 88, 9, 0, Math.PI * 2); g.arc(238, 80, 7, 0, Math.PI * 2); });
  },
  flag(g) {                                 // overgiv dig: hvidt flag på stang
    hvFelt(g, '#8A5F3A', () => { g.beginPath(); g.roundRect(118, 8, 8, 116, 4); });
    hvFelt(g, '#F4F4F2', () => { g.beginPath(); g.moveTo(126, 12); g.quadraticCurveTo(170, 4, 210, 18);
      g.lineTo(210, 66); g.quadraticCurveTo(170, 52, 126, 60); g.closePath(); });
    hvFelt(g, '#D8D8D4', () => { g.beginPath(); g.moveTo(126, 44); g.quadraticCurveTo(170, 36, 210, 50);
      g.lineTo(210, 66); g.quadraticCurveTo(170, 52, 126, 60); g.closePath(); });
  },
};

const hvCache = new Map();
/** Et håndvåben som lærred (cachet). Ukendt navn -> null. */
export function lavHaandvaaben(navn) {
  if (hvCache.has(navn)) return hvCache.get(navn);
  const tegn = HAANDVAABEN[navn];
  if (!tegn) return null;
  const c = canvas(HV_B, HV_H);
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  tegn(g);
  hvCache.set(navn, c);
  return c;
}


/* ------------------------------------------------- våbnenes proportioner */

/*
 * Hvor stor hver ting er i VERDEN, målt på tegningens faktiske indhold
 * (den største side, i wu). Figuren er ~46 wu høj (~1,75 m), så 1 wu er
 * ~4 cm, og en hånd er ~6 wu. Våben er overdrevet 2–3 gange i forhold til
 * virkeligheden — en rigtig mus på 3 wu kan ikke ses — men de står i
 * forhold til hinanden og til figuren. Holdt, kastet og udlagt bruger den
 * SAMME størrelse: musen, man kaster, er den, man holdt.
 */
export const VAABEN_STR = {
  // Våbnene er skruet ~1,4 gange op (2026-09-27): de skal kunne ses og
  // føles store ved siden af figuren og landskabet. Rekvisitterne (telefon,
  // printer) er uændrede.
  bazooka: 36,         // tonerkanon båret på skulderen
  scanner: 17,         // stregkodescanner med pistolgreb
  loddekolbe: 13,
  bor: 19,             // systemnedbrud: boremaskine
  mus: 8,
  tastatur: 19,
  tast: 6,             // tastaturbombens løse taster
  opdatering: 16,      // tvangsopdatering
  mail: 13,            // phishing-mine (udlagt er den altid 27 wu, se fx.js)
  mail_alarm: 13,
  ringbind: 18,
  bombe: 32,           // Datalæk-bomben: stor og rund, lunten medregnet
  faktura: 19,         // kvartalsopkrævningens faktura (stående A4)
  laptop: 19,          // hjemmearbejde
  virus: 14,           // COVID
  papirbunke: 15,      // bunke A4, holdt og kastet
  kabelbakke: 30,
  skumpistol: 19,      // byggeskum
  fjernbetjening: 13,  // fjernsupport
  bordtelefon: 16,     // telefonen, der ringer
  printer: 26,         // printeren (tidligere tønden), der springer
  printer_alarm: 26,
  radio: 9,            // faxregnen bestilles over radio
  flag: 26,
  tonerpatron: 12,     // tonerkanonens projektil
  faxmaskine: 14,      // faxregnens projektil
};

const maalCache = new Map();

/**
 * Lærred plus mål for én ting: bredde/hoejde er hele lærredets størrelse i
 * wu, så INDHOLDETS største side bliver VAABEN_STR[navn]. midt, venstre og
 * bund er indholdets midte, venstre kant og bund i forhold til lærredets
 * midte (wu, y opad) — til at placere grebet, eller stille tingen på jorden.
 */
export function vaabenMaal(navn) {
  if (maalCache.has(navn)) return maalCache.get(navn);
  const c = navn === 'bazooka' ? lavBazooka() : lavHaandvaaben(navn);
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const s = (VAABEN_STR[navn] || 10) / Math.max(1, x1 - x0 + 1, y1 - y0 + 1);   // wu pr. px
  const cx = c.width / 2, cy = c.height / 2;
  const m = {
    canvas: c,
    bredde: c.width * s, hoejde: c.height * s,
    midtX: ((x0 + x1) / 2 - cx) * s, midtY: (cy - (y0 + y1) / 2) * s,
    venstre: (x0 - cx) * s, bund: (cy - y1) * s,
    indholdB: (x1 - x0 + 1) * s, indholdH: (y1 - y0 + 1) * s,
  };
  maalCache.set(navn, m);
  return m;
}

/* ------------------------------------------------------------ eksplosion */

/** Ildkugle, røgsky, trykring og tegneserieord — ét atlas, 4 x 2 celler á 256. */
export const EKS_CELLE = 256;
export const EKS_NAVNE = ['ild', 'roeg', 'ring', 'glimt', 'BOOM!', 'POW!', 'BANG!', 'KABOOM!'];

export function lavEksplosionAtlas() {
  const C = EKS_CELLE;
  const c = canvas(C * 4, C * 2);
  const g = c.getContext('2d');
  const rng = lavRng(0xb00e);
  EKS_NAVNE.forEach((navn, i) => {
    g.save();
    g.translate((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2);
    const r = C * 0.44;
    if (navn === 'ild') {
      // Klumpet ildkugle: flere overlappende kugler, lysest i midten.
      const klumper = [];
      for (let k = 0; k < 9; k++) {
        const v = (k / 9) * Math.PI * 2, d = r * 0.42;
        klumper.push([Math.cos(v) * d, Math.sin(v) * d, r * (0.42 + rng() * 0.12)]);
      }
      g.fillStyle = '#C8452E';
      for (const [x, y, rr] of klumper) { g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#F08A2C';
      for (const [x, y, rr] of klumper) { g.beginPath(); g.arc(x * 0.8 - 4, y * 0.8 - 4, rr * 0.82, 0, Math.PI * 2); g.fill(); }
      const gr = g.createRadialGradient(-8, -8, 0, 0, 0, r * 0.75);
      gr.addColorStop(0, '#FFFBE8'); gr.addColorStop(0.4, '#FFE27A'); gr.addColorStop(1, 'rgba(255,200,80,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 0.8, 0, Math.PI * 2); g.fill();
    } else if (navn === 'roeg') {
      const klumper = [[0, 0, 0.5], [-0.35, 0.1, 0.36], [0.36, 0.08, 0.38], [0.1, -0.3, 0.36], [-0.2, -0.25, 0.3]];
      g.fillStyle = '#5E6468';
      for (const [x, y, rr] of klumper) { g.beginPath(); g.arc(x * r + 5, y * r + 7, rr * r, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#8E969B';
      for (const [x, y, rr] of klumper) { g.beginPath(); g.arc(x * r, y * r, rr * r, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.28)';
      for (const [x, y, rr] of klumper) { g.beginPath(); g.arc(x * r - rr * r * 0.3, y * r - rr * r * 0.35, rr * r * 0.45, 0, Math.PI * 2); g.fill(); }
    } else if (navn === 'ring') {
      g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 14;
      g.beginPath(); g.arc(0, 0, r * 0.9, 0, Math.PI * 2); g.stroke();
    } else if (navn === 'glimt') {
      g.fillStyle = '#FFFBE8';
      g.beginPath();
      for (let k = 0; k < 16; k++) {
        const v = (k / 16) * Math.PI * 2, rr = k % 2 ? r * 0.35 : r * 0.95;
        k ? g.lineTo(Math.cos(v) * rr, Math.sin(v) * rr) : g.moveTo(Math.cos(v) * rr, Math.sin(v) * rr);
      }
      g.closePath(); g.fill();
    } else {
      // Tegneserieord med tyk kontur og varm gradient.
      // Skriftstørrelsen tilpasses, så ordet altid er inden for sin celle —
      // ellers bløder det ind i nabocellen i atlasset.
      let str = 84;
      g.font = `900 ${str}px Poppins, Calibri, sans-serif`;
      const bredde = g.measureText(navn).width + 18;
      if (bredde > C * 0.9) { str = Math.floor(str * (C * 0.9) / bredde); }
      g.font = `900 ${str}px Poppins, Calibri, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.rotate(-0.12);
      g.lineJoin = 'round';
      g.lineWidth = 18; g.strokeStyle = KANT; g.strokeText(navn, 0, 4);
      const gr = g.createLinearGradient(0, -str / 2, 0, str / 2);
      gr.addColorStop(0, '#FFF3B0'); gr.addColorStop(0.5, '#FFD86F'); gr.addColorStop(1, '#F08A2C');
      g.fillStyle = gr; g.fillText(navn, 0, 4);
      g.lineWidth = 3; g.strokeStyle = '#A34526'; g.strokeText(navn, 0, 4);
    }
    g.restore();
  });
  return c;
}

/* ------------------------------------------------------------- farvehjælp */

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function lysere(hex, d) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + d));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function blandRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export { fbm2 };
