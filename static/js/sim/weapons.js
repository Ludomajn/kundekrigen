/* Kundekrigen — våbentabel.
 *
 * Denne fil er ren data. Al opførsel ligger i behaviours.js fordelt på otte
 * arketyper, så et nyt våben er en RÆKKE I EN TABEL og ikke en ny kodesti.
 *
 * Felter:
 *   arketype   ballistisk | klynge | hitscan | straale | naerkamp | placeret |
 *              luftangreb | redskab
 *   sigte      'vinkel+kraft' | 'vinkel' | 'retning' | 'markoer' | 'ingen'
 *   ammo       startbeholdning. 0 = findes kun i forsyningskasser,
 *              -1 = ubegrænset (kun meta). Mangler feltet, er det 0 — aldrig
 *              ubegrænset ved en fejl.
 *   vindFaktor 0 = upåvirket (granater, som i Worms), 1 = fuld, >1 = let og drivende
 *   brugPrTur  hvor mange gange én ammunition rækker i samme tur (scanneren: 2).
 *              Ammunitionen betales ved FØRSTE brug, og turen slutter, når
 *              netop DETTE våben er brugt brugPrTur gange.
 *   afslutterTur  redskaber sætter den false, og det er netop derfor de skal
 *                 være en arketype og ikke et særtilfælde
 *   beholderTur   turen fortsætter efter brug (byggeredskaberne, skjoldet)
 *   fuldtTilbagetog  turen bliver i opløsning, til tilbagetogsuret er løbet
 *                    ud — også selv om verden er i ro (minen skal nå at blive skarp)
 *   kasse      { vaegt, antal }: lodtrækningsvægt i forsyningskasser og
 *              telefonens forstærkning, og hvor mange en kasse giver. vaegt 0
 *              = kommer aldrig i en kasse.
 */
'use strict';

export const KATEGORIER = ['skyts', 'kast', 'naerkamp', 'udstyr', 'terraen', 'special', 'meta'];

export const VAABEN = {
  grenroer: {
    id: 'grenroer', navn: 'Tonerkanon', kategori: 'skyts', ikon: 'v-grenroer',
    arketype: 'ballistisk', sigte: 'vinkel+kraft', ammo: 8,
    // Fuld opladning skal kunne bære fra den ene ende af banen til den
    // anden: rækkevidden ved 45 grader er v²/TYNGDE = 1500²/480 = 4690 wu,
    // og banen er 5120. Opladningen tager 1,5 s, så der er tid til at dosere.
    kraft: { min: 240, max: 1500, opladTid: 90 },
    projektil: { r: 4, vindFaktor: 1.0, hop: 0, rammerBaevere: true, sprite: 'gren', spor: 'roeg' },
    detonation: { radius: 58, skade: 48, knockback: 260, carve: true },
    kasse: { vaegt: 3, antal: 2 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Skyder tonerpatroner. Buer med vinden. Arbejdshesten — men patronerne slipper op.',
  },
  splintboesse: {
    id: 'splintboesse', navn: 'Stregkodescanner', kategori: 'skyts', ikon: 'v-splintboesse',
    arketype: 'hitscan', sigte: 'vinkel', ammo: 2,
    hitscan: { skud: 1, raekkevidde: 1100, skade: 34, carveR: 16, knockback: 220, spredning: 0.012 },
    brugPrTur: 2, kasse: { vaegt: 2, antal: 1 }, retreatTicks: 180, afslutterTur: false,
    hjaelp: 'To scanninger pr. ammunition — begge i samme tur. Rammer øjeblikkeligt og skubber hårdt.',
  },
  daemningsdynamit: {
    id: 'daemningsdynamit', navn: 'Tvangsopdatering', kategori: 'skyts', ikon: 'v-dynamit',
    arketype: 'straale', sigte: 'vinkel', ammo: 1,
    // En kort stråle uden skade: den første kunde, den rammer, skal genstarte.
    straale: { raekkevidde: 150 },
    kasse: { vaegt: 1, antal: 1 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'En kort stråle. Rammer den en modstander, skal vedkommende installere opdateringer og springer sin næste tur over.',
  },
  egegranat: {
    id: 'egegranat', navn: 'Datalæk-bomben', kategori: 'kast', ikon: 'v-egegranat',
    arketype: 'ballistisk', sigte: 'vinkel+kraft', ammo: 3,
    kraft: { min: 200, max: 1050, opladTid: 75 },
    lunte: { valg: [1, 2, 3, 4, 5], start: 3 },
    projektil: { r: 9, vindFaktor: 0, hop: 0.42, rammerBaevere: false, sprite: 'bombe', spor: null },
    detonation: { radius: 74, skade: 55, knockback: 300, carve: true },
    kasse: { vaegt: 3, antal: 1 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'En stor, rund bombe fuld af fortrolige data. Hopper, ignorerer vinden og lækker med et ordentligt brag. Sæt lunten med F.',
  },
  koglebombe: {
    id: 'koglebombe', navn: 'Integrations inferno', kategori: 'kast', ikon: 'v-koglebombe',
    arketype: 'klynge', sigte: 'vinkel+kraft', ammo: 1,
    kraft: { min: 200, max: 1050, opladTid: 75 },
    lunte: { valg: [1, 2, 3, 4, 5], start: 3 },
    projektil: { r: 5, vindFaktor: 0, hop: 0.38, rammerBaevere: false, sprite: 'kogle', spor: null },
    detonation: { radius: 42, skade: 26, knockback: 160, carve: true },
    klynge: { antal: 5, spredning: 1.15, fart: 230, barn: {
      r: 3, vindFaktor: 0.4, hop: 0.2, rammerBaevere: true, sprite: 'frø',
      detonation: { radius: 34, skade: 22, knockback: 130, carve: true }, lunte: 1.2 } },
    kasse: { vaegt: 2, antal: 1 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Ingen af integrationerne virker sammen: den springer i fem brændende stumper ved detonation.',
  },
  halesmaek: {
    id: 'halesmaek', navn: 'Klageklask', kategori: 'naerkamp', ikon: 'v-hale',
    arketype: 'naerkamp', sigte: 'retning', ammo: 3,
    // Slaget rammer først efter svinget (forsinkelse i tick).
    naerkamp: { raekkevidde: 34, hoejde: 30, skade: 50, impulsX: 170, impulsY: 250, forsinkelse: 10 },
    kasse: { vaegt: 2, antal: 1 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Et ordentligt klask med klagemappen: 50 i skade til den, der står foran dig. Én gang pr. tur.',
  },
  baevermine: {
    id: 'baevermine', navn: 'Phishing-mine', kategori: 'udstyr', ikon: 'v-mine',
    arketype: 'placeret', sigte: 'ingen', ammo: 2,
    // Skarp efter 5 s. Tilbagetoget varer lidt længere, og turen venter på
    // det hele — ellers kunne man ikke nå væk.
    placeret: { lunte: 0, naerhed: 42, armering: 300, sprite: 'mine' },
    detonation: { radius: 52, skade: 42, knockback: 240, carve: true },
    kasse: { vaegt: 2, antal: 1 }, retreatTicks: 330, afslutterTur: true, fuldtTilbagetog: true,
    hjaelp: 'Ligner en helt almindelig mail. Bliver skarp efter fem sekunder og går af, når nogen kommer for tæt på — også dig.',
  },
  gnavetand: {
    id: 'gnavetand', navn: 'Hjemmearbejde', kategori: 'udstyr', ikon: 'v-gnavetand',
    arketype: 'redskab', redskab: 'skjold', sigte: 'ingen', ammo: 1,
    kasse: { vaegt: 1, antal: 1 }, retreatTicks: 0, afslutterTur: false, beholderTur: true,
    hjaelp: 'Arbejd hjemmefra: et kraftfelt holder al skade og alle skub ude, til dit hold er på igen. Turen fortsætter.',
  },
  nedgravning: {
    id: 'nedgravning', navn: 'Systemnedbrud', kategori: 'udstyr', ikon: 'v-nedgravning',
    arketype: 'redskab', redskab: 'bor', sigte: 'ingen', ammo: 1,
    // Langsomt og styrbart: 0,9 wu/tick i højst 9 s. drej er rad/tick.
    bor: { r: 17, fart: 0.9, tid: 540, styrbar: true, drej: 0.05 },
    kasse: { vaegt: 1, antal: 1 }, retreatTicks: 150, afslutterTur: false,
    hjaelp: 'Bor dig ned i jorden. Styr med piletasterne, stop med mellemrum. Boret standser selv før vandet.',
  },
  gangtunnel: {
    id: 'gangtunnel', navn: 'Fjernsupport', kategori: 'udstyr', ikon: 'v-teleport',
    arketype: 'redskab', redskab: 'teleport', sigte: 'markoer', ammo: 1,
    kasse: { vaegt: 0, antal: 0 }, retreatTicks: 120, afslutterTur: false,
    hjaelp: 'Overtag skærmen og flyt dig hen, hvor der er plads. Kun én pr. kamp. T springer til fjender.',
  },
  papirbunke: {
    id: 'papirbunke', navn: 'Papirbunke', kategori: 'terraen', ikon: 'v-papir',
    arketype: 'ballistisk', sigte: 'vinkel+kraft', ammo: 2,
    kraft: { min: 200, max: 1050, opladTid: 75 },
    projektil: { r: 6, vindFaktor: 0.6, hop: 0, rammerBaevere: true, sprite: 'papir', spor: null },
    fyld: { r: 36 },
    kasse: { vaegt: 2, antal: 1 }, retreatTicks: 240, afslutterTur: true,
    hjaelp: 'Kast en bunke A4-papir. Den bliver liggende som en bakke — byg dækning, en bro eller fyld et krater.',
  },
  kabelbakke: {
    id: 'kabelbakke', navn: 'Kabelbakke', kategori: 'terraen', ikon: 'v-rampe',
    arketype: 'redskab', redskab: 'rampe', sigte: 'ingen', ammo: 1,
    // Hældningen skal være til at gå op ad (physics: TRIN_OP pr. skridt ≈ 66°).
    rampe: { halvL: 60, halvT: 5, vinkel: 0.5, start: 12 },
    kasse: { vaegt: 2, antal: 1 }, retreatTicks: 300, afslutterTur: false, beholderTur: true,
    hjaelp: 'En rampe skråt op foran dig, så du kan gå op ad skrænter. Turen fortsætter bagefter.',
  },
  byggeskum: {
    id: 'byggeskum', navn: 'Byggeskum', kategori: 'terraen', ikon: 'v-skum',
    arketype: 'redskab', redskab: 'skum', sigte: 'markoer', ammo: 1,
    skum: { r: 44, raekkevidde: 360 },
    kasse: { vaegt: 2, antal: 1 }, retreatTicks: 300, afslutterTur: false, beholderTur: true,
    hjaelp: 'Sprøjt en stor klump skum dér, du peger. Byg en væg, luk et hul eller begrav en mine. Turen fortsætter bagefter.',
  },
  traestammeregn: {
    id: 'traestammeregn', navn: 'Kvartalsopkrævning', kategori: 'special', ikon: 'v-airstrike',
    arketype: 'luftangreb', sigte: 'markoer', ammo: 0,
    // Otte fakturaer, let spredt (jitter fra rngSim), der daler og driver.
    luftangreb: { antal: 8, mellemrum: 5, spredning: 34, jitter: 10, fart: 250 },
    projektil: { r: 5, vindFaktor: 0.9, hop: 0, rammerBaevere: true, sprite: 'faktura', spor: null },
    detonation: { radius: 40, skade: 24, knockback: 170, carve: true },
    kasse: { vaegt: 1, antal: 1 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Otte fakturaer daler ned over målet. Vælg mål, og hvilken vej de kommer. Findes kun i forsyningskasser.',
  },
  covid: {
    id: 'covid', navn: 'COVID', kategori: 'special', ikon: 'v-covid',
    arketype: 'ballistisk', sigte: 'vinkel+kraft', ammo: 0,
    kraft: { min: 200, max: 1050, opladTid: 75 },
    // Ingen eksplosion og intet krater: ved nedslag (eller når den faste
    // lunte på 2 s løber ud) slipper den en smittesky løs.
    projektil: { r: 6, vindFaktor: 0.5, hop: 0.3, rammerBaevere: true, sprite: 'virus', spor: null, lunte: 2 },
    smitte: { r: 70, turer: 3 },
    kasse: { vaegt: 1, antal: 1 }, retreatTicks: 180, afslutterTur: true,
    hjaelp: 'Kast en virus. Alle i skyen bliver smittet, mister 6 tålmodighed ved hver turs slutning og smitter dem, de står tæt på. Findes kun i forsyningskasser.',
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

/** Standardrækkefølgen på favoritbjælken — ti pladser, tasterne 1-0.
 *  Ét tastetryk er normaltilfældet; det er det, der gør et stort arsenal
 *  spilbart uden mus. Resten ligger i skuffen (Tab). */
export const FAVORITTER = [
  'grenroer', 'egegranat', 'koglebombe', 'splintboesse', 'daemningsdynamit',
  'baevermine', 'halesmaek', 'gnavetand', 'nedgravning', 'gangtunnel',
];

/** Den gamle standardbjælke med tolv pladser. Står en gemt profil stadig
 *  præcis sådan, har brugeren aldrig rørt den, og den kan skiftes ud. */
export const FAVORITTER_V1 = [
  'grenroer', 'egegranat', 'koglebombe', 'splintboesse',
  'daemningsdynamit', 'baevermine', 'halesmaek', 'gnavetand',
  'nedgravning', 'bjaelke', 'gangtunnel', 'traestammeregn',
];

/* Alternative startbeholdninger. Fjernsupport er aldrig mere end én. */
export const VAABEN_SKEMAER = {
  standard: {},
  rigelig: { grenroer: 12, splintboesse: 4, daemningsdynamit: 2, egegranat: 5, koglebombe: 3,
             halesmaek: 5, baevermine: 4, gnavetand: 2, nedgravning: 2, papirbunke: 4,
             kabelbakke: 2, byggeskum: 2, traestammeregn: 1, covid: 1 },
  sparsom: { grenroer: 5, splintboesse: 1, daemningsdynamit: 0, egegranat: 2, koglebombe: 0,
             halesmaek: 2, baevermine: 1, gnavetand: 0, nedgravning: 0, papirbunke: 1,
             kabelbakke: 1, byggeskum: 0 },
};

export function startAmmo(skema = 'standard') {
  const ud = {};
  const ekstra = VAABEN_SKEMAER[skema] || {};
  for (const [id, v] of Object.entries(VAABEN)) {
    const a = ekstra[id] !== undefined ? ekstra[id] : (v.ammo === undefined ? 0 : v.ammo);
    ud[id] = id === 'gangtunnel' ? Math.min(1, a) : a;
  }
  return ud;
}

/** Vægtet lodtrækning til forsyningskasser og telefonens forstærkning.
 *  Fjernsupport og meta kommer aldrig i en kasse. */
export function tilfaeldigtKassevaaben(rng) {
  const pulje = [];
  for (const v of Object.values(VAABEN)) {
    if (v.kategori === 'meta' || v.id === 'gangtunnel') continue;
    const w = v.kasse?.vaegt || 0;
    for (let i = 0; i < w; i++) pulje.push(v.id);
  }
  return pulje.length ? pulje[Math.floor(rng() * pulje.length)] : 'grenroer';
}

/** Hvor mange af våbnet en kasse (eller en forstærkning) giver. */
export const kasseAntal = (id) => Math.max(1, VAABEN[id]?.kasse?.antal || 1);

export const vaaben = (id) => VAABEN[id];
