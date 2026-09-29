/* Kundekrigen — referencesporet til farer_determinisme.mjs.
 *
 *   node --no-warnings test/farer_lav_spor.mjs            # skriv test/farer_fra_spor.json
 *   node --no-warnings test/farer_lav_spor.mjs --tjek     # sammenlign kun, skriv intet
 *
 * Sporet er aftrykket (world.aftryk) og rngSim-tilstanden hvert 120. tick i
 * skriptede kampe på de fire banetyper med cfg.farer: [] — altså UDEN farer.
 * Det blev optaget på træet FØR farerne (sim/farer.js), og farer_determinisme
 * kræver, at det samme kommer ud nu: uden farer er simulationen bit for bit
 * den gamle.
 *
 * Shitstormen er slået fra i sporet: den kunne ikke ske i grotten før
 * (klippen gik til banens top), og nu kan den — dét er en rettelse, ikke en
 * afvigelse.
 *
 * Optag sporet igen med samme kommando, når banegeneratoren eller andet uden
 * for farerne ændrer kampene med vilje. Ellers er testen falsk rød.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lavVerden, T, K } from '../static/js/sim/world.js';
import { HAENDELSER } from '../static/js/sim/haendelser.js';
import { lavHold } from './kort_hjaelp.mjs';

// Ved siden af testene: .gitignore udelader alle mapper, der hedder data/.
export const SPOR_FIL = fileURLToPath(new URL('./farer_fra_spor.json', import.meta.url));
export const SPOR_KAMPE = [
  { froe: 11, bane: 'aaben', hold: [2, 2] },
  { froe: 23, bane: 'oeer', hold: [2, 3] },
  { froe: 37, bane: 'hule', hold: [3, 2] },
  { froe: 41, bane: 'fort', hold: [2, 2] },
];
export const SPOR_TICKS = 12000;
const HVER = 120;
const VAABEN_RAEKKE = ['grenroer', 'egegranat', 'splintboesse', 'koglebombe', 'grenroer', 'halesmaek'];

/** Én skriptet kamp. ekstraCfg lægges oven på (farer_determinisme giver farer: []). */
export function koerSporKamp({ froe, bane, hold }, ekstraCfg = {}) {
  const cfg = { banetype: bane, turTicks: 1500, kampTicks: 43200,
                haendelser: HAENDELSER.filter((s) => s !== 'shitstorm'), ...ekstraCfg };
  const v = lavVerden({ froe, banetype: bane, hold: lavHold(hold[0], hold[1]), cfg });
  v.startKamp();
  const spor = [];
  for (let i = 0; i < SPOR_TICKS && v.tur.tilstand !== T.SEJR; i++) {
    if (v.tur.tilstand === T.FILM) v.udfoerKommando({ k: 'film' });
    if (v.tur.tilstand === T.SPILLER_AKTIV) {
      const pid = v.aktivBaever()?.ejer;
      const tt = v.tur.tilstandTick, n = v.tur.turNr;
      if (tt === 3) v.udfoerKommando({ k: 'handling', h: 'vaelgVaaben', id: VAABEN_RAEKKE[n % VAABEN_RAEKKE.length] }, pid);
      if (tt === 5) v.udfoerKommando({ k: 'hold', b: n % 2 ? K.SIGT_OP : K.SIGT_NED }, pid);
      if (tt === 5 + (n * 7) % 40) v.udfoerKommando({ k: 'hold', b: 0 }, pid);
      if (tt === 50 && n % 3 === 0) v.udfoerKommando({ k: 'hold', b: n % 2 ? K.VENSTRE : K.HOEJRE }, pid);
      if (tt === 80) v.udfoerKommando({ k: 'hold', b: 0 }, pid);
      if (tt === 90 || tt === 140) v.udfoerKommando({ k: 'handling', h: 'affyr', kraft: 0.35 + (n % 6) / 10 }, pid);
    }
    v.skridt();
    if (v.tick % HVER === 0) spor.push([v.tick, v.aftryk(), v.rngSim.tilstand()]);
  }
  spor.push([v.tick, v.aftryk(), v.rngSim.tilstand()]);
  return spor;
}

// Kun som kommando. `node --test test/farer_*.mjs` kører også denne fil som
// hovedskript (NODE_TEST_CONTEXT er sat i dens underproces): så optog den
// sporet igen hver gang — samtidig med, at farer_determinisme læste det, og så
// en afvigelse kun blev set én gang, før den var "referencen".
const erHoved = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] &&
                !process.env.NODE_TEST_CONTEXT;
if (erHoved) {
  const tjek = process.argv.includes('--tjek');
  const ud = {};
  for (const k of SPOR_KAMPE) {
    const t0 = Date.now();
    ud[`${k.bane}/${k.froe}`] = koerSporKamp(k, { farer: [] });
    console.log(`${k.bane}/${k.froe}: ${ud[`${k.bane}/${k.froe}`].length} prøver (${Date.now() - t0} ms)`);
  }
  if (tjek) {
    const gammel = JSON.parse(readFileSync(SPOR_FIL, 'utf8'));
    let fejl = 0;
    for (const [n, s] of Object.entries(ud)) {
      const g = gammel.kampe[n];
      const i = s.findIndex((r, j) => !g || !g[j] || r[0] !== g[j][0] || r[1] !== g[j][1] || r[2] !== g[j][2]);
      if (i >= 0 || s.length !== g.length) { fejl++; console.log(`  AFVIGER  ${n} fra prøve ${i} (tick ${s[i]?.[0]})`); }
      else console.log(`  ens      ${n}`);
    }
    process.exit(fejl ? 1 : 0);
  }
  writeFileSync(SPOR_FIL, JSON.stringify({ lavet: 'test/farer_lav_spor.mjs', ticks: SPOR_TICKS, hver: HVER, kampe: ud }));
  console.log(`skrev ${SPOR_FIL}`);
}
