/* Kundekrigen — three.js-opsætning.
 *
 * Three bruges som et tyndt GPU-lag: WebGLRenderer, ortografisk kamera,
 * quads og håndskrevne shaders. Ingen loaders, ingen indbyggede lysmaterialer
 * — så en revisionsopdatering kan ikke stille ændre udseendet.
 */
'use strict';

import { WebGLRenderer, Scene, OrthographicCamera, Color } from '../three.js';
import { C } from './palette.js';

// Synlig verdenshøjde ved zoom 1. Sat op fra 720 efter playtest: med et
// lavere udsyn lå havet næsten altid lige under billedkanten, når man stod
// på et plateau, og så opdagede man aldrig, at man kunne falde i det.
export const VERDEN_H = 860;
export const MIN_BREDDE = 1300;
export const MAKS_BREDDE = 2600;

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
      const aspekt = w / Math.max(1, h);
      const vh = VERDEN_H * zoom;
      // Behold verdenshøjden fast og udled bredden. En 16:9- og en 16:10-skærm
      // ser dermed samme lodrette udsnit; det er rimeligt nok på et LAN-spil
      // og langt simplere end noget alternativ der bevarer retfærdighed.
      let vw = vh * aspekt;
      vw = Math.max(MIN_BREDDE * zoom, Math.min(MAKS_BREDDE * zoom, vw));
      kamera.left = -vw / 2; kamera.right = vw / 2;
      kamera.top = vh / 2; kamera.bottom = -vh / 2;
      kamera.updateProjectionMatrix();
      api.bredde = vw; api.hoejde = vh;
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
