#!/usr/bin/env python3
"""Fixture packs for packtest.js: one small valid pack (wrapped in a folder) + invalid ones that must be rejected."""
import io, json, os, sys, zipfile
from PIL import Image
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/luc/packs'; os.makedirs(OUT, exist_ok=True)
def png(color, size=(64, 64)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def mk(name, files, deflate=True):
    with zipfile.ZipFile(f'{OUT}/{name}.zip', 'w', zipfile.ZIP_DEFLATED if deflate else zipfile.ZIP_STORED) as z:
        for p, d in files.items(): z.writestr(p, d if isinstance(d, (bytes, str)) else json.dumps(d))
scene = lambda **kw: dict({'id': 'pink', 'name': 'Pink Test', 'background': {'image': 'bg.png'}, 'match': {'genres': ['zzpinkcore']}}, **kw)
good = {'id': 'tiny-test', 'name': 'Tiny Test', 'author': 'tests', 'version': '0.1.0', 'preview': 'bg.png', 'scenes': [scene(), scene(id='pix', name='Pix Test', pixel=True)]}
mk('good-wrapped', {'tiny-test/pack.json': good, 'tiny-test/bg.png': png('#ff3fa0'), 'tiny-test/README.txt': 'hello', '__MACOSX/._bg.png': b'x'})
mk('script', {'pack.json': dict(good, id='evil'), 'bg.png': png('#000'), 'payload.js': 'alert(1)'})
mk('badjson', {'pack.json': '{ "id": "x", nope', 'bg.png': png('#000')})
mk('missing', {'pack.json': dict(good, id='missing', scenes=[scene(background={'image': 'nothere.png'})])})
mk('traversal', {'pack.json': dict(good, id='trav', scenes=[scene(background={'image': '../../etc/passwd.png'})]), 'bg.png': png('#000')})
mk('fakemagic', {'pack.json': dict(good, id='fake'), 'bg.png': b'<html><script>alert(1)</script></html>'})
mk('reserved', {'pack.json': dict(good, id='luciel-core'), 'bg.png': png('#000')})
mk('nomanifest', {'bg.png': png('#000')})
big = png('#000') + b'\0' * (21 * 1024 * 1024)
mk('oversize', {'pack.json': dict(good, id='big'), 'bg.png': big})
open(f'{OUT}/notzip.zip', 'wb').write(b'this is not a zip at all' * 10)
# folder version of the good pack (for folder import)
os.makedirs(f'{OUT}/folder/tiny-folder', exist_ok=True)
json.dump(dict(good, id='tiny-folder', name='Tiny Folder'), open(f'{OUT}/folder/tiny-folder/pack.json', 'w'))
open(f'{OUT}/folder/tiny-folder/bg.png', 'wb').write(png('#3fa0ff'))
open(f'{OUT}/folder/tiny-folder/unused.png', 'wb').write(png('#111'))
print('fixtures in', OUT)
