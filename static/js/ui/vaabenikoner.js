/* Kundekrigen — våbenikoner.
 *
 * Ikonerne i våbenbjælken og våbenpanelet er små "brikker" i Worms-stil:
 * en blank, afrundet flise i kategoriens farve med spillets EGEN tegning af
 * våbnet ovenpå — skråt, med hvid klistermærkekant og en blød skygge. Så er
 * ikonet præcis den ting, kunden står med i hånden, og ikke en fremmed
 * stregtegning.
 *
 * Tegnes én gang pr. våben i et lærred og gemmes som data-URL.
 */
'use strict';

import { lavHaandvaaben, lavBazooka } from '../render/kunst.js';
import { esc } from './tekst.js';

const STR = 128;                 // lærredets side; vises i 24-44 px

/** Hvilken tegning hvert våben får, og hvor skråt den ligger. */
const TEGNING = {
  grenroer:         { tegn: 'bazooka',        rot: -0.55, fyld: 1.0 },
  egegranat:        { tegn: 'mus',            rot: -0.25, fyld: 0.7 },
  koglebombe:       { tegn: 'tastatur',       rot: -0.3,  fyld: 0.86 },
  splintboesse:     { tegn: 'scanner',        rot: -0.2,  fyld: 0.82 },
  daemningsdynamit: { tegn: 'opdatering',     rot: -0.12, fyld: 0.74 },
  baevermine:       { tegn: 'mail_alarm',     rot: -0.18, fyld: 0.74 },
  halesmaek:        { tegn: 'ringbind',       rot: -0.28, fyld: 0.76 },
  gnavetand:        { tegn: 'loddekolbe',     rot: -0.7,  fyld: 0.92 },
  nedgravning:      { tegn: 'bor',            rot: -0.2,  fyld: 0.84 },
  bjaelke:          { tegn: 'serverrack',     rot: -0.12, fyld: 0.92 },
  gangtunnel:       { tegn: 'fjernbetjening', rot: -0.45, fyld: 0.86 },
  traestammeregn:   { tegn: 'faxmaskine',     rot: -0.18, fyld: 0.82 },
  staa_over:        { tegn: 'telefon',        rot: -0.35, fyld: 0.86 },
  overgiv:          { tegn: 'flag',           rot: -0.15, fyld: 0.84, kat: 'fare' },
};

/** Flisens farver pr. kategori: lys top, mørk bund og en kant. */
const KATEGORI = {
  skyts:    { top: '#FFB45C', bund: '#D2461F', kant: '#7A2410' },
  kast:     { top: '#8FE07A', bund: '#2E8C4A', kant: '#175029' },
  udstyr:   { top: '#6FD3F0', bund: '#1C6E9C', kant: '#0D3A55' },
  naerkamp: { top: '#C79BFF', bund: '#6A3FC4', kant: '#35196E' },
  meta:     { top: '#B9C4CC', bund: '#5B6972', kant: '#2C363D' },
  fare:     { top: '#F2766B', bund: '#8E1E22', kant: '#4A0D10' },   // opsig aftalen
};

function lav(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Telefonrør til "Sæt på hold" — findes ikke som håndvåben. */
function telefon() {
  const c = lav(256, 128), g = c.getContext('2d');
  g.translate(128, 64);
  g.fillStyle = '#2F3A43';
  g.beginPath();
  g.moveTo(-86, -20); g.quadraticCurveTo(0, -46, 86, -20);
  g.lineTo(86, 2); g.quadraticCurveTo(0, -18, -86, 2); g.closePath(); g.fill();
  for (const s of [-1, 1]) {
    g.fillStyle = '#2F3A43';
    g.beginPath(); g.roundRect(s * 86 - 26, -18, 52, 50, 16); g.fill();
    g.fillStyle = '#46545F';
    g.beginPath(); g.roundRect(s * 86 - 20, -12, 40, 12, 6); g.fill();
  }
  g.fillStyle = '#FFD86F';
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-18 + i * 18, -48, 6, 0, Math.PI * 2); g.fill(); }
  return c;
}

/** Beskær et lærred til dets synlige indhold. */
function beskaer(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 30) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return c;
  const u = lav(x1 - x0 + 1, y1 - y0 + 1);
  u.getContext('2d').drawImage(c, -x0, -y0);
  return u;
}

/** Ensfarvet silhuet af en tegning — til klistermærkekanten og skyggen. */
function silhuet(c, farve) {
  const s = lav(c.width, c.height), g = s.getContext('2d');
  g.drawImage(c, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = farve;
  g.fillRect(0, 0, s.width, s.height);
  return s;
}

function tegnFlise(g, kat) {
  const f = KATEGORI[kat] || KATEGORI.meta;
  const m = 6, r = 26, s = STR - m * 2;
  // mørk kant og en lille slagskygge under flisen
  g.fillStyle = 'rgba(4,20,30,.35)';
  g.beginPath(); g.roundRect(m, m + 5, s, s, r); g.fill();
  g.fillStyle = f.kant;
  g.beginPath(); g.roundRect(m, m, s, s, r); g.fill();
  // selve flisen: lys top mod mørk bund
  const gr = g.createLinearGradient(0, m, 0, m + s);
  gr.addColorStop(0, f.top); gr.addColorStop(1, f.bund);
  g.fillStyle = gr;
  g.beginPath(); g.roundRect(m + 4, m + 4, s - 8, s - 8, r - 4); g.fill();
  // stråler bag våbnet
  g.save();
  g.beginPath(); g.roundRect(m + 4, m + 4, s - 8, s - 8, r - 4); g.clip();
  g.translate(STR / 2, STR / 2);
  g.fillStyle = 'rgba(255,255,255,.13)';
  for (let i = 0; i < 8; i++) {
    g.rotate(Math.PI / 4);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-14, -STR); g.lineTo(14, -STR); g.closePath(); g.fill();
  }
  g.restore();
  // blank glans øverst
  g.save();
  g.beginPath(); g.roundRect(m + 4, m + 4, s - 8, s - 8, r - 4); g.clip();
  const gl = g.createLinearGradient(0, m, 0, STR * 0.55);
  gl.addColorStop(0, 'rgba(255,255,255,.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl;
  g.beginPath(); g.ellipse(STR / 2, m - 6, s * 0.62, STR * 0.36, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

function tegnVaaben(g, kilde, rot, fyld) {
  const c = beskaer(kilde);
  // Skalér, så den ROTEREDE tegning fylder flisen.
  const cos = Math.abs(Math.cos(rot)), sin = Math.abs(Math.sin(rot));
  const rb = c.width * cos + c.height * sin, rh = c.width * sin + c.height * cos;
  const skala = (STR * 0.8 * fyld) / Math.max(rb, rh);
  const w = c.width * skala, h = c.height * skala;
  const hvid = silhuet(c, '#FFFFFF'), skygge = silhuet(c, 'rgba(4,20,30,.5)');

  g.save();
  g.translate(STR / 2, STR / 2 + 2);
  g.rotate(rot);
  g.drawImage(skygge, -w / 2 + 3, -h / 2 + 6, w, h);
  const k = 4.5;                           // klistermærkekantens tykkelse
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.drawImage(hvid, -w / 2 + Math.cos(a) * k, -h / 2 + Math.sin(a) * k, w, h);
  }
  g.drawImage(c, -w / 2, -h / 2, w, h);
  g.restore();
}

const cache = new Map();

/** Data-URL til et våbens ikon, eller null hvis det ikke kan tegnes. */
export function ikonURL(w) {
  if (!w) return null;
  if (cache.has(w.id)) return cache.get(w.id);
  let url = null;
  try {
    const t = TEGNING[w.id];
    const kilde = !t ? null
      : t.tegn === 'bazooka' ? lavBazooka()
      : t.tegn === 'telefon' ? telefon()
      : lavHaandvaaben(t.tegn);
    if (kilde) {
      const c = lav(STR, STR), g = c.getContext('2d');
      tegnFlise(g, t.kat || w.kategori);
      tegnVaaben(g, kilde, t.rot, t.fyld);
      url = c.toDataURL('image/png');
    }
  } catch { url = null; }
  cache.set(w.id, url);
  return url;
}

/** Ikonet som HTML: brikken, eller den gamle stregtegning som reserve. */
export function ikonHTML(w, klasse) {
  const url = ikonURL(w);
  if (url) return `<img class="${klasse} vbrik" src="${url}" alt="" draggable="false">`;
  return `<svg class="${klasse}" viewBox="0 0 32 32"><use href="#${esc(w.ikon)}"/></svg>`;
}
