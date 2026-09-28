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
 *      Skyerne og tågen driver desuden MED VINDEN (en ophobet forskydning),
 *      så himlen fortæller, hvilken vej det blæser. Slået fra ved
 *      prefers-reduced-motion.
 *
 *   3. PERSPEKTIV VED ZOOM — kameraet er ortografisk (sigte og træfzoner skal
 *      være eksakte), men baggrunden opfører sig, som om kameraet kørte frem
 *      og tilbage: zoomer man ind, vokser de nære lag, mens de fjerne næsten
 *      står stille på skærmen, og parallaksen bliver stærkere. Hvert lag
 *      skaleres om kameraets midte med dybdeFaktor (camera.js). Ved det
 *      udsnit, lagene er komponeret til (REF_UDSNIT_H), ser alt ud som før.
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
import { dybdeFaktor, reduceretBevaegelse } from './camera.js';

// Lagene er malet og placeret til et udsnit på 860 wu i højden (det gamle
// standardudsyn). Ved det udsnit er perspektivskaleringen 1.
export const REF_UDSNIT_H = 860;
export const REF_LOEFT = 340;              // kameraets typiske højde over kystlinjen
export const FLISE_FORHOLD = 1546 / 2048;  // fliserne er 2048 x 1546 px
// Lagenes geometri i lokale wu: ud over banen til siderne og ned under flisen.
export const LAG_UDSTRAEK = { side: 9000, under: 1600 };

/**
 * Lagene, fjernest først. bund er flisens underkant i forhold til
 * kystlinjen, faktor lagets parallaksefaktor ved REF_UDSNIT_H, vind dets
 * vinddrift (wu/s ved vind 1): de høje skyer langsomt, de lave og tågen
 * hurtigere; bjergene og træerne står, hvor de står. bund-tallene er sat ud
 * fra lagenes målte indhold (se README), så trælinjer og bakkekamme lander i
 * læsbare højder over kystlinjen.
 */
export const LAG = [
  { navn: 'skybanke', flise: 'px_skybanke', fliseB: 2600, bund: -693, faktor: 0.05, vind: 6, o: { alpha: 0.95, drift: 5 } },
  { navn: 'fjernskyer', flise: 'px_fjernskyer', fliseB: 2400, bund: -1183, faktor: 0.07, vind: 8, o: { drift: 8 } },
  { navn: 'fjernskyer1', flise: 'px_fjernskyer1', fliseB: 2200, bund: -760, faktor: 0.11, vind: 10, o: { drift: 12 } },
  { navn: 'bakke2', flise: 'px_bakke2', fliseB: 2100, bund: -402, faktor: 0.16 },
  { navn: 'taage_fjern', taage: { antal: 7, yMin: 150, yMax: 330, farve: 0xEAF3F7, alpha: 0.5 }, faktor: 0.2, vind: 9 },
  { navn: 'bakke1', flise: 'px_bakke1', fliseB: 1800, bund: -340, faktor: 0.24 },
  { navn: 'skyer', flise: 'px_skyer', fliseB: 1700, bund: -634, faktor: 0.30, vind: 16, o: { drift: 17 } },
  { navn: 'buske', flise: 'px_buske', fliseB: 1250, bund: -190, faktor: 0.42 },
  { navn: 'fjerntraeer', flise: 'px_fjerntraeer', fliseB: 1400, bund: -215, faktor: 0.55 },
  { navn: 'taage_naer', taage: { antal: 5, yMin: 40, yMax: 170, farve: 0xF4F9FB, alpha: 0.45 }, faktor: 0.6, vind: 14 },
  { navn: 'traeer', flise: 'px_traeer', fliseB: 1100, bund: -174, faktor: 0.68, o: { svaj: 2 } },
];

/**
 * Et lags placering og skala (wu) for kameraet i (kx, ky) ved zoom zRel.
 * g er lagets effektive parallaksefaktor, og laget skaleres g / faktor om
 * kameraets midte. Ved zRel = 1 er g = faktor og skalaen 1, og placeringen
 * er præcis den gamle:
 *   x = kx * (1 - faktor) - off
 *   y = forankring + (ky - ref) * (1 - faktor)
 * — forankret i kystlinjen, så laget står stille i forhold til horisonten og
 * kun følger kameraet med sin egen andel. Ren funktion; skriver i ud.
 */
export function lagPlacering(faktor, kx, ky, zRel, forankring, ref, ud = { x: 0, y: 0, s: 1 }) {
  const g = dybdeFaktor(faktor, zRel);
  const s = g / faktor;
  const off = faktor < 0.35 ? 2200 : 1100;
  ud.s = s;
  ud.x = kx * (1 - g) - s * off;
  ud.y = ky * (1 - g) + g * ref + s * (forankring - ref);
  return ud;
}

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
uniform float uTid, uBredde, uForskyd;
attribute vec2 aBand;      // x: verdens-x, y: driftfart
varying vec2 vUv;
void main(){
  vUv = uv;
  // uForskyd: vindens ophobede drift (wu), lagt oven i båndets egen fart.
  float x = mod(aBand.x + uTid * aBand.y + uForskyd, uBredde);
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
uniform float uDisM, uAlpha, uTid, uSvaj, uVind, uDrift, uForskyd;
varying vec2 vLok;
void main(){
  float v = (vLok.y - uBund) / uFlise.y;
  if (v > 1.0) discard;
  // Under flisen gentages dens nederste række: bjergfoden fortsætter nedad.
  v = max(v, 0.003);
  // Svaj: toppen af træerne bevæger sig, foden står stille.
  float svaj = (sin(uTid * 1.2 + vLok.x * 0.018) * 0.6 + uVind * 0.05) * uSvaj * v * v;
  // uForskyd: vindens ophobede drift (wu, holdt inden for én flise).
  float u = (vLok.x + svaj + uTid * uDrift + uForskyd) / uFlise.x;
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

export function lavParallaks(scene, kamera, terraen, rng, vejr, opt = {}) {
  const B = terraen.w;
  const lag = [];
  // Vinddriften er valgfri egenbevægelse: fra ved prefers-reduced-motion,
  // medmindre kalderen bestemmer andet (opt.vinddrift).
  const vinddrift = () => (typeof opt.vinddrift === 'boolean' ? opt.vinddrift : !reduceretBevaegelse());
  let sidsteTid = -1;

  // Baggrunden forankres i KYSTLINJEN. Måltes lagene fra banens bund, ville
  // skoven stå under vandoverfladen — og et lag, der ikke er forankret i noget
  // i verden, glider synligt forkert, så snart kameraet bevæger sig lodret.
  const FORANKRING = terraen.vandNiveau ?? VAND_NIVEAU;
  const REF = FORANKRING + REF_LOEFT;    // typisk kamerahøjde under spil

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

  /** Byg ét lag og registrér det til opdatering.
   *  vindDrift: hvor mange wu/s laget driver med vinden ved vind 1 (skyer og
   *  tåge; 0 = står stille). */
  function tilfoej(navn, geo, mat, faktor, z, vindDrift = 0) {
    const m = new Mesh(geo, mat);
    m.renderOrder = z; m.position.z = z;
    m.frustumCulled = false;
    scene.add(m);
    const u = mat.uniforms;
    // De malede lag flytter teksturen (u = x + forskydning: modsat fortegn),
    // tågen flytter selve båndene. Forskydningen holdes inden for én
    // gentagelse, så shaderens float ikke mister præcision i en lang kamp.
    const erMalet = !!u.uTex;
    lag.push({
      navn, mesh: m, faktor,
      vindDrift, forskyd: 0, fortegn: erMalet ? -1 : 1,
      periode: erMalet ? u.uFlise.value.x : u.uBredde.value,
    });
    return m;
  }

  const taageMat = (hex, alpha) => new ShaderMaterial({
    vertexShader: TAAGE_VS, fragmentShader: TAAGE_FS,
    transparent: true, depthTest: true, depthWrite: false, side: DoubleSide,
    uniforms: { uTid: { value: 0 }, uBredde: { value: B * 0.7 + 4000 }, uForskyd: { value: 0 },
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
    const x0 = -LAG_UDSTRAEK.side, x1 = B + LAG_UDSTRAEK.side, y0 = bund - LAG_UDSTRAEK.under, y1 = bund + fliseH;
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
        uDrift: { value: o.drift || 0 }, uForskyd: { value: 0 },
      },
    });
    mat.userData.tex = tex;
    mat.userData.disM = o.disM;
    return [geo, mat];
  }

  // Hvert lag er en flise fra parallaksepakken med sin egen faktor (LAG,
  // fjernest først); skylagene DRIVER derudover vandret med egen fart.
  const px = (navn, fliseB, bund, o = {}) => {
    const fliseH = fliseB * FLISE_FORHOLD;
    return malet(fliseB, fliseH, bund, 1024 / fliseB,
                 (W, H) => flise(navn, W, H),
                 { dis: 0x2B4A5E, disM: 0, alpha: 1, ...o });
  };

  // Samme rækkefølge som altid, så rng trækkes i samme orden (tågebåndene).
  LAG.forEach((d, i) => {
    if (d.taage) {
      const tg = d.taage;
      tilfoej(d.navn, taagebaand(B * 0.7 + 4000, tg.antal, tg.yMin, tg.yMax, rng),
              taageMat(tg.farve, tg.alpha), d.faktor, Z.parallaks[i], d.vind || 0);
    } else {
      tilfoej(d.navn, ...px(d.flise, d.fliseB, d.bund, d.o || {}), d.faktor, Z.parallaks[i], d.vind || 0);
    }
  });
  const pl = { x: 0, y: 0, s: 1 };            // genbruges hver frame

  return {
    opdater(tid, vind) {
      const k = kamera.position;
      himmel.position.x = k.x; himmel.position.y = k.y;
      himmel.scale.set(kamera.right - kamera.left + 60, kamera.top - kamera.bottom + 60, 1);

      // Perspektiv ved zoom: udsnittets højde i forhold til det, lagene er
      // komponeret til. Ind (zRel < 1) = kameraet kører frem.
      const zRel = (kamera.top - kamera.bottom) / REF_UDSNIT_H;
      const dt = sidsteTid < 0 ? 0 : Math.max(0, Math.min(0.1, tid - sidsteTid));
      sidsteTid = tid;
      const driv = vinddrift() && Number.isFinite(vind);

      for (const l of lag) {
        lagPlacering(l.faktor, k.x, k.y, zRel, FORANKRING, REF, pl);
        l.mesh.scale.set(pl.s, pl.s, 1);
        l.mesh.position.x = pl.x;
        l.mesh.position.y = pl.y;
        const u = l.mesh.material.uniforms;
        if (u?.uTid) u.uTid.value = tid;
        if (u?.uVind) u.uVind.value = vind;
        if (l.vindDrift && driv) {
          l.forskyd = (l.forskyd + l.fortegn * vind * l.vindDrift * dt) % l.periode;
          u.uForskyd.value = l.forskyd;
        }
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


