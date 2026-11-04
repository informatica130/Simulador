// =====================================================================
//  Núcleo del director: inicialización del render (FXAA, calidad),
//  preparación de cada toma, avance cuadro a cuadro y envío del cuadro.
// =====================================================================
(() => {
  const FXAA = {
    uniforms: { tDiffuse: { value: null }, resolution: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;
      void main(){
        vec2 rx = resolution; vec3 L = vec3(0.299, 0.587, 0.114);
        vec3 nw = texture2D(tDiffuse, vUv + vec2(-1., -1.) * rx).rgb, ne = texture2D(tDiffuse, vUv + vec2(1., -1.) * rx).rgb;
        vec3 sw = texture2D(tDiffuse, vUv + vec2(-1., 1.) * rx).rgb, se = texture2D(tDiffuse, vUv + vec2(1., 1.) * rx).rgb;
        vec4 mc = texture2D(tDiffuse, vUv); vec3 m = mc.rgb;
        float lNW = dot(nw, L), lNE = dot(ne, L), lSW = dot(sw, L), lSE = dot(se, L), lM = dot(m, L);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
        float red = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
        float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
        dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * rx;
        vec3 a = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, vUv + dir * -0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
        float lB = dot(b, L);
        gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
      }`,
  };
  let cfg, oc, ox, gl, cur = null, curId = null;
  DIR.SHOTS = {};
  DIR.shot = (id, def) => { DIR.SHOTS[id] = def; };
  DIR.init = async c => {
    cfg = c;
    const A = APP, THREE = await import('three'), { ShaderPass } = await import('three/addons/postprocessing/ShaderPass.js');
    DIR.THREE = THREE;
    await Promise.all(['800 100px "Inter Display"', '700 40px "Inter Display"', '600 40px Inter', '500 40px Inter', '600 30px "JetBrains Mono"', '500 30px "JetBrains Mono"'].map(f => document.fonts.load(f)));
    A.composer.renderTarget1.samples = 0; A.composer.renderTarget2.samples = 0;
    const fx = new ShaderPass(FXAA); fx.uniforms.resolution.value = new THREE.Vector2(1 / (innerWidth * A.S.pr), 1 / (innerHeight * A.S.pr));
    A.composer.addPass(fx); DIR.fxaa = fx;
    A.S.prMax = A.S.pr = 1; A.renderer.setPixelRatio(1); A.composer.setPixelRatio(1);
    // sin cambios automáticos de calidad, sin modo liviano
    A.S.lite = false; A.S.show.labels = false; A.S.show.arrows = false; A.S.show.roads = false; A.S.show.sound = false; A.applyShow();
    oc = document.createElement('canvas'); oc.width = cfg.OUTW; oc.height = cfg.OUTH; ox = oc.getContext('2d', { willReadFrequently: true });
    gl = document.getElementById('gl');
    await DIR.ensure();
  };
  DIR.afterCompute = () => { const A = APP; A.S.computing = false; A.S.playing = false; __REC.useVirtual(); };
  DIR.setup = id => {
    const A = APP, sh = DIR.SHOTS[id]; cur = sh; curId = id;
    A.S.show.roads = !!sh.roads; A.S.show.labels = false; A.S.show.arrows = false; A.S.show.daylight = !!sh.daylight; A.S.show.trees = sh.trees !== false; A.applyShow();
    A.setOverlay(sh.overlay || 0); A.terr.U.uBase.value = sh.base || 0;
    if (sh.hour != null) A.S.hour = sh.hour;
    DIR.look = sh.look || null;
    if (sh.init) sh.init();
    DIR.seek(0);
    return Math.round(sh.dur * cfg.FPS);
  };
  // coloca la toma en el cuadro f0 y calienta las partículas con los cuadros previos (sin grabar)
  DIR.seek = f0 => {
    const A = APP, sh = cur, warm = sh.warm ?? 3;
    const tw = Math.max(0, f0 / cfg.FPS - warm);
    step(tw, true); A.readback(true); A.fxWarm(sh.fxWarm ?? 25);
    for (let t = tw; t < f0 / cfg.FPS - 1e-6; t += 1 / cfg.FPS) step(t, true);
  };
  function step(t, silent) {
    const A = APP, S = A.S, sh = cur;
    const dt = 1 / cfg.FPS; DIR.t = t;
    if (sh.cam) DIR.applyCam(typeof sh.cam === 'function' ? sh.cam(t) : DIR.camAt(sh.cam, t, sh.camEase));
    // tiempo de simulación: la app avanza S.speed·dt dentro del cuadro; se compensa para caer exacto en simT(t)
    const simT = sh.sim ? sh.sim(t) : 0, rate = sh.rate ? sh.rate(t) : 1;
    S.playing = true; S.speed = Math.max(1, rate); S.playT = Math.max(0, simT - S.speed * dt);
    if (sh.before) sh.before(t);
    __REC.tick(dt);
  }
  DIR.frame = (f, jpeg) => {
    const sh = cur, t = f / cfg.FPS;
    step(t);
    ox.save(); ox.filter = sh.bgFilter ? sh.bgFilter(t) : 'none';
    ox.drawImage(gl, 0, 0, cfg.OUTW, cfg.OUTH); ox.restore();
    DIR.bg = oc; DIR.setCtx(ox);
    if (sh.draw) { ox.save(); sh.draw(t, ox); ox.restore(); }
    if (jpeg) return oc.toDataURL('image/jpeg', 0.9);
    const id = ox.getImageData(0, 0, cfg.OUTW, cfg.OUTH);
    return fetch(`http://localhost:${cfg.port}/f`, { method: 'POST', body: id.data.buffer }).then(() => 1);
  };
})();
