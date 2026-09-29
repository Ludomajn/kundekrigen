> **Aftale med art directoren (28/9):** frames er `idle_0-3, aktiv_0-3, fald_0-1, land_0-2, udloes_0-2, doed_0-3` (20 i alt, som `FRAMES` i `vaerktoej/tegneserieobjekter.py`), ikke `doed_0-4`. AD leverer i rækkefølgen kabelsalat + ild, nullermand, robotstoevsuger, pakkedrone, ikon-snippets (sættes ind i index.html af koden), brændt græs, `static/grafik/hud/tbj_ramme.svg` + `tbj_tekstur.png`. AD regenererer `render/objekt_rig.js`; koden skal virke med pladsholdere, indtil filerne findes, og skifte til kunsten af sig selv.

# Skeptikerens gennemgang: farer i realtid

Kun læsning. Jeg har ikke ændret nogen fil i repoet. Mine eksperimenter ligger i `/tmp/claude-503/skeptiker/` (`e1.mjs` til `e5.mjs`).

**Kort fortalt:** Designet holder, hvad angår vagthunden, VIDERESEND, snapshottet, protokollen og kameraets API. Jeg fandt **6 alvorlige defekter** (D1-D6) og **15 mindre** (D7-D21). Alle er rettet i det fulde design i afsnit C og mærket **(rettet)**.

## A. Defekter og rettelser (mest alvorlige først)

**D1. Én fælles uro-tæller: en landing sletter brandens uro.**
- **Problem:** §4.4 har én tæller, `f.uro`, med to kilder: branden (130) og skubbet (180, "nulstilles ved landingen"). Tag en brændende Kabelsalat, som et nyt brag kaster op i luften. Når den lander, bliver uro 0, selv om branden stadig brænder.
- **Følge:** `erIRo` (turn.js:112-127) svarer ja, og turen går til SKADE. Farerne står stille (§6), så flammebraget går af i den næste spillers SPILLER_AKTIV. Det samme sker for en overophedet støvsuger.
- **Rettelse:** Tre adskilte ure: `brand`, `luft` og `styrt`. `f.uro` udledes som maksimum af dem. En landing nulstiller kun `luft`.

**D2. Ild antænder printere og miner i den næste spillers tur.**
- **Problem:** Ild er ikke uro. Spredningen sker ved alder 45 og 90. Ro indtræder allerede efter 12 tick (`RO_HYSTERESE`, turn.js:32). Derefter står ilden stille gennem SKADE, TUR_SLUT og TUR_START (150 tick, turn.js:31) og fortsætter i den næste SPILLER_AKTIV.
- **Følge:** Ilden når en printer, som får `lunte = 90`. Printeren springer med r 96 og skade 62 (world.js:223) ca. 1,5 s inde i en tur, hvor spilleren først lige har kunnet flytte sig.
- **Rettelse:** Et flag `truer` på pletter, der stadig kan sprede sig hen til en utændt printer eller mine. `truer` tæller som uro, højst 91 tick. `tvungenRo` slukker spredningen. Desuden får den aktive kunde en kort pause fra ildskade ved turstart.

**D3. Planlæggeren kan trække fra rngSim i det uendelige.**
- **Problem:** §5 trækker slags, før den ser efter et sted, og udsætter så 300 tick. På øer med 2×4 kunder fandt jeg **0 gyldige pladser** ved kampstart (`94:0:0`, e3.mjs), og med 4×3 højst 0-17.
- **Følge:** Planlæggeren trækker hvert 5. s. Løftet om "højst 4 træk pr. fare" brydes, og testen fejler. Fortets støvsuger har en fast borg og et fast pladsnummer. Er den plads ugyldig, udsættes der for evigt.
- **Rettelse:** En deterministisk prøvekørsel (`FA.steder`) uden træk. Ved udsættelse trækkes intet. På fortet vælges der blandt de gyldige pladser, borg for borg.

**D4. Referencesporet kan aldrig bestå.**
- **Problem 1:** `aftryk` får `bland(this.ild.length)`. FNV ganger også ved 0-bytes (world.js:1281-1287), så hashen ændrer sig, selv med `cfg.farer: []`. Det er verificeret i e4.mjs (`47b6a5eb` mod `aa59d99b`).
- **Problem 2:** Et spor optaget "før implementeringen" bliver ugyldigt af MapGEN-agentens ændringer. terrain_gen.js blev ændret kl. 20:51 og er stadig under arbejde.
- **Rettelse:** Bland kun farer og ild ind, når listerne ikke er tomme. Optag sporet på det træ, implementeringen bygger på, med et genereringsscript.

**D5. Indgangsfaldet er ikke uro.**
- **Problem:** En Kabelsalat, der kommer ind sent i OPLOESNING, falder i ~74 tick, men turen går i ro 12 tick efter sidste bevægelse. Den står så stille i luften gennem SKADE (45-100 tick, world.js:33), TUR_SLUT og TUR_START, altså ~4 s.
- **Rettelse:** Et fald i luften (ved indgangen og efter et skub) er `luft`-uro, højst 180. Hop mod vægge og vindstødshop er aldrig uro. Levetiden står stille, mens faren brænder eller styrter.

**D6. Terræn, der bygges, begraver farerne.**
- **Problem:** Papirbunken (world.js:671-674), Kabelbakken (behaviours.js:342-345) og Byggeskummet (behaviours.js:353-356) frigør kun kunder.
- **Følge:** En begravet Kabelsalat eller støvsuger sidder fast inde i terrænet i op til 50-60 s, og ingen projektiler kan ramme den.
- **Rettelse:** `FA.frigoer` hvert aktive tick efter mønsteret fra `F.frigoer` (physics.js:84-86).

**D7. Pakken falder gennem tynde lag.**
- **Problem:** `skridtFaldende` tjekker kun `ny` og `ny−3`, uden sweep (physics.js:293). På fortet faldt pakken gennem øverste lag i 4 af 1760 fald (lag på 1-2 wu, faldt 320 wu, e2/e5).
- **Rettelse:** En fejet `FA.skridtPakke` med trin på 1 wu.

**D8. Varslet kan fryse på spejlet.**
- **Problem:** `anvendDelta` bruger mønstret `if (d.h.ft !== undefined)` (snapshot.js:164) og `if (d.ks)` (:143). Kopieres det til `fv`, `fa` og `il`, forsvinder kantpilen og den sidste fare aldrig på spejlet.
- **Rettelse:** Tildel altid. Send altid listerne, også når de er tomme.

**D9. Et `vigtig` varsel kan komme for sent.**
- **Problem:** Den vigtige kø har 3 pladser og ingen udløbstid (lyd.js:289-291). Kun brag kan udløbe (:292-296).
- **Følge:** Varslet kan spille efter, at faren er kommet, og det optager en af pladserne, som døden og nedtællingen bruger.
- **Rettelse:** Normal kanal. Banneret og kantpilen bærer informationen.

**D10. 40 wu fra ild er for lidt.**
- **Problem:** Ilden spreder sig 2 × 24 wu, og antændelsesradius er 20 wu. En ny mine eller en flyttet kunde lander dermed i ilden.
- **Rettelse:** Brandøvelsen slukker al ild, **før** den flytter kunderne, så `sikkertSted` er uændret. Shitstormen (og telefonens spam) holder 76 wu fra ild.

**D11. Gæster rammer bevægelige farer dårligere.**
- **Problem:** Spejlet tegner mindst `max(1,5; interval·1,6)` tick bagud (client.js:169), ~80 ms ved 20 Hz. Oveni kommer inputvejen via værten (main.js:372). Dronen flytter sig 15-25 wu imens, og dens r er 20.
- **Hvorfor nyt:** Kunder står altid stille, når de er mål.
- **Rettelse:** Hitscan mod farer får en tolerance på +12 wu. Kun værten simulerer, så det er deterministisk.

**D12. Selvtræf gennem en rullende Kabelsalat.**
- **Problem:** Kabelsalaten ruller gennem kunder, og pausen for skytten gælder kun kunder (physics.js:235).
- **Følge:** Skyder man, mens den overlapper skytten, sprænger skuddet ved mundingen.
- **Rettelse:** De første 8 tick rammer et skud ikke en fare, der ligger over skytten. Det regnes i `projektilRammer`.

**D13. SYGT PLAY kan ikke navngive skytten eller tælle drukninger.**
- **Problem:** Kun `kildeHold` føres med. Drukning giver `drukner` og ingen `skade` (damage.js:107-117), og `faldtUd` (world.js:650) står ikke i VIDERESEND.
- **Rettelse:** Før `kildeBaever` med. Brugerfladen tæller et drab, når kunden dør i samme tur efter kædeskade.

**D14. Kæden stopper ved liget.**
- **Problem:** `afvikleDoedsfald` lægger ligets brag i køen uden `kilde` (damage.js:165).
- **Rettelse (valgfri):** Gem `b.draebtAf` i `givSkade`.

**D15. Støvsugeren æder spillerens egne miner.**
- **Problem:** Spillerens miner har `sprite: 'mine'` og en `ejer` (behaviours.js:272-276, weapons.js:94).
- **Rettelse:** Kun miner med `ejer == null`: banens miner (world.js:211-213), shitstormens (haendelser.js:185-189) og spammens (world.js:1102-1106).

**D16. Navnekollision på `maalY`.**
- **Problem:** Klienten bruger `maalX` og `maalY` til interpolation (snapshot.js:116 og :138, client.js:34-38 og :47). Dronens felt `maalY` i simulationen følger med `genskab` over i spejlet.
- **Rettelse:** Omdøb feltet til `hoejdeMaal`.

**D17. Kameraspark under sigtet.**
- **Problem:** Brag med r ≥ 70 giver kameraet et spark (camera.js:383-395; `STOR_RADIUS`, camera.js:111). En printer, som ilden sætter af under SPILLER_AKTIV, skubber derfor sigtebilledet væk.
- **Rettelse:** I SPILLER_AKTIV får brag med `kaede ≥ 1` kun `rystelse` (camera.js:372-376).

**D18. Huller i specifikationen.**
- Rulleretningen i vindstille midt i livet er ikke fastlagt. Rettelse: hysterese.
- Levetiden kan udløbe midt i en brand. Rettelse: levetiden står stille.

**D19. fysik_granat.mjs er glemt.**
- **Problem:** Testen kører 10-minutters kampe med standard-cfg (test/fysik_granat.mjs:156-190), så de får farer.
- **Rettelse:** Den skal også være grøn og uændret, ikke kun `kort_*` og `kamera_*`.

**D20. "Afspilning er eksakt, fordi al tilstand ligger i snapshottet" er forkert.**
- **Problem:** `eksplosionsKoe`, `forsinkede` (lukninger, behaviours.js:239-240) og `doedskoe` er ikke med i snapshottet (snapshot.js:19-66), og `genskab` tømmer dem (world.js:1270-1273).
- **Rettelse:** Ret teksten. Det har ingen betydning for spillet, for værten genskaber aldrig.

**D21. For mange replikker fra ildskade.**
- **Problem:** `skade`-lytteren kalder `replik(…'av')` ved hver takt (main.js:783).
- **Rettelse:** Ved ild kun ved kundens første ildskade i turen.

## B. Holdt under angreb

- **Uro er begrænset.** Med D1, D2 og D5 er den længste forlængelse af OPLOESNING ca. brand 130 + spredning 91 + lunte 90 + kø + ro. Det er under vagthunden på 720 tick (turn.js:33). Genindtræden fra SKADE (world.js:840-849) kræver stadig et dødsfald eller et brag.
- **Placerede tings lunte** tæller ned i alle tilstande (world.js:690-695). `erIRo` venter på den, så SKADE nås ikke med en tændt lunte.
- **Omkostning:** `_udstyrsPladser()` tager 1,46-1,75 ms pr. kald (e1.mjs; fortet ~0). Det er kun på planlægningstick, altså billigt.
- **Resten holder:** VIDERESEND (worker.js:18-31), `KUN_VAERT` og `HOT` (protokol.py:45-49), `snap_bed` (worker.js:100-101), kameraets `rammeInd` (camera.js:365-368, prioritet :504) og at farerne ikke ligger i `projektiler`, så `foelgSkud` rører dem ikke.
- **Sigtelinjen** ignorerer også kunder i dag (fx.js:1396-1406). At den ikke ser farerne, er derfor ingen ny løgn.
- **Pausen (Esc)** er ren brugerflade (main.js:1542-1544). Tururet løber allerede under den, så farerne gør intet nyt værre.

## C. Det rettede design

# Endeligt design (rettet af skeptikeren)

> Kun design. Ingen filer i repoet er ændret.
>
> `world.js`, `main.js`, `hud.js`, `camera.js` og `terrain_gen.js` ændres lige nu af andre agenter. **Funktionsnavnet ved hver henvisning er ankeret, linjetallet er et øjebliksbillede.**
>
> Dommerens pointtabel og verifikation står uændret. Alt mærket **(rettet)** er skeptikerens ændringer.

## 0. Kort fortalt

- **Et nyt hovedløst modul, `sim/farer.js`, og tre nye felter på verden:** `v.farer`, `v.ild` og `v.farePlan`. Alt er ren data i snapshottet.
- **Tre farer.**
  - Flagskibet er **Kabelsalaten**. I hulen hedder den **Nullermanden**; det er samme entitet med andet udseende.
  - **Pakkedronen** og **Robotstøvsugeren** kommer i bølge 2.
  - Dertil kommer den nye mekanik **ild**.
- **Ren RNG i hvornår, hvad og hvor.** Opførslen er deterministisk og til at læse: vindpilen styrer Kabelsalaten.
- **Farerne kører i aktiv tid:** SPILLER_AKTIV, AFFYRING og OPLOESNING. I FILM, UDSAET, TUR_START, SKADE, TUR_SLUT og SEJR står de stille; render lader dem svaje og flakke.
- **De er aldrig projektiler og ligger aldrig i `forsinkede`.**
- **(rettet) Uro består af tre adskilte ure pr. fare:** `brand` (≤ 120), `luft` (≤ 180) og `styrt` (≤ 240). De samles i `f.uro`. Dertil kommer `lunte` på placerede ting (≤ 90) og `truer` på ild, der stadig kan sprede sig hen til en utændt printer eller mine (≤ 91 tick).
  - Alle brag, alle brande og alt, ilden kan nå at antænde, afvikles dermed i skyttens egen tur.
  - Kun ild, der intet kan antænde, brænder videre ind i næste tur.
- **Opvarmning genbruger den eksisterende `lunte` på placerede ting** (world.js:690-695). Den er allerede med i deltaet (snapshot.js:93).

## 1. Fire regler

1. **Ankomsten er ren RNG, udfaldet kræver dygtighed.** `rngSim` bruges kun i planlæggeren: pause, slags, sted, side i vindstille og dronens last. **(rettet)** Der trækkes kun, når en fare faktisk varsles. En udsættelse trækker intet.
2. **Ingen fare skader af sig selv.** Al skade starter med et skud, et brag eller ild. En brand kan kun startes af et skud eller et brag, eller af en fare, som et skud eller et brag har antændt.
3. **Farer er baggrund, kun konsekvenserne tæller.** Konsekvenserne er brag i den almindelige kø (world.js:603-607), kunder i skub og en pakke, der falder. Alle er endelige og korte.
4. **Alt er begrænset:**
   - højst 1 fare ad gangen
   - højst 40 ildpletter
   - hver ting antændes og springer højst én gang
   - ild spreder sig i højst 2 generationer
   - dybden for antændelser er højst 5
   - **(rettet)** højst 4 træk fra `rngSim` pr. fare og 0 pr. udsættelse.

## 2. Rosteret

| # | Fare | Tema | Bølge | Baner (vægt) |
|---|---|---|---|---|
| 1 | **Kabelsalaten** / **Nullermanden** (hule) | En rullende bylt af strøm-, netværks- og opladerkabler med strimler af makuleret "FORTROLIGT". I hulen en kæmpe støvtot med en clips, en post-it og et SIM-kort | 1 (MVP) | åben 5 · øer 5 · hule 4 · fort 1 |
| 2 | **Pakkedronen** | Leveringsdronen fra webshoppen med en papkasse med "SKRØBELIG"-tape. Skyd den ned, og pakken falder. **Scan** den, og pakken er din: "LEVERET!" | 2 | åben 3 · øer 4 · hule 0 · fort 5 |
| 3 | **Robotstøvsugeren** | Klinikkens robotstøvsuger. Den suger phishing-mails op ("spamfilter"), og batteriet er ikke CE-mærket | 2 | åben 2 · øer 1 · hule 4 · fort 3 |

**Skåret, og hvorfor:**
- **Firmaballonen** overlapper dronen og ville svæve uden for billedet (camera.js:7-8).
- **Tordenskyen** bryder regel 2.
- **Tonertønden** kopierer printeren (world.js:224).
- **Lattergassen** er et svagt tema for en lægeklinik.
- **Skyløsningen** overlapper dronen.
- **`varme`-systemet** er erstattet af `lunte`.
- **Ladestationen, fareløkker, brændende våbenkasser og brag-budgettet pr. tur** er ikke komplekset værd (§4.3).

### 2.1 Kabelsalaten (flagskib)

**Indgang: den blæser ind ovenfra**
- Pladsen trækkes (1 træk) blandt de gyldige steder fra `FA.steder` (§5) **(rettet)**. De er taget fra `_udstyrsPladser()` (world.js:352) med to krav:
  - mindst 250 wu fra alle levende kunder
  - åben himmel, `terraen.overflade(p.x) <= p.y + 2`. Kravet gælder ikke i hulen.
- Kabelsalaten starter 200 wu over pladsen med `vx = ret·60`. Under et loft starter den 34 wu under loftet, samme søgning som `_slipVaabenkasse` (world.js:1066).
- **(rettet)** Indgangsfaldet sætter `luft = 180` (§4.4). OPLOESNING venter på landingen, så ingen Kabelsalat står frosset i luften mellem turene.
- **Retningen** er fortegnet på `vindNu()`. Ved |vindNu| < 0,05 ved indgangen trækkes den fra `rngSim`.
- **(rettet)** Senere i livet skifter retningen kun ved |vindNu| ≥ 0,05. Ellers holdes den gamle. Vindstødene skifter aldrig fortegn inden for en tur (physics.js:44-50), så kursen skifter kun ved `rulVind` og `_uvejr`.

**Bevægelse.** En cirkel med r 14 og fodpunktet nederst.

| Tilstand | Opførsel |
|---|---|
| **På jorden** | Målfart `klem(240·vindNu, ±150)`, aldrig under 24 wu/s i rulleretningen, med inerti 0,04 pr. tick. Trin som i `physics.gaa`: øverste frie trin fra +8 til −10 wu, og derfra ned til jorden. Ingen fri position giver en væg: prel (−0,3·vx) og hop med vy 260. **(rettet)** Væghop er ikke uro |
| **I luften** | Tyngde 0,55 · `TYNGDE`, og farten glider mod vinden med halv inerti |
| **I vandet** | Flyder i vandlinjen med halv fart og kravler selv i land på en kyst, der ligger højst 8 wu over vandet. Vandet nulstiller `luft` |
| **Sidder fast** | Under 12 wu fremdrift på 150 tick giver et vindstødshop (vy 300, vx ret·80), højst 2 gange. Derefter ligger den stille som et mål. **(rettet)** Stødhop er ikke uro |
| **Begravet (rettet)** | Hvert aktive tick løfter `FA.frigoer` faren 2 wu ad gangen, højst 40 gange, til cirklen er fri. Det er mønstret fra `F.frigoer` (physics.js:84-86). Det dækker Papirbunken (world.js:671-674), Kabelbakken (behaviours.js:342-345) og Byggeskummet (behaviours.js:353-356) uden at røre de tre steder |
| **Levetid** | 50 s aktiv tid, eller til den er ude over kanten (`fareVaek` `'kant'` eller `'traet'`). **(rettet)** Levetiden står stille, mens `brand > 0` |

Vinden rulles ved hver turstart (turn.js:182-192, kaldt fra world.js:942). **Vindpilen, man allerede læser for at sigte, fortæller, hvor Kabelsalaten ruller hen.**

**Antændes af:**
- en eksplosion inden for radius + r
- et projektil, der rører den (segment-cirkel). Projektilet sprænger **på** den.
  - **(rettet)** De første 8 tick af et skud gælder det ikke for en fare, der ligger inden for `f.r + BAEVER_R + 4` af skyttens position. Det er samme idé som skyttens egen pause (physics.js:235), så man ikke sprænger sig selv, fordi Kabelsalaten ruller gennem ens kunde.
- Stregkodescannerens stråle. **(rettet)** Den rammer inden for `f.r + FARE_STRAALE_TOL`.
- en ildplet inden for 13 wu af fodpunktet.

**Skub:** 1,6 gange en kundes skub fra eksplosioner. Skubbet sætter `luft = 180`. Klageklasket slår den væk (vx ±240, vy 160, `luft = 180`) og antænder ikke.

**Brændende** ("KORTSLUTNING!", `brand = 120`):
- Den ruller 1,3 gange hurtigere og lægger en ildplet (gen 1) hvert 20. tick, mens den er på jorden.
- Når `brand` når 0, kommer **flammebraget** gennem eksplosionskøen: r 44, skade 22, skub 150, **uden krater**, plus en ring på 5 pletter (gen 0, x −48…+48).
- **Rammer den vandet, mens den brænder, er den slukket** ("PSST", `fareVaek` `'slukket'`, intet brag).
- **(rettet)** Et nyt brag, mens den brænder, giver skub og `luft`, men branden fortsætter. `uro` følger det længste af de to ure (§4.4).

**Sygt play**
- En Tonerkanon antænder Kabelsalaten mellem to fjender. Hver får braget, flammebraget og ilden, og skubbet kan sende dem i havet.
- Eller: en brændende Kabelsalat ruller hen til en printer. Ilden sætter lunten (90 tick), og printeren springer med r 96 og skade 62 (world.js:223).

### 2.2 Pakkedronen (bølge 2)

**Kan kun komme, når alle tre gælder:**
- banen er ikke hulen
- `!v.internetNede()` (world.js:413)
- `v._ledigeKassepladser() > 0` (world.js:1041).

En drone, der allerede flyver, når et internetnedbrud begynder, flyver videre. Ingen kan skyde den.

**Indgang og last:** fra vindsidens kant (x −60 eller w+60), eller fra en side trukket fra `rngSim` i vindstille. Lasten trækkes med `tilfaeldigtKassevaaben(v.rngSim)` (weapons.js:217).

**Flyvning:**
- 110 wu/s.
- **(rettet)** Hvert 8. aktive tick sættes `hoejdeMaal` (ikke `maalY`, som klientens interpolation bruger, snapshot.js:116 og :138, client.js:34-38). Værdien er max af `overflade()` i 9 prøver fra 0 til 720 wu frem, plus 200. Loftet er h − 60, gulvet vand + 200.
- Den stiger højst 120 wu/s og synker højst 40 wu/s. "BONK" ved terrænet.
- Ude ved x < −80 eller > w+80 forsvinder den (`fareVaek` `'kant'`).

**Scannerens stråle: LEVERET!**
- **(rettet)** Strålen rammer dronen inden for `DR_R + FARE_STRAALE_TOL` (20 + 12). Gæster ser dronen ~80 ms for sent (client.js:169), og uden tolerancen ville de misse halvdelen af de centrale træf.
- Skyttens klinik får `kasseAntal(indhold)` af lasten (weapons.js:228), efter mønstret fra `_samlKasse` (world.js:745-750). Der meldes `ammoAendret` og `fareLeveret`.
- Dronen flyver videre uden pakke.

**Projektil eller eksplosion: nedskudt** (`styrt = 240`):
- Pakken bliver en våbenkasse (`lavKasse`, entities.js:109) med `fald: true`, hvis der stadig er plads. Ellers konfetti.
- **(rettet)** Pakken falder med den nye `FA.skridtPakke(t, k)`: tyngde som `skridtFaldende`, men fejet i trin på 1 wu. `skridtFaldende` tjekker kun `ny` og `ny−3` (physics.js:293), og på fortet faldt 4 af 1760 prøvefald gennem et lag på 1-2 wu. Kaldet sker i grenen for telefon og piller (world.js:709): `if (k.fald) FA.skridtPakke(t, k); else F.skridtFaldende(t, k);`.
- Dronen falder ballistisk (tyngde 480, vx × 0,6). Ved nedslaget kommer et brag i køen (r 38, skade 24, skub 180, krater) og 2 ildpletter. I vandet plasker den.

### 2.3 Robotstøvsugeren (bølge 2)

**Indgang:** den vågner på en udstyrsplads mindst 300 wu fra alle levende kunder (gyldige steder fra `FA.steder`, §5).
- **Naturbaner:** blandt de 3 mest neutrale pladser trækker `rngSim` én.
- **(rettet) Fortet:** borgen er `farePlan.antal % antal borge`. `rngSim` trækker blandt dens gyldige pladser i udstyrsrækkefølge. Har borgen ingen, prøves de næste borge i rækkefølge. Har ingen borg en gyldig plads, kan støvsugeren ikke komme.

**Kørsel**
- `F.gaa` (physics.js:96-118) hvert andet aktive tick, ~52 wu/s, med kundens kapsel.
- Den vender:
  - ved en væg
  - ved et fald på over 24 wu foran sig
  - ved en kunde inden for 22 wu.
- Løftes den af et skub (`luft = 180`), falder den med `F.skridtBaever` (physics.js:131). Faldskaden ignoreres.
- I vandet kortslutter den (intet brag). Begravet: `FA.frigoer`.

**Spamfilter:**
- **(rettet)** Den æder kun miner med `ejer == null`: banens miner (world.js:211-213), shitstormens (haendelser.js:185-189) og spammens (world.js:1102-1106). Spillerens egne miner (behaviours.js:272-276) røres ikke.
- En mine, den kører ind i (|dx| < 18, |dy| < 16), sættes til `doed` uden brag. Den æder højst 2 (`fareSpiste`).

**Antændes** som Kabelsalaten, så er den **overophedet** (`brand = 90`, rød LED). Derefter springer batteriet: r 50 + 12 og skade 30 + 15 pr. spist mine, skub 220, krater og 3 ildpletter. Eksplosioner skubber den 0,8 gange en kundes skub.

**Tvangsopdateringen** (`straale`, behaviours.js:198-224): pause i 300 tick. Pausen er ikke uro.

**Levetid:** 60 s aktiv tid (står stille, mens `brand > 0`), derefter `'traet'`.

## 3. Ild (ny simulationsmekanik)

```js
// v.ild — ren data
{ id, x, y, alder, liv, gen, jord, kaede, kaedeId, kildeHold, kildeBaever, truer }   // (rettet) kildeBaever, truer
```

**Placering** med `taendIld(v, x, yRef, gen, kilde)`:
- x snappes til et gitter på 24 wu.
- `g = terraen.jordUnder(x, yRef + 30)` (terrain.js:157-162). **Brug aldrig `overflade()`**, for i hulen giver den loftet (terrain.js:165-168).
- Pletten afvises, hvis:
  - der ikke er jord inden for 60 wu, eller `g + 1 < vandNiveau + 2`
  - `fast(x, g + 4)`, altså at den er begravet
  - der allerede ligger en plet i samme celle inden for 24 wu i højden
  - `ild.length >= ILD_MAKS`.
- `jord = terraen.hent(x, g) === JORD` (terrain.js:20). Kun JORD spreder. MUR (terrain.js:25) og FJELD brænder, men giver ikke ilden videre.
- Id kommer fra `v.nytId()`, og levetiden er `ILD_LIV + 15·(id % 4)`.

**Hvert aktive tick**
- `alder++`.
- **Spredning, uden tilfældighed.** Ved `alder === ILD_SPRED_ALDER`, `gen < 2`, `jord` og tilladt vejr tænder pletten én celle i vindens retning. Ved |vindNu| < 0,15 tænder den begge veje. Nye pletter går i en kø, der føjes til efter løkken. Ingen Map- eller Set-iteration (entities.js:3-5).
- **Vejret:** regn og slud giver halv levetid og ingen spredning. Sne giver ingen spredning.
- **(rettet) `truer`** sættes sidst i ildtrinnet:
  ```js
  p.truer = p.gen < ILD_GEN && p.jord && spredningTilladt(v) && p.alder < ILD_SPRED_ALDER &&
    v.placerede.some((q) => !q.doed && q.lunte === 0 && (q.sprite === 'toende' || q.sprite === 'mine') &&
      Math.abs(q.x - p.x) <= ILD_PLAC_R + (ILD_GEN - p.gen) * ILD_CELLE && Math.abs(q.y - p.y) <= 40);
  ```
  En gen 0-plet truer højst 45 tick, dens barn højst 45 til. `erIRo` venter på det (§4.4), så al ild, der kan nå en printer eller mine, gør det i skyttens tur.
- **Hvert 10. tick:**
  - Er jorden væk, falder pletten til `jordUnder`. Er faldet over 40 wu, slukkes den.
  - Under `vandNiveau + 2` er den slukket.
  - `fast(x, y + 3)` betyder kvalt.
- `alder >= liv` slukker den.

**Skade** (hvert `ILD_TAKT`, i global fase `v.tick % 30 === 0`)
- Træfzonen skal være inden for `ILD_R` af (plet.x, plet.y + 6) eller inden for f.r + 4 af en brændende fare.
- Kunden får `min(ILD_SKADE, ILD_LOFT − b.ildTur)` gennem `givSkade(…, 'ild', h, kilde)` (damage.js:85). Det er højst én gang pr. takt. `kilde` er den første rørende plet i id-orden.
- **(rettet) Startpause:** den aktive kunde tager ingen ildskade, mens `tur.tilstand === SPILLER_AKTIV && tur.tilstandTick < ILD_TAKT`. Kunden har stået frosset gennem TUR_START (150 tick) og skal kunne nå at gå ud af ilden.
- **Kraftfelt:** ingen skade og ingen `skjoldBlok`. Tjek `b.skjold` før kaldet.
- **Ingen skub.**

**Antænder:**
- farer (§2)
- placerede printere og miner inden for `ILD_PLAC_R` med `lunte === 0`: printeren får `lunte = 90`, minen `lunte = 30`, med `kaede + 1`, `kaedeId`, `kildeHold` og `kildeBaever`.

Våbenkasser, telefon, piller og gravsten er immune over for ild.

## 4. Kæderegler og terminering

### 4.1 Hvem reagerer på hvad

| Kilde → mål | Kabelsalat | Drone | Støvsuger | Printer / mine | Kasser | Kunde |
|---|---|---|---|---|---|---|
| Eksplosion (`D.eksploder`) | antændes + skub ×1,6 | nedskudt | antændes + skub ×0,8 | springer (damage.js:59-67) | springer (:68-75) | som i dag |
| Projektil rører (`rammerBaevere` og `detonation` eller `klynge`) | sprænger på den **(rettet: ikke de første 8 tick over skytten)** | nedskudt | sprænger på den | printer som i dag (world.js:659-662) | – | som i dag |
| Scanner (hitscan) | antændes **(rettet: +12 wu tolerance)** | **LEVERET!** | antændes | – | – | som i dag |
| Klageklask | slås væk | – | vender | – | – | som i dag |
| Tvangsopdatering | – | – | pause 300 | – | – | som i dag |
| Ildplet / brændende fare | antændes | – | antændes | `lunte` 90 / 30 | immune | 4 pr. takt, loft 24 pr. tur |
| Vand | flyder; slukkes, hvis den brænder | forsvinder | kortslutter | – | – | drukner |

Papirbunke og COVID flyver gennem farerne. Hoppende granater rører dem ikke, men deres brag antænder.

### 4.2 Kæde-id, dybde og ejer

**(rettet)** Fire flade felter følger med: `kaedeId`, `kildeHold`, `kildeBaever` og `kaede`.

- **Dybde 0:**
  - Et projektils brag (world.js:679) starter med `{ kaedeId: p.kaedeId ?? p.id, kildeHold: p.ejerHold, kildeBaever: p.ejer, kaede: 0 }`.
  - Klyngens børn arver `kaedeId` (behaviours.js:103-111).
  - Scanner og klask bruger `kaedeId = −v.tick`, `kildeHold = b.hold` og `kildeBaever = b.id`.
- **Dybde + 1:** det, der tilføjes til køen i damage.js:64 og :73, farer, der antændes, og lunter, som ild tænder. Pletterne arver dybden.
- **(rettet, valgfrit) Ligkæden:**
  - `givSkade` gemmer `b.draebtAf = { kaedeId, kildeHold, kildeBaever, kaede }`, når kunden dør af en kædeskade.
  - `afvikleDoedsfald` (damage.js:165) giver ligets brag `kilde` med `kaede + 1`.
  - Ingen snapshot falder imellem, for snapshots tages kun ved turstart.
- **Loft:** `KAEDE_MAKS = 5` gælder kun antændelser af farer og lunter fra ild.
- **Hændelserne:** `eksplosion` (damage.js:77) og `skade` (damage.js:94, gennem en ny valgfri `ekstra`) bærer felterne, og `skade` får `drab: true`.

### 4.3 Hvorfor enhver kæde slutter

1. **Hver tilstand går kun fremad.** Hver fare antændes og springer højst én gang. Placerede ting og kasser dør én gang (`doed`, damage.js:63 og :72).
2. **Ilden er endelig.**
   - Kilderne er ≤ 11 pletter pr. Kabelsalat, 3 pr. støvsuger og 2 pr. drone.
   - Højst 3 generationer, loft 40 pletter og højst 285 aktive tick levetid.
   - Ild skaber kun brag gennem lunter på placerede ting.
3. **Nye farer kommer kun fra planlæggeren**, højst én ad gangen og mindst 80 s aktiv tid imellem. **(rettet)** En udsættelse trækker intet.
4. **Køen drænes én pr. tick** (world.js:603-607).
5. **Genindtræden fra SKADE i OPLOESNING** (world.js:840-849) kræver et nyt dødsfald eller en ny eksplosion i køen.
6. **(rettet) Alle uro-kilder er endelige ure:**

   | Kilde | Loft |
   |---|---|
   | `brand` | ≤ 120 (+10) |
   | `luft` | ≤ 180 pr. skub eller indgang, og skub er endelige |
   | `styrt` | ≤ 240 |
   | `lunte` | ≤ 90 |
   | `truer` | ≤ 91 |

   Væghop og stødhop er aldrig uro, så en Kabelsalat i en grube kan ikke holde turen åben.

### 4.4 Hvad holder OPLOESNING åben

`erIRo` (turn.js:112-127) får **(rettet) tre** nye linjer og ingen import:

```js
for (const f of v.farer || []) if (f.uro > 0) return false;             // brand, luft eller styrt
for (const p of v.placerede) if (p.lunte > 0 && !p.doed) return false;  // printer/mine sat i brand
for (const p of v.ild || []) if (p.truer) return false;                 // (rettet) ild, der kan nå en printer/mine
```

**(rettet) Urene** (i stedet for én tæller):

```js
// Tæller ned i FA.skridt; uro udledes sidst i skridtet.
// erIRo læser forrige ticks værdi (_maskine kører før FA.skridt).
f.brand  // Kabelsalat 120, støvsuger 90 → derefter brag. 0 = ingen brand
f.luft   // 180 ved indgang i luften og ved skub; 0 ved landing eller i vandet
f.styrt  // drone 240; 0 ved nedslag
f.uro = Math.max(f.brand > 0 ? f.brand + 10 : 0, f.luft, f.styrt);
```

En landing nulstiller **kun** `luft`. Rullende, flydende, kørende og flyvende farer er ikke uro, og det samme gælder væghop og stødhop.

**Vagthunden** `RO_VAGTHUND` 720 (turn.js:33) er uændret. `tvungenRo` (turn.js:129-153) udvides:
- brændende og styrtende farer fjernes med `fareVaek` `'slukket'`
- `luft = 0` og `uro = 0` på resten
- `p.lunte = 0` på placerede ting
- **(rettet)** `p.gen = ILD_GEN` og `p.truer = false` på alle ildpletter.

## 5. Spawnregler

```js
v.farePlan = { aktiv: 0, naeste: null, varsel: null /* {slags,x,y,ret,rest} */, antal: 0, sidste: null }
```

**Uret**
- `aktiv` tæller kun aktive tick (SPILLER_AKTIV, AFFYRING og OPLOESNING).
- **Første fare:** når `tur.runde >= 2` (`_maaskeNyRunde`, world.js:1165-1170), trækkes `naeste = aktiv + [30, 70] s`.
- **Derefter:** `[80, 160] s` aktiv tid. Uret går kun, mens `farer.length < FARE_MAKS` (1).

**Varslet (rettet)**

```
ved aktiv >= naeste:
  S = FA.steder(v)   // deterministisk prøvekørsel UDEN træk, ét kald til _udstyrsPladser()
                     // { kabelsalat: [...], drone: ['v'|'h'] eller [], stoevsuger: [...] }
  mulige = slags, hvor S[slags].length > 0, cfg tillader den, banen tillader den,
           betingelserne gælder (internet, kasseplads), og slags ≠ sidste (medmindre den er den eneste)
  mulige tom → naeste = aktiv + FARE_UDSAET (300); INTET træk
  ellers → træk slags (vægtet, §2) → træk sted blandt S[slags] → træk side eller last → varsel
```

- **Omkostning:** `_udstyrsPladser()` tager 1,5-1,75 ms (målt, e1.mjs) og kaldes kun på planlægningstick.
- **Varslet:** `rest = 180` (3 s aktiv tid), og `fareVarsel` meldes. Faren er synlig som en pulserende pil, men kan ikke rammes. Ved `rest === 0` kommer faren ind (`fareKommer`), og en ny pause trækkes. Et udsendt varsel holdes altid; ligger stedet nu i vandet eller i luften, klarer fysikken det.
- **Træk pr. fare:** højst 4. Pr. udsættelse: 0.

**`cfg.farer`**
- `null` eller `undefined` (standard i `STANDARD_CFG`, world.js:46-58, og for ældre snapshots): alle farer.
- `[]`: ingen og intet træk.
- En liste: kun de nævnte.
- `FA.tving(v, slags, sted, h)` findes til test.

**Pludselig død:** farerne er tilladt med de samme regler.

## 6. Turintegration (kritisk)

| Tilstand | Farer og ild | Planlæggerens ur | Hvorfor |
|---|---|---|---|
| FILM, UDSAET | står stille | står | filmen og nedtællingen |
| TUR_START (150 tick, turn.js:31) | står stille | står | kunden kan ikke flytte sig endnu |
| **SPILLER_AKTIV** | **kører** | **går** | realtid, også i arsenalets pause (world.js:796-798). **(rettet)** Den aktive kunde har startpause fra ild (§3) |
| AFFYRING | kører | går | ét tick |
| **OPLOESNING** | **kører** | **går** | kæden afvikles i skyttens tur (§4.4). Gælder også genindtræden fra SKADE (lig, COVID fra TUR_SLUT) og fra TUR_START (`_afslutTur`, world.js:961-969) |
| SKADE, TUR_SLUT | står stille | står | efterspil og turskift |
| SEJR | står stille | står | – |

**Rækkefølgen i ét tick** (`skridt`, world.js:594-630):

```
_draenKommandoer → _maskine (erIRo læser forrige ticks uro/truer) → én eksplosion fra køen (damage.js sætter f.ramt)
→ forsinkede → _fysik (projektiler sætter f.ramt; lunter tikker; pakker falder fejet) → FA.skridt(v, h) → tjekDrukning
FA.skridt: return uden for AKTIV · plan · frigør begravede · reagér på f.ramt · bevæg · kontakter
           (ild↔farer, ild↔placerede, støvsuger↔miner) · ild (alder, spredning, sluk, truer) · ildskade · ure → uro · fjern
```

**Frosne tilstande:**
- Et `f.ramt`, der sættes, mens farerne står stille, afvikles ved første aktive tick. Det sker fx ved printerhændelsen (haendelser.js:209-217) og ved stenskredets mursten (world.js:1133-1147) i TUR_START.
- Kunder, placerede ting og kasser simuleres i alle tilstande (world.js:620). Kun farer og ild står stille.

**Dødsfald og tur**
- Dør den aktive kunde af ild, afslutter `_aktivErDoed` turen (world.js:794).
- Andre, der dør, ligger i `doedskoe` og afvikles i SKADE.
- `ildTur` nulstilles for alle i `_turStart` (world.js:911-959).
- `givSkade` sætter `skadeITur` (damage.js:93), så efterspillet bliver 100 tick.

**(rettet) De 13 rundehændelser** (haendelser.js:127-284), alle i `_turStart`, altså i TUR_START:

| Hændelse | Samspil med farerne |
|---|---|
| stenskred | Murstenene kan ramme en frosset fare. `ramt` afvikles senere, og `kildeHold` er null |
| uvejr | Vinden og vejret skifter. Kabelsalaten vender; regn og slud halverer ildens levetid og stopper spredningen |
| telefoner | Immune over for ild. En telefon kan stå i ild |
| internet | Ingen skud og ingen spillerantændelser. Dronen kommer ikke; en drone i luften flyver videre |
| shitstorm | **(rettet)** `stormSted` afviser steder inden for `STORM_ILD_AFSTAND` = 76 wu af en plet (20 + 2·24 + 8) |
| kaffepause | – |
| printere | Printerne går af i TUR_START. Farerne får `ramt`; ilden står stille |
| pakker | Kan fylde kassepladserne. En nedskudt drone giver så konfetti |
| influenza | – |
| brandøvelse | **(rettet, obligatorisk)** `v.ild.length = 0` **før** `flytAlle` (haendelser.js:259-261), og `e.slukket` er antallet af slukkede pletter. `sikkertSted` ændres ikke |
| myldretid | – |
| vandskade | +24 wu (haendelser.js:265-269). Ild under vandet slukkes ved første aktive 10.-tick; Kabelsalaten flyder; støvsugeren kortslutter |
| lønningsdag | – |

**Øvrige samspil:**
- **COVID** flyver gennem farerne; smitten rammer ikke farer.
- **Hjemmearbejde:** ingen ildskade og ingen `skjoldBlok` fra ild.
- **Boret:** `redskab` er i forvejen uro, og ild skader kunden, der borer.
- **Fortet:** MUR spreder ikke ild.
- **Miner:** nærhedstjekket gælder kun kunder (world.js:697-698).
- **Telefonens viderestilling** (world.js:1112-1127) kan lande i ild. Det accepteres: det er telefonens lotteri.
- **(rettet)** Telefonens `spam` (world.js:1096-1111) bruger samme 76 wu-regel som shitstormen.

## 7. Snapshot, delta, VIDERESEND og net

**`tagSnapshot`** (snapshot.js:19-66):
- `farer: v.farer.map((f) => ({ ...f, ramt: f.ramt && { ...f.ramt } }))`, `ild: v.ild.map((p) => ({ ...p }))` og `farePlan: { ...v.farePlan, varsel: v.farePlan.varsel && { ...v.farePlan.varsel } }`.
- Kundens række (:36-42) får `ildTur`, og projektilernes række (:43-49) får `kaedeId`.
- `lunte`, `kaede` og `fald` følger med automatisk (:50-51).
- **(rettet)** Snapshottet er **ikke** tabsfrit midt i en kæde: køen, `forsinkede` og `doedskoe` er ikke med, og `genskab` tømmer dem (world.js:1270-1273). Det betyder intet for spillet, for kun værten simulerer og genskaber aldrig. Snapshottesten skal derfor bruge et tick med tom kø.

**`genskab`** (world.js:1214-1274): læser de tre felter med `[]` og `FA.nyPlan()` som fallback. `cfg.farer ?? null`.

**`aftryk`** (world.js:1279-1294), **(rettet)**:

```js
if (this.farer.length || this.ild.length) {        // uden farer: bit for bit samme aftryk som i dag
  for (const f of this.farer) { bland(f.id); bland(f.x); bland(f.y); }
  bland(this.ild.length);
}
```

**`tagDelta`** (snapshot.js:73-108):

```js
const fa = v.farer.map((f) => [f.id, f.slags, Math.round(f.x * 8) / 8, Math.round(f.y * 8) / 8,
  TILST[f.tilst], f.ret, f.brand > 0 ? 1 : 0, f.spam | 0, f.pakke ? 1 : 0, f.hud === 'nullermand' ? 1 : 0]);
const il = v.ild.map((p) => [p.id, p.x | 0, p.y | 0, Math.max(0, p.liv - p.alder) >> 4]);
// ks får 6. kolonne k.fald ? 1 : 0
// h.fv = varsel ? [slags, x, y, ret, rest] : null
// (rettet) fa og il sendes ALTID, også tomme
```

**`anvendDelta`** (snapshot.js:111-171), **(rettet)**:
- `v.farePlan.varsel = d.h.fv ? {…} : null` tildeles **altid**. Følg ikke mønstret `if (!== undefined)` (:164), for så forsvinder kantpilen aldrig.
- `farer` genopbygges fra `d.fa || []` med en map over de gamle, som projektilerne (:133-142). Objekterne genbruges, så `hist` bevares.
- `ild` genopbygges fra `d.il || []`.

**Klienten** (net/client.js): `verden.farer` kommer med i historikken (:33), nulstillingen ved et snapshot (:143) og `placer` (:182-183).

**VIDERESEND** (worker.js:18-31) får 8 navne: `'fareVarsel', 'fareKommer', 'fareAntaendt', 'fareLeveret', 'fareSpiste', 'fareOpdateres', 'fareVaek', 'ildTaendt'`. Serveren ændres ikke (protokol.py:45).

**Gæster og sene deltagere:**
- Kun værten simulerer. Sene deltagere får alt gennem `snap_bed` (worker.js:100-101).
- **(rettet)** Gæster ser verden ~80 ms bagud (client.js:169). Derfor har hitscan tolerance mod farer (§2.1, §2.2). Projektiler har ingen: den forsinkelse svarer til at skyde 0,1 s for sent, og eksplosionsradius dækker det.

**Import-cykler:** ingen. `farer.js` importerer entities, physics, terrain, weapons, damage og turn. `behaviours.js` importerer `foersteFare`.

## 8. Brugerflade og lyd

**Nyt modul `ui/farer.js`:** `kobFarer({ bus, hud, lyd, visning, S, r, fx })` giver `{ opdater(v) }`.
- Det kobles efter `kobHaendelser` (main.js:760), inde i `koblHaendelser`, som begynder med `bus.ryd()` (main.js:571).
- `opdater` kaldes fra `opdaterVisning` (main.js:1116).
- Modulet har eget DOM-lag. Det slår farerne op på id hver frame og holder aldrig objekter, fordi snapshottet udskifter dem (main.js:535-536).

**Varsel:** `hud.banner(tekst, 2800, 'advarsel')` (hud.js:470).
- "KABELSALAT ← · Skyd den, så går den i brand" (i hulen: "NULLERMAND! En støvtot drysser ned fra loftet · meget brændbar")
- "PAKKEDRONE → · Skyd pakken ned, eller scan den, så er den din"
- "ROBOTSTØVSUGEREN ER VÅGNET · Den æder mails, og batteriet tåler ikke skud"

**Kantpil:** placeres med `r.tilSkaerm` (renderer.js:119). Under varslet læser den `v.farePlan.varsel`. Et navneskilt vises i 5 s. Med `prefers-reduced-motion` pulserer den ikke.

**Første gang pr. profil og slags:** `fx.pop('SKYD MIG!', …)`, husket i localStorage med try/catch (hjaelp.js:153-155).
- **Ikke** `hjaelp.hint()`, for den tømmer tutorialens kø (hjaelp.js:163).
- Ingen "tryk mellemrum"-boble, for mellemrum lader skuddet (keyboard.js:26).

**Tegneserieord:** `fx.pop` (fx.js:690).
- **KÆDE ×n!** ved hver `eksplosion` med `kaede >= 2`.
- **SYGT PLAY! (rettet):** vises én gang pr. `kaedeId`, når kæden (dybde ≥ 1, `kildeHold` sat) har skadet ≥ 2 forskellige fjender eller dræbt én.
  - Et drab er en `skade` med `drab`, eller en `drukner` eller et `doedsfald` i samme tur for en kunde, som kæden har skadet. Det dækker de drukninger og fald ud, der aldrig giver `skade` (damage.js:107-117, world.js:650).
  - Banneret: "SYGT PLAY! ⟨navnet på `kildeBaever`⟩".

**Ros:** `skade`-lytteren (main.js:775-784) kalder kun `skudRamte` (main.js:1034) ved skyttens egen kæde eller uden `kildeHold`.
- For `'ild'` spilles ingen lyd i lytteren.
- **(rettet)** `replik(ramt, 'av')` kaldes kun ved kundens første ildskade i turen, husket i `S.ildReplik` efter `turNr`.

**Pakken:** i `kasseFalder` (main.js:734) giver `e.fald` teksten "Pakken falder!". En printer, som lunten sprænger, melder `printerSprang` (main.js:801).

**Lyd.** Alt går gennem den fælles kanal (lyd.js:166-301). Ingen nye løkker.

| Øjeblik | Kald | Kanal | Pladsholder |
|---|---|---|---|
| `fareVarsel` | `afspil('fare_<slags>', { maksSek: 1.5 })` | **(rettet) normal**: falder bort, hvis kanalen er optaget. Den vigtige kø har ingen udløbstid (lyd.js:289-291) og ville spille varslet for sent | `papir_kast` / `kasse_falder` / `opdatering_faerdig` |
| Kabelsalat antændt | `afspil('kortslutning')` | normal | `inferno_delt` |
| Støvsuger overophedet | `afspil('stoevsuger_alarm')` | normal | `mine_bip` (tone 1,4) |
| `fareLeveret` | `afspil('vaaben_samlet')` | **(rettet) normal** som `kasseSamlet` (main.js:786) | findes |
| `fareSpiste` | `afspil('nom')` | normal | `skum` |
| `fareOpdateres` | `afspil('opdatering_ramt')` | normal | findes |
| Slukket eller druknet | `afspil('plask')` | normal | findes |
| Brag | den eksisterende `eksplosion`-lytter (main.js:572-586) | `forrang` | findes |
| Ildskade | ingen lyd i lytteren; `taelSkade` (main.js:1096) | – | – |
| SYGT PLAY | `lyd.har(SPEAKER.sygt_play) ? stemme(…, { vigtig }) : afspil('intro_slam', { vigtig })` | `vigtig` | `intro_slam` |

Der skal en ny eksport `lyd.har(navn)` i lyd.js, fordi `afspil` og `stemme` giver `false` både for "mangler" og for "optaget" (lyd.js:282 og :313-320). `har` skal slå op med `variant()`.

## 9. Kamera

- **SPILLER_AKTIV og TUR_START: aldrig indramning.** Kun kantpil, banner og lyd.
- **(rettet) Brag under sigtet:** i `eksplosion`-lytteren (main.js:572-586) kaldes kun `visning.kamera.rystelse(Math.min(1, e.radius / 60), afstand)` (camera.js:372-376), når `S.verden.tur.tilstand === 'spiller_aktiv' && e.kaede >= 1`. `kamera.eksplosion` kaldes ikke, for dens punch og spark ved r ≥ 70 (camera.js:383-395) skubber billedet, mens man sigter. Koordineres med kamera-agenten, der ændrer netop de kaldesteder.
- **OPLOESNING, når intet projektil flyver** (`S.skudId == null`, main.js:1048-1067): ved `fareAntaendt` og ved `eksplosion` med `kaede >= 1` kaldes `visning.kamera.rammeInd(x, y, 1.2)` (camera.js:365-368), højst hvert 2. s. Indramningen har lavere prioritet end dødsfaldets fokus og nedslaget (camera.js:493-504), og zoomen har et loft (`MARKOER_LOFT`).
- **Aldrig** `foelg`, `fokus`, `etabler`, `kortFokus` eller `foelgSkud`.
- `ui/farer.js` føjes til listen i API-testen (test/kamera_determinisme.mjs:144).

## 10. Kunstbrief til art directoren

Uændret fra dommerens design:
- 20 frames à 256×256, fordelt `idle_0-3, aktiv_0-3, fald_0-1, land_0-2, udloes_0-2, doed_0-4` (objekt_view.js:3-31).
- Kilderne i `Assets/Cartoon Characters/Kundekrigen objekter/<navn>/`, pakket af `vaerktoej/tegneserieobjekter.py` til `static/grafik/objekter/<navn>.webp`.
- Stil som printeren og phishing-minen. Bag ingen rotation ind, og hold silhuetten rund.

| Model | Bredde i spillet | idle | aktiv | fald | land | udloes | doed |
|---|---|---|---|---|---|---|---|
| `kabelsalat` | ~30 wu, rund | kabelender og stik vipper; papirstrimler blafrer | **brænder**: flammer mellem kablerne, gnister fra stikkene | løs og strittende | squash | blå-hvidt KORTSLUTNING-glimt | sort trådskelet smuldrer til aske |
| `nullermand` | ~32 wu, rund | grå totte med clips, post-it og SIM-kort | brænder (grå røg, gule flammer) | fnug | squash | støvpuf | aske |
| `pakkedrone` | ~48 wu inkl. kasse | rotorsløring med kassen under | ramt: ryger og gnister | tumler | styrt | træfglimt | vrag |
| `robotstoevsuger` | ~28 × 10 wu | kører; sidebørsten drejer; grøn LED; navneskilt "RUNE" | **overophedet**: rød LED, glød, røg, batteriet buler | vendt om, hjulene snurrer | hop | NOM (suger) | batteriet springer |
| `ild` | ~22 × 26 wu | lille flammeløkke | blusser op på skadetakten | – | tændes (puf) | – | gløder og ryger ud |

**Også:**
- Kantpilens ikoner `#i-kabelsalat`, `#i-drone` og `#i-stoevsuger` i streg som `#i-arrow` (static/index.html:20).
- Pakken genbruger `vaerktoejskasse` (fx.js:1043).
- Valgfrit: et "brændt græs"-mærke.
- Lyd via `vaerktoej/kontorlyde.py`: `fare_kabelsalat`, `fare_drone`, `fare_stoevsuger`, `kortslutning`, `stoevsuger_alarm` og `nom`. Grupperne føjes til `GRUPPER` og `GRUPPE_VOL` (lyd.js:24-45), først når filerne findes.
- Speakerreplikken "Sygt play!" optages af brugeren (`SPEAKER`, stemmer.js:61-66).

**Pladsholder i kode:** `render/fare_view.js` og `render/fare_kunst.js`.
- Et atlas tegnet på lærred i stil med `lavGenstandAtlas` (kunst.js:666) og `celle` (kunst.js:681).
- `objektMesh` og `animer` (objekt_view.js:63 og :105) bruges, når kunsten findes.
- Lagene (renderer.js:46-60): jordfarer i `Z.genstande`, ild i `Z.fx − 1`, dronen i `Z.projektiler − 1`.

## 11. Tuningtabel

| Konstant | Værdi | Note |
|---|---|---|
| **Planlægger** | | |
| `FARE_FRA_RUNDE` | 2 | |
| `FARE_FOERSTE_S` · `FARE_PAUSE_S` | [30, 70] · [80, 160] | aktiv tid |
| `FARE_MAKS` · `FARE_VARSEL` · `FARE_UDSAET` | 1 · 180 tick · 300 tick | **(rettet)** udsættelsen trækker intet |
| `FARE_AFSTAND` | 250 wu (kabelsalat) · 300 wu (støvsuger) | |
| **(rettet) Uro og træf** | | |
| `FARE_LUFT_URO` | 180 tick | indgang i luften og skub; nulstilles ved landing |
| brand-uro | `brand + 10` | |
| `DR_STYRT_URO` | 240 tick | |
| `FARE_STRAALE_TOL` | 12 wu | kun hitscan mod farer |
| `FARE_SKYTTE_PAUSE` | 8 tick, inden for `f.r + BAEVER_R + 4` | |
| `FARE_FRIGOER` | 2 wu × 40 | |
| **Kabelsalat** | | |
| `KS_R` · `KS_LIV` | 14 · 3000 tick | levetiden står stille under brand |
| `KS_VIND` · `MAKS` · `MIN` · `TRAEG` | 240 · 150 · 24 wu/s · 0,04 | |
| `KS_RET_HYST` | \|vindNu\| ≥ 0,05 skifter retning | **(rettet)** |
| `KS_TRIN_OP` · `KS_TRIN_NED` | 8 · 10 wu | |
| `KS_TYNGDE` · `KS_FLYD` | 0,55 · 0,5 | |
| `KS_VAEG_HOP` · `KS_PRELL` | vy 260 · −0,3 | ikke uro |
| `KS_STOED` | vy 300, vx 80, højst 2 | ikke uro |
| `KS_SKUB` · `KS_KLASK` | ×1,6 · vx ±240, vy 160 | |
| `KS_BRAND` · `KS_BRAND_FART` · `KS_DRYP` | 120 tick · ×1,3 · hvert 20. tick | |
| `KS_FLAMMEBRAG` | r 44, skade 22, skub 150, intet krater | plus 5 pletter i ring |
| **Drone** | | |
| `DR_R` · `DR_FART` · `DR_HOEJDE` | 20 · 110 wu/s · 200 wu | felt: `hoejdeMaal` **(rettet)** |
| `DR_OP` · `DR_NED` · loft og gulv | 120 · 40 wu/s · h−60 / vand+200 | |
| `DR_STYRT` | tyngde 480, vx ×0,6; brag r 38, skade 24, skub 180, krater | plus 2 pletter |
| `PAKKE_TRIN` | 1 wu | **(rettet)** fejet fald |
| **Støvsuger** | | |
| fart · `RS_KLIPPE` · `RS_KUNDE` | `F.gaa` hvert andet tick · 24 wu · 22 wu | |
| `RS_SPAM` | højst 2, kun `ejer == null` **(rettet)** | +12 r og +15 skade pr. mine |
| `RS_OVERHED` · `RS_BATTERI` | 90 tick · r 50, skade 30, skub 220, krater | plus 3 pletter |
| `RS_OPDATERING` · `RS_LIV` · `RS_SKUB` | 300 · 3600 tick · ×0,8 | |
| **Ild** | | |
| `ILD_CELLE` · `ILD_MAKS` | 24 wu · 40 | |
| `ILD_LIV` · `ILD_SPRED_ALDER` · `ILD_GEN` | 240 + 15·(id%4) · 45 · 2 | |
| `ILD_STILLE` · `ILD_VEJR` | \|vindNu\| < 0,15 · regn/slud ×0,5 uden spredning, sne uden spredning | |
| `ILD_R` · `ILD_PLAC_R` · `ILD_FALD_MAKS` | 12 · 20 · 40 wu | |
| `ILD_TAKT` · `ILD_SKADE` · `ILD_LOFT` | 30 tick · 4 · 24 pr. kunde pr. tur | |
| `ILD_START_PAUSE` | `ILD_TAKT` for den aktive kunde | **(rettet)** |
| `ILD_TRUER_DY` | 40 wu | **(rettet)** |
| `ILD_LUNTE` | printer 90, mine 30 | |
| `STORM_ILD_AFSTAND` | 76 wu | **(rettet)** shitstorm og spam |
| **Kæde og brugerflade** | | |
| `KAEDE_MAKS` | 5 | |
| SYGT PLAY | dybde ≥ 1: ≥ 2 fjender skadet, eller 1 dræbt (også ved drukning eller fald ud i samme tur) | **(rettet)** |
| Kamera | `rammeInd` 1,2 s, højst hvert 2. s, kun i OPLOESNING; i SPILLER_AKTIV kun rystelse ved `kaede ≥ 1` | **(rettet)** |
| Banner · navneskilt | 2800 ms · 5 s | |

## 12. Testplan (`node --test test/farer_*.mjs`)

Hjælperen `test/farer_hjaelp.mjs` bygger en rigtig verden, som test/kamera_determinisme.mjs:64-104 gør, med `FA.tving` og en bot.

**(rettet) Referencesporet**
- Det optages med `test/farer_lav_spor.mjs` **på det træ, implementeringen bygger på, efter at MapGEN er landet**.
- Det gendannes med samme kommando, når banegeneratoren ændres. Ellers er testen falsk rød.
- Takket være §7 er `aftryk` uden farer bit for bit som i dag.

| Fil | Tester |
|---|---|
| `farer_determinisme.mjs` | Samme frø og input giver samme `aftryk` i 20 000 tick (≥ 3 farer og ≥ 1 brand). **Med `cfg.farer: []` er sporet identisk med referencesporet.** Højst 4 træk pr. fare, og **(rettet)** 0 træk pr. udsættelse. `sim/farer.js` bruger hverken `Math.random`, `Date`, `performance`, `document` eller `window` (README.md:487-496) |
| `farer_kaede.mjs` | Det patologiske kort slutter inden for 1500 tick. `ild.length ≤ 40`, dybde ≤ 5, hver ting springer højst én gang, 200 opstillinger med `lavRng`. Regn, vand, begravelse og kraftfelt |
| `farer_tur.mjs` | Se listen nedenfor |
| `farer_plan.mjs` **(rettet, ny)** | Øer med 4×3 kunder (målt: ned til 0 gyldige pladser): i 20 000 tick trækkes der aldrig ved en udsættelse, og fortets støvsuger bruger kun gyldige pladser eller springes over |
| `farer_fysik.mjs` **(rettet, ny)** | `FA.skridtPakke` fra 200 og 420 wu på 4 fortfrø lander altid på øverste lag (målt med `skridtFaldende`: 4/1760 faldt igennem). En Papirbunke, Kabelbakke eller Byggeskum over en fare er fri efter ét aktivt tick |
| `farer_snapshot.mjs` | Rundtur midt i en brand på et tick med tom kø, derefter 600 tick med ens `aftryk`. `tagDelta` → `anvendDelta`: id, slags, positioner inden for 1/8, **(rettet)** `fv` bliver `null` på spejlet, når varslet er slut, og den sidste fare forsvinder. Gamle snapshots kan indlæses |
| `farer_loft.mjs` | Aldrig mere end `FARE_MAKS`. Ingen drone i hulen eller under nedbrud. Rullemodellen på 4 banetyper × 6 frø: under 10 % sidder fast, og den er aldrig inde i terrænet |
| `farer_net.mjs` | Hvert `navn: '…'` står i VIDERESEND. `lavKlient` med 20 Hz giver en glat `x`. **(rettet)** En scanning mod dronens position forskudt 20 wu (80 ms) rammer stadig |
| `farer_lyd.mjs` | Falsk `lyd`: kun `afspil`, `stemme` og `har`, aldrig `loop`. **(rettet)** Varsler og `fareLeveret` er ikke `vigtig` |

**`farer_tur.mjs`** tester:
- En landet Kabelsalat i evig vind forsinker ikke SKADE ud over `RO_HYSTERESE + 5`.
- **(rettet)** En Kabelsalat, der kommer ind i luften, venter højst `FARE_LUFT_URO`.
- En brændende Kabelsalat forsinker højst `KS_BRAND + 10`.
- **(rettet) Regression for D1:** en brændende Kabelsalat, som et nyt brag kaster op, lander, men turen slutter først efter flammebraget.
- **(rettet) Regression for D2:** ild ved en utændt printer får printeren til at gå af i skyttens tur. Uden at nogen placeret ting flytter sig, får ingen placeret ting lunte af en plet, der er født i en tidligere tur.
- Vagthunden reagerer aldrig i 200 scenarier.
- I TUR_START, SKADE og TUR_SLUT er positioner, alder, ildens alder og `farePlan.aktiv` uændrede.
- **(rettet)** Ved SKADE har ingen fare `luft > 0`.
- Ingen fare før runde 2.
- En aktiv kunde, der dør af ild, giver `'kunden døde'`.
- `ildTur ≤ 24`, og **(rettet)** den aktive kunde tager ingen ildskade i sine første 30 tick.
- En nedskudt pakke lander uden tvang.
- **(rettet)** Brandøvelsen efterlader 0 pletter.

**Desuden:**
- `ui/farer.js` føjes til kamera-API-listen (test/kamera_determinisme.mjs:144), og `test/README.md` opdateres.
- **(rettet)** `kort_*`, `kamera_*` **og `fysik_granat.mjs`** skal være grønne og uændrede. fysik_granat kører 10-minutters kampe med standard-cfg (test/fysik_granat.mjs:156-190), så den får farer. Fejler den, er fejlen i farekoden.

## 13. Ændringsliste fil for fil

**Nye filer**

| Fil | Indhold |
|---|---|
| `static/js/sim/farer.js` | Konstanter, `FARE_INFO`, `FARE_VAEGT`, `nyPlan()` og `skridt(v, h)`. Desuden `taendIld`, `projektilRammer(v, p)` (segment-cirkel plus **(rettet)** skyttepause), `foersteFare(v, m, dx, dy, maks)` (plus **(rettet)** tolerance) og `tving`. **(rettet)** Også `steder(v)`, `frigoer` og `skridtPakke(t, k)` |
| `static/js/render/fare_view.js`, `render/fare_kunst.js` | `lavFareView(scene, fx)` med `opdater(farer, ild, tid)` og `fjern()` |
| `static/js/ui/farer.js` | Bannere, kantpile, navneskilte, ord, KÆDE ×n, SYGT PLAY, lyd og kameraglimt |
| `test/farer_*.mjs`, `test/farer_lav_spor.mjs` **(rettet)**, `test/data/farer_fra_spor.json` | §12 |

**Ændrede filer**

| Fil | Sted (anker) | Ændring |
|---|---|---|
| `sim/world.js` | import · `STANDARD_CFG` · konstruktør | `import * as FA`; `farer: null`; `this.farer = []; this.ild = []; this.farePlan = FA.nyPlan();` |
| | `skridt` (køen, :606) · `FA.skridt` (:620-621) | `D.eksploder(…, e.carve, null, e.kilde)`; `FA.skridt(this, h)` mellem `_fysik` og `tjekDrukning` |
| | `_fysik`, projektiler og brag (:659-662, :679) | `projektilRammer` giver `traef = { slags: 'fare' }`; `kilde` gives med |
| | `_fysik`, lunter (:690-695) | køposten får `kilde`; printeren melder `printerSprang` |
| | `_fysik`, kasser (:709-713) | `\|\| k.fald`, og **(rettet)** `k.fald ? FA.skridtPakke : F.skridtFaldende` |
| | `_turStart` | `b.ildTur = 0` for alle |
| | `_tagTelefon` `spam` (:1096-1111) | **(rettet)** 76 wu fra ild |
| | `genskab` · `aftryk` | §7, **(rettet)** kun ved ikke-tomme lister |
| | undgås | `udsaet`, `_udstyr*` og `findStartpladser` |
| `sim/turn.js` | `erIRo` (:112-127) | **(rettet)** de 3 linjer i §4.4 |
| | `tvungenRo` (:129-153) | fjern brændende og styrtende; `luft`, `uro` og `lunte` sættes til 0; **(rettet)** ild får `gen = ILD_GEN` og `truer = false` |
| `sim/damage.js` | `eksploder` (:27-79) | 9. parameter `kilde`; køposterne får `kilde` med dybde + 1; `f.ramt`; `eksplosion` bærer felterne |
| | `givSkade` (:85-100) | valgfri `ekstra` plus `drab`; **(rettet, valgfrit)** `b.draebtAf` |
| | `afvikleDoedsfald` (:165) | **(rettet, valgfrit)** ligets brag får `kilde` |
| `sim/behaviours.js` | `delKlynge` · `hitscan` · `straale` · `klask` | som før (`foersteFare` med tolerance). **(rettet)** `ballistisk` ændres ikke; skyttepausen regnes i `farer.js` |
| `sim/entities.js` | `lavBaever` (:53-68) | `ildTur: 0` |
| `sim/snapshot.js` | `tagSnapshot` · `tagDelta` · `anvendDelta` | §7, **(rettet)** tildel altid `fv`, `fa` og `il` |
| `sim/worker.js` | `VIDERESEND` (:18-31) | 8 navne |
| `sim/haendelser.js` | `brandoevelse` (:259-261) | **(rettet, obligatorisk)** `v.ild.length = 0` før `flytAlle`, plus `e.slukket` |
| | `stormSted` (:292-308) | **(rettet)** 76 wu fra ild |
| | `sikkertSted` (:363-380) | **(rettet)** ændres **ikke** |
| `net/client.js` | :33, :143, :182-183 | `verden.farer` i interpolationen |
| `main.js` | import · `byggVisning` | `lavFareView` i `visning` og i `fjern` |
| | `kasseFalder` (:734) · `kobHaendelser` (:760) | "Pakken falder!" · `kobFarer(…)` |
| | `eksplosion` (:572-586) | **(rettet)** kun `rystelse` i SPILLER_AKTIV ved `kaede ≥ 1`. Koordineres med kamera-agenten |
| | `skade` (:775-784) | ingen lyd for `'ild'`; `skudRamte` kun for egen kæde; **(rettet)** `replik` én gang pr. tur ved ild |
| | `opdaterVisning` (efter :1189) | `vi.farer.opdater(…)` og `fareUi.opdater(v)`. `foelgSkud` ændres ikke |
| `render/fx.js` | :1233 · :1250-1253 | ingen faldskærm ved `k.fald`; printeren ryger, når `p.lunte > 0` |
| `render/assets.js` | `MANIFEST` | modellerne, når kunsten er leveret |
| `ui/lyd.js` | `GRUPPER`, `GRUPPE_VOL` · `export const har` | §8 |
| `ui/stemmer.js` | `SPEAKER` | `sygt_play` |
| `static/app.css` | nyt | `.fare-pil`, `.fare-skilt` |
| `static/index.html` | spritet (:20) | ikonerne, når de er tegnet |
| `README.md` · `test/README.md` | | "Farer i realtid" og testtabellen |

**Ingen ændringer i:** `render/camera.js`, `render/parallax.js`, `render/renderer.js`, `ui/hud.js`, `ui/hjaelp.js`, `terrain_gen.js`, `baneregler.js`, `bane_natur.js`, `static/grafik/`, `karaktervalg.css` og `filmintro.css`.

## 14. Risici og åbne spørgsmål

- **Seje turskift (største risiko).** Det imødegås af de tre ure med loft (§4.4), af `truer`, af den udvidede `tvungenRo` og af `farer_tur.mjs`. **(rettet)** Den længste forlængelse af OPLOESNING er ca. 130 + 91 + 90 + kø + ro, under vagthunden på 720 tick.
- **MapGEN ændrer sig.** Indgangene læser kun `_udstyrsPladser()`, `overflade()` og `jordUnder()`. **(rettet)** Referencesporet og rullemodellen skal genmåles med `farer_lav_spor.mjs` og `farer_loft.mjs`, når MapGEN er færdig. Fortets tynde lag på 1-2 wu (e5.mjs) er måske midlertidige, men fejet fald er under alle omstændigheder rigtigt.
- **Balance.** `ILD_LOFT` og `KS_FLAMMEBRAG.skade` er de to håndtag.
  - **(rettet)** Kunder uden turen kan ikke gå ud af ilden. En kunde, der efterlades i ild, tager op til 24 i skyttens tur og op til 24 i næste tur, til ilden er brændt ud (højst 285 aktive tick).
- **Retfærdighed.**
  - Den, der har turen, når faren kommer, får første chance.
  - **(rettet)** Over nettet ser gæster ~80 ms bagud. Det udlignes af hitscan-tolerancen; projektiler udlignes ikke.
- **Kræver brugerens beslutning:**
  1. En lobbyknap "Farer: til/fra". Den kræver en ændring af protokollen (rum.py:101-108, main.js:470-476).
  2. Optagelsen "Sygt play!".
- **Koordinering:**
  - Med punkt 1: HP-bjælken viser ildskade som almindelig skade.
  - Med punkt 2: tutorialen må ikke genbruge `hint()`.
  - **(rettet)** Med kamera-agenten: ændringen i `eksplosion`-lytteren i main.js.