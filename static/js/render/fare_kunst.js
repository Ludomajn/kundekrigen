/* Kundekrigen — pladsholdere til farernes grafik (render/fare_view.js).
 *
 * Bruges KUN, hvis art directorens atlas mangler (static/grafik/objekter/
 * <navn>.webp) eller ikke kan hentes. Samme opbygning som de rigtige: 20
 * frames i celler på 128 px, 5 kolonner (idle_0-3, aktiv_0-3, fald_0-1,
 * land_0-2, udloes_0-2, doed_0-3), fodlinjen 118 px nede, og tegningen inden
 * for modellens udstrækning i render/objekt_rig.js, så størrelsen og
 * fodpunktet passer, når kunsten kommer. Simple former med mørk kant som
 * resten af spillet; ingen bagt rotation.
 *
 * Uden DOM (test i Node) er der ingen pladsholder: så returneres null.
 */
'use strict';

import { KANT } from './kunst.js';

const C = 128, KOL = 5, FOD = 118;
const FRAMES = ['idle_0', 'idle_1', 'idle_2', 'idle_3', 'aktiv_0', 'aktiv_1', 'aktiv_2', 'aktiv_3',
  'fald_0', 'fald_1', 'land_0', 'land_1', 'land_2', 'udloes_0', 'udloes_1', 'udloes_2',
  'doed_0', 'doed_1', 'doed_2', 'doed_3'];

function lavLaerred(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Fyld og kant i ét (kanten 3 px, som genstandene i kunst.js). */
function form(g, sti, fyld, lw = 3) {
  g.beginPath(); sti(); g.fillStyle = fyld; g.fill();
  g.strokeStyle = KANT; g.lineWidth = lw; g.stroke();
}

/** En flamme med fod i (x, y), h høj. */
function flamme(g, x, y, h, b = h * 0.55) {
  form(g, () => {
    g.moveTo(x - b / 2, y);
    g.quadraticCurveTo(x - b * 0.7, y - h * 0.5, x, y - h);
    g.quadraticCurveTo(x + b * 0.7, y - h * 0.5, x + b / 2, y);
    g.closePath();
  }, '#FF9A2E', 2.2);
  form(g, () => {
    g.moveTo(x - b / 4, y);
    g.quadraticCurveTo(x - b * 0.3, y - h * 0.35, x, y - h * 0.6);
    g.quadraticCurveTo(x + b * 0.3, y - h * 0.35, x + b / 4, y);
    g.closePath();
  }, '#FFE07A', 0);
}

function roeg(g, x, y, r) {
  form(g, () => { g.arc(x - r * 0.5, y, r * 0.7, 0, Math.PI * 2); }, '#9A9FA3', 2);
  form(g, () => { g.arc(x + r * 0.4, y - r * 0.3, r * 0.8, 0, Math.PI * 2); }, '#B4B9BC', 2);
}

/* Én tegner pr. model: (g, frame, n) med origo i cellens fodpunkt (64, 118). */
const TEGN = {
  kabelsalat(g, f, n) { kugle(g, f, n, ['#2B6FB0', '#D8402C', '#4E9A3E', '#E8C33A', '#20242A'], 40); },
  nullermand(g, f, n) { kugle(g, f, n, ['#8F9498', '#B7BBBE', '#6F7478'], 42); },

  ild(g, f, n) {
    if (f === 'doed') { roeg(g, 0, -18 - n * 8, 8 + n * 2); form(g, () => g.ellipse(0, -2, 14, 3, 0, 0, Math.PI * 2), '#3A2A22', 2); return; }
    const h = f === 'aktiv' || f === 'udloes' ? 62 + n * 4 : f === 'land' ? 18 + n * 10 : 38 + (n % 2) * 5;
    flamme(g, 0, 0, h, h * 0.62);
  },

  robotstoevsuger(g, f, n) {
    if (f === 'fald') g.rotate(Math.PI);
    const y = f === 'fald' ? 18 : 0;
    form(g, () => g.roundRect(-46, y - 30, 92, 26, 12), '#E8ECEE');
    form(g, () => g.roundRect(-46, y - 16, 92, 12, 5), '#3A3F45');
    form(g, () => g.arc(0, y - 26, 3.5, 0, Math.PI * 2), f === 'aktiv' ? '#E0402C' : '#6CC05A', 1.5);
    if (f === 'aktiv') roeg(g, 0, -52, 10);
    if (f === 'udloes') { form(g, () => g.roundRect(-30, -68, 44, 22, 8), '#FFFFFF', 2); }
    if (f === 'doed') { form(g, () => g.roundRect(-8, -40 - n * 10, 16, 22, 3), '#4E9A3E'); roeg(g, 0, -26, 10 + n * 3); }
  },

  pakkedrone(g, f, n) {
    const tip = f === 'aktiv' ? 0.18 : f === 'fald' ? 0.5 : f === 'doed' ? 0.9 : 0;
    const kasseY = f === 'udloes' ? 12 + n * 10 : 0;
    g.save(); g.rotate(tip);
    // Kassen, så dronen (y 21-55 i cellen, samme som kunsten).
    form(g, () => g.roundRect(-20, -58 + kasseY, 40, 58, 4), '#C98A4B');
    form(g, () => g.rect(-20, -40 + kasseY, 40, 7), '#D8402C', 1.5);
    form(g, () => g.roundRect(-18, -93, 36, 22, 8), '#EEF1F3');
    for (const s of [-1, 1]) {
      form(g, () => g.rect(s * 18 + (s < 0 ? -26 : 0), -93, 26, 4), '#2A2E33', 1.5);
      form(g, () => g.ellipse(s * 44, -95, 18, 3, 0, 0, Math.PI * 2), 'rgba(150,160,170,.6)', 1);
    }
    g.restore();
    if (f === 'aktiv' || f === 'doed') roeg(g, 10, -100, 9);
  },
};

function kugle(g, f, n, farver, r) {
  if (f === 'doed') {
    form(g, () => g.ellipse(0, -4, r * (1 - n * 0.18), 6 + (3 - n) * 4, 0, 0, Math.PI * 2), '#2A2624');
    if (n === 3) roeg(g, 0, -24, 9);
    return;
  }
  const sq = f === 'land' ? [1.15, 0.85, 1.05][n] : f === 'fald' ? 0.94 : 1;
  const cy = -r / sq;
  g.save(); g.translate(0, cy); g.scale(sq, 1 / sq);
  form(g, () => g.arc(0, 0, r, 0, Math.PI * 2), farver[0]);
  // Kablerne: buer i skiftende farver, forskudt pr. frame (de "vipper").
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + n * 0.12;
    g.beginPath(); g.ellipse(0, 0, r * 0.82, r * (0.3 + (i % 3) * 0.18), a, 0, Math.PI * 2);
    g.strokeStyle = farver[(i + 1) % farver.length]; g.lineWidth = 4; g.stroke();
  }
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.strokeStyle = KANT; g.lineWidth = 3; g.stroke();
  g.restore();
  if (f === 'aktiv') for (let i = -1; i <= 1; i++) flamme(g, i * r * 0.55, cy - r * 0.55, 30 + ((i + n) % 2) * 8);
  if (f === 'udloes') {
    g.fillStyle = 'rgba(190,235,255,.9)';
    g.beginPath(); g.arc(0, cy, r * (1.1 + n * 0.15), 0, Math.PI * 2); g.fill();
  }
}

const cache = new Map();

/** Pladsholderens atlas (640 x 512) for modellen, eller null uden DOM. */
export function lavPladsholder(navn) {
  if (cache.has(navn)) return cache.get(navn);
  const tegn = TEGN[navn];
  const c = tegn && lavLaerred(C * KOL, C * 4);
  if (c) {
    const g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    FRAMES.forEach((navnF, i) => {
      const [f, n] = navnF.split('_');
      g.save();
      g.translate((i % KOL) * C + C / 2, Math.floor(i / KOL) * C + FOD);
      tegn(g, f, Number(n));
      g.restore();
    });
  }
  cache.set(navn, c || null);
  return c || null;
}

/** Det brændte græs (256 x 51): en blød, mørk plet med gløder, bunden på jorden. */
export function lavGraesPladsholder() {
  if (cache.has('braendt_graes')) return cache.get('braendt_graes');
  const c = lavLaerred(256, 51);
  if (c) {
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 34, 8, 128, 34, 110);
    grad.addColorStop(0, 'rgba(24,20,18,.85)');
    grad.addColorStop(1, 'rgba(24,20,18,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(128, 34, 120, 16, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FF8A3A';
    for (const x of [100, 122, 150, 170]) { g.beginPath(); g.arc(x, 30 + (x % 3), 3, 0, Math.PI * 2); g.fill(); }
  }
  cache.set('braendt_graes', c || null);
  return c || null;
}
