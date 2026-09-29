# Dommer over punkt 3: farer i realtid

## Point

| Kriterium (1-10) | **dybde** | **sikker** | **tema** |
|---|---|---|---|
| Testerens ønske: realtid, ren RNG, kæder, "sygt play" | 9 | 6 | 9 |
| Sim- og netsikkerhed | 8 | 9 | 7 |
| Turintegration | 8 | 6 | 6 |
| Temafit | 8 | 6 | 10 |
| Risiko og størrelse (10 = lav risiko, lille) | 5 | 8 | 4 |
| **I alt (af 50)** | **38** | **35** | **36** |

**Vinder: dybde.** Den er grundlaget for det endelige design. Fra de to andre er podet:
- **fra tema:** navnene, reglen "ingen fare skader af sig selv", Pakkedronens LEVERET! og kæde-id gennem eksplosionskøen.
- **fra sikker:** termineringsbeviset, den frit faldende pakke og segment-cirkel-træffet.

### Verifikation mod koden (træet 28/9 ca. kl. 21)

**dybde**
- Holder: stort set alle ankre, fx `erIRo` (turn.js:112-127), `foelgSkud` (main.js:1045-1077), `vindNu` (physics.js:44-50, world.js:1182), printertjekket (world.js:659-662), `VAABENKASSE_MAKS` (world.js:41), `_udstyrsPladser` (world.js:352-358), `givSkade` (damage.js:85-100), inferno-teksten (weapons.js:79) og `haendelseChance` 0 uden træk (haendelser.js:103-104).
- Forkert:
  - `hud.banner` står nu i hud.js:470 (ikke :456).
  - Kamera-API-testen står i test/kamera_determinisme.mjs:141-152 (ikke :118-130).
  - Atlasset har `udloes_0-2` med 3 frames (objekt_view.js:4 og :29), ikke 0-3.
- Forældet måling: åben bane er nu **97 % JORD** (1157 af 1190 pladser, mit eget node-eksperiment), ikke 69 %. MapGEN har skiftet arketyper.
- Designmæssigt: Tordenskyen skader uden en spillerhandling, og `varme`-systemet er en ekstra uro-kilde.

**sikker**
- Holder: ankrene er korrekte, fx VIDERESEND (worker.js:18-31), `genskab` tømmer køerne (world.js:1270-1272), `t.type` (terrain_gen.js:35-40), grenen for telefon og piller (world.js:709) og KUN_VAERT (protokol.py:45).
- Forkert: den rapporterede granatfejl ("physics.js:220-226 returnerer før lunten ved :255") findes ikke længere. `skridtProjektil` tæller nu lunten ned først (physics.js:200-204, filen er ændret 20:49). Forbuddet mod granater i testen kan derfor droppes.
- Svaghed: mellem turene kører farerne videre, også i TUR_START. En ny kunde kan tage ildskade, før den kan flytte sig, og skyttens kæde kan udspille sig i næste spillers tur.

**tema**
- Holder: de mest præcise linjetal, fx `hud.banner` (hud.js:470), `rammeInd` (camera.js:365), `turNr++` (world.js:923) og kamera-testen (:141-152).
- Forældet: physics.js-ankrene `skridtKasse` (:277, nu :304) og `skridtFaldende` (:260-274, nu :287-301).
- Overset: `hjaelp.hint()` tømmer tutorialens kø (`koe = []`, hjaelp.js:163). At bruge den til fare-tip ville klippe punkt 2's introduktion over.
- Tungt: fem farer, en ladestation, `fraFare` der går uden om `erIRo` og `tvungenRo`, og 16-41 ildpletter pr. brand, altså tæt på loftet.

**Mine egne målinger** (node, kun læsning, `$TMPDIR/farer/`, på det nuværende MapGEN-træ; 6 frø × 10 scenarier × 50 s, vinden rullet hver 23. s, med rullemodellen fra §2.1):

| Bane | Sidder fast | Ud over kanten | Endte i havet | Passerer < 60 wu fra en kunde | Median sek. < 200 wu fra kunde | Median nettoafstand |
|---|---|---|---|---|---|---|
| åben | 4/60 | 29/60 | 4/60 | 42/60 | 6 s | 1165 wu |
| øer | 4/60 | 19/60 | 17/60 | 45/60 | 5 s | 1305 wu |
| hule | 4/60 | 0/60 | 16/60 | 35/60 | 4 s | 1120 wu |
| fort | 0/60 | 5/60 | 13/60 | 9/60 | 0 s | 351 wu |

Materialet under udstyrspladserne: åben 97 % JORD, øer 100 % JORD, hule 100 % JORD, fort 100 % MUR.

---

# Endeligt design

> Kun design. Ingen filer i repoet er ændret.
>
> `world.js`, `main.js`, `hud.js`, `camera.js` og `terrain_gen.js` ændres lige nu af andre agenter. **Funktionsnavnet ved hver henvisning er ankeret, linjetallet er et øjebliksbillede.**

## 0. Kort fortalt

- **Et nyt hovedløst modul, `sim/farer.js`, og tre nye felter på verden:** `v.farer`, `v.ild` og `v.farePlan`. Alt er ren data i snapshottet.
- **Tre farer.**
  - Flagskibet er **Kabelsalaten**, en rullebusk af kabler og makulat. I hulen hedder den **Nullermanden**; det er samme entitet med andet udseende.
  - **Pakkedronen** og **Robotstøvsugeren** kommer i bølge 2.
  - Dertil kommer den nye mekanik **ild**.
- **Ren RNG i hvornår, hvad og hvor.** Opførslen er deterministisk og til at læse: vindpilen styrer Kabelsalaten.
- **Farerne kører i aktiv tid:** SPILLER_AKTIV, AFFYRING og OPLOESNING. De kan dukke op midt i sigtet, midt i flugten og midt i en pause i arsenalet, uafhængigt af tururet. I TUR_START, SKADE og TUR_SLUT står de stille; render lader dem svaje og flakke.
- **De er aldrig projektiler og ligger aldrig i `forsinkede`.** De stjæler derfor ikke kameraet, og vagthunden ikke kan slette dem ved en fejl.
- **Uro er én begrænset nedtælling pr. fare** (`f.uro` ≤ 240 tick) plus `lunte` på placerede ting (≤ 90 tick). Skyttens kæde afvikles dermed i skyttens egen tur.
- **Opvarmning genbruger den eksisterende `lunte` på placerede ting** (world.js:690-695). Den er allerede med i deltaet (snapshot.js:93), så spejlet viser en printer i brand gratis.

## 1. Fire regler

1. **Ankomsten er ren RNG, udfaldet kræver dygtighed.** `rngSim` bruges kun i planlæggeren: pause, slags, sted, side i vindstille og dronens last. Bevægelse, spredning og skade er rene funktioner af tilstanden, terrænet, `vindNu()` og `v.tick`.
2. **Ingen fare skader af sig selv.** Al skade starter med et skud, et brag eller ild. En brand kan kun startes af et skud eller et brag, eller af en fare, som et skud eller et brag har antændt. Derfor er et godt træk et "sygt play" og ikke en tilfældig straf. Tordenskyen er skåret af netop den grund.
3. **Farer er baggrund, kun konsekvenserne tæller.** Konsekvenserne er brag i den almindelige kø (world.js:603-607), kunder i skub og en pakke, der falder. Alle er endelige og korte.
4. **Alt er begrænset:**
   - højst 1 fare ad gangen
   - højst 40 ildpletter
   - hver ting antændes og springer højst én gang
   - ild spreder sig i højst 2 generationer
   - dybden for antændelser er højst 5.

## 2. Rosteret

| # | Fare | Tema | Bølge | Baner (vægt) |
|---|---|---|---|---|
| 1 | **Kabelsalaten** / **Nullermanden** (hule) | En rullende bylt af strøm-, netværks- og opladerkabler med strimler af makuleret "FORTROLIGT". I hulen er det en kæmpe støvtot med en clips, en post-it og et SIM-kort | 1 (MVP) | åben 5 · øer 5 · hule 4 · fort 1 |
| 2 | **Pakkedronen** | Leveringsdronen fra webshoppen med en papkasse med "SKRØBELIG"-tape. Skyd den ned, og pakken falder. **Scan** den, og pakken er din: "LEVERET!" | 2 | åben 3 · øer 4 · hule 0 · fort 5 |
| 3 | **Robotstøvsugeren** | Klinikkens robotstøvsuger. Den suger phishing-mails op ("spamfilter"), og batteriet er ikke CE-mærket | 2 | åben 2 · øer 1 · hule 4 · fort 3 |

**Skåret, og hvorfor:**
- **Firmaballonen** (dybde) overlapper dronen. Den svæver i `max(overflade)+180`, altså 800-1300 wu, men kameraet viser kun 460 wu i højden (camera.js:7-8). Den ville være uden for billedet.
- **Tordenskyen** (dybde) bryder regel 2.
- **Tonertønden** (sikker) kopierer printeren, som har `sprite: 'toende'` (world.js:224).
- **Lattergassen** (sikker) er et svagt tema for en lægeklinik.
- **Skyløsningen** (tema) overlapper dronens "skyd flyveren over fjenden", og vejret bremser allerede ilden (§3).
- **`varme`-systemet** (dybde og tema) er erstattet af `lunte`.
- **Ladestationen, fareløkker, brændende våbenkasser og brag-budgettet pr. tur** er ikke komplekset værd. Budgettet er overflødigt, fordi alle kilder er endelige (§4.3).

### 2.1 Kabelsalaten (flagskib)

**Indgang: den blæser ind ovenfra**
- Pladsen trækkes (1 træk fra `rngSim`) blandt `_udstyrsPladser()` (world.js:352) med to krav:
  - mindst 250 wu fra alle levende kunder
  - åben himmel, `terraen.overflade(p.x) <= p.y + 2`. Kravet gælder ikke i hulen.
- Kabelsalaten starter 200 wu over pladsen med `vx = ret·60`. Under et loft starter den 34 wu under loftet, samme søgning som `_slipVaabenkasse` (world.js:1066). I hulen drysser Nullermanden dermed ned fra loftet.
- Retningen er fortegnet på `vindNu()`. Ved |vindNu| < 0,05 trækkes den fra `rngSim`.

**Bevægelse** (prototypet ovenfor). En cirkel med r 14 og fodpunktet nederst.

| Tilstand | Opførsel |
|---|---|
| **På jorden** | Målfart `klem(240·vindNu, ±150)`, aldrig under 24 wu/s i rulleretningen, med inerti 0,04 pr. tick. Trin som i `physics.gaa`: øverste frie trin fra +8 til −10 wu, og derfra ned til jorden. Ingen fri position giver en væg: prel (−0,3·vx) og hop med vy 260 |
| **I luften** | Tyngde 0,55 · `TYNGDE`, og farten glider mod vinden med halv inerti |
| **I vandet** | Flyder i vandlinjen med halv fart og kravler selv i land på en kyst, der ligger højst 8 wu over vandet |
| **Sidder fast** | Under 12 wu fremdrift på 150 tick giver et vindstødshop (vy 300, vx ret·80), højst 2 gange. Derefter ligger den stille som et mål |
| **Levetid** | 50 s aktiv tid, eller til den er ude over kanten (`fareVaek` `'kant'` eller `'traet'`) |

Vinden rulles ved hver turstart (turn.js:182-192, kaldt fra world.js:942). Kabelsalaten skifter altså kurs fra tur til tur, og **vindpilen, man allerede læser for at sigte, fortæller, hvor den ruller hen.** Ved median |vind| ≈ 0,3 ruller den ~70 wu/s, mens en kunde går 105 (physics.js:14). Man kan altså nå væk.

**Antændes af:**
- en eksplosion inden for radius + r
- et projektil, der rører den. Projektilet sprænger **på** den, som ved printeren.
- Stregkodescannerens stråle
- en ildplet inden for 13 wu af fodpunktet.

**Skub:** 1,6 gange en kundes skub fra eksplosioner. Klageklasket slår den væk (vx ±240, vy 160) og antænder ikke, så man kan slå den hen mod fjenden.

**Brændende** ("KORTSLUTNING!", 120 tick, `uro` = 130):
- Den ruller 1,3 gange hurtigere og lægger en ildplet (gen 1) hvert 20. tick, mens den er på jorden.
- Til sidst kommer **flammebraget** gennem eksplosionskøen: r 44, skade 22, skub 150, **uden krater**, plus en ring på 5 pletter (gen 0, x −48…+48).
- **Rammer den vandet, mens den brænder, er den slukket** ("PSST", `fareVaek` `'slukket'`, intet brag). Det er modspillet: skyd den, mens den er over land og tæt på fjenden.

**Sygt play**
- Kabelsalaten ruller ind mellem to fjender. En Tonerkanon (r 58, skade 48) antænder den. Hver fjende får ~20-30 fra braget, 22·f fra flammebraget og op til 24 fra ilden, og skubbet kan sende dem i havet.
- Eller: en brændende Kabelsalat ruller hen til en printer. Ilden sætter lunten (90 tick), og printeren springer med r 96 og skade 62 (world.js:223).

### 2.2 Pakkedronen (bølge 2)

**Kan kun komme, når alle tre gælder:**
- banen er ikke hulen
- `!v.internetNede()` (world.js:413): "dronen kan ikke finde vej uden internet"
- der er plads til en våbenkasse, `v._ledigeKassepladser() > 0` (world.js:1041).

**Indgang og last:** fra vindsidens kant (x −60 eller w+60), eller fra en side trukket fra `rngSim` i vindstille. Lasten trækkes ved indgangen med `tilfaeldigtKassevaaben(v.rngSim)` (weapons.js:217).

**Flyvning** (terrænfølgningen, som tema målte: 196-229 wu fri højde på 24 kørsler):
- 110 wu/s.
- Hvert 8. aktive tick sættes `maalY` = max af `overflade()` i 9 prøver fra 0 til 720 wu frem, plus 200. Loftet er h − 60, gulvet vand + 200.
- Den stiger højst 120 wu/s og synker højst 40 wu/s.
- Rører den alligevel terrænet, er det bare "BONK": den løftes og tager ingen skade.
- Ude ved x < −80 eller > w+80 forsvinder den (`fareVaek` `'kant'`), og chancen er forpasset.

**Scannerens stråle: LEVERET!**
- Skyttens klinik får `kasseAntal(indhold)` af lasten (weapons.js:228), efter samme mønster som `_samlKasse` (world.js:745-750). Der meldes `ammoAendret` og `fareLeveret`.
- Dronen flyver glad videre uden pakke. Den kan stadig skydes ned.

**Projektil eller eksplosion: nedskudt** (`uro` = 240):
- Pakken bliver en almindelig våbenkasse (`lavKasse`, entities.js:109) med `fald: true`. Den falder frit gennem grenen for telefon og piller (world.js:709) og lander på < 1 s, så `erIRo` ikke venter på en faldskærm.
- Kassen laves kun, hvis der stadig er plads. Ellers bliver det til konfetti.
- Dronen falder ballistisk (tyngde 480, vx × 0,6). Ved nedslaget kommer et brag i køen (r 38, skade 24, skub 180, krater) og 2 ildpletter fra batteriet. I vandet forsvinder den med et plask.

**Sygt play:** skyd dronen, når den er lige over fjendens printer. Styrtet og ilden gør resten, og kassen lander ved siden af. Eller: scan den og få våbnet uden at røre dig.

### 2.3 Robotstøvsugeren (bølge 2)

**Indgang:** den "vågner" på en udstyrsplads mindst 300 wu fra alle kunder.
- **Naturbaner:** blandt de 3 mest neutrale pladser (mindst forskel mellem holdenes nærmeste afstand) trækker `rngSim` én.
- **Fortet:** skiftevis på borgene (`farePlan.antal % antal borge`) og med samme pladsnummer. Borgenes pladser står i spejlet rækkefølge (world.js:232-236).

**Kørsel**
- `F.gaa` (physics.js:96-118) kaldes på støvsugeren selv hvert andet aktive tick, altså ~52 wu/s. Det bruger kundens kapsel: en konservativ grænse, der giver hverken nye huler eller sprækker.
- Den vender:
  - ved en væg (`gaa` giver `false`)
  - ved et fald på over 24 wu foran sig (klippesensor)
  - ved en kunde inden for 22 wu ("undskyld"), så man kan spærre den med kroppen.
- Løftes den af et skub, falder den med `F.skridtBaever` (physics.js:131). Faldskaden ignoreres.
- I vandet kortslutter den og forsvinder uden brag.

**Spamfilter:** en phishing-mine, den kører ind i (|dx| < 18, |dy| < 16), sættes til `doed` uden brag og ryger i beholderen. Den spiser højst 2 (`fareSpiste`). Minens nærhedstjek gælder kun kunder (world.js:697-698), så koden i minen ændres ikke.

**Antændes** af eksplosioner, projektiler, scanneren og ild, som Kabelsalaten. Så er den **overophedet** i 90 tick og står og ryster med rød LED (`uro` = 100). Derefter springer batteriet: r 50 + 12 og skade 30 + 15 pr. spist mine, skub 220, krater og 3 ildpletter. Eksplosioner skubber den 0,8 gange en kundes skub.

**Tvangsopdateringen** (`straale`, behaviours.js:198-224) sætter den på pause i 300 tick ("installerer opdateringer"). Så kan man parkere den ved fjenden.

**Levetid:** 60 s aktiv tid. Derefter "lavt batteri" (`fareVaek` `'traet'`).

**Sygt play:** en shitstorm har spredt ticketminer. Støvsugeren har spist to og er kørt ind i fjendens hal. Én Datalæk-bombe giver et brag med r 74 plus r 74 og skade 55 plus 60.

## 3. Ild (ny simulationsmekanik)

```js
// v.ild — ren data
{ id, x, y, alder, liv, gen, jord, kaede, kaedeId, kildeHold }
```

**Placering** med `taendIld(v, x, yRef, gen, kilde)`:
- x snappes til et gitter på 24 wu.
- `g = terraen.jordUnder(x, yRef + 30)` (terrain.js:157-162). **Brug aldrig `overflade()`**: i hulen giver den loftet (terrain.js:165-168 scanner ovenfra).
- Pletten afvises, hvis:
  - der ikke er jord inden for 60 wu, eller `g + 1 < vandNiveau + 2`
  - `fast(x, g + 4)`, altså at den er begravet: ild klatrer ikke op ad mure
  - der allerede ligger en plet i samme celle inden for 24 wu i højden
  - `ild.length >= ILD_MAKS`.
- `jord = terraen.hent(x, g) === JORD` (terrain.js:20). Kun græs og jord spreder ilden. Fortets mursten og broerne (MUR, terrain.js:25) brænder, men giver den ikke videre.

**Hvert aktive tick**
- `alder++`.
- **Spredning, uden tilfældighed.** Når alderen er præcis 45 tick, og `gen < 2`, `jord` er sand, og vejret tillader det, tænder pletten én celle (24 wu) i vindens retning. Ved |vindNu| < 0,15 tænder den begge veje. Nye pletter går i en kø, der føjes til efter løkken, så rækkefølgen aldrig betyder noget. Ingen Map- eller Set-iteration (entities.js:3-5).
- **Vejret:** i regn og slud er levetiden halv, og der er ingen spredning. I sne er der ingen spredning (`v.vejr` læses hvert tick og kan skifte under uvejr, world.js:1150-1154).
- **Hvert 10. tick:**
  - Er jorden væk (`!fast(x, y−1)`), falder pletten til `jordUnder`. Er faldet over 40 wu, slukkes den.
  - Under `vandNiveau + 2` er den slukket. Det gælder også, når vandet stiger i pludselig død eller ved en vandskade.
  - `fast(x, y + 3)` betyder kvalt. Papirbunke og Byggeskum er dermed brandslukkere.
- `alder >= liv` slukker den. Levetiden er `ILD_LIV + 15·(id % 4)`. Variationen er afledt af id'et og koster intet træk fra `rngSim`.

**Skade** (hvert `ILD_TAKT`, i global fase `v.tick % 30 === 0`)
- En levende kunde uden kraftfelt tager skade, hvis dens træfzone er inden for `ILD_R` af (plet.x, plet.y + 6) eller inden for f.r + 4 af en brændende fare.
- Den får `min(ILD_SKADE, ILD_LOFT − b.ildTur)` gennem `givSkade(…, 'ild', h, kilde)` (damage.js:85). Det er højst én gang pr. takt, uanset hvor mange pletter kunden står i. `kilde` er den første rørende plet i id-orden.
- **Kraftfeltet:** ingen skade og **ingen** `skjoldBlok`. Tjek `b.skjold` før kaldet, ellers kommer der en hændelse hver halve sekund.
- **Ingen skub**, så ild kan aldrig holde verden i uro.

**Antænder:**
- farer (§2)
- placerede ting inden for 20 wu med `lunte === 0`: printeren (`'toende'`) får `lunte = 90`, minen `lunte = 30`. De får `kaede` = pletten + 1 og pletens `kaedeId` og `kildeHold`. Resten klares af den eksisterende lunte-gren (world.js:690-695).

Våbenkasser, telefon, piller og gravsten er immune over for ild. Eksplosioner river dem stadig med som i dag (damage.js:68-75).

## 4. Kæderegler og terminering

### 4.1 Hvem reagerer på hvad

| Kilde → mål | Kabelsalat | Drone | Støvsuger | Printer / mine | Kasser | Kunde |
|---|---|---|---|---|---|---|
| Eksplosion (`D.eksploder`) | antændes + skub ×1,6 | nedskudt | antændes + skub ×0,8 | springer (som i dag, damage.js:59-67) | springer (som i dag, :68-75) | skade + skub (som i dag) |
| Projektil rører (`rammerBaevere` og `detonation` eller `klynge`) | sprænger på den | sprænger på den → nedskudt | sprænger på den | printer: som i dag (world.js:659-662) | – | som i dag |
| Scanner (hitscan) | antændes | **LEVERET!** | antændes | – | – | som i dag |
| Klageklask | slås væk | – | vender | – | – | som i dag |
| Tvangsopdatering | – | – | pause 300 tick | – | – | som i dag |
| Ildplet / brændende fare | antændes | – | antændes | `lunte` 90 / 30 | immune | 4 pr. takt, loft 24 pr. tur |
| Vand | flyder; slukkes, hvis den brænder | forsvinder | kortslutter | – | – | drukner |

Papirbunke og COVID har ingen `detonation` eller `klynge` og flyver gennem farerne. Hoppende granater (`rammerBaevere: false`) rører dem ikke, men deres brag antænder.

### 4.2 Kæde-id, dybde og ejer

Tre flade felter følger med: `kaedeId`, `kildeHold` og `kaede` (dybden).

**Kædens start (dybde 0)**
- Et projektils brag (world.js:679) starter med `{ kaedeId: p.kaedeId ?? p.id, kildeHold: p.ejerHold, kaede: 0 }`.
- Klyngens børn arver `kaedeId` (behaviours.js:103-111).
- Scanner og klask bruger `kaedeId = −v.tick`. Det kræver intet nyt id, så id-rækken er uændret, når farerne er slået fra.

**Dybde + 1**
- Alt, som en kilde på dybde d udløser, får d + 1:
  - placerede ting og kasser, der lægges i køen (damage.js:64 og :73)
  - farer, der antændes
  - placerede ting, som ild tænder.
- Pletterne arver dybden fra det, der tændte dem, og spredning beholder dybden.

**Loft:** `KAEDE_MAKS = 5` gælder kun antændelser af farer og lunter fra ild. Et brag eller en plet på dybde 5 skubber og skader stadig, men tænder intet. Kæderne mellem eksplosioner og placerede ting, som findes i dag, ændres ikke.

**Hændelserne:** `eksplosion` (damage.js:77) og `skade` (damage.js:94, gennem en ny valgfri `ekstra`) bærer felterne, og `skade` får `drab: true`, når kunden dør. Brugerfladen kan dermed tælle et sygt play uden ekstra tilstand i simulationen. Og printerkæderne, der findes i dag, får gratis et "KÆDE ×n".

### 4.3 Hvorfor enhver kæde slutter

1. **Hver tilstand går kun fremad.**
   - Kabelsalat: aktiv → brænder → brag eller væk.
   - Drone: flyver → styrter → brag eller væk.
   - Støvsuger: kører → overophedet → brag.
   Hver fare antændes og springer højst én gang. Placerede ting og kasser dør én gang (`doed`, damage.js:63 og :72).
2. **Ilden er endelig.** Kilderne er:
   - ≤ 6 pletter som spor + 5 i ringen pr. Kabelsalat
   - 3 pr. støvsuger
   - 2 pr. drone.

   Hver plet spreder sig højst én gang pr. retning og kun ved gen < 2. Én kilde giver derfor højst 3 generationer. Loftet er 40 pletter, og levetiden er højst 285 aktive tick. Ild skaber kun brag gennem lunter på placerede ting, og dem er der endeligt mange af.
3. **Nye farer kommer kun fra planlæggeren**, højst én ad gangen og mindst 80 s aktiv tid imellem.
4. **Køen drænes én pr. tick** (world.js:603-607), så der er ingen rekursion.
5. **Hver gang SKADE går tilbage til OPLOESNING** (world.js:840-849), kræver det et nyt dødsfald eller en ny eksplosion i køen. Begge bruger en ting op fra en endelig mængde. Antallet af genindtræden pr. tur er derfor højst #kunder + #placerede + #kasser + #farer.

### 4.4 Hvad holder OPLOESNING åben

`erIRo` (turn.js:112-127) får to nye linjer og ingen import:

```js
for (const f of v.farer || []) if (f.uro > 0) return false;        // brænder, styrter, er i et skub
for (const p of v.placerede) if (p.lunte > 0 && !p.doed) return false;  // printer/mine sat i brand
```

`f.uro` er én nedtælling:

| Tilstand | Værdi |
|---|---|
| Antændt Kabelsalat | 130 |
| Overophedet støvsuger | 100 |
| Styrtende drone | 240 |
| Fare i et skub | 180; nulstilles ved landingen |

Den tæller ned i `FA.skridt`. Rullende, flydende, kørende og flyvende farer er **ikke** uro, og ildpletter er aldrig uro. Intet andet sætter i dag `lunte > 0` på placerede ting (behaviours.js:274 og world.js:211-269 bruger 0). Linjen påvirker derfor kun den nye vej.

**Vagthunden** `RO_VAGTHUND` 720 (turn.js:33) er uændret. `tvungenRo` (turn.js:129-153) udvides:
- brændende og styrtende farer fjernes med `fareVaek` `'slukket'`
- `uro` nulstilles på resten
- `p.lunte = 0` på placerede ting, så printeren går i dvale.

## 5. Spawnregler

```js
v.farePlan = { aktiv: 0, naeste: null, varsel: null /* {slags,x,y,ret,rest} */, antal: 0, sidste: null }
```

**Uret**
- `aktiv` tæller kun aktive tick (SPILLER_AKTIV, AFFYRING og OPLOESNING). Der kommer derfor aldrig farer under LOBBY, FILM, UDSAET, TUR_START, SKADE, TUR_SLUT eller SEJR.
- **Første fare:** når `tur.runde >= 2` (tælles i `_maaskeNyRunde`, world.js:1165-1170), trækkes `naeste = aktiv + [30, 70] s`. Med serverens standardtur på 30 s (rum.py:101-108) giver det typisk tur 4-7. Så **ser de fleste den i deres første kamp**.
- **Derefter:** `[80, 160] s` aktiv tid. Uret går kun, mens `farer.length < FARE_MAKS` (1).

**Varslet**
- Når uret er løbet ud, vælges slags og sted.
- **Slags:** vægtet efter banetypen (§2) blandt dem, der kan ske lige nu. Aldrig den samme to gange i træk, medmindre den er den eneste; mønsteret er `sidsteHaendelse`, haendelser.js:106.
- **Findes intet gyldigt sted,** udsættes planen `FARE_UDSAET` = 300 tick. Tallet er fast, så der trækkes intet fra `rngSim`.
- **Ellers** lægges `varsel` med `rest = 180` (3 s aktiv tid), og `fareVarsel` meldes. Faren er synlig som en pulserende pil, men kan ikke rammes.
- Ved `rest === 0` kommer faren ind (`fareKommer`), og en ny pause trækkes.
- Et udsendt varsel holdes altid.

**Træk fra `rngSim` pr. fare:** højst 4 (pause, slags, sted og last eller side).

**`cfg.farer`**
- `null` (standard i `STANDARD_CFG`, world.js:46-58): alle farer.
- `[]`: ingen, og **intet træk** fra `rngSim`. Det er samme regel som `haendelseChance` 0 (haendelser.js:103-104).
- En liste: kun de nævnte.
- Til test: `FA.tving(v, slags, sted, h)`, som spillet aldrig kalder (samme mønster som `HN.udloes`, haendelser.js:114).

**Pludselig død:** tilladt med de samme regler. Regel 2 gælder stadig: en brand, en spiller har tændt, bliver et afsluttende træk. Vandet, der stiger (`hoevVand`, turn.js:211-214), slukker lav ild og løfter de flydende kabelsalater.

## 6. Turintegration (kritisk)

| Tilstand | Farer og ild | Planlæggerens ur | Hvorfor |
|---|---|---|---|
| FILM, UDSAET | står stille | står | filmen og nedtællingen |
| TUR_START (150 tick, turn.js:31) | står stille (render svajer og flakker) | står | kunden kan ikke flytte sig endnu, og ingen må komme til skade før det |
| **SPILLER_AKTIV** | **kører** | **går** | realtid, også mens arsenalets pause står på (world.js:796-798). Det er urgency'en |
| AFFYRING | kører | går | ét tick |
| **OPLOESNING** | **kører** | **går** | kæden afvikles i skyttens tur (§4.4) |
| SKADE, TUR_SLUT | står stille | står | efterspillet tæller skaden ned, og skiftet skal være kort og sikkert. Farerne kan derfor aldrig sende SKADE tilbage til OPLOESNING |
| SEJR | står stille | står | – |

Farerne pauses og fjernes ikke ved turskift. Deres levetid tæller kun i aktiv tid.

**Rækkefølgen i ét tick** (`skridt`, world.js:594-630):

```
_draenKommandoer → _maskine → én eksplosion fra køen (damage.js sætter f.ramt)
→ forsinkede → _fysik (projektiler sætter f.ramt; lunter tikker) → FA.skridt(v, h) → tjekDrukning
FA.skridt: return uden for AKTIV · plan · reagér på f.ramt · bevæg · kontakter
           (ild↔farer, ild↔placerede, støvsuger↔miner) · ild (alder, spredning, sluk) · ildskade · fjern
```

Et `f.ramt`, der sættes, mens farerne står stille, bliver liggende som ren data (også i snapshottet) og afvikles ved første aktive tick. Det sker fx, når printerhændelsen går af i `_turStart` (haendelser.js:209-217).

**Dødsfald og tur**
- Dør den aktive kunde af ild, afslutter `_aktivErDoed` turen (world.js:794).
- Andre, der dør, ligger i `doedskoe` og afvikles i SKADE som i dag.
- `ildTur` nulstilles for alle i `_turStart` (world.js:911-959).

**Rundehændelserne**
- **Internetnedbrud:** ingen kan skyde, så farerne kan ikke rammes, og dronen kommer ikke.
- **Brandøvelse (valgfrit):** "alle er ude, og ilden er slukket" (`v.ild.length = 0`, i `brandoevelse`, haendelser.js:259-261).
- `stormSted` (haendelser.js:292-308) og `sikkertSted` (haendelser.js:363-380) afviser steder inden for 40 wu af en ildplet.

## 7. Snapshot, delta, VIDERESEND og net

**`tagSnapshot`** (snapshot.js:19-66)
- `farer: v.farer.map((f) => ({ ...f, ramt: f.ramt && { ...f.ramt } }))`, `ild: v.ild.map((p) => ({ ...p }))` og `farePlan: { ...v.farePlan, varsel: v.farePlan.varsel && { ...v.farePlan.varsel } }`.
- Kundens række (:36-42) får `ildTur`, og projektilernes række (:43-49) får `kaedeId`.
- `lunte`, `kaede` og `fald` på placerede ting og kasser følger med automatisk, fordi objekterne spredes (:50-51).

**`genskab`** (world.js:1214-1274): læser de tre felter med `[]` og `FA.nyPlan()` som fallback. Ældre snapshots virker stadig.

**`aftryk`** (world.js:1279-1294): `for (const f of this.farer) { bland(f.id); bland(f.x); bland(f.y); } bland(this.ild.length);`

**`tagDelta`** (snapshot.js:73-108), samme mønster som `ks` og `pl` (:91-94):

```js
const fa = v.farer.map((f) => [f.id, f.slags, Math.round(f.x * 8) / 8, Math.round(f.y * 8) / 8,
  TILST[f.tilst], f.ret, f.braender | 0, f.spam | 0, f.pakke ? 1 : 0, f.hud === 'nullermand' ? 1 : 0]);
const il = v.ild.map((p) => [p.id, p.x | 0, p.y | 0, Math.max(0, p.liv - p.alder) >> 4]);
// ks får 6. kolonne k.fald ? 1 : 0 (ingen faldskærm på pakken)
// h.fv = varsel ? [slags, x, y, ret, rest] : undefined  (kantpilen virker også for gæster, der missede hændelsen)
```

Hele listerne sendes hver gang, så udtyndingen til hver 3. `st` over nettet (main.js:925) aldrig taber en ændring. Størrelsen er højst 1 + 40 rækker, ~0,6 kB.

**`anvendDelta`** (snapshot.js:111-171): `farer` genopbygges fra en map over de gamle med `maalX` og `maalY`, som projektilerne (:135-142). `ild` genopbygges som kasserne (:143-150).

**Klienten** (net/client.js): `verden.farer` kommer med i historikken (:33), nulstillingen ved et snapshot (:143) og `placer` (:182-183). Uden interpolation ville en Kabelsalat på 150 wu/s hoppe 7,5 wu pr. delta. Pletterne står stille og interpoleres ikke.

**VIDERESEND** (worker.js:18-31) får 8 navne: `'fareVarsel', 'fareKommer', 'fareAntaendt', 'fareLeveret', 'fareSpiste', 'fareOpdateres', 'fareVaek', 'ildTaendt'`.
- `ildTaendt` meldes kun, når en ny brand starter (ingen plet inden for 80 wu), ikke for hver plet.
- `eksplosion`, `skade`, `kasseFalder`, `ammoAendret` og `printerSprang` er der allerede.
- Serveren skal ikke ændres. `haendelse` og `st` er allerede beskeder, kun værten må sende (protokol.py:45).

**Gæster, sene deltagere og afspilning**
- Kun værtens Worker simulerer.
- Sene deltagere får alt gennem `snap_bed` (worker.js:100-101).
- Afspilning er eksakt, fordi al tilstand ligger i snapshottet, og alle træk sker på faste tick.
- `ui/` og `render/` importerer kun konstanter og `FARE_INFO` fra `sim/farer.js`, ligesom `ui/haendelser.js` importerer `HAENDELSE_INFO` (ui/haendelser.js:16).

**Import-cykler:** `farer.js` importerer entities, physics, terrain, weapons, damage (`givSkade`) og turn (`T`). `damage.js` sætter kun `f.ramt` og importerer ikke `farer.js`. `behaviours.js` importerer `foersteFare` fra `farer.js`. Der er ingen cyklus.

## 8. Brugerflade og lyd

**Nyt modul `ui/farer.js`,** bygget som `ui/haendelser.js` (ui/haendelser.js:47): `kobFarer({ bus, hud, lyd, visning, S, r, fx })` giver `{ opdater(v) }`.
- Det kobles lige efter `kobHaendelser` (main.js:760), og `opdater` kaldes fra `opdaterVisning` (main.js:1116).
- Det har sit eget DOM-lag, så hverken `hud.js` eller etiketterne, kamera-agenten arbejder på, røres.

**Varsel:** `hud.banner(tekst, 2800, 'advarsel')` (hud.js:470) med tekster i bydeform:
- "KABELSALAT ← · Skyd den, så går den i brand" (i hulen: "NULLERMAND! En støvtot drysser ned fra loftet · meget brændbar")
- "PAKKEDRONE → · Skyd pakken ned, eller scan den, så er den din"
- "ROBOTSTØVSUGEREN ER VÅGNET · Den æder mails, og batteriet tåler ikke skud"

**Kantpil**
- Én pr. fare uden for billedet, med ikon og navn. Den placeres med `r.tilSkaerm` (renderer.js:119) og flyttes med transform.
- Under varslet pulserer den ved indgangen og læser `h.fv` fra spejlet.
- Er faren i billedet, står der i de første 5 s et navneskilt over den ("KABELSALAT · brændbar", "SPAMFILTER: 2 mails").

**Første gang pr. profil og slags:** `fx.pop('SKYD MIG!', …)` over faren, husket i localStorage med try/catch som hjaelp.js:153-155.
- **Ikke** `hjaelp.hint()`: den tømmer tutorialens kø (hjaelp.js:163).
- Tippet må ikke være en blokerende "tryk mellemrum"-boble, for mellemrum lader skuddet (keyboard.js:26). Koordineres med punkt 2.

**Tegneserieord** via `fx.pop` (fx.js:690): KORTSLUTNING!, PSST, LEVERET!, PAKKE NED!, BONK, NOM!, OVEROPHEDET!, INSTALLERER… og "AV, VARMT!" (højst hvert 1,5 s pr. kunde).
- **KÆDE ×n!** ved hver `eksplosion` med `kaede >= 2`. Ordet bliver større og rødere, jo højere n er.
- **SYGT PLAY!** vises én gang pr. `kaedeId`, når kæden på dybde ≥ 1 har skadet mindst 2 forskellige fjender eller dræbt én, og `kildeHold` er sat. Banneret er "SYGT PLAY! ⟨skyttens navn⟩". Det tælles kun i præsentationen ud fra `skade`-hændelsernes `kaedeId`, `kildeHold` og `drab`.

**Ros:** `skade`-lytteren (main.js:775-784) kalder kun `skudRamte` (main.js:1034), når `e.kildeHold` er skyttens hold, eller når hændelsen ikke har noget `kildeHold`. Så praler skytten ikke af naturens ild.

**Pakken:** i `kasseFalder` (main.js:734) giver `e.fald` teksten "Pakken falder!". Den printer, lunten springer, melder `printerSprang` (banner, main.js:801).

**Printerens og pakkens visning:** fx.js:1250-1253 viser `udloes`-frames og `fx.ildSpor` (fx.js:832), når `p.lunte > 0`. fx.js:1233 skjuler faldskærmen, når `k.fald`.

**Lyd.** Alt går gennem den fælles kanal (lyd.js:166-301). **Ingen nye løkker** (se lydreglen: "løbende lyde viger for kanalen").

| Øjeblik | Kald | Kanal | Pladsholder, til filen findes |
|---|---|---|---|
| `fareVarsel` | `afspil('fare_<slags>', { maksSek: 1.5 })` | `vigtig` (i kø, overlapper aldrig) | `papir_kast` / `kasse_falder` / `opdatering_faerdig` |
| Kabelsalat antændt | `afspil('kortslutning')` | normal: falder bort, hvis braget, der tændte den, stadig spiller | `inferno_delt` |
| Støvsuger overophedet | `afspil('stoevsuger_alarm')` | normal | `mine_bip` (tone 1,4) |
| `fareLeveret` | `afspil('vaaben_samlet')` | `vigtig` | findes |
| `fareSpiste` | `afspil('nom')` | normal | `skum` |
| `fareOpdateres` | `afspil('opdatering_ramt')` | normal | findes |
| Slukket eller druknet | `afspil('plask')` | normal | findes |
| Brag (flammebrag, batteri, styrt, printer) | den eksisterende `eksplosion`-lytter (main.js:572-586) | `forrang`, én lyd pr. brag | findes |
| Ildskade | **ingen** lyd i lytteren (`taelSkade` spiller `skade`, når tallet vises, main.js:1096). `replik(b, 'av')` (main.js:1003) har sin egen regel om hver anden gang eller efter 20 s | – | – |
| SYGT PLAY | `lyd.har(SPEAKER.sygt_play) ? stemme(…, { vigtig }) : afspil('intro_slam', { vigtig })` | `vigtig` | `intro_slam` |

En ny, lille eksport `lyd.har(navn)` i lyd.js er nødvendig, fordi `afspil` og `stemme` giver `false` både for "mangler" og for "optaget" (lyd.js:282 og :313-320).

## 9. Kamera

- **SPILLER_AKTIV og TUR_START: aldrig.** Kun kantpil, banner og lyd. H (overblik) findes allerede.
- **OPLOESNING, når intet projektil flyver** (`S.skudId == null`, main.js:1048-1067): ved `fareAntaendt` og ved `eksplosion` med `kaede >= 1` kaldes `visning.kamera.rammeInd(x, y, 1.2)` (camera.js:365-368). Kaldet rammer kunden og punktet ind, og det gør intet, hvis punktet allerede ses. Højst én gang pr. 2 s.
- **Brag:** som alle andre, gennem `kamera.eksplosion` (camera.js:380-396) fra den eksisterende lytter. Rystelsen følger afstanden.
- **Aldrig** `foelg`, `fokus`, `etabler`, `kortFokus` eller `foelgSkud`. Farerne ligger aldrig i `v.projektiler`, så `foelgSkud` rører dem ikke.
- `ui/farer.js` føjes til listen i API-testen (test/kamera_determinisme.mjs:144).
- Kamera-agenten ændrer camera.js lige nu. Afhængigheden er kun `rammeInd` og `eksplosion`.

## 10. Kunstbrief til art directoren

**Format** (som de eksisterende genstande, objekt_view.js:3-31)
- Kildebilleder i `Assets/Cartoon Characters/Kundekrigen objekter/<navn>/`: 20 frames à 256×256 i fordelingen `idle_0-3, aktiv_0-3, fald_0-1, land_0-2, udloes_0-2, doed_0-3`.
- `vaerktoej/tegneserieobjekter.py` pakker dem til `static/grafik/objekter/<navn>.webp` med celler à 128 og genererer `render/objekt_rig.js`.
- Stilen er som printeren og phishing-minen: tyk mørk kontur og varm skygge.
- Koden roterer de rullende modeller efter den tilbagelagte afstand. **Bag ingen rotation ind, og hold silhuetten rund.**

| Model | Bredde i spillet | idle | aktiv | fald | land | udloes | doed |
|---|---|---|---|---|---|---|---|
| `kabelsalat` | ~30 wu, rund | kabelender og stik vipper; papirstrimler blafrer | **brænder**: flammer ud mellem kablerne, gnister fra stikkene | løs og strittende | squash | KORTSLUTNING: blå-hvidt glimt | sort trådskelet smuldrer til aske |
| `nullermand` | ~32 wu, rund | grå totte med clips, post-it og SIM-kort | brænder (grå røg, gule flammer) | fnug | squash | støvpuf | aske |
| `pakkedrone` | ~48 wu inkl. kasse | 4 frames rotorsløring med kassen under | ramt: ryger og gnister (mens den styrter) | tumler | styrt | træfglimt | vrag |
| `robotstoevsuger` | ~28 × 10 wu | kører; sidebørsten drejer; grøn LED; navneskilt "RUNE" | **overophedet**: rød LED, glød, røg, batteriet buler | vendt om, hjulene snurrer | hop | NOM (suger) | batteriet springer |
| `ild` | ~22 × 26 wu | lille flammeløkke | blusser op (vises på skadetakten, så man **ser**, hvornår den gør ondt) | – | tændes (puf) | – | gløder og ryger ud |

**Også:**
- **Kantpilens ikoner** som SVG-symboler `#i-kabelsalat`, `#i-drone` og `#i-stoevsuger` i samme streg som `#i-arrow` (static/index.html:20). Art directoren tegner, og koden lægger dem i spritet.
- **Pakken genbruger `vaerktoejskasse`** (fx.js:1043). Der er ingen ny model.
- **Valgfrit:** et halvgennemsigtigt "brændt græs"-mærke.
- **Lyd** fra "Assets/400 Sounds Pack" via `vaerktoej/kontorlyde.py`:
  - `fare_kabelsalat` (raslen, ≤ 1,5 s)
  - `fare_drone` (summen)
  - `fare_stoevsuger` (bip-bop)
  - `kortslutning`
  - `stoevsuger_alarm`
  - `nom`.

  Grupperne føjes til `GRUPPER` og `GRUPPE_VOL` (lyd.js:24-45), først når filerne findes.
- **Speakerreplikken "Sygt play!"** skal optages af brugeren i `Assets/Kundelyde/Announcer/` (`SPEAKER`, stemmer.js:61-66).

**Pladsholder i kode:** en ny `render/fare_view.js` og en ny `render/fare_kunst.js`. Den ligger ikke i kunst.js, for at undgå konflikter.
- Den tegner et atlas på lærred i stil med `lavGenstandAtlas` (kunst.js:666) og `celle` (kunst.js:681):
  - kabelsalat: tre krydsende, skriblede ellipser i grå, sort og gul med et stik
  - nullermand: en grå fnugcirkel
  - drone: en boks med fire rotorellipser og en papkasse
  - støvsuger: en mørk skive med blå kofanger og grøn prik
  - ild: additiv glød plus `fx.ildSpor` (fx.js:832), sparsomt.
- Hvis `hent('obj_<navn>')` (assets.js:70) og riggens model findes, bruges `objektMesh` og `animer` (objekt_view.js:63 og :105) i stedet.
- **Lagene** (renderer.js:46-60): jordfarer i `Z.genstande`, ild i `Z.fx − 1` og dronen i `Z.projektiler − 1`.

## 11. Tuningtabel

| Konstant | Værdi | Note |
|---|---|---|
| **Planlægger** | | |
| `FARE_FRA_RUNDE` | 2 | efter at hver klinik har haft en tur |
| `FARE_FOERSTE_S` · `FARE_PAUSE_S` | [30, 70] · [80, 160] | aktiv tid; pausen tæller kun, mens der er plads |
| `FARE_MAKS` · `FARE_VARSEL` · `FARE_UDSAET` | 1 · 180 tick · 300 tick | udsættelsen er fast og trækker ikke fra rngSim |
| `FARE_AFSTAND` | 250 wu (kabelsalat) · 300 wu (støvsuger) | til alle levende kunder |
| **Kabelsalat** | | |
| `KS_R` · `KS_LIV` | 14 · 3000 tick | 50 s |
| `KS_VIND` · `MAKS` · `MIN` · `TRAEG` | 240 · 150 · 24 wu/s · 0,04 | |
| `KS_TRIN_OP` · `KS_TRIN_NED` | 8 · 10 wu | |
| `KS_TYNGDE` · `KS_FLYD` | 0,55 · 0,5 | |
| `KS_VAEG_HOP` · `KS_PRELL` | vy 260 · −0,3 | |
| `KS_STOED` | vy 300, vx 80, højst 2 ved < 12 wu på 150 tick | |
| `KS_SKUB` · `KS_KLASK` | ×1,6 · vx ±240, vy 160 | |
| `KS_BRAND` · `KS_BRAND_FART` · `KS_DRYP` | 120 tick · ×1,3 · hvert 20. tick | |
| `KS_FLAMMEBRAG` | r 44, skade 22, skub 150, intet krater | plus 5 pletter i ring |
| **Drone** | | |
| `DR_R` · `DR_FART` · `DR_HOEJDE` | 20 · 110 wu/s · 200 wu | 9 prøver fra 0 til 720 wu, hvert 8. tick |
| `DR_OP` · `DR_NED` · loft og gulv | 120 · 40 wu/s · h−60 / vand+200 | |
| `DR_STYRT` | tyngde 480, vx ×0,6; brag r 38, skade 24, skub 180, krater | plus 2 pletter |
| **Støvsuger** | | |
| fart · `RS_KLIPPE` · `RS_KUNDE` | `F.gaa` hvert andet tick (~52 wu/s) · 24 wu · 22 wu | |
| `RS_SPAM` | højst 2; +12 r og +15 skade pr. mine | |
| `RS_OVERHED` · `RS_BATTERI` | 90 tick · r 50, skade 30, skub 220, krater | plus 3 pletter |
| `RS_OPDATERING` · `RS_LIV` · `RS_SKUB` | 300 · 3600 tick · ×0,8 | |
| **Ild** | | |
| `ILD_CELLE` · `ILD_MAKS` | 24 wu · 40 | |
| `ILD_LIV` · `ILD_SPRED_ALDER` · `ILD_GEN` | 240 + 15·(id%4) · 45 · 2 | |
| `ILD_STILLE` | \|vindNu\| < 0,15 giver spredning begge veje | |
| `ILD_VEJR` | regn og slud ×0,5 uden spredning; sne uden spredning | |
| `ILD_R` · `ILD_PLAC_R` · `ILD_FALD_MAKS` | 12 · 20 · 40 wu | |
| `ILD_TAKT` · `ILD_SKADE` · `ILD_LOFT` | 30 tick · 4 · 24 pr. kunde pr. tur | loftet er det første håndtag efter playtest |
| `ILD_LUNTE` | printer 90, mine 30 | |
| **Kæde og brugerflade** | | |
| `KAEDE_MAKS` | 5 | |
| SYGT PLAY | kæde på dybde ≥ 1: ≥ 2 fjender skadet eller 1 dræbt | |
| Kamera | `rammeInd` 1,2 s, højst hvert 2. s, kun i OPLOESNING | |
| Banner · navneskilt | 2800 ms · 5 s | |

## 12. Testplan (`node --test test/farer_*.mjs`)

Hjælperen `test/farer_hjaelp.mjs` bygger en rigtig verden, som test/kamera_determinisme.mjs:64-104 gør. Den har `FA.tving` og en bot, der kun bruger Tonerkanonen og "Sæt på hold".

**Før implementeringen** optages et referencespor med den nuværende kode: `aftryk()` og antallet af træk fra `rngSim` pr. tick i 20 000 tick, gemt i `test/data/farer_fra_spor.json`.

| Fil | Tester |
|---|---|
| `farer_determinisme.mjs` | To verdener med samme frø og input giver samme `aftryk` tick for tick i 20 000 tick (≥ 3 farer og ≥ 1 brand, ellers fejler scenariet). **Med `cfg.farer: []` er sporet identisk med referencesporet.** Der trækkes kun fra `rngSim` på planlægningstick, højst 4 pr. fare. `sim/farer.js` indeholder hverken `Math.random`, `Date`, `performance`, `document` eller `window` (README.md:489-494) |
| `farer_kaede.mjs` | Et patologisk kort med 20 printere og 15 miner på række, 2 kabelsalater og en støvsuger med 2 mails. Én gnist, og testen kører, til `farer`, `ild` og `eksplosionsKoe` er tomme. Det skal slutte inden for 1500 tick. `ild.length ≤ 40` i hvert tick, antændelsernes dybde ≤ 5, og hver placeret ting springer højst én gang. 200 opstillinger laves med `lavRng`, og alle slutter. Regn: ingen spredning og halv levetid. Vand og begravelse slukker. Kraftfelt i ilden: 0 i skade og ingen `skjoldBlok` fra ilden |
| `farer_tur.mjs` | En ubrændt Kabelsalat i evig vind forsinker ikke SKADE ud over `RO_HYSTERESE + 5`. En brændende forsinker højst `KS_BRAND + 10`, en printer i brand højst 90 + 5. I 200 scenarier reagerer vagthunden aldrig. I TUR_START, SKADE og TUR_SLUT er positioner, alder, ildens alder og `farePlan.aktiv` uændrede. Ingen fare før runde 2 og ingen i FILM eller UDSAET. En aktiv kunde, der dør af ild, giver `'kunden døde'`. `ildTur ≤ 24`, og den nulstilles ved turstart. En nedskudt pakke lander uden tvang |
| `farer_snapshot.mjs` | Rundtur midt i en brand, på et tick med tom kø: `tagSnapshot` → JSON → `genskab` → 600 tick med ens `aftryk`. `tagDelta` → `anvendDelta`: samme id'er og slags, positioner inden for 1/8, `fv`. Et gammelt snapshot uden felterne kan indlæses. `aftryk` ændrer sig, når en fare flytter sig 1 wu |
| `farer_loft.mjs` | 10 kampe pr. banetype, 20 000 tick hver: aldrig mere end `FARE_MAKS`. Ingen drone i hulen eller under internetnedbrud. Pausen er aldrig kortere end minimum. Rullemodellen på 4 banetyper × 6 frø: under 10 % sidder fast (målt: 4/60, 4/60, 4/60, 0/60), og den er aldrig inde i terrænet |
| `farer_net.mjs` | Statisk: hvert `navn: '…'` i `sim/farer.js` står i VIDERESEND (worker.js:18-31), og hvert `bus.paa` i `ui/farer.js` svarer til et udsendt navn. `lavKlient` med 20 Hz-deltaer giver en glat `x` for faren |
| `farer_lyd.mjs` | `kobFarer` med en falsk `lyd`: kun `afspil`, `stemme` og `har`, aldrig `loop`, `new Audio` eller `AudioContext`. Varslerne er `vigtig` |

Desuden føjes `ui/farer.js` til kamera-API-listen (test/kamera_determinisme.mjs:144), og tabellen i `test/README.md` opdateres. `kort_*` og `kamera_*` skal køre grønne og uændrede.

## 13. Ændringsliste fil for fil

**Nye filer**

| Fil | Indhold |
|---|---|
| `static/js/sim/farer.js` | Konstanterne, `FARE_INFO`, `FARE_VAEGT`, `nyPlan()` og `skridt(v, h)` med plan, reaktion, bevægelse, kontakter, ild, ildskade og fjernelse. Desuden `taendIld`, `projektilRammer(v, p)` (segment-cirkel fra p − v·DT til p), `foersteFare(v, m, dx, dy, maks)` (trin på 3 wu som `foersteKunde`, behaviours.js:141-155) og `tving` |
| `static/js/render/fare_view.js`, `render/fare_kunst.js` | `lavFareView(scene, fx)` med `opdater(farer, ild, tid)` og `fjern()`. Pladsholderatlas eller kunstatlas, puljet og uden allokering pr. frame |
| `static/js/ui/farer.js` | Bannere, kantpile, navneskilte, ord, KÆDE ×n, SYGT PLAY, lyd og kameraglimt |
| `test/farer_*.mjs`, `test/data/farer_fra_spor.json` | §12 |

**Ændrede filer**

| Fil | Sted (anker) | Ændring |
|---|---|---|
| `sim/world.js` | import (:15-29) | `import * as FA from './farer.js'` |
| | `STANDARD_CFG` (:46-58) | `farer: null` |
| | konstruktør (:92-99) | `this.farer = []; this.ild = []; this.farePlan = FA.nyPlan();` |
| | `skridt`, køen (:606) | `D.eksploder(…, e.carve, null, e.kilde)` |
| | `skridt` (:620-621) | `FA.skridt(this, h)` mellem `_fysik` og `tjekDrukning` |
| | `_fysik`, projektiler (:659-662) | efter printertjekket: `FA.projektilRammer` giver `traef = { slags: 'fare' }` og `f.ramt` |
| | `_fysik`, brag (:679) | `kilde` gives med til `eksploder` |
| | `_fysik`, lunter (:690-695) | køposten får `kilde` og `kaede`; printeren melder `printerSprang` |
| | `_fysik`, kasser (:709) | `\|\| k.fald` |
| | `_turStart` (:935-940) | `b.ildTur = 0` for alle |
| | `genskab` (:1214-1274) · `aftryk` (:1279-1294) | §7 |
| | undgås | `udsaet`, `_udstyr*` og `findStartpladser`: MapGEN-agenten arbejder dér. `farer.js` læser kun `_udstyrsPladser()` |
| `sim/turn.js` | `erIRo` (:112-127) | de 2 linjer i §4.4 |
| | `tvungenRo` (:129-153) | fjern brændende og styrtende farer, nulstil `uro` og `p.lunte` |
| `sim/damage.js` | `eksploder` (:27-79) | ny 9. parameter `kilde`. Køposterne (:64, :73) får `kilde` med dybde + 1. En løkke over `v.farer` sætter `f.ramt` (efter :75). `eksplosion` (:77) bærer `kaede`, `kaedeId` og `kildeHold` |
| | `givSkade` (:85-100) | valgfri `ekstra` flettes ind i `skade` (:94) plus `drab` |
| `sim/behaviours.js` | `delKlynge` (:103-111) | børnene arver `kaedeId` |
| | `hitscan` (:165-169) | `foersteFare` før kunden og terrænet; strålen stopper ved faren |
| | `straale` (:201-205) | støvsugeren sættes på pause |
| | `klask` (:247-266) | farer i klaskets felt får `f.ramt` |
| `sim/entities.js` | `lavBaever` (:53-68) | `ildTur: 0` (filen ændres af andre, så ankeret er funktionen) |
| `sim/snapshot.js` | `tagSnapshot` (:36-51) · `tagDelta` (:91-107) · `anvendDelta` (:143-170) | §7 |
| `sim/worker.js` | `VIDERESEND` (:18-31) | 8 navne |
| `sim/haendelser.js` | `stormSted` (:292-308), `sikkertSted` (:363-380) | afvis steder ved ild |
| | `brandoevelse` (:259-261) | valgfrit: sluk al ild |
| `net/client.js` | :33, :143, :182-183 | `verden.farer` med i interpolationen |
| `main.js` | import (:46) · `byggVisning` (:533, :555, :559) | `lavFareView` i `visning` og i `fjern` |
| | `kasseFalder` (:734) · `kobHaendelser` (:760) | "Pakken falder!" · `kobFarer(…)` |
| | `skade` (:775-784) | ingen lyd for `'ild'`, og `skudRamte` kun for skyttens egen kæde |
| | `opdaterVisning` (efter :1189) | `vi.farer.opdater(v.farer, v.ild, tid)` og `fareUi.opdater(v)`. **`foelgSkud` (:1045) ændres ikke** |
| `render/fx.js` | kasser (:1233) · printer (:1250-1253) | ingen faldskærm ved `k.fald`; printeren ryger, når `p.lunte > 0` |
| `render/assets.js` | `MANIFEST` (:41-43) | `kabelsalat`, `nullermand`, `pakkedrone`, `robotstoevsuger` og `ild`, når kunsten er leveret. En fil, der mangler, er ufarlig (:63) |
| `ui/lyd.js` | `GRUPPER` og `GRUPPE_VOL` (:24-45) · ny `export const har` | §8 |
| `ui/stemmer.js` | `SPEAKER` (:61-66) | `sygt_play` |
| `static/app.css` | nyt | `.fare-pil`, `.fare-skilt`. Koden ejer app.css; art directoren ejer grafik, karaktervalg.css og filmintro.css |
| `static/index.html` | spritet (:20) | ikonerne, når art directoren har tegnet dem |
| `README.md` · `test/README.md` | | afsnittet "Farer i realtid" og testtabellen |

**Ingen ændringer i:** `render/camera.js`, `render/parallax.js`, `render/renderer.js`, `ui/hud.js`, `ui/hjaelp.js`, `terrain_gen.js`, `baneregler.js`, `bane_natur.js`, `static/grafik/`, `karaktervalg.css` og `filmintro.css`.

## 14. Risici og åbne spørgsmål

- **Seje turskift (største risiko).** Det imødegås af, at uro kun er begrænsede nedtællinger (§4.4), at `tvungenRo` er udvidet, og af `farer_tur.mjs`.
- **MapGEN ændrer sig.** Indgangene læser kun `_udstyrsPladser()` og `overflade()` mens spillet kører, og vægtene gælder først efter tjekket af, om faren kan ske. Rullemodellen skal måles igen med `farer_loft.mjs`, når MapGEN er færdig.
- **Balance.** `ILD_LOFT` og `KS_FLAMMEBRAG.skade` er de to håndtag. En god kæde giver ~60 til hver af to fjender, og en printer i kæden meget mere. Det er meningen.
- **Retfærdighed.** Den, der har turen, når faren kommer, får første chance. Det afbødes af varslet, den neutrale indgang, levetiden på 2-3 ture og vinden, der skifter.
- **Kræver brugerens beslutning:**
  1. En lobbyknap "Farer: til/fra". Den kræver en ændring af protokollen (rum.py:101-108 og main.js:470-476). Indtil da er farerne slået til, og `cfg.farer` findes kun i koden.
  2. Optagelsen "Sygt play!" til speakeren.
- **Koordinering med punkt 1 og 2.** Den nye HP-bjælke viser ildskaden som almindelig skade. Tutorial-redesignet må ikke genbruge `hint()` til farerne og omvendt.