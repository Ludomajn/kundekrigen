/* Kundekrigen — våbentabel.
 *
 * Denne fil er ren data. Al opførsel ligger i behaviours.js fordelt på syv
 * arketyper, så et nyt våben er en RÆKKE I EN TABEL og ikke en ny kodesti.
 *
 * Felter:
 *   arketype   ballistisk | klynge | hitscan | naerkamp | placeret | luftangreb | redskab
 *   sigte      'vinkel+kraft' | 'vinkel' | 'retning' | 'markoer' | 'ingen'
 *   ammo       -1 = ubegrænset
 *   vindFaktor 0 = upåvirket (granater, som i Worms), 1 = fuld, >1 = let og drivende
 *   afslutterTur  redskaber sætter den false, og det er netop derfor de skal
 *                 være en arketype og ikke et særtilfælde
 */
'use strict';

export const KATEGORIER = ['skyts', 'kast', 'naerkamp', 'udstyr', 'meta'];

export const VAABEN = {
  grenroer: {
    id: 'grenroer', navn: 'Tonerkanon', kategori: 'skyts', ikon: 'v-grenroer',
    arketype: 'ballistisk', sigte: 'vinkel+kraft', ammo: -1,
    // Fuld opladning skal kunne bære fra den ene ende af banen til den
    // anden: rækkevidden ved 45 grader er v²/TYNGDE = 1500²/480 = 4690 wu,
    // og banen er 5120. Opladningen tager 1,5 s, så der er tid til at dosere.
    kraft: { min: 240, max: 1500, opladTid: 90 },
    projektil: { r: 4, vindFaktor: 1.0, hop: 0, rammerBaevere: true, sprite: 'gren', spor: 'roeg' },
    detonation: { radius: 58, skade: 48, knockback: 260, carve: true },
    kasse: { kan: false, vaegt: 0 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Skyder tonerpatroner. Buer med vinden. Arbejdshesten.',
  },
  egegranat: {
    id: 'egegranat', navn: 'Musegranat', kategori: 'kast', ikon: 'v-egegranat',
    arketype: 'ballistisk', sigte: 'vinkel+kraft', ammo: -1,
    kraft: { min: 200, max: 1050, opladTid: 75 },
    lunte: { valg: [1, 2, 3, 4, 5], start: 3 },
    projektil: { r: 5, vindFaktor: 0, hop: 0.42, rammerBaevere: false, sprite: 'agern', spor: null },
    detonation: { radius: 62, skade: 50, knockback: 280, carve: true },
    kasse: { kan: false, vaegt: 0 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'En trådløs mus med lunte. Hopper og ignorerer vinden. Sæt lunten med F.',
  },
  koglebombe: {
    id: 'koglebombe', navn: 'Tastaturbombe', kategori: 'kast', ikon: 'v-koglebombe',
    arketype: 'klynge', sigte: 'vinkel+kraft', ammo: 5,
    kraft: { min: 200, max: 1050, opladTid: 75 },
    lunte: { valg: [1, 2, 3, 4, 5], start: 3 },
    projektil: { r: 5, vindFaktor: 0, hop: 0.38, rammerBaevere: false, sprite: 'kogle', spor: null },
    detonation: { radius: 42, skade: 26, knockback: 160, carve: true },
    klynge: { antal: 5, spredning: 1.15, fart: 230, barn: {
      r: 3, vindFaktor: 0.4, hop: 0.2, rammerBaevere: true, sprite: 'frø',
      detonation: { radius: 34, skade: 22, knockback: 130, carve: true }, lunte: 1.2 } },
    kasse: { kan: true, vaegt: 3 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Springer i fem løse taster ved detonation.',
  },
  splintboesse: {
    id: 'splintboesse', navn: 'Stregkodescanner', kategori: 'skyts', ikon: 'v-splintboesse',
    arketype: 'hitscan', sigte: 'vinkel', ammo: 4,
    hitscan: { skud: 1, raekkevidde: 1100, skade: 25, carveR: 11, knockback: 90, spredning: 0.012 },
    brugPrTur: 2, kasse: { kan: true, vaegt: 3 }, retreatTicks: 180, afslutterTur: false,
    hjaelp: 'To scanninger pr. tur. Rammer øjeblikkeligt.',
  },
  daemningsdynamit: {
    id: 'daemningsdynamit', navn: 'Tvangsopdatering', kategori: 'kast', ikon: 'v-dynamit',
    arketype: 'placeret', sigte: 'ingen', ammo: 2,
    placeret: { lunte: 300, naerhed: 0, sprite: 'dynamit' },
    detonation: { radius: 88, skade: 78, knockback: 400, carve: true },
    kasse: { kan: true, vaegt: 2 }, retreatTicks: 300, afslutterTur: true,
    hjaelp: 'Genstarter om fem sekunder. Løb.',
  },
  baevermine: {
    id: 'baevermine', navn: 'Phishing-mine', kategori: 'udstyr', ikon: 'v-mine',
    arketype: 'placeret', sigte: 'ingen', ammo: 3,
    placeret: { lunte: 0, naerhed: 38, armering: 60, sprite: 'mine' },
    detonation: { radius: 52, skade: 42, knockback: 240, carve: true },
    kasse: { kan: true, vaegt: 2 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Ligner en helt almindelig mail. Udløses, når nogen kommer for tæt på.',
  },
  halesmaek: {
    id: 'halesmaek', navn: 'Ringbindsslag', kategori: 'naerkamp', ikon: 'v-hale',
    arketype: 'naerkamp', sigte: 'retning', ammo: -1,
    naerkamp: { raekkevidde: 34, hoejde: 30, skade: 30, impulsX: 210, impulsY: 400 },
    kasse: { kan: false, vaegt: 0 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Et ordentligt slag med ringbindet. Sender folk op — og måske i vandet.',
  },
  gnavetand: {
    id: 'gnavetand', navn: 'Loddekolbe', kategori: 'udstyr', ikon: 'v-gnavetand',
    arketype: 'redskab', redskab: 'bor', sigte: 'retning', ammo: 2,
    bor: { lodret: false, r: 16, fart: 2.4, tid: 240 },
    kasse: { kan: true, vaegt: 2 }, retreatTicks: 300, afslutterTur: false,
    hjaelp: 'Brænder en vandret tunnel gennem bjerget.',
  },
  nedgravning: {
    id: 'nedgravning', navn: 'Systemnedbrud', kategori: 'udstyr', ikon: 'v-nedgravning',
    arketype: 'redskab', redskab: 'bor', sigte: 'ingen', ammo: 2,
    bor: { lodret: true, r: 17, fart: 2.6, tid: 200 },
    kasse: { kan: true, vaegt: 2 }, retreatTicks: 300, afslutterTur: false,
    hjaelp: 'Borer lige ned — alt går ned. God til at gemme sig.',
  },
  bjaelke: {
    id: 'bjaelke', navn: 'Serverrack', kategori: 'udstyr', ikon: 'v-bjaelke',
    arketype: 'redskab', redskab: 'bjaelke', sigte: 'markoer', ammo: 4,
    bjaelke: { halvL: 62, halvT: 7, raekkevidde: 320 },
    kasse: { kan: true, vaegt: 2 }, retreatTicks: 300, afslutterTur: false,
    hjaelp: 'Stiller et serverrack op som platform. Drej med Shift + pil.',
  },
  gangtunnel: {
    id: 'gangtunnel', navn: 'Fjernsupport', kategori: 'udstyr', ikon: 'v-teleport',
    arketype: 'redskab', redskab: 'teleport', sigte: 'markoer', ammo: 2,
    kasse: { kan: true, vaegt: 2 }, retreatTicks: 120, afslutterTur: false,
    hjaelp: 'Overtag skærmen og flyt dig hvorhen som helst. T springer til fjender.',
  },
  traestammeregn: {
    id: 'traestammeregn', navn: 'Faxregn', kategori: 'skyts', ikon: 'v-airstrike',
    arketype: 'luftangreb', sigte: 'markoer', ammo: 2,
    luftangreb: { antal: 5, mellemrum: 6, spredning: 42, fart: 340 },
    projektil: { r: 5, vindFaktor: 0.5, hop: 0, rammerBaevere: true, sprite: 'stamme', spor: 'roeg' },
    detonation: { radius: 46, skade: 34, knockback: 200, carve: true },
    kasse: { kan: true, vaegt: 1 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Fem faxmaskiner ovenfra. Vælg mål, og hvilken vej de kommer.',
  },

  // --- meta, altid tilgængelige
  staa_over: {
    id: 'staa_over', navn: 'Sæt på hold', kategori: 'meta', ikon: 'v-staaover',
    arketype: 'redskab', redskab: 'staa_over', sigte: 'ingen', ammo: -1,
    retreatTicks: 0, afslutterTur: true, hjaelp: 'Afslut turen uden at gøre noget. Du er nummer 14 i køen.',
  },
  overgiv: {
    id: 'overgiv', navn: 'Opsig aftalen', kategori: 'meta', ikon: 'v-overgiv',
    arketype: 'redskab', redskab: 'overgiv', sigte: 'ingen', ammo: -1,
    retreatTicks: 0, afslutterTur: true, hjaelp: 'Dit hold opsiger aftalen og forlader kampen.',
  },
};

/** Standardrækkefølgen på favoritbjælken — de tolv v1-våben.
 *  Ét tastetryk er normaltilfældet; det er det, der gør et stort arsenal
 *  spilbart uden mus. */
export const FAVORITTER = [
  'grenroer', 'egegranat', 'koglebombe', 'splintboesse',
  'daemningsdynamit', 'baevermine', 'halesmaek', 'gnavetand',
  'nedgravning', 'bjaelke', 'gangtunnel', 'traestammeregn',
];

export const VAABEN_SKEMAER = {
  standard: {},
  rigelig: { koglebombe: 9, splintboesse: 8, daemningsdynamit: 4, baevermine: 6,
             gnavetand: 4, nedgravning: 4, bjaelke: 8, gangtunnel: 4, traestammeregn: 4 },
  sparsom: { koglebombe: 2, splintboesse: 2, daemningsdynamit: 1, baevermine: 1,
             gnavetand: 1, nedgravning: 1, bjaelke: 2, gangtunnel: 1, traestammeregn: 1 },
};

export function startAmmo(skema = 'standard') {
  const ud = {};
  const ekstra = VAABEN_SKEMAER[skema] || {};
  for (const [id, v] of Object.entries(VAABEN)) {
    ud[id] = ekstra[id] !== undefined ? ekstra[id] : (v.ammo === undefined ? -1 : v.ammo);
  }
  return ud;
}

/** Vægtet lodtrækning til forsyningskasser. */
export function tilfaeldigtKassevaaben(rng) {
  const pulje = [];
  for (const v of Object.values(VAABEN)) {
    const w = v.kasse?.vaegt || 0;
    for (let i = 0; i < w; i++) pulje.push(v.id);
  }
  return pulje.length ? pulje[Math.floor(rng() * pulje.length)] : 'koglebombe';
}

export const vaaben = (id) => VAABEN[id];
