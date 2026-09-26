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
      for (const m of this.koe) ws.send(m);
      this.koe.length = 0;
      this._aaben();
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

/** Et lokalt "rum" med samme form som Pythons, så lobbyen deler kodesti. */
export function lavLokaltRum(profil, opsaet = {}, navnePulje = []) {
  const pid = 'p_lokal';
  const hold = [];
  const farver = ['blaa', 'roed', 'gul', 'groen'];
  const antalHold = opsaet.hold || 2;
  const prHold = opsaet.baevere_pr_hold || 3;

  const brugteNavne = new Set(profil.baevere.map((b) => b.navn));
  let reserve = 1;
  const friskNavn = () => {
    const ledige = navnePulje.filter((n) => !brugteNavne.has(n));
    const navn = ledige.length ? ledige[Math.floor(Math.random() * ledige.length)] : `Kunde ${reserve++}`;
    brugteNavne.add(navn);
    return navn;
  };

  for (let i = 0; i < antalHold; i++) {
    hold.push({
      id: i, farve: farver[i],
      navn: ['Klinik Blå', 'Klinik Rød', 'Klinik Gul', 'Klinik Grøn'][i],
      baevere: Array.from({ length: prHold }, (_, j) => {
        const n = i * prHold + j;
        const forlaeg = profil.baevere[n];
        // Har profilen færre bævere end der er pladser, må resten have deres
        // eget navn — ellers står den samme bæver på to hold.
        const navn = forlaeg ? forlaeg.navn : friskNavn();
        return {
          id: `b${i}_${j}`,
          navn,
          udseende: forlaeg ? forlaeg.udseende : {},
          ejer: pid,                        // hotseat: én person styrer alle
        };
      }),
    });
  }

  const rum = {
    udsend: () => {},
    kode: null,
    fase: 'venter',
    vaert: pid,
    dig: pid,
    indst: { turtid: 45, kamptid: 1800, vind: true, vejr: 'auto',
             banetype: 'aaben', bane: (Math.random() * 2 ** 31) >>> 0,
             baevere_pr_hold: prHold },
    deltagere: [{ pid, navn: profil.spillernavn || 'Spiller', forbundet: true,
                  klar: true, tilskuer: false, ms: 0 }],
    hold,

    lobby() {
      return { t: 'lobby', d: { kode: null, fase: rum.fase, vaert: pid, dig: pid,
                                indst: rum.indst, deltagere: rum.deltagere, hold: rum.hold } };
    },

    haandter(m) {
      switch (m.t) {
        case 'hej':
          rum.udsend({ t: 'velkommen', d: { pid, tok: 'lokal', protokol: 1 } });
          rum.udsend(rum.lobby());
          break;
        case 'saede': {
          const b = rum.hold.flatMap((h) => h.baevere).find((x) => x.id === m.d.baever);
          if (b) b.ejer = m.d.ejer;
          rum.udsend(rum.lobby());
          break;
        }
        case 'navngiv': {
          const b = rum.hold.flatMap((h) => h.baevere).find((x) => x.id === m.d.baever);
          if (b) { if (m.d.navn) b.navn = m.d.navn; if (m.d.udseende) b.udseende = m.d.udseende; }
          rum.udsend(rum.lobby());
          break;
        }
        case 'indst':
          Object.assign(rum.indst, m.d);
          if (m.d.hold !== undefined) saetHold(+m.d.hold);
          if (m.d.baevere_pr_hold !== undefined) saetStoerrelse(+m.d.baevere_pr_hold);
          rum.udsend(rum.lobby());
          break;
        case 'start':
          rum.fase = 'i_gang';
          rum.udsend({ t: 'start', d: { indst: rum.indst, hold: rum.hold } });
          break;
        case 'klar':
          rum.deltagere[0].klar = !!m.d.klar;
          rum.udsend(rum.lobby());
          break;
        // Alt spilrelateret (in, st, krater, tur…) er unødvendigt lokalt:
        // værten ER klienten, og motoren læser sin egen tilstand direkte.
        default: break;
      }
    },
  };

  function saetHold(n) {
    n = Math.max(2, Math.min(4, n));
    while (rum.hold.length < n) {
      const i = rum.hold.length;
      rum.hold.push({ id: i, farve: farver[i], navn: ['Klinik Blå', 'Klinik Rød', 'Klinik Gul', 'Klinik Grøn'][i],
                      baevere: Array.from({ length: rum.indst.baevere_pr_hold }, (_, j) => ({
                        id: `b${i}_${j}`, navn: friskNavn(), udseende: {}, ejer: pid })) });
    }
    while (rum.hold.length > n) rum.hold.pop();
  }
  function saetStoerrelse(n) {
    n = Math.max(1, Math.min(6, n));
    rum.indst.baevere_pr_hold = n;
    for (const h of rum.hold) {
      while (h.baevere.length < n) {
        const j = h.baevere.length;
        h.baevere.push({ id: `b${h.id}_${j}`, navn: friskNavn(), udseende: {}, ejer: pid });
      }
      while (h.baevere.length > n) h.baevere.pop();
    }
  }

  return rum;
}
