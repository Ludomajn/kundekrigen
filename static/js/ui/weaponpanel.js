/* Kundekrigen — våbenpanelet.
 *
 * Et GITTER, ikke et radialmenu. Radialmenuer er designet til en pegeenhed;
 * at navigere et med piletaster er strengt dårligere end et gitter, og det
 * skalerer elendigt over otte punkter.
 *
 * Mens panelet er åbent, PAUSER tururet (med et loft på 5 s per tur, se
 * turn.js). Tastaturvalg er langsommere end musevalg, og det kompenserer
 * uden at nogen kan trække tiden.
 */
'use strict';

import { VAABEN, KATEGORIER } from '../sim/weapons.js';
import { esc, T } from './tekst.js';
import { FAVORIT_LABELS } from './keyboard.js';
import { ikonHTML } from './vaabenikoner.js';

const KATEGORI_NAVN = {
  skyts: 'Skyts', kast: 'Kast', naerkamp: 'Nærkamp',
  udstyr: 'Udstyr', meta: 'Andet',
};

export function lavVaabenpanel(rod) {
  let aaben = false;
  let i = 0;
  let punkter = [];
  let vedValg = () => {};
  let vedBind = () => {};
  let vedLuk = () => {};

  rod.className = 'vaabenpanel hide';

  function byg(v, baever) {
    const grupper = KATEGORIER.map((k) => ({
      k, navn: KATEGORI_NAVN[k],
      vaaben: Object.values(VAABEN).filter((w) => w.kategori === k),
    })).filter((g) => g.vaaben.length);

    rod.innerHTML = `
      <div class="vp-kort">
        <div class="vp-hoved">
          <h2>${T.spil.vaabenpanel}</h2>
          <div class="vp-hint">Piletaster vælger · Enter bekræfter · Shift+Enter binder til favorit · Esc fortryder</div>
        </div>
        <div class="vp-krop">
          ${grupper.map((g) => `
            <section class="vp-gruppe">
              <h3>${esc(g.navn)}</h3>
              <div class="vp-gitter">
                ${g.vaaben.map((w) => {
                  const ammo = v.ammoFor(baever.hold, w.id);
                  const favIdx = v.favoritter ? v.favoritter.indexOf(w.id) : -1;
                  return `<button class="vp-celle ${ammo === 0 ? 'tom' : ''}" data-vaaben="${esc(w.id)}"
                            ${ammo === 0 ? 'disabled' : ''} title="${esc(w.hjaelp || '')}">
                    ${ikonHTML(w, 'vp-ikon')}
                    <span class="vp-navn">${esc(w.navn)}</span>
                    <span class="vp-ammo num">${ammo < 0 ? T.spil.ubegraenset : ammo}</span>
                    ${favIdx >= 0 ? `<span class="vp-tast">${FAVORIT_LABELS[favIdx]}</span>` : ''}
                    <span class="vp-hjaelp">${esc(w.hjaelp || '')}</span>
                  </button>`;
                }).join('')}
              </div>
            </section>`).join('')}
        </div>
      </div>`;

    punkter = [...rod.querySelectorAll('.vp-celle:not([disabled])')];
    const valgt = punkter.findIndex((p) => p.dataset.vaaben === v.valgtVaaben);
    i = valgt >= 0 ? valgt : 0;
    marker();
  }

  function marker() {
    punkter.forEach((p, j) => p.classList.toggle('paa', j === i));
    punkter[i]?.scrollIntoView({ block: 'nearest' });
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
    if (bedst >= 0) { i = bedst; marker(); }
  }

  function tast(e) {
    if (!aaben) return false;
    switch (e.code) {
      case 'ArrowRight': flyt(1, 0); return true;
      case 'ArrowLeft': flyt(-1, 0); return true;
      case 'ArrowDown': flyt(0, 1); return true;
      case 'ArrowUp': flyt(0, -1); return true;
      case 'Enter': case 'NumpadEnter': {
        const id = punkter[i]?.dataset.vaaben;
        if (id) { if (e.shiftKey) vedBind(id); else { vedValg(id); luk(); } }
        return true;
      }
      case 'Escape': case 'Tab': luk(); return true;
    }
    return false;
  }

  function aabn(v, baever) {
    if (!baever) return;
    byg(v, baever);
    aaben = true;
    rod.classList.remove('hide');
  }
  function luk() { aaben = false; rod.classList.add('hide'); vedLuk(); }

  return {
    get aaben() { return aaben; },
    aabn, luk, tast,
    skift(v, baever) { aaben ? luk() : aabn(v, baever); },
    paaValg(cb) { vedValg = cb; },
    paaBind(cb) { vedBind = cb; },
    paaLuk(cb) { vedLuk = cb; },
  };
}
