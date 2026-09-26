/* Kundekrigen — de syv våbenarketyper.
 *
 * Hvert våben i weapons.js peger på én af disse. Det er hele grunden til at
 * tabellen kan være ren data: opførslen deles, kun tallene varierer.
 */
'use strict';

import { DT } from '../core/tick.js';
import { klem } from '../core/math.js';
import { lavProjektil, lavPlaceret, BAEVER_R, BAEVER_H, afstandTilHitbox } from './entities.js';
import { eksploder, givSkade } from './damage.js';

const MUNDING = 22;          // afstand fra skulderen til tonerkanonens munding
const SKULDER = 15;          // skulderhøjde over fodpunktet (figur_view.js)
const SKULDER_FREM = 7;      // skulderen sidder foran kroppens midte

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
  const p = lavProjektil(v.nytId(), {
    x: m.x, y: m.y,
    vx: m.dx * fart, vy: m.dy * fart,
    r: w.projektil.r,
    vindFaktor: w.projektil.vindFaktor,
    hop: w.projektil.hop,
    rammerBaevere: w.projektil.rammerBaevere,
    detonation: w.detonation,
    klynge: w.klynge || null,
    lunte: w.lunte ? Math.round((v.valgtLunte || w.lunte.start) * 60) : -1,
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
    }));
  }
  h.push({ navn: 'klyngeDelt', x: p.x, y: p.y, antal: kl.antal });
  return h;
}

// ---------------------------------------------------------------- hitscan

function hitscan(v, b, w, m, h) {
  const hs = w.hitscan;
  for (let s = 0; s < (hs.skud || 1); s++) {
    const spred = (v.rngSim() - 0.5) * 2 * (hs.spredning || 0);
    const vinkel = Math.atan2(m.dy, m.dx) + spred;
    const dx = Math.cos(vinkel), dy = Math.sin(vinkel);

    // Nærmeste bæver langs strålen — før terrænet, hvis den er tættere.
    let bedst = null, bedstD = hs.raekkevidde;
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

    const traef = v.terraen.straale(m.x, m.y, dx, dy, hs.raekkevidde, 2);
    const terraenD = traef ? traef.afstand : Infinity;

    if (bedst && bedstD <= terraenD) {
      h.push({ navn: 'fuldtraeffer', baever: bedst.id, x: m.x + dx * bedstD, y: m.y + dy * bedstD, skade: hs.skade });
      givSkade(v, bedst, hs.skade, 'hitscan', h);
      bedst.vx += dx * hs.knockback;
      bedst.vy += dy * hs.knockback * 0.5 + 60;
      if (bedst.paaJorden) { bedst.paaJorden = false; bedst.faldFra = bedst.y; }
      h.push({ navn: 'straale', x0: m.x, y0: m.y, x1: bedst.x, y1: bedst.y, traf: true });
    } else if (traef) {
      v.terraen.carve(traef.x, traef.y, hs.carveR);
      h.push({ navn: 'krater', x: traef.x | 0, y: traef.y | 0, r: hs.carveR, k: 0 });
      h.push({ navn: 'straale', x0: m.x, y0: m.y, x1: traef.x, y1: traef.y, traf: false });
    } else {
      h.push({ navn: 'straale', x0: m.x, y0: m.y,
               x1: m.x + dx * hs.raekkevidde, y1: m.y + dy * hs.raekkevidde, traf: false });
    }
  }
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: m.x, y: m.y });
  return h;
}

// ---------------------------------------------------------------- nærkamp

function naerkamp(v, b, w, h) {
  const nk = w.naerkamp;
  const cx = b.x + b.retning * nk.raekkevidde * 0.5;
  const cy = b.y + BAEVER_R + BAEVER_H * 0.5;
  for (const maal of v.baevere) {
    if (maal.doed || maal.id === b.id) continue;
    const mx = maal.x, my = maal.y + BAEVER_R + BAEVER_H * 0.5;
    if (Math.abs(mx - cx) > nk.raekkevidde * 0.5 + BAEVER_R) continue;
    if (Math.abs(my - cy) > nk.hoejde) continue;
    givSkade(v, maal, nk.skade, 'naerkamp', h);
    maal.vx += b.retning * nk.impulsX;
    maal.vy += nk.impulsY;
    maal.paaJorden = false;
    maal.faldFra = maal.y;
  }
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: cx, y: cy });
  return h;
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
  const retning = ekstra.retning ?? 1;
  for (let i = 0; i < la.antal; i++) {
    v.forsinkede.push({
      tick: v.tick + i * la.mellemrum,
      lav: () => {
        const x = maalX + (i - (la.antal - 1) / 2) * la.spredning * retning;
        return lavProjektil(v.nytId(), {
          x: x - retning * 220, y: v.terraen.h + 60,
          vx: retning * 120, vy: -la.fart,
          r: w.projektil.r, vindFaktor: w.projektil.vindFaktor,
          hop: 0, rammerBaevere: true,
          detonation: w.detonation, ejer: b.id, ejerHold: b.hold,
          sprite: w.projektil.sprite, spor: w.projektil.spor,
        });
      },
    });
  }
  h.push({ navn: 'skudAffyret', vaaben: w.id, baever: b.id, x: maalX, y: v.terraen.h });
  return h;
}

// ---------------------------------------------------------------- redskaber

function redskab(v, b, w, ekstra, h) {
  switch (w.redskab) {
    case 'bor':
      b.redskab = { slags: 'bor', lodret: w.bor.lodret, r: w.bor.r,
                    fart: w.bor.fart, tilbage: w.bor.tid, sidstX: b.x, sidstY: b.y, tael: 0 };
      h.push({ navn: 'redskabStart', slags: 'bor', baever: b.id });
      break;
    case 'bjaelke': {
      const x = ekstra.x ?? b.x, y = ekstra.y ?? b.y;
      const vinkel = ekstra.vinkel ?? 0;
      v.terraen.bjaelke(x, y, w.bjaelke.halvL, w.bjaelke.halvT, vinkel);
      h.push({ navn: 'bjaelkeSat', x: x | 0, y: y | 0, hl: w.bjaelke.halvL,
               ht: w.bjaelke.halvT, v: vinkel });
      for (const bb of v.baevere) if (!bb.doed) v.frigoerBaever(bb);
      break;
    }
    case 'teleport': {
      const x = ekstra.x ?? b.x, y = ekstra.y ?? b.y;
      h.push({ navn: 'teleport', baever: b.id, fraX: b.x, fraY: b.y, x, y });
      b.x = x; b.y = y; b.vx = 0; b.vy = 0;
      b.paaJorden = false; b.faldFra = b.y;
      v.frigoerBaever(b);
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

/** Kør et aktivt redskab ét tick. Returnerer true hvis det stadig arbejder. */
export function skridtRedskab(v, b, h) {
  const r = b.redskab;
  if (!r) return false;

  if (r.slags === 'bor') {
    const dx = r.lodret ? 0 : b.retning * r.fart;
    const dy = r.lodret ? -r.fart : 0;
    b.x += dx; b.y += dy;
    r.tilbage--;
    r.tael++;
    // Graveren arbejder hvert tick. Ville vi logge én op per tick, blev det
    // tusindvis per brug — så vi samler otte tick i én kapsel. Visuelt det
    // samme, 8x færre ops på tråden.
    if (r.tael >= 8 || r.tilbage <= 0) {
      v.terraen.kapsel(r.sidstX, r.sidstY + BAEVER_R, b.x, b.y + BAEVER_R, r.r);
      h.push({ navn: 'krater', x: r.sidstX | 0, y: (r.sidstY + BAEVER_R) | 0,
               x2: b.x | 0, y2: (b.y + BAEVER_R) | 0, r: r.r, k: 2 });
      r.sidstX = b.x; r.sidstY = b.y;
      r.tael = 0;
    } else {
      v.terraen.carve(b.x, b.y + BAEVER_R, r.r, false);
    }
    if (r.tilbage <= 0 || v.terraen.udenfor(b.x, b.y)) {
      b.redskab = null;
      b.paaJorden = false;
      b.faldFra = b.y;
      h.push({ navn: 'redskabSlut', baever: b.id });
      return false;
    }
    return true;
  }
  return false;
}

export { eksploder };
