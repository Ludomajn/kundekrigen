/* Kundekrigen — opstart og hovedløkke.
 *
 * Den eneste fil der ved om vi spiller lokalt eller over netværket, og det
 * viser sig kun ét sted: hvilken transport vi vælger.
 *
 * SIMULATIONEN KØRER I EN WORKER, ikke på rAF i hovedtråden.
 * Det er en arkitekturbeslutning, ikke en optimering: når fanen går i
 * baggrunden, struber browseren rAF til nær nul, og efter fem minutter kører
 * timere én gang i minuttet. Kørte simulationen her, ville spillet fryse for
 * alle tolv, uden at værten opdagede det. Workers throttles ikke.
 *
 * Følgevirkning: hovedtråden er ALTID modtager — den spejler en simulation der
 * enten kører i vores egen Worker (vi er vært) eller i en anden browser (vi er
 * klient). Rendering og HUD har derfor kun én kodesti.
 */
'use strict';

import { lavRenderer } from './render/renderer.js';
import { lavKamera } from './render/camera.js';
import { lavTerraenView } from './render/terrain_view.js';
import { lavPyntView } from './render/pynt_view.js';
import { malMenuScene } from './render/menu_kunst.js';
import { lavBaeverView, indlaesGrafik } from './render/figur_view.js';
import { lavParallaks } from './render/parallax.js';
import { lavVejr } from './render/weather.js';
import { lavVand } from './render/water.js';
import { lavFx, lavProjektilView, lavGenstandView, lavSigte, telefonRinger, mineSekund } from './render/fx.js';
import { OPKALD } from './sim/opkald.js';
import { lavDebug } from './render/debug.js';
import { lavSorteHuller } from './render/fejl40.js';

import { lavVerden, T as TIL } from './sim/world.js';
import { K } from './sim/commands.js';
import { VAABEN } from './sim/weapons.js';
import { mundingsPunkt } from './sim/behaviours.js';
import { luftmodstand } from './sim/physics.js';
import * as lyd from './ui/lyd.js';

import { lavTastatur } from './ui/keyboard.js';
import { lavHud } from './ui/hud.js';
import { lavVaabenpanel } from './ui/weaponpanel.js';
import { lavMenu } from './ui/menu.js';
import { lavHjaelp } from './ui/hjaelp.js';
import { lavSejrsfest } from './ui/sejrsfest.js';
import { lavIntro } from './ui/intro.js';
import { holdFarve } from './render/palette.js';
import { indlaesProfil, gemProfil, gemSession, hentSession, NAVNEPULJE } from './ui/customise.js';
import { T, mmss, BANE_NAVN, VEJR_NAVN } from './ui/tekst.js';
import { BANE_TYPER } from './sim/terrain_gen.js';
import { VEJRTYPER } from './sim/turn.js';

import { lavBus } from './core/bus.js';
import { DT, HZ } from './core/tick.js';
import { lavRng } from './core/rng.js';

import { WsTransport, LoopbackTransport, lavLokaltRum } from './net/transport.js';
import { WorkerTransport } from './net/worker_transport.js';
import { lavKlient } from './net/client.js';

const laerred = document.getElementById('laerred');
const hudRod = document.getElementById('hud');
const menuRod = document.getElementById('menu');
const panelRod = document.getElementById('panel');
const indlaesRod = document.getElementById('indlaeser');
const hjaelpRod = document.getElementById('hjaelp');

const bus = lavBus();
const r = lavRenderer(laerred);
const tast = lavTastatur();
const panel = lavVaabenpanel(panelRod);
const hjaelp = lavHjaelp(hjaelpRod);
hjaelp.saetSynlig(false);

/** Al foranderlig tilstand ét sted. */
const S = {
  tilstand: 'menu',           // menu | lobby | spil
  erVaert: false,
  erNet: false,
  pid: null,
  tok: null,
  rumkode: null,
  lobby: null,
  profil: indlaesProfil(),

  verden: null,
  visning: null,
  transport: null,
  klient: null,

  sim: null,              // WorkerTransport — simulationens vært
  sidsteBitmaske: -1,
  oplader: false,
  opladFra: 0,
  seq: 0,
  markoerTilstand: false,
  markoer: { x: 0, y: 0, vinkel: 0, retning: 1 },
  pause: false,
  lyd: null,
};

/* ------------------------------------------------------------------ menu */

// Menuens baggrundsillustration males efter første billede, så menuen
// aldrig venter på den. Fejler den, står farveforløbet i CSS'en alene.
setTimeout(() => {
  malMenuScene().then((c) => c.toBlob((blob) => {
    if (blob) menuRod.style.setProperty('--menu-kunst', `url(${URL.createObjectURL(blob)})`);
  })).catch((e) => console.warn('[menu] illustration fejlede', e));
}, 30);

lyd.saetVolumen(S.profil?.indstillinger?.lyd ?? 0.7);
lyd.saetMusikVolumen(S.profil?.indstillinger?.musik ?? 1);
lyd.saetLydFra(!!S.profil?.indstillinger?.lydFra);
const saetUi = (v) => document.documentElement.style.setProperty('--ui', String(v));

/** Én lydindstilling ændret (fra HUD'ens knap): gem den og hold menuen i trit. */
function saetLydIndstilling(k, v) {
  S.profil.indstillinger = { ...(S.profil.indstillinger || {}), [k]: v };
  gemProfil(S.profil);
  menu.saetProfil(S.profil);
  if (k === 'lydFra') lyd.saetLydFra(v);
  else if (k === 'lyd') lyd.saetVolumen(v);
  else if (k === 'musik') lyd.saetMusikVolumen(v);
}
saetUi(S.profil?.indstillinger?.ui ?? 1);

const menu = lavMenu(menuRod, {
  startLokalt(profil) { S.profil = profil; startLokalRum(profil); },
  vaerRum(profil) { S.profil = profil; forbind(null, profil); },
  tilslutRum(kode, profil) { S.profil = profil; forbind(kode, profil); },
  tekstfelt(v) { tast.saetTekstfelt(v); },
  profilAendret(p) { S.profil = p; gemProfil(p); },
  lydAendret(v) { lyd.saetVolumen(v); lyd.afspil('klik'); },
  musikAendret(v) { lyd.saetMusikVolumen(v); },
  uiAendret(v) { saetUi(v); },

  saede(baeverId, tag) {
    S.transport?.send({ t: 'saede', d: { baever: baeverId, ejer: tag ? S.pid : null } });
  },
  indstilling(navn, v) {
    const d = {};
    if (navn === 'antalHold') d.hold = +v;
    else if (navn === 'vind') d.vind = v === '1';
    else if (['turtid', 'kamptid', 'baevere_pr_hold'].includes(navn)) d[navn] = +v;
    else d[navn] = v;
    S.transport?.send({ t: 'indst', d });
  },
  klar() {
    const mig = S.lobby?.deltagere.find((x) => x.pid === S.pid);
    S.transport?.send({ t: 'klar', d: { klar: !mig?.klar } });
  },
  start() { S.transport?.send({ t: 'start', d: {} }); },
  /** Random kamp: alt tilfældigt undtagen klinikker og kunder pr. klinik. */
  randomStart() {
    const valg = (l) => l[Math.floor(Math.random() * l.length)];
    const d = {
      turtid: valg([15, 20, 30, 45, 60]),
      kamptid: valg([600, 1200, 1800, 2700]),
      banetype: valg(BANE_TYPER),
      vejr: valg(['auto', ...VEJRTYPER]),
      vind: Math.random() < 0.75,
      bane: (Math.random() * 2 ** 31) >>> 0,
    };
    S.randomKamp = `🎲 Random kamp: ${BANE_NAVN[d.banetype]} · ${VEJR_NAVN[d.vejr]} · `
      + `${d.vind ? 'vind' : 'ingen vind'} · ${d.turtid} s pr. tur · ${d.kamptid / 60} min`;
    S.transport?.send({ t: 'indst', d });
    S.transport?.send({ t: 'start', d: {} });
  },
  fortsaet() { S.pause = false; S.pauseSlut = performance.now(); menu.skjul(); },
  spilIgen() {
    if (S.erVaert || !S.erNet) { S.transport?.send({ t: 'start', d: {} }); menu.skjul(); }
    else menu.vis('lobby', S.lobby);
  },
  forlad() { forladKamp(); },
});

menu.vis('start');

// Musikken følger tilstanden: menunummeret i menuen og lobbyen, kampnummeret
// under kampen, stille under sejren (vindersangen). Browsere tillader først
// lyd efter første tastetryk eller klik; så starter den af sig selv.
setInterval(() => {
  lyd.musik(S.tilstand === 'menu' || S.tilstand === 'lobby' ? 'musik_menu'
    : S.tilstand === 'spil' ? 'musik_kamp' : null);
}, 300);

// Kom vi ind via et delelink, springer vi direkte til rummet.
const dybtLink = location.pathname.match(/^\/spil\/([A-Za-z0-9]{5})\/?$/);
if (dybtLink) {
  menu.vis('forbinder');
  forbind(dybtLink[1].toUpperCase(), S.profil);
}

/* ------------------------------------------------------------------ rum */

function startLokalRum(profil) {
  S.erNet = false;
  S.erVaert = true;
  S.pid = 'p_lokal';
  const rum = lavLokaltRum(profil, {}, NAVNEPULJE);
  S.transport = new LoopbackTransport(rum);
  bindTransport();
  S.transport.send({ t: 'hej', d: { navn: profil.spillernavn || 'Spiller' } });
}

function forbind(kode, profil) {
  S.erNet = true;
  menu.vis('forbinder');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  S.transport = new WsTransport(`${proto}://${location.host}/ws`);
  bindTransport();

  const gemt = hentSession();
  S.transport.paaAaben(() => {
    S.transport.send({ t: 'hej', d: {
      navn: profil.spillernavn || 'Spiller',
      pid: gemt?.pid, tok: gemt?.tok, rum: gemt?.rum || kode,
    } });
  });
  S.ventendeKode = kode;
}

function bindTransport() {
  S.transport.paaBesked(paaBesked);
  S.transport.paaLuk(() => {
    if (S.erNet && S.tilstand === 'spil') hud?.net(T.net.mistet);
  });
}

function paaBesked(m) {
  switch (m.t) {
    case 'velkommen':
      S.pid = m.d.pid; S.tok = m.d.tok;
      if (S.erNet) {
        if (m.d.genfundet) hud?.net(T.net.genfundet, true);
        else if (S.ventendeKode) S.transport.send({ t: 'tilslut', d: { kode: S.ventendeKode, navn: S.profil.spillernavn || 'Spiller' } });
        else S.transport.send({ t: 'opret', d: { navn: S.profil.spillernavn || 'Spiller' } });
      }
      break;

    case 'rum':
      S.rumkode = m.d.kode;
      S.erVaert = m.d.vaert === S.pid;
      gemSession({ pid: S.pid, tok: S.tok, rum: S.rumkode });
      if (S.rumkode && location.pathname !== `/spil/${S.rumkode}`) {
        history.replaceState(null, '', `/spil/${S.rumkode}`);
      }
      break;

    case 'lobby':
      S.lobby = m.d;
      S.erVaert = m.d.vaert === S.pid;
      sendMitUdseende(m.d);
      if (S.tilstand !== 'spil') { S.tilstand = 'lobby'; menu.vis('lobby', m.d); }
      break;

    case 'start':
      startKamp(m.d);
      break;

    case 'fejl':
      // I menuen er HUD'en skjult — fejlen skal vises dér, man står.
      if (menu.skaerm === 'deltag' || menu.skaerm === 'lobby') menu.fejl(m.d.tekst);
      else hud?.banner(m.d.tekst, 3200, 'advarsel');
      break;

    case 'vaert_stille': hud?.net(T.net.vaertStille); break;
    case 'vaert_skiftet':
      S.erVaert = m.d.pid === S.pid;
      hud?.banner(T.net.vaertSkiftet(m.d.navn), 3000);
      break;
    case 'kamp_afbrudt':
      hud?.banner(m.d.grund || T.net.kampAfbrudt, 4000, 'advarsel');
      S.tilstand = 'lobby';
      lyd.stopAlleLoekker();
      lyd.stopStemme();
      break;
    case 'smidt_ud':
      alert(m.d.grund);
      forladKamp();
      break;
    case 'snap_bed':
      if (S.erVaert) S.sim?.send({ t: 'snap_bed', d: { pid: m.d?.pid } });
      break;
    case 'in':
      // En medspillers input. Kun værten har simulationen, så den skal derhen.
      if (S.erVaert) S.sim?.send({ t: 'in', d: { cmd: m.d, pid: m.f } });
      break;
    default:
      if (!S.erVaert && S.klient) S.klient.haandter(m);
      break;
  }
}

/** Mine sæder i lobbyen får mine egne kunders udseende fra profilen —
 *  ellers kommer alle ind i kampen uden kundetype. Sendes kun, når et
 *  sæde mangler det, så lobbyen ikke sender i ring. */
function sendMitUdseende(lobby) {
  const mine = (lobby.hold || []).flatMap((h) => h.baevere || []).filter((b) => b.ejer === S.pid);
  const kunder = S.profil?.baevere || [];
  mine.forEach((b, i) => {
    const u = kunder.length ? kunder[i % kunder.length].udseende : null;
    if (!u || b.udseende?.v === u.v && b.udseende?.figur === u.figur) return;
    S.transport?.send({ t: 'navngiv', d: { baever: b.id, udseende: u } });
  });
}

/* ------------------------------------------------------------------ kamp */

let hud = null;
let visning = null;

const fest = lavSejrsfest();
const intro = lavIntro(document.body);

/* Introen: kameraet viser hele banen, titlen slår ind, kunderne falder ned
 * fra himlen én ad gangen, og tallene tæller ned. "SÆT I GANG!" kommer, når
 * den første tur starter (turStart). */
function startIntro(vi) {
  S.introStartet = true;
  hudRod.classList.add('intro-aktiv');
  vi.kamera.kigPaaBanen(true);
  const alle = S.verden.baevere.slice().sort((a, b) => a.x - b.x);
  // Frit over hovedet (46 wu figur): under et fortdæk falder man kun fra loftet.
  const t = S.verden.terraen;
  const frit = (b) => { let y = Math.round(b.y) + 48; while (y < b.y + 400 && !t.fast(Math.round(b.x), y)) y++; return y - (b.y + 48); };
  alle.forEach((b, i) => vi.baevere.get(b.id)?.introFald(0.45 + i * (2.2 / Math.max(1, alle.length)), () => {
    lyd.afspil('landing', { vol: 0.8, tone: 0.85 + Math.random() * 0.3 });
    for (let k = 0; k < 6; k++) vi.fx.spor(b.x + (Math.random() - 0.5) * 22, b.y + 2);
  }, frit(b)));
  intro.start((n) => {
    if (n === 0) lyd.afspil('intro_slam', { vigtig: true });
    else lyd.afspil('nedtael', { tone: 1 + (3 - n) * 0.09, vigtig: true });
  });
}

function slutIntro() {
  if (!S.introStartet || S.introSlut) return;
  S.introSlut = true;
  if (intro.go()) lyd.afspil('kamp_start', { vol: 1.6, vigtig: true });
  visning?.kamera.kigPaaBanen(false);
  hudRod.classList.remove('intro-aktiv');
  if (S.randomKamp) {
    const tekst = S.randomKamp;
    S.randomKamp = null;
    setTimeout(() => hud?.banner(tekst, 3500), 2400);
  }
}

/** Stop en igangværende vinderfest — ny kamp eller tilbage til menuen. */
function slutFest() {
  clearTimeout(S.sangTimer);
  lyd.stopStemme();
  lyd.stopAlleLoekker();              // boret, flyvelyden og opladningen må ikke følge med ud
  intro.stop();
  hudRod.classList.remove('intro-aktiv');
  clearTimeout(S.festTimer);
  S.festTimer = null;
  S.jubler = null;
  S.sejrRes = null;
  fest.stop();
  hudRod.classList.remove('fest');
}

/** Festen er ovre (eller sprunget over): resultattavlen overtager. */
function visResultat() {
  if (!S.sejrRes) return;
  clearTimeout(S.festTimer);
  S.festTimer = null;
  fest.skjulTitel();
  menu.vis('sejr', S.sejrRes);
}

async function startKamp(opsaet) {
  slutFest();
  S.laegeKaldt = new Set();
  S.skudUde = null;
  S.introStartet = false;
  S.introSlut = false;
  S.tilstand = 'spil';
  S.pause = false;
  menu.skjul();
  indlaesRod.classList.remove('hide');
  indlaesRod.querySelector('.indl-tekst').textContent = T.spil.genererer;
  await giveSkaermTid();
  // Bæverne er prerenderet 3D; arkene skal være hentet, før de kan stables.
  await indlaesGrafik();

  const hold = opsaet.hold.map((h) => ({
    farve: h.farve, navn: h.navn,
    spillere: h.spillere || [],
    baevere: h.baevere.map((b) => ({ navn: b.navn, udseende: b.udseende, ejer: b.ejer })),
  }));

  const cfg = {
    turTicks: (opsaet.indst.turtid || 45) * HZ,
    kampTicks: (opsaet.indst.kamptid || 1800) * HZ,
    vind: opsaet.indst.vind !== false,
    vejr: opsaet.indst.vejr || 'auto',
    banetype: opsaet.indst.banetype || 'fort',
  };

  S.verden = lavVerden({ froe: opsaet.indst.bane >>> 0, banetype: cfg.banetype, hold, cfg });
  byggVisning();

  // Hovedtråden SIMULERER ALDRIG. Er vi vært, kører simulationen i en Worker;
  // er vi klient, kører den i værtens browser. I begge tilfælde er vi
  // modtager — og der findes derfor kun én kodesti for rendering og HUD.
  S.klient = lavKlient(S.verden, S.transport, bus);

  if (S.erVaert) {
    S.sim = new WorkerTransport();
    S.sim.paaBesked(fraSimulation);
    S.sim.send({ t: 'opsaet', d: { froe: opsaet.indst.bane >>> 0,
                                   banetype: cfg.banetype, hold, cfg } });
    holdFanenVaagen();
  } else {
    S.transport.send({ t: 'snap_bed', d: {} });
  }

  S.verden.favoritter = S.profil.favoritter;
  hud.byggFavoritter(S.profil.favoritter);
  indlaesRod.classList.add('hide');
  hjaelp.saetSynlig(true);

  const b = S.verden.aktivBaever() || S.verden.baevere[0];
  if (b) visning.kamera.snap(b.x, b.y + 60);

}

function byggVisning() {
  visning?.fjern?.();
  const v = S.verden;
  const rng = lavRng(v.froeBrugt ?? v.froe);

  hud = lavHud(hudRod, r);
  const ind = S.profil?.indstillinger || {};
  S.lydKnap = hud.lydKnap({
    fra: !!ind.lydFra, lyd: ind.lyd ?? 0.7, musik: ind.musik ?? 1,
    vedFra: (fra) => saetLydIndstilling('lydFra', fra),
    vedLyd: (v) => saetLydIndstilling('lyd', v),
    vedMusik: (v) => saetLydIndstilling('musik', v),
  });
  S.visHp = new Map();
  S.mineSek = new Map();
  hud.saetVisHp((b) => S.visHp.get(b.id)?.vist ?? b.hp);
  // HUD'en bygges pr. kamp, så dens klik skal kobles her.
  hud.paaVaelgVaaben((id) => vaelgVaaben(id));
  hud.paaArsenal(() => (panel.aaben ? panel.luk() : aabnArsenal()));
  const terraen = lavTerraenView(r.scene, v.terraen, v.froeBrugt ?? v.froe);
  const pynt = lavPyntView(r.scene, v.terraen, terraen.overflader, v.froeBrugt ?? v.froe);
  const parallaks = lavParallaks(r.scene, r.kamera, v.terraen, rng, v.vejr);
  const vejr = lavVejr(r.scene, r.kamera, rng);
  const vand = lavVand(r.scene, v.terraen);
  const fx = lavFx(r.scene, r.kamera);
  const projektiler = lavProjektilView(r.scene, fx);
  const genstande = lavGenstandView(r.scene);
  const sigte = lavSigte(r.scene);
  const kamera = lavKamera(r, v.terraen);
  const debug = lavDebug(r.scene, v.terraen);
  const sorteHuller = lavSorteHuller(r.scene);

  const baevere = new Map();
  for (const b of v.baevere) baevere.set(b.id, lavBaeverView(r.scene, b, b.hold, v.terraen));

  parallaks.saetVejr(v.vejr);
  vejr.saetType(v.vejr);

  visning = {
    terraen, pynt, parallaks, vejr, vand, fx, projektiler, genstande, sigte, kamera, debug, baevere, sorteHuller,
    fjern() {
      sorteHuller.fjern();
      terraen.fjern(); pynt.fjern(); parallaks.fjern(); vejr.fjern(); vand.fjern();
      fx.fjern(); projektiler.fjern(); genstande.fjern(); sigte.fjern(); debug.fjern();
      for (const [, bv] of baevere) bv.fjern();
      hud?.ryd();
    },
  };
  S.visning = visning;
  koblHaendelser();
}

/** Hændelser fra simulationen -> partikler, rystelser og bannere.
 *  Præsentationen abonnerer; den skriver aldrig tilbage. */
function koblHaendelser() {
  bus.ryd();
  bus.paa('eksplosion', (e) => {
    visning.fx.eksplosion(e.x, e.y, e.radius);
    const k = r.kamera.position;
    const afstand = Math.hypot(e.x - k.x, e.y - k.y);
    visning.kamera.rystelse(Math.min(1, e.radius / 60), afstand);
    // Én lyd pr. brag: det dybe drøn for de store, nedslaget for de små. Med
    // forrang, så affyringslyden ikke længere overdøver eksplosionen.
    const rum = rumlig(e.x, e.y, 2400);
    lyd.afspil(e.radius >= 40 ? 'brag' : 'nedslag', {
      vol: 0.35 + 0.65 * rum.vol, pan: rum.pan, forrang: true,
      tone: (e.radius >= 40 ? 0.85 : 0.9) + Math.random() * 0.2,
    });
  });
  bus.paa('skudAffyret', (e) => {
    const b = S.verden.baevere.find((x) => x.id === e.baever);
    const w = VAABEN[e.vaaben];
    const bv = b && visning.baevere.get(b.id);
    // Våben med flere skud pr. ammo (scanneren): husk, at turens ammo er betalt.
    if (w?.brugPrTur > 1) S.betalt = { turNr: S.verden.tur.turNr, vaaben: e.vaaben };
    // Kun det, der faktisk skyder, får mundingsglimt og rekyl. Klasket er et
    // slag, minen lægges, fakturaerne regner ned — og opdateringen er en stråle.
    if (b && ['ballistisk', 'klynge', 'hitscan'].includes(w?.arketype) && e.vaaben !== 'daemningsdynamit') {
      const m = mundingsPunkt(b);
      visning.fx.muzzle(m.x, m.y, m.dx, m.dy);
      bv?.rekylSkud();
    }
    if (w?.arketype === 'naerkamp') bv?.slag();
    if (w?.arketype === 'luftangreb') {
      visning.fx.fakturaRegn(e.x, e.retning ?? b?.retning ?? 1);
      hud.banner('KVARTALSOPKRÆVNING!', 1800, 'advarsel');
    }
    // Brugerens egne våbenlyde; resten er kontorlyde fra "400 Sounds Pack".
    const variation = { tone: 0.95 + Math.random() * 0.1 };
    const egen = {
      grenroer: 'stemme_kanon_lyd', splintboesse: 'stemme_skud',
      egegranat: 'stemme_granat', koglebombe: 'stemme_granat',
      halesmaek: Math.random() < 0.5 ? 'stemme_slag' : 'stemme_slag_2',
    }[e.vaaben];
    const kontor = {
      daemningsdynamit: 'opdatering_skud', baevermine: 'mine_laeg', papirbunke: 'papir_kast',
      covid: 'covid_host',
    }[e.vaaben];
    // Faxen er 9,5 s lang; den må ikke holde kanalen, mens fakturaerne slår ned.
    if (e.vaaben === 'traestammeregn') lyd.afspil('stemme_fax', { vol: 0.85, maksSek: 2.5 });
    else if (egen) lyd.afspil(egen, { ...variation, vol: 0.9 });
    else lyd.afspil(kontor || 'kast', { ...variation, vol: kontor?.startsWith('opdatering') ? 2 : 1.2 });
    // Et skud er ude: rammer det ingen, griner kunderne, når turen skifter.
    // Ét pr. tur — scannerens andet skud må ikke glemme, at det første ramte.
    S.skudUde ||= { ramte: false };
  });
  bus.paa('doedsfald', (e) => {
    hud.banner(`${e.navnTekst} har lagt på`, 1800);
    const b = S.verden.baevere.find((x) => x.id === e.baever);
    if (!b?.drukner) {
      // FEJL 40: kunden suges ind i et sort hul, før liget smælder — fejllyden
      // først, så "Død" og jublen fra den, der fik ram på kunden (i kø).
      visning.baevere.get(e.baever)?.absorber();
      visning.sorteHuller.start(e.x, e.y + 22);
      lyd.afspil('sort_hul', { vol: 1.4, vigtig: true });
      lyd.stemme('stemme_doed', { vigtig: true });
      lyd.stemme('stemme_kill', { vigtig: true });
    }
  });
  bus.paa('drukner', (e) => {
    visning.fx.plask(e.x, e.y); lyd.afspil('plask');
    lyd.stemme('stemme_faldt_i_vandet', { vigtig: true });
  });
  bus.paa('pludseligDoed', () => hud.banner(T.spil.pludseligDoed, 3000, 'advarsel'));
  bus.paa('turStart', (e) => {
    const b = S.verden.baevere.find((x) => x.id === (e.baever ?? S.verden.tur.baeverId));
    // Kameraet SKAL finde den nye hovedperson, også hvis man stod og
    // panorerede frit rundt, da turen skiftede.
    slutIntro();
    if (b) visning.kamera.fokus(b);
    const mit = b && erMin(b);
    // Kundernes replikker ved turskiftet. Et skud, der ikke ramte nogen,
    // bliver grinet ad først; så kommer turen.
    if (S.skudUde && !S.skudUde.ramte) lyd.stemme('stemme_ha_ha', { chance: 0.5 });
    S.skudUde = null;
    if (e.turNr === 1 || S.verden.tur.turNr === 1) {
      // Efter introens fanfare, ikke oven i den.
      setTimeout(() => lyd.stemme('stemme_saet_i_gang', { vigtig: true }), 450);
    }
    else if (mit) {
      lyd.stemme(['stemme_det_er_din_tur', 'stemme_det_er_din_tur_2', 'stemme_det_er_din_tur_3'], { chance: 0.35 });
    } else lyd.stemme('stemme_provokation', { chance: 0.25 });
    hud.banner(mit ? T.spil.dinTur : `${T.spil.turFor} ${b ? b.navn : ''}`, 2300);
    // Introen skal først komme, når spilleren faktisk har kontrollen — ellers
    // læser man den, mens en anden er i gang, og har glemt den bagefter.
    if (mit) hjaelp.foersteTur();
  });
  bus.paa('sejr', (res) => {
    // Værten får afgørelsen ad to veje (sin egen klient og workeren); kun
    // den første tæller.
    if (S.tilstand !== 'spil') return;
    S.tilstand = 'sejr';
    S.oplader = false;
    S.markoerTilstand = false;
    S.sejrRes = res;
    lyd.stopAlleLoekker();
    lyd.stopStemme();
    panel.aaben && panel.luk?.();
    hjaelp.ryd();
    hjaelp.saetSynlig(false);
    hudRod.classList.add('fest');

    const v = S.verden;
    const harVinder = res.vinder !== null && res.vinder !== undefined;
    const vindere = harVinder ? v.baevere.filter((b) => b.hold === res.vinder && !b.doed) : [];
    S.jubler = new Set(vindere.map((b) => b.id));

    // Kameraet finder vinderne og går tæt på.
    if (vindere.length) {
      const midt = vindere.reduce((s, b) => s + b.x, 0) / vindere.length;
      const naermest = vindere.reduce((a, b) => Math.abs(b.x - midt) < Math.abs(a.x - midt) ? b : a);
      visning.kamera.friTilstand(false);
      visning.kamera.fokus(naermest);
      visning.kamera.zoomInd();
    }

    const f = harVinder ? holdFarve(res.vinder) : null;
    // Vandt DU? Over nettet: er du på vinderholdet. Ved ét tastatur sidder
    // vinderen ved skærmen, så det er altid "du".
    const mig = harVinder && (!S.erNet || v.baevere.some((b) => b.hold === res.vinder && erMin(b)));
    fest.start({
      farverCss: f ? [f.css] : [],
      overskrift: mig ? 'DU HAR VUNDET!' : f ? T.spil.sejr(f.navn) : T.spil.uafgjort,
      undertekst: mig ? T.spil.sejr(f.navn)
        : vindere.length ? `${vindere.map((b) => b.navn).join(' · ')} fik ret til sidst` : '',
      uafgjort: !f,
      mig,
    });
    // Fanfaren først, så vindersangen — de må ikke lyde oven i hinanden.
    lyd.afspil(mig ? 'du_vandt' : f ? 'tabt' : 'sejr', { vol: mig ? 2 : 1, vigtig: true });
    if (f) S.sangTimer = setTimeout(() => {
      const sang = Math.random() < 0.5 ? 'stemme_vindersangen' : 'stemme_vindermusik_2';
      if (S.tilstand === 'sejr') lyd.stemme(sang, { vigtig: true });
    }, 1150);
    S.festTimer = setTimeout(visResultat, f ? 6500 : 2800);
  });
  bus.paa('kasseFalder', (e) => {
    if (e.slags !== 'vaaben') return;              // telefon og piller har egne bannere
    hud.banner('Forsyningskasse på vej!', 1600);
    const rum = rumlig(e.x, e.y, 2400);
    lyd.afspil('kasse_falder', { vol: 0.5 + 0.8 * rum.vol, pan: rum.pan });
  });
  bus.paa('telefonRinger', () => hud.banner('Telefonen ringer — tag røret!', 1800));
  bus.paa('telefonOpkald', (e) => {
    const o = OPKALD[e.opkald];
    if (!o) return;
    const foelge = {
      forstaerkning: () => `+${e.antal} ${VAABEN[e.vaaben]?.navn || 'våben'}`,
      recept: () => (e.hp > 0 ? `+${e.hp} tålmodighed` : 'Tålmodigheden er allerede fuld'),
      klage: () => '−15 tålmodighed',
      mursten: () => 'Mursten på vej!',
      uvejr: () => 'Uvejr — pas på vinden',
      spam: () => `${e.antal} phishing-miner er dukket op`,
      viderestil: () => 'Du er blevet stillet videre …',
    }[o.effekt]?.() || '';
    hud.opkaldBoble(e.x, e.y, o.navn, o.tekst, foelge, r);
    // Røret tages: ringningen stopper, så telefonlyden og sekretæren — efter hinanden.
    if (S.ringLyd) { lyd.stopStemme(); S.ringLyd = null; }
    lyd.afspil('stemme_telefonlyd_til_event', { vol: 0.9, maksSek: 4, vigtig: true });
    lyd.stemme('stemme_sekretaer_lyd', { vigtig: true });
  });
  bus.paa('hændelse', (e) => hud.banner(e.tekst, 3200, 'advarsel'));

  // ---- fuldtræffer: skal kunne MÆRKES — banner, ekstra rystelse og et knald.
  bus.paa('fuldtraeffer', (e) => {
    const b = S.verden.baevere.find((x) => x.id === e.baever);
    // Tallet kommer først, når skuddet er afviklet (se taelSkade).
    hud.banner(`FULDTRÆFFER! ${b ? b.navn : ''}`, 1500, 'advarsel');
    visning.kamera.rystelse(0.6, 0);
    // Ingen lyd her: braget kommer med eksplosionen lige efter (med forrang).
    lyd.stemme('stemme_meget_skade', { chance: 0.6 });
  });

  // ---- rene lydhændelser. Præsentationen lytter; den skriver aldrig tilbage.
  bus.paa('hop', () => lyd.afspil('hop'));
  bus.paa('salto', () => lyd.afspil('salto'));
  bus.paa('skade', (e) => {
    // Et fald lander tungt; COVID hoster; alt andet er et slag.
    const slags = e.aarsag === 'fald' ? 'tungt_fald' : e.aarsag === 'covid' ? 'covid_host' : 'skade';
    lyd.afspil(slags, { tone: 0.92 + Math.random() * 0.16 });
    if (S.skudUde) S.skudUde.ramte = true;
    if (e.skade >= 30) lyd.stemme('stemme_meget_skade', { chance: 0.5 });
    else lyd.stemme('stemme_av', { chance: 0.3 });
    // Er kunden hårdt ramt, men i live, kalder den på en læge — én gang.
    setTimeout(() => {
      const b = S.verden?.baevere.find((x) => x.id === e.baever);
      if (!b || b.doed || b.hp > 25 || S.laegeKaldt?.has(b.id)) return;
      (S.laegeKaldt ||= new Set()).add(b.id);
      lyd.stemme('stemme_er_det_en_laege_til_stede', { chance: 0.7 });
    }, 350);
  });
  bus.paa('staaOver', () => lyd.stemme('stemme_provokation', { chance: 0.6 }));
  bus.paa('kasseSamlet', (e) => {
    lyd.afspil(e.slags === 'helbred' ? 'piller' : e.slags === 'vaaben' ? 'vaaben_samlet' : 'kasse_samlet');
    if (e.slags === 'vaaben') {
      const b = S.verden.baevere.find((x) => x.id === e.baever);
      hud.banner(`${b ? b.navn + ': ' : ''}+${e.antal ?? 1} ${VAABEN[e.indhold]?.navn || 'våben'}`, 1800);
    }
    if (e.slags === 'helbred') {
      const b = S.verden.baevere.find((x) => x.id === e.baever);
      if (b) {
        hud.helbredTal(b, e.indhold, r);
        hud.banner(e.indhold > 0 ? `${b.navn} tog pillerne: +${e.indhold} tålmodighed` : `${b.navn} er allerede frisk`, 1800);
      }
    }
  });
  bus.paa('pillerDukketOp', () => hud.banner('Piller på banen — +50 tålmodighed', 1800));
  bus.paa('printerSprang', () => hud.banner('Printeren gik i stykker — igen!', 1800, 'advarsel'));
  bus.paa('vaabenValgt', (e) => {
    lyd.afspil('vaabenskift');
    // "Tonerkanon!" når den tages frem — ikke oven i kanonlyden ved skuddet.
    if (e.vaaben === 'grenroer') lyd.stemme('stemme_tonerkanon', { chance: 0.5 });
  });
  bus.paa('terraenBygget', (e) => {
    // Papiret dumper ned; rampen og skummet bygges. Én lyd, gennem kanalen.
    lyd.afspil(e.slags === 'papir' ? 'papir_land' : e.slags === 'skum' ? 'skum' : 'metal', { vol: e.slags === 'rampe' ? 2 : 1 });
    if (e.slags === 'rampe') hud.banner('Kabelbakken er lagt — gå op ad den', 1400);
  });
  bus.paa('teleport', (e) => {
    visning.fx.teleport(e.fraX, e.fraY, e.x, e.y);
    lyd.afspil('teleport', { vol: 1.6 });
  });
  bus.paa('teleportAfvist', () => {
    hud.banner('Fjernsupport kan ikke nå derhen — vælg et andet sted', 1800, 'advarsel');
    lyd.afspil('teleport_afvist', { vol: 1.5 });
  });
  bus.paa('lunteSat', () => lyd.afspil('klik'));
  bus.paa('redskabStart', (e) => {
    if (e.slags !== 'bor') return;
    lyd.afspil('stemme_systemnedbrud', { vol: 0.9 });
    if (S.verden.baevere.find((x) => x.id === e.baever && erMin(x))) {
      hud.banner('Styr med piletasterne · mellemrum stopper', 2200);
    }
  });
  bus.paa('klyngeDelt', () => lyd.afspil('inferno_delt'));

  // ---- Stregkodescanneren og Tvangsopdateringen: strålen skal SES.
  bus.paa('straale', (e) => {
    const opdatering = e.vaaben === 'daemningsdynamit';
    if (e.traf && S.skudUde) S.skudUde.ramte = true;
    visning.fx.straale(e.x0, e.y0, e.x1, e.y1, { traf: e.traf, farve: opdatering ? 'blaa' : 'roed' });
    if (e.traf && !opdatering) {
      visning.kamera.rystelse(0.35, 0);
      visning.fx.pop('BIP!', e.x1, e.y1 + 24, { farve: 'roed', str: 34 });
    }
  });
  bus.paa('opdateringRamt', (e) => {
    if (S.skudUde) S.skudUde.ramte = true;
    const b = navnPaa(e.baever);
    visning.fx.pop('GENSTART!', e.x, e.y + 70, { farve: 'blaa', str: 32 });
    hud.banner(`${b} skal installere opdateringer — springer næste tur over`, 2600, 'advarsel');
    lyd.afspil('opdatering_ramt', { vol: 1.8 });
  });
  bus.paa('turSprungetOver', (e) => {
    hud.banner(`${navnPaa(e.baever)} installerer stadig opdateringer … turen springes over`, 2600);
    lyd.afspil('opdatering_faerdig', { vol: 1.8, vigtig: true });
  });

  // ---- Klageklask: slaget rammer lidt efter svinget.
  bus.paa('klask', (e) => {
    if (!e.maal?.length) return;
    visning.fx.klask(e.x, e.y, e.retning ?? 1);
    visning.kamera.rystelse(0.45, 0);
    lyd.afspil('klask_ramt', { forrang: true });
    if (S.skudUde) S.skudUde.ramte = true;
  });

  // ---- Hjemmearbejde: kraftfeltet.
  bus.paa('skjoldOp', (e) => {
    visning.fx.skjoldOp(e.x, e.y);
    hud.banner(`${navnPaa(e.baever)} arbejder hjemmefra — isoleret til næste tur`, 2200);
    lyd.afspil('skjold_op', { vol: 1.3 });
  });
  bus.paa('skjoldBlok', (e) => {
    visning.fx.skjoldBlok(e.x, e.y);
    visning.baevere.get(e.baever)?.skjoldRamt();
    visning.fx.pop('ISOLERET!', e.x, e.y + 62, { farve: 'cyan', str: 26 });
    if (S.skudUde) S.skudUde.ramte = true;
    // Kommer blokeringen med en eksplosion, tager braget kanalen i samme tick;
    // glasklangen kommer derfor lige efter.
    setTimeout(() => lyd.afspil('skjold_blok'), 420);
  });
  bus.paa('skjoldSlut', () => lyd.afspil('skjold_slut'));

  // ---- COVID.
  bus.paa('covidSky', (e) => {
    visning.fx.covidSky(e.x, e.y, e.r);
    const rum = rumlig(e.x, e.y, 2400);
    lyd.afspil('covid_sky', { vol: 1.2 * (0.5 + 0.5 * rum.vol), pan: rum.pan, forrang: true });
  });
  bus.paa('smittet', (e) => {
    if (S.skudUde) S.skudUde.ramte = true;
    visning.fx.pop('SMITTET!', e.x, e.y + 64, { farve: 'groen', str: 26 });
    hud.banner(e.fra != null ? `${navnPaa(e.fra)} smittede ${navnPaa(e.baever)} med COVID`
      : `${navnPaa(e.baever)} er smittet med COVID`, 2000, 'advarsel');
    lyd.afspil('covid_host', { vol: 1.5 });
  });
  bus.paa('rask', (e) => hud.banner(`${navnPaa(e.baever)} er rask igen`, 1800));
}

const navnPaa = (id) => S.verden?.baevere.find((x) => x.id === id)?.navn ?? 'Kunden';

const erMin = (b) => !S.erNet || b.ejer === S.pid ||
  (!b.ejer && S.verden.pidPaaHold(S.pid, b.hold));

/* ------------------------------------------------------------------ løkke */

/** Giv browseren en chance for at male indlæsningsskærmen.
 *
 *  Bevidst setTimeout og IKKE requestAnimationFrame: i en skjult fane kan rAF
 *  være fuldstændig suspenderet, og så ville opstarten hænge for evigt for
 *  enhver der starter en kamp og skifter fane. setTimeout struber, men fyrer. */
function giveSkaermTid() { return new Promise((res) => setTimeout(res, 0)); }

/** Beskeder fra simulations-Workeren.
 *  Vi anvender dem som enhver anden klient — og relæer dem videre til
 *  medspillerne, hvis vi er vært for et netværksrum. */
let stTaeller = 0;
function fraSimulation(m) {
  // Klienten sender hændelserne videre på bussen (også 'slut' som 'sejr') —
  // de må ikke sendes her igen.
  S.klient?.haandter(m);
  // Workeren sender tilstand med 60 Hz, så værtens egen skærm er flydende.
  // Over netværket er 20 Hz rigeligt — klienterne interpolerer — så kun
  // hver tredje 'st' videresendes (pålidelige beskeder går altid igennem).
  if (m.t === 'st' && (stTaeller++ % 3) !== 0) return;
  if (S.erNet && S.erVaert && m.t !== 'klar') S.transport?.send(m);
}

function kraevFrame() {
  requestAnimationFrame(loop);
}

let sidsteTid = performance.now();

function loop(nu) {
  kraevFrame();
  const dt = Math.min(0.25, (nu - sidsteTid) / 1000);
  sidsteTid = nu;

  if ((S.tilstand === 'spil' || S.tilstand === 'sejr') && S.verden) {
    // rAF driver KUN rendering. Simulationen har sit eget faste tidsskridt i
    // Workeren og fortsætter uanset om fanen er synlig.
    S.klient?.interpoler();
    opdaterVisning(dt, nu / 1000);
  }
  r.tegn();
}

/* Kamera og flyvelyd følger skuddet: det nyeste projektil i luften, fra
 * mundingen til nedslaget. Efter nedslaget bliver kameraet hængende et
 * øjeblik over krateret, før det vender tilbage til den aktive kunde.
 * Projektilet slås op på id hver frame — spejlets objekter kan udskiftes
 * af et snapshot undervejs. */
const NEDSLAG_HOLD_MS = 1500;
const RING_RAEKKEVIDDE = 1100;       // wu: længere væk end det høres telefonen ikke

/**
 * Lyd i rummet: hvor højt (0-1) og hvor i stereo en lyd ved (x, y) skal lyde.
 * Lytteren er kameraet — eller den aktive kunde, hvis den er tættere på.
 */
function rumlig(x, y, raekkevidde = RING_RAEKKEVIDDE) {
  const k = r.kamera.position;
  const akt = S.verden?.aktivBaever();
  const d = Math.min(Math.hypot(x - k.x, y - k.y), akt && !akt.doed ? Math.hypot(x - akt.x, y - akt.y) : Infinity);
  const naer = Math.max(0, 1 - d / raekkevidde);
  const halv = Math.max(200, (r.kamera.right - r.kamera.left) / 2);
  return { vol: naer * naer, pan: Math.max(-0.8, Math.min(0.8, (x - k.x) / halv)) };
}
const RAKETTER = new Set(['gren']);           // fakturaerne flagrer, de brøler ikke

function foelgSkud(v, vi) {
  const nu = performance.now();
  if (S.tilstand !== 'spil') { lyd.flyvelyd(null); return; }
  let p = S.skudId != null ? v.projektiler.find((x) => x.id === S.skudId) : null;
  if (!p && v.projektiler.length) {
    p = v.projektiler.reduce((a, b) => (b.id > a.id ? b : a));
    S.skudId = p.id;
  }
  if (p) {
    S.nedslag = { x: p.x, y: p.y };
    S.nedslagTid = 0;
    vi.kamera.foelgSkud(p);
    lyd.flyvelyd(p.sover ? null : { vx: p.vx, vy: p.vy, raket: RAKETTER.has(p.sprite), tumler: !RAKETTER.has(p.sprite) });
    return;
  }
  lyd.flyvelyd(null);
  if (S.skudId != null) {
    // Skuddet er lige slået ned: hold over nedslaget.
    S.skudId = null;
    S.nedslagTid = nu;
    vi.kamera.foelgSkud(S.nedslag);
  } else if (S.nedslagTid && nu - S.nedslagTid > NEDSLAG_HOLD_MS) {
    S.nedslagTid = 0;
    if (vi.kamera.foelgerSkud) {
      const akt = v.aktivBaever();
      if (akt && !akt.doed) vi.kamera.fokus(akt); else vi.kamera.slipSkud();
    }
  }
}

/*
 * Skaden afsløres som i Worms: mens skuddet, eksplosionerne og flugten står
 * på, viser kunden sin gamle tålmodighed. Når verden er faldet til ro,
 * reagerer den ramte, et rødt tal popper op, og tælleren løber ned til det
 * nye tal. Kun præsentation — simulationen har trukket skaden med det samme.
 */
const UROLIG = new Set(['affyring', 'oploesning']);
function taelSkade(v, vi, nu) {
  const roligt = !UROLIG.has(v.tur.tilstand);
  for (const b of v.baevere) {
    let e = S.visHp.get(b.id);
    if (!e) { e = { vist: b.hp }; S.visHp.set(b.id, e); }
    if (b.hp > e.vist && !e.t) { e.vist = b.hp; continue; }     // helbredt: med det samme
    if (!e.t && b.hp < e.vist && roligt) {
      e.t = { fra: e.vist, til: b.hp, start: nu,
              varighed: Math.min(2200, 900 + (e.vist - b.hp) * 18) };
      hud.skadeTal(b, e.vist - Math.max(0, b.hp), r);
      lyd.afspil('skade', { vol: 0.7 });
      hud.markerRamt(b.id, true);
      vi.baevere.get(b.id)?.ramt?.();
    }
    if (e.t) {
      if (b.hp < e.t.til) e.t.til = b.hp;                        // mere skade undervejs
      const k = Math.min(1, (nu - e.t.start) / e.t.varighed);
      const blød = 1 - Math.pow(1 - k, 2);
      const foer = e.vist;
      e.vist = Math.round(e.t.fra + (e.t.til - e.t.fra) * blød);
      // Tællerens tik: hvert 3. point, og tonen falder, mens tallet gør.
      if (Math.floor(foer / 3) !== Math.floor(e.vist / 3) && nu - (S.sidsteTik || 0) > 40) {
        S.sidsteTik = nu;
        lyd.afspil('tael', { tone: 1.25 - 0.45 * blød });
      }
      if (k >= 1) { e.vist = e.t.til; e.t = null; hud.markerRamt(b.id, false); }
    }
  }
}

function opdaterVisning(dt, tid) {
  const v = S.verden;
  const vi = visning;

  // Skridtene: ét fodtrin på kontortæppet ad gangen, i takt med gangen
  // (0,3 s). Gennem den fælles kanal, så de tier, når noget andet lyder.
  // Og en svag ambience under hele kampen.
  const aktLyd = v.aktivBaever();
  const gaar = !!(S.tilstand === 'spil' && !S.pause && aktLyd && !aktLyd.doed && aktLyd.paaJorden && !aktLyd.graver &&
                  (tast.nede('venstre') || tast.nede('hoejre')) && !panel.aaben && !S.markoerTilstand);
  if (gaar && performance.now() - (S.sidsteSkridt || 0) > 300) {
    S.sidsteSkridt = performance.now();
    lyd.afspil('fodtrin', { tone: 0.94 + Math.random() * 0.12 });
  }
  lyd.loop('ambience', S.tilstand === 'spil', 0.12);
  // Løber tiden ud midt i en opladning, slutter opladningen med turen.
  if (S.oplader) {
    const akt = v.aktivBaever();
    if (!akt || !erMin(akt) || v.tur.tilstand !== TIL.SPILLER_AKTIV) S.oplader = false;
  }
  lyd.ladelyd(S.tilstand === 'spil' && S.oplader ? lokalKraft() : null,
              ((v.vaabenNu()?.kraft?.opladTid ?? 63) / HZ));

  const snavs = vi.terraen.opdater();
  if (snavs) vi.pynt.ramt(snavs);
  vi.pynt.opdater(tid, v.vindNu());
  vi.terraen.saetVand(v.vandNiveau);
  vi.vand.opdater(v.vandNiveau, tid);
  vi.vejr.saetType(v.vejr);
  vi.vejr.opdater(tid, v.vindNu());
  vi.parallaks.saetVejr(v.vejr);

  // Kamerastyring
  // Under introen viser kameraet hele banen; ellers kun mens H holdes.
  vi.kamera.kigPaaBanen(tast.nede('kig') || (S.introStartet && !S.introSlut));
  const pan = 900 * dt;
  let panX = 0, panY = 0;
  if (tast.nede('panVenstre')) panX -= pan;
  if (tast.nede('panHoejre')) panX += pan;
  if (tast.nede('panOp')) panY += pan;
  if (tast.nede('panNed')) panY -= pan;
  if (panX || panY) { vi.kamera.friTilstand(true); vi.kamera.panorer(panX, panY); }

  if (!S.introStartet && v.tur.tilstand === TIL.UDSAET) startIntro(vi);
  foelgSkud(v, vi);
  taelSkade(v, vi, performance.now());
  vi.sorteHuller.opdater(dt);
  vi.kamera.opdater(dt);
  vi.parallaks.opdater(tid, v.vindNu());
  vi.fx.opdater(dt, r.renderer.domElement.height / (r.kamera.top - r.kamera.bottom));
  vi.projektiler.opdater(v.projektiler);
  vi.genstande.opdater(v.kasser, v.placerede, v.gravsten, v.terraen);
  // Telefonerne ringer i takt med deres animation; tættere på lyder højere.
  const nuS = performance.now() / 1000;
  for (const k of v.kasser) {
    if (k.slags !== 'telefon') continue;
    const ringer = telefonRinger(k.id, nuS);
    // Ringelyden følger afstanden: svag langt væk, højere jo tættere kameraet
    // eller den aktive kunde kommer — også mens den ringer. Højst hvert 7. s.
    const rum = rumlig(k.x, k.y);
    if (ringer && !S.ringer?.has(k.id) && S.tilstand === 'spil') {
      if (rum.vol > 0.02 && performance.now() - (S.sidsteRing || 0) > 7000) {
        const h = lyd.afspil('stemme_telefonlyd_til_event', { vol: 0.9 * rum.vol, pan: rum.pan, maksSek: 4 });
        if (h) { S.sidsteRing = performance.now(); S.ringLyd = { h, id: k.id }; }
      }
    }
    if (S.ringLyd?.id === k.id) lyd.justerLyd(S.ringLyd.h, { vol: 0.9 * rum.vol, pan: rum.pan });
    (S.ringer ||= new Set())[ringer ? 'add' : 'delete'](k.id);
  }
  // Phishing-minerne bipper langsomt, mens de armerer (ét bip i sekundet,
  // i takt med tallet på minen), og melder, når de er skarpe. Tæt på lyder
  // de højere; langt væk høres de ikke.
  const mineSek = (S.mineSek ||= new Map());
  for (const p of v.placerede) {
    if (p.sprite !== 'mine') continue;
    const sek = mineSekund(p.armerRest || 0), foer = mineSek.get(p.id);
    mineSek.set(p.id, sek);
    if (foer === undefined || foer === sek || S.tilstand !== 'spil') continue;
    const rum = rumlig(p.x, p.y, 900);
    if (rum.vol < 0.03) continue;
    lyd.afspil(sek > 0 ? 'mine_bip' : 'mine_armeret', { vol: (sek > 0 ? 1.8 : 2.2) * rum.vol, pan: rum.pan, forrang: true });
  }
  // Systemnedbrud: boret summer (støvet fra spidsen kommer i figurløkken).
  const borer = v.baevere.find((b) => b.graver && !b.doed);
  const borRum = borer ? rumlig(borer.x, borer.y, 1400) : null;
  lyd.loop('bor', !!borer && S.tilstand === 'spil', borRum ? 1.1 * (0.3 + 0.7 * borRum.vol) : 0);
  const medGrav = new Set(v.gravsten.map((g) => g.baever));

  for (const b of v.baevere) {
    let bv = vi.baevere.get(b.id);
    if (!bv) { bv = lavBaeverView(r.scene, b, b.hold, v.terraen); vi.baevere.set(b.id, bv); }
    b.gaar = b.id === v.tur.baeverId && (tast.nede('venstre') || tast.nede('hoejre'));
    bv.opdater(b, dt, medGrav.has(b.id), !!S.jubler?.has(b.id));
    const spids = bv.boreSpids();                 // kun mens der bores
    if (spids) vi.fx.boreStoev(spids.x, spids.y, spids.dx, spids.dy);
  }

  // Sigte: den forudsagte bane plus en kraftbue om bæveren.
  const akt = v.aktivBaever();
  const visSigte = akt && !akt.doed && !akt.graver && erMin(akt) &&
                   (v.tur.tilstand === TIL.SPILLER_AKTIV || S.oplader);
  if (visSigte) {
    const m = mundingsPunkt(akt);
    const w = v.vaabenNu();
    const kraft = lokalKraft();
    if (S.profil?.indstillinger?.sigteassistent) {
      // Valgfri sigtehjælp: hele banekurven med vind og vejr indregnet.
      vi.sigte.vis(m.x, m.y, m.dx, m.dy, kraft, {
        min: w?.kraft?.min ?? 240,
        maks: w?.kraft?.maks ?? w?.kraft?.max ?? 800,
        vind: v.vindNu(),                     // effektiv vind, med vindstød
        vindFaktor: w?.projektil?.vindFaktor ?? 1,
        modstand: luftmodstand(v.vejr),
        terraen: v.terraen,
      });
    } else {
      // Standard: kun et sigtekorn i sigteretningen. Kraft og vind må man
      // selv vurdere — det er spillet.
      vi.sigte.visSigtekorn(m.x, m.y, m.dx, m.dy, tid);
    }
    vi.sigte.visKraft(akt.x, akt.y + 34, akt.retning, S.oplader ? kraft : 0);
  } else vi.sigte.skjul();

  // Kanonrøret følger sigtet for den aktive enhed; de andre holder hvilestilling.
  for (const [id, bv] of vi.baevere) {
    const holder = akt && id === akt.id && !akt.doed &&
                   (v.tur.tilstand === TIL.SPILLER_AKTIV || S.oplader);
    if (holder) { const m = mundingsPunkt(akt); bv.visVaaben(v.vaabenNu()?.id, m.dx, m.dy); }
    else bv.visVaaben(null);
  }

  ryddMarkoer();
  if (S.markoerTilstand) vi.sigte.visMarkoer(S.markoer.x, S.markoer.y);
  else vi.sigte.skjulMarkoer();

  vi.debug.opdater();

  const tilstandTekst = v.tur.tilstand === TIL.UDSAET ? T.spil.udsaetter : null;
  const aktNu = v.aktivBaever();
  const minTur = !!(aktNu && erMin(aktNu));
  // Brugte man sidste Hjemmearbejde eller Kabelbakke, står man med et tomt
  // våben i hånden og turen fortsætter: sig det, én gang.
  // (Scannerens andet skud er betalt, selv om tallet viser 0 — den tier vi om.)
  if (minTur && v.tur.tilstand === TIL.SPILLER_AKTIV && !aktNu.graver && v.ammoFor(aktNu.hold, v.valgtVaaben) === 0 &&
      !(VAABEN[v.valgtVaaben]?.brugPrTur > 1)) {
    const noegle = `${v.tur.turNr}|${v.valgtVaaben}`;
    if (S.tomHint !== noegle) {
      // Vent lidt: først skal bekræftelsen ("arbejder hjemmefra …") kunne læses.
      if (S.tomHintNoegle !== noegle) { S.tomHintNoegle = noegle; S.tomHintFra = performance.now(); }
      else if (performance.now() - S.tomHintFra > 2500) {
        S.tomHint = noegle;
        hud.banner(`${VAABEN[v.valgtVaaben]?.navn || 'Våbnet'} er brugt — vælg et andet (1–0 eller Tab)`, 2200);
      }
    }
  }
  // Arsenalet hører til ens egen tur: det lukker, når turen er forbi.
  if (panel.aaben) {
    if (!minTur || aktNu.doed || ![TIL.SPILLER_AKTIV, TIL.TUR_START].includes(v.tur.tilstand)) panel.luk();
    else panel.opdater(v, aktNu);
  }
  hud.opdater(v, S.pid, tilstandTekst, S.oplader, lokalKraft(), minTur);
}

/* ------------------------------------------------------------------ input */

/**
 * Send de holdte taster — KANTUDLØST, kaldt fra selve taste-hændelserne.
 *
 * Bevidst ikke fra rendering-løkken: rAF kan være helt suspenderet i en skjult
 * fane, og input må ikke afhænge af om nogen kigger. Samtidig betyder
 * kantudløsning at en aktiv spiller sender 2-10 beskeder i sekundet og en
 * passiv nul.
 */
/** Markørtilstand gælder kun i ens egen tur, med et markørvåben i hånden.
 *  Ryddes her, ét sted — ellers kunne den hænge ved og låse piletasterne. */
function markoerGaelder() {
  const v = S.verden, akt = v?.aktivBaever();
  return !!(akt && erMin(akt) && v.tur.tilstand === TIL.SPILLER_AKTIV && v.vaabenNu()?.sigte === 'markoer');
}
function ryddMarkoer() {
  if (!S.markoerTilstand || markoerGaelder()) return;
  S.markoerTilstand = false;
  S._markoerIdx = null;
  sendInput();
}

/** De holdte taster, som simulationen skal have (null = intet må sendes). */
function holdNu() {
  if (S.pause || panel.aaben) return 0;
  // I markørtilstand flytter piletasterne markøren — ikke også kunden.
  const pile = K.VENSTRE | K.HOEJRE | K.SIGT_OP | K.SIGT_NED;
  return S.markoerTilstand ? tast.bitmaske() & ~pile : tast.bitmaske();
}

function sendInput() {
  const v = S.verden;
  if (!v || S.tilstand !== 'spil') return;
  const akt = v.aktivBaever();
  if (!akt || !erMin(akt)) return;

  const b = holdNu();
  if (b !== S.sidsteBitmaske) {
    S.sidsteBitmaske = b;
    afsend({ k: 'hold', seq: S.seq++, b });
  }
}

function afsend(cmd) {
  if (S.erVaert) S.sim?.send({ t: 'in', d: { cmd, pid: S.erNet ? S.pid : null } });
  else S.transport.send({ t: 'in', d: cmd });
}

tast.paaTryk((handling, e) => {
  if (panel.tast(e)) return;
  // Under festen springer Enter, mellemrum og Esc direkte til resultattavlen.
  if (S.tilstand === 'sejr' && S.festTimer) {
    if (['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(e.code)) visResultat();
    return;
  }
  if (S.tilstand !== 'spil') { menu.tast(e); return; }
  // Under pause hører tasterne til pausemenuen — kun Esc lukker den igen.
  // Og det tastetryk, der lige lukkede den (Enter på Fortsæt, Esc), må ikke
  // også hoppe, lade op eller pause igen.
  if (S.pause && handling !== 'pause') return;
  if (S.pauseSlut && performance.now() - S.pauseSlut < 200) return;
  const v = S.verden;
  const akt = v?.aktivBaever();

  // Borer kunden, stopper mellemrummet boret — ingen opladning.
  if (handling === 'lad' && akt && erMin(akt) && akt.graver) S.stopBor = true;
  else if (handling === 'lad' && akt && erMin(akt) && !S.oplader && !panel.aaben &&
      v.tur.tilstand === TIL.SPILLER_AKTIV) {
    S.oplader = true;
    S.opladFra = performance.now();
  }
  sendInput();

  if (e.code === 'Slash' || e.code === 'F1' || e.key === '?') {
    if (panel.aaben) panel.luk();
    hjaelp.skiftOversigt();
    return;
  }
  if (hjaelp.oversigtErAaben) {
    if (e.code === 'Escape') hjaelp.lukOversigt();
    return;
  }

  switch (handling) {
    case 'pause':
      if (S.markoerTilstand) { S.markoerTilstand = false; sendInput(); return; }
      S.pause = !S.pause;
      if (S.pause) { S.oplader = false; lyd.ladelyd(null); menu.vis('pause'); }
      else { S.pauseSlut = performance.now(); menu.skjul(); }
      sendInput();
      return;
    case 'debug': visning?.debug.skift(); return;
    case 'lydFra': {
      const fra = !lyd.erLydFra();
      saetLydIndstilling('lydFra', fra);
      S.lydKnap?.saetFra(fra);
      hud?.banner(fra ? 'Lyd slået fra (M)' : 'Lyd slået til (M)', 1200);
      return;
    }
    case 'centrer': visning?.kamera.friTilstand(false);
      if (akt) visning.kamera.foelg(akt); return;
    case 'zoomInd': visning?.kamera.zoomInd(); return;
    case 'zoomUd': visning?.kamera.zoomUd(); return;
    case 'panel':
      aabnArsenal();
      return;
    case 'staaOver':
      if (akt && erMin(akt) && confirm(T.spil.bekraeftStaaOver)) {
        afsend({ k: 'handling', seq: S.seq++, h: 'staaOver' });
      }
      return;
    case 'hop': case 'salto':
      // Samme maskering som sendInput; simulationen rydder hop-bitten selv
      // efter ét tick, så dens holdte taster bagefter er lig sidsteBitmaske.
      if (akt && erMin(akt) && !panel.aaben) {
        const b = holdNu();
        S.sidsteBitmaske = b;
        afsend({ k: 'hold', seq: S.seq++, b: b | (handling === 'hop' ? K.HOP : K.SALTO) });
      }
      return;
    case 'lunte':
      if (akt && erMin(akt)) {
        const naeste = e.shiftKey ? (v.valgtLunte + 3) % 5 + 1 : v.valgtLunte % 5 + 1;
        afsend({ k: 'handling', seq: S.seq++, h: 'lunte', v: naeste });
      }
      return;
    case 'naesteFjende': springMarkoer(e.shiftKey ? -1 : 1); return;
    case 'forrigeVaaben': cyklVaaben(-1); return;
    case 'naesteVaaben': cyklVaaben(1); return;
  }

  if (handling && handling.startsWith('favorit')) {
    const i = +handling.slice(7);
    if (i < 10) vaelgVaaben(S.profil.favoritter[i]);
    if (panel.aaben) panel.luk();
  }
});

tast.paaSlip((handling) => {
  sendInput();
  if (handling !== 'lad' || S.tilstand !== 'spil' || S.pause) return;
  const v = S.verden;
  const akt = v?.aktivBaever();
  // Opladningen ejes LOKALT. Spejlverdenen kender den ikke — den tilstand
  // findes kun hos værten — og kraftbjælken skal desuden reagere uden at
  // vente på en netværkstur/retur.
  if (S.stopBor) {
    S.stopBor = false;
    if (akt && erMin(akt)) afsend({ k: 'handling', seq: S.seq++, h: 'affyr', kraft: 0 });
    return;
  }
  if (!akt || !erMin(akt) || !S.oplader || panel.aaben) return;
  // Aflæs kraften FØR oplader-flaget ryddes — lokalKraft() svarer 0, når
  // flaget er nede. Med den gamle rækkefølge affyredes ALT med minimumskraft,
  // mens sigtelinjen viste den fulde bue.
  const kraft = lokalKraft();
  S.oplader = false;
  lyd.ladelyd(null);

  const w = v.vaabenNu();
  if (w?.sigte === 'markoer' && !S.markoerTilstand) {
    // Markørvåben: første tryk åbner markørtilstand i stedet for at affyre.
    S.markoerTilstand = true;
    S.markoer.x = akt.x + akt.retning * 260;
    S.markoer.y = akt.y + 120;
    sendInput();
    return;
  }
  if (S.markoerTilstand) {
    afsend({ k: 'handling', seq: S.seq++, h: 'markoer',
             x: S.markoer.x, y: S.markoer.y, retning: S.markoer.retning });
    S.markoerTilstand = false;
    sendInput();
  }
  afsend({ k: 'handling', seq: S.seq++, h: 'affyr', kraft });
});

/** Hvor langt er opladningen, målt lokalt på uret. */
function lokalKraft() {
  if (!S.oplader) return 0;
  const w = S.verden?.vaabenNu();
  const msFuld = ((w?.kraft?.opladTid ?? 63) / HZ) * 1000;
  return Math.min(1, (performance.now() - S.opladFra) / msFuld);
}

/** Vælg et våben fra bjælken, arsenalet eller tasterne. Et opbrugt våben
 *  siger det i stedet for at gøre ingenting. */
function vaelgVaaben(id) {
  const v = S.verden;
  const akt = v?.aktivBaever();
  if (!id || !VAABEN[id] || !akt || !erMin(akt)) return;
  // Scannerens andet skud er betalt, selv om tallet viser 0.
  const betalt = S.betalt && S.betalt.turNr === v.tur.turNr && S.betalt.vaaben === id;
  if (v.ammoFor(akt.hold, id) === 0 && !betalt) {
    hud.banner(`${VAABEN[id].navn} er opbrugt — find en forsyningskasse`, 1600);
    lyd.afspil('teleport_afvist');
    return;
  }
  afsend({ k: 'handling', seq: S.seq++, h: 'vaelgVaaben', id });
}

/** Åbn arsenalet (siden). Tururet står stille, mens man kigger (højst 5 s). */
function aabnArsenal() {
  const v = S.verden;
  const akt = v?.aktivBaever();
  if (!akt || !erMin(akt) || akt.doed || panel.aaben) return;
  const tilstand = v.tur.tilstand;
  if (![TIL.SPILLER_AKTIV, TIL.TUR_START].includes(tilstand)) return;   // ellers lukkede den straks igen
  // En halv opladning må ikke overleve arsenalet og affyre bagefter.
  if (S.oplader) { S.oplader = false; lyd.ladelyd(null); }
  panel.aabn(v, akt);
  hud.saetArsenalAaben(true);
  // Uret står stille — også hvis skuffen åbnes, mens turen starter.
  afsend({ k: 'handling', seq: S.seq++, h: 'panel', aaben: true });
  sendInput();                                 // kunden står stille, mens man vælger
}

panel.paaValg((id) => vaelgVaaben(id));
panel.paaLuk(() => {
  hud?.saetArsenalAaben(false);
  const akt = S.verden?.aktivBaever();
  if (S.tilstand === 'spil' && akt && erMin(akt)) afsend({ k: 'handling', seq: S.seq++, h: 'panel', aaben: false });
  sendInput();                                 // holdte piletaster gælder igen
});
/** Shift+tal i arsenalet lægger våbnet på den plads i bjælken. */
panel.paaBind((id, plads) => {
  const f = S.profil.favoritter;              // samme array som S.verden.favoritter
  if (!(plads >= 0 && plads < 10)) return;
  while (f.length < 10) f.push(null);
  // Byt plads: det våben, der lå der, rykker hen, hvor det nye kom fra.
  const fra = f.indexOf(id), ud = f[plads];
  if (fra >= 0) f[fra] = ud ?? null;
  f[plads] = id;
  if (S.verden) S.verden.favoritter = f;       // skuffens tastmærker læser herfra
  gemProfil(S.profil);
  menu.saetProfil(S.profil);                   // menuen har sin egen kopi
  hud.byggFavoritter(f);
});

/** Q/E går gennem bjælkens våben (dem med ammunition). */
function cyklVaaben(d) {
  const v = S.verden;
  const akt = v?.aktivBaever();
  if (!akt || !erMin(akt)) return;
  const betalt = (id) => S.betalt && S.betalt.turNr === v.tur.turNr && S.betalt.vaaben === id;
  const bar = S.profil.favoritter.slice(0, 10).filter((id) => VAABEN[id] && (v.ammoFor(akt.hold, id) !== 0 || betalt(id)));
  if (!bar.length) return;
  const i = bar.indexOf(v.valgtVaaben);
  const n = i < 0 ? (d > 0 ? bar[0] : bar[bar.length - 1]) : bar[((i + d) % bar.length + bar.length) % bar.length];
  afsend({ k: 'handling', seq: S.seq++, h: 'vaelgVaaben', id: n });
}

/** Uden dette spring skal man flytte markøren 2000 wu med piletaster, og
 *  teleport og luftangreb føles ødelagte. */
function springMarkoer(d) {
  const v = S.verden;
  const akt = v?.aktivBaever();
  if (!akt) return;
  const fjender = v.baevere.filter((b) => !b.doed && b.hold !== akt.hold)
                           .sort((a, b) => a.x - b.x);
  if (!fjender.length) return;
  S._markoerIdx = ((S._markoerIdx ?? -1) + d + fjender.length) % fjender.length;
  const m = fjender[S._markoerIdx];
  // Uden markørvåben (eller i en andens tur) kigger T bare på fjenden.
  if (!markoerGaelder()) { visning?.kamera.fokus(m); return; }
  S.markoerTilstand = true;
  S.markoer.x = m.x; S.markoer.y = m.y + 20;
  S.markoer.retning = m.x > akt.x ? 1 : -1;
  sendInput();
}

/* markørflytning med piletaster, når markørtilstand er aktiv */
setInterval(() => {
  if (!S.markoerTilstand || S.tilstand !== 'spil') return;
  const fin = tast.nede('fin') ? 0.18 : 1;
  const f = 9 * fin;
  if (tast.nede('venstre')) S.markoer.x -= f;
  if (tast.nede('hoejre')) S.markoer.x += f;
  if (tast.nede('sigtOp')) S.markoer.y += f;
  if (tast.nede('sigtNed')) S.markoer.y -= f;
}, 16);

/* ------------------------------------------------------------------ vært-vågen */

/** Tre af de fire lag mod baggrunds-throttling. Det fjerde — serverens
 *  vagthund — ligger i rum.py og er det eneste der ikke kræver værtens
 *  samarbejde. */
function holdFanenVaagen() {
  if (!S.erNet) return;

  // 1. En lydløs AudioContext undtager siden fra Chromes intensive throttling.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    S.lyd = ctx;
    document.addEventListener('click', () => ctx.resume(), { once: true });
  } catch { /* uden lyd klarer vagthunden resten */ }

  // 2. Fortæl værten det, og fortæl de andre at værten er væk.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.tilstand === 'spil') {
      S.transport?.send({ t: 'haendelse', d: { navn: 'vaertSkjult' } });
    } else if (!document.hidden) {
      hud?.banner(T.net.holdFanenSynlig, 4000, 'advarsel');
    }
  });
}

/* ------------------------------------------------------------------ afslut */

function forladKamp() {
  slutFest();
  S.transport?.send({ t: 'forlad', d: {} });
  S.transport?.luk();
  S.transport = null;
  visning?.fjern();
  visning = null; S.visning = null;
  S.sim?.luk(); S.sim = null;
  S.verden = null; S.klient = null;
  S.tilstand = 'menu';
  S.rumkode = null;
  hudRod.innerHTML = '';
  hjaelp.saetSynlig(false);
  hjaelp.ryd();
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  menu.vis('start');
}

/* Diagnostikhåndtag. Gør det muligt at inspicere spillets tilstand fra
   browserens konsol — og at tegne én frame i hånden, hvilket er den eneste
   måde at se noget på, når fanen er skjult og rAF er suspenderet. */
window.baevere = {
  S, bus, r,
  get verden() { return S.verden; },
  get tur() { return S.verden?.tur; },
  tegnEnFrame() {
    if (S.tilstand !== 'spil' || !S.verden) return 'ingen kamp i gang';
    opdaterVisning(1 / 60, performance.now() / 1000);
    r.tegn();
    return { tick: S.verden.tick, tilstand: S.verden.tur.tilstand,
             baever: S.verden.aktivBaever()?.navn };
  },
};

window.addEventListener('beforeunload', () => {
  try { S.transport?.send({ t: 'forlad', d: {} }); } catch { /* bedste forsøg */ }
});

kraevFrame();
