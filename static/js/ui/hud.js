/* Kundekrigen — HUD som DOM-overlay.
 *
 * Hvorfor DOM og ikke tegnet i canvas: vi har ingen fontassets og intet
 * byggetrin, så tekst i canvas ville kræve SDF-fontgenerering eller
 * canvas2d-bagning hver frame. DOM giver os Poppins, designtokens,
 * tabular-nums på urene og rigtige fokusmarkeringer gratis — og HUD'en
 * opdaterer nogle få tekstnoder per frame, så der er ingen ydelsesgrund
 * til at lade være.
 */
'use strict';

import { T, esc, mmss, VEJR_NAVN, brydOrd } from './tekst.js';
import { HOLD, HOLD_ORDEN, holdFarve } from '../render/palette.js';
import { VAABEN } from '../sim/weapons.js';
import { FAVORIT_LABELS, ANTAL_FAVORITTER } from './keyboard.js';
import { ikonHTML } from './vaabenikoner.js';
import { HZ } from '../core/tick.js';
import { VEJLEDNING_LOFT } from '../sim/turn.js';
import { tbjHTML, tbjRefs, saetTbj, saetTbjRamt, kortNavn, hentTbjGrafik, LAV_HP } from './tbj.js';

/* Navneskiltet sidder 12 wu over hovedet (figuren er 46) plus 8 px: så ser
 * afstanden til hovedet ens ud ved alle zoomtrin. De gamle 74 wu gav 66 px
 * luft ved det nye, tættere kamera, og skiltet hang i luften. */
export const ETIKET_WU = 58, ETIKET_PX = 8;
/* Skade- og helbredstallene popper op OVER skiltet, ikke hen over navnet og
 * HP, mens skiltet ryster og tæller ned. Skiltets højde læses, når det
 * findes; ellers 20 px (tålmodighedsbjælken ved --ui 1). Luften dækker den
 * gule ring om den aktive kunde (2 + 2 px) og tallets pop (skala 1,25), der
 * når lidt under tallets eget anker. */
export const ETIKET_HOEJDE = 20, TAL_LUFT = 6;

/** Skærm-y for et skade- eller helbredstals anker (dets underkant før
 *  animationen). sy: tilSkaerm(x, y + ETIKET_WU).y; skiltH: skiltets højde. */
export function talAnker(sy, skiltH = 0) {
  return sy - ETIKET_PX - (skiltH > 0 ? skiltH : ETIKET_HOEJDE) - TAL_LUFT;
}

/** Det, der kan ligge i arsenalskuffen: alt undtagen meta-valgene. */
const ARSENAL = Object.values(VAABEN).filter((w) => w.kategori !== 'meta');

/** Ammo som badge: ×3, et gråt 0, eller ∞ for meta-valgene. */
const ammoTekst = (a) => (a < 0 ? T.spil.ubegraenset : a === 0 ? '0' : `×${a}`);

/* Statusikoner i holdlisten. Tegnet i currentColor; farven sidder i CSS. */
const STATUS_IKON = {
  skjold: '<path d="M6 .9l4.6 1.7v3.2c0 2.8-2 4.7-4.6 5.4C3.4 10.5 1.4 8.6 1.4 5.8V2.6z"/>',
  opdaterer: '<path d="M9.9 6.4A4 4 0 1 1 8.6 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10.9 1.2v3.6H7.3z"/>',
  smittet: '<circle cx="6" cy="6" r="2.9"/><path d="M6 .8v1.8M6 9.4v1.8M.8 6h1.8M9.4 6h1.8M2.3 2.3l1.3 1.3M8.4 8.4l1.3 1.3M9.7 2.3L8.4 3.6M3.6 8.4L2.3 9.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};
const statusIkon = (slags, tekst) =>
  `<svg class="hb-ikon ${slags}" viewBox="0 0 12 12" fill="currentColor" role="img" aria-label="${esc(tekst)}"><title>${esc(tekst)}</title>${STATUS_IKON[slags]}</svg>`;

function statusIkoner(x) {
  if (x.doed) return '';
  return (x.skjold ? statusIkon('skjold', T.spil.status.skjold) : '') +
         (x.springOver ? statusIkon('opdaterer', T.spil.status.springOver) : '') +
         (x.smittet > 0 ? statusIkon('smittet', T.spil.status.smittet) : '');
}
/** Statusikonerne som et tal, så nøglerne kan sammenlignes uden strenge. */
const statusBits = (x) => (x.doed ? 0 : (x.skjold ? 1 : 0) | (x.springOver ? 2 : 0) | (x.smittet > 0 ? 4 : 0));
/** Næste COVID-tik vises i bjælken (kraftfeltet blokerer det, damage.js givSkade). */
const smitteVises = (x) => !x.doed && x.smittet > 0 && !x.skjold;

/* Skiltets klasser som en bitmaske: kun de bits, der skifter, rører DOM'en. */
const K_RAMT = 1, K_AKTIV = 2, K_EGEN = 4, K_LAV = 8, K_DOED = 16, K_UDE = 32;
const KLASSER = [[K_RAMT, 'ramt'], [K_AKTIV, 'aktiv'], [K_EGEN, 'egen'], [K_LAV, 'lav'], [K_DOED, 'doed'], [K_UDE, 'ude']];
function saetKlasser(n, k) {
  const d = k ^ n._k;
  n._k = k;
  for (let i = 0; i < KLASSER.length; i++) {
    if (d & KLASSER[i][0]) n.classList.toggle(KLASSER[i][1], (k & KLASSER[i][0]) !== 0);
  }
}
/* En død kundes skilt står, til tallet er talt ned til 0, og toner så ud
 * (app.css .etiket.ude, 600 ms) og fjernes. SYN_KANT: halvdelen af det
 * bredeste skilt ved --ui 1,5 (132 · 1,5 / 2 = 99 px) plus luft. */
const UD_MS = 650, SYN_KANT = 120;

export function lavHud(rod, r) {
  rod.innerHTML = `
    <div class="hud-top">
      <div class="hud-aktiv" id="hudAktiv"></div>
      <div class="hud-ure">
        <div class="tururet num" id="hudTur">30</div>
        <div class="ur-venter hide" id="hudVenter"><span class="uv-tekst">Uret venter</span><span class="uv-bar"><i></i></span></div>
        <div class="kamptid num" id="hudKamp">30:00</div>
        <div class="sudden hide" id="hudSudden">${T.spil.pludseligDoed}</div>
      </div>
      <div class="hud-vind" id="hudVind"></div>
    </div>

    <div class="hud-hold" id="hudHold"></div>

    <div class="hud-bund" id="hudBund">
      <div class="hud-vaaben" id="hudVaaben"></div>
      <div class="kraftbar hide" id="hudKraft"><i></i></div>
      <div class="favoritbar" id="hudFavorit" role="toolbar" aria-label="Våbenbjælke"></div>
    </div>

    <button class="hud-arsenal skjult" id="hudArsenal" type="button" tabindex="-1"
            aria-expanded="false" aria-controls="panel" title="${esc(T.spil.flereVaabenTitel)}">
      <svg class="ha-chevron" viewBox="0 0 12 20" aria-hidden="true">
        <path d="M3.5 3.5l6 6.5-6 6.5" fill="none" stroke="currentColor" stroke-width="2.6"
              stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="ha-tekst">${T.spil.flereVaaben}</span>
      <span class="ha-antal num" id="hudArsenalAntal">0</span>
      <kbd class="ha-tast">Tab</kbd>
    </button>

    <div class="etiketter" id="hudEtiketter"></div>
    <div class="banner hide" id="hudBanner"></div>
    <div class="netstatus hide" id="hudNet"></div>
  `;

  const $ = (id) => rod.querySelector('#' + id);
  const el = {
    aktiv: $('hudAktiv'), tur: $('hudTur'), kamp: $('hudKamp'), sudden: $('hudSudden'),
    vind: $('hudVind'), hold: $('hudHold'), vaaben: $('hudVaaben'),
    bund: $('hudBund'), kraft: $('hudKraft'), favorit: $('hudFavorit'), etiketter: $('hudEtiketter'),
    banner: $('hudBanner'), net: $('hudNet'), arsenal: $('hudArsenal'), arsenalAntal: $('hudArsenalAntal'),
  };

  // Uret venter på vejledningen (simulationens kvote, deltaens vj) — for alle.
  const venter = $('hudVenter'), venterBar = venter.querySelector('i');
  let sidsteVenter = -1;

  const etiketPulje = new Map();
  // Den tålmodighed, der VISES. Skaden holdes tilbage, til skuddet er
  // afviklet, og tælles så ned (main.js styrer det); indtil da er det b.hp.
  let visHp = (b) => b.hp;
  // Bjælkens fyld: det, der er TILBAGE, når nedtællingen er i gang (fyldet
  // falder straks, det tabte løber ned med tallet); ellers det viste tal.
  let fyldHp = (b) => visHp(b);
  const ramte = new Set();
  let sidsteVaaben = null, sidsteVind = null;
  // Genbruges hver frame: skiltenes skærmpladser. Skiltene, der er med,
  // stemples med framens nummer (ingen Set, der skal ryddes og fyldes).
  const maal = [];
  let etiketRamme = 0;
  // Den aktive øverst og holdlisten bygges kun om, når deres nøgle skifter;
  // tallene og bjælkerne skrives på stedet (saetTbj skriver kun ændringer).
  const ak = { id: NaN, din: false, st: -1, navn: null, t: null, tekst: null };
  const holdSig = { n: -1, akt: NaN, holdIdx: NaN, pid: null, k: [], navn: [] };
  const holdRader = new Map();
  const holdTotal = [];                 // [{ hid, n, s }]
  let sidsteTurTal = NaN, sidsteKampSek = NaN;

  hentTbjGrafik();

  function lavEtiket(b) {
    const n = document.createElement('div');
    n.className = 'etiket';
    n._k = 0; n._synlig = null; n._ude = 0; n._navn = null; n._x = NaN; n._y = NaN;
    saetEtiketNavn(n, b);
    el.etiketter.appendChild(n);
    etiketPulje.set(b.id, n);
    return n;
  }
  function saetEtiketNavn(n, b) {
    n._navn = b.navn;
    n.innerHTML = tbjHTML(holdFarve(b.hold), kortNavn(b.navn));
    n._t = tbjRefs(n.firstElementChild);
  }

  /** Holdlistens nøgle uden strenge: hvem, død (talt ned), status, aktiv. */
  function holdAendret(v, egenPid) {
    const L = v.baevere;
    let aendret = L.length !== holdSig.n || v.tur.baeverId !== holdSig.akt ||
                  v.tur.holdIdx !== holdSig.holdIdx || egenPid !== holdSig.pid;
    holdSig.n = L.length; holdSig.akt = v.tur.baeverId; holdSig.holdIdx = v.tur.holdIdx; holdSig.pid = egenPid;
    for (let i = 0; i < L.length; i++) {
      const x = L[i];
      const k = x.id * 16 + (x.doed && visHp(x) <= 0 ? 8 : 0) + statusBits(x);
      if (holdSig.k[i] !== k || holdSig.navn[i] !== x.navn) { holdSig.k[i] = k; holdSig.navn[i] = x.navn; aendret = true; }
    }
    return aendret;
  }

  // --- våbenbjælken: altid ti pladser (1–0), også når nogle er tomme, så
  // tallene står fast. pladser[i] = { id, knap, ammo } — id er null for et hul.
  let pladser = [];
  let paaBjaelken = new Set();
  let sidsteBjaelke = '';
  let sidsteTur = '';
  let vedVaelg = () => {};
  let vedArsenal = () => {};

  function byggFavoritter(liste) {
    const l = Array.isArray(liste) ? liste : [];
    const ids = Array.from({ length: ANTAL_FAVORITTER }, (_, i) => (VAABEN[l[i]] ? l[i] : null));
    paaBjaelken = new Set(ids.filter(Boolean));
    el.favorit.innerHTML = ids.map((id, i) => {
      const tast = `<span class="favtast">${FAVORIT_LABELS[i]}</span>`;
      if (!id) {
        return `<div class="fav fav-plads" aria-hidden="true" title="${esc(T.spil.tomPladsTitel(FAVORIT_LABELS[i]))}">
          ${tast}<span class="favplads-ikon"></span><span class="favnavn">${T.spil.tomPlads}</span>
        </div>`;
      }
      const w = VAABEN[id];
      return `<button class="fav" type="button" tabindex="-1" data-vaaben="${esc(id)}"
                title="${esc(w.navn)} (${FAVORIT_LABELS[i]}) — ${esc(w.hjaelp || '')}">
        ${tast}
        <span class="favammo num"></span>
        ${ikonHTML(w, 'favikon')}
        <span class="favnavn">${brydOrd(w.navn)}</span>
      </button>`;
    }).join('');
    pladser = [...el.favorit.children].map((knap, i) => ({ id: ids[i], knap, ammo: knap.querySelector('.favammo') }));
    // Tal, markering og skuffens tæller skrives ved næste frame.
    sidsteBjaelke = '';
    sidsteVaaben = null;
  }

  /** Ammo på ALLE pladser hver frame — kasser og telefonen giver ammo midt i
   *  turen, også til våben man ikke har i hånden. DOM'en skrives kun, når
   *  noget faktisk har ændret sig. */
  function opdaterBjaelke(v, b) {
    const tab = (b && v.hold?.[b.hold]?.ammo) || null;
    const a = (id) => (tab ? (tab[id] ?? 0) : 0);
    let andre = 0;
    for (const w of ARSENAL) if (!paaBjaelken.has(w.id) && a(w.id) !== 0) andre++;
    const iSkuffen = !!VAABEN[v.valgtVaaben] && VAABEN[v.valgtVaaben].kategori !== 'meta' &&
                     !paaBjaelken.has(v.valgtVaaben);
    let sig = `${b ? b.hold : '-'}|${v.valgtVaaben}|${andre}`;
    for (const p of pladser) sig += p.id ? `|${a(p.id)}` : '|';
    if (sig === sidsteBjaelke) return;
    sidsteBjaelke = sig;
    for (const p of pladser) {
      if (!p.id) continue;
      const n = a(p.id);
      p.ammo.textContent = ammoTekst(n);
      p.knap.classList.toggle('tom', n === 0);
      p.knap.classList.toggle('valgt', p.id === v.valgtVaaben);
    }
    el.arsenalAntal.textContent = andre;
    el.arsenalAntal.classList.toggle('nul', andre === 0);
    // Våbnet i hånden ligger ikke på bjælken: håndtaget viser, hvor det er.
    el.arsenal.classList.toggle('har-valgt', iSkuffen);
  }

  // Et klik på en plads er det samme som tallet. Tomme pladser og våben uden
  // ammo gør ingenting — de ryster bare på hovedet.
  el.favorit.addEventListener('click', (e) => {
    const k = e.target.closest('.fav[data-vaaben]');
    if (!k) return;
    k.blur();
    if (k.classList.contains('tom')) { k.classList.remove('nej'); void k.offsetWidth; k.classList.add('nej'); return; }
    vedVaelg(k.dataset.vaaben);
  });
  el.favorit.addEventListener('animationend', (e) => e.target.classList?.remove('nej'));
  el.arsenal.addEventListener('click', () => { el.arsenal.blur(); vedArsenal(); });
  el.arsenal.addEventListener('animationend', (e) => {
    if (e.animationName === 'arsenalPuf') el.arsenal.classList.remove('puf');
  });

  // Bjælkens højde bestemmer, hvor netstatus, hjælpeboblerne og skuffen skal
  // ligge. Den MÅLES (--bund-h, uskaleret), så de følger med, når bjælken
  // ændrer sig — i stedet for faste tal, der passer til én udgave af den.
  const bundMaaler = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!el.bund.isConnected) return;
    document.documentElement.style.setProperty('--bund-h', `${el.bund.offsetHeight}px`);
  }) : null;
  bundMaaler?.observe(el.bund);

  return {
    el,
    byggFavoritter,

    /** Klik på en plads i bjælken: cb(id). */
    paaVaelgVaaben(cb) { vedVaelg = cb; },
    /** Klik på håndtaget "Flere våben". */
    paaArsenal(cb) { vedArsenal = cb; },
    /** Håndtagets tilstand følger skuffen. */
    saetArsenalAaben(aaben) {
      el.arsenal.setAttribute('aria-expanded', aaben ? 'true' : 'false');
      el.arsenal.classList.toggle('aaben', !!aaben);
    },

    /** Kaldes hver frame. Holder sig til at skrive tekstnoder der har ændret sig. */
    /** minTur: den lokale spiller styrer den aktive kunde. Ellers er man
     *  tilskuer og ser kun, hvad den aktive har i hånden — ikke en
     *  våbenbjælke, man alligevel ikke kan bruge. */
    opdater(v, egenPid, tilstandTekst, oplader = false, kraft = 0, minTur = true) {
      // Skiltene først: tilSkaerm læser lærredets størrelse (renderer.js), og
      // det skal ske, før HUD'en skriver i denne frame (ellers en tvungen,
      // synkron layoutberegning hver frame).
      v.egenPid = egenPid;
      this.opdaterEtiketter(v, r);

      const b = v.aktivBaever();
      el.bund.classList.toggle('tilskuer', !minTur);
      // Også på roden: arsenalskuffen (#panel) er en søster til #hud og skjules
      // i CSS ud fra den, præcis som bjælken.
      rod.classList.toggle('hud-tilskuer', !minTur);
      const hold = b ? holdFarve(b.hold) : null;

      // --- aktiv kunde (WoW's target frame): bjælken med det fulde navn, og
      // under den DIN TUR og statusikonerne. Bygges kun, når kunden, DIN TUR,
      // status eller navnet skifter; tallene skrives på stedet.
      if (b) {
        const dinTur = !!(egenPid && (b.ejer === egenPid || v.pidPaaHold?.(egenPid, b.hold)));
        const st = statusBits(b);
        if (!ak.t || b.id !== ak.id || dinTur !== ak.din || st !== ak.st || b.navn !== ak.navn) {
          ak.id = b.id; ak.din = dinTur; ak.st = st; ak.navn = b.navn; ak.tekst = null;
          el.aktiv.className = `hud-aktiv${dinTur ? ' dinTur' : ''}`;
          const ik = statusIkoner(b);
          const under = (dinTur ? `<span class="dintur-mark" style="background:${hold.css};color:${hold.tekst}">DIN TUR</span>` : '') +
                        (ik ? `<span class="hb-status">${ik}</span>` : '');
          el.aktiv.innerHTML = tbjHTML(hold, b.navn, 'tbj--aktiv') + (under ? `<div class="ak-under">${under}</div>` : '');
          ak.t = tbjRefs(el.aktiv.firstElementChild);
        }
        saetTbj(ak.t, visHp(b), b.doed ? 0 : fyldHp(b), smitteVises(b));
        saetTbjRamt(ak.t, ramte.has(b.id));
      } else {
        const t = tilstandTekst || T.spil.venter;
        if (ak.t || ak.tekst !== t) {
          ak.t = null; ak.tekst = t;
          el.aktiv.className = 'hud-aktiv';
          el.aktiv.textContent = t;
        }
      }

      // --- ure (skrives kun, når sekundet skifter)
      const iTilbagetog = v.tur.retreatTil !== null && v.tick < v.tur.retreatTil &&
                          v.tur.tilstand === 'oploesning';
      const turTal = iTilbagetog ? -Math.ceil((v.tur.retreatTil - v.tick) / HZ)
                                 : Math.max(0, Math.ceil(v.tur.tickTilbage / HZ));
      if (turTal !== sidsteTurTal) {
        sidsteTurTal = turTal;
        el.tur.textContent = Math.abs(turTal);
        el.tur.classList.toggle('tilbagetog', iTilbagetog);
      }
      const kampSek = Math.ceil(Math.max(0, v.cfg.kampTicks - v.tick) / HZ);
      if (kampSek !== sidsteKampSek) { sidsteKampSek = kampSek; el.kamp.textContent = mmss(kampSek); }
      el.sudden.classList.toggle('hide', !v.pludseligDoed);
      // Kvoten er et ur: en bjælke, der løber ned, og tallet dæmpes imens.
      const vjRest = v.tur.tilstand === 'spiller_aktiv' ? v.tur.vejledningRest | 0 : 0;
      const vjPct = vjRest > 0 ? Math.ceil((100 * vjRest) / VEJLEDNING_LOFT) : 0;
      if (vjPct !== sidsteVenter) {
        sidsteVenter = vjPct;
        venter.classList.toggle('hide', vjPct === 0);
        el.tur.classList.toggle('venter', vjPct > 0);
        venterBar.style.width = `${vjPct}%`;
      }

      // --- vind. Tallet og retningen bærer betydningen; farven er kun en
      // redundant markør, så den aldrig står alene. Vi viser den EFFEKTIVE
      // vind (vejr og vindstød indregnet), afrundet så den ikke flimrer —
      // det er den, skuddet rent faktisk får, og sigtelinjen bruger den.
      const vindEff = Math.round((v.vindNu ? v.vindNu() : v.vind) * 20) / 20;
      if (vindEff !== sidsteVind) {
        sidsteVind = vindEff;
        const n = Math.round(Math.abs(vindEff) * 10);
        const hoejre = vindEff >= 0;
        const pile = Array.from({ length: Math.max(1, n) }, () =>
          `<svg viewBox="0 0 64 40" class="vindpil ${hoejre ? '' : 'spejl'}"><use href="#i-arrow"/></svg>`
        ).join('');
        el.vind.innerHTML = `
          <span class="lbl">${T.spil.vind}</span>
          <span class="vindpile ${hoejre ? 'h' : 'v'}">${n === 0 ? '<i class="stille">stille</i>' : pile}</span>
          <span class="vindtal num">${(Math.abs(vindEff) * 10).toFixed(1)}</span>`;
      }

      // --- holdoversigt
      //
      // Tre niveauer af vægt, og rækkefølgen er vigtig:
      //   1. DEN AKTUELLE BÆVER skal springe i øjnene — det er den, alt
      //      handler om lige nu.
      //   2. MINE bævere skal være til at finde uden at lede.
      //   3. Alle andre er kontekst.
      // Rækkerne er raid frames: bjælke med navn og tal indeni. Listen bygges
      // kun om, når nogen dør (talt ned), får status eller turen skifter;
      // tallene tælles ned på stedet.
      if (holdAendret(v, egenPid)) {
        const grupper = new Map();
        for (const x of v.baevere) {
          if (!grupper.has(x.hold)) grupper.set(x.hold, []);
          grupper.get(x.hold).push(x);
        }
        const mit = (x) => egenPid && (x.ejer === egenPid || v.pidPaaHold?.(egenPid, x.hold));
        el.hold.innerHTML = [...grupper.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([hid, liste]) => {
            const f = holdFarve(hid);
            const talt = (x) => x.doed && visHp(x) <= 0;           // død OG talt ned
            const levende = liste.filter((x) => !talt(x)).length;
            const aktivtHold = v.tur.holdIdx === hid;
            const mitHold = liste.some(mit);
            return `<div class="holdkort ${aktivtHold ? 'aktivt' : ''} ${mitHold ? 'mit' : ''}"
                         style="--hf:${f.css}">
              <div class="holdnavn">
                <span class="hn-prik"></span>
                <span class="hn-tekst">${esc(f.navn)}</span>
                ${mitHold ? '<span class="hn-dig">DIG</span>' : ''}
                <span class="hn-tal num">${levende}<i>/${liste.length}</i></span>
                <span class="hn-hp num" data-hold="${hid}"></span>
              </div>
              ${liste.map((x) => {
                const erAktiv = x.id === v.tur.baeverId && !x.doed;
                return `<div class="hbaever ${talt(x) ? 'doed' : ''} ${erAktiv ? 'aktiv' : ''} ${mit(x) ? 'egen' : ''}" data-id="${x.id}">
                  <span class="hb-markoer">${erAktiv ? '<svg viewBox="0 0 64 40"><use href="#i-arrow"/></svg>' : ''}</span>
                  ${tbjHTML(f, kortNavn(x.navn), 'tbj--hold')}
                  <span class="hb-status">${statusIkoner(x)}</span>
                </div>`;
              }).join('')}
            </div>`;
          }).join('');
        holdRader.clear();
        holdTotal.length = 0;
        for (const rk of el.hold.querySelectorAll('.hbaever')) holdRader.set(+rk.dataset.id, tbjRefs(rk.querySelector('.tbj')));
        for (const n of el.hold.querySelectorAll('.hn-hp')) holdTotal.push({ hid: +n.dataset.hold, n, s: NaN });
      }
      for (let i = 0; i < v.baevere.length; i++) {
        const x = v.baevere[i], t = holdRader.get(x.id);
        if (!t) continue;
        saetTbj(t, visHp(x), x.doed ? 0 : fyldHp(x), smitteVises(x));
        saetTbjRamt(t, ramte.has(x.id));
      }
      for (let j = 0; j < holdTotal.length; j++) {
        const h = holdTotal[j];
        let s = 0;
        for (let i = 0; i < v.baevere.length; i++) {
          const x = v.baevere[i];
          if (x.hold === h.hid) { const hp = visHp(x); if (hp > 0) s += hp; }
        }
        if (s !== h.s) { h.s = s; h.n.textContent = s; }
      }

      // --- våben
      const w = v.vaabenNu();
      const ammo = b ? v.ammoFor(b.hold, v.valgtVaaben) : 0;
      const noegle = `${v.valgtVaaben}|${ammo}|${v.valgtLunte}|${minTur}|${b?.id}`;
      if (noegle !== sidsteVaaben) {
        sidsteVaaben = noegle;
        el.vaaben.innerHTML = w ? `
          ${!minTur && b ? `<div class="vtilskuer">${esc(b.navn)} har</div>` : ''}
          <div class="vnavn">${ikonHTML(w, 'vikon')}${esc(w.navn)}</div>
          <div class="vmeta">
            <span class="${ammo === 0 ? 'vtom' : ''}">${T.spil.ammo}: <b class="num">${ammo < 0 ? T.spil.ubegraenset : ammo}</b></span>
            ${w.lunte ? `<span>${T.spil.lunte}: <b class="num">${v.valgtLunte}s</b></span>` : ''}
          </div>` : '';
      }

      // --- våbenbjælken og håndtaget til resten af arsenalet
      opdaterBjaelke(v, b);
      const kanAabne = minTur && !!b && !b.doed;
      el.arsenal.classList.toggle('skjult', !kanAabne);
      // Et lille puf i håndtaget, når ens tur begynder: "der er mere herinde".
      const tur = kanAabne ? `${b.id}|${v.tur.turNr ?? ''}` : '';
      if (tur && tur !== sidsteTur && !el.arsenal.classList.contains('aaben')) el.arsenal.classList.add('puf');
      sidsteTur = tur;

      // --- opladningsbar. Måles lokalt, så bjælken reagerer med det samme
      // og ikke først når værtens tilstand er nået hjem igen.
      el.kraft.classList.toggle('hide', !oplader);
      if (oplader) el.kraft.firstElementChild.style.width = `${(kraft * 100).toFixed(0)}%`;
    },

    /** Skiltene over kunderne: tålmodighedsbjælken med kaldenavn og tal.
     *  Alle læsninger først (tilSkaerm, vinduet), så alle skrivninger — og
     *  transform, aldrig left/top. I ro skrives intet: pladsen, lagene og
     *  klasserne caches på skiltet og skrives kun, når de ændrer sig. */
    opdaterEtiketter(v, r) {
      const nu = performance.now(), W = window.innerWidth, H = window.innerHeight;
      const ramme = ++etiketRamme;
      let m = 0;
      for (let i = 0; i < v.baevere.length; i++) {
        const b = v.baevere[i];
        const vist = visHp(b);
        if (b.doed && vist <= 0) {
          // Talt ned til 0: skiltet toner ud og fjernes. En kunde, der
          // allerede var død (fx i et snapshot), får aldrig et skilt.
          const n = etiketPulje.get(b.id);
          if (!n) continue;
          if (!n._ude) n._ude = nu;
          if (nu - n._ude > UD_MS) continue;
        }
        const x = b.x, y = b.y;           // samme interpolerede position som figuren
        const p = r.tilSkaerm(x, y + ETIKET_WU);   // se ETIKET_WU
        const s = maal[m] || (maal[m] = { b: null, x: 0, y: 0, vist: 0 });
        s.b = b; s.x = p.x; s.y = p.y; s.vist = vist; m++;
      }
      const egen = v.egenPid;
      for (let i = 0; i < m; i++) {
        const s = maal[i], b = s.b;
        s.b = null;
        const n = etiketPulje.get(b.id) || lavEtiket(b);
        n._ramme = ramme;
        const synlig = s.x > -SYN_KANT && s.y > -40 && s.x < W + SYN_KANT && s.y < H + 40;
        if (synlig !== n._synlig) { n._synlig = synlig; n.style.visibility = synlig ? 'visible' : 'hidden'; }
        if (!synlig) continue;
        const px = s.x | 0, py = (s.y - ETIKET_PX) | 0;
        if (px !== n._x || py !== n._y) {
          n._x = px; n._y = py;
          n.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
        }
        if (n._navn !== b.navn) saetEtiketNavn(n, b);
        const lever = !b.doed;
        saetTbj(n._t, s.vist, lever ? fyldHp(b) : 0, smitteVises(b));
        const k = (ramte.has(b.id) ? K_RAMT : 0) |
                  (lever && b.id === v.tur.baeverId ? K_AKTIV : 0) |
                  (lever && egen && (b.ejer === egen || v.pidPaaHold?.(egen, b.hold)) ? K_EGEN : 0) |
                  (lever && s.vist > 0 && s.vist <= LAV_HP ? K_LAV : 0) |
                  (lever ? 0 : K_DOED) | (n._ude ? K_UDE : 0);
        if (k !== n._k) saetKlasser(n, k);
      }
      // Hvert skilt, der er med, er stemplet med denne frame; kun et
      // overskud (døde, talt ned og tonet ud) skal findes og fjernes.
      if (etiketPulje.size > m) {
        for (const [id, n] of etiketPulje) {
          if (n._ramme !== ramme) { n.remove(); etiketPulje.delete(id); }
        }
      }
    },

    saetVisHp(fn) { visHp = fn; },
    /** Bjælkens fyld under nedtællingen (main.js: det, tallet ender på). */
    saetFyldHp(fn) { fyldHp = fn; },
    /** Etiketten ryster og lyser rødt, mens tallet tæller ned. */
    markerRamt(id, paa) { if (paa) ramte.add(id); else ramte.delete(id); },

    /** Taleboble fra telefonen: hvem der ringer, hvad de siger, og følgen. */
    opkaldBoble(x, y, navn, tekst, foelge, r) {
      const p = r.tilSkaerm(x, y + 60);
      const n = document.createElement('div');
      n.className = 'opkaldboble';
      n.innerHTML = `<div class="ob-hvem">📞 ${esc(navn)} ringer</div>
        <div class="ob-tekst">”${esc(tekst)}”</div>
        ${foelge ? `<div class="ob-foelge">${esc(foelge)}</div>` : ''}`;
      n.style.left = `${Math.max(150, Math.min(window.innerWidth - 150, p.x)) | 0}px`;
      n.style.top = `${Math.max(120, p.y) | 0}px`;
      el.etiketter.appendChild(n);
      setTimeout(() => n.classList.add('ud'), 5600);
      setTimeout(() => n.remove(), 6100);
    },

    /**
     * Lydknappen øverst til højre: klik slår al lyd fra og til (også M), og
     * når musen står over den, folder skyderne for effekter og musik ud.
     * o = { fra, lyd, musik, vedFra(bool), vedLyd(0-1), vedMusik(0-1) }.
     */
    lydKnap(o) {
      rod.querySelector('.hud-lyd')?.remove();
      const n = document.createElement('div');
      n.className = 'hud-lyd';
      const pct = (v) => Math.round(v * 100);
      n.innerHTML = `
        <button class="hl-knap" type="button" aria-label="Lyd til/fra (M)" title="Lyd til/fra (M)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>
            <path class="hl-boelger" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path class="hl-kryds" d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>
        <div class="hl-skydere">
          <label><span>Effekter</span><input type="range" min="0" max="100" step="5" data-k="lyd" value="${pct(o.lyd)}"></label>
          <label><span>Musik</span><input type="range" min="0" max="100" step="5" data-k="musik" value="${pct(o.musik)}"></label>
        </div>`;
      const knap = n.querySelector('.hl-knap');
      const vis = (fra) => n.classList.toggle('fra', fra);
      vis(o.fra);
      knap.onclick = () => { const fra = !n.classList.contains('fra'); vis(fra); o.vedFra?.(fra); knap.blur(); };
      n.querySelectorAll('input').forEach((i) => {
        i.oninput = () => (i.dataset.k === 'lyd' ? o.vedLyd : o.vedMusik)?.(i.value / 100);
        i.onkeydown = (e) => e.stopPropagation();       // piletasterne styrer skyderen, ikke kunden
      });
      rod.appendChild(n);
      return { saetFra: vis };
    },

    /** Helbredelse popper op over kunden som et grønt tal. */
    helbredTal(b, tal, r) {
      const p = r.tilSkaerm(b.x, b.y + ETIKET_WU);
      const n = document.createElement('div');
      n.className = 'skadetal plus num';
      n.textContent = `+${tal}`;
      n.style.left = `${p.x | 0}px`;
      const e = etiketPulje.get(b.id);
      n.style.top = `${talAnker(p.y, e?.offsetHeight) | 0}px`;   // over skiltet
      el.etiketter.appendChild(n);
      setTimeout(() => n.remove(), 1700);
      // Fyldet blinker (sjældent, så den genstartede animation er billig).
      if (e) { e.classList.remove('helbredt'); void e.offsetWidth; e.classList.add('helbredt'); }
    },

    /** Skaden popper op over kunden som et rødt tal. */
    skadeTal(b, tal, r) {
      const p = r.tilSkaerm(b.x, b.y + ETIKET_WU);
      const n = document.createElement('div');
      n.className = 'skadetal num';
      n.textContent = `−${tal}`;
      n.style.left = `${p.x | 0}px`;
      n.style.top = `${talAnker(p.y, etiketPulje.get(b.id)?.offsetHeight) | 0}px`;   // over skiltet
      if (tal >= 30) n.classList.add('stor');
      el.etiketter.appendChild(n);
      setTimeout(() => n.remove(), 1700);
    },

    /** Et banner ad gangen. Kommer et nyt, mens det forrige kun har stået
     *  kort (flere meddelelser i samme tick, fx ved turskiftet), venter det
     *  i en lille kø i stedet for at overskrive det usete. */
    banner(tekst, ms = 2200, klasse = '') {
      const nu = performance.now();
      const b = el.banner;
      b._koe ||= [];
      if (b._vist && nu - b._vist < 700 && !b.classList.contains('hide')) {
        if (b._tekst !== tekst && !b._koe.some((x) => x.tekst === tekst) && b._koe.length < 3) {
          b._koe.push({ tekst, ms, klasse });
        }
        return;
      }
      const vis = (t, varighed, k) => {
        b.className = `banner ${k}`;
        b.textContent = t;
        b._tekst = t;
        b._vist = performance.now();
        clearTimeout(b._t);
        // Venter der noget, får det aktuelle mindst 1,6 s, så det kan læses.
        b._t = setTimeout(function naeste() {
          const n = b._koe.shift();
          if (n) vis(n.tekst, n.ms, n.klasse);
          else b.classList.add('hide');
        }, b._koe.length ? Math.min(varighed, 1600) : varighed);
      };
      vis(tekst, ms, klasse);
    },

    net(tekst, vis = true) {
      el.net.textContent = tekst || '';
      el.net.classList.toggle('hide', !vis || !tekst);
    },

    ryd() {
      bundMaaler?.disconnect(); rod.innerHTML = ''; etiketPulje.clear();
      holdRader.clear(); holdTotal.length = 0; holdSig.n = -1; ak.t = null; ak.tekst = null;
    },
  };
}
