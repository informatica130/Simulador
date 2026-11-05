// =====================================================================
//  Capas vectoriales: red vial OSM (se vuelve roja donde la cortan los
//  flujos), puentes, edificios, ríos, bocas eruptivas, sensores, etiquetas.
// =====================================================================
import * as THREE from 'three';

const ROAD_VS = /* glsl */`
precision highp float; precision highp sampler2D;
attribute float aH; attribute vec2 aCell; attribute float aCls;
uniform sampler2D tTerr, tStatic, tStat, tFluid, tFluidP; uniform float uEx; uniform ivec2 uSimN;
varying vec3 vCol; varying float vCut; varying vec3 vW;
void main(){
  ivec2 c = clamp(ivec2(aCell), ivec2(0), uSimN - 1);
  float d = texelFetch(tTerr, c, 0).r - texelFetch(tStatic, c, 0).r;
  vec4 st = texelFetch(tStat, c, 0), fl = texelFetch(tFluid, c, 0), fp = texelFetch(tFluidP, c, 0);
  float cut = max(max(step(0.5, st.x), step(0.3, st.z)), step(0.3, fp.w));
  float now = max(step(0.2, fl.x), max(step(0.1, fl.z), step(0.1, fp.x)));
  vCut = max(cut, now);
  vec3 base = aCls < 1.5 ? vec3(0.78, 0.68, 0.46) : aCls < 3.5 ? vec3(0.62, 0.60, 0.56) : aCls < 5.5 ? vec3(0.52, 0.49, 0.44) : vec3(0.45, 0.40, 0.33);
  vCol = mix(base, now > 0.5 ? vec3(1.6, 0.1, 0.05) : vec3(1.0, 0.12, 0.08), vCut);
  vec3 p = vec3(position.x, (aH + max(d, 0.0) + 6.0) / 1000.0 * uEx, position.z);
  vW = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const ROAD_FS = /* glsl */`
precision highp float; varying vec3 vCol; varying float vCut; varying vec3 vW; uniform float uOpacity; uniform vec3 uCamPos;
void main(){ float d = length(vW - uCamPos); float a = uOpacity * 0.7 * (1.0 - smoothstep(6.0, 28.0, d)); gl_FragColor = vec4(vCol, max(a, vCut * 0.9)); }`;

const BLD_VS = /* glsl */`
precision highp float; precision highp sampler2D;
attribute vec3 iPos; attribute vec2 iCell;
uniform sampler2D tStat, tFluidP, tAsh, tTerr, tStatic; uniform float uEx; uniform ivec2 uSimN; uniform float uScale;
varying vec3 vCol; varying vec3 vN;
void main(){
  ivec2 c = clamp(ivec2(iCell), ivec2(0), uSimN - 1);
  vec4 st = texelFetch(tStat, c, 0), fp = texelFetch(tFluidP, c, 0), ash = texelFetch(tAsh, c, 0);
  float d = texelFetch(tTerr, c, 0).r - texelFetch(tStatic, c, 0).r;
  vec3 col = vec3(0.92, 0.90, 0.86);
  if (ash.x > 100.0) col = vec3(1.0, 0.6, 0.15);
  if (st.x > 0.5 || st.z > 0.3 || fp.w > 0.3) col = vec3(1.0, 0.12, 0.08);
  vCol = col; vN = normal;
  vec3 p = position * vec3(0.016, 0.009 * uEx, 0.016) * uScale + vec3(iPos.x, (iPos.y + max(d, 0.0)) / 1000.0 * uEx, iPos.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const BLD_FS = /* glsl */`precision highp float; varying vec3 vCol; varying vec3 vN; uniform vec3 uSunDir;
void main(){ float l = 0.55 + 0.45 * max(dot(normalize(vN), uSunDir), 0.0); gl_FragColor = vec4(vCol * l, 1.0); }`;

export function createOverlays(D, solver, hAt, terrainShared) {
  const group = new THREE.Group();
  const net = D.net; const nN = net.nodes.length / 4, nE = net.edges.length / 6;
  const NX = i => net.nodes[i * 4] / 1000, NY = i => net.nodes[i * 4 + 1] / 1000;
  const pos = [], aH = [], aCell = [], aCls = [];
  const push = (x, y, cls) => { pos.push(x, 0, -y); aH.push(hAt(x, y)); const [ci, cj] = solver.cell(x, y); aCell.push(Math.round(ci), Math.round(cj)); aCls.push(cls); };
  const roadsByClass = [];
  for (let e = 0; e < nE; e++) {
    const o = e * 6, a = net.edges[o], b = net.edges[o + 1], cls = net.edges[o + 3];
    const q = net.polys[e]; const pts = [[NX(a), NY(a)]]; let px = 0, py = 0;
    for (let k = 0; k < q.length; k += 2) { if (k === 0) { px = q[0]; py = q[1]; } else { px += q[k]; py += q[k + 1]; } pts.push([px / 1000, py / 1000]); }
    pts.push([NX(b), NY(b)]);
    // densifica para seguir el relieve
    for (let k = 0; k < pts.length - 1; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1]; const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.06));
      for (let s = 0; s < n; s++) { push(x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n, cls); push(x0 + (x1 - x0) * (s + 1) / n, y0 + (y1 - y0) * (s + 1) / n, cls); }
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
  rg.setAttribute('aCell', new THREE.Float32BufferAttribute(aCell, 2)); rg.setAttribute('aCls', new THREE.Float32BufferAttribute(aCls, 1));
  const RU = { tTerr: { value: null }, tStatic: { value: solver.staticTex }, tStat: { value: null }, tFluid: { value: null }, tFluidP: { value: null }, uEx: terrainShared.uEx, uSimN: { value: new THREE.Vector2(solver.nx, solver.ny) }, uOpacity: { value: 0.8 }, uCamPos: terrainShared.uCamPos };
  const roads = new THREE.LineSegments(rg, new THREE.ShaderMaterial({ vertexShader: ROAD_VS, fragmentShader: ROAD_FS, uniforms: RU, transparent: true, depthWrite: false }));
  roads.frustumCulled = false; roads.renderOrder = 3; group.add(roads);
  // ríos (líneas suaves)
  const rp = [];
  for (const r of D.rivers) { const c = r[2]; for (let k = 0; k + 3 < c.length; k += 2) { rp.push(c[k], hAt(c[k], c[k + 1]) / 1000 + 0.004, -c[k + 1], c[k + 2], hAt(c[k + 2], c[k + 3]) / 1000 + 0.004, -c[k + 3]); } }
  const rivG = new THREE.BufferGeometry(); rivG.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  const rivers = new THREE.LineSegments(rivG, new THREE.LineBasicMaterial({ color: 0x4fa3e0, transparent: true, opacity: 0.7, depthWrite: false }));
  rivers.frustumCulled = false; rivers.visible = false; rivers.userData.baseY = rp.filter((_, i) => i % 3 === 1); group.add(rivers);
  // edificios (instancias)
  const bld = D.places.bld, nb = bld.length / 2;
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const ig = new THREE.InstancedBufferGeometry(); ig.index = box.index; ig.attributes.position = box.attributes.position; ig.attributes.normal = box.attributes.normal;
  const ip = new Float32Array(nb * 3), ic = new Float32Array(nb * 2);
  const bpts = [];
  for (let i = 0; i < nb; i++) { const x = bld[i * 2] / 1000, y = bld[i * 2 + 1] / 1000; ip[i * 3] = x; ip[i * 3 + 1] = hAt(x, y); ip[i * 3 + 2] = -y; const [ci, cj] = solver.cell(x, y); ic[i * 2] = Math.round(ci); ic[i * 2 + 1] = Math.round(cj); bpts.push({ x, y }); }
  ig.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 3)); ig.setAttribute('iCell', new THREE.InstancedBufferAttribute(ic, 2)); ig.instanceCount = nb;
  const BU = { tStat: { value: null }, tFluidP: { value: null }, tAsh: { value: null }, tTerr: { value: null }, tStatic: { value: solver.staticTex }, uEx: terrainShared.uEx, uSimN: RU.uSimN, uSunDir: terrainShared.uSunDir, uScale: { value: 1 } };
  const blds = new THREE.Mesh(ig, new THREE.ShaderMaterial({ vertexShader: BLD_VS, fragmentShader: BLD_FS, uniforms: BU }));
  blds.frustumCulled = false; group.add(blds);
  // marcadores de bocas y sensores
  const markers = new THREE.Group(); group.add(markers);
  return {
    group, roads, rivers, blds, markers, bpts,
    bind(sol) { const t = sol.U; RU.tTerr.value = t[2]; RU.tStat.value = t[3]; RU.tFluid.value = t[0]; RU.tFluidP.value = t[1];
      BU.tStat.value = t[3]; BU.tFluidP.value = t[1]; BU.tAsh.value = sol.ashTex; BU.tTerr.value = t[2]; },
    setBuildingScale(s) { BU.uScale.value = s; },
    setRiverEx(ex) { const a = rivers.geometry.attributes.position.array, b = rivers.userData.baseY; for (let i = 0; i < b.length; i++) a[i * 3 + 1] = b[i] * ex; rivers.geometry.attributes.position.needsUpdate = true; },
    setVents(vents, ex) {
      markers.clear();
      return; // sin anillo: la boca se reconoce por la columna y la fuente de lava
      for (const v of vents) {
        const h = hAt(v.x, v.y);
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.05, v.r) * 0.9, Math.max(0.05, v.r) * 1.25, 40), new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(v.x, h / 1000 * ex + 0.02, -v.y); ring.renderOrder = 9; markers.add(ring);
      }
    },
  };
}

// ---------------------------- etiquetas HTML ------------------------------
export class Labels {
  constructor(el, camera, hAt, exRef) { this.el = el; this.cam = camera; this.hAt = hAt; this.ex = exRef; this.items = []; this.v = new THREE.Vector3(); this.tick = 0; }
  add(text, x, y, cls, pri = 1, dz = 30, onClick = null) {
    const d = document.createElement('div'); d.className = 'lbl ' + cls; d.textContent = text; this.el.appendChild(d);
    if (onClick) { d.classList.add('click'); d.addEventListener('click', onClick); }
    const it = { d, x, y, z: this.hAt(x, y) + dz, pri, vis: true, occ: false, text }; this.items.push(it); return it;
  }
  clear(cls) { this.items = this.items.filter(it => { if (it.d.classList.contains(cls)) { it.d.remove(); return false; } return true; }); }
  update(w, h, show) {
    this.tick++;
    const cam = this.cam, ex = this.ex(), cp = cam.position;
    const alt = cp.y / ex * 1000;
    for (const it of this.items) {
      if (!show || it.hidden) { if (it.vis) { it.d.style.display = 'none'; it.vis = false; } continue; }
      this.v.set(it.x, it.z / 1000 * ex, -it.y);
      const dist = this.v.distanceTo(cp);
      const maxD = it.pri === 3 ? 400 : it.pri === 2 ? 60 + alt / 300 : 18 + alt / 900;
      this.v.project(cam);
      const on = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05 && dist < maxD;
      // oclusión por el relieve (cada pocos cuadros)
      if (it.noOcc) it.occ = false;
      else if (on && (this.tick + it.pri) % 6 === 0) {
        let occ = false; const n = 14;
        for (let k = 1; k < n; k++) { const f = k / n; const x = cp.x + (it.x - cp.x) * f, yw = cp.z + (-it.y - cp.z) * f, yy = cp.y + (it.z / 1000 * ex - cp.y) * f;
          if (this.hAt(x, -yw) / 1000 * ex > yy + 0.01) { occ = true; break; } }
        it.occ = occ;
      }
      const show2 = on && !it.occ;
      if (show2 !== it.vis) { it.d.style.display = show2 ? '' : 'none'; it.vis = show2; }
      if (show2) it.d.style.transform = `translate(${((this.v.x + 1) / 2 * w) | 0}px,${((1 - this.v.y) / 2 * h) | 0}px) translate(-50%,-100%)`;
    }
  }
}
