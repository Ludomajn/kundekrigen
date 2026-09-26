/* Kundekrigen — lyd.
 *
 * Alle filer er Kenney.nl (CC0): platformer-pakkens sfx plus lyde fra
 * Kenneys åbne starter-kits (se static/lyd/ og LICENS.txt). WebAudio frem
 * for <audio>: fri polyfoni, per-afspilning volumen og tonehøjde — og en
 * kørende AudioContext undtager i øvrigt værtens fane fra Chromes hårde
 * throttling, hvilket netværksspillet i forvejen ønsker.
 *
 * Browsere kræver en brugerhandling, før lyd må starte: konteksten oprettes
 * ved første tastetryk/klik (laasOp installeres ved import). Indtil da — og
 * hvis en fil mangler — er alle kald lydløse i stedet for fejl.
 *
 * Ren præsentation: simulationen ved ikke, at lyden findes.
 */
'use strict';

const STI = '/lyd';
const NAVNE = [
  'skud', 'kast', 'brag', 'nedslag', 'skade', 'landing',
  'klik', 'sejr', 'byg', 'splint', 'fald', 'gang', 'ambience',
  // Effekter fra "Sound effects Pack 2" og "Snake's Authentic Gun Sounds",
  // klippet og normaliseret af vaerktoej/lydpakker.py.
  'sfx_oplad', 'sfx_fuld_kraft', 'sfx_hop', 'sfx_salto', 'sfx_tael', 'sfx_ramt',
  'sfx_vaabenskift', 'sfx_kasse', 'sfx_helbred', 'sfx_sort_hul', 'sfx_teleport',
  'sfx_intro_slam', 'sfx_nedtael', 'sfx_kamp_start', 'sfx_landing', 'sfx_du_vandt', 'sfx_tabt',
  // Kundernes stemmer — brugerens egne optagelser, klippet og normaliseret
  // af vaerktoej/kundelyde.py.
  'stemme_av', 'stemme_meget_skade', 'stemme_doed', 'stemme_faldt_i_vandet',
  'stemme_det_er_din_tur', 'stemme_det_er_din_tur_2', 'stemme_det_er_din_tur_3',
  'stemme_saet_i_gang', 'stemme_provokation', 'stemme_ha_ha',
  'stemme_er_det_en_laege_til_stede', 'stemme_tonerkanon', 'stemme_vindersangen',
  'stemme_vindermusik_2', 'stemme_kill', 'stemme_sekretaer_lyd',
  // Brugerens egne effektlyde (samme værktøj): våbnene og telefonen.
  'stemme_skud', 'stemme_kanon_lyd', 'stemme_granat', 'stemme_slag', 'stemme_slag_2',
  'stemme_systemnedbrud', 'stemme_fax', 'stemme_telefonlyd_til_event',
];

let ctx = null;
let master = null;
const buffere = new Map();
let hentet = null;
let volumen = 0.7;
let lydFra = false;                  // mute — se saetLydFra

function sikrKontekst() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = lydFra ? 0 : volumen;
  master.connect(ctx.destination);
  return ctx;
}

/** Hent og afkod alle lyde. Kaldes efter første brugerhandling. */
function indlaes() {
  if (hentet || !sikrKontekst()) return hentet;
  hentet = Promise.all(NAVNE.map(async (navn) => {
    try {
      const svar = await fetch(`${STI}/${navn}.ogg`);
      buffere.set(navn, await ctx.decodeAudioData(await svar.arrayBuffer()));
    } catch { console.warn('[lyd] mangler', navn); }
  }));
  return hentet;
}

/** Første tastetryk/klik åbner lydvejen — browsernes autoplay-regel. */
function laasOp() {
  if (sikrKontekst()) {
    ctx.resume();
    indlaes();
  }
  window.removeEventListener('keydown', laasOp);
  window.removeEventListener('pointerdown', laasOp);
  window.removeEventListener('touchstart', laasOp);
}
window.addEventListener('keydown', laasOp);
window.addEventListener('pointerdown', laasOp);
window.addEventListener('touchstart', laasOp);

/* Prøv at starte lyden, så snart siden er åbnet — så menumusikken spiller,
 * når man lander på forsiden. De fleste browsere holder konteksten
 * suspenderet til første klik eller tastetryk; så starter den dér (laasOp).
 * Har browseren allerede tillid til siden, kører den med det samme. */
if (sikrKontekst()) {
  ctx.resume().then(() => { if (ctx.state === 'running') indlaes(); }).catch(() => {});
}

/*
 * ÉN LYD AD GANGEN. Alle korte lyde — effekter og stemmer — deler én kanal:
 * spiller der allerede noget, afspilles den nye lyd ikke. Enkelte lyde må
 * ikke falde bort (døden, introens nedtælling, sejren); de er `vigtig` og
 * venter i en lille kø, til kanalen er fri — stadig uden at overlappe.
 * De løbende lyde holder sig også ude: opladningen optager kanalen, mens der
 * lades, og flyvelyden og fodtrinene tier, mens noget andet spiller.
 * Musikken og den svage baggrundsstemning er baggrund og ligger udenfor.
 */
let optagetTil = 0;                  // ctx.currentTime, hvor kanalen er fri igen
let nuvaerende = null;               // den kilde, der spiller lige nu
const koe = [];                      // vigtige lyde, der venter (højst 3)
let koeTimer = 0;

export const kanalFri = () => !!ctx && ctx.currentTime >= optagetTil && !lade;

function naesteIKoe() {
  clearTimeout(koeTimer);
  if (!koe.length || !ctx) return;
  if (!kanalFri()) {
    koeTimer = setTimeout(naesteIKoe, Math.max(30, (optagetTil - ctx.currentTime) * 1000 + 60));
    return;
  }
  const n = koe.shift();
  spil(n.navn, n.opt);
}

function spil(navn, { vol = 1, tone = 1, maksSek = 0, stemme = false } = {}) {
  const b = buffere.get(navn);
  if (!b) return false;
  const kilde = ctx.createBufferSource();
  kilde.buffer = b;
  kilde.playbackRate.value = tone;
  const g = ctx.createGain();
  g.gain.value = vol;
  kilde.connect(g); g.connect(master);
  kilde.start();
  let varighed = b.duration / tone;
  // maksSek: lange lyde (faxen, telefonen) tones ud i stedet for at køre til ende.
  if (maksSek && varighed > maksSek) {
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t + maksSek - 0.6);
    g.gain.linearRampToValueAtTime(0, t + maksSek);
    kilde.stop(t + maksSek + 0.05);
    varighed = maksSek;
  }
  optagetTil = ctx.currentTime + varighed;
  nuvaerende = kilde;
  kilde.onended = () => {
    if (nuvaerende === kilde) nuvaerende = null;
    if (stemme) stilleTil = ctx.currentTime + PAUSE_S;
    naesteIKoe();
  };
  return true;
}

/**
 * Afspil en lyd — men kun, hvis kanalen er fri. vol er relativ (0-1), tone
 * ganger tonehøjden. vigtig: vent i kø i stedet for at blive sprunget over.
 */
export function afspil(navn, { vol = 1, tone = 1, maksSek = 0, vigtig = false } = {}) {
  if (!buffere.get(navn) || !ctx || ctx.state !== 'running' || volumen <= 0) return false;
  if (!kanalFri()) {
    if (vigtig && koe.length < 3) { koe.push({ navn, opt: { vol, tone, maksSek } }); naesteIKoe(); }
    return false;
  }
  return spil(navn, { vol, tone, maksSek });
}

/*
 * Stemmerne følger samme kanal og har to regler oveni: efter en replik er
 * der PAUSE_S sekunders ro, før den næste må komme, og chance gør de hyppige
 * replikker til en overraskelse frem for en regel. vigtig springer begge over.
 */
const PAUSE_S = 3.5;
let stilleTil = 0;

export function stemme(navn, { chance = 1, vol = 1, vigtig = false } = {}) {
  if (Array.isArray(navn)) navn = navn[Math.floor(Math.random() * navn.length)];
  if (!buffere.get(navn) || !ctx || ctx.state !== 'running' || volumen <= 0) return false;
  if (!vigtig && (Math.random() > chance || ctx.currentTime < stilleTil)) return false;
  if (!kanalFri()) {
    if (vigtig && koe.length < 3) { koe.push({ navn, opt: { vol, stemme: true } }); naesteIKoe(); }
    return false;
  }
  return spil(navn, { vol, stemme: true });
}

/** Stop det, der spiller, og tøm køen — alt skal være stille. */
export function stopStemme() {
  koe.length = 0;
  clearTimeout(koeTimer);
  if (ctx) optagetTil = ctx.currentTime;
  const k = nuvaerende;
  nuvaerende = null;
  try { k?.stop(); } catch { /* allerede stoppet */ }
}

export const talerNogen = () => !kanalFri();

/* Løkker (gang, ambience): én kørende kilde per navn, tændes og slukkes. */
const loekker = new Map();

export function loop(navn, til, vol = 1) {
  if (navn !== 'ambience' && ctx && !kanalFri()) vol = 0;      // én lyd ad gangen
  const koerer = loekker.get(navn);
  if (til === !!koerer) {
    if (koerer) koerer.gain.gain.value = vol;
    return;
  }
  if (!til) {
    // kort fade, så løkken ikke klipper
    try {
      koerer.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
      koerer.kilde.stop(ctx.currentTime + 0.15);
    } catch { /* allerede stoppet */ }
    loekker.delete(navn);
    return;
  }
  const b = buffere.get(navn);
  if (!b || !ctx || ctx.state !== 'running' || volumen <= 0) return;
  const kilde = ctx.createBufferSource();
  kilde.buffer = b;
  kilde.loop = true;
  const g = ctx.createGain();
  g.gain.value = vol;
  kilde.connect(g); g.connect(master);
  kilde.start();
  loekker.set(navn, { kilde, gain: g });
}

export function stopAlleLoekker() {
  for (const navn of [...loekker.keys()]) loop(navn, false);
  flyvelyd(null);
  ladelyd(null);
}

/*
 * Opladelyden: Power-up-lyden fra effektpakken, afspillet langsommere, så
 * dens stigning varer præcis lige så længe som opladningen — man HØRER, hvor
 * langt skuddet når. Ved fuld kraft et kort ding; slippes der før, toner den
 * hurtigt ud.
 */
let lade = null;                     // { kilde, g, fuld }

/** kraft01 = 0..1 mens der lades, null når der ikke lades. opladSek er
 *  våbnets opladningstid. Kaldes hver frame. */
export function ladelyd(kraft01, opladSek = 1.05) {
  if (!ctx || ctx.state !== 'running') return;
  if (kraft01 == null) {
    if (lade) {
      const t = ctx.currentTime;
      lade.g.gain.cancelScheduledValues(t);
      lade.g.gain.setTargetAtTime(0, t, 0.015);
      try { lade.kilde.stop(t + 0.08); } catch { /* allerede stoppet */ }
      lade = null;           // kanalen er fri med det samme — skudlyden kommer lige efter
    }
    return;
  }
  if (!lade) {
    const b = buffere.get('sfx_oplad');
    // Spiller der noget, venter opladelyden — og starter så dér, hvor
    // opladningen er nået til, så stigningen stadig passer til kraften.
    if (!b || volumen <= 0 || ctx.currentTime < optagetTil) return;
    const kilde = ctx.createBufferSource();
    kilde.buffer = b;
    const rate = Math.max(0.4, Math.min(1.2, b.duration / opladSek));
    kilde.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = 0.55;
    kilde.connect(g); g.connect(master);
    kilde.start(0, Math.min(b.duration * 0.95, kraft01 * b.duration));
    lade = { kilde, g, fuld: kraft01 >= 1 };
  }
  // Dinget ved fuld kraft hører til opladningen, der ejer kanalen.
  if (kraft01 >= 1 && !lade.fuld) { lade.fuld = true; spil('sfx_fuld_kraft', { vol: 0.7 }); }
}

/*
 * Flyvelyden: syntetiseret i stedet for en fil, fordi den skal følge skuddet
 * løbende. Tre lag, der alle styres af projektilets fart og retning:
 *   sus     — hvid støj gennem et båndpasfilter, der åbner med farten
 *   fløjt   — en tynd tone, der falder, når skuddet dykker (tegneserie-bomben)
 *   tumlen  — støjen pulserer, når ting kastes og vender i luften
 * Grafen bygges én gang og står og kører lydløst; kaldet sætter kun mål.
 */
let flyv = null;

function bygFlyv() {
  const n = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const stoej = ctx.createBufferSource();
  stoej.buffer = buf; stoej.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = 600; filter.Q.value = 1.4;
  const tumleGain = ctx.createGain(); tumleGain.gain.value = 1;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
  const lfoDybde = ctx.createGain(); lfoDybde.gain.value = 0;
  lfo.connect(lfoDybde); lfoDybde.connect(tumleGain.gain);
  const susGain = ctx.createGain(); susGain.gain.value = 0;
  stoej.connect(filter); filter.connect(tumleGain); tumleGain.connect(susGain); susGain.connect(master);

  const tone = ctx.createOscillator(); tone.type = 'triangle'; tone.frequency.value = 900;
  const toneGain = ctx.createGain(); toneGain.gain.value = 0;
  tone.connect(toneGain); toneGain.connect(master);

  stoej.start(); lfo.start(); tone.start();
  return { filter, susGain, toneGain, tone, lfo, lfoDybde };
}

/**
 * Opdatér flyvelyden hver frame. p = { vx, vy, tumler, raket } eller null
 * for stilhed. Blød overgang, så intet klikker.
 */
export function flyvelyd(p) {
  if (!ctx || ctx.state !== 'running') return;
  if (!p && !flyv) return;
  if (!flyv) flyv = bygFlyv();
  const t = ctx.currentTime, glat = 0.06;
  if (!p) {
    flyv.susGain.gain.setTargetAtTime(0, t, 0.05);
    flyv.toneGain.gain.setTargetAtTime(0, t, 0.05);
    return;
  }
  const fart = p ? Math.hypot(p.vx || 0, p.vy || 0) : 0;
  // En granat, der ligger stille og venter på lunten, suser ikke — og mens
  // en anden lyd spiller, tier suset (én lyd ad gangen).
  if (fart < 40 || !kanalFri()) {
    flyv.susGain.gain.setTargetAtTime(0, t, 0.05);
    flyv.toneGain.gain.setTargetAtTime(0, t, 0.05);
    return;
  }
  const f01 = Math.min(1, fart / 1100);
  flyv.filter.frequency.setTargetAtTime(350 + f01 * 2200, t, glat);
  flyv.susGain.gain.setTargetAtTime((p.raket ? 0.34 : 0.26) * (0.25 + 0.75 * f01), t, glat);
  // Faldet: jo hurtigere nedad, jo dybere fløjt.
  const vy = p.vy || 0;
  const hz = Math.max(320, Math.min(1500, 820 + vy * 0.55));
  flyv.tone.frequency.setTargetAtTime(hz, t, glat);
  flyv.toneGain.gain.setTargetAtTime((p.raket ? 0.028 : 0.045) * (0.3 + 0.7 * f01), t, glat);
  flyv.lfo.frequency.setTargetAtTime(p.tumler ? 5 + f01 * 5 : 0.1, t, 0.1);
  flyv.lfoDybde.gain.setTargetAtTime(p.tumler ? 0.7 : 0, t, 0.1);
}

/*
 * Musikken: "kulakovka – fighting" i menuen og lobbyen (10 %), og
 * "monume – fight" under kampen (18 %). Streames fra <audio> i
 * stedet for at blive afkodet — 2½ minut stereo fylder ellers over 50 MB i
 * hukommelsen. Musikken har sin EGEN lydvej til højttaleren, så dens skyder
 * (saetMusikVolumen) virker uafhængigt af effekternes. Skift mellem numrene
 * toner blødt over.
 */
// Kampnummeret er mastret ~10 dB svagere end menunummeret, derfor det højere tal.
const SPOR = { musik_menu: 0.1, musik_kamp: 0.18 };
const numre = new Map();             // navn -> { el, g }
let musikVolumen = 1;
let sporNu = null;

function nummer(navn) {
  if (numre.has(navn)) return numre.get(navn);
  const el = new Audio(`${STI}/${navn}.ogg`);
  el.loop = true;
  el.preload = 'auto';
  const g = ctx.createGain(); g.gain.value = 0;
  ctx.createMediaElementSource(el).connect(g);
  g.connect(ctx.destination);
  const n = { el, g, pause: 0 };
  numre.set(navn, n);
  return n;
}

/** Hvilket nummer der skal spille ('musik_menu', 'musik_kamp' eller null). */
export function musik(spor) {
  if (!ctx || ctx.state !== 'running') return;
  if (spor === sporNu) return;
  const t = ctx.currentTime;
  const gammel = sporNu && numre.get(sporNu);
  if (gammel) {
    gammel.g.gain.cancelScheduledValues(t);
    gammel.g.gain.setTargetAtTime(0, t, 0.3);
    clearTimeout(gammel.pause);
    const el = gammel.el;
    gammel.pause = setTimeout(() => el.pause(), 1800);
  }
  sporNu = spor;
  if (!spor) return;
  const n = nummer(spor);
  clearTimeout(n.pause);
  n.el.play().catch(() => { if (sporNu === spor) sporNu = null; });   // prøves igen næste gang
  n.g.gain.cancelScheduledValues(t);
  n.g.gain.setTargetAtTime(lydFra ? 0 : SPOR[spor] * musikVolumen, t, 0.6);
}

/** Musikkens lydstyrke 0-1 (skyderen "Musik"). */
export function saetMusikVolumen(v) {
  musikVolumen = Math.max(0, Math.min(1, v));
  if (ctx && sporNu && numre.has(sporNu)) {
    numre.get(sporNu).g.gain.setTargetAtTime(lydFra ? 0 : SPOR[sporNu] * musikVolumen, ctx.currentTime, 0.05);
  }
}

/* Lyd fra (mute): både effekter og musik tier; skyderne huskes. */
export function saetLydFra(fra) {
  lydFra = !!fra;
  if (master) master.gain.value = lydFra ? 0 : volumen;
  if (ctx && sporNu && numre.has(sporNu)) {
    numre.get(sporNu).g.gain.setTargetAtTime(lydFra ? 0 : SPOR[sporNu] * musikVolumen, ctx.currentTime, 0.05);
  }
}
export const erLydFra = () => lydFra;

/** Mastervolumen 0-1. Gemmes af kalderen (profilen); vi husker den kun. */
export function saetVolumen(v) {
  volumen = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = lydFra ? 0 : volumen;
}

export const faarVolumen = () => volumen;
