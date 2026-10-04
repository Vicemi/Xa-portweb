// Standalone simulation of TileMap::intersectsStep to hunt the "stuck in wall" bug.
const TS = 32;
const IGNORE_X = 1.0;
const IGNORE_Y = 0.49;

function isHard(grid, W, H, x, y) {
  const cx = Math.floor(x / TS), cy = Math.floor(y / TS);
  if (cx < 0 || cy < 0 || cx >= W || cy >= H) return true; // treat out-of-bounds as solid
  return grid[cy * W + cx] === 1;
}

function intersect(grid, W, H, rect, mx, my) {
  const left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h;
  let dy = 0, dx = 0;

  let ceiling = false;
  {
    const y = top - IGNORE_Y;
    const xStart = left - mx + IGNORE_X;
    const xEnd = right - mx - IGNORE_X;
    for (let x = xStart; x < xEnd && !ceiling; x += TS - 5) ceiling = isHard(grid, W, H, x, y);
    if (!ceiling) ceiling = isHard(grid, W, H, xEnd, y);
    if (ceiling) dy = Math.floor(y / TS) * TS + TS - top + IGNORE_Y;
  }

  let floor = false;
  {
    const y = bottom + IGNORE_Y;
    const xStart = left - mx + IGNORE_X;
    const xEnd = right - mx - IGNORE_X;
    const test = (x) => isHard(grid, W, H, x, y);
    for (let x = xStart; x < xEnd && !floor; x += TS * 0.5) floor = test(x);
    if (!floor) floor = test(xEnd);
    if (floor) dy = Math.floor(y / TS) * TS - bottom - IGNORE_Y;
  }

  const t2 = top + dy, b2 = bottom + dy;
  let rightHit = false, leftHit = false;
  for (let y = t2; y < b2 && !rightHit; y += TS * 0.5) rightHit = isHard(grid, W, H, right, y);
  if (!rightHit) rightHit = isHard(grid, W, H, right, b2);
  if (rightHit) {
    dx = Math.floor(right / TS) * TS - (right + IGNORE_X);
  } else {
    for (let y = t2; y < b2 && !leftHit; y += TS * 0.5) leftHit = isHard(grid, W, H, left, y);
    if (!leftHit) leftHit = isHard(grid, W, H, left, b2);
    if (leftHit) dx = Math.floor(left / TS) * TS + TS - left;
  }

  let place = 0;
  if (ceiling) place = rightHit ? 8 : leftHit ? 7 : 4;
  else if (floor) place = rightHit ? 6 : leftHit ? 5 : 3;
  else place = rightHit ? 2 : leftHit ? 1 : 0;
  return { place, dx, dy };
}

// Build a simple level: solid floor on row 10, a solid wall column at x=160 (col 5).
const W = 20, H = 20;
const grid = new Array(W * H).fill(0);
for (let cx = 0; cx < W; cx++) grid[10 * W + cx] = 1; // floor at y=320
for (let cy = 0; cy < H; cy++) grid[cy * W + 5] = 1;  // wall at x=160

// Simulate a hero (24x45) walking right into the wall on the floor.
let pos = { x: 100, y: 320 }; // feet position
const HERO_W = 24, HERO_H = 45;
let stuck = false;
let prevX = 100;
for (let frame = 0; frame < 120; frame++) {
  const dir = 1;
  pos.x += 250 / 60; // walk right
  const rect = { x: pos.x - HERO_W / 2 + 2 * dir, y: pos.y - HERO_H, w: HERO_W, h: HERO_H };
  const mx = 250 / 60, my = 0;
  const hit = intersect(grid, W, H, rect, mx, my);
  pos.x += hit.dx;
  pos.y += hit.dy;
  if (pos.x < prevX - 0.001) { stuck = true; console.log(`frame ${frame}: pushed BACK (x ${prevX.toFixed(2)} -> ${pos.x.toFixed(2)}) place=${hit.place} dx=${hit.dx.toFixed(2)}`); }
  prevX = pos.x;
}

console.log('final pos.x =', pos.x.toFixed(2), '  stuck =', stuck);
console.log('expected: settle at wall left edge (160) minus half-width (12+2) = 146');
