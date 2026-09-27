# Kundekrigen

Worms-lignende artillerispil, hvor **sure kunder** fra lægeklinikkerne går til
angreb på hinanden med klinikkens IT: tonerkanoner, datalæk-bomber,
integrations-infernoer, phishing-miner og kvartalsopkrævninger. Designet med primær #10546B,
Poppins og et radialt farveforløb. Handlingsfarven #FF7A2F (med mørk tekst)
bruges kun til skærmens hovedknap; alternativer er halvgennemsigtige, og
tilbage/annullér har kun en kant (`static/app.css`, `--kk-handling`).

Kun Pythons standardbibliotek på serveren: `http.server`, `socket`, `threading`.
Ingen pakker skal installeres. Klienten er vanilla ES-moduler uden byggetrin;
Three.js ligger vendoret i `static/vendor/`.

> Mappen hedder stadig `baevere/`, og en del INTERNE kodenavne (fx
> `verden.baevere`, `BAEVER_R`, våben-id'er som `grenroer`) er fra spillets
> første tema. De indgår i netværksprotokollen og gemte profiler, så de er
> bevidst ikke omdøbt — alt, der kan ses, er "Kundekrigen".

## Kør

```bash
cd baevere && python3 app.py
```

Serveren skriver selv sit LAN-link ud ved opstart. Kolleger på samme netværk
åbner det link; alle andre bruger `http://localhost:8788`.

Første gang spørger macOS, om Python må tage imod indgående forbindelser —
det er fordi serveren lytter på hele netværket og ikke kun på maskinen selv.
Svar **Tillad**, ellers kan kollegerne ikke nå den.

### Online: fast adresse på Render.com

Repoet indeholder `render.yaml`, så Render kan opsætte alt selv:

1. Læg mappen i et (privat) GitHub-repo.
2. På [render.com](https://render.com): **New → Blueprint** → vælg repoet →
   **Apply**. Render læser `render.yaml`: gratis plan, Python 3.12, start
   med `python3 app.py`, sundhedstjek på `/api/status`, og `BAG_PROXY=1`.
3. Efter et par minutter står spillet på `https://kundekrigen-XXXX.onrender.com`.
   Rumlinks (`…/spil/KODE`) virker direkte, og forbindelsen går over `wss://`.

Godt at vide:

- **Ingen adgangskode** (bevidst valgt): alle med linket kan oprette rum.
  Serveren har lofter på antal rum (20), deltagere (12 pr. rum) og
  tilslutningsforsøg (10 pr. minut pr. klient).
- **`BAG_PROXY=1`** får serveren til at bruge klientens rigtige IP fra
  `X-Forwarded-For`. Uden den ville alle spillere dele proxyens IP, og loftet
  på tilslutningsforsøg ramte alle på én gang. Sæt den KUN bag en proxy.
- **Gratis-planen falder i søvn** efter ~15 minutter uden besøg; første besøg
  derefter tager op til et minut. Rum overlever ikke en genstart — serveren
  gemmer intet.
- En ny version rulles ud automatisk, hver gang der pushes til repoet.

### På jeres eget netværk (uden internet)

1. Start serveren (`python3 app.py`) på en maskine, der er tændt, mens I spiller.
2. Serveren printer ét link pr. netværk, maskinen er på (fx både kabel og
   Wi-Fi). Del det, der hører til **kollegernes** netværk:
   `http://<ip>:8788`. Tryk "Vær vært" og del rummets link
   (`http://<ip>:8788/spil/KODE`) — det lukker folk direkte ind i lobbyen.
3. Alle, der er med, trykker **Klar**; værten trykker **Start kampen**.

IP-adressen kan skifte, når maskinen får ny adresse af netværket. Skal linket
være stabilt, så kør serveren på en fast intern maskine eller server med fast
IP/DNS-navn — det kræver kun Python 3, ingen installation.

## Sådan spilles det

Spillet kan spilles **udelukkende på tastatur**. Kernen er våbenbjælken
nederst med ti pladser (`1`–`0`): ét tastetryk vælger våben. Resten af
arsenalet ligger i skuffen **Flere våben** i venstre side (`Tab`). Musen kan
også bruges: klik på en plads i bjælken, på håndtaget eller i skuffen.

| Tast | Handling |
|---|---|
| `←` `→` | Gå |
| `↑` `↓` | Sigt (accelererer efter 0,4 s) — et sigtekorn viser retningen |
| `Shift` + `↑``↓` | Finsigte |
| `Mellemrum` (hold) | Lad kraften op — slip for at affyre |
| `Enter` | Hop · `Backspace` baglæns saltomortale |
| `1`–`9` `0` | Vælg våben 1–10 fra våbenbjælken |
| `?` eller `F1` | Hele tastaturet på ét skærmbillede |
| `Tab` / **Flere våben** | Hele arsenalet i en skuffe fra venstre (tururet står stille, maks 5 s pr. tur); `Esc` eller `Tab` lukker |
| `Shift` + `1`–`0` | I skuffen: læg det markerede våben på den plads på bjælken |
| `Q` / `E` | Forrige/næste våben på bjælken |
| `F` / `Shift+F` | Lunte 1–5 s |
| `T` / `Shift+T` | Spring markør til næste/forrige fjende |
| `W` `A` `S` `D` | Panorér kamera · `C` centrér · `Z`/`X` zoom |
| `H` (hold) | Kig over hele banen |
| `K` | Sæt på hold (stå over) · `Esc` pause · `F3` fejlfindingsoverlay |

**Sigtet** er som i Worms kun et sigtekorn i sigteretningen plus kraftbuen om
kunden — hvor skuddet lander, må man selv vurdere ud fra kraft, vind og vejr.
Den fulde banekurve (med vind og vejr indregnet) kan slås til under
Indstillinger → Sigte som sigtehjælp; den er slået fra som standard, fordi den
afslører nedslaget.

## Arsenalet

Femten våben plus to meta-valg, datadrevet i `static/js/sim/weapons.js`. Alle
våben har begrænset ammunition pr. klinik; mere kommer fra forsyningskasserne
(se nedenfor). Modellerne er flade tegninger i Kenney-pakkernes formsprog
(`kunst.HAANDVAABEN`); det, man kaster, er det, man holdt i hånden.

**Proportioner:** hver tings størrelse står ét sted, `kunst.VAABEN_STR`, målt
på tegningens faktiske indhold (største side i wu). Figuren er ~46 wu høj, så
1 wu er ~4 cm og en hånd ~6 wu; tingene er overdrevet 1,3–2 gange i forhold til
virkeligheden, så de kan læses, men står i forhold til figuren og hinanden
(scanner 12, tastatur 13, bombe ~19, tonerkanon 27). Samme tal bruges i hånden,
som projektil og udlagt på banen. Små ting gribes om den nederste del og
tegnes foran fingrene; sigtevåben sidder i hånden og drejes med sigtet.

| Våben | Gruppe | Start | Hvad det gør |
|---|---|---|---|
| Tonerkanon | Skyts | 8 | Skyder tonerpatroner, buer med vinden — arbejdshesten |
| Stregkodescanner | Skyts | 2 | Øjeblikkelig stråle til det, den faktisk rammer: 34 skade og et ordentligt skub. To scanninger pr. ammo; turen slutter efter den anden |
| Tvangsopdatering | Skyts | 1 | Kort stråle (150 wu). Rammer den en fjende, står den og opdaterer og springer sin næste tur over. Ingen skade |
| Datalæk-bomben | Kast | 3 | Stor bombe med lunte (`F`). Hopper, ignorerer vinden og giver et stort brag: 55 skade i 74 wu |
| Integrations inferno | Kast | 1 | Springer i fem løse taster ved detonation |
| Klageklask | Nærkamp | 3 | Et klask med ringbindet efter et kort sving: 50 skade og et hårdt skub. Én gang pr. tur |
| Phishing-mine | Udstyr | 2 | Ligner en mail. Armeres efter 5 s (minen tæller ned), så du kan nå væk; derefter udløses den af alle, der kommer for tæt på |
| Hjemmearbejde | Udstyr | 1 | Kunden arbejder hjemme: al skade og alle skub preller af, til klinikkens næste tur. Turen fortsætter. Beskytter ikke mod vand, at falde ud af banen eller pludselig død |
| Systemnedbrud | Udstyr | 1 | Et langsomt bor, man styrer med pilene. Starter lige ned; tryk `Mellemrum` igen for at stoppe. Borer aldrig ned i vandet |
| Fjernsupport | Udstyr | 1 | Teleport, én gang pr. kamp — kommer aldrig i kasserne. Er der ikke plads, afvises den, og man beholder både skuddet og turen |
| Papirbunke | Terræn | 2 | Kastes og bliver liggende som en bakke — dækning, bro eller fyld i et krater |
| Kabelbakke | Terræn | 1 | Rampe skråt op foran kunden; turen fortsætter, så man kan gå op og skyde |
| Byggeskum | Terræn | 1 | Sprøjter en klump skum, hvor man peger (op til 360 wu væk); turen fortsætter |
| Kvartalsopkrævning | Special | 0 | Kun fra kasser. Otte fakturaer regner ned over målet — vælg mål og retning |
| COVID | Special | 0 | Kun fra kasser. En virus, der smitter alle inden for 70 wu. De smittede mister 6 tålmodighed ved hvert turskift og smitter dem, der står tæt på (60 wu). Smitten går over efter tre turskift |
| Sæt på hold · Opsig aftalen | Andet | ∞ | Stå over · overgiv |

**Bjælken og skuffen.** Standardbjælken er Tonerkanon, Datalæk-bomben,
Integrations inferno, Stregkodescanner, Tvangsopdatering, Phishing-mine,
Klageklask, Hjemmearbejde, Systemnedbrud og Fjernsupport. Alt andet ligger i
skuffen **Flere våben** (grupperet i Skyts, Kast, Nærkamp, Udstyr, Terræn,
Special og Andet); tælleren på håndtaget viser, hvor mange brugbare våben
der ligger derinde. Våben uden ammo er låst og siger "Fås i
forsyningskasser". `Shift` + tal i skuffen lægger det markerede våben på
bjælken; valget gemmes i profilen. Ældre profiler med tolv pladser (og det
fjernede Serverrack) rettes automatisk ved indlæsning, uden at kunderne
røres.

**Forsyningskasser.** Mellem turene er der 45 % chance for, at en kasse daler
ned i faldskærm et tilfældigt sted over land: 55 % en supportpakke med våben
(vægtet lodtrækning; de sjældne specialvåben kommer kun herfra, Fjernsupport
aldrig), 25 % en telefon og 20 % piller. Den, der går hen til kassen, får
indholdet til sin klinik. Telefonens "forstærkning" trækker fra samme pulje.

**Status på kunderne** vises både på figuren og som små ikoner i holdlisten:
skjold (Hjemmearbejde), "Opdaterer…" (Tvangsopdatering: næste tur springes
over) og virus (COVID).

Holdene er klinikker. De to første har fast personale (`static/js/core/
klinikker.js`, spejlet i `rum.py`):

| Klinik | Sekretær | Sygeplejerske | Speciallæge |
|---|---|---|---|
| **Klinik Højhaven** (grøn) | Skrankepaven Ingrid — direkte/hård | Bente "Bare Rolig" Hansen — overbeskyttende | Hansen, Dr. Hansen — arrogant |
| **Speciallægeselskabet Mogensen** (blå) | Praktikant Trine — passiv-aggressiv | Systemsygeplejerske 2.0 — koldt klinisk | Dr. Jan fra Mors — nervøs |

Personalet sidder på klinikkens første tre pladser med eget navn og egen
figur og er faste roller: profilens kunder skifter ikke deres udseende
(navngiv ignoreres for `udseende.fast`). Klinik Rød og Klinik Gul og ekstra
pladser får almindelige kunder med navne som Klinik-Karen og Overlæge Ole;
i hotseat fylder profilens egne kunder netop de pladser. Kasser og
hændelser bruger "Survival Props"-pakken: **rygsækken** er en supportpakke
med et våben, **pilleglasset** giver tålmodighed (liv) tilbage, og
**svævepillen** giver lav tyngde. Hændelsen "mursten falder fra loftet"
kaster pakkens mursten.

## Hvad virker

- **Lokalt spil (hotseat)** — fuldt spilbart. Serveren er ikke involveret efter
  at siden er indlæst: ingen HTTP-kald, ingen WebSocket.
- **Turmaskine** — 45 s pr. tur (kan sættes til 15-60 i lobbyen), tilbagetog efter skud, 30 minutters kamp,
  derefter pludselig død hvor vandet stiger hver tur.
- **Destruktibelt terræn** — pixelmaske på 5120×1792, procedurelt genereret i
  fire banetyper (fort, åbent land, hulesystem, øer). Højdekurven terrasseres og
  glattes, så banerne har store flader at kæmpe på frem for konstante skrænter.
- **Fortet er standardbanen** — som Worms' fort-tilstand: hver klinik har sin
  egen store, mest massive borg af murværk (`MUR`: destruktibelt som jord) over
  åbent hav. Der er intet land imellem, og havet er så bredt, at ingen kan
  hoppe over; falder man i, drukner man. Borgen har én etage pr. kunde — 2v2
  giver to, 3v3 tre, højst fire (de ekstra kunder står side om side nederst) —
  med kundernes rum i det høje fortårn mod fjenden: en rund bue og et
  skydeskår over en brystning på 48 wu, så et lige skud fra fjendens
  tilsvarende etage aldrig når kunden, mens man selv kan skyde ud i en bue.
  Etagerne er forbundet af trappeløb, der går som tunneler i murværket op mod
  bagsiden (oppe hopper man over hullet i dækket ud mod facaden); fra taget
  når man udkigskammeret i fortårnet og keepens top. Siluetten trappes ned
  væk fra fjenden og varierer med frøet: keep med kronetårn, porttårn,
  vagttårn, tinder, hvælvede haller og gange med vinduer, buer man ser himlen
  igennem, havbuer under bagdelen, anneks, altaner og gesimser. To klinikker
  står facade mod facade, fire parvis, og med tre er midterborgen
  dobbeltsidet. Borgene er spejlede og ens, også udstyret på dem. Layoutet
  (antal klinikker, kunder pr. klinik) følger med i snapshottet, så gæsterne
  bygger præcis de samme borge (`terrain_gen.fortPlan`).
- **Hav i bunden.** Vandlinjen ligger på 300 wu fra kampens start, og et antal
  brede kanaler skæres GARANTERET ned gennem den, så banen deles i landmasser
  med rigtigt vand imellem. Falder man i, drukner man. Støjbaserede kanaler
  alene var ikke til at stole på — på mange frø gav de slet ingen vand.
- **Banen er udstyret fra start** — miner (armeret fra start), sprængtønder
  og forsyningskasser.
  Tønderne har hverken lunte eller nærhedsudløser: de detonerer kun, når de
  fanges af en anden eksplosion, og er derfor ren kædereaktion.
- **Tilfældige hændelser** mellem ture: stenskred, uvejr der vender vinden, og
  forsyningsnedkast. De udløses fra `rngSim`, så alle klienter ser det samme.
- **Femten våben** i syv arketyper, datadrevet i `static/js/sim/weapons.js`,
  med begrænset ammo og forsyningskasser, der rent faktisk falder ned.
- **2–4 klinikker, op til 12 kunder**, fleksibelt ejerskab: en deltager kan styre
  én kunde eller hele klinikken.
- **Vind og vejr med rigtig fysik** — vejret skalerer vinden, sender
  vindstød og bremser vindfølsomme skud (se afsnittet om vejrfysik).
- **Tilpasning** — navn, hudfarve, frisure, hårfarve, ansigt, bukser og sko.
  Gemmes i `localStorage`; en ny browser får automatisk et spilbart hold, som
  gemmes med det samme, så navnene ikke skifter ved hver genindlæsning.
- **Indbygget kontrolvejledning** — en permanent tastebjælke nederst, en kort
  boble-intro på ens allerførste tur, og hele tastaturet på `?`.
- **Sigtehjælp (valgfri)** — den forudsagte banekurve tegnes med samme
  konstanter som fysikken, så den også viser, hvad vinden gør ved skuddet. Skudstyrken vises
  tre steder på én gang: kurvens længde, en kraftbue om kunden, og farven,
  der varmer mod rødt.
- **Våbenikoner** — hvert våben har sit eget ikon i våbenbjælken og skuffen.
- **Netværkslobby** — rum, femtegns-koder, delelink, sæder, klar-flag,
  vagthund, gentilslutning. Protokollen er verificeret (se Verifikation).

## Grafikken: kunderne er tegneseriefigurer

Kunderne er 22 tegneseriefigurer, brugeren har lavet (Assets/Cartoon
Characters, bygget på rgsdev's Cartoon Character Generator), alle 45-55 år
i kontor- og lægehustøj:

- **1-16, almindelige kunder** (`Kundekrigen v2`): Kontorkunden,
  Mellemlederen, Jakkemanden, Punkeren, Lægen, Mandagskunden, Surfer-Søren,
  Kaffe-Kurt, Skrankedamen, Receptionisten, Sygeplejersken, IT-supporteren,
  Influenceren, IT-Nina, Hypokonderen og Klagedronningen. Kun de trækkes
  tilfældigt (`ALMINDELIGE` i figur_view.js).
- **17-22, klinikpersonalet** (`Kundekrigen klinikker`): se tabellen ovenfor.
  De kan også vælges som kundetype i editoren.

Effekter og genstande kommer fra Kenney.nl's "Tanks", lyde fra "New
Platformer Pack".

- **`vaerktoej/tegneseriekunder.py`** (kræver Pillow og NumPy) pakker hver
  kundes 20 kropsframes ("No hands") i ét WebP-atlas med fælles udsnit og
  fodpunkt, finder hudfarven og klipper en ren knytnæve ud, og måler de to
  hænders plads i hver frame. Figurerne har bare hænder (næven er den
  smalleste hånd, også Systemsygeplejerskens blå handske); ældre kilder med
  sværd og pistol virker stadig, og våbnet kasseres — kunderne holder
  spillets IT-våben. Ud: `static/grafik/tegneserie/` og
  `static/js/render/tegneserie_rig.js` (genereret — ret ikke i hånden).
- **Genstandene som tegneseriemodeller** (Assets/Cartoon Characters/Kundekrigen
  objekter, tegnet af dens `_vaerktoej/objekter.py` i figurernes stil):
  værktøjskasse, pilleglas, svævepille, phishing-mine, printer,
  tvangsopdatering, bordtelefon, faldskærm, gravsten og eksplosion. Hver
  har 20 frames i samme fordeling som figurerne — idle_0-3, aktiv_0-3,
  fald_0-1, land_0-2, udloes_0-2, doed_0-3 — og eksplosionen er én serie på
  20. `vaerktoej/tegneserieobjekter.py` pakker dem i `static/grafik/objekter/`
  og skriver `render/objekt_rig.js`; `render/objekt_view.js` giver quads med
  fodpunkt og `animer(mesh, tilstand, t)`. Eksplosionen (`fx.js` eksAnim)
  bruger dem allerede. **Mangler:** genstandene på banen i `lavGenstandView`
  (mail/printer/opdatering/telefon/piller/kasser/faldskærm/gravsten) skal
  skiftes til `objektMesh(navn, bredde)` + `animer()` — ringe, skilte og
  minetal beholdes. Forslag til bredder i wu: værktøjskasse 34, pilleglas 17,
  svævepille 22, phishing-mine 30, printer 34, tvangsopdatering 26,
  bordtelefon 30, faldskærm 56 (fodpunkt på kassens top), gravsten 24.
- **Animationen** (`figur_view.js`) er figurernes egne frames: tomgang
  (5 fps), løb (11 fps), hop og fald, gravearbejde (angreb), jubel og døden.
  Hænderne er løse: begge følger framens håndpositioner, og når kunden
  sigter, drejer den forreste om brystet og holder våbnet.
- **Holdet** ses på navneskiltet (som i Worms) — figurerne har faste outfits.
- **Navnene** er titler og ordspil (Anders Endetarm, Hanne Lin, Lægevikar
  Lars …) og deles af profilen, det lokale spil og serveren.
- **Skulderen** (hvor skuddet udgår i `behaviours.mundingsPunkt`) sidder
  15 wu over fodpunktet og 7 wu foran kroppens midte, som i figuren.
- **Farverum**: alle lærred-teksturer på MeshBasicMaterial markeres
  `SRGBColorSpace`, ellers lysner renderen dem.
- **Projektiler, miner, tønder og kasser** (`fx.js`) er tank-pakkens sprites;
  raketter skifter til udgaven med flamme, mens de flyver, og minens røde
  lampe blinker. Eksplosionen er pakkens 12-billeders serie skaleret til
  radius, plus jordstumper, gnister og et tegneserieord ved store brag.
  Gravsten, faldskærm, dynamit, sten og bazookaen tegnes i kode
  (`kunst.js`) — men i pakkens EGET flade formsprog (ingen konturer, flade
  farvefelter), så de ikke stikker ud fra sprite-grafikken.
- **Baggrundene** (`parallax.js`) er en dedikeret parallaksepakke
  (static/grafik/parallax/, leveret som løse lag med alfakanal): skybanke,
  drivende skylag, to bakkekamme, buske og to trærækker — ni billedlag plus
  to tågebånd, hver med sin egen faktor, oven på vores egen vejrstyrede
  himmel. Skylagene driver vandret med egen fart (uDrift i shaderen), og
  gråvejr trækker stadig alle lag mod en kold dis.
- **Terrænet** er stadig det håndtegnede, destruktible pixellandskab med græs
  og begravede ting — det er banen, ikke baggrunden.
- **Menuen** (`menu_kunst.js`) males ved opstart af de samme dele: landskab
  plus én figur fra hvert hold.

Kampvognene fra forrige runde er væk igen (for statiske); tank-pakken
leverer stadig våbeneffekter og genstande. Blender-værktøjet ligger stadig i
`vaerktoej/blender/`, men spillet bruger det ikke.

## Lyd

Tre kilder, alle i `static/lyd/`:

- **Kontorlydene** (`k_<gruppe>_<n>.ogg`) fra "400 Sounds Pack": fodtrin på
  kontortæppe, papir, papkasser, klask og slag, hoste, en barbermaskine som
  bor, ure, synth-bip og et dommerfløjt. De afløser de gamle 8-bit-effekter
  og bygges af `vaerktoej/kontorlyde.py` (stilhed klippes, niveauet måles og
  afstemmes gruppe for gruppe, mono Ogg). Hver hændelse har en gruppe med én
  eller flere varianter; `afspil('fodtrin')` vælger en tilfældig og aldrig den
  samme to gange i træk, og gruppens egen lydstyrke (`GRUPPE_VOL`) sørger for,
  at de sidder godt sammen.
- **Kundernes stemmer og våbenlyde** (`stemme_*`) er brugerens egne
  optagelser, klippet af `vaerktoej/kundelyde.py`.
- **Eksplosionerne og baggrunden** (`brag`, `nedslag`, `ambience`) er fra
  Kenney.nl (CC0).

Motoren (`ui/lyd.js`) er WebAudio med ÉN fælles kanal for korte lyde: spiller
der noget, springes en ny lyd over — de må aldrig overlappe. Undtagelser:
`vigtig` (døden, nedtællingen, sejren) venter i en lille kø, og `forrang`
(eksplosionerne) tager kanalen fra det, der spiller, med en fade på 40 ms —
ellers overdøvede affyringslyden nedslaget. Lyde i rummet (eksplosioner,
telefonen, minernes bip, boret) får lydstyrke og stereo efter afstanden til
kameraet eller den aktive kunde; telefonen justeres løbende, mens den ringer.
Musik, ambience og løkker ligger uden for kanalen. Præsentationen abonnerer på
simulationens hændelser; simulationen ved ikke, at lyden findes.

Browsere kræver en brugerhandling, før lyd må starte. Lytteren sidder hele
besøget på alle input, der giver lov (et touch-tryk giver det først ved
slip, Cmd/Esc aldrig), og menumusikken startes inde i selve klikket. Indtil da
er alle kald lydløse. Mastervolumen sidder under Indstillinger og gemmes i
profilen. Sidegevinst: en kørende AudioContext undtager værtens fane fra
Chromes hårde throttling.

## Træfzone og fuldtræffere

Figurerne har en TRÆFZONE, adskilt fra bevægelseskapslen: kapslen er 30 wu og
lav med vilje (så man kan gå ind under udhæng), men figuren er ~46 wu høj, og
en raket gennem hovedet skal tælle. Zonen er en lodret kapsel om kroppen
(`HITBOX` og `afstandTilHitbox` i `sim/entities.js`), og den bruges ens af
raketter, stregkodescannerens stråle og eksplosionernes skadesfald.

- **Fuldtræffer**: rammer et projektil selve figuren, får den FULD skade gange
  1,3 (Tonerkanon: 62) — mod 36 for et brag 15 wu ved siden af og 15 for et brag
  40 wu væk. Skærmen viser "FULDTRÆFFER!", rystelsen er ekstra hård, og der
  lyder et knald. Stregkodescannerens træffere tæller også som fuldtræffere.
- **Skadesfald** måles til nærmeste punkt i zonen, ikke til hoftehøjde — et
  brag ved hovedet rammer lige så hårdt som et ved fødderne.
- **Bomber og tastaturer preller af** figurerne som af en væg.
- Skuddet udgår nu fra SKULDEREN (30 wu), hvor figuren bærer våbnet, så
  projektil, sigtelinje og bazooka passer sammen.

## Våbnene i hånden

Hvert våben har sin egen model i figurens hænder (`MODEL` i
`render/figur_view.js`, tegnet i `kunst.HAANDVAABEN` i det flade formsprog):
tonerkanonen på skulderen, scanner og opdatering i sigtehånden, bor skråt
ned, og bombe, tastatur, mail, ringbind, laptop, fjernbetjening, faktura,
virus og hvidt flag holdt i hånden. Det man kaster, er det man holdt:
bombe-, tastatur- og virusprojektilerne bruger samme tegning.

## Vejret påvirker skuddene

Vinden har altid skubbet vindfølsomme projektiler (`vindFaktor` i
våbentabellen). Nu bestemmer VEJRET også, hvor meget — tre håndtag i
`VEJR_FYSIK` i `sim/physics.js`:

| | kraft (x vind) | luftmodstand | vindstød |
|---|---|---|---|
| solskin | 1,0 | 0 | ±8 % |
| overskyet | 1,15 | 0,03 | ±18 % |
| regn | 1,4 | 0,18 | ±35 % |
| slud | 1,55 | 0,25 | ±50 % |
| sne | 0,75 | 0,30 | ±12 % |
| tåge | 0,45 | 0,08 | ±5 % |

Luftmodstanden bremser skuddet (kortere rækkevidde), og vindstødene får den
effektive vind til at bølge deterministisk hen over turen —
`vindNu(vind, vejr, tick, froe)` er en ren funktion, så alle klienter regner
det samme.

En FULDT opladet Tonerkanon (1,5 s) bærer tværs over banen: målt 5128 wu ved
45 grader i stille solskin — banen er 5120 — og 6351 med fuld medvind, men
kun 1439 i slud med fuld modvind. En Datalæk-bombe (vindblind) flyver ens i alt
vejr. Intet er skjult: sigtelinjen integrerer med de samme konstanter og den
samme effektive vind, og HUD'ens vindmåler viser den effektive vind, så
spilleren ser vindstødene komme.

## Sådan skabes dybden i et 2D-spil

Perspektivet er fladt, men fire greb får scenen til at føles rumlig:

1. **Terrænet lyses efter maskens gradient.** Masken er 2D, men dens gradient
   *er* overfladens hældning — opadvendte kanter bliver lysere, undersider og
   overhæng mørkere, og jord med meget jord over sig mørkner gradvist, så
   bjergene får masse og hulerne bliver hule.
2. **Otte parallakslag med hver sin egenbevægelse** (se nedenfor).
3. **Atmosfærisk perspektiv** — fjerne lag trækkes mod himmelfarven.
4. **Vignet og kontaktskygger** — en let mørkning mod kanterne, og en blød
   skygge under hver figur. Uden kontaktskygge svæver alting.

## Baggrunden: to slags bevægelse

Bjergene og skovene er Kenney-fliser, der gentages vandret i en shader, så
et lag er én quad. Dybden kommer af at kombinere to ting:

1. **Parallakse** — hvert lag forskydes efter kameraet med sin egen faktor.
   Lagene flyttes ikke; hele laget offsettes.
2. **Egenbevægelse** — skyer driver, tågebånd siver, trælagene svajer, hver
   med sin egen hastighed og fase. Det er dét, der gør, at baggrunden lever,
   når kameraet står stille, i stedet for at være et postkort.

Lagene er forankret i **kystlinjen**, ikke i banens bund. Måltes de fra
bunden, ville skoven stå under vandoverfladen. Gråvejr trækker lagene mod en
kold dis, og himlens farver følger vejret.

## Arkitektur — de tre beslutninger der bærer resten

**Simulationen kører i en Worker, ikke på rAF.** Når en fane går i baggrunden,
struber browseren `requestAnimationFrame` til nær nul — i praksis helt i stå.
Kørte simulationen i hovedtråden, ville et netværksspil fryse for alle tolv,
uden at værten opdagede det. Workers throttles ikke. Målt i en skjult fane
kører simulationen 60 tick/sekund, mens rAF slet ikke fyrer.

**Hovedtråden simulerer aldrig.** Den spejler en simulation, der enten kører i
vores egen Worker (vi er vært) eller i en anden browser (vi er klient). Derfor
findes der kun én kodesti for rendering og HUD, og lokalt spil er en ægte test
af netværksstien.

**Alt bevægeligt tegnes interpoleret.** Workeren sender tilstand med 60 Hz
til hovedtråden (over netværket tyndes det ud til 20 Hz). Hovedtråden tegner
verden en lille smule BAG den seneste tilstand og interpolerer lineært mellem
de to omsluttende deltas (`net/client.js`), med et monotont render-ur, der
glider ind mod målet i stedet for at springe ved netværks-jitter. Så bevæger
figurer, projektiler, navneskilte og kamera sig flydende i skærmens framerate
(60-144 Hz) og følges ad. Forsinkelsen tilpasser sig strømmen: ~25 ms lokalt,
~80 ms over netværket. Tidligere tegnedes figurerne på seneste delta og
hakkede i 20 fps ud af trit med resten; målt ved 120 Hz stod en gående figur
stille i halvdelen af alle frames — nu i ingen.

**`js/sim/` er hovedløs.** Den må ikke importere three.js og ikke røre DOM,
`window`, `performance`, `Date` eller `Math.random`; tid modtages kun som
heltals-tick. Det er den regel, der gør både Workeren og netværkslaget billige.
Håndhæv den:

```bash
grep -rn 'three\.js\|document\.\|window\.\|Math\.random' static/js/sim static/js/core
```

Kun kommentarer må dukke op.

**Terrænet sendes aldrig som bitmap.** Masken er 6,3 MB; en destruktion er ~10
bytes. Klienter genererer banen fra frøet og afspiller en *ordnet* op-liste —
ordnet, fordi papirbunker, kabelbakker og byggeskum tilføjer materiale og
derfor ikke kommuterer med
udgravning. En hel kamp er typisk under 9 KB terrænhistorik.

## Filer

| Fil | Rolle |
|---|---|
| `app.py` | HTTP, statiske filer, `/ws`-opgradering, `main()` |
| `ws.py` | RFC 6455 i hånden — håndtryk, rammer, writer-tråd |
| `rum.py` | rum, hold, sæder, relæ med coalescing, vagthund, oprydning |
| `protokol.py` | beskedtyper, afsenderrettigheder, danske fejltekster |
| `test_ws.py` | RFC-vektorer mod `ws.py` |
| `static/js/sim/` | **hovedløs** simulation + `worker.js` |
| `static/js/render/` | three.js-laget — kan slettes uden at spillet ændrer sig |
| `static/js/ui/` | HUD, menuer, tastatur, kundetilpasning |
| `static/js/net/` | transport (WebSocket, loopback, Worker) og klientlogik |
| `static/vendor/` | Three.js r186 |

**Vendoring-fælde:** `three.module.js` importerer internt fra `./three.core.js`
— også i den minificerede udgave. Begge filer skal ligge i `vendor/` under
præcis de navne, ellers fejler indlæsningen.

## Verifikation

```bash
cd baevere && python3 test_ws.py
```

28 RFC 6455-tjek: alle tre længdeformer inkl. 64-bit, fragmentering, ping
midt i en fragmentsekvens, umaskerede rammer, RSV-bits, ugyldig UTF-8,
close-håndtryk, versionsforhandling og Origin-afvisning. Accept-nøglen
tjekkes mod RFC'ens PUBLICEREDE facit (`s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`).

**Lært på den hårde måde:** GUID-konstanten i håndtrykket havde et forkert
sidste ciffer, og testen låste den selvberegnede (forkerte) værdi fast i stedet
for RFC'ens facit. Alt var grønt, mens *alle* browsere afviste forbindelsen med
kode 1006 — "Vær vært" hang på "Forbinder…". Facit skal komme udefra.

**Netværksspil er verificeret i to rigtige Chrome-faner:** vært opretter rum,
den anden fane tilslutter via delelinket og trykker Klar, kampen starter med
identisk bane i begge (samme frø og terræn), klienten skyder, og krateret og
skaden lander ens hos begge — uden sekvenshuller. Sekvensnumre sidder kun på
pålidelige, udsendte beskeder; de hyppige tilstandsbeskeder (som serveren med
vilje dropper under pres) har intet nummer, så de aldrig ligner et tabt krater.
Browserpanelet i Claude-appen kan ikke holde WebSockets åbne — test netværk i
en almindelig browser.

Simulationen er hovedløs og kan derfor køres direkte i Node uden browser —
nyttigt til at teste balance og ro-detektion over mange ture.

**Diagnostik i browseren:** `window.baevere` (navnet er fra første tema) giver adgang til spillets tilstand
fra konsollen (`baevere.verden`, `baevere.tur`, `baevere.tegnEnFrame()`).
`F3` lægger den rå fysikmaske oven på det tegnede terræn, så enhver drift
mellem de to bliver synlig med det samme.

## Bemærkninger

- **Serveren lytter på `0.0.0.0` og har intet login.** Rumkoden er den eneste
  hemmelighed. Den ene kontrol der reelt beskytter noget, er Origin-tjekket på
  WebSocket-opgraderingen: WebSocket er **ikke** omfattet af CORS, så uden det
  kunne enhver webside en kollega har åben, forbinde hertil. Derudover er der
  rate limit på tilslutning og lofter på rum, forbindelser og rammestørrelse.
  Ingen TLS. Kør den ikke på et netværk, du ikke stoler på.
- **Snyd er ikke en trussel her, og der er ikke bygget imod det.**
  Tillidsgrænsen ligger i værtens browser. De eneste kontroller der findes, er
  mod uheld — at en gammel fane med stale værtsrolle begynder at udsende sin
  egen virkelighed.
- **Kollaps af løsrevet terræn er udeladt bevidst.** Worms-serien gør det
  heller ikke; klumper svæver. Der leveres i stedet ren præsentations-debris.
- Der er **ingen AI**. En afbrudt deltagers kunder springes over, men dør ikke
  — det ville straffe holdkammerater der intet har gjort.
- Kun desktop, primært 16:9.

## Ikke med i denne udgave

- **Vidjereb (ninjarebet)** — i enhver Worms-klon den største enkeltstående
  tidssluger. De femten våben giver et helt spil uden det.
- Strækvåben: halepropel, bananbombe, målsøgende gren, napalm.
