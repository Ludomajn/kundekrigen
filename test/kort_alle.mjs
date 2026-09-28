/* Kundekrigen — kør alle banetestene.
 *
 *   node --no-warnings test/kort_alle.mjs
 *
 * Afslutningskoden er 1, hvis en kontrol fejler.
 */
import { status } from './kort_hjaelp.mjs';

const t0 = performance.now();
await import('./kort_determinisme.mjs');
await import('./kort_variation.mjs');
await import('./kort_spilbarhed.mjs');
await import('./kort_fort.mjs');
await import('./kort_tid.mjs');
await import('./kort_gennemgang.mjs');
const { ok, fejl } = status();
console.log(`\n${ok} ok, ${fejl} fejl (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
