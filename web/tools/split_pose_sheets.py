#!/usr/bin/env python3
"""Split 3-pose green-screen sheets into single poses for make_genres_pack.py.
   raw/<sheet>.jpg  ->  char/<outfit>/<pose>.png  (flat #00FF00 kept; stray bits of the neighbouring pose removed)"""
import os, sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
ROOT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/lucielle/pack3'
MAP = {
  'sheet-alt-a': ('static-halo', ['idle', 'guitar', 'guitar-b']),
  'sheet-alt-b': ('static-halo', ['bass', 'drums', 'drums-b']),
  'sheet-alt-c': ('static-halo', ['mic', 'happy', 'headbang']),
  'sheet-alt-d': ('static-halo', ['shocked', 'yawn', 'sad']),
  'sheet-hiphop-a': ('block-party', ['idle', 'dance-a', 'dance-b']),
  'sheet-hiphop-b': ('block-party', ['happy', 'headbang', 'shocked']),
  'sheet-hiphop-c': ('block-party', ['yawn', 'sad', 'sing']),
  'sheet-rnb-a': ('velvet-hour', ['idle', 'dance-a', 'spin']),
  'sheet-rnb-b': ('velvet-hour', ['hearts', 'dance-b', 'shocked']),
  'sheet-rnb-c': ('velvet-hour', ['yawn', 'sad', 'sing']),
  'sheet-indie-a': ('garage-days', ['idle', 'dance-a', 'dance-b']),
  'sheet-indie-b': ('garage-days', ['daydream', 'happy', 'headbang']),
  'sheet-indie-c': ('garage-days', ['shocked', 'sad', 'sing']),
  'sheet-acoustic-a': ('campfire-wings', ['idle', 'kneel', 'fireflies']),
  'sheet-acoustic-b': ('campfire-wings', ['hug', 'happy', 'dance-b']),
  'sheet-acoustic-c': ('campfire-wings', ['shocked', 'yawn', 'sing']),
  'rare-alt-a': ('static-halo-rare', ['idle', 'guitar', 'bass']),
  'rare-alt-b': ('static-halo-rare', ['drums', 'mic', 'happy']),
  'rare-hiphop-a': ('block-party-rare', ['idle', 'dance-a', 'dance-b']),
  'rare-hiphop-b': ('block-party-rare', ['happy', 'sing', 'headbang']),
  'rare-rnb-a': ('velvet-hour-rare', ['idle', 'dance-a', 'spin']),
  'rare-rnb-b': ('velvet-hour-rare', ['hearts', 'sing', 'dance-b']),
  'rare-indie-a': ('garage-days-rare', ['idle', 'dance-a', 'dance-b']),
  'rare-indie-b': ('garage-days-rare', ['daydream', 'happy', 'sing']),
  'rare-acoustic-a': ('campfire-wings-rare', ['idle', 'dance-a', 'fireflies']),
  'rare-acoustic-b': ('campfire-wings-rare', ['happy', 'sing', 'hug']),
}
def mask(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (g - np.maximum(r, b)) < 60
for sh, (outfit, poses) in MAP.items():
    p = f'{ROOT}/raw/{sh}.jpg'
    if not os.path.exists(p): print('missing', p); continue
    im = Image.open(p).convert('RGB'); a = np.asarray(im).astype(np.int32); H, W = a.shape[:2]
    m = mask(a); m = ndi.binary_opening(m, iterations=2)
    col = m.sum(0).astype(float); col = ndi.uniform_filter1d(col, 9)
    cuts = []
    for c in (W / 3, 2 * W / 3):
        lo, hi = int(c - W * 0.12), int(c + W * 0.12); cuts.append(lo + int(np.argmin(col[lo:hi])))
    xs = [0] + cuts + [W]
    os.makedirs(f'{ROOT}/char/{outfit}', exist_ok=True)
    lab, n = ndi.label(m)
    for i, pose in enumerate(poses):
        x0, x1 = xs[i], xs[i + 1]
        sub = a[:, x0:x1].copy(); sm = m[:, x0:x1]; sl = lab[:, x0:x1]
        # keep components that have most of their pixels inside this slice and are not tiny cut-off bits
        keep = np.zeros_like(sm)
        ids, cnt = np.unique(sl[sm], return_counts=True)
        big = cnt.max() if len(cnt) else 0
        for k, c in zip(ids, cnt):
            tot = (lab == k).sum()
            if c / tot > 0.5 and c > big * 0.01: keep |= sl == k
        keep = ndi.binary_dilation(keep, iterations=3) & (sm | ndi.binary_dilation(sm, iterations=3))
        sub[~keep] = (0, 255, 0)
        Image.fromarray(sub.astype(np.uint8)).save(f'{ROOT}/char/{outfit}/{pose}.png')
    print(sh, '->', outfit, poses, 'cuts', cuts)
