/* Kundekrigen — terrænets udseende.
 *
 * Fire teksturer:
 *   maskeTex  RG8, LIVE. Autoritativ, opdateres af carve().
 *   jordTex   1024², gentaget: illustreret jord med sten, klumper og rødder.
 *   pyntTex   banens egen, bagt ved start: græs langs den OPRINDELIGE
 *             overflade, græsfrynser i luften over den, ting begravet i
 *             jorden og grundfjeld. Se kunst.js.
 *   fortTex   RGBA8 over murværkets rektangel, bagt ved start: fortenes
 *             planker, sten og samlinger (bagFortFelt). 1x1 uden murværk.
 *
 * Græsset er bagt, mens kraterranden og konturen beregnes LIVE fra masken.
 * Et friskt krater får derfor bar, afbidt jordkant med mørk streg, mens urørt
 * terræn beholder sin bevoksning — Worms-opførsel helt uden bogholderi.
 *
 * carve() er eneste mutator, så fysikmasken og den tegnede maske kan
 * strukturelt ikke drive fra hinanden.
 *
 * Maskens G-kanal bærer materialet: 255 = murværk (fortene), 128 = luft inde
 * i et fortrum (bagvæg, kun grafik), 0 = alt andet. R-kanalen er uændret
 * "fast eller luft".
 *
 * Fortene tegnes som Worms' borge: kraftige træplanker med bolte langs hver
 * kant og åbning, mørkere huggede sten inde i de tykke partier, og dybe,
 * mørke rum. Hvad der er planke og hvad der er sten, bages ÉN gang ved start
 * fra det oprindelige murværk (fortTex, se bagFortFelt) — ligesom græsset.
 * Et krater flytter derfor ikke plankerne: det bider dem over og blotlægger
 * stenen bag dem med den samme afbidte rand som i jorden.
 */
'use strict';

import {
  DataTexture, RGFormat, RGBAFormat, UnsignedByteType, LinearFilter, LinearMipmapLinearFilter,
  ClampToEdgeWrapping, RepeatWrapping, CanvasTexture,
  Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4,
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
uniform sampler2D uFort;
uniform vec4  uFortBoks;
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

// Blød værdistøj (bilineær mellem hash-punkter), 0-1.
float vstoej(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Samme lys som resten af terrænet: fra oven, lidt fra venstre.
const vec2 LYSR = vec2(-0.41036, 0.91192);

// Fortets bagte felt (bagFortFelt): x = afstand fra pixelcentret til fortets
// oprindelige kant (0-31,9 wu), y = fortegnet afstand til stenkernen (-16 til
// 16, positiv i stenen). Fast LOD, fordi det kun læses i murgrenen.
vec2 fd(vec2 q) {
  vec2 v = textureLod(uFort, (q - uFortBoks.xy) / uFortBoks.zw, 0.0).rg * 31.875;
  return vec2(v.x, v.y - 16.0);
}
// Afstand til nærmeste plankesamling (gering, midt i et dæk), 0-31,9 wu.
float fsaml(vec2 q) {
  return textureLod(uFort, (q - uFortBoks.xy) / uFortBoks.zw, 0.0).b * 31.875;
}

// Huggede sten i verdenskoordinater: store blokke i forbandt, nogle delt i
// to, mørke fuger og en fas, der er lys foroven/til venstre og mørk forneden/
// til højre. aa = hvor mange wu én skærmpixel dækker (regnes i main(), før
// nogen gren, fordi fwidth kun er defineret i ensartet flow); fin tager de
// fine detaljer ud, når man zoomer langt ud, i stedet for at lade dem flimre.
vec3 sten(vec2 wp, float aa, float fin) {
  const float RH = 26.0, BL = 46.0;
  float rk = floor(wp.y / RH);
  float x = wp.x + hash12(vec2(rk, 5.3)) * BL;
  float bk = floor(x / BL);
  float fx = x - bk * BL, fy = wp.y - rk * RH;
  float hb = hash12(vec2(bk, rk));
  float xa = 0.0, xb = BL;
  if (hb > 0.55) {
    float midt = BL * (0.35 + 0.3 * fract(hb * 7.31));
    if (fx < midt) xb = midt; else xa = midt;
    hb = fract(hb * 13.7 + step(midt, fx) * 0.5);
  }
  float dx = min(fx - xa, xb - fx), dy = min(fy, RH - fy);
  float fuge = 1.0 - smoothstep(0.95 - 0.5 * aa, 0.95 + 0.5 * aa, min(dx, dy));
  vec3 c = mix(vec3(0.28, 0.32, 0.35), vec3(0.40, 0.43, 0.46), hb);
  if (hb > 0.92) c = vec3(0.33, 0.39, 0.34);
  float lysF = max(1.0 - smoothstep(2.2, 3.6, RH - fy), 0.6 * (1.0 - smoothstep(2.2, 3.6, fx - xa)));
  float moerkF = max(1.0 - smoothstep(2.2, 3.6, fy), 0.6 * (1.0 - smoothstep(2.2, 3.6, xb - fx)));
  c *= 1.0 + (0.17 * lysF - 0.2 * moerkF) * fin;
  return mix(c, vec3(0.16, 0.18, 0.20), fuge * max(fin, 0.35));
}

// Planker langs fortets kanter. a = afstand ind fra kanten (wu), nA =
// kantens normal (peger mod luften), k = bagt retningsbyte: lige kanter
// (også trapperne) har deres præcise retning, buer den nærmeste af otte, og
// hvor retningen skifter (hjørner, buer), står plankerne i gering. lige = 1
// på en lige kant langt fra en samling.
vec3 planke(vec2 wp, float a, vec2 nA, float k, float lige, float aa, float fin) {
  float vk = (k + 16.0) * (6.2831853 / 256.0);
  vec2 nq = vec2(cos(vk), sin(vk));
  vec2 tq = vec2(-nq.y, nq.x);
  float s = dot(wp, tq);
  // Vandrette/lodrette kanter ligger på hele wu, så hver kant kan få sin egen
  // forskydning af samlingerne; buer og skrå kanter én pr. retning.
  float hE = hash12(vec2(k, 3.7));
  if (lige > 0.5 && mod(k + 16.0, 64.0) < 0.5)
    hE = hash12(vec2(floor(dot(wp, nq) + a + 0.5), k + 11.0));
  const float PL = 60.0;
  float u = s / PL + hE;
  float seg = floor(u);
  float f = (u - seg) * PL;
  float hs = hash12(vec2(seg, k * 13.0 + floor(hE * 64.0)));

  vec3 c = mix(vec3(0.80, 0.45, 0.20), vec3(0.91, 0.58, 0.29), hs);
  if (hs > 0.84) c = vec3(0.85, 0.63, 0.37);
  // Årer langs planken: brede lyse striber og tynde mørke.
  float aare = sin(a * 1.15 + sin(s * 0.041 + hs * 6.28) * 1.7 + hs * 9.0);
  c = mix(c, c * 1.16 + vec3(0.05, 0.04, 0.0), smoothstep(0.35, 0.9, aare) * 0.55 * fin);
  c *= 1.0 - smoothstep(0.8, 1.0, -aare) * 0.14 * fin;

  // Fas langs yderkanten: lys, hvor kanten vender mod lyset, mørk ellers.
  float lysA = dot(nA, LYSR);
  float fas = 1.0 - smoothstep(4.8, 6.4, a);
  c = mix(c, c * 1.25 + vec3(0.10, 0.08, 0.03), fas * clamp(lysA, 0.0, 1.0) * 0.8);
  c *= 1.0 - fas * clamp(-lysA, 0.0, 1.0) * 0.35;

  // Samlinger på tværs, med en lys fas på den ene side.
  float ds = min(f, PL - f);
  float fugeM = 1.0 - smoothstep(0.9 - 0.5 * aa, 0.9 + 0.5 * aa, ds);
  float fugeL = (1.0 - smoothstep(2.1 - 0.5 * aa, 2.1 + 0.5 * aa, f)) * (1.0 - fugeM);
  c = mix(c, c * 1.22, fugeL * fin);
  c = mix(c, vec3(0.34, 0.16, 0.07), fugeM * max(fin, 0.4));

  // Bolte: to pr. planke, midt i bredden. Kuppel med lys op-venstre,
  // krydskærv, mørk kant og slagskygge ned-højre. En bolt, der ville ramme
  // en samling, udelades — ellers skar geringen den over. Alle pixels i
  // bolten regner samme midte og dermed samme opslag; overgangen er blød,
  // så afrunding i midtens koordinater ikke kan dele en bolt på vippen.
  const float RB = 4.0;
  float fb = f < 0.5 * PL ? 9.5 : PL - 9.5;
  vec2 bo = (f - fb) * tq - (a - 7.5) * nq;
  float br = length(bo);
  float vis = (1.0 - smoothstep(2.0, 3.6, aa)) * smoothstep(RB + 0.4, RB + 1.0, fsaml(wp - bo));
  float skb = 1.0 - smoothstep(RB - 0.5 * aa, RB + 0.5 * aa, length(bo + LYSR * 1.8));
  c *= 1.0 - 0.34 * skb * vis;
  float bi = 1.0 - smoothstep(RB - 0.5 * aa, RB + 0.5 * aa, br);
  vec3 mt = vec3(0.80, 0.80, 0.78) * (0.74 + 0.36 * dot(bo / RB, LYSR));
  mt += vec3(0.28) * (1.0 - smoothstep(0.5, 1.4, length(bo - LYSR * 1.6)));
  float rot = hs * 3.1416 + fb;
  vec2 u1 = vec2(cos(rot), sin(rot));
  float kaerv = max(1.0 - smoothstep(0.45, 0.45 + aa, abs(dot(bo, u1))),
                    1.0 - smoothstep(0.45, 0.45 + aa, abs(dot(bo, vec2(-u1.y, u1.x)))))
              * (1.0 - smoothstep(RB * 0.6, RB * 0.6 + aa, br));
  mt = mix(mt, vec3(0.34, 0.34, 0.35), kaerv * fin);
  mt = mix(mt, vec3(0.15, 0.11, 0.08), smoothstep(RB - 1.1 - 0.5 * aa, RB - 1.1 + 0.5 * aa, br));
  return mix(c, mt, bi * vis);
}

void main() {
  float c0 = m(vUv);
  float g0 = texture2D(uMaske, vUv).g;
  vec4 p = texture2D(uPynt, vUv);
  vec2 wp = vUv * uBane;
  float aa = max(fwidth(wp.x), fwidth(wp.y));
  float fin = 1.0 - smoothstep(0.9, 2.2, aa);

  // ---- LUFT: græsfrynser, så længe der stadig er jord under dem — og inde
  // i fortets rum en bagvæg (ren grafik; kunderne går og skyder igennem den).
  if (c0 < 0.5) {
    if (p.a >= 0.5 && mo(0.0, -10.0) >= 0.5) { gl_FragColor = vec4(p.rgb, 1.0); return; }
    // Bagvæg: G = 0.5 over R = 0. Langs en murkant stiger R og G sammen
    // (lineær filtrering): G - R = 0.5 - 0.5 R, som er >= 0.25 helt ud til
    // R = 0.5, hvor murgrenen tager over — ingen revne mod baggrunden.
    float bag = smoothstep(0.16, 0.26, g0 - c0);
    if (bag < 0.5) discard;
    // Mørk, afmættet sten langt inde i bygningen.
    vec3 bv = sten(wp + vec2(23.0, 11.0), aa, fin);
    bv = mix(bv, vec3(dot(bv, vec3(0.3, 0.5, 0.2))), 0.35) * vec3(0.44, 0.44, 0.51);
    // Dybde: skygge i trin under loftet og langs væggene, og en hård
    // slagskygge ned-højre for rummets øverste/venstre kanter (lyset kommer
    // ind ude fra), så rummet læses som en dyb niche og ikke en plade.
    float skygge = mo(0.0, 6.0) * 0.26 + mo(0.0, 16.0) * 0.20 + mo(0.0, 34.0) * 0.12
                 + max(mo(6.0, 0.0), mo(-6.0, 0.0)) * 0.16
                 + max(mo(16.0, 0.0), mo(-16.0, 0.0)) * 0.08
                 + mo(-8.0, 12.0) * 0.18;
    bv *= 1.0 - min(skygge, 0.8);
    gl_FragColor = vec4(bv, 1.0);
    return;
  }

  // ---- ALBEDO: gentaget jordtekstur, med bagt græs og begravede ting ovenpå.
  // Murværket får planker og sten i stedet (og har intet græs i pyntelaget).
  float erMur = smoothstep(0.7, 0.9, g0);
  vec3 jord = texture2D(uJord, wp / 1024.0).rgb;
  vec3 col = mix(jord, p.rgb, p.a);
  float murA = 99.0;   // bagt afstand til fortets egen kant; skiller kratere fra kanter
  if (erMur > 0.0) {
    // Feltet og dets gradienter: nA peger mod fortets kant, nS fra stenen
    // ud mod planken foran den. lA falder, hvor to kanters planker mødes.
    vec2 f0 = fd(wp);
    float saml0 = fsaml(wp);
    // Plankeretningen fra nærmeste teksel: den skifter brat i en gering, og
    // en interpoleret vinkel ville give en fremmed retning langs skiftet.
    ivec2 ij = clamp(ivec2(floor(wp - uFortBoks.xy)), ivec2(0), ivec2(uFortBoks.zw) - 1);
    float kb = floor(texelFetch(uFort, ij, 0).a * 255.0 + 0.5);
    vec2 fx1 = fd(wp + vec2(1.5, 0.0)), fx0 = fd(wp - vec2(1.5, 0.0));
    vec2 fy1 = fd(wp + vec2(0.0, 1.5)), fy0 = fd(wp - vec2(0.0, 1.5));
    vec2 gA = vec2(fx1.x - fx0.x, fy1.x - fy0.x) * (1.0 / 3.0);
    vec2 gS = vec2(fx1.y - fx0.y, fy1.y - fy0.y) * (1.0 / 3.0);
    float lA = length(gA), lS = length(gS);
    vec2 nA = lA > 0.001 ? -gA / lA : vec2(0.0, 1.0);
    vec2 nS = lS > 0.001 ? -gS / lS : vec2(0.0, 1.0);
    float a = max(f0.x - 0.5, 0.0);       // pixelcentre -> selve kanten
    float gk = f0.y;
    murA = a;

    // Kun det, der ses: træ på den ene side af stenkanten, sten på den anden.
    vec3 tr = vec3(0.0), st = vec3(0.0);
    if (gk < 0.5 * aa) {
      tr = planke(wp, a, nA, kb, step(1.0, saml0), aa, fin);
      // Samling, hvor to kanters planker mødes (midt i et dæk, i geringen).
      tr = mix(tr, vec3(0.30, 0.15, 0.07), (1.0 - smoothstep(0.5, 0.85, lA)) * 0.85);
      // Plankens inderkant mod stenen: en fas, der vender væk fra kanten.
      float fasI = smoothstep(-3.6, -2.0, gk);
      float lysI = -dot(nS, LYSR);
      tr = mix(tr, tr * 1.2 + vec3(0.06, 0.05, 0.02), fasI * clamp(lysI, 0.0, 1.0) * 0.6);
      tr *= 1.0 - fasI * clamp(-lysI, 0.0, 1.0) * 0.3;
    }
    if (gk > -0.5 * aa) {
      // Stenen ligger bag plankerne: slagskygge ned-højre for dem og lidt
      // mørke tæt ind til dem hele vejen rundt.
      st = sten(wp, aa, fin);
      float bred = 1.0 + 7.0 * clamp(dot(nS, LYSR), 0.0, 1.0);
      st *= 1.0 - 0.38 * (1.0 - smoothstep(bred - 0.5 * aa, bred + 0.5 * aa, gk));
      st *= 0.82 + 0.18 * smoothstep(0.0, 5.0, gk);
    }

    vec3 mf = mix(tr, st, smoothstep(-0.5 * aa, 0.5 * aa, gk));
    mf = mix(mf, vec3(0.16, 0.09, 0.05), (1.0 - smoothstep(0.75 - 0.5 * aa, 0.75 + 0.5 * aa, abs(gk))) * 0.9);
    // Mod jord har masken ingen kontur, så træet får selv en mørk kant.
    mf = mix(mf, vec3(0.14, 0.08, 0.05), (1.0 - smoothstep(1.0, 2.0, a)) * 0.9);
    col = mix(col, mf, erMur);
  }

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
  // med en lys læbe yderst — Worms' kendetegn ved nye huller. På murværket
  // kun ved NYE kanter: fortets egne kanter har planker med egen fas.
  float naer9 = 1.0 - r9;
  float graes = smoothstep(0.2, 0.7, p.a);
  float krater = mix(1.0, smoothstep(2.5, 6.0, murA), erMur);
  vec3 randFarve = mix(vec3(0.30, 0.20, 0.13), vec3(0.17, 0.13, 0.11), erMur);
  col = mix(col, randFarve, naer9 * 0.55 * (1.0 - graes) * krater);
  // Murværket er sprængt, ikke gravet: sod i pletter og en mørkere inderste
  // kant, så et krater aldrig kan forveksles med en af fortets åbninger.
  if (erMur > 0.0 && naer9 * krater > 0.0) {
    float sod = naer9 * (0.25 + 0.55 * vstoej(wp * 0.21)) + (1.0 - r4) * 0.3;
    col = mix(col, vec3(0.09, 0.07, 0.06), clamp(sod * krater * erMur, 0.0, 0.85));
  }
  float laebe = (1.0 - r4) * r2;
  col += vec3(0.22, 0.17, 0.10) * laebe * max(lys, 0.0) * (1.0 - graes * 0.6) * krater;

  // ---- LYS PÅ FORMEN: opadvendte kanter lysere, nedadvendte mørkere.
  float kant = 1.0 - r9;
  col *= 1.0 + 0.16 * lys * kant * krater;

  // ---- DYBDE: jord med meget jord OVER sig bliver gradvist mørkere, så
  // bjergene får masse, og hulerne bliver hule. Fortet mindre: det er
  // bygget, og etagerne skal stå lige klart.
  float over = mo(0.0, 40.0) + mo(0.0, 110.0) + mo(0.0, 220.0);
  col *= 1.0 - (over / 3.0) * 0.22 * (1.0 - 0.75 * erMur);
  // Undersider i skygge: under et overhæng er der ingen himmel.
  float under = 1.0 - mo(0.0, -14.0);
  col *= 1.0 - under * 0.18 * (1.0 - 0.6 * erMur);

  // ---- KONTUR: tyk, mørk streg langs hele silhuetten. Det er den ene
  // ting, der mest får terrænet til at ligne illustration frem for foto.
  float kontur = 1.0 - smoothstep(0.35, 0.85, r2);
  vec3 konturFarve = mix(mix(vec3(0.11, 0.075, 0.05), vec3(0.10, 0.20, 0.08), graes),
                         vec3(0.13, 0.075, 0.05), erMur);
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

  // Fortets planker og sten, bagt fra det oprindelige murværk. Uden murværk
  // (de andre banetyper) en tom 1x1, som shaderen aldrig læser.
  const felt = bagFortFelt(terraen) || { data: new Uint8Array(4), x0: 0, y0: 0, w: 1, h: 1 };
  const fortTex = new DataTexture(felt.data, felt.w, felt.h, RGBAFormat, UnsignedByteType);
  fortTex.minFilter = fortTex.magFilter = LinearFilter;
  fortTex.wrapS = fortTex.wrapT = ClampToEdgeWrapping;
  fortTex.generateMipmaps = false;
  fortTex.flipY = false;
  fortTex.unpackAlignment = 1;
  fortTex.needsUpdate = true;

  const mat = new ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: {
      uMaske: { value: maskeTex },
      uJord: { value: jordTex },
      uPynt: { value: pyntTex },
      uFort: { value: fortTex },
      uFortBoks: { value: new Vector4(felt.x0, felt.y0, felt.w, felt.h) },
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
      maskeTex.dispose(); jordTex.dispose(); pyntTex.dispose(); fortTex.dispose();
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

/* ------------------------------------------------------ fortets felt
 *
 * Bages én gang ved start fra det OPRINDELIGE murværk (som græsset), så
 * shaderen ved, hvor fortet har planker, og hvor det har sten, uden at skulle
 * lede efter kanter selv:
 *   R = afstand fra pixelcentret til nærmeste ikke-mur (luft eller jord), x8
 *   G = fortegnet afstand til stenkernen, (g + 16) x8, positiv i stenen
 *   B = afstand til nærmeste plankesamling (gering, midt i et dæk, bue), x8
 *   A = plankens retning, (vinkel/360° x 256 - 16) mod 256; læses uden
 *       interpolation (texelFetch)
 * Træet går FORT_TRAE wu ind fra hver kant. Stenkernen er resten — men kun
 * hvor muren er tyk nok til en ordentlig stenflade: kernen er en morfologisk
 * åbning (erodér med FORT_KERNE ud over træet, dilatér tilbage), så tynde
 * mure og dæk bliver rent træ i stedet for træ med en smal stribe sten, og
 * stenfladerne får runde hjørner. To eksakte afstandstransformer over
 * murværkets omskrevne rektangel (Felzenszwalb-Huttenlocher) og en billig
 * til samlingerne; 0,2-0,3 s ved kampstart, afhængigt af antal forter.
 * Afhænger kun af masken, så vært, spejl og gæster bager det samme.
 */
const FORT_TRAE = 16, FORT_KERNE = 8;

export function bagFortFelt(t) {
  const { w, h, maske } = t;
  // Murværkets omskrevne rektangel i maskens rækker (y nedad).
  let x0 = w, x1 = -1, r0 = -1, r1 = -1;
  for (let r = 0; r < h; r++) {
    const raekke = maske.subarray(r * w, r * w + w);
    const a = raekke.indexOf(MUR);
    if (a < 0) continue;
    const b = raekke.lastIndexOf(MUR);
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
    if (r0 < 0) r0 = r;
    r1 = r;
  }
  if (x1 < 0) return null;

  // Feltet i verdenskoordinater (y opad, som masketeksturen), med en kant
  // af ikke-mur rundt om, så afstanden altid har noget at måle til.
  const M = 2;
  const bx0 = Math.max(0, x0 - M), by0 = Math.max(0, (h - 1 - r1) - M);
  let bw = Math.min(w - 1, x1 + M) - bx0 + 1;
  const bh = Math.min(h - 1, (h - 1 - r0) + M) - by0 + 1;
  bw += bw & 1;
  const n = bw * bh;
  const mur = new Uint8Array(n);
  for (let j = 0; j < bh; j++) {
    const kilde = (h - 1 - (by0 + j)) * w;
    for (let i = 0; i < bw; i++) {
      const x = bx0 + i;
      if (x < w && maske[kilde + x] === MUR) mur[j * bw + i] = 1;
    }
  }

  // 1. afstand til nærmeste ikke-mur
  const kant = new Uint8Array(n);
  for (let k = 0; k < n; k++) kant[k] = mur[k] ^ 1;
  const d1 = kvadratAfstand(kant, bw, bh, 33);

  // 2. stenkernen: eroderet til FORT_TRAE + FORT_KERNE og dilateret igen
  const kerne = new Uint8Array(n);
  const K2 = (FORT_TRAE + FORT_KERNE) * (FORT_TRAE + FORT_KERNE);
  for (let k = 0; k < n; k++) kerne[k] = mur[k] && d1[k] >= K2 ? 1 : 0;
  const d2 = kvadratAfstand(kerne, bw, bh, 25);

  // Stenkanten følger selve fortkanten (d1), hvor muren er tyk; åbningen
  // (d2) tager kun over, hvor den skærer mere væk: tynde partier, hjørner.
  // pl = plankepixel (træ, ikke sten); planker = deres indeks i orden.
  const a = new Float32Array(n), g = new Float32Array(n);
  const pl = new Uint8Array(n);
  let antal = 0;
  for (let k = 0; k < n; k++) {
    if (!mur[k]) continue;
    a[k] = Math.sqrt(d1[k]);
    g[k] = Math.min(a[k] - 0.5 - FORT_TRAE, FORT_KERNE - Math.sqrt(d2[k]));
    if (g[k] <= 0.5) { pl[k] = 1; antal++; }
  }
  const planker = new Int32Array(antal);
  for (let k = 0, i = 0; k < n; k++) if (pl[k]) planker[i++] = k;

  // 3. plankernes retning (A). Lige kanter — vandrette, lodrette, trapperne —
  //    får deres præcise retning, så samlingerne står vinkelret på planken og
  //    boltene er runde; buer får nærmeste af otte retninger og står i gering.
  //    De lige retninger findes som toppe i retningshistogrammet: en lang kant
  //    giver tusinder af pixels i samme retning, en bue kun få pr. grad.
  const TO = 2 * Math.PI;
  const vink = retningsfelt(a, pl, planker, bw, bh);
  const lige = ligeRetninger(vink, a, planker);
  // Opslagstabel vinkel -> (retningsbyte, krum) i trin på 0,18°. Byten er
  // vinklen i 256-dele af en omgang, forskudt 16, så vandret og lodret
  // rammer hele tal og skiftet 255 -> 0 ligger midt mellem to af de otte
  // retninger (22,5°), hvor en bue alligevel står i gering.
  const LN = 2048;
  const lutB = new Uint8Array(LN), lutK = new Uint8Array(LN);
  for (let b = 0; b < LN; b++) {
    const v = (b + 0.5) / LN * TO;
    let bedst = 3 * Math.PI / 180, s = 0, fundet = false;
    for (const r of lige) {
      const d = Math.abs(((v - r) % TO + 3 * Math.PI) % TO - Math.PI);
      if (d < bedst) { bedst = d; s = r; fundet = true; }
    }
    if (!fundet) { s = Math.round(v / (Math.PI / 4)) * (Math.PI / 4); lutK[b] = 1; }
    lutB[b] = (Math.round(s / TO * 256) - 16) & 255;
  }
  const byte = new Int16Array(n).fill(-1);
  const krum = new Uint8Array(n);
  for (const k of planker) {
    const v = vink[k];
    if (v !== v) {
      // Midt i et dæk: nabos retning, så der ikke står en fremmed stribe dér.
      if (k >= bw) byte[k] = byte[k - 1] >= 0 ? byte[k - 1] : byte[k - bw];
      continue;
    }
    const b = Math.min(LN - 1, ((v < 0 ? v + TO : v) * (LN / TO)) | 0);
    byte[k] = lutB[b]; krum[k] = lutK[b];
  }

  // 4. samlingerne (B): hvor plankeretningen skifter, midt i dæk og på buer.
  //    Boltene holder sig fri af dem, så en gering aldrig skærer en bolt over.
  const samling = new Uint8Array(n);
  for (const k of planker) {
    if (k < bw || k >= n - bw) continue;
    const b = byte[k], h1 = pl[k + 1] ? byte[k + 1] : b, v1 = pl[k + bw] ? byte[k + bw] : b;
    if (vink[k] !== vink[k] || krum[k] || h1 !== b || v1 !== b) samling[k] = 1;
  }
  const d3 = naerAfstand(samling, pl, bw, bh);

  const data = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    if (!mur[k]) continue;
    data[4 * k] = Math.min(255, Math.round(a[k] * 8));
    data[4 * k + 1] = Math.max(0, Math.min(255, Math.round((g[k] + 16) * 8)));
    data[4 * k + 2] = Math.round(d3[k] * 8 / 3);
    data[4 * k + 3] = Math.max(0, byte[k]);
  }
  return { data, x0: bx0, y0: by0, w: bw, h: bh };
}

/** Omtrentlig afstand (3-4-chamfer, ±8 %) til nærmeste mål-pixel, målt
 *  gennem plankepixels (pl), i tredjedele wu og loftet ved 12 wu — nok til
 *  at holde boltene fri af samlingerne, og langt billigere end en eksakt
 *  transformation. */
function naerAfstand(maal, pl, bw, bh) {
  const n = bw * bh, LOFT = 36;
  const d = new Uint8Array(n);
  for (let k = 0; k < n; k++) d[k] = maal[k] ? 0 : LOFT;
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const k = j * bw + i;
      let v = d[k];
      if (!v || !pl[k]) continue;
      if (i > 0 && d[k - 1] + 3 < v) v = d[k - 1] + 3;
      if (j > 0) {
        const o = k - bw;
        if (d[o] + 3 < v) v = d[o] + 3;
        if (i > 0 && d[o - 1] + 4 < v) v = d[o - 1] + 4;
        if (i < bw - 1 && d[o + 1] + 4 < v) v = d[o + 1] + 4;
      }
      d[k] = v;
    }
  }
  for (let j = bh - 1; j >= 0; j--) {
    for (let i = bw - 1; i >= 0; i--) {
      const k = j * bw + i;
      let v = d[k];
      if (!v || !pl[k]) continue;
      if (i < bw - 1 && d[k + 1] + 3 < v) v = d[k + 1] + 3;
      if (j < bh - 1) {
        const o = k + bw;
        if (d[o] + 3 < v) v = d[o] + 3;
        if (i > 0 && d[o - 1] + 4 < v) v = d[o - 1] + 4;
        if (i < bw - 1 && d[o + 1] + 4 < v) v = d[o + 1] + 4;
      }
      d[k] = v;
    }
  }
  return d;
}

/** Kvadratisk middel (2R+1)² af et felt, adskilt i vandret og lodret. */
function boksSloer(src, bw, bh, R) {
  const n = bw * bh;
  const tmp = new Float32Array(n), ud = new Float32Array(n);
  for (let j = 0; j < bh; j++) {
    const o = j * bw;
    let s = 0;
    for (let i = 0; i < R && i < bw; i++) s += src[o + i];
    for (let i = 0; i < bw; i++) {
      if (i + R < bw) s += src[o + i + R];
      if (i - R - 1 >= 0) s -= src[o + i - R - 1];
      tmp[o + i] = s;
    }
  }
  const acc = new Float32Array(bw);
  for (let j = 0; j < R && j < bh; j++) for (let i = 0; i < bw; i++) acc[i] += tmp[j * bw + i];
  for (let j = 0; j < bh; j++) {
    if (j + R < bh) { const o = (j + R) * bw; for (let i = 0; i < bw; i++) acc[i] += tmp[o + i]; }
    if (j - R - 1 >= 0) { const o = (j - R - 1) * bw; for (let i = 0; i < bw; i++) acc[i] -= tmp[o + i]; }
    ud.set(acc, j * bw);
  }
  return ud;
}

/** Kantens normal (mod luften) i hver plankepixel, i radianer; NaN hvor
 *  afstandsfeltet er fladt (midt i et dæk). Tæt på kanten er retningen
 *  støjet af pixeltrappen, så dér lånes den fra en pixel længere inde, og
 *  på skrå kanter giver trappen ±6°, som et 9x9-middel af enhedsvektorerne
 *  fjerner. Geringer bevares: afviger middelet mere end 15° fra pixlens egen
 *  retning, beholder den sin. */
function retningsfelt(a, pl, planker, bw, bh) {
  const n = bw * bh;
  // Enhedsvektorer; (0, 0) = ingen retning.
  const rx = new Float32Array(n), ry = new Float32Array(n);
  for (const k of planker) {
    const i = k % bw, j = (k - i) / bw;
    if (i < 2 || j < 2 || i >= bw - 2 || j >= bh - 2) continue;
    const gx = a[k + 2] - a[k - 2], gy = a[k + 2 * bw] - a[k - 2 * bw];
    const l2 = gx * gx + gy * gy;
    if (l2 < 16 * 0.6 * 0.6) continue;
    const l = Math.sqrt(l2);
    rx[k] = -gx / l; ry[k] = -gy / l;
  }
  const vx = rx.slice(), vy = ry.slice();
  for (const k of planker) {
    if ((rx[k] === 0 && ry[k] === 0) || a[k] >= 4.5) continue;
    const i = k % bw, j = (k - i) / bw, trin = 5 - a[k];
    const ii = i - Math.round(rx[k] * trin), jj = j - Math.round(ry[k] * trin);
    if (ii < 0 || jj < 0 || ii >= bw || jj >= bh) continue;
    const kk = jj * bw + ii;
    if (rx[kk] !== 0 || ry[kk] !== 0) { vx[k] = rx[kk]; vy[k] = ry[kk]; }
  }
  // Middel i halv opløsning (2x2-summer, så 5x5), dvs. over omtrent 10x10 wu.
  const hw = (bw + 1) >> 1, hh = (bh + 1) >> 1;
  const hx = new Float32Array(hw * hh), hy = new Float32Array(hw * hh);
  for (const k of planker) {
    const i = k % bw, j = (k - i) / bw, q = (j >> 1) * hw + (i >> 1);
    hx[q] += vx[k]; hy[q] += vy[k];
  }
  const sx = boksSloer(hx, hw, hh, 2), sy = boksSloer(hy, hw, hh, 2);
  const GRAENSE = Math.cos(15 * Math.PI / 180);
  const ud = new Float32Array(n).fill(NaN);
  for (const k of planker) {
    const x = vx[k], y = vy[k];
    if (x === 0 && y === 0) continue;
    const i = k % bw, j = (k - i) / bw, q = (j >> 1) * hw + (i >> 1);
    const mx = sx[q], my = sy[q], l = Math.sqrt(mx * mx + my * my);
    ud[k] = l > 0 && mx * x + my * y > GRAENSE * l ? Math.atan2(my, mx) : Math.atan2(y, x);
  }
  return ud;
}

/** De lige kanters retninger: toppe i et histogram over plankepixels (halve
 *  grader) der rager klart op over buernes jævne bund. Retninger tæt på
 *  vandret/lodret/45° lægges præcist på dem. */
function ligeRetninger(vink, a, planker) {
  const N = 720, hist = new Float64Array(N), sum = new Float64Array(N);
  const TO = 2 * Math.PI;
  for (const k of planker) {
    const v = vink[k];
    if (v !== v || a[k] < 4.5) continue;
    const t = v < 0 ? v + TO : v;
    const b = Math.min(N - 1, Math.floor(t / TO * N));
    hist[b]++; sum[b] += t - (b + 0.5) * TO / N;
  }
  const vindue = (b) => hist[(b + N - 1) % N] + hist[b] + hist[(b + 1) % N];
  const alle = [];
  for (let b = 0; b < N; b++) alle.push(vindue(b));
  const bund = alle.slice().sort((x, y) => x - y)[Math.floor(N * 0.75)];
  const lige = [];
  for (let b = 0; b < N; b++) {
    const c = alle[b];
    // En lige kant er en smal top: høj over bunden og lav 3° til hver side.
    if (c < Math.max(400, 1.5 * bund)) continue;
    if (Math.max(alle[(b + 6) % N], alle[(b + N - 6) % N]) > 0.5 * c) continue;
    let top = true;
    for (let d = -3; d <= 3 && top; d++) if (d && alle[(b + d + N) % N] > c - (d > 0 ? 0 : 1e-9)) top = false;
    if (!top) continue;
    // Middelretningen i vinduet, så en trappe ikke rundes til halve grader.
    let s = 0, m = 0;
    for (let d = -2; d <= 2; d++) { const q = (b + d + N) % N; s += sum[q] + hist[q] * (d * TO / N); m += hist[q]; }
    let r = (b + 0.5) * TO / N + s / m;
    const r45 = Math.round(r / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(r - r45) < Math.PI / 180) r = r45;
    lige.push(r);
  }
  return lige;
}

/** Kvadreret afstand til nærmeste mål-pixel (mål = 1), eksakt op til LOFT
 *  (højst 255). Først søjlevis (rækkevis gennemløb, så hukommelsen læses i
 *  orden), så rækkevis med den nedre parabel-indhylning (Felzenszwalb-
 *  Huttenlocher). Rækkepasset deles ved rækkens egne mål — længere ude end
 *  dem kan intet være nærmere — og indhylningen bygges kun af de pixels,
 *  der lodret ligger under LOFT fra et mål. Det meste af et fort er luft
 *  eller langt fra et mål, så det sparer det meste af arbejdet. */
function kvadratAfstand(maal, bw, bh, LOFT) {
  const n = bw * bh, L2 = LOFT * LOFT;
  const g = new Uint8Array(n);
  const d = new Uint8Array(bw).fill(LOFT);
  for (let j = 0; j < bh; j++) {
    const o = j * bw;
    for (let i = 0; i < bw; i++) {
      const t = maal[o + i] ? 0 : d[i] < LOFT ? d[i] + 1 : LOFT;
      d[i] = t; g[o + i] = t;
    }
  }
  d.fill(LOFT);
  for (let j = bh - 1; j >= 0; j--) {
    const o = j * bw;
    for (let i = 0; i < bw; i++) {
      const t = maal[o + i] ? 0 : d[i] < LOFT ? d[i] + 1 : LOFT;
      d[i] = t;
      if (t < g[o + i]) g[o + i] = t;
    }
  }
  const ud = new Float32Array(n);
  const v = new Int32Array(bw + 1), z = new Float64Array(bw + 2);
  for (let j = 0; j < bh; j++) {
    const o = j * bw;
    let s = 0;
    while (s < bw) {
      if (g[o + s] === 0) { ud[o + s] = 0; s++; continue; }
      let e = s;
      while (e < bw && g[o + e] !== 0) e++;
      // Indhylningen af de parabler, der kan nå under loftet: strækningens
      // pixels med lodret afstand under LOFT og de to afgrænsende mål.
      const lo = s > 0 ? s - 1 : s, hi = e < bw ? e : e - 1;
      let k = -1;
      for (let q = lo; q <= hi; q++) {
        const gq = g[o + q];
        if (gq >= LOFT) continue;
        if (k < 0) { k = 0; v[0] = q; z[0] = -Infinity; z[1] = Infinity; continue; }
        const fq = gq * gq + q * q;
        let x;
        for (;;) {
          const p = v[k];
          x = (fq - (g[o + p] * g[o + p] + p * p)) / (2 * (q - p));
          if (x > z[k]) break;
          k--;
        }
        k++; v[k] = q; z[k] = x; z[k + 1] = Infinity;
      }
      if (k < 0) {
        for (let q = s; q < e; q++) ud[o + q] = L2;
      } else {
        k = 0;
        for (let q = s; q < e; q++) {
          while (z[k + 1] < q) k++;
          const p = v[k], gp = g[o + p];
          const t = (q - p) * (q - p) + gp * gp;
          ud[o + q] = t < L2 ? t : L2;
        }
      }
      s = e;
    }
  }
  return ud;
}

function farve(hex) {
  return new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}
