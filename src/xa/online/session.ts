// Estado del modo online para la interfaz (React) y puente con el juego. Una sola sesión por pestaña:
//   menú -> crear/unirse -> lobby (listo, votos, nivel) -> partida -> lobby
// El anfitrión corre el mundo; los invitados mandan controles y reciben instantáneas. Ver world/world.ts.
import { MAX_PLAYERS, backend, colorHex } from './config';
import { NetClient, NetError, checkRoom, createRoom, forgetSession, getHostKey, serverInfo, setHostKey, storedSession, type StoredSession } from './net';
import { P2P, fetchIceServers } from './p2p';
import type { Difficulty, RoomView, ServerMessage, Snap } from './types';

export type Phase = 'menu' | 'connecting' | 'lobby' | 'playing' | 'error';

export interface OnlineState {
  enabled: boolean;
  phase: Phase;
  error: string;
  /** código de la sala (vacío si todavía no hay) */
  code: string;
  /** apodo recordado en esta pestaña */
  name: string;
  you: number;
  host: boolean;
  room: RoomView | null;
  /** hay una sesión guardada a la que se puede volver */
  canResume: boolean;
  link: 'ok' | 'lost';
  rtt: number;
  direct: boolean;
  level: number;
  difficulty: Difficulty | null;
  settings: { powerups: boolean };
  max: number;
  colors: string[];
}

export interface GameHooks {
  /** empezó una partida: cargar el nivel y arrancar (o esperar instantáneas si somos invitados) */
  start?: (level: number, difficulty: Difficulty, settings: { powerups: boolean }, room: RoomView) => void;
  /** la partida terminó (el anfitrión la cerró o se perdió) */
  ended?: (why: unknown) => void;
  /** volver al menú principal */
  exit?: () => void;
  /** abrir el selector de niveles del juego para elegir/votar (anfitrión elige, invitados votan) */
  pick?: () => void;
  /** controles de un invitado (solo anfitrión) */
  input?: (from: number, b: number, q: number) => void;
  /** instantánea del mundo (solo invitados) */
  snap?: (s: Snap) => void;
}

const NAME_KEY = 'xa-online-name';

function storedName(): string {
  try { return (localStorage.getItem(NAME_KEY) ?? '').slice(0, 10); } catch { return ''; }
}

export class OnlineSession {
  private listeners = new Set<() => void>();
  private net = new NetClient();
  private p2p: P2P | null = null;
  private hooks: GameHooks = {};
  private ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  private lastQ = new Map<number, number>();
  private lastSnapN = -1;
  private snapSeq = 0;
  private offNet: (() => void) | null = null;
  private state: OnlineState;

  constructor() {
    this.state = {
      enabled: backend.enabled,
      phase: 'menu',
      error: '',
      code: '',
      name: storedName(),
      you: -1,
      host: false,
      room: null,
      canResume: !!storedSession(),
      link: 'ok',
      rtt: 0,
      direct: false,
      level: 0,
      difficulty: null,
      settings: { powerups: true },
      max: MAX_PLAYERS,
      colors: Array.from({ length: 8 }, (_, i) => colorHex(i)),
    };
  }

  // ---------------------------------------------------------------- store para React
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getState = (): OnlineState => this.state;
  private set(patch: Partial<OnlineState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  setHooks(h: GameHooks): void { this.hooks = h; }

  /** Entra a la pantalla ONLINE del menú. */
  enter(): void {
    if (!backend.enabled) { this.set({ enabled: false, phase: 'error', error: 'Este build no tiene servidor online configurado.' }); return; }
    this.set({ phase: this.state.room ? 'lobby' : 'menu', error: '', canResume: !!storedSession() });
  }

  setName(name: string): void {
    const clean = name.replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 10);
    try { localStorage.setItem(NAME_KEY, clean); } catch { /* almacenamiento bloqueado */ }
    this.set({ name: clean });
  }

  /** Crea una sala y entra como anfitrión. */
  async create(): Promise<void> {
    if (!backend.enabled) return;
    if (!this.state.name) { this.set({ error: 'Elegí un nombre primero.' }); return; }
    this.set({ phase: 'connecting', error: '' });
    try {
      await serverInfo().catch(() => null);
      const r = await createRoom();
      setHostKey(r.hostKey);
      this.set({ code: r.code, max: r.max });
      await this.connect(r.code, getHostKey());
    } catch (e) {
      this.fail(e);
    }
  }

  /** Entra a una sala existente con el código. */
  async join(codeRaw: string): Promise<void> {
    if (!backend.enabled) return;
    const code = codeRaw.trim().toUpperCase();
    if (code.length !== 5) { this.set({ error: 'El código tiene 5 caracteres.' }); return; }
    if (!this.state.name) { this.set({ error: 'Elegí un nombre primero.' }); return; }
    this.set({ phase: 'connecting', error: '', code });
    try {
      const info = await serverInfo().catch(() => null);
      if (info) {
        this.ice = info.iceServers?.length ? info.iceServers : this.ice;
        this.set({ colors: info.colors.map((c) => c.hex), max: info.limits?.coop ?? MAX_PLAYERS });
      }
      const chk = await checkRoom(code);
      if (!chk.joinable) throw new NetError(chk.status === 'playing' ? 'started' : 'full', chk.status === 'playing' ? 'La partida ya empezó.' : 'La sala está llena.');
      await this.connect(code);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Vuelve al asiento que quedó guardado (recarga de página o corte). */
  async resume(): Promise<void> {
    const s: StoredSession | null = storedSession();
    if (!s) { this.set({ canResume: false, error: 'No hay una sesión para recuperar.' }); return; }
    this.set({ phase: 'connecting', error: '', code: s.code });
    try {
      await serverInfo().catch(() => null);
      const room = await this.net.resume(s);
      this.attach();
      this.applyRoom(room);
      this.set({ phase: room.status === 'playing' ? 'playing' : 'lobby', you: this.net.you, host: this.net.isHost });
      if (room.status === 'playing') this.startFromRoom(room);
    } catch (e) {
      forgetSession();
      this.fail(e);
    }
  }

  private async connect(code: string, key?: string): Promise<void> {
    const room = await this.net.connect(code, this.state.name, key);
    this.attach();
    this.applyRoom(room);
    this.set({ phase: room.status === 'playing' ? 'playing' : 'lobby', error: '', you: this.net.you, host: this.net.isHost });
    // si ya estaba en partida (reconexión), el servidor no reenvía `start`: lo reconstruimos del lobby
    if (room.status === 'playing') this.startFromRoom(room);
  }

  private attach(): void {
    this.offNet?.();
    this.offNet = this.net.on((m) => this.onMessage(m));
  }

  private applyRoom(room: RoomView): void {
    this.set({
      room, code: room.code, level: room.level, settings: room.settings,
      you: this.net.you, host: this.net.isHost, canResume: true,
    });
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'joined': {
        this.net.you = m.you;
        this.net.isHost = m.host;
        this.applyRoom(m.room);
        this.set({ phase: 'lobby', error: '', canResume: true });
        break;
      }
      case 'room': {
        this.applyRoom(m.room);
        if (m.room.status === 'lobby' && this.state.phase === 'playing') {
          this.finishMatch({ aborted: true });
        }
        break;
      }
      case 'start': {
        this.net.you = m.you;
        this.applyRoom(m.room);
        this.set({ phase: 'playing', level: m.level, difficulty: m.difficulty, settings: m.room.settings });
        this.startFromRoom(m.room);
        break;
      }
      case 'in':
        if (m.d && typeof m.d.b === 'number') {
          const prev = this.lastQ.get(m.from) ?? -1;
          const q = m.d.q & 0xffff;
          // secuencia circular: aceptar si avanzó (más de la mitad del rango = mensaje viejo)
          if (prev < 0 || ((q - prev) & 0xffff) < 0x8000) {
            this.lastQ.set(m.from, q);
            this.hooks.input?.(m.from, m.d.b, q);
          }
        }
        break;
      case 'snap':
        if (m.d && this.acceptSnap(m.d)) this.hooks.snap?.(m.d);
        break;
      case 'ended':
        this.finishMatch(m.d);
        break;
      case 'left':
        break;
      case 'peer':
      case 'pong':
        break;
      case 'rtc':
        break;
      case 'kicked':
        this.closeLocal('Te sacaron de la sala.');
        break;
      case 'replaced':
        this.closeLocal('Entraste desde otra pestaña.');
        break;
      case 'closed':
        this.closeLocal(m.reason === 'host_left' ? 'El anfitrión cerró la sala.' : m.reason === 'idle' ? 'La sala se cerró por inactividad.' : 'Se perdió la conexión con la sala.');
        break;
      case 'error':
        this.set({ error: m.msg, phase: this.state.phase === 'playing' ? 'playing' : 'lobby' });
        break;
      case 'link':
        this.set({ link: m.state === 'back' ? 'ok' : 'lost' });
        break;
    }
  }

  /** Descarta instantáneas repetidas o viejas (pueden llegar por WebRTC y por el relé a la vez). */
  private acceptSnap(s: Snap): boolean {
    if (typeof s.n !== 'number') return true;
    if (s.n <= this.lastSnapN && this.lastSnapN - s.n < 0x40000000) return false;
    this.lastSnapN = s.n;
    return true;
  }

  private startFromRoom(room: RoomView): void {
    this.lastQ.clear();
    this.lastSnapN = -1;
    this.snapSeq = 0;
    this.teardownP2P();
    if (room.hostId === null) return;
    const guests = room.players.filter((p) => p.id !== this.net.you && p.online).map((p) => p.id);
    this.p2p = new P2P({
      net: this.net, me: this.net.you, hostId: room.hostId, guests, iceServers: this.ice,
      onInput: (from, d) => {
        const prev = this.lastQ.get(from) ?? -1;
        const q = d.q & 0xffff;
        if (prev < 0 || ((q - prev) & 0xffff) < 0x8000) { this.lastQ.set(from, q); this.hooks.input?.(from, d.b, q); }
      },
      onSnap: (d) => this.hooks.snap?.(d as Snap),
    });
    this.hooks.start?.(room.level, room.difficulty, room.settings, room);
  }

  private finishMatch(why: unknown): void {
    if (this.state.phase !== 'playing') return;
    this.teardownP2P();
    this.lastQ.clear();
    this.set({ phase: 'lobby', difficulty: null });
    this.hooks.ended?.(why);
  }

  private teardownP2P(): void { this.p2p?.close(); this.p2p = null; }

  private fail(e: unknown): void {
    const msg = e instanceof NetError ? e.message : e instanceof Error ? e.message : String(e);
    this.set({ phase: 'error', error: msg });
  }

  private closeLocal(message: string): void {
    this.teardownP2P();
    this.lastQ.clear();
    this.offNet?.();
    this.offNet = null;
    this.net.close(true);
    setHostKey(undefined);
    this.set({ phase: 'menu', room: null, code: '', you: -1, host: false, canResume: false, error: message, difficulty: null });
    this.hooks.exit?.();
  }

  // ---------------------------------------------------------------- acciones del lobby
  setReady(ready: boolean): void { this.net.send({ t: 'ready', ready }); }
  vote(level: number): void { this.net.send({ t: 'vote', level }); }
  setLevel(level: number): void { this.net.send({ t: 'level', level }); }
  setPowerups(on: boolean): void { this.net.send({ t: 'settings', powerups: on }); }
  kick(id: number): void { this.net.send({ t: 'kick', id }); }
  start(): void { this.net.send({ t: 'start' }); }

  /** Abre el selector de niveles del juego (anfitrión elige, invitados votan). */
  pickLevel(): void { this.hooks.pick?.(); }
  backToMenu(): void {
    if (this.state.phase === 'playing') this.net.send({ t: 'end', d: { manual: true } });
    if (this.state.room) this.net.send({ t: 'leave' });
    this.teardownP2P();
    this.offNet?.();
    this.offNet = null;
    this.net.close(true);
    setHostKey(undefined);
    this.set({ phase: 'menu', room: null, code: '', you: -1, host: false, error: '', difficulty: null, canResume: false });
    this.hooks.exit?.();
  }

  // ---------------------------------------------------------------- partida
  /** Invitado: manda sus controles (bits + secuencia). */
  sendInput(b: number, q: number): void {
    if (this.state.phase !== 'playing' || this.state.host) return;
    if (!this.p2p?.sendInput({ b, q })) this.net.send({ t: 'in', d: { b, q } });
  }

  /** Anfitrión: manda la instantánea del mundo. Si alguien no tiene enlace directo, también va por el relé. */
  sendSnapshot(s: Snap): void {
    if (!this.state.host) return;
    s.n = ++this.snapSeq;
    const json = JSON.stringify({ t: 'snap', d: s });
    const direct = this.p2p?.sendSnap(json) ?? 0;
    const guests = this.state.room?.players.filter((p) => p.id !== this.state.you && p.online).length ?? 0;
    if (direct < guests) this.net.send({ t: 'snap', d: s });
  }

  /** Anfitrión: última instantánea con el cartel de fin de nivel / derrota (los invitados muestran su pantalla). */
  sendEndSnap(kind: 'win' | 'over'): void {
    if (!this.state.host) return;
    const d = { v: 1, n: ++this.snapSeq, end: kind === 'win' ? 1 : 2 } as unknown as Snap;
    this.net.send({ t: 'snap', d });
    this.p2p?.sendSnap(JSON.stringify({ t: 'snap', d }));
  }

  /** Anfitrión: la partida terminó (nivel completo o derrota): todos vuelven al lobby. */
  endMatch(): void {
    if (!this.state.host) return;
    this.net.send({ t: 'end', d: { done: true } });
  }

  /** Ping mostrado en el lobby durante la partida. */
  tick(): void {
    const p2pRtt = this.state.host ? this.p2p?.worstRtt() ?? 0 : this.p2p?.rtt() ?? 0;
    const rtt = p2pRtt || this.net.rtt;
    const direct = this.state.host ? !!this.p2p?.allOpen() : !!this.p2p?.hostLinkOpen;
    if (rtt !== this.state.rtt || direct !== this.state.direct) this.set({ rtt, direct });
  }

  /** ¿La sala tiene a todos listos? (el servidor lo vuelve a comprobar al empezar) */
  canStart(): boolean {
    const r = this.state.room;
    if (!r || !this.state.host) return false;
    return r.players.every((p) => p.ready && p.online) && r.level > 0 && r.status === 'lobby';
  }

  /** Nombre y color del jugador `id` (para el HUD y el mundo). */
  playerInfo(id: number): { name: string; hex: string; host: boolean } {
    const p = this.state.room?.players.find((x) => x.id === id);
    return { name: p?.name ?? 'Xa', hex: this.state.colors[p?.color ?? 0] ?? colorHex(p?.color ?? 0), host: !!p?.host };
  }
}

/** Una sesión por pestaña (la comparten el juego y el panel de React). */
export const online = new OnlineSession();
