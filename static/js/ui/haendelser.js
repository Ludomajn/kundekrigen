/* Kundekrigen — rundens hændelser i brugerfladen (sim/haendelser.js).
 *
 * Banneret med hændelsens titel og forklaring viser main.js allerede (dens
 * 'hændelse'-lytter viser e.tekst). Her er resten: én lyd pr. hændelse
 * gennem den fælles kanal (lyd.afspil spiller kun, når kanalen er fri, så
 * to lyde lyder aldrig oven i hinanden), effekterne på banen og et lille
 * mærke under uret, så længe en rundehændelse gælder.
 *
 * Mærket læses af spejlets haendelseNu, der kommer med snapshottet ved hvert
 * turskift — også hos gæster og dem, der kommer til midt i kampen.
 *
 * Ren præsentation: lytter på bussen og skriver aldrig tilbage i simulationen.
 */
'use strict';

import { HAENDELSE_INFO, RUNDEHAENDELSER } from '../sim/haendelser.js';
import { VAABEN } from '../sim/weapons.js';
import { effektLyd } from './stemmer.js';

/* Hændelsens ene lyd — spillet her, fra 'hændelse', der kommer før turens
 * replik og før følgerne. Følgernes egne lyde i main.js (printernes brag,
 * kassernes faldskærm) er ikke vigtige og falder bort, mens denne spiller.
 * Printernes brag har også forrang: det tager kanalen fra et brag, der
 * klinger ud fra sidste tur, så main.js' første printerbrag ikke kommer
 * først og det her bagefter; spiller en vigtig replik, venter det i køen. */
const LYD = {
  internet: ['stemme_systemnedbrud', { vol: 0.9, maksSek: 3 }],
  shitstorm: ['mine_laeg', { vol: 1.4 }],
  kaffepause: ['piller', { vol: 1.2 }],
  printere: [() => effektLyd('kaempe_eksplosion'), { vol: 1, forrang: true }],
  pakker: ['kasse_falder', { vol: 1.3 }],
  influenza: ['covid_host', { vol: 1.5 }],
  brandoevelse: ['teleport', { vol: 1.6 }],
  myldretid: ['nedtael', { vol: 1.2 }],
  loenningsdag: ['vaaben_samlet', { vol: 1.3 }],
};
/** Kortere end det er ingen flytning at vise (ingen teleportfx på stedet). */
const FLYT_VIST = 60;
const SPEAKER_VANDET_STIGER = 'stemme_announcer_vandet_stiger';

/** Mærket under uret: kort, så det kan stå hele runden. */
const MAERKE = {
  internet: 'INTERNETNEDBRUD · INGEN SKUD',
  myldretid: 'MYLDRETID · HALV TURTID',
};

export function kobHaendelser({ bus, hud, lyd, visning, S, r }) {
  const v = () => S.verden;
  const figur = (id) => v()?.baevere.find((x) => x.id === id) || null;
  const erMin = (b) => !!b && (!S.erNet || b.ejer === S.pid || (!b.ejer && v().pidPaaHold(S.pid, b.hold)));
  // Brandøvelsen flytter også den aktive kunde; kameraet fandt den ved
  // turskiftet, før de nye positioner nåede spejlet (snapshottet).
  let refokus = false;

  // --- mærket under uret
  let maerke = null;
  function opdaterMaerke() {
    const nu = v()?.haendelseNu;
    const slags = nu && RUNDEHAENDELSER.has(nu.slags) ? nu.slags : null;
    if (!maerke) {
      if (!slags || !hud.el.sudden?.isConnected) return;
      maerke = document.createElement('div');
      maerke.className = 'haendelse-maerke hide';
      hud.el.sudden.insertAdjacentElement('afterend', maerke);
    }
    maerke.classList.toggle('hide', !slags);
    if (!slags) return;
    maerke.className = `haendelse-maerke ${slags}`;
    maerke.textContent = MAERKE[slags];
    maerke.title = HAENDELSE_INFO[slags].tekst;
  }

  function lydTil(slags) {
    if (slags === 'vandskade') { lyd.stemme(SPEAKER_VANDET_STIGER, { vigtig: true }); return; }
    const l = LYD[slags];
    const navn = typeof l?.[0] === 'function' ? l[0]() : l?.[0];
    // vigtig: venter i køen, hvis kanalen er optaget — i stedet for at blive
    // sprunget over eller lyde oven i noget andet.
    if (navn) lyd.afspil(navn, { ...l[1], vigtig: true });
  }

  bus.paa('hændelse', (e) => {
    if (!HAENDELSE_INFO[e.slags]) return;
    lydTil(e.slags);
    const fx = visning.fx;
    switch (e.slags) {
      case 'shitstorm':
        for (const m of e.miner || []) fx.pop('TICKET!', m.x, m.y + 26, { farve: 'roed', str: 22 });
        break;

      case 'kaffepause':
        for (const x of e.heal || []) {
          const b = figur(x.baever);
          if (b) hud.helbredTal(b, x.hp, r);
        }
        break;

      case 'influenza':
        // Skaden kommer som almindelige 'skade'-hændelser lige efter (og de
        // røde tal, når verden er i ro). De må ikke tælle som det sidste
        // skud, der ramte — så grinede eller pralede skytten forkert.
        S.skudUde = null;
        for (const x of e.syge || []) {
          const b = figur(x.baever);
          if (b) fx.pop('ATJU!', b.x, b.y + 64, { farve: 'groen', str: 26 });
        }
        break;

      case 'brandoevelse':
        // Ingen teleportlyd pr. kunde: hændelsens ene lyd er nok.
        for (const f of e.flyt || []) {
          if (Math.hypot(f.x - f.fraX, f.y - f.fraY) >= FLYT_VIST) fx.teleport(f.fraX, f.fraY, f.x, f.y);
        }
        refokus = true;
        break;

      case 'loenningsdag': {
        const mine = [];
        for (const l of e.loen || []) {
          const navn = VAABEN[l.vaaben]?.navn || 'våben';
          const holdets = v()?.baevere.filter((b) => b.hold === l.hold && !b.doed) || [];
          for (const b of holdets) fx.pop(`+1 ${navn}`, b.x, b.y + 80, { farve: 'gul', str: 20 });
          if (holdets.some(erMin)) mine.push(navn);
        }
        // Over nettet: hvad fik ens egen klinik (ved ét tastatur viser
        // våbenbjælken det for den, der har turen).
        if (S.erNet && mine.length) hud.banner(`Lønningsdag: +1 ${mine.join(', +1 ')} til din klinik`, 2400);
        break;
      }
    }
  });

  // Internetnedbrud: skuddet blev afvist hos værten.
  bus.paa('skudAfvist', (e) => {
    if (e.grund !== 'internet') return;
    const b = figur(e.baever) || v()?.aktivBaever();
    if (!erMin(b)) return;
    hud.banner('Ingen internet — du kan ikke skyde i denne runde', 1800, 'advarsel');
    lyd.afspil('teleport_afvist', { vol: 1.5 });
  });

  bus.paa('snapshotAnvendt', () => {
    opdaterMaerke();
    if (refokus) {
      refokus = false;
      const akt = v()?.aktivBaever();
      if (akt && !akt.doed) visning.kamera.fokus(akt);
    }
  });
  bus.paa('turStart', opdaterMaerke);
  opdaterMaerke();
}
