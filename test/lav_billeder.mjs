/* Kundekrigen — kontaktark over banerne.
 *
 * Tegner 12 frø pr. banetype som PNG i test/billeder/ (kort_<type>.png), så
 * man kan se, om banerne er forskellige og ligner Worms. Hvert kort har
 * arketypen og frøet som etiket; startpladserne er prikker i holdets farve
 * (fortet) eller hvide (de andre typer), pynten er grønne prikker.
 *
 *   node test/lav_billeder.mjs            alle typer, 12 frø
 *   node test/lav_billeder.mjs fort 24    kun fortet, 24 frø
 *   node test/lav_billeder.mjs fort 0 3   også et nærbillede af frø nr. 0-2
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { genererSpilbar, BANE_TYPER } from '../static/js/sim/terrain_gen.js';
import { malBane, kontaktark, skrivPng, skrivTekst, beskaer, testFroe } from './kort_hjaelp.mjs';

const MAPPE = join(dirname(fileURLToPath(import.meta.url)), 'billeder');
mkdirSync(MAPPE, { recursive: true });

const typer = process.argv[2] && process.argv[2] !== 'alle' ? [process.argv[2]] : BANE_TYPER;
const antal = +(process.argv[3] || 12);
const naer = +(process.argv[4] || 0);
const LAYOUT = { antalHold: 2, prHold: 2 };

for (const type of typer) {
  const billeder = [];
  for (let i = 0; i < antal; i++) {
    const froe = testFroe(i);
    const r = genererSpilbar(froe, type, 4, type === 'fort' ? LAYOUT : null);
    const t = r.terraen;
    const pladser = t.fort ? t.fort.forter.flatMap((f, hi) => f.pladser.map((p) => ({ ...p, hold: hi }))) : r.pladser;
    const udstyr = t.fort ? t.fort.forter.flatMap((f) => f.udstyr) : [];
    const b = malBane(t, 8, { pladser, pynt: t.pynt || [], udstyr });
    skrivTekst(b, 6, 6, `${i} ${t.arketype || type}${t.fort?.reserve ? ' (reserve)' : ''}`);
    billeder.push(b);
    if (i < naer) {
      const s = 2, stor = malBane(t, s, { pladser, pynt: t.pynt || [], udstyr });
      skrivPng(join(MAPPE, `naer_${type}_${i}.png`), stor.w, stor.h, stor.rgb);
      if (t.fort) {
        // midten af banen, hvor borgene møder hinanden
        const x0 = Math.max(0, Math.round((t.fort.forter[0].fod[0] - 60) / s)), x1 = Math.min(stor.w, Math.round((t.fort.forter[t.fort.forter.length - 1].fod[1] + 60) / s));
        const y0 = Math.max(0, stor.h - Math.round((t.fort.top + 80) / s));
        const c = beskaer(stor, x0, y0, x1 - x0, stor.h - y0);
        skrivPng(join(MAPPE, `naer_${type}_${i}.png`), c.w, c.h, c.rgb);
      }
    }
  }
  const ark = kontaktark(billeder, 2);
  skrivPng(join(MAPPE, `kort_${type}.png`), ark.w, ark.h, ark.rgb);
  console.log(`${type}: ${join(MAPPE, `kort_${type}.png`)}`);
}
