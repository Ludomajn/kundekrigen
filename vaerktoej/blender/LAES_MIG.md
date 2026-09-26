# Blender-pipeline til Bævere

Genererer spillets grafik som prerenderet 3D og lægger sprite-ark i
`static/grafik/`. Modellerne bygges i kode med `bpy` — der er ingen `.blend`-fil
at vedligeholde, og en ændring er en ændring i et script.

## Kør

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -noaudio -P baever.py
```

**Blender kan ikke køre inde i Claude Codes sandkasse.** Den crasher under
opstart i `GPU_backend_type_selection_detect` → Metal-detektering, altså før
scriptet overhovedet kører. Byg grafikken uden sandkasse.

## Hvorfor lagdelt

Udseendet er et parametersæt: 6 pelstoner × 8 hovedbeklædninger × 6 tilbehør
× 4 holdfarver. Det er over 1000 kombinationer gange 12 frames — umuligt at
prerendere. Derfor renderes i lag:

| Ark | Indhold | Tones ved kørsel |
|---|---|---|
| `krop.png` | pelsen i neutral grå | ja — ganges med pelstonen |
| `detalje.png` | øjne, næse, fortænder | nej |
| `halsklud.png` | holdmarkøren | ja — holdfarven |
| `hat_*.png` | hver hovedbeklædning | delvis |
| `tilb_*.png` | hvert tilbehør | nej |

Spillet stabler lagene. Al tilpasning overlever, og alt er ægte 3D.

Pelsen renderes bevidst **underbelyst**: brænder den ud i hvidt, er der ingen
tonerange at gange en farve på, og figuren bliver flad uanset valget.

## Konturen er ikke pynt

`opsaet_kontur()` slår Freestyle til. Uden et markeret omrids bliver en blød
3D-form til en grød, når den vises som 40 px sprite. Det er dét, der gør
klassiske sprites læsbare ved lille størrelse.

## Fælles lysretning

Alle lag belyses med sol oppe til venstre — samme retning som himmelgradienten
og terrænets shader i spillet. Uden fælles lysretning ser de renderede lag
forkerte ud oven på det procedurelle terræn.
