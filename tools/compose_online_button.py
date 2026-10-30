"""Compose the main-menu ONLINE entry from letters of the original buttons_tile.png.

ONLINE = "ON" + "NE" from OPCIONES and "LI" from SALIR (all at the same size in the original sheet). The lettering
leans right, so rows are de-skewed with whole-pixel shifts (no resampling), cut into vertical strips, joined, and
re-skewed. The outline is closed at the word ends by dilating the letters. The hover state is built the way the
original pairs look: same word ~10 % larger, yellow fill (255,246,2) and a pale yellow (255,255,190) glow.

Output: public/assets/images/menuElements/online_btn.png (normal on top, hover below; rects printed for game.ts).
Usage: python tools/compose_online_button.py [--preview out.png]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public/assets/images/menuElements/buttons_tile.png'
OUT = ROOT / 'public/assets/images/menuElements/online_btn.png'
K = 0.25          # lean of the lettering: 1 px every 4 rows
HALF = 16         # rows kept above/below each word's middle row
DARK = (26, 24, 24)
LIME = (186, 255, 0)
YELLOW = (255, 246, 2)
GLOW = (255, 255, 190)

# (source box in the sheet, middle row, [deskewed column ranges to keep])
OPC = ((14, 106, 92, 143), 124)
SAL = ((239, 54, 292, 95), 75)
PIECES = [(OPC, 50, 70), (SAL, 260, 274), (OPC, 62, 78)]


def deskewed(sheet, word):
    (x0, y0, x1, y1), ym = word
    pad = 10
    out = np.zeros((2 * HALF, x1 - x0 + 2 * pad, 4), np.uint8)
    for r in range(2 * HALF):
        y = ym - HALF + r
        if not y0 <= y < y1:
            continue
        sh = round((y - ym) * K)
        out[r, pad + sh: pad + sh + (x1 - x0)] = sheet[y, x0:x1]
    return out, x0 - pad  # column c of `out` is deskewed x = c + origin


def compose(sheet):
    strips = []
    for word, a, b in PIECES:
        arr, origin = deskewed(sheet, word)
        strips.append(arr[:, a - origin: b - origin])
    flat = np.concatenate(strips, axis=1)
    pad = 12
    flat = np.pad(flat, ((0, 0), (pad, pad), (0, 0)))
    out = np.zeros_like(flat)
    for r in range(flat.shape[0]):  # re-skew
        sh = round((r - HALF) * K)
        out[r] = np.roll(flat[r], -sh, axis=0)
    # letters = fill-coloured pixels, minus specks of the neighbouring letters left by the cuts
    rgba = out.astype(int)
    letters = (rgba[..., 3] > 128) & (rgba[..., 1] > 120)
    lab, n = ndimage.label(letters)
    sizes = ndimage.sum(letters, lab, range(1, n + 1))
    letters = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 12])
    out[(rgba[..., 1] > 120) & ~letters] = 0
    # outline: the original dark ring where it hugs the letters, closed at the cut ends, soft outer edge
    d = ndimage.distance_transform_edt(~letters)
    keep = d <= 3.6
    ring = keep & ~letters
    out[~keep] = 0
    out[ring] = (*DARK, 255)
    edge = (d > 3.0) & (d <= 3.6)
    out[edge, 3] = 140
    return out


def trim(a):
    ys, xs = np.nonzero(a[..., 3])
    return a[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]


def recolor(a, colour):
    """lime/dark blend → colour/dark blend (keeps the anti-aliasing of the original)."""
    a = a.astype(float)
    t = np.clip((a[..., 1] - DARK[1]) / (LIME[1] - DARK[1]), 0, 1)
    for i in range(3):
        a[..., i] = DARK[i] * (1 - t) + colour[i] * t
    return a.clip(0, 255).astype(np.uint8)


def hover(normal):
    im = Image.fromarray(recolor(normal, YELLOW))
    im = im.resize((round(im.width * 1.1), round(im.height * 1.1)), Image.LANCZOS)
    g = 7
    base = Image.new('RGBA', (im.width + 2 * g, im.height + 2 * g), (0, 0, 0, 0))
    base.paste(im, (g, g))
    alpha = base.getchannel('A')
    halo = alpha.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(2.2))
    halo = halo.point(lambda v: min(255, int(v * 1.6)))
    glow = Image.new('RGBA', base.size, (*GLOW, 0))
    glow.putalpha(halo)
    glow.alpha_composite(base)
    return trim(np.array(glow))


def main():
    sheet = np.array(Image.open(SRC).convert('RGBA'))
    n = trim(compose(sheet))
    h = hover(n)
    W = max(n.shape[1], h.shape[1])
    out = np.zeros((n.shape[0] + h.shape[0] + 2, W, 4), np.uint8)
    out[: n.shape[0], : n.shape[1]] = n
    out[n.shape[0] + 2:, : h.shape[1]] = h
    Image.fromarray(out).save(OUT)
    print(f'n: [0, 0, {n.shape[1]}, {n.shape[0]}]  h: [0, {n.shape[0] + 2}, {h.shape[1]}, {h.shape[0]}]  -> {OUT}')
    if '--preview' in sys.argv:
        p = Image.new('RGBA', (W + 8, out.shape[0] + 8), (90, 90, 140, 255))
        p.alpha_composite(Image.fromarray(out), (4, 4))
        p.resize((p.width * 6, p.height * 6), Image.NEAREST).save(sys.argv[sys.argv.index('--preview') + 1])


if __name__ == '__main__':
    main()
