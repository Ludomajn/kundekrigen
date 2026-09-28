/* Kundekrigen — kameraet: skud, klynger, luftangreb, nedslag, dødsfald, markør.
 *
 *   node test/kamera_skud.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lavOpsaetning, lavBane, lavFigur, koer, iBilledet, lavProjektil, skridtProjektil,
  FIGUR_H, VERDEN_H, TYNGDE,
} from './kamera_hjaelp.mjs';
import { SKUD_ZOOM_LOFT, RYST_ANDEL } from '../static/js/render/camera.js';

const bakket = () => lavBane({ jord: (x) => 600 + 120 * Math.sin(x / 500) });

/** Stil en kunde op, sigt og lad op, som man gør før et skud. */
function klarTilSkud(ops, fx, retning, vinkel, hz = 60) {
  const { kam, t } = ops;
  const f = lavFigur(1, fx, t.jordHoejde(fx) + 1, { retning, vinkel });
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  kam.saetSigte('vinkel+kraft', 0, f.id);
  koer(ops, 2, (tid) => { f.vinkel = vinkel + 0.01 * Math.sin(tid * 5); }, hz);
  koer(ops, 1.2, (tid, dt, i) => kam.saetSigte('vinkel+kraft', Math.min(1, i / (hz * 1.2)), f.id), hz);
  kam.saetSigte(null, 0, f.id);
  return f;
}

/** Flyv et skud frame for frame; returnér den mindste margen i billedet. */
function flyv(ops, p, hz, hvert = null) {
  const { r, kam, t } = ops;
  const dt = 1 / hz;
  let minMargen = 1, maksZoom = 0, frames = 0;
  for (let i = 0; i < hz * 12; i++) {
    if (p.x < -200 || p.x > t.w + 200 || p.y <= t.jordHoejde(p.x)) break;
    skridtProjektil(p, dt);
    kam.foelgSkud(p, [p]);
    kam.opdater(dt);
    hvert?.(i);
    frames++;
    const k = r.kamera.position;
    const m = Math.min(0.5 - Math.abs(p.x - k.x) / r.bredde, 0.5 - Math.abs(p.y - k.y) / r.hoejde);
    // De første 0,2 s står kameraet på skytten (mundingsglimtet); skuddet
    // skal stadig være i billedet.
    minMargen = Math.min(minMargen, m);
    maksZoom = Math.max(maksZoom, kam.glat.zoom);
  }
  return { minMargen, maksZoom, frames };
}

test('projektilet bliver i billedet — fuld kraft, alle vinkler, 30/60/144 Hz', () => {
  const tilfaelde = [
    [0.8, 1500, 1], [0.8, 1500, -1], [1.2, 1100, 1], [1.2, 1500, 1], [0.17, 1500, 1],
    [1.45, 900, 1], [0.6, 600, 1], [-0.3, 900, 1], [1.5, 1500, -1], [0.35, 1050, -1],
  ];
  for (const hz of [30, 60, 144]) {
    for (const [v, fart, ret] of tilfaelde) {
      const ops = lavOpsaetning({ bane: bakket() });
      const f = klarTilSkud(ops, ret > 0 ? 900 : 4200, ret, v, hz);
      const p = lavProjektil(9, f.x + 20 * ret, f.y + 40, Math.cos(v) * fart * ret, Math.sin(v) * fart);
      const res = flyv(ops, p, hz);
      assert.ok(res.frames > 5);
      assert.ok(res.minMargen >= 0.05, `v=${v} fart=${fart} ret=${ret} ${hz} Hz: margen ${(res.minMargen * 100).toFixed(1)} %`);
      assert.ok(res.maksZoom <= SKUD_ZOOM_LOFT + 1e-6, 'aldrig forbi skudloftet');
    }
  }
});

test('flugten zoomer ud med fart og højde, og jorden under buen er med', () => {
  const ops = lavOpsaetning({ bane: bakket() });
  const { r, kam, t } = ops;
  // Et højt skud, der lander på banen (rækkevidde ~3400 wu, top ~1350 wu over).
  const f = klarTilSkud(ops, 900, 1, 1.0);
  const p = lavProjektil(9, f.x + 20, f.y + 40, Math.cos(1.0) * 1350, Math.sin(1.0) * 1350);
  // På vej ned (landingsområdet) skal jorden under skuddet være med. (På vej
  // op halter zoomen et øjeblik efter en hurtig stigning; dér er det buen,
  // der skal ses, og den er i billedet — se testen ovenfor.)
  let saaJorden = 0, hoejt = 0, maksZoom = 0;
  flyv(ops, p, 60, () => {
    const alt = p.y - t.jordHoejde(p.x);
    maksZoom = Math.max(maksZoom, kam.glat.zoom);
    // Ved skudloftet (1,9) kan jorden rammes ind fra ~700 wu over den.
    if (alt > 60 && alt < 600 && p.vy < 0 && kam.tilstand === 'skud') {
      hoejt++;
      if (r.kamera.position.y - r.hoejde / 2 <= t.jordHoejde(p.x)) saaJorden++;
    }
  });
  assert.ok(hoejt > 10);
  assert.equal(saaJorden, hoejt, `landingsområdet er i billedet på vej ned (${saaJorden}/${hoejt})`);
  assert.ok(maksZoom > 1.7, `et højt, hurtigt skud zoomer ud (${maksZoom.toFixed(2)})`);
  // Et fladt, langsomt skud tæt på jorden zoomer kun lidt ud.
  const ops2 = lavOpsaetning({ bane: bakket() });
  const f2 = klarTilSkud(ops2, 900, 1, 0.1);
  const p2 = lavProjektil(9, f2.x + 20, f2.y + 40, Math.cos(0.1) * 400, Math.sin(0.1) * 400);
  const res2 = flyv(ops2, p2, 60);
  assert.ok(res2.maksZoom < 1.45, `langsomt, lavt skud: ${res2.maksZoom.toFixed(2)}`);
});

test('rytmen: 200 ms på skytten, så følger kameraet', () => {
  const ops = lavOpsaetning({ bane: bakket() });
  const { kam } = ops;
  const f = klarTilSkud(ops, 900, 1, 0.5);
  const p = lavProjektil(9, f.x + 20, f.y + 40, Math.cos(0.5) * 700, Math.sin(0.5) * 700);
  const tilstande = [];
  flyv(ops, p, 60, () => tilstande.push(kam.tilstand));
  const foerste = tilstande.indexOf('skud');
  assert.ok(foerste >= 10 && foerste <= 13, `følger fra frame ${foerste} (≈ 0,2 s)`);
});

test('klynger og luftangreb rammes ind sammen', () => {
  // Integrations inferno: fem stumper ud fra et nedslag.
  const ops = lavOpsaetning({ bane: lavBane({ jord: 600 }) });
  const { r, kam } = ops;
  const f = lavFigur(1, 2000, 601);
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  koer(ops, 1);
  const boern = [];
  for (let i = 0; i < 5; i++) {
    const v = Math.PI / 2 + (i - 2) * 0.5;
    boern.push(lavProjektil(20 + i, 2300, 640, Math.cos(v) * 230, Math.sin(v) * 230 + 150));
  }
  let alleInde = 0, n = 0;
  for (let i = 0; i < 60 * 1.6; i++) {
    for (const b of boern) if (b.y > 600) skridtProjektil(b, 1 / 60);
    const levende = boern.filter((b) => b.y > 600);
    if (!levende.length) break;
    kam.foelgSkud(levende[levende.length - 1], levende);
    kam.opdater(1 / 60);
    if (i > 30) { n++; if (levende.every((b) => iBilledet(r, b.x, b.y, 0.03))) alleInde++; }
  }
  assert.ok(n > 10 && alleInde / n > 0.95, `alle fem stumper i billedet (${alleInde}/${n})`);

  // Kvartalsopkrævning: otte fakturaer fra himlen, 34 wu fra hinanden.
  const ops2 = lavOpsaetning({ bane: lavBane({ jord: 600 }) });
  const k2 = ops2.kam, r2 = ops2.r, t2 = ops2.t;
  const f2 = lavFigur(1, 1800, 601);
  k2.snap(f2.x, f2.y + 40); k2.fokus(f2);
  koer(ops2, 1);
  const fakturaer = [];
  let alle2 = 0, n2 = 0;
  for (let i = 0; i < 60 * 8; i++) {
    if (i % 5 === 0 && fakturaer.length < 8) {
      const j = fakturaer.length;
      fakturaer.push(lavProjektil(40 + j, 2600 + (j - 3.5) * 34 - 220, t2.h + 60, 120, -250));
    }
    for (const q of fakturaer) if (q.y > 600) { q.x += q.vx / 60; q.y += q.vy / 60; }
    const luft = fakturaer.filter((q) => q.y > 600);
    if (!luft.length && fakturaer.length === 8) break;
    if (luft.length) k2.foelgSkud(luft[luft.length - 1], luft);
    k2.opdater(1 / 60);
    if (i > 60 && luft.length) { n2++; if (luft.every((q) => iBilledet(r2, q.x, q.y, 0.03))) alle2++; }
  }
  assert.ok(n2 > 60 && alle2 / n2 > 0.95, `alle fakturaer i billedet (${alle2}/${n2})`);
});

test('nedslag: punch-in og rystelse efter radius, større spark ved de store brag', () => {
  function brag(radius) {
    const ops = lavOpsaetning({ bane: lavBane({ jord: 600 }) });
    const { r, kam } = ops;
    const f = lavFigur(1, 2000, 601);
    kam.snap(f.x, f.y + 40); kam.fokus(f);
    // Hold over nedslaget, som main.js — lige der, hvor kameraet står, så
    // kun braget flytter billedet. Uden vejrtrækning (reduceret) indtil braget.
    kam.saetReduceret(true);
    const nedslag = { x: 2000, y: 587 };
    koer(ops, 4, () => kam.foelgSkud(nedslag));
    const z0 = kam.zoom, x0 = kam.glat.x, y0 = kam.glat.y;
    kam.saetReduceret(false);
    kam.eksplosion(nedslag.x, nedslag.y, radius);
    let minZ = Infinity, maksRyst = 0, maksGlat = 0;
    const s = koer(ops, 1.2, () => {});
    for (const q of s) {
      minZ = Math.min(minZ, q.vist);
      maksRyst = Math.max(maksRyst, Math.hypot(q.px - q.x, q.py - q.y));
      maksGlat = Math.max(maksGlat, Math.hypot(q.x - x0, q.y - y0));
    }
    return { punch: 1 - minZ / Math.max(z0, s[0].zoom), maksRyst, maksGlat, h: r.hoejde, slut: s[s.length - 1] };
  }
  const lille = brag(34), mellem = brag(58), stor = brag(74);
  assert.ok(lille.punch > 0.005 && lille.punch < mellem.punch && mellem.punch < stor.punch,
            `punch ${lille.punch.toFixed(3)} < ${mellem.punch.toFixed(3)} < ${stor.punch.toFixed(3)}`);
  assert.ok(stor.punch < 0.1, 'et punch, ikke et spring');
  assert.ok(lille.maksRyst < mellem.maksRyst && mellem.maksRyst < stor.maksRyst, 'rystelsen vokser med radius');
  assert.ok(stor.maksRyst <= RYST_ANDEL * stor.h * 1.01 + 1e-6, 'rystelsen har et loft');
  assert.ok(stor.maksGlat > mellem.maksGlat, 'Datalæk-bomben giver et spark oveni');
  // Og alt falder til ro igen (hold over krateret, main.js vender tilbage).
  assert.ok(Math.hypot(stor.slut.px - stor.slut.x, stor.slut.py - stor.slut.y) < 0.5);
});

test('et brag langt væk ryster mindre end et tæt på', () => {
  function ryst(afstand) {
    const ops = lavOpsaetning({ kamOpt: { reduceret: true } });
    const f = lavFigur(1, 1500, 601);
    ops.kam.snap(f.x, f.y + 40); ops.kam.fokus(f);
    koer(ops, 2);
    ops.kam.saetReduceret(false);
    ops.kam.rystelse(1, afstand);
    return Math.max(...koer(ops, 0.5).map((q) => Math.hypot(q.px - q.x, q.py - q.y)));
  }
  assert.ok(ryst(1500) < ryst(0) * 0.5);
});

test('dødsfald: et kort fokus, og så tilbage', () => {
  const ops = lavOpsaetning();
  const { r, kam } = ops;
  const f = lavFigur(1, 1200, 601);
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  koer(ops, 2);
  kam.kortFokus(2600, 623);
  koer(ops, 1.2);
  assert.equal(kam.tilstand, 'doed');
  assert.ok(iBilledet(r, 2600, 623, 0.3), 'den døde er i midten');
  assert.ok(r.hoejde < VERDEN_H * 0.97, 'lidt tættere på');
  koer(ops, 2.5);
  assert.notEqual(kam.tilstand, 'doed');
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.25), 'tilbage hos den, kameraet fulgte');
});

test('et dødsfald går forud for holdet over krateret, men ikke for et skud i luften', () => {
  const ops = lavOpsaetning();
  const { kam } = ops;
  const f = lavFigur(1, 1200, 601);
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  kam.foelgSkud({ x: 1500, y: 600 });
  kam.kortFokus(2600, 623);
  koer(ops, 0.5);
  assert.equal(kam.tilstand, 'doed');
  const p = lavProjektil(5, 2000, 900, 400, 300);
  kam.foelgSkud(p, [p]);
  koer(ops, 0.5, (t, dt) => { skridtProjektil(p, dt); kam.foelgSkud(p, [p]); });
  assert.equal(kam.tilstand, 'skud');
});

test('markøren og kunden rammes ind sammen; er markøren langt væk, følger billedet den', () => {
  const ops = lavOpsaetning();
  const { r, kam } = ops;
  const f = lavFigur(1, 1500, 601);
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  koer(ops, 1);
  kam.saetMarkoer(true, 1900, 700);
  koer(ops, 2);
  assert.equal(kam.tilstand, 'markoer');
  assert.ok(iBilledet(r, 1900, 700, 0.1) && iBilledet(r, f.x, f.y + 23, 0.1), 'begge i billedet');
  // Markøren flyttes 560 wu/s (piletasterne) langt ud: den forbliver i billedet.
  let ude = 0;
  koer(ops, 4, (t, dt) => {
    const mx = 1900 + 560 * t;
    kam.saetMarkoer(true, mx, 700);
    if (!iBilledet(r, mx, 700, 0.05)) ude++;
  });
  assert.ok(ude === 0, `markøren forlod billedet i ${ude} frames`);
  kam.saetMarkoer(false);
  koer(ops, 3);
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.2), 'tilbage hos kunden');
});

test('scannerens træf: skytten og træfpunktet et øjeblik sammen', () => {
  const ops = lavOpsaetning();
  const { r, kam } = ops;
  const f = lavFigur(1, 1500, 601);
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  koer(ops, 1);
  kam.rammeInd(f.x + 1050, f.y + 60);
  koer(ops, 0.8);
  assert.ok(iBilledet(r, f.x, f.y + 23, 0.05) && iBilledet(r, f.x + 1050, f.y + 60, 0.05), 'begge i billedet');
  koer(ops, 2.5);
  assert.ok(Math.abs(r.hoejde - VERDEN_H) / VERDEN_H < 0.05, 'og tilbage');
});

test('et projektil, der ligger stille (bomben med lunte), holdes i billedet', () => {
  const ops = lavOpsaetning();
  const { r, kam } = ops;
  const f = lavFigur(1, 1500, 601);
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  const bombe = { id: 7, x: 2100, y: 610, vx: 0, vy: 0, sover: true };
  koer(ops, 2, () => kam.foelgSkud(bombe, [bombe]));
  assert.equal(kam.tilstand, 'nedslag');
  assert.ok(iBilledet(r, bombe.x, bombe.y, 0.2));
  assert.ok(TYNGDE > 0);
});
