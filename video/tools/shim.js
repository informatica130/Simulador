// Inyectado antes de cargar la app: reloj virtual y bucle de animación controlado
// (el grabador avanza cuadro a cuadro a 30 fps exactos, sin depender del rendimiento del equipo).
(() => {
  const realNow = performance.now.bind(performance);
  const realRAF = window.requestAnimationFrame.bind(window);
  let vt = null, queue = [];
  performance.now = () => (vt == null ? realNow() : vt);
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__REC = {
    realNow, realRAF,
    get vt() { return vt; },
    useVirtual(t0) { vt = t0 ?? realNow(); },
    useReal() { vt = null; },
    // ejecuta un cuadro de la app con el reloj avanzado dt segundos
    tick(dt) { if (vt != null) vt += dt * 1000; const q = queue; queue = []; const now = performance.now(); for (const cb of q) cb(now); },
    pending() { return queue.length; },
    present() { return new Promise(r => realRAF(() => realRAF(r))); },
  };
})();
