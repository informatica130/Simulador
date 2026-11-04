// =====================================================================
//  Director de video (lado del navegador): cámara por fotogramas clave,
//  composición del cuadro y gráficos en movimiento dibujados en Canvas 2D.
//  Se inyecta en la página del simulador junto con shim.js.
// =====================================================================
(() => {
  const W = () => innerWidth, H = () => innerHeight;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ss = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = {
    inOut: t => (t = clamp(t), t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: t => 1 - Math.pow(1 - clamp(t), 3),
    outQ: t => 1 - Math.pow(1 - clamp(t), 5),
    in: t => Math.pow(clamp(t), 3),
    sine: t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t)),
    lin: t => clamp(t),
  };
  // aparición/desaparición de un elemento entre t0 y t1 (s), con rampas
  const win = (t, t0, t1, rin = 0.6, rout = 0.5) => ss(t0, t0 + rin, t) * (1 - ss(t1 - rout, t1, t));

  const C = {
    acc: '#ff5a1f', acc2: '#ffb15c', red: '#ff3b2f', tx: '#f4f6f8', tx2: 'rgba(235,240,245,0.72)', tx3: 'rgba(235,240,245,0.5)',
    blue: '#7cc4ff', mud: '#d9a066', pdc: '#c79bff', ash: '#c9c3b8', ok: '#49d18a', glass: 'rgba(10,13,18,0.58)',
  };
  const F = { disp: '"Inter Display", Inter, sans-serif', ui: 'Inter, sans-serif', mono: '"JetBrains Mono", monospace' };

  // ------------------------------------------------------------ cámara
  // Rig: objetivo en el terreno (x este, y norte, km), distancia (km), rumbo hacia donde mira (°), inclinación bajo el horizonte (°)
  function camPose(k) {
    const A = APP, ex = A.S.ex;
    const tz = (k.z != null ? k.z : A.hAt(k.x, k.y) + (k.dz || 0)) / 1000 * ex;
    const h = k.head * Math.PI / 180, p = k.pitch * Math.PI / 180;
    const dir = [Math.sin(h) * Math.cos(p), -Math.sin(p), -Math.cos(h) * Math.cos(p)];
    const T = [k.x, tz, -k.y];
    return { T, P: [T[0] - dir[0] * k.dist, T[1] - dir[1] * k.dist, T[2] - dir[2] * k.dist] };
  }
  // interpola entre fotogramas clave [{t, x, y, dist, head, pitch, dz, fov}] con Catmull-Rom suavizado
  function camAt(keys, t, e = ease.inOut) {
    if (keys.length === 1) return keys[0];
    const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
    const u = e((t - t0) / (t1 - t0)) * (t1 - t0) + t0;
    let i = 0; while (i < keys.length - 2 && u > keys[i + 1].t) i++;
    const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1], d = keys[Math.min(keys.length - 1, i + 2)];
    const f = clamp((u - b.t) / (c.t - b.t));
    const cr = (p0, p1, p2, p3, s) => 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);
    const o = {};
    for (const key of ['x', 'y', 'dist', 'head', 'pitch', 'dz', 'fov']) {
      const g = q => q[key] != null ? q[key] : (key === 'dz' ? 0 : key === 'fov' ? 40 : b[key]);
      o[key] = key === 'dist' ? Math.exp(cr(Math.log(g(a)), Math.log(g(b)), Math.log(g(c)), Math.log(g(d)), f)) : cr(g(a), g(b), g(c), g(d), f);
    }
    return o;
  }
  function applyCam(k) {
    const A = APP, { T, P } = camPose(k);
    A.controls.target.set(...T); A.camera.position.set(...P);
    if (k.fov && Math.abs(A.camera.fov - k.fov) > 1e-3) { A.camera.fov = k.fov; A.camera.updateProjectionMatrix(); }
    A.camera.lookAt(...T);
  }
  // proyección de un punto del terreno (x, y km; dz m sobre el suelo) a píxeles
  const _v = { x: 0, y: 0, z: 0 };
  function proj(x, y, dz = 0, zAbs = null) {
    const A = APP, ex = A.S.ex, cam = A.camera;
    const z = (zAbs != null ? zAbs : A.hAt(x, y) + dz) / 1000 * ex;
    const v = cam.position.clone().set(x, z, -y).project(cam);
    return { x: (v.x + 1) / 2 * W(), y: (1 - v.y) / 2 * H(), on: v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3, depth: v.z };
  }

  // ------------------------------------------------------------ primitivas 2D
  let ctx = null;
  function setCtx(c) { ctx = c; }
  function txt(s, x, y, o = {}) {
    const a = o.alpha ?? 1; if (a <= 0.003) return 0;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `${o.italic ? 'italic ' : ''}${o.weight || 600} ${o.size || 40}px ${o.font || F.ui}`;
    ctx.letterSpacing = (o.track || 0) + 'px';
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    if (o.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = o.shadowBlur ?? 18; ctx.shadowOffsetY = 2; }
    ctx.fillStyle = o.color || C.tx;
    ctx.fillText(s, x, y);
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  }
  function measure(s, o = {}) { ctx.save(); ctx.font = `${o.weight || 600} ${o.size || 40}px ${o.font || F.ui}`; ctx.letterSpacing = (o.track || 0) + 'px'; const w = ctx.measureText(s).width; ctx.restore(); return w; }
  // texto que aparece subiendo y con desenfoque (reveal)
  function reveal(s, x, y, t, t0, t1, o = {}) {
    const a = win(t, t0, t1, o.rin ?? 0.7, o.rout ?? 0.5); if (a <= 0) return;
    const k = ease.outQ((t - t0) / (o.rin ?? 0.7));
    const dy = (1 - k) * (o.rise ?? 26);
    ctx.save(); if (k < 1) ctx.filter = `blur(${((1 - k) * 8).toFixed(2)}px)`;
    txt(s, x, y + dy, { ...o, alpha: a * (o.alpha ?? 1) });
    ctx.restore();
  }
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  // tarjeta de vidrio: desenfoca el fondo bajo ella
  function glass(x, y, w, h, a = 1, o = {}) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    rrect(x, y, w, h, o.r ?? 22); ctx.clip();
    if (DIR.bg) { ctx.filter = 'blur(26px) brightness(0.7) saturate(1.1)'; ctx.drawImage(DIR.bg, x - 40, y - 40, w + 80, h + 80, x - 40, y - 40, w + 80, h + 80); ctx.filter = 'none'; }
    ctx.fillStyle = o.fill || 'rgba(12,15,20,0.5)'; ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = a * 0.9; rrect(x + 0.5, y + 0.5, w - 1, h - 1, o.r ?? 22); ctx.strokeStyle = o.stroke || 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  }
  function line(pts, o = {}) {
    if (pts.length < 2) return; ctx.save(); ctx.globalAlpha = o.alpha ?? 1; ctx.strokeStyle = o.color || C.tx; ctx.lineWidth = o.w || 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (o.dash) ctx.setLineDash(o.dash); if (o.glow) { ctx.shadowColor = o.color; ctx.shadowBlur = o.glow; }
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.restore();
  }
  // trazo parcial de una polilínea (0..1)
  function partial(pts, f) {
    if (f >= 1) return pts; if (f <= 0) return pts.slice(0, 1);
    let L = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); L += d; }
    let tgt = L * f; const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) { if (tgt >= seg[i - 1]) { out.push(pts[i]); tgt -= seg[i - 1]; } else { const k = tgt / seg[i - 1]; out.push({ x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) }); break; } }
    return out;
  }
  // pin geolocalizado: punto con pulso, línea vertical y rótulo
  function pin(x, y, label, sub, t, t0, t1, o = {}) {
    const a = win(t, t0, t1, 0.5, 0.4); if (a <= 0) return;
    const g = proj(x, y, 0), top = proj(x, y, o.hgt ?? 0);
    if (!g.on) return;
    const col = o.color || C.tx, L = (o.len ?? 150) * ease.out((t - t0) / 0.8);
    ctx.save(); ctx.globalAlpha = a;
    // pulso
    const ph = ((t - t0) % 1.6) / 1.6;
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.globalAlpha = a * (1 - ph) * 0.8; ctx.beginPath(); ctx.arc(g.x, g.y, 8 + ph * 34, 0, 7); ctx.stroke();
    ctx.globalAlpha = a; ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(g.x, g.y, 7, 0, 7); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(g.x, g.y - 9); ctx.lineTo(g.x, g.y - L); ctx.stroke();
    ctx.restore();
    const side = o.align || 'center', lx = g.x + (side === 'left' ? -4 : side === 'right' ? 4 : 0);
    const k = ease.outQ((t - t0 - 0.35) / 0.6);
    txt(label, lx, g.y - L - 18 - (sub ? 44 : 0) + (1 - k) * 14, { size: o.size || 44, weight: 750, font: F.disp, align: side === 'left' ? 'right' : side === 'right' ? 'left' : 'center', alpha: a * k, track: 1.5, color: o.lcolor || C.tx });
    if (sub) txt(sub, lx, g.y - L - 20 + (1 - k) * 14, { size: o.subSize || 30, weight: 500, font: F.mono, align: side === 'left' ? 'right' : side === 'right' ? 'left' : 'center', alpha: a * k * 0.9, color: o.scolor || C.tx2 });
  }
  // ruta sobre el terreno entre dos puntos (muestreada) proyectada
  function groundPath(a, b, n = 40, dz = 30) { const o = []; for (let i = 0; i <= n; i++) { const f = i / n; const p = proj(lerp(a[0], b[0], f), lerp(a[1], b[1], f), dz); o.push(p); } return o; }

  // ------------------------------------------------------------ elementos de identidad
  function vignette(s = 1) {
    const w = W(), h = H();
    const g = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.25, w / 2, h * 0.5, h * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.55 * s})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  function gradTop(a = 0.6, hh = 520) { const g = ctx.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W(), hh); }
  function gradBot(a = 0.7, hh = 760) { const h = H(), g = ctx.createLinearGradient(0, h - hh, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, h - hh, W(), hh); }
  function shade(a) { if (a <= 0) return; ctx.fillStyle = `rgba(4,6,9,${a})`; ctx.fillRect(0, 0, W(), H()); }
  // marca discreta arriba a la izquierda + reloj de simulación
  function hud(t, o = {}) {
    const a = o.alpha ?? 1; if (a <= 0) return;
    const x = 64, y = 108;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = C.acc; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 13, y - 22); ctx.lineTo(x + 26, y); ctx.closePath(); ctx.fill(); ctx.restore();
    txt('LLAIMA 3D', x + 40, y, { size: 26, weight: 700, track: 5, alpha: a * 0.95 });
    txt('SIMULACIÓN FÍSICA', x + 40, y + 32, { size: 19, weight: 500, track: 3.2, alpha: a * 0.6, font: F.ui });
    if (o.clock != null) {
      const s = Math.max(0, Math.floor(o.clock)), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60);
      const str = o.days ? `DÍA ${Math.floor(s / 86400) + 1} · ${String(Math.floor(s % 86400 / 3600)).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : `T+${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      txt(str, W() - 64, y, { size: 34, weight: 600, font: F.mono, align: 'right', alpha: a });
      txt(o.clockLabel || 'DESDE EL INICIO', W() - 64, y + 32, { size: 18, weight: 500, align: 'right', track: 3, alpha: a * 0.6 });
    }
    if (o.rec) { const blink = 0.55 + 0.45 * Math.cos(t * 4); ctx.save(); ctx.globalAlpha = a * blink; ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(W() - 64 - (o.clock != null ? 280 : 0) - 10, y - 11, 8, 0, 7); ctx.fill(); ctx.restore(); }
  }
  // título de capítulo
  function chapter(t, t0, t1, num, title, sub, o = {}) {
    const a = win(t, t0, t1, 0.8, 0.6); if (a <= 0) return;
    const y = o.y ?? H() * 0.70, x = 72;
    const k = ease.outQ((t - t0) / 0.9);
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = o.color || C.acc; ctx.fillRect(x, y - 150, 90 * k, 5); ctx.restore();
    reveal(num, x, y - 100, t, t0 + 0.05, t1, { size: 28, weight: 650, track: 6, color: o.color || C.acc, font: F.ui });
    reveal(title, x - 4, y, t, t0 + 0.15, t1, { size: o.size || 104, weight: 800, font: F.disp, track: -1 });
    if (sub) reveal(sub, x, y + 64, t, t0 + 0.3, t1, { size: 36, weight: 500, color: C.tx2, font: F.ui });
  }
  // cifra grande con etiqueta (data card)
  function stat(t, t0, t1, x, y, value, unit, label, o = {}) {
    const a = win(t, t0, t1, 0.6, 0.5); if (a <= 0) return;
    const k = ease.outQ((t - t0) / 0.8);
    const v = typeof value === 'number' ? (o.fmt ? o.fmt(value * (o.count === false ? 1 : k)) : Math.round(value * k).toString()) : value;
    const w = txt(v, x, y + (1 - k) * 20, { size: o.size || 150, weight: 800, font: F.disp, track: -3, alpha: a, color: o.color || C.tx, align: o.align });
    if (unit) txt(unit, (o.align === 'center' ? x + w / 2 : x + w) + 12, y + (1 - k) * 20, { size: (o.size || 150) * 0.36, weight: 650, font: F.disp, alpha: a, color: o.ucolor || o.color || C.tx });
    if (label) txt(label, o.align === 'center' ? x : x + 4, y + 60, { size: o.lsize || 32, weight: 500, alpha: a * 0.8, color: C.tx2, align: o.align, track: 0.5 });
  }

  window.DIR = { clamp, lerp, ss, ease, win, C, F, camPose, camAt, applyCam, proj, setCtx, txt, measure, reveal, rrect, glass, line, partial, pin, groundPath, vignette, gradTop, gradBot, shade, hud, chapter, stat, bg: null, get ctx() { return ctx; } };

  // ------------------------------------------------------------ «look» por toma: cielo en degradado, niebla, exposición
  const SKIES = {
    dusk: [[0, '#0a1530'], [0.30, '#1c3864'], [0.44, '#6e7d9e'], [0.49, '#e3a27c'], [0.505, '#d39878'], [0.56, '#3a3532'], [1, '#141210']],
    golden: [[0, '#1a3060'], [0.34, '#4a6a9c'], [0.46, '#b9b3b0'], [0.495, '#f4c08e'], [0.52, '#b98c6c'], [1, '#2a2622']],
    day: [[0, '#173f86'], [0.30, '#3f76bf'], [0.45, '#9dbcdc'], [0.50, '#d6e2ea'], [0.53, '#9aa6ad'], [1, '#404850']],
    night: [[0, '#010207'], [0.40, '#050912'], [0.49, '#0d1424'], [0.52, '#07090d'], [1, '#020203']],
    ash: [[0, '#2a2a2c'], [0.40, '#57524c'], [0.49, '#8a7f72'], [0.53, '#5a524a'], [1, '#1c1a18']],
  };
  function skyTex(stops) {
    const c = document.createElement('canvas'); c.width = 8; c.height = 1024; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 1024); for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr; g.fillRect(0, 0, 8, 1024);
    // grano leve para evitar bandas
    const id = g.getImageData(0, 0, 8, 1024); for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 3; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } g.putImageData(id, 0, 0);
    const T = DIR.THREE, tex = new T.CanvasTexture(c); tex.mapping = T.EquirectangularReflectionMapping; tex.colorSpace = T.SRGBColorSpace; tex.magFilter = T.LinearFilter; return tex;
  }
  const texCache = {};
  function applyLook(L) {
    const A = APP, sh = A.terr.shared;
    if (L.sky) { const key = typeof L.sky === 'string' ? L.sky : JSON.stringify(L.sky); texCache[key] = texCache[key] || skyTex(typeof L.sky === 'string' ? SKIES[L.sky] : L.sky); A.sky.visible = false; A.scene.background = texCache[key]; }
    if (L.stars != null) A.stars.material.opacity = L.stars;
    if (L.fog) sh.uFogCol.value.set(L.fog);
    if (L.fogD != null) sh.uFogD.value *= L.fogD;
    if (L.exp != null) A.renderer.toneMappingExposure *= L.exp;
    if (L.haze != null) sh.uAshHaze && (sh.uAshHaze.value = L.haze);
  }
  async function ensure() {
    if (!DIR.THREE) DIR.THREE = await import('three');
    const A = APP; if (A.composer.__hooked) return;
    const orig = A.composer.render.bind(A.composer);
    A.composer.render = (...a) => { const L = typeof DIR.look === 'function' ? DIR.look(DIR.t || 0) : DIR.look; if (L) applyLook(L); return orig(...a); };
    A.composer.__hooked = true;
  }
  Object.assign(window.DIR, { SKIES, applyLook, ensure, look: null });
})();
