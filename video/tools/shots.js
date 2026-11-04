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
    look: { sky: 'golden', fog: '#d7ab8a', fogD: 0.9, exp: 1.15 },
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
    look: { sky: 'golden', fog: '#d4a888', fogD: 0.85, exp: 1.2 },
    cam: [
      { t: 0, x: 2.0, y: -9.8, dist: 23, head: 340, pitch: 21, fov: 38 },
      { t: 9, x: 1.7, y: -8.6, dist: 25.5, head: 346, pitch: 23, fov: 38 },
    ],
    camEase: ease.sine,
    sim: t => 900 + t * 10,
    draw(t) {
      gradTop(0.55, 600); gradBot(0.7, 700); vignette(0.7);
      // distancia cráter–Melipeuco sobre el terreno
      const path = groundPath(MELI, CRATER, 60, 60);
      const f = ease.inOut((t - 2.6) / 2.2);
      if (t > 2.6) line(partial(path.slice(15), f), { color: C.acc2, w: 4, dash: [2, 12], alpha: win(t, 2.6, 8.8, 0.3, 0.4), glow: 6 });
      pin(MELI[0], MELI[1], 'MELIPEUCO', '6.138 hab. · Censo 2017', t, 0.8, 8.8, { len: 130, size: 50, subSize: 28 });
      pin(CRATER[0], CRATER[1], 'LLAIMA', '3.125 m s.n.m.', t, 2.0, 8.8, { len: 70, size: 46, subSize: 28, color: C.acc, hgt: 0 });
      // rótulo de la distancia en la mitad de la línea
      if (t > 4.2) { const m = path[30]; const a = win(t, 4.4, 8.8, 0.5, 0.4); if (m.on) { txt('17,6 km', m.x + 24, m.y, { size: 64, weight: 800, font: F.disp, alpha: a, color: C.acc2 }); txt('EN LÍNEA RECTA', m.x + 28, m.y + 40, { size: 22, weight: 600, track: 4, alpha: a * 0.8 }); } }
      kicker('A LOS PIES DEL VOLCÁN', 72, 1790, t, 0.6, 8.8, C.tx2);
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
    bgFilter: t => `blur(${(3 + 9 * ss(4.4, 6.0, t)).toFixed(1)}px) brightness(${(0.55 - 0.12 * ss(4.4, 6.0, t)).toFixed(2)}) saturate(0.9)`,
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
      const a2 = win(t, 5.5, 11.6, 0.6, 0.4);
      if (a2 > 0) {
        const cx = 540, cy = 860, R = 300, k = ease.out((t - 5.6) / 2.2), p = 0.94 * k;
        const c = DIR.ctx; c.save(); c.globalAlpha = a2; c.lineWidth = 26; c.lineCap = 'round';
        c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
        const g = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); g.addColorStop(0, C.acc2); g.addColorStop(1, C.acc);
        c.strokeStyle = g; c.shadowColor = C.acc; c.shadowBlur = 30; c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); c.stroke(); c.restore();
        txt(String(Math.round(94 * k)), cx - 20, cy + 70, { size: 230, weight: 800, font: F.disp, track: -8, align: 'center', alpha: a2 });
        txt('%', cx + 128, cy + 70, { size: 96, weight: 700, font: F.disp, alpha: a2 });
        kicker('PROBABILIDAD DE ERUPCIÓN', 72, 420, t, 5.8, 11.6);
        reveal('en los próximos 10 años', 72, 500, t, 6.0, 11.6, { size: 58, weight: 750, font: F.disp, track: -1 });
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


  // =================================================================== utilidades para las erupciones
  const M = () => DIR.M || { g: {}, s: [] };
  const meliG = () => M().g.meli || {}, meliS = () => (M().s || [])[0] || {};
  const fmtDur = sec => { if (!(sec >= 0)) return '—'; const m = Math.round(sec / 60); return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const fmtMM = mm => mm >= 10 ? `${(mm / 10).toFixed(mm >= 100 ? 0 : 1).replace('.', ',')} cm` : `${mm.toFixed(mm < 1 ? 1 : 0).replace('.', ',')} mm`;
  // tarjeta de dato: rótulo pequeño, cifra grande, explicación
  function dataCard(t, t0, t1, y, kick, value, sub, o = {}) {
    const a = win(t, t0, t1, 0.6, 0.45); if (a <= 0) return;
    const k = ease.outQ((t - t0) / 0.9), x = 64, w = o.w || 952, h = o.h || 250;
    glass(x, y + (1 - k) * 30, w, h, a, { r: 26 });
    const yy = y + (1 - k) * 30;
    const c = DIR.ctx; c.save(); c.globalAlpha = a; c.fillStyle = o.color || C.acc; c.fillRect(x + 34, yy + 40, 6, h - 80); c.restore();
    txt(kick, x + 66, yy + 66, { size: 24, weight: 650, track: 5, alpha: a * 0.9, color: o.color || C.acc2, shadow: false });
    txt(value, x + 62, yy + 162, { size: o.vsize || 96, weight: 800, font: F.disp, track: -2, alpha: a, shadow: false });
    if (sub) txt(sub, x + 66, yy + 212, { size: 28, weight: 500, alpha: a * 0.8, color: C.tx2, shadow: false });
  }
  const night = { sky: [[0, '#01030a'], [0.40, '#050c1c'], [0.47, '#16203a'], [0.495, '#3b3149'], [0.505, '#2a1f28'], [0.53, '#08080b'], [1, '#020203']], stars: 0.85, fog: '#141a2a', exp: 1.0 };
  const day = { sky: 'day', fog: '#bfd0de' };

  // =================================================================== CAPÍTULO 1 · ESTROMBOLIANA (escenario tipo 2008)
  DIR.shot('e1_title', {
    dur: 6, look: night, warm: 4,
    cam: [
      { t: 0, x: 0.03, y: 0, z: 3500, dist: 3.4, head: 105, pitch: 13, fov: 40 },
      { t: 6, x: 0.03, y: 0, z: 3500, dist: 2.9, head: 128, pitch: 15, fov: 40 },
    ],
    camEase: ease.sine,
    sim: t => 900 + t * 30, rate: () => 30,
    draw(t) {
      gradTop(0.4, 500); gradBot(0.85, 900); vignette(0.8);
      chapter(t, 0.5, 5.8, 'ESCENARIO 1 · 60 %', 'Estromboliana', 'La más probable · como en 2008', { y: 1400, size: 110 });
      hud(t, { clock: 900 + t * 30, rec: true });
      fadeIn(t, 0.25);
    },
  });
  DIR.shot('e1_lava', {
    dur: 6.5, look: night, warm: 3,
    cam: [
      { t: 0, x: -1.3, y: 0.1, dist: 6.5, head: 72, pitch: 20, fov: 38 },
      { t: 6.5, x: -1.6, y: -0.2, dist: 5.6, head: 92, pitch: 24, fov: 38 },
    ],
    camEase: ease.inOut,
    sim: t => 2400 + t * 900, rate: () => 900,
    draw(t) {
      gradTop(0.4, 500); gradBot(0.8, 800); vignette(0.8);
      const T = APP.totalsAt(2400 + t * 900);
      dataCard(t, 1.0, 6.3, 1170, 'LA LAVA SOBRE EL GLACIAR', `${((T.melt || 0) / 1e6).toFixed(2).replace('.', ',')} M m³`, 'de agua de deshielo · nacen los lahares', { vsize: 90 });
      hud(t, { clock: 2400 + t * 900, rec: true });
    },
  });
  DIR.shot('e1_meli', {
    dur: 6, look: night, warm: 3, roads: true,
    cam: [
      { t: 0, x: 2.4, y: -12.5, dist: 15, head: 340, pitch: 15, fov: 38 },
      { t: 6, x: 2.1, y: -11.0, dist: 17, head: 345, pitch: 17, fov: 38 },
    ],
    camEase: ease.sine,
    sim: t => 8000 + t * 600, rate: () => 600,
    draw(t) {
      gradTop(0.4, 500); gradBot(0.8, 800); vignette(0.8);
      place('Melipeuco', MELI[0], MELI[1], t, 0.3, 5.8, { size: 34, weight: 700 });
      const g = meliG(), sA = meliS();
      const lah = g.arr > 0 && g.maxH - 0 > 0.3;
      dataCard(t, 1.0, 5.8, 1130, 'EN MELIPEUCO', lah ? `Lahar ${g.maxH.toFixed(1).replace('.', ',')} m` : 'Sin lahar', lah ? `llega en ${fmtDur(g.arr)} al puente Allipén` : (sA.ash || 0) >= 0.5 ? `ceniza: ${fmtMM(sA.ash)} · riesgo bajo` : 'los lahares se quedan en las laderas', { color: lah ? C.red : C.ok });
      hud(t, { clock: 8000 + t * 600 });
      fadeOut(t, 6, 0.3);
    },
  });

  // =================================================================== CAPÍTULO 2 · EFUSIVA (escenario tipo 1751)
  let trLava = null;
  DIR.shot('e2_flow', {
    dur: 8, look: day, daylight: true, warm: 3,
    init() { trLava = DIR.trackFront('lava', 3600, 86400, 24); },
    cam: t => { const st = 3600 + (t / 8) * (86400 - 3600); const f = DIR.along(trLava, st) || { x: 3, y: -6 };
      const k = ease.sine(t / 8); return { x: lerp(1.2, f.x, 0.55), y: lerp(-2, f.y, 0.55), dist: lerp(15, 19, k), head: lerp(318, 330, k), pitch: lerp(30, 34, k), fov: 38 }; },
    sim: t => 3600 + (t / 8) * (86400 - 3600), rate: () => (86400 - 3600) / 8,
    draw(t) {
      gradTop(0.45, 520); gradBot(0.8, 800); vignette(0.75);
      chapter(t, 0.3, 4.2, 'ESCENARIO 2 · 25 %', 'Efusiva', 'Coladas de lava durante días', { y: 1400, size: 110 });
      const st = 3600 + (t / 8) * (86400 - 3600), f = DIR.along(trLava, st);
      if (f) { const dkm = Math.hypot(f.x - MELI[0], f.y - MELI[1]); dataCard(t, 4.4, 7.8, 1170, 'FRENTE DE LA LAVA', `a ${dkm.toFixed(1).replace('.', ',')} km`, 'de Melipeuco · avanza por el Truful-Truful', { vsize: 96 }); }
      place('Melipeuco', MELI[0], MELI[1], t, 0.5, 7.8, { size: 32, weight: 700 });
      hud(t, { clock: st, days: true, clockLabel: 'TIEMPO DE ERUPCIÓN' });
      fadeIn(t, 0.25); fadeOut(t, 8, 0.3);
    },
  });

  // =================================================================== CAPÍTULO 3 · SUBPLINIANA (escenario tipo 1640, viento hacia el SE)
  DIR.shot('e3_col', {
    dur: 7, look: { ...day, fogD: 1.1 }, warm: 4,
    cam: [
      { t: 0, x: 0, y: 0, z: 9000, dist: 46, head: 62, pitch: 4, fov: 40 },
      { t: 7, x: 0, y: 0, z: 10500, dist: 52, head: 72, pitch: 3, fov: 40 },
    ],
    camEase: ease.sine,
    sim: t => 1500 + t * 500, rate: () => 500,
    draw(t) {
      gradTop(0.35, 500); gradBot(0.8, 800); vignette(0.7);
      chapter(t, 0.3, 3.8, 'ESCENARIO 3 · 12 %', 'Subpliniana', 'Columna sostenida de ceniza', { y: 1400, size: 110 });
      const st = APP.src().at(1500 + t * 500), P = st.MER > 50 ? APP.src().plume(st.MER) : null;
      if (P) dataCard(t, 4.0, 6.8, 1170, 'ALTURA DE LA COLUMNA', `${(P.Ht / 1000).toFixed(1).replace('.', ',')} km`, 'sobre el nivel del mar · modelo de pluma con viento', { vsize: 100 });
      hud(t, { clock: 1500 + t * 500, rec: true });
      fadeIn(t, 0.25);
    },
  });
  DIR.shot('e3_ash', {
    dur: 6.5, look: day, overlay: 4, warm: 2, roads: true,
    cam: [
      { t: 0, x: 4, y: -9, dist: 44, head: 0, pitch: 72, fov: 38 },
      { t: 6.5, x: 4, y: -10, dist: 38, head: 6, pitch: 74, fov: 38 },
    ],
    camEase: ease.sine,
    sim: t => 14000, rate: () => 1,
    draw(t) {
      gradTop(0.5, 500); gradBot(0.6, 600); vignette(0.6);
      // leyenda de isópacas
      const a = win(t, 0.4, 6.3); const lx = 72, ly = 300; txt('CENIZA ACUMULADA', lx, ly, { size: 24, weight: 650, track: 5, alpha: a, color: C.acc2 });
      const c = DIR.ctx; const g = c.createLinearGradient(lx, 0, lx + 600, 0); ['#ffed8c', '#ff9e33', '#db3819', '#73091f'].forEach((col, i) => g.addColorStop(i / 3, col));
      c.save(); c.globalAlpha = a; c.fillStyle = g; rrect(lx, ly + 24, 600, 16, 8); c.fill(); c.restore();
      txt('0,1 mm', lx, ly + 76, { size: 22, weight: 500, font: F.mono, alpha: a * 0.8 }); txt('30 cm', lx + 600, ly + 76, { size: 22, weight: 500, font: F.mono, alpha: a * 0.8, align: 'right' });
      place('Melipeuco', MELI[0], MELI[1], t, 0.4, 6.3, { size: 34, weight: 750 });
      const sA = meliS();
      dataCard(t, 1.2, 6.3, 1170, 'CENIZA EN MELIPEUCO', fmtMM(sA.ash || 0), (sA.ash || 0) >= 100 ? 'techos livianos en riesgo de colapso' : (sA.ash || 0) >= 10 ? 'daño a cultivos, agua y vías · usar mascarilla' : 'molestias respiratorias · proteger el agua', { color: (sA.ash || 0) >= 100 ? C.red : C.acc });
      hud(t, {});
      fadeOut(t, 6.5, 0.3);
    },
  });

  // =================================================================== CAPÍTULO 4 · PLINIANA CON COLAPSO (peor caso)
  DIR.shot('e4_col', {
    dur: 6.5, look: { ...day, fogD: 1.1 }, warm: 4,
    cam: [
      { t: 0, x: 0.2, y: -0.3, dist: 12, head: 28, pitch: 9, fov: 42 },
      { t: 6.5, x: 0.2, y: -0.3, dist: 10, head: 44, pitch: 11, fov: 42 },
    ],
    camEase: ease.sine,
    sim: t => 300 + t * 260, rate: () => 260,
    draw(t) {
      gradTop(0.35, 500); gradBot(1.0, 1050); vignette(0.75);
      chapter(t, 0.3, 4.0, 'ESCENARIO 4 · 3 %', 'Pliniana', 'El peor caso: la columna colapsa', { y: 1400, size: 120, color: C.red });
      const st = APP.src().at(300 + t * 260), P = st.MER > 50 ? APP.src().plume(st.MER) : null;
      if (P) dataCard(t, 4.1, 6.3, 1170, 'COLUMNA ERUPTIVA', `${(P.Ht / 1000).toFixed(0)} km`, 'de altura · más alta que los aviones comerciales', { vsize: 100, color: C.red });
      hud(t, { clock: 300 + t * 260, rec: true });
      fadeIn(t, 0.25);
    },
  });
  DIR.shot('e4_pdc', {
    dur: 6, look: { ...day, fogD: 1.2 }, warm: 4,
    cam: [
      { t: 0, x: 0.8, y: -2.5, dist: 13, head: 335, pitch: 14, fov: 40 },
      { t: 6, x: 1.2, y: -3.6, dist: 11, head: 345, pitch: 16, fov: 40 },
    ],
    camEase: ease.inOut,
    sim: t => 1500 + t * 240, rate: () => 240,
    draw(t) {
      gradTop(0.4, 500); gradBot(0.8, 800); vignette(0.8);
      const T = APP.totalsAt(1500 + t * 240);
      dataCard(t, 0.8, 5.8, 1170, 'FLUJOS PIROCLÁSTICOS', '+100 km/h', 'gas y roca a cientos de °C bajan por las laderas', { vsize: 100, color: C.red });
      hud(t, { clock: 1500 + t * 240, rec: true });
    },
  });
  // datos del análisis del punto de control (analyze.py): frente del lahar hacia Melipeuco
  const VP = () => (window.VDATA && VDATA.pliniana) || { track: [], arr1: -1 };
  let trLah = null, tLah = [6000, 14000];
  const smooth = (tr, r = 3) => tr.map((p, i) => { let x = 0, y = 0, d = 0, w = 0; for (let k = -r; k <= r; k++) { const q = tr[Math.max(0, Math.min(tr.length - 1, i + k))]; x += q.x; y += q.y; d += q.d; w++; } return { t: p.t, x: x / w, y: y / w, d: d / w }; });
  const alongD = (tr, t) => { if (!tr || !tr.length) return null; if (t <= tr[0].t) return tr[0]; const L = tr[tr.length - 1]; if (t >= L.t) return L;
    let i = 0; while (tr[i + 1].t < t) i++; const a = tr[i], b = tr[i + 1], f = (t - a.t) / (b.t - a.t); return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), d: lerp(a.d, b.d, f) }; };
  DIR.shot('e4_lahar', {
    dur: 8, look: day, warm: 3, roads: true,
    init() { const V = VP(); tLah = [6000, (V.arr1 > 0 ? V.arr1 : 13600) + 240]; trLah = smooth(V.track.filter(p => p.t >= tLah[0] - 1200 && p.t <= tLah[1] + 1200), 3); },
    cam: t => { const st = lerp(tLah[0], tLah[1], t / 8), f = alongD(trLah, st) || { x: 5, y: -12 }, k = ease.inOut(t / 8);
      return { x: f.x, y: f.y, dist: lerp(7.0, 9.5, k), head: lerp(200, 214, k), pitch: lerp(27, 31, k), fov: 40 }; },
    sim: t => lerp(tLah[0], tLah[1], t / 8), rate: () => (tLah[1] - tLah[0]) / 8,
    draw(t) {
      gradTop(0.4, 500); gradBot(0.8, 800); vignette(0.75);
      const st = lerp(tLah[0], tLah[1], t / 8), f = alongD(trLah, st);
      kicker('LAHAR · FLUJO DE BARRO Y ROCAS', 72, 1160, t, 0.4, 8.2, C.acc2);
      if (f) { const dkm = Math.max(0.1, f.d), s1 = dkm < 1.05 ? 'a menos de 1 km' : `a ${dkm.toFixed(1).replace('.', ',')} km`;
        reveal(s1, 66, 1290, t, 0.6, 8.2, { size: dkm < 1.05 ? 96 : 120, weight: 800, font: F.disp, track: -3, color: dkm < 2 ? '#ff6a4d' : C.tx });
        reveal('de Melipeuco', 72, 1356, t, 0.8, 8.2, { size: 44, weight: 600, color: C.tx2 }); }
      place('Melipeuco', MELI[0], MELI[1], t, 0.3, 7.8, { size: 34, weight: 750 });
      hud(t, { clock: st, rec: true });
    },
  });
  DIR.shot('e4_arr', {
    dur: 7, look: day, overlay: 2, arrMax: 300, arrIso: 30, warm: 2, roads: true,
    cam: [
      { t: 0, x: 2.8, y: -8, dist: 38, head: 0, pitch: 70, fov: 38 },
      { t: 7, x: 3.6, y: -14.5, dist: 20, head: 4, pitch: 64, fov: 38 },
    ],
    camEase: ease.inOut,
    sim: () => DIR.M.tEnd - 60, rate: () => 1,
    draw(t) {
      gradTop(0.5, 500); gradBot(0.6, 700); vignette(0.6);
      const a = win(t, 0.3, 6.8); const lx = 72, ly = 300;
      txt('TIEMPO HASTA QUE LLEGA EL LAHAR', lx, ly, { size: 24, weight: 650, track: 4, alpha: a, color: C.acc2 });
      const c = DIR.ctx; const g = c.createLinearGradient(lx, 0, lx + 600, 0); ['#d9141a', '#f0a23a', '#fae566'].forEach((col, i) => g.addColorStop(i / 2, col));
      c.save(); c.globalAlpha = a; c.fillStyle = g; rrect(lx, ly + 24, 600, 16, 8); c.fill(); c.restore();
      txt('0', lx, ly + 76, { size: 22, weight: 500, font: F.mono, alpha: a * 0.8 }); txt('5 h', lx + 600, ly + 76, { size: 22, weight: 500, font: F.mono, alpha: a * 0.8, align: 'right' });
      txt('líneas cada 30 min', lx, ly + 112, { size: 22, weight: 500, alpha: a * 0.6 });
      const V = VP(), gt = M().g.truful || {};
      if (gt.arr > 0) pin(gt.x, gt.y, 'PUENTE TRUFUL-TRUFUL', `cortado a las ${fmtDur(gt.arr)}`, t, 1.2, 6.8, { len: 90, size: 34, subSize: 26, color: C.acc2, scolor: '#fff', align: 'left' });
      pin(MELI[0], MELI[1], 'MELIPEUCO', V.arr1 > 0 ? `a 1 km: ${fmtDur(V.arr1)}` : 'sin lahar', t, 2.4, 6.8, { len: 150, size: 44, subSize: 30, color: C.red, scolor: '#fff' });
      hud(t, {});
      fadeOut(t, 7, 0.3);
    },
  });

  // =================================================================== EVACUACIÓN
  DIR.shot('ev_meli', {
    dur: 13, look: { ...day, exp: 0.9 }, warm: 2, roads: true,
    cam: [
      { t: 0, x: 3.1, y: -17.6, dist: 5.5, head: 345, pitch: 30, fov: 40 },
      { t: 13, x: 3.1, y: -17.4, dist: 4.8, head: 0, pitch: 34, fov: 40 },
    ],
    camEase: ease.sine,
    sim: t => { const V = VP(); return (V.arr1 > 0 ? V.arr1 : 13600) + 1200 + t * 60; }, rate: () => 60,
    bgFilter: t => `blur(${(5 + 7 * ss(0.3, 2.0, t)).toFixed(1)}px) brightness(${(0.8 - 0.38 * ss(0.3, 2.0, t)).toFixed(2)}) saturate(0.9)`,
    draw(t) {
      vignette(0.9);
      const V = VP(), gt = M().g.truful || {}, sA = meliS(), c = DIR.ctx;
      const tArr = V.arr1 > 0 ? V.arr1 : 13600;
      kicker('MELIPEUCO · PEOR ESCENARIO', 72, 330, t, 0.4, 12.8);
      reveal('¿Cuánto tiempo', 66, 440, t, 0.6, 12.8, { size: 92, weight: 800, font: F.disp, track: -2 });
      reveal('hay para evacuar?', 66, 540, t, 0.8, 12.8, { size: 92, weight: 800, font: F.disp, track: -2 });
      // línea de tiempo vertical, proporcional al tiempo real de la simulación
      const y0 = 720, y1 = 1400, lx = 292, Y = s => y0 + (y1 - y0) * Math.min(1, s / tArr);
      const k = ease.inOut((t - 1.6) / 3.4), yk = lerp(y0, y1 + 40, k), a = win(t, 1.4, 12.8, 0.5, 0.5);
      if (a > 0) {
        c.save(); c.globalAlpha = a * 0.22; c.fillStyle = '#fff'; c.fillRect(lx - 2, y0, 4, y1 - y0); c.restore();
        c.save(); c.globalAlpha = a; const gr = c.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, C.acc2); gr.addColorStop(1, C.red); c.fillStyle = gr; c.fillRect(lx - 3, y0, 6, Math.max(0, Math.min(y1, yk) - y0)); c.restore();
        // franja de evacuación (aviso + preparación + traslado ≈ 40 min desde el inicio)
        const ev = 40 * 60, ke = ease.outQ((t - 5.4) / 1.2), eb = win(t, 5.4, 12.8, 0.5, 0.5);
        if (eb > 0) { c.save(); c.globalAlpha = eb; c.fillStyle = C.ok; c.shadowColor = C.ok; c.shadowBlur = 16; rrect(lx - 9, y0, 18, (Y(ev) - y0) * ke, 9); c.fill(); c.restore();
          txt('EVACUAR', lx - 34, Y(ev) * 0.5 + y0 * 0.5 + 2, { size: 22, weight: 700, track: 3, align: 'right', alpha: eb, color: C.ok });
          txt('~40 min', lx - 34, Y(ev) * 0.5 + y0 * 0.5 + 34, { size: 28, weight: 600, font: F.mono, align: 'right', alpha: eb, color: C.ok }); }
        const evs = [[0, 'Erupción', 'comienza la fase explosiva', C.tx]];
        if (sA.ashT > 0) evs.push([sA.ashT, 'Cae ceniza en el pueblo', `${fmtMM(sA.ash || 0)} acumulados en total`, C.tx]);
        if (gt.arr > 0) evs.push([gt.arr, 'Lahar corta el puente', 'Truful-Truful, camino S-51-R', C.acc2]);
        evs.push([tArr, 'El lahar llega a Melipeuco', V.h1 ? `barro de ${V.h1.toFixed(1).replace('.', ',')} m a 1 km del centro` : 'a 1 km del centro', '#ff6a4d']);
        evs.forEach(([ts, ti, sub, col]) => {
          const y = Y(ts), b = ss(y - 4, y + 30, yk) * a; if (b <= 0) return;
          const kk = ease.outQ((yk - y) / 120);
          c.save(); c.globalAlpha = b; c.fillStyle = col; c.beginPath(); c.arc(lx, y, 11, 0, 7); c.fill(); c.fillStyle = '#0b0d12'; c.beginPath(); c.arc(lx, y, 4.5, 0, 7); c.fill(); c.restore();
          const h = Math.floor(ts / 3600), m = Math.round((ts % 3600) / 60);
          txt(`${h}:${String(m).padStart(2, '0')}`, lx - 34, y + 12, { size: 36, weight: 700, font: F.mono, align: 'right', alpha: b, color: col });
          txt(ti, lx + 38 + (1 - kk) * 20, y + 4, { size: 38, weight: 750, font: F.disp, alpha: b * kk, color: col === C.tx ? C.tx : col });
          txt(sub, lx + 40 + (1 - kk) * 20, y + 44, { size: 27, weight: 500, alpha: b * kk * 0.8, color: C.tx2 });
        });
        txt('HORAS DESDE EL INICIO', 72, y0 - 56, { size: 20, weight: 650, track: 4, alpha: a * 0.6 });
        const margin = Math.round((tArr - 40 * 60) / 60);
        const mh = margin >= 90 ? `~${Math.floor(margin / 60)} h ${String(Math.round((margin % 60) / 5) * 5).padStart(2, '0')} min`.replace(' 00 min', ' h').replace(' h h', ' h') : `${margin} min`;
        reveal(`Margen: ${mh}`, 66, 1560, t, 7.6, 12.8, { size: 84, weight: 800, font: F.disp, track: -2, color: C.ok });
        reveal('solo si se evacúa al primer aviso, sin esperar a ver el lahar', 72, 1620, t, 8.0, 12.8, { size: 30, weight: 500, color: C.tx });
        reveal('Etapas estimadas: aviso 10 · preparación 10 · traslado a pie a zona alta 20 min', 72, 1690, t, 8.6, 12.8, { size: 22, weight: 500, color: C.tx3 });
      }
      hud(t, {});
      fadeIn(t, 0.25); fadeOut(t, 13, 0.35);
    },
  });

  // =================================================================== 99 · CIERRE
  DIR.shot('s99_end', {
    dur: 10, hour: 20.2,
    look: { sky: 'dusk', fog: '#c4957c', fogD: 0.85, exp: 1.3 },
    cam: [
      { t: 0, x: 2.4, y: -12.5, dist: 14, head: 338, pitch: 17, fov: 38 },
      { t: 10, x: 1.4, y: -7.5, dist: 33, head: 344, pitch: 21, fov: 38 },
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
