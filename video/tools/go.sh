#!/bin/bash
# Lanza (o reanuda tras un reinicio) todo el trabajo pendiente: cálculos y grabación
cd "$(dirname "$0")"
pgrep -f "http.server 8000" >/dev/null || (cd ../.. && setsid nohup python3 -m http.server 8000 >/dev/null 2>&1 &)
EXP="${EXP-}"
REN="${REN:-pliniana e1640 e2008 reposo e1751 reposo_lo pliniana_lo}"
if [ -n "$EXP" ] && ! pgrep -f "explore.js" >/dev/null; then
  setsid nohup bash -c "for s in $EXP; do node explore.js \$s >> ../work/explore_out.log 2>&1; done; echo \"\$(date +%T) exploración terminada\" >> ../work/render.log" >/dev/null 2>&1 &
fi
if ! pgrep -f "render.js" >/dev/null && [ -n "$REN" ]; then
  setsid nohup ./queue.sh $REN >/dev/null 2>&1 &
fi
echo lanzado
