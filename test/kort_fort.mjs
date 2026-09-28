/* Kundekrigen — test: fortet er retfærdigt og sikkert.
 *
 * For mange frø og alle almindelige opstillinger (2-6 klinikker, 1-4 kunder):
 *   - borgene står på banen (planen passer)
 *   - hele banen er spejlet om midten, pixel for pixel (borge OG landskab)
 *   - kunderne, udstyrspladserne og kassepladserne i borg i og borg H-1-i er
 *     hinandens spejlbilleder (et punkt x spejles til W - x), og hver klinik
 *     har lige så mange pladser, som den har kunder; kassernes stykker
 *     (kasseSpand, hvor en kasse må drive) er også spejlede, og hver
 *     kasseplads ligger i et stykke
 *   - ingen kan hoppe fra én borg over til en anden eller ud på landskabet
 *     midt imellem (støtter, ø, bakke) — prøvet på selve masken
 *   - et lige skud fra fjendens tilsvarende etage rammer brystningen, ikke
 *     kunden (skydeskåret)
 *   - kunderne starter i deres egne rum, over vandet og med fri kapsel
 *   - ved en rigtig kampstart får hver borg det samme udstyr, spejlet
 *
 *   node --no-warnings test/kort_fort.mjs
 */
import { genererSpilbar, fortHopSikker, VAND_NIVEAU } from '../static/js/sim/terrain_gen.js';
import { kapselFri } from '../static/js/sim/physics.js';
import { lavVerden } from '../static/js/sim/world.js';
import { tjek, overskrift, testFroe, lavHold } from './kort_hjaelp.mjs';

const OPSTILLINGER = [[2, 1], [2, 2], [2, 3], [2, 4], [3, 2], [4, 2], [5, 2], [6, 1]];

for (const [H, pr] of OPSTILLINGER) {
  const N = H === 2 && pr === 2 ? 50 : 12;
  overskrift(`Fortet ${H} klinikker x ${pr} kunder (${N} frø)`);
  const fejl = { passer: [], spejl: [], pladser: [], antal: [], udstyr: [], kasser: [], spand: [], hop: [], skud: [], rum: [], staa: [] };
  const landskaber = {}, reserve = [];
  for (let i = 0; i < N; i++) {
    const froe = testFroe(500 + i * 13 + H * 7 + pr);
    const t = genererSpilbar(froe, 'fort', H * pr, { antalHold: H, prHold: pr }).terraen;
    const f = t.fort, W = t.w;
    landskaber[`${f.siluet}/${f.landskab.navn}`] = (landskaber[`${f.siluet}/${f.landskab.navn}`] || 0) + 1;
    if (f.reserve) reserve.push(`${i}:${f.reserve}`);
    if (!f.passer) fejl.passer.push(i);
    // spejlet pixel for pixel
    let asym = 0;
    for (let r = 0; r < t.h && !asym; r++) {
      const o = r * W;
      for (let x = 0; x < W >> 1; x++) if (t.maske[o + x] !== t.maske[o + W - 1 - x]) { asym = 1; break; }
    }
    if (asym) fejl.spejl.push(i);
    const spejlP = (a, b) => a.length === b.length && a.every((p, j) => Math.abs(p.x - (W - b[j].x)) < 1e-9 && p.y === b[j].y);
    // Som mængde: spejlbilledet af hvert punkt findes også (midterborgen).
    const symMaengde = (pkt) => { const s = new Set(pkt.map((p) => `${p.x},${p.y}`)); return pkt.every((p) => s.has(`${W - p.x},${p.y}`)); };
    for (let h = 0; h < H; h++) {
      const A = f.forter[h], B = f.forter[H - 1 - h];
      if (A.pladser.length !== pr) fejl.antal.push(`${i}/${h}:${A.pladser.length}`);
      if (h === H - 1 - h) {
        // Den dobbeltsidede midterborg: kunderne skifter side pr. etage (som
        // før), og udstyr holdes 120 wu fra kunderne — så et spejlet sted
        // mangler kun, hvor en kunde står tæt på det. Kasserne er symmetriske.
        const s = new Set(A.udstyr.map((p) => `${p.x},${p.y}`));
        const forklaret = (p) => A.pladser.some((q) => Math.hypot(W - p.x - q.x, p.y - q.y) < 120);
        if (!A.udstyr.every((p) => s.has(`${W - p.x},${p.y}`) || forklaret(p))) fejl.udstyr.push(i);
        if (!symMaengde(A.kasser.map((x) => ({ x, y: 0 })))) fejl.kasser.push(i);
      } else {
        if (!spejlP(A.pladser, B.pladser) || A.pladser.some((p, j) => p.retning !== -B.pladser[j].retning)) fejl.pladser.push(i);
        if (!spejlP(A.udstyr, B.udstyr)) fejl.udstyr.push(i);
        if (A.kasser.length !== B.kasser.length || A.kasser.some((x, j) => Math.abs(x - (W - B.kasser[j])) > 1e-9)) fejl.kasser.push(i);
      }
      // Kassernes stykker: hver kasseplads i et stykke, stykkerne ender i en
      // kasseplads og er spejlede (som mængde: midterborgen har begge sider).
      const sp = A.kasseSpand || [], spB = B.kasseSpand || [];
      const nogle = (l) => new Set(l.map(([a, b]) => `${a},${b}`));
      const spejlS = nogle(spB.map(([a, b]) => [W - b, W - a]));
      if (!A.kasser.every((x) => sp.some(([a, b]) => x >= a && x <= b)) ||
          !sp.every(([a, b]) => A.kasser.includes(a) && A.kasser.includes(b)) ||
          sp.length !== spB.length || ![...nogle(sp)].every((k) => spejlS.has(k))) fejl.spand.push(`${i}/${h}`);
      for (const p of A.pladser) {
        if (p.x < p.rumX[0] || p.x > p.rumX[1]) fejl.rum.push(`${i}/${h}`);
        if (p.y < VAND_NIVEAU + 60 || !kapselFri(t, p.x, p.y)) fejl.staa.push(`${i}/${h}`);
      }
    }
    if (!fortHopSikker(t)) fejl.hop.push(i);
    // Et lige skud mellem to borge, der vender facaden mod hinanden, på
    // samme etage: i alle højder af kundens træfzone (0-46) rammer det mur.
    for (let h = 0; h + 1 < H; h++) {
      const A = f.forter[h], B = f.forter[h + 1];
      if (!(A.retning >= 0 && B.retning <= 0)) continue;
      const pa = A.pladser.filter((p) => p.retning === 1), pb = B.pladser.filter((p) => p.retning === -1);
      for (const p of pa) {
        const q = pb.find((qq) => qq.y === p.y);
        if (!q) continue;
        for (let dy = 2; dy <= 46; dy += 4) {
          let blokeret = false;
          for (let x = Math.round(p.x) + 12; x < Math.round(q.x) - 12; x += 2) if (t.fast(x, p.y + dy)) { blokeret = true; break; }
          if (!blokeret) { fejl.skud.push(`${i} etage ${p.etage} højde ${dy}`); break; }
        }
      }
    }
  }
  const vis = (l) => (l.length ? l.slice(0, 6).join(', ') : '');
  tjek('borgene står på banen (planen passer)', !fejl.passer.length, vis(fejl.passer));
  tjek('hele banen er spejlet pixel for pixel', !fejl.spejl.length, vis(fejl.spejl));
  tjek(`${pr} startpladser pr. klinik`, !fejl.antal.length, vis(fejl.antal));
  tjek('kundernes pladser er spejlede (og vender mod fjenden)', !fejl.pladser.length, vis(fejl.pladser));
  tjek('udstyrspladserne er spejlede', !fejl.udstyr.length, vis(fejl.udstyr));
  tjek('kassepladserne er spejlede', !fejl.kasser.length, vis(fejl.kasser));
  tjek('kassernes stykker er spejlede og dækker kassepladserne', !fejl.spand.length, vis(fejl.spand));
  tjek('ingen kan hoppe over til en anden borg eller ud på landskabet imellem', !fejl.hop.length, vis(fejl.hop));
  tjek('lige skud fra fjendens etage rammer brystningen', !fejl.skud.length, vis(fejl.skud));
  tjek('kunderne starter i deres egne rum', !fejl.rum.length, vis(fejl.rum));
  tjek('kunderne starter over vandet med fri kapsel', !fejl.staa.length, vis(fejl.staa));
  tjek('ingen reservebaner (landskabet holdt hver gang)', !reserve.length, `${Object.keys(landskaber).length} kombinationer${reserve.length ? `; reserve: ${vis(reserve)}` : ''}`);
}

overskrift('Kampstart på fortet: samme udstyr på hver borg, spejlet');
{
  const fejl = [];
  for (let i = 0; i < 16; i++) {
    const froe = testFroe(700 + i);
    const v = lavVerden({ froe, banetype: 'fort', hold: lavHold(2, 3),
      cfg: { turTicks: 2700, kampTicks: 108000, vind: true, vejr: 'auto', banetype: 'fort' } });
    v.startKamp();
    const W = v.terraen.w;
    const venstre = v.placerede.filter((p) => p.x < W / 2).map((p) => `${p.sprite}@${p.x},${p.y}`).sort();
    const hoejre = v.placerede.filter((p) => p.x >= W / 2).map((p) => `${p.sprite}@${W - p.x},${p.y}`).sort();
    const tlf = v.kasser.filter((k) => k.x < W / 2).length === v.kasser.filter((k) => k.x >= W / 2).length;
    if (JSON.stringify(venstre) !== JSON.stringify(hoejre) || !tlf) fejl.push(i);
    // kunderne: i hver klinik så mange som opstillet, på deres egen borg
    for (const b of v.baevere) if ((b.hold === 0) !== (b.x < W / 2)) fejl.push(`${i}:kunde`);
  }
  tjek('miner, printere, telefoner og piller er ens og spejlede på de to borge (16 frø)', !fejl.length, fejl.slice(0, 6).join(', '));
}
