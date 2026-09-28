/* Kundekrigen — test: fundene fra gennemgangen af banegeneratoren.
 *
 * Hver kontrol her beskriver en regel, som banerne (eller rummet omkring
 * dem) skal overholde. De fejlede alle, da gennemgangen blev lavet:
 *
 *   - Spil igen giver en NY bane: et nyt frø ved hver kampstart, og en
 *     'tilfaeldig'-regel trækkes igen hver gang (net/transport.js; rum.py
 *     gør det samme, se rum_spil_igen.py)
 *   - fortets forsyningskasser slippes kun over steder, man kan komme op på
 *     (taget, keepens top, gangbroen) — aldrig over tvillingernes bagtårn
 *     eller bastionens brede fortårnskrone — og lander dér, også med vind:
 *     de driver kun inden for stykket, de blev sluppet over
 *   - en kasse, der driver ind i en mur fra siden, glider ned ad den og
 *     lander ikke inde i muren (physics.skridtKasse)
 *   - brandøvelsen stiller aldrig en kunde oppe på et tårn, man ikke kan
 *     komme op på
 *   - ruinen på øen mellem borgene står på jorden (ingen luft under foden)
 *   - i grotten falder stenskredet fra loftet ned i grotten, og
 *     Kvartalsopkrævningen rammer hulrummet, markøren står i (ikke loftets
 *     overside); på åbne baner kommer luftangrebet stadig fra himlen
 *
 * og den sidste holdt allerede, men er en stærkere prøve end t.lukket:
 *
 *   - grottens startpladser ligger alle i det samme hulrum over vandet
 *     (ingen kunde starter i et kammer, der kun hænger sammen med de andre
 *     under vandet)
 *
 *   node --no-warnings test/kort_gennemgang.mjs
 */
import { genererSpilbar, fortPlan, VAND_NIVEAU } from '../static/js/sim/terrain_gen.js';
import { Terraen, LUFT, JORD, MUR } from '../static/js/sim/terrain.js';
import { lavVerden } from '../static/js/sim/world.js';
import { udloes, kanSke } from '../static/js/sim/haendelser.js';
import * as F from '../static/js/sim/physics.js';
import * as B from '../static/js/sim/behaviours.js';
import { VAABEN } from '../static/js/sim/weapons.js';
import { lavRng } from '../static/js/core/rng.js';
import { lavLokaltRum } from '../static/js/net/transport.js';
import { aabneFigurer } from '../static/js/core/roster.js';
import { tjek, overskrift, testFroe, lavHold } from './kort_hjaelp.mjs';

const LAYOUT = { antalHold: 2, prHold: 2 };
const cfgFor = (type) => ({ turTicks: 2700, kampTicks: 108000, vind: true, vejr: 'auto', banetype: type });

/** Det højeste, man kan gå eller hoppe op på i borgen: taget, keepens top
 *  eller gangbroen, plus en tinde (man kan hoppe op på en tand) og lidt til. */
function naaeligTop(froe, layout, t) {
  const plan = fortPlan(layout, t.w, froe, t.fort.reserve ? 'hav' : null);
  const v = plan.variant;
  return Math.max(v.y[v.n], v.yK, v.gangbro ? v.gangbro.y : 0) + v.tinde.h + 8;
}

// ---------------------------------------------------------------- Spil igen

overskrift('Spil igen: hver kamp får en ny bane');
{
  const figurer = [...aabneFigurer()];
  const lavRum = (regel) => {
    const rum = lavLokaltRum({ spillernavn: 'A' });
    const ud = [];
    rum.udsend = (m) => ud.push(JSON.parse(JSON.stringify(m)));
    if (regel) rum.haandter({ t: 'indst', d: { banetype: regel } });
    rum.haandter({ t: 'vaelg', d: { figur: figurer[0] } });
    rum.haandter({ t: 'vaelg', d: { figur: figurer[1], som: 'p_lokal_2' } });
    for (let k = 0; k < 12; k++) { rum.haandter({ t: 'start', d: {} }); rum.haandter({ t: 'slut', d: {} }); }
    return ud.filter((m) => m.t === 'start').map((m) => m.d.indst);
  };
  const kampe = lavRum(null);
  const froe = new Set(kampe.map((k) => k.bane));
  tjek('12 kampe i samme rum får 12 forskellige frø', kampe.length === 12 && froe.size === 12,
    `${kampe.length} kampe, ${froe.size} forskellige frø`);
  const tilf = lavRum('tilfaeldig');
  const typer = new Set(tilf.map((k) => k.banetype));
  // Sandsynligheden for, at 12 rigtige lodtrækninger alle giver samme type, er 4 x 4^-12.
  tjek("reglen 'tilfaeldig' trækkes igen ved hver kamp (12 kampe, mindst to typer)", typer.size >= 2,
    [...typer].join(', '));
}

// ---------------------------------------------------------------- kasserne

overskrift('Fortets forsyningskasser lander, hvor man kan komme op');
{
  const fejl = {}, antal = {};
  for (let i = 0; i < 120; i++) {
    const froe = testFroe(900 + i);
    const t = genererSpilbar(froe, 'fort', 4, LAYOUT).terraen;
    const sil = t.fort.siluet;
    antal[sil] = (antal[sil] || 0) + 1;
    const top = naaeligTop(froe, LAYOUT, t);
    for (const f of t.fort.forter) {
      const daarlig = f.kasser.find((x) => t.overflade(x) > top);
      if (daarlig != null) {
        (fejl[sil] ||= []).push(`frø ${froe} x ${daarlig}: ${t.overflade(daarlig) - top} wu for højt`);
        break;
      }
    }
  }
  for (const sil of Object.keys(antal).sort()) {
    const l = fejl[sil] || [];
    tjek(`${sil}: ingen kasseplads over et tårn, man ikke kan komme op på`, !l.length,
      `${l.length}/${antal[sil]} borge${l.length ? `; ${l.slice(0, 2).join('; ')}` : ''}`);
  }
}

overskrift('Fortets forsyningskasser lander dér, også med vind');
{
  // Rigtige fald med faldskærm (physics.skridtKasse) i vind fra -1,6 til
  // 1,6 med vindstød: landingen (k.y) skal være på noget, man kan nå (højst
  // en tinde over taget, keepens top eller gangbroen), oven på murværket og
  // ikke inde i en mur, og inden for stykket, kassen blev sluppet over.
  const cfg = { ...cfgFor('fort'), vejr: 'solskin' };
  const fejl = {}, antal = {};
  let fald = 0;
  const rng = lavRng(0x6b617373);
  for (let i = 0; i < 60; i++) {
    const froe = testFroe(900 + i);
    const v = lavVerden({ froe, banetype: 'fort', hold: lavHold(2, 2), cfg });
    v.startKamp();
    const t = v.terraen, sil = t.fort.siluet;
    const top = naaeligTop(froe, v.layout, t);
    antal[sil] = (antal[sil] || 0) + 1;
    for (let n = 0; n < 40; n++) {
      const vejr = ['solskin', 'regn', 'slud', 'sne', 'taage'][n % 5];
      const vind0 = (n / 39 - 0.5) * 3.2;
      v.kasser.length = 0;
      const k = v._slipVaabenkasse({ x: 0, y: 0 }, []);
      const stykke = [k.xMin, k.xMax];
      for (let s = 0; !k.landet && s < 4000; s++) F.skridtKasse(t, k, F.vindNu(vind0, vejr, Math.floor(rng() * 1e5) + s, froe));
      fald++;
      let galt = null;
      if (k.xMin == null) galt = 'intet stykke';
      else if (k.x < stykke[0] || k.x > stykke[1]) galt = `drev ud af sit stykke (${Math.round(k.x)} uden for ${stykke})`;
      else if (k.y > top) galt = `landede ${Math.round(k.y - top)} wu over det, man kan nå`;
      else if (k.y < v.vandNiveau) galt = 'sank';
      else if (t.fast(k.x, k.y + 3)) galt = 'landede inde i murværket';
      if (galt) { (fejl[sil] ||= []).push(`frø ${froe} vind ${vind0.toFixed(2)}: ${galt}`); break; }
    }
  }
  for (const sil of Object.keys(antal).sort()) {
    const l = fejl[sil] || [];
    tjek(`${sil}: hver kasse lander, hvor man kan komme op (40 fald pr. borg)`, !l.length,
      `${l.length}/${antal[sil]} borge${l.length ? `; ${l.slice(0, 2).join('; ')}` : ''}`);
  }
  console.log(`  (${fald} fald i alt)`);
}

overskrift('En kasse, der driver ind i en mur, glider ned ad den');
{
  // En lille bane: jord op til y 20 og en mur fra x 100 til 120 op til y 150.
  const t = new Terraen(240, 240);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) {
    if (y <= 20 || (x >= 100 && x <= 120 && y <= 150)) t.maske[t.idx(x, y)] = JORD;
  }
  const fald = (x, y, vind, xMin = null, xMax = null) => {
    const k = { x, y, alder: 0, landet: false, xMin, xMax };
    for (let s = 0; !k.landet && s < 2000; s++) F.skridtKasse(t, k, vind);
    return k;
  };
  const a = fald(90, 140, 1);
  tjek('vind mod muren: kassen lander på jorden ved siden af muren', a.landet && a.x < 100 && a.y <= 22 && !t.fast(a.x, a.y + 2),
    `x ${a.x.toFixed(1)}, y ${a.y.toFixed(1)}`);
  const b = fald(130, 140, -1);
  tjek('og fra den anden side', b.landet && b.x > 120 && b.y <= 22 && !t.fast(b.x, b.y + 2), `x ${b.x.toFixed(1)}, y ${b.y.toFixed(1)}`);
  const c = fald(60, 220, 1);
  tjek('over muren driver den stadig med vinden og lander på toppen', c.landet && c.x >= 100 && c.x <= 120 && Math.abs(c.y - 152) <= 2,
    `x ${c.x.toFixed(1)}, y ${c.y.toFixed(1)}`);
  const d = fald(40, 200, 1.6, 30, 70);
  tjek('med et stykke (xMin, xMax) driver den ikke ud over det', d.landet && d.x <= 70 && d.y <= 22, `x ${d.x.toFixed(1)}, y ${d.y.toFixed(1)}`);
}

// ---------------------------------------------------------------- brandøvelsen

overskrift('Brandøvelsen på fortet stiller kunderne, hvor man kan gå');
{
  const fejl = [];
  let n = 0;
  for (let i = 0; i < 400 && n < 60; i++) {
    const froe = testFroe(1300 + i);
    // Kun de siluetter, hvor kasserne rører et tårn (billigt filter: planen).
    const sil = fortPlan({ antalHold: 2, prHold: 3 }, 5120, froe).siluet;
    if (sil !== 'tvillinger' && sil !== 'bastion') continue;
    const v = lavVerden({ froe, banetype: 'fort', hold: lavHold(2, 3), cfg: cfgFor('fort') });
    v.startKamp();
    const top = naaeligTop(froe, v.layout, v.terraen);
    const e = udloes(v, 'brandoevelse', []);
    n++;
    for (const m of e.flyt || []) if (m.y > top) fejl.push(`frø ${froe} (${sil}): kunde ${m.baever} til y ${m.y}, ${m.y - top} wu over det, man kan nå`);
  }
  tjek(`ingen kunde flyttet op på et tårn (${n} brandøvelser på tvillinger og bastion)`, !fejl.length,
    `${fejl.length}${fejl.length ? `; ${fejl.slice(0, 2).join('; ')}` : ''}`);
}

// ---------------------------------------------------------------- ruinen

overskrift('Ruinen på øen står på jorden');
{
  const fejl = [];
  let n = 0;
  for (let i = 0; i < 1500 && n < 40; i++) {
    const froe = testFroe(2000 + i);
    const plan = fortPlan(LAYOUT, 5120, froe);
    if (plan.landskab.navn !== 'oe' || !plan.landskab.behov.ruin) continue;
    const t = genererSpilbar(froe, 'fort', 4, LAYOUT).terraen;
    if (t.fort.landskab.navn !== 'oe') continue;
    n++;
    const g = t.fort.landskab.huller[0], m = (g.xa + g.xb) / 2, rw = t.fort.landskab.behov.ruin.rw;
    let luftUnder = 0, gab = 0, ikkeJord = 0;
    for (let x = Math.ceil(m - rw); x <= Math.floor(m + rw); x++) {
      let bund = -1;
      for (let y = VAND_NIVEAU; y < t.h; y++) if (t.maske[(t.h - 1 - y) * t.w + x] === MUR) { bund = y; break; }
      if (bund < 0) continue;
      // Den nederste mursten i kolonnen står direkte på jord.
      if (t.maske[(t.h - 1 - (bund - 1)) * t.w + x] !== JORD) ikkeJord++;
      let g2 = 0;
      for (let y = bund - 1; y > VAND_NIVEAU && t.maske[(t.h - 1 - y) * t.w + x] === LUFT; y--) g2++;
      if (g2) { luftUnder++; gab = Math.max(gab, g2); }
    }
    if (luftUnder || ikkeJord) fejl.push(`frø ${froe} (${t.fort.landskab.behov.form}): ${luftUnder} kolonner med op til ${gab} wu luft under, ${ikkeJord} uden jord lige under`);
  }
  tjek(`ingen luft under ruinens fod, og hver kolonne står på jord (${n} øer med ruin)`, !fejl.length,
    `${fejl.length}${fejl.length ? `; ${fejl.slice(0, 2).join('; ')}` : ''}`);
}

overskrift('Grottens loft: stenskred og Kvartalsopkrævning falder ned i grotten');
{
  /** Kør verden, til projektilerne og køen er tomme; saml nedslagene. */
  const koer = (v) => {
    const eks = [];
    for (let i = 0; i < 1500; i++) {
      for (const e of v.skridt()) if (e.navn === 'eksplosion') eks.push({ x: e.x, y: e.y });
      if (!v.projektiler.length && !v.forsinkede.length && !v.eksplosionsKoe.length && i > 60) break;
    }
    return eks;
  };
  const cfg = { ...cfgFor('hule'), vejr: 'solskin' };
  const fejl = { kan: [], sten: [], luft: [] };
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const froe = testFroe(500 + i);
    const v = lavVerden({ froe, banetype: 'hule', hold: lavHold(2, 2), cfg });
    v.startKamp();
    const t = v.terraen;
    if (t.hent(100, t.h - 2) === LUFT) continue;              // kun grotter med loft
    n++;
    // Grottens højeste luft: murstenene dukker op under den og lander i grotten.
    let loft = 0;
    for (let x = 0; x < t.w; x += 16) for (let y = t.h - 17; y > 0; y--) if (t.hent(x, y) === LUFT) { loft = Math.max(loft, y); break; }
    if (!kanSke(v, 'stenskred')) fejl.kan.push(froe);
    udloes(v, 'stenskred', []);
    const sten = koer(v);
    const oppe = sten.filter((e) => e.y > loft);
    if (!sten.length || oppe.length) fejl.sten.push(`frø ${froe}: ${sten.length} nedslag, ${oppe.length} oppe på loftet`);
    // Kvartalsopkrævning med markøren på en kunde på det andet hold.
    const skytte = v.baevere[0], maal = v.baevere.find((b) => b.hold !== skytte.hold);
    B.affyr(v, skytte, VAABEN.traestammeregn, 1, { x: maal.x, y: maal.y + 20, retning: 1 });
    const bomber = koer(v);
    const naer = bomber.filter((e) => Math.abs(e.y - maal.y) < 150);
    if (bomber.length < VAABEN.traestammeregn.luftangreb.antal || bomber.some((e) => e.y > loft) || naer.length * 2 < bomber.length) {
      fejl.luft.push(`frø ${froe}: ${bomber.length} nedslag, ${naer.length} i højde med målet (y ${Math.round(maal.y)})`);
    }
  }
  tjek(`stenskredet kan ske i grotten (${n} grotter)`, n >= 4 && !fejl.kan.length, fejl.kan.join(', '));
  tjek('murstenene lander i grotten, ikke oppe på loftet', !fejl.sten.length, fejl.sten.slice(0, 3).join('; '));
  tjek('Kvartalsopkrævningen rammer hulrummet, markøren står i', !fejl.luft.length, fejl.luft.slice(0, 3).join('; '));

  // På en åben bane kommer luftangrebet stadig skråt ind fra himlen.
  const v = lavVerden({ froe: testFroe(3), banetype: 'aaben', hold: lavHold(2, 2), cfg: cfgFor('aaben') });
  v.startKamp();
  const skytte = v.baevere[0], maal = v.baevere.find((b) => b.hold !== skytte.hold);
  B.affyr(v, skytte, VAABEN.traestammeregn, 1, { x: maal.x, y: maal.y + 20, retning: 1 });
  let foerste = null;
  for (let i = 0; i < 30 && !foerste; i++) { v.skridt(); foerste = v.projektiler[0] || null; }
  tjek('på åbent land dukker luftangrebet op over banen og kommer skråt ind',
    !!foerste && foerste.y > v.terraen.h && foerste.vx > 0, foerste ? `y ${Math.round(foerste.y)}, vx ${foerste.vx}` : 'intet projektil');
}

// ---------------------------------------------------------------- grotten

overskrift('Grottens startpladser ligger i det samme hulrum over vandet');
{
  /** Luftens sammenhængende områder over vandlinjen (4-naboskab, 2 wu). */
  function hulrum(t) {
    const S = 2, fw = Math.ceil(t.w / S), fh = Math.ceil(t.h / S);
    const luft = new Uint8Array(fw * fh);
    for (let cy = 0; cy < fh; cy++) {
      const y = cy * S;
      if (y <= VAND_NIVEAU + 2) continue;
      const o = (t.h - 1 - Math.min(t.h - 1, y)) * t.w;
      for (let cx = 0; cx < fw; cx++) luft[cy * fw + cx] = t.maske[o + Math.min(t.w - 1, cx * S)] === LUFT ? 1 : 0;
    }
    const m = new Int32Array(fw * fh).fill(-1), koe = new Int32Array(fw * fh);
    let n = 0;
    for (let s = 0; s < fw * fh; s++) {
      if (!luft[s] || m[s] >= 0) continue;
      let hd = 0, tl = 0;
      koe[tl++] = s; m[s] = n;
      while (hd < tl) {
        const i = koe[hd++], x = i % fw;
        const nb = [x > 0 ? i - 1 : -1, x < fw - 1 ? i + 1 : -1, i - fw, i + fw];
        for (const j of nb) if (j >= 0 && j < fw * fh && luft[j] && m[j] < 0) { m[j] = n; koe[tl++] = j; }
      }
      n++;
    }
    return (x, y) => m[Math.min(fh - 1, Math.round(y / S)) * fw + Math.min(fw - 1, Math.round(x / S))];
  }
  const fejl = [];
  for (let i = 0; i < 40; i++) {
    const r = genererSpilbar(testFroe(1700 + i), 'hule', 8);
    const rum = hulrum(r.terraen);
    const set = new Set(r.pladser.map((p) => rum(p.x, p.y + 12)));
    if (set.size > 1) fejl.push(`${i} (${r.terraen.arketype}): ${set.size} hulrum`);
  }
  tjek('alle startpladser i ét hulrum (40 grotter)', !fejl.length, fejl.slice(0, 4).join(', '));
}
