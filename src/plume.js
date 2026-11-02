// =====================================================================
//  Columna eruptiva: modelo integral de pluma con viento
//  (Morton-Taylor-Turner 1956; Bursik 2001; Woodhouse et al. 2013, JGR)
//  y dispersión de tefra tipo Tephra2 (Bonadonna et al. 2005).
// =====================================================================
import { PHYS } from './config.js';

const Ra = 287.05, Rv = 461.5, ca = 1004, cv = 1850, cs = 1100, rhoS = 1200;
const KS = 0.09, KW = 0.9;   // coeficientes de entrainment radial y por viento (Woodhouse et al. 2013)

// Atmósfera estándar
export function atm(z) {
  let T, p;
  if (z < 11000) { T = 288.15 - 0.0065 * z; p = 101325 * Math.pow(T / 288.15, 5.2559); }
  else if (z < 20000) { T = 216.65; p = 22632 * Math.exp(-(z - 11000) / 6341.6); }
  else { T = 216.65 + 0.001 * (z - 20000); p = 5474.9 * Math.pow(T / 216.65, -34.163); }
  return { T, p, rho: p / (Ra * T), mu: 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4) };
}
// Perfil de viento: crece hasta la corriente en chorro (~10–12 km) y decae arriba
export function windAt(z, vref) {
  if (z < 10000) return vref * (0.3 + 0.7 * Math.max(0, z - 500) / 9500);
  if (z < 12500) return vref;
  return vref * Math.max(0.35, 1 - (z - 12500) / 14000);
}

// Integra la pluma. Devuelve trayectoria (x a favor del viento, z) y propiedades.
export function runPlume({ MER, vref = 20, z0 = 3100, w0 = 0.03, T0 = 1373, U0 }) {
  if (!(MER > 1)) return null;
  U0 = U0 || Math.min(260, 70 + 28 * Math.log10(MER / 1e4 + 1) + 30);
  const n0 = 1 - w0;
  const A0 = atm(z0);
  const rho0 = 1 / (n0 / rhoS + w0 * Rv * T0 / A0.p);
  const b0 = Math.sqrt(MER / (Math.PI * rho0 * U0));
  const Q0 = MER / Math.PI;
  const st = { Q: Q0, M: Q0 * U0, th: Math.PI / 2, x: 0, z: z0, E: 0 };
  const cp0 = n0 * cs + w0 * cv;
  st.E = Q0 * (cp0 * T0 + 9.81 * z0 + U0 * U0 / 2);
  const out = []; let collapse = false, Hnb = null, maxZ = z0, buoy = false;
  const derive = s => {
    const a = atm(s.z), V = windAt(s.z, vref);
    const n = n0 * Q0 / s.Q, w = w0 * Q0 / s.Q, air = Math.max(0, 1 - n - w);
    const cpm = n * cs + air * ca + w * cv;
    const U = s.M / s.Q;
    const T = Math.max(200, (s.E / s.Q - 9.81 * s.z - U * U / 2) / cpm);
    const gasR = air * Ra + w * Rv;
    const rho = 1 / (n / rhoS + gasR * T / a.p);
    const b = Math.sqrt(s.Q / (rho * Math.max(U, 0.05)));
    return { a, V, U, T, rho, b, n };
  };
  const rhs = s => {
    const d = derive(s), { a, V, U, rho, b } = d;
    const Ue = KS * Math.abs(U - V * Math.cos(s.th)) + KW * Math.abs(V * Math.sin(s.th));
    const dQ = 2 * a.rho * b * Ue;
    const dM = 9.81 * (a.rho - rho) * b * b * Math.sin(s.th) + V * Math.cos(s.th) * dQ;
    const dth = (9.81 * (a.rho - rho) * b * b * Math.cos(s.th) - V * Math.sin(s.th) * dQ) / Math.max(s.M, 1e-9);
    const dE = (ca * a.T + 9.81 * s.z + V * V / 2) * dQ;
    return { Q: dQ, M: dM, th: dth, x: Math.cos(s.th), z: Math.sin(s.th), E: dE, d };
  };
  let s = 0;
  for (let it = 0; it < 20000; it++) {
    const k1 = rhs(st), d = k1.d;
    if (it % 2 === 0) out.push({ s, x: st.x, z: st.z, b: d.b, U: d.U, T: d.T, rho: d.rho, rhoa: d.a.rho, th: st.th, n: d.n });
    if (d.rho < d.a.rho) buoy = true;
    if (buoy && d.rho > d.a.rho && Hnb === null) Hnb = st.z;
    maxZ = Math.max(maxZ, st.z);
    const ds = Math.max(4, Math.min(150, d.b * 0.08));
    // RK2
    const mid = {}; for (const k of ['Q', 'M', 'th', 'x', 'z', 'E']) mid[k] = st[k] + 0.5 * ds * k1[k];
    if (mid.M <= 0) { if (!buoy) collapse = true; break; }
    const k2 = rhs(mid);
    for (const k of ['Q', 'M', 'th', 'x', 'z', 'E']) st[k] += ds * k2[k];
    s += ds;
    if (st.M <= Q0 * 0.05 && !buoy) { collapse = true; break; }
    if (st.M <= 1e-6 * Q0 * U0 || st.th < -0.6 || st.z < z0 - 200 || st.z > 45000 || st.x > 200000) break;
    if (buoy && st.th < 0.02 && st.z < maxZ - 50) break;
  }
  const last = out[out.length - 1];
  return { MER, U0, b0, rho0, path: out, Ht: maxZ, Hnb: Hnb || maxZ * 0.75, collapse, buoy, xTop: last ? last.x : 0, vref, z0 };
}

// Altura en función de la distancia a lo largo de la pluma (para efectos)
export function plumeLookup(P, z) {
  const p = P.path; if (!p.length) return null;
  if (z <= p[0].z) return p[0];
  for (let i = 1; i < p.length; i++) if (p[i].z >= z) {
    const a = p[i - 1], b = p[i], f = (z - a.z) / ((b.z - a.z) || 1);
    return { x: a.x + (b.x - a.x) * f, z, b: a.b + (b.b - a.b) * f, U: a.U + (b.U - a.U) * f, T: a.T + (b.T - a.T) * f, th: a.th };
  }
  return p[p.length - 1];
}

// ------------------- Tephra2: velocidad terminal -----------------------
// Bonadonna et al. (1998) régimen de Reynolds: Stokes, intermedio, turbulento
export function settling(d, rp, z) {
  const a = atm(z);
  const vS = 9.81 * d * d * rp / (18 * a.mu);
  if (vS * d * a.rho / a.mu < 0.4) return vS;
  const vI = d * Math.cbrt(4 * rp * rp * 9.81 * 9.81 / (225 * a.mu * a.rho));
  const ReI = vI * d * a.rho / a.mu;
  if (ReI < 500) return vI;
  return Math.sqrt(3.1 * rp * 9.81 * d / a.rho);
}
export const PHI = [-3, -1.5, 0, 1.5, 3, 4.5, 6];
export const phiDiam = p => Math.pow(2, -p) / 1000;     // m
export const phiRho = p => p <= -1 ? 1100 : p >= 4 ? 2500 : 1100 + (p + 1) / 5 * 1400;

export function tgsdWeights(med, sig) {
  const w = PHI.map(p => Math.exp(-0.5 * ((p - med) / sig) ** 2));
  const s = w.reduce((a, b) => a + b, 0); return w.map(v => v / s);
}

// Para una pluma: núcleos (clase, altura) → tiempo de caída, desplazamiento, sigma, fracción de masa
export function tephraKernels(P, tgsd, groundZ = 1100) {
  const W = tgsdWeights(tgsd[0], tgsd[1]);
  const H = P.Ht, z0 = P.z0, NH = 8, A = P.collapse ? 1.5 : 4;
  // Distribución de Suzuki (masa concentrada cerca del techo)
  const zs = [], fz = [];
  for (let j = 0; j < NH; j++) {
    const f = (j + 0.5) / NH; const z = z0 + f * (H - z0);
    const k = (1 - f) * Math.exp(-A * (1 - f)); zs.push(z); fz.push(Math.max(0, k) + 0.02);
  }
  const sz = fz.reduce((a, b) => a + b, 0);
  const out = [];
  for (let i = 0; i < PHI.length; i++) {
    const d = phiDiam(PHI[i]), rp = phiRho(PHI[i]);
    for (let j = 0; j < NH; j++) {
      const zr = zs[j]; const pl = plumeLookup(P, zr);
      // la clase más gruesa cae del margen de la columna, poco transporte
      let t = 0, x = pl ? pl.x : 0;
      for (let z = zr; z > groundZ; z -= 250) {
        const v = settling(d, rp, z), dz = Math.min(250, z - groundZ);
        const dt = dz / v; t += dt; x += windAt(z, P.vref) * dt;
      }
      const top = j >= NH - 3;
      const sig0 = (pl ? pl.b : 200) + (top ? (P.Ht - P.z0) * 0.25 : 0);
      const sig2 = sig0 * sig0 + (t < 1800 ? 2 * 600 * t : 2 * 600 * 1800 + 0.8 * 0.04 * (Math.pow(t, 2.5) - Math.pow(1800, 2.5)));
      out.push({ i, j, phi: PHI[i], tf: t, x, sigma: Math.sqrt(sig2), frac: W[i] * fz[j] / sz });
    }
  }
  return out;
}
