// Moving platforms (PlatformInterp / PlatformLinear) and Doors. Reads the object's own TMX props.
import { frameOf } from '../core/sprites';
import { playSound } from '../core/audio';
import type { TmxObject } from './tmx';

function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

/** Moving-platform image per level (Windows loadObjects: jump table on HeroState::actualLevel at 0x421b80). */
const PLATFORM_BY_LEVEL = [
  'GREEN_PLATFORM', 'BORDEAUX_PLATFORM', 'SKYBLUE_PLATFORM', 'GREEN_PLATFORM', 'GREEN_PLATFORM', 'CAVE_PLATFORM',
  'PURPLE_PLATFORM', 'BROWN_PLATFORM', 'CITY_PLATFORM', 'CITY_PLATFORM', 'CITY_PLATFORM', 'ICE_PLATFORM',
  'MOON_PLATFORM', 'MOON_PLATFORM', 'SPACE_PLATFORM', 'SPACE_PLATFORM',
];

/** One-way moving platform. `x`,`y` is the top-left of the standing surface (world coords). */
export class Platform {
  x: number; y: number;
  w: number; h: number;
  prevX: number; prevY: number;
  img: string;
  private homeX: number; private homeY: number;
  private destX: number; private destY: number;
  private duration: number; private wait: number;
  private t = 0;
  private phase: 'move' | 'wait' = 'move';
  private forward = true;
  private waitT = 0;

  constructor(o: TmxObject, x: number, y: number, level = 0) {
    this.x = this.prevX = this.homeX = x;
    this.y = this.prevY = this.homeY = y;
    // Scenario::loadObjects picks the moving-platform image from the CURRENT LEVEL (the TMX pAsset is ignored);
    // custom maps fall back to their pAsset / the green one
    this.img = PLATFORM_BY_LEVEL[level - 1] ?? (frameOf(o.props.pAsset ?? '', 0) ? o.props.pAsset! : 'GREEN_PLATFORM');
    // one sprite per platform: its width is the image's, not the TMX rect (two maps stretch the rect to the
    // whole travel range)
    const f = frameOf(this.img, 0);
    this.w = f ? f.sw : +(o.w || 64);
    this.h = +(o.h || 32);
    this.destX = x + (+(o.props.pxDest ?? 0) || 0);
    this.destY = y + (+(o.props.pyDest ?? 0) || 0);
    this.duration = Math.max(0.1, +(o.props.pDuration ?? 2) || 2);
    this.wait = +(o.props.pWait ?? 0.5) || 0;
  }

  update(dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.phase === 'wait') {
      this.waitT -= dt;
      if (this.waitT <= 0) { this.phase = 'move'; this.t = 0; this.forward = !this.forward; }
      return;
    }
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    const e = easeInOut(k);
    const sx = this.forward ? this.homeX : this.destX;
    const sy = this.forward ? this.homeY : this.destY;
    this.x = sx + (this.forward ? this.destX - sx : this.homeX - sx) * e;
    this.y = sy + (this.forward ? this.destY - sy : this.homeY - sy) * e;
    if (this.t >= this.duration) { this.phase = 'wait'; this.waitT = this.wait; }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const f = frameOf(this.img, 0) ?? frameOf('GREEN_PLATFORM', 0);
    if (!f) return;
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, Math.round(this.x - camX), Math.round(this.y - camY), f.sw, f.sh);
  }
}

/** Door: a locked gate. Touching it with pRequiredCount × pRequiredItem consumes those keys
 *  (Hero::consumeItems), plays DOOR_OPENED and sinks the gate into the floor linearly over 1 s — the texture
 *  rect and the collision bound shrink from the top while the bottom stays put (Door::internalUpdate). */
export class Door {
  x: number; y: number; w: number; h: number;
  open = false;
  img: string;
  private required: string;
  private count: number;
  private sink = 0; // 0..h

  constructor(o: TmxObject, x: number, y: number) {
    this.x = x; this.y = y;
    this.w = +(o.w || 32);
    this.h = +(o.h || 128);
    this.img = o.props.pAsset ?? 'GATE';
    this.required = o.props.pRequiredItem ?? '';
    this.count = +(o.props.pRequiredCount ?? 1) || 1;
  }

  /** Still solid until it has fully sunk. */
  get gone(): boolean { return this.open && this.sink >= this.h; }

  bounds(): { x: number; y: number; w: number; h: number } {
    return { x: this.x, y: this.y + this.sink, w: this.w, h: this.h - this.sink };
  }

  /** Returns true if the door opened (the hero had the keys, which are consumed). */
  tryOpen(keys: string[]): boolean {
    if (this.open || !this.required) return this.open;
    const have = keys.filter((k) => k === this.required).length;
    if (have < this.count) return false;
    for (let n = 0; n < this.count; n++) keys.splice(keys.indexOf(this.required), 1);
    this.open = true;
    playSound('DOOR_OPENED');
    return true;
  }

  update(dt: number): void {
    if (this.open && this.sink < this.h) this.sink = Math.min(this.h, this.sink + this.h * dt); // h px / s
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.gone) return;
    const f = frameOf(this.img, 0);
    if (!f) return;
    const vis = Math.max(0, f.sh - this.sink);
    if (vis <= 0) return;
    // Door::internalUpdate: texture rect y += sink, height -= sink, registered at the bottom → the lower rows stay
    // on the floor while the gate is eaten from the top
    ctx.drawImage(f.image, f.sx, f.sy + this.sink, f.sw, vis, Math.round(this.x - camX), Math.round(this.y + this.sink - camY), f.sw, vis);
  }
}
