"""Kundekrigen — kontorlyde fra "400 Sounds Pack" (Assets/).

Erstatter de 8-bit-agtige retroeffekter (sfx_*.ogg) med foley og rolige
UI-lyde, der passer til et kontor. Hver begivenhed får flere variationer, så
det samme klik ikke lyder hver gang: static/lyd/k_<gruppe>_<n>.ogg.

For hver kildefil:
  1. Stereo -> mono. Er de to kanaler næsten ens (korrelation >= 0,5), tages
     gennemsnittet; ellers bruges kun venstre kanal. De brede synth-lyde har en
     ping-pong-ekko (højre = venstre forsinket 15-42 ms), som ellers ville give
     dobbeltanslag og kamfilter i mono.
  2. Højpas ved 30 Hz (rumlen under det hørbare; 80 Hz for whoosh-lydene og swipe;
     i whoosh_1 æder infralyd ellers 11 dB af toppen). Toppen normaliseres til
     -3 dB, og stilhed klippes væk i begge ender (samme silenceremove-kæde som
     lydpakker.py).
  3. Evt. startpunkt: et fast tal fundet ved analysen, eller 'auto' = et
     vindue, der starter et roligt sted og helst slutter, hvor lyden er faldet
     mindst 12 dB (så udtoningen ikke skærer midt i det kraftigste).
  4. Stille for-støj før anslaget skæres væk (under top - 40 dB; for tik og
     klik top - 30 dB), så lyden sidder præcist på begivenheden.
  5. Længere end gruppens maks.? Så skæres der, og der tones ud over 60 ms.
     Ellers en kort udtoning på 20 ms, så intet klikker til sidst.
  6. Toppen normaliseres igen til -3 dB.

Pr. gruppe:
  7. Styrken måles som K-vægtet RMS af det kraftigste 100 ms-vindue. Variationer
     i samme gruppe gøres lige kraftige (de kraftigste dæmpes ned til den
     svageste), så et tilfældigt valg ikke springer i styrke. En variation, der
     er så svag, at gruppen ellers ville ligge mere end 3 dB under sit mål,
     droppes.
  8. Forslag til afspilningsstyrke = mål / styrke, holdt inden for 0,3-1,0. Ville
     gruppen skulle under 0,3, bages resten af dæmpningen ind i filerne.
  9. Gemmes som Ogg Vorbis (mono, 44,1 kHz, q5). Vorbis kan skyde toppen op til
     3 dB over på klippede anslag; så dæmpes der og kodes igen.

To grupper bygges særskilt:
  bor    - en sømløs løkke af barbermaskinens jævne midterstykke. Løkkelængden
           vælges, så stykket efter slutningen ligner starten mest, og enderne
           krydstones. Ingen udtoning; skal afspilles med Web Audio loop = true.
  oplad  - hydraulikkens stigende stykke, sænket 0,6x som et båndtempo (ingen
           artefakter), så det bliver ~0,7 s som den gamle sfx_oplad. Stigningen
           i styrke og lyshed måles og skrives ud.

Kør:  python3 vaerktoej/kontorlyde.py [mappe med 400 Sounds Pack]
"""
import array, cmath, math, os, subprocess, sys

HER = os.path.dirname(os.path.abspath(__file__))
ROD = os.path.dirname(HER)
PAKKE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROD, '..', 'Assets', '400 Sounds Pack')
UD = os.path.join(ROD, 'static', 'lyd')
SR = 44100
TOP_DB = -3.0

KLIP = ('silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01,'
        'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse')
KVAEGT = 'highpass=f=60,highshelf=f=1500:g=4'     # ~K-vægtning (EBU R128) til styrkemålingen

# Mål for styrken ved afspilningsstyrke 1,0 (dB, K-vægtet, kraftigste 100 ms).
# Løkker og lyde, der gentages tit, ligger lavest; slag højest.
MAAL = {'svag': -26, 'let': -23, 'signal': -21, 'begivenhed': -19, 'slag': -16}

# (gruppe, maks. sekunder, slags, kilder). En kilde er 'Mappe/fil' eller
# ('Mappe/fil', {indstillinger}). Indstillinger:
#   start  - sekunder efter stilheden er klippet, eller 'auto'
#   stram  - tærskel under toppen for for-støjen (standard 40 dB)
#   ud     - udtoning i sekunder, når der skæres (standard 0,06)
#   hp     - højpas i Hz (standard 30)
AUTO = {'start': 'auto'}
TIK = {'stram': 30}
SUS = {'hp': 80}
GRUPPER = [
    # Bevægelse
    ('fodtrin', 0.35, 'svag', [f'Footsteps/foley_footstep_carpet_{i}' for i in range(1, 5)]),
    ('hop', 0.5, 'let', [('Materials/clothing_1', AUTO), ('Materials/clothing_2', AUTO)]),
    ('salto', 0.7, 'let', [('Other/whoosh_1', SUS), ('Other/whoosh_2', SUS)]),
    ('kast', 0.5, 'let', [('Combat and Gore/swipe', SUS), ('Other/whoosh_2', SUS)]),
    ('landing', 0.4, 'let', ['Materials/clothing_thud']),
    ('tungt_fald', 0.6, 'slag', ['Weapons/harsh_thud']),
    ('vaabenskift', 0.6, 'let', ['Weapons/weapon_equip_short', 'Items/item_equip', 'Weapons/weapon_equip']),
    # Våben og deres nedslag
    ('papir_kast', 0.6, 'let', ['Materials/paper_scrunch']),
    ('papir_land', 0.6, 'let', [('Materials/cardboard_drop', AUTO), 'Materials/paper_move']),
    ('metal', 0.8, 'slag', ['Materials/metal_clang', 'Materials/metal_blunt_tap']),
    ('skum', 0.9, 'signal', ['Other/paste', 'Environment/air_burst']),
    ('mine_laeg', 0.3, 'let', ['UI/pop_2']),
    # Valgt: klar sinustone ved 1,4 kHz, anslag 17 ms, naturligt henfald inden 0,25 s.
    # (select_4 er en firkantbølge = chiptune, synth_warning er 0,9 s og langsom.)
    ('mine_bip', 0.25, 'svag', [('UI/sci_fi_hover_high', TIK)]),
    # Valgt: to toner (525 -> 262 Hz), anslag 21 ms; samme sci-fi-familie som bippet.
    ('mine_armeret', 0.7, 'signal', ['UI/sci_fi_confirm']),
    # Opdateringen bruger hele synth-familien (skud, ramt, færdig).
    ('opdatering_skud', 0.6, 'signal', ['UI/synth_confirmation']),
    ('opdatering_ramt', 1.2, 'signal', ['UI/synth_shut_down']),            # lysheden falder 1,8 -> 1,0 kHz
    ('opdatering_faerdig', 1.0, 'signal', ['UI/synth_process_complete']),  # lysheden stiger 1,6 -> 2,3 kHz
    ('bor', 2.0, 'svag', None),                                            # løkke, se byg_bor
    ('skjold_op', 0.9, 'let', ['Environment/door_close', 'Environment/lock_lock']),
    ('skjold_blok', 0.8, 'signal', ['Materials/glass_ping_big', 'Materials/glass_ping_small']),
    ('skjold_slut', 0.9, 'let', ['Environment/door_open']),
    ('teleport', 0.8, 'signal', ['UI/sci_fi_select_big']),
    ('teleport_afvist', 0.6, 'signal', ['UI/sci_fi_disallow']),
    ('kasse_samlet', 0.6, 'let', [('Materials/cardboard_pick_up', AUTO), ('Materials/cardboard_box_close', AUTO)]),
    ('vaaben_samlet', 0.9, 'let', ['Weapons/weapon_pick_up', 'Weapons/weapon_upgrade']),
    ('kasse_falder', 0.8, 'let', ['Items/map_open']),
    ('piller', 0.7, 'let', ['Materials/ceramic_jar_open']),
    ('skade', 0.4, 'slag', ['Combat and Gore/punch', 'Combat and Gore/punch_2', 'Combat and Gore/punch_3']),
    ('klask_ramt', 0.5, 'slag', ['Combat and Gore/slap']),
    ('covid_host', 1.2, 'signal', ['Human/cough_short', 'Human/cough_double']),
    ('covid_sky', 0.9, 'signal', ['Environment/air_burst']),
    ('plask', 1.2, 'signal', ['Environment/water_splashing']),
    # Valgt: tæt, lav summen (165 Hz), fuld styrke i 0,5 s og så faldende.
    # (synth_error deler for-anslaget med opdateringens synth-lyde.)
    ('sort_hul', 1.0, 'begivenhed', ['UI/sci_fi_error']),
    # select_1 (firkant) og select_2 (trekant) er chiptune-blip -> droppet;
    # i stedet søsteren click_double_on_2.
    ('klik', 0.25, 'svag', [('UI/click_double_on', TIK), ('UI/click_double_on_2', TIK)]),
    ('tael', 0.12, 'svag', [('UI/pop_1', TIK), ('UI/pop_3', TIK), ('UI/pop_4', TIK)]),
    ('oplad', 1.5, 'let', None),                                           # stigende, se byg_oplad
    # Valgt: tonal "vup" (grundtone 73 Hz, lyshed 0,8 kHz), top inden 0,1 s.
    # (glass_ping_small bruges allerede i skjold_blok.)
    ('fuld_kraft', 0.4, 'signal', ['UI/sci_fi_select']),
    # Intro og slutning
    ('intro_slam', 0.6, 'slag', ['Weapons/harsh_thud']),
    ('nedtael', 0.3, 'let', [('Environment/clock_tick_only', TIK), ('Environment/clock_tock_only', TIK)]),
    # Andet, lange fløjt (0,66-1,43 s); det første korte pust springes over.
    ('kamp_start', 1.0, 'begivenhed', [('Human/whistle', {'start': 0.62})]),
    # Valgt: klapsalve fra starten (bygger op på 0,4 s), 0,5 s udtoning.
    # (brass_level_complete har 0,25 s digital stilhed midt i og slutakkorden
    # skæres af filens ende.)
    ('du_vandt', 3.0, 'begivenhed', [('Other/applause', {'ud': 0.5})]),
    # Valgt: hele "wah"-tonen på 0,81 s. (brass_defeated er 3,1 s; ved 2,0 s ville
    # sidste tone i melodien blive skåret af.)
    ('tabt', 2.0, 'begivenhed', ['Musical Effects/brass_negative_long']),
    ('faktura', 0.8, 'let', ['Materials/paper_sort', ('Materials/paper_tear_1', AUTO),
                             ('Materials/paper_tear_2', AUTO)]),
    # Seks hele tasteanslag med ~80 ms mellemrum (0,46-0,88 s); næste anslag er først ved 0,98 s.
    # Kort udtoning (30 ms), så den sjette tast ikke tones væk.
    ('inferno_delt', 0.5, 'let', [('Other/keyboard_typing', {'start': 0.44, 'ud': 0.03})]),
]
OPLAD = ('Machines/hydraulic_up', 0.20, 0.62, 0.6)          # kilde, fra, til, båndtempo
BOR = ('Machines/razor_buzz', 0.165, 1.000, 1.014, 0.05)    # kilde, start, min./maks. længde, krydstoning


# ---------- lyd ind og ud ----------

def ffmpeg_ind(fil, filtre=None, kanaler=1):
    cmd = ['ffmpeg', '-v', 'error', '-i', fil]
    if filtre:
        cmd += ['-af', filtre]
    cmd += ['-f', 'f32le', '-ac', str(kanaler), '-ar', str(SR), '-']
    return array.array('f', subprocess.run(cmd, capture_output=True, check=True).stdout)


def ffmpeg_ror(x, filtre, rate_ind=SR):
    """Send rå mono gennem et ffmpeg-filter og få resultatet tilbage."""
    ud = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(rate_ind), '-ac', '1', '-i', '-',
                         '-af', filtre, '-f', 'f32le', '-ar', str(SR), '-'],
                        input=array.array('f', x).tobytes(), capture_output=True, check=True).stdout
    return array.array('f', ud)


def gem_ogg(x, ud):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                    '-c:a', 'libvorbis', '-q:a', '5', ud], input=array.array('f', x).tobytes(), check=True)


def db(v):
    return 20 * math.log10(v) if v > 1e-10 else -200.0


def top(x):
    return max((abs(v) for v in x), default=0.0)


def rms(x):
    return math.sqrt(sum(v * v for v in x) / len(x)) if len(x) else 0.0


def skaler(x, gain_db):
    g = 10 ** (gain_db / 20)
    return [v * g for v in x]


def styrke(x):
    """K-vægtet RMS af det kraftigste 100 ms-vindue (trin 10 ms)."""
    k = ffmpeg_ror(x, KVAEGT)
    b = SR // 10
    return max(db(rms(k[i:i + b])) for i in range(0, max(1, len(k) - b + 1), SR // 100))


# ---------- trinene for én fil ----------

def forbered(rel, hp):
    """Nedmiks, højpas, top -3 dB og stilhed klippet væk. Giver (lyd, korrelation)."""
    fil = os.path.join(PAKKE, rel + '.wav')
    if not os.path.exists(fil):
        raise FileNotFoundError(fil)
    st = ffmpeg_ind(fil, kanaler=2)
    L, R = st[0::2], st[1::2]
    sl, sr_, slr = sum(v * v for v in L), sum(v * v for v in R), sum(a * b for a, b in zip(L, R))
    korr = slr / math.sqrt(sl * sr_) if sl and sr_ else 1.0
    pan = 'pan=mono|c0=0.5*c0+0.5*c1' if korr >= 0.5 else 'pan=mono|c0=c0'
    filtre = f'{pan},highpass=f={hp}'
    gain = TOP_DB - db(top(ffmpeg_ind(fil, filtre)))
    return list(ffmpeg_ind(fil, f'{filtre},volume={gain:.2f}dB,{KLIP}')), korr


def auto_start(x, n_maks, ud_s):
    """Vælg vinduet: start i et roligt 10 ms-sted (lokalt minimum), og helst så
    udtoningen falder mindst 12 dB under det kraftigste 50 ms. Blandt dem tages
    det tidligste med >= 95 % af den største energi."""
    b = SR // 100
    e = [sum(v * v for v in x[i:i + b]) for i in range(0, len(x), b)]
    nb, nu = max(1, n_maks // b), max(1, int(ud_s * SR) // b)
    kum = [0.0]
    for v in e:
        kum.append(kum[-1] + v)
    maks50 = max((kum[i + 5] - kum[i]) / 5 for i in range(0, max(1, len(e) - 4)))
    kand = [s for s in range(0, len(e) - nb + 1)
            if s == 0 or (e[s] <= e[s - 1] and (s + 1 >= len(e) or e[s] <= e[s + 1]))]
    rolig = [s for s in kand if (kum[s + nb] - kum[s + nb - nu]) / nu <= maks50 * 10 ** (-12 / 10)]
    pulje = rolig or kand
    energi = {s: kum[s + nb] - kum[s] for s in pulje}
    bedst = max(energi.values())
    return min(s for s in pulje if energi[s] >= 0.95 * bedst) * b


def stram_start(x, under_top):
    """Skær stille for-støj væk: start 5 ms (tik: 2 ms) før første ms over top - N dB."""
    graense = top(x) * 10 ** (-under_top / 20)
    b = SR // 1000
    for i in range(0, len(x), b):
        if top(x[i:i + b]) >= graense:
            return max(0, i - (2 if under_top <= 30 else 5) * b)
    return 0


def ton(x, ind_s=0.0, ud_s=0.0):
    """Blød ind- og udtoning (cosinusformet)."""
    x = list(x)
    n_ind, n_ud = min(len(x), int(ind_s * SR)), min(len(x), int(ud_s * SR))
    for i in range(n_ind):
        x[i] *= 0.5 - 0.5 * math.cos(math.pi * i / n_ind)
    for i in range(n_ud):
        x[len(x) - n_ud + i] *= 0.5 + 0.5 * math.cos(math.pi * (i + 1) / n_ud)
    return x


def normaliser(x):
    return skaler(x, TOP_DB - db(top(x)))


def byg_en(rel, maks, indst):
    x, korr = forbered(rel, indst.get('hp', 30))
    noter = []
    if korr < 0.5:
        noter.append(f'venstre kanal (korr. {korr:.2f})')
    if indst.get('hp', 30) != 30:
        noter.append(f'højpas {indst["hp"]} Hz')
    n_maks = int(maks * SR)
    start = indst.get('start', 0)
    if start == 'auto':
        s = auto_start(x, n_maks, indst.get('ud', 0.06)) if len(x) > n_maks else 0
    else:
        s = int(start * SR)
    s += stram_start(x[s:], indst.get('stram', 40))
    if s >= SR // 200:
        noter.append(f'start {s / SR:.2f} s')
    x = x[s:]
    skaaret = len(x) > n_maks
    ud = indst.get('ud', 0.06)
    if skaaret:
        x = x[:n_maks]
        # Hvor kraftigt er der, hvor der tones ud? (i forhold til det kraftigste 50 ms)
        h = SR // 20
        maks50 = max(rms(x[i:i + h]) for i in range(0, max(1, len(x) - h + 1), SR // 100))
        rest = db(rms(x[-int(ud * SR):]) / maks50) if maks50 else -200
        noter.append(f'skåret til {maks:.2f} s (udtoning ved {rest:.0f} dB)')
    x = ton(x, 0.003 if s else 0.0, ud if skaaret else 0.02)
    return normaliser(x), noter


def byg_oplad():
    rel, fra, til, tempo = OPLAD
    x, _ = forbered(rel, 30)
    # Båndtempo: afspil ved tempo*44,1 kHz og resampl tilbage -> længere og dybere.
    y = ffmpeg_ror(x[int(fra * SR):int(til * SR)], f'aresample={SR}', rate_ind=round(SR * tempo))
    return [(rel, normaliser(ton(y, 0.01, 0.06)), [f'{fra:.2f}-{til:.2f} s af kilden, båndtempo {tempo}x'])]


def byg_bor():
    rel, a_s, lmin, lmax, kf_s = BOR
    x, _ = forbered(rel, 30)
    a, F = int(a_s * SR), int(kf_s * SR)
    ref = x[a:a + F]
    er = math.sqrt(sum(v * v for v in ref))
    # Løkkelængden L vælges, så stykket efter slutningen ligner starten mest (samme fase).
    bedst = (-2.0, 0)
    for L in range(int(lmin * SR), int(lmax * SR) + 1):
        seg = x[a + L:a + L + F]
        k = sum(p * q for p, q in zip(ref, seg)) / (er * math.sqrt(sum(q * q for q in seg)) + 1e-12)
        if k > bedst[0]:
            bedst = (k, L)
    korr, L = bedst
    y = list(x[a:a + L])
    for i in range(F):
        w = i / F
        if korr < 0.5:          # ukorreleret (mest støj): lige effekt
            ind, ud = math.sin(w * math.pi / 2), math.cos(w * math.pi / 2)
        else:                   # i fase: lige forstærkning
            ind, ud = w, 1 - w
        y[i] = x[a + i] * ind + x[a + L + i] * ud
    # Sømmen: forskellen mellem sidste og første sample i forhold til det typiske spring.
    spring = sorted(abs(y[i + 1] - y[i]) for i in range(len(y) - 1))[len(y) // 2]
    return [(rel, normaliser(y), [f'løkke {a / SR:.3f}-{(a + L) / SR:.3f} s af kilden = {L} samples '
                                  f'({L / SR:.3f} s), krydstoning {kf_s * 1000:.0f} ms '
                                  f'(fasekorr. {korr:.2f} -> lige effekt), spring i sømmen '
                                  f'{abs(y[0] - y[-1]) / spring:.1f}x median'])]


# ---------- målinger ----------

def fft(v):
    n = len(v)
    if n == 1:
        return v
    lige, ulige = fft(v[0::2]), fft(v[1::2])
    t = [cmath.exp(-2j * math.pi * k / n) * ulige[k] for k in range(n // 2)]
    return [lige[k] + t[k] for k in range(n // 2)] + [lige[k] - t[k] for k in range(n // 2)]


HANN = [0.5 - 0.5 * math.cos(2 * math.pi * i / 2047) for i in range(2048)]


def lyshed(seg):
    """Spektralt tyngdepunkt (Hz) af 2048 samples."""
    seg = list(seg) + [0.0] * (2048 - len(seg))
    mag = [abs(v) for v in fft([s * h for s, h in zip(seg, HANN)])[:1024]]
    tot = sum(mag)
    return sum(m * k * SR / 2048 for k, m in enumerate(mag)) / tot if tot else 0.0


def tendens(x, v=0.05):
    """Styrke (dB) og lyshed (Hz) pr. 50 ms: hældning og snit af første/sidste tredjedel."""
    h = int(v * SR)
    t, s, c = [], [], []
    for i in range(0, len(x) - h, h):
        t.append(i / SR)
        s.append(db(rms(x[i:i + h])))
        c.append(lyshed(x[i:i + 2048]))

    def haeld(y):
        mt, my = sum(t) / len(t), sum(y) / len(y)
        return sum((a - mt) * (b - my) for a, b in zip(t, y)) / sum((a - mt) ** 2 for a in t)
    n = max(1, len(t) // 3)
    return haeld(s), haeld(c), sum(s[:n]) / n, sum(s[-n:]) / n, sum(c[:n]) / n, sum(c[-n:]) / n


def gem_og_tjek(x, ud):
    """Gem som Ogg; skyder Vorbis toppen over, dæmpes der og kodes igen."""
    mål_top = min(TOP_DB, db(top(x)))
    for _ in range(4):
        gem_ogg(x, ud)
        y = ffmpeg_ind(ud)
        over = db(top(y)) - mål_top
        if over <= 0.5:
            break
        x = skaler(x, -over)
    i_top = max(range(len(y)), key=lambda i: abs(y[i]))
    # Længden tages fra containeren (granule-positionen); ffmpegs egen afkoder
    # runder somme tider til hele Vorbis-blokke.
    s = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ud],
                             capture_output=True, text=True).stdout)
    return y, {'s': s, 'top': db(top(y)), 'rms': db(rms(y)), 'anslag': i_top / SR * 1000,
               'kb': os.path.getsize(ud) / 1024}


def main():
    os.makedirs(UD, exist_ok=True)
    total, antal, forslag = 0.0, 0, []
    for gruppe, maks, slags, kilder in GRUPPER:
        if gruppe == 'bor':
            bygget = byg_bor()
        elif gruppe == 'oplad':
            bygget = byg_oplad()
        else:
            bygget = []
            for k in kilder:
                rel, indst = (k, {}) if isinstance(k, str) else k
                bygget.append((rel, *byg_en(rel, maks, indst)))
        maal = MAAL[slags]
        st = [styrke(x) for _, x, _ in bygget]
        # Drop variationer, der ville trække gruppen mere end 3 dB under målet.
        while len(bygget) > 1 and min(st) < maal - 3:
            i = st.index(min(st))
            print(f"  (droppet {bygget[i][0]}: styrke {st[i]:.1f} dB, {max(st) - st[i]:.0f} dB svagere "
                  f"end gruppens kraftigste)")
            del bygget[i], st[i]
        faelles = min(st)
        vol = min(1.0, 10 ** ((maal - faelles) / 20))
        bag = db(vol / 0.3) if vol < 0.3 else 0.0       # dæmpning, der bages ind i filerne
        vol = max(vol, 0.3)
        for n, ((rel, x, noter), s) in enumerate(zip(bygget, st), 1):
            d = faelles - s + bag
            if d < -0.05:
                noter.append(f'dæmpet {d:.1f} dB')
            navn = f'k_{gruppe}_{n}'
            y, m = gem_og_tjek(skaler(x, d), os.path.join(UD, navn + '.ogg'))
            if gruppe == 'bor':
                noter.append(f'afkodet {len(y)} af {len(x)} samples; rms første/sidste 100 ms '
                             f'{db(rms(y[:4410])):.1f}/{db(rms(y[-4410:])):.1f} dB')
            if gruppe == 'oplad':
                hs, hc, s0, s1, c0, c1 = tendens(y)
                noter.append(f'tendens: styrke {s0:.1f} -> {s1:.1f} dB ({hs:+.1f} dB/s), '
                             f'lyshed {c0:.0f} -> {c1:.0f} Hz ({hc:+.0f} Hz/s)')
            total += m['kb']
            antal += 1
            print(f"{navn:22s} {m['s']:5.2f} s  top {m['top']:5.1f}  rms {m['rms']:6.1f}  "
                  f"anslag {m['anslag']:4.0f} ms  {m['kb']:4.1f} KB  <- {rel}  {'; '.join(noter)}")
        forslag.append((gruppe, vol, slags, faelles + bag))
    print('\nForslag til relativ afspilningsstyrke:')
    for g, v, sl, s in forslag:
        print(f'  {g:20s} {v:.2f}   ({sl}, styrke {s:.1f} dB, mål {MAAL[sl]} dB)')
    print(f'\nI alt {antal} filer, {total:.0f} KB')


if __name__ == '__main__':
    main()
