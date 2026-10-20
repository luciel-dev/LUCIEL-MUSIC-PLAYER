"""Key out the white background of the 3 dance loops -> VP9+alpha WebM (480px/24fps) and a
sprite sheet WebP (320px/12fps) for browsers without VP9 alpha. Also estimates each loop's own tempo."""
import os, sys, subprocess, json, glob, shutil
import numpy as np
from PIL import Image
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(__file__))
from matte import matte

SRC = '/workspace/lucielle/mascot/reactions'
OUT = os.path.join(os.path.dirname(__file__), '..', 'mascot', 'dance')
TMP = '/tmp/luciel-dance'

def key_frame(path):
    rgb = np.asarray(Image.open(path).convert('RGB'))
    rgba, _ = matte(rgb, line_t=40, grow=2)
    Image.fromarray(rgba, 'RGBA').save(path.replace('.png', '-a.png'))
    return path

def loop_tempo(frames, fps):
    # vertical motion of the alpha centroid + top edge -> autocorrelation -> period
    ys = []
    for f in frames:
        a = np.asarray(Image.open(f))[..., 3].astype(np.float32) / 255
        rows = a.sum(1); yy = np.arange(len(rows))
        ys.append((rows * yy).sum() / max(rows.sum(), 1))
    y = np.array(ys) - np.mean(ys)
    n = len(y); best, bl = -1e9, None
    ac = np.correlate(y, y, 'full')[n - 1:] / (np.arange(n, 0, -1))
    for lag in range(int(fps * 60 / 180), int(fps * 60 / 50)):
        if ac[lag] > best: best, bl = ac[lag], lag
    bpm = 60 * fps / bl
    while bpm < 70: bpm *= 2
    while bpm > 160: bpm /= 2
    return round(bpm, 1)

def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for tempo in ('slow', 'mid', 'fast'):
        d = f'{TMP}/{tempo}'; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{SRC}/mascot-dance-{tempo}.mp4', f'{d}/f%04d.png'], check=True)
        frames = sorted(glob.glob(f'{d}/f????.png'))
        with Pool(7) as p: p.map(key_frame, frames)
        keyed = [f.replace('.png', '-a.png') for f in frames]
        # VP9 with alpha
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '24', '-i', f'{d}/f%04d-a.png', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                        '-b:v', '0', '-crf', '30', '-deadline', 'good', '-row-mt', '1', '-auto-alt-ref', '0', f'{OUT}/{tempo}.webm'], check=True)
        # sprite sheet at 12 fps, 320 px
        sel = keyed[::2]; S = 320; cols = 9; rows = (len(sel) + cols - 1) // cols
        sheet = Image.new('RGBA', (cols * S, rows * S), (0, 0, 0, 0))
        for i, f in enumerate(sel):
            sheet.paste(Image.open(f).resize((S, S), Image.LANCZOS), ((i % cols) * S, (i // cols) * S))
        sheet.save(f'{OUT}/{tempo}-sheet.webp', 'WEBP', quality=86, alpha_quality=90, method=5)
        # one transparent PNG preview frame for QA
        Image.open(keyed[len(keyed) // 3]).save(f'{TMP}/{tempo}-preview.png')
        bpm = loop_tempo(keyed, 24)
        meta[tempo] = dict(webm=f'mascot/dance/{tempo}.webm', sheet=f'mascot/dance/{tempo}-sheet.webp', frames=len(sel), cols=cols,
                           size=S, fps=12, duration=round(len(frames) / 24, 3), loopBpm=bpm)
        print(tempo, meta[tempo], flush=True)
    json.dump(meta, open(f'{OUT}/dance.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
