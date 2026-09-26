/* Kundekrigen — flerlags baggrund med DYNAMISK DYBDE.
 *
 * To slags bevægelse, og det er kombinationen der giver dybden:
 *
 *   1. PARALLAKSE — hvert lag forskydes efter kameraet med sin egen faktor.
 *      Lagene flyttes ikke; hele laget offsettes: x = kamera.x * (1 - faktor).
 *      Det er både billigere og fri for de sømme, man får ved at wrappe
 *      geometri.
 *
 *   2. EGENBEVÆGELSE — skyer driver, tågebånd siver, og trælagene svajer, hver
 *      med sin egen hastighed og fase. Det er dét, der gør, at baggrunden
 *      lever, når kameraet står stille, i stedet for at være et postkort.
 *
 * Atmosfærisk perspektiv: fjerne lag trækkes mod himmelfarven og bliver
 * lysere og mindre mættede. Det er den enkeltting, der sælger afstand bedst.
 */
'use strict';

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, ShaderMaterial,
  PlaneGeometry, DoubleSide,
} from '../three.js';
import { Z } from './renderer.js';
import { CanvasTexture, RepeatWrapping, ClampToEdgeWrapping, LinearFilter,
         LinearMipmapLinearFilter } from '../three.js';
import { hent } from './assets.js';
import { VAND_NIVEAU } from '../sim/terrain_gen.js';

const v3 = (hex) => ({ x: ((hex >> 16) & 255) / 255, y: ((hex >> 8) & 255) / 255, z: (hex & 255) / 255 });

/* ------------------------------------------------------------------ himmel */

const HIMMEL_VS = `varying vec2 vUv; void main(){ vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

const HIMMEL_FS = `
precision mediump float;
uniform vec3 uTop, uMidt, uBund, uSol;
uniform vec2 uSolPos;
uniform float uSolStyrke;
varying vec2 vUv;
void main(){
  // Tre stop i stedet for to: en himmel med en varm underkant læses som luft,
  // en lineær gradient læses som en flade.
  vec3 c = vUv.y > 0.5
    ? mix(uMidt, uTop, (vUv.y - 0.5) * 2.0)
    : mix(uBund, uMidt, vUv.y * 2.0);
  float d = distance(vUv * vec2(1.8, 1.0), uSolPos * vec2(1.8, 1.0));
  c += uSol * uSolStyrke * exp(-d * 3.2);
  gl_FragColor = vec4(c, 1.0);
}`;

/* ------------------------------------------------------------------ svaj */

/* ------------------------------------------------------------------ tåge */

const TAAGE_VS = `
uniform float uTid, uBredde;
attribute vec2 aBand;      // x: verdens-x, y: driftfart
varying vec2 vUv;
void main(){
  vUv = uv;
  float x = mod(aBand.x + uTid * aBand.y, uBredde);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x + x, position.y, 0.0, 1.0);
}`;

const TAAGE_FS = `
precision mediump float;
uniform vec3 uFarve; uniform float uAlpha;
varying vec2 vUv;
void main(){
  float a = (1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.5) * 2.0))
          * (1.0 - smoothstep(0.3, 0.5, abs(vUv.x - 0.5)));
  gl_FragColor = vec4(uFarve, a * uAlpha);
}`;

/* --------------------------------------------------------- malede lag */

const MALET_VS = `
varying vec2 vLok;
void main(){
  vLok = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MALET_FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uFlise;          // flisens bredde og højde i wu
uniform float uBund;          // flisens underkant i lagets lokale y
uniform vec3 uDis;
uniform float uDisM, uAlpha, uTid, uSvaj, uVind, uDrift;
varying vec2 vLok;
void main(){
  float v = (vLok.y - uBund) / uFlise.y;
  if (v > 1.0) discard;
  // Under flisen gentages dens nederste række: bjergfoden fortsætter nedad.
  v = max(v, 0.003);
  // Svaj: toppen af træerne bevæger sig, foden står stille.
  float svaj = (sin(uTid * 1.2 + vLok.x * 0.018) * 0.6 + uVind * 0.05) * uSvaj * v * v;
  float u = (vLok.x + svaj + uTid * uDrift) / uFlise.x;
  vec4 c = texture2D(uTex, vec2(u, v));
  if (c.a < 0.01) discard;
  gl_FragColor = vec4(mix(c.rgb, uDis, uDisM), c.a * uAlpha);
}`;

/* ------------------------------------------------------------ geometribyg */

function taagebaand(bredde, antal, yMin, yMax, rng) {
  const pos = [], uvs = [], band = [];
  for (let i = 0; i < antal; i++) {
    const cx = rng() * bredde;
    const cy = yMin + rng() * (yMax - yMin);
    const w = 900 + rng() * 1400, h = 90 + rng() * 150;
    const fart = (rng() < 0.5 ? -1 : 1) * (4 + rng() * 11);
    const x0 = -w / 2, x1 = w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    for (let k = 0; k < 6; k++) band.push(cx, fart);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('aBand', new BufferAttribute(new Float32Array(band), 2));
  return g;
}

/* ------------------------------------------------------------------ lag */

export function lavParallaks(scene, kamera, terraen, rng, vejr) {
  const B = terraen.w;
  const lag = [];

  // Baggrunden forankres i KYSTLINJEN. Måltes lagene fra banens bund, ville
  // skoven stå under vandoverfladen — og et lag, der ikke er forankret i noget
  // i verden, glider synligt forkert, så snart kameraet bevæger sig lodret.
  const FORANKRING = terraen.vandNiveau ?? VAND_NIVEAU;
  const REF = FORANKRING + 340;          // typisk kamerahøjde under spil

  // --- himmel (fastgjort til kameraet)
  const himmelMat = new ShaderMaterial({
    vertexShader: HIMMEL_VS, fragmentShader: HIMMEL_FS,
    depthTest: false, depthWrite: false,
    uniforms: {
      uTop: { value: v3(0x46C0B4) }, uMidt: { value: v3(0xA9E6E0) },
      uBund: { value: v3(0xF0FAF4) }, uSol: { value: v3(0xFFE6AC) },
      uSolPos: { value: { x: 0.74, y: 0.82 } }, uSolStyrke: { value: 0.55 },
    },
  });
  const himmel = new Mesh(new PlaneGeometry(1, 1), himmelMat);
  himmel.renderOrder = Z.himmel; himmel.position.z = Z.himmel;
  himmel.frustumCulled = false;
  scene.add(himmel);

  /** Byg ét lag og registrér det til opdatering. */
  function tilfoej(navn, geo, mat, faktor, z, egendrift = 0) {
    const m = new Mesh(geo, mat);
    m.renderOrder = z; m.position.z = z;
    m.frustumCulled = false;
    scene.add(m);
    lag.push({ navn, mesh: m, faktor, egendrift });
    return m;
  }

  const taageMat = (hex, alpha) => new ShaderMaterial({
    vertexShader: TAAGE_VS, fragmentShader: TAAGE_FS,
    transparent: true, depthTest: true, depthWrite: false, side: DoubleSide,
    uniforms: { uTid: { value: 0 }, uBredde: { value: B * 0.7 + 4000 },
                uFarve: { value: v3(hex) }, uAlpha: { value: alpha } },
  });

  /** Et parallakselag fra pakken, tegnet ned i halv opløsning som flise.
   *  Lagene har alfa i forvejen; vores vejr-himmel ligger bagest. */
  function flise(navn, W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = hent(navn);
    if (img) g.drawImage(img, 0, 0, W, H);
    return c;
  }

  /** Et malet lag: én kæmpe quad, hvor flisen gentages vandret i shaderen. */
  function malet(fliseB, fliseH, bund, pxPrWu, mal, o) {
    const W = Math.round(fliseB * pxPrWu), H = Math.round(fliseH * pxPrWu);
    const tex = new CanvasTexture(mal(W, H));
    tex.wrapS = RepeatWrapping; tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearMipmapLinearFilter; tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    const x0 = -9000, x1 = B + 9000, y0 = bund - 1600, y1 = bund + fliseH;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([
      x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0]), 3));
    const mat = new ShaderMaterial({
      vertexShader: MALET_VS, fragmentShader: MALET_FS,
      transparent: true, depthTest: true, depthWrite: false, side: DoubleSide,
      uniforms: {
        uTex: { value: tex }, uFlise: { value: { x: fliseB, y: fliseH } }, uBund: { value: bund },
        uDis: { value: v3(o.dis) }, uDisM: { value: o.disM }, uAlpha: { value: o.alpha },
        uTid: { value: 0 }, uSvaj: { value: o.svaj || 0 }, uVind: { value: 0 },
        uDrift: { value: o.drift || 0 },
      },
    });
    mat.userData.tex = tex;
    mat.userData.disM = o.disM;
    return [geo, mat];
  }

  // Rækkefølge: fjernest først. Hvert lag er en flise fra parallaksepakken
  // med sin egen faktor; skylagene DRIVER derudover vandret med egen fart.
  // bund-tallene er sat ud fra lagenes målte indhold (se README), så
  // trælinjer og bakkekamme lander i læsbare højder over kystlinjen.
  const px = (navn, fliseB, bund, o = {}) => {
    const fliseH = fliseB * (1546 / 2048);
    return malet(fliseB, fliseH, bund, 1024 / fliseB,
                 (W, H) => flise(navn, W, H),
                 { dis: 0x2B4A5E, disM: 0, alpha: 1, ...o });
  };

  tilfoej('skybanke', ...px('px_skybanke', 2600, -693, { alpha: 0.95, drift: 5 }),
          0.05, Z.parallaks[0]);
  tilfoej('fjernskyer', ...px('px_fjernskyer', 2400, -1183, { drift: 8 }),
          0.07, Z.parallaks[1]);
  tilfoej('fjernskyer1', ...px('px_fjernskyer1', 2200, -760, { drift: 12 }),
          0.11, Z.parallaks[2]);
  tilfoej('bakke2', ...px('px_bakke2', 2100, -402),
          0.16, Z.parallaks[3]);
  tilfoej('taage_fjern', taagebaand(B * 0.7 + 4000, 7, 150, 330, rng),
          taageMat(0xEAF3F7, 0.5), 0.2, Z.parallaks[4]);
  tilfoej('bakke1', ...px('px_bakke1', 1800, -340),
          0.24, Z.parallaks[5]);
  tilfoej('skyer', ...px('px_skyer', 1700, -634, { drift: 17 }),
          0.30, Z.parallaks[6]);
  tilfoej('buske', ...px('px_buske', 1250, -190),
          0.42, Z.parallaks[7]);
  tilfoej('fjerntraeer', ...px('px_fjerntraeer', 1400, -215),
          0.55, Z.parallaks[8]);
  tilfoej('taage_naer', taagebaand(B * 0.7 + 4000, 5, 40, 170, rng),
          taageMat(0xF4F9FB, 0.45), 0.6, Z.parallaks[9]);
  tilfoej('traeer', ...px('px_traeer', 1100, -174, { svaj: 2 }),
          0.68, Z.parallaks[10]);

  return {
    opdater(tid, vind) {
      const k = kamera.position;
      himmel.position.x = k.x; himmel.position.y = k.y;
      himmel.scale.set(kamera.right - kamera.left + 60, kamera.top - kamera.bottom + 60, 1);

      for (const l of lag) {
        // Parallaksen: lagene flyttes ikke, hele laget offsettes.
        l.mesh.position.x = k.x * (1 - l.faktor) - (l.faktor < 0.35 ? 2200 : 1100);
        // Forankret i kystlinjen: laget står stille i forhold til horisonten
        // og følger kun kameraet med sin egen andel af bevægelsen.
        l.mesh.position.y = FORANKRING + (k.y - REF) * (1 - l.faktor);
        const u = l.mesh.material.uniforms;
        if (u?.uTid) u.uTid.value = tid;
        if (u?.uVind) u.uVind.value = vind;
      }
    },

    saetVejr(v) {
      const graat = v === 'regn' || v === 'slud' || v === 'taage' || v === 'overskyet';
      const sne = v === 'sne';
      const u = himmelMat.uniforms;
      u.uTop.value = graat ? v3(0x587888) : sne ? v3(0x7F9BAE) : v3(0x46C0B4);
      u.uMidt.value = graat ? v3(0xAEC3CC) : sne ? v3(0xCFDFE8) : v3(0xA9E6E0);
      u.uBund.value = graat ? v3(0xD0DADD) : sne ? v3(0xEDF4F8) : v3(0xF0FAF4);
      u.uSolStyrke.value = graat ? 0.1 : sne ? 0.24 : 0.55;
      for (const l of lag) {
        const mu = l.mesh.material.uniforms;
        if (mu?.uTex) {
          // Gråvejr trækker de malede lag mod en kold, grå dis.
          mu.uDis.value = graat ? v3(0x9FB2BB) : sne ? v3(0xDCE7EE) : v3(0x2B4A5E);
          mu.uDisM.value = l.mesh.material.userData.disM + (graat ? 0.26 : sne ? 0.14 : 0);
        }
        if (l.navn.startsWith('taage')) {
          l.mesh.material.uniforms.uAlpha.value =
            v === 'taage' ? 0.95 : graat ? 0.68 : l.navn === 'taage_fjern' ? 0.5 : 0.42;
        }
      }
    },

    fjern() {
      scene.remove(himmel); himmel.geometry.dispose(); himmelMat.dispose();
      for (const l of lag) {
        scene.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.material.dispose();
        l.mesh.material.userData.tex?.dispose();
      }
    },
  };
}


