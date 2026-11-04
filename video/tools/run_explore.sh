#!/bin/bash
# corre exploraciones en serie (desacopladas del shell)
cd "$(dirname "$0")"
node explore.js '{"name":"pliniana","esc":"pliniana","tEnd":14400,"previews":[1800,5400,10800,14400]}'
node explore.js '{"name":"e1640","esc":"e1640","tEnd":14400,"previews":[1800,5400,10800,14400]}'
node explore.js '{"name":"e2008","esc":"e2008","tEnd":14400,"previews":[1800,7200,14400]}'
node explore.js '{"name":"e1751","esc":"e1751","tEnd":86400,"previews":[7200,43200,86400]}'
