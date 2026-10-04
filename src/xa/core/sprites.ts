// bat::ImageMap + bat::Anim equivalents. Frame layouts come from src/xa/data/sprites.json
// (extracted from xa.exe's Assets* tables); the pixels come from the user's own sheets at runtime.
import data from '../data/sprites.json';
import { img } from './assets';

export interface MapDef {
  path: string;
  type: number; // 0 whole image, 1 strip, 2 grid, 3 single rect, 4 rect list
  anchor: [number, number];
  rect?: [number, number, number, number] | null;
  cols?: number;
  rows?: number;
  count?: number;
  rects?: [number, number, number, number][];
}
export interface FrameDef { map: string; i: number; d: number }
export interface AnimDef { name: string; loop: number; base: number; frames: FrameDef[] }

export const MAPS = (data as unknown as { maps: Record<string, MapDef> }).maps;
export const ANIMS = (data as unknown as { anims: Record<string, AnimDef> }).anims;

export interface Frame { image: HTMLImageElement; sx: number; sy: number; sw: number; sh: number; ax: number; ay: number }

/** Resolve frame `index` of image map `name` to a source rect + anchor. */
export function frameOf(name: string, index = 0): Frame | null {
  const m = MAPS[name];
  if (!m) return null;
  const image = img(m.path);
  if (!image) return null;
  let r: [number, number, number, number];
  switch (m.type) {
    case 1: {
      const [x, y, w, h] = m.rect!;
      const cols = m.cols || 1;
      r = [x + (index % cols) * w, y + Math.floor(index / cols) * h, w, h];
      break;
    }
    case 2: {
      const [x, y, w, h] = m.rect!;
      const cols = m.cols || 1;
      r = [x + (index % cols) * w, y + Math.floor(index / cols) * h, w, h];
      break;
    }
    case 4:
      r = m.rects![Math.min(index, m.rects!.length - 1)];
      break;
    case 3:
      r = m.rect!;
      break;
    default:
      r = [0, 0, image.width, image.height];
  }
  return { image, sx: r[0], sy: r[1], sw: r[2], sh: r[3], ax: m.anchor[0], ay: m.anchor[1] };
}

export function mapPaths(names?: string[]): string[] {
  return (names ?? Object.keys(MAPS)).map((n) => MAPS[n]?.path).filter(Boolean) as string[];
}

/** Draw a frame with its anchor at (x, y). dir = -1 mirrors horizontally around the anchor. */
export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame, x: number, y: number, dir = 1, alpha = 1): void {
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (dir < 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, -f.ax, -f.ay, f.sw, f.sh);
    ctx.restore();
  } else {
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, x - f.ax, y - f.ay, f.sw, f.sh);
  }
  if (alpha !== 1) ctx.globalAlpha = 1;
}

/** bat::Anim: plays an AnimDef. Frame durations are in ticks of 1/base seconds. */
export class Anim {
  type: AnimDef | null = null;
  time = 0;
  playing = true;

  constructor(name?: string) {
    if (name) this.set(name);
  }
  set(name: string): this {
    const t = ANIMS[name] ?? null;
    if (t !== this.type) {
      this.type = t;
      this.time = 0;
      this.playing = true;
    }
    return this;
  }
  get name(): string { return this.type?.name ?? ''; }
  duration(): number {
    if (!this.type) return 0;
    return this.type.frames.reduce((s, f) => s + (f.d || 1), 0) / (this.type.base || 60);
  }
  goToAndPlay(frame: number): void {
    if (!this.type) return;
    let t = 0;
    for (let i = 0; i < Math.min(frame, this.type.frames.length); i++) t += (this.type.frames[i].d || 1) / (this.type.base || 60);
    this.time = t;
    this.playing = true;
  }
  update(dt: number): void {
    if (!this.type || !this.playing) return;
    this.time += dt;
    const d = this.duration();
    if (this.time < 0) this.time = this.type.loop ? d + (this.time % d) : 0;
    if (this.time >= d) this.time = this.type.loop && d > 0 ? this.time % d : d;
  }
  isOver(): boolean {
    return !!this.type && !this.type.loop && this.time >= this.duration();
  }
  frameNum(): number {
    if (!this.type) return 0;
    const base = this.type.base || 60;
    let t = 0;
    for (let i = 0; i < this.type.frames.length; i++) {
      t += (this.type.frames[i].d || 1) / base;
      if (this.time < t) return i;
    }
    return this.type.frames.length - 1;
  }
  frame(): Frame | null {
    if (!this.type || !this.type.frames.length) return null;
    const f = this.type.frames[this.frameNum()];
    return frameOf(f.map, f.i);
  }
}
