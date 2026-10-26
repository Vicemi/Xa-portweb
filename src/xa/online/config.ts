// Configuración del modo online. El backend es un servidor de salas y retransmisión (xa-backend): el anfitrión simula
// el mundo y los invitados mandan sus controles. Si las variables PUBLIC_* no están definidas, el botón ONLINE avisa
// que este build no tiene servidor y el resto del juego sigue funcionando igual.
const env = import.meta.env as unknown as Record<string, string | undefined>;

const rawUrl = (env.PUBLIC_XA_BACKEND_URL ?? '').trim();
const token = (env.PUBLIC_XA_BACKEND_TOKEN ?? '').trim();

export const backend = {
  http: rawUrl.replace(/\/+$/, ''),
  ws: rawUrl.replace(/\/+$/, '').replace(/^http/i, 'ws') + '/ws',
  token,
  enabled: !!rawUrl && !!token,
};

/** Tope de jugadores del coop. */
export const MAX_PLAYERS = 4;

/** Paleta de respaldo: la misma del servidor (src/game.ts de xa-backend), por si /api/info no responde. */
export const FALLBACK_COLORS = [
  { name: 'Violeta', hex: '#a855f7' },
  { name: 'Naranja', hex: '#ff8a2b' },
  { name: 'Rosa', hex: '#ff5ec4' },
  { name: 'Azul', hex: '#4f7dff' },
  { name: 'Blanco', hex: '#f4f0e6' },
  { name: 'Marrón', hex: '#c08a4a' },
  { name: 'Magenta', hex: '#e040a0' },
  { name: 'Turquesa', hex: '#20c9a0' },
] as const;

export const colorHex = (i: number): string => (FALLBACK_COLORS[i] ?? FALLBACK_COLORS[0]).hex;
