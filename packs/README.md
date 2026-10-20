# Visual packs

This folder holds the **manifests** (`pack.json`) and previews of the packs that ship with Luciel.
The pack media (background loops, Lucielle dance/emote loops) is too big for git, so the ready-to-import
zips are published on the [Releases page](https://github.com/luciel-dev/LUCIEL-MUSIC-PLAYER/releases):

| Pack | Folder | Release asset |
| --- | --- | --- |
| **Lucielle Styles** – Arcade Angel, City Punk, Fall Girl (+ pixel versions), music-event emotes | `lucielle-styles/` | `lucielle-styles-pack.zip` |
| **Cyber Night** – example pack, three neon Lucielle scenes | `cyber-night/` | `example-pack.zip` |
| **Luciel Core** – the built-in scenes, described as a pack | `luciel-core/` | built into the app |

The format is documented in [`../PACKS.md`](../PACKS.md). Packs only contain images, video, audio and a
`pack.json` – never scripts.

To rebuild the zips, see `web/tools/make_styles_pack.py` and `web/tools/make_example_pack.py`.
The Android build bundles `packs/dist/lucielle-styles-pack.zip` if present (override with `LUCIEL_PACKS=/path/a.zip:/path/b.zip`).
