/* Kundekrigen — små matematikhjælpere. Ingen afhængigheder, ingen DOM. */
'use strict';

export const TAU = Math.PI * 2;

export const klem = (v, lav, hoej) => (v < lav ? lav : v > hoej ? hoej : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const glatTrin = (a, b, v) => { const t = klem(invLerp(a, b, v), 0, 1); return t * t * (3 - 2 * t); };
export const tegn = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Math.hypot er 10-40x langsommere end sqrt i V8, og vi kalder det tit. */
export const laengde = (x, y) => Math.sqrt(x * x + y * y);
export const afstand = (ax, ay, bx, by) => laengde(bx - ax, by - ay);

/** Normalisér med værn: en NaN-position forplanter sig og er umulig at spore. */
export function normaliser(x, y) {
  const l = Math.sqrt(x * x + y * y);
  if (!(l > 1e-9)) return { x: 0, y: 0, l: 0 };
  return { x: x / l, y: y / l, l };
}

export function reflekter(vx, vy, nx, ny) {
  const d = vx * nx + vy * ny;
  return { x: vx - 2 * d * nx, y: vy - 2 * d * ny };
}

/** Korteste vej mellem to vinkler, så sigtet ikke tager den lange vej rundt. */
export function vinkelDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Kritisk dæmpet fjeder — kameraets følgebevægelse. */
export function glatDaemp(nu, maal, hast, tid, dt, maksFart = Infinity) {
  const omega = 2 / Math.max(0.0001, tid);
  const x = omega * dt;
  const eksp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let aendring = nu - maal;
  const maksAendring = maksFart * tid;
  aendring = klem(aendring, -maksAendring, maksAendring);
  const temp = (hast.v + omega * aendring) * dt;
  hast.v = (hast.v - omega * temp) * eksp;
  return maal + (aendring + temp) * eksp;
}

/** FNV-1a over tal — bruges til desync-aftryk. */
export function fnv(tal, start = 0x811c9dc5) {
  let h = start >>> 0;
  for (let i = 0; i < tal.length; i++) {
    let v = (tal[i] * 1000) | 0;
    for (let b = 0; b < 4; b++) {
      h ^= (v >>> (b * 8)) & 0xFF;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}
