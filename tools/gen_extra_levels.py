"""Build the extra levels of map 2 (public/assets/data/extra/extraN.tmx) with the tiles of the original Xa levels
and the Super Vampire Ninja Zero enemies and bosses (tools/import_svnz.py).

The extra levels are new layouts, not copies of the originals:

1. Terrain. Two tile columns that are identical over the whole height are interchangeable, so a level is a walk
   over the terrain of one or two original levels with the same tileset: short stretches (6-16 columns) joined by
   jumps to identical twin columns elsewhere. Sections come out reordered, repeated or skipped and the seams are
   invisible. Boss levels get an arena (one plain floor column repeated) before the exit stretch.
2. Playability. The composed map is checked with a reachability search that follows Xa's own movement (single
   jump without the power-up: 3 tiles up / 4 across, falls, ladders, one-way floors and the moving platforms'
   paths). A layout where the exit can't be reached is thrown away and the next seed is tried.
3. Placement. Everything is placed again, from scratch, only on floors Xa can reach: checkpoints every ~100
   columns, rows and arcs of coins, cows (preferably off the main route), energy / life / double-jump items, the
   start sign, SVNZ enemies mixed with Xa enemies (copied from the originals with their settings) and flyers over
   open ground. Only the moving platforms keep their place (the terrain needs them), with a new speed.

All random choices are seeded, so the output is stable.

usage: python gen_extra_levels.py
"""
import base64
import os
import random
import struct
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from copy import deepcopy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'assets', 'data')
OUT = os.path.join(DATA, 'extra')
TS = 32
ARENA = 36

# walkers / flyers: enemy kinds placed on the floors ("xa:Type" copies an original Xa enemy of that type)
LEVELS = [
    # ---- tramo 1 ----
    dict(bases=[2, 1], length=300, bg='background_1.jpg',
         walkers=['SvNinja', 'SvNinja', 'SvRedNinja', 'xa:Enemy', 'xa:Jumper'], flyers=['SvBat', 'xa:Bird'],
         sign='\\!Cuidado Xa! Unos ninjas demonio\\nllegaron a la costa.'),
    dict(bases=[11], length=340, bg='svnz_arena.jpg',
         walkers=['SvNinja', 'SvRedNinja', 'SvRedNinja', 'xa:FloorCannon', 'xa:Enemy'], flyers=['SvBat', 'xa:SmartUFO'],
         sign='Los ninjas rojos saltan sobre vos.\\n\\!Disparales antes de que caigan!'),
    dict(bases=[8], length=300, bg='svnz_grid.jpg', boss='SvGoldNinja',
         walkers=['SvNinja', 'SvRedNinja', 'xa:Enemy', 'xa:Jumper'], flyers=['SvBat', 'xa:Bird', 'xa:Double'],
         sign='Un ninja dorado custodia la salida.\\n\\!Vencelo para conseguir la llave!'),
    # ---- tramo 2 ----
    dict(bases=[10], length=330, bg='svnz_dungeon.jpg',
         walkers=['SvNinja', 'SvRedNinja', 'SvBigDemon', 'xa:Jumper2', 'xa:Android'], flyers=['SvBat', 'xa:Bird'],
         sign='Un gran demonio anda suelto.\\nSu golpe hace temblar el suelo.'),
    dict(bases=[3], length=340, bg='background_3.jpg',
         walkers=['SvNinja', 'SvRedNinja', 'xa:Enemy', 'xa:Jumper'], flyers=['SvBat', 'SvBat', 'xa:Bird'],
         sign='Las vacas quedaron atrapadas\\nen los ba\\mados. \\!Rescatalas!'),
    dict(bases=[7], length=260, bg='svnz_dojo.jpg', boss='SvBigDemonBoss',
         walkers=['SvNinja', 'SvRedNinja', 'SvBigDemon', 'xa:Jumper2', 'xa:Ultraton'], flyers=['SvBat', 'xa:Double'],
         sign='El gran demonio te espera\\nal final del bosque.'),
    # ---- tramo 3 ----
    dict(bases=[9], length=340, bg='svnz_arena.jpg',
         walkers=['SvNinja', 'SvRedNinja', 'SvBigDemon', 'xa:FloorCannon', 'xa:Jumper2'], flyers=['SvBat'],
         sign='Las calles est\\an tomadas\\npor los vampiros.'),
    dict(bases=[1, 2], length=320, bg='background_2.jpg',
         walkers=['SvNinja', 'SvRedNinja', 'SvRedNinja', 'xa:Enemy', 'xa:Jumper'], flyers=['SvBat', 'xa:Bird'],
         sign='Los ninjas se esconden\\nentre los vi\\medos.'),
    dict(bases=[3], length=320, bg='svnz_grid.jpg', boss='SvLucy',
         walkers=['SvNinja', 'SvRedNinja', 'SvBigDemon', 'xa:Jumper'], flyers=['SvBat', 'xa:Double'],
         sign='Lucy, la hermana de Mina,\\nfue pose\\ida por Dr\\acula.'),
    # ---- tramo 4 ----
    dict(bases=[11], length=360, bg='background_11.jpg',
         walkers=['SvNinja', 'SvRedNinja', 'SvBigDemon', 'xa:FloorCannon'], flyers=['SvBat', 'xa:Bomb', 'xa:SmartUFO'],
         sign='En los muelles viejos\\nhay demonios por todos lados.'),
    dict(bases=[9], length=360, bg='background_9.jpg',
         walkers=['SvNinja', 'SvRedNinja', 'SvBigDemon', 'xa:FloorCannon', 'xa:Jumper2'], flyers=['SvBat'],
         sign='Dr\\acula est\\a muy cerca.\\n\\!Prep\\arate!'),
    dict(bases=[7], length=280, bg='svnz_dungeon.jpg', boss='SvDracula',
         walkers=['SvNinja', 'SvRedNinja', 'SvBigDemon', 'xa:Jumper2', 'xa:Ultraton'], flyers=['SvBat', 'SvBat'],
         sign='\\!El castillo de Dr\\acula!\\nVencelo para salvar al planeta.'),
]

# ---- Xa movement used by the reachability search (hero.ts: GRAVITY 1800, walk 250, VELOCITY_JUMP[0] = -600 →
# 100 px, VELOCITY_DOUBLE_JUMP[1] = -440 → +54 px). The originals are built around the double jump (its power-up
# comes early in every level), and every extra level gets it right after the start, so the search uses it.
JUMP_UP = 4                                       # tiles the double jump climbs (~154 px)
JUMP_ACROSS = {0: 7, 1: 7, 2: 6, 3: 5, 4: 4}      # tiles across for a climb of 0..4 tiles (~0.85 s in the air)


def is_ending(o):
    return any(p.get('value') == 'ENDING' for p in o.iter('property'))


def item_asset(o):
    for p in o.iter('property'):
        if p.get('name') == 'pAsset':
            return p.get('value')
    return None


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
                if p.get('value') == 'true' and p.get('name') != 'pInvisible':
                    self.state[int(t.get('id')) + first] = p.get('name')
        self.end_col = min([int(float(o.get('x')) // TS) for o in self.objs if is_ending(o)] or [self.w])


# ======================================================================================================== terrain
def walk(bases, length, rnd, boss):
    """New column order: a list of (base index, column), and where the boss arena starts."""
    twins = defaultdict(list)
    for bi, b in enumerate(bases):
        for x, c in enumerate(b.cols):
            if any(c):
                twins[c].append((bi, x))
    b0 = bases[0]
    end_col = b0.end_col
    out = []
    visits = defaultdict(int)
    arena_at = None

    def put(bi, x0, x1):
        for xx in range(x0, x1):
            out.append((bi, xx))
            visits[(bi, xx // 12)] += 1

    def jumps(bi, x, finishing):
        c = bases[bi].cols[x]
        cand = [(b2, y) for (b2, y) in twins[c] if (b2 != bi or abs(y - x) >= 10) and y < bases[b2].w - 2]
        if finishing:
            return [(b2, y) for (b2, y) in cand if b2 == 0 and b0.w * 0.6 <= y < end_col - 3]
        return [(b2, y) for (b2, y) in cand if y < (min(b0.w * 0.8, end_col - 12) if b2 == 0 else bases[b2].w * 0.7)]

    def arena_col(bb, k):
        # one plain ground column: a hard tile with at least 5 free tiles above, no spikes/ladders/one-way floors
        c = bb.cols[k]
        if any(bb.state.get(gg) in ('pKilling', 'pLadder', 'pLadderEnd', 'pPlatform') for gg in c):
            return False
        for y in range(5, bb.h):
            if bb.state.get(c[y]) == 'pHard':
                return all(bb.state.get(c[yy]) != 'pHard' for yy in range(y - 5, y))
        return False

    def add_arena(bb, bi, x, lo, hi, step):
        nonlocal arena_at
        for k in range(lo, hi, step):
            if arena_col(bb, k):
                put(bi, x, k + 1)
                arena_at = len(out)
                out.extend([(bi, k)] * ARENA)
                return k + 1
        return x

    bi, x = 0, 0
    finishing = False
    for _ in range(1500):
        b = bases[bi]
        if bi == 0 and finishing and b0.w * 0.6 <= x < end_col:
            put(0, x, b0.w)
            return out, arena_at
        lim = b.w - 1 if bi == 0 else int(b.w * 0.75)
        stop = min(lim, x + rnd.randint(6, 16))
        put(bi, x, stop)
        x = stop
        if len(out) >= length and not finishing:
            if boss and arena_at is None:
                x = add_arena(b, bi, x, x, b.w - 1, 1)
            finishing = True
        jumped = False
        for k in range(x, min(b.w - 1, x + 20)):
            cand = jumps(bi, k, finishing)
            if cand:
                put(bi, x, k + 1)
                cand.sort(key=lambda q: (visits[(q[0], q[1] // 12)], rnd.random()))
                bi, y = cand[0] if rnd.random() < 0.65 else rnd.choice(cand[:5])
                x = y + 1
                jumped = True
                break
        if jumped:
            continue
        nx = min(b.w - 1, x + 20)
        if bi == 0 and nx >= b0.w - 1:
            if boss and arena_at is None:
                x = add_arena(b0, 0, x, min(end_col, b0.w) - 3, x - 1, -1)
            put(0, x, b0.w)
            return out, arena_at
        if bi != 0 and nx >= b.w - 1:
            for k in range(x, b.w):
                back = [(b2, y) for (b2, y) in twins[b.cols[k]]
                        if (b2 == 0 and y < end_col - 12) or (b2 == bi and y < k - 15)]
                if back:
                    put(bi, x, k + 1)
                    bi, y = rnd.choice(back)
                    x = y + 1
                    break
            else:
                return None, None
            continue
        put(bi, x, nx)
        x = nx
    return None, None


# =================================================================================================== reachability
class Grid:
    """State of every tile of the composed map, plus the moving platforms' paths as virtual one-way floors."""

    def __init__(self, cols, state, h):
        self.w, self.h = len(cols), h
        self.s = [[state.get(cols[x][y]) for y in range(h)] for x in range(self.w)]
        self.virtual = set()
        self.blocked = set()       # cells closed by a door (tested with the door shut)

    def st(self, x, y):
        if x < 0 or x >= self.w or y < 0:
            return None
        if y >= self.h:
            return 'pKilling'           # falling off the bottom of the map
        return self.s[x][y]

    def free(self, x, y):
        return (x, y) not in self.blocked and self.st(x, y) not in ('pHard', 'pKilling')

    def floor(self, x, y):
        s = self.st(x, y)
        return s != 'pKilling' and (s in ('pHard', 'pPlatform', 'pLadderEnd') or (x, y) in self.virtual)

    def standable(self, x, y):
        """Xa (24x45, two tiles tall) stands on tile (x, y)."""
        return 0 <= x < self.w and 2 <= y < self.h and self.floor(x, y) and self.free(x, y - 1) and self.free(x, y - 2)

    def land(self, x, y0):
        """First floor at or below row y0 in column x that Xa would land on, or None (pit / spikes)."""
        if x < 0 or x >= self.w:
            return None
        for y in range(max(2, y0), self.h):
            if not self.free(x, y - 1):
                return None
            if self.floor(x, y):
                return y if self.standable(x, y) else None
        return None

    def clear(self, x, y0, y1):
        return all(self.free(x, y) for y in range(min(y0, y1), max(y0, y1) + 1))


def reachable(g, start):
    ladders = defaultdict(list)
    for x in range(g.w):
        y = 0
        while y < g.h:
            if g.st(x, y) in ('pLadder', 'pLadderEnd'):
                a = y
                while y < g.h and g.st(x, y) in ('pLadder', 'pLadderEnd'):
                    y += 1
                ladders[x].append((a, y))
            y += 1
    seen = {start}
    q = deque([start])
    while q:
        x, y = q.popleft()
        nxt = []
        for d in (-1, 1):
            # walk, or step off a ledge (falling straight or drifting up to 3 columns)
            if g.standable(x + d, y):
                nxt.append((x + d, y))
            elif g.free(x + d, y - 1) and g.free(x + d, y - 2):
                for k in range(1, 4):
                    cx = x + d * k
                    if not g.clear(cx, y - 2, y - 1):
                        break
                    ly = g.land(cx, y)
                    if ly is not None:
                        nxt.append((cx, ly))
            # jumps: up to 3 tiles up, further across when the landing is lower
            for up in range(-6, JUMP_UP + 1):
                across = JUMP_ACROSS.get(up, 7 + min(3, -up // 2))
                ty = y - up
                apex = min(y, ty) - 3 - (1 if up > 0 else 0)
                if not g.clear(x, apex, y - 1):
                    continue
                for k in range(1, across + 1):
                    cx = x + d * k
                    if not g.clear(cx, apex, min(y, ty) - 1):
                        break
                    if g.standable(cx, ty):
                        nxt.append((cx, ty))
        for lx0 in (x - 1, x, x + 1):
            for (a, b) in ladders.get(lx0, []):
                # a ladder joins every floor along it (its top and the floor under it included)
                if a - 1 <= y <= b + 1:
                    for lx in (lx0 - 1, lx0, lx0 + 1):
                        for ly in range(a, b + 2):
                            if g.standable(lx, ly):
                                nxt.append((lx, ly))
        for c in nxt:
            if c not in seen:
                seen.add(c)
                q.append(c)
    return seen


# ====================================================================================================== objects
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


def at(o, x, y):
    """Copy of `o` standing on floor tile (x, y)."""
    o = deepcopy(o)
    h = float(o.get('height') or 32)
    o.set('x', str(x * TS))
    o.set('y', str(int(y * TS - h)))
    return o


def sv(kind):
    o = ET.Element('object', name=kind, type=kind, x='0', y='0', width='32', height='32')
    prop(o, 'pTeam', '1')
    if kind == 'SvBat':
        prop(o, 'pxDelta', '70')
    return o


TEMPLATE_LEVELS = (1, 2, 3, 7, 8, 9, 10, 11)


def templates(bases):
    """Objects to copy: items, cows, checkpoints and every Xa enemy type (from the bases first)."""
    t = defaultdict(list)
    pool = list(bases) + [Base(n) for n in TEMPLATE_LEVELS if n not in [b.n for b in bases]]
    for b in pool:
        for o in b.objs:
            typ = o.get('type')
            if typ == 'Item':
                t['item:' + (item_asset(o) or '')].append(o)
            elif typ in ('Cow', 'SavePoint', 'Information', 'Hero'):
                t[typ].append(o)
            elif typ not in ('Door', 'PlatformInterp', 'PlatformLinear') and float(o.get('width') or 32) <= 64:
                t['xa:' + typ].append(o)
    return t


def build(i, spec):
    bases = [Base(n) for n in spec['bases']]
    b0 = bases[0]
    assert all(b.h == b0.h and b.tileset == b0.tileset for b in bases)
    tpl = templates(bases)
    for attempt in range(120):
        rnd = random.Random(3000 + i * 101 + attempt)
        out, arena_at = walk(bases, spec['length'], rnd, spec.get('boss'))
        if out is None:
            continue
        res = compose(i, spec, bases, out, arena_at, rnd, tpl)
        if res:
            print('extra%d' % (i + 1), 'bases', spec['bases'], 'try', attempt, res)
            return
    raise SystemExit('extra%d: no playable layout' % (i + 1))


def compose(i, spec, bases, out, arena_at, rnd, tpl):
    b0 = bases[0]
    nw, h = len(out), b0.h
    cols = [bases[bi].cols[x] for (bi, x) in out]

    # boss gate: on the last arena column, standing on the arena floor, with solid blocks from the top of the map
    # down to the top of the gate (like the gates of the original levels) so it can't be jumped over
    gate = None
    if arena_at is not None:
        gate_col = arena_at + ARENA - 1
        acol = cols[gate_col]
        ground = next(y for y in range(5, h) if b0.state.get(acol[y]) == 'pHard')
        fill = next((acol[y] for y in range(ground + 1, h) if b0.state.get(acol[y]) == 'pHard'), acol[ground])
        cols[gate_col] = tuple(fill if y < ground - 4 else acol[y] for y in range(h))
        gate = (gate_col, ground)
    g = Grid(cols, b0.state, h)

    # runs of consecutive source columns: moving platforms, the hero and the exit travel with them
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
    platforms, hero, ending = [], None, None
    for ri, (bi, s, e, off) in enumerate(runs):
        for o in bases[bi].objs:
            ox, ow = float(o.get('x')), float(o.get('width') or 0)
            t = o.get('type')
            if not (s * TS <= ox < e * TS):
                continue
            nx = ox + (off - s) * TS
            if t == 'Hero' and ri == 0 and bi == 0 and s == 0:
                hero = deepcopy(o)
                hero.set('x', str(nx))
            elif is_ending(o) and ri == len(runs) - 1:
                ending = deepcopy(o)
                ending.set('x', str(int(nx)))
            elif t in ('PlatformInterp', 'PlatformLinear') and ox + ow <= e * TS + 1:
                p = deepcopy(o)
                p.set('x', str(int(nx)))
                d = float(prop(p, 'pDuration') or 0)
                if d:
                    prop(p, 'pDuration', '%.1f' % (d * rnd.uniform(0.75, 1.25)))
                platforms.append(p)
    if hero is None or ending is None:
        return None

    # moving platforms: their whole path is a one-way floor for the search
    for p in platforms:
        px, py, pw = float(p.get('x')), float(p.get('y')), float(p.get('width') or 64)
        dx, dy = float(prop(p, 'pxDest') or 0), float(prop(p, 'pyDest') or 0)
        for step in range(0, 21):
            t = step / 20
            row = int((py + dy * t) // TS)
            for cx in range(int((px + dx * t) // TS), int((px + dx * t + pw - 1) // TS) + 1):
                if 0 <= cx < nw and 0 <= row < h and g.free(cx, row):
                    g.virtual.add((cx, row))

    # start cell, then everything Xa can reach
    hx = int((float(hero.get('x')) + 12) // TS)
    sy = g.land(hx, int(float(hero.get('y')) // TS))
    if sy is None:
        return None
    reach = reachable(g, (hx, sy))
    ex = int(float(ending.get('x')) // TS)
    ey = int(float(ending.get('y')) // TS)
    eh = int(float(ending.get('height') or 32) // TS)
    if not any((cx, cy) in reach for cx in range(ex - 1, ex + 2) for cy in range(ey, ey + eh + 3)):
        return None
    if arena_at is not None and not any((arena_at + 10, y) in reach for y in range(h)):
        return None
    if gate:
        # with the gate shut the exit must be out of reach: the boss's key is the only way through
        gx, gy = gate
        g.blocked = {(gx, y) for y in range(gy - 4, gy)}
        shut = reachable(g, (hx, sy))
        g.blocked = set()
        if any((cx, cy) in shut for cx in range(ex - 1, ex + 2) for cy in range(ey, ey + eh + 3)):
            return None

    floors = sorted(reach)
    by_col = defaultdict(list)
    for (x, y) in floors:
        by_col[x].append(y)
    route = {x: max(ys) for x, ys in by_col.items()}   # main route: the lowest reachable floor of each column
    taken = set()

    def free_spot(x, y, r=1):
        return all((xx, y) not in taken for xx in range(x - r, x + r + 1))

    def flat(x, y, n=1):
        return all((xx, y) in reach for xx in range(x - n, x + n + 1))

    no_go = set(range(0, 8))
    if arena_at is not None:
        no_go |= set(range(arena_at - 5, arena_at + ARENA + 5))

    objs = [hero, ending]
    taken.update({(hx, sy), (ex, ey)})

    # ---- start sign ----
    sign = deepcopy(tpl['Information'][0])
    props = sign.find('properties')
    if props is not None:
        for p in list(props):
            if p.get('name') == 'pText':
                props.remove(p)
    prop(sign, 'pText', spec['sign'])
    sx = hx + 3 if (hx + 3, sy) in reach else hx + 1
    objs.append(at(sign, sx, sy))
    taken.add((sx, sy))

    # ---- checkpoints every ~100 columns ----
    nxt = 100
    for x in sorted(route):
        if nxt <= x < nw - 30 and x not in no_go and flat(x, route[x]):
            objs.append(at(tpl['SavePoint'][0], x, route[x]))
            taken.add((x, route[x]))
            nxt = x + 100

    # ---- coins: rows on floors and small arcs, about 45 ----
    coin = tpl['item:COIN'][0]
    coins = 0
    x = 10
    while x < nw - 12 and coins < 48:
        x += rnd.randint(9, 16)
        ys = by_col.get(x)
        if not ys or x in no_go:
            continue
        y = rnd.choice(ys)
        n = rnd.randint(3, 5)
        if all((x + k, y) in reach for k in range(n)):
            arc = rnd.random() < 0.35
            for k in range(n):
                lift = 1 if arc and 0 < k < n - 1 else 0
                objs.append(at(coin, x + k, y - lift))
                taken.add((x + k, y))
                coins += 1

    # ---- cows: 4-6, preferably on floors off the main route ----
    side = [(x, y) for (x, y) in floors if y < route.get(x, y) and x not in no_go and 12 < x < nw - 12]
    main = [(x, y) for (x, y) in floors if x not in no_go and 12 < x < nw - 12]
    rnd.shuffle(side)
    rnd.shuffle(main)
    want = rnd.randint(4, 6)
    cows = []
    for (x, y) in side + main:
        if len(cows) >= want:
            break
        if all(abs(x - cx) > 40 for cx, _ in cows) and free_spot(x, y):
            cows.append((x, y))
    for (x, y) in cows:
        objs.append(at(tpl['Cow'][0], x, y))
        taken.add((x, y))

    # ---- power-ups: double jump early, energy and a life later ----
    def put_item(asset, lo, hi):
        tl = tpl.get('item:' + asset)
        if not tl:
            return
        cand = [(x, y) for (x, y) in floors if lo <= x < hi and x not in no_go and free_spot(x, y)]
        if cand:
            x, y = rnd.choice(cand)
            objs.append(at(tl[0], x, y - 1))
            taken.add((x, y))
    # the double jump the layout was checked with: on the route, right after the start
    dj = tpl.get('item:ENERGY_DOUBLE_JUMP')
    if dj:
        for x in range(hx + 5, hx + 30):
            if x in route and free_spot(x, route[x]):
                objs.append(at(dj[0], x, route[x] - 1))
                taken.add((x, route[x]))
                break
    put_item('ENERGY', nw // 3, nw // 2)
    put_item('ENERGY', 2 * nw // 3, nw - 20)
    put_item('LIVES', nw // 2, 3 * nw // 4)

    # ---- enemies: walkers on reachable floors, flyers over open ground ----
    big = 0
    slot = 16
    while slot < nw - 10:
        slot += rnd.randint(10, 18)
        # a few tries per slot: a column of it with a reachable floor wide enough
        spot = None
        for _ in range(6):
            x = slot + rnd.randint(-4, 4)
            if x in no_go or not 8 < x < nw - 6 or not by_col.get(x):
                continue
            y = rnd.choice(by_col[x])
            if flat(x, y, 1) and free_spot(x, y, 2):
                spot = (x, y)
                break
        if not spot:
            continue
        x, y = spot
        if rnd.random() < 0.25 and spec['flyers']:
            kind = rnd.choice(spec['flyers'])
            if not g.clear(x, y - 6, y - 1):
                continue
            o = sv(kind) if kind.startswith('Sv') or not tpl.get(kind) else deepcopy(rnd.choice(tpl[kind]))
            objs.append(at(o, x, y - 4))
            continue
        kind = rnd.choice(spec['walkers'])
        if kind == 'SvBigDemon':
            if big >= 3 or not g.clear(x, y - 4, y - 1):
                kind = 'SvNinja'
            else:
                big += 1
        if kind.startswith('xa:') and not tpl.get(kind):
            kind = 'SvNinja'
        o = sv(kind) if kind.startswith('Sv') else deepcopy(rnd.choice(tpl[kind]))
        objs.append(at(o, x, y))
        taken.add((x, y))

    # ---- boss arena ----
    if arena_at is not None:
        ax0, ax1 = arena_at * TS, (arena_at + ARENA) * TS
        ground = max(by_col.get(arena_at + 10, [h - 1]))
        boss = sv(spec['boss'])
        for kk, v in (('pRequiredItem', 'KEY'), ('pLookDir', '-1'), ('pArenaX0', str(ax0)), ('pArenaX1', str(ax1))):
            prop(boss, kk, v)
        objs.append(at(boss, arena_at + 17, ground))
        gx, gy = gate
        door = ET.Element('object', name='Puerta', type='Door', x=str(gx * TS), y=str(gy * TS - 128),
                          width='32', height='128')
        for kk, v in (('pAsset', 'GATE'), ('pIsKey', 'true'), ('pRequiredCount', '1'), ('pRequiredItem', 'KEY')):
            prop(door, kk, v)
        objs.append(door)
        objs.append(at(tpl['SavePoint'][0], arena_at - 3, max(by_col.get(arena_at - 3, [ground]))))

    write(i, spec, b0, cols, h, platforms + objs)
    counts = defaultdict(int)
    for o in platforms + objs:
        counts[o.get('type')] += 1
    return dict(size='%dx%d' % (nw, h), runs=len(runs), arena=arena_at, reach=len(reach), coins=coins,
                **{k: v for k, v in sorted(counts.items()) if k != 'Item'})


def write(i, spec, b0, cols, h, objs):
    nw = len(cols)
    tree = deepcopy(b0.tree)
    root = tree.getroot()
    root.set('width', str(nw))
    layer = root.find('layer')
    layer.set('width', str(nw))
    flat = [cols[x][y] for y in range(h) for x in range(nw)]
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
    for o in objs:
        og.append(o)
    os.makedirs(OUT, exist_ok=True)
    tree.write(os.path.join(OUT, 'extra%d.tmx' % (i + 1)), encoding='UTF-8', xml_declaration=True)


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
            gg = gids[ty * w + tx] & 0x1fffffff
            if not gg:
                continue
            idx = gg - first
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
