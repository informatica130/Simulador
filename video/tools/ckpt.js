// =====================================================================
//  Puntos de control del motor (lado del navegador): guarda y restaura
//  el estado completo de una simulación en curso (texturas float de la
//  GPU + estado del orquestador), para reanudar tras un corte y para que
//  las sesiones de grabación no tengan que recalcular la erupción.
// =====================================================================
(() => {
  let scratch = null, restoreMats = {}, THREE = null;
  const HDR = `precision highp float; precision highp int; precision highp sampler2D;
uniform ivec2 uN; ivec2 P(){ return ivec2(gl_FragCoord.xy); } vec4 F(sampler2D t, ivec2 p){ return texelFetch(t, clamp(p, ivec2(0), uN - 1), 0); }`;
  const restoreFS = n => HDR + Array.from({ length: n }, (_, i) => `uniform sampler2D t${i}; layout(location = ${i}) out vec4 o${i};`).join('\n') +
    `\nvoid main(){ ivec2 p = P(); ${Array.from({ length: n }, (_, i) => `o${i} = F(t${i}, p);`).join(' ')} }`;
  // grupos de estado: [nombre, objetivo de render actual, n.º de texturas]
  const groups = sol => [
    ['U', sol.mrtU[sol.cu], 4], ['F', sol.mrtF[sol.cf], 2], ['H', sol.hist[sol.ch], 2],
    ['fire', sol.fire[sol.cfi], 1], ['ash', sol.ash[sol.ca], 1],
  ];
  const texOf = (rt, i) => Array.isArray(rt.texture) ? rt.texture[i] : rt.texture;

  async function save() {
    THREE = THREE || await import('three');
    const A = APP, sol = A.sol, run = A.run, r = A.renderer;
    const W = sol.nx, H = sol.ny;
    if (!scratch) scratch = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const prev = r.getRenderTarget(), bufs = [];
    for (const [, rt, n] of groups(sol)) for (let i = 0; i < n; i++) {
      sol.mCopy.uniforms.tSrc.value = texOf(rt, i); sol.pass(sol.mCopy, scratch);
      const b = new Float32Array(W * H * 4); r.readRenderTargetPixels(scratch, 0, 0, W, H, b); bufs.push(b);
    }
    r.setRenderTarget(prev);
    const meta = {
      W, H, stepN: sol.stepN, solT: sol.t,
      run: { t: run.t, dt: run.dt, lastSrc: run.lastSrc, lastAsh: run.lastAsh, ashMass: run.ashMass, steps: run.steps, limits: run.limits, totals: run.totals, exposure: run.exposure, series: run.series },
      S: { lastRec: A.S.lastRec }, gauges: A.series.gauges,
    };
    const js = new TextEncoder().encode(JSON.stringify(meta));
    const out = new Uint8Array(8 + js.length + bufs.length * W * H * 16);
    const dv = new DataView(out.buffer); dv.setUint32(0, js.length, true); dv.setUint32(4, bufs.length, true);
    out.set(js, 8); let o = 8 + js.length; o = Math.ceil(o / 4) * 4;
    const out2 = new Uint8Array(o + bufs.length * W * H * 16); out2.set(out.subarray(0, 8 + js.length));
    for (const b of bufs) { out2.set(new Uint8Array(b.buffer), o); o += b.byteLength; }
    return out2.buffer;
  }

  async function restore(buf) {
    THREE = THREE || await import('three');
    const A = APP, sol = A.sol, run = A.run, r = A.renderer;
    const dv = new DataView(buf), jl = dv.getUint32(0, true), nb = dv.getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl)));
    const W = meta.W, H = meta.H; if (W !== sol.nx || H !== sol.ny) throw new Error('El punto de control es de otra resolución');
    let o = Math.ceil((8 + jl) / 4) * 4; const texs = [];
    for (let k = 0; k < nb; k++) { const a = new Float32Array(buf, o, W * H * 4); o += W * H * 16;
      const t = new THREE.DataTexture(a, W, H, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; texs.push(t); }
    const prev = r.getRenderTarget(); let k = 0;
    for (const [, rt, n] of groups(sol)) {
      const m = restoreMats[n] || (restoreMats[n] = sol.mk(restoreFS(n), Object.fromEntries(Array.from({ length: n }, (_, i) => ['t' + i, { value: null }]))));
      for (let i = 0; i < n; i++) m.uniforms['t' + i].value = texs[k++];
      sol.pass(m, rt);
    }
    r.setRenderTarget(prev);
    texs.forEach(t => t.dispose());
    sol.stepN = meta.stepN; if (meta.solT != null) sol.t = meta.solT;
    Object.assign(run, meta.run);
    run.updateSources(true); run.readSummary(false);
    A.S.lastRec = meta.S.lastRec; if (meta.gauges) A.series.gauges.splice(0, A.series.gauges.length, ...meta.gauges);
    A.S.computing = run.t < A.S.tEnd - 1e-3;
    return meta.run.t;
  }
  window.CKPT = { save, restore };
})();
