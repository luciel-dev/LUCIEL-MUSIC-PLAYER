# Luciel visual packs

A **visual pack** adds scenes (backgrounds, video loops, effects and optionally your own dancing character) to Luciel.
Imported scenes appear in the scene picker with a **PACK** badge and take part in **Auto** scene selection by genre / mood / tempo,
exactly like the built-in ones. The built-in scenes themselves ship as a pack (“Luciel Core”, `packs/luciel-core/pack.json`).

## Importing

* **Theme panel → Visual packs → Import .zip / Import folder**, or open **Manage packs**.
* Or **drag a `.zip` onto the player**. Folders can be dragged onto the drop zone inside the Packs manager.
* The Packs manager lists every pack with its preview, scenes (click a thumbnail to show that scene), an **On** switch,
  **Preview** (cycles through the pack’s scenes) and **Delete** (click twice to confirm). Luciel Core cannot be removed.
* Storage: the browser build keeps packs in IndexedDB; the desktop app copies them to `%APPDATA%\Luciel\packs\<id>\`
  (`~/.config/Luciel/packs` on Linux). Importing a pack with an existing id replaces it (an upgrade).

Example: `example-pack.zip` (“Cyber Night”: a tempo-synced cyber video loop with a neon custom Lucielle, a pixel-sorted
synthwave horizon, and a pixel-art rooftop that is only auto-picked in the Classic skin).

## Layout

```
my-pack/                (or the top level of my-pack.zip — one wrapping folder is fine)
  pack.json             required
  preview.jpg           shown in the Packs manager
  bg/…  dance/…  emotes/…
```

Allowed files: images `png jpg jpeg webp gif avif`, video `mp4 webm m4v`, audio `mp3 ogg opus wav m4a flac`, and `json`.
`README` / `LICENSE` / `.txt` / `.md` files and `__MACOSX` / `.DS_Store` junk are skipped.
**Anything else is refused**: no scripts, HTML, SVG, CSS, WebAssembly or executables, so a pack can never run code.
Every file’s contents must match its extension (a `.png` must really be a PNG).

Limits: zip ≤ 200 MB, unpacked pack ≤ 150 MB, one image ≤ 20 MB, one video/audio ≤ 60 MB, ≤ 400 files, ≤ 48 scenes,
`pack.json` ≤ 256 KB, ≤ 8 effects per scene. ZIP64, encrypted zips and symlinks are not supported. Paths are relative
(`bg/city.jpg`): no `..`, no absolute paths, no backslashes.

## pack.json

```jsonc
{
  "format": "luciel-pack/1",
  "id": "cyber-night",            // 2–40 chars a–z 0–9 -   (reserved: luciel-core, core, auto, builtin, luciel)
  "name": "Cyber Night",          // required, ≤ 60 chars
  "author": "pj",
  "version": "1.0.0",             // required: 1, 1.2, 1.2.3, 1.2.3-beta
  "description": "…",
  "preview": "preview.jpg",
  "scenes": [ { …scene… } ]
}
```

### Scene

```jsonc
{
  "id": "cyber-night",                     // unique inside the pack; the app uses "<packId>/<sceneId>"
  "name": "Cyber Night",
  "thumb": "bg/thumb.jpg",                 // optional picker thumbnail (default: background.image)
  "pixel": false,                          // true = a pixel-art scene for the Classic (Winamp) skin
  "themeDefault": "blue",                  // optional palette suggestion: aero | blue | red | slime
  "particles": ["stars", "rain"],          // bubbles sparkles rain embers slime smoke dust sparks feathers notes
                                           // confetti hearts petals stars zzz grid glyphs leaves steam neon
  "colors": {                              // optional colour theme, applied to the player while this scene shows
    "base": "blue",                        //   palette it starts from (aero | blue | red | slime)
    "accent": "#ff3fd0", "accent2": "#29f6ff", "glow": "#ff4fd8",   // buttons, sliders, visualiser, EQ, LEDs
    "bg": ["#3a1066", "#170634", "#06020f"],                       //   window background, light → dark
    "lcd": "#7ff9ff", "text": "#e4eeff",                           //   Classic LCD text / main text (optional)
    "frame": ["#d9c8ff", "#9f7fe0", "#5a3a9a"]                     //   Classic skin frame, light → dark (optional)
  },
  "background": {
    "image": "bg/city.jpg",                // REQUIRED: still image (also the poster for a video)
    "video": "bg/city-loop.mp4",           // optional seamless loop (mp4/webm)
    "pixel": "bg/city-px.png",             // optional low-res version used by the Classic skin's pixel stage
    "pixelVideo": "bg/city-px.mp4",        // pixel scenes: optional low-res loop (falls back to "video")
    "glow": "bg/city-glow.jpg",            // optional light map (lights on black, same framing as the image/video):
                                           //   added on top and pulsed by the bass, beat and drops
    "loopBpm": 120,                        // tempo the video loop was made at …
    "tempoSync": true,                     // … so its playback rate follows the song's tempo (default true)
    "motion": "static",                    // "drift" = slow Ken-Burns pan on a still image
    "featuresCharacter": false             // true if the art already contains a character (Lucielle is then hidden)
  },
  "character": {
    "use": "lucielle",                     // lucielle (the built-in dancer) | custom | none
    "tier": "auto",                        // auto | slow | mid | fast  (auto = from the song's BPM)
    "scale": 1,                            // 0.3–1.6
    "poses": ["music", "happy"],           // preferred built-in poses for this scene
    // custom characters:
    "name": "Neon Lucielle",
    "dance": {
      "slow": { "sheet": "dance/slow.webp", "frames": 73, "columns": 9, "loopBpm": 109.2, "beats": 11 },
      "mid":  { "sheet": "dance/mid.webp",  "frames": 73, "columns": 9, "loopBpm": 119.2, "beats": 12 },
      "fast": { "sheet": "dance/fast.webp", "frames": 73, "columns": 9, "fps": 12 },
      // or a transparent WebM loop:  { "video": "dance/fast.webm", "loopBpm": 150, "beats": 8 }
    },
    "idle": "emotes/idle.webp",            // shown while paused
    "emotes": {
      "happy": "emotes/happy.webp",        // a still (gets the built-in bob / sway / squash) …
      "headbang": { "sheet": "emotes/headbang.webp", "frames": 24, "columns": 8, "beats": 4, "loopBpm": 120 }
                                           // … or a tempo-synced sprite-sheet loop, same fields as a dance loop
    },
      // built-in names: idle happy love shy smug surprised confused flying music angry bored crying sleepy cloud cloud-sleep
      // any other name (a–z, 0–9, "-") is a custom emote and is shown through "events"
    "events": {                            // music event → emote (name from "emotes" or a built-in one)
      "start": "happy",                    //   a track starts
      "drop": "headbang",                  //   bass drop (short-term bass jumps well above the recent level)
      "hit": "shocked",                    //   sudden loud hit (sharp jump in overall level)
      "quiet": "yawn",                     //   ~2.5 s of near-silence (repeats while it stays quiet)
      "rise": "halo-spin",                 //   energy building / chorus lift
      "sad": "sad",                        //   slow (< 92 BPM) soft song, or a sad / ballad / emo genre tag at start
      "vocals": "sing"                     //   strong voice band (300 Hz–3.4 kHz) over bass and highs
    }
  },
  "effects": [                             // dither | rgb-split | datamosh | pixel-sort | scanlines | cyber
    { "type": "cyber", "intensity": 0.7 }, // intensity 0–1 (default 0.6)
    { "type": "rgb-split", "intensity": 0.45 }
  ],
  "reactivity": {                          // 0–2, 1 = normal
    "beatZoom": 1.5, "bassGlow": 1.4, "shake": 0.8, "flash": 1.2, "particles": 1,
    "glowColor": "#29f6ff",
    "beatBurst": "leaves"                  // optional particle type that bursts on strong beats (bigger on drops)
  },
  "match": {                               // Auto scene selection
    "genres": ["cyberpunk", "darksynth"],  // matched against the track's genre tag (substring, case-insensitive)
    "coverGenres": ["cyberpunk"],          // genres where this scene's art can serve as fallback cover art
    "moods": ["dark", "groove"],           // sad sleepy calm chill romantic groove happy hype angry dark
    "bpm": [90, 150], "energy": [0.2, 0.7],// optional explicit windows (otherwise taken from the moods)
    "themes": ["blue", "red"],             // only auto-pick under these palettes (optional)
    "skins": ["classic"]                   // only auto-pick in these skins (optional)
  }
}
```

**Sprite sheets**: frames run left→right, top→bottom; frame size = sheet width ÷ `columns` (rows = ⌈frames ÷ columns⌉).
Use transparent PNG/WebP. The frames are spread over `beats` beats and driven by the song’s beat clock, so the dance
stays on the beat at any tempo (`loopBpm` picks the right octave: a 160 BPM loop runs double-time on an 80 BPM song
rather than at half speed). Instead of `beats` you can give `fps` (the speed it was animated at).
In the Classic skin custom characters are pixelated automatically.

**Music events**: drop / hit outrank start / rise, which outrank quiet / sad / vocals; an event never cuts off an emote
of the same or higher rank, so ambient events don’t flicker over a headbang. Built-in moods the app shows on its own
(clicks, genre reactions, dozing) use the character’s emote of the same name when there is one, otherwise the dance /
idle art, so a custom character never switches back to the default look.

**Scene colours**: shown while the scene is on screen (main window and floater) and removed when another scene takes
over; listeners can turn them off under Settings → *Scene colours*.

**Effects**: `cyber` (hologram character + glitch), `datamosh` (block smearing on beats), `dither` (ordered Bayer dither),
`pixel-sort` (sorted streaks on beats), `rgb-split` (chromatic split that kicks on beats), `scanlines` (CRT lines).
The first of `cyber` / `datamosh` / `dither` sets the scene style; the rest are layered on top.

## Validation

Problems are listed in the Packs manager in plain words, for example

* `Scripts and executable/markup files are not allowed in packs: payload.js.`
* `scenes[0] (“pink”).background.image: file “nothere.png” is not in the pack.`
* `“bg.png” is not really a .png file (its contents don’t match the extension).`
* `pack.json is not valid JSON: …`

Warnings (unused files, unknown emotes/particles, missing author/preview…) don’t block the import.
The desktop app validates again in the main process before writing anything to disk, and serves pack files only
from the pack folder with fixed content types.

## Building a pack

`tools/make_styles_pack.py` builds *Lucielle Styles* (outfit stills on green → keyed, code-animated dance / emote
sheets; plates → seamless light / steam / leaf loops, light maps and pixel versions).
`tools/make_example_pack.py` builds the example from existing Lucielle art (Pillow + ffmpeg) and zips it with
Python’s `zipfile`; copy it as a starting point. Any normal zip tool works (deflate or store).
