/* Kundekrigen — fast tidsskridt.
 *
 * Simulationen kører 60 Hz uanset skærmens opdateringsfrekvens. 30 s tur =
 * 1800 tick, 30 min kamp = 108.000 tick, så alle spilregler er heltal og
 * dermed serialiserbare og replay-eksakte.
 *
 * Akkumulatoren har et loft på indhentning: falder vi bagud (fanen var skjult,
 * maskinen hakkede), springer vi resten over i stedet for at spiralere ind i
 * en dødsspiral af indhentningsskridt.
 */
'use strict';

export const HZ = 60;
export const DT = 1 / HZ;
const MAKS_RAMME = 0.25;      // et længere spring behandles som en pause
const MAKS_SKRIDT = 5;        // indhentningsloft per frame

export function lavUr(skridt) {
  let akk = 0;
  let sidst = 0;
  let tick = 0;
  const stat = { skridtSidst: 0, droppet: 0, fps: 0 };
  let fpsAkk = 0, fpsTael = 0;

  return {
    get tick() { return tick; },
    get alfa() { return akk / DT; },     // til interpolation i rendering
    stat,
    nulstil(nu) { sidst = nu; akk = 0; },
    /** Kaldes med et tidsstempel i sekunder. Returnerer antal kørte skridt. */
    fremad(nu) {
      if (!sidst) { sidst = nu; return 0; }
      let ramme = nu - sidst;
      sidst = nu;
      if (ramme > MAKS_RAMME) ramme = MAKS_RAMME;
      fpsAkk += ramme; fpsTael++;
      if (fpsAkk >= 0.5) { stat.fps = Math.round(fpsTael / fpsAkk); fpsAkk = 0; fpsTael = 0; }

      akk += ramme;
      let n = 0;
      while (akk >= DT && n < MAKS_SKRIDT) { skridt(tick++); akk -= DT; n++; }
      if (akk >= DT) { stat.droppet += Math.floor(akk / DT); akk = akk % DT; }
      stat.skridtSidst = n;
      return n;
    },
  };
}
