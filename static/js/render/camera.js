/* Kundekrigen — kamera.
 *
 * Følgebevægelsen er en kritisk dæmpet fjeder med en dødzone, så små
 * gangskridt ikke ryster billedet.
 *
 * Rytmen ved affyring er Worms': ret mod projektilet 200 ms efter skuddet, og
 * hold 400 ms efter nedslaget, før vi vender tilbage. Den rytme betyder noget
 * for hvordan spillet føles.
 *
 * Rystelser er RENT præsentation og læses aldrig af simulationen.
 */
'use strict';

import { glatDaemp, klem, lerp } from '../core/math.js';
import { lavRng } from '../core/rng.js';

const DOEDZONE_X = 220, DOEDZONE_Y = 140;
const FOELG_TID = 0.42;                   // blødt, så skift mellem mål ikke rykker
const FOELG_TID_SKUD = 0.13;              // strammere: et skud flyver 1500 wu/s
const ZOOMTRIN = [0.7, 1.0, 1.4];

export function lavKamera(r, terraen) {
  const rngFx = lavRng(0xC0FFEE);          // ALDRIG del af simulationen
  let maalX = terraen.w / 2, maalY = terraen.h / 2;
  let hastX = { v: 0 }, hastY = { v: 0 };
  let fri = false, friX = 0, friY = 0;
  let kig = false, kigT = 0;
  let zoomIdx = 1, zoomNu = 1;
  let ryst = 0, rystX = 0, rystY = 0;
  let laas = null;                          // entitet vi følger
  let holdTil = 0;
  let skud = null;                          // projektil (eller nedslagspunkt) vi følger tæt

  function klemTilBane(x, y, halvB, halvH) {
    const mx = 60, my = 60;
    return {
      x: klem(x, -mx + halvB, terraen.w + mx - halvB),
      y: klem(y, -my + halvH, terraen.h + my - halvH),
    };
  }

  const api = {
    get zoom() { return zoomNu; },

    foelg(e) { laas = e; holdTil = 0; skud = null; },

    /** Følg et skud tæt og lidt foran i flyveretningen — uden dødzone, og
     *  også selvom man stod og panorerede frit. Et punkt uden fart (selve
     *  nedslaget) holdes bare i midten. */
    foelgSkud(p) {
      skud = p; fri = false; friX = 0; friY = 0;
    },
    slipSkud() { skud = null; },
    get foelgerSkud() { return !!skud; },

    /** Turskifte: ophæv fri panorering og glid HELT hen til enheden —
     *  dødzonen er til gangskridt, ikke til at finde en ny hovedperson. */
    fokus(e) {
      laas = e; holdTil = 0; skud = null;
      fri = false; friX = 0; friY = 0;
      maalX = e.x;
      maalY = e.y + 50;
    },
    sigtMod(e, holdMs = 0) { laas = e; holdTil = performance.now() + holdMs; },
    slipHold() { if (performance.now() > holdTil) holdTil = 0; },

    saetMaal(x, y) { maalX = x; maalY = y; },
    snap(x, y) {
      maalX = x; maalY = y;
      r.kamera.position.x = x; r.kamera.position.y = y;
      hastX.v = 0; hastY.v = 0;
    },

    friTilstand(paa) { fri = paa; if (!paa) { friX = 0; friY = 0; } },
    panorer(dx, dy) { if (fri) { friX += dx; friY += dy; } },
    erFri() { return fri; },

    kigPaaBanen(paa) { kig = paa; },

    // ZOOMTRIN er verdenshøjder: et LAVERE tal viser mindre og er dermed
    // tættere på. Ind vælger derfor et lavere trin.
    zoomInd() { zoomIdx = Math.max(0, zoomIdx - 1); },
    zoomUd() { zoomIdx = Math.min(ZOOMTRIN.length - 1, zoomIdx + 1); },

    /** Additiv, forsvinder med en halveringstid på 0,25 s. */
    rystelse(styrke, afstand = 0) {
      const fald = 1 / (1 + afstand / 900);
      ryst = Math.min(1, ryst + styrke * fald);
    },

    opdater(dt) {
      if (skud) {
        maalX = skud.x + (skud.vx || 0) * 0.2;
        maalY = skud.y + (skud.vy || 0) * 0.12;
      } else if (laas && !fri) {
        const lx = laas.x, ly = laas.y;
        if (Math.abs(lx - maalX) > DOEDZONE_X / 2) {
          maalX = lx - Math.sign(lx - maalX) * DOEDZONE_X / 2;
        }
        if (Math.abs(ly - maalY) > DOEDZONE_Y / 2) {
          maalY = ly - Math.sign(ly - maalY) * DOEDZONE_Y / 2;
        }
      }

      // Kig: zoom ud så hele banen er synlig, og slip tilbage ved release.
      kigT = lerp(kigT, kig ? 1 : 0, 1 - Math.pow(0.001, dt));
      const passerZoom = Math.max(terraen.w / 2200, terraen.h / 720) * 1.05;
      const oensketZoom = lerp(ZOOMTRIN[zoomIdx], passerZoom, kigT);
      zoomNu = lerp(zoomNu, oensketZoom, 1 - Math.pow(0.002, dt));
      r.tilpas(zoomNu);

      let mx = maalX + friX, my = maalY + friY;
      if (kigT > 0.5) { mx = lerp(mx, terraen.w / 2, kigT); my = lerp(my, terraen.h / 2, kigT); }
      const k = klemTilBane(mx, my, r.bredde / 2, r.hoejde / 2);

      const p = r.kamera.position;
      const ft = skud ? FOELG_TID_SKUD : FOELG_TID;
      p.x = glatDaemp(p.x, k.x, hastX, ft, dt);
      p.y = glatDaemp(p.y, k.y, hastY, ft, dt);

      if (ryst > 0.001) {
        ryst *= Math.pow(0.5, dt / 0.25);
        const amp = ryst * 14;
        rystX = (rngFx() - 0.5) * 2 * amp;
        rystY = (rngFx() - 0.5) * 2 * amp;
        p.x += rystX; p.y += rystY;
      } else { ryst = 0; }
    },
  };
  return api;
}
