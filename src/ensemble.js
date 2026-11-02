// =====================================================================
//  Análisis probabilístico (Monte Carlo sobre un árbol de eventos).
//  Cada miembro muestrea: estilo eruptivo según la frecuencia histórica,
//  ubicación de la boca (cumbre / Pichillaima / fisura de flanco NNE-SSO),
//  tasas (log-normales), mes (nieve), viento (climatología). Se corre el
//  mismo motor físico a 120 m y se acumula la frecuencia de excedencia:
//  lahar > 0,5 m, lava, CDP > 0,3 m, ceniza > 10 mm.
// =====================================================================
import * as THREE from 'three';
import { Solver } from './solver.js';
import { Runner } from './runner.js';
import { EruptionSource } from './eruption.js';
import { WIND_CLIM, VENTS } from './config.js';

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = r => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const logn = (r, med, dex) => med * Math.pow(10, gauss(r) * dex);

export const STYLES = [
  { k: 'est', name: 'Estromboliana (IEV 1–2)', p: 0.60 },
  { k: 'eff', name: 'Efusiva con fuentes (IEV 2–3)', p: 0.25 },
  { k: 'sub', name: 'Subpliniana (IEV 3–4)', p: 0.12 },
  { k: 'pli', name: 'Pliniana con colapso (IEV 4+)', p: 0.03 },
];

export function sampleMember(r, hAt) {
  let u = r(), st = STYLES[0]; for (const s of STYLES) { if (u < s.p) { st = s; break; } u -= s.p; }
  // boca
  let vents, vk;
  const v = r();
  if (v < 0.70) { const a = r() * 6.283, d = r() * 0.3; vents = [{ x: VENTS.crater.x + Math.sin(a) * d, y: VENTS.crater.y + Math.cos(a) * d, r: 0.15 }]; vk = 'Cumbre'; }
  else if (v < 0.82) { vents = [{ x: VENTS.pichi.x, y: VENTS.pichi.y, r: 0.15 }]; vk = 'Pichillaima'; }
  else {
    const az = (r() < 0.5 ? 20 : 200) + gauss(r) * 25, d = 1.5 + r() * 4, a = az * Math.PI / 180;
    const cx = Math.sin(a) * d, cy = Math.cos(a) * d; const len = 0.6 + r() * 1.2; vents = [];
    for (let i = 0; i < 3; i++) { const s = (i / 2 - 0.5) * len; vents.push({ x: cx + Math.sin(a) * s, y: cy + Math.cos(a) * s, r: 0.1 }); }
    vk = 'Fisura de flanco';
  }
  const phases = [];
  if (st.k === 'est') { const dur = 120 + r() * 1300; phases.push({ t0: 0, t1: dur, MER: logn(r, 1.5e5, 0.45), fountain: 150 + r() * 500, ballistic: 0.6, pulse: true }); if (r() < 0.7) phases.push({ t0: 10, t1: dur * (1 + r()), E: logn(r, 25, 0.35) }); }
  else if (st.k === 'eff') { const dur = 1440 + r() * 4320; phases.push({ t0: 0, t1: 300 + r() * 600, MER: logn(r, 3e5, 0.4), fountain: 300 + r() * 600, ballistic: 0.5, pulse: true }); phases.push({ t0: 5, t1: dur, E: logn(r, 90, 0.35) }); }
  else if (st.k === 'sub') { const dur = 180 + r() * 600; phases.push({ t0: 0, t1: dur, MER: logn(r, 6e6, 0.35), ballistic: 1, collapse: r() < 0.5 ? r() * 0.12 : 0 }); if (r() < 0.5) phases.push({ t0: 60, t1: dur * 3, E: logn(r, 30, 0.3) }); }
  else { const dur = 120 + r() * 300; phases.push({ t0: 0, t1: dur, MER: logn(r, 4e7, 0.3), ballistic: 1, collapse: 0.1 + r() * 0.25 }); }
  // viento
  let w = r(), wt = WIND_CLIM[0]; for (const c of WIND_CLIM) { if (w < c.w) { wt = c; break; } w -= c.w; }
  const wind = { to: wt.to + gauss(r) * 15, speed: Math.max(5, logn(r, 22, 0.18)) };
  const month = Math.floor(r() * 12);
  const sc = { name: st.name, vents, w0: 0.03, T0: 1420 + gauss(r) * 10, tgsd: st.k === 'est' ? [0.3, 1.6] : st.k === 'eff' ? [0, 1.7] : [1.3, 2], wind, phases };
  return { sc, style: st.k, styleName: st.name, vk, month, wind, ventZ: hAt(vents[0].x, vents[0].y) };
}

export class Ensemble {
  constructor(renderer, D, hAt) {
    this.r = renderer; this.D = D; this.hAt = hAt;
    this.sol = new Solver(renderer, D, { scale: 2 });
    this.run = new Runner(this.sol, D);
    const opt = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
    this.acc = [new THREE.WebGLRenderTarget(this.sol.nx, this.sol.ny, opt), new THREE.WebGLRenderTarget(this.sol.nx, this.sol.ny, opt)];
    this.active = false; this.done = 0; this.N = 0; this.members = [];
  }
  start(N, seed = 12345, tMaxH = 12) {
    const prev = this.r.getRenderTarget();
    for (const a of this.acc) { this.r.setRenderTarget(a); this.r.setClearColor(0x000000, 0); this.r.clear(); }
    this.r.setRenderTarget(prev);
    this.N = N; this.done = 0; this.members = []; this.rand = rng(seed); this.tMax = tMaxH * 3600; this.active = true; this.cur = null;
    this.siteHits = null;
  }
  stop() { this.active = false; this.cur = null; }
  // Avanza el ensamble con un presupuesto de pasos
  tick(steps) {
    if (!this.active) return false;
    if (!this.cur) {
      if (this.done >= this.N) { this.active = false; return false; }
      const m = sampleMember(this.rand, this.hAt);
      const src = new EruptionSource(m.sc, { ventZ: m.ventZ });
      this.run.start(src, { month: m.month, rain: 0 });
      this.cur = { ...m, tEnd: Math.min(this.tMax, src.tEnd + 1800), src, k: 0 };
    }
    const c = this.cur;
    let left = steps;
    while (left > 0 && this.run.t < c.tEnd) {
      const n = this.run.advance(Math.min(left, 150), c.tEnd); left -= Math.max(1, n);
      this.run.readSummary(false);
    }
    if (this.run.t >= c.tEnd - 1e-3) {
      this.run.doAsh();
      this.run.readSummary(false);
      this.sol.accumulate(this.acc);
      this.members.push({ style: c.styleName, vk: c.vk, month: c.month, wind: c.wind, lahar: this.run.totals.melt, lavaVol: this.run.totals.lava + this.run.totals.depLava, ash: this.run.ashMass });
      this.done++; this.cur = null;
    }
    return true;
  }
  get tex() { return this.acc[0].texture; }
  progress() { return this.N ? (this.done + (this.cur ? this.run.t / this.cur.tEnd : 0)) / this.N : 0; }
}
