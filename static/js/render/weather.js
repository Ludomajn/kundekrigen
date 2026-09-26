/* Kundekrigen — vejr.
 *
 * REN GPU, nul CPU per frame. Hver partikels attributter uploades ÉN gang, og
 * positionen regnes analytisk i vertex-shaderen ud fra uTid, uVind og
 * kameraets position, med wrap inden for en boks der følger kameraet.
 *
 * Vejret påvirker spillet UDELUKKENDE gennem vindvarians (se turn.js) —
 * aldrig gennem skjult fysik, for så ville HUD'en lyve for spilleren.
 */
'use strict';

import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending,
} from '../three.js';
import { Z } from './renderer.js';
import { HEX } from './palette.js';

const VS = `
uniform float uTid; uniform float uVind; uniform vec2 uKamera;
uniform vec2 uBoks; uniform float uFaldfart; uniform float uVimse;
uniform float uStoerrelse;
attribute vec4 aData;        // x0, y0, fart, fase
varying float vAlpha;
void main() {
  float fart = aData.z;
  float x = aData.x + uVind * uTid * fart * 0.55
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

  function byg(type) {
    ryd();
    const o = OPSAET[type];
    nu = type;
    if (!o) return;
    const data = new Float32Array(o.antal * 4);
    for (let i = 0; i < o.antal; i++) {
      data[i * 4]     = rng() * boks.x - boks.x / 2;
      data[i * 4 + 1] = rng() * boks.y - boks.y / 2;
      data[i * 4 + 2] = 0.7 + rng() * 0.6;
      data[i * 4 + 3] = rng() * 6.28;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(o.antal * 3), 3));
    geo.setAttribute('aData', new BufferAttribute(data, 4));
    mat = new ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: true, depthWrite: false,
      uniforms: {
        uTid: { value: 0 }, uVind: { value: 0 },
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
    saetType(t) { if (t !== nu) byg(t); },
    opdater(tid, vind) {
      if (!mat) return;
      mat.uniforms.uTid.value = tid;
      mat.uniforms.uVind.value = vind;
      mat.uniforms.uKamera.value.x = kamera.position.x;
      mat.uniforms.uKamera.value.y = kamera.position.y;
      punkter.position.x = 0; punkter.position.y = 0;
    },
    fjern: ryd,
  };
}
