// Estado por jugador del coop. En el juego original hay un solo héroe y su energía/power-ups viven en HeroState;
// en coop cada amigo tiene su propia energía, power-up, vidas y controles, así que esos datos se separan acá.
import { isFirstPress, isPressed } from '../core/input';
import { MAX_ENERGY, START_LIVES } from './state';

export interface PlayerInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  jump: boolean;
  /** flanco de subida en este cuadro (disparar / saltar) */
  firePressed: boolean;
  jumpPressed: boolean;
}

export const emptyInput = (): PlayerInput => ({
  left: false, right: false, up: false, down: false, fire: false, jump: false, firePressed: false, jumpPressed: false,
});

/** Bits que viajan por la red: left 1, right 2, up 4, down 8, fire 16, jump 32. */
export function inputFromBits(bits: number, prev: number): PlayerInput {
  const held = (bit: number) => (bits & bit) !== 0;
  const was = (bit: number) => (prev & bit) !== 0;
  return {
    left: held(1), right: held(2), up: held(4), down: held(8), fire: held(16), jump: held(32),
    firePressed: held(16) && !was(16), jumpPressed: held(32) && !was(32),
  };
}

export function bitsOf(i: PlayerInput): number {
  return (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.up ? 4 : 0) | (i.down ? 8 : 0) | (i.fire ? 16 : 0) | (i.jump ? 32 : 0);
}

/** Lee el teclado (o el táctil, que despacha las mismas teclas) para el jugador local. */
export function readLocalInput(): PlayerInput {
  return {
    left: isPressed('left'), right: isPressed('right'), up: isPressed('up'), down: isPressed('down'),
    fire: isPressed('fire'), jump: isPressed('jumpHold') || isPressed('jumpTap'),
    firePressed: isFirstPress('fire'), jumpPressed: isFirstPress('jumpHold') || isFirstPress('jumpTap'),
  };
}

export class PlayerRuntime {
  /** energía (0..MAX_ENERGY) */
  energy = MAX_ENERGY;
  power: string | null = null;
  powerT = 0;
  /** saltos dobles recogidos (0/1) */
  cereals = 0;
  /** potenciadores de salto recogidos (índice en VELOCITY_JUMP) */
  heros = 0;
  lives = START_LIVES;
  /** se quedó sin vidas: espera al próximo SavePoint (o al final del nivel si estamos todos así) */
  eliminated = false;
  /** coop: salió del nivel (a la pantalla online) o mira como espectador: no juega ni se dibuja; al volver recupera
   *  si estaba eliminado (awayElim) */
  away = false;
  awayElim = false;
  /** puntos de este jugador en el nivel (coop: cada uno suma los suyos) */
  score = 0;
  input: PlayerInput = emptyInput();
  /** último paquete de bits recibido (invitado) y secuencia */
  bits = 0;
  q = -1;
  /** true = sin tinte: el Xa de este jugador se dibuja con sus colores originales (el anfitrión) */
  plain = false;
  /** héroe de este jugador (lo asigna el escenario) */
  hero!: import('./hero').Hero;
  /** puesto en el HUD/mundo */
  constructor(
    public id: number,
    public name: string,
    public hex: string | null,
    public local: boolean,
  ) {}

  setPower(kind: string, seconds: number): void { this.power = kind; this.powerT = seconds; }
  clearPower(): void { this.power = null; this.powerT = 0; }

  resetForLevel(lives: number): void {
    this.energy = MAX_ENERGY;
    this.power = null;
    this.powerT = 0;
    this.cereals = 0;
    this.heros = 0;
    this.lives = lives;
    this.eliminated = false;
    this.score = 0;
    this.input = emptyInput();
    this.bits = 0;
    this.q = -1;
  }
}
