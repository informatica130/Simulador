// =====================================================================
//  Orquestador de una simulación: paso de tiempo adaptativo (CFL de
//  Bates et al. 2010), fuentes dependientes del tiempo, tefra
//  incremental, lectura de resúmenes y series de tiempo.
// =====================================================================
import { snowSWE } from './data.js';
import { FIRE_DRY } from './config.js';

export class Runner {
  constructor(solver, D) { this.sol = solver; this.D = D; this.t = 0; this.dt = 1; this.series = []; this.sum = null; }
  start(src, cfg) {
    this.src = src; this.cfg = cfg;
    const swe = snowSWE(this.D, cfg.month);
    this.sol.setStatic(swe); this.sol.reset();
    this.sol.setFire({ dry: FIRE_DRY[cfg.month] * (cfg.rain > 0 ? 0.2 : 1), windTo: src.wind.to });
    this.sol.mFlux.uniforms.uPdcMu.value = cfg.pdcMu || 0.12;
    this.sol.mUpd.uniforms.uErode.value = cfg.erode ?? 1;
    this.t = 0; this.dt = 1; this.lastSrc = -1e9; this.lastAsh = 0; this.series = []; this.sum = null;
    this.limits = { h: 0, u: 0, hp: 0, up: 0, mud: false, pdc: false, lava: false };
    this.ashMass = 0; this.steps = 0;
    this.totals = { lahar: 0, sed: 0, lava: 0, pdc: 0, melt: 0, depMud: 0, depLava: 0, burning: 0, maxT: 0, maxH: 0, maxU: 0, ash: 0, lavaErupted: 0 };
    this.updateSources(true);
  }
  srcAt(t) {
    const s = this.src.at(t);
    const lv = this.src.lavaVents(t);
    const pdcQ = this.src.pdc(t);
    const v0 = this.src.vents[0];
    const cx = this.src.vents.reduce((a, v) => a + v.x, 0) / this.src.vents.length, cy = this.src.vents.reduce((a, v) => a + v.y, 0) / this.src.vents.length;
    // fusión cerca de la boca: piroclastos calientes y salpicaduras sobre la nieve
    const spatRate = (s.MER > 0 ? 2.2e-5 * Math.sqrt(s.MER / 1e5) : 0) + (s.fountain > 0 ? 3e-5 * s.fountain / 400 : 0);
    return {
      vents: lv, T0: this.src.T0,
      pdc: pdcQ > 0 ? { x: cx, y: cy, r: 0.45 + 0.25 * Math.log10(1 + pdcQ / 1000), Q: pdcQ } : null, pdcT: 820,
      water: s.water.map(w => ({ x: w.x, y: w.y, r: 0.2, Q: w.Q })),
      spat: { x: cx, y: cy, r: 0.35 + 0.15 * Math.log10(1 + s.MER / 1e5), rate: spatRate * (this.cfg.melt ?? 1) },
      rain: (this.cfg.rain || 0) / 1000 / 3600 * (this.t > (this.cfg.rainStart || 0) * 3600 ? 1 : 0),
      state: s,
    };
  }
  updateSources(force) {
    const s = this.srcAt(this.t);
    this.cur = s; this.sol.setSources(s);
    this.pdcSrc = !!s.pdc;
    this.lastSrc = this.t;
  }
  // Avanza hasta nSteps pasos o hasta tLimit
  advance(nSteps, tLimit) {
    let k = 0;
    while (k < nSteps && this.t < tLimit) {
      if (this.t - this.lastSrc >= 10) this.updateSources();
      let dt = this.dt;
      if (this.pdcSrc || this.limits.pdc) dt = Math.min(dt, 0.35);
      dt = Math.min(dt, tLimit - this.t); if (dt <= 1e-3) break;
      this.sol.step(dt, this.t + dt);
      this.t += dt; k++; this.steps++;
      if (this.t - this.lastAsh >= 45) this.doAsh();
    }
    return k;
  }
  doAsh() {
    const kern = this.src.tephraBatch(this.lastAsh, this.t);
    for (const k of kern) this.ashMass += k.mass;
    this.sol.addAsh(kern, this.t);
    this.lastAsh = this.t;
  }
  // Lee el resumen 8×8 y ajusta el paso de tiempo
  readSummary(wantSpots = false) {
    const { buf, bw, bh } = this.sol.summary();
    const A = this.sol.dx * this.sol.dx;
    let sH = 0, sS = 0, sL = 0, sP = 0, mH = 0, mT = 0, mP = 0, cont = 0, burn = 0, mom = 0, melt = 0, dM = 0, dL = 0, mU = 0, pU = 0;
    const spots = wantSpots ? { lavaSnow: [], pdc: [], fire: [], mud: [], lava: [], hot: [] } : null;
    const W = bw * 4, ck = this.sol.cellKm * 8;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const o0 = (j * W + i) * 4, o1 = (j * W + bw + i) * 4, o2 = (j * W + 2 * bw + i) * 4, o3 = (j * W + 3 * bw + i) * 4;
      sH += buf[o0]; sS += buf[o0 + 1]; sL += buf[o0 + 2]; sP += buf[o0 + 3];
      mH = Math.max(mH, buf[o1]); mT = Math.max(mT, buf[o1 + 1]); mP = Math.max(mP, buf[o1 + 2]); cont += buf[o1 + 3];
      burn += buf[o2]; mom += Math.hypot(buf[o2 + 1], buf[o2 + 2]);
      melt += buf[o3]; dM += buf[o3 + 1]; dL += buf[o3 + 2]; mU = Math.max(mU, buf[o3 + 3]);
      if (buf[o0 + 3] > 0.05) pU = Math.max(pU, Math.hypot(buf[o2 + 1], buf[o2 + 2]) / buf[o0 + 3]);
      if (spots) {
        const [x, y] = this.sol.world(i * 8 + 3.5, j * 8 + 3.5);
        if (buf[o1 + 3] > 0) spots.lavaSnow.push({ x, y, r: ck, w: buf[o1 + 3] });
        if (buf[o0 + 2] > 1) { spots.lava.push({ x, y, r: ck, w: buf[o0 + 2] }); spots.hot.push({ x, y, w: buf[o0 + 2] * Math.exp((buf[o1 + 1] - 1300) / 85), T: buf[o1 + 1] }); }
        if (buf[o0 + 3] > 0.5) spots.pdc.push({ x, y, r: ck, w: buf[o0 + 3], vx: buf[o2 + 1] / buf[o0 + 3], vy: -buf[o2 + 2] / buf[o0 + 3] });
        if (buf[o2] > 0) spots.fire.push({ x, y, r: ck, w: buf[o2] });
        if (buf[o0] > 2 && buf[o3 + 3] > 3) spots.mud.push({ x, y, r: ck, w: buf[o0] * buf[o3 + 3] });
      }
    }
    // paso de tiempo: CFL con la onda de gravedad y la advección
    const c = Math.sqrt(9.81 * Math.max(mH, mP, 0.5)) + Math.max(mU, pU * 1.5);
    const mud = sH * A > 50, pdc = sP * A > 50, lava = sL * A > 10;
    let dt = 0.55 * this.sol.dx / c;
    dt = Math.min(dt, mud ? 2.0 : lava ? 5 : 6, pdc ? 0.4 : 99);
    this.dt = Math.max(0.12, dt);
    this.limits = { h: mH, u: mU, hp: mP, up: pU, mud, pdc, lava };
    const T = this.totals;
    T.lahar = sH * A; T.sed = sS * A; T.lava = sL * A; T.pdc = sP * A; T.melt = melt * A; T.depMud = dM * A; T.depLava = dL * A;
    T.burning = burn * A / 1e6; T.maxT = mT; T.maxH = mH; T.maxU = mU; T.ash = this.ashMass; T.lavaErupted = this.src.cumLavaVol(this.t) / 0.85;
    if (spots) {
      spots.hot.sort((a, b) => b.w - a.w);
      const sel = []; for (const h of spots.hot) { if (sel.every(s => Math.hypot(s.x - h.x, s.y - h.y) > 1.2)) sel.push(h); if (sel.length >= 5) break; }
      spots.hot = sel;
    }
    this.sum = { spots, totals: { ...T } };
    return this.sum;
  }
  record(extra) {
    const s = this.cur ? this.cur.state : { MER: 0, E: 0 };
    const P = s.MER > 50 ? this.src.plume(s.MER) : null;
    const T = this.totals;
    this.series.push({ t: this.t, MER: s.MER, E: s.E, H: P ? P.Ht : 0, lahar: T.lahar, lava: T.lava, melt: T.melt, pdc: T.pdc, ash: this.ashMass, burn: T.burning, maxT: T.maxT, ...extra });
    if (this.series.length > 4000) this.series.splice(0, this.series.length - 4000);
  }
}
