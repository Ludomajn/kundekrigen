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
import { lavFx, lavProjektilView, lavGenstandView, lavSigte, telefonRinger } from './render/fx.js';
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
  fortsaet() { S.pause = false; menu.skjul(); },
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
  alle.forEach((b, i) => vi.baevere.get(b.id)?.introFald(0.45 + i * (2.2 / Math.max(1, alle.length)), () => {
    lyd.afspil('sfx_landing', { vol: 0.55, tone: 0.85 + Math.random() * 0.3 });
    for (let k = 0; k < 6; k++) vi.fx.spor(b.x + (Math.random() - 0.5) * 22, b.y + 2);
  }));
  intro.start((n) => {
    if (n === 0) lyd.afspil('sfx_intro_slam', { vol: 0.9, vigtig: true });
    else lyd.afspil('sfx_nedtael', { vol: 0.8, tone: 1 + (3 - n) * 0.09, vigtig: true });
  });
}

function slutIntro() {
  if (!S.introStartet || S.introSlut) return;
  S.introSlut = true;
  if (intro.go()) lyd.afspil('sfx_kamp_start', { vol: 0.85, vigtig: true });
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
    banetype: opsaet.indst.banetype || 'aaben',
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
  hud.saetVisHp((b) => S.visHp.get(b.id)?.vist ?? b.hp);
  const terraen = lavTerraenView(r.scene, v.terraen, v.froeBrugt ?? v.froe);
  const pynt = lavPyntView(r.scene, v.terraen, terraen.overflader, v.froeBrugt ?? v.froe);
  const parallaks = lavParallaks(r.scene, r.kamera, v.terraen, rng, v.vejr);
  const vejr = lavVejr(r.scene, r.kamera, rng);
  const vand = lavVand(r.scene, v.terraen);
  const fx = lavFx(r.scene);
  const projektiler = lavProjektilView(r.scene);
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
    // Store brag får det dybe drøn oveni; afstanden dæmper, tonen varierer.
    const daemp = 1 / (1 + afstand / 1400);
    lyd.afspil('nedslag', { vol: daemp, tone: 0.9 + Math.random() * 0.25 });
    if (e.radius >= 40) lyd.afspil('brag', { vol: daemp, tone: 0.85 + Math.random() * 0.2 });
  });
  bus.paa('skudAffyret', (e) => {
    const b = S.verden.baevere.find((x) => x.id === e.baever);
    if (b) {
      const m = mundingsPunkt(b);
      visning.fx.muzzle(m.x, m.y, m.dx, m.dy);
      visning.baevere.get(b.id)?.rekylSkud();
    }
    // Raketter og bøsser knalder; granater og redskaber er et kast.
    // Brugerens egne våbenlyde; de øvrige kast og udlægninger er et kast.
    const variation = { tone: 0.95 + Math.random() * 0.1 };
    const egen = {
      grenroer: 'stemme_kanon_lyd', splintboesse: 'stemme_skud', gnavetand: 'stemme_skud',
      egegranat: 'stemme_granat', koglebombe: 'stemme_granat',
      halesmaek: Math.random() < 0.5 ? 'stemme_slag' : 'stemme_slag_2',
    }[e.vaaben];
    if (e.vaaben === 'traestammeregn') lyd.afspil('stemme_fax', { vol: 0.85, maksSek: 6 });
    else if (egen) lyd.afspil(egen, { ...variation, vol: 0.9 });
    else lyd.afspil(['daemningsdynamit', 'baevermine'].includes(e.vaaben) ? 'kast' : 'skud', variation);
    // Et skud er ude: rammer det ingen, griner kunderne, når turen skifter.
    S.skudUde = { ramte: false };
  });
  bus.paa('doedsfald', (e) => {
    hud.banner(`${e.navnTekst} har lagt på`, 1800);
    const b = S.verden.baevere.find((x) => x.id === e.baever);
    if (!b?.drukner) {
      lyd.stemme('stemme_doed', { vigtig: true });
      // Og så jubler den, der fik ram på kunden (venter, til "Død" er sagt).
      lyd.stemme('stemme_kill', { vigtig: true });
      // FEJL 40: kunden suges ind i et sort hul, før liget smælder.
      visning.baevere.get(e.baever)?.absorber();
      visning.sorteHuller.start(e.x, e.y + 22);
      lyd.afspil('sfx_sort_hul', { vol: 0.8 });
    }
  });
  bus.paa('drukner', (e) => {
    visning.fx.plask(e.x, e.y); lyd.afspil('fald', { vol: 0.9 });
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
    lyd.afspil(mig ? 'sfx_du_vandt' : f ? 'sfx_tabt' : 'sejr', { vol: 0.9, vigtig: true });
    if (f) S.sangTimer = setTimeout(() => {
      const sang = Math.random() < 0.5 ? 'stemme_vindersangen' : 'stemme_vindermusik_2';
      if (S.tilstand === 'sejr') lyd.stemme(sang, { vigtig: true });
    }, 1150);
    S.festTimer = setTimeout(visResultat, f ? 6500 : 2800);
  });
  bus.paa('kasseFalder', () => hud.banner('Supportpakke på vej', 1400));
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
    // Røret tages: telefonlyden, og så sekretæren — efter hinanden.
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
    lyd.afspil('brag', { tone: 1.25, vol: 0.9 });
    lyd.stemme('stemme_meget_skade', { chance: 0.6 });
  });

  // ---- rene lydhændelser. Præsentationen lytter; den skriver aldrig tilbage.
  bus.paa('hop', () => lyd.afspil('sfx_hop', { vol: 0.8 }));
  bus.paa('salto', () => lyd.afspil('sfx_salto', { vol: 0.8 }));
  bus.paa('skade', (e) => {
    lyd.afspil('skade', { tone: 0.9 + Math.random() * 0.2 });
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
    lyd.afspil(e.slags === 'helbred' ? 'sfx_helbred' : 'sfx_kasse', { vol: 0.8 });
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
    lyd.afspil('sfx_vaabenskift', { vol: 0.55 });
    // "Tonerkanon!" når den tages frem — ikke oven i kanonlyden ved skuddet.
    if (e.vaaben === 'grenroer') lyd.stemme('stemme_tonerkanon', { chance: 0.5 });
  });
  bus.paa('bjaelkeSat', () => lyd.afspil('byg'));
  bus.paa('teleport', () => lyd.afspil('sfx_teleport', { vol: 0.8 }));
  bus.paa('lunteSat', () => lyd.afspil('klik', { vol: 0.6 }));
  bus.paa('redskabStart', (e) => lyd.afspil(e.slags === 'bor' ? 'stemme_systemnedbrud' : 'splint', { vol: 0.9 }));
  bus.paa('klyngeDelt', () => lyd.afspil('kast', { tone: 1.2, vol: 0.8 }));
}

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
const RING_RAEKKEVIDDE = 600;        // wu: så tæt skal kamera eller kunde være på telefonen
const RAKETTER = new Set(['gren', 'stamme']);

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
      lyd.afspil('sfx_ramt', { vol: 0.7 });
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
        lyd.afspil('sfx_tael', { vol: 0.32, tone: 1.25 - 0.45 * blød });
      }
      if (k >= 1) { e.vist = e.t.til; e.t = null; hud.markerRamt(b.id, false); }
    }
  }
}

function opdaterVisning(dt, tid) {
  const v = S.verden;
  const vi = visning;

  // Skridtene og fuglene: gang-løkken følger den aktive figur, og en svag
  // ambience ligger under hele kampen.
  const aktLyd = v.aktivBaever();
  lyd.loop('gang', !!(S.tilstand === 'spil' && aktLyd && !aktLyd.doed && aktLyd.paaJorden &&
                      (tast.nede('venstre') || tast.nede('hoejre'))), 0.5);
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
  const nuS = performance.now() / 1000, kam = r.kamera.position;
  for (const k of v.kasser) {
    if (k.slags !== 'telefon') continue;
    const ringer = telefonRinger(k.id, nuS);
    // Ringelyden kun tæt på — når kameraet eller den aktive kunde er nær
    // telefonen — og højst hvert 10. sekund, ellers ville den kime uafbrudt.
    if (ringer && !S.ringer?.has(k.id) && S.tilstand === 'spil') {
      const akt = v.aktivBaever();
      const afstand = Math.min(Math.hypot(k.x - kam.x, k.y - kam.y),
                               akt ? Math.hypot(k.x - akt.x, k.y - akt.y) : Infinity);
      const vol = Math.max(0, 1 - afstand / RING_RAEKKEVIDDE) * 0.7;
      if (vol > 0.05 && performance.now() - (S.sidsteRing || 0) > 10000) {
        S.sidsteRing = performance.now();
        lyd.afspil('stemme_telefonlyd_til_event', { vol, maksSek: 4 });
      }
    }
    (S.ringer ||= new Set())[ringer ? 'add' : 'delete'](k.id);
  }
  const medGrav = new Set(v.gravsten.map((g) => g.baever));

  for (const b of v.baevere) {
    let bv = vi.baevere.get(b.id);
    if (!bv) { bv = lavBaeverView(r.scene, b, b.hold, v.terraen); vi.baevere.set(b.id, bv); }
    b.gaar = b.id === v.tur.baeverId && (tast.nede('venstre') || tast.nede('hoejre'));
    bv.opdater(b, dt, medGrav.has(b.id), !!S.jubler?.has(b.id));
  }

  // Sigte: den forudsagte bane plus en kraftbue om bæveren.
  const akt = v.aktivBaever();
  const visSigte = akt && !akt.doed && erMin(akt) &&
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

  if (S.markoerTilstand) vi.sigte.visMarkoer(S.markoer.x, S.markoer.y);
  else vi.sigte.skjulMarkoer();

  vi.debug.opdater();

  const tilstandTekst = v.tur.tilstand === TIL.UDSAET ? T.spil.udsaetter : null;
  const aktNu = v.aktivBaever();
  const minTur = !!(aktNu && erMin(aktNu));
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
function sendInput() {
  const v = S.verden;
  if (!v || S.tilstand !== 'spil') return;
  const spaerret = S.pause || panel.aaben;
  const akt = v.aktivBaever();
  if (!akt || !erMin(akt)) return;

  const b = spaerret ? 0 : tast.bitmaske();
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
  const v = S.verden;
  const akt = v?.aktivBaever();

  if (handling === 'lad' && akt && erMin(akt) && !S.oplader &&
      v.tur.tilstand === TIL.SPILLER_AKTIV) {
    S.oplader = true;
    S.opladFra = performance.now();
  }
  sendInput();

  if (e.code === 'Slash' || e.code === 'F1' || e.key === '?') {
    hjaelp.skiftOversigt();
    return;
  }
  if (hjaelp.oversigtErAaben) {
    if (e.code === 'Escape') hjaelp.lukOversigt();
    return;
  }

  switch (handling) {
    case 'pause':
      if (S.markoerTilstand) { S.markoerTilstand = false; return; }
      S.pause = !S.pause;
      S.pause ? menu.vis('pause') : menu.skjul();
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
      if (akt && erMin(akt)) panel.aabn(v, akt);
      return;
    case 'staaOver':
      if (akt && erMin(akt) && confirm(T.spil.bekraeftStaaOver)) {
        afsend({ k: 'handling', seq: S.seq++, h: 'staaOver' });
      }
      return;
    case 'hop':
      if (akt && erMin(akt)) afsend({ k: 'hold', seq: S.seq++, b: tast.bitmaske() | K.HOP });
      return;
    case 'salto':
      if (akt && erMin(akt)) afsend({ k: 'hold', seq: S.seq++, b: tast.bitmaske() | K.SALTO });
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
    const id = S.profil.favoritter[i];
    if (id && akt && erMin(akt)) afsend({ k: 'handling', seq: S.seq++, h: 'vaelgVaaben', id });
  }
});

tast.paaSlip((handling) => {
  sendInput();
  if (handling !== 'lad' || S.tilstand !== 'spil') return;
  const v = S.verden;
  const akt = v?.aktivBaever();
  // Opladningen ejes LOKALT. Spejlverdenen kender den ikke — den tilstand
  // findes kun hos værten — og kraftbjælken skal desuden reagere uden at
  // vente på en netværkstur/retur.
  if (!akt || !erMin(akt) || !S.oplader) return;
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
    return;
  }
  if (S.markoerTilstand) {
    afsend({ k: 'handling', seq: S.seq++, h: 'markoer',
             x: S.markoer.x, y: S.markoer.y, retning: S.markoer.retning });
    S.markoerTilstand = false;
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

panel.paaValg((id) => {
  afsend({ k: 'handling', seq: S.seq++, h: 'vaelgVaaben', id });
});
panel.paaBind((id) => {
  const f = S.profil.favoritter;
  const tom = f.findIndex((x) => !x);
  if (tom >= 0) f[tom] = id; else f[f.length - 1] = id;
  gemProfil(S.profil);
  hud.byggFavoritter(f);
});

function cyklVaaben(d) {
  const v = S.verden;
  const akt = v?.aktivBaever();
  if (!akt || !erMin(akt)) return;
  const w = v.vaabenNu();
  const samme = Object.values(VAABEN).filter((x) => x.kategori === w.kategori &&
                                                    v.ammoFor(akt.hold, x.id) !== 0);
  if (!samme.length) return;
  const i = samme.findIndex((x) => x.id === v.valgtVaaben);
  const n = samme[((i + d) % samme.length + samme.length) % samme.length];
  afsend({ k: 'handling', seq: S.seq++, h: 'vaelgVaaben', id: n.id });
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
  S.markoerTilstand = true;
  S._markoerIdx = ((S._markoerIdx ?? -1) + d + fjender.length) % fjender.length;
  const m = fjender[S._markoerIdx];
  S.markoer.x = m.x; S.markoer.y = m.y + 20;
  S.markoer.retning = m.x > akt.x ? 1 : -1;
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
