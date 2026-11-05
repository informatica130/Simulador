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
float hgPhase(float mu, float g){ float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }
vec3 fogApply(vec3 c, vec3 wp){
  vec3 dv = wp - uCamPos; float d = length(dv);
  float hgt = max(0.0, min(wp.y, uCamPos.y));
  // extinción con atmósfera exponencial en altura (aerosoles concentrados en los valles)
  float f = 1.0 - exp(-d * uFogD * exp(-hgt * 0.22));
  float mu = dot(dv / max(d, 1e-4), normalize(uSunDir));
  vec3 inscat = uFogCol + uSunCol * 0.06 * hgPhase(mu, 0.72) * max(uSunDir.y + 0.1, 0.0);
  // tinte azul de Rayleigh lejano
  inscat = mix(inscat, inscat * vec3(0.86, 0.93, 1.08), smoothstep(5.0, 40.0, d));
  vec3 fc = mix(inscat, vec3(0.32, 0.30, 0.28) * (0.25 + 0.75 * max(uSunDir.y, 0.05)), uAshHaze);
  return mix(c * mix(vec3(1.0), vec3(0.97, 0.985, 1.0), f), fc, clamp(f + uAshHaze * min(1.0, d * 0.08), 0.0, 1.0));
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
uniform sampler2D tH30, tTerr, tStatic, tStat, tFluidP, tAsh, tFire, tAcc;
uniform float uEx; uniform int uS; uniform ivec2 uSimN; uniform ivec2 uN30; uniform int uStep;
uniform ivec2 uAccN; uniform int uAccS; uniform int uProbCh;
uniform vec4 uGrid; // X0, Y1, celda 60 m (km), celda 30 m (km)
varying vec3 vW; varying vec2 vXY; varying float vZ; varying vec2 vDG; varying vec3 vNv;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying float vIce;
vec2 simC(vec2 xy){ vec2 c = vec2((xy.x - uGrid.x) / uGrid.z, (uGrid.y - xy.y) / uGrid.z); return (c - 0.5 * float(uS - 1)) / float(uS); }
vec4 simB(sampler2D t, vec2 c){
  ivec2 lo = ivec2(0), hi = uSimN - 1; vec2 i0 = floor(c), w = c - i0; ivec2 a = ivec2(i0);
  vec4 v00 = texelFetch(t, clamp(a, lo, hi), 0), v10 = texelFetch(t, clamp(a + ivec2(1, 0), lo, hi), 0);
  vec4 v01 = texelFetch(t, clamp(a + ivec2(0, 1), lo, hi), 0), v11 = texelFetch(t, clamp(a + ivec2(1, 1), lo, hi), 0);
  return mix(mix(v00, v10, w.x), mix(v01, v11, w.x), w.y);
}
vec4 simN(sampler2D t, vec2 c){ return texelFetch(t, clamp(ivec2(floor(c + 0.5)), ivec2(0), uSimN - 1), 0); }
float delta(vec2 c){ return simB(tTerr, c).r - simB(tStatic, c).r; }
float h30(ivec2 ij){ return texelFetch(tH30, clamp(ij, ivec2(0), uN30 - 1), 0).r; }
void main(){
  ivec2 ij = ivec2(aIJ);
  vec2 xy = vec2(position.x, -position.z);
  vec2 sc = simC(xy);
  float dl = delta(sc);
  float z = h30(ij) + dl;
  // gradiente del cambio de relieve causado por la simulación (depósitos, erosión, fusión)
  float e = 1.0;
  vDG = vec2(delta(sc + vec2(e, 0.0)) - delta(sc - vec2(e, 0.0)), delta(sc - vec2(0.0, e)) - delta(sc + vec2(0.0, e))) / (2.0 * e * uGrid.z * 1000.0 * float(uS));
  // normal de vértice (respaldo en la distancia)
  float zx = h30(ij + ivec2(uStep, 0)) - h30(ij - ivec2(uStep, 0)), zy = h30(ij - ivec2(0, uStep)) - h30(ij + ivec2(0, uStep));
  float c2 = 2.0 * uGrid.w * 1000.0 * float(uStep);
  vNv = normalize(vec3(-(zx / c2 + vDG.x) * uEx, 1.0, (zy / c2 + vDG.y) * uEx));
  vec3 p = vec3(position.x, z / 1000.0 * uEx, position.z);
  vW = p; vXY = xy; vZ = z;
  vec4 tr = simB(tTerr, sc), s0 = simB(tStatic, sc), st = simB(tStat, sc);
  vec4 fp = simB(tFluidP, sc), ash = simB(tAsh, sc), fi = simB(tFire, sc);
  vec4 stN = simN(tStat, sc), fpN = simN(tFluidP, sc);
  st.yw = stN.yw; fp.z = fpN.z;
  vec2 ac = vec2((xy.x - uGrid.x) / uGrid.z, (uGrid.y - xy.y) / uGrid.z) / float(uAccS);
  vec4 acc = texelFetch(tAcc, clamp(ivec2(ac), ivec2(0), uAccN - 1), 0);
  float pr = uProbCh == 0 ? acc.x : uProbCh == 1 ? acc.y : uProbCh == 2 ? acc.z : acc.w;
  vA = vec4(tr.y, tr.x - s0.x, st.z, ash.x);
  vB = vec4(fi.y, fi.z, st.x, st.y);
  vC = vec4(pr, st.w, s0.y, ash.z); vIce = s0.w;
  vD = vec4(fp.w, fp.z, tr.w, tr.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const TERRAIN_FS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D tSat, tSatHi, tH30, tDet, tHf, tShadow; uniform ivec2 uN30; uniform vec4 uGrid; uniform vec4 uSatB; uniform vec4 uHiB; uniform float uHiOn;
uniform float uEx; uniform int uBase; uniform int uOverlay; uniform float uAccCount; uniform float uSimT;
uniform float uShadows; uniform float uContours; uniform float uSnowVis; uniform float uNight; uniform float uZone;
varying vec3 vW; varying vec2 vXY; varying float vZ; varying vec2 vDG; varying vec3 vNv;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying float vIce;
` + COMMON_GLSL + /* glsl */`
float demAt(vec2 xy){ ivec2 ij = ivec2(floor((xy.x - uGrid.x) / uGrid.w + 0.5), floor((uGrid.y - xy.y) / uGrid.w + 0.5));
  if (ij.x < 0 || ij.y < 0 || ij.x >= uN30.x || ij.y >= uN30.y) return -1e4; return texelFetch(tH30, ij, 0).r; }
float demF(vec2 xy){ vec2 u = vec2(((xy.x - uGrid.x) / uGrid.w + 0.5) / float(uN30.x), ((uGrid.y - xy.y) / uGrid.w + 0.5) / float(uN30.y));
  return texture2D(tHf, u).r; }
float shadow(vec3 p, vec3 L){
  if (L.y <= 0.0) return 0.0;
  float t = 0.03, res = 1.0;
  for (int i = 0; i < 56; i++) {
    vec3 q = p + L * t; float h = demF(vec2(q.x, -q.z)) / 1000.0 * uEx; float d = q.y - h;
    if (d < -0.004) return 0.0;
    res = min(res, 12.0 * (d + 0.002) / t);
    t = t * 1.12 + 0.012;
    if (t > 45.0 || q.y > 3.3 * uEx) break;
  }
  return clamp(res, 0.0, 1.0);
}
float dec(float b){ float v = b * 2.0 - 1.0; return sign(v) * v * v * 2.5; }
vec3 hyps(float h){ vec3 c = mix(vec3(.20, .34, .17), vec3(.42, .55, .28), smoothstep(300., 900., h)); c = mix(c, vec3(.70, .63, .42), smoothstep(900., 1500., h));
  c = mix(c, vec3(.52, .40, .30), smoothstep(1500., 2100., h)); c = mix(c, vec3(.60, .58, .56), smoothstep(2100., 2550., h)); return mix(c, vec3(.95, .96, .97), smoothstep(2500., 2800., h)); }
vec3 slopeC(float s){ vec3 c = mix(vec3(.3, .55, .3), vec3(.85, .8, .35), smoothstep(4., 12., s)); c = mix(c, vec3(.9, .5, .2), smoothstep(12., 24., s)); c = mix(c, vec3(.75, .15, .15), smoothstep(24., 36., s)); return mix(c, vec3(.35, .1, .35), smoothstep(36., 48., s)); }
vec3 ramp(float t){
  vec3 a = vec3(1.0, 0.93, 0.55), b = vec3(1.0, 0.62, 0.20), c = vec3(0.86, 0.22, 0.10), d = vec3(0.45, 0.04, 0.12);
  return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34); }
vec3 probRamp(float t){ vec3 a = vec3(0.16, 0.38, 0.75), b = vec3(0.30, 0.75, 0.55), c = vec3(0.98, 0.85, 0.30), d = vec3(0.90, 0.25, 0.15), e = vec3(0.55, 0.05, 0.25);
  return t < .25 ? mix(a, b, t / .25) : t < .5 ? mix(b, c, (t - .25) / .25) : t < .75 ? mix(c, d, (t - .5) / .25) : mix(d, e, (t - .75) / .25); }
float iso(float v, float step_){ float f = v / step_; float w = fwidth(f); return 1.0 - smoothstep(0.0, w * 1.2, abs(fract(f + 0.5) - 0.5)); }
vec2 rippleN(vec2 p, float t, float fw){
  // oleaje de viento en dos escalas; se atenúa cuando la onda es menor que un píxel (sin centelleo)
  float a1 = 1.0 - smoothstep(0.08, 0.5, fw * 220.0), a2 = 1.0 - smoothstep(0.08, 0.5, fw * 700.0);
  vec2 e = vec2(0.0015, 0.0);
  float h0 = a1 * vnoise(p * 220.0 + t * vec2(0.25, 0.12)) + 0.5 * a2 * vnoise(p * 700.0 - t * vec2(0.2, 0.45));
  float hx = a1 * vnoise((p + e.xy) * 220.0 + t * vec2(0.25, 0.12)) + 0.5 * a2 * vnoise((p + e.xy) * 700.0 - t * vec2(0.2, 0.45));
  float hy = a1 * vnoise((p + e.yx) * 220.0 + t * vec2(0.25, 0.12)) + 0.5 * a2 * vnoise((p + e.yx) * 700.0 - t * vec2(0.2, 0.45));
  return vec2(hx - h0, hy - h0) * 4.0;
}
void main(){
  float dist = length(uCamPos - vW);
  // --- imagen Sentinel-2 2024: base + recorte de alta resolución con borde suave
  vec2 uv = vec2((vXY.x - uSatB.x) / (uSatB.y - uSatB.x), (vXY.y - uSatB.z) / (uSatB.w - uSatB.z));
  vec3 alb = texture2D(tSat, uv).rgb;
  if (uHiOn > 0.5) {
    vec2 uh = vec2((vXY.x - uHiB.x) / (uHiB.y - uHiB.x), (vXY.y - uHiB.z) / (uHiB.w - uHiB.z));
    float m = 0.5 / (uHiB.y - uHiB.x);
    float wHi = smoothstep(0.0, m, uh.x) * smoothstep(0.0, m, 1.0 - uh.x) * smoothstep(0.0, m, uh.y) * smoothstep(0.0, m, 1.0 - uh.y);
    if (wHi > 0.0) alb = mix(alb, texture2D(tSatHi, uh).rgb, wHi);
  }
  // corrección de color del mosaico (contraste y saturación suaves)
  float lum = dot(alb, vec3(0.299, 0.587, 0.114));
  alb = max(mix(vec3(lum), alb, 1.18) * 1.06, 0.0);
  // --- detalle de relieve a 30 m (Copernicus GLO-30) + cambios simulados
  vec2 u30 = vec2(((vXY.x - uGrid.x) / uGrid.w + 0.5) / float(uN30.x), ((uGrid.y - vXY.y) / uGrid.w + 0.5) / float(uN30.y));
  vec4 det = texture2D(tDet, u30);
  vec2 g = vec2(dec(det.r), dec(det.g)) + vDG;
  vec3 N = normalize(vec3(-g.x * uEx, 1.0, g.y * uEx));
  N = normalize(mix(N, vNv, smoothstep(25.0, 60.0, dist)));
  float slopeDeg = degrees(atan(length(g)));
  float ao = det.b;
  float water = smoothstep(0.35, 0.7, det.a);
  if (uBase == 1) alb = hyps(vZ) * 0.6; else if (uBase == 2) alb = slopeC(slopeDeg) * 0.6;
  else if (uBase == 3) alb = mix(vec3(.80, .79, .74), vec3(.70, .67, .60), smoothstep(400., 2600., vZ));
  float swe = vA.x, dep = vA.y, lavaMax = vA.z, ash = vA.w;
  float n1 = fbm(vXY * 18.0), n2 = vnoise(vXY * 90.0);
  // --- micro-detalle procedural cerca de la cámara (textura bajo el píxel de 8–16 m)
  float near = 1.0 - smoothstep(1.5, 6.0, dist);
  if (near > 0.0 && uBase == 0) {
    // se atenúa cuando el detalle es más fino que un píxel (evita el grano/centelleo)
    float fwT = length(fwidth(vXY));
    float a1 = 1.0 - smoothstep(0.3, 0.8, fwT * 420.0), a2 = 1.0 - smoothstep(0.3, 0.8, fwT * 1500.0);
    float m1 = mix(0.5, fbm(vXY * 420.0), a1), m2 = mix(0.5, vnoise(vXY * 1500.0), a2);
    float veg = smoothstep(0.0, 0.05, alb.g - max(alb.r, alb.b));
    alb *= mix(1.0, mix(0.82 + 0.36 * m1, 0.75 + 0.5 * m2 * m1, veg), near);
    N = normalize(N + vec3(m1 - 0.5, 0.0, m2 - 0.5) * 0.25 * near * (1.0 - water));
  }
  // roca expuesta en paredes empinadas
  float rock = smoothstep(32.0, 45.0, slopeDeg) * (uBase == 0 ? 1.0 : 0.0);
  alb = mix(alb, vec3(0.13, 0.12, 0.115) * (0.75 + 0.5 * fbm(vec2(vXY.x * 60.0, vZ * 0.05))), rock * 0.55);
  // --- nieve estacional y glaciar (dinámicos)
  float swe0 = vC.z;
  if (uSnowVis > 0.5 && uBase == 0) {
    float seas = max(0.0, swe - vIce);
    float sn = smoothstep(0.02, 0.25, seas + (n1 - 0.5) * 0.08) * (1.0 - smoothstep(42.0, 58.0, slopeDeg));
    // nieve: costras de viento y sastrugi, y rocas que asoman donde el manto es delgado
    float sas = fbm(vec2(vXY.x * 140.0 + vXY.y * 60.0, vXY.y * 25.0));
    vec3 snowC = mix(vec3(0.56, 0.58, 0.62), vec3(0.74, 0.75, 0.77), n2 * 0.6 + sas * 0.4);   // nieve envejecida con polvo volcánico
    float thin = smoothstep(0.35, 0.05, seas) * smoothstep(0.55, 0.75, fbm(vXY * 55.0));
    alb = mix(alb, snowC, sn * 0.9 * (1.0 - thin * 0.7));
    float ice = smoothstep(1.0, 6.0, min(swe, vIce));
    alb = mix(alb, alb * vec3(0.92, 0.97, 1.05), ice * 0.5 * smoothstep(0.5, 0.75, fbm(vXY * 40.0 + vec2(n1 * 3.0, 0.0))));
    float melted = swe0 > 0.3 ? smoothstep(0.7, 0.15, swe / swe0) : 0.0;
    alb = mix(alb, vec3(0.085, 0.078, 0.072) * (0.8 + 0.4 * n2), melted * 0.92);
  }
  // --- caída de tefra (mm ≈ kg/m²)
  if (ash > 0.05) {
    float f = clamp(log(1.0 + ash) / log(1.0 + 120.0), 0.0, 1.0);
    float coarse = clamp(vC.w / max(ash, 1e-3), 0.0, 1.0);
    vec3 ac = mix(vec3(0.40, 0.385, 0.37), vec3(0.16, 0.13, 0.12), coarse) * (0.9 + 0.2 * n2);
    alb = mix(alb, ac, f * 0.95); water *= 1.0 - f * 0.6;
  }
  // --- depósitos y erosión
  float isLava = step(0.3, lavaMax);
  if (dep > 0.04) {
    vec3 lc = vec3(0.045, 0.042, 0.040) * (0.7 + 0.8 * n2) + vec3(0.02, 0.01, 0.0) * n1;
    float age = vB.w > 0.0 ? (uSimT - vB.w) / 3600.0 : 99.0;
    vec3 mc = mix(vec3(0.20, 0.17, 0.14), vec3(0.42, 0.38, 0.33), smoothstep(0.5, 12.0, age)) * (0.85 + 0.3 * n2);
    alb = mix(alb, isLava > 0.5 ? lc : mc, smoothstep(0.04, 0.5, dep)); water *= 1.0 - smoothstep(0.04, 0.5, dep);
  } else if (dep < -0.4) {
    alb = mix(alb, vec3(0.22, 0.20, 0.17) * (0.8 + 0.4 * n2), smoothstep(0.4, 2.0, -dep) * 0.85);
  }
  if (vD.x > 0.2) alb = mix(alb, vec3(0.36, 0.34, 0.32) * (0.85 + 0.3 * n2), smoothstep(0.2, 1.0, vD.x) * 0.8);
  float burn = vB.x, scorch = vB.y;
  alb = mix(alb, vec3(0.035, 0.03, 0.028) * (0.7 + 0.6 * n2), scorch * 0.9);
  // --- iluminación
  // sombra del relieve precalculada (se recalcula sólo cuando el sol se mueve)
  float sh = uShadows > 0.5 ? texture2D(tShadow, u30).r : 1.0;
  vec3 L = uSunDir; vec3 V = normalize(uCamPos - vW);
  float ndl = max(dot(N, L), 0.0);
  // luz del cielo con oclusión y luz rebotada del terreno
  vec3 col = alb * (uSunCol * ndl * sh + uSkyCol * (0.55 + 0.45 * N.y) * ao + uGroundCol * (0.5 - 0.5 * N.y));
  vec3 H = normalize(L + V);
  float icy = smoothstep(0.1, 1.0, swe) * (uSnowVis > 0.5 ? 1.0 : 0.0);
  col += uSunCol * pow(max(dot(N, H), 0.0), 60.0) * 0.18 * icy * sh;
  col += alb * glowLight(vW, N);
  // --- lagos: reflejo del cielo (Fresnel), destello solar y oleaje
  if (water > 0.01 && uBase == 0) {
    vec2 rn = rippleN(vXY, uTime, length(fwidth(vXY)));
    vec3 Nw = normalize(vec3(rn.x * 0.10, 1.0, -rn.y * 0.10));
    vec3 R = reflect(-V, Nw);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    // cielo reflejado; cerca del horizonte se refleja la orilla (bosque y cerros, más oscuros)
    vec3 sky = mix(uFogCol * 0.85, uSkyCol * 1.7, smoothstep(0.0, 0.45, R.y));
    sky = mix(vec3(0.02, 0.03, 0.025) * (uSkyCol * 2.0 + uSunCol * 0.2), sky, smoothstep(0.02, 0.12, R.y));
    vec3 deep = mix(vec3(0.008, 0.026, 0.032), alb * 0.5, 0.3) * (uSkyCol * 1.4 + uSunCol * 0.15);
    vec3 wc = mix(deep, sky, fres * 0.85) + uSunCol * pow(max(dot(R, L), 0.0), 300.0) * 5.0 * sh;
    wc += glowLight(vW, Nw) * 0.25;
    col = mix(col, wc, water);
  }
  if (burn > 0.5) { float fl = 0.6 + 0.4 * sin(uTime * 13.0 + n1 * 30.0) * vnoise(vXY * 120.0 + uTime * 2.0);
    // brasas y frente de llamas: de día casi no se ven, de noche brillan
    float fwB = length(fwidth(vXY)), aB = 1.0 - smoothstep(0.3, 0.8, fwB * 160.0);
    float pat = mix(0.45, smoothstep(0.45, 0.8, vnoise(vXY * 160.0 + uTime * 0.3) * 0.6 + vnoise(vXY * 45.0) * 0.4), aB);
    col = mix(col, vec3(0.03, 0.025, 0.02), 0.5);
    col += vec3(1.0, 0.36, 0.07) * (0.35 + 2.4 * uNight) * fl * pat; }
  // --- zona ya alcanzada por flujos (como la capa de inundación de la versión anterior)
  {
    // suelo empapado y embarrado por donde pasó el lahar (más oscuro y con brillo húmedo)
    float wetZ = smoothstep(0.1, 0.8, vB.z) * (1.0 - water) * (uBase == 0 ? 1.0 : 0.0);
    if (wetZ > 0.0) {
      float age = vB.w > 0.0 ? max(0.0, uSimT - vB.w) / 3600.0 : 0.0;
      float dry = smoothstep(1.0, 18.0, age);
      vec3 wm = mix(vec3(0.10, 0.085, 0.07), vec3(0.30, 0.27, 0.23), dry) * (0.85 + 0.3 * n2);
      col = mix(col, wm * (uSunCol * ndl * sh + uSkyCol * ao), wetZ * 0.75);
      col += uSunCol * pow(max(dot(N, H), 0.0), 90.0) * 0.25 * wetZ * (1.0 - dry) * sh;
    }
  }
  if (uZone > 0.5 && uOverlay == 0) {
    float zl = smoothstep(0.08, 0.6, vB.z), zv = smoothstep(0.05, 0.4, lavaMax), zp = smoothstep(0.05, 0.5, vD.x);
    vec3 zc = vec3(1.0, 0.62, 0.18) * zl + vec3(1.0, 0.25, 0.08) * zv + vec3(0.75, 0.5, 1.0) * zp;
    float za = max(max(zl * (0.16 + 0.14 * smoothstep(0.6, 5.0, vB.z)) * (0.5 + 0.5 * smoothstep(2.0, 8.0, dist)), zv * 0.25), zp * 0.3);
    if (za > 0.0) col = mix(col, zc / max(zl + zv + zp, 1e-3) * (0.35 + 0.65 * (uSunCol.r * 0.3 + 0.5)), za);
  }
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
uniform sampler2D tTerr, tFluid, tFluidP, tFluxA, tFluxB, tBase; uniform ivec2 uSimN; uniform float uEx; uniform float uDxM; uniform float uArrows;
varying vec3 vW; varying vec4 vF; varying vec2 vVel; varying vec2 vXY; varying float vHp; varying vec3 vN; varying float vSpd; varying float vEx; flat varying float vKind; varying vec2 vIJ;
vec4 fl(ivec2 p){ return texelFetch(tFluid, clamp(p, ivec2(0), uSimN - 1), 0); }
float hp_(ivec2 p){ return texelFetch(tFluidP, clamp(p, ivec2(0), uSimN - 1), 0).x; }
float dep(ivec2 p){ vec4 f = fl(p); return f.x + f.z + hp_(p) * 0.6; }
float surf(ivec2 p){ p = clamp(p, ivec2(0), uSimN - 1); return texelFetch(tTerr, p, 0).r + dep(p); }
void main(){
  ivec2 p = ivec2(aIJ);
  vec4 f = fl(p); float bed = texelFetch(tTerr, p, 0).r; float hp = hp_(p);
  float h = dep(p);
  float hn = max(max(dep(p + ivec2(1, 0)), dep(p - ivec2(1, 0))), max(dep(p + ivec2(0, 1)), dep(p - ivec2(0, 1))));
  // vista lejana: los flujos se elevan un poco para no quedar ocultos por el relieve más fino
  float camD = length(cameraPosition - vec3(position.x, bed / 1000.0 * uEx, position.z));
  float lift = 1.5 + clamp(camD * 2.5, 0.0, 6.0) + uArrows * clamp((camD - 3.0) * 1.2, 0.0, 30.0);
  float y = h > 0.02 ? bed + h + 0.6 + lift : bed - (hn > 0.0 ? 0.3 : 4.0);
  vec4 q = texelFetch(tFluxA, p, 0), qW = texelFetch(tFluxA, clamp(p - ivec2(1, 0), ivec2(0), uSimN - 1), 0), qN = texelFetch(tFluxA, clamp(p - ivec2(0, 1), ivec2(0), uSimN - 1), 0);
  vec4 b = texelFetch(tFluxB, p, 0), bW = texelFetch(tFluxB, clamp(p - ivec2(1, 0), ivec2(0), uSimN - 1), 0), bN = texelFetch(tFluxB, clamp(p - ivec2(0, 1), ivec2(0), uSimN - 1), 0);
  vec2 vm = vec2(0.5 * (qW.x + q.x), -0.5 * (qN.y + q.y)) / max(f.x, 0.05);
  vec2 vl = vec2(0.5 * (qW.z + q.z), -0.5 * (qN.w + q.w)) / max(f.z, 0.05);
  vec2 vp = vec2(0.5 * (bW.x + b.x), -0.5 * (bN.y + b.y)) / max(hp, 0.05);
  // tipo: 0 agua/lahar, 1 lava, 2 corriente piroclástica
  vKind = (f.z > 0.03 && f.z >= f.x * 0.5) ? 1.0 : (hp > 0.05 && hp > f.x) ? 2.0 : 0.0;
  vVel = vKind == 1.0 ? vl : vKind == 2.0 ? vp : vm; vSpd = length(vVel);
  float sx = surf(p + ivec2(1, 0)) - surf(p - ivec2(1, 0)), sy = surf(p + ivec2(0, 1)) - surf(p - ivec2(0, 1));
  vN = normalize(vec3(-sx / 1000.0 * uEx / (2.0 * uDxM / 1000.0), 1.0, -sy / 1000.0 * uEx / (2.0 * uDxM / 1000.0)));
  vF = f; vHp = hp; vEx = f.x - texelFetch(tBase, p, 0).r; vIJ = aIJ;
  vec3 pos = vec3(position.x, y / 1000.0 * uEx, position.z);
  vW = pos; vXY = vec2(position.x, -position.z);
  // sesgo de profundidad hacia la cámara: el flujo se ve sobre el relieve de 30 m aunque el lecho del
  // motor (120 m) quede algo más bajo en cauces encajonados
  vec3 toC = cameraPosition - pos; float dC = length(toC);
  if (h > 0.02) pos += toC / max(dC, 1e-4) * min(dC * 0.4, 0.012 + dC * 0.008);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const FLUID_FS = /* glsl */`
precision highp float; precision highp sampler2D; precision highp int;
varying vec3 vW; varying vec4 vF; varying vec2 vVel; varying vec2 vXY; varying float vHp; varying vec3 vN; varying float vSpd; varying float vEx; flat varying float vKind; varying vec2 vIJ;
uniform float uLavaGain; uniform float uArrows; uniform float uFlowVis;
uniform sampler2D tFluid, tFluidP; uniform ivec2 uSimN;
// interpolación bilineal por píxel de la profundidad (contornos suaves aunque la malla sea de 120 m)
vec4 bil(sampler2D t, vec2 c){
  vec2 f = fract(c); ivec2 i = ivec2(floor(c)); ivec2 m = uSimN - 1;
  vec4 a = texelFetch(t, clamp(i, ivec2(0), m), 0), b = texelFetch(t, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
  vec4 cc = texelFetch(t, clamp(i + ivec2(0, 1), ivec2(0), m), 0), d = texelFetch(t, clamp(i + ivec2(1, 1), ivec2(0), m), 0);
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}
` + COMMON_GLSL + /* glsl */`
float flowTex(vec2 xy, vec2 vel, float scale, float speed){
  float ph = uTime * speed; float a = fract(ph), b = fract(ph + 0.5);
  vec2 v = vel * 0.001;
  float n1 = fbm((xy - v * a * 180.0) * scale), n2 = fbm((xy - v * b * 180.0) * scale + 17.3);
  return mix(n1, n2, 1.0 - abs(1.0 - 2.0 * a));
}
// Flechas (chevrones) que avanzan en la dirección y con la rapidez del flujo
float chevrons(vec2 xy, vec2 vel, float spacing, float t){
  float sp = length(vel); if (sp < 0.08) return 0.0;
  vec2 d = vel / sp, n = vec2(-d.y, d.x);
  float a = dot(xy, d) / spacing, c = dot(xy, n) / spacing;
  float row = floor(c), cc = fract(c) - 0.5;
  float move = t * clamp(sp, 0.3, 25.0) * 0.001 / spacing * uFlowVis;
  float aa = fract(a - move + h21(vec2(row, 3.1)) * 0.6);
  float line = abs(aa - 0.62 + abs(cc) * 0.75);
  return (1.0 - smoothstep(0.045, 0.11, line)) * (1.0 - smoothstep(0.30, 0.40, abs(cc)));
}
void main(){
  vec4 fb = bil(tFluid, vIJ); float hpb = bil(tFluidP, vIJ).x;
  float hm = fb.x, cv = vF.y, hl = fb.z, T = vF.w;
  bool lava = vKind == 1.0, pdc = vKind == 2.0;
  if (lava && hl < 0.02) discard;
  if (pdc && hpb < 0.03) discard;
  // tamaño del píxel en el suelo (km): atenúa el detalle más fino que un píxel (sin grano)
  float fw = length(fwidth(vXY));
  if (!lava && !pdc && hm < 0.03) discard;
  float dist = length(uCamPos - vW);
  vec3 V = normalize(uCamPos - vW);
  vec3 col; float alpha = 1.0;
  bool lahar = !lava && !pdc && (vEx > 0.05 || cv > 0.04);
  if (lava) {
    float n = flowTex(vXY, vVel, 70.0, 0.05);
    float crk = 1.0 - smoothstep(0.015, 0.07, abs(n - 0.5));
    float crk2 = 1.0 - smoothstep(0.01, 0.05, abs(fbm(vXY * 240.0 + n) - 0.5));
    float mob = clamp(vSpd / 1.2, 0.0, 1.0);
    float Tcrust = 278.0 + (T - 278.0) * mix(0.42, 0.62, mob);
    float open = clamp(crk * (0.55 + 0.45 * mob) + crk2 * 0.35 + smoothstep(0.75, 0.95, mob) * 0.4, 0.0, 1.0);
    float Ts = mix(Tcrust, T, open);
    vec3 em = blackbody(Ts) * bbRad(Ts) * uLavaGain;
    vec3 N = normalize(vN + vec3(n - 0.5, 0.0, fbm(vXY * 150.0) - 0.5) * 0.6);
    vec3 rock = vec3(0.05, 0.045, 0.042) * (0.6 + 0.8 * vnoise(vXY * 300.0));
    col = rock * (uSunCol * max(dot(N, uSunDir), 0.0) + uSkyCol * 0.6) + em + glowLight(vW, N) * rock * 2.0;
    alpha = smoothstep(0.02, 0.25, hl);
  } else if (pdc) {
    float n = flowTex(vXY, vVel, 90.0, 0.4);
    vec3 N = normalize(vN + vec3(n - 0.5, 0.0, n - 0.5) * 0.5);
    vec3 ash = vec3(0.24, 0.225, 0.215) * (0.8 + 0.4 * n);
    col = ash * (uSunCol * (0.4 + 0.6 * max(dot(N, uSunDir), 0.0)) + uSkyCol);
    col += vec3(1.0, 0.4, 0.1) * 0.15 * smoothstep(600.0, 900.0, T) * n;
    alpha = smoothstep(0.03, 0.6, hpb) * 0.9;
  } else {
    float spd = vSpd;
    // marco alineado con la corriente: vetas y ondas estiradas a lo largo del flujo
    vec2 dir = spd > 0.05 ? vVel / spd : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float ph = uTime * (0.08 + 0.02 * min(spd, 15.0));
    float pa = fract(ph), pb = fract(ph + 0.5), wab = 1.0 - abs(1.0 - 2.0 * pa);
    vec2 adv = vVel * 0.001 * 140.0;
    vec2 qa = vXY - adv * pa, qb = vXY - adv * pb + 11.7;
    vec2 sa = vec2(dot(qa, dir), dot(qa, nrm)) * vec2(110.0, 330.0), sb = vec2(dot(qb, dir), dot(qb, nrm)) * vec2(110.0, 330.0);
    // altura de la superficie: ondas estacionarias + turbulencia (dos fases cruzadas, sin saltos)
    float aaF = 1.0 - smoothstep(0.25, 0.7, fw * 330.0 * 3.1);
    float wa = fbm(sa) * 0.6 + (vnoise(sa * 3.1) - 0.5) * 0.4 * aaF + 0.2, wb = fbm(sb) * 0.6 + (vnoise(sb * 3.1) - 0.5) * 0.4 * aaF + 0.2;
    float n = mix(wa, wb, wab);
    vec2 e = vec2(0.004, 0.0);
    float nx = mix(fbm(sa + e.xy * 110.0) * 0.6 + (vnoise((sa + e.xy * 110.0) * 3.1) - 0.5) * 0.4 * aaF + 0.2, fbm(sb + e.xy * 110.0) * 0.6 + (vnoise((sb + e.xy * 110.0) * 3.1) - 0.5) * 0.4 * aaF + 0.2, wab);
    float ny = mix(fbm(sa + e.yx * 330.0) * 0.6 + (vnoise((sa + e.yx * 330.0) * 3.1) - 0.5) * 0.4 * aaF + 0.2, fbm(sb + e.yx * 330.0) * 0.6 + (vnoise((sb + e.yx * 330.0) * 3.1) - 0.5) * 0.4 * aaF + 0.2, wab);
    float rough = (0.25 + 0.09 * min(spd, 10.0)) * (1.0 - smoothstep(0.4, 1.2, fw * 330.0));
    vec2 gd = vec2(nx - n, ny - n) * rough * 9.0;
    vec2 gw = dir * gd.x + nrm * gd.y;
    vec3 N = normalize(vN + vec3(gw.x, 0.0, -gw.y));
    float edge = 1.0 - smoothstep(0.05, 0.7, hm);
    // barro volcánico: café grisáceo, más claro y opaco cuanto más sedimento; agua de crecida más verdosa
    float clean = 1.0 - smoothstep(0.004, 0.06, cv);
    vec3 mud = mix(vec3(0.19, 0.15, 0.105), vec3(0.22, 0.20, 0.17), smoothstep(0.2, 0.55, cv));
    mud = mix(mud, vec3(0.16, 0.18, 0.15), clean * 0.85);
    mud *= 0.82 + 0.36 * n;
    // espuma y salpicadura en los rápidos y en las crestas
    float crest = smoothstep(0.7, 0.9, n + 0.12 * (vnoise(vXY * 900.0) - 0.5) * (1.0 - smoothstep(0.2, 0.6, fw * 900.0)));
    float foam = crest * smoothstep(2.0 + 2.0 * (1.0 - clean), 8.0 + 4.0 * (1.0 - clean), spd) * 0.6;
    foam = max(foam, edge * smoothstep(0.55, 0.8, vnoise((vXY - adv * pa) * 520.0)) * smoothstep(0.5, 3.0, spd) * 0.4 * (1.0 - smoothstep(0.2, 0.6, fw * 520.0)));
    mud = mix(mud, vec3(0.62, 0.58, 0.51), foam * 0.7);
    // escombros flotantes (troncos, bloques de pómez y escoria) arrastrados por la corriente
    vec2 dq = vec2(dot(vXY - adv * pa * 1.0, dir), dot(vXY, nrm)) * vec2(160.0, 260.0);
    vec2 dc = floor(dq), df = fract(dq) - 0.5;
    float dh = h21(dc + 7.3);
    float debris = (dh > 0.86 ? 1.0 : 0.0) * (1.0 - smoothstep(0.15, 0.4, fw * 260.0)) * (1.0 - smoothstep(0.08, 0.2, length(df * vec2(1.0, 2.5) + (h21(dc) - 0.5) * 0.4))) * wab;
    debris *= smoothstep(0.08, 0.3, cv) * smoothstep(0.3, 0.8, hm);
    mud = mix(mud, vec3(0.13, 0.10, 0.08), debris * 0.85);
    // orilla: lámina delgada y mojada, más oscura
    mud *= 1.0 - edge * 0.35;
    vec3 H = normalize(uSunDir + V);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    float wet = mix(0.55, 1.0, clean) * (1.0 - foam);
    col = mud * (uSunCol * (0.15 + 0.85 * max(dot(N, uSunDir), 0.0)) + uSkyCol * (0.55 + 0.45 * N.y));
    col += uSunCol * pow(max(dot(N, H), 0.0), mix(60.0, 220.0, clean)) * mix(0.35, 0.9, clean) * wet;
    vec3 R = reflect(-V, N);
    vec3 sky = mix(uFogCol, uSkyCol * 1.8, smoothstep(0.0, 0.5, R.y));
    col = mix(col, sky, fres * mix(0.25, 0.8, clean) * wet);
    col += mud * glowLight(vW, N);
    alpha = smoothstep(0.03, 0.35, hm) * mix(1.0, 0.85, clean);
    if (hm < 0.03) discard;
  }
  // --- indicadores: color del fenómeno resaltado desde lejos, borde y flechas de movimiento
  if (uArrows > 0.5 && (lava || pdc || lahar)) {
    vec3 kc = lava ? vec3(1.0, 0.55, 0.12) : pdc ? vec3(0.78, 0.52, 1.0) : vec3(1.0, 0.68, 0.22);
    float far = smoothstep(2.0, 9.0, dist);
    col = mix(col, kc * (uSunCol * 0.25 + uSkyCol + 0.3), far * 0.55);
    float depth = lava ? hl : pdc ? vHp : vEx;
    float edge = 1.0 - smoothstep(0.05, 0.6, depth);
    col = mix(col, kc * 1.1, edge * 0.25 * (0.4 + 0.6 * far));
    float spacing = clamp(dist * 0.03, 0.035, 0.9);
    float ch = chevrons(vXY, vVel, spacing, uTime) * smoothstep(1.2, 4.0, dist);
    col = mix(col, kc * (lava ? 2.0 : 1.5), ch * 0.75);
    alpha = max(alpha, ch * 0.85);
    alpha = max(alpha, far * 0.85);
  }
  col = fogApply(col, vW);
  gl_FragColor = vec4(col, alpha);
}`;

const SHADOW_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const SHADOW_FS = /* glsl */`
precision highp float;
uniform sampler2D tHf; uniform vec4 uGrid; uniform ivec2 uN30; uniform vec3 uSunDir; uniform float uEx;
varying vec2 vUv;
float demF(vec2 xy){ vec2 u = vec2(((xy.x - uGrid.x) / uGrid.w + 0.5) / float(uN30.x), ((uGrid.y - xy.y) / uGrid.w + 0.5) / float(uN30.y)); return texture2D(tHf, u).r; }
void main(){
  // centro del texel en coordenadas del mundo (km); v = 0 al norte (misma convención que u30 en el terreno)
  vec2 xy = vec2(uGrid.x + (vUv.x * float(uN30.x) - 0.5) * uGrid.w, uGrid.y - (vUv.y * float(uN30.y) - 0.5) * uGrid.w);
  vec3 L = uSunDir;
  if (L.y <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 p = vec3(xy.x, demF(xy) / 1000.0 * uEx + 0.006, -xy.y);
  float t = 0.03, res = 1.0;
  for (int i = 0; i < 64; i++) {
    vec3 q = p + L * t; float d = q.y - demF(vec2(q.x, -q.z)) / 1000.0 * uEx;
    if (d < -0.004) { res = 0.0; break; }
    res = min(res, 12.0 * (d + 0.002) / t);
    t = t * 1.1 + 0.012;
    if (t > 45.0 || q.y > 3.3 * uEx) break;
  }
  gl_FragColor = vec4(clamp(res, 0.0, 1.0));
}`;

export function createTerrain(D, solver, satTex, opts = {}) {
  const { GR } = D;
  const step = opts.step || 2;                      // paso de la malla sobre el DEM de 30 m
  const nx = Math.floor((D.nx30 - 1) / step) + 1, ny = Math.floor((D.ny30 - 1) / step) + 1;
  const pos = new Float32Array(nx * ny * 3), ij = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, gi = i * step, gj = j * step;
    pos[k * 3] = GR.X0 + gi * D.cell30; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = -(GR.Y1 - gj * D.cell30);
    ij[k * 2] = gi; ij[k * 2 + 1] = gj;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    // diagonal alternada para que los cauces no queden escalonados
    if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; } else { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; } }
  const g = new THREE.BufferGeometry();
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aIJ', new THREE.BufferAttribute(ij, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(2.7, 1.5, 0), 60);
  // alturas a 30 m (float, sin filtrar) y detalle RGBA8 (gradiente, oclusión, agua) con mipmaps
  const h30 = new THREE.DataTexture(D.dem30, D.nx30, D.ny30, THREE.RedFormat, THREE.FloatType); h30.needsUpdate = true;
  h30.minFilter = h30.magFilter = THREE.NearestFilter;
  // copia en media precisión con filtrado lineal (sombras suaves sin escalones)
  const hh = new Uint16Array(D.N30); for (let k = 0; k < D.N30; k++) hh[k] = THREE.DataUtils.toHalfFloat(D.dem30[k]);
  const hf = new THREE.DataTexture(hh, D.nx30, D.ny30, THREE.RedFormat, THREE.HalfFloatType); hf.minFilter = hf.magFilter = THREE.LinearFilter; hf.needsUpdate = true;
  // mapa de sombras (RGBA8, filtrado lineal) en la grilla de 30 m
  const shRT = new THREE.WebGLRenderTarget(D.nx30, D.ny30, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
  const shMat = new THREE.ShaderMaterial({ vertexShader: SHADOW_VS, fragmentShader: SHADOW_FS, depthTest: false, depthWrite: false,
    uniforms: { tHf: { value: hf }, uGrid: { value: new THREE.Vector4(GR.X0, GR.Y1, GR.cell, D.cell30) }, uN30: { value: new THREE.Vector2(D.nx30, D.ny30) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uEx: { value: 1.5 } } });
  const shScene = new THREE.Scene(), shCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const shQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shMat); shQuad.frustumCulled = false; shScene.add(shQuad);
  const lastSun = new THREE.Vector3(); let lastEx = 0;
  const det = new THREE.DataTexture(D.det30, D.nx30, D.ny30, THREE.RGBAFormat, THREE.UnsignedByteType);
  det.minFilter = THREE.LinearMipmapLinearFilter; det.magFilter = THREE.LinearFilter; det.generateMipmaps = true; det.needsUpdate = true;
  const glowP = [], glowC = []; for (let i = 0; i < 8; i++) { glowP.push(new THREE.Vector4()); glowC.push(new THREE.Vector3()); }
  const shared = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSkyCol: { value: new THREE.Color(0.3, 0.35, 0.45) }, uGroundCol: { value: new THREE.Color(0.08, 0.07, 0.05) },
    uFogCol: { value: new THREE.Color(0.7, 0.75, 0.8) }, uFogD: { value: 0.006 }, uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uAshHaze: { value: 0 },
    uGlowP: { value: glowP }, uGlowC: { value: glowC }, uEx: { value: 1.5 }, uNight: { value: 0 },
  };
  const dummy = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType); dummy.needsUpdate = true;
  const hiB = opts.hiBounds || [0, 1, 0, 1];
  const U = {
    ...shared,
    tH30: { value: h30 }, tHf: { value: hf }, tShadow: { value: shRT.texture }, tDet: { value: det }, tTerr: { value: null }, tStatic: { value: solver.staticTex }, tStat: { value: null }, tFluidP: { value: null }, tAsh: { value: null }, tFire: { value: null }, tAcc: { value: dummy },
    tSat: { value: satTex }, tSatHi: { value: opts.satHi || satTex }, uHiOn: { value: opts.satHi ? 1 : 0 }, uHiB: { value: new THREE.Vector4(...hiB) },
    uS: { value: solver.s }, uSimN: { value: new THREE.Vector2(solver.nx, solver.ny) }, uN30: { value: new THREE.Vector2(D.nx30, D.ny30) }, uStep: { value: step },
    uAccN: { value: new THREE.Vector2(1, 1) }, uAccS: { value: 1 }, uProbCh: { value: 0 }, uAccCount: { value: 0 },
    uGrid: { value: new THREE.Vector4(GR.X0, GR.Y1, GR.cell, D.cell30) }, uSatB: { value: new THREE.Vector4(GR.bx0, GR.bx1, GR.by0, GR.by1) },
    uBase: { value: 0 }, uOverlay: { value: 0 }, uZone: { value: 1 }, uSimT: { value: 0 }, uShadows: { value: 1 }, uContours: { value: 0 }, uSnowVis: { value: 1 },
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
  const FU = { ...shared, tTerr: { value: null }, tFluid: { value: null }, tFluidP: { value: null }, tFluxA: { value: null }, tFluxB: { value: null }, tBase: { value: solver.baseTex }, uSimN: U.uSimN, uDxM: { value: solver.dx }, uLavaGain: { value: 1 }, uArrows: { value: 1 }, uFlowVis: { value: 6 } };
  const fmat = new THREE.ShaderMaterial({ vertexShader: FLUID_VS, fragmentShader: FLUID_FS, uniforms: FU, transparent: true, depthWrite: true });
  const fluid = new THREE.Mesh(fg, fmat); fluid.frustumCulled = false; fluid.renderOrder = 2;
  return {
    mesh, fluid, U, FU, shared, h30,
    // recalcula el mapa de sombras si el sol se movió más de ~0,3° o cambió la exageración
    updateShadows(renderer, force) {
      const sd = shared.uSunDir.value, ex = shared.uEx.value;
      if (!force && sd.angleTo(lastSun) < 0.005 && ex === lastEx) return false;
      lastSun.copy(sd); lastEx = ex; shMat.uniforms.uSunDir.value.copy(sd); shMat.uniforms.uEx.value = ex;
      const prev = renderer.getRenderTarget(); renderer.setRenderTarget(shRT); renderer.render(shScene, shCam); renderer.setRenderTarget(prev);
      return true;
    },
    bind(sol) { const t = sol.U; U.tTerr.value = t[2]; U.tStat.value = t[3]; U.tFluidP.value = t[1]; U.tAsh.value = sol.ashTex; U.tFire.value = sol.fireTex;
      FU.tTerr.value = t[2]; FU.tFluid.value = t[0]; FU.tFluidP.value = t[1]; FU.tFluxA.value = sol.FX[0]; FU.tFluxB.value = sol.FX[1]; FU.tBase.value = sol.baseTex; },
    setAcc(tex, n, s, count) { U.tAcc.value = tex; U.uAccN.value.set(n[0], n[1]); U.uAccS.value = s; U.uAccCount.value = count; },
  };
}
