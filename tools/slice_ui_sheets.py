"""Corta las hojas de arte de la UI online (Gemini, fondo verde #00FF00) en piezas PNG con alfa.

Uso:  python tools/slice_ui_sheets.py [carpeta_hojas] [carpeta_salida]
Por defecto:  art-source/Nuevos assets  ->  public/online

Por pieza: caja (x0, y0, x1, y1) medida sobre la hoja SIN el rótulo de abajo, ancho de salida (px del maestro "x2/x4",
el alto sale de la proporción; nunca se estira), y opciones:
  cc    = quedarse sólo con la mayor componente conexa (cursores que se pisan con otra pieza)
  deglow = quitar el resplandor verdoso que Gemini deja alrededor (botón hover, ficha propia, cursores)
  nored = borrar rojo/naranja (la barra "warn" que Gemini dibujó debajo de los cursores)
El verde se saca con alfa suave: el fondo duro (distancia < 45 al verde de la hoja) pasa a transparente, el borde
(3 px) se des-mezcla del verde para que no quede halo, y el verde propio de las piezas (botón "listo") se conserva.
"""
import sys
from pathlib import Path

import numpy as np
import scipy.ndimage as nd
from PIL import Image

HOJAS = {
    'panel': 'Assets_online_panel.png', 'sala': 'Assets_online_sala.png',
    'hud': 'Assets_hud_coop.png', 'mapa': 'Assets_mapa_online.png',
}

# nombre: (hoja, (x0, y0, x1, y1), ancho de salida, opciones)
PIEZAS = {
    # --- panel (2816x1536) ---
    'card': ('panel', (170, 60, 900, 440), 720, ''),
    'header': ('panel', (1000, 130, 1820, 390), 640, ''),
    'tab': ('panel', (1940, 90, 2630, 420), 440, ''),
    'tab_active': ('panel', (190, 560, 880, 870), 440, ''),
    'btn': ('panel', (1040, 590, 1775, 845), 480, ''),
    'btn_hover': ('panel', (1890, 560, 2670, 860), 514, 'deglow'),
    'input': ('panel', (180, 1070, 890, 1330), 480, ''),
    'code_box': ('panel', (1060, 1035, 1756, 1345), 480, ''),
    'spinner': ('panel', (2085, 1000, 2470, 1380), 128, ''),
    # --- sala (2816x1536) ---
    'slot': ('sala', (85, 80, 405, 465), 200, ''),
    'slot_me': ('sala', (465, 75, 805, 470), 219, 'deglow'),
    'slot_free': ('sala', (868, 85, 1180, 465), 195, ''),
    'avatar_frame': ('sala', (1235, 90, 1595, 455), 128, ''),
    'crown': ('sala', (1670, 160, 1946, 385), 96, ''),
    'ready_on': ('sala', (2035, 115, 2348, 430), 96, ''),
    'ready_off': ('sala', (2423, 115, 2736, 430), 96, ''),
    'ping_good': ('sala', (100, 620, 390, 885), 96, ''),
    'ping_mid': ('sala', (490, 620, 780, 885), 96, ''),
    'ping_bad': ('sala', (880, 620, 1170, 885), 96, ''),
    'kick_x': ('sala', (1310, 655, 1520, 865), 64, ''),
    'toggle_on': ('sala', (1665, 665, 1952, 845), 112, ''),
    'toggle_off': ('sala', (2042, 665, 2345, 845), 112, ''),
    'heart': ('sala', (2470, 665, 2690, 855), 64, ''),  # la hoja trae el corazón dos veces: sólo se usa el primero
    # --- hud (2048x2048) ---
    'friend_plate': ('hud', (55, 135, 840, 470), 220, ''),
    'powerup_plate': ('hud', (955, 135, 1710, 470), 280, ''),
    'powerbar_frame': ('hud', (60, 600, 1990, 870), 208, ''),
    'powerbar_fill': ('hud', (65, 960, 1520, 1180), 208, ''),
    'powerbar_fill_warn': ('hud', (65, 1275, 1680, 1490), 208, ''),
    'host_flag': ('hud', (860, 1610, 1200, 1860), 96, ''),
    'down_badge': ('hud', (1565, 1575, 1910, 1915), 96, ''),
    # --- mapa (2048x2048); su powerbar_fill_warn está pisado por los cursores: se usa el de la hoja hud ---
    'roster_plate': ('mapa', (55, 130, 910, 475), 400, ''),
    'vote_chip': ('mapa', (1045, 115, 1445, 385), 96, ''),
    'vote_flag': ('mapa', (1575, 120, 1950, 480), 96, ''),
    'pick_banner': ('mapa', (55, 640, 1995, 1190), 800, ''),
    'cursor_host': ('mapa', (185, 1340, 610, 1905), 128, 'cc nored deglow'),
    'cursor_guest': ('mapa', (885, 1440, 1240, 1905), 112, 'cc nored deglow'),
    'level_lock': ('mapa', (1535, 1490, 1935, 1905), 96, ''),
}


def key_green(rgb, bg):
    d = np.sqrt(((rgb - bg) ** 2).sum(2))
    hard = d < 45
    near = nd.binary_dilation(hard, iterations=3) & ~hard  # borde: alfa suave y des-mezcla del verde
    a = np.ones(d.shape)
    a[hard] = 0
    ramp = np.clip((d - 45) / 75.0, 0, 1)
    a[near] = ramp[near]
    out = rgb.copy()
    m = near & (a > 0.02)
    out[m] = np.clip((rgb[m] - (1 - a[m, None]) * bg) / a[m, None], 0, 255)
    return out, a


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else 'art-source/Nuevos assets')
    dst = Path(sys.argv[2] if len(sys.argv) > 2 else 'public/online')
    dst.mkdir(parents=True, exist_ok=True)
    cache = {}
    for name, (hoja, box, out_w, opts) in PIEZAS.items():
        if hoja not in cache:
            cache[hoja] = np.array(Image.open(src / HOJAS[hoja]).convert('RGB')).astype(float)
        sheet = cache[hoja]
        bg = np.median(sheet.reshape(-1, 3), axis=0)
        x0, y0, x1, y1 = box
        crop = sheet[y0:y1, x0:x1]
        rgb, a = key_green(crop, bg)
        if 'nored' in opts:  # rojo/naranja de la barra "warn" que queda detrás
            red = (crop[..., 0] > 150) & (crop[..., 1] < 150) & (crop[..., 2] < 120)
            a[nd.binary_dilation(red, iterations=2)] = 0
        if 'deglow' in opts:  # verdoso y cerca del fondo: es resplandor mezclado con el verde, no arte
            greenish = (rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])) > 12
            near_bg = nd.binary_dilation(a < 0.05, iterations=80)
            near_bg[:60] = near_bg[-60:] = True
            near_bg[:, :60] = near_bg[:, -60:] = True  # el resplandor llega hasta el borde de la caja
            a[greenish & near_bg] = 0
        if 'cc' in opts:
            a[~nd.binary_opening(a > 0.5, iterations=3)] = 0  # fuera líneas finas (restos del rótulo)
            lab, k = nd.label(a > 0.5, structure=np.ones((3, 3)))
            if k:
                big = np.argmax(nd.sum(np.ones_like(lab), lab, range(1, k + 1))) + 1
                a[~nd.binary_dilation(lab == big, iterations=4)] = 0
        ys, xs = np.where(a > 0.04)
        rgba = np.dstack([rgb, a * 255]).astype(np.uint8)[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        im = Image.fromarray(rgba, 'RGBA')
        h = round(im.height * out_w / im.width)
        # premultiplicado al reducir: sin halos de color en el borde
        pm = np.array(im).astype(float)
        pm[..., :3] *= pm[..., 3:4] / 255
        small = Image.fromarray(pm.astype(np.uint8), 'RGBA').resize((out_w, h), Image.LANCZOS)
        s = np.array(small).astype(float)
        al = np.maximum(s[..., 3:4], 1)
        s[..., :3] = np.clip(s[..., :3] * 255 / al, 0, 255)
        Image.fromarray(s.astype(np.uint8), 'RGBA').save(dst / f'{name}.png', optimize=True)
        print(f'{name:20s} {im.width}x{im.height} -> {out_w}x{h}')


if __name__ == '__main__':
    main()
