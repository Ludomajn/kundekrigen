# Punkt 2: vejledningen på første tur

Linjetallene er fra min læsning i dag. Kameraagenten og banegeneratoragenten ændrer main.js, world.js og hud.js lige nu, og linjerne har allerede flyttet sig undervejs. Søg derfor på ankeret (funktions- eller variabelnavnet), hvis et tal ikke passer. Jeg har ikke ændret noget i repoet. Mine forsøg ligger i kopier under `/tmp/claude-503/kk/` og `/tmp/claude-503/det.mjs`.

## Nu

**Boblerne kører på et ur, som spilleren ikke kan se.**
- `static/js/ui/hjaelp.js:81-87` har fem bobler på 4200, 4600, 6000, 5600 og 5000 ms, i alt 25,4 s.
- `visBoble` og `naeste` (`hjaelp.js:136-147`) går videre med `setTimeout(naeste, ms)`. Der er ingen tæller og ingen besked om, at man skal gøre noget.
- `.hjaelp` har `pointer-events:none` (`static/app.css:386`), så et klik på boblen gør ingenting. Det forklarer testerens tvivl: han klikkede, klikket blev ignoreret, og uret skiftede boblen, så det lignede, at klikket virkede.

**Boblerne starter, før spilleren kan styre.**
- `hjaelp.foersteTur()` kaldes på bussens `turStart` (`static/js/main.js:680`). Den kommer fra beskeden `'tur'` (`net/client.js:114-121`, `sim/worker.js:66-70`), som sendes, når tilstanden går til `TUR_START`.
- Man får først kontrollen efter `TUR_START_TICKS = 150` (`sim/turn.js:31`, `sim/world.js:772-789`). Jeg målte `turStart` til tick 241 og `dinTur` til tick 391.
- Før det afviser `accepterBevaegelse` alt input (`world.js:396`). De første 2,5 s af boblen "Gå med ← og →" kan man altså ikke gå.
- `dinTur` sendes allerede videre (`worker.js:21`), men main.js lytter ikke på den.

**Tururet løber hele tiden.**
- Uret står kun stille, når arsenalet er åbent (`world.js:796-798`), og højst `PANEL_PAUSE_LOFT = 300` tick (5 s) pr. tur (`turn.js:34`).
- Standardturen er 45 s lokalt (`net/transport.js:186`) og 30 s over nettet (`rum.py:102`). Med tilfældige regler kan den være helt nede på 15 s (`main.js:177`).
- Ved 30 s æder boblerne cirka 23 s af den første tur.
- `panelAabent` kommer hverken med i snapshot eller delta (`sim/snapshot.js:52`, `72-106`). Modspilleren kan derfor ikke se, hvorfor uret står stille.

**Flaget sættes for tidligt.**
- `localStorage` får `'1'` i det øjeblik, sekvensen begynder (`hjaelp.js:153-156`, nøgle `hjaelp.js:19`). Lukker man fanen midt i vejledningen, får man den aldrig igen.

**To funktioner bliver aldrig kaldt, og pausemenuen mangler det, filhovedet lover.**
- `visIgen()` (`hjaelp.js:161`) og `hint()` (`hjaelp.js:163`) har ingen kaldere; det har jeg tjekket med grep over hele `static/js`.
- `hint()` ville desuden tømme vejledningens kø (`koe = []`) og bruge den samme boble.
- Filhovedet siger, at oversigten "åbnes … fra pausemenuen" (`hjaelp.js:12-13`), men `visPause` har ingen knap til det (`ui/menu.js:322-337`).

**Mellemrum og Esc er begge optaget.**
- Mellemrum er `lad` (`ui/keyboard.js:26`). Tryk starter opladningen (`main.js:1516-1526`), og slip affyrer (`main.js:1594-1630`, vagt ved `1607`).
- Esc er `pause` (`keyboard.js:46`, `main.js:1540-1546`).
- Der er allerede en regel om, at det øverste lag tager Esc først: oversigten (`main.js:1534-1536`) og markøren (`main.js:1541`).

**En eksisterende fejl i samme indputvej: oversigten sluger ikke tasterne.**
- Tjekket af oversigten (`main.js:1534`) ligger efter opladningen (`1516-1526`) og efter `sendInput()` (`1527`).
- `holdNu` ignorerer oversigten (`main.js:1464-1469`).
- Med "Alle taster" åben kan man derfor lade op og skyde med mellemrum og gå med piletasterne.

**Pausemenuen er ikke en rigtig pause, heller ikke lokalt.**
- Workeren har ingen pausebesked (`sim/worker.js:84-107`). `S.pause` blokerer kun input (`main.js:1510`).
- Tururet løber altså videre, mens menuen står åben. Teksten "I netværksspil kører kampen videre" (`menu.js:331`) antyder noget andet.

**Placeringen af boblen.**
- Boblen står i `midt` (`top:30%`, `app.css:411`). Det er tæt på banneret (`top:38%`, `app.css:342-347`) og tæt på sigtet over kunden, nu hvor kameraet kommer tættere på.

## Valg og begrundelse

**Jeg vælger (c), en hybrid**: gør-det-trin og et slutkort med MELLEMRUM. Uret venter imens, men højst 30 s pr. spiller pr. kamp. Den ventetid valideres i simulationen og vises for alle som en bjælke, der løber ned.

| Mulighed | For | Imod |
|---|---|---|
| (a) Modale bobler i egen tur, MELLEMRUM går videre | Præcis det, testeren bad om | Mellemrum betyder både "næste" og "skyd", og det tryk, der kommer lige efter sidste boble, starter en opladning. Fem skærme tekst uden at gøre noget. Kræver alligevel, at uret stoppes. |
| (a') Vejledningen før første tur (under nedtællingen eller introen) | Ingen konflikt med tasterne | Ventetiden før kampen er 240 tick med speakeren (`world.js:767-769`, `ui/intro.js:14`). Skal den forlænges, venter alle på den langsomste læser over nettet. Man kan ikke øve noget, for bevægelse afvises (`world.js:396`). Filmen bruger allerede mellemrum til at springe over (`main.js:1492-1495`, `ui/filmintro.js:238-241`). |
| (b) Ren gør-det | Mellemrum beholder sin betydning, og det er tydeligt, hvorfor boblen skifter | Uret presser en ny spiller. Oplysningen om kasser kan ikke "gøres". Når man har skudt, er turen slut. |
| **(c) Hybrid** | Hvert trin skifter kun, når spilleren har gjort det, og tælleren viser hvor langt man er. MELLEMRUM bruges bogstaveligt på slutkortet, som kun vises, når mellemrummet ikke betyder noget i spillet. Esc springer over. Uret venter, og det kan ses. | Kræver en lille, afgrænset ændring i simulationen |

**Uret: en egen kvote, ikke `'panel'`.**
- Arsenalets loft er 5 s pr. tur (`turn.js:34`). Det er for kort, og det nulstilles hver tur. Gjorde man det længere, kunne det misbruges hver tur.
- Trin 4 beder spilleren åbne arsenalet. Når skuffen lukkes, sendes `aaben:false` (`main.js:1677`), og så ville uret starte midt i vejledningen. Vejledningen ville også bruge de 5 s, som oversigten lover arsenalet (`hjaelp.js:57`).
- `panelAabent` replikeres ikke, så modspilleren ville se et frosset ur uden forklaring.

**Den nye kommando er `'vejledning' {aktiv}`.**
- Kvoten er `VEJLEDNING_LOFT = 1800` tick (30 s) pr. kundeejer pr. kamp. Den ligger i `tur` og kommer dermed med i snapshottet.
- Kvoten bruges før arsenalets pause.
- Flaget nulstilles ved `_turStart`.
- Deltaen får feltet `vj`, som angiver de resterende tick, mens uret venter.

**Netværk.**
- Kun den, der ejer den aktive kunde, kan sende kommandoen. `valider` sørger for det (`sim/commands.js:45-49`), og pid'en kommer fra serveren (`rum.py:892`).
- Den værste pause, en snydende klient kan give, er 30 s pr. kamp.
- Alle kan se ventetiden: bjælken under tururet, og for modspillere og tilskuere et banner.
- Reglen er symmetrisk: enhver spiller kan få kvoten.
- Serveren skal ikke ændres, fordi `in` sendes uændret videre til værten (`protokol.py:37,51`, `rum.py:896-898`).
- Beregningen er deterministisk. Jeg kørte en skriptet kamp på 90 s med og uden ændringen og fik identiske tilstande i alle 180 prøver.

**Ét tastatur.**
- Vejledningen vises én gang pr. browser, altså på den første lokale tur. Alle kan se den.
- Når slutkortet står fremme i næste spillers tur, bliver mellemrummet i spillet. Kortet skifter så til "Tryk Esc for at lukke".

**Tilskuere** får ikke vejledningen (`erMin` er falsk, `main.js:902`). De ser kun bjælken under uret og banneret.

**Filmintroen.** Vejledningen starter først ved `dinTur`, altså efter film, nedtælling og `TUR_START`. Under filmen er vejledningens rod skjult (`main.js:1319`), og filmens mellemrum ligger før i indputvejen (`main.js:1492`).

## Spec

### Forløb
1. **Start**: ved `dinTur` for min kunde, og kun hvis flaget ikke er sat. Samtidig sendes `'vejledning' {aktiv:true}`.
2. **Trin 1-5**: vises kun i min egen `SPILLER_AKTIV`. Hvert trin klares af den handling, det beskriver, og tasten går altid igennem til spillet.
   - Har spilleren allerede gjort et trin, springes det over.
   - Når trinnet er klaret, vises "✓ Sådan!" i 450 ms, og så kommer næste trin. De 450 ms styres af billedopdateringen og begynder først, når spilleren har handlet; ved reduceret bevægelse er de 0.
   - Intet skifter nogensinde af sig selv.
3. **Når der er skudt**: klientens pause slås fra med `aktiv:false`, og flaget gemmes. Slutkortet vises, når verden er faldet til ro. Konkret betyder det, at tilstanden hverken er min `SPILLER_AKTIV`, `affyring` eller `oploesning`.
4. **Slutter turen uden skud** (stå over, tiden løber ud, kunden dør): vejledningen skjules og fortsætter ved næste `dinTur` på samme trin.
5. **Esc** springer vejledningen over, når et kort er fremme. Undtagelse: i markørtilstand annullerer Esc markøren som i dag.

### Hvornår er et trin klaret?
| Trin | Klaret når |
|---|---|
| gaa | ← eller → holdt i alt 0,5 s i egen tur (ikke i markørtilstand, arsenalet lukket) |
| hop | Hændelsen `hop` eller `salto` for min aktive kunde |
| sigt | ↑ eller ↓ holdt i alt 0,4 s i egen tur (ikke i markørtilstand) |
| vaaben | Hændelsen `vaabenValgt` for min kunde. Den kommer ved 1-0, Q/E, et klik og et valg i arsenalet (`world.js` `_handling` `'vaelgVaaben'`). |
| skyd | En af hændelserne `skudAffyret`, `redskabStart`, `skjoldOp`, `teleport` eller `terraenBygget` for min kunde eller i min tur. Alle sendes videre (`worker.js:18-31`). Tilsammen dækker de alle ikke-meta-våben (`sim/behaviours.js:89,189,222,237,277,303,321,328,344,355,367`). |

### Tekster (præcist)
- **Kortets hoved**: `VEJLEDNING`, fem prikker og `2/5`. Mens kvoten løber, står der også `Uret venter`.
- **Handlingslinjen**: `GØR DET` + tasterne + teksten fra tabellen. Når trinnet er klaret: `✓ Sådan!`.
- **Fod på trinkortene**: `[Esc] spring vejledningen over`.

| id | tekst | taster | gør |
|---|---|---|---|
| gaa | Det er din tur. Flyt din kunde derhen, hvor du vil stå. | ← → | Gå |
| hop | Hop op på kanter og over huller. Backspace er en baglæns saltomortale. | Enter | Hop |
| sigt | Sigtekornet foran kunden viser, hvor du skyder hen. Hold Shift for at finsigte. | ↑ ↓ | Sigt op og ned |
| vaaben | Tallene vælger våben på bjælken nederst. Tab — eller «Flere våben» i venstre side — åbner hele arsenalet. | 1 … 0 | Vælg et våben |
| skyd, `vinkel+kraft` | Jo længere du holder, jo længere flyver skuddet. Vinden tager det med. | MELLEMRUM | Hold for at lade op — slip for at skyde |
| skyd, `vinkel` | {navn} skyder lige ud i sigteretningen. | MELLEMRUM | Tryk for at skyde |
| skyd, `markoer` | Første tryk viser en markør. Flyt den med piletasterne — T springer til næste fjende. | MELLEMRUM | Tryk, flyt markøren, tryk igen |
| skyd, `ingen` | {navn} bruges dér, hvor du står. | MELLEMRUM | Tryk for at bruge den |
| skyd, meta | {navn} afslutter bare turen. Vælg et rigtigt våben for at prøve et skud. | 1 … 0 | Vælg et våben |

Teksten til skyd-trinnet følger `v.vaabenNu().sigte`, som opdateres hver frame. Der findes fire slags sigte: `vinkel+kraft`, `vinkel`, `markoer` og `ingen` (`sim/weapons.js`).

**Slutkortet**
- Hoved: `VEJLEDNING · KLAR` og `n/5`.
- Tekst: `Sådan! Våbnene har få skud. Forsyningskasser daler ned i faldskærm — gå hen og saml dem op, så får du flere.`
- Mangler der trin, kommer linjen `Husk også: [Enter] hop · [1]…[0] våben` med de trin, der ikke blev gjort.
- Knaplinjen er `Tryk [MELLEMRUM] for at fortsætte`. Er mellemrummet i spillet, står der i stedet `Tryk [Esc] for at lukke`.
- Fod: `[?] alle taster · Vejledningen kan vises igen fra pausemenuen`.

**Bannere**
- Når man springer over: `Vejledningen er sprunget over · ? viser alle taster` (2000 ms).
- For modspillere og tilskuere, én gang pr. tur: `{navn} lærer styringen — uret venter højst 30 s` (2600 ms).

**HUD**: `Uret venter` med en bjælke, der løber ned.

**Pausemenuen**: to nye knapper, `Vis vejledningen igen` og `Alle taster`.

**`GRUPPER` → `'Andet'`** (`hjaelp.js:72-77`): Esc-rækken bliver til `['Esc', 'Pause — eller spring vejledningen over, mens den står fremme']`, og der kommer en ny række `['Pausemenuen', 'Vis vejledningen igen']`.

### DOM
Trinkortet sættes ind i `#hjBoble` (`hjaelp.js:109`), som får `role="status" aria-live="polite"`:
```html
<div class="hjboble vejl bund">               <!-- + .klaret mens ✓ vises; .slut på slutkortet -->
  <div class="vj-top"><span class="vj-navn">Vejledning</span>
    <span class="vj-pips" aria-hidden="true"><i class="vj-pip ok"></i><i class="vj-pip nu"></i><i class="vj-pip"></i><i class="vj-pip"></i><i class="vj-pip"></i></span>
    <span class="vj-venter">Uret venter</span>           <!-- kun når tur.vejledningRest > 0 -->
    <span class="vj-tal num">2/5</span></div>
  <p class="vj-tekst">…</p>
  <div class="vj-goer"><span class="vj-lbl">Gør det</span><kbd>↑</kbd><kbd>↓</kbd>
    <span class="vj-hvad">Sigt op og ned</span><span class="vj-ok" aria-hidden="true">✓ Sådan!</span></div>
  <button class="vj-fod" type="button" tabindex="-1" data-vj="spring"><kbd>Esc</kbd> spring vejledningen over</button>
</div>
```

På slutkortet er `.vj-goer` en `<button data-vj="videre" tabindex="-1">`. Klik gør det samme som tasterne. Knappen `blur()`es efter klikket, som i `hud.js`, så et senere mellemrum ikke "klikker" den igen.

Tastebjælken markerer den tast, trinnet handler om:
- Punkterne i `KERNE` (`hjaelp.js:22-31`) får `trin`: `gaa`, `sigt`, `skyd`, `hop` og `vaaben`.
- Hvert punkt får `data-trin`, og det aktuelle punkt får klassen `.nu`.

### CSS (føjes til `static/app.css` efter `:417`)
```css
/* ---------------------------------------------------------- vejledningen (første tur) */
.hjboble.vejl{max-width:min(560px,calc(100vw - 32px));padding:11px 16px 10px;text-align:left;animation:vjInd .2s ease-out}
.hjboble.vejl::after{display:none}
@keyframes vjInd{from{opacity:0;translate:0 8px}to{opacity:1;translate:0 0}}
#hud:has(#hudNet:not(.hide)) ~ #hjaelp .hjboble.bund{bottom:calc(var(--bund-h,188px) * var(--ui) + 50px)}
.vj-top{display:flex;align-items:center;gap:8px;margin-bottom:6px;font:800 9px/1 var(--font);letter-spacing:.14em;text-transform:uppercase;color:rgba(13,49,69,.72)}
.vj-pips{display:flex;gap:4px}
.vj-pip{width:18px;height:5px;border-radius:3px;background:rgba(13,49,69,.2)}
.vj-pip.ok{background:var(--kk-deep)}
.vj-pip.nu{background:var(--kk-handling)}
.vj-venter{padding:2px 6px;border-radius:999px;background:var(--kk-deep);color:var(--kk-yellow)}
.vj-tal{margin-left:auto;font-size:11px;letter-spacing:.04em;color:var(--kk-deep)}
.vj-tekst{margin:0;font:600 13.5px/1.45 var(--font);color:var(--kk-deep)}
.vj-husk{margin:6px 0 0;font:600 11.5px/1.5 var(--font);color:rgba(13,49,69,.85)}
.vj-goer{display:flex;align-items:center;gap:6px;width:100%;margin-top:9px;padding:7px 10px;border:0;border-radius:var(--r-md);
  background:var(--kk-deep);color:var(--white);font:700 13px/1.2 var(--font);text-align:left}
.vj-lbl{font:800 9px/1 var(--font);letter-spacing:.14em;text-transform:uppercase;color:var(--kk-yellow);margin-right:4px}
.vj-goer kbd{font-size:12px;padding:3px 8px;min-width:26px}
.vj-goer kbd.lang{min-width:118px}
.vj-ok{display:none;margin-left:auto;font-weight:800}
.hjboble.vejl.klaret .vj-goer{background:var(--kk-green)}
.hjboble.vejl.klaret .vj-hvad{opacity:.65;text-decoration:line-through}
.hjboble.vejl.klaret .vj-ok{display:inline}
.hjboble.vejl.klaret .vj-pip.nu{background:var(--kk-deep)}
.vj-fod{display:flex;align-items:center;gap:6px;margin:8px 0 0;padding:0;border:0;background:none;font:600 10.5px/1.3 var(--font);color:rgba(13,49,69,.78)}
.vj-fod kbd,.vj-husk kbd{background:rgba(13,49,69,.1);border-color:rgba(13,49,69,.35);color:var(--kk-deep)}
.hjboble.vejl [data-vj]{pointer-events:auto;cursor:pointer}
.tb-punkt.nu{color:var(--kk-yellow);font-weight:700}
.tb-punkt.nu kbd{background:var(--kk-yellow);border-color:var(--kk-yellow);color:var(--kk-deep);animation:vjPuls 1.1s ease-in-out infinite}
@keyframes vjPuls{0%,100%{box-shadow:0 0 0 0 rgba(255,216,111,.7)}50%{box-shadow:0 0 0 4px rgba(255,216,111,0)}}
/* HUD: uret venter på vejledningen. Kvoten er et ur — derfor en bjælke, der løber ned. */
.tururet.venter{opacity:.5}
.ur-venter{display:flex;flex-direction:column;align-items:center;gap:3px;margin-top:3px}
.uv-tekst{font:800 8.5px/1 var(--font);letter-spacing:.14em;text-transform:uppercase;color:var(--kk-yellow)}
.uv-bar{width:64px;height:4px;border-radius:2px;background:rgba(207,232,240,.22);overflow:hidden}
.uv-bar i{display:block;height:100%;background:var(--kk-yellow)}
```
- Alle kortene placeres som `bund`, over våbenbjælken (`app.css:412`), og `midt` bruges ikke længere.
- Den nuværende `transform` (`app.css:649`) beholdes. Indgangsanimationen bruger egenskaben `translate`, så de to ikke overskriver hinanden.
- `prefers-reduced-motion` slår animationerne fra som i dag (`app.css:376-378`).

### Indputvejen i `main.js` (`tast.paaTryk`, efter vagterne `:1510-1511`)
```js
  // Oversigten (?) tager ALLE taster, til den er lukket (før nåede mellemrum opladningen).
  if (e.code === 'Slash' || e.code === 'F1' || e.key === '?') {
    if (panel.aaben) panel.luk();
    if (S.oplader) { S.oplader = false; lyd.ladelyd(null); }
    hjaelp.skiftOversigt();
    sendInput();
    return;
  }
  if (hjaelp.oversigtErAaben) {
    if (e.code === 'Escape') { hjaelp.lukOversigt(); sendInput(); }
    return;
  }
  // Vejledningen: Esc springer over (markøren går forud). MELLEMRUM går kun videre på
  // slutkortet, og kun når mellemrummet ikke er spillets — så starter det aldrig en opladning.
  if (hjaelp.tast(e, { egenTur: mellemrumErSpil(), markoer: S.markoerTilstand })) {
    if (e.code === 'Space') { S.spistMellemrum = true; lyd.afspil('klik'); }
    sendInput();
    return;
  }
  const v = S.verden;            // uændret herfra; den gamle ?/oversigt-blok (:1529-1537) fjernes
```

**Hvilke taster vejledningen tager**
- Esc, når et kort er fremme og man ikke er i markørtilstand.
- Mellemrum, men kun på slutkortet, og kun når `!mellemrumErSpil()`.
- Alt andet går igennem. Piletaster, Enter, 1-0, Tab og mellemrum udfører deres handling og klarer samtidig trinnet.

**Tre små ændringer omkring indputtet**
- `holdNu` (`main.js:1464`): `if (S.pause || panel.aaben || hjaelp.oversigtErAaben) return 0;`. Til sidst returneres `S.spistMellemrum ? b & ~K.LAD : b`.
- `tast.paaSlip` (`main.js:1594`): den første linje bliver `if (handling === 'lad') S.spistMellemrum = false;`.
- `rydAlt` sender kunstige slip, når vinduet mister fokus (`keyboard.js:94-101`), så flaget ryddes også dér.

**Nye hjælpere** (ved `erMin`, `main.js:902`):
```js
/** Er mellemrummet spillets lige nu (lade op, skyde, stoppe boret)? Samme betingelse som opladningen. */
function mellemrumErSpil() {
  const v = S.verden, akt = v?.aktivBaever();
  return !!(akt && !akt.doed && erMin(akt) && v.tur.tilstand === TIL.SPILLER_AKTIV);
}
/** Uret venter på vejledningen — kun i min egen tur; simulationen har loftet. */
function vejledningUr(aktiv) {
  const akt = S.verden?.aktivBaever();
  if (S.tilstand !== 'spil' || !akt || !erMin(akt)) return;
  afsend({ k: 'handling', seq: S.seq++, h: 'vejledning', aktiv });
}
```

**Kobling**
- `main.js:78`: `lavHjaelp(hjaelpRod, { ur: (a) => vejledningUr(a), besked: (t) => hud?.banner(t, 2000) })`.
- `koblHaendelser` (`main.js:570`, efter `bus.ryd()`):
  - Linjerne `678-680` (`if (mit) hjaelp.foersteTur()` og kommentaren over) fjernes.
  - Der tilføjes en lytter på `bus.paa('dinTur', e => { const b = …; if (b && erMin(b)) hjaelp.dinTur(); })`.
  - For hver af `['hop','salto','vaabenValgt','skudAffyret','redskabStart','skjoldOp','teleport','terraenBygget']` tilføjes en lytter, der kalder `hjaelp.noter(navn)`. Den gør det kun, når den aktive kunde er min, og `e.baever` enten mangler eller er lig den aktive kundes id.
- `opdaterVisning` (efter `minTur`, `main.js:1277`):
```js
  const egenTur = mellemrumErSpil();
  const fri = egenTur && !S.pause && !panel.aaben && !S.markoerTilstand && !hjaelp.oversigtErAaben;
  hjaelp.opdater({ dt, tilstand: v.tur.tilstand, egenTur, vaaben: v.vaabenNu(),
    gaar: fri && (tast.nede('venstre') || tast.nede('hoejre')),
    sigter: fri && (tast.nede('sigtOp') || tast.nede('sigtNed')),
    uretVenter: (v.tur.vejledningRest | 0) > 0 });
  if (aktNu && !minTur && (v.tur.vejledningRest | 0) > 0 && S.vjBanner !== `${v.tur.turNr}|${aktNu.id}`) {
    S.vjBanner = `${v.tur.turNr}|${aktNu.id}`;
    hud.banner(`${aktNu.navn} lærer styringen — uret venter højst ${VEJLEDNING_LOFT / HZ} s`, 2600);
  }
```
- `startKamp` (`main.js:445`): `hjaelp.ryd()` ved siden af `slutFest()`. Ved `kamp_afbrudt` (`main.js:358`) bliver tilstanden ellers hængende.
- Importen `main.js:54` bliver `import { VEJRTYPER, VEJLEDNING_LOFT } from './sim/turn.js';`.

### Simulationen, valideringen og netværket
```js
// commands.js:18-22 — 'vejledning' {aktiv}: vejledningen står i spillerens egen tur. Uret venter —
// højst VEJLEDNING_LOFT tick pr. spiller pr. kamp (turn.js).
export const HANDLINGER = new Set([..., 'panel', 'vejledning']);
// valider, efter HANDLINGER-tjekket (:56):
if (cmd.h === 'vejledning' && typeof cmd.aktiv !== 'boolean') return { ok: false, fejl: 'ugyldig vejledning' };

// turn.js:34-35
export const VEJLEDNING_LOFT = 1800;        // 30 s tururet må vente på vejledningen — pr. spiller pr. kamp
// nyTur (:38-54):  vejledning: null, vejledningBrugt: {},

// world.js _handling, efter 'panel' (:511-515)
      case 'vejledning':
        // Kun den aktive spiller kan sende den (valider). Kvoten hører til kundens
        // ejer (uden ejer: holdet), så den gælder hele kampen — ikke pr. tur.
        this.tur.vejledning = cmd.aktiv ? (b.ejer || `hold${b.hold}`) : null;
        break;
// world.js SPILLER_AKTIV (:796-798) — vejledningen først, så arsenalet:
        const vj = tur.vejledning;
        const vjBrugt = vj ? (tur.vejledningBrugt[vj] || 0) : 0;
        if (vj && vjBrugt < TU.VEJLEDNING_LOFT) tur.vejledningBrugt[vj] = vjBrugt + 1;
        else if (!this.panelAabent) tur.tickTilbage--;
        else if (tur.pausetTick < TU.PANEL_PAUSE_LOFT) tur.pausetTick++;
        else tur.tickTilbage--;
// world.js _turStart (:919): this.tur.vejledning = null;
// world.js ny metode (ved _aktivErDoed :869):
  /** Tick, uret endnu venter på vejledningen i denne tur (0: det går). */
  vejledningTilbage() {
    const vj = this.tur.vejledning;
    if (!vj || this.tur.tilstand !== T.SPILLER_AKTIV) return 0;
    return Math.max(0, TU.VEJLEDNING_LOFT - (this.tur.vejledningBrugt?.[vj] || 0));
  }
// world.js genskab (:1261): this.tur = { ...snap.tur, vejledningBrugt: { ...(snap.tur.vejledningBrugt || {}) } };
// snapshot.js :52   tur: { ...v.tur, vejledningBrugt: { ...(v.tur.vejledningBrugt || {}) } },
// snapshot.js tagDelta h (:105)   vj: v.vejledningTilbage?.() || undefined,
// snapshot.js anvendDelta (:165)  v.tur.vejledningRest = d.h.vj | 0;
```

**Netværksvejen**
- Gæsten sender `in` til serveren. Serveren stempler afsenderen som `f` og sender beskeden kun til værten (`rum.py:892-898`).
- Værten sender den videre til workeren (`main.js:372-374`), og workeren kalder `udfoerKommando` → `valider` → køen → `_handling` i næste tick.
- `VIDERESEND` og `client.js` ændres ikke. HUD'en læser feltet fra deltaen, som også når værtens egen spejlverden.

**Egenskaber**
- Ingen `rngSim` indgår.
- Kommandoerne ligger i inputstrømmen, så en genafspilning bliver præcis den samme.
- Snapshots uden felterne virker stadig, fordi der falder tilbage til `|| {}`.

### Flaget i localStorage
- Nøglen bliver `'baevere.hjaelpVist.v2'`. Versionen hæves, så alle ser den nye vejledning én gang; v1 kørte på et ur, og mange nåede ikke igennem.
- Flaget læses ved den første `dinTur` i kampen.
- `'1'` gemmes, når skud-trinnet er klaret, eller når man springer over. Det gemmes ikke, hvis kampen slutter eller forlades midt i; så starter vejledningen forfra i næste kamp.
- `try/catch` som i dag (`hjaelp.js:153,155`). Det kan injiceres (`lager`) i test.

### "Vis vejledningen igen" fra pausemenuen
`visPause` (`menu.js:322-337`):
```html
<button data-nav class="mpunkt" id="pFort">Fortsæt</button>
<button data-nav class="mpunkt" id="pVejl">Vis vejledningen igen</button>
<button data-nav class="mpunkt" id="pTaster">Alle taster</button>
<button data-nav class="mpunkt" id="pOpt">…Indstillinger</button>
<button data-nav class="mpunkt sek" id="pForlad">Forlad kampen</button>
```
Knapperne kalder `api.visVejledning()` og `api.visTaster()`. I main.js-api'en (`:184`):
```js
  fortsaet() { lukPause(); },
  /** Vejledningen forfra — med det samme i min tur, ellers i min næste (dinTur). */
  visVejledning() { lukPause(); hjaelp.visIgen(); if (mellemrumErSpil()) vejledningUr(true); },
  visTaster() { lukPause(); if (!hjaelp.oversigtErAaben) hjaelp.skiftOversigt(); sendInput(); },
// function lukPause() { S.pause = false; S.pauseSlut = performance.now(); menu.skjul(); }
```
- `visIgen` rører ikke flaget.
- I brugerfladen hedder det "vejledning", ikke "intro", så det ikke forveksles med filmintroen og nedtællingen (`ui/intro.js`).
- Er kvoten allerede brugt i kampen, venter uret ikke igen. Det kan man se, fordi bjælken ikke vises.

### `hint()` og bannerne
- `hint()` slettes. Den har ingen kaldere og ville ødelægge vejledningens kø.
- De korte beskeder undervejs bruger allerede `hud.banner` (`main.js:823`, `1286`, `1518`, `1647`, `736`). De melder en følge ("Våbnet er brugt", "Forsyningskasse på vej!") og holder ikke spillet tilbage, og oplysningen findes også andre steder (tallene på bjælken, kassen på banen). De får derfor ikke samme behandling, hverken modal eller mellemrum.
- Et vejledningskort og en kontekstbesked deler aldrig samme element igen.
- **Tilbageværende timere i vejledningen:**
  - Urkvoten, som vises som bjælke.
  - ✓-pausen på 450 ms efter spillerens egen handling.
  - Ingen `setTimeout`, der får vejledningen videre.

### Kunstbrief (valgfri; designet virker uden)
Koden bruger tastebilleder og et Unicode-✓ som pladsholdere. Når filen findes, sættes ikonerne ind via `<use href="/grafik/vejledning.svg#…">`. Indtil da ligger de bag konstanten `IKONER = false`.
- **Fem piktogrammer** til kortets handlingslinje: `t-gaa`, `t-hop`, `t-sigt`, `t-vaaben`, `t-skyd`.
  - `viewBox 0 0 32 32`, én farve `currentColor`, samme streg og fyld som våbenikonerne `v-*` (`index.html:32-136`).
  - Vises i 20 px, hvidt på `--kk-deep` inde i det gule kort.
- **`t-ur-venter`**: et pauseglyf til HUD-uret, 12 px i `--kk-yellow` på den mørke HUD.
- **`t-klaret`** (valgfrit): et ✓-stempel.
- Leveres i `static/grafik/vejledning.svg`, som art directoren ejer.

## Ændringer pr. fil

| Fil | Ændring |
|---|---|
| `static/js/ui/vejledning.js` (ny) | Ren trinmaskine uden DOM og uden lyd: `TRIN`, `SKYD`, `SLUT`, `NOEGLE`, `lavVejledning({ lager, ur, besked })` → `dinTur`, `visIgen`, `noter`, `opdater(ctx)` → visning, `tast(kode, ctx)` → `'sprunget' \| 'videre' \| null`, `ryd`. Tiden kommer ind som `ctx.nu`, så der ikke er timere. På slutkortet lukker Esc uden banneret om at springe over. |
| `static/js/ui/hjaelp.js` | Tegner kortet ud fra visningen og cacher på en signatur. Fjerner `FOERSTE_TUR`, `visBoble`, `naeste` og `hint` (`:80-87`, `136-147`, `163`). `lavHjaelp(rod, { ur, besked })`. Ny API: `dinTur`, `visIgen`, `noter`, `opdater`, `tast`. Klik via `data-vj`. `data-trin` og `.nu` på tastebjælken. `#hjBoble` får `role="status"`. Nye tekster i `GRUPPER` `'Andet'`. Filhovedet (`:6-14`) opdateres. |
| `static/js/main.js` | Kobling (`:78`), `dinTur` og handlingslytterne (`koblHaendelser`), `opdater` og banneret (efter `:1277`), indputvejen (`:1510-1537`), `holdNu` (`:1464`), `paaSlip` (`:1594`), `mellemrumErSpil` og `vejledningUr`, pausemenuens API (`:184`), `hjaelp.ryd()` i `startKamp`, importen (`:54`). |
| `static/js/ui/menu.js` | To knapper i `visPause` (`:322-337`). |
| `static/js/ui/hud.js` | Under `#hudTur` (`:63-65`): `<div class="ur-venter hide" id="hudVenter"><span class="uv-tekst">Uret venter</span><span class="uv-bar"><i></i></span></div>`. Nye felter `el.venter` og `el.venterBar`. I `// --- ure` (`:235-244`): `rest = tilstand==='spiller_aktiv' ? tur.vejledningRest|0 : 0`, som styrer `hide`, `.tururet.venter` og bredden `100*rest/VEJLEDNING_LOFT %`. Importerer `VEJLEDNING_LOFT` fra `../sim/turn.js`. |
| `static/app.css` | Blokken ovenfor. `.hjboble.midt` (`:411`) kan fjernes. |
| `static/js/sim/commands.js` | `HANDLINGER` plus kommentar (`:18-22`), typetjek i `valider` (`:55-71`). |
| `static/js/sim/turn.js` | `VEJLEDNING_LOFT`, felterne i `nyTur`. |
| `static/js/sim/world.js` | Grenen i `_handling`, uret i `SPILLER_AKTIV`, nulstilling i `_turStart`, `vejledningTilbage()`, dyb kopi i `genskab`. |
| `static/js/sim/snapshot.js` | Dyb kopi i `tagSnapshot`, `h.vj` i `tagDelta`, `tur.vejledningRest` i `anvendDelta`. |
| `test/vejledning.mjs` (ny) og `test/README.md` | Tests (se nedenfor) og en ny række i tabellen. |
| Uændret | `sim/worker.js`, `net/client.js`, `ui/keyboard.js`, `ui/lyd.js`, `rum.py`, `protokol.py`, den grafik art directoren ejer |

## Test

**Automatisk** (`node --test test/vejledning.mjs`, en rigtig verden som i `test/kamera_determinisme.mjs:64-75`). Simulationsdelen og trinmaskinen har jeg prototypet i `/tmp/claude-503/kk/` (`vj.mjs`, `snap.mjs`, `vtest.mjs`, `../det.mjs`), og alle påstande herunder holdt.

1. **`valider`**:
   - Ejeren får `ok`.
   - En anden pid får `'ikke din bæver'`.
   - `aktiv:'ja'` giver `'ugyldig vejledning'`.
   - Uden aktiv kunde giver den `'ingen aktiv bæver'`.
2. **Uret**:
   - Efter `aktiv:true` og `panel` åbnet i `SPILLER_AKTIV` falder `tickTilbage` med 0 over 1800 tick, og `pausetTick` er stadig 0.
   - I de næste 400 tick falder uret med 100, fordi arsenalets 300 tick nu bruges.
3. **Kvoten**:
   - `_turStart` sætter `tur.vejledning` til `null`.
   - Den anden ejer har sin egen kvote: uret falder 0 over 120 tick.
   - Den første ejer i sin næste tur: uret falder 120 over 120 tick.
4. **`aktiv:false`** starter uret igen i næste tick, og `delta().h.vj` er `undefined`.
5. **Replikering**:
   - Snapshot → `genskab` → `anvendDelta` giver `tur.vejledningRest` 1200 efter 600 tick.
   - Det er en rigtig kopi: ændres snapshottet, ændres værten ikke.
6. **Determinisme**:
   - Samme frø og skriptede input med og uden en no-op-kommando (`aktiv:false`) giver samme tilstand i hvert tick.
   - `rngSim` kaldes ikke i grenen (samme vagtteknik som `kamera_determinisme.mjs:78-82`).
7. **Trinmaskinen**:
   - To minutter i `opdater` uden handling står stadig på `gaa 1/5`. Det er testen for, at der ikke er et skjult ur.
   - 0,67 s gang giver `ok`, og efter 450 ms står `hop` fremme.
   - Et `vaabenValgt` før tid springes over, og tælleren hopper til `3/5`.
   - `tast('Space', {egenTur:true})` returnerer `null`.
   - Efter `skudAffyret` gemmes flaget, og `ur(false)` kaldes.
   - Slutkortet kommer først i `skade`, med `mangler`.
   - Ved næste spillers tur gør Space intet, og Esc lukker kortet uden banneret om at springe over.
   - Et nyt objekt med flaget sat gør intet ved `dinTur`.
8. **Hele suiten**: `node --test test/` skal stadig være grøn. Kameratestene kører en rigtig verden uden kommandoen.

**Manuelt**
- Lokalt med ryddet `localStorage`: film → nedtælling → kort `1/5` over våbenbjælken → "Uret venter" og bjælken under tururet → gå, hop, sigt, våben, skyd hver med ✓. Mellemrum lader op og skyder normalt. Slutkortet kommer, når verden er i ro. Mellemrum lukker det, og der starter ingen opladning i næste tur. Flaget er `'1'`.
- Esc på et kort springer over, og banneret vises. Det næste Esc åbner pausemenuen. Med Fjernsupport annullerer Esc markøren, ikke vejledningen.
- Tab under trin 4: uret står stille via kvoten. Efter vejledningen har arsenalet stadig sine 5 s.
- Tilfældige regler med 15 s tur: den første tur løber ikke ud midt i vejledningen.
- Ét tastatur med tre spillere: vejledningen kommer én gang. I spiller 2's tur viser slutkortet "Tryk Esc for at lukke", og mellemrum lader op for spiller 2.
- Netværk med to browsere og vejledning hos gæsten:
  - Værten ser bjælken og banneret "… lærer styringen".
  - Efter 30 s kører uret hos begge.
  - En `vejledning` sendt fra devtools i modstanderens tur afvises.
  - Gentagne kommandoer i egen tur stopper ved 30 s pr. kamp.
- Tilskuer: ser bjælken, men intet kort.
- Pausemenuen:
  - "Vis vejledningen igen" i egen tur starter `1/5` med det samme; i modstanderens tur starter den ved næste `dinTur`.
  - "Alle taster" åbner oversigten. Mellemrum og piletaster gør intet, mens oversigten er åben; det er rettelsen af den eksisterende fejl.
- Reduceret bevægelse: ✓ skifter med det samme. UI-størrelse 150 % og 1280×720: kortet står over bjælken. Klik på "… fortsætte" virker, og knappen beholder ikke fokus.

## Risici

- **Flettekonflikter med de andre agenter.**
  - `main.js`: hunken i `turStart` ligger lige under `visning.kamera.etabler(b)` (`:655`). Hold den til sletningen af `:678-680`.
  - `hud.js`: navneskiltene (kameraet) og HP-bjælken (punkt 1). Min ændring holder sig til `hud-ure`-blokken og én import.
  - `world.js`: startpladserne. Min ændring ligger i `_handling`, `_maskine`, `_turStart` og `genskab`, ikke i `udsaet`.
  - Vent til kameraagentens hunks er landet.
- **Gratis tid.** En spiller i vejledningen kan gå og sigte gratis i op til 30 s én gang pr. kamp, og en snydende klient kan tage de 30 s i hver kamp, men ikke i hver tur. Det er synligt for alle. Senere kunne værten få en indstilling til at slå det fra.
- **Afbrudt forbindelse.** Hvis gæsten mister forbindelsen midt i vejledningen, venter uret højst resten af kvoten.
- **Ét tastatur.** Strækker vejledningen sig over flere ture, får hver lokal ejer sin kvote (`ejer: x.pid`, `net/transport.js:156`). I praksis sker det sjældent, fordi uret venter i den første tur.
- **Kvoten slipper.** Løber kvoten ud midt i et trin, går uret videre uden varsel. Det afbødes af bjælken, der løber ned lige over tallet.
- **Kortet over kunden.** Kortet står nederst. Med det tættere kamera og ved 720p kan det dække kundens fødder. Hold teksten på højst to linjer, eller lad kameraet reservere plads til `--bund-h`.
- **Netstatus.** `.netstatus` ligger samme sted (`app.css:349-352`). Kortet løftes med `:has()` (Chrome 105+, Safari 15.4+, Firefox 121+). Ældre browsere får overlap.
- **Nyt flag.** v2 betyder, at veteraner ser vejledningen én gang til. Esc lukker den med det samme.
- **Oversigten sluger nu tasterne.** Det er en tilsigtet ændring af en eksisterende fejl.
- **Pausemenuen er ikke en pause** (`worker.js:84-107`), heller ikke lokalt, og `menu.js:331` antyder det modsatte. Tiden i menuen går stadig fra turen, også før man trykker "Vis vejledningen igen". Det er uden for dette punkt og bør rettes for sig.
- **Hændelser for "skyd".** Et fremtidigt våben, der ikke sender nogen af de fem hændelser, ville aldrig klare trinnet. Man kan så stadig trykke Esc, eller vejledningen fortsætter i næste tur. Når der kommer en ny våbentype, skal listen udvides.