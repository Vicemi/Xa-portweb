"""Extract the game's built-in Spanish texts (Lang::mTitles / mDescriptions / level ids, pause dialog)
from the user's own xa.exe and write them into src/xa/data/levels.json.

The Windows build stores them as UTF-16LE literals in .rdata, in reverse level order:
  titles 16..1, then descriptions 16..1, then "Nivel 16".."Nivel 1".

usage: python extract_texts.py [path\\to\\xa.exe]
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = sys.argv[1] if len(sys.argv) > 1 else r'F:\Games\Xa\xa.exe'
data = open(EXE, 'rb').read()

WSTR = re.compile(rb'(?:(?:[\x20-\x7e\xa0-\xff]|\n)\x00){2,}\x00\x00')


def strings_from(off, count):
    """The next `count` NUL-terminated UTF-16 strings starting at file offset `off` (skipping padding)."""
    out = []
    for m in WSTR.finditer(data, off):
        out.append(m.group()[:-2].decode('utf-16-le'))
        if len(out) == count:
            return out
    raise SystemExit('ran out of strings')


def find(s):
    i = data.find(s.encode('utf-16-le') + b'\x00\x00')
    if i < 0:
        raise SystemExit('not found in exe: ' + s)
    return i


# 16 titles end with level 1 "Campos del Oeste"; locate the block start by walking back from the "Nivel 16" ids.
level1_title = find('Campos del Oeste')
ids_start = find('Nivel 16')
before = [m for m in WSTR.finditer(data, level1_title - 0x400, level1_title + len('Campos del Oeste') * 2 + 2)]
titles_rev = [m.group()[:-2].decode('utf-16-le') for m in before][-16:]
descs_rev = strings_from(level1_title + len('Campos del Oeste') * 2 + 2, 16)
ids_rev = strings_from(ids_start, 16)

pause_q = next(s for s in strings_from(find('Cuatreros Gal\u00e1cticos') - 2, 3) if s.startswith('\u00bf'))

out = {
    'titles': titles_rev[::-1],
    'descriptions': descs_rev[::-1],
    'ids': ids_rev[::-1],
    'ui': {'pauseQuestion': pause_q, 'back': 'Atr\u00e1s', 'points': 'Puntos'},
}
assert out['titles'][0] == 'Campos del Oeste' and out['ids'][0] == 'Nivel 1', out
dst = os.path.join(ROOT, 'src', 'xa', 'data', 'levels.json')
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('wrote', dst)
for t, d in zip(out['titles'], out['descriptions']):
    print('-', t, '|', d.split('\n')[0])
