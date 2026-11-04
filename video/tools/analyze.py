#!/usr/bin/env python3
"""Analiza un punto de control del motor: trayectoria del frente del lahar hacia Melipeuco
y tiempos de llegada al pueblo. Escribe los resultados en work/vdata.json[escenario]."""
import json, struct, sys, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); WORK = os.path.join(HERE, '..', 'work')
scen, f = sys.argv[1], sys.argv[2]
b = open(f, 'rb').read(); jl, nb = struct.unpack('<II', b[:8]); meta = json.loads(b[8:8 + jl]); W, H = meta['W'], meta['H']
o = (8 + jl + 3) // 4 * 4
stat = np.frombuffer(b, np.float32, W * H * 4, o + 3 * W * H * 16).reshape(H, W, 4)
G = json.load(open(os.path.join(HERE, '..', '..', 'data', 'grid.json'))); c = G['cell'] * (G['nx'] // W)
jj, ii = np.mgrid[0:H, 0:W]; X = G['X0'] + (ii + 0.5) * c; Y = G['Y1'] - (jj + 0.5) * c
TOWN = (3.09, -17.37)
d = np.hypot(X - TOWN[0], Y - TOWN[1]); h = stat[..., 0]; arr = stat[..., 1] - 1
ok = (h > 0.3) & (arr > 0) & (X > 1.5)  # rama del Truful-Truful (descarta celdas sueltas al oeste)
tEnd = meta['run']['t']; track = []
for t in np.arange(300, tEnd + 1, 120):
    m = ok & (arr <= t)
    if not m.any(): continue
    k = np.argmin(np.where(m, d, 1e9)); track.append({'t': round(float(t)), 'x': round(float(X.flat[k]), 3), 'y': round(float(Y.flat[k]), 3), 'd': round(float(d.flat[k]), 3)})
def first(r, th=0.3):
    m = (h > th) & (arr > 0) & (d <= r)
    return round(float(arr[m].min())) if m.any() else -1
def hmax(r):
    m = (d <= r) & (arr > 0); return round(float(h[m].max()), 2) if m.any() else 0
res = {'tEnd': round(tEnd), 'track': track, 'arr05': first(0.5), 'arr1': first(1.0), 'arr2': first(2.0), 'arr1_1m': first(1.0, 1.0),
       'h05': hmax(0.5), 'h1': hmax(1.0), 'h2': hmax(2.0), 'minD': track[-1]['d'] if track else None}
p = os.path.join(WORK, 'vdata.json'); V = json.load(open(p)) if os.path.exists(p) else {}
V[scen] = res; json.dump(V, open(p, 'w'))
print({k: v for k, v in res.items() if k != 'track'}); print('track', len(track), track[::12])
