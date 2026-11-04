#!/bin/bash
# Espera a que termine la cola en curso y luego graba las sesiones pedidas
cd "$(dirname "$0")"
while pgrep -f "queue.sh" | grep -qv "^$$\$"; do sleep 30; done
exec ./queue.sh "$@"
