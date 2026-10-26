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

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing';
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
  /** jugadores: id, x, y, dir, estado, animación, frame, tiempo de animación, energía, power, powerT, vidas, viva, eliminada */
  p: [number, number, number, number, number, string, number, number, number, string | null, number, number, number, number][];
  /** enemigos: id, x, y, dir, vidas, animación, frame, tiempo, flash */
  e: [number, number, number, number, number, string, number, number, number][];
  /** enemigos que murieron hace poco: el invitado los borra */
  k?: number[];
  /** balas: x, y, vx, vy, equipo, tinte, grande */
  b: [number, number, number, number, number, string | null, number][];
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
  /** enemigos que aparecieron después de cargar el nivel (ayudantes de los jefes): id, tipo, x, y, props */
  ne?: [number, string, number, number, Record<string, string>][];
  /** objetos que aparecieron después (ítems de curación de los jefes): índice, asset, x, y, cantidad */
  ni?: [number, string, number, number, number][];
}
