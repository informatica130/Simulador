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
  const [GR, osm, places, net, rivers, demP, relP, satS] = await Promise.all([
    json('data/grid.json'), json('data/osm.json'), json('data/places.json'), json('data/net.json'), json('data/rivers.json'),
    pixels('data/dem.png'), pixels('data/rel.png'), pixels('data/sat_small.jpg'),
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
  progress('Preparando capas…', 0.6);
  return { GR, nx, ny, N, cellM, dem, river, basin, slope, ice, fuel, ao, glacier, osm, places, net, rivers, satAt };
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
  const { GR, nx, ny, dem } = D;
  return (x, y) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - GR.X0) / GR.cell)), fy = Math.max(0, Math.min(ny - 1.001, (GR.Y1 - y) / GR.cell));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j;
    return dem[j * nx + i] * (1 - u) * (1 - v) + dem[j * nx + i + 1] * u * (1 - v) + dem[(j + 1) * nx + i] * (1 - u) * v + dem[(j + 1) * nx + i + 1] * u * v;
  };
}
