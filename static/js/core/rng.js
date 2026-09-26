/* Kundekrigen — deterministisk tilfældighed.
 *
 * To adskilte strømme, og det er vigtigt at holde dem adskilt:
 *   rngSim  bruges af simulationen (terræn, vind, kasser) og er DEL af
 *           øjebliksbilledet. Alle klienter skal få samme tal.
 *   rngFx   bruges af partikler, rystelser og debris. Må aldrig røres af
 *           simulationen, for så ville rendering kunne ændre spillet.
 *
 * Math.random er forbudt i js/sim/ — se README'ens grep.
 */
'use strict';

/** mulberry32: lille, hurtig, og hele tilstanden er ét 32-bit ord. */
export function lavRng(froe) {
  let a = froe >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.tilstand = () => a >>> 0;
  f.saet = (v) => { a = v >>> 0; };
  f.mellem = (lav, hoej) => lav + f() * (hoej - lav);
  f.heltal = (lav, hoej) => Math.floor(lav + f() * (hoej - lav + 1));
  f.vaelg = (liste) => liste[Math.floor(f() * liste.length)];
  f.bland = (liste) => {
    for (let i = liste.length - 1; i > 0; i--) {
      const j = Math.floor(f() * (i + 1));
      [liste[i], liste[j]] = [liste[j], liste[i]];
    }
    return liste;
  };
  return f;
}

/** Heltalshash — til støj, hvor vi vil have en værdi uden at rykke en strøm. */
export function hash2(x, y, froe) {
  let h = (x * 374761393 + y * 668265263 + froe * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const glat = (t) => t * t * (3 - 2 * t);

/** Værdistøj. Simplex køber os intet her, og det her er 20 linjer. */
export function stoej2(x, y, froe) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = glat(x - x0), fy = glat(y - y0);
  const a = hash2(x0, y0, froe), b = hash2(x0 + 1, y0, froe);
  const c = hash2(x0, y0 + 1, froe), d = hash2(x0 + 1, y0 + 1, froe);
  const oeverst = a + (b - a) * fx;
  const nederst = c + (d - c) * fx;
  return oeverst + (nederst - oeverst) * fy;
}

/** Fraktal brownsk støj — summen der giver terrænet sin ruhed. */
export function fbm2(x, y, froe, oktaver = 5, forfald = 0.5, lakunaritet = 2) {
  let sum = 0, amp = 1, frek = 1, norm = 0;
  for (let i = 0; i < oktaver; i++) {
    sum += stoej2(x * frek, y * frek, froe + i * 7919) * amp;
    norm += amp;
    amp *= forfald;
    frek *= lakunaritet;
  }
  return sum / norm;
}

export function fbm1(x, froe, oktaver = 5, forfald = 0.5) {
  return fbm2(x, 0.37, froe, oktaver, forfald);
}
