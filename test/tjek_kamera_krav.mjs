/* Kundekrigen — kladde: genskaber fire påståede kamera/HUD-fejl.
 * Skriver kun tal ud, fejler aldrig (ikke en rigtig test).
 *
 *   node test/tjek_kamera_krav.mjs
 */
import { lavOpsaetning, lavFalskRenderer, lavFigur, koer, lavProjektil, skridtProjektil, FIGUR_H } from './kamera_hjaelp.mjs';

function klar(o = {}) {
  const ops = lavOpsaetning(o);
  const f = lavFigur(1, o.fx ?? 1500, (o.jord ?? 600) + 1, o.fig || {});
  ops.kam.snap(f.x, f.y + 40); ops.kam.fokus(f);
  koer(ops, 3);
  return { ...ops, f };
}

// ---- 1: H under et skud
for (const [b, h] of [[1920, 1080], [1280, 960]]) {
  const { r, t, kam, f } = klar({ r: lavFalskRenderer(b, h) });
  // Uden skud: H alene
  kam.kigPaaBanen(true); koer({ r, kam }, 2.5);
  const udenY = r.kamera.position.y, udenX = r.kamera.position.x;
  kam.kigPaaBanen(false); koer({ r, kam }, 3);
  // Med skud: lodret skud, lang flyvning
  const p = lavProjektil(5, f.x, f.y + 40, 60, 1400);
  koer({ r, kam }, 0.5, (tid, dt) => { skridtProjektil(p, dt); kam.foelgSkud(p, [p]); });
  kam.kigPaaBanen(true);
  const s = koer({ r, kam }, 2.5, (tid, dt) => { skridtProjektil(p, dt); kam.foelgSkud(p, [p]); });
  const k = r.kamera.position;
  console.log(`[1] ${b}x${h}: H alene midte y=${udenY.toFixed(0)} x=${udenX.toFixed(0)}; H under skud midte y=${k.y.toFixed(0)} x=${k.x.toFixed(0)}` +
    ` bund=${(k.y - r.hoejde / 2).toFixed(0)} top=${(k.y + r.hoejde / 2).toFixed(0)} (banen 0..${t.h}) tilstand=${s[s.length - 1].tilstand} p.y=${p.y.toFixed(0)}`);
  // Skuddet lander (slipSkud-agtigt: foelgSkud på et punkt uden fart), H holdes stadig
  const land = { x: p.x, y: 600, vx: 0, vy: 0 };
  const yFoer = k.y;
  const s2 = koer({ r, kam }, 2, () => kam.foelgSkud(land));
  console.log(`[1]   efter nedslag med H holdt: y ${yFoer.toFixed(0)} -> ${r.kamera.position.y.toFixed(0)} (tilstand ${s2[s2.length - 1].tilstand})`);
}

// ---- 2: WASD under H
{
  const { r, kam, f } = klar();
  const main = (dt, hNede, dNede) => {
    kam.kigPaaBanen(hNede);
    const pan = 700 * dt * kam.zoom;
    let panX = 0;
    if (dNede) panX += pan;
    if (panX) { kam.friTilstand(true); kam.panorer(panX, 0); }
  };
  koer({ r, kam }, 2, (tid, dt) => main(dt, true, false));
  const zKig = kam.zoom;
  koer({ r, kam }, 0.25, (tid, dt) => main(dt, true, true));
  const xUnderKig = r.kamera.position.x;
  koer({ r, kam }, 3, (tid, dt) => main(dt, false, false));
  const k = r.kamera.position;
  console.log(`[2] oversigtszoom ${zKig.toFixed(2)}, x under H efter D-tap ${xUnderKig.toFixed(0)}; efter slip: kamera x=${k.x.toFixed(0)}, figur x=${f.x}, forskel ${(k.x - f.x).toFixed(0)} wu = ${((k.x - f.x) / r.bredde).toFixed(2)} bredder, tilstand ${kam.tilstand}, fri=${kam.erFri()}, figur i billedet=${Math.abs(k.x - f.x) < r.bredde / 2}`);
  // Til sammenligning: samme tap uden H
  const o2 = klar();
  koer({ r: o2.r, kam: o2.kam }, 0.25, (tid, dt) => { o2.kam.friTilstand(true); o2.kam.panorer(700 * dt * o2.kam.zoom, 0); });
  koer({ r: o2.r, kam: o2.kam }, 3);
  console.log(`[2]   samme tap uden H: forskel ${(o2.r.kamera.position.x - o2.f.x).toFixed(0)} wu`);
}

// ---- 3a: sigte til højre, så W-tap
{
  const { r, kam, f } = klar();
  f.vinkel = 0; f.retning = 1;
  kam.saetSigte('vinkel+kraft', 0, f.id);
  koer({ r, kam }, 3, (tid) => { f.vinkel = 0.02 * Math.sin(tid * 3); });
  f.vinkel = 0;
  koer({ r, kam }, 1.5);
  const x0 = r.kamera.position.x, y0 = r.kamera.position.y;
  console.log(`[3a] sigter: kamera ${(x0 - f.x).toFixed(0)} wu foran figuren, bredde ${r.bredde.toFixed(0)}`);
  koer({ r, kam }, 0.2, (tid, dt) => { kam.friTilstand(true); kam.panorer(0, 700 * dt * kam.zoom); });
  koer({ r, kam }, 2.5);
  const dx = r.kamera.position.x - x0, dy = r.kamera.position.y - y0;
  console.log(`[3a] efter W-tap 0,2 s: dx=${dx.toFixed(0)} wu (${(dx / r.bredde * 100).toFixed(1)} % af bredden), dy=${dy.toFixed(0)} wu`);
}
// ---- 3b: plateau 200 wu over havet, havet trukket ind, A-tap
{
  const { r, kam, f } = klar({ jord: 500, baneOpt: { jord: 500, vand: 300 } });
  const bund0 = r.kamera.position.y - r.hoejde / 2, y0 = r.kamera.position.y;
  koer({ r, kam }, 0.3, (tid, dt) => { kam.friTilstand(true); kam.panorer(-700 * dt * kam.zoom, 0); });
  koer({ r, kam }, 2.5);
  const bund1 = r.kamera.position.y - r.hoejde / 2;
  console.log(`[3b] bundkant ${bund0.toFixed(0)} -> ${bund1.toFixed(0)} (havet i 300, skal se 270), y løftet ${(r.kamera.position.y - y0).toFixed(0)} wu`);
}

// ---- 4: skadetal mod navneskilt (CSS-geometri, px, a = ankerets skærm-y)
{
  const skiltH = 2 + 2 + 10.5 * 1.2;          // polstring + én linje
  const skilt = [-8 - skiltH, -8];
  const glyf = 22;
  const kasse = (ty, sk = 1) => { const top = ty * glyf, midt = top + glyf / 2, halv = glyf / 2 * sk; return [midt - halv, midt + halv]; };
  const faser = [['0 %', -0.6, 0.3], ['14 %', -1.1, 1.25], ['28 %', -1.1, 1], ['75 %', -1.5, 1], ['100 %', -1.9, 0.9]];
  for (const [navn, ty, sk] of faser) {
    const [a0, a1] = kasse(ty, sk);
    const over = Math.max(0, Math.min(a1, skilt[1]) - Math.max(a0, skilt[0]));
    console.log(`[4] ${navn}: tallet [${a0.toFixed(1)}, ${a1.toFixed(1)}] px, skiltet [${skilt[0].toFixed(1)}, ${skilt[1]}] px, overlap ${over.toFixed(1)} px`);
  }
  const r = lavFalskRenderer(1920, 1080); r.tilpas(1);
  console.log(`[4] ved zoom 1 (1080p): 16 wu = ${(16 * 1080 / r.hoejde).toFixed(1)} px`);
  void FIGUR_H;
}
