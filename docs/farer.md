# Farer i realtid

Midt i kampen kommer der ting ind på banen af sig selv: en **Kabelsalat**, der
ruller med vinden, en **Pakkedrone** med en pakke under sig og en
**Robotstøvsuger**, der kører rundt og æder mails. De kommer uafhængigt af
tururet, som ren tilfældighed. Men hvad der så sker, er op til spillerne: et
velplaceret skud sætter Kabelsalaten i brand, den ruller hen til en printer, og
printeren springer midt mellem to fjender. Det er et "sygt play".

Simulationen ligger i `static/js/sim/farer.js`. Den er hovedløs (ingen DOM,
ingen three.js, ingen `Math.random`, ingen `Date`) og kører kun i workeren hos
værten. Designet, med alle skeptikerens rettelser, står i
`docs/udkast/farer_design.md`. Brugerfladen, grafikken, lyden og kameraet er del 2
(se [Til del 2](#til-del-2-grænsefladen) nederst).

## Fire regler

1. **Ankomsten er ren tilfældighed, udfaldet kræver dygtighed.** `rngSim`
   bruges kun i planlæggeren: pausen til næste fare, slags, sted og side eller
   last. Der trækkes højst 4 gange pr. fare, og **der trækkes intet**, når der
   ikke er et gyldigt sted, og faren udsættes.
2. **Ingen fare skader af sig selv.** Al skade starter med et skud, et brag
   eller ild. En brand startes kun af et skud, et brag eller en fare, som et
   skud eller et brag har antændt.
3. **Farerne er baggrund, kun følgerne tæller.** Følgerne går ad de
   almindelige veje: brag i eksplosionskøen, skub, en pakke der falder.
4. **Alt er begrænset.** Højst 1 fare ad gangen og 40 ildpletter. Hver ting
   antændes og springer højst én gang. Ilden spreder sig højst 2 generationer,
   og en kæde af antændelser er højst 5 led dyb.

## Hvornår farerne kører

Farerne og ilden kører kun i **aktiv tid**: `SPILLER_AKTIV`, `AFFYRING` og
`OPLOESNING`. I `FILM`, `UDSAET`, `TUR_START`, `SKADE`, `TUR_SLUT` og `SEJR`
står de helt stille (alder, position, ild og planlæggerens ur).

Et brag, der rammer en fare, mens den står stille (fx printerhændelsen i
`TUR_START`), gemmes i `f.ramt` og afvikles ved første aktive tick.

**Tururet er ikke aktiv tid.** Står uret stille i `SPILLER_AKTIV`, fordi
arsenalet er åbent (`PANEL_PAUSE_LOFT`) eller vejledningen venter
(`VEJLEDNING_LOFT`, `ui/hjaelp.js`), kører farerne, ilden og planlæggerens ur
videre, præcis som uden pausen: kunden kan gå, hoppe og sigte imens, så verden
går også. Ildens loft (`ILD_LOFT`) gælder pr. tur, så en længere tur giver ikke
mere ildskade. Med én spiller pr. klinik er alles første tur (og dermed
vejledningen) i runde 1, hvor der aldrig er en fare eller ild. Har en klinik
flere spillere, kan en spillers første tur ligge i runde 2, og så kan en fare
varsles, mens vejledningen står (`test/samspil.mjs`).

**Hele kæden afvikles i skyttens egen tur.** Opløsningen (`erIRo` i
`sim/turn.js`) venter på:

| Uro | Hvad | Loft |
|---|---|---|
| `f.brand` | en brændende Kabelsalat (120 tick) eller en overophedet støvsuger (90 tick) | brand + 10 |
| `f.luft` | en fare, der er kastet op af et skub eller er på vej ind oppefra | 180 tick, nulstilles ved landing |
| `f.styrt` | en nedskudt drone, der falder | 240 tick, nulstilles ved nedslaget |
| `p.lunte` | en printer (90) eller mine (30), som ilden har tændt | 90 tick |
| `p.truer` | ild, der stadig kan sprede sig hen til en utændt printer eller mine | højst 45 tick pr. generation |

De tre ure er adskilte: en landing nulstiller kun `luft`, så en brændende
Kabelsalat, som et nyt brag kaster op, holder stadig turen åben til
flammebraget. `f.uro = max(brand > 0 ? brand + 10 : 0, luft, styrt)`.

En Kabelsalat, der ruller, en drone, der flyver, og en støvsuger, der kører, er
**ikke** uro. Hop mod en væg og vindstødshop er heller ikke. Ild, der ikke kan
antænde noget, brænder videre ind i næste tur.

Vagthunden (`RO_VAGTHUND`, 12 s) er uændret. Griber den alligevel ind
(`tvungenRo`), fjernes brændende og styrtende farer (`fareVaek`, `'slukket'`),
alle ure sættes til 0, tændte lunter slukkes, og ilden holder op med at sprede
sig. En printer eller mine, hvis lunte blev slukket, går i dvale: ilden kan ikke
tænde den igen, men et brag udløser den stadig. Går en kunde senere ind på en sådan mine, er braget minens egen
start (`kaedeId` er minens id, `kaede` 0), ikke ildens gamle kæde. Den længste forlængelse af en opløsning er ca. brand 130 + spredning 91 +
lunte 90 + køen + roen, under vagthunden på 720 tick. I skriptede kampe på
10 minutter pr. banetype griber vagthunden aldrig ind på grund af en fare
(`test/farer_tur.mjs`).

## Planlæggeren

- Uret (`farePlan.aktiv`) tæller kun aktive tick, og kun mens der er plads til
  en fare mere.
- **Første fare:** tidligst i runde 2. Så trækkes en pause på 30-70 s aktiv tid.
- **Derefter:** 80-160 s aktiv tid efter, at den forrige kom ind.
- Når pausen er gået, prøves stederne uden træk (`FA.steder`). Kan ingen fare
  komme (intet gyldigt sted, banen har den ikke, eller `cfg.farer` forbyder
  den), prøves igen om 5 s, **uden træk**.
- Ellers trækkes slags (vægtet efter banen, aldrig den samme to gange i træk,
  medmindre den er den eneste), sted og side eller last.
- **Varslet:** 3 s (180 tick aktiv tid) med kantpil og banner. Faren kan ikke
  rammes endnu. Derefter kommer den ind.

| Fare | Åben | Øer | Grotte | Fort |
|---|---|---|---|---|
| Kabelsalaten (Nullermanden i grotten) | 5 | 5 | 4 | 1 |
| Pakkedronen | 3 | 4 | 0 | 5 |
| Robotstøvsugeren | 2 | 1 | 4 | 3 |

`cfg.farer`: `null` eller udeladt (standard og ældre snapshots) er alle,
`[]` er ingen (og intet træk fra `rngSim`, så kampen er bit for bit som før
farerne), og en liste som `['kabelsalat', 'drone']` er kun de nævnte.

Pludselig død: farerne kommer med de samme regler.

## Kabelsalaten (Nullermanden i grotten)

En rullende bylt kabler. I grotten er den en kæmpe støvtot, Nullermanden: samme
fare, anden grafik (`hud: 'nullermand'`).

- **Indgang:** den blæser ind ovenfor en udstyrsplads mindst 250 wu fra alle
  kunder, under åben himmel (ikke et krav i grotten). Pladsen ligger på den
  halvdel af banen, vinden kommer fra, så den ruller hen over banen og ikke ud
  over den nærmeste kant (er der ingen plads dér, vælges blandt alle). Den
  starter 200 wu over pladsen eller 34 wu under et loft og falder ned
  (`luft`-uro).
- **Vindpilen styrer den.** På jorden ruller den mod `240 · vind`, mellem 24 og
  150 wu/s. Retningen skifter kun, når vinden er mindst 0,05. Den tager trin på
  8 wu op og 10 ned. Mod en væg preller den af og hopper. Sidder den fast i
  2,5 s, får den et vindstødshop (højst 2); så ligger den stille som et mål.
- **I vandet** flyder den og kravler i land på en lav kyst. En brændende
  Kabelsalat, der rammer vandet eller antændes, mens den flyder, er slukket
  (PSST), uden brag.
- **Levetid:** 50 s aktiv tid, så er den væk (`'traet'`). Levetiden står stille,
  mens den brænder. Den forsvinder også ud over kanten.
- **Antændes af** et brag, et projektil, der rører den (braget sker på den), en
  scanning (Stregkodescanneren) eller ild ved foden. Et klageklask slår den væk
  uden at antænde den. Papirbunken og COVID flyver igennem, og hoppende
  granater rører den ikke (men deres brag antænder).
- **Skytten sprænger sig ikke selv:** de første 8 tick rammer et skud ikke en
  fare, der ligger ved skytten. Scanningen og tvangsopdateringen har ingen
  tolerance mod en fare ved skytten (inden for samme afstand), så en
  Kabelsalat, der ruller gennem skytten, antændes kun af en stråle, der
  faktisk går gennem den.
- **Brændende** ("KORTSLUTNING!", 2 s): den ruller 1,3 gange hurtigere og
  lægger en ildplet hvert 20. tick. Så kommer **flammebraget**: radius 44,
  skade 22, skub 150, intet krater, og en ring på 5 ildpletter.

## Pakkedronen

- Kommer kun, når banen ikke er grotten, internettet ikke er nede, og der er
  plads til en våbenkasse mere. Den kommer ind fra vindsidens kant (i vindstille
  trækkes siden) med et tilfældigt kassevåben.
- Flyver 110 wu/s, 200 wu over det højeste terræn foran sig, og er væk ved
  kanten. "BONK" mod terrænet: den stiger lodret.
- **Scan den: LEVERET!** Skyttens klinik får lasten, som ved en våbenkasse.
  Dronen flyver videre uden pakke.
- **Skyd den ned:** pakken falder som en våbenkasse uden faldskærm (fejet fald,
  så den aldrig falder gennem fortets tynde lag), eller bliver til konfetti, hvis
  der ikke er plads. Dronen falder og smælder ved nedslaget: radius 38, skade 24,
  skub 180, krater og 2 ildpletter. I vandet plasker den bare.

## Robotstøvsugeren

- Vågner på en udstyrsplads mindst 300 wu fra alle kunder: på naturbaner en af
  de 3 mest neutrale, på fortet på borgene på skift.
- Kører ~52 wu/s og vender ved en væg, en skrænt på over 24 wu og en kunde.
- **Spamfilteret:** den æder banens, shitstormens og telefonspammens miner
  (dem uden ejer), højst 2. **Aldrig spillernes egne miner.**
- **Antændes** som Kabelsalaten: så er den overophedet i 1,5 s, og batteriet
  springer: radius 50 + 12 og skade 30 + 15 pr. spist mine, skub 220, krater og
  3 ildpletter.
- **Tvangsopdateringen** sætter den på pause i 5 s. Klasket vender den.
- I vandet kortslutter den (intet brag). Levetid 60 s aktiv tid.

## Ild

- En plet ligger på et gitter på 24 wu, altid på jorden under stedet (i grotten
  aldrig på loftet). Den brænder 4-4,75 s (240 + 15·(id % 4) tick).
- **Spredning:** efter 0,75 s tænder pletten én celle i vindens retning (begge
  veje i vindstille, under 0,15). Højst 2 generationer. Kun jord spreder:
  mursten og fjeld brænder, men giver ikke ilden videre.
- **Vejret:** regn og slud giver halv levetid og ingen spredning, sne ingen
  spredning.
- Ild slukkes i vandet, når jorden forsvinder under den (falder den over 40 wu),
  og når den begraves.
- **Skade:** 4 hvert halve sekund til kunder i ilden eller ved en brændende
  fare, højst 24 pr. kunde pr. tur. Ingen skub. Kraftfeltet (Hjemmearbejde)
  holder ilden ude, uden en blokering. Den aktive kunde tager ingen ildskade i
  sin tur første halve sekund: den har stået frosset gennem turstarten.
- **Antænder** farer og printere og miner: en printer får en lunte på 1,5 s, en
  mine 0,5 s. Våbenkasser, telefoner, piller og gravsten er immune.

**Rundehændelserne:** Brandøvelsen slukker al ild, før kunderne flyttes.
Shitstormen og telefonens spam lægger aldrig miner nærmere end 76 wu fra ild.
Shitstormen kan nu også ske i grotten: minerne lander på gulvet under loftet,
som mursten og Kvartalsopkrævningen gør.

## Kæden

Fire flade felter følger et brag, en skade, en ildplet, en fare og en lunte:

| Felt | Betydning |
|---|---|
| `kaedeId` | skuddets id (klyngens børn arver det). Scanner og klask: `−tick`. `null`: ingen kendt kilde |
| `kildeHold` | skyttens hold, eller `null` |
| `kildeBaever` | skyttens kunde-id, eller `null` |
| `kaede` | dybden: 0 er skuddets eget brag. Det, et brag antænder eller sætter i gang, er ét led dybere |

Ildpletter arver dybden fra det, der tændte dem. En kunde, der dør af en
kædeskade, husker kæden (`b.draebtAf`), så ligets brag er ét led dybere i den.
Loftet `KAEDE_MAKS` (5) gælder antændelser af farer og lunter fra ild.

## Tuningtabel

Alle konstanter står øverst i `static/js/sim/farer.js` og er eksporteret.

| Konstant | Værdi | Note |
|---|---|---|
| **Planlægger** | | |
| `FARE_FRA_RUNDE` | 2 | |
| `FARE_FOERSTE_S` · `FARE_PAUSE_S` | [30, 70] · [80, 160] s | aktiv tid |
| `FARE_MAKS` · `FARE_VARSEL` · `FARE_UDSAET` | 1 · 180 tick · 300 tick | udsættelsen trækker intet |
| `KS_AFSTAND` · `RS_AFSTAND` | 250 · 300 wu | pladsen fra levende kunder |
| `FARE_VAEGT` | tabellen ovenfor | 0: aldrig på den bane |
| **Uro og træf** | | |
| `FARE_LUFT_URO` | 180 tick | indgang i luften og skub; 0 ved landing og i vandet |
| `BRAND_URO_EKSTRA` | 10 tick | brand-uroen er brand + dette |
| `DR_STYRT_URO` | 240 tick | |
| `FARE_STRAALE_TOL` | 12 wu | kun scanning og tvangsopdatering mod farer, kun når strålen ingen kunde rammer, og ikke ved skytten |
| `FARE_SKYTTE_PAUSE` | 8 tick | inden for `r + BAEVER_R + 4` af skytten |
| `FARE_FRIGOER` · `FARE_FRIGOER_N` | 2 wu · 40 | begravet af Papirbunke, Kabelbakke, Byggeskum |
| **Kabelsalat** | | |
| `KS_R` · `KS_LIV` | 14 wu · 3000 tick | levetiden står stille under brand |
| `KS_VIND` · `KS_MAKS` · `KS_MIN` · `KS_TRAEG` | 240 · 150 · 24 wu/s · 0,04 | |
| `KS_RET_HYST` | 0,05 | \|vind\| herover vender rulleretningen |
| `KS_TRIN_OP` · `KS_TRIN_NED` | 8 · 10 wu | |
| `KS_TYNGDE` · `KS_FLYD` · `KS_KYST` | 0,55 · 0,5 · 8 wu | |
| `KS_VAEG_HOP` · `KS_PRELL` | vy 260 · −0,3 | ikke uro |
| `KS_STOED_VY` · `KS_STOED_VX` · `KS_STOED_MAKS` | 300 · 80 · 2 | efter `KS_FAST_TICK` 150 tick under `KS_FAST_WU` 12 wu; ikke uro |
| `KS_SKUB` · `KS_KLASK_VX` · `KS_KLASK_VY` | ×1,6 · 240 · 160 | |
| `KS_BRAND` · `KS_BRAND_FART` · `KS_DRYP` | 120 tick · ×1,3 · hvert 20. tick | |
| `KS_FLAMMEBRAG` | r 44, skade 22, skub 150, intet krater | plus `KS_RING` (5 pletter, −48…+48) |
| `KS_FALD` · `KS_LOFT_AFSTAND` · `KS_START_VX` | 200 · 34 wu · 60 wu/s | indgangen |
| **Drone** | | |
| `DR_R` · `DR_FART` · `DR_HOEJDE` | 20 wu · 110 wu/s · 200 wu | feltet hedder `hoejdeMaal` |
| `DR_OP` · `DR_NED` · `DR_LOFT` | 120 · 40 wu/s · h − 60 | gulvet er vand + 200 |
| `DR_MAAL_HVER` · `DR_PROEVER` · `DR_FREM` | 8 tick · 9 · 720 wu | |
| `DR_IND` · `DR_UD` | 60 · 80 wu uden for kanten | |
| `DR_TYNGDE` · `DR_STYRT_VX` | 480 · ×0,6 | |
| `DR_BRAG` | r 38, skade 24, skub 180, krater | plus 2 pletter |
| `DR_LIV` | 4200 tick | værn mod en drone, der aldrig når kanten |
| `PAKKE_TRIN` | 1 wu | fejet fald |
| **Støvsuger** | | |
| `RS_R` · `RS_HY` | 14 · 7 wu | kører med kundens kapsel |
| `RS_KLIPPE` · `RS_KUNDE` | 24 · 22 wu | |
| `RS_SPAM` · `RS_SPAM_R` · `RS_SPAM_SKADE` | 2 · +12 · +15 | kun miner uden ejer |
| `RS_OVERHED` · `RS_BATTERI` | 90 tick · r 50, skade 30, skub 220, krater | plus 3 pletter |
| `RS_OPDATERING` · `RS_LIV` · `RS_SKUB` | 300 · 3600 tick · ×0,8 | |
| **Ild** | | |
| `ILD_CELLE` · `ILD_MAKS` | 24 wu · 40 | |
| `ILD_LIV` · `ILD_SPRED_ALDER` · `ILD_GEN` | 240 + 15·(id % 4) · 45 · 2 | |
| `ILD_STILLE` | 0,15 | spreder sig begge veje herunder |
| `ILD_R` · `ILD_PLAC_R` · `ILD_FARE_R` · `ILD_FALD_MAKS` | 12 · 20 · 13 · 40 wu | |
| `ILD_TAKT` · `ILD_SKADE` · `ILD_LOFT` | 30 tick · 4 · 24 pr. kunde pr. tur | |
| `ILD_START_PAUSE` | 30 tick | den aktive kunde |
| `ILD_TRUER_DY` | 40 wu | |
| `ILD_LUNTE` | printer 90, mine 30 | |
| `ILD_NY_BRAND` | 80 wu | `ildTaendt` kun uden en plet så tæt på |
| `STORM_ILD_AFSTAND` | 76 wu | shitstormen og spammen |
| **Kæde** | | |
| `KAEDE_MAKS` | 5 | |

De to vigtigste håndtag for balancen er `ILD_LOFT` og `KS_FLAMMEBRAG.skade`.

## Snapshot, delta og net

- **Snapshottet** har `farer`, `ild` og `farePlan` som ren data (rigtige kopier),
  kundens `ildTur` og projektilets `kaedeId`. Ældre snapshots uden dem kan
  indlæses. Midt i en kæde er snapshottet ikke tabsfrit (eksplosionskøen,
  `forsinkede` og dødskøen er ikke med), men kun værten simulerer, og den
  genskaber aldrig. På et tick med tom kø er rundturen bit for bit
  (`test/farer_snapshot.mjs`).
- **`aftryk`** blander kun farerne og ilden ind, når listerne ikke er tomme, så
  en kamp uden farer har præcis det gamle aftryk.
- **Deltaen** sender `fa`, `il` og `h.fv` **altid**, også tomme eller `null`,
  så den sidste fare og kantpilen forsvinder på spejlet.
- Hændelserne står i `VIDERESEND` (`sim/worker.js`). Serveren ændres ikke.
- Gæster ser verden ~80 ms bagud. Derfor rammer scanning og tvangsopdatering
  en fare 12 wu bredere. Projektiler har ingen tolerance. Den præcise stråle
  kommer først: rammer den en kunde før en fare, får kunden skuddet, også når
  en fare ligger lige bag kunden. Tolerancen gælder kun, når strålen ingen
  kunde rammer.

## Testene

`node --no-warnings --test test/farer_*.mjs` (ca. 45 s). Se `test/README.md`.
Referencesporet til `farer_determinisme.mjs` optages igen med
`node --no-warnings test/farer_lav_spor.mjs`, når banegeneratoren eller andet uden for
farerne ændrer kampene med vilje (tjek først med `--tjek`). Under testløberen
(`node --test`) gør filen intet: ellers optog den sporet igen ved hver kørsel,
og en afvigelse blev "referencen".

Samspillet med vejledningen og tålmodighedsbjælken (ventetiden, første tur,
ildskaden i bjælken, deltaen og snapshottet, pilen og lydkanalen) står i
`test/samspil.mjs` og `test/samspil_lyd.mjs`.

---

## Til del 2: grænsefladen

Alt herunder er det, simulationen lover brugerfladen, grafikken, lyden og
kameraet. Simulationen tegner og spiller intet selv.

### Spejlet: `v.farer`, `v.ild` og `v.farePlan.varsel`

Hovedtrådens spejl får farerne på to måder: fulde objekter fra snapshottet ved
hvert turskift (`genskab`) og deltaens felter mellem dem. Objekterne genbruges
pr. `id` (som projektilerne), så en interpolationshistorik (`hist`) bevares,
men **brug kun felterne i tabellerne**: de øvrige simulationsfelter fra et
snapshot bliver stående uopdaterede. Slå farerne op på `id` hver frame, og hold
aldrig på objekterne: snapshottet udskifter dem.

**`v.farer[i]`**

| Felt | Type | Betydning |
|---|---|---|
| `id` | tal | unikt i kampen |
| `type` | `'fare'` | |
| `slags` | `'kabelsalat'` · `'drone'` · `'stoevsuger'` | simulationens slags (Nullermanden er `'kabelsalat'`) |
| `hud` | `'kabelsalat'` · `'nullermand'` · `'pakkedrone'` · `'robotstoevsuger'` | grafikkens navn: `static/grafik/objekter/<hud>.webp` |
| `x`, `y` | wu | **fodpunktet** (bunden af træfcirklen). Uden `hist` sættes de direkte fra deltaen; med `hist` interpolerer `net/client.js` dem fra `maalX`/`maalY` |
| `maalX`, `maalY` | wu | deltaens position (1/8 wu), til interpolationen. Simulationen har ingen felter med de navne (dronens flyvehøjde hedder `hoejdeMaal`) |
| `r`, `hy` | wu | træfcirklen har midte `(x, y + hy)` og radius `r` (Kabelsalat 14/15, drone 20/21, støvsuger 14/7) |
| `tilst` | `'jord'` · `'luft'` · `'vand'` · `'flyv'` · `'styrt'` · `'koer'` · `'pause'` | Kabelsalaten: jord, luft, vand. Dronen: flyv, styrt. Støvsugeren: koer, pause (tvangsopdateret), luft |
| `ret` | 1 · −1 | rulle-, flyve- eller køreretningen |
| `brand` | tick | tilbage af branden (Kabelsalat) eller overophedningen (støvsuger); 0 = ingen |
| `styrt` | tick | dronen er skudt ned og falder; 0 = ellers |
| `pakke` | sand/`null` | dronen har stadig pakken under sig |
| `spam` | 0-2 | miner, støvsugeren har spist (batteriet bliver større) |

Tegneregler, der følger af simulationen: rotationen af Kabelsalaten og
Nullermanden regnes af koden (ingen bagt rotation), fx vinkel `−x / r` rad, og
kun når `tilst === 'jord'`. `brand > 0` er `aktiv`-løkken (brænder,
overophedet), `styrt > 0` er dronens `aktiv` (ramt). `tilst === 'luft'` eller
`'styrt'` er `fald`. `land` er skiftet fra `'luft'` til `'jord'`/`'koer'`, som
brugerfladen selv ser.

**`v.ild[i]`**

| Felt | Type | Betydning |
|---|---|---|
| `id` | tal | |
| `x`, `y` | wu, heltal | pletten står på jorden: `y` er pixlen lige over jordoverfladen, `x` er cellens midte (gitter på 24 wu) |
| `rest` | tick | ca. tilbage (i trin på 16). **Læs det med `FA.ildRest(v, p)`**: efter et snapshot har pletten `alder` og `liv` i stedet |

**`v.farePlan.varsel`**: `null` eller `{ slags, hud, x, y, ret, rest }`. `x, y` er
stedet, faren kommer ind (Kabelsalatens og støvsugerens plads, dronens
indgang uden for kanten ved x −60 eller w + 60 og dens flyvehøjde), `rest` er
tick tilbage af varslet (fra 180). Kantpilen læser det hver frame.

Den fulde simulationstilstand (`luft`, `uro`, `alder`, `liv`, `hoejdeMaal`,
`ramt`, `kaede` osv.) findes kun hos værten.

### Hændelserne

Alle står i `VIDERESEND` og er ren data. Positioner er i wu. Felterne
`kaede`, `kaedeId`, `kildeHold` og `kildeBaever` kaldes herunder **kæden**.

| Hændelse | Felter | Hvornår |
|---|---|---|
| `fareVarsel` | `slags, hud, x, y, ret, rest` | et varsel begynder (3 s før faren kommer) |
| `fareKommer` | `id, slags, hud, x, y, ret, pakke` | faren er på banen. `pakke` er dronens våben-id, ellers `null` |
| `fareAntaendt` | `id, slags, hud, x, y, aarsag`, kæden | Kabelsalaten brænder ("KORTSLUTNING!"), eller støvsugeren er overophedet. `aarsag`: `'eksplosion'` · `'straale'` · `'ild'` |
| `fareAntaendt` (dronen) | som ovenfor plus `nedskudt: true, kasse, konfetti` | dronen er skudt ned. `kasse` er id'et på pakken, der falder (se `kasseFalder`), eller `null`; `konfetti: true`, når der ikke var plads til en kasse |
| `fareLeveret` | `id, x, y, hold, baever, vaaben, antal` | LEVERET!: skyttens klinik fik lasten. Kommer lige efter `ammoAendret` |
| `fareSpiste` | `id, mine, x, y, spam` | støvsugeren åd minen `mine` (NOM). `spam` er antallet nu |
| `fareOpdateres` | `id, x, y, fra, tick` | tvangsopdateret: pause i `tick` (300). `fra` er skyttens kunde-id |
| `fareVaek` | `id, slags, hud, x, y, grund` | faren er væk. `grund`: `'brag'` (flammebraget, batteriet), `'styrt'` (dronens nedslag), `'slukket'` (vand, eller vagthunden), `'kortsluttet'` (støvsugeren i vandet), `'vand'` (dronen plasker), `'traet'` (levetiden er gået), `'kant'` |
| `ildTaendt` | `id, x, y`, kæden | en ny brand: kun når der ikke brænder en plet inden for 80 wu (ikke for hver plet) |
| `kasseFalder` | `id, x, y, slags: 'vaaben', fald: true` | den nedskudte drones pakke. `fald`: ingen faldskærm ("Pakken falder!"); kassen har også `k.fald` på spejlet (deltaens 6. kolonne) |
| `eksplosion` | `x, y, radius`, kæden, `fare` | som før. Kæden er med, når braget har en kilde. `fare` (`'kabelsalat'` · `'drone'` · `'stoevsuger'`) er med ved flammebraget, dronens nedslag og batteriet |
| `skade` | `baever, skade, aarsag, x, y`, kæden, `drab` | som før. `aarsag: 'ild'` for ildskade. `drab: true`, når kunden døde af den |
| `printerSprang` | `x, y`, kæden | en printer sprang, også når ilden tændte lunten |
| `straale` | som før plus `fare` | scanningen eller tvangsopdateringen ramte faren `fare` (id) |
| `klask` | som før plus `farer` | id'erne på de farer, klasket ramte (altid en liste) |
| `tvungenRo` | | som før; brændende og styrtende farer får `fareVaek` `'slukket'` lige før |

Kæden er med på `eksplosion` og `skade`, når braget har en kilde: skuddets
brag (dybde 0), alt, et brag sætter i gang (dybde + 1), farernes brag og
ildskade. `kaedeId: null` betyder, at der ikke er nogen kendt skytte (fx
printerhændelsen, stenskredet).

**KÆDE ×n!** er et `eksplosion` med `kaede >= 2`.

**SYGT PLAY** (én gang pr. `kaedeId`, reglen fra designet): kæden har
`kildeHold != null`, og dens led fra dybde 1 og ned (`skade` med `kaede >= 1`
og samme `kaedeId`) har skadet mindst 2 forskellige fjender af `kildeHold`,
eller dræbt én. Et drab er en `skade` med `drab`, eller en `drukner` eller et
`doedsfald` i samme tur for en fjende, som kæden har skadet (drukning og fald
ud giver aldrig `skade`). Banneret navngiver `kildeBaever`.

### Hvad del 2 skal koble på (fra designet)

- `net/client.js`: `verden.farer` med i historikken, i nulstillingen ved et
  snapshot og i `placer`, som kunderne og projektilerne.
- Grafikken: `objektMesh` og `animer` med de leverede atlas (fodlinjen y = 118
  i hver celle står på fodpunktet `y`), ild i laget under fx, dronen under
  projektilerne, og `braendt_graes.png` der, hvor ild har brændt.
- `render/fx.js`: ingen faldskærm ved `k.fald`; en printer ryger, når
  `p.lunte > 0` (spejlets `placerede` har `lunte` fra deltaen).
- `main.js`: "Pakken falder!" ved `kasseFalder` med `fald`, ingen lyd for
  `skade` med `aarsag: 'ild'` og repliken kun ved kundens første ildskade i
  turen, `skudRamte` kun ved skyttens egen kæde, og i `SPILLER_AKTIV` kun
  `kamera.rystelse` ved `eksplosion` med `kaede >= 1`.
- Lyden gennem den fælles kanal: varslet og `fareLeveret` på normal kanal
  (ikke `vigtig`), brag med `forrang` som i dag.

### Sådan blev det koblet på (`ui/farer.js`, `render/fare_view.js`)

- **Én frame, to trin.** `main.js` kalder `fareUi.opdater(v, false)` før HUD'en
  (lyden, glimtet og pilens og skiltets mål: kun læsninger af vinduet,
  `tilSkaerm` og hindringerne) og `fareUi.skriv()` lige efter `hud.opdater`
  (kun skrivninger, kun ændringer). Så kommer ingen layoutlæsning efter en
  skrivning i samme frame, som `hud.js` selv sørger for. `opdater(v)` uden
  flaget gør begge dele.
- **Kantpilen går uden om HUD'ens faste felter** over den (`hindringer`):
  holdlisten, arsenalets håndtag og vejledningens kort. Står pilen i kanten
  under et af dem, trækkes den ind langs linjen mod faren til feltets rand
  (med pilens luft, 44 px · `--ui`). En fare, der er i billedet men gemt under
  et felt, får en pil i stedet for navneskiltet. Skjulte felter (`.hide`,
  `.skjult`) og tomme tæller ikke.
- **Ildens knitren** er en løkke: den tier, mens kanalen er optaget, og mens et
  skud suser eller en kunde borer. Slukkes den, mens kanalen er optaget, toner
  den ud på 40 ms, og kommer en lyd, mens den toner ud, tager lyden halen
  (`ui/lyd.js`), så den aldrig klinger under bjælkens tik.
