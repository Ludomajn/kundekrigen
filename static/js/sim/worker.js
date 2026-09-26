/* Kundekrigen — simulationen i en Worker.
 *
 * HVORFOR: når fanen går i baggrunden, struber browseren requestAnimationFrame
 * til nær nul, og efter fem minutter kører timere én gang i minuttet. Kørte
 * simulationen på rAF, ville spillet fryse for alle tolv, uden at værten
 * opdagede det. Workers throttles IKKE — derfor bor simulationen her.
 *
 * Workeren taler NØJAGTIG samme protokol som en netværksvært. Hovedtråden er
 * dermed "en klient" uanset om værten er en Worker på samme maskine eller en
 * browser i den anden ende af huset — der findes kun én kodesti.
 */
'use strict';

import { lavVerden } from './world.js';
import { HZ, DT } from '../core/tick.js';

const ST_HVER = 1;                 // 60 Hz til hovedtråden; netværket tyndes ud i main.js
const VIDERESEND = new Set([
  'eksplosion', 'skade', 'doedsfald', 'drukner', 'kasseFalder', 'kasseSamlet',
  'pludseligDoed', 'vandStiger', 'teleport', 'bjaelkeSat', 'straale',
  'skudAffyret', 'vaabenValgt', 'hop', 'salto', 'klyngeDelt', 'dinTur',
  'turAfsluttet', 'tvungenRo', 'redskabStart', 'redskabSlut', 'staaOver', 'terraenBygget',
  'ammoAendret', 'lunteSat', 'hændelse',
]);

let verden = null;
let ur = null;
let sidsteSt = 0;
let seq = 0;

// Kun pålidelige beskeder får sekvensnummer — 'st' må springes over (den
// tyndes ud til netværket), og et nummer på den ville ligne et tabt krater.
const send = (t, d) => postMessage(t === 'st' ? { t, d } : { t, d, s: ++seq });

/** Fast tidsskridt med akkumulator og indhentningsloft. Uafhængig af rAF. */
function startUr() {
  let sidst = performance.now() / 1000;
  let akk = 0;
  clearInterval(ur);
  ur = setInterval(() => {
    const nu = performance.now() / 1000;
    let ramme = nu - sidst;
    sidst = nu;
    if (ramme > 0.25) ramme = 0.25;      // et længere spring er en pause
    akk += ramme;
    let n = 0;
    while (akk >= DT && n < 8) { skridt(); akk -= DT; n++; }
    if (akk >= DT) akk %= DT;            // fald aldrig i en dødsspiral
  }, 4);
}

function skridt() {
  if (!verden) return;
  const h = verden.skridt();

  for (const e of h) {
    if (e.navn === 'krater') {
      send('krater', { x: e.x, y: e.y, r: e.r, k: e.k, x2: e.x2, y2: e.y2, hl: e.hl, ht: e.ht, v: e.v });
    } else if (e.navn === 'turStart') {
      send('tur', { baever: e.baever, hold: e.hold, tid: e.tid,
                    fase: verden.tur.tilstand, vind: e.vind, vejr: e.vejr,
                    vand: verden.vandNiveau, turNr: e.turNr });
      send('snapshot', { snap: verden.oejebliksbillede() });
    } else if (e.navn === 'sejr') {
      send('slut', { vinder: e.vinder, stilling: e.stilling });
    } else if (VIDERESEND.has(e.navn)) {
      send('haendelse', e);
    }
  }

  if (verden.tick - sidsteSt >= ST_HVER) {
    sidsteSt = verden.tick;
    send('st', verden.delta());
  }
}

onmessage = (ev) => {
  const m = ev.data;
  switch (m.t) {
    case 'opsaet':
      verden = lavVerden(m.d);
      verden.startKamp();
      sidsteSt = 0;
      send('klar', { froe: verden.froeBrugt ?? verden.froe,
                     snap: verden.oejebliksbillede() });
      startUr();
      break;

    case 'in':
      verden?.udfoerKommando(m.d.cmd, m.d.pid ?? null);
      break;

    case 'snap_bed':
      if (verden) send('snapshot', { to: m.d?.pid ?? null, snap: verden.oejebliksbillede() });
      break;

    case 'stop':
      clearInterval(ur); ur = null; verden = null;
      break;
  }
};
