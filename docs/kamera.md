# Kameraet

Kameraet skal få kampen til at føles tæt på og levende, som i Worms W.M.D.,
uden at gå ud over læsbarheden eller sigtet. Koden ligger i
`static/js/render/camera.js`, projektionen i `render/renderer.js` og
baggrunden i `render/parallax.js`. Kaldene sidder i `main.js`.

## Tre regler

1. **Kameraet er ren præsentation.** Det læser spejlets positioner (figurer,
   projektiler, terrænets `fast()`, havets højde) og skriver kun til
   three-kameraet. Det skriver aldrig i verden, og det rører aldrig `rngSim`.
   Rystelserne har deres egen PRNG (`rngFx`), og kameraet har sit eget ur, der
   drives af `dt`. Det bruger hverken vægur eller `performance`. Det er
   testet: en rigtig verden kørt med og uden kameraet giver samme tilstand
   tick for tick (`test/kamera_determinisme.mjs`).
2. **Projektionen er ortografisk.** Sigte og træfzoner skal være eksakte. Det
   eneste perspektivtrick sidder på baggrundslagene (se nedenfor).
3. **Alt glider.** Position, zoom og indramning har hver sin kritisk dæmpede
   fjeder (`glatDaemp`). Zoomen fjedres i log-rum, så ind og ud føles lige
   hurtigt. Et skift af mål giver derfor aldrig et ryk: farten er kontinuert,
   og accelerationen har et loft.

## Afstanden: tættere på

`VERDEN_H` er sat ned fra 860 til 460 wu. En figur er 46 wu høj
(`entities.HITBOX`).

| | Synlig højde | Figur af skærmhøjden | Ved 1080p |
|---|---|---|---|
| Det gamle kamera | 860 wu | 5,3 % | 58 px |
| **Standard (ro)** | **460 wu** | **10,0 %** | **108 px** |
| Gang | 478 wu | 9,6 % | 104 px |
| Sigte uden kraft | 552 wu | 8,3 % | 90 px |
| Sigte, fuld kraft (loft 1,6) | 736 wu | 6,3 % | 68 px |
| Skud i luften (loft 1,9) | op til 874 wu | ned til 5,3 % | 57 px |
| Nedslag (hold) | 506 wu | 9,1 % | 98 px |
| Dødsfald (kort fokus) | 423 wu | 10,9 % | 117 px |
| H og introen | hele banen | ~1,5 % | |

Skærmforholdet ændrer ikke højden, så længe bredden ligger mellem
`MIN_BREDDE` (620) og `MAKS_BREDDE` (1400) wu ved zoom 1:

| Skærm | Udsnit ved zoom 1 | Figur |
|---|---|---|
| 16:9 | 818 x 460 wu | 10,0 % |
| 16:10 | 736 x 460 wu | 10,0 % |
| 3:2 | 690 x 460 wu | 10,0 % |
| 4:3 | 620 x 465 wu | 9,9 % |
| 21:9 (2560 x 1080) | 1090 x 460 wu | 10,0 % |
| 32:9 | 1400 x 394 wu | 11,7 % |

Rammer bredden en grænse, følger højden med, så billedet aldrig strækkes
skævt. Før blev en 4:3-skærm klemt vandret. `renderer.udsnit(aspekt)` er den
ene regel; renderen og testene bruger begge den.

### Manuelle trin (Z ud, X ind)

`ZOOMTRIN = [0.8, 1.0, 1.3, 1.7]`, og standard er 1,0. Trinnet ganges på den
dynamiske zoom, så det er en forskydning rundt om den og ikke en erstatning.
Trinnene giver en figur på 12,5 %, 10 %, 7,7 % og 5,9 %. Mens man sigter, er
zoomen også loftet absolut ved 2,0 (`SIGTE_ABS_LOFT`, 920 wu, figur 5 %),
selv på yderste trin. **H** viser hele banen uanset trin. **WASD** panorerer
med samme fart på skærmen ved alle zoom (700 wu/s ved zoom 1), men ikke mens
H eller introens oversigt vises: oversigten står fast på banens midte, og med
dens zoom (~6,5) ville en usynlig forskydning kaste billedet en skærmbredde
væk, når man slipper H. En fri panorering starter præcis dér, hvor billedet
var: sigtets og gangens skub og havets træk lægges over i den frie
forskydning, så et tryk på W ikke også flytter billedet vandret.

## Tilstandene

Kameraet vælger ét mål pr. frame, i denne rækkefølge:

1. **skud**: noget flyver (efter 200 ms, se nedenfor)
2. **doed**: et kort fokus på et dødsfald
3. **nedslag**: holdet over krateret, eller en bombe, der ligger og venter
4. **markoer**: markørtilstanden, eller scannerens træfpunkt et øjeblik
5. **figuren**: `sigte`, `gang` eller `ro`, ovenpå `etabler` ved turstart,
   og `fri`, når man panorerer

**H og introen** (`kigPaaBanen`) blandes blødt ovenpå det hele. Flugtens
ekstra himmel (`SKUD_TOP_EKSTRA`) og margen ud til siderne blandes væk med
den, så oversigten også under et skud er midt på banen og ikke glider, når
skuddet lander.

### Turstart: etableringen (`etabler`)

`main.js` kalder `etabler(kunde)` ved `turStart`. Kameraet glider hen til
kunden (fjeder 0,62 s) og starter lidt ude: 1,25, og længere ude jo længere
væk, op til 1,7. Det er en kranbevægelse, så farten på skærmen holder sig
nede. Den første tredjedel af `ETABLER_TID` (1,7 s) holdes ude, så zoomer
det blødt ind. Turstarten varer 2,5 s (`TUR_START_TICKS`), så zoomen er
tilbage på 1,0, når man får kontrollen. Står kameraet allerede ved kunden,
trækker det sig ikke tilbage (`ETABLER_NAER`, 600 wu). Samme kranbevægelse
bruges, når `fokus` eller et dødsfald rejser mere end 1,2 udsnitsbredder:
tilbage fra et fjernt nedslag, T til en fjende, og sejren.

### Gang: fremkig

Kameraet aflæser gangen af figurens egen bevægelse i spejlet, så det virker
også for tilskuere og gæster. Billedet skubbes `GANG_FREM` (15 % af
bredden) frem i den retning, kunden vender, plus fart × fjedertid. Uden den
del ville følgeforsinkelsen æde fremkigget. Dødzonen (6 % x 16 % af
udsnittet) holder små skridt og hop fra at ryste billedet.

### Sigte: ud og frem

Sigtet tæller først, når vinklen er rørt: den skal ændre sig
`SIGTE_VINKEL_TAERSKEL` (0,012 rad) fra, hvor den sidst var i ro. Det måles
mod en fast reference, så det ikke afhænger af billedfrekvensen.
Opladning tæller også. Turen starter altså tæt på, og så:

- zoomen går ud til `SIGTE_ZOOM` (1,2) og med kraften op til 1,6 (`SIGTE_ZOOM_LOFT`)
- billedet skubbes i sigteretningen: 12 % + 12 % × kraft af udsnittet,
  højst 26 % vandret, 24 % op og 12 % ned
- at gå afbryder sigtet

Kameraet viser en **retning**, ikke en forudsagt bane. Det må ikke blive en
sigtehjælp, der røber, hvor skuddet lander. Gættet på kraft og vind er
spillet. Kraften kendes kun af den, der lader op. Tilskuere får udzoomingen
fra vinklen, men ikke kraftens del.

### Skud: rytmen, forspring og hele buen

- **Rytmen:** kameraet bliver på skytten i 200 ms (`SKUD_VENT`), så
  mundingsglimtet og rekylen ses. Er skuddet ved at forlade billedet, slippes
  ventetiden med det samme.
- **Forspring:** målet ligger 0,22 s (vandret) og 0,14 s (lodret) foran i
  flyveretningen. Fjederen er stram (0,15 s).
- **Indramning:** skuddet, forspringet, alt andet i luften og jorden lige
  under skuddet rammes ind i én kasse. Zoomen er det, der skal til for at
  vise kassen, eller 1 + 0,3 × fart/1000, hvis det er mere. Loftet er 1,9
  (`SKUD_ZOOM_LOFT`). Klynger (Integrations inferno) og luftangreb
  (Kvartalsopkrævning) rammes derfor ind sammen, fordi `main.js` sender
  hele `v.projektiler` med.
- **Sikkerhed:** hovedprojektilet holdes inden for ±34 % af billedets midte
  (`SKUD_INDRE`). Det måles der, hvor fjederen halter efter det (fart ×
  0,15 s), og i det mindste af det nuværende og det ønskede udsnit, for
  zoomen halter også.
- **Loftet og jorden:** ved 1,9 kan jorden rammes ind, når skuddet er
  ~700 wu over den. Er det højere, bliver skuddet i billedet og zoomen ude.
  Den dykker ikke ind ved toppen af buen.
- **Over banen:** kameraet må følge et skud 2600 wu over banens top
  (`SKUD_TOP_EKSTRA`) og 320 wu ud over siderne. Så kommer ingen skud ud af
  billedet: 1500 wu/s lodret fra toppen når ~2350 wu op, og et skud fjernes
  200 wu uden for siden.

Målt (`test/kamera_skud.mjs`): ti baner ved fuld og halv kraft, 30/60/144 Hz.
Skuddet er aldrig tættere end 10 % på billedkanten.

### Nedslag: punch-in, rystelse, spark

`main.js` kalder `eksplosion(x, y, radius)`:

- **Rystelse** efter radius (`radius / 60`) og afstand til kameraet
  (halvt så meget ~0,6 skærmbredde væk). Største udsving er 1,6 % af
  udsnittets højde (`RYST_ANDEL`), altså samme udsving på skærmen som før.
  Rystelsen er glat støj ved 7 og 11 Hz, ikke billedfrekvensens hvide
  støj, og halveres hvert 0,25 s.
- **Punch-in:** zoomen går kort ind, med 3,5 % × radius/50 og højst 3,5 %.
  Den har halveringstid 0,12 s og en fjeder på 0,05 s, så den aldrig springer.
- **De store brag** (radius ≥ 70: Datalæk-bomben, 74) får et spark: 8,5 %
  punch, ekstra rystelse og et skub væk fra braget i positionsfjederen. Det
  giver et stød på ~15 wu, der falder blødt til ro.
- **Holdet:** `main.js` holder over krateret i `NEDSLAG_HOLD_MS` (1,5 s)
  ved zoom 1,1, før det kalder `fokus` på den aktive kunde.

### Dødsfald: et kort fokus

`kortFokus(x, y)` fra `doedsfald`/`drukner` ser 1,9 s på den, der lægger på.
Det sorte hul varer 1,3 s, så liget smælder mens kameraet ser på. Zoomen er
0,92. Et dødsfald går forud for holdet over krateret, men ikke for et skud
i luften.

### Markør og scannerens træf

I markørtilstand (Fjernsupport, Kvartalsopkrævning, Byggeskum) rammes
kunden og markøren ind sammen, med loft 1,8. Er markøren for langt væk,
følger billedet markøren med fart-forspring. Piletasterne flytter den med
560 wu/s, og uden forspringet slap den ud af billedet. Et spring med T er
ingen fart. Stregkodescanneren rækker 1100 wu, længere end billedet. Et
træf uden for billedet rammes derfor ind sammen med skytten i 1,4 s
(`rammeInd`).

### Ro: vejrtrækningen

Når intet sker, trækker billedet næsten umærkeligt vejret. Zoomen svinger
±0,6 % over 7,3 s, og midten ±3,5 og ±2,2 wu over 11,1 og 8,3 s. Det er ~8 px
ved 1080p, og det flytter aldrig sigtet: sigtekornet sidder på figuren, ikke
på skærmen. Under sigte er vejrtrækningen halv, under opladning, flugt og
fri panorering er den væk. Navneskiltene er DOM, men regnes fra kameraet
hver frame, så de følger med.

### Havet i billedet

Man skal kunne se det vand, man kan falde i. Det var grunden til de gamle
860 wu. Billedet trækkes derfor ned, til 30 wu hav er med, men højst 20 % af
højden (`VAND_TRAEK`), og hovedet bliver mindst 12 % fra toppen. Kan havet
ikke nås inden for de 20 %, slipper trækket blødt igen. Så er det bedre at
stå i midten end halvvejs uden hav. `saetVand` følger havet, når det stiger
ved pludselig død.

## Baggrunden: dybde ved panorering og zoom

`parallax.js` har tre slags bevægelse:

1. **Parallakse** (som før): hvert lag følger kameraet med sin egen faktor.
2. **Perspektiv ved zoom** (nyt): baggrunden opfører sig, som om kameraet
   kørte frem og tilbage i stedet for at zoome. Et lag med faktor `f`, set
   ved `zRel = udsnitshøjde / 860`, får den effektive faktor
   `g = zRel·f / (zRel·f + 1 − f)` (`camera.dybdeFaktor`) og skaleres `g / f`
   om kameraets midte. Ved 860 wu (`REF_UDSNIT_H`, udsnittet, lagene er
   malet til) er alt præcis som før. Ved standardudsynet (460) står de
   fjerneste skyer næsten stille på skærmen. Skybanken vokser 1,02 gange,
   mens gameplayplanet vokser 1,87 gange. Træerne vokser 1,46 gange, og
   parallaksen bliver stærkere. Det er det, der sælger dybden, når kameraet
   zoomer.
3. **Egenbevægelse**: skyer driver, tåge siver, træer svajer, som før.
   Skyerne og tågen driver desuden **med vinden**. Forskydningen hobes op og
   holdes inden for én gentagelse, så floats ikke mister præcision. Drift
   ved vind 1: skybanken 6, fjernskyerne 8 og 10, skyerne 16, fjern tåge 9,
   nær tåge 14 wu/s. Himlen fortæller dermed, hvilken vej det blæser. Der er
   ingen ny grafik; det er de eksisterende lag.

Lagtabellen er `parallax.LAG`, og placeringen er den rene funktion
`lagPlacering`. `test/kamera_parallakse.mjs` regner på de rigtige lag: den
gamle placering ved 860, fjerne lag skalerer mindre end nære, og lagene
dækker billedet ved alle zoom fra trin 0,8 til H-oversigten og ved alle
kamerapositioner, også 2600 wu over banen.

## Verdens-UI ved alle zoom

- **I scenen** (skalerer med verden, altid rigtigt): sigtekornet, kraftbuen,
  markøren, minens nedtælling, telefonens RING!, gravsten og effekter.
  Sigtekurvens prikker (sigteassistent) er i pixels og står fast.
  Partikelstørrelser skaleres med `pixelPrWu` fra `main.js`.
- **I DOM** (via `r.tilSkaerm`, efter kameraet hver frame): navneskilte,
  skadetal, helbredstal og telefonens taleboble. Navneskiltet sad 74 wu over
  fødderne, hvilket gav 66 px luft over hovedet ved det nye kamera. Nu sidder
  det 12 wu over hovedet plus 8 px (`hud.js`, `ETIKET_WU`/`ETIKET_PX`),
  hvilket giver 14-45 px ved alle trin (testet). Skade- og helbredstal popper
  op over skiltet (`talAnker`: skiltets højde plus luft til den aktives gule
  ring og tallets pop), så de ikke dækker navnet og HP, mens skiltet tæller
  ned.

Ingen allokeringer pr. frame i kameraet eller baggrunden: alt skrives i
genbrugte variabler (testet med `--expose-gc` over 200.000 frames). I
`main.js` genbruges nedslagspunktet nu, i stedet for et nyt objekt pr.
frame under flugten.

## Netværk og tilskuere

Kun værtens Worker simulerer. Kameraet kører lokalt hos alle på spejlets
tilstand:

- sigtet aflæses af `vinkel` fra deltaerne, gangen af den interpolerede
  position, og det virker ens for vært, gæst og tilskuer
- kraften er kun kendt af den, der lader op
- et snapshot udskifter spejlets figurobjekter (og kan bygge terrænet om).
  Kameraet får derfor `figur(id)` og `terraen()` fra `main.js` og slår
  begge op igen hver frame i stedet for at holde på gamle objekter

## prefers-reduced-motion

- ingen vejrtrækning
- ingen vinddrift i baggrunden (den gamle egenbevægelse er uændret)
- rystelser × 0,35, punch og spark × 0,3
- turstartens tilbagetrækning × 0,4 (glidningen er der stadig: den viser,
  hvem der har turen)

`camera.reduceretBevaegelse()` læser media-forespørgslen live. Testene
tvinger den med `opt.reduceret`.

## Kaldene fra main.js

| Kald | Hvornår |
|---|---|
| `lavKamera(r, terraen, { figur, terraen })` | `byggVisning` |
| `etabler(kunde)` | `turStart` |
| `fokus(kunde)` | T (se på en fjende), sejren, efter holdet over krateret; `haendelser.js` efter brandøvelsen |
| `foelg(kunde)` + `friTilstand(false)` | C |
| `foelgSkud(p, v.projektiler)` / `foelgSkud(nedslag)` / `slipSkud()` | `foelgSkud()` i `main.js`, hver frame |
| `saetSigte(type, kraft, id)`, `saetMarkoer(paa, x, y)`, `saetVand(y)` | hver frame, før `opdater` |
| `kigPaaBanen(paa)` | H og introens nedtælling |
| `friTilstand(true)` + `panorer(dx, dy)` | WASD, ikke mens H eller introen vises (`panorer` ignorerer det også selv) |
| `zoomInd()` / `zoomUd()` | Z / X (og sejren) |
| `eksplosion(x, y, radius)` | `eksplosion` |
| `rystelse(styrke, afstand)` | fuldtræffer, klask, scannerens træf |
| `kortFokus(x, y, sek)` | `doedsfald`, `drukner` |
| `rammeInd(x, y)` | scannerens stråle |
| `opdater(dt)` | hver frame |

## Test

```bash
node --expose-gc --test test/kamera_*.mjs
```

| Fil | Hvad |
|---|---|
| `kamera_zoom.mjs` | figurandel pr. skærmforhold, trin, H (også under et skud, 16:9 og 4:3), introen, etableringen, sigtets zoom og loft, fremkig, havet |
| `kamera_skud.mjs` | skuddet i billedet (10 baner × 30/60/144 Hz), jorden under buen, rytmen, klynger og luftangreb, punch/rystelse/spark, dødsfald, markør, scanner |
| `kamera_glathed.mjs` | begrænset fart, acceleration og zoomfart gennem en hel tur ved 30/60/144 Hz, ens ved alle hz, vejrtrækning, reduceret bevægelse, allokeringer |
| `kamera_fri.mjs` | fri panorering og kanten, WASD under H, at indramningen og havets træk bliver, C, gæster (snapshot, nyt terræn), fortet med loft, pludselig død, navneskilte og skadetal |
| `kamera_determinisme.mjs` | ingen `rngSim`/`Math.random`/ur i koden, frosne input, samme input → samme billede, en rigtig verden med og uden kamera, og at alle `kamera.*`-kald i `main.js` og `ui/` findes |
| `kamera_parallakse.mjs` | perspektivformlen, fjerne lag skalerer mindre, lagene dækker billedet, og den rigtige `lavParallaks` bygget i Node (skala efter dybde, vinddriftens retning, `fjern`) |

Målt gennem en hel tur (intro, etablering, gang, sigte, opladning, skud med
Datalæk-bomben, hold, dødsfald, zoomtrin, næste tur på den anden side af
banen, fri panorering, C):

- hurtigste glidning: 3,35 udsnitsbredder/s (loft i testen: 4)
- største acceleration: 34 bredder/s² (loft: 50), altså ingen ryk
- hurtigste zoom: 2,96/s i log (introens oversigt; loft: 3,5)

Tallene er de samme ved 30, 60 og 144 Hz.

## Kendte grænser og videre arbejde

- **Regnen** (`weather.js`) wrapper i en boks på 3000 x 2000 wu. Ved det
  tættere kamera ses ~3,5 gange færre dråber på skærmen, og ved H-oversigten
  dækker boksen ikke hele billedet. Boksen, eller antallet, bør skaleres
  med udsnittet. Det er ikke rørt her.
- **Opløsning:** figurerne er tegnet i 128 px pr. 46 wu, hvilket er 1:1 ved
  1080p og blødere ved 1440p og 4K. De nære baggrundslag er tegnet i halv
  opløsning (1024 px pr. flise). Træerne ses 1,46 gange større end før og
  er derfor lidt blødere. Fuld opløsning på de fire nære lag koster ~50 MB
  GPU-hukommelse. Det er en beslutning for art directoren.
- **`glatDaemp` med `maksFart`** (`core/math.js`) springer: den regner
  resultatet fra det rigtige mål i stedet for det begrænsede, så en stor
  afstand flyttes næsten helt på én frame. Ingen bruger parameteren; kameraet
  bruger den bevidst ikke.
