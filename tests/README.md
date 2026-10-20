# Tests

Headless browser tests (Playwright/Chromium) for the web app: playback & formats, tag read/write round-trips,
library organisation, BPM detection, scenes, visual packs, the floater, the Lucielle Styles pack, music events
and Lucielle's opacity. `runall.sh` runs the whole suite.

Test media is generated, not committed:

```bash
python3 gen.py            # tests/media – one short file per format (mp3, flac, ogg, opus, m4a, wav, webm, wma)
python3 gen_library.py    # tests/library – a tagged multi-artist/album library
python3 gen_clicks.py     # tests/bpm – click tracks with known tempos
python3 gen_eventtrack.py out.wav  # a track with drops/quiet parts for the music-event tests
python3 gen_badpacks.py [dir]     # malformed packs for pack validation
```

Note: the scripts were written for the original build machine and use absolute paths
(`/workspace/aero-player`, `/workspace/aero-player-test`, a Playwright install in `/workspace/pwtest`).
Adjust those paths (or symlink `web/` and `tests/` there) before running.
