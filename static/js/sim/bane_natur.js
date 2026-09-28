/* Kundekrigen — naturbanerne: øer, grotte og åbent land (MapGEN-stil).
 *
 * Hver type har et skema med tre arketyper (baneregler.SKEMAER), og frøet
 * vælger arketype, tema og parametre. Reglerne står i docs/baner.md.
 *
 * Opskriften, fælles for alle tre:
 *   1. Et tæthedsfelt i kvart opløsning (> 0 er fast), bygget af en
 *      højdekurve og former: huler og tunneler skæres ud, søjler, drypsten
 *      og hylder lægges til. Højdekurven TERRASSERES og glattes, så der er
 *      store flader at kæmpe på (erfaringen fra playtest: få spidser, store
 *      flader, lange afstande, vand man kan falde i).
 *   2. En dæmpet domæneforvrængning giver overhæng og karakter.
 *   3. Feltet tærskles bilineært op til fuld opløsning (baneregler.taerskel).
 *   4. Oprydning: enkeltpixels, løse klatter under 900 px og små, lukkede
 *      luftbobler fjernes. Store svævende øer beholdes.
 *   5. Grundfjeld i bunden (og i grottens loft), broer af murværk, hvor
 *      skemaet siger det, pynt efter temaet, og de lukkede lommer markeres
 *      (t.lukket), så ingen starter i en hule, de ikke kan komme ud af.
 * genererSpilbar validerer bagefter (startpladser nok, spredt ud over banen,
 * plads på hver ø) og prøver et afledt frø, hvis banen ikke holder.
 */
'use strict';

import { fbm1, fbm2 } from '../core/rng.js';
import { Terraen, LUFT, JORD } from './terrain.js';
import {
  VAND_NIVEAU as V, SKALA, SKEMAER, vaelgArketype, traekker, taerskel, grofStoej, glat,
  despeckle, ryddOp, grundfjeld, placerPynt, bygBro,
} from './baneregler.js';

export function genererNatur(froe, type, bB, bH) {
  const typ = SKEMAER[type] && type !== 'fort' ? type : 'aaben';
  const valg = vaelgArketype(typ, froe);
  const t = new Terraen(bB, bH);
  const fw = Math.ceil(bB / SKALA) + 1, fh = Math.ceil(bH / SKALA) + 1;
  const F = { fw, fh, d: new Float32Array(fw * fh), bB, bH };
  const B = { t, F, froe, r: traekker(froe, 0x4d2c6dfc), broer: [], oeer: [], info: { arketype: valg.arketype } };
  if (typ === 'oeer') byggOeer(B, valg.arketype, valg.tema);
  else if (typ === 'hule') byggHule(B, valg.arketype);
  else byggAaben(B, valg.arketype);

  const kanter = taerskel(t, F.d, fw, fh, JORD);
  despeckle(t, kanter);
  grundfjeld(t, typ === 'hule');
  ryddOp(t, 900, 260);
  // Broerne. Dalene SKAL have mindst én (skemaets regel); lægges ingen,
  // afviser valideringen banen, og genererSpilbar prøver et nyt frø. En bro
  // kan lukke en lille lomme inde mod bredden: den fyldes.
  t.broer = 0;
  for (const b of B.broer) if (laegBro(t, b)) t.broer++;
  if (t.broer) ryddOp(t, 0, 260);
  t.kraeverBro = typ === 'aaben' && valg.arketype === 'dale';
  t.lukket = lukkedeLommer(t, typ === 'hule');
  t.oeer = B.oeer;                       // øernes x-spand (til valideringen: plads på hver ø)
  t.arketype = valg.arketype;
  t.pyntTema = valg.tema;
  t.pynt = placerPynt(t, valg.tema, froe);
  t.snavs = { x0: 0, y0: 0, x1: bB - 1, y1: bH - 1 };
  t.vandNiveau = V;
  return t;
}

/* ------------------------------------------------------------ feltet */

/** Forvrængningen: to lavfrekvente støjfelter (wu), regnet i et groft gitter. */
function lavWarp(F, froe, styrke) {
  const wx = grofStoej(F.fw, F.fh, 8, (x, y) => (fbm2(x * 0.0013, y * 0.0013, froe, 2) - 0.5) * 2 * styrke);
  const wy = grofStoej(F.fw, F.fh, 8, (x, y) => (fbm2(x * 0.0013 + 5.2, y * 0.0013 + 1.7, froe ^ 0x55, 2) - 0.5) * 2 * styrke);
  return { wx, wy, halv: 0.5 };
}

/** Højdekurven (wu pr. feltkolonne) ind i feltet, set gennem forvrængningen. */
function profilTilFelt(F, top, warp, sat = 240) {
  const { fw, fh, d } = F;
  for (let cy = 0; cy < fh; cy++) {
    for (let cx = 0; cx < fw; cx++) {
      const i = cy * fw + cx;
      const px = cx * SKALA + warp.wx[i], py = cy * SKALA + warp.wy[i];
      let hx = Math.round(px / SKALA);
      hx = hx < 0 ? 0 : hx >= fw ? fw - 1 : hx;
      const v = top[hx] - py;
      d[i] = v > sat ? sat : v < -sat ? -sat : v;
    }
  }
}

/** En form i feltet inden for en kasse (wu). fn(x, y) giver en afstand med
 *  fortegn i wu: negativ inde i formen. skaer = luft (hule, tunnel), ellers
 *  lægges formen til (søjle, drypsten, hylde). Formen ses gennem en halv
 *  forvrængning, så kanterne bliver naturlige. */
function form(F, warp, x0, y0, x1, y1, fn, skaer) {
  const { fw, fh, d } = F;
  const c0 = Math.max(0, Math.floor(x0 / SKALA) - 12), c1 = Math.min(fw - 1, Math.ceil(x1 / SKALA) + 12);
  const r0 = Math.max(0, Math.floor(y0 / SKALA) - 12), r1 = Math.min(fh - 1, Math.ceil(y1 / SKALA) + 12);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const i = cy * fw + cx;
      const px = cx * SKALA + warp.wx[i] * warp.halv, py = cy * SKALA + warp.wy[i] * warp.halv;
      const v = fn(px, py);
      if (skaer) { if (v < d[i]) d[i] = v; } else if (-v > d[i]) d[i] = -v;
    }
  }
}

const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);

function afstandSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(x - ax - u * dx, y - ay - u * dy);
}

/** En tunnel gennem punkterne [[x, y, r?], …]: radius r (eller pr. punkt,
 *  glidende langs gangen). */
function tunnel(F, warp, pkt, r = 50) {
  for (let i = 0; i + 1 < pkt.length; i++) {
    const [ax, ay, ra = r] = pkt[i], [bx, by, rb = r] = pkt[i + 1];
    const rm = Math.max(ra, rb);
    form(F, warp, Math.min(ax, bx) - rm, Math.min(ay, by) - rm, Math.max(ax, bx) + rm, Math.max(ay, by) + rm, (x, y) => {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      return Math.hypot(x - ax - u * dx, y - ay - u * dy) - (ra + (rb - ra) * u);
    }, true);
  }
}

/** En spids (drypsten): fra basis (bredde b) i by til spidsen i ty. */
function spids(F, warp, cx, by, ty, b) {
  const lo = Math.min(by, ty), hi = Math.max(by, ty);
  form(F, warp, cx - b, lo, cx + b, hi, (x, y) => {
    if (y < lo || y > hi) return 40;
    const u = Math.abs(y - ty) / Math.abs(by - ty);        // 0 ved spidsen, 1 ved basis
    return Math.abs(x - cx) - (b / 2) * Math.pow(u, 0.8);
  }, false);
}

/** Vandret boksblur — dét, der forvandler takker til flader. */
function boksBlur(kilde, radius) {
  const n = kilde.length, ud = new Float32Array(n), vindue = radius * 2 + 1;
  const k = (i) => (i < 0 ? 0 : i >= n ? n - 1 : i);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += kilde[k(i)];
  for (let x = 0; x < n; x++) {
    ud[x] = sum / vindue;
    sum -= kilde[k(x - radius)];
    sum += kilde[k(x + radius + 1)];
  }
  return ud;
}

/** Terrassér en højdekurve (store flader) og glat den vandret. */
function terrasser(top, trin, styrke, blod) {
  for (let x = 0; x < top.length; x++) {
    const h = top[x], s = Math.round(h / trin) * trin;
    top[x] = h + (s - h) * styrke;
  }
  return blod > 0 ? boksBlur(top, blod) : top;
}

/** Højden (0-1) af et bjerg eller en ø i afstanden u (0 = midten, 1 = kanten);
 *  su er afstanden med fortegn (til den skæve klint). Toppene er flade nok
 *  til at stå på. */
function bjerg(formNavn, u, su = u) {
  switch (formNavn) {
    case 'kegle': return Math.min(1, 1.18 * Math.pow(Math.max(0, 1 - Math.pow(u, 1.5)), 1.5));
    case 'plateau': return 1 - glat((u - 0.45) / 0.55);
    case 'to': return (1 - glat((u - 0.58) / 0.42)) * (0.68 + 0.32 * glat(u / 0.42));
    case 'klint': return su < 0 ? Math.pow(Math.cos(Math.min(1, u) * Math.PI / 2), 1.2) : 1 - glat((u - 0.72) / 0.28);
    default: return Math.min(1, 1.1 * Math.pow(Math.cos(Math.min(1, u) * Math.PI / 2), 1.3));
  }
}

/* ------------------------------------------------------------ øer
 *
 * Arketyper:
 *   skaergaard  4-7 øer i en række med sund imellem (90-400 wu, altid
 *               kortere end et fuldt Tonerkanon-skud); broer over nogle af
 *               de smalle
 *   hovedoe     én stor ø (40-56 % af banen) med flere toppe, en hule og en
 *               bue, og 2-4 småøer omkring
 *   tvillinger  to store øer over for hinanden med et sund og måske et par
 *               skær midt i
 * Hver ø har en form (kegle, plateau, to toppe, bakke eller klint), og mange
 * er underskåret ved vandlinjen (overhæng som i Worms). Temaet (eng, skov,
 * klippe, strand) bestemmer pynten og gør klippeøer stejlere.
 */
function byggOeer(B, arketype, tema) {
  const { F, r } = B;
  const bB = F.bB, fw = F.fw;
  const kant = 150;
  const former = tema === 'klippe' ? ['klint', 'kegle', 'plateau', 'to'] : tema === 'strand' ? ['bakke', 'plateau', 'to'] : ['kegle', 'plateau', 'to', 'bakke', 'klint'];
  const vaelgForm = () => former[Math.floor(r() * former.length)];
  const oeer = [];                  // { cx, hw, top, form, retn, under }
  const ny = (cx, hw, top, fForm = vaelgForm()) => oeer.push({ cx, hw, top, form: fForm, retn: r() < 0.5 ? -1 : 1, under: r() < (tema === 'klippe' ? 0.7 : 0.45) });

  if (arketype === 'skaergaard') {
    const n = r.heltal(4, 7);
    const huller = [];
    for (let i = 0; i < n - 1; i++) huller.push(r.heltal(90, 400));
    const land = bB - 2 * kant - huller.reduce((a, b) => a + b, 0);
    const v = []; for (let i = 0; i < n; i++) v.push(r.mellem(0.6, 1.5));
    const sv = v.reduce((a, b) => a + b, 0);
    let x = kant;
    for (let i = 0; i < n; i++) {
      const b = land * v[i] / sv;
      ny(x + b / 2, b / 2, V + Math.min(560, 90 + r.mellem(0.35, 1) * b * 0.55));
      x += b + (huller[i] || 0);
      if (i < n - 1 && huller[i] < 270 && r() < 0.5) B.broer.push({ xm: x - huller[i] / 2, hw: huller[i] / 2 });
    }
  } else if (arketype === 'hovedoe') {
    const hw = bB * r.mellem(0.2, 0.28), cx = bB / 2 + bB * r.mellem(-0.08, 0.08);
    ny(cx, hw, V + r.mellem(420, 680), r() < 0.5 ? 'to' : 'bakke');
    oeer[0].under = true;
    oeer[0].hovedoe = true;
    // småøerne på begge sider
    for (const side of [-1, 1]) {
      let x = cx + side * hw;
      const m = r.heltal(1, 2);
      for (let j = 0; j < m; j++) {
        const hul = r.heltal(100, 320), b = r.heltal(170, 380);
        const c = x + side * (hul + b / 2);
        if (c - b / 2 < kant || c + b / 2 > bB - kant) break;
        ny(c, b / 2, V + r.mellem(90, 300));
        if (hul < 260 && r() < 0.5) B.broer.push({ xm: x + side * hul / 2, hw: hul / 2 });
        x = c + side * b / 2;
      }
    }
  } else {
    // tvillinger: to store øer og et sund
    const sund = r.heltal(180, 420), mid = bB / 2 + r.heltal(-200, 200);
    for (const side of [-1, 1]) {
      const hw = Math.min((side < 0 ? mid - sund / 2 - kant : bB - kant - mid - sund / 2) / 2, bB * r.mellem(0.15, 0.21));
      const cx = mid + side * (sund / 2 + hw);
      ny(cx, hw, V + r.mellem(320, 600), r() < 0.5 ? 'to' : vaelgForm());
      oeer[oeer.length - 1].retn = -side;             // klinten vender ud mod sundet
    }
    const skaer = r.heltal(0, 2);
    for (let j = 0; j < skaer; j++) {
      const c = mid + (skaer === 1 ? 0 : (j ? 1 : -1) * sund * 0.22);
      ny(c, r.heltal(30, 60), V + r.mellem(40, 170), 'kegle');
    }
  }

  // Højdekurven: den højeste ø i hver kolonne, over en jævn havbund.
  const hFroe = (B.froe ^ 0x9e3779b9) >>> 0;
  const top = new Float32Array(fw);
  for (let cx = 0; cx < fw; cx++) {
    const x = cx * SKALA;
    let h = V - 170 + (fbm1(x * 0.003, hFroe, 2) - 0.5) * 60;
    for (const o of oeer) {
      const sa = (x - o.cx) / o.hw, a = Math.abs(sa);
      let hh;
      if (a <= 1) hh = V + (o.top - V) * bjerg(o.form, a, sa * o.retn) + (fbm1(x * 0.004, hFroe ^ 7, 3) - 0.5) * 90 * (1 - a * a);
      else hh = V - (a - 1) * o.hw * 1.2;
      if (a <= 0.97) hh = Math.max(hh, V + 8);
      if (hh > h) h = hh;
    }
    top[cx] = h;
  }
  const glattet = terrasser(top, tema === 'klippe' ? 90 : 110, 0.55, 5);
  const warp = lavWarp(F, (B.froe * 2654435761) >>> 0, tema === 'klippe' ? 44 : 34);
  profilTilFelt(F, glattet, warp);

  // Underskårne kyster (overhæng ved vandlinjen) og huler i de store øer.
  for (const o of oeer) {
    if (o.under && o.hw > 90) {
      for (const sd of [-1, 1]) {
        const ex = o.cx + sd * o.hw * 0.9, rx = o.hw * r.mellem(0.14, 0.26), ry = r.mellem(40, 80);
        form(F, warp, ex - rx, V - ry, ex + rx, V + 30 + ry, ellipse(ex, V + 26, rx, ry), true);
      }
    }
    if (o.hw >= 300 && r() < (o.hovedoe ? 1 : 0.5)) {
      // en hule i øen og måske en bue gennem den
      const hx = o.cx + o.hw * r.mellem(-0.4, 0.4), hy = V + (o.top - V) * r.mellem(0.3, 0.5);
      const rx = r.mellem(70, 150), ry = r.mellem(40, 70);
      form(F, warp, hx - rx, hy - ry, hx + rx, hy + ry, ellipse(hx, hy, rx, ry), true);
      if (o.hovedoe || r() < 0.4) {
        const bx = o.cx + o.hw * (r() < 0.5 ? -0.55 : 0.55), br = r.mellem(50, 80);
        form(F, warp, bx - br, V - 60, bx + br, V + 110, (x, y) => Math.max(ellipse(bx, V + 20, br, 90)(x, y), V - 40 - y), true);
      }
    }
  }
  B.oeer = oeer.filter((o) => o.top - V >= 60 && o.hw >= 80).map((o) => ({ x0: Math.round(o.cx - o.hw), x1: Math.round(o.cx + o.hw) }));
  B.info.oeer = oeer.length;
}

/* ------------------------------------------------------------ grotten
 *
 * Alt er klippe fra havbunden til banens top (med grundfjeld i loftet), og
 * grotten skæres ud. Vandet står i bunden: gulvet dykker ned under
 * vandlinjen i søer. Arketyper:
 *   storhal    én stor hal næsten hele banen bred, med søjler (nogle brækket),
 *              drypsten fra loftet og fra gulvet og hylder på væggene
 *   kamre      3-5 kamre i forskellige højder, forbundet af tunneler, man
 *              kan gå igennem (og måske en ekstra tunnel højere oppe)
 *   tunnelnet  tunneler i tre lag på tværs af banen, skrå ramper imellem og
 *              små kamre, hvor de mødes
 * Alle kamre, man kan nå fra en startplads, har gulv at stå på; lukkede
 * lommer markeres, så ingen starter i dem.
 */
function byggHule(B, arketype) {
  const { F, r } = B;
  const bB = F.bB, fw = F.fw;
  F.d.fill(240);
  // Fuld forvrængning i grotten: hulerne skal være organiske, ikke kasser.
  const warp = lavWarp(F, (B.froe * 2654435761) >>> 0, 40);
  warp.halv = 1;
  const gFroe = (B.froe ^ 0x27d4eb2f) >>> 0;
  // Gulv og loft regnes én gang pr. feltkolonne.
  const kol = (f) => { const a = new Float32Array(fw); for (let cx = 0; cx < fw; cx++) a[cx] = f(cx * SKALA); return a; };
  const ved = (arr, x) => arr[x <= 0 ? 0 : x >= (fw - 1) * SKALA ? fw - 1 : Math.round(x / SKALA)];
  const terrasse = (y, trin = 70) => y + (Math.round(y / trin) * trin - y) * 0.5;
  const drypsten = (x0, x1, loft, gulv, n) => {
    for (let i = 0; i < n; i++) {
      const cx = x0 + (x1 - x0) * (i + 0.15 + r() * 0.7) / n, yl = ved(loft, cx), yg = ved(gulv, cx);
      const l = Math.min(r.mellem(60, 200), (yl - yg) * 0.42);
      if (l > 40) spids(F, warp, cx, yl + 40, yl - l, r.mellem(26, 70));
    }
  };

  if (arketype === 'storhal') {
    // Én stor hal med søer i gulvet, søjler, drypsten og hylder.
    const x0 = bB * r.mellem(0.04, 0.08), x1 = bB * (1 - r.mellem(0.04, 0.08));
    const gulvB = V + r.mellem(120, 190), loftB = V + r.mellem(700, 940);
    const soer = [];
    for (let i = 0, n = r.heltal(2, 4); i < n; i++) soer.push({ x: x0 + (x1 - x0) * (i + 0.5) / n + r.mellem(-150, 150), b: r.mellem(110, 220) });
    const gulv = kol((x) => {
      let y = terrasse(gulvB + (fbm1(x * 0.0025, gFroe, 3) - 0.5) * 200, 80);
      for (const s of soer) { const a = Math.abs(x - s.x) / s.b; if (a < 1) y -= (y - (V - 60)) * (1 - glat(a)); }
      return y;
    });
    const R = 320;
    const loft = kol((x) => {
      const g = ved(gulv, x);
      let l = Math.max(g + 300, loftB + (fbm1(x * 0.0018 + 9, gFroe ^ 3, 3) - 0.5) * 380);
      const dEnde = Math.min(x - x0, x1 - x);
      if (dEnde < R) l = g + (l - g) * Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.max(0, dEnde) / R, 2)));
      return l;
    });
    form(F, warp, x0, V - 150, x1, loftB + 320, (x, y) => (x < x0 || x > x1 ? 60 : Math.max(ved(gulv, x) - y, y - ved(loft, x))), true);
    // søjler fra gulv til loft, bredest ved fod og top. Hver søjle står på
    // to ben med en bue imellem, så man kan gå igennem (i 2D er en hel søjle
    // en mur); nogle er brækket over på midten i stedet.
    const ns = r.heltal(2, 5);
    for (let i = 0; i < ns; i++) {
      const cx = x0 + (x1 - x0) * (i + 0.5) / ns + r.mellem(-120, 120), b = r.mellem(50, 120) / 2;
      const yg = ved(gulv, cx) - 30, yl = ved(loft, cx) + 30, brud = r() < 0.4;
      const hul0 = yg + (yl - yg) * r.mellem(0.3, 0.5), hul1 = hul0 + r.mellem(90, 160);
      const bueH = Math.max(ved(gulv, cx), V + 40) + r.mellem(100, 140);
      // aldrig i en sø (så ville buen stå under vandet og søjlen lukke hallen)
      if (yl - yg < 250 || soer.some((s) => Math.abs(cx - s.x) < s.b + b * 1.7 + 60)) continue;
      form(F, warp, cx - b * 1.7, yg, cx + b * 1.7, yl, (x, y) => {
        if (y < yg || y > yl || (brud && y > hul0 && y < hul1)) return 50;
        const u = (y - yg) / (yl - yg), bred = b * (1 + 0.7 * Math.pow(Math.abs(u - 0.5) * 2, 3));
        const ud = Math.abs(x - cx) - bred;
        if (brud) return ud;
        // buen mellem benene: rund top, benene 18 wu
        const bw = Math.max(20, bred - 18), bu = Math.abs(x - cx) / bw;
        if (bu < 1 && y < bueH - 40 * (1 - Math.sqrt(1 - bu * bu))) return 1;
        return ud;
      }, false);
    }
    drypsten(x0 + 150, x1 - 150, loft, gulv, r.heltal(5, 11));
    // drypsten fra gulvet
    for (let i = 0, n = r.heltal(3, 6); i < n; i++) {
      const cx = x0 + 250 + (x1 - x0 - 500) * r(), y = ved(gulv, cx);
      if (y > V + 60) spids(F, warp, cx, y - 30, y + r.mellem(40, 120), r.mellem(30, 64));
    }
    // hylder: plader ud fra væggen og søjlerne
    for (let i = 0, n = r.heltal(2, 4); i < n; i++) {
      const cx = x0 + 300 + (x1 - x0 - 600) * r(), hw = r.mellem(60, 120), cy = ved(gulv, cx) + r.mellem(180, 300);
      if (cy + 110 > ved(loft, cx)) continue;
      form(F, warp, cx - hw, cy - 24, cx + hw, cy + 24, (x, y) => Math.max(Math.abs(x - cx) - hw, Math.abs(y - cy) - 16), false);
    }
    B.info.kamre = 1;
  } else if (arketype === 'kamre') {
    // 3-5 kamre i forskellige højder, forbundet af gangbare tunneler.
    const n = r.heltal(3, 5);
    const kamre = [];
    const bred = (bB - 300) / n;
    for (let i = 0; i < n; i++) {
      const w = bred * r.mellem(0.6, 0.88), cx = 150 + bred * (i + 0.5) + r.mellem(-0.07, 0.07) * bred;
      const lav = r() < (i === 0 || i === n - 1 ? 0.5 : 0.25);
      const gulv0 = lav ? V + r.mellem(60, 110) : V + r.mellem(130, 560);
      kamre.push({ cx, w, gulv0, h: r.mellem(270, 440), p: r.mellem(2.2, 3.4) });
    }
    // Vandet står i bunden: det laveste kammer (og måske det næstlaveste)
    // har en sø i gulvet.
    const efterHoejde = kamre.slice().sort((a, b) => a.gulv0 - b.gulv0);
    if (efterHoejde[0].gulv0 > V + 110) efterHoejde[0].gulv0 = V + r.mellem(60, 110);
    for (let j = 0; j < (r() < 0.5 ? 2 : 1); j++) {
      const k = efterHoejde[j];
      k.soe = { x: k.cx + k.w * r.mellem(-0.2, 0.2), b: Math.min(k.w * 0.3, r.mellem(110, 200)) };
    }
    for (const k of kamre) {
      const { cx, w, gulv0, h, p } = k;
      const hw = w / 2;
      k.gulv = (x) => {
        const a = Math.abs(x - cx) / hw;
        let y = terrasse(gulv0 + (fbm1(x * 0.004, gFroe, 2) - 0.5) * 80) + 150 * glat((a - 0.7) / 0.3);
        if (k.soe) { const u = Math.abs(x - k.soe.x) / k.soe.b; if (u < 1) y -= (y - (V - 60)) * (1 - glat(u)); }
        return y;
      };
      k.loft = (x) => {
        const a = Math.min(1, Math.abs(x - cx) / hw);
        return gulv0 + h * Math.pow(Math.max(0, 1 - Math.pow(a, p)), 1 / p) * (0.86 + 0.28 * fbm1(x * 0.003 + 4, gFroe ^ 9, 2));
      };
      const gA = kol(k.gulv), lA = kol(k.loft);
      form(F, warp, cx - hw, Math.min(gulv0 - 120, V - 100), cx + hw, gulv0 + h * 1.2, (x, y) => (Math.abs(x - cx) > hw ? 60 : Math.max(ved(gA, x) - y, y - ved(lA, x))), true);
      drypsten(cx - hw * 0.6, cx + hw * 0.6, lA, gA, r.heltal(1, 3));
    }
    // tunnelerne mellem nabokamrene: bred nok og ikke stejlere end ~45°
    for (let i = 0; i + 1 < n; i++) {
      const a = kamre[i], b = kamre[i + 1];
      const ax = a.cx + a.w * 0.36, bx = b.cx - b.w * 0.36;
      const ay = a.gulv(ax) + 56, by = b.gulv(bx) + 56;
      const mx = (ax + bx) / 2, my = (ay + by) / 2 + r.mellem(-30, 50);
      tunnel(F, warp, [[ax - 40, ay], [mx, my], [bx + 40, by]], r.mellem(46, 62));
    }
    if (n >= 3 && r() < 0.6) {
      // en ekstra, højere tunnel over et kammer
      const i = r.heltal(0, n - 3), a = kamre[i], c = kamre[i + 2];
      const ay = a.gulv0 + a.h * 0.6, cy = c.gulv0 + c.h * 0.6, top = Math.max(ay, cy) + r.mellem(140, 240);
      tunnel(F, warp, [[a.cx + a.w * 0.25, ay], [(a.cx + c.cx) / 2, top], [c.cx - c.w * 0.25, cy]], r.mellem(44, 56));
    }
    B.info.kamre = n;
  } else {
    // tunnelnet: tre lag på tværs, skrå ramper imellem, kamre, hvor de mødes,
    // og en stor sø i bunden
    const lag = [V + r.mellem(160, 220), V + r.mellem(440, 520), V + r.mellem(720, 820)];
    const linjer = [];
    for (let l = 0; l < 3; l++) {
      const pkt = [];
      const x0 = r.mellem(160, 420), x1 = bB - r.mellem(160, 420);
      for (let x = x0; x <= x1 + 1; x += r.mellem(300, 480)) pkt.push([Math.min(x, x1), lag[l] + r.mellem(-70, 70), r.mellem(48, 78)]);
      const brud = l > 0 && r() < 0.5 ? r.heltal(1, pkt.length - 2) : -1;
      if (brud > 0) { tunnel(F, warp, pkt.slice(0, brud + 1)); tunnel(F, warp, pkt.slice(brud + 1)); }
      else tunnel(F, warp, pkt);
      linjer.push(pkt);
    }
    const hoejde = (pkt, x) => {
      for (let i = 0; i + 1 < pkt.length; i++) if (x >= pkt[i][0] && x <= pkt[i + 1][0]) return pkt[i][1] + (pkt[i + 1][1] - pkt[i][1]) * (x - pkt[i][0]) / (pkt[i + 1][0] - pkt[i][0] || 1);
      return x < pkt[0][0] ? pkt[0][1] : pkt[pkt.length - 1][1];
    };
    const nr = r.heltal(4, 7);
    for (let i = 0; i < nr; i++) {
      const l = i % 2;
      const x = 450 + (bB - 900) * (i + r()) / nr, retn = r() < 0.5 ? -1 : 1;
      const ya = hoejde(linjer[l], x), dx = retn * r.mellem(300, 420), yb = hoejde(linjer[l + 1], x + dx);
      tunnel(F, warp, [[x, ya, 50], [x + dx / 2, (ya + yb) / 2, 56], [x + dx, yb, 50]]);
    }
    for (let i = 0, n = r.heltal(3, 6); i < n; i++) {
      const l = r.heltal(0, 2), x = 450 + (bB - 900) * r(), y = hoejde(linjer[l], x) + 40;
      const rx = r.mellem(130, 230), ry = r.mellem(90, 140);
      form(F, warp, x - rx, y - ry, x + rx, y + ry * 1.3, (px, py) => Math.max(ellipse(x, y + ry * 0.3, rx, ry)(px, py), hoejde(linjer[l], px) - 50 - py), true);
    }
    const sx = bB * r.mellem(0.3, 0.7), sw = r.mellem(320, 620);
    form(F, warp, sx - sw, V - 170, sx + sw, lag[0] + 40, (x, y) => ellipse(sx, V - 10, sw, lag[0] + 20 - V)(x, y), true);
    B.info.kamre = 3;
  }
}

/* ------------------------------------------------------------ åbent land
 *
 * Arketyper:
 *   bjergkaede  3-5 bjerge med dale og kanaler imellem, overhængende klinter
 *               og en bue eller hule gennem et af bjergene
 *   dale        bølgende land med 2-4 dale, hver med en kanal i bunden, og
 *               broer over 1-3 af kanalerne
 *   plateauer   3-5 flade plateauer i forskellige højder med stejle klinter,
 *               måske et trin; kanaler eller lave sadler imellem, broer over
 *               nogle af kanalerne og huler under plateauerne
 * Banens ender går altid ned i havet, så ingen kan campe i et hjørne.
 */
function byggAaben(B, arketype) {
  const { F, r } = B;
  const bB = F.bB, fw = F.fw;
  const hFroe = (B.froe ^ 0x9e3779b9) >>> 0;
  const top = new Float32Array(fw);
  const kanaler = [];                  // { x, hw } — vand i bunden
  const X = (cx) => cx * SKALA;

  if (arketype === 'bjergkaede') {
    const n = r.heltal(3, 5);
    const bjerge = [];
    for (let i = 0; i < n; i++) {
      const cx = bB * (0.1 + 0.8 * (i + 0.5) / n) + r.mellem(-0.35, 0.35) * bB * 0.8 / n;
      bjerge.push({ cx, hw: bB * r.mellem(0.06, 0.13), h: V + r.mellem(300, 760), form: ['kegle', 'to', 'plateau', 'klint'][r.heltal(0, 3)], retn: r() < 0.5 ? -1 : 1 });
    }
    for (let i = 0; i + 1 < n; i++) if (r() < 0.65) kanaler.push({ x: (bjerge[i].cx + bjerge[i + 1].cx) / 2 + r.mellem(-60, 60), hw: r.mellem(90, 170) });
    const bund = V + r.mellem(60, 220);
    for (let cx = 0; cx < fw; cx++) {
      const x = X(cx);
      let h = bund + (fbm1(x * 0.0015, hFroe, 2) - 0.5) * 160;
      for (const b of bjerge) {
        const sa = (x - b.cx) / b.hw, a = Math.abs(sa);
        if (a < 1.6) h = Math.max(h, bund + (b.h - bund) * bjerg(b.form, Math.min(1, a / 1.6), sa * b.retn));
      }
      top[cx] = h + (fbm1(x * 0.006, hFroe ^ 5, 2) - 0.5) * 40;
    }
    B.info.bjerge = n;
    B.bjerge = bjerge;
  } else if (arketype === 'dale') {
    // Bølgende bakker; dalene er brede med skrå sider og en kanal i bunden.
    const basis = V + r.mellem(180, 420), amp = r.mellem(120, 260);
    const n = r.heltal(2, 4);
    for (let i = 0; i < n; i++) kanaler.push({ x: bB * (0.12 + 0.76 * (i + 0.5) / n) + r.mellem(-0.3, 0.3) * bB * 0.76 / n, hw: r.mellem(90, 150), dal: r.mellem(320, 640) });
    for (let cx = 0; cx < fw; cx++) {
      const x = X(cx);
      let h = basis + (fbm1(x * 0.0011, hFroe, 3, 0.5) - 0.5) * 2 * amp + (fbm1(x * 0.004, hFroe ^ 11, 2) - 0.5) * 60;
      for (const k of kanaler) {
        const a = Math.abs(x - k.x);
        if (a < k.dal) h -= (h - (V + 30)) * Math.pow(1 - glat((a - k.hw) / (k.dal - k.hw)), 1.4);   // dalen skråner ned mod kanalen
      }
      top[cx] = h;
    }
    B.info.dale = n;
  } else {
    // plateauer
    const n = r.heltal(3, 5);
    const brug = bB * 0.84, x0 = bB * 0.08;
    const v = []; for (let i = 0; i < n; i++) v.push(r.mellem(0.5, 1.6));
    const sv = v.reduce((a, b) => a + b, 0);
    const plat = [];
    let x = x0;
    for (let i = 0; i < n; i++) {
      const b = brug * v[i] / sv;
      plat.push({ a: x, b: x + b, h: V + r.mellem(160, 700), trin: r() < 0.45 ? { side: r() < 0.5 ? -1 : 1, dh: r.mellem(80, 170), bred: b * r.mellem(0.2, 0.35) } : null });
      x += b;
    }
    for (let i = 0; i + 1 < n; i++) {
      const g = plat[i].b;
      if (r() < 0.7) kanaler.push({ x: g, hw: r.mellem(90, 160), klint: true });
    }
    const bund = V + r.mellem(60, 140);
    for (let cx = 0; cx < fw; cx++) {
      const xx = X(cx);
      let h = bund;
      for (const p of plat) {
        const blod = 46;
        const ind = Math.min(glat((xx - p.a + blod) / (2 * blod)), glat((p.b - xx + blod) / (2 * blod)));
        let ph = p.h;
        if (p.trin) {
          const iTrin = p.trin.side < 0 ? xx < p.a + p.trin.bred : xx > p.b - p.trin.bred;
          if (iTrin) ph -= p.trin.dh;
        }
        h = Math.max(h, bund + (ph - bund) * ind);
      }
      top[cx] = h + (fbm1(xx * 0.005, hFroe ^ 3, 2) - 0.5) * 24;
    }
    B.info.plateauer = n;
    B.plat = plat;
  }

  // Kanalerne ned gennem havoverfladen, og banens ender ned i havet.
  const havbund = V - 150;
  for (let cx = 0; cx < fw; cx++) {
    const x = X(cx);
    for (const k of kanaler) {
      const d = Math.abs(x - k.x) / k.hw;
      if (d >= 1) continue;
      const dyb = 0.5 + 0.5 * Math.cos(d * Math.PI);
      top[cx] = Math.min(top[cx], top[cx] + (havbund + (1 - dyb) * 260 - top[cx]) * dyb);
    }
    const kant = Math.min(x, bB - 1 - x) / (bB * 0.07);
    if (kant < 1) { const t2 = 1 - kant; top[cx] = Math.min(top[cx], top[cx] + (havbund - top[cx]) * t2 * t2); }
  }
  const glattet = terrasser(top, arketype === 'plateauer' ? 70 : 120, arketype === 'plateauer' ? 0.35 : arketype === 'dale' ? 0.45 : 0.62, arketype === 'plateauer' ? 3 : 7);
  const warp = lavWarp(F, (B.froe * 2654435761) >>> 0, arketype === 'bjergkaede' ? 46 : 32);
  profilTilFelt(F, glattet, warp);

  // Huler og overhæng
  const cFroe = (B.froe ^ 0x85ebca6b) >>> 0;
  // Hvor bjergets side er i højden y (søgt ud fra toppen i retning sd).
  const side = (cx0, sd, y, maks) => {
    let c = Math.round(cx0 / SKALA);
    const stop = Math.round((cx0 + sd * maks) / SKALA);
    while (c > 0 && c < fw - 1 && glattet[c] > y && c !== stop) c += sd;
    return glattet[c] > y ? null : c * SKALA;       // null: bjerget går i ét med naboen
  };
  if (arketype === 'bjergkaede') {
    for (const b of B.bjerge) {
      // overhængende klint: en udhuling lige under kanten på bjergets side,
      // så klinten hænger ud over den
      if (r() < 0.7) {
        const sd = r() < 0.5 ? -1 : 1, ey = V + (b.h - V) * r.mellem(0.35, 0.6);
        const rx = r.mellem(70, 130), ry = rx * r.mellem(0.5, 0.75);
        const sx = side(b.cx, sd, ey + ry * 0.6, b.hw * 1.7);
        if (sx == null) continue;
        const ex = sx + sd * rx * 0.35;
        form(F, warp, ex - rx, ey - ry, ex + rx, ey + ry, ellipse(ex, ey, rx, ry), true);
      }
    }
    // en bue (kort tunnel gennem bjergets kerne) eller en hule
    const b = B.bjerge[r.heltal(0, B.bjerge.length - 1)];
    const by = V + (b.h - V) * r.mellem(0.25, 0.4);
    const va = side(b.cx, -1, by + 60, b.hw * 1.3), ha = side(b.cx, 1, by + 60, b.hw * 1.3);
    // Kun gennem et smalt bjerg (ellers bliver det en lang sprække under en
    // tynd plade), og med buens top højest på midten.
    if (r() < 0.6 && va != null && ha != null && ha - va > 160 && ha - va < 620) tunnel(F, warp, [[va - 30, by], [(va + ha) / 2, by + r.mellem(40, 80)], [ha + 30, by]], r.mellem(48, 64));
    else form(F, warp, b.cx - 160, by - 90, b.cx + 160, by + 90, ellipse(b.cx, by, r.mellem(100, 160), r.mellem(60, 90)), true);
  } else if (arketype === 'plateauer') {
    for (const p of B.plat) {
      if (r() < 0.55) {
        const ex = p.a + (p.b - p.a) * r.mellem(0.25, 0.75), ey = V + (p.h - V) * r.mellem(0.25, 0.45);
        const rx = Math.min((p.b - p.a) * 0.3, r.mellem(90, 180)), ry = r.mellem(50, 90);
        form(F, warp, ex - rx, ey - ry, ex + rx, ey + ry, (x, y) => Math.max(ellipse(ex, ey, rx, ry)(x, y), ey - ry * 0.4 - y), true);
      }
    }
  }
  // Lidt hulestøj dybt inde i landet, som på de gamle baner.
  const { fw: w2, fh: h2, d } = F;
  const hule = grofStoej(w2, h2, 2, (x, y) => fbm2(x * 0.0022, y * 0.003, cFroe, 3));
  for (let cy = 0; cy < h2; cy++) {
    for (let cx = 0; cx < w2; cx++) {
      const i = cy * w2 + cx;
      if (d[i] < 110) continue;
      const c = hule[i];
      if (c > 0.66) d[i] -= (c - 0.66) * 2600 * Math.min(1, (d[i] - 110) / 130);
    }
  }
  // Broerne over kanalerne (dale: 1-3; plateauer og bjerge: måske).
  const broChance = arketype === 'dale' ? 0.75 : arketype === 'plateauer' ? 0.5 : 0.3;
  let broer = 0;
  for (const k of kanaler) {
    if (r() < broChance || (arketype === 'dale' && broer === 0 && k === kanaler[kanaler.length - 1])) {
      B.broer.push({ xm: k.x, hw: k.hw });
      broer++;
    }
  }
  B.info.kanaler = kanaler.length;
  B.info.broer = broer;
}

/* ------------------------------------------------------------ broerne
 *
 * En bro over en kanal eller et sund: dækket hviler på land i begge ender i
 * den laveste af de to bredders højde, med pæle ned til bunden. Ender dækket
 * i luften (ingen bred inden for rækkevidde), lægges den ikke.
 */
function laegBro(t, b) {
  const top = (x) => t.overflade(Math.round(x));
  const soeg = (fra, retn) => {
    // Bredden: det højeste sted på land inden for 220 wu fra kanalens kant.
    let bedst = -1, bx = -1;
    for (let d = 0; d <= 220; d += 4) {
      const x = Math.round(fra + retn * d), y = top(x);
      if (y > bedst) { bedst = y; bx = x; }
    }
    return { y: bedst, x: bx };
  };
  const v = soeg(b.xm - b.hw, -1), h = soeg(b.xm + b.hw, 1);
  const yb = Math.min(v.y, h.y) - 2;
  if (yb < V + 40) return false;
  // Enderne: der, hvor landet på hver side når op til dækket.
  let xa = Math.round(b.xm), xb2 = Math.round(b.xm);
  while (xa > b.xm - b.hw - 240 && top(xa) < yb) xa--;
  while (xb2 < b.xm + b.hw + 240 && top(xb2) < yb) xb2++;
  if (top(xa) < yb || top(xb2) < yb) return false;
  // Frihøjde over dækket (et overhæng må ikke skære broen over).
  for (let x = xa; x <= xb2; x += 8) for (let y = yb + 1; y <= yb + 50; y += 6) if (t.fast(x, y) && x > xa + 20 && x < xb2 - 20) return false;
  bygBro(t, xa - 14, xb2 + 14, yb, 16, 120);
  return true;
}

/* ------------------------------------------------------------ lommerne
 *
 * Luft, man ikke kan komme ud af: på de åbne baner alt, der ikke hænger
 * sammen med himlen; i grotten alt uden for det største hulrum. Regnet i
 * kvart opløsning. t.lukket.data[cy * fw + cx] = 1 i en lukket lomme.
 */
function lukkedeLommer(t, hule) {
  const S = SKALA;
  const fw = Math.ceil(t.w / S), fh = Math.ceil(t.h / S);
  const luft = new Uint8Array(fw * fh);
  for (let cy = 0; cy < fh; cy++) {
    const y = Math.min(t.h - 1, cy * S + 2), o = (t.h - 1 - y) * t.w;
    for (let cx = 0; cx < fw; cx++) luft[cy * fw + cx] = t.maske[o + Math.min(t.w - 1, cx * S + 2)] === LUFT ? 1 : 0;
  }
  const maerke = new Int32Array(fw * fh).fill(-1);
  const koe = new Int32Array(fw * fh);
  const storrelse = [];
  const himmel = [];
  let n = 0;
  for (let s = 0; s < fw * fh; s++) {
    if (!luft[s] || maerke[s] >= 0) continue;
    let hd = 0, tl = 0, stor = 0, rorer = false;
    koe[tl++] = s; maerke[s] = n;
    while (hd < tl) {
      const i = koe[hd++]; stor++;
      const cx = i % fw, cy = (i - cx) / fw;
      if (cy === fh - 1) rorer = true;
      if (cx > 0 && luft[i - 1] && maerke[i - 1] < 0) { maerke[i - 1] = n; koe[tl++] = i - 1; }
      if (cx < fw - 1 && luft[i + 1] && maerke[i + 1] < 0) { maerke[i + 1] = n; koe[tl++] = i + 1; }
      if (cy > 0 && luft[i - fw] && maerke[i - fw] < 0) { maerke[i - fw] = n; koe[tl++] = i - fw; }
      if (cy < fh - 1 && luft[i + fw] && maerke[i + fw] < 0) { maerke[i + fw] = n; koe[tl++] = i + fw; }
    }
    storrelse.push(stor); himmel.push(rorer); n++;
  }
  let hoved = 0;
  for (let k = 1; k < n; k++) if (storrelse[k] > storrelse[hoved]) hoved = k;
  const data = new Uint8Array(fw * fh);
  for (let i = 0; i < fw * fh; i++) {
    const k = maerke[i];
    if (k < 0) continue;
    const aaben = hule ? k === hoved : himmel[k];
    if (!aaben) data[i] = 1;
  }
  return { fw, fh, data };
}
