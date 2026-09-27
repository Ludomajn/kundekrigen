"""Kundekrigen — brugerens egen dialog i filmintroens klip.

Veo-klippene (static/grafik/intro/<figur>.mp4) kom med Veos egen stemme og
lyd. Brugeren har indtalt replikkerne selv (Assets/Kundelyde/<Navn>/Dialog.aifc,
gjort til static/lyd/stemme_<navn>_dialog.ogg af kundelyde.py). Dette værktøj
erstatter klippets HELE lydspor med dialogen, lagt ind dér, hvor figuren
taler i billedet. Passer den ikke helt til mundbevægelserne, ligger den der
alligevel (brugerens ønske). Billedet kopieres uændret.

Forskydningen er fundet ud fra, hvornår munden bevæger sig i klippet, og en
krydskorrelation af Veo-stemmens og dialogens energi. Kan køres igen, hvis
klippet bliver lavet om; så skal tallet måske rettes.

Kør:  python3 vaerktoej/klipdialog.py
"""
import os, shutil, subprocess, tempfile

HER = os.path.dirname(os.path.abspath(__file__))
ROD = os.path.dirname(HER)
INTRO = os.path.join(ROD, 'static', 'grafik', 'intro')
LYD = os.path.join(ROD, 'static', 'lyd')

# figur: (dialogens lyd, sekunder inde i klippet, hvor replikken begynder)
KLIP = {
    16: ('stemme_ingrid_dialog', 3.2),   # Skrankepaven Ingrid: nærbilledet, fra ca. 3,1 s
    21: ('stemme_jan_dialog', 3.4),      # Dr. Jan fra Mors: munden går fra ca. 3,4 s
}


def varighed(fil):
    ud = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fil],
                        capture_output=True, text=True, check=True).stdout
    return float(ud.strip())


def main():
    for figur, (dialog, fra) in KLIP.items():
        klip = os.path.join(INTRO, f'{figur}.mp4')
        lyd = os.path.join(LYD, f'{dialog}.ogg')
        if not (os.path.exists(klip) and os.path.exists(lyd)):
            print(f'  springer {figur} over: mangler {klip if not os.path.exists(klip) else lyd}')
            continue
        laengde = varighed(klip)
        ms = int(fra * 1000)
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False, dir=INTRO) as t:
            tmp = t.name
        # Dialogen forsinket til sin plads, stilhed resten, præcis klippets længde.
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', klip, '-i', lyd,
                        '-filter_complex', f'[1:a]aresample=48000,adelay={ms}:all=1,apad,atrim=0:{laengde:.3f},'
                                           f'aformat=channel_layouts=stereo[a]',
                        '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                        '-movflags', '+faststart', tmp], check=True)
        shutil.move(tmp, klip)
        print(f'  {figur}.mp4: {dialog} fra {fra:.2f} s ({varighed(lyd):.2f} s af {laengde:.2f} s)')


if __name__ == '__main__':
    main()
