// =====================================================================
//  Tomas del video «¿Y si el Llaima despertara?» (9:16, 24 fps) · v2
//  Cámara de dron (trayectorias libres con deriva y alabeo), textos
//  grandes y pocos (la locución cuenta el resto).
//  Zona segura para redes: textos entre y≈260 y y≈1600, x 64–1016.
// =====================================================================
(() => {
  const { C, F, ease, win, ss, lerp, clamp, txt, reveal, pin, chapter, vignette, gradTop, gradBot, shade, glass, line, partial, groundPath, proj, measure, rrect, drone, pathAt } = DIR;
  const MELI = [3.09, -17.37], CRATER = [0.03, 0.0], BRIDGE = [6.54, -15.84];
  const W = 1080, H = 1920;

  // ------------------------------------------------------------ composición
  const fadeIn = (t, d = 0.6) => shade(1 - ss(0, d, t));
  const fadeOut = (t, dur, d = 0.6) => shade(ss(dur - d, dur, t));
  const kicker = (s, x, y, t, t0, t1, col = C.acc2) => reveal(s, x, y, t, t0, t1, { size: 40, weight: 700, track: 6, color: col });
  // reloj de simulación (único elemento fijo en las tomas de erupción)
  function clock(t, sec, o = {}) {
    const a = o.alpha ?? 1; if (a <= 0) return;
    const s = Math.max(0, Math.floor(sec)), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60);
    const str = o.days ? `DÍA ${Math.floor(s / 86400) + 1} · ${String(Math.floor(s % 86400 / 3600)).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : `${hh}:${String(mm).padStart(2, '0')}`;
    const c = DIR.ctx, x = W - 64, y = 150;
    if (o.rec !== false) { const blink = 0.55 + 0.45 * Math.cos(t * 4); c.save(); c.globalAlpha = a * blink; c.fillStyle = C.red; c.beginPath(); c.arc(x - measure(str, { size: 58, weight: 700, font: F.mono }) - 30, y - 19, 11, 0, 7); c.fill(); c.restore(); }
    txt(str, x, y, { size: 58, weight: 700, font: F.mono, align: 'right', alpha: a });
    txt(o.label || 'HORAS DESDE EL INICIO', x, y + 48, { size: 30, weight: 650, align: 'right', track: 3, alpha: a * 0.75 });
  }
  // cifra protagonista sin tarjeta
  function big(t, t0, t1, value, label, y, o = {}) {
    const a = win(t, t0, t1, 0.55, 0.45); if (a <= 0) return;
    const k = ease.outQ((t - t0) / 0.9);
    if (o.kick) txt(o.kick, 70, y - (o.size || 190) * 0.86 - 10 + (1 - k) * 20, { size: 40, weight: 700, track: 6, alpha: a, color: o.color || C.acc2 });
    reveal(value, 62, y, t, t0, t1, { size: o.size || 190, weight: 800, font: F.disp, track: -6, color: o.vcolor || '#fff' });
    if (label) reveal(label, 70, y + (o.lgap || 76), t, t0 + 0.15, t1, { size: o.lsize || 54, weight: 650, font: F.disp, color: o.lcolor || C.tx });
  }
  // tarjeta de dato grande
  function card(t, t0, t1, y, kick, value, sub, o = {}) {
    const a = win(t, t0, t1, 0.6, 0.45); if (a <= 0) return;
    const k = ease.outQ((t - t0) / 0.9), x = 56, w = 968, h = sub ? 330 : 260, yy = y + (1 - k) * 30;
    glass(x, yy, w, h, a, { r: 30 });
    const c = DIR.ctx; c.save(); c.globalAlpha = a; c.fillStyle = o.color || C.acc; c.fillRect(x + 36, yy + 44, 8, h - 88); c.restore();
    txt(kick, x + 74, yy + 84, { size: 36, weight: 700, track: 4, alpha: a, color: o.color || C.acc2, shadow: false });
    txt(value, x + 68, yy + 200, { size: o.vsize || 120, weight: 800, font: F.disp, track: -3, alpha: a, shadow: false });
    if (sub) txt(sub, x + 74, yy + 278, { size: 42, weight: 550, alpha: a * 0.9, color: C.tx, shadow: false });
  }
  // rótulo de lugar sobre el terreno
  function place(name, x, y, t, t0, t1, o = {}) {
    const a = win(t, t0, t1, 0.5, 0.4); if (a <= 0) return; const p = proj(x, y, o.dz ?? 0); if (!p.on) return;
    const c = DIR.ctx; c.save(); c.globalAlpha = a; c.fillStyle = o.color || '#fff'; c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 10; c.beginPath(); c.arc(p.x, p.y, 9, 0, 7); c.fill(); c.restore();
    txt(name, p.x + (o.dx ?? 22), p.y + (o.dy ?? 14), { size: o.size || 48, weight: 750, font: F.disp, alpha: a, align: o.align || 'left', color: o.color || '#fff', track: 1 });
  }
  const orbit = (cx, cy, R, az0, az1, z, dur, look, o = {}) => drone([0, 0.5, 1].map(f => { const az = (lerp(az0, az1, f)) * Math.PI / 180; return { t: f * dur, x: cx + R * Math.sin(az), y: cy + R * Math.cos(az), z: typeof z === 'function' ? z(f) : z, ...look, fov: o.fov ?? 40 }; }), o);
  const night = { sky: [[0, '#01030a'], [0.40, '#050c1c'], [0.47, '#16203a'], [0.495, '#3b3149'], [0.505, '#2a1f28'], [0.53, '#08080b'], [1, '#020203']], stars: 0.85, fog: '#141a2a', exp: 1.0 };
  const day = { sky: 'day', fog: '#bfd0de' };
  const golden = { sky: 'golden', fog: '#d7ab8a', fogD: 0.9, exp: 1.15 };

  // =================================================================== INTRO
  DIR.shot('a_title', {
    dur: 4.2, hour: 19.85, look: golden,
    init() { APP.S.fumQ = 2.0; },
    cam: null, mk() { return drone([
      { t: 0, x: 6.2, y: -12.2, a: 260, lx: 0.03, ly: 0, la: -2600, fov: 42 },
      { t: 4.2, x: 4.4, y: -8.3, a: 700, lx: 0.03, ly: 0, la: -2200, fov: 40 },
    ], { ease: ease.lin, shake: 7 }); },
    sim: t => 600 + t * 10,
    draw(t) {
      gradTop(0.45, 480); gradBot(0.85, 1100); vignette(0.8);
      reveal('¿Y si el', 66, 1330, t, 1.0, 9, { size: 120, weight: 800, font: F.disp, track: -2 });
      reveal('Llaima', 58, 1490, t, 1.25, 9, { size: 180, weight: 800, font: F.disp, track: -5 });
      reveal('despertara?', 66, 1620, t, 1.5, 9, { size: 120, weight: 800, font: F.disp, track: -2 });
      fadeIn(t, 1.2);
    },
  });
  DIR.shot('a_orbit', {
    dur: 4.0, hour: 19.9, look: golden,
    mk() { return orbit(0.03, 0, 10.5, 202, 230, 4300, 4.0, { lx: 0.03, ly: 0, la: -2200 }, { ease: ease.lin, fov: 40, shake: 5 }); },
    sim: t => 650 + t * 10,
    draw(t) {
      gradTop(0.4, 480); gradBot(1.0, 1250); vignette(0.8);
      // el título sigue en pantalla desde la toma anterior y se despide
      const a = 1 - ss(2.6, 3.6, t);
      txt('¿Y si el', 66, 1330, { size: 120, weight: 800, font: F.disp, track: -2, alpha: a });
      txt('Llaima', 58, 1490, { size: 180, weight: 800, font: F.disp, track: -5, alpha: a });
      txt('despertara?', 66, 1620, { size: 120, weight: 800, font: F.disp, track: -2, alpha: a });
    },
  });
  DIR.shot('a_meli', {
    dur: 6.5, hour: 19.95, roads: true, look: { ...golden, exp: 1.2 },
    mk() { return drone([
      { t: 0, x: 3.5, y: -20.6, a: 650, lx: 2.4, ly: -13.5, la: -300, fov: 46 },
      { t: 6.5, x: 3.45, y: -19.9, a: 1050, lx: 2.2, ly: -12.5, la: -200, fov: 46 },
    ], { ease: ease.sine, shake: 6 }); },
    sim: t => 900 + t * 10,
    draw(t) {
      gradTop(0.55, 600); gradBot(0.75, 700); vignette(0.7);
      const path = groundPath(MELI, CRATER, 60, 60), f = ease.inOut((t - 2.4) / 2.0);
      if (t > 2.4) line(partial(path.slice(6), f), { color: C.acc2, w: 6, dash: [3, 16], alpha: win(t, 2.4, 6.3, 0.3, 0.4), glow: 8 });
      pin(MELI[0], MELI[1], 'MELIPEUCO', null, t, 0.6, 6.3, { len: 120, size: 64 });
      big(t, 3.0, 6.3, '17 km', 'del cráter', 1420, { size: 170, kick: 'A LOS PIES DEL VOLCÁN' });
    },
  });

  // =================================================================== HISTORIA Y PROBABILIDAD (fondo desenfocado)
  const CAT = window.VCAT || [];
  DIR.shot('a_hist', {
    dur: 11.5, hour: 13, look: day,
    mk() { return drone([{ t: 0, x: 3.0, y: -9, z: 14000, lx: 0.5, ly: -1, la: 0, fov: 40 }, { t: 11.5, x: 2.0, y: -7.5, z: 12000, lx: 0.3, ly: -0.5, la: 0, fov: 40 }], { ease: ease.lin, shake: 0 }); },
    sim: t => 1200 + t * 10,
    bgFilter: t => `blur(${(4 + 8 * ss(4.8, 6.2, t)).toFixed(1)}px) brightness(${(0.55 - 0.12 * ss(4.8, 6.2, t)).toFixed(2)}) saturate(0.9)`,
    draw(t) {
      vignette(1);
      const x0 = 96, x1 = 984, yb = 900, X = y => x0 + (x1 - x0) * (y - 1640) / (2026 - 1640);
      const a1 = win(t, 0.3, 6.2, 0.6, 0.6), sweep = x0 + (x1 - x0) * ease.inOut((t - 0.8) / 3.4);
      const cnt = CAT.filter(e => X(e.y) < sweep).length;
      if (a1 > 0) {
        txt(String(cnt), 62, 640, { size: 260, weight: 800, font: F.disp, track: -8, alpha: a1 });
        txt('erupciones', 70, 730, { size: 76, weight: 750, font: F.disp, alpha: a1 });
        txt('desde 1640', 70, 812, { size: 56, weight: 600, font: F.disp, alpha: a1 * 0.8 });
        const c = DIR.ctx; c.save(); c.globalAlpha = a1 * 0.35; c.fillStyle = '#fff'; c.fillRect(x0, yb + 120, x1 - x0, 3); c.restore();
        for (const [yr, lab] of [[1650, '1650'], [1800, '1800'], [1950, '1950']]) txt(lab, X(yr), yb + 186, { size: 40, weight: 650, font: F.mono, align: 'center', alpha: a1 * 0.8 });
        for (const e of CAT) {
          const px = X(e.y); if (sweep < px) continue;
          const r = [0, 7, 9, 15, 22][e.vei] || 8, big3 = e.vei >= 3;
          c.save(); c.globalAlpha = a1 * (big3 ? 0.95 : 0.6); c.fillStyle = big3 ? C.acc : '#fff'; c.beginPath(); c.arc(px, yb + 112 - r, r, 0, 7); c.fill(); c.restore();
        }
      }
      const a2 = win(t, 5.6, 11.6, 0.6, 0.4);
      if (a2 > 0) {
        const cx = 540, cy = 900, R = 320, k = ease.out((t - 5.7) / 2.2), p = 0.94 * k;
        const c = DIR.ctx; c.save(); c.globalAlpha = a2; c.lineWidth = 34; c.lineCap = 'round';
        c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
        const g = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); g.addColorStop(0, C.acc2); g.addColorStop(1, C.acc);
        c.strokeStyle = g; c.shadowColor = C.acc; c.shadowBlur = 34; c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); c.stroke(); c.restore();
        txt(String(Math.round(94 * k)), cx - 24, cy + 80, { size: 250, weight: 800, font: F.disp, track: -8, align: 'center', alpha: a2 });
        txt('%', cx + 140, cy + 80, { size: 104, weight: 700, font: F.disp, alpha: a2 });
        reveal('Probabilidad de erupción', 66, 430, t, 5.9, 11.6, { size: 64, weight: 750, font: F.disp, track: -1, color: C.acc2 });
        reveal('en los próximos 10 años', 66, 510, t, 6.1, 11.6, { size: 64, weight: 750, font: F.disp, track: -1 });
      }
      fadeIn(t, 0.4); fadeOut(t, 11.5, 0.3);
    },
  });
  const TYPES = [
    { n: 'Estromboliana', p: 60, c: '#ffb15c' },
    { n: 'Efusiva', p: 25, c: '#ff8a3d' },
    { n: 'Subpliniana', p: 12, c: '#ff5a1f' },
    { n: 'Pliniana', p: 3, c: '#e8202a' },
  ];
  DIR.shot('a_types', {
    dur: 8.2, hour: 13, look: day,
    mk() { return orbit(0.03, 0, 9, 20, 50, 4200, 8.2, { lx: 0.03, ly: 0, la: 0 }, { ease: ease.lin, shake: 0 }); },
    sim: t => 1500 + t * 10,
    bgFilter: () => 'blur(14px) brightness(0.42) saturate(0.9)',
    draw(t) {
      vignette(1);
      reveal('¿Qué tipo', 66, 430, t, 0.3, 8.0, { size: 100, weight: 800, font: F.disp, track: -2 });
      reveal('de erupción?', 66, 540, t, 0.45, 8.0, { size: 100, weight: 800, font: F.disp, track: -2 });
      TYPES.forEach((ty, i) => {
        const t0 = 1.2 + i * 0.5, y = 780 + i * 200, a = win(t, t0, 8.0, 0.5, 0.4); if (a <= 0) return;
        const k = ease.outQ((t - t0 - 0.15) / 1.4), bw = 936 * ty.p / 60 * k;
        txt(ty.n, 70, y, { size: 66, weight: 750, font: F.disp, alpha: a });
        txt(Math.round(ty.p * k) + ' %', 1010, y, { size: 70, weight: 800, font: F.disp, align: 'right', alpha: a, color: ty.c });
        const c = DIR.ctx; c.save(); c.globalAlpha = a * 0.16; c.fillStyle = '#fff'; rrect(72, y + 34, 936, 26, 13); c.fill();
        c.globalAlpha = a; c.fillStyle = ty.c; c.shadowColor = ty.c; c.shadowBlur = 20; rrect(72, y + 34, Math.max(26, bw), 26, 13); c.fill(); c.restore();
      });
      reveal('4 escenarios simulados', 66, 1640, t, 4.4, 8.0, { size: 60, weight: 750, font: F.disp, color: C.acc2 });
      fadeIn(t, 0.3); fadeOut(t, 8.2, 0.3);
    },
  });

  // =================================================================== utilidades de erupción
  const M = () => DIR.M || { g: {}, s: [] };
  const meliG = () => M().g.meli || {}, meliS = () => (M().s || [])[0] || {};
  const fmtDur = sec => { if (!(sec >= 0)) return '—'; const m = Math.round(sec / 60); return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const fmtMM = mm => mm >= 10 ? `${(mm / 10).toFixed(mm >= 100 ? 0 : 1).replace('.', ',')} cm` : `${mm.toFixed(1).replace('.', ',')} mm`;
  const chap = (t, num, title, col, t1 = 4.4) => chapter(t, 0.25, t1, num, title, null, { y: 1500, size: 130, color: col });

  // =================================================================== 1 · ESTROMBOLIANA (como 2008, de noche)
  const N1 = { look: night, glowK: 0.4, bloomK: 0.5, glowSize: 0.4, haloK: 0.15, ventK: 0.45, volGlowK: 0.35 };
  DIR.shot('e1_a', {
    dur: 4.5, ...N1, warm: 4,
    mk() { return drone([
      { t: 0, x: 3.0, y: -8.0, a: 450, lx: 0.03, ly: 0, la: 300, fov: 40 },
      { t: 4.5, x: 1.7, y: -4.4, a: 800, lx: 0.03, ly: 0, la: 350, fov: 40 },
    ], { ease: ease.lin, shake: 6 }); },
    sim: t => 880 + t * 30, rate: () => 30,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.85, 900); vignette(0.8);
      chap(t, '60 % · LA MÁS PROBABLE', 'Estromboliana', C.acc, 4.6);
      clock(t, 880 + t * 30);
      fadeIn(t, 0.2);
    },
  });
  DIR.shot('e1_b', {
    dur: 4.5, ...N1, warm: 4,
    mk() { return orbit(0.03, 0, 2.4, 140, 185, 3500, 4.5, { lx: 0.03, ly: 0, la: 250 }, { ease: ease.lin, fov: 42, shake: 5 }); },
    sim: t => 1015 + t * 30, rate: () => 30,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.6, 700); vignette(0.8);
      big(t, 0.4, 4.4, 'Como en 2008', null, 1560, { size: 110 });
      clock(t, 1015 + t * 30);
    },
  });
  DIR.shot('e1_lava', {
    dur: 6.8, ...N1, warm: 3,
    mk() { return drone([
      { t: 0, x: -2.6, y: -2.6, z: 6400, lx: -0.7, ly: 0.05, la: 0, fov: 42 },
      { t: 6.8, x: -2.1, y: -2.0, z: 5300, lx: -0.6, ly: 0.05, la: 0, fov: 42 },
    ], { ease: ease.sine, shake: 5 }); },
    sim: t => 2400 + t * 900, rate: () => 900,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.8, 800); vignette(0.8);
      const T = APP.totalsAt(2400 + t * 900), mm3 = (T.melt || 0) / 1e6;
      big(t, 1.0, 6.6, `${mm3.toFixed(1).replace('.', ',')} millones`, 'de m³ de agua de deshielo', 1460, { size: 130, kick: 'LA LAVA DERRITE EL HIELO' });
      clock(t, 2400 + t * 900);
    },
  });
  DIR.shot('e1_meli', {
    dur: 6.3, look: { ...night, exp: 1.45 }, glowK: 0.5, bloomK: 0.55, glowSize: 0.7, haloK: 0.3, ventK: 0.6, warm: 3, roads: true,
    mk() { return drone([
      { t: 0, x: 3.45, y: -19.6, a: 220, lx: 1.4, ly: -7, la: 500, fov: 44 },
      { t: 6.3, x: 3.3, y: -18.8, a: 480, lx: 1.2, ly: -6, la: 500, fov: 44 },
    ], { ease: ease.sine, shake: 6 }); },
    sim: t => 8000 + t * 600, rate: () => 600,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.8, 800); vignette(0.8);
      place('Melipeuco', MELI[0], MELI[1], t, 0.3, 6.1, { size: 52 });
      const g = meliG(), lah = g.arr > 0 && g.maxH > 0.3;
      card(t, 1.0, 6.1, 1200, 'EN MELIPEUCO', lah ? `Lahar de ${g.maxH.toFixed(1).replace('.', ',')} m` : 'Sin lahar', null, { color: lah ? C.red : C.ok, vsize: 130 });
      clock(t, 8000 + t * 600);
      fadeOut(t, 6.3, 0.3);
    },
  });

  // =================================================================== 2 · EFUSIVA (tipo 1751)
  let trLava = null, LF = null;
  const E2 = { look: { ...night, exp: 1.3 }, hour: 20.6, warm: 3, glowK: 0.5, bloomK: 0.6, glowSize: 0.6, haloK: 0.3, ventK: 0.5, volGlowK: 0.6 };
  const lavaFront = () => { trLava = trLava || DIR.trackFront('lava', 1200, 21600, 24); return trLava; };
  DIR.shot('e2_a', {
    dur: 4.0, ...E2,
    mk() { const tr = lavaFront(); LF = tr[tr.length - 1] || { x: 2, y: -3.4 };
      return drone([
        { t: 0, x: -1.6, y: -4.6, a: 900, lx: 1.4, ly: -2.4, la: 0, fov: 42 },
        { t: 4.0, x: -0.7, y: -5.4, a: 800, lx: 1.8, ly: -3.0, la: 0, fov: 42 },
      ], { ease: ease.lin, shake: 6 }); },
    sim: t => 1200 + t * 2400, rate: () => 2400,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.85, 900); vignette(0.75);
      chap(t, '25 %', 'Efusiva', C.acc2, 4.1);
      clock(t, 1200 + t * 2400, { days: true, label: 'TIEMPO DE ERUPCIÓN', rec: false });
      fadeIn(t, 0.2);
    },
  });
  DIR.shot('e2_b', {
    dur: 3.6, ...E2,
    mk() { const tr = lavaFront(), f = tr[tr.length - 1] || { x: 2, y: -3.4 };
      return drone([
        { t: 0, x: f.x + 2.6, y: f.y - 2.4, a: 950, lx: f.x - 0.2, ly: f.y + 0.6, la: 0, fov: 42 },
        { t: 3.6, x: f.x + 2.0, y: f.y - 1.8, a: 800, lx: f.x - 0.3, ly: f.y + 0.8, la: 0, fov: 42 },
      ], { ease: ease.sine, shake: 7 }); },
    sim: t => 10800 + t * 3000, rate: () => 3000,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.85, 900); vignette(0.75);
      const f = DIR.along(lavaFront(), 10800 + t * 3000);
      if (f) big(t, 0.3, 3.5, `a ${Math.round(Math.hypot(f.x - MELI[0], f.y - MELI[1]))} km`, 'de Melipeuco', 1500, { size: 170, kick: 'FRENTE DE LAVA' });
      clock(t, 10800 + t * 3000, { days: true, label: 'TIEMPO DE ERUPCIÓN', rec: false });
      fadeOut(t, 3.6, 0.25);
    },
  });

  // =================================================================== 3 · SUBPLINIANA (tipo 1640)
  const plumeH = st => { const s = APP.src().at(st); return s && s.MER > 50 ? APP.src().plume(s.MER).Ht : 0; };
  DIR.shot('e3_a', {
    dur: 5.5, look: { ...day, fogD: 1.1 }, warm: 4, glowSize: 0.55, haloK: 0.4,
    mk() { return drone([
      { t: 0, x: 2.6, y: -8.6, a: 450, lx: 0.03, ly: 0, la: 100, fov: 48 },
      { t: 5.5, x: 2.2, y: -7.4, a: 1200, lx: 0.3, ly: 0, la: 1200, fov: 48 },
    ], { ease: ease.inOut, shake: 7 }); },
    sim: t => 1500 + t * 400, rate: () => 400,
    draw(t) {
      gradTop(0.35, 480); gradBot(0.95, 1000); vignette(0.75);
      chap(t, '12 %', 'Subpliniana', C.acc, 5.4);
      clock(t, 1500 + t * 400);
      fadeIn(t, 0.2);
    },
  });
  DIR.shot('e3_b', {
    dur: 6.0, look: { ...day, fogD: 1.0 }, warm: 4, glowSize: 0.7,
    mk() { return orbit(1.5, 0, 15, 196, 226, 4200, 6.0, { lx: 2.5, ly: 0, la: 4500 }, { ease: ease.lin, fov: 40, shake: 5 }); },
    sim: t => 3700 + t * 400, rate: () => 400,
    draw(t) {
      gradTop(0.35, 480); gradBot(0.9, 1000); vignette(0.75);
      const Ht = plumeH(3700 + t * 400);
      if (Ht) big(t, 0.6, 5.8, `${Math.round(Ht / 1000)} km`, 'de altura', 1500, { size: 200, kick: 'COLUMNA DE CENIZA' });
      clock(t, 3700 + t * 400);
    },
  });
  DIR.shot('e3_ash', { noVol: true,
    dur: 6.5, look: day, overlay: 4, bgFilter: () => 'brightness(0.86) contrast(1.12) saturate(1.1)', warm: 2, roads: true,
    mk() { return drone([
      { t: 0, x: 4.4, y: -24.5, z: 36000, lx: 4.6, ly: -8.5, la: 0, fov: 38 },
      { t: 6.5, x: 3.8, y: -25.0, z: 24000, lx: 3.6, ly: -13.0, la: 0, fov: 38 },
    ], { ease: ease.sine, shake: 0 }); },
    sim: () => 14000, rate: () => 1,
    draw(t) {
      gradTop(0.8, 560); gradBot(0.75, 760); vignette(0.6);
      reveal('Ceniza acumulada', 66, 330, t, 0.3, 6.3, { size: 64, weight: 750, font: F.disp, color: C.acc2 });
      place('Melipeuco', MELI[0], MELI[1], t, 0.6, 6.3, { size: 54 });
      const sA = meliS();
      big(t, 1.2, 6.3, fmtMM(sA.ash || 0), 'de ceniza en Melipeuco', 1660, { size: 190 });
      fadeOut(t, 6.5, 0.3);
    },
  });

  // =================================================================== 4 · PLINIANA (peor caso)
  DIR.shot('e4_a', {
    dur: 4.6, look: { ...day, fogD: 1.1 }, warm: 4, glowSize: 0.55, haloK: 0.4,
    mk() { return drone([
      { t: 0, x: 2.2, y: -6.8, a: 520, lx: 0.03, ly: 0, la: 200, fov: 48 },
      { t: 4.6, x: 1.3, y: -4.2, a: 700, lx: 0.03, ly: 0, la: 900, fov: 48 },
    ], { ease: ease.inOut, shake: 9, bank: 1.4 }); },
    sim: t => 300 + t * 160, rate: () => 160,
    draw(t) {
      gradTop(0.35, 480); gradBot(1.0, 1050); vignette(0.75);
      chap(t, '3 % · EL PEOR CASO', 'Pliniana', C.red, 4.7);
      clock(t, 300 + t * 160);
      fadeIn(t, 0.2);
    },
  });
  DIR.shot('e4_b', {
    dur: 4.8, look: { ...day, fogD: 1.1 }, warm: 4, glowSize: 0.55, haloK: 0.4,
    mk() { return drone([
      { t: 0, x: 6.0, y: -6.8, z: 3300, lx: 0.2, ly: -0.1, lz: 4300, fov: 50 },
      { t: 4.8, x: 7.2, y: -4.9, z: 3600, lx: 0.3, ly: -0.1, lz: 4800, fov: 50 },
    ], { ease: ease.inOut, shake: 6 }); },
    sim: t => 1040 + t * 100, rate: () => 100,
    draw(t) {
      gradTop(0.35, 480); gradBot(0.9, 1000); vignette(0.75);
      const Ht = plumeH(1040 + t * 100);
      if (Ht) big(t, 0.5, 4.7, `${Math.round(Ht / 1000)} km`, 'de columna eruptiva', 1500, { size: 200, vcolor: '#fff', kick: 'MÁS ALTA QUE UN AVIÓN', color: C.red });
      clock(t, 1040 + t * 100);
    },
  });
  DIR.shot('e4_pdc', {
    dur: 6.5, look: { ...day, fogD: 1.2 }, warm: 4, glowSize: 0.55, haloK: 0.4,
    mk() { return orbit(0.5, -0.8, 8.5, 158, 192, 3300, 6.5, { lx: 0.6, ly: -1.4, la: 500 }, { ease: ease.lin, fov: 42, shake: 7 }); },
    sim: t => 1500 + t * 220, rate: () => 220,
    draw(t) {
      gradTop(0.4, 480); gradBot(1.0, 1150); vignette(0.8);
      big(t, 0.6, 6.3, '+100 km/h', 'flujos piroclásticos', 1500, { size: 170, kick: 'LA COLUMNA COLAPSA', color: C.red });
      clock(t, 1500 + t * 220);
    },
  });
  // frente del lahar (analyze.py → VDATA.pliniana.track)
  const VP = () => (window.VDATA && VDATA.pliniana) || { track: [], arr1: -1 };
  const smooth = (tr, r = 3) => tr.map((p, i) => { let x = 0, y = 0, d = 0, w = 0; for (let k = -r; k <= r; k++) { const q = tr[Math.max(0, Math.min(tr.length - 1, i + k))]; x += q.x; y += q.y; d += q.d; w++; } return { t: p.t, x: x / w, y: y / w, d: d / w }; });
  let TRL = null;
  const lahTrack = () => (TRL = TRL || smooth(VP().track, 4));
  const front = t => { const tr = lahTrack(); if (!tr.length) return { x: 6, y: -14, d: 5 }; if (t <= tr[0].t) return tr[0]; const L = tr[tr.length - 1]; if (t >= L.t) return L;
    let i = 0; while (tr[i + 1].t < t) i++; const a = tr[i], b = tr[i + 1], f = (t - a.t) / (b.t - a.t); return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), d: lerp(a.d, b.d, f) }; };
  // persecución del frente: cámara detrás y arriba, mirando por delante (con deriva de dron)
  function chase(simT, o) {
    return t => {
      const st = simT(t), f = front(st), g = front(st + 900), dx = g.x - f.x, dy = g.y - f.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const back = o.back(t), side = o.side ? o.side(t) : 0, A = APP;
      const px = f.x - ux * back + uy * side, py = f.y - uy * back - ux * side;
      const n = (k) => Math.sin(t * 0.7 + k) * 0.5 + Math.sin(t * 1.6 + k * 2) * 0.3;
      const pz = Math.max(A.hAt(px, py) + o.alt(t) + n(1) * 8, A.hAt(px, py) + 60);
      const lx = o.lookTo ? lerp(f.x + ux * o.ahead, o.lookTo[0], o.lk(t)) : f.x + ux * o.ahead, ly = o.lookTo ? lerp(f.y + uy * o.ahead, o.lookTo[1], o.lk(t)) : f.y + uy * o.ahead;
      const lz = A.hAt(lx, ly);
      return { P: [px + n(2) * 0.006, pz / 1000 * A.S.ex, -(py + n(3) * 0.006)], L: [lx, lz / 1000 * A.S.ex, -ly], fov: o.fov || 44, roll: n(4) * 0.6 };
    };
  }
  let tBr = 10021;
  DIR.shot('e4_lah_a', {
    dur: 4.6, look: day, warm: 3, roads: true,
    mk() { tBr = (M().g.truful || {}).arr > 0 ? M().g.truful.arr : 10021;
      return chase(t => lerp(6200, tBr - 700, t / 4.6), { back: t => lerp(1.0, 0.75, t / 4.6), alt: t => lerp(360, 260, t / 4.6), ahead: 0.35, fov: 46 }); },
    sim: t => lerp(6200, tBr - 700, t / 4.6), rate: () => (tBr - 700 - 6200) / 4.6,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.85, 900); vignette(0.75);
      const f = front(lerp(6200, tBr - 700, t / 4.6));
      big(t, 0.3, 4.5, `a ${f.d.toFixed(0)} km`, 'de Melipeuco', 1500, { size: 190, kick: 'LAHAR', color: C.acc2 });
      clock(t, lerp(6200, tBr - 700, t / 4.6));
    },
  });
  DIR.shot('e4_bridge', {
    dur: 4.4, look: day, warm: 3, roads: true,
    mk() { return orbit(BRIDGE[0], BRIDGE[1], 1.5, 300, 338, z => APP.hAt(BRIDGE[0], BRIDGE[1]) + lerp(380, 300, z), 4.4, { lx: BRIDGE[0], ly: BRIDGE[1], la: 0 }, { ease: ease.lin, fov: 44, shake: 6 }); },
    sim: t => tBr - 500 + t * 230, rate: () => 230,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.85, 900); vignette(0.75);
      place('Puente', BRIDGE[0], BRIDGE[1], t, 0.3, 4.2, { size: 50, color: C.acc2 });
      big(t, 1.0, 4.3, fmtDur(tBr).replace(' min', ''), 'puente cortado', 1500, { size: 190, kick: 'CAMINO A MELIPEUCO', color: C.acc2 });
      clock(t, tBr - 500 + t * 230);
    },
  });
  let tA1 = 13616;
  DIR.shot('e4_lah_b', {
    dur: 5.4, look: day, warm: 3, roads: true,
    mk() { tA1 = VP().arr1 > 0 ? VP().arr1 : 13616;
      return chase(t => lerp(tBr + 400, tA1 + 200, t / 5.4), { back: t => 1.3, side: t => lerp(0.4, -0.2, t / 5.4), alt: t => lerp(300, 520, t / 5.4), ahead: 1.2, lookTo: MELI, lk: t => ss(0.5, 4.5, t) * 0.8, fov: 46 }); },
    sim: t => lerp(tBr + 400, tA1 + 200, t / 5.4), rate: () => (tA1 + 200 - tBr - 400) / 5.4,
    draw(t) {
      gradTop(0.4, 480); gradBot(0.85, 900); vignette(0.75);
      place('Melipeuco', MELI[0], MELI[1], t, 0.3, 5.3, { size: 52 });
      big(t, 1.6, 5.3, fmtDur(tA1).replace(' min', ''), 'a 1 km del pueblo', 1500, { size: 190, kick: 'EL LAHAR LLEGA', color: C.red, vcolor: '#ff6a4d' });
      clock(t, lerp(tBr + 400, tA1 + 200, t / 5.4));
    },
  });
  DIR.shot('e4_arr', { noVol: true,
    dur: 5.0, look: day, overlay: 2, arrMax: 300, arrIso: 30, warm: 2, roads: true,
    mk() { return drone([
      { t: 0, x: 4.4, y: -26.0, z: 30000, lx: 4.0, ly: -8.5, la: 0, fov: 38 },
      { t: 5.0, x: 3.9, y: -24.0, z: 17000, lx: 3.7, ly: -13.0, la: 0, fov: 38 },
    ], { ease: ease.sine, shake: 0 }); },
    sim: () => DIR.M.tEnd - 60, rate: () => 1,
    draw(t) {
      gradTop(0.8, 560); gradBot(0.6, 700); vignette(0.6);
      const a = win(t, 0.3, 4.8);
      reveal('Tiempo de llegada', 66, 330, t, 0.3, 4.8, { size: 64, weight: 750, font: F.disp, color: C.acc2 });
      reveal('del lahar', 66, 406, t, 0.4, 4.8, { size: 64, weight: 750, font: F.disp });
      const lx = 70, ly = 470, c = DIR.ctx, g = c.createLinearGradient(lx, 0, lx + 700, 0); ['#d9141a', '#f0a23a', '#fae566'].forEach((col, i) => g.addColorStop(i / 2, col));
      c.save(); c.globalAlpha = a; c.fillStyle = g; rrect(lx, ly, 700, 24, 12); c.fill(); c.restore();
      txt('0 h', lx, ly + 76, { size: 42, weight: 700, font: F.mono, alpha: a }); txt('5 h', lx + 700, ly + 76, { size: 42, weight: 700, font: F.mono, alpha: a, align: 'right' });
      place('Melipeuco', MELI[0], MELI[1], t, 1.0, 4.8, { size: 54 });
      fadeOut(t, 5.0, 0.3);
    },
  });

  // =================================================================== EVACUACIÓN
  DIR.shot('ev_meli', {
    dur: 8.4, look: { ...day, exp: 0.9 }, warm: 2, roads: true,
    mk() { return orbit(3.1, -17.4, 4.0, 160, 190, z => APP.hAt(3.1, -17.4) + 1600, 8.4, { lx: 3.1, ly: -17.4, la: 0 }, { ease: ease.lin, shake: 0 }); },
    sim: t => { const V = VP(); return (V.arr1 > 0 ? V.arr1 : 13600) + 1200 + t * 60; }, rate: () => 60,
    bgFilter: t => `blur(${(5 + 8 * ss(0.2, 1.6, t)).toFixed(1)}px) brightness(${(0.8 - 0.42 * ss(0.2, 1.6, t)).toFixed(2)}) saturate(0.9)`,
    draw(t) {
      vignette(0.9);
      const V = VP(), gt = M().g.truful || {}, c = DIR.ctx, tArr = V.arr1 > 0 ? V.arr1 : 13600;
      reveal('¿Cuánto tiempo', 62, 420, t, 0.3, 8.2, { size: 104, weight: 800, font: F.disp, track: -2 });
      reveal('hay para evacuar?', 62, 530, t, 0.45, 8.2, { size: 104, weight: 800, font: F.disp, track: -2 });
      const y0 = 700, y1 = 1300, lx = 250, Y = s => y0 + (y1 - y0) * Math.min(1, s / tArr);
      const k = ease.inOut((t - 1.0) / 2.6), yk = lerp(y0, y1 + 40, k), a = win(t, 0.9, 8.2, 0.5, 0.5);
      if (a > 0) {
        c.save(); c.globalAlpha = a * 0.22; c.fillStyle = '#fff'; c.fillRect(lx - 3, y0, 6, y1 - y0); c.restore();
        c.save(); c.globalAlpha = a; const gr = c.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, C.ok); gr.addColorStop(0.5, C.acc2); gr.addColorStop(1, C.red); c.fillStyle = gr; c.fillRect(lx - 4, y0, 8, Math.max(0, Math.min(y1, yk) - y0)); c.restore();
        const evs = [[0, 'Erupción', C.tx], [gt.arr > 0 ? gt.arr : 10021, 'Puente cortado', C.acc2], [tArr, 'Lahar en el pueblo', '#ff6a4d']];
        evs.forEach(([ts, ti, col]) => {
          const y = Y(ts), b = ss(y - 4, y + 30, yk) * a; if (b <= 0) return;
          const kk = ease.outQ((yk - y) / 120);
          c.save(); c.globalAlpha = b; c.fillStyle = col; c.beginPath(); c.arc(lx, y, 16, 0, 7); c.fill(); c.fillStyle = '#0b0d12'; c.beginPath(); c.arc(lx, y, 6, 0, 7); c.fill(); c.restore();
          const h = Math.floor(ts / 3600), m = Math.round((ts % 3600) / 60);
          txt(`${h}:${String(m).padStart(2, '0')}`, lx - 40, y + 18, { size: 54, weight: 700, font: F.mono, align: 'right', alpha: b, color: col });
          txt(ti, lx + 44 + (1 - kk) * 20, y + 18, { size: 58, weight: 750, font: F.disp, alpha: b * kk, color: col });
        });
        const margin = Math.round((tArr - 40 * 60) / 60), mh = `${Math.floor(margin / 60)} h`;
        reveal('Margen:', 62, 1480, t, 3.6, 8.2, { size: 70, weight: 750, font: F.disp, color: C.ok });
        reveal(`casi ${mh}`, 58, 1630, t, 3.8, 8.2, { size: 160, weight: 800, font: F.disp, track: -4, color: C.ok });
        reveal('si se sale al primer aviso', 66, 1710, t, 4.4, 8.2, { size: 52, weight: 650, font: F.disp });
      }
      fadeIn(t, 0.25); fadeOut(t, 8.4, 0.3);
    },
  });

  // =================================================================== CIERRE
  DIR.shot('z_end', {
    dur: 7.5, hour: 20.2, look: { sky: 'dusk', fog: '#c4957c', fogD: 0.85, exp: 1.3 },
    mk() { return drone([
      { t: 0, x: 3.3, y: -18.6, a: 250, lx: 0.03, ly: 0, la: -3600, fov: 44 },
      { t: 7.5, x: 3.7, y: -22.0, a: 1000, lx: 0.03, ly: 0, la: -3600, fov: 40 },
    ], { ease: ease.inOut, shake: 6 }); },
    sim: t => 2400 + t * 10,
    draw(t) {
      gradTop(0.5, 600); gradBot(0.9, 1200); vignette(0.9);
      kicker('HOY EL LLAIMA ESTÁ EN CALMA', 70, 1250, t, 0.6, 7.3);
      reveal('Conoce tu', 62, 1390, t, 1.0, 7.3, { size: 124, weight: 800, font: F.disp, track: -2 });
      reveal('zona segura.', 58, 1520, t, 1.3, 7.3, { size: 124, weight: 800, font: F.disp, track: -2 });
      const a = win(t, 2.6, 8, 0.8, 0.5);
      txt('Simulación educativa · no reemplaza', 70, 1640, { size: 36, weight: 550, alpha: a * 0.85 });
      txt('a SERNAGEOMIN ni a SENAPRED', 70, 1688, { size: 36, weight: 550, alpha: a * 0.85 });
      fadeIn(t, 0.3); fadeOut(t, 7.5, 1.4);
    },
  });
})();
