"""Audit of public/assets/data/extra/extra*.tmx: no two objects overlap, everything stands on a floor tile, the boss
arena only holds the boss, its gate and a checkpoint. Optional: --png DIR renders each boss arena (tiles + object boxes).

usage: python verify_extra_levels.py [--png DIR]      (exit code 1 on any violation)
"""
import base64
import glob
import os
import struct
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRA = os.path.join(ROOT, 'public', 'assets', 'data', 'extra')
TS = 32
SKIP = {'Door', 'PlatformInterp', 'PlatformLinear', 'Hero'}
FLYERS = {'SvBat', 'Bird', 'Double', 'SmartUFO', 'Bomb'}
SOLID = ('pHard', 'pPlatform', 'pLadderEnd')


def props(o):
    return {p.get('name'): p.get('value') for p in o.iter('property')}


def load(path):
    root = ET.parse(path).getroot()
    layer = root.find('layer')
    w, h = int(layer.get('width')), int(layer.get('height'))
    g = struct.unpack('<%dI' % (w * h), base64.b64decode(layer.find('data').text.strip()))
    ts = root.find('tileset')
    first = int(ts.get('firstgid'))
    state = {}
    for t in ts.findall('tile'):
        for p in t.iter('property'):
            if p.get('value') == 'true' and p.get('name') != 'pInvisible':
                state[int(t.get('id')) + first] = p.get('name')
    objs = []
    for o in root.iter('object'):
        if o.get('type') in SKIP:
            continue
        x, y, w_, h_ = (float(o.get(k) or 32) for k in ('x', 'y', 'width', 'height'))
        pr = props(o)
        objs.append(dict(type=o.get('type'), asset=pr.get('pAsset', ''), x=x, y=y, w=w_, h=h_, p=pr))
    doors = [dict(x=float(o.get('x')), y=float(o.get('y')), w=float(o.get('width')), h=float(o.get('height')))
             for o in root.iter('object') if o.get('type') == 'Door']
    return root, w, h, g, state, objs, doors, ts.find('image').get('source')


def audit(path, png_dir=None):
    root, w, h, g, state, objs, doors, tileset = load(path)
    st = lambda cx, cy: state.get(g[cy * w + cx] & 0x1fffffff) if 0 <= cx < w and 0 <= cy < h else None
    bad = []
    name = os.path.basename(path)
    for i, o in enumerate(objs):
        cx = int(o['x'] // TS)
        foot = int((o['y'] + o['h']) // TS)
        o['cell'] = (cx, foot)
        if o['type'] in ('Information',) or o['asset'] == 'ENDING':
            continue
        reach = 5 if o['type'] in FLYERS or o['type'] == 'Bird' else 3
        if not any(st(cx, r) in SOLID for r in range(foot, foot + reach)):
            bad.append('%s: %s %s at %s is not over a floor' % (name, o['type'], o['asset'], o['cell']))
    # overlaps: same cell for anything, and two non-coin objects closer than 1 tile on the same row
    for i, a in enumerate(objs):
        for b in objs[i + 1:]:
            if a['type'] == 'Information' or b['type'] == 'Information' or 'ENDING' in (a['asset'], b['asset']):
                continue
            ax, ay = a['cell']
            bx, by = b['cell']
            coins = a['asset'] == 'COIN' and b['asset'] == 'COIN'
            if (ax, ay) == (bx, by) or (not coins and ay == by and abs(ax - bx) <= 1):
                bad.append('%s: %s/%s overlaps %s/%s at %s' % (name, a['type'], a['asset'], b['type'], b['asset'], a['cell']))
    boss = next((o for o in objs if 'pArenaX0' in o['p']), None)
    if boss:
        x0, x1 = int(boss['p']['pArenaX0']), int(boss['p']['pArenaX1'])
        inside = [o for o in objs if x0 <= o['x'] < x1 and o is not boss and o['type'] not in ('SavePoint',)]
        for o in inside:
            bad.append('%s: %s %s inside the boss arena at %s' % (name, o['type'], o['asset'], o['cell']))
        # decoration: distinct visible tiles above the arena floor, and how often each repeats
        seen = {}
        for cx in range(x0 // TS, x1 // TS):
            for cy in range(h):
                gid = g[cy * w + cx] & 0x1fffffff
                if gid and st(cx, cy) not in SOLID + ('pKilling',) and gid not in (1,):
                    seen[gid] = seen.get(gid, 0) + 1
        print('  arena %d..%d cols, decoration tiles (gid: count): %s' % (x0 // TS, x1 // TS, dict(sorted(seen.items()))))
        if png_dir:
            render(root, w, h, g, tileset, objs, doors, x0, x1, os.path.join(png_dir, name.replace('.tmx', '_arena.png')))
    n = {}
    for o in objs:
        n[o['type']] = n.get(o['type'], 0) + 1
    print(name, w, 'x', h, ' '.join('%s=%d' % kv for kv in sorted(n.items())), 'OK' if not bad else '%d problems' % len(bad))
    return bad


def render(root, w, h, g, tileset, objs, doors, x0, x1, out):
    from PIL import Image, ImageDraw
    ts_el = root.find('tileset')
    first = int(ts_el.get('firstgid'))
    inv = {int(t.get('id')) for t in ts_el.findall('tile')
           if any(p.get('name') == 'pInvisible' and p.get('value') == 'true' for p in t.iter('property'))}
    tiles = Image.open(os.path.join(ROOT, 'public', tileset.replace('/tiles/', '/tiles/win/'))).convert('RGBA')
    tc = tiles.width // TS
    c0, c1 = x0 // TS - 8, x1 // TS + 3
    img = Image.new('RGBA', ((c1 - c0) * TS, h * TS), (30, 30, 50, 255))
    for cy in range(h):
        for cx in range(max(0, c0), min(w, c1)):
            gid = g[cy * w + cx] & 0x1fffffff
            if gid and gid - first not in inv:
                k = gid - first
                img.alpha_composite(tiles.crop(((k % tc) * TS, (k // tc) * TS, (k % tc + 1) * TS, (k // tc + 1) * TS)),
                                    ((cx - c0) * TS, cy * TS))
    d = ImageDraw.Draw(img)
    for o in objs:
        px = o['x'] - c0 * TS
        d.rectangle([px, o['y'], px + o['w'], o['y'] + o['h']], outline=(255, 255, 0, 255))
        d.text((px, o['y'] - 10), (o['asset'] or o['type'])[:8], fill=(255, 255, 255, 255))
    for dr in doors:
        px = dr['x'] - c0 * TS
        d.rectangle([px, dr['y'], px + dr['w'], dr['y'] + dr['h']], outline=(255, 0, 0, 255))
    d.line([(x0 - c0 * TS, 0), (x0 - c0 * TS, h * TS)], fill=(0, 255, 0, 255))
    img.crop((0, 8 * TS, img.width, h * TS)).convert('RGB').save(out)


def main():
    png = sys.argv[sys.argv.index('--png') + 1] if '--png' in sys.argv else None
    if png:
        os.makedirs(png, exist_ok=True)
    files = sorted(glob.glob(os.path.join(EXTRA, 'extra*.tmx')), key=lambda f: int(os.path.basename(f)[5:-4]))
    bad = []
    for f in files:
        bad += audit(f, png)
    for b in bad:
        print('PROBLEM', b)
    print('%d levels, %d problems' % (len(files), len(bad)))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
