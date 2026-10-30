// Tipos compartidos entre el cliente y el backend (xa-backend/src/game.ts y rooms.ts).
export interface Difficulty {
  players: number;
  hp: number;
  count: number;
  boss: number;
  soloGraceSeconds: number;
  soloRampPerSecond: number;
  soloCap: number;
}

export interface RoomPlayer {
  id: number;
  name: string;
  color: number;
  ready: boolean;
  host: boolean;
  online: boolean;
}

/** Estado de los menús del anfitrión que ven los demás (mirror). */
export interface MenuState {
  /** pantalla: lobby (panel), menu (menú principal u opciones/ayuda/créditos) o levels (mapa de niveles) */
  s: 'lobby' | 'menu' | 'levels';
  /** botón elegido del menú principal (-1 = ninguno) */
  i: number;
  /** mapa: 0 = original, 1 = mapa 2 (extra) */
  p: number;
  /** nodo elegido en el mapa */
  l: number;
  /** niveles completados del anfitrión (1..16 y 101..116): define cuáles se pueden elegir */
  d: number[];
  /** niveles perfectos del anfitrión */
  f: number[];
}

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing';
  /** lobby = armando la sala; browse = el anfitrión dijo "todo listo" y recorre los menús */
  stage?: 'lobby' | 'browse';
  hostId: number | null;
  max: number;
  settings: { powerups: boolean };
  level: number;
  votes: { id: number; level: number }[];
  players: RoomPlayer[];
  difficulty: Difficulty;
}

export interface ServerInfo {
  name: string;
  protocol: number;
  mode: string;
  colors: { name: string; hex: string }[];
  limits: { coop: number };
  reconnectGraceSeconds: number;
  iceServers: RTCIceServer[];
  difficulty: Omit<Difficulty, 'players' | 'hp' | 'count' | 'boss'>;
}

export type ServerMessage =
  | { t: 'joined'; you: number; host: boolean; sid: string; resumed: boolean; claimed: boolean; room: RoomView }
  | { t: 'room'; room: RoomView }
  | { t: 'menu'; d: MenuState }
  | { t: 'start'; room: RoomView; difficulty: Difficulty; level: number; you: number }
  | { t: 'in'; from: number; d: { b: number; q: number } }
  | { t: 'snap'; d: Snap }
  | { t: 'ended'; d: unknown }
  | { t: 'left'; id: number }
  | { t: 'peer'; id: number; online: boolean }
  | { t: 'rtc'; from: number; d: { k: string; s?: string; c?: RTCIceCandidateInit } }
  | { t: 'kicked' }
  | { t: 'replaced' }
  | { t: 'closed'; reason: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'pong'; n: number }
  | { t: 'link'; state: 'lost' | 'back' };

/** Instantánea del mundo que manda el anfitrión (claves cortas: viaja muchas veces por segundo). */
export interface Snap {
  /** versión del formato */
  v: number;
  /** número de secuencia (el invitado descarta repetidas del relé) */
  n: number;
  /** jugadores: id, x, y, dir, estado, animación, frame, tiempo de animación, energía, power, powerT, vidas, viva, eliminada, cereales (doble salto), potenciadores de salto, puntos propios */
  p: [number, number, number, number, number, string, number, number, number, string | null, number, number, number, number, number, number, number?][];
  /** enemigos: id, x, y, dir, vidas, animación, frame, tiempo, flash */
  e: [number, number, number, number, number, string, number, number, number][];
  /** enemigos que murieron hace poco: el invitado los borra */
  k?: number[];
  /** balas: x, y, vx, vy, equipo, tinte, grande, gravedad, aceleración en x */
  b: [number, number, number, number, number, string | null, number, number, number][];
  /** efectos: animación, x, y, dir, tiempo */
  f: [string, number, number, number, number][];
  /** cosas (items, vacas, savepoints): índice, x, y, vivo, rescate, animación, tiempo */
  i: [number, number, number, number, number, string, number][];
  /** cámara (solo informativa: cada jugador sigue a su propio héroe) */
  c: [number, number];
  /** estado compartido: puntos, monedas, vacas, vacas totales, keysHud, teclas */
  s: [number, number, number, number, number, string[]];
  /** 1 = nivel terminado, 2 = partida perdida */
  end?: number;
  /** mensaje del HUD vigente: texto y segundos */
  m?: [string, number];
  /** guardando (segundos restantes) */
  g?: number;
  /** dificultad en vivo (castigo por estar solo) */
  d: number;
  /** música del nivel, si cambió */
  mu?: string;
  /** efectos de sonido replicados: "secuencia|id|x|y" (x,y vacíos = global). Cada sonido viaja ~0.4 s en varias
   *  instantáneas (el canal directo pierde paquetes) y el invitado descarta las secuencias ya oídas. */
  a?: string[];
  /** puntos flotantes: valor, x, y, tiempo */
  pf?: [number, number, number, number][];
  /** plataformas móviles: x, y (mismo orden que en el nivel) */
  pl?: [number, number][];
  /** puertas: 1 = abierta (mismo orden que en el nivel) */
  dr?: number[];
  /** 1 = el anfitrión está en pausa (el mundo está quieto) */
  ps?: number;
  /** 1 = no queda nadie vivo: la música está cortada */
  ms?: number;
  /** castigo por ir muy adelantado: id del jugador que lidera la delantera (ausente = ninguno) */
  ah?: number;
  /** enemigos que aparecieron después de cargar el nivel (ayudantes de los jefes): id, tipo, x, y, props */
  ne?: [number, string, number, number, Record<string, string>][];
  /** objetos que aparecieron después (ítems de curación de los jefes): índice, asset, x, y, cantidad */
  ni?: [number, string, number, number, number][];
}
