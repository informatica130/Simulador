#!/usr/bin/env python3
"""Banda sonora original sintetizada para el video (sin muestras externas).

Capas: dron grave, colchón armónico (Re menor) con filtro que respira, motivo
de piano/pluck, pulso tipo latido que crece con la tensión, golpes graves en los
cambios de capítulo, subidas de ruido antes de cada golpe y retumbo volcánico
(ruido marrón filtrado) que sigue la intensidad de la erupción en pantalla.

Uso: python3 music.py cues.json salida.wav
cues.json: {"dur": s, "sections": [[t0, t1, tension 0..1, rumble 0..1], ...],
            "hits": [t, ...], "risers": [t, ...], "motif": [[t0, t1], ...], "silence": [[t0, t1], ...]}
"""
import json, sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
rng = np.random.default_rng(7)


def env_from_sections(n, sections, idx, default=0.0, fade=1.5):
    """Curva continua (suavizada) a partir de tramos [t0, t1, ...valores]."""
    e = np.full(n, default, dtype=np.float64)
    for s in sections:
        a, b = int(s[0] * SR), int(s[1] * SR)
        e[max(0, a):min(n, b)] = s[idx]
    k = int(fade * SR)
    if k > 1:
        w = np.hanning(2 * k + 1); w /= w.sum()
        e = fftconvolve(np.pad(e, k, mode='edge'), w, mode='valid')
    return e[:n]


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, f1, f2, order=2):
    return sosfilt(butter(order, [f1, f2], 'band', fs=SR, output='sos'), x)


def note(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def saw(t, f, det=0.0):
    ph = (t * f * (1 + det)) % 1.0
    return 2 * ph - 1


def reverb(x, secs=3.5, mix=0.3, pre=0.02):
    n = int(secs * SR)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7.5, n))
    ir = lp(ir, 6000)
    ir[:int(pre * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum())
    wet = fftconvolve(x, ir)[:len(x)]
    return (1 - mix) * x + mix * wet * 0.9


def main(cfile, out):
    cues = json.load(open(cfile))
    dur = cues['dur']; n = int(dur * SR); t = np.arange(n) / SR
    tension = env_from_sections(n, cues['sections'], 2, 0.2, 2.0)
    rumble = env_from_sections(n, cues['sections'], 3, 0.0, 1.2)
    silence = np.ones(n)
    for a, b in cues.get('silence', []):
        silence *= 1 - env_from_sections(n, [[a, b, 1.0]], 2, 0.0, 0.25)

    # ---------------------------------------------------- progresión (Re menor)
    # acordes de 4 compases a 72 bpm (3,33 s por compás)
    bar = 60 / 72 * 4
    prog = [[50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64],
            [50, 57, 62, 65], [46, 53, 58, 65], [43, 50, 55, 58], [45, 52, 57, 61]]
    pad = np.zeros(n)
    for i in range(int(dur / bar) + 2):
        ch = prog[i % len(prog)]
        a = int(i * bar * SR); b = min(n, int((i + 1) * bar * SR + 1.2 * SR))
        if a >= n: break
        tt = t[a:b] - i * bar
        seg = np.zeros(b - a)
        for m in ch:
            f = note(m)
            for d in (-0.004, 0.0, 0.0045):
                seg += saw(tt, f, d) * 0.12
            seg += np.sin(2 * np.pi * f * 0.5 * tt) * 0.08
        L = b - a; att = min(L, int(1.0 * SR)); rel = min(L, int(1.4 * SR))
        e = np.ones(L); e[:att] = np.linspace(0, 1, att) ** 2
        e[-rel:] *= np.linspace(1, 0, rel) ** 1.5
        pad[a:b] += seg * e
    # filtro que respira con la tensión: barrido por bloques
    out_pad = np.zeros(n); blk = SR // 4
    for s in range(0, n, blk):
        seg = pad[max(0, s - blk):s + blk]
        fc = 350 + 2600 * tension[min(n - 1, s)] ** 1.3 + 250 * np.sin(s / SR * 0.21)
        y = lp(seg, fc, 2)
        out_pad[s:s + blk] = y[(blk if s >= blk else 0):(blk if s >= blk else 0) + len(out_pad[s:s + blk])]
    pad = out_pad * (0.55 + 0.45 * tension)

    # ---------------------------------------------------- dron grave
    drone = (np.sin(2 * np.pi * note(26) * t) * 0.5 + np.sin(2 * np.pi * note(38) * t + 0.3) * 0.25 +
             0.15 * np.sin(2 * np.pi * note(45) * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * t / 9.0) ** 2)
    drone *= 0.35 + 0.5 * tension

    # ---------------------------------------------------- pulso (latido)
    pulse = np.zeros(n); beat = 60 / 72
    k = 0
    while k * beat < dur:
        for off, g in ((0.0, 1.0), (0.26, 0.6)):
            tt0 = k * beat + off; a = int(tt0 * SR)
            if a >= n: break
            if tension[a] < 0.45: continue
            L = min(int(0.5 * SR), n - a); tt = np.arange(L) / SR
            f = 48 + 70 * np.exp(-tt * 30)
            s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9) * g
            pulse[a:a + L] += s * ((tension[a] - 0.45) / 0.55) ** 1.2
        k += 1

    # ---------------------------------------------------- motivo pluck (piano)
    pluck = np.zeros(n)
    motif = [74, 72, 69, 67, 69, 65, 64, 62]
    for (m0, m1) in cues.get('motif', []):
        tt0 = m0; i = 0
        while tt0 < m1:
            mm = motif[i % len(motif)]; a = int(tt0 * SR); L = min(int(3.0 * SR), n - a)
            if L <= 0: break
            tt = np.arange(L) / SR; f = note(mm)
            s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) * np.exp(-tt * 3) + 0.12 * np.sin(6 * np.pi * f * tt) * np.exp(-tt * 6))
            s *= np.exp(-tt * 1.6) * (1 - np.exp(-tt * 400))
            pluck[a:a + L] += s * 0.22
            tt0 += beat * (2 if i % 4 != 3 else 4); i += 1

    # ---------------------------------------------------- retumbo volcánico
    brown = np.cumsum(rng.standard_normal(n)); brown = hp(brown, 18); brown /= np.abs(brown).max() + 1e-9
    rum = lp(brown, 160, 4) * 2.2 + bp(rng.standard_normal(n), 60, 400) * 0.08
    rum *= rumble * (0.75 + 0.25 * np.abs(np.sin(2 * np.pi * t / 3.7)))

    # ---------------------------------------------------- golpes y subidas
    hits = np.zeros(n)
    for h in cues.get('hits', []):
        a = int(h * SR); L = min(int(4.5 * SR), n - a)
        if L <= 0: continue
        tt = np.arange(L) / SR
        f = 32 + 90 * np.exp(-tt * 14)
        boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 1.1)
        nz = lp(rng.standard_normal(L), 900) * np.exp(-tt * 5) * 0.5
        hits[a:a + L] += (boom * 0.9 + nz)
    risers = np.zeros(n)
    for r in cues.get('risers', []):
        L = int(2.6 * SR); a = int(r * SR) - L
        if a < 0: continue
        tt = np.linspace(0, 1, L)
        nz = rng.standard_normal(L)
        y = np.zeros(L); blk = SR // 20
        for s in range(0, L, blk):
            fc = 300 + 7000 * tt[s] ** 2.2
            y[s:s + blk] = bp(nz[max(0, s - blk):s + blk], fc * 0.7, min(SR / 2 - 100, fc * 1.4))[-len(y[s:s + blk]):]
        risers[a:a + L] += y * tt ** 2.5 * 0.5

    # ---------------------------------------------------- mezcla
    music = pad * 0.9 + drone * 0.8 + pluck * 0.9
    music = reverb(music, 4.0, 0.35)
    fx = reverb(hits * 0.9 + risers, 2.5, 0.25) + pulse * 0.75 + rum * 0.55
    mix = (music + fx) * silence
    # estéreo: leve ensanchamiento con retardo y ruido de fase distinto en el colchón
    d = int(0.011 * SR)
    L = mix + 0.12 * np.concatenate([np.zeros(d), (pad * 0.9)[:-d]])
    R = mix + 0.12 * np.concatenate([(pad * 0.9)[d:], np.zeros(d)])
    st = np.stack([L, R], 1)
    # fundidos de entrada/salida
    fi, fo = int(0.8 * SR), int(cues.get('fadeout', 3.0) * SR)
    st[:fi] *= np.linspace(0, 1, fi)[:, None]; st[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    # normalización a ~-14 LUFS aprox. (RMS) y limitador suave
    rms = np.sqrt((st ** 2).mean()); st *= 10 ** (-15.5 / 20) / (rms + 1e-9)
    st = np.tanh(st * 1.15) / np.tanh(1.15)
    st *= 0.95 / max(1e-9, np.abs(st).max())
    pcm = (st * 32767).astype(np.int16)
    import wave
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print('ok', out, f'{dur:.1f}s')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
