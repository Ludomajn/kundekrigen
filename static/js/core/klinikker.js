/* Kundekrigen — holdene er klinikker, og de to første har fast personale.
 *
 * Holdets farve er dets id i protokollen (samme rækkefølge som rum.py's
 * HOLD_FARVER). Personalet sidder på de første pladser i deres klinik med
 * eget navn og egen figur (tegneseriekunde 17-22, indeks 16-21). Resten af
 * pladserne, og klinikkerne uden personale, får de almindelige kunder.
 *
 * Personalets pladser er faste roller: spillerens profil skifter ikke deres
 * udseende eller navn (se navngiv i rum.py og transport.js).
 */
'use strict';

export const HOLD_ORDEN = ['groen', 'blaa', 'roed', 'gul'];

export const HOLD_NAVNE = {
  groen: 'Klinik Højhaven',
  blaa: 'Speciallægeselskabet Mogensen',
  roed: 'Klinik Rød',
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
    { navn: 'Dr. Jan fra Mors', figur: 21 },            // speciallæge, nervøs
  ],
};

/** Personalet på plads j i klinikken med farven farve, eller null. */
export function personale(farve, j) {
  const p = PERSONALE[farve]?.[j];
  return p ? { navn: p.navn, udseende: { v: 5, figur: p.figur, fast: true } } : null;
}
