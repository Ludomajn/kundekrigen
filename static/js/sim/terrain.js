/* Kundekrigen — destruktibelt terræn som pixelmaske.
 *
 * KOORDINATREGEL, afviges aldrig:
 *   Origo er NEDERST TIL VENSTRE. Y peger OPAD.
 *   idx = (H - 1 - y) * W + x
 * Et fortegnsskift her er den klassiske flertimersfejl i den her slags kode,
 * så konverteringen findes præcis ét sted: i idx().
 *
 * 1 world unit = 1 maskepixel. Bevidst 1:1, så der ikke findes en
 * konverteringsfaktor der kan blive forkert.
 *
 * carve() er den ENESTE mutator af masken, og den returnerer det snavsede
 * rektangel den lavede. Rendering opdaterer udelukkende ud fra den returværdi,
 * og dermed er drift mellem fysikmasken og den tegnede maske strukturelt
 * umulig — ikke bare usandsynlig.
 */
'use strict';

export const LUFT = 0;
export const JORD = 1;
export const FJELD = 2;

export class Terraen {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.maske = new Uint8Array(w * h);
    this.snavs = null;                 // {x0,y0,x1,y1} i maskekoordinater
    this.ops = [];                     // ordnet log — se noten nedenfor
    this._opNr = 0;
  }

  idx(x, y) { return (this.h - 1 - y) * this.w + x; }

  /** Materialet i et punkt. Uden for banen: luft, undtagen under bunden. */
  hent(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || x >= this.w) return LUFT;
    if (y < 0) return FJELD;           // afgrunden er dødelig, men ikke gennemtrængelig
    if (y >= this.h) return LUFT;      // projektiler må gerne bue over banen
    return this.maske[this.idx(x, y)];
  }

  fast(x, y) { return this.hent(x, y) !== LUFT; }

  /** Er et punkt under banens bund? Så er bæveren faldet ud af verden. */
  udenfor(x, y) { return y < -20 || x < -200 || x > this.w + 200; }

  // ------------------------------------------------------------ mutation

  _snavs(x0, y0, x1, y1) {
    const r = this.snavs;
    if (!r) { this.snavs = { x0, y0, x1, y1 }; return; }
    if (x0 < r.x0) r.x0 = x0;
    if (y0 < r.y0) r.y0 = y0;
    if (x1 > r.x1) r.x1 = x1;
    if (y1 > r.y1) r.y1 = y1;
  }

  tagSnavs() { const s = this.snavs; this.snavs = null; return s; }

  /** Grav en cirkel. Grundfjeld står fast. */
  carve(cx, cy, r, log = true) {
    return this._cirkel(cx, cy, r, LUFT, log, 0);
  }

  /** Byg en cirkel (bruges af bjælken og af vandstigning i sudden death). */
  fyld(cx, cy, r, mat = JORD, log = true) {
    return this._cirkel(cx, cy, r, mat, log, 3);
  }

  _cirkel(cx, cy, r, vaerdi, log, opType) {
    cx |= 0; cy |= 0; r |= 0;
    const x0 = Math.max(0, cx - r), x1 = Math.min(this.w - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(this.h - 1, cy + r);
    if (x0 > x1 || y0 > y1) return null;
    const rr = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const raekke = (this.h - 1 - y) * this.w;
      const spand = Math.floor(Math.sqrt(Math.max(0, rr - dy * dy)));
      const a = Math.max(x0, cx - spand), b = Math.min(x1, cx + spand);
      for (let x = a; x <= b; x++) {
        const i = raekke + x;
        if (vaerdi === LUFT && this.maske[i] === FJELD) continue;
        this.maske[i] = vaerdi;
      }
    }
    this._snavs(x0, y0, x1, y1);
    if (log) this.ops.push({ t: this._opNr++, k: opType, x: cx, y: cy, r });
    return { x0, y0, x1, y1 };
  }

  /** Orienteret rektangel — bjælken. Tilføjer materiale, og kommuterer derfor
   *  IKKE med udgravning; det er grunden til at ops er en ORDNET liste og ikke
   *  en mængde kratere. */
  bjaelke(cx, cy, halvL, halvT, vinkel, mat = JORD, log = true) {
    const c = Math.cos(vinkel), s = Math.sin(vinkel);
    const raek = Math.ceil(Math.abs(halvL * c) + Math.abs(halvT * s));
    const raekY = Math.ceil(Math.abs(halvL * s) + Math.abs(halvT * c));
    const x0 = Math.max(0, (cx - raek) | 0), x1 = Math.min(this.w - 1, (cx + raek) | 0);
    const y0 = Math.max(0, (cy - raekY) | 0), y1 = Math.min(this.h - 1, (cy + raekY) | 0);
    for (let y = y0; y <= y1; y++) {
      const raekke = (this.h - 1 - y) * this.w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        if (Math.abs(lx) <= halvL && Math.abs(ly) <= halvT) this.maske[raekke + x] = mat;
      }
    }
    this._snavs(x0, y0, x1, y1);
    if (log) this.ops.push({ t: this._opNr++, k: 1, x: cx | 0, y: cy | 0, hl: halvL, ht: halvT, v: vinkel });
    return { x0, y0, x1, y1 };
  }

  /** Kapsel — gnavetandens og nedgravningens tunnel.
   *  Graveren arbejder hver tick; ville vi logge én op per tick, blev det
   *  tusindvis per brug. I stedet samles 8 tick i én kapsel: visuelt identisk,
   *  8x færre ops på tråden. */
  kapsel(ax, ay, bx, by, r, log = true) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    const trin = Math.max(1, Math.ceil(len / (r * 0.6)));
    for (let i = 0; i <= trin; i++) {
      const t = i / trin;
      this._cirkel(ax + dx * t, ay + dy * t, r, LUFT, false, 0);
    }
    if (log) this.ops.push({ t: this._opNr++, k: 2, x: ax | 0, y: ay | 0, x2: bx | 0, y2: by | 0, r });
    return this.snavs;
  }

  /** Afspil en op-liste oven på et frisk genereret terræn (erstatter loggen). */
  afspil(ops) {
    this.anvendOps(ops);
    this.ops = ops.slice();
    this._snavs(0, 0, this.w - 1, this.h - 1);
  }

  /** Anvend ops uden at røre loggen — bruges når vi kun mangler de nyeste. */
  anvendOps(ops) {
    for (const o of ops) {
      if (o.k === 0) this._cirkel(o.x, o.y, o.r, LUFT, false, 0);
      else if (o.k === 1) this.bjaelke(o.x, o.y, o.hl, o.ht, o.v, JORD, false);
      else if (o.k === 2) this.kapsel(o.x, o.y, o.x2, o.y2, o.r, false);
      else if (o.k === 3) this._cirkel(o.x, o.y, o.r, JORD, false, 3);
      this._opNr = Math.max(this._opNr, o.t + 1);
    }
  }

  // ------------------------------------------------------------ forespørgsler

  /** Første faste celle under (x, y). Returnerer -1 hvis der ikke er nogen. */
  jordUnder(x, y) {
    for (let yy = Math.min(y, this.h - 1); yy >= 0; yy--) {
      if (this.fast(x, yy)) return yy;
    }
    return -1;
  }

  /** Overfladens højde i en kolonne, målt ovenfra. */
  overflade(x) {
    for (let y = this.h - 1; y >= 0; y--) if (this.fast(x, y)) return y;
    return -1;
  }

  /** Normalen i et nedslagspunkt, fra gradienten af en udglattet sampling.
   *  Falder tilbage til den indkommende retning, hvis gradienten er
   *  degenereret — hvilket sker inde i en helt lukket lomme. */
  normal(x, y, faldVx = 0, faldVy = -1) {
    let nx = 0, ny = 0;
    const R = 4;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.fast(x + dx, y + dy)) {
          const d2 = dx * dx + dy * dy;
          nx -= dx / d2;
          ny -= dy / d2;
        }
      }
    }
    const l = Math.sqrt(nx * nx + ny * ny);
    if (!(l > 1e-6)) {
      const fl = Math.sqrt(faldVx * faldVx + faldVy * faldVy) || 1;
      return { x: -faldVx / fl, y: -faldVy / fl };
    }
    return { x: nx / l, y: ny / l };
  }

  /** Marchér en stråle og returnér første faste punkt (eller null). */
  straale(x0, y0, dx, dy, maksLaengde, trin = 2) {
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = (dx / l) * trin, uy = (dy / l) * trin;
    let x = x0, y = y0;
    const n = Math.ceil(maksLaengde / trin);
    for (let i = 0; i < n; i++) {
      const px = x + ux, py = y + uy;
      if (this.fast(px, py)) return { x: px, y: py, sidstFri: { x, y }, afstand: i * trin };
      x = px; y = py;
      if (this.udenfor(x, y)) break;
    }
    return null;
  }

  /** Aftryk til desync-opdagelse: FNV over et 16 wu-gitter. Under et
   *  millisekund, og gør uenighed til noget der rapporteres frem for noget
   *  der opdages fordi en bæver falder gennem en bakke. */
  aftryk(gitter = 16) {
    let h = 0x811c9dc5;
    for (let y = 0; y < this.h; y += gitter) {
      for (let x = 0; x < this.w; x += gitter) {
        h ^= this.maske[this.idx(x, y)];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
    return h >>> 0;
  }
}
