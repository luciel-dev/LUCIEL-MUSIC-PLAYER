# Luciel

An aesthetics-first local music player in plain HTML/CSS/JS. No build step, no network, no dependencies.

## Run
- Open `index.html` in Chrome/Edge/Firefox/Safari, **or**
- `python3 -m http.server 8000` in this folder, then go to http://localhost:8000

## Features
- **Load music**: ADD (files), DIR (folder), the eject button, or drag and drop files and folders anywhere on the page. Folders are scanned recursively.
- **Formats**: anything the browser can decode, including MP3, WAV, FLAC, OGG Vorbis, Opus, M4A/AAC and WebM. The app checks each file with `canPlayType()` and marks files it can't play (e.g. WMA) as `N/A` instead of failing. A file that errors during playback is marked and skipped.
- **Metadata**: a built-in parser (`js/metadata.js`) reads ID3v1, ID3v2.2/2.3/2.4 (with APIC cover), FLAC Vorbis comments + PICTURE, Ogg Vorbis/Opus comments + METADATA_BLOCK_PICTURE, MP4/M4A iTunes atoms + covr, WAV LIST/INFO + `id3 ` chunk, and Matroska/WebM tags. It also reads sample rate, channels and bit depth. If a file has no tags, it falls back to the file name ("NN - Artist - Title").
- **Playlist**: multi-select (Ctrl/Shift), drag to reorder, Alt+↑/↓ to move, remove/clear, sort (title, artist, album/track, file, random, reverse), live search, shuffle, repeat off/all/one.
- **Persistence**: settings (theme, volume, EQ, modes, window visibility, position) are saved in localStorage. Tracks are saved in IndexedDB (so they come back after a reload) unless you turn that off in the theme menu.
- **Transport**: play/pause/stop/prev/next, seek, volume, mute, balance, elapsed/remaining time (click the classic LCD), Media Session (OS media keys, lock screen art).
- **Web Audio**: preamp + 10-band EQ (31 Hz to 16 kHz, ±12 dB) with 16 presets, optional Auto EQ based on the genre tag, a live response curve, stereo balance, and a spectrum + oscilloscope visualizer (click it or press Shift+V to switch: spectrum / scope / both / off).
- **Themes**: 4 palettes × 2 skins = 8 themes. Pick one from the Theme button, press T to cycle, or press K to switch skin.
  - Palettes: Frutiger Aero Grey, Midnight Blue, Crimson Night, Toxic Slime
  - Skins: **Aero** (glossy glass, blur, glow, blurred scene backdrops) and **Classic** (Winamp 2.x-style stacked Main/EQ/Playlist windows with an LCD marquee, 7-segment time, pixel fonts and bevelled buttons)

- **Lucielle** (mascot): a live, code-animated character on the Aero stage (left of the visualizer) and in the Classic **LUCIEL VISUALS** window as a crisp pixel sprite.
  - She idles when stopped. While playing she moves to the beat: under 90 BPM she floats gently, from 90 to 125 BPM she sways in a groove, and above 125 BPM she does a full dance loop at a playback rate locked to the BPM. Very fast tracks use a half-time feel.
  - She reacts to events:
    - surprised on a track change or a loud drop
    - love/happy and a dance loop (played once) when you favorite a track (♥ button or F)
    - happy/dance when a track finishes, a big dance at the end of the playlist
    - confused on a failed or N/A file, bored when the playlist is empty
    - sleepy, then cloud-sleep, after some time idle
    - a genre emote (metal → angry/smug, love → love, ambient → cloud)
  - Click her, or the chibi peeking over the playlist/EQ, for a random emote.
  - The Theme menu has: show/hide, size S/M/L, *Doze when idle*, and *Strict pack rules*. Strict mode follows the mascot pack manifest exactly: reactions only on events, each played once, and no timers.
- **Scenes**: a background plate plus particles behind Lucielle and the whole page. In Aero the art is blurred; in Classic it is pixelated.
  - Auto mode picks a scene from the genre tag (jazz, hip-hop, classical, pop, synthwave, rock, lo-fi, electronic, ambient). Without a tag it picks from tempo and energy (sad, sleepy, romantic, hype), and otherwise uses the palette's default.
  - Pick a scene manually in the Theme menu, with the ‹ › buttons on the stage, or with N / Shift+N.
  - Scenes are data-driven: see `art/scenes.js`, generated from `art/scenes.json`.
  - When a track has no cover, the matching scene art is used as its cover in the player, the playlist and Media Session.
- **Tempo**: real BPM detection runs offline in a worker on the decoded audio. It uses a spectral-flux onset envelope, autocorrelation, an octave check and a pulse-train phase fit. The beat grid is refined live from bass onsets. A TBPM/BPM/tmpo tag sets the tempo if present, and the beat phase is still measured from the audio. The BPM is shown as a gold badge in Aero and in the LCD in Classic.
- **Themed controls**:
  - The play orb has a gold halo ring that pulses to the beat. Bat wings flank prev/next.
  - The seek knob is a halo ring and the volume knob is a wing.
  - Buttons give off sparkles when pressed.
  - In Classic all of these are pixel versions.
- **App icon**: `icons/` holds favicon-16/32/48 and icon-180/192/512 PNGs, and `manifest.webmanifest` is included.
- **Media library** (Library button, LIB in the playlist footer, G or Alt+L): an Aero glass pane, or a Winamp-style *LUCIEL MEDIA LIBRARY* window in Classic.
  - Views:
    - **Songs**: a sortable table with title, artist, album, year, genre, BPM, time, format and plays.
    - **Artists**: track and album counts. Drill into an artist's albums, songs and "appears on".
    - **Albums**: a cover grid. Albums without a cover use the matching scene art, marked *scene art*. Album pages are ordered by disc and track and show disc headers.
    - **Genres**, **Playlists**, and a global **search** across songs, artists, albums, genres and playlists.
  - Album artist wins when present. "feat./ft./featuring/with" credits (in the artist or the title) are split out, so the featured artist gets an *appears on* entry. Albums with the compilation flag (TCMP/cpil/COMPILATION), or with 3 or more artists in one folder and no album artist, are grouped under **Various Artists**.
  - **Playlists**:
    - Create, rename, duplicate and delete them.
    - Add songs from the right-click menu, or drag rows onto a playlist in the sidebar. Drag rows to reorder; Delete removes from the playlist.
    - **Now playing (queue)** is kept separate from saved playlists. Clearing the queue never removes songs from the library.
    - **M3U/M3U8** import (matched by path, then file name, then artist/title) and export (`#EXTINF`, relative paths). Export uses a Save dialog where supported, otherwise a download.
    - **Smart playlists**: Recently added, Most played, Recently played, Favorites, By BPM range (editable min/max). Any of them can be saved as a normal playlist.
  - Play counts go up after 30 s or half the track. Last-played time is stored too. The library, playlists, play counts and tag overrides persist in IndexedDB (`luciel` v2: `tracks` + `playlists`).
- **Tag editor** (✎ on any row, EDIT, F2 or Ctrl+E; select several songs for batch mode):
  - Fields: title, artist, album, album artist, track, disc, year, genre and BPM. In batch mode only the fields you touch change.
  - **Cover**: add from a file, drag and drop, clipboard paste (button or Ctrl+V), or pick a Lucielle scene art. You can also remove the cover.
  - **Rename**: a pattern (`{artist} - {title}`, plus `{album} {albumartist} {track} {disc} {year} {genre} {bpm}`) and an *Auto-rename from tags on save* option.
  - **Writing into the file bytes** (`js/tagwriter.js`, verified by round trip with ffprobe):
    - MP3: ID3v2.3 (or v2.4 if the file already uses it) + APIC; an existing ID3v1 trailer is updated too.
    - FLAC: Vorbis comments + METADATA_BLOCK_PICTURE; other blocks are kept.
    - M4A/MP4: `ilst` atoms + `covr`. `stco`/`co64` chunk offsets are shifted when `moov` sits before `mdat`.
    - OGG, Opus, WAV, WebM, WMA: changes are kept as **library overrides** only. The dialog says so (⚠), and the table marks those songs with ✎.
  - **Saving to disk** (`js/fsx.js`):
    - Files opened through the File System Access API (Chrome/Edge: ADD, DIR, drag and drop over http(s)) are overwritten in place, and renamed with `handle.move()` where supported.
    - Otherwise a Save dialog (`showSaveFilePicker`) or a download is used.
    - Electron hook: if `window.lucielNative = { writeFile(path, bytes), rename(from, to) }` exists (e.g. via a preload script), files with a `path` are written with `fs`.
- **Video-loop scenes** (`js/scenefx.js`):
  - **Cyber Void**: a scrolling HUD grid with falling code. Seamless crossfade loop. Lucielle becomes a cyan hologram with scanlines and an RGB split that jumps on beats.
  - **Datamosh**: abstract glitch with a crossfade loop. Lucielle gets block smears, previous-frame "P-frame" bleed and pixel-sorted bands on beats and drops.
  - **Dither Moon**: a still plate animated in code with a slow pan/zoom, pointer parallax and drifting mist. It runs through a **real-time WebGL ordered dither** (Bayer 8×8, flicking to 4×4 on strong beats) whose threshold and 4-colour palette shimmer with the beat. Lucielle is rendered as 1-bit dither with ink outlines.
  - The background `<video>` is muted, looping and inline. Its `playbackRate` is nudged smoothly toward the track BPM (octave-folded, 0.75–1.35×). Lucielle is composited on top with the tempo-matched transparent dance loops: slow below 96 BPM, mid up to 126, fast above.
  - Auto mode:
    - electronic / techno / glitch / IDM / breakcore → Datamosh
    - synthwave / cyberpunk / industrial / darksynth / EBM → Cyber Void
    - chiptune / 8-bit / bitpop / lo-fi → Dither Moon
  - Fallback covers still use the illustrated scenes for those genres.
  - **Dither FX** (Theme menu) applies the colour ordered-dither shader as a post-effect over any scene, on both the stage and the page backdrop.
- Press **?** to see all keyboard shortcuts. New ones: **G** / **Alt+L** library, **F2** / **Ctrl+E** edit tags.

### Mini player (floater)
* **Mini** button in the title bar, key **O**, or the tray menu (desktop) toggles a small always-on-top player
  (cover or tempo-synced dancing Lucielle, title/artist, seek, prev/play/next, volume, pin, compact/large, back to the
  main window, close). It follows the current palette and skin live (Aero glass or Classic Winamp with pixel Lucielle).
* Click the art to switch between the cover and Lucielle; scroll over it for volume; Space / ← → / B / Z / M work while it has focus.
* Desktop: a real frameless window. Move it by dragging the song title/artist (or the striped title bar in Classic); resize from any edge (taller = large art mode). The main window hides
  to the tray while it is open (Theme → Mini player to keep it visible); position and size are remembered.
  Audio keeps playing in the main window; the floater is just a remote.
* Browser: a draggable/resizable overlay inside the page; the pop-out button moves it into a real always-on-top
  Picture-in-Picture window in Chrome/Edge 116+.

### Visual packs
* Add scenes as packs: a folder or `.zip` with a `pack.json`, images, video loops, optional custom dance sprite
  sheets / emotes, effect presets (dither, rgb-split, datamosh, pixel-sort, scanlines, cyber) and genre/mood matching.
  See **PACKS.md**. Theme → Visual packs → Import .zip / folder, or drop a zip on the player; **Manage packs** to
  enable/disable, preview or delete. The built-in scenes are the “Luciel Core” pack.
* Packs can only contain media and JSON (no scripts), are validated with readable error messages and size limits,
  and are stored in IndexedDB (browser) or the app's data folder (desktop).
* Pack characters react to the music: `character.events` maps detected events (start, drop, hit, quiet, rise, sad,
  vocals) to emotes, which can be stills or tempo-synced sprite loops. Scenes can bring a bass-pulsed light map, beat
  particle bursts (leaves, steam, neon…) and their own player colour theme (*Scene colours* in Settings).
* **Lucielle Styles** (`lucielle-styles-pack.zip`): Arcade Angel, City Punk and Fall Girl outfits with looping
  backgrounds, music-reactive emotes and pixel versions for the Classic skin.

## Layout
```
index.html
css/base.css          shared widgets, backdrop, overlays, theme cards
css/palettes.css      the 4 color palettes (CSS variables)
css/skin-aero.css     Aero glass skin layout
css/skin-classic.css  Winamp-style skin layout
js/metadata.js        tag/cover/tech-info parser
js/audio-engine.js    Web Audio graph, EQ presets
js/visualizer.js      spectrum + oscilloscope renderer (aero & pixel styles)
js/storage.js         localStorage + IndexedDB helpers
js/app.js             UI controller
js/library.js         media library: grouping, views, playlists, smart lists, M3U
js/editor.js          tag editor dialog (single + batch, cover, rename)
js/tagwriter.js       in-file tag writers: ID3v2.3/2.4+APIC, FLAC VC+PICTURE, MP4 ilst/covr
js/fsx.js             saving: File System Access handles, Save dialog, download, Electron hook
js/scenefx.js         WebGL Bayer dither, video-loop playback, cyber/datamosh/1-bit character effects
css/library.css       library window, context menu, prompts, tag editor (both skins)
fonts/                bundled OFL fonts
css/luciel.css        stage, mascot window, scene backdrop, themed buttons, peeks
js/bpm.js             BPM detection (worker) + live beat tracker
js/luciel.js          Lucielle behaviour, rig animation, scenes, particles
art/loops/            crossfade-baked H.264 background loops (cyber, datamosh), ~1 MB each
art/                  scene art: webp (1024), thumb/ (256), px/ (pixelated 192 for Classic), scenes.js/json
mascot/               poses/, rig/ (body + wing layers), dance/ (VP9-alpha webm + sprite-sheet fallback), pixel/, ui/, mascot-data.js
icons/, manifest.webmanifest
tools/                asset pipeline (python3 + Pillow + numpy/scipy + ffmpeg): matte.py, build_assets.py, build_dance.py
screenshots/          themes, scenes (incl. cyber/datamosh/dither), library views, tag editor, Classic media library
samples/              8 generated test tracks (tagged, with cover art) + generator script
```

## Limitations
- Which formats play depends on the browser. Chrome/Edge play all of the above. Safari doesn't play Ogg Vorbis in some versions. Firefox doesn't play AAC/M4A on some Linux builds that lack system codecs. ALAC, AIFF, WMA, APE and WavPack usually can't be played and are marked N/A.
- Embedded cover art isn't read for WAV, WebM or WMA, and WMA/ASF tags aren't parsed at all.
- Saved tracks use browser storage. Very large libraries can hit the storage limit; when that happens the app shows a notice and simply won't remember the extra tracks.
- Opening the app straight from the file system (`file://`) works in Chrome/Firefox. Some browsers limit IndexedDB on `file://`, so serve it over HTTP if you want tracks to be remembered.

- The Lucielle dance loops use WebM VP9 with alpha. Safari can't play that, so it uses the sprite-sheet fallback (12 fps, 320 px). In Classic she is a 4-frame pixel sprite.
- Opened from `file://`, Chrome treats local images and videos as cross-origin for WebGL and `getImageData`. The dither shader then falls back to a 2D Bayer overlay, and pixel sorting is skipped (smears still run). Serve over HTTP for the full effects. The WebGL path may log a "GPU stall due to ReadPixels" driver performance note in software-GL (headless) Chrome.
- The background loops are kept at their source resolution (480×480), upscaled and blurred or pixelated as a backdrop.
- Browsers can't overwrite files that were opened through a plain `<input type=file>`. Those edits are saved through a Save dialog or a download, and the library copy is updated either way.
- BPM detection can only pick one metrical level. A sparse beat with busy eighth-note hi-hats (for example 70 BPM with hats) may come out as double tempo (140). Tagged BPM always wins.

## Rebuilding the assets
`python3 tools/build_assets.py` (with `LUCIEL_PACK=/path/to/lucielle/mascot` and `LUCIEL_ART=/path/to/lucielle/art`) re-keys the white-background PNGs and rebuilds the rig layers, icons, pixel sprites, the scene list and `mascot/mascot-data.js`. `python3 tools/build_dance.py` re-encodes the dance loops. Background loops come from `LUCIEL_LOOPS` (default `/workspace/lucielle/loops`, `bgloop-<id>.mp4`). `build_assets.py art` bakes a 1 s crossfade into each moving loop, encodes H.264 without audio (`+faststart`), and turns a static clip into a still plate that is animated in code. To add a scene, drop `bg-<id>.jpg` (and optionally `char-<id>.png`) into the art folder, add metadata in `art/scenes.overrides.json` if needed, and rerun.
