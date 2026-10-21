#!/usr/bin/env python3
"""soften_strokes.py FILE x0,y0,x1,y1: remove thin dark scribbles (could read as letters) by a large median, feathered"""
import sys, numpy as np
from PIL import Image, ImageFilter
f, b = sys.argv[1], sys.argv[2]; x0, y0, x1, y1 = map(int, b.split(','))
im = Image.open(f).convert('RGB'); reg = im.crop((x0, y0, x1, y1))
med = reg.filter(ImageFilter.MedianFilter(17)).filter(ImageFilter.GaussianBlur(2))
r, m = np.asarray(reg).astype(float), np.asarray(med).astype(float)
dark = (r.mean(-1) < m.mean(-1) - 12).astype(float)
from scipy import ndimage as ndi
w = ndi.gaussian_filter(ndi.binary_dilation(dark > 0, iterations=2).astype(float), 1.5)
h, wd = w.shape; yy, xx = np.mgrid[0:h, 0:wd]
edge = np.clip(np.minimum.reduce([xx, yy, wd - 1 - xx, h - 1 - yy]) / 12, 0, 1); w *= edge
out = r * (1 - w[..., None]) + m * w[..., None]
im.paste(Image.fromarray(out.clip(0, 255).astype('uint8')), (x0, y0)); im.save(f, quality=95)
