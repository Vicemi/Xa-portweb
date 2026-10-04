"""Small helper to explore xa.exe (MSVC x86, stripped).
usage:
  python xre.py wstr DOUBLE_JUMP [before] [after]   -> disasm around code that references the wide string
  python xre.py writes 0x52a3f0 [span]               -> instructions that write into [addr, addr+span)
  python xre.py reads 0x52a3f0 [span]                -> instructions that touch [addr, addr+span)
  python xre.py dis 0x401000 [count]                 -> disassemble at VA
  python xre.py f32 0x52a3f0 [n]                     -> dump n floats from the file image at VA
"""
import sys, struct, pefile, functools
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

EXE = r'F:\Games\Xa\xa.exe'
pe = pefile.PE(EXE, fast_load=True)
base = pe.OPTIONAL_HEADER.ImageBase
img = pe.get_memory_mapped_image()
text = next(s for s in pe.sections if s.Name.startswith(b'.text'))
tva = base + text.VirtualAddress
tdata = img[text.VirtualAddress:text.VirtualAddress + text.Misc_VirtualSize]
md = Cs(CS_ARCH_X86, CS_MODE_32)
md.skipdata = True


@functools.lru_cache(None)
def all_insns():
    return list(md.disasm(tdata, tva))


def va2off(va):
    return va - base


def find_wstr(s):
    pat = s.encode('utf-16-le') + b'\x00\x00'
    out, i = [], 0
    while True:
        i = img.find(pat, i)
        if i < 0:
            return out
        out.append(base + i)
        i += 2


def dis(va, count=40):
    off = va - tva
    for n, ins in enumerate(md.disasm(tdata[off:off + count * 15], va)):
        if n >= count:
            break
        print(f'{ins.address:08x}  {ins.mnemonic:6s} {ins.op_str}')


def refs_to(target_vals):
    targets = {f'0x{v:x}' for v in target_vals}
    return [ins for ins in all_insns() if any(t in ins.op_str for t in targets)]


def main():
    cmd = sys.argv[1]
    if cmd == 'wstr':
        b = int(sys.argv[3]) if len(sys.argv) > 3 else 10
        a = int(sys.argv[4]) if len(sys.argv) > 4 else 40
        addrs = find_wstr(sys.argv[2])
        print('string at', [hex(x) for x in addrs])
        insns = all_insns()
        idx = {ins.address: k for k, ins in enumerate(insns)}
        for ins in refs_to(addrs):
            k = idx[ins.address]
            print('---- ref at', hex(ins.address))
            for j in insns[max(0, k - b):k + a]:
                print(f'{j.address:08x}  {j.mnemonic:6s} {j.op_str}')
    elif cmd in ('writes', 'reads'):
        addr = int(sys.argv[2], 16)
        span = int(sys.argv[3], 0) if len(sys.argv) > 3 else 8
        vals = range(addr, addr + span)
        for ins in refs_to(vals):
            if cmd == 'writes' and not (ins.mnemonic.startswith(('mov', 'fst', 'movss', 'movq')) and ins.op_str.startswith(('dword ptr [0x', 'qword ptr [0x'))):
                continue
            print(f'{ins.address:08x}  {ins.mnemonic:6s} {ins.op_str}')
    elif cmd == 'dis':
        dis(int(sys.argv[2], 16), int(sys.argv[3]) if len(sys.argv) > 3 else 40)
    elif cmd == 'f32':
        va = int(sys.argv[2], 16)
        n = int(sys.argv[3]) if len(sys.argv) > 3 else 8
        off = va - base
        print([round(x, 4) for x in struct.unpack_from(f'<{n}f', img, off)])


if __name__ == '__main__':
    main()
