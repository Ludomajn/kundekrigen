/* Kundekrigen — three.js-opsætning.
 *
 * Three bruges som et tyndt GPU-lag: WebGLRenderer, ortografisk kamera,
 * quads og håndskrevne shaders. Ingen loaders, ingen indbyggede lysmaterialer
 * — så en revisionsopdatering kan ikke stille ændre udseendet.
 */
'use strict';

import { WebGLRenderer, Scene, OrthographicCamera, Color } from '../three.js';
import { C } from './palette.js';

// Synlig verdenshøjde ved zoom 1 (kameraets standardzoom). Sat ned fra 860:
// dér fyldte en figur (46 wu) kun 5,3 % af skærmhøjden, og spillet føltes
// langt væk. Ved 460 fylder den 10 %, som i Worms W.M.D. Havet, som var
// grunden til de 860, holder kameraet nu selv i billedet (camera.js: havet
// trækker billedet ned), og det zoomer ud, når der sigtes og skydes.
// Målinger og konstanter: docs/kamera.md.
export const VERDEN_H = 460;
// Grænser for bredden ved zoom 1. Mellem dem er højden VERDEN_H (forhold
// 1,35-3,04: 4:3 til 32:9); uden for dem følger højden med, så billedet
// aldrig strækkes skævt.
export const MIN_BREDDE = 620;
export const MAKS_BREDDE = 1400;

/**
 * Udsnittet i wu ved zoom 1 for et lærred med forholdet `aspekt` (bredde /
 * højde). Alt er lineært i zoom: ved zoom z er udsnittet z * b gange z * h.
 * Skriver i `ud`, så kaldet per frame ikke allokerer.
 */
export function udsnit(aspekt, ud = { b: 0, h: 0 }) {
  const a = aspekt > 0 && Number.isFinite(aspekt) ? aspekt : 16 / 9;
  const b = Math.max(MIN_BREDDE, Math.min(MAKS_BREDDE, VERDEN_H * a));
  ud.b = b;
  ud.h = b / a;
  return ud;
}

/* Z-lag.
 *
 * Terrænet er UIGENNEMSIGTIGT og skriver til dybdebufferen. Alt andet er
 * gennemsigtigt og skal derfor TESTE mod den dybde, men ikke skrive den:
 * three tegner altid gennemsigtige objekter EFTER uigennemsigtige, så uden
 * dybdetest ville parallaksbaggrunden male hen over terrænet i forgrunden.
 * Med kameraet kiggende ned ad -z er større z tættere på, så rækkefølgen
 * nedenfor er også den fysiske dybdeorden. */
export const Z = {
  himmel: -90,
  // Ni lag, fjernest først. Hvert har sin egen parallaksefaktor og sin
  // egen egenbevægelse (drift, svaj) — se parallax.js.
  parallaks: [-88, -84, -80, -76, -72, -68, -64, -60, -56, -52, -48, -44],
  fjernVejr: -20,
  terraen: 0,
  genstande: 5,
  baevere: 10,
  vandBag: 12,
  projektiler: 15,
  fx: 20,
  vandFor: 25,
  naertVejr: 30,
};

export function lavRenderer(laerred) {
  const r = new WebGLRenderer({
    canvas: laerred,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setClearColor(new Color(C.ice).lerp(new Color(0xffffff), 0.5), 1);

  const scene = new Scene();
  const kamera = new OrthographicCamera(-640, 640, 360, -360, -1000, 1000);
  kamera.position.z = 100;

  const api = {
    renderer: r,
    scene,
    kamera,
    bredde: 1280,
    hoejde: 720,
    zoom: 1,
    // Udsnittet ved zoom 1 for lærredets forhold (se udsnit). Kameraet
    // regner sine indramninger med det: ved zoom z ser man z * enhed.
    enhed: udsnit(16 / 9),

    /* Kaldes hver frame (zoom ændrer sig blødt), så setSize må KUN ske når
       lærredets faktiske størrelse har ændret sig. setSize reallokerer
       framebufferen, og et kald per frame koster stort set hele billedraten. */
    tilpas(zoom = api.zoom) {
      api.zoom = zoom;
      const w = laerred.clientWidth || window.innerWidth;
      const h = laerred.clientHeight || window.innerHeight;
      if (w !== api._w || h !== api._h) {
        api._w = w; api._h = h;
        r.setSize(w, h, false);
      }
      // Behold verdenshøjden fast og udled bredden. En 16:9- og en 16:10-skærm
      // ser dermed samme lodrette udsnit; det er rimeligt nok på et LAN-spil
      // og langt simplere end noget alternativ der bevarer retfærdighed.
      // Rammer bredden sin grænse, følger højden med i stedet for at strække
      // billedet (før blev en 4:3-skærm klemt vandret).
      udsnit(w / Math.max(1, h), api.enhed);
      const vw = api.enhed.b * zoom, vh = api.enhed.h * zoom;
      kamera.left = -vw / 2; kamera.right = vw / 2;
      kamera.top = vh / 2; kamera.bottom = -vh / 2;
      kamera.updateProjectionMatrix();
      api.bredde = vw; api.hoejde = vh;
    },

    /** Den zoom, der mindst viser et udsnit på bredde x hoejde wu. */
    zoomDerViser(bredde, hoejde) {
      return Math.max(bredde / api.enhed.b, hoejde / api.enhed.h);
    },

    tegn() { r.render(scene, kamera); },

    /** Verden -> skærmpixel. Bruges af DOM-etiketterne over bæverne. */
    tilSkaerm(x, y) {
      const w = laerred.clientWidth || window.innerWidth;
      const h = laerred.clientHeight || window.innerHeight;
      const sx = (x - kamera.position.x - kamera.left) / (kamera.right - kamera.left) * w;
      const sy = h - (y - kamera.position.y - kamera.bottom) / (kamera.top - kamera.bottom) * h;
      return { x: sx, y: sy };
    },
  };

  api._w = 0; api._h = 0;
  api.tilpas(1);
  window.addEventListener('resize', () => api.tilpas());
  return api;
}
