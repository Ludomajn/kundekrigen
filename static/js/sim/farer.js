/* Kundekrigen — farer i realtid: Kabelsalaten (Nullermanden i grotten),
 * Pakkedronen, Robotstøvsugeren og ild.
 *
 * Farerne kommer midt i kampen, uafhængigt af tururet, som ren RNG. Men
 * udfaldet kræver dygtighed: INGEN FARE SKADER AF SIG SELV. Al skade starter
 * med et skud, et brag eller ild, og en kæde (skud → brand → brag → printer)
 * er skyttens "sygt play". Reglerne og tuningtabellen står i docs/farer.md.
 *
 *   1. rngSim bruges kun i planlæggeren, og kun når en fare varsles: pausen
 *      til den næste, slags, sted og side eller last — højst 4 træk pr. fare.
 *      En udsættelse trækker intet.
 *   2. Ingen fare skader af sig selv.
 *   3. Konsekvenserne går ad de almindelige veje: brag i eksplosionskøen,
 *      skub, en pakke der falder.
 *   4. Alt er begrænset: 1 fare ad gangen, 40 ildpletter, hver ting antændes
 *      og springer højst én gang, 2 generationer spredning, dybde 5.
 *
 * Farerne og ilden kører KUN i aktiv tid (SPILLER_AKTIV, AFFYRING og
 * OPLOESNING); ellers står de stille. Uroen er tre adskilte ure pr. fare
 * (brand, luft, styrt), og ild, der stadig kan sprede sig hen til en utændt
 * printer eller mine, "truer". erIRo (turn.js) venter på dem, så hele kæden
 * afvikles i skyttens egen tur, og intet kan holde turen åben for evigt.
 *
 * Farerne er aldrig projektiler og ligger aldrig i forsinkede. Alt er ren
 * data i v.farer, v.ild og v.farePlan og følger med i snapshottet.
 *
 * Hovedløs: ingen three.js, ingen DOM, ingen Math.random, ingen Date.
 */
'use strict';

import { HZ, DT } from '../core/tick.js';
import { klem } from '../core/math.js';
import { BAEVER_R, afstandTilHitbox, lavKasse } from './entities.js';
import * as F from './physics.js';
import { JORD } from './terrain.js';
import { tilfaeldigtKassevaaben, kasseAntal } from './weapons.js';
import { givSkade, kildeFelter } from './damage.js';
import { T } from './turn.js';

// ---------------------------------------------------------------- planlæggeren

export const FARE_FRA_RUNDE = 2;              // første fare tidligst i runde 2
export const FARE_FOERSTE_S = [30, 70];       // aktiv tid til den første (s)
export const FARE_PAUSE_S = [80, 160];        // og mellem de næste (s)
export const FARE_MAKS = 1;                   // farer på banen ad gangen
export const FARE_VARSEL = 180;               // tick med kantpil, før den kommer
export const FARE_UDSAET = 300;               // intet sted: prøv igen om (tick), uden træk
export const KS_AFSTAND = 250;                // Kabelsalatens plads fra levende kunder
export const RS_AFSTAND = 300;                // og støvsugerens

// ---------------------------------------------------------------- uro og træf

export const FARE_LUFT_URO = 180;             // luft-uret ved indgang i luften og ved skub
export const BRAND_URO_EKSTRA = 10;           // brand-uroen er brand + dette
export const DR_STYRT_URO = 240;              // styrt-uret på en nedskudt drone
export const FARE_STRAALE_TOL = 12;           // hitscan mod farer rammer så meget bredere
export const FARE_SKYTTE_PAUSE = 8;           // tick et skud går gennem en fare over skytten
export const FARE_FRIGOER = 2, FARE_FRIGOER_N = 40;   // begravet: løft 2 wu, højst 40 gange

// ---------------------------------------------------------------- Kabelsalaten

export const KS_R = 14, KS_LIV = 50 * HZ;
export const KS_VIND = 240, KS_MAKS = 150, KS_MIN = 24, KS_TRAEG = 0.04;
export const KS_RET_HYST = 0.05;              // |vindNu| herover vender rulleretningen
export const KS_TRIN_OP = 8, KS_TRIN_NED = 10;
export const KS_TYNGDE = 0.55, KS_FLYD = 0.5;
export const KS_FLYD_DYB = 8;                 // flyder med fodpunktet så dybt i vandet
export const KS_KYST = 8;                     // kravler i land på en kyst højst så højt over vandet
export const KS_VAEG_HOP = 260, KS_PRELL = -0.3;
export const KS_STOED_VY = 300, KS_STOED_VX = 80, KS_STOED_MAKS = 2;
export const KS_FAST_TICK = 150, KS_FAST_WU = 12;   // under 12 wu fremdrift på 150 tick: sidder fast
export const KS_SKUB = 1.6, KS_KLASK_VX = 240, KS_KLASK_VY = 160;
export const KS_BRAND = 120, KS_BRAND_FART = 1.3, KS_DRYP = 20;
export const KS_FLAMMEBRAG = { radius: 44, skade: 22, knockback: 150, carve: false };
export const KS_RING = [-48, -24, 0, 24, 48];       // flammebragets pletter (gen 0)
export const KS_FALD = 200, KS_LOFT_AFSTAND = 34, KS_START_VX = 60;
export const FARE_KANT = 40;                  // så langt ude over kanten er den væk

// ---------------------------------------------------------------- Pakkedronen

export const DR_R = 20, DR_FART = 110, DR_HOEJDE = 200;
export const DR_OP = 120, DR_NED = 40, DR_LOFT = 60;
export const DR_MAAL_HVER = 8, DR_PROEVER = 9, DR_FREM = 720;
export const DR_IND = 60, DR_UD = 80;         // kommer ind ved x −60 / w+60, væk ved −80 / w+80
export const DR_TYNGDE = 480, DR_STYRT_VX = 0.6;
export const DR_BRAG = { radius: 38, skade: 24, knockback: 180, carve: true };
export const DR_LIV = 70 * HZ;                // værn: en drone, der aldrig når kanten
export const PAKKE_TRIN = 1;                  // pakkens fald fejes i trin på 1 wu

// ---------------------------------------------------------------- Robotstøvsugeren

export const RS_R = 14, RS_HY = 7;
export const RS_KLIPPE = 24, RS_KUNDE = 22;
export const RS_SPAM = 2, RS_SPAM_R = 12, RS_SPAM_SKADE = 15;
export const RS_SPIS_DX = 18, RS_SPIS_DY = 16;
export const RS_OVERHED = 90;
export const RS_BATTERI = { radius: 50, skade: 30, knockback: 220, carve: true };
export const RS_OPDATERING = 300, RS_LIV = 60 * HZ, RS_SKUB = 0.8;

// ---------------------------------------------------------------- ild

export const ILD_CELLE = 24, ILD_MAKS = 40;
export const ILD_LIV = 240, ILD_SPRED_ALDER = 45, ILD_GEN = 2;
export const ILD_STILLE = 0.15;               // |vindNu| herunder spreder ilden sig begge veje
export const ILD_R = 12, ILD_PLAC_R = 20, ILD_FALD_MAKS = 40, ILD_FARE_R = 13;
export const ILD_TAKT = 30, ILD_SKADE = 4, ILD_LOFT = 24;
export const ILD_START_PAUSE = ILD_TAKT;      // den aktive kunde når at gå ud af ilden
export const ILD_TRUER_DY = 40;
export const ILD_LUNTE = { toende: 90, mine: 30 };
export const ILD_NY_BRAND = 80;               // 'ildTaendt' kun uden en plet så tæt på
export const STORM_ILD_AFSTAND = 76;          // shitstormens og spammens miner holder sig så langt fra ild

export const KAEDE_MAKS = 5;                  // dybden for antændelser (farer og lunter fra ild)

// ---------------------------------------------------------------- tabellerne

/** De tre farer i fast rækkefølge (lodtrækningen afhænger af den). */
export const SLAGS = ['kabelsalat', 'drone', 'stoevsuger'];

/** Navn, træfcirkel (r, og hy: midtens højde over fodpunktet) og grafik
 *  (static/grafik/objekter/<hud>.webp; Kabelsalaten hedder Nullermanden i grotten). */
export const FARE_INFO = {
  kabelsalat: { navn: 'Kabelsalaten', navnHule: 'Nullermanden', r: KS_R, hy: KS_R + 1, hud: 'kabelsalat', hudHule: 'nullermand' },
  drone: { navn: 'Pakkedronen', r: DR_R, hy: DR_R + 1, hud: 'pakkedrone' },
  stoevsuger: { navn: 'Robotstøvsugeren', r: RS_R, hy: RS_HY, hud: 'robotstoevsuger' },
};

/** Lodtrækningsvægt pr. banetype. 0: kommer aldrig på den bane. */
export const FARE_VAEGT = {
  kabelsalat: { aaben: 5, oeer: 5, hule: 4, fort: 1 },
  drone: { aaben: 3, oeer: 4, hule: 0, fort: 5 },
  stoevsuger: { aaben: 2, oeer: 1, hule: 4, fort: 3 },
};

/** Farens tilstand som tal i deltaen (snapshot.js) og tilbage. */
export const TILST = { jord: 0, luft: 1, vand: 2, flyv: 3, styrt: 4, koer: 5, pause: 6 };
export const TILST_NAVN = Object.keys(TILST);

const AKTIV = new Set([T.SPILLER_AKTIV, T.AFFYRING, T.OPLOESNING]);

/** Kører farerne og ilden lige nu? Kun i aktiv tid. */
export const erAktiv = (v) => AKTIV.has(v.tur.tilstand);

export function nyPlan() {
  return { aktiv: 0, naeste: null, varsel: null, antal: 0, sidste: null };
}

/** Rigtige kopier til snapshottet og genskab (ingen deling med værten). */
export const kopierFare = (f) => ({ ...f, ramt: f.ramt ? { ...f.ramt } : null });
export const kopierPlan = (p) => (p ? { ...nyPlan(), ...p, varsel: p.varsel ? { ...p.varsel } : null } : nyPlan());

/** Hvilken grafik en fare af slags har på banetypen. */
export const hudFor = (slags, banetype) =>
  (banetype === 'hule' && FARE_INFO[slags]?.hudHule) || FARE_INFO[slags]?.hud || slags;

/** Tick en ildplet har tilbage (regn og slud halverer levetiden). */
export const ildRest = (v, p) => (p.rest !== undefined ? p.rest : Math.max(0, ildLevetid(v, p) - p.alder));

const regnvejr = (v) => v.vejr === 'regn' || v.vejr === 'slud';
const spredningTilladt = (v) => !regnvejr(v) && v.vejr !== 'sne';
const ildLevetid = (v, p) => (regnvejr(v) ? p.liv / 2 : p.liv);
const midteY = (f) => f.y + f.hy;

/** cfg.farer: null/undefined = alle, [] = ingen (og intet træk), ellers kun de nævnte. */
function tilladt(v, slags) {
  const liste = v.cfg?.farer;
  return !Array.isArray(liste) || liste.includes(slags);
}
function harFarer(v) {
  const liste = v.cfg?.farer;
  return !Array.isArray(liste) || liste.length > 0;
}

// ---------------------------------------------------------------- hovedskridtet

/**
 * Ét tick for farerne og ilden. Kaldes fra world.skridt efter _fysik og før
 * tjekDrukning — i alle tilstande, men gør kun noget i aktiv tid. Et f.ramt,
 * der er sat, mens farerne stod stille (printerhændelsen, stenskredet i
 * TUR_START), afvikles ved første aktive tick.
 */
export function skridt(v, h) {
  if (!v.farer || !erAktiv(v)) return;
  planlaeg(v, h);
  for (const f of v.farer) frigoer(v, f);
  for (const f of v.farer) if (f.ramt && !f.vaek) reager(v, f, h);
  for (const f of v.farer) if (!f.vaek) bevaeg(v, f, h);
  kontakter(v, h);
  ildSkridt(v, h);
  ildSkade(v, h);
  for (const f of v.farer) {
    if (f.luft > 0) f.luft--;
    f.uro = Math.max(f.brand > 0 ? f.brand + BRAND_URO_EKSTRA : 0, f.luft, f.styrt | 0);
  }
  let j = 0;
  for (const f of v.farer) if (!f.vaek) v.farer[j++] = f;
  v.farer.length = j;
}

function vaek(f, grund, h) {
  if (f.vaek) return;
  f.vaek = grund;
  f.uro = 0;
  h.push({ navn: 'fareVaek', id: f.id, slags: f.slags, hud: f.hud, x: f.x, y: f.y, grund });
}

// ---------------------------------------------------------------- planlæggeren

/** Pausen til næste fare, trukket nu (ét træk). */
const pause = (v, [lav, hoej]) => Math.round((lav + v.rngSim() * (hoej - lav)) * HZ);

function planlaeg(v, h) {
  const P = v.farePlan;
  if (!P || !harFarer(v)) return;
  // Uret går kun, mens der er plads til en fare mere.
  if (v.farer.length < FARE_MAKS) P.aktiv++;
  if (P.varsel) {
    if (--P.varsel.rest <= 0) kom(v, h);
    return;
  }
  if (v.farer.length >= FARE_MAKS) return;
  if (P.naeste == null) {
    if ((v.tur.runde | 0) < FARE_FRA_RUNDE) return;
    P.naeste = P.aktiv + pause(v, FARE_FOERSTE_S);
    return;
  }
  if (P.aktiv < P.naeste) return;

  // Prøvekørslen uden træk: hvilke farer KAN komme, og hvor?
  const S = steder(v);
  let mulige = SLAGS.filter((s) => tilladt(v, s) && vaegt(v, s) > 0 && S[s].length > 0);
  if (mulige.length > 1) mulige = mulige.filter((s) => s !== P.sidste);
  if (!mulige.length) { P.naeste = P.aktiv + FARE_UDSAET; return; }

  // Varslet: slags, sted og side eller last — ét træk hver.
  let rest = v.rngSim() * mulige.reduce((s, x) => s + vaegt(v, x), 0);
  let slags = mulige[mulige.length - 1];
  for (const s of mulige) { rest -= vaegt(v, s); if (rest < 0) { slags = s; break; } }
  const liste = S[slags];
  const t = v.terraen;
  const vs = { slags, hud: hudFor(slags, v.banetype), x: 0, y: 0, ret: 1, rest: FARE_VARSEL };
  if (slags === 'kabelsalat') {
    const w = v.vindNu();
    vs.ret = Math.abs(w) >= KS_RET_HYST ? (w > 0 ? 1 : -1) : (v.rngSim() < 0.5 ? -1 : 1);
    // Den blæser ind fra vindsiden og ruller HEN OVER banen. En plads ved
    // kanten, den ruller mod, sendte den ud over kanten på få sekunder
    // (set i browseren: x 175, vinden mod venstre). Ingen på vindsiden: alle.
    const vindsiden = liste.filter((p) => (vs.ret > 0 ? p.x < t.w / 2 : p.x > t.w / 2));
    const fra = vindsiden.length ? vindsiden : liste;
    const valgt = fra[Math.floor(v.rngSim() * fra.length)];
    vs.x = valgt.x; vs.y = valgt.y;
  } else if (slags === 'drone') {
    const valgt = liste[Math.floor(v.rngSim() * liste.length)];
    vs.ret = valgt === 'v' ? 1 : -1;
    vs.x = valgt === 'v' ? -DR_IND : t.w + DR_IND;
    vs.y = droneHoejde(v, vs.x, vs.ret);
    vs.pakke = tilfaeldigtKassevaaben(v.rngSim);
  } else {
    const valgt = liste[Math.floor(v.rngSim() * liste.length)];
    vs.x = valgt.x; vs.y = valgt.y;
    vs.ret = valgt.x < t.w / 2 ? 1 : -1;
  }
  P.varsel = vs;
  h.push({ navn: 'fareVarsel', slags, hud: vs.hud, x: vs.x, y: vs.y, ret: vs.ret, rest: vs.rest });
}

const vaegt = (v, s) => FARE_VAEGT[s][v.banetype] ?? FARE_VAEGT[s].aaben;

/** Varslet er slut: faren kommer ind, og pausen til den næste trækkes. */
function kom(v, h) {
  const P = v.farePlan, vs = P.varsel;
  P.varsel = null;
  const f = lavFare(v, vs.slags, vs);
  v.farer.push(f);
  P.antal++;
  P.sidste = vs.slags;
  h.push({ navn: 'fareKommer', id: f.id, slags: f.slags, hud: f.hud, x: f.x, y: f.y, ret: f.ret,
           pakke: f.pakke ?? null });
  P.naeste = P.aktiv + pause(v, FARE_PAUSE_S);
}

/**
 * Prøvekørslen: de gyldige steder pr. slags, deterministisk og UDEN træk fra
 * rngSim. Ét kald til _udstyrsPladser().
 *   kabelsalat  udstyrspladser mindst KS_AFSTAND fra alle levende kunder,
 *               under åben himmel (ikke i grotten, hvor loftet er klippe)
 *   drone       ['v'] eller ['h'] (vindsidens kant), begge i vindstille; []
 *               i grotten, under internetnedbrud og uden plads til en kasse
 *   stoevsuger  naturbaner: de 3 mest neutrale pladser mindst RS_AFSTAND fra
 *               kunderne. Fortet: borgen farePlan.antal % antal borge — har
 *               den ingen gyldige, de næste borge i rækkefølge
 */
export function steder(v) {
  const t = v.terraen, hule = v.banetype === 'hule';
  const levende = v.baevere.filter((b) => !b.doed);
  const S = { kabelsalat: [], drone: [], stoevsuger: [] };
  const pladser = v._udstyrsPladser();
  const naermest = (p) => {
    let d = Infinity;
    for (const b of levende) d = Math.min(d, Math.hypot(b.x - p.x, b.y - p.y));
    return d;
  };
  const afstand = pladser.map(naermest);
  pladser.forEach((p, i) => {
    if (afstand[i] >= KS_AFSTAND && (hule || t.overflade(Math.round(p.x)) <= p.y + 2)) S.kabelsalat.push(p);
  });
  if (!hule && !v.internetNede() && v._ledigeKassepladser() > 0) {
    const w = v.vindNu();
    S.drone = Math.abs(w) < KS_RET_HYST ? ['v', 'h'] : [w > 0 ? 'v' : 'h'];
  }
  if (t.fort) {
    const forter = t.fort.forter;
    for (let i = 0; i < forter.length; i++) {
      const borg = forter[((v.farePlan?.antal | 0) + i) % forter.length];
      const gyldige = borg.udstyr.filter((p) => naermest(p) >= RS_AFSTAND);
      if (gyldige.length) { S.stoevsuger = gyldige; break; }
    }
  } else {
    // Neutral: lige langt til klinikkernes nærmeste kunder (forskellen
    // mellem den nærmeste og den fjerneste klinik er lille).
    const holdene = [...new Set(levende.map((b) => b.hold))].sort((a, b) => a - b);
    const kand = [];
    pladser.forEach((p, i) => {
      if (afstand[i] < RS_AFSTAND) return;
      let lav = Infinity, hoej = 0;
      for (const hid of holdene) {
        let d = Infinity;
        for (const b of levende) if (b.hold === hid) d = Math.min(d, Math.hypot(b.x - p.x, b.y - p.y));
        lav = Math.min(lav, d); hoej = Math.max(hoej, d);
      }
      kand.push({ p, n: holdene.length > 1 ? hoej - lav : 0, i });
    });
    kand.sort((a, b) => a.n - b.n || a.i - b.i);
    S.stoevsuger = kand.slice(0, 3).map((k) => k.p);
  }
  return S;
}

/** Dronens flyvehøjde (fodpunktet) over x: DR_HOEJDE over det højeste i
 *  DR_PROEVER prøver fra 0 til DR_FREM wu frem, mellem vand + DR_HOEJDE og loftet. */
function droneHoejde(v, x, ret) {
  const t = v.terraen;
  let top = v.vandNiveau;
  for (let k = 0; k < DR_PROEVER; k++) {
    const xx = Math.round(x + ret * k * (DR_FREM / (DR_PROEVER - 1)));
    if (xx >= 0 && xx < t.w) top = Math.max(top, t.overflade(xx));
  }
  return klem(top + DR_HOEJDE, v.vandNiveau + DR_HOEJDE, t.h - DR_LOFT - 2 * DR_R);
}

// ---------------------------------------------------------------- entiteterne

function lavFare(v, slags, sted) {
  const info = FARE_INFO[slags];
  const f = {
    id: v.nytId(), type: 'fare', slags, hud: sted.hud || hudFor(slags, v.banetype),
    x: sted.x, y: sted.y, vx: 0, vy: 0, r: info.r, hy: info.hy,
    ret: sted.ret >= 0 ? 1 : -1, tilst: 'jord', alder: 0, liv: 0,
    brand: 0, luft: 0, styrt: 0, uro: 0,
    ramt: null, antaendt: false, vaek: null,
    // Kæden: hvem der satte faren i brand, og hvor dybt (docs/farer.md).
    kaede: 0, kaedeId: null, kildeHold: null, kildeBaever: null,
  };
  const t = v.terraen;
  if (slags === 'kabelsalat') {
    Object.assign(f, { liv: KS_LIV, stille: false, stoed: 0, fremX: f.x, fremTael: 0 });
    // Den blæser ind ovenfra. Under et loft (grotten, et overhæng) dukker den
    // op lige under loftet, ikke inde i klippen over det.
    let y = sted.y + KS_FALD;
    for (let dy = 2; dy <= KS_FALD + 2 * KS_R + KS_LOFT_AFSTAND; dy += 2) {
      if (t.fast(Math.round(f.x), Math.round(sted.y + dy))) { y = sted.y + Math.max(2, dy - KS_LOFT_AFSTAND); break; }
    }
    y = Math.min(y, t.h - 2 * KS_R - 4);
    while (y > sted.y && !rundFri(t, f.x, y, KS_R)) y--;
    f.y = y;
    f.vx = f.ret * KS_START_VX;
    f.tilst = 'luft';
    f.luft = FARE_LUFT_URO;
  } else if (slags === 'drone') {
    Object.assign(f, { liv: DR_LIV, pakke: sted.pakke ?? null, hoejdeMaal: sted.y, tilst: 'flyv' });
    f.vx = f.ret * DR_FART;
  } else {
    Object.assign(f, { liv: RS_LIV, spam: 0, pause: 0, tilst: 'koer',
                       paaJorden: true, faldFra: null, hoppetid: 0, doed: false });
    F.frigoer(t, f);
  }
  return f;
}

/**
 * Til test: sæt en fare ind nu, uden varsel og uden træk. sted er { x, y }
 * (Kabelsalaten: pladsen, den falder ned på) eller for dronen { side:
 * 'v' | 'h', pakke }. ekstra lægges oven på faren (fx { tilst: 'jord' }).
 */
export function tving(v, slags, sted = {}, h = [], ekstra = {}) {
  const s = { ...sted };
  if (slags === 'drone') {
    s.ret = s.ret ?? (s.side === 'h' ? -1 : 1);
    s.x = s.x ?? (s.ret > 0 ? -DR_IND : v.terraen.w + DR_IND);
    s.y = s.y ?? droneHoejde(v, s.x, s.ret);
    s.pakke = s.pakke === undefined ? 'grenroer' : s.pakke;
  }
  s.ret = s.ret ?? 1;
  const f = Object.assign(lavFare(v, slags, s), ekstra);
  v.farer.push(f);
  v.farePlan.antal++;
  v.farePlan.sidste = slags;
  h.push({ navn: 'fareKommer', id: f.id, slags: f.slags, hud: f.hud, x: f.x, y: f.y, ret: f.ret, pakke: f.pakke ?? null });
  return f;
}

// ---------------------------------------------------------------- former

/** Kabelsalatens og dronens cirkel: 32 punkter på randen, 12 på den halve
 *  radius og midten, som heltal (så alle maskiner prøver de samme pixels). */
function lavRing(r) {
  const s = new Set(['0,0']);
  for (let i = 0; i < 32; i++) s.add(`${Math.round(Math.cos(i * Math.PI / 16) * r)},${Math.round(Math.sin(i * Math.PI / 16) * r)}`);
  for (let i = 0; i < 12; i++) s.add(`${Math.round(Math.cos(i * Math.PI / 6) * r / 2)},${Math.round(Math.sin(i * Math.PI / 6) * r / 2)}`);
  return [...s].map((k) => k.split(',').map(Number));
}
const RING = { [KS_R]: lavRing(KS_R), [DR_R]: lavRing(DR_R) };

/** Er cirklen med fodpunktet (x, y) fri? Den fylder rækkerne y+1 til
 *  y+2r+1 — samme regel som kundens kapsel (physics.kapselFri). */
export function rundFri(t, x, y, r) {
  const cy = y + r + 1;
  for (const [ox, oy] of RING[r] || lavRing(r)) if (t.fast(x + ox, cy + oy)) return false;
  return true;
}
const rundPaaJorden = (t, f) => rundFri(t, f.x, f.y, f.r) && !rundFri(t, f.x, f.y - 1, f.r);

/** Begravet af en Papirbunke, en Kabelbakke eller Byggeskum: løft faren 2 wu
 *  ad gangen, højst 40 gange, til den er fri (som physics.frigoer for kunder). */
export function frigoer(v, f) {
  const t = v.terraen;
  if (f.slags === 'stoevsuger') { F.frigoer(t, f); return; }
  if (f.slags === 'drone') return;              // dronen stiger selv (BONK)
  for (let i = 0; i < FARE_FRIGOER_N && !rundFri(t, f.x, f.y, f.r); i++) f.y += FARE_FRIGOER;
}

// ---------------------------------------------------------------- træf

/** Tom træf-post (damage.js og behaviours.js lægger felter til). */
export function ramt(f) {
  return f.ramt || (f.ramt = { antaend: false, straale: false, klask: 0, opdatering: false,
                               skubX: 0, skubY: 0, kaede: 0, kaedeId: null, kildeHold: null, kildeBaever: null,
                               kilde: false });
}
/** Første kilde vinder — den, der ramte først i tick'et. */
export function saetKilde(r, k) {
  if (r.kilde) return;
  r.kilde = true;
  Object.assign(r, kildeFelter(k));
}

/**
 * Rammer projektilet p en fare på vejen fra (x0, y0) til hvor det er nu?
 * Segment mod cirkel. Kun skud, der sprænger ved berøring (rammerBaevere og
 * en detonation eller klynge) — Papirbunken og COVID flyver igennem, og
 * hoppende granater rører dem ikke (men deres brag antænder). De første
 * FARE_SKYTTE_PAUSE tick rammer skuddet ikke en fare, der ligger over
 * skytten (ellers sprang det ved mundingen, når Kabelsalaten ruller forbi).
 * Rammer det, flyttes projektilet hen til træfpunktet, så braget sker PÅ faren.
 */
export function projektilRammer(v, p, x0, y0) {
  if (!v.farer?.length || p.sover || !p.rammerBaevere || !(p.detonation || p.klynge)) return null;
  const skytte = p.alder < FARE_SKYTTE_PAUSE && p.ejer != null ? v.baevere.find((b) => b.id === p.ejer) : null;
  const dx = p.x - x0, dy = p.y - y0, l2 = dx * dx + dy * dy;
  for (const f of v.farer) {
    if (f.vaek || f.styrt > 0) continue;
    const cx = f.x, cy = midteY(f);
    if (skytte && !skytte.doed && afstandTilHitbox(skytte, cx, cy) <= f.r + BAEVER_R + 4) continue;
    const s = l2 > 0 ? klem(((cx - x0) * dx + (cy - y0) * dy) / l2, 0, 1) : 1;
    const px = x0 + dx * s, py = y0 + dy * s;
    const R = f.r + (p.r || 0);
    if ((px - cx) * (px - cx) + (py - cy) * (py - cy) <= R * R) {
      p.x = px; p.y = py;
      return { slags: 'fare', fare: f.id, x: px, y: py };
    }
  }
  return null;
}

/**
 * Første fare langs en stråle fra m (retning dx, dy), inden for maks. Trin på
 * 3 wu som behaviours.foersteKunde, men træfcirklen er FARE_STRAALE_TOL
 * bredere: gæster ser farerne ~80 ms bagud (net/client.js), og en fare
 * bevæger sig, hvad en kunde aldrig gør, når den er mål. kun: kun den slags.
 * skytte: en fare ved skytten (inden for r + BAEVER_R + 4, som i
 * projektilRammer) får ingen tolerance. Strålen starter ved mundingen, kun
 * 22 wu fra skulderen, så ellers antændte en Kabelsalat, der ruller gennem
 * skytten, sig ved dens fødder, uanset hvor der blev sigtet. Et bevidst
 * skud lige på den rammer stadig.
 */
export function foersteFare(v, m, dx, dy, maks, kun = null, tol = FARE_STRAALE_TOL, skytte = null) {
  let fare = null, d = maks;
  for (const f of v.farer || []) {
    if (f.vaek || f.styrt > 0 || (kun && f.slags !== kun)) continue;
    const cx = f.x, cy = midteY(f);
    const vedSkytten = skytte && !skytte.doed && afstandTilHitbox(skytte, cx, cy) <= f.r + BAEVER_R + 4;
    const R = f.r + (vedSkytten ? 0 : tol);
    for (let s = 0; s < d; s += 3) {
      const px = m.x + dx * s - cx, py = m.y + dy * s - cy;
      if (px * px + py * py <= R * R) { fare = f; d = s; break; }
    }
  }
  return { fare, d };
}

// ---------------------------------------------------------------- reaktionen

function reager(v, f, h) {
  const r = f.ramt;
  f.ramt = null;
  const aarsag = r.antaend ? 'eksplosion' : 'straale';
  switch (f.slags) {
    case 'kabelsalat':
      if (r.skubX || r.skubY) skub(f, r.skubX * KS_SKUB, r.skubY * KS_SKUB);
      if (r.klask) { f.vx = r.klask * KS_KLASK_VX; f.vy = KS_KLASK_VY; skub(f, 0, 0); }
      if (r.antaend || r.straale) antaend(v, f, r, aarsag, h);
      break;
    case 'drone':
      if (r.straale && !r.antaend && f.pakke) leverer(v, f, r, h);
      else if (r.antaend) nedskyd(v, f, r, h);
      break;
    case 'stoevsuger':
      if (r.skubX || r.skubY) {
        f.vx += r.skubX * RS_SKUB; f.vy += r.skubY * RS_SKUB;
        f.paaJorden = false; f.faldFra = f.y; f.luft = FARE_LUFT_URO;
      }
      if (r.klask) f.ret = -f.ret;
      if (r.opdatering) {
        f.pause = RS_OPDATERING;
        h.push({ navn: 'fareOpdateres', id: f.id, x: f.x, y: f.y, fra: r.kildeBaever, tick: RS_OPDATERING });
      }
      if (r.antaend || r.straale) antaend(v, f, r, aarsag, h);
      break;
  }
}

/** Skubbet: op i luften, og luft-uret starter (landingen nulstiller det). */
function skub(f, sx, sy) {
  f.vx += sx; f.vy += sy;
  f.tilst = 'luft';
  f.luft = FARE_LUFT_URO;
  f.stille = false; f.stoed = 0; f.fremTael = 0; f.fremX = f.x;
}

/** Sæt faren i brand. k er kilden (et brag, en stråle, en plet eller en
 *  brændende fare) — faren kommer ét led dybere i kæden. Højst én gang, og
 *  aldrig dybere end KAEDE_MAKS. */
function antaend(v, f, k, aarsag, h) {
  if (f.antaendt || f.slags === 'drone') return false;
  const kaede = (k.kaede | 0) + 1;
  if (kaede > KAEDE_MAKS) return false;
  f.antaendt = true;
  Object.assign(f, kildeFelter(k), { kaede });
  f.brand = f.slags === 'kabelsalat' ? KS_BRAND : RS_OVERHED;
  h.push({ navn: 'fareAntaendt', id: f.id, slags: f.slags, hud: f.hud, x: f.x, y: f.y, aarsag, ...kildeFelter(f) });
  return true;
}

/** Scanneren rammer dronen: LEVERET! Skyttens klinik får lasten (som en
 *  kasse, world._samlKasse), og dronen flyver videre uden pakke. */
function leverer(v, f, r, h) {
  const hold = v.hold[r.kildeHold];
  if (!hold) return;
  const id = f.pakke, antal = kasseAntal(id);
  const nu = hold.ammo[id] ?? 0;
  if (nu >= 0) hold.ammo[id] = nu + antal;
  f.pakke = null;
  h.push({ navn: 'ammoAendret', hold: r.kildeHold, vaaben: id, ammo: hold.ammo[id] });
  h.push({ navn: 'fareLeveret', id: f.id, x: f.x, y: f.y, hold: r.kildeHold, baever: r.kildeBaever, vaaben: id, antal });
}

/** Et brag eller et skud har ramt dronen: den styrter, og pakken falder som
 *  en våbenkasse (uden faldskærm), hvis der er plads — ellers konfetti. */
function nedskyd(v, f, r, h) {
  if (f.styrt > 0) return;
  const kaede = (r.kaede | 0) + 1;
  f.antaendt = true;
  Object.assign(f, kildeFelter(r), { kaede: Math.min(kaede, KAEDE_MAKS) });
  f.styrt = DR_STYRT_URO;
  f.tilst = 'styrt';
  f.vx *= DR_STYRT_VX;
  f.vy = 0;
  let kasse = null, konfetti = false;
  if (f.pakke) {
    if (v._ledigeKassepladser() > 0) {
      const t = v.terraen;
      let y = f.y;
      while (t.fast(Math.round(f.x), Math.round(y)) && y < t.h - 2) y += 2;
      const k = lavKasse(v.nytId(), { slags: 'vaaben', indhold: f.pakke, x: f.x, y });
      k.fald = true;
      v.kasser.push(k);
      kasse = k.id;
      h.push({ navn: 'kasseFalder', id: k.id, x: k.x, y: k.y, slags: k.slags, fald: true });
    } else konfetti = true;
    f.pakke = null;
  }
  h.push({ navn: 'fareAntaendt', id: f.id, slags: f.slags, hud: f.hud, x: f.x, y: f.y, aarsag: 'eksplosion',
           nedskudt: true, kasse, konfetti, ...kildeFelter(f) });
}

// ---------------------------------------------------------------- bevægelse

function bevaeg(v, f, h) {
  f.alder++;
  if (f.slags === 'kabelsalat') bevaegKabelsalat(v, f, h);
  else if (f.slags === 'drone') bevaegDrone(v, f, h);
  else bevaegStoevsuger(v, f, h);
  if (f.vaek) return;
  // Ude over kanten (dronen kommer ind ved ±DR_IND og er væk ved ±DR_UD) eller ned under banen.
  const t = v.terraen, kant = f.slags === 'drone' ? DR_UD : FARE_KANT;
  if (f.x < -kant || f.x > t.w + kant || f.y < -20) vaek(f, 'kant', h);
}

/** Kabelsalaten: vindpilen styrer den. På jorden ruller den mod vindens
 *  målfart; i luften falder den let og glider mod vinden; i vandet flyder
 *  den og kravler i land på en lav kyst. */
function bevaegKabelsalat(v, f, h) {
  const t = v.terraen;
  const w = v.vindNu();
  // Retningen skifter kun ved |vindNu| ≥ KS_RET_HYST — ellers holdes den
  // gamle. Vindstødene skifter aldrig fortegn inden for en tur.
  if (Math.abs(w) >= KS_RET_HYST) f.ret = w > 0 ? 1 : -1;
  const fart = klem(Math.abs(w) * KS_VIND, KS_MIN, KS_MAKS) * (f.brand > 0 ? KS_BRAND_FART : 1);
  const maal = f.stille ? 0 : f.ret * fart;
  const yVand = v.vandNiveau - KS_FLYD_DYB;

  if (f.tilst === 'jord' && !rundPaaJorden(t, f)) { f.tilst = 'luft'; f.vy = 0; }
  if (f.tilst === 'jord') rul(t, f, maal);
  else if (f.tilst === 'vand') flyd(v, f, maal);
  if (f.tilst === 'luft') luft(t, f, maal);

  // Ned i vandet: flyder (og vandet nulstiller luft-uret). Brænder den — også
  // når den antændes, mens den flyder — er den slukket (PSST), uden brag.
  if (f.tilst !== 'vand' && f.y < yVand && rundFri(t, f.x, yVand, f.r)) {
    f.tilst = 'vand'; f.y = yVand; f.vy = 0; f.luft = 0;
  }
  if (f.tilst === 'vand' && f.brand > 0) { f.brand = 0; vaek(f, 'slukket', h); return; }

  if (f.brand > 0) {
    f.brand--;
    // Brændende lægger den en ildplet (gen 1) hvert KS_DRYP. tick, mens den er på jorden.
    if (f.tilst === 'jord' && (KS_BRAND - f.brand) % KS_DRYP === 0) taendIld(v, f.x, f.y, 1, f, h);
    if (f.brand === 0) { flammebrag(v, f, h); return; }
  } else if (--f.liv <= 0) { vaek(f, 'traet', h); return; }

  // Sidder den fast (under KS_FAST_WU fremdrift på KS_FAST_TICK), får den et
  // vindstødshop — højst KS_STOED_MAKS gange; så ligger den stille som et mål.
  // Hverken væghop eller stødhop er uro.
  if (f.tilst !== 'luft' && !f.stille) {
    if (++f.fremTael >= KS_FAST_TICK) {
      if (Math.abs(f.x - f.fremX) < KS_FAST_WU) {
        if (f.stoed < KS_STOED_MAKS) { f.stoed++; f.vy = KS_STOED_VY; f.vx = f.ret * KS_STOED_VX; f.tilst = 'luft'; }
        else f.stille = true;
      }
      f.fremTael = 0; f.fremX = f.x;
    }
  }
}

/** På jorden: trin som physics.gaa — øverste frie trin fra +KS_TRIN_OP til
 *  −KS_TRIN_NED, og derfra ned til jorden. Ingen fri plads: en væg — prel og hop. */
function rul(t, f, maal) {
  f.vx += (maal - f.vx) * KS_TRAEG;
  f.vy = 0;
  const nx = f.x + f.vx * DT;
  let d = null;
  for (let dy = KS_TRIN_OP; dy >= -KS_TRIN_NED; dy--) if (rundFri(t, nx, f.y + dy, f.r)) { d = dy; break; }
  if (d === null) {
    f.vx *= KS_PRELL;
    f.vy = KS_VAEG_HOP;
    f.tilst = 'luft';
    return;
  }
  while (d > -KS_TRIN_NED && rundFri(t, nx, f.y + d - 1, f.r)) d--;
  f.x = nx; f.y += d;
  if (!rundPaaJorden(t, f)) { f.tilst = 'luft'; f.vy = 0; }
}

/** I luften: let tyngde, farten glider mod vinden med halv inerti. Fejet i
 *  trin på 1 wu, vandret og lodret hver for sig. En landing nulstiller KUN luft-uret. */
function luft(t, f, maal) {
  f.vy = Math.max(-F.MAKS_FALD, f.vy - KS_TYNGDE * F.TYNGDE * DT);
  f.vx += (maal - f.vx) * KS_TRAEG * 0.5;
  const dx = f.vx * DT, nx = Math.ceil(Math.abs(dx));
  for (let i = 0; i < nx; i++) {
    if (rundFri(t, f.x + dx / nx, f.y, f.r)) f.x += dx / nx;
    else { f.vx *= KS_PRELL; break; }
  }
  const dy = f.vy * DT, ny = Math.ceil(Math.abs(dy));
  for (let i = 0; i < ny; i++) {
    if (rundFri(t, f.x, f.y + dy / ny, f.r)) { f.y += dy / ny; continue; }
    if (f.vy > 0) { f.vy = 0; break; }          // hovedet i loftet
    // Landet: ned til første sted, hvor den står på jorden.
    let y = Math.floor(f.y);
    for (let n = 0; n < 4 && !rundFri(t, f.x, y, f.r); n++) y++;
    for (let n = 0; n < 4 && rundFri(t, f.x, y - 1, f.r); n++) y--;
    f.y = y;
    f.vy = 0;
    if (rundPaaJorden(t, f)) { f.tilst = 'jord'; f.luft = 0; }
    break;
  }
}

/** I vandet: flyder i vandlinjen med halv fart. Kysten foran kan den kravle
 *  op på, hvis den ligger højst KS_KYST over vandet. */
function flyd(v, f, maal) {
  const t = v.terraen, yVand = v.vandNiveau - KS_FLYD_DYB;
  f.vx += (maal * KS_FLYD - f.vx) * KS_TRAEG;
  f.vy = 0; f.luft = 0;
  if (!rundFri(t, f.x, yVand, f.r)) { f.tilst = 'luft'; return; }     // grund under: den ruller videre
  f.y = yVand;
  const nx = f.x + f.vx * DT;
  if (rundFri(t, nx, yVand, f.r)) { f.x = nx; return; }
  for (let dy = 1; yVand + dy <= v.vandNiveau + KS_KYST; dy++) {
    if (rundFri(t, nx, yVand + dy, f.r)) {
      f.x = nx; f.y = yVand + dy;
      f.tilst = rundPaaJorden(t, f) ? 'jord' : 'luft';
      return;
    }
  }
  f.vx *= KS_PRELL;
}

/** Branden er brændt ud: flammebraget (uden krater) og en ring af pletter. */
function flammebrag(v, f, h) {
  v.eksplosionsKoe.push({ x: f.x, y: midteY(f), ...KS_FLAMMEBRAG, kilde: { ...kildeFelter(f), fare: f.slags } });
  for (const dx of KS_RING) taendIld(v, f.x + dx, f.y, 0, f, h);
  vaek(f, 'brag', h);
}

/** Pakkedronen: flyver over banen i DR_HOEJDE over terrænet foran sig.
 *  Nedskudt falder den ballistisk og smælder ved nedslaget. */
function bevaegDrone(v, f, h) {
  const t = v.terraen;
  if (f.styrt > 0) {
    f.styrt--;
    f.vy = Math.max(-F.MAKS_FALD, f.vy - DR_TYNGDE * DT);
    const dx = f.vx * DT, dy = f.vy * DT, n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i < n; i++) {
      if (!rundFri(t, f.x + dx / n, f.y + dy / n, f.r)) { nedslag(v, f, h); return; }
      f.x += dx / n; f.y += dy / n;
      if (midteY(f) < v.vandNiveau) { f.styrt = 0; vaek(f, 'vand', h); return; }
    }
    if (f.styrt === 0) nedslag(v, f, h);
    return;
  }
  if (f.alder % DR_MAAL_HVER === 1) f.hoejdeMaal = droneHoejde(v, f.x, f.ret);
  const nx = f.x + f.ret * DR_FART * DT;
  const ny = f.y + klem(f.hoejdeMaal - f.y, -DR_NED * DT, DR_OP * DT);
  if (rundFri(t, nx, ny, f.r)) { f.x = nx; f.y = ny; f.bonk = false; }
  else {
    // BONK: den stiger lodret, til den er fri igen.
    f.bonk = true;
    f.y = Math.min(f.y + DR_OP * DT, t.h - DR_LOFT - 2 * DR_R);
  }
  if (--f.liv <= 0) vaek(f, 'traet', h);
}

/** Den nedskudte drone rammer jorden: et brag med krater og 2 pletter. */
function nedslag(v, f, h) {
  f.styrt = 0;
  v.eksplosionsKoe.push({ x: f.x, y: midteY(f), ...DR_BRAG, kilde: { ...kildeFelter(f), fare: f.slags } });
  taendIld(v, f.x - ILD_CELLE / 2, f.y, 0, f, h);
  taendIld(v, f.x + ILD_CELLE / 2, f.y, 0, f, h);
  vaek(f, 'styrt', h);
}

/** Robotstøvsugeren: kører (physics.gaa hvert andet tick) med kundens kapsel
 *  og vender ved en væg, en skrænt og en kunde. Løftet af et skub falder den
 *  som en kunde; faldskaden ignoreres. */
function bevaegStoevsuger(v, f, h) {
  const t = v.terraen;
  if (f.paaJorden && !(f.pause > 0) && f.alder % 2 === 0) koer(v, f);
  if (f.pause > 0) f.pause--;
  F.skridtBaever(t, f, 0);
  if (f.paaJorden) f.luft = 0;
  f.tilst = !f.paaJorden ? 'luft' : f.pause > 0 ? 'pause' : 'koer';
  if (f.y < v.vandNiveau) { f.brand = 0; vaek(f, 'kortsluttet', h); return; }
  if (f.brand > 0) {
    if (--f.brand === 0) batteri(v, f, h);
  } else if (--f.liv <= 0) vaek(f, 'traet', h);
}

function koer(v, f) {
  const t = v.terraen;
  if (v.baevere.some((b) => !b.doed && Math.abs(b.x - f.x) < RS_KUNDE && Math.abs(b.y - f.y) < 30 &&
                            (b.x - f.x) * f.ret >= 0)) { f.ret = -f.ret; return; }
  const g = t.jordUnder(Math.round(f.x + f.ret * (BAEVER_R + 4)), Math.round(f.y) + 4);
  if (g < f.y - RS_KLIPPE) { f.ret = -f.ret; return; }
  if (!F.gaa(t, f, f.ret)) f.ret = -f.ret;
}

/** Batteriet springer: større for hver spist mine. */
function batteri(v, f, h) {
  const n = f.spam | 0;
  v.eksplosionsKoe.push({ x: f.x, y: midteY(f), ...RS_BATTERI,
                          radius: RS_BATTERI.radius + RS_SPAM_R * n, skade: RS_BATTERI.skade + RS_SPAM_SKADE * n,
                          kilde: { ...kildeFelter(f), fare: f.slags } });
  for (const dx of [-ILD_CELLE, 0, ILD_CELLE]) taendIld(v, f.x + dx, f.y, 0, f, h);
  vaek(f, 'brag', h);
}

// ---------------------------------------------------------------- kontakter

const kanTaendes = (q) => !q.doed && !q.antaendt && q.lunte === 0 && (q.sprite === 'toende' || q.sprite === 'mine');

/** Ild sætter lunten på en printer (90 tick) eller en mine (30), ét led
 *  dybere — højst én gang: slukker tvungenRo lunten, går tingen i dvale. */
function taendLunte(q, k) {
  const kaede = (k.kaede | 0) + 1;
  if (kaede > KAEDE_MAKS) return;
  q.lunte = ILD_LUNTE[q.sprite];
  q.antaendt = true;
  Object.assign(q, kildeFelter(k), { kaede });
}

function kontakter(v, h) {
  for (const f of v.farer) {
    if (f.vaek) continue;
    // En ildplet ved fodpunktet antænder.
    if (!f.antaendt && f.slags !== 'drone') {
      const p = v.ild.find((q) => Math.hypot(q.x - f.x, q.y - f.y) <= ILD_FARE_R);
      if (p) antaend(v, f, p, 'ild', h);
    }
    // En brændende fare sætter lunten på printere og miner, den rører.
    if (f.brand > 0) {
      for (const q of v.placerede) if (kanTaendes(q) && Math.hypot(q.x - f.x, q.y - f.y) <= ILD_PLAC_R) taendLunte(q, f);
    }
    // Spamfilteret: støvsugeren æder banens, shitstormens og spammens miner
    // (ejer == null) — aldrig spillerens egne.
    if (f.slags === 'stoevsuger' && f.paaJorden && !(f.pause > 0) && f.spam < RS_SPAM) {
      for (const q of v.placerede) {
        if (q.doed || q.sprite !== 'mine' || q.ejer != null || q.lunte > 0) continue;
        if (Math.abs(q.x - f.x) >= RS_SPIS_DX || Math.abs(q.y - f.y) >= RS_SPIS_DY) continue;
        q.doed = true;
        f.spam++;
        h.push({ navn: 'fareSpiste', id: f.id, mine: q.id, x: q.x, y: q.y, spam: f.spam });
        if (f.spam >= RS_SPAM) break;
      }
    }
  }
  for (const p of v.ild) {
    for (const q of v.placerede) if (kanTaendes(q) && Math.hypot(q.x - p.x, q.y - p.y) <= ILD_PLAC_R) taendLunte(q, p);
  }
}

// ---------------------------------------------------------------- ild

/**
 * Tænd en ildplet ved x (snappet til et gitter på ILD_CELLE), på jorden
 * under yRef + 30 — aldrig med overflade(), der i grotten giver loftet.
 * Afvist uden jord inden for 60 wu, i vandet, begravet, i en celle, der
 * allerede brænder, og over ILD_MAKS. kilde giver kæden (flade felter).
 * Returnerer pletten eller null.
 */
export function taendIld(v, x, yRef, gen, kilde, h) {
  const t = v.terraen;
  if (v.ild.length >= ILD_MAKS) return null;
  x = Math.round(x / ILD_CELLE) * ILD_CELLE;
  if (x < 0 || x >= t.w) return null;
  const top = Math.round(yRef) + 30;
  const g = t.jordUnder(x, top);
  if (g < 0 || top - g > 60 || g + 1 < v.vandNiveau + 2 || t.fast(x, g + 4)) return null;
  if (v.ild.some((p) => p.x === x && Math.abs(p.y - (g + 1)) < ILD_CELLE)) return null;
  const jord = t.hent(x, g) === JORD;           // MUR og FJELD brænder, men spreder ikke
  const id = v.nytId();
  const ny = !v.ild.some((p) => Math.abs(p.x - x) < ILD_NY_BRAND && Math.abs(p.y - (g + 1)) < ILD_NY_BRAND);
  const p = { id, x, y: g + 1, alder: 0, liv: ILD_LIV + 15 * (id % 4), gen, jord,
              spred: gen < ILD_GEN && jord, truer: false, ...kildeFelter(kilde) };
  v.ild.push(p);
  if (ny) h?.push({ navn: 'ildTaendt', id, x: p.x, y: p.y, ...kildeFelter(p) });
  return p;
}

/** Hvert aktive tick: alder, spredning (uden tilfældighed), sluk og truer. */
function ildSkridt(v, h) {
  if (!v.ild.length) return;
  const t = v.terraen;
  const w = v.vindNu(), tilladt = spredningTilladt(v);
  const nye = [];
  for (const p of v.ild) {
    p.alder++;
    if (p.spred && tilladt && p.alder === ILD_SPRED_ALDER) {
      if (Math.abs(w) < ILD_STILLE) nye.push([p.x - ILD_CELLE, p], [p.x + ILD_CELLE, p]);
      else nye.push([p.x + (w > 0 ? ILD_CELLE : -ILD_CELLE), p]);
    }
    if (p.alder % 10 === 0) {
      // Jorden væk: pletten falder med — for langt, og den er slukket.
      if (!t.fast(p.x, p.y - 1)) {
        const g = t.jordUnder(p.x, p.y - 1);
        if (g < 0 || p.y - 1 - g > ILD_FALD_MAKS) p.slukket = true;
        else p.y = g + 1;
      }
      if (p.y < v.vandNiveau + 2 || t.fast(p.x, p.y + 3)) p.slukket = true;   // i vandet eller kvalt
    }
    if (p.alder >= ildLevetid(v, p)) p.slukket = true;
  }
  let j = 0;
  for (const p of v.ild) if (!p.slukket) v.ild[j++] = p;
  v.ild.length = j;
  // Nye pletter føjes til efter løkken; de arver kæden og er én generation længere.
  for (const [x, p] of nye) taendIld(v, x, p.y - 1, p.gen + 1, p, h);
  // truer: pletten kan stadig sprede sig hen til en utændt printer eller
  // mine. erIRo venter på den (højst ILD_SPRED_ALDER tick pr. generation).
  for (const p of v.ild) {
    const naa = ILD_PLAC_R + (ILD_GEN - p.gen) * ILD_CELLE;
    p.truer = p.spred && tilladt && p.alder < ILD_SPRED_ALDER && (p.kaede | 0) < KAEDE_MAKS &&
      v.placerede.some((q) => kanTaendes(q) && Math.abs(q.x - p.x) <= naa && Math.abs(q.y - p.y) <= ILD_TRUER_DY);
  }
}

/** Ildskade hvert ILD_TAKT tick (global fase): ILD_SKADE til hver kunde i en
 *  plet eller ved en brændende fare, højst ILD_LOFT pr. kunde pr. tur. Ingen
 *  skub, og et kraftfelt holder ilden ude uden en skjoldBlok. Den aktive
 *  kunde har en startpause (den har stået frosset gennem TUR_START). */
function ildSkade(v, h) {
  if (v.tick % ILD_TAKT !== 0) return;
  const braender = v.farer.filter((f) => f.brand > 0 && !f.vaek);
  if (!v.ild.length && !braender.length) return;
  const tur = v.tur;
  for (const b of v.baevere) {
    if (b.doed || b.skjold) continue;
    if (b.id === tur.baeverId && tur.tilstand === T.SPILLER_AKTIV && tur.tilstandTick < ILD_START_PAUSE) continue;
    let kilde = v.ild.find((p) => afstandTilHitbox(b, p.x, p.y + 6) <= ILD_R);
    if (!kilde) kilde = braender.find((f) => afstandTilHitbox(b, f.x, midteY(f)) <= f.r + 4);
    if (!kilde) continue;
    const skade = Math.min(ILD_SKADE, ILD_LOFT - (b.ildTur | 0));
    if (skade <= 0) continue;
    b.ildTur = (b.ildTur | 0) + skade;
    givSkade(v, b, skade, 'ild', h, kilde);
  }
}

// ---------------------------------------------------------------- pakken

/** Pakkens frie fald (den nedskudte drones last): tyngde som
 *  physics.skridtFaldende, men fejet i trin på PAKKE_TRIN, så den ikke
 *  falder gennem fortets tynde lag (skridtFaldende prøver kun to punkter). */
export function skridtPakke(t, k) {
  k.alder++;
  if (k.landet || k.paaJorden) return;
  k.vy = Math.max(-F.MAKS_FALD, (k.vy || 0) - F.TYNGDE * DT);
  const dx = (k.vx || 0) * DT, dy = k.vy * DT;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / PAKKE_TRIN));
  for (let i = 0; i < n; i++) {
    const nx = k.x + dx / n, ny = k.y + dy / n;
    if (t.fast(nx, ny)) {
      let y = Math.floor(ny);
      while (t.fast(nx, y) && y < ny + 4) y++;
      k.x = nx; k.y = y; k.vx = 0; k.vy = 0;
      k.landet = true; k.paaJorden = true;
      return;
    }
    k.x = nx; k.y = ny;
  }
}
