// =====================================================================
//  LLAIMA 3D · aplicación principal
// =====================================================================
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadData, makeGeo, heightSampler } from './data.js';
import { SCENARIOS, CATALOG, GAUGES, MONTHS, VENTS } from './config.js';
import { EruptionSource, fissureVents } from './eruption.js';
import { Solver } from './solver.js';
import { Runner } from './runner.js';
import { createTerrain } from './terrain.js';
import { createOverlays, Labels } from './overlays.js';
import { FX } from './fx.js';
import { Ensemble, STYLES } from './ensemble.js';
import { Sound } from './audio.js';
import { lineChart, barChart, histChart, fmtT, fmtN } from './charts.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(max-width: 900px)').matches;

// ------------------------------------------------------------------ estado
const S = {
  scen: params.get('esc') && SCENARIOS[params.get('esc')] ? params.get('esc') : 'e2008',
  mult: 0, emult: 0, T0: 1420, month: 0, hour: 18, wto: 100, wsp: 22, rain: 0, rainS: 2, melt: 1, erode: true,
  ventMode: 'scen', customVents: null, fisA: null,
  playing: false, speed: 300, quality: +(params.get('q') || (mobile ? 2 : 1)), overlay: 0, base: 0, ex: 1.5, probCh: 0,
  show: { roads: true, rivers: false, blds: true, labels: true, fx: true, shadows: true, contours: false, snow: true, sound: false },
  gaugeSel: 0, probe: null, runTo: null, maxSteps: 30, capSteps: +(params.get('steps') || 0),
};

const setLoad = (t, f) => { $('loadtxt').textContent = t; if (f != null) $('lbar').style.width = (f * 100) + '%'; };
const fail = m => { $('loading').innerHTML = `<div><b>LLAIMA 3D</b><div class="err">${m}</div></div>`; };

let D, geo, hAt, renderer, scene, camera, controls, composer, bloom, sky, stars;
let sol, run, terr, ovl, fx, labels, ens = null, src;
const snd = new Sound();
let gaugePts = [], allPts = [], idx = {}, sites = [];
const series = { gauges: [] };
let events = [], evFlags = {};

boot().catch(e => { console.error(e); fail('No se pudo iniciar: ' + e.message); });

async function boot() {
  D = await loadData(setLoad);
  geo = makeGeo(D.GR); hAt = heightSampler(D);
  setLoad('Iniciando WebGL2 y el motor físico en GPU…', 0.65);
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance', alpha: false });
  if (!renderer.capabilities.isWebGL2) return fail('Este navegador no soporta WebGL2. Usa Chrome, Edge, Firefox o Safari recientes.');
  const gl = renderer.getContext();
  if (!gl.getExtension('EXT_color_buffer_float')) return fail('La GPU no permite render a texturas float (EXT_color_buffer_float), necesario para el motor físico.');
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.6;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.03, 3000);
  controls = new MapControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, screenSpacePanning: false, maxPolarAngle: 1.48, minDistance: 0.06, maxDistance: 170, zoomToCursor: true, zoomSpeed: 1.2, rotateSpeed: 0.6 });
  // cielo
  sky = new Sky(); sky.scale.setScalar(2000); scene.add(sky);
  stars = makeStars(); scene.add(stars);
  // satélite
  setLoad('Cargando imagen Sentinel-2 (10 m)…', 0.7);
  const satTex = await new THREE.TextureLoader().loadAsync('data/sat.jpg');
  satTex.colorSpace = THREE.SRGBColorSpace; satTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); satTex.generateMipmaps = true; satTex.minFilter = THREE.LinearMipmapLinearFilter;
  // motor
  setLoad('Compilando el motor de simulación…', 0.8);
  sol = new Solver(renderer, D, { scale: S.quality });
  run = new Runner(sol, D);
  terr = createTerrain(D, sol, satTex, { step: mobile ? 2 : 1 });
  scene.add(terr.mesh); scene.add(terr.fluid);
  ovl = createOverlays(D, sol, hAt, terr.shared); scene.add(ovl.group);
  fx = new FX(scene, hAt);
  labels = new Labels($('labels'), camera, hAt, () => S.ex);
  // post-proceso
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.6, 0.5, 2.4); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  setupPoints(); buildLabels(); buildUI(); setupInput();
  setLoad('Preparando la escena…', 0.92);
  applyScenario(S.scen, true);
  goView('general', true);
  addEventListener('resize', onResize); onResize();
  $('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 650);
  S.playing = true; $('play').textContent = '❚❚';
  toast('Simulación iniciada · arrastra para mover, botón derecho para rotar, rueda para acercar, clic para medir');
  last = performance.now(); requestAnimationFrame(frame);
  window.APP = { fxWarm, S, run, sol, src: () => src, camera, controls, goView, applyScenario, setOverlay, flyTo, readback, terr, fx };
}

function makeStars() {
  const n = 2500, p = new Float32Array(n * 3), r = 1500;
  for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u); p[i * 3] = r * s * Math.cos(a); p[i * 3 + 1] = Math.abs(r * u); p[i * 3 + 2] = r * s * Math.sin(a); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
}

// ------------------------------------------------------------------ puntos de muestreo
function snapRiver(x, y, r = 0.45) {
  let best = null, bz = 1e9; const c = D.GR.cell;
  for (let dy = -r; dy <= r; dy += c) for (let dx = -r; dx <= r; dx += c) {
    const [i, j] = geo.cellOf(x + dx, y + dy); if (i < 0 || j < 0 || i >= D.nx || j >= D.ny) continue; const k = j * D.nx + i;
    if (!D.river[k]) continue; const z = D.dem[k] + Math.hypot(dx, dy) * 15; if (z < bz) { bz = z; best = geo.xyOf(i, j); }
  }
  return best ? { x: best[0], y: best[1] } : { x, y };
}
function setupPoints() {
  gaugePts = GAUGES.map(g => ({ ...g, ...snapRiver(g.x, g.y) }));
  const town = n => D.places.pois.find(p => p[3] === n);
  const sm = town('Santa María de Llaima');
  sites = [
    { name: 'Melipeuco (pueblo)', x: 3.09, y: -17.37 }, { name: 'Sector Truful-Truful', x: 5.2, y: -14.8 }, { name: 'Lago Conguillío', x: 7.3, y: 5.3 },
    { name: 'Captrén (R-925)', x: -3.55, y: 11.0 }, { name: 'Los Paraguas (esquí)', x: -11.58, y: 2.28 }, { name: 'Refugio Llaima', x: -6.45, y: -0.43 },
    sm ? { name: 'Santa María de Llaima', x: sm[0], y: sm[1] } : { name: 'Allipén bajo', x: -5, y: -20 },
    { name: 'Curacautín', x: -13.7, y: 28.6 }, { name: 'Malalcahuello', x: 12.94, y: 24.43 },
  ];
  rebuildSampler();
}
function rebuildSampler() {
  allPts = []; idx = {};
  const add = (k, arr) => { idx[k] = [allPts.length, arr.length]; allPts.push(...arr); };
  add('g', gaugePts); add('b', D.osm.bridges.map(b => ({ x: b[0], y: b[1] }))); add('h', ovl.bpts); add('s', sites);
  sol.makeSampler('all', allPts);
}

// ------------------------------------------------------------------ escenario
function currentVents(sc) {
  if (S.ventMode === 'crater') return [{ x: VENTS.crater.x, y: VENTS.crater.y, r: 0.15 }];
  if (S.ventMode === 'pichi') return [{ x: VENTS.pichi.x, y: VENTS.pichi.y, r: 0.15 }];
  if ((S.ventMode === 'pick' || S.ventMode === 'fis') && S.customVents) return S.customVents;
  return null;
}
function applyScenario(key, fromPreset) {
  S.scen = key; const sc = SCENARIOS[key];
  if (fromPreset) {
    S.month = sc.date[1] - 1; S.hour = sc.date[3]; S.wto = sc.wind.to; S.wsp = sc.wind.speed; S.T0 = sc.T0; S.mult = 0; S.emult = 0; S.rain = 0;
    if (S.ventMode !== 'pick' && S.ventMode !== 'fis') S.ventMode = 'scen';
    syncControls();
  }
  const vents = currentVents(sc);
  const ref = (vents && vents[0]) || (sc.vents && sc.vents[0]) || sc.fissure || { x: 0, y: 0 };
  const ventZ = hAt(ref.x, ref.y);
  src = new EruptionSource(sc, { mult: Math.pow(10, S.mult), emult: Math.pow(10, S.emult), wind: { to: S.wto, speed: S.wsp }, vents, T0: S.T0, ventZ });
  run.start(src, { month: S.month, rain: S.rain, rainStart: S.rainS, melt: S.melt, erode: S.erode ? 1 : 0 });
  fx.clear(); ovl.setVents(src.vents, S.ex);
  events = []; evFlags = {}; series.gauges = gaugePts.map(() => []); $('log').innerHTML = '';
  S.runTo = null; S.tEnd = Math.min(4 * 86400, src.tEnd + 3 * 3600);
  $('scenDesc').textContent = sc.desc;
  document.querySelectorAll('#scenList button').forEach(b => b.classList.toggle('on', b.dataset.k === key));
  buildTimelineMarks(); readback(true); updateUI(true);
}

// ------------------------------------------------------------------ iluminación astronómica
function sunPosition(ms, lat, lon) {
  const rad = Math.PI / 180, n = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  const el = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat * rad) - Math.sin(lat * rad) * Math.cos(ha));
  return { az: (az / rad + 360) % 360, el: el / rad };
}
function simDate(t) {
  const sc = SCENARIOS[S.scen]; const y = sc.date[0], m = S.month, d = sc.date[2];
  const off = (m >= 8 || m <= 2) ? -3 : -4; // hora de verano/invierno en Chile continental
  const ms = Date.UTC(y, m, d, 0, 0, 0) + (S.hour - off) * 3600000 + t * 1000;
  return { ms, off };
}
const sunDir = new THREE.Vector3(), tmpC = new THREE.Color();
let NIGHT = 0; const NIGHT_BG = new THREE.Color(0.004, 0.006, 0.012);
function updateLighting() {
  const { ms } = simDate(run.t);
  const sp = sunPosition(ms, D.GR.LAT0, D.GR.LON0);
  const el = sp.el, az = sp.az * Math.PI / 180, e = el * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
  sky.material.uniforms.sunPosition.value.copy(dir);
  const u = sky.material.uniforms; u.turbidity.value = 2.5; u.rayleigh.value = 1.8; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.78;
  const day = ss(-7, 6, el); NIGHT = 1 - day;
  sunDir.set(dir.x, Math.max(dir.y, -0.2) * S.ex, dir.z).normalize();
  const sh = terr.shared;
  sh.uSunDir.value.copy(sunDir);
  const warm = ss(0, 22, el);
  sh.uSunCol.value.setRGB(1.0, 0.55 + 0.4 * warm, 0.32 + 0.56 * warm).multiplyScalar(1.9 * ss(-1.5, 5, el));
  sh.uSkyCol.value.setRGB(0.012 + 0.30 * day, 0.016 + 0.38 * day, 0.03 + 0.52 * day);
  sh.uGroundCol.value.setRGB(0.06, 0.055, 0.045).multiplyScalar(day);
  const sunset = (1 - warm) * day;
  sh.uFogCol.value.setRGB(0.012 + 0.55 * day + 0.2 * sunset, 0.016 + 0.64 * day + 0.03 * sunset, 0.03 + 0.76 * day - 0.15 * sunset);
  sh.uFogD.value = 0.0016 + 0.004 * NIGHT;
  renderer.toneMappingExposure = 0.72 + 0.6 * NIGHT;
  stars.material.opacity = ss(0.5, 0.95, NIGHT) * 0.9;
  sky.visible = day > 0.02;
  scene.background = sky.visible ? null : NIGHT_BG;
  terr.FU.uLavaGain.value = 1.4;
  // partículas
  const sv = sunDir.clone().transformDirection(camera.matrixWorldInverse);
  fx.setLighting(sv, sh.uSunCol.value, sh.uSkyCol.value, sh.uFogCol.value, sh.uFogD.value, camera.position);
  return sp;
}

// ------------------------------------------------------------------ luces de brillo (lava, fuego, rayos)
function updateGlow(st) {
  const P = terr.shared.uGlowP.value, C = terr.shared.uGlowC.value; let n = 0;
  const set = (x, y, z, r, c, I) => { if (n >= 8) return; P[n].set(x, z / 1000 * S.ex, -y, r); C[n].set(c[0] * I, c[1] * I, c[2] * I); n++; };
  const v = src.vents[0];
  if (st && (st.fountain > 0 || st.MER > 0)) set(v.x, v.y, hAt(v.x, v.y) + 250, 3.5, [1, 0.33, 0.08], 0.35 * Math.log10(1 + st.fountain / 40) + 0.08 * Math.max(0, Math.log10(st.MER / 1e4)) + fx.boom * 0.5);
  const sp = run.sum && run.sum.spots;
  if (sp) { for (const h of sp.hot) set(h.x, h.y, hAt(h.x, h.y) + 80, 1.4, [1, 0.32, 0.07], Math.min(1.6, 0.25 * Math.log10(1 + h.w))); if (sp.fire.length) { const f = sp.fire.reduce((a, b) => b.w > a.w ? b : a); set(f.x, f.y, hAt(f.x, f.y) + 60, 1.6, [1, 0.42, 0.12], 0.6); } }
  if (fx.flash) set(fx.flash.x, fx.flash.y, fx.flash.z, 9, [0.75, 0.8, 1], 2.2);
  for (let i = n; i < 8; i++) P[i].w = 0;
}

// ------------------------------------------------------------------ lectura de resultados del motor
let lastRead = 0, smp = null;
function readback(force) {
  const sum = run.readSummary(true);
  fx.setSpots(sum.spots);
  smp = sol.sample('all');
  const g0 = idx.g[0];
  gaugePts.forEach((g, i) => { const s = smp[g0 + i]; const arr = series.gauges[i]; if (arr) { if (!arr.length || run.t - arr[arr.length - 1][0] > 20 || force) arr.push([run.t, s.fluid[0], s.fluidP[0], s.fluid[2]]); if (arr.length > 3000) arr.shift(); } });
  run.record({});
  detectEvents();
  if (S.probe) showProbe(S.probe.x, S.probe.y, true);
}
function logEv(cls, msg, t = run.t, jump = true) {
  events.push({ t, cls, msg });
  const li = document.createElement('li'); li.className = 'c-' + cls; li.innerHTML = `<b>T+${fmtT(t)}</b>${msg}`; $('log').prepend(li);
  if (jump) toast(msg, `T+${fmtT(t)}`);
  const m = document.createElement('i'); m.className = cls; m.style.left = (100 * t / S.tEnd) + '%'; m.title = msg; $('tmarks').appendChild(m);
}
function detectEvents() {
  if (!smp) return;
  const f = evFlags;
  const st = run.cur ? run.cur.state : null;
  if (st && st.MER > 50 && !f.start) { f.start = 1; const P = src.plume(st.MER); logEv('ash', `Comienza la fase explosiva: columna de ${(P.Ht / 1000).toFixed(1)} km s.n.m. (${fmtN(st.MER)} kg/s)`); }
  if (st && st.E > 0.5 && !f.lava) { f.lava = 1; logEv('lava', `Se abre la emisión de lava: ${st.E.toFixed(0)} m³/s a ${(src.T0 - 273).toFixed(0)} °C`); }
  if (st && st.MER > 50) { const P = src.plume(st.MER); if (P.collapse && !f.coll) { f.coll = 1; logEv('pdc', 'La columna colapsa: nacen corrientes de densidad piroclástica'); } }
  if (run.totals.pdc > 1e4 && !f.pdc) { f.pdc = 1; logEv('pdc', 'Corrientes piroclásticas descienden por los flancos'); }
  if (run.totals.melt > 2e4 && !f.melt) { f.melt = 1; logEv('lahar', `El contacto con el glaciar ya derritió ${fmtN(run.totals.melt)} m³ de agua: se forman lahares`); }
  if (run.totals.burning > 0.02 && !f.fire) { f.fire = 1; logEv('fire', 'Se inicia un incendio forestal por contacto con material incandescente'); }
  const g0 = idx.g[0];
  gaugePts.forEach((g, i) => {
    const s = smp[g0 + i];
    if (s.stat[1] > 0 && !f['gl' + i]) { f['gl' + i] = 1; logEv('lahar', `El lahar llega a ${g.name}`, s.stat[1] - 1); }
    if (s.stat[3] > 0 && !f['gv' + i]) { f['gv' + i] = 1; logEv('lava', `La lava llega a ${g.name}`, s.stat[3] - 1); }
    if (s.fluidP[2] > 0 && !f['gp' + i]) { f['gp' + i] = 1; logEv('pdc', `Corriente piroclástica en ${g.name}`, s.fluidP[2] - 1); }
  });
  const s0 = idx.s[0];
  sites.forEach((s, i) => { const v = smp[s0 + i]; if (v.ash[0] >= 1 && !f['sa' + i]) { f['sa' + i] = 1; logEv('ash', `Cae ceniza en ${s.name} (≥1 mm)`, v.ash[1] - 1); } if (v.ash[0] >= 100 && !f['sA' + i]) { f['sA' + i] = 1; logEv('ash', `${s.name}: más de 10 cm de ceniza, riesgo de colapso de techos livianos`); } });
  // puentes y edificios
  const [b0, nb] = idx.b; let cut = 0; for (let i = 0; i < nb; i++) { const v = smp[b0 + i]; if (v.stat[0] > 0.5 || v.stat[2] > 0.3 || v.fluidP[3] > 0.3) cut++; }
  const [h0, nh] = idx.h; let hit = 0, ashR = 0; for (let i = 0; i < nh; i++) { const v = smp[h0 + i]; if (v.stat[0] > 0.5 || v.stat[2] > 0.3 || v.fluidP[3] > 0.3) hit++; else if (v.ash[0] > 100) ashR++; }
  run.exposure = { cut, nb, hit, nh, ashR };
  for (const k of [1, 5, 10, 20, 40]) if (cut >= k && !f['bc' + k]) { f['bc' + k] = 1; logEv('lahar', `${cut} puente${cut > 1 ? 's' : ''} afectado${cut > 1 ? 's' : ''} por flujos`, run.t, k <= 5); }
  for (const k of [1, 10, 50, 100]) if (hit >= k && !f['hb' + k]) { f['hb' + k] = 1; logEv('lahar', `${hit} edificio${hit > 1 ? 's' : ''} alcanzado${hit > 1 ? 's' : ''} por flujos`); }
  // alcance de la lava
  if (run.sum && run.sum.spots) { let dm = 0; const v = src.vents[0]; for (const l of run.sum.spots.lava) dm = Math.max(dm, Math.hypot(l.x - v.x, l.y - v.y)); const km = Math.floor(dm); if (km >= 2 && km > (f.lkm || 1)) { f.lkm = km; if (km % 2 === 0 || km < 6) logEv('lava', `El frente de lava está a ~${km} km de la boca`, run.t, km % 4 === 0); } }
  if (st && !st.active && run.t > 600 && !f.end) { f.end = 1; logEv('ash', 'La fuente eruptiva se detiene; los flujos siguen evolucionando', run.t, false); }
}

// ------------------------------------------------------------------ UI
function buildUI() {
  const L = $('scenList');
  for (const [k, sc] of Object.entries(SCENARIOS)) { const b = document.createElement('button'); b.dataset.k = k; b.innerHTML = `<b>${sc.short}</b><small>${sc.name.split('·')[1] || sc.name} · ${sc.vei}</small>`; b.onclick = () => applyScenario(k, true); L.appendChild(b); }
  MONTHS.forEach((m, i) => { const o = document.createElement('option'); o.value = i; o.textContent = m[0].toUpperCase() + m.slice(1); $('month').appendChild(o); });
  const bind = (id, key, fmt, num = true) => { const el = $(id); el.addEventListener('input', () => { S[key] = num ? +el.value : el.value; if ($('o_' + id)) $('o_' + id).textContent = fmt(S[key]); }); };
  const F = {
    mult: v => '×' + Math.pow(10, v).toFixed(v < -0.5 ? 2 : 1), emult: v => '×' + Math.pow(10, v).toFixed(v < -0.5 ? 2 : 1), T0: v => (v - 273) + ' °C', hour: v => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round(v % 1 * 60)).padStart(2, '0')}`,
    wto: v => v + '° ' + dirName(v), wsp: v => v + ' m/s', rain: v => v ? v + ' mm/h' : 'sin lluvia', rainS: v => 'T+' + v + ' h', melt: v => '×' + v.toFixed(2), ex: v => '×' + v.toFixed(1), yrs: v => v + ' años',
  };
  for (const k of ['mult', 'emult', 'T0', 'hour', 'wto', 'wsp', 'rain', 'rainS', 'melt']) bind(k, k, F[k]);
  $('month').addEventListener('change', () => S.month = +$('month').value);
  $('erode').addEventListener('change', () => S.erode = $('erode').checked);
  $('apply').onclick = () => { applyScenario(S.scen, false); S.playing = true; $('play').textContent = '❚❚'; };
  $('ex').addEventListener('input', () => { S.ex = +$('ex').value; $('o_ex').textContent = F.ex(S.ex); setEx(); });
  $('o_ex').textContent = F.ex(S.ex);
  $('yrs').addEventListener('input', () => { $('o_yrs').textContent = F.yrs(+$('yrs').value); recurrence(); }); $('o_yrs').textContent = F.yrs(10);
  $('quality').value = String(S.quality);
  $('quality').addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('q', $('quality').value); u.searchParams.set('esc', S.scen); location.href = u.toString(); });
  // pestañas
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab)); updateUI(true); if (b.dataset.tab === 'hist') histChart($('cHist'), CATALOG); if (b.dataset.tab === 'prob') recurrence(); });
  // boca
  document.querySelectorAll('#ventSel button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#ventSel button').forEach(x => x.classList.toggle('on', x === b)); S.ventMode = b.dataset.v; S.fisA = null;
    const h = { scen: 'Boca(s) definidas por el escenario.', crater: 'Cráter principal, 3.125 m.', pichi: 'Cono secundario Pichillaima, 1,1 km al SSE del cráter.', pick: 'Haz clic en el mapa para ubicar la boca.', fis: 'Haz dos clics en el mapa: inicio y fin de la fisura (los conos del Llaima se alinean NNE-SSO).' }[S.ventMode];
    $('ventHint').textContent = h; document.body.classList.toggle('picking', S.ventMode === 'pick' || S.ventMode === 'fis');
    if (S.ventMode !== 'pick' && S.ventMode !== 'fis') { S.customVents = null; applyScenario(S.scen, false); }
  });
  // capas
  document.querySelectorAll('#baseSel button').forEach(b => b.onclick = () => { document.querySelectorAll('#baseSel button').forEach(x => x.classList.toggle('on', x === b)); S.base = +b.dataset.b; terr.U.uBase.value = S.base; });
  document.querySelectorAll('#ovSel button').forEach(b => b.onclick = () => setOverlay(+b.dataset.o));
  document.querySelectorAll('#probCh button').forEach(b => b.onclick = () => { document.querySelectorAll('#probCh button').forEach(x => x.classList.toggle('on', x === b)); S.probCh = +b.dataset.c; terr.U.uProbCh.value = S.probCh; if (S.overlay !== 6) setOverlay(6); else legend(); });
  const TG = [['roads', 'Caminos'], ['rivers', 'Ríos'], ['blds', 'Edificios'], ['labels', 'Etiquetas'], ['fx', 'Partículas'], ['shadows', 'Sombras'], ['contours', 'Curvas de nivel'], ['snow', 'Nieve y glaciar'], ['sound', 'Sonido']];
  for (const [k, t] of TG) { const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" ${S.show[k] ? 'checked' : ''}> ${t}`; l.querySelector('input').onchange = e => { S.show[k] = e.target.checked; applyShow(); }; $('toggles').appendChild(l); }
  applyShow();
  // sensores
  gaugePts.forEach((g, i) => { const b = document.createElement('button'); b.innerHTML = `<span>${g.name}</span><i>—</i><small>sin flujo</small>`; b.onclick = () => { S.gaugeSel = i; flyTo(g.x, g.y, 2.2, 0.9); updateUI(true); }; $('gauges').appendChild(b); });
  // vistas
  const V = [['general', 'General'], ['meli', 'Melipeuco'], ['crater', 'Cráter'], ['truful', 'Truful-Truful'], ['cong', 'Conguillío'], ['capt', 'Captrén'], ['oeste', 'Ladera oeste']];
  for (const [k, t] of V) { const b = document.createElement('button'); b.textContent = t; b.onclick = () => goView(k); $('views').appendChild(b); }
  $('home').onclick = () => goView('general');
  $('zin').onclick = () => dolly(0.6); $('zout').onclick = () => dolly(1.6);
  $('tilt').onclick = () => { const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); sph.phi = sph.phi > 0.3 ? 0.02 : 0.95; $('tilt').textContent = sph.phi < 0.3 ? '2D' : '3D'; animateCam(controls.target.clone(), controls.target.clone().add(new THREE.Vector3().setFromSpherical(sph))); };
  $('compass').onclick = () => { const off = camera.position.clone().sub(controls.target); const sph = new THREE.Spherical().setFromVector3(off); sph.theta = 0; animateCam(controls.target.clone(), controls.target.clone().add(new THREE.Vector3().setFromSpherical(sph))); };
  // tiempo
  $('play').onclick = togglePlay;
  $('reset').onclick = () => { applyScenario(S.scen, false); };
  $('speed').addEventListener('change', () => S.speed = +$('speed').value);
  const tr = $('track');
  tr.addEventListener('mousemove', e => { const r = tr.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1); const tip = $('ttip'); tip.hidden = false; tip.style.left = (f * 100) + '%'; tip.textContent = `T+${fmtT(f * S.tEnd)} · ${f * S.tEnd > run.t ? 'avanzar hasta aquí' : 'recalcular hasta aquí'}`; });
  tr.addEventListener('mouseleave', () => $('ttip').hidden = true);
  tr.addEventListener('click', e => { const r = tr.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1); const t = f * S.tEnd; if (t < run.t) applyScenario(S.scen, false); S.runTo = t; S.playing = true; $('play').textContent = '❚❚'; });
  // probabilidad
  $('ensGo').onclick = startEnsemble; $('ensStop').onclick = () => { if (ens) ens.stop(); $('ensTxt').textContent = 'Detenido.'; };
  // historia
  const HL = $('histList'); const map = { 1640: 'e1640', 1751: 'e1751', 1955: 'e1957', 1994: 'e1994', 2008: 'e2008', 2009: 'e2009' };
  for (const e of CATALOG.filter(e => e.k).reverse()) { const li = document.createElement('li'); li.innerHTML = `<b>${e.y}</b>IEV ${e.vei} · ${e.k}`; if (map[e.y]) { const b = document.createElement('button'); b.textContent = 'Simular'; b.onclick = () => { applyScenario(map[e.y], true); S.playing = true; $('play').textContent = '❚❚'; }; li.appendChild(b); } HL.appendChild(li); }
  // paneles en móvil
  $('tglL').onclick = () => $('left').classList.toggle('hide'); $('tglR').onclick = () => { $('right').classList.toggle('hide'); document.body.classList.toggle('noR', $('right').classList.contains('hide')); };
  if (mobile) { $('left').classList.add('hide'); $('right').classList.add('hide'); document.body.classList.add('noR'); }
  // buscador
  buildSearch();
  syncControls(); legend();
}
function dirName(a) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'][Math.round(((a % 360) + 360) % 360 / 22.5) % 16]; }
function syncControls() {
  const set = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event('input')); };
  set('mult', S.mult); set('emult', S.emult); set('T0', S.T0); set('hour', S.hour); set('wto', S.wto); set('wsp', S.wsp); set('rain', S.rain); set('rainS', S.rainS); set('melt', S.melt);
  $('month').value = S.month;
}
function applyShow() {
  ovl.roads.visible = S.show.roads; ovl.rivers.visible = S.show.rivers; ovl.blds.visible = S.show.blds;
  if (S.show.sound) snd.enable(); else snd.disable();
  fx.smoke.mesh.visible = fx.glow.mesh.visible = S.show.fx; terr.U.uShadows.value = S.show.shadows ? 1 : 0; terr.U.uContours.value = S.show.contours ? 1 : 0; terr.U.uSnowVis.value = S.show.snow ? 1 : 0;
}
function setEx() {
  terr.shared.uEx.value = S.ex; ovl.setRiverEx(S.ex); ovl.setVents(src.vents, S.ex);
}
function setOverlay(o) {
  S.overlay = o; terr.U.uOverlay.value = o;
  document.querySelectorAll('#ovSel button').forEach(x => x.classList.toggle('on', +x.dataset.o === o));
  if (o === 6 && (!ens || !ens.done)) toast('Calcula primero el mapa de probabilidad en la pestaña «Probabilidad»');
  legend();
}
function legend() {
  const g = (stops, a, b, title) => `<div>${title}</div><div class="lg" style="background:linear-gradient(90deg,${stops})"></div><div class="lt"><span>${a}</span><span>${b}</span></div>`;
  const hz = '#ffed8c,#ff9e33,#db3819,#73091f';
  const L = {
    0: '', 1: g(hz, '0,05 m', '30 m', 'Profundidad máxima alcanzada por el lahar'), 2: g('#d9141a,#f0a23a,#fae566', '0 min', '3 h', 'Minutos desde el inicio hasta que llega el lahar (líneas cada 10 min)'),
    3: g('#ff8c1a,#99000d', '0 m', '15 m', 'Espesor máximo de lava'), 4: g(hz, '0,1 mm', '30 cm', 'Ceniza acumulada (isolíneas: 1, 10, 100 mm)'), 5: g('#bf8cd9,#590d73', '0 m', '10 m', 'Altura máxima de la corriente piroclástica densa'),
    6: g('#2961bf,#4dbf8c,#fad94d,#e6402a,#8c0d40', '0 %', '100 %', 'Probabilidad de ' + ['lahar > 0,5 m', 'lava', 'corriente piroclástica', 'ceniza > 10 mm'][S.probCh] + (ens && ens.done ? ` (${ens.done} simulaciones)` : '')),
    7: g(hz, '0,5 kN/m', '1000 kN/m', 'Presión dinámica máx. del lahar (ρ·h·v²): daño estructural sobre ~35 kN/m'),
  };
  $('legend').innerHTML = L[S.overlay] || '';
}
function togglePlay() { S.playing = !S.playing; $('play').textContent = S.playing ? '❚❚' : '▶'; if (S.playing && run.t >= S.tEnd) applyScenario(S.scen, false); }
function buildTimelineMarks() {
  const M = $('tmarks'); M.innerHTML = '';
  const span = S.tEnd; const stepH = span > 172800 ? 24 : span > 43200 ? 6 : span > 14400 ? 2 : 1;
  for (let h = stepH; h * 3600 < span; h += stepH) { const s = document.createElement('span'); s.style.left = (100 * h * 3600 / span) + '%'; s.textContent = h >= 24 && h % 24 === 0 ? `${h / 24} d` : `${h} h`; M.appendChild(s); }
  for (const p of src.phases) { const i = document.createElement('i'); i.className = 'ph'; i.style.left = (100 * p.t0 * 60 / span) + '%'; i.title = p.MER ? 'Fase explosiva' : 'Lava'; M.appendChild(i); }
}

function kpi(label, value, hot) { return `<div class="${hot ? 'hot' : ''}"><b>${value}</b><small>${label}</small></div>`; }
let lastUI = 0;
function updateUI(force) {
  const now = performance.now(); if (!force && now - lastUI < 300) return; lastUI = now;
  const t = run.t, st = run.cur ? run.cur.state : { MER: 0, E: 0, fountain: 0 };
  $('tclock').textContent = 'T+' + fmtHMS(t);
  const { ms, off } = simDate(t); const d = new Date(ms + off * 3600000);
  $('lclock').textContent = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} hora local`;
  $('tfill').style.width = Math.min(100, 100 * t / S.tEnd) + '%';
  // fase
  const T = run.totals, P = st.MER > 50 ? src.plume(st.MER) : null;
  let ph = 'Reposo', cls = '';
  if (st.active) { cls = 'hot'; ph = P && P.collapse ? 'Colapso de columna' : st.MER > 1e7 ? 'Fase pliniana' : st.MER > 2e6 ? 'Fase subpliniana' : st.fountain > 50 ? 'Fuente de lava' : st.MER > 50 ? 'Explosiones estrombolianas' : 'Efusión de lava'; }
  else if (T.lahar > 1e4 || T.lava > 1e3) { cls = 'warn'; ph = T.lahar > 1e4 ? 'Lahares activos' : 'Lava en movimiento'; }
  else if (t > 600) ph = 'Fin de la erupción';
  if (T.pdc > 1e4) { cls = 'hot'; ph = 'Corrientes piroclásticas'; }
  $('phase').textContent = ph; $('phase').className = 'phase ' + cls;
  // KPIs
  if ($('tab-fis').classList.contains('on') || force) {
    const ex = run.exposure || { cut: 0, nb: 0, hit: 0, nh: 0, ashR: 0 };
    $('kpis').innerHTML =
      kpi('Columna (s.n.m.)', P ? (P.Ht / 1000).toFixed(1) + ' km' : '—', !!P) + kpi('Tasa de masa', st.MER > 50 ? fmtN(st.MER) + ' kg/s' : '—', st.MER > 50) +
      kpi('Efusión de lava', st.E > 0.1 ? st.E.toFixed(0) + ' m³/s' : '—', st.E > 0.1) + kpi('Lava T máx.', T.maxT > 0 ? (T.maxT - 273).toFixed(0) + ' °C' : '—', T.maxT > 0) +
      kpi('Lava en movimiento', (T.lava / 1e6).toFixed(2) + ' Mm³') + kpi('Lava solidificada', (T.depLava / 1e6).toFixed(2) + ' Mm³') +
      kpi('Agua de deshielo', (T.melt / 1e6).toFixed(2) + ' Mm³', T.melt > 1e4) + kpi('Lahar en movimiento', (T.lahar / 1e6).toFixed(2) + ' Mm³', T.lahar > 1e4) +
      kpi('Lahar: prof./vel. máx', `${T.maxH.toFixed(1)} m · ${T.maxU.toFixed(1)} m/s`) + kpi('Sedimento arrastrado', (T.sed / 1e6).toFixed(2) + ' Mm³') +
      kpi('Corriente piroclástica', (T.pdc / 1e6).toFixed(2) + ' Mm³', T.pdc > 1e3) + kpi('Tefra emitida', fmtN(run.ashMass / 1e9) + ' Mt') +
      kpi('Bosque en llamas', T.burning.toFixed(2) + ' km²', T.burning > 0) + kpi('Puentes / edificios', `${ex.cut} / ${ex.hit}`, ex.cut + ex.hit > 0) +
      kpi('Paso de tiempo', run.dt.toFixed(2) + ' s') + kpi('Pasos calculados', fmtN(run.steps));
    const sr = run.series, tMax = Math.max(t, 3600);
    lineChart($('cCol'), [{ data: sr.map(s => [s.t, s.H / 1000]), color: '#ff6a2b', label: 'Altura (km)' }, { data: sr.map(s => [s.t, s.MER > 0 ? Math.log10(s.MER) : 0]), color: '#9aa6b2', label: 'log₁₀ MER', axis: 1 }], { tMax, unit1: true, tNow: t });
    lineChart($('cVol'), [{ data: sr.map(s => [s.t, s.melt / 1e6]), color: '#7fd0ff', label: 'Deshielo' }, { data: sr.map(s => [s.t, s.lahar / 1e6]), color: '#d9a066', label: 'Lahar' }, { data: sr.map(s => [s.t, s.lava / 1e6]), color: '#ff6a2b', label: 'Lava' }, { data: sr.map(s => [s.t, s.pdc / 1e6]), color: '#c79bff', label: 'CDP' }], { tMax, tNow: t });
  }
  // sensores
  if (smp) {
    const g0 = idx.g[0]; const btns = $('gauges').children;
    gaugePts.forEach((g, i) => {
      const s = smp[g0 + i], b = btns[i]; if (!b) return;
      const h = s.fluid[0], mx = s.stat[0], arr = s.stat[1];
      b.classList.toggle('on', i === S.gaugeSel); b.classList.toggle('alarm', h > 0.3 || s.fluid[2] > 0.1 || s.fluidP[0] > 0.1);
      b.querySelector('i').textContent = s.fluid[2] > 0.05 ? `lava ${s.fluid[2].toFixed(1)} m` : s.fluidP[0] > 0.05 ? `CDP ${s.fluidP[0].toFixed(1)} m` : h > 0.02 ? `${h.toFixed(2)} m` : '—';
      b.querySelector('small').textContent = arr > 0 ? `lahar llegó a T+${fmtT(arr - 1)} · máx ${mx.toFixed(1)} m${s.ash[0] > 0.1 ? ` · ceniza ${s.ash[0].toFixed(1)} mm` : ''}` : s.ash[0] > 0.1 ? `ceniza ${s.ash[0].toFixed(1)} mm` : 'sin flujo';
    });
    const gs = series.gauges[S.gaugeSel] || [];
    $('gName').textContent = gaugePts[S.gaugeSel].name;
    lineChart($('cGauge'), [{ data: gs.map(p => [p[0], p[1]]), color: '#d9a066', label: 'Lahar (m)' }, { data: gs.map(p => [p[0], p[3]]), color: '#ff6a2b', label: 'Lava' }, { data: gs.map(p => [p[0], p[2]]), color: '#c79bff', label: 'CDP' }], { tMax: Math.max(t, 3600), tNow: t });
  }
  if (ens) updateEnsUI();
}
const fmtHMS = s => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// ------------------------------------------------------------------ probabilidad
function recurrence() {
  const N = +$('yrs').value;
  const c20 = CATALOG.filter(e => e.y >= 1900).length, rate20 = c20 / (2009 - 1900 + 1);
  const rateL = CATALOG.length / (2026 - 1640);
  const big = CATALOG.filter(e => e.vei >= 3).length / (2026 - 1640);
  const p = r => (100 * (1 - Math.exp(-r * N))).toFixed(r * N > 3 ? 0 : 1);
  // Gamma-Poisson (bayesiano) con la tasa del último siglo y el silencio de 17 años desde 2009
  const a = c20 + 0.5, b = (2026 - 1900);
  const pB = 100 * (1 - Math.pow(b / (b + N), a));
  $('pRec').innerHTML = `<div><b>${p(rate20)} %</b><small>≥1 erupción en ${N} años · ritmo 1900–2009 (${c20} erupciones)</small></div>` +
    `<div><b>${pB.toFixed(0)} %</b><small>modelo Gamma-Poisson incluyendo el reposo desde 2009</small></div>` +
    `<div><b>${p(rateL)} %</b><small>ritmo de largo plazo desde 1640 (registro antiguo incompleto)</small></div>` +
    `<div><b>${p(big)} %</b><small>≥1 erupción IEV ≥ 3 en ${N} años</small></div>`;
  const cnt = [1, 2, 3, 4].map(v => CATALOG.filter(e => e.vei === v).length);
  barChart($('cVei'), cnt.map((c, i) => ({ label: 'IEV ' + (i + 1), v: c, txt: Math.round(100 * c / CATALOG.length) + ' %', color: ['#7fb8ff', '#ffb15c', '#ff6a2b', '#d81f1f'][i] })));
}
function startEnsemble() {
  if (!ens) { ens = new Ensemble(renderer, D, hAt); ens.sol.makeSampler('sites', [...sites, ...gaugePts]); }
  ens.start(+$('ensN').value, (Date.now() & 0xffff) + 1, +$('ensT').value);
  $('ensTxt').textContent = 'Calculando…';
  terr.setAcc(ens.tex, [ens.sol.nx, ens.sol.ny], 2, 0);
}
let lastEnsUI = 0;
function updateEnsUI() {
  const now = performance.now(); if (now - lastEnsUI < 400) return; lastEnsUI = now;
  $('ensBar').style.width = (100 * ens.progress()) + '%';
  const n = ens.done;
  if (ens.active) $('ensTxt').textContent = `Simulación ${Math.min(n + 1, ens.N)} de ${ens.N}` + (ens.cur ? ` · ${ens.cur.styleName}, ${ens.cur.vk}, ${MONTHS[ens.cur.month]}, viento hacia ${dirName(ens.cur.wind.to)}` : '');
  else if (n) $('ensTxt').textContent = `Listo: ${n} simulaciones. Elige qué peligro mostrar en el mapa.`;
  terr.setAcc(ens.tex, [ens.sol.nx, ens.sol.ny], 2, n);
  if (n && n !== updateEnsUI.lastN) {
    updateEnsUI.lastN = n;
    const r = ens.sol.sample('sites', ens.tex);
    const tb = $('pSites').querySelector('tbody'); tb.innerHTML = '';
    const pc = v => `${Math.round(100 * v / n)} %`;
    const allS = [...sites, ...gaugePts];
    r.forEach((v, i) => { const a = v.fire; tb.insertAdjacentHTML('beforeend', `<tr><td>${allS[i].name}</td><td>${pc(a[0])}</td><td>${pc(a[1])}</td><td>${pc(a[2])}</td><td>${pc(a[3])}</td></tr>`); });
    if (!ens.active && S.overlay !== 6) setOverlay(6);
    legend();
  }
}

// ------------------------------------------------------------------ cámara
const VIEWS = {
  general: [[1.5, 1.6, 4], [7, 24, 44]], meli: [[3.1, 0.9, 17.4], [6.5, 3.8, 23]], crater: [[0, 4.5, 0], [2.6, 6.4, 3.4]],
  truful: [[5.5, 1.6, 11], [12.5, 7, 19]], cong: [[7.3, 1.7, -5.3], [12.5, 5.5, -0.5]], capt: [[-3.5, 1.7, -11], [-7, 6.5, -20]], oeste: [[-8, 2.2, 2], [-18, 7.5, 7]],
};
let camAnim = null;
function animateCam(target, pos, dur = 1.6) { camAnim = { t0: performance.now(), dur: dur * 1000, ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: pos }; }
function goView(k, instant) { const [t, p] = VIEWS[k]; const T = new THREE.Vector3(...t), P = new THREE.Vector3(...p); T.y *= S.ex / 1.5; P.y *= S.ex / 1.5; if (instant) { controls.target.copy(T); camera.position.copy(P); controls.update(); } else animateCam(T, P); }
function flyTo(x, y, dist = 4, tilt = 0.9) {
  const T = new THREE.Vector3(x, hAt(x, y) / 1000 * S.ex, -y);
  const off = camera.position.clone().sub(controls.target); const sph = new THREE.Spherical().setFromVector3(off); sph.radius = dist; sph.phi = tilt;
  animateCam(T, T.clone().add(new THREE.Vector3().setFromSpherical(sph)));
}
function dolly(f) { const off = camera.position.clone().sub(controls.target).multiplyScalar(f); animateCam(controls.target.clone(), controls.target.clone().add(off), 0.5); }
function stepCam() {
  if (camAnim) {
    const k = clamp((performance.now() - camAnim.t0) / camAnim.dur, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(camAnim.ft, camAnim.tt, e); camera.position.lerpVectors(camAnim.fp, camAnim.tp, e);
    const lift = Math.sin(Math.PI * e) * camAnim.fp.distanceTo(camAnim.tp) * 0.25; camera.position.y += lift;
    if (k >= 1) camAnim = null;
  }
  controls.update();
  const g = hAt(camera.position.x, -camera.position.z) / 1000 * S.ex;
  if (camera.position.y < g + 0.04) camera.position.y = g + 0.04;
  const alt = camera.position.y - g;
  camera.near = clamp(alt * 0.3, 0.004, 0.6); camera.updateProjectionMatrix();
  // brújula
  const dir = controls.target.clone().sub(camera.position); const head = Math.atan2(dir.x, -dir.z) * 180 / Math.PI;
  $('rose').setAttribute('transform', `rotate(${-head} 20 20)`);
}

// ------------------------------------------------------------------ entrada: medición y selección
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function pickTerrain(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const o = ray.ray.origin, d = ray.ray.direction; let t = 0, prev = 0;
  const above = t => { const p = o.clone().addScaledVector(d, t); return p.y - hAt(p.x, -p.z) / 1000 * S.ex; };
  let step = 0.02;
  for (let i = 0; i < 2000 && t < 250; i++) { if (above(t) < 0) { let a = prev, b = t; for (let k = 0; k < 24; k++) { const m = (a + b) / 2; if (above(m) < 0) b = m; else a = m; } const p = o.clone().addScaledVector(d, b); return { x: p.x, y: -p.z }; } prev = t; t += step; step = Math.min(0.5, step * 1.03); }
  return null;
}
function setupInput() {
  const cv = renderer.domElement; let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
    const p = pickTerrain(e.clientX, e.clientY); if (!p) return;
    if (S.ventMode === 'pick') { S.customVents = [{ x: p.x, y: p.y, r: 0.15 }]; applyScenario(S.scen, false); toast(`Boca ubicada a ${hAt(p.x, p.y).toFixed(0)} m s.n.m.`); return; }
    if (S.ventMode === 'fis') {
      if (!S.fisA) { S.fisA = p; toast('Ahora marca el otro extremo de la fisura'); return; }
      const a = S.fisA, len = Math.hypot(p.x - a.x, p.y - a.y), az = Math.atan2(p.x - a.x, p.y - a.y) * 180 / Math.PI;
      S.customVents = fissureVents((a.x + p.x) / 2, (a.y + p.y) / 2, az, Math.max(0.2, len), Math.min(8, Math.max(2, Math.round(len / 0.3))));
      S.fisA = null; applyScenario(S.scen, false); toast(`Fisura de ${(len * 1000).toFixed(0)} m, rumbo ${az.toFixed(0)}°`); return;
    }
    S.probe = { x: p.x, y: p.y, sx: e.clientX, sy: e.clientY }; showProbe(p.x, p.y);
  });
  cv.addEventListener('dblclick', e => { const p = pickTerrain(e.clientX, e.clientY); if (p) flyTo(p.x, p.y, Math.max(0.6, camera.position.distanceTo(controls.target) * 0.45), 0.85); });
  let mmT = 0;
  cv.addEventListener('pointermove', e => {
    const now = performance.now(); if (now - mmT < 60) return; mmT = now;
    const p = pickTerrain(e.clientX, e.clientY); if (!p) return;
    const [lat, lon] = geo.toLL(p.x, p.y);
    $('sLL').textContent = `${dms(lat, 'S', 'N')}  ${dms(lon, 'O', 'E')}`;
    $('sZ').textContent = `elev ${hAt(p.x, p.y).toFixed(0)} m · ${Math.hypot(p.x - src.vents[0].x, p.y - src.vents[0].y).toFixed(1)} km de la boca`;
  });
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return; if (e.code === 'Space') { e.preventDefault(); togglePlay(); } if (e.key === 'Escape') { $('probe').hidden = true; S.probe = null; } });
}
function dms(v, neg, pos) { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60; return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${v < 0 ? neg : pos}`; }

function showProbe(x, y, live) {
  sol.makeSampler('probe', [{ x, y }]);
  const r = sol.sample('probe')[0];
  const [lat, lon] = geo.toLL(x, y), z = hAt(x, y);
  const v = src.vents[0], dist = Math.hypot(x - v.x, y - v.y), brg = (Math.atan2(x - v.x, y - v.y) * 180 / Math.PI + 360) % 360;
  const [i, j] = geo.cellOf(x, y), k = j * D.nx + i;
  const f = r.fluid, st = r.stat, fp = r.fluidP, ash = r.ash, tr = r.terr, fire = r.fire;
  const row = (a, b, c = '') => `<dt>${a}</dt><dd class="${c}">${b}</dd>`;
  let h = `<button class="x" aria-label="Cerrar">×</button><h5>${dms(lat, 'S', 'N')} ${dms(lon, 'O', 'E')}</h5><dl>`;
  h += row('Elevación', `${z.toFixed(0)} m · pendiente ${D.slope[k].toFixed(0)}°`) + row('Desde la boca', `${dist.toFixed(2)} km al ${dirName(brg)}`);
  h += row('Lahar ahora', f[0] > 0.02 ? `${f[0].toFixed(2)} m · Cv ${(f[1] * 100).toFixed(0)} %` : '—', f[0] > 0.3 ? 'bad' : '');
  h += row('Lahar máximo', st[0] > 0.02 ? `${st[0].toFixed(2)} m · ${tr[2].toFixed(1)} m/s` : '—', st[0] > 0.5 ? 'bad' : st[0] > 0.05 ? 'warn' : '');
  if (st[1] > 0) h += row('Llegada del lahar', 'T+' + fmtT(st[1] - 1), 'bad');
  if (tr[3] > 0.5) h += row('Presión dinámica', `${tr[3].toFixed(0)} kN/m`, tr[3] > 35 ? 'bad' : 'warn');
  h += row('Lava ahora', f[2] > 0.02 ? `${f[2].toFixed(1)} m · ${(f[3] - 273).toFixed(0)} °C` : '—', f[2] > 0.02 ? 'bad' : '');
  if (st[2] > 0.05) h += row('Lava máxima', `${st[2].toFixed(1)} m · llegó T+${fmtT(st[3] - 1)}`, 'bad');
  if (fp[3] > 0.02) h += row('Corriente piroclástica', `máx ${fp[3].toFixed(1)} m · T+${fmtT(fp[2] - 1)}`, 'bad');
  h += row('Ceniza', ash[0] > 0.01 ? `${ash[0].toFixed(ash[0] < 1 ? 2 : 0)} mm${ash[1] > 0 ? ' · desde T+' + fmtT(ash[1] - 1) : ''}` : '—', ash[0] > 100 ? 'bad' : ash[0] > 10 ? 'warn' : '');
  if (r.terr[1] > 0.01 || D.ice[k] > 0) h += row('Nieve / hielo (agua eq.)', `${tr[1].toFixed(2)} m`);
  const dep = tr[0] - D.dem[k]; if (Math.abs(dep) > 0.05) h += row(dep > 0 ? 'Depósito nuevo' : 'Erosión / fusión', `${dep.toFixed(2)} m`);
  if (fire[1] > 0.5) h += row('Incendio', 'en llamas', 'bad'); else if (fire[2] > 0.3) h += row('Incendio', 'bosque quemado', 'warn');
  if (ens && ens.done) { ens.sol.makeSampler('probe', [{ x, y }]); const a = ens.sol.sample('probe', ens.tex)[0].fire; const n = ens.done, p = q => Math.round(100 * q / n) + ' %';
    h += row('Prob. lahar / lava', `${p(a[0])} / ${p(a[1])}`) + row('Prob. CDP / ceniza', `${p(a[2])} / ${p(a[3])}`); }
  h += '</dl>';
  const safe = st[0] < 0.05 && st[2] < 0.05 && fp[3] < 0.05;
  h += `<p class="hint">${safe ? (ash[0] > 10 ? 'Fuera de los flujos, pero con caída de ceniza importante.' : 'Hasta ahora, fuera del alcance de los flujos en esta simulación.') : 'Lugar alcanzado por flujos en esta simulación: no es un lugar seguro.'}</p>`;
  h += `<button class="add">Agregar sensor aquí</button>`;
  const el = $('probe'); el.innerHTML = h; el.hidden = false;
  if (!live) { el.style.left = clamp(S.probe.sx + 14, 8, innerWidth - 310) + 'px'; el.style.top = clamp(S.probe.sy - 40, 70, innerHeight - 380) + 'px'; }
  el.querySelector('.x').onclick = () => { el.hidden = true; S.probe = null; };
  el.querySelector('.add').onclick = () => {
    const g = { k: 'u' + gaugePts.length, name: `Sensor ${gaugePts.length - GAUGES.length + 1} (${z.toFixed(0)} m)`, x, y }; gaugePts.push(g); series.gauges.push([]);
    const b = document.createElement('button'); const iG = gaugePts.length - 1; b.innerHTML = `<span>${g.name}</span><i>—</i><small>sin flujo</small>`; b.onclick = () => { S.gaugeSel = iG; flyTo(g.x, g.y, 2.2, 0.9); updateUI(true); }; $('gauges').appendChild(b);
    labels.add(g.name, x, y, 'gauge', 2, 40); rebuildSampler(); S.gaugeSel = iG; toast('Sensor agregado: verás su hidrograma en el panel derecho');
  };
}

// ------------------------------------------------------------------ etiquetas y búsqueda
function buildLabels() {
  const seen = new Set();
  const add = (n, x, y, cls, pri, dz) => { const key = cls === 'river' ? n + '|' + Math.round(x / 4) + '|' + Math.round(y / 4) : n; if (seen.has(key)) return; seen.add(key); labels.add(n, x, y, cls, pri, dz); };
  for (const p of D.places.pois) { const [x, y, t, n, pop] = p; if (!n) continue;
    if (t === 'town') add(n, x, y, 'town', 3, 40); else if (t === 'village') add(n, x, y, 'village', 2, 40); else if (t === 'volcano') add(n, x, y, 'peak', 3, 60);
    else if (t === 'hamlet' && pop > 40) add(n, x, y, 'poi', 1, 30); else if (['ranger_station', 'helipad', 'shelter'].includes(t)) add(n, x, y, 'poi', 1, 20); }
  add('Pichillaima', VENTS.pichi.x, VENTS.pichi.y, 'peak', 2, 40);
  for (const [x, y, n] of D.osm.rivernames) add(n, x, y, 'river', 1, 10);
  for (const p of D.osm.pois) { const [x, y, t, n] = p; if (['school', 'clinic', 'hospital', 'fire_station', 'police'].includes(t) && n) add(n, x, y, 'poi', 1, 15); }
  gaugePts.forEach(g => add('◆ ' + g.name, g.x, g.y, 'gauge', 2, 40));
}
function norm(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function buildSearch() {
  const items = [];
  for (const p of D.places.pois) if (p[3]) items.push({ n: p[3], x: p[0], y: p[1], t: p[2] });
  for (const p of D.osm.pois) if (p[3]) items.push({ n: p[3], x: p[0], y: p[1], t: p[2] });
  for (const [x, y, n] of D.osm.rivernames) items.push({ n, x, y, t: 'río' });
  for (const g of gaugePts) items.push({ n: g.name, x: g.x, y: g.y, t: 'sensor' });
  items.push({ n: 'Cráter del Llaima', x: 0, y: 0, t: 'volcán' }, { n: 'Pichillaima', x: VENTS.pichi.x, y: VENTS.pichi.y, t: 'cono' });
  const T = { town: 'pueblo', village: 'villa', hamlet: 'localidad', school: 'escuela', camp_site: 'camping', lodging: 'alojamiento', ranger_station: 'guardería', volcano: 'volcán', clinic: 'salud', doctors: 'salud', hospital: 'hospital' };
  const q = $('q'), res = $('qres'); let sel = 0, list = [];
  const render = () => { res.innerHTML = ''; list.forEach((it, i) => { const b = document.createElement('button'); b.className = i === sel ? 'sel' : ''; b.innerHTML = `<span>${it.n}</span><small>${T[it.t] || it.t}</small>`; b.onmousedown = e => { e.preventDefault(); go(it); }; res.appendChild(b); }); res.hidden = !list.length; };
  const go = it => { flyTo(it.x, it.y, it.t === 'town' ? 5 : 2.5, 0.9); q.value = it.n; res.hidden = true; q.blur(); };
  q.addEventListener('input', () => { const s = norm(q.value.trim()); sel = 0; if (s.length < 2) { list = []; render(); return; } const seen = new Set(); list = items.filter(it => norm(it.n).includes(s) && !seen.has(it.n) && seen.add(it.n)).sort((a, b) => norm(a.n).indexOf(s) - norm(b.n).indexOf(s)).slice(0, 10); render(); });
  q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); render(); e.preventDefault(); } if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); } if (e.key === 'Enter' && list[sel]) go(list[sel]); });
  q.addEventListener('blur', () => setTimeout(() => res.hidden = true, 150));
}
let toastN = 0;
function toast(msg, tag) { const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = (tag ? `<b>${tag}</b>` : '') + msg; $('toasts').appendChild(el); toastN++; while ($('toasts').children.length > 3) $('toasts').firstChild.remove(); setTimeout(() => el.remove(), 5200); }

// ------------------------------------------------------------------ escala y estado
function updateStatus(fps) {
  const dist = camera.position.distanceTo(controls.target), vis = 2 * dist * Math.tan(camera.fov * Math.PI / 360), mpp = vis * 1000 / innerHeight;
  const target = mpp * 110, p = Math.pow(10, Math.floor(Math.log10(target))), n = target / p >= 5 ? 5 * p : target / p >= 2 ? 2 * p : p;
  $('scaleBar').style.width = (n / mpp) + 'px'; $('scaleTxt').textContent = n >= 1000 ? (n / 1000) + ' km' : n + ' m';
  const g = hAt(camera.position.x, -camera.position.z);
  $('sAlt').textContent = `cámara ${(camera.position.y / S.ex * 1000).toFixed(0)} m s.n.m. (${((camera.position.y / S.ex * 1000) - g).toFixed(0)} m sobre el suelo)`;
  $('sPerf').textContent = `${fps.toFixed(0)} fps · motor ${S.quality === 1 ? '60' : '120'} m · ${sol.nx}×${sol.ny}`;
}
function onResize() {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}

function fxWarm(sec) {
  const st = run.cur ? run.cur.state : null; if (!st) return;
  const P = st.MER > 50 ? src.plume(st.MER) : null;
  for (let t = 0; t < sec; t += 0.5) fx.update(0.5, { src: st, plume: P, vents: src.vents, wind: src.wind, phreatic: S.scen === 'freatica', fumarole: st.active ? 2.5 : 1 });
}
// ------------------------------------------------------------------ bucle principal
let last = 0, fpsS = 60, simRateS = 0, lastStat = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtr = Math.min(0.1, (now - last) / 1000); last = now; fpsS = fpsS * 0.95 + (1 / Math.max(dtr, 1e-3)) * 0.05;
  // simulación
  let simAdv = 0;
  if (S.playing && run.t < S.tEnd) {
    const want = S.runTo != null ? 1e9 : S.speed * dtr;
    const t0 = run.t;
    const tLim = Math.min(S.tEnd, S.runTo != null ? S.runTo : run.t + want);
    run.advance(S.maxSteps, tLim);
    simAdv = run.t - t0;
    if (S.runTo != null && run.t >= S.runTo - 1e-3) { S.runTo = null; fxWarm(90); }
    if (run.t >= S.tEnd) { S.playing = false; $('play').textContent = '▶'; toast('Fin del período simulado. Explora los resultados con las capas de análisis.'); }
    // presupuesto adaptativo de pasos por cuadro
    if (S.capSteps) S.maxSteps = S.capSteps; else if (dtr > 0.045) S.maxSteps = Math.max(2, Math.floor(S.maxSteps * 0.85)); else if (dtr < 0.025) S.maxSteps = Math.min(mobile ? 60 : 240, Math.ceil(S.maxSteps * 1.08) + 1);
  }
  simRateS = simRateS * 0.9 + (simAdv / Math.max(dtr, 1e-3)) * 0.1;
  if (ens && ens.active) ens.tick(S.playing ? 25 : 90);
  if (now - lastRead > (S.playing ? 220 : 600)) { lastRead = now; readback(false); }
  // render
  stepCam();
  terr.bind(sol); ovl.bind(sol);
  const sh = terr.shared; sh.uTime.value = now / 1000; sh.uCamPos.value.copy(camera.position); terr.U.uSimT.value = run.t;
  updateLighting();
  const st = run.cur ? run.cur.state : null;
  updateGlow(st);
  if (S.show.fx) {
    const P = st && st.MER > 50 ? src.plume(st.MER) : null;
    const visSpeed = clamp(S.playing ? Math.sqrt(Math.max(1, simRateS)) * 0.6 : 0.25, 0.25, 6);
    fx.update(dtr * visSpeed, { src: st, plume: P, vents: src.vents, wind: src.wind, phreatic: S.scen === 'freatica', fumarole: st && st.active ? 2.5 : 1 });
    fx.write(camera, S.ex);
  }
  labels.update(innerWidth, innerHeight, S.show.labels);
  if (snd.on) {
    const cp = camera.position, v = src.vents[0];
    const dk = (x, y, z) => Math.hypot(cp.x - x, (cp.y - z / 1000 * S.ex) / S.ex, cp.z + y);
    const dVent = dk(v.x, v.y, hAt(v.x, v.y));
    const sp = (run.sum && run.sum.spots) || { mud: [], lava: [] };
    let mud = 0, dMud = 99, lava = 0, dLava = 99;
    for (const m of sp.mud) { const d = dk(m.x, m.y, hAt(m.x, m.y)); if (d < dMud) { dMud = d; mud = Math.min(1, m.w / 200); } }
    for (const m of sp.lava) { const d = dk(m.x, m.y, hAt(m.x, m.y)); if (d < dLava) { dLava = d; lava = Math.min(1, m.w / 30); } }
    snd.update({ mer: st ? st.MER : 0, dVent, mud, dMud, lava, dLava, alt: cp.y / S.ex * 1000 });
    if (fx.boomEvent) { snd.boom(fx.boomEvent, dVent); fx.boomEvent = 0; }
  }
  composer.render();
  updateUI(false);
  if (now - lastStat > 250) { lastStat = now; updateStatus(fpsS); $('rate').textContent = S.playing ? `${simRateS >= 60 ? (simRateS / 60).toFixed(1) + ' min' : simRateS.toFixed(1) + ' s'} sim/s` : 'en pausa'; }
}
