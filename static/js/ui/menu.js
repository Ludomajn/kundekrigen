/* Kundekrigen — menuer, lobby og opsætning.
 *
 * Alt er DOM oven på three-lærredet, så spillets CSS arves direkte og
 * tastaturnavigation kommer gratis.
 *
 * Bemærk `afslut`: JavaScript må ikke lukke en fane, brugeren ikke selv har
 * åbnet. Punktet fører derfor til et afslutningsskærmbillede — ikke til et
 * window.close() der ville fejle lydløst i alle moderne browsere.
 */
'use strict';

import { T, esc, VEJR_NAVN, BANE_NAVN } from './tekst.js';
import { menuNav } from './keyboard.js';
import { holdFarve, HOLD_ORDEN, HOLD } from '../render/palette.js';
import { lavEditor, indlaesProfil, gemProfil } from './customise.js';
import { BANE_TYPER } from '../sim/terrain_gen.js';
import { VEJRTYPER } from '../sim/turn.js';

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
  let editor = null;
  let skaerm = 'start';
  let profil = indlaesProfil();

  const skift = (navn, ...a) => {
    skaerm = navn;
    nav?.fjern(); nav = null; editor = null;
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
    ramme(`
      <h2>${T.menu.indstillinger}</h2>
      <div class="opt-kolonner">
        <section class="opt-boks">
          <h3>Dine sure kunder</h3>
          <div class="editor" id="edRod"></div>
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

    editor = lavEditor(rod.querySelector('#edRod'), profil, 0, (p) => { profil = p; api.profilAendret?.(p); });
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
    rod.addEventListener('tekstfelt', (e) => api.tekstfelt(e.detail));
    rod.querySelector('#mBack').onclick = () => skift(fraLobby ? 'lobby' : 'start');
    nav = menuNav(rod.querySelector('#ml'), { tilbage: () => skift(fraLobby ? 'lobby' : 'start') });
  }

  // ---------------------------------------------------------------- lobby

  function visLobby(tilstand) {
    const erVaert = tilstand.vaert === tilstand.dig;
    const link = tilstand.kode ? `${location.origin}/spil/${tilstand.kode}` : '';

    ramme(`
      <div class="lobby">
        <header class="lobby-top">
          <div>
            <h2>${T.lobby.titel}</h2>
            ${tilstand.kode ? `
              <div class="rumkode">
                <span class="lbl">${T.lobby.rumkode}</span>
                <b class="kode">${esc(tilstand.kode)}</b>
                <button class="btn sm" id="lKopi">${T.lobby.delLink}</button>
                <span class="kopieret hide" id="lKopieret">${T.lobby.kopieret}</span>
              </div>
              <div class="linkvis">${esc(link)}</div>` : '<div class="lbl">Lokalt spil</div>'}
          </div>
          <div class="lobby-handling">
            ${erVaert
              ? `<div class="lobby-start">
                   <button class="btn pri stor" id="lStart">${T.menu.start}</button>
                   <button class="btn stor" id="lRandom" title="Tilfældig bane, banetype, vejr, vind, turtid og kamplængde — klinikker og kunder beholdes">🎲 Random kamp</button>
                 </div>
                 <div class="venter" id="lStatus">${(() => {
                   // Serveren kræver, at alle andre har trykket Klar. Sig det
                   // HER, i stedet for at startknappen tavst ikke gør noget.
                   const mangler = tilstand.deltagere.filter((d) =>
                     d.pid !== tilstand.vaert && !d.tilskuer && d.forbundet !== false && !d.klar).length;
                   return mangler ? `Venter på, at ${mangler} deltager${mangler > 1 ? 'e' : ''} trykker Klar`
                                  : 'Alle er klar';
                 })()}</div>`
              : `<button class="btn pri stor" id="lKlar">${T.menu.klar}</button>
                 <div class="venter">${T.lobby.venterPaaVaert}</div>`}
          </div>
        </header>

        <div class="lobby-krop">
          <section class="lobby-hold">
            ${tilstand.hold.map((h, hi) => {
              const f = holdFarve(hi);
              return `<div class="hold-kort" style="--hf:${f.css}">
                <h3>${esc(f.navn)}</h3>
                ${h.baevere.map((b) => {
                  const mit = b.ejer && b.ejer === tilstand.dig;
                  const ejerNavn = b.ejer
                    ? (tilstand.deltagere.find((d) => d.pid === b.ejer)?.navn || '—')
                    : T.lobby.ledigt;
                  return `<div class="saede ${mit ? 'mit' : ''} ${b.ejer ? '' : 'ledig'}">
                    <span class="sbaever">${esc(b.navn)}</span>
                    <span class="sejer">${esc(ejerNavn)}</span>
                    <button class="btn sm" data-saede="${esc(b.id)}" data-tag="${b.ejer ? '0' : '1'}"
                      ${b.ejer && !mit && !erVaert ? 'disabled' : ''}>
                      ${b.ejer ? (mit || erVaert ? T.lobby.slip : '—') : T.lobby.tag}
                    </button>
                  </div>`;
                }).join('')}
              </div>`;
            }).join('')}
          </section>

          <aside class="lobby-side">
            <div class="lobby-deltagere">
              <span class="lbl">${T.lobby.deltagere} (${tilstand.deltagere.length})</span>
              ${tilstand.deltagere.map((d) => `
                <div class="deltager ${d.forbundet ? '' : 'vaek'}">
                  <span>${esc(d.navn)}</span>
                  ${d.pid === tilstand.vaert ? `<i class="badge">${T.lobby.vaert}</i>` : ''}
                  ${d.tilskuer ? `<i class="badge sek">${T.lobby.tilskuer}</i>` : ''}
                  ${d.forbundet ? '' : `<i class="badge advarsel">${T.lobby.afbrudt}</i>`}
                  ${d.klar ? '<i class="prik-klar"></i>' : ''}
                </div>`).join('')}
            </div>

            <div class="lobby-indst ${erVaert ? '' : 'laast'}">
              <span class="lbl">Kampens regler</span>
              ${raekke('antalHold', T.lobby.antalHold, tilstand.hold.length, [2, 3, 4], erVaert)}
              ${raekke('baevere_pr_hold', T.lobby.baeverePrHold, tilstand.indst.baevere_pr_hold, [1, 2, 3, 4, 5, 6], erVaert)}
              ${raekke('turtid', T.lobby.turtid, tilstand.indst.turtid, [15, 20, 30, 45, 60], erVaert, (v) => v + ' s')}
              ${raekke('kamptid', T.lobby.kamptid, tilstand.indst.kamptid, [600, 1200, 1800, 2700], erVaert, (v) => (v / 60) + ' min')}
              ${raekke('banetype', T.lobby.banetype, tilstand.indst.banetype || 'fort', BANE_TYPER, erVaert, (v) => BANE_NAVN[v])}
              ${raekke('vejr', T.lobby.vejr, tilstand.indst.vejr || 'auto', ['auto', ...VEJRTYPER], erVaert, (v) => VEJR_NAVN[v])}
              ${raekke('vind', T.lobby.vind, tilstand.indst.vind ? 1 : 0, [0, 1], erVaert, (v) => (v ? 'Til' : 'Fra'))}
            </div>

            <button class="btn" id="lOpt">${T.menu.indstillinger}</button>
            <button class="btn sek" id="lForlad">${T.menu.tilbage}</button>
          </aside>
        </div>
      </div>`, 'bred');

    rod.querySelectorAll('[data-saede]').forEach((n) => {
      n.onclick = () => api.saede(n.dataset.saede, n.dataset.tag === '1');
    });
    rod.querySelectorAll('[data-indst]').forEach((n) => {
      n.onclick = () => api.indstilling(n.dataset.indst, n.dataset.v);
    });
    const kopi = rod.querySelector('#lKopi');
    if (kopi) kopi.onclick = async () => {
      try { await navigator.clipboard.writeText(link); } catch { /* ingen adgang */ }
      rod.querySelector('#lKopieret').classList.remove('hide');
    };
    const start = rod.querySelector('#lStart');
    if (start) start.onclick = () => api.start();
    const tilfaeldig = rod.querySelector('#lRandom');
    if (tilfaeldig) tilfaeldig.onclick = () => api.randomStart();
    const klar = rod.querySelector('#lKlar');
    if (klar) klar.onclick = () => api.klar();
    rod.querySelector('#lOpt').onclick = () => skift('indstillinger', true);
    rod.querySelector('#lForlad').onclick = () => api.forlad();
  }

  function raekke(navn, label, vaerdi, valg, kanRedigere, format = (v) => v) {
    return `<div class="ir">
      <span>${esc(label)}</span>
      <div class="ir-valg">
        ${valg.map((v) => `<button class="ir-knap ${String(v) === String(vaerdi) ? 'paa' : ''}"
            data-indst="${esc(navn)}" data-v="${esc(v)}" ${kanRedigere ? '' : 'disabled'}
          >${esc(format(v))}</button>`).join('')}
      </div>
    </div>`;
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
    skjul() { rod.classList.add('hide'); nav?.fjern(); nav = null; skaerm = null; },
    vis(navn, ...a) { skift(navn, ...a); },
    fejl: visFejl,
    tast(e) {
      if (skaerm === 'indstillinger' && editor) return editor.tast(e);
      return false;
    },
  };
}
