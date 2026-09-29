/* Kundekrigen — de otte våbenarketyper.
 *
 * Hvert våben i weapons.js peger på én af disse. Det er hele grunden til at
 * tabellen kan være ren data: opførslen deles, kun tallene varierer.
 *
 * AFVISNING: kan et våben ikke bruges lige nu (Fjernsupport uden et frit
 * sted, et kraftfelt der allerede er oppe), sætter arketypen h.afvist = true.
 * Så bruger world.js hverken ammunition eller tur.
 */
'use strict';

import { klem } from '../core/math.js';
import { lavProjektil, lavPlaceret, BAEVER_R, BAEVER_H, afstandTilHitbox } from './entities.js';
import { eksploder, givSkade } from './damage.js';
import { kapselFri } from './physics.js';
import { FJELD } from './terrain.js';
import { K } from './commands.js';
import { foersteFare, FARE_STRAALE_TOL, ramt as ramtFare, saetKilde } from './farer.js';

const MUNDING = 22;          // afstand fra skulderen til tonerkanonens munding
const SKULDER = 15;          // skulderhøjde over fodpunktet (figur_view.js)
const SKULDER_FREM = 7;      // skulderen sidder foran kroppens midte

/* Systemnedbrud. Tunnelen graves om kapslens MIDTE, så en kapsel med r 17
 * altid giver plads til hele kunden (hjørnerne ligger 16 wu fra midten). */
const BOR_MIDTE = BAEVER_R + BAEVER_H / 2;
const BOR_LOG = 4;           // én logget kapsel pr. 4 tick
const BOR_VAND = 30;         // boret kommer aldrig tættere på havet end dette
const BOR_FORAN = 12;        // så langt foran boret ses der efter hav og huler
const BOR_SPIDS = 19;        // spidsens afstand fra tunnelens midte
const BOR_LUFT = 10;         // så mange tick må spidsen stå i luft (små huler) — så stopper boret

/* Fjernsupport: hvor tæt på havet man må lande, og hvor langt op der ledes
 * efter et frit sted, hvis markøren står inde i bjerget. */
const TELEPORT_VAND = 40;
const TELEPORT_SOEG = 240;

/* Skuddet udgår fra SKULDEREN, hvor figuren bærer våbnet — ikke fra
 * bevægelseskapslens midte, som ligger i hoftehøjde. Så passer projektilets
 * startpunkt og sigtelinjen med den bazooka, spilleren ser. */
export function mundingsPunkt(b) {
  const cx = b.x + SKULDER_FREM * b.retning, cy = b.y + SKULDER;
  const v = b.vinkel;
  const dx = Math.cos(v) * b.retning, dy = Math.sin(v);
  return { x: cx + dx * MUNDING, y: cy + dy * MUNDING, dx, dy };
}

/** Affyr et våben. Returnerer hændelser; muterer verden. */
export function affyr(v, b, vaaben, kraft01, ekstra = {}) {
  const h = [];
  const m = mundingsPunkt(b);

  switch (vaaben.arketype) {
    case 'ballistisk': return ballistisk(v, b, vaaben, kraft01, m, h);
    case 'klynge': return ballistisk(v, b, vaaben, kraft01, m, h);   // samme affyring
    case 'hitscan': return hitscan(v, b, vaaben, m, h);
    case 'straale': return straale(v, b, vaaben, m, h);
    case 'naerkamp': return naerkamp(v, b, vaaben, h);
    case 'placeret': return placeret(v, b, vaaben, h);
    case 'luftangreb': return luftangreb(v, b, vaaben, ekstra, h);
    case 'redskab': return redskab(v, b, vaaben, ekstra, h);
    default: return h;
  }
}

// ---------------------------------------------------------------- ballistisk

function ballistisk(v, b, w, kraft01, m, h) {
  const k = w.kraft;
  const fart = k.min + (k.max - k.min) * klem(kraft01, 0, 1);
  // En fast lunte på projektilet (COVID) går forud for den valgte (F).
  const lunte = w.projektil.lunte ? Math.round(w.projektil.lunte * 60)
              : w.lunte ? Math.round((v.valgtLunte || w.lunte.start) * 60) : -1;
  const p = lavProjektil(v.nytId(), {
    x: m.x, y: m.y,
    vx: m.dx * fart, vy: m.dy * fart,
    r: w.projektil.r,
    vindFaktor: w.projektil.vindFaktor,
    hop: w.projektil.hop,
    rammerBaevere: w.projektil.rammerBaevere,
    detonation: w.detonation || null,
    fyld: w.fyld || null,
    klynge: w.klynge || null,
    smitte: w.smitte || null,
    lunte,
    ejer: b.id, ejerHold: b.hold,
    sprite: w.projektil.sprite, spor: w.projektil.spor,
  });
  v.projektiler.push(p);
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: m.x, y: m.y, kraft: kraft01 });
  return h;
}

/** Klyngedeling. Kaldes fra world.js når et klyngeprojektil detonerer. */
export function delKlynge(v, p) {
  const kl = p.klynge;
  if (!kl) return [];
  const h = [];
  for (let i = 0; i < kl.antal; i++) {
    const t = kl.antal === 1 ? 0.5 : i / (kl.antal - 1);
    const vinkel = Math.PI / 2 + (t - 0.5) * kl.spredning;
    const fart = kl.fart * (0.8 + v.rngSim() * 0.4);
    const barn = kl.barn;
    v.projektiler.push(lavProjektil(v.nytId(), {
      x: p.x, y: p.y,
      vx: Math.cos(vinkel) * fart, vy: Math.sin(vinkel) * fart,
      r: barn.r, vindFaktor: barn.vindFaktor, hop: barn.hop,
      rammerBaevere: barn.rammerBaevere,
      detonation: barn.detonation,
      lunte: barn.lunte ? Math.round(barn.lunte * 60) : -1,
      ejer: p.ejer, ejerHold: p.ejerHold, sprite: barn.sprite,
      kaedeId: p.kaedeId ?? p.id,
    }));
  }
  h.push({ navn: 'klyngeDelt', x: p.x, y: p.y, antal: kl.antal });
  return h;
}

/**
 * COVID-skyen. Kaldes fra world.js, når virussen rammer en kunde, eller når
 * dens lunte løber ud. Ingen eksplosion, intet krater: alle levende kunder,
 * hvis træfzone er inden for skyen, bliver smittet — undtagen dem bag et
 * kraftfelt.
 */
export function smitteSky(v, x, y, sm, h = []) {
  for (const b of v.baevere) {
    if (b.doed) continue;
    if (afstandTilHitbox(b, x, y) > sm.r) continue;
    if (b.skjold) {
      h.push({ navn: 'skjoldBlok', baever: b.id, x: b.x, y: b.y, skade: 0, aarsag: 'covid' });
      continue;
    }
    b.smittet = sm.turer;
    h.push({ navn: 'smittet', baever: b.id, fra: null, turer: b.smittet, x: b.x, y: b.y });
  }
  h.push({ navn: 'covidSky', x, y, r: sm.r });
  return h;
}

// ---------------------------------------------------------------- stråler

/** Første levende kunde (ikke skytten) langs en stråle, inden for maks. */
function foersteKunde(v, b, m, dx, dy, maks) {
  let bedst = null, bedstD = maks;
  for (const maal of v.baevere) {
    if (maal.doed || maal.id === b.id) continue;
    // Stråle mod træfzonen: gå strålen igennem i skridt på 3 wu. Det er
    // få hundrede tjek pr. skud og rammer præcis den samme zone som
    // projektilerne, i stedet for en approksimation om kropsmidten.
    for (let s = 0; s < bedstD; s += 3) {
      if (afstandTilHitbox(maal, m.x + dx * s, m.y + dy * s) <= 0.5) {
        bedst = maal; bedstD = s; break;
      }
    }
  }
  return { maal: bedst, d: bedstD };
}

/** Første fare langs strålen før terrænet og før den ramte kunde (kundeD,
 *  eller null). Den præcise stråle først: når den rammer kunden før en fare,
 *  får kunden skuddet. Tolerancen (FARE_STRAALE_TOL, for gæsternes
 *  forsinkede billede af farerne) gælder kun, når strålen ikke rammer
 *  nogen kunde. Ellers tog en fare, der ligger bag kunden, et rent træf. */
function fareLangsStraale(v, b, m, dx, dy, raekkevidde, terraenD, kundeD, kun = null) {
  const maks = Math.min(raekkevidde, terraenD);
  const praecis = foersteFare(v, m, dx, dy, kundeD == null ? maks : Math.min(maks, kundeD), kun, 0);
  if (praecis.fare || kundeD != null) return praecis;
  return foersteFare(v, m, dx, dy, maks, kun, FARE_STRAALE_TOL, b);
}

function hitscan(v, b, w, m, h) {
  const hs = w.hitscan;
  for (let s = 0; s < (hs.skud || 1); s++) {
    const spred = (v.rngSim() - 0.5) * 2 * (hs.spredning || 0);
    const vinkel = Math.atan2(m.dy, m.dx) + spred;
    const dx = Math.cos(vinkel), dy = Math.sin(vinkel);

    // Nærmeste kunde langs strålen — før terrænet, hvis den er tættere.
    const { maal: bedst, d: bedstD } = foersteKunde(v, b, m, dx, dy, hs.raekkevidde);
    const traef = v.terraen.straale(m.x, m.y, dx, dy, hs.raekkevidde, 2);
    const terraenD = traef ? traef.afstand : Infinity;
    // En fare (sim/farer.js) foran både kunden og terrænet: scanneren
    // antænder den — eller leverer dronens pakke til skyttens klinik.
    const { fare, d: fareD } = fareLangsStraale(v, b, m, dx, dy, hs.raekkevidde, terraenD,
                                                bedst && bedstD <= terraenD ? bedstD : null);

    if (fare) {
      const r = ramtFare(fare);
      r.straale = true;
      saetKilde(r, { kaede: 0, kaedeId: -v.tick, kildeHold: b.hold, kildeBaever: b.id });
      h.push({ navn: 'straale', x0: m.x, y0: m.y, x1: m.x + dx * fareD, y1: m.y + dy * fareD, traf: true,
               vaaben: w.id, fare: fare.id });
    } else if (bedst && bedstD <= terraenD) {
      // Strålen ender dér, hvor den faktisk ramte — ikke ved fødderne.
      const x1 = m.x + dx * bedstD, y1 = m.y + dy * bedstD;
      h.push({ navn: 'straale', x0: m.x, y0: m.y, x1, y1, traf: true,
               vaaben: w.id, baever: bedst.id, skade: hs.skade });
      givSkade(v, bedst, hs.skade, 'hitscan', h);
      if (!bedst.skjold) {
        bedst.vx += dx * hs.knockback;
        bedst.vy += dy * hs.knockback * 0.5 + 60;
        if (bedst.paaJorden) { bedst.paaJorden = false; bedst.faldFra = bedst.y; }
      }
    } else if (traef) {
      v.terraen.carve(traef.x, traef.y, hs.carveR);
      h.push({ navn: 'krater', x: traef.x | 0, y: traef.y | 0, r: hs.carveR, k: 0 });
      h.push({ navn: 'straale', x0: m.x, y0: m.y, x1: traef.x, y1: traef.y, traf: false, vaaben: w.id });
    } else {
      h.push({ navn: 'straale', x0: m.x, y0: m.y,
               x1: m.x + dx * hs.raekkevidde, y1: m.y + dy * hs.raekkevidde, traf: false, vaaben: w.id });
    }
  }
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: m.x, y: m.y });
  return h;
}

/**
 * Tvangsopdateringen: en kort stråle uden skade og uden skub. Den første
 * kunde, strålen rammer, stopper den. Er det en modstander uden kraftfelt,
 * springer vedkommende sin næste tur over (b.springOver, se world.js).
 */
function straale(v, b, w, m, h) {
  const st = w.straale;
  const dx = m.dx, dy = m.dy;
  const { maal, d } = foersteKunde(v, b, m, dx, dy, st.raekkevidde);
  const traef = v.terraen.straale(m.x, m.y, dx, dy, st.raekkevidde, 2);
  const terraenD = traef ? traef.afstand : Infinity;
  // Robotstøvsugeren kan også tvangsopdateres: pause i 300 tick (sim/farer.js).
  const { fare, d: fareD } = fareLangsStraale(v, b, m, dx, dy, st.raekkevidde, terraenD,
                                              maal && d <= terraenD ? d : null, 'stoevsuger');

  if (fare) {
    const r = ramtFare(fare);
    r.opdatering = true;
    saetKilde(r, { kaede: 0, kaedeId: -v.tick, kildeHold: b.hold, kildeBaever: b.id });
    h.push({ navn: 'straale', x0: m.x, y0: m.y, x1: m.x + dx * fareD, y1: m.y + dy * fareD, traf: true,
             vaaben: w.id, fare: fare.id });
  } else if (maal && d <= terraenD) {
    const x1 = m.x + dx * d, y1 = m.y + dy * d;
    h.push({ navn: 'straale', x0: m.x, y0: m.y, x1, y1, traf: true, vaaben: w.id, baever: maal.id });
    if (maal.hold !== b.hold) {
      if (maal.skjold) {
        h.push({ navn: 'skjoldBlok', baever: maal.id, x: maal.x, y: maal.y, skade: 0, aarsag: 'opdatering' });
      } else {
        maal.springOver = 1;
        h.push({ navn: 'opdateringRamt', baever: maal.id, fra: b.id, x: maal.x, y: maal.y });
      }
    }
  } else if (traef) {
    h.push({ navn: 'straale', x0: m.x, y0: m.y, x1: traef.x, y1: traef.y, traf: false, vaaben: w.id });
  } else {
    h.push({ navn: 'straale', x0: m.x, y0: m.y,
             x1: m.x + dx * st.raekkevidde, y1: m.y + dy * st.raekkevidde, traf: false, vaaben: w.id });
  }
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: m.x, y: m.y });
  return h;
}

// ---------------------------------------------------------------- nærkamp

/* Klageklask: svinget starter ved affyr, men slaget rammer først efter
 * nk.forsinkelse tick. Det ligger som en forsinket handling i v.forsinkede,
 * så verden ikke falder til ro, før klasket er landet. Retningen låses ved
 * affyr; stedet er dér, kunden står, når slaget lander. */
function naerkamp(v, b, w, h) {
  const nk = w.naerkamp;
  const retning = b.retning >= 0 ? 1 : -1;
  const cx = b.x + retning * nk.raekkevidde * 0.5;
  const cy = b.y + BAEVER_R + BAEVER_H * 0.5;
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: cx, y: cy });
  if (nk.forsinkelse > 0) {
    v.forsinkede.push({ tick: v.tick + nk.forsinkelse,
                        udfoer: (vv, hh) => klask(vv, b, nk, retning, hh) });
  } else {
    klask(v, b, nk, retning, h);
  }
  return h;
}

function klask(v, b, nk, retning, h) {
  if (b.doed) return;
  const cx = b.x + retning * nk.raekkevidde * 0.5;
  const cy = b.y + BAEVER_R + BAEVER_H * 0.5;
  const ramt = [];
  for (const maal of v.baevere) {
    if (maal.doed || maal.id === b.id) continue;
    const mx = maal.x, my = maal.y + BAEVER_R + BAEVER_H * 0.5;
    if (Math.abs(mx - cx) > nk.raekkevidde * 0.5 + BAEVER_R) continue;
    if (Math.abs(my - cy) > nk.hoejde) continue;
    ramt.push(maal.id);
    givSkade(v, maal, nk.skade, 'naerkamp', h);
    if (maal.skjold) continue;
    maal.vx += retning * nk.impulsX;
    maal.vy += nk.impulsY;
    maal.paaJorden = false;
    maal.faldFra = maal.y;
  }
  // Kabelsalaten slås væk, støvsugeren vender (sim/farer.js). Dronen flyver for højt.
  const farer = [];
  for (const f of v.farer || []) {
    if (f.vaek || f.slags === 'drone') continue;
    if (Math.abs(f.x - cx) > nk.raekkevidde * 0.5 + f.r || Math.abs(f.y + f.hy - cy) > nk.hoejde) continue;
    const r = ramtFare(f);
    r.klask = retning;
    saetKilde(r, { kaede: 0, kaedeId: -v.tick, kildeHold: b.hold, kildeBaever: b.id });
    farer.push(f.id);
  }
  h.push({ navn: 'klask', baever: b.id, maal: ramt, x: cx, y: cy, retning, farer });
}

// ---------------------------------------------------------------- placeret

function placeret(v, b, w, h) {
  const pl = w.placeret;
  v.placerede.push(lavPlaceret(v.nytId(), {
    x: b.x, y: b.y + 4,
    lunte: pl.lunte, naerhed: pl.naerhed, armering: pl.armering || 0,
    detonation: w.detonation, ejer: b.id, ejerHold: b.hold, sprite: pl.sprite,
  }));
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: b.x, y: b.y });
  return h;
}

// ---------------------------------------------------------------- luftangreb

function luftangreb(v, b, w, ekstra, h) {
  const la = w.luftangreb;
  const maalX = ekstra.x ?? b.x;
  const retning = (ekstra.retning ?? 1) >= 0 ? 1 : -1;
  for (let i = 0; i < la.antal; i++) {
    // Spredningen trækkes NU fra rngSim, i fast rækkefølge — ens hos alle.
    const jitter = la.jitter ? (v.rngSim() - 0.5) * 2 * la.jitter : 0;
    const x = maalX + (i - (la.antal - 1) / 2) * la.spredning * retning + jitter;
    v.forsinkede.push({
      tick: v.tick + i * la.mellemrum,
      lav: () => {
        // Skråt ind fra himlen — men under grottens loft falder de lige ned
        // fra loftet over markøren (world.nedfaldY), ellers rammer de kun loftet.
        const yLoft = v.nedfaldY?.(x, 60, ekstra.y);
        const loft = yLoft != null && yLoft < v.terraen.h;
        return lavProjektil(v.nytId(), {
          x: loft ? x : x - retning * 220, y: loft ? yLoft : v.terraen.h + 60,
          vx: loft ? 0 : retning * 120, vy: -la.fart,
          r: w.projektil.r, vindFaktor: w.projektil.vindFaktor,
          hop: 0, rammerBaevere: true,
          detonation: w.detonation, ejer: b.id, ejerHold: b.hold,
          sprite: w.projektil.sprite, spor: w.projektil.spor,
        });
      },
    });
  }
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: maalX, y: v.terraen.h, retning });
  return h;
}

// ---------------------------------------------------------------- redskaber

function redskab(v, b, w, ekstra, h) {
  switch (w.redskab) {
    case 'bor': {
      // Systemnedbrud: boret starter lige ned og arbejder i spillerens egen
      // tur (world.js afslutter turen, når det stopper).
      const bo = w.bor;
      b.redskab = { slags: 'bor', vaaben: w.id, r: bo.r, fart: bo.fart, tilbage: bo.tid,
                    styrbar: !!bo.styrbar, drej: bo.drej || 0, kurs: -Math.PI / 2,
                    sidstX: b.x, sidstY: b.y, tael: 0, stop: false, vinkel0: b.vinkel, luft: 0 };
      b.graver = true;
      b.vx = 0; b.vy = 0;
      b.vinkel = b.redskab.kurs;
      h.push({ navn: 'redskabStart', slags: 'bor', baever: b.id, vaaben: w.id });
      break;
    }
    case 'skjold':
      // Hjemmearbejde: kraftfeltet holder til holdets næste tur (world.js).
      if (b.skjold) { h.afvist = true; break; }
      b.skjold = true;
      h.push({ navn: 'skjoldOp', baever: b.id, x: b.x, y: b.y });
      break;
    case 'rampe': {
      // Én skrå plade, hvis overside starter lige under fødderne og stiger
      // i den retning, kunden vender.
      const r = w.rampe, dir = b.retning >= 0 ? 1 : -1;
      const a = r.vinkel, cos = Math.cos(a), sin = Math.sin(a);
      const ex = b.x + dir * r.start, ey = b.y - 1;
      const nx = -sin * dir, ny = cos;                       // oversidens normal
      // Heltal, fordi op-loggen gemmer heltal: så stempler værten, gæsterne
      // og en afspilning præcis den samme plade.
      const cx = (ex + dir * cos * r.halvL - nx * r.halvT) | 0;
      const cy = (ey + sin * r.halvL - ny * r.halvT) | 0;
      const vinkel = dir * a;
      v.terraen.bjaelke(cx, cy, r.halvL, r.halvT, vinkel);
      h.push({ navn: 'krater', k: 1, x: cx, y: cy, hl: r.halvL, ht: r.halvT, v: vinkel });
      h.push({ navn: 'terraenBygget', slags: 'rampe', x: b.x | 0, y: b.y | 0 });
      for (const bb of v.baevere) if (!bb.doed) v.frigoerBaever(bb);
      break;
    }
    case 'skum': {
      // Byggeskum: en stor klump præcis dér, markøren står (inden for rækkevidde).
      let x = ekstra.x ?? b.x, y = ekstra.y ?? b.y;
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy), maks = w.skum.raekkevidde;
      if (d > maks) { x = b.x + dx / d * maks; y = b.y + dy / d * maks; }
      v.terraen.fyld(x, y, w.skum.r);
      h.push({ navn: 'krater', x: x | 0, y: y | 0, r: w.skum.r, k: 3 });
      h.push({ navn: 'terraenBygget', slags: 'skum', x: x | 0, y: y | 0 });
      for (const bb of v.baevere) if (!bb.doed) v.frigoerBaever(bb);
      break;
    }
    case 'teleport': {
      const sted = teleportMaal(v, ekstra.x ?? b.x, ekstra.y ?? b.y);
      if (!sted) {
        // Intet sikkert sted: ingen ammunition brugt, og turen fortsætter.
        h.push({ navn: 'teleportAfvist', baever: b.id });
        h.afvist = true;
        break;
      }
      h.push({ navn: 'teleport', baever: b.id, fraX: b.x, fraY: b.y, x: sted.x, y: sted.y });
      b.x = sted.x; b.y = sted.y; b.vx = 0; b.vy = 0;
      b.paaJorden = false; b.faldFra = b.y;
      break;
    }
    case 'staa_over':
      h.push({ navn: 'staaOver', baever: b.id });
      break;
    case 'overgiv':
      for (const bb of v.baevere) {
        if (bb.hold === b.hold && !bb.doed) {
          bb.hp = 0; bb.doed = true; bb.drukner = true;
          h.push({ navn: 'doedsfald', baever: bb.id, navnTekst: bb.navn, hold: bb.hold,
                   x: bb.x, y: bb.y });
        }
      }
      h.push({ navn: 'overgivet', hold: b.hold });
      break;
  }
  return h;
}

/**
 * Hvor Fjernsupport må sætte kunden. x klemmes ind på banen; et mål under
 * havet (plus en margen) afvises; står markøren i bjerget, ledes der opad
 * efter et sted, hvor hele kapslen er fri. Er der ingen fast grund under
 * stedet over vandet, ville kunden bare falde i havet — også det afvises.
 */
function teleportMaal(v, x0, y0) {
  const t = v.terraen;
  const x = klem(x0, BAEVER_R + 4, t.w - BAEVER_R - 4);
  const loft = t.h - (2 * BAEVER_R + BAEVER_H) - 4;
  const y = Math.min(y0, loft);
  if (!(y >= v.vandNiveau + TELEPORT_VAND)) return null;
  for (let dy = 0; dy <= TELEPORT_SOEG && y + dy <= loft; dy += 2) {
    const yy = y + dy;
    if (!kapselFri(t, x, yy)) continue;
    if (t.jordUnder(Math.round(x), Math.round(yy)) < v.vandNiveau) return null;
    return { x, y: yy };
  }
  return null;
}

// ---------------------------------------------------------------- boret

/** Kør et aktivt redskab ét tick. Returnerer true hvis det stadig arbejder;
 *  false betyder, at det netop er stoppet (redskabSlut er meldt). */
export function skridtRedskab(v, b, h) {
  const r = b.redskab;
  if (!r) return false;
  if (r.slags !== 'bor') { b.redskab = null; b.graver = false; return false; }

  // Styring: de holdte piletaster giver en ønsket retning, og kursen drejer
  // mod den ad den korteste vej. Kun kunden i tur, og kun mens den må styre.
  if (r.styrbar && b.id === v.tur.baeverId && v.accepterBevaegelse()) {
    const k = v.holdt;
    const mx = ((k & K.HOEJRE) ? 1 : 0) - ((k & K.VENSTRE) ? 1 : 0);
    const my = ((k & K.SIGT_OP) ? 1 : 0) - ((k & K.SIGT_NED) ? 1 : 0);
    if (mx || my) {
      const d = vinkelForskel(Math.atan2(my, mx), r.kurs);
      r.kurs = normVinkel(r.kurs + klem(d, -r.drej, r.drej));
    }
  }

  const cos = Math.cos(r.kurs), sin = Math.sin(r.kurs);
  const nx = b.x + cos * r.fart, ny = b.y + sin * r.fart;
  // Et bor borer i jorden: står spidsen i luft for længe (styret op af
  // jorden eller ud af en bjergside), stopper det, og kunden falder.
  r.luft = spidsIJord(v, r, nx, ny) ? 0 : (r.luft || 0) + 1;
  if (r.stop || r.tilbage <= 0 || r.luft > BOR_LUFT || borSpaerret(v, r, nx, ny)) {
    slutBor(v, b, h);
    return false;
  }

  b.x = nx; b.y = ny;
  b.vx = 0; b.vy = 0;                  // skub fra eksplosioner gemmes ikke til bagefter
  b.vinkel = r.kurs;                   // spejlet ved, hvilken vej boret peger
  if (Math.abs(cos) > 0.2) b.retning = cos > 0 ? 1 : -1;
  r.tilbage--;
  r.tael++;
  // Graveren arbejder hvert tick, men masken ændres KUN gennem loggede ops:
  // én kapsel pr. BOR_LOG tick. Så er værten, gæsterne og en afspilning af
  // op-loggen enige til sidste pixel.
  if (r.tael >= BOR_LOG) borKapsel(v, b, r, h);
  return true;
}

/** Stop et aktivt redskab med det samme (kunden døde, turen blev tvunget). */
export function stopRedskab(v, b, h) {
  if (b.redskab?.slags === 'bor') slutBor(v, b, h);
  else { b.redskab = null; b.graver = false; }
}

/** Må boret tage næste skridt? Aldrig ud af banen, aldrig ned mod havet,
 *  aldrig ud over havet eller en oversvømmet hule (så kunden falder i, når
 *  boret stopper), og aldrig ind i grundfjeldet. */
function borSpaerret(v, r, nx, ny) {
  const t = v.terraen;
  if (nx < BAEVER_R + 2 || nx > t.w - BAEVER_R - 2) return true;
  if (ny < 0 || ny + 2 * BAEVER_R + BAEVER_H > t.h - 2) return true;
  if (ny < v.vandNiveau + BOR_VAND) return true;
  const graense = v.vandNiveau + BOR_VAND;
  const cos = Math.cos(r.kurs), sin = Math.sin(r.kurs);
  for (const foran of [0, BOR_FORAN]) {
    const gx = Math.round(nx + cos * foran), gy = Math.round(ny + sin * foran) - 3;
    if (t.jordUnder(gx, gy) < graense) return true;
  }
  const cy = ny + BOR_MIDTE;
  for (const a of [0, -0.6, 0.6]) {
    const sx = Math.round(nx + Math.cos(r.kurs + a) * BOR_SPIDS);
    const sy = Math.round(cy + Math.sin(r.kurs + a) * BOR_SPIDS);
    if (t.hent(sx, sy) === FJELD) return true;
  }
  return false;
}

/** Er der jord foran spidsen (lige frem eller let til siden)? */
function spidsIJord(v, r, nx, ny) {
  const t = v.terraen, cy = ny + BOR_MIDTE;
  // Kun lige foran (±0,25 rad): med bredere prøver kunne boret skøjte hen
  // over overfladen, fordi prøven skråt nedad ramte jorden under det.
  for (const d of [BOR_SPIDS, BOR_SPIDS + 6]) {
    for (const a of [0, -0.25, 0.25]) {
      if (t.fast(Math.round(nx + Math.cos(r.kurs + a) * d), Math.round(cy + Math.sin(r.kurs + a) * d))) return true;
    }
  }
  return false;
}

/** Én logget kapsel fra sidste log til nu. Heltalskoordinater, fordi det er
 *  dem, loggen og krater-hændelsen bærer. Er kunden flyttet langt siden
 *  sidste log (en telefon stillede den videre), graves kun et hul, hvor den
 *  står — ellers skar kapslen en rende tværs over banen. */
function borKapsel(v, b, r, h) {
  const langt = Math.hypot(b.x - r.sidstX, b.y - r.sidstY) > BOR_LOG * r.fart + 2;
  const ax = (langt ? b.x : r.sidstX) | 0, ay = ((langt ? b.y : r.sidstY) + BOR_MIDTE) | 0;
  const bx = b.x | 0, by = (b.y + BOR_MIDTE) | 0;
  v.terraen.kapsel(ax, ay, bx, by, r.r);
  h.push({ navn: 'krater', x: ax, y: ay, x2: bx, y2: by, r: r.r, k: 2 });
  r.sidstX = b.x; r.sidstY = b.y;
  r.tael = 0;
}

function slutBor(v, b, h) {
  const r = b.redskab;
  borKapsel(v, b, r, h);               // den sidste kapsel, så kunden står frit
  b.redskab = null;
  b.graver = false;
  b.vx = 0; b.vy = 0;
  b.paaJorden = false;
  b.faldFra = b.y;
  if (r.vinkel0 !== undefined) b.vinkel = r.vinkel0;
  h.push({ navn: 'redskabSlut', slags: 'bor', baever: b.id, vaaben: r.vaaben });
}

const normVinkel = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};
const vinkelForskel = (maal, fra) => normVinkel(maal - fra);

export { eksploder };
