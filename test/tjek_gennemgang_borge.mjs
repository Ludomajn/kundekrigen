/* Kladde: hvor forskellige er selve borgene inden for én siluet? Borgens
 * murværk i celler på 24 wu, rettet ind efter facaden og y[0]; Jaccard-
 * afstanden mellem par med samme siluet. Skriver tal ud og (med en sti som
 * argument) et kontaktark med de nærmeste par ved siden af hinanden.
 *
 *   node --no-warnings test/tjek_gennemgang_borge.mjs [billede.png]
 */
import { genererSpilbar } from '../static/js/sim/terrain_gen.js';
import { testFroe, malBane, beskaer, kontaktark, skrivTekst, skrivPng, borgSilhuet, afstand } from './kort_hjaelp.mjs';

const N = 60, Wd = 1400, Hd = 1500;
const borg = (t) => borgSilhuet(t, 24, Wd, Hd);
const jac = afstand;

const baner = [];
for (let i = 0; i < N; i++) {
  const froe = testFroe(i);
  const t = genererSpilbar(froe, 'fort', 4, { antalHold: 2, prHold: 2 }).terraen;
  baner.push({ froe, t, b: borg(t), sil: t.fort.siluet, v: t.fort.forter[0] });
}
const prSil = {};
const par = [];
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
  if (baner[i].sil !== baner[j].sil) continue;
  const d = jac(baner[i].b, baner[j].b);
  (prSil[baner[i].sil] ||= []).push(d);
  par.push({ i, j, d });
}
for (const [s, l] of Object.entries(prSil)) {
  l.sort((a, b) => a - b);
  console.log(`${s}: ${l.length} par, median ${l[l.length >> 1].toFixed(2)}, min ${l[0].toFixed(2)}, under 0,25: ${(100 * l.filter((x) => x < 0.25).length / l.length).toFixed(0)} %`);
}
par.sort((a, b) => a.d - b.d);
const sti = process.argv[2];
if (sti) {
  const S = 4, billeder = [];
  const udsnit = (t) => {
    const b = malBane(t, S), f = t.fort.forter[0];
    const x0 = Math.max(0, Math.floor((f.facade - Wd) / S)), w = Math.floor(Wd / S) + 40;
    const yTop = Math.max(0, Math.floor((t.h - (t.fort.base - 120 + Hd)) / S)), h = Math.floor(Hd / S);
    return beskaer(b, x0, yTop, Math.min(w, b.w - x0), Math.min(h, b.h - yTop));
  };
  // De fem nærmeste par og et par omkring medianen.
  const vis = [...par.slice(0, 5), par[par.length >> 1]];
  for (const p of vis) {
    for (const k of [p.i, p.j]) {
      const u = udsnit(baner[k].t);
      skrivTekst(u, 6, 6, `${baner[k].sil} ${k} d ${p.d.toFixed(2)}`);
      billeder.push(u);
    }
  }
  const ark = kontaktark(billeder, 2);
  skrivPng(sti, ark.w, ark.h, ark.rgb);
  console.log(`skrev ${sti}`);
}
