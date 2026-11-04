// =====================================================================
//  Tomas del video «¿Y si el Llaima despertara?» (9:16, 24 fps)
//  Cada toma: duración, cámara por fotogramas clave, tiempo de simulación,
//  «look» (cielo/niebla) y gráficos dibujados encima.
//  Zona segura para redes: textos entre y≈220 y y≈1560, x 64–1000.
// =====================================================================
(() => {
  const { C, F, ease, win, ss, lerp, clamp, txt, reveal, pin, hud, chapter, stat, vignette, gradTop, gradBot, shade, glass, line, partial, groundPath, proj, measure, rrect } = DIR;
  const MELI = [3.09, -17.37], CRATER = [0.03, 0.0];
  const W = 1080, H = 1920;
  const D = window.VDATA || {};   // datos medidos por el motor (los inyecta render.js)

  // ------------------------------------------------------------ utilidades de composición
  const fadeIn = (t, d = 0.6) => shade(1 - ss(0, d, t));
  const fadeOut = (t, dur, d = 0.6) => shade(ss(dur - d, dur, t));
  const kicker = (s, x, y, t, t0, t1, col = C.acc2) => reveal(s, x, y, t, t0, t1, { size: 28, weight: 650, track: 7, color: col });
  // lista de etiquetas de lugares sobre el terreno (siempre discretas)
  function place(name, x, y, t, t0, t1, o = {}) {
    const a = win(t, t0, t1, 0.5, 0.4); if (a <= 0) return; const p = proj(x, y, o.dz ?? 0); if (!p.on) return;
    const c = DIR.ctx; c.save(); c.globalAlpha = a; c.fillStyle = o.color || '#fff'; c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 8; c.beginPath(); c.arc(p.x, p.y, o.r || 6, 0, 7); c.fill(); c.restore();
    txt(name, p.x + (o.dx ?? 16), p.y + (o.dy ?? 10), { size: o.size || 30, weight: o.weight || 600, alpha: a, align: o.align || 'left', color: o.color || '#fff', track: o.track ?? 0.5 });
  }

  // =================================================================== 1 · APERTURA
  DIR.shot('s01_open', {
    dur: 9.5, hour: 19.85,
    look: { sky: 'golden', fog: '#d7ab8a', fogD: 0.9 },
    init() { APP.S.fumQ = 2.0; },
    cam: [
      { t: 0, x: 1.0, y: -7.5, dist: 34, head: 338, pitch: 24, fov: 36 },
      { t: 9.5, x: 0.6, y: -3.5, dist: 21, head: 346, pitch: 19, fov: 36 },
    ],
    camEase: ease.sine,
    sim: t => 600 + t * 10,
    draw(t) {
      gradTop(0.5, 520); gradBot(0.85, 1100); vignette(0.8);
      kicker('LA ARAUCANÍA · CHILE', 72, 1080, t, 1.3, 9.0);
      reveal('¿Y si el', 66, 1210, t, 1.7, 9.0, { size: 118, weight: 800, font: F.disp, track: -2 });
      reveal('Llaima', 60, 1350, t, 2.0, 9.0, { size: 168, weight: 800, font: F.disp, track: -4, color: '#fff' });
      reveal('despertara?', 66, 1478, t, 2.3, 9.0, { size: 118, weight: 800, font: F.disp, track: -2 });
      reveal('Una simulación física sobre el relieve real', 72, 1560, t, 3.2, 9.0, { size: 32, weight: 500, color: C.tx2 });
      hud(t, { alpha: win(t, 0.8, 12) });
      fadeIn(t, 1.4);
    },
  });

  // =================================================================== 2 · MELIPEUCO A LOS PIES DEL VOLCÁN
  DIR.shot('s02_meli', {
    dur: 9, hour: 19.95, roads: true,
    look: { sky: 'golden', fog: '#d4a888', fogD: 0.9 },
    cam: [
      { t: 0, x: 2.6, y: -13.5, dist: 13.5, head: 338, pitch: 15, fov: 38 },
      { t: 9, x: 2.2, y: -11.0, dist: 15.5, head: 344, pitch: 17, fov: 38 },
    ],
    camEase: ease.sine,
    sim: t => 900 + t * 10,
    draw(t) {
      gradTop(0.55, 600); gradBot(0.7, 700); vignette(0.7);
      // distancia cráter–Melipeuco sobre el terreno
      const path = groundPath(MELI, CRATER, 60, 60);
      const f = ease.inOut((t - 2.6) / 2.2);
      if (t > 2.6) line(partial(path, f), { color: C.acc2, w: 4, dash: [2, 12], alpha: win(t, 2.6, 8.8, 0.3, 0.4), glow: 6 });
      pin(MELI[0], MELI[1], 'MELIPEUCO', '6.138 hab. · Censo 2017', t, 0.8, 8.8, { len: 120, size: 50, subSize: 28 });
      pin(CRATER[0], CRATER[1], 'LLAIMA', '3.125 m s.n.m.', t, 2.0, 8.8, { len: 90, size: 46, subSize: 28, color: C.acc, hgt: 0 });
      // rótulo de la distancia en la mitad de la línea
      if (t > 4.2) { const m = path[30]; const a = win(t, 4.4, 8.8, 0.5, 0.4); if (m.on) { txt('17,6 km', m.x + 24, m.y, { size: 64, weight: 800, font: F.disp, alpha: a, color: C.acc2 }); txt('EN LÍNEA RECTA', m.x + 28, m.y + 40, { size: 22, weight: 600, track: 4, alpha: a * 0.8 }); } }
      kicker('A LOS PIES DEL VOLCÁN', 72, 1420, t, 0.6, 8.8, C.tx2);
      hud(t, {});
      fadeIn(t, 0.4);
    },
  });

  // =================================================================== 3 · HISTORIAL Y PROBABILIDAD DE ERUPCIÓN
  const CAT = window.VCAT || [];
  DIR.shot('s03_hist', {
    dur: 11.5, hour: 13,
    look: { sky: 'day', fog: '#bfd0de' },
    cam: [
      { t: 0, x: 1.5, y: -7, dist: 40, head: 350, pitch: 62, fov: 38 },
      { t: 11.5, x: 1.0, y: -5.5, dist: 33, head: 8, pitch: 66, fov: 38 },
    ],
    camEase: ease.lin,
    sim: t => 1200 + t * 10,
    bgFilter: t => `blur(${(3 + 9 * ss(4.6, 6.4, t)).toFixed(1)}px) brightness(${(0.55 - 0.12 * ss(4.6, 6.4, t)).toFixed(2)}) saturate(0.9)`,
    draw(t) {
      vignette(1);
      // --- línea de tiempo de erupciones 1640–2009
      const x0 = 96, x1 = 984, yb = 760, X = y => x0 + (x1 - x0) * (y - 1640) / (2026 - 1640);
      const a1 = win(t, 0.3, 6.0, 0.6, 0.6);
      kicker('ERUPCIONES REGISTRADAS', 72, 420, t, 0.3, 6.0);
      const cnt = CAT.filter(e => X(e.y) < x0 + (x1 - x0) * ease.inOut((t - 0.8) / 3.2)).length;
      if (a1 > 0) {
        txt(String(cnt), 66, 600, { size: 190, weight: 800, font: F.disp, track: -6, alpha: a1 });
        txt('desde 1640', 70 + measure(String(cnt), { size: 190, weight: 800, font: F.disp, track: -6 }) + 22, 600, { size: 52, weight: 600, font: F.disp, alpha: a1 * 0.85 });
        const c = DIR.ctx; c.save(); c.globalAlpha = a1 * 0.35; c.fillStyle = '#fff'; c.fillRect(x0, yb, x1 - x0, 2); c.restore();
        for (const [yr, lab] of [[1650, '1650'], [1750, '1750'], [1850, '1850'], [1950, '1950'], [2026, 'HOY']]) { txt(lab, X(yr), yb + 52, { size: 24, weight: 600, font: F.mono, align: 'center', alpha: a1 * 0.7 }); }
        for (const e of CAT) {
          const px = X(e.y), k = ss(0, 0.25, (x0 + (x1 - x0) * ease.inOut((t - 0.8) / 3.2)) - px > 0 ? 1 : 0);
          if (!k) continue;
          const r = [0, 5, 7, 12, 18][e.vei] || 6, big = e.vei >= 3;
          c.save(); c.globalAlpha = a1 * (big ? 0.95 : 0.6); c.fillStyle = big ? C.acc : '#fff'; c.beginPath(); c.arc(px, yb - r - 6, r, 0, 7); c.fill(); c.restore();
        }
        const lx = X(2009); txt('2009', lx, yb - 70, { size: 30, weight: 700, font: F.mono, align: 'center', alpha: a1 * ss(4.0, 4.6, t), color: C.acc2 });
        txt('ÚLTIMA', lx, yb - 104, { size: 20, weight: 600, track: 3, align: 'center', alpha: a1 * ss(4.0, 4.6, t) * 0.8 });
        const ly = 900;
        c.save(); c.globalAlpha = a1; c.fillStyle = C.acc; c.beginPath(); c.arc(100, ly - 9, 11, 0, 7); c.fill(); c.fillStyle = '#fff'; c.globalAlpha = a1 * 0.6; c.beginPath(); c.arc(370, ly - 9, 7, 0, 7); c.fill(); c.restore();
        txt('IEV 3 o mayor', 124, ly, { size: 28, weight: 500, alpha: a1 * 0.85 }); txt('IEV 1–2', 390, ly, { size: 28, weight: 500, alpha: a1 * 0.85 });
        txt('Uno de los volcanes más activos de Sudamérica', 72, 1000, { size: 34, weight: 500, alpha: a1 * ss(4.4, 5.0, t) * 0.85, color: C.tx2 });
      }
      // --- probabilidad
      const a2 = win(t, 6.1, 11.6, 0.6, 0.4);
      if (a2 > 0) {
        const cx = 540, cy = 860, R = 300, k = ease.out((t - 6.2) / 2.0), p = 0.94 * k;
        const c = DIR.ctx; c.save(); c.globalAlpha = a2; c.lineWidth = 26; c.lineCap = 'round';
        c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
        const g = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); g.addColorStop(0, C.acc2); g.addColorStop(1, C.acc);
        c.strokeStyle = g; c.shadowColor = C.acc; c.shadowBlur = 30; c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); c.stroke(); c.restore();
        txt(String(Math.round(94 * k)), cx - 20, cy + 70, { size: 230, weight: 800, font: F.disp, track: -8, align: 'center', alpha: a2 });
        txt('%', cx + 128, cy + 70, { size: 96, weight: 700, font: F.disp, alpha: a2 });
        kicker('PROBABILIDAD DE ERUPCIÓN', 72, 420, t, 6.3, 11.6);
        reveal('en los próximos 10 años', 72, 500, t, 6.5, 11.6, { size: 58, weight: 750, font: F.disp, track: -1 });
        reveal('1 de cada 4', 120, 1290, t, 8.0, 11.6, { size: 70, weight: 800, font: F.disp, color: C.acc2 });
        reveal('es la probabilidad en un solo año', 120, 1346, t, 8.2, 11.6, { size: 34, weight: 500, color: C.tx2 });
        reveal('Estimación estadística del registro histórico (1900–2026)', 72, 1500, t, 8.8, 11.6, { size: 24, weight: 500, color: C.tx3 });
      }
      hud(t, {});
      fadeIn(t, 0.5); fadeOut(t, 11.5, 0.35);
    },
  });

  // =================================================================== 4 · ¿QUÉ TIPO DE ERUPCIÓN?
  const TYPES = [
    { n: 'Estromboliana', p: 60, d: 'Explosiones y fuentes de lava', c: '#ffb15c' },
    { n: 'Efusiva', p: 25, d: 'Coladas de lava durante días', c: '#ff8a3d' },
    { n: 'Subpliniana', p: 12, d: 'Columna de 15–20 km, caída de ceniza', c: '#ff5a1f' },
    { n: 'Pliniana', p: 3, d: 'Colapso de columna, flujos piroclásticos', c: '#e8202a' },
  ];
  DIR.shot('s04_types', {
    dur: 10.5, hour: 13,
    look: { sky: 'day', fog: '#bfd0de' },
    cam: [
      { t: 0, x: 0, y: 0, dz: -700, dist: 9, head: 20, pitch: 16, fov: 40 },
      { t: 10.5, x: 0, y: 0, dz: -700, dist: 9, head: 62, pitch: 18, fov: 40 },
    ],
    camEase: ease.lin,
    sim: t => 1500 + t * 10,
    bgFilter: () => 'blur(14px) brightness(0.42) saturate(0.9)',
    draw(t) {
      vignette(1);
      kicker('SI HUBIERA UNA ERUPCIÓN', 72, 380, t, 0.3, 10.2);
      reveal('¿De qué tipo sería?', 66, 470, t, 0.5, 10.2, { size: 80, weight: 800, font: F.disp, track: -2 });
      TYPES.forEach((ty, i) => {
        const t0 = 1.3 + i * 0.55, y = 690 + i * 210, a = win(t, t0, 10.2, 0.5, 0.4); if (a <= 0) return;
        const k = ease.outQ((t - t0 - 0.15) / 1.4), bw = 860 * ty.p / 60 * k;
        txt(ty.n, 72, y, { size: 50, weight: 750, font: F.disp, alpha: a });
        txt(Math.round(ty.p * k) + ' %', 1008, y, { size: 56, weight: 800, font: F.disp, align: 'right', alpha: a, color: ty.c });
        const c = DIR.ctx; c.save(); c.globalAlpha = a * 0.16; c.fillStyle = '#fff'; rrect(72, y + 26, 936, 18, 9); c.fill();
        c.globalAlpha = a; c.fillStyle = ty.c; c.shadowColor = ty.c; c.shadowBlur = 18; rrect(72, y + 26, Math.max(18, bw), 18, 9); c.fill(); c.restore();
        txt(ty.d, 74, y + 92, { size: 30, weight: 500, alpha: a * 0.75, color: C.tx2 });
      });
      reveal('Árbol de eventos del simulador según el registro del Llaima', 72, 1560, t, 3.6, 10.2, { size: 24, weight: 500, color: C.tx3 });
      hud(t, {});
      fadeIn(t, 0.35); fadeOut(t, 10.5, 0.35);
    },
  });

  // =================================================================== 99 · CIERRE
  DIR.shot('s99_end', {
    dur: 10, hour: 20.55,
    look: { sky: 'dusk', fog: '#b98a76', fogD: 0.9 },
    cam: [
      { t: 0, x: 2.8, y: -15.5, dist: 9, head: 335, pitch: 14, fov: 38 },
      { t: 10, x: 1.6, y: -9.0, dist: 30, head: 342, pitch: 20, fov: 38 },
    ],
    camEase: ease.inOut,
    sim: t => 2400 + t * 10,
    draw(t) {
      gradTop(0.5, 600); gradBot(0.9, 1200); vignette(0.9);
      kicker('HOY EL LLAIMA ESTÁ EN CALMA', 72, 1040, t, 0.6, 9.8, C.acc2);
      reveal('Conoce tu', 66, 1170, t, 1.0, 9.8, { size: 112, weight: 800, font: F.disp, track: -2 });
      reveal('zona segura.', 62, 1290, t, 1.3, 9.8, { size: 112, weight: 800, font: F.disp, track: -2 });
      reveal('Lejos de ríos y esteros · hacia terrenos altos', 72, 1370, t, 2.2, 9.8, { size: 32, weight: 500, color: C.tx2 });
      const a = win(t, 4.0, 10.5, 0.8, 0.5);
      txt('Simulación: LLAIMA 3D · motor físico en GPU sobre relieve Copernicus GLO-30', 72, 1480, { size: 22, weight: 500, alpha: a * 0.7 });
      txt('Herramienta educativa: no reemplaza los mapas de peligro de SERNAGEOMIN', 72, 1514, { size: 22, weight: 500, alpha: a * 0.7 });
      txt('ni las instrucciones de SENAPRED.', 72, 1546, { size: 22, weight: 500, alpha: a * 0.7 });
      hud(t, {});
      fadeIn(t, 0.4); fadeOut(t, 10, 1.6);
    },
  });
})();
