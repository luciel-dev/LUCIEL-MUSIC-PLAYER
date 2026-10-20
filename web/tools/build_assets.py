"""Luciel asset pipeline.
  python3 tools/build_assets.py [stills] [icons] [pixel] [art]
stills : key out the pack PNGs -> mascot/poses/*.webp + layered rigs (body / left wing / right wing) + mascot/rig.json
icons  : Lucielle orb icon -> icons/*.png + manifest.webmanifest, UI peeks
pixel  : Classic pixel sprite sheet -> mascot/pixel/*.png (true low-res, nearest neighbour)
art    : scene art from ART_DIR -> art/*.webp, art/thumb, art/px + art/scenes.js (data-driven scene list)
"""
import subprocess, os, sys, json, glob, re
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(__file__))
from matte import matte

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PACK = os.environ.get('LUCIEL_PACK', '/workspace/lucielle/mascot')
ART_DIR = os.environ.get('LUCIEL_ART', '/workspace/lucielle/art')
LOOP_DIR = os.environ.get('LUCIEL_LOOPS', '/workspace/lucielle/loops')
GROW = {'angry': 4}            # per-pose outline-gap closing (angry has a gap in the hair outline)

def premul_resize(im, size):
    a = np.asarray(im).astype(np.float32); al = a[..., 3:4] / 255
    a[..., :3] *= al
    r = Image.fromarray(a.round().astype(np.uint8), 'RGBA').resize(size, Image.LANCZOS)
    r = np.asarray(r).astype(np.float32); al = np.maximum(r[..., 3:4] / 255, 1e-4)
    r[..., :3] = np.clip(r[..., :3] / al, 0, 255)
    return Image.fromarray(r.round().astype(np.uint8), 'RGBA')

def save_webp(im, path, q=90):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, alpha_quality=100, method=6)

# ------------------------------------------------------------------ rig
def split_rig(rgba):
    """Find the black bat wings (large dark filled regions) and split into body / wingL / wingR layers."""
    a = rgba.astype(np.float32); H, W = a.shape[:2]
    alpha = a[..., 3] / 255; lum = a[..., :3].mean(2)
    dark = (lum < 105) & (alpha > 0.5)
    core = ndi.binary_opening(dark, structure=np.ones((5, 5)))
    lab, n = ndi.label(core)
    area = alpha.sum()
    wings = []
    for i in range(1, n + 1):
        m = lab == i; s = m.sum()
        if s < area * 0.012: continue
        cy, cx = ndi.center_of_mass(m)
        wings.append((m, cx, cy, s))
    # halo: saturated yellow in upper part
    sat = a[..., :3].max(2) - a[..., :3].min(2)
    gold = (sat > 60) & (a[..., 0] > 170) & (a[..., 2] < 170) & (alpha > 0.5)
    gold[int(H * 0.45):] = False
    gl, gn = ndi.label(ndi.binary_dilation(gold, iterations=2))
    halo = None
    if gn:
        sizes = ndi.sum(gold, gl, range(1, gn + 1)); k = int(np.argmax(sizes)) + 1
        ys, xs = np.nonzero(gl == k)
        if len(xs) > 40: halo = dict(x=float(xs.mean()), y=float(ys.mean()), rx=float((xs.max() - xs.min()) / 2), ry=float((ys.max() - ys.min()) / 2 + 2))
    ys, xs = np.nonzero(alpha > 0.05)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    out = dict(bbox=bbox, halo=halo, wings=[])
    if len(wings) < 1: return out, None, []
    bodyc = (bbox[0] + bbox[2]) / 2
    layers = []
    body_alpha = alpha.copy()
    for m, cx, cy, s in sorted(wings, key=lambda w: w[1])[:2]:
        # grow to include outline + anti-aliasing, but only onto dark-ish pixels
        g = ndi.binary_dilation(m, iterations=5) & ((lum < 175) | (alpha < 0.95))
        g = ndi.binary_dilation(g, iterations=1) & (alpha > 0)
        soft = ndi.gaussian_filter(g.astype(np.float32), 0.8)
        side = 'L' if cx < bodyc else 'R'
        wy, wx = np.nonzero(g)
        # pivot: the wing pixels closest to the body's centre line, mid height of that edge
        inner = wx >= np.percentile(wx, 96) if side == 'L' else wx <= np.percentile(wx, 4)
        pivot = [float(wx[inner].mean()), float(wy[inner].mean())]
        wl = rgba.copy(); wl[..., 3] = (alpha * soft * 255).round().astype(np.uint8)
        box = [int(wx.min()), int(wy.min()), int(wx.max()) + 1, int(wy.max()) + 1]
        layers.append((side, Image.fromarray(wl, 'RGBA').crop(box), box, pivot))
        body_alpha = body_alpha * (1 - soft)
        out['wings'].append(dict(side=side, box=box, pivot=pivot))
    body = rgba.copy(); body[..., 3] = (np.clip(body_alpha, 0, 1) * 255).round().astype(np.uint8)
    return out, Image.fromarray(body, 'RGBA'), layers

def stills():
    jobs = [('idle', f'{PACK}/idle/mascot-idle-1024.png')] + [
        (os.path.basename(f)[len('mascot-emote-'):-len('-1024.png')], f) for f in sorted(glob.glob(f'{PACK}/emotes/*-1024.png'))]
    # supplied pose cutouts: char-<scene>.png/jpg on white
    for f in sorted(glob.glob(f'{ART_DIR}/char-*.*')):
        jobs.append(('char-' + re.sub(r'^char-|\.\w+$', '', os.path.basename(f)), f))
    rig = {}
    for name, f in jobs:
        rgb = Image.open(f).convert('RGB')
        if rgb.width != 1024: rgb = rgb.resize((1024, 1024), Image.LANCZOS)
        rgba, _ = matte(np.asarray(rgb), grow=GROW.get(name, 2))
        full = Image.fromarray(rgba, 'RGBA')
        S = 512; k = S / 1024
        save_webp(premul_resize(full, (S, S)), f'{ROOT}/mascot/poses/{name}.webp')
        info, body, layers = split_rig(rgba)
        scale = lambda v: [round(x * k, 1) for x in v]
        meta = dict(size=S, bbox=scale(info['bbox']), halo=info['halo'] and {kk: round(v * k, 1) for kk, v in info['halo'].items()}, layers=None)
        if body is not None:
            save_webp(premul_resize(body, (S, S)), f'{ROOT}/mascot/rig/{name}-body.webp')
            ls = []
            for side, im, box, pivot in layers:
                bw, bh = max(1, round(im.width * k)), max(1, round(im.height * k))
                save_webp(premul_resize(im, (bw, bh)), f'{ROOT}/mascot/rig/{name}-wing{side}.webp')
                ls.append(dict(side=side, file=f'mascot/rig/{name}-wing{side}.webp', box=scale(box), pivot=scale(pivot)))
            meta['layers'] = dict(body=f'mascot/rig/{name}-body.webp', wings=ls)
        rig[name] = meta
        print('pose', name, 'wings', len(meta['layers']['wings']) if meta['layers'] else 0, 'halo', bool(meta['halo']), flush=True)
        full.save(f'/tmp/luciel-pose-{name}.png')
    json.dump(rig, open(f'{ROOT}/mascot/rig.json', 'w'), indent=1)

# ------------------------------------------------------------------ icons
def orb(size, c1=(214, 242, 255), c2=(58, 166, 244), c3=(10, 90, 168)):
    y, x = np.mgrid[0:size, 0:size] / size
    d = np.sqrt((x - .5) ** 2 + (y - .32) ** 2) / .75
    t = np.clip(d, 0, 1)[..., None]
    col = np.where(t < .55, np.array(c1) * (1 - t / .55) + np.array(c2) * (t / .55), np.array(c2) * (1 - (t - .55) / .45) + np.array(c3) * ((t - .55) / .45))
    r = np.sqrt((x - .5) ** 2 + (y - .5) ** 2)
    a = np.clip((0.5 - r) * size * 1.2, 0, 1)
    return Image.fromarray(np.dstack([col, a * 255]).astype(np.uint8), 'RGBA')

def icons():
    full = Image.open('/tmp/luciel-pose-idle.png') if os.path.exists('/tmp/luciel-pose-idle.png') else None
    if full is None:
        rgba, _ = matte(np.asarray(Image.open(f'{PACK}/idle/mascot-idle-1024.png').convert('RGB'))); full = Image.fromarray(rgba, 'RGBA')
    os.makedirs(f'{ROOT}/icons', exist_ok=True); os.makedirs(f'{ROOT}/img', exist_ok=True)
    def gloss(out, S):
        gl = Image.new('L', (S, S), 0); ImageDraw.Draw(gl).ellipse((int(S*.18), int(S*.035), int(S*.82), int(S*.45)), fill=110)
        gl = gl.filter(ImageFilter.GaussianBlur(S / 36))
        white = Image.new('RGBA', (S, S), (255, 255, 255, 0)); white.putalpha(gl); out.alpha_composite(white)
        ring = Image.new('RGBA', (S, S), (0, 0, 0, 0)); ImageDraw.Draw(ring).ellipse((S*.012, S*.012, S*.988, S*.988), outline=(255, 255, 255, 170), width=max(1, int(S/64)))
        out.alpha_composite(ring)
    def make(size, tiny=False):
        S = 512
        base = orb(S)
        canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0)); canvas.alpha_composite(base)
        if not tiny:
            crop = premul_resize(full.crop((182, 10, 842, 670)), (420, 420))   # halo, face, wings, shoulders
            canvas.alpha_composite(crop, (46, 40))
        else:
            # simplified glyph for 16-48 px: gold halo + white face/hair + eyes + tiny wings
            d = ImageDraw.Draw(canvas)
            d.polygon([(150, 300), (40, 250), (80, 330), (60, 390), (160, 360)], fill=(30, 30, 40, 255))
            d.polygon([(362, 300), (472, 250), (432, 330), (452, 390), (352, 360)], fill=(30, 30, 40, 255))
            ink = (70, 70, 85, 255); hair = (250, 248, 246, 255)
            d.rounded_rectangle((118, 118, 394, 486), radius=120, fill=hair, outline=ink, width=12)
            d.ellipse((168, 196, 344, 392), fill=(255, 234, 224, 255), outline=ink, width=8)
            zig = [(160, 190)] + [(168 + i * 22, 262 if i % 2 else 240) for i in range(9)] + [(352, 190)]
            d.polygon(zig, fill=hair)
            d.line([(166, 200), (166, 400)], fill=ink, width=8); d.line([(346, 200), (346, 400)], fill=ink, width=8)
            d.ellipse((194, 276, 238, 330), fill=(84, 80, 88, 255)); d.ellipse((274, 276, 318, 330), fill=(84, 80, 88, 255))
            d.ellipse((204, 284, 218, 298), fill=(255, 255, 255, 255)); d.ellipse((284, 284, 298, 298), fill=(255, 255, 255, 255))
            d.ellipse((182, 330, 214, 348), fill=(255, 180, 190, 255)); d.ellipse((298, 330, 330, 348), fill=(255, 180, 190, 255))
            d.line([(246, 356), (266, 356)], fill=(220, 120, 130, 255), width=6)
            d.ellipse((150, 40, 362, 120), outline=(255, 205, 60, 255), width=26)
            d.ellipse((150, 40, 362, 120), outline=(255, 245, 190, 255), width=8)
        m = base.getchannel('A')
        out = Image.new('RGBA', (S, S), (0, 0, 0, 0)); out.paste(canvas, (0, 0), m)
        gloss(out, S)
        r = premul_resize(out, (size, size))
        if size <= 32: r = r.filter(ImageFilter.UnsharpMask(1, 80, 2))
        return r
    for s in (16, 32, 48):
        make(s, tiny=True).save(f'{ROOT}/icons/favicon-{s}.png')
    for s in (180, 192, 512):
        make(s).save(f'{ROOT}/icons/icon-{s}.png')
    make(64, tiny=True).save(f'{ROOT}/img/icon-64.png')
    json.dump(dict(name='Luciel', short_name='Luciel', start_url='./index.html', display='standalone', background_color='#0b2340', theme_color='#3aa6f4',
                   icons=[dict(src='icons/icon-192.png', sizes='192x192', type='image/png'), dict(src='icons/icon-512.png', sizes='512x512', type='image/png', purpose='any maskable'),
                          dict(src='icons/favicon-48.png', sizes='48x48', type='image/png')]), open(f'{ROOT}/manifest.webmanifest', 'w'), indent=1)
    # UI peek: head over a window edge (chin cut)
    peek = premul_resize(full.crop((250, 0, 774, 470)), (180, 161))
    save_webp(peek, f'{ROOT}/mascot/ui/peek.webp')
    print('icons ok')

# ------------------------------------------------------------------ pixel sprite
def pixel():
    src = Image.open(f'{ART_DIR}/pixel-sprite-sheet.jpg').convert('RGB')
    W, H = src.size; cw, ch = W // 4, H // 2
    out = {}
    os.makedirs(f'{ROOT}/mascot/pixel', exist_ok=True)
    frames_all = []
    for row in range(2):
        for col in range(4):
            cell = np.asarray(src.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)))
            rgba, _ = matte(cell, line_t=45, grow=2)
            frames_all.append(Image.fromarray(rgba, 'RGBA'))
    # common bbox so frames stay registered
    boxes = [f.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox() for f in frames_all]
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes); x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
    TH = 64; k = TH / (y1 - y0); TW = int(round((x1 - x0) * k)); TW += TW % 2
    for name, row in (('idle', 0), ('dance', 1)):
        sheet = Image.new('RGBA', (TW * 4, TH), (0, 0, 0, 0))
        for i in range(4):
            f = frames_all[row * 4 + i].crop((x0, y0, x1, y1))
            # area-average downscale, then snap: hard alpha + limited palette = clean pixel grid
            small = premul_resize(f, (TW, TH))
            arr = np.asarray(small).copy()
            arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0)
            rgb = Image.fromarray(arr[..., :3]).quantize(colors=24, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB')
            px = np.dstack([np.asarray(rgb), arr[..., 3]])
            sheet.paste(Image.fromarray(px.astype(np.uint8), 'RGBA'), (i * TW, 0))
        sheet.save(f'{ROOT}/mascot/pixel/{name}.png')
        out[name] = dict(file=f'mascot/pixel/{name}.png', frames=4, w=TW, h=TH)
    # pixel peek (head of frame 0) and pixel wing / halo glyphs for buttons
    head = Image.open(f'{ROOT}/mascot/pixel/idle.png').crop((0, 0, TW, int(TH * 0.42)))
    head.save(f'{ROOT}/mascot/pixel/peek.png')
    json.dump(out, open(f'{ROOT}/mascot/pixel/pixel.json', 'w'), indent=1)
    print('pixel', out)

# ------------------------------------------------------------------ art + scenes
PARTICLES = {  # scene id -> particles
    'aero-ambient': ['bubbles', 'sparkles'], 'blue-lofi': ['rain'], 'red-rock': ['embers'], 'slime-rave': ['slime', 'sparkles'],
    'jazz': ['smoke', 'dust'], 'hiphop': ['sparks'], 'classical': ['feathers', 'notes'], 'pop': ['confetti', 'hearts'],
    'synthwave': ['grid', 'stars'], 'mood-sad': ['rain'], 'mood-hype': ['confetti', 'embers'], 'mood-romantic': ['petals', 'hearts'],
    'mood-sleepy': ['stars', 'zzz'],
}
SCENE_META = {
    'aero-ambient': dict(name='Bubble Meadow', palette='aero', genres=['ambient', 'new age', 'chill', 'downtempo', 'meditative'], moods=['calm']),
    'blue-lofi': dict(name='Rainy Rooftop', palette='blue', genres=['chillhop', 'study', 'jazzhop'], coverGenres=['lofi', 'lo-fi', 'chiptune', '8-bit', '8bit', 'bitpop'], moods=['chill']),
    'red-rock': dict(name='Crimson Stage', palette='red', genres=['rock', 'metal', 'punk', 'grunge', 'hard rock', 'alternative'], moods=['angry']),
    'slime-rave': dict(name='Slime Rave', palette='slime', genres=['edm', 'rave', 'dance', 'house', 'trance', 'dubstep'], coverGenres=['electronic', 'techno', 'glitch', 'idm'], moods=['hype']),
    'jazz': dict(name='Smoky Jazz Club', genres=['jazz', 'blues', 'swing', 'soul', 'bossa'], moods=['chill'], poses=['music', 'smug', 'shy']),
    'hiphop': dict(name='Graffiti Street', genres=['hip-hop', 'hip hop', 'rap', 'trap', 'r&b', 'gangsta'], moods=['groove'], poses=['smug', 'music']),
    'classical': dict(name='Cathedral Hall', genres=['classical', 'orchestra', 'baroque', 'opera', 'piano', 'instrumental', 'soundtrack'], moods=['calm'], poses=['idle', 'music', 'shy']),
    'pop': dict(name='Idol Stage', genres=['pop', 'j-pop', 'k-pop', 'dance pop', 'top 40', 'eurodance'], moods=['happy'], poses=['happy', 'music', 'love']),
    'synthwave': dict(name='Neon Horizon', genres=['retrowave', 'outrun', 'synthpop', 'vaporwave', 'new wave', 'darkwave'], moods=['groove'], poses=['music', 'smug'], coverGenres=['synthwave', 'cyberpunk', 'industrial', 'darksynth']),
    'mood-sad': dict(name='Rainy Window', genres=['sad', 'emo', 'ballad'], moods=['sad'], poses=['crying', 'sleepy', 'cloud'], energy=[0, .28], bpm=[0, 92]),
    'mood-hype': dict(name='Hype Arena', genres=[], moods=['hype'], poses=['happy', 'surprised'], dance='fast', energy=[.62, 1], bpm=[124, 999]),
    'mood-romantic': dict(name='Sunset Promenade', genres=['love', 'romance', 'romantic', 'love song'], moods=['romantic'], poses=['love', 'shy']),
    'mood-sleepy': dict(name='Dream Clouds', genres=['sleep', 'lullaby'], moods=['sleepy'], poses=['sleepy', 'cloud-sleep', 'cloud'], energy=[0, .18], bpm=[0, 80]),
}
PIXEL_FOR = {'aero': 'pixel-aero', 'blue': 'pixel-blue', 'red': 'pixel-red', 'slime': 'pixel-slime'}
PIXEL_PARTICLES = {'pixel-aero': ['bubbles'], 'pixel-blue': ['rain', 'stars'], 'pixel-red': ['embers'], 'pixel-slime': ['slime']}

def art():
    os.makedirs(f'{ROOT}/art/thumb', exist_ok=True); os.makedirs(f'{ROOT}/art/px', exist_ok=True)
    scenes = []
    files = sorted(f for f in glob.glob(f'{ART_DIR}/*') if re.search(r'\.(jpe?g|png|webp)$', f, re.I))
    for f in files:
        base = re.sub(r'\.\w+$', '', os.path.basename(f))
        if base.startswith('char-') or base == 'pixel-sprite-sheet': continue
        im = Image.open(f).convert('RGB')
        if base.startswith('pixel-'):
            kind, sid = 'pixel', base
        elif base.startswith('bg-'):
            kind, sid = 'layered', base[3:]
        elif base.startswith('genre-'):
            kind, sid = 'full', base
        elif base.startswith('mood-'):
            kind, sid = 'full', base
        else:
            kind, sid = 'full', base
        im.resize((1024, 1024), Image.LANCZOS).save(f'{ROOT}/art/{sid}.webp', 'WEBP', quality=82, method=6)
        im.resize((256, 256), Image.LANCZOS).save(f'{ROOT}/art/thumb/{sid}.webp', 'WEBP', quality=80, method=6)
        # consistent pixel resolution: 192x192 (area average + 32-colour palette), shown with image-rendering:pixelated
        px = im.resize((192, 192), Image.BOX).quantize(colors=48, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB')
        px.save(f'{ROOT}/art/px/{sid}.png', optimize=True)
        meta = dict(SCENE_META.get(sid, {}))
        name = meta.pop('name', sid.replace('genre-', '').replace('mood-', '').replace('pixel-', 'Pixel ').replace('-', ' ').title())
        s = dict(id=sid, name=name, kind=kind, image=f'art/{sid}.webp', thumb=f'art/thumb/{sid}.webp', px=f'art/px/{sid}.png',
                 particles=PARTICLES.get(sid) or PIXEL_PARTICLES.get(sid) or ['sparkles'],
                 palette=meta.pop('palette', None), genres=meta.pop('genres', []), moods=meta.pop('moods', []),
                 poses=meta.pop('poses', ['music']), hasCharacter=(kind == 'full'))
        if base.startswith('genre-'): s['genres'] = s['genres'] or [base[6:].replace('-', ' ')]
        if base.startswith('mood-') and not s['moods']: s['moods'] = [base[5:]]
        if kind == 'pixel':
            s['palette'] = next((p for p, v in PIXEL_FOR.items() if v == sid), None); s['skin'] = 'classic'
        char = glob.glob(f'{ART_DIR}/char-{sid}.*')
        if char: s['character'] = f'char-{sid}'
        s.update(meta)
        scenes.append(s)
        print('scene', sid, kind, s['particles'])
    scenes += loops()
    data = dict(version=1, generated=True, scenes=scenes)
    # optional hand-edited overrides (art/scenes.overrides.json): { "<id>": { ...fields } }
    ov = f'{ROOT}/art/scenes.overrides.json'
    if os.path.exists(ov):
        o = json.load(open(ov))
        for s in scenes: s.update(o.get(s['id'], {}))
    js = '/* Generated by tools/build_assets.py art - edit art/scenes.overrides.json for tweaks, or re-run to pick up new art. */\n'
    js += 'window.LUCIEL_SCENES = ' + json.dumps(data, indent=1) + ';\n'
    open(f'{ROOT}/art/scenes.js', 'w').write(js)
    json.dump(data, open(f'{ROOT}/art/scenes.json', 'w'), indent=1)


# ------------------------------------------------------------------ video-loop scenes (bgloop-<id>.mp4)
LOOP_META = {
    'cyber': dict(name='Cyber Void', style='cyber', genres=['synthwave', 'cyberpunk', 'industrial', 'darksynth', 'ebm', 'cyber'], moods=['groove'], particles=['glyphs'], loop='crossfade'),
    'datamosh': dict(name='Datamosh', style='datamosh', genres=['electronic', 'techno', 'glitch', 'idm', 'breakcore', 'experimental'], moods=['hype'], particles=['sparkles'], loop='crossfade'),
    'dither': dict(name='Dither Moon', style='dither', genres=['chiptune', 'chiptunes', '8-bit', '8bit', 'bitpop', 'lo-fi', 'lofi'], moods=['chill'], particles=['stars'], loop='still'),
}
def loops():
    out = []
    if not os.path.isdir(LOOP_DIR): return out
    os.makedirs(f'{ROOT}/art/loops', exist_ok=True)
    for f in sorted(glob.glob(f'{LOOP_DIR}/*.mp4') + glob.glob(f'{LOOP_DIR}/*.webm') + glob.glob(f'{LOOP_DIR}/*.mov')):
        sid = re.sub(r'^bgloop-', '', re.sub(r'\.\w+$', '', os.path.basename(f)))
        meta = dict(LOOP_META.get(sid, dict(name=sid.replace('-', ' ').title(), style='', genres=[], moods=[], particles=['sparkles'], loop='crossfade')))
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode().strip())
        frames = []
        for t in (0.2, dur / 2, max(0.3, dur - 0.3)):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', f, '-frames:v', '1', f'/tmp/loopfr-{len(frames)}.png'], check=True)
            frames.append(np.asarray(Image.open(f'/tmp/loopfr-{len(frames)}.png').convert('RGB'), dtype=np.float32))
        motion = max(np.abs(frames[0] - frames[1]).mean(), np.abs(frames[1] - frames[2]).mean())
        still = motion < 2.0 or meta.get('loop') == 'still'
        poster = Image.open('/tmp/loopfr-1.png').convert('RGB')
        # poster / plate (the still plate is upscaled 2x so the pan/zoom has headroom), thumb, pixel version for Classic
        plate = poster.resize((poster.width * 2, poster.height * 2), Image.LANCZOS) if still else poster
        plate.save(f'{ROOT}/art/{sid}.webp', 'WEBP', quality=84, method=6)
        poster.resize((256, 256), Image.LANCZOS).save(f'{ROOT}/art/thumb/{sid}.webp', 'WEBP', quality=80, method=6)
        poster.resize((192, 192), Image.BOX).quantize(colors=48, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB').save(f'{ROOT}/art/px/{sid}.png', optimize=True)
        s = dict(id=sid, name=meta['name'], kind='video', style=meta['style'], image=f'art/{sid}.webp', thumb=f'art/thumb/{sid}.webp', px=f'art/px/{sid}.png',
                 particles=meta['particles'], palette=None, genres=meta['genres'], moods=meta['moods'], poses=['music'], hasCharacter=False, dance='auto',
                 still=bool(still), loopBpm=120)
        if not still:
            # seamless loop: the last second cross-fades into the first second (directional motion can't ping-pong)
            dst = f'{ROOT}/art/loops/{sid}.mp4'; xf = 1.0
            crf = '26' if motion > 25 else '21'
            fl = (f'[0:v]trim=start={xf}:end={dur},setpts=PTS-STARTPTS,fps=24[a];[0:v]trim=start=0:end={xf},setpts=PTS-STARTPTS,fps=24[b];'
                  f'[a][b]xfade=transition=fade:duration={xf}:offset={dur - 2 * xf:.3f},format=yuv420p[v]')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f, '-filter_complex', fl, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', crf,
                            '-profile:v', 'high', '-movflags', '+faststart', dst], check=True)
            s['video'] = f'art/loops/{sid}.mp4'; s['loopDuration'] = round(dur - xf, 3)
            print('loop', sid, f'motion={motion:.1f}', os.path.getsize(dst) // 1024, 'KB')
        else:
            print('loop', sid, f'motion={motion:.1f} -> still plate (animated in code)')
        out.append(s)
    return out

def glyphs():
    """Tiny crisp pixel glyphs for Classic buttons: bat wing + halo ring."""
    os.makedirs(f'{ROOT}/mascot/pixel', exist_ok=True)
    rig = json.load(open(f'{ROOT}/mascot/rig.json'))['idle']
    for w in rig['layers']['wings']:
        im = Image.open(f"{ROOT}/{w['file']}")
        k = 16 / im.width
        sm = premul_resize(im, (16, max(1, round(im.height * k))))
        a = np.asarray(sm).copy()
        on = a[..., 3] > 90
        a[..., 3] = np.where(on, 255, 0)
        lum = a[..., :3].mean(2)
        a[..., :3] = np.where((lum < 110)[..., None], [34, 30, 42], [96, 92, 110])
        Image.fromarray(a.astype(np.uint8), 'RGBA').save(f"{ROOT}/mascot/pixel/wing{w['side']}.png")
    h = Image.new('RGBA', (16, 7), (0, 0, 0, 0)); d = ImageDraw.Draw(h)
    d.ellipse((0, 0, 15, 6), outline=(255, 214, 80, 255), width=2)
    h.save(f'{ROOT}/mascot/pixel/halo.png')
    # aero wing for UI (smooth), from the idle rig
    for w in rig['layers']['wings']:
        im = Image.open(f"{ROOT}/{w['file']}"); save_webp(premul_resize(im, (64, round(im.height * 64 / im.width))), f"{ROOT}/mascot/ui/wing{w['side']}.webp")
    print('glyphs ok')

def data():
    """Bundle JSON metadata as JS so the app also works from file:// (no fetch)."""
    pack_manifest = json.load(open(f'{PACK}/manifest.json'))
    d = dict(rig=json.load(open(f'{ROOT}/mascot/rig.json')), dance=json.load(open(f'{ROOT}/mascot/dance/dance.json')),
             pixel=json.load(open(f'{ROOT}/mascot/pixel/pixel.json')), behavior=pack_manifest.get('behavior', {}),
             reactionSpec=pack_manifest.get('reactionSpec', {}), version=pack_manifest.get('version'))
    open(f'{ROOT}/mascot/mascot-data.js', 'w').write('/* Generated by tools/build_assets.py data */\nwindow.LUCIEL_MASCOT = ' + json.dumps(d) + ';\n')
    import shutil
    shutil.copy(f'{PACK}/manifest.json', f'{ROOT}/mascot/pack-manifest.json'); shutil.copy(f'{PACK}/README.txt', f'{ROOT}/mascot/pack-README.txt')
    print('data ok')

if __name__ == '__main__':
    steps = sys.argv[1:] or ['stills', 'icons', 'pixel', 'glyphs', 'art', 'data']
    for s in steps: globals()[s]()
