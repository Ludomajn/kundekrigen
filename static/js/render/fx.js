/* Kundekrigen — effekter, projektiler og genstande. Ren præsentation;
 * simulationen læser intet herfra. Bruger rngFx, som ALDRIG må røre
 * simulationens tilfældighed.
 *
 * Genstandene på banen (mine, printer, opdatering, telefon, piller, kasser,
 * faldskærm, gravsten) og eksplosionen er tegneseriemodeller i kundernes
 * stil med 20 frames hver (objekt_view.js). Projektilerne er de flade
 * tegninger fra kunst.js. En eksplosion er modellens 20 frames skaleret til
 * radius, plus jordstumper, gnister og et tegneserieord ved store brag.
 *
 * Våbeneffekterne (stråler, KLASK!, skjold, teleport, fakturaregn, borestøv,
 * virussky) er metoder på lavFx-objektet, fordi de deler partikelbufferen og
 * spritepuljen. Alt er puljet: ingen tekstur eller mesh laves pr. frame.
 */
'use strict';

import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, NormalBlending, AdditiveBlending,
  Mesh, PlaneGeometry, MeshBasicMaterial, Group, CanvasTexture, LinearFilter, SRGBColorSpace,
  LinearMipmapLinearFilter, LineSegments, LineBasicMaterial, RepeatWrapping,
} from '../three.js';
import { Z } from './renderer.js';
import { HUL_TID } from './fejl40.js';
import { HEX } from './palette.js';
import { lavRng } from '../core/rng.js';
import {
  lavGenstandAtlas, GEN_NAVNE, GEN_KOL, lavEksplosionAtlas, EKS_NAVNE, KANT, TEGNE_PUNKTER,
} from './kunst.js';
import { hent } from './assets.js';
import {
  objektMesh, objektMaal, objektIndhold, OBJEKT_FOD, saetFrame, animer, eksplosionFrame,
} from './objekt_view.js';
import { lavHaandvaaben, vaabenMaal } from './kunst.js';
import { TYNGDE as SIM_TYNGDE, VIND_ACC as SIM_VIND_ACC } from '../sim/physics.js';
import { VAABEN } from '../sim/weapons.js';
import { armerRest as simArmerRest } from '../sim/entities.js';

const MAKS = 1400;

/* Partikler. art: 0 røg, 1 ild/gnist, 2 jordstump, 3 farvet glød (farven og
 * en alfa-faktor ligger i aFarve — virus, scannerlys, teleport, borestøv). */
const VS = `
attribute vec4 aStart;    // x, y, fødselstid, levetid
attribute vec4 aFart;     // vx, vy, størrelse, art
attribute vec4 aFarve;    // farvet glød: rgb og alfa
uniform float uTid;
uniform float uSkala;
varying float vLiv; varying float vArt; varying vec4 vFarve;
void main(){
  float alder = uTid - aStart.z;
  vLiv = 1.0 - clamp(alder / aStart.w, 0.0, 1.0);
  vArt = aFart.w;
  vFarve = aFarve;
  if (vLiv <= 0.0) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; return; }
  // Jordstumper falder, røg stiger, farvet glød svæver let opad.
  float g = aFart.w > 2.5 ? -14.0 : (aFart.w > 1.5 ? 420.0 : 40.0);
  float x = aStart.x + aFart.x * alder;
  float y = aStart.y + aFart.y * alder - 0.5 * g * alder * alder;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
  float vaekst = vArt > 2.5 ? (0.7 + (1.0 - vLiv) * 0.9) : vArt > 1.5 ? 1.0 : (0.5 + (1.0 - vLiv) * 1.6);
  gl_PointSize = uSkala * aFart.z * vaekst;
}`;

const FS = `
precision mediump float;
uniform vec3 uRoeg; uniform vec3 uIld; uniform vec3 uJord;
varying float vLiv; varying float vArt; varying vec4 vFarve;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (vLiv <= 0.0) discard;
  if (vArt > 2.5) {
    // Farvet glød: blød kugle, der falmer med alderen.
    float mg = 1.0 - smoothstep(0.05, 0.5, r);
    if (mg <= 0.01) discard;
    gl_FragColor = vec4(vFarve.rgb, vFarve.a * vLiv * mg);
    return;
  }
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
/** Farve til en farvet glødepartikel: [r, g, b, alfa] i 0..1. */
const rgba = (hex, a = 1) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a];

/* Effekternes farver. */
const FARVE = {
  roed: 0xFF5A3C,      // stregkodescannerens laser
  blaa: 0x4FB0FF,      // tvangsopdateringens stråle
  cyan: 0x7FF3FF,      // skjold og teleport
  groen: 0x7DDC6A,     // virus
};
const GLOED = {
  roed: rgba(0xFF6A4A, 0.9), blaa: rgba(0x6FC4FF, 0.9), cyan: rgba(0x9CF6FF, 0.85),
  groen: rgba(0x8FE07A, 0.7), toner: rgba(0x2E3338, 0.42), stoev: rgba(0x9C8468, 0.5),
};

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

/** Én fælles enhedsflade (1 x 1) til glød, tal og puljede quads. Deles —
 *  må aldrig disposes (se smid()). */
const ENHED = new PlaneGeometry(1, 1);
ENHED.userData.delt = true;

/** Fjern en mesh eller gruppe fra scenen og frigiv geometri og materialer
 *  (teksturerne er cachede og deles, så dem rører vi ikke). */
function smid(o) {
  o.parent?.remove(o);
  o.traverse((x) => {
    if (!x.isMesh) return;
    if (!x.geometry.userData.delt) x.geometry.dispose();
    if (!x.material.userData.delt) x.material.dispose();
  });
}

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

function lerredTex(c) {
  const t = new CanvasTexture(c);
  t.minFilter = t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Tekstur af en flad håndtegning fra kunst.HAANDVAABEN (256 x 128). */
function haandTex(navn) {
  const n = `hv-${navn}`;
  if (billedTexCache.has(n)) return billedTexCache.get(n);
  const c = lavHaandvaaben(navn);
  if (!c) return null;
  const t = lerredTex(c);
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
  const t = lerredTex(ud);
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
  const t = lerredTex(c);
  billedTexCache.set(n, t);
  return t;
}

/* Tegneserieordenes farver: lys top, midte, mørk bund og en tynd inderkant. */
const POP_FARVER = {
  gul:   ['#FFF3B0', '#FFD86F', '#F08A2C', '#A34526'],
  roed:  ['#FFD9CC', '#FF6A4A', '#C8321E', '#6E1E12'],
  blaa:  ['#E2F5FF', '#6FC4FF', '#2E6DB4', '#0D3A55'],
  groen: ['#EAFFD6', '#8FE07A', '#2E8C4A', '#175029'],
  cyan:  ['#F0FEFF', '#9CF0FF', '#2FA8C8', '#0D4A5E'],
  hvid:  ['#FFFFFF', '#F4F4F2', '#C9CED3', '#5B6972'],
};

/**
 * Et tegneserieord som tekstur, så bredt som ordet — skriften tilpasses, så
 * intet klippes (tekstTex har et fast lærred). Cachet pr. ord og farve;
 * texture.userData.aspekt er bredde / højde.
 */
function popTex(tekst, farve = 'gul') {
  const n = `pop-${tekst}-${farve}`;
  if (billedTexCache.has(n)) return billedTexCache.get(n);
  const H = 160;
  let str = 112;
  const skrift = (s) => `900 ${s}px Poppins, Calibri, sans-serif`;
  const maal = document.createElement('canvas').getContext('2d');
  maal.font = skrift(str);
  let b = maal.measureText(tekst).width + 44;
  if (b > 1000) { str = Math.floor(str * 1000 / b); maal.font = skrift(str); b = maal.measureText(tekst).width + 44; }
  const c = document.createElement('canvas'); c.width = Math.ceil(b); c.height = H;
  const g = c.getContext('2d');
  g.font = skrift(str); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const [lys, midt, moerk, streg] = POP_FARVER[farve] || [farve, farve, farve, KANT];
  const x = c.width / 2, y = H / 2 + 4;
  g.lineWidth = 20; g.strokeStyle = KANT; g.strokeText(tekst, x, y);
  const gr = g.createLinearGradient(0, y - str / 2, 0, y + str / 2);
  gr.addColorStop(0, lys); gr.addColorStop(0.5, midt); gr.addColorStop(1, moerk);
  g.fillStyle = gr; g.fillText(tekst, x, y);
  g.lineWidth = 3; g.strokeStyle = streg; g.strokeText(tekst, x, y);
  const t = lerredTex(c);
  t.userData.aspekt = c.width / H;
  billedTexCache.set(n, t);
  return t;
}

/** Blød, hvid glorie (farves med materialets color) — glød om miner, gnister,
 *  skjold og virusskyer. */
let _gloedTex = null;
function gloedTex() {
  if (_gloedTex) return _gloedTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,.75)');
  gr.addColorStop(0.55, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _gloedTex = lerredTex(c);
  return _gloedTex;
}

/** Tegneseriestjerne til KLASK!: gul med mørk kant. */
let _stjerneTex = null;
function stjerneTex() {
  if (_stjerneTex) return _stjerneTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 33);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const v = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 11 : 25;
    i ? g.lineTo(Math.cos(v) * r, Math.sin(v) * r) : g.moveTo(Math.cos(v) * r, Math.sin(v) * r);
  }
  g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = KANT; g.stroke();
  g.fillStyle = '#FFD86F'; g.fill();
  g.fillStyle = 'rgba(255,255,255,.6)';
  g.beginPath(); g.ellipse(-5, -8, 5, 3, -0.5, 0, Math.PI * 2); g.fill();
  _stjerneTex = lerredTex(c);
  return _stjerneTex;
}

/* Strålernes tekstur: en lys kerne med farvet glød på tværs. Scanneren har
 * stregkodens mønster på langs, opdateringen en fremdriftslinjes felter. */
const straaleTexCache = new Map();
function straaleTex(farve) {
  if (straaleTexCache.has(farve)) return straaleTexCache.get(farve);
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  const hex = FARVE[farve] ?? FARVE.roed;
  const r = (hex >> 16) & 255, gg = (hex >> 8) & 255, b = hex & 255;
  const f = (a) => `rgba(${r},${gg},${b},${a})`;
  const gr = g.createLinearGradient(0, 0, 0, 32);
  gr.addColorStop(0, f(0)); gr.addColorStop(0.24, f(0.3)); gr.addColorStop(0.4, f(1));
  gr.addColorStop(0.5, '#FFFFFF'); gr.addColorStop(0.6, f(1)); gr.addColorStop(0.76, f(0.3)); gr.addColorStop(1, f(0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 32);
  g.globalCompositeOperation = 'destination-out';
  if (farve === 'roed') {
    // Stregkode: smalle og brede huller i et fast mønster.
    g.fillStyle = 'rgba(0,0,0,.6)';
    let x = 0;
    for (const [streg, hul] of [[3, 2], [1, 1], [2, 3], [1, 1], [4, 2], [1, 2], [2, 1], [3, 3], [1, 2], [2, 2]]) {
      x += streg; g.fillRect(x, 0, hul, 32); x += hul;
    }
  } else if (farve === 'blaa') {
    // Fremdriftslinjens felter.
    g.fillStyle = 'rgba(0,0,0,.55)';
    for (let x = 0; x < 64; x += 16) g.fillRect(x + 11, 0, 5, 32);
  }
  const t = lerredTex(c);
  t.wrapS = RepeatWrapping;
  straaleTexCache.set(farve, t);
  return t;
}

/** Telefonens ringe-rytme: ringer i 1,1 s ud af hver 3. Deles med lyden. */
export const telefonRinger = (id, t) => ((t + id * 0.7) % 3) < 1.1;

/** Phishing-minens nedtælling: det hele sekund, der vises på minen, og som
 *  main.js bipper på, hver gang det skifter. 0 = armeret. */
export const mineSekund = (armerRest) => Math.ceil(Math.max(0, armerRest || 0) / 60);

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

/** En additiv glorie-quad (fx lunten, minens lampe) i en given farve. */
function gloedQuad(farve, renderOrder, depthTest = true) {
  const m = new Mesh(ENHED, new MeshBasicMaterial({
    map: gloedTex(), color: farve, transparent: true, depthTest, depthWrite: false, blending: AdditiveBlending }));
  m.renderOrder = renderOrder;
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
  geo.userData.delt = true;
  cache.set(n, geo);
  return geo;
}

const GEN_RAEK = Math.ceil(GEN_NAVNE.length / GEN_KOL);

/* Cellestørrelse i wu. Tegningerne fylder ikke hele cellen. (Genstandene på
   banen er tegneseriemodeller nu — se OBJ og objekt_view.js.) */
const GEN_STR = {
  gren: 40, agern: 38, kogle: 44, 'frø': 34, dynamit: 44, mine: 44, mine_lys: 44,
  stamme: 60, toende: 44, sten: 38, kasse_vaaben: 54, kasse_helbred: 54, kasse_hjaelp: 54,
  faldskaerm: 60, gravsten: 42, gnist: 18, roer: 46, boesse: 44,
};

function genGeoFor(navn) {
  if (!genTex) genTex = atlasTex(lavGenstandAtlas());
  return celleGeo(GEN_NAVNE, GEN_KOL, GEN_RAEK, navn, GEN_STR[navn] || 36, genGeo);
}
function genMat() {
  if (!genTex) genTex = atlasTex(lavGenstandAtlas());
  return new MeshBasicMaterial({ map: genTex, transparent: true, depthTest: true, depthWrite: false });
}

/* ------------------------------------------------------------ effekter */

/**
 * kamera (valgfrit): scenens OrthographicCamera. Bruges kun af fakturaRegn
 * til at lade fakturaerne starte over skærmens overkant.
 */
export function lavFx(scene, kamera = null) {
  const rngFx = lavRng(0xBEA5E1);
  const start = new Float32Array(MAKS * 4);
  const fart = new Float32Array(MAKS * 4);
  const farve = new Float32Array(MAKS * 4);
  let naeste = 0, tid = 0;

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(MAKS * 3), 3));
  geo.setAttribute('aStart', new BufferAttribute(start, 4));
  geo.setAttribute('aFart', new BufferAttribute(fart, 4));
  geo.setAttribute('aFarve', new BufferAttribute(farve, 4));
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

  /** Én partikel. kol: [r,g,b,a] til art 3 (farvet glød). */
  function spawn(x, y, vx, vy, levetid, stoerrelse, art, kol = null) {
    const i = naeste; naeste = (naeste + 1) % MAKS;
    start[i*4] = x; start[i*4+1] = y; start[i*4+2] = tid; start[i*4+3] = levetid;
    fart[i*4] = vx; fart[i*4+1] = vy; fart[i*4+2] = stoerrelse; fart[i*4+3] = art;
    if (kol) { farve[i*4] = kol[0]; farve[i*4+1] = kol[1]; farve[i*4+2] = kol[2]; farve[i*4+3] = kol[3]; }
    geo.attributes.aStart.needsUpdate = true;
    geo.attributes.aFart.needsUpdate = true;
    if (kol) geo.attributes.aFarve.needsUpdate = true;
  }

  // ---- sprite-effekter fra eksplosionsatlasset (eller en egen tekstur)
  if (!eksTex) eksTex = atlasTex(lavEksplosionAtlas());
  const eksGeo = new Map();
  const spriteGruppe = new Group();
  spriteGruppe.position.z = Z.fx + 1;
  scene.add(spriteGruppe);
  const aktive = [];
  const pulje = [];

  /**
   * Puljet quad. navn er en celle i eksplosionsatlasset — eller null med
   * o.tex (egen tekstur; o.aspekt = bredde/højde). o: varighed, s0, s1, a0,
   * hold, rot, z, pop, vx, vy, g (tyngde), spin, farve (tint), additiv.
   */
  function sprite(navn, x, y, o) {
    let m = pulje.pop();
    if (!m) {
      m = new Mesh(ENHED,
        new MeshBasicMaterial({ map: eksTex, transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = Z.fx + 1;
      spriteGruppe.add(m);
    }
    const tex = o.tex || eksTex;
    m.geometry = o.tex ? ENHED : celleGeo(EKS_NAVNE, 4, 2, navn, 1, eksGeo);
    if (m.material.map !== tex) { m.material.map = tex; m.material.needsUpdate = true; }
    m.material.color.setHex(o.farve ?? 0xFFFFFF);
    m.material.blending = o.additiv ? AdditiveBlending : NormalBlending;
    m.visible = true;
    m.position.set(x, y, o.z || 0);
    m.rotation.z = o.rot || 0;
    m.scale.set(0.01, 0.01, 1);
    aktive.push({ m, t0: tid, s0: 0, a0: 1, hold: 0.5, ...o, x, y, aspekt: o.aspekt || 1 });
  }

  function opdaterSprites(dt) {
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
      skala = Math.max(0.01, skala);
      s.m.scale.set(skala * s.aspekt, skala, 1);
      s.m.material.opacity = Math.max(0, alpha);
      const sek = tid - s.t0;
      s.m.position.x = s.x + (s.vx || 0) * sek;
      s.m.position.y = s.y + (s.vy || 0) * sek - 0.5 * (s.g || 0) * sek * sek;
      if (s.spin) s.m.rotation.z += s.spin * dt;
    }
  }

  const ORD = ['POW!', 'BANG!', 'BOOM!'];

  // Eksplosionen er tegneseriemodellen (objekt_view.js): 20 frames — glimt,
  // ildkugle og en sortkantet røgsky, der stiger og går i stykker. Puljede
  // quads med hver sin geometri, fordi framen sidder i quad'ens uv'er.
  const EKS_TID = 0.7;
  const anim = [];
  const animPulje = [];
  function eksAnim(x, y, str) {
    if (!hent('obj_eksplosion')) return;
    let m = animPulje.pop();
    if (!m) {
      m = objektMesh('eksplosion', 1, Z.fx + 2, { midt: true });
      m.material.depthTest = false;
      spriteGruppe.add(m);
    }
    m.visible = true;
    m.position.set(x, y, 0.3);
    // Tegningen er ~80 % af Kenney-billedets flade; lyset kommer fra øverst
    // til venstre som på kunderne, så den drejes kun en anelse.
    m.scale.set(str * 0.8, str * 0.8, 1);
    m.rotation.z = (rngFx() - 0.5) * 0.3;
    saetFrame(m, 0);
    anim.push({ m, t0: tid });
  }
  function opdaterAnim() {
    for (let i = anim.length - 1; i >= 0; i--) {
      const a = anim[i];
      const f = eksplosionFrame((tid - a.t0) / EKS_TID);
      if (f < 0) { a.m.visible = false; animPulje.push(a.m); anim.splice(i, 1); continue; }
      saetFrame(a.m, f);
    }
  }

  // ---- stråler: puljede, strakte quads med rullende tekstur (additive)
  const straaler = [];
  const straalePulje = [];
  function straaleMesh(farveNavn, x0, y0, x1, y1, o) {
    let m = straalePulje.pop();
    if (!m) {
      const g = new PlaneGeometry(1, 1);
      g.translate(0.5, 0, 0);                 // x i [0, 1]: strålen starter i origo
      m = new Mesh(g, new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false,
                                              blending: AdditiveBlending }));
      m.renderOrder = Z.fx + 1.5;
      spriteGruppe.add(m);
    }
    const tex = straaleTex(farveNavn);
    if (m.material.map !== tex) { m.material.map = tex; m.material.needsUpdate = true; }
    const dx = x1 - x0, dy = y1 - y0;
    m.position.set(x0, y0, 0.25);
    m.rotation.z = Math.atan2(dy, dx);
    m.visible = true;
    straaler.push({ m, t0: tid, laengde: Math.max(1, Math.hypot(dx, dy)), varighed: 0.42, tyk: 10,
                    a: 1, rul: 5, ud: 0.05, ...o });
  }
  function opdaterStraaler() {
    for (let i = straaler.length - 1; i >= 0; i--) {
      const s = straaler[i];
      const t = tid - s.t0;
      if (t >= s.varighed) { s.m.visible = false; straalePulje.push(s.m); straaler.splice(i, 1); continue; }
      // Skyder ud på et splitsekund, blusser og bliver så tyndere, mens den falmer.
      const L = s.laengde * Math.min(1, t / s.ud);
      const tyk = t < 0.08 ? 1.5 - (t / 0.08) * 0.5 : Math.max(0.15, 1 - (t - 0.08) / (s.varighed - 0.08) * 0.85);
      s.m.scale.set(Math.max(0.01, L), s.tyk * tyk, 1);
      s.m.material.opacity = s.a * (t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / (s.varighed - 0.15)));
      const uv = s.m.geometry.attributes.uv;
      const u0 = -tid * s.rul, u1 = u0 + L / 22;
      uv.setX(0, u0); uv.setX(2, u0); uv.setX(1, u1); uv.setX(3, u1);
      uv.needsUpdate = true;
    }
  }

  // ---- fakturaregn: puljede fakturaer, der daler og vender sig i luften
  const fakturaGruppe = new Group();
  fakturaGruppe.position.z = Z.projektiler - 1;       // bag de rigtige projektiler
  scene.add(fakturaGruppe);
  const fakturaer = [];
  const fakturaPulje = [];
  let fakturaGeo = null;
  function fakturaMesh() {
    let m = fakturaPulje.pop();
    if (!m) {
      if (!fakturaGeo) {
        const mo = vaabenMaal('faktura');
        fakturaGeo = new PlaneGeometry(mo.bredde, mo.hoejde);
        fakturaGeo.translate(-mo.midtX, -mo.midtY, 0);
      }
      m = new Mesh(fakturaGeo, new MeshBasicMaterial({ map: klisterTex('faktura'), transparent: true,
                                                        depthTest: true, depthWrite: false }));
      m.renderOrder = Z.projektiler - 1;
      fakturaGruppe.add(m);
    }
    return m;
  }
  function opdaterFakturaer() {
    for (let i = fakturaer.length - 1; i >= 0; i--) {
      const f = fakturaer[i], m = f.m;
      const t = tid - f.t0;
      if (t < 0) { m.visible = false; continue; }
      if (t >= f.liv) { m.visible = false; fakturaPulje.push(m); fakturaer.splice(i, 1); continue; }
      m.visible = true;
      m.position.set(f.x0 + f.drift * t + Math.sin(t * f.frek + f.fase) * f.amp, f.y0 - f.fald * t, 0);
      m.rotation.z = Math.sin(t * f.frek * 0.9 + f.fase) * 0.55 + f.spin * t;
      // Arket vender sig: bredden svinger, som når papir flagrer.
      m.scale.set(f.str * (0.25 + 0.75 * Math.abs(Math.cos(t * f.flip + f.fase))), f.str, 1);
      m.material.opacity = Math.max(0, Math.min(1, t / 0.2, (f.liv - t) / 0.7));
    }
  }

  const skaermTop = () => (kamera ? kamera.position.y + kamera.top : 1000);

  const fxApi = {
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

    /**
     * En stråle fra (x0,y0) til nedslaget (x1,y1). o.farve: 'roed'
     * (Stregkodescanneren) eller 'blaa' (Tvangsopdateringen); o.traf: ramte
     * den en kunde (større nedslag, ring og gnister). Ord (BIP!) kaldes
     * separat med pop().
     */
    straale(x0, y0, x1, y1, o = {}) {
      const f = FARVE[o.farve] !== undefined ? o.farve : 'roed';
      const hex = FARVE[f], kol = GLOED[f];
      const traf = !!o.traf;
      straaleMesh(f, x0, y0, x1, y1, { tyk: f === 'blaa' ? 13 : 10, rul: f === 'blaa' ? 7 : 4 });
      straaleMesh(f, x0, y0, x1, y1, { tyk: 30, a: 0.3, rul: 0 });           // bred glød omkring
      sprite('glimt', x0, y0, { varighed: 0.12, s0: 18, s1: 34, a0: 1, hold: 0.3, farve: hex, additiv: true,
                                rot: rngFx() * 6.28 });
      sprite('glimt', x1, y1, { varighed: 0.2, s0: traf ? 30 : 16, s1: traf ? 66 : 34, a0: 1, hold: 0.25,
                                farve: hex, additiv: true, rot: rngFx() * 6.28, z: 0.3 });
      sprite(null, x1, y1, { tex: gloedTex(), varighed: 0.35, s0: 20, s1: traf ? 80 : 44, a0: 0.9, hold: 0.2,
                             farve: hex, additiv: true });
      if (traf) sprite('ring', x1, y1, { varighed: 0.35, s0: 10, s1: 74, a0: 0.9, hold: 0.1, farve: hex, additiv: true });
      const n = traf ? 24 : 10;
      for (let i = 0; i < n; i++) {
        const a = rngFx() * Math.PI * 2, v = 80 + rngFx() * 200;
        spawn(x1, y1, Math.cos(a) * v, Math.sin(a) * v, 0.25 + rngFx() * 0.25, 5 + rngFx() * 5, 3, kol);
      }
      for (let i = 0; i < (traf ? 8 : 4); i++) {
        const a = rngFx() * Math.PI * 2, v = 120 + rngFx() * 160;
        spawn(x1, y1, Math.cos(a) * v, Math.sin(a) * v, 0.16, 6, 1);
      }
      if (!traf) for (let i = 0; i < 6; i++) {
        const a = -Math.PI * rngFx(), v = 80 + rngFx() * 120;
        spawn(x1, y1, Math.cos(a) * v, Math.abs(Math.sin(a)) * v, 0.5 + rngFx() * 0.3, 3 + rngFx() * 3, 2);
      }
    },

    /** Et tegneserieord, der popper op (BIP!, ISOLERET!, GENSTART!, SMITTET!).
     *  o.farve: gul | roed | blaa | groen | cyan | hvid; o.str: højde i wu. */
    pop(tekst, x, y, o = {}) {
      const tex = popTex(String(tekst), o.farve || 'gul');
      sprite(null, x, y, { tex, aspekt: tex.userData.aspekt, varighed: o.varighed || 1.1, s1: o.str || 40,
                           pop: true, vy: o.vy ?? 24, rot: o.rot ?? (rngFx() - 0.5) * 0.2, z: 0.4 });
    },

    /** Klageklasket: KLASK!, et glimt og tegneseriestjerner, der flyver fra
     *  nedslaget i slagets retning. (x, y) er nedslaget. */
    klask(x, y, retning = 1) {
      const r = retning >= 0 ? 1 : -1;
      fxApi.pop('KLASK!', x + r * 10, y + 32, { str: 50, rot: -0.14 * r, vy: 18 });
      sprite('glimt', x, y, { varighed: 0.16, s0: 26, s1: 64, a0: 1, hold: 0.3, rot: rngFx() * 6.28, z: 0.3 });
      sprite('ring', x, y, { varighed: 0.3, s0: 10, s1: 66, a0: 0.8, hold: 0.1 });
      for (let i = 0; i < 7; i++) {
        const a = (r > 0 ? 0 : Math.PI) + (rngFx() - 0.5) * 1.7, v = 90 + rngFx() * 130;
        sprite(null, x, y, { tex: stjerneTex(), varighed: 0.55 + rngFx() * 0.25, s0: 8, s1: 8 + rngFx() * 5,
                             a0: 1, hold: 0.65, vx: Math.cos(a) * v, vy: Math.abs(Math.sin(a)) * v + 110,
                             g: 420, spin: (rngFx() - 0.5) * 14, rot: rngFx() * 6.28, z: 0.35 });
      }
      for (let i = 0; i < 12; i++) {
        const a = (r > 0 ? 0 : Math.PI) + (rngFx() - 0.5) * 1.4, v = 140 + rngFx() * 200;
        spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.18, 8, 1);
      }
    },

    /** Fjernsupport: lyssøjler og et sus af partikler i begge ender. */
    teleport(fraX, fraY, x, y) {
      for (const [px, py] of [[fraX, fraY], [x, y]]) {
        straaleMesh('cyan', px, py - 4, px, py + 150, { tyk: 34, varighed: 0.7, rul: 0, ud: 0.08 });
        straaleMesh('cyan', px, py - 4, px, py + 110, { tyk: 12, varighed: 0.55, rul: 0, ud: 0.06 });
        sprite('glimt', px, py + 22, { varighed: 0.25, s0: 30, s1: 80, a0: 1, hold: 0.3,
                                       farve: FARVE.cyan, additiv: true, rot: rngFx() * 6.28 });
        sprite('ring', px, py + 4, { varighed: 0.45, s0: 12, s1: 86, a0: 0.9, hold: 0.1,
                                     farve: FARVE.cyan, additiv: true });
        for (let i = 0; i < 26; i++) {
          spawn(px + (rngFx() - 0.5) * 28, py + rngFx() * 40, (rngFx() - 0.5) * 20, 70 + rngFx() * 150,
                0.5 + rngFx() * 0.5, 5 + rngFx() * 6, 3, GLOED.cyan);
        }
      }
    },

    /** Hjemmearbejde tændes: en ring, der udvider sig, og en der trækker sig
     *  sammen om boblen. (x, y) er kundens fødder. */
    skjoldOp(x, y) {
      const cy = y + 23;
      sprite('ring', x, cy, { varighed: 0.45, s0: 16, s1: 92, a0: 0.95, hold: 0.15, farve: FARVE.cyan, additiv: true });
      sprite('ring', x, cy, { varighed: 0.35, s0: 130, s1: 66, a0: 0.8, hold: 0.4, farve: FARVE.cyan, additiv: true });
      sprite(null, x, cy, { tex: gloedTex(), varighed: 0.45, s0: 30, s1: 96, a0: 0.7, hold: 0.2,
                            farve: FARVE.cyan, additiv: true });
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        spawn(x + c * 32, cy + s * 32, -s * 60 + c * 40, c * 60 + s * 40, 0.45 + rngFx() * 0.3,
              5 + rngFx() * 4, 3, GLOED.cyan);
      }
    },

    /** Skjoldet tager et slag: blitz og splinter fra boblen. (x, y) er fødderne. */
    skjoldBlok(x, y) {
      const cy = y + 23;
      sprite('glimt', x, cy, { varighed: 0.16, s0: 30, s1: 72, a0: 1, hold: 0.3, farve: 0xBFF8FF,
                               additiv: true, rot: rngFx() * 6.28 });
      sprite('ring', x, cy, { varighed: 0.3, s0: 52, s1: 88, a0: 1, hold: 0.15, farve: FARVE.cyan, additiv: true });
      for (let i = 0; i < 18; i++) {
        const a = rngFx() * Math.PI * 2, v = 120 + rngFx() * 120;
        spawn(x + Math.cos(a) * 30, cy + Math.sin(a) * 30, Math.cos(a) * v, Math.sin(a) * v,
              0.3 + rngFx() * 0.2, 5 + rngFx() * 4, 3, GLOED.cyan);
      }
      for (let i = 0; i < 8; i++) {
        const a = rngFx() * Math.PI * 2, v = 160 + rngFx() * 140;
        spawn(x, cy, Math.cos(a) * v, Math.sin(a) * v, 0.16, 6, 1);
      }
    },

    /**
     * Kvartalsopkrævningen: dekorative fakturaer, der daler ned fra over
     * skærmen i ca. 4 s omkring x. oeverst: verdens-y for skærmens top
     * (ellers kameraets, hvis lavFx fik det).
     */
    fakturaRegn(x, retning = 1, oeverst = null) {
      const top = oeverst ?? skaermTop();
      const r = retning >= 0 ? 1 : -1;
      for (let i = 0; i < 26 && fakturaer.length < 90; i++) {
        fakturaer.push({ m: fakturaMesh(), t0: tid + i * 0.06 + rngFx() * 0.12, liv: 3.2 + rngFx() * 1.0,
          x0: x + (rngFx() - 0.5) * 560 - r * 40, y0: top + 20 + rngFx() * 160,
          fald: 110 + rngFx() * 90, drift: r * (10 + rngFx() * 25), amp: 10 + rngFx() * 22,
          frek: 1.6 + rngFx() * 1.4, fase: rngFx() * 6.28, str: 1.15 + rngFx() * 0.6,
          flip: 3 + rngFx() * 3, spin: (rngFx() - 0.5) * 1.2 });
      }
    },

    /** Systemnedbrud: jord, støv og en gnist ved borespidsen (x, y); (dx, dy)
     *  er borets retning. Kaldes hver frame, mens der bores. */
    boreStoev(x, y, dx = 0, dy = -1) {
      const bag = Math.atan2(-dy, -dx);
      const n = rngFx() < 0.6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = bag + (rngFx() - 0.5) * 1.8, v = 60 + rngFx() * 140;
        spawn(x + (rngFx() - 0.5) * 6, y + (rngFx() - 0.5) * 6, Math.cos(a) * v, Math.sin(a) * v + 80,
              0.45 + rngFx() * 0.35, 3 + rngFx() * 4, 2);
      }
      if (rngFx() < 0.35) {
        spawn(x + (rngFx() - 0.5) * 10, y + (rngFx() - 0.5) * 10, (rngFx() - 0.5) * 30, 12 + rngFx() * 24,
              0.6 + rngFx() * 0.5, 12 + rngFx() * 10, 3, GLOED.stoev);
      }
      if (rngFx() < 0.12) spawn(x, y, (rngFx() - 0.5) * 160, 40 + rngFx() * 120, 0.18, 5, 1);
    },

    /** COVID: en grøn virussky med radius r omkring nedslaget. */
    covidSky(x, y, r = 70) {
      sprite('ring', x, y, { varighed: 0.6, s0: 12, s1: r * 2.1, a0: 0.8, hold: 0.15, farve: FARVE.groen, additiv: true });
      sprite(null, x, y, { tex: gloedTex(), varighed: 1.4, s0: r * 0.8, s1: r * 2.4, a0: 0.5, hold: 0.25,
                           farve: FARVE.groen, additiv: true });
      for (let i = 0; i < 46; i++) {
        const a = rngFx() * Math.PI * 2, d = Math.sqrt(rngFx()) * r;
        spawn(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, Math.cos(a) * (10 + rngFx() * 30),
              Math.sin(a) * 20 + 10 + rngFx() * 20, 1.1 + rngFx() * 0.9, r * (0.35 + rngFx() * 0.4), 3,
              [0.45 + rngFx() * 0.12, 0.8 + rngFx() * 0.1, 0.34, 0.42]);
      }
      const vtex = klisterTex('virus');
      if (vtex) for (let i = 0; i < 8; i++) {
        const a = rngFx() * Math.PI * 2, v = 40 + rngFx() * 60;
        sprite(null, x, y, { tex: vtex, aspekt: 2, varighed: 1.1 + rngFx() * 0.5, s0: 6, s1: 12 + rngFx() * 6,
                             a0: 1, hold: 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 20,
                             spin: (rngFx() - 0.5) * 6, z: 0.3 });
      }
    },

    // ---- småeffekter, som projektilvisningen kalder pr. frame
    /** Gnist fra en brændende lunte. */
    lunteGnist(x, y) { spawn(x, y, (rngFx() - 0.5) * 50, 30 + rngFx() * 70, 0.22 + rngFx() * 0.2, 3.5 + rngFx() * 3, 1); },
    /** Et 0 eller 1, der siver ud af Datalæk-bomben. */
    bitLaek(x, y) {
      const tex = popTex(rngFx() < 0.5 ? '0' : '1', 'groen');
      sprite(null, x + (rngFx() - 0.5) * 10, y + (rngFx() - 0.5) * 10, { tex, aspekt: tex.userData.aspekt,
        varighed: 0.9, s0: 5, s1: 7.5, a0: 0.95, hold: 0.5, vx: (rngFx() - 0.5) * 26, vy: 14 + rngFx() * 20,
        rot: (rngFx() - 0.5) * 0.6, z: 0.1 });
    },
    /** Tonerstøv bag tonerpatronen. */
    tonerSpor(x, y) {
      spawn(x, y, (rngFx() - 0.5) * 12, (rngFx() - 0.5) * 12 + 6, 0.6 + rngFx() * 0.3, 8 + rngFx() * 5, 3, GLOED.toner);
    },
    /** Flammer fra en brændende tast (Integrations inferno). */
    ildSpor(x, y) {
      spawn(x, y, (rngFx() - 0.5) * 30, 10 + rngFx() * 30, 0.25 + rngFx() * 0.2, 6 + rngFx() * 4, 1);
      if (rngFx() < 0.3) spawn(x, y, (rngFx() - 0.5) * 10, 16, 0.6, 9, 0);
    },
    /** Grønt slør bag en flyvende virus. */
    virusSpor(x, y) {
      spawn(x + (rngFx() - 0.5) * 4, y + (rngFx() - 0.5) * 4, (rngFx() - 0.5) * 16, (rngFx() - 0.5) * 16,
            0.5 + rngFx() * 0.3, 6 + rngFx() * 4, 3, GLOED.groen);
    },

    opdater(dt, pixelPrWu = 1) {
      tid += dt; mat.uniforms.uTid.value = tid;
      // Punktstørrelser er i pixels; skalér dem med zoom, så de følger verden.
      mat.uniforms.uSkala.value = pixelPrWu;
      opdaterSprites(dt);
      opdaterAnim();
      opdaterStraaler();
      opdaterFakturaer();
    },
    fjern() {
      scene.remove(punkter); geo.dispose(); mat.dispose();
      scene.remove(spriteGruppe); scene.remove(fakturaGruppe);
      for (const m of [...pulje, ...aktive.map((a) => a.m)]) m.material.dispose();
      for (const a of [...animPulje, ...anim.map((x) => x.m)]) { a.geometry?.dispose?.(); a.material?.dispose?.(); }
      for (const m of [...straalePulje, ...straaler.map((s) => s.m)]) { m.geometry.dispose(); m.material.dispose(); }
      for (const m of [...fakturaPulje, ...fakturaer.map((f) => f.m)]) m.material.dispose();
      fakturaGeo?.dispose();
    },
  };
  return fxApi;
}

/* ------------------------------------------------- projektiler og genstande */

/** fx (valgfri): lavFx-objektet — til gnister, spor og datalæk-cifre. */
export function lavProjektilView(scene, fx = null) {
  const gruppe = new Group();
  gruppe.position.z = Z.projektiler;
  scene.add(gruppe);
  const brugt = new Map();

  /* Simulationens spritenavne -> tematiske modeller. Størrelserne kommer
     fra kunst.VAABEN_STR, ligesom tingene i hånden.
       drejer   peger i flyveretningen     klister  hvid klistermærkekant
       flagrer  daler og vender sig        spor     partikler bag sig
       loeft    hvor meget midten løftes, når den ligger stille (wu) */
  const KUGLE = {
    gren:    { tegn: 'tonerpatron', drejer: true, spor: 'toner' },   // Tonerkanon
    bombe:   { tegn: 'bombe', bombe: true },                         // Datalæk-bomben
    kogle:   { tegn: 'tastatur' },                                   // Integrations inferno
    'frø':   { tegn: 'tast', spor: 'ild' },                          // brændende løse taster
    faktura: { tegn: 'faktura', klister: true, flagrer: true, skala: 1.3 },   // Kvartalsopkrævning
    virus:   { tegn: 'virus', klister: true, virus: true, loeft: 4.5 },     // COVID
    sten:    { billede: 'mursten', b: 16 },                          // "mursten fra loftet"
    papir:   { tegn: 'papirbunke', drejer: true },                   // Papirbunke
  };
  KUGLE.agern = KUGLE.bombe;          // spritenavne fra før omdøbningen
  KUGLE.stamme = KUGLE.faktura;

  /** Datalæk-bomben: kuglen drejer om sin midte, gnisten sidder på lunten, og
   *  nedtællingen står oven over (drejer ikke med). */
  function lavBombe() {
    const g = new Group();
    const maal = vaabenMaal('bombe'), P = TEGNE_PUNKTER.bombe;
    const s = maal.bredde / 256;                     // wu pr. lærredspixel
    const geo = new PlaneGeometry(maal.bredde, maal.hoejde);
    geo.translate((128 - P.midt[0]) * s, (P.midt[1] - 64) * s, 0);
    const krop = new Mesh(geo, new MeshBasicMaterial({ map: klisterTex('bombe'), transparent: true,
                                                       depthTest: true, depthWrite: false }));
    krop.renderOrder = Z.projektiler;
    g.add(krop);
    const gnist = gloedQuad(0xFFB347, Z.projektiler + 0.5, false);
    gnist.position.set((P.lunte[0] - P.midt[0]) * s, (P.midt[1] - P.lunte[1]) * s, 0.1);
    krop.add(gnist);
    const tal = new Mesh(ENHED, new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    tal.renderOrder = Z.fx - 0.5;
    tal.visible = false;
    g.add(tal);
    g.userData = { krop, gnist, tal, r: P.r * s, spids: [gnist.position.x, gnist.position.y], sek: -1 };
    return g;
  }

  function lavMesh(k) {
    if (k.bombe) return lavBombe();
    if (k.tegn) {
      const m = haandQuad(k.tegn, Z.projektiler);
      if (k.klister) m.material.map = klisterTex(k.tegn);
      return m;
    }
    if (k.billede) {
      const m = billedQuad(k.billede, k.b, Z.projektiler);
      if (m) return m;
    }
    return new Mesh(genGeoFor('sten'), genMat());
  }

  return {
    opdater(liste) {
      const t = performance.now() / 1000;
      const set = new Set();
      for (const p of liste) {
        set.add(p.id);
        const k = KUGLE[p.sprite] || KUGLE.gren;
        let post = brugt.get(p.id);
        if (!post) {
          post = { m: lavMesh(k), rot: 0, loeft: 0, px: p.x, bit: 0 };
          brugt.set(p.id, post); gruppe.add(post.m);
        }
        const m = post.m;
        const dx = p.x - post.px;
        post.px = p.x;

        if (k.bombe) {
          const u = m.userData;
          // Kuglen triller: den drejer med den strækning, den har rullet.
          if (!p.sover) post.rot -= Math.max(-0.35, Math.min(0.35, dx / Math.max(1, u.r)));
          else post.rot += (Math.round(post.rot / (Math.PI * 2)) * Math.PI * 2 - post.rot) * 0.08;  // retter sig op
          u.krop.rotation.z = post.rot;
          // Simulationen regner bomben som et punkt; løft den, så den ikke ligger halvt i jorden.
          post.loeft += ((p.sover ? u.r : u.r * 0.5) - post.loeft) * 0.2;
          m.position.set(p.x, p.y + post.loeft, 0);
          const f = 0.7 + Math.random() * 0.6;
          u.gnist.scale.set(9 * f, 9 * f, 1);
          u.gnist.material.opacity = 0.7 + Math.random() * 0.3;
          if (fx) {
            const c = Math.cos(post.rot), s = Math.sin(post.rot);
            const gx = m.position.x + u.spids[0] * c - u.spids[1] * s;
            const gy = m.position.y + u.spids[0] * s + u.spids[1] * c;
            if (Math.random() < 0.7) fx.lunteGnist(gx, gy);
            if (t - post.bit > 0.11) { post.bit = t; fx.bitLaek(m.position.x, m.position.y); }
          }
          // Nedtællingen fra lunten (tick tilbage), rød i det sidste sekund.
          const sek = p.lunte > 0 ? Math.ceil(p.lunte / 60) : 0;
          if (sek !== u.sek) {
            u.sek = sek;
            u.tal.visible = sek > 0;
            if (sek > 0) {
              const tx = popTex(String(sek), sek <= 1 ? 'roed' : 'gul');
              u.tal.material.map = tx; u.tal.material.needsUpdate = true;
              u.tal.scale.set(12 * tx.userData.aspekt, 12, 1);
            }
          }
          u.tal.position.set(0, u.r + 13 + (sek === 1 ? Math.abs(Math.sin(t * 9)) * 2.5 : 0), 0);
          continue;
        }

        post.loeft += ((p.sover ? (k.loeft || 0) : 0) - post.loeft) * 0.2;
        m.position.x = p.x;                 // interpoleret af klienten
        m.position.y = p.y + post.loeft;
        if (k.drejer) {
          if (p.vx !== undefined && (p.vx || p.vy)) m.rotation.z = Math.atan2(p.vy, p.vx);
        } else if (k.flagrer) {
          // Fakturaen flagrer: vipper frem og tilbage og vender sig.
          m.rotation.z = Math.sin(t * 6 + p.id) * 0.5;
          m.scale.set((k.skala || 1) * (0.35 + 0.65 * Math.abs(Math.cos(t * 4.5 + p.id))), k.skala || 1, 1);
        } else if (!p.sover) {
          post.rot -= (p.vx || 0) * 0.0025 + (k.billede ? 0.04 : 0) + (k.virus ? 0.05 : 0);
          m.rotation.z = post.rot;
        }
        if (k.virus) m.scale.setScalar(1 + 0.07 * Math.sin(t * 10 + p.id));
        if (fx && !p.sover) {
          if (k.spor === 'toner' && Math.random() < 0.8) {
            const a = m.rotation.z;
            fx.tonerSpor(p.x - Math.cos(a) * 6, p.y - Math.sin(a) * 6);
          } else if (k.spor === 'ild' && Math.random() < 0.6) fx.ildSpor(p.x, p.y);
          else if (k.virus && Math.random() < 0.5) fx.virusSpor(p.x, p.y);
        }
      }
      for (const [id, post] of brugt) {
        if (!set.has(id)) { smid(post.m); brugt.delete(id); }
      }
    },
    fjern() { for (const [, post] of brugt) smid(post.m); brugt.clear(); scene.remove(gruppe); },
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
  _skiltTex = lerredTex(c);
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
  _ringTex = lerredTex(c);
  return _ringTex;
}
/* Minens udløsningsradius følger våbentabellen (placeret.naerhed), så ringen
 * på jorden altid viser den rigtige afstand. */
const MINE_RADIUS = VAABEN.baevermine?.placeret?.naerhed ?? 42;
const MINE_BREDDE = 27;          // mailens bredde i wu — tre gange den gamle, så den ses
/* Genstandenes tegneseriemodeller (objekt_view.js) og deres bredde i wu. */
const OBJ = {
  telefon: ['bordtelefon', 30], piller: ['pilleglas', 17], vaaben: ['vaerktoejskasse', 34],
  hjaelp: ['svaevepille', 22], skaerm: ['faldskaerm', 56], printer: ['printer', 34],
  opdatering: ['tvangsopdatering', 26], gravsten: ['gravsten', 24],
};
/* Phishing-minens "!"-mærke i modellens celle (px, 128-cellen): her sidder lampen. */
const MINE_MAERKE = [97, 76];
/** Tick til minen er armeret: fra deltaet (armerRest), ellers regnet fra
 *  snapshottets felter som i simulationen. 0 = armeret (også banens miner). */
const armerRest = (p) => p.armerRest ?? simArmerRest(p);
const tilbage = (a) => 1 + 2.7 * Math.pow(a - 1, 3) + 1.7 * Math.pow(a - 1, 2);   // pop med overskud

export function lavGenstandView(scene) {
  const gruppe = new Group();
  gruppe.position.z = Z.genstande;
  scene.add(gruppe);
  const brugt = new Map();
  function lavTelefon() {
    const g = new Group();
    const m = objektMesh(...OBJ.telefon, Z.genstande);
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
    const glas = objektMesh(...OBJ.piller, Z.genstande);
    g.add(glas); g.userData.krop = glas;
    g.userData.glasH = objektMaal(...OBJ.piller).hoejde;
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
    // Supportpakken er klinikkens værktøjskasse; svævepillen har små vinger.
    const [navn, bredde] = slags === 'hjaelp' ? OBJ.hjaelp : OBJ.vaaben;
    const kasse = objektMesh(navn, bredde, Z.genstande);
    g.add(kasse);
    // Faldskærmens snore samles lige over kassen.
    const skaerm = objektMesh(...OBJ.skaerm, Z.genstande - 0.2);
    skaerm.position.y = objektMaal(navn, bredde).top - 2;
    g.add(skaerm);
    Object.assign(g.userData, { krop: kasse, skaerm, landetT: null });
    return g;
  }

  function lavMine() {
    // Phishing-minen: en stor, uskyldig mail. Mens den armeres, blinker den
    // i takt med nedtællingen; armeret lyser den rødt og konstant.
    const g = new Group();
    const mo = objektMaal('phishing_mine', MINE_BREDDE);
    const hoejde = mo.hoejde;
    const gloed = gloedQuad(0xFF4A2C, Z.genstande - 0.5);
    gloed.scale.set(MINE_BREDDE * 2.6, hoejde * 2.5, 1);
    gloed.position.set(0, hoejde * 0.5, 0);
    g.add(gloed);
    const m = objektMesh('phishing_mine', MINE_BREDDE, Z.genstande);
    g.add(m);
    // Lampen over mailens røde "!"-mærke (MINE_MAERKE i modellens celle).
    const lampe = gloedQuad(0xFF6A4A, Z.genstande + 0.5, false);
    const [x0, , x1] = objektIndhold('phishing_mine');
    lampe.position.set((MINE_MAERKE[0] - (x0 + x1) / 2) * mo.s, (OBJEKT_FOD - MINE_MAERKE[1]) * mo.s, 0.1);
    lampe.scale.setScalar(26 * mo.s);
    g.add(lampe);
    // Ringen viser, hvor tæt man kan komme, før den går af.
    const ring = new Mesh(new PlaneGeometry(MINE_RADIUS * 2.1, MINE_RADIUS * 0.55),
      new MeshBasicMaterial({ map: ringTex(), transparent: true, depthTest: false, depthWrite: false }));
    ring.position.y = 1; ring.renderOrder = Z.fx - 1;
    g.add(ring);
    const skilt = new Mesh(new PlaneGeometry(26, 26),
      new MeshBasicMaterial({ map: skiltTex(), transparent: true, depthTest: false, depthWrite: false }));
    skilt.renderOrder = Z.fx - 0.5;
    g.add(skilt);
    // Nedtællingens ciffer står, hvor skiltet står, indtil minen er armeret.
    const tal = new Mesh(ENHED, new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    tal.renderOrder = Z.fx - 0.5; tal.visible = false;
    g.add(tal);
    Object.assign(g.userData, { mine: true, krop: m, gloed, lampe, ring, skilt, tal, hoejde, sek: -1, foedt: null });
    return g;
  }

  function lavPlaceret(sprite) {
    if (sprite === 'mine') return lavMine();
    const g = new Group();
    g.userData.navn = sprite;
    if (sprite === 'toende') {
      // Printeren: sprænges den (eller rammes den direkte), går den af med et brag.
      const m = objektMesh(...OBJ.printer, Z.genstande);
      g.add(m); g.userData.krop = m; g.userData.printer = true;
    } else {
      // Ukendt udlagt ting: den blå opdateringsboks med tændt lunte (gnisten
      // er en del af modellen).
      const m = objektMesh(...OBJ.opdatering, Z.genstande);
      g.add(m); g.userData.krop = m; g.userData.opdatering = true;
    }
    return g;
  }

  function lavGravsten() {
    const g = new Group();
    const m = objektMesh(...OBJ.gravsten, Z.genstande);
    g.add(m); g.userData.krop = m;
    return g;
  }

  function opdaterMine(m, p, t) {
    const u = m.userData;
    const rest = armerRest(p);
    const armeret = rest <= 0;
    const sek = mineSekund(rest);
    // Blinket tænder i det øjeblik, sekundet skifter — samme takt som bippet.
    const blink = !armeret && ((rest - 1) % 60) >= 45;
    const taendt = armeret || blink;
    // Armeret: mærket lyser stille (idle_2). Blinket: mærket lyser og mailen
    // ryster (aktiv_0). Ellers ligger den uskyldigt i tomgang.
    saetFrame(u.krop, armeret ? 'idle_2' : blink ? 'aktiv_0' : 'idle_0');
    u.gloed.material.opacity = armeret ? 0.8 : blink ? 0.75 : 0.12;
    u.lampe.visible = taendt;
    u.ring.material.opacity = armeret ? 0.85 : 0.2 + (blink ? 0.45 : 0);
    if (armeret) {
      u.tal.visible = false; u.skilt.visible = true;
      u.skilt.position.set(0, u.hoejde + 16 + Math.sin(t * 2 + p.id) * 1.2, 0);
    } else {
      u.skilt.visible = false; u.tal.visible = true;
      if (sek !== u.sek) {
        u.sek = sek;
        const tx = popTex(String(sek), sek <= 1 ? 'roed' : 'gul');
        u.tal.material.map = tx; u.tal.material.needsUpdate = true;
        u.tal.userData.aspekt = tx.userData.aspekt;
      }
      const s = 20 * (blink ? 1.18 : 1);
      u.tal.scale.set(s * (u.tal.userData.aspekt || 1), s, 1);
      u.tal.position.set(0, u.hoejde + 16, 0);
    }
    // Popper op, når den bliver lagt.
    if (u.foedt === null) u.foedt = t;
    const a = Math.min(1, (t - u.foedt) / 0.22);
    m.scale.setScalar(a < 1 ? Math.max(0.05, 0.6 + 0.4 * tilbage(a)) : 1);
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
          animer(u.krop, 'idle', t + k.id * 0.37);
          continue;
        }
        if (m.userData.telefon) {
          // Ringer den, hopper den på gaflen, og "RING!" popper op.
          const ringer = telefonRinger(k.id, t);
          const u = m.userData;
          animer(u.krop, ringer ? 'aktiv' : 'idle', t + k.id * 0.37, ringer ? 1.6 : 1);
          u.skilt.visible = ringer;
          u.skilt.position.set(0, 42 + Math.sin(t * 6) * 2, 0);
          u.skilt.scale.setScalar(1 + 0.12 * Math.abs(Math.sin(t * 12)));
          u.ring.material.opacity = ringer ? 0.55 + 0.45 * Math.abs(Math.sin(t * 8)) : 0.25;
          continue;
        }
        // I luften: kassen i fald, skærmen svajer. Ved landingen squasher
        // kassen, og skærmen klapper sammen, før den forsvinder.
        const u = m.userData;
        if (!k.landet) {
          u.landetT = null;
          animer(u.krop, 'fald', t + k.id);
          animer(u.skaerm, 'idle', t + k.id);
          u.skaerm.visible = true;
          m.rotation.z = Math.sin(t * 1.6 + k.id) * 0.06;
        } else {
          if (u.landetT === null) u.landetT = t;
          const efter = t - u.landetT;
          animer(u.krop, efter < 0.25 ? 'land' : 'idle', efter < 0.25 ? efter : t + k.id);
          u.skaerm.visible = efter < 0.45;
          if (u.skaerm.visible) animer(u.skaerm, 'land', efter, 0.7);
          m.rotation.z = 0;
        }
      }
      for (const p of placerede) {
        set.add('p' + p.id);
        let m = brugt.get('p' + p.id);
        if (!m) { m = lavPlaceret(p.sprite); brugt.set('p' + p.id, m); gruppe.add(m); }
        m.position.set(p.x, p.y, 0);
        if (m.userData.mine) { opdaterMine(m, p, t); continue; }
        if (m.userData.printer) {
          // PAPIRSTOP-lampen blinker, og printeren ryster en anelse.
          animer(m.userData.krop, 'aktiv', t + p.id * 0.5, 0.5);
        }
        // Lunten gnistrer: tomgangens fire gnist-frames i højt tempo.
        if (m.userData.opdatering) animer(m.userData.krop, 'idle', t + p.id, 3);
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
        animer(u.krop, 'idle', t + g.id);
      }
      for (const [id, m] of brugt) {
        if (!set.has(id)) { smid(m); brugt.delete(id); }
      }
    },
    fjern() {
      for (const [, m] of brugt) smid(m);
      brugt.clear();
      scene.remove(gruppe);
    },
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
