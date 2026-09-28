/* Kundekrigen — kameraet rører aldrig simulationen.
 *
 *   node test/kamera_determinisme.mjs
 *
 * 1. Kildekoden: kameraet og baggrunden nævner ikke rngSim, Math.random,
 *    Date eller performance, og kameraet importerer intet fra sim/.
 * 2. Frosne input: kameraet skriver aldrig i figurer, projektiler eller terræn.
 * 3. Samme input giver præcis samme billede (præsentationen er deterministisk).
 * 4. En rigtig verden (sim/world.js) kørt med og uden kameraet ved siden af
 *    giver tick for tick samme tilstand — og rngSim kaldes aldrig, mens
 *    kameraet regner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lavOpsaetning, lavBane, lavFigur, koer, lavFalskRenderer } from './kamera_hjaelp.mjs';
import { koerForloeb } from './kamera_forloeb.mjs';
import { lavKamera } from '../static/js/render/camera.js';

const kilde = (sti) => readFileSync(fileURLToPath(new URL(sti, import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // kun kode, ikke kommentarer

test('kildekoden: ingen rngSim, Math.random, Date eller performance', () => {
  for (const sti of ['../static/js/render/camera.js', '../static/js/render/parallax.js']) {
    const k = kilde(sti);
    for (const forbudt of ['rngSim', 'Math.random', 'Date.now', 'new Date', 'performance.']) {
      assert.ok(!k.includes(forbudt), `${sti} bruger ${forbudt}`);
    }
  }
  const imports = [...kilde('../static/js/render/camera.js').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../core/math.js', '../core/rng.js']);
});

test('frosne input: kameraet skriver aldrig i figurer, projektiler eller terræn', () => {
  const bane = Object.freeze(lavBane({ jord: 600 }));
  const r = lavFalskRenderer();
  const kam = lavKamera(r, bane, { reduceret: false });
  const f = Object.freeze(lavFigur(1, 1500, 601));
  kam.snap(1500, 640); kam.etabler(f);
  kam.saetSigte('vinkel+kraft', 0.6, 1);
  koer({ r, kam }, 2);
  for (let i = 0; i < 90; i++) {
    const p = Object.freeze({ id: 3, x: 1500 + i * 12, y: 700 + i * 4, vx: 700, vy: 240 - i * 8 });
    const q = Object.freeze({ id: 4, x: 1480 + i * 11, y: 690 + i * 3, vx: 650, vy: 200 - i * 8 });
    kam.foelgSkud(p, Object.freeze([p, q]));
    kam.opdater(1 / 60);
  }
  kam.eksplosion(2500, 700, 74);
  kam.kortFokus(2500, 700);
  kam.saetMarkoer(true, 2000, 800);
  koer({ r, kam }, 2);
  assert.ok(Number.isFinite(r.kamera.position.x));
});

test('samme input giver præcis samme billede', () => {
  const a = koerForloeb(60).proever, b = koerForloeb(60).proever;
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.ok(a[i].px === b[i].px && a[i].py === b[i].py && a[i].vist === b[i].vist, `frame ${i}`);
  }
});

test('en rigtig verden: med og uden kameraet — samme tilstand tick for tick', async () => {
  const { lavVerden, T } = await import('../static/js/sim/world.js');
  const { K } = await import('../static/js/sim/commands.js');

  const hold = [
    { farve: 'roed', navn: 'A', spillere: [], baevere: [{ navn: 'a1', udseende: null, ejer: null }, { navn: 'a2', udseende: null, ejer: null }] },
    { farve: 'blaa', navn: 'B', spillere: [], baevere: [{ navn: 'b1', udseende: null, ejer: null }, { navn: 'b2', udseende: null, ejer: null }] },
  ];
  const cfg = { turTicks: 20 * 60, kampTicks: 600 * 60, vind: true, vejr: 'auto', banetype: 'aaben' };

  function koerVerden(medKamera) {
    const v = lavVerden({ froe: 12345, banetype: 'aaben', hold: structuredClone(hold), cfg });
    v.startKamp();
    // rngSim må aldrig kaldes, mens kameraet regner.
    let iKamera = false, rngIKamera = 0;
    const orig = v.rngSim;
    const vagt = function () { if (iKamera) rngIKamera++; return orig(); };
    Object.assign(vagt, orig);
    v.rngSim = vagt;

    const r = lavFalskRenderer();
    const kam = medKamera ? lavKamera(r, v.terraen, {
      reduceret: false,
      figur: (id) => v.baevere.find((b) => b.id === id) || null,
      terraen: () => v.terraen,
    }) : null;
    const spor = [], tilstande = new Set();
    const nedslag = { x: 0, y: 0 };
    let seq = 0, skudt = -1, holdTil = -1;
    for (let tick = 0; tick < 60 * 45; tick++) {
      // Et fast, skriptet input: sigt op, lad, skyd — hver tur.
      if (v.tur.tilstand === T.SPILLER_AKTIV) {
        const i = v.tur.tilstandTick;
        if (i === 5) v.udfoerKommando({ k: 'hold', seq: seq++, b: K.SIGT_OP });
        if (i === 25) v.udfoerKommando({ k: 'hold', seq: seq++, b: 0 });
        if (i === 40 && skudt !== v.tur.turNr) { skudt = v.tur.turNr; v.udfoerKommando({ k: 'handling', seq: seq++, h: 'affyr', kraft: 0.7 }); }
      }
      const h = v.skridt();
      if (kam) {
        iKamera = true;
        for (const e of h) {
          if (e.navn === 'turStart') kam.etabler(v.baevere.find((b) => b.id === e.baever));
          if (e.navn === 'eksplosion') kam.eksplosion(e.x, e.y, e.radius);
          if (e.navn === 'doedsfald') kam.kortFokus(e.x, e.y + 22);
        }
        const akt = v.aktivBaever();
        kam.saetSigte(akt && v.tur.tilstand === T.SPILLER_AKTIV ? v.vaabenNu()?.sigte : null, 0, akt?.id ?? null);
        kam.saetVand(v.vandNiveau);
        // Som main.js: følg det nyeste, hold 1,5 s over nedslaget, vend tilbage.
        if (v.projektiler.length) {
          const p = v.projektiler[v.projektiler.length - 1];
          nedslag.x = p.x; nedslag.y = p.y; holdTil = -1;
          kam.foelgSkud(p, v.projektiler);
        } else if (kam.foelgerSkud && holdTil < 0) {
          holdTil = tick + 90; kam.foelgSkud(nedslag);
        } else if (holdTil >= 0 && tick > holdTil) {
          holdTil = -1; kam.fokus(akt || v.baevere[0]);
        }
        kam.opdater(1 / 60);
        tilstande.add(kam.tilstand);
        iKamera = false;
      }
      spor.push([v.tick, v.rngSim.tilstand(), v.tur.tilstand, v.projektiler.length,
                 ...v.baevere.flatMap((b) => [b.x, b.y, b.hp, b.vinkel])].join('|'));
    }
    return { spor, rngIKamera, ops: v.terraen.ops.length, affyret: skudt, tilstande };
  }

  const uden = koerVerden(false), med = koerVerden(true);
  assert.ok(uden.affyret > 0, 'der blev skudt (scenariet virker)');
  assert.ok(uden.ops > 0, 'terrænet blev ramt (scenariet virker)');
  assert.equal(med.rngIKamera, 0, 'rngSim blev kaldt, mens kameraet regnede');
  for (const t of ['etabler', 'skud', 'nedslag']) assert.ok(med.tilstande.has(t), `kameraet var i ${t} (${[...med.tilstande]})`);
  assert.equal(med.spor.length, uden.spor.length);
  for (let i = 0; i < uden.spor.length; i++) assert.equal(med.spor[i], uden.spor[i], `tick ${i}`);
});

test('kaldene fra main.js og ui/ findes i kameraets API', () => {
  const kam = lavKamera(lavFalskRenderer(), lavBane(), { reduceret: false });
  const brugt = new Set();
  for (const sti of ['../static/js/main.js', '../static/js/ui/haendelser.js', '../static/js/ui/hud.js']) {
    for (const m of kilde(sti).matchAll(/\bkamera\.([a-zA-Z]+)\b/g)) brugt.add(m[1]);
  }
  // Three-kameraets egne felter (r.kamera.position osv.) er ikke vores API.
  for (const felt of ['position', 'left', 'right', 'top', 'bottom']) brugt.delete(felt);
  assert.ok(brugt.size >= 10, `fandt ${[...brugt].join(', ')}`);
  for (const navn of brugt) assert.ok(navn in kam, `main.js/ui kalder kamera.${navn}, som ikke findes`);
});
