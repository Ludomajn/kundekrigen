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

import { T, esc, mmss, VEJR_NAVN } from './tekst.js';
import { HOLD, HOLD_ORDEN, holdFarve } from '../render/palette.js';
import { VAABEN } from '../sim/weapons.js';
import { FAVORIT_LABELS } from './keyboard.js';
import { ikonHTML } from './vaabenikoner.js';
import { MAKS_HP } from '../sim/entities.js';
import { HZ } from '../core/tick.js';

export function lavHud(rod, r) {
  rod.innerHTML = `
    <div class="hud-top">
      <div class="hud-aktiv" id="hudAktiv"></div>
      <div class="hud-ure">
        <div class="tururet num" id="hudTur">30</div>
        <div class="kamptid num" id="hudKamp">30:00</div>
        <div class="sudden hide" id="hudSudden">${T.spil.pludseligDoed}</div>
      </div>
      <div class="hud-vind" id="hudVind"></div>
    </div>

    <div class="hud-hold" id="hudHold"></div>

    <div class="hud-bund" id="hudBund">
      <div class="hud-vaaben" id="hudVaaben"></div>
      <div class="kraftbar hide" id="hudKraft"><i></i></div>
      <div class="favoritbar" id="hudFavorit"></div>
    </div>

    <div class="etiketter" id="hudEtiketter"></div>
    <div class="banner hide" id="hudBanner"></div>
    <div class="netstatus hide" id="hudNet"></div>
  `;

  const $ = (id) => rod.querySelector('#' + id);
  const el = {
    aktiv: $('hudAktiv'), tur: $('hudTur'), kamp: $('hudKamp'), sudden: $('hudSudden'),
    vind: $('hudVind'), hold: $('hudHold'), vaaben: $('hudVaaben'),
    bund: $('hudBund'), kraft: $('hudKraft'), favorit: $('hudFavorit'), etiketter: $('hudEtiketter'),
    banner: $('hudBanner'), net: $('hudNet'),
  };

  const etiketPulje = new Map();
  // Den tålmodighed, der VISES. Skaden holdes tilbage, til skuddet er
  // afviklet, og tælles så ned (main.js styrer det); indtil da er det b.hp.
  let visHp = (b) => b.hp;
  const ramte = new Set();
  let favoritter = [];
  let sidsteVaaben = null, sidsteVind = null, sidsteHoldSignatur = '';

  function byggFavoritter(liste, holdIdx, ammo) {
    favoritter = liste;
    el.favorit.innerHTML = liste.map((id, i) => {
      const w = VAABEN[id];
      if (!w) return '';
      return `<button class="fav" data-vaaben="${esc(id)}" title="${esc(w.navn)} — ${esc(w.hjaelp || '')}">
        <span class="favtast">${FAVORIT_LABELS[i]}</span>
        ${ikonHTML(w, 'favikon')}
        <span class="favnavn">${esc(w.navn)}</span>
        <span class="favammo num" data-ammo="${esc(id)}"></span>
      </button>`;
    }).join('');
  }

  return {
    el,
    byggFavoritter,

    /** Kaldes hver frame. Holder sig til at skrive tekstnoder der har ændret sig. */
    /** minTur: den lokale spiller styrer den aktive kunde. Ellers er man
     *  tilskuer og ser kun, hvad den aktive har i hånden — ikke en
     *  våbenbjælke, man alligevel ikke kan bruge. */
    opdater(v, egenPid, tilstandTekst, oplader = false, kraft = 0, minTur = true) {
      const b = v.aktivBaever();
      el.bund.classList.toggle('tilskuer', !minTur);
      const hold = b ? holdFarve(b.hold) : null;

      // --- aktiv bæver
      if (b) {
        const dinTur = egenPid && (b.ejer === egenPid || v.pidPaaHold?.(egenPid, b.hold));
        el.aktiv.className = `hud-aktiv ${dinTur ? 'dinTur' : ''}`;
        el.aktiv.innerHTML = `
          <span class="holdprik" style="background:${hold.css}"></span>
          <span class="aktivnavn">${esc(b.navn)}</span>
          ${dinTur ? `<span class="dintur-mark" style="background:${hold.css};color:${hold.tekst}">DIN TUR</span>` : ''}
          <span class="hpbar"><i style="width:${Math.min(100, Math.max(0, visHp(b)))}%;background:${hold.css}"></i></span>
          <span class="hptal num">${visHp(b)}</span>`;
      } else {
        el.aktiv.textContent = tilstandTekst || T.spil.venter;
      }

      // --- ure
      const iTilbagetog = v.tur.retreatTil !== null && v.tick < v.tur.retreatTil &&
                          v.tur.tilstand === 'oploesning';
      if (iTilbagetog) {
        el.tur.textContent = Math.ceil((v.tur.retreatTil - v.tick) / HZ);
        el.tur.classList.add('tilbagetog');
      } else {
        el.tur.textContent = Math.max(0, Math.ceil(v.tur.tickTilbage / HZ));
        el.tur.classList.remove('tilbagetog');
      }
      const kampTilbage = Math.max(0, v.cfg.kampTicks - v.tick) / HZ;
      el.kamp.textContent = mmss(kampTilbage);
      el.sudden.classList.toggle('hide', !v.pludseligDoed);

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
      const sig = v.baevere.map((x) => `${x.id}:${visHp(x)}:${x.doed && visHp(x) <= 0 ? 1 : 0}`).join(',')
                + `|${v.tur.baeverId}|${egenPid}`;
      if (sig !== sidsteHoldSignatur) {
        sidsteHoldSignatur = sig;
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
            const levende = liste.filter((x) => !x.doed).length;
            const total = liste.reduce((s, x) => s + Math.max(0, visHp(x)), 0);
            const aktivtHold = v.tur.holdIdx === hid;
            const mitHold = liste.some(mit);
            return `<div class="holdkort ${aktivtHold ? 'aktivt' : ''} ${mitHold ? 'mit' : ''}"
                         style="--hf:${f.css}">
              <div class="holdnavn">
                <span class="hn-prik"></span>
                <span class="hn-tekst">${esc(f.navn)}</span>
                ${mitHold ? '<span class="hn-dig">DIG</span>' : ''}
                <span class="hn-tal num">${levende}<i>/${liste.length}</i></span>
                <span class="hn-hp num">${total}</span>
              </div>
              ${liste.map((x) => {
                const erAktiv = x.id === v.tur.baeverId && !x.doed;
                return `<div class="hbaever ${x.doed ? 'doed' : ''} ${erAktiv ? 'aktiv' : ''} ${mit(x) ? 'egen' : ''}">
                  <span class="hb-markoer">${erAktiv ? '<svg viewBox="0 0 64 40"><use href="#i-arrow"/></svg>' : ''}</span>
                  <span class="hbnavn">${esc(x.navn)}</span>
                  <span class="hbbar"><i style="width:${Math.min(100, Math.max(0, visHp(x)))}%"></i></span>
                  <span class="hb-hp num">${Math.max(0, visHp(x))}</span>
                </div>`;
              }).join('')}
            </div>`;
          }).join('');
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
            <span>${T.spil.ammo}: <b class="num">${ammo < 0 ? T.spil.ubegraenset : ammo}</b></span>
            ${w.lunte ? `<span>${T.spil.lunte}: <b class="num">${v.valgtLunte}s</b></span>` : ''}
          </div>` : '';
        if (b) {
          for (const n of el.favorit.querySelectorAll('[data-ammo]')) {
            const a = v.ammoFor(b.hold, n.dataset.ammo);
            n.textContent = a < 0 ? '' : a;
            n.parentElement.classList.toggle('tom', a === 0);
            n.parentElement.classList.toggle('valgt', n.dataset.ammo === v.valgtVaaben);
          }
        }
      }

      // --- opladningsbar. Måles lokalt, så bjælken reagerer med det samme
      // og ikke først når værtens tilstand er nået hjem igen.
      el.kraft.classList.toggle('hide', !oplader);
      if (oplader) el.kraft.firstElementChild.style.width = `${(kraft * 100).toFixed(0)}%`;

      v.egenPid = egenPid;
      this.opdaterEtiketter(v, r);
    },

    /** Flydende navne- og HP-etiketter. Alle læsninger først, så alle
     *  skrivninger — og transform, aldrig left/top. */
    opdaterEtiketter(v, r) {
      const set = new Set();
      const maal = [];
      for (const b of v.baevere) {
        if (b.doed) continue;
        set.add(b.id);
        const x = b.x, y = b.y;           // samme interpolerede position som figuren
        maal.push({ b, p: r.tilSkaerm(x, y + 74) });
      }
      for (const { b, p } of maal) {
        let n = etiketPulje.get(b.id);
        if (!n) {
          n = document.createElement('div');
          n.className = 'etiket';
          const f = holdFarve(b.hold);
          n.style.background = f.css;
          n.style.color = f.tekst;
          n.innerHTML = `<span class="enavn"></span><span class="ehp num"></span>`;
          el.etiketter.appendChild(n);
          etiketPulje.set(b.id, n);
        }
        const synlig = p.x > -80 && p.y > -40 &&
                       p.x < window.innerWidth + 80 && p.y < window.innerHeight + 40;
        n.style.visibility = synlig ? 'visible' : 'hidden';
        if (!synlig) continue;
        n.style.transform = `translate3d(${p.x | 0}px, ${p.y | 0}px, 0) translate(-50%, -100%)`;
        const nv = n.firstElementChild, hp = n.lastElementChild;
        if (nv.textContent !== b.navn) nv.textContent = b.navn;
        const s = String(Math.max(0, visHp(b)));
        if (hp.textContent !== s) hp.textContent = s;
        n.classList.toggle('ramt', ramte.has(b.id));
        n.classList.toggle('aktiv', b.id === v.tur.baeverId);
        n.classList.toggle('egen', !!(v.egenPid && (b.ejer === v.egenPid ||
                                       v.pidPaaHold?.(v.egenPid, b.hold))));
      }
      for (const [id, n] of etiketPulje) {
        if (!set.has(id)) { n.remove(); etiketPulje.delete(id); }
      }
    },

    saetVisHp(fn) { visHp = fn; },
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
      const p = r.tilSkaerm(b.x, b.y + 58);
      const n = document.createElement('div');
      n.className = 'skadetal plus num';
      n.textContent = `+${tal}`;
      n.style.left = `${p.x | 0}px`;
      n.style.top = `${p.y | 0}px`;
      el.etiketter.appendChild(n);
      setTimeout(() => n.remove(), 1700);
    },

    /** Skaden popper op over kunden som et rødt tal. */
    skadeTal(b, tal, r) {
      const p = r.tilSkaerm(b.x, b.y + 58);
      const n = document.createElement('div');
      n.className = 'skadetal num';
      n.textContent = `−${tal}`;
      n.style.left = `${p.x | 0}px`;
      n.style.top = `${p.y | 0}px`;
      if (tal >= 30) n.classList.add('stor');
      el.etiketter.appendChild(n);
      setTimeout(() => n.remove(), 1700);
    },

    banner(tekst, ms = 2200, klasse = '') {
      el.banner.className = `banner ${klasse}`;
      el.banner.textContent = tekst;
      clearTimeout(el.banner._t);
      el.banner._t = setTimeout(() => el.banner.classList.add('hide'), ms);
    },

    net(tekst, vis = true) {
      el.net.textContent = tekst || '';
      el.net.classList.toggle('hide', !vis || !tekst);
    },

    ryd() { rod.innerHTML = ''; etiketPulje.clear(); },
  };
}
