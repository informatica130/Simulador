// Exploración: calcula un escenario, extrae datos clave y guarda vistas previas
const fs = require('fs');
const { openSession, compute } = require('./session.js');
const SC = JSON.parse(process.argv[2]);
const out = __dirname + '/../work/explore_' + SC.name; fs.mkdirSync(out, { recursive: true });
const log = (...a) => { const s = new Date().toISOString().slice(11, 19) + ' ' + a.join(' '); console.log(s); fs.appendFileSync(out + '/log.txt', s + '\n'); };
(async () => {
  const { browser, page } = await openSession({ W: 540, H: 960, esc: SC.esc, log });
  await compute(page, SC, log);
  const data = await page.evaluate(() => {
    const A = APP; A.S.playT = A.run.t; A.S.computing = false; A.player.update(A.run.t, A.run.t, A.src().tEnd + 3600); A.readback(true);
    const smp = A.smp, g0 = A.idx.g[0], s0 = A.idx.s[0];
    return {
      gauges: A.gaugePts.map((g, i) => { const s = smp[g0 + i]; return { name: g.name, x: g.x, y: g.y, maxH: s.stat[0], arr: s.stat[1] - 1, lavaMax: s.stat[2], lavaArr: s.stat[3] - 1, pdcArr: s.fluidP[2] - 1, pdcMax: s.fluidP[3], ash: s.ash[0], ashT: s.ash[1] - 1 }; }),
      sites: A.sites.map((g, i) => { const s = smp[s0 + i]; return { name: g.name, maxH: s.stat[0], arr: s.stat[1] - 1, lava: s.stat[2], pdc: s.fluidP[3], ash: s.ash[0], ashT: s.ash[1] - 1 }; }),
      events: A.events.map(e => ({ t: e.t, msg: e.msg })),
      series: A.run.series.filter((s, i) => i % 10 === 0).map(s => ({ t: s.t, H: s.H, MER: s.MER, E: s.E, lahar: s.lahar, lava: s.lava, pdc: s.pdc, melt: s.melt, maxH: s.maxH, maxU: s.maxU, ash: s.ash, burn: s.burn, exposure: s.exposure })),
      totals: A.run.totals, exposure: A.run.exposure, tEnd: A.S.tEnd,
    };
  });
  fs.writeFileSync(out + '/data.json', JSON.stringify(data, null, 1));
  log('datos guardados');
  // vistas previas
  await page.evaluate(() => { APP.composer.renderTarget1.samples = 0; APP.composer.renderTarget2.samples = 0; __REC.useVirtual(); window.__oc = document.createElement('canvas'); __oc.width = innerWidth; __oc.height = innerHeight; window.__ox = __oc.getContext('2d'); });
  for (const t of SC.previews || []) for (const v of ['general', 'meli', 'crater', 'truful']) {
    const url = await page.evaluate(({ t, v }) => { const A = APP; A.S.playT = t; A.goView(v, true); A.readback(true); A.fxWarm(20); for (let i = 0; i < 3; i++) __REC.tick(1 / 24); __ox.drawImage(document.getElementById('gl'), 0, 0); return __oc.toDataURL('image/jpeg', 0.85); }, { t, v });
    fs.writeFileSync(`${out}/p_${v}_${Math.round(t / 60)}m.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  }
  log('fin');
  await browser.close();
})().catch(e => { log('ERROR', e.stack); process.exit(1); });
