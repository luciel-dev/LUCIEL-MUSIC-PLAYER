#!/usr/bin/env python3
"""Builds the example visual pack 'Cyber Night' (see PACKS.md) from existing Lucielle art in /workspace/lucielle and the
mascot pack, then zips it with Python's zipfile (the box has no zip binary).
  out folder: /workspace/aero-player-test/packs/cyber-night      zip: /workspace/luciel-dist/example-pack.zip"""
import json, os, shutil, subprocess, zipfile
from PIL import Image, ImageOps, ImageChops
SRC = '/workspace/lucielle'; MASCOT = '/workspace/aero-player/mascot'
OUT = '/workspace/aero-player-test/packs/cyber-night'; ZIP = '/workspace/luciel-dist/example-pack.zip'
shutil.rmtree(OUT, ignore_errors=True)
for d in ['bg', 'dance', 'emotes']: os.makedirs(f'{OUT}/{d}', exist_ok=True)

def neon(im):
    """cyber grade for Lucielle: duotone violet->cyan mixed with the original, alpha kept"""
    im = im.convert('RGBA'); a = im.getchannel('A')
    duo = ImageOps.colorize(ImageOps.grayscale(im.convert('RGB')), black='#1a0640', mid='#c040ff', white='#9ffcff').convert('RGB')
    out = Image.blend(im.convert('RGB'), duo, 0.55)
    out.putalpha(a); return out

# --- backgrounds
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{SRC}/loops/bgloop-cyber.mp4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow',
                '-movflags', '+faststart', f'{OUT}/bg/cyber-night.mp4'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '2', '-i', f'{SRC}/loops/bgloop-cyber.mp4', '-frames:v', '1', '/tmp/cn-poster.png'], check=True)
poster = Image.open('/tmp/cn-poster.png').convert('RGB')
poster.save(f'{OUT}/bg/cyber-night.jpg', quality=86)
poster.resize((160, 160), Image.BILINEAR).quantize(48).convert('RGB').save(f'{OUT}/bg/cyber-night-px.png')
syn = Image.open(f'{SRC}/art/bg-synthwave.jpg').convert('RGB').resize((960, 960), Image.LANCZOS)
syn.save(f'{OUT}/bg/neon-glitch.jpg', quality=84)
syn.resize((160, 160), Image.BILINEAR).quantize(40).convert('RGB').save(f'{OUT}/bg/neon-glitch-px.png')
pxb = Image.open(f'{SRC}/art/pixel-blue.jpg').convert('RGB')
pxb.resize((768, 768), Image.NEAREST).save(f'{OUT}/bg/rooftop-pixel.jpg', quality=88)
pxb.resize((192, 192), Image.NEAREST).quantize(32).convert('RGB').save(f'{OUT}/bg/rooftop-pixel-px.png')

# --- "Neon Lucielle": tinted copies of the dance loops (sprite sheets) and a few emotes
dance = json.load(open(f'{MASCOT}/dance/dance.json')) if os.path.exists(f'{MASCOT}/dance/dance.json') else None
loops = {}
for tier, bpm in [('slow', 110.8), ('mid', 120.0), ('fast', 160.0)]:
    sh = Image.open(f'{MASCOT}/dance/{tier}-sheet.webp')
    cols, size, frames, dur = 9, 320, 73, 6.042
    fs = 160
    small = sh.resize((sh.width * fs // size, sh.height * fs // size), Image.LANCZOS)
    neon(small).save(f'{OUT}/dance/neon-{tier}.webp', quality=82, method=6)
    beats = round(dur * bpm / 60)
    loops[tier] = {'sheet': f'dance/neon-{tier}.webp', 'frames': frames, 'columns': cols, 'beats': beats, 'loopBpm': round(beats * 60 / dur, 1)}
emotes = {}
for e in ['idle', 'happy', 'love', 'surprised', 'smug', 'music']:
    neon(Image.open(f'{MASCOT}/poses/{e}.webp').resize((320, 320), Image.LANCZOS)).save(f'{OUT}/emotes/{e}.webp', quality=84, method=6)
    if e != 'idle': emotes[e] = f'emotes/{e}.webp'

# --- preview + thumbs
prev = poster.resize((512, 512), Image.LANCZOS).convert('RGBA')
luc = neon(Image.open(f'{MASCOT}/poses/music.webp').resize((400, 400), Image.LANCZOS))
prev.alpha_composite(luc, (56, 112)); prev.convert('RGB').save(f'{OUT}/preview.jpg', quality=86)
prev.convert('RGB').resize((256, 256), Image.LANCZOS).save(f'{OUT}/bg/cyber-night-thumb.jpg', quality=84)

neon_char = {'use': 'custom', 'name': 'Neon Lucielle', 'tier': 'auto', 'dance': loops, 'idle': 'emotes/idle.webp', 'emotes': emotes}
pack = {
  'format': 'luciel-pack/1', 'id': 'cyber-night', 'name': 'Cyber Night', 'author': 'pj', 'version': '1.0.0',
  'description': 'Neon Lucielle in a hologram city: a tempo-synced cyber video loop, a pixel-sorted synthwave horizon and a pixel rooftop for the Classic skin.',
  'preview': 'preview.jpg',
  'scenes': [
    {'id': 'cyber-night', 'name': 'Cyber Night', 'thumb': 'bg/cyber-night-thumb.jpg',
     'background': {'image': 'bg/cyber-night.jpg', 'video': 'bg/cyber-night.mp4', 'pixel': 'bg/cyber-night-px.png', 'loopBpm': 120, 'tempoSync': True},
     'character': neon_char,
     'effects': [{'type': 'cyber', 'intensity': 0.7}, {'type': 'rgb-split', 'intensity': 0.45}, {'type': 'scanlines', 'intensity': 0.35}],
     'particles': ['stars'],
     'reactivity': {'beatZoom': 1.5, 'bassGlow': 1.4, 'shake': 0.8, 'flash': 1.2, 'particles': 1, 'glowColor': '#29f6ff'},
     'match': {'genres': ['cyberpunk', 'darksynth', 'electro', 'night drive', 'midtempo', 'phonk'], 'moods': ['dark', 'groove'], 'bpm': [90, 150]}},
    {'id': 'neon-glitch', 'name': 'Neon Glitch',
     'background': {'image': 'bg/neon-glitch.jpg', 'pixel': 'bg/neon-glitch-px.png'},
     'character': {'use': 'lucielle', 'tier': 'auto', 'scale': 0.95, 'poses': ['music', 'smug']},
     'effects': [{'type': 'pixel-sort', 'intensity': 0.75}, {'type': 'rgb-split', 'intensity': 0.3}, {'type': 'scanlines', 'intensity': 0.2}],
     'particles': ['grid', 'stars'],
     'reactivity': {'beatZoom': 1.2, 'bassGlow': 1.1, 'glowColor': '#ff4fd8'},
     'match': {'genres': ['vaporwave', 'retrowave', 'outrun', 'future funk', 'chillwave'], 'moods': ['groove']}},
    {'id': 'rooftop-pixel', 'name': 'Neon Rooftop (Pixel)', 'pixel': True,
     'background': {'image': 'bg/rooftop-pixel.jpg', 'pixel': 'bg/rooftop-pixel-px.png'},
     'character': neon_char,
     'effects': [{'type': 'dither', 'intensity': 0.35}, {'type': 'scanlines', 'intensity': 0.3}],
     'particles': ['rain'],
     'reactivity': {'beatZoom': 0.8, 'bassGlow': 1.2, 'glowColor': '#5fe2ff'},
     'match': {'genres': ['cyberpunk', 'lofi night', 'darksynth'], 'moods': ['chill', 'sad'], 'skins': ['classic']}},
  ],
}
json.dump(pack, open(f'{OUT}/pack.json', 'w'), indent=2)
os.makedirs(os.path.dirname(ZIP), exist_ok=True)
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk(OUT):
        for f in sorted(files):
            p = os.path.join(root, f); arc = os.path.relpath(p, OUT).replace(os.sep, '/')
            z.write(p, arc, compress_type=zipfile.ZIP_STORED if arc.endswith(('.mp4', '.jpg', '.webp')) else zipfile.ZIP_DEFLATED)
print('pack files:', sum(len(f) for _, _, f in os.walk(OUT)), 'zip:', os.path.getsize(ZIP), 'bytes')
