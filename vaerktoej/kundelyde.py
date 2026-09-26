"""Kundekrigen — klip og optimer kundernes stemmer.

Kilden er brugerens egne optagelser i Assets/Kundelyde (AIFC, 24 kHz mono).
For hver fil:
  1. Find selve lyden ud fra energien i 10 ms-vinduer. Korte klik (under
     60 ms) før og efter tæller ikke med, så de klippes væk.
  2. Pauser inde i lyden på over 0,9 s kortes ned til 0,4 s.
  3. Højpas ved 70 Hz (rumlen), lydstyrken normaliseres (EBU R128, -16 LUFS,
     top -1,5 dB), og kanterne tones blødt ind og ud.
  4. Gemmes som Ogg Vorbis i static/lyd/stemme_<navn>.ogg.

Kør:  python3 vaerktoej/kundelyde.py [mappe med .aifc]
"""
import array, math, os, subprocess, sys, tempfile, unicodedata

HER = os.path.dirname(os.path.abspath(__file__))
ROD = os.path.dirname(HER)
KILDE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROD, '..', 'Assets', 'Kundelyde')
UD = os.path.join(ROD, 'static', 'lyd')
RATE = 24000
VIN = RATE // 100                     # 10 ms
TAERSKEL_DB = -42
MIN_LYD = 6                           # vinduer (60 ms) før noget tæller som lyd
FOR, EFTER = 0.06, 0.14               # luft før og efter, sekunder
LANG_PAUSE, NY_PAUSE = 0.9, 0.4


def navn(fil):
    n = os.path.splitext(os.path.basename(fil))[0].lower()
    n = n.replace('æ', 'ae').replace('ø', 'oe').replace('å', 'aa')
    n = unicodedata.normalize('NFKD', n).encode('ascii', 'ignore').decode()
    return 'stemme_' + '_'.join(n.split())


def laes(fil):
    raa = subprocess.run(['ffmpeg', '-v', 'error', '-i', fil, '-f', 'f32le', '-ac', '1', '-ar', str(RATE), '-'],
                         capture_output=True, check=True).stdout
    return array.array('f', raa)


def aktive_stykker(x):
    """Stykker (start, slut) i samples, hvor der er lyd."""
    db = []
    for i in range(0, len(x), VIN):
        v = x[i:i + VIN]
        rms = math.sqrt(sum(s * s for s in v) / max(1, len(v)))
        db.append(20 * math.log10(rms + 1e-9))
    stykker, i = [], 0
    while i < len(db):
        if db[i] > TAERSKEL_DB:
            j = i
            while j < len(db) and db[j] > TAERSKEL_DB - 6:   # hysterese
                j += 1
            if j - i >= MIN_LYD:
                stykker.append((i * VIN, j * VIN))
            i = j
        else:
            i += 1
    # Slå stykker sammen, der kun er adskilt af korte pauser.
    samlet = []
    for s in stykker:
        if samlet and s[0] - samlet[-1][1] < LANG_PAUSE * RATE:
            samlet[-1] = (samlet[-1][0], s[1])
        else:
            samlet.append(s)
    return samlet


def klip(x, stykker):
    ud = array.array('f')
    pause = array.array('f', [0.0] * int(NY_PAUSE * RATE))
    for k, (a, b) in enumerate(stykker):
        a = max(0, a - int(FOR * RATE)) if k == 0 else a
        b = min(len(x), b + int(EFTER * RATE)) if k == len(stykker) - 1 else b
        if k:
            ud.extend(pause)
        ud.extend(x[a:b])
    return ud


def main():
    filer = sorted(f for f in os.listdir(KILDE) if f.lower().endswith(('.aifc', '.aiff', '.wav')))
    for f in filer:
        x = laes(os.path.join(KILDE, f))
        st = aktive_stykker(x)
        if not st:
            print('  (tom)', f); continue
        y = klip(x, st)
        varighed = len(y) / RATE
        with tempfile.NamedTemporaryFile(suffix='.raw', delete=False) as t:
            t.write(y.tobytes()); tmp = t.name
        ud = os.path.join(UD, navn(f) + '.ogg')
        ind_tone, ud_tone = 0.012, 0.06
        filtre = (f'highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11,aresample={RATE},'
                  f'afade=t=in:st=0:d={ind_tone},afade=t=out:st={max(0, varighed - ud_tone):.3f}:d={ud_tone}')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', tmp,
                        '-af', filtre, '-c:a', 'libvorbis', '-q:a', '4', ud], check=True)
        os.unlink(tmp)
        print(f'{f:32s} {len(x) / RATE:5.2f} s -> {varighed:5.2f} s  {len(st)} stykke(r)  '
              f'{os.path.getsize(ud) // 1024:4d} KB  {os.path.basename(ud)}')


if __name__ == '__main__':
    main()
