"""Beskedtyper, afsenderrettigheder og danske fejltekster.

Holdt som ren data, så adgangskontrollen kan læses på én skærm i stedet for at
ligge spredt i if-kæder rundt om i rum.py.
"""

# Beskeder serveren fortolker. Værdien er hvem der må sende dem.
#   "alle"      — enhver forbindelse
#   "deltager"  — skal være i et rum
#   "vaert"     — skal være rummets vært
FORTOLKES = {
    "hej": "alle",
    "opret": "alle",
    "tilslut": "alle",
    "forlad": "deltager",
    "navngiv": "deltager",      # forældet; modtages, men gør ingenting
    "vaelg": "deltager",        # min fighter
    "hold": "deltager",         # mit hold: blåt eller rødt
    "stem": "deltager",         # min banestemme
    "klar": "deltager",         # også værten — nedtællingen venter på alle
    "indst": "vaert",
    "start": "vaert",           # med det samme, uden nedtælling; karaktervalget bruger den ikke længere
    "smid_ud": "vaert",
    "ping": "alle",
    "snap_bed": "deltager",
}

# Beskeder der relæes ordret til rummet. Serveren stempler afsender og sekvens.
RELAEES = {
    "st": "vaert",          # 20 Hz tilstand — hot, må coalesces
    "krater": "vaert",
    "tur": "vaert",
    "haendelse": "vaert",
    "vaaben": "vaert",
    "snapshot": "vaert",    # adresseret via "to"
    "slut": "vaert",        # kampen er slut: rummet går tilbage til lobbyen (rum._relae)
    "in": "deltager",       # input fra den aktive spiller, kun til værten
    "chat": "deltager",
    "emote": "deltager",
}

# Disse må kun komme fra værten. Uden dette tjek begynder en gammel fane med
# stale isHost at broadcaste sin egen virkelighed — en fejl der sker hele tiden
# under udvikling, og som er umulig at forstå indefra spillet.
KUN_VAERT = {"st", "krater", "tur", "haendelse", "vaaben", "snapshot", "slut"}

# Beskeder der må droppes under pres (forældet tilstand har ingen værdi).
HOT = {"st", "emote"}

# Relæ-mål: hvem skal have beskeden.
TIL_VAERT_KUN = {"in", "snap_bed"}

FEJL = {
    "ukendt_rum": "Rummet findes ikke — tjek koden.",
    "rum_fuldt": "Rummet er fuldt (12 deltagere).",
    "i_gang": "Kampen er allerede i gang — du er tilskuer.",
    "kun_vaert": "Kun værten kan gøre det.",
    "for_faa_hold": "Begge hold skal have mindst én spiller.",
    "for_mange_baevere": "Der kan højst være 12 spillere i kampen.",
    "ikke_klar": "Alle deltagere skal være klar, før kampen kan starte.",
    "for_mange_forsoeg": "For mange forsøg — vent et minut.",
    "ukendt_besked": "Ukendt besked.",
    "ikke_i_rum": "Du er ikke i et rum.",
    "server_fuld": "Serveren er fuld — prøv igen om lidt.",
    "for_mange_rum": "Der er for mange rum i gang — prøv igen om lidt.",
    "navn_kraevet": "Du skal angive et navn.",
    "laast_karakter": "Den karakter kommer snart.",
    "ukendt_hold": "Det hold findes ikke.",
    "vaelg_hold": "Vælg blåt eller rødt hold først.",
    "ukendt_bane": "Den bane findes ikke.",
}


def fejl(kode, ekstra=None):
    return {"t": "fejl", "d": {"kode": kode, "tekst": ekstra or FEJL.get(kode, "Der skete en fejl.")}}


def maa_sende(t, er_deltager, er_vaert):
    """Returnér (ok, fejlkode)."""
    krav = FORTOLKES.get(t) or RELAEES.get(t)
    if krav is None:
        return False, "ukendt_besked"
    if t in KUN_VAERT and not er_vaert:
        return False, "kun_vaert"
    if krav == "vaert" and not er_vaert:
        return False, "kun_vaert"
    if krav in ("deltager", "vaert") and not er_deltager:
        return False, "ikke_i_rum"
    return True, None
