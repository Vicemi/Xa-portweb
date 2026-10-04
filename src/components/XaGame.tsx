import { useEffect, useRef, useState } from 'react';
import { XaGame } from '../xa/game';

/** Full-window, responsive game canvas (4:3 letterboxed). On touch devices it adds a rotate prompt
 *  and transparent virtual controls. Click or any key = user gesture for folder/audio. */
export default function XaGameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);

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
          <div className="xa-dpad">
            <button className="xa-btn xa-up" {...bind('ArrowUp')} aria-label="Arriba">▲</button>
            <button className="xa-btn xa-left" {...bind('ArrowLeft')} aria-label="Izquierda">◀</button>
            <button className="xa-btn xa-down" {...bind('ArrowDown')} aria-label="Abajo">▼</button>
            <button className="xa-btn xa-right" {...bind('ArrowRight')} aria-label="Derecha">▶</button>
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
