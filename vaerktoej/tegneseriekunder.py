"""Kundekrigen — de 16 tegneseriekunder til spillet.

Kilden er brugerens figurer i Assets/Cartoon Characters/Kundekrigen (bygget
på rgsdev's Cartoon Character Generator): hver kunde har 20 frames à 512x512
i "No hands" (kun kroppen) og "Only hands" (hænder + sværd/pistol).

Spillet har sine egne IT-våben, så sværd og pistol kasseres. Værktøjet:
  1. Beskærer alle kropsframes med ÉT fælles udsnit (så fodpunktet er det
     samme for alle), skalerer ned og pakker de 20 i et atlas pr. kunde.
  2. Finder hudfarven (farver i hænderne, der også findes i ansigtet) og
     klipper en ren knytnæve ud — den hånd, der ikke rører våbnet.
  3. Finder de to hænders midtpunkt i hver frame, så hænderne kan følge
     animationen, når kunden ikke sigter.

Ud:  static/grafik/tegneserie/NN.webp, NN_haand.webp
     static/js/render/tegneserie_rig.js   (genereret — ret ikke i hånden)

Kræver Pillow og NumPy:  python3 vaerktoej/tegneseriekunder.py [kildemappe]
"""
import json, os, sys
from collections import Counter, deque

import numpy as np
from PIL import Image

HER = os.path.dirname(os.path.abspath(__file__))
ROD = os.path.dirname(HER)
KILDE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROD, '..', 'Assets', 'Cartoon Characters', 'Kundekrigen')
UD = os.path.join(ROD, 'static', 'grafik', 'tegneserie')
UD_JS = os.path.join(ROD, 'static', 'js', 'render', 'tegneserie_rig.js')

FRAMES = ([f'idle_{i}' for i in range(4)] + [f'run_{i}' for i in range(4)] + [f'jump_{i}' for i in range(2)]
          + [f'attack_r_{i}' for i in range(3)] + [f'attack_l_{i}' for i in range(3)] + [f'death_{i}' for i in range(4)])
OMDOEB = {'14': 'IT-Nina'}           # kunder (efter mappenummer), der hedder noget andet i spillet
SKALA = 0.55                      # atlasset gemmes i 55 % af kildens opløsning
KOL = 5                           # 5 x 4 frames i atlasset


def rgba(sti):
    return np.array(Image.open(sti).convert('RGBA'))


def komponenter(maske):
    """Sammenhængende områder i en bool-maske: liste af (ys, xs)."""
    set_ = np.zeros(maske.shape, bool)
    ud = []
    H, W = maske.shape
    for y0, x0 in zip(*np.nonzero(maske)):
        if set_[y0, x0]:
            continue
        q = deque([(y0, x0)]); set_[y0, x0] = True; ys, xs = [], []
        while q:
            y, x = q.popleft(); ys.append(y); xs.append(x)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and maske[ny, nx] and not set_[ny, nx]:
                    set_[ny, nx] = True; q.append((ny, nx))
        ud.append((np.array(ys), np.array(xs)))
    return ud


def udvid(maske, r):
    ud = maske.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx <= r * r:
                ud |= np.roll(np.roll(maske, dy, 0), dx, 1)
    return ud


def hudfarver(krop, haender):
    """Farver i hænderne, som også findes rigeligt i ansigtet — det er huden."""
    def taelling(a):
        m = a[..., 3] > 200
        return Counter(map(tuple, a[m][:, :3]))
    fk, fh = taelling(krop), taelling(haender)
    hud = [np.array(c, int) for c, n in fh.most_common(30)
           if sum(int(v) for v in c) > 90 and fk.get(c, 0) > 15 and n > 25
           # Hud har farve; grå toner er klingen eller pistolen.
           and max(int(v) for v in c) - min(int(v) for v in c) > 28]
    return hud


def hudmaske(a, hud, tol=34):
    rgb = a[..., :3].astype(int)
    m = np.zeros(a.shape[:2], bool)
    for c in hud:
        m |= (np.abs(rgb - c).sum(-1) < tol)
    return m & (a[..., 3] > 120)


def main():
    os.makedirs(UD, exist_ok=True)
    mapper = sorted(d for d in os.listdir(KILDE) if d[:2].isdigit() and os.path.isdir(os.path.join(KILDE, d)))

    # 1. Fælles udsnit over alle kunders kropsframes.
    x0 = y0 = 10 ** 9; x1 = y1 = -1
    for d in mapper:
        for f in FRAMES:
            a = rgba(os.path.join(KILDE, d, 'No hands', f + '.png'))
            ys, xs = np.nonzero(a[..., 3] > 0)
            x0, x1 = min(x0, xs.min()), max(x1, xs.max())
            y0, y1 = min(y0, ys.min()), max(y1, ys.max())
    # Plads til hænderne uden for kroppen.
    x0, y0, x1, y1 = max(0, x0 - 40), max(0, y0 - 20), min(511, x1 + 40), min(511, y1 + 6)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    cw, ch = round(bw * SKALA), round(bh * SKALA)
    print('udsnit', (x0, y0, x1, y1), '->', (cw, ch))

    rig = {'celle': [cw, ch], 'kol': KOL, 'frames': FRAMES, 'skala': SKALA, 'kunder': []}
    for d in mapper:
        navn = OMDOEB.get(d[:2], d.split('_', 1)[1])
        atlas = Image.new('RGBA', (cw * KOL, ch * ((len(FRAMES) + KOL - 1) // KOL)), (0, 0, 0, 0))
        krop0 = rgba(os.path.join(KILDE, d, 'No hands', 'idle_0.png'))
        haand0 = rgba(os.path.join(KILDE, d, 'Only hands', 'idle_0.png'))
        hud = hudfarver(krop0, haand0)

        haender = []
        for i, f in enumerate(FRAMES):
            k = Image.open(os.path.join(KILDE, d, 'No hands', f + '.png')).convert('RGBA').crop((x0, y0, x1 + 1, y1 + 1))
            k = k.resize((cw, ch), Image.LANCZOS)
            atlas.paste(k, ((i % KOL) * cw, (i // KOL) * ch))
            h = rgba(os.path.join(KILDE, d, 'Only hands', f + '.png'))
            komp = sorted((c for c in komponenter(hudmaske(h, hud)) if len(c[0]) > 120),
                          key=lambda c: -len(c[0]))[:2]
            pos = [[round((c[1].mean() - x0) * SKALA, 1), round((c[0].mean() - y0) * SKALA, 1)] for c in komp]
            while len(pos) < 2:
                pos.append(pos[-1] if pos else [cw * 0.5, ch * 0.7])
            pos.sort(key=lambda p: p[0])            # bag (venstre) først, så forreste
            haender.append(pos)
        atlas.save(os.path.join(UD, f'{d[:2]}.webp'), quality=90, method=6)

        # 2. Den rene knytnæve: hånden med mindst våben omkring sig.
        maske = hudmaske(haand0, hud)
        vaaben = (haand0[..., 3] > 120) & ~udvid(maske, 2) & (haand0[..., :3].sum(-1) > 60)
        bedst = None
        for ys, xs in komponenter(maske):
            if len(ys) < 150:
                continue
            m = np.zeros(maske.shape, bool); m[ys, xs] = True
            omraade = udvid(m, 6)
            snavs = int((omraade & vaaben).sum())
            if bedst is None or snavs < bedst[0]:
                bedst = (snavs, m)
        m = udvid(bedst[1], 4) & (haand0[..., 3] > 0) & ~vaaben
        ys, xs = np.nonzero(m)
        hx0, hx1, hy0, hy1 = xs.min(), xs.max(), ys.min(), ys.max()
        naeve = haand0.copy(); naeve[~m] = 0
        ni = Image.fromarray(naeve[hy0:hy1 + 1, hx0:hx1 + 1])
        ni = ni.resize((max(1, round(ni.width * SKALA)), max(1, round(ni.height * SKALA))), Image.LANCZOS)
        ni.save(os.path.join(UD, f'{d[:2]}_haand.webp'), quality=92, method=6)

        # Fodpunkt og midte fra tomgangen.
        ys, xs = np.nonzero(krop0[..., 3] > 0)
        rig['kunder'].append({
            'nr': d[:2], 'navn': navn,
            'fod': [round((xs.mean() - x0) * SKALA, 1), round((ys.max() - y0) * SKALA, 1)],
            'top': round((ys.min() - y0) * SKALA, 1),
            'haand': [ni.width, ni.height],
            'haender': haender,
            'hud': '#%02X%02X%02X' % tuple(hud[0]) if hud else '#FFC49A',
        })
        print(f'{d:22s} hud {len(hud)} toner, næve {ni.width}x{ni.height}, '
              f'atlas {os.path.getsize(os.path.join(UD, d[:2] + ".webp")) // 1024} KB')

    with open(UD_JS, 'w') as f:
        f.write('/* Genereret af vaerktoej/tegneseriekunder.py — ret ikke i hånden.\n'
                ' * Pr. kunde: fodpunkt og hårtop (px i atlassets celle), knytnævens\n'
                ' * størrelse og de to hænders midte i hver af de 20 frames. */\n')
        f.write('export const TEGNESERIE_RIG = ' + json.dumps(rig, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('skrev', UD_JS)


if __name__ == '__main__':
    main()
