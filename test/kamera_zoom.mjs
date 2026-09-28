/* Kundekrigen — kameraet: afstand, zoomtrin, H og sigte.
 *
 *   node test/kamera_zoom.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lavOpsaetning, lavFalskRenderer, lavFigur, koer, iBilledet, lavProjektil, skridtProjektil, FIGUR_H, VERDEN_H,
} from './kamera_hjaelp.mjs';
import {
  ZOOMTRIN, SIGTE_ZOOM_LOFT, SIGTE_ABS_LOFT, SIGTE_ZOOM,
} from '../static/js/render/camera.js';

const andel = (r) => FIGUR_H / r.hoejde;

function iRo(o = {}) {
  const ops = lavOpsaetning(o);
  const f = lavFigur(1, 1500, 640);
  ops.kam.snap(f.x, f.y + 40);
  ops.kam.fokus(f);
  koer(ops, 3);
  return { ...ops, f };
}

test('en figur fylder 9-11 % af skærmhøjden ved standardzoom', () => {
  for (const [b, h] of [[1920, 1080], [2560, 1600], [1440, 900], [1280, 960], [2560, 1080], [3440, 1440]]) {
    const { r } = iRo({ r: lavFalskRenderer(b, h) });
    const a = andel(r);
    assert.ok(a >= 0.09 && a <= 0.11, `${b}x${h}: figuren fylder ${(a * 100).toFixed(2)} %`);
  }
  // Til sammenligning: det gamle kamera (860 wu) gav 5,3 %.
  assert.ok(FIGUR_H / 860 < 0.055);
  assert.equal(VERDEN_H, 460);
});

test('3-4 manuelle zoomtrin (Z/X) omkring den dynamiske zoom', () => {
  assert.ok(ZOOMTRIN.length >= 3 && ZOOMTRIN.length <= 4);
  const { r, kam, f } = iRo();
  const hoejder = [];
  for (let i = 0; i < 5; i++) kam.zoomInd();
  for (let i = 0; i < ZOOMTRIN.length; i++) {
    koer({ r, kam }, 2.5);
    hoejder.push(r.hoejde);
    kam.zoomUd();
  }
  for (let i = 1; i < hoejder.length; i++) assert.ok(hoejder[i] > hoejder[i - 1] * 1.1, `trin ${i} zoomer ud`);
  // Trinnet ganges på den dynamiske zoom: sigter man, er man stadig længst ude.
  kam.saetSigte('vinkel+kraft', 0, f.id);
  koer({ r, kam }, 2.5, (t) => { f.vinkel = 0.5 + 0.05 * Math.sin(t * 4); });
  assert.ok(r.hoejde > hoejder[hoejder.length - 1], 'sigte + yderste trin er længere ude end yderste trin alene');
});

test('H viser hele banen, og kameraet kommer blødt tilbage bagefter', () => {
  const { r, t, kam, f } = iRo();
  kam.kigPaaBanen(true);
  koer({ r, kam }, 2);
  const k = r.kamera.position;
  assert.ok(k.x - r.bredde / 2 <= 0 && k.x + r.bredde / 2 >= t.w, 'hele bredden');
  assert.ok(k.y - r.hoejde / 2 <= 0 && k.y + r.hoejde / 2 >= t.h, 'hele højden');
  assert.equal(kam.tilstand, 'kig');
  kam.kigPaaBanen(false);
  koer({ r, kam }, 3);
  assert.ok(Math.abs(r.hoejde - VERDEN_H) / VERDEN_H < 0.02, 'tilbage ved standardzoom');
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.2), 'figuren er i midten igen');
});

test('H under et skud: oversigten er midt på banen og står stille, når skuddet lander', () => {
  // Flugtens ekstra himmel (SKUD_TOP_EKSTRA) må ikke skubbe oversigten op:
  // så sad banen i bunden af billedet med 540 wu (16:9) eller 1000 wu (4:3)
  // tom himmel over, og den gled ned igen, når skuddet landede.
  for (const [b, h] of [[1920, 1080], [1280, 960]]) {
    const { r, t, kam, f } = iRo({ r: lavFalskRenderer(b, h) });
    const navn = `${b}x${h}`;
    // Et næsten lodret skud: ~5,8 s i luften, langt over banen.
    const p = lavProjektil(5, f.x, f.y + 40, 60, 1400);
    const flyv = (tid, dt) => { skridtProjektil(p, dt); kam.foelgSkud(p, [p]); };
    koer({ r, kam }, 0.5, flyv);
    kam.kigPaaBanen(true);
    koer({ r, kam }, 2, flyv);
    assert.equal(kam.tilstand, 'kig');
    assert.ok(p.y > t.h, 'skuddet er stadig i luften, over banen');
    const g = kam.glat;
    assert.ok(Math.abs(g.x - t.w / 2) < 3 && Math.abs(g.y - t.h / 2) < 3,
      `${navn}: oversigtens midte (${g.x.toFixed(0)}, ${g.y.toFixed(0)}), banens (${t.w / 2}, ${t.h / 2})`);
    const k = r.kamera.position;
    assert.ok(k.y - r.hoejde / 2 <= 0 && k.y + r.hoejde / 2 >= t.h, `${navn}: hele højden`);
    assert.ok(k.x - r.bredde / 2 <= 0 && k.x + r.bredde / 2 >= t.w, `${navn}: hele bredden`);
    // Skuddet lander (et punkt uden fart), og holdet slippes; H holdes stadig.
    const land = { x: p.x, y: f.y, vx: 0, vy: 0, sover: false };
    const s = [...koer({ r, kam }, 1.5, () => kam.foelgSkud(land)), ...(kam.slipSkud(), koer({ r, kam }, 1))];
    for (const q of s) {
      assert.ok(Math.abs(q.x - t.w / 2) < 3 && Math.abs(q.y - t.h / 2) < 3,
        `${navn}: oversigten flytter sig ikke, når skuddet lander (${q.x.toFixed(1)}, ${q.y.toFixed(1)} ved ${q.tid.toFixed(2)} s)`);
    }
  }
});

test('introen (kigPaaBanen) og så turstartens etablering', () => {
  const ops = lavOpsaetning();
  const { r, kam } = ops;
  const f = lavFigur(1, 4300, 620);
  kam.kigPaaBanen(true);
  koer(ops, 3);
  const oversigt = r.hoejde;
  kam.kigPaaBanen(false);
  kam.etabler(f);
  const s = koer(ops, 2.5);
  // Glider ind fra oversigten: aldrig ud igen undervejs, og fremme ved kunden.
  for (let i = 1; i < s.length; i++) assert.ok(s[i].zoom <= s[i - 1].zoom + 1e-9, 'zoomen går kun ind efter oversigten');
  assert.ok(r.hoejde < oversigt / 3);
  assert.ok(Math.abs(s[s.length - 1].zoom - 1) < 0.03, `slutter ved standardzoom (${s[s.length - 1].zoom.toFixed(3)})`);
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.25));
});

test('turstart langt væk: ud, glid, blødt ind (en kranbevægelse)', () => {
  const { r, kam } = iRo();
  const ny = lavFigur(2, 4200, 700);
  kam.etabler(ny);
  const s = koer({ r, kam }, 2.6);
  const maks = Math.max(...s.map((q) => q.zoom));
  assert.ok(maks > 1.35, `trækker sig tilbage på en lang rejse (${maks.toFixed(2)})`);
  assert.ok(maks <= 1.7 + 1e-6);
  assert.ok(Math.abs(s[s.length - 1].zoom - 1) < 0.03, 'og zoomer blødt ind på kunden');
  assert.ok(iBilledet(r, ny.x, ny.y + FIGUR_H / 2, 0.25));
  // Samme sted igen: ingen tilbagetrækning.
  kam.etabler(ny);
  const s2 = koer({ r, kam }, 2);
  assert.ok(Math.max(...s2.map((q) => q.zoom)) < 1.03, 'står kameraet ved kunden, trækker det sig ikke tilbage');
});

test('sigte zoomer gradvist ud med kraften, men ikke forbi loftet', () => {
  const { r, kam, f } = iRo();
  const ro = r.hoejde;
  kam.saetSigte('vinkel+kraft', 0, f.id);
  // Uden at røre sigtet: ingen zoom (turen starter tæt på).
  koer({ r, kam }, 1.5);
  assert.ok(Math.abs(r.hoejde - ro) / ro < 0.02, 'urørt sigte zoomer ikke ud');
  // Rør sigtet: ud til SIGTE_ZOOM.
  koer({ r, kam }, 2, (t) => { f.vinkel = 0.6 + 0.02 * Math.sin(t * 6); });
  assert.ok(Math.abs(r.hoejde / ro - SIGTE_ZOOM) < 0.03, `sigte uden kraft ≈ ${SIGTE_ZOOM} (${(r.hoejde / ro).toFixed(3)})`);
  // Lad op over 1,5 s: zoomen vokser, men aldrig forbi loftet.
  let forrige = r.hoejde, faldt = 0;
  const s = koer({ r, kam }, 3, (t, dt, i) => kam.saetSigte('vinkel+kraft', Math.min(1, i / 90), f.id));
  for (const q of s) {
    assert.ok(q.zoom <= SIGTE_ZOOM_LOFT + 1e-6, 'aldrig forbi sigteloftet');
    if (q.h < forrige - 0.5) faldt++;
    forrige = q.h;
  }
  assert.ok(faldt < 5, 'zoomen går kun ud, mens der lades');
  assert.ok(r.hoejde / ro > 1.5, 'fuld kraft zoomer tydeligt ud');
  // Figuren kan læses (≥ 5 % af højden) og er i billedet.
  assert.ok(andel(r) >= 0.05 && andel(r) <= 0.075, `fuld kraft: ${(andel(r) * 100).toFixed(2)} %`);
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.15), 'figuren er inde i billedet');
  // Billedet er skubbet i sigteretningen (højre og op).
  const k = r.kamera.position;
  assert.ok(k.x - f.x > 0.12 * r.bredde, 'skubbet frem i sigteretningen');
  // Vender man sig, skifter indramningen side.
  f.retning = -1;
  koer({ r, kam }, 2.5);
  assert.ok(r.kamera.position.x - f.x < -0.12 * r.bredde, 'og til den anden side, når man vender sig');
});

test('sigteloftet gælder også absolut ved yderste manuelle trin', () => {
  const { r, kam, f } = iRo();
  for (let i = 0; i < 5; i++) kam.zoomUd();
  kam.saetSigte('vinkel+kraft', 1, f.id);
  koer({ r, kam }, 4, (t) => { f.vinkel = 0.6 + 0.02 * Math.sin(t * 6); });
  assert.ok(r.hoejde <= VERDEN_H * SIGTE_ABS_LOFT * 1.01, `højst ${SIGTE_ABS_LOFT} (${(r.hoejde / VERDEN_H).toFixed(2)})`);
  assert.ok(andel(r) >= 0.049, `figuren er stadig ${(andel(r) * 100).toFixed(2)} %`);
});

test('en anden figur (T) indrammes ikke efter den aktives sigte', () => {
  const { r, kam, f } = iRo();
  const fjende = lavFigur(2, 3000, 650);
  kam.fokus(fjende);
  kam.saetSigte('vinkel+kraft', 0.8, f.id);          // den aktive lader op
  koer({ r, kam }, 2.5);
  assert.ok(r.hoejde < VERDEN_H * 1.05, 'kigger man på fjenden, zoomer sigtet ikke ud');
});

test('gang kigger frem i den retning, kunden vender', () => {
  const { r, kam, f } = iRo();
  koer({ r, kam }, 3, (t, dt) => { f.x += 105 * dt; f.retning = 1; });
  const k = r.kamera.position;
  assert.ok(k.x - f.x > 0.08 * r.bredde, `fremkig til højre (${(k.x - f.x).toFixed(0)} wu)`);
  assert.equal(kam.tilstand, 'gang');
  koer({ r, kam }, 3, (t, dt) => { f.x -= 105 * dt; f.retning = -1; });
  assert.ok(r.kamera.position.x - f.x < -0.08 * r.bredde, 'og til venstre');
  // Stopper man, glider billedet tilbage over kunden.
  koer({ r, kam }, 3);
  assert.ok(Math.abs(r.kamera.position.x - f.x) < 0.05 * r.bredde);
});

test('havet: billedet trækkes ned, når vandet kan nås — men ikke ellers', () => {
  // Tæt på vandet (300): 30 wu hav med i billedet.
  const naer = iRo({ baneOpt: { jord: 540 } });
  const f1 = lavFigur(1, 1500, 541);
  naer.kam.fokus(f1); koer(naer, 3);
  const bund1 = naer.r.kamera.position.y - naer.r.hoejde / 2;
  assert.ok(bund1 <= 300 - 20, `vandet er med (billedets bund ${bund1.toFixed(0)})`);
  assert.ok(iBilledet(naer.r, f1.x, f1.y + FIGUR_H, 0.1), 'og hovedet er i billedet');
  // Langt over vandet: kunden står i midten, intet halvt træk.
  const fjern = iRo({ baneOpt: { jord: 900 } });
  const f2 = lavFigur(1, 1500, 901);
  fjern.kam.fokus(f2); koer(fjern, 3);
  assert.ok(Math.abs(fjern.r.kamera.position.y - (f2.y + 40)) < 12, 'står midt i billedet');
});
