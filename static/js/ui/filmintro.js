/* Kundekrigen — filmintroen: skærmen.
 *
 * En selvstændig filmsekvens før kampen (fightingspil-stil): titel, hver
 * klinik med sine ansatte, én ad gangen, og til sidst VS. Tidslinjen kommer
 * fra core/filmintro.js og følger simulationens ur (tilstanden FILM), så den
 * står ens hos værten og alle gæster; kommer man ind midt i den, starter man
 * i det rigtige slag.
 *
 * ARBEJDSDELING (se docs/filmintro.md): denne fil bygger DOM'en med faste
 * klassenavne og tænder/slukker slagene. ALT udseende — layout, farver,
 * animationer, grafik — ligger i static/filmintro.css og static/grafik/intro/,
 * som art directoren ejer. Tekster og grafik kan overstyres i
 * static/grafik/intro/intro.json uden kodeændringer.
 *
 * Pladsholdere: uden art directorens portræt tegnes kunden selv i stort
 * format fra figurarket, så filmen kan ses og times fra første dag.
 *
 * Filmklip (docs/filmintro-veo.md): har en ansat et klip i intro.json
 * ("video"), spiller det i kunde-slaget i stedet for portrættet. Det følger
 * slagets ur (også for sene netværksgæster), fryser på sidste billede, og
 * dets lyd går gennem lydmotoren som én lyd i den fælles kanal (paaKlip).
 */
'use strict';

import { FILM_KUNDER } from '../core/filmintro.js';
import { tegnFigur } from '../render/figur_view.js';
import { HOLD } from '../render/palette.js';
import { esc } from './tekst.js';

const MAPPE = '/grafik/intro/';
let data = null;                      // intro.json, når den er hentet (ellers {})
let henter = null;

/** Hent art directorens intro.json én gang. Mangler den, bruges standarderne. */
export function hentFilmData() {
  if (data) return Promise.resolve(data);
  henter ||= fetch(`${MAPPE}intro.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((d) => {
      data = d && typeof d === 'object' ? d : {};
      forbered();
      return data;
    });
  return henter;
}

/*
 * Klippene: ét video-element pr. klip, lavet, så snart intro.json er hentet,
 * og genbrugt i hver film. Det begynder at hente lidt efter, at siden er
 * åbnet (så det ikke står i vejen for spillet og musikken), og det "låses
 * op" ved første klik eller tastetryk — Safari afspiller kun lyd fra et
 * element, der er startet i en brugerhandling.
 */
const klip = new Map();               // src -> HTMLVideoElement
const ulaaste = new Set();

function klipTil(src) {
  if (klip.has(src)) return klip.get(src);
  const v = document.createElement('video');
  v.className = 'film-video';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'metadata';
  v.disablePictureInPicture = true;
  v.src = src;
  klip.set(src, v);
  ulaaste.add(v);
  return v;
}

function forbered() {
  const srcs = Object.values(data?.figurer || {}).map((f) => f?.video).filter(Boolean);
  const nye = srcs.map((f) => klipTil(MAPPE + f));
  if (!nye.length) return;
  setTimeout(() => { for (const v of nye) { v.preload = 'auto'; v.load(); } }, 2500);
  for (const t of ['pointerup', 'keydown', 'touchend']) window.addEventListener(t, laasKlipOp, { capture: true, passive: true });
}

function laasKlipOp() {
  for (const v of ulaaste) {
    if (!v.paused || v.isConnected) { ulaaste.delete(v); continue; }
    v.muted = true;
    const p = v.play();
    ulaaste.delete(v);
    // Er filmen gået i gang imens, er elementet dens — så rører vi det ikke.
    Promise.resolve(p).then(
      () => { if (!v.isConnected) { v.pause(); v.currentTime = 0; v.muted = false; } },
      () => { if (!v.isConnected) v.muted = false; ulaaste.add(v); });
  }
  if (!ulaaste.size) for (const t of ['pointerup', 'keydown', 'touchend']) window.removeEventListener(t, laasKlipOp, { capture: true });
}

function kundeInfo(figur, navn) {
  const std = FILM_KUNDER[figur] || {};
  const over = data?.figurer?.[figur] || {};
  return {
    navn: over.navn || navn,
    rolle: over.rolle ?? std.rolle ?? '',
    replik: over.replik ?? std.replik ?? '',
    portraet: over.portraet ? MAPPE + over.portraet : null,
    stemme: over.stemme || null,
    video: over.video ? MAPPE + over.video : null,
    skiltMs: Number.isFinite(over.skilt_ms) ? over.skilt_ms : null,
  };
}

/** Portrættet: art directorens billede, eller kunden tegnet fra figurarket. */
function portraet(k, holdIdx, spejl) {
  if (k.portraet) {
    return `<img class="film-portraet-billede" src="${esc(k.portraet)}" alt="" draggable="false">`;
  }
  return `<canvas class="film-portraet-plads" width="480" height="560" data-figur="${k.figur}"
            data-hold="${holdIdx}" data-spejl="${spejl ? -1 : 1}"></canvas>`;
}

function tegnPladsholdere(rod) {
  for (const c of rod.querySelectorAll('canvas.film-portraet-plads')) {
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    tegnFigur(g, +c.dataset.hold, { v: 5, figur: +c.dataset.figur }, c.width / 2, c.height - 16,
              c.height * 0.92, +c.dataset.spejl, 'idle_0');
  }
}

export function lavFilmIntro(rod) {
  let slag = [];
  let aktivt = -1;
  let vedSlag = null;
  let vedKlip = null;
  let skjulTimer = 0;
  let klipNu = null;                  // { v, s } — klippet i det aktive slag, mens det spiller
  rod.className = 'film skjult';
  rod.setAttribute('aria-hidden', 'true');

  function bygSlag(s, i) {
    const farve = s.farve && HOLD[s.farve] ? HOLD[s.farve].css : null;
    const stil = `--slag-ms:${s.til - s.fra}ms;${farve ? `--klinik-farve:${farve};` : ''}`;
    const side = s.side ? ` data-side="${s.side}"` : '';
    if (s.type === 'titel') {
      return `<section class="film-slag film-titel" data-i="${i}" style="${stil}">
        <svg class="film-logo" viewBox="0 0 64 40" fill="currentColor" aria-hidden="true"><use href="#i-logo"/></svg>
        <div class="film-titel-navn">KUNDEKRIGEN</div>
        <div class="film-titel-under">Klinikkerne er i krig</div>
      </section>`;
    }
    if (s.type === 'klinik') {
      return `<section class="film-slag film-klinik"${side} data-i="${i}" data-klinik="${esc(s.farve)}" style="${stil}">
        <div class="film-klinik-navn">${esc(s.navn)}</div>
      </section>`;
    }
    if (s.type === 'kunde') {
      const k = { ...kundeInfo(s.figur, s.navn), figur: s.figur };
      const skilt = k.skiltMs !== null ? `--skilt-ms:${k.skiltMs}ms;` : '';
      // Med klip: videoen i stedet for portrættet (elementet sættes ind efter innerHTML).
      const billede = k.video
        ? `<div class="film-klip" data-video="${esc(k.video)}"></div>`
        : `<div class="film-portraet">${portraet(k, s.holdIdx, s.side === 'hoejre')}</div>`;
      return `<section class="film-slag film-kunde"${side} data-i="${i}" data-figur="${s.figur}"
                  data-klinik="${esc(s.farve)}"${k.video ? ' data-video' : ''} style="${stil}${skilt}">
        ${billede}
        <div class="film-skilt">
          <div class="film-navn">${esc(k.navn)}</div>
          <div class="film-rolle">${esc(k.rolle)}</div>
          <p class="film-replik">${esc(k.replik)}</p>
        </div>
      </section>`;
    }
    if (s.type === 'vs') {
      const raekke = (r) => `
        <div class="film-vs-hold" data-side="${r.holdIdx % 2 ? 'hoejre' : 'venstre'}" data-klinik="${esc(r.farve)}"
             style="--klinik-farve:${HOLD[r.farve]?.css || '#fff'}">
          <div class="film-vs-klinik">${esc(r.navn)}</div>
          <div class="film-vs-kunder">${r.kunder.map((k) => {
            const info = { ...kundeInfo(k.figur, k.navn), figur: k.figur };
            return `<div class="film-vs-kunde" data-figur="${k.figur}">
              <div class="film-portraet">${portraet(info, r.holdIdx, r.holdIdx % 2 === 1)}</div>
              <div class="film-vs-navn">${esc(info.navn)}</div></div>`;
          }).join('')}</div>
        </div>`;
      const rk = s.raekker;
      return `<section class="film-slag film-vs" data-i="${i}" data-antal="${rk.length}" style="${stil}">
        ${rk.map((r, j) => (j ? '<div class="film-vs-tegn">VS</div>' : '') + raekke(r)).join('')}
      </section>`;
    }
    return `<section class="film-slag film-slut" data-i="${i}" style="${stil}"></section>`;
  }

  /** Stop klippet, der spiller (og giv lydkanalen fri). */
  function stopKlip() {
    if (!klipNu) return;
    klipNu.v.pause();
    klipNu = null;
    vedKlip?.('slut');
  }

  /** Klippet i slaget følger filmens ur; efter sidste billede står det frosset. */
  function styrKlip(ms) {
    const s = slag[aktivt];
    const v = s && rod.querySelector(`.film-slag[data-i="${aktivt}"] video.film-video`);
    if (!v) { stopKlip(); return; }
    if (klipNu && klipNu.v !== v) stopKlip();
    const t = (ms - s.fra) / 1000;
    const laengde = Number.isFinite(v.duration) ? v.duration : Infinity;
    if (t >= laengde - 0.05) {                     // frys på sidste billede
      if (!v.ended && v.readyState >= 1 && v.currentTime < laengde - 0.1) v.currentTime = Math.max(0, laengde - 0.04);
      stopKlip();
      return;
    }
    if (v.readyState >= 1 && Math.abs(v.currentTime - t) > 0.3) v.currentTime = Math.max(0, t);
    if (!klipNu) {
      klipNu = { v, s };
      vedKlip?.('start', v, Math.max(0, (s.til - ms) / 1000));
      const p = v.play();
      // Nægter browseren lyd, spiller klippet stumt i stedet for slet ikke.
      Promise.resolve(p).catch(() => { if (klipNu?.v === v) { v.muted = true; v.play().catch(() => {}); } });
    }
  }

  return {
    get aktiv() { return slag.length > 0 && !rod.classList.contains('skjult'); },

    /** Start filmen med en tidslinje fra filmTidslinje. paaKlip(hvad, video, sek)
     *  melder, når et klip starter ('start') og slutter ('slut'). */
    start(tidslinje, { paaSlag, paaKlip } = {}) {
      clearTimeout(skjulTimer);
      stopKlip();
      slag = tidslinje;
      aktivt = -1;
      vedSlag = paaSlag || null;
      vedKlip = paaKlip || null;
      rod.innerHTML = `
        <div class="film-baggrund"></div>
        ${slag.map(bygSlag).join('')}
        <div class="film-spring">Mellemrum · Enter · klik: spring over</div>
        <div class="film-venter">Venter på de andre …</div>`;
      for (const plads of rod.querySelectorAll('.film-klip[data-video]')) {
        const v = klipTil(plads.dataset.video);
        v.pause();
        v.muted = false;
        v.preload = 'auto';
        if (v.readyState >= 1) v.currentTime = 0;
        plads.appendChild(v);
      }
      tegnPladsholdere(rod);
      rod.classList.remove('skjult', 'venter', 'faerdig');
      rod.setAttribute('aria-hidden', 'false');
    },

    /** ms er filmens tid (fra simulationens ur). Tænder det rigtige slag.
     *  Går aldrig baglæns: et slag, der er vist, kommer ikke igen. */
    opdater(ms) {
      if (!slag.length || rod.classList.contains('venter')) return;
      let i = slag.findIndex((s) => ms >= s.fra && ms < s.til);
      if (i < 0) i = ms >= slag[slag.length - 1].til ? slag.length : 0;
      if (i <= aktivt) { styrKlip(ms); return; }
      aktivt = i;
      rod.dataset.slag = slag[i]?.type || 'slut';
      rod.querySelectorAll('.film-slag').forEach((el) => {
        const j = +el.dataset.i;
        el.classList.toggle('aktiv', j === i);
        el.classList.toggle('forbi', j < i);
        // Kommer man ind midt i et slag, springer animationen frem til dér.
        if (j === i) el.style.setProperty('--forsinkelse', `${-Math.max(0, ms - slag[i].fra)}ms`);
      });
      if (slag[i]) vedSlag?.(slag[i], kundeInfo(slag[i].figur, slag[i].navn));
      styrKlip(ms);
    },

    /** Spilleren sprang over: skjul filmen (over nettet står "venter" tilbage). */
    spring(venter) {
      stopKlip();
      if (venter) rod.classList.add('venter');
      else this.stop();
    },

    stop() {
      stopKlip();
      if (rod.classList.contains('skjult')) return;
      rod.classList.add('faerdig');
      rod.setAttribute('aria-hidden', 'true');
      clearTimeout(skjulTimer);
      skjulTimer = setTimeout(() => { rod.classList.add('skjult'); rod.innerHTML = ''; }, 420);
      slag = [];
      aktivt = -1;
    },
  };
}
