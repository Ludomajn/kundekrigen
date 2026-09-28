/* Kundekrigen — karakterernes egne stemmer og speakeren.
 *
 * Brugerens optagelser i Assets/Kundelyde/<Navn>/ (vaerktoej/kundelyde.py gør
 * dem til static/lyd/stemme_<navn>_<situation>.ogg). Hver karakter taler selv,
 * når den gør noget; de gamle "generelle" replikker er væk. Lyde, der ikke
 * hører til en bestemt karakter (våben, eksplosioner, flyvelyden, telefonen),
 * er uændrede i main.js.
 *
 * Situationerne:
 *   tur                      karakterens tur begynder
 *   ramt_modstander          karakterens skud ramte en modstander
 *   ramt_ved_siden_af        karakterens skud ramte ingen
 *   modstander_ved_siden_af  en modstanders skud ramte ingen (karakteren griner)
 *   av                       karakteren tager lidt skade
 *   sur                      karakteren tager meget skade
 *   it                       karakteren rammes af Tvangsopdatering (springer en tur over)
 *   glad                     karakteren samler en kasse op, eller holdet vinder
 *   doer                     karakteren dør (også i vandet)
 * Dialogen (filmintroens replik) ligger i klippets lydspor (vaerktoej/klipdialog.py).
 *
 * Har en karakter ingen lyd til en situation, bruges FALDBAK — og ellers
 * ingenting: hellere stille end en fremmed stemme.
 *
 * Hvor ofte: en figur taler ved hver anden handling, eller med det samme,
 * hvis den har været tavs længe. Altid: turens replik, når karakterens tur
 * begynder (varieret mellem dens "Tur"-filer), døden og sejren (replik() i
 * main.js). Dialogen høres kun én gang i kampen, i filmen.
 */
'use strict';

const s = (...navne) => navne.map((n) => `stemme_${n}`);

export const KARAKTER_LYDE = {
  16: {                                   // Skrankepaven Ingrid
    tur: s('ingrid_tur', 'ingrid_tur_2', 'ingrid_tur_3'),
    ramt_modstander: s('ingrid_ramt_modstander', 'ingrid_ramt_modstander_2'),
    ramt_ved_siden_af: s('ingrid_ramt_ved_siden_af', 'ingrid_ramt_ved_siden_af_2'),
    modstander_ved_siden_af: s('ingrid_modstander_rammer_ved_siden_af', 'ingrid_modstander_rammer_ved_siden_af_2'),
    av: s('ingrid_la_vaere', 'ingrid_la_vaere_2'),
    sur: s('ingrid_sur', 'ingrid_sur_2'),
    it: s('ingrid_dumme_computere'),
    glad: s('ingrid_glad'),
    doer: s('ingrid_doer'),
  },
  21: {                                   // Dr. Jan fra Mors
    tur: s('jan_tur', 'jan_tur_2'),
    ramt_modstander: s('jan_ramt_modstander', 'jan_ramt_modstander_2'),
    ramt_ved_siden_af: s('jan_ramt_ved_siden_af', 'jan_ramt_ved_siden_af_2'),
    modstander_ved_siden_af: s('jan_modstander_ramt_ved_siden_af', 'jan_modstander_ramt_ved_siden_af_2'),
    av: s('jan_av', 'jan_av_2'),
    sur: s('jan_sur', 'jan_sur_2'),
    glad: s('jan_glad', 'jan_glad_2'),
    doer: s('jan_doer', 'jan_doer_2'),
  },
};

/** Mangler en karakter en situation, prøves den næste i rækken. */
const FALDBAK = { it: 'sur', av: 'sur', sur: 'av' };

/** Speakeren (Assets/Kundelyde/Announcer): kampens start, døden og vandet. */
export const SPEAKER = {
  er_du_klar: 'stemme_announcer_er_du_klar',          // titlen, før nedtællingen
  nedtaelling: 'stemme_announcer_321_saet_i_gang',   // "3 … 2 … 1 … sæt i gang" (ui/intro.js følger den)
  doed: 'stemme_announcer_doed',
  vandet_stiger: 'stemme_announcer_vandet_stiger',   // pludselig død: vandet stiger
};

/*
 * De generelle, komiske lyde (brugerens egne, Assets/Kundelyde): skud,
 * granater, infernoet og eksplosionerne. Affyringslydene er sjove, men
 * barnlige, så de må ikke komme HVER gang (komisk() i main.js: hver anden
 * gang pr. gruppe, eller med det samme efter lang stilhed — ellers den
 * neutrale lyd). Eksplosionerne lyder hver gang et skud rammer eller en
 * bombe går af (brugerens ønske); de varieres bare.
 */
export const EFFEKTER = {
  skud: s('skud', 'skud_2', 'skud_3', 'skud_4'),                          // riflerne: Stregkodescanneren
  tonerkanon: s('skud', 'skud_2', 'skud_3', 'skud_4', 'kanon_lyd'),       // bazookaen
  granat: s('granat', 'granat_1', 'granat_2'),                            // Datalæk-bomben kastes
  inferno: s('inferno', 'inferno_2'),                                     // Integrations inferno
  // Eksplosionerne varieres på tværs af størrelserne: hver størrelse trækker
  // blandt flere af brugerens brag, og samme fil kommer aldrig to gange i træk
  // (heller ikke fra to forskellige størrelser; se FAELLES_SIDST).
  eksplosion: s('eksplosion', 'eksplosion_2', 'eksplosion_3'),                            // små brag (under 50 wu)
  eksplosion_stor: s('eksplosion_stor', 'eksplosion', 'eksplosion_2', 'eksplosion_3'),     // 50-69 wu
  kaempe_eksplosion: s('kaempe_eksplosion', 'eksplosion_stor'),                           // 70 wu og op
};
// Grupper, der deler "sidst spillede" — så to eksplosioner i træk aldrig lyder ens.
const FAELLES_SIDST = { eksplosion: 'brag', eksplosion_stor: 'brag', kaempe_eksplosion: 'brag' };

const sidstEffekt = new Map();
/** En tilfældig variant af gruppen — aldrig den samme to gange i træk. */
export function effektLyd(gruppe) {
  const l = EFFEKTER[gruppe];
  if (!l?.length) return null;
  const noegle = FAELLES_SIDST[gruppe] || gruppe;
  let i = Math.floor(Math.random() * l.length);
  if (l.length > 1 && l[i] === sidstEffekt.get(noegle)) i = (i + 1) % l.length;
  sidstEffekt.set(noegle, l[i]);
  return l[i];
}

/** Alle lydene herfra — de hentes ved siden af lyd.js' egne. */
export const ALLE_STEMMER = [...new Set([
  ...Object.values(KARAKTER_LYDE).flatMap((k) => Object.values(k).flat()),
  ...Object.values(SPEAKER),
  ...Object.values(EFFEKTER).flat(),
])];

/** Figuren bag en kunde, hvis det er en af karaktererne (ellers null). */
export const karakterFigur = (b) => (b?.udseende?.fast && KARAKTER_LYDE[b.udseende.figur] ? b.udseende.figur : null);

const sidstKarakter = new Map();
/** En tilfældig af karakterens lyde til situationen, eller null — aldrig den
 *  samme to gange i træk for samme karakter (fx turens replikker). */
export function karakterLyd(b, situation) {
  const figur = karakterFigur(b);
  const k = KARAKTER_LYDE[figur];
  if (!k) return null;
  const liste = k[situation] || k[FALDBAK[situation]];
  if (!liste?.length) return null;
  const noegle = `${figur}:${situation}`;
  let i = Math.floor(Math.random() * liste.length);
  if (liste.length > 1 && liste[i] === sidstKarakter.get(noegle)) i = (i + 1) % liste.length;
  sidstKarakter.set(noegle, liste[i]);
  return liste[i];
}
