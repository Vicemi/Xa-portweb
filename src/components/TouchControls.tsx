import { useEffect, useRef, useState } from 'react';

/**
 * Mobile controls in the style of most action games:
 * - LEFT half of the screen is a floating joystick: put a finger anywhere, drag toward a direction. The stick
 *   origin follows the finger when it is dragged past the ring, so reversing direction is instant. Diagonals
 *   press two keys (e.g. right + up to climb while walking onto a ladder).
 * - RIGHT half holds big JUMP / FIRE buttons with generous hit areas. Each finger is tracked on its own
 *   (true multitouch), and a finger can slide from one button to the other without lifting.
 * All of it is turned into keyboard events, so the game's own input code (bat::Keyboard semantics) is reused.
 */

type Key = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Space' | 'KeyX' | 'Escape';

const STICK_RADIUS = 56;   // px the knob can travel from the origin before the origin starts to follow
const DEAD_ZONE = 14;      // px of slack before any direction is pressed
const VERTICAL_RATIO = 0.6; // |dy| must exceed this share of the distance to count as up/down (≈37° cone)

const held = new Map<Key, number>(); // reference count per key across all fingers

function keyDown(code: Key): void {
  const n = held.get(code) ?? 0;
  held.set(code, n + 1);
  if (n === 0) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
}
function keyUp(code: Key): void {
  const n = held.get(code) ?? 0;
  if (n <= 1) {
    held.delete(code);
    if (n === 1) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  } else held.set(code, n - 1);
}
function releaseAll(): void {
  for (const code of [...held.keys()]) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  held.clear();
}
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

/** Keys pressed for a drag vector (screen coords: +y = down). */
function stickKeys(dx: number, dy: number): Key[] {
  const d = Math.hypot(dx, dy);
  if (d < DEAD_ZONE) return [];
  const out: Key[] = [];
  if (Math.abs(dx) > DEAD_ZONE * 0.8 && Math.abs(dx) / d > 0.38) out.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (Math.abs(dy) / d > VERTICAL_RATIO) out.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
  return out;
}

interface Stick { id: number; ox: number; oy: number; x: number; y: number; keys: Key[] }
interface Btn { id: number; key: Key | null }

export default function TouchControls({ active }: { active: boolean }) {
  const jumpRef = useRef<HTMLDivElement>(null);
  const fireRef = useRef<HTMLDivElement>(null);
  const stick = useRef<Stick | null>(null);
  const buttons = useRef(new Map<number, Btn>());
  const [view, setView] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState<{ jump: boolean; fire: boolean }>({ jump: false, fire: false });

  // leaving gameplay (pause, menus, game over) must never leave a key stuck down
  useEffect(() => {
    if (!active) {
      stick.current = null;
      buttons.current.clear();
      setView(null);
      setPressed({ jump: false, fire: false });
      releaseAll();
    }
  }, [active]);
  useEffect(() => {
    const blur = () => { stick.current = null; buttons.current.clear(); setView(null); releaseAll(); };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', blur);
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', blur); };
  }, []);

  const refreshPressed = () => {
    let jump = false, fire = false;
    for (const b of buttons.current.values()) { if (b.key === 'Space') jump = true; if (b.key === 'KeyX') fire = true; }
    setPressed({ jump, fire });
  };

  /** Which action button lies under a point (hit areas are larger than the drawn circles). */
  const buttonAt = (x: number, y: number): Key | null => {
    const hit = (el: HTMLDivElement | null, pad: number) => {
      if (!el) return Infinity;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      return d <= r.width / 2 + pad ? d : Infinity;
    };
    const j = hit(jumpRef.current, 34), f = hit(fireRef.current, 28);
    if (j === Infinity && f === Infinity) return null;
    return j <= f ? 'Space' : 'KeyX';
  };

  const setStickKeys = (s: Stick, keys: Key[]) => {
    for (const k of s.keys) if (!keys.includes(k)) keyUp(k);
    for (const k of keys) if (!s.keys.includes(k)) keyDown(k);
    s.keys = keys;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    const x = e.clientX, y = e.clientY;
    if (x < window.innerWidth / 2) {
      if (stick.current) return; // one stick at a time; extra left-side fingers are ignored
      const s: Stick = { id: e.pointerId, ox: x, oy: y, x, y, keys: [] };
      stick.current = s;
      setView({ ox: x, oy: y, x, y });
    } else {
      const key = buttonAt(x, y) ?? 'Space'; // anywhere else on the right half = jump (most used in frantic bits)
      buttons.current.set(e.pointerId, { id: e.pointerId, key });
      keyDown(key);
      buzz(key === 'Space' ? 12 : 6);
      refreshPressed();
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (s && s.id === e.pointerId) {
      let { ox, oy } = s;
      const x = e.clientX, y = e.clientY;
      const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) { // floating origin: drag it along so the opposite direction is one short swipe away
        ox = x - (dx / d) * STICK_RADIUS;
        oy = y - (dy / d) * STICK_RADIUS;
      }
      s.ox = ox; s.oy = oy; s.x = x; s.y = y;
      setStickKeys(s, stickKeys(x - ox, y - oy));
      setView({ ox, oy, x, y });
      return;
    }
    const b = buttons.current.get(e.pointerId);
    if (b) {
      const key = buttonAt(e.clientX, e.clientY);
      if (key && key !== b.key) { // finger slid onto the other button
        if (b.key) keyUp(b.key);
        keyDown(key);
        b.key = key;
        buzz(8);
        refreshPressed();
      }
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (s && s.id === e.pointerId) {
      setStickKeys(s, []);
      stick.current = null;
      setView(null);
      return;
    }
    const b = buttons.current.get(e.pointerId);
    if (b) {
      if (b.key) keyUp(b.key);
      buttons.current.delete(e.pointerId);
      refreshPressed();
    }
  };

  if (!active) return null;
  const knob = view ? (() => {
    const dx = view.x - view.ox, dy = view.y - view.oy, d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, STICK_RADIUS / d);
    return { x: view.ox + dx * k, y: view.oy + dy * k };
  })() : null;

  return (
    <div
      className="xa-touch"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* left half: floating stick (a faint hint is shown where it usually goes) */}
      {view && knob ? (
        <>
          <div className="xa-stick-ring" style={{ left: view.ox, top: view.oy }} />
          <div className="xa-stick-knob" style={{ left: knob.x, top: knob.y }} />
        </>
      ) : (
        <div className="xa-stick-hint" aria-hidden="true"><span>◀ ▶</span></div>
      )}

      {/* right half: action buttons */}
      <div ref={fireRef} className={'xa-act xa-act-fire' + (pressed.fire ? ' is-down' : '')} aria-label="Disparar">FUEGO</div>
      <div ref={jumpRef} className={'xa-act xa-act-jump' + (pressed.jump ? ' is-down' : '')} aria-label="Saltar">SALTO</div>

    </div>
  );
}
