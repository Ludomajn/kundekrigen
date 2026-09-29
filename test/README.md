# Testene

Alle testene kører i Node (og én i Python) — uden server og uden browser.
Mappen serveres ikke (kun `static/` gør). Grupperne: banerne
(`kort_*.mjs`), kameraet (`kamera_*.mjs`, se `docs/kamera.md`), fysikken
(`fysik_*.mjs`), vejledningen (`vejledning_*.mjs`), farerne i realtid (`farer_*.mjs`, se
`docs/farer.md`) og serverens rum (`rum_*.py`). Dertil HUD'ens
tålmodighedsbjælke (`hp_bjaelke.mjs`) og samspillet mellem bjælken,
vejledningen og farerne (`samspil*.mjs`).

## Serverens rum

```sh
python3 test/rum_spil_igen.py
```

| Fil | Hvad den prøver |
|---|---|
| `rum_spil_igen.py` | Spil igen i et netværksrum (`rum.py`): hver kamp får et nyt frø, en 'tilfaeldig'-regel trækkes igen hver gang, og rummets regler ændres ikke af kampen. |

## Kameraet og fysikken

```sh
node --expose-gc --test test/kamera_*.mjs
node --no-warnings --test test/fysik_granat.mjs
```

| Fil | Hvad den prøver |
|---|---|
| `kamera_zoom.mjs` | afstand, zoomtrin, H og sigte |
| `kamera_skud.mjs` | skud, klynger, luftangreb, nedslag, dødsfald, markør |
| `kamera_glathed.mjs` | glathed, vejrtrækning, reduceret bevægelse, allokering (`--expose-gc`) |
| `kamera_fri.mjs` | fri panorering, C, gæster/snapshot, fortet, pludselig død, navneskilte |
| `kamera_determinisme.mjs` | kameraet rører aldrig simulationen |
| `kamera_parallakse.mjs` | baggrundens dybde ved panorering og zoom |
| `kamera_forloeb.mjs`, `kamera_hjaelp.mjs` | et skriptet turforløb og fælles hjælpere (ikke tests) |
| `tjek_kamera_krav.mjs` | kladde: skriver kun tal ud, fejler aldrig |
| `fysik_granat.mjs` | granatens lunte og dvale oven på kunder: begge granater, hop på terrænet, kunden går væk eller dør, snapshot, skriptede kampe på 10 minutter |

## Tålmodighedsbjælken

```sh
node --expose-gc --no-warnings --test test/hp_bjaelke.mjs
```

| Fil | Hvad den prøver |
|---|---|
| `hp_bjaelke.mjs` | HP-bjælken (`ui/tbj.js`, `ui/hud.js`; `docs/udkast/hp_design.md`) i en lille falsk DOM uden jsdom, drevet af `main.js`' egen `taelSkade` og fyldfunktion (skåret ud af kilden som i `vejledning_hjaelp.mjs`): fyldet efter procent, det tabte stykke, der venter og tæller ned med tallet, lav tålmodighed, død (skiltet toner ud og fjernes; holdlisten først død ved 0), piller over 100, COVID-tikket og kraftfeltet, kaldenavnene og romertallene. Ny skade midt i en nedtælling (Stregkodescannerens andet scan, ild): fyldet holder under skuddet, så et nyt skadetal og en skadelyd i ro, tallet springer aldrig og er talt ned inden for efterspillet. At skiltene intet skriver i ro, ikke læser layout efter en skrivning, og at den aktive øverst og holdlisten ikke bygges om pr. frame. Allokeringen pr. frame (`--expose-gc`, ellers springes den over). Vagter på `app.css` (translate-rystelse, ingen dobbeltskalering, kun hentede Poppins-vægte, reduceret bevægelse også på pseudo-elementer som lav-gløden, sporet 20 % på `#060E14`), farverne (fyld mod spor mindst 3:1 for hvert hold i CSS-udgaven og med kunstens tekstur, i middel og i dens mørkeste række; ΔE mellem blåt og rødt spor mindst 15; holdkanten i kunsten ligger inden for rammens streg og under lagene), art directorens filer og, hvis Poppins er installeret lokalt, at navnene kan være i bjælkerne. |

## Vejledningen

```sh
node --no-warnings --test test/vejledning_*.mjs
```

Vejledningen på første tur (`ui/hjaelp.js`, spec i `docs/udkast/vejledning_design.md`):
gør-det-trin med en tæller, et slutkort med MELLEMRUM, Esc springer over, og
tururet venter imens (`'vejledning' {aktiv}`, højst `VEJLEDNING_LOFT` pr.
kundeejer pr. kamp).

| Fil | Hvad den prøver |
|---|---|
| `vejledning_sim.mjs` | Simulationen: `valider` (kun ejeren, `aktiv` som boolean), kvoten bruges før arsenalets pause, kvoten pr. ejer pr. kamp og flaget pr. tur, `aktiv:false`, deltaens `vj` kun i `SPILLER_AKTIV`, snapshot → `genskab` → `anvendDelta` (og en rigtig kopi), gamle snapshots. Determinisme: en skriptet kamp på 90 s med og uden pausen er ens i hvert tick bortset fra uret, og `rngSim` kaldes lige mange gange. |
| `vejledning_trin.mjs` | Trinmaskinen og kortene: intet skifter af sig selv (to minutter på 1/5), hvert trin klares af sin handling med ✓ i 450 ms (0 ved reduceret bevægelse), trin gjort før tid springes over, telefonens teleport (Omstillingen, `kilde: 'telefon'`) klarer intet, slutkortet først i ro og med de manglende trin, mellemrum/Esc-reglerne, flaget (v2, én gang pr. browser, halvvejs er forfra), `visIgen`, skydeteksterne pr. sigte, de præcise tekster, ingen timere i kildekoden, og `lavHjaelp` med en lille falsk DOM (tegner kun om ved ændring, tastebjælkens `.nu`, klik). |
| `vejledning_input.mjs` | `main.js`' indputvej og kobling, skåret ud af kildekoden og kørt mod en rigtig vært, et spejl og det rigtige tastatur: hele vejledningen ved ét tastatur, slutkortets mellemrum lader aldrig op (heller ikke holdt ind i næste tur), Esc-kortet i næste spillers tur, Esc springer over før pausen, markøren og pausen går forud, oversigten sluger tasterne, `rydAlt`, netværk med modspiller og tilskuer (banneret én gang, ingen kort, fremmede kommandoer afvises) pausemenuens to knapper (API'en), og at Omstillingens teleport — kunden går ind i en ringende telefon på gå-trinnet — hverken slutter vejledningen, slår uret til eller gemmer flaget, mens Fjernsupport stadig er et skud. |
| `vejledning_pausemenu.mjs` | Pausemenuen (`ui/menu.js` `visPause`) i en lille falsk DOM uden jsdom: "Vis vejledningen igen" (`#pVejl`) og "Alle taster" (`#pTaster`) lige efter Fortsæt, klik og piletaster + Enter (`menuNav`) kalder `visVejledning`/`visTaster`, det vejledningen siger om pausemenuen (oversigtens række, slutkortets fodnote) findes dér, og hele vejen med `main.js`' api og en rigtig vært: Esc sprang over, pausemenuens knap viser vejledningen igen og lader uret vente. |
| `vejledning_hjaelp.mjs` | Fælles hjælpere (ikke en test): den falske DOM og "bordet" (vært, spejle, tastatur og `main.js`' stykker). |

## Farerne i realtid

```sh
node --no-warnings --test test/farer_*.mjs
```

Kabelsalaten (Nullermanden i grotten), Pakkedronen, Robotstøvsugeren og ild
(`sim/farer.js`, reglerne og grænsefladen til brugerfladen i `docs/farer.md`,
designet i `docs/udkast/farer_design.md`). Simulationen alene, i en rigtig
verden (`sim/world.js`).

| Fil | Hvad den prøver |
|---|---|
| `farer_determinisme.mjs` | Samme frø og input giver samme aftryk tick for tick i 20 000 tick (med farer og brande). Med `cfg.farer: []` er sporet bit for bit referencesporet fra før farerne, og intet trækkes. Værten og spejlet (snapshots og deltaer) har samme farer, ild og varsel, også en sen deltager midt i en brand. `sim/farer.js` bruger hverken `Math.random`, `Date`, `performance`, `document` eller `window`. |
| `farer_tur.mjs` | Turen blokeres aldrig: en rullende Kabelsalat forsinker ikke `SKADE`, indgangen i luften højst `FARE_LUFT_URO`, en brand højst `KS_BRAND + 10`, D1 (et brag kaster den brændende op, turen venter på flammebraget), D2 (ild ved en printer: printeren går af i skyttens tur). Vagthunden reagerer aldrig i 200 scenarier. Skriptede kampe på 10 minutter pr. banetype (også med en fare hvert 15. s): ingen `tvungenRo` fra farerne, alt står stille uden for aktiv tid, ingen fare i luften ved `SKADE`, ingen fare før runde 2, `ildTur ≤ 24`, startpausen, ingen lunte fra en gammel plet. Døden i ild, pakken lander, brandøvelsen. |
| `farer_kaede.mjs` | Enhver kæde slutter: 200 patologiske opstillinger (printere, miner og ild om en brændende fare) inden for 1500 tick, højst `ILD_MAKS` pletter, dybde højst `KAEDE_MAKS`, hver ting højst én gang. Vejret, spredningen i vindens retning, vandet (også antændt, mens den flyder), kraftfeltet og kædens felter led for led. Dvalen: en mine, som ilden tændte og vagthunden (`tvungenRo`) slukkede, er sin egen start, når en kunde senere går ind på den (brænder lunten ud, bærer braget ildens kæde). |
| `farer_plan.mjs` | Planlæggeren: højst 4 træk fra `rngSim` pr. fare og 0 pr. udsættelse (også øer med 4×3 kunder), højst `FARE_MAKS`, ingen drone i grotten, under nedbrud eller uden kasseplads, fortets støvsuger på gyldige pladser, `cfg.farer`, rullemodellen på 4 banetyper × 6 frø (under 10 % sidder fast, aldrig inde i terrænet), og shitstormen i grotten 76 wu fra ild. |
| `farer_fysik.mjs` | Pakkens fejede fald gennem fortets tynde lag, begravede farer fri efter ét tick, hvilke skud der sprænger på Kabelsalaten, skyttens pause, scanneren antænder ikke en Kabelsalat, der ruller gennem skytten, når der sigtes væk fra den (men et skud lige på den gør), klasket, dronens flyvning, LEVERET!, nedskydning og konfetti, støvsugerens kørsel, spamfilter (kun miner uden ejer), batteri, tvangsopdatering og kortslutning. |
| `farer_snapshot.mjs` | Rundtur midt i en brand og ved turskift i rigtige kampe (også midt i et varsel): 600 tick med samme aftryk og samme farer bagefter. Gamle snapshots. `tagDelta` → `anvendDelta`: listerne sendes altid, `fv` bliver `null`, den sidste fare forsvinder, objekterne genbruges pr. id, `hoejdeMaal` er ikke `maalY`, Nullermandens hud. |
| `farer_net.mjs` | Hver farehændelse står i `VIDERESEND` og er ren data. En scanning mod en fare, som gæsten ser 20 wu bagud, rammer (og ville misse uden `FARE_STRAALE_TOL`). Tolerancen stjæler ikke et rent træf: en Kabelsalat 8 wu bag en fjende (scanneren) og en støvsuger bag en fjende (tvangsopdateringen) — fjenden får skuddet. Et spejl med hver tredje delta (20 Hz). Deltaens størrelse. |
| `farer_hjaelp.mjs` | Fælles hjælpere (ikke en test): en startet verden, en verden i spillerens tur, en bot, skriptede kampe. |
| `farer_lav_spor.mjs` | Optager referencesporet `test/farer_fra_spor.json` (kampe uden farer). Kør det igen, når banegeneratoren med vilje ændrer kampene; `--tjek` sammenligner kun. Under `node --test` (globben ovenfor) gør den intet. |

### Farerne på skærmen

```sh
node --no-warnings --test test/farer_vis_*.mjs
```

Del 2: tegningen (`render/fare_view.js`, art directorens atlas), brugerfladen
(`ui/farer.js`), lydene (`ui/lyd.js`, `vaerktoej/kontorlyde.py`) og krogene i
`main.js`. Uden browser: three-scenen bygges i Node, og en lille
software-rasterer tegner den. Kontaktarket lægges i `test/billeder/farer_vis.png`
(kræver `dwebp` og `ffmpeg`; ellers springes billedtestene over). Ca. 4 s.

| Fil | Hvad den prøver |
|---|---|
| `farer_vis_tegning.mjs` | Hver tilstand har sine frames (idle, aktiv i brand, fald i luften, land, udloes ved KORTSLUTNING/NOM/LEVERET!/ny brand, doed), rullen (−x / r på jorden, tumlen i luften, vuggen i brand), fodlinjen på fodpunktet og designets lag, tegningen står på jorden (også en hel omgang: stikkene går aldrig ned i jorden), dronen uden kasse (leveret og skudt ned), det brændte græs, manglende kunst, glat bevægelse med hver 3. delta, en rigtig kamp på tre banetyper (tegningen følger spejlet, intet hænger, `fjern()` rydder scenen) og kontaktarket. |
| `farer_vis_ui.mjs` | Varslets banner, lyd (normal kanal, D9) og kantpil (i kanten mod stedet, over stedet i billedet), navneskiltet i 5 s, "SKYD MIG!" én gang pr. profil og slags, ordene og lydene, en lyd, der venter på en fri kanal og falder bort efter fristen, KÆDE ×n!, SYGT PLAY! (reglen, egne kunder, drukning i samme tur, fare eller 2 led), kameraet (intet under sigtet, et glimt i opløsningen højst hvert 2. s, kun kald fra kameraets API), ildens knitren, og `main.js`' kroge skåret ud af kildekoden (ild: ingen lyd og én replik pr. tur, rosen kun for egen kæde, kun rystelse ved et kædebrag under sigtet, "Pakken falder!"). |
| `farer_vis_lyd.mjs` | Den rigtige `ui/lyd.js` i et falsk lydmiljø: hver gruppe har sine filer og sin styrke, farernes grupper laves af `kontorlyde.py` (ingen chiptune), `har()`, en valgfri lyd advarer ikke, KORTSLUTNING kommer efter braget og aldrig for sent, varslet tager aldrig en vigtig plads, intet overlapper, og ildens løkke tier under andre lyde. |
| `farer_vis_hjaelp.mjs` | Fælles hjælpere (ikke en test): atlasserne, rastereren, de falske moduler og et spejl af værten. |

Fundene fra gennemgangen af farerne på skærmen, hver med sin test:

| Fund | Hvor testen står |
|---|---|
| Ildens knitren lød under flyvelyden og boret (de går uden om kanalen, så `lyd.loop` lod ikke ilden tie). Nu tier den, så længe et skud suser (ikke-sovende projektil fra 40 wu/s) eller en kunde borer, og 0,2 s efter. | `farer_vis_lyd.mjs`: "ildens knitren tier under flyvelyden og boret": den rigtige `lyd.flyvelyd` og `'bor'`-løkke i `main.js`' rækkefølge, et skud, et brag, en granat, der ikke suser, og Systemnedbrud; ilden høres aldrig samtidig med suset, boret eller kanalen, heller ikke under deres udtoning. |
| Kantpilens ikoner var sorte (`.fp-ikon` gav ingen fyldfarve). | `farer_vis_ui.mjs`: "kantpilens ikon har farve": symbolerne har former, der arver fyldet, og `app.css` giver `.fp-ikon` `fill:currentColor` (gult på det mørkeblå mærke, hvidt på varslets røde). |
| Gæster: en drone, der styrter, falder i vandet eller forsvinder over kanten, blev tegnet igen i 0,3 s (hændelsen kommer før deltaen). | `farer_vis_tegning.mjs`: "en fare, der er meldt væk, tegnes aldrig igen": `spejlFra` med `hvert: 3` i alle tre takter; ingen ny tegning og ingen `vist()` for den, mens spejlet halter, og et snapshot, der kun kortvarigt mangler en fare, er ingen gravsten. |
| Et glimt under nedslagets hold efterlod en rest på 0,1-0,2 s, der pumpede zoomen. Nu venter det på holdet og kommer helt. | `farer_vis_ui.mjs`: "et glimt under nedslagets hold venter på holdet": med det falske kamera (venter, nyeste brag, for gammelt, et nyt skud går forud) og med det rigtige (brag 0,1-1,4 s inde i holdet giver ét helt glimt som et almindeligt, én zoomvending). |
| Kantpilen og navneskiltet stod under sejren (også et frosset varsel). | `farer_vis_ui.mjs`: "pilen og skiltet er væk under sejren og i menuen". |

## Samspillet

```sh
node --no-warnings --test test/samspil.mjs test/samspil_lyd.mjs
```

Tålmodighedsbjælken, vejledningen og farerne blev lavet side om side; her
prøves de sammen, i rigtige verdener og med `main.js`' egne stykker skåret ud af
kilden. Ca. 3 s.

| Fil | Hvad den prøver |
|---|---|
| `samspil.mjs` | Vejledningens ventetid: uret står, men farerne, ilden, planlæggeren, aftrykket og `rngSim` går tick for tick som uden, et varsel og en fare kan komme imens, og ildens loft pr. tur holder. Første tur: med én spiller pr. klinik aldrig en fare, et varsel eller ild (fire banetyper); med to spillere pr. klinik ligger to første ture i runde 2, og planlæggeren går under ventetiden. Ild og kæder i bjælken (`taelSkade` på et spejl med 20 Hz): hvert ildtik i spillerens tur har sit eget tal, intet afsløres under skuddet, fyldet holder, kædens skade (ilden tænder en printer) kommer samlet, tallet springer aldrig, og det talte er det tabte. Deltaens felter er de kendte, spejlet får ventetiden, farerne, ilden og varslet, og en rundtur midt i ventetiden og en brand giver samme aftryk i 600 tick. Farernes pil og skilt: regnetrinnet skriver intet, skrivetrinnet læser intet, og `main.js` kalder dem før og lige efter HUD'en. Kantpilen går uden om holdlisten, arsenalets håndtag og vejledningens kort (også en fare i billedet under kortet), og skjulte felter tæller ikke. `farer_lav_spor.mjs` skriver ikke sporet under testløberen. |
| `samspil_lyd.mjs` | Den rigtige `ui/lyd.js` i et falsk lydmiljø med den rigtige `ui/farer.js` og `main.js`' `taelSkade` på en rigtig kamp: ildtikkenes skadelyd og nedtællingens tik, farens varsel, KORTSLUTNING, flammebraget (forrang) og vejledningens klik lyder aldrig oven i hinanden, og ildens knitren tier, mens kanalen er optaget — også dens udtoning, når den slukkes i samme øjeblik, som et tal tikker. |

## Banerne

Testene kører banegeneratoren direkte.

Kør alle fra projektets rod:

```sh
node --no-warnings test/kort_alle.mjs
```

`--no-warnings` fjerner Nodes advarsel om, at `static/js` ikke har en
`package.json` med `"type": "module"`. Afslutningskoden er 1, hvis en kontrol
fejler. Det hele tager godt et minut.

| Fil | Hvad den prøver |
|---|---|
| `kort_determinisme.mjs` | Samme frø giver samme maske, pynt og fortplan. Værtens vej (Worker) og gæstens vej (snapshot over netværket, også fra en gammel bane) giver den samme bane, også efter kratere. Et snapshot pr. turskift bygger ikke banen om — heller ikke, når `genererSpilbar` prøvede et afledt frø. |
| `kort_variation.mjs` | 50 frø pr. type: ingen to baner ens, og afstanden mellem silhuetterne er stor. Alle arketyper (fortets siluetter og landskaber) forekommer, og ingen fylder over 60 %. Selve borgene (100 frø, kun murværket, rettet ind efter facaden og stueetagen) er forskellige inden for hver siluet: median mindst 0,35 og højst 15 % af parrene under 0,25. |
| `kort_spilbarhed.mjs` | Naturbanerne: startpladser nok og spredt, ingen i vandet eller i en lukket lomme, plads på hver ø, broer i dalene, ingen løse stumper, pynten står på jorden, vandet kan ses, grotten har loft og vand i bunden. En rigtig kampstart: ingen kunde i vandet, på en mine eller under en stor pynteting. |
| `kort_fort.mjs` | Fortet i alle almindelige opstillinger: spejlet pixel for pixel, spejlede pladser/udstyr/kasser (og kassernes stykker), ingen kan hoppe over til fjenden eller ud på landskabet imellem, skydeskåret holder, kunderne i egne rum, samme udstyr på hver borg ved kampstart. |
| `kort_tid.mjs` | Tid pr. bane: 95 % under 250 ms og snit under 150 ms. |
| `kort_gennemgang.mjs` | Fundene fra gennemgangen af banegeneratoren: Spil igen giver en ny bane (lokalt rum), fortets kasser slippes og lander (med vind) kun, hvor man kan komme op, en kasse glider ned ad en mur, brandøvelsen stiller ingen på et tårn, ruinen står på jorden, stenskred og Kvartalsopkrævning falder ned i grotten (og kommer stadig fra himlen på åbent land), og grottens startpladser er i ét hulrum. |
| `kort_hjaelp.mjs` | Fælles hjælpere: PNG-koder, tegner, lille skrift, målene og `tjek`. |

Hver fil kan også køres alene, fx `node --no-warnings test/kort_fort.mjs`.

Kladderne herunder skriver kun tal (og måske et billede) ud og fejler aldrig:

| Fil | Hvad den måler |
|---|---|
| `tjek_gennemgang_kasser.mjs` | hvor fortets forsyningskasser lander med faldskærm og vind, og hvor mange der ender uden for saltoens rækkevidde |
| `tjek_gennemgang_hule.mjs` | stenskred og Kvartalsopkrævning i grotten: hvor nedslagene lander, og hvor meget skade de gør |
| `tjek_gennemgang_borge.mjs [billede.png]` | hvor forskellige selve borgene er inden for én siluet (Jaccard på murværket), og et ark med de nærmeste par |
| `tjek_gennemgang_ruin.mjs [billede.png]` | luft under ruinen på øen mellem borgene, og et nærbillede af den værste |

## Kontaktark

```sh
node --no-warnings test/lav_billeder.mjs              # 12 frø pr. type
node --no-warnings test/lav_billeder.mjs fort 24      # kun fortet, 24 frø
node --no-warnings test/lav_billeder.mjs fort 12 3    # og nærbilleder af frø 0-2
```

Billederne lægges i `test/billeder/` (`kort_<type>.png`, `naer_<type>_<n>.png`).
Himmel er lyseblå, havet mørkeblåt (terræn under vandet ses gennem det), jord
brun med grønt græs, murværk (borge, broer) lyst med mørk kant, fortenes
bagvæg mørkebrun. Prikkerne: startpladser (holdets farve på fortet, ellers
hvide), udstyr (gult) og pynt (grønt). Etiketten er frøets nummer og
arketypen (fortet: siluet/landskab).
