// =====================================================================
//  Carga de datos reales: DEM Copernicus GLO-30 (remuestreado a 60 m),
//  Sentinel-2 cloudless, red vial OSM, edificios, POIs, ríos.
//  Deriva capas estáticas: pendiente, hielo glaciar, combustible vegetal,
//  oclusión ambiental.
// =====================================================================
import { SNOW_MONTH } from './config.js';

async function pixels(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('No se pudo cargar ' + url);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, d: x.getImageData(0, 0, bmp.width, bmp.height).data, bmp };
}
const json = async u => { const r = await fetch(u); if (!r.ok) throw new Error('No se pudo cargar ' + u); return r.json(); };

export async function loadData(progress) {
  progress('Descargando relieve Copernicus, imagen Sentinel-2 y OpenStreetMap…', 0.05);
  const [GR, osm, places, net, rivers, demP, relP, satS, d30P, w30P] = await Promise.all([
    json('data/grid.json'), json('data/osm.json'), json('data/places.json'), json('data/net.json'), json('data/rivers.json'),
    pixels('data/dem.png'), pixels('data/rel.png'), pixels('data/sat_small.jpg'), pixels('data/dem30.png'), pixels('data/water30.png'),
  ]);
  progress('Procesando terreno…', 0.35);
  const nx = GR.nx, ny = GR.ny, N = nx * ny;
  const dem = new Float32Array(N), river = new Uint8Array(N), basin = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    dem[i] = (demP.d[i * 4] * 256 + demP.d[i * 4 + 1]) / 10;
    river[i] = relP.d[i * 4 + 2] > 127 ? 1 : 0;
    basin[i] = Math.round(relP.d[i * 4 + 1] / 80);
  }
  const cellM = GR.cell * 1000;
  // pendiente (grados)
  const slope = new Float32Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const a = dem[j * nx + Math.min(nx - 1, i + 1)] - dem[j * nx + Math.max(0, i - 1)];
    const b = dem[Math.min(ny - 1, j + 1) * nx + i] - dem[Math.max(0, j - 1) * nx + i];
    slope[k] = Math.atan(Math.hypot(a, b) / (2 * cellM)) * 57.2958;
  }
  // muestreo de la imagen satelital a la grilla (para hielo visible y vegetación)
  const sw = satS.w, sh = satS.h;
  const satAt = (x, y) => {
    const u = (x - GR.bx0) / (GR.bx1 - GR.bx0), v = (GR.by1 - y) / (GR.by1 - GR.by0);
    const px = Math.min(sw - 1, Math.max(0, Math.round(u * (sw - 1)))), py = Math.min(sh - 1, Math.max(0, Math.round(v * (sh - 1))));
    const o = (py * sw + px) * 4; return [satS.d[o] / 255, satS.d[o + 1] / 255, satS.d[o + 2] / 255];
  };
  progress('Derivando glaciar, combustible vegetal y oclusión…', 0.5);
  // Hielo glaciar del Llaima (m equivalente en agua) y combustible (0–1)
  const ice = new Float32Array(N), fuel = new Float32Array(N);
  let iceArea = 0, iceVol = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = GR.X0 + i * GR.cell, y = GR.Y1 - j * GR.cell, z = dem[k];
    const [r, g, b] = satAt(x, y), br = (r + g + b) / 3;
    const dist = Math.hypot(x, y);
    // Hielo: edificio del Llaima sobre ~1950 m; donde la imagen muestra blanco o, más arriba, hielo cubierto de detritos
    if (dist < 7.5 && z > 1950 && slope[k] < 48) {
      const vis = br > 0.62 ? 1 : 0;
      const hi = smooth(2150, 2700, z);
      const f = Math.max(vis, hi * 0.85) * (1 - smooth(36, 48, slope[k]));
      if (f > 0.05) {
        // espesor en agua equivalente: 4 m en el borde, hasta ~40 m en la plataforma de la cumbre
        const th = f * (4 + 36 * smooth(2000, 2900, z)) * (dist < 0.35 ? 0.3 : 1);
        ice[k] = th; iceArea += 1; iceVol += th;
      }
    }
    // Vegetación: bosque (verde oscuro) hasta ~1700 m; praderas con menos combustible
    if (z < 1750 && !river[k]) {
      const green = g - Math.max(r, b);
      let f = 0;
      if (green > 0.005 && br < 0.42) f = 0.6 + Math.min(0.4, green * 8);
      else if (green > -0.01 && br < 0.55) f = 0.3;
      fuel[k] = f * (1 - smooth(1500, 1750, z));
    }
  }
  const cellA = cellM * cellM;
  const glacier = { areaKm2: iceArea * cellA / 1e6, volKm3: iceVol * cellA / 1e9 * (1000 / 900) };
  // Oclusión ambiental por concavidad (diferencia con el relieve suavizado a dos escalas)
  const ao = new Float32Array(N);
  const b1 = boxBlur(dem, nx, ny, 3), b2 = boxBlur(dem, nx, ny, 12);
  for (let k = 0; k < N; k++) {
    const c = (b1[k] - dem[k]) * 0.02 + (b2[k] - dem[k]) * 0.006;
    ao[k] = Math.max(0.35, Math.min(1, 1 - Math.max(0, c)));
  }
  progress('Relieve de alta resolución Copernicus GLO-30…', 0.55);
  // ---- DEM de 30 m (Copernicus GLO-30 original, 1 arcseg) en la misma proyección local, grilla alineada a la de 60 m
  const nx30 = d30P.w, ny30 = d30P.h, N30 = nx30 * ny30, cell30 = GR.cell / 2;
  const dem30 = new Float32Array(N30);
  for (let i = 0; i < N30; i++) dem30[i] = (d30P.d[i * 4] * 256 + d30P.d[i * 4 + 1]) / 10;
  // Textura de detalle (RGBA8): gradiente E y N codificado, oclusión ambiental, agua
  const c30 = cell30 * 1000, enc = g => Math.round(127.5 + 127.5 * Math.sign(g) * Math.sqrt(Math.min(1, Math.abs(g) / 2.5)));
  const a1 = boxBlur(dem30, nx30, ny30, 4), a2 = boxBlur(dem30, nx30, ny30, 20);
  const det30 = new Uint8Array(N30 * 4);
  for (let j = 0; j < ny30; j++) for (let i = 0; i < nx30; i++) {
    const k = j * nx30 + i;
    const gE = (dem30[j * nx30 + Math.min(nx30 - 1, i + 1)] - dem30[j * nx30 + Math.max(0, i - 1)]) / (2 * c30);
    const gN = (dem30[Math.max(0, j - 1) * nx30 + i] - dem30[Math.min(ny30 - 1, j + 1) * nx30 + i]) / (2 * c30);
    const c = (a1[k] - dem30[k]) * 0.03 + (a2[k] - dem30[k]) * 0.006;
    det30[k * 4] = enc(gE); det30[k * 4 + 1] = enc(gN);
    det30[k * 4 + 2] = Math.round(255 * Math.max(0.3, Math.min(1, 1 - Math.max(0, c))));
    det30[k * 4 + 3] = w30P.d[k * 4];
  }
  progress('Preparando capas…', 0.6);
  return { GR, nx, ny, N, cellM, dem, river, basin, slope, ice, fuel, ao, glacier, osm, places, net, rivers, satAt, nx30, ny30, N30, cell30, dem30, det30 };
}

export function snowSWE(D, month) {
  const { zl, peak } = SNOW_MONTH[month];
  const out = new Float32Array(D.N);
  for (let k = 0; k < D.N; k++) {
    const z = D.dem[k], s = D.slope[k];
    let w = Math.max(0, Math.min(1.5, (z - zl) / 900)) * peak;
    w *= 1 - smooth(38, 55, s);                 // la nieve no se acumula en paredes
    out[k] = w + D.ice[k];
  }
  return out;
}

export function smooth(a, b, v) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

function boxBlur(src, nx, ny, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < ny; j++) {
    let s = 0, n = 0;
    for (let i = -r; i <= r; i++) if (i >= 0 && i < nx) { s += src[j * nx + i]; n++; }
    for (let i = 0; i < nx; i++) {
      tmp[j * nx + i] = s / n;
      const a = i - r, b = i + r + 1;
      if (a >= 0) { s -= src[j * nx + a]; n--; }
      if (b < nx) { s += src[j * nx + b]; n++; }
    }
  }
  for (let i = 0; i < nx; i++) {
    let s = 0, n = 0;
    for (let j = -r; j <= r; j++) if (j >= 0 && j < ny) { s += tmp[j * nx + i]; n++; }
    for (let j = 0; j < ny; j++) {
      out[j * nx + i] = s / n;
      const a = j - r, b = j + r + 1;
      if (a >= 0) { s -= tmp[a * nx + i]; n--; }
      if (b < ny) { s += tmp[b * nx + i]; n++; }
    }
  }
  return out;
}

// Coordenadas
export function makeGeo(GR) {
  const toLL = (x, y) => [GR.LAT0 + y / GR.KY, GR.LON0 + x / GR.KX];
  const fromLL = (lat, lon) => [(lon - GR.LON0) * GR.KX, (lat - GR.LAT0) * GR.KY];
  const cellOf = (x, y) => [Math.round((x - GR.X0) / GR.cell), Math.round((GR.Y1 - y) / GR.cell)];
  const xyOf = (i, j) => [GR.X0 + i * GR.cell, GR.Y1 - j * GR.cell];
  return { toLL, fromLL, cellOf, xyOf };
}

export function heightSampler(D) {
  const { GR } = D, nx = D.nx30, ny = D.ny30, dem = D.dem30, cell = D.cell30;
  return (x, y) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - GR.X0) / cell)), fy = Math.max(0, Math.min(ny - 1.001, (GR.Y1 - y) / cell));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j;
    return dem[j * nx + i] * (1 - u) * (1 - v) + dem[j * nx + i + 1] * u * (1 - v) + dem[(j + 1) * nx + i] * (1 - u) * v + dem[(j + 1) * nx + i + 1] * u * v;
  };
}

// ---------------------------------------------------------------------
// Hidrología: caudal base de los ríos (D8 sobre el DEM de 60 m).
// Escorrentía específica media ~55 L/s/km² (Andes de La Araucanía) con
// régimen mixto pluvio-nival: máximos en invierno (lluvia) y primavera
// (deshielo), mínimos a fines del verano.
// ---------------------------------------------------------------------
export const QSPEC_MONTH = [0.55, 0.40, 0.38, 0.60, 1.10, 1.50, 1.45, 1.35, 1.25, 1.40, 1.30, 0.90].map(f => f * 0.055); // m³/s/km²
let hydroCache = null;
function hydro(D) {
  if (hydroCache) return hydroCache;
  const { nx, ny, N, dem, river } = D;
  const dI = [1, 1, 0, -1, -1, -1, 0, 1], dJ = [0, 1, 1, 1, 0, -1, -1, -1];
  // Relleno de depresiones con inundación por prioridad + épsilon (Barnes et al. 2014):
  // las pequeñas depresiones del modelo de superficie no cortan la red de drenaje
  const fz = Float32Array.from(dem), closed = new Uint8Array(N);
  const hk = new Int32Array(N), hv = new Float32Array(N); let hn = 0;
  const push = (k, v) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= v) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
  const pop = () => { const top = hk[0], k = hk[--hn], v = hv[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hv[c + 1] < hv[c]) c++; if (hv[c] >= v) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = k; hv[i] = v; return top; };
  for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) { const k = j * nx + i; closed[k] = 1; push(k, fz[k]); }
  for (let j = 1; j < ny - 1; j++) for (const i of [0, nx - 1]) { const k = j * nx + i; closed[k] = 1; push(k, fz[k]); }
  while (hn) {
    const c = pop(), ci = c % nx, cj = (c / nx) | 0;
    for (let q = 0; q < 8; q++) { const ii = ci + dI[q], jj = cj + dJ[q]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const n = jj * nx + ii; if (closed[n]) continue;
      closed[n] = 1; if (fz[n] <= fz[c]) fz[n] = fz[c] + 0.002; push(n, fz[n]); }
  }
  const down = new Int32Array(N).fill(-1), sl = new Float32Array(N);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i; let best = 0, bk = -1, bq = 0;
    for (let q = 0; q < 8; q++) { const kk = (j + dJ[q]) * nx + i + dI[q]; const s = (fz[k] - fz[kk]) / ((q & 1) ? 1.4142 : 1); if (s > best) { best = s; bk = kk; bq = q; } }
    down[k] = bk; sl[k] = bk >= 0 ? Math.max(0, dem[k] - dem[bk]) / (D.cellM * ((bq & 1) ? 1.4142 : 1)) : 0;
  }
  const order = new Uint32Array(N); for (let k = 0; k < N; k++) order[k] = k;
  order.sort((a, b) => fz[b] - fz[a]);
  const cellKm2 = D.cellM * D.cellM / 1e6;
  const full = new Float32Array(N).fill(cellKm2);
  for (let q = 0; q < N; q++) { const k = order[q], d = down[k]; if (d >= 0) full[d] += full[k]; }
  // Red de cauces propia (consistente con el flujo): área drenada > 1,5 km².
  // En cada paso diagonal se agrega la celda ortogonal más baja para que el cauce sea continuo en 4 vecinos.
  const chan = new Uint8Array(N), main = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (full[k] >= 1.5) {
    chan[k] = 1; main[k] = 1; const d = down[k]; if (d < 0) continue;
    const ki = k % nx, kj = (k / nx) | 0, di = d % nx, dj = (d / nx) | 0;
    if (ki !== di && kj !== dj) { const a = kj * nx + di, b = dj * nx + ki; chan[dem[a] < dem[b] ? a : b] = 1; }
  }
  const lat = new Float32Array(N), pend = new Float32Array(N).fill(cellKm2);
  for (let q = 0; q < N; q++) {
    const k = order[q], d = down[k];
    if (chan[k]) lat[k] += pend[k];
    else if (d >= 0) pend[d] += pend[k];
  }
  // las celdas intermedias de pasos diagonales heredan el área del cauce para el nivel inicial
  for (let k = 0; k < N; k++) if (chan[k] && full[k] < 1.5) { let m = 0; const ki = k % nx, kj = (k / nx) | 0;
    for (let q = 0; q < 8; q++) { const ii = ki + dI[q], jj = kj + dJ[q]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const n = jj * nx + ii; if (full[n] >= 1.5) m = Math.max(m, full[n]); } full[k] = Math.max(full[k], m); }
  return (hydroCache = { full, lat, sl, chan, main });
}
// Arreglo RGBA a la resolución del solver: (nivel inicial Manning, aporte lateral m/s, cauce, área drenada km²)
export function riverBase(D, month, s) {
  const H = hydro(D), qs = QSPEC_MONTH[month];
  const nxs = Math.floor(D.nx / s), nys = Math.floor(D.ny / s), out = new Float32Array(nxs * nys * 4);
  const w = D.cellM * s, cellA = w * w;
  for (let j = 0; j < nys; j++) for (let i = 0; i < nxs; i++) {
    let lat = 0, riv = 0, area = 0, hmax = 0;
    for (let b = 0; b < s; b++) for (let c = 0; c < s; c++) {
      const k = (j * s + b) * D.nx + i * s + c;
      lat += H.lat[k];
      if (H.chan[k]) {
        riv = 1; area = Math.max(area, H.full[k]);
        const Q = H.full[k] * qs, S = Math.max(0.004, H.sl[k]);
        hmax = Math.max(hmax, Math.pow(Q * 0.035 / (w * Math.sqrt(S)), 0.6));
      }
    }
    const o = (j * nxs + i) * 4;
    out[o] = riv ? hmax : 0; out[o + 1] = lat * qs / cellA; out[o + 2] = riv; out[o + 3] = area;
  }
  return out;
}
export function channelAt(D, k) { return hydro(D).main[k]; }
export function drainageAt(D, x, y) { const H = hydro(D); const i = Math.round((x - D.GR.X0) / D.GR.cell), j = Math.round((D.GR.Y1 - y) / D.GR.cell); return H.full[j * D.nx + i] || 0; }
