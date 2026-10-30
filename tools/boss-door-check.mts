// @ts-nocheck (herramienta de Node fuera del tsconfig del juego)
// Regresión: en las peleas de jefe de los niveles extra NO se puede pasar la puerta (ni terminar el nivel) sin matar al jefe,
// aunque se agarren objetos pegados a la puerta. Fuzz determinista en un jugador y en coop (anfitrión con 2 jugadores).
// Uso: LINKEDOM_DIR=/ruta/con/node_modules/.. npx tsx tools/boss-door-check.mts
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
import { attachInput, pollInput, resetInput } from '../src/xa/core/input.ts';

attachInput();
const key = (type: 'keydown' | 'keyup', code: string) => (handlers[type] ?? []).forEach((f) => f({ code, preventDefault() {} }));
let seed = 99;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyZ', 'KeyX'];
const ITEMS = ['ENERGY', 'PU_CRYSTAL', 'PU_POTION', 'PU_BATTERY', 'PU_GEARS', 'LIVES', 'ENERGY_DOUBLE_JUMP', 'ENERGY_JUMP'];
const FRAMES = +(process.env.FRAMES ?? 2400);
let fails = 0;
const check = (ok: boolean, msg: string) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails++; };

const diff = (n: number) => ({ players: n, hp: 1, count: 1, boss: 1, soloGraceSeconds: 25, soloRampPerSecond: 0.02, soloCap: 1.6 });

for (const n of [3, 6, 9, 12, 15]) {
  for (const players of [1, 2]) {
    const tmx = parseTmx(readFileSync(`public/assets/data/extra/extra${n}.tmx`, 'utf8'));
    const ev = { gameOver() {}, levelComplete() {}, message() {}, saving() {}, snapshot() {}, input() {} };
    const coop = players > 1 ? { role: 'host', roster: [0, 1].map((i) => ({ id: i, name: 'P' + i, color: i, hex: '#fff' })), you: 0, difficulty: diff(2), powerups: true, seed: 1 } : undefined;
    const s: any = new Scenario(tmx, 100 + n, new HeroState(), ev as any, coop as any);
    s.immortal = true;
    const door = s.doors[0];
    const boss = s.enemies.find((e: any) => e.isBoss);
    const floorY = door.y + door.h;
    let crossed = 0, won = false, keys = 0;
    resetInput();
    for (let f = 0; f < FRAMES; f++) {
      if (f % 300 === 0) {
        // héroes pegados a la puerta, con un objeto recién caído entre ellos y la puerta (o encima de la puerta)
        for (const p of s.players) { p.hero.spawn(door.x - 20 - rnd() * 60, floorY); p.hero.entranceActive = false; p.eliminated = false; }
        for (let i = 0; i < 3; i++) s.spawnItem(ITEMS[Math.floor(rnd() * ITEMS.length)], door.x - 4 - rnd() * 40 + (i === 2 ? 20 : 0), floorY, 1);
      }
      if (f % 6 === 0) for (const k of KEYS) key(rnd() < (k === 'ArrowRight' ? 0.7 : 0.3) ? 'keydown' : 'keyup', k);
      // el compañero (coop) empuja siempre hacia la puerta saltando
      if (players > 1) s.setRemoteInput(1, 2 | (f % 20 < 3 ? 8 : 0), f + 1);
      pollInput();
      s.update(1 / 60);
      boss.lives = Math.max(boss.lives, 1); boss.alive = true; // el jefe nunca muere en esta prueba
      for (const p of s.players) if (p.hero.rect.x + p.hero.rect.w / 2 > door.x + door.w / 2) crossed++;
      if (s.winner) won = true;
      keys = Math.max(keys, s.state.keys.length);
    }
    check(!crossed && !won && !door.open && !keys, `extra${n} ${players}J: jefe vivo -> nadie cruza la puerta (cruces ${crossed}, ganó ${won}, abierta ${door.open}, llaves ${keys})`);
    if (players > 1) continue;
    for (const k of KEYS) key('keyup', k);
    // desplazamiento grande en un solo cuadro (antes: si el centro pasaba la mitad de la puerta lo sacaba por el otro lado)
    const h = s.players[0].hero;
    let through = 0;
    for (const v of [600, 1500, 3000, 6000]) {
      h.spawn(door.x - 14, floorY); for (let i = 0; i < 300 && h.state === 10; i++) { pollInput(); s.update(1 / 60); }
      h.vel.x = v; h.vel.y = 0; pollInput(); s.update(1 / 60);
      if (h.rect.x + h.rect.w / 2 > door.x + door.w / 2) through++;
    }
    check(!through && !door.open, `extra${n}: un salto de 10-100 px en un cuadro contra la puerta cerrada no la cruza (${through})`);
    // la salida no termina el nivel mientras el jefe viva (aunque alguien llegue a tocarla)
    const end = s.things.find((t: any) => t.o.props.pAsset === 'ENDING');
    const eb = end.bounds();
    h.spawn(eb.x + 16, eb.y + eb.h - 1); h.entranceActive = false; pollInput(); s.update(1 / 60); pollInput(); s.update(1 / 60);
    check(!s.winner, `extra${n}: tocar la salida con el jefe vivo no termina el nivel`);
    boss.alive = false; s.enemies = s.enemies.filter((e: any) => e !== boss); s.state.keys.push('KEY');
    h.spawn(door.x - 14, floorY); for (let i = 0; i < 300 && h.state === 10; i++) { pollInput(); s.update(1 / 60); } for (let i = 0; i < 4; i++) { key('keydown', 'ArrowRight'); pollInput(); s.update(1 / 60); }
    key('keyup', 'ArrowRight');
    check(door.open, `extra${n}: con la llave del jefe la puerta se abre`);
    h.spawn(door.x + 200, floorY); pollInput(); s.update(1 / 60);
    h.spawn(eb.x + 16, eb.y + eb.h - 1); h.entranceActive = false; pollInput(); s.update(1 / 60); pollInput(); s.update(1 / 60);
    check(s.winner, `extra${n}: jefe muerto -> la salida termina el nivel`);
  }
}
for (const k of KEYS) key('keyup', k);
console.log(fails ? `\n${fails} fallos` : '\ntodo OK');
process.exit(fails ? 1 : 0);
