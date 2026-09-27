# Filmintroen med Veo-klip — ønske fra art directoren til teknikken

Supplement til `docs/filmintro.md`. Brugeren har besluttet, at hver af de seks
faste ansatte får en **filmisk intro i Tekken 8-stil**, genereret med Google Veo:

- lavt kamera, pose, nærbillede
- figuren siger sin replik
- frys

Piloten (Skrankepaven Ingrid) er godkendt. Dette dokument beskriver, hvad der
skal til i teknikken. Art directoren ejer klip, CSS og `intro.json`; teknikken
ejer resten, som før.

## Klippene (leveres af art directoren)

- **Filer:** `static/grafik/intro/<figur>.mp4` og `<figur>.webm`, 1280×720,
  24 fps, med indbrændt lyd (stemme og effekter).
- **Længde:** ca. 5,5–7 s pr. klip.
- **Vandmærke:** Veo sætter et lille Gemini-vandmærke nederst til højre
  (omkring x 1160, y 600 ud af 1280×720) i hver frame. Navneskiltet dækker det
  (se punkt 4).
- **intro.json pr. figur, nye felter:**

```json
"16": {
  "replik": "Har du en tid? Nej? Så har du et problem.",
  "video": "16.mp4",
  "skilt_ms": 6400
}
```

## Hvad teknikken skal lave

1. **Varighed pr. figur.** Kunde-slaget skal have sin varighed pr. figur i
   stedet for én fælles `FILM_MS.kunde`. Fx `FILM_KUNDE_MS = {16: 6800, …}` i
   `core/filmintro.js`. Det skal ligge dér og ikke i `intro.json`, fordi
   simulationen skal kende tallene deterministisk. Art directoren sender
   tallene, når klippene er klippet.
2. **Video i kunde-slaget.** I `.film-kunde`:
   `<video class="film-video" playsinline preload="auto">` med `src` fra
   `intro.json` → `video`.
   - Den starter, når slaget bliver `.aktiv`.
   - `currentTime` følger slagets ur, også `--forsinkelse`, så sene
     netværksgæster ser det rigtige sted.
   - Når klippet slutter, bliver sidste frame stående (frys).
   - Uden `video` falder slaget tilbage til portrættet som i dag.
3. **Lyden.** Videoens lydspor tæller som én lyd i den fælles kanal: intet
   andet må spille samtidig (lydreglen). Skal lyden hellere gå gennem
   lydmotoren end gennem video-elementet, så sig til. Så leverer art
   directoren lydsporet som `.ogg`, og videoen afspilles uden lyd.
4. **Navneskiltets timing.**
   - `.film-skilt` skal være i DOM'en fra slagets start. I sin lille
     hjørnetilstand dækker det vandmærket fra første frame.
   - Sæt CSS-variablen `--skilt-ms` på sektionen fra `intro.json` →
     `skilt_ms`. Så kan CSS'en time, hvornår det fulde Borderlands-navnekort
     slår ud.
5. **VS-slaget** bruger stadig portrætter (WebP efter kontrakten, leveres af
   art directoren).

## Åbent spørgsmål til brugeren (spildesign)

Seks klip giver 35–45 s intro ved 3 mod 3. Man kan springe over, men det er
langt, hvis det sker før hver kamp. Muligheder:

- den fulde intro kun første gang i en session,
- klip kortet ned til selve replikken (ca. 4 s pr. ansat).

## Allerede ændret af art directoren

- **Dr. Jan fra Mors** er nu bitter og vestjysk (66 år, voksjakke, overskæg og
  stubbe) og ikke længere nervøs.
  - Figur 22 er ompakket.
  - `core/klinikker.js`, `README.md` og `intro.json` er rettet.
  - Standardreplikken i `core/filmintro.js` ('Er det … er det nu?') passer
    ikke længere, men `intro.json` overskriver den.
