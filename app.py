"""Kundekrigen — server. Kun Pythons standardbibliotek.

Kør:  python3 app.py           (http://localhost:8788)

Serveren lytter på 0.0.0.0, fordi kollegerne skal kunne nå spillet fra deres
egne maskiner. Det flytter tillidsmodellen i forhold til et rent lokalt
værktøj — se README'ens afsnit om sikkerhed. Den ene kontrol der reelt
beskytter noget, er Origin-tjekket på WebSocket-opgraderingen: WebSocket er
ikke omfattet af CORS, så uden det kan enhver webside en kollega har åben,
forbinde hertil.
"""

import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import protokol  # noqa: F401  (holder importgrafen synlig)
import rum
import ws

HER = Path(__file__).resolve().parent
STATIC = (HER / "static").resolve()
DATA = HER / "data"

PORT = int(os.environ.get("PORT", "8788"))
BIND = os.environ.get("BIND", "0.0.0.0")
# Sættes til 1, når serveren står bag en proxy, der sætter X-Forwarded-For
# (Render gør). Se App.klient_ip.
BAG_PROXY = os.environ.get("BAG_PROXY") == "1"

RUM_STI = re.compile(r"^/spil/([A-Za-z0-9]{%d})/?$" % rum.KODE_LAENGDE)

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")


def alle_ipv4():
    """Alle maskinens IPv4-adresser undtagen loopback og link-local.

    En bærbar i en dock er ofte på to netværk på én gang (kabel + Wi-Fi), og
    kollegerne kan sidde på et hvilket som helst af dem. Derfor printes alle.
    """
    import subprocess
    try:
        ud = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=2).stdout
    except (OSError, subprocess.SubprocessError):
        return [lan_ip()]
    fundet = []
    for linje in ud.splitlines():
        dele = linje.split()
        if len(dele) >= 2 and dele[0] == "inet":
            ip = dele[1]
            if not ip.startswith(("127.", "169.254.")) and ip not in fundet:
                fundet.append(ip)
    return fundet or [lan_ip()]


def lan_ip():
    """Find maskinens LAN-adresse uden at slå DNS op."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class App(BaseHTTPRequestHandler):
    server_version = "Kundekrigen/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass                                   # vi logger selv, på dansk

    # ------------------------------------------------------------ svar

    def _send(self, kode, krop=b"", ctype="text/plain; charset=utf-8", ekstra=None):
        self.send_response(kode)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(krop)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (ekstra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if krop and self.command != "HEAD":
            self.wfile.write(krop)

    def json(self, obj, kode=200):
        krop = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(kode, krop, "application/json; charset=utf-8")

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raa = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raa.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ValueError("ugyldig JSON")

    # ------------------------------------------------------------ filer

    def serve_file(self, p: Path):
        try:
            data = p.read_bytes()
        except (OSError, IsADirectoryError):
            return self._send(404, "404 — ikke fundet".encode("utf-8"))
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml",
                                                  "application/json"):
            ctype += "; charset=utf-8"

        # Range, så lyd kan spoles.
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            try:
                a, _, b = rng[6:].partition("-")
                start = int(a) if a else 0
                slut = int(b) if b else len(data) - 1
                slut = min(slut, len(data) - 1)
                if start > slut:
                    raise ValueError
            except ValueError:
                return self._send(416, b"416")
            bid = data[start:slut + 1]
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Range", f"bytes {start}-{slut}/{len(data)}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(bid)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(bid)
            return
        self._send(200, data, ctype, {"Accept-Ranges": "bytes"})

    def serve_static(self, sti):
        """Spillet har undermapper (js/sim, vendor), så stien kan ikke bare
        fladgøres. I stedet: løs op og afvis udbrud."""
        p = (STATIC / sti.lstrip("/")).resolve()
        if not str(p).startswith(str(STATIC)):
            return self._send(403, b"403")
        if p.is_dir():
            return self._send(403, b"403")
        return self.serve_file(p)

    # ------------------------------------------------------------ routing

    def do_GET(self):
        url = urlparse(self.path)
        sti, q = url.path, parse_qs(url.query)
        if sti == "/ws":
            return self.websocket()
        if sti.startswith("/api/"):
            return self.api_get(sti, q)
        if sti.startswith("/terraen/"):
            return self.serve_terraen(sti.rsplit("/", 1)[1])
        if sti in ("/", "/index.html") or RUM_STI.match(sti):
            return self.serve_file(STATIC / "index.html")
        return self.serve_static(sti)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return self.json({"fejl": "ukendt endpoint"}, 404)
        try:
            return self.api_post(url.path, self.body())
        except PermissionError as e:
            return self.json({"fejl": str(e)}, 403)
        except ValueError as e:
            return self.json({"fejl": str(e)}, 400)

    def api_get(self, sti, q):
        if sti == "/api/rum":
            return self.json({"rum": rum.rum_liste()})
        if sti == "/api/status":
            return self.json(rum.status())
        return self.json({"fejl": "ukendt endpoint"}, 404)

    def api_post(self, sti, krop):
        if sti.startswith("/api/terraen/"):
            kode = sti.rsplit("/", 1)[1].upper()
            r = rum.find_rum(kode)
            if not r:
                raise ValueError("ukendt rum")
            with r.laas:
                r.terraen = krop
            return self.json({"ok": True})
        return self.json({"fejl": "ukendt endpoint"}, 404)

    def serve_terraen(self, kode):
        r = rum.find_rum(kode.upper())
        if not r:
            return self._send(404, b"404")
        with r.laas:
            t = r.terraen
        if t is None:
            return self._send(404, b"404")
        return self.json(t)

    # ------------------------------------------------------------ websocket

    def klient_ip(self):
        """Klientens rigtige IP — også bag en proxy (fx Render).

        Bag en proxy kommer ALLE forbindelser fra proxyens IP, og så ville
        grænsen på tilslutningsforsøg pr. IP ramme alle spillere på én gang.
        Med BAG_PROXY=1 bruges den sidste adresse i X-Forwarded-For: den
        sætter proxyen selv, så en klient ikke kan forfalske den (en klients
        egne værdier står foran). Uden BAG_PROXY ignoreres headeren, for så
        kunne enhver sætte den.
        """
        if BAG_PROXY:
            xff = self.headers.get("X-Forwarded-For", "")
            sidste = xff.split(",")[-1].strip()
            if sidste:
                return sidste
        return self.client_address[0]

    def websocket(self):
        vaert = self.headers.get("Host", "")
        tilladte = {f"http://{vaert}", f"https://{vaert}"}
        conn = ws.handshake(self, tilladte)
        if conn is None:
            self.close_connection = True
            return
        # HTTP/1.1-løkken må ikke prøve at parse en ny request bagefter.
        self.close_connection = True

        with ws.REGISTER_LAAS:
            for_mange = len(ws.REGISTER) > rum.MAKS_FORBINDELSER
        if for_mange:
            conn.send_json(protokol.fejl("server_fuld"))
            conn.afslut()
            ws.afmeld(conn)
            return

        ip = self.klient_ip()
        try:
            rum.session(conn, ip)
        except ws.WSFejl as e:
            conn.luk(e.kode, e.hvorfor)
        except (OSError, ConnectionResetError):
            pass
        finally:
            ws.afmeld(conn)
            conn.afslut(frist=0.5)


def main():
    DATA.mkdir(exist_ok=True)
    if not (STATIC / "index.html").exists():
        print(f"Fejl: {STATIC / 'index.html'} findes ikke.", file=sys.stderr)
        return 1

    # Linjebufferet log, også når serveren ikke kører i en terminal (fx som
    # baggrundsproces) — ellers ses afviste håndtryk først, når den lukker.
    sys.stdout.reconfigure(line_buffering=True)
    threading.Thread(target=rum.rydder_loop, daemon=True, name="rydder").start()

    srv = ThreadingHTTPServer((BIND, PORT), App)
    ip = lan_ip()
    print(f"Kundekrigen kører på http://{ip}:{PORT}")
    andre = [a for a in alle_ipv4() if a != ip]
    for a in andre:
        print(f"  også på         : http://{a}:{PORT}")
    print(f"  del det link, der hører til kollegernes netværk"
          + (" (maskinen er på flere)" if andre else ""))
    print(f"  lokalt          : http://localhost:{PORT}")
    print(f"  rum             : maks {rum.MAKS_RUM} · maks {rum.MAKS_DELTAGERE} deltagere per rum")
    print(f"  oprydning       : tomme rum fjernes efter {rum.TOM_RUM // 60} minutter")
    if BIND == "0.0.0.0":
        print("  bemærk          : serveren er åben for hele netværket og har intet login")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopper…")
        ws.luk_alle({"t": "fejl", "d": {"kode": "nedlukning",
                                        "tekst": "Serveren lukker ned."}})
        threading.Thread(target=srv.shutdown, daemon=True).start()
        time.sleep(0.3)
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
