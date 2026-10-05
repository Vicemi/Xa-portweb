"""Build the extra levels of map 2 (public/assets/data/extra/extraN.tmx) with the tiles of the original Xa levels
and the Super Vampire Ninja Zero enemies (tools/import_svnz.py).

The levels are NOT copies of the originals: each one is a new layout walked over the terrain of one or two
original levels with the same tileset. Two tile columns that are identical over the whole height are
interchangeable, so the walk advances a random stretch, then jumps to an identical twin column somewhere else
(of that level or of the other one) and carries on from there. Sections come out in a different order,
repeated or skipped, and the seams are invisible. Every 3rd level ends in a boss arena (a flat floor column
repeated) with the boss, a checkpoint before it and the gate whose key it drops; then the walk reaches the
original exit stretch.

Objects travel with their columns (coins, cows, items, checkpoints, moving platforms, which also get a new
speed). Tutorial signs are dropped for one new sign, part of the Xa enemies become SVNZ ones and more SVNZ
enemies are placed on the new floors. All random choices are seeded, so the output is stable.

usage: python gen_extra_levels.py
"""
import base64
import os
import random
import struct
import xml.etree.ElementTree as ET
from collections import defaultdict
from copy import deepcopy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'assets', 'data')
OUT = os.path.join(DATA, 'extra')
TS = 32

# bases: original levels whose terrain is walked (same tileset and height); length: target width in columns
LEVELS = [
    # ---- tramo 1 ----
    dict(bases=[2, 1], length=300, bg='background_1.jpg',
         swap={'Enemy': ('SvNinja', 0.7), 'Bird': ('SvBat', 0.6), 'Jumper': ('SvRedNinja', 0.6), 'Double': ('SvBat', 0.3)},
         add=['SvNinja', 'SvNinja', 'SvRedNinja'],
         sign='\\!Cuidado Xa! Unos ninjas demonio\\nllegaron a la costa.'),
    dict(bases=[11], length=380, bg='svnz_arena.jpg',
         swap={'Enemy': ('SvNinja', 0.8), 'Bomb': ('SvBat', 0.3), 'SmartUFO': ('SvBat', 0.3),
               'FloorCannon': (['SvNinja', 'SvNinja', 'SvRedNinja', 'SvBigDemon'], 0.45)},
         add=['SvNinja', 'SvRedNinja'],
         sign='Los ninjas rojos saltan sobre vos.\\n\\!Disparales antes de que caigan!'),
    dict(bases=[8], length=280, bg='svnz_grid.jpg', boss='SvGoldNinja',
         swap={'Enemy': ('SvNinja', 0.5), 'Jumper': ('SvRedNinja', 0.6), 'Bird': ('SvBat', 0.7),
               'UFO': ('SvBat', 0.3), 'Android': ('SvBigDemon', 0.3)},
         add=['SvNinja', 'SvRedNinja', 'SvNinja'],
         sign='Un ninja dorado custodia la salida.\\n\\!Vencelo para conseguir la llave!'),
    # ---- tramo 2 ----
    dict(bases=[10], length=360, bg='svnz_dungeon.jpg',
         swap={'Enemy': ('SvNinja', 0.8), 'Jumper2': ('SvRedNinja', 0.7), 'Bird': ('SvBat', 0.7),
               'Android': ('SvBigDemon', 0.4), 'FloorCannon': (['SvNinja', 'SvRedNinja'], 0.3)},
         add=['SvNinja', 'SvBigDemon', 'SvRedNinja'],
         sign='Un gran demonio anda suelto.\\nSu golpe hace temblar el suelo.'),
    dict(bases=[3], length=360, bg='background_3.jpg',
         swap={'Enemy': ('SvNinja', 0.7), 'Bird': ('SvBat', 0.7), 'Jumper': ('SvRedNinja', 0.7), 'Double': ('SvBat', 0.3)},
         add=['SvNinja', 'SvRedNinja', 'SvBat'],
         sign='Las vacas de la granja te esperan.\\n\\!Rescatalas a todas!'),
    dict(bases=[7], length=240, bg='svnz_dojo.jpg', boss='SvBigDemonBoss',
         swap={'Enemy': ('SvNinja', 0.8), 'Bird': ('SvBat', 0.8), 'Jumper2': (['SvRedNinja', 'SvNinja'], 0.6),
               'Double': ('SvBat', 0.3), 'Ultraton': ('SvBigDemon', 0.5)},
         add=['SvNinja', 'SvRedNinja', 'SvBigDemon'],
         sign='El gran demonio te espera\\nal final del bosque.'),
    # ---- tramo 3 ----
    dict(bases=[9], length=360, bg='svnz_arena.jpg',
         swap={'Enemy': ('SvNinja', 0.8), 'Jumper2': ('SvRedNinja', 0.8),
               'FloorCannon': (['SvNinja', 'SvRedNinja', 'SvRedNinja', 'SvBigDemon'], 0.5)},
         add=['SvNinja', 'SvRedNinja'],
         sign='Las calles est\\an tomadas\\npor los vampiros.'),
    dict(bases=[1, 2], length=320, bg='background_2.jpg',
         swap={'Enemy': (['SvNinja', 'SvRedNinja'], 0.8), 'Bird': ('SvBat', 0.8), 'Jumper': ('SvRedNinja', 0.7),
               'Double': ('SvBat', 0.3)},
         add=['SvRedNinja', 'SvNinja', 'SvBigDemon'],
         sign='Los vi\\medos est\\an llenos de ninjas.\\n\\!No te detengas!'),
    dict(bases=[3], length=320, bg='svnz_grid.jpg', boss='SvLucy',
         swap={'Enemy': ('SvNinja', 0.7), 'Bird': ('SvBat', 0.7), 'Jumper': ('SvRedNinja', 0.7), 'Double': ('SvBat', 0.3)},
         add=['SvRedNinja', 'SvNinja'],
         sign='Lucy, la hermana de Mina,\\nfue pose\\ida por Dr\\acula.'),
    # ---- tramo 4 ----
    dict(bases=[11], length=400, bg='background_11.jpg',
         swap={'Enemy': ('SvNinja', 0.8), 'Bomb': ('SvBat', 0.4), 'SmartUFO': ('SvBat', 0.4),
               'FloorCannon': (['SvNinja', 'SvRedNinja', 'SvBigDemon'], 0.5)},
         add=['SvBigDemon', 'SvNinja', 'SvRedNinja'],
         sign='En los muelles viejos\\nhay demonios por todos lados.'),
    dict(bases=[9], length=380, bg='background_9.jpg',
         swap={'Enemy': ('SvNinja', 0.8), 'Jumper2': ('SvRedNinja', 0.8),
               'FloorCannon': (['SvNinja', 'SvRedNinja', 'SvBigDemon'], 0.55)},
         add=['SvNinja', 'SvRedNinja', 'SvBigDemon'],
         sign='Dr\\acula est\\a muy cerca.\\n\\!Prep\\arate!'),
    dict(bases=[7], length=260, bg='svnz_dungeon.jpg', boss='SvDracula',
         swap={'Enemy': ('SvNinja', 0.8), 'Bird': ('SvBat', 0.9), 'Jumper2': (['SvRedNinja', 'SvNinja'], 0.8),
               'Double': ('SvBat', 0.5), 'Ultraton': ('SvBigDemon', 0.8)},
         add=['SvRedNinja', 'SvNinja', 'SvBat'],
         sign='\\!El castillo de Dr\\acula!\\nVencelo para salvar al planeta.'),
]

ARENA = 36


class Base:
    def __init__(self, n):
        self.n = n
        self.tree = ET.parse(os.path.join(DATA, 'level%d.tmx' % n))
        self.root = self.tree.getroot()
        layer = self.root.find('layer')
        self.w, self.h = int(layer.get('width')), int(layer.get('height'))
        g = struct.unpack('<%dI' % (self.w * self.h), base64.b64decode(layer.find('data').text.strip()))
        self.cols = [tuple(g[y * self.w + x] for y in range(self.h)) for x in range(self.w)]
        self.objs = [o for og in self.root.iter('objectgroup') for o in og.findall('object')]
        ts = self.root.find('tileset')
        self.tileset = ts.find('image').get('source')
        first = int(ts.get('firstgid'))
        self.state = {}
        for t in ts.findall('tile'):
            for p in t.iter('property'):
                if p.get('value') == 'true':
                    self.state[int(t.get('id')) + first] = p.get('name')


def walk(bases, length, rnd, boss):
    """New column order: a list of (base index, column), and where the boss arena starts."""
    twins = defaultdict(list)
    for bi, b in enumerate(bases):
        for x, c in enumerate(b.cols):
            if any(c):
                twins[c].append((bi, x))
    b0 = bases[0]
    # the walk must not jump past the exit item of the first level
    end_col = min([int(float(o.get('x')) // TS) for o in b0.objs
                   if any(p.get('value') == 'ENDING' for p in o.iter('property'))] or [b0.w])
    out = []
    visits = defaultdict(int)
    arena_at = None
    state = {'bi': 0, 'x': 0}

    def put(bi, x0, x1):
        for xx in range(x0, x1):
            out.append((bi, xx))
            visits[(bi, xx // 20)] += 1

    def jumps(bi, x, finishing):
        c = bases[bi].cols[x]
        cand = [(b2, y) for (b2, y) in twins[c] if (b2 != bi or abs(y - x) >= 15) and y < bases[b2].w - 2]
        if finishing:
            return [(b2, y) for (b2, y) in cand if b2 == 0 and b0.w * 0.66 <= y < end_col - 3]
        # keep the exit stretch for the end, and stay out of the second level's own exit (no way back from there)
        return [(b2, y) for (b2, y) in cand if y < (min(b0.w * 0.8, end_col - 12) if b2 == 0 else bases[b2].w * 0.7)]

    def arena_col(bb, k):
        # repeating one column always gives a flat floor; it only has to be plain ground: a hard tile with at
        # least 5 free tiles above it, and no spikes, ladders or one-way platforms in the column
        c = bb.cols[k]
        if any(bb.state.get(g) in ('pKilling', 'pLadder', 'pLadderEnd', 'pPlatform') for g in c):
            return False
        for y in range(5, bb.h):
            if bb.state.get(c[y]) == 'pHard':
                return all(bb.state.get(c[yy]) != 'pHard' for yy in range(y - 5, y))
        return False

    finishing = False
    for _ in range(800):
        bi, x = state['bi'], state['x']
        b = bases[bi]
        if bi == 0 and finishing and b0.w * 0.66 <= x < end_col:
            put(bi, x, b0.w)                        # the original exit stretch
            return out, arena_at
        # walk a stretch, then look ahead for a column with a twin to jump from
        run = rnd.randint(16, 38)
        stop = min(b.w - 1, x + run) if bi == 0 else min(int(b.w * 0.75), x + run)
        put(bi, x, stop)
        x = stop
        if len(out) >= length and not finishing:
            if boss and arena_at is None:
                # arena: on the next flat floor column (identical to its neighbour)
                for k in range(x, b.w - 1):
                    if arena_col(b, k):
                        put(bi, x, k + 1)
                        arena_at = len(out)
                        out.extend([(bi, k)] * ARENA)
                        x = k + 1
                        break
                else:
                    state['x'] = x
                    continue
            finishing = True
        for k in range(x, min(b.w - 1, x + 30)):
            cand = jumps(bi, k, finishing)
            if cand:
                put(bi, x, k + 1)
                cand.sort(key=lambda q: (visits[(q[0], q[1] // 20)], rnd.random()))
                nb, y = cand[0] if rnd.random() < 0.7 else rnd.choice(cand[:4])
                state['bi'], state['x'] = nb, y + 1
                break
        else:
            nx = min(b.w - 1, x + 30)
            if bi == 0 and nx >= b0.w - 1:
                # the walk ran into the exit: the arena (if still missing) goes on the last flat column before it
                if boss and arena_at is None:
                    for k in range(b0.w - 3, x - 1, -1):
                        if arena_col(b0, k):
                            put(0, x, k + 1)
                            arena_at = len(out)
                            out.extend([(0, k)] * ARENA)
                            x = k + 1
                            break
                put(0, x, b0.w)
                return out, arena_at
            if bi != 0 and nx >= b.w - 1:
                # end of the second level: go back to the first one through any twin column at all
                for k in range(x, b.w):
                    back = [(b2, y) for (b2, y) in twins[b.cols[k]]
                            if (b2 == 0 and y < b0.w - 2) or (b2 == bi and y < k - 15)]
                    if back:
                        put(bi, x, k + 1)
                        nb, y = rnd.choice(back)
                        state['bi'], state['x'] = nb, y + 1
                        break
                else:
                    raise SystemExit('stuck at the end of level %d' % b.n)
                continue
            put(bi, x, nx)
            state['bi'], state['x'] = bi, nx
    raise SystemExit('walk did not reach the exit')


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


def make_sv(o, kind):
    o.set('type', kind)
    o.set('name', kind)
    props = o.find('properties')
    if props is not None:
        o.remove(props)
    prop(o, 'pTeam', '1')
    if kind == 'SvBat':
        prop(o, 'pxDelta', '70')


def build(i, spec):
    rnd = random.Random(2000 + i)
    bases = [Base(n) for n in spec['bases']]
    b0 = bases[0]
    assert all(b.h == b0.h and b.tileset == b0.tileset for b in bases)
    out, arena_at = walk(bases, spec['length'], rnd, spec.get('boss'))
    nw, h = len(out), b0.h

    # ---- tiles ----
    tree = deepcopy(b0.tree)
    root = tree.getroot()
    root.set('width', str(nw))
    layer = root.find('layer')
    layer.set('width', str(nw))
    flat = [bases[bi].cols[x][y] for y in range(h) for (bi, x) in out]
    layer.find('data').text = '\n   ' + base64.b64encode(struct.pack('<%dI' % len(flat), *flat)).decode() + '\n  '
    og = next(root.iter('objectgroup'))
    for o in list(og):
        og.remove(o)
    if og.get('width'):
        og.set('width', str(nw))
    for p in root.find('properties').findall('property'):
        if p.get('name') == 'pBackground':
            p.set('value', spec['bg'])
        elif p.get('name') == 'pMusic':
            p.set('value', 'svnz_bgm.ogg')

    # ---- runs of consecutive source columns carry their objects ----
    runs = []
    k = 0
    while k < nw:
        bi, x = out[k]
        j = k + 1
        while j < nw and out[j] == (bi, out[j - 1][1] + 1):
            j += 1
        runs.append((bi, x, x + (j - k), k))
        k = j
    if arena_at is not None:
        runs = [r for r in runs if not (arena_at <= r[3] < arena_at + ARENA)]

    kept, signs = [], []
    last_run = len(runs) - 1
    for ri, (bi, s, e, off) in enumerate(runs):
        for o in bases[bi].objs:
            ox = float(o.get('x'))
            ow = float(o.get('width') or 0)
            t = o.get('type')
            if not (s * TS <= ox < e * TS) or (ow and ox + ow > e * TS + 1 and t != 'Hero'):
                continue
            ending = any(p.get('value') == 'ENDING' for p in o.iter('property'))
            if t == 'Hero' and not (ri == 0 and s == 0 and bi == 0):
                continue
            if ending and ri != last_run:
                continue
            o = deepcopy(o)
            nx = ox + (off - s) * TS
            o.set('x', str(int(nx)) if nx == int(nx) else str(nx))
            if t == 'Information':
                signs.append(o)
                continue
            if t in ('PlatformInterp', 'PlatformLinear'):
                d = float(prop(o, 'pDuration') or 0)
                if d:
                    prop(o, 'pDuration', '%.1f' % (d * rnd.uniform(0.7, 1.3)))
            if t in spec['swap'] and rnd.random() < spec['swap'][t][1]:
                kind = spec['swap'][t][0]
                make_sv(o, rnd.choice(kind) if isinstance(kind, list) else kind)
            kept.append(o)

    signs.sort(key=lambda o: float(o.get('x')))
    if signs:
        s0 = signs[0]
        props = s0.find('properties')
        if props is not None:
            for p in list(props):
                if p.get('name') == 'pText':
                    props.remove(p)
        prop(s0, 'pText', spec['sign'])
        kept.append(s0)

    # ---- more SVNZ enemies on the new floors ----
    def hard(g):
        return b0.state.get(g) == 'pHard'

    def killing(c):
        return any(b0.state.get(g) == 'pKilling' for g in c)

    hero_x = next((float(o.get('x')) for o in kept if o.get('type') == 'Hero'), 0)
    taken = [float(o.get('x')) for o in kept if o.get('type', '').startswith('Sv') or o.get('type') in
             ('Enemy', 'Jumper', 'Jumper2', 'Android', 'Ultraton')]
    big = sum(1 for o in kept if o.get('type') == 'SvBigDemon')
    x = 24
    while x < nw - 20:
        x += rnd.randint(30, 50)
        if x >= nw - 20 or (arena_at is not None and arena_at - 6 <= x < arena_at + ARENA + 4):
            continue
        col = bases[out[x][0]].cols[out[x][1]]
        if killing(col) or abs(x * TS - hero_x) < 12 * TS or any(abs(x * TS - t) < 6 * TS for t in taken):
            continue
        # a floor = a hard tile with two free tiles above it; mostly the lowest one, sometimes the highest
        ys = [y for y in range(2, h) if hard(col[y]) and not hard(col[y - 1]) and not hard(col[y - 2])]
        if not ys:
            continue
        y = ys[-1] if rnd.random() < 0.6 else ys[0]
        kind = rnd.choice(spec['add'])
        if kind == 'SvBigDemon':
            if big >= 3:
                kind = 'SvNinja'
            big += 1
        o = ET.Element('object', name=kind, type=kind, x=str(x * TS),
                       y=str(y * TS - 32 - (110 if kind == 'SvBat' else 0)), width='32', height='32')
        make_sv(o, kind)
        kept.append(o)
        taken.append(x * TS)

    # ---- boss arena ----
    if arena_at is not None:
        ax0, ax1 = arena_at * TS, (arena_at + ARENA) * TS
        col = bases[out[arena_at][0]].cols[out[arena_at][1]]
        ys = [y for y in range(2, h) if hard(col[y]) and not hard(col[y - 1])]
        ground = ys[-1] * TS
        boss = spec['boss']
        d = ET.Element('object', name=boss, type=boss, x=str(ax0 + 17 * TS), y=str(ground - 32), width='32', height='32')
        for kk, v in (('pTeam', '1'), ('pRequiredItem', 'KEY'), ('pLookDir', '-1'), ('pArenaX0', str(ax0)),
                      ('pArenaX1', str(ax1))):
            prop(d, kk, v)
        door = ET.Element('object', name='Puerta', type='Door', x=str(ax1 + 2 * TS), y=str(ground - 128),
                          width='32', height='128')
        for kk, v in (('pAsset', 'GATE'), ('pIsKey', 'true'), ('pRequiredCount', '1'), ('pRequiredItem', 'KEY')):
            prop(door, kk, v)
        sv = ET.Element('object', name='Save', type='SavePoint', x=str(ax0 - 3 * TS), y=str(ground - 32),
                        width='32', height='32')
        kept = [o for o in kept if not (ax0 - 4 * TS <= float(o.get('x')) < ax1 + 4 * TS
                                        and o.get('type') not in ('Item', 'Cow'))]
        kept += [d, door, sv]

    for o in kept:
        og.append(o)
    os.makedirs(OUT, exist_ok=True)
    tree.write(os.path.join(OUT, 'extra%d.tmx' % (i + 1)), encoding='UTF-8', xml_declaration=True)
    counts = defaultdict(int)
    for o in kept:
        counts[o.get('type')] += 1
    print('extra%d' % (i + 1), 'bases', spec['bases'], 'size', nw, 'x', h, 'runs', len(runs), 'arena', arena_at,
          {k: v for k, v in sorted(counts.items()) if k.startswith('Sv') or k in ('Cow', 'Door', 'Hero')})


def preview(i):
    """Intro card strip (512x115) of extra level i: the screen at the hero's start, background + tiles."""
    from PIL import Image
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
    if os.path.isdir(OUT):
        for f in os.listdir(OUT):
            if f.endswith('.tmx'):
                os.remove(os.path.join(OUT, f))
    for i, spec in enumerate(LEVELS):
        build(i, spec)
    strip = Image.new('RGB', (512, 115 * len(LEVELS)))
    for i in range(len(LEVELS)):
        strip.paste(preview(i), (0, i * 115))
    strip.save(os.path.join(ROOT, 'public', 'assets', 'images', 'menuElements', 'preview_extra.jpg'), quality=90)


if __name__ == '__main__':
    main()
