/* Kundekrigen — vejr og synlig vind.
 *
 * REN GPU, næsten nul CPU per frame. Hver partikels attributter uploades ÉN
 * gang, og positionen regnes analytisk i vertex-shaderen ud fra uTid, vindens
 * forskydning (uDrift) og kameraets position, med wrap inden for en boks der
 * følger kameraet. uDrift er vinden integreret over tid her på CPU'en (ét tal
 * pr. frame): før stod der vind x tid i shaderen, så hvert vindstød fik hele
 * nedbøren til at springe — mere, jo længere kampen havde varet.
 *
 * Vejret påvirker spillet UDELUKKENDE gennem vindvarians (se turn.js) —
 * aldrig gennem skjult fysik, for så ville HUD'en lyve for spilleren.
 */
'use strict';

import {
  BufferGeometry, BufferAttribute, Points, Mesh, ShaderMaterial, AdditiveBlending, NormalBlending, DoubleSide,
} from '../three.js';
import { Z } from './renderer.js';
import { HEX } from './palette.js';
import { lavRng } from '../core/rng.js';
import { VEJR_FYSIK } from '../sim/physics.js';

const VS = `
uniform float uTid; uniform float uDrift; uniform vec2 uKamera;
uniform vec2 uBoks; uniform float uFaldfart; uniform float uVimse;
uniform float uStoerrelse;
attribute vec4 aData;        // x0, y0, fart, fase
varying float vAlpha;
void main() {
  float fart = aData.z;
  float x = aData.x + uDrift * fart
          + sin(uTid * 2.0 + aData.w) * uVimse;
  float y = aData.y - uFaldfart * fart * uTid;
  // Wrap inden for en boks der er låst til kameraet.
  x = mod(x - uKamera.x + uBoks.x * 0.5, uBoks.x) + uKamera.x - uBoks.x * 0.5;
  y = mod(y - uKamera.y + uBoks.y * 0.5, uBoks.y) + uKamera.y - uBoks.y * 0.5;
  vAlpha = 0.35 + 0.4 * fract(aData.w);
  vec4 mv = modelViewMatrix * vec4(x, y, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uStoerrelse;
}`;

const FS = `
precision mediump float;
uniform vec3 uFarve; uniform float uGlobal;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float m = 1.0 - smoothstep(0.2, 0.5, length(d));
  if (m <= 0.01) discard;
  gl_FragColor = vec4(uFarve, vAlpha * m * uGlobal);
}`;

/*
 * Vindstriberne (story-001): vinden skal SES i alt vejr — også i solskin og
 * tåge, hvor der ingen nedbør er. Tynde striber, der fejer hen over himlen
 * med den EFFEKTIVE vind (world.vindNu: rul x vejr x vindstød), så det, man
 * ser, er det, skuddet mærker. Antal, længde og styrke følger vinden; et
 * vindstød gør dem længere og tydeligere. De ligger i Z.fjernVejr — bag
 * terrænet, kunderne, projektilerne og sigtet — så de aldrig skjuler dem.
 */
const VIND_VS = `
uniform float uTid; uniform float uDrift; uniform vec2 uKamera; uniform vec2 uBoks;
uniform float uStyrke; uniform float uStoed; uniform float uRet;
attribute vec4 aData;        // x0, y0, fart, fase
attribute vec2 aHj;          // x: 0 = halen, 1 = hovedet; y: -1..1 på tværs
varying float vAlpha; varying vec2 vHj;
void main() {
  float fart = aData.z;
  float x = aData.x + uDrift * fart;
  float y = aData.y + sin(uTid * 1.3 + aData.w * 5.0) * 9.0;
  x = mod(x - uKamera.x + uBoks.x * 0.5, uBoks.x) + uKamera.x - uBoks.x * 0.5;
  y = mod(y - uKamera.y + uBoks.y * 0.5, uBoks.y) + uKamera.y - uBoks.y * 0.5;
  float laengde = (26.0 + 150.0 * uStyrke) * (1.0 + 0.9 * uStoed) * fart;
  x -= uRet * laengde * (1.0 - aHj.x);
  y += aHj.y * 2.0;
  // Andelen af striber, der vises, følger styrken; stille vind = ingen.
  float vis = step(fract(aData.w * 7.31), 0.35 + 0.65 * uStyrke) * clamp(uStyrke * 12.0, 0.0, 1.0);
  vAlpha = vis * (0.6 + 0.4 * uStyrke) * (0.75 + 0.5 * uStoed) * (0.55 + 0.45 * fract(aData.w * 3.7));
  vHj = aHj;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
}`;

const VIND_FS = `
precision mediump float;
uniform vec3 uFarve; uniform float uGlobal;
varying float vAlpha; varying vec2 vHj;
void main() {
  // Svag hale, tydeligt hoved, bløde kanter på tværs.
  float a = vAlpha * uGlobal * vHj.x * (1.0 - smoothstep(0.85, 1.0, vHj.x)) * (1.0 - vHj.y * vHj.y);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uFarve, a);
}`;

const VIND_ANTAL = 900;
const VIND_FART = 420;               // wu/s pr. enhed effektiv vind (striber og nedbør)
const VIND_FULD = 0.6;               // |vindNu| herover er fuld styrke (HUD 6.0; rullen er højst ±0,9 før vejr og stød)
const VIND_GLAT = 3;                 // 1/s: længde og antal glider, når vinden springer (ny tur, uvejr)
// Lyse striber på den klare himmel; mørk skifer i gråvejr, sne og tåge, hvor
// en lys stribe forsvinder i disen.
const VIND_FARVE = { solskin: [0xFFFFFF, 0.7], andet: [0x34505C, 0.55] };

/**
 * Vindens styrke og vindstød til præsentationen (striberne her og vindlyden i
 * ui/lyd.js), alt regnet af simulationens egen tilstand — ens hos vært, gæst
 * og lokalt. w = world.vindNu(), vind = world.vind (turens rul), vejr.
 *   styrke  0..1   |w| / VIND_FULD (0 under 0,025 — HUD'en viser "stille")
 *   stoed   0..1   hvor meget vindstødet lige nu løfter vinden over vejrets
 *                  grundvind (0 i stille vejr; slud når 1)
 *   retning -1|1
 * Genbruger ét objekt — kaldes hver frame.
 */
const vt = { w: 0, styrke: 0, stoed: 0, retning: 1 };
export function vindTilstand(w, vind, vejr) {
  const basis = Math.abs(vind * (VEJR_FYSIK[vejr] || VEJR_FYSIK.solskin).kraft);
  vt.w = w;
  vt.styrke = Math.abs(w) < 0.025 ? 0 : Math.min(1, Math.abs(w) / VIND_FULD);
  vt.stoed = basis > 0.02 ? Math.min(1, Math.max(0, Math.abs(w) / basis - 1) * 2.5) : 0;
  vt.retning = w >= 0 ? 1 : -1;
  return vt;
}

function v3(hex) { return { x:((hex>>16)&255)/255, y:((hex>>8)&255)/255, z:(hex&255)/255 }; }

const OPSAET = {
  solskin:   null,
  overskyet: null,
  taage:     null,
  regn:  { antal: 1200, faldfart: 900, vimse: 0,  farve: 0x9BC4D4, stoerrelse: 2.5, alpha: 0.55 },
  slud:  { antal: 900,  faldfart: 620, vimse: 6,  farve: 0xBBD6E0, stoerrelse: 3.0, alpha: 0.6 },
  sne:   { antal: 700,  faldfart: 130, vimse: 26, farve: 0xFFFFFF, stoerrelse: 4.5, alpha: 0.85 },
};

export function lavVejr(scene, kamera, rng) {
  let punkter = null, mat = null, nu = null;
  const boks = { x: 3000, y: 2000 };
  // Driften holdes inden for 10 bokse: farten er i tiendedele, så x0 + drift *
  // fart flytter sig et helt antal bokse, når den slår om (intet spring).
  const DRIFT_LOFT = boks.x * 10;
  let drift = 0, sidstTid = null, glatW = 0;
  const kvant = (f) => Math.round(f * 10) / 10;

  // Vindstriberne: N firkanter (4 hjørner, 2 trekanter), egen frø, så de
  // ikke flytter andre visningers lodtrækning.
  const vrng = lavRng(0x5717d);
  const vData = new Float32Array(VIND_ANTAL * 16), vHj = new Float32Array(VIND_ANTAL * 8);
  const vIdx = new Uint16Array(VIND_ANTAL * 6);
  const HJ = [0, -1, 1, -1, 1, 1, 0, 1];
  for (let i = 0; i < VIND_ANTAL; i++) {
    const d = [vrng() * boks.x - boks.x / 2, vrng() * boks.y - boks.y / 2, kvant(0.7 + vrng() * 0.6), vrng() * 6.28];
    for (let k = 0; k < 4; k++) { vData.set(d, (i * 4 + k) * 4); vHj[(i * 4 + k) * 2] = HJ[k * 2]; vHj[(i * 4 + k) * 2 + 1] = HJ[k * 2 + 1]; }
    vIdx.set([0, 1, 2, 0, 2, 3].map((n) => i * 4 + n), i * 6);
  }
  const vGeo = new BufferGeometry();
  vGeo.setAttribute('position', new BufferAttribute(new Float32Array(VIND_ANTAL * 12), 3));
  vGeo.setAttribute('aData', new BufferAttribute(vData, 4));
  vGeo.setAttribute('aHj', new BufferAttribute(vHj, 2));
  vGeo.setIndex(new BufferAttribute(vIdx, 1));
  const vMat = new ShaderMaterial({
    vertexShader: VIND_VS, fragmentShader: VIND_FS, transparent: true, depthTest: true, depthWrite: false,
    blending: NormalBlending, side: DoubleSide,   // modvind spejler firkanten — uden DoubleSide forsvinder den
    uniforms: {
      uTid: { value: 0 }, uDrift: { value: 0 }, uKamera: { value: { x: 0, y: 0 } }, uBoks: { value: boks },
      uStyrke: { value: 0 }, uStoed: { value: 0 }, uRet: { value: 1 },
      uFarve: { value: v3(VIND_FARVE.solskin[0]) }, uGlobal: { value: VIND_FARVE.solskin[1] },
    },
  });
  const striber = new Mesh(vGeo, vMat);
  striber.frustumCulled = false;
  striber.renderOrder = Z.fjernVejr;
  striber.position.z = Z.fjernVejr;
  scene.add(striber);

  function byg(type) {
    ryd();
    const o = OPSAET[type];
    nu = type;
    if (!o) return;
    const data = new Float32Array(o.antal * 4);
    for (let i = 0; i < o.antal; i++) {
      data[i * 4]     = rng() * boks.x - boks.x / 2;
      data[i * 4 + 1] = rng() * boks.y - boks.y / 2;
      data[i * 4 + 2] = kvant(0.7 + rng() * 0.6);
      data[i * 4 + 3] = rng() * 6.28;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(o.antal * 3), 3));
    geo.setAttribute('aData', new BufferAttribute(data, 4));
    mat = new ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: true, depthWrite: false,
      uniforms: {
        uTid: { value: 0 }, uDrift: { value: 0 },
        uKamera: { value: { x: 0, y: 0 } },
        uBoks: { value: boks },
        uFaldfart: { value: o.faldfart },
        uVimse: { value: o.vimse },
        uStoerrelse: { value: o.stoerrelse },
        uFarve: { value: v3(o.farve) },
        uGlobal: { value: o.alpha },
      },
    });
    punkter = new Points(geo, mat);
    punkter.frustumCulled = false;
    punkter.renderOrder = Z.naertVejr;
    punkter.position.z = Z.naertVejr;
    scene.add(punkter);
  }

  function ryd() {
    if (!punkter) return;
    scene.remove(punkter);
    punkter.geometry.dispose(); punkter.material.dispose();
    punkter = null; mat = null;
  }

  return {
    saetType(t) {
      if (t === nu) return;
      byg(t);
      const [farve, alpha] = VIND_FARVE[t] || VIND_FARVE.andet;
      vMat.uniforms.uFarve.value = v3(farve);
      vMat.uniforms.uGlobal.value = alpha;
    },
    /** tid i sekunder; vind = world.vindNu(); t = vindTilstand(...) (valgfri). */
    opdater(tid, vind, t = null) {
      const dt = sidstTid === null ? 0 : Math.max(0, Math.min(0.1, tid - sidstTid));
      sidstTid = tid;
      glatW += (vind - glatW) * (1 - Math.exp(-VIND_GLAT * dt));
      drift = (drift + glatW * VIND_FART * dt) % DRIFT_LOFT;
      const u = vMat.uniforms;
      u.uTid.value = tid;
      u.uDrift.value = drift;
      u.uKamera.value.x = kamera.position.x;
      u.uKamera.value.y = kamera.position.y;
      u.uStyrke.value = Math.abs(glatW) < 0.025 ? 0 : Math.min(1, Math.abs(glatW) / VIND_FULD);
      u.uStoed.value = t ? t.stoed : 0;
      u.uRet.value = glatW >= 0 ? 1 : -1;
      if (!mat) return;
      mat.uniforms.uTid.value = tid;
      mat.uniforms.uDrift.value = drift;
      mat.uniforms.uKamera.value.x = kamera.position.x;
      mat.uniforms.uKamera.value.y = kamera.position.y;
      punkter.position.x = 0; punkter.position.y = 0;
    },
    fjern() {
      ryd();
      scene.remove(striber); vGeo.dispose(); vMat.dispose();
    },
  };
}
