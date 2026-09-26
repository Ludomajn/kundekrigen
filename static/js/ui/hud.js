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
import { MAKS_HP } from '../sim/entities.js';
import { HZ } from '../core/tick.js';

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

  const etiketPulje = new Map();
  // Den tålmodighed, der VISES. Skaden holdes tilbage, til skuddet er
  // afviklet, og tælles så ned (main.js styrer det); indtil da er det b.hp.
  let visHp = (b) => b.hp;
  const ramte = new Set();
  let sidsteVaaben = null, sidsteVind = null, sidsteHoldSignatur = '';

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
      const b = v.aktivBaever();
      el.bund.classList.toggle('tilskuer', !minTur);
      // Også på roden: arsenalskuffen (#panel) er en søster til #hud og skjules
      // i CSS ud fra den, præcis som bjælken.
      rod.classList.toggle('hud-tilskuer', !minTur);
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
      const sig = v.baevere.map((x) => `${x.id}:${visHp(x)}:${x.doed && visHp(x) <= 0 ? 1 : 0}` +
                                       `:${x.skjold ? 1 : 0}${x.springOver ? 1 : 0}${x.smittet > 0 ? 1 : 0}`).join(',')
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
                  <span class="hb-status">${statusIkoner(x)}</span>
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

    ryd() { bundMaaler?.disconnect(); rod.innerHTML = ''; etiketPulje.clear(); },
  };
}
