#!/usr/bin/env python3
"""Locución: sintetiza cada línea de vo.json con Piper, la procesa (EQ, compresión, sala leve) y mide duraciones."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', 'work', 'vo'); os.makedirs(OUT, exist_ok=True)
MODEL = os.path.join(HERE, '..', 'work', 'tts', 'es_MX-claude-high.onnx')
LS = float(os.environ.get('LS', '1.06'))
lines = json.load(open(os.path.join(HERE, 'vo.json')))
only = sys.argv[1:]
dur = {}
for vid, text in lines:
    raw, fin = os.path.join(OUT, vid + '_raw.wav'), os.path.join(OUT, vid + '.wav')
    if not only or vid in only or not os.path.exists(fin):
        subprocess.run([sys.executable, '-m', 'piper', '-m', MODEL, '-f', raw, '--length-scale', str(LS), '--noise-scale', os.environ.get('NS', '0.4'), '--noise-w-scale', os.environ.get('NW', '0.5'), '--sentence-silence', '0.35'], input=text.encode(), check=True, capture_output=True)
        # voz de documental: limpia graves, presencia, compresión suave, sala corta y recorte de silencios
        af = ('highpass=f=80,lowpass=f=11500,equalizer=f=180:t=q:w=1.0:g=2.0,equalizer=f=3200:t=q:w=1.2:g=2.5,equalizer=f=7000:t=q:w=2:g=-1.5,'
              'acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=4,'
              'aecho=0.8:0.5:28|47:0.12|0.07,'
              'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
              'loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-af', af, '-ac', '1', fin], check=True)
    d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fin]).decode())
    dur[vid] = round(d, 2); print(vid, f'{d:5.2f} s', text[:60])
json.dump(dur, open(os.path.join(OUT, 'dur.json'), 'w'), indent=1)
print('total', round(sum(dur.values()), 1), 's')
