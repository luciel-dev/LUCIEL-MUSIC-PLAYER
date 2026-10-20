#!/usr/bin/env python3
"""Builds the 'Lucielle Styles' visual pack (see PACKS.md): Arcade Angel, City Punk, Fall Girl.

Inputs (all art generated for this pack, no text anywhere):
  ART/bg/<scene>.png|jpg            16:9 background plate, no characters      (scene = arcade | city | fall)
  ART/char/<scene>/<pose>.png       full-body Lucielle pose on flat #00FF00 green (or already transparent)
      poses: idle dance-a dance-b [dance-c] happy headbang shocked yawn sad sing clap [clap-b]
Everything that moves is animated here in code from those stills, so her face / wings / halo never melt:
  - background loops: per-light flicker / colour cycling, CRT roll (arcade), streetlight buzz + steam + wet ripples (city),
    falling leaves + lamp breathing + light shimmer (fall); seamless, 16 beats @ 120 BPM, tempo-synced in the app
  - a bass-pulsed light map (glow.png) derived from each plate's lights
  - Classic/pixel variant of every scene: palette-quantised low-res plate + loop
  - dance sheets slow / mid / fast and emote loops (tempo-synced): bob, sway, squash, hop, wing flap, halo glow / spin
Usage: make_styles_pack.py [--art DIR] [--out DIR] [--zip FILE] [--placeholder] [--only scene,...] [--quick]"""
import argparse, json, math, os, shutil, subprocess, sys, zipfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

ap = argparse.ArgumentParser()
ap.add_argument('--art', default='/workspace/lucielle/pack2')
ap.add_argument('--out', default='/workspace/aero-player-test/packs/lucielle-styles')
ap.add_argument('--zip', default='/workspace/luciel-dist/lucielle-styles-pack.zip')
ap.add_argument('--placeholder', action='store_true', help='pipeline test with existing art (NOT for shipping)')
ap.add_argument('--only', default='')
ap.add_argument('--quick', action='store_true', help='short loops / fewer frames for a fast test')
A = ap.parse_args()

W, H = 1280, 720
FPS = 24
LOOP_BPM = 120
LOOP_BEATS = 16
NFR = LOOP_BEATS * 60 // LOOP_BPM * FPS if not A.quick else 48          # 8 s -> 192 frames
PXW, PXH, PXFPS = 384, 216, 12
FR = 384                                                                   # character frame size
TAU = 2 * math.pi
rng = np.random.default_rng(7)

SCENES = {
  'arcade': dict(id='arcade-angel', name='Arcade Angel', base='blue', flap=0.45,
                 colors={'base': 'blue', 'accent': '#ff3fd0', 'accent2': '#29f6ff', 'glow': '#ff4fd8', 'lcd': '#7ff9ff', 'bg': ['#3a1066', '#170634', '#06020f'], 'frame': ['#d9c8ff', '#9f7fe0', '#5a3a9a']},
                 particles=['neon', 'sparkles'], burst='neon', glowColor='#ff4fd8',
                 rise='halo-spin', poses=['idle', 'dance-a', 'dance-b', 'happy', 'headbang', 'shocked', 'yawn', 'sad', 'sing'],
                 match={'genres': ['chiptune', 'video game', 'game', '8-bit', 'synthpop', 'electropop', 'j-pop', 'k-pop', 'hyperpop', 'nightcore', 'eurobeat'], 'moods': ['groove', 'hype'], 'bpm': [100, 175]}),
  'city':   dict(id='city-punk', name='City Punk', base='red',
                 colors={'base': 'red', 'accent': '#ff2a3d', 'accent2': '#3d7bff', 'glow': '#ff2a3d', 'lcd': '#ff6a6a', 'bg': ['#2a0a10', '#120509', '#040203'], 'frame': ['#c9c9cf', '#7d7d88', '#3a3a44']},
                 particles=['steam', 'dust'], burst='sparks', glowColor='#ff2a3d',
                 rise='clap', poses=['idle', 'dance-a', 'dance-b', 'happy', 'headbang', 'shocked', 'yawn', 'sad', 'sing', 'clap'],
                 match={'genres': ['punk', 'pop punk', 'rock', 'metal', 'hardcore', 'grunge', 'emo', 'alternative', 'garage', 'industrial', 'drum and bass', 'phonk'], 'moods': ['dark', 'hype'], 'bpm': [110, 200]}),
  'fall':   dict(id='fall-girl', name='Fall Girl', base='aero',
                 colors={'base': 'aero', 'accent': '#d9692b', 'accent2': '#f2b14a', 'glow': '#ffb04a', 'lcd': '#ffd08a', 'text': '#3a2416', 'bg': ['#fff1dc', '#e9b47e', '#a9592c'], 'frame': ['#f3e3cf', '#c9a27c', '#7a5236']},
                 particles=['leaves', 'dust'], burst='leaves', glowColor='#ffb04a',
                 rise='halo-spin', poses=['idle', 'dance-a', 'dance-b', 'happy', 'headbang', 'shocked', 'yawn', 'sad', 'sing'],
                 match={'genres': ['lo-fi', 'lofi', 'indie', 'folk', 'acoustic', 'jazz', 'bossa nova', 'singer-songwriter', 'soul', 'r&b', 'ballad', 'chill'], 'moods': ['chill', 'sad', 'love'], 'bpm': [60, 115]}),
}
ONLY = [s for s in A.only.split(',') if s] or list(SCENES)

def log(*a): print(*a, flush=True)

# ------------------------------------------------------------------ placeholder art (pipeline test only)
def make_placeholder(dst):
    """concept frames as plates and the stock mascot poses on green: exercises every step; never shipped"""
    os.makedirs(f'{dst}/bg', exist_ok=True)
    cmap = {'arcade': 'arcade-angel', 'city': 'city-punk', 'fall': 'fall-girl'}
    pmap = {'idle': 'idle', 'dance-a': 'music', 'dance-b': 'happy', 'happy': 'happy', 'headbang': 'angry', 'shocked': 'surprised',
            'yawn': 'sleepy', 'sad': 'crying', 'sing': 'love', 'clap': 'flying'}
    for sc in SCENES:
        Image.open(f'/workspace/lucielle/pack2-concepts/{cmap[sc]}.jpg').convert('RGB').save(f'{dst}/bg/{sc}.png')
        os.makedirs(f'{dst}/char/{sc}', exist_ok=True)
        for p, src in pmap.items():
            im = Image.open(f'/workspace/aero-player/mascot/poses/{src}.webp').convert('RGBA').resize((768, 768), Image.LANCZOS)
            g = Image.new('RGBA', im.size, (0, 255, 0, 255)); g.alpha_composite(im); g.convert('RGB').save(f'{dst}/char/{sc}/{p}.png')

# ------------------------------------------------------------------ helpers
def find(base):
    for e in ('png', 'jpg', 'jpeg', 'webp'):
        if os.path.exists(f'{base}.{e}'): return f'{base}.{e}'
    return None

def chroma_key(im):
    """flat green screen -> straight alpha with despill; keeps a real alpha channel if the image already has one"""
    if im.mode == 'RGBA' and np.asarray(im)[..., 3].min() < 250: return im
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    gd = g - np.maximum(r, b)                                      # green dominance
    alpha = np.clip(1 - (gd - 28) / (110 - 28), 0, 1)
    # keep only the largest connected opaque blob family (drops stray specks of keyed noise)
    solid = alpha > 0.5
    lab, n = ndi.label(solid)
    if n > 1:
        sizes = ndi.sum(solid, lab, range(1, n + 1)); keep = np.isin(lab, 1 + np.where(sizes > sizes.max() * 0.02)[0])
        alpha = np.where(ndi.binary_dilation(keep, iterations=3), alpha, 0)
    alpha = ndi.gaussian_filter(alpha, 0.6)
    lim = np.maximum(r, b)                                         # despill: green never brighter than max(r, b) at the edges
    g2 = np.where(gd > 0, np.minimum(g, lim + 6), g)
    out = np.dstack([r, g2, b, alpha * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

def fit_frame(im, size=FR, fill=0.93, k=None):
    """trim to the opaque bbox and stand her bottom-centred in a square frame (k = shared scale for an outfit)"""
    bb = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    im = im.crop(bb); k = min(k or size * fill / im.height, size * 0.97 / im.height, size * 0.98 / im.width)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    fr = Image.new('RGBA', (size, size)); fr.alpha_composite(im, ((size - im.width) // 2, size - im.height - 4)); return fr

def premul_warp(arr, dy, dx):
    """remap an RGBA float array by per-pixel offsets (premultiplied so edges stay clean)"""
    h, w = arr.shape[:2]; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = arr[..., 3:4] / 255.0; pm = np.concatenate([arr[..., :3] * a, arr[..., 3:4]], -1)
    out = np.stack([ndi.map_coordinates(pm[..., c], [yy - dy, xx - dx], order=1, mode='constant') for c in range(4)], -1)
    al = out[..., 3:4] / 255.0
    rgb = np.where(al > 1e-3, out[..., :3] / np.maximum(al, 1e-3), 0)
    return np.concatenate([rgb, out[..., 3:4]], -1)

class Pose:
    """a keyed pose with the masks needed for code animation (wings / halo)"""
    def __init__(self, im, k=None, flap_k=1.0):
        self.flap_k = flap_k
        self.im = fit_frame(chroma_key(im), k=k); a = np.asarray(self.im).astype(np.float32); self.a = a
        al = a[..., 3] > 30; ys, xs = np.where(al)
        self.top, self.bot = ys.min(), ys.max(); self.cx = (xs.min() + xs.max()) / 2; self.hw = (xs.max() - xs.min()) / 2
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        gold = al & (r > 170) & (g > 150) & (r - b > 40) & (g - b > 35) & (np.arange(FR)[:, None] < self.top + (self.bot - self.top) * 0.3)
        lab, n = ndi.label(ndi.binary_dilation(gold, iterations=2)); self.halo = None; best = 0
        for i, sl in enumerate(ndi.find_objects(lab), 1):          # the halo = the widest flat ring-shaped blob
            if sl is None: continue
            hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            if ww > 2 * hh and ww > FR * 0.12 and ww > best: best = ww; self.halo = ndi.binary_dilation(lab == i, iterations=2) & al
        # halo-free copy for the spin emote: where the ring crossed hair / beret, fill from the nearest pixels behind it
        self.a_nohalo = None
        if self.halo is not None:
            base = al & ~self.halo
            fillm = self.halo & ndi.binary_closing(base, iterations=6)
            idx = ndi.distance_transform_edt(~base, return_distances=False, return_indices=True)
            nh = a.copy(); nh[self.halo] = 0
            src = a[idx[0], idx[1]]; nh[fillm] = src[fillm]
            self.a_nohalo = nh
        # wing field: how far a pixel sits outside the torso column (0 inside, 1 at the bbox edge), upper 80 % only
        xx = np.abs(np.arange(FR)[None, :] - self.cx); yy = np.arange(FR)[:, None]
        torso = max(self.hw * 0.30, FR * 0.09)
        wf = np.clip((xx - torso) / max(1, self.hw - torso), 0, 1) ** 1.4
        vy = np.clip((self.bot - (self.bot - self.top) * 0.18 - yy) / ((self.bot - self.top) * 0.3), 0, 1)
        self.wing = (wf * vy).astype(np.float32)

    def render(self, flap=0.0, bob=0.0, sway=0.0, tilt=0.0, sx=1.0, sy=1.0, halo=0.0, spin=None, shake=0.0):
        """one animation frame. flap/bob/sway in fractions of the frame, tilt in radians, halo = extra glow 0..1,
        spin = halo rotation phase (radians) for the halo-spin emote"""
        a = self.a.copy()
        if self.halo is not None and spin is not None:   # lift the halo off, re-draw it squashed (a coin-flip spin)
            hm = self.halo[..., None]; hal = np.where(hm, a, 0); a = self.a_nohalo.copy()
        flap *= self.flap_k
        if flap:
            dy = -flap * FR * 0.035 * self.wing; dx = flap * FR * 0.008 * self.wing * np.sign(np.arange(FR)[None, :] - self.cx)
            a = premul_warp(a, dy.astype(np.float32), dx.astype(np.float32))
        im = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
        if self.halo is not None and spin is not None:
            ys, xs = np.where(self.halo); hc = xs.mean(); hb = Image.fromarray(hal.clip(0, 255).astype(np.uint8), 'RGBA').crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
            c = math.cos(spin); w2 = max(2, round(hb.width * max(0.08, abs(c))))
            hs = hb.resize((w2, hb.height), Image.LANCZOS)
            if c < 0: hs = hs.transpose(Image.FLIP_LEFT_RIGHT)
            lift = -round(FR * 0.02 * abs(math.sin(spin)))
            im.alpha_composite(hs, (round(hc - w2 / 2), ys.min() + lift)); halo = max(halo, 0.6 * abs(math.sin(spin)))
        if halo > 0.01 and self.halo is not None:
            gl = np.zeros((FR, FR, 4), np.float32); m = ndi.gaussian_filter(self.halo.astype(np.float32), 5) * halo
            gl[..., 0], gl[..., 1], gl[..., 2], gl[..., 3] = 255, 214, 120, np.clip(m * 255 * 1.6, 0, 255)
            g = Image.fromarray(gl.astype(np.uint8), 'RGBA'); base = Image.new('RGBA', im.size); base.alpha_composite(g); base.alpha_composite(im); im = base
        # body transform around the feet
        fx, fy = self.cx, self.bot
        ox = (sway + shake) * FR; oy = bob * FR
        c, s = math.cos(tilt), math.sin(tilt)
        # inverse affine for PIL: input = M^-1 (output)
        ia, ib = c / sx, s / sx; id_, ie = -s / sy, c / sy
        tx, ty = fx + ox, fy + oy
        coeff = (ia, ib, fx - ia * tx - ib * ty, id_, ie, fy - id_ * tx - ie * ty)
        return im.transform(im.size, Image.AFFINE, coeff, resample=Image.BICUBIC)

def sheet(frames, cols=8):
    rows = math.ceil(len(frames) / cols); sh = Image.new('RGBA', (cols * FR, rows * FR))
    for i, f in enumerate(frames): sh.alpha_composite(f, ((i % cols) * FR, (i // cols) * FR))
    return sh

def ease(x): return 0.5 - 0.5 * math.cos(math.pi * min(1, max(0, x)))

# ------------------------------------------------------------------ character animation
def dance_frames(P, tier, beats=8, fpb=6):
    """A/B(/C) pose switching on beat boundaries (no cross-fades = no ghosting), bob + sway + squash + wing flap + halo pulse"""
    seq = [P['dance-a'], P['dance-b']] + ([P['dance-c']] if 'dance-c' in P else [])
    per = {'slow': 4, 'mid': 2, 'fast': 1}[tier]
    amp = {'slow': (0.012, 0.010, 0.035, 0.020), 'mid': (0.022, 0.016, 0.055, 0.035), 'fast': (0.038, 0.022, 0.075, 0.055)}[tier]
    out = []
    for i in range(beats * fpb):
        t = i / fpb; b = t % 1; beat = int(t)
        pose = seq[(beat // per) % len(seq)]
        bob = -amp[0] * abs(math.sin(math.pi * b)) if tier != 'fast' else -amp[0] * math.sin(math.pi * b) ** 2 * 1.6
        sway = amp[1] * math.sin(TAU * t / 2); tilt = amp[2] * math.sin(TAU * t / 2 + 0.6) * (1 if tier != 'slow' else 0.7)
        sq = amp[3] * max(0, 1 - b * 4)                       # squash right on the beat
        flap = math.sin(TAU * t / (2 if tier == 'slow' else 1)) * (0.6 if tier == 'slow' else 0.9)
        out.append(pose.render(flap=flap, bob=bob, sway=sway, tilt=tilt, sx=1 + sq * 0.6, sy=1 - sq, halo=0.5 * max(0, 1 - b * 2.5)))
    return out

def emote_frames(P, name, rise_kind):
    fpb = 6; beats = 4; out = []
    for i in range(beats * fpb):
        t = i / fpb; b = t % 1
        if name == 'headbang':        # big nods on every beat
            nod = math.sin(math.pi * b) ** 2
            out.append(P['headbang'].render(tilt=0.10 * nod * (1 if int(t) % 2 else -1) * 0.5, bob=0.03 * nod, sy=1 - 0.05 * nod, sx=1 + 0.03 * nod, flap=-nod, halo=0.4 * (1 - b)))
        elif name == 'happy':         # hop at song start
            h = math.sin(math.pi * b); land = max(0, 1 - b * 5) if t >= 1 else 0
            out.append(P['happy'].render(bob=-0.06 * h, sy=1 - 0.06 * land, sx=1 + 0.04 * land, flap=math.sin(TAU * t), halo=0.3 * h))
        elif name == 'yawn':          # slow sleepy breathing sway (half time)
            ph = t / beats
            out.append(P['yawn'].render(sway=0.008 * math.sin(TAU * ph), tilt=0.04 * math.sin(TAU * ph), sy=1 + 0.015 * math.sin(TAU * ph * 2), flap=0.25 * math.sin(TAU * ph)))
        elif name == 'sad':           # droopy slow sway
            ph = t / beats
            out.append(P['sad'].render(sway=0.01 * math.sin(TAU * ph), tilt=-0.03 + 0.025 * math.sin(TAU * ph), bob=0.008, sy=0.99, flap=-0.3 + 0.15 * math.sin(TAU * ph)))
        elif name == 'sing':          # sway to the melody, small lift per beat
            out.append(P['sing'].render(sway=0.014 * math.sin(TAU * t / 2), tilt=0.05 * math.sin(TAU * t / 2), bob=-0.012 * math.sin(math.pi * b), halo=0.25 + 0.25 * math.sin(math.pi * b), flap=0.4 * math.sin(TAU * t / 2)))
        elif name == 'shocked':       # jolt + decaying shake (2 beats, then a held pose)
            k = max(0, 1 - t / 2.2)
            out.append(P['shocked'].render(shake=0.015 * k * math.sin(TAU * t * 3), bob=-0.03 * max(0, 1 - t * 1.5), sy=1 + 0.04 * k, sx=1 - 0.02 * k, flap=1.0 * k, halo=0.8 * k))
        elif name == 'clap':          # clap on every half beat (alternating clap / clap-b when there is one)
            hb = (t * 2) % 1; pose = P['clap-b'] if 'clap-b' in P and int(t * 2) % 2 else P['clap']
            out.append(pose.render(bob=-0.02 * math.sin(math.pi * hb), sy=1 - 0.03 * max(0, 1 - hb * 4), flap=0.6 * math.sin(TAU * t), halo=0.3 * (1 - hb)))
        elif name == 'halo-spin':     # the halo flips round twice per beat-pair; she bounces
            out.append(P['idle' if 'happy' not in P else 'happy'].render(spin=TAU * t / 2, bob=-0.02 * math.sin(math.pi * b), flap=math.sin(TAU * t), halo=0.5))
    return out

# ------------------------------------------------------------------ background analysis + loops
def light_masks(plate):
    """bright saturated neon / lamp regions -> soft mask, labelled regions, and the additive light map"""
    a = np.asarray(plate).astype(np.float32) / 255
    mx, mn = a.max(-1), a.min(-1); sat = (mx - mn) / np.maximum(mx, 1e-3)
    m = np.clip((mx - 0.62) / 0.3, 0, 1) * np.clip((sat - 0.25) / 0.4, 0, 1)          # saturated neon
    white = (mx > 0.93) & (sat < 0.3)                                                    # white lamps: small compact blobs only (not sky / hair / walls)
    wl, wn = ndi.label(white)
    if wn:
        sizes = ndi.sum(white, wl, range(1, wn + 1)); keep = np.isin(wl, 1 + np.where((sizes > 6) & (sizes < a.shape[0] * a.shape[1] * 0.004))[0])
        m = np.maximum(m, ndi.binary_dilation(keep, iterations=2) * 0.9)
    m = ndi.gaussian_filter(m, 1.2)
    lab, n = ndi.label(ndi.binary_dilation(m > 0.25, iterations=4))
    glow = a * m[..., None]; glow = ndi.gaussian_filter(glow, (6, 6, 0)) * 1.3 + ndi.gaussian_filter(glow, (22, 22, 0)) * 1.1
    return m, lab, n, np.clip(glow, 0, 1)

def tileable_noise(h, w, cell, seed):
    """smooth value noise that tiles in both axes (for steam / ripples that loop)"""
    r = np.random.default_rng(seed); gh, gw = max(2, h // cell), max(2, w // cell)
    g = r.random((gh, gw)).astype(np.float32); g = np.pad(g, ((0, 1), (0, 1)), mode='wrap')
    z = ndi.zoom(g, ((h + cell) / gh, (w + cell) / gw), order=3)[:h, :w]
    return (z - z.min()) / (z.max() - z.min() + 1e-6)

def leaf_sprites():
    cols = [(226, 88, 27), (200, 50, 30), (242, 166, 35), (181, 72, 26), (240, 125, 42)]
    sp = []
    for c in cols:
        row = []
        for k in range(24):
            S = 64; im = Image.new('RGBA', (S, S)); d = ImageDraw.Draw(im)
            pts = []
            for j in range(40):
                u = j / 39 * TAU; rr = 22 * (0.55 + 0.45 * abs(math.cos(2.5 * u))) * (1 if math.sin(u) > -0.85 else 0.6)
                pts.append((S / 2 + rr * math.cos(u) * 0.85, S / 2 - rr * math.sin(u) * 0.9))
            d.polygon(pts, fill=c + (255,)); d.line([(S / 2, S / 2 + 4), (S / 2, S - 8)], fill=tuple(int(v * 0.6) for v in c) + (255,), width=3)
            d.line([(S / 2, S / 2 + 6), (S / 2, 14)], fill=tuple(int(v * 0.75) for v in c) + (200,), width=2)
            im = im.rotate(k * 15, Image.BICUBIC); row.append(im)
        sp.append(row)
    return sp

def bg_frames(sc, plate, nfr):
    """yields RGB uint8 frames of the seamless loop for one scene"""
    m, lab, n, glow = light_masks(plate)
    a = np.asarray(plate).astype(np.float32) / 255
    T = np.arange(nfr) / nfr
    r = np.random.default_rng({'arcade': 1, 'city': 2, 'fall': 3}[sc])
    # per light region: integer cycles per loop so it loops; some regions flicker, all breathe a little
    reg_cyc = r.integers(1, 5, n + 1); reg_ph = r.random(n + 1) * TAU; reg_amp = r.uniform(0.15, 0.45, n + 1)
    big = np.argsort(-ndi.sum(m, lab, range(1, n + 1)))[:3] + 1 if n else []
    yy = np.arange(H)[:, None] / H
    if sc == 'city':
        steam_n = [tileable_noise(H, W, 90, 11), tileable_noise(H, W, 40, 12)]
        # steam rises from the lower half, in a few soft vertical bands
        cols = np.zeros(W, np.float32)
        for cx in r.uniform(0.15, 0.85, 3): cols += np.exp(-((np.arange(W) / W - cx) / 0.07) ** 2)
        steam_mask = (np.clip((yy - 0.35) / 0.35, 0, 1) * np.clip((1.02 - yy) / 0.2, 0, 1)) * np.clip(cols, 0, 1)[None, :]
        # the streetlight: the brightest region in the upper 60 %
        lamp = 0; best = -1
        for i in range(1, n + 1):
            ys, xs = np.where(lab == i)
            if not len(ys): continue
            sc_ = (a[ys, xs].max(-1).mean()) * len(ys) * (1 if ys.mean() < H * 0.6 else 0.2)
            if sc_ > best: best, lamp = sc_, i
        flick = np.ones(nfr, np.float32); k = 0
        while k < nfr:                                          # buzzing: short dropouts every so often
            k += int(r.integers(nfr // 10, nfr // 4))
            for j in range(int(r.integers(2, 7))):
                if k + j < nfr: flick[k + j] = r.uniform(0.15, 0.6)
        lampm = ndi.gaussian_filter((lab == lamp).astype(np.float32), 30) * 2.2 if lamp else 0
        wet = np.clip((yy - 0.68) / 0.12, 0, 1)
    if sc == 'fall':
        sprites = leaf_sprites()
        L = 34; lv = [dict(x0=r.uniform(-0.2, 1.0), y0=r.uniform(0, 1), cyc=int(r.integers(1, 3)), drift=r.uniform(0.15, 0.4), sz=r.uniform(0.5, 1.2),
                           c=int(r.integers(0, 5)), spin=int(r.integers(1, 4)) * (1 if r.random() < 0.5 else -1), ph=r.random(), wob=r.uniform(0.01, 0.03)) for _ in range(L)]
        rays = np.clip(np.sin((np.arange(W)[None, :] / W * 3.2 - yy * 1.6) * TAU * 1.5), 0, 1) ** 4 * np.clip(1 - yy * 1.3, 0, 1)
    for f, t in enumerate(T):
        fr = a.copy()
        if n:
            mod = np.ones(n + 1, np.float32)
            mod[1:] = 1 + reg_amp[1:] * np.sin(TAU * reg_cyc[1:] * t + reg_ph[1:]) * 0.6
            if sc == 'arcade':
                for i in big: mod[i] = 1 + 0.35 * math.sin(TAU * 4 * t + reg_ph[i])
            lm = mod[lab] * (lab > 0) + (lab == 0)
            fr = fr + glow * (lm[..., None] - 1) * 0.9 + a * m[..., None] * (lm[..., None] - 1) * 0.5
        if sc == 'arcade':
            # colour cycling on the neon (hue rotation through the light mask, one full cycle per loop)
            ang = TAU * t; cs, sn = math.cos(ang), math.sin(ang)
            M = np.array([[0.299 + 0.701 * cs + 0.168 * sn, 0.587 - 0.587 * cs + 0.330 * sn, 0.114 - 0.114 * cs - 0.497 * sn],
                          [0.299 - 0.299 * cs - 0.328 * sn, 0.587 + 0.413 * cs + 0.035 * sn, 0.114 - 0.114 * cs + 0.292 * sn],
                          [0.299 - 0.300 * cs + 1.250 * sn, 0.587 - 0.588 * cs - 1.050 * sn, 0.114 + 0.886 * cs - 0.203 * sn]], np.float32)
            hm = (m * 0.55)[..., None]; fr = fr * (1 - hm) + np.clip(fr @ M.T, 0, 1) * hm
            # CRT: fine scanlines + a slow rolling bright band
            band = np.exp(-(((yy - t) % 1.0 - 0.5) / 0.04) ** 2) * 0.10
            fr = fr * (1 - 0.10 * (np.arange(H) % 3 == 0)[:, None, None]) + band[..., None] * (0.3 + m[..., None])
        elif sc == 'city':
            if lamp: fr = fr * (1 - (1 - flick[f]) * np.clip(lampm, 0, 0.85))[..., None]
            ny = int(t * H) ; s1 = np.roll(steam_n[0], -ny, 0); s2 = np.roll(steam_n[1], -2 * ny, 0)
            st = np.clip((s1 * 0.65 + s2 * 0.35 - 0.42) * 2.2, 0, 1) * steam_mask * 0.42
            fr = fr * (1 - st[..., None]) + st[..., None] * np.array([0.62, 0.64, 0.7])
            # wet pavement: rows of the reflection ripple sideways
            sh = (np.sin(np.arange(H) * 0.21 + TAU * 3 * t) * 2.2 * wet[:, 0]).astype(np.int32)
            rows = np.where(wet[:, 0] > 0)[0]
            for y0 in rows: fr[y0] = np.roll(fr[y0], sh[y0], 0)
        elif sc == 'fall':
            fr = fr + rays[..., None] * (0.05 + 0.03 * math.sin(TAU * t)) * np.array([1.0, 0.75, 0.4])
            im = Image.fromarray((fr.clip(0, 1) * 255).astype(np.uint8)).convert('RGBA')
            for L_ in lv:
                u = (L_['y0'] + L_['cyc'] * t) % 1.0
                y = -0.08 + u * 1.16; x = L_['x0'] + L_['drift'] * u + L_['wob'] * math.sin(TAU * (2 * u + L_['ph']))
                ang = int(((L_['spin'] * t * 24 + L_['ph'] * 24) % 24)); sp = sprites[L_['c']][ang]
                s = max(8, int(64 * L_['sz'] * 0.5)); sp = sp.resize((s, s), Image.BILINEAR)
                im.alpha_composite(sp, (int(x * W) - s // 2, int(y * H) - s // 2)) if -s < x * W < W + s else None
            fr = np.asarray(im.convert('RGB')).astype(np.float32) / 255
        yield (fr.clip(0, 1) * 255).astype(np.uint8)

def encode(frames_iter, path, w, h, fps, crf=26, scale=None):
    vf = [] if not scale else ['-vf', f'scale={scale[0]}:{scale[1]}:flags=neighbor']
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(fps), '-i', '-', *vf,
                          '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', str(crf), '-preset', 'slow', '-g', str(fps * 2), '-movflags', '+faststart', path], stdin=subprocess.PIPE)
    for fr in frames_iter: p.stdin.write(fr.tobytes())
    p.stdin.close(); assert p.wait() == 0, path

def plain_lamps(plate, y0, y1, max_area=900):
    """repaint small saturated red / orange lamp blobs (coin-door lights etc.) as plain glowing rectangles, so no
    glyph-like marks can survive inside them"""
    a = np.asarray(plate).astype(np.float32); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 80) & (r > g * 1.4) & (r > b * 1.15); m[:y0] = False; m[y1:] = False
    lab, n = ndi.label(ndi.binary_dilation(m, iterations=3)); out = a.copy(); fixed = 0
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        ys, xs = sl; area = (ys.stop - ys.start) * (xs.stop - xs.start)
        if area > max_area or area < 12: continue
        reg = lab[sl] == i; col = a[sl][m[sl]].mean(0) if m[sl].any() else a[sl][reg].mean(0)
        pad = 2; Y0, Y1, X0, X1 = ys.start - pad, ys.stop + pad, xs.start - pad, xs.stop + pad
        box = np.zeros(a.shape[:2], np.float32); box[Y0:Y1, X0:X1] = 1
        soft = ndi.gaussian_filter(box, 1.0)[..., None]
        out = out * (1 - soft) + soft * (col * 0.95)                      # flat lamp face
        halo = ndi.gaussian_filter(box, 4.0)[..., None] * 0.35
        out = out + halo * col * 0.5; fixed += 1
    return Image.fromarray(out.clip(0, 255).astype(np.uint8)), fixed

def build_scene(sc, art, out):
    cfg = SCENES[sc]; sid = cfg['id']
    src = find(f'{art}/bg/{sc}'); assert src, f'missing background plate {art}/bg/{sc}.png'
    plate = Image.open(src).convert('RGB'); r_ = max(W / plate.width, H / plate.height)
    plate = plate.resize((round(plate.width * r_), round(plate.height * r_)), Image.LANCZOS)
    plate = plate.crop(((plate.width - W) // 2, (plate.height - H) // 2, (plate.width - W) // 2 + W, (plate.height - H) // 2 + H))
    log(f'[{sc}] plate {src}')
    if sc == 'arcade': plate, nf = plain_lamps(plate, int(H * 0.5), int(H * 0.72)); log(f'[{sc}] repainted {nf} small lamps as plain shapes')
    plate.save(f'{out}/bg/{sid}.jpg', quality=88)
    _, _, _, glow = light_masks(plate)
    Image.fromarray((glow * 255).astype(np.uint8)).save(f'{out}/bg/{sid}-glow.jpg', quality=85)
    frames = list(bg_frames(sc, plate, NFR))
    encode(iter(frames), f'{out}/bg/{sid}.mp4', W, H, FPS, crf=25)
    # pixel variant: low-res, fixed palette from the plate, 12 fps, nearest-neighbour 2x for crisp h264 blocks
    pal = plate.resize((PXW, PXH), Image.BOX).quantize(40, method=Image.MEDIANCUT)
    def px(im): return im.resize((PXW, PXH), Image.BOX).quantize(palette=pal, dither=Image.NONE).convert('RGB')
    px(plate).save(f'{out}/bg/{sid}-px.png')
    step = FPS // PXFPS
    encode((np.asarray(px(Image.fromarray(f))) for f in frames[::step]), f'{out}/bg/{sid}-px.mp4', PXW, PXH, PXFPS, crf=18, scale=(PXW * 2, PXH * 2))
    # contact sheet of loop frames for visual checks
    cs = Image.new('RGB', (W // 4 * 4, H // 4 * 2))
    for i, k in enumerate(np.linspace(0, len(frames) - 1, 8).astype(int)): cs.paste(Image.fromarray(frames[k]).resize((W // 4, H // 4)), ((i % 4) * W // 4, (i // 4) * H // 4))
    cs.save(f'/tmp/styles-check/{sc}-bg-frames.jpg', quality=85)
    thumb = plate.resize((456, 256), Image.LANCZOS).crop((100, 0, 356, 256))
    # ---- character
    P = {}
    idle_src = chroma_key(Image.open(find(f'{art}/char/{sc}/idle')))
    bb = idle_src.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox(); k_out = FR * 0.9 / (bb[3] - bb[1])
    for p in cfg['poses'] + ['dance-c', 'clap-b']:
        f = find(f'{art}/char/{sc}/{p}')
        if f: P[p] = Pose(Image.open(f), k=k_out, flap_k=cfg.get('flap', 1.0))
        elif p in cfg['poses']: raise SystemExit(f'missing pose {art}/char/{sc}/{p}.png')
    dance = {}
    for tier, bpm in [('slow', 80), ('mid', 112), ('fast', 150)]:
        fr = dance_frames(P, tier); sh = sheet(fr); sh.save(f'{out}/char/{sid}-{tier}.webp', quality=86, method=6)
        dance[tier] = {'sheet': f'char/{sid}-{tier}.webp', 'frames': len(fr), 'columns': 8, 'beats': 8, 'loopBpm': bpm}
        if tier == 'mid': sheet(fr[::6], 8).resize((8 * FR // 2, FR // 2)).save(f'/tmp/styles-check/{sc}-dance-mid.png')
    P['idle'].im.save(f'{out}/char/{sid}-idle.webp', quality=88, method=6)
    emotes = {}
    for name in ['happy', 'headbang', 'shocked', 'yawn', 'sad', 'sing', cfg['rise']]:
        fr = emote_frames(P, name, cfg['rise']); sheet(fr).save(f'{out}/char/{sid}-{name}.webp', quality=86, method=6)
        emotes[name] = {'sheet': f'char/{sid}-{name}.webp', 'frames': len(fr), 'columns': 8, 'beats': 4, 'loopBpm': 120}
        sheet(fr[::3], 8).resize((8 * FR // 2, FR // 2)).save(f'/tmp/styles-check/{sc}-emote-{name}.png')
    # built-in mood names reuse the outfit's loops so nothing falls back to the default look
    emotes['surprised'] = emotes['shocked']; emotes['sleepy'] = emotes['yawn']; emotes['crying'] = emotes['sad']; emotes['music'] = emotes['sing']
    # preview tile: plate + idle
    tp = thumb.convert('RGBA'); tp.alpha_composite(P['idle'].im.resize((200, 200), Image.LANCZOS), (28, 50)); tp.convert('RGB').save(f'{out}/bg/{sid}-thumb.jpg', quality=86)
    ch = {'use': 'custom', 'name': f"Lucielle · {cfg['name']}", 'tier': 'auto', 'dance': dance, 'idle': f'char/{sid}-idle.webp', 'emotes': emotes,
          'events': {'start': 'happy', 'drop': 'headbang', 'hit': 'shocked', 'quiet': 'yawn', 'rise': cfg['rise'], 'sad': 'sad', 'vocals': 'sing'}}
    react = {'beatZoom': 1.1, 'bassGlow': 1.3, 'shake': 0.7, 'flash': 1.0, 'particles': 1, 'glowColor': cfg['glowColor'], 'beatBurst': cfg['burst']}
    base = {'background': {'image': f'bg/{sid}.jpg', 'video': f'bg/{sid}.mp4', 'pixel': f'bg/{sid}-px.png', 'glow': f'bg/{sid}-glow.jpg', 'loopBpm': LOOP_BPM, 'tempoSync': True},
            'character': ch, 'particles': cfg['particles'], 'reactivity': react, 'themeDefault': cfg['base'], 'colors': cfg['colors']}
    s1 = dict(id=sid, name=cfg['name'], thumb=f'bg/{sid}-thumb.jpg', **base,
              effects=[{'type': 'scanlines', 'intensity': 0.3}] if sc == 'arcade' else [],
              match=dict(cfg['match'], skins=['aero']))
    pxs = json.loads(json.dumps(base)); pxs['background'] = {'image': f'bg/{sid}-px.png', 'pixel': f'bg/{sid}-px.png', 'pixelVideo': f'bg/{sid}-px.mp4', 'glow': f'bg/{sid}-glow.jpg', 'loopBpm': LOOP_BPM, 'tempoSync': True}
    s2 = dict(id=f'{sid}-pixel', name=f"{cfg['name']} (Pixel)", pixel=True, thumb=f'bg/{sid}-thumb.jpg', **pxs,
              effects=[{'type': 'scanlines', 'intensity': 0.25}] if sc != 'fall' else [{'type': 'dither', 'intensity': 0.25}],
              match=dict(cfg['match'], skins=['classic']))
    return [s1, s2], thumb

def main():
    art = A.art
    if A.placeholder:
        art = '/tmp/pack2-placeholder'; shutil.rmtree(art, ignore_errors=True); make_placeholder(art)
        log('PLACEHOLDER art (pipeline test only — not for shipping)')
    shutil.rmtree(A.out, ignore_errors=True)
    for d in ['bg', 'char']: os.makedirs(f'{A.out}/{d}', exist_ok=True)
    os.makedirs('/tmp/styles-check', exist_ok=True)
    scenes, thumbs = [], []
    for sc in ONLY:
        ss, th = build_scene(sc, art, A.out); scenes += ss; thumbs.append(th)
    prev = Image.new('RGB', (768, 256))
    for i, th in enumerate(thumbs): prev.paste(th, (i * 256, 0))
    prev.save(f'{A.out}/preview.jpg', quality=86)
    pack = {'format': 'luciel-pack/1', 'id': 'lucielle-styles', 'name': 'Lucielle Styles', 'author': 'pj', 'version': '1.0.0',
            'description': 'Lucielle in three outfits: Arcade Angel (neon arcade, air-keytar), City Punk (night alley) and Fall Girl (autumn park). '
                           'Looping backgrounds, bass-pulsed lights, music-reactive emotes and a matching colour theme per scene; pixel versions for the Classic skin.',
            'preview': 'preview.jpg', 'scenes': scenes}
    json.dump(pack, open(f'{A.out}/pack.json', 'w'), indent=1)
    os.makedirs(os.path.dirname(A.zip), exist_ok=True)
    if os.path.exists(A.zip): os.remove(A.zip)
    with zipfile.ZipFile(A.zip, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(A.out):
            for f in sorted(files):
                p = os.path.join(root, f); rel = os.path.relpath(p, A.out)
                z.write(p, rel, compress_type=zipfile.ZIP_STORED if f.endswith(('.mp4', '.webp', '.jpg', '.png')) else zipfile.ZIP_DEFLATED)
    log('zip', A.zip, os.path.getsize(A.zip) // 1024, 'KB')

main()
