// Prueba de protocolo del modo online contra un xa-backend local (sin navegador): anfitrión + invitados por WebSocket.
//   cd ../XA-Backend && PORT=8791 GAME_TOKEN=xa-local-test-token-12345678 ALLOWED_ORIGINS=http://localhost:4341 npm run dev
//   node tools/online-check.mjs        (variables: XA_HTTP, XA_WS, XA_TOKEN, XA_ORIGIN, XA_BACKEND_DIR)
// Verifica: color 0 del anfitrión, "todo listo" (go), espejo de menús, voto, nivel + start, límite de 4 y reingreso con el menú.
import { createRequire } from 'node:module';

const HTTP = process.env.XA_HTTP ?? 'http://127.0.0.1:8791';
const WSURL = process.env.XA_WS ?? HTTP.replace(/^http/, 'ws') + '/ws';
const TOKEN = process.env.XA_TOKEN ?? 'xa-local-test-token-12345678';
const ORIGIN = process.env.XA_ORIGIN ?? 'http://localhost:4341';
const BACKEND = process.env.XA_BACKEND_DIR ?? 'E:/Vicemi/Proyectos/XA-Backend';
const WebSocket = createRequire(BACKEND + '/package.json')('ws');

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor() {
    this.inbox = [];
    this.ws = new WebSocket(WSURL, ['xa-v1', 'token.' + TOKEN], { headers: { origin: ORIGIN } });
    this.ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString())));
    this.opened = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async wait(t, pred = () => true, ms = 2500) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.inbox.findIndex((m) => m.t === t && pred(m));
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(10);
    }
    throw new Error('timeout esperando ' + t);
  }
  async join(code, name, key) {
    await this.opened;
    this.send({ t: 'join', code, name, key });
    return this.wait('joined');
  }
}

try {
  const r = await fetch(HTTP + '/api/rooms', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'x-xa-token': TOKEN, origin: ORIGIN } });
  const created = await r.json();
  const host = new Client();
  const hj = await host.join(created.code, 'Hosty', created.hostKey);
  check(hj.room.players[0].color === 0, 'el anfitrión tiene el color 0 (original, sin tinte)');
  check(hj.room.stage === 'lobby', 'la sala empieza en la etapa lobby');

  const g1 = new Client();
  const g1j = await g1.join(created.code, 'Ana');
  check(g1j.room.players[1].color !== 0, 'el invitado recibe un color con tinte (no el 0)');

  host.send({ t: 'go', on: true });
  check((await host.wait('error')).code === 'not_ready', '"todo listo" se rechaza si falta alguien listo');
  g1.send({ t: 'ready', ready: true });
  await host.wait('room', (m) => m.room.players.every((p) => p.ready));
  g1.send({ t: 'go', on: true });
  check((await g1.wait('error')).code === 'forbidden', 'un invitado no puede dar "todo listo"');

  host.send({ t: 'go', on: true });
  const a = await host.wait('room', (m) => m.room.stage === 'browse');
  const b = await g1.wait('room', (m) => m.room.stage === 'browse');
  check(!!a && !!b, '"todo listo": los dos ven la etapa browse');

  const menu = { s: 'levels', i: 0, p: 0, l: 3, d: [1, 2], f: [1] };
  host.send({ t: 'menu', d: menu });
  const m = await g1.wait('menu');
  check(JSON.stringify(m.d) === JSON.stringify(menu), 'el menú del anfitrión llega igual al invitado');
  g1.send({ t: 'menu', d: { s: 'menu' } });
  await sleep(150);
  check(!host.inbox.some((x) => x.t === 'menu'), 'el menú de un invitado no se reenvía');

  g1.send({ t: 'vote', level: 3 });
  const v = await host.wait('room', (x) => x.room.votes.some((q) => q.id === 1 && q.level === 3));
  check(!!v, 'el voto del invitado llega al anfitrión');

  // un jugador que entra con los menús abiertos entra ya listo y recibe el último estado de menús
  const g2 = new Client();
  const g2j = await g2.join(created.code, 'Beto');
  check(g2j.room.players.find((p) => p.name === 'Beto').ready === true, 'quien entra con los menús abiertos entra listo');
  check(JSON.stringify((await g2.wait('menu')).d) === JSON.stringify(menu), 'el que entra recibe el último estado de menús');

  const g3 = new Client();
  await g3.join(created.code, 'Cata');
  const g4 = new Client(); await g4.opened;
  g4.send({ t: 'join', code: created.code, name: 'Dani' });
  check((await g4.wait('error')).code === 'full', 'el quinto jugador (4 con el anfitrión) se rechaza: sala llena');

  g1.send({ t: 'ready', ready: false });
  const back = await host.wait('room', (x) => x.room.stage === 'lobby');
  check(!!back, 'si alguien cancela su "listo" la sala vuelve al lobby');
  host.send({ t: 'go', on: false });
  g1.send({ t: 'ready', ready: true });
  await host.wait('room', (x) => x.room.players.every((p) => p.ready));
  host.send({ t: 'go', on: true });
  await host.wait('room', (x) => x.room.stage === 'browse');
  host.send({ t: 'level', level: 3 });
  host.send({ t: 'start' });
  const s1 = await host.wait('start');
  const s2 = await g1.wait('start');
  check(s1.level === 3 && s2.level === 3 && s1.room.players.length === 4, 'el anfitrión elige el nivel y empieza para los 4');
  for (const c of [host, g1, g2, g3, g4]) c.ws.close();
} catch (e) {
  check(false, String(e));
}
console.log(fails ? `\n${fails} FALLARON` : '\nTodo bien');
process.exit(fails ? 1 : 0);
