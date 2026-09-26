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
import { VAABEN, startAmmo, tilfaeldigtKassevaaben, FAVORITTER } from './weapons.js';
import { valider, K } from './commands.js';
import { OPKALD, TELEFON_MAKS } from './opkald.js';

/* Ro mellem handlingerne (tick): efter en tur uden skade, og efter en tur,
 * hvor nogen blev ramt — så nedtællingen og reaktionen når at blive set. */
const EFTERSPIL = 45, EFTERSPIL_SKADE = 100;

/* Pillerne: hvor meget de giver, hvor højt tålmodigheden kan nå med dem, og
 * hvor mange glas der højst står på banen. */
const PILLER_HP = 50, PILLER_LOFT = 150, PILLER_MAKS = 2;
import { tagSnapshot, tagDelta } from './snapshot.js';

export const T = TU.T;

const STANDARD_CFG = {
  turTicks: 45 * HZ,
  kampTicks: 30 * 60 * HZ,
  vind: true,
  vejr: 'auto',
  banetype: 'aaben',
  ammoSkema: 'standard',
  kasseChance: 0.28,
};

export function lavVerden(opsaet) {
  const v = new Verden(opsaet);
  return v;
}

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
    this.valgtVaaben = 'grenroer';
    this.valgtLunte = 3;
    this.markoer = { x: 0, y: 0, vinkel: 0, retning: 1 };
    this.hold = [];
    this.antalHold = 0;
    this.holdt = 0;                    // bitmaske af holdte taster
    this.opladning = 0;
    this.opladerNu = false;
    this.brugtIDenneTur = 0;
    this.koe = [];                     // kommandoer der venter på næste tick
    this.slut = null;

    if (opsaet.hold) this._saetOpHold(opsaet.hold);
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
    const res = genererSpilbar(this.froe, this.banetype, Math.max(2, this.baevere.length));
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
    const pladser = findStartpladser(this.terraen, this.vandNiveau);
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
        x: p.x, y: p.y + 2, lunte: 0, naerhed: 38, armering: 0,
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

  /** Udsæt bævere. Hold fordeles INTERLEAVED, så de starter blandet ud over
   *  banen i stedet for at klumpe sig hold for hold. */
  udsaet() {
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

  // ------------------------------------------------------------ opslag

  aktivBaever() {
    return this.baevere.find((b) => b.id === this.tur.baeverId) || null;
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
    if (t === T.OPLOESNING && this.tur.retreatTil !== null) {
      return this.tick < this.tur.retreatTil;
    }
    return false;
  }

  accepterAffyring() {
    return this.tur.tilstand === T.SPILLER_AKTIV;
  }

  vaabenNu() { return VAABEN[this.valgtVaaben]; }

  ammoFor(holdId, vaabenId) {
    const h = this.hold[holdId];
    if (!h) return 0;
    const a = h.ammo[vaabenId];
    return a === undefined ? 0 : a;
  }

  frigoerBaever(b) { F.frigoer(this.terraen, b); }

  // ------------------------------------------------------------ kommandoer

  udfoerKommando(cmd, pid = null) {
    const res = valider(this, cmd, pid);
    if (!res.ok) return res;
    this.koe.push(cmd);
    return { ok: true };
  }

  _draenKommandoer(h) {
    for (const cmd of this.koe) {
      if (cmd.k === 'hold') { this.holdt = cmd.b; continue; }
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
        if (this.ammoFor(b.hold, cmd.id) === 0) return;
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
      case 'affyr':
        this._affyr(b, cmd, h);
        break;
    }
  }

  _affyr(b, cmd, h) {
    const w = this.vaabenNu();
    if (!w) return;
    const hold = this.hold[b.hold];
    const ammo = this.ammoFor(b.hold, w.id);
    if (ammo === 0) return;

    B.affyr(this, b, w, cmd.kraft ?? 0, {
      x: this.markoer.x, y: this.markoer.y,
      vinkel: this.markoer.vinkel, retning: this.markoer.retning,
    }).forEach((e) => h.push(e));

    this.brugtIDenneTur++;
    const maksBrug = w.brugPrTur || 1;
    const braendteAmmo = this.brugtIDenneTur >= maksBrug;
    if (braendteAmmo && ammo > 0) hold.ammo[w.id] = ammo - 1;

    if (w.afslutterTur || braendteAmmo) {
      // Tilbagetogsuret starter NU — mens projektilet stadig er i luften.
      this.tur.retreatTil = this.tick + (w.retreatTicks || 0);
      this.tur.tilstand = T.AFFYRING;
      this.tur.tilstandTick = 0;
      this.opladerNu = false;
      this.opladning = 0;
    }
    h.push({ navn: 'ammoAendret', hold: b.hold, vaaben: w.id, ammo: hold.ammo[w.id] });
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

    // Forsinkede spawns (luftangreb).
    for (let i = this.forsinkede.length - 1; i >= 0; i--) {
      if (this.forsinkede[i].tick <= this.tick) {
        this.projektiler.push(this.forsinkede[i].lav());
        this.forsinkede.splice(i, 1);
      }
    }

    this._fysik(h);
    D.tjekDrukning(this, h);

    return h;
  }

  _fysik(h) {
    const t = this.terraen;

    for (const b of this.baevere) {
      if (b.doed) continue;
      if (b.redskab) { B.skridtRedskab(this, b, h); continue; }
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
      F.skridtFaldende(t, p, this.vindNu());
      p.alder++;
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
        F.skridtKasse(t, k, this.vindNu());
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
      const nu = hold.ammo[k.indhold];
      if (nu >= 0) hold.ammo[k.indhold] = nu + 2;
    }
    h.push({ navn: 'kasseSamlet', baever: b.id, slags: k.slags, indhold: k.indhold, x: k.x, y: k.y });
  }

  // ------------------------------------------------------------ turmaskine

  _maskine(h) {
    const tur = this.tur;
    tur.tilstandTick++;

    switch (tur.tilstand) {
      case T.UDSAET:
        // 4 s: introens nedtælling (ui/intro.js) når at blive færdig.
        if (tur.tilstandTick > 240) this._turStart(h);
        break;

      case T.TUR_START:
        if (this._aktivErDoed()) { this._afslutTur(h, 'kunden døde'); break; }
        if (tur.tilstandTick >= TU.TUR_START_TICKS) {
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
        if (tur.tickTilbage <= 0) this._afslutTur(h, 'tiden løb ud');
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
        if (TU.erIRo(this)) {
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
    if (!b || b.doed || b.redskab) return;
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
    const naeste = TU.naesteBaever(this);
    if (!naeste) { this._sejr(h); return; }
    this.tur.holdIdx = naeste.holdIdx;
    this.tur.baeverId = naeste.baever.id;
    this.tur.tickTilbage = this.cfg.turTicks;
    this.tur.pausetTick = 0;
    this.tur.retreatTil = null;
    this.tur.tilstand = T.TUR_START;
    this.tur.tilstandTick = 0;
    this.tur.turNr++;
    this.brugtIDenneTur = 0;
    this.skadeITur = false;
    this.opladning = 0;
    this.opladerNu = false;
    this.holdt = 0;

    TU.rulVind(this);
    const skift = TU.maaskeSkiftVejr(this);

    // Holdets eget sidste valg — og kun hvis holdet stadig har ammunition til det.
    const husk = this.vaabenPrHold[naeste.baever.hold];
    this.valgtVaaben = husk?.vaaben || 'grenroer';
    if (this.ammoFor(naeste.baever.hold, this.valgtVaaben) === 0) this.valgtVaaben = 'grenroer';
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
    // Kampuret tjekkes KUN her, så pludselig død aldrig afbryder midt i et skud.
    if (!this.pludseligDoed && this.tick >= this.cfg.kampTicks) {
      TU.udloesSuddenDeath(this, h);
    } else if (this.pludseligDoed) {
      TU.hoevVand(this, h);
    }

    this._maaskeKasse(h);
    this._maaskeHaendelse(h);

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

  _maaskeKasse(h) {
    if (this.rngSim() > this.cfg.kasseChance) return;
    const pladser = findStartpladser(this.terraen, this.vandNiveau);
    if (!pladser.length) return;
    const p = pladser[Math.floor(this.rngSim() * pladser.length)];
    const piller = this.kasser.filter((k) => k.slags === 'helbred' && !k.doed).length;
    // Halvdelen af gangene en telefon, ellers piller — så længe der er plads.
    if (this.rngSim() < 0.5 && this._telefoner() < TELEFON_MAKS) {
      const k = this._lavTelefon(p);
      h.push({ navn: 'telefonRinger', id: k.id, x: k.x, y: k.y });
    } else if (piller < PILLER_MAKS) {
      const k = this._lavPiller(p);
      h.push({ navn: 'pillerDukketOp', id: k.id, x: k.x, y: k.y });
    }
  }

  /** Kunden tager røret: et tilfældigt opkald, og det udløser sin hændelse. */
  _tagTelefon(b, k, h) {
    const nr = Math.floor(this.rngSim() * OPKALD.length);
    const o = OPKALD[nr];
    const e = { navn: 'telefonOpkald', baever: b.id, hold: b.hold, x: k.x, y: k.y, opkald: nr };
    const hold = this.hold[b.hold];
    switch (o.effekt) {
      case 'forstaerkning': {
        const id = tilfaeldigtKassevaaben(this.rngSim);
        const nu = hold.ammo[id];
        if (nu >= 0) hold.ammo[id] = nu + 2;
        e.vaaben = id; e.antal = 2;
        h.push({ navn: 'ammoAendret', hold: b.hold, vaaben: id, ammo: hold.ammo[id] });
        break;
      }
      case 'recept': e.hp = Math.min(E.MAKS_HP, b.hp + 30) - b.hp; b.hp += e.hp; break;
      case 'klage': e.hp = -15; D.givSkade(this, b, 15, 'klage', h); break;
      case 'mursten': this._stenskred(k.x, 260, 5); break;
      case 'uvejr': this._uvejr(); e.vind = this.vind; e.vejr = this.vejr; break;
      case 'spam': {
        const pladser = this.rngSim.bland(findStartpladser(this.terraen, this.vandNiveau).slice());
        let n = 0;
        for (const p of pladser) {
          if (n >= 3) break;
          if (this.baevere.some((x) => !x.doed && Math.abs(x.x - p.x) < 80)) continue;
          this.placerede.push(E.lavPlaceret(this.nytId(), {
            x: p.x, y: p.y + 2, lunte: 0, naerhed: 38, armering: 60,
            detonation: { radius: 52, skade: 42, knockback: 240, carve: true },
            ejer: null, ejerHold: null, sprite: 'mine',
          }));
          n++;
        }
        e.antal = n;
        break;
      }
      case 'viderestil': {
        const pladser = findStartpladser(this.terraen, this.vandNiveau)
          .filter((p) => Math.abs(p.x - b.x) > 400);
        if (!pladser.length) break;
        const p = pladser[Math.floor(this.rngSim() * pladser.length)];
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
   * Tilfældige hændelser mellem ture.
   *
   * Formålet er ikke kaos for kaos' skyld: hver hændelse ændrer, hvad der er
   * det rigtige træk næste tur. Et stenskred laver nyt terræn at gemme sig
   * bag, et uvejr gør lange skud upålidelige, og en ringende telefon er værd at løbe
   * efter. Alle trækker fra rngSim, så de er ens hos alle klienter.
   */
  _maaskeHaendelse(h) {
    // Ikke hver tur — for ofte, og de holder op med at være begivenheder.
    if (this.tur.turNr < 3 || this.rngSim() > 0.16) return;

    const rul = this.rngSim();
    if (rul < 0.38) {
      // Stenskred: en håndfuld sten falder fra himlen langs et bælte.
      const midte = 300 + this.rngSim() * (this.terraen.w - 600);
      this._stenskred(midte);
      h.push({ navn: 'hændelse', slags: 'stenskred', tekst: 'Mursten falder fra loftet!', x: midte });

    } else if (rul < 0.72) {
      // Uvejr: vinden springer kraftigt og vejret skifter.
      this._uvejr();
      h.push({ navn: 'hændelse', slags: 'uvejr', tekst: 'Driftsforstyrrelse: uvejr trækker op — pas på vinden',
               vind: this.vind, vejr: this.vejr });

    } else {
      // Telefonerne kimer: op til to telefoner dukker op og ringer.
      const pladser = findStartpladser(this.terraen, this.vandNiveau);
      if (!pladser.length) return;
      let antal = 0;
      while (this._telefoner() < TELEFON_MAKS) {
        const k = this._lavTelefon(pladser[Math.floor(this.rngSim() * pladser.length)]);
        h.push({ navn: 'telefonRinger', id: k.id, x: k.x, y: k.y });
        antal++;
      }
      if (antal) h.push({ navn: 'hændelse', slags: 'telefoner', tekst: 'Telefonerne kimer — tag røret!' });
    }
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
    const sammeBane = this.terraen && this.terraen.w === snap.terraen.w &&
                      this.froeBrugt === snap.froe;
    if (!sammeBane) {
      const res = genererSpilbar(this.froe, this.banetype, Math.max(2, snap.baevere.length));
      this.terraen = res.terraen;
      this.startpladser = res.pladser;
      this.froeBrugt = res.froe;
      this.terraen.afspil(snap.terraen.ops);
    } else if (snap.terraen.ops.length !== this.terraen.ops.length) {
      const har = this.terraen.ops.length;
      const mangler = snap.terraen.ops.slice(har);
      if (snap.terraen.ops.length < har) {
        // Vi er foran serveren (kan ske efter et hul) — byg forfra.
        const res = genererSpilbar(this.froe, this.banetype, Math.max(2, snap.baevere.length));
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
    this.placerede = snap.placerede.map((p) => ({ ...p }));
    this.kasser = snap.kasser.map((k) => ({ ...k }));
    this.gravsten = snap.gravsten.map((g) => ({ ...g }));
    this.tur = { ...snap.tur };
    this.sidsteBaeverPrHold = { ...snap.sidsteBaeverPrHold };
    this.vaabenPrHold = { ...(snap.vaabenPrHold || {}) };
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
