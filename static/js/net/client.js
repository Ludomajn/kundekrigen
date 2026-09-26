/* Kundekrigen — klientsiden i netværksspil.
 *
 * Klienter SIMULERER IKKE. De anvender snapshots og deltas og interpolerer
 * mellem de to seneste positioner. Ingen klientside-prediktion i v1: den er
 * en optimering, ikke en forudsætning, og den koster en hel klasse af
 * svært sporbare fejl.
 *
 * Alle pålidelige beskeder bærer et sekvensnummer. Opdager vi et hul, beder vi
 * om et snapshot i stedet for at gætte. Det er hele pålidelighedshistorien.
 */
'use strict';

import { anvendDelta } from '../sim/snapshot.js';

export function lavKlient(verden, transport, bus) {
  let sidsteSeq = 0;
  let huller = 0;

  // Tidslinje for interpolationen, målt i simulations-tick.
  let sidsteTick = -1;
  let sidsteModtaget = 0;
  let intervalTicks = 3;                  // glidende gennemsnit af delta-afstand
  let rtKlok = -1, sidsteKald = 0;        // render-uret (tick), se interpoler()
  const HIST = 5;
  const SPRING = 160;                     // længere hop end dette er en teleport

  function noterDelta(tick) {
    if (sidsteTick >= 0 && tick > sidsteTick) {
      intervalTicks += ((tick - sidsteTick) - intervalTicks) * 0.2;
    }
    sidsteTick = tick;
    sidsteModtaget = performance.now();
    for (const e of [...verden.baevere, ...verden.projektiler]) {
      if (e.maalX === undefined) continue;
      const h = e.hist || (e.hist = []);
      const sidst = h[h.length - 1];
      if (sidst && Math.hypot(e.maalX - sidst[1], e.maalY - sidst[2]) > SPRING) h.length = 0;
      if (!sidst || sidst[0] !== tick) h.push([tick, e.maalX, e.maalY]);
      if (h.length > HIST) h.shift();
    }
  }

  /** Sæt e.x/e.y til den interpolerede position ved render-tick rt. */
  function placer(e, rt) {
    const h = e.hist;
    if (!h || !h.length) {
      if (e.maalX !== undefined) { e.x = e.maalX; e.y = e.maalY; }
      return;
    }
    if (rt <= h[0][0] || h.length === 1) { e.x = h[0][1]; e.y = h[0][2]; return; }
    for (let i = 1; i < h.length; i++) {
      if (rt <= h[i][0]) {
        const a = h[i - 1], b = h[i];
        const f = (rt - a[0]) / Math.max(1, b[0] - a[0]);
        e.x = a[1] + (b[1] - a[1]) * f;
        e.y = a[2] + (b[2] - a[2]) * f;
        return;
      }
    }
    // Forbi den nyeste prøve: fremskriv kort med den sidste hældning, så en
    // forsinket pakke ikke giver et stop-og-start.
    const a = h[h.length - 2], b = h[h.length - 1];
    const f = (rt - b[0]) / Math.max(1, b[0] - a[0]);
    e.x = b[1] + (b[1] - a[1]) * f;
    e.y = b[2] + (b[2] - a[2]) * f;
  }

  /* Status, der skifter midt i turen, bæres også af deltaens flag — men en
   * lytter på hændelsen skal kunne læse den nye værdi med det samme, og over
   * nettet kan der gå tre tick, før næste delta kommer. */
  function opdaterStatus(e) {
    const b = e.baever != null ? verden.baevere.find((x) => x.id === e.baever) : null;
    if (!b) return;
    switch (e.navn) {
      case 'skjoldOp': b.skjold = true; break;
      case 'skjoldSlut': b.skjold = false; break;
      case 'opdateringRamt': b.springOver = 1; break;
      case 'turSprungetOver': b.springOver = 0; break;
      case 'smittet': b.smittet = e.turer || 1; break;
      case 'rask': b.smittet = 0; break;
      case 'redskabStart': if (e.slags === 'bor') b.graver = true; break;
      case 'redskabSlut': b.graver = false; break;
    }
  }

  function tjekSeq(m) {
    if (typeof m.s !== 'number') return true;
    if (sidsteSeq && m.s > sidsteSeq + 1) {
      huller++;
      transport.send({ t: 'snap_bed', d: {} });
    }
    if (m.s > sidsteSeq) sidsteSeq = m.s;
    return true;
  }

  return {
    get huller() { return huller; },

    haandter(m) {
      switch (m.t) {
        case 'st':
          anvendDelta(verden, m.d);
          noterDelta(m.d.tick);
          break;

        case 'krater':
          tjekSeq(m);
          if (m.d.k === 1) verden.terraen.bjaelke(m.d.x, m.d.y, m.d.hl, m.d.ht, m.d.v, undefined, false);
          else if (m.d.k === 2) verden.terraen.kapsel(m.d.x, m.d.y, m.d.x2, m.d.y2, m.d.r, false);
          else if (m.d.k === 3) verden.terraen.fyld(m.d.x, m.d.y, m.d.r, undefined, false);
          else verden.terraen.carve(m.d.x, m.d.y, m.d.r, false);
          break;

        case 'tur':
          tjekSeq(m);
          verden.tur.baeverId = m.d.baever;
          verden.tur.holdIdx = m.d.hold;
          verden.vind = m.d.vind;
          verden.vejr = m.d.vejr;
          verden.vandNiveau = m.d.vand;
          bus.send('turStart', m.d);
          break;

        case 'haendelse':
          tjekSeq(m);
          // Ammunition tælles ned hos værten midt i turen; uden dette ville
          // favoritbjælken vise et forældet tal indtil næste snapshot.
          if (m.d.navn === 'ammoAendret') {
            const h = verden.hold[m.d.hold];
            if (h) h.ammo[m.d.vaaben] = m.d.ammo;
          }
          if (m.d.navn === 'doedsfald' && m.d.grav &&
              !verden.gravsten.some((g) => g.id === m.d.grav.id)) {
            verden.gravsten.push({ ...m.d.grav });
          }
          opdaterStatus(m.d);
          bus.send(m.d.navn, m.d);
          break;

        case 'snapshot':
          verden.genskab(m.d.snap);
          // Et snapshot er sandheden NU — ingen glidning fra gamle positioner.
          for (const e of [...verden.baevere, ...verden.projektiler]) { e.hist = null; }
          sidsteSeq = m.s || sidsteSeq;
          bus.send('snapshotAnvendt', m.d.snap);
          break;

        case 'slut':
          tjekSeq(m);
          bus.send('sejr', m.d);
          break;
      }
    },

    /**
     * Snapshot-interpolation: tegn verden en lille smule BAG den seneste
     * modtagne tilstand og interpolér lineært mellem de to deltas, der
     * omslutter det tidspunkt. Så bevæger figurer og projektiler sig
     * flydende i skærmens framerate (60-144 Hz) — ikke i deltastrømmens
     * — og alt, der tegnes efter b.x/b.y (figur, navneskilt, kamera),
     * følges ad.
     *
     * Forsinkelsen tilpasser sig strømmen: lokalt kommer deltas med 60 Hz
     * (forsinkelse ~25 ms), over netværket med 20 Hz (~75 ms).
     */
    interpoler() {
      if (sidsteTick < 0) return;
      const nu = performance.now();
      const forsinkelse = Math.max(1.5, intervalTicks * 1.6);
      const maal = sidsteTick + ((nu - sidsteModtaget) / 1000) * 60 - forsinkelse;
      // Render-uret er MONOTONT: det går fremad med realtid og retter sig
      // blødt ind mod målet (±25 % fart). Et spring tilbage ved en forsinket
      // pakke ville ses som et lille ryk baglæns.
      const skridt = sidsteKald ? ((nu - sidsteKald) / 1000) * 60 : 0;
      sidsteKald = nu;
      if (rtKlok < 0 || Math.abs(maal - rtKlok) > 12) rtKlok = maal;   // start/langt ude: snap
      else {
        const fart = Math.max(0.75, Math.min(1.25, 1 + (maal - rtKlok) * 0.08));
        rtKlok += skridt * fart;
      }
      const rt = Math.min(rtKlok, sidsteTick + 1);    // højst 1 tick fremskrivning
      for (const b of verden.baevere) placer(b, rt);
      for (const p of verden.projektiler) placer(p, rt);
    },
  };
}
