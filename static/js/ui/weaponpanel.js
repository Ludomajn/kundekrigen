/* Kundekrigen — arsenalskuffen ("Flere våben", Tab).
 *
 * Bjælken nederst har ti pladser; HELE arsenalet ligger i en skuffe, der
 * glider ind fra venstre OVER spillet. Ikke et centreret modalvindue: man
 * skal stadig kunne se sin kunde, vinden og banen, mens man vælger.
 *
 * Et GITTER, ikke et radialmenu. Radialmenuer er designet til en pegeenhed;
 * at navigere et med piletaster er strengt dårligere end et gitter, og det
 * skalerer elendigt over otte punkter.
 *
 * Mens skuffen er åben, PAUSER tururet (med et loft på 5 s per tur, se
 * turn.js) — main.js sender handlingen 'panel' ved åbning og lukning.
 * Tastaturvalg er langsommere end musevalg, og det kompenserer uden at nogen
 * kan trække tiden.
 *
 * Skuffen står altid i DOM'en og åbnes med en klasse (ikke display:none), så
 * den kan glide ind og ud. Den skjules af CSS i de samme situationer som
 * bjælken (tilskuer, intro, vinderfest), fordi #panel er søster til #hud.
 */
'use strict';

import { VAABEN, KATEGORIER } from '../sim/weapons.js';
import { esc, T, brydOrd } from './tekst.js';
import { FAVORIT_TASTER, FAVORIT_LABELS } from './keyboard.js';
import { ikonHTML } from './vaabenikoner.js';

const KATEGORI_NAVN = {
  skyts: 'Skyts', kast: 'Kast', naerkamp: 'Nærkamp', udstyr: 'Udstyr',
  terraen: 'Terræn', special: 'Special', meta: 'Andet',
};

const HINT = '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> vælg · <kbd>Enter</kbd> tag · ' +
             '<kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>0</kbd> læg på bjælken · <kbd>Esc</kbd> luk';

const ammoTekst = (a) => (a < 0 ? T.spil.ubegraenset : a === 0 ? '0' : `×${a}`);
/** Hvorfor en tom celle er låst. Fjernsupport kommer aldrig i kasserne. */
const laasTekst = (w) => ((w.kasse?.vaegt || 0) > 0 ? T.spil.faasIKasser : T.spil.opbrugt);

export function lavVaabenpanel(rod) {
  let aaben = false;
  let i = 0;
  let punkter = [];          // alle celler i visningsrækkefølge; også de låste
  let celler = [];           // { c, w, ammo, tast, laas } pr. celle
  let sidsteV = null, sidsteB = null;
  let sidsteSig = '';
  let statusTimer = null;
  let vedValg = () => {};
  let vedBind = () => {};
  let vedLuk = () => {};
  let vedAabn = () => {};

  rod.className = 'vaabenpanel';
  rod.setAttribute('aria-hidden', 'true');

  // Musen vælger også: et klik på en celle er det samme som Enter.
  rod.addEventListener('click', (e) => {
    if (!aaben) return;
    const lukKnap = e.target.closest('.vp-luk');
    if (lukKnap) { lukKnap.blur(); luk(); return; }
    const c = e.target.closest('.vp-celle');
    if (!c) return;
    c.blur();
    const j = punkter.indexOf(c);
    if (j >= 0 && j !== i) { i = j; marker(false); }
    vaelg(c);
  });
  // ... og markerer, så Shift + tal kan lægge det våben, man peger på, på bjælken.
  rod.addEventListener('pointerover', (e) => {
    if (!aaben) return;
    const c = e.target.closest('.vp-celle');
    const j = c ? punkter.indexOf(c) : -1;
    if (j >= 0 && j !== i) { i = j; marker(false); }
  });
  // Rystet og bindingspulsen er engangsanimationer; pulsen sidder på tasten.
  rod.addEventListener('animationend', (e) => {
    const c = e.target.closest?.('.vp-celle');
    if (c) c.classList.remove(e.animationName === 'bundetPuls' ? 'bundet' : 'nej');
  });

  function celleHTML(w) {
    return `<button class="vp-celle" type="button" tabindex="-1" data-vaaben="${esc(w.id)}"
              title="${esc(w.navn)} — ${esc(w.hjaelp || '')}">
      ${ikonHTML(w, 'vp-ikon')}
      <span class="vp-navn">${brydOrd(w.navn)}</span>
      <span class="vp-info"><span class="vp-ammo num"></span><span class="vp-haand">${T.spil.iHaanden}</span></span>
      <span class="vp-tast num"></span>
      <span class="vp-hjaelp">${esc(w.hjaelp || '')}</span>
      <span class="vp-laas"></span>
    </button>`;
  }

  function byg(v, baever) {
    const grupper = KATEGORIER.map((k) => ({
      k, navn: KATEGORI_NAVN[k] || k,
      vaaben: Object.values(VAABEN).filter((w) => w.kategori === k),
    })).filter((g) => g.vaaben.length);

    rod.innerHTML = `
      <div class="vp-kort" role="dialog" aria-label="${esc(T.spil.vaabenpanel)}">
        <header class="vp-hoved">
          <div>
            <h2>${T.spil.vaabenpanel}</h2>
            <div class="vp-under">${T.spil.arsenalUnder}</div>
          </div>
          <button class="vp-luk" type="button" tabindex="-1" aria-label="${esc(T.spil.lukArsenal)}"
                  title="${esc(T.spil.lukArsenal)}">
            <svg viewBox="0 0 12 20" aria-hidden="true"><path d="M8.5 3.5l-6 6.5 6 6.5" fill="none"
              stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </header>
        <div class="vp-hint">${HINT}</div>
        <div class="vp-krop">
          ${grupper.map((g) => `
            <section class="vp-gruppe vp-${esc(g.k)}">
              <h3>${esc(g.navn)}</h3>
              <div class="vp-gitter">${g.vaaben.map(celleHTML).join('')}</div>
            </section>`).join('')}
        </div>
        <div class="vp-status" aria-live="polite"></div>
      </div>`;

    punkter = [...rod.querySelectorAll('.vp-celle')];
    celler = punkter.map((c) => ({
      c, w: VAABEN[c.dataset.vaaben],
      ammo: c.querySelector('.vp-ammo'), tast: c.querySelector('.vp-tast'), laas: c.querySelector('.vp-laas'),
    }));
    sidsteSig = '';
    opdaterCeller(v, baever);
    const valgt = punkter.findIndex((p) => p.dataset.vaaben === v.valgtVaaben);
    i = valgt >= 0 ? valgt : 0;
    marker(true);
  }

  /** Ammo, låse, bjælketaster og "i hånden". Skrives kun, når noget har ændret sig. */
  function opdaterCeller(v, baever) {
    if (!v || !baever || !celler.length) return;
    sidsteV = v; sidsteB = baever;
    const tab = v.hold?.[baever.hold]?.ammo || {};
    const favs = Array.isArray(v.favoritter) ? v.favoritter.slice(0, FAVORIT_LABELS.length) : [];
    let sig = `${baever.hold}|${v.valgtVaaben}|${favs.join(',')}`;
    for (const x of celler) sig += `|${tab[x.w.id] ?? 0}`;
    if (sig === sidsteSig) return;
    sidsteSig = sig;
    for (const x of celler) {
      const a = tab[x.w.id] ?? 0;
      const tom = a === 0;
      const plads = favs.indexOf(x.w.id);
      x.c.classList.toggle('tom', tom);
      x.c.classList.toggle('valgt', x.w.id === v.valgtVaaben);
      x.c.classList.toggle('paa-bjaelken', plads >= 0);
      if (tom) x.c.setAttribute('aria-disabled', 'true'); else x.c.removeAttribute('aria-disabled');
      x.ammo.textContent = ammoTekst(a);
      x.tast.textContent = plads >= 0 ? FAVORIT_LABELS[plads] : '';
      x.laas.textContent = tom ? laasTekst(x.w) : '';
    }
  }

  function marker(rul) {
    punkter.forEach((p, j) => p.classList.toggle('paa', j === i));
    if (rul) rulTil(punkter[i]);
  }

  /** Rul kun inde i skuffen — scrollIntoView ville også flytte siden. Står
   *  cellen i gruppens første række, kommer overskriften med. */
  function rulTil(c) {
    const krop = rod.querySelector('.vp-krop');
    if (!c || !krop) return;
    const g = c.closest('.vp-gruppe');
    const top = g && c.offsetTop - g.offsetTop < 48 ? g.offsetTop : c.offsetTop;
    const bund = c.offsetTop + c.offsetHeight;
    if (top < krop.scrollTop) krop.scrollTop = Math.max(0, top - 6);
    else if (bund > krop.scrollTop + krop.clientHeight) krop.scrollTop = bund - krop.clientHeight + 8;
  }

  /** Find nabo i en given retning ud fra faktisk skærmposition, så pile
   *  opfører sig rigtigt på tværs af gruppernes forskellige bredder. */
  function flyt(dx, dy) {
    if (!punkter.length) return;
    const a = punkter[i].getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let bedst = -1, bedstScore = Infinity;
    punkter.forEach((p, j) => {
      if (j === i) return;
      const b = p.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const vx = bx - ax, vy = by - ay;
      if (dx && Math.sign(vx) !== dx) return;
      if (dy && Math.sign(vy) !== dy) return;
      if (dx && Math.abs(vy) > b.height * 1.2) return;
      const score = dx ? Math.abs(vx) + Math.abs(vy) * 3 : Math.abs(vy) + Math.abs(vx) * 1.2;
      if (score < bedstScore) { bedstScore = score; bedst = j; }
    });
    if (bedst >= 0) { i = bedst; marker(true); }
  }

  function status(tekst) {
    const n = rod.querySelector('.vp-status');
    if (!n) return;
    n.textContent = tekst;
    n.classList.add('vis');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => n.classList.remove('vis'), 2600);
  }

  /** Cellen ryster på hovedet: låst, eller kan ikke bindes. */
  function afvis(c) {
    c.classList.remove('nej');
    void c.offsetWidth;                  // genstart animationen ved gentagne tryk
    c.classList.add('nej');
  }

  function vaelg(c) {
    const w = VAABEN[c?.dataset.vaaben];
    if (!w) return;
    if (c.classList.contains('tom')) { afvis(c); status(`${w.navn}: ${laasTekst(w)}`); return; }
    vedValg(w.id);
    luk();
  }

  /** Shift + tal: læg den markerede celle på den plads i bjælken. Låste
   *  våben må gerne bindes (man kan gøre plads til dem, før kassen kommer);
   *  meta-valgene kan ikke — de hører ikke til på bjælken. */
  function bind(plads) {
    const c = punkter[i];
    const w = c && VAABEN[c.dataset.vaaben];
    if (!w) return;
    if (w.kategori === 'meta') { afvis(c); status(T.spil.kanIkkeBindes(w.navn)); return; }
    vedBind(w.id, plads);
    sidsteSig = '';
    opdaterCeller(sidsteV, sidsteB);
    c.classList.remove('bundet');
    void c.offsetWidth;
    c.classList.add('bundet');
    status(T.spil.lagtPaaBjaelke(w.navn, FAVORIT_LABELS[plads]));
  }

  function tast(e) {
    if (!aaben) return false;
    const plads = FAVORIT_TASTER.indexOf(e.code);
    if (plads >= 0 && e.shiftKey) { bind(plads); return true; }
    switch (e.code) {
      case 'ArrowRight': flyt(1, 0); return true;
      case 'ArrowLeft': flyt(-1, 0); return true;
      case 'ArrowDown': flyt(0, 1); return true;
      case 'ArrowUp': flyt(0, -1); return true;
      case 'Enter': case 'NumpadEnter': vaelg(punkter[i]); return true;
      case 'Escape': case 'Tab': luk(); return true;
      // Mellemrum må ikke begynde at lade op, mens man står i skuffen.
      case 'Space': return true;
    }
    return false;
  }

  function aabn(v, baever) {
    if (!baever) return;
    const varAaben = aaben;
    byg(v, baever);
    aaben = true;
    rod.classList.add('aaben');
    rod.setAttribute('aria-hidden', 'false');
    if (!varAaben) vedAabn();
  }

  function luk() {
    if (!aaben) return;
    aaben = false;
    rod.classList.remove('aaben');
    rod.setAttribute('aria-hidden', 'true');
    if (rod.contains(document.activeElement)) document.activeElement.blur();
    vedLuk();
  }

  return {
    get aaben() { return aaben; },
    aabn, luk, tast,
    skift(v, baever) { aaben ? luk() : aabn(v, baever); },
    /** Kaldes hver frame, mens skuffen er åben: ammo og låse følger med. */
    opdater(v, baever) { if (aaben) opdaterCeller(v, baever); },
    paaValg(cb) { vedValg = cb; },
    /** cb(id, plads) — plads 0-9 svarer til tasterne 1–0. */
    paaBind(cb) { vedBind = cb; },
    paaLuk(cb) { vedLuk = cb; },
    paaAabn(cb) { vedAabn = cb; },
  };
}
