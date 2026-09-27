# Karaktervalget — opsætningen i Tekken-stil

Opsætningen før en kamp er et forløb i tre trin, som i et fightingspil:

1. **Karakterer.** Hver spiller navigerer rundt i rosteret og vælger **sin
   fighter** og **sit hold**: blåt (venstre) eller rødt (højre). Fighteren
   vises stort med en bevægende figur og et navneskilt. Med højst to
   spillere får man det ledige hold, når man vælger fighter (se Automatisk
   hold); med flere skal man selv vælge hold.
2. **Bane.** Alle stemmer på en bane.
3. **Regler.** Værten sætter reglerne, de andre ser dem. Her står den store
   **Start**-knap (det gamle Klar), som alle, også værten, trykker på. Når
   alle har trykket, tæller spillet automatisk 3-2-1 ned. Så starter kampen:
   først filmintroen (`docs/filmintro.md`), så nedtællingen og faldet fra
   himlen.

- **Én figur pr. spiller.** Man ER sin fighter. Et hold består af sine
  spilleres fightere: 1 mod 1 er én figur mod én, 2 mod 1 er to mod én.
- **Kun blåt og rødt hold,** til en start.
- **Gruppen følges ad.** Valg, stemmer og regler er fælles og kommer med
  lobbybeskeden. Trinnet er hver skærms eget, men ingen kommer længere end
  **gruppens trin**: det første trin, som ikke alle aktive deltagere (ikke
  tilskuere, tilsluttede) har gjort.
  - **Gjort:** Karakterer med fighter og hold, Bane med en stemme, Regler
    med Start (klar). Klar tæller som alle tre.
  - **Videre af sig selv:** har spilleren gjort sit trin, og kommer gruppen
    forbi det, går skærmen selv videre til gruppens trin, efter ca. 0,9 s
    og når rummet har bekræftet valget. Har man valgt hold, går man altså
    selv videre til Bane, når de andre også er færdige.
  - **Kun det, rummet har set:** skærmen viser et valg med det samme, men
    det automatiske hold er kun et gæt, til rummets svar kommer. Næste og
    trinbjælken fører ikke fra Karakterer på et gættet hold, og et ventende
    valg gør én "ikke klar" med det samme, som i rummet. Kommer svaret ikke
    inden 1,5 s, går skærmen ikke videre på den gamle lobby, men venter på
    den næste.
  - **For langt fremme:** står man alligevel på et trin, man ikke har gjort
    det forrige af (rummet gav intet hold, et svar kom for sent), siger
    ventelinjen og statuslinjen, hvad der mangler: "Vælg blåt eller rødt
    hold først. Gå tilbage til Karakterer." Skærmen går ikke selv tilbage.
    Start gør ingen klar uden hold eller uden stemme (klar tæller som alle
    tre trin); uden fighter bliver det stadig Tilfældig.
  - **Venter:** er de andre ikke færdige, venter spilleren på trinnet:
    "Venter på Bo og Carla …".
  - **Aldrig tilbage af sig selv:** kommer der en ny deltager til, bliver de
    andre, hvor de er, men kommer ikke længere, før han har indhentet dem.
  - **Selv tilbage:** man kan gå tilbage og ændre et valg. Så går skærmen
    selv videre igen til det fjerneste trin, gruppen er nået. Kigger man
    bare, bliver man, til man selv går frem.
  - **Tilskuere:** kommer man ind midt i en kamp, er man tilskuer, og de
    andre venter ikke på én. Ens egen skærm tæller én med: den åbner på
    Karakterer, og man kommer ikke længere end det, man selv har gjort (som
    tilskuer får man intet automatisk hold). På Regler står der "Kampen er i
    gang. Du er med i den næste." Når kampen er slut, er man med som alle
    andre.
- **Ét tastatur (lokalt):** spillerne handler efter tur inden for hvert trin:
  den første, der ikke har gjort gruppens trin. Spiller 1 vælger fighter, så
  Spiller 2; Spiller 1 stemmer, så Spiller 2. På Regler sætter værten
  (Spiller 1) reglerne, og ét tryk på Start gør alle ved tastaturet klar. Et
  klik på en spiller i toplinjen giver ham turen, så han kan ændre sit. Der
  er to spillere fra start, og en knap tilføjer flere.
  - **Overdragelsen:** den, der lige har valgt (fighter, hold eller bane),
    beholder turen ca. 0,9 s, og hvert nyt valg starter tiden forfra. Så
    gælder et dobbeltklik, to hurtige Enter og Q/E eller ←→ lige efter
    valget ham selv og ikke den næste, og hans valg står, mens
    `.kv-aktoer` siger "Spiller 2s tur …". Flytter hans valg gruppen videre,
    beholder han turen, til skærmen går videre, så pausen viser hans valg.
    Et klik på en spiller i toplinjen og "+ Tilføj spiller" afbryder den.

## Rosteret

Klinikkernes seks ansatte, `static/js/core/roster.js` (spejlet i `rum.py`
som `ROSTER`, og de to skal være ens):

| figur | navn | åben |
|---|---|---|
| 16 | Skrankepaven Ingrid | ja |
| 17 | Bente "Bare Rolig" Hansen | nej |
| 18 | Hansen, Dr. Hansen | nej |
| 19 | Praktikant Trine | nej |
| 20 | Systemsygeplejerske 2.0 | nej |
| 21 | Dr. Jan fra Mors | ja |

- **Låste karakterer** står i rosteret som "Kommer snart" og kan ikke
  vælges. En karakter åbnes ved at lægge dens figur i `AABNE` i
  `core/roster.js` og i `ROSTER_AABNE` i `rum.py`.
- **Samme karakter** må vælges flere gange og af flere hold (spejlkamp).
  Nummer to og tre får et romertal: "Dr. Jan fra Mors II". Der tælles
  gennem hele kampen i holdrækkefølge og derefter pladsrækkefølge, så alle
  navne i kampen er forskellige.
- **Tilfældig** (`'tilfaeldig'`) er et valg. Det trækkes først, når kampen
  starter. Pladser uden valg trækkes også tilfældigt blandt de åbne.

## Protokol

### Lobbybeskeden (`{t:'lobby', d}`)

Felterne er de samme som før, med disse ændringer:

| Felt | Værdi |
|---|---|
| `hold` | præcis to hold: `[{id:0, farve:'blaa', navn, baevere}, {id:1, farve:'roed', navn, baevere}]` |
| `hold[].baevere[]` | **afledt af deltagerne:** én plads pr. deltager på holdet (ikke tilskuere), i den rækkefølge, de kom ind: `{id:'b_<pid>', navn, udseende, ejer:<pid>, valg}` |
| `deltagere[].hold` | `null` (intet hold endnu), `0` (blåt) eller `1` (rødt) |
| `deltagere[].valg` | `null` (ingen fighter), et figurnummer fra rosteret, eller `'tilfaeldig'` |
| `deltagere[].stemme` | `null` eller en banetype: `'fort'`, `'aaben'`, `'hule'`, `'oeer'` eller `'tilfaeldig'` |
| `deltagere[].lokal` | kun i det lokale rum: `true` for spillerne ved tastaturet |
| `nedtaelling_ms` | `null`, eller hvor mange ms der er tilbage af nedtællingen, da beskeden blev sendt |
| `bane_trukket` | `null`, eller den banetype, der er trukket (sat, mens nedtællingen løber) |
| `indst` | `turtid`, `kamptid`, `vind`, `vejr`, `bane` og `banetype` (bruges, når ingen har stemt). Antal hold og kunder pr. hold findes ikke længere |

**En plads** med et figurvalg har `udseende = {v:5, figur, fast:true}` og
`navn` = karakterens navn (med romertal). En plads med `'tilfaeldig'` har
`udseende = {}` og `navn = 'Tilfældig'`. En plads uden valg har
`udseende = {}` og `navn = ''`.

### Beskeder til rummet

Alle beskeder gælder **afsenderens egen** fighter, hold og stemme. I det
lokale rum må de bære `som: <pid>`, hvor pid er den lokale spiller, der
handler; uden `som` er det spiller 1. Serveren ignorerer `som`.

| `t` | Hvem | `d` | Virkning |
|---|---|---|---|
| `vaelg` | alle deltagere | `{figur}` — et åbent figurnummer, `null` eller `'tilfaeldig'` | Sætter min fighter. Jeg er ikke længere klar. Har jeg intet hold, og er vi højst to aktive spillere, får jeg det ledige hold (se Automatisk hold). Fejl: `laast_karakter` |
| `hold` | alle deltagere | `{hold}` — `0`, `1` eller `null` | Sætter mit hold. Jeg er ikke længere klar. Fejl: `ukendt_hold` |
| `stem` | alle deltagere | `{banetype}` — en af de fem ovenfor, eller `null` | Sætter min stemme. Jeg er ikke længere klar. Fejl: `ukendt_bane` |
| `klar` | alle deltagere, **også værten** | `{klar: bool}` | `klar:true` kræver et hold. Fejl: `vaelg_hold` ("Vælg blåt eller rødt hold først.") |
| `indst` | værten | som før, uden `hold` og `baevere_pr_hold` | **Alle** er ikke længere klar |
| `start` | værten | `{}` | Start med det samme, uden nedtælling. Kræver begge hold med mindst én spiller, og at alle andre er klar. Skærmen bruger den ikke; den er værtens nødstart |
| `ny_spiller` | kun lokalt | `{}` | Tilføjer en lokal spiller ("Spiller 3"), højst 8 |
| `fjern_spiller` | kun lokalt | `{pid}` | Fjerner en lokal spiller. Der bliver altid mindst to |

`saede` findes ikke længere; man "sidder" på det hold, man har valgt.
`navngiv` modtages, men gør ingenting.

### Automatisk hold

- **Hvornår:** en spiller uden hold vælger en fighter (et figurnummer eller
  `'tilfaeldig'`, ikke `null`), og der er højst to **aktive** spillere. Aktive
  tælles som til nedtællingen: deltagere, der ikke er tilskuere, og som på
  serveren er tilsluttede; lokalt alle ved tastaturet.
- **Hvilket hold:** det ledige, altså holdet med færrest spillere, talt som
  holdreglen for at starte (`_hold_fejl`) tæller dem: alle på holdet, der
  ikke er tilskuere, også en, der har mistet forbindelsen og stadig står på
  sit hold (i 90 s). Ellers kunne to ende på samme hold, mens den ene var
  væk, og nedtællingen ville aldrig starte. Står det lige, bliver det blåt
  (`0`). Har ingen valgt hold selv, får den første, der vælger fighter, blåt
  og den anden rødt.
- **Samme lås som valget:** to spillere, der vælger samtidigt, ender på hvert
  sit hold.
- **Et hold, man har,** røres ikke, heller ikke når man vælger om. Man kan
  altid skifte med `hold`.
- **Med flere end to aktive spillere** tildeles intet hold. Hver vælger selv,
  og skærmen lader ikke spilleren gå videre uden et hold.
- Lokalt gælder det samme: med to spillere ved tastaturet får Spiller 1 blåt
  og Spiller 2 rødt, når de vælger fighter efter tur.

### Den automatiske nedtælling

- **Hvornår den starter:** rummet venter på spillere (`fase = 'venter'`),
  alle tilsluttede deltagere, der ikke er tilskuere, er klar (og dermed har
  valgt hold), og begge hold har mindst én spiller.
- **Når den starter:**
  - Banen trækkes. Hver stemme er ét lod, og 'tilfaeldig' giver en af de
    fire baner.
  - Uden stemmer bruges reglernes `banetype`, som standard `fort`.
  - Den trukne bane står i `bane_trukket`, og nedtællingen i
    `nedtaelling_ms` (3000).
- **Annulleres:** så snart betingelserne ikke længere holder. Det sker,
  når nogen trykker Ikke klar, vælger om, skifter hold, stemmer om, værten
  ændrer reglerne, en ny deltager kommer ind, eller en deltager forsvinder.
  `nedtaelling_ms` og `bane_trukket` bliver `null` igen.
- **Efter 3 s**, hvis betingelserne stadig holder, starter kampen:
  1. Banen fra `bane_trukket` skrives i `indst.banetype`.
  2. Fightere uden valg og med 'tilfaeldig' får en tilfældig åben
     karakter. Pladserne får `udseende` og `navn`.
  3. Rummet sender `{t:'start', d:{indst, hold}}`, hvor `hold` er de to hold
     med én plads pr. spiller.

Efter `start` sender rummet en ny lobby (`fase:'i_gang'`, ingen nedtælling),
så ingen klient har en gammel nedtælling liggende. En spiller, der kommer
tilbage midt i en kamp, han er med i, får `start` igen (efter lobbyen).

### Efter kampen og omkamp

- **Kampen er slut,** når værten sender `slut` videre. Lokalt melder main.js
  det til det lokale rum.
- **Rummet går tilbage til `fase:'venter'`:**
  - ingen er klar, og ingen er tilskuer længere;
  - hold, fighter og stemme bevares;
  - rummet sender en ny lobby.
- **Klienterne bliver på sejrsskærmen.** Lobbyen gemmes kun, så de andres
  valg ikke trækker én væk.
- **Spil igen** åbner karaktervalget på Regler, hvor Start står
  (`menu.vis('lobby', t, { trin: 'regler' })`; `'klar'` er det samme), dog
  højst på gruppens trin. Det sender `klar:true` for spilleren, lokalt for
  alle ved tastaturet. Når alle har trykket Spil igen (eller Start), tæller
  rummet ned som før.
- **Vil man skifte** fighter eller hold, går man tilbage og vælger om (så er
  man ikke længere klar og trykker Start igen), eller trykker Ikke klar.
- **Nye spillere efter kampen** vælger hold og fighter og trykker Start som
  alle andre; de andre venter på dem.

Lokalt (`lavLokaltRum` i `static/js/net/transport.js`) er semantikken den
samme; nedtællingen er en `setTimeout`.


## DOM og CSS (til art directoren)

Skærmen bygges af `static/js/ui/karaktervalg.js` og ligger i menuens rod
(`#menu.menu.kv-menu`). JS bygger strukturen én gang og skifter derefter kun
klasser, data-attributter og tekster; hver lobbybesked opdaterer kun det, der
har ændret sig. **Alt udseende** ligger i `static/karaktervalg.css`, som er en
pladsholder: den må skrives helt om, så længe klassenavnene og hooks nedenfor
bruges.

| Art directoren | Teknik |
|---|---|
| `static/karaktervalg.css` — layout, farver, animationer | `static/js/ui/karaktervalg.js` — DOM, tastatur, nedtælling |
| `static/grafik/intro/` — loops, portrætter, banebilleder | `static/js/ui/menu.js`, `main.js`, rummet |
| `intro.json` → `valg_video`, `valg_video_safari`, `portraet` | teksterne i `T.kv` i `static/js/ui/tekst.js` |

### Se den

- **Ét tastatur:** Lokalt spil. Spiller 1 vælger først, så Spiller 2; så
  stemmer de efter tur, og ét tryk på Start på Regler gør begge klar.
- **Netværk:** Netværk → Vær vært. Åbn rumlinket i et andet vindue for en
  modstander. Vælg i det ene vindue for at se ventetilstanden i det andet.
- Ret CSS'en, og genindlæs siden.

### Strukturen

```html
<div class="kv" data-trin="karakterer|bane|regler" data-gruppe="karakterer|bane|regler"
     data-zone="top|hold|gitter|fod" data-net="0|1" data-vaert="0|1" data-klar="0|1"
     data-venter="0|1" data-videre="0|1" [data-nedtaelling="1"]>
  <header class="kv-top">
    <div class="kv-rum">
      <h1 class="kv-titel">Opsætning</h1>
      <div class="kv-rumkode"><span class="lbl">Rumkode</span><b class="kv-kode">ABCDE</b>
        <button class="btn sm kv-kopier">Kopiér link</button><span class="kv-kopieret">Linket er kopieret</span></div>
      <!-- lokalt: <div class="kv-rumkode kv-lokalt">Lokalt spil</div> -->
    </div>
    <nav class="kv-trin">
      <!-- tre trin: Karakterer · Bane · Regler -->
      <button class="kv-trin-knap" data-trin="karakterer" aria-current="step" data-faerdig="0|1"
              data-tilladt="0|1" [aria-disabled="true"] [data-gruppe="1"]>
        <span class="kv-trin-nr">1</span><span class="kv-trin-navn">Karakterer</span></button>
      <span class="kv-trin-skille">·</span> …
    </nav>
    <ul class="kv-deltagere">
      <li class="kv-deltager" data-pid data-klar data-mig data-vaert data-tilskuer data-forbundet data-lokal data-klinik
          data-fremskridt="0|1|2|3" data-mangler="0|1">
        <span class="kv-deltager-klar">✓</span><span class="kv-deltager-navn">Anna</span>
        <!-- lokalt: navnet er en <button class="kv-deltager-knap" data-tur="pid"> (giver ham turen;
             disabled for den, der har den), ekstra spillere har <button class="kv-deltager-fjern">×</button> -->
      </li>
      <li class="kv-deltager-ny"><button class="btn sm kv-ny-spiller">+ Tilføj spiller</button></li> <!-- kun lokalt -->
    </ul>
  </header>

  <main class="kv-midt">
    <section class="kv-skaerm kv-karakterer" data-trin="karakterer">
      <div class="kv-side" data-side="venstre">
        <section class="kv-hold [mit]" data-hold="0" data-side="venstre" data-klinik="blaa">
          <h3 class="kv-hold-navn"><span class="kv-hold-farve">Blåt hold</span> Speciallægeselskabet Mogensen</h3>
          <div class="kv-hold-fightere" data-side="venstre" data-antal="2">
            <div class="kv-fighter" data-nr="0" data-pid="p1" …>…</div>   <!-- forrest; se Fighterne nedenfor -->
            <div class="kv-fighter" data-nr="1" data-pid="p3" …>…</div>
          </div>
          <ul class="kv-spillere">
            <li class="kv-spiller [mig] [klar] [valgt] [tilfaeldig] [lokal] [tom]" data-pid data-figur>
              <span class="kv-spiller-portraet"><img class="kv-spiller-billede"> | <span class="kv-spiller-tegn">?</span></span>
              <span class="kv-spiller-tekst"><span class="kv-spiller-fighter">Dr. Jan fra Mors</span>
                <span class="kv-spiller-navn">Anna</span></span>
              <span class="kv-spiller-klar">✓</span>
            </li>
          </ul>
        </section>
      </div>

      <div class="kv-vaelger">
        <div class="kv-aktoer" [data-overdrag="1"]><b>Spiller 2 vælger</b></div>   <!-- kun lokalt; tom, mens skærmen går videre;
                                                                          under overdragelsen "Spiller 2s tur …" og data-overdrag="1" -->
        <p class="kv-venter" data-tilstand="venter|videre|hold|mangler" [hidden]>…</p>   <!-- se Ventelinjen nedenfor -->
        <div class="kv-fighter-plads" data-side="midt"></div>          <!-- min fighter, før jeg har valgt hold -->
        <div class="kv-holdvalg">
          <button class="kv-holdknap" data-klinik="blaa" data-side="venstre" aria-checked="true|false">
            <span class="kv-holdknap-farve">Blåt hold</span><span class="kv-holdknap-navn">…</span></button>
          <span class="kv-holdvalg-vs">VS</span>
          <button class="kv-holdknap" data-klinik="roed" data-side="hoejre" aria-checked="…">…</button>
        </div>
        <div class="kv-rooster">
          <!-- rækkefølgen: 16, 17, 18, Tilfældig, 19, 20, 21 — Tilfældig i midten; ←→ følger den -->
          <button class="kv-felt [markoer] [valgt] [afvist]" data-i="0" data-figur="16" data-klinik="groen" data-aaben="1"
                  aria-pressed aria-disabled>
            <span class="kv-felt-portraet"><img class="kv-felt-portraet-billede"></span>
            <span class="kv-felt-navn">Skrankepaven Ingrid</span><span class="kv-felt-rolle">Sekretær</span>
            <span class="kv-felt-laas">Kommer snart</span>          <!-- kun låste -->
            <span class="kv-felt-maerker"><i class="kv-maerke [mit]" data-pid data-klinik="blaa|roed|ingen">AN</i></span>
          </button>
          …
          <button class="kv-felt" data-i="3" data-figur="tilfaeldig" data-aaben="1">…<span class="kv-felt-portraet-tegn">?</span>…</button>
          …
        </div>
        <div class="kv-rooster-note"><p class="kv-note">…</p></div>
        <div class="kv-uden-hold"><span class="lbl">Uden hold</span><span class="kv-uden-hold-navn">Carla</span></div>
      </div>

      <div class="kv-side" data-side="hoejre"><section class="kv-hold" data-hold="1" data-klinik="roed">…</section></div>
    </section>

    <section class="kv-skaerm kv-banevalg" data-trin="bane">
      <h2 class="kv-overskrift">Stem på en bane</h2>
      <div class="kv-aktoer"><b>Spiller 2 stemmer</b></div>            <!-- kun lokalt -->
      <div class="kv-baner">
        <button class="kv-bane [markoer] [min-stemme]" data-bane="fort" data-stemmer="2" aria-pressed>
          <span class="kv-bane-billede"></span><span class="kv-bane-navn">Fort</span>
          <span class="kv-bane-antal">2 stemmer</span>
          <span class="kv-bane-stemmer"><i class="kv-stemme [mit]" data-pid title="Thomas Sørensen">TS</i></span>
        </button> …
      </div>
      <p class="kv-venter" data-tilstand="venter|videre|mangler" [hidden]>…</p>
      <p class="kv-note">Alle stemmer — banen trækkes blandt stemmerne</p>
    </section>

    <section class="kv-skaerm kv-regelvalg" data-trin="regler">
      <h2 class="kv-overskrift">Kampens regler</h2>
      <p class="kv-note kv-regler-hvem">Du er vært og sætter reglerne.</p>
      <div class="kv-regler [laast]">                                  <!-- laast: ikke værten -->
        <div class="ir kv-regel [fokus]" data-navn="turtid"><span class="kv-regel-navn">Tid pr. tur</span>
          <div class="ir-valg"><button class="ir-knap [paa]" data-indst="turtid" data-v="30">30 s</button> …</div></div>
        …
        <button class="btn kv-tilfaeldige-regler [fokus]">🎲 Tilfældige regler</button>   <!-- kun værten -->
      </div>
      <p class="kv-note kv-regler-note">Ændres en regel, skal alle trykke Start igen.</p>
      <!-- Start: det gamle Klar-trin, nu nederst på Regler -->
      <div class="kv-start-boks" data-klar="0|1">
        <button class="btn pri stor kv-start-knap [fokus]" data-handling="start" data-klar="0|1" aria-pressed="false|true">Start</button>
        <!-- trykket: teksten er "Ikke klar"; lokalt gælder den alle ved tastaturet -->
        <p class="kv-venter" data-tilstand="venter|hold|mangler" [hidden]>…</p>
        <p class="kv-note kv-start-note">Kampen starter, så snart alle har trykket Start.</p>
        <ul class="kv-start-deltagere"><li class="kv-deltager" data-klar data-mangler …>…</li></ul>   <!-- som i toplinjen, uden knapper -->
      </div>
    </section>
  </main>

  <footer class="kv-fod">
    <button class="btn sek kv-tilbage">Tilbage</button>
    <div class="kv-fod-midt"><div class="venter kv-status" id="lStatus">Venter på Bo …</div>
      <div class="kv-taster"><span>…</span></div></div>
    <div class="kv-fod-knapper">
      <button class="btn sek kv-opt">Indstillinger</button><button class="btn sek kv-forlad">Forlad</button>
      <button class="btn kv-naeste [pri]" data-cta="0|1" [aria-disabled="true"]>Næste: Bane</button>   <!-- skjult på Regler -->
    </div>
  </footer>

  <div class="kv-nedtaelling" data-tal="3|2|1">
    <div class="kv-nedtaelling-tal"><span class="kv-tal" data-tal="3">3</span></div>
    <div class="kv-nedtaelling-bane [afsloeret]" data-bane="fort">
      <span class="kv-nedtaelling-lbl">Banen</span><b class="kv-nedtaelling-navn">Fort</b></div>
    <button class="btn sek kv-annuller">Annullér (Esc)</button>
  </div>
</div>
```

**Fighterne:** begge hold viser deres fightere stort, som i Tekken og Street
Fighter. Hvert `.kv-hold` har en `.kv-hold-fightere` med én `.kv-fighter` pr.
spiller på holdet:

- **Rækkefølgen** står i `data-nr` (og DOM-rækkefølgen er den samme). `0` er
  forrest: spilleren, der handler (lokalt: den, hvis tur det er), når han er
  på holdet, ellers den første, der kom ind. `1`, `2`, `3` … følger i den
  rækkefølge, de kom ind. `.kv-hold-fightere[data-antal]` er antallet.
- **Hver viser spillerens eget valg.** Den, der handler, viser markørens
  karakter, mens han kigger i rosteret (`data-forhaand="1"`).
- **Mediet:** kun nr 0 har loopet (`data-kilde="video"`); nr 1 og bagud starter
  ved portrættet og falder videre til figurarket.
- **Uden valg:** `data-kilde="tom"` og en tom scene (CSS'en viser et svagt "?").
- **Navneskilt:** hver fighter har sit eget `.kv-navneskilt`; CSS'en viser
  kun nr 0's.
- **Midten:** før jeg har valgt hold, står min fighter (`data-nr="0"`,
  `data-side="midt"`) i `.kv-fighter-plads[data-side=midt]`; ellers er den
  plads skjult. Andre uden hold har ingen fighter (de står i `.kv-uden-hold`).

Elementerne hører til spilleren (pid) og flyttes med ham mellem holdene og
midten; forlader han rummet, forsvinder hans element.

```html
<div class="kv-fighter" data-nr="0|1|2|…" data-pid="p1" data-side="venstre|hoejre|midt" data-klinik="blaa|roed|ingen"
     data-figur="16|tilfaeldig|" data-kilde="video|portraet|figur|tilfaeldig|tom|venter"
     data-aaben="0|1" data-forhaand="0|1" style="--klinik-farve:…;--klinik-tekst:…">
  <div class="kv-fighter-scene">
    <video class="kv-fighter-video" muted loop playsinline autoplay><source …><source …></video>
    <!-- eller <img class="kv-fighter-billede kv-aande">, <canvas class="kv-fighter-figur">
         eller <span class="kv-fighter-tegn">?</span> -->
  </div>
  <div class="kv-navneskilt">
    <span class="kv-navneskilt-klinik">Speciallægeselskabet Mogensen</span>
    <span class="kv-navneskilt-navn">Skrankepaven Ingrid</span>
    <span class="kv-navneskilt-rolle">Sekretær</span>
    <span class="kv-navneskilt-spiller">Thomas Sørensen</span>
  </div>
</div>
```

**Gruppen og ventelinjen.** Skærmen følger gruppen (se øverst):

- **`.kv[data-gruppe]`** er gruppens trin. Står spilleren længere fremme
  (en ny deltager er kommet til), er `data-trin` større end `data-gruppe`.
- **`.kv[data-venter="1"]`:** spilleren har gjort sit trin og venter på
  de andre (eller, på Regler, har alle trykket Start, men et hold er tomt).
- **`.kv[data-videre="1"]`:** alle har gjort trinnet, og skærmen går selv
  videre om ca. 0,9 s. Det gjorte valg står imens (fighteren, stemmen);
  `.kv-aktoer` er tom.
- **`.kv-venter`** er ventelinjen. Hvert trin har sin egen (i `.kv-vaelger`,
  under `.kv-baner`, og i `.kv-start-boks` under Start); kun det viste trins
  er udfyldt, og den er `hidden`, når der ikke ventes. `data-tilstand`:
  - `venter`: `<span class="kv-venter-lbl">Venter på</span> <b class="kv-venter-navn"
    data-pid data-klinik style="--klinik-farve…">Bo</b> og <b …>Carla</b> …`
  - `videre`: `<span class="kv-venter-lbl">Videre til</span> <b class="kv-venter-trin">Bane</b> …`
  - `hold` (kun Regler): `<span class="kv-venter-lbl">Der skal være spillere på begge hold</span>`
    (eller "Venter på en modstander …", når man er alene)
  - `mangler` (Bane og Regler): spilleren står et trin længere fremme end det,
    han har gjort: `<span class="kv-venter-lbl">Vælg blåt eller rødt hold først.</span>
    <b class="kv-venter-trin">Tilbage til Karakterer</b>`
- **Statuslinjen** (`#lStatus`) siger det samme i ord, og ellers, hvad
  spilleren skal gøre ("Vælg din fighter", "Tryk Start, når du er klar",
  lokalt under overdragelsen "Spiller 2s tur …", og for en tilskuer på
  Regler "Kampen er i gang. Du er med i den næste.").
- **Næste** (`.kv-naeste`) når kun til gruppens trin. Ellers har den
  `aria-disabled="true"` (og `data-cta="0"`) og kan stadig få markøren: et
  tryk siger hvorfor (et ryst, `.afvist`, og en besked). Det samme gælder
  `.kv-trin-knap[data-tilladt="0"]`.
- **Uden hold** (flere end to spillere): fighteren står i midten, rosterets
  note beder om hold, og Næste er spærret, til han har valgt.

### Hooks

| Hook | Betydning |
|---|---|
| `.kv[data-trin]` | trinnet, spilleren står på (`karakterer`, `bane`, `regler`); kun trinnets `.kv-skaerm` er synlig (de andre har `hidden`) |
| `.kv[data-gruppe]` | gruppens trin: det første, som ikke alle har gjort. Højere trin kan ikke nås endnu |
| `.kv[data-venter="1"]` | spilleren har gjort sit trin og venter på de andre (se `.kv-venter`) |
| `.kv[data-videre="1"]` | alle har gjort trinnet; skærmen går selv videre om ca. 0,9 s |
| `.kv[data-zone]` | hvor tastaturets markør er: `top`, `hold` (holdvalget), `gitter` (trinnets indhold; på Regler reglerne, 🎲 og Start) eller `fod`. Uden for `gitter` er rosterets markør "hvilende" |
| `.kv[data-net]`, `[data-vaert]` | netværksspil, og om spilleren er vært (lokalt: spiller 1) |
| `.kv[data-klar="1"]` | spilleren har trykket Start (lokalt: alle ved tastaturet). Valgene står **ikke** fast: vælger han om, er han ikke længere klar |
| `.kv[data-nedtaelling]` | nedtællingen vises |
| `.fokus` | tastaturmarkøren på en knap (top- og fodlinjen, holdknapperne, en regelrække, 🎲, Start-knappen). Markøren har også DOM-fokus, så `:focus-visible` står samme sted |
| `.markoer` | rosterets eller banernes markør (også, når musen står over feltet) |
| `.valgt`, `aria-pressed="true"` | felt: spillerens fighter. `.min-stemme`: spillerens bane |
| `.afvist` | et valg eller et skridt blev afvist (låst karakter, spærret Næste eller trin, Start uden hold); sat i 0,45 s — ryst eller blink |
| `.kv-start-knap[data-klar]`, `[aria-pressed]`, `.kv-start-boks[data-klar]` | Start-knappen på Regler: `0` "Start", `1` trykket ("Ikke klar") |
| `.kv-venter[data-tilstand]` | ventelinjen: `venter`, `videre`, `hold` eller `mangler`; `.kv-venter-lbl`, `.kv-venter-navn[data-pid][data-klinik]`, `.kv-venter-trin` |
| `.kv-aktoer[data-overdrag="1"]` | ét tastatur: den, der lige har valgt, beholder turen et øjeblik; teksten er "Spiller 2s tur …" |
| `.kv-deltager[data-fremskridt]` | hvor mange trin deltageren har gjort: `0`–`2`, `3` er klar |
| `.kv-deltager[data-mangler="1"]` | spilleren venter på ham |
| `.kv-deltager-knap[data-tur]` | ét tastatur: giv den spiller turen (`disabled` for den, der har den, og under nedtællingen) |
| `[data-figur]` | 16–21, `tilfaeldig`, eller tom (intet valg) |
| `[data-klinik]` | holdets farve: `blaa` (blåt) eller `roed` (rødt); `ingen`, før der er valgt hold. På rosterets felter er det karakterens egen klinik (`groen`, `blaa`) |
| `[data-side]` | `venstre` (blåt), `hoejre` (rødt) eller `midt`; spejl fighteren på `hoejre` |
| `[data-aaben="0"]` | låst karakter ("Kommer snart"): silhuet med CSS-filter |
| `.kv-fighter[data-forhaand="1"]` | fighteren viser markørens karakter, som ikke er valgt endnu |
| `.kv-fighter[data-kilde]` | hvilket medie der vises (se nedenfor); `tom` er intet valg, `venter` er intro.json på vej |
| `.kv-hold-fightere > .kv-fighter[data-nr]` | pladsen på holdet: `0` forrest (med loop og navneskilt), `1`, `2` … bagved |
| `.kv-fighter[data-pid]` | spilleren, fighteren hører til |
| `.kv-hold-fightere[data-antal]` | antal fightere på holdet |
| `.kv-hold.mit`, `.kv-holdknap[aria-checked=true]` | spillerens hold |
| `.kv-spiller.mig` / `.kv-deltager[data-mig="1"]` | den spiller, der handler (lokalt: den, hvis tur det er) |
| `.kv-trin-knap[aria-current=step]`, `[data-faerdig="1"]` | trinnet nu, og gjort (af den, der handler) |
| `.kv-trin-knap[data-tilladt="0"]` (+ `aria-disabled="true"`), `[data-gruppe="1"]` | kan ikke nås endnu (gruppen er der ikke); gruppens trin |
| `.kv-naeste[data-cta="1"]` (+ `.pri`) | Næste kan bruges (man er gået tilbage, eller skærmen går snart selv videre) |
| `.kv-naeste[aria-disabled="true"]` | Næste er spærret: gruppen er ikke længere; et tryk siger hvorfor |
| `.kv-nedtaelling[data-tal]`, `.kv-tal` | tallet; `.kv-tal` er et nyt element pr. tal, så dets animation starter forfra |
| `.kv-nedtaelling-bane.afsloeret` | banen er trukket; før det ruller navnene (og `data-bane`) gennem banerne i ca. 0,9 s |
| `#lStatus` | statuslinjen; `.advarsel` ved fejl fra rummet og afviste valg |

### Variabler

| Variabel | Sættes af | Betydning |
|---|---|---|
| `--klinik-farve`, `--klinik-tekst` | JS, på `.kv-hold`, `.kv-fighter`, `.kv-holdknap`, `.kv-maerke`, `.kv-deltager`, `.kv-venter-navn` | holdets farve og tekstfarve (fra `HOLD` i `render/palette.js`) |
| `--kv-markoer` | CSS | markørens farve (gul, som fokus i resten af spillet) |
| `--kv-flade`, `--kv-kant` | CSS | panelernes baggrund og kant |
| `--kv-fighter-h` | CSS | fighterens højde; mindre i midten og på smalle skærme |
| `--ui` | main.js | UI-størrelsen fra Indstillinger; CSS'en skalerer skriftstørrelsen med den, og alt andet er `em` |

### Fighterens kilder

Tre kilder i denne rækkefølge, fra `intro.json` → `figurer[figur]`:

1. **`valg_video` og `valg_video_safari`:** et gennemsigtigt loop (960×1120,
   fødderne på underkanten), kun til holdets forreste fighter (`data-nr="0"`).
   Én `<video>` pr. figur genbruges (to, når samme figur står forrest på begge
   hold), og de åbne karakterers loops hentes, når skærmen åbner. Klippene
   står stille, når Karakterer-trinnet ikke vises, og når skærmen forlades.
   WebKit (Safari og iOS) får
   HEVC-udgaven (`.mov`) som første `<source>`, alle andre VP9 (`.webm`) —
   Chrome på Mac kan afkode HEVC, men ikke med sikkerhed dens alfa.
2. **`portraet`:** billedet med klassen `.kv-aande` (åndedræt i CSS). Her
   starter holdkammeraterne bag den forreste.
3. **Figurarket:** spillets egne tomgangsframes `idle_0-3` på et
   `<canvas class="kv-fighter-figur">`, ca. 4 billeder i sekundet.

Kan et klip ikke spilles, eller et portræt ikke hentes, falder fighteren
videre til næste kilde. Låste karakterer bruger samme medie med
silhuetfilteret. Uden bevægelse (`prefers-reduced-motion`) står klippet på
første billede, figurarket på `idle_0`, og CSS'en slår alle animationer fra.

### Grafik

| Plads | Hook | Forslag |
|---|---|---|
| Banebillede | `.kv-bane[data-bane] .kv-bane-billede` (16:9) | WebP pr. bane, som `background-image` |
| Holdets baggrund | `.kv-hold[data-klinik]`, `.kv-fighter[data-klinik] .kv-fighter-scene` | klinikkens farve, lys, gulv |
| Hele skærmen | `.menu.kv-menu` (arver menuens `--menu-kunst`) | en fightingspil-baggrund |
| Nedtællingen | `.kv-nedtaelling`, `.kv-tal[data-tal]` | tal-grafik, blink |
| Små portrætter | `.kv-felt-portraet-billede`, `.kv-spiller-billede` | samme portræt, beskåret til hovedet i CSS |

### Fjernet med Klar-trinnet

Disse findes ikke længere, og CSS'en til dem kan slettes:

- `.kv-klarside` (`.kv-skaerm[data-trin=klar]`) og alt i den: `.kv-opsummering`,
  `.kv-ops`, `.kv-ops-hold`, `.kv-ops-klinik`, `.kv-ops-baner`, `.kv-ops-regler`,
  `.kv-ops-regel`, `.kv-ops-portraet`, `.kv-ops-billede`, `.kv-ops-navn`,
  `.kv-ops-ejer`, `.kv-ops-klar`, `.kv-klar-boks`, `.kv-klar-knap`,
  `.kv-klar-note`, `.kv-klar-deltagere`. Start-knappen og dens liste står nu
  i `.kv-start-boks` på Regler.
- `.kv[data-laast]`: valgene låses ikke længere, når man er klar (se
  `.kv[data-klar]`). Rosteret, banerne og holdknapperne får derfor heller
  ikke `aria-disabled` af at være klar.
- `.kv-trin-knap[data-sprunget]`: lokale spillere springer ikke reglerne over.
- `.kv-deltager-knap[data-uklar]`: lokalt giver et klik på en spiller nu turen
  (`data-tur`); Start/Ikke klar gælder alle ved tastaturet.

### Skærmstørrelser

- **Bred (over 1000 px og liggende):** blåt hold til venstre, rosteret i
  midten, rødt til højre. Indholdet er højst 1800 px bredt.
- **Smal eller stående (højst 1000 px, eller stående op til 1400 px):**
  holdene side om side øverst, holdvalg og roster under.
- **Telefon (højst 620 px):** kun det aktuelle trin har navn i trinbjælken,
  og fodens knapper deler linje.
- Ingen vandret rulning fra 450 px; midten ruller lodret, hvis det ikke kan
  være der.
- Uden mus og tastatur (`hover: none`) skjules tastetippene.

### Ændringer uden art directoren

`static/karaktervalg.css` er rettet til brugerens nye ønsker, mens art
directoren ikke var med. Udtrykket (arenaen, spotlysene, de skrå holdskilte og
de kursive versalnavne) er det samme. Ret gerne videre.

- **Figuren står over navnet.** Navneskiltet står under fødderne i stedet for
  hen over dem. Under figuren er der plads til to linjers navn
  (`--kv-skilt-h`), og skiltet bliver i holdets søjle: midt under figuren,
  når der er plads, og ellers med kanten ved søjlens inderkant.
- **Fighterne står tættere på hinanden.** De står ved søjlens inderkant i
  stedet for ved skærmkanten, og de må række lidt ind over midten
  (`--kv-ind`, højst 1,6 felt), hvor der er tomt over holdvalg og roster.
  Stående står de to hold side om side og mødes på midten. På lave, liggende
  skærme rækker de ikke ind over midten, fordi holdvalget står i figurens
  højde.
  - Holdkammeraterne bagved står nu ud mod skærmkanten (`--kv-ud`), fordi
    den forreste står inderst. Er der to eller flere på holdet, bliver den
    forreste så meget mindre, at nr 1 står helt på skærmen med ca. 30 % af
    sig fri af ham (`.kv-hold-fightere[data-antal]` regner `--kv-scene-h` og
    `--kv-fig-b` om), og nr 1's forskydning er højst pladsen ud til
    skærmkanten. Tilfældig ("?") og intet valg bagved står i den frie stribe
    ud mod kanten, ikke midt bag den forreste.
  - Holdnavnet og spillerlisten står over fighterne (`z-index:5`), så en
    stor forreste figur ikke dækker listen.
  - Er holdsøjlen for lav (under 13em), vises holdet kun med holdnavn og
    spillerliste.
- **Portrætterne i rosteret er skaleret som figuren.** Felterne har
  portrætternes format (960×1120, tidligere 5:6). Beskæringen viser hele
  hovedet og skuldrene med skalering 1,18, hvor den før var 1,7. Den gamle
  zoom skar hovedet af i siderne og ved hagen, så feltet så ud til at vise en
  anden skala end figuren. Portrættet i spillerlisten viser nu også hele
  hovedet.
- **Midten:** fighteren i midten, før hold er valgt, tager den højde, der er
  tilbage over holdvalg og roster, så rosteret aldrig skubbes ud.
- **Nye regler:**
  - `.kv-venter`: ventelinjen som en mørk, skrå plade. Navnene står i
    holdets farve. `videre` har en gul streg, der fyldes på 0,9 s, og `hold`
    er orange.
  - `.kv-start-boks` og `.kv-start-knap`: Start-knappen er det gamle Klar i
    handlingsfarven og bliver grøn, når den er trykket. Bjælken står fast i
    bunden af midten, så den kan nås uden at rulle. På telefon er den i én
    søjle, og på lave skærme er listen skjult (den står også i toplinjen).
    Går markøren med tastaturet til en regel eller 🎲 under bjælken, ruller
    `karaktervalg.js` midten, så den står over bjælken (den måler bjælken,
    så det passer ved alle `--ui`).
  - `.kv-venter[data-tilstand=mangler]` er orange som `hold`.
  - `.kv-aktoer[data-overdrag="1"]` er isblå og ånder.
  - `.kv-trin-knap[data-tilladt="0"]` er dæmpet, og `[data-gruppe="1"]` har
    en gul kant.
  - `.kv-deltager[data-fremskridt]` fylder fluebenet i tredjedele, og
    `[data-mangler="1"]` får en stiplet gul ramme.
  - `.kv-naeste[aria-disabled="true"]` er dæmpet.
  - `.kv-aktoer` er gul på Bane.
- **Nye variabler:**
  - `--kv-klar` er grøn for klar eller gjort.
  - I holdsøjlen regnes `--kv-navn-str`, `--kv-skilt-h`, `--kv-ind`,
    `--kv-scene-h` og `--kv-fig-b`.
- **Fjernet:** alle regler for Klar-trinnet (`.kv-klarside`, `.kv-ops*` og
  `.kv-klar-*`), `.kv[data-laast]` og `.kv-trin-knap[data-sprunget]`.

**Utilgængelige karakterer** (brugerens ønske, uden art directoren):
- Rosteret viser kun karakterer med status `'aaben'` eller `'utilgaengelig'`
  (`core/roster.js`). De låste ("Kommer snart") vises slet ikke.
- Rækkefølgen er 16 Ingrid, 18 Hansen, Tilfældig, 20 Systemsygeplejersken og
  21 Jan.
- Feltet har nu `data-status="aaben|utilgaengelig|laast"` ved siden af
  `data-aaben`. En utilgængelig karakter vises med sin rigtige model, lidt
  dæmpet, og `.kv-felt-laas` bliver en skrå gul bjælke med "Utilgængelig".
- `.kv-fighter[data-status]` fungerer på samme måde, med et nyt
  `.kv-fighter-banner` (tomt, når karakteren kan vælges).
- Første udgave af banneret er en skrå bjælke i `--kv-markoer` med sort
  kontur. Art directoren finpudser den.
