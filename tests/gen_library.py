# Richer demo library for library/editor screenshots & tests (short tagged tones; some with covers, a compilation, feat., multi-disc)
import subprocess, os, random
from PIL import Image, ImageDraw, ImageFont
random.seed(7)
OUT = '/workspace/aero-player-test/library'
def cover(path, c1, c2, text):
    im = Image.new('RGB', (400, 400)); d = ImageDraw.Draw(im)
    for y in range(400):
        t = y / 399; d.line([(0, y), (400, y)], fill=tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3)))
    for _ in range(14):
        x, y, r = random.randint(0, 400), random.randint(0, 400), random.randint(8, 50)
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 255), width=2)
    try: f = ImageFont.truetype('/workspace/aero-player/fonts/Selawik-Semibold.ttf', 34)
    except Exception: f = ImageFont.load_default()
    d.text((24, 330), text, fill=(255, 255, 255), font=f)
    im.save(path, quality=88)
A = [
  # folder, file, title, artist, album, albumartist, track, disc, year, genre, ext, cover
  ('Midnight Brass', 'Smoke Rings', 'The Velvet Halos', 'Midnight Brass', '', '1/4', '', '1962', 'Jazz', 'mp3', ((60, 30, 10), (200, 120, 40))),
  ('Midnight Brass', 'Blue Lantern', 'The Velvet Halos', 'Midnight Brass', '', '2/4', '', '1962', 'Jazz', 'mp3', None),
  ('Midnight Brass', 'Late Set (feat. Lucielle)', 'The Velvet Halos', 'Midnight Brass', '', '3/4', '', '1962', 'Jazz', 'mp3', None),
  ('Midnight Brass', 'Last Call', 'The Velvet Halos', 'Midnight Brass', '', '4/4', '', '1962', 'Jazz', 'mp3', None),
  ('Grid Runner', 'Neon Freeway', 'Chrome Saint', 'Grid Runner', '', '1', '', '2019', 'Synthwave', 'flac', ((40, 0, 80), (255, 60, 180))),
  ('Grid Runner', 'Holo Rain', 'Chrome Saint feat. Nova Kite', 'Grid Runner', '', '2', '', '2019', 'Synthwave', 'flac', None),
  ('Grid Runner', 'Error 418', 'Chrome Saint', 'Grid Runner', '', '3', '', '2019', 'Industrial', 'flac', None),
  ('8bit Heaven', 'Pixel Prayer', 'Bitwing', '8bit Heaven', '', '1', '', '2021', 'Chiptune', 'm4a', None),
  ('8bit Heaven', 'Save Point', 'Bitwing', '8bit Heaven', '', '2', '', '2021', 'Chiptune', 'm4a', None),
  ('Halo Sessions', 'Morning Prayer', 'Lucielle', 'Halo Sessions', 'Lucielle', '1', '1/2', '2024', 'Ambient', 'mp3', ((180, 210, 255), (255, 255, 255))),
  ('Halo Sessions', 'Cloud Nap', 'Lucielle', 'Halo Sessions', 'Lucielle', '2', '1/2', '2024', 'Ambient', 'mp3', None),
  ('Halo Sessions', 'Wing Practice', 'Lucielle', 'Halo Sessions', 'Lucielle', '1', '2/2', '2024', 'Lo-Fi', 'mp3', None),
  ('Halo Sessions', 'Bat Lullaby', 'Lucielle feat. The Velvet Halos', 'Halo Sessions', 'Lucielle', '2', '2/2', '2024', 'Lo-Fi', 'mp3', None),
  ('Neon Nights Vol. 1', 'Glitch Bloom', 'Datacat', 'Neon Nights Vol. 1', '', '1', '', '2022', 'Electronic', 'mp3', ((0, 0, 0), (0, 255, 180))),
  ('Neon Nights Vol. 1', 'Afterglow', 'Nova Kite', 'Neon Nights Vol. 1', '', '2', '', '2022', 'Pop', 'mp3', None),
  ('Neon Nights Vol. 1', 'Concrete Choir', 'MC Seraph', 'Neon Nights Vol. 1', '', '3', '', '2022', 'Hip-Hop', 'mp3', None),
  ('Neon Nights Vol. 1', 'Ironclad', 'Hellwing', 'Neon Nights Vol. 1', '', '4', '', '2022', 'Metal', 'mp3', None),
  ('Singles', 'Paper Hearts', 'Nova Kite', 'Paper Hearts', '', '1', '', '2023', 'Pop', 'ogg', None),
  ('Singles', 'Requiem for a Halo', 'Orchestra Angelica', 'Requiem', '', '1', '', '1998', 'Classical', 'flac', ((20, 20, 30), (200, 180, 120))),
]
for i, (folder, title, artist, album, aa, trk, disc, year, genre, ext, col) in enumerate(A):
    d = os.path.join(OUT, folder); os.makedirs(d, exist_ok=True)
    fn = os.path.join(d, f"{trk.split('/')[0].zfill(2)} - {title}.{ext}")
    if os.path.exists(fn): continue
    bpm = random.choice([72, 88, 96, 104, 112, 120, 128, 140])
    src = f"sine=f={220 + i * 15}:d=4,volume=0.3"
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', src]
    cov = None
    if col:
        cov = os.path.join(d, 'cover.jpg'); cover(cov, col[0], col[1], album[:18])
    if cov and ext in ('mp3', 'flac', 'm4a'):
        cmd += ['-i', cov, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg' if ext != 'flac' else 'copy', '-disposition:v', 'attached_pic']
        if ext == 'mp3': cmd += ['-id3v2_version', '3']
    codec = {'mp3': ['-c:a', 'libmp3lame', '-b:a', '96k'], 'flac': ['-c:a', 'flac'], 'm4a': ['-c:a', 'aac', '-b:a', '96k'], 'ogg': ['-c:a', 'libvorbis']}[ext]
    meta = {'title': title, 'artist': artist, 'album': album, 'track': trk, 'date': year, 'genre': genre}
    if aa: meta['album_artist'] = aa
    if disc: meta['disc'] = disc
    for k, v in meta.items(): cmd += ['-metadata', f'{k}={v}']
    subprocess.run(cmd + codec + [fn], check=True)
for root, _, fs in os.walk(OUT):
    for f in fs:
        if f == 'cover.jpg': os.remove(os.path.join(root, f))
print(sum(len(f) for _, _, f in os.walk(OUT)), 'files')
