/* Kladde: luft under ruinen på øen mellem borgene? Skriver tal ud og
 * (med en sti som argument) et nærbillede af den værste.
 *
 *   node --no-warnings test/tjek_gennemgang_ruin.mjs [billede.png]
 */
import { genererSpilbar, fortPlan, VAND_NIVEAU } from '../static/js/sim/terrain_gen.js';
import { LUFT, MUR } from '../static/js/sim/terrain.js';
import { testFroe, malBane, beskaer, skrivPng, skrivTekst } from './kort_hjaelp.mjs';

const LAYOUT = { antalHold: 2, prHold: 2 };
const hent = (t, x, y) => t.maske[(t.h - 1 - y) * t.w + x];
const ud = [];
let n = 0, prForm = {};
for (let i = 0; i < 4000 && n < 120; i++) {
  const froe = testFroe(5000 + i);
  const plan = fortPlan(LAYOUT, 5120, froe);
  if (plan.landskab.navn !== 'oe' || !plan.landskab.behov.ruin) continue;
  const t = genererSpilbar(froe, 'fort', 4, LAYOUT).terraen;
  if (t.fort.landskab.navn !== 'oe') continue;
  n++;
  const B = t.fort.landskab.behov, form = B.form;
  const g = t.fort.landskab.huller[0], m = (g.xa + g.xb) / 2;
  let kol = 0, luft = 0, gab = 0, roer = 0;
  for (let x = Math.ceil(m - B.ruin.rw); x <= Math.floor(m + B.ruin.rw); x++) {
    let bund = -1;
    for (let y = VAND_NIVEAU; y < t.h; y++) if (hent(t, x, y) === MUR) { bund = y; break; }
    if (bund < 0) continue;
    kol++;
    let g2 = 0;
    for (let y = bund - 1; y > VAND_NIVEAU && hent(t, x, y) === LUFT; y--) g2++;
    if (g2) { luft++; gab = Math.max(gab, g2); } else roer++;
  }
  const p = (prForm[form] ||= { n: 0, luft: 0 });
  p.n++;
  if (luft) { p.luft++; ud.push({ froe, form, kol, luft, gab, roer, ht: B.ht - VAND_NIVEAU, t, m }); }
}
console.log(`${n} øer med ruin; pr. form: ${Object.entries(prForm).map(([f, p]) => `${f} ${p.luft}/${p.n}`).join(', ')}`);
ud.sort((a, b) => b.gab - a.gab);
for (const u of ud.slice(0, 8)) console.log(`  frø ${u.froe} (${u.form}, ht-V ${u.ht}): ${u.luft}/${u.kol} kolonner med luft under, op til ${u.gab} wu; ${u.roer} kolonner rører jorden`);
const sti = process.argv[2];
if (sti && ud.length) {
  const u = ud[0], S = 1, b = malBane(u.t, S);
  const x0 = Math.round(u.m - 160), yTop = u.t.h - (VAND_NIVEAU + 420);
  const c = beskaer(b, x0, yTop, 320, 460);
  skrivTekst(c, 4, 4, `${u.froe} gab ${u.gab}`);
  skrivPng(sti, c.w, c.h, c.rgb);
  console.log(`skrev ${sti}`);
}
