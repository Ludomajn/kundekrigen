/* Kundekrigen — test: banerne genereres hurtigt nok.
 *
 * Banen bygges ved kampstart på værtens Worker OG på hver klients
 * hovedtråd (spejlet), så den skal være hurtig: mål hele genererSpilbar
 * (med nye forsøg) for hver type og fortets opstillinger. Kravet er under
 * 250 ms pr. bane i Node (95 %-fraktilen) og et gennemsnit under 150 ms.
 * Første kørsel (JIT-opvarmning) tælles ikke med.
 *
 *   node --no-warnings test/kort_tid.mjs
 */
import { genererSpilbar, BANE_TYPER } from '../static/js/sim/terrain_gen.js';
import { tjek, overskrift, testFroe, percentil } from './kort_hjaelp.mjs';

const N = 20;
genererSpilbar(testFroe(0), 'aaben', 4); genererSpilbar(testFroe(0), 'fort', 4, { antalHold: 2, prHold: 2 });

const maal = (navn, type, layout, antal) => {
  const tider = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    genererSpilbar(testFroe(900 + i), type, antal, layout);
    tider.push(performance.now() - t0);
  }
  const snit = tider.reduce((a, b) => a + b, 0) / N, p95 = percentil(tider, 0.95), maks = Math.max(...tider);
  tjek(`${navn}: 95 % under 250 ms og snit under 150 ms`, p95 < 250 && snit < 150,
    `snit ${snit.toFixed(0)} ms, 95 % ${p95.toFixed(0)} ms, maks ${maks.toFixed(0)} ms`);
};

overskrift(`Tid pr. bane (${N} frø pr. linje)`);
for (const type of BANE_TYPER) if (type !== 'fort') maal(type, type, null, 8);
for (const [H, pr] of [[2, 2], [2, 4], [3, 2], [4, 2], [6, 2]]) maal(`fort ${H}x${pr}`, 'fort', { antalHold: H, prHold: pr }, H * pr);
