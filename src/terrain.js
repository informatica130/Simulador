// =====================================================================
//  Render del terreno y de los fluidos (shaders propios, PBR simplificado)
//  - Relieve real desplazado en GPU (DEM + depósitos/erosión/fusión).
//  - Sombras exactas por raymarching sobre el DEM, oclusión ambiental.
//  - Nieve y glaciar dinámicos (se derriten), ceniza, depósitos de lahar,
//    lava solidificada, bosque quemado, fuego activo.
//  - Fluidos: lava con emisión de cuerpo negro y costra advectada;
//    lahar con textura de flujo, espuma y reflejo; CDP como polvo.
// =====================================================================
import * as THREE from 'three';

export const COMMON_GLSL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uGroundCol;
uniform vec3 uFogCol; uniform float uFogD; uniform float uTime; uniform vec3 uCamPos; uniform float uAshHaze;
uniform vec4 uGlowP[8]; uniform vec3 uGlowC[8];
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
vec3 fogApply(vec3 c, vec3 wp){
  float d = length(wp - uCamPos);
  float hgt = max(0.0, min(wp.y, uCamPos.y));
  float f = 1.0 - exp(-d * uFogD * exp(-hgt * 0.18));
  vec3 fc = mix(uFogCol, vec3(0.32, 0.30, 0.28) * (0.25 + 0.75 * max(uSunDir.y, 0.05)), uAshHaze);
  return mix(c, fc, clamp(f + uAshHaze * min(1.0, d * 0.08), 0.0, 1.0));
}
vec3 glowLight(vec3 wp, vec3 n){
  vec3 s = vec3(0.0);
  for (int i = 0; i < 8; i++) { vec4 g = uGlowP[i]; if (g.w <= 0.0) continue; vec3 d = g.xyz - wp; float r = length(d);
    float a = max(0.0, 1.0 - r / g.w); s += uGlowC[i] * a * a * (0.35 + 0.65 * max(dot(n, d / max(r, 1e-3)), 0.0)); }
  return s;
}
// Color de cuerpo negro (aprox. a Planck en el visible) y radiancia relativa
vec3 blackbody(float T){
  float t = T / 100.0; vec3 c;
  c.r = 1.0;
  c.g = clamp(0.39 * log(max(t, 1.0)) - 0.634 + 0.0, 0.0, 1.0);
  c.g = clamp((T - 900.0) / 1900.0, 0.0, 1.0); c.g = pow(c.g, 1.2) * 0.85;
  c.b = clamp((T - 1600.0) / 2200.0, 0.0, 1.0);
  return c;
}
float bbRad(float T){ return exp((T - 1300.0) / 85.0); }
`;

const TERRAIN_VS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
attribute vec2 aIJ;
uniform sampler2D tDem, tTerr, tStatic, tStat, tFluidP, tAsh, tFire, tAcc;
uniform float uEx; uniform int uS; uniform ivec2 uSimN; uniform ivec2 uDemN;
uniform ivec2 uAccN; uniform int uAccS; uniform int uProbCh;
uniform vec4 uGrid; // X0, Y1, cell(km), 0
varying vec3 vW; varying vec3 vN; varying vec2 vXY; varying float vZ; varying float vAO;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD;
float bedAt(ivec2 ij){
  ij = clamp(ij, ivec2(0), uDemN - 1);
  vec2 d = texelFetch(tDem, ij, 0).rg;
  ivec2 sc = clamp(ij / uS, ivec2(0), uSimN - 1);
  return d.r + texelFetch(tTerr, sc, 0).r - texelFetch(tStatic, sc, 0).r;
}
void main(){
  ivec2 ij = ivec2(aIJ);
  float z = bedAt(ij);
  float zx = bedAt(ij + ivec2(1, 0)) - bedAt(ij - ivec2(1, 0));
  float zy = bedAt(ij + ivec2(0, 1)) - bedAt(ij - ivec2(0, 1));
  float c2 = 2.0 * uGrid.z;
  // j crece hacia el sur → -z en el mundo de three también es norte; dz_world/dj = +cell
  vN = normalize(vec3(-zx / 1000.0 * uEx / c2, 1.0, -zy / 1000.0 * uEx / c2));
  vec3 p = vec3(position.x, z / 1000.0 * uEx, position.z);
  vW = p; vXY = vec2(position.x, -position.z); vZ = z;
  vAO = texelFetch(tDem, ij, 0).g;
  ivec2 sc = clamp(ij / uS, ivec2(0), uSimN - 1);
  vec4 tr = texelFetch(tTerr, sc, 0), s0 = texelFetch(tStatic, sc, 0), st = texelFetch(tStat, sc, 0);
  vec4 fp = texelFetch(tFluidP, sc, 0), ash = texelFetch(tAsh, sc, 0), fi = texelFetch(tFire, sc, 0);
  ivec2 ac = clamp(ij / uAccS, ivec2(0), uAccN - 1);
  vec4 acc = texelFetch(tAcc, ac, 0);
  float pr = uProbCh == 0 ? acc.x : uProbCh == 1 ? acc.y : uProbCh == 2 ? acc.z : acc.w;
  vA = vec4(tr.y, tr.x - s0.x, st.z, ash.x);
  vB = vec4(fi.y, fi.z, st.x, st.y);
  vC = vec4(pr, st.w, s0.y, ash.z);
  vD = vec4(fp.w, fp.z, tr.w, tr.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const TERRAIN_FS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D tSat, tDem; uniform ivec2 uDemN; uniform vec4 uGrid; uniform vec4 uSatB;
uniform float uEx; uniform int uBase; uniform int uOverlay; uniform float uAccCount; uniform float uSimT;
uniform float uShadows; uniform float uContours; uniform vec2 uVent; uniform float uSnowVis;
varying vec3 vW; varying vec3 vN; varying vec2 vXY; varying float vZ; varying float vAO;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD;
` + COMMON_GLSL + /* glsl */`
float demAt(vec2 xy){ ivec2 ij = ivec2(floor((xy.x - uGrid.x) / uGrid.z + 0.5), floor((uGrid.y - xy.y) / uGrid.z + 0.5));
  if (ij.x < 0 || ij.y < 0 || ij.x >= uDemN.x || ij.y >= uDemN.y) return -1e4; return texelFetch(tDem, ij, 0).r; }
float shadow(vec3 p, vec3 L){
  if (L.y <= 0.0) return 0.0;
  float t = 0.04, res = 1.0;
  for (int i = 0; i < 44; i++) {
    vec3 q = p + L * t; float h = demAt(vec2(q.x, -q.z)) / 1000.0 * uEx; float d = q.y - h;
    if (d < -0.002) return 0.0;
    res = min(res, 10.0 * d / t);
    t = t * 1.15 + 0.015;
    if (t > 40.0 || q.y > 3.3 * uEx) break;
  }
  return clamp(res, 0.0, 1.0);
}
vec3 hyps(float h){ vec3 c = mix(vec3(.20, .34, .17), vec3(.42, .55, .28), smoothstep(300., 900., h)); c = mix(c, vec3(.70, .63, .42), smoothstep(900., 1500., h));
  c = mix(c, vec3(.52, .40, .30), smoothstep(1500., 2100., h)); c = mix(c, vec3(.60, .58, .56), smoothstep(2100., 2550., h)); return mix(c, vec3(.95, .96, .97), smoothstep(2500., 2800., h)); }
vec3 slopeC(float s){ vec3 c = mix(vec3(.3, .55, .3), vec3(.85, .8, .35), smoothstep(4., 12., s)); c = mix(c, vec3(.9, .5, .2), smoothstep(12., 24., s)); c = mix(c, vec3(.75, .15, .15), smoothstep(24., 36., s)); return mix(c, vec3(.35, .1, .35), smoothstep(36., 48., s)); }
vec3 ramp(float t){ // secuencial cálido para peligro
  vec3 a = vec3(1.0, 0.93, 0.55), b = vec3(1.0, 0.62, 0.20), c = vec3(0.86, 0.22, 0.10), d = vec3(0.45, 0.04, 0.12);
  return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34); }
vec3 probRamp(float t){ vec3 a = vec3(0.16, 0.38, 0.75), b = vec3(0.30, 0.75, 0.55), c = vec3(0.98, 0.85, 0.30), d = vec3(0.90, 0.25, 0.15), e = vec3(0.55, 0.05, 0.25);
  return t < .25 ? mix(a, b, t / .25) : t < .5 ? mix(b, c, (t - .25) / .25) : t < .75 ? mix(c, d, (t - .5) / .25) : mix(d, e, (t - .75) / .25); }
float iso(float v, float step_){ float f = v / step_; float w = fwidth(f); return 1.0 - smoothstep(0.0, w * 1.2, abs(fract(f + 0.5) - 0.5)); }
void main(){
  vec2 uv = vec2((vXY.x - uSatB.x) / (uSatB.y - uSatB.x), (vXY.y - uSatB.z) / (uSatB.w - uSatB.z));
  vec3 alb = texture2D(tSat, uv).rgb;
  float slope = degrees(acos(clamp(vN.y, 0.0, 1.0)));
  if (uBase == 1) alb = hyps(vZ) * 0.6; else if (uBase == 2) alb = slopeC(degrees(atan(length(vN.xz) / vN.y * 1.0 / uEx))) * 0.6;
  else if (uBase == 3) alb = mix(vec3(.80, .79, .74), vec3(.70, .67, .60), smoothstep(400., 2600., vZ));
  float swe = vA.x, dep = vA.y, lavaMax = vA.z, ash = vA.w;
  float n1 = fbm(vXY * 18.0), n2 = vnoise(vXY * 90.0);
  // --- nieve estacional y glaciar (dinámicos)
  float swe0 = vC.z;
  if (uSnowVis > 0.5 && uBase == 0) {
    float sn = smoothstep(0.03, 0.35, swe + (n1 - 0.5) * 0.15) * (1.0 - smoothstep(42.0, 58.0, slope));
    vec3 snowC = mix(vec3(0.80, 0.85, 0.92), vec3(0.93, 0.95, 0.98), n2);
    if (swe > 3.0) snowC = mix(snowC, vec3(0.70, 0.80, 0.88), 0.35 * smoothstep(0.55, 0.75, fbm(vXY * 40.0 + vec2(n1 * 3.0, 0.0)))); // grietas del glaciar
    alb = mix(alb, snowC, sn * 0.93);
    // donde el hielo/nieve se derritió: roca y ceniza húmedas
    float melted = swe0 > 0.3 ? smoothstep(0.65, 0.1, swe / swe0) : 0.0;
    alb = mix(alb, vec3(0.10, 0.09, 0.085) * (0.8 + 0.4 * n2), melted * 0.9);
  }
  // --- caída de tefra (mm ≈ kg/m²)
  if (ash > 0.05) {
    float f = clamp(log(1.0 + ash) / log(1.0 + 120.0), 0.0, 1.0);
    float coarse = clamp(vC.w / max(ash, 1e-3), 0.0, 1.0);
    vec3 ac = mix(vec3(0.40, 0.385, 0.37), vec3(0.16, 0.13, 0.12), coarse) * (0.9 + 0.2 * n2);
    alb = mix(alb, ac, f * 0.95);
  }
  // --- depósitos y erosión
  float isLava = step(0.3, lavaMax);
  if (dep > 0.04) {
    vec3 lc = vec3(0.045, 0.042, 0.040) * (0.7 + 0.8 * n2) + vec3(0.02, 0.01, 0.0) * n1;
    float age = vB.w > 0.0 ? (uSimT - vB.w) / 3600.0 : 99.0;
    vec3 mc = mix(vec3(0.20, 0.17, 0.14), vec3(0.42, 0.38, 0.33), smoothstep(0.5, 12.0, age)) * (0.85 + 0.3 * n2);
    alb = mix(alb, isLava > 0.5 ? lc : mc, smoothstep(0.04, 0.5, dep));
  } else if (dep < -0.4) {
    alb = mix(alb, vec3(0.22, 0.20, 0.17) * (0.8 + 0.4 * n2), smoothstep(0.4, 2.0, -dep) * 0.85);
  }
  if (vD.x > 0.2) alb = mix(alb, vec3(0.36, 0.34, 0.32) * (0.85 + 0.3 * n2), smoothstep(0.2, 1.0, vD.x) * 0.8);
  // --- incendio: bosque quemado
  float burn = vB.x, scorch = vB.y;
  alb = mix(alb, vec3(0.035, 0.03, 0.028) * (0.7 + 0.6 * n2), scorch * 0.9);
  // --- relieve: normal de detalle
  vec3 N = normalize(vN + vec3(n1 - 0.5, 0.0, n2 - 0.5) * 0.10 * (1.0 - smoothstep(0.03, 0.4, swe)));
  float ao = vAO;
  float sh = uShadows > 0.5 ? shadow(vW + vec3(0.0, 0.004, 0.0), uSunDir) : 1.0;
  vec3 L = uSunDir;
  float ndl = max(dot(N, L), 0.0);
  vec3 col = alb * (uSunCol * ndl * sh + uSkyCol * (0.55 + 0.45 * N.y) * ao + uGroundCol * (0.5 - 0.5 * N.y));
  // especular en nieve/hielo
  vec3 V = normalize(uCamPos - vW); vec3 H = normalize(L + V);
  float icy = smoothstep(0.1, 1.0, swe) * (uSnowVis > 0.5 ? 1.0 : 0.0);
  col += uSunCol * pow(max(dot(N, H), 0.0), 60.0) * 0.25 * icy * sh;
  col += alb * glowLight(vW, N);
  // fuego activo
  if (burn > 0.5) { float fl = 0.6 + 0.4 * sin(uTime * 13.0 + n1 * 30.0) * vnoise(vXY * 120.0 + uTime * 2.0);
    col += vec3(1.0, 0.38, 0.08) * 3.5 * fl * smoothstep(0.35, 0.7, vnoise(vXY * 60.0 + uTime * 0.3)); }
  // --- capas de análisis
  vec4 ov = vec4(0.0);
  if (uOverlay == 1 && vB.z > 0.05) { float t = clamp(log(1.0 + vB.z) / log(31.0), 0.0, 1.0); ov = vec4(ramp(t), 0.70); }
  else if (uOverlay == 2 && vB.w > 0.0) { float tm = (vB.w - 1.0) / 60.0; float t = clamp(tm / 180.0, 0.0, 1.0);
    ov = vec4(mix(vec3(0.85, 0.08, 0.10), vec3(0.98, 0.90, 0.40), sqrt(t)), 0.65); ov.rgb = mix(ov.rgb, vec3(0.05), iso(tm, 10.0) * 0.85); }
  else if (uOverlay == 3 && lavaMax > 0.05) { ov = vec4(mix(vec3(1.0, 0.55, 0.1), vec3(0.6, 0.0, 0.05), clamp(lavaMax / 15.0, 0.0, 1.0)), 0.7); }
  else if (uOverlay == 4 && ash > 0.1) { float t = clamp(log(1.0 + ash) / log(1.0 + 300.0), 0.0, 1.0); ov = vec4(ramp(t), 0.55);
    float lg = log(ash) / log(10.0); ov.rgb = mix(ov.rgb, vec3(0.05), iso(lg, 1.0) * 0.9); ov.a = max(ov.a, iso(lg, 1.0)); }
  else if (uOverlay == 5 && vD.x > 0.05) { ov = vec4(mix(vec3(0.75, 0.55, 0.85), vec3(0.35, 0.05, 0.45), clamp(vD.x / 10.0, 0.0, 1.0)), 0.7); }
  else if (uOverlay == 6 && uAccCount > 0.0 && vC.x > 0.0) { float t = vC.x / uAccCount; ov = vec4(probRamp(t), 0.25 + 0.55 * smoothstep(0.0, 0.2, t));
    ov.rgb = mix(ov.rgb, vec3(0.05), iso(t * 10.0, 1.0) * 0.6); }
  else if (uOverlay == 7 && vD.z > 0.5) { float t = clamp(log(vD.z) / log(1000.0), 0.0, 1.0); ov = vec4(ramp(t), 0.7); }
  if (ov.a > 0.0) col = mix(col, ov.rgb * (0.45 + 0.55 * (uSunCol.r * ndl * sh * 0.6 + 0.6)), ov.a);
  if (uContours > 0.5) { float c = iso(vZ, 100.0); float c5 = iso(vZ, 500.0); col = mix(col, vec3(0.08, 0.06, 0.04), max(c * 0.35, c5 * 0.6)); }
  col = fogApply(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

const FLUID_VS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
attribute vec2 aIJ;
uniform sampler2D tTerr, tFluid, tFluidP, tFluxA; uniform ivec2 uSimN; uniform float uEx; uniform float uDxM;
varying vec3 vW; varying vec4 vF; varying vec2 vVel; varying vec2 vXY; varying float vHp; varying vec3 vN; varying float vSpd;
vec4 fl(ivec2 p){ return texelFetch(tFluid, clamp(p, ivec2(0), uSimN - 1), 0); }
float surf(ivec2 p){ p = clamp(p, ivec2(0), uSimN - 1); vec4 f = texelFetch(tFluid, p, 0); return texelFetch(tTerr, p, 0).r + f.x + f.z + texelFetch(tFluidP, p, 0).x * 0.3; }
void main(){
  ivec2 p = ivec2(aIJ);
  vec4 f = fl(p); float bed = texelFetch(tTerr, p, 0).r; float hp = texelFetch(tFluidP, p, 0).x;
  // profundidad máxima entre vecinos para que las orillas se intersecten con el terreno
  float h = f.x + f.z;
  float hn = max(max(fl(p + ivec2(1, 0)).x + fl(p + ivec2(1, 0)).z, fl(p - ivec2(1, 0)).x + fl(p - ivec2(1, 0)).z), max(fl(p + ivec2(0, 1)).x + fl(p + ivec2(0, 1)).z, fl(p - ivec2(0, 1)).x + fl(p - ivec2(0, 1)).z));
  float y = h > 0.02 ? bed + h + 0.6 : bed - 2.5 - (hn > 0.0 ? 0.0 : 6.0);
  vec4 q = texelFetch(tFluxA, p, 0), qW = texelFetch(tFluxA, clamp(p - ivec2(1, 0), ivec2(0), uSimN - 1), 0), qN = texelFetch(tFluxA, clamp(p - ivec2(0, 1), ivec2(0), uSimN - 1), 0);
  vec2 vm = vec2(0.5 * (qW.x + q.x), -0.5 * (qN.y + q.y)) / max(f.x, 0.05);
  vec2 vl = vec2(0.5 * (qW.z + q.z), -0.5 * (qN.w + q.w)) / max(f.z, 0.05);
  vVel = f.z > f.x ? vl : vm; vSpd = length(vVel);
  float sx = surf(p + ivec2(1, 0)) - surf(p - ivec2(1, 0)), sy = surf(p + ivec2(0, 1)) - surf(p - ivec2(0, 1));
  vN = normalize(vec3(-sx / 1000.0 * uEx / (2.0 * uDxM / 1000.0), 1.0, -sy / 1000.0 * uEx / (2.0 * uDxM / 1000.0)));
  vF = f; vHp = hp;
  vec3 pos = vec3(position.x, y / 1000.0 * uEx, position.z);
  vW = pos; vXY = vec2(position.x, -position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const FLUID_FS = /* glsl */`
precision highp float;
varying vec3 vW; varying vec4 vF; varying vec2 vVel; varying vec2 vXY; varying float vHp; varying vec3 vN; varying float vSpd;
uniform float uLavaGain;
` + COMMON_GLSL + /* glsl */`
// textura advectada por el flujo (dos fases para evitar estiramiento)
float flowTex(vec2 xy, vec2 vel, float scale, float speed){
  float ph = uTime * speed; float a = fract(ph), b = fract(ph + 0.5);
  vec2 v = vel * 0.001; // m/s → km/s
  float k = 3.0;
  float n1 = fbm((xy - v * a * k * 60.0) * scale), n2 = fbm((xy - v * b * k * 60.0) * scale + 17.3);
  float w = abs(1.0 - 2.0 * a);
  return mix(n1, n2, 1.0 - w);
}
void main(){
  float hm = vF.x, cv = vF.y, hl = vF.z, T = vF.w;
  bool lava = hl > 0.03 && hl >= hm * 0.5;
  if (!lava && hm < 0.03) discard;
  vec3 V = normalize(uCamPos - vW);
  vec3 col; float alpha = 1.0;
  if (lava) {
    float n = flowTex(vXY, vVel, 70.0, 0.05);
    float crk = 1.0 - smoothstep(0.015, 0.07, abs(n - 0.5));
    float crk2 = 1.0 - smoothstep(0.01, 0.05, abs(fbm(vXY * 240.0 + n) - 0.5));
    float mob = clamp(vSpd / 1.2, 0.0, 1.0);
    float Tcore = T, Tcrust = 278.0 + (T - 278.0) * mix(0.42, 0.62, mob);
    float open = clamp(crk * (0.55 + 0.45 * mob) + crk2 * 0.35 + smoothstep(0.75, 0.95, mob) * 0.4, 0.0, 1.0);
    float Ts = mix(Tcrust, Tcore, open);
    vec3 em = blackbody(Ts) * bbRad(Ts) * uLavaGain;
    vec3 N = normalize(vN + vec3(n - 0.5, 0.0, fbm(vXY * 150.0) - 0.5) * 0.6);
    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 rock = vec3(0.05, 0.045, 0.042) * (0.6 + 0.8 * vnoise(vXY * 300.0));
    col = rock * (uSunCol * ndl + uSkyCol * 0.6) + em;
    col += glowLight(vW, N) * rock * 2.0;
    alpha = smoothstep(0.02, 0.25, hl);
  } else {
    float spd = vSpd;
    float n = flowTex(vXY, vVel, 120.0, 0.25 + spd * 0.05);
    float nb = flowTex(vXY * 1.7, vVel, 260.0, 0.4 + spd * 0.06);
    vec3 N = normalize(vN + vec3(n - 0.5, 0.0, nb - 0.5) * (0.12 + 0.05 * min(spd, 12.0)));
    vec3 mud = mix(vec3(0.34, 0.26, 0.17), vec3(0.24, 0.21, 0.18), smoothstep(0.2, 0.55, cv));
    mud *= 0.85 + 0.3 * n;
    float foam = smoothstep(0.55, 0.85, nb + n * 0.4) * smoothstep(3.0, 10.0, spd) * (1.0 - smoothstep(0.35, 0.55, cv));
    mud = mix(mud, vec3(0.62, 0.56, 0.48), foam * 0.7);
    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 H = normalize(uSunDir + V);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col = mud * (uSunCol * ndl + uSkyCol * (0.5 + 0.5 * N.y));
    col += uSunCol * pow(max(dot(N, H), 0.0), 140.0) * 0.6 * (1.0 - cv);
    col = mix(col, uSkyCol * 0.9, fres * 0.35 * (1.0 - cv));
    col += mud * glowLight(vW, N);
    alpha = smoothstep(0.03, 0.4, hm);
  }
  col = fogApply(col, vW);
  gl_FragColor = vec4(col, alpha);
}`;

export function createTerrain(D, solver, satTex, opts = {}) {
  const { GR } = D;
  const step = opts.step || 1;
  const nx = Math.floor((D.nx - 1) / step) + 1, ny = Math.floor((D.ny - 1) / step) + 1;
  const pos = new Float32Array(nx * ny * 3), ij = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, gi = i * step, gj = j * step;
    pos[k * 3] = GR.X0 + gi * GR.cell; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = -(GR.Y1 - gj * GR.cell);
    ij[k * 2] = gi; ij[k * 2 + 1] = gj;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
  const g = new THREE.BufferGeometry();
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aIJ', new THREE.BufferAttribute(ij, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(2.7, 1.5, 0), 60);
  // textura DEM (R = altura, G = oclusión ambiental)
  const dd = new Float32Array(D.N * 2); for (let k = 0; k < D.N; k++) { dd[k * 2] = D.dem[k]; dd[k * 2 + 1] = D.ao[k]; }
  const demTex = new THREE.DataTexture(dd, D.nx, D.ny, THREE.RGFormat, THREE.FloatType); demTex.needsUpdate = true;
  demTex.minFilter = demTex.magFilter = THREE.NearestFilter;
  const glowP = [], glowC = []; for (let i = 0; i < 8; i++) { glowP.push(new THREE.Vector4()); glowC.push(new THREE.Vector3()); }
  const shared = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSkyCol: { value: new THREE.Color(0.3, 0.35, 0.45) }, uGroundCol: { value: new THREE.Color(0.08, 0.07, 0.05) },
    uFogCol: { value: new THREE.Color(0.7, 0.75, 0.8) }, uFogD: { value: 0.006 }, uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uAshHaze: { value: 0 },
    uGlowP: { value: glowP }, uGlowC: { value: glowC }, uEx: { value: 1.5 },
  };
  const dummy = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType); dummy.needsUpdate = true;
  const U = {
    ...shared,
    tDem: { value: demTex }, tTerr: { value: null }, tStatic: { value: solver.staticTex }, tStat: { value: null }, tFluidP: { value: null }, tAsh: { value: null }, tFire: { value: null }, tAcc: { value: dummy },
    tSat: { value: satTex }, uS: { value: solver.s }, uSimN: { value: new THREE.Vector2(solver.nx, solver.ny) }, uDemN: { value: new THREE.Vector2(D.nx, D.ny) },
    uAccN: { value: new THREE.Vector2(1, 1) }, uAccS: { value: 1 }, uProbCh: { value: 0 }, uAccCount: { value: 0 },
    uGrid: { value: new THREE.Vector4(GR.X0, GR.Y1, GR.cell, 0) }, uSatB: { value: new THREE.Vector4(GR.bx0, GR.bx1, GR.by0, GR.by1) },
    uBase: { value: 0 }, uOverlay: { value: 0 }, uSimT: { value: 0 }, uShadows: { value: 1 }, uContours: { value: 0 }, uVent: { value: new THREE.Vector2() }, uSnowVis: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, uniforms: U, extensions: { derivatives: true } });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
  // malla de fluidos en la resolución del solver
  const fx = solver.nx, fy = solver.ny;
  const fpos = new Float32Array(fx * fy * 3), fij = new Float32Array(fx * fy * 2);
  for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) { const k = j * fx + i, [x, y] = solver.world(i, j); fpos[k * 3] = x; fpos[k * 3 + 2] = -y; fij[k * 2] = i; fij[k * 2 + 1] = j; }
  const fidx = new Uint32Array((fx - 1) * (fy - 1) * 6); p = 0;
  for (let j = 0; j < fy - 1; j++) for (let i = 0; i < fx - 1; i++) { const a = j * fx + i, b = a + 1, c = a + fx, d = c + 1; fidx[p++] = a; fidx[p++] = c; fidx[p++] = b; fidx[p++] = b; fidx[p++] = c; fidx[p++] = d; }
  const fg = new THREE.BufferGeometry(); fg.setIndex(new THREE.BufferAttribute(fidx, 1)); fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3)); fg.setAttribute('aIJ', new THREE.BufferAttribute(fij, 2));
  const FU = { ...shared, tTerr: { value: null }, tFluid: { value: null }, tFluidP: { value: null }, tFluxA: { value: null }, uSimN: U.uSimN, uDxM: { value: solver.dx }, uLavaGain: { value: 1 } };
  const fmat = new THREE.ShaderMaterial({ vertexShader: FLUID_VS, fragmentShader: FLUID_FS, uniforms: FU, transparent: true, depthWrite: true });
  const fluid = new THREE.Mesh(fg, fmat); fluid.frustumCulled = false; fluid.renderOrder = 2;
  return {
    mesh, fluid, U, FU, shared, demTex,
    bind(sol) { const t = sol.U; U.tTerr.value = t[2]; U.tStat.value = t[3]; U.tFluidP.value = t[1]; U.tAsh.value = sol.ashTex; U.tFire.value = sol.fireTex;
      FU.tTerr.value = t[2]; FU.tFluid.value = t[0]; FU.tFluidP.value = t[1]; FU.tFluxA.value = sol.FX[0]; },
    setAcc(tex, n, s, count) { U.tAcc.value = tex; U.uAccN.value.set(n[0], n[1]); U.uAccS.value = s; U.uAccCount.value = count; },
  };
}
