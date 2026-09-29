/* Kundekrigen — test: samspillet mellem tålmodighedsbjælken, vejledningen og
 * farerne i realtid (simulationen og brugerfladen), der blev lavet side om side.
 *
 *   node --no-warnings --test test/samspil.mjs
 *
 * 1. Vejledningens ventetid: tururet står, men farerne, ilden, planlæggeren og
 *    rngSim går præcis som uden (som i arsenalets pause, docs/farer.md), og
 *    ildens loft pr. tur holder i den længere tur.
 * 2. Første tur: med én spiller pr. klinik er alles første tur i runde 1, hvor
 *    der aldrig er en fare, et varsel eller ild. Med flere spillere pr. klinik
 *    kan en spillers første tur ligge i runde 2, og planlæggeren går også dér.
 * 3. Ild og kæder i bjælken (main.js' egen taelSkade, skåret ud af kilden, på
 *    et spejl med nettets 20 Hz): hver ildskade i spillerens tur afsløres
 *    straks med sit eget tal, intet afsløres under skuddet, og fyldet holder.
 *    Kædens skade (ilden tænder en printer) kommer samlet, når verden er i ro.
 * 4. Deltaen og snapshottet med begge dele: deltaens felter er de kendte,
 *    spejlet får vejledningens ventetid, farerne, ilden og varslet, og en
 *    rundtur midt i ventetiden og en brand giver samme aftryk i 600 tick.
 * 5. Farernes pil og skilt regnes før HUD'en og skrives efter den (main.js'
 *    rækkefølge), så ingen layoutlæsning kommer efter en skrivning i samme
 *    frame — hud.js' egen regel (test/hp_bjaelke.mjs).
 * 6. Kantpilen går uden om HUD'ens faste felter over den: holdlisten,
 *    arsenalets håndtag og vejledningens kort.
 * Og at test/farer_lav_spor.mjs ikke optager referencesporet igen, når
 * `node --test test/farer_*.mjs` kører den (så var sporet ikke til at stole på).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lavVerden } from '../static/js/sim/world.js';
import { anvendDelta } from '../static/js/sim/snapshot.js';
import * as TU from '../static/js/sim/turn.js';
import { HZ } from '../static/js/core/tick.js';
import { skadeForloeb, skadeK } from '../static/js/ui/tbj.js';
import { kobFarer } from '../static/js/ui/farer.js';
import { lavBus } from '../static/js/core/bus.js';
import { T, FA, BANER, lavHold, lavTestVerden, aktivVerden, botTick, kabelsalatPaaJorden, laegPlaceret,
         frieSteder } from './farer_hjaelp.mjs';
import { falskDom, falskFx, falskLyd, falskHud, falskKamera, falskRenderer } from './farer_vis_hjaelp.mjs';

const MAIN = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
const net = (x) => JSON.parse(JSON.stringify(x));
const kildeFra = (b) => ({ kaede: 0, kaedeId: 1, kildeHold: b.hold, kildeBaever: b.id });

/* ------------------------------------------------------------ 1. ventetiden */

/** Én spillertur med ild under den aktive og en fjende, og en fare, der
 *  varsles om 1 s aktiv tid. Med vejledningen venter uret (højst VEJLEDNING_LOFT). */
function turMedFarer(medVejledning) {
  const v = aktivVerden({ froe: 11, bane: 'aaben', cfg: { turTicks: 20 * HZ } });
  const b = v.aktivBaever(), fj = v.baevere.find((x) => x.hold !== b.hold && !x.doed);
  FA.taendIld(v, b.x, b.y + 2, 0, kildeFra(fj), []);
  FA.taendIld(v, fj.x, fj.y + 2, 0, kildeFra(b), []);
  v.farePlan.naeste = v.farePlan.aktiv + HZ;
  if (medVejledning) v.udfoerKommando({ k: 'handling', h: 'vejledning', aktiv: true }, b.ejer);
  const spor = [], ur = [], haendelser = [];
  let loft = 0;
  for (let i = 0; i < 60 * HZ && v.tur.tilstand === T.SPILLER_AKTIV; i++) {
    for (const e of v.skridt()) haendelser.push({ i, ...e });
    spor.push(JSON.stringify([v.tick, v.rngSim.tilstand(), v.aftryk(), v.farePlan.aktiv, v.farePlan.naeste,
      v.farePlan.varsel?.rest ?? null, v.farer.map((f) => [f.id, f.slags, f.x, f.y, f.tilst]),
      v.ild.map((p) => [p.id, p.x, p.y, p.alder]), v.baevere.map((x) => [x.hp, x.ildTur])]));
    ur.push(v.tur.tickTilbage);
    loft = Math.max(loft, ...v.baevere.map((x) => x.ildTur));
  }
  return { v, b, spor, ur, haendelser, loft };
}

test('vejledningens ventetid: uret står, farerne, ilden og planlæggeren går som ellers', () => {
  const uden = turMedFarer(false), med = turMedFarer(true);
  assert.equal(uden.spor.length, 20 * HZ, 'uden vejledningen: 20 s');
  assert.ok(med.spor.length >= uden.spor.length + TU.VEJLEDNING_LOFT - 2,
            `med: uret venter højst ${TU.VEJLEDNING_LOFT} tick længere (${med.spor.length})`);
  // Tick for tick, så længe begge er i spillerens tur: samme verden, samme træk.
  for (let i = 0; i < uden.spor.length; i++) assert.equal(med.spor[i], uden.spor[i], `tick ${i}`);
  // Uret stod stille, mens vejledningen havde kvoten — og gik så igen.
  const start = med.ur[1];
  assert.ok(med.ur.slice(1, TU.VEJLEDNING_LOFT - 1).every((t) => t === start), 'uret stod');
  assert.ok(med.ur.at(-1) < start, 'og gik bagefter');
  assert.equal(med.v.tur.vejledningBrugt[med.b.ejer], TU.VEJLEDNING_LOFT);
  // Farerne venter ikke på vejledningen: varslet og faren kom, mens uret stod.
  const kom = med.haendelser.find((e) => e.navn === 'fareKommer');
  assert.ok(med.haendelser.some((e) => e.navn === 'fareVarsel' && e.i < TU.VEJLEDNING_LOFT), 'varslet i ventetiden');
  assert.ok(kom && kom.i < TU.VEJLEDNING_LOFT, 'faren kom i ventetiden');
  assert.ok(med.haendelser.some((e) => e.navn === 'skade' && e.aarsag === 'ild' && e.baever === med.b.id),
            'ilden skadede den aktive kunde, mens den lærte styringen');
  // Den længere tur giver ikke mere ildskade: loftet er pr. tur.
  assert.ok(med.loft <= FA.ILD_LOFT, `ildTur ${med.loft} <= ${FA.ILD_LOFT}`);
});

/* ------------------------------------------------------------ 2. første tur */

/** Kør en kamp med botten; kald hver(v) i hver spillers første tur. */
function foersteTure(v, hver, loft = 20000) {
  const set = new Set(), foerste = new Map(), ejere = new Set(v.baevere.map((b) => b.ejer));
  for (let i = 0; i < loft && v.tur.tilstand !== T.SEJR; i++) {
    botTick(v);
    v.skridt();
    if (v.tur.tilstand !== T.SPILLER_AKTIV) continue;
    const b = v.aktivBaever(), ejer = b?.ejer;
    if (!ejer || (set.has(ejer) && foerste.get(ejer) !== v.tur.turNr)) continue;
    set.add(ejer);
    if (!foerste.has(ejer)) foerste.set(ejer, v.tur.turNr);
    hver(v, ejer);
    if (set.size === ejere.size && [...foerste.values()].every((n) => n < v.tur.turNr)) break;
  }
  return foerste;
}

test('første tur: med én spiller pr. klinik aldrig en fare, et varsel eller ild', () => {
  for (const bane of BANER) {
    const v = lavTestVerden({ froe: 5, bane, hold: [2, 3], cfg: { turTicks: 15 * HZ } });
    const set = new Map();
    foersteTure(v, (vv, ejer) => {
      const s = set.get(ejer) || { runde: vv.tur.runde, farer: 0, varsel: 0, ild: 0 };
      s.farer += vv.farer.length; s.varsel += vv.farePlan.varsel ? 1 : 0; s.ild += vv.ild.length;
      set.set(ejer, s);
    }, 6000);
    assert.equal(set.size, 2, `${bane}: begge spillere havde deres første tur`);
    for (const [ejer, s] of set) {
      assert.equal(s.runde, 1, `${bane}/${ejer}: første tur i runde 1`);
      assert.deepEqual([s.farer, s.varsel, s.ild], [0, 0, 0], `${bane}/${ejer}: intet i første tur`);
    }
  }
});

test('første tur: med to spillere pr. klinik kan den ligge i runde 2, og planlæggeren går også under ventetiden', () => {
  const hold = [0, 1].map((i) => ({
    farve: ['blaa', 'roed'][i], navn: `Hold ${i}`, spillere: [`p${i}a`, `p${i}b`],
    baevere: ['a', 'b'].map((s) => ({ navn: `k${i}${s}`, udseende: {}, ejer: `p${i}${s}` })),
  }));
  const v = lavVerden({ froe: 9, banetype: 'aaben', hold, cfg: { banetype: 'aaben', turTicks: 15 * HZ, kampTicks: 43200 } });
  v.startKamp();
  if (v.tur.tilstand === T.FILM) v.udfoerKommando({ k: 'film' });
  const runde = new Map(), vj = new Map();
  foersteTure(v, (vv, ejer) => {
    if (!runde.has(ejer)) {
      runde.set(ejer, vv.tur.runde);
      // Som main.js ved dinTur: vejledningen venter på uret.
      vv.udfoerKommando({ k: 'handling', h: 'vejledning', aktiv: true }, ejer);
      vj.set(ejer, { ventede: 0, gik: 0, stod: 0, forrige: null });
    }
    const s = vj.get(ejer), P = vv.farePlan;
    // Planlæggerens ur går hvert aktive tick, når der er plads til en fare mere
    // — også mens tururet venter på vejledningen.
    if (vv.tur.vejledning && s.forrige && s.forrige.tick === vv.tick - 1 && s.forrige.plads) {
      s.ventede++;
      if (P.aktiv === s.forrige.aktiv + 1) s.gik++; else s.stod++;
    }
    s.forrige = { tick: vv.tick, aktiv: P.aktiv, plads: vv.farer.length < FA.FARE_MAKS };
    s.naeste = P.naeste;
  });
  assert.deepEqual([...runde.values()].sort(), [1, 1, 2, 2], 'to første ture i runde 1, to i runde 2');
  for (const [ejer, s] of vj) {
    assert.ok(s.ventede > HZ, `${ejer}: uret ventede på vejledningen`);
    assert.deepEqual([s.gik, s.stod], [s.ventede, 0], `${ejer}: planlæggerens ur gik hvert tick i ventetiden`);
    if (runde.get(ejer) === 2) assert.ok(s.naeste != null, `${ejer}: i runde 2 er næste fare planlagt`);
  }
});

/* ------------------------------------------------------------ 3. bjælken */

/* main.js' egen taelSkade og fyldet (som i test/hp_bjaelke.mjs). */
function blok(start, slut) {
  const i = MAIN.indexOf(start);
  assert.ok(i >= 0, `main.js: fandt ikke ${start}`);
  const j = MAIN.indexOf(slut, i + start.length);
  assert.ok(j >= 0, `main.js: fandt ikke slutningen på ${start}`);
  return MAIN.slice(i, j + slut.length);
}
const lavTaelSkade = new Function('S', 'hud', 'lyd', 'r', 'skadeForloeb', 'skadeK', [
  blok('hud.saetVisHp(', ');\n'), blok('hud.saetFyldHp(', '});\n'), blok('const UROLIG = new Set(', '\n}\n'),
  'return taelSkade;',
].join('\n'));

test('ild og kæder i bjælken: hver ildskade straks i spillerens tur, kædens samlet efter skuddet', () => {
  const v = aktivVerden({ froe: 11, bane: 'aaben', cfg: { turTicks: 20 * HZ } });
  const opsaet = { froe: 11, banetype: 'aaben', hold: lavHold(2, 2), cfg: net(v.cfg) };
  const spejl = lavVerden(opsaet);
  spejl.genskab(net(v.oejebliksbillede()));
  const skytte = v.aktivBaever();
  const [a, b] = v.baevere.filter((x) => x.hold !== skytte.hold && !x.doed);
  // Ild under fjende A nu; en printer ved fjende B, som ilden tænder, når der skydes.
  FA.taendIld(v, a.x, a.y + 2, 0, kildeFra(skytte), []);
  const printer = laegPlaceret(v, 'toende', b.x + 36, b.y);

  const log = { tal: [], lyd: [] };
  let visHp = null, fyldHp = null, NU = 0;
  const S = { visHp: new Map(), sidsteTik: 0 };
  const hud = { saetVisHp: (f) => { visHp = f; }, saetFyldHp: (f) => { fyldHp = f; }, markerRamt() {},
                skadeTal: (x, tal) => log.tal.push({ id: x.id, tal, tilstand: spejl.tur.tilstand, i }) };
  const lyd = { afspil: (n) => log.lyd.push(n) };
  const taelSkade = lavTaelSkade(S, hud, lyd, null, skadeForloeb, skadeK);
  const vi = { baevere: { get: () => ({ ramt() {} }) } };

  const hp0 = new Map(v.baevere.map((x) => [x.id, x.hp]));
  const ildTik = [];                     // ildskade på A i spillerens tur (værtens hændelser)
  let skudI = -1, fyldVedSkud = null, iSkud = true, sidst = new Map(), i = 0;
  for (; i < 40 * HZ; i++) {
    if (i === 100) {
      // "Skuddet": ilden ved printeren, og turen afsluttes (opløsningen venter på lunten).
      FA.taendIld(v, printer.x, printer.y, 0, kildeFra(skytte), []);
      v.udfoerKommando({ k: 'handling', h: 'staaOver' }, skytte.ejer);
    }
    const tilstand = v.tur.tilstand;
    const h = v.skridt();
    for (const e of h) if (e.navn === 'skade' && e.baever === a.id && tilstand === T.SPILLER_AKTIV) ildTik.push(e);
    if (h.some((e) => e.navn === 'turStart')) spejl.genskab(net(v.oejebliksbillede()));
    if (i % 3 === 0) anvendDelta(spejl, net(v.delta()));          // nettets 20 Hz
    NU += 1000 / HZ;
    taelSkade(spejl, vi, NU);
    const urolig = spejl.tur.tilstand === T.AFFYRING || spejl.tur.tilstand === T.OPLOESNING;
    if (urolig && skudI < 0) { skudI = i; fyldVedSkud = new Map(spejl.baevere.map((x) => [x.id, fyldHp(x)])); }
    if (skudI >= 0 && iSkud) {
      if (urolig) {
        for (const x of spejl.baevere) assert.equal(fyldHp(x), fyldVedSkud.get(x.id), `fyldet holder under skuddet (${x.id}, ${i})`);
      } else iSkud = false;
    }
    for (const x of spejl.baevere) {
      const vist = visHp(x), foer = sidst.get(x.id) ?? vist;
      assert.ok(vist <= foer, `tallet stiger ikke under skade (${x.id}, ${i})`);
      assert.ok(foer - vist <= 2, `tallet springer ikke (${x.id}: ${foer} -> ${vist}, ${i})`);
      assert.ok(fyldHp(x) <= vist && fyldHp(x) >= Math.max(0, x.hp), `fyldet ligger mellem hp og tallet (${x.id}, ${i})`);
      sidst.set(x.id, vist);
    }
  }
  assert.ok(skudI > 0 && !iSkud, 'skuddet blev afviklet');
  assert.ok(printer.doed || !v.placerede.includes(printer), 'ilden satte printeren af');
  // Intet afsløres under skuddet.
  assert.deepEqual(log.tal.filter((t) => t.tilstand === T.AFFYRING || t.tilstand === T.OPLOESNING), []);
  // Hver ildskade i spillerens tur har sit eget tal (4), lige så mange som tikkene.
  const iTur = log.tal.filter((t) => t.id === a.id && t.i < skudI);
  assert.ok(ildTik.length >= 2, `A brændte i spillerens tur (${ildTik.length} tik)`);
  assert.deepEqual(iTur.map((t) => t.tal), ildTik.map((e) => e.skade), 'ét tal pr. ildtik');
  // Kædens skade på B (printeren) kommer samlet — ét tal, når verden er i ro.
  const efter = log.tal.filter((t) => t.id === b.id && t.i >= skudI);
  assert.equal(efter.length, 1, `B: ét tal efter skuddet (${JSON.stringify(efter)})`);
  assert.equal(efter[0].tal, hp0.get(b.id) - b.hp, 'hele kædens skade');
  // Til sidst: hvert tabt point er vist én gang, tallet står på hp, og hvert tal slog én gang.
  for (const x of v.baevere) {
    const vist = log.tal.filter((t) => t.id === x.id).reduce((s, t) => s + t.tal, 0);
    assert.equal(vist, hp0.get(x.id) - Math.max(0, x.hp), `${x.id}: det talte er det tabte`);
    assert.equal(visHp(spejl.baevere.find((y) => y.id === x.id)), Math.max(0, x.hp), `${x.id}: tallet står på hp`);
  }
  // Skadelyden højst hvert 1,2 s pr. kunde (main.js SKADELYD_MS): ildens tal
  // hvert halve sekund giver ikke en lyd hver gang, men hver kunde med tal lød.
  const lyde = log.lyd.filter((n) => n === 'skade').length;
  const medTal = new Set(log.tal.map((t) => t.id)).size;
  assert.ok(lyde >= medTal && lyde < log.tal.length, `skadelyde ${lyde} for ${log.tal.length} tal (${medTal} kunder)`);
});

/* ------------------------------------------------------------ 4. delta og snapshot */

const DELTA_FELTER = ['e', 'fa', 'h', 'il', 'ks', 'pl', 'pr', 'tick'];
const DELTA_H = ['baever', 'fs', 'ft', 'fv', 'holdIdx', 'lunte', 'retreat', 'tid', 'tilstand', 'vaaben', 'vand', 'vind', 'vj'];

test('deltaen og snapshottet bærer vejledningens ventetid, farerne og ilden', () => {
  const v = aktivVerden({ froe: 23, bane: 'aaben', cfg: { turTicks: 20 * HZ } });
  const opsaet = { froe: 23, banetype: 'aaben', hold: lavHold(2, 2), cfg: net(v.cfg) };
  const spejl = lavVerden(opsaet);
  spejl.genskab(net(v.oejebliksbillede()));
  const b = v.aktivBaever(), fj = v.baevere.find((x) => x.hold !== b.hold);
  v.udfoerKommando({ k: 'handling', h: 'vejledning', aktiv: true }, b.ejer);
  FA.taendIld(v, fj.x, fj.y + 2, 0, kildeFra(b), []);
  v.farePlan.naeste = v.farePlan.aktiv + 30;            // et varsel om et halvt sekund
  let sidstVarsel = false, sidstFare = false, rundtur = null, fulgt = 0;
  const foelg = () => {
    rundtur.w.skridt(); fulgt++;
    const w = rundtur.w;
    assert.equal(w.aftryk(), v.aftryk(), `aftrykket ${fulgt} tick efter rundturen`);
    assert.equal(w.tur.tickTilbage, v.tur.tickTilbage);
    assert.deepEqual(w.tur.vejledningBrugt, v.tur.vejledningBrugt);
    assert.equal(w.rngSim.tilstand(), v.rngSim.tilstand());
  };
  for (let i = 0; i < 12 * HZ; i++) {
    v.skridt();
    if (rundtur) foelg();
    const d = net(v.delta());
    assert.deepEqual(Object.keys(d).sort(), DELTA_FELTER, 'deltaens felter');
    assert.deepEqual(Object.keys(v.delta().h).sort(), DELTA_H, 'deltaens h');
    anvendDelta(spejl, d);
    assert.equal(spejl.tur.vejledningRest, v.vejledningTilbage(), `ventetiden (${i})`);
    assert.equal(spejl.tur.tickTilbage, v.tur.tickTilbage);
    assert.deepEqual(spejl.farer.map((f) => f.id), v.farer.map((f) => f.id));
    for (const f of v.farer) {
      const g = spejl.farer.find((x) => x.id === f.id);
      assert.ok(Math.abs(g.x - f.x) <= 1 / 16 && Math.abs(g.y - f.y) <= 1 / 16 && g.tilst === f.tilst, `fare ${f.id}`);
    }
    assert.deepEqual(spejl.ild.map((p) => p.id), v.ild.map((p) => p.id));
    assert.equal(!!spejl.farePlan.varsel, !!v.farePlan.varsel);
    if (v.farePlan.varsel) assert.equal(spejl.farePlan.varsel.rest, v.farePlan.varsel.rest);
    sidstVarsel ||= !!v.farePlan.varsel; sidstFare ||= v.farer.length > 0;
    // Rundturen: midt i ventetiden, med en fare og ild, på et tick med tom kø.
    if (!rundtur && v.farer.length && v.ild.length && v.vejledningTilbage() > 0 &&
        !v.eksplosionsKoe.length && !v.forsinkede.length && !v.doedskoe.length) {
      const w = lavVerden({ ...opsaet, cfg: net(v.cfg) });
      w.genskab(net(v.oejebliksbillede()));
      rundtur = { w, i };
    }
  }
  assert.ok(sidstVarsel && sidstFare, 'deltaen havde både et varsel og en fare');
  assert.ok(rundtur, 'en rundtur midt i ventetiden og en brand');
  while (fulgt < 600) { v.skridt(); foelg(); }
});

/* ------------------------------------------------------------ 5. pilens to trin */

/** En DOM, der tæller skrivninger og layoutlæsninger (vinduets mål,
 *  renderens tilSkaerm og hindringernes kasser). */
function maaltDom({ W = 1600, H = 900 } = {}) {
  const t = { skriv: 0, laes: 0 };
  const element = (tag = 'div') => {
    const k = new Set(), under = new Map();
    let tekst = '';
    const e = {
      tag, boern: [], attr: {},
      style: new Proxy({}, { set(o, n, x) { t.skriv++; o[n] = x; return true; } }),
      classList: {
        contains: (c) => k.has(c),
        add: (...c) => c.forEach((x) => { if (!k.has(x)) { t.skriv++; k.add(x); } }),
        remove: (...c) => c.forEach((x) => { if (k.has(x)) { t.skriv++; k.delete(x); } }),
        toggle(c, v) { const skal = v === undefined ? !k.has(c) : !!v; if (skal !== k.has(c)) { t.skriv++; if (skal) k.add(c); else k.delete(c); } return skal; },
      },
      get className() { return [...k].join(' '); },
      set className(v) { t.skriv++; k.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => k.add(c)); },
      get textContent() { return tekst; },
      set textContent(v) { t.skriv++; tekst = String(v); },
      set innerHTML(v) {
        t.skriv++; under.clear();
        for (const m of v.matchAll(/<(\w+) class="([^"]+)"/g)) {
          const u = element(m[1]); m[2].split(' ').forEach((c) => u.classList.add(c));
          for (const c of m[2].split(' ')) if (!under.has('.' + c)) under.set('.' + c, u);
        }
        under.set('.fp-ikon use', element('use'));
      },
      querySelector: (q) => under.get(q) || null,
      setAttribute(n, x) { t.skriv++; e.attr[n] = x; },
      appendChild(c) { t.skriv++; e.boern.push(c); return c; },
      remove() {},
    };
    return e;
  };
  const rodStil = { '--ui': '1', '--bund-h': '160px' };
  globalThis.document = { createElement: element, documentElement: { style: { getPropertyValue: (n) => rodStil[n] || '' } } };
  globalThis.window = { get innerWidth() { t.laes++; return W; }, get innerHeight() { t.laes++; return H; } };
  const lager = new Map();
  globalThis.localStorage = { getItem: (n) => (lager.has(n) ? lager.get(n) : null), setItem: (n, x) => lager.set(n, String(x)) };
  return { t, rod: element(), element };
}
/** En hindring (et HUD-felt) med en kasse i px. */
function hindring(t, left, top, right, bottom, klasse = '') {
  const k = new Set(klasse.split(' ').filter(Boolean));
  return {
    classList: { contains: (c) => k.has(c), add: (c) => k.add(c), remove: (c) => k.delete(c) },
    getBoundingClientRect() { if (t) t.laes++; return { left, top, right, bottom, width: right - left, height: bottom - top }; },
  };
}

test('farernes pil og skilt: regnet før HUD\'en (kun læsninger), skrevet efter (kun skrivninger)', () => {
  const dom = maaltDom();
  const v = aktivVerden({ froe: 11, bane: 'aaben', cfg: { turTicks: 30 * HZ } });
  const opsaet = { froe: 11, banetype: 'aaben', hold: lavHold(2, 2), cfg: net(v.cfg) };
  const spejl = lavVerden(opsaet);
  spejl.genskab(net(v.oejebliksbillede()));
  const bus = lavBus();
  const r = falskRenderer({ cx: v.aktivBaever().x, cy: v.aktivBaever().y + 60 });
  const tilSkaerm = r.tilSkaerm;
  r.tilSkaerm = (x, y) => { dom.t.laes++; return tilSkaerm(x, y); };
  const S = { verden: spejl, tilstand: 'spil', skudId: null };
  const ui = kobFarer({ bus, hud: falskHud(), lyd: falskLyd(), visning: { fx: falskFx(), farer: null, kamera: falskKamera() },
                        S, r, rod: dom.rod, hindringer: [hindring(dom.t, 1368, 96, 1584, 400)] });
  // En Kabelsalat midt på banen; kameraet panorerer hen til den, så først
  // pilen i kanten og så navneskiltet flytter sig hver frame.
  const p = frieSteder(v, 300).sort((a, b) => Math.abs(a.x - 2560) - Math.abs(b.x - 2560))[0];
  kabelsalatPaaJorden(v, p.x, p.y);
  bus.send('fareKommer', { navn: 'fareKommer', id: v.farer[0].id, slags: 'kabelsalat', hud: 'kabelsalat', x: p.x, y: p.y, ret: 1 });
  const skilt = dom.rod.boern[0].querySelector('.fare-skilt'), pil = dom.rod.boern[0].querySelector('.fare-pil');
  let laestFoer = 0, skrevetEfter = 0, sete = { pil: 0, skilt: 0 };
  for (let i = 0; i < 4 * HZ; i++) {
    for (const e of v.skridt()) bus.send(e.navn, net(e));
    anvendDelta(spejl, net(v.delta()));
    r.kamera.position.x += (p.x - r.kamera.position.x) * 0.02;       // mod faren og forbi
    dom.t.skriv = 0; dom.t.laes = 0;
    ui.opdater(spejl, false);                           // main.js: før HUD'en
    assert.equal(dom.t.skriv, 0, `regnetrinnet skriver intet (${i})`);
    laestFoer += dom.t.laes;
    dom.t.laes = 0;                                     // ... HUD'en læser og skriver ...
    ui.skriv();                                         // main.js: efter HUD'en
    assert.equal(dom.t.laes, 0, `skrivetrinnet læser intet (${i})`);
    skrevetEfter += dom.t.skriv;
    sete.pil += pil.classList.contains('hide') ? 0 : 1;
    sete.skilt += skilt.classList.contains('hide') ? 0 : 1;
  }
  assert.equal(spejl.farer.length, 1, 'faren er her stadig');
  assert.ok(sete.pil > 0 && sete.skilt > 0, `både pilen og skiltet var fremme (${JSON.stringify(sete)})`);
  assert.ok(laestFoer > 0 && skrevetEfter > 0, `testen flytter noget (${laestFoer} læsninger, ${skrevetEfter} skrivninger)`);
  // Og uden flaget gør opdater begge dele (som testene og før).
  dom.t.skriv = 0;
  r.kamera.position.x -= 300;
  ui.opdater(spejl);
  assert.ok(dom.t.skriv > 0, 'opdater(v) skriver selv');
});

test('main.js: farernes regnetrin før HUD\'en, skrivetrinnet lige efter', () => {
  const i = MAIN.indexOf('function opdaterVisning(');
  const j = MAIN.indexOf('\n}\n', i);
  const krop = MAIN.slice(i, j);
  const regn = krop.indexOf('S.fareUi?.opdater(v, false);');
  const hud = krop.indexOf('hud.opdater(v,');
  const skriv = krop.indexOf('S.fareUi?.skriv();');
  assert.ok(regn > 0 && hud > regn && skriv > hud, `rækkefølgen (${regn}, ${hud}, ${skriv})`);
  assert.match(krop.slice(hud), /^hud\.opdater\([^;]*\);\s*S\.fareUi\?\.skriv\(\);/, 'skrivetrinnet lige efter HUD\'en');
  assert.equal((MAIN.match(/S\.fareUi\?\.opdater\(/g) || []).length, 1, 'kun ét kald til opdater');
  // Hindringerne: holdlisten, arsenalets håndtag og vejledningens kort.
  assert.match(MAIN, /hindringer: \[hud\.el\.hold, hud\.el\.arsenal, hjaelpRod\.querySelector\('#hjBoble'\)\]/);
});

/* ------------------------------------------------------------ referencesporet */

test('farer_lav_spor.mjs optager ikke referencesporet igen, når testløberen kører den', () => {
  // `node --test test/farer_*.mjs` kører den som hovedskript med NODE_TEST_CONTEXT
  // sat. Så skrev den test/farer_fra_spor.json, mens farer_determinisme læste den.
  const fil = fileURLToPath(new URL('./farer_fra_spor.json', import.meta.url));
  const foer = { tid: statSync(fil).mtimeMs, indhold: readFileSync(fil, 'utf8') };
  const res = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('./farer_lav_spor.mjs', import.meta.url))],
                        { env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }, encoding: 'utf8', timeout: 60000 });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statSync(fil).mtimeMs, foer.tid, 'filen er ikke skrevet');
  assert.equal(readFileSync(fil, 'utf8'), foer.indhold);
  assert.doesNotMatch(res.stdout, /skrev|prøver/, 'og intet er regnet');
});

/* ------------------------------------------------------------ 6. hindringerne */

test('kantpilen går uden om holdlisten, arsenalets håndtag og vejledningens kort', () => {
  // Skærmen 1600 x 900, --ui 1, --bund-h 160: det frie felt er x 44-1556, y 104-720.
  const holdliste = hindring(null, 1368, 96, 1584, 400);
  const arsenal = hindring(null, 0, 380, 40, 520);
  const kort = hindring(null, 520, 610, 1080, 726);
  const KANT = 44;
  const lav = (hindringer) => {
    const d = falskDom();
    const v = { farer: [], ild: [], farePlan: { varsel: null }, vandNiveau: 300, baevere: [], tur: { tilstand: T.SPILLER_AKTIV, turNr: 3 },
                aktivBaever: () => null };
    const S = { verden: v, tilstand: 'spil', skudId: null };
    const r = falskRenderer({ cx: 1000, cy: 650 });
    const ui = kobFarer({ bus: lavBus(), hud: falskHud(), lyd: falskLyd(), visning: { fx: falskFx(), farer: null, kamera: falskKamera() },
                          S, r, rod: d.rod, hindringer });
    const pil = d.rod.boern[0].querySelector('.fare-pil'), skilt = d.rod.boern[0].querySelector('.fare-skilt');
    return { v, ui, r, pil, skilt };
  };
  const pilXY = (pil) => {
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(pil.style.transform);
    return { x: +m[1], y: +m[2] };
  };
  // Skærmpunkt -> verden (kameraet i (1000, 650), 1000 x 460 wu på 1600 x 900 px).
  const verden = (sx, sy) => ({ x: 500 + (sx / 1600) * 1000, y: 880 - (sy / 900) * 460 });
  const inde = (q, x, y, m) => x > q.left - m && x < q.right + m && y > q.top - m && y < q.bottom + m;
  const kasser = [holdliste, arsenal, kort].map((q) => q.getBoundingClientRect());
  const cx = (44 + 1556) / 2, cy = (104 + 720) / 2;
  const med = lav([holdliste, arsenal, kort]), uden = lav([]);
  let flyttet = 0;
  for (let grad = 0; grad < 360; grad += 3) {
    const a = (grad * Math.PI) / 180;
    // Et varsel langt uden for billedet i retningen a (set fra feltets midte).
    const w = verden(cx + Math.cos(a) * 4000, cy + Math.sin(a) * 4000);
    for (const u of [med, uden]) {
      u.v.farePlan.varsel = { slags: 'kabelsalat', hud: 'kabelsalat', x: w.x, y: w.y - 15, ret: 1, rest: 120 };
      u.ui.opdater(u.v);
    }
    const p = pilXY(med.pil), q = pilXY(uden.pil);
    for (const k of kasser) assert.ok(!inde(k, p.x, p.y, KANT - 2), `${grad}°: pilen (${p.x}, ${p.y}) er under et HUD-felt`);
    // Stadig på linjen fra midten ud mod stedet.
    const fejl = Math.abs(Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
    assert.ok(Math.min(fejl, 2 * Math.PI - fejl) < 0.02, `${grad}°: pilen peger samme vej`);
    // Og som før, hvor intet er i vejen.
    if (!kasser.some((k) => inde(k, q.x, q.y, KANT))) assert.deepEqual(p, q, `${grad}°: uændret uden en hindring`);
    else flyttet++;
  }
  assert.ok(flyttet >= 10, `pilen blev flyttet i ${flyttet} retninger`);
  // Et skjult felt (kortet efter vejledningen, arsenalet uden for ens tur) tæller ikke.
  kort.classList.add('hide'); arsenal.classList.add('skjult');
  for (const grad of [90, 180]) {
    const a = (grad * Math.PI) / 180, w = verden(cx + Math.cos(a) * 4000, cy + Math.sin(a) * 4000);
    for (const u of [med, uden]) { u.v.farePlan.varsel = { slags: 'drone', hud: 'pakkedrone', x: w.x, y: w.y - 21, ret: 1, rest: 120 }; u.ui.opdater(u.v); }
    assert.deepEqual(pilXY(med.pil), pilXY(uden.pil), `${grad}°: skjulte felter er ikke i vejen`);
  }
  kort.classList.remove('hide');
  // En fare i billedet, men under kortet: ingen navneskilt der, men en pil ved kortets kant.
  const under = verden(800, 680);
  med.v.farePlan.varsel = null;
  med.v.farer = [{ id: 4, slags: 'kabelsalat', hud: 'kabelsalat', x: under.x, y: under.y - 15, r: 14, hy: 15, tilst: 'jord', ret: 1, brand: 0, styrt: 0 }];
  med.ui.opdater(med.v);
  assert.ok(!med.pil.classList.contains('hide'), 'pilen viser, hvor faren er');
  const p = pilXY(med.pil);
  assert.ok(!inde(kasser[2], p.x, p.y, KANT - 2) && p.y < 610, `over kortet (${p.x}, ${p.y})`);
  assert.ok(med.skilt.classList.contains('hide'), 'intet skilt under kortet');
});
