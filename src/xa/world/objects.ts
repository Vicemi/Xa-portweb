// Moving platforms (PlatformInterp / PlatformLinear) and Doors. Reads the object's own TMX props.
import { frameOf } from '../core/sprites';
import { playSound } from '../core/audio';
import type { TmxObject } from './tmx';

function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

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

  constructor(o: TmxObject, x: number, y: number) {
    this.x = this.prevX = this.homeX = x;
    this.y = this.prevY = this.homeY = y;
    this.w = +(o.w || 64);
    this.h = +(o.h || 32);
    this.img = o.props.pAsset ?? '';
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
    const dx = Math.round(this.x - camX);
    const dy = Math.round(this.y - camY);
    // tile the sprite across the platform width
    for (let tx = 0; tx < this.w; tx += f.sw) {
      ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, dx + tx, dy, Math.min(f.sw, this.w - tx), f.sh);
    }
  }
}

/** A locked gate that opens when the hero has the required key(s). */
export class Door {
  x: number; y: number; w: number; h: number;
  open = false;
  img: string;
  private required: string;
  private count: number;
  private openT = 0;

  constructor(o: TmxObject, x: number, y: number) {
    this.x = x; this.y = y;
    this.w = +(o.w || 32);
    this.h = +(o.h || 128);
    this.img = o.props.pAsset ?? 'GATE';
    this.required = o.props.pRequiredItem ?? '';
    this.count = +(o.props.pRequiredCount ?? 1) || 1;
  }

  bounds(): { x: number; y: number; w: number; h: number } {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Returns true if the door opened (hero had the key). */
  tryOpen(keys: string[]): boolean {
    if (this.open || !this.required) return this.open;
    let have = 0;
    for (const k of keys) if (k === this.required) have++;
    if (have >= this.count) {
      this.open = true;
      this.openT = 0.5; // opening fade-out
      playSound('DOOR_OPENED');
      return true;
    }
    return false;
  }

  update(dt: number): void {
    if (this.open && this.openT > 0) this.openT -= dt;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.open && this.openT <= 0) return; // fully open → gone
    const f = frameOf(this.img, 0);
    if (!f) return;
    ctx.save();
    if (this.open) ctx.globalAlpha = Math.max(0, this.openT / 0.5);
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, Math.round(this.x - camX), Math.round(this.y - camY), f.sw, f.sh);
    ctx.restore();
  }
}
