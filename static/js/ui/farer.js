/* Kundekrigen — farerne i brugerfladen (sim/farer.js; grænsefladen i
 * docs/farer.md, designet i docs/udkast/farer_design.md §8-9).
 *
 * Varslet (3 s, før faren kommer): et banner og en pulserende pil med farens
 * ikon — over stedet, hvis det er i billedet, ellers i skærmkanten i den
 * retning. Når faren er her: et navneskilt i 5 s, og pilen i kanten, mens
 * den er uden for billedet. Første gang pr. profil og slags: "SKYD MIG!".
 * Tegneserieordene: KORTSLUTNING!, OVEROPHEDET!, LEVERET!, PSST, KÆDE ×n! og
 * SYGT PLAY! (én gang pr. kæde, når den har skadet 2 fjender eller dræbt én).
 *
 * Lyden går gennem den fælles kanal (ui/lyd.js), og kun SYGT PLAY er vigtig
 * (varslet er det ikke, D9). En lyd, der kommer, mens kanalen er optaget —
 * KORTSLUTNING lige efter braget, der tændte den, LEVERET! lige efter
 * scannerens BIP — venter kort på, at kanalen bliver fri, og falder bort
 * efter en frist: aldrig oven i noget andet, og aldrig for sent. Ildens
 * knitren er en løkke, der tier, når noget andet lyder: kanalens lyde,
 * flyvelyden og boret.
 *
 * Kameraet (§9): i SPILLER_AKTIV og TUR_START intet — kun pil, banner og lyd.
 * I OPLOESNING, når intet skud flyver, rammes antændelsen og kædebraget ind
 * sammen med den aktive kunde et øjeblik (rammeInd), højst hvert 2. s. Holder
 * kameraet over nedslaget, venter glimtet, til holdet er slut.
 * Rystelsen ved kædebrag under sigtet står i main.js' eksplosion-lytter.
 * Pilen og skiltet hører til kampen: under sejren og i menuen er de væk.
 * Pilen går uden om HUD'ens faste felter (hindringer: holdlisten, arsenalets
 * håndtag og vejledningens kort), som ligger over den.
 *
 * To trin pr. frame: opdater(v, false) regner pilen og skiltet (læser kun
 * layout) før HUD'en, og skriv() sætter dem i DOM'en efter HUD'en. Så kommer
 * ingen læsning efter en skrivning i samme frame (en tvungen, synkron layout;
 * hud.js læser selv først). opdater(v) gør begge dele.
 *
 * Farerne slås op på id hver frame; spejlets objekter holdes aldrig (et
 * snapshot udskifter dem). Ren præsentation: skriver aldrig i simulationen.
 */
'use strict';

import { VAABEN } from '../sim/weapons.js';
import { T as TIL } from '../sim/turn.js';
import { SPEAKER_SENERE } from './stemmer.js';

/** Bannerets tekst ved varslet (ret: rulle- eller flyveretningen). */
const VARSEL = {
  kabelsalat: (ret) => `KABELSALAT ${ret < 0 ? '←' : '→'} · Skyd den, så går den i brand`,
  nullermand: () => 'NULLERMAND! En støvtot drysser ned fra loftet · meget brændbar',
  pakkedrone: (ret) => `PAKKEDRONE ${ret < 0 ? '←' : '→'} · Skyd pakken ned, eller scan den, så er den din`,
  robotstoevsuger: () => 'ROBOTSTØVSUGEREN ER VÅGNET · Den æder mails, og batteriet tåler ikke skud',
};
/** Navneskiltet i 5 s, når faren er kommet. */
const SKILT = {
  kabelsalat: 'Kabelsalaten', nullermand: 'Nullermanden', pakkedrone: 'Pakkedronen',
  robotstoevsuger: 'Rune · robotstøvsuger',
};
/** Kantpilens ikon (index.html: art directorens symboler). */
const IKON = { kabelsalat: 'i-kabelsalat', drone: 'i-drone', stoevsuger: 'i-stoevsuger' };
/** Tegningens højde i wu (render/fare_view.js FARE_BREDDE og modellens udstrækning). */
const HOEJDE = { kabelsalat: 30, nullermand: 33, pakkedrone: 42, robotstoevsuger: 11 };

const SKILT_MS = 5000;
const PIL_FULD_MS = 6000;               // så længe efter ankomsten står pilen i kanten fuldt
const GLIMT_S = 1.2, GLIMT_HVERT_MS = 2000;
/* Så længe (ms) venter et glimt på, at kameraet slipper nedslaget: holdet
 * (main.js NEDSLAG_HOLD_MS, 1,5 s) og lidt luft. Ældre hører ikke til braget. */
const GLIMT_VENT_MS = 1600;
const ILD_HOERES = 900;                 // wu: så langt væk høres ilden
const SUS_FART = 40;                    // wu/s: så hurtigt skal et skud flyve for at suse (lyd.js flyvelyd)
/* Så længe (ms) venter ilden, efter suset eller boret er slukket: boret stopper
 * 0,15 s efter (lyd.loop), og suset er på 0,2 s (4 tidskonstanter) nede på 2 %. */
const LOEBENDE_UD_MS = 200;
const SJAELDEN_MS = 20000;              // samme regel som komisk() i main.js
/* Så længe (ms) venter en lyd på en fri kanal. Brugerens brag er 1-2,4 s: efter
 * et kort brag når KORTSLUTNING at lyde, før flammebraget (2 s efter
 * antændelsen); efter et langt falder den bort. Alarmen: batteriet efter 1,5 s. */
const FRIST = { varsel: 800, kortslutning: 1300, alarm: 900, leveret: 1000, nom: 500, opdatering: 800, plask: 600 };
const KANT_PX = 44;                     // pilens luft til skærmkanten
const OVER_STED_PX = 54;                // pilen over et sted i billedet

export function kobFarer({ bus, hud, lyd, visning, S, r, rod, hindringer = [] }) {
  const v = () => S.verden;
  const fx = visning.fx;
  const vis = () => visning.farer;
  const figur = (id) => v()?.baevere.find((x) => x.id === id) || null;
  const har = typeof document !== 'undefined';
  // Speakerens "Sygt play!" hentes, når brugeren har optaget den (må mangle).
  lyd.hentLyde?.(Object.values(SPEAKER_SENERE), { valgfri: true });

  // ---- DOM: eget lag i HUD'en, med pilen og skiltet (genbruges)
  let lag = null, pil = null, pilIkon = null, spids = null, skilt = null;
  if (har && rod) {
    lag = document.createElement('div');
    lag.className = 'fare-lag';
    lag.innerHTML = `<div class="fare-pil hide"><svg class="fp-spids" viewBox="0 0 64 40" aria-hidden="true"><use href="#i-arrow"/></svg>
        <span class="fp-rund"><svg class="fp-ikon" viewBox="0 0 64 40" aria-hidden="true"><use href="#i-kabelsalat"/></svg></span></div>
      <div class="fare-skilt hide"></div>`;
    rod.appendChild(lag);
    pil = lag.querySelector('.fare-pil');
    pilIkon = lag.querySelector('.fp-ikon use');
    spids = lag.querySelector('.fp-spids');
    skilt = lag.querySelector('.fare-skilt');
  }
  const cache = { pil: false, x: NaN, y: NaN, vinkel: NaN, ikon: '', klasse: '', skilt: false, sx: NaN, sy: NaN, tekst: '' };

  // ---- lyd: kort venten på en fri kanal
  let vent = null;                      // { navn, opt, til, fri }
  function spilSnart(navn, opt, fristMs) {
    if (lyd.afspil(navn, opt)) { vent = null; return true; }
    vent = { navn, opt, til: performance.now() + fristMs, fri: 0 };
    return false;
  }
  function venteLyd() {
    if (!vent) return;
    const nu = performance.now();
    if (nu > vent.til) { vent = null; return; }
    if (!lyd.kanalFri()) { vent.fri = 0; return; }
    // De vigtige lyde i køen går først: de tager kanalen 60 ms efter, den er fri.
    if (!vent.fri) vent.fri = nu;
    else if (nu - vent.fri > 120) { const n = vent; vent = null; lyd.afspil(n.navn, n.opt); }
  }
  /** Stereo efter kameraet, som main.js' rumlig. */
  function pan(x) {
    const k = r.kamera.position;
    const halv = Math.max(200, (r.kamera.right - r.kamera.left) / 2);
    return Math.max(-0.8, Math.min(0.8, (x - k.x) / halv));
  }
  const sjaeldne = new Map();
  /** Gentagne lyde (NOM): hver anden gang, eller med det samme efter lang stilhed. */
  function sjaelden(gruppe) {
    const nu = performance.now();
    const k = sjaeldne.get(gruppe) || { n: 0, sidst: -Infinity };
    sjaeldne.set(gruppe, k);
    k.n++;
    if (k.n < 2 && nu - k.sidst < SJAELDEN_MS) return false;
    k.n = 0; k.sidst = nu;
    return true;
  }

  // ---- kameraet: et kort glimt i opløsningen
  let sidsteGlimt = -Infinity;
  const glimtVent = { x: 0, y: 0, t: 0, aktiv: false };
  function glimt(x, y) {
    if (v()?.tur.tilstand !== TIL.OPLOESNING || S.skudId != null) return;
    const nu = performance.now();
    // Efter nedslaget holder kameraet over krateret og skjuler glimtet. Kom det
    // nu, var kun dets sidste rest tilbage, når holdet slap: kameraet trak sig
    // ud og ind igen på vejen hjem til kunden. Så det venter på holdet (det
    // nyeste brag vinder) og kommer helt, når kameraet er frit.
    if (visning.kamera.foelgerSkud) {
      glimtVent.x = x; glimtVent.y = y; glimtVent.t = nu; glimtVent.aktiv = true;
      return;
    }
    if (nu - sidsteGlimt < GLIMT_HVERT_MS) return;
    sidsteGlimt = nu;
    visning.kamera.rammeInd(x, y, GLIMT_S);
  }
  /** Hver frame: det ventende glimt, når holdet er slut — hvis det er nyt nok. */
  function ventendeGlimt() {
    if (!glimtVent.aktiv) return;
    if (S.skudId != null) { glimtVent.aktiv = false; return; }       // et nyt skud går forud
    if (visning.kamera.foelgerSkud) return;
    glimtVent.aktiv = false;
    if (performance.now() - glimtVent.t < GLIMT_VENT_MS) glimt(glimtVent.x, glimtVent.y);
  }

  // ---- SYGT PLAY: én gang pr. kæde (kaedeId)
  const kaeder = new Map();
  function kaede(e) {
    if (e.kaedeId == null || e.kildeHold == null) return null;
    let k = kaeder.get(e.kaedeId);
    if (!k) {
      k = { hold: e.kildeHold, baever: e.kildeBaever, skadet: new Map(), draebt: false, fare: false, dybde: 0, vist: false };
      kaeder.set(e.kaedeId, k);
    }
    return k;
  }
  /* Reglen fra designet, plus: en fare eller ild skal være med i kæden, eller
   * kæden skal være mindst 2 led dyb. Ellers var hvert printerskud, der ramte
   * to, et "sygt play" (docs/farer.md, del 1's åbne punkt 6). */
  function tjekSygt(k, x, y) {
    if (k.vist || !(k.fare || k.dybde >= 2) || !(k.skadet.size >= 2 || k.draebt)) return;
    k.vist = true;
    const navn = figur(k.baever)?.navn;
    hud.banner(navn ? `SYGT PLAY! ${navn}` : 'SYGT PLAY!', 2600, 'sygt');
    fx.pop('SYGT PLAY!', x, y + 90, { farve: 'gul', str: 58, varighed: 1.7, vy: 20 });
    // Speakerens replik, når brugeren har optaget den; ellers slaget fra introen.
    const replik = SPEAKER_SENERE.sygt_play;
    if (lyd.har?.(replik)) lyd.stemme(replik, { vigtig: true });
    else lyd.afspil('intro_slam', { vigtig: true });
  }
  const turNr = () => v()?.tur.turNr ?? 0;
  const fjendeAf = (k, b) => b && b.hold !== k.hold;

  // ---- tilstand til pilen og skiltet
  let skiltId = null, skiltTil = 0, ankomst = 0;
  const sete = new Set();               // "SKYD MIG!" er slået op i profilen for disse
  const lager = {
    hent(n) { try { return localStorage.getItem(n); } catch { return null; } },   // privat vindue
    gem(n, x) { try { localStorage.setItem(n, x); } catch { /* ignoreres */ } },
  };

  // ---- hændelserne
  bus.paa('fareVarsel', (e) => {
    hud.banner((VARSEL[e.hud] || VARSEL.kabelsalat)(e.ret), 2800, 'advarsel');
    // Nullermanden har sin egen lyd (en støvtot, ikke kabler).
    const gruppe = e.hud === 'nullermand' ? 'fare_nullermand' : `fare_${e.slags}`;
    spilSnart(gruppe, { maksSek: 1.5, vol: 1, pan: pan(e.x) }, FRIST.varsel);
  });

  bus.paa('fareKommer', (e) => {
    skiltId = e.id; skiltTil = performance.now() + SKILT_MS; ankomst = performance.now();
    sete.delete(e.hud);
  });

  bus.paa('fareAntaendt', (e) => {
    vis()?.haendelse('fareAntaendt', e);
    const k = kaede(e);
    if (k) { k.fare = true; k.dybde = Math.max(k.dybde, e.kaede | 0); }
    const h = HOEJDE[e.hud] ?? 30;
    if (e.nedskudt) {
      fx.pop(e.konfetti ? 'KONFETTI!' : 'NEDSKUDT!', e.x, e.y + h + 24, { farve: e.konfetti ? 'gul' : 'roed', str: 28 });
    } else if (e.slags === 'stoevsuger') {
      fx.pop('OVEROPHEDET!', e.x, e.y + h + 26, { farve: 'roed', str: 26 });
      spilSnart('stoevsuger_alarm', { vol: 1, pan: pan(e.x) }, FRIST.alarm);
    } else {
      fx.pop('KORTSLUTNING!', e.x, e.y + h + 22, { farve: 'cyan', str: 30 });
      spilSnart('kortslutning', { vol: 1, pan: pan(e.x) }, FRIST.kortslutning);
    }
    glimt(e.x, e.y + h / 2);
  });

  bus.paa('fareLeveret', (e) => {
    vis()?.haendelse('fareLeveret', e);
    fx.pop('LEVERET!', e.x, e.y + 56, { farve: 'groen', str: 34 });
    const b = figur(e.baever);
    hud.banner(`LEVERET! ${b ? `${b.navn}: ` : ''}+${e.antal ?? 1} ${VAABEN[e.vaaben]?.navn || 'våben'}`, 2000);
    // Normal kanal, som kasseSamlet i main.js (D9): kommer lige efter scannerens BIP.
    spilSnart('vaaben_samlet', { vol: 1, pan: pan(e.x) }, FRIST.leveret);
  });

  bus.paa('fareSpiste', (e) => {
    vis()?.haendelse('fareSpiste', e);          // NOM-boblen er i tegningen
    if (sjaelden('nom')) spilSnart('nom', { vol: 1, pan: pan(e.x) }, FRIST.nom);
  });

  bus.paa('fareOpdateres', (e) => {
    fx.pop('GENSTART!', e.x, e.y + 34, { farve: 'blaa', str: 28 });
    spilSnart('opdatering_ramt', { vol: 1.8, pan: pan(e.x) }, FRIST.opdatering);
  });

  bus.paa('fareVaek', (e) => {
    vis()?.haendelse('fareVaek', e);
    if (e.id === skiltId) skiltTil = 0;
    const vand = v()?.vandNiveau ?? -Infinity;
    const iVandet = e.y <= vand + 24;
    if (e.grund === 'slukket') {
      fx.pop('PSST', e.x, e.y + 34, { farve: 'hvid', str: 26 });
      if (iVandet) spilSnart('plask', { vol: 0.8, pan: pan(e.x) }, FRIST.plask);
    } else if (e.grund === 'kortsluttet') {
      fx.pop('BZZT!', e.x, e.y + 28, { farve: 'cyan', str: 26 });
      spilSnart('plask', { vol: 0.9, pan: pan(e.x) }, FRIST.plask);
    } else if (e.grund === 'vand') {
      fx.plask(e.x, Math.max(e.y, vand));
      spilSnart('plask', { vol: 1, pan: pan(e.x) }, FRIST.plask);
    }
  });

  bus.paa('ildTaendt', (e) => {
    vis()?.haendelse('ildTaendt', e);
    const k = kaede(e);
    if (k) k.fare = true;
  });

  bus.paa('eksplosion', (e) => {
    const k = kaede(e);
    if (k) { if (e.fare) k.fare = true; k.dybde = Math.max(k.dybde, e.kaede | 0); }
    // KÆDE ×n!: hvert brag, der er mindst 2 led inde i en kæde.
    if (e.kaede >= 2) {
      fx.pop(`KÆDE ×${e.kaede}!`, e.x, e.y + e.radius + 40,
             { farve: 'gul', str: 30 + 4 * Math.min(5, e.kaede), varighed: 1.2 });
    }
    if (e.kaede >= 1) glimt(e.x, e.y);
  });

  bus.paa('skade', (e) => {
    if (e.aarsag === 'ild') vis()?.blus(e.x, e.y);
    if (!(e.kaede >= 1)) return;
    const k = kaede(e);
    const b = figur(e.baever);
    if (!k || !fjendeAf(k, b)) return;
    if (e.aarsag === 'ild') k.fare = true;
    k.dybde = Math.max(k.dybde, e.kaede | 0);
    k.skadet.set(e.baever, turNr());
    if (e.drab) k.draebt = true;
    tjekSygt(k, b.x, b.y);
  });

  // Drukning og fald ud giver aldrig 'skade': de tæller som drab, når kæden
  // skadede kunden i samme tur.
  const drab = (e) => {
    const b = figur(e.baever);
    for (const [, k] of kaeder) {
      if (k.vist || k.skadet.get(e.baever) !== turNr() || !fjendeAf(k, b)) continue;
      k.draebt = true;
      tjekSygt(k, e.x ?? b.x, e.y ?? b.y);
    }
  };
  bus.paa('drukner', drab);
  bus.paa('doedsfald', drab);

  // ---- hver frame: pilen, skiltet, ventende lyd og ildens knitren
  function saetPil(paa, x, y, vinkel, ikon, klasse) {
    if (!pil) return;
    if (paa !== cache.pil) { cache.pil = paa; pil.classList.toggle('hide', !paa); }
    if (!paa) return;
    const px = Math.round(x), py = Math.round(y), grad = Math.round(vinkel * 180 / Math.PI / 2) * 2;
    if (px !== cache.x || py !== cache.y) {
      cache.x = px; cache.y = py;
      pil.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`;
    }
    if (grad !== cache.vinkel) {
      cache.vinkel = grad;
      spids.style.transform = `rotate(${grad}deg) translateX(var(--fp-afstand))`;
    }
    if (ikon !== cache.ikon) { cache.ikon = ikon; pilIkon.setAttribute('href', `#${ikon}`); }
    if (klasse !== cache.klasse) { cache.klasse = klasse; pil.className = `fare-pil ${klasse}`; }
  }

  function saetSkilt(paa, x, y, tekst) {
    if (!skilt) return;
    if (paa !== cache.skilt) { cache.skilt = paa; skilt.classList.toggle('hide', !paa); }
    if (!paa) return;
    if (tekst !== cache.tekst) { cache.tekst = tekst; skilt.textContent = tekst; }
    const px = Math.round(x), py = Math.round(y);
    if (px !== cache.sx || py !== cache.sy) {
      cache.sx = px; cache.sy = py;
      skilt.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
    }
  }

  /** Skærmens frie felt: under uret og over våbenbjælken (px). HUD'en skriver
   *  --ui og --bund-h direkte på roden, så de læses uden at regne stil om. */
  const F = { x0: 0, x1: 0, y0: 0, y1: 0, ui: 1 };
  function felt() {
    const W = window.innerWidth, H = window.innerHeight;
    const st = document.documentElement.style;
    const ui = parseFloat(st.getPropertyValue('--ui')) || 1;
    const bund = (parseFloat(st.getPropertyValue('--bund-h')) || 188) * ui + 20;
    F.x0 = KANT_PX; F.x1 = W - KANT_PX; F.y0 = 104 * ui; F.y1 = Math.max(104 * ui + 40, H - bund);
    F.ui = ui;
    return F;
  }

  /* HUD'ens faste felter, der ligger over pilen (hindringer: holdlisten i
   * højre side, arsenalets håndtag i venstre og vejledningens kort nederst),
   * udvidet med pilens luft. Skjulte (.hide, .skjult) og tomme tæller ikke.
   * Læses i regnetrinnet, før noget er skrevet i framen. */
  const B = hindringer.map(() => ({ x0: 0, y0: 0, x1: 0, y1: 0 }));
  let nB = 0;
  function hindringsFelter() {
    nB = 0;
    const m = KANT_PX * F.ui;
    for (const el of hindringer) {
      if (!el?.getBoundingClientRect || el.classList?.contains('hide') || el.classList?.contains('skjult')) continue;
      const q = el.getBoundingClientRect();
      if (!(q.width > 0 && q.height > 0)) continue;
      const b = B[nB++];
      b.x0 = q.left - m; b.y0 = q.top - m; b.x1 = q.right + m; b.y1 = q.bottom + m;
    }
  }
  const iFelt = (b, x, y) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
  /** Frit: i feltet og uden for alle hindringer. */
  function fri(x, y) {
    if (x < F.x0 || x > F.x1 || y < F.y0 || y > F.y1) return false;
    for (let i = 0; i < nB; i++) if (iFelt(B[i], x, y)) return false;
    return true;
  }
  /** Hvor strålen c + d·t går ind i hindringen b (t > 0), eller Infinity. */
  function ind(b, cx, cy, dx, dy) {
    let t0 = 0, t1 = Infinity;
    if (dx) {
      let a = (b.x0 - cx) / dx, c = (b.x1 - cx) / dx;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    } else if (cx <= b.x0 || cx >= b.x1) return Infinity;
    if (dy) {
      let a = (b.y0 - cy) / dy, c = (b.y1 - cy) / dy;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    } else if (cy <= b.y0 || cy >= b.y1) return Infinity;
    return t0 <= t1 && t0 > 0 ? t0 : Infinity;
  }
  /** Pilens sted (t i (0, 1]) på strålen c + d·t: ved feltets kant — og står
   *  den dér under et HUD-felt, trukket ind langs strålen til feltets rand.
   *  Et felt, midten selv står i (en meget lille skærm), springes over. */
  function straaleT(cx, cy, dx, dy) {
    const tx = dx ? ((dx > 0 ? F.x1 : F.x0) - cx) / dx : Infinity;
    const ty = dy ? ((dy > 0 ? F.y1 : F.y0) - cy) / dy : Infinity;
    let t = Math.min(tx, ty, 1);
    for (let n = 0; n < nB; n++) {                 // hvert felt højst én gang
      let flyttet = false;
      for (let i = 0; i < nB; i++) {
        const b = B[i];
        if (iFelt(b, cx, cy) || !iFelt(b, cx + dx * t, cy + dy * t)) continue;
        const t0 = ind(b, cx, cy, dx, dy);
        if (t0 < t) { t = t0; flyttet = true; }
      }
      if (!flyttet) break;
    }
    return t;
  }

  /* Det, skriv() sætter: regnes i opdater (kun læsninger). */
  const maal = { pil: false, x: 0, y: 0, vinkel: 0, ikon: '', klasse: '', skilt: false, sx: 0, sy: 0, tekst: '' };
  const ingenPil = () => { maal.pil = false; maal.skilt = false; };

  function regnPil(verden) {
    const vs = verden.farePlan?.varsel;
    let f = null;
    // Den fare, der tegnes (en, der er ved at dø, har ingen pil).
    for (const q of verden.farer || []) if (!vis() || vis().vist(q.id)) { f = q; break; }
    if (!vs && !f) { ingenPil(); return; }
    const nu = performance.now();
    felt();
    hindringsFelter();
    const hudNavn = vs ? vs.hud : f.hud;
    const slags = vs ? vs.slags : f.slags;
    const h = HOEJDE[hudNavn] ?? 30;
    const p = !vs ? vis()?.vist(f.id) || f : null;
    const wx = vs ? vs.x : p.x, wy = vs ? vs.y + h / 2 : p.y + h / 2;
    const s = r.tilSkaerm(wx, wy);
    // I billedet: i det frie felt — og ikke gemt under HUD'en.
    let iBilledet = fri(s.x, s.y);
    const overY = Math.max(F.y0, s.y - OVER_STED_PX - h);
    if (iBilledet && vs && !fri(s.x, overY)) iBilledet = false;
    const ikon = IKON[slags] || IKON.kabelsalat;
    maal.ikon = ikon;

    if (iBilledet) {
      // Varslet i billedet: pilen står over stedet og peger ned.
      maal.pil = !!vs;
      if (vs) { maal.x = s.x; maal.y = overY; maal.vinkel = Math.PI / 2; maal.klasse = 'varsel'; }
    } else {
      // Uden for billedet: i kanten, på linjen fra midten ud mod stedet (og
      // før en hindring, strålen går ind i).
      const cx = (F.x0 + F.x1) / 2, cy = (F.y0 + F.y1) / 2;
      const dx = s.x - cx, dy = s.y - cy;
      const t = straaleT(cx, cy, dx, dy);
      const brand = f && (f.brand > 0 || f.styrt > 0);
      maal.pil = true;
      maal.x = cx + dx * t; maal.y = cy + dy * t; maal.vinkel = Math.atan2(dy, dx);
      maal.klasse = vs ? 'varsel' : brand || nu - ankomst < PIL_FULD_MS ? '' : 'stille';
    }

    // Navneskiltet de første 5 s, og "SKYD MIG!" første gang faren ses.
    maal.skilt = false;
    if (f && iBilledet) {
      const top = r.tilSkaerm(p.x, p.y + h + 8);
      maal.skilt = f.id === skiltId && nu < skiltTil;
      maal.sx = top.x; maal.sy = top.y; maal.tekst = SKILT[f.hud] || SKILT.kabelsalat;
      if (!sete.has(f.hud)) {
        sete.add(f.hud);
        const noegle = `kk_fare_set_${f.hud}`;
        if (lager.hent(noegle) !== '1') {
          lager.gem(noegle, '1');
          fx.pop('SKYD MIG!', p.x, p.y + h + 30, { farve: 'roed', str: 26, varighed: 1.8, vy: 14 });
        }
      }
    }
  }

  /* Flyvelyden og boret er løbende lyde uden for kanalen (main.js foelgSkud og
   * 'bor'-løkken), så lyd.loop lader ikke ilden tie for dem: det gør vi her.
   * Et skud suser fra SUS_FART, og boret summer, så længe en kunde borer.
   * Spejlet er det samme, main.js tænder suset efter, så ilden tier altid, når
   * suset kan høres (og lidt oftere: også for et skud, kameraet ikke følger). */
  let ildTierTil = 0;
  function andenLoebendeLyd(verden) {
    for (const p of verden.projektiler || []) {
      if (!p.sover && Math.hypot(p.vx || 0, p.vy || 0) >= SUS_FART) return true;
    }
    for (const b of verden.baevere || []) if (b.graver && !b.doed) return true;
    return false;
  }

  function knitren(verden) {
    let bedst = 0;
    const ild = verden.ild || [];
    if (ild.length && S.tilstand === 'spil') {
      // Lytteren er kameraet — eller den aktive kunde, hvis den er tættere på
      // (samme regel som main.js' rumlig).
      const k = r.kamera.position, akt = verden.aktivBaever?.();
      for (const q of ild) {
        let d = Math.hypot(q.x - k.x, q.y - k.y);
        if (akt && !akt.doed) d = Math.min(d, Math.hypot(q.x - akt.x, q.y - akt.y));
        const naer = Math.max(0, 1 - d / ILD_HOERES);
        if (naer * naer > bedst) bedst = naer * naer;
      }
    }
    const vol = bedst * (0.55 + 0.45 * Math.min(1, ild.length / 8));
    // Ilden venter også, til suset eller boret er tonet ud (regnet fra den
    // frame, de slukkes). Løkken kører videre lydløst (som under kanalens
    // lyde) og tager over uden et nyt anslag.
    const nu = performance.now();
    if (andenLoebendeLyd(verden)) ildTierTil = Infinity;
    else if (ildTierTil === Infinity) ildTierTil = nu + LOEBENDE_UD_MS;
    lyd.loop('ild', vol > 0.02, nu < ildTierTil ? 0 : vol);
  }

  return {
    /** Hver frame: lyden, glimtet og pilens mål. skriv = false (main.js):
     *  DOM'en venter på skriv(), til HUD'en har læst sit. */
    opdater(verden = v(), skriv = true) {
      if (!verden) return;
      venteLyd();
      knitren(verden);
      ventendeGlimt();
      // Sejren (og menuen bagefter): .hud.fest skjuler ikke farernes lag, og en
      // fare kan stå på banen i et minut — eller et varsel være frosset i spejlet.
      if (S.tilstand !== 'spil') ingenPil();
      else if (har) regnPil(verden);
      if (skriv) this.skriv();
    },
    /** Pilen og skiltet i DOM'en (kun skrivninger, og kun ændringer). */
    skriv() {
      saetPil(maal.pil, maal.x, maal.y, maal.vinkel, maal.ikon, maal.klasse);
      saetSkilt(maal.skilt, maal.sx, maal.sy, maal.tekst);
    },
    fjern() { lag?.remove(); lyd.loop('ild', false); },
  };
}
