"""Byg og rendér baeveren i LAG.

Hvorfor lag: udseendet er et parametersaet (6 pelstoner x 8 hovedbeklaedninger
x 6 tilbehoer x 4 holdfarver). Det er over 1000 kombinationer gange 12 frames
— umuligt at prerendere. I stedet renderes:

  krop.png       pelsen i NEUTRAL GRAA, saa den kan tones ved koersel
  detalje.png    oejne, naese, taender — maa IKKE tones
  hat_N.png      hver hovedbeklaedning for sig, i samme positur
  tilb_N.png     hvert tilbehoer for sig
  halsklud.png   holdfarven, tones ved koersel

Spillet stabler lagene og ganger pelsfarven paa. Al tilpasning overlever, og
alt er aegte prerenderet 3D.

Koer:  blender -b -noaudio -P baever.py
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import faelles as F

CELLE = 192
FRAMES = ['idle', 'gang1', 'gang2', 'gang3', 'gang4', 'hop',
          'flyver', 'saaret', 'doed', 'svoemmer', 'graver', 'jubel']
KOL, RAEK = 4, 3

HATTE = ['hjelm', 'hue', 'sikkerhed', 'kasket', 'blad', 'blomst', 'hoerevaern']
TILBEHOER = ['halstoerklaede', 'seler', 'rygsaek', 'skovlbaelte', 'kikkert']

# Pelsen renderes i neutrale toner, saa spillet kan gange en farve paa.
# Vaerdierne er RELATIVE lysheder — bug lysere end ryg, hale moerkere.
G_KROP, G_BUG, G_HALE, G_LEM, G_OERE = 0.78, 0.98, 0.56, 0.66, 0.48


def byg():
    """Returnerer en dict af dellister, saa lagene kan taendes hver for sig."""
    m_pels = F.materiale("pels", (G_KROP,) * 3, ruhed=0.85)
    m_bug = F.materiale("bug", (G_BUG,) * 3, ruhed=0.88)
    m_hale = F.materiale("hale", (G_HALE,) * 3, ruhed=0.62)
    m_lem = F.materiale("lem", (G_LEM,) * 3, ruhed=0.8)
    m_oere = F.materiale("oere", (G_OERE,) * 3, ruhed=0.8)

    m_oeje = F.materiale("oeje", (0.02, 0.02, 0.03), ruhed=0.12)
    m_hvid = F.materiale("hvid", (0.94, 0.94, 0.92), ruhed=0.3)
    m_naese = F.materiale("naese", (0.10, 0.07, 0.06), ruhed=0.25)
    m_taend = F.materiale("taend", (0.97, 0.90, 0.68), ruhed=0.24)
    m_klud = F.materiale("klud", (0.9, 0.9, 0.9), ruhed=0.9)

    pels, detalje, klud = [], [], []

    # --- krop: paereformet, tung forneden
    krop = F.kugle("krop", (-0.04, 0, 0.54), (0.52, 0.45, 0.58))
    F.glat(krop); F.saet_materiale(krop, m_pels); pels.append(krop)

    bug = F.kugle("bug", (0.18, -0.18, 0.50), (0.34, 0.30, 0.42))
    F.glat(bug); F.saet_materiale(bug, m_bug); pels.append(bug)

    # --- hoved: STORT i forhold til kroppen. Et lille hoved laeser som gnaver
    # generelt; et stort laeser som baever og er desuden mere sympatisk.
    hoved = F.kugle("hoved", (0.15, 0, 1.30), (0.50, 0.47, 0.41))
    F.glat(hoved); F.saet_materiale(hoved, m_pels); pels.append(hoved)

    # Bred, fremskudt snude — det er her baeveren adskiller sig fra en kanin.
    snude = F.kugle("snude", (0.55, 0, 1.21), (0.33, 0.28, 0.22))
    F.glat(snude); F.saet_materiale(snude, m_bug); pels.append(snude)

    # Smaa, lave oerer. Store staaende oerer gjorde den til en kanin.
    for s, y in (("v", 0.28), ("h", -0.28)):
        o = F.kugle("oere_" + s, (-0.06, y, 1.64), (0.11, 0.05, 0.09))
        F.glat(o); F.saet_materiale(o, m_oere); pels.append(o)

    # --- HALE: baeverens signatur. En flad padle, stor og tydeligt UDEN FOR
    # silhuetten. En subdivideret kasse blev til en kugle; en fladtrykt kugle
    # giver den rigtige padleform.
    hale = F.kugle("hale", (-0.62, 0, 0.36), (0.60, 0.15, 0.42))
    F.glat(hale); F.saet_materiale(hale, m_hale); pels.append(hale)
    hale.rotation_euler = (0, math.radians(-38), 0)

    # --- lemmer
    for s, y in (("v", 0.26), ("h", -0.26)):
        f = F.kugle("fod_" + s, (0.06, y, 0.10), (0.26, 0.13, 0.11))
        F.glat(f); F.saet_materiale(f, m_lem); pels.append(f)
        a = F.kugle("arm_" + s, (0.38, y * 0.80, 0.76), (0.25, 0.10, 0.11))
        F.glat(a); F.saet_materiale(a, m_lem); pels.append(a)
        a.rotation_euler = (0, math.radians(-26), 0)

    # --- detaljer (tones ALDRIG)
    for s, y in (("v", 0.23), ("h", -0.23)):
        hv = F.kugle("oejehvid_" + s, (0.45, y, 1.42), (0.16, 0.16, 0.17), 20)
        F.glat(hv); F.saet_materiale(hv, m_hvid); detalje.append(hv)
        p = F.kugle("pupil_" + s, (0.57, y * 0.90, 1.42), (0.09, 0.09, 0.10), 18)
        F.glat(p); F.saet_materiale(p, m_oeje); detalje.append(p)

    naese = F.kugle("naese", (0.80, 0, 1.27), (0.105, 0.09, 0.075), 18)
    F.glat(naese); F.saet_materiale(naese, m_naese); detalje.append(naese)

    # FORTAENDER: skal stikke tydeligt frem under snuden, ellers er det ikke
    # en baever.
    for s, y in (("v", 0.085), ("h", -0.085)):
        t = F.kasse("taend_" + s, (0.75, y, 0.99), (0.155, 0.14, 0.36))
        F.glat(t, 1); F.saet_materiale(t, m_taend); detalje.append(t)

    # --- halsklud (holdfarve, tones ved koersel)
    # Et HALSBAAND, ikke en brystplade. For stor daekkede den fortaenderne,
    # og de er baeverens vigtigste kendetegn.
    hk = F.kugle("halsklud", (0.08, 0, 1.03), (0.36, 0.37, 0.07))
    F.glat(hk); F.saet_materiale(hk, m_klud); klud.append(hk)

    return {"pels": pels, "detalje": detalje, "klud": klud,
            "hoved": [hoved, snude, naese], "krop": krop, "hale": hale,
            "arme": [o for o in pels if o.name.startswith("arm_")],
            "foedder": [o for o in pels if o.name.startswith("fod_")]}


# ---------------------------------------------------------------- hovedtoej

def byg_hat(navn, dele):
    """Bygger én hovedbeklaedning og returnerer dens objekter."""
    m_farve = F.materiale("hatfarve", (0.9, 0.9, 0.9), ruhed=0.55)
    m_moerk = F.materiale("hatmoerk", (0.16, 0.13, 0.10), ruhed=0.6)
    m_hvid = F.materiale("hathvid", (0.93, 0.95, 0.96), ruhed=0.8)
    m_groen = F.materiale("hatgroen", (0.20, 0.33, 0.20), ruhed=0.7)
    m_gul = F.materiale("hatgul", (0.95, 0.78, 0.30), ruhed=0.45)
    ud = []

    if navn == "hjelm":
        o = F.kugle("hjelm", (0.10, 0, 1.60), (0.47, 0.45, 0.34))
        F.glat(o); F.saet_materiale(o, m_farve); ud.append(o)
    elif navn == "hue":
        o = F.kugle("hue", (0.06, 0, 1.68), (0.42, 0.40, 0.42))
        F.glat(o); F.saet_materiale(o, F.materiale("huefarve", (0.58, 0.21, 0.12))); ud.append(o)
        k = F.kugle("huekant", (0.08, 0, 1.52), (0.46, 0.44, 0.10))
        F.glat(k); F.saet_materiale(k, m_hvid); ud.append(k)
        t = F.kugle("huetop", (-0.14, 0, 1.98), (0.13, 0.13, 0.13))
        F.glat(t); F.saet_materiale(t, m_hvid); ud.append(t)
    elif navn == "sikkerhed":
        o = F.kugle("sik", (0.10, 0, 1.60), (0.45, 0.43, 0.32))
        F.glat(o); F.saet_materiale(o, m_gul); ud.append(o)
        s = F.kasse("sikskygge", (0.36, 0, 1.48), (0.42, 0.62, 0.05))
        F.glat(s, 1); F.saet_materiale(s, m_gul); ud.append(s)
    elif navn == "kasket":
        o = F.kugle("kas", (0.08, 0, 1.60), (0.44, 0.42, 0.30))
        F.glat(o); F.saet_materiale(o, m_farve); ud.append(o)
        s = F.kasse("kasskygge", (0.58, 0, 1.46), (0.44, 0.52, 0.05))
        F.glat(s, 1); F.saet_materiale(s, m_farve); ud.append(s)
    elif navn == "blad":
        o = F.kasse("blad", (0.14, 0, 1.78), (0.62, 0.34, 0.05))
        F.glat(o, 2); F.saet_materiale(o, m_groen); ud.append(o)
        o.rotation_euler = (0, math.radians(-18), 0)
    elif navn == "blomst":
        for i in range(5):
            a = i / 5 * math.tau
            k = F.kugle(f"kron{i}", (0.10 + math.cos(a) * 0.16, math.sin(a) * 0.16, 1.78),
                        (0.12, 0.12, 0.05))
            F.glat(k); F.saet_materiale(k, m_gul); ud.append(k)
        m = F.kugle("midte", (0.10, 0, 1.81), (0.08, 0.08, 0.05))
        F.glat(m); F.saet_materiale(m, F.materiale("blomstmidte", (0.64, 0.27, 0.15))); ud.append(m)
    elif navn == "hoerevaern":
        for s, y in (("v", 0.40), ("h", -0.40)):
            k = F.kugle("kop_" + s, (0.08, y, 1.44), (0.17, 0.10, 0.20))
            F.glat(k); F.saet_materiale(k, m_moerk); ud.append(k)
        b = F.kasse("boejle", (0.06, 0, 1.78), (0.10, 0.80, 0.07))
        F.glat(b, 2); F.saet_materiale(b, m_moerk); ud.append(b)
    return ud


def byg_tilbehoer(navn):
    m_laeder = F.materiale("laeder", (0.30, 0.24, 0.17), ruhed=0.7)
    m_stof = F.materiale("stof", (0.58, 0.21, 0.12), ruhed=0.85)
    m_metal = F.materiale("metal", (0.62, 0.64, 0.66), ruhed=0.3, metal=0.8)
    m_moerk = F.materiale("tmoerk", (0.12, 0.16, 0.13), ruhed=0.5)
    ud = []

    if navn == "halstoerklaede":
        o = F.kasse("toerklaede", (-0.20, 0, 0.82), (0.14, 0.16, 0.28))
        F.glat(o, 2); F.saet_materiale(o, m_stof); ud.append(o)
        o.rotation_euler = (0, math.radians(20), 0)
    elif navn == "seler":
        for x in (0.02, 0.30):
            o = F.kasse(f"sele{x}", (x, 0, 0.62), (0.07, 0.62, 0.62))
            F.glat(o, 1); F.saet_materiale(o, m_laeder); ud.append(o)
    elif navn == "rygsaek":
        o = F.kasse("rygsaek", (-0.46, 0, 0.72), (0.34, 0.50, 0.52))
        F.glat(o, 2); F.saet_materiale(o, m_laeder); ud.append(o)
        r = F.kasse("rem", (-0.44, 0, 0.86), (0.36, 0.54, 0.07))
        F.glat(r, 1); F.saet_materiale(r, m_moerk); ud.append(r)
    elif navn == "skovlbaelte":
        b = F.kasse("baelte", (0.06, 0, 0.36), (0.92, 0.86, 0.12))
        F.glat(b, 1); F.saet_materiale(b, m_laeder); ud.append(b)
        s = F.kasse("spaende", (0.36, 0, 0.36), (0.14, 0.30, 0.16))
        F.glat(s, 1); F.saet_materiale(s, m_metal); ud.append(s)
    elif navn == "kikkert":
        o = F.kasse("kikkert", (0.14, 0, 0.80), (0.30, 0.42, 0.20))
        F.glat(o, 2); F.saet_materiale(o, m_moerk); ud.append(o)
    return ud


# ------------------------------------------------------------------ positur

POSITUR = {
    # (hoejde, haeld_grad, hale_grad, arm_grad, ben_v, ben_h, oeje_skala)
    'idle':     (0.00,   0,  -14,  -26,  0.00,  0.00, 1.0),
    'gang1':    (0.03,  -3,  -26,  -46,  0.16, -0.16, 1.0),
    'gang2':    (0.00,   0,  -14,  -26,  0.00,  0.00, 1.0),
    'gang3':    (0.03,   3,   -4,   -6, -0.16,  0.16, 1.0),
    'gang4':    (0.00,   0,  -14,  -26,  0.00,  0.00, 1.0),
    'hop':      (0.16,  -9,  -36,  -64, -0.10, -0.10, 1.0),
    'flyver':   (0.12,  16,   16,  -78, -0.18,  0.08, 1.0),
    'saaret':   (-0.04, 11,    6,   16,  0.04, -0.04, 0.3),
    'doed':     (-0.16, 86,   30,   52,  0.10, -0.10, 0.1),
    'svoemmer': (-0.12, -6,  -34,  -16,  0.00,  0.00, 1.0),
    'graver':   (-0.06, 32,   12,  -68,  0.06, -0.06, 1.0),
    'jubel':    (0.10,   0,  -24, -122,  0.00,  0.00, 1.0),
}


def forbered(alle):
    """Haeng alt op under ét rod-objekt, saa haeldningen kan saettes samlet.

    Skal koeres FOER foerste positur og for ALLE dele paa én gang.
    """
    tom = bpy.data.objects.get("_rod")
    if tom is None:
        tom = bpy.data.objects.new("_rod", None)
        bpy.context.collection.objects.link(tom)
        tom.location = (0, 0, 0)
    bpy.context.view_layer.update()
    for o in alle:
        if o.parent is not tom:
            mw = o.matrix_world.copy()
            o.parent = tom
            o.matrix_parent_inverse = tom.matrix_world.inverted()
            o.matrix_world = mw
    return tom


def saet_positur(d, hat_dele, tilb_dele, frame):
    h, haeld, hale, arm, bv, bh, oeje = POSITUR[frame]

    alle = d["pels"] + d["detalje"] + d["klud"] + hat_dele + tilb_dele
    for o in alle:
        o.location.z = o.get("_z0", o.location.z) + h
        if "_z0" not in o:
            o["_z0"] = o.location.z - h

    bpy.data.objects["_rod"].rotation_euler = (0, math.radians(haeld), 0)

    d["hale"].rotation_euler = (0, math.radians(hale), 0)
    for a in d["arme"]:
        a.rotation_euler = (0, math.radians(arm), 0)
    for i, f in enumerate(d["foedder"]):
        f.location.x = f.get("_x0", f.location.x) + (bv if i == 0 else bh)
        if "_x0" not in f:
            f["_x0"] = f.location.x - (bv if i == 0 else bh)

    for o in d["detalje"]:
        if o.name.startswith(("oejehvid", "pupil")):
            s = o.get("_s0")
            if s is None:
                s = list(o.scale); o["_s0"] = s
            o.scale = (s[0], s[1], s[2] * oeje)


# ------------------------------------------------------------------- render

def render_lag(navn, tag_med, alle, dele, hat_dele, tilb_dele):
    filer = []
    for f in FRAMES:
        saet_positur(dele, hat_dele, tilb_dele, f)
        F.synlig(alle, False)
        F.synlig(tag_med, True)
        sti = F.temp_sti(navn, f"{f}.png")
        F.render_til(sti)
        filer.append(sti)
    F.lav_atlas(filer, KOL, RAEK, CELLE, CELLE, F.grafik_sti("baever", f"{navn}.png"))


def main():
    F.nulstil()
    F.opsaet_render(CELLE, CELLE, samples=32)
    F.opsaet_lys()
    F.opsaet_kontur(tykkelse=1.6)
    # Kameraet rammer baeveren med lidt luft omkring hale og hat.
    F.opsaet_kamera(ortho=3.15, placering=(-0.12, -10, 0.98))

    d = byg()
    hatte = {n: byg_hat(n, d) for n in HATTE}
    tilb = {n: byg_tilbehoer(n) for n in TILBEHOER}

    alle = d["pels"] + d["detalje"] + d["klud"]
    for v in hatte.values():
        alle += v
    for v in tilb.values():
        alle += v

    forbered(alle)
    tom_hat, tom_tilb = [], []

    render_lag("krop", d["pels"], alle, d, tom_hat, tom_tilb)
    render_lag("detalje", d["detalje"], alle, d, tom_hat, tom_tilb)
    render_lag("halsklud", d["klud"], alle, d, tom_hat, tom_tilb)
    for n in HATTE:
        render_lag(f"hat_{n}", hatte[n], alle, d, hatte[n], tom_tilb)
    for n in TILBEHOER:
        render_lag(f"tilb_{n}", tilb[n], alle, d, tom_hat, tilb[n])

    print("BAEVER FAERDIG")


if __name__ == "__main__":
    main()
