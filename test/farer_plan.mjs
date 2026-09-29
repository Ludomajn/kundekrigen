/* Kundekrigen — test: planlæggeren. Ren RNG i hvornår, hvad og hvor — men
 * kun når en fare varsles.
 *
 *   node --no-warnings --test test/farer_plan.mjs
 *
 * 1. Trækbudgettet: højst 4 træk fra rngSim pr. fare (pausen før den, slags,
 *    sted og side eller last) og 0 pr. udsættelse — også på øer med 4×3
 *    kunder, hvor der ofte ingen gyldige pladser er.
 * 2. Loftet: aldrig mere end FARE_MAKS; ingen fare før runde 2; ingen drone i
 *    grotten, under et internetnedbrud eller uden plads til en kasse; aldrig
 *    samme slags to gange i træk (medmindre den er den eneste).
 * 3. Fortets støvsuger vågner kun på gyldige pladser på borgen i tur — eller
 *    kommer ikke.
 * 4. cfg.farer: en liste giver kun de nævnte; en slags, banen ikke har,
 *    udsættes uden træk.
 * 5. Rullemodellen på de fire banetyper: under 10 % sidder fast, og
 *    Kabelsalaten er aldrig inde i terrænet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skriptetKamp, aktivVerden, FA, BANER, frieSteder, T } from './farer_hjaelp.mjs';
import * as HN from '../static/js/sim/haendelser.js';

/** Tæl rngSim-træk fra planlæggeren (farer.planlaeg) tick for tick. */
function maalTraek(v) {
  const orig = v.rngSim;
  const f = function () {
    if (new Error().stack.includes('at planlaeg ')) f.plan++;
    return orig();
  };
  Object.assign(f, orig);
  f.plan = 0;
  v.rngSim = f;
  return f;
}

/** En kamp, hvor hvert tick's planlægger-træk hører til en fare eller en udsættelse. */
function budget({ froe, bane, hold, ticks = 36000, cfg = {} }) {
  const r = { farer: 0, udsat: 0, maks: 0, fejl: [] };
  let maaler = null, ventende = 0, foerN = 0, naesteFoer = null;
  skriptetKamp({ froe, bane, hold, ticks, cfg,
    foerTick: (v) => {
      maaler ||= maalTraek(v);
      foerN = maaler.plan;
      naesteFoer = v.farePlan.naeste;
    },
    efter: (v, h) => {
      const n = maaler.plan - foerN;
      const varsel = h.some((e) => e.navn === 'fareVarsel'), kom = h.some((e) => e.navn === 'fareKommer');
      if (varsel) {
        r.farer++;
        const i = ventende + n;
        r.maks = Math.max(r.maks, i);
        if (i > 4) r.fejl.push(`tick ${v.tick}: ${i} træk til faren`);
        ventende = 0;
      } else if (kom) {
        if (n !== 1) r.fejl.push(`tick ${v.tick}: ${n} træk, da faren kom`);
        ventende += n;
      } else if (n) {
        // Kun den allerførste pause (runde 2) må trække uden et varsel.
        if (naesteFoer != null) r.fejl.push(`tick ${v.tick}: ${n} træk uden varsel`);
        ventende += n;
      }
      if (naesteFoer != null && v.farePlan.naeste === v.farePlan.aktiv + FA.FARE_UDSAET && !varsel && naesteFoer !== v.farePlan.naeste) {
        r.udsat++;
        if (n) r.fejl.push(`tick ${v.tick}: udsættelsen trak ${n}`);
      }
    } });
  return r;
}

test('trækbudgettet: højst 4 pr. fare og 0 pr. udsættelse', () => {
  let farer = 0, udsat = 0;
  for (const bane of BANER) {
    for (const froe of [2, 7, 12]) {
      const r = budget({ froe, bane, hold: [3, 3] });
      assert.deepEqual(r.fejl, [], `${bane}/${froe}`);
      farer += r.farer; udsat += r.udsat;
    }
  }
  assert.ok(farer >= 20, `kun ${farer} farer`);
});

test('øer med 4×3 kunder: i 20 000 tick trækkes der aldrig ved en udsættelse', () => {
  let udsat = 0;
  for (const froe of [1, 3, 6, 9]) {
    // Dronen kan næsten altid komme; uden den er der ofte intet gyldigt sted.
    const r = budget({ froe, bane: 'oeer', hold: [4, 3], ticks: 20000, cfg: { farer: ['kabelsalat', 'stoevsuger'] } });
    assert.deepEqual(r.fejl, [], `oeer/${froe}`);
    udsat += r.udsat;
  }
  // Scenariet skal faktisk opstå, ellers beviser testen intet.
  assert.ok(udsat > 0, 'ingen udsættelser');
});

test('loftet: højst FARE_MAKS, ingen fare før runde 2, aldrig samme slags to gange i træk', () => {
  for (const bane of BANER) {
    for (const froe of [4, 10]) {
      const slags = [];
      const k = skriptetKamp({ froe, bane, efter: (v, h) => {
        assert.ok(v.farer.length <= FA.FARE_MAKS, `${bane}/${froe}: ${v.farer.length} farer`);
        for (const e of h) {
          if (e.navn !== 'fareVarsel') continue;
          assert.ok(v.tur.runde >= FA.FARE_FRA_RUNDE, `${bane}/${froe}: varsel i runde ${v.tur.runde}`);
          assert.ok(!(e.slags === 'drone' && (bane === 'hule' || v.internetNede())), `${bane}/${froe}: drone`);
          assert.ok(FA.FARE_VAEGT[e.slags][bane] > 0);
          slags.push(e.slags);
        }
      } });
      for (let i = 1; i < slags.length; i++) {
        // Samme slags igen kun, hvis den var den eneste mulige (fx fortets støvsuger uden plads).
        if (slags[i] === slags[i - 1]) assert.ok(bane === 'hule' || bane === 'fort', `${bane}/${froe}: ${slags}`);
      }
      assert.ok(k.farer >= 1, `${bane}/${froe}: ingen farer`);
    }
  }
});

test('ingen drone i grotten, under internetnedbrud eller uden plads til en kasse', () => {
  const v = aktivVerden({ froe: 3, bane: 'hule', hold: [2, 2] });
  assert.deepEqual(FA.steder(v).drone, []);
  const w = aktivVerden({ froe: 3, bane: 'aaben', hold: [2, 2] });
  assert.ok(FA.steder(w).drone.length > 0);
  w.haendelseNu = { slags: 'internet', runde: w.tur.runde };
  assert.deepEqual(FA.steder(w).drone, []);
  w.haendelseNu = null;
  for (let i = 0; i < 4; i++) w.kasser.push({ id: w.nytId(), type: 'kasse', slags: 'vaaben', indhold: 'grenroer', x: 100 + i * 50, y: 900, landet: true });
  assert.deepEqual(FA.steder(w).drone, []);
  // Vindstille: begge kanter; ellers kun vindsidens.
  w.kasser.length = 0;
  w.vind = 0; assert.deepEqual(FA.steder(w).drone, ['v', 'h']);
  w.vind = 0.5; assert.deepEqual(FA.steder(w).drone, ['v']);
  w.vind = -0.5; assert.deepEqual(FA.steder(w).drone, ['h']);
});

test('fortets støvsuger: kun gyldige pladser på borgen i tur, ellers den næste borg', () => {
  let set = 0;
  for (const froe of [2, 5, 8, 11, 14, 17]) {
    const v = aktivVerden({ froe, bane: 'fort', hold: [2, 2] });
    const forter = v.terraen.fort.forter;
    for (let antal = 0; antal < forter.length * 2; antal++) {
      v.farePlan.antal = antal;
      const S = FA.steder(v).stoevsuger;
      const levende = v.baevere.filter((b) => !b.doed);
      for (const p of S) assert.ok(levende.every((b) => Math.hypot(b.x - p.x, b.y - p.y) >= FA.RS_AFSTAND), `fort/${froe}`);
      if (!S.length) continue;
      set++;
      // Alle fra den samme borg: den første borg i rækkefølgen med en gyldig plads.
      const borg = forter.findIndex((f) => f.udstyr.includes(S[0]));
      assert.ok(S.every((p) => forter[borg].udstyr.includes(p)), `fort/${froe}: pladser fra flere borge`);
      for (let i = 0; i < forter.length; i++) {
        const b = (antal + i) % forter.length;
        if (b === borg) break;
        assert.ok(forter[b].udstyr.every((p) => levende.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < FA.RS_AFSTAND)),
          `fort/${froe}: borg ${b} havde en gyldig plads`);
      }
    }
  }
  assert.ok(set > 0, 'ingen borg havde en gyldig plads');
});

test('cfg.farer: kun de nævnte; en slags, banen ikke har, udsættes uden træk', () => {
  // Dronen kræver plads til en kasse (VAABENKASSE_MAKS): ingen forsyningskasser her.
  const k = skriptetKamp({ froe: 4, bane: 'aaben', cfg: { farer: ['drone'], kasseChance: 0 } });
  assert.ok(k.farer >= 1, `${k.farer} droner`);
  assert.equal(k.haendelser.fareKommer, k.farer);
  const slags = new Set();
  skriptetKamp({ froe: 4, bane: 'aaben', cfg: { farer: ['stoevsuger'] },
                 efter: (v, h) => { for (const e of h) if (e.navn === 'fareKommer') slags.add(e.slags); } });
  assert.deepEqual([...slags], ['stoevsuger']);
  const r = budget({ froe: 4, bane: 'hule', hold: [3, 3], cfg: { farer: ['drone'] } });
  assert.equal(r.farer, 0);
  assert.ok(r.udsat > 10, `${r.udsat} udsættelser`);
  assert.deepEqual(r.fejl, []);
});

test('rullemodellen: under 10 % sidder fast, og Kabelsalaten er aldrig inde i terrænet', () => {
  for (const bane of BANER) {
    let n = 0, fast = 0, inde = 0;
    for (let froe = 1; froe <= 6; froe++) {
      for (let k = 0; k < 6; k++) {
        const v = aktivVerden({ froe, bane, hold: [2, 2] });
        const S = FA.steder(v).kabelsalat;
        const pl = S.length ? S : frieSteder(v, 100);
        if (!pl.length) continue;
        const p = pl[(k * 7 + froe) % pl.length];
        v.vind = ((k % 5) - 2) * 0.25 + 0.05;
        const f = FA.tving(v, 'kabelsalat', { x: p.x, y: p.y, ret: v.vind > 0 ? 1 : -1 });
        n++;
        let ude = false;
        for (let i = 0; i < FA.KS_LIV && !ude; i++) {
          // Vinden rulles, som ved turskift (hver 23. s).
          if (i && i % (23 * 60) === 0) v.vind = Math.round(-v.vind * 16) / 20;
          for (const e of v.skridt()) if (e.navn === 'fareVaek') ude = true;
          if (!ude && !FA.rundFri(v.terraen, f.x, f.y, f.r)) inde++;
        }
        if (f.stille) fast++;
      }
    }
    assert.ok(n >= 30, `${bane}: ${n} forsøg`);
    assert.ok(fast / n < 0.1, `${bane}: ${fast} af ${n} sad fast`);
    assert.equal(inde, 0, `${bane}: ${inde} tick inde i terrænet`);
  }
});

test('shitstormen kan ske i grotten igen og holder sig 76 wu fra ild', () => {
  for (const froe of [37, 41, 5]) {
    const v = aktivVerden({ froe, bane: 'hule', hold: [2, 2] });
    assert.ok(HN.kanSke(v, 'shitstorm'), `hule/${froe}: shitstormen kan ikke ske`);
    const r0 = v.rngSim.tilstand();
    HN.kanSke(v, 'shitstorm');
    assert.equal(v.rngSim.tilstand(), r0, 'prøvekørslen trak');
    // Ild over hele banen, hver 300 wu: ingen mine inden for 76 wu af den.
    for (let x = 150; x < v.terraen.w; x += 300) {
      const g = v.terraen.jordUnder(x, Math.round(v.nedfaldY(x, 0) ?? 0));
      if (g > 0) FA.taendIld(v, x, g, 2, null, []);
    }
    const foer = v.placerede.length;
    const e = HN.udloes(v, 'shitstorm', []);
    const nye = v.placerede.slice(foer);
    assert.ok(e.antal >= HN.SHITSTORM_MINDST && nye.length === e.antal, `hule/${froe}: ${e.antal} miner`);
    for (const m of nye) {
      assert.ok(v.ild.every((p) => Math.hypot(p.x - m.x, p.y - m.y) >= FA.STORM_ILD_AFSTAND), `hule/${froe}: en mine i ilden`);
      assert.ok(v.terraen.fast(Math.round(m.x), Math.round(m.y) - 3), `hule/${froe}: minen står ikke på jorden`);
      assert.ok(!v.terraen.fast(Math.round(m.x), Math.round(m.y) + 4), `hule/${froe}: minen er inde i klippen`);
    }
  }
});

test('Kabelsalaten blæser ind fra vindsiden og ruller hen over banen, ikke ud over den nærmeste kant', () => {
  // Set i browseren: varslet på x 175 med vinden mod venstre — den rullede ud
  // over kanten på få sekunder, før nogen kunne nå at reagere.
  let set = 0, vindsiden = 0, kunKant = 0;
  for (const bane of ['aaben', 'oeer']) {
    for (const froe of [3, 4, 5, 7, 10, 12]) {
      skriptetKamp({ froe, bane, cfg: { farer: ['kabelsalat'] }, efter: (v, h) => {
        for (const e of h) {
          if (e.navn !== 'fareVarsel' || e.slags !== 'kabelsalat') continue;
          set++;
          const S = FA.steder(v).kabelsalat;
          const w = v.terraen.w;
          const muligt = S.some((p) => (e.ret > 0 ? p.x < w / 2 : p.x > w / 2));
          if (!muligt) { kunKant++; continue; }
          assert.ok(e.ret > 0 ? e.x < w / 2 : e.x > w / 2,
            `${bane}/${froe}: varslet på x ${Math.round(e.x)} med retning ${e.ret} (banen er ${w} bred)`);
          vindsiden++;
        }
      } });
    }
  }
  assert.ok(set >= 6, `for få Kabelsalater: ${set}`);
  assert.ok(vindsiden >= set - kunKant, `${vindsiden} af ${set} på vindsiden (${kunKant} uden plads dér)`);
});
