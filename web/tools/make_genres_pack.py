#!/usr/bin/env python3
"""Builds the 'Lucielle Genres' add-on pack (see PACKS.md): Alt Rock, Hip-Hop, R&B, Indie, Acoustic.

Same approach as make_styles_pack.py (whose helpers it imports): every moving thing is animated here in code from
approved still art, so faces / wings / halos never melt.
Inputs (ART = /workspace/lucielle/pack3, all art generated for this pack, no text anywhere):
  ART/bg/<genre>-bg.jpg                main plate (night, or day for Indie)        ART/raw/bgv-<genre>-<day|night>.jpg  other variant
  ART/char/<outfit>/<pose>.png         poses split from the 3-pose sheets (tools/split_pose_sheets.py), flat #00FF00
Outputs: pack folder (--out) and lucielle-genres-pack.zip (--zip). Scenes declare variants.day/night, the Alt Rock
instrument loops (character.instruments) and one rare outfit each (character.rareOutfits).
Usage: make_genres_pack.py [--art DIR] [--out DIR] [--zip FILE] [--only alt-rock,...] [--quick] [--no-bg] [--no-char]"""
import argparse, json, math, os, shutil, subprocess, sys, zipfile, importlib.util
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

ap = argparse.ArgumentParser()
ap.add_argument('--art', default='/workspace/lucielle/pack3')
ap.add_argument('--out', default='/workspace/aero-player-test/packs/lucielle-genres')
ap.add_argument('--zip', default='/workspace/luciel-dist/lucielle-genres-pack.zip')
ap.add_argument('--only', default='')
ap.add_argument('--quick', action='store_true')
ap.add_argument('--no-bg', action='store_true', help='reuse the existing background loops in --out')
ap.add_argument('--no-char', action='store_true', help='reuse the existing character sheets in --out')
A = ap.parse_args()

# reuse the Styles helpers (chroma key, fit, Pose rig, sheets, light masks, noise, encode)
_here = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(_here, 'make_styles_pack.py')).read().split('\ndef main():')[0]
_src = _src.replace('A = ap.parse_args()', 'A = ap.parse_args([])')
S = {}; exec(compile(_src, 'make_styles_pack.py', 'exec'), S)
chroma_key, fit_frame, Pose, sheet, light_masks, tileable_noise, encode, ease = (S[k] for k in ['chroma_key', 'fit_frame', 'Pose', 'sheet', 'light_masks', 'tileable_noise', 'encode', 'ease'])
FR = S['FR']; TAU = 2 * math.pi
W, H, FPS, LOOP_BPM, BEATS = 1280, 720, 24, 120, 16
NFR = BEATS * 60 // LOOP_BPM * FPS if not A.quick else 48          # 8 s = 16 beats -> 192 frames
CHECK = '/tmp/genres-check'
def log(*a): print(*a, flush=True)

# ------------------------------------------------------------------ scenes
SCENES = {
  'alt-rock': dict(name='Alt Rock Stage', outfit='static-halo', oname='Static Halo', main='night', base='red',
      colors={'base': 'red', 'accent': '#ff2e7e', 'accent2': '#ff5a3c', 'glow': '#ff3b8d', 'lcd': '#ff8ab8', 'bg': ['#3a0a22', '#1a0410', '#070105'], 'frame': ['#c9c9cf', '#7d7d88', '#3a3a44']},
      particles=['sparks', 'dust'], burst='sparks', glow='#ff3b8d',
      match={'genres': ['alternative', 'alt rock', 'alt-rock', 'alternative rock', 'punk', 'pop punk', 'punk rock', 'post-punk', 'grunge', 'emo', 'hard rock', 'rock', 'garage rock', 'metal', 'nu metal', 'skate punk', 'post-hardcore'],
             'moods': ['hype', 'dark'], 'bpm': [112, 200], 'energy': [0.55, 1.0], 'priority': 5},
      rare=dict(id='leather-jacket', name='Leather Jacket', outfit='static-halo-rare', plays=25)),
  'hip-hop': dict(name='Hip-Hop Rooftop', outfit='block-party', oname='Block Party', main='night', base='blue',
      colors={'base': 'blue', 'accent': '#b06bff', 'accent2': '#ffb347', 'glow': '#c77dff', 'lcd': '#d7b4ff', 'bg': ['#2a1450', '#140a2c', '#06030f'], 'frame': ['#d9c8ff', '#9f7fe0', '#5a3a9a']},
      particles=['sparkles'], burst='neon', glow='#c77dff',
      match={'genres': ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'drill', 'boom bap', 'grime', 'gangsta rap', 'conscious hip hop', 'underground hip hop', 'cloud rap', 'east coast hip hop', 'west coast hip hop'],
             'moods': ['groove'], 'bpm': [78, 108], 'energy': [0.4, 0.9], 'priority': 5},
      rare=dict(id='puffer', name='Puffer Jacket', outfit='block-party-rare', plays=25)),
  'rnb': dict(name='R&B Rainy Night', outfit='velvet-hour', oname='Velvet Hour', main='night', base='blue',
      colors={'base': 'blue', 'accent': '#e07ad8', 'accent2': '#ffb3d9', 'glow': '#e488ff', 'lcd': '#f2c4ff', 'bg': ['#3b2150', '#1c1030', '#0a0614'], 'frame': ['#e6d3f2', '#b08cc8', '#6b4a85']},
      particles=['hearts'], burst='hearts', glow='#e488ff',
      match={'genres': ['r&b', 'rnb', 'r and b', 'rhythm and blues', 'soul', 'neo soul', 'neo-soul', 'contemporary r&b', 'alternative r&b', 'quiet storm', 'slow jam', 'motown', 'funk'],
             'moods': ['love', 'chill'], 'bpm': [60, 104], 'energy': [0.12, 0.6], 'priority': 5},
      rare=dict(id='sparkle-gown', name='Sparkly Gown', outfit='velvet-hour-rare', plays=25)),
  'indie-rock': dict(name='Indie Garage', outfit='garage-days', oname='Garage Days', main='day', base='aero',
      colors={'base': 'aero', 'accent': '#e08a2e', 'accent2': '#3d6fa8', 'glow': '#ffb44a', 'lcd': '#ffd79a', 'text': '#3a2416', 'bg': ['#fff0d8', '#e8b778', '#9a5a2a'], 'frame': ['#f3e3cf', '#c9a27c', '#7a5236']},
      particles=['dust'], burst='sparkles', glow='#ffb44a',
      match={'genres': ['indie', 'indie rock', 'indie pop', 'bedroom pop', 'dream pop', 'shoegaze', 'jangle pop', 'indie alternative', 'lo-fi indie', 'math rock', 'surf rock', 'britpop'],
             'moods': ['groove', 'chill'], 'bpm': [96, 140], 'energy': [0.3, 0.72], 'priority': 5},
      rare=dict(id='overalls', name='Overalls', outfit='garage-days-rare', plays=25)),
  'acoustic': dict(name='Acoustic Campfire', outfit='campfire-wings', oname='Campfire Wings', main='night', base='aero',
      colors={'base': 'aero', 'accent': '#e0782e', 'accent2': '#9bd36a', 'glow': '#ffa040', 'lcd': '#ffd08a', 'bg': ['#1d2b4a', '#101a30', '#050910'], 'frame': ['#d8e0c8', '#9aa880', '#566048']},
      particles=['embers', 'dust'], burst='sparks', glow='#ffa040',
      match={'genres': ['acoustic', 'folk', 'indie folk', 'folk pop', 'singer-songwriter', 'americana', 'country', 'bluegrass', 'unplugged', 'campfire', 'folk rock', 'chamber folk', 'stomp and holler'],
             'moods': ['chill', 'sad'], 'bpm': [56, 118], 'energy': [0.0, 0.42], 'priority': 5},
      rare=dict(id='raincoat', name='Raincoat', outfit='campfire-wings-rare', plays=25)),
}
ONLY = [s for s in A.only.split(',') if s] or list(SCENES)

def plate_path(sc, variant):
    cfg = SCENES[sc]
    if variant == cfg['main']: return f'{A.art}/bg/{sc}-bg.jpg'
    return f'{A.art}/raw/bgv-{sc}-{variant}.jpg'

def load_plate(p):
    im = Image.open(p).convert('RGB'); r = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    return im.crop(((im.width - W) // 2, (im.height - H) // 2, (im.width - W) // 2 + W, (im.height - H) // 2 + H))

# ------------------------------------------------------------------ background effect kit (all loops seamless: integer cycles per loop)
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
def beat_of(t): return t * BEATS
def pulse(t, every=1, k=7.0, phase=0.0):
    b = (beat_of(t) / every + phase) % 1.0; return math.exp(-b * k)

def soft_dot(r, col, a=1.0):
    s = int(math.ceil(r * 3)); y, x = np.mgrid[-s:s + 1, -s:s + 1]; g = np.exp(-(x * x + y * y) / (2 * r * r)).astype(np.float32) * a
    return g[..., None] * np.array(col, np.float32)[None, None, :]
def stamp_add(fr, x, y, spr):
    h, w = spr.shape[:2]; x0, y0 = int(round(x)) - w // 2, int(round(y)) - h // 2
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if X1 <= X0 or Y1 <= Y0: return
    fr[Y0:Y1, X0:X1] += spr[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]
def stamp_over(fr, x, y, spr, alpha):
    h, w = spr.shape[:2]; x0, y0 = int(round(x)) - w // 2, int(round(y)) - h // 2
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if X1 <= X0 or Y1 <= Y0: return
    a = alpha[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0, None]; fr[Y0:Y1, X0:X1] = fr[Y0:Y1, X0:X1] * (1 - a) + spr[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0] * a

class Lights:
    """flicker / breathe every light region of the plate (labelled light mask), optional beat pulse inside a box"""
    def __init__(self, plate, seed, amp=(0.12, 0.4), boxes_on_beat=()):
        self.m, self.lab, self.n, self.glow = light_masks(plate); r = np.random.default_rng(seed)
        self.cyc = r.integers(1, 5, self.n + 1); self.ph = r.random(self.n + 1) * TAU; self.amp = r.uniform(*amp, self.n + 1)
        self.beat = np.zeros(self.n + 1, bool)
        for (x0, y0, x1, y1) in boxes_on_beat:
            ids = np.unique(self.lab[y0:y1, x0:x1]); self.beat[ids[ids > 0]] = True
    def apply(self, fr, a, t):
        if not self.n: return fr
        mod = np.ones(self.n + 1, np.float32)
        mod[1:] = 1 + self.amp[1:] * np.sin(TAU * self.cyc[1:] * t + self.ph[1:]) * 0.6
        p = pulse(t); mod[self.beat] = 0.85 + 0.6 * p
        lm = mod[self.lab] * (self.lab > 0) + (self.lab == 0)
        return fr + self.glow * (lm[..., None] - 1) * 0.9 + a * self.m[..., None] * (lm[..., None] - 1) * 0.5

class Twinkle:
    """small bright blobs (stars, fairy-light bulbs, city windows) each twinkling at its own integer rate"""
    def __init__(self, a, box, thr=0.62, max_area=60, seed=1, depth=0.55, warm=False):
        x0, y0, x1, y1 = box; L = a.max(-1); m = np.zeros(L.shape, bool); m[y0:y1, x0:x1] = L[y0:y1, x0:x1] > thr
        lab, n = ndi.label(m); sizes = ndi.sum(m, lab, range(1, n + 1)) if n else []
        keep = np.isin(lab, 1 + np.where((np.array(sizes) <= max_area))[0]) if n else m
        lab, n = ndi.label(ndi.binary_dilation(keep, iterations=1)); self.lab, self.n = lab, n
        r = np.random.default_rng(seed); self.cyc = r.integers(1, 6, n + 1); self.ph = r.random(n + 1) * TAU; self.depth = depth
        self.halo = ndi.gaussian_filter(a * (lab > 0)[..., None], (3, 3, 0)) * 1.6
        self.mask = (lab > 0).astype(np.float32)
    def apply(self, fr, a, t):
        if not self.n: return fr
        sn = np.sin(TAU * self.cyc[1:] * t + self.ph[1:])
        mod = np.ones(self.n + 1, np.float32); mod[1:] = 1 + self.depth * np.where(sn > 0, sn, sn * 0.45); mod[0] = 1
        k = mod[self.lab]; kk = np.maximum(ndi.gaussian_filter(k, 2) - 1, 0)
        return fr * (1 + (k - 1)[..., None] * self.mask[..., None] * 0.8) + self.halo * kk[..., None] * 0.6

def beams(fr, t, specs):
    """additive light cones: (x, y, base angle (rad, 0 = down), swing, cycles, width, length, colour, strength)"""
    for (x, y, a0, sw, cyc, wd, ln, col, st) in specs:
        ang = a0 + sw * math.sin(TAU * cyc * t)
        dx, dy = XX - x, YY - y; d = np.sqrt(dx * dx + dy * dy) + 1e-3
        th = np.arctan2(dx, dy) - ang
        cone = np.exp(-(th / wd) ** 2) * np.clip(1 - d / ln, 0, 1) ** 1.3 * np.clip(d / 40, 0, 1)
        fr += cone[..., None] * np.array(col, np.float32) * st
    return fr

class Smoke:
    def __init__(self, seed, band, col, strength, cell=110, cyc=1):
        self.n1 = tileable_noise(H, W, cell, seed); self.n2 = tileable_noise(H, W, cell // 2, seed + 1)
        y0, y1 = band; yy = YY[:, :1] / H
        self.mask = (np.clip((YY[:, 0] - y0) / 80, 0, 1) * np.clip((y1 - YY[:, 0]) / 80, 0, 1))[:, None]
        self.col = np.array(col, np.float32); self.st = strength; self.cyc = cyc
    def apply(self, fr, t):
        sx = int(t * W * self.cyc) % W; s1 = np.roll(self.n1, sx, 1); s2 = np.roll(self.n2, -2 * sx % W, 1)
        sm = np.clip((s1 * 0.65 + s2 * 0.35 - 0.38) * 2.0, 0, 1) * self.mask * self.st
        return fr * (1 - sm[..., None]) + sm[..., None] * self.col

class Motes:
    """loopable particles: kind = dust | embers | fireflies | sparks | pollen"""
    def __init__(self, kind, n, box, seed, col, size=(1.2, 2.6), cyc=(1, 2), src=None):
        r = np.random.default_rng(seed); self.kind, self.box, self.col, self.src = kind, box, np.array(col, np.float32), src
        self.p = [dict(x=r.uniform(box[0], box[2]), y=r.uniform(box[1], box[3]), c=int(r.integers(cyc[0], cyc[1] + 1)), ph=r.random(),
                       sz=r.uniform(*size), fx=int(r.integers(1, 3)), fy=int(r.integers(1, 3)), ax=r.uniform(10, 40), ay=r.uniform(8, 30),
                       bl=int(r.integers(2, 5)), dr=r.uniform(-1, 1)) for _ in range(n)]
        self.spr = {}
    def sp(self, s, a=1.0):
        k = (round(s * 4) / 4, round(a, 2))
        if k not in self.spr: self.spr[k] = soft_dot(max(0.6, k[0]), self.col, k[1])
        return self.spr[k]
    def apply(self, fr, t, weight=None):
        x0, y0, x1, y1 = self.box
        for q in self.p:
            u = (q['ph'] + q['c'] * t) % 1.0
            if self.kind == 'fireflies':
                x = q['x'] + q['ax'] * math.sin(TAU * (q['fx'] * t + q['ph'])); y = q['y'] + q['ay'] * math.sin(TAU * (q['fy'] * t + q['ph'] * 1.7))
                a = max(0.0, math.sin(TAU * (q['bl'] * t + q['ph']))) ** 2
                stamp_add(fr, x, y, self.sp(q['sz'] * 2.2, 0.35 * a)); stamp_add(fr, x, y, self.sp(q['sz'] * 0.8, 0.9 * a))
            elif self.kind in ('embers', 'sparks'):
                sx, sy = self.src if self.src else (q['x'], y1)
                x = sx + (q['x'] - (x0 + x1) / 2) * 0.35 * u + 10 * math.sin(TAU * (2 * u + q['ph'])) * u; y = sy - u * (sy - y0)
                a = (1 - u) ** 1.5 * min(1, u * 8)
                stamp_add(fr, x, y, self.sp(q['sz'] * (1 - 0.5 * u), 0.9 * a))
            else:   # dust / pollen: slow drift, wraps inside the box
                x = x0 + ((q['x'] - x0 + q['dr'] * (x1 - x0) * 0.25 * q['c'] * t * 4) % (x1 - x0)) if False else q['x'] + q['ax'] * math.sin(TAU * (q['fx'] * t + q['ph']))
                y = y0 + ((q['y'] - y0 + (y1 - y0) * u * 0.0) % (y1 - y0)) + q['ay'] * math.sin(TAU * (q['fy'] * t + q['ph'] * 0.7))
                tw = 0.55 + 0.45 * math.sin(TAU * (q['bl'] * t + q['ph']))
                w_ = 1.0 if weight is None else float(weight[int(min(H - 1, max(0, y))), int(min(W - 1, max(0, x)))])
                stamp_add(fr, x, y, self.sp(q['sz'], 0.55 * tw * w_))
        return fr

class Rain:
    """rain on a window: drops sliding down the glass (with a short trail) + streaks; box = glass area"""
    def __init__(self, box, seed, n=70, col=(0.85, 0.85, 1.0), strength=0.5):
        r = np.random.default_rng(seed); self.box = box; self.col = np.array(col, np.float32); self.st = strength
        self.d = [dict(x=r.uniform(box[0], box[2]), c=int(r.integers(1, 4)), ph=r.random(), ln=r.uniform(8, 26), w=r.uniform(0.7, 1.6)) for _ in range(n)]
        self.st_ = [dict(x=r.uniform(box[0], box[2]), y=r.uniform(box[1], box[3]), ph=r.random(), c=int(r.integers(1, 4))) for _ in range(n)]
    def apply(self, fr, t):
        x0, y0, x1, y1 = self.box
        for q in self.d:
            u = (q['ph'] + q['c'] * t) % 1.0; y = y0 + u * (y1 - y0); x = q['x'] + 2 * math.sin(TAU * u * 3 + q['ph'] * 5)
            for k in range(int(q['ln'])):
                yy = int(y - k); xx = int(x)
                if y0 <= yy < y1 and 0 <= xx < W - 1:
                    a = self.st * (1 - k / q['ln']) * 0.5; fr[yy, xx] += self.col * a; fr[yy, xx + 1] += self.col * a * 0.4
            stamp_add(fr, x, y, soft_dot(q['w'] * 1.3, self.col, self.st * 0.7))
        for q in self.st_:                                      # static beads catching the light
            a = 0.25 + 0.25 * math.sin(TAU * (q['c'] * t + q['ph']))
            stamp_add(fr, q['x'], q['y'], soft_dot(0.9, self.col, self.st * a * 0.6))
        return fr

def warp_box(fr, box, dx, dy):
    """remap a box of the frame by per-pixel offsets (arrays sized to the box): sample at (y - dy, x - dx)"""
    x0, y0, x1, y1 = box; sub = fr[y0:y1, x0:x1]; hh, ww = sub.shape[:2]
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
    out = np.stack([ndi.map_coordinates(sub[..., c], [yy - dy, xx - dx], order=1, mode='nearest') for c in range(3)], -1)
    fr[y0:y1, x0:x1] = out; return fr

class Sway:
    """trees: sideways sway growing with height above a base line, different phase per column band"""
    def __init__(self, box, base_y, amp, seed, cyc=1):
        self.box, self.base, self.amp, self.cyc = box, base_y, amp, cyc
        r = np.random.default_rng(seed); x0, y0, x1, y1 = box
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        self.h = np.clip((base_y - yy) / max(1, base_y - y0), 0, 1) ** 1.5
        self.ph = (np.sin(xx / 70 + r.random() * 6) * 0.9).astype(np.float32)
    def apply(self, fr, t):
        dx = self.amp * self.h * np.sin(TAU * self.cyc * t + self.ph); return warp_box(fr, self.box, dx, np.zeros_like(dx))

class Flame:
    """campfire: upward-flowing noise displacement + brightness flicker inside the flame mask"""
    def __init__(self, a, box, seed):
        x0, y0, x1, y1 = box; self.box = box; sub = a[y0:y1, x0:x1]
        mx, mn = sub.max(-1), sub.min(-1); self.m = ndi.gaussian_filter(((mx > 0.55) & (sub[..., 0] > sub[..., 2] + 0.25)).astype(np.float32), 2)
        hh, ww = sub.shape[:2]; self.n = tileable_noise(hh * 2, ww, 14, seed)[:, :ww]; self.n2 = tileable_noise(hh * 2, ww, 7, seed + 3)[:, :ww]
        self.hh = hh; self.vy = np.clip((np.arange(hh)[:, None] - 0) / hh, 0, 1)
    def apply(self, fr, t):
        x0, y0, x1, y1 = self.box; off = int(t * self.hh * 4) % self.hh
        n = np.roll(self.n, off, 0)[:self.hh] - 0.5; n2 = np.roll(self.n2, 2 * off, 0)[:self.hh] - 0.5
        dx = (n * 6 + n2 * 3) * self.m * (1.2 - self.vy); dy = (n2 * 5) * self.m
        warp_box(fr, self.box, dx, dy)
        fl = 1 + 0.18 * math.sin(TAU * 7 * t) * math.sin(TAU * 3 * t + 1) + 0.12 * n * 2
        fr[y0:y1, x0:x1] *= (1 + (fl - 1) * self.m)[..., None]
        return fr

def fire_glow(fr, t, x, y, r, col, st):
    f = 0.75 + 0.15 * math.sin(TAU * 5 * t) + 0.1 * math.sin(TAU * 11 * t + 0.7)
    g = np.exp(-(((XX - x) / r) ** 2 + ((YY - y) / (r * 0.6)) ** 2)) * st * f
    return fr + g[..., None] * np.array(col, np.float32)

def breathe(fr, t, cx, cy, rx, ry, amp, cyc=2):
    x0, y0, x1, y1 = int(cx - rx * 1.4), int(cy - ry * 1.6), int(cx + rx * 1.4), int(cy + ry * 1.3)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    w = np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) * 1.3)
    k = amp * (0.5 - 0.5 * math.cos(TAU * cyc * t))
    dy = -k * w * np.clip((cy + ry - yy) / (2 * ry), 0, 1)     # back rises, belly on the cushion stays put
    return warp_box(fr, (x0, y0, x1, y1), np.zeros_like(dy), dy)

def tail_flick(fr, t, tip, base, amp, cyc=1):
    (tx, ty), (bx, by) = tip, base; x0, y0, x1, y1 = int(min(tx, bx) - 18), int(min(ty, by) - 14), int(max(tx, bx) + 18), int(max(ty, by) + 14)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    L = math.hypot(tx - bx, ty - by) + 1e-3; u = np.clip(((xx - bx) * (tx - bx) + (yy - by) * (ty - by)) / L ** 2, 0, 1)
    dist = np.abs((xx - bx) * (ty - by) - (yy - by) * (tx - bx)) / L; w = u ** 2 * np.exp(-(dist / 12) ** 2)
    s = math.sin(TAU * cyc * t) ** 3 * amp                    # occasional flick: mostly still, a flip each cycle
    return warp_box(fr, (x0, y0, x1, y1), np.zeros_like(w), -w * s)

def record_glint(fr, t, cx, cy, rx, ry, rev=4, st=0.5):
    for k in range(2):
        th = TAU * (rev * t) + k * math.pi
        x, y = cx + rx * 0.7 * math.cos(th), cy + ry * 0.7 * math.sin(th)
        g = np.exp(-(((XX - x) / (rx * 0.22)) ** 2 + ((YY - y) / (ry * 0.35 + 1)) ** 2)) * st * (0.6 + 0.4 * abs(math.cos(th)))
        fr += g[..., None] * np.array([1.0, 0.92, 1.0], np.float32)
    return fr

def candles(fr, a, t, box, seed, st=0.22):
    x0, y0, x1, y1 = box; sub = a[y0:y1, x0:x1]; L = sub.mean(-1)
    m = (L > 0.8) & (sub[..., 0] > sub[..., 2]); lab, n = ndi.label(m); r = np.random.default_rng(seed)
    objs = [(int((lab[sl] == i).sum()), i, sl) for i, sl in enumerate(ndi.find_objects(lab), 1) if sl is not None]
    objs = [o for o in sorted(objs, reverse=True) if 4 <= o[0] <= 300][:3]
    for _, i, sl in objs:
        cy, cx = (sl[0].start + sl[0].stop) / 2 + y0, (sl[1].start + sl[1].stop) / 2 + x0
        ph = r.random() * TAU; f = 0.75 + 0.2 * math.sin(TAU * 9 * t + ph) + 0.12 * math.sin(TAU * 23 * t + ph * 2)
        g = np.exp(-(((XX - cx) / 46) ** 2 + ((YY - cy) / 40) ** 2)) * st * f
        fr += g[..., None] * np.array([1.0, 0.7, 0.35], np.float32)
        warp_box(fr, (int(cx - 6), int(cy - 14), int(cx + 6), int(cy + 6)), np.full((20, 12), 1.2 * math.sin(TAU * 6 * t + ph), np.float32), np.zeros((20, 12), np.float32))
    return fr

def strobe(fr, t, beats=(0, 8), st=0.22, col=(1, 0.85, 0.95)):
    b = beat_of(t); k = 0.0
    for q in beats: d = (b - q) % BEATS; k = max(k, math.exp(-d * 6))
    return fr + k * st * np.array(col, np.float32)

def inpaint(a, m, it=6):
    """fill masked pixels from their surroundings (normalised convolution at growing radii)"""
    out = a.copy(); known = (~m).astype(np.float32)
    for s in (2, 4, 8, 16, 32, 64):
        num = ndi.gaussian_filter(out * known[..., None], (s, s, 0)); den = ndi.gaussian_filter(known, s)[..., None]
        fill = num / np.maximum(den, 1e-4); upd = (known < 0.5) & (den[..., 0] > 0.02)
        out[upd] = fill[upd]; known = np.maximum(known, upd.astype(np.float32) * 0.999)
    return out

class Crowd:
    """hip-hop crowd: silhouettes split into far / mid / near layers that bounce (stretch from their feet) on the beat,
    the far row as a slow wave; drawn over an in-painted clean plate"""
    def __init__(self, a, lt, ct, exclude, seed):
        L = a.mean(-1); C = a.max(-1) - a.min(-1)
        m = (L < lt) & (C < ct); m[:235] = False
        for (x0, y0, x1, y1) in exclude: m[y0:y1, x0:x1] = False
        m = ndi.binary_closing(ndi.binary_opening(m, iterations=1), iterations=2)
        lab, n = ndi.label(m); sizes = ndi.sum(m, lab, range(1, n + 1)); m = np.isin(lab, 1 + np.where(sizes > 150)[0]); lab, n = ndi.label(m)
        self.layers = []
        groups = {'far': np.zeros_like(m), 'mid': np.zeros_like(m), 'near': np.zeros_like(m)}
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            if sl is None: continue
            bot = sl[0].stop; g = 'near' if bot > 600 else 'mid' if bot > 482 else 'far'
            groups[g] |= lab == i
        allm = ndi.binary_dilation(m, iterations=2)
        self.clean = inpaint(a, allm)
        for g, (amp, base, lag) in {'far': (2.5, 480, 0.0), 'mid': (5.0, 600, 0.25), 'near': (9.0, H + 40, 0.5)}.items():
            gm = groups[g]
            if not gm.any(): continue
            ys, xs = np.where(gm); box = (max(0, xs.min() - 4), max(0, ys.min() - 16), min(W, xs.max() + 5), min(H, ys.max() + 3))
            al = ndi.gaussian_filter(ndi.binary_dilation(gm, iterations=1).astype(np.float32), 0.7)
            self.layers.append(dict(g=g, amp=amp, base=base, lag=lag, box=box, rgba=np.dstack([a, al])))
        log(f'    crowd layers: ' + ', '.join(f"{l['g']} {l['box']}" for l in self.layers))
    def apply(self, fr, t):
        fr[:] = self.clean
        b = beat_of(t)
        for l in self.layers:
            x0, y0, x1, y1 = l['box']; sub = l['rgba'][y0:y1, x0:x1]; hh, ww = sub.shape[:2]
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
            ph = (b + l['lag'] + (0.35 * np.sin(xx / 55.0) if l['g'] == 'far' else 0)) % 1.0
            bounce = np.abs(np.sin(np.pi * ph)) ** 1.5
            dy = -l['amp'] * bounce * np.clip((l['base'] - yy) / (l['base'] - y0 + 1), 0, 1)
            ly, lx = np.mgrid[0:hh, 0:ww].astype(np.float32)
            out = np.stack([ndi.map_coordinates(sub[..., c], [ly - dy, lx], order=1, mode='nearest') for c in range(4)], -1)
            al = out[..., 3:4]; fr[y0:y1, x0:x1] = fr[y0:y1, x0:x1] * (1 - al) + out[..., :3] * al
        return fr

def rays_field(origin_dir, strength):
    (ox, oy), (dx, dy) = origin_dir
    n = np.array([-dy, dx]) / math.hypot(dx, dy); proj = (XX - ox) * n[0] + (YY - oy) * n[1]
    along = ((XX - ox) * dx + (YY - oy) * dy) / math.hypot(dx, dy)
    return np.clip(np.sin(proj / 38) * 0.5 + 0.5, 0, 1) ** 6 * np.clip(along / 200, 0, 1) * np.clip(1 - along / 900, 0, 1) * strength

# per scene + variant: list of effect closures built from the plate
def build_fx(sc, variant, a, plate):
    r = lambda k: hash((sc, variant, k)) % 1000
    F = []; L = Lights(plate, r('L'))
    if sc == 'alt-rock':
        night = variant == 'night'
        L = Lights(plate, 11, amp=(0.15, 0.45), boxes_on_beat=[(220, 0, 380, 60), (900, 0, 1060, 60)])
        smoke = Smoke(21, (300, 640), (0.55, 0.42, 0.5) if night else (0.75, 0.75, 0.8), 0.32 if night else 0.18, cyc=1)
        dust = Motes('dust', 60, (200, 60, 1100, 460), 23, (1.0, 0.9, 0.95), size=(0.8, 1.8))
        bw = rays_field(((290, 20), (1, 1.6)), 1.0) + rays_field(((990, 20), (-1, 1.6)), 1.0)
        specs = [(295, 25, -0.42, 0.22, 1, 0.13, 900, (1.0, 0.25, 0.65) if night else (1, 0.95, 0.85), 0.20 if night else 0.10),
                 (985, 25, 0.42, 0.22, 1, 0.13, 900, (1.0, 0.2, 0.25) if night else (1, 0.95, 0.85), 0.20 if night else 0.10),
                 (640, -40, 0.0, 0.35, 2, 0.09, 800, (0.9, 0.8, 1.0), 0.10 if night else 0.05)]
        def f(fr, t):
            fr = L.apply(fr, a, t); fr = beams(fr, t, specs); fr = smoke.apply(fr, t)
            fr = dust.apply(fr, t, weight=np.clip(bw, 0.15, 1)); fr = strobe(fr, t, (0, 4, 8, 12) if night else (0,), 0.16 if night else 0.06)
            return fr
        F.append(f)
    elif sc == 'hip-hop':
        night = variant == 'night'
        crowd = Crowd(a, 0.2, 0.13 if night else 0.09, [(935, 425, 1185, 615)], 31)
        tw = Twinkle(a, (0, 0, W, 330), thr=0.6 if night else 0.85, max_area=90, seed=32, depth=0.5)
        La = Lights(plate, 33, boxes_on_beat=[(935, 425, 1185, 615)])
        def f(fr, t):
            fr = crowd.apply(fr, t); fr = tw.apply(fr, a, t); fr = La.apply(fr, crowd.clean, t)
            p = pulse(t); box = (935, 425, 1185, 615)
            fr[box[1]:box[3], box[0]:box[2]] += La.glow[box[1]:box[3], box[0]:box[2]] * (0.5 * p)
            return fr
        F.append(f)
    elif sc == 'rnb':
        night = variant == 'night'
        rain = Rain((6, 20, 625, 488), 41, n=80 if night else 60, col=(0.9, 0.85, 1.0), strength=0.45 if night else 0.35)
        tw = Twinkle(a, (0, 150, 625, 488), thr=0.55 if night else 0.8, max_area=40, seed=42, depth=0.45)
        rec = (1062, 441, 66, 9) if night else (1077, 445, 60, 7)
        def f(fr, t):
            fr = L.apply(fr, a, t); fr = tw.apply(fr, a, t); fr = rain.apply(fr, t)
            fr = candles(fr, a, t, (380, 460, 520, 560), 43, 0.2 if night else 0.06); fr = record_glint(fr, t, *rec, rev=4, st=0.35)
            return fr
        F.append(f)
    elif sc == 'indie-rock':
        day = variant == 'day'
        tw = Twinkle(a, (100, 0, 1180, 130), thr=0.7 if day else 0.55, max_area=80, seed=51, depth=0.5)
        rays = rays_field(((330, 120), (1, 0.85)), 1.0) if day else np.zeros((H, W), np.float32)
        dust = Motes('dust', 90 if day else 40, (300, 120, 900, 620), 52, (1.0, 0.85, 0.55) if day else (0.8, 0.8, 1.0), size=(0.8, 2.0))
        La = Lights(plate, 53, boxes_on_beat=[(980, 330, 1220, 560)])
        def f(fr, t):
            fr = La.apply(fr, a, t); fr = tw.apply(fr, a, t)
            if day: fr = fr + rays[..., None] * (0.06 + 0.035 * math.sin(TAU * t)) * np.array([1.0, 0.8, 0.45], np.float32)
            fr = dust.apply(fr, t, weight=np.clip(rays * 1.5 + (0.25 if day else 0.6), 0, 1))
            fr = breathe(fr, t, 182, 503, 52, 34, 2.2, cyc=2); fr = tail_flick(fr, t, (228, 536), (175, 538), 4.0, cyc=1)
            return fr
        F.append(f)
    elif sc == 'acoustic':
        night = variant == 'night'
        flame = Flame(a, (470, 470, 620, 610), 61)
        embers = Motes('embers', 34, (450, 260, 640, 560), 62, (1.0, 0.6, 0.2), size=(0.9, 1.8), cyc=(1, 3), src=(535, 560))
        flies = Motes('fireflies', 34 if night else 0, (0, 360, W, 700), 63, (0.85, 1.0, 0.35), size=(1.0, 1.8))
        pollen = Motes('dust', 0 if night else 50, (0, 200, W, 650), 64, (1.0, 1.0, 0.85), size=(0.8, 1.5))
        stars = Twinkle(a, (300, 0, 950, 330), thr=0.62, max_area=25, seed=65, depth=0.7) if night else None
        swayL = Sway((0, 0, 330, 470), 470, 2.2, 66); swayR = Sway((760, 0, W, 470), 470, 2.2, 67)
        mist = Smoke(68, (330, 520), (0.85, 0.88, 0.92), 0.22, cell=140) if not night else None
        def f(fr, t):
            fr = swayL.apply(fr, t); fr = swayR.apply(fr, t)
            if stars: fr = stars.apply(fr, a, t)
            if mist: fr = mist.apply(fr, t)
            fr = flame.apply(fr, t); fr = fire_glow(fr, t, 540, 560, 230, (1.0, 0.55, 0.2), 0.10 if night else 0.05)
            fr = embers.apply(fr, t); fr = flies.apply(fr, t); fr = pollen.apply(fr, t)
            return fr
        F.append(f)
    return F

def bg_frames(sc, variant, plate, nfr):
    a = np.asarray(plate).astype(np.float32) / 255
    fx = build_fx(sc, variant, a, plate)
    for i in range(nfr):
        t = i / nfr; fr = a.copy()
        for f in fx: fr = f(fr, t)
        yield (np.clip(fr, 0, 1) * 255).astype(np.uint8)

def build_bg(sc, variant, out):
    cfg = SCENES[sc]; sid = f'{sc}-{variant}'
    plate = load_plate(plate_path(sc, variant)); plate.save(f'{out}/bg/{sid}.jpg', quality=88)
    _, _, _, glow = light_masks(plate); Image.fromarray((glow * 255).astype(np.uint8)).save(f'{out}/bg/{sid}-glow.jpg', quality=85)
    frames = list(bg_frames(sc, variant, plate, NFR))
    encode(iter(frames), f'{out}/bg/{sid}.mp4', W, H, FPS, crf=26)
    cs = Image.new('RGB', (W // 4 * 4, H // 4 * 2))
    for i, k in enumerate(np.linspace(0, len(frames) - 1, 8).astype(int)): cs.paste(Image.fromarray(frames[k]).resize((W // 4, H // 4)), ((i % 4) * W // 4, (i // 4) * H // 4))
    cs.save(f'{CHECK}/{sid}-frames.jpg', quality=85)
    Image.fromarray(frames[len(frames) // 3]).save(f'{CHECK}/{sid}-frame.jpg', quality=90)
    log(f'[{sid}] loop {os.path.getsize(f"{out}/bg/{sid}.mp4") // 1024} KB')

# ------------------------------------------------------------------ character animation
def dance_seq(P, poses, tier, beats=8, fpb=6, style='bob'):
    seq = [P[p] for p in poses]
    per = {'slow': 4, 'mid': 2, 'fast': 1}[tier]
    amp = {'slow': (0.012, 0.010, 0.035, 0.020), 'mid': (0.022, 0.016, 0.055, 0.035), 'fast': (0.034, 0.02, 0.07, 0.05)}[tier]
    out = []
    for i in range(beats * fpb):
        t = i / fpb; b = t % 1; beat = int(t); pose = seq[(beat // per) % len(seq)]
        bob = -amp[0] * abs(math.sin(math.pi * b)); sway = amp[1] * math.sin(TAU * t / 2); tilt = amp[2] * math.sin(TAU * t / 2 + 0.6)
        if style == 'nod': bob = -amp[0] * 1.3 * math.sin(math.pi * b) ** 2; tilt *= 0.5
        if style == 'sway': bob *= 0.5; sway *= 1.6; tilt *= 1.2
        sq = amp[3] * max(0, 1 - b * 4); flap = math.sin(TAU * t / (2 if tier == 'slow' else 1)) * (0.6 if tier == 'slow' else 0.9)
        out.append(pose.render(flap=flap, bob=bob, sway=sway, tilt=tilt, sx=1 + sq * 0.6, sy=1 - sq, halo=0.5 * max(0, 1 - b * 2.5)))
    return out

def heart_sprite(s, col=(255, 110, 170)):
    im = Image.new('RGBA', (s * 2, s * 2)); d = ImageDraw.Draw(im); r = s * 0.5
    d.ellipse((s - 2 * r, s - r * 1.4, s, s + r * 0.6), fill=col + (255,)); d.ellipse((s, s - r * 1.4, s + 2 * r, s + r * 0.6), fill=col + (255,))
    d.polygon([(s - 2 * r + 1, s - r * 0.2), (s + 2 * r - 1, s - r * 0.2), (s, s + 1.9 * r)], fill=col + (255,))
    return im
def glow_dot(r, col):
    s = int(r * 4); y, x = np.mgrid[-s:s + 1, -s:s + 1]; g = np.exp(-(x * x + y * y) / (2 * r * r)); core = np.exp(-(x * x + y * y) / (2 * (r * 0.35) ** 2))
    a = np.clip(g * 0.55 + core, 0, 1); rgb = np.ones(g.shape + (3,)) * np.array(col)[None, None, :]; rgb = rgb * (1 - core[..., None] * 0.5) + 255 * core[..., None] * 0.5
    return Image.fromarray(np.dstack([rgb, a * 255]).clip(0, 255).astype(np.uint8), 'RGBA')

def emote_seq(P, pose, style, pose_b=None):
    """24 frames = 4 beats at 6 fps per beat (tempo-synced in the app)"""
    fpb = 6; beats = 4; out = []; p = P[pose]; pb = P.get(pose_b) if pose_b else None
    for i in range(beats * fpb):
        t = i / fpb; b = t % 1
        if style == 'hop':
            h = math.sin(math.pi * b); land = max(0, 1 - b * 5) if t >= 1 else 0
            f = p.render(bob=-0.06 * h, sy=1 - 0.06 * land, sx=1 + 0.04 * land, flap=math.sin(TAU * t), halo=0.3 * h)
        elif style == 'nod':
            nod = math.sin(math.pi * b) ** 2
            f = p.render(tilt=0.05 * nod * (1 if int(t) % 2 else -1), bob=0.03 * nod, sy=1 - 0.05 * nod, sx=1 + 0.03 * nod, flap=-nod, halo=0.4 * (1 - b))
        elif style == 'breathe':
            ph = t / beats; f = p.render(sway=0.008 * math.sin(TAU * ph), tilt=0.04 * math.sin(TAU * ph), sy=1 + 0.015 * math.sin(TAU * ph * 2), flap=0.25 * math.sin(TAU * ph))
        elif style == 'droop':
            ph = t / beats; f = p.render(sway=0.01 * math.sin(TAU * ph), tilt=-0.03 + 0.025 * math.sin(TAU * ph), bob=0.008, sy=0.99, flap=-0.3 + 0.15 * math.sin(TAU * ph))
        elif style == 'sing':
            f = p.render(sway=0.014 * math.sin(TAU * t / 2), tilt=0.05 * math.sin(TAU * t / 2), bob=-0.012 * math.sin(math.pi * b), halo=0.25 + 0.25 * math.sin(math.pi * b), flap=0.4 * math.sin(TAU * t / 2))
        elif style == 'shake':
            k = max(0, 1 - t / 2.2)
            f = p.render(shake=0.015 * k * math.sin(TAU * t * 3), bob=-0.03 * max(0, 1 - t * 1.5), sy=1 + 0.04 * k, sx=1 - 0.02 * k, flap=1.0 * k, halo=0.8 * k)
        elif style == 'sway':
            f = p.render(sway=0.022 * math.sin(TAU * t / 2), tilt=0.07 * math.sin(TAU * t / 2), bob=-0.008 * abs(math.sin(math.pi * b)), flap=0.5 * math.sin(TAU * t / 2), halo=0.3)
        elif style == 'lean':
            f = p.render(tilt=0.025 + 0.012 * math.sin(TAU * t / 4), bob=-0.006 * math.sin(math.pi * b) ** 2, flap=0.2 * math.sin(TAU * t / 2))
        elif style == 'shimmy':
            f = (p if (int(t * 2) % 2 == 0 or not pb) else pb).render(sway=0.016 * math.sin(TAU * t * 2), tilt=0.03 * math.sin(TAU * t * 2), bob=-0.015 * math.sin(math.pi * ((t * 2) % 1)), flap=0.7 * math.sin(TAU * t * 2))
        elif style == 'spin':   # coin-flip spin: squash x and mirror at the half turn, twice per 4 beats
            c = math.cos(TAU * t / 2); f = p.render(sx=max(0.12, abs(c)), bob=-0.03 * abs(math.sin(TAU * t / 2)), flap=0.8, halo=0.5 * abs(math.sin(TAU * t / 2)))
            if c < 0: f = f.transpose(Image.FLIP_LEFT_RIGHT)
        elif style == 'clap':
            hb = (t * 2) % 1; f = (pb if pb and int(t * 2) % 2 else p).render(bob=-0.02 * math.sin(math.pi * hb), sy=1 - 0.03 * max(0, 1 - hb * 4), flap=0.6 * math.sin(TAU * t), halo=0.3 * (1 - hb))
        elif style == 'strum':   # guitar: down-strum dip per beat, alternate neck-up pose every 2 beats
            q = (pb if pb and int(t / 2) % 2 else p); dip = math.sin(math.pi * b) ** 2
            f = q.render(bob=0.012 * dip, tilt=0.03 * math.sin(TAU * t / 2) - 0.02 * dip, sx=1 + 0.02 * max(0, 1 - b * 4), sy=1 - 0.03 * max(0, 1 - b * 4), flap=0.5 * math.sin(TAU * t), halo=0.4 * (1 - b))
        elif style == 'bass':    # bass: low, heavy bob on every beat + knee bend
            k = max(0, 1 - b * 3); f = p.render(bob=0.02 * k, sy=1 - 0.045 * k, sx=1 + 0.03 * k, tilt=0.025 * math.sin(TAU * t / 2), flap=-0.4 * k + 0.2, halo=0.35 * k)
        elif style == 'drum':    # drums: hit on every half beat, alternating arms
            hb = (t * 2) % 1; q = (pb if pb and int(t * 2) % 2 else p); k = max(0, 1 - hb * 4)
            f = q.render(bob=0.01 * k, sy=1 - 0.03 * k, sx=1 + 0.02 * k, shake=0.004 * k, flap=0.5 * k, halo=0.5 * k)
        elif style == 'mic':     # mic: lean into it on the beat, sway with the phrase
            f = p.render(sway=0.016 * math.sin(TAU * t / 2), tilt=0.045 * math.sin(TAU * t / 2), bob=-0.015 * math.sin(math.pi * b), halo=0.3 + 0.3 * math.sin(math.pi * b), flap=0.45 * math.sin(TAU * t / 2))
        else: raise SystemExit('unknown style ' + style)
        out.append(f)
    if style in ('hearts', 'fireflies'): pass
    return out

def with_hearts(frames, seed=3):
    r = np.random.default_rng(seed); hs = [heart_sprite(int(s)) for s in r.uniform(10, 18, 6)]; ph = r.random(6); xs = r.uniform(0.25, 0.75, 6)
    out = []
    for i, f in enumerate(frames):
        f = f.copy(); t = i / len(frames)
        for k, h in enumerate(hs):
            u = (ph[k] + t * 2) % 1.0; x = int(FR * xs[k] + 10 * math.sin(TAU * (u * 2 + ph[k]))); y = int(FR * (0.55 - 0.5 * u))
            a = min(1, u * 6) * (1 - u); hh = h.copy(); hh.putalpha(hh.getchannel('A').point(lambda v: int(v * a))); f.alpha_composite(hh, (x - h.width // 2, max(0, y)))
        out.append(f)
    return out
def with_fireflies(frames, seed=5):
    r = np.random.default_rng(seed); n = 7; ph = r.random(n); rad = r.uniform(0.25, 0.42, n); hgt = r.uniform(0.25, 0.7, n); dots = [glow_dot(r_, (210, 255, 90)) for r_ in r.uniform(2.0, 3.4, n)]
    out = []
    for i, f in enumerate(frames):
        f = f.copy(); t = i / len(frames)
        for k in range(n):
            th = TAU * (t * (1 if k % 2 else -1) + ph[k]); x = FR / 2 + FR * rad[k] * math.cos(th); y = FR * hgt[k] + FR * 0.06 * math.sin(th * 2)
            bl = 0.5 + 0.5 * math.sin(TAU * (2 * t + ph[k])); d = dots[k].copy(); d.putalpha(d.getchannel('A').point(lambda v: int(v * bl)))
            f.alpha_composite(d, (int(x - d.width / 2), int(y - d.height / 2)))
        out.append(f)
    return out

# outfit specs: dance A/B poses per tier, emotes name -> (pose, style[, pose_b][, extra]), instruments, events
STD_EVENTS = {'start': 'happy', 'drop': 'headbang', 'hit': 'shocked', 'quiet': 'yawn', 'sad': 'sad', 'vocals': 'sing'}
OUTFITS = {
  'static-halo': dict(dance={'slow': (['guitar', 'idle'], 'bob'), 'mid': (['guitar', 'guitar-b'], 'bob'), 'fast': (['guitar-b', 'guitar'], 'nod')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('headbang', 'nod'), 'shocked': ('shocked', 'shake'), 'yawn': ('yawn', 'breathe'), 'sad': ('sad', 'droop'), 'sing': ('mic', 'sing'),
              'inst-guitar': ('guitar', 'strum', 'guitar-b'), 'inst-bass': ('bass', 'bass'), 'inst-drums': ('drums', 'drum', 'drums-b'), 'inst-mic': ('mic', 'mic')},
      events=dict(STD_EVENTS, rise='inst-guitar'), instruments={'guitar': 'inst-guitar', 'bass': 'inst-bass', 'drums': 'inst-drums', 'vocals': 'inst-mic'}),
  'static-halo-rare': dict(dance={'slow': (['guitar', 'idle'], 'bob'), 'mid': (['guitar', 'bass'], 'bob'), 'fast': (['guitar', 'drums'], 'nod')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('guitar', 'nod'), 'shocked': ('happy', 'shake'), 'yawn': ('idle', 'breathe'), 'sad': ('idle', 'droop'), 'sing': ('mic', 'sing'),
              'inst-guitar': ('guitar', 'strum'), 'inst-bass': ('bass', 'bass'), 'inst-drums': ('drums', 'drum'), 'inst-mic': ('mic', 'mic')},
      events=dict(STD_EVENTS, rise='inst-guitar'), instruments={'guitar': 'inst-guitar', 'bass': 'inst-bass', 'drums': 'inst-drums', 'vocals': 'inst-mic'}),
  'block-party': dict(dance={'slow': (['idle', 'dance-a'], 'nod'), 'mid': (['dance-a', 'dance-b'], 'nod'), 'fast': (['dance-b', 'dance-a'], 'bob')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('headbang', 'nod'), 'shocked': ('shocked', 'shake'), 'yawn': ('yawn', 'breathe'), 'sad': ('sad', 'droop'), 'sing': ('sing', 'sing'),
              'lean': ('idle', 'lean'), 'shimmy': ('dance-b', 'shimmy')},
      events=dict(STD_EVENTS, rise='shimmy', quiet='lean')),
  'block-party-rare': dict(dance={'slow': (['idle', 'dance-a'], 'nod'), 'mid': (['dance-a', 'dance-b'], 'nod'), 'fast': (['dance-b', 'dance-a'], 'bob')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('headbang', 'nod'), 'shocked': ('happy', 'shake'), 'yawn': ('idle', 'breathe'), 'sad': ('idle', 'droop'), 'sing': ('sing', 'sing'),
              'lean': ('idle', 'lean'), 'shimmy': ('dance-b', 'shimmy')},
      events=dict(STD_EVENTS, rise='shimmy', quiet='lean')),
  'velvet-hour': dict(dance={'slow': (['dance-a', 'idle'], 'sway'), 'mid': (['dance-a', 'dance-b'], 'sway'), 'fast': (['dance-b', 'dance-a'], 'bob')},
      emotes={'happy': ('hearts', 'hop'), 'headbang': ('dance-b', 'nod'), 'shocked': ('shocked', 'shake'), 'yawn': ('yawn', 'breathe'), 'sad': ('sad', 'droop'), 'sing': ('sing', 'sing'),
              'hearts': ('hearts', 'sway', None, 'hearts'), 'spin': ('spin', 'spin')},
      events=dict(STD_EVENTS, rise='spin', quiet='hearts')),
  'velvet-hour-rare': dict(dance={'slow': (['dance-a', 'idle'], 'sway'), 'mid': (['dance-a', 'dance-b'], 'sway'), 'fast': (['dance-b', 'dance-a'], 'bob')},
      emotes={'happy': ('hearts', 'hop'), 'headbang': ('dance-b', 'nod'), 'shocked': ('spin', 'shake'), 'yawn': ('idle', 'breathe'), 'sad': ('idle', 'droop'), 'sing': ('sing', 'sing'),
              'hearts': ('hearts', 'sway', None, 'hearts'), 'spin': ('spin', 'spin')},
      events=dict(STD_EVENTS, rise='spin', quiet='hearts')),
  'garage-days': dict(dance={'slow': (['dance-a', 'idle'], 'bob'), 'mid': (['dance-a', 'dance-b'], 'bob'), 'fast': (['dance-b', 'dance-a'], 'nod')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('headbang', 'nod'), 'shocked': ('shocked', 'shake'), 'yawn': ('daydream', 'breathe'), 'sad': ('sad', 'droop'), 'sing': ('sing', 'sing'),
              'tambourine': ('dance-b', 'clap'), 'daydream': ('daydream', 'breathe')},
      events=dict(STD_EVENTS, rise='tambourine', quiet='daydream')),
  'garage-days-rare': dict(dance={'slow': (['dance-a', 'idle'], 'bob'), 'mid': (['dance-a', 'dance-b'], 'bob'), 'fast': (['dance-b', 'dance-a'], 'nod')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('dance-a', 'nod'), 'shocked': ('happy', 'shake'), 'yawn': ('daydream', 'breathe'), 'sad': ('daydream', 'droop'), 'sing': ('sing', 'sing'),
              'tambourine': ('dance-b', 'clap'), 'daydream': ('daydream', 'breathe')},
      events=dict(STD_EVENTS, rise='tambourine', quiet='daydream')),
  'campfire-wings': dict(dance={'slow': (['kneel', 'idle'], 'sway'), 'mid': (['idle', 'dance-b'], 'sway'), 'fast': (['dance-b', 'happy'], 'bob')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('dance-b', 'nod'), 'shocked': ('shocked', 'shake'), 'yawn': ('yawn', 'breathe'), 'sad': ('hug', 'droop'), 'sing': ('sing', 'sing'),
              'hug-knees': ('hug', 'breathe'), 'fireflies': ('fireflies', 'sway', None, 'fireflies')},
      events=dict(STD_EVENTS, rise='fireflies', sad='hug-knees')),
  'campfire-wings-rare': dict(dance={'slow': (['dance-a', 'idle'], 'sway'), 'mid': (['dance-a', 'fireflies'], 'sway'), 'fast': (['happy', 'dance-a'], 'bob')},
      emotes={'happy': ('happy', 'hop'), 'headbang': ('happy', 'nod'), 'shocked': ('happy', 'shake'), 'yawn': ('hug', 'breathe'), 'sad': ('hug', 'droop'), 'sing': ('sing', 'sing'),
              'hug-knees': ('hug', 'breathe'), 'fireflies': ('fireflies', 'sway', None, 'fireflies')},
      events=dict(STD_EVENTS, rise='fireflies', sad='hug-knees')),
}

def build_outfit(oid, out, display):
    spec = OUTFITS[oid]; d = f'{A.art}/char/{oid}'
    idle = chroma_key(Image.open(f'{d}/idle.png'))
    bb = idle.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox(); k_out = FR * 0.9 / (bb[3] - bb[1])
    need = set(p for t in spec['dance'].values() for p in t[0]) | set(e[0] for e in spec['emotes'].values()) | set(e[2] for e in spec['emotes'].values() if len(e) > 2 and e[2]) | {'idle'}
    P = {p: Pose(Image.open(f'{d}/{p}.png'), k=k_out, flap_k=0.5) for p in sorted(need)}
    ch = {'use': 'custom', 'name': display, 'tier': 'auto', 'dance': {}, 'idle': f'char/{oid}-idle.webp', 'emotes': {}, 'events': dict(spec['events'])}
    if A.no_char and os.path.exists(f'{out}/char/{oid}-idle.webp'): pass
    else: P['idle'].im.save(f'{out}/char/{oid}-idle.webp', quality=88, method=6)
    for tier, bpm in [('slow', 80), ('mid', 112), ('fast', 150)]:
        f = f'char/{oid}-{tier}.webp'
        if not (A.no_char and os.path.exists(f'{out}/{f}')):
            poses, style = spec['dance'][tier]; fr = dance_seq(P, poses, tier, style=style); sheet(fr).save(f'{out}/{f}', quality=84, method=6)
            if tier == 'mid': sheet(fr[::6], 8).resize((8 * FR // 2, FR // 2)).save(f'{CHECK}/{oid}-dance-mid.png')
        ch['dance'][tier] = {'sheet': f, 'frames': 48, 'columns': 8, 'beats': 8, 'loopBpm': bpm}
    for name, e in spec['emotes'].items():
        f = f'char/{oid}-{name}.webp'
        if not (A.no_char and os.path.exists(f'{out}/{f}')):
            fr = emote_seq(P, e[0], e[1], e[2] if len(e) > 2 else None)
            if len(e) > 3 and e[3] == 'hearts': fr = with_hearts(fr)
            if len(e) > 3 and e[3] == 'fireflies': fr = with_fireflies(fr)
            sheet(fr).save(f'{out}/{f}', quality=84, method=6)
            sheet(fr[::3], 8).resize((8 * FR // 2, FR // 2)).save(f'{CHECK}/{oid}-emote-{name}.png')
        ch['emotes'][name] = {'sheet': f, 'frames': 24, 'columns': 8, 'beats': 4, 'loopBpm': 120}
    em = ch['emotes']; em['surprised'] = em['shocked']; em['sleepy'] = em['yawn']; em['crying'] = em['sad']; em['music'] = em['sing']
    if spec.get('instruments'): ch['instruments'] = dict(spec['instruments'])
    log(f'[{oid}] {len(ch["emotes"])} emotes')
    return ch, P['idle'].im

def main():
    os.makedirs(CHECK, exist_ok=True)
    if not (A.no_bg or A.no_char): shutil.rmtree(A.out, ignore_errors=True)
    for d in ['bg', 'char']: os.makedirs(f'{A.out}/{d}', exist_ok=True)
    scenes, thumbs = [], []
    for sc in ONLY:
        cfg = SCENES[sc]; other = 'day' if cfg['main'] == 'night' else 'night'
        for v in (cfg['main'], other):
            if not (A.no_bg and os.path.exists(f'{A.out}/bg/{sc}-{v}.mp4')): build_bg(sc, v, A.out)
        ch, idle = build_outfit(cfg['outfit'], A.out, f"Lucielle · {cfg['oname']}")
        rc = cfg['rare']; rch, ridle = build_outfit(rc['outfit'], A.out, f"Lucielle · {rc['name']}")
        rare = {'id': rc['id'], 'name': rc['name'], 'chance': 0.05, 'unlock': {'plays': rc['plays']}, 'thumb': f"char/{rc['outfit']}-thumb.jpg"}
        rare.update({k: rch[k] for k in ('idle', 'dance', 'emotes', 'events')});
        if rch.get('instruments'): rare['instruments'] = rch['instruments']
        ch['rareOutfits'] = [rare]
        m, o = cfg['main'], other
        plate = Image.open(f'{A.out}/bg/{sc}-{m}.jpg')
        thumb = plate.resize((456, 256), Image.LANCZOS).crop((100, 0, 356, 256)).convert('RGBA'); thumb.alpha_composite(idle.resize((200, 200), Image.LANCZOS), (28, 50))
        thumb.convert('RGB').save(f'{A.out}/bg/{sc}-thumb.jpg', quality=86); thumbs.append(thumb.convert('RGB'))
        rt = Image.open(f'{A.out}/bg/{sc}-{m}.jpg').resize((456, 256), Image.LANCZOS).crop((100, 0, 356, 256)).convert('RGBA'); rt.alpha_composite(ridle.resize((200, 200), Image.LANCZOS), (28, 50))
        rt.convert('RGB').save(f"{A.out}/char/{rc['outfit']}-thumb.jpg", quality=86)
        bgf = lambda v: {'image': f'bg/{sc}-{v}.jpg', 'video': f'bg/{sc}-{v}.mp4', 'glow': f'bg/{sc}-{v}-glow.jpg'}
        scenes.append({'id': sc, 'name': cfg['name'], 'thumb': f'bg/{sc}-thumb.jpg',
                       'background': dict(bgf(m), loopBpm=LOOP_BPM, tempoSync=True),
                       'variants': {'day': bgf('day'), 'night': bgf('night')},
                       'character': ch, 'particles': cfg['particles'],
                       'reactivity': {'beatZoom': 1.1, 'bassGlow': 1.25, 'shake': 0.6, 'flash': 1.0, 'particles': 0.8, 'glowColor': cfg['glow'], 'beatBurst': cfg['burst']},
                       'themeDefault': cfg['base'], 'colors': cfg['colors'], 'match': dict(cfg['match'], skins=['aero', 'classic'])})
    prev = Image.new('RGB', (256 * len(thumbs), 256))
    for i, th in enumerate(thumbs): prev.paste(th, (i * 256, 0))
    prev.save(f'{A.out}/preview.jpg', quality=86)
    pack = {'format': 'luciel-pack/1', 'id': 'lucielle-genres', 'name': 'Lucielle Genres', 'author': 'pj', 'version': '1.0.0',
            'description': 'Five genre stages for Lucielle: Alt Rock (she switches guitar / bass / drums / mic with the music), Hip-Hop rooftop, '
                           'R&B rainy night, Indie garage and Acoustic campfire. Animated day and night versions, a rare outfit per genre, auto-switch by genre.',
            'preview': 'preview.jpg', 'scenes': scenes}
    json.dump(pack, open(f'{A.out}/pack.json', 'w'), indent=1)
    # drop files no longer referenced (e.g. loops left over from an earlier run with --no-char)
    txt = json.dumps(pack)
    for root, _, files in os.walk(A.out):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), A.out)
            if rel != 'pack.json' and f'"{rel}"' not in txt: os.remove(os.path.join(root, f)); log('pruned', rel)
    os.makedirs(os.path.dirname(A.zip), exist_ok=True)
    if os.path.exists(A.zip): os.remove(A.zip)
    with zipfile.ZipFile(A.zip, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(A.out):
            for f in sorted(files):
                p = os.path.join(root, f); rel = os.path.relpath(p, A.out)
                z.write(p, rel, compress_type=zipfile.ZIP_STORED if f.endswith(('.mp4', '.webp', '.jpg', '.png')) else zipfile.ZIP_DEFLATED)
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(A.out) for f in fs); nfiles = sum(len(fs) for _, _, fs in os.walk(A.out))
    log('zip', A.zip, os.path.getsize(A.zip) // 1024, 'KB; unpacked', tot // 1024, 'KB;', nfiles, 'files')

if not os.environ.get('GENRES_NOMAIN'): main()
