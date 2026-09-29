/* Kundekrigen — tastebjælken, vejledningen på første tur og kontroloversigten.
 *
 * Feedback fra playtest: "Jeg ved ikke, hvordan jeg hopper, skyder, sigter
 * eller vælger våben." Og senere: "svært at tyde, om tutorial-beskederne
 * progressede, fordi man klikkede, eller om der var en timer."
 *
 * Tre lag, i den rækkefølge en ny spiller møder dem:
 *   1. TASTEBJÆLKEN — altid synlig nederst, viser de fire handlinger man
 *      bruger hvert eneste sekund. Den fylder næsten intet og forsvinder ikke,
 *      for det er dét, man kigger efter, når man er i tvivl.
 *   2. VEJLEDNINGEN — fem gør-det-trin i spillerens første tur (gå, hop, sigt,
 *      våben, skyd) med en tæller. Et trin skifter KUN, når spilleren har gjort
 *      det, og tasten går altid igennem til spillet; intet ur får den videre.
 *      Bagefter et slutkort med "Tryk MELLEMRUM for at fortsætte" — kun når
 *      mellemrummet ikke betyder noget i spillet, så det aldrig også lader op.
 *      Esc springer over. Tururet venter imens (simulationens 'vejledning',
 *      højst VEJLEDNING_LOFT pr. spiller pr. kamp), og alle kan se det.
 *      Vises én gang pr. browser (NOEGLE) — og igen fra pausemenuen.
 *   3. OVERSIGTEN — hele tastaturet på ét skærmbillede, åbnes med ? eller F1
 *      og fra pausemenuen.
 *
 * Trinmaskinen (lavVejledning) er ren: ingen DOM, ingen lyd og ingen timere —
 * tiden kommer ind som dt fra billedopdateringen. lavHjaelp tegner den.
 * Korte beskeder undervejs ("Våbnet er brugt", "Forsyningskasse på vej!") er
 * hud.banner i main.js og deler aldrig element med vejledningens kort.
 */
'use strict';

import { esc } from './tekst.js';

/* v2: v1 kørte på et ur, og mange nåede ikke igennem — alle ser den nye én gang. */
export const NOEGLE = 'baevere.hjaelpVist.v2';

/** "✓ Sådan!" står så længe efter spillerens egen handling (0 ved reduceret bevægelse). */
export const KVITTER_S = 0.45;
/** Så længe skal ← → og ↑ ↓ holdes i alt, før gå- og sigtetrinnet er klaret. */
export const GAA_S = 0.5, SIGT_S = 0.4;

/** Trinene, i rækkefølge. kort: navnet i slutkortets "Husk også". */
export const TRIN = [
  { id: 'gaa', kort: 'gå', taster: ['←', '→'], goer: 'Gå',
    tekst: 'Det er din tur. Flyt din kunde derhen, hvor du vil stå.' },
  { id: 'hop', kort: 'hop', taster: ['Enter'], goer: 'Hop',
    tekst: 'Hop op på kanter og over huller. Backspace er en baglæns saltomortale.' },
  { id: 'sigt', kort: 'sigt', taster: ['↑', '↓'], goer: 'Sigt op og ned',
    tekst: 'Sigtekornet foran kunden viser, hvor du skyder hen. Hold Shift for at finsigte.' },
  { id: 'vaaben', kort: 'våben', taster: ['1', '…', '0'], goer: 'Vælg et våben',
    tekst: 'Tallene vælger våben på bjælken nederst. Tab — eller «Flere våben» i venstre side — åbner hele arsenalet.' },
  { id: 'skyd', kort: 'skyd', taster: ['MELLEMRUM'] },
];

/** Skydetrinnet følger våbnet i hånden (v.vaabenNu().sigte, hver frame). */
export const SKYD = {
  'vinkel+kraft': () => ({ tekst: 'Jo længere du holder, jo længere flyver skuddet. Vinden tager det med.',
                           goer: 'Hold for at lade op — slip for at skyde' }),
  vinkel: (navn) => ({ tekst: `${navn} skyder lige ud i sigteretningen.`, goer: 'Tryk for at skyde' }),
  retning: (navn) => ({ tekst: `${navn} rammer den, der står lige foran dig.`, goer: 'Tryk for at slå' }),
  markoer: () => ({ tekst: 'Første tryk viser en markør. Flyt den med piletasterne — T springer til næste fjende.',
                    goer: 'Tryk, flyt markøren, tryk igen' }),
  ingen: (navn) => ({ tekst: `${navn} bruges dér, hvor du står.`, goer: 'Tryk for at bruge den' }),
};
/** Meta-valgene (Sæt på hold, Opsig aftalen) er ikke et skud. */
const SKYD_META = (navn) => ({ tekst: `${navn} afslutter bare turen. Vælg et rigtigt våben for at prøve et skud.`,
                               taster: ['1', '…', '0'], goer: 'Vælg et våben' });

export const SLUT = {
  tekst: 'Sådan! Våbnene har få skud. Forsyningskasser daler ned i faldskærm — gå hen og saml dem op, så får du flere.',
};
export const SPRUNGET = 'Vejledningen er sprunget over · ? viser alle taster';

/* Simulationens hændelser, der klarer et trin. Alle sendes videre af
 * sim/worker.js (VIDERESEND); tilsammen dækker skyd-hændelserne alle
 * ikke-meta-våben. Et nyt våben, der ingen af dem sender, skal med her. */
const HAENDELSE_TIL_TRIN = {
  hop: 'hop', salto: 'hop', vaabenValgt: 'vaaben',
  skudAffyret: 'skyd', redskabStart: 'skyd', skjoldOp: 'skyd', teleport: 'skyd', terraenBygget: 'skyd',
};
/* Samme navn, men ikke spillerens egen handling: Omstillingen (telefonens
 * 'viderestil', sim/world.js _tagTelefon) flytter kunden med en teleport med
 * kilde 'telefon'. Telefonen kan tages når som helst — også på gå-trinnet. */
const IKKE_ET_TRIN = (navn, e) => navn === 'teleport' && e?.kilde === 'telefon';
/** Hændelserne, main.js skal melde med noter(), når de gælder min aktive kunde. */
export const VEJLEDNING_HAENDELSER = Object.keys(HAENDELSE_TIL_TRIN);

const lokaltLager = {
  hent(k) { try { return localStorage.getItem(k); } catch { return null; } },      // privat vindue
  gem(k, v) { try { localStorage.setItem(k, v); } catch { /* ignoreres */ } },
};
const foretraekkerRo = () => {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * Vejledningens trinmaskine.
 *   lager  { hent, gem } — localStorage (injiceres i test)
 *   ur     (aktiv) => {}  — tururet venter (true) eller går igen (false)
 *   besked (tekst) => {}  — et kort banner (sprunget over)
 *
 * Faserne: 'af' (intet), 'trin' (trin 1-5, vises kun i min egen tur),
 * 'slut' (der er skudt: slutkortet vises, når verden er faldet til ro).
 * opdater(ctx) giver visningen (eller null), som lavHjaelp tegner.
 */
export function lavVejledning({ lager = lokaltLager, ur = () => {}, besked = () => {}, reduceret = foretraekkerRo } = {}) {
  let fase = 'af';
  let laest = false;             // flaget er læst i denne kamp (ved den første dinTur)
  let klaret = new Set();
  let gaa = 0, sigt = 0;         // sekunder holdt i alt
  let kvitter = null;            // { id, rest }: "✓ Sådan!" på det klarede trin
  let slutVist = false;
  let vistId = null;             // trinet på skærmen lige nu (null: intet trinkort)
  let synlig = false;            // et kort er fremme (Esc gælder det)

  const naeste = () => TRIN.find((t) => !klaret.has(t.id)) || null;
  const gemVist = () => lager.gem(NOEGLE, '1');

  function start() {
    fase = 'trin';
    klaret = new Set();
    gaa = 0; sigt = 0;
    kvitter = null;
    slutVist = false;
  }

  function klar(id) {
    if (fase !== 'trin' || klaret.has(id)) return;
    klaret.add(id);
    // Kvitteringen kun for det trin, der står fremme; et trin gjort før tid
    // springes bare over, når det bliver dets tur.
    if (id === vistId) kvitter = { id, rest: reduceret() ? 0 : KVITTER_S };
    if (id === 'skyd') {
      fase = 'slut';
      slutVist = false;
      ur(false);
      gemVist();
    }
  }

  function trinVisning(t, ctx, ok) {
    let s = t, tastTrin = t.id;
    if (t.id === 'skyd') {
      const w = ctx.vaaben, navn = w?.navn || 'Våbnet';
      if (w?.kategori === 'meta') { s = SKYD_META(navn); tastTrin = 'vaaben'; }
      else s = { taster: t.taster, ...(SKYD[w?.sigte] || SKYD['vinkel+kraft'])(navn) };
    }
    return {
      kort: 'trin', id: t.id, nr: TRIN.indexOf(t) + 1, antal: TRIN.length,
      pips: TRIN.map((x) => (klaret.has(x.id) && !(ok && x.id === t.id) ? 'ok' : x.id === t.id ? 'nu' : '')),
      tekst: s.tekst, taster: s.taster, goer: s.goer, ok, tastTrin,
      uretVenter: !!ctx.uretVenter,
    };
  }

  function slutVisning(ctx) {
    return {
      kort: 'slut', nr: klaret.size, antal: TRIN.length,
      pips: TRIN.map((x) => (klaret.has(x.id) ? 'ok' : '')),
      tekst: SLUT.tekst,
      mangler: TRIN.filter((t) => t.id !== 'skyd' && !klaret.has(t.id)),
      mellemrumErSpil: !!ctx.egenTur,
    };
  }

  const vm = {
    get fase() { return fase; },
    get aktiv() { return fase !== 'af'; },
    get synlig() { return synlig; },
    get klaret() { return [...klaret]; },

    /** Min kunde har fået kontrollen (simulationens 'dinTur'). */
    dinTur() {
      if (fase === 'af') {
        if (laest) return;                       // én gang pr. kamp; bagefter kun visIgen
        laest = true;
        if (lager.hent(NOEGLE) === '1') return;
        start();
      }
      // Også når vejledningen fortsætter fra en tur, der sluttede uden skud.
      if (fase === 'trin') ur(true);
    },

    /** Forfra (pausemenuen). Rører ikke flaget; uret sendes af main.js. */
    visIgen() { laest = true; start(); },

    /** En hændelse for min aktive kunde (VEJLEDNING_HAENDELSER); e er hændelsen selv. */
    noter(navn, e) {
      if (IKKE_ET_TRIN(navn, e)) return;
      const id = HAENDELSE_TIL_TRIN[navn]; if (id) klar(id);
    },

    /**
     * Hver frame. ctx: { dt, tilstand, egenTur, vaaben, gaar, sigter, uretVenter }
     *   egenTur  min kunde i SPILLER_AKTIV — mellemrummet er spillets
     *   gaar/sigter  ← → / ↑ ↓ holdt, og de virker (ikke markør, arsenal, pause)
     */
    opdater(ctx) {
      const dt = ctx.dt || 0;
      if (fase === 'trin' && ctx.egenTur) {
        // (1e-6: 30 frames à 1/60 s summer til lidt under 0,5.)
        if (ctx.gaar && (gaa += dt) >= GAA_S - 1e-6) klar('gaa');
        if (ctx.sigter && (sigt += dt) >= SIGT_S - 1e-6) klar('sigt');
      }
      let vis = null;
      if (kvitter && kvitter.rest > 0) {
        kvitter.rest -= dt;
        vis = trinVisning(TRIN.find((t) => t.id === kvitter.id), ctx, true);
      } else {
        kvitter = null;
        if (fase === 'slut') {
          // Når verden er faldet til ro: hverken min tur, affyring eller opløsning.
          if (!slutVist && !ctx.egenTur && ctx.tilstand !== 'affyring' && ctx.tilstand !== 'oploesning') slutVist = true;
          if (slutVist) vis = slutVisning(ctx);
        } else if (fase === 'trin' && ctx.egenTur) {
          const t = naeste();
          if (t) vis = trinVisning(t, ctx, false);
        }
      }
      vistId = vis?.kort === 'trin' && !vis.ok ? vis.id : null;
      synlig = !!vis;
      return vis;
    },

    /** Esc: spring over (trinkortene) — med banneret og uden at vente mere. */
    spring() {
      if (fase === 'af') return;
      const varTrin = fase === 'trin';
      fase = 'af'; kvitter = null; vistId = null; synlig = false;
      if (varTrin) { ur(false); gemVist(); besked(SPRUNGET); }
    },
    /** Slutkortet lukkes (mellemrum, Esc eller klik). */
    luk() { fase = 'af'; kvitter = null; vistId = null; synlig = false; },

    /**
     * En tast, mens et kort er fremme: 'sprunget' | 'lukket' | 'videre' | null.
     * null: tasten er spillets. Esc hører til markøren i markørtilstand, og
     * mellemrummet tages kun på slutkortet, når det ikke er spillets.
     */
    tast(kode, { egenTur = false, markoer = false } = {}) {
      if (!synlig) return null;
      if (kode === 'Escape') {
        if (markoer) return null;
        if (fase === 'slut') { vm.luk(); return 'lukket'; }
        vm.spring();
        return 'sprunget';
      }
      if (kode === 'Space' && fase === 'slut' && slutVist && !egenTur) { vm.luk(); return 'videre'; }
      return null;
    },

    /** Kampen er forbi (ny kamp, sejr, forladt): intet gemmes — halvvejs er forfra. */
    ryd() { fase = 'af'; laest = false; kvitter = null; vistId = null; synlig = false; slutVist = false; },
  };
  return vm;
}

// ------------------------------------------------------------------ tegning

/** De fire ting man bruger konstant. Vises permanent. trin: vejledningens
 *  trin, som tastebjælken markerer (.nu), mens det står fremme. */
const KERNE = [
  { taster: ['←', '→'], hvad: 'Gå', trin: 'gaa' },
  { taster: ['↑', '↓'], hvad: 'Sigt', trin: 'sigt' },
  { taster: ['MELLEMRUM'], hvad: 'Hold og slip = skyd', fremhaev: true, trin: 'skyd' },
  { taster: ['ENTER'], hvad: 'Hop', trin: 'hop' },
  // Tab står ikke her: håndtaget "Flere våben" i venstre side viser det selv,
  // og en post mere får bjælken til at bryde på 1280 px-skærme.
  { taster: ['1', '…', '0'], hvad: 'Vælg våben', trin: 'vaaben' },
  { taster: ['?'], hvad: 'Alle taster' },
];

/** Kameraet — vises i tastebjælken efter kernetasterne. */
const KAMERA = [
  { taster: ['W', 'A', 'S', 'D'], hvad: 'Panorér' },
  { taster: ['Z', 'X'], hvad: 'Zoom' },
  { taster: ['C'], hvad: 'Centrér' },
  { taster: ['H'], hvad: 'Overblik' },
];

/** Hele tastaturet, grupperet. */
const GRUPPER = [
  ['Bevægelse', [
    ['← →', 'Gå til venstre eller højre'],
    ['Enter', 'Hop fremad'],
    ['Backspace', 'Baglæns saltomortale'],
  ]],
  ['Sigte og skud', [
    ['↑ ↓', 'Hæv eller sænk sigtet'],
    ['Shift + ↑ ↓', 'Finsigte'],
    ['Mellemrum (hold)', 'Lad kraften op — slip for at affyre'],
    ['F / Shift+F', 'Lunte 1–5 sekunder på bomberne'],
    ['T / Shift+T', 'Spring sigtemarkøren til næste fjende'],
  ]],
  ['Våben', [
    ['1 2 3 … 9 0', 'Vælg våben 1–10 fra bjælken (eller klik på det)'],
    ['Tab / Flere våben', 'Hele arsenalet i skuffen til venstre — uret står stille i op til 5 s'],
    ['Shift + 1–0', 'I arsenalet: læg det markerede våben på den plads på bjælken'],
    ['Q / E', 'Forrige eller næste våben på bjælken'],
    ['Forsyningskasser', 'Våbnene har få skud. Kasser daler ned i faldskærm — gå hen og saml dem op'],
  ]],
  ['Kamera', [
    ['W A S D', 'Panorér frit'],
    ['C', 'Centrér på din kunde'],
    ['Z / X', 'Zoom ud eller ind'],
    ['H (hold)', 'Kig over hele banen'],
  ]],
  ['Visning', [
    ['Indstillinger', 'UI-størrelse: gør knapper og tekst større'],
    ['Ctrl/⌘ + / −', 'Browserens zoom — forstørrer hele brugerfladen'],
  ]],
  ['Andet', [
    ['K', 'Sæt på hold og afslut turen'],
    ['M', 'Lyd til/fra (knappen øverst til højre har skydere)'],
    ['Esc', 'Pause — eller spring vejledningen over, mens den står fremme'],
    ['Pausemenuen', 'Vis vejledningen igen'],
    ['F3', 'Fejlfindingsoverlay'],
  ]],
];

/** Tasterne som tastebilleder; "…" står imellem som tekst (1 … 0). */
function tasterHTML(taster) {
  return taster.map((t) => (t === '…' ? '…' : `<kbd${t === 'MELLEMRUM' ? ' class="lang"' : ''}>${esc(t)}</kbd>`)).join('');
}

const pipsHTML = (pips) =>
  `<span class="vj-pips" aria-hidden="true">${pips.map((p) => `<i class="vj-pip${p ? ` ${p}` : ''}"></i>`).join('')}</span>`;

/** Kortets indre HTML ud fra trinmaskinens visning (ren; testes uden DOM). */
export function kortHTML(vis) {
  if (vis.kort === 'slut') {
    const husk = vis.mangler.length
      ? `<p class="vj-husk">Husk også: ${vis.mangler.map((t) => `${tasterHTML(t.taster)} ${esc(t.kort)}`).join(' · ')}</p>` : '';
    const knap = vis.mellemrumErSpil
      ? 'Tryk <kbd>Esc</kbd> for at lukke'
      : 'Tryk <kbd class="lang">MELLEMRUM</kbd> for at fortsætte';
    return `
      <div class="vj-top"><span class="vj-navn">Vejledning · klar</span>${pipsHTML(vis.pips)}
        <span class="vj-tal num">${vis.nr}/${vis.antal}</span></div>
      <p class="vj-tekst">${esc(vis.tekst)}</p>${husk}
      <button class="vj-goer" type="button" tabindex="-1" data-vj="videre">${knap}</button>
      <p class="vj-fod"><kbd>?</kbd> alle taster · Vejledningen kan vises igen fra pausemenuen</p>`;
  }
  return `
    <div class="vj-top"><span class="vj-navn">Vejledning</span>${pipsHTML(vis.pips)}
      ${vis.uretVenter ? '<span class="vj-venter">Uret venter</span>' : ''}
      <span class="vj-tal num">${vis.nr}/${vis.antal}</span></div>
    <p class="vj-tekst">${esc(vis.tekst)}</p>
    <div class="vj-goer"><span class="vj-lbl">Gør det</span>${tasterHTML(vis.taster)}
      <span class="vj-hvad">${esc(vis.goer)}</span><span class="vj-ok" aria-hidden="true">✓ Sådan!</span></div>
    <button class="vj-fod" type="button" tabindex="-1" data-vj="spring"><kbd>Esc</kbd> spring vejledningen over</button>`;
}

/** Tegn kun om, når visningen har ændret sig. */
const signatur = (vis) => (vis
  ? [vis.kort, vis.id, vis.nr, vis.ok, vis.pips.join(','), vis.tekst, vis.goer, vis.taster?.join(''),
     vis.uretVenter, vis.mellemrumErSpil, vis.mangler?.map((t) => t.id).join(',')].join('|')
  : '');

/**
 * rod: #hjaelp. ur og besked går videre til trinmaskinen (se lavVejledning).
 */
export function lavHjaelp(rod, { ur, besked, lager } = {}) {
  const vejl = lavVejledning({ ur, besked, lager });
  let oversigtAaben = false;
  let tegnet = '';
  let kortId = null;

  rod.innerHTML = `
    <div class="tastebjaelke" id="hjTaster">
      ${KERNE.map((k) => `
        <span class="tb-punkt ${k.fremhaev ? 'frem' : ''}"${k.trin ? ` data-trin="${k.trin}"` : ''}>
          ${k.taster.map((t) => `<kbd>${esc(t)}</kbd>`).join('')}
          <span class="tb-hvad">${esc(k.hvad)}</span>
        </span>`).join('')}
      <span class="tb-skille">Kamera</span>
      ${KAMERA.map((k) => `
        <span class="tb-punkt">
          ${k.taster.map((t) => `<kbd>${esc(t)}</kbd>`).join('')}
          <span class="tb-hvad">${esc(k.hvad)}</span>
        </span>`).join('')}
    </div>
    <div class="hjboble hide" id="hjBoble" role="status" aria-live="polite"></div>
    <div class="oversigt hide" id="hjOversigt">
      <div class="ov-kort">
        <h2>Sådan spiller du</h2>
        <p class="ov-intro">Spillet styres udelukkende på tastatur. Du behøver ikke musen — men du kan klikke på våbenbjælken og i arsenalet.</p>
        <div class="ov-grupper">
          ${GRUPPER.map(([navn, raekker]) => `
            <section>
              <h3>${esc(navn)}</h3>
              <table>${raekker.map(([t, h]) =>
                `<tr><td class="ov-tast">${esc(t)}</td><td>${esc(h)}</td></tr>`).join('')}</table>
            </section>`).join('')}
        </div>
        <p class="ov-fod">Luk med <kbd>?</kbd> eller <kbd>Esc</kbd></p>
      </div>
    </div>`;
  // Våbenbjælken skal ligge lige over tastebjælken, uanset hvor høj den er
  // (den kan bryde over i to rækker på smalle skærme): mål den.
  const taster = rod.querySelector('#hjTaster');
  if (typeof ResizeObserver === 'function' && taster) {
    new ResizeObserver(() => document.documentElement.style.setProperty('--taste-h', `${taster.offsetHeight}px`))
      .observe(taster);
  }

  const boks = rod.querySelector('#hjBoble');
  const oversigt = rod.querySelector('#hjOversigt');
  const punkter = [...rod.querySelectorAll('.tb-punkt[data-trin]')];

  // Kortet står nederst over våbenbjælken — men står den aktive kunde så lavt
  // på skærmen, at kortet ville dække ham (kameraet trækker billedet ned mod
  // vandet), flyttes det op under uret. Kortets top måles kun, når et nyt kort
  // tegnes; hver frame er det ren regning (ingen layoutlæsning efter skrivning).
  let oppe = false;
  let bundAfstand = 0, kortH = 0;       // målt nederst: afstand til skærmens bund, kortets højde
  const kortTopNede = () => window.innerHeight - bundAfstand - kortH;
  function placer(fodY) {
    if (!kortH) return;
    const top = kortTopNede();
    const skal = oppe ? fodY != null && fodY > top - 70 : fodY != null && fodY > top - 12;
    if (skal === oppe) return;
    oppe = skal;
    boks.classList.toggle('oppe', oppe);
    boks.classList.toggle('bund', !oppe);
  }

  function tegn(vis) {
    const s = signatur(vis);
    if (s === tegnet) return;
    tegnet = s;
    const trin = vis?.kort === 'trin' ? vis.tastTrin : null;
    for (const p of punkter) p.classList.toggle('nu', p.dataset.trin === trin);
    if (!vis) { boks.className = 'hjboble hide'; boks.innerHTML = ''; kortId = null; kortH = 0; oppe = false; return; }
    boks.className = `hjboble vejl ${oppe ? 'oppe' : 'bund'}${vis.ok ? ' klaret' : ''}${vis.kort === 'slut' ? ' slut' : ''}`;
    boks.innerHTML = kortHTML(vis);
    const rekt = boks.getBoundingClientRect?.();
    if (rekt) {
      kortH = rekt.height;
      if (!oppe) bundAfstand = window.innerHeight - rekt.bottom;
    }
    // Et nyt kort glider ind (vjInd); kvitteringen på det samme gør ikke.
    const id = vis.kort === 'slut' ? 'slut' : vis.id;
    if (id !== kortId && kortId !== null) {
      boks.style.animation = 'none';
      void boks.offsetWidth;
      boks.style.animation = '';
    }
    kortId = id;
  }

  // Klik gør det samme som tasterne. blur(): et senere mellemrum må ikke
  // "klikke" knappen igen (som i hud.js).
  boks.addEventListener('click', (e) => {
    const knap = e.target.closest?.('[data-vj]');
    if (!knap) return;
    knap.blur();
    if (knap.dataset.vj === 'spring') vejl.spring();
    else vejl.luk();
    tegn(null);
  });

  return {
    /** Min kunde har fået kontrollen (simulationens 'dinTur'). */
    dinTur() { vejl.dinTur(); },
    /** Vejledningen forfra (pausemenuen) — vises i min næste egen tur. */
    visIgen() { vejl.visIgen(); },
    /** En hændelse for min aktive kunde, der måske klarer et trin. */
    noter(navn, e) { vejl.noter(navn, e); },
    /** Hver frame (main.js opdaterVisning); ctx som lavVejledning.opdater. */
    opdater(ctx) { tegn(vejl.opdater(ctx)); placer(ctx.fodY); },
    /** Tager vejledningen tasten? ctx: { egenTur, markoer }. */
    tast(e, ctx) {
      const r = vejl.tast(e.code, ctx);
      if (r) tegn(null);
      return r;
    },
    get vejledning() { return vejl; },

    skiftOversigt() {
      oversigtAaben = !oversigtAaben;
      oversigt.classList.toggle('hide', !oversigtAaben);
      return oversigtAaben;
    },
    lukOversigt() { oversigtAaben = false; oversigt.classList.add('hide'); },
    get oversigtErAaben() { return oversigtAaben; },

    saetSynlig(v) { rod.classList.toggle('hide', !v); },
    ryd() { vejl.ryd(); tegn(null); },
  };
}

export { GRUPPER, KERNE };
