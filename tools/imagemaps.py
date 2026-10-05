"""Extract bat::ImageMapDesc definitions (how each sprite sheet is cut into frames) from the
Ghidra-decompiled Assets* constructors.

Desc layout (offsets relative to the desc local, e.g. local_1bc):
  -0x08 path (wstring)      -0x0c type  (1 = strip from rect, cols x rows; 2 = grid; 3 = single rect;
  -0x18 rect.x              4 = explicit rect list)
  -0x1c rect.y   -0x20 rect.w   -0x24 rect.h
  -0x28 cols     -0x2c rows     -0x30 count    -0x34 anchor mode (0 = frame centre, 1 = explicit)
  -0x38 anchor.x   -0x3c anchor.y
usage: python imagemaps.py <Assets*.c> ... > imagemaps.json
"""
import re, sys, json, struct
sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from anims import STMT_RE, parse_block, lit, local_off  # noqa: E402


class Interp:
    def __init__(self):
        self.vars, self.str_locals = {}, {}
        self.last_str = None
        self.last_path = None
        self.rects = []
        self.maps = {}
        self.order = []

    def val(self, tok):
        v = lit(tok)
        return v if v is not None else self.vars.get(tok.strip())

    def run(self, nodes):
        for n in nodes:
            if n[0] == 'loop':
                _, var, end, sub = n
                if var is None:
                    self.run(sub)
                    continue
                op, endtok = end
                endv, guard = self.val(endtok), 0
                while True:
                    self.run(sub)
                    guard += 1
                    cur = self.vars.get(var)
                    if (cur == endv if op == '!=' else (cur is None or cur >= endv)) or guard > 300:
                        break
            else:
                self.stmt(n[1])

    def stmt(self, s):
        s = ' '.join(s.split())
        # ImageMapDesc::setDefault resets every field of the desc (the decompiler reuses the same locals for
        # consecutive descs, so stale anchors/rects must not leak into the next one): type 1, rect 0, cols/rows/
        # count 0, anchor mode 0 (= centre of the frame, bat::Image::Image) and anchor (0,0)
        dm = re.search(r'ImageMapDesc::setDefault\(\(ImageMapDesc \*\)&?(local_[0-9a-f]+)\)', s)
        if dm:
            b = local_off(dm.group(1))
            for off, v in ((0xc, 1), (0x18, 0), (0x1c, 0), (0x20, 0), (0x24, 0), (0x28, 0), (0x2c, 0), (0x30, 0),
                           (0x34, 0), (0x38, 0), (0x3c, 0)):
                self.vars['local_%x' % (b - off)] = v
            return
        for m in re.finditer(r'L"([^"]*)"', s):
            self.last_str = m.group(1)
            if m.group(1).startswith('assets/'):
                self.last_path = m.group(1)
                lm = re.search(r'wstring\s*\(\(wstring_conflict \*\)&?(local_[0-9a-f]+),L"', s)
                if lm:
                    self.str_locals[lm.group(1)] = m.group(1)
        am = re.search(r'wstring::assign\(\(wstring_conflict \*\)&?(local_[0-9a-f]+)\);?$', s)
        if am:
            self.pending_assign = am.group(1)
        m = re.match(r'^(local_[0-9a-f]+|uVar\d+|iVar\d+) = (.+);$', s)
        if m and 'add<' not in m.group(2):
            m2 = re.fullmatch(r'((?:uVar|local_|iVar)\w+) ([+-]) (0x[0-9a-f]+|\d+)', m.group(2))
            if m2:
                step = int(m2.group(3), 0) * (1 if m2.group(2) == '+' else -1)
                self.vars[m.group(1)] = (self.vars.get(m2.group(1)) or 0) + step
            else:
                v = self.val(m.group(2))
                if v is not None:
                    self.vars[m.group(1)] = v
            return
        rm = re.search(r'BatRect::BatRect\(\(?\w*[ *]*\)?&?local_[0-9a-f]+,(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)', s)
        if rm:
            self.rects.append([float(x) for x in rm.groups()])
            return
        if 'add<bat::ImageMapDesc>' in s:
            dm = re.search(r'\(ImageMapDesc \*\)&?(local_[0-9a-f]+)', s)
            b = local_off(dm.group(1))
            g = lambda off: self.vars.get('local_%x' % (b - off))
            name = self.last_str
            d = {'name': name, 'path': self.last_path, 'type': g(0xc),
                 'rect': [g(0x18), g(0x1c), g(0x20), g(0x24)], 'cols': g(0x28), 'rows': g(0x2c),
                 'count': g(0x30), 'anchorMode': g(0x34), 'anchor': [g(0x38), g(0x3c)]}
            if d['type'] == 4:
                d['rects'] = self.rects[-int(d['count'] or 0):] if d['count'] else list(self.rects)
            self.rects = []
            self.maps[name] = d
            self.order.append(name)


def extract(path):
    text = open(path, encoding='utf-8', errors='replace').read()
    for part in re.split(r'(?m)^// ===== ', text):
        head = part.split('\n', 1)[0]
        if '::' not in head:
            continue
        cls, fn = head.split(' @ ')[0].rsplit('::', 1)
        if cls.split('::')[-1] != fn:
            continue
        body = part.split('\n', 1)[1]
        body = re.sub(r'/\*.*?\*/', ' ', body, flags=re.S)
        body = re.sub(r'(?m)//.*$', ' ', body)
        stmts = []
        for m in STMT_RE.finditer(body):
            t = m.group(0)
            if t.startswith('do'):
                stmts.append(('do', None))
            elif t.lstrip().startswith('}') and m.group(1) is not None:
                c = re.fullmatch(r'\s*(\w+)\s*(!=|<)\s*(\S+)\s*', m.group(1))
                stmts.append(('while', (c.group(1), (c.group(2), c.group(3))) if c else (None, None)))
            else:
                stmts.append(('s', t))
        nodes, _ = parse_block(stmts, 0)
        it = Interp()
        it.run(nodes)
        if it.maps:
            return {k: it.maps[k] for k in it.order}
    return {}


if __name__ == '__main__':
    res = {}
    for p in sys.argv[1:]:
        cls = p.replace('\\', '/').rsplit('/', 1)[-1][:-2]
        res[cls] = extract(p)
    json.dump(res, sys.stdout, indent=1)
