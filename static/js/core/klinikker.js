/* Kundekrigen — holdene er klinikker, og klinikkerne har fast personale.
 *
 * Holdets farve er dets id i protokollen (samme rækkefølge som rum.py's
 * HOLD_FARVER). Personalet (tegneseriekunde 17-22, indeks 16-21) er
 * karaktererne i karaktervalget (core/roster.js): hver spiller vælger sin
 * fighter blandt dem og sit hold, blåt eller rødt (docs/karaktervalg.md).
 * Personale og hold er uafhængige; en ansat kan kæmpe for begge klinikker.
 */
'use strict';

// Holdenes rækkefølge = holdindekset i kampen. Karaktervalget har (til en
// start) kun blåt (0, venstre) og rødt (1, højre); HUD'en og sejrsskærmen slår
// farven op efter indekset, så de to skal stå først.
export const HOLD_ORDEN = ['blaa', 'roed', 'groen', 'gul'];

export const HOLD_NAVNE = {
  groen: 'Klinik Højhaven',
  blaa: 'Speciallægeselskabet Mogensen',
  roed: 'Klinik Højhaven',       // blåt mod rødt: de to klinikker (karaktervalget har kun de to hold)
  gul: 'Klinik Gul',
};

export const PERSONALE = {
  groen: [
    { navn: 'Skrankepaven Ingrid', figur: 16 },         // sekretær, direkte og hård
    { navn: 'Bente "Bare Rolig" Hansen', figur: 17 },   // sygeplejerske, overbeskyttende
    { navn: 'Hansen, Dr. Hansen', figur: 18 },          // speciallæge, arrogant
  ],
  blaa: [
    { navn: 'Praktikant Trine', figur: 19 },            // sekretær, passiv-aggressiv
    { navn: 'Systemsygeplejerske 2.0', figur: 20 },     // sygeplejerske, koldt klinisk
    { navn: 'Dr. Jan fra Mors', figur: 21 },            // speciallæge, bitter og vestjysk
  ],
};

/** Personalet på plads j i klinikken med farven farve, eller null. */
export function personale(farve, j) {
  const p = PERSONALE[farve]?.[j];
  return p ? { navn: p.navn, udseende: { v: 5, figur: p.figur, fast: true } } : null;
}
