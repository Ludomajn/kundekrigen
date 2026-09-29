# Tålmodighedsbjælken i WoW-stil (feedback punkt 1)

Kort fortalt: skiltet over hver kunde bliver en bjælke i holdets farve. Navnet står inde i bjælken til venstre og tallet til højre, i fed hvid tekst med mørk kontur. Når en kunde bliver ramt, viser et rødt stykke det tabte og løber ned sammen med tallet. Samme bjælke bruges tre steder: skiltet, den aktive kunde øverst og holdlisten. Der er ingen ændringer i simulationen, i `VIDERESEND`, i `rngSim` eller i lydene.

Filstier er relative til `/Users/thomasemilsorensen/Documents/Coworker/baevere`. Linjetal i `world.js` flytter sig, fordi bane-agenten redigerer filen lige nu. Dér står symbolets navn også med.

## Nu

**Skiltet over kunden** (`static/js/ui/hud.js:332-375`)
- Det er en pille i holdfarve (`hud.js:352-353`) med `<span class="enavn">` og `<span class="ehp">` (`hud.js:354`). Der er ingen bjælke.
- Tallet er skiltets mindste og svageste element: `.etiket .ehp{opacity:.85;font-size:10px}` med arvet vægt 600 (`app.css:334-340`). Det er præcis det, feedbacken klager over.
- Placering: `r.tilSkaerm(x, y + 58)`, så `(p.y - 8)` og `translate(-50%, -100%)` (`hud.js:341-344`, `362`). Skiltets underkant sidder altså 12 wu plus 8 px over hovedet. Testen `test/kamera_fri.mjs:120-136` låser luften til 14-45 px.
- Kameraet: `VERDEN_H = 460` (`render/renderer.js:18`). Ved 1080p er en figur 108 px høj i ro og ned til 57 px under skud (`docs/kamera.md:31-37`), svarende til 2,35 til 1,24 px pr. wu.
- Skiltet skaleres ikke med `--ui`. Kun `.hud-top` og `.hud-hold` skaleres med transform (`app.css:644-651`). `--ui` går fra 0,75 til 1,5 (`ui/menu.js:223`).
- Hver frame laver skiltet et nyt `Set` og nye objekter (`hud.js:335-336`, `344`). Desuden allokerer `tilSkaerm` og læser `laerred.clientWidth` (`renderer.js:119-125`).
- `opdaterEtiketter` kaldes sidst i `opdater` (`hud.js:328-329`), efter at der er skrevet til DOM'en samme frame (`hud.js:208`, `222/225/229`). Resultatet er en tvungen, synkron layoutberegning hver frame.

**Den aktive kunde øverst** (`hud.js:204-216`)
- Hele feltet bygges med `innerHTML` hver frame (`hud.js:207-213`).
- Bjælken er 110×7 px, og tallet 12 px med opacity .9 (`app.css:244-247`). Bredden sættes med `width:%` og et fast `100` (`hud.js:212`).

**Holdlisten**
- Bjælken er 40×4 px (`app.css:281-282`, `462-465`), og tallet 9,5 px med opacity .75 (`app.css:471`).
- Signaturen indeholder `visHp` (`hud.js:257`). Derfor bygges hele listen om med `innerHTML` hver frame, så længe en nedtælling kører (`hud.js:268-296`).

**Nedtællingen**
- Koblingen sker i `main.js:520-522`. Selve nedtællingen er `taelSkade` (`main.js:1085-1113`).
- Under `affyring` og `oploesning` står det gamle tal stille. Derefter popper `skadeTal` op (`main.js:1095`), og `markerRamt(id, true)` sættes (`main.js:1097`).
- Tallet tæller ned over `min(2200, 900 + 18·skade)` ms med ease-out og tik (`main.js:1099-1110`). Til sidst kaldes `markerRamt(id, false)` (`main.js:1111`).

**Rystelsen ved træf** (`.ramt`, `app.css:571-573`)
- Den animerer `margin-left`, så der laves layout hver frame.
- Dens `box-shadow` overskriver `.etiket.egen` (`app.css:483`).

**Død**
- `givSkade` sætter `doed` i nedslagsøjeblikket (`sim/damage.js:85-99`), og skiltet forsvinder med det samme (`hud.js:338`).
- Liget suges ind i et sort hul i 78 tick (`damage.js:19`, `154-172`) under `T.SKADE` (`world.js`, `case T.SKADE`, ca. l. 839). Nedtællingen starter typisk først, når det er faldet til ro.
- Holdlistens række får `.doed` med det samme (`hud.js:287`), selv om tallet stadig er det gamle.

**Over 100**
- Piller giver op til `PILLER_LOFT = 150` (`world.js:37`, `_samlKasse`).
- Tallet viser 150, men bjælkerne stopper ved 100 % (`hud.js:212`, `291`). `MAKS_HP` importeres, men bruges ikke (`hud.js:17`).

**COVID** (`b.smittet`)
- Det vises kun som ikon i holdlisten (`hud.js:27-40`, `app.css:826`) og som virusser rundt om figuren (`render/figur_view.js:17-19`).
- `SMITTE_SKADE = 6` pr. turslut (`damage.js:23`).
- Gæster kender kun "smittet eller ej", ikke antallet af ture (`sim/snapshot.js:125-128`).

**Holdidentitet**
- "Holdet ses på navneskiltet" (`figur_view.js:15`). Skiltet er altså det eneste holdtegn på figuren.
- Farverne står i `render/palette.js:30-35`: blå `#10546B`, rød `#A34526`, gul `#FFD86F` og grøn `#4E684E`, hver med en mørkere `kant`.

**Navne**
- Kun Ingrid og Dr. Jan kan vælges (`core/roster.js:17`). Dubletter med romertal er derfor det normale (`roster.js:45-49`).
- Jeg har målt bredderne med Poppins Bold 11 px fra den lokale TTF: "Skrankepaven Ingrid II" er 127 px og "Dr. Jan fra Mors III" 100 px.
- Egne navne er højst 16 tegn (`ui/customise.js:197`).

**Skrift og bevægelse**
- Poppins hentes kun i vægtene 300, 400, 500, 600, 700 og 900 (`static/index.html:10`). Der er ingen 800.
- `prefers-reduced-motion` dækker `.skadetal` og `.etiket.ramt` (`app.css:573`), men ikke `dinturPuls` (`app.css:479`).
- "Opdaterer…"-panelet tegnes ved 60 wu (`figur_view.js:800`). Det ligger i samme højde som skiltet.

## Spec

### 1. Opbygning (samme komponent `.tbj` alle tre steder)

```html
<div class="etiket aktiv egen">                           <!-- kun på skiltet: placering, rystelse, ring, pil, udtoning -->
  <div class="tbj" style="--hf:#10546B;--hk:#0d3145">     <!-- bjælken: kant, holdtonet spor, klipper lagene -->
    <i class="tbj-tab"></i>                               <!-- det tabte: rødt, løber ned med tallet -->
    <i class="tbj-fyld"></i>                              <!-- resten efter afsløringen -->
    <i class="tbj-smitte" style="width:6%"></i>           <!-- COVID: de 6, der ryger ved næste turslut -->
    <i class="tbj-over"></i>                              <!-- piller over 100: strimmel øverst -->
    <span class="tbj-navn"><span class="tbj-stamme">Ingrid</span><span class="tbj-nr"> II</span></span>
    <span class="tbj-tal num">68</span>
  </div>
</div>
```

- Alle `<i>` er fuld bredde og placeres med `translateX((pct − 100)%)` inde i `overflow:hidden`.
- Det giver ingen layout, og højrekanten forbliver en skarp mørk skillelinje (et inset box-shadow). Med `scaleX` ville skillelinjen blive strakt og tynd.
- Lagene ligger nedefra: spor, så tab, så fyld, så smitte, så overskud og øverst teksten.

### 2. Farver: holdfarve og ikke helbredsfarve

Fyldet har altid holdets farve.

**Hvorfor:**
- Skiltet er figurens eneste holdtegn (`figur_view.js:15`).
- En skala fra grøn over gul til rød ville kollidere med Klinik Rød, Grøn og Gul.
- WoW farver selv efter reaktion og klasse, ikke efter helbred.

**Fyld:** en lodret gradient fra `var(--hf)` med 40 % hvid øverst, over 24 % i midten, til 8 % i bunden, plus et hvidt highlight på 1 px øverst.

**Spor:** `color-mix(var(--hf) 20%, #060E14)`, uigennemsigtigt. Så kan blå og rød også skelnes, når bjælken er næsten tom (farvetone 199 mod 5).

**Kontrast** (målt med node; midten af fyldet mod sporet over mørk, mellem og himmellys baggrund):

| Hold | Mørk | Himmel |
|---|---|---|
| Blå | 3,76 | 3,18 |
| Rød | 4,51 | 3,74 |
| Grøn | 4,59 | 3,78 |
| Gul | 9,61 | 7,73 |

Alle ligger på eller over 3:1.

**Kant:** 1 px i holdets `kant` (`palette.js`) og en lys halo på 1 px udenom, så bjælken også ses mod mørk baggrund.

**Det tabte:** `#FF5A3C`, samme rød som skadetallet (`app.css:561`).
- Mod det røde holds fyld er kontrasten kun 1,37. Den mørke skillelinje og et hvidt blink i de første 280 ms bærer det.

### 3. Tekst

- Altid hvid, også på det gule hold: teksten krydser både fyld og mørkt spor, så mørk tekst ville forsvinde på sporet.
- Konturen laves med `text-shadow`: fire hårde 1 px-forskydninger i `#0B1419` plus en blød skygge, samme metode som `.skadetal`.
- Vægt: navn 700, tal 900. Begge findes i `index.html:10`.

### 4. Størrelser (px ved `--ui` 1)

| Sted | Bjælke | Navn | Tal | Skala |
|---|---|---|---|---|
| Skilt | 120×20 | 11/700 | 13/900 | × `--ui` (via `--s`) |
| Skilt, aktiv | 132×22 | 11/700 | 14/900 | × `--ui` |
| Aktiv øverst | 240×26 | 13/700 | 16/900 | allerede skaleret af `.hud-top` |
| Holdliste | 100 % (ca. 150)×15 | 10/600 (700 for egen og aktiv) | 10,5/900 | allerede skaleret af `.hud-hold` |

- `--s` er 1 i `.hud-top` og `.hud-hold`, ellers ville de blive skaleret to gange. I `.etiketter` er den `var(--ui)`.
- Ved 1080p i ro fylder skiltet 51×8,5 wu, og luften til hovedet er 36 px. Under skud er den 23 px. Ankerpunktet er uændret, så `kamera_fri`-testen holder.
- Dagens pille for "Skrankepaven Ingrid II" er ca. 160 px bred. Den nye er 120 px, så skilte overlapper mindre.
- Plads til navnet på skiltet: 120 − 2 − 14 − 6 − 22,4 = 75,6 px.

### 5. Tallet og procenten

- Der står ét tal til højre og intet "%".
- Tålmodighed kan være op til 150 (piller), så "%" ville være forkert. Enheden er point ("+50 tålmodighed").
- Bjælkens længde er procenten af 100. Over 100 viser strimlen `.tbj-over` overskuddet i samme skala: 150 giver halv bredde.

### 6. Det tabte stykke (chip)

Det er kompatibelt med `visHp`:
- Tallet er stadig `visHp(b)`.
- Den nye `fyldHp(b)` returnerer `e.t.til` under nedtælling, ellers `e.vist`.
- Før afsløringen er de to ens, så Worms-tilbageholdelsen bevares.

| Tid | Fyld | Det tabte | Tal | Klasser |
|---|---|---|---|---|
| Nedslag (affyring/opløsning) | 80 | – | 80 | – |
| Verden i ro: `e.t` oprettes | falder straks til 32 | 32-80, blinker hvidt | 80, "−48" popper | `.ramt` (rystelse, rød kant) |
| +280 ms (`TAB_HOLD_MS`) → slut | 32 | løber ned sammen med tallet | tæller ned, tikker | `.ramt` |
| Slut (samme sluttid som i dag) | 32 | 32 (ude af syne) | 32 | – |

- Holdet klemmes med `k = max(0, …)`. Uden klemmen skyder tallet op over udgangsværdien i holdet. Det viste node-forsøget.
- Sluttiden er uændret, så `EFTERSPIL_SKADE = 100` (`world.js:33`) ikke berøres.
- Der kommer ingen nye lyde. `'tael'`-tikkene rykker 280 ms, og alt går stadig gennem `lyd.afspil`.

### 7. Lav tålmodighed (≤ 25, `LAV_HP`, én mellemstor træffer fra at lægge på)

- Kanten bliver `#FF5A3C`.
- På skiltet pulserer en rød glød i en `::before` med opacity-animation i 1,2 s. Det er kun compositing, ingen repaint.
- Sporet beholder holdtonen, så holdet stadig kan læses.
- Nøglen er det viste tal, så tilstanden slår til i det øjeblik, tallet krydser 25.

### 8. Aktiv og egen (på wrapperen, så `contain` aldrig klipper dem)

- **Aktiv:** gul outline på 2 px med 2 px afstand, bjælken 132×22, tallet 14 px og en gul pil nedad på 5 px mod hovedet. Selv ved `--ui` 1,5 er pilen 13,5 px, altså under minimumsluften på 14 px.
- **Egen:** hvid ring på 1,5 px (som i dag). Ringen og træfmarkeringen bor nu på forskellige elementer og overskriver ikke længere hinanden.

### 9. Død eller 0

**Skiltet**
- Ved `b.doed` sættes fyldet straks til 0. Det gamle tal står som et rødt tabt stykke under `.doed`, med navnet på opacity .7.
- Tallet venter på den normale afsløring, tæller ned til 0, og derefter får skiltet `.ude`: 600 ms udtoning og 6 px ned. Det fjernes efter 650 ms (`UD_MS`).
- En kunde, der allerede var død i et snapshot, får aldrig et skilt.

**Holdliste og aktiv:** samme regel. Rækken får `.doed` (gennemstregning og .32) først, når `x.doed && visHp(x) <= 0`, som signaturen allerede lægger op til (`hud.js:257`).

### 10. COVID og overskud

- **COVID:** når `b.smittet > 0` og fyldet er højst 100, vises de sidste `SMITTE_SKADE` som grøn skravering (`#8FE07A`, samme grøn som ikonet), med højre kant ved fyldet.
  - Der vises kun næste tik, fordi gæster ikke kender antallet af ture.
  - Ved turslut bliver skraveringen til det tabte stykke gennem samme afsløringsvej.
- **Overskud:** strimlen er 4 px høj, går fra hvid til `--kk-yellow` og har en mørk underkant. Den følger tallet, så den løber ned sammen med det.

### 11. Den aktive øverst (WoW's target frame)

- Bjælken er 240×26 med det fulde navn. Plads: 184 px ved 13 px, så "Bente "Bare Rolig" Hansen" (173 px) kan være der.
- Under bjælken står en undertekstlinje `.ak-under` med `DIN TUR` og statusikonerne (`statusIkoner`).
- Feltet bygges kun, når id, DIN TUR, status eller navn skifter. Tallene skrives på stedet.
- Den særskilte `holdprik` udgår, fordi bjælken selv bærer holdet.

### 12. Holdlisten (WoW's raid frames)

- Rækken bliver markør, så bjælke (1fr) med navn og tal indeni, så statusikoner.
- `.hud-hold{width:216px}` (i dag er det max-width), så alle bjælker flugter.
- Aktiv række: den eksisterende gule baggrund plus gul kant på bjælken. Navnet forbliver hvidt.
- Signaturen udelader `visHp`. Tallene og holdets samlede sum skrives på stedet.

### 13. Ydelse

**Skiltet**
- I ro skrives kun transform pr. frame. Lagene skrives kun ved ændring, fordi værdierne caches på `t.v`, `t.f` og `t.s`.
- Klasser styres med en bitmaske, `n._k`. Synlighed caches.
- `Set` og målpladser genbruges. `contain:strict` bruges på skiltets bjælke.

**Rystelse:** `translate` i stedet for `margin-left`.

**Rækkefølge:** `opdaterEtiketter` flyttes først i `opdater`, så `tilSkaerm` læser størrelsen, før der skrives. Det fjerner den tvungne layout.

**Andre steder:** den aktive kunde og holdlisten stopper deres `innerHTML` pr. frame.

### 14. Reduceret bevægelse

- Ingen rystelse, puls, blink eller heleffekt.
- Gløden står fast på .8, og udtoningen er 300 ms ren opacity.
- `dinturPuls` slås også fra.

### 15. Til art directoren (kort brief)

- **Hvad:** tålmodighedsbjælker. Skilt 120×20 (aktiv 132×22), aktiv øverst 240×26, holdliste ca. 150×15. Navn til venstre og tal til højre, i hvid fed tekst med mørk kontur, inde i bjælken. Referencen er WoW's target frame.
- **Nu:** en ren CSS-pladsholder. Der skal ikke ligge filer i `static/grafik` for at det kan shippe.
- **Hvis du vil style:** lever i `static/grafik/hud/`:
  - `tbj_ramme.svg`: en 9-slice-ramme med slice-værdier, højst 2 px synlig kant, der virker fra 15 til 26 px højde.
  - `tbj_tekstur.png`: gråtone, vandret tilebar, 256×32. Koden toner den med holdfarven (multiply), så ét aktiv dækker alle hold.
  - Valgfrit `tbj_glans.png` til highlight.
  - Ingen tekst og ingen holdfarver bagt ind.
- **Faste betydningsfarver:** tabt `#FF5A3C`, lav-glød `#FF5A3C`, aktiv `#FFD86F`, COVID-skravering `#8FE07A`, overskud hvid til `#FFD86F`.
- **Krav:**
  - Fyld mod spor mindst 3:1.
  - Blå og rød skal kunne skelnes med næsten tom bjælke.
  - Mellemtonerne skal bære hvid tekst med kontur.
  - Fyldets højrekant skal forblive en skarp mørk linje.
- **Valgfrit:** et klinikmærke på 12 px i venstre ende som kendetegn, der ikke hviler på farve (for farveblinde).

## Ændringer pr. fil

### `static/js/ui/tbj.js` (ny, uden DOM ved import og uden three, så node kan teste den)

```js
/* Kundekrigen — tålmodighedsbjælken (WoW-stil): navn og tal INDE i en bjælke i
 * holdets farve. Lagene er fuld bredde og skubbes med translateX (ingen layout,
 * skarp højrekant): tab (det lige tabte), fyld (resten), smitte (næste COVID-tik),
 * over (piller over 100). Rene funktioner øverst — de testes i node. */
'use strict';

import { MAKS_HP } from '../sim/entities.js';
import { SMITTE_SKADE } from '../sim/damage.js';
import { PERSONALE } from '../core/klinikker.js';
import { esc } from './tekst.js';

export const LAV_HP = 25;          // én middel træffer fra at lægge på
export const TAB_HOLD_MS = 280;    // fyldet falder straks; det tabte og tallet venter et øjeblik

export const pct = (hp) => (hp <= 0 ? 0 : hp >= MAKS_HP ? 100 : (hp / MAKS_HP) * 100);
export const overPct = (hp) => pct(hp - MAKS_HP);                 // 150 = halv strimmel
export const smitteX = (fyld) => ((Math.min(fyld, MAKS_HP) - SMITTE_SKADE) / SMITTE_SKADE) * 100;

/* Romertallet (core/roster.js ROMER, " 9" og op) må aldrig klippes væk. */
const NR = / (?:[IVX]+|\d+)$/;
export function delNavn(navn) {
  const s = String(navn ?? ''), m = NR.exec(s);
  return m ? [s.slice(0, m.index), m[0]] : [s, ''];
}
/* Skiltets navn: personalets kaldenavn + romertallet. Egne navne står, som de er. */
const KALDENAVN = new Map(Object.values(PERSONALE).flat().filter((p) => p.kort).map((p) => [p.navn, p.kort]));
export function kortNavn(navn) {
  const [stamme, nr] = delNavn(navn);
  const k = KALDENAVN.get(stamme);
  return k ? k + nr : String(navn ?? '');
}

/** Nedtællingen (main.js taelSkade): samme sluttid som før, men holdet først. */
export function skadeForloeb(fra, til, nu) {
  const ialt = Math.min(2200, 900 + (fra - til) * 18);
  return { fra, til, start: nu + TAB_HOLD_MS, varighed: Math.max(400, ialt - TAB_HOLD_MS) };
}
/** 0 i holdet (ellers skyder tallet OVER fra), 1 ved slut. */
export const skadeK = (t, nu) => Math.max(0, Math.min(1, (nu - t.start) / t.varighed));

/* ---- DOM */
const hex = (n) => '#' + n.toString(16).padStart(6, '0');         // = palette.hexStr, uden three

export function tbjHTML(f, navn, klasse = '') {
  const [stamme, nr] = delNavn(navn);
  return `<div class="tbj ${klasse}" style="--hf:${f.css};--hk:${hex(f.kant)}">` +
    `<i class="tbj-tab"></i><i class="tbj-fyld"></i>` +
    `<i class="tbj-smitte" style="width:${(SMITTE_SKADE / MAKS_HP) * 100}%"></i><i class="tbj-over"></i>` +
    `<span class="tbj-navn"><span class="tbj-stamme">${esc(stamme)}</span>` +
    (nr ? `<span class="tbj-nr">${esc(nr)}</span>` : '') + `</span><span class="tbj-tal num"></span></div>`;
}
/** Lagene i fast rækkefølge. v/f/s = sidst skrevne (NaN: intet endnu). */
export function tbjRefs(el) {
  const c = el.children;
  return { el, tab: c[0], fyld: c[1], smitte: c[2], over: c[3], tal: c[5], v: NaN, f: NaN, s: NaN, ramt: false };
}
/** vist = tallet (tæller ned), fyld = resten (<= vist; 0 for en død), smitte = vis
 *  næste COVID-tik. Skriver KUN ved ændring: et kald pr. frame koster intet i ro. */
export function saetTbj(t, vist, fyld, smitte) {
  vist = vist > 0 ? vist : 0;
  fyld = fyld > 0 ? (fyld < vist ? fyld : vist) : 0;
  if (vist !== t.v) {
    t.v = vist;
    t.tal.textContent = vist;
    t.tab.style.transform = 'translateX(' + (pct(vist) - 100) + '%)';
    t.over.style.transform = 'translateX(' + (overPct(vist) - 100) + '%)';
    t.el.classList.toggle('lav', vist > 0 && vist <= LAV_HP);
    t.el.classList.toggle('over', vist > MAKS_HP);
  }
  if (fyld !== t.f) { t.f = fyld; t.fyld.style.transform = 'translateX(' + (pct(fyld) - 100) + '%)'; }
  const s = smitte && fyld <= MAKS_HP ? fyld : -1;
  if (s !== t.s) { t.s = s; t.smitte.style.transform = s < 0 ? 'translateX(-200%)' : 'translateX(' + smitteX(s) + '%)'; }
}
```

### `static/js/ui/hud.js`

**Import** (l. 12-18): tilføj

```js
import { tbjHTML, tbjRefs, saetTbj, kortNavn, LAV_HP } from './tbj.js';
```

`MAKS_HP` (l. 17) kan fjernes, hvis intet andet bruger den.

**Tilstand** efter l. 85-89:

```js
let fyldHp = (b) => visHp(b);            // resten efter afsløringen; main.js sætter den
const synlige = new Set(), maal = [];    // genbruges hver frame
const holdRader = new Map(), holdTotal = new Map();
let sidsteAktiv = '', aktivT = null;
const UD_MS = 650, SYN_KANT = 120;       // SYN_KANT: halvt bredeste skilt ved --ui 1,5 (99 px) + luft
const K_RAMT = 1, K_AKTIV = 2, K_EGEN = 4, K_LAV = 8, K_DOED = 16, K_UDE = 32;
const KLASSER = [[K_RAMT, 'ramt'], [K_AKTIV, 'aktiv'], [K_EGEN, 'egen'], [K_LAV, 'lav'], [K_DOED, 'doed'], [K_UDE, 'ude']];
const statusNoegle = (x) => `${x.skjold ? 1 : 0}${x.springOver ? 1 : 0}${x.smittet > 0 ? 1 : 0}`;
function saetKlasser(n, k) {
  const d = k ^ n._k; n._k = k;
  for (let i = 0; i < KLASSER.length; i++) if (d & KLASSER[i][0]) n.classList.toggle(KLASSER[i][1], (k & KLASSER[i][0]) !== 0);
}
function lavEtiket(b) {
  const n = document.createElement('div');
  n.className = 'etiket';
  n._k = 0; n._synlig = null; n._ude = 0; n._navn = null; n._hold = b.hold;
  el.etiketter.appendChild(n);
  etiketPulje.set(b.id, n);
  saetEtiketNavn(n, b.navn);
  return n;
}
function saetEtiketNavn(n, navn) {
  n._navn = navn;
  n.innerHTML = tbjHTML(holdFarve(n._hold), kortNavn(navn));
  n._t = tbjRefs(n.firstElementChild);
}
```

**`opdater`**

(a) Flyt `v.egenPid = egenPid; this.opdaterEtiketter(v, r);` fra l. 328-329 op som det første i funktionen. Kommentar: *tilSkaerm læser lærredets størrelse (renderer.js:120); det skal ske, før HUD'en skriver.*

(b) Erstat l. 205-216 (den aktive kunde) med:

```js
if (b) {
  const dinTur = !!(egenPid && (b.ejer === egenPid || v.pidPaaHold?.(egenPid, b.hold)));
  const noegle = `${b.id}|${dinTur ? 1 : 0}|${b.doed ? '' : statusNoegle(b)}|${b.navn}`;
  if (noegle !== sidsteAktiv) {
    sidsteAktiv = noegle;
    el.aktiv.className = `hud-aktiv${dinTur ? ' dinTur' : ''}`;
    const ik = statusIkoner(b);
    const under = (dinTur ? `<span class="dintur-mark" style="background:${hold.css};color:${hold.tekst}">DIN TUR</span>` : '') +
                  (ik ? `<span class="hb-status">${ik}</span>` : '');
    el.aktiv.innerHTML = tbjHTML(hold, b.navn, 'tbj--aktiv') + (under ? `<div class="ak-under">${under}</div>` : '');
    aktivT = tbjRefs(el.aktiv.firstElementChild);
  }
  saetTbj(aktivT, visHp(b), b.doed ? 0 : fyldHp(b), !b.doed && b.smittet > 0);
  const ramt = ramte.has(b.id);
  if (ramt !== aktivT.ramt) { aktivT.ramt = ramt; aktivT.el.classList.toggle('ramt', ramt); }
} else {
  const t = tilstandTekst || T.spil.venter;
  if (sidsteAktiv !== 'tekst|' + t) { sidsteAktiv = 'tekst|' + t; el.aktiv.className = 'hud-aktiv'; el.aktiv.textContent = t; aktivT = null; }
}
```

Valgfrit: skriv også `el.tur` og `el.kamp` kun, når teksten ændrer sig (l. 222/225/229).

(c) Holdlisten (l. 257-297)

Ny signatur:

```js
v.baevere.map((x) => `${x.id}:${x.doed && visHp(x) <= 0 ? 1 : 0}:${statusNoegle(x)}:${x.navn}`).join(',') + `|${v.tur.baeverId}|${v.tur.holdIdx}|${egenPid}`
```

- I overskriften bliver `hn-hp` til `<span class="hn-hp num" data-hold="${hid}"></span>`.
- Rækken bliver:

```html
<div class="hbaever ${x.doed && visHp(x) <= 0 ? 'doed' : ''} ${erAktiv ? 'aktiv' : ''} ${mit(x) ? 'egen' : ''}" data-id="${x.id}">
  <span class="hb-markoer">…uændret…</span>${tbjHTML(f, x.navn, 'tbj--hold')}<span class="hb-status">${statusIkoner(x)}</span></div>
```

- Efter `innerHTML`:

```js
holdRader.clear(); holdTotal.clear();
for (const rk of el.hold.querySelectorAll('.hbaever')) holdRader.set(+rk.dataset.id, tbjRefs(rk.querySelector('.tbj')));
for (const t of el.hold.querySelectorAll('.hn-hp')) { t._s = NaN; holdTotal.set(+t.dataset.hold, t); }
```

- Hver frame, uden for `if`:

```js
for (const x of v.baevere) {
  const t = holdRader.get(x.id); if (!t) continue;
  saetTbj(t, visHp(x), x.doed ? 0 : fyldHp(x), !x.doed && x.smittet > 0);
  const ramt = ramte.has(x.id);
  if (ramt !== t.ramt) { t.ramt = ramt; t.el.classList.toggle('ramt', ramt); }
}
for (const [hid, n] of holdTotal) {
  let s = 0; for (const x of v.baevere) if (x.hold === hid) s += Math.max(0, visHp(x));
  if (s !== n._s) { n._s = s; n.textContent = s; }
}
```

**`opdaterEtiketter`** (erstat l. 332-375)

Behold kameraagentens placeringslinjer ordret, uanset hvad de ender med.

```js
opdaterEtiketter(v, r) {
  const nu = performance.now(), W = window.innerWidth, H = window.innerHeight;
  synlige.clear();
  let m = 0;
  for (const b of v.baevere) {
    const vist = visHp(b);
    if (b.doed && vist <= 0) {                       // talt ned: skiltet toner ud og fjernes
      const n = etiketPulje.get(b.id);
      if (!n) continue;
      if (!n._ude) n._ude = nu;
      if (nu - n._ude > UD_MS) continue;
    }
    synlige.add(b.id);
    const p = r.tilSkaerm(b.x, b.y + 58);            // (kameraets placering, uændret)
    const s = maal[m] || (maal[m] = { b: null, x: 0, y: 0, vist: 0 });
    s.b = b; s.x = p.x; s.y = p.y; s.vist = vist; m++;
  }
  const egen = v.egenPid;
  for (let i = 0; i < m; i++) {
    const s = maal[i], b = s.b;
    const n = etiketPulje.get(b.id) || lavEtiket(b);
    const synlig = s.x > -SYN_KANT && s.y > -40 && s.x < W + SYN_KANT && s.y < H + 40;
    if (synlig !== n._synlig) { n._synlig = synlig; n.style.visibility = synlig ? 'visible' : 'hidden'; }
    if (!synlig) continue;
    n.style.transform = `translate3d(${s.x | 0}px, ${(s.y - 8) | 0}px, 0) translate(-50%, -100%)`;
    if (n._navn !== b.navn) saetEtiketNavn(n, b.navn);
    const lever = !b.doed;
    saetTbj(n._t, s.vist, lever ? fyldHp(b) : 0, lever && b.smittet > 0);
    const k = (ramte.has(b.id) ? K_RAMT : 0) |
              (lever && b.id === v.tur.baeverId ? K_AKTIV : 0) |
              (lever && egen && (b.ejer === egen || v.pidPaaHold?.(egen, b.hold)) ? K_EGEN : 0) |
              (lever && s.vist > 0 && s.vist <= LAV_HP ? K_LAV : 0) |
              (lever ? 0 : K_DOED) | (n._ude ? K_UDE : 0);
    if (k !== n._k) saetKlasser(n, k);
  }
  for (const [id, n] of etiketPulje) if (!synlige.has(id)) { n.remove(); etiketPulje.delete(id); }
},
```

**Nyt i det returnerede API** (efter l. 377):

```js
saetFyldHp(fn) { fyldHp = fn; },
```

`markerRamt` (l. 379) er uændret.

**`helbredTal`** (l. 429-438): tilføj

```js
const e = etiketPulje.get(b.id);
if (e) { e.classList.remove('helbredt'); void e.offsetWidth; e.classList.add('helbredt'); }
```

Det er samme mønster som l. 160 og kører kun ved helbredelse, som er sjælden.

**`ryd`** (l. 487): tilføj `holdRader.clear(); holdTotal.clear(); sidsteAktiv = '';`

### `static/js/main.js`

- Import: `import { skadeForloeb, skadeK } from './ui/tbj.js';`
- Efter l. 522:

```js
hud.saetFyldHp((b) => { const e = S.visHp.get(b.id); return e ? (e.t ? e.t.til : e.vist) : b.hp; });
```

- `taelSkade`: i l. 1092-1093 bliver `e.t = { … }` til `e.t = skadeForloeb(e.vist, b.hp, nu);`, og i l. 1101 bliver `const k = Math.min(1, …)` til `const k = skadeK(e.t, nu);`. Resten er uændret: tik, `markerRamt` og "mere skade undervejs". Kameraets kaldesteder røres ikke.

### `static/js/core/klinikker.js` (forslag, du skal godkende kaldenavnene)

Tilføj `kort` til `PERSONALE` (l. 23-34):

| Navn | Kort |
|---|---|
| Skrankepaven Ingrid | `'Ingrid'` |
| Bente "Bare Rolig" Hansen | `'Bente'` |
| Hansen, Dr. Hansen | `'Dr. Hansen'` |
| Praktikant Trine | `'Trine'` |
| Systemsygeplejerske 2.0 | `'System 2.0'` |
| Dr. Jan fra Mors | `'Dr. Jan'` |

- Kaldenavnene er kun til visning i klienten. Kun `navn` rejser over nettet (`net/transport.js:152`), så `rum.py` er upåvirket.
- Målt bredde: "Dr. Hansen IV" er ca. 72 px, under de 75,6 px, der er plads til.
- Uden kaldenavne virker `delNavn` alene: stammen forkortes med "…", og romertallet bliver stående.

### `static/app.css`

**Fjern:**
- `.hud-aktiv .hpbar/.hptal` (l. 245-247)
- `.hbaever` (l. 278)
- `.hbnavn/.hbbar` (l. 280-282)
- `.etiket`, `.etiket.aktiv`, `.ehp` (l. 334-340)
- `.hbaever` (l. 462-465), `.hbnavn` (l. 466, 468, 473) og `.hb-hp` (l. 471)
- `.etiket.aktiv/.egen` (l. 482-483)
- `.etiket.ramt`, dens keyframes og reduced-motion-reglen (l. 571-573)

**Tilføj** (sektion "tålmodighedsbjælken"):

```css
/* ---- Tålmodighedsbjælken (WoW-stil): navn og tal INDE i bjælken. --s er
   skalaen: 1 i .hud-top/.hud-hold (skaleres selv med --ui), --ui i .etiketter. */
.tbj{
  --s:1; --tbj-b:120px; --tbj-h:20px; --tbj-streg:#0B1419;
  --tbj-skygge:0 calc(1px*var(--s)) 0 var(--tbj-streg),0 calc(-1px*var(--s)) 0 var(--tbj-streg),
    calc(1px*var(--s)) 0 0 var(--tbj-streg),calc(-1px*var(--s)) 0 0 var(--tbj-streg),
    0 calc(1px*var(--s)) calc(3px*var(--s)) rgba(4,20,30,.7);
  position:relative;display:flex;align-items:center;justify-content:space-between;gap:calc(6px*var(--s));
  width:calc(var(--tbj-b)*var(--s));height:calc(var(--tbj-h)*var(--s));padding:0 calc(7px*var(--s));
  border:calc(1px*var(--s)) solid var(--hk,var(--tbj-streg));border-radius:calc(3px*var(--s));
  background:#060E14;background:color-mix(in srgb,var(--hf) 20%,#060E14);   /* sporet bærer holdets tone */
  overflow:hidden;contain:layout style;color:#fff;white-space:nowrap;
}
.etiketter .tbj{--s:var(--ui);contain:strict}
.tbj>i{position:absolute;inset:0 auto 0 0;width:100%;transform:translateX(-100%);pointer-events:none}
.tbj-tab{background:#FF5A3C}                                        /* samme rød som skadetallet */
.tbj-fyld{background:var(--hf);
  background:linear-gradient(to bottom,color-mix(in srgb,var(--hf) 60%,#fff),color-mix(in srgb,var(--hf) 76%,#fff) 50%,color-mix(in srgb,var(--hf) 92%,#fff));
  box-shadow:inset 0 calc(1px*var(--s)) 0 rgba(255,255,255,.35),inset calc(-1.5px*var(--s)) 0 0 var(--tbj-streg)}
.tbj-smitte{background:repeating-linear-gradient(135deg,#8FE07A 0 calc(2px*var(--s)),rgba(11,20,25,.6) calc(2px*var(--s)) calc(4px*var(--s)))}
.tbj-over{bottom:auto;height:calc(4px*var(--s));background:linear-gradient(90deg,#fff,var(--kk-yellow));box-shadow:0 calc(1px*var(--s)) 0 var(--tbj-streg)}
.tbj-navn,.tbj-tal{position:relative;z-index:1;text-shadow:var(--tbj-skygge)}
.tbj-navn{display:flex;min-width:0;font:700 calc(11px*var(--s))/1 var(--font)}
.tbj-stamme{min-width:0;overflow:hidden;text-overflow:ellipsis}
.tbj-nr{flex:none}
.tbj-tal{flex:none;font:900 calc(13px*var(--s))/1 var(--font)}
.tbj.lav,.tbj.ramt,.etiket.ramt .tbj{border-color:#FF5A3C}
.tbj.ramt .tbj-tab,.etiket.ramt .tbj-tab{animation:tbjBlink .28s ease-out}
@keyframes tbjBlink{from{background-color:#FFF1EA}}

/* Skiltet over kunden: placering (transform fra JS), ringe, pil, puls, udtoning. */
.etiketter{position:absolute;inset:0;pointer-events:none}
.etiket{position:absolute;top:0;left:0;will-change:transform;contain:layout style;border-radius:calc(3px*var(--ui));
  box-shadow:0 0 0 1px rgba(255,255,255,.22),0 2px 6px rgba(4,20,30,.5)}
.etiket.egen{box-shadow:0 0 0 calc(1.5px*var(--ui)) rgba(255,255,255,.85),0 2px 6px rgba(4,20,30,.5)}
.etiket.aktiv{outline:calc(2px*var(--ui)) solid var(--kk-yellow);outline-offset:calc(2px*var(--ui))}
.etiket.aktiv .tbj{--tbj-b:132px;--tbj-h:22px}
.etiket.aktiv .tbj-tal{font-size:calc(14px*var(--s))}
.etiket.aktiv::after{content:"";position:absolute;left:50%;top:calc(100% + 4px*var(--ui));translate:-50% 0;
  border-style:solid;border-color:var(--kk-yellow) transparent transparent;border-width:calc(5px*var(--ui)) calc(5px*var(--ui)) 0}
.etiket.lav::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;
  box-shadow:0 0 calc(10px*var(--ui)) calc(2px*var(--ui)) rgba(255,90,60,.75);animation:etiketLav 1.2s ease-in-out infinite}
@keyframes etiketLav{50%{opacity:1}}
.etiket.ramt{animation:etiketRamt .12s linear infinite}
@keyframes etiketRamt{0%,100%{translate:0}25%{translate:-2px 0}75%{translate:2px 0}}   /* translate: ingen layout */
.etiket.doed .tbj-navn{opacity:.7}
.etiket.ude{animation:etiketUd .6s ease-in forwards}
@keyframes etiketUd{to{opacity:0;translate:0 6px}}
.etiket.helbredt .tbj-fyld{animation:tbjHelbred .7s ease-out}
@keyframes tbjHelbred{from{filter:brightness(1.7) saturate(1.2)}}

/* Den aktive øverst (target frame) og holdlisten (raid frames). */
.hud-aktiv{display:flex;flex-direction:column;align-items:flex-start;gap:5px}
.hud-aktiv .tbj{--tbj-b:240px;--tbj-h:26px;padding:0 9px;box-shadow:0 0 0 1px rgba(255,255,255,.22),0 3px 10px rgba(4,20,30,.45)}
.hud-aktiv .tbj-navn{font-size:13px}
.hud-aktiv .tbj-tal{font-size:16px}
.hud-aktiv.dinTur .tbj{outline:2px solid var(--kk-yellow);outline-offset:2px}
.ak-under{display:flex;align-items:center;gap:6px;min-height:15px}
.hud-hold{width:216px}
.hbaever{display:grid;grid-template-columns:11px minmax(0,1fr) auto;gap:5px;align-items:center;padding:1.5px 0;border-radius:3px}
.hbaever .tbj{--tbj-b:100%;--tbj-h:15px;padding:0 5px;gap:5px}
.hbaever .tbj-navn{font-weight:600;font-size:10px}
.hbaever.egen .tbj-navn,.hbaever.aktiv .tbj-navn{font-weight:700}
.hbaever .tbj-tal{font-size:10.5px}
.hbaever.aktiv .tbj{border-color:var(--kk-yellow)}
.hbaever.doed .tbj-stamme{text-decoration:line-through}

@media (prefers-reduced-motion:reduce){
  .skadetal,.etiket.ramt,.etiket.lav::before,.tbj-tab,.tbj-fyld,.dintur-mark{animation:none}
  .etiket.lav::before{opacity:.8}
  .etiket.ude{animation:etiketUdRo .3s linear forwards}
}
@keyframes etiketUdRo{to{opacity:0}}
```

`.hbaever.aktiv` (baggrund og inset-streg, l. 467) og `.hbaever.doed{opacity:.32}` (l. 472) beholdes.

### `test/hp_bjaelke.mjs` (ny) og `test/README.md` (en række i tabellen)

Se afsnittet Test.

## Test

Alt kører headless med `node --test test/` (node 22+ og uden jsdom, jf. `test/README.md`). Jeg har kørt de rene dele som et forsøg i `$TMPDIR`, og alle bestod.

1. **Rene funktioner** (importeres fra `ui/tbj.js`):
   - `pct`: −5, 0, 68, 100 og 150 giver 0, 0, 68, 100 og 100. `overPct(150)` er 50, og `overPct(80)` er 0.
   - `smitteX(6)` er 0, og `smitteX(3)` er under 0 (klippes af `overflow`).
   - `delNavn(rosterNavn(f, nr))` for alle `ROSTER` × nr 0-9 samler sig tilbage til hele navnet, og stammen er rosternavnet. Det dækker romertallene op til VIII og " 9"/" 10". "Systemsygeplejerske 2.0" giver intet falsk romertal.
   - `kortNavn` findes for alle `PERSONALE` og bevarer suffikset.
2. **Nedtællingen:**
   - `skadeForloeb(80, 32, nu)` slutter på samme tid som dagens formel.
   - Tallet er 80 i hele holdet, falder aldrig i stigning, rammer 32 til sidst og kommer aldrig over 80.
   - Uden klemme i `skadeK` skyder tallet over 80. Testen bekræfter, at klemmen er nødvendig.
3. **Kun skrivninger ved ændring** (falske elementer med tællende settere for `style.transform`, `textContent` og `classList.toggle`):
   - Første kald giver 7 skrivninger.
   - 10.000 kald med samme værdier giver 0.
   - Et kald, hvor kun fyldet ændres, giver 1 skrivning (`translateX(-68%)`).
   - Død: fyldet får `translateX(-100%)`, og det tabte følger tallet. Negative værdier klemmes til "0".
   - Ved 150 er strimlen `translateX(-50%)`, og klassen `over` er sat.
4. **CSS-vagt** (strengtjek på `app.css`):
   - `@keyframes etiketRamt` indeholder ikke `margin`.
   - Regler med `.hud-aktiv .tbj` eller `.hbaever .tbj` bruger ikke `var(--ui)` (ingen dobbeltskalering).
   - Vægtene i `.tbj`-regler er 600, 700 eller 900 (`index.html:10`).
   - Reduced-motion-blokken nævner `.etiket.lav::before` og `.dintur-mark`.
5. **Bredder (kun lokalt):** hvis `~/Library/Fonts/Poppins-Bold.ttf` findes, skal kaldenavn + " IV" ved 11 px/700 være højst 75,6 px. Testen springes over uden fonten. Mine målinger: "Ingrid II" 42 px, "Dr. Jan III" 51 px, "System 2.0 II" 71 px.
6. **Eksisterende tests:** `kamera_fri.mjs:120-136` (navneskilte) er uændret grøn, fordi ankeret (58 wu − 8 px) ikke flyttes, og pilen på 5+4 px ×1,5 er under minimumsluften på 14 px.
7. **Gennemgang af forløbene:**
   - Normalt træf: tidslinjen i afsnit 6.
   - Dødelig træffer: fyldet går straks til 0 med det røde tabte stykke. Tallet tæller ned ved afsløringen, så kommer `.ude`, og skiltet fjernes efter 650 ms. Holdrækken bliver først `.doed` ved 0.
   - Piller fra 60 til 110: tallet og fyldet går op med det samme, strimlen står på 10 %, og fyldet blinker.
   - COVID-tik: skraveringen bliver til det tabte stykke.
   - Gæst: samme logik ud fra spejlets `hp` og ingen sim-kode.
8. **I browseren:**
   - `--ui` på 75 og 150 %.
   - Emulering af reduceret bevægelse i DevTools.
   - Det gule hold (farve og tekst).
   - Performance-panelet: ingen "Forced reflow" fra `tilSkaerm`, og ingen `innerHTML` pr. frame i `hud-aktiv` eller `hud-hold`.

## Risici

- **Merge med kameraagenten:** den redigerer placeringen i `hud.js` og kaldestederne i `main.js`. Land efter den, og behold dens `tilSkaerm(…, y + 58)`- og `(p.y - 8)`-linjer ordret. Mine `main.js`-ændringer ligger kun på l. 522 og i `taelSkade`.
- **Dødt skilt:** en død kundes skilt hænger ca. 2 s over det sorte hul eller gravstenen (fyld 0, rødt, gammelt tal), fordi afsløringen typisk kommer efter ligets eksplosion. Det skal prøves af i playtest. Alternativet er at sætte `n._ude` allerede ved `b.doed`, hvilket er én linje.
- **"Opdaterer…"-panelet** ved 60 wu (`figur_view.js:800`) overlapper skiltet allerede i dag, og bjælken gør det lidt værre. Forslag til kameraagenten: løft skiltet 16 wu, når `b.springOver` er sat.
- **Browserkrav:** `color-mix` kræver Chrome 111, Safari 16.2 eller Firefox 113. Uden det falder fyldet tilbage til ren `var(--hf)` og sporet til `#060E14`.
- **Rødt mod rødt:** det tabte stykke mod det røde holds fyld har kun 1,37:1. Skillelinjen og blinket skal bære det.
- **Gult hold:** hvid tekst på lys gul (1,3:1) klarer sig kun på grund af konturen. Holdet kan dog ikke vælges i dag (`klinikker.js:11-13`).
- **`contain:strict`** kræver en eksplicit størrelse. `--tbj-b` må aldrig blive `auto` på skiltet. Holdlisten bruger derfor ikke strict.
- **Skarphed:** `translateX` i procent kan give en halv pixel på kanten, men skillelinjen på 1,5 px skjuler det.
- **Timing:** holdet på 280 ms flytter tallets start, men sluttiden er uændret. Der kommer ingen nye lyde.
- **Kaldenavnene** er et indholdsvalg, som du skal godkende. Holdlistens signatur laver stadig strenge hver frame, som i dag.