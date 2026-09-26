/* Kundekrigen — havet.
 *
 * Tegnet som i nyere Worms: flere lag bølger oven på hinanden, hver med sin
 * egen fart og fase, en hvid skumkam på toppen og en farve, der går fra lys
 * turkis ved overfladen til dyb blå. Lagene giver dybde; skumkammen gør det
 * helt tydeligt, hvor man drukner.
 *
 * Ét bagplan (foran terrænet, delvist dækkende) og to smalle bølgebånd foran
 * bæverne. Så en bæver, der vader, er synligt halvt neddykket.
 *
 * Bølgerne regnes i fragment-shaderen i verdenskoordinater, så planet kan
 * være én quad, og kammen er skarp uanset zoom.
 */
'use strict';

import { Mesh, PlaneGeometry, ShaderMaterial, DoubleSide } from '../three.js';
import { Z } from './renderer.js';

const VS = `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FS = `
precision highp float;
uniform float uTid, uNiveau, uForsk, uAmp, uFase, uFart, uAlpha, uBaand;
uniform vec3 uTop, uMidt, uDyb, uSkum;
varying vec2 vW;

float boelge(float x) {
  return uAmp * (0.55 * sin(x * 0.0105 + uTid * uFart + uFase)
               + 0.30 * sin(x * 0.0262 - uTid * uFart * 1.35 + uFase * 2.1)
               + 0.15 * sin(x * 0.0610 + uTid * 2.2 + uFase));
}

void main() {
  float s = uNiveau + uForsk + boelge(vW.x);
  float d = s - vW.y;
  if (d < 0.0) discard;

  vec3 c = mix(uTop, uMidt, smoothstep(0.0, 70.0, d));
  c = mix(c, uDyb, smoothstep(70.0, 420.0, d));

  // Skumkam og et lyst bånd lige under den.
  float kam = 1.0 - smoothstep(2.5, 4.5, d);
  float lysBaand = (1.0 - smoothstep(5.0, 14.0, d)) * 0.35;
  c = mix(c, uSkum, max(kam, lysBaand));

  // Små glimt, der driver langs overfladen.
  float g = sin(vW.x * 0.09 + uTid * 1.3 + uFase) * sin(vW.x * 0.037 - uTid * 0.8);
  float glimt = step(0.93, g) * (1.0 - smoothstep(8.0, 30.0, d)) * step(6.0, d);
  c = mix(c, uSkum, glimt * 0.7);

  float a = uAlpha;
  if (uBaand > 0.0) a *= 1.0 - smoothstep(uBaand * 0.35, uBaand, d);
  a = max(a, kam);
  gl_FragColor = vec4(c, a);
}`;

function v3(hex) {
  return { x: ((hex >> 16) & 255) / 255, y: ((hex >> 8) & 255) / 255, z: (hex & 255) / 255 };
}

export function lavVand(scene, terraen) {
  const B = terraen.w + 24000;
  const H = terraen.h + 400;

  const lav = (z, o) => {
    const mat = new ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true,
      depthTest: true, depthWrite: false, side: DoubleSide,
      uniforms: {
        uTid: { value: 0 }, uNiveau: { value: 0 },
        uForsk: { value: o.forsk }, uAmp: { value: o.amp }, uFase: { value: o.fase },
        uFart: { value: o.fart }, uAlpha: { value: o.alpha }, uBaand: { value: o.baand || 0 },
        uTop: { value: v3(o.top) }, uMidt: { value: v3(o.midt) },
        uDyb: { value: v3(0x0B2A3D) }, uSkum: { value: v3(0xEAF6F8) },
      },
    });
    const m = new Mesh(new PlaneGeometry(B, H), mat);
    m.renderOrder = z;
    m.position.z = z;
    m.visible = false;
    scene.add(m);
    return m;
  };

  const lag = [
    // Bagerst: selve havet. Næsten dækkende, så det, der er sunket, forsvinder.
    lav(Z.vandBag, { forsk: 0, amp: 7, fase: 0, fart: 1.1, alpha: 0.9, top: 0x3C9DBC, midt: 0x1C6689 }),
    // Foran bæverne: to smalle bølgebånd lidt lavere, der driver hver sin vej.
    lav(Z.vandFor, { forsk: -9, amp: 6, fase: 2.1, fart: -1.4, alpha: 0.55, baand: 60,
                     top: 0x55B4CF, midt: 0x2479A0 }),
    lav(Z.vandFor + 1, { forsk: -20, amp: 5, fase: 4.4, fart: 1.8, alpha: 0.5, baand: 70,
                         top: 0x3B98B8, midt: 0x1D6488 }),
  ];

  return {
    opdater(niveau, tid) {
      const synlig = niveau > 4;
      for (const m of lag) {
        m.visible = synlig;
        if (!synlig) continue;
        m.position.x = terraen.w / 2;
        // Planets top skal ligge over den højeste bølgetop.
        m.position.y = niveau + 40 - H / 2;
        m.material.uniforms.uTid.value = tid;
        m.material.uniforms.uNiveau.value = niveau;
      }
    },
    fjern() {
      for (const m of lag) {
        scene.remove(m); m.geometry.dispose(); m.material.dispose();
      }
    },
  };
}
