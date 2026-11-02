// Gráficos livianos en canvas (series de tiempo)
export function fmtT(s) {
  s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}:${String(m).padStart(2, '0')}`;
}
function prep(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  const W = Math.max(10, r.width), H = Math.max(10, r.height);
  if (cv.width !== Math.round(W * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, W, H);
  return { c, W, H };
}
// series: [{data:[[t,v]], color, label, axis:0|1}], opts: {tMax, y0max, y1max, unit0, unit1, log0}
export function lineChart(cv, series, opts = {}) {
  if (!cv.offsetParent) return;
  const { c, W, H } = prep(cv);
  const L = 34, R = opts.unit1 ? 34 : 8, T = 8, B = 18, pw = W - L - R, ph = H - T - B;
  const tMax = Math.max(opts.tMax || 1, 60);
  const ax = [0, 1].map(a => { let m = opts['y' + a + 'max'] || 0; for (const s of series) if ((s.axis || 0) === a) for (const p of s.data) m = Math.max(m, p[1]); return m > 0 ? m * 1.1 : 1; });
  c.font = '10px ui-monospace,monospace'; c.fillStyle = '#6b7783'; c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = T + ph * i / 4; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke();
    c.textAlign = 'right'; c.fillText(fmtN(ax[0] * (1 - i / 4)), L - 4, y + 3); if (opts.unit1) { c.textAlign = 'left'; c.fillText(fmtN(ax[1] * (1 - i / 4)), L + pw + 4, y + 3); } }
  c.textAlign = 'center'; for (let i = 0; i <= 4; i++) c.fillText(fmtT(tMax * i / 4), L + pw * i / 4, H - 5);
  for (const s of series) {
    const m = ax[s.axis || 0]; c.strokeStyle = s.color; c.lineWidth = 1.6; c.beginPath(); let first = true;
    for (const [t, v] of s.data) { const x = L + pw * t / tMax, y = T + ph * (1 - v / m); if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y); }
    c.stroke();
  }
  if (opts.tNow != null) { const x = L + pw * Math.min(1, opts.tNow / tMax); c.strokeStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); }
  // leyenda
  let lx = L + 6; c.textAlign = 'left';
  for (const s of series) { if (!s.label) continue; c.fillStyle = s.color; c.fillRect(lx, T + 3, 8, 3); c.fillStyle = '#9aa6b2'; c.fillText(s.label, lx + 11, T + 8); lx += c.measureText(s.label).width + 22; }
}
export function fmtN(v) { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2); }
export function barChart(cv, bars, opts = {}) {
  if (!cv.offsetParent) return;
  const { c, W, H } = prep(cv);
  const L = 8, B = 18, T = 14, pw = W - 16, ph = H - T - B, n = bars.length, bw = pw / n;
  const m = Math.max(...bars.map(b => b.v), 1e-9);
  c.font = '10px ui-monospace,monospace'; c.textAlign = 'center';
  bars.forEach((b, i) => { const h = ph * b.v / m; c.fillStyle = b.color || '#ff6a2b'; c.fillRect(L + i * bw + 4, T + ph - h, bw - 8, h); c.fillStyle = '#9aa6b2'; c.fillText(b.label, L + i * bw + bw / 2, H - 5); c.fillStyle = '#e8ecf0'; c.fillText(b.txt || '', L + i * bw + bw / 2, T + ph - h - 3); });
}
export function histChart(cv, cat, onPick) {
  if (!cv.offsetParent) return;
  const { c, W, H } = prep(cv);
  const L = 22, R = 8, T = 10, B = 18, pw = W - L - R, ph = H - T - B, y0 = 1630, y1 = 2030;
  const X = y => L + pw * (y - y0) / (y1 - y0), Y = v => T + ph * (1 - v / 5);
  c.font = '10px ui-monospace,monospace'; c.fillStyle = '#6b7783'; c.strokeStyle = 'rgba(255,255,255,.07)';
  for (let v = 1; v <= 5; v++) { c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(L + pw, Y(v)); c.stroke(); c.textAlign = 'right'; c.fillText(v, L - 4, Y(v) + 3); }
  c.textAlign = 'center'; for (let y = 1650; y <= 2025; y += 75) c.fillText(y, X(y), H - 5);
  for (const e of cat) { c.fillStyle = e.big ? '#ff6a2b' : '#c48d52'; const x = X(e.y); c.fillRect(x - 1.5, Y(e.vei), 3, ph - (Y(e.vei) - T)); c.beginPath(); c.arc(x, Y(e.vei), e.big ? 4 : 2.5, 0, 7); c.fill(); }
  c.fillStyle = '#4fa3e0'; c.fillRect(X(2026) - 1, T, 2, ph); c.fillStyle = '#9aa6b2'; c.textAlign = 'right'; c.fillText('hoy', X(2026) - 4, T + 8);
}
