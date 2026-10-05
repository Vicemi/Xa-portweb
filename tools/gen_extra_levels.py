"""Build the extra levels of map 2 (public/assets/data/extra/extraN.tmx) out of the original Xa levels and the
Super Vampire Ninja Zero enemies (tools/import_svnz.py).

Each extra level takes the terrain of an original level so tiles, ladders, platforms and secrets keep Xa's look:
  - horizontal levels are remixed: a start stretch and an end stretch of the original are spliced on a column
    where both tile columns are identical, so the seam is invisible and the ground keeps its height;
  - tall (vertical) levels keep their whole terrain;
  - the boss level builds an arena by repeating a flat column of the original between its start and its exit.
Then the objects of the kept stretches are moved along, tutorial signs are replaced by new ones, and part of the
Xa enemies are swapped for SVNZ ones (seeded, so the output is stable).

usage: python gen_extra_levels.py
"""
import base64
import os
import random
import struct
import xml.etree.ElementTree as ET
from copy import deepcopy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'assets', 'data')
OUT = os.path.join(DATA, 'extra')
TS = 32

# (base level, background, music, cut ranges as fractions [keep start until A, resume at B] or None,
#  swap probabilities, extra signs)
LEVELS = [
    dict(base=2, bg='background_1.jpg', music='svnz_bgm.ogg', cut=(0.42, 0.62),
         swap={'Enemy': ('SvNinja', 0.7), 'Bird': ('SvBat', 0.6), 'Jumper': ('SvRedNinja', 0.6),
               'Double': ('SvBat', 0.3)},
         sign='\\!Cuidado Xa! Unos ninjas demonio\\nllegaron a la costa.'),
    dict(base=11, bg='svnz_arena.jpg', music='svnz_bgm.ogg', cut=(0.35, 0.6),
         swap={'Enemy': ('SvNinja', 0.8), 'Bomb': ('SvBat', 0.3), 'SmartUFO': ('SvBat', 0.3),
               'FloorCannon': (['SvNinja', 'SvNinja', 'SvRedNinja', 'SvBigDemon'], 0.45)},
         sign='Los ninjas rojos saltan sobre vos.\\n\\!Disparales antes de que caigan!'),
    dict(base=8, bg='svnz_grid.jpg', music='svnz_bgm.ogg', cut=(0.4, 0.6),
         swap={'Enemy': ('SvNinja', 0.5), 'Jumper': ('SvRedNinja', 0.6), 'Bird': ('SvBat', 0.7),
               'UFO': ('SvBat', 0.3), 'Android': ('SvBigDemon', 0.3)},
         sign='Los murci\\ielagos se lanzan en picada.\\n\\!No te quedes debajo!'),
    dict(base=6, bg='svnz_dungeon.jpg', music='svnz_bgm.ogg', cut=None,
         swap={'Enemy': ('SvNinja', 0.6), 'Bird': ('SvBat', 0.8), 'Jumper': ('SvRedNinja', 0.6),
               'Android': ('SvBigDemon', 0.35), 'Ultraton': ('SvBigDemon', 0.3)},
         sign='Un gran demonio vive en la cantera.\\nSu golpe hace temblar el suelo.'),
    dict(base=4, bg='background_4.jpg', music='svnz_bgm.ogg', cut=None,
         swap={'Enemy': (['SvNinja', 'SvNinja', 'SvBigDemon'], 0.6), 'Bird': ('SvBat', 0.6),
               'Jumper': ('SvRedNinja', 0.6), 'Double': ('SvBat', 0.25), 'Thrower': ('SvRedNinja', 0.3)},
         sign='Las vacas de la granja te esperan.\\n\\!Rescatalas a todas!'),
    dict(base=7, bg='svnz_dojo.jpg', music='svnz_bgm.ogg', cut=(0.45, 0.6),
         swap={'Enemy': ('SvNinja', 0.8), 'Bird': ('SvBat', 0.8), 'Jumper2': (['SvRedNinja', 'SvNinja'], 0.6),
               'Double': ('SvBat', 0.3), 'Ultraton': ('SvBigDemon', 0.5)},
         sign='La noche es de los vampiros.\\n\\!Seguí adelante!'),
    dict(base=9, bg='svnz_arena.jpg', music='svnz_boss.ogg', cut=(0.4, 0.62),
         swap={'Enemy': ('SvNinja', 0.8), 'Jumper2': ('SvRedNinja', 0.8),
               'FloorCannon': (['SvNinja', 'SvRedNinja', 'SvRedNinja', 'SvBigDemon'], 0.5)},
         sign='Dr\\acula se esconde m\\as adelante.\\n\\!Prep\\arate!'),
    dict(base=7, bg='svnz_dojo.jpg', music='svnz_boss.ogg', cut=None, boss=True,
         swap={'Enemy': ('SvNinja', 0.8), 'Bird': ('SvBat', 0.9), 'Jumper2': (['SvRedNinja', 'SvNinja'], 0.8),
               'Double': ('SvBat', 0.5), 'Ultraton': ('SvBigDemon', 0.8)},
         sign='\\!Dr\\acula! Vencelo para conseguir\\nla llave de la salida.'),
]

KEEP_TYPES = {'Hero', 'Item', 'Cow', 'SavePoint', 'PlatformInterp', 'PlatformLinear', 'Door'}


def read_level(n):
    tree = ET.parse(os.path.join(DATA, 'level%d.tmx' % n))
    root = tree.getroot()
    layer = root.find('layer')
    data = layer.find('data')
    raw = base64.b64decode(data.text.strip())
    w, h = int(layer.get('width')), int(layer.get('height'))
    gids = list(struct.unpack('<%dI' % (w * h), raw))
    grid = [gids[y * w:(y + 1) * w] for y in range(h)]
    return tree, root, grid, w, h


def column(grid, x):
    return tuple(row[x] for row in grid)


def find_seam(grid, w, a_frac, b_frac):
    """Columns (a, b) near the wanted fractions with identical tile columns: keep [0, a] + [b+1, w)."""
    a0, b0 = int(w * a_frac), int(w * b_frac)
    best = None
    for da in range(0, 60):
        for a in (a0 - da, a0 + da):
            if not 8 < a < w - 8:
                continue
            ca = column(grid, a)
            if all(v == 0 for v in ca):
                continue
            for db in range(0, 60):
                for b in (b0 - db, b0 + db):
                    if a + 20 < b < w - 20 and column(grid, b) == ca:
                        cost = da + db
                        if best is None or cost < best[0]:
                            best = (cost, a, b)
            if best and best[0] <= da:
                return best[1], best[2]
    if not best:
        raise SystemExit('no seam')
    return best[1], best[2]


def flat_column(grid, w, h, x0, x1):
    """Rightmost column in [x0, x1) whose neighbours are identical (a flat stretch of floor)."""
    for x in range(x1 - 2, x0, -1):
        c = column(grid, x)
        if c == column(grid, x - 1) == column(grid, x + 1) and any(c):
            return x
    return x0


def objects(root):
    return [o for og in root.iter('objectgroup') for o in og.findall('object')]


def prop(o, name, value=None):
    props = o.find('properties')
    if props is None:
        props = ET.SubElement(o, 'properties')
    for p in props.findall('property'):
        if p.get('name') == name:
            if value is not None:
                p.set('value', value)
            return p.get('value')
    if value is not None:
        ET.SubElement(props, 'property', name=name, value=value)
    return value


def make_sv(o, kind, lives=None):
    o.set('type', kind)
    o.set('name', kind)
    props = o.find('properties')
    if props is not None:
        o.remove(props)
    prop(o, 'pTeam', '1')
    if lives:
        prop(o, 'pLives', str(lives))
    if kind == 'SvBat':
        prop(o, 'pxDelta', '70')


def build(i, spec):
    rnd = random.Random(1000 + i)
    tree, root, grid, w, h = read_level(spec['base'])
    objs = objects(root)
    og = next(root.iter('objectgroup'))
    for o in objs:
        og.remove(o)

    # ---- terrain ----
    if spec.get('boss'):
        # start stretch + a 40-column flat arena + the exit stretch
        a = flat_column(grid, w, h, 30, int(w * 0.3))
        end0 = flat_column(grid, w, h, int(w * 0.8), w - 6)
        arena = 40
        cols = list(range(0, a + 1)) + [a] * arena + list(range(end0, w))
        shift = [(0, a + 1, 0), (end0, w, (a + 1 + arena) - end0)]
        arena_x = (a + 1) * TS, (a + 1 + arena) * TS
    elif spec['cut']:
        a, b = find_seam(grid, w, *spec['cut'])
        cols = list(range(0, a + 1)) + list(range(b + 1, w))
        shift = [(0, a + 1, 0), (b + 1, w, a - b)]
        arena_x = None
    else:
        cols = list(range(w))
        shift = [(0, w, 0)]
        arena_x = None
    nw = len(cols)
    new = [[row[c] for c in cols] for row in grid]
    root.set('width', str(nw))
    layer = root.find('layer')
    layer.set('width', str(nw))
    flat = [g for row in new for g in row]
    layer.find('data').text = '\n   ' + base64.b64encode(struct.pack('<%dI' % len(flat), *flat)).decode() + '\n  '
    if og.get('width'):
        og.set('width', str(nw))

    # ---- map properties ----
    mp = root.find('properties')
    for p in mp.findall('property'):
        if p.get('name') == 'pBackground':
            p.set('value', spec['bg'])
        elif p.get('name') == 'pMusic':
            p.set('value', spec['music'])

    # ---- objects ----
    def moved(o):
        x = float(o.get('x'))
        for c0, c1, dx in shift:
            if c0 * TS <= x < c1 * TS:
                if o.get('width') and x + float(o.get('width')) > c1 * TS + 1 and o.get('type') != 'Hero':
                    return None
                return x + dx * TS
        return None

    signs = []
    kept = []
    for o in objs:
        x = moved(o)
        if x is None:
            continue
        o = deepcopy(o)
        o.set('x', str(int(x)) if x == int(x) else str(x))
        t = o.get('type')
        if t == 'Information':
            signs.append(o)
            continue
        if t in spec['swap'] and rnd.random() < spec['swap'][t][1]:
            kind = spec['swap'][t][0]
            make_sv(o, rnd.choice(kind) if isinstance(kind, list) else kind)
        kept.append(o)

    # one new sign at the start (where the first original sign stood) and a few more ninjas where tutorial
    # signs used to be (they always stand on the floor)
    signs.sort(key=lambda o: float(o.get('x')))
    if signs:
        s0 = signs[0]
        prop(s0, 'pText', spec['sign'])
        kept.append(s0)
        for s in signs[1:]:
            if rnd.random() < 0.5:
                make_sv(s, rnd.choice(['SvNinja', 'SvNinja', 'SvRedNinja']))
                s.set('width', '32')
                s.set('height', '32')
                s.set('y', str(float(s.get('y')) + float(s.get('height', 32)) - 32))
                kept.append(s)

    if arena_x:
        # Dracula in the middle of the arena, and the gate he holds the key of right after it
        ground = None
        for y in range(h):
            if new[y][(arena_x[0] // TS) + 5]:
                ground = y * TS
                break
        d = ET.Element('object', name='Dracula', type='SvDracula', x=str(arena_x[0] + 26 * TS), y=str(ground - 32),
                       width='32', height='32')
        prop(d, 'pTeam', '1')
        prop(d, 'pRequiredItem', 'KEY')
        prop(d, 'pLookDir', '-1')
        kept.append(d)
        door = ET.Element('object', name='Puerta', type='Door', x=str(arena_x[1] + 2 * TS), y=str(ground - 128),
                          width='32', height='128')
        for k, v in (('pAsset', 'GATE'), ('pIsKey', 'true'), ('pRequiredCount', '1'), ('pRequiredItem', 'KEY')):
            prop(door, k, v)
        kept.append(door)
        sv = ET.Element('object', name='Save', type='SavePoint', x=str(arena_x[0] - 3 * TS), y=str(ground - 32),
                        width='32', height='32')
        prop(sv, 'pMusic', 'svnz_boss.ogg')
        kept.append(sv)
        # no regular enemies inside the arena
        kept = [o for o in kept if not (arena_x[0] <= float(o.get('x')) < arena_x[1] and o.get('type') not in
                                        ('SvDracula', 'Item', 'Cow', 'SavePoint'))]

    for k, o in enumerate(kept):
        o.set('id', str(k + 1)) if o.get('id') else None
        og.append(o)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'extra%d.tmx' % (i + 1))
    tree.write(path, encoding='UTF-8', xml_declaration=True)
    counts = {}
    for o in kept:
        counts[o.get('type')] = counts.get(o.get('type'), 0) + 1
    print('extra%d' % (i + 1), 'base', spec['base'], 'size', nw, 'x', h,
          {k: v for k, v in sorted(counts.items()) if k.startswith('Sv') or k in ('Cow', 'Hero', 'Door')})


def preview(i):
    """Intro card strip (512x115) of extra level i: the screen at the hero's start, background + tiles."""
    from PIL import Image
    tree, root, grid, w, h = None, None, None, 0, 0
    root = ET.parse(os.path.join(OUT, 'extra%d.tmx' % (i + 1))).getroot()
    layer = root.find('layer')
    w, h = int(layer.get('width')), int(layer.get('height'))
    gids = struct.unpack('<%dI' % (w * h), base64.b64decode(layer.find('data').text.strip()))
    ts_el = root.find('tileset')
    first = int(ts_el.get('firstgid'))
    invisible = {int(t.get('id')) for t in ts_el.findall('tile')
                 if any(p.get('name') == 'pInvisible' and p.get('value') == 'true' for p in t.iter('property'))}
    tiles = Image.open(os.path.join(ROOT, 'public', ts_el.find('image').get('source').replace('/tiles/', '/tiles/win/'))).convert('RGBA')
    cols = tiles.width // TS
    bg_name = next(p.get('value') for p in root.find('properties') if p.get('name') == 'pBackground')
    bg = Image.open(os.path.join(ROOT, 'public', 'assets', 'images', 'background', bg_name)).convert('RGBA')
    hero = next(o for o in root.iter('object') if o.get('type') == 'Hero')
    hx, hy = float(hero.get('x')), float(hero.get('y'))
    cx = max(0, min(w * TS - 512, int(hx - 120)))
    cy = max(0, min(h * TS - 384, int(hy - 250)))
    screen = Image.new('RGBA', (512, 384))
    screen.alpha_composite(bg.crop((0, 0, 512, 384)))
    for ty in range(cy // TS, min(h, (cy + 384) // TS + 1)):
        for tx in range(cx // TS, min(w, (cx + 512) // TS + 1)):
            g = gids[ty * w + tx] & 0x1fffffff
            if not g:
                continue
            idx = g - first
            if idx in invisible:
                continue
            tile = tiles.crop(((idx % cols) * TS, (idx // cols) * TS, (idx % cols + 1) * TS, (idx // cols + 1) * TS))
            screen.alpha_composite(tile, (tx * TS - cx, ty * TS - cy))
    top = max(0, min(384 - 115, int(hy - cy) - 80))
    return screen.crop((0, top, 512, top + 115)).convert('RGB')


def main():
    from PIL import Image
    for i, spec in enumerate(LEVELS):
        build(i, spec)
    strip = Image.new('RGB', (512, 115 * len(LEVELS)))
    for i in range(len(LEVELS)):
        strip.paste(preview(i), (0, i * 115))
    strip.save(os.path.join(ROOT, 'public', 'assets', 'images', 'menuElements', 'preview_extra.jpg'), quality=90)


if __name__ == '__main__':
    main()
