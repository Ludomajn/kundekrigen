/* Kundekrigen — serialisering.
 *
 * Terrænet sendes ALDRIG som bitmap. En 4096x1536 maske er 6,3 MB; en op er
 * ~10 bytes. Klienter regenererer fra frøet og afspiller op-listen.
 *
 * Op-listen er ORDNET og ikke en mængde kratere, fordi bjælken TILFØJER
 * materiale og derfor ikke kommuterer med udgravning.
 */
'use strict';

import { armerRest } from './entities.js';

export const SNAPSHOT_V = 1;

/* Flagene i delta-rækken for en kunde (e[6]). Spejlet pakker dem ud i
 * anvendDelta; figur_view og HUD'en læser felterne derfra. */
export const FLAG = { DOED: 1, PAA_JORDEN: 2, SKJOLD: 4, SPRING_OVER: 8, GRAVER: 16, SMITTET: 32 };

export function tagSnapshot(v) {
  return {
    v: SNAPSHOT_V,
    froe: v.froe,
    tick: v.tick,
    cfg: v.cfg,
    banetype: v.banetype,
    // Fortbanen bygges efter layoutet; spejlet og gæsterne regenererer med det.
    layout: v.layout ? { antalHold: v.layout.antalHold, prHold: v.layout.prHold } : null,
    vejr: v.vejr,
    vind: v.vind,
    vandNiveau: v.vandNiveau,
    pludseligDoed: v.pludseligDoed,
    antalHold: v.antalHold,
    terraen: { w: v.terraen.w, h: v.terraen.h, ops: v.terraen.ops, aftryk: v.terraen.aftryk() },
    hold: v.hold.map((h) => ({ id: h.id, farve: h.farve, navn: h.navn,
                               ammo: h.ammo, spillere: h.spillere, elimineret: h.elimineret })),
    baevere: v.baevere.map((b) => ({
      id: b.id, hold: b.hold, navn: b.navn, udseende: b.udseende, ejer: b.ejer,
      x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy),
      hp: b.hp, doed: b.doed, drukner: b.drukner,
      retning: b.retning, vinkel: r3(b.vinkel), paaJorden: b.paaJorden,
      skjold: !!b.skjold, springOver: b.springOver | 0, graver: !!b.redskab, smittet: b.smittet | 0,
    })),
    projektiler: v.projektiler.map((p) => ({
      id: p.id, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), r: p.r,
      vindFaktor: p.vindFaktor, hop: p.hop, rammerBaevere: p.rammerBaevere,
      detonation: p.detonation, fyld: p.fyld, klynge: p.klynge, smitte: p.smitte, lunte: p.lunte,
      ejer: p.ejer, ejerHold: p.ejerHold, sprite: p.sprite, spor: p.spor, sover: p.sover,
    })),
    placerede: v.placerede.map((p) => ({ ...p })),
    kasser: v.kasser.map((k) => ({ ...k })),
    gravsten: v.gravsten.map((g) => ({ ...g })),
    tur: { ...v.tur },
    sidsteBaeverPrHold: { ...v.sidsteBaeverPrHold },
    vaabenPrHold: { ...v.vaabenPrHold },
    valgtVaaben: v.valgtVaaben,
    valgtLunte: v.valgtLunte,
    // PRNG-tilstanden SKAL med — uden den divergerer replay efter første
    // tilfældige valg (vindrul, kassefald, klyngespredning).
    rng: v.rngSim.tilstand(),
    naesteId: v.naesteIdVaerdi(),
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Let delta til 20 Hz-strømmen. Kun det der bevæger sig. */
export function tagDelta(v) {
  const e = [];
  for (const b of v.baevere) {
    const flag = (b.doed ? FLAG.DOED : 0) | (b.paaJorden ? FLAG.PAA_JORDEN : 0) |
                 (b.skjold ? FLAG.SKJOLD : 0) | (b.springOver ? FLAG.SPRING_OVER : 0) |
                 (b.redskab ? FLAG.GRAVER : 0) | (b.smittet > 0 ? FLAG.SMITTET : 0);
    e.push([b.id, Math.round(b.x * 8) / 8, Math.round(b.y * 8) / 8,
            Math.round(b.vx * 4) / 4, Math.round(b.vy * 4) / 4, b.hp,
            flag, Math.round(b.vinkel * 256) / 256, b.retning]);
  }
  // Lunten (tick tilbage, 0 = ingen) og dvalen følger med, så bomben kan
  // vise sin nedtælling og ikke lyder, som om den flyver, mens den ligger.
  const pr = v.projektiler.map((p) => [p.id, Math.round(p.x * 8) / 8, Math.round(p.y * 8) / 8,
                                       Math.round(p.vx * 4) / 4, Math.round(p.vy * 4) / 4, p.sprite,
                                       p.lunte > 0 ? p.lunte : 0, p.sover ? 1 : 0]);
  // Kasser (telefoner) og udlagte ting (miner, dynamit) flytter sig, kommer
  // til og forsvinder midt i en tur; uden dem her så spejlet dem først ved
  // næste snapshot — en telefon hang i luften, en dynamit var usynlig.
  const ks = v.kasser.map((k) => [k.id, Math.round(k.x), Math.round(k.y), k.landet ? 1 : 0, k.slags]);
  // Sjette kolonne: tick til en nærhedsmine er skarp (0 = skarp / ingen mine).
  const pl = v.placerede.map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.sprite, p.lunte | 0,
                                     armerRest(p)]);
  return {
    tick: v.tick,
    e, pr, ks, pl,
    h: { holdIdx: v.tur.holdIdx, baever: v.tur.baeverId, tid: v.tur.tickTilbage,
         tilstand: v.tur.tilstand, vind: v.vind, vand: v.vandNiveau,
         // Filmintroen: hvor langt den er (tick), så gæsterne viser samme slag.
         ft: v.tur.tilstand === 'film' ? v.tur.tilstandTick : undefined,
         retreat: v.tur.retreatTil,
         // Våbenvalget lever hos værten. Uden det her viser klientens HUD
         // det forkerte våben, indtil næste turskift-snapshot.
         vaaben: v.valgtVaaben, lunte: v.valgtLunte },
  };
}

/** Anvend et delta på en klients verden (klienter simulerer ikke selv). */
export function anvendDelta(v, d) {
  v.tick = d.tick;
  for (const raek of d.e) {
    const b = v.baevere.find((x) => x.id === raek[0]);
    if (!b) continue;
    b.maalX = raek[1]; b.maalY = raek[2];
    if (b.x === undefined) { b.x = raek[1]; b.y = raek[2]; }
    b.vx = raek[3]; b.vy = raek[4];
    b.hp = raek[5];
    const f = raek[6];
    b.doed = !!(f & FLAG.DOED);
    b.paaJorden = !!(f & FLAG.PAA_JORDEN);
    b.skjold = !!(f & FLAG.SKJOLD);
    b.springOver = (f & FLAG.SPRING_OVER) ? 1 : 0;
    b.graver = !!(f & FLAG.GRAVER);
    // Spejlet kender kun "smittet eller ej" mellem snapshots; et kendt antal
    // ture (fra snapshot eller 'smittet'-hændelsen) bevares.
    if (!(f & FLAG.SMITTET)) b.smittet = 0;
    else if (!(b.smittet > 0)) b.smittet = 1;
    b.vinkel = raek[7];
    b.retning = raek[8];
  }
  const set = new Set(d.pr.map((p) => p[0]));
  v.projektiler = v.projektiler.filter((p) => set.has(p.id));
  for (const raek of d.pr) {
    let p = v.projektiler.find((x) => x.id === raek[0]);
    if (!p) { p = { id: raek[0], x: raek[1], y: raek[2], sprite: raek[5], r: 4 }; v.projektiler.push(p); }
    p.maalX = raek[1]; p.maalY = raek[2];
    p.vx = raek[3]; p.vy = raek[4];
    p.lunte = raek[6] ?? 0;
    p.sover = !!raek[7];
  }
  if (d.ks) {
    const gamle = new Map(v.kasser.map((k) => [k.id, k]));
    v.kasser = d.ks.map(([id, x, y, landet, slags]) => {
      const k = gamle.get(id) || { id, type: 'kasse', slags, indhold: null, vx: 0, vy: 0, alder: 0 };
      k.x = x; k.y = y; k.landet = !!landet;
      return k;
    });
  }
  if (d.pl) {
    const gamle = new Map(v.placerede.map((p) => [p.id, p]));
    v.placerede = d.pl.map(([id, x, y, sprite, lunte, armer]) => {
      const p = gamle.get(id) || { id, type: 'placeret', sprite, alder: 0 };
      p.x = x; p.y = y; p.lunte = lunte;
      p.armerRest = armer ?? 0;
      return p;
    });
  }
  v.tur.holdIdx = d.h.holdIdx;
  v.tur.baeverId = d.h.baever;
  v.tur.tickTilbage = d.h.tid;
  v.tur.tilstand = d.h.tilstand;
  if (d.h.ft !== undefined) v.tur.tilstandTick = d.h.ft;
  v.tur.retreatTil = d.h.retreat;
  v.vind = d.h.vind;
  v.vandNiveau = d.h.vand;
  if (d.h.vaaben) v.valgtVaaben = d.h.vaaben;
  if (d.h.lunte) v.valgtLunte = d.h.lunte;
}
