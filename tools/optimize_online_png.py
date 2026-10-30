"""Optimiza los PNG de la UI online (public/online) sin tocar su tamaño en píxeles.

Uso:  python tools/optimize_online_png.py [carpeta]
Por defecto:  public/online

Para cada PNG:
  1. Nunca se redimensiona (no se conoce el tamaño de uso). El lado mayor se deja igual.
  2. Se prueba PNG paletizado de 256 colores con alfa conservado: FASTOCTREE sobre RGBA y,
     si la versión de Pillow lo admite para RGBA, también MEDIANCUT. Se elige el de menor
     error medio por píxel: |dR|,|dG|,|dB| medio, ponderado por el alfa del original
     (los píxeles transparentes no cuentan).
  3. Sólo se reemplaza el archivo si ese error es menor a 2.0 y el PNG nuevo pesa menos.
  4. Si no, se guarda el PNG sin paleta con optimize=True y compress_level=9 (sólo si no
     queda más pesado que el original).
Al final imprime una tabla con archivo, tamaño antes, tamaño después y error, más el total.
"""
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

MAX_ERROR = 2.0
COLORS = 256
DEFAULT_DIR = Path('public/online')
SAVE_KWARGS = {'optimize': True, 'compress_level': 9}


def to_rgba(im):
    return im if im.mode == 'RGBA' else im.convert('RGBA')


def mean_error(orig, cand):
    """Error medio por píxel en 0..255, RGB ponderado por el alfa del original."""
    a = np.asarray(orig, dtype=np.float32)[..., 3] / 255.0
    o = np.asarray(orig, dtype=np.float32)[..., :3]
    c = np.asarray(cand, dtype=np.float32)[..., :3]
    diff = np.abs(o - c).mean(axis=2)
    total = float(a.sum())
    rgb_err = float((diff * a).sum() / total) if total else float(diff.mean())
    # the edges live in the alpha channel: a palette that changes it would leave halos, so it counts too
    alpha_err = float(np.abs(np.asarray(orig, dtype=np.float32)[..., 3] - np.asarray(cand, dtype=np.float32)[..., 3]).mean())
    return max(rgb_err, alpha_err)


def palette_candidates(rgba):
    """Candidatos (método, imagen P) de 256 colores con alfa."""
    out = []
    for name in ('FASTOCTREE', 'MEDIANCUT'):
        method = getattr(Image.Quantize, name, None)
        if method is None:
            continue
        try:
            out.append((name, rgba.quantize(colors=COLORS, method=method)))
        except ValueError:
            # p.ej. Pillow actual: MEDIANCUT sólo acepta RGB/L, no RGBA.
            continue
    return out


def render_png(im, folder):
    """Guarda im en un PNG temporal dentro de folder y devuelve (ruta, bytes)."""
    fd, tmp = tempfile.mkstemp(dir=str(folder), suffix='.png')
    os.close(fd)
    tmp = Path(tmp)
    try:
        im.save(tmp, format='PNG', **SAVE_KWARGS)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return tmp, tmp.stat().st_size


def human(n):
    return f'{n / 1024:.1f} kB' if n >= 1024 else f'{n} B'


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR
    files = sorted(folder.glob('*.png'))
    if not files:
        print(f'No hay PNG en {folder}')
        return 1

    rows = []
    total_before = total_after = 0
    for path in files:
        before = path.stat().st_size
        total_before += before
        with Image.open(path) as im:
            im.load()
            rgba = to_rgba(im)

        best = None
        for method, quantized in palette_candidates(rgba):
            err = mean_error(rgba, quantized.convert('RGBA'))
            if best is None or err < best[0]:
                best = (err, method, quantized)

        chosen = None
        after = before
        error = None
        note = 'sin cambios'

        if best is not None and best[0] < MAX_ERROR:
            tmp, size = render_png(best[2], folder)
            if size < before:
                chosen, after, error = tmp, size, best[0]
                note = f'paleta {best[1].lower()}'
            else:
                tmp.unlink(missing_ok=True)
                note = 'paleta no pesa menos'

        if chosen is None:
            tmp, size = render_png(rgba, folder)
            if size < before:
                chosen, after = tmp, size
                note = 'sin paleta'
            else:
                tmp.unlink(missing_ok=True)
                note = 'sin paleta (ya optimo)'

        if chosen is not None:
            os.replace(chosen, path)

        total_after += after
        rows.append((path.name, before, after, error, note))

    width = max(len(name) for name, *_ in rows)
    print(f"{'archivo':<{width}}  {'antes':>10}  {'despues':>10}  {'error':>6}  resultado")
    print('-' * (width + 45))
    for name, before, after, error, note in rows:
        err = '-' if error is None else f'{error:.2f}'
        print(f'{name:<{width}}  {human(before):>10}  {human(after):>10}  {err:>6}  {note}')
    print('-' * (width + 45))
    saved = total_before - total_after
    pct = (saved / total_before * 100) if total_before else 0.0
    print(f"{'TOTAL':<{width}}  {human(total_before):>10}  {human(total_after):>10}")
    print(f'Ahorro: {human(saved)} ({pct:.1f}%) en {len(rows)} archivos')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
