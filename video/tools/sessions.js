// Sesiones de grabación: cada una abre el simulador, calcula un escenario y graba sus tomas
const FPS = 24;
const SESSIONS = {
  reposo: { esc: 'reposo', compute: { month: 1, tEnd: 3200 }, shots: ['s01_open', 's02_meli', 's99_end'] },
  reposo_lo: { esc: 'reposo', W: 540, H: 960, compute: { month: 1, tEnd: 3200 }, shots: ['s03_hist', 's04_types'] },
};
module.exports = { SESSIONS, FPS };
