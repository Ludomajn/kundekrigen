/* Kundekrigen — farerne på banen: Kabelsalaten (Nullermanden i grotten),
 * Pakkedronen, Robotstøvsugeren, ilden og det brændte græs, den efterlader.
 * Simulationen står i sim/farer.js, grænsefladen i docs/farer.md.
 *
 * Art directorens tegneseriemodeller: 20 frames pr. model i celler på 128 px
 * (objekt_view.js), fodlinjen 118 px nede i cellen står på farens fodpunkt.
 * Mangler et atlas, tegnes en pladsholder (fare_kunst.js) med samme opbygning.
 *
 * Tilstand -> frames:
 *   idle    på jorden, kører, flyver med pakken
 *   aktiv   brand > 0: Kabelsalaten brænder, støvsugeren er overophedet
 *   fald    tilst 'luft' (kastet op, eller på vej ind oppefra)
 *   land    skiftet fra 'luft' til jorden, som vi selv ser det (og støvsugeren,
 *           der vågner)
 *   udloes  KORTSLUTNING-glimtet, NOM, dronen slipper pakken (LEVERET!), og
 *           ilden, der blusser op som en ny brand
 *   doed    asken, batteriet, der springer, og ilden, der går ud
 * Kabelsalaten og Nullermanden har ingen bagt rotation: koden ruller dem om
 * kuglens midte (vinkel −x / r), og kun på jorden. Brænder de, vugger de i
 * stedet, så flammerne bliver oppe. Squash er bagt ind i land og fald.
 *
 * Dronens kasse: skydes dronen ned, bliver pakken en rigtig våbenkasse i
 * simulationen, og efter LEVERET! er den hos skytten. Dronen tegnes derfor
 * uden kasse (cellens øverste stykke), så kassen aldrig ses to gange.
 *
 * Spejlet slås op hver frame og holdes aldrig: et snapshot udskifter
 * objekterne. Det, der skal huskes (vinkel, forløb, prøver til glat
 * bevægelse), ligger her under farens id. Hvad der sker (antændt, spist,
 * leveret, væk), fortæller ui/farer.js med haendelse().
 *
 * Lagene (renderer.js Z): farerne på jorden med genstandene, dronen lige
 * under projektilerne, ilden lige under effekterne og det brændte græs under
 * pynten. Ren præsentation: læser spejlet, skriver aldrig i det.
 */
'use strict';

import { Group, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, LinearFilter, SRGBColorSpace } from '../three.js';
import { Z } from './renderer.js';
import { objektMesh, saetFrame, animer } from './objekt_view.js';
import { OBJEKT_RIG as RIG } from './objekt_rig.js';
import { hent } from './assets.js';
import { lavPladsholder, lavGraesPladsholder } from './fare_kunst.js';
import { lavRng } from '../core/rng.js';

const C = RIG.celle, KOL = RIG.kol, FOD = RIG.fod, RAEKKER = 4;
const FRAME = Object.fromEntries(RIG.frames.map((n, i) => [n, i]));

/** Tegningens bredde i wu (i tomgang). Kuglen i Kabelsalaten og Nullermanden
 *  er så lige så stor som træfcirklen (r 14): stikkene stritter ud over den. */
export const FARE_BREDDE = { kabelsalat: 42, nullermand: 33, pakkedrone: 48, robotstoevsuger: 30, ild: 22 };
/** Rotationens omdrejningspunkt over fodpunktet (wu): kuglens midte, og
 *  dronens krop (så kassen svinger under den, og en nedskudt drone tumler om
 *  sig selv). Støvsugeren hælder om fodpunktet. */
const DREJ_MIDT = { kabelsalat: 14, nullermand: 15.5, pakkedrone: 36 };
const RULLE_R = 14;                     // = KS_R: vinklen er −x / r
export const GRAES_BREDDE = 44;         // det brændte græs (256 x 51 px)
const GRAES_LIV = 60, GRAES_UD = 4;     // s, så tones det ud over 4 s
const GRAES_MAKS = 60;
const GRAES_EFTER = 0.35;               // s: pletten kommer, når ilden har brændt så længe

/* Dronen uden kasse: cellens øverste stykke (px). I tomgang slutter dronens
 * ben i række 52, og snorene begynder i række 53. */
const DRONE_KLIP = 53;
/* Kassen alene i udloes_2 (dronen har sluppet den; rækkerne 57-124). */
const KASSE_FRA = 57, KASSE_TIL = 125;

const LAND_S = 0.22;                    // land: 3 frames ved 14 billeder/s
const UDLOES = {                        // engangsforløbene: varighed (s) og tempo
  kortslutning: { t: 0.36, fart: 0.85 },
  nom: { t: 0.62, fart: 0.5 },          // NOM-boblen skal kunne læses
  leveret: { t: 0.3, fart: 1 },
  ild: { t: 0.3, fart: 1 },
};
const DOED_S = { kabelsalat: 0.5, nullermand: 0.5, robotstoevsuger: 0.4, ild: 0.5 };
const HOLD_S = 0.9, TON_S = 0.45;       // asken står lidt, så toner den ud
const LEVER_S = 0.6;                    // kassen flyver hen til skytten
const SPRING = 160;                     // længere hop end dette er en teleport (client.js)
const BORTE_S = 1;                      // s: så længe efter spejlet sidst viste en meldt væk fare, huskes den

/* Grafikkens navn, hvis spejlet mangler det (sim/farer.js FARE_INFO). */
const HUD = { kabelsalat: 'kabelsalat', drone: 'pakkedrone', stoevsuger: 'robotstoevsuger' };

const LAG = {
  jord: Z.genstande + 0.2,              // over printerne og minerne, den ruller forbi
  drone: Z.projektiler - 1,
  ild: Z.fx - 1,
  graes: Z.genstande - 1.5,             // under pynten (Z.genstande - 1): planterne står foran
};

// ------------------------------------------------------------ grafikken

const MODELLER = ['kabelsalat', 'nullermand', 'pakkedrone', 'robotstoevsuger', 'ild'];
const BILLEDER = new Map();
const MANGLER = new Set();
let hentet = false;

/** Hent art directorens atlas og det brændte græs (én gang). Mangler et, tegnes
 *  dets pladsholder. Kaldes af lavFareView; farerne kommer tidligst i runde 2. */
export function hentFareGrafik() {
  if (hentet || typeof Image === 'undefined') return;
  hentet = true;
  for (const navn of [...MODELLER, 'braendt_graes']) {
    const img = new Image();
    img.onload = () => BILLEDER.set(navn, img);
    img.onerror = () => { console.warn('[grafik] mangler', navn); MANGLER.add(navn); };
    img.src = `/grafik/objekter/${navn}.${navn === 'braendt_graes' ? 'png' : 'webp'}`;
  }
}

/** Billedet til en model: assets.js' (hvis det står i dens manifest), vores
 *  eget, eller pladsholderen, hvis filen ikke kunne hentes. */
function standardBillede(navn) {
  return hent(`obj_${navn}`) || BILLEDER.get(navn) ||
    (MANGLER.has(navn) ? (navn === 'braendt_graes' ? lavGraesPladsholder() : lavPladsholder(navn)) : null);
}

const TEX = new WeakMap();
function tekstur(img) {
  let t = TEX.get(img);
  if (!t) {
    t = new CanvasTexture(img);
    t.minFilter = t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    t.colorSpace = SRGBColorSpace;          // tegningerne er sRGB — ellers udvaskes de
    TEX.set(img, t);
  }
  return t;
}

/** Et stykke af cellen (rækkerne y0-y1 px) som quad med origo i fodpunktet,
 *  som objektMesh, men kun det stykke: dronen uden kasse, kassen alene. */
function klipMesh(navn, bredde, lag, y0, y1) {
  const [x0, , x1] = RIG.modeller[navn].indhold;
  const s = bredde / (x1 - x0);
  const geo = new PlaneGeometry(C * s, (y1 - y0) * s);
  geo.translate((C / 2 - (x0 + x1) / 2) * s, (FOD - (y0 + y1) / 2) * s, 0);
  const m = new Mesh(geo, new MeshBasicMaterial({ transparent: true, depthTest: true, depthWrite: false }));
  m.renderOrder = lag;
  m.userData.objekt = { navn, frame: -1, s, y0, y1 };
  return m;
}

/** Vis frame i (et navn eller tal) i et klippet stykke. */
function saetKlipFrame(m, i) {
  if (typeof i === 'string') i = FRAME[i] ?? 0;
  const o = m.userData.objekt;
  if (o.frame === i) return;
  o.frame = i;
  const c = i % KOL, r = Math.floor(i / KOL);
  const u0 = c / KOL, u1 = (c + 1) / KOL;
  const v1 = 1 - (r + o.y0 / C) / RAEKKER, v0 = 1 - (r + o.y1 / C) / RAEKKER;
  const uv = m.geometry.attributes.uv;
  uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
}

/* Silhuetten om kuglens midte: i hver retning (PROFIL_N) den største afstand
 * (wu) til en dækket pixel i tomgangens første frame. Kablernes stik stritter
 * ud over kuglen; ruller et stik ned mod jorden, løftes kuglen, så den ruller
 * hen over det i stedet for at stikket går ned i græsset. Regnes én gang pr.
 * billede (et lærred i browseren; test-billederne har data). */
const PROFIL_N = 48;
const PROFILER = new WeakMap();
function profil(img, navn, bredde, midt) {
  if (PROFILER.has(img)) return PROFILER.get(img);
  let px = null;
  try {
    if (img.data) {
      px = (x, y) => img.data[(y * img.width + x) * 4 + 3];
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = C; c.height = C;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, C, C, 0, 0, C, C);             // idle_0: cellen øverst til venstre
      const d = g.getImageData(0, 0, C, C).data;
      px = (x, y) => d[(y * C + x) * 4 + 3];
    }
  } catch { px = null; }
  let r = null;
  if (px) {
    const [x0, , x1] = RIG.modeller[navn].indhold;
    const s = bredde / (x1 - x0), cx = (x0 + x1) / 2, cy = FOD - midt / s;
    r = new Float32Array(PROFIL_N);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      if (px(x, y) < 128) continue;
      const dx = x + 0.5 - cx, dy = cy - (y + 0.5);
      const i = Math.round((Math.atan2(dy, dx) / (Math.PI * 2) + 1) * PROFIL_N) % PROFIL_N;
      const d = Math.hypot(dx, dy) * s;
      if (d > r[i]) r[i] = d;
    }
  }
  PROFILER.set(img, r);
  return r;
}
/** Hvor langt under kuglens midte (wu) silhuetten når, drejet rot. */
function dybde(r, rot) {
  let d = 0;
  for (let i = 0; i < PROFIL_N; i++) {
    const ned = -Math.sin(i / PROFIL_N * Math.PI * 2 + rot) * r[i];
    if (ned > d) d = ned;
  }
  return d;
}

/** Frame i et klippet stykke til en tilstand (samme tempi som animer). */
function animerKlip(m, t, fps) { saetKlipFrame(m, FRAME[`idle_${Math.floor(Math.max(0, t) * fps) % 4}`]); }

function smid(o) {
  o.traverse?.((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
  o.parent?.remove(o);
}

/* Lille heltalshash (0-1) til variation pr. id: fase, spejling, størrelse. */
function h01(n) {
  let x = Math.imul((n | 0) ^ 0x9E3779B9, 0x85EBCA6B);
  x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const klem = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Vinklen foldet ind i [−π, π]. */
const fold = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const tilbage = (a) => 1 + 2.7 * Math.pow(a - 1, 3) + 1.7 * Math.pow(a - 1, 2);   // pop med overskud (fx.js)

// ------------------------------------------------------------ visningen

/**
 * lavFareView(scene, { fx, billede }) -> { opdater, haendelse, blus, vist, fjern }
 *   fx       effekterne (røg, gnister); valgfri
 *   billede  (navn) -> billede: til test; ellers hentes art directorens filer
 */
export function lavFareView(scene, { fx = null, billede = null } = {}) {
  hentFareGrafik();
  const hentBillede = billede || standardBillede;
  const rngFx = lavRng(0xFA2E);          // røg og gnister; ALDRIG simulationens

  const jord = new Group(); jord.position.z = Z.genstande;
  const luft = new Group(); luft.position.z = Z.projektiler - 1;
  const flammer = new Group(); flammer.position.z = Z.fx - 1;
  const graes = new Group(); graes.position.z = Z.terraen + 2.5;
  for (const g of [graes, jord, luft, flammer]) scene.add(g);

  const poster = new Map();             // fare-id -> tegning og hukommelse
  /* Farer, simulationen har meldt væk (fareVaek), og som ikke må tegnes igen:
   * id -> sidst set i spejlet (s). Hændelsen kan komme før deltaen, der
   * fjerner faren (værten sender hændelserne straks, men kun hver 3. delta;
   * lokalt er de to beskeder), og et dødsforløb på én frame (kanten, dronens
   * nedslag, vandet) er slut, før spejlet slipper faren. Uden gravstenen blev
   * den tegnet igen som ny: oprejst og hel oven på sit eget brag. */
  const borte = new Map();
  const pletter = new Map();            // ild-id -> tegning
  const maerker = new Map();            // x * 2048 + y -> brændt græs
  const udloesVent = new Set();         // ildTaendt kom før pletten (hændelsen går forud for deltaen)
  const flyvende = [];                  // kasser på vej hen til skytten (LEVERET!)
  let ramme = 0, sidstTid = null;

  // Glat bevægelse, som net/client.js giver kunderne: prøverne gemmes med
  // spejlets tick, og der tegnes lidt bag den nyeste (lokalt ~25 ms, over
  // nettet ~80 ms, så farerne ikke hopper med deltaernes 20 Hz).
  let sidsteTick = -1, modtaget = 0, interval = 1, rtKlok = -1;

  /** Sæt atlasset på en quad, når billedet findes (det kan komme senere). */
  function kort(m, navn) {
    if (m.material.map) return true;
    const img = hentBillede(navn);
    if (!img) { m.visible = false; return false; }
    m.material.map = tekstur(img);
    m.material.needsUpdate = true;
    return true;
  }

  function nyPost(f, nu) {
    const navn = f.hud || HUD[f.slags] || 'kabelsalat';
    const drone = f.slags === 'drone';
    const g = new Group();
    const drej = new Group();
    g.add(drej);
    const bredde = FARE_BREDDE[navn] || 36;
    const m = objektMesh(navn, bredde, drone ? LAG.drone : LAG.jord);
    drej.add(m);
    const midt = DREJ_MIDT[navn] || 0;
    drej.position.y = midt; m.position.y = -midt;
    (drone ? luft : jord).add(g);
    const p = {
      g, drej, m, klip: null, navn, slags: f.slags, drone, bredde, midt,
      fase: h01(f.id) * 10, ramme,
      x: f.x, y: f.y, forrigeX: f.x, forrigeY: f.y, hist: [], vinkel: 0, omega: 0, vx: 0, haeld: 0,
      tilst: f.tilst, landT: f.slags === 'stoevsuger' ? nu : null, udloes: null, brandT: null,
      foedt: nu, vaek: null, leveret: null, styrtT: null,
    };
    poster.set(f.id, p);
    return p;
  }

  /** Den glatte position ved render-tick rt (samme metode som client.js). */
  function placer(p, rt) {
    const h = p.hist;
    if (!h.length) return;
    if (rt <= h[0][0] || h.length === 1) { p.x = h[0][1]; p.y = h[0][2]; return; }
    for (let i = 1; i < h.length; i++) {
      if (rt <= h[i][0]) {
        const a = h[i - 1], b = h[i], k = (rt - a[0]) / Math.max(1, b[0] - a[0]);
        p.x = a[1] + (b[1] - a[1]) * k; p.y = a[2] + (b[2] - a[2]) * k;
        return;
      }
    }
    const a = h[h.length - 2], b = h[h.length - 1], k = (rt - b[0]) / Math.max(1, b[0] - a[0]);
    p.x = b[1] + (b[1] - a[1]) * k; p.y = b[2] + (b[2] - a[2]) * k;
  }

  /** Hvilke frames: ['tilstand', tid i forløbet, tempo]. Engangsforløb først. */
  function valg(p, f, nu) {
    if (p.udloes && nu - p.udloes.t0 < p.udloes.t) return ['udloes', nu - p.udloes.t0, p.udloes.fart];
    if (f.brand > 0) return ['aktiv', nu + p.fase, 1];
    if (p.landT !== null && nu - p.landT < LAND_S) return ['land', nu - p.landT, 1];
    if (f.tilst === 'luft') return ['fald', nu + p.fase, 1];
    return ['idle', nu + p.fase, p.drone ? 2 : f.tilst === 'koer' ? 1.6 : 1];
  }

  function opdaterFare(p, f, nu, dt, o) {
    const erNy = p.ramme === -1;
    p.ramme = ramme;
    // Landingen, som vi selv ser den: fra luften ned på jorden eller i vandet.
    if (p.tilst === 'luft' && f.tilst !== 'luft') p.landT = f.tilst === 'vand' ? null : nu;
    if (f.tilst === 'styrt' && p.styrtT === null) p.styrtT = nu;
    p.tilst = f.tilst;
    // Flytningen siden sidste frame, i den glattede position, der tegnes.
    const dx = erNy ? 0 : p.x - p.forrigeX, dy = erNy ? 0 : p.y - p.forrigeY;
    p.forrigeX = p.x; p.forrigeY = p.y;
    if (dt > 0) p.vx += (dx / dt - p.vx) * (1 - Math.exp(-dt / 0.12));

    const [tilst, t, fart] = valg(p, f, nu);
    const synlig = kort(p.m, p.navn);
    let rot = 0, s = 1, ly = 0, farve = 1;

    if (p.slags === 'kabelsalat') {
      // Rullen: vinklen følger x på jorden; i luften tumler den videre og
      // bremser; i vandet driver den langsomt.
      if (f.tilst === 'jord') { p.vinkel -= dx / RULLE_R; p.omega = dt > 0 ? -dx / RULLE_R / dt : p.omega; }
      else if (f.tilst === 'luft') { p.omega *= Math.exp(-dt / 1.4); p.vinkel += p.omega * dt; }
      else { p.vinkel -= dx / RULLE_R * 0.5; ly = Math.sin(nu * 2.4 + p.fase) * 1.2; }
      if (f.brand > 0) {
        // Brænder den, vugger den i takt med rullen, og flammerne læner sig
        // bagud. Fra rullens vinkel til vuggen på KORTSLUTNING-glimtets tid.
        const vug = 0.2 * Math.sin(p.vinkel) - 0.1 * klem(p.vx / 120, -1, 1);
        p.brandT ??= nu;
        const k = klem((nu - p.brandT) / UDLOES.kortslutning.t, 0, 1);
        rot = fold(p.vinkel) * (1 - k) + vug * k;
        if (fx && f.tilst !== 'vand' && rngFx() < dt * 10) fx.ildSpor(p.x + (rngFx() - 0.5) * 20, p.y + p.midt + 12);
      } else { p.brandT = null; rot = p.vinkel; }
      // Ligger den på jorden, bæres den af det, der lige nu peger nedad: et
      // stik, der stritter, løfter kuglen (så ruller den hen over det).
      if (f.tilst === 'jord' && p.m.material.map) {
        const r = profil(p.m.material.map.image, p.navn, p.bredde, p.midt);
        if (r) ly += Math.max(0, dybde(r, rot) - p.midt);
      }
    } else if (p.slags === 'stoevsuger') {
      // Kører den op ad en skrænt, hælder den med (glattet; trin på 8 wu).
      if (f.tilst === 'koer' && Math.abs(dx) > 0.2) {
        const maal = klem(Math.atan(dy / dx), -0.35, 0.35);
        p.haeld += (maal - p.haeld) * (1 - Math.exp(-dt / 0.12));
      } else if (f.tilst !== 'koer') p.haeld *= Math.exp(-dt / 0.2);
      rot = p.haeld;
      s = 1 + 0.05 * (f.spam | 0);                  // batteriet buler, jo mere den har spist
      // Den vågner: popper op fra jorden som minen, når den lægges.
      const a = Math.min(1, (nu - p.foedt) / 0.22);
      if (a < 1) s *= Math.max(0.05, 0.6 + 0.4 * tilbage(a));
      // Tvangsopdateret: stille, og den blinker blåt, mens opdateringen kører.
      if (f.tilst === 'pause') farve = 0.8 + 0.2 * Math.sin(nu * 6);
      if (f.brand > 0 && fx && rngFx() < dt * 6) fx.spor(p.x + (rngFx() - 0.5) * 16, p.y + 12);
    } else if (p.drone) {
      // Flyver: en let vippen mod flyveretningen og en blød svæven. Nedskudt:
      // den tumler, og der kommer røg ud af den.
      if (p.styrtT !== null) {
        rot = -(f.ret || 1) * Math.min(2.4, (nu - p.styrtT) * 2.2);
        if (fx && rngFx() < dt * 30) fx.spor(p.x, p.y + 30);
        if (fx && rngFx() < dt * 8) fx.lunteGnist(p.x, p.y + 30);
      } else {
        rot = -(f.ret || 1) * 0.07 + Math.sin(nu * 3 + p.fase) * 0.02;
        ly = Math.sin(nu * 2.2 + p.fase) * 1.5;
      }
    }

    // Dronen uden kasse (leveret eller skudt ned): kun cellens øverste stykke.
    if (p.drone) {
      const leverer = p.leveret && nu - p.leveret.t0 < UDLOES.leveret.t;
      const udenKasse = !leverer && (!f.pakke || f.styrt > 0 || f.tilst === 'styrt');
      if (udenKasse && !p.klip) {
        p.klip = klipMesh(p.navn, p.bredde, LAG.drone, 0, DRONE_KLIP);
        p.klip.position.y = -p.midt;               // som hele tegningen: origo i fodpunktet
        p.drej.add(p.klip);
      }
      if (p.klip) { p.klip.visible = udenKasse && kort(p.klip, p.navn); p.m.visible = !udenKasse && synlig; }
      else p.m.visible = synlig;
      if (udenKasse && p.klip) animerKlip(p.klip, nu + p.fase, 8);
      if (p.leveret && !leverer && !p.leveret.kasse) startKasse(p, o);
    } else p.m.visible = synlig;

    if (!(p.drone && p.klip?.visible)) animer(p.m, tilst, t, fart);
    p.g.position.set(p.x, p.y + ly, 0);
    p.drej.rotation.z = rot;
    p.g.scale.set(s, s, 1);
    p.m.material.color.setRGB(farve, farve * 0.97 + 0.03, 1);
  }

  /** LEVERET!: kassen flyver fra dronen hen til skytten og bliver væk. */
  function startKasse(p, o) {
    const m = klipMesh(p.navn, p.bredde, LAG.drone, KASSE_FRA, KASSE_TIL);
    saetKlipFrame(m, 'udloes_2');
    kort(m, p.navn);
    luft.add(m);
    const maal = o.figur?.(p.leveret.baever);
    flyvende.push({ m, t0: p.leveret.t0 + UDLOES.leveret.t, x0: p.x, y0: p.y,
                    x1: maal ? maal.x : p.x, y1: maal ? maal.y + 30 : p.y - 200 });
    p.leveret.kasse = true;
  }

  function opdaterFlyvende(nu) {
    for (let i = flyvende.length - 1; i >= 0; i--) {
      const k = flyvende[i], a = klem((nu - k.t0) / LEVER_S, 0, 1);
      // En bue: op først, så ned til skytten, og den bliver mindre undervejs.
      k.m.position.set(k.x0 + (k.x1 - k.x0) * a, k.y0 + (k.y1 - k.y0) * a + Math.sin(a * Math.PI) * 90, 0);
      const s = 1 - 0.55 * a;
      k.m.scale.set(s, s, 1);
      k.m.rotation.z = a * 1.2;
      k.m.material.opacity = a < 0.8 ? 1 : 1 - (a - 0.8) / 0.2;
      if (a >= 1) { smid(k.m); flyvende.splice(i, 1); }
    }
  }

  /** Gennemsigtighed på farens quads (med og uden kasse). */
  function alfa(p, a) {
    p.m.material.opacity = a;
    if (p.klip) p.klip.material.opacity = a;
  }

  /** En fare, der er væk: dødsforløbet på stedet, så fjernes den. */
  function opdaterVaek(p, nu, dt) {
    const v = p.vaek, t = nu - v.t0;
    let faerdig = false;
    const doed = DOED_S[p.navn];
    if (v.grund === 'brag' && doed !== undefined) {
      // Asken (eller batteriet, der springer) står på jorden, så toner den ud.
      animer(p.m, 'doed', t, 4 / 10 / doed);
      p.drej.rotation.z *= Math.exp(-dt / 0.05);
      p.m.visible = !!p.m.material.map;
      alfa(p, klem(1 - (t - doed - HOLD_S) / TON_S, 0, 1));
      faerdig = t > doed + HOLD_S + TON_S;
    } else if (v.grund === 'traet' && p.slags === 'kabelsalat') {
      // Blæst væk: op og væk med vinden, mindre og mindre.
      const a = klem(t / 0.8, 0, 1);
      p.g.position.set(v.x + (v.ret || 1) * 50 * a, v.y + 36 * a, 0);
      p.g.scale.setScalar(1 - 0.4 * a);
      alfa(p, 1 - a);
      p.vinkel -= (v.ret || 1) * dt * 5;
      p.drej.rotation.z = p.vinkel;
      faerdig = a >= 1;
    } else if (v.grund === 'slukket' || v.grund === 'kortsluttet' || v.grund === 'traet') {
      // Slukket i vandet (PSST), kortsluttet eller træt: synker lidt og toner ud.
      const a = klem(t / 0.7, 0, 1);
      p.g.position.y = v.y - 10 * a;
      alfa(p, 1 - a);
      if (fx && a < 0.6 && rngFx() < dt * 25) fx.spor(v.x + (rngFx() - 0.5) * 18, v.y + 8);
      faerdig = a >= 1;
    } else if (v.grund === 'ukendt') {
      // Væk fra spejlet uden en hændelse (endnu): tones kort ud, hvor den er.
      const a = klem(t / 0.3, 0, 1);
      alfa(p, 1 - a);
      faerdig = a >= 1;
    } else faerdig = true;          // kanten, dronens nedslag (braget dækker) og plasket
    if (faerdig) { smid(p.g); return true; }
    return false;
  }

  // ---- ilden og det brændte græs

  function nyPlet(q, nu) {
    const m = objektMesh('ild', FARE_BREDDE.ild * (0.9 + 0.22 * h01(q.id + 7)), LAG.ild);
    flammer.add(m);
    const pl = { m, ramme, fase: h01(q.id) * 10, spejl: h01(q.id + 3) < 0.5 ? -1 : 1,
                 foedt: nu, x: q.x, y: q.y, udloes: null, blus: -1, faldT: -1, vaek: null };
    // En ny brand (ildTaendt) blusser op i stedet for at tændes med et puf.
    if (udloesVent.delete(q.id)) pl.udloes = nu;
    pletter.set(q.id, pl);
    return pl;
  }

  function opdaterPlet(pl, q, nu) {
    pl.ramme = ramme;
    if (q.y < pl.y - 4) pl.faldT = nu;                 // jorden forsvandt: den falder ned
    pl.x = q.x; pl.y = q.y;
    const alder = nu - pl.foedt;
    const vis = kort(pl.m, 'ild');
    pl.m.visible = vis;
    if (pl.udloes !== null && nu - pl.udloes < UDLOES.ild.t) animer(pl.m, 'udloes', nu - pl.udloes);
    else if (alder < LAND_S) animer(pl.m, 'land', alder);
    else if (nu - pl.blus < 0.5) animer(pl.m, 'aktiv', nu - pl.blus, 1.2);
    else if (nu - pl.faldT < 0.3) animer(pl.m, 'fald', nu - pl.faldT);
    else animer(pl.m, 'idle', nu + pl.fase, 1.6);
    // Ilden, der er ved at gå ud, bliver mindre.
    const rest = q.rest ?? 240;
    const s = rest < 40 ? 0.75 + 0.25 * rest / 40 : 1;
    pl.m.position.set(q.x, q.y, 0);
    pl.m.scale.set(pl.spejl * s, s, 1);
    // Det brændte græs, når ilden har brændt et øjeblik.
    if (alder >= GRAES_EFTER) maerke(q.x, q.y, nu);
  }

  function opdaterPletVaek(pl, nu) {
    const t = nu - pl.vaek;
    animer(pl.m, 'doed', t, 4 / 10 / DOED_S.ild);
    pl.m.material.opacity = klem(1 - (t - DOED_S.ild - 0.2) / 0.35, 0, 1);
    if (t > DOED_S.ild + 0.55) { smid(pl.m); return true; }
    return false;
  }

  function maerke(x, y, nu) {
    const n = x * 2048 + y;
    let g = maerker.get(n);
    if (g) { g.sidst = nu; return; }
    if (maerker.size >= GRAES_MAKS) {
      // Det ældste går først.
      let aeldst = null;
      for (const [k, e] of maerker) if (!aeldst || e.sidst < aeldst[1].sidst) aeldst = [k, e];
      smid(aeldst[1].m); maerker.delete(aeldst[0]);
    }
    const hx = h01(x * 31 + y), b = GRAES_BREDDE * (0.9 + 0.25 * hx);
    const m = new Mesh(new PlaneGeometry(b, b * 51 / 256),
      new MeshBasicMaterial({ transparent: true, depthTest: true, depthWrite: false, opacity: 0 }));
    m.geometry.translate(0, b * 51 / 256 / 2, 0);       // bunden på jorden
    m.renderOrder = LAG.graes;
    // Bunden lige i jordlinjen: pletten står på den pixel, ilden står på.
    m.position.set(x + (hx - 0.5) * 6, y - 1.5, 0);
    m.scale.x = hx < 0.5 ? -1 : 1;
    graes.add(m);
    maerker.set(n, { m, foedt: nu, sidst: nu, x, y, tjek: nu });
  }

  function opdaterMaerker(nu, terraen) {
    for (const [n, e] of maerker) {
      if (!e.m.material.map) { const img = hentBillede('braendt_graes'); if (img) { e.m.material.map = tekstur(img); e.m.material.needsUpdate = true; } }
      e.m.visible = !!e.m.material.map;
      const ind = klem((nu - e.foedt) / 1.2, 0, 1);
      const ud = klem(1 - (nu - e.sidst - GRAES_LIV) / GRAES_UD, 0, 1);
      // Er jorden under den skudt væk, forsvinder den med den.
      if (terraen && nu - e.tjek > 0.5) {
        e.tjek = nu;
        if (!terraen.fast(Math.round(e.x), Math.round(e.y) - 2)) e.borte = nu;
      }
      const vaek = e.borte ? klem(1 - (nu - e.borte) / 0.3, 0, 1) : 1;
      e.m.material.opacity = ind * ud * vaek;
      if (ud <= 0 || vaek <= 0) { smid(e.m); maerker.delete(n); }
    }
  }

  const api = {
    /**
     * Hver frame. farer, ild: spejlets v.farer og v.ild. tid: sekunder (rAF).
     * o: { tick (spejlets v.tick), terraen, figur(id) -> kunde (LEVERET!) }.
     */
    opdater(farer, ild, tid, o = {}) {
      const nu = tid;
      const dt = sidstTid === null ? 0 : klem(nu - sidstTid, 0, 0.1);
      sidstTid = nu;
      ramme++;
      farer ||= []; ild ||= [];

      // Nye prøver, når spejlet har fået en ny delta.
      const tick = o.tick ?? -1;
      if (tick !== sidsteTick && tick >= 0) {
        if (sidsteTick >= 0 && tick > sidsteTick) interval += ((tick - sidsteTick) - interval) * 0.2;
        sidsteTick = tick; modtaget = nu;
        for (const f of farer) {
          const p = poster.get(f.id);
          if (!p || p.vaek) continue;
          const h = p.hist, sidst = h[h.length - 1];
          if (sidst && Math.hypot(f.x - sidst[1], f.y - sidst[2]) > SPRING) h.length = 0;
          if (!sidst || sidst[0] !== tick) h.push([tick, f.x, f.y]);
          if (h.length > 5) h.shift();
        }
      }
      let rt = -1;
      if (sidsteTick >= 0) {
        const maal = sidsteTick + (nu - modtaget) * 60 - Math.max(1.5, interval * 1.6);
        if (rtKlok < 0 || Math.abs(maal - rtKlok) > 12) rtKlok = maal;
        else rtKlok += dt * 60 * klem(1 + (maal - rtKlok) * 0.08, 0.75, 1.25);
        rt = Math.min(rtKlok, sidsteTick + 1);
      }

      for (const f of farer) {
        let p = poster.get(f.id);
        if (p?.vaek) continue;                       // dødsforløbet kører; spejlet halter
        if (!p && borte.has(f.id)) { borte.set(f.id, nu); continue; }   // meldt væk; spejlet halter
        if (!p) { p = nyPost(f, nu); p.ramme = -1; p.hist.push([Math.max(0, tick), f.x, f.y]); }
        if (rt >= 0 && p.hist.length) placer(p, rt); else { p.x = f.x; p.y = f.y; }
        opdaterFare(p, f, nu, dt, o);
      }
      for (const [id, p] of poster) {
        if (p.vaek) { if (opdaterVaek(p, nu, dt)) poster.delete(id); continue; }
        // Væk fra spejlet uden en hændelse (fx et snapshot): tones kort ud.
        if (p.ramme !== ramme) api.haendelse('fareVaek', { id, grund: 'ukendt', x: p.x, y: p.y }, nu);
      }
      // Gravstenen slippes, når spejlet længe nok ikke har vist faren.
      for (const [id, sidst] of borte) if (nu - sidst > BORTE_S) borte.delete(id);

      for (const q of ild) {
        let pl = pletter.get(q.id);
        if (pl?.vaek != null) continue;
        if (!pl) pl = nyPlet(q, nu);
        opdaterPlet(pl, q, nu);
      }
      for (const [id, pl] of pletter) {
        if (pl.vaek === null && pl.ramme !== ramme) pl.vaek = nu;
        if (pl.vaek !== null && opdaterPletVaek(pl, nu)) pletter.delete(id);
      }
      opdaterMaerker(nu, o.terraen);
      opdaterFlyvende(nu);
    },

    /** En hændelse fra simulationen (ui/farer.js sender dem videre). */
    haendelse(navn, e, nu = sidstTid ?? 0) {
      const p = e?.id != null ? poster.get(e.id) : null;
      switch (navn) {
        case 'fareAntaendt':
          if (!p) return;
          if (p.slags === 'kabelsalat') p.udloes = { t0: nu, ...UDLOES.kortslutning };
          if (p.drone) p.styrtT ??= nu;
          break;
        case 'fareSpiste':
          if (p?.slags === 'stoevsuger') p.udloes = { t0: nu, ...UDLOES.nom };
          break;
        case 'fareLeveret':
          if (p?.drone) { p.udloes = { t0: nu, ...UDLOES.leveret }; p.leveret = { t0: nu, baever: e.baever, kasse: false }; }
          break;
        case 'fareVaek': {
          const grund = e.grund || 'ukendt';
          // Simulationen har fjernet faren for altid (id'er genbruges ikke):
          // den tegnes ikke igen, heller ikke hvis den endnu ikke er tegnet.
          if (grund !== 'ukendt' && e.id != null) borte.set(e.id, nu);
          // En kendt grund afløser 'ukendt' (spejlet kom før hændelsen).
          if (!p || (p.vaek && p.vaek.grund !== 'ukendt')) return;
          // Dødsforløbet står, hvor faren var (simulationens sted, ellers vores).
          p.vaek = { grund, t0: nu, x: e.x ?? p.x, y: e.y ?? p.y, ret: e.ret ?? Math.sign(p.vx) };
          alfa(p, 1);
          if (grund === 'brag') {
            p.g.position.set(p.vaek.x, p.vaek.y, 0);
            p.m.visible = true;
            if (p.klip) p.klip.visible = false;
          }
          break;
        }
        case 'ildTaendt': {
          const pl = pletter.get(e.id);
          if (pl) pl.udloes = nu;
          else udloesVent.add(e.id);
          break;
        }
      }
    },

    /** Ilden blusser op, dér hvor den skadede en kunde (skadetakten). */
    blus(x, y) {
      let bedst = null, bd = 30 * 30;
      for (const [, pl] of pletter) {
        if (pl.vaek !== null) continue;
        const d = (pl.x - x) ** 2 + (pl.y - y) ** 2;
        if (d < bd) { bd = d; bedst = pl; }
      }
      if (bedst) bedst.blus = sidstTid ?? 0;
    },

    /** Hvor faren TEGNES (glattet), til navneskiltet og pilen. */
    vist(id) {
      const p = poster.get(id);
      return p && !p.vaek ? p : null;
    },

    /** Til test: hvad der tegnes lige nu. */
    get _poster() { return poster; },
    get _pletter() { return pletter; },
    get _maerker() { return maerker; },
    get _grupper() { return { jord, luft, flammer, graes }; },

    fjern() {
      for (const [, p] of poster) smid(p.g);
      for (const [, pl] of pletter) smid(pl.m);
      for (const [, e] of maerker) smid(e.m);
      for (const k of flyvende) smid(k.m);
      poster.clear(); pletter.clear(); maerker.clear(); flyvende.length = 0; udloesVent.clear(); borte.clear();
      for (const g of [graes, jord, luft, flammer]) scene.remove(g);
    },
  };
  return api;
}
