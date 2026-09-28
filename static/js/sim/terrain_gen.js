/* Kundekrigen — procedurel banegenerering (MapGEN-stil).
 *
 * Hver kamp får en NY bane. Afstemningen vælger kun banetypen; frøet vælger
 * typens arketype og trækker dens parametre, og hver arketype følger faste
 * regler, så resultatet altid er spilbart (reglerne: docs/baner.md).
 *
 *   fort   to (eller flere) borge efter Worms' fort-tilstand. Frøet vælger
 *          en SILUET (borg, tvillinger, spir, ringmur, bastion) og et
 *          LANDSKAB imellem og omkring borgene (hav, skær, ø, bakke, bro,
 *          kløft, sø), borgenes højde og hvor langt fra hinanden de står.
 *          Borgene er altid spejlede og ens, og ingen kan gå eller hoppe
 *          over til fjenden (valideres på masken, se fortHopSikker).
 *   oeer, hule, aaben   naturbanerne: bane_natur.js.
 *
 * Fælles for alle (baneregler.js): banens mål og havet, oprydning af løse
 * stumper, standpladser, pynt med rigtig kontakt, broer af murværk, og en
 * valideringsrunde. Fejler en bane, prøver genererSpilbar igen med et afledt
 * frø. Alt afhænger kun af frøet (og fortets layout), så vært, spejl og gæster
 * bygger præcis den samme bane uden at sende den.
 */
'use strict';

import { lavRng, fbm1 } from '../core/rng.js';
import { Terraen, LUFT, JORD, FJELD, MUR } from './terrain.js';
import {
  BANE_B, BANE_H, VAND_NIVEAU, FJELD_BUND, SKEMAER, vaelgVaegtet, traekker, raekkevidde,
  standpladser, findKrydsning, placerPynt, glat,
} from './baneregler.js';
import { genererNatur } from './bane_natur.js';

export { BANE_B, BANE_H, VAND_NIVEAU };

// Fortet først: det er standardbanen og står øverst i lobbyen. UI'et og
// rum.py spejler listen — den må ikke ændres.
export const BANE_TYPER = ['fort', 'aaben', 'hule', 'oeer'];

export function genererBane(froe, type = 'aaben', bBredde = BANE_B, bHoejde = BANE_H, layout = null) {
  froe >>>= 0;
  const t = type === 'fort' ? genererFort(froe, layout, bBredde, bHoejde) : genererNatur(froe, type, bBredde, bHoejde);
  t.type = type === 'fort' || BANE_TYPER.includes(type) ? type : 'aaben';
  return t;
}

/** Startpladser: flade steder over vandet, hvor en kunde kan stå — også
 *  under et loft (hulens kamre, under overhæng). Aldrig i en lukket lomme
 *  (t.lukket, sat af naturbanerne) eller helt oppe under banens top.
 *  Sorteret efter x, så y. */
export function findStartpladser(t, vandNiveau = VAND_NIVEAU) {
  const TRIN = 16;
  const kand = standpladser(t, TRIN, 34, vandNiveau + 90);
  const pladser = [];
  const flad = (x, y) => {
    // Nabokolonnen har en overflade inden for 18 wu af y.
    for (let yy = y + 18; yy >= y - 18; yy--) if (t.fast(x, yy)) return !t.fast(x, yy + 1);
    return false;
  };
  // Kundens kapsel (physics.kapselFri: x-8..x+8, 30 wu op) skal være fri,
  // når den løftes højst 20 wu — sådan sætter udsætningen kunden (frigoer).
  const kapsel = (x, y) => {
    for (let yy = y + 1; yy <= y + 30; yy += 3) for (let xx = x - 8; xx <= x + 8; xx += 4) if (t.fast(xx, yy)) return false;
    return true;
  };
  const kanStaa = (x, y) => { for (let dy = 0; dy <= 20; dy += 2) if (kapsel(x, y + dy)) return true; return false; };
  const L = t.lukket;
  for (let i = 0; i < kand.length; i += 2) {
    const x = kand[i], y = kand[i + 1] - 1;
    if (x < 80 || x > t.w - 80 || y > t.h - 70) continue;
    if (!(flad(x - 24, y) && flad(x - 12, y) && flad(x + 12, y) && flad(x + 24, y))) continue;
    if (L && L.data[Math.min(L.fh - 1, (y + 20) >> 2) * L.fw + (x >> 2)]) continue;
    if (!kanStaa(x, y + 1)) continue;
    pladser.push({ x, y: y + 1 });
  }
  return pladser;
}

/** Er banen spilbar? Nok startpladser, spredt ud over banen (ikke alle i
 *  én ende), og nok af dem langt nok fra hinanden til begge hold. */
export function naturSpilbar(t, pladser, antalBaevere) {
  if (pladser.length < Math.max(6, antalBaevere * 3)) return false;
  const x0 = pladser[0].x, x1 = pladser[pladser.length - 1].x;
  if (x1 - x0 < t.w * 0.5) return false;
  // Mindst lige så mange spredte pladser (90 wu imellem) som kunder, x 1,5.
  let n = 0, sidst = -1e9;
  for (const p of pladser) if (p.x - sidst >= 90) { n++; sidst = p.x; }
  if (n < Math.ceil(antalBaevere * 1.5)) return false;
  // Øerne: plads til kunder på hver eneste ø.
  if (t.oeer) for (const o of t.oeer) if (!pladser.some((p) => p.x >= o.x0 && p.x <= o.x1)) return false;
  // Broerne, hvor skemaet kræver dem (dalene).
  if (t.kraeverBro && !(t.broer > 0)) return false;
  return true;
}

/** Generér, og prøv igen med nyt frø hvis banen ikke kan huse bæverne.
 *  layout ({ antalHold, prHold }) bruges kun af fortet og SKAL være det samme
 *  hos værten, spejlet og gæsterne — ellers bygges der andre forter. */
export function genererSpilbar(froe, type, antalBaevere, layout = null, forsoeg = 8) {
  if (typeof layout === 'number') { forsoeg = layout; layout = null; }
  froe >>>= 0;
  const lay = type === 'fort' ? fortLayout(layout, antalBaevere) : null;
  let sidste = null;
  for (let i = 0; i < forsoeg; i++) {
    const f = (froe + i * 7919) >>> 0;
    const terraen = genererBane(f, type, BANE_B, BANE_H, lay);
    const pladser = findStartpladser(terraen);
    sidste = { terraen, pladser, froe: f };
    // Fortets startpladser er bygget ind i planen og findes altid.
    if (lay || naturSpilbar(terraen, pladser, antalBaevere)) return sidste;
  }
  return sidste;
}

/* ------------------------------------------------------------------ fortet
 *
 * Fort-tilstand som i Worms: to (eller tre-fire) store, klodsede borge. Hver
 * klinik har sin egen borg med lige så mange ETAGER, som klinikken har kunder
 * (1-4; over fire står de ekstra side om side på de nederste etager), og
 * kunderne starter én pr. etage nedefra. Ingen kan gå eller hoppe over til
 * fjenden; falder man i havet, drukner man.
 *
 * Som MapGEN's fort-skema er borgen bygget af SEGMENTER med regler for, hvor
 * de hænger sammen: keep, trappekrop, tag, fortårn, tårntoppe, anneks og
 * udhæng. Frøet vælger en SILUET, der bestemmer segmenterne:
 *
 *   borg        den klassiske: højt fortårn mod fjenden, lavere keep bagest,
 *               måske kronetårn, vagttårn, porttårn, anneks og terrasser
 *   tvillinger  et højt BAGTÅRN tæt op ad keepen, så borgen har to høje
 *               tårne, og en GANGBRO fra keepens top over taget til fortårnet
 *   spir        spidse spir i stedet for tinder på fortårn, kronetårn,
 *               porttårn og anneks
 *   ringmur     lav keep og en lang RINGMUR bagud med et endetårn og
 *               hængetårne (bartizaner) på bagmuren
 *   bastion     bredt, klodset fortårn med tung krone, skrå fod (talus) for
 *               og bag og en lav keep
 *
 * Tinderne (højde, bredde, skår, måske svalehale) trækkes pr. kamp, og
 * hallerne skifter stil fra etage til etage — ingen gentagne fliser.
 *
 * Borgen set fra siden med fjenden til højre (siluetten borg; de spejlvendte
 * er ens):
 *
 *                                                         ┌┐┌┐┌┐┌┐┌┐
 *      ┌┐                                                 │  ⌒  ⌒  │ fortårnet:
 *      ││┌┐┌┐┌┐ keep            ┌┐┌┐┌┐ porttårn           │ ▯  ▯   │ højest, mod
 *    ┌┐││ ╲    │                │ ⌒⌒ │                    ├────────┤ fjenden
 *    │ └┘  ╲rampe dør          ┌┤▯  ▯├┐                   │ udkig ▯│ skydeskår
 *    │ ∩  ████████════════════ tag ═══════════════════════┤dør     │
 *    │    ███ ∩∩ ████╲╲ løb  ⌒⌒ hal ⌒ ▯ ⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒⌒ dør│ rum   ▯│
 *   ┌┤ ∩∩ ███████████████╲╲ ═ hul ═══════════════════════════╪════════╡ gesims
 *   ││    ████ ∩ ███ ∩ ███████╲╲ ▁▁ kamre ▁│▁ ▁▁▁▁▁▁▁▁▁▁▁▁ dør│ rum   ▯│
 *   │an-  ▓▓∩▓▓▓▓∩▓▓▓▓∩▓▓▓▓▓▓▓▓▓▓▓▓▓▓ massiv sokkel ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ plint
 *  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ hav
 *
 * - Borgen er mest MASSIV STEN med rum skåret ind (som i Worms): tykke mure
 *   (facade 52, ydermure 40, indervægge 34) og dæk på 36 wu.
 * - FORTÅRNET mod fjenden har kundernes rum, ét pr. etage, under en rund bue
 *   med et skydeskår i facaden over en brystning på 48 wu (højere end en
 *   kunde, 46; 18 wu tyk, så mundingen når ud over den, når man står helt
 *   fremme). Skåret vider sig ud udad. Et lige skud fra fjendens tilsvarende
 *   etage kan derfor ikke nå kunden (det skulle op over begge brystninger og
 *   ned igen), mens kunden selv skyder ud i en bue. En dør fører ind til
 *   etagens hal. Over taget har tårnet et udkigskammer med dør fra taget og
 *   samme skydeskår; derover er det massivt med vinduer, man ser igennem, og
 *   en udkraget krone med tinder (eller et spir) og måske et vagttårn på det
 *   forreste hjørne — toppen er kun til pynt.
 * - HALLERNE forbinder trappen med rummene: hvælvede haller eller lave gange
 *   med høje kamre, måske delt af en skillevæg med en dør, lavere over de
 *   nederste løb, og med vinduer i bagvæggen (en åben arkade: i alle fag).
 * - TRAPPELØBENE (60°) går op mod bagsiden som tunneler i murværket — sten
 *   under og over, kun frihøjde over løbet. Løbene flytter sig ét løb + en
 *   repos bagud pr. etage, og det øverste ender på taget foran keepen. I 2D
 *   er det den eneste trappe, man kan gå hele vejen op ad. Dækket over hvert
 *   løbs top har et hul (~37 wu i oversiden). Op en etage: gå mod bagsiden
 *   (falder man i hullet, lander man på løbet og går videre op); oppe vender
 *   man og hopper over hullet ud mod facaden.
 * - Under og bag trappen er borgen massiv med buer: nogle man ser himlen
 *   igennem (også en høj over to etager), andre blændede og mørke, i grupper
 *   af forskellig bredde pr. etage.
 * - KEEPEN bagest er lavere end fortårnet: en rampe inde i den fra en dør på
 *   taget op til toppen, eller en skrå forside, man går op ad (altid, når
 *   keepen er lav). Midt på taget står måske et porttårn, man går igennem.
 * - Soklen er massiv under hele den forreste del (intet hul til havet under
 *   kunderne); havbuerne sidder kun under den bageste del. Gesimser markerer
 *   etagerne, og der er altaner med skråstiver.
 *
 * LANDSKABET (fortLandskab) mellem og omkring borgene:
 *   hav     åbent hav; borgene står på hver sin klippe (måske høj)
 *   skaer   1-3 høje klippestøtter midt i havet
 *   oe      en ø midt i havet, måske med en ruin
 *   bakke   et højt, stejlt bjerg midt imellem, der tager de lige skud, måske
 *           med en havbue igennem
 *   bro     en brudt stenbro på buer ud fra hver borgs fod, med et hul midt på
 *   kloeft  borgene står på høje klipper med land bagud og en dyb kløft med
 *           overhængende vægge imellem
 *   soe     borgene står på lavt land, og en sø med strande skiller dem
 * Alt, hvad der ikke hører til en borg (støtterne, øen, bakken), står uden
 * for hoppets rækkevidde fra begge borge: ingen kan hoppe derud og videre.
 *
 * Med tre klinikker (og fem) er midterborgen DOBBELTSIDET: den samme borg
 * skåret i keepen og spejlet, så den har et fortårn i hver ende; kunderne
 * skifter side pr. etage (to på en etage: én i hver side). Med fire (og
 * seks) står borgene parvis facade mod facade: → ← → ←.
 *
 * Afstanden mellem to borge er mindst så stor, at et hop eller en salto fra
 * borgens højeste punkt ikke når den næste (fortPlan, raekkevidde); er der
 * ikke plads på banen, skæres pynt, der koster bredde, væk (trim), og
 * landskabet bliver åbent hav. Til sidst prøves det på selve masken
 * (fortHopSikker); fejler det, bygges banen om med åbent hav.
 *
 * Alt murværk er MUR og destruktibelt; kun havbunden er FJELD. Alle borge er
 * samme variant (spejlet, også på pixelniveau for fysikken — se fortPlan), og
 * hele banen er spejlet om midten. Den afhænger kun af (frø, layout).
 *
 * Til terrain_view.js: fort.rum er rektangler, hvor LUFT er bygningens indre
 * (bagvæg, G = 128): hver etage fra dens løb til facadens inderside (haller,
 * rum, løbenes tunneler og hullerne), udkigskammeret, keepens indre over
 * taget, porttårnets gennemgang og de blændede buer. Vinduerne i hallernes
 * bagvæg, skydeskårene i facaden, buerne man ser igennem, havbuerne,
 * vinduerne i tårnene, terrasserne og alt over taget er ikke med: dér ser man
 * himlen. Masken er MUR og LUFT i borgene og JORD/FJELD i landskabet.
 */
const FORT = {
  bund: VAND_NIVEAU + 110,     // stueetagens gulv (+40 med én etage, + løft)
  daek: 36,                    // etagedæk og tårntoppe
  mur: 40,                     // ydermure
  facade: 52,                  // fortårnets facade mod fjenden
  indermur: 34,                // indervægge
  bryst: 48,                   // brystningen under skydeskåret: over en kundes 46
  brystB: 18,                  // … og tynd nok til, at mundingen når ud over den
  doer: 66,                    // døråbninger
  hoved: 46,                   // frihøjde over løb og ramper (figuren er 46)
  ankomst: 34,                 // plads til at stå ved en rampes top
  havbund: 110,                // havbunden mellem borgene
  krone: 16,                   // tårntoppenes udkragning
  gesims: 20,                  // gesimserne ved hvert dæk
  plint: 18,                   // plinten foran facaden ved vandlinjen
  forrest: 62,                 // første kunde: så langt inde bag facaden
  side: 76,                    // næste kunde side om side
  kant: 100,                   // mindst så meget åbent hav ud mod banens ender
  sT: 1.7,                     // keeprampens stigning (som trappeløbene)
};
/* Toppen over vandet med 1-4 etager (± 20; P.top trækker fra med flere borge). */
const TOP_MAAL = [0, 650, 770, 880, 990];
/* Pr. antal klinikker: etagehøjde E, løbenes stigning s (1,7 = 60°), reposen
 * mellem løbene, fortårnets mindste bredde, hal 0's længde, borgens mindste
 * bredde med én etage (+50 pr. etage), keepens højde over taget (brøker af
 * E), toppens fradrag, havet mellem to facader og mellem to bagsider
 * (mindst; se raekkevidde), og pynten, der koster bredde: keepen trukket ind,
 * facaden trappet (sandsynlighed, min, maks), anneks bagpå (sandsynlighed,
 * bredde, trin) og altanen bagpå. Kroppens spil (alle siluetter, så to borge
 * med samme siluet ikke har rum, trapper og keep samme sted): hallen op til
 * halX længere, fortårnet op til ftX bredere, keepen op til kw bredere og
 * reposen op til rpX længere. */
const FORT_HOLD = [null,
  { E: 160, s: 1.7, repos: 30, ft: 240, hal: [90, 150], Wmin: 820, tk: [0.35, 0.7], top: 0, hav: 430, havB: 300,
    ki: 0.6, trinF: [0.55, 30, 76], anneks: [1, 70, 110, 0.6], bagAltan: 56, halX: 170, ftX: 60, kw: 70, rpX: 50, tfX: 110 },
  { E: 160, s: 1.7, repos: 30, ft: 240, hal: [90, 150], Wmin: 820, tk: [0.35, 0.7], top: 0, hav: 430, havB: 300,
    ki: 0.6, trinF: [0.55, 30, 76], anneks: [1, 70, 110, 0.6], bagAltan: 56, halX: 170, ftX: 60, kw: 70, rpX: 50, tfX: 110 },
  { E: 156, s: 1.8, repos: 28, ft: 232, hal: [50, 90], Wmin: 700, tk: [0.3, 0.6], top: -20, hav: 420, havB: 300,
    ki: 0.5, trinF: [0.4, 28, 44], anneks: [0.8, 60, 90, 0.4], bagAltan: 46, halX: 90, ftX: 30, kw: 40, rpX: 30, tfX: 60 },
  { E: 150, s: 2.0, repos: 24, ft: 216, hal: [30, 50], Wmin: 600, tk: [0.3, 0.5], top: -40, hav: 420, havB: 260,
    ki: 0.3, trinF: [0.3, 24, 36], anneks: [0, 0, 0, 0], bagAltan: 30, halX: 30, ftX: 0, kw: 20, rpX: 0, tfX: 0 },
  { E: 144, s: 2.0, repos: 24, ft: 200, hal: [26, 30], Wmin: 500, tk: [0.3, 0.4], top: -80, hav: 200, havB: 120,
    ki: 0, trinF: [0, 0, 0], anneks: [0, 0, 0, 0], bagAltan: 0, halX: 0, ftX: 0, kw: 0, rpX: 0, tfX: 0 },
  { E: 140, s: 2.1, repos: 22, ft: 190, hal: [26, 30], Wmin: 450, tk: [0.3, 0.4], top: -100, hav: 150, havB: 80,
    ki: 0, trinF: [0, 0, 0], anneks: [0, 0, 0, 0], bagAltan: 0, halX: 0, ftX: 0, kw: 0, rpX: 0, tfX: 0 },
];

/* Landskaberne, hvor borgene står på land (ellers står de på klipper i havet). */
const PAA_LAND = new Set(['kloeft', 'soe']);
/* Borgenes løft over standardhøjden pr. landskab (wu, trukket pr. kamp). */
const LOEFT = { hav: [0, 170], skaer: [0, 110], oe: [0, 90], bakke: [0, 100], bro: [0, 60], kloeft: [110, 230], soe: [20, 80] };

/** Normalisér layoutet: 1-6 klinikker, 1-8 kunder pr. klinik. */
export function fortLayout(layout, antalBaevere = 4) {
  const antalHold = Math.max(1, Math.min(6, Math.round(layout?.antalHold) || 2));
  const prHold = Math.max(1, Math.min(8,
    Math.round(layout?.prHold) || Math.ceil(antalBaevere / antalHold)));
  return { antalHold, prHold };
}

/** Hvor langt et hop (HOP_VX 160, HOP_VY 235, tyngde 480, maks faldfart
 *  780) når frem, når man lander d wu lavere — plus kapslens bredde. */
const rakkevidde = (d) => raekkevidde(d);

/** Kampens stil: siluet, landskab, løft, tinder og landskabets tal — kun fra
 *  frøet (og i en egen strøm, så intet andet i borgen flytter sig). tving
 *  giver et bestemt landskab (reserven er åbent hav). enkel er den sidste
 *  reserve, når der er trangt (5-6 klinikker): den klassiske borg uden
 *  løft og med de oprindelige tinder — præcis den gamle borg. */
function fortStil(froe, tving = null, enkel = false) {
  const r = traekker(froe, 0x2545f491);
  const S = SKEMAER.fort;
  const landskab0 = vaelgVaegtet(r, S.landskaber);
  const siluet = vaelgVaegtet(r, S.siluetter);
  const tal = [];
  for (let i = 0; i < 24; i++) tal.push(r());
  const landskab = tving || landskab0;
  const lf = LOEFT[landskab0];
  let loeft = Math.round((lf[0] + tal[0] * (lf[1] - lf[0])) / 10) * 10;
  if (tving) loeft = Math.min(loeft, LOEFT[tving][1]);
  const tinde = { h: 34 + Math.floor(tal[1] * 17), b: 26 + Math.floor(tal[2] * 19), s: 20 + Math.floor(tal[3] * 15), svale: tal[4] < 0.3 };
  if (enkel) return { landskab: 'hav', siluet: 'borg', loeft: 0, tinde: { h: 44, b: 36, s: 30, svale: false }, spred: tal[5], p: tal.slice(6), paaLand: false, enkel: true };
  return { landskab, siluet, loeft, tinde, spred: tal[5], p: tal.slice(6), paaLand: PAA_LAND.has(landskab) };
}

/** Borgens variant i LOKALE koordinater: lx = 0 er bagsiden, lx = W-1 er
 *  stueetagens facade mod fjenden, y som på banen. Ren funktion af layout,
 *  frø, trim og stil: alle tilfældige tal trækkes først, og trim (0-4)
 *  skærer bagefter pynt væk, der koster bredde, hvis borgene ikke kan stå på
 *  banen med hav nok imellem (fortPlan prøver 0, 1, 2 …). */
function fortVariant(L, froe, trim = 0, stil = fortStil(froe)) {
  const n = Math.max(1, Math.min(4, L.prHold));
  const P = FORT_HOLD[L.antalHold];
  const rng = lavRng((froe ^ 0x3243f6a8) >>> 0);
  const tal = [];
  for (let i = 0; i < 40; i++) tal.push(rng());
  let ti = 0;
  const r = () => tal[ti++];
  const mellem = (ab) => ab[0] + r() * (ab[1] - ab[0]);
  const heltal = (a, b) => a + Math.floor(r() * (b - a + 1));
  // Siluettens egne tal: en egen strøm, trukket før trim.
  const sRng = lavRng((froe ^ 0x68e31da4) >>> 0);
  const sTal = [];
  for (let i = 0; i < 48; i++) sTal.push(sRng());
  let sti = 0;
  const sr = () => sTal[sti++];
  const sm = (a, b) => a + sr() * (b - a);
  const sh = (a, b) => a + Math.floor(sr() * (b - a + 1));
  const { E, s } = P;
  const sil = stil.siluet;
  const TI = sil === 'bastion'
    ? { ...stil.tinde, b: Math.max(40, stil.tinde.b), h: Math.min(40, stil.tinde.h), s: Math.min(26, stil.tinde.s) }
    : stil.tinde;
  const M = FORT.mur, MI = FORT.indermur, D = FORT.daek, MF = FORT.facade, K = FORT.krone, TD = TI.h, sT = FORT.sT;
  const lo = stil.loeft;
  const Top = Math.min(BANE_H - 200, VAND_NIVEAU + 1000 + lo);
  const y = [];
  const bund = FORT.bund + lo + (n === 1 ? 40 : 0);
  for (let k = 0; k <= n; k++) y.push(bund + k * E);
  const Ls = Math.round(E / s);                           // et løbs vandrette længde
  const hulB = Math.ceil((D + FORT.hoved) / s) + 10;      // hullet over løbets top
  const hulT = Math.ceil((D + FORT.hoved) / sT) + 10;     // … og over tårnrampernes
  // --- trækningerne (samme rækkefølge uanset trim)
  const rKi = r(), rKiB = heltal(40, 84);
  let tk = Math.round(E * mellem(P.tk));
  const rVt = r(), vtB = heltal(26, 34), vtUd = heltal(18, 26), vtH = heltal(56, 80);
  const rKt = r(), ktB = heltal(40, 48), ktH = heltal(60, 90);
  const topJ = heltal(-20, 20);
  const rTrin = r(), trinB = heltal(P.trinF[1], P.trinF[2]), rFra = r();
  const hal0 = heltal(P.hal[0], P.hal[1]), wJ = heltal(-20, 20);
  const rKU = r();
  const gb = heltal(100, 140), gp = r(), gh = Math.round(E * (0.68 + r() * 0.22)), rPort = r();
  const altanR = r(), altanL = heltal(30, 42);
  const rAn = r(), anB = heltal(P.anneks[1], P.anneks[2]), anH = Math.round(E * (0.45 + r() * 0.5)), rAnT = r(), anT = heltal(50, 86);
  const rBA = r(), baL = heltal(30, Math.max(30, P.bagAltan)), baK = Math.min(n, 1 + Math.floor(r() * n));
  const bagR = r();
  // --- siluettens trækninger (også i fast rækkefølge)
  const q = {
    tvTk: sm(0.64, 0.9), btB: sh(92, 120), btJ: sh(-50, 10), btSpir: sr(), gbPil: sh(8, 16),
    spF: sm(0.75, 1.15), spKt: sm(1.2, 1.9), spP: sm(0.8, 1.3), spA: sm(0.9, 1.5), spKtB: sh(34, 44), spKtH: sh(56, 100), spKtJa: sr(),
    rmTk: sm(0.26, 0.4), rmAnB: sh(150, 230), rmAnH: sm(0.45, 0.75), rmEtB: sh(56, 76), rmEtJ: sh(-40, 60), rmSpir: sr(),
    baFt: sh(36, 64), baK: sh(24, 30), baTf: sh(30, 56), baTb: sh(22, 44), baPort: sr(), baTk: sm(0.3, 0.45),
    bzR: sr(), bzB: sh(34, 46), bzH: sh(64, 96), bzSpir: sr(), bzSp: sm(1.1, 1.6), btVin: sr(),
    baHal: sh(50, 130), baTfJ: sh(30, 60), spTfJ: sh(20, 50), boForm: sr(), boTfJ: sh(30, 70), boHal: sh(60, 120),
    halV: sr(), ftV: sr(), kwV: sr(), rpV: sr(), tfV: sr(),
  };
  // Proportionerne pr. siluet: bastionen lav og bred, spiret højt, borgen
  // enten høj og smal eller bred med lange haller.
  const boHoej = sil === 'borg' && !stil.enkel && q.boForm < 0.4, boBred = sil === 'borg' && !stil.enkel && q.boForm > 0.7;
  const tfJ = sil === 'bastion' ? -q.baTfJ : sil === 'spir' ? q.spTfJ : boHoej ? q.boTfJ : 0;
  // Kroppens spil (FORT_HOLD): hallen, fortårnet, keepen og reposen — for
  // alle siluetter (den høje, smalle borg får kun lidt længere hal), så
  // rummene, trappebåndet og keepen står forskellige steder fra kamp til
  // kamp. Pynt, der koster bredde: trim skærer det væk, når der er trangt.
  const spil = !stil.enkel;
  const halJ = trim >= 2 ? 0 : (sil === 'bastion' ? q.baHal : boBred ? q.boHal : 0) +
    (spil ? Math.round(q.halV * P.halX * (boHoej ? 0.4 : 1)) : 0);
  const kw = trim < 1 && spil ? Math.round(q.kwV * P.kw) : 0;
  const tfV = trim < 2 && spil ? Math.round((q.tfV - 0.4) * P.tfX) : 0;   // fortårnets højde: -0,4 til +0,6 af tfX
  const repos = P.repos + (trim < 1 && spil ? Math.round(q.rpV * P.rpX) : 0);

  if (sil === 'tvillinger') tk = Math.max(110, Math.round(E * q.tvTk));
  if (sil === 'ringmur') tk = Math.round(E * q.rmTk);
  if (sil === 'bastion') tk = Math.round(E * q.baTk);

  // Keepen bagest, måske trukket ind fra bagsiden (ki): lavere end fortårnet.
  // Bagtårnet (tvillinger) og ringmuren står op ad selve bagmuren.
  const ki = trim < 1 && rKi < P.ki && sil !== 'ringmur' && sil !== 'tvillinger' ? rKiB : 0;
  const Lk = Math.round(tk / sT);
  // Vagttårnet på fortårnets forreste hjørne tager noget af tårnets højde.
  let vt = trim < 3 && rVt < 0.5 && sil !== 'spir' && sil !== 'bastion' ? { b: vtB, ud: vtUd, h: vtH } : null;
  // Fortårnet mod fjenden er højest. Over taget har det et udkigskammer med
  // skydeskår (dør fra taget) og er massivt derover; toppen er kun pynt.
  const tf = Math.max(Math.round(0.9 * E), 190, Math.min(Math.round(2.2 * E), Top - TD - y[n],
    TOP_MAAL[n] + lo + P.top + topJ + tfJ + tfV - (vt ? 30 : 0) - (y[n] - VAND_NIVEAU) - TD));
  const yK = y[n] + tk, yF = y[n] + tf;
  if (vt) { const h = Math.min(vt.h, Top - TD - yF); vt = h >= 40 ? { ...vt, h } : null; }
  const kammerH = 112;                                    // udkigskammerets loft over taget
  // Facaden trappes måske: de øvre etager og tårnet trukket tilbage.
  const trin1 = trim < 3 && rTrin < P.trinF[0] ? trinB : 0;
  const fra1 = n >= 3 && rFra < 0.5 ? 2 : 1;
  const af = [];
  for (let k = 0; k <= n; k++) af.push(k >= fra1 ? trin1 : 0);
  let hal = (trim >= 2 ? P.hal[0] : hal0) + halJ;
  const ft = P.ft - (trim >= 4 ? 16 : 0) + (sil === 'bastion' && trim < 2 ? q.baFt : 0) +
    (trim < 2 && spil ? Math.round(q.ftV * P.ftX) : 0);
  // Keepens rampe: inde i keepen (en tunnel fra døren på taget) eller
  // udenpå (keepens forside er skrå, og man går op ad den). Tvillingernes
  // keep har altid rampen inde: dens top fortsætter som gangbroen. kw gør
  // keepens top længere bag rampen.
  let KB = ki + M + FORT.ankomst + Lk + 12 + MI + kw;     // keepens forside
  const keepUde = sil !== 'tvillinger' && (rKU < 0.45 || tk < FORT.doer + D + 4);
  if (keepUde) KB = ki + M + FORT.ankomst + 24 + Lk + kw; // toppen: bag rampen, der går ned til KB
  const W0 = KB + FORT.ankomst + (n - 1) * (Ls + repos) + Ls + hal + ft + af[n];
  const Wmin = P.Wmin + 50 * (n - 1) + wJ - (trim >= 2 ? 80 : 0);
  if (W0 < Wmin) { const ekstra = Wmin - W0, h1 = Math.min(ekstra, 40); hal += h1; KB += ekstra - h1; }
  // Løbene: løb k går fra (A[k] + Ls, y[k]) op mod bagsiden til (A[k], y[k+1]).
  const A = [];
  A[n - 1] = KB + FORT.ankomst;
  for (let k = n - 2; k >= 0; k--) A[k] = A[k + 1] + Ls + repos;
  const W = A[0] + Ls + hal + ft + af[n];
  const FT0 = W - af[n] - ft;                              // fortårnets bagside
  const Wk = af.map((a) => W - a);                        // etagernes facade
  const WF = Wk[n];

  // Kronetårnet på keepens bageste hjørne, udkraget over bagsiden (lavere
  // end fortårnet). Keepens krone rager kun ud over taget, hvis keepen er
  // høj nok til, at man kan gå under den.
  let kt = rKt < 0.6 && sil !== 'ringmur' && sil !== 'bastion' && sil !== 'tvillinger' ? { b: ktB, h: ktH } : null;
  if (sil === 'spir' && !kt && q.spKtJa < 0.8) kt = { b: q.spKtB, h: q.spKtH };
  const keepKrone = tk - D - FORT.krone >= 54;
  if (kt) { const h = Math.min(kt.h, yF - 24 - TD - yK, Top - TD - yK); kt = h >= 44 ? { ...kt, h } : null; }
  // Bagtårnet (tvillinger): et højt tårn op ad bagmuren, næsten så højt som
  // fortårnet — borgen får to høje tårne med gangbroen imellem.
  let bagtaarn = null;
  if (sil === 'tvillinger') {
    const b = q.btB, top = Math.min(yF + q.btJ, Top - TD);
    if (top - yK >= 90) bagtaarn = { a: -(b - 24), b: 23, top, spir: q.btSpir < 0.4, vinduer: q.btVin < 0.6 ? 2 : 1 };
  }
  // Porttårnet midt på taget: gennemgang med døre i begge ender.
  const tagA = A[n - 1] + hulB + 50, tagB = FT0 - 70;
  const rP = sil === 'bastion' ? q.baPort : rPort;
  let port = tagB - tagA >= gb + 20 && rP < (sil === 'bastion' ? 0.85 : 0.75)
    ? { a: Math.round(tagA + (tagB - tagA - gb) * (0.3 + 0.4 * gp)), h: gh } : null;
  if (port) port.b = port.a + gb - 1;
  // Gangbroen (tvillinger): keepens top fortsætter som en bro over taget hen
  // til fortårnet — med frihøjde nok under den til at gå på taget.
  let gangbro = null;
  if (sil === 'tvillinger' && FT0 - 1 - KB >= 60 && tk - 24 - q.gbPil >= 60) gangbro = { a: KB, b: FT0 - 1, y: yK, tyk: 24, pil: q.gbPil };
  if (gangbro) port = null;
  // Altan med skråstiver på facaden (et dæk uden terrasse), kort, og en bagpå.
  const altanDaek = [];
  for (let k = 1; k < n; k++) if (Wk[k] === Wk[k - 1]) altanDaek.push(k);
  const altan = trim < 3 && altanDaek.length && altanR < 0.7 ? { k: altanDaek[Math.floor(altanR / 0.7 * altanDaek.length)], l: altanL } : null;
  let anneks = trim < 1 && rAn < P.anneks[0] && sil !== 'tvillinger' ? { b: anB, h: anH, trin: rAnT < P.anneks[3] ? anT : 0 } : null;
  // Ringmuren: et langt, lavt anneks med tinder og et endetårn yderst.
  if (sil === 'ringmur' && trim < 1 && P.anneks[0] > 0) {
    const h = Math.round(E * q.rmAnH);
    anneks = { b: q.rmAnB, h, trin: 0, mur: true,
      et: { b: q.rmEtB, h: Math.max(90, y[n] - y[0] + q.rmEtJ - h), spir: q.rmSpir < 0.35 } };
  }
  const bagAltan = trim < 1 && P.bagAltan && rBA < 0.6 ? { l: baL, k: baK } : null;
  // Er keepen trukket ind, står bagsiden kun op til dæk bagTrin — en
  // terrasse med tinder, og keepen rejser sig bag den.
  let bagTrin = n;
  if (ki && n >= 2 && bagR < 0.7) bagTrin = 1 + Math.floor(bagR / 0.7 * (n - 1));
  if (anneks && y[bagTrin] < y[0] + anneks.h + 40) bagTrin = n;
  const vindue = [Math.min(104, E - D - 20), Math.min(116, E - 30)];   // skydeskårets overligger inde/ude

  // Bastionens tunge krone og skrå fod (talus) for og bag.
  const kroneK = sil === 'bastion' ? q.baK : K;
  const talus = sil === 'bastion' && trim < 1 ? { f: q.baTf, b: q.baTb } : null;
  // Hængetårne (bartizaner) på bagmurens øverste hjørne: altid på ringmuren
  // (og på endetårnet), ellers måske. Aldrig oven i kronetårnet.
  const bartizaner = [];
  if (trim < 1 && !bagtaarn && !stil.enkel) {
    const vil = sil === 'ringmur' || ((sil === 'borg' || sil === 'spir') && q.bzR < 0.45);
    const bx = bagTrin < n ? 0 : ki, yT = bagTrin < n ? y[bagTrin] : yK;
    if (vil && !(bagTrin === n && kt) && !(anneks && !anneks.mur && y[0] + anneks.h > yT - 140)) {
      bartizaner.push({ x: bx, y0: yT - q.bzH + 40, b: q.bzB, h: q.bzH, spir: sil === 'spir' || q.bzSpir < 0.3 ? Math.round(q.bzB * q.bzSp) : 0 });
    }
  }
  // Spirene (siluetten spir): i stedet for tinder på tårnene.
  const Kf = kroneK;
  const spir = { f: 0, kt: 0, port: 0, an: 0, et: 0, bt: 0 };
  const loftTop = BANE_H - 40;
  if (sil === 'spir') {
    spir.f = Math.min(Math.round((WF - FT0 + 2 * Kf + 8) * q.spF), loftTop - yF - 16);
    if (kt) spir.kt = Math.min(Math.round((2 * kt.b + 8) * q.spKt), loftTop - yK - kt.h - 16);
    if (port) spir.port = Math.round((port.b - port.a + 2 * K + 8) * q.spP * 0.6);
    if (anneks) spir.an = Math.round((anneks.b + 16) * q.spA * 0.7);
  }
  if (bagtaarn && bagtaarn.spir) spir.bt = Math.min(Math.round((bagtaarn.b - bagtaarn.a + 2 * K + 8) * 1.1), loftTop - bagtaarn.top - 16);
  if (anneks && anneks.et && anneks.et.spir) spir.et = Math.round((anneks.et.b + 2 * K) * 1.2);

  const paaLand = stil.paaLand;
  const grund = paaLand ? y[0] - 48 : y[0] - 160;          // klippens (eller landets) top under borgen
  const v = { n, E, s, repos, ft, y, Ls, hulB, hulT, ki, tk, Lk, KB, A, af, W, FT0, Wk, tf, sT, kammerH,
              yK, yF, kronetaarn: kt, vagttaarn: vt, port, altan, anneks, bagAltan, bagTrin, vindue,
              keepUde, keepKrone, trim, siluet: sil, tinde: TI, kroneK, talus, bartizaner, spir, bagtaarn, gangbro,
              paaLand, grund, sokkel: grund - 20 };
  fortPynt(v, lavRng((froe ^ 0x7f4a7c15) >>> 0));
  const ktTop = kt ? yK + kt.h + (spir.kt ? spir.kt + 14 : TD) : 0;
  const anTop = anneks ? y[0] + anneks.h + (spir.an ? spir.an + 14 : TD) : 0;
  const etTop = anneks && anneks.et ? y[0] + anneks.h + anneks.et.h + (spir.et ? spir.et + 14 : TD) : 0;
  const btTop = bagtaarn ? bagtaarn.top + (spir.bt ? spir.bt + 14 : TD) : 0;
  const bzTop = Math.max(0, ...bartizaner.map((z) => z.y0 + z.h + (z.spir ? z.spir + 10 : 24)));
  v.top = Math.max(yF + (spir.f ? spir.f + 14 : TD + (vt ? vt.h : 0)), ktTop, port ? y[n] + port.h + (spir.port ? spir.port + 14 : TD) : 0,
    anTop, etTop, btTop, bzTop);
  // Steder bagtil, man kan stå på (oppe på en tinde), og hvor langt de er
  // fra bagsiden — til havet mellem to bagsider.
  v.bagPunkter = [{ lx: ki - K, y: yK + TD }];
  if (kt) v.bagPunkter.push({ lx: ki - kt.b, y: ktTop });
  if (ki >= 30) v.bagPunkter.push({ lx: -K, y: y[bagTrin] + TD });
  if (anneks) v.bagPunkter.push({ lx: -anneks.b - 8, y: anTop });
  if (anneks && anneks.et) v.bagPunkter.push({ lx: -anneks.b - anneks.et.b + 16 - K, y: etTop });
  if (bagtaarn) v.bagPunkter.push({ lx: bagtaarn.a - K, y: btTop });
  for (const z of bartizaner) v.bagPunkter.push({ lx: z.x - z.b + 8, y: z.y0 + z.h + (z.spir ? z.spir + 10 : 24) });
  if (bagAltan) v.bagPunkter.push({ lx: (bagAltan.k > bagTrin ? ki : 0) - bagAltan.l, y: y[bagAltan.k] + 24 });
  v.bagPunkter.push({ lx: -FORT.gesims, y: y[bagTrin] });
  // Det laveste, man kan stå på udenfor for og bag: landet eller plinten (y[0]
  // - 40), klippen over vandet og den skrå fod ned til vandet.
  const vandKant = VAND_NIVEAU + 1;
  const klippe = !paaLand && grund > VAND_NIVEAU ? grund + 1 : 1e9;
  v.forLav = Math.min(y[0] - 40, talus ? Math.max(vandKant, v.sokkel) : 1e9, klippe);
  v.bagLav = Math.min(y[0] - 40, talus ? Math.max(vandKant, v.sokkel) : 1e9, klippe,
    !paaLand && v.havbuer.length && grund - 8 > VAND_NIVEAU ? grund - 7 : 1e9);
  return v;
}

/** Løb k's overflade i lokal x: y[k+1] bag toppen, y[k] foran foden. */
function loebY(v, k, lx) {
  const fod = v.A[k] + v.Ls;
  if (lx <= v.A[k]) return v.y[k + 1];
  if (lx >= fod) return v.y[k];
  return v.y[k] + (fod - lx) * v.s;
}

/** Fag fra a til b med piller (pb) imellem: skiftevis brede og smalle fag
 *  eller lige brede, skaleret så de fylder det hele. */
function lavFag(a, b, bred, smal, pb, skift) {
  const len = b - a + 1;
  const bredde = (j) => (skift && j % 2 ? smal : bred);
  let m = 1;
  for (;;) { let sum = m * pb; for (let j = 0; j <= m; j++) sum += bredde(j); if (sum > len) break; m++; }
  let sum = 0;
  for (let j = 0; j < m; j++) sum += bredde(j);
  const skala = (len - (m - 1) * pb) / sum;
  const ud = [];
  let x = a;
  for (let j = 0; j < m; j++) {
    const e = j === m - 1 ? b : Math.round(x + bredde(j) * skala) - 1;
    ud.push([x, e]);
    x = e + 1 + pb;
  }
  return ud;
}

/** Hallerne, buerne i den massive bagdel og havbuerne — data til bygBorg og
 *  fortIndhold, trukket af den samme rng. */
function fortPynt(v, rng) {
  const { n, y, E, A, Ls, ki, FT0, bagTrin } = v;
  const M = FORT.mur, D = FORT.daek;
  const heltal = (a, b) => a + Math.floor(rng() * (b - a + 1));
  // --- hallerne: hvælv, lave gange med høje kamre, eller én åben arkade
  v.haller = [];
  let arkade = false;
  for (let k = 0; k < n; k++) {
    const a = A[k] + v.Ls, b = FT0 - 1, len = b - a + 1;
    const r = rng();
    let stil = r < 0.42 ? 'hvaelv' : r < 0.78 ? 'kamre' : 'arkade';
    if (stil === 'arkade' && (arkade || k === 0 || len < 180)) stil = 'hvaelv';
    if (k > 0 && stil === v.haller[k - 1].stil && rng() < 0.65) stil = stil === 'kamre' ? 'hvaelv' : 'kamre';
    if (stil === 'arkade') arkade = true;
    const hal = { stil, a, b, vl: heltal(84, 94) };
    if (stil === 'kamre') {
      hal.lav = 100;
      hal.kamre = [];
      const antal = len > 300 ? 2 : len > 110 ? 1 : 0;
      for (let j = 0; j < antal; j++) {
        const s0 = a + Math.round(len * j / antal), s1 = a + Math.round(len * (j + 1) / antal) - 1;
        const cw = Math.min(heltal(64, 104), s1 - s0 - 40);
        if (cw < 44) continue;
        const c0 = s0 + 20 + Math.floor(rng() * (s1 - s0 - 40 - cw + 1));
        hal.kamre.push([c0, c0 + cw - 1]);
      }
    } else {
      hal.fag = lavFag(a + 8, b, heltal(96, 136), heltal(46, 70), heltal(26, 40), rng() < 0.55);
    }
    // En skillevæg med en dør deler måske hallen: en af hvælvets piller går
    // helt ned, eller en væg i gangen mellem kamrene. Aldrig ved hullet,
    // man hopper over, eller ved døren ind til rummet.
    hal.vaegge = [];
    const ha = k === 0 ? A[0] + v.Ls : A[k - 1] + v.hulB;
    const rV = rng(), rJ = rng(), rVin = rng(), rLav = rng();
    // Over de nederste løb er hallen en lavere gang (mere sten over den).
    hal.lavTil = k > 0 && rLav < 0.7 ? A[k - 1] + v.Ls + 10 : null;
    // Vinduer i bagvæggen: i hvert andet fag (eller i kamrene) ser man himlen
    // over en mørk brystning — arkaden er alle fag.
    hal.vinduer = [];
    const halvt = rVin < 0.5 ? 0 : 1;
    const hoej = (a0) => hal.lavTil == null || a0 > hal.lavTil;
    const vB = heltal(30, 44);
    const vindue = (a0, b0) => { const w = Math.min(vB, b0 - a0 - 24), c = Math.round((a0 + b0) / 2); if (w >= 22) hal.vinduer.push([c - (w >> 1), c - (w >> 1) + w - 1]); };
    if (hal.fag) hal.fag.forEach(([fa, fb], j) => {
      if (!hoej(fa)) return;
      if (stil === 'arkade' || (rVin < 0.75 && hal.fag.length >= 2 && j % 2 === halvt)) vindue(fa, fb);
    });
    else if (rVin < 0.6) for (const [c0, c1] of hal.kamre) if (hoej(c0)) vindue(c0, c1);
    if (hal.fag && hal.fag.length >= 3 && rV < 0.65) {
      const kand = [];
      for (let j = 1; j < hal.fag.length; j++) {
        const pa = hal.fag[j - 1][1] + 1 - 4, pb = hal.fag[j][0] - 1 + 4;
        if (pa - ha >= 70 && FT0 - pb >= 60) kand.push([pa, pb]);
      }
      if (kand.length) hal.vaegge.push(kand[Math.floor(rJ * kand.length)]);
    } else if (stil === 'kamre' && rV < 0.55) {
      const tw = 36, lo = ha + 70, hi = FT0 - 60 - tw;
      for (let i = 0; i < 6 && hi > lo; i++) {
        const x = lo + Math.floor(((rJ + i * 0.37) % 1) * (hi - lo));
        if (hal.kamre.every(([c0, c1]) => x + tw - 1 < c0 - 16 || x > c1 + 16)) { hal.vaegge.push([x, x + tw - 1]); break; }
      }
    }
    v.haller.push(hal);
  }
  // --- buer i den massive bagdel: pr. etage grupper af 1-3 buer af samme
  // bredde, skiftevis nogle man ser himlen igennem og blændede (mørke), og
  // måske én høj bue over to etager.
  v.buer = [];
  const bagX = (k) => (k >= bagTrin ? ki : 0) + M + 22;
  const optaget = [];                                        // [k, a, b]
  if (n >= 2 && rng() < 0.45) {
    const k = Math.floor(rng() * (n - 1));
    const xa = Math.max(bagX(k), bagX(k + 1)), xb = A[k + 1] - 46;
    const w = heltal(70, 108);
    if (xb - xa >= w) {
      const a = xa + Math.floor(rng() * (xb - xa - w + 1));
      v.buer.push({ a, b: a + w - 1, y0: y[k] + 18, y1: y[k + 2] - D - 18, slags: 'gennem' });
      optaget.push([k, a, a + w - 1], [k + 1, a, a + w - 1]);
    }
  }
  for (let k = 0; k < n; k++) {
    const xa = bagX(k), xb = A[k] - 46;
    let x = xa + heltal(0, 36);
    let slags = rng() < 0.6 ? 'gennem' : 'blind';
    while (x < xb - 40) {
      const c = rng() < 0.45 ? 1 : rng() < 0.65 ? 2 : 3;
      const w = c === 1 ? heltal(60, 124) : heltal(40, 78), p = heltal(22, 38);
      let bb = Math.min(c, Math.floor((xb - x + p) / (w + p)));
      if (bb < 1) break;
      const ende = x + bb * w + (bb - 1) * p - 1;
      const kolli = optaget.find(([kk, a, b]) => kk === k && a <= ende + 24 && b >= x - 24);
      if (kolli) { x = kolli[2] + 30 + heltal(0, 30); continue; }
      for (let j = 0; j < bb; j++) {
        const a = x + j * (w + p);
        v.buer.push({ a, b: a + w - 1, y0: y[k] + 18, y1: y[k + 1] - D - 18, slags });
      }
      x = ende + 1 + heltal(34, 80);
      slags = slags === 'gennem' ? (rng() < 0.7 ? 'blind' : 'gennem') : 'gennem';
    }
  }
  // --- havbuer: kun under den bageste del, aldrig under hallerne og rummene
  // (og ikke, når borgen står på land: dér er soklen gravet ned)
  v.havbuer = [];
  {
    let x = (v.anneks ? 0 : -8) + 16 + heltal(0, 20);
    const xb = A[0] - 60;
    while (x < xb) {
      const w = heltal(46, 100), p = heltal(26, 52);
      if (x + w - 1 > xb) break;
      v.havbuer.push([x, x + w - 1]);
      x += w + p;
    }
    if (v.paaLand || y[0] - FORT.daek - 18 - (v.grund - 8) < 40) v.havbuer = [];
  }
  // --- tårnvinduer (man ser igennem): i fortårnet over udkigskammeret
  v.vinduer = [];
  const { yF, tf, Wk, tk } = v;
  const WF = Wk[n], yR = y[n];
  {
    const y0 = yR + v.kammerH + D + 14, y1 = yF - D - 16;
    const a = FT0 + 24, b = WF - 24;
    if (y1 - y0 >= 56) {
      const to = b - a >= 150 && rng() < 0.6;
      const w = to ? heltal(34, 44) : Math.min(heltal(40, 56), b - a);
      if (to) {
        const g = heltal(24, 40), c = Math.round((a + b) / 2);
        v.vinduer.push({ a: c - g / 2 - w, b: c - g / 2 - 1, y0, y1 }, { a: c + g / 2, b: c + g / 2 + w - 1, y0, y1 });
      } else {
        const c = a + (w >> 1) + Math.floor(rng() * Math.max(1, b - a - w));
        v.vinduer.push({ a: c - (w >> 1), b: c - (w >> 1) + w - 1, y0, y1 });
      }
    } else if (y1 - y0 >= 40) {
      const r0 = Math.min(18, (y1 - y0) >> 1), c = Math.round((a + b) / 2);
      v.vinduer.push({ a: c - r0, b: c + r0, y0: y0, y1: y0 + 2 * r0, rund: true });
    }
  }
  {
    // keepen: en smal åbning i bagmuren over taget
    const { KB, Lk } = v;
    const kb = v.keepUde ? KB - Lk : KB - FORT.indermur - 12 - Lk;
    const c = ki + Math.round((kb - ki) / 2);
    if (tk >= 70 && kb - ki >= 50) v.vinduer.push({ a: c - 6, b: c + 6, y0: yR + 30, y1: yR + Math.min(tk - D - 20, 96), keep: true });
  }
}

/** Rektanglet r minus hullerne (rektangler) som en liste af rektangler. */
function minusHuller(r, huller) {
  const xs = [r.a, r.b + 1];
  for (const hh of huller) if (hh.x1 >= r.a && hh.x0 <= r.b) xs.push(Math.max(r.a, hh.x0), Math.min(r.b, hh.x1) + 1);
  xs.sort((p, q) => p - q);
  const ud = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1] - 1;
    if (b < a) continue;
    const iv = huller.filter((hh) => hh.x0 <= a && hh.x1 >= b).map((hh) => [hh.y0, hh.y1]).sort((p, q) => p[0] - q[0]);
    let y0 = r.y0;
    for (const [h0, h1] of iv) { if (h0 > y0) ud.push({ a, b, y0, y1: Math.min(r.y1, h0 - 1) }); y0 = Math.max(y0, h1 + 1); }
    if (y0 <= r.y1) ud.push({ a, b, y0, y1: r.y1 });
  }
  return ud;
}

/** Kunder, udstyrspladser, kasser, rum, trapper — alt i lokale koordinater
 *  for den enkeltsidede borg (facaden i lx = W). */
function fortIndhold(v, L) {
  const { n, y, FT0, KB, A, Ls, hulB, hulT, Wk } = v;
  const MI = FORT.indermur, MF = FORT.facade, K = FORT.krone, T = v.tinde.b;
  const antal = [];                                  // kunder pr. etage, nedefra
  for (let k = 0; k < n; k++) antal.push(Math.floor(L.prHold / n) + (k < L.prHold % n ? 1 : 0));
  const rA = FT0 + MI;
  const rum = [];                                    // kundernes rum pr. etage [a, b]
  const pladser = [];                                // pr. etage: forrest og bagerst
  for (let k = 0; k < n; k++) {
    const x1 = Wk[k] - MF - 1 - FORT.forrest;
    rum.push([rA, Wk[k] - MF - 1]);
    pladser.push([x1, Math.max(rA + 12, x1 - FORT.side)]);
  }
  // Udstyr: hallernes gulve foran løb og huller, taget foran hullet,
  // gangbroen og keepens top (aldrig i kundernes rum eller udkigskammeret).
  const kand = [];
  const linje = (a, b, yy, trin = 40) => { for (let x = Math.round(a); x <= b; x += trin) kand.push({ lx: x, y: yy }); };
  for (let k = 0; k < n; k++) linje((k === 0 ? A[0] + Ls : A[k - 1] + hulB) + 18, FT0 - 22, y[k]);
  const g = v.port, gb = v.gangbro;
  // Keepens rampe går mod bagsiden.
  const ka = v.keepUde ? KB : KB - MI - 12, kb = ka - v.Lk;
  const tagA = A[n - 1] + hulB + 18, tagB = FT0 - 22;
  for (let x = tagA; x <= tagB; x += 40) if (!(g && x >= g.a - 20 && x <= g.b + 20)) kand.push({ lx: x, y: y[n] });
  if (gb) linje(gb.a + 30, gb.b - 30, gb.y);
  // Keepens top bag rampen: fri af kronetårnet og bagtårnet (og dets krone).
  const keepBag = [v.kronetaarn ? v.ki + v.kronetaarn.b + 10 : v.bagtaarn ? v.bagtaarn.b + K + T + 10 : v.ki - K + T + 10, kb - 12];
  if (keepBag[1] - keepBag[0] >= 0) kand.push({ lx: Math.round((keepBag[0] + keepBag[1]) / 2), y: v.yK, top: true });
  // Forsyningskasser slippes over taget og keepens top (ikke over
  // porttårnet, kronetårnet, bagtårnet og fortårnet, som man ikke kan komme
  // op på — heller ikke under fortårnets krone, der på bastionen rager langt
  // ind over taget). Under gangbroen lander de på broen, så dér slippes de
  // over broen. kasseSpand er stykkerne, man kan stå på hele vejen: kassen
  // driver kun inden for sit stykke (world._slipVaabenkasse).
  const kasser = [], kasseSpand = [];
  const stykke = (a, b, med = () => true) => {
    let s = null;
    for (let x = a; x <= b; x += 20) {
      if (!med(x)) { s = null; continue; }
      kasser.push(x);
      if (s) s[1] = x; else kasseSpand.push(s = [x, x]);
    }
  };
  const kasseB = FT0 - Math.max(22, v.kroneK + 6);
  stykke(tagA, kasseB, (x) => !(g && x >= g.a - 24 && x <= g.b + 24) && !(gb && x >= gb.a - 24 && x <= gb.b + 24));
  if (gb) stykke(gb.a + 24, gb.b - 24);
  stykke(keepBag[0], keepBag[1]);
  // Bagvæg: hver etage fra dens løb til facadens inderside (tunnelen, hullet
  // og dækket over med) minus vinduerne i bagvæggen; udkigskammeret, keepens
  // indre (når rampen er inde), porttårnet og de blændede buer.
  const vinduer = v.vinduer.map((w) => ({ x0: w.a, x1: w.b, y0: w.y0, y1: w.y1 }));
  const bag = [];
  for (let k = 0; k < n; k++) {
    const hal = v.haller[k];
    const r = { a: A[k] - 12, b: Wk[k] - MF - 1, y0: y[k] + 1, y1: y[k + 1] };
    // Vinduerne i bagvæggen: man ser himlen gennem en trappet rundbue over en
    // mørk brystning (bagvæggen er rektangler, så buen er trin).
    const huller = [];
    for (const [a, b] of hal.vinduer) {
      const top = y[k] + Math.min(hal.stil === 'kamre' ? 112 : hal.vl + 20, y[k + 1] - FORT.daek - y[k] - 4), bund = y[k] + 44;
      const hb = (b - a + 1) / 2;
      huller.push({ x0: a, x1: b, y0: bund, y1: Math.round(top - hb * 0.7) });
      for (const [ind, h0, h1] of [[0.13, 0.7, 0.42], [0.3, 0.42, 0.2], [0.55, 0.2, 0]]) {
        huller.push({ x0: Math.round(a + hb * ind), x1: Math.round(b - hb * ind), y0: Math.round(top - hb * h0) + 1, y1: Math.round(top - hb * h1) });
      }
    }
    bag.push(...minusHuller(r, huller));
  }
  if (!v.keepUde) bag.push(...minusHuller({ a: v.ki, b: KB - 1, y0: y[n] + 1, y1: v.yK }, vinduer));
  bag.push({ a: FT0, b: Wk[n] - MF - 1, y0: y[n] + 1, y1: y[n] + v.kammerH });
  if (g) bag.push({ a: g.a, b: g.b, y0: y[n] + 1, y1: y[n] + g.h - FORT.daek });
  for (const bu of v.buer) if (bu.slags === 'blind') bag.push({ a: bu.a, b: bu.b, y0: bu.y0, y1: bu.y1 });
  // Trapperne til testene: løb og huller, keepens rampe og udkigskammeret.
  const trapper = [];
  // hul: åbningen i dækkets overside (tunnelen skærer dækket nedefra lidt længere frem)
  const hulTop = Math.ceil(10 + FORT.hoved / v.s);
  for (let k = 0; k < n; k++) trapper.push({ fra: y[k], til: y[k + 1], top: A[k], fod: A[k] + Ls, hul: [A[k], A[k] + hulTop] });
  const ramper = { keep: { fod: ka, top: kb, fra: y[n], til: v.yK, hul: v.keepUde ? [kb, kb] : [kb, kb + hulT], ude: v.keepUde },
                   udkig: { fod: rA, top: Wk[n] - MF - 1, fra: y[n], til: y[n], hul: [rA, rA] } };
  return { antal, pladser, rum, kand, kasser, kasseSpand, bag, trapper, ramper };
}

/** Sidemodellen for en borgs forside: hvor lavt og højt man kan stå. En
 *  ting i højden h er uden for hoppets rækkevidde fra siden, når den står
 *  mindst klaring(side, h) fra borgens fodaftryk. */
function klaring(side, h) {
  return Math.ceil(rakkevidde(Math.max(side.yHi - h, h - side.yLo, 0)) + 24);
}

/** Hvad landskabet kræver af hullet mellem to facader (mindst og højst) og
 *  dets tal. p er landskabets andele (0-1) fra stilen. */
function frontBehov(ls, v, side, p, havF) {
  const y0 = v.y[0], hl = y0 - 40, V = VAND_NIVEAU;
  const R0 = Math.ceil(rakkevidde(0) + 24);
  switch (ls) {
    case 'bro': {
      // Broen ligger med oversiden i plintens højde; hullet midt på er
      // bredere end et hop, og ingen bro-ende er inden for et hop fra den
      // anden borgs forside (heller ikke fra dens top).
      const hb = y0 - 30, brud = R0 + 30 + Math.round(p[0] * 110), kl = klaring(side, hb - 30);
      const L = 220 + Math.round(p[3] * 160);                 // ønsket længde af hver halvdel
      const min = Math.max(havF, 2 * L + brud, L + kl + 4);
      return { min, maks: min + 260, hb, brud, kl, spand: 88 + Math.round(p[1] * 44), pille: 26 + Math.round(p[2] * 8) };
    }
    case 'kloeft': {
      const F = 50 + Math.round(p[0] * 130), ov = 16 + Math.round(p[1] * 24), rec = 40 + Math.round(p[2] * 80);
      const min = Math.max(havF, 2 * (F + ov) + R0 + 40, F + ov + klaring(side, hl));
      return { min, maks: min + 300, F, ov, rec, hl };
    }
    case 'soe': {
      const F = 20 + Math.round(p[0] * 90), S = 110 + Math.round(p[1] * 120), dyb = 60 + Math.round(p[2] * 70);
      const min = Math.max(havF, 2 * (F + S) + R0 + 40, F + S + klaring(side, V + 1));
      return { min, maks: min + 280, F, S, dyb, hl };
    }
    case 'skaer': {
      // 1-3 støtter, symmetrisk om midten; lodrette eller udhængende sider,
      // så man kun kan stå på toppen.
      // 1: én midt på; 2: et par; 3: én midt på og et par; 4: to par.
      const c = 1 + Math.floor(p[0] * 4);
      const stoette = (j, par) => {
        const r = 48 + Math.round(p[1 + j] * 40);
        return { r, h: V + 110 + Math.round(p[4 + j] * Math.min(400, r * 6)), par };
      };
      const liste = c === 1 ? [stoette(0, false)] : c === 2 ? [stoette(0, true)] : c === 3 ? [stoette(0, false), stoette(1, true)]
        : [stoette(0, true), stoette(1, true)];
      let halv = 0, a0 = 0;
      for (const s of liste) {
        const rT = s.r + 12;
        s.kl = klaring(side, s.h - 16);
        if (s.par) { s.a = a0 + rT + 60 + Math.round(p[8 + liste.indexOf(s)] * 110); a0 = s.a + rT; }
        else { s.a = 0; a0 = rT; }
        halv = Math.max(halv, s.a + rT + s.kl);
      }
      const min = Math.max(havF, 2 * halv);
      return { min, maks: min + 240, stoetter: liste };
    }
    case 'oe': {
      const wi = 160 + Math.round(p[0] * 150), ht = V + 90 + Math.round(p[1] * 200);
      const ruin = p[2] < 0.6 ? { rw: 24 + Math.round(p[3] * 16), rh: 80 + Math.round(p[4] * 100) } : null;
      const form = p[5] < 0.4 ? 'plateau' : p[5] < 0.75 ? 'to' : 'bakke';     // flad top, to bakker, eller én
      const min = Math.max(havF, 2 * (wi + 30 + klaring(side, V + 1)));
      return { min, maks: min + 240, wi, ht, ruin, form };
    }
    case 'bakke': {
      // Bjerget står HELT uden for hoppets rækkevidde (også ved vandkanten),
      // så dets skråninger kan være nok så gangbare.
      const wb = 190 + Math.round(p[0] * 150);
      const thMax = Math.min(side.yHi - 60, V + 720);
      const th = Math.round(V + 280 + p[1] * Math.max(0, thMax - V - 280));
      const form = p[2] < 0.35 ? 'kegle' : p[2] < 0.7 ? 'plateau' : 'to';
      const min = Math.max(havF, 2 * (wb + 30 + klaring(side, V + 1)));
      return { min, maks: min + 220, wb, th, form, terrasser: p[6] < 0.6,
               bue: p[3] < 0.55 ? { aw: 44 + Math.round(p[4] * 40), ah: 70 + Math.round(p[5] * 60) } : null };
    }
    default: return { min: havF, maks: havF + 900 };
  }
}

/** Fortenes geometri og placering. Ren funktion af layout, banebredde og frø.
 *
 *  Retning pr. borg: 1 = facaden mod højre, -1 = mod venstre, 0 =
 *  dobbeltsidet (midterborgen med et ulige antal). Med et lige antal står
 *  borgene parvis facade mod facade. Afstanden mellem to borge er mindst så
 *  stor, at et hop fra borgens højeste punkt (eller en salto) ikke når over:
 *  raekkevidde fra toppen ned til den andens laveste sted + 24 (mellem to
 *  bagsider fra det højeste, man kan stå på bagtil), og landskabet imellem
 *  kan kræve mere (frontBehov). Passer det ikke på banen, prøves først åbent
 *  hav og så trim 1-4 (fortVariant). tving giver et bestemt landskab. */
export function fortPlan(layout, bBredde = BANE_B, froe = 0, tving = null) {
  const L = fortLayout(layout);
  froe >>>= 0;
  const stil = fortStil(froe, tving);
  const hav = stil.landskab === 'hav' ? stil : fortStil(froe, 'hav');
  const enkel = fortStil(froe, 'hav', true);
  let plan = null;
  for (let trim = 0; trim <= 4; trim++) {
    // Fra trim 2 er der kun plads til åbent hav; er der stadig for trangt,
    // bliver det den klassiske borg (som før skemaerne).
    if (trim < 2 && stil !== hav) {
      plan = fortPlanTrim(L, bBredde, froe, trim, stil);
      if (plan.passer) return plan;
    }
    plan = fortPlanTrim(L, bBredde, froe, trim, hav);
    if (plan.passer) return plan;
    plan = fortPlanTrim(L, bBredde, froe, trim, enkel);
    if (plan.passer) return plan;
  }
  return plan;
}

function fortPlanTrim(L, bBredde, froe, trim, stil) {
  const v = fortVariant(L, froe, trim, stil);
  const ind = fortIndhold(v, L);
  const P = FORT_HOLD[L.antalHold];
  const H = L.antalHold, n = v.n;
  // Borgens fodaftryk i lokale koordinater: anneks/altan/tårne/fod bagtil og
  // plint/fod/altan/gesims/krone/vagttårn fortil.
  const an = v.anneks;
  const bag = Math.max(FORT.krone, FORT.gesims,
    an ? an.b + Math.max(8, an.trin) + (an.et ? an.et.b - 16 + FORT.krone : 0) : 0,
    v.bagAltan ? v.bagAltan.l : 0, v.kronetaarn ? v.kronetaarn.b - v.ki : 0,
    v.talus ? (an ? an.b + Math.max(8, an.trin) + (an.et ? an.et.b - 16 : 0) : 12) + v.talus.b : 0,
    v.bagtaarn ? -v.bagtaarn.a + FORT.krone + 6 : 0,
    ...v.bartizaner.map((z) => z.b - 8 - z.x + 6));
  const for_ = Math.max(FORT.plint + (v.talus ? v.talus.f : 0), v.kroneK + (v.spir.f ? 6 : 0), FORT.gesims,
    v.altan ? v.altan.l : 0, v.vagttaarn ? v.vagttaarn.ud : 0);
  v.lx0 = -bag - 100; v.lx1 = v.W - 1 + for_ + 100;          // byggegitteret (med klippens skrænter)
  const f0 = -bag, f1 = v.W - 1 + for_;                       // fodaftrykket
  // Den dobbeltsidede borg: den samme borg skåret i keepen (c) og spejlet —
  // eller, hvis der ikke er plads, lige foran keepen (så er der ingen keep).
  const c = trim >= 2 ? v.KB : v.KB - Math.max(70, FORT.indermur + 44);
  v.c = c;
  const retn = [];
  for (let i = 0; i < H; i++) {
    if (H === 1) retn.push(1);
    else if (H % 2 && 2 * i === H - 1) retn.push(0);
    else if (2 * i < H) retn.push(i % 2 ? -1 : 1);
    else retn.push(-retn[H - 1 - i]);
  }
  const bredde = (r) => (r === 0 ? 2 * (f1 - c + 1) : f1 - f0 + 1);
  // Havet: foran (en facade vender ind i hullet) og bagtil (to bagsider),
  // regnet fra det højeste ned til det laveste, man kan stå på hos den anden.
  const havF = Math.max(P.hav, Math.ceil(rakkevidde(v.top - v.forLav) + 24));
  const havB = Math.max(P.havB, ...v.bagPunkter.map((p) => Math.ceil(rakkevidde(p.y - v.bagLav) + 24 - (p.lx + bag))));
  // Hullernes slags: to forsider mod hinanden (ff), to bagsider (bb) eller blandet.
  const slags = [];
  for (let i = 0; i + 1 < H; i++) {
    const hv = retn[i] >= 0 && retn[i + 1] <= 0 && !(retn[i] === 0 && retn[i + 1] === 0);
    slags.push(retn[i] === -1 && retn[i + 1] === 1 ? 'bb' : hv ? 'ff' : 'fb');
  }
  const side = { yLo: v.forLav, yHi: v.top };
  const ls = stil.landskab;
  const behov = frontBehov(ls, v, side, stil.p, havF);
  // Hele wu: borgene stemples pixel for pixel, og spejlingen skal gå op.
  const gab = slags.map((s) => Math.ceil(s === 'bb' ? havB : s === 'ff' ? behov.min : havF));
  let sum = 0;
  for (let i = 0; i < H; i++) sum += bredde(retn[i]);
  let gSum = gab.reduce((a, b) => a + b, 0);
  const plads = bBredde - 2 * FORT.kant;
  const passer = sum + gSum <= plads;
  if (passer) {
    // Pladsen, der er tilbage, spreder borgene (stil.spred) op til
    // landskabets maks; resten bliver land eller hav ud mod banens ender.
    const ff = slags.filter((s) => s === 'ff').length;
    if (ff) {
      const ekstra = Math.min(behov.maks - behov.min, Math.floor((plads - sum - gSum) / ff));
      const e = Math.round(ekstra * (0.15 + 0.85 * stil.spred));
      for (let i = 0; i < gab.length; i++) if (slags[i] === 'ff') gab[i] += e;
      gSum = gab.reduce((a, b) => a + b, 0);
    }
  }
  // Passer det ikke (heller ikke med trim 4), må havet give sig (ned til 40)
  // — kun med 5-6 klinikker.
  if (!passer && trim >= 4 && gSum > 0 && ls === 'hav') {
    const f = Math.max(0, (plads - sum) / gSum);
    for (let i = 0; i < gab.length; i++) gab[i] = Math.max(40, Math.floor(gab[i] * f));
    gSum = gab.reduce((a, b) => a + b, 0);
  }
  // Venstre kant af hver borgs fodaftryk; højre halvdel spejles præcist.
  const venstre = [];
  let x = Math.floor((bBredde - sum - gSum) / 2);
  for (let i = 0; i < H; i++) { venstre.push(x); x += bredde(retn[i]) + (gab[i] || 0); }
  const forter = [];
  const formNavn = (r) => (r === 0 ? 'dobbelt' : 'enkelt');
  for (let i = 0; i < H; i++) {
    const r = retn[i];
    let off;
    if (r === 0) off = bBredde / 2 - c;                                  // lx c-½ på banens midte
    else if (2 * i + 1 < H || H === 1) off = r > 0 ? venstre[i] - f0 : venstre[i] + f1;
    else off = bBredde - 1 - forter[H - 1 - i].off;                     // spejlet af makkeren
    // lokal lx -> banens x. Pixelkolonnen lx spejles til off-lx, men et
    // PUNKT (en kundes x, en mundings x) spejles om kolonnens kant til
    // off+1-lx: kapslen tester kolonnerne x-8..x+7, og projektiler afrunder
    // nedad. Punkter i de spejlvendte borge ligger derfor én til højre, så
    // fysikken bliver præcis spejlet, og ingen side har en pixel til gode.
    // Den dobbeltsidede borgs venstre halvdel er spejlet om c (punkter:
    // 2c-lx).
    const tilX = r >= 0 ? (lx) => lx + off : (lx) => off - lx;
    const tilP = r >= 0 ? tilX : (lx) => off + 1 - lx;
    const sider = r === 0 ? [1, -1] : [r];
    // Et lokalt punkt på side sd (1 = som den enkeltsidede borg) -> banen.
    const punkt = (sd, lx) => (r === 0 ? (sd > 0 ? lx : 2 * c - lx) + off : tilP(lx));
    const spand = (sd, a, b) => { const p = punkt(sd, a), q = punkt(sd, b); return [Math.min(p, q), Math.max(p, q)]; };
    const sideInfo = sider.map((sd) => ({
      retning: r === 0 ? sd : r,
      facade: r === 0 ? (sd > 0 ? v.W - 1 + off : 2 * c - v.W + off) : tilX(v.W - 1),
      rumX: ind.rum.map(([a, b]) => spand(sd, a, b)),
      trapper: ind.trapper.map((t) => ({ ...t, top: punkt(sd, t.top), fod: punkt(sd, t.fod), hul: spand(sd, t.hul[0], t.hul[1]) })),
      ramper: Object.fromEntries(Object.entries(ind.ramper)
        .filter(([k]) => !(r === 0 && k === 'keep'))
        .map(([k, t]) => [k, { ...t, top: punkt(sd, t.top), fod: punkt(sd, t.fod), hul: spand(sd, t.hul[0], t.hul[1]) }])),
    }));
    // Kunderne: én pr. etage nedefra; to på en etage står side om side —
    // i den dobbeltsidede borg én i hver side, ellers skifter de side pr. etage.
    const pladser = [];
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < ind.antal[k]; j++) {
        let si = 0, lx = ind.pladser[k][j];
        if (r === 0) { si = ind.antal[k] === 2 ? j : k % 2 === 0 ? 1 : 0; lx = ind.pladser[k][0]; }
        const S = sideInfo[si];
        pladser.push({ x: punkt(r === 0 ? S.retning : 1, lx), y: v.y[k], etage: k, retning: S.retning, rumX: S.rumX[k] });
      }
    }
    const etager = [];
    for (let k = 0; k < n; k++) {
      const pl = pladser.filter((p) => p.etage === k);
      etager.push({ y: v.y[k], pladser: pl, rumX: pl[0] ? pl[0].rumX : sideInfo[0].rumX[k] });
    }
    // Udstyrspladser (mindst 120 wu fra kunderne); i den dobbeltsidede borg
    // i begge sider, men ikke på den massive keep.
    const kand = [];
    for (const S of sideInfo) {
      const sd = r === 0 ? S.retning : 1;
      for (const q of ind.kand) if (!(r === 0 && q.lx < c + 20)) kand.push({ x: punkt(sd, q.lx), y: q.y });
    }
    const udstyr = kand.filter((p) => pladser.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 120))
      .map((p) => ({ ...p, langt: pladser.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 170) }));
    const kasser = [], kasseSpand = [];
    for (const S of sideInfo) {
      const sd = r === 0 ? S.retning : 1;
      for (const lx of ind.kasser) if (!(r === 0 && lx < c + 20)) kasser.push(punkt(sd, lx));
      // Stykkerne som kasserne: den dobbeltsidede borgs massive keep er ikke med.
      for (const [a, b] of ind.kasseSpand) {
        const a2 = r === 0 && a < c + 20 ? a + Math.ceil((c + 20 - a) / 20) * 20 : a;
        if (a2 <= b) kasseSpand.push(spand(sd, a2, b));
      }
    }
    const lxA = r === 0 ? 2 * c - v.W : 0, lxB = v.W - 1;
    const fodL = r === 0 ? [2 * c - 1 - f1, f1] : [f0, f1];
    const xs = [tilX(lxA), tilX(lxB)], fs = [tilX(fodL[0]), tilX(fodL[1])];
    forter.push({
      off, retning: r, form: formNavn(r),
      facade: sideInfo[0].facade,
      cx: Math.round((xs[0] + xs[1]) / 2),
      x0: Math.min(...xs), x1: Math.max(...xs),          // hovedbygningen
      fod: [Math.min(...fs), Math.max(...fs)],           // med anneks, altaner, tårne og fod
      rumX: sideInfo[0].rumX[0],
      etager, pladser, udstyr, kasser, kasseSpand, sider: sideInfo,
      trapper: sideInfo[0].trapper, ramper: sideInfo[0].ramper,
    });
  }
  // Bagvæggen på banen.
  const rum = [];
  for (const f of forter) {
    const stykker = f.retning === 0
      ? [...ind.bag.filter((q) => q.b >= c).map((q) => ({ ...q, a: Math.max(q.a, c) })),
         ...ind.bag.filter((q) => q.b >= c).map((q) => ({ a: 2 * c - 1 - q.b, b: 2 * c - 1 - Math.max(q.a, c), y0: q.y0, y1: q.y1 }))]
      : ind.bag;
    const tilX = f.retning >= 0 ? (lx) => lx + f.off : (lx) => f.off - lx;
    for (const q of stykker) {
      const a = tilX(q.a), b = tilX(q.b);
      rum.push({ x0: Math.min(a, b), x1: Math.max(a, b), y0: Math.round(q.y0), y1: Math.round(q.y1) });
    }
  }
  // Hullerne mellem borgene på banen (åbent mellem fodaftrykkene).
  const huller = slags.map((s, i) => ({ i, slags: s, xa: forter[i].fod[1], xb: forter[i + 1].fod[0] }));
  return { layout: L, etager: n, antal: ind.antal, prEtage: Math.max(...ind.antal),
           base: v.y[0], etageHoejde: v.E, tag: v.y[n], top: v.top, bredde: v.W,
           hav: Math.min(...(gab.length ? gab : [0])), havF: gab.length ? havF : 0, havB, gab, retninger: retn,
           siluet: v.siluet, loeft: stil.loeft,
           landskab: { navn: ls, behov, huller, tema: stil.p[17] < 0.5 ? 0 : 1 },
           variant: v, forter, rum, passer, trim };
}

function genererFort(froe, layout, bBredde, bHoejde) {
  let plan = fortPlan(layout, bBredde, froe);
  let t = bygFortBane(plan, froe, bBredde, bHoejde);
  // Sidste sikring: kan man hoppe fra én borg over til en anden (eller ud på
  // en ø midt i havet) på den FÆRDIGE maske, bygges banen om med åbent hav.
  t.fort.hopSikker = fortHopSikker(t);
  if (!t.fort.hopSikker && plan.landskab.navn !== 'hav') {
    const reserve = fortPlan(layout, bBredde, froe, 'hav');
    const t2 = bygFortBane(reserve, froe, bBredde, bHoejde);
    t2.fort.reserve = plan.landskab.navn;
    t2.fort.hopSikker = fortHopSikker(t2);
    t = t2;
  }
  return t;
}

function bygFortBane(plan, froe, bBredde, bHoejde) {
  const v = plan.variant;
  const t = new Terraen(bBredde, bHoejde);
  const { maske } = t;

  // --- 1. landskabet: havbund, land, klipper, ø, bakke eller bro — bygget i
  // venstre halvdel og spejlet om midten ligesom borgene
  const neutral = bygLandskab(t, plan, froe);

  // --- 2. borgen bygges én gang lokalt og stemples (spejlet) ind for hver
  // klinik; den dobbeltsidede er den samme borg med massiv keep, spejlet om c
  const gitre = {};
  for (const f of plan.forter) {
    const lok = gitre[f.form] ||= bygBorg(v, froe, bHoejde, f.form === 'dobbelt');
    for (let ly = 0; ly < lok.h; ly++) {
      const raekke = (bHoejde - 1 - ly) * bBredde, kilde = ly * lok.w;
      for (let i = 0; i < lok.w; i++) {
        let lx = lok.x0 + i;
        if (f.retning === 0) {
          if (lx < v.c) continue;
          const k = lok.d[kilde + i];
          if (!k) continue;
          for (const x of [lx + f.off, 2 * v.c - 1 - lx + f.off]) if (x >= 0 && x < bBredde) maske[raekke + x] = LOKAL_MAT[k];
          continue;
        }
        const k = lok.d[kilde + i];
        if (!k) continue;
        const x = f.retning > 0 ? lx + f.off : f.off - lx;
        if (x >= 0 && x < bBredde) maske[raekke + x] = LOKAL_MAT[k];
      }
    }
  }

  // --- 3. havbund: grundfjeld helt i bunden
  for (let y = 0; y < FJELD_BUND; y++) {
    const raekke = (bHoejde - 1 - y) * bBredde;
    for (let x = 0; x < bBredde; x++) maske[raekke + x] = FJELD;
  }

  // --- 4. kun udstyrspladser, man kan stå på (fast under, fri kapsel over)
  // — og kun dem, der holder i alle borge af samme form, så listerne stadig
  // står i samme (spejlede) rækkefølge.
  // Kolonnerne er valgt, så prøven er den samme for et punkt og dets
  // spejling (punkter spejles x -> W - x, pixels x -> W-1-x): d og -1-d.
  const kanStaa = (p) => {
    if (!t.fast(p.x, p.y) && !t.fast(p.x - 1, p.y)) return false;
    for (let yy = p.y + 1; yy <= p.y + 46; yy += 3) for (let dx = -8; dx <= 7; dx += 3) if (t.fast(p.x + dx, yy)) return false;
    return true;
  };
  for (const form of ['enkelt', 'dobbelt']) {
    const fs = plan.forter.filter((f) => f.form === form);
    if (!fs.length) continue;
    const god = fs[0].udstyr.map((_, j) => fs.every((f) => kanStaa(f.udstyr[j])));
    for (const f of fs) f.udstyr = f.udstyr.filter((_, j) => god[j]);
  }

  const { variant, ...fort } = plan;
  for (const f of fort.forter) delete f.off;
  fort.neutral = neutral;
  t.fort = fort;
  t.arketype = `${plan.siluet}/${plan.landskab.navn}`;
  t.snavs = { x0: 0, y0: 0, x1: bBredde - 1, y1: bHoejde - 1 };
  t.vandNiveau = VAND_NIVEAU;
  const TEMA = { hav: 'klippe', bro: 'klippe', skaer: 'klippe', oe: ['eng', 'strand'], bakke: ['klippe', 'eng'],
                 kloeft: ['eng', 'skov'], soe: ['eng', 'strand'] }[plan.landskab.navn];
  t.pyntTema = Array.isArray(TEMA) ? TEMA[plan.landskab.tema] : TEMA;
  t.pynt = placerPynt(t, t.pyntTema, froe);
  return t;
}

/** Kan en kunde hoppe fra én borgs område over i en andens — eller ud på
 *  landskabet midt imellem (støtter, ø, bakke)? Prøvet på den færdige
 *  maske: alle standpladser over vandet, og for hvert par i hver sit område
 *  hoppets rækkevidde med det fald, der er imellem (baneregler.findKrydsning).
 *  En borgs område går til midten af hullet til naboen. */
export function fortHopSikker(t) {
  const f = t.fort;
  if (!f || f.forter.length < 1) return true;
  const midter = f.landskab.huller.map((g) => (g.xa + g.xb) / 2);
  const neutral = f.neutral || [];
  const omraade = (x) => {
    for (const nb of neutral) if (x >= nb.x0 && x <= nb.x1) return 100 + nb.hul;
    let i = 0;
    while (i < midter.length && x > midter[i]) i++;
    return i;
  };
  const pladser = standpladser(t, 4, 32, VAND_NIVEAU + 1);
  return findKrydsning(pladser, omraade, 8) === null;
}

/* ------------------------------------------------------------------ landskabet
 *
 * Bygget i banens venstre halvdel og spejlet om midten, så begge sider får
 * præcis det samme. Et hul mellem to forsider (ff) er desuden symmetrisk om
 * sin egen midte (x -> xa + xb - x), så også den dobbeltsidede midterborg
 * står ens til begge sider. Returnerer de neutrale områder (x-spand) til
 * fortHopSikker.
 */
function bygLandskab(t, plan, froe) {
  const { w, h, maske } = t;
  const W2 = w >> 1, V = VAND_NIVEAU;
  const LS = plan.landskab, ls = LS.navn, B = LS.behov;
  const v = plan.variant;
  const hl = v.y[0] - 40;
  const kol = (x, y0, y1, mat) => {
    if (x < 0 || x >= W2) return;
    y0 = Math.max(0, Math.round(y0)); y1 = Math.min(h - 1, Math.round(y1));
    for (let y = y0; y <= y1; y++) maske[(h - 1 - y) * w + x] = mat;
  };
  const fr = (salt) => (froe ^ salt) >>> 0;
  // I et ff-hul: kolonnen x og dens spejling i hullet (højre halvdel af banen
  // klarer den store spejling).
  const toKol = (g, x, y0, y1, mat) => {
    kol(x, y0, y1, mat);
    const x2 = g.xa + g.xb - x;
    if (x2 !== x && x2 < W2) kol(x2, y0, y1, mat);
  };

  // --- havbunden: lav og jævn
  const bFroe = fr(0x9e3779b9);
  const bund = new Float32Array(W2);
  for (let x = 0; x < W2; x++) {
    bund[x] = Math.round(FORT.havbund + (fbm1(x * 0.004, bFroe, 3, 0.5) - 0.5) * 70);
    kol(x, FJELD_BUND, bund[x], JORD);
  }
  const neutral = [];
  const fs = plan.forter;
  const huller = LS.huller.filter((g) => g.xa < W2);

  // --- borgene på land (kløft, sø): landet under og omkring borgene
  if (PAA_LAND.has(ls)) {
    const top = new Float32Array(W2).fill(-1);
    const hFroe = fr(0x51ed2701);
    const r = traekker(froe, 0x3b1f5e2d);
    const bakker = 90 + r() * 230, kystJ = r();
    const saetTop = (x, y) => { if (x >= 0 && x < W2 && y > top[x]) top[x] = y; };
    // under hver borg (og den dobbeltsidedes venstre halvdel)
    for (const f of fs) for (let x = f.fod[0]; x <= Math.min(f.fod[1], W2 - 1); x++) saetTop(x, hl);
    // baglandet: fra kysten til den første borgs bagside, med bakker
    const f0 = fs[0];
    const kyst = Math.round(FORT.kant + 30 + kystJ * Math.max(0, f0.fod[0] - FORT.kant - 380));
    const strand = ls === 'soe' ? 140 + Math.round(r() * 100) : 0;
    for (let x = Math.max(0, kyst - strand); x < f0.fod[0]; x++) {
      const ind = glat((x - kyst) / 150) * glat((f0.fod[0] - 60 - x) / 160);
      let y = hl + bakker * ind * Math.max(0, fbm1(x * 0.0028, hFroe, 3, 0.5) - 0.25) * 2.4;
      y += (Math.round(y / 60) * 60 - y) * 0.4;                              // terrasser
      if (x < kyst) y = hl - (hl - (V - 70)) * glat((kyst - x) / strand);     // stranden ned i havet
      saetTop(x, Math.round(y));
    }
    // ff-hullerne: forplads og kløftens kant, eller forplads og strand
    for (const g of huller) {
      if (g.slags !== 'ff') continue;
      const m = (g.xa + g.xb) / 2;
      for (let x = g.xa + 1; x <= Math.floor(m); x++) {
        const u = x - g.xa;
        let y = -1;
        if (ls === 'kloeft') { if (u <= B.F) y = hl; }
        else if (u <= B.F) y = hl;                                          // forpladsen
        else if (u <= B.F + B.S) y = hl - (hl - (V + 2)) * glat((u - B.F) / B.S);   // stranden
        else y = V + 2 - (B.dyb + 2) * glat((u - B.F - B.S) / 90);                  // søens bund
        if (y >= 0) { saetTop(x, Math.round(y)); const x2 = g.xa + g.xb - x; if (x2 < W2) saetTop(x2, Math.round(y)); }
      }
    }
    for (let x = 0; x < W2; x++) if (top[x] >= 0) kol(x, FJELD_BUND, top[x], JORD);
    // Kløftens kanter: et udhæng ud over kløften, og væggen skråner ind under
    // det hele vejen ned (ingen afsatser, man kan stå på). Det samme ved kysten.
    const udhaeng = (kant, retn, ov, rec) => {
      // retn = +1: landet ligger til venstre, udhænget peger mod højre.
      // Støjen følger afstanden til kanten (i), så begge sider af et hul er ens.
      for (let i = -rec; i <= ov; i++) {
        const x = kant + retn * i;
        if (x < 0 || x >= W2) continue;
        const u = (i + rec) / (rec + ov);                    // 0 inde i landet, 1 ved spidsen
        const snit = (V - 60) + (hl - 26 - (V - 60)) * glat(u) + (fbm1((i + 900) * 0.05, hFroe, 2) - 0.5) * 16 * glat(u * 2);
        // Kolonnen: luft fra væggens fod (under vandet) op til snittet, jord
        // fra snittet til toppen.
        const fod = (V - 60) - (V - 60 - bund[x] - 1) * glat((u - 0.25) / 0.75);
        for (let y = Math.max(bund[x] + 1, Math.round(fod)); y < snit; y++) maske[(h - 1 - y) * w + x] = LUFT;
        if (i > 0) for (let y = Math.round(snit); y <= hl; y++) maske[(h - 1 - y) * w + x] = JORD;
      }
    };
    if (ls === 'kloeft') {
      for (const g of huller) if (g.slags === 'ff') {
        const kant = g.xa + B.F;
        udhaeng(kant, 1, B.ov, B.rec);
        // spejlingen i hullet (tre borge: hullet ligger helt i venstre halvdel)
        const kant2 = g.xa + g.xb - kant;
        if (kant2 + B.rec < W2) udhaeng(kant2, -1, B.ov, B.rec);
      }
      udhaeng(kyst, -1, 20 + Math.round(r() * 20), 50 + Math.round(r() * 60));
    }
  }

  // --- landskabet i ff-hullerne på havet
  for (const g of huller) {
    if (g.slags !== 'ff') continue;
    const m = (g.xa + g.xb) / 2;
    const xa = g.xa + 1, xm = Math.floor(m);
    if (ls === 'skaer') {
      const sFroe = fr(0x2c1b3c6d);
      let ext = 0;
      for (const s of B.stoetter) {
        const rB = s.r * 0.66, rT = s.r + 10, yb = V - 60;
        for (let x = xa; x <= xm; x++) {
          const a = Math.abs((m - x) - s.a);
          if (a > rT) continue;
          const topY = s.h + (fbm1(a * 0.05, sFroe, 2) - 0.5) * 16 - (a > s.r ? (a - s.r) * 0.8 : 0);
          // Bredden vokser opad (udhæng): kolonnen er fast fra dér, hvor
          // støtten er bred nok, og op til toppen.
          let y0;
          if (a <= rB) y0 = bund[x];
          else {
            let lo = yb, hi = s.h;
            for (let it = 0; it < 18; it++) {
              const mid = (lo + hi) / 2, bred = rB + (rT - rB) * glat((mid - yb) / (s.h - yb));
              if (bred >= a) hi = mid; else lo = mid;
            }
            y0 = hi;
          }
          if (y0 < topY) toKol(g, x, y0, topY, JORD);
        }
        ext = Math.max(ext, s.a + rT + 6);
      }
      neutral.push({ x0: Math.floor(m - ext), x1: Math.ceil(m + ext), hul: g.i });
    } else if (ls === 'oe') {
      // Øen: strand hele vejen rundt, en flad top, to bakker eller én, og
      // måske en ruin midt på.
      const oFroe = fr(0x6b43a9b5);
      const { wi, ht, ruin, form } = B;
      for (let x = xa; x <= xm; x++) {
        const a = m - x;
        if (a > wi + 260) continue;
        let topY;
        if (a <= wi) {
          const u = a / wi;
          topY = V + (ht - V) * bjergForm(form, u) + (fbm1(a * 0.011, oFroe, 3) - 0.5) * 50 * (1 - u * u);
          topY = Math.max(topY, V + 2 + (1 - u) * 8);
        } else topY = V - (a - wi) * 0.7;
        if (topY > bund[x]) toKol(g, x, bund[x], topY, JORD);
        // Ruinen midt på øen: et brudt tårn af murværk med et vindue. Foden
        // står i jorden, også i sadlen mellem to bakker (dér er jorden
        // lavere end ht - 60): ingen luft under den.
        if (ruin && a <= ruin.rw) {
          const brud = a > ruin.rw * 0.35 ? Math.round((fbm1(a * 0.09, oFroe ^ 0x5, 1) - 0.2) * 50) : 0;
          toKol(g, x, Math.min(ht - 60, topY - 6), ht + ruin.rh - Math.max(0, brud), MUR);
          if (a <= 8 && ruin.rh >= 90) toKol(g, x, ht + 34, ht + 66, LUFT);
        }
      }
      neutral.push({ x0: Math.floor(m - wi - 40), x1: Math.ceil(m + wi + 40), hul: g.i });
    } else if (ls === 'bakke') {
      // Bjerget: en kegle, et plateau eller to toppe, terrasseret, og måske
      // en havbue gennem foden. Skråningerne ender i vandet.
      const kFroe = fr(0x1e35a7bd);
      const { wb, th, form, terrasser, bue } = B;
      for (let x = xa; x <= xm; x++) {
        const a = m - x;
        if (a > wb + 200) continue;
        let topY;
        if (a <= wb) {
          const u = a / wb;
          topY = V + (th - V) * bjergForm(form, u) + (fbm1(a * 0.012, kFroe, 3) - 0.5) * 70 * (1 - u * u);
          if (terrasser) topY += (Math.round(topY / 64) * 64 - topY) * 0.55;
          topY = Math.max(topY, V + 2 + (1 - u) * 8);
        } else topY = V - (a - wb) * 0.9;
        if (topY > bund[x]) toKol(g, x, bund[x], topY, JORD);
        if (bue && a < bue.aw) {
          const u = a / bue.aw;
          toKol(g, x, V - 70, V + bue.ah * Math.sqrt(Math.max(0, 1 - u * u)), LUFT);
        }
      }
      neutral.push({ x0: Math.floor(m - wb - 40), x1: Math.ceil(m + wb + 40), hul: g.i });
    } else if (ls === 'bro') {
      // Den brudte stenbro: dæk i plintens højde fra facaden ud i hullet,
      // piller ned til havbunden og rundbuer imellem; enden er brækket af,
      // og stumperne ligger under vandet.
      const venstreFort = fs[g.i];
      const S0 = venstreFort.sider.find((sd) => sd.retning === 1) || venstreFort.sider[0];
      const x0 = S0.facade + 1;
      const G = g.xb - g.xa - 1;
      const Lb = Math.max(0, Math.floor(Math.min((G - B.brud) / 2, G - B.kl - 4)));
      const spids = g.xa + Lb;
      const hb = B.hb, dt = 26;
      const brFroe = fr(0x4f1bbcdc);
      const start = S0.facade + FORT.plint + 1;          // første bue springer fra plinten
      const sp = B.spand, ph = B.pille / 2;
      const pille = (j) => j >= 1 && start + j * sp + ph <= spids - 24;   // pille j står ved spand j's venstre ende
      let jL = 0;
      while (pille(jL + 1)) jL++;
      for (let x = x0; x <= Math.min(spids, xm); x++) {
        // dækket, med en brækket ende (støjen følger afstanden til spidsen)
        const tilSpids = spids - x;
        const brud = tilSpids < 34 ? Math.max(0, Math.round((fbm1(tilSpids * 0.21, brFroe, 1) - 0.1) * 22)) : 0;
        const underDaek = tilSpids < 34 ? hb - dt + 1 + Math.round((34 - tilSpids) * 0.6) : hb - dt + 1;
        if (hb - brud >= underDaek) toKol(g, x, underDaek, hb - brud, MUR);
        if (x < start) continue;
        const jn = Math.round((x - start) / sp);
        if (pille(jn) && Math.abs(x - (start + jn * sp)) <= ph) { toKol(g, x, bund[x], hb - dt, MUR); continue; }
        // spandrillen over buen; efter den sidste pille er buen brækket midt over
        const j = Math.floor((x - start) / sp), c = start + j * sp + sp / 2, halv = sp / 2 - ph;
        if (j > jL || (j === jL && x > c)) continue;
        const kron = hb - dt - 8, fod = kron - halv * 0.9;
        const uu = Math.min(1, Math.abs(x - c) / Math.max(1, halv));
        toKol(g, x, Math.round(fod + (kron - fod) * Math.sqrt(Math.max(0, 1 - uu * uu))), hb - dt, MUR);
      }
      // stumper under vandet
      const rr = traekker(froe, 0x61c88647);
      for (let k = 0; k < 3; k++) {
        const cx = spids + 20 + Math.round(rr() * Math.max(10, (xm - spids - 30))), bw = 14 + Math.round(rr() * 16), bh = 18 + Math.round(rr() * 26);
        for (let x = cx - bw; x <= cx + bw && x <= xm; x++) toKol(g, x, bund[x], Math.min(V - 30, bund[x] + bh), MUR);
      }
    }
  }

  // --- spejl venstre halvdel over i højre
  for (let r = 0; r < h; r++) {
    const o = r * w;
    for (let x = W2; x < w; x++) maske[o + x] = maske[o + w - 1 - x];
  }
  // De neutrale områder i højre halvdel (tre og flere borge).
  const alle = neutral.slice();
  for (const nb of neutral) if (nb.x1 < W2 - 1) alle.push({ x0: w - 1 - nb.x1, x1: w - 1 - nb.x0, hul: LS.huller.length - 1 - nb.hul });
  return alle;
}

/** Højden (0-1) af et bjerg eller en ø i afstanden u (0 = midten, 1 = vandkanten). */
function bjergForm(form, u) {
  switch (form) {
    case 'kegle': return Math.pow(Math.max(0, 1 - Math.pow(u, 1.5)), 1.5);
    case 'plateau': return 1 - glat((u - 0.42) / 0.58);
    case 'to': return (1 - glat((u - 0.56) / 0.44)) * (0.7 + 0.3 * glat(u / 0.46));
    default: return Math.pow(Math.cos(Math.min(1, u) * Math.PI / 2), 1.3);
  }
}

// Lokale koder i borgens byggegitter: 0 = rør ikke banen.
const L_LUFT = 1, L_MUR = 2, L_JORD = 3;
const LOKAL_MAT = [LUFT, LUFT, MUR, JORD];

/** Byg én borg i et lokalt gitter (lx fra bagsiden, y som banen). Med
 *  massivKeep er keepen uden dør og rampe (den dobbeltsidede borgs midte). */
function bygBorg(v, froe, bHoejde, massivKeep = false) {
  const { n, y, W, FT0, KB, A, Ls, Wk, ki } = v;
  const M = FORT.mur, MI = FORT.indermur, D = FORT.daek, MF = FORT.facade, K = FORT.krone, T = v.tinde.b, TD = v.tinde.h;
  const x0 = v.lx0, x1 = v.lx1;
  const w = x1 - x0 + 1, h = Math.min(bHoejde, v.top + 20);
  const d = new Uint8Array(w * h);
  const rekt = (a, b, ya, yb, k) => {
    a = Math.max(x0, Math.round(a)); b = Math.min(x1, Math.round(b));
    ya = Math.max(0, Math.round(ya)); yb = Math.min(h - 1, Math.round(yb));
    for (let yy = ya; yy <= yb; yy++) { const r = yy * w - x0; for (let x = a; x <= b; x++) d[r + x] = k; }
  };
  const soejle = (x, ya, yb, k) => rekt(x, x, ya, yb, k);
  const hent = (x, yy) => (x < x0 || x > x1 || yy < 0 || yy >= h) ? 0 : d[yy * w - x0 + x];
  // Bueåbning: rektangel [a,b] x [ya,ys] med en halv ellipse (pil) ovenpå.
  const bue = (a, b, ya, ys, pil, k = L_LUFT) => {
    const c = (a + b) / 2, hb = (b - a) / 2 + 0.5;
    for (let x = Math.round(a); x <= Math.round(b); x++) {
      const u = (x - c) / hb;
      soejle(x, ya, ys + pil * Math.sqrt(Math.max(0, 1 - u * u)), k);
    }
  };
  // Rundbue med toppen i yTop: halvcirkel, fladere, hvis der ikke er plads.
  const rundbue = (a, b, ya, yTop, k = L_LUFT) => {
    const pil = Math.min((b - a + 1) / 2, Math.max(0, yTop - ya - 16));
    bue(a, b, ya, yTop - pil, pil, k);
  };
  // Frihøjde over en rampe: luft fra overfladen og FORT.hoved op, også i
  // kapslens bredde til begge sider — det er dét, der skærer tunnelen og
  // hullet i dækket over den.
  const frihoejde = (a, b, f) => {
    for (let x = a; x <= b; x++) {
      const topY = Math.max(f(x - 10), f(x + 10), f(x)) + FORT.hoved;
      soejle(x, Math.floor(f(x)) + 1, topY, L_LUFT);
    }
  };
  // Konsol under et udhæng: spids ved udhængets yderkant (retn = den side,
  // udhænget peger mod), l wu dyb ind mod væggen og lige så høj dér.
  const konsol = (spids, retn, l, yU) => {
    for (let i = 0; i < l; i++) soejle(spids - retn * i, yU - i, yU, L_MUR);
  };
  // Et spidst spir fra yTop: let indadbuede sider og en spids på toppen.
  const spirTop = (a, b, yTop, hs) => {
    const c = (a + b) / 2, hw = (b - a) / 2 + 0.5;
    for (let x = Math.round(a); x <= Math.round(b); x++) {
      const u = Math.abs(x - c) / hw;
      soejle(x, yTop + 1, yTop + hs * Math.pow(Math.max(0, 1 - u), 1.25), L_MUR);
    }
    rekt(Math.round(c) - 2, Math.round(c) + 1, yTop + hs - 4, yTop + hs + 14, L_MUR);
  };
  const vfroe = (froe ^ 0x6a09e667) >>> 0;
  const yR = y[n];
  const an = v.anneks;
  const bagSokkel = Math.min(an ? -an.b - an.trin - (an.et ? an.et.b - 16 : 0) : -12,
    v.bagtaarn ? v.bagtaarn.a : 0);                                            // soklens bageste kant
  const bagKant = bagSokkel - (v.talus ? v.talus.b : 0);
  const forKant = W + FORT.plint + (v.talus ? v.talus.f : 0);

  // --- klippen under borgen (under vandet), med ujævne skrænter. Står borgen
  // højt, er klippen lodret over vandet ved fodaftrykket, så ingen kan stå
  // på den uden for borgen. På land bærer landskabet borgen.
  if (!v.paaLand) {
    for (let x = x0; x <= x1; x++) {
      const ude = x < bagKant ? bagKant - x : x >= forKant ? x - (forKant - 1) : 0;
      const t = Math.min(1, ude / 90);
      const hoved = ude > 0 ? Math.min(v.grund, VAND_NIVEAU - 24) : v.grund;
      const topY = hoved - 150 * t * t * (3 - 2 * t) + (fbm1((x - x0) * 0.02, vfroe, 2, 0.5) - 0.5) * 30 * (0.3 + t) * (ude > 0 ? 1 : 0.3);
      if (topY > FORT.havbund - 40) soejle(x, FJELD_BUND, topY, L_JORD);
    }
  }

  // --- sokkel og hovedbygning (massiv), trappet facade og bagside, og de to
  // tårne over taget
  rekt(-12, W - 1, v.sokkel, y[0] - D, L_MUR);
  rekt(W, W - 1 + FORT.plint, v.sokkel, y[0] - 30, L_MUR);         // plinten ved vandlinjen
  rekt(0, W - 1, y[0] - D + 1, yR, L_MUR);
  for (let k = 1; k < n; k++) if (Wk[k] < W) rekt(Wk[k], W - 1, y[k] + 1, y[k + 1], L_LUFT);
  if (ki && v.bagTrin < n) rekt(0, ki - 1, y[v.bagTrin] + 1, yR, L_LUFT);
  rekt(ki, KB - 1, yR + 1, v.yK, L_MUR);
  rekt(FT0, Wk[n] - 1, yR + 1, v.yF, L_MUR);
  // Bastionens skrå fod for og bag (talus), fra plinten ned til soklen.
  if (v.talus) {
    const hT = y[0] - 30 - v.sokkel;
    for (let i = 0; i < v.talus.f; i++) soejle(W + FORT.plint + i, v.sokkel, y[0] - 30 - (i + 1) * hT / v.talus.f, L_MUR);
    for (let i = 0; i < v.talus.b; i++) soejle(bagSokkel - 1 - i, v.sokkel, y[0] - 30 - (i + 1) * hT / v.talus.b, L_MUR);
  }

  // --- hallerne
  for (let k = 0; k < n; k++) {
    const hal = v.haller[k];
    const loft = y[k + 1] - D;
    let vTop;
    if (hal.stil === 'kamre') {
      rekt(hal.a, hal.b, y[k] + 1, y[k] + hal.lav, L_LUFT);
      for (const [a, b] of hal.kamre) if (hal.lavTil == null || a > hal.lavTil) rundbue(a, b, y[k] + 1, loft);
      vTop = y[k] + hal.lav;
    } else {
      const sp = y[k] + hal.vl;
      rekt(hal.a, hal.b, y[k] + 1, sp, L_LUFT);
      for (const [a, b] of hal.fag) if (hal.lavTil == null || a > hal.lavTil) bue(a, b, sp, sp, loft - sp);
      vTop = sp;
    }
    for (const [a, b] of hal.vaegge) {
      rekt(a, b, y[k] + 1, vTop, L_MUR);
      rundbue(a, b, y[k] + 1, y[k] + 76);                          // døren
    }
  }
  // --- trappeløbene: tunneler op mod bagsiden (sten under og over)
  for (let k = 0; k < n; k++) frihoejde(A[k] - 2, A[k] + Ls + 2, (x) => loebY(v, k, x));

  // --- fortårnet: kundernes rum under en rund bue, brystning og skydeskår i
  // facaden, der vider sig ud udad, og en dør til hallen; terrasse, hvor
  // facaden trappes (dér står brystningen ude på terrassens kant). Over
  // taget (k = n) er det udkigskammeret med dør fra taget.
  const rA = FT0 + MI;
  for (let k = 0; k <= n; k++) {
    const loft = k < n ? y[k + 1] - D : yR + v.kammerH, sp = y[k] + Math.min(84, loft - y[k] - 24), fa = Wk[k];
    const vi = Math.min(v.vindue[0], loft - y[k] - 12), vo = Math.min(v.vindue[1], loft - y[k] + 4);
    const terrasse = k > 0 && Wk[k] < Wk[k - 1];
    bue(rA, fa - MF - 1, y[k] + 1, sp, loft - sp);
    rekt(fa - MF, terrasse ? fa - 1 : fa - FORT.brystB - 1, y[k] + 1, y[k] + FORT.bryst, L_LUFT);
    for (let x = fa - MF; x < fa; x++) {
      const u = (x - (fa - MF)) / (MF - 1);
      soejle(x, y[k] + FORT.bryst + 1, y[k] + vi + u * (vo - vi), L_LUFT);
    }
    rekt(FT0, rA - 1, y[k] + 1, y[k] + FORT.doer, L_LUFT);
    if (terrasse) rekt(Wk[k - 1] - FORT.brystB, Wk[k - 1] - 1, y[k] + 1, y[k] + FORT.bryst, L_MUR);
  }

  // --- fortårnet over udkigskammeret: massivt med vinduer, man ser igennem,
  // en udkraget krone og tinder — eller et spir
  const WF = Wk[n];
  const vt = v.vagttaarn;
  const Kf = v.kroneK;
  const tStop = vt ? WF - vt.b : null;
  rekt(FT0 - Kf, WF - 1 + Kf, v.yF - D + 1, v.yF, L_MUR);             // kronen
  for (const vv of v.vinduer) {
    if (vv.keep) continue;
    if (vv.rund) {
      const c = (vv.a + vv.b) / 2, cy = (vv.y0 + vv.y1) / 2, r0 = (vv.b - vv.a) / 2;
      for (let yy = -r0; yy <= r0; yy++) { const sp = Math.sqrt(r0 * r0 - yy * yy); rekt(c - sp, c + sp, cy + yy, cy + yy, L_LUFT); }
    } else rundbue(vv.a, vv.b, vv.y0, vv.y1);
  }
  if (v.spir.f) {
    konsol(FT0 - Kf, -1, Kf, v.yF - D); konsol(WF - 1 + Kf, 1, Kf, v.yF - D);
    spirTop(FT0 - Kf - 4, WF - 1 + Kf + 4, v.yF, v.spir.f);
  } else taarntop(FT0 - Kf, WF - 1 + Kf, v.yF, null, tStop, Kf);
  if (vt) {
    // Vagttårnet på det forreste hjørne: dækning for den, der står deroppe,
    // med et skydeskår mod fjenden og en konsol under udkragningen.
    const a = WF - vt.b, b = WF - 1 + vt.ud, yb = v.yF + vt.h;
    rekt(a, b, v.yF + 1, yb, L_MUR);
    rekt(WF - 1 + K + 1, b, v.yF - D + 1, v.yF, L_MUR);
    konsol(b, 1, b - (WF - 1 + K), v.yF - D);
    rekt(b - 16, b - 8, v.yF + 18, yb - 24, L_LUFT);
    tinder(a, b, yb, null);
  }

  // --- porttårnet på taget: gennemgang med døre i begge ender
  if (v.port) {
    const { a, b, h: gh } = v.port;
    rekt(a, b, yR + 1, yR + gh, L_MUR);
    bue(a + MI, b - MI, yR + 1, yR + 70, Math.max(0, gh - D - 70));
    rekt(a, a + MI - 1, yR + 1, yR + FORT.doer, L_LUFT);
    rekt(b - MI + 1, b, yR + 1, yR + FORT.doer, L_LUFT);
    rekt(a - K, b + K, yR + gh - D + 1, yR + gh, L_MUR);
    konsol(a - K, -1, K, yR + gh - D); konsol(b + K, 1, K, yR + gh - D);
    if (v.spir.port) spirTop(a - K - 4, b + K + 4, yR + gh, v.spir.port);
    else tinder(a - K, b + K, yR + gh, null);
  }

  // --- keepen over taget: dør fra taget og en rampe op mod bagsiden, eller
  // en skrå forside, man går op ad (i den dobbeltsidede borg er keepen massiv)
  const ka = v.keepUde ? KB : KB - MI - 12, kb = ka - v.Lk;
  const kY = (x) => x >= ka ? yR : x <= kb ? v.yK : yR + (ka - x) / v.Lk * v.tk;   // præcis op til toppen
  const udenKeep = massivKeep && v.c >= KB;
  const gb = v.gangbro;
  // Med gangbroen er keepens forkant åben: ingen tinder dér.
  const broHul = gb ? [KB - 70, KB + K] : null;
  if (udenKeep) {
    // intet: den dobbeltsidede borg uden keep
  } else if (!massivKeep && v.keepUde) {
    for (let x = kb; x < KB; x++) soejle(x, Math.floor(kY(x)) + 1, v.yK, L_LUFT);
    rekt(ki - K, kb - 1, v.yK - D + 1, v.yK, L_MUR);                // kronen, kun bagtil
    for (const vv of v.vinduer) if (vv.keep) rekt(vv.a, vv.b, vv.y0, vv.y1, L_LUFT);
  } else {
    rekt(ki - K, KB - 1 + (v.keepKrone ? K : 0), v.yK - D + 1, v.yK, L_MUR);   // kronen
    if (!massivKeep) {
      rekt(ka, KB - 1, yR + 1, yR + FORT.doer, L_LUFT);
      frihoejde(kb - 2, ka + 2, kY);
      for (const vv of v.vinduer) if (vv.keep) rekt(vv.a, vv.b, vv.y0, vv.y1, L_LUFT);
    } else {
      // midt i den dobbeltsidede borg: et højt vindue i keepen
      rundbue(v.c - 14, v.c + 13, yR + 30, v.yK - D - 22);
    }
  }
  const kt = udenKeep ? null : v.kronetaarn;
  const kF = v.keepKrone ? K : 0;                                   // kronens udkragning mod taget
  if (udenKeep) {
    // intet
  } else if (massivKeep) {
    // tinderne spejles om c: en tand midt over aksen
    tinder(v.c - (T >> 1), KB - 1 + kF, v.yK, broHul, TD, !gb, true);
    if (kF && !gb) konsol(KB - 1 + K, 1, K, v.yK - D);
  } else {
    const bagA = kt ? ki + kt.b : ki - K;
    if (!kt && !v.bagtaarn) konsol(ki - K, -1, K, v.yK - D);
    if (v.keepUde) tinder(bagA, kb - 1, v.yK, [kb - 20, kb + 40], TD, false, !kt && !v.bagtaarn);
    else {
      if (kF && !gb) konsol(KB - 1 + K, 1, K, v.yK - D);
      const huller = [[kb - 2, kb + v.hulT]];
      if (broHul) huller.push(broHul);
      tinder(bagA, KB - 1 + kF, v.yK, huller, TD, !gb, !kt && !v.bagtaarn);
    }
  }
  if (kt) {
    // Kronetårnet på keepens bageste hjørne, udkraget over bagsiden, med et kighul.
    const a = ki - kt.b, b = ki + kt.b - 1, yb = v.yK + kt.h;
    rekt(a, b, v.yK + 1, yb, L_MUR);
    rekt(a, ki - K - 1, v.yK - D + 1, v.yK, L_MUR);
    konsol(a, -1, ki - K - a, v.yK - D);
    bue(ki - 11, ki + 11, v.yK + 22, yb - 30 - 11, 11);
    if (v.spir.kt) { rekt(a - 4, b + 4, yb - 10, yb, L_MUR); spirTop(a - 6, b + 6, yb, v.spir.kt); }
    else tinder(a, b, yb, null);
  }
  // Bagtårnet (tvillinger): højt, op ad bagmuren, med krone og tinder eller
  // spir og vinduer, man ser igennem.
  if (v.bagtaarn && !massivKeep) {
    const bt = v.bagtaarn;
    rekt(bt.a, bt.b, v.sokkel, bt.top, L_MUR);
    rekt(bt.a - K, bt.b + K, bt.top - D + 1, bt.top, L_MUR);
    konsol(bt.a - K, -1, K, bt.top - D); konsol(bt.b + K, 1, K, bt.top - D);
    const c = Math.round((bt.a + bt.b) / 2) - 12;
    const hTaarn = bt.top - D - v.yK;
    for (let j = 0; j < bt.vinduer; j++) {
      const y0 = v.yK + 30 + Math.round(hTaarn * (j + 0.2) / (bt.vinduer + 0.4)), y1 = y0 + Math.min(70, hTaarn / (bt.vinduer + 1) - 16);
      if (y1 - y0 >= 30) rundbue(c - 12, c + 12, y0, y1);
    }
    // og en række små vinduer nedad bagmuren
    for (let yy = y[0] + 50; yy + 60 < v.yK; yy += v.E) rundbue(c - 8, c + 8, yy, yy + 44);
    if (v.spir.bt) spirTop(bt.a - K - 4, bt.b + K + 4, bt.top, v.spir.bt);
    else tinder(bt.a - K, bt.b + K, bt.top, null);
  }
  // Gangbroen: keepens top fortsætter over taget hen til fortårnet, lidt
  // tykkere i enderne (en flad bue under) og med konsoller ind mod murene.
  if (gb) {
    const c = (gb.a + gb.b) / 2, hw = (gb.b - gb.a) / 2;
    for (let x = gb.a; x <= gb.b; x++) {
      const u = (x - c) / hw;
      const under = gb.y - gb.tyk - gb.pil * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
      soejle(x, under, gb.y, L_MUR);
    }
    konsol(gb.a + 18, 1, 18, gb.y - gb.tyk - gb.pil);
    konsol(gb.b - 18, -1, 18, gb.y - gb.tyk - gb.pil);
  }
  // En terrasse med tinder bag keepen, hvis den er trukket ind.
  if (ki >= 30) {
    const yt = y[v.bagTrin];
    rekt(-K, -1, yt - 12, yt, L_MUR);
    konsol(-K, -1, K, yt - 12);
    tinder(-K, ki - 1, yt, null, TD - 6, false);
  }

  // --- buerne i den massive bagdel: nogle ser man himlen igennem, andre er
  // blændede (mørke, se fort.rum)
  for (const bu of v.buer) rundbue(bu.a, bu.b, bu.y0, bu.y1);

  // --- gesimser på facaden og bagsiden, havbuerne under den bageste del
  for (let k = 1; k <= n; k++) {
    rekt(Wk[k - 1], Wk[k - 1] - 1 + FORT.gesims, y[k] - 14, y[k], L_MUR);
    const bx = k > v.bagTrin ? ki : 0;
    if (!(an && y[k] <= y[0] + an.h + 30) && k !== v.bagTrin && !(v.bagtaarn && bx === 0)) rekt(bx - FORT.gesims, bx - 1, y[k] - 14, y[k], L_MUR);
  }
  for (const [a, b] of v.havbuer) rundbue(a, b, v.grund - 8, y[0] - D - 18);

  // --- altan med skråstiver på ét dæk
  if (v.altan) {
    const { k, l } = v.altan, yy = y[k], fa2 = Wk[k - 1];
    rekt(fa2, fa2 - 1 + l, yy - D + 1, yy, L_MUR);
    rekt(fa2 - 1 + l - 15, fa2 - 1 + l, yy + 1, yy + 26, L_MUR);            // lav brystning ude for enden
    konsol(fa2 - 1 + Math.round(l * 0.75), 1, Math.round(l * 0.75), yy - D);
  }

  // --- anneks og altan på bagsiden: en trappet siluet mod det åbne hav — på
  // ringmuren et langt, lavt anneks med en arkade og et endetårn yderst
  if (an) {
    const yt = y[0] + an.h;
    rekt(-an.b, -1, v.sokkel, yt, L_MUR);
    rekt(-an.b - 8, -1, yt - 12, yt, L_MUR);
    konsol(-an.b - 8, -1, 8, yt - 12);
    if (an.mur) {
      // arkade i muren og havbuer under den
      if (an.h >= 100) for (const [a, b] of lavFag(-an.b + 22, -26, 44, 44, 30, false)) rundbue(a, b, y[0] + 16, yt - 34);
      if (!v.paaLand && y[0] - 40 - (v.grund - 8) >= 40) for (const [a, b] of lavFag(-an.b + 18, -18, 60, 40, 26, true)) rundbue(a, b, v.grund - 8, y[0] - 40);
    } else {
      if (an.h >= 110) rundbue(-an.b + 22, -24, y[0] + 20, yt - 30);
      if (!v.paaLand && y[0] - 40 - (v.grund - 8) >= 40) rundbue(-an.b + 16, -16, v.grund - 8, y[0] - 40);
    }
    if (v.spir.an) spirTop(-an.b - 8, -1, yt, v.spir.an);
    else tinder(-an.b - 8, -1, yt, null);
    if (an.trin) {
      const b0 = -an.b - an.trin;
      rekt(b0, -an.b - 1, v.sokkel, y[0] - 18, L_MUR);
      tinder(b0, -an.b - 1, y[0] - 18, null, 26);
    }
    if (an.et) {
      // Endetårnet yderst på ringmuren.
      const a = -an.b - an.et.b + 16, b = -an.b + 15, top = yt + an.et.h;
      rekt(a, b, v.sokkel, top, L_MUR);
      rekt(a - K, b + K, top - D + 1, top, L_MUR);
      konsol(a - K, -1, K, top - D); konsol(b + K, 1, K, top - D);
      const c = Math.round((a + b) / 2);
      for (let yy = yt + 30; yy + 50 < top - D; yy += 90) rundbue(c - 9, c + 9, yy, yy + 46);
      if (v.spir.et) spirTop(a - K - 4, b + K + 4, top, v.spir.et);
      else tinder(a - K, b + K, top, null);
    }
  }
  if (v.bagAltan) {
    const k = v.bagAltan.k, yy = y[k], l = v.bagAltan.l, bx = k > v.bagTrin ? ki : 0;
    if ((!an || yy - D > y[0] + an.h + 40) && k !== v.bagTrin && !v.bagtaarn) {
      rekt(bx - l, bx - 1, yy - D + 1, yy, L_MUR);
      rekt(bx - l, bx - l + 13, yy + 1, yy + 24, L_MUR);
      konsol(bx - Math.round(l * 0.8), -1, Math.round(l * 0.8), yy - D);
    }
  }
  // --- hængetårnene (bartizaner): små tårne på konsoller ude på bagmurens
  // hjørne, med et skydeskår og tinder eller et lille spir
  for (const z of v.bartizaner) {
    if (massivKeep) break;
    const a = z.x - z.b + 8, b = z.x + 7, top = z.y0 + z.h;
    rekt(a, b, z.y0, top, L_MUR);
    konsol(a, -1, z.b - 8, z.y0);
    rekt(a + 7, a + 11, z.y0 + 18, top - 22, L_LUFT);
    if (z.spir) spirTop(a - 4, b + 4, top, z.spir);
    else tinder(a - 2, b + 2, top, null, 22, true, true, { b: 12, s: 10 });
  }

  return { x0, w, h, d };

  /** Tårntop (kronen er lagt, og rampens hul skåret): konsoller under
   *  udkragningen og tinder; hullet og alt fra `stop` og frem lades uden
   *  tinder (dér står kronetårnet/vagttårnet). */
  function taarntop(a, b, yTop, hul, stop, kk = K) {
    for (const sg of [-1, 1]) {
      if (sg > 0 && stop != null) continue;
      konsol(sg < 0 ? a : b, sg, kk, yTop - D);
    }
    tinder(a, stop != null ? stop - 1 : b, yTop, hul, TD, stop == null);
  }

  /** Tinder langs en top fra a til b: en tand i hver ende og ellers så mange,
   *  der er plads til — aldrig over trappehullet (eller andre huller: et
   *  interval eller en liste af dem) eller ud over kanten. Kampens tinder
   *  (v.tinde) har egen bredde og skår, måske med svalehale. */
  function tinder(a, b, yTop, hul, hoejde = TD, hoejreEnde = true, venstreEnde = true, str = null) {
    const TB = str ? str.b : T, S = str ? str.s : v.tinde.s;
    const hulle = !hul ? [] : Array.isArray(hul[0]) ? hul : [hul];
    const tag = [], kand = [];
    if (venstreEnde) tag.push(a);
    if (hoejreEnde) tag.push(b - TB + 1);
    for (let j = 1; a + j * (S + TB) + TB - 1 <= b - TB - S; j++) kand.push(a + j * (S + TB));
    for (let j = 1; b - TB + 1 - j * (S + TB) >= a + TB + S; j++) kand.push(b - TB + 1 - j * (S + TB));
    for (const x of kand) {
      if (tag.some((q) => Math.abs(q - x) < TB + S)) continue;
      if (hulle.some((hh) => x + TB - 1 >= hh[0] - 24 && x <= hh[1] + 24)) continue;
      if (hent(x, yTop) !== L_MUR || hent(x + TB - 1, yTop) !== L_MUR) continue;
      tag.push(x);
    }
    const svale = !str && v.tinde.svale && hoejde >= 30;
    for (const x of tag) {
      rekt(x, x + TB - 1, yTop + 1, yTop + hoejde, L_MUR);
      if (svale) {
        // svalehale: et V-hak i toppen af hver tand
        const c = x + (TB - 1) / 2, hw = TB / 3;
        for (let xx = Math.ceil(c - hw); xx <= Math.floor(c + hw); xx++) {
          const dyb = 10 * (1 - Math.abs(xx - c) / hw);
          if (dyb >= 1) soejle(xx, yTop + hoejde - dyb + 1, yTop + hoejde, L_LUFT);
        }
      }
    }
  }
}
