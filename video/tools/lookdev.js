// Pruebas de luz/encuadre en baja resolución: node lookdev.js '<json>'
const fs = require('fs'), path = require('path');
const { openSession, compute } = require('./session.js');
const J = JSON.parse(process.argv[2]);
const out = path.join(__dirname, '..', 'work', 'lookdev', J.name); fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, page } = await openSession({ W: J.W || 540, H: J.H || 960, esc: J.esc || 'reposo', log: console.log });
  await page.addScriptTag({ path: path.join(__dirname, 'gfx.js') });
  await page.evaluate(() => DIR.ensure());
  await compute(page, { esc: J.esc || 'reposo', month: J.month, hour: J.hour ?? 12, tEnd: J.tEnd || 60, ...(J.cfg || {}) });
  await page.evaluate(() => { const A = APP; A.S.computing = false; A.composer.renderTarget1.samples = 0; A.composer.renderTarget2.samples = 0; A.S.show.roads = false; A.S.show.labels = false; A.applyShow(); __REC.useVirtual(); window.__oc = document.createElement('canvas'); __oc.width = innerWidth; __oc.height = innerHeight; window.__ox = __oc.getContext('2d'); });
  for (const [i, v] of J.views.entries()) {
    const url = await page.evaluate(v => { const A = APP; if (v.hour != null) A.S.hour = v.hour; if (v.ov != null) A.setOverlay(v.ov); A.S.show.daylight = !!v.day; DIR.look = v.look || null; A.S.playing = false; A.S.playT = v.t || 0; DIR.applyCam(v.cam); A.readback(true); A.fxWarm(v.warm || 20); for (let k = 0; k < 3; k++) __REC.tick(1 / 24); __ox.drawImage(document.getElementById('gl'), 0, 0); return __oc.toDataURL('image/jpeg', 0.88); }, v);
    fs.writeFileSync(path.join(out, `${String(i).padStart(2, '0')}_${v.tag || ''}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    console.log('vista', i);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
