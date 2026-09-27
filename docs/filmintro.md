# Filmintroen — kontrakt mellem teknik og visuelt

Før hver kamp spiller en selvstændig filmsekvens i fightingspil-stil, der
præsenterer klinikkernes faste ansatte (figur 17–22 i `core/klinikker.js`).
Kun de ansatte, der er med i kampen, vises. Bagefter kommer den kendte
nedtælling og faldet fra himlen.

**Teknikken** (tidslinje, synkronisering, lyd, overspring) er på plads. Den
første udgave kører med pladsholdere: portrætterne tegnes fra figurarket, og
udseendet er en simpel CSS. **Det visuelle overtager art directoren** uden at
røre koden.

## Se den

- **Forhåndsvisning:** åbn `http://localhost:8788/?film`. Filmen spiller med
  alle seks ansatte direkte fra forsiden og gentager sig. Esc stopper. Ret
  CSS eller grafik, og genindlæs siden.
- **I en kamp:** Lokalt spil → Start kampen. Filmen spiller hver gang;
  mellemrum springer over (over nettet: en afstemning, se nederst).

## Forløbet

| Slag | Varighed | Indhold |
|---|---|---|
| `titel` | 0,9 s | KUNDEKRIGEN slår ind |
| `klinik` | 0,7 s | klinikkens navn og farve |
| `kunde` | 1,2 s pr. ansat, eller klippets længde | portræt (eller filmklip), navn, rolle og replik |
| … | | næste klinik og dens ansatte |
| `vs` | 1,6 s | alle ansatte på række mod hinanden: VS |
| `slut` | 0,4 s | fade over i kampen |

- **Længde:** 3 mod 3 varer 11,5 s, 2 mod 2 8,5 s og 1 mod 1 5,5 s.
- **Sider:** lige klinikker (grøn, rød) står til venstre, ulige (blå, gul)
  til højre.
- **Klinikker uden ansatte** præsenteres ikke. Er ingen ansatte med, springes
  filmen helt over.

Varighederne ligger i `FILM_MS` i `static/js/core/filmintro.js`, og
kunde-slaget pr. figur med klip i `FILM_KUNDE_MS` (se Filmklip nedenfor).
Simulationen bruger samme tal til at vide, hvornår første tur starter, så
alle netværksspillere er i sync. Du må gerne rette tallene, men kun tallene.
Sig til, hvis et slag skal have en anden struktur.

## Hvem ejer hvad

| Art directoren | Teknik (hovedsessionen) |
|---|---|
| `static/filmintro.css` — alt udseende og alle animationer | `static/js/ui/filmintro.js` — DOM, tidslinje, overspring |
| `static/grafik/intro/` — portrætter, baggrunde, VS-grafik | `static/js/core/filmintro.js` — tidslinje og standardtekster |
| `static/grafik/intro/intro.json` — tekster og filnavne | simulationen, `main.js`, lyden |

Commit kun dine egne filer. Har du brug for noget i de andre, så skriv det,
så laver vi det.

## DOM og CSS

JS bygger denne struktur og skifter kun klasser. Alt andet er CSS.

```html
<div class="film" data-slag="titel|klinik|kunde|vs|slut">
  <div class="film-baggrund"></div>

  <section class="film-slag film-titel">
    <svg class="film-logo">…</svg>
    <div class="film-titel-navn">KUNDEKRIGEN</div>
    <div class="film-titel-under">Klinikkerne er i krig</div>
  </section>

  <section class="film-slag film-klinik" data-side="venstre" data-klinik="groen">
    <div class="film-klinik-navn">Klinik Højhaven</div>
  </section>

  <section class="film-slag film-kunde" data-side="venstre" data-klinik="groen" data-figur="16">
    <div class="film-portraet"><img class="film-portraet-billede"> eller <canvas class="film-portraet-plads"></div>
    <!-- med klip: <section … data-video style="--skilt-ms:6400ms">
         <div class="film-klip"><video class="film-video" playsinline></div> i stedet for .film-portraet -->
    <div class="film-skilt">
      <div class="film-navn">Skrankepaven Ingrid</div>
      <div class="film-rolle">Sekretær</div>
      <p class="film-replik">Tag et nummer. Og vent.</p>
    </div>
  </section>
  …
  <section class="film-slag film-vs" data-antal="2">
    <div class="film-vs-hold" data-side="venstre" data-klinik="groen">
      <div class="film-vs-klinik">Klinik Højhaven</div>
      <div class="film-vs-kunder">
        <div class="film-vs-kunde" data-figur="16"><div class="film-portraet">…</div><div class="film-vs-navn">…</div></div>
      </div>
    </div>
    <div class="film-vs-tegn">VS</div>
    <div class="film-vs-hold" data-side="hoejre" data-klinik="blaa">…</div>
  </section>

  <section class="film-slag film-slut"></section>
  <div class="film-spring" data-stemmer="1" data-kraevet="2">   <!-- data-* kun over nettet -->
    <kbd class="film-spring-tast">Mellemrum</kbd>
    <span class="film-spring-tekst">stem for at springe over</span>
    <span class="film-spring-taelling">1/2</span>                  <!-- tom ved ét tastatur -->
    <ul class="film-spring-hvem">
      <li class="film-spring-stemme stemt mig">Thomas</li>
      <li class="film-spring-stemme">Gæst</li>
    </ul>
  </div>
</div>
```

| Hook | Betydning |
|---|---|
| `.film-slag.aktiv` | slaget vises nu. Start animationer her; de genstarter, når klassen kommer på. |
| `.film-slag.forbi` | slaget er vist |
| `.film.stemt` | jeg har stemt for at springe over (netværk); filmen kører videre |
| `.film[data-stemmer]` | antal stemmer for at springe over lige nu (kun netværk) |
| `.film-spring[data-kraevet]` | så mange stemmer skal der til (flertal) |
| `.film-spring-stemme.stemt` / `.mig` | én pr. deltager: har stemt / er mig |
| `.film.tilskuer` | jeg er ikke med i kampen (tilskuer): afstemningen vises, men jeg kan ikke stemme (tasten er skjult) |
| `.film.faerdig` | filmen er på vej ud (fades på 0,4 s) |
| `[data-side]` | `venstre` eller `hoejre` |
| `[data-klinik]` | `groen`, `blaa`, `roed` eller `gul` |
| `[data-figur]` | 16–21 (figurnummer, 0-baseret: 16 er figur 17) |
| `--slag-ms` | slagets varighed, fx `1200ms` |
| `--klinik-farve` | klinikkens farve |
| `[data-video]` | kunde-slaget har et filmklip (`.film-klip > video.film-video`) |
| `--skilt-ms` | fra `intro.json` → `skilt_ms`, kun når der er et tal |
| `--forsinkelse` | negativ, når man kommer ind midt i et slag, fx som netværksgæst. Læg den til hver animations `animation-delay`, fx `calc(var(--forsinkelse) + .15s)`, så animationen står rigtigt. |

Filmen ligger med `z-index: 50` over spillet og HUD'en. Den skal fylde hele
vinduet fra ca. 450 px til 2560 px bredde, både liggende og stående.

## Grafik

Læg filerne i `static/grafik/intro/`, og peg på dem fra `intro.json`.

| Hvad | Format | Mål |
|---|---|---|
| Portræt pr. ansat | WebP med gennemsigtig baggrund | 960×1120 px (høj 6:7), figuren står med fødderne på billedets underkant og ansigtet i øverste tredjedel |
| (valgfrit) baggrund pr. klinik | WebP | 1920×1080, bruges fra CSS via `[data-klinik]` |
| (valgfrit) VS-grafik, effekter | WebP/SVG | frit; bruges fra CSS |

Portrættet vises i `.film-portraet` og i mindre udgave i VS-slaget. Er der
intet portræt, tegnes kunden fra figurarket som pladsholder.

## Tekster og stemmer: `intro.json`

```json
{
  "figurer": {
    "16": {
      "navn": null,
      "rolle": "Sekretær",
      "replik": "Tag et nummer. Og vent.",
      "portraet": "16.webp",
      "stemme": "stemme_intro_ingrid"
    }
  }
}
```

- `null` eller et manglende felt bruger standarden: navnet fra
  `core/klinikker.js`, rolle og replik fra `core/filmintro.js`.
- `stemme` er valgfri. Den er en af brugerens egne optagelser, lagt i
  `Assets/Kundelyde` (fx `Intro Ingrid.aifc`) og kørt gennem
  `python3 vaerktoej/kundelyde.py`, som giver `static/lyd/stemme_intro_ingrid.ogg`.
  Den hentes automatisk, når den står i `intro.json`.
- En replik skal kunne siges på ca. 1,1 s. Lyde må aldrig overlappe, så en
  længere replik skubber den næste. Skal et slag være længere, så ret `kunde`
  i `FILM_MS`.

## Filmklip (Veo-intro)

Ønsket står i `docs/filmintro-veo.md`. Sådan virker det:

- **Klippet:** `static/grafik/intro/<figur>.mp4` (H.264, 1280×720, med lyd),
  peget på fra `intro.json` → `"video": "21.mp4"`. Kør det gennem
  `ffmpeg -i ind.mp4 -c copy -movflags +faststart <figur>.mp4`, så det kan
  starte, før det er hentet helt.
- **Længden:** slaget varer `FILM_KUNDE_MS[figur]` ms i
  `static/js/core/filmintro.js`. Den skal passe med klippet: rettes
  klippet, rettes tallet. Står der intet tal, bruges `FILM_MS.kunde`.
- **Uret:** klippet følger slagets ur. En sen netværksgæst starter på det
  rigtige sted, og efter sidste billede står det frosset til slaget slutter.
- **Lyden:** klippets lydspor er brugerens egen replik, ikke Veos.
  - Kilden er `Assets/Kundelyde/<Navn>/Dialog.aifc`, og
    `python3 vaerktoej/klipdialog.py` lægger den ind dér, hvor figuren taler.
  - Tiderne står i værktøjet: Ingrid fra 3,2 s, Jan fra 3,4 s. Passer den ikke
    helt til munden, ligger den der alligevel (brugerens ønske).
  - Laves et klip om, køres værktøjet igen.
  - Lyden går gennem lydmotoren (volumen og lyd fra gælder) og er én lyd i den
    fælles kanal. Under filmen er der ingen musik.
  - Afviser browseren lyd, spiller klippet stumt.
- **Hentning:** klippene hentes 2,5 s efter, at siden er åbnet, så de er
  klar til kampen uden at stå i vejen for spillet og musikken.
- **Status:** Dr. Jan fra Mors (21) har sit klip (10,0 s).

## Lyd pr. slag (teknik)

- **Titel og VS:** et kraftigt slag (`intro_slam`).
- **Klinik:** et sus (`salto`).
- **Ansat:** klippets egen lyd, ellers stemmen, hvis der er en, ellers et
  sus (`kast`).

Det hele går gennem den fælles lydkanal, så intet overlapper.

## Netværk og overspring (teknik)

- **Uret:** filmen følger simulationens ur (tilstanden `FILM`), så den står
  ens hos alle, og en gæst, der kommer ind sent, starter i det rigtige slag.
- **Filmen spiller hver gang.** Mellemrum (eller et klik på
  `.film-spring`) springer over.
- **Ét tastatur:** mellemrum springer over med det samme.
- **Netværk:** mellemrum er en stemme. Filmen kører videre hos alle, også
  hos den, der har stemt, og `.film-spring` viser, hvem der har stemt.
  Når et flertal har stemt (mere end halvdelen: 2 af 2, 2 af 3, 3 af 4),
  springes filmen over hos alle på samme tick. Tilskuere stemmer ikke.
- **Layout:** over nettet har `.film-spring` to rækker (ca. 52 px høj) og
  må ikke dække klippets navneskilt. Pladsholderen flytter det nederst til
  venstre i kunde-slagene.
