// Asset source: the player's OWN game folder, picked in the browser and read locally (never uploaded).
// The deployed site ships no game files; paths are the engine's game-relative paths, e.g.
// "assets/images/hero/Xa_animaciones.png".

type Source = Map<string, File>;
let source: Source | null = null;
const urls = new Map<string, string>();
/** DEV ONLY: files served by the dev server from the local install (see astro.config.mjs). */
let devList: Set<string> | null = null;

export async function useDevGameFiles(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const r = await fetch('/__game/__list');
    if (!r.ok) return false;
    const list: string[] = await r.json();
    devList = new Set(list.map((p) => p.toLowerCase()));
    const real = new Map(list.map((p) => [p.toLowerCase(), p]));
    devReal = real;
    source = new Map();
    return devList.has('assets/data/level1.tmx');
  } catch {
    return false;
  }
}
let devReal: Map<string, string> = new Map();
async function devBlob(path: string): Promise<Blob | null> {
  const key = path.toLowerCase();
  if (!devList?.has(key)) return null;
  const r = await fetch('/__game/' + devReal.get(key));
  return r.ok ? r.blob() : null;
}

const DB = 'xa-port';
const STORE = 'handles';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function saveHandle(h: unknown): Promise<void> {
  try {
    const db = await idb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(h, 'game');
  } catch { /* persistence is optional */ }
}
async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get('game');
      r.onsuccess = () => resolve((r.result as FileSystemDirectoryHandle) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: Source): Promise<void> {
  for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    const p = prefix + name;
    if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, p + '/', out);
    else out.set(p.toLowerCase(), await (h as FileSystemFileHandle).getFile());
  }
}

/** Accepts the game root (containing "assets/") or the "assets" folder itself. */
function normalise(files: Source): Source | null {
  const out: Source = new Map();
  let hasAssets = false;
  for (const [p, f] of files) {
    const i = p.indexOf('assets/');
    if (i < 0) continue;
    hasAssets = true;
    out.set(p.slice(i), f);
  }
  if (!hasAssets) {
    // picked the assets folder directly
    for (const [p, f] of files) out.set('assets/' + p, f);
  }
  return out.has('assets/data/level1.tmx') ? out : null;
}

function setSource(s: Source): void {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  source = s;
}

export function hasGameFiles(): boolean {
  return source !== null;
}

/** Try the folder remembered from a previous visit (needs a user gesture to re-grant permission). */
export async function restoreGameFolder(withGesture: boolean): Promise<'ok' | 'needs-permission' | 'none'> {
  const h = await loadHandle();
  if (!h) return 'none';
  // @ts-expect-error: permission API typings vary
  const q = await h.queryPermission?.({ mode: 'read' });
  if (q !== 'granted') {
    if (!withGesture) return 'needs-permission';
    // @ts-expect-error: permission API typings vary
    const r = await h.requestPermission?.({ mode: 'read' });
    if (r !== 'granted') return 'needs-permission';
  }
  const files: Source = new Map();
  await walk(h, '', files);
  const s = normalise(files);
  if (!s) return 'none';
  setSource(s);
  return 'ok';
}

/** Ask the player for their game folder. Returns false if it doesn't look like the game. */
export async function pickGameFolder(): Promise<boolean> {
  const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> };
  if (w.showDirectoryPicker) {
    const h = await w.showDirectoryPicker({ id: 'xa-game', mode: 'read' });
    const files: Source = new Map();
    await walk(h, '', files);
    const s = normalise(files);
    if (!s) return false;
    await saveHandle(h);
    setSource(s);
    return true;
  }
  // Fallback for browsers without the File System Access API (Firefox, Safari).
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => {
      const files: Source = new Map();
      for (const f of Array.from(input.files ?? [])) files.set((f.webkitRelativePath || f.name).toLowerCase(), f);
      const s = normalise(files);
      if (s) setSource(s);
      resolve(!!s);
    };
    input.click();
  });
}

/** URL for a game-relative path (case-insensitive, like the Windows file system the game ran on). */
export function assetUrl(path: string): string | null {
  const key = path.replace(/\\/g, '/').toLowerCase();
  let u = urls.get(key);
  if (u) return u;
  if (devList) return devList.has(key) ? '/__game/' + devReal.get(key) : null;
  const f = source?.get(key);
  if (!f) return null;
  u = URL.createObjectURL(f);
  urls.set(key, u);
  return u;
}

const images = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(path: string): Promise<HTMLImageElement> {
  let p = images.get(path);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const u = assetUrl(path);
      if (!u) return reject(new Error(`Falta ${path}`));
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`No se pudo leer ${path}`));
      im.src = u;
    });
    images.set(path, p);
  }
  return p;
}

export async function loadText(path: string): Promise<string> {
  const f = devList ? await devBlob(path) : source?.get(path.toLowerCase());
  if (!f) throw new Error(`Falta ${path}`);
  return f.text();
}

export async function loadArrayBuffer(path: string): Promise<ArrayBuffer | null> {
  const f = devList ? await devBlob(path) : source?.get(path.toLowerCase());
  return f ? f.arrayBuffer() : null;
}

export function listFiles(prefix: string): string[] {
  const keys = devList ? [...devList] : source ? [...source.keys()] : [];
  return keys.filter((k) => k.startsWith(prefix.toLowerCase()));
}

const ready = new Map<string, HTMLImageElement>();
export async function preloadImages(paths: Iterable<string>): Promise<void> {
  // Some engine tables reference files that only exist in other builds (e.g. *_xo.png for OLPC): skip them.
  await Promise.all(
    [...new Set(paths)].map(async (p) => {
      if (ready.has(p)) return;
      try {
        ready.set(p, await loadImage(p));
      } catch {
        /* optional asset */
      }
    }),
  );
}
export function img(path: string): HTMLImageElement | undefined {
  return ready.get(path);
}
