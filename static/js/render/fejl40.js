/* Kundekrigen — døden som IT-fejl: "FEJL 40" og et sort hul.
 *
 * (Fejl 40: problemet sidder ca. 40 cm fra skærmen.) Når en kunde dør,
 * glitcher figuren, bliver til et fejlvindue med "FEJL 40", og et sort hul
 * åbner sig og suger vinduet ind i en spiral. Hullet lukker med et smæld —
 * ligets detonation, som simulationen venter med i SORT_HUL_TICKS.
 *
 * Ren præsentation. Tidsforløbet (sekunder):
 *   0,00–0,35  figuren glitcher; hullet åbner sig
 *   0,35–1,15  fejlvinduet suges ind i spiral og krymper
 *   1,05–1,30  hullet lukker
 */
'use strict';

import {
  CanvasTexture, LinearFilter, Mesh, PlaneGeometry, MeshBasicMaterial, Group, SRGBColorSpace,
} from '../three.js';
import { Z } from './renderer.js';

export const HUL_TID = 1.3;
export const GLITCH_TID = 0.35;

function tekstur(c) {
  const t = new CanvasTexture(c);
  t.minFilter = t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Fejlvinduet: titellinje, rødt kryds og "FEJL 40". Tegnet i spillets stil. */
export function tegnFejlvindue(g, w, h) {
  const r = h * 0.12;
  g.lineJoin = 'round';
  g.fillStyle = '#1E1610';
  g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
  g.fillStyle = '#F4F6F8';
  g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, r - 2); g.fill();
  g.fillStyle = '#2F8FC0';
  g.beginPath(); g.roundRect(3, 3, w - 6, h * 0.24, [r - 2, r - 2, 0, 0]); g.fill();
  g.fillStyle = '#F4F6F8';
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(w - 12 - i * 11, 3 + h * 0.12, h * 0.045, 0, Math.PI * 2); g.fill(); }
  // Rødt kryds
  const cx = w * 0.22, cy = h * 0.6, cr = h * 0.2;
  g.fillStyle = '#1E1610'; g.beginPath(); g.arc(cx, cy, cr + 3, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#E8412C'; g.beginPath(); g.arc(cx, cy, cr, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#FFFFFF'; g.lineWidth = h * 0.06; g.lineCap = 'round';
  const k = cr * 0.45;
  g.beginPath(); g.moveTo(cx - k, cy - k); g.lineTo(cx + k, cy + k);
  g.moveTo(cx + k, cy - k); g.lineTo(cx - k, cy + k); g.stroke();
  g.fillStyle = '#1E1610';
  g.font = `900 ${Math.round(h * 0.25)}px Poppins, system-ui, sans-serif`;
  g.textBaseline = 'middle';
  g.fillText('FEJL 40', w * 0.42, cy);
}

let _vindue = null;
export function fejlvindueTex() {
  if (_vindue) return _vindue;
  const c = document.createElement('canvas'); c.width = 256; c.height = 150;
  tegnFejlvindue(c.getContext('2d'), 256, 150);
  _vindue = tekstur(c);
  return _vindue;
}

let _hul = null;
function hulTex() {
  if (_hul) return _hul;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  // Lysende rand: violet til blå, som akkretionsskiven om et hul.
  const rand = g.createRadialGradient(0, 0, S * 0.18, 0, 0, S * 0.5);
  rand.addColorStop(0, 'rgba(10,6,20,1)'); rand.addColorStop(0.45, 'rgba(90,40,170,.95)');
  rand.addColorStop(0.7, 'rgba(47,143,192,.55)'); rand.addColorStop(1, 'rgba(47,143,192,0)');
  g.fillStyle = rand; g.beginPath(); g.arc(0, 0, S / 2, 0, Math.PI * 2); g.fill();
  // Spiralarme
  g.strokeStyle = 'rgba(200,170,255,.55)'; g.lineWidth = 5; g.lineCap = 'round';
  for (let a = 0; a < 4; a++) {
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, rr = S * (0.14 + t * 0.34), v = a * Math.PI / 2 + t * 3.2;
      const x = Math.cos(v) * rr, y = Math.sin(v) * rr;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
  // Selve hullet: helt sort med en tynd lys kant.
  g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, S * 0.17, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,216,111,.85)'; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, S * 0.17, 0, Math.PI * 2); g.stroke();
  _hul = tekstur(c);
  return _hul;
}

/** Sorte huller i scenen. start() ved hvert dødsfald; opdater() hver frame. */
export function lavSorteHuller(scene) {
  const gruppe = new Group();
  scene.add(gruppe);
  const aktive = [];
  return {
    start(x, y, str = 44) {
      const m = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
        map: hulTex(), transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = Z.fx - 2;
      m.position.set(x, y, 0);
      m.scale.setScalar(0.01);
      gruppe.add(m);
      aktive.push({ m, t: 0, str });
    },
    opdater(dt) {
      for (let i = aktive.length - 1; i >= 0; i--) {
        const a = aktive[i];
        a.t += dt;
        const t = a.t;
        const aaben = t < 0.3 ? 1 - Math.pow(1 - t / 0.3, 3)
          : t < 1.05 ? 1 : Math.max(0, 1 - (t - 1.05) / 0.25);
        const s = a.str * (aaben * (1 + 0.06 * Math.sin(t * 24)));
        a.m.scale.set(Math.max(0.01, s), Math.max(0.01, s), 1);
        a.m.rotation.z -= dt * (4 + aaben * 5);
        if (t >= HUL_TID) {
          gruppe.remove(a.m); a.m.geometry.dispose(); a.m.material.dispose();
          aktive.splice(i, 1);
        }
      }
    },
    fjern() { scene.remove(gruppe); },
  };
}
