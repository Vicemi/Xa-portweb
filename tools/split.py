import re, os, collections
src = r'F:\Games\Xa\remake\decompiled\xa_decompiled_FULL.c'
out = r'F:\Games\Xa\remake\decompiled\by_class'
os.makedirs(out, exist_ok=True)
text = open(src, encoding='utf-8', errors='replace').read()
parts = re.split(r'(?m)^// ===== (.+?) @ ([0-9a-f]+) =====\s*$', text)
groups = collections.defaultdict(list)
for i in range(1, len(parts), 3):
    name, addr, body = parts[i], parts[i+1], parts[i+2]
    if name.startswith('bat::Singleton') or '~' in name: continue
    m = re.match(r'(?:bat::)?([A-Za-z_][A-Za-z0-9_]*)::', name)
    cls = m.group(1) if m else '_free'
    if name.startswith('bat::'): cls = 'bat_' + cls
    if name.startswith('std::') or name.startswith('boost::') or name.startswith('<EXTERNAL>'): continue
    groups[cls].append(f'// ===== {name} @ {addr} =====\n{body.strip()}\n')
idx = []
for cls, fns in groups.items():
    data = '\n\n'.join(fns)
    open(os.path.join(out, cls + '.c'), 'w', encoding='utf-8').write(data)
    idx.append((cls, len(fns), len(data)))
idx.sort()
with open(os.path.join(out, '_INDEX.txt'), 'w') as f:
    for c, n, s in idx: f.write(f'{c:40s} {n:4d} fns {s:8d} bytes\n')
print(len(idx), 'classes')
