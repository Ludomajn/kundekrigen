# Banerne — reglerne pr. banetype

Hver kamp får en ny bane. Afstemningen i lobbyen vælger kun **banetypen**
(Fort, Åbent land, Grotte, Øer eller Tilfældig); når kampen starter, bygger
generatoren en ny variant efter typens regler. Det er samme idé som Worms'
MapGEN: faste regler, altid forskellige resultater, og hver bane er altid
spilbar.

- **Tilfældig** bliver trukket til en af de fire rigtige typer, før banen
  bygges (i `rum.py` og i det lokale rum i `net/transport.js`).
- Banen er altid 5120 × 1792 wu, og havet står i 300 wu.
- Alt afhænger kun af frøet (og på fortet af holdenes opstilling), så værten,
  værtens spejl og gæsterne bygger præcis den samme bane uden at sende den.

Koden: `static/js/sim/baneregler.js` (skemaerne og de fælles regler),
`static/js/sim/terrain_gen.js` (fortet og valideringen) og
`static/js/sim/bane_natur.js` (øer, grotte og åbent land).

## Skemaerne

Hver type har et skema med arketyper. Frøet trækker arketypen (med vægte)
og derefter arketypens tilfældige parametre inden for faste grænser.

| Type | Arketyper | Temaer / variation |
|---|---|---|
| Fort | siluet: borg, tvillinger, spir, ringmur, bastion · landskab: hav, skær, ø, bakke, bro, kløft, sø | højde (løft), afstand, tinder |
| Øer | skærgård, hovedø, tvillinger | eng, skov, klippe, strand |
| Grotte | storhal, kamre, tunnelnet | — |
| Åbent land | bjergkæde, dale, plateauer | eng, skov, klippe |

## Fælles regler (alle baner)

1. **Kun frøet.** Ingen `Math.random` i simulationen; samme frø giver samme
   bane hos alle.
2. **Græs og kant** tegnes som før: græs på jord med luft over, murværk med
   planker og sten.
3. **Broer og bjælker** er murværk (`MUR`): de kan sprænges som jord og
   tegnes som planker, fordi de er tynde. De hviler på land i begge ender og
   står på pæle.
4. **Pynt** (græstotter, blomster, svampe, sten, busk, siv, kogle,
   pindebunke, bregne, kløver — de eneste pyntegrafikker, der findes;
   printere, miner, telefoner og kasser er spilgenstande) placeres af banen
   selv (`placerPynt`):
   - rigtig kontakt: jord under begge sider af foden, fri luft lige over og
     intet loft i hele tingens højde — aldrig svævende
   - tilfældig spejling og størrelse (80-125 %)
   - tæthed pr. tema (gennemsnitlig afstand 20-34 wu) og ved kysten siv og sten
   - aldrig klumper: afstand til sin egen slags, og højst én stor ting
     (busk, siv, pindebunke, bregne) pr. 150 wu
   - aldrig på en startplads: ingen kunde starter, og intet udstyr står,
     inden for 44 wu af en stor ting
5. **Oprydning.** Enkeltpixels og 1 px sprækker fjernes, løse klatter under
   900 px fjernes (store svævende øer bliver), og små lukkede luftbobler
   under 260 px fyldes.
6. **Vandet kan ses** fra de fleste startpladser: de fleste står højst 600 wu
   over havet (målt: åbent land 66 %, øer 91 %, grotte 100 %; fortets
   stueetage står 110-380 wu over vandet, og hver etage 140-160 wu højere).
7. **Retfærdige startpladser:** flade (højst 18 wu skæve over 48 wu), over
   vandet (mindst 90 wu), med plads til kundens kapsel, aldrig i en lukket
   lomme (en hule, man ikke kan komme ud af), nok til alle kunder (× 3) og
   spredt over mindst halvdelen af banen. Minerne lægges mindst 150 wu fra
   kunderne (som før).
8. **Validering.** Holder banen ikke (for få eller for samlede pladser, en ø
   uden plads, en dal uden bro), prøver `genererSpilbar` igen med et afledt
   frø. Fortet valideres på selve masken (se nedenfor).
9. **Hurtigt.** En bane tager 35-75 ms i Node i snit (95 % under 120 ms).

## Fort

Fortet er standardbanen. Hver klinik har sin egen borg med én etage pr. kunde
(højst fire; flere kunder står side om side nederst), og alle borge er den
samme variant, spejlet — også på pixelniveau, så ingen side har en pixel til
gode. Hele banen, også landskabet, er spejlet om midten.

### Borgens siluet

Borgen er bygget af segmenter med faste regler for, hvordan de hænger sammen
(MapGEN's fort-fliser): keep, trappekrop, tag, fortårn, tårntoppe, anneks og
udhæng. Siluetten bestemmer segmenterne:

| Siluet | Regler |
|---|---|
| **borg** | den klassiske: højt fortårn mod fjenden, lavere keep bagest, måske kronetårn, vagttårn, porttårn, anneks, terrasser og hængetårn. Enten høj og smal eller bred med lange haller. |
| **tvillinger** | et højt bagtårn op ad bagmuren (næsten så højt som fortårnet, måske med spir) og en gangbro fra keepens top over taget hen til fortårnet. Keepen er høj og har rampen indeni. Intet porttårn (broen går dér). |
| **spir** | spidse spir i stedet for tinder på fortårnet, kronetårnet, porttårnet, annekset og hængetårnet. Intet vagttårn. Højere fortårn. |
| **ringmur** | lav keep og en lang, lav ringmur bagud med en arkade, tinder og et endetårn yderst, og et hængetårn på bagmurens hjørne. |
| **bastion** | lav og bred: bredt fortårn med tung, udkraget krone, skrå fod (talus) for og bag, lav keep, næsten altid porttårn, brede tinder. |

Tinderne (højde 34-50, bredde 26-44, skår 20-34, måske svalehale) trækkes pr.
kamp, og hallerne skifter stil fra etage til etage (hvælv, kamre, arkade),
så intet flisemønster gentager sig.

Selve kroppen trækkes også pr. kamp, i alle siluetter: hallen (op til 170 wu
længere), fortårnets bredde (op til 60 wu) og højde (-44 til +66 wu), keepens
bredde (op til 70 wu), reposen mellem trappeløbene (op til 50 wu) og facadens
trin (30-76 wu). Så står kundernes rum, trappebåndet og keepen forskellige
steder, også når to kampe trækker samme siluet. Med flere klinikker er
spillet mindre (FORT_HOLD), og trim skærer det væk, når der er trangt.

Det, der aldrig ændres (spillets garantier):

- Kundernes rum i fortårnet med skydeskår over en brystning på 48 wu: et lige
  skud fra fjendens tilsvarende etage rammer brystningen, aldrig kunden.
- Trappeløbene som tunneler op mod bagsiden, hullerne i dækkene, keepens
  rampe og udkigskammeret.
- Samme udstyr (miner, printere, telefon, piller) på hver borg, spejlet.
- Forsyningskasser slippes kun over steder, man kan komme op på: taget,
  keepens top og gangbroen — aldrig over porttårnet, kronetårnet, bagtårnet
  eller under fortårnets krone. Vinden fører dem kun hen over det stykke,
  de blev sluppet over (`kasseSpand`), så de lander dér; brandøvelsen bruger
  de samme steder.
- Er der for trangt (5-6 klinikker), skæres pynt væk (trim), landskabet
  bliver åbent hav, og til sidst bruges den klassiske borg uden løft — præcis
  som før skemaerne.

### Landskabet mellem og omkring borgene

| Landskab | Regler |
|---|---|
| **hav** | åbent hav; borgene står på hver sin klippe, måske høj (løft op til 170 wu). Klippen er lodret over vandet ved borgens fod, så man ikke kan stå uden for borgen. |
| **skær** | 1-4 høje klippestøtter midt i havet (én midt på og/eller par), bredere foroven (udhæng), så man kun kan stå på toppen. |
| **ø** | en ø midt i havet med strand hele vejen rundt, flad top, to bakker eller én, og måske en ruin af murværk, der står i jorden (også i sadlen mellem to bakker). |
| **bakke** | et højt bjerg midt imellem (kegle, plateau eller to toppe, terrasseret), der tager de lige skud, måske med en havbue gennem foden. |
| **bro** | en brudt stenbro på rundbuer ud fra hver borgs plint, i plintens højde, med et hul midt på, der er bredere end et hop. Man kan gå ud på sin egen bro. Stumperne ligger under vandet. |
| **kløft** | borgene står på høje klipper (løft 110-230 wu) med land bagud til kysten og bakker; en dyb kløft med overhængende vægge skiller dem. Forpladsen foran facaden er 50-180 wu. |
| **sø** | borgene står på lavt land med bakker bagud; en sø med strande skiller dem. |

Afstanden mellem borgene og deres løft trækkes også, så borgene står
forskellige steder og i forskellige højder fra kamp til kamp.

### Ingen kan hoppe over

Et hop (160 wu/s frem, 235 op) eller en salto når højst `raekkevidde(fald)`
vandret (+ kapslens bredde). Reglerne:

- Afstanden mellem to borge er mindst rækkevidden fra borgens højeste punkt
  ned til det laveste, man kan stå på hos den anden (plint, forplads, bro,
  klippe eller skrå fod) + 24 wu.
- Alt, der ikke hører til en borg (støtter, ø, bakke), står uden for
  rækkevidden fra begge borge i alle højder: ingen kan hoppe derud og videre.
- Broernes ender er længere fra hinanden end et hop, og ingen bro-ende er
  inden for et hop fra den anden borg (heller ikke fra dens top).
- Til sidst prøves det på den FÆRDIGE maske: alle standpladser over vandet
  deles i områder (hver borgs område går til midten af hullet til naboen;
  landskabet imellem er sit eget), og intet par i hver sit område må være
  inden for et hops rækkevidde (`fortHopSikker`). Fejler det, bygges banen om
  med åbent hav (det er ikke sket i testene).

## Øer

| Arketype | Regler |
|---|---|
| **skærgård** | 4-7 øer i en række med sund på 90-400 wu imellem; broer over nogle af de smalle (under 270 wu). |
| **hovedø** | én stor ø (40-56 % af banen) med flere toppe, en hule og en bue gennem kysten, og 2-4 småøer omkring, måske med broer. |
| **tvillinger** | to store øer over for hinanden med et sund på 180-420 wu og 0-2 skær midt i; klinterne vender ud mod sundet. |

- Hver ø har en form (kegle, plateau, to toppe, bakke eller en skæv klint), og
  toppene er flade nok til at stå på.
- Mange øer er underskåret ved vandlinjen (overhæng som i Worms); klippeøer
  oftere og stejlere.
- Sundene er altid korte nok til, at et fuldt Tonerkanon-skud (over 5000 wu)
  når langt over; at komme over kræver bro, teleport eller byggeredskaber.
- Hver ø skal have plads til kunder (mindst én startplads), ellers prøves et
  nyt frø.
- Temaet (eng, skov, klippe, strand) bestemmer pynten og øernes former.

## Grotte

Alt er klippe fra havbunden til banens top, med grundfjeld i loftet, og
grotten skæres ud. Vandet står i bunden: gulvet dykker ned under vandlinjen i
søer.

| Arketype | Regler |
|---|---|
| **storhal** | én stor hal næsten hele banen bred med runde ender, 2-4 søer i gulvet, søjler (på to ben med en bue imellem, så man kan gå igennem; nogle brækket over), drypsten fra loft og gulv og hylder. |
| **kamre** | 3-5 kamre i forskellige højder med hvælvede lofter og gulve, der krummer op mod væggene, forbundet af gangbare tunneler (radius 46-62 wu, højst ~45° stejle) og måske en ekstra tunnel højere oppe. Det laveste kammer ligger ved vandet og har en sø. |
| **tunnelnet** | tunneler i tre lag på tværs af banen (radius 48-78 wu), måske brudt ét sted, skrå ramper imellem, små kamre, hvor de mødes, og en stor sø i bunden. |

- Alle kamre, man kan nå fra en startplads, har gulv at stå på; lommer, man
  ikke kan komme ud af, markeres, så ingen starter i dem.
- Forsyningskasser slippes under loftet, ikke inde i klippen.
- Under loftet: stenskredets mursten dukker op lige under grottens loft og
  falder ned i grotten, og Kvartalsopkrævningen falder lige ned fra loftet
  over markøren (`world.nedfaldY`). Shitstormens miner kan ikke falde
  igennem loftet, så shitstormen sker ikke i grotten.

## Åbent land

| Arketype | Regler |
|---|---|
| **bjergkæde** | 3-5 bjerge (kegle, to toppe, plateau eller klint) med dale og kanaler imellem, overhængende klinter og en bue gennem et smalt bjerg eller en hule. |
| **dale** | bølgende land med 2-4 brede dale, hver med en kanal i bunden, og broer over 1-3 af kanalerne — mindst én bro, ellers prøves et nyt frø. |
| **plateauer** | 3-5 flade plateauer i forskellige højder med stejle klinter, måske et trin; kanaler eller lave sadler imellem, broer over nogle af kanalerne og huler under plateauerne. |

- Højdekurven terrasseres og glattes, så der er store flader at kæmpe på.
- Banens ender går altid ned i havet, så ingen kan campe i et hjørne.
- Lidt hulestøj dybt inde i landet giver huler, man kan grave sig ind i.

## Testene og billederne

`test/README.md` beskriver testene (`node --no-warnings test/kort_alle.mjs`)
og kontaktarkene (`node --no-warnings test/lav_billeder.mjs`). Målt med 50 frø
pr. type (Jaccard-afstand mellem silhuetterne, 0 = ens, 1 = intet fælles):

| Type | mindste | 5 % | median | før skemaerne (median) |
|---|---|---|---|---|
| Fort | 0,24 | 0,42 | 0,67 | 0,23 |
| Åbent land | 0,23 | 0,40 | 0,55 | 0,59 |
| Grotte (hulrummene) | 0,14 | 0,38 | 0,68 | — |
| Øer | 0,20 | 0,45 | 0,72 | 0,82 |

De gamle øbaner var mere forskellige, fordi landet nogle gange næsten
forsvandt; de nye har altid øer med plads til alle.

Selve borgene inden for én siluet (100 frø med 2 x 2; kun murværket i celler
på 24 wu, rettet ind efter facaden og stueetagen, `test/kort_variation.mjs`):

| Siluet | median | under 0,25 | før kroppens spil (median) |
|---|---|---|---|
| borg | 0,42 | 2 % | 0,34 |
| tvillinger | 0,38 | 7 % | 0,24 |
| spir | 0,39 | 4 % | 0,30 |
| ringmur | 0,41 | 1 % | 0,32 |
| bastion | 0,38 | 5 % | 0,28 |
