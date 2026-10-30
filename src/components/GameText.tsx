import type { CSSProperties } from 'react';
import fontData from '../xa/data/font.json';
import { FONT_PATHS, type FontName } from '../xa/core/font';

/** Text in the game's own comic lettering (the bitmap fonts of src/xa/core/font.ts) for the DOM panels: one
 *  background-sprite span per glyph, same widths and spacing as TextLineSprite. Sized in em (a 30 px glyph cell =
 *  CELL_EM em), so the surrounding CSS font-size scales it. The real text stays for screen readers, search and copy
 *  (visually hidden); the glyphs are aria-hidden. */
const META = fontData as unknown as { alphabet: string; widths: Record<string, number>; cols: number; cell: number; charSpace: number; notFound: string };
const INDEX = new Map<string, number>([...META.alphabet].map((c, i) => [c, i]));
const CELL_EM = 1.5; // the ink of a capital is ~2/3 of its cell: 1.5 em of cell ≈ 1 em of letter
const SHEET = 512;   // font sheets are 512x512

const em = (px: number) => `${((px / META.cell) * CELL_EM).toFixed(4)}em`;

export default function GameText({ text, font = 'black', className = '' }: { text: string; font?: Exclude<FontName, 'pixel'>; className?: string }) {
  const url = `url('/${FONT_PATHS[font]}')`;
  return (
    <span className={`xg ${className}`}>
      <span className="xg-sr">{text}</span>
      <span className="xg-glyphs" aria-hidden="true">
        {[...text].map((ch, n) => {
          const w = META.widths[ch] ?? META.cell;
          const box: CSSProperties = { width: em(w), marginRight: em(META.charSpace) };
          if (ch === ' ') return <i key={n} style={box} />;
          const i = INDEX.get(ch) ?? INDEX.get(META.notFound) ?? 0;
          const glyph: CSSProperties = {
            marginLeft: em(-(META.cell - w) / 2),
            backgroundImage: url,
            backgroundSize: `${em(SHEET)} ${em(SHEET)}`,
            backgroundPosition: `${em(-(i % META.cols) * META.cell)} ${em(-Math.floor(i / META.cols) * META.cell)}`,
          };
          return <i key={n} style={box}><b style={glyph} /></i>;
        })}
      </span>
    </span>
  );
}
