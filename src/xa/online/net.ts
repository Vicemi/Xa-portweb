// Cliente HTTP + WebSocket de xa-backend. El lobby viaja por el socket; una vez que empieza la partida, los controles
// de los invitados ("in") y las instantáneas del anfitrión ("snap") se reenvían por el servidor (o por WebRTC, ver p2p.ts).
//
// Sesiones: al entrar se recibe un identificador secreto que se guarda en sessionStorage. Si la conexión se corta o se
// recarga la página, se vuelve al mismo asiento con `resume` mientras el servidor lo conserve.
import { backend } from './config';
import type { RoomView, ServerInfo, ServerMessage } from './types';

export class NetError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const ERRORS: Record<string, string> = {
  offline: 'No se pudo conectar con el servidor.',
  unauthorized: 'El servidor rechazó la clave del juego (PUBLIC_XA_BACKEND_TOKEN).',
  forbidden_origin: 'Este sitio no está permitido en el servidor (ALLOWED_ORIGINS).',
  rate_limited: 'Demasiados intentos, esperá un momento.',
  blocked: 'Demasiados intentos fallidos: esperá unos minutos.',
  not_found: 'No existe una sala con ese código.',
  full: 'La sala está llena (son 4 jugadores como máximo).',
  started: 'La partida ya empezó y no hay un asiento libre con tu nombre.',
  bad_key: 'La clave de anfitrión no es válida.',
  forbidden: 'Esa acción es solo del anfitrión.',
  limit: 'El servidor está lleno, probá más tarde.',
  bad_session: 'La sesión venció.',
  banned: 'El anfitrión te sacó de esta sala.',
  no_level: 'El anfitrión todavía no eligió un nivel.',
  taken: 'Ese color ya lo tiene otro jugador.',
  invalid: 'El servidor rechazó el pedido.',
  invalid_request: 'Pedido inválido.',
};
export const errorText = (code: string, fallback = 'Error de conexión'): string => ERRORS[code] ?? fallback;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(backend.http + path, { ...init, headers: { 'content-type': 'application/json', 'x-xa-token': backend.token } });
  } catch {
    throw new NetError('offline', errorText('offline'));
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new NetError(data.error ?? `http_${r.status}`, errorText(data.error ?? '', `Error ${r.status}`));
  return data;
}

let infoCache: ServerInfo | null = null;
export async function serverInfo(): Promise<ServerInfo> {
  if (infoCache) return infoCache;
  infoCache = await api<ServerInfo>('/api/info');
  return infoCache;
}

/** Crea una sala. La clave de anfitrión es secreta y la usa después `join` para reclamar el asiento del anfitrión. */
export const createRoom = () => api<{ code: string; hostKey: string; max: number }>('/api/rooms', { method: 'POST', body: '{}' });
export const checkRoom = (code: string) =>
  api<{ code: string; status: string; players: number; max: number; joinable: boolean }>('/api/rooms/' + encodeURIComponent(code));

// ---------------------------------------------------------------- sesión guardada
const KEY = 'xa-online-session';
export interface StoredSession { code: string; sid: string; name: string; t: number }
const SESSION_MAX_AGE = 10 * 60 * 1000;

export function storedSession(): StoredSession | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as StoredSession | null;
    if (s && typeof s.code === 'string' && typeof s.sid === 'string' && Date.now() - s.t < SESSION_MAX_AGE) return s;
  } catch { /* almacenamiento bloqueado */ }
  return null;
}
const keepSession = (s: StoredSession) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* bloqueado */ } };
export const forgetSession = () => { try { sessionStorage.removeItem(KEY); } catch { /* bloqueado */ } };

/** La clave de anfitrión de la sala que creamos en esta pestaña (no se guarda en disco). */
let hostKey: string | undefined;
export const setHostKey = (k: string | undefined) => { hostKey = k; };
export const getHostKey = () => hostKey;

type Listener = (m: ServerMessage) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pingTimer = 0;
  private pingAt = 0;
  private lastPong = 0;
  private session: StoredSession | null = null;
  private manual = false;
  private retryTimer = 0;
  rtt = 0;
  you = -1;
  isHost = false;
  room: RoomView | null = null;
  connected = false;
  reconnecting = false;

  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(m: ServerMessage): void { for (const l of [...this.listeners]) l(m); }

  private open(first: Record<string, unknown>): Promise<RoomView> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(backend.ws, ['xa-v1', 'token.' + backend.token]);
      } catch {
        reject(new NetError('offline', errorText('offline')));
        return;
      }
      this.ws = ws;
      const fail = (e: NetError) => { if (!settled) { settled = true; reject(e); } };
      ws.onopen = () => {
        this.connected = true;
        this.lastPong = performance.now();
        ws.send(JSON.stringify(first));
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          if (performance.now() - this.lastPong > 7000) { this.forceReconnect(); return; }
          this.pingAt = performance.now();
          this.send({ t: 'ping', n: 1 });
        }, 2000);
      };
      ws.onmessage = (ev) => {
        let m: ServerMessage;
        try { m = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }
        if (m.t === 'pong') { this.lastPong = performance.now(); this.rtt = Math.round(this.lastPong - this.pingAt); return; }
        if (m.t === 'joined') {
          this.you = m.you; this.isHost = m.host; this.room = m.room;
          this.session = { code: m.room.code, sid: m.sid, name: m.room.players.find((p) => p.id === m.you)?.name ?? '', t: Date.now() };
          keepSession(this.session);
          if (!settled) { settled = true; resolve(m.room); }
        } else if (m.t === 'room' || m.t === 'start') {
          this.room = m.room;
          if (this.session) { this.session.t = Date.now(); keepSession(this.session); }
        } else if (m.t === 'error' && !settled) fail(new NetError(m.code, errorText(m.code, m.msg)));
        else if (m.t === 'closed' || m.t === 'kicked') { this.session = null; forgetSession(); this.manual = true; setHostKey(undefined); }
        this.emit(m);
      };
      ws.onerror = () => fail(new NetError('offline', errorText('offline')));
      ws.onclose = () => {
        this.connected = false;
        window.clearInterval(this.pingTimer);
        fail(new NetError('closed', 'La conexión se cerró.'));
        if (this.ws !== ws) return;
        if (this.session && !this.manual) this.reconnect();
        else if (!this.manual) this.emit({ t: 'closed', reason: 'disconnected' });
      };
    });
  }

  /** Abre el socket y entra a la sala. Resuelve cuando el servidor contesta `joined`. */
  connect(code: string, name: string, key?: string): Promise<RoomView> {
    this.close(false);
    this.manual = false;
    return this.open({ t: 'join', code, name, key });
  }

  /** Vuelve al asiento guardado (recarga de página). */
  resume(s: StoredSession): Promise<RoomView> {
    this.close(false);
    this.manual = false;
    this.session = s;
    return this.open({ t: 'resume', code: s.code, sid: s.sid });
  }

  forceReconnect(): void {
    if (!this.session || this.manual || this.reconnecting) return;
    const old = this.ws;
    this.ws = null;
    this.connected = false;
    window.clearInterval(this.pingTimer);
    if (old) { old.onclose = null; old.onerror = null; old.onmessage = null; try { old.close(); } catch { /* ya estaba cerrado */ } }
    this.reconnect();
  }

  private reconnect(): void {
    if (this.reconnecting || !this.session) return;
    this.reconnecting = true;
    this.emit({ t: 'link', state: 'lost' });
    const started = Date.now();
    let n = 0;
    const attempt = () => {
      const s = this.session;
      if (!s || this.manual) { this.reconnecting = false; return; }
      this.open({ t: 'resume', code: s.code, sid: s.sid }).then(() => {
        this.reconnecting = false;
        this.emit({ t: 'link', state: 'back' });
      }).catch((e: NetError) => {
        if (e.code === 'bad_session' || e.code === 'not_found' || e.code === 'banned' || Date.now() - started > 60_000) {
          this.reconnecting = false;
          this.session = null;
          forgetSession();
          this.manual = true;
          this.emit({ t: 'closed', reason: 'session_lost' });
          return;
        }
        this.retryTimer = window.setTimeout(attempt, Math.min(4000, 400 * 2 ** n++));
      });
    };
    attempt();
  }

  send(m: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(forget = true): void {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    this.manual = true;
    this.reconnecting = false;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (forget) { this.session = null; forgetSession(); }
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; try { ws.close(1000, 'bye'); } catch { /* ya estaba cerrado */ } }
  }
}
