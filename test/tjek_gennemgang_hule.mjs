/* Kladde: falder stenskredet og Kvartalsopkrævningen igennem grottens loft?
 * Skriver kun tal ud.
 *
 *   node --no-warnings test/tjek_gennemgang_hule.mjs
 */
import { lavVerden } from '../static/js/sim/world.js';
import { udloes, kanSke } from '../static/js/sim/haendelser.js';
import * as B from '../static/js/sim/behaviours.js';
import { VAABEN } from '../static/js/sim/weapons.js';
import { LUFT, FJELD } from '../static/js/sim/terrain.js';
import { testFroe, lavHold } from './kort_hjaelp.mjs';

const cfg = { turTicks: 2700, kampTicks: 108000, vind: true, vejr: 'solskin', banetype: 'hule' };

/** Kør verden, til projektilerne og køen er tomme; saml eksplosionerne. */
function koer(v) {
  const eks = [];
  for (let i = 0; i < 1500; i++) {
    for (const e of v.skridt()) if (e.navn === 'eksplosion') eks.push({ x: Math.round(e.x), y: Math.round(e.y) });
    if (!v.projektiler.length && !v.forsinkede.length && !v.eksplosionsKoe.length && i > 60) break;
  }
  return eks;
}

for (let i = 0; i < 4; i++) {
  const froe = testFroe(500 + i);
  const v = lavVerden({ froe, banetype: 'hule', hold: lavHold(2, 2), cfg });
  v.startKamp();
  const t = v.terraen;
  // Den højeste luft under loftet (grottens loft) i banen.
  let loft = 0;
  for (let x = 0; x < t.w; x += 16) for (let y = t.h - 17; y > 0; y--) if (t.hent(x, y) === LUFT) { loft = Math.max(loft, y); break; }
  const hpFoer = v.baevere.map((b) => b.hp);
  const h = [];
  const kan = kanSke(v, 'stenskred');
  const e = udloes(v, 'stenskred', h);
  const eks = koer(v);
  console.log(`${t.arketype} frø ${froe}: kanSke(stenskred) ${kan}, banner "${e.titel}", toppen er ${t.hent(100, t.h - 2) === FJELD ? 'FJELD' : 'ikke FJELD'}, grottens højeste luft y ${loft}`);
  console.log(`  stenskred: ${eks.length} nedslag, y ${[...new Set(eks.map((q) => q.y))].join(', ')}; skade på kunderne ${v.baevere.reduce((s, b, j) => s + hpFoer[j] - b.hp, 0)}`);

  // Kvartalsopkrævning mod en kunde på det andet hold.
  const skytte = v.baevere[0], maal = v.baevere.find((b) => b.hold !== skytte.hold);
  const hp2 = v.baevere.map((b) => b.hp);
  // Markøren på kunden, som i spillet (world sender markørens x og y).
  B.affyr(v, skytte, VAABEN.traestammeregn, 1, { x: maal.x, y: maal.y + 20, retning: 1 });
  const eks2 = koer(v);
  console.log(`  luftangreb mod x ${Math.round(maal.x)}, y ${Math.round(maal.y)}: ${eks2.length} nedslag, y ${[...new Set(eks2.map((q) => q.y))].join(', ')}; skade ${v.baevere.reduce((s, b, j) => s + hp2[j] - b.hp, 0)}`);
}
