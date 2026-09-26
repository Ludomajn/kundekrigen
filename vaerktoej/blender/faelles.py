"""Faelles Blender-hjaelpere for Baevere-grafikken.

Koeres altid hovedloest:  blender -b -noaudio -P <script>

BEMAERK: Blender crasher inde i Claude Codes sandkasse, fordi den fejler paa
Metal-detektering under opstart. Byggescriptet skal koeres uden sandkasse.

Renderopsaetningen er delt her, saa alle lag — baevere, objekter og baggrund —
bliver belyst ens. Ellers passer lagene ikke sammen i spillet.
"""

import os
import math
import bpy
import numpy as np

# Lyset er det samme i hele spillet: sol oppe til VENSTRE, ligesom i
# himmelgradienten og terraenets shader. Uden fael les lysretning ser de
# renderede lag forkerte ud oven paa det procedurelle terraen.
SOL_RETNING = (math.radians(62), 0.0, math.radians(38))


def nulstil():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.world = bpy.data.worlds.new("verden")
    bpy.context.scene.world.use_nodes = True
    bg = bpy.context.scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.42, 0.52, 0.58, 1.0)   # svag himmelbounce
    bg.inputs[1].default_value = 0.55


def opsaet_render(bredde, hoejde, samples=64):
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.render.resolution_x = bredde
    s.render.resolution_y = hoejde
    s.render.resolution_percentage = 100
    s.render.film_transparent = True
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.render.image_settings.compression = 70
    # Standard-filmic gjorde farverne graa og matte; Standard holder dem, som
    # de er sat, saa de kan tones ved koersel uden overraskelser.
    s.view_settings.view_transform = 'Standard'
    return s


def opsaet_kontur(tykkelse=1.5, farve=(0.10, 0.08, 0.06)):
    """Freestyle-omrids.

    Uden det bliver en bloed 3D-form til en groed, naar den vises som 40 px
    sprite i spillet. Et markeret omrids er praecis dét, der goer klassiske
    sprites laesbare ved lille stoerrelse — det er ikke pynt, det er funktion.
    """
    s = bpy.context.scene
    s.render.use_freestyle = True
    s.render.line_thickness_mode = 'ABSOLUTE'
    s.render.line_thickness = tykkelse

    vl = s.view_layers[0]
    vl.use_freestyle = True
    vl.freestyle_settings.as_render_pass = False
    if not vl.freestyle_settings.linesets:
        vl.freestyle_settings.linesets.new("kontur")
    ls = vl.freestyle_settings.linesets[0]
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.select_edge_mark = False
    # I Blender 5 er linestyle ikke altid oprettet paa forhaand.
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new("konturstil")
    ls.linestyle.color = farve
    ls.linestyle.thickness = tykkelse
    ls.linestyle.alpha = 0.9
    return ls


def opsaet_lys(styrke=2.5, fyld=0.85, kant=1.5):
    sol = bpy.data.objects.new("sol", bpy.data.lights.new("sol", type='SUN'))
    bpy.context.collection.objects.link(sol)
    sol.rotation_euler = SOL_RETNING
    sol.data.energy = styrke
    sol.data.angle = math.radians(12)          # bloed skyggekant
    sol.data.color = (1.0, 0.96, 0.88)

    f = bpy.data.objects.new("fyld", bpy.data.lights.new("fyld", type='AREA'))
    bpy.context.collection.objects.link(f)
    f.location = (3.2, -3.0, 0.6)
    f.rotation_euler = (math.radians(80), 0, math.radians(58))
    f.data.energy = fyld * 40
    f.data.size = 6
    f.data.color = (0.78, 0.88, 1.0)           # kold udfyldning fra himlen

    k = bpy.data.objects.new("kant", bpy.data.lights.new("kant", type='AREA'))
    bpy.context.collection.objects.link(k)
    k.location = (-1.6, 3.4, 2.2)
    k.rotation_euler = (math.radians(-60), 0, math.radians(-20))
    k.data.energy = kant * 40
    k.data.size = 5
    k.data.color = (0.85, 0.93, 1.0)
    return sol, f, k


def opsaet_kamera(ortho, placering=(0, -10, 0)):
    d = bpy.data.cameras.new("kam")
    d.type = 'ORTHO'
    d.ortho_scale = ortho
    k = bpy.data.objects.new("kam", d)
    bpy.context.collection.objects.link(k)
    k.location = placering
    k.rotation_euler = (math.radians(90), 0, 0)   # ser vandret ind ad +Y
    bpy.context.scene.camera = k
    return k


def materiale(navn, farve, ruhed=0.72, metal=0.0, gennemsigtig=False):
    m = bpy.data.materials.new(navn)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*farve, 1.0)
    b.inputs["Roughness"].default_value = ruhed
    b.inputs["Metallic"].default_value = metal
    return m


def saet_materiale(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def glat(obj, niveauer=2):
    for p in obj.data.polygons:
        p.use_smooth = True
    if niveauer:
        mod = obj.modifiers.new("subsurf", 'SUBSURF')
        mod.levels = niveauer
        mod.render_levels = niveauer


def kugle(navn, placering, skala, segmenter=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=segmenter,
                                         ring_count=segmenter // 2,
                                         location=placering)
    o = bpy.context.object
    o.name = navn
    o.scale = skala
    return o


def kasse(navn, placering, skala):
    bpy.ops.mesh.primitive_cube_add(size=1, location=placering)
    o = bpy.context.object
    o.name = navn
    o.scale = skala
    return o


def cylinder(navn, placering, radius, dybde, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=dybde,
                                        vertices=24, location=placering)
    o = bpy.context.object
    o.name = navn
    o.rotation_euler = rotation
    return o


def synlig(objekter, vis):
    """Styr hvad der kommer med i renderen. Det er dette, der goer lagdelingen
    mulig: samme positur, forskellige dele taendt."""
    for o in objekter:
        o.hide_render = not vis


def render_til(sti):
    os.makedirs(os.path.dirname(sti), exist_ok=True)
    bpy.context.scene.render.filepath = sti
    bpy.ops.render.render(write_still=True)


def _laes(sti):
    img = bpy.data.images.load(sti)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)          # raekke 0 = NEDERST


def lav_atlas(filer, kol, raek, celle_b, celle_h, ud):
    """Sy enkeltrenders sammen til ét ark.

    Blenders pixelbuffer begynder NEDERST, mens spillets atlas-opslag regner
    raekke 0 som oeverst — derfor vendes arket til sidst.
    """
    atlas = np.zeros((raek * celle_h, kol * celle_b, 4), dtype=np.float32)
    for i, f in enumerate(filer):
        if not os.path.exists(f):
            continue
        d = _laes(f)
        r, c = divmod(i, kol)
        # Skriv med raekke 0 = OEVERST i vores logiske ark
        y0 = (raek - 1 - r) * celle_h
        atlas[y0:y0 + celle_h, c * celle_b:(c + 1) * celle_b] = d

    h, w, _ = atlas.shape
    img = bpy.data.images.new("atlas", width=w, height=h, alpha=True)
    img.pixels.foreach_set(atlas.reshape(-1))
    img.file_format = 'PNG'
    os.makedirs(os.path.dirname(ud), exist_ok=True)
    img.save(filepath=ud)
    bpy.data.images.remove(img)
    print("ATLAS ->", ud, f"({w}x{h})")


def projekt_rod():
    her = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(her, "..", ".."))


def grafik_sti(*dele):
    return os.path.join(projekt_rod(), "static", "grafik", *dele)


def temp_sti(*dele):
    return os.path.join(projekt_rod(), "vaerktoej", "_render", *dele)
