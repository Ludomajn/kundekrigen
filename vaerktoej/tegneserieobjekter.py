"""Kundekrigen — genstandene som tegneseriemodeller til spillet.

Kilden er Assets/Cartoon Characters/Kundekrigen objekter (tegnet af
_vaerktoej/objekter.py i figurernes stil): pr. model 20 frames à 256x256 i
samme fordeling som figurerne —

    idle_0-3 · aktiv_0-3 · fald_0-1 · land_0-2 · udloes_0-2 · doed_0-3

— og eksplosionen som én serie på 20 frames (eks_00-19).

Værktøjet skalerer frames ned og pakker hver model i ét WebP-atlas (5 x 4
celler) og skriver fodpunkt og tegningens udstrækning (fra tomgangen), så
spillet kan give modellen en bredde i wu og stille den på jorden.

Ud:  static/grafik/objekter/<navn>.webp
     static/js/render/objekt_rig.js   (genereret — ret ikke i hånden)

Kræver Pillow og NumPy:  python3 vaerktoej/tegneserieobjekter.py [kildemappe]
"""
import json, os, sys

import numpy as np
from PIL import Image

HER = os.path.dirname(os.path.abspath(__file__))
ROD = os.path.dirname(HER)
KILDE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROD, '..', 'Assets', 'Cartoon Characters',
                                                            'Kundekrigen objekter')
UD = os.path.join(ROD, 'static', 'grafik', 'objekter')
UD_JS = os.path.join(ROD, 'static', 'js', 'render', 'objekt_rig.js')

FRAMES = ([f'idle_{i}' for i in range(4)] + [f'aktiv_{i}' for i in range(4)] + [f'fald_{i}' for i in range(2)]
          + [f'land_{i}' for i in range(3)] + [f'udloes_{i}' for i in range(3)] + [f'doed_{i}' for i in range(4)])
EKS = [f'eks_{i:02d}' for i in range(20)]
CELLE = 128          # 50 % af kildens 256
KOL = 5
FOD = 236 * CELLE / 256


def main():
    os.makedirs(UD, exist_ok=True)
    rig = {'celle': CELLE, 'kol': KOL, 'frames': FRAMES, 'eksFrames': EKS, 'fod': FOD, 'modeller': {}}
    for navn in sorted(os.listdir(KILDE)):
        d = os.path.join(KILDE, navn)
        if navn.startswith(('_', '.')) or not os.path.isdir(d):
            continue
        frames = EKS if navn == 'eksplosion' else FRAMES
        atlas = Image.new('RGBA', (CELLE * KOL, CELLE * ((len(frames) + KOL - 1) // KOL)), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            im = Image.open(os.path.join(d, f + '.png')).convert('RGBA').resize((CELLE, CELLE), Image.LANCZOS)
            atlas.paste(im, ((i % KOL) * CELLE, (i // KOL) * CELLE))
        atlas.save(os.path.join(UD, f'{navn}.webp'), quality=90, method=6)
        # Tegningens udstrækning i tomgangen (i cellens pixels).
        ref = np.array(Image.open(os.path.join(d, frames[0 if navn != 'eksplosion' else 10] + '.png'))
                       .convert('RGBA').resize((CELLE, CELLE), Image.LANCZOS))
        ys, xs = np.nonzero(ref[..., 3] > 40)
        rig['modeller'][navn] = {'indhold': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]}
        print(f'{navn:18s} atlas {os.path.getsize(os.path.join(UD, navn + ".webp")) // 1024} KB',
              rig['modeller'][navn]['indhold'])
    with open(UD_JS, 'w') as f:
        f.write('/* Genereret af vaerktoej/tegneserieobjekter.py — ret ikke i hånden.\n'
                ' * Pr. model: tegningens udstrækning i tomgangen (px i atlassets celle).\n'
                ' * Fodpunktet (jordlinjen) er celleFod px nede, midt i cellen. */\n')
        f.write('export const OBJEKT_RIG = ' + json.dumps(rig, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('skrev', UD_JS)


if __name__ == '__main__':
    main()
