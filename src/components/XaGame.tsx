import { useEffect, useRef } from 'react';
import { XaGame } from '../xa/game';

/** Full-window, responsive game canvas (4:3 letterboxed). Click or any key = user gesture for folder/audio. */
export default function XaGameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  return (
    <div className="xa-stage">
      <canvas ref={canvasRef} className="xa-canvas" tabIndex={0} />
    </div>
  );
}
