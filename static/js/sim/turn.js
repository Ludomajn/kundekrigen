/* Kundekrigen — turmaskine, ure, pludselig død og sejrsafgørelse.
 *
 * Alle ure er HELTALS-TICK, aldrig vægur. Det gør dem serialiserbare og
 * replay-eksakte, og det er derfor 30 s tur = 1800 tick står i koden frem for
 * et sekundtal der skal ganges undervejs.
 *
 * TILBAGETOG ER IKKE EN TILSTAND, MEN EN DEADLINE PÅ TUREN.
 * Worms starter tilbagetogsuret i det sekund du fyrer, og det tikker MENS
 * projektilet stadig er i luften; at kunne flytte sig under flugten er en del
 * af spillets dygtighed. Gør man tilbagetog til en tilstand, kommer det først
 * efter opløsningen, og spillet bliver et andet.
 */
'use strict';

import { HZ } from '../core/tick.js';

export const T = {
  LOBBY: 'lobby',
  GENERERER: 'genererer',
  FILM: 'film',            // filmintroen før kampen (core/filmintro.js)
  UDSAET: 'udsaet',
  TUR_START: 'tur_start',
  SPILLER_AKTIV: 'spiller_aktiv',
  AFFYRING: 'affyring',
  OPLOESNING: 'oploesning',
  SKADE: 'skade',
  TUR_SLUT: 'tur_slut',
  SEJR: 'sejr',
};

export const TUR_START_TICKS = 150;         // kamerapanorering + vindrul — i ro og mag
export const RO_HYSTERESE = 12;             // sammenhængende rolige tick
export const RO_VAGTHUND = 720;             // 12 s — tvungen ro
export const PANEL_PAUSE_LOFT = 300;        // 5 s tururet må stå stille per tur
export const SUDDEN_SPRING = 24;            // vandet hopper ved udløsning
export const SUDDEN_STIGNING = 6;           // og derefter per tur

export function nyTur(v) {
  return {
    tilstand: T.LOBBY,
    holdIdx: -1,
    baeverId: null,
    tickTilbage: 0,
    tilstandTick: 0,
    retreatTil: null,
    pausetTick: 0,
    roTael: 0,
    oploesningTick: 0,
    turNr: 0,
    runde: 0,                   // hel omgang, hvor hver levende klinik har haft én tur (1 = første)
    fuldtTilbagetog: false,     // turen venter på hele tilbagetoget (minen)
    smitteKoert: false,         // COVID-opgøret er kørt for denne tur
  };
}

// ---------------------------------------------------------------- hold

export function levendeHold(v) {
  const s = new Set();
  for (const b of v.baevere) if (!b.doed) s.add(b.hold);
  return [...s].sort((a, b) => a - b);
}

/** Klinikken, der har den næste tur — uden at flytte noget. Samme regel som
 *  naesteBaever (som bruger den), så world.js kan se, om næste tur begynder
 *  en ny runde, før turen startes. null: ingen levende klinikker. */
export function naesteHoldIdx(v) {
  const hold = levendeHold(v);
  if (!hold.length) return null;

  let idx = v.tur.holdIdx;
  for (let i = 0; i < hold.length + 1; i++) {
    idx = (idx + 1) % Math.max(1, v.antalHold);
    if (!hold.includes(idx)) continue;
    if (!v.baevere.some((b) => b.hold === idx && !b.doed)) continue;
    return idx;
  }
  return null;
}

export function naesteBaever(v) {
  const idx = naesteHoldIdx(v);
  if (idx === null) return null;
  const holdets = v.baevere.filter((b) => b.hold === idx && !b.doed);
  // Roter inden for holdet, så det ikke altid er den samme der spiller.
  const sidst = v.sidsteBaeverPrHold[idx] ?? -1;
  const efter = holdets.filter((b) => b.id > sidst);
  const valgt = efter.length ? efter[0] : holdets[0];
  v.sidsteBaeverPrHold[idx] = valgt.id;
  return { holdIdx: idx, baever: valgt };
}

/** Begynder næste tur en ny runde? Det gør den, når rækkefølgen slår rundt:
 *  den næste klinik har et holdIdx ≤ den forrige turs (også når klinikker
 *  imellem er døde). Den allerførste tur begynder runde 1. */
export function nyRunde(v) {
  const idx = naesteHoldIdx(v);
  if (idx === null) return false;
  return !(v.tur.runde > 0) || v.tur.holdIdx < 0 || idx <= v.tur.holdIdx;
}

// ---------------------------------------------------------------- ro

/**
 * "Er verden faldet til ro?" — den mest fejlbehæftede prædikat i motoren.
 * To værn, begge obligatoriske:
 *   Hysterese, ellers slutter turen for tidligt når en bæver kortvarigt rører
 *   jorden midt i et hop.
 *   Vagthund, for en granat kilet fast i en én-pixel-sprække hænger ellers
 *   kampen for evigt — og det VIL ske.
 */
export function erIRo(v) {
  if (v.projektiler.length) return false;
  if (v.eksplosionsKoe.length) return false;
  if (v.forsinkede.length) return false;
  // Dødskøen tæller IKKE som uro: den afvikles netop i SKADE, når verden er
  // faldet til ro. Talte den med, ventede hvert dødsfald på vagthunden (12 s).
  for (const k of v.kasser) if (!k.landet && !k.doed) return false;
  for (const p of v.placerede) if (!p.paaJorden && !p.doed) return false;
  for (const b of v.baevere) {
    if (b.doed) continue;
    if (b.redskab) return false;
    if (!b.paaJorden) return false;
    if (Math.abs(b.vx) > 1 || Math.abs(b.vy) > 1) return false;
  }
  return true;
}

export function tvungenRo(v, h) {
  for (const p of v.projektiler) h.push({ navn: 'projektilFjernet', id: p.id });
  v.projektiler.length = 0;
  v.forsinkede.length = 0;
  for (const b of v.baevere) {
    if (b.doed) continue;
    if (b.redskab) {
      // Boret stoppes, hvor det er; sigtet kommer tilbage.
      if (b.redskab.vinkel0 !== undefined) b.vinkel = b.redskab.vinkel0;
      h.push({ navn: 'redskabSlut', slags: b.redskab.slags, baever: b.id, vaaben: b.redskab.vaaben });
    }
    b.redskab = null;
    b.graver = false;
    b.vx = 0; b.vy = 0;
    if (!b.paaJorden) {
      const y = v.terraen.jordUnder(Math.round(b.x), Math.round(b.y));
      if (y >= 0) { b.y = y + 1; b.paaJorden = true; }
      else { b.paaJorden = true; }
      b.faldFra = null;
    }
  }
  for (const k of v.kasser) k.landet = true;
  for (const p of v.placerede) p.paaJorden = true;
  h.push({ navn: 'tvungenRo' });
}

// ---------------------------------------------------------------- sejr

export function tjekSejr(v) {
  const hold = levendeHold(v);
  if (hold.length === 0) return { slut: true, vinder: null };
  if (hold.length === 1) return { slut: true, vinder: hold[0] };
  return { slut: false };
}

export function stilling(v) {
  const ud = [];
  for (let i = 0; i < v.antalHold; i++) {
    const holdets = v.baevere.filter((b) => b.hold === i);
    if (!holdets.length) continue;
    ud.push({
      hold: i,
      levende: holdets.filter((b) => !b.doed).length,
      hp: holdets.reduce((s, b) => s + b.hp, 0),
    });
  }
  return ud.sort((a, b) => b.hp - a.hp);
}

// ---------------------------------------------------------------- vind og vejr

export const VEJRTYPER = ['solskin', 'overskyet', 'regn', 'slud', 'sne', 'taage'];

export function rulVind(v) {
  if (!v.cfg.vind) { v.vind = 0; return; }
  // Vejret påvirker skuddene gennem VEJR_FYSIK i physics.js (vindstyrke,
  // vindstød og luftmodstand) — men aldrig gennem noget skjult: sigtelinjen
  // integrerer med de samme tal, så spilleren ser effekten, før der skydes.
  // Variansen her afgør, hvor vild rullen mellem turene kan blive.
  const varians = { solskin: 0.45, overskyet: 0.6, regn: 0.8, slud: 0.9, sne: 0.55, taage: 0.35 };
  const spaend = varians[v.vejr] ?? 0.6;
  const raa = (v.rngSim() - 0.5) * 2 * spaend;
  v.vind = Math.round(raa * 20) / 20;      // trin på 0,05
}

export function maaskeSkiftVejr(v) {
  if (v.tur.turNr > 0 && v.tur.turNr % 5 === 0 && v.rngSim() < 0.2) {
    v.vejr = VEJRTYPER[Math.floor(v.rngSim() * VEJRTYPER.length)];
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- sudden death

export function udloesSuddenDeath(v, h) {
  v.pludseligDoed = true;
  for (const b of v.baevere) if (!b.doed && b.hp > 1) b.hp = 1;
  v.vandNiveau += SUDDEN_SPRING;
  h.push({ navn: 'pludseligDoed', vand: v.vandNiveau });
}

export function hoevVand(v, h) {
  v.vandNiveau += SUDDEN_STIGNING;
  h.push({ navn: 'vandStiger', vand: v.vandNiveau });
}

export const sekTilTicks = (s) => Math.round(s * HZ);
export const ticksTilSek = (t) => t / HZ;
