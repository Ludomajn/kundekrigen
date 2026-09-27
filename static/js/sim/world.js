/* Kundekrigen — simulationens facade.
 *
 * Verden eksponerer bevidst kun fem ting udadtil:
 *   udfoerKommando, tick, oejebliksbillede, genskab, aftryk
 *
 * At tick() returnerer en HÆNDELSESLISTE *er* præsentationssømmen. Rendering
 * og brugerflade abonnerer på hændelser og læser positioner; de skriver aldrig
 * tilbage. Derfor kan hele js/render/ og js/ui/ slettes, uden at simulationen
 * ændrer sig én bit — og derfor er netværkslaget billigt.
 *
 * Hovedløs: ingen three.js, ingen DOM, ingen Math.random, ingen Date.
 */
'use strict';

import { lavRng } from '../core/rng.js';
import { HZ, DT } from '../core/tick.js';
import { genererSpilbar, findStartpladser, VAND_NIVEAU } from './terrain_gen.js';
import { Terraen } from './terrain.js';
import * as E from './entities.js';
import * as F from './physics.js';
import * as D from './damage.js';
import * as B from './behaviours.js';
import * as TU from './turn.js';
import { VAABEN, startAmmo, tilfaeldigtKassevaaben, kasseAntal, FAVORITTER } from './weapons.js';
import { valider, K } from './commands.js';
import { OPKALD, TELEFON_MAKS } from './opkald.js';
import * as HN from './haendelser.js';
import { filmTicks, filmFlertal } from '../core/filmintro.js';

/* Ro mellem handlingerne (tick): efter en tur uden skade, og efter en tur,
 * hvor nogen blev ramt — så nedtællingen og reaktionen når at blive set. */
const EFTERSPIL = 45, EFTERSPIL_SKADE = 100;

/* Pillerne: hvor meget de giver, hvor højt tålmodigheden kan nå med dem, og
 * hvor mange glas der højst står på banen. */
const PILLER_HP = 50, PILLER_LOFT = 150, PILLER_MAKS = 2;

/* Forsyningskasser: hvor højt over jorden de slippes (de daler i faldskærm
 * med 70 wu/s, physics.skridtKasse), og hvor mange der højst ligger på banen. */
const KASSE_FALDHOEJDE = 360, VAABENKASSE_MAKS = 4;
import { tagSnapshot, tagDelta } from './snapshot.js';

export const T = TU.T;

const STANDARD_CFG = {
  turTicks: 45 * HZ,
  kampTicks: 30 * 60 * HZ,
  vind: true,
  vejr: 'auto',
  banetype: 'fort',
  ammoSkema: 'standard',
  kasseChance: 0.45,
  // Tilfældige hændelser i starten af hver runde fra runde 3 (sim/haendelser.js).
  // haendelser: null = alle; ellers en liste over dem, der må ske.
  haendelseChance: HN.HAENDELSE_CHANCE,
  haendelser: null,
};

export function lavVerden(opsaet) {
  const v = new Verden(opsaet);
  return v;
}

/** Banens layout: antal klinikker og kunder pr. klinik (den største klinik,
 *  talt fra opsætningen — døde kunder tæller med, så tallet aldrig ændrer sig). */
function lavLayout(antalHold, baevere) {
  const n = {};
  let prHold = 1;
  for (const b of baevere) { n[b.hold] = (n[b.hold] || 0) + 1; if (n[b.hold] > prHold) prHold = n[b.hold]; }
  return { antalHold: antalHold | 0, prHold };
}
const sammeLayout = (a, b) => !!a && !!b && a.antalHold === b.antalHold && a.prHold === b.prHold;

class Verden {
  constructor(opsaet) {
    this.cfg = { ...STANDARD_CFG, ...(opsaet.cfg || {}) };
    this.froe = opsaet.froe >>> 0;
    this.banetype = opsaet.banetype || this.cfg.banetype;

    this.rngSim = lavRng(this.froe);
    this._id = 1;

    this.tick = 0;
    this.vind = 0;
    this.vejr = this.cfg.vejr === 'auto'
      ? TU.VEJRTYPER[Math.floor(this.rngSim() * TU.VEJRTYPER.length)]
      : this.cfg.vejr;
    this.vandNiveau = 0;
    this.pludseligDoed = false;

    this.baevere = [];
    this.projektiler = [];
    this.placerede = [];
    this.kasser = [];
    this.gravsten = [];
    this.eksplosionsKoe = [];
    this.forsinkede = [];
    this.doedskoe = [];
    this.sidsteBaeverPrHold = {};
    // Hvert hold husker sit eget våben og sin lunte. Ét fælles valg lod
    // modstanderens sidste våben følge med over i næste spillers tur.
    this.vaabenPrHold = {};

    this.tur = TU.nyTur(this);
    this.valgtVaaben = 'staa_over';
    this.valgtLunte = 3;
    this.markoer = { x: 0, y: 0, vinkel: 0, retning: 1 };
    this.hold = [];
    this.antalHold = 0;
    this.holdt = 0;                    // bitmaske af holdte taster
    this.opladning = 0;
    this.opladerNu = false;
    this.brugtIDenneTur = 0;
    // Brug pr. våben i denne tur. Scanneren betaler ved første scanning og
    // slutter turen ved den anden — uden at andre våben tæller med.
    this.brugtPrVaaben = {};
    this.panelAabent = false;          // våbenskuffen er åben (sat med 'panel')
    this.koe = [];                     // kommandoer der venter på næste tick
    this.slut = null;
    // Rundens hændelse ({ slags, runde }), til næste runde begynder, og den
    // forrige hændelse — den samme kommer aldrig to gange i træk.
    this.haendelseNu = null;
    this.sidsteHaendelse = null;

    if (opsaet.hold) this._saetOpHold(opsaet.hold);
    this.valgtVaaben = this._reserveVaaben(0);
    this._genererBane();
  }

  nytId() { return this._id++; }
  naesteIdVaerdi() { return this._id; }

  // ------------------------------------------------------------ opsætning

  _saetOpHold(holdData) {
    this.hold = holdData.map((h, i) => ({
      id: i, farve: h.farve, navn: h.navn,
      ammo: startAmmo(this.cfg.ammoSkema),
      spillere: h.spillere || [],
      elimineret: false,
    }));
    this.antalHold = this.hold.length;
    for (const h of holdData) {
      for (const bd of h.baevere) {
        const b = E.lavBaever(this.nytId(), h.id ?? holdData.indexOf(h),
                              bd.navn, bd.udseende, bd.ejer);
        b.hold = holdData.indexOf(h);
        this.baevere.push(b);
      }
    }
  }

  _genererBane() {
    // Fortet bygges efter holdene: ét fort pr. klinik, én etage pr. kunde.
    // Layoutet følger med i snapshottet, så spejlet og gæsterne bygger det samme.
    this.layout = lavLayout(this.hold.length, this.baevere);
    const res = genererSpilbar(this.froe, this.banetype, Math.max(2, this.baevere.length), this.layout);
    this.terraen = res.terraen;
    this.startpladser = res.pladser;
    this.froeBrugt = res.froe;
    // Havet er en del af banen fra start, ikke først i pludselig død.
    this.vandNiveau = res.terraen.vandNiveau ?? VAND_NIVEAU;
  }

  /**
   * Udstyr banen: miner, forsyningskasser og sprængtønder.
   *
   * Det er dét, der gør terrænet til et sted med muligheder frem for bare et
   * underlag — man kan skyde en tønde i stedet for en bæver, og man skal holde
   * øje med, hvor man træder.
   */
  _udstyrBanen() {
    if (this.terraen.fort) { this._udstyrForter(); return; }
    const pladser = this._udstyrsPladser();
    if (pladser.length < 6) return;

    const optaget = this.baevere.map((b) => b.x);
    const ledige = this.rngSim.bland(pladser.slice())
      .filter((p) => optaget.every((x) => Math.abs(x - p.x) > 150));

    const bredde = this.terraen.w;
    const antalMiner = 3 + Math.floor(this.rngSim() * 4) + Math.round(bredde / 2000);
    const antalTelefoner = 1, antalPiller = 1;
    const antalToender = 1 + Math.floor(this.rngSim() * 3);      // klinikkens printere

    let i = 0;
    const naeste = () => ledige[i++];

    for (let n = 0; n < antalMiner && i < ledige.length; n++) {
      const p = naeste();
      this.placerede.push(E.lavPlaceret(this.nytId(), {
        x: p.x, y: p.y + 2, lunte: 0, naerhed: VAABEN.baevermine.placeret.naerhed, armering: 0,
        detonation: { radius: 52, skade: 42, knockback: 240, carve: true },
        ejer: null, ejerHold: null, sprite: 'mine',
      }));
    }

    for (let n = 0; n < antalToender && i < ledige.length; n++) {
      const p = naeste();
      // Tønden har hverken lunte eller nærhedsudløser: den detonerer kun,
      // når den fanges af en anden eksplosion. Ren kædereaktion.
      this.placerede.push(E.lavPlaceret(this.nytId(), {
        x: p.x, y: p.y + 2, lunte: 0, naerhed: 0, armering: 0,
        detonation: { radius: 96, skade: 62, knockback: 380, carve: true },
        ejer: null, ejerHold: null, sprite: 'toende',
      }));
    }

    for (let n = 0; n < antalTelefoner && i < ledige.length; n++) this._lavTelefon(naeste());
    for (let n = 0; n < antalPiller && i < ledige.length; n++) this._lavPiller(naeste());
  }

  /** Fortbanen: hver borg får det samme udstyr — lige mange miner, printere,
   *  telefoner og piller — på de samme pladser, spejlet. Borge af samme form
   *  har deres pladser i samme (spejlede) rækkefølge (terrain_gen.fortPlan),
   *  så én blanding pr. form giver dem alle det samme. Printerne (stort
   *  krater) står kun på pladser langt fra kunderne. */
  _udstyrForter() {
    const { forter } = this.terraen.fort;
    const H = forter.length;
    const antalMiner = 3 + Math.floor(this.rngSim() * 4) + Math.round(this.terraen.w / 2000);
    const antalToender = 1 + Math.floor(this.rngSim() * 3);
    const miner = Math.max(1, Math.round(antalMiner / H));
    const toender = Math.max(1, Math.round(antalToender / H));
    const orden = new Map();
    for (const f of forter) if (!orden.has(f.form)) orden.set(f.form, this.rngSim.bland(f.udstyr.map((_, j) => j)));
    const lister = forter.map((f) => orden.get(f.form).map((j) => f.udstyr[j])
      .filter((p) => this.baevere.every((b) => Math.hypot(b.x - p.x, b.y - p.y) >= 120)));
    // Lige mange af hver slags på hver borg: højst hvad den mindste har plads til.
    const nT = Math.min(toender, ...lister.map((l) => l.filter((p) => p.langt).length));
    const valgte = lister.map((l) => {
      const printere = l.filter((p) => p.langt).slice(0, nT);
      return { printere, rest: l.filter((p) => !printere.includes(p)) };
    });
    const nRest = Math.min(...valgte.map((q) => q.rest.length));
    const nM = Math.min(miner, nRest), nTlf = nRest > nM ? 1 : 0, nPil = nRest > nM + 1 ? 1 : 0;
    for (const { printere, rest } of valgte) {
      for (const p of printere) {
        this.placerede.push(E.lavPlaceret(this.nytId(), {
          x: p.x, y: p.y + 2, lunte: 0, naerhed: 0, armering: 0,
          detonation: { radius: 96, skade: 62, knockback: 380, carve: true },
          ejer: null, ejerHold: null, sprite: 'toende',
        }));
      }
      for (let n = 0; n < nM; n++) {
        const p = rest[n];
        this.placerede.push(E.lavPlaceret(this.nytId(), {
          x: p.x, y: p.y + 2, lunte: 0, naerhed: VAABEN.baevermine.placeret.naerhed, armering: 0,
          detonation: { radius: 52, skade: 42, knockback: 240, carve: true },
          ejer: null, ejerHold: null, sprite: 'mine',
        }));
      }
      if (nTlf) this._lavTelefon(rest[nM]);
      if (nPil) this._lavPiller(rest[nM + 1]);
    }
  }

  /** Udsæt bævere. Hold fordeles INTERLEAVED, så de starter blandet ud over
   *  banen i stedet for at klumpe sig hold for hold. */
  udsaet() {
    if (this.terraen.fort) { this._udsaetPaaFort(); return; }
    const pladser = this.rngSim.bland(this.startpladser.slice());
    const brugte = [];
    const perHold = new Map();
    for (const b of this.baevere) {
      if (!perHold.has(b.hold)) perHold.set(b.hold, []);
      perHold.get(b.hold).push(b);
    }
    const raekker = [...perHold.values()];
    const flettet = [];
    for (let i = 0; ; i++) {
      let tilfoejet = false;
      for (const r of raekker) if (r[i]) { flettet.push(r[i]); tilfoejet = true; }
      if (!tilfoejet) break;
    }

    for (const b of flettet) {
      let valgt = null;
      for (const p of pladser) {
        if (brugte.some((q) => Math.abs(q.x - p.x) < 90)) continue;
        valgt = p; break;
      }
      if (!valgt) valgt = pladser[brugte.length % pladser.length] ||
                         { x: 200 + brugte.length * 120, y: this.terraen.h * 0.7 };
      brugte.push(valgt);
      b.x = valgt.x; b.y = valgt.y;
      b.paaJorden = true;
      F.frigoer(this.terraen, b);
    }
    this.tur.tilstand = T.UDSAET;
    this.tur.tilstandTick = 0;
  }

  /** Fortbanen: klinik i står på fort i, én kunde pr. etage nedefra (de
   *  ekstra kunder side om side på de nederste etager, se terrain_gen.fortPlan).
   *  Kunderne vender ud ad deres skydeskår, mod fjenden (p.retning; i den
   *  dobbeltsidede midterborg er det forskelligt fra etage til etage). */
  _udsaetPaaFort() {
    const { forter } = this.terraen.fort;
    const naeste = new Map();                // hold -> næste ledige plads på fortet
    const reserve = [];
    for (const b of this.baevere) {
      const f = forter[b.hold];
      const j = naeste.get(b.hold) || 0;
      const p = f && f.pladser[j];
      if (!p) { reserve.push(b); continue; }
      naeste.set(b.hold, j + 1);
      b.x = p.x; b.y = p.y;
      b.retning = p.retning || f.retning || 1;
      b.paaJorden = true;
      F.frigoer(this.terraen, b);
    }
    // Flere kunder end planen har plads til (kan ikke ske med et layout fra
    // holdene): på en af udstyrspladserne på borgene.
    const pladser = this._udstyrsPladser();
    reserve.forEach((b, i) => {
      const p = pladser[(i * 7) % Math.max(1, pladser.length)] || { x: 200 + i * 120, y: this.terraen.h * 0.7 };
      b.x = p.x; b.y = p.y; b.paaJorden = true;
      F.frigoer(this.terraen, b);
    });
    this.tur.tilstand = T.UDSAET;
    this.tur.tilstandTick = 0;
  }

  /** Steder til miner, printere, telefoner, piller og kasser. På fortbanen
   *  er der intet land: pladserne ligger PÅ borgene — hallernes gulve, taget
   *  og keepens top, aldrig i kundernes rum og mindst 120 wu fra en
   *  startplads (terrain_gen.fortIndhold). Ellers er det findStartpladser —
   *  de andre baner får præcis de samme pladser som før. */
  _udstyrsPladser() {
    const fort = this.terraen.fort;
    if (fort) return fort.forter.flatMap((f) => f.udstyr);
    return findStartpladser(this.terraen, this.vandNiveau);
  }

  // ------------------------------------------------------------ opslag

  aktivBaever() {
    return this.baevere.find((b) => b.id === this.tur.baeverId) || null;
  }

  /** Alle spillere i kampen (pid'er), i fast rækkefølge. */
  _deltagere() {
    const s = new Set();
    for (const h of this.hold) for (const p of h.spillere || []) s.add(p);
    for (const b of this.baevere) if (b.ejer) s.add(b.ejer);
    return [...s].sort();
  }

  /** En spiller stemmer for at springe filmen over. Ved ét tastatur (pid
   *  null) sker det med det samme; over nettet, når et flertal af deltagerne
   *  har stemt (mere end halvdelen — ved to spillere altså begge). */
  _springFilm(pid) {
    if (this.tur.tilstand !== T.FILM) return;
    const sprunget = this.tur.filmSprunget || (this.tur.filmSprunget = []);
    if (pid != null && !sprunget.includes(pid)) sprunget.push(pid);
    if (pid == null || sprunget.length >= filmFlertal(this._deltagere().length)) this._slutFilm();
  }

  _slutFilm() {
    this.tur.tilstand = T.UDSAET;
    this.tur.tilstandTick = 0;
  }

  pidPaaHold(pid, holdId) {
    const h = this.hold[holdId];
    if (!h) return false;
    if (h.spillere.includes(pid)) return true;
    return this.baevere.some((b) => b.hold === holdId && b.ejer === pid);
  }

  accepterBevaegelse() {
    const t = this.tur.tilstand;
    if (t === T.SPILLER_AKTIV) return true;
    // Tilbagetog: bevægelse er tilladt mens uret løber, også midt i flugten.
    // AFFYRING er med: ellers blev et slip af piletasten i netop det tick
    // afvist, og kunden gik videre gennem hele tilbagetoget.
    if ((t === T.OPLOESNING || t === T.AFFYRING) && this.tur.retreatTil !== null) {
      return this.tick < this.tur.retreatTil;
    }
    return false;
  }

  accepterAffyring() {
    return this.tur.tilstand === T.SPILLER_AKTIV;
  }

  /** Internetnedbrud i denne runde: intet våben kan affyres (kun meta). */
  internetNede() { return this.haendelseNu?.slags === 'internet'; }

  vaabenNu() { return VAABEN[this.valgtVaaben]; }

  ammoFor(holdId, vaabenId) {
    const h = this.hold[holdId];
    if (!h) return 0;
    const a = h.ammo[vaabenId];
    return a === undefined ? 0 : a;
  }

  frigoerBaever(b) { F.frigoer(this.terraen, b); }

  /** Er våbnet allerede betalt i denne tur? Scannerens anden scanning må
   *  bruges, selv om lageret nu står på 0. */
  _forudbetalt(w) {
    const brugt = this.brugtPrVaaben[w.id] || 0;
    return brugt % (w.brugPrTur || 1) !== 0;
  }

  /** Våbnet, holdet står med, når det husker intet brugbart: første favorit
   *  med ammunition, ellers første våben med ammunition, ellers "Sæt på hold".
   *  Et valgt våben med 0 i lageret kan aldrig affyres, og HUD'en ville lyve. */
  _reserveVaaben(holdId) {
    for (const id of FAVORITTER) if (VAABEN[id] && this.ammoFor(holdId, id) !== 0) return id;
    for (const w of Object.values(VAABEN)) {
      if (w.kategori !== 'meta' && this.ammoFor(holdId, w.id) !== 0) return w.id;
    }
    return 'staa_over';
  }

  // ------------------------------------------------------------ kommandoer

  udfoerKommando(cmd, pid = null) {
    // Spring filmintroen over. Den har ingen aktiv kunde, så den går uden om
    // valider; kun deltagere tæller, og hvem der sendte den, følger med.
    if (cmd?.k === 'film') {
      if (this.tur.tilstand !== T.FILM) return { ok: false, fejl: 'ingen film' };
      if (pid != null && !this._deltagere().includes(pid)) return { ok: false, fejl: 'ikke med i kampen' };
      this.koe.push({ k: 'film', pid });
      return { ok: true };
    }
    const res = valider(this, cmd, pid);
    if (!res.ok) {
      // Skuddet afvist af internetnedbruddet: brugerfladen skal kunne sige
      // hvorfor, så afvisningen meldes som hændelse i næste tick.
      if (res.fejl === 'internet' && !this.koe.some((c) => c.k === 'afvist')) {
        this.koe.push({ k: 'afvist', grund: 'internet' });
      }
      return res;
    }
    this.koe.push(cmd);
    return { ok: true };
  }

  _draenKommandoer(h) {
    for (const cmd of this.koe) {
      if (cmd.k === 'hold') { this.holdt = cmd.b; continue; }
      if (cmd.k === 'film') { this._springFilm(cmd.pid); continue; }
      if (cmd.k === 'afvist') {
        h.push({ navn: 'skudAfvist', grund: cmd.grund, baever: this.tur.baeverId });
        continue;
      }
      this._handling(cmd, h);
    }
    this.koe.length = 0;
  }

  _handling(cmd, h) {
    const b = this.aktivBaever();
    if (!b) return;
    switch (cmd.h) {
      case 'vaelgVaaben': {
        if (!VAABEN[cmd.id]) return;
        if (this.ammoFor(b.hold, cmd.id) === 0 && !this._forudbetalt(VAABEN[cmd.id])) return;
        this.valgtVaaben = cmd.id;
        const w = VAABEN[cmd.id];
        this.valgtLunte = w.lunte ? w.lunte.start : 3;
        this.vaabenPrHold[b.hold] = { vaaben: this.valgtVaaben, lunte: this.valgtLunte };
        h.push({ navn: 'vaabenValgt', vaaben: cmd.id, baever: b.id });
        break;
      }
      case 'lunte':
        this.valgtLunte = Math.max(1, Math.min(5, cmd.v | 0));
        this.vaabenPrHold[b.hold] = { vaaben: this.valgtVaaben, lunte: this.valgtLunte };
        h.push({ navn: 'lunteSat', v: this.valgtLunte });
        break;
      case 'retning':
        b.retning = cmd.v >= 0 ? 1 : -1;
        break;
      case 'markoer':
        this.markoer.x = cmd.x; this.markoer.y = cmd.y;
        if (cmd.vinkel !== undefined) this.markoer.vinkel = cmd.vinkel;
        if (cmd.retning !== undefined) this.markoer.retning = cmd.retning;
        break;
      case 'staaOver':
        this._afslutTur(h, 'stod over');
        break;
      case 'panel':
        // Kun den aktive spiller kan sende den (valider); uret står højst
        // PANEL_PAUSE_LOFT tick stille pr. tur, se SPILLER_AKTIV.
        this.panelAabent = !!cmd.aaben;
        break;
      case 'affyr':
        // Mens boret arbejder, STOPPER et nyt tryk det i stedet for at skyde.
        if (b.redskab?.slags === 'bor') { b.redskab.stop = true; break; }
        this._affyr(b, cmd, h);
        break;
    }
  }

  _affyr(b, cmd, h) {
    // Flere affyr-kommandoer kan valideres før ét tick: kun den første tæller.
    if (this.tur.tilstand !== T.SPILLER_AKTIV) return;
    const w = this.vaabenNu();
    if (!w) return;
    // Internetnedbrud: valider har allerede afvist skuddet — men et våbenvalg
    // i samme tick kan have skiftet et meta-valg ud med et rigtigt våben.
    if (this.internetNede() && w.kategori !== 'meta') {
      h.push({ navn: 'skudAfvist', grund: 'internet', baever: b.id });
      return;
    }
    const hold = this.hold[b.hold];
    const ammo = this.ammoFor(b.hold, w.id);
    const forudbetalt = this._forudbetalt(w);
    if (ammo === 0 && !forudbetalt) return;

    const res = B.affyr(this, b, w, cmd.kraft ?? 0, {
      x: this.markoer.x, y: this.markoer.y,
      vinkel: this.markoer.vinkel, retning: this.markoer.retning,
    });
    res.forEach((e) => h.push(e));
    // Afvist (fx Fjernsupport uden et sikkert sted): intet brugt, turen fortsætter.
    if (res.afvist) return;

    // Ammunitionen betales ved FØRSTE brug; én ammunition rækker brugPrTur
    // gange i samme tur. Tælleren er pr. våben, så en scanning efterfulgt af
    // et andet våben ikke længere giver scanneren gratis.
    const maksBrug = w.brugPrTur || 1;
    if (!forudbetalt && ammo > 0) hold.ammo[w.id] = ammo - 1;
    this.brugtPrVaaben[w.id] = (this.brugtPrVaaben[w.id] || 0) + 1;
    this.brugtIDenneTur++;
    h.push({ navn: 'ammoAendret', hold: b.hold, vaaben: w.id, ammo: hold.ammo[w.id] });

    // Byggeredskaber og skjoldet: turen fortsætter — man bygger rampen eller
    // går hjemmefra og bruger resten af tiden på at gå og skyde.
    if (w.beholderTur) return;
    // Et aktivt redskab (boret) afslutter selv turen, når det stopper.
    if (b.redskab) return;

    if (w.afslutterTur || this.brugtPrVaaben[w.id] >= maksBrug) {
      // Tilbagetogsuret starter NU — mens projektilet stadig er i luften.
      this.tur.retreatTil = this.tick + (w.retreatTicks || 0);
      this.tur.fuldtTilbagetog = !!w.fuldtTilbagetog;
      this.tur.tilstand = T.AFFYRING;
      this.tur.tilstandTick = 0;
      this.opladerNu = false;
      this.opladning = 0;
    }
  }

  /** Boret er stoppet. Var det spillerens eget træk, slutter turen nu som
   *  efter et skud: tilbagetog og så opløsning. */
  _redskabFaerdig(b, vaabenId) {
    if (b.id !== this.tur.baeverId || this.tur.tilstand !== T.SPILLER_AKTIV) return;
    const w = VAABEN[vaabenId];
    this.tur.retreatTil = this.tick + (w?.retreatTicks ?? 150);
    this.tur.fuldtTilbagetog = false;
    this.tur.tilstand = T.AFFYRING;
    this.tur.tilstandTick = 0;
    this.opladerNu = false;
    this.opladning = 0;
    // Piletasterne styrede boret. Holdes de stadig, da boret stopper, må
    // kunden ikke bare gå videre i samme retning — ud over kanten og i havet.
    // Et nyt tryk (kantudløst fra brugerfladen) går igennem som normalt.
    this.holdt = 0;
  }

  // ------------------------------------------------------------ hovedskridt

  /** Avancér præcis ét 1/60 s skridt. Returnerer hændelser. */
  skridt() {
    const h = [];
    this.tick++;

    this._draenKommandoer(h);
    this._maskine(h);

    // Eksplosionskøen drænes én per tick — det giver klyngebomben sin rippel.
    // En eksplosion kan have et tidspunkt (et lig venter på det sorte hul).
    const iKoe = this.eksplosionsKoe.findIndex((e) => !(e.tick > this.tick));
    if (iKoe >= 0) {
      const e = this.eksplosionsKoe.splice(iKoe, 1)[0];
      D.eksploder(this, e.x, e.y, e.radius, e.skade, e.knockback, e.carve).forEach((x) => h.push(x));
    }

    // Forsinkede spawns (luftangreb, mursten) og forsinkede handlinger
    // (klasket, der rammer efter svinget): {tick, lav} eller {tick, udfoer}.
    for (let i = this.forsinkede.length - 1; i >= 0; i--) {
      const f = this.forsinkede[i];
      if (f.tick <= this.tick) {
        this.forsinkede.splice(i, 1);
        if (f.udfoer) f.udfoer(this, h);
        else this.projektiler.push(f.lav());
      }
    }

    this._fysik(h);
    D.tjekDrukning(this, h);

    // En kunde, der har lagt på, bærer ingen status — hverken kraftfelt,
    // smitte eller en ventende opdatering (spejlet viser ellers virus på liget).
    for (const b of this.baevere) {
      if (b.doed && (b.skjold || b.smittet || b.springOver)) { b.skjold = false; b.smittet = 0; b.springOver = 0; }
    }

    return h;
  }

  _fysik(h) {
    const t = this.terraen;

    for (const b of this.baevere) {
      if (b.doed) {
        // Dør kunden midt i en boring, stopper boret — det må ikke hænge.
        if (b.redskab) B.stopRedskab(this, b, h);
        continue;
      }
      if (b.redskab) {
        const vaabenId = b.redskab.vaaben;
        if (!B.skridtRedskab(this, b, h)) this._redskabFaerdig(b, vaabenId);
        continue;
      }
      const skade = F.skridtBaever(t, b, this.vind);
      if (skade) D.faldskade(this, b, skade, h);
      if (t.udenfor(b.x, b.y)) {
        b.hp = 0; b.doed = true; b.drukner = true;
        h.push({ navn: 'faldtUd', baever: b.id });
        if (!this.doedskoe.includes(b.id)) this.doedskoe.push(b.id);
      }
    }

    for (let i = this.projektiler.length - 1; i >= 0; i--) {
      const p = this.projektiler[i];
      let traef = F.skridtProjektil(t, p, this.vindNu(), this.baevere, F.luftmodstand(this.vejr));
      // Et skud, der rammer en printer direkte, går af dér (granater hopper videre).
      if (!traef && p.rammerBaevere && p.detonation && this.placerede.some((x) => x.sprite === 'toende' &&
          !x.doed && Math.abs(x.x - p.x) < 14 && p.y - x.y > -4 && p.y - x.y < 26)) {
        traef = { slags: 'printer' };
      }
      if (!traef) continue;
      this.projektiler.splice(i, 1);
      if (traef.slags === 'ude') { h.push({ navn: 'projektilUde', id: p.id }); continue; }
      if (p.klynge) B.delKlynge(this, p).forEach((e) => h.push(e));
      if (p.smitte) B.smitteSky(this, p.x, p.y, p.smitte, h);
      if (p.fyld) {
        // Papirbunken: bliver liggende som en bakke. Kunder, den lander på,
        // skubbes op ovenpå i stedet for at blive begravet.
        this.terraen.fyld(p.x, p.y, p.fyld.r);
        h.push({ navn: 'krater', x: p.x | 0, y: p.y | 0, r: p.fyld.r | 0, k: 3 });
        h.push({ navn: 'terraenBygget', slags: 'papir', x: p.x | 0, y: p.y | 0 });
        for (const bb of this.baevere) if (!bb.doed) this.frigoerBaever(bb);
      }
      const d = p.detonation;
      if (d) {
        const direkte = traef.slags === 'baever' ? traef.baever.id : null;
        D.eksploder(this, p.x, p.y, d.radius, d.skade, d.knockback, d.carve, direkte)
          .forEach((e) => h.push(e));
      }
    }

    for (let i = this.placerede.length - 1; i >= 0; i--) {
      const p = this.placerede[i];
      if (p.doed) { this.placerede.splice(i, 1); continue; }
      // skridtFaldende tæller alderen op — én gang pr. tick, så en armering
      // på 300 tick også ER 5 s.
      F.skridtFaldende(t, p, this.vindNu());
      if (p.lunte > 0) {
        p.lunte--;
        if (p.lunte === 0) {
          this.placerede.splice(i, 1);
          this.eksplosionsKoe.push({ x: p.x, y: p.y, ...p.detonation });
        }
      } else if (p.naerhed && p.alder > (p.armering || 0)) {
        const traf = this.baevere.some((b) => !b.doed &&
          Math.abs(b.x - p.x) < p.naerhed && Math.abs(b.y - p.y) < p.naerhed);
        if (traf) {
          this.placerede.splice(i, 1);
          this.eksplosionsKoe.push({ x: p.x, y: p.y, ...p.detonation });
        }
      }
    }

    for (let i = this.kasser.length - 1; i >= 0; i--) {
      const k = this.kasser[i];
      if (k.doed) { this.kasser.splice(i, 1); continue; }
      if (k.slags === 'telefon' || k.slags === 'helbred') {
        // Telefonen og pillerne står på jorden; sprænges jorden væk, falder de.
        if (k.landet && !t.fast(Math.round(k.x), Math.round(k.y) - 2)) { k.landet = false; k.paaJorden = false; }
        F.skridtFaldende(t, k);
        if (k.y < this.vandNiveau || t.udenfor(k.x, k.y)) { this.kasser.splice(i, 1); continue; }
      } else {
        // Sprænges jorden under en landet forsyningskasse, daler den videre.
        if (k.landet && !t.fast(Math.round(k.x), Math.round(k.y) - 2)) k.landet = false;
        F.skridtKasse(t, k, this.vindNu());
        // En forsyningskasse, der driver ud over havet, synker.
        if (k.y < this.vandNiveau) { this.kasser.splice(i, 1); continue; }
      }
      // Kasser samles op NÅR SOM HELST, ikke kun i egen tur — at samle en
      // kasse op midt i et knockback-flyv er et ægte Worms-øjeblik.
      for (const b of this.baevere) {
        if (b.doed) continue;
        if (Math.abs(b.x - k.x) < E.BAEVER_R + 14 &&
            Math.abs(b.y + E.BAEVER_R - k.y) < E.BAEVER_R + 16) {
          this._samlKasse(b, k, h);
          this.kasser.splice(i, 1);
          break;
        }
      }
    }
  }

  _samlKasse(b, k, h) {
    const hold = this.hold[b.hold];
    if (k.slags === 'telefon') { this._tagTelefon(b, k, h); return; }
    if (k.slags === 'helbred') {
      // Pillerne giver den fulde dosis — også over 100, op til PILLER_LOFT.
      const foer = b.hp;
      b.hp = Math.min(PILLER_LOFT, b.hp + k.indhold);
      h.push({ navn: 'kasseSamlet', baever: b.id, slags: k.slags, indhold: b.hp - foer, x: k.x, y: k.y });
      return;
    } else if (k.slags === 'vaaben') {
      const antal = kasseAntal(k.indhold);
      const nu = hold.ammo[k.indhold] ?? 0;
      if (nu >= 0) hold.ammo[k.indhold] = nu + antal;
      // Spejlet og gæsterne kender kun ammunition fra snapshots og denne hændelse.
      h.push({ navn: 'ammoAendret', hold: b.hold, vaaben: k.indhold, ammo: hold.ammo[k.indhold] });
      h.push({ navn: 'kasseSamlet', baever: b.id, slags: k.slags, indhold: k.indhold, antal, x: k.x, y: k.y });
      return;
    }
    h.push({ navn: 'kasseSamlet', baever: b.id, slags: k.slags, indhold: k.indhold, x: k.x, y: k.y });
  }

  // ------------------------------------------------------------ turmaskine

  _maskine(h) {
    const tur = this.tur;
    tur.tilstandTick++;

    switch (tur.tilstand) {
      case T.FILM:
        if (tur.tilstandTick >= (tur.filmTicks || 0)) this._slutFilm();
        break;

      case T.UDSAET:
        // 4 s: introens nedtælling (ui/intro.js) når at blive færdig.
        if (tur.tilstandTick > 240) this._turStart(h);
        break;

      case T.TUR_START:
        if (this._aktivErDoed()) { this._afslutTur(h, 'kunden døde'); break; }
        if (tur.tilstandTick >= TU.TUR_START_TICKS) {
          // Tvangsopdateret: kameraet har fundet kunden, men den installerer
          // opdateringer og springer turen over. _afslutTur tager den normale
          // vej til næste tur, så naesteBaever aldrig kan give null her.
          const akt = this.aktivBaever();
          if (akt.springOver) {
            akt.springOver = 0;
            h.push({ navn: 'turSprungetOver', baever: akt.id, hold: akt.hold });
            this._afslutTur(h, 'opdaterer');
            break;
          }
          tur.tilstand = T.SPILLER_AKTIV;
          tur.tilstandTick = 0;
          h.push({ navn: 'dinTur', baever: tur.baeverId, hold: tur.holdIdx });
        }
        break;

      case T.SPILLER_AKTIV: {
        // Dør kunden midt i sin egen tur (vand, mine, fald), går turen videre
        // med det samme i stedet for at vente på, at uret løber ud.
        if (this._aktivErDoed()) { this._afslutTur(h, 'kunden døde'); break; }
        this._styr(h);
        if (!this.panelAabent) tur.tickTilbage--;
        else if (tur.pausetTick < TU.PANEL_PAUSE_LOFT) tur.pausetTick++;
        else tur.tickTilbage--;
        if (tur.tickTilbage <= 0) {
          // Løber uret ud midt i en boring, borer kunden færdig; turen
          // slutter, når boret stopper (_redskabFaerdig).
          if (this.aktivBaever()?.redskab) tur.tickTilbage = 0;
          else this._afslutTur(h, 'tiden løb ud');
        }
        break;
      }

      case T.AFFYRING:
        tur.tilstand = T.OPLOESNING;
        tur.tilstandTick = 0;
        tur.oploesningTick = 0;
        tur.roTael = 0;
        break;

      case T.OPLOESNING: {
        // Bevægelse er stadig tilladt mens tilbagetogsuret løber.
        if (this.accepterBevaegelse()) this._styr(h, true);
        tur.oploesningTick++;
        // Går kunden stadig, mens tilbagetogsuret løber, er turen ikke slut:
        // ellers kappede en hurtig ro tilbagetoget over midt i et skridt.
        const traekker = this.accepterBevaegelse() && (this.holdt & (K.VENSTRE | K.HOEJRE));
        // Minen: turen venter på HELE tilbagetoget, også når verden er i ro,
        // så man kan nå væk, før den bliver skarp.
        const venter = tur.fuldtTilbagetog && tur.retreatTil !== null && this.tick < tur.retreatTil;
        if (TU.erIRo(this) && !traekker && !venter) {
          tur.roTael++;
          if (tur.roTael >= TU.RO_HYSTERESE) { tur.tilstand = T.SKADE; tur.tilstandTick = 0; }
        } else {
          tur.roTael = 0;
        }
        if (tur.oploesningTick > TU.RO_VAGTHUND) {
          TU.tvungenRo(this, h);
          tur.tilstand = T.SKADE;
          tur.tilstandTick = 0;
        }
        break;
      }

      case T.SKADE:
        if (this.doedskoe.length) {
          D.afvikleDoedsfald(this, h);
          // Et lig detonerer, så verden skal falde til ro igen.
          tur.tilstand = T.OPLOESNING;
          tur.oploesningTick = 0;
          tur.roTael = 0;
        } else if (this.eksplosionsKoe.length) {
          tur.tilstand = T.OPLOESNING;
          tur.oploesningTick = 0;
          tur.roTael = 0;
        } else if (tur.tilstandTick < (this.skadeITur ? EFTERSPIL_SKADE : EFTERSPIL)) {
          // Efterspil: verden er i ro, og skaden tælles ned på skærmen, før
          // turen går videre — ellers løber handlingerne sammen.
        } else {
          tur.tilstand = T.TUR_SLUT;
          tur.tilstandTick = 0;
        }
        break;

      case T.TUR_SLUT:
        this._turSlut(h);
        break;

      case T.SEJR:
      default:
        break;
    }
  }

  _aktivErDoed() {
    const b = this.aktivBaever();
    return !b || b.doed;
  }

  /** Oversæt holdte taster til bevægelse. Én gang per tick. */
  _styr(h, kunBevaegelse = false) {
    const b = this.aktivBaever();
    if (!b || b.doed) return;
    // Boret styres af de samme taster (behaviours.skridtRedskab); et hop
    // trykket under boringen skal ikke udløses bagefter.
    if (b.redskab) { this.holdt &= ~(K.HOP | K.SALTO); return; }
    const k = this.holdt;

    if (k & K.VENSTRE) { b.retning = -1; F.gaa(this.terraen, b, -1); }
    else if (k & K.HOEJRE) { b.retning = 1; F.gaa(this.terraen, b, 1); }

    if (k & K.HOP) { if (F.hop(b, false)) h.push({ navn: 'hop', baever: b.id }); this.holdt &= ~K.HOP; }
    if (k & K.SALTO) { if (F.hop(b, true)) h.push({ navn: 'salto', baever: b.id }); this.holdt &= ~K.SALTO; }

    if (kunBevaegelse) return;

    // Sigtet accelererer efter 0,4 s, så både finsigte og store spring er let.
    const fin = (k & K.FIN) ? 0.25 : 1;
    const holdt = this._sigteTael || 0;
    const fart = (holdt > 24 ? 2.5 : 1) * fin * (Math.PI / 180);
    if (k & K.SIGT_OP) { b.vinkel = Math.min(Math.PI / 2, b.vinkel + fart); this._sigteTael = holdt + 1; }
    else if (k & K.SIGT_NED) { b.vinkel = Math.max(-Math.PI / 2, b.vinkel - fart); this._sigteTael = holdt + 1; }
    else this._sigteTael = 0;

    if (k & K.LAD) {
      this.opladerNu = true;
      const w = this.vaabenNu();
      const tid = w?.kraft?.opladTid || 63;
      this.opladning = Math.min(1, this.opladning + 1 / tid);
    } else if (this.opladerNu) {
      // Slip = affyr. Kommandoen kommer fra brugerfladen som en handling, så
      // værten validerer den ad samme vej som alt andet input.
      this.opladerNu = false;
    }
  }

  _turStart(h) {
    // Begynder turen en ny runde, kommer rundens hændelse FØR turen.
    this._maaskeNyRunde(h);
    const naeste = TU.naesteBaever(this);
    if (!naeste) { this._sejr(h); return; }
    this.tur.holdIdx = naeste.holdIdx;
    this.tur.baeverId = naeste.baever.id;
    this.tur.tickTilbage = this._turTicks();
    this.tur.pausetTick = 0;
    this.tur.retreatTil = null;
    this.tur.tilstand = T.TUR_START;
    this.tur.tilstandTick = 0;
    this.tur.turNr++;
    this.tur.fuldtTilbagetog = false;
    this.tur.smitteKoert = false;
    this.brugtIDenneTur = 0;
    this.brugtPrVaaben = {};
    this.panelAabent = false;
    this.skadeITur = false;
    this.opladning = 0;
    this.opladerNu = false;
    this.holdt = 0;

    // Hjemmearbejdet slutter, når holdet er på igen.
    for (const b of this.baevere) {
      if (b.skjold && b.hold === naeste.holdIdx) {
        b.skjold = false;
        if (!b.doed) h.push({ navn: 'skjoldSlut', baever: b.id });
      }
    }

    TU.rulVind(this);
    const skift = TU.maaskeSkiftVejr(this);

    // Holdets eget sidste valg — og kun hvis holdet stadig har ammunition til
    // det. Meta (Sæt på hold, Opsig aftalen) huskes aldrig.
    const husk = this.vaabenPrHold[naeste.baever.hold];
    const huskW = VAABEN[husk?.vaaben];
    this.valgtVaaben = huskW && huskW.kategori !== 'meta' &&
                       this.ammoFor(naeste.baever.hold, huskW.id) !== 0
      ? huskW.id : this._reserveVaaben(naeste.baever.hold);
    const wNu = VAABEN[this.valgtVaaben];
    this.valgtLunte = husk?.vaaben === this.valgtVaaben ? husk.lunte
                    : (wNu?.lunte ? wNu.lunte.start : 3);

    h.push({ navn: 'turStart', baever: naeste.baever.id, hold: naeste.holdIdx,
             vind: this.vind, vejr: this.vejr, vejrSkift: skift, turNr: this.tur.turNr,
             tid: this.tur.tickTilbage });
  }

  _afslutTur(h, grund) {
    if (this.tur.tilstand === T.TUR_SLUT || this.tur.tilstand === T.SEJR) return;
    this.tur.tilstand = T.OPLOESNING;
    this.tur.tilstandTick = 0;
    this.tur.oploesningTick = 0;
    this.tur.roTael = 0;
    if (this.tur.retreatTil === null) this.tur.retreatTil = this.tick;
    h.push({ navn: 'turAfsluttet', grund });
  }

  _turSlut(h) {
    // COVID gøres op én gang pr. tur, før næste tur. Dør nogen af det, skal
    // dødsfaldene afvikles først; så kommer vi tilbage hertil, og resten af
    // turskiftet kører (uden et nyt opgør).
    if (!this.tur.smitteKoert) {
      this.tur.smitteKoert = true;
      D.smitteVedTurSlut(this, h);
      if (this.doedskoe.length) { this.tur.tilstand = T.SKADE; this.tur.tilstandTick = 0; return; }
    }

    // Kampuret tjekkes KUN her, så pludselig død aldrig afbryder midt i et skud.
    if (!this.pludseligDoed && this.tick >= this.cfg.kampTicks) {
      TU.udloesSuddenDeath(this, h);
    } else if (this.pludseligDoed) {
      TU.hoevVand(this, h);
    }

    this._maaskeKasse(h);

    const s = TU.tjekSejr(this);
    if (s.slut) { this._sejr(h, s.vinder); return; }

    this._turStart(h);
  }

  // ------------------------------------------------------------ telefonen

  /** En telefon, der står og ringer på et sted, man kan gå hen til. */
  _lavTelefon(p) {
    const k = E.lavKasse(this.nytId(), { slags: 'telefon', indhold: null, x: p.x, y: p.y + 1 });
    k.landet = true; k.paaJorden = true;
    this.kasser.push(k);
    return k;
  }

  _telefoner() { return this.kasser.filter((k) => k.slags === 'telefon' && !k.doed).length; }

  /** Et pilleglas på jorden: +50 tålmodighed til den, der går ind i det. */
  _lavPiller(p) {
    const k = E.lavKasse(this.nytId(), { slags: 'helbred', indhold: PILLER_HP, x: p.x, y: p.y + 1 });
    k.landet = true; k.paaJorden = true;
    this.kasser.push(k);
    return k;
  }

  /** Efter hver tur, måske: 55 % en forsyningskasse i faldskærm, 25 % en
   *  ringende telefon, 20 % piller. Er der ikke plads til telefonen eller
   *  pillerne, bliver det en forsyningskasse i stedet. */
  _maaskeKasse(h) {
    if (this.rngSim() > this.cfg.kasseChance) return;
    const pladser = this._udstyrsPladser();
    if (!pladser.length) return;
    const p = pladser[Math.floor(this.rngSim() * pladser.length)];
    const piller = this.kasser.filter((k) => k.slags === 'helbred' && !k.doed).length;
    const rul = this.rngSim();
    if (rul >= 0.55 && rul < 0.80 && this._telefoner() < TELEFON_MAKS) {
      const k = this._lavTelefon(p);
      h.push({ navn: 'telefonRinger', id: k.id, x: k.x, y: k.y });
      return;
    }
    if (rul >= 0.80 && piller < PILLER_MAKS) {
      const k = this._lavPiller(p);
      h.push({ navn: 'pillerDukketOp', id: k.id, x: k.x, y: k.y });
      return;
    }
    if (this._ledigeKassepladser() <= 0) return;
    this._slipVaabenkasse(p, h);
  }

  /** Hvor mange våbenkasser der endnu er plads til på banen. */
  _ledigeKassepladser() {
    return VAABENKASSE_MAKS - this.kasser.filter((k) => k.slags === 'vaaben' && !k.doed).length;
  }

  /** Slip en forsyningskasse med et tilfældigt våben over udstyrspladsen p.
   *  Over land (en startplads), et stykke over jorden; den daler i
   *  faldskærm (physics.skridtKasse) og driver lidt med vinden. På
   *  fortbanen er udstyrspladsen måske inde i borgen, så kassen slippes
   *  over en af borgenes toppe (taget eller et tårn), man kan komme op på —
   *  helst ikke over de x'er i undgaa (flere kasser på én gang). */
  _slipVaabenkasse(p, h, undgaa = null) {
    const indhold = tilfaeldigtKassevaaben(this.rngSim);
    let kx = p.x, ky = p.y;
    if (this.terraen.fort) {
      let toppe = this.terraen.fort.forter.flatMap((f) => f.kasser);
      if (undgaa?.length) {
        const fri = toppe.filter((x) => undgaa.every((u) => Math.abs(u - x) > 60));
        if (fri.length) toppe = fri;
      }
      kx = toppe[Math.floor(this.rngSim() * toppe.length)] ?? p.x;
      ky = Math.max(0, this.terraen.overflade(kx));
    }
    const y = Math.min(this.terraen.h - 40, ky + KASSE_FALDHOEJDE);
    const k = E.lavKasse(this.nytId(), { slags: 'vaaben', indhold, x: kx, y });
    this.kasser.push(k);
    h.push({ navn: 'kasseFalder', id: k.id, x: k.x, y: k.y, slags: k.slags });
    return k;
  }

  /** Kunden tager røret: et tilfældigt opkald, og det udløser sin hændelse. */
  _tagTelefon(b, k, h) {
    const nr = Math.floor(this.rngSim() * OPKALD.length);
    const o = OPKALD[nr];
    const e = { navn: 'telefonOpkald', baever: b.id, hold: b.hold, x: k.x, y: k.y, opkald: nr };
    const hold = this.hold[b.hold];
    switch (o.effekt) {
      case 'forstaerkning': {
        // Samme pulje og samme antal som forsyningskasserne.
        const id = tilfaeldigtKassevaaben(this.rngSim);
        const antal = kasseAntal(id);
        const nu = hold.ammo[id] ?? 0;
        if (nu >= 0) hold.ammo[id] = nu + antal;
        e.vaaben = id; e.antal = antal;
        h.push({ navn: 'ammoAendret', hold: b.hold, vaaben: id, ammo: hold.ammo[id] });
        break;
      }
      // Aldrig negativ: har pillerne løftet kunden over 100, tager recepten intet.
      case 'recept': e.hp = Math.max(0, Math.min(E.MAKS_HP, b.hp + 30) - b.hp); b.hp += e.hp; break;
      case 'klage': e.hp = -15; D.givSkade(this, b, 15, 'klage', h); break;
      case 'mursten': this._stenskred(k.x, 260, 5); break;
      case 'uvejr': this._uvejr(); e.vind = this.vind; e.vejr = this.vejr; break;
      case 'spam': {
        const pladser = this.rngSim.bland(this._udstyrsPladser().slice());
        let n = 0;
        for (const p of pladser) {
          if (n >= 3) break;
          if (this.baevere.some((x) => !x.doed && Math.abs(x.x - p.x) < 80)) continue;
          this.placerede.push(E.lavPlaceret(this.nytId(), {
            x: p.x, y: p.y + 2, lunte: 0, naerhed: VAABEN.baevermine.placeret.naerhed, armering: 60,
            detonation: { radius: 52, skade: 42, knockback: 240, carve: true },
            ejer: null, ejerHold: null, sprite: 'mine',
          }));
          n++;
        }
        e.antal = n;
        break;
      }
      case 'viderestil': {
        // På fortbanen: et sted på kundens egen borg, man kan gå fra (en
        // hal, taget eller keepens top) — aldrig ind i fjendens borg.
        const egne = this.terraen.fort ? (this.terraen.fort.forter[b.hold]?.udstyr || []) : null;
        const pladser = (egne || findStartpladser(this.terraen, this.vandNiveau))
          .filter((p) => Math.abs(p.x - b.x) > (egne ? 200 : 400));
        if (!pladser.length) break;
        const p = pladser[Math.floor(this.rngSim() * pladser.length)];
        // Borer kunden, slutter boret FØR flytningen — ellers gravede næste
        // kapsel en rende fra det gamle sted til det nye.
        if (b.redskab) { const vid = b.redskab.vaaben; B.stopRedskab(this, b, h); this._redskabFaerdig(b, vid); }
        h.push({ navn: 'teleport', baever: b.id, fraX: b.x, fraY: b.y, x: p.x, y: p.y });
        b.x = p.x; b.y = p.y; b.vx = 0; b.vy = 0; b.paaJorden = true; b.faldFra = null;
        F.frigoer(this.terraen, b);
        break;
      }
    }
    h.push(e);
  }

  /** Mursten fra loftet langs et bælte om midte. */
  _stenskred(midte, spredning = 520, antal = 3 + Math.floor(this.rngSim() * 4)) {
    for (let i = 0; i < antal; i++) {
      this.forsinkede.push({
        tick: this.tick + i * 14,
        lav: () => E.lavProjektil(this.nytId(), {
          x: midte + (this.rngSim() - 0.5) * spredning,
          y: this.terraen.h + 50,
          vx: (this.rngSim() - 0.5) * 40, vy: -260,
          r: 6, vindFaktor: 0.15, hop: 0, rammerBaevere: true,
          detonation: { radius: 40, skade: 26, knockback: 150, carve: true },
          ejer: null, ejerHold: null, sprite: 'sten', spor: null,
        }),
      });
    }
  }

  /** Uvejr: vinden springer kraftigt, og vejret skifter. */
  _uvejr() {
    this.vejr = this.rngSim() < 0.5 ? 'regn' : 'slud';
    this.vind = Math.max(-1, Math.min(1, (this.rngSim() - 0.5) * 3.2));
    this.vind = Math.round(this.vind * 20) / 20;
  }

  /**
   * Runder og tilfældige hændelser (sim/haendelser.js).
   *
   * En runde er en hel omgang, hvor hver levende klinik har haft én tur. Når
   * næste tur slår rækkefølgen rundt (TU.nyRunde, uden at flytte noget),
   * begynder en ny runde: den forrige rundes hændelse slutter, og fra runde 3
   * er der en fast chance for en ny — altid i starten af runden, lige før
   * dens første tur, og uafhængigt af, hvor mange runder der er gået.
   */
  _maaskeNyRunde(h) {
    if (!TU.nyRunde(this)) return;
    this.tur.runde = (this.tur.runde || 0) + 1;
    this.haendelseNu = null;
    if (this.tur.runde >= HN.HAENDELSE_FRA_RUNDE) HN.maaskeHaendelse(this, h);
  }

  /** Turens længde: myldretid halverer den, og under et internetnedbrud er
   *  der kun 12 s (man kan alligevel kun gå og hoppe). */
  _turTicks() {
    const slags = this.haendelseNu?.slags;
    if (slags === 'internet') return Math.min(this.cfg.turTicks, HN.INTERNET_TUR_TICKS);
    if (slags === 'myldretid') return Math.round(this.cfg.turTicks / 2);
    return this.cfg.turTicks;
  }

  /** Effektiv vind lige nu: rul x vejr x vindstød. Se physics.vindNu. */
  vindNu() { return F.vindNu(this.vind, this.vejr, this.tick, this.froe); }

  _sejr(h, vinder) {
    this.tur.tilstand = T.SEJR;
    this.slut = { vinder: vinder ?? null, stilling: TU.stilling(this) };
    h.push({ navn: 'sejr', vinder: this.slut.vinder, stilling: this.slut.stilling });
  }

  // ------------------------------------------------------------ start

  startKamp() {
    this.udsaet();
    this._udstyrBanen();
    // Filmintroen først (kun når klinikkernes ansatte er med). Længden er
    // regnet ud fra opstillingen alene, så alle er enige om, hvornår den
    // første tur starter; tur-felterne følger med i snapshottet.
    const film = filmTicks(this.hold, this.baevere);
    if (film > 0) {
      this.tur.tilstand = T.FILM;
      this.tur.tilstandTick = 0;
      this.tur.filmTicks = film;
      this.tur.filmSprunget = [];
    }
    return [{ navn: 'kampStartet', froe: this.froeBrugt, banetype: this.banetype,
              vejr: this.vejr, vand: this.vandNiveau }];
  }

  // ------------------------------------------------------------ serialisering

  oejebliksbillede() { return tagSnapshot(this); }
  delta() { return tagDelta(this); }

  genskab(snap) {
    this.froe = snap.froe;
    this.cfg = snap.cfg;
    this.banetype = snap.banetype;
    this.vejr = snap.vejr;
    this.vind = snap.vind;
    this.vandNiveau = snap.vandNiveau;
    this.pludseligDoed = snap.pludseligDoed;
    this.antalHold = snap.antalHold;
    this.tick = snap.tick;

    // Et snapshot ankommer ved HVERT turskift. At regenerere banen hver gang
    // ville koste ~170 ms og gøre turskift til et hak. Har vi allerede det
    // rigtige terræn, afspiller vi kun de ops vi mangler.
    // Fortets layout kommer med snapshottet (ældre snapshots: udledt af holdene).
    const layout = snap.layout || lavLayout(snap.antalHold, snap.baevere);
    const sammeBane = this.terraen && this.terraen.w === snap.terraen.w &&
                      this.froeBrugt === snap.froe &&
                      (this.banetype !== 'fort' || sammeLayout(this.layout, layout));
    this.layout = layout;
    if (!sammeBane) {
      const res = genererSpilbar(this.froe, this.banetype, Math.max(2, snap.baevere.length), this.layout);
      this.terraen = res.terraen;
      this.startpladser = res.pladser;
      this.froeBrugt = res.froe;
      this.terraen.afspil(snap.terraen.ops);
    } else if (snap.terraen.ops.length !== this.terraen.ops.length) {
      const har = this.terraen.ops.length;
      const mangler = snap.terraen.ops.slice(har);
      if (snap.terraen.ops.length < har) {
        // Vi er foran serveren (kan ske efter et hul) — byg forfra.
        const res = genererSpilbar(this.froe, this.banetype, Math.max(2, snap.baevere.length), this.layout);
        this.terraen = res.terraen;
        this.startpladser = res.pladser;
        this.froeBrugt = res.froe;
        this.terraen.afspil(snap.terraen.ops);
      } else if (mangler.length) {
        // Kun de nye ops — de tidligere er allerede stemplet i masken.
        this.terraen.anvendOps(mangler);
        this.terraen.ops = snap.terraen.ops.slice();
      }
    }

    this.hold = snap.hold.map((h) => ({ ...h }));
    this.baevere = snap.baevere.map((b) => ({ ...E.lavBaever(b.id, b.hold, b.navn, b.udseende, b.ejer), ...b }));
    this.projektiler = snap.projektiler.map((p) => ({ ...p, type: 'projektil', alder: 0, sover: p.sover }));
    this.placerede = snap.placerede.map((p) => ({ ...p, armerRest: E.armerRest(p) }));
    this.kasser = snap.kasser.map((k) => ({ ...k }));
    this.gravsten = snap.gravsten.map((g) => ({ ...g }));
    this.tur = { ...snap.tur };
    this.sidsteBaeverPrHold = { ...snap.sidsteBaeverPrHold };
    this.vaabenPrHold = { ...(snap.vaabenPrHold || {}) };
    this.haendelseNu = snap.haendelseNu ? { ...snap.haendelseNu } : null;
    this.sidsteHaendelse = snap.sidsteHaendelse ?? null;
    if (snap.valgtVaaben) this.valgtVaaben = snap.valgtVaaben;
    if (snap.valgtLunte) this.valgtLunte = snap.valgtLunte;
    this.rngSim.saet(snap.rng);
    this._id = snap.naesteId;
    this.eksplosionsKoe = [];
    this.forsinkede = [];
    this.doedskoe = [];
    this.koe = [];
  }

  /** FNV over den tilstand der betyder noget. Gør desync til noget der
   *  rapporteres frem for noget der opdages, fordi en bæver falder gennem
   *  en bakke. */
  aftryk() {
    let h = 0x811c9dc5;
    const bland = (n) => {
      const v = Math.round(n * 100) | 0;
      for (let i = 0; i < 4; i++) {
        h ^= (v >>> (i * 8)) & 0xFF;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    };
    bland(this.tick);
    bland(this.vandNiveau);
    for (const b of this.baevere) { bland(b.id); bland(b.x); bland(b.y); bland(b.hp); bland(b.doed ? 1 : 0); }
    for (const p of this.projektiler) { bland(p.id); bland(p.x); bland(p.y); }
    h ^= this.terraen.aftryk();
    return h >>> 0;
  }
}

export { FAVORITTER, VAABEN, K };
