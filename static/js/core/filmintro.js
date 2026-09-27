/* Kundekrigen — filmintroen før kampen: tidslinjen.
 *
 * En selvstændig filmsekvens i fightingspil-stil, der præsenterer klinikkernes
 * faste personale (figur 17-22, se core/klinikker.js), før nedtællingen og
 * faldet fra himlen. Kun de ansatte, der faktisk er med i kampen, vises.
 *
 * Filen er ren data og deles af to parter, der SKAL være enige:
 *   simulationen (sim/world.js) — hvor mange tick tilstanden FILM varer,
 *     så den første tur starter på samme tick hos værten og alle gæster;
 *   skærmen (ui/filmintro.js) — hvilket slag der vises hvornår.
 * Derfor ingen DOM, ingen fetch og intet tilfældigt her. Udseendet (grafik,
 * CSS, tekster) ejer art directoren; se docs/filmintro.md.
 */
'use strict';

import { HZ } from './tick.js';
import { PERSONALE } from './klinikker.js';

/** Hvor længe hvert slag står, i ms. Kan justeres — varigheden følger med. */
export const FILM_MS = {
  titel: 900,      // KUNDEKRIGEN slår ind
  klinik: 700,     // klinikkens navn og farve
  kunde: 1200,     // én ansat: portræt, navn, rolle og replik
  vs: 1600,        // alle ansatte på række mod hinanden: VS
  slut: 400,       // fade over i kampen
};                 // 3 mod 3: 11,5 s — og man kan springe over

/**
 * Kunde-slaget pr. figur, når den ansatte har et filmklip (Veo-intro, se
 * docs/filmintro-veo.md): klippets længde i ms. Klippet selv står i
 * grafik/intro/intro.json ("video"); længden står HER, fordi simulationen
 * skal kende den deterministisk. Uden tal: FILM_MS.kunde.
 */
export const FILM_KUNDE_MS = {
  21: 10000,       // Dr. Jan fra Mors — 21.mp4, 10,0 s
};
export const kundeMs = (figur) => FILM_KUNDE_MS[figur] ?? FILM_MS.kunde;

/** Standardtekster, indtil art directorens grafik/intro/intro.json giver andre. */
export const FILM_KUNDER = {
  16: { rolle: 'Sekretær', replik: 'Tag et nummer. Og vent.' },
  17: { rolle: 'Sygeplejerske', replik: 'Bare rolig. Det her gør kun lidt ondt.' },
  18: { rolle: 'Speciallæge', replik: 'Jeg har ikke tid til dig. Men jeg har tid til det her.' },
  19: { rolle: 'Sekretær', replik: 'Nå. Så det er dig, der ringede i morges.' },
  20: { rolle: 'Sygeplejerske', replik: 'Dit tidsrum er udløbet.' },
  21: { rolle: 'Speciallæge', replik: 'Er det … er det nu?' },
};

/** Er figuren en af klinikkernes faste ansatte? */
function ansat(b) {
  const f = b?.udseende?.figur;
  if (!b?.udseende?.fast) return null;
  for (const [farve, liste] of Object.entries(PERSONALE)) {
    const j = liste.findIndex((p) => p.figur === f);
    if (j >= 0) return { farve, plads: j, navn: liste[j].navn, figur: f };
  }
  return null;
}

/**
 * Tidslinjen for en opstilling. hold er [{ farve, navn }] i holdrækkefølge,
 * baevere [{ id, hold, navn, udseende }]. Svarer [] når ingen ansatte er med
 * — så springes filmen helt over.
 *
 * Hvert slag: { type, fra, til } i ms plus det, skærmen skal vise:
 *   klinik { holdIdx, farve, navn, side }
 *   kunde  { holdIdx, farve, baever, figur, navn, side, nr }
 *   vs     { rækker: [{ holdIdx, farve, navn, kunder: [{ baever, figur, navn }] }] }
 * side er 'venstre' for lige hold og 'hoejre' for ulige (fightingspil: hver sin side).
 */
export function filmTidslinje(hold, baevere) {
  const raekker = hold.map((h, i) => ({
    holdIdx: i, farve: h.farve, navn: h.navn,
    kunder: baevere.filter((b) => b.hold === i && ansat(b))
      .map((b) => ({ baever: b.id, figur: b.udseende.figur, navn: b.navn })),
  }));
  if (!raekker.some((r) => r.kunder.length)) return [];

  const slag = [];
  let t = 0;
  const laeg = (type, ms, data) => { slag.push({ type, fra: t, til: t + ms, ...data }); t += ms; };
  laeg('titel', FILM_MS.titel, {});
  for (const r of raekker) {
    if (!r.kunder.length) continue;              // klinikker uden personale præsenteres ikke
    const side = r.holdIdx % 2 ? 'hoejre' : 'venstre';
    laeg('klinik', FILM_MS.klinik, { holdIdx: r.holdIdx, farve: r.farve, navn: r.navn, side });
    r.kunder.forEach((k, nr) => laeg('kunde', kundeMs(k.figur), {
      holdIdx: r.holdIdx, farve: r.farve, baever: k.baever, figur: k.figur, navn: k.navn, side, nr,
    }));
  }
  laeg('vs', FILM_MS.vs, { raekker: raekker.filter((r) => r.kunder.length) });
  laeg('slut', FILM_MS.slut, {});
  return slag;
}

/** Filmens længde i tick (0 = ingen film). */
export function filmTicks(hold, baevere) {
  const s = filmTidslinje(hold, baevere);
  return s.length ? Math.ceil(s[s.length - 1].til * HZ / 1000) : 0;
}
