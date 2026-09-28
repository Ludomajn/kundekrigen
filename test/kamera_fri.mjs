/* Kundekrigen — kameraet: fri panorering, C, gæster/snapshot, fortet,
 * pludselig død og verdens-UI (navneskilte) ved alle zoom.
 *
 *   node test/kamera_fri.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lavOpsaetning, lavBane, lavFigur, koer, iBilledet, lavProjektil, skridtProjektil, FIGUR_H } from './kamera_hjaelp.mjs';
import { ETIKET_WU, ETIKET_PX, ETIKET_HOEJDE, talAnker } from '../static/js/ui/hud.js';

/** Som kamerastyringen i main.js: WASD panorerer ikke, mens H (eller
 *  introens oversigt) vises. hoejre: D holdes. */
function mainStyring(kam, dt, kigAktiv, hoejre) {
  kam.kigPaaBanen(kigAktiv);
  const pan = 700 * dt * kam.zoom;
  const panX = hoejre ? pan : 0;
  if (panX && !kigAktiv) { kam.friTilstand(true); kam.panorer(panX, 0); }
}

function klar(o = {}) {
  const ops = lavOpsaetning(o);
  const f = lavFigur(1, 1500, (o.jord ?? 600) + 1);
  ops.kam.snap(f.x, f.y + 40); ops.kam.fokus(f);
  koer(ops, 2);
  return { ...ops, f };
}

test('fri panorering (WASD): flytter billedet, og kunden står stille', () => {
  const { r, kam, f } = klar();
  const x0 = r.kamera.position.x;
  kam.friTilstand(true);
  koer({ r, kam }, 1, (t, dt) => kam.panorer(700 * dt * kam.zoom, 0));
  koer({ r, kam }, 1);
  assert.ok(r.kamera.position.x - x0 > 500, `panorerede ${(r.kamera.position.x - x0).toFixed(0)} wu`);
  assert.equal(kam.tilstand, 'fri');
  assert.ok(kam.erFri());
  // Figuren går lidt: billedet bliver, hvor man panorerede hen.
  const xFri = r.kamera.position.x;
  koer({ r, kam }, 1, (t, dt) => { f.x += 105 * dt; });
  assert.ok(Math.abs(r.kamera.position.x - xFri) < 10, 'fri panorering følger ikke kunden');
});

test('fri panorering ud over kanten hober sig ikke op', () => {
  const { r, t, kam } = klar();
  kam.friTilstand(true);
  koer({ r, kam }, 12, (tid, dt) => kam.panorer(-900 * dt, 0));      // langt ud til venstre
  const k = r.kamera.position;
  assert.ok(k.x - r.bredde / 2 >= -60 - 1, 'billedet går ikke mere end 60 wu ud over banen');
  // Straks tilbage: ingen opsparet forskydning at "betale af" først.
  const x0 = k.x;
  koer({ r, kam }, 0.5, (tid, dt) => kam.panorer(900 * dt, 0));
  assert.ok(r.kamera.position.x - x0 > 150, 'reagerer med det samme den anden vej');
  assert.ok(t.w > 0);
});

test('WASD under H: ingen usynlig forskydning, der kaster billedet væk bagefter', () => {
  // Kameraet selv: selv hvis nogen slår fri til og panorerer under H (som
  // main.js gjorde), hober oversigtens fart (~4550 wu/s) sig ikke op.
  {
    const { r, kam, f } = klar();
    kam.kigPaaBanen(true); koer({ r, kam }, 2);
    koer({ r, kam }, 0.25, (t, dt) => { kam.friTilstand(true); kam.panorer(700 * dt * kam.zoom, 0); });
    kam.kigPaaBanen(false); koer({ r, kam }, 3);
    const dx = r.kamera.position.x - f.x;
    assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.2), `kunden er i billedet efter H (${dx.toFixed(0)} wu ved siden af)`);
  }
  // Som main.js: fri slås slet ikke til under H, og C er ikke nødvendig bagefter.
  {
    const { r, kam, f } = klar();
    koer({ r, kam }, 2, (t, dt) => mainStyring(kam, dt, true, false));
    koer({ r, kam }, 0.25, (t, dt) => mainStyring(kam, dt, true, true));
    assert.ok(!kam.erFri(), 'D under H slår ikke fri panorering til');
    koer({ r, kam }, 3, (t, dt) => mainStyring(kam, dt, false, false));
    assert.ok(!kam.erFri() && kam.tilstand !== 'fri', `tilstanden efter H: ${kam.tilstand}`);
    assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.2), 'kunden er i midten igen');
    // Og efter H panorerer D som normalt.
    const x0 = r.kamera.position.x;
    koer({ r, kam }, 0.5, (t, dt) => mainStyring(kam, dt, false, true));
    koer({ r, kam }, 1);
    assert.ok(kam.erFri() && r.kamera.position.x - x0 > 200, 'D panorerer, når H er sluppet');
  }
  // main.js har stadig vagten (mainStyring ovenfor er en kopi af den).
  const main = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
  const linje = main.split('\n').find((l) => l.includes('kamera.friTilstand(true)') && l.includes('panorer('));
  assert.ok(linje && /!kigAktiv/.test(linje), 'main.js panorerer kun, når oversigten ikke vises');
  assert.ok(/kigPaaBanen\(kigAktiv\)/.test(main), 'og H og introen er samme betingelse');
});

test('fri panorering tager indramningen med: sigtets skub og havets træk bliver', () => {
  // Sigte til højre med kraft: billedet er skubbet frem. Et tryk på W (kun
  // lodret) må ikke også lade billedet glide tilbage over kunden.
  {
    const { r, kam, f } = klar();
    f.vinkel = 0; f.retning = 1;
    kam.saetSigte('vinkel+kraft', 0.6, f.id);
    koer({ r, kam }, 3);
    const x0 = kam.glat.x, y0 = kam.glat.y;
    assert.ok(x0 - f.x > 0.1 * r.bredde, `skubbet frem i sigteretningen (${(x0 - f.x).toFixed(0)} wu)`);
    const s = [
      ...koer({ r, kam }, 0.2, (t, dt) => { kam.friTilstand(true); kam.panorer(0, 700 * dt * kam.zoom); }),
      ...koer({ r, kam }, 2.5),
    ];
    const vaerst = Math.max(...s.map((q) => Math.abs(q.x - x0)));
    assert.ok(vaerst < 3, `W flytter billedet ${vaerst.toFixed(1)} wu vandret`);
    assert.ok(kam.glat.y - y0 > 100, 'og W panorerede op');
    assert.equal(kam.tilstand, 'fri');
  }
  // Et plateau 200 wu over havet: billedet er trukket ned, så havet er med.
  // Et tryk på A (kun vandret) må ikke løfte billedet, så havet forsvinder.
  {
    const { r, kam } = klar({ jord: 500, baneOpt: { jord: 500, vand: 300 } });
    const bund = (q) => q.y - q.zoom * r.enhed.h / 2;
    const b0 = bund(kam.glat);
    assert.ok(b0 <= 300 - 20, `havet er med (bundkant ${b0.toFixed(0)})`);
    const x0 = kam.glat.x;
    const s = [
      ...koer({ r, kam }, 0.3, (t, dt) => { kam.friTilstand(true); kam.panorer(-700 * dt * kam.zoom, 0); }),
      ...koer({ r, kam }, 2.5),
    ];
    const vaerst = Math.max(...s.map((q) => Math.abs(bund(q) - b0)));
    assert.ok(vaerst < 2, `A flytter bundkanten ${vaerst.toFixed(1)} wu`);
    assert.ok(x0 - kam.glat.x > 100, 'og A panorerede til venstre');
  }
});

test('C centrerer på kunden igen; et skud trækker billedet med', () => {
  const { r, kam, f } = klar();
  kam.friTilstand(true);
  koer({ r, kam }, 1, (t, dt) => kam.panorer(0, 700 * dt));
  kam.friTilstand(false); kam.foelg(f);                          // C
  koer({ r, kam }, 2);
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.3), 'kunden i midten');
  // Fri igen, så et skud: kameraet følger skuddet.
  kam.friTilstand(true);
  koer({ r, kam }, 1, (t, dt) => kam.panorer(-700 * dt, 0));
  const p = lavProjektil(5, f.x, f.y + 40, 700, 500);
  koer({ r, kam }, 1.2, (t, dt) => { skridtProjektil(p, dt); kam.foelgSkud(p, [p]); });
  assert.ok(!kam.erFri(), 'skuddet ophæver den frie panorering');
  assert.ok(iBilledet(r, p.x, p.y, 0.1), 'skuddet er i billedet');
});

test('gæster: et snapshot udskifter figurobjektet — kameraet følger det nye', () => {
  let figurer = [lavFigur(1, 1500, 601)];
  const ops = lavOpsaetning({ kamOpt: { figur: (id) => figurer.find((b) => b.id === id) || null } });
  const { r, kam } = ops;
  kam.snap(1500, 640); kam.fokus(figurer[0]);
  koer(ops, 1);
  // Snapshottet: nye objekter; figuren er flyttet 900 wu (brandøvelsen).
  figurer = [lavFigur(1, 2400, 601)];
  koer(ops, 3);
  assert.ok(iBilledet(r, 2400, 624, 0.2), 'kameraet fandt den nye figur');
});

test('gæster: et nyt terræn (spejlet bygget om) bruges med det samme', () => {
  const gammel = lavBane({ jord: 600 }), ny = lavBane({ w: 3000, h: 1200, jord: 400 });
  let t = gammel;
  const ops = lavOpsaetning({ bane: gammel, kamOpt: { terraen: () => t } });
  const { r, kam } = ops;
  kam.snap(2500, 640);
  t = ny;
  kam.kigPaaBanen(true);
  koer(ops, 2);
  const k = r.kamera.position;
  assert.ok(Math.abs(k.x - ny.w / 2) < 5 && Math.abs(k.y - ny.h / 2) < 5, 'oversigten gælder det nye terræn');
});

test('fortet: lofter og dæk forvirrer ikke kameraet', () => {
  // Et fort: gulv i 600, loft fra 760 (en figur under et dæk).
  const bane = lavBane({ jord: 600, loft: 760 });
  const ops = lavOpsaetning({ bane });
  const { r, kam, t } = ops;
  const f = lavFigur(1, 1500, 601);
  kam.snap(f.x, f.y + 40); kam.fokus(f);
  koer(ops, 2);
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H / 2, 0.2));
  // Et skud inde i fortet: rammes ind, og jorden under er med.
  const p = lavProjektil(5, f.x + 20, f.y + 30, 600, 60);
  let inde = 0, n = 0;
  koer(ops, 1.5, (tid, dt) => {
    if (p.y <= 600 || p.y >= 760) return;
    skridtProjektil(p, dt); kam.foelgSkud(p, [p]);
    n++; if (iBilledet(r, p.x, p.y, 0.1)) inde++;
  });
  assert.ok(n > 10 && inde === n, `skuddet i billedet (${inde}/${n})`);
  assert.ok(t.fast(1500, 800), 'loftet findes');
});

test('pludselig død: havet stiger, og billedet tager det med', () => {
  const { r, kam, f } = klar({ baneOpt: { jord: 600, vand: 200 } });
  const bund0 = r.kamera.position.y - r.hoejde / 2;
  assert.ok(bund0 > 200, 'havet er ude af billedet fra start');
  // Vandet stiger (SUDDEN_SPRING m.fl.) til 220 wu under fødderne: inden for
  // rækkevidde af havets træk (20 % af højden), så det kommer med.
  kam.saetVand(380);
  koer({ r, kam }, 3);
  assert.ok(r.kamera.position.y - r.hoejde / 2 <= 380 - 20, 'nu er havet med i bunden af billedet');
  assert.ok(iBilledet(r, f.x, f.y + FIGUR_H, 0.08), 'og hovedet er i billedet');
});

// Skade- og helbredstallet (app.css .skadetal): 22 px (30 px for .stor), og
// animationen løfter det 60-190 % af højden op fra ankeret; ved poppet (14 %)
// er det skaleret 1,25 om sin midte. Den aktive kundes skilt har en gul ring
// 2,5 px uden for en luft på 2 px (.etiket.aktiv).
const TAL_GLYF = [22, 30], TAL_FASER = [[-1.1, 1.25], [-1.1, 1], [-1.5, 1], [-1.9, 0.9]], RING = 4.5;

/** Tallets laveste punkt (skærm-y, nedad er større) i animationens faser. */
function talBund(anker) {
  let bund = -Infinity;
  for (const g of TAL_GLYF) {
    for (const [ty, sk] of TAL_FASER) bund = Math.max(bund, anker + ty * g + g / 2 + sk * g / 2);
  }
  return bund;
}

test('navneskilte (hud.js): samme luft over hovedet ved alle zoom; skadetal over skiltet', () => {
  const { r, kam, f } = klar();
  const luft = [];
  const tjekTal = (hvor) => {
    // Skiltets underkant i tilSkaerm(x, y + ETIKET_WU) - ETIKET_PX (hud.opdaterEtiketter).
    const a = r.tilSkaerm(f.x, f.y + ETIKET_WU).y;
    // Skiltets højde læses i spillet; 0 = intet skilt endnu (standarden).
    for (const skiltH of [0, 16, ETIKET_HOEJDE, 24]) {
      const skiltTop = a - ETIKET_PX - (skiltH || ETIKET_HOEJDE) - RING;
      const anker = talAnker(a, skiltH);
      assert.ok(anker < skiltTop, `${hvor}: tallets anker (${anker.toFixed(1)}) er over skiltets top (${skiltTop.toFixed(1)})`);
      assert.ok(talBund(anker) <= skiltTop,
        `${hvor}, skilt ${skiltH} px: tallet når ned til ${talBund(anker).toFixed(1)}, skiltet begynder i ${skiltTop.toFixed(1)}`);
      assert.ok(skiltTop - anker < 12, `${hvor}: tallet svæver ikke langt over skiltet`);
    }
  };
  for (const trin of [0, 1, 2, 3]) {
    while (kam.zoomTrin > trin) kam.zoomInd();
    while (kam.zoomTrin < trin) kam.zoomUd();
    koer({ r, kam }, 3);
    const hoved = r.tilSkaerm(f.x, f.y + FIGUR_H).y;
    const skilt = r.tilSkaerm(f.x, f.y + ETIKET_WU).y - ETIKET_PX;
    luft.push(hoved - skilt);
    tjekTal(`trin ${trin}`);
  }
  for (const l of luft) assert.ok(l >= 14 && l <= 45, `luft mellem hoved og skilt: ${l.toFixed(1)} px`);
  // Under sigtet (længst ude) og ved oversigten er skiltet stadig over hovedet.
  kam.kigPaaBanen(true); koer({ r, kam }, 2);
  assert.ok(r.tilSkaerm(f.x, f.y + FIGUR_H).y - (r.tilSkaerm(f.x, f.y + ETIKET_WU).y - ETIKET_PX) >= 8);
  tjekTal('oversigten');
});
