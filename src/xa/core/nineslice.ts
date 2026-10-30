// Arte de la interfaz online (public/online/*.png, ver docs/GEMINI_UI_ONLINE.md y tools/slice_ui_sheets.py) para los
// canvas del juego: carga perezosa y dibujo en 9 cortes (las esquinas y bordes NO se estiran, sólo el centro).
// Si una imagen falta o no cargó, uiArt() devuelve null y quien dibuja usa su dibujo de respaldo.

const cache = new Map<string, HTMLImageElement | null>();

export const UI_ART = [
  'friend_plate', 'powerup_plate', 'powerbar_frame', 'powerbar_fill', 'powerbar_fill_warn', 'host_flag', 'down_badge',
  'heart', 'crown', 'roster_plate', 'vote_chip', 'vote_flag', 'pick_banner', 'cursor_host', 'cursor_guest', 'level_lock',
] as const;

/** Imagen ya cargada (o null: todavía no / no existe). La primera llamada dispara la carga. */
export function uiArt(name: string): HTMLImageElement | null {
  if (cache.has(name)) {
    const im = cache.get(name);
    return im && im.complete && im.naturalWidth ? im : null;
  }
  const im = new Image();
  im.onerror = () => cache.set(name, null);
  im.src = `/online/${name}.png`;
  cache.set(name, im);
  return null;
}

export function preloadUiArt(): void {
  if (typeof Image === 'undefined') return;
  for (const n of UI_ART) uiArt(n);
}

/** [arriba, derecha, abajo, izquierda] en píxeles de la imagen. */
export type Slice = [number, number, number, number];

/** Dibuja `im` en (x, y, w, h) con 9 cortes. `k` = píxeles de destino por píxel de imagen para los bordes (así las
 *  esquinas conservan su proporción); si los bordes no entran en w/h se achican todos juntos. */
export function draw9(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number,
  slice: Slice, k: number): void {
  const [t, r, b, l] = slice;
  const sw = im.naturalWidth, sh = im.naturalHeight;
  const kk = Math.min(k, w / (l + r), h / (t + b));
  const dl = l * kk, dr = r * kk, dt = t * kk, db = b * kk;
  const xs = [0, l, sw - r, sw], ys = [0, t, sh - b, sh];
  // límites al píxel entero del canvas: sin costuras claras entre cortes
  const xd = [x, x + dl, x + w - dr, x + w].map(Math.round), yd = [y, y + dt, y + h - db, y + h].map(Math.round);
  const prev = ctx.imageSmoothingQuality;
  ctx.imageSmoothingQuality = 'high';
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const sW = xs[i + 1] - xs[i], sH = ys[j + 1] - ys[j], dW = xd[i + 1] - xd[i], dH = yd[j + 1] - yd[j];
      if (sW > 0 && sH > 0 && dW > 0 && dH > 0) ctx.drawImage(im, xs[i], ys[j], sW, sH, xd[i], yd[j], dW, dH);
    }
  }
  ctx.imageSmoothingQuality = prev;
}

/** Imagen a tamaño nativo (proporción intacta): `h` o `w` fijan un lado y el otro sale solo. */
export function drawIcon(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, size: { w?: number; h?: number }): [number, number] {
  const k = size.h ? size.h / im.naturalHeight : (size.w ?? im.naturalWidth) / im.naturalWidth;
  const dw = im.naturalWidth * k, dh = im.naturalHeight * k;
  const prev = ctx.imageSmoothingQuality;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, x, y, dw, dh);
  ctx.imageSmoothingQuality = prev;
  return [dw, dh];
}

/** Silueta de `im` pintada de `color` (fichas de voto, banderas). */
export function drawIconTinted(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, size: { w?: number; h?: number },
  color: string): void {
  const k = size.h ? size.h / im.naturalHeight : (size.w ?? im.naturalWidth) / im.naturalWidth;
  const dw = Math.max(1, Math.round(im.naturalWidth * k)), dh = Math.max(1, Math.round(im.naturalHeight * k));
  const c = tintCanvas ?? (tintCanvas = document.createElement('canvas'));
  if (c.width < dw || c.height < dh) { c.width = Math.max(c.width, dw); c.height = Math.max(c.height, dh); }
  const t = c.getContext('2d')!;
  t.clearRect(0, 0, c.width, c.height);
  t.globalCompositeOperation = 'source-over';
  t.drawImage(im, 0, 0, dw, dh);
  t.globalCompositeOperation = 'multiply'; // conserva luz y sombra del dibujo y toma el tono del jugador
  t.fillStyle = color;
  t.fillRect(0, 0, dw, dh);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(im, 0, 0, dw, dh);
  t.globalCompositeOperation = 'source-over';
  ctx.drawImage(c, 0, 0, dw, dh, x, y, dw, dh);
}
let tintCanvas: HTMLCanvasElement | null = null;
