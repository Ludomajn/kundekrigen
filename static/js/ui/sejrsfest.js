/* Kundekrigen — vinderfesten.
 *
 * Når kampen er afgjort, må resultattavlen ikke bare klaske ned over banen.
 * Først fejres vinderen: fyrværkeri og konfetti i klinikkens farve, en stor
 * titel, og de overlevende kunder jubler (det sidste styres fra main.js via
 * figurvisningen). Så kommer tavlen — og konfettien bliver ved med at dale
 * lidt endnu bag den.
 *
 * Et fuldskærms-2D-lærred over three-lærredet og under menuen. Det kender
 * ikke spillet, kun farver og tekst, og fjerner sig selv, når det er tomt.
 */
'use strict';

import { esc } from './tekst.js';

const GUL = '#FFD86F', HVID = '#FFFFFF';

export function lavSejrsfest() {
  let laerred = null, g = null, titel = null;
  let partikler = [];
  let koerer = false, start = 0, sidst = 0;
  let farver = [GUL];
  let konfettiTil = 0, fyrvaerkeriTil = 0, naesteRaket = 0, minTid = 0;
  let raf = 0;

  function montér() {
    laerred = document.createElement('canvas');
    laerred.className = 'sejrsfest';
    titel = document.createElement('div');
    titel.className = 'sejrsfest-titel';
    document.body.append(laerred, titel);
    g = laerred.getContext('2d');
    tilpas();
    window.addEventListener('resize', tilpas);
  }

  function tilpas() {
    if (!laerred) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    laerred.width = window.innerWidth * d;
    laerred.height = window.innerHeight * d;
    g.setTransform(d, 0, 0, d, 0, 0);
  }

  const tilf = (a, b) => a + Math.random() * (b - a);
  const valg = (liste) => liste[(Math.random() * liste.length) | 0];

  function konfetti(n) {
    const B = window.innerWidth;
    for (let i = 0; i < n; i++) {
      partikler.push({
        art: 'k', x: tilf(0, B), y: tilf(-60, -10),
        vx: tilf(-30, 30), vy: tilf(60, 140),
        b: tilf(6, 11), h: tilf(3, 6), rot: tilf(0, 6.28), vrot: tilf(-6, 6),
        flag: tilf(0, 6.28), farve: valg([...farver, ...farver, GUL, HVID]),
        liv: 9,
      });
    }
  }

  function raket() {
    const B = window.innerWidth, H = window.innerHeight;
    partikler.push({
      art: 'r', x: tilf(B * 0.15, B * 0.85), y: H + 10,
      vx: tilf(-40, 40), vy: -tilf(H * 0.9, H * 1.25),
      farve: valg([...farver, GUL]), liv: tilf(0.75, 1.05),
    });
  }

  function brag(x, y, farve) {
    const n = 46;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + tilf(-0.08, 0.08);
      const v = tilf(140, 260);
      partikler.push({
        art: 'g', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        farve: Math.random() < 0.25 ? HVID : farve, liv: tilf(0.9, 1.4), fuld: 1.4,
      });
    }
  }

  function skridt(nu) {
    raf = requestAnimationFrame(skridt);
    const dt = Math.min(0.05, (nu - sidst) / 1000 || 0.016);
    sidst = nu;
    const t = (nu - start) / 1000;

    if (t < konfettiTil) konfetti(t < 1.2 ? 6 : 2);
    if (t < fyrvaerkeriTil && t >= naesteRaket) {
      raket();
      naesteRaket = t + tilf(0.35, 0.7);
    }

    const B = window.innerWidth, H = window.innerHeight;
    g.clearRect(0, 0, B, H);

    const ny = [];
    for (const p of partikler) {
      p.liv -= dt;
      if (p.art === 'k') {
        p.flag += dt * 5;
        p.x += (p.vx + Math.sin(p.flag) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.y > H + 20 || p.liv <= 0) continue;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(1, Math.abs(Math.cos(p.flag)) * 0.8 + 0.2);   // vender i luften
        g.fillStyle = p.farve;
        g.fillRect(-p.b / 2, -p.h / 2, p.b, p.h);
        g.restore();
      } else if (p.art === 'r') {
        p.vy += 520 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.liv <= 0 || p.vy > -60) { brag(p.x, p.y, p.farve); continue; }
        g.fillStyle = GUL;
        g.beginPath(); g.arc(p.x, p.y, 2.6, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,216,111,.35)';
        g.beginPath(); g.arc(p.x - p.vx * 0.03, p.y - p.vy * 0.03, 2, 0, Math.PI * 2); g.fill();
      } else {
        p.vx *= 1 - dt * 1.6; p.vy *= 1 - dt * 1.6;
        p.vy += 90 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.liv <= 0) continue;
        g.globalAlpha = Math.min(1, p.liv / p.fuld * 1.6);
        g.fillStyle = p.farve;
        g.beginPath(); g.arc(p.x, p.y, 2.4, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      ny.push(p);
    }
    partikler = ny;

    // Færdig: intet i luften og intet på vej.
    if (!partikler.length && t > konfettiTil && t > fyrvaerkeriTil && t > minTid) stop();
  }

  function stop() {
    koerer = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', tilpas);
    laerred?.remove(); titel?.remove();
    laerred = null; titel = null; g = null;
    partikler = [];
  }

  return {
    /**
     * Start festen. farverCss: klinikkens farve(r). overskrift/undertekst
     * vises som stor titel; uafgjort giver en afdæmpet udgave uden raketter.
     */
    start({ farverCss = [GUL], overskrift = '', undertekst = '', uafgjort = false, mig = false } = {}) {
      if (koerer) stop();
      montér();
      koerer = true;
      farver = farverCss.length ? farverCss : [GUL];
      partikler = [];
      start = sidst = performance.now();
      konfettiTil = uafgjort ? 0 : 9;
      fyrvaerkeriTil = uafgjort ? 0 : 5.5;
      naesteRaket = 0.2;
      minTid = uafgjort ? 3 : 0;
      titel.innerHTML = `<div class="st-top">${esc(overskrift)}</div>` +
        (undertekst ? `<div class="st-under">${esc(undertekst)}</div>` : '');
      titel.style.setProperty('--sf', farver[0]);
      titel.classList.toggle('uafgjort', uafgjort);
      titel.classList.toggle('mig', mig);
      raf = requestAnimationFrame(skridt);
    },

    /** Titlen væk (tavlen overtager), konfettien må gerne dale færdig. */
    skjulTitel() { titel?.classList.add('ud'); },

    stop() { if (koerer || laerred) stop(); },
    get koerer() { return koerer; },
  };
}
