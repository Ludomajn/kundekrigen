/* Kundekrigen — enhederne som FIGURER: de 22 tegneseriekunder.
 *
 * Kunderne er brugerens egne figurer (Assets/Cartoon Characters, bygget på
 * rgsdev's Cartoon Character Generator) med tyk sort kontur og færdigtegnede
 * frames: tomgang, løb, hop, angreb og død. 1-16 er de almindelige kunder
 * (45-55 år i kontor- og lægehustøj); 17-22 er personalet på Klinik
 * Højhaven og Speciallægeselskabet Mogensen (se core/klinikker.js). vaerktoej/
 * tegneseriekunder.py har pakket kroppens 20 frames i ét atlas pr. kunde,
 * klippet en ren knytnæve ud og fundet hændernes plads i hver frame.
 *
 * Kroppen er frame-animation i figurernes egen stil. Hænderne er løse, så
 * den forreste kan holde spillets IT-våben og følge sigtet; resten af tiden
 * følger begge hænder animationens egne håndpositioner.
 *
 * Holdet ses på navneskiltet (som i Worms) — figurerne har faste outfits.
 *
 * Status fra spejlet tegnes også her: skjoldboblen (b.skjold), "Opdaterer…"
 * over hovedet (b.springOver), boret (b.graver, retning b.vinkel),
 * virusserne om en smittet kunde (b.smittet) og Klageklaskets sving (slag()).
 *
 * Koordinater: riggens tal er pixels i atlassets celle (y nedad). tilWu()
 * fører dem over i figurens rum i verden (wu, y opad, fodpunktet i 0,0).
 */
'use strict';

import {
  Texture, LinearFilter, Mesh, PlaneGeometry, MeshBasicMaterial, Group, SRGBColorSpace,
  CanvasTexture, ShaderMaterial, AdditiveBlending, Vector3,
} from '../three.js';
import { Z } from './renderer.js';
import { BAEVER_R, BAEVER_H } from '../sim/entities.js';
import { indlaesGrafik as indlaesAssets, grafikKlar as assetsKlar } from './assets.js';
import { vaabenMaal } from './kunst.js';
import { fejlvindueTex, GLITCH_TID } from './fejl40.js';
import { TEGNESERIE_RIG as RIG } from './tegneserie_rig.js';

/* --------------------------------------------------------------- grafik */

const KUNDER = RIG.kunder;
const [CW, CH] = RIG.celle;
const KOL = RIG.kol;
const RAEKKER = Math.ceil(RIG.frames.length / KOL);
const F = Object.fromEntries(RIG.frames.map((n, i) => [n, i]));

const atlasBilleder = new Map();          // nr -> Image
const haandBilleder = new Map();
let indlaesning = null;

function hentBillede(sti) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { console.warn('[figur] mangler', sti); res(null); };
    img.src = sti;
  });
}

/** Grafik til kamp og menu: spritearket og de 22 kunder. */
export function indlaesGrafik() {
  if (indlaesning) return indlaesning;
  indlaesning = Promise.all([
    indlaesAssets(),
    ...KUNDER.map(async (k) => {
      const [a, h] = await Promise.all([hentBillede(`/grafik/tegneserie/${k.nr}.webp`),
                                        hentBillede(`/grafik/tegneserie/${k.nr}_haand.webp`)]);
      if (a) atlasBilleder.set(k.nr, a);
      if (h) haandBilleder.set(k.nr, h);
    }),
  ]);
  return indlaesning;
}
export const grafikKlar = () => assetsKlar() && atlasBilleder.size === KUNDER.length;

/* ------------------------------------------------------------- varianter */

export const FIGUR_NAVNE = KUNDER.map((k) => k.navn);
export const MAKS = { figur: KUNDER.length };
export const VALG_NAVNE = { figur: FIGUR_NAVNE };
/* De almindelige kunder står først; personalet (med klinik) til sidst. Kun
 * de almindelige trækkes tilfældigt, så personalet er unikt for sin klinik. */
export const ALMINDELIGE = KUNDER.filter((k) => !k.klinik).length;

export function standardUdseende(rng = Math.random) {
  return { v: 5, figur: Math.floor(rng() * ALMINDELIGE) };
}

/* Kenney-kunderne (v4) får den tegneseriekunde, der ligner mest. */
const FRA_V4 = [0, 8, 7, 2, 5];

/** Ældre profiler får en fast kunde ud fra deres gamle valg, så samme profil
 *  altid ligner sig selv, og navnene overlever. */
export function normaliserUdseende(u) {
  const n = KUNDER.length;
  const k = (x) => ((x | 0) % n + n) % n;
  if (u && u.v === 5) return { v: 5, figur: k(u.figur) };
  if (u && u.v === 4) return { v: 5, figur: FRA_V4[(u.figur | 0) % FRA_V4.length] };
  const froe = ((u?.hud ?? 0) * 7 + (u?.frisure ?? 0) * 3 + (u?.model ?? u?.pelston ?? 0)) | 0;
  return { v: 5, figur: k(froe) };
}

/* --------------------------------------------------------------- mål */

/* Én pixel i atlasset i verden. Kunderne er ~128 px fra sål til hårtop, så
 * de bliver ~46 wu — samme højde som træfzonen (entities.HITBOX). */
const S = 46 / 128;

/* Sigtearmen: den forreste hånd drejer om et punkt ved brystet (i atlassets
 * pixels relativt til hvilestillingen) og når så langt ud. Skulderen i
 * simulationen (behaviours.mundingsPunkt) sidder samme sted. */
const SKULDER_FRA_HAAND = [-12, -14];
const RAEKKEVIDDE = 18;

/* De holdte våben er lidt større end i VAABEN_STR, så de passer til de
 * store tegneseriehænder; projektiler og udlagte ting beholder størrelsen. */
const HOLDT_STR = 1.2;

/* Hvad figuren holder, pr. våben. greb afgør holdningen:
 *   skulder  båret på skulderen og sigtet med (tonerkanon)
 *   sigte    holdt i hånden og sigtet med (scanner, opdatering)
 *   ned      holdt skråt ned foran (boret graver nedad)
 *   haand    holdt opret i den forreste hånd (kasteting, redskaber)
 * baglaens er den del af tingen, der rager bag grebet. */
const MODEL = {
  grenroer:         { tegn: 'bazooka',        greb: 'skulder', baglaens: 0.3 },   // Tonerkanon
  splintboesse:     { tegn: 'scanner',        greb: 'sigte',   baglaens: 0.2 },   // Stregkodescanner
  daemningsdynamit: { tegn: 'opdatering',     greb: 'sigte',   baglaens: 0.3 },   // Tvangsopdatering
  egegranat:        { tegn: 'bombe',          greb: 'haand', greb_h: 0.5 },   // Datalæk-bomben
  koglebombe:       { tegn: 'tastatur',       greb: 'haand', greb_h: 0.4 },   // Integrations inferno
  halesmaek:        { tegn: 'ringbind',       greb: 'haand', greb_h: 0.25 },   // Klageklask
  baevermine:       { tegn: 'mail',           greb: 'haand' },   // Phishing-mine
  gnavetand:        { tegn: 'laptop',         greb: 'haand', greb_h: 0.35 },   // Hjemmearbejde
  nedgravning:      { tegn: 'bor',            greb: 'ned',     baglaens: 0.25 },  // Systemnedbrud
  gangtunnel:       { tegn: 'fjernbetjening', greb: 'haand' },   // Fjernsupport
  papirbunke:       { tegn: 'papirbunke',     greb: 'haand', greb_h: 0.3 },   // Papirbunke
  kabelbakke:       { tegn: 'kabelbakke',     greb: 'haand', greb_h: 0.45 },   // Kabelbakke
  byggeskum:        { tegn: 'skumpistol',     greb: 'sigte',   baglaens: 0.25 },  // Byggeskum
  traestammeregn:   { tegn: 'faktura',        greb: 'haand', greb_h: 0.35 },   // Kvartalsopkrævning
  covid:            { tegn: 'virus',          greb: 'haand', greb_h: 0.5 },   // COVID
  overgiv:          { tegn: 'flag',           greb: 'haand' },   // Opsig aftalen
};

/* Klageklasket: ringbindet svinges i en bue om skulderen. Simulationen
 * lander slaget 10 tick efter affyringen, så buen når frem netop da. */
const SLAG_TID = 0.42;
const SLAG_RAMT = 10 / 60;
const lerp = (a, b, t) => a + (b - a) * t;
const udUd = (t) => 1 - (1 - t) * (1 - t);
const indUd = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
/** Armens vinkel (0 = frem, + = op) t sekunder inde i slaget. */
function slagVinkel(t) {
  if (t < 0.08) return lerp(1.1, 2.35, udUd(t / 0.08));                         // tager tilløb
  if (t < SLAG_RAMT) { const u = (t - 0.08) / (SLAG_RAMT - 0.08); return lerp(2.35, -0.35, u * u); }   // slår
  if (t < 0.26) return lerp(-0.35, -0.8, udUd((t - SLAG_RAMT) / (0.26 - SLAG_RAMT)));   // følger igennem
  return lerp(-0.8, -0.25, indUd(Math.min(1, (t - 0.26) / (SLAG_TID - 0.26))));   // tilbage
}
/** Pop med overskud (0..1 -> 0..1, over 1 på vejen). */
const tilbage = (a) => 1 + 2.7 * Math.pow(a - 1, 3) + 1.7 * Math.pow(a - 1, 2);

/* Skjoldboblen: en additiv shader med lysende rand, et sekskantnet, der
 * driver, scanlinjer og et bånd, der glider op over boblen. */
const SKJOLD_D = 68;                      // boblens diameter i wu (kunden er 46 høj)
const SKJOLD_VS = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKJOLD_FS = `
precision highp float;          // uTid vokser hele kampen; mediump ville gøre boblen grynet
uniform float uTid; uniform float uStyrke; uniform float uFlash;
varying vec2 vUv;
float hexAfstand(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.73))), p.x);
}
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // Nettet bukker mod kanten, som på en kugle, og driver langsomt opad.
  vec2 q = p * (1.0 + 0.35 * r * r) * 4.2 + vec2(0.0, uTid * 0.25);
  vec2 s = vec2(1.0, 1.73);
  vec2 h = s * 0.5;
  vec2 a = mod(q, s) - h;
  vec2 b = mod(q - h, s) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float net = 1.0 - smoothstep(0.0, 0.07, 0.5 - hexAfstand(gv));
  float rand = pow(r, 5.0);
  float skan = 0.5 + 0.5 * sin(p.y * 22.0 - uTid * 6.0);
  float baand = smoothstep(0.82, 1.0, 0.5 + 0.5 * sin(p.y * 2.6 - uTid * 2.4));
  float puls = 0.85 + 0.15 * sin(uTid * 4.0);
  float lys = 0.06 + rand * 0.8 + net * (0.1 + 0.4 * r) * (0.55 + 0.45 * skan) + baand * 0.16;
  lys *= puls * (1.0 - smoothstep(0.95, 1.0, r));
  float alfa = lys * uStyrke + uFlash * (0.3 + rand * 0.7);
  vec3 c = mix(vec3(0.33, 0.8, 0.98), vec3(0.88, 1.0, 1.0), clamp(rand + uFlash * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(c, alfa);
}`;

/* "Opdaterer…" over hovedet: et panel med tekst og et spor, og en grøn
 * fyldning, der kryber frem (og aldrig helt bliver færdig). Sporet ligger i
 * panelets lærred ved x 20-236 og y 46-56 (af 256 x 72). */
const OPD_B = 48, OPD_H = OPD_B * 72 / 256;
const OPD_SPOR = { x0: (20 / 256 - 0.5) * OPD_B, x1: (236 / 256 - 0.5) * OPD_B,
                   y: (36 - 51) / 72 * OPD_H, h: 10 / 72 * OPD_H };

/* ------------------------------------------------ 2d-tegning (editor, menu) */

/** Tegn en kunde i tomgang på et 2d-lærred. (x, y) er fodpunktet i pixels,
 *  hoejde er figurens højde i pixels; spejl = -1 vender den mod venstre. */
export function tegnFigur(g, holdIdx, udseende, x, y, hoejde = 48, spejl = 1, frame = 'idle_0') {
  const k = KUNDER[normaliserUdseende(udseende).figur];
  const atlas = atlasBilleder.get(k.nr), haand = haandBilleder.get(k.nr);
  if (!atlas) return false;
  const i = F[frame] ?? 0;
  const s = hoejde / (k.fod[1] - k.top);
  g.save();
  g.translate(x, y); g.scale(s * spejl, s); g.translate(-k.fod[0], -k.fod[1]);
  g.drawImage(atlas, (i % KOL) * CW, Math.floor(i / KOL) * CH, CW, CH, 0, 0, CW, CH);
  if (haand) for (const [hx, hy] of k.haender[i]) {
    g.drawImage(haand, hx - haand.width / 2, hy - haand.height / 2);
  }
  g.restore();
  return true;
}

/* ------------------------------------------------------------------ scene */

const texCache = new Map();
function tex(kilde, noegle) {
  if (texCache.has(noegle)) return texCache.get(noegle);
  const t = kilde instanceof HTMLCanvasElement ? new CanvasTexture(kilde) : new Texture(kilde);
  t.minFilter = t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  // Tegningerne er sRGB. Uden dette lysner renderen dem, og kunderne ser
  // udvaskede ud mod den mættede baggrund.
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  texCache.set(noegle, t);
  return t;
}

let _skyggeTex = null;
function skyggeMateriale() {
  if (!_skyggeTex) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 48;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 24, 2, 64, 24, 60);
    gr.addColorStop(0, 'rgba(15,18,14,.5)');
    gr.addColorStop(0.6, 'rgba(15,18,14,.28)');
    gr.addColorStop(1, 'rgba(15,18,14,0)');
    g.fillStyle = gr;
    g.save(); g.translate(64, 24); g.scale(1, 0.34); g.translate(-64, -24);
    g.fillRect(-40, -80, 210, 210);
    g.restore();
    _skyggeTex = new CanvasTexture(c);
    _skyggeTex.minFilter = _skyggeTex.magFilter = LinearFilter;
    _skyggeTex.generateMipmaps = false;
  }
  return new MeshBasicMaterial({ map: _skyggeTex, transparent: true, depthTest: true, depthWrite: false });
}

/** Panelet til "Opdaterer…" — tre udgaver med 1-3 prikker (og en drejende
 *  ventecirkel), så teksten lever uden at tegne noget pr. frame. */
const opdTexCache = [];
function opdTex(i) {
  if (opdTexCache[i]) return opdTexCache[i];
  const c = document.createElement('canvas'); c.width = 256; c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = '#1E1610'; g.beginPath(); g.roundRect(2, 2, 252, 68, 16); g.fill();
  g.fillStyle = '#2E6DB4'; g.beginPath(); g.roundRect(7, 7, 242, 58, 12); g.fill();
  for (let k = 0; k < 8; k++) {
    const v = k / 8 * Math.PI * 2, lys = ((k - i * 3) % 8 + 8) % 8;
    g.fillStyle = `rgba(255,255,255,${lys === 0 ? 1 : lys === 7 ? 0.62 : 0.25})`;
    g.beginPath(); g.arc(30 + Math.cos(v) * 10, 26 + Math.sin(v) * 10, 2.8, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#FFFFFF'; g.font = '800 24px Poppins, system-ui, sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('Opdaterer' + '.'.repeat(i + 1), 50, 27);
  g.fillStyle = '#0D3145'; g.beginPath(); g.roundRect(18, 44, 220, 14, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.stroke();
  opdTexCache[i] = tex(c, `opdatering-${i}`);
  return opdTexCache[i];
}

/** Fartstriberne bag ringbindet: en bue, der er lysest i slagets forkant. */
let _susTex = null;
function susTex() {
  if (_susTex) return _susTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  const N = 24, fra = -2.35, spaend = 2.7;      // lærredets vinkler (y nedad): verdens +2,35 til -0,35
  for (let i = 0; i < N; i++) {
    const t = i / N, a0 = fra + t * spaend;
    g.strokeStyle = `rgba(255,255,255,${0.04 + 0.8 * t * t})`;
    g.lineWidth = 4 + 12 * t;
    g.beginPath(); g.arc(64, 64, 46, a0, a0 + spaend / N + 0.03); g.stroke();
  }
  _susTex = tex(c, 'sus');
  return _susTex;
}
const SUS_D = 15 * 128 / 46;              // buen får radius 15 wu

export function lavBaeverView(scene, baever, holdIdx, terraen) {
  // Ledige sæder har intet udseende; de får en fast kunde ud fra id'et, så
  // holdet er blandet og ens hos alle spillere.
  const u = baever.udseende?.v === 5 || baever.udseende?.v === 4 ? normaliserUdseende(baever.udseende)
    : { v: 5, figur: (baever.id * 7 + holdIdx * 3) % ALMINDELIGE };
  const k = KUNDER[u.figur];
  const tilWu = (x, y) => [(x - k.fod[0]) * S, (k.fod[1] - y) * S];

  const gruppe = new Group();
  const ring = new Mesh(new PlaneGeometry(30, 8), skyggeMateriale());
  ring.position.set(0, 0.5, 0);
  ring.renderOrder = Z.baevere - 1;
  gruppe.add(ring);

  const krop = new Group();                // spejles, hælder og hopper samlet
  gruppe.add(krop);

  // Kroppen: ét quad, hvis uv flyttes til den aktuelle frame i atlasset.
  const kropGeo = new PlaneGeometry(CW * S, CH * S);
  kropGeo.translate((CW / 2 - k.fod[0]) * S, (k.fod[1] - CH / 2) * S, 0);
  const atlasImg = atlasBilleder.get(k.nr);
  const kropMesh = new Mesh(kropGeo, new MeshBasicMaterial({
    map: atlasImg ? tex(atlasImg, `atlas-${k.nr}`) : null, transparent: true,
    depthTest: true, depthWrite: false }));
  kropMesh.renderOrder = Z.baevere;
  krop.add(kropMesh);
  let visFrame = -1;
  function saetFrame(i) {
    if (i === visFrame) return;
    visFrame = i;
    const c = i % KOL, r = Math.floor(i / KOL);
    const u0 = c / KOL, u1 = (c + 1) / KOL;
    const v1 = 1 - r / RAEKKER, v0 = 1 - (r + 1) / RAEKKER;
    const uv = kropGeo.attributes.uv;
    // PlaneGeometry: (0,1) (1,1) (0,0) (1,0) — øverst venstre, øverst højre, …
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
  }

  // Hænderne: samme knytnæve, bag og forrest.
  const haandImg = haandBilleder.get(k.nr);
  const lavHaand = (orden) => {
    const m = new Mesh(new PlaneGeometry(k.haand[0] * S, k.haand[1] * S), new MeshBasicMaterial({
      map: haandImg ? tex(haandImg, `haand-${k.nr}`) : null, transparent: true,
      depthTest: true, depthWrite: false }));
    m.renderOrder = Z.baevere + orden;
    krop.add(m);
    return m;
  };
  const haandBag = lavHaand(0.5), haandFor = lavHaand(1.5);
  const alleMeshes = () => [kropMesh, haandBag, haandFor];

  // Døden: kunden bliver til et fejlvindue, der suges ind i et sort hul.
  const vindue = new Mesh(new PlaneGeometry(1, 150 / 256), new MeshBasicMaterial({
    map: fejlvindueTex(), transparent: true, depthTest: false, depthWrite: false }));
  vindue.visible = false;
  vindue.renderOrder = Z.fx - 1;
  gruppe.add(vindue);
  let absorbT = null;
  const HUL_Y = 22;

  // Våben: bygges dovent pr. våben og genbruges.
  const modeller = new Map();
  let aktivId = null;
  let vistId = null;                        // den model, der er synlig lige nu
  function model(id) {
    if (modeller.has(id)) return modeller.get(id);
    const m = MODEL[id];
    const maal = m && vaabenMaal(m.tegn);
    let mesh = null;
    if (maal) {
      const geo = new PlaneGeometry(maal.bredde, maal.hoejde);
      // greb_h: hvor højt oppe på tingen hånden griber (0 = den står på
      // knytnæven). Store ting holdes om midten, så de ikke dækker ansigtet.
      if (m.greb === 'haand') geo.translate(-maal.midtX, -maal.bund - 1.5 - (m.greb_h || 0) * maal.indholdH, 0);
      else geo.translate(-maal.venstre - maal.indholdB * m.baglaens, -maal.midtY, 0);
      mesh = new Mesh(geo, new MeshBasicMaterial({
        map: tex(maal.canvas, `vaaben-${m.tegn}`), transparent: true, depthTest: true, depthWrite: false }));
      mesh.userData.greb = m.greb;
      // Spidsen (til borestøvet): tingens forreste ende langs grebets akse.
      mesh.userData.spids = m.greb === 'haand' ? 0 : maal.indholdB * (1 - (m.baglaens || 0));
      mesh.visible = false;
      mesh.scale.setScalar(HOLDT_STR);
      krop.add(mesh);
    }
    modeller.set(id, mesh);
    return mesh;
  }

  // ---- status: skjold, "Opdaterer…", virus og klaskets fartstriber (dovne)
  let skjold = null, skjoldVis = 0, skjoldFlash = 0;
  function lavSkjold() {
    skjold = new Mesh(new PlaneGeometry(SKJOLD_D, SKJOLD_D), new ShaderMaterial({
      vertexShader: SKJOLD_VS, fragmentShader: SKJOLD_FS, transparent: true,
      depthTest: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uTid: { value: 0 }, uStyrke: { value: 0 }, uFlash: { value: 0 } },
    }));
    skjold.position.set(0, 23, 0.5);
    skjold.renderOrder = Z.baevere + 3;       // over krop, hænder og våben
    skjold.visible = false;
    gruppe.add(skjold);
  }

  let opd = null, opdT = 0, opdVis = 0;
  function lavOpdatering() {
    const g = new Group();
    const ramme = new Mesh(new PlaneGeometry(OPD_B, OPD_H), new MeshBasicMaterial({
      map: opdTex(0), transparent: true, depthTest: false, depthWrite: false }));
    ramme.renderOrder = Z.fx - 1;
    g.add(ramme);
    const fyldGeo = new PlaneGeometry(1, 1);
    fyldGeo.translate(0.5, 0, 0);             // venstre kant i 0, så scale.x er fremdriften
    const fyld = new Mesh(fyldGeo, new MeshBasicMaterial({
      color: 0x7DDC6A, transparent: true, depthTest: false, depthWrite: false }));
    fyld.renderOrder = Z.fx - 0.9;
    fyld.position.set(OPD_SPOR.x0, OPD_SPOR.y, 0.01);
    g.add(fyld);
    g.visible = false;
    gruppe.add(g);                            // uspejlet: teksten skal kunne læses
    opd = { g, ramme, fyld, texI: 0 };
  }

  let virus = null;
  const VIRUS_N = 4;
  function lavVirus() {
    const mo = vaabenMaal('virus');
    virus = [];
    for (let i = 0; i < VIRUS_N; i++) {
      const geo = new PlaneGeometry(mo.bredde, mo.hoejde);
      geo.translate(-mo.midtX, -mo.midtY, 0);
      const m = new Mesh(geo, new MeshBasicMaterial({
        map: tex(mo.canvas, 'vaaben-virus'), transparent: true, depthTest: true, depthWrite: false }));
      m.visible = false;
      gruppe.add(m);
      virus.push(m);
    }
  }

  let sus = null;
  function lavSus() {
    sus = new Mesh(new PlaneGeometry(SUS_D, SUS_D), new MeshBasicMaterial({
      map: susTex(), transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending }));
    sus.renderOrder = Z.baevere + 1.8;
    sus.visible = false;
    krop.add(sus);
  }

  gruppe.position.z = Z.baevere;
  scene.add(gruppe);

  const fase = (baever.id * 2.399963) % 6.28318;
  let tid = 0, animT = fase, gangT = 0;
  let sigter = false, sigteRot = 0.35;
  let rekyl = 0, haeld = 0;
  let doedVist = false, doedTid = 0;
  let skadeTil = 0, flash = 0;
  let luftTid = 0;
  let visY = null;
  let slagT = null;                          // tid inde i klageklasket, ellers null
  let boreSpejl = 0;                         // hvilken vej figuren vender, mens den borer
  let spids = null;                          // borets spids i verden, mens der bores
  const spidsV = new Vector3();
  // Introen: kunden falder ned fra himlen (se introFald).
  let introT = null, introLand = null, landetT = -1;
  const INTRO_H = 330, INTRO_G = 1500;
  const INTRO_FALD = Math.sqrt(2 * INTRO_H / INTRO_G);
  let introH = INTRO_H, introFaldT = INTRO_FALD;   // kortere fald under et loft (fortets etager)
  // Den forreste hånds hvileplads i tomgang: udgangspunkt for sigtearmen.
  const hvile = k.haender[F.idle_0][1];
  const skulderPx = [hvile[0] + SKULDER_FRA_HAAND[0], hvile[1] + SKULDER_FRA_HAAND[1]];

  function terraenHaeldning(x) {
    if (!terraen) return 0;
    const a = terraen.overflade(Math.round(x - 12));
    const b = terraen.overflade(Math.round(x + 12));
    if (a < 0 || b < 0 || Math.abs(a - b) > 22) return 0;
    return Math.atan2(b - a, 24);
  }

  const loekke = (navne, fps, t) => F[navne[Math.floor(t * fps) % navne.length]];

  /** Hvilken frame kroppen viser lige nu. */
  function vaelgFrame(b, gaar, jubler, iLuften, graver) {
    if (introT !== null && introT < introFaldT) return F.jump_1;
    if (b.doed) return F[`death_${Math.min(3, Math.floor(doedTid * 9))}`];
    if (slagT !== null) return F[slagT < 0.08 ? 'attack_r_0' : slagT < 0.2 ? 'attack_r_1' : 'attack_r_2'];
    if (tid < skadeTil) return F[tid < skadeTil - 0.7 ? 'death_1' : 'death_0'];
    if (jubler && b.paaJorden) return loekke(['jump_0', 'jump_1'], 3.4, tid + fase);
    if (graver) return loekke(['attack_r_0', 'attack_r_1', 'attack_r_2'], 10, tid);
    if (iLuften) return F[b.vy > 0 ? 'jump_0' : 'jump_1'];
    if (gaar) return loekke(['run_0', 'run_1', 'run_2', 'run_3'], 10, gangT);
    return loekke(['idle_0', 'idle_1', 'idle_2', 'idle_3'], 4, animT);
  }

  const api = {
    gruppe, krop, ring,
    saetFrame() {},                          // bevaret for API-kompatibilitet

    visVaaben(vaabenId, dx = 1, dy = 0) {
      aktivId = vaabenId && MODEL[vaabenId] ? vaabenId : null;
      sigter = !!aktivId;
      if (sigter) sigteRot = Math.atan2(dy, Math.max(0.0001, Math.abs(dx)));
    },

    rekylSkud() { rekyl = 1; },

    /** Klageklask: ringbindet svinges i en bue (~0,4 s) — uanset turens
     *  tilstand, så slaget ses, selv om turen slutter i samme øjeblik. */
    slag() { slagT = 0; },

    /** Skjoldet tog et slag: boblen blitzer og bumper. */
    skjoldRamt() { skjoldFlash = 1; },

    /** Borets spids i verden { x, y, dx, dy }, mens der bores (b.graver),
     *  ellers null. Gælder for den seneste opdater(). */
    boreSpids() { return spids; },

    /** Dødsfaldet: glitch, FEJL 40, og ind i det sorte hul. */
    absorber() { if (absorbT === null) absorbT = 0; },

    /** Introen: kunden venter `forsinkelse` sekunder og falder så ned fra
     *  himlen; vedLand kaldes i landingsøjeblikket (lyd, støv). */
    /** frit: hvor højt der er frit over hovedet. Under et dæk falder kunden
     *  kun fra loftet — ellers faldt den synligt gennem etagen ovenover. */
    introFald(forsinkelse, vedLand, frit = INTRO_H) {
      introT = -forsinkelse; introLand = vedLand;
      introH = Math.max(0, Math.min(INTRO_H, frit));
      introFaldT = Math.sqrt(2 * introH / INTRO_G);
    },

    /** Skaden afsløres: kunden krymper sig, blinker rødt og ryster. */
    ramt() { skadeTil = tid + 1.2; flash = 1; },

    /** harGrav: skiltet står nu, hvor kunden faldt — så overtager det.
     *  jubler: kampen er vundet, og kunden fejrer det. */
    opdater(b, dt = 1 / 60, harGrav = false, jubler = false) {
      tid += dt; animT += dt;
      doedTid = b.doed ? doedTid + dt : 0;
      if (slagT !== null) { slagT += dt; if (slagT >= SLAG_TID || b.doed) slagT = null; }
      const graver = !!(b.graver || b.redskab) && !b.doed;
      const smittet = (b.smittet | 0) > 0 && !b.doed;
      const x = b.x, y = b.y;               // interpoleret af klienten
      gruppe.position.x = x;

      // ---- kontakt med jorden
      // Figuren står på selve overfladen under sig, og højden glattes, så
      // pixeltrin i terrænet ikke ryster den. Rigtige hop og fald følges direkte.
      // Under boringen følger den boret direkte (den er inde i sin egen tunnel).
      luftTid = b.paaJorden || graver ? 0 : luftTid + dt;
      const paaFod = !b.doed && !graver && (b.paaJorden || (luftTid < 0.25 && Math.abs(b.vy) < 160));
      let maalY = y;
      if (paaFod && terraen) {
        const flade = (dx) => {
          const yy = terraen.jordUnder(Math.round(x + dx), Math.round(y + 6));
          return yy >= 0 && y - yy < 14 ? yy + 1 : null;
        };
        const midt = flade(0), v = flade(-4), h = flade(4);
        const sider = v != null && h != null ? (v + h) / 2 : null;
        if (midt != null) maalY = sider != null ? Math.max(midt, sider) : midt;
        else if (sider != null) maalY = sider;
      }
      if (visY == null || !paaFod || Math.abs(maalY - visY) > 18) visY = maalY;
      else visY += (maalY - visY) * (1 - Math.exp(-dt * 28));
      gruppe.position.y = visY - 0.5;
      gruppe.visible = !b.doed || (!harGrav && doedTid < (b.drukner ? 2.5 : 12));

      if (absorbT !== null) {
        absorbT += dt;
        gruppe.visible = absorbT < 1.2;
        krop.visible = absorbT < GLITCH_TID;
        // Fejlvinduet popper op, hænger et øjeblik (så man kan læse det), og
        // suges så ind i spiral mod hullets midte, mens det krymper og drejer.
        const HOLD = 0.62;
        const p = Math.max(0, (absorbT - HOLD) / (1.15 - HOLD));
        vindue.visible = absorbT >= GLITCH_TID * 0.7 && p < 1;
        if (vindue.visible) {
          const pop = Math.min(1, (absorbT - GLITCH_TID * 0.7) / 0.12);
          const r = 20 * (1 - p), v = p * 9;
          const s = 36 * Math.pow(1 - p, 1.4) * (0.4 + 0.6 * pop) * (1 + 0.06 * Math.sin(absorbT * 30) * (p === 0));
          vindue.position.set(Math.cos(v) * r, HUL_Y + 6 * (1 - p) + Math.sin(v) * r, 0);
          vindue.rotation.z = -v * 0.9 + (p === 0 ? Math.sin(absorbT * 18) * 0.06 : 0);
          vindue.scale.set(Math.max(0.01, s), Math.max(0.01, s), 1);
        }
        ring.visible = false;
      } else if (graver) {
        ring.visible = false;                // skyggen hører til overfladen, ikke tunnelen
      } else if (terraen && !b.doed) {
        // Jorden UNDER kunden, ikke den øverste overflade: på fortets
        // nederste etager er den øverste flade dækket over hovedet.
        const jordY = terraen.jordUnder(Math.round(x), Math.round(y) + 2);
        const hoejdeOver = jordY >= 0 ? Math.max(0, y - jordY) : 999;
        if (hoejdeOver < 220) {
          ring.visible = true;
          ring.position.y = jordY - gruppe.position.y + 0.5;
          const f = 1 / (1 + hoejdeOver / 55);
          ring.scale.set(f, f, 1);
          ring.material.opacity = f;
        } else ring.visible = false;
      } else {
        ring.visible = b.paaJorden && !b.doed;
        ring.position.y = 0.5;
      }

      // Farven: rødt glimt, mens skaden tælles ned (se ramt()), og et grønligt
      // skær, mens kunden er smittet.
      if (!b.doed && absorbT === null) {
        let r = 1, g = 1, bl = 1;
        if (smittet) { r = 0.8; bl = 0.74; }
        if (flash > 0) {
          flash = Math.max(0, flash - dt * 1.6);
          const kf = Math.max(0, Math.sin(tid * 30)) * flash;
          g *= 1 - 0.55 * kf; bl *= 1 - 0.6 * kf;
        }
        for (const m of alleMeshes()) m.material.color.setRGB(r, g, bl);
      }
      if (b.doed && !doedVist) {
        doedVist = true;
        for (const m of alleMeshes()) m.material.color.setRGB(0.62, 0.62, 0.66);
      }

      // Under boringen vender figuren mod borets vandrette retning.
      const boreV = graver ? (Number.isFinite(b.vinkel) ? b.vinkel : -Math.PI / 2) : 0;
      let spejl = b.retning >= 0 ? 1 : -1;
      if (graver) {
        const c = Math.cos(boreV);
        if (c > 0.3) boreSpejl = 1; else if (c < -0.3) boreSpejl = -1; else if (!boreSpejl) boreSpejl = spejl;
        spejl = boreSpejl;
      } else boreSpejl = 0;
      const gaar = !graver && (Math.abs(b.vx) > 1 || b.gaar) && (b.paaJorden || luftTid < 0.25);
      if (gaar) gangT += dt;
      const iLuften = !graver && !b.paaJorden && (luftTid > 0.25 || Math.abs(b.vy) > 160);

      // ---- kroppens frame og hændernes plads i den
      const fi = vaelgFrame(b, gaar, jubler, iLuften, graver);
      saetFrame(fi);
      const [bag, for_] = k.haender[fi];
      let [bx, by] = tilWu(bag[0], bag[1]);
      let [fx, fy] = tilWu(for_[0], for_[1]);
      if (jubler && b.paaJorden) {
        // Næverne pumper over hovedet, hver i sin takt.
        const p1 = Math.max(0, Math.sin(tid * 9 + fase)), p2 = Math.max(0, Math.sin(tid * 9 + fase + Math.PI));
        bx = -9; by = 30 + p1 * 14;
        fx = 9; fy = 30 + p2 * 14;
      }
      haandBag.position.set(bx, by, 0);

      // ---- sigtearmen og våbnet
      // Tre tilstande: klasket (ringbindet i en bue), boringen (boret peger
      // langs b.vinkel) og det almindelige sigte med det valgte våben.
      const holder = sigter && aktivId && model(aktivId) && !b.doed && (b.paaJorden || luftTid < 0.25) &&
                     !jubler && !graver;
      const visId = slagT !== null ? 'halesmaek' : graver ? 'nedgravning' : holder ? aktivId : null;
      if (visId !== vistId) {
        const gammel = vistId && model(vistId);
        if (gammel) gammel.visible = false;
        vistId = visId;
      }
      const vm = visId && model(visId);
      if (vm) vm.visible = true;
      haandFor.rotation.z = 0;
      const [sx, sy] = tilWu(skulderPx[0], skulderPx[1]);
      let laen = 0;                            // borets forlæns hældning af kroppen
      let lunge = 0;                           // klaskets fremstød
      if (vm && slagT !== null) {
        const v = slagVinkel(slagT);
        const raek = RAEKKEVIDDE * S * 1.1;
        fx = sx + Math.cos(v) * raek;
        fy = sy + Math.sin(v) * raek;
        vm.position.set(fx, fy, 0);
        vm.rotation.z = v - Math.PI / 2;      // ringbindet står ud i armens retning
        vm.renderOrder = Z.baevere + 2;
        lunge = 3 * (slagT < SLAG_RAMT ? Math.max(0, (slagT - 0.08) / (SLAG_RAMT - 0.08))
          : Math.max(0, 1 - (slagT - SLAG_RAMT) / 0.2));
        if (!sus) lavSus();
        const synlig = slagT > 0.09 && slagT < 0.3;
        sus.visible = synlig;
        if (synlig) {
          sus.position.set(sx, sy, 0);
          sus.material.opacity = slagT < SLAG_RAMT ? (slagT - 0.09) / (SLAG_RAMT - 0.09)
            : Math.max(0, 1 - (slagT - SLAG_RAMT) / 0.13);
        }
      } else {
        if (sus) sus.visible = false;
        if (vm && graver) {
          // Boret peger langs retningen; kroppen læner sig frem, når der
          // bores vandret, og står oprejst, når der bores lodret.
          let lokal = spejl > 0 ? boreV : Math.PI - boreV;
          lokal = Math.atan2(Math.sin(lokal), Math.cos(lokal));
          laen = -0.35 * Math.max(0, Math.cos(lokal));
          const v = lokal - laen + (Math.random() - 0.5) * 0.05;
          const raek = RAEKKEVIDDE * S * 0.8;
          fx = sx + Math.cos(v) * raek;
          fy = sy + Math.sin(v) * raek;
          vm.position.set(fx, fy, 0);
          vm.rotation.z = v;
          vm.renderOrder = Z.baevere + 2;
        } else if (vm) {
          const greb = vm.userData.greb;
          const v = greb === 'ned' ? -0.9 : sigteRot;
          const raek = RAEKKEVIDDE * S * (greb === 'skulder' ? 0.55 : 1) - rekyl * 2;
          fx = sx + Math.cos(v) * raek;
          fy = sy + Math.sin(v) * raek;
          if (greb === 'skulder') {
            // Røret ligger på skulderen; hånden griber om det foran.
            vm.position.set(sx - Math.cos(v) * rekyl * 3, sy + 2.5 - Math.sin(v) * rekyl * 3, 0);
            vm.rotation.z = v;
            vm.renderOrder = Z.baevere + 1;
          } else if (greb === 'sigte' || greb === 'ned') {
            vm.position.set(fx, fy, 0);
            vm.rotation.z = greb === 'ned' ? -1.1 : v;
            vm.renderOrder = Z.baevere + 2;
          } else {
            vm.position.set(fx, fy, 0);
            vm.rotation.z = Math.sin(tid * 2.1 + fase) * 0.04;
            vm.renderOrder = Z.baevere + 2;
          }
        }
      }
      haandFor.position.set(fx, fy, 0);

      // ---- hele kroppen: spejl, hældning, hop og rystelse
      const maalHaeld = b.paaJorden && !b.doed && !graver ? terraenHaeldning(x) * 0.35 : 0;
      haeld += (maalHaeld - haeld) * Math.min(1, dt * 10);
      rekyl = Math.max(0, rekyl - dt * 5);
      let bob = 0, spin = 0;
      if (jubler && b.paaJorden) {
        // Glædeshop — hvert andet er et stort hop med en saltomortale.
        const cyklus = tid * 1.4 + fase / 6.283;
        const p = cyklus % 1, stort = Math.floor(cyklus) % 2 === 1;
        bob = Math.sin(p * Math.PI) * (stort ? 34 : 14);
        if (stort) spin = -p * Math.PI * 2;
      }
      krop.scale.set(spejl, 1, 1);
      krop.rotation.z = haeld * spejl + spin * spejl + laen * spejl;
      krop.position.set(lunge * spejl, bob, 0);
      krop.scale.y = 1;
      if (graver) {
        // Boret hamrer: hele figuren sitrer.
        krop.position.x += (Math.random() - 0.5) * 1.3;
        krop.position.y += (Math.random() - 0.5) * 0.8;
      }
      // Introens fald: fra himlen med tyngde, og et lille squash ved landing.
      if (introT !== null) {
        introT += dt;
        if (introT < 0) gruppe.visible = false;
        else if (introT < introFaldT) krop.position.y += introH - 0.5 * INTRO_G * introT * introT;
        else {
          if (landetT < 0) { landetT = tid; introLand?.(); }
          const s = tid - landetT;
          if (s < 0.25) { krop.scale.y = 1 - 0.28 * Math.sin((s / 0.25) * Math.PI); krop.scale.x = spejl * (1 + 0.18 * Math.sin((s / 0.25) * Math.PI)); }
          else introT = null;
        }
        if (introT !== null && introT < introFaldT * 0.4) ring.visible = false;
      }
      if (tid < skadeTil && !b.doed) krop.position.x += Math.sin(tid * 70) * 1.3 * (skadeTil - tid);
      if (absorbT !== null && absorbT < GLITCH_TID) {
        // Glitch: figuren hakker sidelæns og skifter mellem cyan og magenta.
        krop.position.x += (Math.random() - 0.5) * 7;
        krop.scale.y = 1 + (Math.random() - 0.5) * 0.25;
        const f = Math.floor(absorbT * 40) % 3;
        for (const m of alleMeshes()) m.material.color.setRGB(f === 0 ? 0.3 : 1, f === 1 ? 0.3 : 1, 1);
      }

      // ---- skjoldboblen (Hjemmearbejde)
      const vilSkjold = !!b.skjold && !b.doed && absorbT === null;
      if (vilSkjold && !skjold) lavSkjold();
      if (skjold) {
        skjoldVis = vilSkjold ? Math.min(1, skjoldVis + dt / 0.25) : Math.max(0, skjoldVis - dt / 0.2);
        skjoldFlash = Math.max(0, skjoldFlash - dt * 2.5);
        skjold.visible = skjoldVis > 0;
        if (skjold.visible) {
          // Popper op med overskud, ånder let og bumper, når den rammes.
          const ind = vilSkjold ? tilbage(skjoldVis) : skjoldVis;
          const s = Math.max(0.01, ind * (1 + 0.025 * Math.sin(tid * 4 + fase)) * (1 + skjoldFlash * 0.1));
          skjold.scale.set(s, s, 1);
          skjold.position.y = 23 + bob;
          const uf = skjold.material.uniforms;
          uf.uTid.value = tid + fase;
          uf.uStyrke.value = Math.min(1, skjoldVis);
          uf.uFlash.value = skjoldFlash;
        }
      }

      // ---- "Opdaterer…" over hovedet (Tvangsopdatering: turen springes over)
      const vilOpd = !!b.springOver && !b.doed && absorbT === null;
      if (vilOpd && !opd) lavOpdatering();
      if (opd) {
        opdVis = vilOpd ? Math.min(1, opdVis + dt / 0.2) : Math.max(0, opdVis - dt / 0.2);
        opd.g.visible = opdVis > 0;
        if (!vilOpd && opdVis <= 0) opdT = 0;
        if (opd.g.visible) {
          if (vilOpd) opdT += dt;
          if (opdT > 9) opdT = 0;             // starter forfra — den bliver aldrig færdig
          const i = Math.floor(tid / 0.45) % 3;
          if (i !== opd.texI) { opd.texI = i; opd.ramme.material.map = opdTex(i); }
          const frem = Math.min(0.99, 0.04 + (1 - Math.exp(-opdT * 0.45)));
          opd.fyld.scale.set(Math.max(0.01, (OPD_SPOR.x1 - OPD_SPOR.x0) * frem), OPD_SPOR.h, 1);
          opd.g.scale.setScalar(Math.max(0.01, vilOpd ? tilbage(opdVis) : opdVis));
          opd.g.position.set(0, 60 + bob + Math.sin(tid * 2.2 + fase) * 0.8, 0);
        }
      }

      // ---- virusser, der kredser om en smittet kunde (COVID)
      if (smittet && !virus) lavVirus();
      if (virus) {
        for (let i = 0; i < VIRUS_N; i++) {
          const m = virus[i];
          m.visible = smittet && absorbT === null;
          if (!m.visible) continue;
          const a = tid * 1.9 + i * (Math.PI * 2 / VIRUS_N) + fase;
          const foran = Math.sin(a) > 0;
          m.position.set(Math.cos(a) * 21, 24 + bob + Math.sin(a * 0.7 + i * 1.7) * 13, 0.2);
          // Forrest er de større og foran figuren; bagved mindre og bag den.
          m.renderOrder = foran ? Z.baevere + 2.5 : Z.baevere - 0.5;
          m.scale.setScalar((foran ? 0.62 : 0.48) * (1 + 0.1 * Math.sin(tid * 7 + i)));
          m.rotation.z = tid * (i % 2 ? 2 : -2);
        }
      }

      // ---- borets spids i verden (til borestøvet i main.js)
      spids = null;
      if (graver && vm && gruppe.visible) {
        gruppe.updateMatrixWorld(true);
        vm.localToWorld(spidsV.set(vm.userData.spids || 0, 0, 0));
        spids = { x: spidsV.x, y: spidsV.y, dx: Math.cos(boreV), dy: Math.sin(boreV) };
      }
    },

    fjern() {
      scene.remove(gruppe);
      gruppe.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    },
  };
  return api;
}

export { BAEVER_R, BAEVER_H };
