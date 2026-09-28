/* Kundekrigen — baggrundens dybde: parallakse ved panorering OG zoom.
 *
 *   node test/kamera_parallakse.mjs
 *
 * Regner på de rigtige lag (parallax.js LAG) uden three-lærred: perspektiv-
 * formlen, at den er den gamle ved referenceudsnittet, at fjerne lag skalerer
 * mindre end nære, og at lagene dækker billedet ved alle zoom og positioner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAG, LAG_UDSTRAEK, FLISE_FORHOLD, REF_UDSNIT_H, REF_LOEFT, lagPlacering,
} from '../static/js/render/parallax.js';
import { dybdeFaktor, ZOOMTRIN, SKUD_TOP_EKSTRA } from '../static/js/render/camera.js';
import { udsnit } from '../static/js/render/renderer.js';

const VAND = 300, REF = VAND + REF_LOEFT;
const B = 5120, H = 1792;

test('dybdeFaktor: g(f, 1) = f, og ind giver stærkere parallakse', () => {
  for (const l of LAG) {
    assert.ok(Math.abs(dybdeFaktor(l.faktor, 1) - l.faktor) < 1e-12);
    assert.ok(dybdeFaktor(l.faktor, 0.5) < l.faktor, `${l.navn}: tættere på = stærkere dybde`);
    assert.ok(dybdeFaktor(l.faktor, 2) > l.faktor);
  }
  assert.equal(dybdeFaktor(1, 0.3), 1);
  assert.equal(dybdeFaktor(0, 3), 0);
});

test('ved referenceudsnittet er placeringen præcis den gamle', () => {
  const ud = {};
  for (const l of LAG) {
    for (const [kx, ky] of [[0, 400], [2560, 900], [5120, 1500]]) {
      lagPlacering(l.faktor, kx, ky, 1, VAND, REF, ud);
      assert.ok(Math.abs(ud.s - 1) < 1e-12);
      assert.ok(Math.abs(ud.x - (kx * (1 - l.faktor) - (l.faktor < 0.35 ? 2200 : 1100))) < 1e-9);
      assert.ok(Math.abs(ud.y - (VAND + (ky - REF) * (1 - l.faktor))) < 1e-9);
    }
  }
});

test('zoom: fjerne lag skalerer mindre på skærmen end nære', () => {
  // Skærmskala = verdensskala / udsnit. Fra standardudsynet (460) til det
  // gamle (860): gameplayplanet bliver 1,87 gange mindre på skærmen, de
  // fjerneste skyer næsten ikke.
  const ud = {};
  const skaerm = (f, zRel) => lagPlacering(f, 0, REF, zRel, VAND, REF, ud).s / zRel;
  const ind = 460 / REF_UDSNIT_H, ud1 = 1;
  let forrige = 0;
  for (const l of LAG) {
    const vaekst = skaerm(l.faktor, ind) / skaerm(l.faktor, ud1);    // hvor meget større, når man går ind
    assert.ok(vaekst >= forrige - 1e-9, `${l.navn}: nærmere lag vokser mere (${vaekst.toFixed(3)})`);
    forrige = vaekst;
  }
  assert.ok(skaerm(LAG[0].faktor, ind) / skaerm(LAG[0].faktor, ud1) < 1.05, 'de fjerneste skyer står næsten stille');
  assert.ok(forrige > 1.3 && forrige < 1 / ind, 'træerne vokser, men mindre end gameplayplanet');
});

test('panorering: nære lag følger mere med end fjerne, ved alle zoom', () => {
  const a = {}, b = {};
  for (const zRel of [0.43, 460 / REF_UDSNIT_H, 1, 3]) {
    let forrige = -1;
    for (const l of LAG) {
      lagPlacering(l.faktor, 1000, REF, zRel, VAND, REF, a);
      lagPlacering(l.faktor, 1100, REF, zRel, VAND, REF, b);
      // Hvor meget laget glider på skærmen, når kameraet flytter 100 wu.
      const glid = 100 - (b.x - a.x);
      assert.ok(glid > forrige, `${l.navn} ved zoom ${zRel.toFixed(2)}`);
      forrige = glid;
    }
  }
});

test('lagene dækker billedet ved alle zoom og kamerapositioner', () => {
  const ud = {};
  const enhed = udsnit(16 / 9);
  const zoomListe = [ZOOMTRIN[0], 1, 1.6, 1.9, 2.0 * ZOOMTRIN[ZOOMTRIN.length - 1],
                     Math.max(B / enhed.b, H / enhed.h) * 1.04];            // til og med H-oversigten
  for (const z of zoomListe) {
    const vw = enhed.b * z, vh = enhed.h * z, zRel = vh / REF_UDSNIT_H;
    const xs = [Math.max(-380 + vw / 2, 0), B / 2, Math.min(B + 380 - vw / 2, B)];
    const ys = [Math.max(-60 + vh / 2, 0), 700, 1200, H + 60 + SKUD_TOP_EKSTRA - vh / 2];
    for (const l of LAG) {
      if (l.taage) continue;                        // tågebånd er bånd, ikke flader
      const fliseH = l.fliseB * FLISE_FORHOLD;
      for (const kx of xs) for (const ky of ys) {
        lagPlacering(l.faktor, kx, ky, zRel, VAND, REF, ud);
        const venstre = ud.x + ud.s * -LAG_UDSTRAEK.side, hoejre = ud.x + ud.s * (B + LAG_UDSTRAEK.side);
        assert.ok(venstre <= kx - vw / 2 && hoejre >= kx + vw / 2,
                  `${l.navn} dækker ikke vandret ved zoom ${z.toFixed(2)}, (${kx.toFixed(0)}, ${ky.toFixed(0)})`);
        // Under laget må der ikke være et hul ned til havet (eller billedkanten).
        const bund = ud.y + ud.s * (l.bund - LAG_UDSTRAEK.under);
        assert.ok(bund <= Math.max(ky - vh / 2, VAND),
                  `${l.navn}: hul under laget ved zoom ${z.toFixed(2)}, y ${ky.toFixed(0)} (bund ${bund.toFixed(0)})`);
        assert.ok(ud.s > 0 && fliseH > 0);
      }
    }
  }
});

test('den rigtige baggrund: bygges, skaleres efter dybde og driver med vinden', async () => {
  // Uden browser: et lærred, der kan tegnes på og ikke gør noget. three
  // uploader først teksturerne, når der tegnes, så resten er den rigtige kode.
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) };
  const { lavParallaks } = await import('../static/js/render/parallax.js');
  const { Scene, OrthographicCamera } = await import('../static/js/three.js');
  const { lavRng } = await import('../static/js/core/rng.js');

  const byg = (vinddrift) => {
    const scene = new Scene();
    const kamera = new OrthographicCamera(-409, 409, 230, -230, -1000, 1000);   // standardudsynet
    kamera.position.set(1500, 640, 100);
    const plx = lavParallaks(scene, kamera, { w: B, h: H, vandNiveau: VAND }, lavRng(1), 'solskin', { vinddrift });
    for (let i = 0; i <= 120; i++) plx.opdater(i / 60, 1);                        // 2 s i vind 1 (mod højre)
    return { scene, plx };
  };

  const { scene, plx } = byg(true);
  const lag = scene.children.filter((m) => m.material?.uniforms?.uForskyd);
  assert.equal(lag.length, LAG.length, 'alle lag er bygget');
  // Fjernest først: skalaen vokser med nærheden (perspektivet ved zoom).
  for (let i = 1; i < lag.length; i++) assert.ok(lag[i].scale.x > lag[i - 1].scale.x, `lag ${i}`);
  // Vinddriften: skyerne (malede lag) flytter teksturen modsat, tågen selve båndene.
  lag.forEach((m, i) => {
    const d = LAG[i], f = m.material.uniforms.uForskyd.value;
    if (!d.vind) assert.equal(f, 0, `${d.navn} står stille`);
    else if (d.taage) assert.ok(Math.abs(f - d.vind * 2) < 0.5, `${d.navn}: ${f.toFixed(2)}`);
    else assert.ok(Math.abs(f + d.vind * 2) < 0.5, `${d.navn}: ${f.toFixed(2)}`);
  });
  plx.fjern();
  assert.equal(scene.children.length, 0, 'fjern() rydder alt');

  // Uden vinddrift (prefers-reduced-motion): ingen ophobet forskydning.
  const stille = byg(false);
  assert.ok(stille.scene.children.every((m) => !m.material?.uniforms?.uForskyd || m.material.uniforms.uForskyd.value === 0));
});
