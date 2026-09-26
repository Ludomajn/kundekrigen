/* Kundekrigen — eksplosioner, skade og død. */
'use strict';

import { normaliser } from '../core/math.js';
import { BAEVER_R, MAKS_HP, afstandTilHitbox, hitboxMidte } from './entities.js';

/**
 * Eksplosion.
 *
 * Det lodrette bias på (0, 0.35·radius) i impulsretningen er det der får
 * bævere til at POPPE OPAD ud af krateret i stedet for at glide sidelæns.
 * Uden det føles spillet som en fysikdemo; med det føles det som Worms.
 */
/* En fuldtræffer giver fuld skade plus dette tillæg — det skal kunne betale
 * sig at sigte på figuren frem for på jorden ved siden af. */
export const FULDTRAEF_BONUS = 1.3;

/* Hvor længe det sorte hul trækker, før liget detonerer (render/fx.sortHul). */
export const SORT_HUL_TICKS = 78;

export function eksploder(v, x, y, radius, maksSkade, knockback, carve = true, direkte = null) {
  const haendelser = [];

  if (carve) {
    v.terraen.carve(x, y, radius);
    haendelser.push({ navn: 'krater', x: x | 0, y: y | 0, r: radius | 0, k: 0 });
  }

  for (const b of v.baevere) {
    if (b.doed) continue;
    const dx = b.x - x, dy = hitboxMidte(b) - y;
    // Skaden falder med afstanden til træfZONEN, ikke til et punkt: et brag
    // ved hovedet rammer lige så hårdt som et ved fødderne.
    const erDirekte = direkte && b.id === direkte;
    const d = erDirekte ? 0 : afstandTilHitbox(b, x, y);
    if (d >= radius) continue;
    const f = erDirekte ? 1 : 1 - d / radius;
    const skade = Math.round(maksSkade * f * (erDirekte ? FULDTRAEF_BONUS : 1));
    if (erDirekte) haendelser.push({ navn: 'fuldtraeffer', baever: b.id, x, y, skade });
    if (skade > 0) givSkade(v, b, skade, erDirekte ? 'fuldtraeffer' : 'eksplosion', haendelser);

    const n = normaliser(dx || 0.001, dy + radius * 0.35);
    b.vx += n.x * knockback * f;
    b.vy += n.y * knockback * f;
    if (b.paaJorden) { b.paaJorden = false; b.faldFra = b.y; }
  }

  // Kædereaktioner køes og drænes én per tick. Det giver en klyngebombe en
  // tilfredsstillende rippel i stedet for ét samtidigt blink — og det
  // forhindrer ubegrænset rekursion.
  for (const e of v.placerede) {
    if (e.doed) continue;
    const dx = e.x - x, dy = e.y - y;
    if (dx * dx + dy * dy < radius * radius) {
      e.doed = true;
      v.eksplosionsKoe.push({ x: e.x, y: e.y, ...e.detonation });
      if (e.sprite === 'toende') haendelser.push({ navn: 'printerSprang', x: e.x, y: e.y });
    }
  }
  for (const k of v.kasser) {
    if (k.doed) continue;
    const dx = k.x - x, dy = k.y - y;
    if (dx * dx + dy * dy < radius * radius) {
      k.doed = true;
      v.eksplosionsKoe.push({ x: k.x, y: k.y, radius: 50, skade: 35, knockback: 220, carve: true });
    }
  }

  haendelser.push({ navn: 'eksplosion', x, y, radius });
  return haendelser;
}

export function givSkade(v, b, skade, aarsag, haendelser) {
  if (b.doed || skade <= 0) return;
  b.hp -= skade;
  b.sidsteSkade = skade;
  v.skadeITur = true;
  haendelser.push({ navn: 'skade', baever: b.id, skade, aarsag, x: b.x, y: b.y });
  if (b.hp <= 0) {
    b.hp = 0;
    b.doed = true;
    if (!v.doedskoe.includes(b.id)) v.doedskoe.push(b.id);
  }
}

export function faldskade(v, b, skade, haendelser) {
  givSkade(v, b, skade, 'fald', haendelser);
}

/** Drukning: ingen eksplosion, bare et farvel. */
export function tjekDrukning(v, haendelser) {
  for (const b of v.baevere) {
    if (b.doed) continue;
    if (b.y < v.vandNiveau) {
      b.hp = 0;
      b.doed = true;
      b.drukner = true;
      haendelser.push({ navn: 'drukner', baever: b.id, x: b.x, y: b.y });
    }
  }
}

/** Et lig detonerer for 25 ved 40 wu — Worms-opførsel, og det giver de gode
 *  kaskadeafslutninger. */
export function afvikleDoedsfald(v, haendelser) {
  if (!v.doedskoe.length) return false;
  const id = v.doedskoe.shift();
  const b = v.baevere.find((x) => x.id === id);
  if (!b) return true;
  // Druknede og dem, der faldt ud af banen, får ingen sten — der er intet
  // at stille den på. Stenen rejser med i hændelsen, så klienternes spejl
  // (der ikke simulerer) kan vise den med det samme.
  let grav = null;
  if (!b.drukner) {
    // Kunden suges først ind i et sort hul (præsentation, ~1,3 s); så smælder det.
    v.eksplosionsKoe.push({ x: b.x, y: b.y + BAEVER_R, radius: 40, skade: 25, knockback: 180, carve: true,
                            tick: v.tick + SORT_HUL_TICKS });
    grav = { id: v.nytId(), type: 'gravsten', x: Math.round(b.x), y: Math.round(b.y),
             hold: b.hold, baever: b.id, navn: b.navn, alder: 0 };
    v.gravsten.push(grav);
  }
  haendelser.push({ navn: 'doedsfald', baever: b.id, navnTekst: b.navn, hold: b.hold, x: b.x, y: b.y,
                    grav: grav && { ...grav } });
  return true;
}

export { MAKS_HP };
