/* Kundekrigen — test: banerne er spilbare.
 *
 * Naturbanerne (50 frø pr. type):
 *   - startpladser nok til 8 kunder (x 3), spredt over mindst halvdelen af
 *     banen, alle over vandet, med fri kapsel og aldrig i en lukket lomme
 *   - plads til kunder på hver ø; dalene har mindst én bro
 *   - ingen løse småstumper (under 900 px) og ingen små luftbobler
 *   - pynten står på jorden (rigtig kontakt), og store ting klumper ikke
 *   - vandet kan ses fra de fleste startpladser (højst 600 wu over det)
 *   - grotten har loft af grundfjeld og vand i bunden
 *   - en rigtig kampstart (lavVerden + startKamp): ingen kunde i vandet, på
 *     en mine eller under en stor pynteting
 * Fortet: se kort_fort.mjs.
 *
 *   node --no-warnings test/kort_spilbarhed.mjs
 */
import { genererSpilbar, findStartpladser, VAND_NIVEAU } from '../static/js/sim/terrain_gen.js';
import { ryddOp, PYNT, PYNT_STOR } from '../static/js/sim/baneregler.js';
import { Terraen, FJELD, MUR, LUFT } from '../static/js/sim/terrain.js';
import { kapselFri } from '../static/js/sim/physics.js';
import { lavVerden } from '../static/js/sim/world.js';
import { tjek, overskrift, testFroe, lavHold, percentil } from './kort_hjaelp.mjs';

/** Kan en kunde stå her? Fri kapsel, når den løftes højst 20 wu (som
 *  physics.frigoer gør ved udsætningen: pladserne må være 18 wu skæve). */
const kanStaa = (t, p) => { for (let dy = 0; dy <= 20; dy += 2) if (kapselFri(t, p.x, p.y + dy)) return true; return false; };

const N = 50, KUNDER = 8;

for (const type of ['aaben', 'hule', 'oeer']) {
  overskrift(`Spilbarhed: ${type} (${N} frø, ${KUNDER} kunder)`);
  const fejl = { antal: [], spredt: [], vand: [], kapsel: [], lukket: [], oe: [], bro: [], stumper: [], bobler: [], pynt: [], klump: [], loft: [], soe: [] };
  const hoejder = [];
  for (let i = 0; i < N; i++) {
    const froe = testFroe(300 + i);
    const r = genererSpilbar(froe, type, KUNDER);
    const t = r.terraen, pl = r.pladser;
    if (pl.length < KUNDER * 3) fejl.antal.push(i);
    if (!pl.length || pl[pl.length - 1].x - pl[0].x < t.w * 0.5) fejl.spredt.push(i);
    for (const p of pl) {
      hoejder.push(p.y - VAND_NIVEAU);
      if (p.y < VAND_NIVEAU + 90) { fejl.vand.push(i); break; }
      if (!kanStaa(t, p)) { fejl.kapsel.push(i); break; }
      const L = t.lukket;
      if (L && L.data[Math.min(L.fh - 1, (p.y + 20) >> 2) * L.fw + (p.x >> 2)]) { fejl.lukket.push(i); break; }
    }
    if (t.oeer) for (const o of t.oeer) if (!pl.some((p) => p.x >= o.x0 && p.x <= o.x1)) { fejl.oe.push(i); break; }
    if (t.kraeverBro) {
      let mur = 0;
      for (let k = 0; k < t.maske.length; k += 5) if (t.maske[k] === MUR) mur++;
      if (!(t.broer > 0) || mur === 0) fejl.bro.push(i);
    }
    // Løse stumper og bobler: en ny oprydning må ikke ændre noget.
    const kopi = new Terraen(t.w, t.h);
    kopi.maske.set(t.maske);
    ryddOp(kopi, 900, 0);
    let aendret = 0;
    for (let k = 0; k < t.maske.length; k++) if (kopi.maske[k] !== t.maske[k]) aendret++;
    if (aendret) fejl.stumper.push(`${i}:${aendret}`);
    kopi.maske.set(t.maske);
    ryddOp(kopi, 1, 200);
    aendret = 0;
    for (let k = 0; k < t.maske.length; k++) if (kopi.maske[k] !== t.maske[k]) aendret++;
    if (aendret) fejl.bobler.push(`${i}:${aendret}`);
    // Pynten: grund under begge sider af foden, fri luft over, ingen klumper.
    let sidstStor = -1e9;
    for (const q of t.pynt) {
      const P = PYNT[q.navn], hb = Math.max(6, Math.round(P.w * q.str * 0.3)), y = q.y - 1;
      if (!(t.fast(q.x - hb, y - 3) && t.fast(q.x + hb, y - 3) && !t.fast(q.x, y + 8))) { fejl.pynt.push(`${i}@${q.x}`); break; }
      if (P.stor) { if (q.x - sidstStor < 150) { fejl.klump.push(`${i}@${q.x}`); break; } sidstStor = q.x; }
    }
    if (type === 'hule') {
      // loft af grundfjeld over det hele, og vand (luft under vandlinjen) i bunden
      let loft = true;
      for (let x = 0; x < t.w; x += 64) if (t.hent(x, t.h - 2) !== FJELD) loft = false;
      if (!loft) fejl.loft.push(i);
      let vand = 0;
      for (let x = 0; x < t.w; x += 8) for (let y = 30; y < VAND_NIVEAU; y += 8) if (t.hent(x, y) === LUFT) vand++;
      if (!vand) fejl.soe.push(i);
    }
  }
  const vis = (l) => (l.length ? `frø ${l.slice(0, 8).join(', ')}` : '');
  tjek(`startpladser til ${KUNDER} kunder x 3`, !fejl.antal.length, vis(fejl.antal));
  tjek('startpladserne spredt over mindst halvdelen af banen', !fejl.spredt.length, vis(fejl.spredt));
  tjek('ingen startplads i vandet (mindst 90 wu over det)', !fejl.vand.length, vis(fejl.vand));
  tjek('fri kapsel på alle startpladser (efter et løft på højst 20 wu)', !fejl.kapsel.length, vis(fejl.kapsel));
  tjek('ingen startplads i en lukket lomme', !fejl.lukket.length, vis(fejl.lukket));
  if (type === 'oeer') tjek('plads til kunder på hver ø', !fejl.oe.length, vis(fejl.oe));
  if (type === 'aaben') tjek('dalene har mindst én bro', !fejl.bro.length, vis(fejl.bro));
  tjek('ingen løse stumper under 900 px', !fejl.stumper.length, vis(fejl.stumper));
  tjek('ingen små luftbobler under 200 px', !fejl.bobler.length, vis(fejl.bobler));
  tjek('pynten står på jorden (rigtig kontakt, fri luft over)', !fejl.pynt.length, vis(fejl.pynt));
  tjek('store pynteting klumper ikke (mindst 150 wu imellem)', !fejl.klump.length, vis(fejl.klump));
  const synlig = hoejder.filter((h) => h <= 600).length / hoejder.length;
  tjek('vandet kan ses fra de fleste startpladser (<= 600 wu over)', synlig >= 0.6,
    `${Math.round(synlig * 100)} %, median ${percentil(hoejder, 0.5)} wu, 90 % ${percentil(hoejder, 0.9)} wu`);
  if (type === 'hule') {
    tjek('grotten har loft af grundfjeld', !fejl.loft.length, vis(fejl.loft));
    tjek('grotten har vand i bunden', !fejl.soe.length, vis(fejl.soe));
  }

  // En rigtig kampstart.
  let iVand = 0, paaMine = 0, underPynt = 0, luft = 0;
  for (let i = 0; i < 12; i++) {
    const v = lavVerden({ froe: testFroe(400 + i), banetype: type, hold: lavHold(2, 4),
      cfg: { turTicks: 2700, kampTicks: 108000, vind: true, vejr: 'auto', banetype: type } });
    v.startKamp();
    for (const b of v.baevere) {
      if (b.y < v.vandNiveau + 40) iVand++;
      if (!kapselFri(v.terraen, b.x, b.y)) luft++;
      if (v.placerede.some((p) => p.sprite === 'mine' && Math.abs(p.x - b.x) < 150)) paaMine++;
      if ((v.terraen.pynt || []).some((q) => PYNT[q.navn].stor && Math.abs(q.x - b.x) < PYNT_STOR && Math.abs(q.y - b.y) < 40)) underPynt++;
    }
  }
  tjek('kampstart: ingen kunde i vandet', iVand === 0, `${iVand}`);
  tjek('kampstart: alle kunder står frit', luft === 0, `${luft}`);
  tjek('kampstart: ingen kunde på en mine (150 wu)', paaMine === 0, `${paaMine}`);
  tjek('kampstart: ingen kunde under en stor pynteting', underPynt === 0, `${underPynt}`);
}

overskrift('findStartpladser efter kratere');
{
  // Når banen er sprængt, giver findStartpladser stadig kun steder, man kan stå.
  const r = genererSpilbar(testFroe(9), 'aaben', 4);
  for (let k = 0; k < 40; k++) r.terraen.carve(100 + k * 120, 300 + (k % 5) * 90, 50);
  const pl = findStartpladser(r.terraen);
  tjek('alle pladser har fri kapsel og fast grund', pl.every((p) => kanStaa(r.terraen, p) && r.terraen.fast(p.x, p.y - 1)), `${pl.length} pladser`);
}
