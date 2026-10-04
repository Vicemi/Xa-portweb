"""Evaluate the decompiled Lang::getLetterWidth(wchar_t) for every glyph of the game's font alphabet.
The function is a tree of `if (param_1 <op> L'c')`, `return (longdouble)N;` and gotos, so a tiny
interpreter over that C subset gives the exact per-glyph advance widths.

usage: python letterwidth.py > ../src/xa/data/font.json
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'research', 'decompiled', 'by_class', 'Lang.c')

# Alphabet rebuilt from the immediate word stores in xa.exe's Lang::initFontManager (0x44ce00..0x44d1e3).
ALPHABET = ('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
            "();,.:+-&~'!/?% ÀÁÄÇÉÑÓÚÜßàáâäç"
            'èéêìîïñóôöùúûü–´“”'
            '„…¡¿$"_ÂÈÊËÌÍÎÏÒÔÖÙÛ'
            'ëíò@[]')

TOK = re.compile(r"\s*(L'(?:\\x[0-9a-fA-F]+|\\.|[^'])'|longdouble|[A-Za-z_]\w*|-?\d+\.\d+|-?\d+|==|!=|<=|>=|&&|\|\||[(){};:<>!])")


def tokenize(s):
    out, i = [], 0
    while i < len(s):
        m = TOK.match(s, i)
        if not m:
            i += 1
            continue
        out.append(m.group(1))
        i = m.end()
    return out


def charval(t):
    c = t[2:-1]
    if c.startswith('\\x'):
        return int(c[2:], 16)
    if c.startswith('\\'):
        c = bytes(c, 'utf-8').decode('unicode_escape')
    return ord(c)


class Parser:
    def __init__(self, toks):
        self.t, self.i = toks, 0
        self.labels = {}

    def peek(self, k=0):
        return self.t[self.i + k] if self.i + k < len(self.t) else None

    def eat(self, x=None):
        v = self.t[self.i]
        if x is not None and v != x:
            raise SyntaxError(f'expected {x} got {v} at {self.i}')
        self.i += 1
        return v

    def block(self):
        self.eat('{')
        body = []
        while self.peek() != '}':
            body.append(self.stmt())
        self.eat('}')
        return ('block', body)

    def stmt(self):
        p = self.peek()
        if p == '{':
            return self.block()
        if p == 'if':
            self.eat('if'); self.eat('(')
            cond = self.cond()
            self.eat(')')
            then = self.stmt()
            els = None
            if self.peek() == 'else':
                self.eat('else')
                els = self.stmt()
            return ('if', cond, then, els)
        if p == 'return':
            self.eat('return'); self.eat('('); self.eat('longdouble'); self.eat(')')
            v = float(self.eat())
            self.eat(';')
            return ('ret', v)
        if p == 'goto':
            self.eat('goto')
            lab = self.eat()
            self.eat(';')
            return ('goto', lab)
        if self.peek(1) == ':' and p.startswith('LAB_'):
            lab = self.eat(); self.eat(':')
            node = ('label', lab, self.stmt())
            return node
        raise SyntaxError(f'unexpected {p} at {self.i}: {self.t[self.i:self.i+8]}')

    def cond(self):
        terms = [self.atom()]
        ops = []
        while self.peek() in ('&&', '||'):
            ops.append(self.eat())
            terms.append(self.atom())
        return ('cond', terms, ops)

    def atom(self):
        if self.peek() == '(':
            self.eat('(')
            c = self.cond()
            self.eat(')')
            return c
        a = self.eat(); op = self.eat(); b = self.eat()
        return ('cmp', a, op, b)


def evaluate_cond(c, x):
    if c[0] == 'cmp':
        _, a, op, b = c
        va = x if a == 'param_1' else charval(a)
        vb = x if b == 'param_1' else charval(b)
        return {'==': va == vb, '!=': va != vb, '<': va < vb, '>': va > vb, '<=': va <= vb, '>=': va >= vb}[op]
    _, terms, ops = c
    r = evaluate_cond(terms[0], x)
    for op, t in zip(ops, terms[1:]):
        r = (r and evaluate_cond(t, x)) if op == '&&' else (r or evaluate_cond(t, x))
    return r


class Goto(Exception):
    def __init__(self, lab):
        self.lab = lab


def run(node, x):
    k = node[0]
    if k == 'block':
        for s in node[1]:
            r = run(s, x)
            if r is not None:
                return r
        return None
    if k == 'if':
        if evaluate_cond(node[1], x):
            return run(node[2], x)
        return run(node[3], x) if node[3] else None
    if k == 'ret':
        return node[1]
    if k == 'goto':
        raise Goto(node[1])
    if k == 'label':
        return run(node[2], x)


def flatten(node, out):
    """List top-level statements so a goto can resume after its label (labels live at block level)."""
    out.append(node)


def find_label_path(node, lab, path):
    if node is None:
        return None
    k = node[0]
    if k == 'label' and node[1] == lab:
        return path + [node]
    if k == 'block':
        for i, s in enumerate(node[1]):
            r = find_label_path(s, lab, path + [(node, i)])
            if r:
                return r
    if k == 'if':
        return find_label_path(node[2], lab, path) or find_label_path(node[3], lab, path)
    if k == 'label':
        return find_label_path(node[2], lab, path)
    return None


def run_from_label(root, lab, x):
    path = find_label_path(root, lab, [])
    label = path[-1]
    r = run(label[2], x)
    if r is not None:
        return r
    # continue with the statements following the label in each enclosing block (innermost first)
    for blk, idx in reversed([p for p in path[:-1] if isinstance(p, tuple) and len(p) == 2 and isinstance(p[0], tuple)]):
        for s in blk[1][idx + 1:]:
            r = run(s, x)
            if r is not None:
                return r
    return None


def letter_width(root, x):
    try:
        return run(root, x)
    except Goto as g:
        for _ in range(10):
            try:
                return run_from_label(root, g.lab, x)
            except Goto as g2:
                g = g2
    return None


def main():
    text = open(SRC, encoding='utf-8', errors='replace').read()
    part = text.split('// ===== Lang::getLetterWidth @')[1].split('// =====')[0]
    body = part[part.index('{'):]
    body = re.sub(r'/\*.*?\*/', ' ', body, flags=re.S)
    p = Parser(tokenize(body))
    root = p.block()
    widths = {}
    for ch in ALPHABET:
        w = letter_width(root, ord(ch))
        widths[ch] = w
    missing = [c for c, w in widths.items() if w is None]
    sys.stderr.write(f'{len(ALPHABET)} glyphs, unresolved: {missing!r}\n')
    json.dump({'alphabet': ALPHABET, 'widths': widths, 'cols': 12, 'cell': 30, 'charSpace': 2.5,
               'lineHeight': 18, 'notFound': '~'}, sys.stdout, ensure_ascii=False, indent=0)


if __name__ == '__main__':
    main()
