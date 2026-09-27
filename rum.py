"""Rum, hold, fightere og relæ.

Arkitekturen i én sætning: **før kampen starter ejer serveren lobbyen; efter
start er den et dumt relæ plus en vagthund.** Lobbystate er små kilobytes og
ændrer sig sjældent, så det er gratis at lade Python eje den — og det gør at et
delelink virker, før værten trykker start, og at et rum overlever at værten
genindlæser sin fane.

Selve kampen simuleres i værtens browser. Serveren fortolker den ikke.
"""

import json
import secrets
import threading
import time

import protokol
import ws

# Koden skal kunne diktéres over et bord: ingen I/O/0/1, ingen Æ/Ø/Å.
KODE_ALFABET = "ABCDEFGHJKLMNPQRSTUVXYZ23456789"
KODE_LAENGDE = 5

MAKS_RUM = 20
MAKS_DELTAGERE = 12
MAKS_BAEVERE = 12                       # spillere i kampen: én fighter hver
MAKS_FORBINDELSER = 200

RYD_TICK = 5.0
TOM_RUM = 10 * 60
DOED_RUM = 2 * 3600
GENTILSLUT = 90
VAERT_STILLE_ADVARSEL = 3.0
VAERT_STILLE_AFBRYD = 20.0

TILSLUT_PR_MIN = 10

# Holdene er klinikker; samme rækkefølge og navne som HOLD_ORDEN og HOLD_NAVNE i
# static/js/core/klinikker.js. Rækkefølgen er holdindekset i kampen (HUD'en slår
# farven op efter det). Karaktervalget har (til en start) kun de ANTAL_HOLD
# første: hold 0 er blåt (venstre), hold 1 er rødt (højre).
HOLD_FARVER = ["blaa", "roed", "groen", "gul"]
HOLD_NAVNE = {"groen": "Klinik Højhaven", "blaa": "Speciallægeselskabet Mogensen",
              "roed": "Klinik Højhaven", "gul": "Klinik Gul"}
ANTAL_HOLD = 2
# De to første klinikkers personale (tegneseriekunde 17-22, 0-baseret 16-21).
# De sidder ikke fast på holdene; de er rosteret i karaktervalget.
PERSONALE = {
    "groen": [("Skrankepaven Ingrid", 16), ('Bente "Bare Rolig" Hansen', 17), ("Hansen, Dr. Hansen", 18)],
    "blaa": [("Praktikant Trine", 19), ("Systemsygeplejerske 2.0", 20), ("Dr. Jan fra Mors", 21)],
}

# Rosteret til karaktervalget (docs/karaktervalg.md). SKAL være det samme som
# static/js/core/roster.js: samme figurer i samme rækkefølge, samme navne og
# samme åbne karakterer. De låste står som "Kommer snart" og kan ikke vælges.
ROSTER = [(figur, navn) for liste in PERSONALE.values() for navn, figur in liste]
ROSTER_AABNE = {16, 21}                 # Skrankepaven Ingrid og Dr. Jan fra Mors
_ROSTER_NAVN = dict(ROSTER)
_ROMER = ["", " II", " III", " IV", " V", " VI", " VII", " VIII"]

BANE_TYPER = ["fort", "aaben", "hule", "oeer"]
BANE_VALG = BANE_TYPER + ["tilfaeldig"]

# Når alle er klar, tæller rummet selv ned, før kampen starter.
NEDTAELLING_S = 3.0


def roster_navn(figur, nr=0):
    """Karakterens navn; forekomst nr 1, 2 … får et romertal ("Dr. Jan fra Mors II").

    Som rosterNavn i roster.js: None for en ukendt figur, og efter VIII bliver
    det et almindeligt tal.
    """
    navn = _ROSTER_NAVN.get(figur)
    if navn is None:
        return None
    return navn + (_ROMER[nr] if 0 <= nr < len(_ROMER) else f" {nr + 1}")


def roster_udseende(figur):
    """Udseendet for en valgt karakter (fast: filmintroen og figurerne kender den)."""
    return {"v": 5, "figur": figur, "fast": True}


def er_figur(v):
    """Et figurnummer — ikke en bool, og ikke et kommatal fra JSON."""
    return type(v) is int


# Sure kunder, fordelt så to klinikker aldrig deler et navn. Fighterne får
# ikke navn herfra — de hedder den karakter, spilleren vælger.
KUNDENAVNE = ["Lægevikar Lars", "Anders Endetarm", "Hanne Lin", "Rita Lin", "Ib Uprofen", "Pia Cebo", "Anna Stesi", "Karen Tæne", "Per Forering", "Kaj Ropraktor", "Inge Fektion", "Ane Mia", "Bent Brud", "Gitte Gigt", "Mogens Migræne", "Egon Eksem", "Birgit Blodprop", "Otto Skop", "Dorthe Dryp", "Frode Fnat", "Viggo Vorte", "Sekretær Susse", "Klinik-Karen", "Sure Søren", "Overlæge Ole", "Praksis-Poul", "Tovholder Tine", "Reservelæge Bo"]


def kundenavn(hid, i):
    return KUNDENAVNE[(hid * 6 + i) % len(KUNDENAVNE)]


# Reglerne, værten sætter. Antal hold og kunder pr. hold findes ikke længere:
# holdene er blåt og rødt, og hver spiller er én fighter.
STANDARD_INDST = {
    "turtid": 30,
    "kamptid": 1800,
    "vind": True,
    "vejr": "auto",
    "bane": 0,
    "banetype": "fort",
}
INDST_NOEGLER = tuple(STANDARD_INDST)

RUM = {}
RUM_LAAS = threading.RLock()

_tilslut_forsoeg = {}           # ip -> [tidspunkter]
_forsoeg_laas = threading.Lock()


# ---------------------------------------------------------------- datamodel

class Deltager:
    """Én deltager. Hver spiller, der ikke er tilskuer, er én fighter.

    Pladserne i lobbyen og kampen er afledt af deltagerne (se _hold_liste);
    der er ingen sæder at eje.
    """
    __slots__ = ("pid", "tok", "navn", "conn", "forbundet", "klar", "tilskuer",
                 "tabt_tid", "ms", "kom_ind", "hold", "valg", "stemme")

    def __init__(self, pid, tok, navn, conn):
        self.pid = pid
        self.tok = tok
        self.navn = navn
        self.conn = conn
        self.forbundet = True
        self.klar = False
        self.tilskuer = False
        self.tabt_tid = 0.0
        self.ms = 0
        self.kom_ind = time.time()
        self.hold = None                     # None | 0 (blåt) | 1 (rødt)
        self.valg = None                     # None | figurnummer | "tilfaeldig"
        self.stemme = None                   # None | en af BANE_VALG

    def dict(self):
        return {"pid": self.pid, "navn": self.navn, "forbundet": self.forbundet,
                "klar": self.klar, "tilskuer": self.tilskuer, "ms": self.ms,
                "hold": self.hold, "valg": self.valg, "stemme": self.stemme}


class Rum:
    def __init__(self, kode, indst):
        self.kode = kode
        self.laas = threading.RLock()
        self.fase = "venter"                 # venter | i_gang | slut
        self.vaert = None
        self.deltagere = {}                  # pid -> Deltager, i den rækkefølge de kom ind
        self.indst = dict(STANDARD_INDST)
        self.indst.update({k: v for k, v in (indst or {}).items() if k in INDST_NOEGLER})
        self.seq = 0
        self.oprettet = time.time()
        self.tom_siden = time.time()
        self.sidst_aktiv = time.time()
        self.sidste_vaert_besked = time.time()
        self.stille_meldt = False
        self.terraen = None                  # bagt maske uploadet over HTTP
        # Den automatiske nedtælling: None, eller {slut, token, hvem, timer}.
        # token skifter ved hver ny nedtælling, så en annulleret timer, der
        # alligevel når at fyre, kan se, at den er forældet.
        self.nedtaelling = None
        self.bane_trukket = None             # banetypen, der er trukket, mens nedtællingen løber
        # Kampens {indst, hold} fra {t:'start'}, mens den er i gang: en spiller,
        # der genforbinder, får starten igen (han kan have mistet den).
        self.opsaet = None

    # ---- afledt tilstand

    def forbundne(self):
        return [d for d in self.deltagere.values() if d.forbundet]

    def aktive(self):
        """De tilsluttede deltagere, der ikke er tilskuere: dem, nedtællingen venter på."""
        return [d for d in self.forbundne() if not d.tilskuer]

    def spillere(self, hid=None):
        """Deltagerne med et hold (ikke tilskuere) — eller kun holdet hid — i den rækkefølge, de kom ind."""
        return [d for d in self.deltagere.values()
                if not d.tilskuer and d.hold is not None and (hid is None or d.hold == hid)]

    def antal_baevere(self):
        return len(self.spillere())

    def lobby(self, til_pid=None):
        n = self.nedtaelling
        return {"t": "lobby", "d": {
            "kode": self.kode,
            "fase": self.fase,
            "vaert": self.vaert,
            "dig": til_pid,
            "indst": dict(self.indst),
            "deltagere": [d.dict() for d in self.deltagere.values()],
            "hold": _hold_liste(self),
            "nedtaelling_ms": max(0, round((n["slut"] - time.time()) * 1000)) if n else None,
            "bane_trukket": self.bane_trukket,
        }}

    # ---- udsendelse

    def broadcast(self, obj, hot=False, undtagen=None):
        """Kod rammen én gang, og læg den i modtagernes køer under låsen.

        Regel: hold aldrig låsen mens du skriver til en socket. send() rører
        ikke socket'en — den lægger kun i forbindelsens egen kø (under dens
        egen condition), så én langsom klient aldrig standser de andre. Derfor
        må køerne fyldes under låsen, og det skal de: så når beskederne frem i
        den rækkefølge, rummet ændrede sig, også når flere tråde sender.
        Kaldes gerne under r.laas (den er en RLock). Kun luk_stille, som rører
        socket'en, sker udenfor.
        """
        ramme = ws.tekst_ramme(obj)
        doede = []
        with self.laas:
            for d in self.deltagere.values():
                c = d.conn
                if c and d.forbundet and d.pid != undtagen and not c.send(ramme, hot=hot):
                    doede.append(c)
        for c in doede:
            c.luk_stille()

    def send_til(self, pid, obj):
        with self.laas:
            d = self.deltagere.get(pid)
            if d and d.forbundet and d.conn:
                d.conn.send_json(obj)

    def send_lobby(self):
        """Lobbyen sender altid FULD tilstand — aldrig diffs.

        Den ændrer sig et par gange i sekundet i værste fald, og fuld tilstand
        fjerner hele klassen af desync-fejl. Kampen sender derimod kun deltas.

        Alle ændringer af lobbyen ender her, så det er også her, den
        automatiske nedtælling startes og annulleres — ét sted i stedet for i
        hver handling. Beskederne bygges OG lægges i køerne under låsen, så en
        forældet lobby aldrig når frem efter en nyere (se broadcast).
        """
        with self.laas:
            _tjek_nedtaelling(self)
            for d in self.deltagere.values():
                if d.forbundet and d.conn:
                    d.conn.send_json(self.lobby(d.pid))


def _hold_liste(r, afgoer=False):
    """De to hold med én plads pr. spiller, afledt af deltagerne (docs/karaktervalg.md).

    En plads med et figurvalg har karakterens udseende og navn; vælges samme
    karakter flere gange, tælles der gennem hele kampen i holdrækkefølge og
    derefter i den rækkefølge, spillerne kom ind, så nummer to hedder "… II".
    'tilfaeldig' hedder "Tilfældig", intet valg har intet navn. Med
    afgoer=True (kampstart) trækkes fightere uden figurvalg blandt de åbne
    karakterer; spillerens valg bevares, så 'tilfaeldig' trækkes igen ved
    Spil igen. Kaldes under r.laas.
    """
    aabne = [f for f, _ in ROSTER if f in ROSTER_AABNE]
    brugt = {}                               # figur -> forekomster indtil nu
    ud = []
    for hid, farve in enumerate(HOLD_FARVER[:ANTAL_HOLD]):
        pladser = []
        for d in r.spillere(hid):
            f = d.valg
            if afgoer and not er_figur(f):
                f = secrets.choice(aabne)
            if er_figur(f):
                nr = brugt.get(f, 0)
                brugt[f] = nr + 1
                udseende, navn = roster_udseende(f), roster_navn(f, nr) or ""
            else:
                udseende, navn = {}, ("Tilfældig" if f == "tilfaeldig" else "")
            pladser.append({"id": f"b_{d.pid}", "navn": navn, "udseende": udseende,
                            "ejer": d.pid, "valg": d.valg})
        ud.append({"id": hid, "farve": farve, "navn": HOLD_NAVNE[farve], "baevere": pladser})
    return ud


# ---------------------------------------------------------------- rum-opslag

def ny_kode():
    with RUM_LAAS:
        for _ in range(50):
            k = "".join(secrets.choice(KODE_ALFABET) for _ in range(KODE_LAENGDE))
            if k not in RUM:
                return k
    return None


def find_rum(kode):
    with RUM_LAAS:
        return RUM.get((kode or "").upper())


def rum_liste():
    with RUM_LAAS:
        rum = list(RUM.values())
    ud = []
    for r in rum:
        with r.laas:
            if r.fase == "venter":
                ud.append({"kode": r.kode, "deltagere": len(r.forbundne()),
                           "hold": ANTAL_HOLD, "vaert": (r.deltagere.get(r.vaert).navn
                                                          if r.vaert in r.deltagere else "—")})
    return ud


def rate_ok(ip):
    nu = time.time()
    with _forsoeg_laas:
        liste = [t for t in _tilslut_forsoeg.get(ip, []) if nu - t < 60]
        if len(liste) >= TILSLUT_PR_MIN:
            _tilslut_forsoeg[ip] = liste
            return False
        liste.append(nu)
        _tilslut_forsoeg[ip] = liste
        return True


# ---------------------------------------------------------------- session

def session(conn, ip):
    """Læseløkken for én forbindelse. Kører i HTTP-trådens stak."""
    ctx = {"rum": None, "pid": None, "tok": None, "navn": "Kunde", "conn": conn}
    try:
        while True:
            m = conn.laes_besked()
            if m is None:
                break
            op, raa = m
            if op != ws.OP_TEXT:
                raise ws.WSFejl(1003, "kun tekstrammer")
            try:
                msg = json.loads(raa.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise ws.WSFejl(1007, "ugyldig JSON")
            if not isinstance(msg, dict):
                raise ws.WSFejl(1007, "besked skal være et objekt")
            haandter(conn, ctx, msg, ip)
    finally:
        forlad(ctx, grund="forbindelse tabt", haardt=False, conn=conn)


def _bundet(r, pid, conn):
    """Er conn stadig deltagerens forbindelse? Efter et genfundet 'hej' fra en
    ny forbindelse (netskift, en kopieret fane) er den gamle forældet."""
    with r.laas:
        dl = r.deltagere.get(pid)
        return dl is not None and dl.conn is conn


def haandter(conn, ctx, msg, ip):
    t = msg.get("t")
    d = msg.get("d") or {}
    r = ctx["rum"]
    pid = ctx["pid"]
    if r is not None and pid is not None and t != "hej" and not _bundet(r, pid, conn):
        # En forældet forbindelse er inert: den må ikke handle, relæe eller
        # forlade på vegne af en spiller, der nu er bundet til en anden. Et nyt
        # 'hej' kan binde den igen.
        return
    er_deltager = r is not None and pid is not None
    er_vaert = er_deltager and r.vaert == pid

    ok, fejlkode = protokol.maa_sende(t, er_deltager, er_vaert)
    if not ok:
        conn.send_json(protokol.fejl(fejlkode))
        return

    if t == "hej":
        return _hej(conn, ctx, d)
    if t == "opret":
        return _opret(conn, ctx, d)
    if t == "tilslut":
        return _tilslut(conn, ctx, d, ip)
    if t == "ping":
        return conn.send_json({"t": "pong", "d": {"t0": d.get("t0"), "t1": time.time() * 1000}})
    if t == "forlad":
        forlad(ctx, grund="forlod spillet", haardt=True, conn=conn)
        return
    if t == "navngiv":
        return _navngiv(conn, ctx, d)
    if t == "vaelg":
        return _vaelg(conn, ctx, d)
    if t == "hold":
        return _hold(conn, ctx, d)
    if t == "stem":
        return _stem(conn, ctx, d)
    if t == "klar":
        return _klar(conn, ctx, d)
    if t == "indst":
        return _indst(conn, ctx, d)
    if t == "start":
        return _start(conn, ctx)
    if t == "smid_ud":
        return _smid_ud(conn, ctx, d)
    if t == "snap_bed":
        r.send_til(r.vaert, {"t": "snap_bed", "d": {"pid": pid}})
        return

    # Alt herunder relæes.
    return _relae(conn, ctx, t, d, msg)


# ---------------------------------------------------------------- handlinger

def _hej(conn, ctx, d):
    pid = d.get("pid")
    tok = d.get("tok")
    navn = (d.get("navn") or "Kunde").strip()[:20] or "Kunde"
    ctx["navn"] = navn

    # Gentilslutning: kender vi pid+tok i et rum, binder vi deltageren (og fighteren) tilbage.
    # Det hele sker under låsen, så velkommen, lobbyen og starten når frem i
    # rækkefølge og passer til rummets tilstand (fx ingen forældet start efter 'slut').
    kode = d.get("rum")
    if pid and tok and kode:
        r = find_rum(kode)
        if r:
            with r.laas:
                gl = r.deltagere.get(pid)
                if gl and secrets.compare_digest(gl.tok, tok):
                    # En gammel forbindelse, der stadig lever, er nu forældet
                    # (haandter ignorerer den, og dens forlad rører ikke den nye).
                    gl.conn = conn
                    gl.forbundet = True
                    gl.tabt_tid = 0.0
                    gl.navn = navn
                    ctx["rum"], ctx["pid"], ctx["tok"] = r, pid, tok
                    conn.data["rum"] = r
                    conn.data["pid"] = pid
                    conn.send_json({"t": "velkommen", "d": {
                        "pid": pid, "tok": tok, "server": "Kundekrigen/1.0",
                        "protokol": 1, "tid": time.time() * 1000, "genfundet": True}})
                    if not _vaert_ok(r):
                        _forfrem_vaert(r)
                        _meld_vaert(r)
                    r.send_lobby()
                    if r.fase == "i_gang":
                        # Faldt han ud under nedtællingen (eller midt i kampen),
                        # kan han have mistet starten: send den igen, før værten
                        # bliver bedt om et snapshot til ham.
                        if _har_fighter(r.opsaet, pid):
                            conn.send_json({"t": "start", "d": r.opsaet})
                        if r.vaert != pid:
                            r.send_til(r.vaert, {"t": "snap_bed", "d": {"pid": pid}})
                    return

    ctx["pid"] = "p_" + secrets.token_hex(4)
    ctx["tok"] = secrets.token_urlsafe(16)
    conn.send_json({"t": "velkommen", "d": {
        "pid": ctx["pid"], "tok": ctx["tok"], "server": "Kundekrigen/1.0",
        "protokol": 1, "tid": time.time() * 1000, "genfundet": False}})


def _sikr_identitet(conn, ctx):
    if not ctx.get("pid"):
        ctx["pid"] = "p_" + secrets.token_hex(4)
        ctx["tok"] = secrets.token_urlsafe(16)


def _opret(conn, ctx, d):
    _sikr_identitet(conn, ctx)
    with RUM_LAAS:
        if len(RUM) >= MAKS_RUM:
            conn.send_json(protokol.fejl("for_mange_rum"))
            return
        kode = ny_kode()
        if not kode:
            conn.send_json(protokol.fejl("for_mange_rum"))
            return
        r = Rum(kode, d.get("indst"))
        RUM[kode] = r

    navn = (d.get("navn") or ctx["navn"]).strip()[:20] or "Kunde"
    dl = Deltager(ctx["pid"], ctx["tok"], navn, conn)
    with r.laas:
        r.deltagere[dl.pid] = dl
        r.vaert = dl.pid
        r.tom_siden = 0
    ctx["rum"] = r
    conn.data["rum"] = r
    conn.data["pid"] = dl.pid

    conn.send_json({"t": "rum", "d": {"kode": kode, "vaert": r.vaert, "dig": dl.pid}})
    r.send_lobby()
    print(f"[rum] {kode} oprettet af {navn}")


def _tilslut(conn, ctx, d, ip):
    if not rate_ok(ip):
        conn.send_json(protokol.fejl("for_mange_forsoeg"))
        return
    _sikr_identitet(conn, ctx)
    r = find_rum(d.get("kode"))
    if not r:
        conn.send_json(protokol.fejl("ukendt_rum"))
        return
    navn = (d.get("navn") or ctx["navn"]).strip()[:20] or "Kunde"

    with r.laas:
        if len(r.deltagere) >= MAKS_DELTAGERE:
            conn.send_json(protokol.fejl("rum_fuldt"))
            return
        dl = Deltager(ctx["pid"], ctx["tok"], navn, conn)
        # Sen tilslutning bliver tilskuer — man overtager ikke en igangværende kamp.
        dl.tilskuer = r.fase == "i_gang"
        # Nye deltagere har intet hold; de vælger selv blåt eller rødt.
        r.deltagere[dl.pid] = dl
        r.tom_siden = 0
        # Et rum, hvis vært gik, mens han var alene, har ingen vært: den nye (eller
        # den længst tilsluttede) bliver det.
        ny_vaert = not _vaert_ok(r)
        if ny_vaert:
            _forfrem_vaert(r)
        ctx["rum"] = r
        conn.data["rum"] = r
        conn.data["pid"] = dl.pid

        # Under låsen, så 'rum' kommer før den første lobby til den nye.
        conn.send_json({"t": "rum", "d": {"kode": r.kode, "vaert": r.vaert, "dig": dl.pid}})
        r.broadcast({"t": "deltager_ind", "d": {"pid": dl.pid, "navn": navn}}, undtagen=dl.pid)
        if ny_vaert:
            _meld_vaert(r)
        r.send_lobby()
        if dl.tilskuer:
            conn.send_json(protokol.fejl("i_gang"))
            if r.vaert != dl.pid:
                r.send_til(r.vaert, {"t": "snap_bed", "d": {"pid": dl.pid}})


def _navngiv(conn, ctx, d):
    """Forældet: pladsens navn og udseende følger nu karaktervalget (vaelg).

    Beskeden kendes stadig, så en gammel klient ikke får fejl, men den ændrer
    intet. Ingen lobby-udsendelse, ellers sender klienten sit profil-udseende
    i ring.
    """
    return


def _gyldigt_valg(figur):
    """Et åbent figurnummer, None (ingen fighter) eller 'tilfaeldig'."""
    return figur is None or figur == "tilfaeldig" or (er_figur(figur) and figur in ROSTER_AABNE)


def _gyldigt_hold(hold):
    """0 (blåt), 1 (rødt) eller None — ikke en bool."""
    return hold is None or (er_figur(hold) and 0 <= hold < ANTAL_HOLD)


def _mig(ctx):
    """Afsenderens Deltager, eller None (fx lige efter at være smidt ud)."""
    return ctx["rum"].deltagere.get(ctx["pid"])


def _ikke_tilskuer_i_lobbyen(r, dl):
    """Sikkerhedsnet: uden for en kamp er ingen tilskuer. Kaldes under r.laas.

    Tilskuerne bliver deltagere, når kampen slutter eller afbrydes; sker det
    alligevel ikke, gør det første valg i karaktervalget det.
    """
    if r.fase != "i_gang":
        dl.tilskuer = False


def _ledigt_hold(r):
    """Det ledige hold til en spiller uden hold, eller None. Kaldes under r.laas.

    Kun med højst to aktive spillere (tilsluttede, ikke tilskuere, som
    nedtællingen tæller dem). Så holdet med færrest spillere, blåt ved lige,
    talt som _hold_fejl tæller dem (r.spillere): en spiller, der har mistet
    forbindelsen, står stadig på sit hold i GENTILSLUT sekunder og tæller med,
    ellers kunne to ende på samme hold, og nedtællingen ville aldrig starte.
    Med flere aktive vælger hver selv sit hold.
    """
    if len(r.aktive()) > 2:
        return None
    antal = [len(r.spillere(hid)) for hid in range(ANTAL_HOLD)]
    return antal.index(min(antal))


def _vaelg(conn, ctx, d):
    """Min fighter. Jeg er ikke længere klar.

    Har jeg intet hold, og er vi højst to aktive spillere, får jeg det ledige
    hold (_ledigt_hold) under samme lås som valget, så to samtidige valg ender
    på hvert sit hold. Et hold, jeg har, røres ikke.
    """
    r = ctx["rum"]
    figur = d.get("figur")
    if not _gyldigt_valg(figur):
        conn.send_json(protokol.fejl("laast_karakter"))
        return
    with r.laas:
        dl = _mig(ctx)
        if not dl:
            return
        dl.valg = figur
        dl.klar = False
        _ikke_tilskuer_i_lobbyen(r, dl)
        if figur is not None and dl.hold is None and not dl.tilskuer:
            dl.hold = _ledigt_hold(r)
    r.send_lobby()


def _hold(conn, ctx, d):
    """Mit hold. Jeg er ikke længere klar."""
    r = ctx["rum"]
    hold = d.get("hold")
    if not _gyldigt_hold(hold):
        conn.send_json(protokol.fejl("ukendt_hold"))
        return
    with r.laas:
        dl = _mig(ctx)
        if not dl:
            return
        dl.hold = hold
        dl.klar = False
        _ikke_tilskuer_i_lobbyen(r, dl)
    r.send_lobby()


def _stem(conn, ctx, d):
    """Min banestemme. Jeg er ikke længere klar."""
    r = ctx["rum"]
    banetype = d.get("banetype")
    if banetype is not None and banetype not in BANE_VALG:
        conn.send_json(protokol.fejl("ukendt_bane"))
        return
    with r.laas:
        dl = _mig(ctx)
        if not dl:
            return
        dl.stemme = banetype
        dl.klar = False
    r.send_lobby()


def _klar(conn, ctx, d):
    """Klar eller ikke klar — også værten. Klar kræver et hold."""
    r = ctx["rum"]
    klar = bool(d.get("klar"))
    with r.laas:
        dl = _mig(ctx)
        if not dl:
            return
        if klar and dl.hold is None:
            conn.send_json(protokol.fejl("vaelg_hold"))
            return
        dl.klar = klar
        _ikke_tilskuer_i_lobbyen(r, dl)
    r.send_lobby()


def _indst(conn, ctx, d):
    r = ctx["rum"]
    with r.laas:
        # hold og baevere_pr_hold findes ikke længere og ignoreres.
        for k in INDST_NOEGLER:
            if k in d:
                r.indst[k] = d[k]
        # Ingen starter på regler, de ikke har set: alle er ikke længere klar.
        for dl in r.deltagere.values():
            dl.klar = False
    r.send_lobby()


def _hold_fejl(r):
    """Holdreglerne for at starte, fælles for start og nedtællingen: fejlkode eller None.

    Begge hold skal have mindst én spiller. En spiller, der har mistet
    forbindelsen, beholder sin fighter i GENTILSLUT sekunder og tæller med.
    """
    if any(not r.spillere(hid) for hid in range(ANTAL_HOLD)):
        return "for_faa_hold"
    if r.antal_baevere() > MAKS_BAEVERE:
        return "for_mange_baevere"
    return None


def _start(conn, ctx):
    """Værtens start: med det samme, uden nedtælling (Spil igen).

    Begge hold skal have mindst én spiller, og alle andre skal være klar;
    værten selv behøver ikke. En løbende nedtælling annulleres af _gaa_i_gang.
    Karaktervalgets UI bruger den ikke længere (Spil igen er Klar).
    """
    r = ctx["rum"]
    with r.laas:
        fejl = _hold_fejl(r)
        if fejl:
            conn.send_json(protokol.fejl(fejl))
            return
        ikke_klar = [d for d in r.forbundne() if not d.klar and not d.tilskuer and d.pid != r.vaert]
        if ikke_klar:
            conn.send_json(protokol.fejl("ikke_klar"))
            return
        opsaet = _gaa_i_gang(r)
        antal = r.antal_baevere()
        _send_start(r, opsaet)
    print(f"[rum] {r.kode} startet · {len(opsaet['hold'])} hold · {antal} bævere")


def _gaa_i_gang(r):
    """Sæt kampen i gang og returnér opsætningen til {t:'start'}. Kaldes under r.laas.

    Banen er den trukne (eller trækkes nu, ved værtens start). De to hold får
    én plads pr. spiller med den endelige karakter, udseende og navn;
    spillernes valg bevares. Opsætningen gemmes i r.opsaet til spillere, der
    genforbinder. Afsenderen sender selv starten (_send_start).
    """
    if not r.indst.get("bane"):
        r.indst["bane"] = secrets.randbelow(2 ** 31)
    r.indst["banetype"] = r.bane_trukket or _traek_bane(r)
    _stop_nedtaelling(r)
    hold = _hold_liste(r, afgoer=True)
    r.fase = "i_gang"
    r.seq = 0
    r.sidste_vaert_besked = time.time()
    r.stille_meldt = False
    r.opsaet = {"indst": dict(r.indst), "hold": hold}
    return r.opsaet


def _send_start(r, opsaet):
    """{t:'start'} til alle, og så en frisk lobby. Kaldes under r.laas, lige efter _gaa_i_gang.

    Uden den friske lobby har hver klient en sidste lobby med en løbende
    nedtælling (fase 'venter'), som karaktervalget ville vise igen efter kampen.
    Den nye har fase 'i_gang', og nedtaelling_ms og bane_trukket er null. Begge
    lægges i køerne under låsen, så intet forældet kommer imellem.
    """
    r.broadcast({"t": "start", "d": opsaet})
    r.send_lobby()


def _har_fighter(opsaet, pid):
    """Har pid en plads i kampens opsætning?"""
    return bool(opsaet) and any(p.get("ejer") == pid for h in opsaet["hold"] for p in h["baevere"])


def _tilbage_til_lobby(r):
    """Kampen er slut eller afbrudt: rummet venter på spillere igen. Kaldes under r.laas.

    Ingen er længere klar — ellers tæller nedtællingen straks ned igen, mens
    alle står på sejrsskærmen — og tilskuerne bliver deltagere. Hold, valg og
    stemmer bevares, så Spil igen kun er Klar.
    """
    r.fase = "venter"
    r.opsaet = None
    _stop_nedtaelling(r)
    for d in r.deltagere.values():
        d.tilskuer = False
        d.klar = False


# ---------------------------------------------------------------- nedtælling

def _traek_bane(r):
    """Træk banen blandt stemmerne: hver stemme er ét lod.

    Kun tilsluttede spillere (ikke tilskuere) har lod, som i betingelsen for
    nedtællingen. Uden stemmer gælder reglernes banetype. 'tilfaeldig' bliver
    en af de fire baner.
    """
    lod = [d.stemme for d in r.aktive() if d.stemme is not None]
    bane = secrets.choice(lod) if lod else (r.indst.get("banetype") or "fort")
    if bane == "tilfaeldig":
        bane = secrets.choice(BANE_TYPER)
    return bane


def _klar_til_start(r):
    """Betingelsen for den automatiske nedtælling.

    Rummet venter, alle tilsluttede deltagere, der ikke er tilskuere, er klar
    (og dermed har et hold, og der er mindst én), og holdene overholder de
    samme regler som start. Rummet har en tilsluttet vært, der ikke er
    tilskuer — ellers er der ingen til at simulere kampen.
    Returnér mængden af de deltagende pids, eller None. Mængden binder
    nedtællingen til netop de deltagere: forsvinder én, annulleres den, også
    selv om resten stadig er klar — så begynder en ny for dem, med en ny
    banetrækning uden den forsvundnes stemme.
    """
    if r.fase != "venter" or _hold_fejl(r):
        return None
    v = r.deltagere.get(r.vaert)
    if v is None or not v.forbundet or v.tilskuer:
        return None
    spillere = r.aktive()
    if not spillere or not all(d.klar and d.hold is not None for d in spillere):
        return None
    return frozenset(d.pid for d in spillere)


def _tjek_nedtaelling(r):
    """Start eller annullér nedtællingen. Kaldes af send_lobby under r.laas.

    Timeren tager selv låsen, når den fyrer, så den venter bare, til den
    her er sluppet — ingen dødlås.
    """
    hvem = _klar_til_start(r)
    if r.nedtaelling and r.nedtaelling["hvem"] != hvem:
        _stop_nedtaelling(r)
    if hvem and not r.nedtaelling:
        r.bane_trukket = _traek_bane(r)
        token = secrets.token_hex(8)
        timer = threading.Timer(NEDTAELLING_S, _nedtaelling_faerdig, (r, token))
        timer.daemon = True
        r.nedtaelling = {"slut": time.time() + NEDTAELLING_S, "token": token,
                         "hvem": hvem, "timer": timer}
        timer.start()


def _stop_nedtaelling(r):
    """Annullér en løbende nedtælling. Kaldes under r.laas."""
    if r.nedtaelling:
        r.nedtaelling["timer"].cancel()
    r.nedtaelling = None
    r.bane_trukket = None


def _nedtaelling_faerdig(r, token):
    """Timerens tråd, NEDTAELLING_S efter starten: start kampen, hvis alt stadig holder."""
    with r.laas:
        n = r.nedtaelling
        if not n or n["token"] != token:
            return                                  # annulleret eller afløst undervejs
        if _klar_til_start(r) != n["hvem"]:
            # Noget ændrede sig uden en lobby-udsendelse (fx at den sidste gik).
            # send_lobby annullerer nedtællingen og fortæller det til dem, der er.
            r.send_lobby()
            return
        opsaet = _gaa_i_gang(r)
        antal = r.antal_baevere()
        _send_start(r, opsaet)
    print(f"[rum] {r.kode} startet efter nedtælling · {len(opsaet['hold'])} hold · "
          f"{antal} bævere · {opsaet['indst']['banetype']}")


def _smid_ud(conn, ctx, d):
    r = ctx["rum"]
    offer = d.get("pid")
    with r.laas:
        if offer == r.vaert:
            return                              # værten kan ikke smide sig selv ud (rummet mistede værten)
        dl = r.deltagere.pop(offer, None)       # fighteren forsvinder med deltageren
    if dl and dl.conn:
        dl.conn.send_json({"t": "smidt_ud", "d": {"grund": d.get("grund") or "Værten fjernede dig."}})
        dl.conn.luk(4001, "smidt ud")
    r.send_lobby()


def _relae(conn, ctx, t, d, msg):
    """Relæ. Alt sker under låsen, så beskederne når frem i sekvensnummerets orden.

    'slut' fra værten afslutter kampen: rummet går tilbage til lobbyen
    (_tilbage_til_lobby), 'slut' relæes som før, og så sendes en lobby med
    fase 'venter' — i den rækkefølge.
    """
    r, pid = ctx["rum"], ctx["pid"]
    if t == "chat":
        d["tekst"] = str(d.get("tekst", ""))[:250]
    with r.laas:
        if r.vaert == pid:
            r.sidste_vaert_besked = time.time()
            if r.stille_meldt:
                r.stille_meldt = False
        # Kun en kamp, der er i gang, kan slutte: et gentaget 'slut' må ikke
        # gøre dem, der allerede har trykket Spil igen, ikke klar.
        slut = t == "slut" and r.vaert == pid and r.fase == "i_gang"
        if slut:
            _tilbage_til_lobby(r)
        # Sekvensnummeret tæller KUN pålidelige beskeder, der sendes til
        # alle. Hot-beskeder (st) må droppes af coalescingen, og adresserede
        # beskeder når kun én modtager — fik de et nummer, ville alle andre
        # se et "hul" og bede om et fuldt snapshot. Et adresseret snapshot
        # bærer det aktuelle nummer, så modtageren synkroniserer til det.
        paalidelig_bred = (t not in protokol.HOT and t not in protokol.TIL_VAERT_KUN
                           and not (t == "snapshot" and d.get("to")))
        if paalidelig_bred:
            r.seq += 1
        r.sidst_aktiv = time.time()

        ud = {"t": t, "d": d, "f": pid}
        if t not in protokol.HOT:
            ud["s"] = r.seq

        if t in protokol.TIL_VAERT_KUN:
            r.send_til(r.vaert, ud)
            return
        if t == "snapshot" and d.get("to"):
            r.send_til(d["to"], ud)
            return
        r.broadcast(ud, hot=(t in protokol.HOT), undtagen=pid if t in ("st",) else None)
        if slut:
            r.send_lobby()


# ---------------------------------------------------------------- afgang

def forlad(ctx, grund="", haardt=False, conn=None):
    """Deltageren går: hårdt (fighteren forsvinder) eller blødt (tabt forbindelse).

    Afgangen hører til forbindelsen, conn (som standard ctx['conn']): er
    deltageren siden bundet til en anden forbindelse (genfundet 'hej'), gør en
    afgang fra den gamle ingenting — hverken blødt, når den gamle socket dør,
    eller hårdt, når en kopieret fane lukkes.
    """
    r, pid = ctx.get("rum"), ctx.get("pid")
    if not r or not pid:
        return
    if conn is None:
        conn = ctx.get("conn")
    with r.laas:
        dl = r.deltagere.get(pid)
        if not dl:
            return
        if conn is not None and dl.conn is not conn:
            return                              # en forældet forbindelse
        var_vaert = r.vaert == pid
        if haardt:
            # Bevidst afgang: fighteren forsvinder straks.
            r.deltagere.pop(pid, None)
        else:
            # Tabt forbindelse: fighteren bliver på holdet i GENTILSLUT sekunder.
            dl.forbundet = False
            dl.conn = None
            dl.tabt_tid = time.time()
        tom = not r.forbundne()
        if tom:
            r.tom_siden = time.time()
        if var_vaert:
            _forfrem_vaert(r)
        ctx["rum"] = None

        r.broadcast({"t": "deltager_ud", "d": {"pid": pid, "grund": grund}})
        if var_vaert and not tom:
            # Værtens browser havde hele simulationstilstanden. Vi flytter den ikke —
            # rummet overlever, lobbyen er intakt, og de kan trykke Klar igen.
            if r.fase == "i_gang":
                _tilbage_til_lobby(r)
                r.broadcast({"t": "kamp_afbrudt", "d": {"grund": "Værten forlod spillet."}})
            if r.vaert:
                _meld_vaert(r)
        # Også når rummet er tomt: der er ingen at sende til, men send_lobby
        # annullerer en løbende nedtælling.
        r.send_lobby()


def _forfrem_vaert(r):
    """Længst tilsluttede forbundne deltager bliver ny vært."""
    kandidater = [d for d in r.deltagere.values() if d.forbundet]
    r.vaert = min(kandidater, key=lambda d: d.kom_ind).pid if kandidater else None


def _vaert_ok(r):
    """Har rummet en vært, der er en tilsluttet deltager? Kaldes under r.laas.

    Går værten, mens han er alene, finder _forfrem_vaert ingen, og vaert er
    None, til nogen kommer (igen) — så forfremmes de der.
    """
    v = r.deltagere.get(r.vaert)
    return v is not None and v.forbundet


def _meld_vaert(r):
    """{t:'vaert_skiftet'} til alle. Kaldes under r.laas, efter _forfrem_vaert."""
    nv = r.deltagere.get(r.vaert)
    r.broadcast({"t": "vaert_skiftet", "d": {"pid": r.vaert, "navn": nv.navn if nv else "—"}})


# ---------------------------------------------------------------- vagthund

def rydder_loop():
    """Oprydning og vagthund."""
    while True:
        time.sleep(RYD_TICK)
        nu = time.time()
        with RUM_LAAS:
            rum = list(RUM.items())

        for kode, r in rum:
            try:
                _tilse_rum(r, nu)
            except Exception as e:                      # en enkelt fejl må ikke dræbe tråden
                print(f"[oprydning] fejl i {kode}: {e}")

        with RUM_LAAS:
            for kode, r in list(RUM.items()):
                with r.laas:
                    tom = not r.forbundne()
                    doed = (tom and r.tom_siden and nu - r.tom_siden > TOM_RUM) or \
                           (nu - r.sidst_aktiv > DOED_RUM)
                if doed:
                    RUM.pop(kode, None)
                    print(f"[oprydning] fjernede rum {kode}")


def _tilse_rum(r, nu):
    # Deltagere, der ikke er kommet tilbage inden for vinduet, og deres fightere.
    frigiv = []
    with r.laas:
        for d in list(r.deltagere.values()):
            if not d.forbundet and d.tabt_tid and nu - d.tabt_tid > GENTILSLUT:
                frigiv.append(d.pid)
                r.deltagere.pop(d.pid, None)
        if frigiv and r.vaert in frigiv:
            _forfrem_vaert(r)
        i_gang = r.fase == "i_gang"
        stille = nu - r.sidste_vaert_besked
        meldt = r.stille_meldt
    if frigiv:
        r.send_lobby()

    if not i_gang:
        return

    # Vagthunden er det eneste lag der ikke kræver værtens samarbejde. Uden den
    # ser 11 mennesker på et frosset billede uden at vide hvorfor.
    if stille > VAERT_STILLE_AFBRYD:
        with r.laas:
            if r.fase != "i_gang":
                return                          # sluttede ('slut') imens: intet at afbryde
            _tilbage_til_lobby(r)
            r.broadcast({"t": "kamp_afbrudt", "d": {"grund": "Værten svarede ikke."}})
            r.send_lobby()
        print(f"[vagthund] {r.kode} afbrudt — værten var stille i {int(stille)} s")
    elif stille > VAERT_STILLE_ADVARSEL and not meldt:
        with r.laas:
            r.stille_meldt = True
            r.broadcast({"t": "vaert_stille", "d": {"sek": round(stille, 1)}})


def status():
    with RUM_LAAS:
        rum = list(RUM.values())
    detaljer = []
    forb = 0
    for r in rum:
        with r.laas:
            koe = []
            for d in r.deltagere.values():
                if d.conn:
                    forb += 1
                    koe.append({"pid": d.pid, "navn": d.navn, "dybde": len(d.conn.ude),
                                "hot_droppet": d.conn.hot_droppet,
                                "draebt": d.conn.draebt_af_koe})
            detaljer.append({
                "kode": r.kode, "fase": r.fase, "deltagere": len(r.deltagere),
                "baevere": r.antal_baevere(), "seq": r.seq,
                "vaert_stille_sek": round(time.time() - r.sidste_vaert_besked, 1),
                "koe": koe})
    return {"rum": len(rum), "forbindelser": forb,
            "traade": threading.active_count(), "detaljer": detaljer}
