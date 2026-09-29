/* Kundekrigen — test: vejledningen i main.js' indputvej, med en rigtig simulation.
 *
 *   node --no-warnings --test test/vejledning_input.mjs
 *
 * Indputvejen (tast.paaTryk/paaSlip, holdNu, sendInput), vejledningens
 * kobling (dinTur og hændelserne) og dens del af opdaterVisning skæres ud af
 * main.js og køres mod en rigtig værtsverden, et spejl fodret som over
 * nettet, det rigtige tastatur og den rigtige lavHjaelp (vejledning_hjaelp.mjs).
 *
 * 1. Ét tastatur: hele vejledningen — uret venter, hvert trin klares af sin
 *    tast, mellemrummet lader op og skyder normalt; slutkortets mellemrum
 *    lader aldrig op, heller ikke når det holdes ind i næste spillers tur.
 * 2. I næste spillers tur er mellemrummet spillets: kortet siger Esc.
 * 3. Esc springer over, og næste Esc er pausen. Markøren og pausen går forud.
 * 4. Oversigten (?) tager alle taster, til den er lukket.
 * 5. Over nettet: modspilleren og tilskueren ser banneret (én gang) og
 *    ventetiden, men intet kort; kun ejeren kan få uret til at vente.
 * 6. Pausemenuens "Vis vejledningen igen" og "Alle taster" (API'en; selve
 *    knapperne i vejledning_pausemenu.mjs).
 * 7. Omstillingens teleport (en telefon, kunden går ind i) er ikke et skud;
 *    Fjernsupports er.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavBord } from './vejledning_hjaelp.mjs';
import { NOEGLE, SPRUNGET } from '../static/js/ui/hjaelp.js';
import { K } from '../static/js/sim/commands.js';
import { VEJLEDNING_LOFT } from '../static/js/sim/turn.js';
import { OPKALD } from '../static/js/sim/opkald.js';

/** Ét tastatur: to lokale spillere, hver med sin kunde (ejer = den lokale pid). */
const LOKALT = [
  { farve: 'roed', navn: 'A', spillere: ['p1'], baevere: [{ navn: 'Ingrid', udseende: null, ejer: 'p1' }] },
  { farve: 'blaa', navn: 'B', spillere: ['p2'], baevere: [{ navn: 'Bo', udseende: null, ejer: 'p2' }] },
];
const NET = [
  { farve: 'roed', navn: 'A', spillere: ['pA'], baevere: [{ navn: 'Ingrid', udseende: null, ejer: 'pA' }] },
  { farve: 'blaa', navn: 'B', spillere: ['pB'], baevere: [{ navn: 'Bo', udseende: null, ejer: 'pB' }] },
];

const kort = (k) => k.dom.boks;
const synlig = (k) => !kort(k).classList.contains('hide');
const sendt = (k, fra = 0) => k.log.afsendt.slice(fra);
const vj = (k, fra = 0) => sendt(k, fra).filter((c) => c.h === 'vejledning').map((c) => c.aktiv);

/** Kør til min vejledning er fremme (dinTur i min tur). */
function tilKort(bord, k) {
  assert.ok(bord.til(() => synlig(k)), 'vejledningen kom frem');
}

test('ét tastatur: hele vejledningen, og slutkortets mellemrum lader aldrig op', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  tilKort(bord, k);
  const v = bord.vaert;
  const ur0 = v.tur.tickTilbage;
  bord.tick(3);
  assert.deepEqual(vj(k), [true], 'uret venter fra dinTur');
  assert.equal(kort(k).className, 'hjboble vejl bund');
  assert.match(kort(k).innerHTML, /1\/5/);
  assert.match(kort(k).innerHTML, /Uret venter/);
  assert.ok(k.spejl.tur.vejledningRest > VEJLEDNING_LOFT - 10, 'spejlet kender ventetiden (deltaens vj)');

  // 1. Gå: tasten går igennem til spillet OG klarer trinnet.
  const x0 = v.aktivBaever().x;
  k.tryk('ArrowRight'); bord.tick(35); k.slip('ArrowRight');
  assert.ok(v.aktivBaever().x > x0 + 20, 'kunden gik');
  assert.match(kort(k).className, /klaret/);
  bord.tick(30);
  assert.match(kort(k).innerHTML, /2\/5/);
  // 2. Hop.
  k.tryk('Enter'); k.slip('Enter'); bord.tick(35);
  assert.match(kort(k).innerHTML, /3\/5/, 'hop klaret');
  // 3. Sigt.
  const vinkel0 = v.aktivBaever().vinkel;
  k.tryk('ArrowUp'); bord.tick(30); k.slip('ArrowUp'); bord.tick(30);
  assert.ok(v.aktivBaever().vinkel > vinkel0, 'sigtet gik op');
  assert.match(kort(k).innerHTML, /4\/5/);
  // 4. Våben (2 = Datalæk-bomben på bjælken).
  k.tryk('Digit2'); k.slip('Digit2'); bord.tick(35);
  assert.equal(v.valgtVaaben, 'egegranat');
  assert.match(kort(k).innerHTML, /5\/5/);
  assert.match(kort(k).innerHTML, /Jo længere du holder/);
  assert.equal(v.tur.tickTilbage, ur0, 'uret har ventet hele vejen');

  // 5. Skyd: mellemrummet er spillets — det lader op og skyder som altid.
  k.tryk('Space');
  assert.equal(k.S.oplader, true, 'mellemrum på et trinkort lader op');
  bord.tick(20);
  k.slip('Space');
  assert.equal(sendt(k).filter((c) => c.h === 'affyr').length, 1);
  bord.tick(2);
  assert.deepEqual(vj(k), [true, false], 'skuddet slår pausen fra');
  assert.equal(k.lager.get(NOEGLE), '1', 'flaget gemmes, når der er skudt');

  // Slutkortet først, når verden er i ro — aldrig under affyring eller opløsning.
  let foersteSlut = null;
  bord.til(() => {
    if (kort(k).classList.contains('slut')) { foersteSlut ??= k.spejl.tur.tilstand; return true; }
    return false;
  });
  assert.ok(!['affyring', 'oploesning', 'spiller_aktiv'].includes(foersteSlut), `slutkortet kom i ${foersteSlut}`);
  assert.match(kort(k).innerHTML, /Tryk <kbd class="lang">MELLEMRUM<\/kbd> for at fortsætte/);

  // Mellemrum lukker det — og starter ingen opladning.
  const n = k.log.afsendt.length;
  k.tryk('Space');
  assert.equal(k.S.oplader, false);
  assert.equal(k.S.spistMellemrum, true);
  assert.ok(k.log.lyde.includes('klik'));
  assert.equal(synlig(k), false);
  // Holdes mellemrummet ind i næste spillers tur, tæller det stadig ikke.
  assert.ok(bord.til(() => k.spejl.tur.tilstand === 'spiller_aktiv' && k.spejl.aktivBaever()?.navn === 'Bo'));
  bord.tick(5);
  k.tryk('ArrowLeft'); bord.tick(10); k.slip('ArrowLeft');
  const hold = sendt(k, n).filter((c) => c.k === 'hold');
  assert.ok(hold.some((c) => c.b & K.VENSTRE), 'piletasten kom igennem');
  assert.ok(hold.every((c) => !(c.b & K.LAD)), 'men ikke mellemrummet');
  assert.equal(v.opladning, 0, 'simulationen ladede ikke op');
  k.slip('Space');
  assert.equal(sendt(k, n).filter((c) => c.h === 'affyr').length, 0, 'intet skud');
  assert.equal(k.S.spistMellemrum, false);
  // Vejledningen kommer kun én gang: ikke igen for spiller 2.
  assert.equal(k.hjaelp.vejledning.aktiv, false);
  assert.deepEqual(vj(k), [true, false]);
  assert.equal(synlig(k), false);
});

test('ét tastatur: i næste spillers tur er mellemrummet spillets — kortet siger Esc', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  tilKort(bord, k);
  bord.tick(2);
  k.tryk('Space'); bord.tick(10); k.slip('Space');
  bord.til(() => kort(k).classList.contains('slut'));
  // Spiller 1 lader kortet stå; spiller 2 får turen.
  assert.ok(bord.til(() => k.spejl.tur.tilstand === 'spiller_aktiv' && k.spejl.aktivBaever()?.navn === 'Bo'));
  bord.tick(3);
  assert.match(kort(k).innerHTML, /Tryk <kbd>Esc<\/kbd> for at lukke/);
  k.tryk('Space');
  assert.equal(k.S.oplader, true, 'mellemrummet lader op for spiller 2');
  assert.equal(synlig(k), true);
  k.slip('Space');
  bord.tick(1);
  // Skuddet er affyret; kortet står stadig, og Esc lukker det — uden banner og uden pause.
  k.tryk('Escape'); k.slip('Escape');
  assert.equal(synlig(k), false);
  assert.equal(k.S.pause, false);
  assert.ok(!k.log.bannere.includes(SPRUNGET));
});

test('Esc springer over; næste Esc er pausen', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  tilKort(bord, k);
  bord.tick(3);
  k.tryk('Escape'); k.slip('Escape');
  assert.equal(synlig(k), false);
  assert.equal(k.S.pause, false, 'Esc gik til vejledningen, ikke pausen');
  assert.deepEqual(k.log.bannere.filter((b) => b === SPRUNGET).length, 1);
  assert.deepEqual(vj(k), [true, false]);
  assert.equal(k.lager.get(NOEGLE), '1');
  bord.tick(2);
  assert.equal(bord.vaert.tur.vejledning, null, 'uret går igen');
  assert.equal(k.spejl.tur.vejledningRest, 0);
  const ur = bord.vaert.tur.tickTilbage;
  bord.tick(30);
  assert.equal(ur - bord.vaert.tur.tickTilbage, 30);
  bord.tick(15);                                   // forbi pauseSlut-vagten
  k.tryk('Escape');
  assert.equal(k.S.pause, true);
  assert.ok(k.log.menu.includes('vis:pause'));
});

test('markøren og pausen tager Esc før vejledningen', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  tilKort(bord, k);
  bord.tick(2);
  // Markørtilstand (Fjernsupport): Esc annullerer markøren som i dag.
  k.S.markoerTilstand = true;
  k.tryk('Escape'); k.slip('Escape');
  assert.equal(k.S.markoerTilstand, false);
  assert.equal(k.hjaelp.vejledning.aktiv, true);
  assert.equal(k.S.pause, false);
  // Pausemenuen er åben (fx åbnet i modstanderens tur), og kortet står bag den.
  k.S.pause = true;
  bord.tick(2);
  assert.equal(synlig(k), true);
  k.tryk('Escape'); k.slip('Escape');
  assert.equal(k.S.pause, false, 'Esc lukkede pausen');
  assert.equal(k.hjaelp.vejledning.aktiv, true, 'og vejledningen står der stadig');
  assert.deepEqual(vj(k), [true]);
});

test('oversigten (?) tager alle taster, til den er lukket', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  tilKort(bord, k);
  bord.tick(2);
  const v = bord.vaert;
  // En opladning i gang, når oversigten åbnes, dør.
  k.tryk('Space');
  assert.equal(k.S.oplader, true);
  k.tryk('Slash', { key: '/' });
  assert.equal(k.hjaelp.oversigtErAaben, true);
  assert.equal(k.S.oplader, false);
  k.slip('Space');
  // Mellemrum og piletaster gør intet, mens den er åben.
  const x0 = v.aktivBaever().x, n = k.log.afsendt.length;
  k.tryk('Space');
  k.tryk('ArrowLeft'); bord.tick(40);
  assert.equal(v.aktivBaever().x, x0, 'kunden gik ikke');
  assert.equal(k.S.oplader, false);
  assert.match(kort(k).innerHTML, /1\/5/, 'og gå-trinnet blev ikke klaret');
  k.slip('ArrowLeft'); k.slip('Space');
  assert.equal(sendt(k, n).filter((c) => c.h === 'affyr').length, 0);
  assert.ok(sendt(k, n).filter((c) => c.k === 'hold').every((c) => c.b === 0));
  // Esc lukker oversigten — og springer ikke vejledningen over.
  k.tryk('Escape'); k.slip('Escape');
  assert.equal(k.hjaelp.oversigtErAaben, false);
  assert.equal(k.hjaelp.vejledning.aktiv, true);
  assert.equal(k.S.pause, false);
  k.tryk('ArrowLeft'); bord.tick(20); k.slip('ArrowLeft');
  assert.ok(v.aktivBaever().x < x0, 'bagefter virker piletasterne igen');
});

test('fokus tabt (rydAlt) rydder det spiste mellemrum', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  tilKort(bord, k);
  bord.tick(2);
  k.tryk('Space'); bord.tick(10); k.slip('Space');
  bord.til(() => kort(k).classList.contains('slut'));
  k.tryk('Space');
  assert.equal(k.S.spistMellemrum, true);
  k.blur();
  assert.equal(k.S.spistMellemrum, false);
});

test('over nettet: modspiller og tilskuer ser ventetiden og banneret, ikke kortet', () => {
  const bord = lavBord({ hold: NET });
  const a = bord.lavKlient({ erNet: true, pid: 'pA' });
  const b = bord.lavKlient({ erNet: true, pid: 'pB' });
  const x = bord.lavKlient({ erNet: true, pid: 'pX' });            // tilskuer
  assert.ok(bord.til(() => synlig(a) || synlig(b)));
  const [mig, modspiller] = synlig(a) ? [a, b] : [b, a];
  const navn = bord.vaert.aktivBaever().navn;
  bord.tick(60);
  assert.equal(synlig(mig), true);
  for (const k of [modspiller, x]) {
    assert.equal(synlig(k), false, `${k.S.pid} ser intet kort`);
    assert.equal(k.hjaelp.vejledning.aktiv, false);
    assert.ok(k.spejl.tur.vejledningRest > 0, `${k.S.pid} kender ventetiden`);
    assert.deepEqual(k.log.bannere.filter((t) => t.includes('lærer styringen')),
      [`${navn} lærer styringen — uret venter højst 30 s`], 'banneret én gang pr. tur');
    assert.deepEqual(vj(k), [], `${k.S.pid} sender intet`);
  }
  // Kun ejeren kan få uret til at vente (valider): en fremmed "devtools"-kommando afvises.
  assert.deepEqual(bord.vaert.udfoerKommando({ k: 'handling', seq: 99, h: 'vejledning', aktiv: false }, modspiller.S.pid),
    { ok: false, fejl: 'ikke din bæver' });
  modspiller.m.vejledningUr(true);
  assert.deepEqual(vj(modspiller), [], 'brugerfladen sender den heller ikke');
  // Ejeren springer over: ventetiden forsvinder hos alle.
  mig.tryk('Escape'); mig.slip('Escape');
  bord.tick(3);
  for (const k of [mig, modspiller, x]) assert.equal(k.spejl.tur.vejledningRest, 0);
  assert.equal(bord.kommandoer.filter((c) => c.cmd.h === 'vejledning' && c.res.ok).length, 2);
});

test('pausemenuen: "Vis vejledningen igen" og "Alle taster"', () => {
  const bord = lavBord({ hold: NET });
  const lagerA = new Map([[NOEGLE, '1']]), lagerB = new Map([[NOEGLE, '1']]);
  const a = bord.lavKlient({ erNet: true, pid: 'pA', lager: lagerA });
  const b = bord.lavKlient({ erNet: true, pid: 'pB', lager: lagerB });
  assert.ok(bord.til(() => bord.vaert.tur.tilstand === 'spiller_aktiv'));
  bord.tick(3);
  assert.equal(synlig(a) || synlig(b), false, 'flaget er sat: ingen vejledning');
  const [mig, anden] = bord.vaert.aktivBaever().ejer === 'pA' ? [a, b] : [b, a];
  // I min egen tur: med det samme, og uret venter.
  mig.S.pause = true;
  mig.m.api.visVejledning();
  assert.equal(mig.S.pause, false);
  assert.ok(mig.log.menu.includes('skjul'));
  assert.deepEqual(vj(mig), [true]);
  bord.tick(2);
  assert.equal(synlig(mig), true);
  assert.match(kort(mig).innerHTML, /1\/5/);
  assert.equal(lagerA.get(NOEGLE), '1');
  // I modstanderens tur: intet nu — først ved min næste dinTur.
  anden.m.api.visVejledning();
  assert.deepEqual(vj(anden), []);
  bord.tick(2);
  assert.equal(synlig(anden), false);
  bord.vaert.udfoerKommando({ k: 'handling', seq: 98, h: 'staaOver' }, mig.S.pid);
  assert.ok(bord.til(() => synlig(anden)), 'vejledningen kom i min næste tur');
  assert.deepEqual(vj(anden), [true]);
  // "Alle taster" åbner oversigten og lukker pausen.
  anden.S.pause = true;
  anden.m.api.visTaster();
  assert.equal(anden.S.pause, false);
  assert.equal(anden.hjaelp.oversigtErAaben, true);
  anden.m.api.visTaster();
  assert.equal(anden.hjaelp.oversigtErAaben, true, 'lukker den ikke igen');
});

test('Omstillingens teleport er ikke et skud — Fjernsupports er', () => {
  const bord = lavBord({ hold: LOKALT });
  const k = bord.lavKlient();
  tilKort(bord, k);
  bord.tick(3);
  const v = bord.vaert;
  // Opkaldet er Omstillingen (1 ud af 10): _tagTelefons første træk tvinges.
  const NR = OPKALD.findIndex((o) => o.effekt === 'viderestil');
  const tagTelefon = v._tagTelefon;
  v._tagTelefon = function (b, kasse, h) {
    const rng = this.rngSim;
    let foerste = true;
    this.rngSim = Object.assign(() => (foerste ? (foerste = false, (NR + 0.5) / OPKALD.length) : rng()), rng);
    try { return tagTelefon.call(this, b, kasse, h); } finally { this.rngSim = rng; }
  };
  const teleporter = [];
  k.bus.paa('teleport', (e) => teleporter.push(e));

  // Gå-trinnet: kunden går ind i en ringende telefon lige foran sig.
  const b = v.aktivBaever();
  const tx = b.x + 40;
  v._lavTelefon({ x: tx, y: v.terraen.overflade(tx) });
  k.tryk('ArrowRight');
  assert.ok(bord.til(() => teleporter.length > 0, 120), 'telefonen blev taget');
  k.slip('ArrowRight');
  bord.tick(3);
  const [tlf] = teleporter;
  assert.equal(tlf.kilde, 'telefon');
  assert.equal(tlf.baever, k.spejl.aktivBaever().id, 'min aktive kunde — den gamle kobling havde talt det');
  assert.ok(Math.abs(v.aktivBaever().x - tlf.fraX) > 200, 'kunden blev stillet videre');
  assert.equal(k.hjaelp.vejledning.fase, 'trin', 'vejledningen fortsætter');
  assert.ok(!k.hjaelp.vejledning.klaret.includes('skyd'));
  assert.deepEqual(vj(k), [true], 'uret venter stadig — intet aktiv:false');
  assert.equal(k.lager.get(NOEGLE), undefined, 'flaget er ikke gemt');
  assert.equal(synlig(k), true);
  assert.ok(!kort(k).classList.contains('slut'));

  // Fjernsupport (gangtunnel) er et rigtigt skud: markør, så affyr.
  assert.equal(v.udfoerKommando({ k: 'handling', seq: 900, h: 'vaelgVaaben', id: 'gangtunnel' }, null).ok, true);
  bord.tick(3);
  assert.deepEqual(k.hjaelp.vejledning.klaret, ['vaaben']);
  k.tryk('Space'); bord.tick(2); k.slip('Space'); bord.tick(2);
  assert.equal(k.S.markoerTilstand, true);
  k.tryk('Space'); bord.tick(2); k.slip('Space'); bord.tick(3);
  assert.equal(teleporter.length, 2, 'Fjernsupport teleporterede');
  assert.equal(teleporter[1].kilde, undefined);
  assert.equal(k.hjaelp.vejledning.fase, 'slut');
  assert.deepEqual(vj(k), [true, false], 'skuddet slår pausen fra');
  assert.equal(k.lager.get(NOEGLE), '1', 'og flaget gemmes');
});
