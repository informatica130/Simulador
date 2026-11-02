// =====================================================================
//  Configuración: constantes físicas, catálogo eruptivo, escenarios,
//  clima (nieve por mes), sensores virtuales.
//  Unidades: planta en km (x = este, y = norte, origen en el cráter
//  principal), altura en m, tiempo de simulación en s.
// =====================================================================

export const PHYS = {
  g: 9.81,
  rhoW: 1000, rhoIce: 900, Lf: 3.34e5,          // agua, hielo, calor latente de fusión (J/kg)
  rhoS: 2650, Cstar: 0.62, tanPhi: 0.70,          // sedimento: densidad grano, concentración del lecho, ángulo de fricción interna
  rhoLava: 2550, cLava: 1150, Lcryst: 3.5e5,     // andesita basáltica: densidad, calor específico, calor latente de cristalización
  Tliq: 1450, Tsol: 1225, Tamb: 278,              // K
  sigma: 5.67e-8, emis: 0.95,
  rhoDRE: 2600,
};

// Ubicaciones de referencia (km)
export const VENTS = {
  crater: { x: 0.03, y: 0.03, h: 3122, name: 'Cráter principal' },
  pichi: { x: 0.36, y: -1.08, h: 2912, name: 'Pichillaima (cono SSE)' },
};
// Lineamiento NNE de conos adventicios (az ≈ 20°)
export const FISSURE_AZ = 20;

// ---------------------------------------------------------------------
// Catálogo histórico (Global Volcanism Program / SERNAGEOMIN, aproximado).
// vei: índice de explosividad estimado; k: rasgo dominante.
// ---------------------------------------------------------------------
export const CATALOG = [
  { y: 1640, vei: 4, k: 'Subpliniana; caída de escoria al E, lahares', big: true },
  { y: 1751, vei: 3, k: 'Gran colada por el valle Truful-Truful (~23 km)', big: true },
  { y: 1759, vei: 2 }, { y: 1822, vei: 2 }, { y: 1852, vei: 3, k: 'Explosiva, coladas' },
  { y: 1862, vei: 2 }, { y: 1864, vei: 2 }, { y: 1866, vei: 2 }, { y: 1869, vei: 2 }, { y: 1872, vei: 2 },
  { y: 1874, vei: 2 }, { y: 1875, vei: 2 }, { y: 1876, vei: 2 }, { y: 1883, vei: 2 }, { y: 1887, vei: 2 },
  { y: 1889, vei: 2 }, { y: 1893, vei: 2 }, { y: 1895, vei: 2 }, { y: 1903, vei: 2 }, { y: 1907, vei: 2 },
  { y: 1912, vei: 2 }, { y: 1914, vei: 2 }, { y: 1917, vei: 2 }, { y: 1922, vei: 2 }, { y: 1927, vei: 3, k: 'Coladas y lahares' },
  { y: 1929, vei: 2 }, { y: 1932, vei: 2 }, { y: 1933, vei: 2 }, { y: 1937, vei: 2 }, { y: 1938, vei: 2 },
  { y: 1941, vei: 2 }, { y: 1944, vei: 3 }, { y: 1945, vei: 2 }, { y: 1946, vei: 2 }, { y: 1949, vei: 2 },
  { y: 1955, vei: 3, k: '1955–57: coladas N, NE y E desde el Pichillaima; lahar ~10× el de 2008', big: true },
  { y: 1956, vei: 2 }, { y: 1957, vei: 3 }, { y: 1960, vei: 2 }, { y: 1964, vei: 2 }, { y: 1971, vei: 2 },
  { y: 1972, vei: 1 }, { y: 1979, vei: 2 }, { y: 1984, vei: 2, k: 'Freatomagmática' }, { y: 1990, vei: 1 },
  { y: 1994, vei: 2, k: 'Lahar por el Calbuco–Quepe: 5 puentes destruidos, llegó hasta Vilcún', big: true },
  { y: 1995, vei: 1 }, { y: 1997, vei: 1 }, { y: 1998, vei: 2 }, { y: 2002, vei: 1 }, { y: 2003, vei: 2 },
  { y: 2007, vei: 1 }, { y: 2008, vei: 3, k: '1 ene 2008: fuente de lava, columna, colada O cortó el glaciar; lahares Captrén y Truful-Truful', big: true },
  { y: 2009, vei: 3, k: 'Abr 2009: colada SO de ~4,5 km y N; lahar al Calbuco', big: true },
];

// Nieve estacional por mes (cota de nieve en m y equivalente en agua máximo en m) – clima La Araucanía andina
export const SNOW_MONTH = [
  { zl: 2100, peak: 0.30 }, { zl: 2300, peak: 0.20 }, { zl: 2300, peak: 0.20 }, { zl: 1900, peak: 0.40 },
  { zl: 1500, peak: 0.75 }, { zl: 1200, peak: 1.20 }, { zl: 1000, peak: 1.60 }, { zl: 1000, peak: 1.90 },
  { zl: 1100, peak: 2.00 }, { zl: 1300, peak: 1.80 }, { zl: 1600, peak: 1.20 }, { zl: 1900, peak: 0.60 },
];
// Humedad del combustible (propagación del fuego) por mes: 1 = muy seco
export const FIRE_DRY = [1.0, 1.0, .85, .55, .3, .15, .12, .12, .18, .3, .5, .8];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------------------------------------------------------------------
// Escenarios. Cada fase: t0,t1 (min), MER (kg/s, explosivo), E (m³/s lava DRE),
// fountain (m), collapse (fracción del MER que colapsa en CDP), ballistic (0–1),
// pulse (estromboliana: explosiones discretas).
// ---------------------------------------------------------------------
export const SCENARIOS = {
  e2008: {
    name: '1 ene 2008 · Estromboliana violenta', short: 'Ene 2008', vei: 'IEV 3', date: [2008, 1, 1, 17.9],
    desc: 'Fuente de lava y columna de 6–8 km. La lava desbordó el borde occidental y abrió canales en el glaciar; lahares pequeños por el Captrén y el Truful-Truful. Comenzó casi sin aviso.',
    vents: [{ x: -0.12, y: 0.0, r: 0.12 }], w0: 0.025, T0: 1418, tgsd: [0.5, 1.6],
    wind: { to: 100, speed: 22 },
    phases: [
      { t0: 0, t1: 360, MER: 6e5, fountain: 450, ballistic: 0.8, pulse: true },
      { t0: 10, t1: 900, E: 35 },
      { t0: 360, t1: 2000, MER: 8e4, pulse: true, ballistic: 0.3 },
    ],
  },
  e2009: {
    name: 'Abr 2009 · Fisura y fuente de lava', short: 'Abr 2009', vei: 'IEV 3', date: [2009, 4, 1, 5.0],
    desc: 'Fuente de lava de cientos de metros y dos coladas: una hacia el SO (~4,5 km) que derritió el glaciar y generó un lahar al Calbuco, y otra al N.',
    vents: [{ x: -0.15, y: -0.1, r: 0.15 }, { x: 0.05, y: 0.15, r: 0.12 }], w0: 0.02, T0: 1423, tgsd: [0.0, 1.8],
    wind: { to: 80, speed: 18 },
    phases: [
      { t0: 0, t1: 600, MER: 3e5, fountain: 600, ballistic: 0.6, pulse: true },
      { t0: 5, t1: 2400, E: 45 },
    ],
  },
  e1994: {
    name: 'May 1994 · Estromboliana con mucha nieve', short: 'May 1994', vei: 'IEV 2', date: [1994, 5, 17, 6.0],
    desc: 'Erupción estromboliana a fines de otoño, con nieve fresca: el deshielo generó un lahar por el Calbuco–Quepe que destruyó 5 puentes y llegó a Vilcún (43 km al O).',
    vents: [{ x: -0.1, y: 0.0, r: 0.15 }], w0: 0.025, T0: 1418, tgsd: [0.5, 1.5],
    wind: { to: 95, speed: 25 },
    phases: [
      { t0: 0, t1: 720, MER: 2.5e5, fountain: 300, ballistic: 0.7, pulse: true },
      { t0: 15, t1: 720, E: 40 },
    ],
  },
  e1957: {
    name: '1955–57 · Pichillaima', short: '1957', vei: 'IEV 3', date: [1957, 3, 1, 12],
    desc: 'Actividad efusiva importante desde el cono sur con coladas al N, NE y E y lahares unas diez veces mayores que los de 2008.',
    vents: [{ x: 0.36, y: -1.08, r: 0.15 }, { x: 0.15, y: -0.2, r: 0.12 }], w0: 0.02, T0: 1428, tgsd: [0.5, 1.6],
    wind: { to: 110, speed: 25 },
    phases: [
      { t0: 0, t1: 1440, MER: 4e5, fountain: 400, ballistic: 0.6, pulse: true },
      { t0: 10, t1: 4320, E: 110 },
    ],
  },
  e1751: {
    name: '1751 · Gran colada al SE', short: '1751', vei: 'IEV 3', date: [1751, 2, 15, 10],
    desc: 'Fisuras en el flanco SE vierten lava durante días; la colada baja por el valle del Truful-Truful ~23 km. El deshielo genera los mayores lahares hacia Melipeuco.',
    fissure: { x: 0.9, y: -1.6, az: 135, len: 1.6, n: 4 }, w0: 0.015, T0: 1433, tgsd: [0.0, 1.8],
    wind: { to: 100, speed: 25 },
    phases: [
      { t0: 0, t1: 600, MER: 5e5, fountain: 500, ballistic: 0.5, pulse: true },
      { t0: 5, t1: 8640, E: 320 },
    ],
  },
  e1640: {
    name: '1640 · Subpliniana (IEV 4)', short: '1640', vei: 'IEV 4', date: [1640, 2, 23, 14],
    desc: 'La mayor erupción histórica: columna sostenida de 15–20 km, caída de escoria y lapilli al E, colapsos parciales con corrientes piroclásticas por los valles altos y lahares grandes.',
    vents: [{ x: 0.03, y: 0.03, r: 0.25 }], w0: 0.035, T0: 1398, tgsd: [1.2, 2.0],
    wind: { to: 100, speed: 30 },
    phases: [
      { t0: 0, t1: 25, MER: 8e5, ballistic: 1 },
      { t0: 20, t1: 300, MER: 1.6e7, ballistic: 1, collapse: 0.12 },
      { t0: 300, t1: 1440, MER: 1.5e6, ballistic: 0.4 },
      { t0: 60, t1: 2880, E: 25 },
    ],
  },
  pliniana: {
    name: 'Pliniana con colapso (peor caso)', short: 'Pliniana', vei: 'IEV 4–5', date: [2027, 1, 20, 15],
    desc: 'Escenario de planificación sin análogo histórico directo: columna de >20 km que colapsa parcialmente, corrientes de densidad piroclástica radiales y fusión masiva del glaciar.',
    vents: [{ x: 0.03, y: 0.03, r: 0.3 }], w0: 0.03, T0: 1373, tgsd: [1.5, 2.2],
    wind: { to: 100, speed: 30 },
    phases: [
      { t0: 0, t1: 15, MER: 2e6, ballistic: 1 },
      { t0: 10, t1: 240, MER: 6e7, ballistic: 1, collapse: 0.25 },
      { t0: 240, t1: 720, MER: 3e6, ballistic: 0.3 },
    ],
  },
  freatica: {
    name: 'Explosión freática + deshielo súbito', short: 'Freática', vei: 'IEV 1–2', date: [2026, 9, 15, 3],
    desc: 'Una explosión freática rompe el glaciar del flanco occidental: poca ceniza, pero un pulso violento de agua de deshielo genera un lahar rápido.',
    vents: [{ x: -0.6, y: -0.2, r: 0.2 }], w0: 0.3, T0: 1373, tgsd: [2.5, 1.5],
    wind: { to: 90, speed: 20 },
    water: [{ x: -0.9, y: -0.3, Q: 2500, t0: 2, t1: 25 }],
    phases: [
      { t0: 0, t1: 30, MER: 1.5e5, ballistic: 1, pulse: true },
      { t0: 30, t1: 300, MER: 2e4, pulse: true },
    ],
  },
  custom: {
    name: 'Personalizado', short: 'Personal', vei: '—', date: [2026, 11, 2, 18],
    desc: 'Coloca tú la boca eruptiva o la fisura sobre el mapa y ajusta la tasa, la duración, la nieve y el viento.',
    vents: [{ x: 0.03, y: 0.03, r: 0.15 }], w0: 0.03, T0: 1423, tgsd: [0.8, 1.7],
    wind: { to: 100, speed: 25 },
    phases: [
      { t0: 0, t1: 720, MER: 1e6, fountain: 400, ballistic: 0.7, pulse: true },
      { t0: 10, t1: 2880, E: 80 },
    ],
  },
};

// Sensores virtuales (km). Valores medidos en cada uno por el motor.
export const GAUGES = [
  { k: 'meli', name: 'Puente Allipén · Melipeuco', x: 2.93, y: -17.62 },
  { k: 'truful', name: 'Truful-Truful · ruta S-61', x: 6.05, y: -13.45 },
  { k: 'cascada', name: 'Cascada Truful-Truful', x: 7.18, y: -10.75 },
  { k: 'capt', name: 'Río Captrén · R-925', x: -3.55, y: 11.0 },
  { k: 'calbuco', name: 'Río Calbuco · Los Paraguas', x: -11.0, y: -3.1 },
  { k: 'conguillio', name: 'Lago Conguillío', x: 7.3, y: 5.3 },
  { k: 'quepe', name: 'Estero Quepe · Cherquenco', x: -13.5, y: -7.0 },
  { k: 'curaca', name: 'Curacautín', x: -13.7, y: 28.6 },
];

// Climatología simplificada del viento en altura (hacia dónde sopla): dominan los oestes
export const WIND_CLIM = [
  { to: 95, w: 0.30 }, { to: 120, w: 0.20 }, { to: 70, w: 0.18 }, { to: 145, w: 0.12 },
  { to: 45, w: 0.08 }, { to: 170, w: 0.06 }, { to: 260, w: 0.04 }, { to: 340, w: 0.02 },
];
