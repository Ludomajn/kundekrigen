/* Kundekrigen — alle brugervendte strenge ét sted. Dansk hele vejen. */
'use strict';

export const T = {
  titel: 'KUNDEKRIGEN',
  payoff: 'TAG ET NUMMER',

  menu: {
    lokalt: 'Lokalt spil',
    netvaerk: 'Netværk',
    vaert: 'Vær vært',
    deltag: 'Deltag i spil',
    indstillinger: 'Indstillinger',
    afslut: 'Afslut',
    tilbage: 'Tilbage',
    start: 'Start kampen',
    klar: 'Klar',
    ikkeKlar: 'Ikke klar',
  },

  lobby: {
    titel: 'Opsætning',
    rumkode: 'Rumkode',
    delLink: 'Del dette link',
    kopieret: 'Linket er kopieret',
    deltagere: 'Deltagere',
    hold: 'Klinikker',
    antalHold: 'Antal klinikker',
    baeverePrHold: 'Kunder pr. klinik',
    turtid: 'Tid pr. tur',
    kamptid: 'Kampens længde',
    vind: 'Vind',
    vejr: 'Vejr',
    banetype: 'Banetype',
    vaert: 'vært',
    tilskuer: 'tilskuer',
    afbrudt: 'afbrudt',
    ledigt: 'Ledigt sæde',
    tag: 'Tag',
    slip: 'Slip',
    omdoeb: 'Omdøb',
    venterPaaVaert: 'Venter på at værten starter kampen…',
  },

  /* Karaktervalget (ui/karaktervalg.js): opsætningen i fire trin. */
  kv: {
    trin: ['Karakterer', 'Bane', 'Regler', 'Klar'],
    trinLabel: 'Opsætningens trin',
    naeste: (trin) => `Næste: ${trin}`,
    forlad: 'Forlad',
    lokalt: 'Lokalt spil',
    vaelger: (navn) => `${navn} vælger`,
    nySpiller: '+ Tilføj spiller',
    fjernSpiller: (navn) => `Fjern ${navn}`,
    fraKlar: (navn) => `${navn} er klar — klik for Ikke klar`,
    tilfaeldig: 'Tilfældig',
    tilfaeldigRolle: 'Trækkes, når kampen starter',
    kommerSnart: 'Kommer snart',
    intetValg: 'Ingen fighter',
    holdValg: 'Vælg hold',
    holdFarve: { blaa: 'Blåt hold', roed: 'Rødt hold', groen: 'Grønt hold', gul: 'Gult hold' },
    udenHold: 'Uden hold',
    ingenSpillere: 'Ingen spillere endnu',
    vaelgHold: 'Vælg så blåt eller rødt hold (Q/E).',
    vaelgHoldFoerst: 'Vælg blåt eller rødt hold først.',
    alleValgt: 'Fighter og hold er valgt.',
    laastKlar: 'Du er klar. Tryk Ikke klar for at ændre.',
    baneTitel: 'Stem på en bane',
    baneNote: 'Alle stemmer — banen trækkes blandt stemmerne',
    ingenStemmer: 'Ingen stemmer endnu',
    stemmer: (n) => (n === 1 ? '1 stemme' : `${n} stemmer`),
    reglerTitel: 'Kampens regler',
    reglerVaert: 'Du er vært og sætter reglerne.',
    reglerGaest: 'Værten sætter reglerne.',
    reglerSaetter: (navn) => `${navn} sætter reglerne.`,
    reglerNote: 'Ændres en regel, er ingen længere klar.',
    tilfaeldigeRegler: '🎲 Tilfældige regler',
    tilfaeldigeReglerTitel: 'Tilfældig turtid, kamplængde, vejr og vind',
    klarTitel: 'Klar til kamp?',
    venterPaa: (n) => `Venter på ${n} spiller${n === 1 ? '' : 'e'} …`,
    alleKlar: 'Alle er klar',
    trykKlar: 'Tryk Klar, når du er færdig',
    toHold: 'Der skal være spillere på begge hold',
    starter: 'Kampen starter …',
    banen: 'Banen',
    annuller: 'Annullér (Esc)',
    kopierLink: 'Kopiér link',
    til: 'Til',
    fra: 'Fra',
    taster: {
      karakterer: 'Piletaster: fighter · Enter: vælg · Q/E: blåt/rødt hold · Backspace: ryd',
      bane: 'Piletaster: bane · Enter: stem (igen: fjern stemmen)',
      // Regeltrinnet følger markøren: i listen, på 🎲, på Næste — ellers (værten).
      reglerListe: '↑↓: regel · ←→: skift værdi · Enter: næste værdi',
      reglerRul: '↑↓: regel · Enter: tilfældige regler',
      reglerNaesteVaert: '↑: reglerne · Enter: videre',
      reglerNaeste: 'Enter: videre',
      reglerVaert: '↑↓: reglerne',
      klar: 'Enter: Klar / Ikke klar',
      tilbage: 'Esc: tilbage',
    },
  },

  spil: {
    dinTur: 'Din tur',
    turFor: 'Tur:',
    venter: 'Venter…',
    vind: 'Vind',
    kamptid: 'Kamptid',
    tilbagetog: 'Tilbagetog',
    pludseligDoed: 'PLUDSELIG DØD',
    vandetStiger: 'Vandet stiger',
    genererer: 'Genererer bane…',
    udsaetter: 'Kunderne stiller sig op…',
    sejr: (h) => `${h} vinder kundekrigen!`,
    uafgjort: 'Uafgjort — ingen kunder tilbage',
    staaOver: 'Sæt på hold',
    overgiv: 'Opsig aftalen',
    ammo: 'Ammo',
    ubegraenset: '∞',
    lunte: 'Lunte',
    vaabenpanel: 'Hele arsenalet',
    bekraeftStaaOver: 'Sæt på hold og afslut turen?',

    // Våbenbjælken og arsenalskuffen
    flereVaaben: 'Flere våben',
    flereVaabenTitel: 'Flere våben — hele arsenalet (Tab)',
    arsenalUnder: 'Uret står stille, mens skuffen er åben (højst 5 s pr. tur).',
    lukArsenal: 'Luk arsenalet (Tab eller Esc)',
    tomPlads: 'Tom plads',
    tomPladsTitel: (tast) => `Tom plads — læg et våben her med Shift + ${tast} i arsenalet`,
    faasIKasser: 'Fås i forsyningskasser',
    opbrugt: 'Opbrugt',
    iHaanden: 'i hånden',
    lagtPaaBjaelke: (navn, tast) => `${navn} ligger nu på ${tast}`,
    kanIkkeBindes: (navn) => `${navn} kan ikke ligge på bjælken`,
    status: {
      skjold: 'Hjemmearbejde — kan ikke rammes',
      springOver: 'Opdaterer — springer næste tur over',
      smittet: 'Smittet med COVID',
    },
  },

  /* Beskeder til de nye våbenhændelser (bannere i main.js). */
  vaaben: {
    kasseFalder: 'Supportpakke på vej',
    kasseVaaben: (antal, navn) => `Supportpakke: +${antal} ${navn}`,
    vaabenTomt: (navn) => `${navn} er brugt op — flere fås i forsyningskasser`,
    opdateringRamt: (navn) => `${navn} fik en tvangsopdatering — springer næste tur over`,
    turSprungetOver: (navn) => `${navn} opdaterer stadig … turen springes over`,
    skjoldOp: (navn) => `${navn} arbejder hjemmefra — kan ikke rammes`,
    skjoldSlut: (navn) => `${navn} er tilbage på kontoret`,
    skjoldBlok: 'Arbejder hjemme — ingen skade',
    smittet: (navn) => `${navn} er smittet`,
    rask: (navn) => `${navn} er rask igen`,
    teleportAfvist: 'Fjernsupport kan ikke nå derhen — vælg et andet sted',
  },

  net: {
    forbinder: 'Forbinder…',
    mistet: 'Forbindelsen blev afbrudt — prøver igen…',
    genfundet: 'Forbundet igen',
    vaertStille: 'Venter på værten…',
    vaertSkjult: 'Værten er væk fra fanen',
    kampAfbrudt: 'Kampen blev afbrudt',
    vaertSkiftet: (n) => `${n} er ny vært`,
    holdFanenSynlig: 'Hold fanen synlig — du er vært for kampen. Skifter du væk, stopper spillet for alle.',
    indtastKode: 'Indtast rumkode',
    ingenRum: 'Ingen åbne rum lige nu',
    aabneRum: 'Åbne rum',
  },

  taster: {
    titel: 'Tastatur',
    gaa: 'Gå',
    sigt: 'Sigt',
    finsigte: 'Finsigte',
    ladOp: 'Lad op og affyr (hold)',
    hop: 'Hop',
    salto: 'Baglæns saltomortale',
    favorit: 'Vælg våben 1–10 fra bjælken',
    panel: 'Flere våben: hele arsenalet',
    bind: 'I arsenalet: læg våbnet på bjælken',
    cykl: 'Forrige/næste våben på bjælken',
    lunte: 'Lunte 1-5 s',
    naesteFjende: 'Spring markør til fjende',
    panorer: 'Panorér kamera',
    centrer: 'Centrér på kunde',
    zoom: 'Zoom',
    kig: 'Kig over banen (hold)',
    staaOver: 'Sæt på hold',
    pause: 'Pause',
  },

  afslut: {
    titel: 'Tak for din henvendelse',
    tekst: 'Sagen er lukket. Du kan lukke fanen nu — eller åbne en ny sag.',
    nyKamp: 'Ny sag',
  },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Lange sammensatte navne (Kvartalsopkrævning, Stregkodescanner) får en blød
 * bindestreg ved det sidste led, så de deles pænt på to linjer i de smalle
 * felter på våbenbjælken. Returnerer HTML (escapet). */
const ORDLED = ['opkrævning', 'opdatering', 'arbejde', 'nedbrud', 'support', 'scanner'];
export function brydOrd(tekst) {
  return String(tekst ?? '').split(' ').map((ord) => {
    if (ord.length < 11 || ord.includes('-')) return esc(ord);     // en bindestreg deler allerede
    const lav = ord.toLowerCase();
    const led = ORDLED.find((l) => lav.endsWith(l) && lav.length >= l.length + 3);
    if (!led) return esc(ord);
    const k = ord.length - led.length;
    return `${esc(ord.slice(0, k))}&shy;${esc(ord.slice(k))}`;
  }).join(' ');
}

export const mmss = (sek) => {
  const s = Math.max(0, Math.ceil(sek));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const VEJR_NAVN = {
  solskin: 'Solskin', overskyet: 'Overskyet', regn: 'Regn',
  slud: 'Slud', sne: 'Sne', taage: 'Tåge', auto: 'Tilfældigt',
};

export const BANE_NAVN = { fort: 'Fort', aaben: 'Åbent land', hule: 'Hulesystem', oeer: 'Øer' };
