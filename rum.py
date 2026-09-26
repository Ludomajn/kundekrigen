"""Rum, hold, sæder og relæ.

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
MAKS_HOLD = 4
MAKS_BAEVERE = 12
MAKS_FORBINDELSER = 200

RYD_TICK = 5.0
TOM_RUM = 10 * 60
DOED_RUM = 2 * 3600
GENTILSLUT = 90
VAERT_STILLE_ADVARSEL = 3.0
VAERT_STILLE_AFBRYD = 20.0

TILSLUT_PR_MIN = 10

# Holdene er klinikker; samme rækkefølge og navne som static/js/core/klinikker.js.
HOLD_FARVER = ["groen", "blaa", "roed", "gul"]
HOLD_NAVNE = {"groen": "Klinik Højhaven", "blaa": "Speciallægeselskabet Mogensen",
              "roed": "Klinik Rød", "gul": "Klinik Gul"}
# De to første klinikkers personale: faste pladser med eget navn og egen
# figur (tegneseriekunde 17-22). Profilerne skifter ikke deres udseende.
PERSONALE = {
    "groen": [("Skrankepaven Ingrid", 16), ('Bente "Bare Rolig" Hansen', 17), ("Hansen, Dr. Hansen", 18)],
    "blaa": [("Praktikant Trine", 19), ("Systemsygeplejerske 2.0", 20), ("Dr. Jan fra Mors", 21)],
}
# Sure kunder. Figurerne i et netværksrum får navne herfra, fordelt så to
# klinikker aldrig deler et navn.
KUNDENAVNE = ["Lægevikar Lars", "Anders Endetarm", "Hanne Lin", "Rita Lin", "Ib Uprofen", "Pia Cebo", "Anna Stesi", "Karen Tæne", "Per Forering", "Kaj Ropraktor", "Inge Fektion", "Ane Mia", "Bent Brud", "Gitte Gigt", "Mogens Migræne", "Egon Eksem", "Birgit Blodprop", "Otto Skop", "Dorthe Dryp", "Frode Fnat", "Viggo Vorte", "Sekretær Susse", "Klinik-Karen", "Sure Søren", "Overlæge Ole", "Praksis-Poul", "Tovholder Tine", "Reservelæge Bo"]


def kundenavn(hid, i):
    return KUNDENAVNE[(hid * 6 + i) % len(KUNDENAVNE)]


def ny_plads(hid, farve, i):
    """Plads i i klinikken: personalet, hvis klinikken har det, ellers en kunde."""
    b = Baever(f"b{hid}_{i}", kundenavn(hid, i))
    fast = PERSONALE.get(farve, [])
    if i < len(fast):
        b.navn = fast[i][0]
        b.udseende = {"v": 5, "figur": fast[i][1], "fast": True}
    return b

STANDARD_INDST = {
    "turtid": 30,
    "kamptid": 1800,
    "vind": True,
    "vejr": "auto",
    "bane": 0,
    "banetype": "fort",
    "baevere_pr_hold": 3,
}

RUM = {}
RUM_LAAS = threading.RLock()

_tilslut_forsoeg = {}           # ip -> [tidspunkter]
_forsoeg_laas = threading.Lock()


# ---------------------------------------------------------------- datamodel

class Baever:
    __slots__ = ("id", "navn", "udseende", "ejer")

    def __init__(self, bid, navn):
        self.id = bid
        self.navn = navn
        self.udseende = {}
        self.ejer = None

    def dict(self):
        return {"id": self.id, "navn": self.navn, "udseende": self.udseende, "ejer": self.ejer}


class Hold:
    __slots__ = ("id", "farve", "baevere")

    def __init__(self, hid, farve, antal):
        self.id = hid
        self.farve = farve
        self.baevere = [ny_plads(hid, farve, i) for i in range(antal)]

    def dict(self):
        return {"id": self.id, "farve": self.farve, "navn": HOLD_NAVNE[self.farve],
                "baevere": [b.dict() for b in self.baevere]}


class Deltager:
    __slots__ = ("pid", "tok", "navn", "conn", "forbundet", "klar", "tilskuer",
                 "tabt_tid", "ms", "kom_ind")

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

    def dict(self):
        return {"pid": self.pid, "navn": self.navn, "forbundet": self.forbundet,
                "klar": self.klar, "tilskuer": self.tilskuer, "ms": self.ms}


class Rum:
    def __init__(self, kode, indst):
        self.kode = kode
        self.laas = threading.RLock()
        self.fase = "venter"                 # venter | i_gang | slut
        self.vaert = None
        self.deltagere = {}                  # pid -> Deltager
        self.indst = dict(STANDARD_INDST)
        self.indst.update(indst or {})
        self.hold = [Hold(i, HOLD_FARVER[i], self.indst["baevere_pr_hold"]) for i in range(2)]
        self.seq = 0
        self.oprettet = time.time()
        self.tom_siden = time.time()
        self.sidst_aktiv = time.time()
        self.sidste_vaert_besked = time.time()
        self.stille_meldt = False
        self.terraen = None                  # bagt maske uploadet over HTTP

    # ---- afledt tilstand

    def forbundne(self):
        return [d for d in self.deltagere.values() if d.forbundet]

    def antal_baevere(self):
        return sum(len(h.baevere) for h in self.hold)

    def lobby(self, til_pid=None):
        return {"t": "lobby", "d": {
            "kode": self.kode,
            "fase": self.fase,
            "vaert": self.vaert,
            "dig": til_pid,
            "indst": self.indst,
            "deltagere": [d.dict() for d in self.deltagere.values()],
            "hold": [h.dict() for h in self.hold],
        }}

    # ---- udsendelse

    def broadcast(self, obj, hot=False, undtagen=None):
        """Kod rammen én gang, snapshot modtagerne under låsen, send udenfor.

        Regel: hold aldrig låsen mens du skriver til en socket. send() rører
        heller ikke socket'en — den lægger kun i forbindelsens egen kø, så én
        langsom klient aldrig standser de andre.
        """
        ramme = ws.tekst_ramme(obj)
        with self.laas:
            maal = [d.conn for d in self.deltagere.values()
                    if d.conn and d.forbundet and d.pid != undtagen]
        for c in maal:
            if not c.send(ramme, hot=hot):
                c.luk_stille()

    def send_til(self, pid, obj):
        with self.laas:
            d = self.deltagere.get(pid)
            c = d.conn if d and d.forbundet else None
        if c:
            c.send_json(obj)

    def send_lobby(self):
        """Lobbyen sender altid FULD tilstand — aldrig diffs.

        Den ændrer sig et par gange i sekundet i værste fald, og fuld tilstand
        fjerner hele klassen af desync-fejl. Kampen sender derimod kun deltas.
        """
        with self.laas:
            modtagere = [(d.pid, d.conn) for d in self.deltagere.values() if d.forbundet and d.conn]
        for pid, c in modtagere:
            c.send_json(self.lobby(pid))


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
                           "hold": len(r.hold), "vaert": (r.deltagere.get(r.vaert).navn
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
    ctx = {"rum": None, "pid": None, "tok": None, "navn": "Kunde"}
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
        forlad(ctx, grund="forbindelse tabt", haardt=False)


def haandter(conn, ctx, msg, ip):
    t = msg.get("t")
    d = msg.get("d") or {}
    r = ctx["rum"]
    pid = ctx["pid"]
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
        forlad(ctx, grund="forlod spillet", haardt=True)
        return
    if t == "saede":
        return _saede(conn, ctx, d)
    if t == "navngiv":
        return _navngiv(conn, ctx, d)
    if t == "klar":
        with r.laas:
            r.deltagere[pid].klar = bool(d.get("klar"))
        r.send_lobby()
        return
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

    # Gentilslutning: kender vi pid+tok i et rum, binder vi sæderne tilbage.
    kode = d.get("rum")
    if pid and tok and kode:
        r = find_rum(kode)
        if r:
            with r.laas:
                gl = r.deltagere.get(pid)
                if gl and secrets.compare_digest(gl.tok, tok):
                    gl.conn = conn
                    gl.forbundet = True
                    gl.tabt_tid = 0.0
                    gl.navn = navn
                    ctx["rum"], ctx["pid"], ctx["tok"] = r, pid, tok
                    conn.data["rum"] = r
                    conn.data["pid"] = pid
            if ctx["rum"] is r:
                conn.send_json({"t": "velkommen", "d": {
                    "pid": pid, "tok": tok, "server": "Kundekrigen/1.0",
                    "protokol": 1, "tid": time.time() * 1000, "genfundet": True}})
                r.send_lobby()
                if r.fase == "i_gang":
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
        _placer_automatisk(r, dl.pid)
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
        r.deltagere[dl.pid] = dl
        r.tom_siden = 0
        if not dl.tilskuer:
            _placer_automatisk(r, dl.pid)
        vaert = r.vaert
    ctx["rum"] = r
    conn.data["rum"] = r
    conn.data["pid"] = dl.pid

    conn.send_json({"t": "rum", "d": {"kode": r.kode, "vaert": vaert, "dig": dl.pid}})
    r.broadcast({"t": "deltager_ind", "d": {"pid": dl.pid, "navn": navn}}, undtagen=dl.pid)
    r.send_lobby()
    if dl.tilskuer:
        conn.send_json(protokol.fejl("i_gang"))
        r.send_til(vaert, {"t": "snap_bed", "d": {"pid": dl.pid}})


def _placer_automatisk(r, pid):
    """Sæt nyankommen på det hold der har færrest ejede bævere."""
    bedst, bedst_antal = None, 99
    for h in r.hold:
        ejede = sum(1 for b in h.baevere if b.ejer)
        ledige = [b for b in h.baevere if b.ejer is None]
        if ledige and ejede < bedst_antal:
            bedst, bedst_antal = ledige[0], ejede
    if bedst:
        bedst.ejer = pid


def _find_baever(r, bid):
    for h in r.hold:
        for b in h.baevere:
            if b.id == bid:
                return h, b
    return None, None


def _saede(conn, ctx, d):
    r, pid = ctx["rum"], ctx["pid"]
    er_vaert = r.vaert == pid
    with r.laas:
        h, b = _find_baever(r, d.get("baever"))
        if not b:
            conn.send_json(protokol.fejl("ikke_dit_saede"))
            return
        ny_ejer = d.get("ejer")
        # Kun værten må røre andres sæder.
        if not er_vaert and b.ejer not in (None, pid):
            conn.send_json(protokol.fejl("ikke_dit_saede"))
            return
        if not er_vaert and ny_ejer not in (None, pid):
            conn.send_json(protokol.fejl("ikke_dit_saede"))
            return
        # Ikke teknisk nødvendigt, men det forhindrer den hyppigste klikfejl.
        if ny_ejer:
            for h2 in r.hold:
                if h2 is h:
                    continue
                if any(x.ejer == ny_ejer for x in h2.baevere):
                    conn.send_json(protokol.fejl("to_hold"))
                    return
        b.ejer = ny_ejer
    r.send_lobby()


def _navngiv(conn, ctx, d):
    r, pid = ctx["rum"], ctx["pid"]
    with r.laas:
        _, b = _find_baever(r, d.get("baever"))
        if not b or (b.ejer != pid and r.vaert != pid):
            conn.send_json(protokol.fejl("ikke_dit_saede"))
            return
        # Personalet er faste roller. Ingen lobby-udsendelse, ellers sender
        # klienten sit profil-udseende i ring.
        if b.udseende.get("fast"):
            return
        navn = (d.get("navn") or "").strip()[:14]
        if navn:
            b.navn = navn
        if isinstance(d.get("udseende"), dict):
            b.udseende = d["udseende"]
    r.send_lobby()


def _indst(conn, ctx, d):
    r = ctx["rum"]
    with r.laas:
        for k in ("turtid", "kamptid", "vind", "vejr", "bane", "banetype"):
            if k in d:
                r.indst[k] = d[k]
        if "hold" in d:
            _saet_antal_hold(r, int(d["hold"]))
        if "baevere_pr_hold" in d:
            n = max(1, min(6, int(d["baevere_pr_hold"])))
            r.indst["baevere_pr_hold"] = n
            _saet_hold_stoerrelse(r, n)
    r.send_lobby()


def _saet_antal_hold(r, n):
    n = max(2, min(MAKS_HOLD, n))
    while len(r.hold) < n:
        i = len(r.hold)
        r.hold.append(Hold(i, HOLD_FARVER[i], r.indst["baevere_pr_hold"]))
    while len(r.hold) > n:
        r.hold.pop()


def _saet_hold_stoerrelse(r, n):
    for h in r.hold:
        while len(h.baevere) < n:
            i = len(h.baevere)
            h.baevere.append(ny_plads(h.id, h.farve, i))
        while len(h.baevere) > n:
            h.baevere.pop()


def _start(conn, ctx):
    r = ctx["rum"]
    with r.laas:
        med_baevere = [h for h in r.hold if any(b.ejer for b in h.baevere)]
        if len(med_baevere) < 2:
            conn.send_json(protokol.fejl("for_faa_hold"))
            return
        if len(r.hold) > MAKS_HOLD:
            conn.send_json(protokol.fejl("for_mange_hold"))
            return
        if r.antal_baevere() > MAKS_BAEVERE:
            conn.send_json(protokol.fejl("for_mange_baevere"))
            return
        ikke_klar = [d for d in r.forbundne() if not d.klar and not d.tilskuer and d.pid != r.vaert]
        if ikke_klar:
            conn.send_json(protokol.fejl("ikke_klar"))
            return
        if not r.indst.get("bane"):
            r.indst["bane"] = secrets.randbelow(2 ** 31)
        r.fase = "i_gang"
        r.seq = 0
        r.sidste_vaert_besked = time.time()
        r.stille_meldt = False
        opsaet = {"indst": r.indst, "hold": [h.dict() for h in r.hold]}
        antal = r.antal_baevere()
    r.broadcast({"t": "start", "d": opsaet})
    print(f"[rum] {r.kode} startet · {len(opsaet['hold'])} hold · {antal} bævere")


def _smid_ud(conn, ctx, d):
    r = ctx["rum"]
    offer = d.get("pid")
    with r.laas:
        dl = r.deltagere.pop(offer, None)
        if dl:
            for h in r.hold:
                for b in h.baevere:
                    if b.ejer == offer:
                        b.ejer = None
    if dl and dl.conn:
        dl.conn.send_json({"t": "smidt_ud", "d": {"grund": d.get("grund") or "Værten fjernede dig."}})
        dl.conn.luk(4001, "smidt ud")
    r.send_lobby()


def _relae(conn, ctx, t, d, msg):
    r, pid = ctx["rum"], ctx["pid"]
    with r.laas:
        if r.vaert == pid:
            r.sidste_vaert_besked = time.time()
            if r.stille_meldt:
                r.stille_meldt = False
        # Sekvensnummeret tæller KUN pålidelige beskeder, der sendes til
        # alle. Hot-beskeder (st) må droppes af coalescingen, og adresserede
        # beskeder når kun én modtager — fik de et nummer, ville alle andre
        # se et "hul" og bede om et fuldt snapshot. Et adresseret snapshot
        # bærer det aktuelle nummer, så modtageren synkroniserer til det.
        paalidelig_bred = (t not in protokol.HOT and t not in protokol.TIL_VAERT_KUN
                           and not (t == "snapshot" and d.get("to")))
        if paalidelig_bred:
            r.seq += 1
        seq = r.seq
        r.sidst_aktiv = time.time()
        vaert = r.vaert

    ud = {"t": t, "d": d, "f": pid}
    if t not in protokol.HOT:
        ud["s"] = seq

    if t in protokol.TIL_VAERT_KUN:
        r.send_til(vaert, ud)
        return
    if t == "snapshot" and d.get("to"):
        r.send_til(d["to"], ud)
        return
    if t == "chat":
        d["tekst"] = str(d.get("tekst", ""))[:250]
    r.broadcast(ud, hot=(t in protokol.HOT), undtagen=pid if t in ("st",) else None)


# ---------------------------------------------------------------- afgang

def forlad(ctx, grund="", haardt=False):
    r, pid = ctx.get("rum"), ctx.get("pid")
    if not r or not pid:
        return
    tom = False
    var_vaert = False
    with r.laas:
        dl = r.deltagere.get(pid)
        if not dl:
            return
        var_vaert = r.vaert == pid
        if haardt:
            # Bevidst afgang frigiver sæderne straks.
            r.deltagere.pop(pid, None)
            for h in r.hold:
                for b in h.baevere:
                    if b.ejer == pid:
                        b.ejer = None
        else:
            # Tabt forbindelse: hold sæderne i GENTILSLUT sekunder.
            dl.forbundet = False
            dl.conn = None
            dl.tabt_tid = time.time()
        if not r.forbundne():
            r.tom_siden = time.time()
            tom = True
        if var_vaert:
            _forfrem_vaert(r)
        ny_vaert = r.vaert
        i_gang = r.fase == "i_gang"
    ctx["rum"] = None

    r.broadcast({"t": "deltager_ud", "d": {"pid": pid, "grund": grund}})
    if var_vaert and not tom:
        # Værtens browser havde hele simulationstilstanden. Vi flytter den ikke —
        # rummet overlever, lobbyen er intakt, og de kan trykke start igen.
        if i_gang:
            with r.laas:
                r.fase = "venter"
                for d2 in r.deltagere.values():
                    d2.tilskuer = False
                    d2.klar = False
            r.broadcast({"t": "kamp_afbrudt", "d": {"grund": "Værten forlod spillet."}})
        if ny_vaert:
            with r.laas:
                nv = r.deltagere.get(ny_vaert)
            r.broadcast({"t": "vaert_skiftet", "d": {"pid": ny_vaert,
                                                     "navn": nv.navn if nv else "—"}})
    if not tom:
        r.send_lobby()


def _forfrem_vaert(r):
    """Længst tilsluttede forbundne deltager bliver ny vært."""
    kandidater = [d for d in r.deltagere.values() if d.forbundet]
    r.vaert = min(kandidater, key=lambda d: d.kom_ind).pid if kandidater else None


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
    # Sæder hvis ejer ikke er kommet tilbage inden for vinduet.
    frigiv = []
    with r.laas:
        for d in list(r.deltagere.values()):
            if not d.forbundet and d.tabt_tid and nu - d.tabt_tid > GENTILSLUT:
                frigiv.append(d.pid)
                r.deltagere.pop(d.pid, None)
                for h in r.hold:
                    for b in h.baevere:
                        if b.ejer == d.pid:
                            b.ejer = None
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
            r.fase = "venter"
            for d in r.deltagere.values():
                d.tilskuer = False
                d.klar = False
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
