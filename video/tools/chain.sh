#!/bin/bash
# Espera a que termine la grabación en curso y lanza la cola indicada
cd "$(dirname "$0")"
while pgrep -f "node render.js" >/dev/null; do sleep 20; done
exec ./queue.sh "$@"
