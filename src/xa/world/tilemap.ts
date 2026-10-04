// TileMap equivalent: tile queries + the edge-sampling collision of TileMap::intersectsStep.
import { TileState, type TmxLevel } from './tmx';

/** InteractiveObject::IGNORE_INTERSECTION from xa.exe (.data 0x53280c). */
export const IGNORE_X = 1.0;
export const IGNORE_Y = 0.49;

/** IntersectionPlace::Enum */
export const enum Place {
  None = 0,
  Left = 1,        // wall hit on the left edge
  Right = 2,       // wall hit on the right edge
  Floor = 3,
  Ceiling = 4,
  FloorLeft = 5,
  FloorRight = 6,
  CeilingLeft = 7,
  CeilingRight = 8,
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface Hit { place: Place; dx: number; dy: number }

export class TileMap {
  readonly ts: number;
  readonly widthPx: number;
  readonly heightPx: number;

  constructor(readonly level: TmxLevel) {
    this.ts = level.tileW;
    this.widthPx = level.width * level.tileW;
    this.heightPx = level.height * level.tileH;
  }

  /** StageManager::getTileId + TileMap::getTileState (out-of-range ids read cell 0, like the original). */
  stateAt(px: number, py: number): TileState {
    const L = this.level;
    let id = Math.floor(py / L.tileH) * L.width + Math.floor(px / L.tileW);
    if (id < 0 || id >= L.width * L.height) id = 0;
    return L.tileStates.get(L.tiles[id]) ?? TileState.Normal;
  }
  tileAt(cx: number, cy: number): number {
    const L = this.level;
    if (cx < 0 || cy < 0 || cx >= L.width || cy >= L.height) return 0;
    return L.tiles[cy * L.width + cx];
  }

  isHard(x: number, y: number): boolean { return this.stateAt(x, y) === TileState.Hard; }
  isLadder(x: number, y: number): boolean { return this.stateAt(x, y) === TileState.Ladder; }
  isLadderEnd(x: number, y: number): boolean { return this.stateAt(x, y) === TileState.LadderEnd; }
  isPlatform(x: number, y: number): boolean { return this.stateAt(x, y) === TileState.Platform; }
  /** Decoration::isLadder: ladder body or its top. */
  isAnyLadder(x: number, y: number): boolean { return this.isLadder(x, y) || this.isLadderEnd(x, y); }
  /** Decoration::isOverLadder: standing exactly on top of a ladder. */
  isOverLadder(x: number, y: number): boolean { return this.isLadderEnd(x, y + 1) && !this.isLadderEnd(x, y); }

  /** TileMap::isDead: any killing tile inside the rect (inset 20px top/bottom). */
  isDead(r: Rect): boolean {
    const ts = this.ts;
    for (let x = r.x; x < r.x + r.w; x += ts) {
      for (let y = r.y + 20; y < r.y + r.h - 20; y += ts) if (this.stateAt(x, y) === TileState.Dead) return true;
      if (this.stateAt(x, r.y + r.h - 20) === TileState.Dead) return true;
    }
    return this.stateAt(r.x + r.w, r.y + r.h - 20) === TileState.Dead;
  }

  /**
   * TileMap::intersectsStep. `r` is the rect at the NEW position, (mx, my) the movement this step.
   * Returns the correction to apply and where the contact happened.
   */
  intersect(r: Rect, mx: number, my: number): Hit {
    const ts = this.ts;
    const left = r.x, right = r.x + r.w, top = r.y, bottom = r.y + r.h;
    let dy = 0, dx = 0;

    // ---- ceiling: sample the top edge over the PREVIOUS horizontal span ----
    // The original sweeps the rect back along the movement vector (TileMap::intersectsStep),
    // so the ceiling/floor probes use (left - mx, right - mx), not the already-penetrated
    // new span. Using the new span falsely reports a ceiling when the head edge just touches
    // a wall column, which returned place=8 (CeilingRight) and zeroed vel.y -> "stuck in wall".
    let ceiling = false;
    {
      const y = top - IGNORE_Y;
      const xStart = left - mx + IGNORE_X;
      const xEnd = right - mx - IGNORE_X;
      for (let x = xStart; x < xEnd && !ceiling; x += ts - 5) ceiling = this.isHard(x, y);
      if (!ceiling) ceiling = this.isHard(xEnd, y);
      if (ceiling) dy = Math.floor(y / ts) * ts + ts - top + IGNORE_Y;
    }

    // ---- floor: hard tiles, ladder tops and one-way platforms (only while moving down) ----
    let floor = false;
    {
      const y = bottom + IGNORE_Y;
      const xStart = left - mx + IGNORE_X;
      const xEnd = right - mx - IGNORE_X;
      const test = (x: number) =>
        this.isHard(x, y) ||
        (my > 0 && this.isLadderEnd(x, y)) ||
        (my > 0 && !this.isPlatform(x, y - 15) && this.isPlatform(x, y));
      for (let x = xStart; x < xEnd && !floor; x += ts * 0.5) floor = test(x);
      if (!floor) floor = test(xEnd);
      if (floor) dy = Math.floor(y / ts) * ts - bottom - IGNORE_Y;
    }

    // ---- walls: right edge first, then left edge, using the vertically corrected rect ----
    const t2 = top + dy, b2 = bottom + dy;
    let rightHit = false, leftHit = false;
    for (let y = t2; y < b2 && !rightHit; y += ts * 0.5) rightHit = this.isHard(right, y);
    if (!rightHit) rightHit = this.isHard(right, b2);
    if (rightHit) {
      dx = Math.floor(right / ts) * ts - (right + IGNORE_X);
    } else {
      for (let y = t2; y < b2 && !leftHit; y += ts * 0.5) leftHit = this.isHard(left, y);
      if (!leftHit) leftHit = this.isHard(left, b2);
      if (leftHit) dx = Math.floor(left / ts) * ts + ts - left;
    }

    let place: Place;
    if (ceiling) place = rightHit ? Place.CeilingRight : leftHit ? Place.CeilingLeft : Place.Ceiling;
    else if (floor) place = rightHit ? Place.FloorRight : leftHit ? Place.FloorLeft : Place.Floor;
    else place = rightHit ? Place.Right : leftHit ? Place.Left : Place.None;
    return { place, dx, dy };
  }
}

export function isFloorPlace(p: Place): boolean {
  return p === Place.Floor || p === Place.FloorLeft || p === Place.FloorRight;
}
