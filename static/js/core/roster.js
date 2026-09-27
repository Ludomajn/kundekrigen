/* Kundekrigen — rosteret: de karakterer, man kan vælge i karaktervalget.
 *
 * Klinikkernes seks ansatte (figur 17-22, 0-baseret 16-21). Man vælger en
 * karakter til hver af sine pladser; samme karakter må vælges flere gange og
 * af begge hold (spejlkamp, som i Tekken). aaben styrer, hvem der kan vælges;
 * de utilgængelige vises med deres model og et banner, og resten står låst
 * som "Kommer snart", indtil de er klar (se status nedenfor).
 *
 * SAMME LISTE findes i rum.py (ROSTER) til netværksrummene; hold dem ens.
 */
'use strict';

import { PERSONALE } from './klinikker.js';

const ROLLER = { 16: 'Sekretær', 17: 'Sygeplejerske', 18: 'Speciallæge',
                 19: 'Sekretær', 20: 'Sygeplejerske', 21: 'Speciallæge' };
const AABNE = new Set([16, 21]);              // Skrankepaven Ingrid og Dr. Jan fra Mors
// Vises med deres rigtige model og et "UTILGÆNGELIG"-banner, men kan ikke vælges
// endnu: Hansen, Dr. Hansen og Systemsygeplejerske 2.0 ("Superbrugeren").
const UTILGAENGELIGE = new Set([18, 20]);

/*
 * status: 'aaben' (kan vælges), 'utilgaengelig' (modellen vises med banner,
 * kan ikke vælges) eller 'laast' (silhuet, "Kommer snart"). aaben er det
 * eneste, der kan vælges — det er det, rum.py spejler (ROSTER_AABNE).
 */
export const ROSTER = Object.entries(PERSONALE).flatMap(([klinik, liste]) =>
  liste.map((p) => {
    const aaben = AABNE.has(p.figur);
    const status = aaben ? 'aaben' : UTILGAENGELIGE.has(p.figur) ? 'utilgaengelig' : 'laast';
    return { figur: p.figur, navn: p.navn, rolle: ROLLER[p.figur] || '', klinik, aaben, status };
  }));

export const rosterFigur = (figur) => ROSTER.find((r) => r.figur === figur) || null;
export const aabneFigurer = () => ROSTER.filter((r) => r.aaben).map((r) => r.figur);

/** Udseendet for en valgt karakter (fast: filmintroen og figurerne kender den). */
export const rosterUdseende = (figur) => ({ v: 5, figur, fast: true });

/**
 * Navnet på pladsen: karakterens navn, og vælges den flere gange i samme
 * kamp, får de næste et romertal ("Dr. Jan fra Mors II"), så bannere og
 * holdlister kan skelne dem. nr er 0 for den første forekomst.
 */
const ROMER = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII'];
export function rosterNavn(figur, nr = 0) {
  const r = rosterFigur(figur);
  return r ? r.navn + (ROMER[nr] ?? ` ${nr + 1}`) : null;
}

export const BANE_VALG = ['fort', 'aaben', 'hule', 'oeer', 'tilfaeldig'];
