/* Kundekrigen — entiteter og id-tildeling.
 *
 * Alt ligger i almindelige arrays med monotone heltals-id'er. Vi itererer
 * aldrig over en Map eller et Set på en måde der påvirker simulationens
 * resultat — iterationsrækkefølge er en af de stille kilder til desync.
 */
'use strict';

export const BAEVER_R = 10;        // kapselradius
export const BAEVER_H = 10;        // kapslens lige stykke; total højde = 2r + h
export const MAKS_HP = 100;

/* TRÆFZONEN er adskilt fra bevægelseskapslen. Kapslen (30 wu) er lav med
 * vilje, så figurerne kan gå under udhæng og ind i huler; men figuren er
 * ~46 wu høj, og en raket gennem hovedet SKAL tælle. Zonen er en lodret
 * kapsel om figurens krop: centerlinje fra fod+halvB til top-halvB.
 * Render-laget tegner figuren i netop denne højde (figur_view.js). */
export const HITBOX = { halvB: 9, hoejde: 46 };

/** Korteste afstand fra (x, y) til figurens træfzone (0 = indeni). */
export function afstandTilHitbox(b, x, y) {
  const y0 = b.y + HITBOX.halvB, y1 = b.y + HITBOX.hoejde - HITBOX.halvB;
  const cy = y < y0 ? y0 : y > y1 ? y1 : y;
  const dx = x - b.x, dy = y - cy;
  return Math.max(0, Math.sqrt(dx * dx + dy * dy) - HITBOX.halvB);
}

/** Midten af træfzonen — til knockback-retning og mål-hjælp. */
export const hitboxMidte = (b) => b.y + HITBOX.hoejde / 2;

/** Korteste afstand mellem to figurers træfzoner (0 = de overlapper).
 *  Begge zoner er lodrette kapsler, så det er afstanden mellem to lodrette
 *  linjestykker minus de to radier. Bruges til smitte mellem kunder. */
export function afstandMellemHitbox(a, b) {
  const ay0 = a.y + HITBOX.halvB, ay1 = a.y + HITBOX.hoejde - HITBOX.halvB;
  const by0 = b.y + HITBOX.halvB, by1 = b.y + HITBOX.hoejde - HITBOX.halvB;
  const hul = Math.max(0, by0 - ay1, ay0 - by1);
  const dx = a.x - b.x;
  return Math.max(0, Math.sqrt(dx * dx + hul * hul) - 2 * HITBOX.halvB);
}

/** Tick til en nærhedsmine er skarp (0 = skarp, eller ingen mine).
 *  Minen er skarp, når alder > armering — samme prøve som i world.js. */
export function armerRest(p) {
  if (!p.naerhed || !(p.armering > 0)) return 0;
  return Math.max(0, p.armering + 1 - (p.alder | 0));
}

let _naesteId = 1;
export function nulstilIder(start = 1) { _naesteId = start; }
export function nytId() { return _naesteId++; }

export function lavBaever(id, holdId, navn, udseende, ejer) {
  return {
    id, hold: holdId, navn, udseende: udseende || {}, ejer: ejer || null,
    x: 0, y: 0, vx: 0, vy: 0,
    hp: MAKS_HP, doed: false, drukner: false,
    retning: 1, vinkel: 0.35,           // sigtevinkel i radianer, 0 = vandret frem
    paaJorden: false, faldFra: null,
    redskab: null,                       // aktivt redskab (boret)
    hoppetid: 0, sidsteSkade: 0,
    // Status, som spejlet og netværket skal kende (snapshot + deltaflag):
    skjold: false,                       // Hjemmearbejde: blokerer skade og skub
    springOver: 0,                       // Tvangsopdatering: næste tur springes over
    graver: false,                       // sand, mens boret arbejder
    smittet: 0,                          // COVID: ture tilbage med smitte
  };
}

export function lavProjektil(id, opt) {
  return {
    id, type: 'projektil',
    x: opt.x, y: opt.y, vx: opt.vx, vy: opt.vy,
    r: opt.r ?? 4,
    vindFaktor: opt.vindFaktor ?? 1,
    hop: opt.hop ?? 0,
    rammerBaevere: opt.rammerBaevere ?? true,
    detonation: opt.detonation,
    fyld: opt.fyld || null,              // { r }: bygger terræn, hvor den lander (papirbunken)
    klynge: opt.klynge || null,
    smitte: opt.smitte || null,          // { r, turer }: COVID-skyen ved nedslag
    lunte: opt.lunte ?? -1,              // i tick; -1 = detonerer ved nedslag
    ejer: opt.ejer ?? null,
    ejerHold: opt.ejerHold ?? null,
    sprite: opt.sprite || 'gren',
    spor: opt.spor || null,
    sover: false,
    hvilerPaa: null,                     // id på kunden, den sover oven på (null = terrænet)
    alder: 0,
  };
}

export function lavPlaceret(id, opt) {
  return {
    id, type: 'placeret',
    x: opt.x, y: opt.y, vx: 0, vy: 0, r: 5,
    lunte: opt.lunte ?? 0,
    naerhed: opt.naerhed ?? 0,
    armering: opt.armering ?? 0,
    detonation: opt.detonation,
    ejer: opt.ejer ?? null,
    ejerHold: opt.ejerHold ?? null,
    sprite: opt.sprite || 'dynamit',
    paaJorden: false,
    alder: 0,
  };
}

export function lavKasse(id, opt) {
  return {
    id, type: 'kasse',
    slags: opt.slags,                    // 'vaaben' | 'helbred' | 'telefon'
    indhold: opt.indhold,
    x: opt.x, y: opt.y, vx: 0, vy: 0,
    // Fortets forsyningskasser driver kun inden for [xMin, xMax] (physics.skridtKasse).
    xMin: opt.xMin ?? null, xMax: opt.xMax ?? null,
    landet: false, alder: 0,
  };
}

export function lavGravsten(id, x, y, holdId) {
  return { id, type: 'gravsten', x, y, hold: holdId, alder: 0 };
}
