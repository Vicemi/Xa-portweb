"""Import the characters, backgrounds, music and sounds of Super Vampire Ninja Zero (Batoví Games Studio, 2009)
from the user's own install into the port, for the extra levels of map 2.

  - characters: FighterFactory sheets (<Char>.png + <Char>.xml frame rects + <Char>.fgt axes/anims/hit boxes)
    -> public/assets/svnz/characters/<char>.png (+ <char>_R.png, the red hit-flash copy the Xa enemies use)
    -> src/xa/data/svnz.json  {maps, anims} in the same format as sprites.json
  - backgrounds: the 480x272 stages scaled to the 384 px Xa view and mirrored out to the 1024x512 parallax size
  - music / sounds: copied as-is (ogg)

usage: python import_svnz.py [F:/Games/SuperVampireNinjaZero]
"""
import json
import os
import re
import shutil
import sys

from PIL import Image, ImageOps

SRC = sys.argv[1] if len(sys.argv) > 1 else r'F:/Games/SuperVampireNinjaZero'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public', 'assets')
CHAR_DIR = os.path.join(PUB, 'svnz', 'characters')

# key used in the port -> folder / file stem in the SVNZ install
CHARS = {
    'NINJA': ('demonNinja', 'DemonNinja'),
    'RED_NINJA': ('genericNinja', 'GenericNinja'),
    'BAT': ('bat', 'Bat'),
    'BIG_DEMON': ('bigDemon', 'BigDemon'),
    'DRACULA': ('dracula', 'Dracula'),
}
# FighterFactory anim ids that the port uses, by name
ANIM_NAMES = {
    0: 'STAND', 10: 'WALK', 20: 'JUMP', 500: 'TIRED', 1000: 'ATTACK', 1500: 'AIR_ATTACK', 1505: 'AIR_ATTACK_LOOP',
    1510: 'LAND', 2000: 'CAST', 3010: 'CAPE_WRAP', 3020: 'CAPE_BATS', 3040: 'VANISH', 3050: 'CAPE_FLY',
    3060: 'CAPE_SPIN', 5000: 'HIT', 5010: 'HIT_IN', 5100: 'FALL', 5150: 'FALL_DEAD', 5160: 'LIE', 5500: 'DEATH',
}


def red(im):
    """Red hit-flash copy, like the *_red sheets of Xa (same alpha, colours pushed to red)."""
    r, g, b, a = im.split()
    r = r.point(lambda v: min(255, 150 + v * 0.6))
    g = g.point(lambda v: v * 0.35)
    b = b.point(lambda v: v * 0.35)
    return Image.merge('RGBA', (r, g, b, a))


def import_char(key, folder, stem, maps, anims):
    base = os.path.join(SRC, 'assets', 'images', 'characters', folder)
    sheet = Image.open(os.path.join(base, stem + '.png')).convert('RGBA')
    name = key.lower()
    os.makedirs(CHAR_DIR, exist_ok=True)
    sheet.save(os.path.join(CHAR_DIR, name + '.png'))
    red(sheet).save(os.path.join(CHAR_DIR, name + '_R.png'))
    path = 'assets/svnz/characters/%s.png' % name

    rects = {}
    for m in re.finditer(r'<frame [^>]*name="[^"#]*#(\d+)_(\d+)\.png" w="(\d+)" h="(\d+)" x="(\d+)" y="(\d+)"',
                         open(os.path.join(base, stem + '.xml'), encoding='latin1').read()):
        g, i, w, h, x, y = map(int, m.groups())
        rects[(g, i)] = (x, y, w, h)

    axes = {}
    frames, blue, redr = [], None, None
    for line in open(os.path.join(base, stem + '.fgt'), encoding='latin1'):
        line = line.strip()
        if not line or line.startswith(';'):
            continue
        cmd, _, args = line.partition(':')
        a = [s.strip() for s in args.split(',')]
        if cmd == 'addImage':
            axes[(int(a[0]), int(a[1]))] = (float(a[2]), float(a[3]))
        elif cmd == 'addBlueRect':
            if blue is None:
                blue = [int(v) for v in a[:4]]
        elif cmd == 'addRedRect':
            redr = [int(v) for v in a[:4]]
        elif cmd == 'addFrame':
            g, i, ox, oy, t = int(a[0]), int(a[1]), int(a[2]), int(a[3]), int(a[4])
            frames.append({'g': g, 'i': i, 'ox': ox, 'oy': oy, 'd': max(1, t), 'hit': redr, 'body': blue})
            blue = redr = None
        elif cmd == 'addAnim':
            aid, loop = int(a[0]), int(a[1])
            out = []
            for f in frames:
                if (f['g'], f['i']) not in rects:
                    continue
                mk = 'SV_%s_%d_%d' % (key, f['g'], f['i'])
                if f['ox'] or f['oy']:
                    mk += '_%d_%d' % (f['ox'], f['oy'])
                x, y, w, h = rects[(f['g'], f['i'])]
                ax, ay = axes.get((f['g'], f['i']), (w / 2, h))
                for suffix, p in (('', path), ('_R', path.replace('.png', '_R.png'))):
                    maps[mk + suffix] = {'path': p, 'type': 3, 'rect': [x, y, w, h],
                                         'anchor': [ax - f['ox'], ay - f['oy']]}
                out.append({'map': mk, 'i': 0, 'd': f['d'], 'hit': f['hit'], 'body': f['body']})
            if out:
                an = 'SV_%s_%s' % (key, ANIM_NAMES.get(aid, str(aid)))
                for suffix in ('', '_R'):
                    anims[an + suffix] = {'name': an + suffix, 'loop': 1 if loop > 0 else 0, 'base': 60,
                                          'frames': [dict(fr, map=fr['map'] + suffix) for fr in out]}
            frames = []


def import_bg(src, dst):
    """480x272 stage -> 1024x512 Xa parallax background: scaled to 384 px high, mirrored to 1024 px wide."""
    im = Image.open(os.path.join(SRC, 'assets', 'images', src)).convert('RGB').crop((0, 0, 480, 272))
    h = 384
    w = round(480 * h / 272)
    im = im.resize((w, h), Image.LANCZOS)
    wide = Image.new('RGB', (w * 2, h))
    wide.paste(im, (0, 0))
    wide.paste(ImageOps.mirror(im), (w, 0))
    out = Image.new('RGB', (1024, 512))
    out.paste(wide.crop((0, 0, 1024, h)), (0, 0))
    out.paste(wide.crop((0, h - 1, 1024, h)).resize((1024, 512 - h)), (0, h))
    out.save(os.path.join(PUB, 'images', 'background', dst), quality=92)


def main():
    maps, anims = {}, {}
    for key, (folder, stem) in CHARS.items():
        import_char(key, folder, stem, maps, anims)
    json.dump({'maps': maps, 'anims': anims}, open(os.path.join(ROOT, 'src', 'xa', 'data', 'svnz.json'), 'w'),
              separators=(',', ':'))

    import_bg('bg/arena.png', 'svnz_arena.jpg')
    import_bg('bg/dojo.png', 'svnz_dojo.jpg')
    import_bg('bg/practice.png', 'svnz_grid.jpg')
    tr = Image.open(os.path.join(SRC, 'assets', 'images', 'bg', 'trainingBg.png')).convert('RGB')
    tr = tr.resize((384, 384), Image.LANCZOS)
    room = Image.new('RGB', (1024, 512))
    for k in range(3):
        room.paste(tr if k % 2 == 0 else ImageOps.mirror(tr), (k * 384, 0))
    room.paste(room.crop((0, 383, 1024, 384)).resize((1024, 128)), (0, 384))
    room.save(os.path.join(PUB, 'images', 'background', 'svnz_dungeon.jpg'), quality=92)

    music = os.path.join(PUB, 'audio', 'music', 'win')
    shutil.copy(os.path.join(SRC, 'assets', 'audio', 'music', 'bgm.ogg'), os.path.join(music, 'svnz_bgm.ogg'))
    shutil.copy(os.path.join(SRC, 'assets', 'audio', 'music', 'boss.ogg'), os.path.join(music, 'svnz_boss.ogg'))
    fx = os.path.join(PUB, 'audio', 'fx', 'win')
    for f in ('action', 'fall', 'jump', 'special', 'strongCut', 'strongHit', 'weakCut', 'weakHit'):
        shutil.copy(os.path.join(SRC, 'assets', 'audio', 'fx', 'fight', f + '.ogg'), os.path.join(fx, 'svnz_' + f + '.ogg'))
    shutil.copy(os.path.join(SRC, 'assets', 'audio', 'fx', 'fight', 'voices', 'demonNinja', 'damage1.ogg'),
                os.path.join(fx, 'svnz_demon_hurt.ogg'))
    print('maps', len(maps), 'anims', len(anims))


if __name__ == '__main__':
    main()
