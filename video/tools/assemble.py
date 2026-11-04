#!/usr/bin/env python3
"""Montaje final: une las tomas, genera la música sincronizada y codifica el MP4 9:16."""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, '..', 'work')
OUT = os.path.join(HERE, '..', 'llaima_que_pasaria_si.mp4')

# orden de montaje: (toma, tensión musical 0..1, retumbo 0..1, golpe al inicio)
EDIT = [
    ('s01_open', 0.12, 0.0, False),
    ('s02_meli', 0.22, 0.0, False),
    ('s03_hist', 0.35, 0.0, False),
    ('s04_types', 0.45, 0.0, False),
    ('e1_title', 0.60, 0.55, True),
    ('e1_lava', 0.62, 0.45, False),
    ('e1_meli', 0.50, 0.15, False),
    ('e2_flow', 0.62, 0.30, True),
    ('e3_col', 0.78, 0.75, True),
    ('e3_ash', 0.70, 0.30, False),
    ('e4_col', 0.95, 1.00, True),
    ('e4_pdc', 1.00, 0.95, False),
    ('e4_lahar', 1.00, 0.70, False),
    ('e4_arr', 0.85, 0.30, False),
    ('ev_meli', 0.55, 0.0, True),
    ('s99_end', 0.20, 0.0, False),
]


def dur(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())


def main():
    only = sys.argv[1:]  # opcional: montaje parcial con las tomas disponibles
    clips, t, secs, hits = [], 0.0, [], []
    for sid, ten, rum, hit in EDIT:
        f = os.path.join(WORK, 'shots', sid + '.mp4')
        if not os.path.exists(f):
            if only: continue
            sys.exit(f'falta la toma {sid}')
        d = dur(f); clips.append(f)
        secs.append([t, t + d, ten, rum])
        if hit: hits.append(round(t, 3))
        t += d
    total = t
    cues = {'dur': total, 'sections': secs, 'hits': hits, 'risers': hits,
            'motif': [[0.6, secs[min(2, len(secs) - 1)][1]], [secs[-1][0], total - 1]],
            'silence': [[h - 0.45, h - 0.02] for h in hits if h > 10][-2:-1], 'fadeout': 2.5}
    json.dump(cues, open(os.path.join(WORK, 'cues.json'), 'w'), indent=1)
    wav = os.path.join(WORK, 'music.wav')
    subprocess.check_call([sys.executable, os.path.join(HERE, 'music.py'), os.path.join(WORK, 'cues.json'), wav])
    lst = os.path.join(WORK, 'edit.txt')
    open(lst, 'w').write('\n'.join(f"file '{c}'" for c in clips))
    grade = ("curves=master='0/0.025 0.25/0.27 0.5/0.53 0.75/0.78 1/0.985',"
             "eq=contrast=1.05:saturation=1.10:gamma=1.04,"
             "unsharp=5:5:0.35:5:5:0,noise=alls=3:allf=t,format=yuv420p")
    subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-stats', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', wav,
                           '-vf', grade, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15',
                           '-profile:v', 'high', '-level', '4.2', '-r', '24', '-g', '48', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
                           '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest', '-movflags', '+faststart', OUT])
    print('listo', OUT, f'{total:.1f} s')


if __name__ == '__main__':
    main()
