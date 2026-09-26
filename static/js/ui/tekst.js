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
    vaabenpanel: 'Våben',
    bekraeftStaaOver: 'Sæt på hold og afslut turen?',
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
    favorit: 'Vælg våben 1-12',
    panel: 'Våbenpanel',
    cykl: 'Forrige/næste våben',
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

export const mmss = (sek) => {
  const s = Math.max(0, Math.ceil(sek));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const VEJR_NAVN = {
  solskin: 'Solskin', overskyet: 'Overskyet', regn: 'Regn',
  slud: 'Slud', sne: 'Sne', taage: 'Tåge', auto: 'Tilfældigt',
};

export const BANE_NAVN = { aaben: 'Åbent land', hule: 'Hulesystem', oeer: 'Øer' };
