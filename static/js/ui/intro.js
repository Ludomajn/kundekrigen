/* Kundekrigen — introen: "KUNDEKRIGEN STARTER OM 3 … 2 … 1 … SÆT I GANG!"
 *
 * Kører, mens simulationen udsætter kunderne (T.UDSAET, 4 s). Titlen slår
 * ind, tallene popper op ét ad gangen, og når den første tur starter, kommer
 * "SÆT I GANG!". Kommer turen før tallene er færdige, springes resten over;
 * kommer den senere, bliver "1" stående, til den gør.
 *
 * Kun DOM og CSS; lyd og kamera styres af main.js via tilbagekaldene.
 */
'use strict';

// Tallene følger speakerens "3 … 2 … 1 … sæt i gang" (stemme_announcer_321_saet_i_gang,
// startet på 3-tallet): "to" kommer 0,86 s og "en" 1,78 s efter "tre".
const TIDER = { titel: 0, tre: 1100, to: 1960, en: 2880 };

export function lavIntro(rod) {
  let el = null, timere = [], aktiv = false, vedTal = null;

  function vis(html, klasse) {
    if (!el) return;
    const n = document.createElement('div');
    n.className = `intro-led ${klasse}`;
    n.innerHTML = html;
    el.querySelector('.intro-scene').replaceChildren(n);
  }

  function ryd() {
    for (const t of timere) clearTimeout(t);
    timere = [];
    el?.remove(); el = null; aktiv = false;
  }

  return {
    get aktiv() { return aktiv; },

    /** paaTal(n): kaldes ved hvert tal (3, 2, 1) og 0 for titlen. */
    start(paaTal) {
      ryd();
      aktiv = true; vedTal = paaTal;
      el = document.createElement('div');
      el.className = 'intro';
      el.innerHTML = '<div class="intro-bjaelke op"></div><div class="intro-scene"></div><div class="intro-bjaelke ned"></div>';
      rod.appendChild(el);
      vis('<div class="intro-titel">KUNDEKRIGEN</div>', 'slam');
      vedTal?.(0);
      const tal = (n) => () => {
        vis(`<div class="intro-lille">starter om</div><div class="intro-tal">${n}</div>`, 'pop');
        vedTal?.(n);
      };
      timere.push(setTimeout(tal(3), TIDER.tre), setTimeout(tal(2), TIDER.to), setTimeout(tal(1), TIDER.en));
    },

    /** Den første tur er startet: "SÆT I GANG!" og så væk. */
    go() {
      if (!aktiv) return false;
      for (const t of timere) clearTimeout(t);
      timere = [];
      vis('<div class="intro-go">SÆT I GANG!</div>', 'go');
      el.classList.add('slut');
      timere.push(setTimeout(ryd, 1600));
      return true;
    },

    stop: ryd,
  };
}
