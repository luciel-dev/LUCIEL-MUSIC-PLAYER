# Builds a small tagged demo library (MP3 + embedded cover art) for the phone-layout screenshots and drill-down tests.
import os, subprocess, random, math
from PIL import Image, ImageDraw, ImageFilter
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'demo-media')
os.makedirs(OUT, exist_ok=True)
ALBUMS = [
  ('Aurora Static', 'Glass Hearts', '2024', 'Synthwave', 118, [(20, 90, 200), (255, 90, 200)], ['Neon Skyline', 'Chrome Rain', 'Night Drive', 'Afterglow']),
  ('Aurora Static', 'Cold Signals', '2022', 'Synthwave', 104, [(10, 30, 80), (60, 220, 255)], ['Signal Lost', 'Blue Hour', 'Static Bloom']),
  ('Mira Vale', 'Paper Lanterns', '2023', 'Lo-Fi', 84, [(250, 180, 90), (190, 70, 60)], ['Tea at Dusk', 'Window Seat', 'Slow Bicycle', 'Paper Moon']),
  ('The Ember Line', 'Firewalk', '2021', 'Rock', 136, [(120, 10, 10), (255, 140, 40)], ['Firewalk', 'Ashes and Engines', 'Red Mile']),
  ('KILO-9', 'Toxic Garden', '2025', 'Drum & Bass', 172, [(10, 40, 10), (140, 255, 60)], ['Slime Season', 'Acid Petals', 'Overgrowth']),
  ('Various Artists', 'Midnight Mixtape', '2020', 'Electronic', 124, [(40, 20, 90), (255, 220, 120)], [('Cassette Dreams', 'Lumen'), ('Velvet Circuit', 'Nova Kai'), ('Moonlit Arcade', 'Pixel Saint')]),
]
def cover(path, c1, c2, seed):
  random.seed(seed); W = 500
  im = Image.new('RGB', (W, W), c1); d = ImageDraw.Draw(im)
  for y in range(W):
    t = y / W; d.line([(0, y), (W, y)], fill=tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3)))
  for _ in range(7):
    r = random.randint(40, 170); x = random.randint(0, W); y = random.randint(0, W)
    col = tuple(min(255, int(v * 1.25) + 30) for v in (c2 if random.random() < .5 else c1))
    d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=random.randint(3, 10))
  d.rectangle([0, int(W * .72), W, W], fill=tuple(int(v * .35) for v in c1))
  im = im.filter(ImageFilter.GaussianBlur(1.2)); im.save(path, quality=88)
n = 0
for ai, (artist, album, year, genre, bpm, cols, songs) in enumerate(ALBUMS):
  cv = os.path.join(OUT, f'.cover{ai}.jpg'); cover(cv, cols[0], cols[1], ai)
  for ti, s in enumerate(songs):
    title, tart = (s if isinstance(s, tuple) else (s, artist))
    n += 1; dur = 14 + (n * 7) % 11
    f = os.path.join(OUT, f'{artist} - {title}.mp3'.replace('/', '-'))
    if os.path.exists(f): continue
    freq = 110 * (2 ** (((ai * 3 + ti) % 12) / 12))
    beat = 60 / bpm
    expr = f"0.35*sin(2*PI*{freq:.2f}*t)*exp(-3*mod(t,{beat:.4f}))+0.25*sin(2*PI*55*t)*exp(-14*mod(t,{beat:.4f}))+0.06*sin(2*PI*{freq*1.5:.2f}*t)"
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f"aevalsrc='{expr}|{expr}':s=44100:d={dur}", '-i', cv, '-map', '0:a', '-map', '1:v',
      '-c:a', 'libmp3lame', '-b:a', '128k', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', '-id3v2_version', '3',
      '-metadata', f'title={title}', '-metadata', f'artist={tart}', '-metadata', f'album={album}', '-metadata', f'date={year}', '-metadata', f'genre={genre}',
      '-metadata', f'track={ti + 1}/{len(songs)}', '-metadata', f'TBPM={bpm}']
    if artist == 'Various Artists': cmd += ['-metadata', 'album_artist=Various Artists', '-metadata', 'compilation=1']
    subprocess.run(cmd + [f], check=True)
for f in os.listdir(OUT):
  if f.startswith('.cover'): os.remove(os.path.join(OUT, f))
print(n, 'songs in', OUT)
