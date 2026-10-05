"""For each object type compared in the Windows xa.exe Scenario::loadObjects, list the strings (wide and ASCII)
its branch references, in order: asset/anim names, property names and sounds. Shows what each type really uses
regardless of the defaults the TMX carries.

usage: python xre_types.py [Type ...]
"""
import re
import sys
sys.path.insert(0, __import__('os').path.dirname(__file__))
import xre  # noqa: E402

img, base = xre.img, xre.base

# every printable UTF-16 / ASCII string in the image, by VA
wstrs, astrs = {}, {}
for m in re.finditer(rb'(?:[\x20-\x7e]\x00){3,}\x00\x00', img):
    wstrs[base + m.start()] = m.group()[:-2].decode('utf-16-le')
for m in re.finditer(rb'[\x20-\x7e]{3,}\x00', img):
    astrs[base + m.start()] = m.group()[:-1].decode()

types = sys.argv[1:] or ['Enemy', 'Android', 'Ultraton', 'Bird', 'UFO', 'SmartUFO', 'Double', 'Bomb', 'Jumper',
                         'Jumper2', 'Thrower', 'Cannon', 'Down3', 'FloorCannon', 'PiranhaRobot', 'Boss', 'Stub',
                         'Guillotine']
insns = xre.all_insns()
idx = {ins.address: k for k, ins in enumerate(insns)}
type_addr = {v: k for k, v in astrs.items()}
imm = re.compile(r'0x[0-9a-f]+')


def strings_in(ins):
    out = []
    for h in imm.findall(ins.op_str):
        v = int(h, 16)
        if v in wstrs:
            out.append('L"' + wstrs[v] + '"')
        elif v in astrs:
            out.append('"' + astrs[v] + '"')
    return out


ALL_TYPES = ['Enemy', 'Android', 'Ultraton', 'Bird', 'UFO', 'SmartUFO', 'Double', 'Bomb', 'Jumper', 'Jumper2',
             'Thrower', 'Cannon', 'Down3', 'FloorCannon', 'PiranhaRobot', 'Boss', 'Stub', 'Guillotine', 'Cow', 'Item',
             'Door', 'SavePoint', 'Information', 'PlatformInterp', 'Hero']
all_type_vas = {type_addr[t] for t in ALL_TYPES if t in type_addr}
for t in types:
    if t not in type_addr:
        print(f'== {t}: no ASCII string')
        continue
    refs = xre.refs_to([type_addr[t]])
    print(f'== {t}: refs {[hex(r.address) for r in refs]}')
    for r in refs[:1]:
        k = idx[r.address]
        seen = []
        for ins in insns[k + 1:k + 1500]:
            hit = strings_in(ins)
            # stop at the next type comparison
            if any(int(h, 16) in all_type_vas for h in imm.findall(ins.op_str)):
                break
            seen += hit
        print('   ', ' '.join(seen[:60]))
