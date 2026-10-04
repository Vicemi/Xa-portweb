// Reads the original Tiled .tmx levels (the user's files, or new mod levels in the same format).
// Mirrors TileMap::parseDocument / TileMap::decode in xa.exe.

export const enum TileState {
  Hard = 0,      // pHard
  Normal = 1,    // default
  Ladder = 2,    // pLadder
  LadderEnd = 3, // pLadderEnd
  Platform = 4,  // pPlatform (one-way)
  Dead = 5,      // pKilling
  Invisible = 6, // pInvisible
}

const PROP_STATE: Record<string, TileState> = {
  pHard: TileState.Hard,
  pLadder: TileState.Ladder,
  pLadderEnd: TileState.LadderEnd,
  pPlatform: TileState.Platform,
  pKilling: TileState.Dead,
  pInvisible: TileState.Invisible,
};

export interface TmxObject {
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  props: Record<string, string>;
}

export interface TmxLevel {
  width: number;        // in tiles
  height: number;
  tileW: number;
  tileH: number;
  props: Record<string, string>;
  tilesetImage: string; // game-relative path
  tilesetCols: number;  // pTileSetWidth
  tilesetRows: number;  // pTileSetHeight
  tiles: Int32Array;    // tile image index (0-based) per cell, already reduced like TileMap::decode
  tileStates: Map<number, TileState>;
  objects: TmxObject[];
}

function props(el: Element | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el) return out;
  for (const p of Array.from(el.children)) {
    if (p.tagName !== 'properties') continue;
    for (const q of Array.from(p.children)) out[q.getAttribute('name') ?? ''] = q.getAttribute('value') ?? '';
  }
  return out;
}

function decodeBase64(text: string): Uint8Array {
  const bin = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseTmx(xml: string): TmxLevel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const map = doc.documentElement;
  const width = +map.getAttribute('width')!;
  const height = +map.getAttribute('height')!;
  const mprops = props(map);
  const tileset = map.querySelector('tileset')!;
  const tilesetImage = tileset.querySelector('image')?.getAttribute('source') ?? '';
  const tilesetCols = +(mprops.pTileSetWidth ?? 32);
  const tilesetRows = +(mprops.pTileSetHeight ?? 16);

  // Tile states: the engine reads only the FIRST property of each <tile>.
  const tileStates = new Map<number, TileState>();
  for (const t of Array.from(tileset.querySelectorAll('tile'))) {
    const first = t.querySelector('properties > property');
    if (!first) continue;
    const st = PROP_STATE[first.getAttribute('name') ?? ''];
    if (st !== undefined && first.getAttribute('value') === 'true') tileStates.set(+t.getAttribute('id')!, st);
  }

  // Layer data: gid % (cols*rows), 0 -> 1, then image index = gid - 1 (TileMap::decode / updateMap).
  const dataEl = map.querySelector('layer > data')!;
  const total = width * height;
  const tiles = new Int32Array(total);
  const mod = tilesetCols * tilesetRows;
  const enc = dataEl.getAttribute('encoding');
  if (enc === 'base64') {
    const bytes = decodeBase64(dataEl.textContent ?? '');
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < total; i++) {
      let gid = (dv.getUint32(i * 4, true) & 0x1fffffff) % mod;
      if (gid === 0) gid = 1;
      tiles[i] = gid - 1;
    }
  } else if (enc === 'csv') {
    const vals = (dataEl.textContent ?? '').split(',').map((s) => +s.trim());
    for (let i = 0; i < total; i++) {
      let gid = (vals[i] ?? 0) % mod;
      if (gid === 0) gid = 1;
      tiles[i] = gid - 1;
    }
  } else {
    const ts = Array.from(dataEl.querySelectorAll('tile'));
    for (let i = 0; i < total; i++) {
      let gid = +(ts[i]?.getAttribute('gid') ?? 0) % mod;
      if (gid === 0) gid = 1;
      tiles[i] = gid - 1;
    }
  }

  const objects: TmxObject[] = [];
  for (const o of Array.from(map.querySelectorAll('objectgroup > object'))) {
    objects.push({
      name: o.getAttribute('name') ?? '',
      type: o.getAttribute('type') ?? '',
      x: +(o.getAttribute('x') ?? 0),
      y: +(o.getAttribute('y') ?? 0),
      w: +(o.getAttribute('width') ?? 0),
      h: +(o.getAttribute('height') ?? 0),
      props: props(o),
    });
  }

  return {
    width, height,
    tileW: +map.getAttribute('tilewidth')!, tileH: +map.getAttribute('tileheight')!,
    props: mprops, tilesetImage, tilesetCols, tilesetRows, tiles, tileStates, objects,
  };
}
