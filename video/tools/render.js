// =====================================================================
//  Grabador: abre el simulador con reloj virtual, calcula el escenario de
//  la sesión y graba cada toma cuadro a cuadro (24 fps) en bloques mp4
//  reanudables (si el proceso se corta, retoma desde el último bloque).
//  Uso: node render.js <sesión> [--only id1,id2] [--preview]
// =====================================================================
const fs = require('fs'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const { openSession, compute } = require('./session.js');
const { SESSIONS, FPS, SCEN } = require('./sessions.js');

const name = process.argv[2];
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const preview = process.argv.includes('--preview');            // sólo algunos cuadros JPG para revisar
const S = SESSIONS[name]; if (!S) { console.error('Sesión desconocida', name, Object.keys(SESSIONS)); process.exit(1); }
const ROOT = path.join(__dirname, '..', 'work');
const OUTW = 1080, OUTH = 1920, CHUNK = 48;
const log = (...a) => { const s = new Date().toISOString().slice(11, 19) + ` [${name}] ` + a.join(' '); console.log(s); fs.appendFileSync(path.join(ROOT, 'render.log'), s + '\n'); };

// receptor de cuadros (RGBA crudo) desde la página
let sink = null;
const srv = http.createServer((req, res) => {
  const ch = []; req.on('data', c => ch.push(c));
  req.on('end', () => { const b = Buffer.concat(ch); const done = () => { res.setHeader('Access-Control-Allow-Origin', '*'); res.end('ok'); }; if (sink) sink(b, done); else done(); });
}).listen(0);

function encoder(file) {
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OUTW}x${OUTH}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '11', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', file + '.part.mp4']);
  ff.stderr.on('data', d => log('ffmpeg:', d.toString().trim()));
  const closed = new Promise(r => ff.on('close', code => { if (code === 0) fs.renameSync(file + '.part.mp4', file); r(code); }));
  return { write: (b, cb) => { if (!ff.stdin.write(b)) ff.stdin.once('drain', cb); else cb(); }, end: () => { ff.stdin.end(); return closed; } };
}

(async () => {
  const shots = S.shots.filter(id => !only.length || only.includes(id));
  // ¿queda algo por grabar?
  const todo = shots.filter(id => !fs.existsSync(path.join(ROOT, 'shots', id, 'done')) || preview);
  if (!todo.length) { log('nada pendiente'); srv.close(); return; }
  const W = S.W || OUTW, H = S.H || OUTH;
  const { browser, page } = await openSession({ W, H, esc: S.scen ? SCEN[S.scen].esc : S.esc, q: 2, m: S.m || 2, extra: S.extra || '', log });
  await page.addScriptTag({ path: path.join(__dirname, 'gfx.js') });
  await page.evaluate(async () => { window.VCAT = (await import('/src/config.js')).CATALOG; });
  const dfile = path.join(ROOT, 'vdata.json'); if (fs.existsSync(dfile)) await page.evaluate(d => { window.VDATA = d; }, JSON.parse(fs.readFileSync(dfile, 'utf8')));
  await page.addScriptTag({ path: path.join(__dirname, 'core.js') });
  await page.addScriptTag({ path: path.join(__dirname, 'shots.js') });
  await page.evaluate(async ({ port, OUTW, OUTH, FPS }) => { await DIR.init({ port, OUTW, OUTH, FPS }); }, { port: srv.address().port, OUTW, OUTH, FPS });
  if (S.scen) await compute(page, { ...SCEN[S.scen] }, log);
  else await page.evaluate(() => { APP.S.computing = false; });
  const meas = await page.evaluate(() => DIR.afterCompute());
  fs.writeFileSync(path.join(ROOT, `measure_${name}.json`), JSON.stringify(meas, null, 1));
  for (const id of todo) {
    const dir = path.join(ROOT, 'shots', id); fs.mkdirSync(dir, { recursive: true });
    const n = await page.evaluate(id => DIR.setup(id), id);
    log(`toma ${id}: ${n} cuadros (${(n / FPS).toFixed(1)} s)`);
    if (preview) {
      const picks = [0, Math.floor(n * 0.33), Math.floor(n * 0.66), n - 1];
      for (const f of picks) {
        const url = await page.evaluate(f => DIR.frame(f, true), Math.min(f, n - 1));
        fs.writeFileSync(path.join(dir, `prev_${String(f).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
      }
      log(`vista previa ${id} lista`); continue;
    }
    const t0 = Date.now(); let done = 0;
    for (let c0 = 0; c0 < n; c0 += CHUNK) {
      const file = path.join(dir, `c${String(c0).padStart(5, '0')}.mp4`);
      const c1 = Math.min(n, c0 + CHUNK);
      if (fs.existsSync(file)) continue;
      // para reanudar en medio de la toma: ejecuta (sin grabar) unos cuadros previos para calentar partículas
      await page.evaluate(({ c0 }) => DIR.seek(c0), { c0 });
      const enc = encoder(file);
      sink = (b, cb) => enc.write(b, cb);
      for (let f = c0; f < c1; f++) { await page.evaluate(f => DIR.frame(f), f); done++; }
      sink = null; await enc.end();
      const el = (Date.now() - t0) / 1000;
      log(`  ${id} ${c1}/${n} · ${(el / done).toFixed(1)} s/cuadro · faltan ~${((n - c1) * el / done / 60).toFixed(0)} min`);
    }
    // une los bloques
    const list = fs.readdirSync(dir).filter(f => /^c\d+\.mp4$/.test(f)).sort();
    fs.writeFileSync(path.join(dir, 'list.txt'), list.map(f => `file '${f}'`).join('\n'));
    await new Promise(r => spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', path.join(ROOT, 'shots', id + '.mp4')]).on('close', r));
    fs.writeFileSync(path.join(dir, 'done'), String(n));
    log(`toma ${id} terminada`);
  }
  await browser.close(); srv.close();
})().catch(e => { log('ERROR', e.stack); process.exit(1); });
