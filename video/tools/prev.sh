#!/bin/bash
cd "$(dirname "$0")"
node render.js reposo --preview > ../work/prev_reposo.log 2>&1
node render.js reposo_lo --preview > ../work/prev_reposo_lo.log 2>&1
