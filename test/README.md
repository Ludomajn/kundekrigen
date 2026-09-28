# Testene

Alle testene kører i Node (og én i Python) — uden server og uden browser.
Mappen serveres ikke (kun `static/` gør). Der er fire grupper: banerne
(`kort_*.mjs`), kameraet (`kamera_*.mjs`, se `docs/kamera.md`), fysikken
(`fysik_*.mjs`) og serverens rum (`rum_*.py`).

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
