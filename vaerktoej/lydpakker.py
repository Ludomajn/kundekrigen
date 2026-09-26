"""Kundekrigen — effektlyde fra "Sound effects Pack 2" og "Snake's Authentic
Gun Sounds" (Assets/). Valgt ud fra længde og om klangen stiger eller falder
(vaerktoej-analysen i README). For hver: stilhed klippes væk i begge ender,
toppen normaliseres til -3 dB, en kort udtoning, og der gemmes som Ogg i
static/lyd/<navn>.ogg.

Kør:  python3 vaerktoej/lydpakker.py [Assets-mappe]
"""
import os, re, subprocess, sys

HER = os.path.dirname(os.path.abspath(__file__))
ROD = os.path.dirname(HER)
ASSETS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROD, '..', 'Assets')
UD = os.path.join(ROD, 'static', 'lyd')
P2 = 'Sound effects Pack 2'
GUN = "Snake's Authentic Gun Sounds/Reloads, Cycling & More/WAV"

VALG = {
    'sfx_oplad':      f'{P2}/Power-up/WAV/Powerup 10 - Sound effects Pack 2.wav',   # stiger jævnt
    'sfx_fuld_kraft': f'{P2}/Coins/WAV/Coins 9 - Sound effects Pack 2.wav',          # kort ding op
    'sfx_hop':        f'{P2}/Jump/WAV/Jump 4 - Sound effects Pack 2.wav',
    'sfx_salto':      f'{P2}/Jump/WAV/Jump 2 - Sound effects Pack 2.wav',
    'sfx_tael':       f'{P2}/Blip/WAV/Blip 4 - Sound effects Pack 2.wav',            # nedtællingens tik
    'sfx_ramt':       f'{P2}/Hit/WAV/Hit 5 - Sound effects Pack 2.wav',
    'sfx_vaabenskift': f'{GUN}/AR Bolt Release WAV.wav',
    'sfx_kasse':      f'{P2}/Coins/WAV/Coins 8 - Sound effects Pack 2.wav',
    'sfx_helbred':    f'{P2}/1up/WAV/1up 3 - Sound effects Pack 2.wav',
    'sfx_sort_hul':   f'{P2}/Teleport/WAV/Teleport 2 - Sound effects Pack 2.wav',
    'sfx_teleport':   f'{P2}/Teleport/WAV/Teleport 5 - Sound effects Pack 2.wav',
    # Intro og slutning
    'sfx_intro_slam': f'{P2}/Explosions/WAV/Explosion 8 - Sound effects Pack 2.wav',  # titlen slår ind
    'sfx_nedtael':    f'{P2}/Blip/WAV/Blip 3 - Sound effects Pack 2.wav',            # 3 … 2 … 1
    'sfx_kamp_start': f'{P2}/Power-up/WAV/Powerup 4 - Sound effects Pack 2.wav',     # SÆT I GANG!
    'sfx_landing':    f'{P2}/Hit/WAV/Hit 10 - Sound effects Pack 2.wav',             # kunderne lander
    'sfx_du_vandt':   f'{P2}/1up/WAV/1up 8 - Sound effects Pack 2.wav',              # DU HAR VUNDET!
    'sfx_tabt':       f'{P2}/Lose/WAV/Lose 3 - Sound effects Pack 2.wav',
}

# Musik: klippes ikke i toppen og normaliseres ikke (den er mastret), men
# stilheden til sidst skæres væk, og kanterne tones, så løkken ikke hakker.
MUSIK = {
    'musik_menu': ('kulakovka-fighting-283961.mp3', 152.2),   # (fil, slut i sekunder)
    'musik_kamp': ('monume-fight-fighting-ufc-music-519240.mp3', 99.7),
}

KLIP = ('silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01,'
        'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse')


def top_db(fil, filtre):
    ud = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', fil, '-af', filtre + ',volumedetect',
                         '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.search(r'max_volume: (-?[\d.]+) dB', ud).group(1))


def varighed(fil):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of',
                                 'csv=p=0', fil], capture_output=True, text=True).stdout)


def main():
    for navn, rel in VALG.items():
        kilde = os.path.join(ASSETS, rel)
        ud = os.path.join(UD, navn + '.ogg')
        forstaerk = -3.0 - top_db(kilde, KLIP)
        filtre = f'{KLIP},volume={forstaerk:.2f}dB,aformat=channel_layouts=mono,aresample=44100'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', kilde, '-af', filtre,
                        '-c:a', 'libvorbis', '-q:a', '5', ud], check=True)
        d = varighed(ud)
        # Kort udtoning, så intet klikker til sidst (ffmpeg kender først længden nu).
        tmp = ud + '.tmp.ogg'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', ud, '-af', f'afade=t=out:st={max(0, d - 0.02):.3f}:d=0.02',
                        '-c:a', 'libvorbis', '-q:a', '5', tmp], check=True)
        os.replace(tmp, ud)
        print(f'{navn:16s} {d:5.2f} s  {os.path.getsize(ud) // 1024:3d} KB  <- {os.path.basename(rel)}')

    for navn, (rel, slut) in MUSIK.items():
        ud = os.path.join(UD, navn + '.ogg')
        filtre = f'atrim=0:{slut},afade=t=in:st=0:d=0.05,afade=t=out:st={slut - 1.2:.2f}:d=1.2'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(ASSETS, rel), '-af', filtre,
                        '-ar', '44100', '-ac', '2', '-c:a', 'libvorbis', '-q:a', '3', ud], check=True)
        print(f'{navn:16s} {varighed(ud):6.1f} s  {os.path.getsize(ud) // 1024:5d} KB  <- {rel}')


if __name__ == '__main__':
    main()
