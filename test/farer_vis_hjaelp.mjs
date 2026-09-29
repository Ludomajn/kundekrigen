/* Kundekrigen — fælles hjælpere til farer_vis_*.mjs (ikke en test).
 *
 * Farernes tegning (render/fare_view.js) og brugerflade (ui/farer.js) i Node:
 *   atlas()      art directorens atlas afkodet til RGBA (dwebp og ffmpeg), eller
 *                null, hvis værktøjerne mangler (så springes billedet over)
 *   tegnScene()  en lille software-rasterer: three-scenens quads med deres
 *                atlas, UV, rotation, skala, gennemsigtighed og lag, oven på
 *                terrænet — til kontaktarket og til at måle, hvor tegningen står
 *   falskFx, falskLyd, falskDom, falskHud, falskKamera: lige nok til ui/farer.js
 *   spejlFra()   en vært og et spejl fodret med snapshot, deltaer og hændelser,
 *                som main.js får dem
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lavVerden } from '../static/js/sim/world.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';
import { JORD, FJELD, MUR } from '../static/js/sim/terrain.js';

export const STATIC = fileURLToPath(new URL('../static/', import.meta.url));
export const kilde = (sti) => readFileSync(fileURLToPath(new URL(sti, import.meta.url)), 'utf8');

// ------------------------------------------------------------ atlasserne

function har(cmd) {
  try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch {
    try { execFileSync(cmd, ['-h'], { stdio: 'ignore' }); return true; } catch { return false; }
  }
}
export const VAERKTOEJ = { dwebp: har('dwebp'), ffmpeg: har('ffmpeg') };

function laesPam(b) {
  let i = 0; const hdr = {};
  const linje = () => { let s = ''; while (b[i] !== 10) s += String.fromCharCode(b[i++]); i++; return s; };
  for (;;) { const l = linje(); if (l === 'ENDHDR') break; const [k, v] = l.split(' '); hdr[k] = v; }
  return { width: +hdr.WIDTH, height: +hdr.HEIGHT, data: new Uint8Array(b.buffer, b.byteOffset + i, +hdr.WIDTH * +hdr.HEIGHT * 4) };
}

const ATLAS = new Map();
/** Et af art directorens billeder som { width, height, data (RGBA) }, eller null. */
export function atlas(navn) {
  if (ATLAS.has(navn)) return ATLAS.get(navn);
  let img = null;
  const webp = `${STATIC}grafik/objekter/${navn}.webp`, png = `${STATIC}grafik/objekter/${navn}.png`;
  try {
    if (existsSync(webp) && VAERKTOEJ.dwebp) {
      img = laesPam(execFileSync('dwebp', ['-quiet', webp, '-pam', '-o', '-'], { maxBuffer: 1 << 26 }));
    } else if (existsSync(png) && VAERKTOEJ.ffmpeg) {
      const hoved = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png]).toString().trim().split(',');
      const data = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
      img = { width: +hoved[0], height: +hoved[1], data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
    }
  } catch { img = null; }
  ATLAS.set(navn, img);
  return img;
}
/** Billedfunktionen til lavFareView: de rigtige filer (eller en tom af rette mål). */
export function billeder({ tomme = false } = {}) {
  const tom = new Map();
  return (navn) => {
    if (!tomme) { const a = atlas(navn); if (a) return a; }
    if (!tom.has(navn)) {
      const [w, h] = navn === 'braendt_graes' ? [256, 51] : [640, 512];
      tom.set(navn, { width: w, height: h, data: new Uint8Array(w * h * 4) });
    }
    return tom.get(navn);
  };
}

// ------------------------------------------------------------ rastereren

const FARVE = { himmel: [196, 224, 242], jord: [128, 88, 52], graes: [92, 160, 60], fjeld: [96, 98, 104],
  mur: [186, 176, 158], vand: [40, 110, 170] };

function sample(img, u, v, ud) {
  const x = u * img.width - 0.5, y = (1 - v) * img.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  ud[0] = ud[1] = ud[2] = ud[3] = 0;
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const xx = Math.min(img.width - 1, Math.max(0, x0 + dx)), yy = Math.min(img.height - 1, Math.max(0, y0 + dy));
    const k = (yy * img.width + xx) * 4, a = img.data[k + 3] / 255 * w;
    ud[0] += img.data[k] * a; ud[1] += img.data[k + 1] * a; ud[2] += img.data[k + 2] * a; ud[3] += a;
  }
  if (ud[3] > 0) { ud[0] /= ud[3]; ud[1] /= ud[3]; ud[2] /= ud[3]; }
}

/** Synlig hele vejen op (three tegner ikke et barn af en usynlig gruppe). */
function synlig(o) { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; }

/**
 * Tegn scenens quads i udsnittet [x0, x0 + b] x [y0, y0 + h] (wu) med s px pr.
 * wu. terraen: tegnes bagved (jord, fjeld, mur, græs); vand: havet foran.
 * ringe: [{ x, y, r }] tegnes som tynde cirkler (træfcirklerne). Giver
 * { w, h, rgb, alfa } — alfa: hvor meget af farernes tegning, der dækker
 * hver pixel (0-1), så testen kan måle tegningens underkant.
 */
export function tegnScene(scene, { x0, y0, b, h, s = 2.5, terraen = null, vand = null, ringe = [] }) {
  const W = Math.round(b * s), H = Math.round(h * s);
  const rgb = new Uint8Array(W * H * 3), alfa = new Float32Array(W * H);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const wx = x0 + (px + 0.5) / s, wy = y0 + h - (py + 0.5) / s;
    let c = FARVE.himmel;
    if (terraen) {
      const X = Math.round(wx), Y = Math.round(wy);
      if (terraen.fast(X, Y)) {
        const m = terraen.hent ? terraen.hent(X, Y) : JORD;
        c = m === MUR ? FARVE.mur : m === FJELD ? FARVE.fjeld : !terraen.fast(X, Y + 3) ? FARVE.graes : FARVE.jord;
      }
    }
    rgb.set(c, (py * W + px) * 3);
  }
  scene.updateMatrixWorld(true);
  const quads = [];
  scene.traverse((m) => {
    if (!m.isMesh || !synlig(m) || !m.material.map?.image?.data) return;
    quads.push(m);
  });
  quads.sort((a, c) => (a.renderOrder - c.renderOrder) || (a.matrixWorld.elements[14] - c.matrixWorld.elements[14]));
  const px4 = [0, 0, 0, 0];
  for (const m of quads) {
    const e = m.matrixWorld.elements, pos = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
    let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      lx0 = Math.min(lx0, pos.getX(i)); lx1 = Math.max(lx1, pos.getX(i));
      ly0 = Math.min(ly0, pos.getY(i)); ly1 = Math.max(ly1, pos.getY(i));
    }
    const u0 = uv.getX(0), v1 = uv.getY(0), u1 = uv.getX(3), v0 = uv.getY(3);
    // Hjørnerne i verden -> pixelrammen.
    let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
    for (const [lx, ly] of [[lx0, ly0], [lx1, ly0], [lx0, ly1], [lx1, ly1]]) {
      const wx = e[0] * lx + e[4] * ly + e[12], wy = e[1] * lx + e[5] * ly + e[13];
      const sx = (wx - x0) * s, sy = (y0 + h - wy) * s;
      sx0 = Math.min(sx0, sx); sx1 = Math.max(sx1, sx); sy0 = Math.min(sy0, sy); sy1 = Math.max(sy1, sy);
    }
    const det = e[0] * e[5] - e[4] * e[1];
    if (Math.abs(det) < 1e-9) continue;
    const img = m.material.map.image, op = m.material.opacity ?? 1, col = m.material.color;
    for (let py = Math.max(0, Math.floor(sy0)); py < Math.min(H, Math.ceil(sy1)); py++) {
      for (let px = Math.max(0, Math.floor(sx0)); px < Math.min(W, Math.ceil(sx1)); px++) {
        const wx = x0 + (px + 0.5) / s - e[12], wy = y0 + h - (py + 0.5) / s - e[13];
        const lx = (e[5] * wx - e[4] * wy) / det, ly = (-e[1] * wx + e[0] * wy) / det;
        if (lx < lx0 || lx > lx1 || ly < ly0 || ly > ly1) continue;
        const u = u0 + (lx - lx0) / (lx1 - lx0) * (u1 - u0), v = v0 + (ly - ly0) / (ly1 - ly0) * (v1 - v0);
        sample(img, u, v, px4);
        const a = px4[3] * op;
        if (a <= 0.004) continue;
        const k = (py * W + px) * 3;
        rgb[k] = rgb[k] * (1 - a) + px4[0] * col.r * a;
        rgb[k + 1] = rgb[k + 1] * (1 - a) + px4[1] * col.g * a;
        rgb[k + 2] = rgb[k + 2] * (1 - a) + px4[2] * col.b * a;
        alfa[py * W + px] = 1 - (1 - alfa[py * W + px]) * (1 - a);
      }
    }
  }
  // Havet foran (vandFor er halvt gennemsigtigt), og træfcirklerne.
  if (vand != null) for (let py = 0; py < H; py++) {
    if (y0 + h - (py + 0.5) / s > vand) continue;
    for (let px = 0; px < W; px++) {
      const k = (py * W + px) * 3;
      for (let c = 0; c < 3; c++) rgb[k + c] = rgb[k + c] * 0.5 + FARVE.vand[c] * 0.5;
    }
  }
  for (const r of ringe) {
    for (let i = 0; i < 180; i++) {
      const a = i / 180 * Math.PI * 2;
      const px = Math.round((r.x + Math.cos(a) * r.r - x0) * s), py = Math.round((y0 + h - r.y - Math.sin(a) * r.r) * s);
      if (px >= 0 && py >= 0 && px < W && py < H && i % 3 !== 2) rgb.set([230, 40, 200], (py * W + px) * 3);
    }
  }
  return { w: W, h: H, rgb, alfa };
}

/** Tegningens underkant (wu) i en søjle af udsnittet: laveste pixel med alfa > taerskel. */
export function underkant(b, { x0, y0, h, s = 2.5 }, fraX, tilX, taerskel = 0.5) {
  let laveste = null;
  for (let py = b.h - 1; py >= 0 && laveste === null; py--) {
    for (let px = Math.round((fraX - x0) * s); px < Math.round((tilX - x0) * s); px++) {
      if (px >= 0 && px < b.w && b.alfa[py * b.w + px] > taerskel) { laveste = py; break; }
    }
  }
  return laveste === null ? null : y0 + h - (laveste + 1) / s;
}

// ------------------------------------------------------------ falske moduler

/** fx: ordene og partiklerne huskes. */
export function falskFx() {
  const f = { ord: [], plasket: [], tal: { spor: 0, ild: 0, gnist: 0 } };
  f.pop = (tekst, x, y, o = {}) => f.ord.push({ tekst, x, y, ...o });
  f.plask = (x, y) => f.plasket.push({ x, y });
  f.spor = () => { f.tal.spor++; };
  f.ildSpor = () => { f.tal.ild++; };
  f.lunteGnist = () => { f.tal.gnist++; };
  f.eksplosion = () => {};
  return f;
}

/** lyd: en kanal, der kan være optaget (fri = false); kaldene huskes. */
export function falskLyd() {
  const l = { spillet: [], afvist: [], loekker: new Map(), fri: true, filer: new Set(), hentet: [] };
  l.afspil = (navn, opt = {}) => {
    if (!l.fri && !opt.vigtig) { l.afvist.push({ navn, ...opt }); return false; }
    l.spillet.push({ navn, ...opt });
    return true;
  };
  l.stemme = (navn, opt = {}) => { l.spillet.push({ navn, stemme: true, ...opt }); return true; };
  l.har = (navn) => l.filer.has(navn);
  l.kanalFri = () => l.fri;
  l.loop = (navn, til, vol = 1) => l.loekker.set(navn, { til: !!til, vol });
  l.hentLyde = (navne, o) => l.hentet.push({ navne, ...o });
  return l;
}

export function falskHud() {
  const h = { bannere: [], el: {} };
  h.banner = (tekst, ms, klasse = '') => h.bannere.push({ tekst, ms, klasse });
  return h;
}

export function falskKamera() {
  const k = { kald: [] };
  for (const n of ['rammeInd', 'rystelse', 'eksplosion', 'kortFokus', 'fokus', 'foelg', 'etabler', 'foelgSkud']) {
    k[n] = (...a) => k.kald.push([n, ...a]);
  }
  return k;
}

/** En renderer som renderer.js: kameraet i (cx, cy), udsnittet b x h wu på W x H px. */
export function falskRenderer({ cx = 0, cy = 0, b = 1000, h = 460, W = 1600, H = 900 } = {}) {
  const kamera = { position: { x: cx, y: cy }, left: -b / 2, right: b / 2, top: h / 2, bottom: -h / 2 };
  return {
    kamera, W, H,
    tilSkaerm(x, y) {
      return { x: (x - kamera.position.x - kamera.left) / (kamera.right - kamera.left) * W,
               y: H - (y - kamera.position.y - kamera.bottom) / (kamera.top - kamera.bottom) * H };
    },
  };
}

/* En lille DOM: lige nok til ui/farer.js' lag, pil og skilt. */
function element(tag = 'div') {
  const el = { tag, style: { vaerdier: {}, setProperty(k, v) { this.vaerdier[k] = v; }, getPropertyValue(k) { return this.vaerdier[k] || ''; } },
               attr: {}, boern: [], fjernet: false, textContent: '', _html: '', skrevet: 0 };
  const klasser = new Set();
  el.classList = {
    add: (...c) => c.forEach((x) => klasser.add(x)), remove: (...c) => c.forEach((x) => klasser.delete(x)),
    toggle: (c, v = !klasser.has(c)) => { if (v) klasser.add(c); else klasser.delete(c); return v; },
    contains: (c) => klasser.has(c),
  };
  Object.defineProperty(el, 'className', {
    get: () => [...klasser].join(' '),
    set: (v) => { klasser.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => klasser.add(c)); },
  });
  const under = new Map();
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html,
    set: (v) => {
      el._html = v; el.skrevet++; under.clear();
      // Elementerne, som HTML'en har (klasse -> element med de klasser, HTML'en giver det).
      for (const m of v.matchAll(/<(\w+) class="([^"]+)"/g)) {
        const e = element(m[1]); e.className = m[2];
        for (const k of m[2].split(' ')) if (!under.has('.' + k)) under.set('.' + k, e);
      }
      under.set('.fp-ikon use', element('use'));
    },
  });
  el.querySelector = (q) => under.get(q) || null;
  el.setAttribute = (k, v) => { el.attr[k] = v; };
  el.appendChild = (c) => { el.boern.push(c); c.parent = el; return c; };
  el.remove = () => { el.fjernet = true; if (el.parent) el.parent.boern = el.parent.boern.filter((x) => x !== el); };
  return el;
}

/** Sæt document, window og localStorage op til ui/farer.js. Giver roden og lageret. */
export function falskDom({ W = 1600, H = 900 } = {}) {
  const lager = new Map();
  const rod = element();
  const html = element('html');
  html.style.setProperty('--ui', '1');
  html.style.setProperty('--bund-h', '160px');
  globalThis.document = { createElement: (t) => element(t), documentElement: html };
  globalThis.window = { innerWidth: W, innerHeight: H };
  globalThis.localStorage = {
    getItem: (k) => (lager.has(k) ? lager.get(k) : null),
    setItem: (k, v) => lager.set(k, String(v)),
  };
  return { rod, lager, html };
}

// ------------------------------------------------------------ vært og spejl

const net = (x) => JSON.parse(JSON.stringify(x));

/**
 * Et spejl af værten, som main.js har det: genskab fra værtens snapshot, og
 * derefter tick for tick: hændelserne på bussen (før deltaen, som workeren
 * sender dem), så deltaen. hvert: kun hver n'te delta (3 = nettets 20 Hz).
 */
export function spejlFra(v, opsaet, { bus = null, hvert = 1 } = {}) {
  const spejl = lavVerden({ ...opsaet, cfg: net(v.cfg) });
  spejl.genskab(net(v.oejebliksbillede()));
  let n = 0;
  return {
    spejl,
    /** Ét tick hos værten; hændelserne og (måske) deltaen til spejlet. */
    skridt(foer = null) {
      if (foer) foer(v);
      const h = v.skridt();
      if (bus) for (const e of h) bus.send(e.navn, net(e));
      if (++n % hvert === 0) anvendDelta(spejl, net(v.delta()));
      return h;
    },
  };
}
