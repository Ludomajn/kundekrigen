/* Kundekrigen — transportlaget.
 *
 * Motoren taler til ÉT interface med to implementeringer. Det er derfor der
 * ikke findes en eneste `if (erLokal)` i fysik, rendering eller brugerflade —
 * kun main.js vælger transport.
 *
 * DEN DETALJE DER BETYDER ALT: loopback leverer via queueMicrotask, ikke
 * synkront. Synkron levering ville give motoren en anden hændelsesrækkefølge
 * lokalt end over netværket, og dermed fejl der KUN findes i netværkstilstand
 * — projektets værste fejlklasse. Asynkron levering begge steder gør lokalt
 * spil til en ægte test af netværksstien.
 */
'use strict';

import { HOLD_ORDEN, HOLD_NAVNE } from '../core/klinikker.js';
import { aabneFigurer, rosterNavn, rosterUdseende, BANE_VALG } from '../core/roster.js';

export class Transport {
  constructor() { this._besked = () => {}; this._luk = () => {}; this._aaben = () => {}; }
  paaBesked(cb) { this._besked = cb; }
  paaLuk(cb) { this._luk = cb; }
  paaAaben(cb) { this._aaben = cb; }
  send() {}
  luk() {}
  get forbundet() { return false; }
}

export class WsTransport extends Transport {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.doed = false;
    this.forsoeg = 0;
    this.koe = [];
    this._forbind();
  }

  _forbind() {
    if (this.doed) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch { this._planlaegGenforbind(); return; }
    this.ws = ws;

    ws.onopen = () => {
      this.forsoeg = 0;
      // Først 'hej' (paaAaben), så køen: serveren kender først forbindelsen,
      // når hej er modtaget, og afviste ellers alt i køen (ikke_i_rum).
      // Input fra afbrydelsen er forældet — det sendes ikke bagefter.
      const koe = this.koe.splice(0);
      this._aaben();
      for (const m of koe) if (!m.startsWith('{"t":"in"')) ws.send(m);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this._besked(m);
    };
    ws.onclose = (e) => {
      this.ws = null;
      this._luk(e.code, e.reason);
      if (!this.doed && e.code !== 4001) this._planlaegGenforbind();
    };
    ws.onerror = () => { /* onclose følger altid efter */ };
  }

  _planlaegGenforbind() {
    // 0,5 / 1 / 2 / 4 s, derefter 4 s.
    const ventetid = Math.min(4000, 500 * Math.pow(2, this.forsoeg++));
    setTimeout(() => this._forbind(), ventetid);
  }

  get forbundet() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  send(obj) {
    const s = JSON.stringify(obj);
    if (this.forbundet) this.ws.send(s);
    else if (this.koe.length < 64) this.koe.push(s);
  }

  luk() {
    this.doed = true;
    try { this.ws?.close(1000, 'farvel'); } catch { /* allerede lukket */ }
    this.ws = null;
  }
}

/** Lokalt hotseat. Serveren er slet ikke involveret — ingen HTTP, ingen socket. */
export class LoopbackTransport extends Transport {
  constructor(rum) {
    super();
    this.rum = rum;
    this.rum.udsend = (m) => queueMicrotask(() => this._besked(m));
    queueMicrotask(() => this._aaben());
  }
  get forbundet() { return true; }
  send(obj) { queueMicrotask(() => this.rum.haandter(obj)); }
  luk() { this.rum.udsend = () => {}; }
}

/* ---------------------------------------------------------- det lokale rum
 *
 * Samme semantik som rum.py (docs/karaktervalg.md): én fighter pr. spiller,
 * blåt og rødt hold, banestemmer, klar og den automatiske nedtælling, bare
 * uden server. Spillerne ved tastaturet vælger efter tur; en besked kan
 * bære som: <pid> for den lokale spiller, der handler (ellers spiller 1).
 */

/** Nedtællingen, når alle er klar (NEDTAELLING_S i rum.py). */
const NEDTAELLING_MS = 3000;
/** Karaktervalgets hold: de første i HOLD_ORDEN, 0 blåt (venstre) og 1 rødt (højre) — som ANTAL_HOLD i rum.py. */
const ANTAL_HOLD = 2;
const HOLD_FARVER = HOLD_ORDEN.slice(0, ANTAL_HOLD);
const MAKS_LOKALE = 8;
const BANE_TYPER = BANE_VALG.filter((b) => b !== 'tilfaeldig');
const INDST_NOEGLER = ['turtid', 'kamptid', 'vind', 'vejr', 'bane', 'banetype'];
// Teksterne fra protokol.py for de fejl, det lokale rum kan give.
const FEJL = {
  laast_karakter: 'Den karakter kommer snart.',
  ukendt_hold: 'Det hold findes ikke.',
  vaelg_hold: 'Vælg blåt eller rødt hold først.',
  ukendt_bane: 'Den bane findes ikke.',
  for_faa_hold: 'Begge hold skal have mindst én spiller.',
};
const lod = (liste) => liste[Math.floor(Math.random() * liste.length)];

/** Et åbent figurnummer, null (ingen fighter) eller 'tilfaeldig'. */
const gyldigtValg = (f) => f === null || f === 'tilfaeldig' || (Number.isInteger(f) && aabneFigurer().includes(f));
/** 0 (blåt), 1 (rødt) eller null. */
const gyldigtHold = (h) => h === null || (Number.isInteger(h) && h >= 0 && h < ANTAL_HOLD);

/**
 * De to hold med én plads pr. spiller, afledt af deltagerne — som _hold_liste
 * i rum.py. Samme karakter flere gange tælles gennem hele kampen i
 * holdrækkefølge og derefter spillerrækkefølge ("Dr. Jan fra Mors II").
 * Med afgoer (kampstart) trækkes fightere uden figurvalg blandt de åbne;
 * spillerens valg bevares, så 'tilfaeldig' trækkes igen ved Spil igen.
 */
function holdListe(deltagere, afgoer = false) {
  const aabne = aabneFigurer();
  const brugt = new Map();                  // figur -> forekomster indtil nu
  return HOLD_FARVER.map((farve, id) => ({
    id, farve, navn: HOLD_NAVNE[farve],
    baevere: deltagere.filter((x) => !x.tilskuer && x.hold === id).map((x) => {
      let f = x.valg;
      if (afgoer && !Number.isInteger(f)) f = lod(aabne);
      let navn = '', udseende = {};
      if (Number.isInteger(f)) {
        const nr = brugt.get(f) || 0;
        brugt.set(f, nr + 1);
        udseende = rosterUdseende(f);
        navn = rosterNavn(f, nr) || '';
      } else if (f === 'tilfaeldig') {
        navn = 'Tilfældig';
      }
      return { id: `b_${x.pid}`, navn, udseende, ejer: x.pid, valg: x.valg };
    }),
  }));
}

/**
 * Et lokalt "rum" med samme form som Pythons, så lobbyen deler kodesti.
 *
 * Der er to spillere fra start (p_lokal er vært og dig); ny_spiller tilføjer
 * flere. opsaet og navnePulje bruges ikke længere: holdene er blåt og rødt,
 * og hver spiller vælger sin fighter i karaktervalget.
 */
export function lavLokaltRum(profil, opsaet = {}, navnePulje = []) {
  const pid = 'p_lokal';
  const spiller = (p, navn) => ({ pid: p, navn, forbundet: true, klar: false, tilskuer: false, ms: 0,
                                   hold: null, valg: null, stemme: null, lokal: true });

  let udsend = () => {};
  let naesteToken = 1;

  const rum = {
    // LoopbackTransport sætter modtageren, og dens luk() sætter en tom
    // funktion. Et skift stopper en ventende nedtælling, så den ikke starter
    // en kamp i et lukket rum.
    get udsend() { return udsend; },
    set udsend(f) { udsend = f; stopNedtaelling(); },
    kode: null,
    fase: 'venter',
    vaert: pid,
    dig: pid,
    indst: { turtid: 45, kamptid: 1800, vind: true, vejr: 'auto',
             banetype: 'fort', bane: (Math.random() * 2 ** 31) >>> 0 },
    deltagere: [spiller(pid, profil.spillernavn || 'Spiller 1'), spiller('p_lokal_2', 'Spiller 2')],
    nedtaelling: null,                      // null, eller { slut, token, hvem, timer }
    bane_trukket: null,

    lobby() {
      const n = rum.nedtaelling;
      return { t: 'lobby', d: { kode: null, fase: rum.fase, vaert: pid, dig: pid,
                                indst: rum.indst, deltagere: rum.deltagere, hold: holdListe(rum.deltagere),
                                nedtaelling_ms: n ? Math.max(0, Math.round(n.slut - Date.now())) : null,
                                bane_trukket: rum.bane_trukket } };
    },

    haandter(m) {
      const d = m.d || {};
      // Den lokale spiller, der handler; uden som er det spiller 1. En ukendt
      // spiller ignoreres hellere end at handle på en andens vegne.
      const mig = rum.deltagere.find((x) => x.pid === (m.som ?? d.som ?? pid));
      switch (m.t) {
        case 'hej':
          rum.udsend({ t: 'velkommen', d: { pid, tok: 'lokal', protokol: 1 } });
          sendLobby();
          break;
        case 'navngiv':
          // Forældet: pladsens navn og udseende følger karaktervalget. Ingen
          // lobby-udsendelse, ellers sender klienten sit udseende i ring.
          break;
        case 'vaelg': {
          // Uden hold, og højst to ved tastaturet: det ledige hold (som _vaelg i rum.py).
          const figur = d.figur ?? null;
          if (!mig) break;
          if (!gyldigtValg(figur)) { fejl('laast_karakter'); break; }
          mig.valg = figur;
          mig.klar = false;
          if (figur !== null && mig.hold === null && !mig.tilskuer) mig.hold = ledigtHold();
          sendLobby();
          break;
        }
        case 'hold': {
          const hold = d.hold ?? null;
          if (!mig) break;
          if (!gyldigtHold(hold)) { fejl('ukendt_hold'); break; }
          mig.hold = hold;
          mig.klar = false;
          sendLobby();
          break;
        }
        case 'stem': {
          const banetype = d.banetype ?? null;
          if (!mig) break;
          if (banetype !== null && !BANE_VALG.includes(banetype)) { fejl('ukendt_bane'); break; }
          mig.stemme = banetype;
          mig.klar = false;
          sendLobby();
          break;
        }
        case 'klar':
          if (!mig) break;
          if (d.klar && mig.hold === null) { fejl('vaelg_hold'); break; }
          mig.klar = !!d.klar;
          sendLobby();
          break;
        case 'indst':
          // hold og baevere_pr_hold findes ikke længere og ignoreres. Ingen
          // starter på regler, de ikke har set.
          for (const k of INDST_NOEGLER) if (k in d) rum.indst[k] = d[k];
          for (const x of rum.deltagere) x.klar = false;
          sendLobby();
          break;
        case 'start': {
          // Værtens start: med det samme, uden nedtælling (Spil igen). Ved ét
          // tastatur kræver den kun, at begge hold har en spiller.
          const f = holdFejl();
          if (f) { fejl(f); break; }
          startKampen();
          break;
        }
        case 'slut':
          // Kampen er slut (main.js melder det, som værten gør over nettet):
          // tilbage til karaktervalget med de samme valg, men ingen er klar.
          rum.fase = 'venter';
          for (const x of rum.deltagere) x.klar = false;
          stopNedtaelling();
          sendLobby();
          break;
        case 'ny_spiller': {
          // Det laveste ledige nummer, sat ind på sin plads i rækken: spillerne
          // vælger i rækkefølge, så "Spiller 4" aldrig vælger før "Spiller 3".
          if (rum.deltagere.length >= MAKS_LOKALE) break;
          const nr = (x) => (x.pid === pid ? 1 : +(/^p_lokal_(\d+)$/.exec(x.pid)?.[1] || 99));
          let n = 2;
          while (rum.deltagere.some((x) => nr(x) === n)) n++;
          const i = rum.deltagere.findIndex((x) => nr(x) > n);
          rum.deltagere.splice(i < 0 ? rum.deltagere.length : i, 0, spiller(`p_lokal_${n}`, `Spiller ${n}`));
          sendLobby();
          break;
        }
        case 'fjern_spiller': {
          // Spiller 1 (værten) bliver, og der er altid mindst to.
          const i = rum.deltagere.findIndex((x) => x.pid === d.pid);
          if (i < 0 || d.pid === pid || rum.deltagere.length <= 2) break;
          rum.deltagere.splice(i, 1);
          sendLobby();
          break;
        }
        // Alt spilrelateret (in, st, krater, tur…) er unødvendigt lokalt:
        // værten ER klienten, og motoren læser sin egen tilstand direkte.
        default: break;
      }
    },
  };

  const fejl = (kode) => rum.udsend({ t: 'fejl', d: { kode, tekst: FEJL[kode] || 'Der skete en fejl.' } });

  /** Alle ændringer ender her, som send_lobby i rum.py: tjek nedtællingen, send lobbyen. */
  function sendLobby() {
    tjekNedtaelling();
    rum.udsend(rum.lobby());
  }

  /** De aktive spillere (aktive i rum.py): tilsluttede og ikke tilskuere — lokalt alle ved tastaturet. */
  const aktive = () => rum.deltagere.filter((x) => x.forbundet && !x.tilskuer);

  /**
   * Det ledige hold til en spiller uden hold, eller null (_ledigt_hold i
   * rum.py): med højst to aktive spillere holdet med færrest spillere, blåt
   * ved lige, talt som holdFejl tæller dem (alle på holdet, der ikke er
   * tilskuere). Med flere vælger hver selv sit hold.
   */
  function ledigtHold() {
    if (aktive().length > 2) return null;
    const antal = HOLD_FARVER.map((_, id) => rum.deltagere.filter((x) => !x.tilskuer && x.hold === id).length);
    return antal.indexOf(Math.min(...antal));
  }

  /** Holdreglerne fra _hold_fejl i rum.py: begge hold skal have en spiller. */
  function holdFejl() {
    const tomt = HOLD_FARVER.some((_, id) => !rum.deltagere.some((x) => !x.tilskuer && x.hold === id));
    return tomt ? 'for_faa_hold' : null;
  }

  /** Betingelsen for nedtællingen (_klar_til_start i rum.py): nøglen for de deltagende, eller null. */
  function klarTilStart() {
    if (rum.fase !== 'venter' || holdFejl()) return null;
    const spillere = aktive();
    if (!spillere.length || !spillere.every((x) => x.klar && x.hold !== null)) return null;
    return spillere.map((x) => x.pid).sort().join(' ');
  }

  function tjekNedtaelling() {
    const hvem = klarTilStart();
    if (rum.nedtaelling && rum.nedtaelling.hvem !== hvem) stopNedtaelling();
    if (hvem && !rum.nedtaelling) {
      rum.bane_trukket = traekBane();
      const token = naesteToken++;
      rum.nedtaelling = { slut: Date.now() + NEDTAELLING_MS, token, hvem,
                          timer: setTimeout(() => nedtaellingFaerdig(token), NEDTAELLING_MS) };
    }
  }

  function stopNedtaelling() {
    if (rum.nedtaelling) clearTimeout(rum.nedtaelling.timer);
    rum.nedtaelling = null;
    rum.bane_trukket = null;
  }

  function nedtaellingFaerdig(token) {
    const n = rum.nedtaelling;
    if (!n || n.token !== token) return;    // annulleret eller afløst undervejs
    if (klarTilStart() !== n.hvem) { sendLobby(); return; }
    startKampen();
  }

  /** Start kampen — og send lobbyen bagefter, så den sidste lobby, klienten
   *  har, ikke længere viser en nedtælling (som rum.py). */
  function startKampen() {
    rum.udsend({ t: 'start', d: gaaIGang() });
    rum.udsend(rum.lobby());
  }

  /** Hver stemme er ét lod; uden stemmer gælder reglernes banetype. */
  function traekBane() {
    const lodder = aktive().filter((x) => x.stemme != null).map((x) => x.stemme);
    const bane = lodder.length ? lod(lodder) : (rum.indst.banetype || 'fort');
    return bane === 'tilfaeldig' ? lod(BANE_TYPER) : bane;
  }

  /** Kampen går i gang (_gaa_i_gang i rum.py): banen, de to hold med de endelige fightere, fasen.
   *  Hver kamp får en ny bane — også Spil igen: frøet trækkes hver gang, og
   *  den trukne banetype står kun i kampens kopi af reglerne, så en
   *  'tilfaeldig'-regel trækkes igen næste gang. */
  function gaaIGang() {
    const bane = (Math.random() * 2 ** 31) >>> 0 || 1;
    const banetype = rum.bane_trukket || traekBane();
    stopNedtaelling();
    rum.fase = 'i_gang';
    return { indst: { ...rum.indst, bane, banetype }, hold: holdListe(rum.deltagere, true) };
  }

  return rum;
}
