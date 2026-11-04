#!/usr/bin/env python3
"""Montaje final: une las tomas, genera la música sincronizada y codifica el MP4 9:16."""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, '..', 'work')
OUT = os.path.join(HERE, '..', 'llaima_que_pasaria_si.mp4')

# orden de montaje: (toma, tensión musical 0..1, retumbo 0..1, golpe al inicio)
EDIT = [
    # (toma, tensión, retumbo, golpe, locución, desfase de la locución en la toma)
    ('a_title', 0.12, 0.0, False, 'v01', 0.9),
    ('a_orbit', 0.16, 0.0, False, None, 0),
    ('a_meli', 0.22, 0.0, False, 'v02', 0.25),
    ('a_hist', 0.32, 0.0, False, 'v03', 0.35),
    ('a_types', 0.42, 0.0, False, 'v04', 0.25),
    ('e1_a', 0.58, 0.55, True, 'v05', 0.35),
    ('e1_b', 0.60, 0.45, False, None, 0),
    ('e1_lava', 0.60, 0.40, False, 'v06', 0.25),
    ('e1_meli', 0.48, 0.15, False, 'v07', 0.2),
    ('e2_a', 0.58, 0.30, True, 'v08', 0.3),
    ('e2_b', 0.58, 0.25, False, None, 0),
    ('e3_a', 0.74, 0.70, True, 'v09', 0.3),
    ('e3_b', 0.76, 0.60, False, None, 0),
    ('e3_ash', 0.66, 0.25, False, 'v10', 0.25),
    ('e4_a', 0.92, 1.00, True, 'v11', 0.3),
    ('e4_b', 0.96, 0.95, False, None, 0),
    ('e4_pdc', 1.00, 0.95, False, 'v12', 0.2),
    ('e4_lah_a', 1.00, 0.75, False, 'v13', 0.2),
    ('e4_bridge', 0.98, 0.65, False, None, 0),
    ('e4_lah_b', 1.00, 0.70, False, 'v14', 0.25),
    ('e4_arr', 0.80, 0.30, False, None, 0),
    ('ev_meli', 0.55, 0.0, True, 'v15', 0.5),
    ('z_end', 0.22, 0.0, False, 'v16', 0.8),
]


def dur(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())


def main():
    only = sys.argv[1:]  # opcional: montaje parcial con las tomas disponibles
    clips, t, secs, hits = [], 0.0, [], []
    vo = []
    for sid, ten, rum, hit, vid, voff in EDIT:
        f = os.path.join(WORK, 'shots', sid + '.mp4')
        if not os.path.exists(f):
            if only: continue
            sys.exit(f'falta la toma {sid}')
        d = dur(f); clips.append(f)
        secs.append([t, t + d, ten, rum])
        if hit: hits.append(round(t, 3))
        if vid: vo.append((vid, t + voff))
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
    # pista de voz: cada línea en su lugar
    VO = os.path.join(WORK, 'vo'); voin, vof = [], []
    for i, (vid, at) in enumerate(vo):
        voin += ['-i', os.path.join(VO, vid + '.wav')]; vof.append(f'[{i + 1}:a]adelay={int(at * 1000)}:all=1[v{i}]')
    voice = os.path.join(WORK, 'voice.wav')
    subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'anullsrc=r=48000:cl=mono:d={total:.3f}'] + voin +
                          ['-filter_complex', ';'.join(vof) + ';[0:a]' + ''.join(f'[v{i}]' for i in range(len(vo))) + f'amix=inputs={len(vo) + 1}:normalize=0:duration=first[o]', '-map', '[o]', '-ar', '48000', voice])
    mix = os.path.join(WORK, 'mix.wav')
    # la música baja ~8 dB bajo la voz (sidechain) y la voz queda al centro, por encima
    subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-i', voice, '-filter_complex',
                           '[1:a]asplit=2[vs][vm];[vs]aformat=channel_layouts=stereo[sc];[0:a]volume=0.85[m];'
                           '[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=450:makeup=1[md];'
                           '[vm]volume=1.25,aformat=channel_layouts=stereo[vv];[md][vv]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=9[o]',
                           '-map', '[o]', '-ar', '48000', mix])
    grade = ("curves=master='0/0.02 0.25/0.26 0.5/0.52 0.75/0.775 1/0.985',"
             "eq=contrast=1.06:saturation=1.08:gamma=1.03,"
             "unsharp=5:5:0.3:5:5:0,format=yuv420p")
    subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-stats', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', mix,
                           '-vf', grade, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-maxrate', '28M', '-bufsize', '56M',
                           '-profile:v', 'high', '-level', '4.2', '-r', '24', '-g', '48', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
                           '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest', '-movflags', '+faststart', OUT])
    print('listo', OUT, f'{total:.1f} s')


if __name__ == '__main__':
    main()
