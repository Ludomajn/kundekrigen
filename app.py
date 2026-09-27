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
mimetypes.add_type("video/mp4", ".mp4")        # filmintroens klip
mimetypes.add_type("video/webm", ".webm")


# ------------------------------------------------------------ modulgrafen
#
# Browseren opdager ES-modulerne ét importniveau ad gangen: main.js skal
# hentes, før den ved, at renderer.js findes, og så videre — ni bølger i alt,
# én rundtur hver. Over et mobilhotspot tog det ~4 s, og indtil sidste modul
# er hentet, kører INTET (heller ikke musikken). Løsningen uden byggetrin:
# serveren læser importerne selv og skriver <link rel="modulepreload"> for
# hele grafen ind i index.html, så alt hentes i én bølge.

IMPORT_RE = re.compile(
    r"""\b(?:import|export)\b[^'"`;()]*?\bfrom\s*['"]([^'"]+)['"]"""   # import x from '…' / export * from '…'
    r"""|\bimport\s*['"]([^'"]+)['"]""")                              # import '…'
_graf_cache = {"urls": [], "sig": None, "links": ""}
_graf_laas = threading.Lock()


def _fjern_kommentarer(kode):
    """Kommentarer kan citere importer ('import x from …'); de må ikke tælle."""
    kode = re.sub(r"/\*.*?\*/", "", kode, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", kode)


def modulgraf(start="/js/main.js"):
    """Alle moduler, main.js trækker ind statisk — som URL-stier, i
    opdagelsesrækkefølge. Kun filer, der findes under static/."""
    set_, koe = [], [start]
    while koe:
        url = koe.pop(0)
        if url in set_:
            continue
        p = (STATIC / url.lstrip("/")).resolve()
        if not str(p).startswith(str(STATIC)) or not p.is_file():
            continue
        set_.append(url)
        try:
            kode = _fjern_kommentarer(p.read_text("utf-8", errors="replace"))
        except OSError:
            continue
        mappe = url.rsplit("/", 1)[0]
        for m in IMPORT_RE.finditer(kode):
            spec = m.group(1) or m.group(2)
            if spec.startswith(("./", "../")):
                dele = (mappe + "/" + spec).split("/")
                ud = []
                for d in dele:
                    if d == "..":
                        if ud:
                            ud.pop()
                    elif d not in ("", "."):
                        ud.append(d)
                koe.append("/" + "/".join(ud))
            elif spec.startswith("/"):
                koe.append(spec)
    return set_


def preload_links():
    """<link>-linjerne til index.html. Genberegnes kun, når en fil i grafen
    er ændret (en ny import kræver, at den importerende fil ændres)."""
    def signatur(urls):
        try:
            return tuple((STATIC / u.lstrip("/")).stat().st_mtime_ns for u in urls)
        except OSError:
            return None

    c = _graf_cache                        # ét opslag: (urls, sig, links) hører sammen
    if c["urls"] and signatur(c["urls"]) == c["sig"]:
        return c["links"]
    with _graf_laas:                       # kun én tråd beregner; de andre venter på den
        c = _graf_cache
        if c["urls"] and signatur(c["urls"]) == c["sig"]:
            return c["links"]
        urls = modulgraf()
        # main.js selv hentes af <script>-tagget; resten forvarmes.
        links = "".join(f'<link rel="modulepreload" href="{u}">\n' for u in urls if u != "/js/main.js")
        globals()["_graf_cache"] = {"urls": urls, "sig": signatur(urls), "links": links}
        return links


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
        if "Cache-Control" not in (ekstra or {}):
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

    def serve_index(self):
        """index.html med preload af hele modulgrafen (se modulgraf)."""
        try:
            html = (STATIC / "index.html").read_text("utf-8")
        except OSError:
            return self._send(404, "404 — ikke fundet".encode("utf-8"))
        html = html.replace("</head>", preload_links() + "</head>", 1)
        return self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def serve_file(self, p: Path):
        try:
            st = p.stat()
        except OSError:
            return self._send(404, "404 — ikke fundet".encode("utf-8"))
        # Cache med genvalidering: browseren beholder filen, men spørger hver
        # gang, om den er ændret — et 304 uden krop, hvis ikke. Så får man
        # altid den nyeste udgave efter et deploy, uden at hente alt igen.
        # (Cloudflare foran Render gør ETag'en svag, når den komprimerer —
        # derfor sammenlignes uden "W/".)
        etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
        cache = {"Cache-Control": "no-cache", "ETag": etag}
        inm = self.headers.get("If-None-Match")
        if inm and etag in {t.strip().removeprefix("W/") for t in inm.split(",")}:
            self.send_response(304)
            for k, v in cache.items():
                self.send_header(k, v)
            self.end_headers()
            return
        try:                                   # først nu: et 304 skal ikke læse filen
            data = p.read_bytes()
        except (OSError, IsADirectoryError):
            return self._send(404, "404 — ikke fundet".encode("utf-8"))
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml",
                                                  "application/json"):
            ctype += "; charset=utf-8"

        # Range, så lyd kan spoles. If-Range: er filen ændret siden den
        # halve download, skal hele filen sendes — ikke et stykke af den nye.
        rng = self.headers.get("Range")
        if rng and self.headers.get("If-Range") not in (None, etag):
            rng = None
        if rng and rng.startswith("bytes="):
            try:
                a, _, b = rng[6:].partition("-")
                if a:
                    start = int(a)
                    slut = min(int(b) if b else len(data) - 1, len(data) - 1)
                else:                          # bytes=-N: de sidste N bytes
                    start, slut = max(0, len(data) - int(b)), len(data) - 1
                if start > slut:
                    raise ValueError
            except ValueError:
                return self._send(416, b"416", ekstra={"Content-Range": f"bytes */{len(data)}"})
            bid = data[start:slut + 1]
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Range", f"bytes {start}-{slut}/{len(data)}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(bid)))
            for k, v in cache.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(bid)
            return
        self._send(200, data, ctype, {"Accept-Ranges": "bytes", **cache})

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
            return self.serve_index()
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
    preload_links()                            # modulgrafen beregnes nu, ikke af første besøgende
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
