// =====================================================================
//  MOTOR FÍSICO EN GPU (WebGL2, texturas float32, render a textura)
//
//  Tres fluidos sobre el DEM real, resueltos con el esquema inercial local
//  de Bates et al. (2010) y la difusión θ de de Almeida et al. (2012):
//
//   ∂q/∂t = −g·h·∂η/∂x − τ_b/ρ                (q = u·h, η = z + h)
//
//  · Lahar (flujo de barro): reología cuadrática de O'Brien & Julien (1988)
//      τ_b/ρ = 1.5·τy(Cv)/ρm + 3·η(Cv)·q/(ρm·h²) + g·n²·q|q|/h^(7/3)
//    con erosión/depositación hacia la concentración de equilibrio de
//    Takahashi (1978):  C∞ = ρw·tanθ / ((ρs−ρw)(tanφ−tanθ)).
//  · Lava: Bingham con viscosidad VFT dependiente de T y de cristales
//    (Giordano et al. 2008; Einstein-Roscoe), fluencia de Dragoni (1989);
//    enfriamiento por radiación (Stefan-Boltzmann) + convección +
//    conducción, calor latente de cristalización; solidifica bajo el solidus.
//  · Corriente de densidad piroclástica densa: fricción de Voellmy-Salm.
//
//  Acoplamientos: fusión de nieve/hielo por contacto con lava, CDP y
//  salpicaduras (balance de energía) → agua de lahar; la lava se enfría
//  al derretir; el hielo derretido rebaja la superficie (canales en el
//  glaciar); incendios forestales por autómata con viento y pendiente.
// =====================================================================
import * as THREE from 'three';
import { PHYS } from './config.js';

const VS = /* glsl */`in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const HDR = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform ivec2 uN; uniform float uDx, uDt, uT;
ivec2 P(){ return ivec2(gl_FragCoord.xy); }
vec4 F(sampler2D t, ivec2 p){ return texelFetch(t, clamp(p, ivec2(0), uN - 1), 0); }
bool inside(ivec2 p){ return p.x >= 0 && p.y >= 0 && p.x < uN.x && p.y < uN.y; }
const float G = 9.81;
const float CSTAR = 0.62;
// --- reología del lahar (O'Brien & Julien 1988, coeficientes calibrados para depósitos volcánicos)
float tauMud(float cv){ return 0.06 * exp(17.5 * cv); }        // Pa
float etaMud(float cv){ return 0.0012 * exp(19.0 * cv); }      // Pa·s
float rhoMud(float cv){ return 1000.0 + 1650.0 * cv; }         // kg/m³
float manMud(float cv){ return 0.032 + 0.05 * cv; }            // Manning
// --- reología de la lava (andesita basáltica del Llaima, rica en cristales)
float phiCr(float T){ return clamp(0.22 + 0.36 * (1450.0 - T) / 225.0, 0.22, 0.585); }
float etaLava(float T){ float Tc = clamp(T, 1150.0, 1500.0); float m = -4.55 + 6500.0 / (Tc - 632.0);
  return min(pow(10.0, m) * pow(1.0 - phiCr(T) / 0.6, -2.5), 1e10); }
float tauLava(float T){ return min(pow(10.0, 13.0997 - 0.0089 * T), 2e5); }
float hash(ivec2 p, int s){ uint h = uint(p.x) * 1973u + uint(p.y) * 9277u + uint(s) * 26699u + 7u;
  h = (h ^ (h >> 13)) * 1274126177u; h ^= h >> 16; return float(h & 0xFFFFFFu) / 16777216.0; }
`;

// ----------------------------- flujos en las caras ----------------------
const FLUX = HDR + /* glsl */`
uniform sampler2D tTerr, tFluid, tFluidP, tFluxA, tFluxB;
uniform float uPdcMu, uPdcXi;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
float face(float qOld, float qAvg, float za, float ha, float zb, float hb, float tauRho, float kLin, float kQuad){
  float ea = za + ha, eb = zb + hb;
  float hf = max(ea, eb) - max(za, zb);
  if (hf <= 0.002) return 0.0;
  float q = 0.8 * qOld + 0.2 * qAvg;
  float qs = q - uDt * G * hf * (eb - ea) / uDx;
  qs = sign(qs) * max(abs(qs) - uDt * tauRho, 0.0);
  qs /= 1.0 + uDt * (kLin + kQuad * abs(q));
  float hup = qs > 0.0 ? ha : hb;
  float cap = hup * uDx / (4.0 * uDt);
  return clamp(qs, -cap, cap);
}
void main(){
  ivec2 p = P();
  vec4 tr = F(tTerr, p), fl = F(tFluid, p), fp = F(tFluidP, p);
  vec4 qa = F(tFluxA, p), qb = F(tFluxB, p);
  vec4 A = vec4(0.0), B = vec4(0.0);
  for (int d = 0; d < 2; d++) {
    ivec2 o = d == 0 ? ivec2(1, 0) : ivec2(0, 1);
    ivec2 pn = p + o;
    if (!inside(pn)) continue;
    vec4 tn = F(tTerr, pn), fn = F(tFluid, pn), fpn = F(tFluidP, pn);
    vec4 qam = F(tFluxA, p - o), qap = F(tFluxA, pn), qbm = F(tFluxB, p - o), qbp = F(tFluxB, pn);
    // ---- lahar (el lecho efectivo incluye la lava presente)
    float za = tr.x + fl.z, zb = tn.x + fn.z;
    float hs = fl.x + fn.x;
    float cv = hs > 1e-4 ? (fl.x * fl.y + fn.x * fn.y) / hs : 0.0;
    float hf = max(max(za + fl.x, zb + fn.x) - max(za, zb), 0.01);
    float rho = rhoMud(cv), n = manMud(cv);
    float qO = d == 0 ? qa.x : qa.y, qV = 0.5 * ((d == 0 ? qam.x : qam.y) + (d == 0 ? qap.x : qap.y));
    float qm = face(qO, qV, za, fl.x, zb, fn.x, 1.5 * tauMud(cv) / rho, 3.0 * etaMud(cv) / (rho * hf * hf), G * n * n / pow(hf, 2.3333));
    // ---- lava
    float hl = fl.z + fn.z;
    float T = hl > 1e-4 ? (fl.z * fl.w + fn.z * fn.w) / hl : 1000.0;
    float hfl = max(max(tr.x + fl.z, tn.x + fn.z) - max(tr.x, tn.x), 0.02);
    float lO = d == 0 ? qa.z : qa.w, lV = 0.5 * ((d == 0 ? qam.z : qam.w) + (d == 0 ? qap.z : qap.w));
    // canal bajo la celda: la lava corre por un canal de ~40 m (no en una lámina del ancho de la celda);
    // con espesor H = h·Kc el caudal de Jeffreys por ancho de celda crece Kc² y la fluencia baja 1/Kc
    float Kc = max(1.0, uDx / 40.0);
    float ql = face(lO, lV, tr.x, fl.z, tn.x, fn.z, 1.5 * tauLava(T) / (2550.0 * Kc), 3.0 * etaLava(T) / (2550.0 * hfl * hfl * Kc * Kc), 0.0);
    // ---- corriente piroclástica (Voellmy): μ·g·h + g·u²/ξ
    float zpa = za + fl.x, zpb = zb + fn.x;
    float hfp = max(max(zpa + fp.x, zpb + fpn.x) - max(zpa, zpb), 0.01);
    float pO = d == 0 ? qb.x : qb.y, pV = 0.5 * ((d == 0 ? qbm.x : qbm.y) + (d == 0 ? qbp.x : qbp.y));
    float qp = face(pO, pV, zpa, fp.x, zpb, fpn.x, uPdcMu * G * hfp, 0.0, G / (uPdcXi * hfp * hfp));
    if (d == 0) { A.x = qm; A.z = ql; B.x = qp; } else { A.y = qm; A.w = ql; B.y = qp; }
  }
  oA = A; oB = B;
}`;

// ----------------------------- actualización de estado ------------------
const UPDATE = HDR + /* glsl */`
uniform sampler2D tTerr, tFluid, tFluidP, tFluxA, tFluxB, tStatic, tStat, tAsh, tBase;
uniform vec4 uVent[8]; uniform int uNV; uniform float uT0;
uniform vec4 uPdc; uniform float uPdcT;
uniform vec4 uWater[4]; uniform int uNW;
uniform vec4 uSpat;
uniform float uRain;
uniform float uErode; uniform float uSpin;
layout(location = 0) out vec4 oF;
layout(location = 1) out vec4 oP;
layout(location = 2) out vec4 oT;
layout(location = 3) out vec4 oS;
float diskRate(vec4 v, ivec2 p){ vec2 d = vec2(p) - v.xy; return dot(d, d) <= v.z * v.z ? v.w : 0.0; }
void main(){
  ivec2 p = P();
  vec4 tr = F(tTerr, p), fl = F(tFluid, p), fp = F(tFluidP, p), st = F(tStatic, p), sa = F(tStat, p), bs = F(tBase, p);
  ivec2 eW = ivec2(1, 0), eN = ivec2(0, 1);
  vec4 qa = F(tFluxA, p), qaW = p.x > 0 ? F(tFluxA, p - eW) : vec4(0.0), qaN = p.y > 0 ? F(tFluxA, p - eN) : vec4(0.0);
  vec4 qb = F(tFluxB, p), qbW = p.x > 0 ? F(tFluxB, p - eW) : vec4(0.0), qbN = p.y > 0 ? F(tFluxB, p - eN) : vec4(0.0);
  vec4 fE = F(tFluid, p + eW), fW = F(tFluid, p - eW), fS = F(tFluid, p + eN), fNo = F(tFluid, p - eN);
  vec4 pE = F(tFluidP, p + eW), pW = F(tFluidP, p - eW), pS = F(tFluidP, p + eN), pNo = F(tFluidP, p - eN);
  float k = uDt / uDx;
  // ---------- divergencias con advección aguas arriba
  float iW = qaW.x, iE = -qa.x, iN = qaN.y, iS = -qa.y;
  float dh = iW + iE + iN + iS;
  float dsd = iW * (iW > 0.0 ? fW.y : fl.y) + iE * (iE > 0.0 ? fE.y : fl.y) + iN * (iN > 0.0 ? fNo.y : fl.y) + iS * (iS > 0.0 ? fS.y : fl.y);
  float lW = qaW.z, lE = -qa.z, lN = qaN.w, lS = -qa.w;
  float dl = lW + lE + lN + lS;
  float dlT = lW * (lW > 0.0 ? fW.w : fl.w) + lE * (lE > 0.0 ? fE.w : fl.w) + lN * (lN > 0.0 ? fNo.w : fl.w) + lS * (lS > 0.0 ? fS.w : fl.w);
  float cW = qbW.x, cE = -qb.x, cN = qbN.y, cS = -qb.y;
  float dp = cW + cE + cN + cS;
  float dpT = cW * (cW > 0.0 ? pW.y : fp.y) + cE * (cE > 0.0 ? pE.y : fp.y) + cN * (cN > 0.0 ? pNo.y : fp.y) + cS * (cS > 0.0 ? pS.y : fp.y);
  // ---------- velocidades en la celda
  float um = length(vec2(0.5 * (qaW.x + qa.x), 0.5 * (qaN.y + qa.y))) / max(fl.x, 0.05);
  float ul = length(vec2(0.5 * (qaW.z + qa.z), 0.5 * (qaN.w + qa.w))) / max(fl.z, 0.05);
  float up = length(vec2(0.5 * (qbW.x + qb.x), 0.5 * (qbN.y + qb.y))) / max(fp.x, 0.05);
  // ---------- pendiente del lecho
  float bx = (F(tTerr, p + eW).x - F(tTerr, p - eW).x) / (2.0 * uDx);
  float by = (F(tTerr, p + eN).x - F(tTerr, p - eN).x) / (2.0 * uDx);
  float tanb = length(vec2(bx, by));
  // ---------- fusión de nieve y hielo (balance de energía)
  float swe = tr.y, mL = 0.0, mP = 0.0, mS = 0.0;
  if (swe > 0.0) {
    if (fl.z > 0.02 && fl.w > 900.0) mL = 60.0 * (fl.w - 273.0) * (1.0 + 0.6 * min(ul, 3.0)) / (1000.0 * 3.34e5) / max(1.0, uDx / 40.0);   // capa de vapor (Leidenfrost) limita el flujo de calor; sólo el canal toca el hielo
    if (fp.x > 0.02 && fp.y > 373.0) mP = fp.x * 1100.0 * 1100.0 * (fp.y - 273.0) * 0.5 / (1000.0 * 3.34e5 * 300.0);
    vec2 dd = vec2(p) - uSpat.xy; mS = uSpat.w * exp(-dot(dd, dd) / (2.0 * uSpat.z * uSpat.z + 1e-6));
  }
  float mT = mL + mP + mS;
  float melt = min(swe / uDt, mT);
  float fLm = mT > 0.0 ? melt * mL / mT : 0.0;
  float fPm = mT > 0.0 ? melt * mP / mT : 0.0;
  // ---------- fuentes de agua: lluvia (escorrentía mayor sobre ceniza) y caudales directos
  float ash = F(tAsh, p).x;
  float runoff = uRain * (0.12 + 0.78 * smoothstep(1.0, 25.0, ash)) * (st.x > 1400.0 || ash > 1.0 ? 1.0 : 0.0);
  float wsrc = 0.0; for (int i = 0; i < 4; i++) { if (i >= uNW) break; wsrc += diskRate(uWater[i], p); }
  // ---------- lahar: erosión y depositación (Takahashi)
  float hm = fl.x, cv = fl.y;
  float cvEq = tanb >= 0.62 ? 0.6 : clamp(1000.0 * tanb / (1650.0 * (0.70 - tanb)), 0.0, 0.6);
  float erode = 0.0, dep = 0.0;
  float scour = st.x - tr.x;
  // el lecho de los ríos está acorazado: sólo una crecida (exceso sobre el caudal base) moviliza sedimento
  float exc0 = hm - bs.r;
  if (uSpin < 0.5 && exc0 > 0.15 && hm > 0.05 && um > 0.5 && cv < cvEq && scour < 10.0 && swe < 1.0) erode = uErode * min(0.02, 0.0016 * um * (cvEq - cv));
  if (uSpin > 0.5) cvEq = 1.0;
  if (hm > 0.02 && cv > cvEq) dep = 0.03 * (cv - cvEq) * hm / CSTAR;
  if (hm > 0.02 && um < 0.25) dep += 0.03 * cv * hm * (1.0 - um / 0.25) / CSTAR;
  dep = min(dep, 0.5 * cv * hm / (CSTAR * uDt));
  // infiltración en suelo volcánico permeable (no sobre hielo/nieve ni bajo lava)
  float infil = (swe > 0.05 || fl.z > 0.02 || bs.b > 0.5 || uSpin > 0.5) ? 0.0 : 2.5e-6 * (1.0 - cv);
  infil = min(infil, max(hm, 0.0) * (1.0 - cv) / uDt);
  float hm1 = hm + k * dh + uDt * (melt + runoff + wsrc + bs.g + erode - dep - infil);
  float sm1 = hm * cv + k * dsd + uDt * CSTAR * (erode - dep);
  float bedAdd = uDt * (dep - erode) - uDt * melt * 1.1;
  if (hm1 < 2e-4 && bs.b < 0.5 && bs.g <= 0.0) { bedAdd += max(sm1, 0.0) / CSTAR; hm1 = 0.0; sm1 = 0.0; }
  float cv1 = hm1 > 1e-4 ? sm1 / hm1 : 0.0;
  if (cv1 > 0.6) { float ex = (cv1 - 0.6) * hm1; bedAdd += ex / CSTAR; hm1 -= ex / CSTAR; cv1 = 0.6; }
  cv1 = clamp(cv1, 0.0, 0.6);
  // ---------- lava
  float E = 0.0; for (int i = 0; i < 8; i++) { if (i >= uNV) break; E += diskRate(uVent[i], p); }
  float hl1 = fl.z + k * dl + uDt * E;
  float Th = fl.z * fl.w + k * dlT + uDt * E * uT0;
  float T1 = hl1 > 1e-4 ? Th / hl1 : 0.0;
  if (hl1 > 1e-4) {
    float fc = 0.28 + 0.5 * clamp(ul / 1.5, 0.0, 1.0);             // costra: superficie más fría si está estancada
    float Ts = 278.0 + (T1 - 278.0) * fc;
    float Q = 0.95 * 5.67e-8 * (pow(Ts, 4.0) - pow(278.0, 4.0)) + 25.0 * (Ts - 278.0) + 2.0 * (T1 - 278.0);
    float ceff = 1150.0 + 3.5e5 / 225.0;
    float hh = max(hl1 * max(1.0, uDx / 40.0), 0.05);   // espesor real en el canal
    T1 -= uDt * Q / (2550.0 * ceff * hh);
    T1 -= uDt * fLm * 1000.0 * 3.34e5 / (2550.0 * ceff * hh);
  }
  if (hl1 > 0.0 && (T1 < 1225.0 || (hl1 * max(1.0, uDx / 40.0) < 0.1 && T1 < 1320.0))) { bedAdd += hl1; hl1 = 0.0; T1 = 0.0; }
  // ---------- corriente piroclástica
  float psrc = diskRate(uPdc, p);
  float hp1 = fp.x + k * dp + uDt * psrc;
  float Tp = hp1 > 1e-4 ? (fp.x * fp.y + k * dpT + uDt * psrc * uPdcT) / hp1 : 0.0;
  if (hp1 > 1e-4) {
    Tp -= uDt * (Tp - 300.0) / 1500.0;
    Tp -= uDt * fPm * 1000.0 * 3.34e5 / (1100.0 * 1100.0 * max(hp1, 0.05));
  }
  // sedimentación de la corriente densa: lenta mientras corre, rápida al frenarse
  float pdep = fp.x * (0.0007 + 0.006 * (1.0 - min(up / 3.0, 1.0)));
  pdep = min(pdep, 0.5 * fp.x / uDt);
  hp1 -= uDt * pdep; bedAdd += uDt * pdep * 0.7;
  if (hp1 < 2e-4) { bedAdd += max(hp1, 0.0) * 0.7; hp1 = 0.0; Tp = 0.0; }
  // ---------- bordes: salida libre del dominio
  if (p.x <= 1 || p.y <= 1 || p.x >= uN.x - 2 || p.y >= uN.y - 2) { hm1 = 0.0; sm1 = 0.0; cv1 = 0.0; hl1 = 0.0; hp1 = 0.0; }
  // ---------- salidas
  oF = vec4(max(hm1, 0.0), cv1, max(hl1, 0.0), T1);
  float arrP = fp.z; if (arrP == 0.0 && hp1 > 0.1) arrP = uT + 1.0;
  oP = vec4(max(hp1, 0.0), Tp, arrP, max(fp.w, hp1));
  // lahar = exceso de nivel sobre el caudal base del río (o cualquier flujo fuera del cauce)
  float exc = hm1 - bs.r * 1.08 - 0.03;
  float dyn = exc > 0.1 ? rhoMud(cv1) * hm1 * um * um / 1000.0 : 0.0;
  oT = vec4(tr.x + bedAdd, max(0.0, swe - uDt * melt), max(tr.z, exc > 0.1 ? um : 0.0), max(tr.w, dyn));
  float aM = sa.y; if (aM == 0.0 && exc > 0.12 && uSpin < 0.5) aM = uT + 1.0;
  float aL = sa.w; if (aL == 0.0 && hl1 > 0.1) aL = uT + 1.0;
  oS = vec4(uSpin > 0.5 ? 0.0 : max(sa.x, max(exc, 0.0)), aM, max(sa.z, hl1), aL);
}`;

// ----------------------------- incendios --------------------------------
const FIRE = HDR + /* glsl */`
uniform sampler2D tFire, tFluid, tFluidP, tTerr, tStatic;
uniform vec2 uWindDir; uniform float uDry, uSpread, uRain; uniform int uStep;
out vec4 o;
void main(){
  ivec2 p = P();
  vec4 fr = F(tFire, p), fl = F(tFluid, p), fp = F(tFluidP, p), tr = F(tTerr, p);
  float fuel = fr.x, b = fr.y, sc = fr.z, ti = fr.w;
  bool hot = (fl.z > 0.05 && fl.w > 900.0) || (fp.x > 0.05 && fp.y > 480.0);
  if (tr.y > 0.08) { o = vec4(fuel, 0.0, sc, ti); return; }
  if (hot && fuel > 0.02) { if (b < 0.5) ti = uT + 1.0; b = 1.0; if (fp.x > 0.05) { sc = 1.0; fuel *= 0.25; } if (fl.z > 0.05) { sc = 1.0; fuel = 0.0; } }
  else if (b < 0.5 && fuel > 0.08 && uRain < 2e-6) {
    float pr = 0.0;
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      ivec2 q = p + ivec2(dx, dy);
      vec4 fn = F(tFire, q);
      if (fn.y > 0.5) {
        vec2 dir = normalize(vec2(-dx, -dy));
        float w = exp(1.6 * dot(dir, uWindDir));
        float dz = (tr.x - F(tTerr, q).x) / (uDx * length(vec2(dx, dy)));
        w *= exp(clamp(dz * 3.0, -1.2, 2.0));
        pr += w * ((dx != 0 && dy != 0) ? 0.7 : 1.0);
      }
    }
    pr *= uDt * uSpread * fuel * uDry;
    if (pr > 0.0 && hash(p, uStep) < pr) { b = 1.0; ti = uT + 1.0; }
  }
  if (b > 0.5) {
    fuel = max(0.0, fuel - uDt / 1500.0);
    sc = max(sc, 1.0 - fuel / max(F(tStatic, p).z, 0.01));
    if (fuel < 0.03 || fl.x > 0.25 || uRain > 3e-6) b = 0.0;
  }
  o = vec4(fuel, b, sc, ti);
}`;

// ----------------------------- caída de tefra ---------------------------
const ASH = HDR + /* glsl */`
uniform sampler2D tAsh; uniform vec4 uK[64]; uniform float uKc[64]; uniform int uNK;
out vec4 o;
void main(){
  ivec2 p = P(); vec4 a = F(tAsh, p); float add = 0.0, addC = 0.0;
  for (int k = 0; k < 64; k++) { if (k >= uNK) break; vec4 K = uK[k]; vec2 d = vec2(p) - K.xy;
    float e = K.w * exp(-dot(d, d) / (2.0 * K.z * K.z)); add += e; addC += e * uKc[k]; }
  a.x += add; a.z += addC;
  if (a.y == 0.0 && a.x > 1.0) a.y = uT + 1.0;
  o = a;
}`;

// ----------------------------- resumen por bloques 8×8 ------------------
const SUMMARY = HDR + /* glsl */`
uniform sampler2D tTerr, tFluid, tFluidP, tFluxA, tFluxB, tStatic, tStat, tFire, tBase;
uniform int uBW;
out vec4 o;
void main(){
  ivec2 q = P(); int tile = q.x / uBW; ivec2 b = ivec2(q.x - tile * uBW, q.y) * 8;
  vec4 r = vec4(0.0);
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
    ivec2 p = b + ivec2(i, j); if (!inside(p)) continue;
    vec4 fl = F(tFluid, p), fp = F(tFluidP, p);
    float ex = max(0.0, fl.x - F(tBase, p).r * 1.08 - 0.03);
    if (tile == 0) r += vec4(ex, fl.x * fl.y, fl.z, fp.x);
    else if (tile == 1) { vec4 tr = F(tTerr, p); r.x = max(r.x, fl.x); if (fl.z > 0.05) r.y = max(r.y, fl.w); r.z = max(r.z, fp.x); r.w += (fl.z > 0.05 && tr.y > 0.05) ? 1.0 : 0.0; }
    else if (tile == 2) {
      vec4 qa = F(tFluxA, p), qaW = F(tFluxA, p - ivec2(1, 0)), qaN = F(tFluxA, p - ivec2(0, 1));
      vec4 qb = F(tFluxB, p), qbW = F(tFluxB, p - ivec2(1, 0)), qbN = F(tFluxB, p - ivec2(0, 1));
      vec2 vm = vec2(0.5 * (qaW.x + qa.x), 0.5 * (qaN.y + qa.y));
      vec2 vp = vec2(0.5 * (qbW.x + qb.x), 0.5 * (qbN.y + qb.y));
      r.xyz += vec3(F(tFire, p).y, vp.x, vp.y); r.w = max(r.w, ex);
    } else {
      vec4 tr = F(tTerr, p), s0 = F(tStatic, p), sa = F(tStat, p);
      float d = tr.x - s0.x;
      r.x += max(0.0, s0.y - tr.y);
      if (sa.z >= 0.3) r.z += max(0.0, d); else r.y += max(0.0, d);
      if (ex > 0.1) { vec4 qa = F(tFluxA, p), qaW = F(tFluxA, p - ivec2(1, 0)), qaN = F(tFluxA, p - ivec2(0, 1));
        r.w = max(r.w, length(vec2(0.5 * (qaW.x + qa.x), 0.5 * (qaN.y + qa.y))) / fl.x); }
    }
  }
  o = r;
}`;

// ----------------------------- muestreo de puntos -----------------------
const SAMPLE = HDR + /* glsl */`
uniform sampler2D tPts, t0, t1, t2, t3, t4, t5, t6;
out vec4 o;
void main(){
  ivec2 q = P(); ivec2 c = ivec2(texelFetch(tPts, ivec2(q.x, 0), 0).xy);
  if (q.y == 0) o = F(t0, c); else if (q.y == 1) o = F(t1, c); else if (q.y == 2) o = F(t2, c);
  else if (q.y == 3) o = F(t3, c); else if (q.y == 4) o = F(t4, c); else if (q.y == 5) o = F(t5, c); else o = F(t6, c);
}`;

// ----------------------------- acumulación del ensamble -----------------
const ACCUM = HDR + /* glsl */`
uniform sampler2D tAcc, tStat, tFluidP, tAsh, tTerr, tStatic;
out vec4 o;
void main(){
  ivec2 p = P(); vec4 a = F(tAcc, p), s = F(tStat, p), fp = F(tFluidP, p), ash = F(tAsh, p);
  o = a + vec4(s.x > 0.5 ? 1.0 : 0.0, s.z > 0.3 ? 1.0 : 0.0, fp.w > 0.3 ? 1.0 : 0.0, ash.x > 10.0 ? 1.0 : 0.0);
}`;

const INIT = HDR + /* glsl */`
uniform sampler2D tStatic, tSnapF, tBaseSrc; uniform int uMode;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
void main(){
  vec4 s = F(tStatic, P());
  // uMode 0: ríos con profundidad normal de Manning; 1: estado estacionario guardado
  o0 = uMode == 1 ? vec4(F(tSnapF, P()).x, 0.0, 0.0, 0.0) : vec4(F(tBaseSrc, P()).r, 0.0, 0.0, 0.0);
  o1 = vec4(0.0); o2 = vec4(s.x, s.y, 0.0, 0.0); o3 = vec4(0.0);
}`;
const COPY = HDR + /* glsl */`uniform sampler2D tSrc; out vec4 o; void main(){ o = F(tSrc, P()); }`;
const MKBASE = HDR + /* glsl */`uniform sampler2D tFl, tBaseSrc; out vec4 o; void main(){ vec4 b = F(tBaseSrc, P()); o = vec4(F(tFl, P()).x, b.g, b.b, b.a); }`;
const RESTF = HDR + /* glsl */`uniform sampler2D tSnapQ; uniform int uMode; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main(){ o0 = uMode == 1 ? F(tSnapQ, P()) : vec4(0.0); o1 = vec4(0.0); }`;
const INITFIRE = HDR + /* glsl */`uniform sampler2D tStatic; out vec4 o; void main(){ vec4 s = F(tStatic, P()); o = vec4(s.z, 0.0, 0.0, 0.0); }`;
const CLEAR = HDR + /* glsl */`layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; void main(){ o0 = vec4(0.0); o1 = vec4(0.0); }`;
const CLEAR1 = HDR + /* glsl */`out vec4 o; void main(){ o = vec4(0.0); }`;

// ----------------------------- historial por celda ---------------------
// H1 = (t del máximo del lahar, último t con lahar, vx, vy en el máximo)
// H2 = (último t con lava, último t con CDP, vx, vy de lava o CDP)
const HIST = HDR + /* glsl */`
uniform sampler2D tFluid, tFluidP, tFluxA, tFluxB, tStat, tBase, tH1, tH2;
layout(location = 0) out vec4 o1; layout(location = 1) out vec4 o2;
void main(){
  ivec2 p = P(); vec4 fl = F(tFluid, p), fp = F(tFluidP, p), st = F(tStat, p), b = F(tBase, p), h1 = F(tH1, p), h2 = F(tH2, p);
  vec4 qa = F(tFluxA, p), qaW = p.x > 0 ? F(tFluxA, p - ivec2(1, 0)) : vec4(0.0), qaN = p.y > 0 ? F(tFluxA, p - ivec2(0, 1)) : vec4(0.0);
  vec4 qb = F(tFluxB, p), qbW = p.x > 0 ? F(tFluxB, p - ivec2(1, 0)) : vec4(0.0), qbN = p.y > 0 ? F(tFluxB, p - ivec2(0, 1)) : vec4(0.0);
  float ex = fl.x - b.r * 1.08 - 0.03;
  if (ex > 0.1) { h1.y = uT; if (ex >= st.x - 1e-3) { h1.x = uT; h1.zw = vec2(0.5 * (qaW.x + qa.x), 0.5 * (qaN.y + qa.y)) / max(fl.x, 0.05); } }
  if (fl.z > 0.05) { h2.x = uT; h2.zw = vec2(0.5 * (qaW.z + qa.z), 0.5 * (qaN.w + qa.w)) / max(fl.z, 0.05); }
  if (fp.x > 0.05) { h2.y = uT; if (fl.z <= 0.05) h2.zw = vec2(0.5 * (qbW.x + qb.x), 0.5 * (qbN.y + qb.y)) / max(fp.x, 0.05); }
  o1 = h1; o2 = h2;
}`;

// ----------------------------- reconstrucción para la reproducción --------
// A partir de llegada, máximo, tiempo del máximo, fin y dirección de cada celda se
// rearma el estado en cualquier instante t, sin volver a simular.
const RECON1 = HDR + /* glsl */`
uniform sampler2D tStatF, tFluidPF, tTerrF, tH1, tH2, tBase, tStatic;
uniform float uPT, uTnow;
layout(location = 0) out vec4 oF; layout(location = 1) out vec4 oP; layout(location = 2) out vec4 oT; layout(location = 3) out vec4 oS;
void main(){
  ivec2 p = P(); float t = uPT;
  vec4 st = F(tStatF, p), fpF = F(tFluidPF, p), trF = F(tTerrF, p), h1 = F(tH1, p), h2 = F(tH2, p), b = F(tBase, p), s0 = F(tStatic, p);
  // lahar: subida rápida al máximo, meseta que decae y recesión
  float ex = 0.0, rise = 0.0, aM = st.y - 1.0; bool inM = st.y > 0.0 && t >= aM;
  if (inM) { float tp = max(h1.x, aM + 30.0), te = max(h1.y, tp + 60.0);
    rise = smoothstep(aM, tp, t);
    float mid = mix(1.0, 0.5, smoothstep(tp, te, t));
    float rec = 1.0 - smoothstep(te, te + max(300.0, (te - aM) * 0.4), t);
    ex = st.x * rise * mid * rec; }
  float hm = b.r + max(ex, 0.0);
  float cv = ex > 0.05 ? clamp(0.5 * ex / (ex + b.r + 0.2), 0.1, 0.5) : 0.0;
  // lava: avanza, se mantiene caliente mientras se mueve y luego se solidifica (pasa al relieve)
  float hl = 0.0, T = 0.0, aL = st.w - 1.0; bool inL = st.w > 0.0 && t >= aL;
  if (inL) { float te = max(h2.x, aL + 300.0);
    if (t <= te + 60.0) { hl = st.z * smoothstep(aL, aL + max(240.0, (te - aL) * 0.2), t); T = mix(1418.0, 1240.0, clamp((t - aL) / max(te - aL, 1.0), 0.0, 1.0)); } }
  // corriente piroclástica: pulso breve
  float hp = 0.0, aP = fpF.z - 1.0; bool inP = fpF.z > 0.0 && t >= aP;
  if (inP) { float te = max(h2.y, aP + 60.0); hp = fpF.w * smoothstep(aP, aP + 20.0, t) * (1.0 - smoothstep(te, te + 180.0, t)); }
  oF = vec4(hm, cv, hl, T);
  oP = vec4(hp, hp > 0.0 ? 650.0 : 0.0, inP ? fpF.z : 0.0, inP ? fpF.w * smoothstep(aP, aP + 20.0, t) : 0.0);
  // cambios del relieve (depósitos, fusión de nieve y hielo) proporcionales al avance
  float tA = 1e9; if (st.y > 0.0) tA = min(tA, aM); if (st.w > 0.0) tA = min(tA, aL); if (fpF.z > 0.0) tA = min(tA, aP);
  float tE = max(max(h1.y, h2.x), h2.y);
  float fT = clamp(t / max(uTnow, 1.0), 0.0, 1.0);
  float f = tA < 1e8 ? clamp((t - tA) / max(tE - tA, 900.0), 0.0, 1.0) : fT;
  oT = vec4(s0.x + (trF.x - s0.x) * f, mix(s0.y, trF.y, tA < 1e8 ? f : fT), inM ? trF.z : 0.0, inM ? trF.w * rise : 0.0);
  oS = vec4(inM ? st.x * rise : 0.0, inM ? st.y : 0.0, inL ? st.z : 0.0, inL ? st.w : 0.0);
}`;
const RECON2 = HDR + /* glsl */`
uniform sampler2D tFl, tFp, tH1, tH2;
layout(location = 0) out vec4 oA; layout(location = 1) out vec4 oB;
void main(){ ivec2 p = P(); vec4 fl = F(tFl, p), fp = F(tFp, p), h1 = F(tH1, p), h2 = F(tH2, p);
  float ex = fl.y > 0.0 ? fl.x : 0.0;
  oA = vec4(h1.z * ex, h1.w * ex, h2.z * fl.z, h2.w * fl.z); oB = vec4(h2.z * fp.x, h2.w * fp.x, 0.0, 0.0); }`;
const RECON3 = HDR + /* glsl */`
uniform sampler2D tAshF, tFireF; uniform float uPT, uAshEnd;
layout(location = 0) out vec4 oA; layout(location = 1) out vec4 oR;
void main(){ ivec2 p = P(); float t = uPT; vec4 a = F(tAshF, p), fi = F(tFireF, p);
  float aa = a.y - 1.0;
  float fa = a.y > 0.0 ? clamp((t - aa) / max(uAshEnd - aa, 600.0), 0.0, 1.0) : clamp(t / max(uAshEnd, 1.0), 0.0, 1.0);
  oA = vec4(a.x * fa, (a.y > 0.0 && t >= aa) ? a.y : 0.0, a.z * fa, 0.0);
  float tg = fi.w - 1.0; bool ig = fi.w > 0.0 && t >= tg;
  oR = vec4(fi.x, (ig && t < tg + 1800.0) ? 1.0 : 0.0, ig ? fi.z * clamp((t - tg) / 1200.0, 0.0, 1.0) : 0.0, ig ? fi.w : 0.0); }`;

// =====================================================================
export class Solver {
  constructor(renderer, D, { scale = 1 } = {}) {
    this.r = renderer; this.D = D; this.s = scale;
    const s = scale;
    this.nx = Math.floor(D.nx / s); this.ny = Math.floor(D.ny / s); this.n = this.nx * this.ny;
    this.dx = D.cellM * s;
    this.cellKm = D.GR.cell * s;
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g, null); this.quad.frustumCulled = false; this.scene.add(this.quad);
    const opt = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
    const W = this.nx, H = this.ny;
    this.mrtU = [new THREE.WebGLMultipleRenderTargets(W, H, 4, opt), new THREE.WebGLMultipleRenderTargets(W, H, 4, opt)];
    this.mrtF = [new THREE.WebGLMultipleRenderTargets(W, H, 2, opt), new THREE.WebGLMultipleRenderTargets(W, H, 2, opt)];
    for (const m of [...this.mrtU, ...this.mrtF]) for (const t of m.texture) { t.type = THREE.FloatType; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    this.fire = [new THREE.WebGLRenderTarget(W, H, opt), new THREE.WebGLRenderTarget(W, H, opt)];
    this.hist = [new THREE.WebGLMultipleRenderTargets(W, H, 2, opt), new THREE.WebGLMultipleRenderTargets(W, H, 2, opt)]; this.ch = 0;
    for (const m of this.hist) for (const t of m.texture) { t.type = THREE.FloatType; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    this.ash = [new THREE.WebGLRenderTarget(W, H, opt), new THREE.WebGLRenderTarget(W, H, opt)];
    this.bw = Math.ceil(W / 8); this.bh = Math.ceil(H / 8);
    this.sumRT = new THREE.WebGLRenderTarget(this.bw * 4, this.bh, opt);
    this.sumBuf = new Float32Array(this.bw * 4 * this.bh * 4);
    this.cu = 0; this.cf = 0; this.cfi = 0; this.ca = 0; this.stepN = 0;
    // texturas estáticas
    this.staticTex = new THREE.DataTexture(new Float32Array(this.n * 4), W, H, THREE.RGBAFormat, THREE.FloatType);
    this.staticTex.minFilter = this.staticTex.magFilter = THREE.NearestFilter;
    // caudal base de los ríos: fuente (nivel inicial, aporte lateral, cauce, área drenada) y estado estacionario
    this.baseSrc = new THREE.DataTexture(new Float32Array(this.n * 4), W, H, THREE.RGBAFormat, THREE.FloatType);
    this.baseSrc.minFilter = this.baseSrc.magFilter = THREE.NearestFilter; this.baseSrc.needsUpdate = true;
    this.baseRT = new THREE.WebGLRenderTarget(W, H, opt);
    this.snapF = new THREE.WebGLRenderTarget(W, H, opt); this.snapQ = new THREE.WebGLRenderTarget(W, H, opt);
    this.hasSnap = false; this.baseMonth = -1;
    // materiales
    const mk = (fs, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms: { uN: { value: new THREE.Vector2(W, H) }, uDx: { value: this.dx }, uDt: { value: 1 }, uT: { value: 0 }, ...uniforms }, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    const T = () => ({ value: null });
    this.mFlux = mk(FLUX, { tTerr: T(), tFluid: T(), tFluidP: T(), tFluxA: T(), tFluxB: T(), uPdcMu: { value: 0.12 }, uPdcXi: { value: 900 } });
    const v8 = []; for (let i = 0; i < 8; i++) v8.push(new THREE.Vector4());
    const v4 = []; for (let i = 0; i < 4; i++) v4.push(new THREE.Vector4());
    this.mUpd = mk(UPDATE, { tTerr: T(), tFluid: T(), tFluidP: T(), tFluxA: T(), tFluxB: T(), tStatic: { value: this.staticTex }, tStat: T(), tAsh: T(), tBase: { value: this.baseRT.texture }, uSpin: { value: 0 },
      uVent: { value: v8 }, uNV: { value: 0 }, uT0: { value: 1420 }, uPdc: { value: new THREE.Vector4() }, uPdcT: { value: 800 },
      uWater: { value: v4 }, uNW: { value: 0 }, uSpat: { value: new THREE.Vector4(0, 0, 1, 0) }, uRain: { value: 0 }, uErode: { value: 1 } });
    this.mFire = mk(FIRE, { tFire: T(), tFluid: T(), tFluidP: T(), tTerr: T(), tStatic: { value: this.staticTex }, uWindDir: { value: new THREE.Vector2(1, 0) }, uDry: { value: 0.5 }, uSpread: { value: 1 / 150 }, uRain: { value: 0 }, uStep: { value: 0 } });
    const k64 = []; for (let i = 0; i < 64; i++) k64.push(new THREE.Vector4());
    this.mAsh = mk(ASH, { tAsh: T(), uK: { value: k64 }, uKc: { value: new Float32Array(64) }, uNK: { value: 0 } });
    this.mSum = mk(SUMMARY, { tTerr: T(), tFluid: T(), tFluidP: T(), tFluxA: T(), tFluxB: T(), tStatic: { value: this.staticTex }, tStat: T(), tFire: T(), tBase: { value: this.baseRT.texture }, uBW: { value: this.bw } });
    this.mSample = mk(SAMPLE, { tPts: T(), t0: T(), t1: T(), t2: T(), t3: T(), t4: T(), t5: T(), t6: T() });
    this.mAccum = mk(ACCUM, { tAcc: T(), tStat: T(), tFluidP: T(), tAsh: T(), tTerr: T(), tStatic: { value: this.staticTex } });
    this.mInit = mk(INIT, { tStatic: { value: this.staticTex }, uMode: { value: 0 }, tSnapF: { value: this.snapF.texture }, tBaseSrc: { value: this.baseSrc } });
    this.mCopy = mk(COPY, { tSrc: T() });
    this.mMkBase = mk(MKBASE, { tFl: T(), tBaseSrc: { value: this.baseSrc } });
    this.mRestF = mk(RESTF, { tSnapQ: { value: this.snapQ.texture }, uMode: { value: 0 } });
    this.mInitFire = mk(INITFIRE, { tStatic: { value: this.staticTex } });
    this.mClear2 = mk(CLEAR, {}); this.mClear1 = mk(CLEAR1, {});
    this.mHist = mk(HIST, { tFluid: T(), tFluidP: T(), tFluxA: T(), tFluxB: T(), tStat: T(), tBase: { value: this.baseRT.texture }, tH1: T(), tH2: T() });
    this.mk = mk;
    this.samplers = new Map();
  }
  // Coordenadas mundo (km) ↔ celda del solver
  cell(x, y) { const G = this.D.GR, s = this.s; return [((x - G.X0) / G.cell - (s - 1) / 2) / s, ((G.Y1 - y) / G.cell - (s - 1) / 2) / s]; }
  world(i, j) { const G = this.D.GR, s = this.s; return [G.X0 + (i * s + (s - 1) / 2) * G.cell, G.Y1 - (j * s + (s - 1) / 2) * G.cell]; }

  setStatic(swe) {
    const D = this.D, s = this.s, a = this.staticTex.image.data; this.swe0 = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      let z = 0, w = 0, f = 0, ic = 0;
      for (let b = 0; b < s; b++) for (let c = 0; c < s; c++) { const k = (j * s + b) * D.nx + i * s + c; z += D.dem[k]; w += swe[k]; f += D.fuel[k]; ic += D.ice[k]; }
      const o = (j * this.nx + i) * 4, q = s * s; a[o] = z / q; a[o + 1] = w / q; a[o + 2] = f / q; a[o + 3] = ic / q;
      this.swe0 += w / q;
    }
    this.staticTex.needsUpdate = true;
  }
  pass(mat, target) { const ac = this.r.autoClear; this.r.autoClear = false; this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); this.r.autoClear = ac; }
  get U() { return this.mrtU[this.cu].texture; }    // [fluid, fluidP, terr, stat]
  get FX() { return this.mrtF[this.cf].texture; }   // [fluxA, fluxB]
  get H() { return this.hist[this.ch].texture; }     // [H1, H2]
  get fireTex() { return this.fire[this.cfi].texture; }
  get ashTex() { return this.ash[this.ca].texture; }
  get baseTex() { return this.baseRT.texture; }
  // Caudal base (arreglo RGBA a resolución del solver): nivel inicial, aporte lateral (m/s), cauce, área (km²)
  setBase(arr) {
    this.baseSrc.image.data.set(arr); this.baseSrc.needsUpdate = true; this.hasSnap = false;
    const m = this.mMkBase.uniforms; m.tFl.value = this.baseSrc; this.pass(this.mMkBase, this.baseRT);
  }
  // Integra sólo los ríos hasta el estado estacionario y lo guarda como condición inicial
  spinUp(seconds) {
    const prev = this.r.getRenderTarget();
    this.hasSnap = false; this.reset();
    this.setSources({});
    this.mUpd.uniforms.uSpin.value = 1;
    const dt = Math.min(4, 2.6 * this.s); let t = 0;
    while (t < seconds) { this.step(dt, t); t += dt; }
    this.mCopy.uniforms.tSrc.value = this.U[0]; this.pass(this.mCopy, this.snapF);
    this.mCopy.uniforms.tSrc.value = this.FX[0]; this.pass(this.mCopy, this.snapQ);
    this.mMkBase.uniforms.tFl.value = this.U[0]; this.pass(this.mMkBase, this.baseRT);
    this.mUpd.uniforms.uSpin.value = 0; this.hasSnap = true;
    this.r.setRenderTarget(prev);
  }
  reset() {
    const prev = this.r.getRenderTarget();
    this.mInit.uniforms.uMode.value = this.hasSnap ? 1 : 0; this.mRestF.uniforms.uMode.value = this.hasSnap ? 1 : 0;
    for (const m of this.mrtU) this.pass(this.mInit, m);
    for (const m of this.mrtF) this.pass(this.mRestF, m);
    for (const m of this.hist) this.pass(this.mClear2, m); this.ch = 0;
    for (const f of this.fire) this.pass(this.mInitFire, f);
    for (const a of this.ash) this.pass(this.mClear1, a);
    this.cu = this.cf = this.cfi = this.ca = 0; this.stepN = 0; this.t = 0;
    this.r.setRenderTarget(prev);
  }
  // Configura fuentes para los próximos pasos
  setSources(src) {
    const u = this.mUpd.uniforms, cA = (this.dx * this.dx);
    const disk = (x, y, rKm, Q) => {
      const [ci, cj] = this.cell(x, y); const rc = Math.max(1.05, rKm / this.cellKm);
      let n = 0; const R = Math.ceil(rc);
      for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = Math.round(ci) + a, jj = Math.round(cj) + b; if ((ii - ci) ** 2 + (jj - cj) ** 2 <= rc * rc) n++; }
      return [ci, cj, rc, n ? Q / (n * cA) : 0];
    };
    const vs = src.vents || []; u.uNV.value = Math.min(8, vs.length);
    vs.slice(0, 8).forEach((v, i) => u.uVent.value[i].set(...disk(v.x, v.y, v.r || 0.12, v.E)));
    u.uT0.value = src.T0 || 1420;
    if (src.pdc && src.pdc.Q > 0) u.uPdc.value.set(...disk(src.pdc.x, src.pdc.y, src.pdc.r, src.pdc.Q)); else u.uPdc.value.set(0, 0, 0, 0);
    u.uPdcT.value = src.pdcT || 820;
    const ws = src.water || []; u.uNW.value = Math.min(4, ws.length);
    ws.slice(0, 4).forEach((w, i) => u.uWater.value[i].set(...disk(w.x, w.y, w.r || 0.15, w.Q)));
    if (src.spat && src.spat.rate > 0) { const [ci, cj] = this.cell(src.spat.x, src.spat.y); u.uSpat.value.set(ci, cj, src.spat.r / this.cellKm, src.spat.rate); } else u.uSpat.value.set(0, 0, 1, 0);
    u.uRain.value = src.rain || 0;
    this.mFire.uniforms.uRain.value = src.rain || 0;
  }
  setFire(cfg) { const f = this.mFire.uniforms; f.uDry.value = cfg.dry; const a = cfg.windTo * Math.PI / 180; f.uWindDir.value.set(Math.sin(a), -Math.cos(a)); }
  step(dt, t) {
    const U = this.mrtU[this.cu].texture, FXo = this.mrtF[this.cf].texture;
    const fm = this.mFlux.uniforms;
    fm.uDt.value = dt; fm.tTerr.value = U[2]; fm.tFluid.value = U[0]; fm.tFluidP.value = U[1]; fm.tFluxA.value = FXo[0]; fm.tFluxB.value = FXo[1];
    this.pass(this.mFlux, this.mrtF[1 - this.cf]); this.cf = 1 - this.cf;
    const FXn = this.mrtF[this.cf].texture;
    const um = this.mUpd.uniforms;
    um.uDt.value = dt; um.uT.value = t; um.tTerr.value = U[2]; um.tFluid.value = U[0]; um.tFluidP.value = U[1]; um.tStat.value = U[3];
    um.tFluxA.value = FXn[0]; um.tFluxB.value = FXn[1]; um.tAsh.value = this.ashTex;
    this.pass(this.mUpd, this.mrtU[1 - this.cu]); this.cu = 1 - this.cu;
    this.stepN++;
    // historial por celda (llegada, máximo, fin y dirección) para la reproducción posterior
    { const U2 = this.mrtU[this.cu].texture, h = this.mHist.uniforms, Hc = this.hist[this.ch].texture;
      h.uT.value = t; h.tFluid.value = U2[0]; h.tFluidP.value = U2[1]; h.tStat.value = U2[3]; h.tFluxA.value = FXn[0]; h.tFluxB.value = FXn[1]; h.tH1.value = Hc[0]; h.tH2.value = Hc[1];
      this.pass(this.mHist, this.hist[1 - this.ch]); this.ch = 1 - this.ch; }
    if (this.stepN % 2 === 0) {
      const U2 = this.mrtU[this.cu].texture, f = this.mFire.uniforms;
      f.uDt.value = dt * 2; f.uT.value = t; f.tFire.value = this.fireTex; f.tFluid.value = U2[0]; f.tFluidP.value = U2[1]; f.tTerr.value = U2[2]; f.uStep.value = this.stepN;
      this.pass(this.mFire, this.fire[1 - this.cfi]); this.cfi = 1 - this.cfi;
    }
    this.t = t;
  }
  addAsh(kernels, t) {
    if (!kernels.length) return;
    const u = this.mAsh.uniforms; const cA = this.dx * this.dx;
    for (let s = 0; s < kernels.length; s += 64) {
      const ch = kernels.slice(s, s + 64);
      ch.forEach((k, i) => {
        const [ci, cj] = this.cell(k.x, k.y);
        const sg = Math.max(0.9, k.sigma / this.cellKm);
        const sgm = sg * this.dx;
        u.uK.value[i].set(ci, cj, sg, k.mass / (2 * Math.PI * sgm * sgm));
        u.uKc.value[i] = k.phi <= -1 ? 1 : 0;
      });
      u.uNK.value = ch.length; u.tAsh.value = this.ashTex; u.uT.value = t;
      this.pass(this.mAsh, this.ash[1 - this.ca]); this.ca = 1 - this.ca;
    }
  }
  // Lectura de resumen (bloques 8×8)
  summary(set) {
    const S = set || this, U = S.U, FXo = S.FX, m = this.mSum.uniforms;
    m.tTerr.value = U[2]; m.tFluid.value = U[0]; m.tFluidP.value = U[1]; m.tStat.value = U[3]; m.tFluxA.value = FXo[0]; m.tFluxB.value = FXo[1]; m.tFire.value = S.fireTex;
    this.pass(this.mSum, this.sumRT);
    this.r.readRenderTargetPixels(this.sumRT, 0, 0, this.bw * 4, this.bh, this.sumBuf);
    return { buf: this.sumBuf, bw: this.bw, bh: this.bh };
  }
  // Muestreo de un conjunto de puntos (km) → filas: stat, fluid, fluidP, ash, terr, fire
  makeSampler(name, pts) {
    const W = Math.max(1, pts.length), data = new Float32Array(W * 4);
    pts.forEach((p, i) => { const [ci, cj] = this.cell(p.x, p.y); data[i * 4] = Math.round(Math.max(0, Math.min(this.nx - 1, ci))); data[i * 4 + 1] = Math.round(Math.max(0, Math.min(this.ny - 1, cj))); });
    const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true;
    const rt = new THREE.WebGLRenderTarget(W, 7, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const s = { tex, rt, W, buf: new Float32Array(W * 7 * 4), pts };
    const old = this.samplers.get(name); if (old) { old.tex.dispose(); old.rt.dispose(); }
    this.samplers.set(name, s); return s;
  }
  sample(name, accTex, set) {
    const s = this.samplers.get(name); if (!s) return null;
    const S = set || this, U = S.U, m = this.mSample.uniforms;
    m.tPts.value = s.tex; m.t0.value = U[3]; m.t1.value = U[0]; m.t2.value = U[1]; m.t3.value = S.ashTex; m.t4.value = U[2]; m.t5.value = accTex || S.fireTex; m.t6.value = this.baseTex;
    m.uN.value.set(this.nx, this.ny);
    this.pass(this.mSample, s.rt);
    this.r.readRenderTargetPixels(s.rt, 0, 0, s.W, 7, s.buf);
    const W = s.W, b = s.buf, row = (r, i) => [b[(r * W + i) * 4], b[(r * W + i) * 4 + 1], b[(r * W + i) * 4 + 2], b[(r * W + i) * 4 + 3]];
    return s.pts.map((p, i) => ({ stat: row(0, i), fluid: row(1, i), fluidP: row(2, i), ash: row(3, i), terr: row(4, i), fire: row(5, i), base: row(6, i) }));
  }
  accumulate(accRT) {
    const U = this.U, m = this.mAccum.uniforms;
    m.tAcc.value = accRT[0].texture; m.tStat.value = U[3]; m.tFluidP.value = U[1]; m.tAsh.value = this.ashTex; m.tTerr.value = U[2];
    this.pass(this.mAccum, accRT[1]); accRT.reverse();
  }
  dispose() {
    for (const m of [...this.mrtU, ...this.mrtF, ...this.fire, ...this.ash, this.sumRT, this.baseRT, this.snapF, this.snapQ]) m.dispose();
    this.staticTex.dispose();
    for (const s of this.samplers.values()) { s.tex.dispose(); s.rt.dispose(); }
  }
}


// =====================================================================
//  Reproducción: rearma el estado del motor en cualquier instante a partir
//  del historial calculado. Expone las mismas texturas que el solver, así
//  que el terreno, los fluidos, el bosque y los sensores funcionan igual.
// =====================================================================
export class Player {
  constructor(sol) {
    this.sol = sol; const W = sol.nx, H = sol.ny;
    const opt = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
    const mrt = n => { const m = new THREE.WebGLMultipleRenderTargets(W, H, n, opt); for (const t of m.texture) { t.type = THREE.FloatType; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; } return m; };
    this.m1 = mrt(4); this.m2 = mrt(2); this.m3 = mrt(2);
    const T = () => ({ value: null });
    this.r1 = sol.mk(RECON1, { tStatF: T(), tFluidPF: T(), tTerrF: T(), tH1: T(), tH2: T(), tBase: { value: sol.baseRT.texture }, tStatic: { value: sol.staticTex }, uPT: { value: 0 }, uTnow: { value: 1 } });
    this.r2 = sol.mk(RECON2, { tFl: T(), tFp: T(), tH1: T(), tH2: T() });
    this.r3 = sol.mk(RECON3, { tAshF: T(), tFireF: T(), uPT: { value: 0 }, uAshEnd: { value: 3600 } });
    this.t = -1;
    for (const k of ['nx', 'ny', 's', 'dx', 'cellKm', 'staticTex']) this[k] = sol[k];
  }
  get U() { return this.m1.texture; }
  get FX() { return this.m2.texture; }
  get ashTex() { return this.m3.texture[0]; }
  get fireTex() { return this.m3.texture[1]; }
  get baseTex() { return this.sol.baseTex; }
  world(i, j) { return this.sol.world(i, j); }
  cell(x, y) { return this.sol.cell(x, y); }
  update(t, tNow, tAshEnd) {
    const sol = this.sol, U = sol.U, H = sol.H, prev = sol.r.getRenderTarget();
    const a = this.r1.uniforms; a.tStatF.value = U[3]; a.tFluidPF.value = U[1]; a.tTerrF.value = U[2]; a.tH1.value = H[0]; a.tH2.value = H[1]; a.uPT.value = t; a.uTnow.value = tNow;
    sol.pass(this.r1, this.m1);
    const b = this.r2.uniforms; b.tFl.value = this.m1.texture[0]; b.tFp.value = this.m1.texture[1]; b.tH1.value = H[0]; b.tH2.value = H[1];
    sol.pass(this.r2, this.m2);
    const c = this.r3.uniforms; c.tAshF.value = sol.ashTex; c.tFireF.value = sol.fireTex; c.uPT.value = t; c.uAshEnd.value = tAshEnd;
    sol.pass(this.r3, this.m3);
    sol.r.setRenderTarget(prev); this.t = t;
  }
  summary() { return this.sol.summary(this); }
  sample(name, accTex) { return this.sol.sample(name, accTex, this); }
}
