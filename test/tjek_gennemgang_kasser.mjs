/* Kladde: hvor lander fortets forsyningskasser RIGTIGT (med faldskærm og
 * vind), og hvor højt over det, man kan stå på, er det? Skriver kun tal ud.
 *
 *   node --no-warnings test/tjek_gennemgang_kasser.mjs
 */
import { fortPlan } from '../static/js/sim/terrain_gen.js';
import { lavVerden } from '../static/js/sim/world.js';
import * as F from '../static/js/sim/physics.js';
import { testFroe, lavHold } from './kort_hjaelp.mjs';

const cfg = { turTicks: 2700, kampTicks: 108000, vind: true, vejr: 'solskin', banetype: 'fort' };
const res = {};
let seeds = 0;
for (let i = 0; i < 400 && seeds < 60; i++) {
  const froe = testFroe(900 + i);
  const v = lavVerden({ froe, banetype: 'fort', hold: lavHold(2, 2), cfg });
  v.startKamp();
  const t = v.terraen, fort = t.fort;
  const sil = fort.siluet;
  const plan = fortPlan(v.layout, t.w, froe, fort.reserve ? 'hav' : null);
  const pv = plan.variant;
  // Det højeste, man kan stå på: en tinde på taget, keepens top eller gangbroen.
  const naaeligFod = Math.max(pv.y[pv.n], pv.yK, pv.gangbro ? pv.gangbro.y : 0) + pv.tinde.h;
  const r = (res[sil] ||= { borge: 0, fald: 0, strandet: 0, borgeMed: 0, over: [] });
  r.borge++; seeds++;
  let med = false;
  for (let n = 0; n < 200; n++) {
    // Vinden som i en tur (turn.rulVind) i et tilfældigt vejr.
    const VAR = { solskin: 0.45, overskyet: 0.6, regn: 0.8, slud: 0.9, sne: 0.55, taage: 0.35 };
    const vejr = Object.keys(VAR)[Math.floor(Math.random() * 6)];
    const vind0 = Math.round((Math.random() - 0.5) * 2 * VAR[vejr] * 20) / 20;
    v.vind = F.vindNu(vind0, vejr, Math.floor(Math.random() * 1e5), froe);
    v.kasser.length = 0;
    const k = v._slipVaabenkasse({ x: 0, y: 0 }, []);
    const x0 = k.x, startHoej = t.overflade(x0) - 36 - naaeligFod > 113;
    let s = 0;
    while (!k.landet && s++ < 4000) F.skridtKasse(t, k, v.vind);
    r.fald++;
    // Samles op, hvis foden er over k.y - 2R - 16; en salto løfter 113 wu.
    const krav = k.y - 36 - naaeligFod;
    if (k.y > v.vandNiveau && krav > 113) {
      r.strandet++; med = true; r.over.push(Math.round(krav));
      if (startHoej) r.fraTaarn = (r.fraTaarn || 0) + 1; else r.drevet = (r.drevet || 0) + 1;
      // Ligger kassen oven på noget, eller sidder den fast i en mur (landet på siden)?
      if (t.overflade(Math.round(k.x)) > k.y + 2) r.iMur = (r.iMur || 0) + 1; else r.ovenpaa = (r.ovenpaa || 0) + 1;
    }
  }
  if (med) r.borgeMed++;
}
for (const [sil, r] of Object.entries(res)) {
  const o = r.over.sort((a, b) => a - b);
  console.log(`${sil}: ${r.borgeMed}/${r.borge} borge, ${r.strandet}/${r.fald} kasser (${(100 * r.strandet / r.fald).toFixed(1)} %) strandet (sluppet over et tårn ${r.fraTaarn || 0}, drevet derop ${r.drevet || 0}; oven på ${r.ovenpaa || 0}, fast i en mur ${r.iMur || 0}); løft ud over saltoen: min ${o[0]}, maks ${o.at(-1)}`);
}
