// Sesión de navegador con el simulador bajo reloj virtual (común a exploración y render)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const CK = path.join(__dirname, '..', 'work', 'ckpt'); fs.mkdirSync(CK, { recursive: true });
// servidor local de puntos de control (la página sube y baja el estado del motor)
let ckSrv = null;
function ckServer() {
  if (ckSrv) return ckSrv;
  ckSrv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), f = path.join(CK, path.basename(u.searchParams.get('f') || 'x') + '.bin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'GET') { if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } return fs.createReadStream(f).pipe(res); }
    const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => { fs.writeFileSync(f + '.tmp', Buffer.concat(ch)); fs.renameSync(f + '.tmp', f); res.end('ok'); });
  }).listen(0);
  ckSrv.unref();
  return ckSrv;
}
const ckKey = cfg => { const c = { ...cfg }; delete c.tEnd; delete c.previews; delete c.name; return cfg.esc + '_' + crypto.createHash('md5').update(JSON.stringify(c)).digest('hex').slice(0, 8); };
const HIDE_CSS = `header,aside,.nav,.timeline,.status,.compute,.probe,.toasts,.panelbtn,.attr,.loading{display:none!important}`;
async function openSession({ W = 1080, H = 1920, esc = 'e2008', q = 2, m = 2, extra = '', log = console.log } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => log('[pageerror]', e.message));
  page.on('console', m => { const t = m.text(); if (/error|fail/i.test(t) && !/GL Driver/.test(t)) log('[console]', t.slice(0, 300)); });
  await page.addInitScript({ path: __dirname + '/shim.js' });
  await page.goto(`http://localhost:8000/index.html?q=${q}&m=${m}&esc=${esc}${extra}`);
  await page.addStyleTag({ content: HIDE_CSS });
  const srv = ckServer(); await page.evaluate(p => { window.__CKPORT = p; }, srv.address().port);
  await page.addScriptTag({ path: __dirname + '/ckpt.js' });
  const t0 = Date.now();
  while (!(await page.evaluate(() => !!window.APP))) { await page.evaluate(() => __REC.tick(0)); await page.waitForTimeout(150); }
  log(`APP lista en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return { browser, page };
}
// Configura y calcula un escenario hasta tEnd (s) con reloj real, en bloques
async function compute(page, cfg, log = console.log) {
  await page.evaluate(cfg => {
    const A = APP, S = A.S;
    if (cfg.month != null) S.month = cfg.month; if (cfg.hour != null) S.hour = cfg.hour;
    if (cfg.wto != null) S.wto = cfg.wto; if (cfg.wsp != null) S.wsp = cfg.wsp;
    if (cfg.mult != null) S.mult = cfg.mult; if (cfg.emult != null) S.emult = cfg.emult;
    if (cfg.rain != null) S.rain = cfg.rain; if (cfg.melt != null) S.melt = cfg.melt;
    if (cfg.T0 != null) S.T0 = cfg.T0;
    if (cfg.vents) { S.ventMode = 'pick'; S.customVents = cfg.vents; }
    if (cfg.overflow) S.overflow = cfg.overflow;
    A.applyScenario(cfg.esc, false);
    S.tEnd = cfg.tEnd; S.playing = false; S.playT = 0;
  }, cfg);
  const key = ckKey(cfg);
  if (fs.existsSync(path.join(CK, key + '.bin'))) {
    const t = await page.evaluate(async key => { const b = await (await fetch(`http://localhost:${__CKPORT}/?f=${key}`)).arrayBuffer(); return CKPT.restore(b); }, key);
    log(`punto de control ${key} restaurado en T+${(t / 3600).toFixed(2)} h`);
    if (process.env.NOCOMPUTE) { await page.evaluate(() => { APP.S.tEnd = APP.run.t; APP.S.computing = false; }); return; }
  }
  const saveCk = async () => { const t = await page.evaluate(async key => { const b = await CKPT.save(); await fetch(`http://localhost:${__CKPORT}/?f=${key}`, { method: 'POST', body: b }); return APP.run.t; }, key); log(`punto de control guardado T+${(t / 3600).toFixed(2)} h`); };
  const t0 = Date.now(); let lastLog = 0, lastCk = Date.now(), wrote = false;
  for (;;) {
    const r = await page.evaluate(() => { const t0 = __REC.realNow(); while (__REC.realNow() - t0 < 6000 && APP.S.computing) __REC.tick(0); return { t: APP.run.t, tEnd: APP.S.tEnd, steps: APP.run.steps, dt: APP.run.dt, c: APP.S.computing }; });
    if (Date.now() - lastLog > 60000 || !r.c) { lastLog = Date.now(); log(`cálculo ${cfg.esc}: T+${(r.t / 3600).toFixed(2)} h de ${(r.tEnd / 3600).toFixed(1)} h · pasos ${r.steps} · dt ${r.dt.toFixed(2)} s · ${((Date.now() - t0) / 60000).toFixed(1)} min`); }
    if (!r.c) break;
    if (Date.now() - lastCk > 8 * 60000) { lastCk = Date.now(); await saveCk(); wrote = true; }
    wrote = wrote || false; cfg.__ran = true;
  }
  if (cfg.__ran) await saveCk();
  delete cfg.__ran;
}
module.exports = { openSession, compute, ckKey };
