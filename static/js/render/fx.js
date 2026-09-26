/* Kundekrigen — effekter, projektiler og genstande. Ren præsentation;
 * simulationen læser intet herfra. Bruger rngFx, som ALDRIG må røre
 * simulationens tilfældighed.
 *
 * Grafikkilderne er delt: projektiler, miner, tønder, kasser og
 * eksplosionens 12 billeder kommer fra Kenney-sprites (assets.js), mens
 * gravsten, faldskærm, dynamit og gnist stadig tegnes i kunst.js — dem har
 * pakken ikke. En eksplosion er Kenneys billedserie skaleret til raderius,
 * plus jordstumper, gnister og et tegneserieord, når braget er stort nok.
 */
'use strict';

import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, NormalBlending,
  Mesh, PlaneGeometry, MeshBasicMaterial, Group, CanvasTexture, LinearFilter, SRGBColorSpace,
  LinearMipmapLinearFilter, LineSegments, LineBasicMaterial,
} from '../three.js';
import { Z } from './renderer.js';
import { HUL_TID } from './fejl40.js';
import { HEX } from './palette.js';
import { lavRng } from '../core/rng.js';
import {
  lavGenstandAtlas, GEN_NAVNE, GEN_KOL, lavEksplosionAtlas, EKS_NAVNE,
} from './kunst.js';
import { hent } from './assets.js';
import { lavHaandvaaben, vaabenMaal } from './kunst.js';
import { TYNGDE as SIM_TYNGDE, VIND_ACC as SIM_VIND_ACC } from '../sim/physics.js';

const MAKS = 1400;

const VS = `
attribute vec4 aStart;    // x, y, fødselstid, levetid
attribute vec4 aFart;     // vx, vy, størrelse, art
uniform float uTid;
uniform float uSkala;
varying float vLiv; varying float vArt;
void main(){
  float alder = uTid - aStart.z;
  vLiv = 1.0 - clamp(alder / aStart.w, 0.0, 1.0);
  vArt = aFart.w;
  if (vLiv <= 0.0) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; return; }
  float g = aFart.w > 1.5 ? 420.0 : 40.0;    // debris falder, røg stiger
  float x = aStart.x + aFart.x * alder;
  float y = aStart.y + aFart.y * alder - 0.5 * g * alder * alder;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
  gl_PointSize = uSkala * aFart.z * (vArt > 1.5 ? 1.0 : (0.5 + (1.0 - vLiv) * 1.6));
}`;

const FS = `
precision mediump float;
uniform vec3 uRoeg; uniform vec3 uIld; uniform vec3 uJord;
varying float vLiv; varying float vArt;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (vLiv <= 0.0) discard;
  if (vArt > 1.5) {
    // Jordstump: skarp klump med mørk kant, som alt andet i spillet.
    if (r > 0.5) discard;
    vec3 c = r > 0.36 ? vec3(0.12, 0.08, 0.05) : uJord * (1.1 - r);
    gl_FragColor = vec4(c, 1.0);
    return;
  }
  float m = 1.0 - smoothstep(0.15, 0.5, r);
  if (m <= 0.01) discard;
  vec3 c = vArt < 0.5 ? mix(uRoeg, uIld, vLiv * vLiv) : uIld;
  float a = vArt < 0.5 ? vLiv * 0.55 : vLiv;
  gl_FragColor = vec4(c, a * m);
}`;

function v3(hex){ return {x:((hex>>16)&255)/255, y:((hex>>8)&255)/255, z:(hex&255)/255}; }

/* ----------------------------------------------------------- atlasser */

function atlasTex(c) {
  const t = new CanvasTexture(c);
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = SRGBColorSpace;           // tegningerne er sRGB — ellers udvaskes de
  return t;
}

let genTex = null, eksTex = null;
const genGeo = new Map();

/* Kenney-billeder som teksturer. Cache per navn. */
const billedTexCache = new Map();
function billedTex(navn) {
  if (billedTexCache.has(navn)) return billedTexCache.get(navn);
  const img = hent(navn);
  if (!img) return null;
  const t = new CanvasTexture(img);
  t.minFilter = LinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  billedTexCache.set(navn, t);
  return t;
}

/** Tekstur af en flad håndtegning fra kunst.HAANDVAABEN (256 x 128). */
function haandTex(navn) {
  const n = `hv-${navn}`;
  if (billedTexCache.has(n)) return billedTexCache.get(n);
  const c = lavHaandvaaben(navn);
  if (!c) return null;
  const t = new CanvasTexture(c);
  t.minFilter = t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  billedTexCache.set(n, t);
  return t;
}
/**
 * Klistermærke-udgaven af en håndtegning: mørk kontur, tyk hvid kant og så
 * tegningen — samme stil som våbenikonerne og tegneseriekundernes kontur, så
 * ting på banen (miner, telefonen) ikke ser ud som en flad tegning.
 */
function klisterTex(navn) {
  const n = `kl-${navn}`;
  if (billedTexCache.has(n)) return billedTexCache.get(n);
  const c = lavHaandvaaben(navn);
  if (!c) return null;
  const silhuet = (farve) => {
    const k = document.createElement('canvas'); k.width = c.width; k.height = c.height;
    const g = k.getContext('2d'); g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = farve; g.fillRect(0, 0, k.width, k.height);
    return k;
  };
  const ud = document.createElement('canvas'); ud.width = c.width; ud.height = c.height;
  const g = ud.getContext('2d');
  const moerk = silhuet('#1E1610'), hvid = silhuet('#FFFFFF');
  for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; g.drawImage(moerk, Math.cos(a) * 10, Math.sin(a) * 10 + 2); }
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.drawImage(hvid, Math.cos(a) * 7, Math.sin(a) * 7); }
  g.drawImage(c, 0, 0);
  const t = new CanvasTexture(ud);
  t.minFilter = t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  billedTexCache.set(n, t);
  return t;
}

/** Tekst som tekstur (tegneserie-bogstaver med kontur), fx "RING!". */
function tekstTex(tekst, farve = '#FFD86F') {
  const n = `tx-${tekst}-${farve}`;
  if (billedTexCache.has(n)) return billedTexCache.get(n);
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.font = '900 64px Poppins, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#1E1610'; g.strokeText(tekst, 128, 50);
  g.fillStyle = farve; g.fillText(tekst, 128, 50);
  const t = new CanvasTexture(c);
  t.minFilter = t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  billedTexCache.set(n, t);
  return t;
}

/** Telefonens ringe-rytme: ringer i 1,1 s ud af hver 3. Deles med lyden. */
export const telefonRinger = (id, t) => ((t + id * 0.7) % 3) < 1.1;

/**
 * Quad af en flad tegning i dens fælles verdensstørrelse (kunst.VAABEN_STR).
 * paaJorden: tingens bund i y = 0 (udlagte ting); ellers er midten i origo,
 * så et projektil drejer om sin egen midte.
 */
function haandQuad(navn, renderOrder, paaJorden = false) {
  const maal = vaabenMaal(navn);
  const geo = new PlaneGeometry(maal.bredde, maal.hoejde);
  geo.translate(-maal.midtX, paaJorden ? -maal.bund : -maal.midtY, 0);
  const m = new Mesh(geo,
    new MeshBasicMaterial({ map: haandTex(navn), transparent: true, depthTest: true, depthWrite: false }));
  m.renderOrder = renderOrder;
  return m;
}

/** Quad med et helt Kenney-billede; højden følger billedets sideforhold. */
function billedQuad(navn, bredde, renderOrder) {
  const img = hent(navn);
  const t = billedTex(navn);
  if (!img || !t) return null;
  const h = bredde * (img.height / img.width);
  const m = new Mesh(new PlaneGeometry(bredde, h),
    new MeshBasicMaterial({ map: t, transparent: true, depthTest: true, depthWrite: false }));
  m.userData.h = h;
  if (renderOrder !== undefined) m.renderOrder = renderOrder;
  return m;
}

/** Quad med UV'er, der peger på én celle i atlasset. Caches per navn+størrelse. */
function celleGeo(navne, kol, raekker, navn, str, cache) {
  const n = `${navn}|${str}`;
  if (cache.has(n)) return cache.get(n);
  const i = Math.max(0, navne.indexOf(navn));
  const cu = 1 / kol, cv = 1 / raekker;
  const u0 = (i % kol) * cu, v0 = 1 - (Math.floor(i / kol) + 1) * cv;
  const geo = new PlaneGeometry(str, str);
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * cu, v0 + uv.getY(k) * cv);
  cache.set(n, geo);
  return geo;
}

const GEN_RAEK = Math.ceil(GEN_NAVNE.length / GEN_KOL);

/* Cellestørrelse i wu og hvor langt under centrum tingens fod sidder
   (brøkdel af cellen). Tegningerne fylder ikke hele cellen. */
const GEN_STR = {
  gren: 40, agern: 38, kogle: 44, 'frø': 34, dynamit: 44, mine: 44, mine_lys: 44,
  stamme: 60, toende: 44, sten: 38, kasse_vaaben: 54, kasse_helbred: 54, kasse_hjaelp: 54,
  faldskaerm: 60, gravsten: 42, gnist: 18, roer: 46, boesse: 44,
};
const FOD = { dynamit: 22 / 96, mine: 16 / 96, mine_lys: 16 / 96, toende: 28 / 96, gravsten: 30 / 96,
              kasse_vaaben: 28 / 96, kasse_helbred: 28 / 96, kasse_hjaelp: 28 / 96 };

function genGeoFor(navn) {
  if (!genTex) genTex = atlasTex(lavGenstandAtlas());
  return celleGeo(GEN_NAVNE, GEN_KOL, GEN_RAEK, navn, GEN_STR[navn] || 36, genGeo);
}
function genMat() {
  if (!genTex) genTex = atlasTex(lavGenstandAtlas());
  return new MeshBasicMaterial({ map: genTex, transparent: true, depthTest: true, depthWrite: false });
}

/* ------------------------------------------------------------ effekter */

export function lavFx(scene) {
  const rngFx = lavRng(0xBEA5E1);
  const start = new Float32Array(MAKS * 4);
  const fart = new Float32Array(MAKS * 4);
  let naeste = 0, tid = 0;

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(MAKS * 3), 3));
  geo.setAttribute('aStart', new BufferAttribute(start, 4));
  geo.setAttribute('aFart', new BufferAttribute(fart, 4));
  const mat = new ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: true, depthWrite: false,
    blending: NormalBlending,
    uniforms: { uTid: { value: 0 }, uSkala: { value: 1 },
                uRoeg: { value: v3(0x7E868B) },
                uIld:  { value: v3(0xFFD86F) },
                uJord: { value: v3(0x7B5B3D) } },
  });
  const punkter = new Points(geo, mat);
  punkter.frustumCulled = false;
  punkter.renderOrder = Z.fx;
  punkter.position.z = Z.fx;
  scene.add(punkter);

  function spawn(x, y, vx, vy, levetid, stoerrelse, art) {
    const i = naeste; naeste = (naeste + 1) % MAKS;
    start[i*4] = x; start[i*4+1] = y; start[i*4+2] = tid; start[i*4+3] = levetid;
    fart[i*4] = vx; fart[i*4+1] = vy; fart[i*4+2] = stoerrelse; fart[i*4+3] = art;
    geo.attributes.aStart.needsUpdate = true;
    geo.attributes.aFart.needsUpdate = true;
  }

  // ---- sprite-effekter fra eksplosionsatlasset
  if (!eksTex) eksTex = atlasTex(lavEksplosionAtlas());
  const eksGeo = new Map();
  const spriteGruppe = new Group();
  spriteGruppe.position.z = Z.fx + 1;
  scene.add(spriteGruppe);
  const aktive = [];
  const pulje = [];

  function sprite(navn, x, y, o) {
    let m = pulje.pop();
    if (!m) {
      m = new Mesh(genGeo.get('_tom') || new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ map: eksTex, transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = Z.fx + 1;
      spriteGruppe.add(m);
    }
    m.geometry = celleGeo(EKS_NAVNE, 4, 2, navn, 1, eksGeo);
    m.visible = true;
    m.position.set(x, y, o.z || 0);
    m.rotation.z = o.rot || 0;
    aktive.push({ m, t0: tid, ...o, x, y });
  }

  function opdaterSprites() {
    for (let i = aktive.length - 1; i >= 0; i--) {
      const s = aktive[i];
      const t = (tid - s.t0) / s.varighed;
      if (t >= 1) { s.m.visible = false; pulje.push(s.m); aktive.splice(i, 1); continue; }
      let skala, alpha;
      if (s.pop) {
        // Tegneserieord: popper ind med overskud, står, og falmer.
        skala = s.s1 * (t < 0.15 ? (t / 0.15) * 1.18 : t < 0.25 ? 1.18 - (t - 0.15) * 1.8 : 1);
        alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      } else {
        const e = 1 - Math.pow(1 - t, 2.2);
        skala = s.s0 + (s.s1 - s.s0) * e;
        alpha = s.a0 * (t < s.hold ? 1 : 1 - (t - s.hold) / (1 - s.hold));
      }
      s.m.scale.set(skala, skala, 1);
      s.m.material.opacity = Math.max(0, alpha);
      s.m.position.x = s.x + (s.vx || 0) * (tid - s.t0);
      s.m.position.y = s.y + (s.vy || 0) * (tid - s.t0);
      if (s.spin) s.m.rotation.z += s.spin / 60;
    }
  }

  const ORD = ['POW!', 'BANG!', 'BOOM!'];

  // Kenneys eksplosionsserie: pooled quads, hvor materialets tekstur skiftes
  // per billede. 12 billeder over et halvt sekund.
  const EKS_BILLEDER = 12, EKS_TID = 0.55;
  const anim = [];
  const animPulje = [];
  function eksAnim(x, y, str) {
    let m = animPulje.pop();
    if (!m) {
      m = new Mesh(new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = Z.fx + 2;
      spriteGruppe.add(m);
    }
    m.visible = true;
    m.position.set(x, y, 0.3);
    m.scale.set(str, str, 1);
    m.rotation.z = rngFx() * 6.28;
    anim.push({ m, t0: tid, sidste: -1 });
  }
  function opdaterAnim() {
    for (let i = anim.length - 1; i >= 0; i--) {
      const a = anim[i];
      const f = Math.floor(((tid - a.t0) / EKS_TID) * EKS_BILLEDER);
      if (f >= EKS_BILLEDER) { a.m.visible = false; animPulje.push(a.m); anim.splice(i, 1); continue; }
      if (f !== a.sidste) {
        const t = billedTex(`eks${f + 1}`);
        if (t) { a.m.material.map = t; a.m.material.needsUpdate = true; }
        a.sidste = f;
      }
      // Røgbillederne til sidst driver opad og tynder ud.
      const brok = (tid - a.t0) / EKS_TID;
      a.m.material.opacity = brok > 0.75 ? 1 - (brok - 0.75) / 0.25 * 0.6 : 1;
      a.m.position.y += (brok > 0.6 ? 14 : 0) / 60;
    }
  }

  return {
    /** Eksplosion: Kenney-billedserien, jordstumper, gnister og et ord. */
    eksplosion(x, y, radius) {
      const R = Math.max(14, radius);
      eksAnim(x, y, R * 2.7);
      if (R >= 30) eksAnim(x + (rngFx() - 0.5) * R, y + (rngFx() - 0.5) * R * 0.7,
                           R * (1.3 + rngFx() * 0.8));
      if (R >= 38) {
        const ord = R > 70 ? 'KABOOM!' : ORD[Math.floor(rngFx() * ORD.length)];
        sprite(ord, x + (rngFx() - 0.5) * 20, y + R * 0.9 + 40, {
          varighed: 1.0, s1: 150 + R * 0.9, pop: true, vy: 26, rot: (rngFx() - 0.5) * 0.2, z: 0.2,
        });
      }

      // Gnister og jordstumper
      const n = Math.min(60, 12 + (R * 0.6) | 0);
      for (let i = 0; i < n; i++) {
        const a = rngFx() * Math.PI * 2;
        const f = R * (1.4 + rngFx() * 2.6);
        spawn(x, y, Math.cos(a)*f, Math.sin(a)*f, 0.3 + rngFx()*0.35, R * 0.22, 1);
      }
      const d = Math.min(46, 16 + (R/2.5)|0);
      for (let i = 0; i < d; i++) {
        const a = -Math.PI * rngFx();
        const f = R * (2 + rngFx() * 3);
        spawn(x, y, Math.cos(a)*f, Math.abs(Math.sin(a))*f*1.3, 0.8 + rngFx()*0.8,
              4 + rngFx()*6, 2);
      }
    },
    spor(x, y) { spawn(x, y, (rngFx()-0.5)*14, 10+rngFx()*16, 0.6, 11, 0); },
    muzzle(x, y, dx, dy) {
      sprite('glimt', x, y, { varighed: 0.1, s0: 30, s1: 44, a0: 1, hold: 0.3, rot: rngFx() * 6.28 });
      for (let i = 0; i < 10; i++) {
        spawn(x, y, dx*(120+rngFx()*180), dy*(120+rngFx()*180), 0.16, 12, 1);
      }
    },
    plask(x, y) {
      for (let i = 0; i < 30; i++) {
        const a = -Math.PI * (0.2 + rngFx()*0.6);
        spawn(x, y, Math.cos(a)*(80 + rngFx()*80), Math.abs(Math.sin(a))*(160 + rngFx()*120), 0.7, 8, 0);
      }
      sprite('ring', x, y, { varighed: 0.5, s0: 20, s1: 110, a0: 0.7, hold: 0.1 });
    },
    opdater(dt, pixelPrWu = 1) {
      tid += dt; mat.uniforms.uTid.value = tid;
      // Punktstørrelser er i pixels; skalér dem med zoom, så de følger verden.
      mat.uniforms.uSkala.value = pixelPrWu;
      opdaterSprites();
      opdaterAnim();
    },
    fjern() {
      scene.remove(punkter); geo.dispose(); mat.dispose();
      scene.remove(spriteGruppe);
      for (const m of [...pulje, ...aktive.map((a) => a.m)]) m.material.dispose();
      for (const a of [...animPulje, ...anim.map((x) => x.m)]) { a.geometry?.dispose?.(); a.material?.dispose?.(); }
    },
  };
}

/* ------------------------------------------------- projektiler og genstande */

export function lavProjektilView(scene) {
  const gruppe = new Group();
  gruppe.position.z = Z.projektiler;
  scene.add(gruppe);
  const brugt = new Map();

  /* Simulationens spritenavne -> Kenney-kugler. To udgaver: med raketflamme
     (flyver aktivt) og uden (daler/sover). Farven adskiller våbnene. */
  const KUGLE = {
    // Simulationens spritenavne (fra før temaskiftet) -> tematiske modeller.
    // Størrelserne kommer fra kunst.VAABEN_STR, ligesom tingene i hånden.
    gren:   { tegn: 'tonerpatron', drejer: true },   // Tonerkanon
    stamme: { tegn: 'faxmaskine' },                  // Faxregn
    agern:  { tegn: 'mus' },                         // Musegranat
    kogle:  { tegn: 'tastatur' },                    // Tastaturbombe
    'frø':  { tegn: 'tast' },                        // løse taster
    sten:   { billede: 'mursten', b: 16 },           // "mursten fra loftet"
    dynamit:{ tegn: 'opdatering' },
    papir:  { tegn: 'papirbunke', drejer: true },    // Papirbunke
  };

  function lavMesh(k, flyver) {
    if (k.tegn) return haandQuad(k.tegn, Z.projektiler);
    if (k.billede) {
      const m = billedQuad(k.billede, k.b, Z.projektiler);
      if (m) return m;
    }
    if (k.atlas) {
      const m = new Mesh(genGeoFor(k.atlas), genMat());
      m.renderOrder = Z.projektiler;
      return m;
    }
    const m = billedQuad(flyver ? k.fly : k.ro, k.b, Z.projektiler);
    return m || new Mesh(genGeoFor('sten'), genMat());
  }

  return {
    opdater(liste) {
      const set = new Set();
      for (const p of liste) {
        set.add(p.id);
        const k = KUGLE[p.sprite] || KUGLE.gren;
        const flyver = !p.sover;
        let post = brugt.get(p.id);
        if (!post || post.flyver !== flyver) {
          if (post) { gruppe.remove(post.m); post.m.geometry?.dispose?.(); }
          post = { m: lavMesh(k, flyver), flyver, rot: post?.rot || 0 };
          brugt.set(p.id, post); gruppe.add(post.m);
        }
        const m = post.m;
        m.position.x = p.x;                 // interpoleret af klienten
        m.position.y = p.y;
        if (k.drejer) {
          if (p.vx !== undefined && (p.vx || p.vy)) m.rotation.z = Math.atan2(p.vy, p.vx);
        } else if (!p.sover) {
          post.rot -= (p.vx || 0) * 0.0025 + (k.billede ? 0.04 : 0);
          m.rotation.z = post.rot;
        }
      }
      for (const [id, post] of brugt) {
        if (!set.has(id)) { gruppe.remove(post.m); brugt.delete(id); }
      }
    },
    fjern() { scene.remove(gruppe); },
  };
}

/* Minernes markering: et advarselsskilt og en ring på jorden. Tegnet én
 * gang; begge ligger over græsset (Z.fx), så en mine aldrig skjules. */
let _skiltTex = null, _ringTex = null;
function skiltTex() {
  if (_skiltTex) return _skiltTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const trekant = (ind) => { g.beginPath(); g.moveTo(64, 10 + ind); g.lineTo(118 - ind, 108 - ind * 0.6);
    g.lineTo(10 + ind, 108 - ind * 0.6); g.closePath(); };
  g.lineJoin = 'round';
  g.fillStyle = '#1E1610'; trekant(0); g.fill();
  g.fillStyle = '#E8412C'; trekant(8); g.fill();
  g.fillStyle = '#FFD86F'; trekant(20); g.fill();
  g.fillStyle = '#1E1610';
  g.beginPath(); g.roundRect(57, 42, 14, 38, 7); g.fill();
  g.beginPath(); g.arc(64, 92, 8, 0, Math.PI * 2); g.fill();
  _skiltTex = new CanvasTexture(c);
  _skiltTex.minFilter = _skiltTex.magFilter = LinearFilter; _skiltTex.generateMipmaps = false;
  _skiltTex.colorSpace = SRGBColorSpace;
  return _skiltTex;
}
function ringTex() {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.save(); g.translate(128, 32); g.scale(1, 0.25);
  const gr = g.createRadialGradient(0, 0, 60, 0, 0, 124);
  gr.addColorStop(0, 'rgba(232,65,44,0)'); gr.addColorStop(0.72, 'rgba(232,65,44,.28)');
  gr.addColorStop(0.9, 'rgba(232,65,44,.9)'); gr.addColorStop(1, 'rgba(232,65,44,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 124, 0, Math.PI * 2); g.fill();
  g.restore();
  _ringTex = new CanvasTexture(c);
  _ringTex.minFilter = _ringTex.magFilter = LinearFilter; _ringTex.generateMipmaps = false;
  _ringTex.colorSpace = SRGBColorSpace;
  return _ringTex;
}
const MINE_RADIUS = 38;          // = placeret.naerhed i weapons.js / world.js

export function lavGenstandView(scene) {
  const gruppe = new Group();
  gruppe.position.z = Z.genstande;
  scene.add(gruppe);
  const brugt = new Map();
  const atlasMat = genMat();

  const atlasQuad = (navn) => {
    const m = new Mesh(genGeoFor(navn), atlasMat);
    m.renderOrder = Z.genstande;
    return m;
  };

  function lavTelefon() {
    const g = new Group();
    const m = haandQuad('bordtelefon', Z.genstande, true);
    m.material.map = klisterTex('bordtelefon');
    m.scale.setScalar(1.7);
    g.add(m); g.userData.krop = m;
    // En gul ring på jorden og "RING!" over den, mens den ringer.
    const ring = new Mesh(new PlaneGeometry(56, 15),
      new MeshBasicMaterial({ map: ringTex(), transparent: true, depthTest: false, depthWrite: false, color: 0xFFD86F }));
    ring.position.y = 1; ring.renderOrder = Z.fx - 1;
    g.add(ring); g.userData.ring = ring;
    const skilt = new Mesh(new PlaneGeometry(46, 17.25),
      new MeshBasicMaterial({ map: tekstTex('RING!'), transparent: true, depthTest: false, depthWrite: false }));
    skilt.renderOrder = Z.fx - 0.5;
    g.add(skilt); g.userData.skilt = skilt;
    g.userData.telefon = true;
    return g;
  }

  function lavPiller() {
    const g = new Group();
    const glas = billedQuad('kasseHelbred', 15, Z.genstande);
    if (glas) { glas.position.y = glas.userData.h / 2; g.add(glas); g.userData.krop = glas; }
    g.userData.glasH = glas ? glas.userData.h : 30;
    // En grøn ring og "+50", så man kan se, hvad glasset gør.
    const ring = new Mesh(new PlaneGeometry(50, 13),
      new MeshBasicMaterial({ map: ringTex(), transparent: true, depthTest: false, depthWrite: false, color: 0x7DDC6A }));
    ring.position.y = 1; ring.renderOrder = Z.fx - 1;
    g.add(ring); g.userData.ring = ring;
    const skilt = new Mesh(new PlaneGeometry(36, 13.5),
      new MeshBasicMaterial({ map: tekstTex('+50', '#8FE07A'), transparent: true, depthTest: false, depthWrite: false }));
    skilt.renderOrder = Z.fx - 0.5;
    g.add(skilt); g.userData.skilt = skilt;
    g.userData.piller = true;
    return g;
  }

  function lavKasse(slags) {
    if (slags === 'telefon') return lavTelefon();
    if (slags === 'helbred') return lavPiller();
    const g = new Group();
    const navn = slags === 'helbred' ? 'kasseHelbred' : slags === 'hjaelp' ? 'kasseHjaelp' : 'kasseVaaben';
    // Bredderne følger props'enes form: rygsækken er bred, glas og kapsel høje.
    const bredde = { kasseVaaben: 32, kasseHelbred: 16, kasseHjaelp: 14 }[navn];
    const kasse = billedQuad(navn, bredde, Z.genstande);
    if (kasse) { kasse.position.y = kasse.userData.h / 2; g.add(kasse); }
    const skaerm = atlasQuad('faldskaerm');           // faldskærmen tegnes stadig selv
    skaerm.position.y = 52;
    g.add(skaerm);
    g.userData.skaerm = skaerm;
    return g;
  }

  function lavPlaceret(sprite) {
    const g = new Group();
    g.userData.navn = sprite;
    if (sprite === 'mine') {
      // Phishing-minen: en uskyldig mail, hvis røde udråbstegn blinker.
      const m = haandQuad('mail', Z.genstande, true);
      m.material.map = klisterTex('mail');
      m.scale.setScalar(1.6);
      g.add(m); g.userData.krop = m;
      // Ringen viser, hvor tæt man kan komme, før den går af.
      const ring = new Mesh(new PlaneGeometry(MINE_RADIUS * 2.1, MINE_RADIUS * 0.55),
        new MeshBasicMaterial({ map: ringTex(), transparent: true, depthTest: false, depthWrite: false }));
      ring.position.y = 1; ring.renderOrder = Z.fx - 1;
      g.add(ring); g.userData.ring = ring;
      const skilt = new Mesh(new PlaneGeometry(22, 22),
        new MeshBasicMaterial({ map: skiltTex(), transparent: true, depthTest: false, depthWrite: false }));
      skilt.renderOrder = Z.fx - 0.5;
      g.add(skilt); g.userData.skilt = skilt;
    } else if (sprite === 'toende') {
      // Printeren: sprænges den (eller rammes den direkte), går den af med et brag.
      const m = haandQuad('printer', Z.genstande, true);
      m.material.map = klisterTex('printer');
      m.scale.setScalar(1.25);
      g.add(m); g.userData.krop = m; g.userData.printer = true;
    } else {
      // Tvangsopdateringen: blå boks med statuslinje og tændt lunte.
      const m = haandQuad('opdatering', Z.genstande, true);
      g.add(m);
      // Gnisten sidder for enden af lunten (øverst til højre på tegningen).
      const mo = vaabenMaal('opdatering');
      const gnist = atlasQuad('gnist');
      gnist.scale.set(0.6, 0.6, 1);
      gnist.position.set(mo.indholdB * 0.35, mo.indholdH * 0.98, 0.1);
      g.add(gnist);
      g.userData.gnist = gnist;
    }
    return g;
  }

  function lavGravsten() {
    const g = new Group();
    const m = atlasQuad('gravsten');
    m.position.y = GEN_STR.gravsten * FOD.gravsten;
    g.add(m);
    return g;
  }

  return {
    opdater(kasser, placerede, gravsten, terraen = null) {
      const t = performance.now() / 1000;
      const set = new Set();
      for (const k of kasser) {
        set.add('k' + k.id);
        let m = brugt.get('k' + k.id);
        if (!m) { m = lavKasse(k.slags); brugt.set('k' + k.id, m); gruppe.add(m); }
        m.position.set(k.x, k.y, 0);
        if (m.userData.piller) {
          const u = m.userData, puls = 0.5 + 0.5 * Math.sin(t * 3 + k.id);
          u.skilt.position.set(0, u.glasH + 12 + Math.sin(t * 2.4 + k.id) * 3, 0);
          u.ring.material.opacity = 0.35 + 0.45 * puls;
          continue;
        }
        if (m.userData.telefon) {
          // Ringer den, hopper den på gaflen, og "RING!" popper op.
          const ringer = telefonRinger(k.id, t);
          const u = m.userData;
          u.krop.rotation.z = ringer ? Math.sin(t * 46) * 0.09 : 0;
          u.krop.position.y = ringer ? Math.abs(Math.sin(t * 23)) * 1.6 : 0;
          u.skilt.visible = ringer;
          u.skilt.position.set(0, 42 + Math.sin(t * 6) * 2, 0);
          u.skilt.scale.setScalar(1 + 0.12 * Math.abs(Math.sin(t * 12)));
          u.ring.material.opacity = ringer ? 0.55 + 0.45 * Math.abs(Math.sin(t * 8)) : 0.25;
          continue;
        }
        const s = m.userData.skaerm;
        s.visible = !k.landet;
        m.rotation.z = k.landet ? 0 : Math.sin(t * 1.6 + k.id) * 0.12;
      }
      for (const p of placerede) {
        set.add('p' + p.id);
        let m = brugt.get('p' + p.id);
        if (!m) { m = lavPlaceret(p.sprite); brugt.set('p' + p.id, m); gruppe.add(m); }
        m.position.set(p.x, p.y, 0);
        if (m.userData.navn === 'mine' && m.userData.krop) {
          // Mailens røde udråbstegn blinker, så den kan ses i græsset.
          const tændt = Math.floor(t * 1.5 + p.id) % 2 === 1;
          const tex = klisterTex(tændt ? 'mail_alarm' : 'mail');
          if (tex && m.userData.krop.material.map !== tex) {
            m.userData.krop.material.map = tex;
            m.userData.krop.material.needsUpdate = true;
          }
          // Skiltet vipper over minen; ringen pulserer i takt med lampen.
          const puls = 0.5 + 0.5 * Math.sin(t * 5 + p.id);
          m.userData.skilt.position.set(0, 30 + Math.sin(t * 3 + p.id) * 2.5, 0);
          m.userData.skilt.scale.setScalar(1 + puls * 0.12);
          m.userData.ring.material.opacity = 0.45 + puls * 0.55;
          m.userData.ring.scale.set(0.92 + puls * 0.08, 1, 1);
        }
        if (m.userData.printer) {
          // PAPIRSTOP-lampen blinker, og printeren ryster en anelse.
          const tændt = Math.floor(t * 2 + p.id) % 2 === 1;
          const tex = klisterTex(tændt ? 'printer_alarm' : 'printer');
          if (tex && m.userData.krop.material.map !== tex) {
            m.userData.krop.material.map = tex;
            m.userData.krop.material.needsUpdate = true;
          }
          m.userData.krop.rotation.z = tændt ? Math.sin(t * 40) * 0.02 : 0;
        }
        if (m.userData.gnist) {
          const f = 0.4 + Math.random() * 0.35;   // flakker, i gnistens egen størrelse
          m.userData.gnist.scale.set(f, f, 1);
        }
      }
      for (const g of gravsten) {
        set.add('g' + g.id);
        let m = brugt.get('g' + g.id);
        if (!m) {
          m = lavGravsten(); brugt.set('g' + g.id, m); gruppe.add(m);
          // Skiltet dukker først op, når det sorte hul har lukket sig.
          m.userData.y = g.y; m.userData.vy = 0; m.userData.foedt = t + HUL_TID;
        }
        // Stenen står på jorden, også når et senere brag har fjernet den
        // under den: så falder den ned på det, der er tilbage.
        const u = m.userData;
        const jord = terraen ? terraen.jordUnder(Math.round(g.x), Math.round(u.y) + 2) : g.y - 1;
        const maal = jord >= 0 ? jord + 1 : -200;
        if (u.y > maal + 0.5) {
          u.vy = Math.min(u.vy + 18, 900);
          u.y = Math.max(maal, u.y - u.vy / 60);
        } else { u.y = Math.max(u.y, maal); u.vy = 0; }
        m.position.set(g.x, u.y, 0);
        m.visible = u.y > -150;
        // Poppe op af jorden med et lille overskud, som i Worms.
        const a = Math.min(1, (t - u.foedt) / 0.35);
        const sk = a < 1 ? Math.sin(a * Math.PI * 0.5) * (1 + 0.25 * Math.sin(a * Math.PI)) : 1;
        m.scale.set(1, Math.max(0.01, sk), 1);
      }
      for (const [id, m] of brugt) {
        if (!set.has(id)) { gruppe.remove(m); brugt.delete(id); }
      }
    },
    fjern() { scene.remove(gruppe); atlasMat.dispose(); },
  };
}

/* ------------------------------------------------- sigtelinje og markør */

export function lavSigte(scene) {
  // ---- BANEKURVE
  // Den klareste sigtehjælp er ikke et kryds, men den faktiske bane. Den
  // integreres med SAMME konstanter som fysikken, så den også viser, hvad
  // vinden gør ved skuddet — det er umuligt at gætte ellers.
  const MAKS_PRIK = 84;
  const bueGeo = new BufferGeometry();
  const buePos = new Float32Array(MAKS_PRIK * 3);
  const bueStr = new Float32Array(MAKS_PRIK);
  bueGeo.setAttribute('position', new BufferAttribute(buePos, 3));
  bueGeo.setAttribute('aT', new BufferAttribute(bueStr, 1));
  const bueMat = new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uFarve: { value: v3(HEX.yellow) }, uKraft: { value: 0 } },
    vertexShader: `
      attribute float aT; varying float vT;
      void main(){ vT = aT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        gl_PointSize = mix(10.0, 3.5, aT); }`,
    fragmentShader: `
      precision mediump float; uniform vec3 uFarve; uniform float uKraft; varying float vT;
      void main(){
        vec2 d = gl_PointCoord - vec2(0.5);
        float m = 1.0 - smoothstep(0.24, 0.5, length(d));
        if (m <= 0.02) discard;
        // Varm op mod rød, jo hårdere der lades — farven ER kraftmåleren.
        vec3 c = mix(uFarve, vec3(0.85,0.31,0.17), uKraft);
        gl_FragColor = vec4(c, m * (1.0 - vT * 0.55));
      }`,
  });
  const bue = new Points(bueGeo, bueMat);
  bue.renderOrder = Z.fx; bue.position.z = Z.fx;
  bue.frustumCulled = false;
  bue.visible = false;
  scene.add(bue);

  // ---- KRAFTBUE ved bæveren: en ring der fyldes, mens man lader op
  const MAAL_SEG = 34;
  const maalGeo = new BufferGeometry();
  const maalPos = new Float32Array((MAAL_SEG + 1) * 2 * 3);
  maalGeo.setAttribute('position', new BufferAttribute(maalPos, 3));
  const maalMat = new LineBasicMaterial({ color: HEX.yellow, transparent: true,
                                          opacity: 0.95, depthTest: false });
  const kraftbue = new LineSegments(maalGeo, maalMat);
  kraftbue.renderOrder = Z.fx; kraftbue.position.z = Z.fx;
  kraftbue.frustumCulled = false;
  kraftbue.visible = false;
  scene.add(kraftbue);

  // ---- MARKØR til markørvåben
  const markoer = new Mesh(new PlaneGeometry(30, 30),
    new MeshBasicMaterial({ color: HEX.yellow, transparent: true, opacity: 0.85,
                            depthTest: false, depthWrite: false }));
  markoer.renderOrder = Z.fx; markoer.position.z = Z.fx; markoer.visible = false;
  scene.add(markoer);

  // Sigtelinjen SKAL integrere med simulationens egne konstanter — også
  // vejrets luftmodstand og den effektive vind (med vindstød). Ellers lyver
  // den, netop når vejret betyder mest.
  // ---- SIGTEKORN (standard). Kun retningen — ikke hvor skuddet lander.
  // I Worms er det netop gætteriet om kraft og vind, der er spillet: en
  // fuld banekurve fjerner det. Kurven findes stadig som valgfri sigtehjælp.
  const KORN_AFSTAND = 90;
  const kornTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.lineCap = 'round';
    const tegn = (farve, bredde) => {
      g.strokeStyle = farve; g.lineWidth = bredde;
      g.beginPath(); g.arc(64, 64, 30, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 4; k++) {
        const v = k * Math.PI / 2;
        g.beginPath();
        g.moveTo(64 + Math.cos(v) * 38, 64 + Math.sin(v) * 38);
        g.lineTo(64 + Math.cos(v) * 54, 64 + Math.sin(v) * 54);
        g.stroke();
      }
    };
    tegn('rgba(20,26,30,.85)', 13);          // mørk kant, så det ses mod himlen
    tegn('#FFD86F', 6);                       // spillets gule
    g.fillStyle = '#FFD86F';
    g.beginPath(); g.arc(64, 64, 5, 0, Math.PI * 2); g.fill();
    const t = new CanvasTexture(c);
    t.minFilter = t.magFilter = LinearFilter; t.generateMipmaps = false;
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const korn = new Mesh(new PlaneGeometry(26, 26),
    new MeshBasicMaterial({ map: kornTex, transparent: true, depthTest: false, depthWrite: false }));
  korn.renderOrder = Z.fx + 3; korn.position.z = Z.fx; korn.visible = false;
  scene.add(korn);

  const TYNGDE = SIM_TYNGDE, VIND_ACC = SIM_VIND_ACC, DT = 1 / 60;

  return {
    /**
     * Tegn den forudsagte bane.
     * kraft01 0..1, vindFaktor fra våbnet, terraen til at stoppe ved nedslag,
     * vind er den EFFEKTIVE vind, modstand vejrets luftmodstand.
     */
    vis(x, y, dx, dy, kraft01, opt = {}) {
      const { min = 240, maks = 800, vind = 0, vindFaktor = 1, terraen = null,
              modstand = 0 } = opt;
      const fart = min + (maks - min) * kraft01;
      let px = x, py = y, vx = dx * fart, vy = dy * fart;
      let n = 0;
      // Store tidsskridt: vi vil vise formen, ikke simulere præcist.
      const skridt = 4;
      const braems = modstand > 0 && vindFaktor > 0 ? 1 - modstand * vindFaktor * DT : 1;
      for (let i = 0; i < MAKS_PRIK; i++) {
        for (let k = 0; k < skridt; k++) {
          vy -= TYNGDE * DT;
          vx += vind * vindFaktor * VIND_ACC * DT;
          vx *= braems; vy *= braems;
          px += vx * DT; py += vy * DT;
        }
        if (terraen && (terraen.fast(px, py) || terraen.udenfor(px, py))) break;
        buePos[n * 3] = px; buePos[n * 3 + 1] = py; buePos[n * 3 + 2] = 0;
        bueStr[n] = i / MAKS_PRIK;
        n++;
      }
      for (let i = n; i < MAKS_PRIK; i++) { buePos[i * 3 + 1] = -99999; bueStr[i] = 1; }
      bueGeo.attributes.position.needsUpdate = true;
      bueGeo.attributes.aT.needsUpdate = true;
      bueGeo.setDrawRange(0, MAKS_PRIK);
      bueMat.uniforms.uKraft.value = kraft01;
      bue.visible = true;
    },

    /** Kraftmåler som en bue om bæveren. Fyldes med opladningen. */
    visKraft(x, y, retning, kraft01) {
      const r = 46;
      const a0 = retning >= 0 ? -0.9 : Math.PI + 0.9;
      const spaend = (retning >= 0 ? 1 : -1) * 2.0 * kraft01;
      let n = 0;
      for (let i = 0; i < MAAL_SEG; i++) {
        const t0 = a0 + spaend * (i / MAAL_SEG);
        const t1 = a0 + spaend * ((i + 1) / MAAL_SEG);
        maalPos[n++] = x + Math.cos(t0) * r; maalPos[n++] = y + Math.sin(t0) * r; maalPos[n++] = 0;
        maalPos[n++] = x + Math.cos(t1) * r; maalPos[n++] = y + Math.sin(t1) * r; maalPos[n++] = 0;
      }
      for (; n < maalPos.length; n++) maalPos[n] = -99999;
      maalGeo.attributes.position.needsUpdate = true;
      maalMat.color.setHex(kraft01 > 0.8 ? 0xD94F2B : kraft01 > 0.5 ? 0xE8A33C : HEX.yellow);
      kraftbue.visible = kraft01 > 0.01;
    },

    /** Standardsigtet: et sigtekorn i fast afstand langs sigteretningen. */
    visSigtekorn(x, y, dx, dy, tid = 0) {
      korn.visible = true;
      korn.position.set(x + dx * KORN_AFSTAND, y + dy * KORN_AFSTAND, Z.fx);
      korn.rotation.z = tid * 0.8;                 // drejer langsomt: det lever
      const puls = 1 + Math.sin(tid * 5) * 0.05;
      korn.scale.set(puls, puls, 1);
      bue.visible = false;
    },

    skjul() { bue.visible = false; kraftbue.visible = false; korn.visible = false; },
    visMarkoer(x, y) { markoer.visible = true; markoer.position.set(x, y, Z.fx); },
    skjulMarkoer() { markoer.visible = false; },
    fjern() {
      scene.remove(bue); scene.remove(kraftbue); scene.remove(markoer);
      bueGeo.dispose(); bueMat.dispose(); maalGeo.dispose(); maalMat.dispose();
      markoer.geometry.dispose(); markoer.material.dispose();
    },
  };
}
