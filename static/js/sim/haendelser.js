/* Kundekrigen — tilfældige hændelser i starten af en runde.
 *
 * En RUNDE er en hel omgang, hvor hver levende klinik har haft én tur
 * (world.js tæller dem i tur.runde). Fra runde HAENDELSE_FRA_RUNDE er der i
 * starten af hver runde — lige før rundens første tur — HAENDELSE_CHANCE for
 * en hændelse. Chancen er den samme i hver runde, så hændelserne fordeler sig
 * tilfældigt og uafhængigt af, hvor langt kampen er.
 *
 * Hændelsen trækkes ligeligt blandt dem, der KAN ske lige nu (ingen printere
 * på banen, ingen printerhændelse; ingen plads til kasser, ingen pakker), og
 * aldrig den samme som sidst. Nogle gælder hele runden (internetnedbruddet,
 * myldretiden): world.haendelseNu = { slags, runde } står, til næste runde
 * begynder, og følger med i snapshottet, så gæster og sene tilkomne ved det.
 *
 * Formålet er ikke kaos for kaos' skyld: hver hændelse ændrer, hvad der er
 * det rigtige træk i runden. Alle trækker fra rngSim, så de er ens hos alle
 * klienter og i en afspilning.
 *
 * Hver hændelse melder ÉN {navn: 'hændelse', slags, titel, tekst, …data}.
 * tekst er bannerets linje (main.js viser den); titel står også i HUD'ens
 * mærke, mens en rundehændelse gælder (ui/haendelser.js).
 */
'use strict';

import { HZ } from '../core/tick.js';
import * as E from './entities.js';
import * as F from './physics.js';
import * as D from './damage.js';
import * as TU from './turn.js';
import { VAABEN, tilfaeldigtKassevaaben } from './weapons.js';
import { TELEFON_MAKS } from './opkald.js';
import { findStartpladser, VAND_NIVEAU } from './terrain_gen.js';
import { STORM_ILD_AFSTAND } from './farer.js';

export const HAENDELSE_CHANCE = 0.35;       // pr. rundestart, fra runde 3
export const HAENDELSE_FRA_RUNDE = 3;       // først efter runde 2
export const INTERNET_TUR_TICKS = 12 * HZ;  // turene under et internetnedbrud
export const VANDSKADE_LOFT = VAND_NIVEAU + 120;   // højere end det stiger vandet ikke af en vandskade
// Et sprunget rør er mere end pludselig døds 6 wu pr. tur: en halv kunde, så det ses.
export const VANDSKADE_STIGNING = 24;

const SHITSTORM_MINER = 8;
export const SHITSTORM_MINDST = 4;          // er der ikke plads til så mange, sker den ikke
// Afstanden mellem ticketminerne, der slækkes, når landet er småt — aldrig
// under 55: minens sprængradius er 52, og en mine, der går af, river de
// placerede ting inden for den med sig (damage.js).
const MINE_AFSTAND = [80, 65, 55];
const MINE_MIN = 55;
const STORM_KANT = 60;
const KAFFE_HP = 25;
const INFLUENZA_HP = 10;
const PAKKER = 3;

/** Titel og forklaring. Bannerets tekst er "TITEL: forklaring"; de tre
 *  gamle hændelser beholder deres egen tekst. */
export const HAENDELSE_INFO = {
  stenskred:    { titel: 'STENSKRED', tekst: 'Mursten falder fra loftet!' },
  uvejr:        { titel: 'UVEJR', tekst: 'Driftsforstyrrelse: uvejr trækker op — pas på vinden' },
  telefoner:    { titel: 'TELEFONERNE KIMER', tekst: 'Telefonerne kimer — tag røret!' },
  internet:     { titel: 'INTERNETNEDBRUD', forklaring: 'ingen kan skyde i denne runde. Gå, hop eller sæt på hold' },
  shitstorm:    { titel: 'SHITSTORM', forklaring: 'ticketminer er landet over hele banen. Se, hvor du træder' },
  kaffepause:   { titel: 'KAFFEPAUSE', forklaring: 'alle kunder får +25 tålmodighed' },
  printere:     { titel: 'PRINTERNE GÅR AMOK', forklaring: 'alle printere på banen sprænger på én gang' },
  pakker:       { titel: 'PAKKELEVERING', forklaring: 'tre forsyningskasser daler ned over banen' },
  influenza:    { titel: 'INFLUENZASÆSON', forklaring: 'alle mister 10 tålmodighed, men ingen dør af det' },
  brandoevelse: { titel: 'BRANDØVELSE', forklaring: 'alle kunder er gået ud og står nu et nyt sted' },
  myldretid:    { titel: 'MYLDRETID', forklaring: 'halv turtid for alle i denne runde' },
  vandskade:    { titel: 'VANDSKADE', forklaring: 'et rør er sprunget, og vandet stiger' },
  loenningsdag: { titel: 'LØNNINGSDAG', forklaring: 'hver klinik får et ekstra våben' },
};
for (const i of Object.values(HAENDELSE_INFO)) i.tekst ||= `${i.titel}: ${i.forklaring}`;

/** Alle hændelser, i fast rækkefølge (lodtrækningen afhænger af den). */
export const HAENDELSER = Object.keys(HAENDELSE_INFO);

/** Hændelser, der gælder hele runden (HUD'ens mærke og turtiden). */
export const RUNDEHAENDELSER = new Set(['internet', 'myldretid']);

/** Kan hændelsen gøre noget lige nu? */
export function kanSke(v, slags) {
  const levende = v.baevere.filter((b) => !b.doed);
  switch (slags) {
    case 'telefoner': return v._telefoner() < TELEFON_MAKS && v._udstyrsPladser().length > 0;
    case 'printere': return v.placerede.some((p) => p.sprite === 'toende' && !p.doed);
    case 'pakker': return v._ledigeKassepladser() >= PAKKER && v._udstyrsPladser().length > 0;
    case 'kaffepause': return levende.some((b) => b.hp < E.MAKS_HP);
    case 'influenza': return levende.some((b) => b.hp > 1);
    case 'vandskade': return v.vandNiveau + VANDSKADE_STIGNING <= VANDSKADE_LOFT;
    case 'loenningsdag': return TU.levendeHold(v).length > 0;
    // Murstenene falder fra himlen eller under grottens loft (world.nedfaldY):
    // der skal være luft at falde i over det meste af bæltet, de kan falde i.
    case 'stenskred': return stenskredMuligt(v);
    // Prøvekørsler uden træk fra rngSim: er der land nok til minerne, og
    // kan ALLE kunder komme et nyt sted hen (ellers passer banneret ikke)?
    case 'shitstorm': return stormSteder(v).length >= SHITSTORM_MINDST;
    case 'brandoevelse': return levende.length > 0 && bedstePlan(v, levende, flytSteder(v, levende, null)).size === levende.length;
    default: return !!HAENDELSE_INFO[slags];
  }
}

/**
 * Rundestart fra runde 3: måske en hændelse. Returnerer hændelsen eller null.
 * cfg.haendelseChance (0 slår dem fra, uden at trække) og cfg.haendelser (en
 * liste over tilladte) kan sættes i opsætningen; de følger med i snapshottet.
 */
export function maaskeHaendelse(v, h) {
  const chance = v.cfg.haendelseChance ?? HAENDELSE_CHANCE;
  if (!(chance > 0) || v.rngSim() >= chance) return null;
  const tilladt = Array.isArray(v.cfg.haendelser) ? v.cfg.haendelser : null;
  const mulige = HAENDELSER.filter((s) => s !== v.sidsteHaendelse &&
    (!tilladt || tilladt.includes(s)) && kanSke(v, s));
  if (!mulige.length) return null;
  return udloes(v, mulige[Math.floor(v.rngSim() * mulige.length)], h);
}

/** Udløs en bestemt hændelse nu. Selve hændelsen meldes FØRST, så
 *  brugerfladen har banneret, før følgerne (skade, kasser, miner) kommer. */
export function udloes(v, slags, h) {
  const info = HAENDELSE_INFO[slags];
  if (!info) return null;
  v.haendelseNu = { slags, runde: v.tur.runde };
  v.sidsteHaendelse = slags;
  const e = { navn: 'hændelse', slags, titel: info.titel, tekst: info.tekst, runde: v.tur.runde };
  h.push(e);
  EFFEKT[slags]?.(v, e, h);
  return e;
}

// ---------------------------------------------------------------- følgerne

const EFFEKT = {
  // Stenskred: en håndfuld mursten falder fra himlen langs et bælte.
  stenskred(v, e) {
    const midte = 300 + v.rngSim() * (v.terraen.w - 600);
    v._stenskred(midte);
    e.x = midte;
  },

  // Uvejr: vinden springer kraftigt, og vejret skifter.
  uvejr(v, e) {
    v._uvejr();
    e.vind = v.vind; e.vejr = v.vejr;
  },

  // Telefonerne kimer: op til TELEFON_MAKS telefoner dukker op og ringer.
  telefoner(v, e, h) {
    const pladser = v._udstyrsPladser();
    let antal = 0;
    while (v._telefoner() < TELEFON_MAKS) {
      const k = v._lavTelefon(pladser[Math.floor(v.rngSim() * pladser.length)]);
      h.push({ navn: 'telefonRinger', id: k.id, x: k.x, y: k.y });
      antal++;
    }
    e.antal = antal;
  },

  // Internetnedbrud og myldretid gælder hele runden: world.js læser
  // haendelseNu, når turene startes (turtiden) og skud valideres.
  internet() {},
  myldretid() {},

  // Shitstorm: op til otte ticketminer (phishing-minen) over hele banen — på
  // land, aldrig oven på en kunde, og skarpe med det samme. Ét forsøg pr.
  // bælte hen over banen først, så de spredes; bælter over havet fyldes op
  // andre steder, og er landet småt, rykker minerne tættere (MINE_AFSTAND).
  // Finder lodtrækningen færre steder end prøvekørslen i kanSke, bruges
  // prøvekørslens — så der lander mindst lige så mange, som den lovede.
  shitstorm(v, e) {
    const t = v.terraen;
    const bredde = t.w - 2 * STORM_KANT, baelte = bredde / SHITSTORM_MINER;
    const sted = stormSted(v);
    let nye = [];
    const proev = (x, afst) => {
      const s = sted(x, afst, nye);
      if (s) nye.push(s);
      return !!s;
    };
    for (let i = 0; i < SHITSTORM_MINER; i++) {
      for (let n = 0; n < 6; n++) if (proev(STORM_KANT + (i + v.rngSim()) * baelte, MINE_AFSTAND[0])) break;
    }
    for (const afst of MINE_AFSTAND) {
      for (let n = 0; n < 40 && nye.length < SHITSTORM_MINER; n++) proev(STORM_KANT + v.rngSim() * bredde, afst);
    }
    fyldOp(t, sted, nye);
    const proeve = stormSteder(v);
    if (nye.length < proeve.length) nye = proeve;
    e.miner = [];
    for (const s of nye) {
      const p = E.lavPlaceret(v.nytId(), {
        x: s.x, y: s.y, lunte: 0, naerhed: VAABEN.baevermine.placeret.naerhed, armering: 0,
        detonation: { radius: 52, skade: 42, knockback: 240, carve: true },
        ejer: null, ejerHold: null, sprite: 'mine',
      });
      v.placerede.push(p);
      e.miner.push({ id: p.id, x: p.x, y: p.y });
    }
    e.antal = e.miner.length;
  },

  // Kaffepause: +25 til alle levende, højst op til fuld tålmodighed. Har
  // pillerne løftet nogen over, tager kaffen intet.
  kaffepause(v, e) {
    e.heal = [];
    for (const b of v.baevere) {
      if (b.doed) continue;
      const hp = Math.max(0, Math.min(E.MAKS_HP, b.hp + KAFFE_HP) - b.hp);
      if (hp > 0) { b.hp += hp; e.heal.push({ baever: b.id, hp }); }
    }
  },

  // Printerne går amok: alle printere på banen går af på én gang, ad den
  // almindelige vej (eksplosionskøen), så skade, skub og kratere er som ellers.
  printere(v, e) {
    e.printere = [];
    for (const p of v.placerede) {
      if (p.doed || p.sprite !== 'toende') continue;
      p.doed = true;
      v.eksplosionsKoe.push({ x: p.x, y: p.y, ...p.detonation });
      e.printere.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
  },

  // Pakkelevering: tre forsyningskasser på én gang, spredt ud (kanSke har
  // sikret, at de er plads til under loftet for våbenkasser).
  pakker(v, e, h) {
    const pladser = v.rngSim.bland(v._udstyrsPladser().slice());
    const valgte = [];
    for (const p of pladser) {
      if (valgte.length >= PAKKER) break;
      if (valgte.every((q) => Math.abs(q.x - p.x) >= 300)) valgte.push(p);
    }
    for (const p of pladser) {
      if (valgte.length >= PAKKER) break;
      if (!valgte.includes(p)) valgte.push(p);
    }
    const xs = [];
    e.kasser = [];
    for (const p of valgte) {
      const k = v._slipVaabenkasse(p, h, xs);
      xs.push(k.x);
      e.kasser.push(k.id);
    }
  },

  // Influenzasæson: −10 til alle levende, men aldrig under 1 — ingen dør af
  // det. Gennem givSkade, så Hjemmearbejde holder smitten ude.
  influenza(v, e, h) {
    e.syge = [];
    for (const b of v.baevere) {
      if (b.doed) continue;
      const skade = Math.min(INFLUENZA_HP, b.hp - 1);
      if (skade <= 0) continue;
      const foer = b.hp;
      D.givSkade(v, b, skade, 'influenza', h);
      e.syge.push({ baever: b.id, skade: foer - b.hp });
    }
  },

  // Brandøvelse: alle levende kunder står bagefter et nyt, sikkert sted —
  // startpladserne (på fortbanen kundens egen borg, også taget og keepens
  // top), aldrig oven i hinanden eller på en mine. ÉN hændelse med
  // flytningerne, ingen teleport pr. kunde. Og ilden er slukket (sim/farer.js)
  // — FØR flytningen, så sikkertSted er det samme som i prøvekørslen.
  brandoevelse(v, e) {
    e.slukket = v.ild?.length || 0;
    if (v.ild) v.ild.length = 0;
    e.flyt = flytAlle(v);
  },

  // Vandskade: vandet stiger en halv kunde (VANDSKADE_STIGNING) — samme
  // hændelse som i pludselig død, bare et større spring.
  vandskade(v, e, h) {
    v.vandNiveau += VANDSKADE_STIGNING;
    h.push({ navn: 'vandStiger', vand: v.vandNiveau });
    e.vand = v.vandNiveau;
  },

  // Lønningsdag: hver levende klinik får +1 af et tilfældigt kassevåben.
  loenningsdag(v, e, h) {
    e.loen = [];
    for (const hid of TU.levendeHold(v)) {
      const hold = v.hold[hid];
      if (!hold) continue;
      const id = tilfaeldigtKassevaaben(v.rngSim);
      const nu = hold.ammo[id] ?? 0;
      if (nu >= 0) hold.ammo[id] = nu + 1;
      h.push({ navn: 'ammoAendret', hold: hid, vaaben: id, ammo: hold.ammo[id] });
      e.loen.push({ hold: hid, vaaben: id, ammo: hold.ammo[id] });
    }
  },
};

// ---------------------------------------------------------------- stenskredet

/** Kan murstenene falde nogen steder? 16 kolonner hen over bæltet, midten
 *  trækkes i (300 til w - 300): mindst halvdelen skal have luft at falde i
 *  — himmel eller et hulrum under grottens loft. */
function stenskredMuligt(v) {
  const w = v.terraen.w;
  let n = 0;
  for (let i = 0; i < 16; i++) if (v.nedfaldY(300 + (w - 600) * (i + 0.5) / 16, 50) != null) n++;
  return n >= 8;
}

// ---------------------------------------------------------------- shitstormen

/** Stedprøven for ticketminerne: sted(x, afst, nye) giver minens { x, y }
 *  (lige over jorden i kolonnen x) eller null — i vandet, for tæt på en
 *  kunde (90), en placeret ting (MINE_MIN), en kasse (30), de nye miner
 *  (afst) eller ild (STORM_ILD_AFSTAND: den spreder sig to celler og ville
 *  antænde minen). Minerne lander, hvor noget, der falder ned oppefra, lander
 *  (world.nedfaldY): under åben himmel på overfladen, i grotten — hvor
 *  klippen går til banens top — på gulvet under loftet. */
function stormSted(v) {
  const t = v.terraen;
  const levende = v.baevere.filter((b) => !b.doed);
  return (x, afst, nye) => {
    x = Math.round(x);
    if (x < 0 || x >= t.w) return null;
    const ned = v.nedfaldY(x, 0);
    if (ned == null) return null;
    const o = ned >= t.h ? t.overflade(x) : t.jordUnder(x, Math.round(ned));
    if (o < 0 || o < v.vandNiveau + 30 || o >= t.h - 10) return null;
    const y = o + 3;
    const naer = (q, d) => Math.hypot(q.x - x, q.y - y) < d;
    if (levende.some((b) => naer(b, 90))) return null;
    if (v.placerede.some((p) => !p.doed && naer(p, MINE_MIN))) return null;
    if (v.kasser.some((k) => !k.doed && naer(k, 30))) return null;
    if (nye.some((p) => naer(p, afst))) return null;
    if (v.ild?.some((p) => naer(p, STORM_ILD_AFSTAND))) return null;
    return { x, y };
  };
}

/** Fyld nye op til otte med et fast gennemløb hen over banen, med den
 *  mindste afstand — uden træk fra rngSim. */
function fyldOp(t, sted, nye) {
  for (let x = STORM_KANT; x <= t.w - STORM_KANT && nye.length < SHITSTORM_MINER; x += 10) {
    const s = sted(x, MINE_MIN, nye);
    if (s) nye.push(s);
  }
  return nye;
}

/** Prøvekørslen: stederne, et fast gennemløb finder (højst otte). */
const stormSteder = (v) => fyldOp(v.terraen, stormSted(v), []);

// ---------------------------------------------------------------- brandøvelsen

const FLYT_MIN = 80;     // kortere end det er ikke et nyt sted
const FLYT_GODT = 200;   // helst så langt væk

/** Står to kunder oven i hinanden? Samme regel som udsætningen (90 wu til
 *  siden), men med højden med, så fortets etager kan have kunder over hinanden. */
const kolliderer = (a, b) => Math.abs(a.x - b.x) < 90 && Math.abs(a.y - b.y) < 60;

/** Kundens liste: på fortbanen kundens egen borg, ellers hele banen. */
const flytNoegle = (fort, b) => (fort ? (fort.forter[b.hold] ? b.hold : 'alle') : 'bane');

/** Stederne i en liste, i fast rækkefølge og i to lag: de første foretrækkes.
 *  På fortbanen borgens egne: først etagernes pladser, hallerne
 *  (udstyrspladserne) og toppene, man kan komme op på — taget og keepens
 *  top, hvor kasserne slippes; så etagerne og taget hele vejen hen, for
 *  står minerne på hallernes gulve og taget, er der plads mellem dem.
 *  Ellers banens startpladser. */
function raaSteder(v, noegle) {
  const t = v.terraen, fort = t.fort;
  if (!fort) return [findStartpladser(t, v.vandNiveau)];
  const foerst = [], saa = [];
  for (const f of noegle === 'alle' ? fort.forter : [fort.forter[noegle]]) {
    for (const p of f.pladser) foerst.push({ x: p.x, y: p.y });
    for (const p of f.udstyr) foerst.push({ x: p.x, y: p.y });
    for (const x of f.kasser) {
      const y = t.overflade(x);
      if (y >= 0) foerst.push({ x, y: y + 1 });
    }
    for (const y of [...f.etager.map((e) => e.y), fort.tag]) {
      for (let x = f.fod[0] + 10; x <= f.fod[1] - 10; x += 20) saa.push({ x, y });
    }
  }
  return [foerst, saa];
}

/** Et sikkert sted: gulv lige under, fri kapsel, over vandet, uden for
 *  minernes udløserfelt (world.js: |dx| og |dy| under naerhed — her med
 *  kapslens radius til), et stykke fra en tændt lunte og ikke oven på en
 *  printer eller kasse. Giver { x, y } på gulvet eller null. */
function sikkertSted(v, p) {
  const t = v.terraen;
  const x = Math.round(p.x), g = t.jordUnder(x, Math.round(p.y));
  if (g < 0 || Math.round(p.y) - g > 30) return null;
  // På en skråning løftes kapslen fri som ved udsætningen (physics.frigoer).
  let y = g + 1;
  for (let i = 0; i < 6 && !F.kapselFri(t, x, y); i++) y += 2;
  if (y < v.vandNiveau + 40 || !F.kapselFri(t, x, y)) return null;
  for (const q of v.placerede) {
    if (q.doed) continue;
    const dx = Math.abs(q.x - x), dy = Math.abs(q.y - y);
    if (q.naerhed > 0) {
      if (dx < q.naerhed + E.BAEVER_R && dy < q.naerhed + E.BAEVER_R) return null;
    } else if (Math.hypot(dx, dy) < (q.lunte > 0 ? (q.detonation?.radius || 52) + E.BAEVER_R : 40)) return null;
  }
  if (v.kasser.some((k) => !k.doed && Math.hypot(k.x - x, k.y - y) < 40)) return null;
  return { x, y };
}

/** De sikre steder pr. liste (Map nøgle -> lagene [[{ x, y }], …]). rng:
 *  hvert lag blandes med den, i fast rækkefølge; null er prøvekørslen. */
function flytSteder(v, levende, rng) {
  const fort = v.terraen.fort;
  const lister = new Map();
  for (const b of levende) {
    const k = flytNoegle(fort, b);
    if (lister.has(k)) continue;
    const set = new Set();
    lister.set(k, raaSteder(v, k).map((lag) => {
      const sikre = [];
      for (const p of lag) {
        const s = sikkertSted(v, p);
        if (!s || set.has(`${s.x},${s.y}`)) continue;
        set.add(`${s.x},${s.y}`);
        sikre.push(s);
      }
      return rng ? rng.bland(sikre) : sikre;
    }));
  }
  return lister;
}

/** Planlæg flytningerne (Map id -> { x, y }). Hver kunde får et sikkert sted
 *  mindst FLYT_MIN fra, hvor den står (helst FLYT_GODT), og aldrig oven i en
 *  anden kunde.
 *
 *  byt: hvor de andre står NU, betyder intet — de flytter jo også — så to
 *  kunder kan bytte etage; kun de andres nye steder er optaget. Den, der
 *  intet finder, bliver stående, og en kunde, der skulle lande oven i den,
 *  planlægges om. Uden byt tager kunderne tur: de nye steder for dem, der
 *  har valgt, og de gamle for resten er optaget — så kan ingen lande oven i
 *  en, der bliver stående, og på en trang bane flytter flest mulige. */
function planlaegFlyt(v, levende, lister, byt) {
  const fort = v.terraen.fort;
  const plan = new Map();
  const bliver = [];
  const planlaeg = (b) => {
    const optaget = byt ? [...plan.values(), ...bliver]
      : levende.filter((x) => x !== b).map((x) => plan.get(x.id) || x);
    const lagene = lister.get(flytNoegle(fort, b)) || [];
    const find = (min) => {
      for (const lag of lagene) {
        for (const s of lag) {
          if (Math.hypot(s.x - b.x, s.y - b.y) >= min && !optaget.some((q) => kolliderer(q, s))) return s;
        }
      }
      return null;
    };
    const valgt = find(FLYT_GODT) || find(FLYT_MIN);
    if (valgt) plan.set(b.id, valgt); else bliver.push(b);
  };
  for (const b of levende) planlaeg(b);
  for (let omigen = byt; omigen;) {
    omigen = false;
    for (const b of levende) {
      const s = plan.get(b.id);
      if (!s || !bliver.some((q) => kolliderer(q, s))) continue;
      plan.delete(b.id);
      planlaeg(b);
      omigen = true;
    }
  }
  return plan;
}

/** Den bedste plan: med byt, eller uden, hvis den flytter flere. */
function bedstePlan(v, levende, lister) {
  const a = planlaegFlyt(v, levende, lister, true);
  if (a.size === levende.length) return a;
  const b = planlaegFlyt(v, levende, lister, false);
  return b.size > a.size ? b : a;
}

/** Flyt alle levende kunder. Returnerer [{ baever, fraX, fraY, x, y }] for
 *  dem, der faktisk flyttede. Lodtrækningens plan bruges; flytter den færre
 *  end prøvekørslens (kanSke), bruges den — så passer banneret. */
function flytAlle(v) {
  const t = v.terraen;
  const levende = v.baevere.filter((b) => !b.doed);
  let plan = bedstePlan(v, levende, flytSteder(v, levende, v.rngSim));
  if (plan.size < levende.length) {
    const fast = bedstePlan(v, levende, flytSteder(v, levende, null));
    if (fast.size > plan.size) plan = fast;
  }
  const flyt = [];
  for (const b of levende) {
    const s = plan.get(b.id);
    if (!s) continue;
    flyt.push({ baever: b.id, fraX: Math.round(b.x), fraY: Math.round(b.y), x: s.x, y: s.y });
    b.x = s.x; b.y = s.y;
    b.vx = 0; b.vy = 0; b.paaJorden = true; b.faldFra = null;
    F.frigoer(t, b);
  }
  return flyt;
}
