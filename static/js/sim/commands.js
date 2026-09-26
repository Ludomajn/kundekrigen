/* Kundekrigen — kommandoer fra spiller til simulation.
 *
 * DESIGNREGEL: send HOLDTE TASTER, ikke afledt tilstand.
 * Aldrig en sigtevinkel som float — send at "sigt op" er holdt, og lad værten
 * integrere. Så lever vinklen kun ét sted, snyd er afgrænset til hvad et
 * tastatur kan udtrykke, og nyttelasten er 2 bytes.
 *
 * Beskederne er kantudløste: en 'hold'-besked sendes kun når bitmasken ÆNDRER
 * sig, så en aktiv spiller sender 2-10 beskeder i sekundet og en passiv nul.
 */
'use strict';

export const K = {
  VENSTRE: 1, HOEJRE: 2, HOP: 4, SIGT_OP: 8, SIGT_NED: 16,
  LAD: 32, SALTO: 64, FIN: 128,
};

export const HANDLINGER = new Set([
  'vaelgVaaben', 'affyr', 'markoer', 'lunte', 'staaOver', 'drejBjaelke', 'retning',
]);

export function holdKommando(seq, bitmaske) {
  return { k: 'hold', seq, b: bitmaske | 0 };
}

export function handling(seq, h, data = {}) {
  return { k: 'handling', seq, h, ...data };
}

/**
 * Valider en kommando før den slippes ind i simulationen.
 * Værten validerer ALTID — også sine egne. Ikke af mistro, men fordi en
 * gammel fane eller et dobbeltbundet tastatur ellers kan sende input for en
 * bæver der ikke er i tur, og den fejl er umulig at forstå indefra spillet.
 */
export function valider(v, cmd, pid) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, fejl: 'tom kommando' };

  const b = v.aktivBaever();
  if (!b) return { ok: false, fejl: 'ingen aktiv bæver' };

  // Ejerskab: pid skal eje bæveren, eller — hvis sædet er frit — være på holdet.
  if (pid != null) {
    const ejer = b.ejer;
    if (ejer && ejer !== pid) return { ok: false, fejl: 'ikke din bæver' };
    if (!ejer && !v.pidPaaHold(pid, b.hold)) return { ok: false, fejl: 'ikke dit hold' };
  }

  if (cmd.k === 'hold') {
    if (!v.accepterBevaegelse()) return { ok: false, fejl: 'ikke din tur til at bevæge dig' };
    return { ok: true };
  }
  if (cmd.k === 'handling') {
    if (!HANDLINGER.has(cmd.h)) return { ok: false, fejl: 'ukendt handling' };
    if (cmd.h === 'affyr') {
      if (!v.accepterAffyring()) return { ok: false, fejl: 'kan ikke affyre nu' };
      const kr = cmd.kraft;
      if (typeof kr !== 'number' || !(kr >= 0 && kr <= 1)) return { ok: false, fejl: 'ugyldig kraft' };
    }
    if (cmd.h === 'markoer') {
      if (typeof cmd.x !== 'number' || typeof cmd.y !== 'number') return { ok: false, fejl: 'ugyldig markør' };
    }
    return { ok: true };
  }
  return { ok: false, fejl: 'ukendt kommandotype' };
}
