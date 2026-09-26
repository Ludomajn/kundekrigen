/* Kundekrigen — menuens baggrundsillustration.
 *
 * Parallaksepakkens lag stables som ét stillbillede: himmel, skybanke,
 * bakker, skyer, buske, trærækker og sandjorden forrest — plus fire figurer,
 * én fra hvert hold, og et par kasser. Tegnes én gang ved opstart og lægges
 * som CSS-baggrund bag menukortet, så menuen ser ud som spillet.
 */
'use strict';

import { hent } from './assets.js';
import { tegnFigur, indlaesGrafik } from './figur_view.js';

export async function malMenuScene(W = 1600, H = 900) {
  await indlaesGrafik();
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // Lagene er 2048 x 1546 med gennemsigtig himmel. Hvert lag placeres ud
  // fra hvor dets INDHOLD begynder (målt som andel fra lagets bund), så
  // bakkekamme og trælinjer lander i de ønskede højder på lærredet.
  const lagH = W * (1546 / 2048);
  const tegnLag = (navn, indholdV, oensketY, alpha = 1) => {
    const img = hent(navn);
    if (!img) return;
    g.save(); g.globalAlpha = alpha;
    g.drawImage(img, 0, oensketY - (1 - indholdV) * lagH, W, lagH);
    g.restore();
  };

  tegnLag('px_himmel', 1, 0);                    // gradient-himlen bagest
  tegnLag('px_skybanke', 0.72, H * 0.10, 0.95);
  tegnLag('px_fjernskyer1', 0.86, H * 0.16);
  tegnLag('px_bakke2', 0.55, H * 0.34);
  tegnLag('px_bakke1', 0.53, H * 0.42);
  tegnLag('px_skyer', 0.97, H * 0.20);
  tegnLag('px_buske', 0.36, H * 0.55);
  tegnLag('px_fjerntraeer', 0.45, H * 0.58);
  tegnLag('px_traeer', 0.51, H * 0.62);
  tegnLag('px_jord', 0.22, H * 0.82);

  const jordY = H * 0.82;                        // sandoverfladen fra px_jord

  // Kasser og en tønde i sandet.
  const ting = [['kasseVaaben', 0.31, 64], ['toendeRoed', 0.62, 54], ['kasseHelbred', 0.55, 50]];
  for (const [navn, fx, str] of ting) {
    const img = hent(navn);
    if (!img) continue;
    const h = str * (img.height / img.width);
    g.drawImage(img, W * fx - str / 2, jordY - h + 4, str, h);
  }

  // Klinikkernes folk: Højhaven til venstre, Mogensen til højre, vendt mod
  // hinanden. Skrankepaven og Dr. Hansen mod praktikanten og Dr. Jan.
  const folk = [[0.09, 0, 16], [0.24, 0, 18], [0.76, 1, 21], [0.91, 1, 19]];
  for (const [fx, hold, figur] of folk) {
    tegnFigur(g, hold, { v: 5, figur }, W * fx, jordY + 4, 130, fx > 0.5 ? -1 : 1);
  }

  return c;
}
