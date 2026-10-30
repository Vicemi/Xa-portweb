// @ts-nocheck (herramienta de Node fuera del tsconfig del juego)
// Comprobación determinista (sin navegador) de la replicación online: un anfitrión y un invitado reales (Scenario)
// conectados por una "red" con pérdida de paquetes.
// Necesita un DOMParser (parseTmx): `npm i linkedom` en cualquier carpeta y apuntar LINKEDOM_DIR a ella.
// Uso: LINKEDOM_DIR=/ruta/con/node_modules/.. npx tsx tools/online-sim.mts
(globalThis as any).window = globalThis;
const handlers: Record<string, ((e: any) => void)[]> = {};
(globalThis as any).addEventListener = (t: string, f: any) => { (handlers[t] ??= []).push(f); };
(globalThis as any).removeEventListener = () => {};
(globalThis as any).document = { addEventListener() {}, createElement() { return { getContext: () => ({}) }; } };
(globalThis as any).localStorage = { getItem: () => null, setItem() {} };
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
(globalThis as any).DOMParser = createRequire((process.env.LINKEDOM_DIR ?? '.') + '/x.js')('linkedom').DOMParser;
import { Scenario } from '../src/xa/world/world.ts';
import { parseTmx } from '../src/xa/world/tmx.ts';
import { HeroState } from '../src/xa/world/state.ts';
import { onSound } from '../src/xa/core/audio.ts';
import { attachInput, pollInput } from '../src/xa/core/input.ts';
import type { Snap, Difficulty } from '../src/xa/online/types.ts';

let fails = 0;
const check = (ok: boolean, msg: string) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails++; };

// misma fórmula que XA-Backend/src/game.ts difficultyOf (valores por defecto)
const diff = (n: number): Difficulty => {
  const hp = Math.min(3, 1 + 0.1 * (n - 1)), count = Math.min(3, 1 + 0.75 * (n - 1));
  return { players: n, hp, count, boss: Math.min(6, (1 + 0.5 * (n - 1)) * hp), soloGraceSeconds: 25, soloRampPerSecond: 0.02, soloCap: 1.6 };
};
const load = (name: string) => parseTmx(readFileSync(`public/assets/data/${name}.tmx`, 'utf8'));

function make(levelFile: string, num: number, n: number, role: 'host' | 'guest', you: number, onSnap?: (s: Snap) => void) {
  const roster = Array.from({ length: n }, (_, i) => ({ id: i, name: 'P' + i, color: i, hex: '#fff' }));
  const ev = { gameOver() {}, levelComplete() {}, message() {}, saving() {}, snapshot: onSnap, input() {} };
  return new Scenario(load(levelFile), num, new HeroState(), ev as any,
    { role, roster, you, difficulty: diff(n), powerups: true, seed: 12345 });
}
const hp = (s: Scenario) => (s as any).enemies as any[];

// ---- 5. dificultad 1..4 jugadores
for (const [file, num] of [['level1', 1], ['level8', 8]] as const) {
  const row: string[] = [];
  for (let n = 1; n <= 4; n++) {
    const s = make(file, num, n, 'host', 0);
    const en = hp(s);
    row.push(`${n}J: ${en.length} enemigos, vida media ${(en.reduce((t, e) => t + e.lives, 0) / en.length).toFixed(2)}`);
  }
  console.log(`${file}: ${row.join(' | ')}`);
}

// ---- partida host + invitado con red que pierde 30 % de los paquetes
let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const snaps: Snap[] = [];
const host = make('level1', 1, 2, 'host', 0, (s) => snaps.push(JSON.parse(JSON.stringify(s))));
const guest = make('level1', 1, 2, 'guest', 1);
const hostSfx: string[] = [], guestSfx: string[] = [];
onSound((id) => { (currentSide === 'h' ? hostSfx : guestSfx).push(id); });
let currentSide: 'h' | 'g' = 'h';
const H = host as any;
const P1 = host.players[1];
let bits = 0, prevQ = 0;
const sendInput = (b: number) => host.setRemoteInput(1, b, ++prevQ);

function step(frames: number, drop = 0.3) {
  for (let f = 0; f < frames; f++) {
    currentSide = 'h';
    host.update(1 / 60);
    for (const s of snaps.splice(0)) {
      if (rnd() < drop) continue;
      currentSide = 'g';
      // el anfitrión y el invitado comparten proceso (y la lista global de oyentes de audio): se descartan los sonidos
      // que el invitado le "cuela" al anfitrión, que en el navegador viven en pestañas distintas
      const n = H.sfx.length, q = H.sfxQ;
      guest.applySnap(s);
      guest.update(1 / 60);
      H.sfx.length = n; H.sfxQ = q;
    }
    currentSide = 'g';
  }
}

// 1. disparos del otro jugador se oyen en el invitado (aunque se pierdan paquetes)
sendInput(2 | 16); step(2); sendInput(2); step(1);
for (let i = 0; i < 12; i++) { sendInput(16); step(5); sendInput(0); step(20); }
step(40);
const nh = hostSfx.filter((x) => x === 'BULLET_XA').length, ng = guestSfx.filter((x) => x === 'BULLET_XA').length;
const hist = (a: string[]) => JSON.stringify(a.reduce((m: any, x) => (m[x] = (m[x] ?? 0) + 1, m), {}));
console.log('host', hist(hostSfx), 'guest', hist(guestSfx));
console.log(`disparos: anfitrión ${nh}, invitado ${ng}; todos los sonidos: ${hostSfx.length} / ${guestSfx.length}`);
check(nh > 0 && ng === nh, 'cada disparo se oye exactamente una vez en el invitado con 30 % de pérdida');

// 3. las balas siguen vivas fuera de la cámara del anfitrión
const p0 = host.players[0].hero, p1 = P1.hero;
p1.spawn(p0.pos.x + 2000, p0.pos.y);
step(5);
console.log('p0', p0.pos, 'p1', p1.pos, p1.isAlive(), 'cam', H.camera.x, 'map', H.map.widthPx);
(H.bullets as any[]).length = 0;
H.spawnHeroBullet(p1.pos.x, p1.pos.y - 20, -240, P1);
const cam = H.camera;
let farAlive = false;
for (let i = 0; i < 120; i++) { step(1, 0); const b = (H.bullets as any[])[0]; if (b && Math.abs(b.x - cam.x) > cam.w + 100 && b.alive) farAlive = true; }
check(farAlive, 'una bala disparada por el invitado sigue viva fuera de la cámara del anfitrión');

// bala lejos de todos: se elimina
p1.spawn(p0.pos.x + 40, p0.pos.y);
step(3);
(H.bullets as any[]).length = 0;
H.spawnEnemyBullet(p0.pos.x + 4000, p0.pos.y - 20, 100, 0);
step(3, 0);
check((H.bullets as any[]).length === 0, 'una bala lejos de todos los jugadores se elimina');

// 4. castigo por adelantarse
const pen0 = host.pace;
const target = hp(host).find((e) => e.alive && !e.isBoss && e.x > 1500 && e.x < 6000);
const leadX = target.x - 400, leadY = target.y;
console.log('enemigo de referencia', target.type, target.x, target.y);
p1.spawn(leadX, leadY);
let sawAhead = false, guestSawAhead = false;
for (let i = 0; i < 60 * 20; i++) {
  step(1, 0);
  const s = host as any;
  if (s.aheadId === 1) sawAhead = true;
  if ((guest as any).aheadId === 1) guestSawAhead = true;
  p1.spawn(leadX, leadY);
}
const penHigh = host.pace;
check(penHigh > pen0 && penHigh <= 1.6, `castigo sube al adelantarse (${pen0} -> ${penHigh.toFixed(2)}, tope 1.6)`);
check(sawAhead && guestSawAhead, 'el campo ah llega al invitado');
check((H.reinforcements as any[]).length > 0 && hp(guest).some((e: any) => e.netId > 1000 || (H.reinforcements as any[]).some((r: any) => r.netId === e.netId)), `refuerzos vivos en el anfitrión y creados en el invitado: ${(H.reinforcements as any[]).length}`);
p1.spawn(p0.pos.x + 32, p0.pos.y);
for (let i = 0; i < 60 * 40; i++) { step(1, 0); p1.spawn(p0.pos.x + 32, p0.pos.y); }
check(host.pace < penHigh && host.pace < 1.01, `castigo se relaja al juntarse (${host.pace.toFixed(2)})`);

// plataformas móviles y puertas: el invitado las ve moverse / abrirse
for (let n = 1; n <= 16; n++) {
  const h2 = make('level' + n, n, 2, 'host', 0, (x) => snaps.push(JSON.parse(JSON.stringify(x))));
  if (!(h2 as any).platforms.length) continue;
  const g2 = make('level' + n, n, 2, 'guest', 1);
  snaps.length = 0;
  for (let i = 0; i < 60 * 3; i++) { h2.update(1 / 60); for (const x of snaps.splice(0)) { g2.applySnap(x); g2.update(1 / 60); } }
  const a = (h2 as any).platforms[0], b = (g2 as any).platforms[0];
  check(Math.abs(a.x - b.x) < 8 && Math.abs(a.y - b.y) < 8 && (a.x !== (h2 as any).platforms[0].homeX || true), `nivel ${n}: plataforma móvil igual en el invitado (${a.x.toFixed(0)},${a.y.toFixed(0)} vs ${b.x.toFixed(0)},${b.y.toFixed(0)})`);
  break;
}

// ---- ronda 2: toques cortos, enlace caído, balas con gravedad, doble salto, pausa, ítems dinámicos, música
{
  attachInput();
  const key = (type: 'keydown' | 'keyup', code: string) => (handlers[type] ?? []).forEach((f) => f({ code, preventDefault() {} }));
  const sent: number[] = [];
  const gx = new Scenario(load('level1'), 1, new HeroState(), { gameOver() {}, levelComplete() {}, message() {}, saving() {}, input: (b: number) => sent.push(b) } as any,
    { role: 'guest', roster: [0, 1].map((i) => ({ id: i, name: 'P' + i, color: i, hex: '#fff' })), you: 1, difficulty: diff(2), powerups: true, seed: 12345 });
  for (let i = 0; i < 4; i++) { // toque de X dentro de un solo cuadro (el que NO envía)
    if (i === 0) key('keydown', 'KeyX');
    pollInput(); gx.update(1 / 60);
    if (i === 0) key('keyup', 'KeyX');
  }
  check(sent.some((b) => (b & 16) !== 0), `un toque de un cuadro llega al anfitrión (bits enviados: ${sent.join(',')})`);

  const sn: Snap[] = [];
  const h = make('level1', 1, 2, 'host', 0, (x) => sn.push(JSON.parse(JSON.stringify(x))));
  const g = make('level1', 1, 2, 'guest', 1);
  const HH = h as any, GG = g as any;
  const pump = (frames: number) => { for (let i = 0; i < frames; i++) { h.update(1 / 60); const n = HH.sfx.length, q = HH.sfxQ; for (const x of sn.splice(0)) { g.applySnap(x); g.update(1 / 60); } HH.sfx.length = n; HH.sfxQ = q; } };
  pump(150);
  // 3. sin paquetes ~0.5 s el invitado se frena
  const xs = h.players[1].hero.pos.x; h.setRemoteInput(1, 2, 1); pump(20);
  const x0 = h.players[1].hero.pos.x; check(x0 - xs > 20, `con paquetes camina (${(x0 - xs).toFixed(0)} px)`); pump(60);
  check(!h.players[1].input.right && h.players[1].hero.pos.x - x0 < 200, `sin paquetes el héroe se frena (right ${h.players[1].input.right}, avanzó ${(h.players[1].hero.pos.x - x0).toFixed(0)} px)`);
  h.setRemoteInput(1, 2, 2); check(h.players[1].input.right, 'el siguiente paquete lo restaura');
  h.setRemoteInput(1, 16, 3); pump(40); h.setRemoteInput(1, 16, 4); check(!h.players[1].input.firePressed, 'sin flanco falso de fuego tras volver el enlace (ya lo mantenía apretado)');
  h.setRemoteInput(1, 0, 3);
  // 6. bala con gravedad/aceleración
  HH.spawnEnemyBullet(h.players[0].hero.pos.x + 100, h.players[0].hero.pos.y - 60, 80, 0, 300, -70);
  pump(3);
  const gb = (GG.bullets as any[]).find((b) => b.g === 300);
  check(!!gb && gb.ax === -70, `la bala con gravedad llega con g/ax al invitado (${gb?.g}, ${gb?.ax})`);
  // 11. doble salto / potenciadores de salto
  h.players[1].cereals = 1; h.players[1].heros = 2; pump(10);
  check(g.players[1].cereals === 1 && g.players[1].heros === 2, 'cereales y heros llegan al invitado');
  // 5. pausa del anfitrión
  h.pauseTick(1 / 10); h.pauseTick(1 / 10); for (const x of sn.splice(0)) g.applySnap(x);
  check(GG.hostPaused === true, 'la pausa del anfitrión llega al invitado'); pump(5); check(GG.hostPaused === false, 'y se levanta al reanudar');
  // 10. ítems dinámicos: descartado antes de llegar, el siguiente igual coincide; se podan al recogerse
  const a = HH.spawnItem('ENERGY', h.players[0].hero.pos.x + 60, h.players[0].hero.pos.y, 3) as any;
  const b = HH.spawnItem('ENERGY', h.players[0].hero.pos.x + 90, h.players[0].hero.pos.y, 3) as any;
  a.alive = false; // recogido antes de que el invitado lo viera
  pump(10);
  check(HH.dynItems.length === 1 && GG.things.length === HH.things.length && GG.things[HH.things.length - 1].alive, `ítems dinámicos: poda y mismos índices (${HH.dynItems.length} pendiente, ${GG.things.length}/${HH.things.length} cosas)`);
  b.alive = false; pump(5); check(HH.dynItems.length === 0, 'los ítems recogidos dejan de reenviarse');
  // 9. música: nadie vivo => el invitado la corta; al volver, la retoma
  for (const p of h.players) p.eliminated = true; pump(5);
  check(GG.guestMusicCut === true, 'nadie vivo: el invitado corta la música');
  for (const p of h.players) p.eliminated = false; pump(5);
  check(GG.guestMusicCut === false, 'y la retoma al reaparecer');
}
// ---- ronda 3: puntos individuales y reglas de revivir
{
  const sn: Snap[] = [];
  const h = make('level2', 2, 2, 'host', 0, (x) => sn.push(JSON.parse(JSON.stringify(x))));
  const g = make('level2', 2, 2, 'guest', 1);
  const HH = h as any;
  const msgs: string[] = [];
  const msg0 = HH.events.message; HH.events.message = (t: string, s: number) => { msgs.push(t); msg0(t, s); };
  const pump = (frames: number) => { for (let i = 0; i < frames; i++) { h.update(1 / 60); const n = HH.sfx.length, q = HH.sfxQ; for (const x of sn.splice(0)) { g.applySnap(x); g.update(1 / 60); } HH.sfx.length = n; HH.sfxQ = q; } };
  pump(100);
  const [A, B] = h.players;
  // puntos: B mata a un enemigo con su bala; los puntos son de B (no de A ni del HeroState del anfitrión)
  const e = hp(h).find((x: any) => x.alive && !x.isBoss && !x.isIndestructible && x.points > 0);
  e.lives = 1;
  B.hero.spawn(e.x - 300, e.y);
  HH.spawnHeroBullet(e.x - 10, e.y - e.h / 2, 0.001, B);
  pump(3);
  check(B.score === e.points && A.score === 0 && h.state.score === 0, `puntos individuales: B ${B.score} (enemigo ${e.points}), A ${A.score}, HeroState(anfitrión) ${h.state.score}`);
  const e2 = hp(h).find((x: any) => x.alive && !x.isBoss && !x.isIndestructible && x.points > 0);
  e2.lives = 1; HH.bullets.length = 0; A.hero.spawn(e2.x - 300, e2.y); pump(1); HH.spawnHeroBullet(e2.x - 10, e2.y - e2.h / 2, 0.001, A); pump(3);
  check(A.score === e2.points && h.state.score === A.score, `los del anfitrión van a su HeroState (progreso): A ${A.score}, HeroState ${h.state.score}`);
  pump(10);
  check(g.players[1].score === B.score && g.players[0].score === A.score, `el invitado recibe los puntos de cada uno (${g.players[0].score}/${g.players[1].score})`);

  // revivir: 5 eliminaciones de B con 3 puntos de guardado nuevos -> 3 vueltas como máximo, siempre con 1 vida
  const saves = (HH.things as any[]).filter((t) => t.o.type === 'SavePoint').sort((a, b) => a.x - b.x).slice(0, 3);
  check(saves.length === 3, `nivel 2 tiene >= 3 puntos de guardado (${saves.length})`);
  const eliminate = () => { B.lives = 0; B.hero.setState(9 as any); HH.onHeroDeathFinished(B.hero); };
  const visit = (t: any) => { A.hero.spawn(t.x, t.y); pump(4); A.hero.spawn(t.x + 200, t.y); pump(2); };
  let revives = 0, badLives = 0, wrongSpot = 0;
  for (let k = 0; k < 5; k++) {
    eliminate();
    pump(8);
    check(B.eliminated && g.players[1].eliminated, `eliminación ${k + 1}: B queda afuera (también en el invitado)`);
    // A vuelve a pasar por los puntos ya usados (no reviven) y después llega al siguiente punto nuevo, si queda
    for (const t of [...saves.slice(0, k), ...saves.slice(k, k + 1)]) {
      const was = B.eliminated;
      visit(t);
      if (was && !B.eliminated && saves.indexOf(t) < k) wrongSpot += 100; // un punto viejo lo revivió: mal
      if (was && !B.eliminated) {
        revives++;
        if (B.lives !== 0) badLives++;
        if (Math.abs(B.hero.pos.x - t.x) > 40) wrongSpot++;
      }
    }
  }
  check(revives === 3 && badLives === 0 && wrongSpot === 0, `5 eliminaciones con 3 puntos: ${revives} vueltas (esperado 3), con 1 vida (vidas de repuesto 0) y en el punto`);
  check(B.eliminated, 'tras gastar los 3 puntos, B sigue afuera (pasar de nuevo por un punto que ya lo revivió no lo revive)');
  check(msgs.some((m) => /ELIMINADO/.test(m)) && msgs.some((m) => /volvió con 1 vida/.test(m)), 'mensajes de eliminado y de vuelta');
  // sin duplicar vidas: B revivido muere una vez y queda afuera directamente
  const h2 = make('level1', 1, 2, 'host', 0); const H2 = h2 as any;
  const [, B2] = h2.players; const sv = (H2.things as any[]).filter((t) => t.o.type === 'SavePoint').sort((a, b) => a.x - b.x);
  B2.lives = 0; B2.hero.setState(9 as any); H2.onHeroDeathFinished(B2.hero);
  h2.players[0].hero.spawn(sv[0].x, sv[0].y); for (let i = 0; i < 4; i++) h2.update(1 / 60);
  const livesAfter = B2.lives; B2.hero.setState(9 as any); H2.onHeroDeathFinished(B2.hero);
  check(livesAfter === 0 && B2.eliminated, `revivido con 1 vida: la siguiente muerte lo saca (vidas al volver ${livesAfter})`);
  // todos afuera -> game over como antes
  let over = 0; H2.events.gameOver = () => over++;
  h2.players[0].lives = 0; h2.players[0].hero.setState(9 as any); H2.onHeroDeathFinished(h2.players[0].hero);
  check(over === 1, 'si todos quedan afuera: game over');
}
console.log(fails ? `\n${fails} fallos` : '\ntodo OK');
process.exit(fails ? 1 : 0);
