// Sesión de navegador con el simulador bajo reloj virtual (común a exploración y render)
const { chromium } = require('playwright');
const HIDE_CSS = `header,aside,.nav,.timeline,.status,.compute,.probe,.toasts,.panelbtn,.attr,.loading{display:none!important}`;
async function openSession({ W = 1080, H = 1920, esc = 'e2008', q = 2, m = 2, extra = '', log = console.log } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => log('[pageerror]', e.message));
  page.on('console', m => { const t = m.text(); if (/error|fail/i.test(t) && !/GL Driver/.test(t)) log('[console]', t.slice(0, 300)); });
  await page.addInitScript({ path: __dirname + '/shim.js' });
  await page.goto(`http://localhost:8000/index.html?q=${q}&m=${m}&esc=${esc}${extra}`);
  await page.addStyleTag({ content: HIDE_CSS });
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
  const t0 = Date.now(); let lastLog = 0;
  for (;;) {
    const r = await page.evaluate(() => { const t0 = __REC.realNow(); while (__REC.realNow() - t0 < 6000 && APP.S.computing) __REC.tick(0); return { t: APP.run.t, tEnd: APP.S.tEnd, steps: APP.run.steps, dt: APP.run.dt, c: APP.S.computing }; });
    if (Date.now() - lastLog > 60000 || !r.c) { lastLog = Date.now(); log(`cálculo ${cfg.esc}: T+${(r.t / 3600).toFixed(2)} h de ${(r.tEnd / 3600).toFixed(1)} h · pasos ${r.steps} · dt ${r.dt.toFixed(2)} s · ${((Date.now() - t0) / 60000).toFixed(1)} min`); }
    if (!r.c) break;
  }
}
module.exports = { openSession, compute };
