#!/bin/bash
# Graba en serie las sesiones pedidas; reintenta una vez si una sesión falla
cd "$(dirname "$0")"
for s in "$@"; do
  for try in 1 2; do
    node render.js "$s" >> ../work/queue_out.log 2>&1 && break
    echo "$(date +%T) sesión $s falló (intento $try)" >> ../work/render.log
  done
done
echo "$(date +%T) cola terminada: $*" >> ../work/render.log
