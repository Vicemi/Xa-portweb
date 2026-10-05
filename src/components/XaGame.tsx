import { useEffect, useRef, useState } from 'react';
import { XaGame } from '../xa/game';

/** Full-window, responsive game canvas (4:3 letterboxed). On touch devices it adds a rotate prompt
 *  and transparent virtual controls. Click or any key = user gesture for folder/audio. */
export default function XaGameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const dpadRef = useRef<HTMLDivElement>(null);
  const dpadDir = useRef<string | null>(null);

  useEffect(() => {
    const g = new XaGame(canvasRef.current!);
    if (import.meta.env.DEV) (window as unknown as { __xa: XaGame }).__xa = g;
    void g.start();
    const gesture = () => void g.userGesture();
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    return () => {
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      g.stop();
    };
  }, []);

  useEffect(() => {
    const isT = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsTouch(isT);
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  // Dispatch synthetic key events so the existing keyboard input system drives the game.
  const press = (code: string) => (down: boolean) => {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  };

  // Draggable D-pad: direction follows the finger position relative to the pad centre, so sliding
  // from one side to another switches direction without lifting the finger.
  const dpadDirFrom = (clientX: number, clientY: number): string | null => {
    const el = dpadRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    const dead = Math.max(10, r.width * 0.12);
    if (Math.abs(dx) < dead && Math.abs(dy) < dead) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'ArrowRight' : 'ArrowLeft';
    return dy > 0 ? 'ArrowDown' : 'ArrowUp';
  };
  const setDpadDir = (dir: string | null) => {
    if (dir === dpadDir.current) return;
    if (dpadDir.current) press(dpadDir.current)(false);
    if (dir) press(dir)(true);
    dpadDir.current = dir;
  };
  const dpadHandlers = {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setDpadDir(dpadDirFrom(e.clientX, e.clientY)); },
    onPointerMove: (e: React.PointerEvent) => { if (dpadDir.current !== null) setDpadDir(dpadDirFrom(e.clientX, e.clientY)); },
    onPointerUp: () => setDpadDir(null),
    onPointerCancel: () => setDpadDir(null),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  const bind = (code: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); press(code)(true); },
    onPointerUp: (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); press(code)(false); },
    onPointerLeave: () => press(code)(false),
    onPointerCancel: () => press(code)(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <div className="xa-stage">
      <canvas ref={canvasRef} className="xa-canvas" tabIndex={0} />

      {isTouch && portrait && (
        <div className="xa-rotate">
          <div className="xa-rotate-inner">
            <span className="xa-rotate-icon">🔄</span>
            <span>Girá el celular para jugar</span>
          </div>
        </div>
      )}

      {isTouch && !portrait && (
        <div className="xa-controls">
          <div className="xa-dpad" ref={dpadRef} {...dpadHandlers}>
            <span className="xa-dpad-arrow xa-up">▲</span>
            <span className="xa-dpad-arrow xa-left">◀</span>
            <span className="xa-dpad-arrow xa-down">▼</span>
            <span className="xa-dpad-arrow xa-right">▶</span>
          </div>

          <div className="xa-actions">
            <button className="xa-btn xa-fire" {...bind('KeyX')} aria-label="Disparar">FUEGO</button>
            <button className="xa-btn xa-jump" {...bind('Space')} aria-label="Saltar">SALTO</button>
          </div>

          <button className="xa-btn xa-back" {...bind('Escape')} aria-label="Volver">↩</button>
        </div>
      )}
    </div>
  );
}
