/* Kundekrigen — test: en hoppende granat går af, når lunten er brændt.
 *
 *   node --no-warnings --test test/fysik_granat.mjs
 *
 * Fejlen: en granat (Datalæk-bomben, Integrations inferno — alt med hop > 0
 * og lunte > 0), der faldt til ro OVEN PÅ en kunde, prellede af hovedet hvert
 * tick. Grenen returnerede før lunten talte ned og før dvalen, så bomben gik
 * aldrig af, og turen sluttede først, da vagthunden (turn.js, RO_VAGTHUND)
 * fjernede den i stilhed.
 *
 * 1. Fysikken alene, på en flad testbane: granaten på et hoved går af præcis
 *    når lunten er brændt, og den sover dér imens. Det samme, når den hopper
 *    på terrænet, og når kunden går eller dør under den.
 * 2. Dvalen på kunden overlever et snapshot.
 * 3. Skriptede kampe på 10 minutter: vagthunden fjerner aldrig et projektil
 *    med lunte, og samme frø giver samme kamp.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terraen, JORD } from '../static/js/sim/terrain.js';
import { lavProjektil, afstandTilHitbox, HITBOX } from '../static/js/sim/entities.js';
import { skridtProjektil } from '../static/js/sim/physics.js';
import { RO_VAGTHUND } from '../static/js/sim/turn.js';
import { lavVerden, T, K, VAABEN } from '../static/js/sim/world.js';
import { lavHold } from './kort_hjaelp.mjs';

const JORD_Y = 400;                     // overfladen på testbanen

/** Flad testbane: fast op til JORD_Y. */
function fladBane() {
  const t = new Terraen(2000, 1000);
  for (let y = 0; y < JORD_Y; y++) for (let x = 0; x < t.w; x++) t.maske[t.idx(x, y)] = JORD;
  return t;
}

const lavKunde = (id, x) => ({ id, x, y: JORD_Y, doed: false });

/** En granat som våbnet affyrer den (behaviours.js), med lunten i sekunder. */
function lavGranat(vaaben, x, y, vx = 0, vy = 0, sek = 3) {
  const w = VAABEN[vaaben];
  return lavProjektil(99, {
    x, y, vx, vy, r: w.projektil.r, vindFaktor: w.projektil.vindFaktor,
    hop: w.projektil.hop, rammerBaevere: w.projektil.rammerBaevere,
    detonation: w.detonation, lunte: Math.round(sek * 60), ejer: 7,
  });
}

/** Kør til projektilet melder noget (eller loftet nås). hvert(tick) kaldes før hvert skridt. */
function koerTil(t, p, baevere, loft = 1000, hvert = () => {}) {
  for (let tick = 1; tick <= loft; tick++) {
    hvert(tick);
    const res = skridtProjektil(t, p, 0, baevere);
    if (res) return { res, tick };
  }
  return { res: null, tick: loft };
}

const overHovedet = (b, p, luft = 3) => b.y + HITBOX.hoejde + p.r + luft;

for (const vaaben of ['egegranat', 'koglebombe']) {
  test(`${vaaben} på et hoved går af, når lunten er brændt`, () => {
    const t = fladBane();
    const b = lavKunde(1, 1000);
    for (const sek of [1, 3, 5]) {
      const p = lavGranat(vaaben, b.x, 0, 0, 0, sek);
      p.y = overHovedet(b, p);
      let hvilte = 0;
      const { res, tick } = koerTil(t, p, [b], 1000, () => { if (p.sover && p.hvilerPaa === b.id) hvilte++; });
      assert.equal(res?.slags, 'lunte', `${sek} s: granaten gik aldrig af (lunte ${p.lunte}, v ${p.vx}, ${p.vy})`);
      assert.equal(tick, sek * 60, `${sek} s: gik af efter ${tick} tick`);
      assert.ok(p.sover && p.hvilerPaa === b.id, `${sek} s: granaten sov ikke på kunden`);
      assert.ok(hvilte > sek * 60 - 30, `${sek} s: sov kun ${hvilte} tick på hovedet`);
      const d = afstandTilHitbox(b, p.x, p.y);
      assert.ok(d > p.r && d < p.r + 1, `${sek} s: lå ${d.toFixed(2)} wu fra træfzonen, ikke på den`);
    }
  });
}

test('lunten brænder også, mens granaten hopper på terrænet', () => {
  const t = fladBane();
  for (const [vx, vy] of [[420, -420], [-300, -700], [0, -900], [300, 200]]) {
    const p = lavGranat('egegranat', 1000, JORD_Y + 80, vx, vy, 4);
    let hop = 0, sidstVy = vy;
    const { res, tick } = koerTil(t, p, [], 1000, () => { if (p.vy > 0 && sidstVy <= 0) hop++; sidstVy = p.vy; });
    assert.ok(hop >= 2, `v (${vx}, ${vy}): hoppede kun ${hop} gange`);
    assert.equal(res?.slags, 'lunte', `v (${vx}, ${vy}): gik ikke af`);
    assert.equal(tick, 240, `v (${vx}, ${vy}): gik af efter ${tick} tick, ikke 240`);
  }
});

test('går kunden væk under granaten, falder den ned og går af til tiden', () => {
  const t = fladBane();
  const b = lavKunde(1, 1000);
  const p = lavGranat('egegranat', b.x, 0, 0, 0, 4);
  p.y = overHovedet(b, p);
  let svaevede = 0;
  const { res, tick } = koerTil(t, p, [b], 1000, (n) => {
    // Sover den på kunden, skal kunden bære den (tjekket efter granatens
    // skridt, før kunden flytter sig igen).
    if (p.sover && p.hvilerPaa === b.id && afstandTilHitbox(b, p.x, p.y - 2) > p.r) svaevede++;
    // Kunden går i et tilbagetog, som skytten kan (GANGFART 105 wu/s).
    if (n > 60 && n <= 120) b.x += 105 / 60;
  });
  assert.equal(res?.slags, 'lunte');
  assert.equal(tick, 240, `gik af efter ${tick} tick`);
  assert.equal(svaevede, 0, `sov ${svaevede} tick i luften uden kunden under sig`);
  assert.ok(p.sover && p.hvilerPaa === null, 'granaten ligger ikke på jorden til sidst');
  assert.ok(p.y >= JORD_Y && p.y < JORD_Y + 3, `granaten ligger i højden ${p.y.toFixed(1)}, ikke på jorden`);
});

test('dør kunden under granaten, falder den ned og går af til tiden', () => {
  const t = fladBane();
  const b = lavKunde(1, 1000);
  const p = lavGranat('egegranat', b.x, 0, 0, 0, 3);
  p.y = overHovedet(b, p);
  const { res, tick } = koerTil(t, p, [b], 1000, (n) => { if (n === 60) b.doed = true; });
  assert.equal(res?.slags, 'lunte');
  assert.equal(tick, 180);
  assert.ok(p.hvilerPaa === null && p.y < JORD_Y + 3, `granaten hænger i ${p.y.toFixed(1)} over liget`);
});

test('en hoppende granat mod siden af en kunde sover ikke i luften', () => {
  const t = fladBane();
  const b = lavKunde(1, 1000);
  // Langsomt ind mod figurens side, midt på kroppen: den preller af og falder.
  const p = lavGranat('egegranat', b.x - HITBOX.halvB - 9 - 4, JORD_Y + 25, 40, 0, 3);
  const { res } = koerTil(t, p, [b], 1000, () => {
    if (p.sover) assert.ok(p.hvilerPaa == null ? p.y < JORD_Y + 3 : afstandTilHitbox(b, p.x, p.y - 2) <= p.r,
      `sover i (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) uden noget under sig`);
  });
  assert.equal(res?.slags, 'lunte');
});

test('dvalen på kunden overlever et snapshot', () => {
  const hold = lavHold(2, 1);
  const cfg = { banetype: 'aaben', turTicks: 1500, kampTicks: 43200 };
  const v = lavVerden({ froe: 11, banetype: 'aaben', hold, cfg });
  v.startKamp();
  const b = v.baevere[0];
  const p = lavGranat('egegranat', b.x, 0, 0, 0, 3);
  p.y = overHovedet(b, p);
  for (let i = 0; i < 30; i++) skridtProjektil(v.terraen, p, 0, v.baevere);
  assert.ok(p.sover && p.hvilerPaa === b.id, 'granaten faldt ikke i søvn på kunden');
  v.projektiler.push(p);
  const g = lavVerden({ froe: 11, banetype: 'aaben', hold, cfg });
  g.genskab(JSON.parse(JSON.stringify(v.oejebliksbillede())));
  assert.equal(g.projektiler[0].hvilerPaa, b.id);
  assert.equal(g.projektiler[0].sover, true);
});

/**
 * En skriptet kamp: hver tur sigter kunden lidt op eller ned og affyrer med
 * skiftende kraft. Returnerer vagthundens indgreb, projektilerne med lunte,
 * den fjernede, og hvor mange tick en granat sov på en kunde.
 */
function skriptetKamp(froe, ticks) {
  const v = lavVerden({ froe, banetype: 'aaben', hold: lavHold(3, 3),
                        cfg: { banetype: 'aaben', turTicks: 1500, kampTicks: 43200 } });
  v.startKamp();
  let tvungne = 0, hvilteTick = 0;
  const fjernedeMedLunte = [];
  for (let i = 0; i < ticks && v.tur.tilstand !== T.SEJR; i++) {
    const tur = v.tur;
    if (tur.tilstand === T.SPILLER_AKTIV) {
      const pid = v.aktivBaever()?.ejer;
      const tt = tur.tilstandTick;
      if (tt === 5) v.udfoerKommando({ k: 'hold', b: v.tick % 2 ? K.SIGT_OP : K.SIGT_NED }, pid);
      if (tt === 5 + (v.tick % 40)) v.udfoerKommando({ k: 'hold', b: 0 }, pid);
      if (tt === 90) v.udfoerKommando({ k: 'handling', h: 'affyr', kraft: 0.3 + (v.tick % 7) / 10 }, pid);
    }
    const medLunte = new Map(v.projektiler.filter((p) => p.hop > 0 && p.lunte > 0)
      .map((p) => [p.id, { sprite: p.sprite, x: p.x, y: p.y, lunte: p.lunte }]));
    for (const p of v.projektiler) if (p.hvilerPaa != null) hvilteTick++;
    for (const e of v.skridt()) {
      if (e.navn === 'tvungenRo') tvungne++;
      if (e.navn === 'projektilFjernet' && medLunte.has(e.id)) fjernedeMedLunte.push({ tick: v.tick, ...medLunte.get(e.id) });
    }
  }
  return { tvungne, fjernedeMedLunte, hvilteTick, aftryk: v.aftryk(), tick: v.tick };
}

test('lunten er kortere end vagthunden', () => {
  // Ellers kunne en lunte, der brænder korrekt, stadig blive afbrudt.
  for (const w of Object.values(VAABEN)) {
    if (w.lunte) assert.ok(Math.max(...w.lunte.valg) * 60 < RO_VAGTHUND, `${w.id}: lunte op til ${Math.max(...w.lunte.valg)} s`);
    if (w.projektil?.lunte) assert.ok(w.projektil.lunte * 60 < RO_VAGTHUND, w.id);
  }
});

test('skriptede kampe på 10 minutter: vagthunden fjerner aldrig en granat med lunte', () => {
  const MINUTTER_10 = 10 * 60 * 60;
  let hvilte = 0;
  for (const froe of [11, 21, 99]) {
    const k = skriptetKamp(froe, MINUTTER_10);
    assert.deepEqual(k.fjernedeMedLunte, [], `frø ${froe}: vagthunden (${k.tvungne} gange) fjernede granater med lunte`);
    hvilte += k.hvilteTick;
  }
  // Scenariet skal faktisk opstå, ellers beviser testen intet.
  assert.ok(hvilte > 0, 'ingen granat faldt til ro på en kunde i kampene');
});

test('samme frø giver samme kamp', () => {
  const a = skriptetKamp(11, 20000), b = skriptetKamp(11, 20000);
  assert.equal(a.tick, b.tick);
  assert.equal(a.aftryk, b.aftryk);
  assert.equal(a.hvilteTick, b.hvilteTick);
});
