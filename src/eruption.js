// =====================================================================
//  Fuente eruptiva dependiente del tiempo: tasa explosiva (MER), efusión,
//  fuentes de lava, balística, colapsos (CDP), agua de deshielo directa.
//  Integra la masa emitida para la dispersión incremental de tefra.
// =====================================================================
import { runPlume, tephraKernels } from './plume.js';
import { PHYS } from './config.js';

const ss = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export class EruptionSource {
  constructor(sc, opts = {}) {
    this.sc = sc;
    this.mult = opts.mult || 1;          // multiplicador de tasa explosiva
    this.emult = opts.emult || 1;        // multiplicador de efusión
    this.wind = { ...sc.wind, ...(opts.wind || {}) };
    this.ventZ = opts.ventZ || 3000;
    this.vents = buildVents(sc, opts.vents);
    this.w0 = sc.w0; this.T0 = opts.T0 || sc.T0;
    this.tgsd = sc.tgsd;
    this.phases = sc.phases;
    this.tEnd = Math.max(...sc.phases.map(p => p.t1)) * 60;
    // tabla de masa acumulada (cada 20 s)
    this.dtTab = 20; const n = Math.ceil((this.tEnd + 3600) / this.dtTab) + 2;
    this.cum = new Float64Array(n); this.cumLava = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const t = (i - 0.5) * this.dtTab, s = this.at(t, true);
      this.cum[i] = this.cum[i - 1] + s.MER * this.dtTab;
      this.cumLava[i] = this.cumLava[i - 1] + s.E * this.dtTab;
    }
    this.plumeCache = new Map();
  }
  // Estado de la fuente en t (s). smooth=true ignora los pulsos (para balance de masa)
  at(t, smooth = false) {
    const tm = t / 60; let MER = 0, E = 0, fountain = 0, ballistic = 0, collapse = 0, pulse = false;
    for (const p of this.phases) {
      if (tm < p.t0 || tm > p.t1 + 30) continue;
      const len = p.t1 - p.t0, up = Math.min(4, len / 4), dn = Math.min(25, len / 3);
      const f = ss(p.t0, p.t0 + up, tm) * (1 - ss(p.t1 - dn * 0.3, p.t1 + dn * 0.7, tm));
      if (p.MER) {
        let m = p.MER * this.mult * f;
        // variabilidad interna de una columna sostenida (pulsos de 3–20 min)
        m *= 1 + 0.25 * Math.sin(tm * 0.9 + p.t0) * Math.sin(tm * 0.31);
        MER += m; if (p.pulse) pulse = true;
        ballistic = Math.max(ballistic, (p.ballistic || 0) * f);
        collapse = Math.max(collapse, (p.collapse || 0) * f);
      }
      if (p.E) {
        // curva de Wadge (1981): máximo temprano y declinación exponencial
        const age = Math.max(0, tm - p.t0);
        E += p.E * this.emult * f * (0.45 + 0.55 * Math.exp(-age / Math.max(60, len * 0.35))) * 1.3;
      }
      if (p.fountain) fountain = Math.max(fountain, p.fountain * f * Math.sqrt(this.mult));
    }
    const water = [];
    for (const w of (this.sc.water || [])) if (tm >= w.t0 && tm <= w.t1) water.push({ x: w.x, y: w.y, Q: w.Q * ss(w.t0, w.t0 + 2, tm) * (1 - ss(w.t1 - 5, w.t1, tm)) });
    return { MER, E, fountain, ballistic, collapse, pulse, water, active: MER > 1 || E > 0.1 };
  }
  cumMass(t) { if (t <= 0) return 0; const f = t / this.dtTab, i = Math.min(this.cum.length - 2, Math.floor(f)); const u = Math.min(1, f - i); return this.cum[i] * (1 - u) + this.cum[i + 1] * u; }
  cumLavaVol(t) { if (t <= 0) return 0; const f = t / this.dtTab, i = Math.min(this.cumLava.length - 2, Math.floor(f)); const u = Math.min(1, f - i); return this.cumLava[i] * (1 - u) + this.cumLava[i + 1] * u; }
  plume(MER) {
    if (MER < 50) return null;
    const key = Math.round(Math.log10(MER) * 40) + ':' + Math.round(this.wind.speed);
    let P = this.plumeCache.get(key);
    if (!P) {
      P = runPlume({ MER: Math.pow(10, Math.round(Math.log10(MER) * 40) / 40), vref: this.wind.speed, z0: this.ventZ + 60, w0: this.w0, T0: this.T0 });
      if (P) P.kernels = tephraKernels(P, this.tgsd);
      this.plumeCache.set(key, P);
    }
    return P;
  }
  // Núcleos gaussianos de tefra que aterrizan en (t0, t1]: masa, centro, sigma
  tephraBatch(t0, t1) {
    const out = []; const s = this.at(t1, true);
    const ref = this.plume(Math.max(s.MER, this.peakMER(t1)));
    if (!ref) return out;
    const az = this.wind.to * Math.PI / 180, ux = Math.sin(az), uy = Math.cos(az);
    const v = this.vents[0];
    for (const k of ref.kernels) {
      const a = t0 - k.tf, b = t1 - k.tf;
      if (b <= 0) continue;
      const dm = this.cumMass(b) - this.cumMass(Math.max(0, a));
      if (dm <= 0) continue;
      // plumas débiles: el material grueso cae cerca del cráter; escala el transporte con la pluma del momento de emisión
      const sEm = this.at(Math.max(0, (a + b) / 2), true);
      const P = this.plume(Math.max(60, sEm.MER)) || ref;
      const kk = P.kernels[k.i * 8 + k.j] || k;
      const x = kk.x / 1000;
      out.push({ x: v.x + ux * x, y: v.y + uy * x, sigma: Math.max(0.12, kk.sigma / 1000), mass: dm * kk.frac, phi: kk.phi });
    }
    return out;
  }
  peakMER(t) { let m = 0; for (const p of this.phases) if (p.MER && t / 60 >= p.t0) m = Math.max(m, p.MER * this.mult); return m; }
  // Fuentes de lava por boca (m³/s DRE → volumen de lava con 15 % vesículas)
  lavaVents(t) {
    const s = this.at(t); if (s.E <= 0) return [];
    const n = this.vents.length; return this.vents.map(v => ({ ...v, E: s.E / n / 0.85 }));
  }
  // Flujo de CDP (m³/s de corriente densa, ρ ≈ 1100 kg/m³)
  pdc(t) {
    const s = this.at(t); if (s.MER <= 0) return 0;
    let f = s.collapse;
    const P = this.plume(s.MER); if (P && P.collapse) f = Math.max(f, 0.7);
    return f * s.MER / 1100;
  }
}

function buildVents(sc, override) {
  if (override && override.length) return override.map(v => ({ x: v.x, y: v.y, r: v.r || 0.12 }));
  if (sc.fissure) {
    const f = sc.fissure, a = f.az * Math.PI / 180, out = [];
    for (let i = 0; i < f.n; i++) { const s = (i / (f.n - 1) - 0.5) * f.len; out.push({ x: f.x + Math.sin(a) * s, y: f.y + Math.cos(a) * s, r: 0.1 }); }
    return out;
  }
  return sc.vents.map(v => ({ ...v }));
}

export function fissureVents(x, y, az, len, n = 4) {
  const a = az * Math.PI / 180, out = [];
  for (let i = 0; i < n; i++) { const s = (n === 1 ? 0 : i / (n - 1) - 0.5) * len; out.push({ x: x + Math.sin(a) * s, y: y + Math.cos(a) * s, r: 0.1 }); }
  return out;
}
