#!/usr/bin/env python3
"""paint_out.py FILE x0,y0,x1,y1 [...]: cover small marks with the surrounding colour (text-rule fixes)"""
import sys, statistics as st
from PIL import Image, ImageFilter
f = sys.argv[1]; im = Image.open(f).convert('RGB')
for b in sys.argv[2:]:
    x0, y0, x1, y1 = map(int, b.split(','))
    ring = [im.getpixel((x, y)) for x in range(x0 - 3, x1 + 3) for y in (y0 - 3, y1 + 2)] + [im.getpixel((x, y)) for y in range(y0, y1) for x in (x0 - 3, x1 + 2)]
    c = tuple(int(st.median(p[i] for p in ring)) for i in range(3))
    im.paste(Image.new('RGB', (x1 - x0, y1 - y0), c), (x0, y0))
    r = im.crop((x0 - 3, y0 - 3, x1 + 3, y1 + 3)).filter(ImageFilter.GaussianBlur(1.2)); im.paste(r, (x0 - 3, y0 - 3))
im.save(f, quality=95) if f.endswith('.jpg') else im.save(f)
