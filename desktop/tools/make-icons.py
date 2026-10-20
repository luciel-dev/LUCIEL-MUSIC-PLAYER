# Windows .ico (256/128/64/48/32/16, PNG-compressed entries) + tray / thumbar PNGs from the Lucielle icon art
import struct, io, os
from PIL import Image, ImageDraw
SRC = '/workspace/aero-player/icons'
B = os.path.join(os.path.dirname(__file__), '..', 'build'); A = os.path.join(os.path.dirname(__file__), '..', 'assets')
big = Image.open(f'{SRC}/icon-512.png').convert('RGBA')
hand = {16: 'favicon-16.png', 32: 'favicon-32.png', 48: 'favicon-48.png'}
imgs = []
for s in (256, 128, 64, 48, 32, 16):
    im = Image.open(f'{SRC}/{hand[s]}').convert('RGBA') if s in hand and os.path.exists(f'{SRC}/{hand[s]}') else big.resize((s, s), Image.LANCZOS)
    if im.size != (s, s): im = im.resize((s, s), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True); imgs.append((s, buf.getvalue()))
hdr = struct.pack('<HHH', 0, 1, len(imgs)); off = 6 + 16 * len(imgs); dirs = b''; data = b''
for s, png in imgs:
    dirs += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(png), off + len(data)); data += png
open(f'{B}/icon.ico', 'wb').write(hdr + dirs + data)
big.save(f'{B}/icon.png'); big.resize((256, 256), Image.LANCZOS).save(f'{A}/icon-256.png')
for s in (16, 32): (Image.open(f'{SRC}/{hand[s]}').convert('RGBA') if os.path.exists(f'{SRC}/{hand[s]}') else big.resize((s, s), Image.LANCZOS)).save(f'{A}/tray-{s}.png')
# thumbar glyphs (white, 16px + 32px @2x)
def glyph(kind, s):
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im); k = s / 16; w = (255, 255, 255, 255)
    P = lambda pts: [(x * k, y * k) for x, y in pts]
    if kind == 'play': d.polygon(P([(4, 2), (13, 8), (4, 14)]), fill=w)
    if kind == 'pause': d.rectangle(P([(3.5, 2.5), (6.5, 13.5)]), fill=w); d.rectangle(P([(9.5, 2.5), (12.5, 13.5)]), fill=w)
    if kind == 'next': d.polygon(P([(2, 2.5), (10, 8), (2, 13.5)]), fill=w); d.rectangle(P([(11, 2.5), (13.5, 13.5)]), fill=w)
    if kind == 'prev': d.polygon(P([(14, 2.5), (6, 8), (14, 13.5)]), fill=w); d.rectangle(P([(2.5, 2.5), (5, 13.5)]), fill=w)
    return im
for kind in ('play', 'pause', 'next', 'prev'):
    glyph(kind, 16).save(f'{A}/tb-{kind}.png'); glyph(kind, 32).save(f'{A}/tb-{kind}@2x.png')
print('icons ok', [s for s, _ in imgs], os.path.getsize(f'{B}/icon.ico'))
