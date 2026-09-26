/* Kundekrigen — terrænets udseende.
 *
 * Tre teksturer:
 *   maskeTex  RG8, LIVE. Autoritativ, opdateres af carve().
 *   jordTex   1024², gentaget: illustreret jord med sten, klumper og rødder.
 *   pyntTex   banens egen, bagt ved start: græs langs den OPRINDELIGE
 *             overflade, græsfrynser i luften over den, ting begravet i
 *             jorden og grundfjeld. Se kunst.js.
 *
 * Græsset er bagt, mens kraterranden og konturen beregnes LIVE fra masken.
 * Et friskt krater får derfor bar, afbidt jordkant med mørk streg, mens urørt
 * terræn beholder sin bevoksning — Worms-opførsel helt uden bogholderi.
 *
 * carve() er eneste mutator, så fysikmasken og den tegnede maske kan
 * strukturelt ikke drive fra hinanden.
 *
 * Maskens G-kanal bærer materialet: 255 = murværk (fortene, tegnes som
 * mursten i shaderen), 128 = luft inde i et fortrum (bagvæg, kun grafik),
 * 0 = alt andet. R-kanalen er uændret "fast eller luft".
 */
'use strict';

import {
  DataTexture, RGFormat, UnsignedByteType, LinearFilter, LinearMipmapLinearFilter,
  ClampToEdgeWrapping, RepeatWrapping, CanvasTexture,
  Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3,
} from '../three.js';
import { Z } from './renderer.js';
import { LUFT, MUR } from '../sim/terrain.js';
import { VAND_NIVEAU } from '../sim/terrain_gen.js';
import { lavJordtekstur, bagTerraenPynt } from './kunst.js';

const VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FS = `
precision highp float;
uniform sampler2D uMaske;
uniform sampler2D uJord;
uniform sampler2D uPynt;
uniform vec2  uTexel;
uniform vec2  uBane;
uniform vec3  uSolLys;
uniform float uVand;
varying vec2 vUv;

float m(vec2 uv) { return texture2D(uMaske, uv).r; }
float mo(float dx, float dy) { return m(vUv + vec2(uTexel.x * dx, uTexel.y * dy)); }

float hash12(vec2 q) {
  vec3 p3 = fract(vec3(q.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Mursten i verdenskoordinater: 13 wu høje skifter, 30 wu lange sten i
// forbandt, lyse fuger. Langt ude går mønsteret i ét med en middelfarve i
// stedet for at flimre. aa = hvor mange wu én skærmpixel dækker; den regnes
// i main(), før nogen gren, fordi fwidth kun er defineret i ensartet flow.
vec3 mursten(vec2 wp, float aa) {
  float RH = 13.0, SL = 30.0;
  float skifte = floor(wp.y / RH);
  float u = wp.x / SL + 0.5 * mod(skifte, 2.0);
  float sten = floor(u);
  vec2 f = vec2(fract(u) * SL, fract(wp.y / RH) * RH);
  float fb = 1.7;
  float fuge = max(1.0 - smoothstep(fb - aa, fb + aa, f.x),
                   1.0 - smoothstep(fb - aa, fb + aa, f.y));
  float n = hash12(vec2(sten, skifte));
  vec3 sc = mix(vec3(0.60, 0.31, 0.22), vec3(0.76, 0.47, 0.33), n);
  if (n > 0.88) sc = vec3(0.50, 0.27, 0.21);
  sc *= 0.88 + 0.16 * smoothstep(0.0, RH, f.y);
  vec3 ud = mix(sc, vec3(0.80, 0.74, 0.64), fuge);
  return mix(ud, vec3(0.66, 0.42, 0.31), smoothstep(1.2, 3.5, aa) * 0.8);
}

void main() {
  float c0 = m(vUv);
  float g0 = texture2D(uMaske, vUv).g;
  vec4 p = texture2D(uPynt, vUv);
  vec2 wp = vUv * uBane;
  float aa = max(fwidth(wp.x), fwidth(wp.y));

  // ---- LUFT: græsfrynser, så længe der stadig er jord under dem — og inde
  // i fortets rum en bagvæg (ren grafik; kunderne går og skyder igennem den).
  if (c0 < 0.5) {
    if (p.a >= 0.5 && mo(0.0, -10.0) >= 0.5) { gl_FragColor = vec4(p.rgb, 1.0); return; }
    // Bagvæg: G = 0.5 over R = 0. Langs en murkant stiger R og G sammen
    // (lineær filtrering): G - R = 0.5 - 0.5 R, som er >= 0.25 helt ud til
    // R = 0.5, hvor murgrenen tager over — ingen revne mod baggrunden.
    float bag = smoothstep(0.16, 0.26, g0 - c0);
    if (bag < 0.5) discard;
    vec3 bv = mursten(wp, aa);
    bv = mix(bv, vec3(dot(bv, vec3(0.3, 0.5, 0.2))), 0.4) * 0.44;
    // Skygge under loftet og langs væggene, så rummet får dybde.
    float skygge = mo(0.0, 7.0) * 0.30 + mo(0.0, 18.0) * 0.20
                 + max(mo(7.0, 0.0), mo(-7.0, 0.0)) * 0.22;
    bv *= 1.0 - skygge;
    gl_FragColor = vec4(bv, 1.0);
    return;
  }

  // ---- ALBEDO: gentaget jordtekstur, med bagt græs og begravede ting ovenpå.
  // Murværket får mursten i stedet (og har intet græs i pyntelaget).
  float erMur = smoothstep(0.7, 0.9, g0);
  vec3 jord = texture2D(uJord, wp / 1024.0).rgb;
  vec3 col = mix(jord, p.rgb, p.a);
  col = mix(col, mursten(wp, aa), erMur);

  // ---- AFSTAND TIL LUFT, i tre ringe. Ét tal, der bruges til kontur,
  // kraterrand og lys, så de altid følger hinanden præcist.
  float r2 = min(min(min(mo(2.5,0.0), mo(-2.5,0.0)), min(mo(0.0,2.5), mo(0.0,-2.5))),
                 min(min(mo(1.8,1.8), mo(-1.8,1.8)), min(mo(1.8,-1.8), mo(-1.8,-1.8))));
  float r4 = min(min(min(mo(4.5,0.0), mo(-4.5,0.0)), min(mo(0.0,4.5), mo(0.0,-4.5))),
                 min(min(mo(3.2,3.2), mo(-3.2,3.2)), min(mo(3.2,-3.2), mo(-3.2,-3.2))));
  float r9 = min(min(min(mo(9.0,0.0), mo(-9.0,0.0)), min(mo(0.0,9.0), mo(0.0,-9.0))),
                 min(min(mo(6.4,6.4), mo(-6.4,6.4)), min(mo(6.4,-6.4), mo(-6.4,-6.4))));

  // ---- NORMAL FRA MASKEN — kanten vender et sted hen, og lyset kan læse det.
  vec2 grad = vec2(mo(-6.0,0.0) - mo(6.0,0.0), mo(0.0,-6.0) - mo(0.0,6.0));
  float glen = length(grad);
  vec2 n = glen > 0.001 ? grad / glen : vec2(0.0, 1.0);
  float lys = dot(n, normalize(vec2(-0.45, 1.0)));

  // ---- KRATERRAND: hvor der ikke er græs, får kanten et mørkt, afbidt bånd
  // med en lys læbe yderst — Worms' kendetegn ved nye huller.
  float naer9 = 1.0 - r9;
  float graes = smoothstep(0.2, 0.7, p.a);
  vec3 randFarve = vec3(0.30, 0.20, 0.13);
  col = mix(col, randFarve, naer9 * mix(0.55, 0.2, erMur) * (1.0 - graes));
  float laebe = (1.0 - r4) * r2;
  col += vec3(0.22, 0.17, 0.10) * laebe * max(lys, 0.0) * (1.0 - graes * 0.6);

  // ---- LYS PÅ FORMEN: opadvendte kanter lysere, nedadvendte mørkere.
  float kant = 1.0 - r9;
  col *= 1.0 + 0.16 * lys * kant;

  // ---- DYBDE: jord med meget jord OVER sig bliver gradvist mørkere, så
  // bjergene får masse, og hulerne bliver hule.
  float over = mo(0.0, 40.0) + mo(0.0, 110.0) + mo(0.0, 220.0);
  col *= 1.0 - (over / 3.0) * 0.22;
  // Undersider i skygge: under et overhæng er der ingen himmel.
  float under = 1.0 - mo(0.0, -14.0);
  col *= 1.0 - under * 0.18;

  // ---- KONTUR: tyk, mørk streg langs hele silhuetten. Det er den ene
  // ting, der mest får terrænet til at ligne illustration frem for foto.
  float kontur = 1.0 - smoothstep(0.35, 0.85, r2);
  vec3 konturFarve = mix(mix(vec3(0.11, 0.075, 0.05), vec3(0.10, 0.20, 0.08), graes),
                         vec3(0.16, 0.10, 0.09), erMur);
  col = mix(col, konturFarve, kontur * 0.92);

  // ---- UNDER VAND
  float vy = wp.y;
  if (vy < uVand) {
    float dyb = clamp((uVand - vy) / 260.0, 0.0, 1.0);
    col = mix(col, vec3(0.04, 0.20, 0.27), 0.35 + dyb * 0.45);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

export function lavTerraenView(scene, terraen, froe) {
  const { w, h } = terraen;

  // To kanaler: R = fast, G = materiale (se toppen af filen).
  const rum = terraen.fort?.rum || null;
  const maskeData = new Uint8Array(w * h * 2);
  opdaterMaskeData(maskeData, terraen, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, rum);
  const maskeTex = new DataTexture(maskeData, w, h, RGFormat, UnsignedByteType);
  maskeTex.minFilter = maskeTex.magFilter = LinearFilter;
  maskeTex.wrapS = maskeTex.wrapT = ClampToEdgeWrapping;
  maskeTex.generateMipmaps = false;
  maskeTex.flipY = false;
  maskeTex.needsUpdate = true;

  const jordTex = new CanvasTexture(lavJordtekstur(froe));
  jordTex.wrapS = jordTex.wrapT = RepeatWrapping;
  jordTex.minFilter = LinearMipmapLinearFilter;
  jordTex.magFilter = LinearFilter;
  jordTex.generateMipmaps = true;

  const pynt = bagTerraenPynt(terraen, froe, VAND_NIVEAU);
  const pyntTex = new CanvasTexture(pynt.canvas);
  pyntTex.minFilter = pyntTex.magFilter = LinearFilter;
  pyntTex.generateMipmaps = false;

  const mat = new ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: {
      uMaske: { value: maskeTex },
      uJord: { value: jordTex },
      uPynt: { value: pyntTex },
      uTexel: { value: new Vector2(1 / w, 1 / h) },
      uBane: { value: new Vector2(w, h) },
      uSolLys: { value: farve(0xFFE6AC) },
      uVand: { value: 0 },
    },
  });

  const mesh = new Mesh(new PlaneGeometry(w, h), mat);
  mesh.position.set(w / 2, h / 2, Z.terraen);
  scene.add(mesh);

  return {
    mesh, maskeTex, materiale: mat,
    overflader: pynt.overflader,

    /** Kaldes hver frame. Uploader KUN det snavsede rektangel. */
    opdater() {
      const s = terraen.tagSnavs();
      if (!s) return null;
      opdaterMaskeData(maskeData, terraen, s, rum);
      // Delvis upload via three's texture-update: vi markerer hele teksturen,
      // men holder data i samme buffer. For de kraterstørrelser spillet
      // bruger, er det hurtigt nok og har ingen revisionsafhængige kald.
      maskeTex.needsUpdate = true;
      return s;
    },

    saetVand(v) { mat.uniforms.uVand.value = v; },
    fjern() {
      scene.remove(mesh);
      mesh.geometry.dispose(); mat.dispose();
      maskeTex.dispose(); jordTex.dispose(); pyntTex.dispose();
    },
  };
}

function opdaterMaskeData(ud, t, s, rum) {
  const { w, h, maske } = t;
  for (let y = s.y0; y <= s.y1; y++) {
    const kilde = (h - 1 - y) * w;
    const maal = y * w;                    // flipY=false -> tekstur har y opad
    for (let x = s.x0; x <= s.x1; x++) {
      const v = maske[kilde + x];
      const i = (maal + x) * 2;
      ud[i] = v === LUFT ? 0 : 255;
      ud[i + 1] = v === MUR ? 255 : 0;
    }
    // Bagvæggen: luft inde i et fortrum. Den bliver stående, når væggene
    // omkring sprænges — det er bygningens bagside, ikke en del af masken.
    if (rum) {
      for (const r of rum) {
        if (y < r.y0 || y > r.y1) continue;
        const a = Math.max(s.x0, r.x0), b = Math.min(s.x1, r.x1);
        for (let x = a; x <= b; x++) if (maske[kilde + x] === LUFT) ud[(maal + x) * 2 + 1] = 128;
      }
    }
  }
}

function farve(hex) {
  return new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}
