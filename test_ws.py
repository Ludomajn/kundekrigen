"""RFC 6455-vektorer mod ws.py. Kør: python3 test_ws.py

Testen starter sin egen lille ekkoserver på en tilfældig port og taler til den
med en rå socket, så framinglaget testes isoleret fra spillet. Den skal være
grøn, før der bygges noget ovenpå — en framingfejl opdaget gennem spillogik
koster en dag.
"""

import os
import socket
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws  # noqa: E402

VAERT = "127.0.0.1"
_resultater = []


# ---------------------------------------------------------------- ekkoserver

class Ekko(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path != "/ws":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        origins = getattr(self.server, "tilladte_origins", set())
        conn = ws.handshake(self, origins)
        if conn is None:
            self.close_connection = True
            return
        self.close_connection = True
        try:
            while True:
                m = conn.laes_besked()
                if m is None:
                    break
                op, krop = m
                if op == ws.OP_TEXT:
                    try:
                        krop.decode("utf-8")
                    except UnicodeDecodeError:
                        raise ws.WSFejl(1007, "ugyldig UTF-8")
                conn.send(ws.encode_frame(op, krop))
        except ws.WSFejl as e:
            conn.luk(e.kode, e.hvorfor)
        except (OSError, ConnectionResetError):
            pass
        finally:
            ws.afmeld(conn)
            conn.afslut()


def start_server(origins=set()):
    srv = ThreadingHTTPServer((VAERT, 0), Ekko)
    srv.tilladte_origins = origins
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


# ---------------------------------------------------------------- rå klient

class Klient:
    def __init__(self, port, origin=None, version="13", key="dGhlIHNhbXBsZSBub25jZQ=="):
        self.s = socket.create_connection((VAERT, port), timeout=5)
        req = [f"GET /ws HTTP/1.1", f"Host: {VAERT}:{port}",
               "Upgrade: websocket", "Connection: keep-alive, Upgrade",
               f"Sec-WebSocket-Key: {key}", f"Sec-WebSocket-Version: {version}"]
        if origin:
            req.append(f"Origin: {origin}")
        self.s.sendall(("\r\n".join(req) + "\r\n\r\n").encode())
        self.buf = b""
        self.status, self.headers = self._laes_svar()

    def _laes_svar(self):
        while b"\r\n\r\n" not in self.buf:
            b = self.s.recv(4096)
            if not b:
                break
            self.buf += b
        head, _, rest = self.buf.partition(b"\r\n\r\n")
        self.buf = rest
        linjer = head.decode("latin1").split("\r\n")
        status = int(linjer[0].split()[1]) if linjer and len(linjer[0].split()) > 1 else 0
        hdr = {}
        for l in linjer[1:]:
            if ":" in l:
                k, _, v = l.partition(":")
                hdr[k.strip().lower()] = v.strip()
        return status, hdr

    def send(self, opcode, payload=b"", fin=True, maskeret=True, rsv=0):
        b0 = (0x80 if fin else 0) | (rsv << 4) | opcode
        n = len(payload)
        if n < 126:
            head = struct.pack("!BB", b0, (0x80 if maskeret else 0) | n)
        elif n < 65536:
            head = struct.pack("!BBH", b0, (0x80 if maskeret else 0) | 126, n)
        else:
            head = struct.pack("!BBQ", b0, (0x80 if maskeret else 0) | 127, n)
        if maskeret:
            m = b"\x01\x02\x03\x04"
            krop = bytes(payload[i] ^ m[i & 3] for i in range(n))
            self.s.sendall(head + m + krop)
        else:
            self.s.sendall(head + payload)

    def _recv(self, n):
        while len(self.buf) < n:
            b = self.s.recv(65536)
            if not b:
                raise ConnectionResetError("lukket")
            self.buf += b
        ud, self.buf = self.buf[:n], self.buf[n:]
        return ud

    def laes(self):
        b0, b1 = struct.unpack("!BB", self._recv(2))
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._recv(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._recv(8))[0]
        return b0 & 0x0F, self._recv(n), b1 & 0x80

    def luk(self):
        try:
            self.s.close()
        except OSError:
            pass


# ---------------------------------------------------------------- testramme

def tjek(navn, betingelse, detalje=""):
    _resultater.append((navn, bool(betingelse), detalje))
    mark = "  ok  " if betingelse else " FEJL "
    print(f"[{mark}] {navn}" + (f"   — {detalje}" if detalje and not betingelse else ""))


def forvent_luk(k, kode, navn):
    try:
        op, krop, _ = k.laes()
        faktisk = struct.unpack("!H", krop[:2])[0] if op == ws.OP_CLOSE and len(krop) >= 2 else None
        tjek(navn, op == ws.OP_CLOSE and faktisk == kode, f"fik opcode {op}, kode {faktisk}")
    except (ConnectionResetError, OSError) as e:
        tjek(navn, False, f"forbindelsen døde: {e}")


# ---------------------------------------------------------------- testene

def main():
    print("Kundekrigen — WebSocket-vektorer (RFC 6455)\n")

    # 1. Accept-nøglen, mod RFC 6455 §1.3's PUBLICEREDE eksempel. En tidligere
    #    udgave låste i stedet en selvberegnet værdi fast — med en forkert
    #    GUID-konstant — så testen var grøn, mens alle browsere afviste
    #    håndtrykket. Facit skal komme udefra, aldrig fra koden selv.
    a = ws.accept_key("dGhlIHNhbXBsZSBub25jZQ==")
    tjek("accept-nøgle matcher RFC 6455-facit", a == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", a)
    tjek("forskellige nøgler giver forskellige accepts",
         ws.accept_key("x3JJHMbDL1EzLkh9GBhXDw==") != a)

    srv, port = start_server()

    k = Klient(port)
    tjek("håndtryk svarer 101", k.status == 101, f"status {k.status}")
    tjek("Sec-WebSocket-Accept matcher RFC-facit",
         k.headers.get("sec-websocket-accept") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
         k.headers.get("sec-websocket-accept"))
    tjek("ingen udvidelser forhandlet", "sec-websocket-extensions" not in k.headers)

    # 2. Alle tre længdeformer, inkl. den oversete 64-bit sti.
    for n in (0, 1, 125, 126, 1000, 65535, 65536, 200000):
        nyttelast = bytes((i * 7 + 3) & 0xFF for i in range(n))
        k.send(ws.OP_BIN, nyttelast)
        op, krop, _ = k.laes()
        form = "7-bit" if n < 126 else ("16-bit" if n < 65536 else "64-bit")
        tjek(f"ekko af {n} bytes ({form} længdeform)",
             op == ws.OP_BIN and krop == nyttelast, f"fik {len(krop)} bytes")
    k.luk()

    # 3. Nyttelast over loftet -> 1009.
    k = Klient(port)
    k.send(ws.OP_BIN, b"x" * (ws.MAX_PAYLOAD + 10))
    forvent_luk(k, 1009, "nyttelast over loftet lukker med 1009")
    k.luk()

    # 4. Fragmentering, og en ping MIDT i sekvensen.
    k = Klient(port)
    k.send(ws.OP_TEXT, "bæ".encode(), fin=False)
    k.send(ws.OP_CONT, "ver".encode(), fin=False)
    k.send(ws.OP_PING, b"mellem")
    op, krop, _ = k.laes()
    tjek("ping midt i fragmentsekvens besvares med pong",
         op == ws.OP_PONG and krop == b"mellem", f"opcode {op}, krop {krop!r}")
    k.send(ws.OP_CONT, "!".encode(), fin=True)
    op, krop, _ = k.laes()
    tjek("fragmenteret besked samles korrekt",
         op == ws.OP_TEXT and krop.decode() == "bæver!", f"fik {krop!r}")
    k.luk()

    # 5. Serverrammer må aldrig være maskerede.
    k = Klient(port)
    k.send(ws.OP_TEXT, b"hej")
    _, _, maske = k.laes()
    tjek("serverramme er umaskeret", maske == 0)
    k.luk()

    # 6. Protokolbrud.
    k = Klient(port)
    k.send(ws.OP_TEXT, b"umaskeret", maskeret=False)
    forvent_luk(k, 1002, "umaskeret klientramme lukker med 1002")
    k.luk()

    k = Klient(port)
    k.send(ws.OP_TEXT, b"rsv", rsv=0x4)
    forvent_luk(k, 1002, "RSV1 sat lukker med 1002")
    k.luk()

    k = Klient(port)
    k.send(0x3, b"ukendt")
    forvent_luk(k, 1002, "ukendt opcode lukker med 1002")
    k.luk()

    k = Klient(port)
    k.send(ws.OP_PING, b"x" * 200)
    forvent_luk(k, 1002, "kontrolramme over 125 bytes lukker med 1002")
    k.luk()

    k = Klient(port)
    k.send(ws.OP_CONT, b"uden start")
    forvent_luk(k, 1002, "continuation uden påbegyndt besked lukker med 1002")
    k.luk()

    k = Klient(port)
    k.send(ws.OP_TEXT, b"\xff\xfe ugyldig")
    forvent_luk(k, 1007, "ugyldig UTF-8 i tekstramme lukker med 1007")
    k.luk()

    # 7. Close-håndtryk.
    k = Klient(port)
    k.send(ws.OP_CLOSE, struct.pack("!H", 1000))
    forvent_luk(k, 1000, "close 1000 besvares med close 1000")
    k.luk()

    # 8. Versionsforhandling.
    k = Klient(port, version="8")
    tjek("forkert version giver 426", k.status == 426, f"status {k.status}")
    tjek("426 oplyser understøttet version", k.headers.get("sec-websocket-version") == "13")
    k.luk()

    # 9. Origin-tjek — den ene kontrol der reelt beskytter en 0.0.0.0-server.
    srv2, p2 = start_server()
    srv2.tilladte_origins = {f"http://{VAERT}:{p2}"}
    k = Klient(p2, origin="http://ondt.example")
    tjek("fremmed Origin afvises med 403", k.status == 403, f"status {k.status}")
    k.luk()
    k = Klient(p2, origin=f"http://{VAERT}:{p2}")
    tjek("egen Origin accepteres", k.status == 101, f"status {k.status}")
    k.luk()

    srv.shutdown()
    srv2.shutdown()

    fejl = [n for n, ok, _ in _resultater if not ok]
    print(f"\n{len(_resultater) - len(fejl)}/{len(_resultater)} bestået")
    if fejl:
        print("Fejlede:")
        for n in fejl:
            print(f"  · {n}")
        return 1
    print("Rammelaget er grønt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
