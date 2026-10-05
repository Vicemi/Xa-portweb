import { useEffect, useRef, useState } from 'react';
import { XaGame } from '../xa/game';
import TouchControls from './TouchControls';

/** Full-window, responsive game canvas (4:3 letterboxed, or stretched from Options). On touch devices it adds
 *  a rotate prompt and, while playing, the TouchControls overlay. Click or any key = user gesture for audio. */
export default function XaGameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<XaGame | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [screen, setScreen] = useState('');
  const [backLabel, setBackLabel] = useState('↩');

  useEffect(() => {
    const g = new XaGame(canvasRef.current!);
    gameRef.current = g;
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

  // touch detection + orientation
  useEffect(() => {
    const forced = new URLSearchParams(location.search).get('touch'); // ?touch=1 / ?touch=0 overrides detection
    const isT = forced !== null ? forced !== '0' : 'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
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

  // the controls are only mounted while a level is being played (menus use plain taps = clicks)
  useEffect(() => {
    const id = window.setInterval(() => {
      const g = gameRef.current;
      setScreen(g?.currentScreen ?? '');
      setBackLabel(g?.backLabel() ?? '↩');
    }, 120);
    return () => window.clearInterval(id);
  }, []);

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

      <TouchControls active={isTouch && !portrait && screen === 'play'} />

      {/* always-visible back / Esc button on touch screens; its icon and action follow the current screen */}
      {isTouch && !portrait && screen && screen !== 'pick' && (
        <button
          className="xa-back-btn"
          aria-label="Volver"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            gameRef.current?.backAction();
            setBackLabel(gameRef.current?.backLabel() ?? '↩');
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {backLabel}
        </button>
      )}
    </div>
  );
}
