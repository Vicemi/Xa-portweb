"""Extract bat::AnimType definitions (name, loop, frames[image map, index, duration]) from a
Ghidra-decompiled Assets*Animations constructor by interpreting the relevant statements.

usage: python anims.py <file.c> [<file.c> ...] > anims.json
"""
import re, sys, json, struct

STMT_RE = re.compile(r'\bdo\s*\{|\}\s*while\s*\(([^;]*)\);|[^;{}]*;', re.S)


def lit(s):
    s = s.strip().rstrip(';').strip()
    if re.fullmatch(r'-?0x[0-9a-fA-F]+', s):
        v = int(s, 16)
        if v >= 0x3c000000 and v < 0x50000000:  # float bit pattern
            return struct.unpack('<f', struct.pack('<I', v))[0]
        return v
    if re.fullmatch(r'-?\d+', s):
        return int(s)
    if re.fullmatch(r'-?\d+\.\d*', s):
        return float(s)
    return None


def local_off(name):
    m = re.fullmatch(r'local_([0-9a-f]+)', name)
    return int(m.group(1), 16) if m else None


def parse_block(stmts, i, end_token=None):
    """Return list of nodes until matching '}' while, plus index."""
    body = []
    while i < len(stmts):
        kind, data = stmts[i]
        if kind == 'do':
            sub, i = parse_block(stmts, i + 1, 'while')
            loop_var, loop_end = stmts[i][1] if i < len(stmts) else (None, None)
            body.append(('loop', loop_var, loop_end, sub))
            i += 1
            continue
        if kind == 'while':
            return body, i
        body.append(('stmt', data))
        i += 1
    return body, i


class Interp:
    def __init__(self):
        self.vars = {}
        self.last_str = None
        self.anims = {}          # name -> dict
        self.order = []
        self.slot_main = None    # anim stored at this+0x24
        self.pAVar = {}          # pAVarN -> anim name
        self.pending_img = {}    # desc local -> (map, index)
        self.pending_add = None

    def val(self, tok):
        tok = tok.strip()
        v = lit(tok)
        if v is not None:
            return v
        return self.vars.get(tok)

    def run(self, nodes):
        for n in nodes:
            if n[0] == 'loop':
                _, var, end, sub = n
                if var is None:
                    self.run(sub); continue
                op, endtok = end
                endv = self.val(endtok)
                guard = 0
                while True:
                    self.run(sub)
                    guard += 1
                    cur = self.vars.get(var)
                    done = (cur == endv) if op == '!=' else (cur is None or cur >= endv)
                    if done or guard > 500:
                        break
            else:
                self.stmt(n[1])

    def stmt(self, s):
        s = ' '.join(s.split())
        for m in re.finditer(r'L"([^"]*)"', s):
            self.last_str = m.group(1)
        m = re.match(r'^(local_[0-9a-f]+|uVar\d+|iVar\d+) = (.+);$', s)
        if m and 'getpImage' not in m.group(2) and 'add<' not in m.group(2):
            rhs = m.group(2)
            m2 = re.fullmatch(r'((?:uVar|local_)\w+) ([+-]) (0x[0-9a-f]+|\d+)', rhs)
            if m2:
                step = int(m2.group(3), 0) * (1 if m2.group(2) == '+' else -1)
                self.vars[m.group(1)] = (self.vars.get(m2.group(1)) or 0) + step
            else:
                v = self.val(rhs)
                if v is not None:
                    self.vars[m.group(1)] = v
            return
        if 'add<bat::AnimTypeDesc>' in s:
            dm = re.search(r'\(AnimTypeDesc \*\)&?(local_[0-9a-f]+)', s)
            nm = re.search(r'\(wstring_conflict \*\)&?(local_[0-9a-f]+)', s)
            name = self.last_str
            desc = local_off(dm.group(1)) if dm else None
            loop = self.vars.get('local_%x' % (desc - 8)) if desc is not None else None
            fps = self.vars.get('local_%x' % (desc - 4)) if desc is not None else None
            a = {'name': name, 'loop': loop, 'base': fps, 'frames': []}
            self.anims[name] = a
            self.order.append(name)
            lhs = re.match(r'^(pAVar\d+) = ', s)
            if lhs:
                self.pAVar[lhs.group(1)] = name
            return
        m = re.match(r'^\*\(AnimType \*\*\)\(this \+ 0x24\) = (pAVar\d+);', s)
        if m:
            self.slot_main = self.pAVar.get(m.group(1))
            return
        if 'getpImage' in s:
            lhs = re.match(r'^(local_[0-9a-f]+) = ', s)
            am = re.search(r'getpImage\s*\((.*)\);?$', s)
            if not am:
                return
            args = am.group(1).split(',')
            idx = self.val(args[-1].strip().rstrip(')'))
            if lhs:
                self.pending_img[lhs.group(1)] = (self.last_str, idx)
            return
        if 'addFrame' in s:
            m = re.search(r'addFrame\((.*?),\(AnimTypeFrameDesc \*\)&(local_[0-9a-f]+)\)', s)
            if not m:
                return
            target, desc = m.group(1), m.group(2)
            if 'this + 0x24' in target:
                name = self.slot_main
            else:
                name = self.pAVar.get(target.strip())
            img = self.pending_img.get(desc)
            dur = self.vars.get('local_%x' % (local_off(desc) - 0x24))
            if name and name in self.anims and img:
                self.anims[name]['frames'].append({'map': img[0], 'i': img[1], 'd': dur})


def extract(path):
    text = open(path, encoding='utf-8', errors='replace').read()
    out = {}
    for fm in re.finditer(r'// ===== (\S+::\S+) @ [0-9a-f]+ =====', text):
        pass
    # only constructors
    parts = re.split(r'(?m)^// ===== ', text)
    for part in parts:
        head = part.split('\n', 1)[0]
        if '::' not in head:
            continue
        cls, fn = head.split(' @ ')[0].rsplit('::', 1)
        if cls.split('::')[-1] != fn:
            continue
        stmts = []
        body = part.split('\n', 1)[1]
        body = re.sub(r'/\*.*?\*/', ' ', body, flags=re.S)
        body = re.sub(r'(?m)//.*$', ' ', body)
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
        if it.anims:
            for k in it.order:
                out[k] = it.anims[k]
            break  # first constructor copy is enough
    return out


if __name__ == '__main__':
    res = {}
    for p in sys.argv[1:]:
        res.update(extract(p))
    json.dump(res, sys.stdout, indent=1)
