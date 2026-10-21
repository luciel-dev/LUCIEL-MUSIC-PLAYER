#!/bin/bash
# Runs the desktop tests inside a virtual X display with a window manager (openbox), so maximize/minimize/move behave like a
# real desktop. real-input-test.js clicks with xdotool (real X events through the native drag-region hit test).
cd "$(dirname "$0")/.."
exec xvfb-run -a -s "-screen 0 2560x1440x24" bash -c 'openbox >/dev/null 2>&1 & sleep 1; node test/desktop-test.js; r=$?; echo "=== real-input-test.js"; node test/real-input-test.js; r2=$?; echo "=== playback-test.js"; node test/playback-test.js; r3=$?; kill %1 2>/dev/null; [ $r -eq 0 ] && [ $r2 -eq 0 ] && [ $r3 -eq 0 ]'
