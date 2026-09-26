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
/*
 * Kontorlydene fra "400 Sounds Pack" (vaerktoej/kontorlyde.py) afløser de
 * gamle 8-bit-effekter. Hver gruppe har en eller flere varianter,
 * k_<gruppe>_1 … _n, og kaldes med gruppens navn: afspil('fodtrin') vælger
 * en tilfældig variant — aldrig den samme to gange i træk.
 */
const GRUPPER = {
  fodtrin: 4, hop: 2, salto: 2, kast: 2, landing: 1, tungt_fald: 1, vaabenskift: 3,
  papir_kast: 1, papir_land: 2, metal: 1, skum: 2, mine_laeg: 1, mine_bip: 1, mine_armeret: 1,
  opdatering_skud: 1, opdatering_ramt: 1, opdatering_faerdig: 1, bor: 1, skjold_op: 2,
  skjold_blok: 2, skjold_slut: 1, teleport: 1, teleport_afvist: 1, kasse_samlet: 2,
  vaaben_samlet: 2, kasse_falder: 1, piller: 1, skade: 3, klask_ramt: 1, covid_host: 2,
  covid_sky: 1, plask: 1, sort_hul: 1, klik: 2, tael: 3, oplad: 1, fuld_kraft: 1,
  intro_slam: 1, nedtael: 2, kamp_start: 1, du_vandt: 1, tabt: 1, inferno_delt: 1,
};
// Gruppernes egen lydstyrke, målt af værktøjet, så de sidder godt sammen
// (fodtrin og tik svagt, slag og fald kraftigt). Kaldets vol ganges på.
const GRUPPE_VOL = {
  fodtrin: 0.3, hop: 0.5, salto: 0.57, kast: 0.46, landing: 0.83, tungt_fald: 0.92,
  vaabenskift: 0.46, papir_kast: 0.6, papir_land: 1, metal: 0.3, skum: 1, mine_laeg: 0.46,
  mine_bip: 0.3, mine_armeret: 0.3, opdatering_skud: 0.3, opdatering_ramt: 0.3,
  opdatering_faerdig: 0.3, bor: 0.4, skjold_op: 0.54, skjold_blok: 0.64, skjold_slut: 0.75,
  teleport: 0.33, teleport_afvist: 0.36, kasse_samlet: 0.69, vaaben_samlet: 0.66,
  kasse_falder: 0.53, piller: 0.75, skade: 0.93, klask_ramt: 0.85, covid_host: 0.44,
  covid_sky: 0.38, plask: 0.82, sort_hul: 0.32, klik: 0.47, tael: 0.3, oplad: 0.3,
  fuld_kraft: 0.3, intro_slam: 0.92, nedtael: 0.56, kamp_start: 0.3, du_vandt: 0.39,
  tabt: 0.71, inferno_delt: 0.77,
};
const sidstValgt = new Map();

/** Gruppenavn -> en af gruppens filer (en fil, der ikke er en gruppe, er sig selv). */
function variant(navn) {
  const n = GRUPPER[navn];
  if (!n) return navn;
  let i = Math.floor(Math.random() * n);
  if (n > 1 && i === sidstValgt.get(navn)) i = (i + 1) % n;
  sidstValgt.set(navn, i);
  return `k_${navn}_${i + 1}`;
}

const NAVNE = [
  // Eksplosionerne og baggrunden (Kenney.nl).
  'brag', 'nedslag', 'sejr', 'ambience',
  ...Object.entries(GRUPPER).flatMap(([g, n]) => Array.from({ length: n }, (_, i) => `k_${g}_${i + 1}`)),
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

/** Hent og afkod alle lyde. Kaldes efter første brugerhandling.
 *  Musikken går forrest: de 57 effekter (2 MB) venter, til menunummeret har
 *  nok til at spille (højst 2,5 s), så de ikke deles om linjen med det. */
function indlaes() {
  if (hentet || !sikrKontekst()) return hentet;
  hentet = musikBuffret().then(() => Promise.all(NAVNE.map(async (navn) => {
    try {
      // Baggrundsstemningen (1,1 MB) bruges først i kampen.
      const svar = await fetch(`${STI}/${navn}.ogg`, { priority: navn === 'ambience' ? 'low' : 'auto' });
      buffere.set(navn, await ctx.decodeAudioData(await svar.arrayBuffer()));
    } catch { console.warn('[lyd] mangler', navn); }
  })));
  return hentet;
}

/** Hver brugerhandling holder lydvejen åben — browsernes autoplay-regel.
 *
 * Lytteren bliver siddende hele besøget. Ikke alle input giver browseren lov
 * til lyd: et touch-tryk giver det først ved pointerup/touchend, og Cmd, Alt,
 * Ctrl, Shift og Esc giver det aldrig. Fjernede vi lytteren efter første
 * input, var siden tavs resten af besøget, hvis det input var et af dem.
 * Capture, fordi tekstfelter stopper tastetryk længere nede. */
function laasOp() {
  if (!sikrKontekst()) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // Musikken startes HER, i selve brugerhandlingen — ikke et øjeblik senere
  // fra main.js' timer. Safari tillader kun play() inde i en brugerhandling
  // (og låser hvert <audio> for sig); Chrome er mildere, men starter så straks.
  if (oensket) {
    const n = numre.get(oensket);
    if (sporNu !== oensket) startMusik(oensket);
    else if (n && n.el.paused) n.el.play().catch(() => {});
  }
  indlaes();
}
for (const t of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click']) {
  window.addEventListener(t, laasOp, { capture: true, passive: true });
}

/** Må browseren spille lyd lige nu — eller siger den på forhånd, at den må? */
export function lydTilladt() {
  if (ctx?.state === 'running') return true;
  try { return navigator.getAutoplayPolicy?.('audiocontext') === 'allowed'; } catch { return false; }
}

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
let nuvaerende = null;               // den lyd, der spiller lige nu: { kilde, g, p, vigtig, forrang, start }
const koe = [];                      // lyde, der venter: højst 3 vigtige + ét brag, der udløber
let koeTimer = 0;

export const kanalFri = () => !!ctx && ctx.currentTime >= optagetTil && !lade;

function naesteIKoe() {
  clearTimeout(koeTimer);
  if (!koe.length || !ctx) return;
  if (!kanalFri()) {
    koeTimer = setTimeout(naesteIKoe, Math.max(30, (optagetTil - ctx.currentTime) * 1000 + 60));
    return;
  }
  // Et brag, der har ventet for længe, hører ikke længere til sin eksplosion.
  while (koe.length && koe[0].udloeb && ctx.currentTime > koe[0].udloeb) koe.shift();
  const n = koe.shift();
  if (n) spil(n.navn, { ...n.opt, vigtig: n.vigtig });
  if (koe.length) naesteIKoe();
}

/** Stereoplacering: -1 venstre … 1 højre (ældre Safari har ingen panner). */
function lavPanner(pan) {
  if (!ctx.createStereoPanner) return null;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

function spil(navn, { vol = 1, tone = 1, maksSek = 0, stemme = false, pan = 0, vigtig = false, forrang = false } = {}) {
  const b = buffere.get(navn);
  if (!b) return false;
  const kilde = ctx.createBufferSource();
  kilde.buffer = b;
  kilde.playbackRate.value = tone;
  const g = ctx.createGain();
  g.gain.value = vol;
  const p = pan ? lavPanner(pan) : null;
  kilde.connect(g);
  if (p) { g.connect(p); p.connect(master); } else g.connect(master);
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
  const lydNu = { kilde, g, p, vigtig, forrang, start: ctx.currentTime, maksSek };
  nuvaerende = lydNu;
  kilde.onended = () => {
    if (nuvaerende === lydNu) nuvaerende = null;
    if (stemme) stilleTil = ctx.currentTime + PAUSE_S;
    naesteIKoe();
  };
  return lydNu;
}

/** Tag kanalen fra det, der spiller: en hurtig fade (40 ms), så intet klikker. */
function afbryd() {
  const n = nuvaerende;
  nuvaerende = null;
  optagetTil = ctx.currentTime;
  if (!n) return;
  const t = ctx.currentTime;
  try {
    n.g.gain.cancelScheduledValues(t);
    n.g.gain.setValueAtTime(n.g.gain.value, t);
    n.g.gain.linearRampToValueAtTime(0, t + 0.04);
    n.kilde.stop(t + 0.05);
  } catch { /* allerede stoppet */ }
}

/**
 * Juster en lyd, mens den spiller (telefonen, der kommer nærmere). h er det,
 * afspil() returnerede; en lyd, der er slut, ignoreres.
 */
export function justerLyd(h, { vol, pan } = {}) {
  if (!h || !ctx || h !== nuvaerende) return;
  const t = ctx.currentTime;
  const udtoning = h.maksSek ? h.start + h.maksSek - 0.6 : Infinity;
  if (vol !== undefined && t < udtoning) {
    // Det nye niveau erstatter den planlagte kurve — og udtoningen lægges
    // på igen fra det niveau, ellers sprang lyden tilbage ved udtoningen.
    h.g.gain.cancelScheduledValues(t);
    h.g.gain.setTargetAtTime(Math.max(0, vol), t, 0.08);
    if (udtoning < Infinity) h.g.gain.setTargetAtTime(0, udtoning, 0.15);
  }
  if (pan !== undefined && h.p) h.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.08);
}

/**
 * Afspil en lyd — men kun, hvis kanalen er fri. vol er relativ (0-1), tone
 * ganger tonehøjden, pan placerer lyden i stereo. vigtig: vent i kø i stedet
 * for at blive sprunget over.
 *
 * forrang (eksplosioner): lyden TAGER kanalen fra det, der spiller — typisk
 * affyringslyden, som ellers overdøvede nedslaget, så eksplosionerne var
 * tavse. Stadig kun én lyd ad gangen: den gamle tones ud på 40 ms. En vigtig
 * lyd (døden, nedtællingen) afbrydes dog ikke; så venter braget i køen. Og
 * kommer flere brag inden for 0,15 s (klynger, fakturaregn), høres det første.
 */
export function afspil(navn, { vol = 1, tone = 1, maksSek = 0, vigtig = false, forrang = false, pan = 0 } = {}) {
  vol *= GRUPPE_VOL[navn] ?? 1;
  navn = variant(navn);
  if (!buffere.get(navn) || !ctx || ctx.state !== 'running' || volumen <= 0) return false;
  if (!kanalFri()) {
    const n = nuvaerende;
    if (forrang && !lade && n && !n.vigtig && !(n.forrang && ctx.currentTime - n.start < 0.15)) {
      afbryd();
      return spil(navn, { vol, tone, maksSek, pan, forrang });
    }
    if (vigtig && koe.filter((x) => x.vigtig).length < 3) {
      koe.push({ navn, vigtig: true, opt: { vol, tone, maksSek, pan, forrang } });
      naesteIKoe();
    } else if (forrang && n?.vigtig && !koe.some((x) => x.udloeb)) {
      // Et brag under en vigtig replik venter højst 0,35 s — og tager aldrig
      // en af de vigtige pladser.
      koe.push({ navn, vigtig: false, udloeb: ctx.currentTime + 0.35, opt: { vol, tone, maksSek, pan, forrang } });
      naesteIKoe();
    }
    return false;
  }
  return spil(navn, { vol, tone, maksSek, pan, vigtig, forrang });
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
    if (vigtig && koe.filter((x) => x.vigtig).length < 3) {
      koe.push({ navn, vigtig: true, opt: { vol, stemme: true } });
      naesteIKoe();
    }
    return false;
  }
  // vigtig følger med: ellers kunne et brag med forrang afbryde dødsreplikken.
  return spil(navn, { vol, stemme: true, vigtig });
}

/** Stop det, der spiller, og tøm køen — alt skal være stille. */
export function stopStemme() {
  koe.length = 0;
  clearTimeout(koeTimer);
  if (ctx) optagetTil = ctx.currentTime;
  const n = nuvaerende;
  nuvaerende = null;
  try { n?.kilde.stop(); } catch { /* allerede stoppet */ }
}

export const talerNogen = () => !kanalFri();

/* Løkker (gang, ambience): én kørende kilde per navn, tændes og slukkes. */
const loekker = new Map();

export function loop(navn, til, vol = 1) {
  vol *= GRUPPE_VOL[navn] ?? 1;
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
  // En gruppe løkkes altid på sin første variant (boret har kun én).
  const b = buffere.get(GRUPPER[navn] ? `k_${navn}_1` : navn);
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
    const b = buffere.get(variant('oplad'));
    // Spiller der noget, venter opladelyden — og starter så dér, hvor
    // opladningen er nået til, så stigningen stadig passer til kraften.
    if (!b || volumen <= 0 || ctx.currentTime < optagetTil) return;
    const kilde = ctx.createBufferSource();
    kilde.buffer = b;
    const rate = Math.max(0.4, Math.min(1.2, b.duration / opladSek));
    kilde.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = 1.5 * GRUPPE_VOL.oplad;
    kilde.connect(g); g.connect(master);
    kilde.start(0, Math.min(b.duration * 0.95, kraft01 * b.duration));
    lade = { kilde, g, fuld: kraft01 >= 1 };
  }
  // Dinget ved fuld kraft hører til opladningen, der ejer kanalen.
  if (kraft01 >= 1 && !lade.fuld) { lade.fuld = true; spil(variant('fuld_kraft'), { vol: 1.5 * GRUPPE_VOL.fuld_kraft }); }
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
let oensket = null;                  // det nummer, spillet beder om — også før lyden er låst op

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
  oensket = spor;
  if (!ctx || ctx.state !== 'running') return;
  startMusik(spor);
}

function startMusik(spor) {
  if (!ctx || spor === sporNu) return;
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
  // Skift mellem numre toner blødt over; første start kommer hurtigt ind.
  n.g.gain.setTargetAtTime(lydFra ? 0 : SPOR[spor] * musikVolumen, t, gammel ? 0.6 : 0.2);
}

/** Venter, til menunummeret kan spille (eller højst maksMs). */
function musikBuffret(maksMs = 2500) {
  const n = numre.get('musik_menu');
  if (!n || n.el.readyState >= 3) return Promise.resolve();       // HAVE_FUTURE_DATA
  return new Promise((ok) => {
    const t = setTimeout(ok, maksMs);
    n.el.addEventListener('canplay', () => { clearTimeout(t); ok(); }, { once: true });
  });
}

// Menunummeret begynder at buffere, så snart siden er åbnet. Så er det klar,
// når browseren tillader lyd, i stedet for først at blive hentet dér. (Står
// efter numre/SPOR med vilje: const'erne findes ikke før denne linje.)
if (ctx) nummer('musik_menu');

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
