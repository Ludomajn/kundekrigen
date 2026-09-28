/* Kundekrigen — fælles hjælpere til kameratestene (test/kamera_*.mjs).
 *
 * En falsk render med SAMME udsnitsregel som den rigtige (renderer.udsnit),
 * et falsk terræn (en flad eller bølget bane med hav) og en lille
 * scenariekører, der kalder kameraet frame for frame og husker, hvad det
 * gjorde. Ingen three.js-lærred, ingen DOM.
 */
import { udsnit, VERDEN_H } from '../static/js/render/renderer.js';
import { lavKamera, FIGUR_H } from '../static/js/render/camera.js';

export { VERDEN_H, FIGUR_H };
export const TYNGDE = 480;               // sim/physics.js

/** Render med rigtig udsnitsregel og tilSkaerm som i renderer.js. */
export function lavFalskRenderer(pxB = 1920, pxH = 1080) {
  const kamera = { position: { x: 0, y: 0, z: 100 }, left: -1, right: 1, top: 1, bottom: -1 };
  const r = {
    kamera, bredde: 0, hoejde: 0, zoom: 1, enhed: { b: 0, h: 0 }, px: { b: pxB, h: pxH },
    tilpasKald: 0,
    tilpas(z = r.zoom) {
      r.tilpasKald++;
      r.zoom = z;
      udsnit(r.px.b / r.px.h, r.enhed);
      const vw = r.enhed.b * z, vh = r.enhed.h * z;
      kamera.left = -vw / 2; kamera.right = vw / 2;
      kamera.top = vh / 2; kamera.bottom = -vh / 2;
      r.bredde = vw; r.hoejde = vh;
    },
    zoomDerViser(b, h) { return Math.max(b / r.enhed.b, h / r.enhed.h); },
    tilSkaerm(x, y) {
      const w = r.px.b, h = r.px.h;
      const sx = (x - kamera.position.x - kamera.left) / (kamera.right - kamera.left) * w;
      const sy = h - (y - kamera.position.y - kamera.bottom) / (kamera.top - kamera.bottom) * h;
      return { x: sx, y: sy };
    },
  };
  r.tilpas(1);
  return r;
}

/** En bane: jorden i højden jord(x) (tal eller funktion), hav og evt. loft. */
export function lavBane({ w = 5120, h = 1792, jord = 600, vand = 300, loft = null } = {}) {
  const jh = typeof jord === 'function' ? jord : () => jord;
  return {
    w, h, vandNiveau: vand,
    fast(x, y) {
      x |= 0; y |= 0;
      if (x < 0 || x >= w) return false;
      if (y < 0) return true;
      if (y >= h) return false;
      return y <= jh(x) || (loft !== null && y >= loft);
    },
    jordHoejde(x) { return jh(x); },
  };
}

/** En figur som i spejlet: fødderne i (x, y). */
export function lavFigur(id, x, y, o = {}) {
  return { id, x, y, vx: 0, vy: 0, retning: 1, vinkel: 0.5, paaJorden: true, doed: false, ...o };
}

/** Kamera + render + bane. opt går videre til lavKamera. */
export function lavOpsaetning(o = {}) {
  const r = o.r || lavFalskRenderer(o.pxB, o.pxH);
  const t = o.bane || lavBane(o.baneOpt);
  const kam = lavKamera(r, t, { reduceret: false, ...o.kamOpt });
  return { r, t, kam };
}

/** Kør n sekunder i hz. fn(tid, dt, i) før hvert opdater. Returnerer prøver. */
export function koer(ops, sek, fn = null, hz = 60, start = 0) {
  const { r, kam } = ops;
  const dt = 1 / hz;
  const n = Math.round(sek * hz);
  const proever = [];
  for (let i = 0; i < n; i++) {
    const tid = start + i * dt;
    if (fn) fn(tid, dt, i);
    kam.opdater(dt);
    const g = kam.glat;
    proever.push({
      tid, x: g.x, y: g.y, zoom: g.zoom, tilstand: g.tilstand,
      px: r.kamera.position.x, py: r.kamera.position.y, vist: kam.zoom,
      b: r.bredde, h: r.hoejde,
    });
  }
  return proever;
}

/** Er punktet inde i billedet med en margen (andel af udsnittet pr. side)? */
export function iBilledet(r, x, y, margen = 0) {
  const k = r.kamera.position;
  return Math.abs(x - k.x) <= r.bredde * (0.5 - margen) && Math.abs(y - k.y) <= r.hoejde * (0.5 - margen);
}

/** Et ballistisk projektil som i simulationen (uden vind). Skridt pr. 60 Hz. */
export function lavProjektil(id, x, y, vx, vy) {
  return { id, x, y, vx, vy, sover: false };
}
export function skridtProjektil(p, dt) {
  p.vy -= TYNGDE * dt;
  p.x += p.vx * dt; p.y += p.vy * dt;
}
