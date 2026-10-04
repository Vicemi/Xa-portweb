// Keyboard state with the same semantics as bat::Keyboard: isPressed (held) and isFirstPress (this frame).
// Key bindings match ControllerHero / Helper in xa.exe (see MODLOG "Teclado").

export type Action = 'up' | 'down' | 'left' | 'right' | 'jumpHold' | 'jumpTap' | 'fire' | 'confirm' | 'back' | 'any';

const BINDINGS: Record<Exclude<Action, 'any'>, string[]> = {
  up: ['ArrowUp', 'Numpad8'],
  down: ['ArrowDown', 'Numpad2'],
  left: ['ArrowLeft', 'Numpad4'],
  right: ['ArrowRight', 'Numpad6'],
  jumpHold: ['KeyZ', 'Space'],          // pressedJump: held keys
  jumpTap: ['Numpad1', 'Numpad7'],      // pressedJump: first-press keys
  fire: ['KeyX', 'Numpad3', 'Numpad9'],
  confirm: ['Enter', 'NumpadEnter'],
  back: ['Escape'],
};

const down = new Set<string>();
let prev = new Set<string>();
let curr = new Set<string>();
let anyPressedThisFrame = false;
let anyQueued = false;

export function attachInput(target: Window = window): () => void {
  const kd = (e: KeyboardEvent) => {
    if (!down.has(e.code)) anyQueued = true;
    down.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  const ku = (e: KeyboardEvent) => down.delete(e.code);
  const clear = () => down.clear();
  target.addEventListener('keydown', kd);
  target.addEventListener('keyup', ku);
  target.addEventListener('blur', clear);
  return () => {
    target.removeEventListener('keydown', kd);
    target.removeEventListener('keyup', ku);
    target.removeEventListener('blur', clear);
  };
}

/** Call once per fixed update, before game logic reads input. */
export function pollInput(): void {
  prev = curr;
  curr = new Set(down);
  anyPressedThisFrame = anyQueued;
  anyQueued = false;
}

export function isPressed(a: Action): boolean {
  if (a === 'any') return curr.size > 0;
  return BINDINGS[a].some((k) => curr.has(k));
}
export function isFirstPress(a: Action): boolean {
  if (a === 'any') return anyPressedThisFrame;
  return BINDINGS[a].some((k) => curr.has(k) && !prev.has(k));
}
export function keyPressed(code: string): boolean {
  return curr.has(code) && !prev.has(code);
}
