#!/bin/bash
cd "$(dirname "$0")"
node explore.js ckA > ../work/cktest.log 2>&1
node explore.js ckB >> ../work/cktest.log 2>&1
echo FIN >> ../work/cktest.log
