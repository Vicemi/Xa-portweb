"""Locate Scenario::loadObjects in the Windows xa.exe through the ASCII object-type names it compares against,
and list the small immediates stored near each type branch (candidates for InteractiveObject::setPoints).

usage: python xre_points.py [Type ...]
"""
import sys, re
sys.path.insert(0, __import__('os').path.dirname(__file__))
import xre  # noqa: E402

img, base = xre.img, xre.base


def find_ascii(s):
    out, i = [], 0
    pat = s.encode() + b'\x00'
    while True:
        i = img.find(pat, i)
        if i < 0:
            return out
        if img[i - 1:i] == b'\x00':
            out.append(base + i)
        i += 1


types = sys.argv[1:] or ['Enemy', 'Android', 'Ultraton', 'Bird', 'UFO', 'SmartUFO', 'Double', 'Bomb', 'Jumper', 'Jumper2',
                         'Thrower', 'Cannon', 'Down3', 'FloorCannon', 'PiranhaRobot', 'Boss', 'Cow', 'Guillotine', 'Stub']
insns = xre.all_insns()
idx = {ins.address: k for k, ins in enumerate(insns)}
for t in types:
    addrs = find_ascii(t)
    refs = xre.refs_to(addrs)
    print(f'== {t}: string {[hex(a) for a in addrs]} refs {[hex(r.address) for r in refs]}')
    for r in refs[:2]:
        k = idx[r.address]
        window = insns[k:k + 400]
        imms = []
        for ins in window:
            m = re.match(r'dword ptr \[(e\w\w) \+ (0x[0-9a-f]+)\], (0x[0-9a-f]+|\d+)$', ins.op_str)
            if ins.mnemonic == 'mov' and m:
                v = int(m.group(3), 0)
                if v in (10, 20, 25, 30, 50, 75, 100, 150, 200, 250, 300, 500, 1000, 2000, 5000):
                    imms.append(f'{ins.address:x}:[{m.group(1)}+{m.group(2)}]={v}')
        print('   ', ' '.join(imms[:12]))
