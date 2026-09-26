/* Kundekrigen — enhederne som FIGURER: de 16 tegneseriekunder.
 *
 * Kunderne er brugerens egne figurer (Assets/Cartoon Characters/Kundekrigen,
 * bygget på rgsdev's Cartoon Character Generator) med tyk sort kontur og
 * færdigtegnede frames: tomgang, løb, hop, angreb og død. vaerktoej/
 * tegneseriekunder.py har pakket kroppens 20 frames i ét atlas pr. kunde,
 * klippet en ren knytnæve ud og fundet hændernes plads i hver frame.
 *
 * Kroppen er frame-animation i figurernes egen stil. Hænderne er løse, så
 * den forreste kan holde spillets IT-våben og følge sigtet; resten af tiden
 * følger begge hænder animationens egne håndpositioner.
 *
 * Holdet ses på navneskiltet (som i Worms) — figurerne har faste outfits.
 *
 * Koordinater: riggens tal er pixels i atlassets celle (y nedad). tilWu()
 * fører dem over i figurens rum i verden (wu, y opad, fodpunktet i 0,0).
 */
'use strict';

import {
  Texture, LinearFilter, Mesh, PlaneGeometry, MeshBasicMaterial, Group, SRGBColorSpace,
  CanvasTexture,
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

/** Grafik til kamp og menu: spritearket og de 16 kunder. */
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

export function standardUdseende(rng = Math.random) {
  return { v: 5, figur: Math.floor(rng() * KUNDER.length) };
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
 *   sigte    holdt i hånden og sigtet med (scanner, loddekolbe)
 *   ned      holdt skråt ned foran (boret graver nedad)
 *   haand    holdt opret i den forreste hånd (kasteting, redskaber)
 * baglaens er den del af tingen, der rager bag grebet. */
const MODEL = {
  grenroer:         { tegn: 'bazooka',        greb: 'skulder', baglaens: 0.3 },   // Tonerkanon
  splintboesse:     { tegn: 'scanner',        greb: 'sigte',   baglaens: 0.2 },   // Stregkodescanner
  gnavetand:        { tegn: 'loddekolbe',     greb: 'sigte',   baglaens: 0.3 },   // Loddekolbe
  nedgravning:      { tegn: 'bor',            greb: 'ned',     baglaens: 0.25 },  // Systemnedbrud
  egegranat:        { tegn: 'mus',            greb: 'haand' },   // Musegranat
  koglebombe:       { tegn: 'tastatur',       greb: 'haand' },   // Tastaturbombe
  daemningsdynamit: { tegn: 'opdatering',     greb: 'haand' },   // Tvangsopdatering
  baevermine:       { tegn: 'mail',           greb: 'haand' },   // Phishing-mine
  halesmaek:        { tegn: 'ringbind',       greb: 'haand' },   // Ringbindsslag
  bjaelke:          { tegn: 'serverrack',     greb: 'haand' },   // Serverrack
  papirbunke:       { tegn: 'papirbunke',     greb: 'haand' },   // Papirbunke
  kabelbakke:       { tegn: 'kabelbakke',     greb: 'haand' },   // Kabelbakke
  byggeskum:        { tegn: 'skumpistol',     greb: 'sigte',   baglaens: 0.25 },  // Byggeskum
  gangtunnel:       { tegn: 'fjernbetjening', greb: 'haand' },   // Fjernsupport
  traestammeregn:   { tegn: 'radio',          greb: 'haand' },   // Faxregn
  overgiv:          { tegn: 'flag',           greb: 'haand' },   // Opsig aftalen
};

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

export function lavBaeverView(scene, baever, holdIdx, terraen) {
  // Ledige sæder har intet udseende; de får en fast kunde ud fra id'et, så
  // holdet er blandet og ens hos alle spillere.
  const u = baever.udseende?.v === 5 || baever.udseende?.v === 4 ? normaliserUdseende(baever.udseende)
    : { v: 5, figur: (baever.id * 7 + holdIdx * 3) % KUNDER.length };
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
  function model(id) {
    if (modeller.has(id)) return modeller.get(id);
    const m = MODEL[id];
    const maal = m && vaabenMaal(m.tegn);
    let mesh = null;
    if (maal) {
      const geo = new PlaneGeometry(maal.bredde, maal.hoejde);
      if (m.greb === 'haand') geo.translate(-maal.midtX, -maal.bund - 1.5, 0);
      else geo.translate(-maal.venstre - maal.indholdB * m.baglaens, -maal.midtY, 0);
      mesh = new Mesh(geo, new MeshBasicMaterial({
        map: tex(maal.canvas, `vaaben-${m.tegn}`), transparent: true, depthTest: true, depthWrite: false }));
      mesh.userData.greb = m.greb;
      mesh.visible = false;
      mesh.scale.setScalar(HOLDT_STR);
      krop.add(mesh);
    }
    modeller.set(id, mesh);
    return mesh;
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
  // Introen: kunden falder ned fra himlen (se introFald).
  let introT = null, introLand = null, landetT = -1;
  const INTRO_H = 330, INTRO_G = 1500;
  const INTRO_FALD = Math.sqrt(2 * INTRO_H / INTRO_G);
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
  function vaelgFrame(b, gaar, jubler, iLuften) {
    if (introT !== null && introT < INTRO_FALD) return F.jump_1;
    if (b.doed) return F[`death_${Math.min(3, Math.floor(doedTid * 9))}`];
    if (tid < skadeTil) return F[tid < skadeTil - 0.7 ? 'death_1' : 'death_0'];
    if (jubler && b.paaJorden) return loekke(['jump_0', 'jump_1'], 3.4, tid + fase);
    if (b.redskab) return loekke(['attack_r_0', 'attack_r_1', 'attack_r_2'], 10, tid);
    if (iLuften) return F[b.vy > 0 ? 'jump_0' : 'jump_1'];
    if (gaar) return loekke(['run_0', 'run_1', 'run_2', 'run_3'], 10, gangT);
    return loekke(['idle_0', 'idle_1', 'idle_2', 'idle_3'], 4, animT);
  }

  const api = {
    gruppe, krop, ring,
    saetFrame() {},                          // bevaret for API-kompatibilitet

    visVaaben(vaabenId, dx = 1, dy = 0) {
      const ny = vaabenId && MODEL[vaabenId] ? vaabenId : null;
      if (ny !== aktivId) {
        const gammel = aktivId && model(aktivId);
        if (gammel) gammel.visible = false;
        aktivId = ny;
      }
      sigter = !!aktivId;
      if (sigter) sigteRot = Math.atan2(dy, Math.max(0.0001, Math.abs(dx)));
    },

    rekylSkud() { rekyl = 1; },

    /** Dødsfaldet: glitch, FEJL 40, og ind i det sorte hul. */
    absorber() { if (absorbT === null) absorbT = 0; },

    /** Introen: kunden venter `forsinkelse` sekunder og falder så ned fra
     *  himlen; vedLand kaldes i landingsøjeblikket (lyd, støv). */
    introFald(forsinkelse, vedLand) { introT = -forsinkelse; introLand = vedLand; },

    /** Skaden afsløres: kunden krymper sig, blinker rødt og ryster. */
    ramt() { skadeTil = tid + 1.2; flash = 1; },

    /** harGrav: skiltet står nu, hvor kunden faldt — så overtager det.
     *  jubler: kampen er vundet, og kunden fejrer det. */
    opdater(b, dt = 1 / 60, harGrav = false, jubler = false) {
      tid += dt; animT += dt;
      doedTid = b.doed ? doedTid + dt : 0;
      const x = b.x, y = b.y;               // interpoleret af klienten
      gruppe.position.x = x;

      // ---- kontakt med jorden
      // Figuren står på selve overfladen under sig, og højden glattes, så
      // pixeltrin i terrænet ikke ryster den. Rigtige hop og fald følges direkte.
      luftTid = b.paaJorden ? 0 : luftTid + dt;
      const paaFod = !b.doed && (b.paaJorden || (luftTid < 0.25 && Math.abs(b.vy) < 160));
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
      } else if (terraen && !b.doed) {
        const jordY = terraen.overflade(Math.round(x));
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

      // Rødt glimt, mens skaden tælles ned (se ramt()).
      if (flash > 0 && !b.doed) {
        flash = Math.max(0, flash - dt * 1.6);
        const kf = Math.max(0, Math.sin(tid * 30)) * flash;
        for (const m of alleMeshes()) m.material.color.setRGB(1, 1 - 0.55 * kf, 1 - 0.6 * kf);
      }
      if (b.doed && !doedVist) {
        doedVist = true;
        for (const m of alleMeshes()) m.material.color.setRGB(0.62, 0.62, 0.66);
      }

      const spejl = b.retning >= 0 ? 1 : -1;
      const gaar = (Math.abs(b.vx) > 1 || b.gaar) && (b.paaJorden || luftTid < 0.25);
      if (gaar) gangT += dt;
      const iLuften = !b.paaJorden && (luftTid > 0.25 || Math.abs(b.vy) > 160);

      // ---- kroppens frame og hændernes plads i den
      const fi = vaelgFrame(b, gaar, jubler, iLuften);
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
      const vm = aktivId && model(aktivId);
      const holder = sigter && vm && !b.doed && (b.paaJorden || luftTid < 0.25) && !jubler && !b.redskab;
      const greb = holder ? vm.userData.greb : null;
      if (vm) vm.visible = !!holder;
      haandFor.rotation.z = 0;
      if (holder) {
        const v = greb === 'ned' ? -0.9 : sigteRot;
        const [sx, sy] = tilWu(skulderPx[0], skulderPx[1]);
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
      haandFor.position.set(fx, fy, 0);

      // ---- hele kroppen: spejl, hældning, hop og rystelse
      const maalHaeld = b.paaJorden && !b.doed ? terraenHaeldning(x) * 0.35 : 0;
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
      krop.rotation.z = haeld * spejl + spin * spejl;
      krop.position.set(0, bob, 0);
      krop.scale.y = 1;
      // Introens fald: fra himlen med tyngde, og et lille squash ved landing.
      if (introT !== null) {
        introT += dt;
        if (introT < 0) gruppe.visible = false;
        else if (introT < INTRO_FALD) krop.position.y += INTRO_H - 0.5 * INTRO_G * introT * introT;
        else {
          if (landetT < 0) { landetT = tid; introLand?.(); }
          const s = tid - landetT;
          if (s < 0.25) { krop.scale.y = 1 - 0.28 * Math.sin((s / 0.25) * Math.PI); krop.scale.x = spejl * (1 + 0.18 * Math.sin((s / 0.25) * Math.PI)); }
          else introT = null;
        }
        if (introT !== null && introT < INTRO_FALD * 0.4) ring.visible = false;
      }
      if (tid < skadeTil && !b.doed) krop.position.x += Math.sin(tid * 70) * 1.3 * (skadeTil - tid);
      if (absorbT !== null && absorbT < GLITCH_TID) {
        // Glitch: figuren hakker sidelæns og skifter mellem cyan og magenta.
        krop.position.x += (Math.random() - 0.5) * 7;
        krop.scale.y = 1 + (Math.random() - 0.5) * 0.25;
        const f = Math.floor(absorbT * 40) % 3;
        for (const m of alleMeshes()) m.material.color.setRGB(f === 0 ? 0.3 : 1, f === 1 ? 0.3 : 1, 1);
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
