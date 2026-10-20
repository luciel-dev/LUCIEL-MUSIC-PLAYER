"""White-background removal for Lucielle art: edge flood-fill bounded by the line art,
enclosed-hole detection (e.g. inside the halo), soft alpha via white un-blending, color decontamination."""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

def matte(rgb, line_t=38, grow=2, hole_white=1, hole_frac=0.7, min_hole=30, ring_sat=20):
    a = rgb.astype(np.float32)
    H, W, _ = a.shape
    d = 255 - a.min(2)                        # "ink" amount
    B = d > line_t                            # line art / colored areas = barrier
    Bd = ndi.binary_dilation(B, iterations=grow)   # close tiny outline gaps
    lab, n = ndi.label(~Bd)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    idx = np.arange(1, n + 1)
    sizes = ndi.sum(np.ones((H, W)), lab, idx)
    nearwhite = ndi.sum(d <= hole_white, lab, idx)
    bg_ids = set(int(x) for x in border if x)
    sat = a.max(2) - a.min(2)
    objs = ndi.find_objects(lab)
    for i in idx:
        if i in bg_ids or sizes[i - 1] < min_hole: continue
        if nearwhite[i - 1] / sizes[i - 1] <= hole_frac: continue
        # Enclosed pocket: only treat as background when it is bounded by the saturated gold halo
        # (grey/black-outlined pockets are robe, hair or speech bubbles and must stay opaque).
        sl = objs[i - 1]
        y0, y1 = max(0, sl[0].start - 6), min(H, sl[0].stop + 6); x0, x1 = max(0, sl[1].start - 6), min(W, sl[1].stop + 6)
        m = lab[y0:y1, x0:x1] == i
        ring = ndi.binary_dilation(m, iterations=4) & ~ndi.binary_dilation(m, iterations=1)
        if sat[y0:y1, x0:x1][ring].mean() > ring_sat:
            bg_ids.add(int(i))
    BG = np.isin(lab, list(bg_ids))
    # grow background back over the dilation ring, but never into real ink
    ring = ndi.binary_dilation(BG, iterations=grow + 2) & ~BG
    lum = a.mean(2)
    # local darkest value = estimate of the foreground color the edge pixel is blended with
    local_min = ndi.minimum_filter(lum, size=7)
    alpha = np.ones((H, W), np.float32)
    alpha[BG] = 0.0
    denom = np.maximum(255 - local_min, 40)
    ea = np.clip((255 - lum) / denom, 0, 1)
    ea = np.clip((ea - 0.02) / 0.98, 0, 1)
    alpha[ring] = np.maximum(ea[ring], 0)
    # pixels in ring that are strongly inked stay opaque
    alpha[ring & (d > line_t * 2)] = 1.0
    # tiny feather on the bg boundary for smoothness
    soft = ndi.gaussian_filter(alpha, 0.6)
    edge = ndi.binary_dilation(BG, iterations=1) & ~ndi.binary_erosion(BG, iterations=1)
    alpha[edge] = np.minimum(alpha[edge], soft[edge] * 1.15)
    alpha = np.clip(alpha, 0, 1)
    # decontaminate: c = (c - 255*(1-a)) / a
    out = a.copy()
    m = (alpha > 0.01) & (alpha < 0.999)
    for c in range(3):
        ch = out[..., c]
        ch[m] = np.clip((ch[m] - 255 * (1 - alpha[m])) / alpha[m], 0, 255)
    rgba = np.dstack([out, alpha * 255]).round().astype(np.uint8)
    return rgba, dict(holes=len(bg_ids) - len([x for x in border if x]))

def process(src, size=None, **kw):
    im = Image.open(src).convert('RGB')
    rgba, info = matte(np.asarray(im), **kw)
    out = Image.fromarray(rgba, 'RGBA')
    if size and size != out.width:
        # premultiplied resize
        pm = np.asarray(out).astype(np.float32); al = pm[..., 3:4] / 255
        pm[..., :3] *= al
        r = Image.fromarray(pm.round().astype(np.uint8), 'RGBA').resize((size, size), Image.LANCZOS)
        r = np.asarray(r).astype(np.float32); al = np.maximum(r[..., 3:4] / 255, 1e-4)
        r[..., :3] = np.clip(r[..., :3] / al, 0, 255)
        out = Image.fromarray(r.round().astype(np.uint8), 'RGBA')
    return out, info

def crop_box(im, pad=4):
    bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    return bb
