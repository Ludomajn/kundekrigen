/* Kundekrigen — planter og småting OVEN PÅ terrænet.
 *
 * Græstotter, blomster, svampe, buske, siv, sten og bæverens egne pindebunker
 * står langs overfladen og svajer i vinden. Det er dem, der får en bane til
 * at ligne et sted frem for en silhuet.
 *
 * Én geometri, ét drawcall: hver ting er en quad med sin fod, størrelse,
 * atlascelle og svajfaktor som attributter. Svajet regnes i vertex-shaderen.
 *
 * Hvor tingene står, bestemmer banen selv (terraen.pynt, sat af
 * baneregler.placerPynt efter banetypens tema): rigtig kontakt med jorden,
 * tilfældig spejling, en tæthed pr. tema, aldrig klumper og aldrig ved en
 * startplads. Baner uden egen liste får den gamle placering langs græsset.
 *
 * Ren præsentation. Når et krater fjerner jorden under en ting, skjules den
 * — tjekket laves kun i det snavsede rektangel, som carve() rapporterer.
 */
'use strict';

import {
  BufferGeometry, BufferAttribute, ShaderMaterial, Mesh, CanvasTexture, LinearFilter, Vector2,
} from '../three.js';
import { Z } from './renderer.js';
import { lavRng } from '../core/rng.js';
import { VAND_NIVEAU } from '../sim/terrain_gen.js';
import { lavPyntAtlas, PYNT_TYPER, PYNT_CELLE, PYNT_KOL } from './kunst.js';

const VS = `
attribute vec2 aHjoerne;
attribute vec2 aFod;
attribute float aStr;
attribute vec2 aCelle;
attribute float aSvaj;
attribute float aSynlig;
attribute float aSpejl;
uniform float uTid;
uniform float uVind;
uniform vec2 uCelleUv;
varying vec2 vUv;
varying float vSynlig;
void main() {
  vec2 p = aHjoerne * aStr;
  // Toppen svajer, foden står fast. Vinden skubber hele planten til den
  // ene side, og en langsom bølge løber hen over banen.
  float top = aHjoerne.y;
  float boelge = sin(uTid * 1.7 + aFod.x * 0.021) + 0.4 * sin(uTid * 3.1 + aFod.x * 0.057);
  p.x += top * top * aSvaj * aStr * (0.035 * boelge + uVind * 0.0009);
  vec2 wp = aFod + p;
  vUv = aCelle + vec2(aSpejl > 0.0 ? aHjoerne.x + 0.5 : 0.5 - aHjoerne.x, aHjoerne.y) * uCelleUv;
  vSynlig = aSynlig;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 0.0, 1.0);
}`;

const FS = `
precision highp float;
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vSynlig;
void main() {
  if (vSynlig < 0.5) discard;
  vec4 c = texture2D(uAtlas, vUv);
  if (c.a < 0.04) discard;
  gl_FragColor = c;
}`;

/* Vægte for hvad der vokser hvor. Tæt på vandet gror siv. */
const VAEGTE = {
  tot1: 16, tot2: 14, tot3: 12, tot4: 10, blomst_gul: 5, blomst_hvid: 4,
  svamp: 3, svampe: 3, sten1: 5, sten2: 4, busk: 4, siv: 0, kogle: 2,
  pinde: 2, bregne: 5, kloever: 5,
};
const VAEGTE_KYST = { ...VAEGTE, siv: 40, tot4: 16, busk: 1, svamp: 0, svampe: 0 };

function vaelger(vaegte, rng) {
  const liste = PYNT_TYPER.map((t, i) => [i, vaegte[t.navn] || 0]);
  const sum = liste.reduce((s, [, v]) => s + v, 0);
  return () => {
    let r = rng() * sum;
    for (const [i, v] of liste) { if ((r -= v) < 0) return i; }
    return 0;
  };
}

/** Banens egen pynt (baneregler.placerPynt): allerede placeret efter
 *  banetypens tema med rigtig kontakt, spejling og tæthed, og aldrig ved en
 *  startplads. Navnene slås op i atlasset. */
const TYPE_NR = new Map(PYNT_TYPER.map((t, i) => [t.navn, i]));
function fraBanen(pynt) {
  const ud = [];
  for (const p of pynt) {
    const type = TYPE_NR.get(p.navn);
    if (type === undefined) continue;
    ud.push({ x: p.x, y: p.y, type, str: (PYNT_CELLE / 3) * p.str, spejl: p.spejl });
  }
  return ud;
}

/** Den gamle placering (baner uden egen pynt): langs græsset, hvor der er fladt. */
function egenPlacering(terraen, overflader, froe) {
  const rng = lavRng((froe ^ 0x9a7e) >>> 0);
  const inde = vaelger(VAEGTE, rng);
  const kyst = vaelger(VAEGTE_KYST, rng);

  // Overfladepunkter grupperet per kolonne.
  const perKolonne = new Map();
  for (let i = 0; i < overflader.length; i += 2) {
    const x = overflader[i], y = overflader[i + 1];
    if (!perKolonne.has(x)) perKolonne.set(x, []);
    perKolonne.get(x).push(y);
  }

  const flad = (x, y) =>
    terraen.fast(x - 7, y - 4) && terraen.fast(x + 7, y - 4) &&
    !terraen.fast(x - 7, y + 7) && !terraen.fast(x + 7, y + 7) &&
    !terraen.fast(x, y + 46);

  const ting = [];
  for (let x = 30; x < terraen.w - 30; x += 9 + Math.floor(rng() * 26)) {
    const ys = perKolonne.get(x);
    if (!ys) continue;
    for (const y of ys) {
      if (y < VAND_NIVEAU + 6 || !flad(x, y)) continue;
      const vedKyst = y < VAND_NIVEAU + 70;
      const type = (vedKyst ? kyst : inde)();
      ting.push({
        x, y: y + 1, type,
        str: (PYNT_CELLE / 3) * (0.8 + rng() * 0.45),
        spejl: rng() < 0.5 ? 1 : -1,
      });
    }
  }
  return ting;
}

let atlasTex = null;
function hentAtlasTex() {
  if (atlasTex) return atlasTex;
  atlasTex = new CanvasTexture(lavPyntAtlas());
  atlasTex.minFilter = atlasTex.magFilter = LinearFilter;
  atlasTex.generateMipmaps = false;
  return atlasTex;
}

export function lavPyntView(scene, terraen, overflader, froe) {
  const ting = terraen.pynt ? fraBanen(terraen.pynt) : egenPlacering(terraen, overflader, froe);

  const n = ting.length;
  const hjoerne = new Float32Array(n * 8);
  const fod = new Float32Array(n * 8);
  const str = new Float32Array(n * 4);
  const celle = new Float32Array(n * 8);
  const svaj = new Float32Array(n * 4);
  const synlig = new Float32Array(n * 4).fill(1);
  const spejl = new Float32Array(n * 4);
  const idx = new Uint32Array(n * 6);

  const rk = Math.ceil(PYNT_TYPER.length / PYNT_KOL);
  const cu = 1 / PYNT_KOL, cv = 1 / rk;
  // Foden ligger 4 px over cellens bund i atlasset (se lavPyntAtlas).
  const fodOffset = 4 / PYNT_CELLE;
  const H = [[-0.5, -fodOffset], [0.5, -fodOffset], [0.5, 1 - fodOffset], [-0.5, 1 - fodOffset]];

  ting.forEach((t, i) => {
    const kol = t.type % PYNT_KOL, rae = Math.floor(t.type / PYNT_KOL);
    // CanvasTexture vendes (flipY): atlasets øverste række ligger øverst i v.
    const u0 = kol * cu, v0 = 1 - (rae + 1) * cv;
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      hjoerne[j * 2] = H[k][0]; hjoerne[j * 2 + 1] = H[k][1];
      fod[j * 2] = t.x; fod[j * 2 + 1] = t.y;
      str[j] = t.str;
      celle[j * 2] = u0; celle[j * 2 + 1] = v0 + fodOffset * cv;
      svaj[j] = PYNT_TYPER[t.type].svaj;
      spejl[j] = t.spejl;
    }
    const b = i * 4;
    idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  });

  const geo = new BufferGeometry();
  // three kræver en position-attribut for at kunne tegne; den bruges ikke.
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 12), 3));
  geo.setAttribute('aHjoerne', new BufferAttribute(hjoerne, 2));
  geo.setAttribute('aFod', new BufferAttribute(fod, 2));
  geo.setAttribute('aStr', new BufferAttribute(str, 1));
  geo.setAttribute('aCelle', new BufferAttribute(celle, 2));
  geo.setAttribute('aSvaj', new BufferAttribute(svaj, 1));
  geo.setAttribute('aSpejl', new BufferAttribute(spejl, 1));
  const synligAttr = new BufferAttribute(synlig, 1);
  geo.setAttribute('aSynlig', synligAttr);
  geo.setIndex(new BufferAttribute(idx, 1));

  const mat = new ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: {
      uAtlas: { value: hentAtlasTex() },
      uTid: { value: 0 },
      uVind: { value: 0 },
      uCelleUv: { value: new Vector2(cu, cv) },
    },
    transparent: true, depthTest: true, depthWrite: false,
  });

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.z = Z.terraen + 3;
  mesh.renderOrder = Z.genstande - 1;
  scene.add(mesh);

  return {
    antal: n,

    opdater(tid, vind) {
      mat.uniforms.uTid.value = tid;
      mat.uniforms.uVind.value = vind || 0;
    },

    /** Kaldes med carve()'s snavsede rektangel: skjul det, der mistede jorden. */
    ramt(s) {
      let aendret = false;
      for (let i = 0; i < n; i++) {
        const t = ting[i];
        if (t.x < s.x0 - 30 || t.x > s.x1 + 30 || t.y < s.y0 - 30 || t.y > s.y1 + 30) continue;
        const staar = terraen.fast(t.x, t.y - 3) && !terraen.fast(t.x, t.y + 10);
        const v = staar && synlig[i * 4] ? 1 : 0;
        if (v !== synlig[i * 4]) {
          synlig.fill(v, i * 4, i * 4 + 4);
          aendret = true;
        }
      }
      if (aendret) synligAttr.needsUpdate = true;
    },

    fjern() {
      scene.remove(mesh);
      geo.dispose(); mat.dispose();
    },
  };
}
