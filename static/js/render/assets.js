/* Kundekrigen — indlæsning af spritegrafik.
 *
 * Grafikken er Kenney.nl's CC0-pakker "Tanks", "New Platformer Pack",
 * parallaksepakken og "Survival Props", kurateret ned til det spillet bruger (se
 * static/grafik/LICENS.txt). Alt hentes én gang her og deles af figur-,
 * effekt- og baggrundslagene.
 *
 * Et manglende billede må aldrig vælte spillet: det logges, og laget
 * springes over — præcis som den gamle Blender-indlæser gjorde.
 */
'use strict';

const STI = '/grafik';

/* Alle billeder spillet bruger. Nøglen er navnet resten af koden kender. */
const MANIFEST = {
  // Kunderne (tegneseriefigurerne) indlæses af figur_view.js, ikke her.

  // Projektiler. bullet = uden flamme (daler), fly = med raketflamme.
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((i) => [
    [`kugle${i}`, `tanks/tank_bullet${i}.png`],
    [`kugleIld${i}`, `tanks/tank_bulletFly${i}.png`],
  ])),

  // Eksplosionens 12 billeder.
  ...Object.fromEntries([...Array(12)].map((_, i) => [`eks${i + 1}`, `tanks/tank_explosion${i + 1}.png`])),

  mineFra: 'tanks/tanks_mineOff.png',
  mineTil: 'tanks/tanks_mineOn.png',
  mineTrykket: 'tanks/tanks_minePressed.png',
  toendeRoed: 'tanks/tanks_barrelRed.png',
  toendeGroen: 'tanks/tanks_barrelGreen.png',
  // Kasser og hændelser: "Survival Props"-pakken. Et klinik-tema har brug
  // for piller, ikke ammunitionskasser.
  kasseVaaben: 'props/backpack.png',       // supportpakke med et våben
  kasseHelbred: 'props/pills_2.png',       // pilleglas med kors: tålmodighed
  kasseHjaelp: 'props/pill_1.png',         // svævepillen: lav tyngde
  mursten: 'props/brick.png',              // hændelsen "mursten fra loftet"
  forbinding: 'props/bandage.png',
  pilTom: 'tanks/tank_arrowEmpty.png',
  pilFuld: 'tanks/tank_arrowFull.png',

  // Parallaksebaggrunde (2048 x 1546, gennemsigtige lag, gentages vandret).
  ...Object.fromEntries(['jord', 'traeer', 'fjerntraeer', 'buske', 'bakke1', 'bakke2',
    'skybanke', 'skyer', 'fjernskyer1', 'fjernskyer', 'himmel']
    .map((n) => [`px_${n}`, `parallax/${n}.png`])),
};

const ARK = new Map();
let indlaesning = null;

/** Hent alle billeder. Kaldes ved opstart og afventes før første kamp. */
export function indlaesGrafik() {
  if (indlaesning) return indlaesning;
  indlaesning = Promise.all(Object.entries(MANIFEST).map(([navn, sti]) =>
    new Promise((res) => {
      const img = new Image();
      img.onload = () => { ARK.set(navn, img); res(); };
      img.onerror = () => { console.warn('[grafik] mangler', sti); res(); };
      img.src = `${STI}/${sti}`;
    })));
  return indlaesning;
}

export const grafikKlar = () => ARK.has('eks1');
export const hent = (navn) => ARK.get(navn) || null;

/* ------------------------------------------------------------ bearbejdning */

const cache = new Map();

/**
 * Fjern (næsten) hvide pixels — Kenney-baggrundenes himmel — så vores egen
 * himmel og de fjernere lag kan ses bag dem.
 */
export function udenHimmel(navn, taerskel = 244) {
  const n = `himmel|${navn}|${taerskel}`;
  if (cache.has(n)) return cache.get(n);
  const img = hent(navn);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= taerskel && d[i + 1] >= taerskel && d[i + 2] >= taerskel) d[i + 3] = 0;
  }
  g.putImageData(data, 0, 0);
  cache.set(n, c);
  return c;
}

/** Mørklagt udgave — bruges til udslåede figurer. */
export function moerklagt(navn, styrke = 0.55) {
  const n = `moerk|${navn}|${styrke}`;
  if (cache.has(n)) return cache.get(n);
  const img = hent(navn);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(30,30,34,${styrke})`;
  g.fillRect(0, 0, c.width, c.height);
  cache.set(n, c);
  return c;
}
