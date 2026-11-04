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

const SMOKE = 0, ASHF = 1, STEAM = 2, PDC = 3, FSMOKE = 4, DUST = 5, SPRAY = 6, FUM = 7, GAS = 8;
const SPARK = 0, BOMB = 1, FLAME = 2, EMBER = 3;

const PVS = /* glsl */`
precision highp float;
attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSR; attribute float iGlow; attribute vec2 iMisc; attribute vec3 iVel; uniform float uStreak;
varying vec2 vUv; varying vec4 vCol; varying float vGlow; varying vec3 vWp; varying float vSeed; varying float vAge; varying float vShade; varying vec3 vView;
void main(){
  vUv = position.xy * 0.5 + 0.5; vCol = iCol; vGlow = iGlow; vWp = iPos; vSeed = iSR.y; vAge = iMisc.x; vShade = iMisc.y;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0); vView = mv.xyz;
  float c = cos(iSR.y * 6.283), s = sin(iSR.y * 6.283);
  vec2 q = mat2(c, -s, s, c) * position.xy;
  if (uStreak > 0.0) {
    // estela de movimiento: el sprite se alarga en la dirección de la velocidad proyectada
    vec2 vv = (modelViewMatrix * vec4(iVel, 0.0)).xy; float L = length(vv) * uStreak;
    vec2 ax = L > 1e-6 ? vv / length(vv) : vec2(1.0, 0.0);
    q = ax * position.x * (iSR.x + L) + vec2(-ax.y, ax.x) * position.y * iSR.x;
    mv.xy += q;
  } else mv.xy += q * iSR.x;
  gl_Position = projectionMatrix * mv;
}`;
const SMOKE_FS = /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vCol; varying float vGlow; varying vec3 vWp; varying float vSeed; varying float vAge; varying float vShade; varying vec3 vView;
uniform vec3 uSunV; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uFogCol; uniform float uFogD; uniform vec3 uCamPos; uniform float uAshHaze; uniform float uTime;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; } return s; }
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  if (r > 1.0) discard;
  // turbulencia que evoluciona en el tiempo (deformación de dominio)
  float t = uTime * 0.035 + vSeed * 10.0;
  vec2 q = vUv * 2.6 + vSeed * 31.0;
  vec2 w = vec2(fbm3(q + t), fbm3(q - t + 5.2));
  float n = fbm3(q * 1.5 + w * 1.7 + t * 0.4);
  // voluta tipo coliflor: racimo de lóbulos, cada uno con su propia normal (luz y sombra)
  float best = 1.0 - r / 0.62; vec2 cb = vec2(0.0); float rb = 0.62;
  for (int k = 0; k < 5; k++) {
    float a = vSeed * 40.0 + float(k) * 1.2566 + uTime * 0.01;
    float rad = 0.36 + 0.14 * fract(vSeed * 7.0 + float(k) * 0.37);
    vec2 c = vec2(cos(a), sin(a)) * (0.62 - rad) * 1.25;
    float v = 1.0 - length(p - c) / rad;
    if (v > best) { best = v; cb = c; rb = rad; }
  }
  float base = smoothstep(0.0, 0.42, best + (n - 0.5) * 0.6);
  float er = mix(0.05, 0.45, vAge * vAge);
  float dens = smoothstep(er, er + 0.34, base * (0.5 + 1.0 * n) - 0.06) * smoothstep(1.0, 0.7, r);
  if (dens < 0.01) discard;
  vec2 lp = (p - cb) / rb;
  vec3 nrm = normalize(vec3(lp * 0.9 + (w - 0.5) * 0.8, sqrt(max(0.0, 1.0 - dot(lp, lp))) + 0.15));
  float lam = 0.38 + 0.62 * max(dot(nrm, uSunV), 0.0);
  float mu = dot(normalize(vView), uSunV);
  float g = 0.62, hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.075;
  float thick = dens * vCol.a;
  vec3 sunL = uSunCol * (pow(lam, 1.4) * 0.62 + hg * (1.15 - thick) * 1.4) * vShade;
  vec3 c = vCol.rgb * (sunL + uSkyCol * (0.55 + 0.3 * nrm.y) * vec3(0.9, 0.95, 1.08) + 0.01);
  c += vec3(1.0, 0.38, 0.09) * vGlow * (0.6 + 0.4 * (1.0 - nrm.y)) * 1.4;
  float d = length(vWp - uCamPos);
  c = mix(c, uFogCol, clamp(1.0 - exp(-d * uFogD), 0.0, 1.0));
  gl_FragColor = vec4(c, dens * vCol.a);
}`;
const GLOW_FS = /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vCol; varying float vGlow; varying vec3 vWp; varying float vSeed; uniform float uNight;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = dot(p, p);
  if (r > 1.0) discard;
  float a = (exp(-r * mix(9.0, 5.0, uNight)) + mix(0.04, 0.22, uNight) * exp(-r * 1.4)) * (1.0 - smoothstep(0.6, 1.0, r)) * mix(0.55, 1.0, uNight);
  gl_FragColor = vec4(vCol.rgb * vGlow * a, 1.0);
}`;

class Pool {
  constructor(n, fs, blending, scene) {
    this.n = n; this.count = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.age = new Float32Array(n); this.life = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.type = new Uint8Array(n); this.col = new Float32Array(n * 4); this.seed = new Float32Array(n); this.glow = new Float32Array(n); this.drag = new Float32Array(n); this.shade = new Float32Array(n).fill(1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aGlow = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iSR', this.aSR); g.setAttribute('iGlow', this.aGlow); g.setAttribute('iMisc', this.aMisc); g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.uniforms = { uSunV: { value: new THREE.Vector3(0, 0, 1) }, uSunCol: { value: new THREE.Color() }, uSkyCol: { value: new THREE.Color() }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.006 }, uCamPos: { value: new THREE.Vector3() }, uAshHaze: { value: 0 }, uTime: { value: 0 }, uStreak: { value: 0 }, uNight: { value: 1 } };
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
    this.col[i * 4] = r; this.col[i * 4 + 1] = gg; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a; this.seed[i] = Math.random(); this.glow[i] = glow; this.drag[i] = drag; this.shade[i] = 1;
    return i;
  }
  kill(i) {
    const j = --this.count; if (i === j) return;
    for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[j * 3 + k]; this.v[i * 3 + k] = this.v[j * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.type[i] = this.type[j]; this.seed[i] = this.seed[j]; this.glow[i] = this.glow[j]; this.drag[i] = this.drag[j]; this.shade[i] = this.shade[j];
  }
}

export class FX {
  constructor(scene, hAt) {
    this.hAt = hAt; // altura del terreno en (x km, y km) → m
    this.smoke = new Pool(14000, SMOKE_FS, THREE.NormalBlending, scene);
    this.glow = new Pool(8000, GLOW_FS, THREE.AdditiveBlending, scene);
    this.smoke.mesh.renderOrder = 5; this.glow.mesh.renderOrder = 6; this.glow.uniforms.uStreak.value = 0.045; this.night = 1;
    this.ex = 1.5; this.acc = {}; this.events = [];
    // rayos
    this.boltGeo = new THREE.BufferGeometry(); this.boltPos = new Float32Array(600 * 3);
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.boltGeo.setDrawRange(0, 0);
    this.bolt = new THREE.LineSegments(this.boltGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(4, 3.6, 5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.bolt.frustumCulled = false; scene.add(this.bolt);
    this.boltLife = 0; this.flash = null; this.pulseT = 0; this.boom = 0;
    this.spots = { lavaSnow: [], pdc: [], fire: [], mud: [], lava: [] };
    // Bocas de desgasificación: conos anidados en el cráter principal (2008–09), borde del cráter y Pichillaima
    this.fumaroles = [[0.03, 0.0, 0.42], [-0.04, 0.06, 0.16], [0.10, -0.05, 0.14], [-0.08, -0.07, 0.08], [0.13, 0.08, 0.07], [0.03, -0.12, 0.08], [-0.12, 0.02, 0.05], [0.36, -1.08, 0.02]];
    this.fumF = 300; this.fumDh = 150; this.fumL = 400; this.sunW = [0, 0, 1];
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
    const dens = this.density ?? 1;
    const emit = (key, rate) => { this.acc[key] = (this.acc[key] || 0) + rate * dtv * dens; const n = Math.floor(this.acc[key]); this.acc[key] -= n; return Math.min(n, 400); };
    // ---------------- columna eruptiva
    if (s.MER > 50 && P) {
      const lg = Math.log10(s.MER);
      let n = emit('plume', (30 + 26 * (lg - 2)) * 1.5);
      const steamy = ctx.phreatic ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const v = vents[(rnd() * vents.length) | 0] || v0;
        const r = P.b0 * Math.sqrt(rnd()), a = rnd() * 6.283;
        const up = P.U0 * (0.6 + 0.4 * rnd());
        const tone = 0.9 + 0.2 * rnd();
        const c = steamy ? [0.80, 0.80, 0.82] : [0.26 * tone, 0.225 * tone, 0.19 * tone];
        this.smoke.add(v.x * 1000 + Math.cos(a) * r, v.y * 1000 + Math.sin(a) * r, this.hAt(v.x, v.y) + 30, (rnd() - 0.5) * 30, (rnd() - 0.5) * 30, up, 320 + 520 * rnd(), Math.max(70, P.b0 * 2.1), 430, SMOKE, c[0], c[1], c[2], 0.92, 0);
      }
      // lluvia de ceniza bajo la nube paraguas
      n = emit('ashf', Math.max(0, 4 * (lg - 4)));
      for (let k = 0; k < n; k++) {
        const d = (P.xTop + rnd() * (8000 + 25000 * rnd()));
        const lat = (rnd() - 0.5) * (2500 + d * 0.25);
        const x = vx0 + wx * d + wy * lat, y = vy0 + wy * d - wx * lat;
        const z = P.Ht * (0.55 + 0.3 * rnd());
        this.smoke.add(x, y, z, wx * vref * 0.5, wy * vref * 0.5, -(6 + 10 * rnd()), 900, 90, 160, ASHF, 0.30, 0.28, 0.27, 0.05);
      }
    }
    // resplandor que ilumina la base de la columna desde abajo (de noche se ve naranja)
    this.ventGlow = Math.min(1.6, (s.fountain > 0 ? s.fountain / 350 : 0) + (s.MER > 1e4 ? Math.log10(s.MER / 1e4) * 0.18 : 0) + this.boom * 0.5);
    this.zVent = vz0; this.vx0 = vx0; this.vy0 = vy0;
    // ---------------- fuente de lava
    if (s.fountain > 20) {
      const vF = Math.sqrt(2 * 9.81 * s.fountain);
      const n = emit('fount', 120 + s.fountain * 0.5);
      // halo incandescente sobre la boca
      const nh = emit('halo', 3);
      for (let k = 0; k < nh; k++) this.glow.add(vx0 + (rnd() - 0.5) * 80, vy0 + (rnd() - 0.5) * 80, vz0 + s.fountain * (0.2 + 0.4 * rnd()), 0, 0, 2, 2.5, s.fountain * (0.5 + 0.4 * rnd()), s.fountain * 0.8, FLAME, 1, 0.42, 0.12, 1, 0.1);
      for (let k = 0; k < n; k++) {
        const v = vents[(rnd() * vents.length) | 0] || v0;
        const th = (1 - Math.pow(rnd(), 2)) * 0.25, a = rnd() * 6.283, sp = vF * (0.55 + 0.5 * rnd());
        this.glow.add(v.x * 1000 + (rnd() - 0.5) * 60, v.y * 1000 + (rnd() - 0.5) * 60, this.hAt(v.x, v.y) + 15,
          Math.sin(th) * Math.cos(a) * sp, Math.sin(th) * Math.sin(a) * sp, Math.cos(th) * sp, 30, 26 + 34 * rnd(), 10, SPARK, 1, 0.5 + 0.25 * rnd(), 0.14, 1, 2.2, 0.004);
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
    // ---------------- fumarolas: pluma boyante de vapor (Briggs 1975) con condensación
    // Q: flujo de calor (MW) → flujo de flotabilidad F = g·Q/(π·cp·ρ·T) (m⁴/s³)
    const fm = ctx.fum || { Q: 40, rh: 0.7, Ta: 268 };
    const Qw = fm.Q * 1e6 * (ctx.fumarole ?? 1);
    const F = 9.81 * Qw / (Math.PI * 1005 * 0.9 * fm.Ta);
    const uLow = Math.max(1.2, windAt(3200, vref) * 0.55);
    const sStab = 9.81 / fm.Ta * 0.0033;
    this.fumF = F; this.fumU = uLow;
    this.fumDh = 2.6 * Math.cbrt(F / (uLow * sStab));        // ascenso final en atmósfera estable
    // visibilidad del vapor condensado: crece con la humedad y el frío
    this.fumL = (110 + 1500 * Math.pow(fm.rh, 4)) * (1 + Math.max(0, 275 - fm.Ta) / 25);
    const rate = (2 + 2.6 * Math.sqrt(Qw / 1e7)) * ((s.MER > 50 || s.E > 0.5) ? 0.12 : 1);
    for (let q = 0; q < this.fumaroles.length; q++) {
      const [fx, fy, wgt] = this.fumaroles[q];
      const n = emit('fum' + q, rate * wgt * 6);
      for (let k = 0; k < n; k++) {
        const z0 = this.hAt(fx, fy) + 4;
        const i = this.smoke.add(fx * 1000 + (rnd() - 0.5) * 50, fy * 1000 + (rnd() - 0.5) * 50, z0, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2, 4 + 6 * rnd(),
          120 + 160 * rnd(), 14 + 10 * rnd(), 0, FUM, 0.93, 0.94, 0.96, 0.34);
        if (i >= 0) this.smoke.drag[i] = z0;
      }
    }
    // bruma de SO₂ / sulfatos: azulada, tenue y persistente a sotavento
    const ng = emit('gas', 0.07 * Math.sqrt(Qw / 1e7));
    for (let k = 0; k < ng; k++) { const zt = this.hAt(0, 0) + this.fumDh * (0.7 + 0.5 * rnd());
      this.smoke.add((rnd() - 0.5) * 300, (rnd() - 0.5) * 300, zt, wx * uLow, wy * uLow, 0, 900 + 600 * rnd(), 200, 900, GAS, 0.66, 0.70, 0.80, 0.010); }
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
        if (pl && z < P.Hnb && S.age[i] < 500) {
          // velocidad local de la pluma
          const cx = vx0 + wx * pl.x, cy = vy0 + wy * pl.x;
          const sth = Math.sin(pl.th), cth = Math.cos(pl.th);
          const tvz = Math.max(pl.U * sth, 6), th = pl.U * cth;
          let tvx = wx * th, tvy = wy * th;
          const dx = x - cx, dy = y - cy, rr = Math.hypot(dx, dy) + 1;
          const pull = rr > pl.b ? -0.25 * (rr - pl.b) : 0.06 * pl.U;
          tvx += dx / rr * pull + (Math.random() - 0.5) * pl.U * 0.6; tvy += dy / rr * pull + (Math.random() - 0.5) * pl.U * 0.6;
          const k = Math.min(1, dt * 1.6);
          vx += (tvx - vx) * k; vy += (tvy - vy) * k; vz += (tvz - vz) * k;
          S.s1[i] = Math.min(Math.max(S.s1[i], pl.b * 1.05 + 100), 950);
          // autosombra: el lado de la columna que mira al sol queda más iluminado
          const sw = this.sunW; S.shade[i] = 0.45 + 0.55 * Math.max(-1, Math.min(1, (dx * sw[0] + dy * sw[1]) / rr * 1.4 + sw[2] * 0.3));
          const hf = Math.max(0, Math.min(1, (z - this.zVent) / Math.max(1500, P.Ht - this.zVent)));
          const ci = i * 4; S.col[ci] = 0.24 + 0.30 * hf; S.col[ci + 1] = 0.21 + 0.28 * hf; S.col[ci + 2] = 0.18 + 0.26 * hf;
        } else {
          // nube paraguas: corriente de gravedad radial + viento
          const cx = vx0 + wx * P.xTop, cy = vy0 + wy * P.xTop;
          const dx = x - cx, dy = y - cy, rr = Math.hypot(dx, dy) + 1;
          const ur = 25 / (1 + rr / 6000);
          const k = Math.min(1, dt * 0.5);
          vx += (wx * W + dx / rr * ur - vx) * k; vy += (wy * W + dy / rr * ur - vy) * k;
          vz += ((P.Hnb + (P.Ht - P.Hnb) * 0.5 - z) * 0.01 - vz) * k;
          S.s1[i] = Math.min(Math.max(S.s1[i], 900 + S.age[i] * 1.5), 1600);
        }
      } else if (t === FUM) {
        // ascenso de Briggs: z − z0 = 1,6·F^(1/3)·x^(2/3)/u con x = u·t, hasta el ascenso final
        const z0 = S.drag[i], rise = z - z0, age = Math.max(0.5, S.age[i]);
        const u = this.fumU * (1 + rise / 900);
        let w = 1.0667 * Math.cbrt(this.fumF) / Math.cbrt(u) / Math.cbrt(age);
        if (rise > this.fumDh) w = -0.004 * (rise - this.fumDh) * 2;
        const k = Math.min(1, dt * 0.8);
        vz += (w - vz) * k;
        const turb = 0.25 * u + 0.3 * Math.abs(w);
        vx += (wx * u - vx) * k + (Math.random() - 0.5) * turb * dt * 2.2;
        vy += (wy * u - vy) * k + (Math.random() - 0.5) * turb * dt * 2.2;
        S.s1[i] = 18 + 0.62 * Math.max(0, rise) + 0.06 * S.age[i] * u;
        S.s0[i] = S.s1[i];
      } else if (t === GAS) {
        vx += (wx * this.fumU * 1.3 - vx) * dt * 0.1; vy += (wy * this.fumU * 1.3 - vy) * dt * 0.1; vz *= 1 - dt * 0.2;
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
        const size = (pool.s0[i] + (pool.s1[i] - pool.s0[i]) * Math.sqrt(f)) / 1000 * (sort ? 1 : (this.glowSize ?? 1));
        const t = pool.type[i];
        let a = pool.col[i * 4 + 3];
        if (sort) {
          a *= Math.min(1, pool.age[i] * 2) * (1 - f * f) * (t === SMOKE ? (1 - 0.6 * f) : 1);
          if (t === FUM) { const dist = pool.age[i] * this.fumU * 1.1 + Math.max(0, pool.p[i * 3 + 2] - pool.drag[i]) * 0.5; a *= Math.exp(-dist / this.fumL) * Math.min(1, pool.age[i] * 0.8); }
          // partículas suaves: se desvanecen al tocar el relieve
          const gz = this.hAt(pool.p[i * 3] / 1000, pool.p[i * 3 + 1] / 1000), half = size * 500;
          a *= Math.max(0, Math.min(1, (pool.p[i * 3 + 2] - gz + half * 0.2) / half));
          const cd = Math.hypot(P[q * 3] - cam.x, P[q * 3 + 1] - cam.y, P[q * 3 + 2] - cam.z); a *= Math.min(1, cd / Math.max(0.05, size * 1.5));
        }
        C[q * 4] = pool.col[i * 4]; C[q * 4 + 1] = pool.col[i * 4 + 1]; C[q * 4 + 2] = pool.col[i * 4 + 2]; C[q * 4 + 3] = a;
        SR[q * 2] = size; SR[q * 2 + 1] = pool.seed[i];
        G[q] = sort ? (t === SMOKE ? (this.ventGlow || 0) * (this.ventK ?? 1) * (0.1 + 0.9 * this.night) * Math.exp(-Math.max(0, pool.p[i * 3 + 2] - (this.zVent || 0)) / 900) : pool.glow[i] * Math.max(0, 1 - pool.age[i] / 25)) : pool.glow[i] * (1 - f * 0.5) * (t === FLAME ? (this.haloK ?? 1) : 1);
        pool.aMisc.array[q * 2] = f; pool.aMisc.array[q * 2 + 1] = pool.shade[i];
        if (!sort) { const V = pool.aVel.array; V[q * 3] = pool.v[o] / 1000; V[q * 3 + 1] = pool.v[o + 2] / 1000 * ex; V[q * 3 + 2] = -pool.v[o + 1] / 1000; }
      }
      pool.g.instanceCount = n;
      pool.aPos.needsUpdate = pool.aCol.needsUpdate = pool.aSR.needsUpdate = pool.aGlow.needsUpdate = pool.aMisc.needsUpdate = pool.aVel.needsUpdate = true;
      for (const [a, k] of [[pool.aPos, 3], [pool.aCol, 4], [pool.aSR, 2], [pool.aGlow, 1], [pool.aMisc, 2], [pool.aVel, 3]]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n * k)); }
    }
  }
  setLighting(sunV, sunCol, skyCol, fogCol, fogD, camPos, sunW, time) {
    if (sunW) this.sunW = [sunW.x, -sunW.z, sunW.y];
    this.glow.uniforms.uNight.value = this.night ?? 1;
    for (const p of [this.smoke, this.glow]) { const u = p.uniforms; u.uTime.value = time || 0; u.uSunV.value.copy(sunV); u.uSunCol.value.copy(sunCol); u.uSkyCol.value.copy(skyCol); u.uFogCol.value.copy(fogCol); u.uFogD.value = fogD; u.uCamPos.value.copy(camPos); }
  }
  clear() { this.smoke.count = 0; this.glow.count = 0; this.acc = {}; }
}
