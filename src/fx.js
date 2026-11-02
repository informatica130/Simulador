// =====================================================================
//  Partículas físicas (CPU) dibujadas con instancias en GPU.
//  Unidades internas: metros (x este, y norte, z altitud), segundos.
//  - Columna: sigue la solución del modelo integral de pluma (eje,
//    radio, velocidad) y se expande en la nube paraguas con el viento.
//  - Fuentes de lava y bombas balísticas con arrastre aerodinámico
//    (Mastin 2001): a = −g − (Cd·ρa·A/2m)|v|v.
//  - Vapor (lava sobre nieve, fumarolas), CDP, incendios, rayos.
// =====================================================================
import * as THREE from 'three';
import { atm, windAt, plumeLookup } from './plume.js';

const SMOKE = 0, ASHF = 1, STEAM = 2, PDC = 3, FSMOKE = 4, DUST = 5, SPRAY = 6;
const SPARK = 0, BOMB = 1, FLAME = 2, EMBER = 3;

const PVS = /* glsl */`
precision highp float;
attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSR; attribute float iGlow;
varying vec2 vUv; varying vec4 vCol; varying float vGlow; varying vec3 vWp; varying float vSeed;
void main(){
  vUv = position.xy * 0.5 + 0.5; vCol = iCol; vGlow = iGlow; vWp = iPos; vSeed = iSR.y;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSR.y * 6.283), s = sin(iSR.y * 6.283);
  vec2 q = mat2(c, -s, s, c) * position.xy;
  mv.xy += q * iSR.x;
  gl_Position = projectionMatrix * mv;
}`;
const SMOKE_FS = /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vCol; varying float vGlow; varying vec3 vWp; varying float vSeed;
uniform vec3 uSunV; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uFogCol; uniform float uFogD; uniform vec3 uCamPos; uniform float uAshHaze;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  if (r > 1.0) discard;
  float n = vn(vUv * 4.0 + vSeed * 31.0) * 0.6 + vn(vUv * 9.0 - vSeed * 17.0) * 0.4;
  float dens = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.55);
  if (dens <= 0.01) discard;
  vec3 nrm = normalize(vec3(p * 0.9, sqrt(max(0.0, 1.0 - r * r)) + 0.3));
  float lam = 0.5 + 0.5 * dot(nrm, uSunV);
  vec3 c = vCol.rgb * (uSunCol * lam * 0.42 + uSkyCol * 0.9 + 0.02);
  c += vec3(1.0, 0.35, 0.08) * vGlow * (1.0 - 0.5 * r);
  float d = length(vWp - uCamPos);
  c = mix(c, uFogCol, clamp(1.0 - exp(-d * uFogD), 0.0, 1.0));
  gl_FragColor = vec4(c, dens * vCol.a);
}`;
const GLOW_FS = /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vCol; varying float vGlow; varying vec3 vWp; varying float vSeed;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = dot(p, p);
  float a = exp(-r * 5.0) + 0.25 * exp(-r * 1.4);
  gl_FragColor = vec4(vCol.rgb * vGlow * a, 1.0);
}`;

class Pool {
  constructor(n, fs, blending, scene) {
    this.n = n; this.count = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.age = new Float32Array(n); this.life = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.type = new Uint8Array(n); this.col = new Float32Array(n * 4); this.seed = new Float32Array(n); this.glow = new Float32Array(n); this.drag = new Float32Array(n);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aGlow = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iSR', this.aSR); g.setAttribute('iGlow', this.aGlow);
    g.instanceCount = 0;
    this.uniforms = { uSunV: { value: new THREE.Vector3(0, 0, 1) }, uSunCol: { value: new THREE.Color() }, uSkyCol: { value: new THREE.Color() }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.006 }, uCamPos: { value: new THREE.Vector3() }, uAshHaze: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: PVS, fragmentShader: fs, uniforms: this.uniforms, transparent: true, depthWrite: false, blending });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.g = g;
    scene.add(this.mesh);
    this.order = new Uint32Array(n); this.keys = new Float32Array(n);
  }
  add(x, y, z, vx, vy, vz, life, s0, s1, type, r, gg, b, a, glow = 0, drag = 0) {
    if (this.count >= this.n) return -1;
    const i = this.count++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.type[i] = type;
    this.col[i * 4] = r; this.col[i * 4 + 1] = gg; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a; this.seed[i] = Math.random(); this.glow[i] = glow; this.drag[i] = drag;
    return i;
  }
  kill(i) {
    const j = --this.count; if (i === j) return;
    for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[j * 3 + k]; this.v[i * 3 + k] = this.v[j * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.type[i] = this.type[j]; this.seed[i] = this.seed[j]; this.glow[i] = this.glow[j]; this.drag[i] = this.drag[j];
  }
}

export class FX {
  constructor(scene, hAt) {
    this.hAt = hAt; // altura del terreno en (x km, y km) → m
    this.smoke = new Pool(22000, SMOKE_FS, THREE.NormalBlending, scene);
    this.glow = new Pool(14000, GLOW_FS, THREE.AdditiveBlending, scene);
    this.smoke.mesh.renderOrder = 5; this.glow.mesh.renderOrder = 6;
    this.ex = 1.5; this.acc = {}; this.events = [];
    // rayos
    this.boltGeo = new THREE.BufferGeometry(); this.boltPos = new Float32Array(600 * 3);
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.boltGeo.setDrawRange(0, 0);
    this.bolt = new THREE.LineSegments(this.boltGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(4, 3.6, 5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.bolt.frustumCulled = false; scene.add(this.bolt);
    this.boltLife = 0; this.flash = null; this.pulseT = 0; this.boom = 0;
    this.spots = { lavaSnow: [], pdc: [], fire: [], mud: [], lava: [] };
    this.fumaroles = [[0.05, 0.1], [-0.15, -0.05], [0.12, -0.12], [0.36, -1.08], [0.0, 0.18]];
  }
  setSpots(sp) { this.spots = sp; }
  // ctx: {src, plume, vents, wind{to,speed}, night, visDt, simRunning, phreatic}
  update(dtv, ctx) {
    const s = ctx.src || { MER: 0, E: 0, fountain: 0, ballistic: 0 };
    const az = (ctx.wind.to || 90) * Math.PI / 180, wx = Math.sin(az), wy = Math.cos(az), vref = ctx.wind.speed || 20;
    const vents = ctx.vents || [];
    const v0 = vents[0] || { x: 0, y: 0 };
    const vx0 = v0.x * 1000, vy0 = v0.y * 1000, vz0 = this.hAt(v0.x, v0.y) + 40;
    const P = ctx.plume;
    const rnd = Math.random;
    const emit = (key, rate) => { this.acc[key] = (this.acc[key] || 0) + rate * dtv; const n = Math.floor(this.acc[key]); this.acc[key] -= n; return Math.min(n, 400); };
    // ---------------- columna eruptiva
    if (s.MER > 50 && P) {
      const lg = Math.log10(s.MER);
      let n = emit('plume', 8 + 9 * (lg - 2));
      const steamy = ctx.phreatic ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const v = vents[(rnd() * vents.length) | 0] || v0;
        const r = P.b0 * Math.sqrt(rnd()), a = rnd() * 6.283;
        const up = P.U0 * (0.6 + 0.4 * rnd());
        const dark = 0.16 + 0.08 * rnd();
        const c = steamy ? [0.78, 0.78, 0.8] : [dark * 1.08, dark, dark * 0.94];
        this.smoke.add(v.x * 1000 + Math.cos(a) * r, v.y * 1000 + Math.sin(a) * r, this.hAt(v.x, v.y) + 30, 0, 0, up, 300 + 500 * rnd(), Math.max(60, P.b0 * 2.5), 600, SMOKE, c[0], c[1], c[2], 0.85, s.MER > 2e4 ? 0.35 : 0.1);
      }
      // lluvia de ceniza bajo la nube paraguas
      n = emit('ashf', Math.max(0, 4 * (lg - 4)));
      for (let k = 0; k < n; k++) {
        const d = (P.xTop + rnd() * (8000 + 25000 * rnd()));
        const lat = (rnd() - 0.5) * (2500 + d * 0.25);
        const x = vx0 + wx * d + wy * lat, y = vy0 + wy * d - wx * lat;
        const z = P.Ht * (0.55 + 0.3 * rnd());
        this.smoke.add(x, y, z, wx * vref * 0.5, wy * vref * 0.5, -(6 + 10 * rnd()), 900, 220, 650, ASHF, 0.30, 0.28, 0.27, 0.08);
      }
    }
    // ---------------- fuente de lava
    if (s.fountain > 20) {
      const vF = Math.sqrt(2 * 9.81 * s.fountain);
      const n = emit('fount', 60 + s.fountain * 0.25);
      for (let k = 0; k < n; k++) {
        const v = vents[(rnd() * vents.length) | 0] || v0;
        const th = (1 - Math.pow(rnd(), 2)) * 0.25, a = rnd() * 6.283, sp = vF * (0.55 + 0.5 * rnd());
        this.glow.add(v.x * 1000 + (rnd() - 0.5) * 60, v.y * 1000 + (rnd() - 0.5) * 60, this.hAt(v.x, v.y) + 15,
          Math.sin(th) * Math.cos(a) * sp, Math.sin(th) * Math.sin(a) * sp, Math.cos(th) * sp, 30, 18 + 25 * rnd(), 8, SPARK, 1, 0.45 + 0.2 * rnd(), 0.12, 1, 3.0, 0.004);
      }
    }
    // ---------------- explosiones estrombolianas y balística
    if (s.ballistic > 0.02) {
      this.pulseT -= dtv;
      if (this.pulseT <= 0) {
        this.pulseT = (s.pulse ? 2 + 10 * rnd() : 0.6 + 2 * rnd()) / (0.4 + s.ballistic);
        const nb = Math.round((s.pulse ? 25 : 8) * s.ballistic * (0.5 + rnd()));
        for (let k = 0; k < nb; k++) {
          const v = vents[(rnd() * vents.length) | 0] || v0;
          const D = 0.2 + 1.3 * Math.pow(rnd(), 2);            // diámetro (m)
          const th = (5 + 40 * rnd()) * Math.PI / 180, a = rnd() * 6.283, sp = 70 + 140 * rnd() * Math.sqrt(s.ballistic);
          const m = 2500 * Math.PI * D * D * D / 6, A = Math.PI * D * D / 4;
          this.glow.add(v.x * 1000, v.y * 1000, this.hAt(v.x, v.y) + 20, Math.sin(th) * Math.cos(a) * sp, Math.sin(th) * Math.sin(a) * sp, Math.cos(th) * sp,
            200, 20 + D * 25, 10, BOMB, 1, 0.5, 0.15, 1, 4.0, 0.9 * A / (2 * m));
        }
        // bocanada de ceniza de la explosión
        for (let k = 0; k < 14; k++) this.smoke.add(vx0 + (rnd() - 0.5) * 120, vy0 + (rnd() - 0.5) * 120, vz0, (rnd() - 0.5) * 20, (rnd() - 0.5) * 20, 40 + 50 * rnd(), 120 + 60 * rnd(), 80, 500, SMOKE, 0.2, 0.18, 0.17, 0.8, 0.6);
        this.boom = Math.min(1, this.boom + 0.6 * s.ballistic); this.boomEvent = Math.max(this.boomEvent || 0, s.ballistic * (s.pulse ? 1 : 0.5));
      }
    }
    this.boom = Math.max(0, this.boom - dtv * 2.5);
    // ---------------- rayos volcánicos
    this.boltLife -= dtv;
    if (s.MER > 3e5 && P && rnd() < dtv * Math.min(6, (Math.log10(s.MER) - 5.2) * 2.2)) this.makeBolt(P, vx0, vy0, vz0, wx, wy);
    if (this.boltLife <= 0) { this.boltGeo.setDrawRange(0, 0); this.flash = null; }
    // ---------------- fumarolas (siempre)
    const fr = ctx.fumarole ?? 1;
    for (let q = 0; q < this.fumaroles.length; q++) {
      const n = emit('fum' + q, (q === 0 ? 3 : 1.2) * fr);
      const [fx, fy] = this.fumaroles[q];
      for (let k = 0; k < n; k++) this.smoke.add(fx * 1000 + (rnd() - 0.5) * 80, fy * 1000 + (rnd() - 0.5) * 80, this.hAt(fx, fy) + 5, 0, 0, 3 + 4 * rnd(), 60 + 60 * rnd(), 25, 260, STEAM, 0.92, 0.93, 0.95, 0.45);
    }
    // ---------------- puntos activos desde el resumen del solver
    const pick = (arr) => { if (!arr.length) return null; const tot = arr.totalW || (arr.totalW = arr.reduce((a, b) => a + b.w, 0)); let r = rnd() * tot; for (const s of arr) { r -= s.w; if (r <= 0) return s; } return arr[arr.length - 1]; };
    const sp = this.spots;
    // vapor donde la lava funde nieve/hielo (explosiones de vapor)
    let n = emit('steam', Math.min(150, sp.lavaSnow.length * 6));
    for (let k = 0; k < n; k++) { const b = pick(sp.lavaSnow); if (!b) break; const x = b.x + (rnd() - 0.5) * b.r, y = b.y + (rnd() - 0.5) * b.r;
      this.smoke.add(x * 1000, y * 1000, this.hAt(x, y) + 10, 0, 0, 10 + 20 * rnd(), 60 + 80 * rnd(), 40, 420, STEAM, 0.85, 0.86, 0.88, 0.35); }
    // gas sobre la lava
    n = emit('lgas', Math.min(80, sp.lava.length * 1.5));
    for (let k = 0; k < n; k++) { const b = pick(sp.lava); if (!b) break; const x = b.x + (rnd() - 0.5) * b.r, y = b.y + (rnd() - 0.5) * b.r;
      this.smoke.add(x * 1000, y * 1000, this.hAt(x, y) + 8, 0, 0, 4 + 6 * rnd(), 80 + 60 * rnd(), 30, 300, STEAM, 0.75, 0.77, 0.80, 0.25, 0.5); }
    // corrientes piroclásticas: nubes que ruedan pendiente abajo
    n = emit('pdc', Math.min(250, sp.pdc.reduce((a, b) => a + b.w, 0) * 0.03));
    for (let k = 0; k < n; k++) { const b = pick(sp.pdc); if (!b) break; const x = b.x + (rnd() - 0.5) * b.r, y = b.y + (rnd() - 0.5) * b.r;
      this.smoke.add(x * 1000, y * 1000, this.hAt(x, y) + 20, b.vx * 0.8, b.vy * 0.8, 6 + 10 * rnd(), 80 + 120 * rnd(), 150, 900, PDC, 0.36, 0.33, 0.30, 0.9, 0.15); }
    // incendios: llamas y humo
    n = emit('fire', Math.min(200, sp.fire.length * 3));
    for (let k = 0; k < n; k++) { const b = pick(sp.fire); if (!b) break; const x = b.x + (rnd() - 0.5) * b.r, y = b.y + (rnd() - 0.5) * b.r, z = this.hAt(x, y);
      this.glow.add(x * 1000, y * 1000, z + 8, 0, 0, 6 + 6 * rnd(), 2 + 2 * rnd(), 25 + 20 * rnd(), 6, FLAME, 1, 0.42, 0.1, 1, 2.2);
      if (rnd() < 0.5) this.smoke.add(x * 1000, y * 1000, z + 30, wx * 4, wy * 4, 8 + 6 * rnd(), 200 + 150 * rnd(), 60, 700, FSMOKE, 0.13, 0.12, 0.115, 0.55); }
    // rocío de barro en lahares rápidos
    n = emit('spray', Math.min(120, sp.mud.length * 1.2));
    for (let k = 0; k < n; k++) { const b = pick(sp.mud); if (!b) break; const x = b.x + (rnd() - 0.5) * b.r, y = b.y + (rnd() - 0.5) * b.r;
      this.smoke.add(x * 1000, y * 1000, this.hAt(x, y) + 4, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6, 2 + 3 * rnd(), 12 + 10 * rnd(), 25, 90, SPRAY, 0.45, 0.38, 0.30, 0.35); }

    this.integrate(dtv, ctx, P, wx, wy, vref, vx0, vy0);
  }
  makeBolt(P, vx0, vy0, vz0, wx, wy) {
    const pts = []; const z0 = vz0 + 300 + Math.random() * Math.min(5000, (P.Ht - vz0) * 0.5);
    const pl = plumeLookup(P, z0) || { x: 0, b: 300 };
    let x = vx0 + wx * pl.x + (Math.random() - 0.5) * pl.b, y = vy0 + wy * pl.x + (Math.random() - 0.5) * pl.b, z = z0;
    const len = 1500 + Math.random() * 3500, segs = 26; const dir = [(Math.random() - 0.5), (Math.random() - 0.5), -0.6 - Math.random() * 0.4];
    for (let i = 0; i < segs; i++) {
      const nx = x + (dir[0] + (Math.random() - 0.5) * 0.9) * len / segs, ny = y + (dir[1] + (Math.random() - 0.5) * 0.9) * len / segs, nz = z + (dir[2] + (Math.random() - 0.5) * 0.6) * len / segs;
      pts.push(x, y, z, nx, ny, nz);
      if (Math.random() < 0.18 && pts.length < 560) { const bx = nx + (Math.random() - 0.5) * 400, by = ny + (Math.random() - 0.5) * 400, bz = nz - Math.random() * 300; pts.push(nx, ny, nz, bx, by, bz); }
      x = nx; y = ny; z = nz;
    }
    const n = Math.min(pts.length / 3, 600);
    for (let i = 0; i < n; i++) { this.boltPos[i * 3] = pts[i * 3] / 1000; this.boltPos[i * 3 + 1] = pts[i * 3 + 2] / 1000 * this.ex; this.boltPos[i * 3 + 2] = -pts[i * 3 + 1] / 1000; }
    this.boltGeo.attributes.position.needsUpdate = true; this.boltGeo.setDrawRange(0, n);
    this.boltLife = 0.12 + Math.random() * 0.12; this.flash = { x: x / 1000, y: y / 1000, z };
  }
  integrate(dt, ctx, P, wx, wy, vref, vx0, vy0) {
    const hAt = this.hAt;
    // --- humo, vapor, ceniza
    const S = this.smoke;
    for (let i = S.count - 1; i >= 0; i--) {
      S.age[i] += dt; if (S.age[i] > S.life[i]) { S.kill(i); continue; }
      const t = S.type[i], o = i * 3;
      let x = S.p[o], y = S.p[o + 1], z = S.p[o + 2], vx = S.v[o], vy = S.v[o + 1], vz = S.v[o + 2];
      const W = windAt(z, vref);
      if (t === SMOKE && P) {
        const pl = plumeLookup(P, z);
        if (pl && z < P.Ht - 150 && S.age[i] < 400) {
          // velocidad local de la pluma
          const cx = vx0 + wx * pl.x, cy = vy0 + wy * pl.x;
          const sth = Math.sin(pl.th), cth = Math.cos(pl.th);
          const tvz = Math.max(pl.U * sth, 6), th = pl.U * cth;
          let tvx = wx * th, tvy = wy * th;
          const dx = x - cx, dy = y - cy, rr = Math.hypot(dx, dy) + 1;
          const pull = rr > pl.b ? -0.25 * (rr - pl.b) : 0.06 * pl.U;
          tvx += dx / rr * pull + (Math.random() - 0.5) * pl.U * 0.25; tvy += dy / rr * pull + (Math.random() - 0.5) * pl.U * 0.25;
          const k = Math.min(1, dt * 1.6);
          vx += (tvx - vx) * k; vy += (tvy - vy) * k; vz += (tvz - vz) * k;
          S.s1[i] = Math.max(S.s1[i], pl.b * 1.4);
        } else {
          // nube paraguas: corriente de gravedad radial + viento
          const cx = vx0 + wx * P.xTop, cy = vy0 + wy * P.xTop;
          const dx = x - cx, dy = y - cy, rr = Math.hypot(dx, dy) + 1;
          const ur = 25 / (1 + rr / 6000);
          const k = Math.min(1, dt * 0.5);
          vx += (wx * W + dx / rr * ur - vx) * k; vy += (wy * W + dy / rr * ur - vy) * k;
          vz += ((P.Hnb + (P.Ht - P.Hnb) * 0.5 - z) * 0.01 - vz) * k;
          S.s1[i] = Math.max(S.s1[i], 1800 + S.age[i] * 6);
        }
      } else if (t === SMOKE) {
        vz *= 1 - dt * 0.3; vx += (wx * W - vx) * dt * 0.3; vy += (wy * W - vy) * dt * 0.3;
      } else if (t === ASHF) {
        vx += (wx * W - vx) * dt * 0.5; vy += (wy * W - vy) * dt * 0.5;
      } else if (t === STEAM || t === FSMOKE) {
        vz += (t === STEAM ? 0.6 : 0.4) * dt; vz *= 1 - dt * 0.05;
        const Wl = windAt(z, vref) * 0.6; vx += (wx * Wl - vx) * dt * 0.2; vy += (wy * Wl - vy) * dt * 0.2;
      } else if (t === PDC) {
        // nube densa que sigue la pendiente y luego se eleva (co-CDP)
        vz += (S.age[i] > 40 ? 1.2 : -0.5) * dt; vx *= 1 - dt * 0.04; vy *= 1 - dt * 0.04;
      } else if (t === SPRAY) { vz -= 4 * dt; }
      x += vx * dt; y += vy * dt; z += vz * dt;
      const g = hAt(x / 1000, y / 1000);
      if (t === ASHF && z < g + 600) { S.life[i] = Math.min(S.life[i], S.age[i] + 8); }
      if (z < g + 5) { z = g + 5; vz = Math.abs(vz) * 0.2; if (t === ASHF || t === SPRAY) { S.kill(i); continue; } }
      S.p[o] = x; S.p[o + 1] = y; S.p[o + 2] = z; S.v[o] = vx; S.v[o + 1] = vy; S.v[o + 2] = vz;
    }
    // --- partículas incandescentes
    const E = this.glow; const ra = atm(3000).rho;
    for (let i = E.count - 1; i >= 0; i--) {
      E.age[i] += dt; if (E.age[i] > E.life[i]) { E.kill(i); continue; }
      const t = E.type[i], o = i * 3;
      let x = E.p[o], y = E.p[o + 1], z = E.p[o + 2], vx = E.v[o], vy = E.v[o + 1], vz = E.v[o + 2];
      if (t === SPARK || t === BOMB) {
        // arrastre cuadrático (relativo al aire) + gravedad
        const sp = Math.hypot(vx, vy, vz), k = E.drag[i] * ra * sp;
        vx -= k * vx * dt; vy -= k * vy * dt; vz -= (9.81 + k * vz) * dt;
        // enfriamiento: del amarillo al rojo oscuro
        E.glow[i] *= 1 - dt * (t === SPARK ? 0.08 : 0.04);
        E.col[i * 4 + 1] = Math.max(0.12, E.col[i * 4 + 1] - dt * 0.01);
      } else if (t === FLAME) { vz *= 1 - dt * 0.5; E.glow[i] *= 1 - dt * 0.6; }
      x += vx * dt; y += vy * dt; z += vz * dt;
      const g = hAt(x / 1000, y / 1000);
      if (z < g + 2 && vz < 0) {
        if (t === BOMB) {
          // impacto: polvo
          for (let k = 0; k < 4; k++) this.smoke.add(x, y, g + 10, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15, 6 + Math.random() * 10, 25 + Math.random() * 20, 25, 120, DUST, 0.30, 0.27, 0.25, 0.7);
          E.type[i] = EMBER; E.v[o] = E.v[o + 1] = E.v[o + 2] = 0; E.p[o] = x; E.p[o + 1] = y; E.p[o + 2] = g + 2; E.life[i] = E.age[i] + 20; E.glow[i] *= 0.7; continue;
        }
        if (t === SPARK) { E.kill(i); continue; }
        z = g + 2; vz = 0; vx = vy = 0;
      }
      if (t === EMBER) { E.glow[i] *= 1 - dt * 0.12; continue; }
      E.p[o] = x; E.p[o + 1] = y; E.p[o + 2] = z; E.v[o] = vx; E.v[o + 1] = vy; E.v[o + 2] = vz;
    }
  }
  // Escribe atributos para el render (coordenadas three: x km, y = alt km × ex, z = −y km)
  write(camera, ex) {
    this.ex = ex;
    const cam = camera.position;
    for (const [pool, sort] of [[this.smoke, true], [this.glow, false]]) {
      const n = pool.count, P = pool.aPos.array, C = pool.aCol.array, SR = pool.aSR.array, G = pool.aGlow.array;
      let order = null;
      if (sort && n > 1) {
        // orden de atrás hacia adelante (counting sort por cubetas de distancia)
        const keys = pool.keys, B = 2048, cnt = new Uint32Array(B + 1);
        let mx = 1e-6;
        for (let i = 0; i < n; i++) { const dx = pool.p[i * 3] / 1000 - cam.x, dy = pool.p[i * 3 + 2] / 1000 * ex - cam.y, dz = -pool.p[i * 3 + 1] / 1000 - cam.z; const d = dx * dx + dy * dy + dz * dz; keys[i] = d; if (d > mx) mx = d; }
        for (let i = 0; i < n; i++) { const b = B - 1 - Math.min(B - 1, Math.floor(Math.sqrt(keys[i] / mx) * (B - 1))); keys[i] = b; cnt[b + 1]++; }
        for (let b = 0; b < B; b++) cnt[b + 1] += cnt[b];
        order = pool.order; for (let i = 0; i < n; i++) order[cnt[keys[i]]++] = i;
      }
      for (let q = 0; q < n; q++) {
        const i = order ? order[q] : q, o = i * 3;
        P[q * 3] = pool.p[o] / 1000; P[q * 3 + 1] = pool.p[o + 2] / 1000 * ex; P[q * 3 + 2] = -pool.p[o + 1] / 1000;
        const f = pool.age[i] / pool.life[i];
        const size = (pool.s0[i] + (pool.s1[i] - pool.s0[i]) * Math.sqrt(f)) / 1000;
        const t = pool.type[i];
        let a = pool.col[i * 4 + 3];
        if (sort) a *= Math.min(1, pool.age[i] * 2) * (1 - f * f) * (t === SMOKE ? (1 - 0.6 * f) : 1);
        C[q * 4] = pool.col[i * 4]; C[q * 4 + 1] = pool.col[i * 4 + 1]; C[q * 4 + 2] = pool.col[i * 4 + 2]; C[q * 4 + 3] = a;
        SR[q * 2] = size; SR[q * 2 + 1] = pool.seed[i];
        G[q] = sort ? pool.glow[i] * Math.max(0, 1 - pool.age[i] / 25) : pool.glow[i] * (1 - f * 0.5);
      }
      pool.g.instanceCount = n;
      pool.aPos.needsUpdate = pool.aCol.needsUpdate = pool.aSR.needsUpdate = pool.aGlow.needsUpdate = true;
      for (const [a, k] of [[pool.aPos, 3], [pool.aCol, 4], [pool.aSR, 2], [pool.aGlow, 1]]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n * k)); }
    }
  }
  setLighting(sunV, sunCol, skyCol, fogCol, fogD, camPos) {
    for (const p of [this.smoke, this.glow]) { const u = p.uniforms; u.uSunV.value.copy(sunV); u.uSunCol.value.copy(sunCol); u.uSkyCol.value.copy(skyCol); u.uFogCol.value.copy(fogCol); u.uFogD.value = fogD; u.uCamPos.value.copy(camPos); }
  }
  clear() { this.smoke.count = 0; this.glow.count = 0; this.acc = {}; }
}
