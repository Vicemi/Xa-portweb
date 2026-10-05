// bat::GameFont / TextLineSprite equivalent. Glyph order and per-glyph widths come from xa.exe
// (Lang::initFontManager + Lang::getLetterWidth, see tools/letterwidth.py); the glyph pixels come from
// the user's own font sheets at runtime.
import fontData from '../data/font.json';
import { img } from './assets';

interface FontMeta { alphabet: string; widths: Record<string, number>; cols: number; cell: number; charSpace: number; lineHeight: number; notFound: string }
const META = fontData as unknown as FontMeta;

export const FONT_PATHS = {
  white: 'assets/lang/images/fuente_blanca.png',
  black: 'assets/lang/images/fuente_negra.png',
  black2: 'assets/lang/images/fuente_negra_2.png',
  pixel: 'assets/lang/images/fuente_pixelada.png',
} as const;
export type FontName = keyof typeof FONT_PATHS;

const CHAR_SPACE: Record<FontName, number> = { white: 2.5, black: 2.5, black2: 2.5, pixel: 0 };
const INDEX = new Map<string, number>([...META.alphabet].map((c, i) => [c, i]));

function glyphIndex(ch: string): number {
  return INDEX.get(ch) ?? INDEX.get(META.notFound) ?? 0;
}
function letterWidth(ch: string, font: FontName = 'black'): number {
  // Lang::initFontManager only gives the per-letter widths (addCharacter) to fonts 0-2; the pixel font keeps
  // GameFontDesc::getLetterWidth's default, the 30 px cell, so it is monospaced
  if (font === 'pixel') return META.cell;
  return META.widths[ch] ?? META.cell;
}

/** Width of one line as TextLineSprite computes it (sum of widths + spaces, minus the trailing space). */
export function lineWidth(text: string, font: FontName = 'black'): number {
  const s = CHAR_SPACE[font];
  let w = 0;
  for (const ch of text) w += letterWidth(ch, font) + s;
  return text.length ? w - s : 0;
}

export type Align = 'left' | 'center' | 'right';

/** Draw one line with its top-left (or top-centre / top-right) at (x, y). */
export function drawLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: FontName = 'black', align: Align = 'left', scale = 1): void {
  const sheet = img(FONT_PATHS[font]);
  if (!sheet) { console.warn('[font] no sheet for', font, FONT_PATHS[font]); return; }
  const cell = META.cell, cols = META.cols, s = CHAR_SPACE[font];
  const total = lineWidth(text, font) * scale;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (const ch of text) {
    const w = letterWidth(ch, font);
    if (ch !== ' ') {
      const i = glyphIndex(ch);
      const gx = cx + (-(cell - w) * 0.5) * scale;
      ctx.drawImage(sheet, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell, gx, y, cell * scale, cell * scale);
    }
    cx += (w + s) * scale;
  }
}

/** Multi-line text (\n separated), lines spaced by the font line height. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: FontName = 'black', align: Align = 'left', scale = 1): void {
  text.split('\n').forEach((line, i) => drawLine(ctx, line, x, y + i * META.lineHeight * scale, font, align, scale));
}

export const fontPaths = (): string[] => Object.values(FONT_PATHS);
