// Enlaces directos entre el anfitrión y cada invitado (canales de datos de WebRTC). El servidor solo presenta: reenvía
// la oferta, la respuesta y los candidatos ICE ("rtc"). Con el enlace abierto, los controles y las instantáneas viajan
// de navegador a navegador y el retraso baja al ping directo. Si no se puede (NAT estricto, red móvil) o se corta, todo
// sigue por el relé del servidor sin que el jugador haga nada.
import { backend } from './config';
import type { NetClient } from './net';
import type { ServerMessage } from './types';

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await fetch(backend.http + '/api/info', { headers: { 'x-xa-token': backend.token } });
    const j = (await r.json()) as { iceServers?: RTCIceServer[] };
    if (Array.isArray(j.iceServers) && j.iceServers.length) return j.iceServers;
  } catch { /* sin servidor: STUN público */ }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

interface Link {
  id: number;
  pc: RTCPeerConnection;
  snap: RTCDataChannel | null;
  inp: RTCDataChannel | null;
  open: boolean;
  rtt: number;
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  tries: number;
}

export interface P2POptions {
  net: NetClient;
  me: number;
  hostId: number;
  guests: number[];
  iceServers: RTCIceServer[];
  /** anfitrión: llegó el estado de los controles de un invitado */
  onInput?: (from: number, d: { b: number; q: number }) => void;
  /** invitado: llegó una instantánea del mundo */
  onSnap?: (d: unknown) => void;
}

export class P2P {
  private links = new Map<number, Link>();
  private off: () => void;
  private pingTimer = 0;
  private closed = false;
  readonly isHost: boolean;

  constructor(private o: P2POptions) {
    this.isHost = o.me === o.hostId;
    this.off = o.net.on((m: ServerMessage) => { if (m.t === 'rtc') void this.signal(m.from, m.d); });
    if (typeof RTCPeerConnection === 'undefined') { this.closed = true; return; }
    if (!this.isHost) this.connectToHost();
    this.pingTimer = window.setInterval(() => this.ping(), 1000);
  }

  /** anfitrión: todos los invitados tienen enlace directo abierto */
  allOpen(): boolean {
    if (!this.isHost || this.closed) return false;
    return this.o.guests.every((g) => this.links.get(g)?.open);
  }
  /** invitado: el enlace con el anfitrión está abierto */
  get hostLinkOpen(): boolean { return !this.isHost && !!this.links.get(this.o.hostId)?.open; }
  rtt(id?: number): number {
    const l = this.links.get(id ?? (this.isHost ? -1 : this.o.hostId));
    return l?.open ? l.rtt : 0;
  }
  worstRtt(): number { let w = 0; for (const l of this.links.values()) if (l.open) w = Math.max(w, l.rtt); return w; }

  /** anfitrión: manda la instantánea (ya serializada) a los invitados con enlace directo. Devuelve cuántos la recibieron. */
  sendSnap(json: string): number {
    let n = 0;
    for (const l of this.links.values()) {
      if (l.open && l.snap && l.snap.readyState === 'open' && l.snap.bufferedAmount < 64 * 1024) { l.snap.send(json); n++; }
    }
    return n;
  }
  /** invitado: controles al anfitrión. false = sin enlace directo, usar el relé. */
  sendInput(d: { b: number; q: number }): boolean {
    const l = this.links.get(this.o.hostId);
    if (!l?.open || !l.inp || l.inp.readyState !== 'open') return false;
    l.inp.send(JSON.stringify({ t: 'in', d }));
    return true;
  }

  private newLink(id: number): Link {
    const pc = new RTCPeerConnection({ iceServers: this.o.iceServers });
    const link: Link = { id, pc, snap: null, inp: null, open: false, rtt: 0, pending: [], remoteSet: false, tries: 0 };
    this.links.set(id, link);
    pc.onicecandidate = (e) => { if (e.candidate) this.sig(id, { k: 'ice', c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        link.open = false;
        if (!this.isHost && !this.closed && link.tries < 3 && s !== 'closed') {
          const old = link.pc;
          window.setTimeout(() => {
            if (!this.closed && !this.links.get(id)?.open) {
              try { old.close(); } catch { /* ya cerrado */ }
              this.connectToHost(link.tries + 1);
            }
          }, 4000);
        }
      }
    };
    return link;
  }

  private bind(link: Link, ch: RTCDataChannel): void {
    if (ch.label === 'snap') link.snap = ch; else link.inp = ch;
    ch.onopen = () => { link.open = !!(link.snap?.readyState === 'open' && link.inp?.readyState === 'open'); };
    ch.onclose = () => { link.open = false; };
    ch.onmessage = (ev) => {
      let m: { t: string; d?: unknown; n?: number; pg?: number };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'snap') this.o.onSnap?.(m.d ?? m);
      else if (m.t === 'in') this.o.onInput?.(link.id, m.d as { b: number; q: number });
      else if (m.t === 'ping' && this.isHost) { link.rtt = Math.round(m.pg ?? 0); if (link.inp?.readyState === 'open') link.inp.send(JSON.stringify({ t: 'pong', n: m.n })); }
      else if (m.t === 'pong') link.rtt = Math.round(performance.now() - (m.n ?? performance.now()));
    };
  }

  private connectToHost(tries = 0): void {
    if (this.closed) return;
    const link = this.newLink(this.o.hostId);
    link.tries = tries;
    // instantáneas: solo importa la última (sin retransmisión ni orden); controles: fiables y en orden
    this.bind(link, link.pc.createDataChannel('snap', { ordered: false, maxRetransmits: 0 }));
    this.bind(link, link.pc.createDataChannel('in', { ordered: true }));
    window.setTimeout(() => {
      if (!this.closed && this.links.get(this.o.hostId) === link && !link.open && link.tries < 3) {
        try { link.pc.close(); } catch { /* ya cerrado */ }
        this.connectToHost(link.tries + 1);
      }
    }, 7000);
    void (async () => {
      try {
        await link.pc.setLocalDescription(await link.pc.createOffer());
        this.sig(this.o.hostId, { k: 'offer', s: link.pc.localDescription?.sdp ?? '' });
      } catch { /* sin enlace directo: queda el relé */ }
    })();
  }

  private async signal(from: number, d: { k: string; s?: string; c?: RTCIceCandidateInit }): Promise<void> {
    if (this.closed) return;
    try {
      if (d.k === 'offer' && this.isHost && d.s) {
        const old = this.links.get(from);
        if (old) { try { old.pc.close(); } catch { /* ya cerrado */ } }
        const link = this.newLink(from);
        link.pc.ondatachannel = (e) => this.bind(link, e.channel);
        await link.pc.setRemoteDescription({ type: 'offer', sdp: d.s });
        link.remoteSet = true;
        for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c).catch(() => undefined);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        this.sig(from, { k: 'answer', s: link.pc.localDescription?.sdp ?? '' });
      } else if (d.k === 'answer' && !this.isHost && d.s) {
        const link = this.links.get(from);
        if (!link) return;
        await link.pc.setRemoteDescription({ type: 'answer', sdp: d.s });
        link.remoteSet = true;
        for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c).catch(() => undefined);
      } else if (d.k === 'ice' && d.c) {
        const link = this.links.get(from);
        if (!link) return;
        if (link.remoteSet) await link.pc.addIceCandidate(d.c).catch(() => undefined); else link.pending.push(d.c);
      }
    } catch { /* una negociación fallida deja el relé a cargo */ }
  }

  private sig(to: number, d: { k: string; s?: string; c?: RTCIceCandidateInit }): void { this.o.net.send({ t: 'rtc', to, d }); }

  private ping(): void {
    if (this.isHost) return;
    const l = this.links.get(this.o.hostId);
    if (l?.open && l.inp?.readyState === 'open') l.inp.send(JSON.stringify({ t: 'ping', n: performance.now(), pg: l.rtt }));
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.off();
    for (const l of this.links.values()) { l.open = false; try { l.pc.close(); } catch { /* ya cerrado */ } }
    this.links.clear();
  }
}
