/* Kundekrigen — menuer, lobby og opsætning.
 *
 * Alt er DOM oven på three-lærredet, så spillets CSS arves direkte og
 * tastaturnavigation kommer gratis.
 *
 * Lobbyen er karaktervalget (ui/karaktervalg.js): en skærm for sig, der
 * bygges én gang og derefter opdateres på stedet ved hver lobbybesked.
 *
 * Bemærk `afslut`: JavaScript må ikke lukke en fane, brugeren ikke selv har
 * åbnet. Punktet fører derfor til et afslutningsskærmbillede — ikke til et
 * window.close() der ville fejle lydløst i alle moderne browsere.
 */
'use strict';

import { T, esc } from './tekst.js';
import { menuNav } from './keyboard.js';
import { holdFarve } from '../render/palette.js';
import { indlaesProfil } from './customise.js';
import { lavKaraktervalg } from './karaktervalg.js';

const LOGO = `
  <div class="logo">
    <svg viewBox="0 0 64 40" fill="currentColor" aria-hidden="true"><use href="#i-logo"/></svg>
    <div>
      <div class="wordmark">${T.titel}</div>
      <div class="payoff">${T.payoff}</div>
    </div>
  </div>`;

export function lavMenu(rod, api) {
  let nav = null;
  let skaerm = 'start';
  let profil = indlaesProfil();
  let kv = null;                  // karaktervalget, mens lobbyen er fremme
  let lobbyNu = null;             // seneste lobbybesked (også mens Indstillinger er åben)
  let kvGemt = null;              // karaktervalgets trin og markør, mens Indstillinger er åben
  let indstFraLobby = false;
  let indstTast = null;           // Indstillingers egne taster (navnefeltet), mens de er fremme

  /** Et tekstfelt, der forsvinder med fokus, får ikke altid blur: slip det
   *  først, så spillets taster slås til igen (api.tekstfelt(false)). */
  const slipTekstfelt = () => {
    const a = document.activeElement;
    if (a && rod.contains(a) && a.matches?.('input[type=text]')) a.blur();
  };

  const skift = (navn, ...a) => {
    if (navn === 'lobby') {
      if (a[0]) lobbyNu = a[0];
      // Samme skærm: opdatér på stedet, så trin, markør og fokus bliver.
      // a[1] er { trin } (Spil igen: 'klar'), som også gælder her.
      if (skaerm === 'lobby' && kv) { kv.opdater(lobbyNu, a[1]); return; }
    }
    slipTekstfelt();
    if (kv) {
      kvGemt = navn === 'indstillinger' ? kv.gem() : null;
      kv.fjern(); kv = null;
    }
    skaerm = navn;
    nav?.fjern(); nav = null; indstTast = null;
    ({
      start: visStart, netvaerk: visNetvaerk, deltag: visDeltag,
      indstillinger: visIndstillinger, lobby: visLobby, pause: visPause,
      sejr: visSejr, afslut: visAfslut, forbinder: visForbinder,
    })[navn](...a);
  };

  /* Lydskyderne: effekter (lyde og stemmer) og musik. Ligger i menulisten,
   * så ↑↓ når dem som alt andet, og ←→ skruer op og ned. */
  function lydSkydere() {
    const vaerdi = (k, std) => Math.round((profil.indstillinger?.[k] ?? std) * 100);
    const raekke = (k, navn, std) => `
      <label class="lyd-raekke lydskyder">
        <span class="lbl">${navn}</span>
        <input data-nav type="range" data-lyd="${k}" min="0" max="100" step="5" value="${vaerdi(k, std)}"
               aria-label="${navn}">
        <span class="num">${vaerdi(k, std)} %</span>
      </label>`;
    return `<div class="lydpanel">${raekke('lyd', 'Effekter', 0.7)}${raekke('musik', 'Musik', 1)}</div>`;
  }

  function koblLydSkydere() {
    rod.querySelectorAll('input[data-lyd]').forEach((n) => {
      n.oninput = () => {
        const k = n.dataset.lyd, v = n.value / 100;
        profil.indstillinger = { ...(profil.indstillinger || {}), [k]: v };
        n.nextElementSibling.textContent = `${n.value} %`;
        if (k === 'lyd') api.lydAendret?.(v); else api.musikAendret?.(v);
        api.profilAendret?.(profil);
      };
    });
  }

  function ramme(indhold, klasse = '') {
    rod.className = `menu ${klasse}`;
    rod.innerHTML = `<div class="menukort">${LOGO}${indhold}</div>`;
    rod.classList.remove('hide');
  }

  // ---------------------------------------------------------------- start

  function visStart() {
    ramme(`
      <nav class="menuliste" id="ml">
        <button data-nav class="mpunkt" id="mLokal">${T.menu.lokalt}</button>
        <button data-nav class="mpunkt" id="mNet">${T.menu.netvaerk}</button>
        <button data-nav class="mpunkt" id="mOpt">${T.menu.indstillinger}</button>
        <button data-nav class="mpunkt" id="mExit">${T.menu.afslut}</button>
        ${lydSkydere()}
      </nav>
      <p class="menufod">Piletaster vælger · Enter bekræfter · ←→ skruer på lyden</p>`);
    koblLydSkydere();
    rod.querySelector('#mLokal').onclick = () => api.startLokalt(profil);
    rod.querySelector('#mNet').onclick = () => skift('netvaerk');
    rod.querySelector('#mOpt').onclick = () => skift('indstillinger');
    rod.querySelector('#mExit').onclick = () => skift('afslut');
    nav = menuNav(rod.querySelector('#ml'));
  }

  function visNetvaerk() {
    ramme(`
      <h2>${T.menu.netvaerk}</h2>
      <nav class="menuliste" id="ml">
        <button data-nav class="mpunkt" id="mHost">${T.menu.vaert}</button>
        <button data-nav class="mpunkt" id="mJoin">${T.menu.deltag}</button>
        <button data-nav class="mpunkt sek" id="mBack">${T.menu.tilbage}</button>
      </nav>`);
    rod.querySelector('#mHost').onclick = () => api.vaerRum(profil);
    rod.querySelector('#mJoin').onclick = () => skift('deltag');
    rod.querySelector('#mBack').onclick = () => skift('start');
    nav = menuNav(rod.querySelector('#ml'), { tilbage: () => skift('start') });
  }

  // ---------------------------------------------------------------- deltag

  function visDeltag() {
    ramme(`
      <h2>${T.menu.deltag}</h2>
      <label class="felt">
        <span class="lbl">${T.net.indtastKode}</span>
        <input type="text" id="jKode" maxlength="5" autocomplete="off"
               spellcheck="false" class="kodefelt" placeholder="ABCDE">
      </label>
      <div class="fejl hide" id="jFejl"></div>
      <nav class="menuliste" id="ml">
        <button data-nav class="mpunkt" id="mGo">${T.menu.deltag}</button>
        <button data-nav class="mpunkt sek" id="mBack">${T.menu.tilbage}</button>
      </nav>
      <div class="rumliste" id="jRum"><span class="lbl">${T.net.aabneRum}</span><div>…</div></div>`);

    const felt = rod.querySelector('#jKode');
    felt.oninput = () => { felt.value = felt.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    felt.onfocus = () => api.tekstfelt(true);
    felt.onblur = () => api.tekstfelt(false);
    felt.onkeydown = (e) => {
      if (e.code === 'Enter') { e.preventDefault(); gaa(); }
      e.stopPropagation();
    };
    const gaa = () => {
      const k = felt.value.trim();
      if (k.length < 5) return visFejl('Koden er fem tegn.');
      api.tilslutRum(k, profil);
    };
    rod.querySelector('#mGo').onclick = gaa;
    rod.querySelector('#mBack').onclick = () => skift('netvaerk');
    nav = menuNav(rod.querySelector('#ml'), { tilbage: () => skift('netvaerk') });
    setTimeout(() => felt.focus(), 40);

    fetch('/api/rum').then((r) => r.json()).then((d) => {
      const boks = rod.querySelector('#jRum');
      if (!boks) return;
      if (!d.rum?.length) {
        boks.innerHTML = `<span class="lbl">${T.net.aabneRum}</span><div class="tom">${T.net.ingenRum}</div>`;
        return;
      }
      boks.innerHTML = `<span class="lbl">${T.net.aabneRum}</span>` + d.rum.map((r) =>
        `<button class="rumknap" data-kode="${esc(r.kode)}">
           <b>${esc(r.kode)}</b> <span>${esc(r.vaert)} · ${r.deltagere} deltagere</span>
         </button>`).join('');
      boks.querySelectorAll('[data-kode]').forEach((n) => {
        n.onclick = () => api.tilslutRum(n.dataset.kode, profil);
      });
    }).catch(() => {});
  }

  function visFejl(t) {
    // Deltag-skærmen har sin egen fejllinje; i lobbyen bruges statuslinjen.
    const f = rod.querySelector('#jFejl') || rod.querySelector('#lStatus');
    if (!f) return;
    f.textContent = t;
    f.classList.remove('hide');
    f.classList.add('advarsel');
  }

  function visForbinder(tekst) {
    ramme(`<h2>${esc(tekst || T.net.forbinder)}</h2><div class="spinner"></div>`);
  }

  // ---------------------------------------------------------------- indstillinger

  function visIndstillinger(fraLobby = false) {
    indstFraLobby = fraLobby;
    ramme(`
      <h2>${T.menu.indstillinger}</h2>
      <div class="opt-kolonner">
        <section class="opt-boks">
          <h3>Dit navn</h3>
          <label class="felt">
            <span class="lbl">Det navn, de andre ser i rummet</span>
            <input type="text" id="optNavn" maxlength="20" autocomplete="off" spellcheck="false"
                   placeholder="Spiller" value="${esc(profil.spillernavn || '')}">
          </label>
          <p class="menufod">Gælder fra næste rum, du opretter eller går ind i. ↑ fra Tilbage skriver i feltet.</p>
        </section>
        <section class="opt-boks">
          <h3>Lyd</h3>
          ${lydSkydere()}
        </section>
        <section class="opt-boks">
          <h3>Visning</h3>
          <label class="lyd-raekke lydskyder">
            <span class="lbl">UI-størrelse</span>
            <input type="range" id="optUi" min="75" max="150" step="5"
                   value="${Math.round((profil.indstillinger?.ui ?? 1) * 100)}" aria-label="UI-størrelse">
            <span class="num" id="optUiTal">${Math.round((profil.indstillinger?.ui ?? 1) * 100)} %</span>
          </label>
          <p class="menufod">Du kan også bruge browserens zoom: Ctrl/⌘ + og −.</p>
        </section>
        <section class="opt-boks">
          <h3>Sigte</h3>
          <label class="lyd-raekke">
            <input type="checkbox" id="optSigte" ${profil.indstillinger?.sigteassistent ? 'checked' : ''}>
            <span class="lbl">Sigtehjælp — vis hele banekurven (gør det meget lettere)</span>
          </label>
        </section>
        <section class="opt-boks">
          <h3>${T.taster.titel}</h3>
          <table class="tastetabel">
            ${[
              ['← →', T.taster.gaa], ['↑ ↓', T.taster.sigt], ['Shift + ↑↓', T.taster.finsigte],
              ['Mellemrum', T.taster.ladOp], ['Enter', T.taster.hop], ['Backspace', T.taster.salto],
              ['1…0', T.taster.favorit], ['Tab', T.taster.panel], ['Shift + 1…0', T.taster.bind],
              ['Q / E', T.taster.cykl],
              ['F', T.taster.lunte], ['T', T.taster.naesteFjende], ['W A S D', T.taster.panorer],
              ['C', T.taster.centrer], ['Z / X', T.taster.zoom], ['H', T.taster.kig],
              ['K', T.taster.staaOver], ['Esc', T.taster.pause],
            ].map(([k, v]) => `<tr><td class="tast">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
          </table>
        </section>
      </div>
      <nav class="menuliste vandret" id="ml">
        <button data-nav class="mpunkt sek" id="mBack">${T.menu.tilbage}</button>
      </nav>`);

    const sigteValg = rod.querySelector('#optSigte');
    sigteValg.onchange = () => {
      profil.indstillinger = { ...(profil.indstillinger || {}), sigteassistent: sigteValg.checked };
      api.profilAendret?.(profil);
    };
    koblLydSkydere();
    const uiSkyder = rod.querySelector('#optUi');
    uiSkyder.onchange = uiSkyder.oninput = () => {
      const v = uiSkyder.value / 100;
      profil.indstillinger = { ...(profil.indstillinger || {}), ui: v };
      rod.querySelector('#optUiTal').textContent = `${uiSkyder.value} %`;
      api.uiAendret?.(v);
      api.profilAendret?.(profil);
    };
    rod.querySelector('#mBack').onclick = () => skift(fraLobby ? 'lobby' : 'start');
    nav = menuNav(rod.querySelector('#ml'), { tilbage: () => skift(fraLobby ? 'lobby' : 'start') });
    koblNavnefelt(rod.querySelector('#optNavn'));      // efter menuNav: dens ↑ må ikke tage fokus tilbage
  }

  /* "Dit navn": profil.spillernavn, som rummet får, når man opretter eller
   * går ind i et. Mens der skrives, er spillets taster slået fra
   * (api.tekstfelt), og tasterne går ikke videre til tastaturet — som i
   * Deltag. ↑ fra Tilbage går ind i feltet; Enter, ↓ og Esc (fortryd) ud igen. */
  function koblNavnefelt(felt) {
    let foer = felt.value;
    const gem = () => {
      const navn = felt.value.trim().slice(0, 20);
      if (navn === (profil.spillernavn || '')) return;
      profil.spillernavn = navn;
      api.profilAendret?.(profil);
    };
    const ud = () => { nav?.marker(); if (document.activeElement === felt) felt.blur(); };
    felt.onfocus = () => { foer = felt.value; api.tekstfelt?.(true); };
    felt.onblur = () => { felt.value = felt.value.trim(); gem(); api.tekstfelt?.(false); };
    felt.oninput = gem;
    felt.onkeydown = (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'ArrowDown') { e.preventDefault(); ud(); }
      else if (e.code === 'Escape') { e.preventDefault(); felt.value = foer; gem(); ud(); }
    };
    // ↑ på Tilbage (menulisten har kun den ene knap).
    rod.querySelector('#ml').addEventListener('keydown', (e) => {
      if (e.code === 'ArrowUp') { e.preventDefault(); felt.focus(); }
    });
    indstTast = (e) => {
      if (e.code !== 'ArrowUp' || document.activeElement === felt) return false;
      felt.focus();
      return true;
    };
  }

  // ---------------------------------------------------------------- lobby

  /** o.trin: trinnet, skærmen åbner på (Spil igen: 'klar'). */
  function visLobby(tilstand = lobbyNu, o = {}) {
    if (!tilstand) return;
    lobbyNu = tilstand;
    rod.className = 'menu kv-menu';
    rod.innerHTML = '';
    rod.classList.remove('hide');
    kv = lavKaraktervalg(rod, api, { indstillinger: () => skift('indstillinger', true), gemt: kvGemt, trin: o?.trin });
    kvGemt = null;
    kv.opdater(tilstand);
  }

  // ---------------------------------------------------------------- pause / sejr

  function visPause() {
    ramme(`
      <h2>Pause</h2>
      <nav class="menuliste" id="ml">
        <button data-nav class="mpunkt" id="pFort">Fortsæt</button>
        <button data-nav class="mpunkt" id="pOpt">${T.menu.indstillinger}</button>
        <button data-nav class="mpunkt sek" id="pForlad">Forlad kampen</button>
        ${lydSkydere()}
      </nav>
      <p class="menufod">I netværksspil kører kampen videre, mens du er i pause.</p>`);
    koblLydSkydere();
    rod.querySelector('#pFort').onclick = () => api.fortsaet();
    rod.querySelector('#pOpt').onclick = () => skift('indstillinger');
    rod.querySelector('#pForlad').onclick = () => api.forlad();
    nav = menuNav(rod.querySelector('#ml'), { tilbage: () => api.fortsaet() });
  }

  function visSejr(res) {
    const vinder = res.vinder !== null && res.vinder !== undefined ? holdFarve(res.vinder) : null;
    ramme(`
      <h2 class="sejrtitel">${vinder ? esc(T.spil.sejr(vinder.navn)) : T.spil.uafgjort}</h2>
      ${vinder ? `<div class="sejrbaand" style="background:${vinder.css}"></div>` : ''}
      <table class="stilling">
        <thead><tr><th>Klinik</th><th>Kunder</th><th>Tålmodighed</th></tr></thead>
        <tbody>
          ${(res.stilling || []).map((s) => {
            const f = holdFarve(s.hold);
            return `<tr><td><span class="holdprik" style="background:${f.css}"></span>${esc(f.navn)}</td>
              <td class="num">${s.levende}</td><td class="num">${s.hp}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
      <nav class="menuliste" id="ml">
        <button data-nav class="mpunkt" id="sIgen">Spil igen</button>
        <button data-nav class="mpunkt sek" id="sMenu">Til menuen</button>
      </nav>`);
    rod.querySelector('#sIgen').onclick = () => api.spilIgen();
    rod.querySelector('#sMenu').onclick = () => api.forlad();
    nav = menuNav(rod.querySelector('#ml'));
  }

  function visAfslut() {
    // Ingen window.close(): browseren tillader ikke at lukke en fane, som
    // scriptet ikke selv har åbnet, og forsøget ville fejle lydløst.
    ramme(`
      <h2>${T.afslut.titel}</h2>
      <p class="afslutTekst">${T.afslut.tekst}</p>
      <nav class="menuliste" id="ml">
        <button data-nav class="mpunkt" id="aNy">${T.afslut.nyKamp}</button>
      </nav>`);
    rod.querySelector('#aNy').onclick = () => skift('start');
    nav = menuNav(rod.querySelector('#ml'));
  }

  return {
    get skaerm() { return skaerm; },
    get profil() { return profil; },
    saetProfil(p) { profil = p; },
    skift,
    skjul() {
      slipTekstfelt();
      rod.classList.add('hide'); nav?.fjern(); nav = null; skaerm = null; indstTast = null;
      kv?.fjern(); kv = null; kvGemt = null;
    },
    /**
     * Vis en skærm. Lobbyen: menu.vis('lobby', tilstand) opdaterer karakter-
     * valget på stedet; menu.vis('lobby', tilstand, { trin: 'klar' }) åbner
     * det (eller går, hvis det er fremme) direkte på Klar-trinnet (Spil igen).
     */
    vis(navn, ...a) {
      // Lobbyen opdateres ofte (de andres valg). Står spilleren i
      // Indstillinger fra lobbyen, gemmes beskeden til han går tilbage —
      // medmindre nedtællingen er i gang: den skal han se.
      if (navn === 'lobby' && skaerm === 'indstillinger' && indstFraLobby && a[0]?.nedtaelling_ms == null) {
        lobbyNu = a[0] || lobbyNu;
        return;
      }
      skift(navn, ...a);
    },
    fejl(t) {
      if (skaerm === 'lobby' && kv) kv.fejl(t);
      else visFejl(t);
    },
    tast(e) {
      if (skaerm === 'lobby' && kv) return kv.tast(e);
      if (skaerm === 'indstillinger' && indstTast) return indstTast(e);
      return false;
    },
  };
}
