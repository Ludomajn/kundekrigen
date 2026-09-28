/* Kundekrigen — fysik. Hovedløs: ingen three.js, ingen DOM, ingen Math.random.
 *
 * Fast 60 Hz. Alle konstanter er i world units per sekund (eller per sekund²),
 * og dt ganges på ét sted, så tallene kan læses direkte som "hvor hurtigt".
 */
'use strict';

import { DT } from '../core/tick.js';
import { klem, normaliser, reflekter } from '../core/math.js';
import { BAEVER_R, BAEVER_H, afstandTilHitbox } from './entities.js';

export const TYNGDE = 480;
export const MAKS_FALD = 780;
export const GANGFART = 105;
export const TRIN_OP = 4;             // op til ~66° pr. skridt
export const TRIN_NED = 4;
export const HOP_VX = 160, HOP_VY = 235;
export const SALTO_VX = 90, SALTO_VY = 330;
export const VIND_ACC = 110;

/* Vejrets fysik for VINDFØLSOMME projektiler (vindFaktor > 0). Våben, der
 * ignorerer vinden — granater, koglebomber — ignorerer også vejret.
 *   kraft     ganges på vinden: regn og slud forstærker den, sne og tåge
 *             dæmper den
 *   modstand  luftmodstand pr. sekund: regn og især sne bremser skuddet,
 *             så det taber fart og falder kortere
 *   puls      vindstød: hvor meget vinden svinger omkring rullens værdi
 * Sigtelinjen integrerer med de samme tal (fx.js), så spilleren SER, hvad
 * vejret gør ved skuddet — HUD'en må aldrig lyve. */
export const VEJR_FYSIK = {
  solskin:   { kraft: 1.0,  modstand: 0,    puls: 0.08 },
  overskyet: { kraft: 1.15, modstand: 0.03, puls: 0.18 },
  regn:      { kraft: 1.4,  modstand: 0.18, puls: 0.35 },
  slud:      { kraft: 1.55, modstand: 0.25, puls: 0.5 },
  sne:       { kraft: 0.75, modstand: 0.3,  puls: 0.12 },
  taage:     { kraft: 0.45, modstand: 0.08, puls: 0.05 },
};

/**
 * Den EFFEKTIVE vind i et givet tick: rullens vind ganget vejrets kraft og
 * moduleret af vindstød. Ren funktion af (vind, vejr, tick, froe), så alle
 * klienter regner det samme, og et snapshot er nok til at genskabe den.
 */
export function vindNu(vind, vejr, tick, froe = 0) {
  const f = VEJR_FYSIK[vejr] || VEJR_FYSIK.solskin;
  const t = tick / 60;
  const fase = (froe % 628) / 100;
  const stoed = 0.6 * Math.sin(t * 0.9 + fase) + 0.4 * Math.sin(t * 2.31 + 1.7 + fase * 0.6);
  return vind * f.kraft * (1 + f.puls * stoed);
}

export const luftmodstand = (vejr) => (VEJR_FYSIK[vejr] || VEJR_FYSIK.solskin).modstand;
// Et hop når ~57 wu op og en baglæns salto ~113 wu; ingen af dem må gøre
// ondt på flad jord. Først et rigtigt fald (tre figurhøjder+) koster.
export const FALD_GRAENSE = 150;      // wu man må falde gratis
export const FALD_DELER = 9;
export const FALD_MAKS = 25;

/** Er bæverkapslen fri i (x, y)? y er fodpunktet. */
export function kapselFri(t, x, y) {
  const x0 = Math.round(x - BAEVER_R + 2), x1 = Math.round(x + BAEVER_R - 2);
  const y0 = Math.round(y + 1), y1 = Math.round(y + BAEVER_H + BAEVER_R);
  for (let yy = y0; yy <= y1; yy += 3) {
    for (let xx = x0; xx <= x1; xx += 3) if (t.fast(xx, yy)) return false;
  }
  return true;
}

/**
 * Står bæveren på jorden?
 *
 * Defineret UD FRA kapselFri, ikke som en selvstændig sampling: bæveren står
 * på jorden hvis kapslen er fri hvor den er, men ikke ville være det ét skridt
 * længere nede. To uafhængige samplinger af terrænet kommer før eller siden
 * til at være uenige — og uenigheden viser sig som en bæver der oscillerer
 * mellem "på jorden" og "i luften" og derved forhindrer verden i at falde til
 * ro. Her er de to prædikater konsistente ved konstruktion.
 */
export function paaJorden(t, x, y) {
  return kapselFri(t, x, y) && !kapselFri(t, x, y - 1);
}

/** Skub en bæver op, hvis terrænet er vokset ind i den (bjælke, vandstigning). */
export function frigoer(t, b) {
  for (let i = 0; i < 40 && !kapselFri(t, b.x, b.y); i++) b.y += 2;
}

/**
 * Gå ét skridt.
 *
 * Skråningsgrænsen lagres bevidst IKKE som en vinkel. Vi foreslår et vandret
 * skridt og prøver lodrette forskydninger fra +TRIN_OP ned til -TRIN_NED. At
 * trinet nedad er større end trinet opad betyder, at bævere går stejlere ned
 * end op — det føles rigtigt og fjerner "svæver ned ad klippen".
 */
export function gaa(t, b, retning) {
  // Ingen luftkontrol, som i Worms. Uden dette løftede hvert gangskridt
  // kunden et trin op, mens den stadig var i luften efter det forrige —
  // og gangen blev til en række små hop.
  if (!b.paaJorden) return false;
  const dx = retning * GANGFART * DT;
  const maalX = b.x + dx;
  // Øverste frie trin (et loft kan spærre de højeste)…
  let d = null;
  for (let dy = TRIN_OP; dy >= -TRIN_NED; dy--) {
    if (kapselFri(t, maalX, b.y + dy)) { d = dy; break; }
  }
  if (d === null) return false;          // blokeret — kunden bumper og bliver stående
  // …og derfra ned, til fødderne rammer jorden. Det LAVESTE frie sted er
  // der, hvor kunden står; det øverste er luft.
  while (d > -TRIN_NED && kapselFri(t, maalX, b.y + d - 1)) d--;
  b.x = maalX; b.y += d;
  if (!paaJorden(t, b.x, b.y)) {
    // Kanten af en afsats: træd ud og fald.
    b.paaJorden = false; b.faldFra = b.y;
  }
  return true;
}

export function hop(b, salto = false) {
  if (!b.paaJorden) return false;
  b.vx = salto ? -b.retning * SALTO_VX : b.retning * HOP_VX;
  b.vy = salto ? SALTO_VY : HOP_VY;
  b.paaJorden = false;
  b.faldFra = b.y;
  b.hoppetid = 0;
  return true;
}

/** Integrér én bæver. Returnerer faldskade (0 hvis ingen). */
export function skridtBaever(t, b, vind) {
  if (b.doed) return 0;
  if (b.paaJorden) {
    b.vx = 0; b.vy = 0;
    if (!paaJorden(t, b.x, b.y)) { b.paaJorden = false; b.faldFra = b.y; }
    return 0;
  }

  b.vy -= TYNGDE * DT;
  if (b.vy < -MAKS_FALD) b.vy = -MAKS_FALD;
  // Bævere har ingen luftkontrol — som i Worms. Vind rører dem heller ikke.

  let nx = b.x + b.vx * DT;
  let ny = b.y + b.vy * DT;

  // Vandret kollision: stop, men bevar lodret fart.
  if (!kapselFri(t, nx, b.y)) { nx = b.x; b.vx *= -0.25; }

  if (!kapselFri(t, nx, ny)) {
    if (b.vy <= 0) {
      // Landing: gå ned til første sted hvor kapslen ikke længere er fri,
      // og stil bæveren lige ovenpå. Samme prædikat som paaJorden bruger.
      let y = Math.floor(b.y);
      while (y > Math.floor(ny) && kapselFri(t, nx, y - 1)) y--;
      while (!kapselFri(t, nx, y) && y < b.y + 60) y++;
      b.x = nx; b.y = y;
      b.paaJorden = paaJorden(t, nx, y);
      const faldt = b.faldFra !== null ? b.faldFra - b.y : 0;
      b.faldFra = null;
      b.vx = 0; b.vy = 0;
      if (faldt > FALD_GRAENSE) {
        return Math.min(FALD_MAKS, Math.floor((faldt - FALD_GRAENSE) / FALD_DELER));
      }
      return 0;
    }
    // Hoved i loftet.
    b.vy = 0;
    ny = b.y;
  }

  b.x = nx; b.y = ny;
  b.hoppetid++;
  if (b.faldFra === null || b.y > b.faldFra) b.faldFra = b.y;
  return 0;
}

// Langsommere end det efter et hop, og et hoppende kasteting sover (wu/s).
export const SOVEFART = 30;

/**
 * Bærer kunden et projektil, der ligger i (x, y)? Ja, hvis to wu længere nede
 * er inde i træfzonen — altså oven på figuren, ikke ved siden af den. Samme
 * prædikat afgør, om projektilet må falde i søvn på kunden, og om det skal
 * vågne igen; to forskellige tests ville før eller siden være uenige, og
 * granaten ville blinke mellem dvale og hop.
 */
function baererKunde(b, x, y, r) {
  return !!b && !b.doed && afstandTilHitbox(b, x, y - 2) <= r;
}

/**
 * Integrér et projektil med sveipet kollision.
 *
 * Vi marcherer fra p0 til p1 i skridt på højst 2 wu og sampler masken. Ved
 * første faste sample bakker vi til sidste frie — det er nedslagspunktet.
 * Uden sveip ville hurtige projektiler tunnelere gennem tynde vægge.
 */
export function skridtProjektil(t, p, vind, baevere, modstand = 0) {
  p.alder++;
  // Lunten brænder én gang pr. tick, hvad projektilet end ellers gør. Den
  // stod før nederst, og hvert hop sprang den over med en tidlig return: en
  // granat, der lå og prellede af et hoved, detonerede aldrig, og turen
  // ventede på vagthunden.
  if (p.lunte > 0) { p.lunte--; if (p.lunte === 0) return { slags: 'lunte', x: p.x, y: p.y }; }
  if (p.sover) {
    if (p.lunte === 0) return { slags: 'lunte', x: p.x, y: p.y };
    // Sover den på en kunde, vågner den, når kunden går eller dør under den —
    // ellers hang den i luften, hvor hovedet var.
    if (p.hvilerPaa == null || baererKunde(baevere.find((b) => b.id === p.hvilerPaa), p.x, p.y, p.r)) return null;
    p.sover = false; p.hvilerPaa = null;
  }

  p.vy -= TYNGDE * DT;
  p.vx += vind * p.vindFaktor * VIND_ACC * DT;
  if (modstand > 0 && p.vindFaktor > 0) {
    // Luftmodstand fra vejret: proportional bremsning, skaleret med våbnets
    // vindfølsomhed, så granater og redskaber ikke rammes.
    const k = 1 - modstand * p.vindFaktor * DT;
    p.vx *= k; p.vy *= k;
  }

  const x0 = p.x, y0 = p.y;
  const x1 = p.x + p.vx * DT, y1 = p.y + p.vy * DT;
  const dx = x1 - x0, dy = y1 - y0;
  const laengde = Math.sqrt(dx * dx + dy * dy);
  const trin = Math.max(1, Math.ceil(laengde / 2));

  let sidstX = x0, sidstY = y0;
  for (let i = 1; i <= trin; i++) {
    const f = i / trin;
    const px = x0 + dx * f, py = y0 + dy * f;

    for (const b of baevere) {
      if (b.doed) continue;
      if (b.id === p.ejer && p.alder < 8) continue;      // ram ikke skytten straks
      if (afstandTilHitbox(b, px, py) > p.r) continue;
      if (p.rammerBaevere) {
        // FULDTRÆFFER: raketten sprænger på figuren selv.
        p.x = px; p.y = py;
        return { slags: 'baever', x: px, y: py, baever: b };
      }
      if (p.hop > 0 && afstandTilHitbox(b, sidstX, sidstY) > p.r) {
        // Hoppende kasteting preller af figuren som af en væg — i Worms kan
        // man ramme en orm med en granat og se den trille tilbage.
        p.x = sidstX; p.y = sidstY;
        p.vx = -p.vx * p.hop;
        p.vy = Math.abs(p.vy) * p.hop * 0.5;
        // Er den faldet til ro oven på figuren, sover den dér som på
        // terrænet. Ellers trak tyngden den ned i hovedet og op igen hvert
        // tick, og den faldt aldrig til ro.
        if (Math.sqrt(p.vx * p.vx + p.vy * p.vy) < SOVEFART && baererKunde(b, sidstX, sidstY, p.r)) {
          p.sover = true; p.vx = 0; p.vy = 0; p.hvilerPaa = b.id;
        }
        return null;
      }
    }

    if (t.fast(px, py)) {
      p.x = sidstX; p.y = sidstY;
      const n = t.normal(px | 0, py | 0, p.vx, p.vy);
      if (p.hop > 0) {
        const r = reflekter(p.vx, p.vy, n.x, n.y);
        p.vx = r.x * p.hop;
        p.vy = r.y * p.hop;
        // Tangentiel friktion, så granater ikke skøjter evigt.
        p.vx *= 0.85;
        const fart = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (fart < SOVEFART) {
          // Sov — men lad lunten tikke videre. Uden dvale sitrer granater i
          // en sprække i det uendelige, og verden falder aldrig til ro.
          p.sover = true; p.vx = 0; p.vy = 0;
        }
        return null;
      }
      return { slags: 'terraen', x: px, y: py, normal: n };
    }

    if (t.udenfor(px, py)) { p.x = px; p.y = py; return { slags: 'ude' }; }
    sidstX = px; sidstY = py;
  }

  p.x = x1; p.y = y1;
  return null;
}

/** Simpel faldende genstand (kasser, placerede våben). */
export function skridtFaldende(t, e, vind = 0, drift = 0) {
  e.alder++;
  if (e.landet || e.paaJorden) return;
  e.vy -= TYNGDE * DT;
  if (drift) e.vx = vind * drift;
  const ny = e.y + e.vy * DT, nx = e.x + e.vx * DT;
  if (t.fast(nx, ny) || t.fast(nx, ny - 3)) {
    let y = Math.floor(e.y);
    while (y > ny && !t.fast(nx, y)) y--;
    e.x = nx; e.y = y + 1; e.vy = 0; e.vx = 0;
    e.landet = true; e.paaJorden = true;
    return;
  }
  e.x = nx; e.y = ny;
}

/** Faldskærm: kasser daler med konstant fart og driver med vinden. En kasse
 *  med xMin/xMax (fortets, world._slipVaabenkasse) driver kun inden for det
 *  stykke, den blev sluppet over. Driver den ind i en mur fra siden, glider
 *  den ned ad muren i stedet for at lande inde i den. */
export function skridtKasse(t, k, vind) {
  k.alder++;
  if (k.landet) return;
  const ny = k.y - 70 * DT;
  let nx = k.x + vind * 40 * DT;
  if (k.xMin != null) nx = Math.max(k.xMin, Math.min(k.xMax, nx));
  if (nx !== k.x && t.fast(nx, k.y)) nx = k.x;
  if (t.fast(nx, ny)) {
    k.x = nx; k.y = Math.ceil(ny) + 1; k.landet = true;
    return;
  }
  k.x = nx; k.y = ny;
  if (k.y < -40) k.landet = true;
}

export { klem, normaliser };
