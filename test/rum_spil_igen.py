"""Kundekrigen — test: Spil igen i et netværksrum giver en NY bane (rum.py).

Samme regel som den lokale test i kort_gennemgang.mjs, men for serverens
rum: hver kamp får et nyt frø, og en 'tilfaeldig'-regel trækkes igen ved hver
kamp (den trukne banetype skrives ikke tilbage i rummets regler). Rummet
bygges direkte, uden server og uden sockets.

    python3 test/rum_spil_igen.py

Afslutningskoden er 1, hvis en kontrol fejler.
"""

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rum  # noqa: E402

fejl = 0


def tjek(navn, betingelse, detalje=""):
    global fejl
    print(f"  {'ok  ' if betingelse else 'FEJL'}  {navn}{f' — {detalje}' if detalje else ''}")
    if not betingelse:
        fejl += 1


def lav_rum(regel=None, stemmer=(None, None)):
    """Et rum med to spillere på hver sit hold (værten er den første)."""
    r = rum.Rum("TEST1", {"banetype": regel} if regel else None)
    for i, stemme in enumerate(stemmer):
        d = rum.Deltager(f"p_{i}", f"tok{i}", f"Spiller {i}", None)
        d.hold = i
        d.valg = "tilfaeldig"
        d.stemme = stemme
        r.deltagere[d.pid] = d
    r.vaert = "p_0"
    return r


def kampe(r, n=12):
    """n kampe efter hinanden i samme rum: start, slut, tilbage til lobbyen."""
    ud = []
    with r.laas:
        for _ in range(n):
            ud.append(rum._gaa_i_gang(r)["indst"])
            rum._tilbage_til_lobby(r)
    return ud


print("\nSpil igen i et netværksrum: hver kamp får en ny bane")
k = kampe(lav_rum())
froe = {x["bane"] for x in k}
tjek("12 kampe i samme rum får 12 forskellige frø", len(froe) == 12, f"{len(froe)} forskellige frø")
tjek("frøet er aldrig 0", all(x["bane"] for x in k))

r = lav_rum("tilfaeldig")
k = kampe(r)
typer = {x["banetype"] for x in k}
# Sandsynligheden for, at 12 rigtige lodtrækninger alle giver samme type, er 4 x 4^-12.
tjek("reglen 'tilfaeldig' trækkes igen ved hver kamp (12 kampe, mindst to typer)", len(typer) >= 2,
     ", ".join(sorted(typer)))
tjek("reglen står stadig som 'tilfaeldig' i rummet efter kampene", r.indst["banetype"] == "tilfaeldig",
     r.indst["banetype"])
tjek("kampens banetype er altid en af de fire", typer <= set(rum.BANE_TYPER), ", ".join(sorted(typer)))

r = lav_rum("oeer")
k = kampe(r, 4)
tjek("uden stemmer gælder reglens banetype", all(x["banetype"] == "oeer" for x in k))

r = lav_rum("fort", stemmer=("hule", "hule"))
k = kampe(r, 4)
tjek("stemmerne vinder over reglen, og reglen står uændret", all(x["banetype"] == "hule" for x in k)
     and r.indst["banetype"] == "fort")

r = lav_rum()
with r.laas:
    opsaet = rum._gaa_i_gang(r)
tjek("den genforbundnes start (r.opsaet) har kampens frø og type",
     r.opsaet is opsaet and r.opsaet["indst"]["bane"] and r.opsaet["indst"]["banetype"] in rum.BANE_TYPER)

print(f"\n{'ingen fejl' if not fejl else f'{fejl} fejl'}")
sys.exit(1 if fejl else 0)
