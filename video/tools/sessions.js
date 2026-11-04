// Sesiones de grabación: cada una abre el simulador, calcula un escenario y graba sus tomas
const FPS = 24;
// Configuración de cada escenario calculado (la misma para exploración y grabación: comparten punto de control)
const SCEN = {
  reposo: { esc: 'reposo', month: 1, tEnd: 3200 },
  pliniana: { esc: 'pliniana', tEnd: 21600 },
  e1640: { esc: 'e1640', wto: 140, tEnd: 14400 },
  e2008: { esc: 'e2008', hour: 21.3, tEnd: 14400 },
  e1751: { esc: 'e1751', tEnd: 21600 },
};
const SESSIONS = {
  reposo: { esc: 'reposo', scen: 'reposo', shots: ['s01_open', 's02_meli', 's99_end'] },
  e2008: { scen: 'e2008', shots: ['e1_title', 'e1_lava', 'e1_meli'] },
  e1751: { scen: 'e1751', shots: ['e2_flow'] },
  e1640: { scen: 'e1640', shots: ['e3_col', 'e3_ash'] },
  pliniana: { scen: 'pliniana', shots: ['e4_col', 'e4_pdc', 'e4_lahar', 'e4_arr'] },
  pliniana_lo: { W: 540, H: 960, scen: 'pliniana', shots: ['ev_meli'] },
  reposo_lo: { esc: 'reposo', W: 540, H: 960, scen: 'reposo', shots: ['s03_hist', 's04_types'] },
};
module.exports = { SESSIONS, FPS, SCEN };
