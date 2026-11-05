// =====================================================================
//  Nubes volumétricas por raymarching: columna eruptiva, nube paraguas,
//  nube de ceniza a la deriva, cortinas de caída de ceniza y pluma de
//  vapor de la fumarola.
//  - La forma sale de los modelos físicos (pluma integral de Woodhouse
//    2013 para la columna; ascenso de Briggs para el vapor; corriente de
//    gravedad para el paraguas) y el detalle de «coliflor» de ruido 3D de
//    Worley invertido que asciende con la velocidad local de la pluma.
//  - Luz: dispersión simple con sombra hacia el sol (Beer–Lambert), fase
//    Henyey–Greenstein de dos lóbulos, efecto «polvo» en los bordes, cielo
//    y resplandor incandescente desde la boca; rayos que iluminan la nube.
//  - Se calcula a resolución reducida y se compone sobre la escena; el
//    relieve ocluye la nube muestreando el DEM de 30 m dentro del rayo.
// =====================================================================
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { plumeLookup, windAt } from './plume.js';

const NP = 192; // muestras del perfil de la pluma

// ------------------------------------------------------------- ruido 3D
function makeNoise(N = 64) {
  const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  // Worley periódico con C celdas por lado
  const worley = (C) => {
    const pts = new Float32Array(C * C * C * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = rnd();
    const out = new Float32Array(N * N * N);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / N * C, py = (y + 0.5) / N * C, pz = (z + 0.5) / N * C;
      const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
      let d = 9;
      for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const ix = cx + i, iy = cy + j, iz = cz + k;
        const w = (((iz % C) + C) % C * C + ((iy % C) + C) % C) * C + ((ix % C) + C) % C;
        const dx = ix + pts[w * 3] - px, dy = iy + pts[w * 3 + 1] - py, dz = iz + pts[w * 3 + 2] - pz;
        const dd = dx * dx + dy * dy + dz * dz; if (dd < d) d = dd;
      }
      out[(z * N + y) * N + x] = Math.min(1, Math.sqrt(d));
    }
    return out;
  };
  // ruido de valor periódico (para variar el tamaño de los lóbulos)
  const value = (C) => {
    const g = new Float32Array(C * C * C); for (let i = 0; i < g.length; i++) g[i] = rnd();
    const out = new Float32Array(N * N * N), at = (x, y, z) => g[(((z % C) + C) % C * C + ((y % C) + C) % C) * C + ((x % C) + C) % C];
    const sm = t => t * t * (3 - 2 * t);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = x / N * C, py = y / N * C, pz = z / N * C, ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
      const fx = sm(px - ix), fy = sm(py - iy), fz = sm(pz - iz);
      const l = (a, b, t) => a + (b - a) * t;
      out[(z * N + y) * N + x] = l(l(l(at(ix, iy, iz), at(ix + 1, iy, iz), fx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), fx), fy),
        l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), fx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), fx), fy), fz);
    }
    return out;
  };
  const w4 = worley(4), w8 = worley(8), w16 = worley(16), w32 = worley(32), v4 = value(4), v8 = value(8);
  const data = new Uint8Array(N * N * N * 4);
  for (let i = 0; i < N * N * N; i++) {
    // R: lóbulos grandes tipo coliflor (Worley invertido, fBm) modulados por ruido suave
    const bill = (1 - w4[i]) * 0.62 + (1 - w8[i]) * 0.26 + (1 - w16[i]) * 0.12;
    const r = Math.max(0, Math.min(1, bill * (0.75 + 0.5 * (v4[i] * 0.65 + v8[i] * 0.35)) - 0.05));
    // G: detalle fino para erosionar los bordes
    const g = (1 - w16[i]) * 0.55 + (1 - w32[i]) * 0.3 + v8[i] * 0.15;
    // B: ruido suave (variación de densidad y estrías de caída de ceniza)
    const b = v4[i] * 0.6 + v8[i] * 0.4;
    data[i * 4] = r * 255; data[i * 4 + 1] = g * 255; data[i * 4 + 2] = b * 255; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}

const VS = /* glsl */`
varying vec3 vWorld;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FS = /* glsl */`
precision highp float; precision highp sampler3D; precision highp sampler2D;
varying vec3 vWorld;
uniform sampler3D tNoise; uniform sampler2D tProf; uniform sampler2D tH;
uniform vec4 uGrid; uniform vec2 uN30; uniform float uEx;
uniform vec3 uBmin; uniform vec3 uBmax;
uniform float uT;                 // tiempo visual (s)
uniform vec2 uW;                  // dirección hacia donde sopla el viento
uniform vec4 uCol;                // boca x, y (m), z boca, z tope del perfil
uniform vec4 uCol2;               // x máx del perfil (m), densidad, Hnb, vapor (0 ceniza, 1 vapor)
uniform vec4 uUmb;                // centro paraguas x, y, z, semiespesor
uniform vec4 uUmb2;               // radio contra el viento, largo a favor, ensanche lateral, densidad
uniform vec4 uCol3;               // radio de referencia de la columna (escala del ruido)
uniform vec4 uUmb4;               // semiancho inicial de la nube a la deriva
uniform vec4 uUmb3;               // velocidad del viento en el paraguas, densidad de cortinas, radio de rechazo columna, ídem fumarola
uniform vec4 uFum;                // fumarola x, y, z, z tope perfil
uniform vec4 uFum2;               // x máx, densidad, largo visible, viento bajo
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uGndCol; uniform vec3 uFogCol; uniform float uFogD; uniform float uAshHaze;
uniform vec4 uGlow;               // intensidad del resplandor de la boca, altura de decaimiento, —, —
uniform vec4 uFlash;              // rayo: x, y, z (m), intensidad
uniform float uSteps; uniform float uLSteps; uniform float uDbg;
uniform sampler2D tDepth; uniform mat4 uInvVP; uniform vec2 uRes; uniform float uHasDepth;
uniform vec3 uAshA; uniform vec3 uAshB;   // albedo de la ceniza en la base y en altura

vec3 toM(vec3 w){ return vec3(w.x * 1000.0, -w.z * 1000.0, w.y * 1000.0 / uEx); }
float ground(vec2 xy){
  vec2 u = vec2(((xy.x * 0.001 - uGrid.x) / uGrid.w + 0.5) / uN30.x, ((uGrid.y - xy.y * 0.001) / uGrid.w + 0.5) / uN30.y);
  return texture2D(tH, u).r;
}
vec4 prof(float row, float f){ return texture2D(tProf, vec2(clamp(f, 0.0, 1.0) * ${(NP - 1) / NP} + ${0.5 / NP}, (row + 0.5) / 4.0)); }
float remap(float v, float a, float b, float c, float d){ return c + (v - a) / max(b - a, 1e-4) * (d - c); }
float h13(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

// Forma de un tubo descrito por dos perfiles (por altura y por distancia a favor del viento).
// Devuelve (r/b, b local, velocidad, z relativo)
vec4 tube(vec3 p, vec2 v, float z0, float zTop, float xMax, float rowZ, float rowX){
  vec2 d = p.xy - v; float along = dot(d, uW), lat = dot(d, vec2(-uW.y, uW.x));
  float r = 1e3, b = 1.0, U = 0.0;
  float fz = (p.z - z0) / max(zTop - z0, 1.0);
  if (fz >= 0.0 && fz <= 1.0) { vec4 a = prof(rowZ, fz); float bb = a.y * 1000.0; float rr = length(d - uW * a.x * 1000.0) / max(bb, 1.0); if (rr < r) { r = rr; b = bb; U = a.z; } }
  // cúpula sobre el tope y extremo redondeado a favor del viento
  if (fz > 1.0) { vec4 a = prof(rowZ, 1.0); float bb = a.y * 1000.0; float rr = length(vec3(d - uW * a.x * 1000.0, (p.z - zTop) * 1.3)) / max(bb, 1.0); if (rr < r) { r = rr; b = bb; U = a.z * 0.3; } }
  float fx = along / max(xMax, 1.0);
  if (fx > 1.0) { vec4 a = prof(rowX, 1.0); float bb = a.y * 1000.0; float rr = length(vec3(along - xMax, lat, p.z - a.x * 1000.0)) / max(bb, 1.0); if (rr < r) { r = rr; b = bb; U = a.z; } }
  if (fx >= 0.0 && fx <= 1.0) { vec4 a = prof(rowX, fx); float bb = a.y * 1000.0; float rr = length(vec2(lat, p.z - a.x * 1000.0)) / max(bb, 1.0); if (rr < r) { r = rr; b = bb; U = a.z; } }
  return vec4(r, b, U, fz);
}

// densidad (1/m) y fracción de vapor; lo = sólo envolvente + ruido grueso (para sombras)
vec2 density(vec3 p, bool lo){
  float dens = 0.0, steam = 0.0;
  // ---- columna eruptiva
  if (uCol2.y > 0.0 && length(p.xy - uCol.xy) < uUmb3.z && p.z < uCol.w + uUmb3.z * 0.3) {
    vec4 t = tube(p, uCol.xy, uCol.z - 60.0, uCol.w, uCol2.x, 0.0, 1.0);
    if (t.x < 1.45) {
      float b = t.y;
      // coordenadas que ascienden con la pluma (lóbulos del tamaño del radio)
      float bq = mix(b, uCol3.x, 0.6);
      vec3 q = vec3((p.xy - uCol.xy) / (bq * 3.4), (p.z - uT * clamp(t.z, 4.0, 90.0) * 0.5) / (uCol3.x * 3.4));
      vec4 n = texture(tNoise, q + vec3(0.13, 0.71, 0.0));
      float env = smoothstep(1.4, 0.45, t.x);
      float d = clamp(remap(n.r, 1.0 - env * 0.97, 1.0, 0.0, 1.0) * 1.6, 0.0, 1.0);
      if (!lo && d > 0.0) { float e = texture(tNoise, q * 2.7 + vec3(0.0, 0.0, -uT * 0.015)).g; d = clamp(remap(d, (1.0 - e) * 0.38 * (1.0 - env * 0.4), 1.0, 0.0, 1.0), 0.0, 1.0); }
      // el chorro de gas cerca de la boca es más denso; arriba del NBL se diluye hacia el paraguas
      float k = uCol2.y * (1.0 + 2.0 * exp(-(p.z - uCol.z) / 400.0)) * (1.0 - 0.55 * smoothstep(uCol2.z, uCol.w, p.z));
      dens += d * k; steam = max(steam, uCol2.w);
    }
  }
  // ---- nube paraguas y nube a la deriva
  if (uUmb2.w > 0.0) {
    vec2 d = p.xy - uUmb.xy; float along = dot(d, uW), lat = dot(d, vec2(-uW.y, uW.x));
    float zc = uUmb.z - max(along, 0.0) * 0.03, hT = uUmb.w * (1.0 + max(along, 0.0) / 25000.0);
    float e;
    if (along < 0.0) e = length(vec2(along, lat)) / uUmb2.x;
    else { float wdt = uUmb4.x + along * uUmb2.z; e = max(abs(lat) / wdt, along / uUmb2.y); }
    float v = (p.z - zc) / hT;
    float sh = min(1.0 - e * e, 1.0 - v * v * (v > 0.0 ? 1.0 : 0.6));
    if (sh > -0.35) {
      float sc = clamp(uUmb4.x * 1.6, 1200.0, 6000.0);
      vec3 q = vec3(p.xy - uW * uUmb3.x * uT, p.z) / vec3(sc, sc, sc * 0.6);
      vec4 n = texture(tNoise, q);
      float env = clamp(sh * 1.2, 0.0, 1.0);
      float dd = clamp(remap(n.r * 0.6 + n.b * 0.5, 1.0 - env * 0.9, 1.0, 0.0, 1.0) * 1.3, 0.0, 1.0);
      if (!lo && dd > 0.0) { float e2 = texture(tNoise, q * 2.3).g; dd = clamp(remap(dd, (1.0 - e2) * 0.3, 1.0, 0.0, 1.0), 0.0, 1.0); }
      float fade = exp(-max(along, 0.0) / (uUmb2.y * 0.55));
      dens += dd * uUmb2.w * fade;
    }
    // cortinas de caída de ceniza bajo la nube (estrías verticales)
    if (uUmb3.y > 0.0 && p.z < zc && e < 1.1) {
      vec3 q = vec3((p.xy - uW * uUmb3.x * uT * 0.6) / 7000.0, (p.z + uT * 25.0) / 9000.0);
      float n = texture(tNoise, q).b * 0.7 + texture(tNoise, q * 2.3).r * 0.3;
      float c = smoothstep(0.3, 0.75, n) * (1.0 - smoothstep(0.7, 1.1, e)) * smoothstep(0.0, 2500.0, zc - hT * 0.5 - p.z + 2500.0);
      c *= smoothstep(-200.0, 1500.0, p.z - ground(p.xy));
      dens += c * uUmb3.y;
    }
  }
  // ---- vapor de la fumarola
  if (uFum2.y > 0.0 && length(p.xy - uFum.xy) < uUmb3.w && p.z < uFum.w + uUmb3.w * 0.3) {
    vec4 t = tube(p, uFum.xy, uFum.z - 10.0, uFum.w, uFum2.x, 2.0, 3.0);
    if (t.x < 1.5) {
      float b = t.y;
      vec2 d = p.xy - uFum.xy; float along = max(0.0, dot(d, uW));
      vec3 q = vec3(p.xy - uW * uFum2.w * uT, p.z - uT * 3.0) / max(b * 2.6, 40.0);
      vec4 n = texture(tNoise, q + vec3(0.37, 0.11, 0.5));
      float env = clamp(1.2 - t.x, 0.0, 1.0);
      float dd = clamp(remap(n.r, 1.0 - env * 0.9, 1.0, 0.0, 1.0), 0.0, 1.0);
      if (!lo && dd > 0.0) { float e = texture(tNoise, q * 2.9).g; dd = clamp(remap(dd, (1.0 - e) * 0.45, 1.0, 0.0, 1.0), 0.0, 1.0); }
      // el vapor condensado se evapora al mezclarse con aire seco
      float vis = exp(-(along + max(0.0, p.z - uFum.z) * 0.5) / uFum2.z);
      float k = dd * uFum2.y * vis;
      steam = (dens * steam + k) / max(dens + k, 1e-5); dens += k;
    }
  }
  return vec2(dens, steam);
}

float phase(float mu){
  float g1 = 0.65, g2 = -0.25;
  float a = (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * mu, 1.5);
  float b = (1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * mu, 1.5);
  return mix(b, a, 0.6) * 0.0795775;
}

void main(){
  vec3 ro = toM(cameraPosition), pe = toM(vWorld);
  vec3 rd = normalize(pe - ro);
  vec3 inv = 1.0 / (rd + vec3(1e-7));
  vec3 a = (uBmin - ro) * inv, b = (uBmax - ro) * inv;
  vec3 tmn = min(a, b), tmx = max(a, b);
  float t0 = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)), t1 = min(min(tmx.x, tmx.y), tmx.z);
  // la escena opaca (relieve, bosque) recorta el rayo
  if (uHasDepth > 0.5) {
    vec2 su = gl_FragCoord.xy / uRes;
    float zd = texture2D(tDepth, su).r;
    if (zd < 1.0) {
      vec4 wp = uInvVP * vec4(su * 2.0 - 1.0, zd * 2.0 - 1.0, 1.0);
      if (abs(wp.w) > 1e-6) { wp.xyz /= wp.w; float ts = length(toM(wp.xyz) - ro); if (ts == ts) t1 = min(t1, ts); }
    }
  }
  if (t1 <= t0) discard;
  float mu = dot(rd, uSun), ph = phase(mu);
  float sunUp = smoothstep(-0.08, 0.05, uSun.z);
  vec3 col = vec3(0.0); float T = 1.0; float tHit = -1.0;
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = t0 + jit * max(20.0, t0 * 0.004);
  int N = int(uSteps);
  bool fine = false; int empty = 0; float last = 0.0;
  for (int i = 0; i < 200; i++) {
    if (i >= N || t > t1 || T < 0.02) break;
    vec3 p = ro + rd * t;
    float dt = max(22.0, t * 0.004);
    // paso grande guiado por la distancia a la columna y a la fumarola (sphere tracing sobre la envolvente)
    float sd = 3000.0, sdU = 3000.0;
    if (uUmb2.w > 0.0) {
      vec2 d = p.xy - uUmb.xy; float along = dot(d, uW), lat = abs(dot(d, vec2(-uW.y, uW.x)));
      float dh = along < 0.0 ? length(vec2(along, lat)) - uUmb2.x * 1.1 : max(lat - (uUmb4.x + along * uUmb2.z) * 1.1, along - uUmb2.y * 1.05);
      float zc = uUmb.z - max(along, 0.0) * 0.03, hT = uUmb.w * (1.0 + max(along, 0.0) / 25000.0);
      float dz = abs(p.z - zc) - hT * 1.8;
      if (uUmb3.y > 0.0 && p.z < zc) dz = 0.0;   // cortinas bajo la nube
      sdU = max(max(dh, dz), 0.0) + 40.0;
    }
    if (uCol2.y > 0.0) { vec4 tb = tube(p, uCol.xy, uCol.z - 60.0, uCol.w, uCol2.x, 0.0, 1.0); if (tb.x < 900.0) sd = min(sd, (tb.x - 1.5) * tb.y); else sd = min(sd, max(0.0, length(p.xy - uCol.xy) - uUmb3.z * 0.5)); }
    if (uFum2.y > 0.0) { vec4 tb = tube(p, uFum.xy, uFum.z - 10.0, uFum.w, uFum2.x, 2.0, 3.0); if (tb.x < 900.0) sd = min(sd, (tb.x - 1.5) * tb.y); else sd = min(sd, max(0.0, length(p.xy - uFum.xy) - uUmb3.w * 0.5)); }
    // dentro del paraguas (estructura grande) el paso fino puede ser mayor si la columna está lejos
    if (sd > 300.0 && uUmb2.w > 0.0) dt = max(dt, min(sd * 0.5, uUmb.w * 0.25));
    float dc = clamp(min(sd, sdU) * 0.9, dt, 3000.0);
    if (uHasDepth < 0.5 && p.z < ground(p.xy)) break;
    vec2 ds = density(p, false);
    float sig = ds.x;
    if (sig <= 1e-6) { if (++empty > 3) fine = false; last = fine ? dt : dc; t += last; continue; }
    if (!fine) { fine = true; empty = 0; t = max(t0, t - min(last, 300.0) * 0.9); continue; }
    empty = 0;
    {
      if (tHit < 0.0) tHit = t;
      // transmitancia hacia el sol
      float od = 0.0, ls = 40.0; vec3 lp = p;
      int NL = int(uLSteps);
      for (int k = 0; k < 6; k++) { if (k >= NL) break; lp += uSun * ls; od += density(lp, true).x * ls; ls *= 2.1; }
      float Ts = exp(-od) * sunUp;
      // cielo: se atenúa en el interior y la parte baja de la nube
      float Tup = exp(-density(p + vec3(0.0, 0.0, 250.0), true).x * 350.0);
      float powder = 1.0 - exp(-sig * 120.0);
      vec3 alb = mix(mix(uAshA, uAshB, smoothstep(uCol.z, uCol.z + 9000.0, p.z)), vec3(0.93, 0.94, 0.96), ds.y);
      // dispersión simple + aproximación de dispersión múltiple (la luz que se cuela en los lóbulos)
      vec3 L = uSunCol * (Ts * (ph * 7.0 * mix(1.0, powder, 0.6) + 0.30) + pow(Ts, 0.3) * 0.14 * sunUp) + uSkyCol * (0.22 + 0.7 * Tup) + uGndCol * 0.5;
      // resplandor incandescente desde la boca (fuente de lava, ceniza caliente)
      float gz = max(0.0, p.z - uCol.z);
      L += vec3(1.0, 0.36, 0.08) * uGlow.x * exp(-gz / uGlow.y) * exp(-length(p.xy - uCol.xy) / (uGlow.y * 1.2)) * 1.6;
      if (uFlash.w > 0.0) L += vec3(0.75, 0.8, 1.0) * uFlash.w * 6.0 * exp(-length(p - uFlash.xyz) / 1600.0);
      vec3 S = alb * L;
      float st = exp(-sig * dt);
      col += T * S * (1.0 - st);
      T *= st;
    }
    t += dt;
  }
  float A = 1.0 - T;
  if (isnan(A) || isinf(A) || any(isnan(col)) || any(isinf(col))) discard;
  if (uDbg > 0.5) { gl_FragColor = vec4(A, t0 / 20000.0, (t1 - t0) / 20000.0, 1.0); return; }
  if (A < 0.003) discard;
  // perspectiva aérea con la distancia al primer contacto
  float dk = max(tHit, 0.0) * 0.001;
  float hk = max(0.0, (ro.z + rd.z * max(tHit, 0.0)) * 0.001 * uEx);
  float f = clamp(1.0 - exp(-dk * uFogD * exp(-min(hk, ro.z * 0.001 * uEx) * 0.22)), 0.0, 1.0);
  vec3 fc = mix(uFogCol, vec3(0.32, 0.30, 0.28), uAshHaze);
  col = mix(col, fc * A, f);
  gl_FragColor = vec4(col, A);
}`;

const COMP_FS = /* glsl */`
uniform sampler2D tVol; uniform vec2 uTexel; varying vec2 vUv;
// reconstrucción suave desde la resolución reducida (quita el grano del muestreo con jitter)
void main(){
  vec2 o = uTexel * 0.75;
  vec4 c = texture2D(tVol, vUv) * 0.4 + (texture2D(tVol, vUv + vec2(o.x, o.y)) + texture2D(tVol, vUv + vec2(-o.x, o.y)) + texture2D(tVol, vUv + vec2(o.x, -o.y)) + texture2D(tVol, vUv - o)) * 0.15;
  gl_FragColor = c;
}`;

// ------------------------------------------------------------------ clase principal
export class Volumes {
  constructor(D, terr) {
    this.D = D;
    const GR = D.GR;
    this.noise = makeNoise(64);
    this.prof = new Float32Array(NP * 4 * 4);
    this.profTex = new THREE.DataTexture(new Uint16Array(NP * 4 * 4), NP, 4, THREE.RGBAFormat, THREE.HalfFloatType);
    this.profTex.minFilter = this.profTex.magFilter = THREE.LinearFilter; this.profTex.needsUpdate = true;
    const V = (x, y, z, w) => ({ value: new THREE.Vector4(x, y, z, w) });
    this.U = {
      tNoise: { value: this.noise }, tProf: { value: this.profTex }, tH: { value: terr.U.tHf.value },
      uGrid: { value: new THREE.Vector4(GR.X0, GR.Y1, GR.cell, D.cell30) }, uN30: { value: new THREE.Vector2(D.nx30, D.ny30) }, uEx: { value: 1.5 },
      uBmin: { value: new THREE.Vector3() }, uBmax: { value: new THREE.Vector3() }, uT: { value: 0 }, uW: { value: new THREE.Vector2(1, 0) },
      uUmb4: V(500, 0, 0, 0), uCol3: V(300, 0, 0, 0), uCol: V(0, 0, 3000, 4000), uCol2: V(1, 0, 3500, 0), uUmb: V(0, 0, 0, 1), uUmb2: V(1, 1, 0.1, 0), uUmb3: V(10, 0, 0, 0),
      uFum: V(0, 0, 3100, 3300), uFum2: V(1, 0, 400, 3),
      uSun: { value: new THREE.Vector3(0, 0, 1) }, uSunCol: { value: new THREE.Color() }, uSkyCol: { value: new THREE.Color() }, uGndCol: { value: new THREE.Color() },
      uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.002 }, uAshHaze: { value: 0 },
      uGlow: V(0, 900, 0, 0), uFlash: V(0, 0, 0, 0), uSteps: { value: 72 }, uLSteps: { value: 4 }, uDbg: { value: 0 }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) }, uHasDepth: { value: 0 },
      uAshA: { value: new THREE.Color(0.36, 0.32, 0.28) }, uAshB: { value: new THREE.Color(0.66, 0.62, 0.57) },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.U, side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
    this.box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mat); this.box.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.box);
    this.scale = 0.5; this.vt = 0; this.on = false;
    this.cur = null; this.tgt = null; // perfiles suavizados en el tiempo
    this.flash = 0; this.dbg = {};
  }
  setQuality(lite) { this.scale = lite ? 0.36 : 0.5; this.U.uSteps.value = lite ? 80 : 120; this.U.uLSteps.value = lite ? 3 : 5; }
  // st: estado de la fuente; P: pluma; ctx: {vents, wind, t, hist, fum{F,u,dh,L,q}, glow, flash, ex, phreatic}
  update(dtv, c) {
    const U = this.U, hAt = c.hAt;
    this.vt += Math.max(0, Math.min(1, dtv)); U.uT.value = this.vt; U.uEx.value = c.ex;
    const az = (c.wind.to || 90) * Math.PI / 180, wx = Math.sin(az), wy = Math.cos(az);
    U.uW.value.set(wx, wy);
    const v0 = c.vents[0] || { x: 0, y: 0 };
    const vx = v0.x * 1000, vy = v0.y * 1000, vz = hAt(v0.x, v0.y);
    let bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
    const grow = (x0, y0, z0, x1, y1, z1) => { bmin = [Math.min(bmin[0], x0), Math.min(bmin[1], y0), Math.min(bmin[2], z0)]; bmax = [Math.max(bmax[0], x1), Math.max(bmax[1], y1), Math.max(bmax[2], z1)]; };
    // ---- columna (perfil suavizado para que no salte con las pulsaciones)
    const P = c.plume, pr = this.prof;
    const colOn = P && c.src.MER > 50;
    const kSm = Math.min(1, dtv * 0.8);
    const target = colOn ? (P._vprof || (P._vprof = this.profile(P))) : null;
    if (target) {
      if (!this.cur) { this.cur = target; this.colDens = 1; } else for (const k of ['zTop', 'xMax', 'Hnb', 'bmax']) this.cur[k] += (target[k] - this.cur[k]) * kSm;
      for (let i = 0; i < NP * 8; i++) this.cur.a[i] += (target.a[i] - this.cur.a[i]) * kSm;
    }
    this.colDens = (this.colDens || 0) + ((colOn ? 1 : 0) - (this.colDens || 0)) * Math.min(1, dtv * 0.25);
    const C = this.cur;
    if (C && this.colDens > 0.01 && !this.dbg.noCol) {
      for (let i = 0; i < NP * 8; i++) pr[i] = C.a[i];
      const lg = Math.log10(Math.max(100, c.src.MER || 100));
      U.uCol.value.set(vx, vy, vz, C.zTop); U.uCol3.value.x = Math.max(120, C.bmax * 0.45); U.uCol2.value.set(C.xMax, 0.035 * this.colDens * Math.min(1.4, 0.6 + 0.12 * lg), C.Hnb, c.phreatic ? 1 : 0);
      const bm = C.bmax + 400; U.uUmb3.value.z = C.xMax + C.bmax * 1.6 + 300;
      grow(vx - bm + Math.min(0, wx * C.xMax), vy - bm + Math.min(0, wy * C.xMax), vz - 100, vx + bm + Math.max(0, wx * C.xMax), vy + bm + Math.max(0, wy * C.xMax), C.zTop + bm * 1.2);
    } else U.uCol2.value.y = 0;
    // ---- nube a la deriva (todas las columnas) y paraguas radial (sólo columnas grandes, R ∝ MER^¼ t^⅔)
    const h = c.hist || null;
    if (h && h.mer > 2e3 && h.age > 0 && C && !this.dbg.noUmb) {
      const ageOn = h.age - h.off;
      const Wt = windAt(h.Hnb, c.wind.speed || 15);
      const big = h.mer > 2e6;
      const bTop = Math.min(C.bmax, 0.2 * (h.Ht - vz) + 200);
      const R = big ? Math.min(30000, 3 * Math.pow(h.mer, 0.25) * Math.pow(Math.max(30, ageOn), 2 / 3)) : bTop;
      const w0 = Math.max(bTop, R);
      const Rup = w0 * (big ? Math.max(0.3, Math.min(1, 8 / Math.max(1, Wt))) : 1);
      const L = Math.max(w0, Math.min(60000, Wt * ageOn * 0.9));
      const drift = Wt * h.off;
      const fade = Math.exp(-h.off / 2400);
      const cx = vx + wx * (h.xTop + drift), cy = vy + wy * (h.xTop + drift);
      const zc = big ? (h.Hnb + h.Ht) / 2 : h.Hnb, hT = Math.max(350, big ? (h.Ht - h.Hnb) / 2 + 300 : Math.min(bTop, (h.Ht - h.Hnb) * 0.6 + 150));
      const dU = 0.004 * fade * Math.min(1, ageOn / 120) * Math.min(1.3, 0.55 + 0.12 * Math.log10(h.mer));
      const spread = big ? 0.12 : 0.07;
      U.uUmb.value.set(cx, cy, zc, hT); U.uUmb2.value.set(Rup, L, spread, dU); U.uUmb4.value.x = w0;
      U.uUmb3.value.x = Wt * 0.9; U.uUmb3.value.y = 0; // cortinas desactivadas: la bruma de ceniza del terreno representa la caída
      const lw = w0 + L * spread + 800;
      const ex1 = [cx - wx * (Rup + 300), cy - wy * (Rup + 300)], ex2 = [cx + wx * L, cy + wy * L];
      grow(Math.min(ex1[0], ex2[0]) - lw, Math.min(ex1[1], ex2[1]) - lw, U.uUmb3.value.y > 0 ? 400 : zc - hT * 3 - L * 0.03, Math.max(ex1[0], ex2[0]) + lw, Math.max(ex1[1], ex2[1]) + lw, zc + hT * 1.5);
    } else U.uUmb2.value.w = 0;
    // ---- fumarola: ascenso de Briggs z = 1,6 F^⅓ x^⅔ / u hasta el ascenso final
    const f = c.fum;
    if (f && f.dens > 0.001 && !this.dbg.noFum) {
      const fx = 30, fy = 0, fz = hAt(0.03, 0) + 5;
      const xMax = Math.min(9000, f.L * 3.2);
      const zTop = fz + f.dh;
      const A = 1.6 * Math.cbrt(f.F) / f.u;
      for (let i = 0; i < NP; i++) {
        // por altura: x(z) inverso de Briggs
        const dz = f.dh * i / (NP - 1), x = Math.pow(dz / A, 1.5);
        const b = 14 + 0.5 * dz + 0.03 * x;
        let o = (2 * NP + i) * 4; pr[o] = x / 1000; pr[o + 1] = b / 1000; pr[o + 2] = f.u; pr[o + 3] = 0;
        // por distancia
        const xx = xMax * i / (NP - 1), rz = Math.min(A * Math.pow(xx, 2 / 3), f.dh), bb = 14 + 0.5 * rz + 0.06 * xx;
        o = (3 * NP + i) * 4; pr[o] = (fz + rz) / 1000; pr[o + 1] = bb / 1000; pr[o + 2] = f.u; pr[o + 3] = 0;
      }
      U.uFum.value.set(fx, fy, fz, zTop); U.uUmb3.value.w = xMax + 0.5 * f.dh + 0.06 * xMax + 200; U.uFum2.value.set(xMax, 0.006 * f.dens, f.L, f.u);
      const m = 0.5 * f.dh + 0.06 * xMax + 120;
      grow(fx - m + Math.min(0, wx * xMax), fy - m + Math.min(0, wy * xMax), fz - 30, fx + m + Math.max(0, wx * xMax), fy + m + Math.max(0, wy * xMax), zTop + m);
    } else U.uFum2.value.y = 0;
    this.on = bmax[0] > bmin[0];
    this.box.visible = this.on;
    if (!this.on) return;
    this.profEnc(pr);
    U.uBmin.value.set(...bmin); U.uBmax.value.set(...bmax);
    // caja en coordenadas de la escena (km, altura exagerada, z = −norte)
    const ex = c.ex;
    this.box.position.set((bmin[0] + bmax[0]) / 2000, (bmin[2] + bmax[2]) / 2000 * ex, -(bmin[1] + bmax[1]) / 2000);
    this.box.scale.set((bmax[0] - bmin[0]) / 1000 + 0.01, (bmax[2] - bmin[2]) / 1000 * ex + 0.01, (bmax[1] - bmin[1]) / 1000 + 0.01);
    this.box.updateMatrixWorld();
    U.uGlow.value.set((c.glow || 0) * (0.08 + 0.92 * (c.night || 0)), 1100, 0, 0);
    if (c.flash) U.uFlash.value.set(c.flash.x * 1000, c.flash.y * 1000, c.flash.z, 1); else U.uFlash.value.w = 0;
  }
  profile(P) {
    const path = P.path; let im = 0; for (let i = 1; i < path.length; i++) if (path[i].z > path[im].z) im = i;
    const z0 = path[0].z, zTop = path[im].z, xMax = Math.max(50, path[path.length - 1].x);
    const a = new Float32Array(NP * 8); let bmax = 0;
    for (let i = 0; i < NP; i++) {
      const z = z0 + (zTop - z0) * i / (NP - 1), pl = plumeLookup(P, z) || path[0];
      const bb = Math.min(pl.b * 2.0 + 50, P.b0 * 2.0 + 0.30 * (z - z0) + 50); a[i * 4] = pl.x / 1000; a[i * 4 + 1] = bb / 1000; a[i * 4 + 2] = pl.U; bmax = Math.max(bmax, bb);
    }
    let j = 0;
    for (let i = 0; i < NP; i++) {
      const x = xMax * i / (NP - 1);
      while (j < path.length - 2 && path[j + 1].x < x) j++;
      const p0 = path[j], p1 = path[Math.min(j + 1, path.length - 1)], f = p1.x > p0.x ? Math.min(1, Math.max(0, (x - p0.x) / (p1.x - p0.x))) : 0;
      const zz = p0.z + (p1.z - p0.z) * f, bx = Math.min((p0.b + (p1.b - p0.b) * f) * 2.0 + 50, P.b0 * 2.0 + 0.30 * (zz - z0) + 0.1 * x + 50); const o = (NP + i) * 4; a[o] = zz / 1000; a[o + 1] = bx / 1000; a[o + 2] = p0.U + (p1.U - p0.U) * f;
    }
    return { a, zTop, xMax, Hnb: P.Hnb, bmax };
  }
  profEnc(pr) {
    const d = this.profTex.image.data;
    for (let i = 0; i < pr.length; i++) d[i] = THREE.DataUtils.toHalfFloat(pr[i]);
    this.profTex.needsUpdate = true;
  }
  setLighting(sunM, sunCol, skyCol, gndCol, fogCol, fogD, ashHaze) {
    const U = this.U; U.uSun.value.copy(sunM).normalize(); U.uSunCol.value.copy(sunCol); U.uSkyCol.value.copy(skyCol); U.uGndCol.value.copy(gndCol);
    U.uFogCol.value.copy(fogCol); U.uFogD.value = fogD; U.uAshHaze.value = ashHaze;
  }
}

// Pase de post-proceso: calcula las nubes a resolución reducida y las compone sobre la escena
// (sin intercambiar búferes, así se conserva la profundidad para dibujar encima las partículas incandescentes)
export class VolumePass extends Pass {
  constructor(vol, camera, overScene) {
    super();
    this.vol = vol; this.camera = camera; this.overScene = overScene; this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.cmat = new THREE.ShaderMaterial({ uniforms: { tVol: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2(0.01, 0.01) } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: COMP_FS,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.quad = new FullScreenQuad(this.cmat);
    this.w = 4; this.h = 4; this.cc = new THREE.Color();
  }
  setSize(w, h) { this.w = w; this.h = h; }
  render(renderer, writeBuffer, readBuffer) {
    const v = this.vol;
    if (v.on) {
      const w = Math.max(16, Math.round(this.w * v.scale)), h = Math.max(16, Math.round(this.h * v.scale));
      if (this.rt.width !== w || this.rt.height !== h) { this.rt.setSize(w, h); this.cmat.uniforms.uTexel.value.set(1 / w, 1 / h); }
      renderer.getClearColor(this.cc); const ca = renderer.getClearAlpha();
      const U = v.U, cam = this.camera;
      U.tDepth.value = readBuffer.depthTexture || null; U.uHasDepth.value = readBuffer.depthTexture ? 1 : 0;
      U.uRes.value.set(w, h);
      U.uInvVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
      renderer.render(v.scene, this.camera);
      renderer.setClearColor(this.cc, ca);
    }
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    const ac = renderer.autoClear; renderer.autoClear = false;
    if (v.on) this.quad.render(renderer);
    if (this.overScene) renderer.render(this.overScene, this.camera);
    renderer.autoClear = ac;
  }
}
