// =====================================================================
//  Bosque 3D alrededor de la cámara (instancias): araucaria araucana en
//  las laderas medias del Llaima y Conguillío (900–1.750 m), lenga en la
//  zona alta y coigüe / roble en los valles. La ubicación sigue la
//  cobertura vegetal detectada en la imagen; el color de la copa viene
//  de la propia imagen satelital. Cada árbol reacciona a la simulación:
//  se quema, se cubre de ceniza o es arrasado por lava, lahar o CDP.
// =====================================================================
import * as THREE from 'three';
import { COMMON_GLSL } from './terrain.js';

function mergeParts(parts) {
  // parts: [{geo, color:[r,g,b], crown:0|1}]
  const pos = [], nrm = [], col = [], crown = [], idx = [];
  let off = 0;
  for (const p of parts) {
    const g = p.geo.index ? p.geo : p.geo; const a = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < a.count; i++) { pos.push(a.getX(i), a.getY(i), a.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(...p.color); crown.push(p.crown); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < a.count; i++) idx.push(i + off);
    off += a.count;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aCrown', new THREE.Float32BufferAttribute(crown, 1)); g.setIndex(idx);
  return g;
}
function jitter(geo, amt, seed) {
  // desplazamiento determinado por la posición: los vértices compartidos se mueven igual (sin grietas)
  const a = geo.attributes.position;
  const hsh = (x, y, z, k) => { const v = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 991) * 78.233 + Math.round(z * 983) * 37.719 + seed * 4.1 + k) * 43758.5453; return v - Math.floor(v) - 0.5; };
  for (let i = 0; i < a.count; i++) { const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    a.setXYZ(i, x * (1 + hsh(x, y, z, 1) * amt), y * (1 + hsh(x, y, z, 2) * amt * 0.6), z * (1 + hsh(x, y, z, 3) * amt)); }
  geo.computeVertexNormals(); return geo;
}
// Alto normalizado = 1
function araucaria() {
  const trunk = new THREE.CylinderGeometry(0.014, 0.026, 0.84, 6, 1, true); trunk.translate(0, 0.42, 0);
  const parts = [{ geo: trunk, color: [0.055, 0.047, 0.040], crown: 0 }];
  // copa en forma de paraguas (araucaria adulta): pisos de ramas horizontales en el tercio superior
  for (let k = 0; k < 4; k++) {
    const c = new THREE.SphereGeometry(0.27 - k * 0.05, 11, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    c.scale(1, 0.30, 1); c.translate(0, 0.70 + k * 0.075, 0); jitter(c, 0.22, 7 + k);
    parts.push({ geo: c, color: [0.040, 0.065, 0.030], crown: 1 });
  }
  return mergeParts(parts);
}
function nothofagus() {
  const trunk = new THREE.CylinderGeometry(0.016, 0.03, 0.55, 6, 1, true); trunk.translate(0, 0.27, 0);
  const parts = [{ geo: trunk, color: [0.06, 0.05, 0.042], crown: 0 }];
  const blobs = [[0, 0.62, 0, 0.30], [0.14, 0.5, 0.06, 0.22], [-0.12, 0.54, -0.08, 0.23], [0.03, 0.82, 0.04, 0.2], [-0.05, 0.45, 0.14, 0.2]];
  blobs.forEach(([x, y, z, r], k) => { const c = new THREE.IcosahedronGeometry(r, 1); c.scale(1, 0.85, 1); c.translate(x, y, z); jitter(c, 0.3, 31 + k); parts.push({ geo: c, color: [0.036, 0.062, 0.024], crown: 1 }); });
  return mergeParts(parts);
}

const VS = /* glsl */`
precision highp float; precision highp sampler2D;
attribute vec3 aCol; attribute float aCrown;
attribute vec4 iP; attribute vec4 iC; // iP: x(km), y(km), z suelo (m), altura (m) · iC: color de copa, rotación
uniform sampler2D tTerr, tStatic, tStat, tFluidP, tAsh, tFire; uniform ivec2 uSimN; uniform int uS; uniform vec4 uGrid;
uniform float uEx; uniform vec3 uCenter; uniform float uRadius; uniform float uTime;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vFade; varying float vBurn; varying float vCrown;
vec4 simN(sampler2D t, vec2 xy){ vec2 c = vec2((xy.x - uGrid.x) / uGrid.z, (uGrid.y - xy.y) / uGrid.z); c = (c - 0.5 * float(uS - 1)) / float(uS);
  return texelFetch(t, clamp(ivec2(floor(c + 0.5)), ivec2(0), uSimN - 1), 0); }
void main(){
  vec2 xy = iP.xy;
  vec4 st = simN(tStat, xy), fp = simN(tFluidP, xy), fi = simN(tFire, xy), ash = simN(tAsh, xy);
  float dl = simN(tTerr, xy).r - simN(tStatic, xy).r;
  float gone = max(max(step(0.3, st.z), step(0.6, fp.w)), step(2.5, st.x));     // lava, CDP o lahar profundo arrasan el bosque
  float burned = max(fi.z, step(0.5, fi.y) * 0.6);
  float leafless = smoothstep(0.4, 0.9, burned) + step(0.2, fp.w);
  float sc = (1.0 - gone) * (aCrown > 0.5 ? (1.0 - clamp(leafless, 0.0, 1.0) * 0.85) : 1.0);
  float h = iP.w;
  float c = cos(iC.w), s = sin(iC.w);
  vec3 lp = position; lp.xz = mat2(c, -s, s, c) * lp.xz;
  // balanceo con el viento
  lp.x += sin(uTime * 1.3 + iC.w * 7.0) * 0.012 * lp.y * lp.y * aCrown;
  vec3 wp = vec3(xy.x + lp.x * h * 0.001 * sc, (iP.z + max(dl, 0.0) * 0.5 + lp.y * h * sc) / 1000.0 * uEx, -(xy.y) + lp.z * h * 0.001 * sc);
  vec3 n = normal; n.xz = mat2(c, -s, s, c) * n.xz;
  vN = normalize(vec3(n.x, n.y / uEx, n.z));
  vec3 crownC = aCol * mix(vec3(1.0), iC.rgb, 0.4);
  crownC = mix(vec3(dot(crownC, vec3(0.33))), crownC, 0.75);
  vec3 cc = aCrown > 0.5 ? crownC : aCol;
  cc = mix(cc, vec3(0.03, 0.025, 0.02), clamp(burned, 0.0, 1.0) * 0.9);
  cc = mix(cc, vec3(0.42, 0.40, 0.38), smoothstep(5.0, 60.0, ash.x) * 0.85);
  vCol = cc; vBurn = step(0.5, fi.y); vCrown = aCrown;
  vW = wp;
  float d = length(vec2(wp.x - uCenter.x, wp.z - uCenter.z));
  vFade = 1.0 - smoothstep(uRadius * 0.75, uRadius, d);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
}`;
const FS = /* glsl */`
precision highp float;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vFade; varying float vBurn; varying float vCrown;
uniform float uEx;
` + COMMON_GLSL + /* glsl */`
void main(){
  if (vFade < 0.02) discard;
  // desvanecimiento por tramado (sin ordenar transparencias)
  float th = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (th > vFade) discard;
  vec3 N = normalize(vN);
  // follaje: racimos con huecos (se ve el cielo entre las ramas) y autosombra interior
  float leaf = 1.0;
  if (vCrown > 0.5) {
    vec3 q = vW * vec3(900.0, 900.0 / uEx, 900.0);
    float n = vnoise(q.xz + q.y * 1.7) * 0.6 + vnoise(q.zy * 1.9 - q.x) * 0.4;
    float camD = length(uCamPos - vW);
    if (n < 0.34 * (1.0 - smoothstep(0.3, 1.2, camD))) discard;
    leaf = 0.55 + 0.7 * n;
    N = normalize(N + vec3(n - 0.5, 0.0, vnoise(q.xy) - 0.5) * 0.9);
  }
  float ndl = max(dot(N, uSunDir), 0.0);
  float wrap = max(dot(N, uSunDir) * 0.6 + 0.4, 0.0) * vCrown + ndl * (1.0 - vCrown);
  vec3 V = normalize(uCamPos - vW);
  float trans = pow(max(dot(-V, uSunDir), 0.0), 4.0) * 0.35 * vCrown;   // luz a través de las hojas
  vec3 col = vCol * leaf * (uSunCol * (wrap * 0.85 + trans) + uSkyCol * (0.55 + 0.35 * N.y) * 0.9);
  col += vCol * glowLight(vW, N);
  if (vBurn > 0.5) col += vec3(1.0, 0.35, 0.06) * 2.5 * (0.5 + 0.5 * sin(uTime * 17.0 + vW.x * 900.0));
  col = fogApply(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Forest {
  constructor(scene, D, solver, hAt, shared, maxN = 70000) {
    this.D = D; this.hAt = hAt; this.maxN = maxN; this.center = null; this.R = 0;
    const U = { ...shared, tTerr: { value: null }, tStatic: { value: solver.staticTex }, tStat: { value: null }, tFluidP: { value: null }, tAsh: { value: null }, tFire: { value: null },
      uSimN: { value: new THREE.Vector2(solver.nx, solver.ny) }, uS: { value: solver.s }, uGrid: { value: new THREE.Vector4(D.GR.X0, D.GR.Y1, D.GR.cell, 0) }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 4 } };
    this.U = U;
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
    this.meshes = [araucaria(), nothofagus()].map(g => {
      const iP = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 4), 4), iC = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 4), 4);
      g.setAttribute('iP', iP); g.setAttribute('iC', iC); g.instanceCount = 0;
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 1; scene.add(m);
      return { m, g, iP, iC };
    });
    this.visible = true;
  }
  bind(sol) { const t = sol.U; this.U.tTerr.value = t[2]; this.U.tStat.value = t[3]; this.U.tFluidP.value = t[1]; this.U.tAsh.value = sol.ashTex; this.U.tFire.value = sol.fireTex; }
  // Redistribuye los árboles alrededor del punto (km) si la cámara se movió lo suficiente
  update(cx, cy, alt) {
    const show = this.visible && alt < 9000;
    for (const m of this.meshes) m.m.visible = show;
    if (!show) return;
    const R = Math.max(1.2, Math.min(4.5, alt / 1000 * 1.1 + 0.8));
    this.U.uCenter.value.set(cx, 0, -cy); this.U.uRadius.value = R;
    if (this.center && Math.hypot(cx - this.center[0], cy - this.center[1]) < R * 0.25 && Math.abs(R - this.R) < R * 0.3) return;
    this.center = [cx, cy]; this.R = R;
    const D = this.D, G = D.GR;
    const sp = R > 3 ? 0.036 : 0.026;                  // separación entre árboles (km)
    const n = [0, 0];
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const x0 = Math.floor((cx - R) / sp), x1 = Math.ceil((cx + R) / sp), y0 = Math.floor((cy - R) / sp), y1 = Math.ceil((cy + R) / sp);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      seed = ((gx * 73856093) ^ (gy * 19349663)) & 0x7fffffff || 1; rnd(); rnd();
      const x = (gx + rnd()) * sp, y = (gy + rnd()) * sp;
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      const i = Math.round((x - G.X0) / G.cell), j = Math.round((G.Y1 - y) / G.cell);
      if (i < 0 || j < 0 || i >= D.nx || j >= D.ny) continue;
      const f = D.fuel[j * D.nx + i];
      if (f < 0.25 || rnd() > f * 1.05) continue;
      // no en lagos ni cauces
      const i3 = Math.round((x - G.X0) / D.cell30), j3 = Math.round((G.Y1 - y) / D.cell30);
      if (D.det30[(j3 * D.nx30 + i3) * 4 + 3] > 60 || D.river[j * D.nx + i]) continue;
      const z = this.hAt(x, y);
      const [r, g, b] = D.satAt(x, y);
      const green = g - Math.max(r, b);
      if (green < -0.015) continue;
      const arau = z > 950 && z < 1780 && rnd() < 0.55 + 0.3 * Math.min(1, (z - 950) / 400);
      const t = arau ? 0 : 1;
      if (n[t] >= this.maxN) continue;
      const h = arau ? 22 + 18 * rnd() : (z > 1300 ? 9 + 8 * rnd() : 18 + 16 * rnd());
      const m = this.meshes[t], k = n[t]++;
      m.iP.array.set([x, y, z, h], k * 4);
      // matiz de la copa según la imagen (normalizado), con variación individual
      const br = Math.max(0.04, (r + g + b) / 3), v = 0.75 + 0.5 * rnd();
      m.iC.array.set([v * Math.min(1.6, r / br), v * Math.min(1.6, g / br) * (0.9 + 0.2 * rnd()), v * Math.min(1.6, b / br), rnd() * 6.283], k * 4);
    }
    this.meshes.forEach((m, t) => { m.g.instanceCount = n[t]; m.iP.needsUpdate = true; m.iC.needsUpdate = true; });
    this.count = n[0] + n[1];
  }
}
