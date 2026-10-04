"""Turn the extracted research JSON (imagemaps.json + *_anims.json) into the port's data file
src/xa/data/sprites.json, applying the manual fixes noted in MODLOG.md (hidden path assigns,
stale fields carried over by the decompiler, the HERO_IM_ entrance loop).

usage: python build_data.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, 'research')
maps_src = json.load(open(os.path.join(R, 'imagemaps.json')))

HERO_SHEET = 'assets/images/hero/Xa_animaciones.png'
HERO_SHEET_R = 'assets/images/hero/Xa_animaciones_red.png'


def norm(d):
    t = d['type']
    out = {'path': d['path'], 'type': t, 'anchor': d['anchor']}
    if t == 1:      # strip: start rect, `cols` per row, `rows` rows
        out.update(rect=d['rect'], cols=d['cols'], rows=d['rows'] or 1)
    elif t == 2:    # grid: cell = rect.w x rect.h, cols, count
        out.update(rect=d['rect'], cols=d['cols'], count=d['count'])
    elif t == 3:    # single rect
        out.update(rect=d['rect'])
    elif t == 4:    # explicit rect list
        out.update(rects=d.get('rects', []))
    else:           # 0 = whole image
        out.update(rect=None)
    return out


maps = {}
for cls, mm in maps_src.items():
    for name, d in mm.items():
        maps.setdefault(name, norm(d))

# ---- manual fixes (see MODLOG) ----
for n in ('HERO', 'HERO_STAIRS', 'HERO_DEAD'):
    maps[n]['path'] = HERO_SHEET
    maps[n + '_R']['path'] = HERO_SHEET_R
maps['HERO_DEAD']['type'] = maps['HERO_DEAD_R']['type'] = 3
maps['BULLET']['type'] = 3
for k in range(30):  # entrance: Xa falls from the top of the 512x384 screen
    maps['HERO_IM_%d' % k] = {'path': HERO_SHEET, 'type': 3, 'rect': [0, 70, 70, 70],
                              'anchor': [35, 384.0 - k * 10.466666]}
maps.pop('HERO_IM_', None)

anims = {}
for f in sorted(os.listdir(R)):
    if f.endswith('_anims.json'):
        anims.update(json.load(open(os.path.join(R, f))))
ent = anims.get('ENTRANCE')
if ent:
    k = 0
    for fr in ent['frames']:
        if fr['map'] == 'HERO_IM_':
            fr['map'], fr['i'] = 'HERO_IM_%d' % k, 0
            k += 1

dst = os.path.join(ROOT, 'src', 'xa', 'data')
os.makedirs(dst, exist_ok=True)
json.dump({'maps': maps, 'anims': anims}, open(os.path.join(dst, 'sprites.json'), 'w'), indent=0)
print(len(maps), 'maps', len(anims), 'anims ->', os.path.join(dst, 'sprites.json'))
