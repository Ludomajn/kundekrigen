/* Kundekrigen — fælles hjælpere til farer_*.mjs (ikke en test).
 *
 * En rigtig verden (sim/world.js) som i kamera_determinisme.mjs, sat ind i
 * spillerens tur, og en bot, der skyder hver tur.
 */
import { lavVerden, T, K, VAABEN } from '../static/js/sim/world.js';
import * as FA from '../static/js/sim/farer.js';
import { lavHold } from './kort_hjaelp.mjs';
import { mundingsPunkt } from '../static/js/sim/behaviours.js';

export { T, K, VAABEN, FA, lavHold };

export const BANER = ['aaben', 'oeer', 'hule', 'fort'];

/** En startet kamp (filmen sprunget over). */
export function lavTestVerden({ froe = 7, bane = 'aaben', hold = [2, 2], cfg = {} } = {}) {
  const v = lavVerden({ froe, banetype: bane, hold: lavHold(hold[0], hold[1]),
                        cfg: { banetype: bane, turTicks: 1500, kampTicks: 43200, ...cfg } });
  v.startKamp();
  if (v.tur.tilstand === T.FILM) v.udfoerKommando({ k: 'film' });
  return v;
}

/** Kør n tick (eller til stop(v, h) er sand). Returnerer alle hændelser med tick. */
export function koer(v, n, { stop = null, hvert = null } = {}) {
  const alle = [];
  for (let i = 0; i < n; i++) {
    if (hvert) hvert(v);
    const h = v.skridt();
    for (const e of h) alle.push({ tick: v.tick, ...e });
    if (stop && stop(v, h)) break;
  }
  return alle;
}

/** Til den første tur, hvor spilleren har kunden (SPILLER_AKTIV). */
export function tilAktiv(v, loft = 4000) {
  return koer(v, loft, { stop: (vv) => vv.tur.tilstand === T.SPILLER_AKTIV });
}

/** En verden i spillerens tur med et langt tur-ur: farerne kører. Ingen
 *  planlægger (cfg.farer er de nævnte, planen skubbes langt ud), så testen
 *  selv sætter farer ind med FA.tving. */
export function aktivVerden(o = {}) {
  const v = lavTestVerden({ ...o, cfg: { turTicks: 60 * 60 * 30, haendelseChance: 0, kasseChance: 0, ...(o.cfg || {}) } });
  tilAktiv(v);
  v.farePlan.naeste = 1e9;           // planlæggeren venter (intet træk)
  return v;
}

/** Den aktive kunde affyrer det valgte våben nu (til næste tick). */
export function affyr(v, vaaben, { vinkel = null, kraft = 0.6, retning = null } = {}) {
  const b = v.aktivBaever();
  if (vinkel != null) b.vinkel = vinkel;
  if (retning != null) b.retning = retning;
  v.udfoerKommando({ k: 'handling', h: 'vaelgVaaben', id: vaaben }, b.ejer);
  v.udfoerKommando({ k: 'handling', h: 'affyr', kraft }, b.ejer);
}

/** Udstyrspladser mindst `fra` wu fra alle levende kunder. */
export function frieSteder(v, fra = 300) {
  return v._udstyrsPladser().filter((p) => v.baevere.every((b) => b.doed || Math.hypot(b.x - p.x, b.y - p.y) >= fra));
}

/** Tæl træk fra rngSim (erstatter funktionen, men bevarer tilstanden). */
export function taelTraek(v) {
  const orig = v.rngSim;
  const f = function () { f.n++; return orig(); };
  Object.assign(f, orig);
  f.n = 0;
  v.rngSim = f;
  return f;
}

/** Sigt kunden b's våben (fra mundingen) på (x, y). Returnerer vinklen. */
export function sigtPaa(b, x, y) {
  b.retning = x >= b.x ? 1 : -1;
  let vinkel = 0;
  for (let i = 0; i < 20; i++) {
    b.vinkel = vinkel;
    const m = mundingsPunkt(b);
    vinkel = Math.atan2(y - m.y, Math.abs(x - m.x));
  }
  b.vinkel = vinkel;
  return vinkel;
}

/** Frit syn fra b's munding til (x, y) (sigter samtidig på det). */
export function fritSyn(v, b, x, y) {
  sigtPaa(b, x, y);
  const m = mundingsPunkt(b);
  return !v.terraen.straale(m.x, m.y, m.dx, m.dy, Math.hypot(x - m.x, y - m.y), 2);
}

/** Jorden (fodpunktet) under x, søgt fra y + over. */
export const jordVed = (v, x, y, over = 80) => v.terraen.jordUnder(Math.round(x), Math.round(y) + over);

/** Et fladt stykke jord (±bredde) langt fra kunderne og banens ting, eller null. */
export function fladPlads(v, fra = 350, bredde = 60) {
  for (const p of frieSteder(v, fra)) {
    if ([...v.placerede, ...v.kasser].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 160)) continue;
    const g = [-1, -0.5, 0, 0.5, 1].map((k) => jordVed(v, p.x + k * bredde, p.y, 40));
    if (g.every((y) => Math.abs(y - p.y) < 12 && y > v.vandNiveau + 40) && !v.terraen.fast(p.x, p.y + 60)) return p;
  }
  return null;
}

const BOT_VAABEN = ['grenroer', 'egegranat', 'splintboesse', 'koglebombe', 'grenroer', 'halesmaek'];

/** En bot, der KUN styrer med kommandoer (som test/farer_lav_spor.mjs) og
 *  kun læser turens ur — to verdener i samme tilstand får samme input. */
export function botTick(v) {
  if (v.tur.tilstand === T.FILM) { v.udfoerKommando({ k: 'film' }); return; }
  if (v.tur.tilstand !== T.SPILLER_AKTIV) return;
  const pid = v.aktivBaever()?.ejer;
  const tt = v.tur.tilstandTick, n = v.tur.turNr;
  if (tt === 3) v.udfoerKommando({ k: 'handling', h: 'vaelgVaaben', id: BOT_VAABEN[n % BOT_VAABEN.length] }, pid);
  if (tt === 5) v.udfoerKommando({ k: 'hold', b: n % 2 ? K.SIGT_OP : K.SIGT_NED }, pid);
  if (tt === 5 + (n * 7) % 40) v.udfoerKommando({ k: 'hold', b: 0 }, pid);
  if (tt === 50 && n % 3 === 0) v.udfoerKommando({ k: 'hold', b: n % 2 ? K.VENSTRE : K.HOEJRE }, pid);
  if (tt === 80) v.udfoerKommando({ k: 'hold', b: 0 }, pid);
  if (tt === 90 || tt === 140) v.udfoerKommando({ k: 'handling', h: 'affyr', kraft: 0.35 + (n % 6) / 10 }, pid);
}

/** Farerne tættere: pausen til den næste kortes ned til 15 s aktiv tid. */
export const hurtigeFarer = (v) => {
  const P = v.farePlan;
  if (P.naeste != null && P.naeste - P.aktiv > 900) P.naeste = P.aktiv + 900;
};

/** En Kabelsalat, der står på jorden ved x (uden indgangsfald). */
export function kabelsalatPaaJorden(v, x, y, ekstra = {}) {
  const g = jordVed(v, x, y);
  return FA.tving(v, 'kabelsalat', { x, y: g, ret: 1 }, [], { tilst: 'jord', luft: 0, y: g, ...ekstra });
}

/** Sæt faren i brand nu, som scanneren ville (kilde: den aktive kunde). */
export function antaend(v, f) {
  const r = FA.ramt(f);
  r.straale = true;
  const b = v.aktivBaever();
  FA.saetKilde(r, { kaede: 0, kaedeId: -v.tick, kildeHold: b?.hold ?? 0, kildeBaever: b?.id ?? null });
}

/** En printer eller mine, som banen lægger dem (ejer null). */
export function laegPlaceret(v, sprite, x, y) {
  const g = jordVed(v, x, y);
  const p = { id: v.nytId(), type: 'placeret', x, y: g + 2, vx: 0, vy: 0, r: 5, lunte: 0,
              naerhed: sprite === 'mine' ? VAABEN.baevermine.placeret.naerhed : 0, armering: 0,
              detonation: sprite === 'mine' ? { radius: 52, skade: 42, knockback: 240, carve: true }
                : { radius: 96, skade: 62, knockback: 380, carve: true },
              ejer: null, ejerHold: null, sprite, paaJorden: true, alder: 0 };
  v.placerede.push(p);
  return p;
}

const VAABEN_RAEKKE = ['grenroer', 'egegranat', 'splintboesse', 'koglebombe', 'grenroer', 'halesmaek', 'splintboesse'];

/**
 * En skriptet kamp: hver tur vælger kunden et våben, sigter lidt og skyder
 * (to gange med scanneren). Returnerer tællere og hændelser, der fortæller,
 * om farerne nogensinde holdt turen åben til vagthunden.
 */
export function skriptetKamp({ froe, bane, hold = [3, 3], ticks = 36000, cfg = {}, efter = null, foerTick = null }) {
  const v = lavTestVerden({ froe, bane, hold, cfg });
  const res = { tvungne: 0, tvungneFarer: 0, farer: 0, braende: 0, ild: 0, maxOpl: 0, varsler: 0,
                maxIld: 0, maxFarer: 0, haendelser: {}, v };
  let sidstFareUro = -1e9;
  for (let i = 0; i < ticks && v.tur.tilstand !== T.SEJR; i++) {
    if (v.tur.tilstand === T.FILM) v.udfoerKommando({ k: 'film' });
    if (v.tur.tilstand === T.SPILLER_AKTIV) {
      const b = v.aktivBaever(), pid = b?.ejer;
      const tt = v.tur.tilstandTick, n = v.tur.turNr;
      // Er der en fare på banen, går kunden efter den med scanneren, når den
      // kan se den (og skyder først bagefter som ellers).
      const f = v.farer[0] || null;
      const skudTick = (f ? 620 : 60) + (n * 37) % 400;
      if (f && b && tt >= 40 && tt < 600 && tt % 10 === 0 && !res.sigtet?.[n] &&
          v.ammoFor(b.hold, 'splintboesse') !== 0 && Math.hypot(f.x - b.x, f.y - b.y) < 1000 &&
          fritSyn(v, b, f.x, f.y + f.hy)) {
        (res.sigtet ||= {})[n] = true;
        v.udfoerKommando({ k: 'handling', h: 'vaelgVaaben', id: 'splintboesse' }, pid);
        v.udfoerKommando({ k: 'handling', h: 'affyr', kraft: 1 }, pid);
        res.skudPaaFare = (res.skudPaaFare || 0) + 1;
      } else if (tt === 3) v.udfoerKommando({ k: 'handling', h: 'vaelgVaaben', id: VAABEN_RAEKKE[(n + froe) % VAABEN_RAEKKE.length] }, pid);
      if (tt === 5) v.udfoerKommando({ k: 'hold', b: n % 2 ? K.SIGT_OP : K.SIGT_NED }, pid);
      if (tt === 5 + (n * 7) % 40) v.udfoerKommando({ k: 'hold', b: 0 }, pid);
      if (tt === skudTick || tt === skudTick + 20) {
        v.udfoerKommando({ k: 'handling', h: 'affyr', kraft: 0.3 + ((n + froe) % 7) / 10 }, pid);
      }
    }
    // Holdt en fare, ild eller en tændt lunte turen åben for nylig?
    if (v.farer.some((f) => f.uro > 0) || v.ild.some((p) => p.truer) || v.placerede.some((p) => p.lunte > 0)) sidstFareUro = v.tick;
    if (foerTick) foerTick(v);
    const foer = efter && { farer: new Map(v.farer.map((f) => [f.id, [f.x, f.y, f.alder]])),
                            ild: new Map(v.ild.map((p) => [p.id, p.alder])), aktiv: v.farePlan.aktiv };
    const h = v.skridt();
    if (efter) efter(v, h, foer);
    if (v.tur.tilstand === T.OPLOESNING) res.maxOpl = Math.max(res.maxOpl, v.tur.oploesningTick);
    res.maxIld = Math.max(res.maxIld, v.ild.length);
    res.maxFarer = Math.max(res.maxFarer, v.farer.length);
    for (const e of h) {
      res.haendelser[e.navn] = (res.haendelser[e.navn] || 0) + 1;
      if (e.navn === 'tvungenRo') { res.tvungne++; if (v.tick - sidstFareUro < 30) res.tvungneFarer++; }
      if (e.navn === 'fareKommer') res.farer++;
      if (e.navn === 'fareVarsel') res.varsler++;
      if (e.navn === 'fareAntaendt') res.braende++;
      if (e.navn === 'ildTaendt') res.ild++;
    }
  }
  res.tick = v.tick;
  res.aftryk = v.aftryk();
  return res;
}
