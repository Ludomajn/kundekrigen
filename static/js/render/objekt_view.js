/* Kundekrigen — genstandene som tegneseriemodeller (samme stil som kunderne).
 *
 * Hver model har 20 frames i ét atlas (5 x 4 celler), i samme fordeling som
 * figurerne: idle_0-3, aktiv_0-3, fald_0-1, land_0-2, udloes_0-2, doed_0-3.
 * Eksplosionen er én serie på 20 frames. Atlasserne hentes af assets.js
 * (nøgle obj_<navn>); rig'en (fodpunkt og tegningens udstrækning) er
 * genereret af vaerktoej/tegneserieobjekter.py.
 *
 * objektMesh() giver en quad, hvis bredde i wu er TEGNINGENS bredde, og
 * hvis origo er fodpunktet (eller midten). animer() vælger frame ud fra en
 * tilstand og en tid: tomgang, aktiv og fald går i løkke; landing,
 * udløsning og død spilles én gang og bliver stående på sidste frame.
 */
'use strict';

import { Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, LinearFilter, SRGBColorSpace } from '../three.js';
import { OBJEKT_RIG as RIG } from './objekt_rig.js';
import { hent } from './assets.js';

const C = RIG.celle, KOL = RIG.kol;
const F = Object.fromEntries(RIG.frames.map((n, i) => [n, i]));

/* Løkker og engangsforløb pr. tilstand: frames og billeder pr. sekund. */
const FORLOEB = {
  idle:   { n: 4, fps: 4, loop: true },
  aktiv:  { n: 4, fps: 8, loop: true },
  fald:   { n: 2, fps: 5, loop: true },
  land:   { n: 3, fps: 14, loop: false },
  udloes: { n: 3, fps: 10, loop: false },
  doed:   { n: 4, fps: 10, loop: false },
};

export const OBJEKT_NAVNE = Object.keys(RIG.modeller);
export const objekterKlar = () => OBJEKT_NAVNE.every((n) => hent(`obj_${n}`));

const texCache = new Map();
function tex(navn) {
  if (texCache.has(navn)) return texCache.get(navn);
  const img = hent(`obj_${navn}`);
  if (!img) return null;
  const t = new CanvasTexture(img);
  t.minFilter = t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;          // tegningerne er sRGB — ellers udvaskes de
  texCache.set(navn, t);
  return t;
}

/** Tegningens mål i wu for en model med bredden bredde. */
export function objektMaal(navn, bredde) {
  const [x0, y0, x1, y1] = RIG.modeller[navn].indhold;
  const s = bredde / (x1 - x0);
  return { s, bredde, hoejde: (y1 - y0) * s, top: (RIG.fod - y0) * s };
}

/**
 * Quad med modellen. bredde er tegningens bredde i wu (i tomgang). midt:
 * origo i tegningens midte (eksplosionen) i stedet for fodpunktet.
 */
export function objektMesh(navn, bredde, renderOrder, { midt = false } = {}) {
  const rig = RIG.modeller[navn];
  const [x0, y0, x1, y1] = rig.indhold;
  const s = bredde / (x1 - x0);
  const geo = new PlaneGeometry(C * s, C * s);
  const cx = (x0 + x1) / 2, cy = midt ? (y0 + y1) / 2 : RIG.fod;
  geo.translate((C / 2 - cx) * s, (cy - C / 2) * s, 0);
  const m = new Mesh(geo, new MeshBasicMaterial({ map: tex(navn), transparent: true,
                                                    depthTest: true, depthWrite: false }));
  if (renderOrder !== undefined) m.renderOrder = renderOrder;
  m.userData.objekt = { navn, frame: -1, s };
  saetFrame(m, 0);
  return m;
}

/** Vis frame nr. i (eller et framenavn) i atlasset. */
export function saetFrame(m, i) {
  if (typeof i === 'string') i = F[i] ?? 0;
  const o = m.userData.objekt;
  if (o.frame === i) return;
  o.frame = i;
  const raekker = 4;
  const c = i % KOL, r = Math.floor(i / KOL);
  const u0 = c / KOL, u1 = (c + 1) / KOL;
  const v1 = 1 - r / raekker, v0 = 1 - (r + 1) / raekker;
  const uv = m.geometry.attributes.uv;
  // PlaneGeometry: øverst venstre, øverst højre, nederst venstre, nederst højre.
  uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
}

/**
 * Frame til en tilstand: t er sekunder i tilstanden (løkker bruger den som
 * ur; engangsforløb starter ved t = 0). fart skalerer tempoet.
 */
export function frameFor(tilstand, t, fart = 1) {
  const f = FORLOEB[tilstand] || FORLOEB.idle;
  let k = Math.floor(Math.max(0, t) * f.fps * fart);
  k = f.loop ? k % f.n : Math.min(f.n - 1, k);
  return F[`${tilstand in FORLOEB ? tilstand : 'idle'}_${k}`];
}

export function animer(m, tilstand, t, fart = 1) { saetFrame(m, frameFor(tilstand, t, fart)); }

/** Eksplosionens frame nr. ud fra hvor langt den er (0..1); -1 = færdig. */
export function eksplosionFrame(brok) {
  const n = RIG.eksFrames.length;
  const k = Math.floor(brok * n);
  return k >= n ? -1 : Math.max(0, k);
}
