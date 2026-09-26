"""RFC 6455 WebSocket oven på http.server — kun Pythons standardbibliotek.

Designnoter der er værd at kende, før du retter i filen:

* Al læsning går gennem handlerens ``rfile``, aldrig ``connection.recv()``.
  ``rfile`` er bufferet, og en pipelinende klient kan have sendt bytes der
  allerede ligger i den buffer; recv() ville springe dem over, og fejlen ville
  først vise sig under last og ligne et framing-problem.
* Præcis én writer-tråd per forbindelse. To tråde der skriver, fletter rammer.
* Ingen read-timeout under sessionen. En timeout midt i en ramme efterlader
  rfile i udefineret position, og næste læsning tolker payload som header.
  Writer-tråden ejer ping-fristen og vækker læseren med shutdown().
* Vi forhandler aldrig permessage-deflate. RSV1-fejl er den værste fejlklasse
  i håndkodede servere, og vores beskeder er for små til at komprimering betaler.
"""

import base64
import collections
import hashlib
import json
import socket
import struct
import threading
import time

# RFC 6455 §1.3. Ét forkert ciffer her, og ALLE browsere afviser håndtrykket
# med kode 1006, mens en hjemmelavet testklient, der ikke tjekker svaret,
# slipper igennem. test_ws.py tjekker derfor mod RFC'ens publicerede facit.
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

OP_CONT, OP_TEXT, OP_BIN, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA

MAX_PAYLOAD = 256 * 1024
PING_HVER = 15.0
PONG_FRIST = 10.0
KOE_LOFT = 128

# Alle åbne forbindelser, så main() kan lukke pænt ned ved Ctrl-C.
REGISTER = set()
REGISTER_LAAS = threading.Lock()


class WSFejl(Exception):
    """Protokolbrud. ``kode`` er den WebSocket-lukkekode vi svarer med."""

    def __init__(self, kode=1002, hvorfor=""):
        super().__init__(hvorfor or f"ws-fejl {kode}")
        self.kode = kode
        self.hvorfor = hvorfor


# ---------------------------------------------------------------- rammer

def accept_key(key):
    """base64(sha1(key + GUID)) — RFC 6455 §4.2.2."""
    return base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")


def encode_frame(opcode, payload=b"", fin=True):
    """Serverrammer maskeres aldrig. Vælger 7-, 16- eller 64-bit længdeform."""
    b0 = (0x80 if fin else 0) | opcode
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", b0, n)
    elif n < 65536:
        head = struct.pack("!BBH", b0, 126, n)
    else:
        head = struct.pack("!BBQ", b0, 127, n)
    return head + payload


def tekst_ramme(obj):
    """JSON -> færdig tekstramme.

    Kaldes ÉN gang per broadcast; resultatet deles af alle modtagere, fordi
    bytes er immutable. Det er forskellen på 80 og 880 serialiseringer i
    sekundet ved fire samtidige rum.
    """
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return encode_frame(OP_TEXT, data)


def luk_ramme(kode=1000, aarsag=""):
    krop = struct.pack("!H", kode) + aarsag.encode("utf-8")[:123]
    return encode_frame(OP_CLOSE, krop)


# ---------------------------------------------------------------- forbindelse

class WSConn:
    """Én WebSocket-forbindelse.

    Læsesiden kører i HTTP-handlerens egen tråd. Skrivesiden har sin egen tråd,
    så et broadcast aldrig blokerer på en langsom klient.
    """

    def __init__(self, sock, rfile, wfile, peer):
        self.sock = sock
        self.rfile = rfile
        self.wfile = wfile
        self.peer = peer

        self.ude = collections.deque()          # (art, bytes) — art er "hot" | "rel"
        self.cv = threading.Condition()
        self.aaben = True
        self.doed = False
        self.sidste_pong = time.monotonic()
        self.luk_sendt = False

        # Tælles til /api/status — det første tal man kigger på ved "det hakker".
        self.hot_droppet = 0
        self.draebt_af_koe = False

        self.data = {}                          # rum.py hænger deltagerinfo her

        self._writer = threading.Thread(target=self._writer_loop, daemon=True,
                                        name=f"ws-writer-{peer}")
        self._writer.start()

    # -------------------------------------------------- skrivesiden (alle tråde)

    def send(self, ramme, hot=False):
        """Læg en færdigkodet ramme i køen. Rører aldrig socket'en.

        hot=True betyder "må gerne erstattes": en forældet 20 Hz-tilstand har
        ingen værdi, så den nyeste overskriver den ventende. Pålidelige beskeder
        droppes derimod aldrig — løber køen over, er klienten reelt væk.
        """
        with self.cv:
            if not self.aaben:
                return False
            if hot:
                for i, (art, _) in enumerate(self.ude):
                    if art == "hot":
                        self.ude[i] = ("hot", ramme)
                        self.hot_droppet += 1
                        self.cv.notify()
                        return True
                self.ude.append(("hot", ramme))
            else:
                if len(self.ude) >= KOE_LOFT:
                    self.aaben = False
                    self.draebt_af_koe = True
                    self.cv.notify()
                    return False
                self.ude.append(("rel", ramme))
            self.cv.notify()
            return True

    def send_json(self, obj, hot=False):
        return self.send(tekst_ramme(obj), hot=hot)

    def luk(self, kode=1000, aarsag=""):
        with self.cv:
            if not self.aaben:
                return
            if not self.luk_sendt:
                self.ude.append(("rel", luk_ramme(kode, aarsag)))
                self.luk_sendt = True
            self.aaben = False
            self.cv.notify()

    def afslut(self, frist=1.0):
        """Luk pænt: lad writer-tråden tømme køen (inkl. close-rammen) først.

        Uden denne ventetid river handlerens oprydning socket'en ned, før
        close-rammen er sendt, og klienten ser et hårdt TCP-reset i stedet for
        et ordentligt håndtryk.
        """
        with self.cv:
            self.aaben = False
            self.cv.notify()
        self._writer.join(timeout=frist)
        self.luk_stille()

    def luk_stille(self):
        """Riv forbindelsen ned uden close-håndtryk (sidste udvej)."""
        with self.cv:
            self.aaben = False
            self.doed = True
            self.cv.notify()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _writer_loop(self):
        naeste_ping = time.monotonic() + PING_HVER
        while True:
            with self.cv:
                while self.aaben and not self.ude:
                    resten = naeste_ping - time.monotonic()
                    if resten <= 0:
                        break
                    self.cv.wait(timeout=min(resten, 1.0))
                if not self.aaben and not self.ude:
                    break
                nu = time.monotonic()
                if not self.ude and nu >= naeste_ping:
                    # Ingen pong inden fristen -> klienten er væk. Vi kan ikke
                    # afbryde en blokerende læsning direkte, så vi river socket'en
                    # ned; læsetråden vågner med en tom læsning og rydder op.
                    if nu - self.sidste_pong > PING_HVER + PONG_FRIST:
                        break
                    naeste_ping = nu + PING_HVER
                    art, ramme = "rel", encode_frame(OP_PING, b"bv")
                else:
                    if not self.ude:
                        continue
                    art, ramme = self.ude.popleft()
            try:
                self.wfile.write(ramme)
            except (OSError, ValueError):
                break
        self.luk_stille()

    # -------------------------------------------------- læsesiden (én tråd)

    def _laes_praecis(self, n):
        ud = b""
        while len(ud) < n:
            bid = self.rfile.read(n - len(ud))
            if not bid:
                raise ConnectionResetError("forbindelsen lukkede midt i en ramme")
            ud += bid
        return ud

    def _laes_ramme(self):
        b0, b1 = struct.unpack("!BB", self._laes_praecis(2))
        fin = bool(b0 & 0x80)
        if b0 & 0x70:
            raise WSFejl(1002, "RSV-bit sat (vi forhandler ingen udvidelser)")
        opcode = b0 & 0x0F
        maskeret = bool(b1 & 0x80)
        laengde = b1 & 0x7F

        if laengde == 126:
            laengde = struct.unpack("!H", self._laes_praecis(2))[0]
        elif laengde == 127:
            laengde = struct.unpack("!Q", self._laes_praecis(8))[0]
            if laengde >> 63:
                raise WSFejl(1002, "64-bit længde med MSB sat")

        if not maskeret:
            raise WSFejl(1002, "klientramme skal være maskeret")
        if laengde > MAX_PAYLOAD:
            raise WSFejl(1009, f"ramme på {laengde} bytes overskrider loftet")
        if opcode in (OP_CLOSE, OP_PING, OP_PONG):
            if laengde > 125:
                raise WSFejl(1002, "kontrolramme over 125 bytes")
            if not fin:
                raise WSFejl(1002, "fragmenteret kontrolramme")

        maske = self._laes_praecis(4)
        krop = bytearray(self._laes_praecis(laengde))
        for i in range(laengde):
            krop[i] ^= maske[i & 3]
        return fin, opcode, bytes(krop)

    def laes_besked(self):
        """Returnér (opcode, payload) for en komplet besked, eller None ved close.

        Samler fragmenter. Kontrolrammer må ankomme midt i en fragmentsekvens
        og håndteres her uden at ødelægge samlingen — det er den kantsag alle
        håndkodede implementeringer glemmer.
        """
        samlet = bytearray()
        samlet_op = None

        while True:
            fin, opcode, krop = self._laes_ramme()

            if opcode == OP_CLOSE:
                kode = struct.unpack("!H", krop[:2])[0] if len(krop) >= 2 else 1000
                self.luk(kode if 1000 <= kode < 5000 else 1000)
                return None
            if opcode == OP_PING:
                self.send(encode_frame(OP_PONG, krop))
                continue
            if opcode == OP_PONG:
                self.sidste_pong = time.monotonic()
                continue

            if opcode == OP_CONT:
                if samlet_op is None:
                    raise WSFejl(1002, "continuation uden påbegyndt besked")
                samlet += krop
            elif opcode in (OP_TEXT, OP_BIN):
                if samlet_op is not None:
                    raise WSFejl(1002, "ny besked midt i en fragmentsekvens")
                samlet_op = opcode
                samlet += krop
            else:
                raise WSFejl(1002, f"ukendt opcode 0x{opcode:X}")

            if len(samlet) > MAX_PAYLOAD:
                raise WSFejl(1009, "samlet besked overskrider loftet")
            if fin:
                return samlet_op, bytes(samlet)


# ---------------------------------------------------------------- håndtryk

def _header_har(h, navn, ord_):
    v = h.get(navn, "")
    return ord_.lower() in v.lower()


def handshake(handler, tilladte_origins):
    """Opgradér en HTTP-forbindelse til WebSocket.

    Returnerer en WSConn, eller None hvis vi allerede har skrevet et fejlsvar.
    ``tilladte_origins`` er et sæt af præcise origin-strenge; et tomt sæt
    slår tjekket fra (kun til test).
    """
    h = handler.headers

    peer = handler.client_address[0]

    if not _header_har(h, "Upgrade", "websocket") or not _header_har(h, "Connection", "upgrade"):
        print(f"[ws] {peer} afvist: mangler Upgrade/Connection "
              f"(Upgrade={h.get('Upgrade')!r} Connection={h.get('Connection')!r})")
        handler.send_response(400)
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return None

    if h.get("Sec-WebSocket-Version", "") != "13":
        print(f"[ws] {peer} afvist: version {h.get('Sec-WebSocket-Version')!r}")
        handler.send_response(426)
        handler.send_header("Sec-WebSocket-Version", "13")
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return None

    # WebSocket er ikke omfattet af CORS. Uden dette tjek kan enhver webside en
    # kollega har åben, forbinde til serveren og spamme rum.
    origin = h.get("Origin")
    if tilladte_origins and origin is not None and origin not in tilladte_origins:
        print(f"[ws] {peer} afvist: Origin {origin!r} er ikke blandt {sorted(tilladte_origins)}")
        handler.send_response(403)
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return None

    key = h.get("Sec-WebSocket-Key")
    if not key:
        print(f"[ws] {peer} afvist: ingen Sec-WebSocket-Key")
        handler.send_response(400)
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return None

    handler.send_response(101, "Switching Protocols")
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", accept_key(key))
    handler.end_headers()
    # Vi ekkoer bevidst hverken Sec-WebSocket-Protocol eller -Extensions.

    peer = f"{handler.client_address[0]}:{handler.client_address[1]}"
    print(f"[ws] {peer} forbundet")
    conn = WSConn(handler.connection, handler.rfile, handler.wfile, peer)
    with REGISTER_LAAS:
        REGISTER.add(conn)
    return conn


def afmeld(conn):
    with REGISTER_LAAS:
        REGISTER.discard(conn)


def luk_alle(besked=None, kode=1001):
    """Pæn nedlukning: sig farvel på dansk, luk så alle sockets."""
    with REGISTER_LAAS:
        alle = list(REGISTER)
    if besked is not None:
        ramme = tekst_ramme(besked)
        for c in alle:
            c.send(ramme)
    for c in alle:
        c.luk(kode, "server lukker")
    time.sleep(0.15)
    for c in alle:
        c.luk_stille()
