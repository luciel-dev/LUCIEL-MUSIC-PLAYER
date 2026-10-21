#!/bin/bash
cd /workspace/aero-player-test
echo "=== test.js"; node test.js 2>&1 | tail -45
echo "=== libtest.js"; node libtest.js 2>&1 | tail -40
echo "=== scenes"; OUT=/workspace/aero-player/screenshots node scenesmoke.js 2>&1 | grep -v "GL Driver"
echo "=== filetest.js"; node filetest.js 2>&1 | tail -15
echo "=== tag-roundtrip"; node tag-roundtrip.js 2>&1 | tail -12; MEDIA=/tmp/luc/media2 node tag-roundtrip.js 2>&1 | tail -8
echo "=== corepack-test.js"; node corepack-test.js 2>&1 | tail -5
echo "=== packtest.js (packs + mini player)"; node packtest.js 2>&1 | grep -v "GL Driver" | tail -50
echo "=== stylestest.js (Lucielle Styles pack)"; node stylestest.js 2>&1 | grep -v "GL Driver" | grep -v "^PASS .* loop on stage" | tail -30
echo "=== eventtest.js (music events from audio)"; node eventtest.js 2>&1 | tail -16
echo "=== opacitytest.js (Lucielle always opaque: no flicker, solid crossfades, grid behind her)"; node opacitytest.js 2>&1 | grep -v "GL Driver"
echo "=== genres-unit.js (Lucielle Genres logic: instruments, day/night, rare odds + unlocks, weather, schema, built pack)"; node genres-unit.js 2>&1 | grep -v "^PASS" | tail -12
echo "=== genrestest.js (Lucielle Genres add-on: import, auto-switch, day/night, rare, outfit mix, instruments, weather mocked) Chrome"; node genrestest.js 2>&1 | grep -v "GL Driver" | grep -v "^PASS" | tail -20
echo "=== genrestest.js Chromium 115"; PW=/workspace/pw114/node_modules/playwright-core CHROME=/workspace/pw114/browsers/chromium-1067/chrome-linux/chrome node genrestest.js 2>&1 | grep -v "GL Driver" | grep -v "^PASS" | tail -20
echo DONE
