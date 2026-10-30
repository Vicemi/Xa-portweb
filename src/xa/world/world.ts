// Scenario equivalent: one loaded level with its tilemap, background, objects, bullets and effects.
import { Anim, ANIMS, drawFrame, drawTinted, frameOf, MAPS } from '../core/sprites';
import { drawLine } from '../core/font';
import { img } from '../core/assets';
import { playMusic, playSound, stopMusic, onSound, setListener, setSoundOrigin } from '../core/audio';
import { resetInput } from '../core/input';
import { GameCamera, VIEW_H, VIEW_W } from './camera';
import { Enemy, createEnemy } from './enemies';
import { createSvEnemy } from './svnz';
import { Hero, HS, POWER_TINT } from './hero';
import { Door, Platform } from './objects';
import { MAX_ENERGY, START_LIVES, type HeroState } from './state';
import { TileMap, type Rect } from './tilemap';
import { TileState, type TmxLevel, type TmxObject } from './tmx';
import { PlayerRuntime, bitsOf, emptyInput, inputFromBits, readLocalInput } from './player';
import type { Difficulty, Snap } from '../online/types';

/** Ajustes del coop online que recibe el escenario. */
export interface CoopConfig {
  role: 'host' | 'guest';
  /** jugadores del lobby, en el orden del servidor (id, apodo, color) */
  roster: { id: number; name: string; color: number; hex: string; plain?: boolean }[];
  /** id del jugador de esta pestaña */
  you: number;
  /** invitado espectador: no maneja ningún héroe, la cámara sigue a otro (ver watch()) */
  watch?: boolean;
  difficulty: Difficulty;
  /** power-ups en los niveles originales (contra los jefes siempre están) */
  powerups: boolean;
  /** semilla de los enemigos/vidas extra: la misma en el anfitrión y en los invitados, así los dos crean
   *  exactamente el mismo mundo (los índices de las instantáneas cuadran) */
  seed: number;
}

/** PRNG chico y determinista (mulberry32) para que el mundo extra sea idéntico en todas las pestañas. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Niveles con jefe: ahí los power-ups no se pueden desactivar. */
export const EXTRA_FIRST_ONLINE = 101;

export interface World {
  map: TileMap;
  camera: GameCamera;
  state: HeroState;
  /** héroe más cercano a la cámara (los enemigos lo usan como objetivo) */
  readonly hero: Hero;
  /** coop: multiplicador de dificultad en vivo (castigo por ir solo / muy adelantado); 1 = normal */
  readonly pace: number;
  readonly players: PlayerRuntime[];
  readonly coop: CoopConfig | null;
  immortal: boolean;
  addEffect(anim: string, x: number, y: number, dir: number): void;
  spawnHeroBullet(x: number, y: number, vx: number, p?: PlayerRuntime): void;
  spawnEnemyBullet(x: number, y: number, vx: number, vy: number, g?: number, ax?: number): void;
  startDeathTransition(seconds: number): void;
  /** coop: al morir un amigo, la música solo se corta si no queda nadie vivo */
  onDeathStarted(h: Hero): void;
  onHeroDeathFinished(h: Hero): void;
  /** Is there a floor (hard tile OR moving platform) at the given world point? */
  hasFloor(x: number, y: number): boolean;
  /** Extra-level bosses: bring in a helper enemy of `type` with its feet at (x, y). */
  spawnEnemy(type: string, x: number, y: number, props?: Record<string, string>): Enemy | null;
  /** Extra-level bosses: switch the level music (kept on respawn, like a checkpoint's pMusic). */
  setMusic(music: string): void;
  /** Show a HUD message (sign balloon). */
  message(text: string, seconds: number): void;
  /** Extra-level bosses: drop an item (e.g. ENERGY) standing at (x, y); returns a handle that tells if it's still there. */
  spawnItem(asset: string, x: number, y: number, count?: number): { alive: boolean };
  /** Is a pick-up, cow or checkpoint standing within `r` px of x (horizontally)? Used to drop items on a free spot. */
  thingNear(x: number, r: number): boolean;
  /** The level's own music (pMusic). */
  readonly levelMusic: string | null;
}

export interface WorldEvents {
  gameOver(): void;
  levelComplete(): void;
  message(text: string, seconds: number): void;
  saving(): void;
  /** coop: el invitado recibió el final de la partida del anfitrión */
  onlineEnd?(kind: 'win' | 'over'): void;
  /** coop: el anfitrión manda una instantánea del mundo */
  snapshot?(s: Snap): void;
  /** coop: el invitado manda sus controles (bits + secuencia) */
  input?(b: number, q: number): void;
}

interface Effect { anim: Anim; x: number; y: number; dir: number }
/** VolatilePoints: the awarded score in the pixel font, rising 40 px with easeOutQuint over 1.2 s. */
interface PointsFx { value: number; x: number; y: number; t: number }
const POINTS_FX_TIME = 1.2;
/** coop: segundos que un sonido sigue viajando en las instantáneas (el canal directo pierde paquetes; el invitado descarta repetidos) */
const SFX_KEEP = 0.4;
/** castigo por adelantarse: columnas de ventaja sobre el promedio de los demás, subida por columna extra, y velocidad de cambio por segundo */
const AHEAD_COLS = 24, AHEAD_RAMP_PER_COL = 0.04, PENALTY_UP = 0.12, PENALTY_DOWN = 0.05;
const REINFORCE_EVERY = 5, REINFORCE_MAX = 8;
const COW_POINTS = 1000; // Cow points (loadObjects: mov [obj+0x394], 0x3e8)
interface Bullet {
  x: number; y: number; vx: number; vy: number; team: number; alive: boolean; g?: number; ax?: number;
  dmg?: number; tint?: string; big?: boolean;  // mod power-ups
  pl?: PlayerRuntime;  // coop: quién disparó (se lleva los puntos)
}
const POWER_TIME = 15;  // seconds a power-up lasts
const POWER_TEXT: Record<string, string> = {
  PU_CRYSTAL: '\u00a1Cristal! Recib\u00eds la mitad de da\u00f1o.',
  PU_POTION: '\u00a1Poci\u00f3n! Tus disparos pegan el triple.',
  PU_BATTERY: '\u00a1Bater\u00eda! Dispar\u00e1s el doble de r\u00e1pido.',
  PU_GEARS: '\u00a1Engranajes! Disparo triple.',
};

/** StageManager::getFeetsPosition: centre-bottom of the tile containing (x, y). */
export function feetOf(x: number, y: number, ts: number): { x: number; y: number } {
  return { x: Math.floor(x / ts) * ts + ts * 0.5, y: Math.floor(y / ts) * ts + ts - 1 };
}

const ITEM_POINTS = 10;
const ITEM_FLOAT = 1.5; // Item float period (0x3fc00000) // coin value observed in xa.exe (Puntos +10 per coin)

class Thing {
  alive = true;
  anim: Anim | null = null;
  t = 0;
  /** ids de los amigos que lo estaban tocando el cuadro anterior (para no repetir la recogida) */
  touching = new Set<number>();
  /** float phase offset (Item::setTime) so neighbouring items don't bob in lockstep */
  phase = 0;
  /** seconds left before a rescued cow is removed (-1 = not rescued) */
  rescueTime = -1;
  constructor(public o: TmxObject, public x: number, public y: number, public mapName: string | null) {
    const a = o.props.pAnim;
    if (a) this.anim = new Anim(a);
  }
  bounds(): Rect {
    // use the TMX object rect: tall items (e.g. the ENDING gate) span their full height
    return { x: this.o.x, y: this.o.y, w: this.o.w || 32, h: this.o.h || 32 };
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class Scenario implements World {
  map: TileMap;
  camera = new GameCamera();
  readonly players: PlayerRuntime[] = [];
  readonly coop: CoopConfig | null;
  immortal = false;
  winner = false;
  winTime = 6.0;
  fade = 0;
  fadeDir = 0;
  private effects: Effect[] = [];
  private pointsFx: PointsFx[] = [];
  /** current level track (pMusic of the map, or of the last checkpoint that carried one) */
  private music: string | null = null;
  private spawned: Enemy[] = [];
  /** SavePoint::mpActualSavePoint: only the active checkpoint shines */
  private activeSave: Thing | null = null;
  /** coop: puntos de guardado ya activados alguna vez en este nivel (solo la primera activación revive) */
  private firstSaves = new Set<Thing>();
  // boss deaths; `pop`: seconds of MEGA_POWER blasts for the extra-level bosses (the original pops during the first
  // 3 frames of BOSS_DEAD), `puff`: they vanish in an ENEMY_DEATH cloud when their knock-out is over
  private explosions: (Effect & { rect: Rect; t: number; pop?: number; puff?: number })[] = [];
  private bullets: Bullet[] = [];
  private things: Thing[] = [];
  private enemies: Enemy[] = [];
  private platforms: Platform[] = [];
  private doors: Door[] = [];
  private heroOnPlatform = new Map<PlayerRuntime, Platform>();
  private restore = { x: 0, y: 0 };
  private bgPath: string;
  private tilesetPath: string;
  /** castigo por estar solo (multiplicador en vivo que no se reinicia al morir todos) */
  private soloPenalty = 1;
  private soloTime = 0;
  private soloWarned = false;
  private snapshotSeq = 0;
  private snapshotT = 0;
  private lastMsg = '';
  /** mensaje/saving vigentes en el anfitrión (van en la instantánea para el HUD de los invitados) */
  private msgText = '';
  private msgT = 0;
  private savingT = 0;
  private prevG = 0;
  private lastMusicSent: string | null = null;
  /** invitado: última secuencia aplicada y objetivo de los enemigos */
  private lastSnapSeq = -1;
  private enemyTargets = new Map<number, { x: number; y: number }>();
  /** semilla del mundo coop y contador de identidades de enemigos (igual en todas las pestañas) */
  private rng: () => number;
  private enemySeq = 0;
  /** invitado: temporizador del envío de controles */
  private inputT = 0;
  private inputQ = 0;
  /** enemigos que el anfitrión mató hace poco (para que los invitados los borren) */
  private deadIds: { id: number; t: number }[] = [];
  /** coop: enemigos y objetos creados en vivo (ayudantes/ítems de los jefes) que hay que replicar en los invitados */
  private dynEnemies: { id: number; type: string; x: number; y: number; props: Record<string, string> }[] = [];
  private dynItems: { idx: number; asset: string; x: number; y: number; count: number }[] = [];
  /** coop: efectos de sonido que el anfitrión generó desde la última instantánea (los invitados los reproducen) */
  private sfx: { q: number; id: string; x?: number; y?: number; t: number }[] = [];
  private sfxQ = 0;
  private lastSfxQ = 0;
  /** objetivo de los enemigos: el amigo más cercano a este punto (si no, a la cámara) */
  private focus: { x: number; y: number } | null = null;
  /** castigo por ir muy adelantado: id del que lidera (0 = nadie) y gap en columnas */
  private aheadId = -1;
  private aheadWarned = false;
  private reinforceT = 0;
  private hostPaused = false;
  private guestMusicCut = false;
  /** anfitrión: reloj y último paquete de controles de cada invitado (sin paquetes ~0.5 s = suelta todo) */
  private clock = 0;
  private lastIn = new Map<number, number>();
  private staleIn = new Set<number>();
  /** invitado: bits vistos entre dos envíos (un toque más corto que el intervalo igual llega) */
  private inputAcc = 0;
  private reinforcements: Enemy[] = [];
  private offSfx: (() => void) | null = null;

  constructor(readonly level: TmxLevel, readonly levelNum: number, public state: HeroState, private events: WorldEvents, coop?: CoopConfig) {
    this.coop = coop ?? null;
    this.rng = mulberry32(coop?.seed ?? ((levelNum * 2654435761) >>> 0));
    this.map = new TileMap(level);
    this.bgPath = 'assets/images/background/' + (level.props.pBackground ?? 'background_1.jpg');
    this.tilesetPath = level.tilesetImage.replace('/tiles/', '/tiles/win/');
    // un jugador por amigo: en solitario es el Xa de siempre
    const roster = coop?.roster ?? [{ id: 0, name: 'Xa', color: 0, hex: '' }];
    const lives = coop ? Math.max(START_LIVES, roster.length) : Math.max(1, state.lives);
    for (const r of roster) {
      const p = new PlayerRuntime(r.id, r.name, coop ? r.hex : null, coop ? r.id === coop.you : true);
      p.plain = !!r.plain;   // el anfitrión conserva los colores originales de Xa (sin tinte); el hex solo marca plaquitas
      p.resetForLevel(lives);
      p.hero = new Hero(this, p);
      p.hero.limit = { w: this.map.widthPx, h: this.map.heightPx };
      this.players.push(p);
    }
    setListener(null); setSoundOrigin(null);
    this.loadObjects();
    this.music = level.props.pMusic ?? null;
    if (this.music) playMusic(this.music);
    // coop (anfitrión): cada playSound que ocurra durante el nivel se replica a los invitados en la siguiente instantánea
    if (this.coop?.role === 'host') {
      this.offSfx = onSound((id, x, y) => {
        if (id === 'CLICK') return;
        this.sfx.push({ q: ++this.sfxQ, id, x, y, t: 0 });
        if (this.sfx.length > 40) this.sfx.shift();
      });
    }
  }

  /** Libera la suscripción de audio (llamar antes de descartar el escenario). */
  dispose(): void {
    setListener(null); setSoundOrigin(null);
    if (this.offSfx) { this.offSfx(); this.offSfx = null; }
  }
  get pace(): number { return this.soloPenalty; }
  get hero(): Hero {
    const alive = this.players.filter((p) => p.hero.isAlive() && !p.eliminated);
    const list = alive.length ? alive : this.players;
    if (list.length <= 1) return list[0].hero;
    const cx = this.focus?.x ?? this.camera.x + this.camera.w / 2, cy = this.focus?.y ?? this.camera.y + this.camera.h / 2;
    let best = list[0], bd = Infinity;
    for (const p of list) {
      const d = Math.abs(p.hero.pos.x - cx) + Math.abs(p.hero.pos.y - cy);
      if (d < bd) { bd = d; best = p; }
    }
    return best.hero;
  }

  /** El jugador de esta pestaña (el que mueve la cámara y el HUD). */
  get localPlayer(): PlayerRuntime {
    return this.players.find((p) => p.local) ?? this.players[0];
  }

  /** coop: alguien entró con la partida en curso: su héroe aparece en el último punto de guardado. */
  addPlayer(r: { id: number; name: string; hex: string; plain?: boolean }): void {
    if (!this.coop || this.players.some((p) => p.id === r.id)) return;
    const p = new PlayerRuntime(r.id, r.name, r.hex, r.id === this.coop.you && !this.coop.watch);
    p.plain = !!r.plain;
    p.resetForLevel(START_LIVES);
    p.hero = new Hero(this, p);
    p.hero.limit = { w: this.map.widthPx, h: this.map.heightPx };
    this.players.push(p);
    this.respawnPlayer(p);
  }

  /** coop (anfitrión): un invitado salió del nivel / mira (away) o volvió a jugar. Mientras está afuera su héroe no
   *  juega, no se dibuja y no cuenta para el game over ni para revivir; al volver reaparece en el punto de guardado. */
  setAway(id: number, away: boolean): void {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.away === away || this.coop?.role !== 'host') return;
    p.away = away;
    p.input = emptyInput();
    p.bits = 0;
    if (away) {
      p.awayElim = p.eliminated;
      p.eliminated = true;
      p.hero.visible = false;
      this.heroOnPlatform.delete(p);
      if (this.players.every((x) => x.eliminated)) {
        for (const x of this.players) x.lives = Math.max(START_LIVES, this.players.length);
        this.events.gameOver();
      }
      return;
    }
    p.eliminated = p.awayElim;
    if (!p.eliminated) this.respawnPlayer(p);
  }

  /** Espectador: la cámara y el HUD siguen al jugador `id`. */
  watch(id: number): void {
    if (!this.players.some((p) => p.id === id)) return;
    for (const p of this.players) p.local = p.id === id;
  }

  /** Every image path this level needs (for preloading). */
  static imagePaths(level: TmxLevel): string[] {
    return [
      'assets/images/background/' + (level.props.pBackground ?? 'background_1.jpg'),
      level.tilesetImage.replace('/tiles/', '/tiles/win/'),
      ...Object.values(MAPS).map((m) => m.path),
      'assets/svnz/hud/bars.png', 'assets/svnz/hud/fullBars.png',
    ];
  }

  private loadObjects(): void {
    const ts = this.map.ts;
    let cows = 0, coins = 0;
    for (const o of this.level.objects) {
      const f = feetOf(o.x, o.y, ts);
      switch (o.type) {
        case 'Hero': {
          this.restore = f;
          const n = this.players.length;
          this.players.forEach((p, i) => {
            const dx = n > 1 ? (i - (n - 1) / 2) * 30 : 0;
            p.hero.spawn(f.x + dx, f.y);
          });
          break;
        }
        case 'Item':
          // coop: en los niveles originales el anfitrión puede apagar los power-ups (contra los jefes van siempre)
          if (this.coop && !this.coop.powerups && this.levelNum < EXTRA_FIRST_ONLINE
            && (o.props.pRequiredItem ?? '').startsWith('PU_')) break;
          if (o.props.pRequiredItem === 'POINTS') coins++;
          this.things.push(new Thing(o, f.x, f.y, o.props.pAsset ?? null));
          this.things[this.things.length - 1].phase = ((o.x / 32) * 0.15) % ITEM_FLOAT; // Item::setTime
          break;
        case 'Information':
        case 'SavePoint':
          this.things.push(new Thing(o, f.x, f.y, o.props.pAsset ?? null));
          break;
        case 'Cow':
          cows++;
          this.things.push(new Thing(o, f.x, f.y, 'SAD_COW'));
          break;
        case 'Door':
          this.doors.push(new Door(o, o.x, o.y));
          break;
        case 'PlatformInterp':
        case 'PlatformLinear':
          this.platforms.push(new Platform(o, o.x, o.y, this.levelNum));
          break;
        default: {
          const e = createSvEnemy(o, this, f.x, f.y) ?? createEnemy(o, this, f.x, f.y);
          if (e) this.track(e);
          break;
        }
      }
    }
    this.state.startStage(this.levelNum, cows, coins);
    // coop: más vida por enemigo y más enemigos según cuántos amigos juegan; contra los jefes, aún más vida.
    // Se hace igual en el anfitrión y en los invitados (misma semilla) para que el mundo coincida.
    if (this.coop) {
      const d = this.coop.difficulty;
      for (const e of this.enemies) {
        const mult = e.isBoss ? d.boss : d.hp;
        e.lives = Math.max(1, Math.round(e.lives * mult));
      }
      const extra = Math.round(this.enemies.length * Math.max(0, d.count - 1));
      if (extra > 0) this.spawnExtraEnemies(extra);
      this.spawnExtraLives();
    }
    this.camera.init(this.map.widthPx, this.map.heightPx, this.localPlayer.hero.pos.x, this.localPlayer.hero.pos.y, this.localPlayer.hero.height);
  }

  /** Da de alta un enemigo con su identidad de red (el orden de creación es igual en todas las pestañas). */
  private track(e: Enemy): Enemy {
    e.netId = ++this.enemySeq;
    this.enemies.push(e);
    return e;
  }

  /** Duplica algunos enemigos normales (nunca jefes) para que el coop tenga más movimiento. */
  private spawnExtraEnemies(count: number): void {
    const base = this.enemies.filter((e) => !e.isBoss && !e.isIndestructible); // repartidos por todo el nivel (antes solo los primeros 24 juntaban todos los extras)
    if (!base.length) return;
    const ts = this.map.ts;
    for (let i = 0; i < count; i++) {
      const src = base[Math.floor(this.rng() * base.length)];
      const o = src.o;
      const dir = this.rng() < 0.5 ? -1 : 1;
      const x = src.x + dir * (48 + this.rng() * 32);
      const f = feetOf(x, src.y - 1, ts);
      if (f.x < ts || f.x > this.map.widthPx - ts) continue;
      const e = createSvEnemy(o, this, f.x, f.y) ?? createEnemy(o, this, f.x, f.y);
      if (!e) continue;
      if (this.coop) e.lives = Math.max(1, Math.round(e.lives * this.coop.difficulty.hp));
      this.track(e);
    }
  }

  /** Vidas extra repartidas por el nivel (una por amigo), lejos entre sí y de las que ya hay. */
  private spawnExtraLives(): void {
    const spots = this.things.filter((t) => t.o.type === 'Item' && t.alive);
    if (!spots.length) return;
    const chosen: { x: number; y: number }[] = [];
    const far = (x: number, y: number) => chosen.every((c) => Math.hypot(c.x - x, c.y - y) > 180);
    let guard = 0;
    while (chosen.length < this.players.length && guard++ < 200) {
      const s = spots[Math.floor(this.rng() * spots.length)];
      if (!far(s.x, s.y)) continue;
      chosen.push({ x: s.x, y: s.y });
      const o = {
        type: 'Item', name: 'LIVES', x: Math.round(s.x - 16), y: Math.round(s.y - 32), w: 32, h: 32,
        props: { pAsset: 'LIVES', pCount: '1', pRequiredItem: 'LIVES' },
      } as unknown as TmxObject;
      const t = new Thing(o, s.x, s.y, 'LIVES');
      t.phase = this.rng() * ITEM_FLOAT;
      this.things.push(t);
      this.addEffect('POWER', s.x, s.y - 16, 1);
    }
  }

  // ---------- World ----------
  addEffect(anim: string, x: number, y: number, dir: number): void {
    const a = new Anim(anim);
    if (a.type) this.effects.push({ anim: a, x, y, dir });
  }
  spawnHeroBullet(x: number, y: number, vx: number, p = this.localPlayer): void {
    const pw = p.power;
    const tint = pw ? POWER_TINT[pw] : undefined;
    const dmg = pw === 'PU_POTION' ? 3 : 1;
    this.bullets.push({ x, y, vx, vy: 0, team: 0, alive: true, dmg, tint, big: pw === 'PU_POTION', pl: p });
    if (pw === 'PU_GEARS') {
      // mod power-up: triple shot in a fan
      this.bullets.push({ x, y, vx: vx * 0.97, vy: -120, team: 0, alive: true, dmg, tint, pl: p });
      this.bullets.push({ x, y, vx: vx * 0.97, vy: 120, team: 0, alive: true, dmg, tint, pl: p });
    }
  }
  spawnEnemyBullet(x: number, y: number, vx: number, vy: number, g = 0, ax = 0): void {
    this.bullets.push({ x, y, vx, vy, team: 1, alive: true, g, ax });
  }
  /** Remove an enemy with a death burst (no points). */
  spawnEnemy(type: string, x: number, y: number, props: Record<string, string> = {}): Enemy | null {
    const o = { type, name: type, x: x - 16, y: y - 32, w: 32, h: 32, props: { pTeam: '1', ...props } } as unknown as TmxObject;
    const e = createSvEnemy(o, this, x, y) ?? createEnemy(o, this, x, y);
    if (e) {
      e.netId = ++this.enemySeq;
      this.spawned.push(e);
      if (this.coop?.role === 'host') this.dynEnemies.push({ id: e.netId, type, x, y, props });
    }
    return e;
  }
  thingNear(x: number, r: number): boolean {
    return this.things.some((t) => t.alive && Math.abs(t.x - x) < r);
  }
  spawnItem(asset: string, x: number, y: number, count = 3): { alive: boolean } {
    const ts = this.map.ts;
    const o = { type: 'Item', name: asset, x: Math.round(x - ts / 2), y: Math.round(y - ts), w: 32, h: 32,
      props: { pAsset: asset, pCount: String(count), pRequiredItem: asset } } as unknown as TmxObject;
    const f = feetOf(o.x, o.y, ts);
    const t = new Thing(o, f.x, f.y, asset);
    this.things.push(t);
    this.addEffect('POWER', f.x, f.y - 16, 1);
    this.addEffect('MEGA_POWER', f.x, f.y - 16, 1); // short spawn flash so the drop is noticed
    if (this.coop?.role === 'host') {
      this.dynItems.push({ idx: this.things.length - 1, asset, x: f.x, y: f.y, count });
    }
    return t;
  }
  /** Invitado: crea un enemigo que el anfitrión generó en vivo (ayudante de un jefe). */
  private addNetEnemy(id: number, type: string, x: number, y: number, props: Record<string, string>): void {
    if (!type || this.enemies.some((e) => e.alive && e.netId === id)) return;
    const o = { type, name: type, x: x - 16, y: y - 32, w: 32, h: 32, props: { pTeam: '1', ...props } } as unknown as TmxObject;
    const e = createSvEnemy(o, this, x, y) ?? createEnemy(o, this, x, y);
    if (e) { e.netId = id; this.enemies.push(e); }
  }

  /** Invitado: crea un objeto que el anfitrión generó en vivo (ítems de los jefes), en el mismo índice. */
  private addNetItem(idx: number, asset: string, x: number, y: number, count: number): void {
    // el anfitrión de una sala puede ser cualquiera: un índice absurdo no debe reservar memoria sin límite en los invitados
    if (!Number.isInteger(idx) || idx < this.things.length || idx > this.things.length + 64) return;
    // índices que el anfitrión ya descartó (ítems recogidos antes de que llegaran): relleno muerto para que los demás coincidan
    while (this.things.length < idx) {
      const dead = new Thing({ type: 'Item', name: '', x: 0, y: 0, w: 32, h: 32, props: {} } as unknown as TmxObject, 0, 0, null);
      dead.alive = false;
      this.things.push(dead);
    }
    const o = { type: 'Item', name: asset, x: Math.round(x - 16), y: Math.round(y - 32), w: 32, h: 32,
      props: { pAsset: asset, pCount: String(count), pRequiredItem: asset } } as unknown as TmxObject;
    this.things.push(new Thing(o, x, y, asset));
  }

  get levelMusic(): string | null { return this.level.props.pMusic ?? null; }
  setMusic(music: string): void {
    this.music = music;
    playMusic(music);
  }
  message(text: string, seconds: number): void {
    this.msgText = text;
    this.msgT = seconds;
    this.events.message(text, seconds);
  }
  /** Health bar of the awake extra-level boss, if any (the original levels never have one). */
  get bossBar(): { name: string; lives: number; max: number } | null {
    for (const e of this.enemies) { const b = e.alive ? e.bossBarInfo() : null; if (b) return b; }
    return null;
  }

  private removeEnemy(e: Enemy): void {
    e.alive = false;
    this.markDead(e);
    playSound('ENEMY_DEATH');
    this.addEffect('ENEMY_DEATH', e.x, e.y - e.h / 2, 1);
  }
  /** coop: los invitados se enteran por la instantánea de qué enemigos ya no están. */
  private markDead(e: Enemy): void {
    if (this.coop?.role === 'host') this.deadIds.push({ id: e.netId, t: 2 });
  }
  private killEnemy(e: Enemy, byBullet = false, pl?: PlayerRuntime): void {
    if (e.isBomb) {
      // EnemyBomb::onCollision: explode into an 8-way radial burst ("8_BULLETS", speed 200).
      e.alive = false;
      this.markDead(e);
      playSound('ENEMY_DEATH');
      this.addEffect('BOMBA_DEATH', e.x, e.y - e.h / 2, 1);
      this.burst8(e);
      this.award(e.points, e.x, e.y - e.h / 2, pl);
      return;
    }
    this.removeEnemy(e);
    if (byBullet && e.burstsOnShotDeath) this.burst8(e); // Jumper::onCollision
    this.award(e.points, e.x, e.y - e.h / 2, pl);
  }
  /** Hero::addItems("POINTS", n) + EnemyHelper::addPointsEffect at the centre of the object's bound. */
  private award(points: number, x: number, y: number, pl?: PlayerRuntime): void {
    if (points <= 0) return;
    this.addScore(points, pl);
    this.pointsFx.push({ value: points, x, y, t: 0 });
  }
  /** Solitario: HeroState como siempre. Coop: cada amigo suma sus propios puntos; HeroState lleva los del anfitrión
   *  (el que juega en esta pestaña), que son los que se guardan en el progreso. */
  private addScore(points: number, pl?: PlayerRuntime): void {
    if (!this.coop) { this.state.addPoints(points); return; }
    const p = pl ?? this.localPlayer;
    p.score = Math.min(999999, p.score + points);
    if (p.local) this.state.addPoints(points);
  }
  /** XABulletFactory "8_BULLETS": 8 bullets from the centre, every 45° starting straight up, 200 px/s. */
  private burst8(e: Enemy): void {
    for (let i = 0; i < 8; i++) {
      const a = i * (Math.PI / 4);
      this.spawnEnemyBullet(e.x, e.y - e.h / 2, Math.sin(a) * 200, -Math.cos(a) * 200);
    }
  }
  /** EnemyBoss::onCollision death: camera shake 3 s, BOSS_DEAD explosion that keeps popping MEGA_POWER blasts
   *  over the boss rect while its first 3 frames play (VolatileExplosion), and the BOSS_KEY for the last gate. */
  private killBoss(e: Enemy): void {
    e.alive = false;
    this.markDead(e);
    for (const x of e.extras) if (x.alive) this.removeEnemy(x); // its helpers go with it (extra-level bosses)
    e.onDefeated();
    this.camera.shake(3.0);
    playSound('ENEMY_DEATH');
    const b = e.bounds();
    const d = e.deathAnim();
    if (d.feet) this.explosions.push({ anim: new Anim(d.anim), x: e.x, y: e.y, dir: e.dir, rect: b, t: 0, pop: 1.5, puff: e.h / 2 });
    else this.explosions.push({ anim: new Anim(d.anim), x: e.x, y: e.y - e.h / 2, dir: e.dir, rect: b, t: 0 });
    this.grantKey(e);
  }
  private grantKey(e: Enemy): void {
    const k = e.dropsKey;
    if (k) { this.state.keys.push(k); playSound('KEY'); }
  }
  hasFloor(x: number, y: number): boolean {
    // MobileObject::internalUpdate edge test: Scenario::isFloor || isPlatform (one-way tile) || isOverLadder.
    const m = this.map;
    if (m.isHard(x, y) || m.isPlatform(x, y) || m.isOverLadder(x, y - 1)) return true;
    for (const p of this.platforms) {
      if (x >= p.x && x <= p.x + p.w && y >= p.y - 4 && y <= p.y + 8) return true;
    }
    return false;
  }
  startDeathTransition(seconds: number): void {
    this.fade = 0;
    this.fadeDir = 1 / (seconds / 2);
  }
  onDeathStarted(_h: Hero): void {
    if (!this.coop) { stopMusic(); return; }
    // en coop la partida sigue mientras quede alguien vivo
    if (!this.players.some((p) => p.hero.isAlive() && !p.eliminated)) stopMusic();
  }

  onHeroDeathFinished(h: Hero): void {
    if (this.coop) {
      const p = h.p;
      if (p.lives > 0) {
        p.lives -= 1;
        this.respawnPlayer(p);
        return;
      }
      // se quedó sin vidas: espera a que un amigo vivo active un punto de guardado NUEVO (o al final si estamos todos así)
      p.lives = 0;
      p.eliminated = true;
      h.visible = false;
      h.state = HS.Dead;
      if (this.players.every((x) => x.eliminated)) {
        for (const x of this.players) x.lives = Math.max(START_LIVES, this.players.length);
        this.events.gameOver();
        return;
      }
      this.message(`${p.name.slice(0, 10) || 'Xa'}: ¡ELIMINADO!\nRevive en el próximo punto de guardado.`, 4);
      return;
    }
    // solitario: el comportamiento original (transición, vidas en HeroState)
    const s = this.state;
    if (s.lives <= 0) {
      s.lives = START_LIVES;
      this.events.gameOver();
      return;
    }
    s.lives -= 1;
    resetInput(); // no key may stay stuck "held" across the death
    const p = this.localPlayer;
    p.lives = s.lives;
    p.clearPower(); // mod: power-ups are lost with the life
    for (const e of this.enemies) if (e.alive) e.onHeroRespawn(); // extra-level bosses start over at full life
    if (this.music) playMusic(this.music); // the track a checkpoint switched to keeps playing (AudioLibrary state)
    this.clearVolatile();
    this.hero.vel = { x: 0, y: 0 };
    this.hero.spawn(this.restore.x, this.restore.y);
    this.camera.goToGoal(this.restore.x, this.restore.y, this.hero.height);
    this.fadeDir = -Math.abs(this.fadeDir || 1);
  }

  /** Reinicia a un amigo en el último checkpoint (coop: el mundo no se congela). */
  private respawnPlayer(p: PlayerRuntime): void {
    p.energy = MAX_ENERGY;
    p.clearPower();
    p.input = emptyInput();
    const h = p.hero;
    h.visible = true;
    h.vel = { x: 0, y: 0 };
    h.spawn(this.restore.x, this.restore.y);
    h.redTime = 1.5; // gracia para no morir encadenado
    if (this.music) playMusic(this.music);
    this.addEffect('POWER', this.restore.x, this.restore.y - 30, 1);
  }

  /** Un amigo vivo activó por PRIMERA vez este punto de guardado: vuelven los eliminados, ahí, con exactamente 1 vida.
   *  Como cada punto se activa por primera vez una sola vez por nivel, cada punto revive a cada jugador como mucho una vez
   *  (5 eliminaciones con 3 puntos = 3 vueltas como máximo); los que ya estaban activos (atrás) no reviven a nadie. */
  private reviveAtSave(x: number, y: number): void {
    const back = this.players.filter((p) => p.eliminated && !p.away);
    for (const p of back) {
      p.eliminated = false;
      p.lives = 0; // una sola vida: la que juega ahora (el contador son vidas de repuesto); al morir otra vez queda afuera
      this.respawnPlayer(p);
    }
    if (back.length) {
      this.addEffect('POWER', x, y - 30, 1);
      playSound('HERO_LIFE');
      const names = back.map((p) => p.name.slice(0, 10) || 'Xa').join(', ');
      this.message(`¡${names} volvió con 1 vida!\nSi cae otra vez, queda afuera.`, 3);
    }
  }

  private clearVolatile(): void {
    this.bullets = [];
    this.effects = [];
    this.pointsFx = [];
    this.explosions = [];
    this.msgText = '';
    this.msgT = 0;
    this.savingT = 0;
    this.events.message('', 0);
  }

  // ---------- update ----------
  /** Invitado: guarda los controles locales para mandarlos al anfitrión. */
  setRemoteInput(id: number, bits: number, q: number): void {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.local) return;
    const prev = p.bits;
    p.bits = bits;
    p.q = q;
    p.input = inputFromBits(bits, prev);
    this.lastIn.set(id, this.clock);
    this.staleIn.delete(id);
  }

  /** coop: el oído de esta pestaña está en su propio héroe (el volumen y el paneo de los demás salen de ahí). */
  private syncListener(): void {
    if (!this.coop) return;
    const h = this.localPlayer.hero;
    setListener({ x: h.pos.x, y: h.pos.y });
  }

  /** coop (anfitrión): en pausa el mundo no corre pero sigue mandando instantáneas con la bandera de pausa. */
  pauseTick(dt: number): void {
    if (this.coop?.role !== 'host') return;
    this.hostPaused = true;
    this.sendSnapIfDue(dt);
  }

  update(dt: number): void {
    if (this.coop?.role === 'guest') {
      // invitado: lee sus controles (los manda ~30 veces por segundo) y dibuja lo que llega del anfitrión
      this.localPlayer.input = readLocalInput();
      this.syncListener();
      this.inputAcc |= bitsOf(this.localPlayer.input);
      this.inputT += dt;
      if (this.inputT >= 1 / 30 && this.events.input) {
        this.inputT = 0;
        this.inputQ = (this.inputQ + 1) & 0xffff;
        this.events.input(this.inputAcc, this.inputQ);
        this.inputAcc = bitsOf(this.localPlayer.input);
      }
      this.updateGuest(dt);
      return;
    }
    this.localPlayer.input = readLocalInput();
    this.syncListener();
    this.hostPaused = false;
    this.clock += dt;
    for (const [id, at] of this.lastIn) {
      const rp = this.players.find((x) => x.id === id);
      // se cortó el enlace: el héroe se frena. `bits` queda como estaba, así el primer paquete al volver no inventa un flanco
      if (rp && rp.bits && !this.staleIn.has(id) && this.clock - at > 0.5) { this.staleIn.add(id); rp.input = inputFromBits(0, rp.bits); }
    }
    const anyAlive = (): boolean => this.players.some((p) => p.hero.isAlive() && !p.eliminated);

    // lado de cada héroe respecto de las puertas ANTES de moverse (las puertas cerradas lo mantienen de ese lado)
    const before = new Map<PlayerRuntime, number>();
    for (const p of this.players) before.set(p, p.hero.rect.x + p.hero.rect.w / 2);
    for (const p of this.players) {
      if (p.eliminated) continue;
      setSoundOrigin(p.hero.pos.x, p.hero.pos.y);
      p.hero.update(dt);
      // los controles remotos llegan a 30 Hz: el flanco se consume una sola vez
      if (!p.local) { p.input.firePressed = false; p.input.jumpPressed = false; }
    }
    setSoundOrigin(null);
    if (!anyAlive()) {
      // mientras nadie esté vivo solo corren las animaciones (y el invitado espera la instantánea)
      this.updateAnimations(dt);
      this.updateSolo(dt, 0);
      this.sendSnapIfDue(dt);
      return;
    }

    const local = this.localPlayer;
    // eliminado: la cámara sigue a un amigo vivo hasta que lo revivan
    const h = local.hero.isAlive() && !local.eliminated ? local.hero : local.eliminated ? this.hero : null;
    if (h) this.camera.update(dt, h.pos.x, h.pos.y, h.height, h.dir, h.vel.x, h.vel.y, this.winner);
    for (const p of this.players) {
      if (!p.power) continue;
      p.powerT -= dt;
      if (p.powerT <= 0) { p.clearPower(); playSound('HERO_DEFENSE_2'); }
    }
    this.updateSolo(dt, this.players.filter((p) => p.hero.isAlive() && !p.eliminated).length);

    // platforms: move + every hero landing / riding
    for (const p of this.platforms) p.update(dt);
    for (const pl of this.players) {
      const h = pl.hero;
      const on = this.heroOnPlatform.get(pl) ?? null;
      if (on) {
        const onX = h.pos.x > on.x - 8 && h.pos.x < on.x + on.w + 8;
        if (!h.isAlive() || pl.eliminated || h.vel.y < 0 || !onX) this.heroOnPlatform.delete(pl);
        else {
          h.landOnPlatform(on.y);              // snap feet to the platform top (vertical)
          h.ridePlatform(on.x - on.prevX, 0);  // carry horizontally (vertical already handled)
        }
      } else if (h.isAlive() && !pl.eliminated) {
        for (const p of this.platforms) {
          const onX = h.pos.x > p.x - 8 && h.pos.x < p.x + p.w + 8;
          if (h.vel.y >= 0 && onX && h.pos.y >= p.y - 1 && h.pos.y - h.vel.y * dt <= p.y + 2) {
            h.landOnPlatform(p.y);
            this.heroOnPlatform.set(pl, p);
            break;
          }
        }
      }
    }
    // enemies standing on a moving platform ride it (ground-bound enemies only)
    for (const e of this.enemies) {
      if (!e.alive || !e.isGroundBound) continue;
      for (const p of this.platforms) {
        if (e.x > p.x - 6 && e.x < p.x + p.w + 6 && Math.abs(e.y - p.y) < 6) {
          e.x += p.x - p.prevX;
          e.y += p.y - p.prevY;
          break;
        }
      }
    }
    // doors: block until opened with the right key (the keys are shared)
    for (const d of this.doors) {
      d.update(dt);
      if (d.gone) continue;
      const db = d.bounds();
      for (const pl of this.players) {
        const h = pl.hero;
        if (!h.isAlive() || pl.eliminated) continue;
        // a la altura de la puerta, o por ENCIMA del mapa (fuera del mapa no hay baldosas: la columna sólida de arriba no
        // frena a un héroe con los pies sobre y=0, la puerta sí)
        if (h.rect.y >= db.y + db.h || (h.rect.y + h.rect.h <= db.y && h.rect.y + h.rect.h > 0)) continue;
        // del lado en que estaba al empezar el cuadro: un desplazamiento grande en un solo cuadro (o un héroe que quedó
        // solapado) nunca lo deja del otro lado, aunque haya "saltado" la puerta sin tocarla en este cuadro
        const mid = db.x + db.w / 2, c0 = before.get(pl) ?? h.rect.x + h.rect.w / 2;
        const left = c0 < mid;
        if (left ? h.rect.x + h.rect.w <= db.x : h.rect.x >= db.x + db.w) continue;
        if (overlaps(h.rect, db) && !d.open && d.tryOpen(this.state.keys)) continue;
        if (d.open) continue;
        if (left) h.pushX(db.x - (h.rect.x + h.rect.w));
        else h.pushX(db.x + db.w - h.rect.x);
        h.vel.x = 0;
      }
    }

    if (this.fadeDir) {
      this.fade = Math.min(1, Math.max(0, this.fade + this.fadeDir * dt));
      if (this.fade <= 0 && this.fadeDir < 0) this.fadeDir = 0;
    }

    if (this.winner) {
      this.winTime -= dt;
      if (this.winTime <= 0) {
        this.winTime = 6;
        this.events.levelComplete();
      }
    }

    for (const t of this.things) {
      if (!t.alive) continue;
      t.t += dt;
      t.anim?.update(dt);
      if (t.rescueTime >= 0) {
        // Cow::internalUpdate: after HAPPY_COW ends, blink (visibility toggles every 0.05 s) for 1 s, then go
        if (t.anim && !t.anim.isOver()) continue;
        t.rescueTime -= dt;
        if (t.rescueTime < 0) t.alive = false;
        continue;
      }
      const now = new Set<number>();
      for (const pl of this.players) {
        const h = pl.hero;
        if (!h.isAlive() || pl.eliminated) continue;
        if (!overlaps(h.rect, t.bounds())) continue;
        now.add(pl.id);
        if (!t.touching.has(pl.id)) { setSoundOrigin(t.x, t.y); this.touch(t, pl); setSoundOrigin(null); }
        if (!t.alive) break;
      }
      t.touching = now;
    }

    // enemies: update + hero contact (stomp vs. damage). Se despiertan los que están cerca de CUALQUIER amigo, así
    // dos jugadores muy separados (sobre todo en vertical) ven su parte del nivel funcionando.
    const alivePl = this.players.filter((p) => p.hero.isAlive() && !p.eliminated);
    // ¿está (x, y) cerca de ALGÚN amigo vivo? (no del recuadro que los abarca a todos: entre dos amigos lejanos no hay nada)
    const nearAny = (x: number, y: number, h: number, mx: number, my: number): boolean =>
      alivePl.some((p) => Math.abs(p.hero.pos.x - x) < mx && y >= p.hero.pos.y - p.hero.height - my && y - h <= p.hero.pos.y + my);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!nearAny(e.x, e.y, e.h, VIEW_W / 2 + 400, 100)) continue;
      this.focus = { x: e.x, y: e.y };
      setSoundOrigin(e.x, e.y);
      e.update(dt);
      for (const pl of this.players) {
        const h = pl.hero;
        if (!h.isAlive() || pl.eliminated) continue;
        const eb = e.bounds();
        if (!e.ignoresContact && overlaps(h.rect, eb)) {
          if (e.isInstantKill) {
            h.setState(HS.Dead); // StubEnemy/EnemyDeathBarrier: touching = instant death (no damage)
            continue;
          } else if (e.isIndestructible) {
            h.onCollisionEnemy(4); // hazard: contact damage only, never destroyed
          } else if (!e.unstompable && h.vel.y > 0 && h.rect.y + h.rect.h - eb.y < 24) {
            h.bounce();
            if (e.isBoss) { if (e.onBullet(1 / this.soloPenalty)) this.killBoss(e); }
            else this.killEnemy(e, false, pl);
            break;
          } else {
            h.onCollisionEnemy(4);
            if (e.contactRemoves) { this.removeEnemy(e); break; } // original: contact removes the enemy
          }
        } else if (e.alive) {
          // extra enemies' melee strikes (SVNZ red rects) hurt like a contact without consuming the enemy
          const ar = e.attackRect();
          if (ar && overlaps(h.rect, ar)) h.onCollisionEnemy(4);
        }
      }
    }
    this.focus = null;
    setSoundOrigin(null);
    this.enemies = this.enemies.filter((e) => e.alive);
    if (this.spawned.length) { this.enemies.push(...this.spawned); this.spawned = []; }

    const cam = this.camera;
    // en coop la ventana es la de TODOS los amigos: la cámara del anfitrión puede estar lejos y las balas de un
    // invitado (o las que viajan entre ambos) tienen que seguir vivas hasta salir de la zona de todos
    const coopWindow = !!this.coop && alivePl.length > 0;
    for (const b of this.bullets) {
      if (!b.alive) continue;
      setSoundOrigin(b.x, b.y);
      if (b.g) b.vy += b.g * dt;
      if (b.ax) b.vx += b.ax * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const out = coopWindow
        ? !nearAny(b.x, b.y, 0, VIEW_W / 2 + 496, 196)
        : b.x < cam.x - 32 || b.x > cam.x + cam.w + 32 || b.y < cam.y - 32 || b.y > cam.y + cam.h + 32;
      if (out) {
        b.alive = false;
        continue;
      }
      if (this.map.stateAt(b.x, b.y) === TileState.Hard) {
        b.alive = false;
        playSound(Math.random() < 0.5 ? 'BULLET_WALL_1' : 'BULLET_WALL_2');
        const ts = this.map.ts;
        if (Math.abs(b.vy) < Math.abs(b.vx) * 3) {
          // Scenario: a shot going sideways splashes on the wall (SHIELD / SHIELD_GREEN, snapped to the tile edge)
          const ex = Math.round(b.x / ts) * ts - 1;
          this.addEffect(b.team === 0 ? 'SHIELD_GREEN' : 'SHIELD', ex, b.y - 3, -Math.sign(b.vx));
        } else {
          // ...a falling / rising one splashes on the floor (SHIELD_DOWN) or the ceiling (SHIELD_UP)
          this.addEffect(b.vy <= 0 ? 'SHIELD_UP' : 'SHIELD_DOWN', b.x, b.y - 3, 1);
        }
        continue;
      }
      if (b.team === 0) {
        // disparos de los amigos: nunca lastiman a otro amigo, solo a los enemigos
        const dmg = (b.dmg ?? 1) / this.soloPenalty;
        for (const e of this.enemies) {
          if (!e.alive || e.isBulletProof) continue;
          if (overlaps({ x: b.x - 3, y: b.y - 3, w: 6, h: 6 }, e.bounds())) {
            b.alive = false;
            this.addEffect('GREEN_SHINE', b.x, b.y, -Math.sign(b.vx) || 1);
            if (e.isIndestructible) break;
            if (e.isBoss) {
              this.camera.shake(0.2); // EnemyBoss::onCollision: every hit shakes the camera
              if (e.onBullet(dmg)) this.killBoss(e);
            } else if (e.onBullet(dmg)) { this.killEnemy(e, true, b.pl); this.grantKey(e); }
            break;
          }
        }
      } else {
        // disparos enemigos: pueden pegarle a cualquiera de los amigos
        for (const pl of this.players) {
          const h = pl.hero;
          if (!h.isAlive() || pl.eliminated) continue;
          // bullets are 6x6 rects (XABulletFactory setSize(6,6)); while Xa blocks facing the shot, the hit area
          // reaches the front of the raised shield so the bullet visibly smashes against it
          const hr = h.hitRectFor(b.vx);
          if (overlaps({ x: b.x - 3, y: b.y - 3, w: 6, h: 6 }, hr)) {
            b.alive = false;
            h.onBullet(b.x, b.y, Math.sign(b.vx));
            break;
          }
        }
      }
    }
    setSoundOrigin(null);
    this.bullets = this.bullets.filter((b) => b.alive);

    this.updateAnimations(dt);
    this.sendSnapIfDue(dt);
  }

  /** Castigo de dificultad en vivo (multiplicador de vida, cadencia de disparo y refuerzos). Sube si queda un único
   *  amigo vivo, si alguien se separó de todos, o si el que va primero se adelanta más de AHEAD_COLS columnas del
   *  promedio de los demás (proporcional a cuánto se adelanta, con tope). Se relaja de a poco cuando el grupo se junta;
   *  si no queda nadie vivo se mantiene como venía. */
  private updateSolo(dt: number, alive: number): void {
    if (!this.coop || alive === 0) return;
    const d = this.coop.difficulty;
    const live = this.players.filter((p) => p.hero.isAlive() && !p.eliminated);
    let solo = alive === 1;
    if (alive > 1) {
      // ¿alguien quedó lejos de TODOS los demás? (una pantalla de distancia, más margen vertical)
      for (const pl of live) {
        const h = pl.hero;
        const near = live.some((o) => o !== pl && Math.abs(o.hero.pos.x - h.pos.x) < 700 && Math.abs(o.hero.pos.y - h.pos.y) < 420);
        if (!near) { solo = true; break; }
      }
    }
    let target = 1;
    if (solo) {
      this.soloTime += dt;
      if (this.soloTime > d.soloGraceSeconds) {
        target = Math.min(d.soloCap, 1 + (this.soloTime - d.soloGraceSeconds) * d.soloRampPerSecond);
        if (!this.soloWarned) {
          this.soloWarned = true;
          this.message('¡Estás solo! La dificultad sube: busquen a sus amigos.', 4);
        }
      }
    } else {
      this.soloTime = 0;
    }
    // el que va primero se adelantó demasiado del promedio de los demás
    this.aheadId = -1;
    if (alive > 1) {
      const lead = live.reduce((a, b) => (b.hero.pos.x > a.hero.pos.x ? b : a));
      const others = live.filter((p) => p !== lead);
      const avg = others.reduce((t, p) => t + p.hero.pos.x, 0) / others.length;
      const cols = (lead.hero.pos.x - avg) / this.map.ts;
      if (cols > AHEAD_COLS) {
        this.aheadId = lead.id;
        target = Math.max(target, Math.min(d.soloCap, 1 + (cols - AHEAD_COLS) * AHEAD_RAMP_PER_COL));
        if (!this.aheadWarned) {
          this.aheadWarned = true;
          this.message(`¡${lead.name.slice(0, 10) || 'Alguien'} se adelantó! La dificultad sube: esperen al grupo.`, 4);
        }
      } else if (cols < AHEAD_COLS * 0.6) this.aheadWarned = false;
    }
    this.soloPenalty = target > this.soloPenalty
      ? Math.min(target, this.soloPenalty + PENALTY_UP * dt)
      : Math.max(target, this.soloPenalty - PENALTY_DOWN * dt);
    // refuerzos: mientras alguien va muy adelantado aparecen más enemigos delante de él
    this.reinforcements = this.reinforcements.filter((e) => e.alive);
    if (this.aheadId >= 0 && this.soloPenalty > 1.05) {
      this.reinforceT -= dt;
      if (this.reinforceT <= 0) {
        this.reinforceT = REINFORCE_EVERY;
        if (this.reinforcements.length < REINFORCE_MAX) this.reinforceAhead(live.find((p) => p.id === this.aheadId)!);
      }
    } else this.reinforceT = 2;
  }

  /** Clona un enemigo común que esté un poco más adelante del que lidera (viaja a los invitados como los ayudantes de jefe). */
  private reinforceAhead(lead: PlayerRuntime): void {
    const h = lead.hero;
    const pool = this.enemies.filter((e) => e.alive && !e.isBoss && !e.isIndestructible && e.x > h.pos.x + 220 && e.x < h.pos.x + 700 && Math.abs(e.y - h.pos.y) < 200);
    if (!pool.length) return;
    const src = pool[Math.floor(Math.random() * pool.length)];
    const f = feetOf(src.x + (Math.random() < 0.5 ? -1 : 1) * (48 + Math.random() * 40), src.y - 1, this.map.ts);
    const e = this.spawnEnemy(src.o.type, f.x, f.y, src.o.props);
    if (e) this.reinforcements.push(e);
  }

  /** Anfitrión: manda el mundo ~15 veces por segundo (por WebRTC y, si hace falta, por el relé). */
  private sendSnapIfDue(dt: number): void {
    if (this.coop?.role !== 'host' || !this.events.snapshot) return;
    this.snapshotT += dt;
    if (this.snapshotT < 1 / 15) return;
    this.snapshotT = 0;
    this.events.snapshot(this.snapshot());
  }

  // ---------- coop: instantáneas del mundo ----------
  /** Anfitrión: arma la instantánea (claves cortas: viaja muchas veces por segundo). */
  private snapshot(): Snap {
    const r1 = (n: number): number => Math.round(n * 10) / 10;
    const p = this.players.map((pl): Snap['p'][number] => {
      const h = pl.hero;
      return [
        pl.id, r1(h.pos.x), r1(h.pos.y), h.dir, h.state, h.anim.name || h.animName,
        h.anim.frameNum(), r1(h.anim.time), pl.energy, pl.power, r1(pl.powerT), pl.lives,
        h.isAlive() && !pl.eliminated ? 1 : 0, pl.eliminated ? 1 : 0, pl.cereals, pl.heros, pl.score, pl.away ? 1 : 0,
      ];
    });
    // ventana: lo que está cerca de algún amigo (los invitados ven poco más que su cámara)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const pl of this.players) {
      const h = pl.hero;
      x0 = Math.min(x0, h.pos.x - 700); x1 = Math.max(x1, h.pos.x + 700);
      y0 = Math.min(y0, h.pos.y - 500); y1 = Math.max(y1, h.pos.y + 300);
    }
    const near = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1;
    const e = this.enemies.filter((x) => x.alive && near(x.x, x.y)).map((x): Snap['e'][number] =>
      [x.netId, r1(x.x), r1(x.y), x.dir, x.lives, x.netAnim, x.netFrame, r1(x.netTime), r1(x.netFlash)]);
    const b = this.bullets.map((x): Snap['b'][number] =>
      [r1(x.x), r1(x.y), Math.round(x.vx), Math.round(x.vy), x.team, x.tint ?? null, x.big ? 1 : 0, x.g ?? 0, x.ax ?? 0]);
    // las explosiones de jefe viajan como efectos comunes (el invitado solo las dibuja)
    const f = [...this.explosions, ...this.effects].map((x): Snap['f'][number] => [x.anim.name, r1(x.x), r1(x.y), x.dir, r1(x.anim.time)]);
    // las cosas viajan por índice: el invitado armó el mismo mundo, así que los índices coinciden
    const i: Snap['i'] = [];
    this.things.forEach((t, idx) => {
      if (t.o.type !== 'SavePoint' && !near(t.x, t.y)) return;
      i.push([idx, r1(t.x), r1(t.y), t.alive ? 1 : 0, r1(t.rescueTime), t.anim?.name ?? t.mapName ?? '', r1(t.anim?.time ?? 0)]);
    });
    const s = this.state;
    const snap: Snap = {
      v: 1, n: 0, p, e, b, f, i,
      c: [Math.round(this.camera.x), Math.round(this.camera.y)],
      s: [s.score, s.coins, s.cows, s.totalCows, s.keysHud ? 1 : 0, [...s.keys]],
      d: Math.round(this.soloPenalty * 100) / 100,
    };
    if (this.sfx.length) snap.a = this.sfx.map((f) => `${f.q}|${f.id}|${f.x === undefined ? '' : Math.round(f.x)}|${f.y === undefined ? '' : Math.round(f.y)}`);
    if (this.pointsFx.length) snap.pf = this.pointsFx.map((p) => [p.value, Math.round(p.x), Math.round(p.y), r1(p.t)]);
    if (this.platforms.length) snap.pl = this.platforms.map((p) => [r1(p.x), r1(p.y)]);
    if (this.doors.some((d) => d.open)) snap.dr = this.doors.map((d) => (d.open ? 1 : 0));
    if (this.aheadId >= 0) snap.ah = this.aheadId;
    if (this.hostPaused) snap.ps = 1;
    if (!this.players.some((p) => p.hero.isAlive() && !p.eliminated)) snap.ms = 1;
    if (this.deadIds.length) snap.k = this.deadIds.map((d) => d.id);
    if (this.msgT > 0 && this.msgText) snap.m = [this.msgText, Math.round(this.msgT * 10) / 10];
    if (this.savingT > 0) snap.g = Math.round(this.savingT * 10) / 10;
    if (this.music && this.music !== this.lastMusicSent) { snap.mu = this.music; this.lastMusicSent = this.music; }
    if (this.coop?.role === 'host') {
      // los jefes crean ayudantes e ítems mientras pelean: los invitados tienen que crearlos también
      const alive = new Set<number>();
      for (const e of this.enemies) if (e.alive) alive.add(e.netId);
      for (const e of this.spawned) alive.add(e.netId);
      this.dynEnemies = this.dynEnemies.filter((d) => alive.has(d.id));
      if (this.dynEnemies.length) snap.ne = this.dynEnemies.map((d) => [d.id, d.type, d.x, d.y, d.props]);
      this.dynItems = this.dynItems.filter((d) => this.things[d.idx]?.alive);
      if (this.dynItems.length) snap.ni = this.dynItems.map((d) => [d.idx, d.asset, d.x, d.y, d.count]);
    }
    return snap;
  }

  /** Invitado: aplica la instantánea del anfitrión (posiciones, enemigos, balas, cosas y estado compartido). */
  applySnap(s: Snap): void {
    if (!s) return;
    if (s.end) { this.events.onlineEnd?.(s.end === 1 ? 'win' : 'over'); return; }
    if (s.v !== 1) return;

    if (s.p) {
      // quien no viene en la instantánea no está en el nivel del anfitrión (entró a la sala y todavía no juega)
      const seen = new Set(s.p.map((r) => r[0]));
      for (const pl of this.players) if (!seen.has(pl.id)) { pl.away = true; pl.eliminated = true; pl.hero.visible = false; }
      for (const r of s.p) {
        const pl = this.players.find((x) => x.id === r[0]);
        if (!pl) continue;
        pl.away = !!r[17];
        pl.energy = r[8];
        pl.power = r[9] ?? null;
        pl.powerT = r[10];
        pl.lives = r[11];
        pl.eliminated = !!r[13];
        pl.cereals = r[14] ?? 0;
        pl.heros = r[15] ?? 0;
        pl.score = r[16] ?? 0;
        pl.hero.applyNet(r[1], r[2], r[3], r[4] as HS, r[5], r[7], !!r[12], pl.eliminated);
      }
    }

    if (s.ne) for (const [id, type, x, y, props] of s.ne) this.addNetEnemy(id, type, x, y, props);
    if (s.e) {
      const byId = new Map<number, Enemy>();
      for (const e of this.enemies) if (e.alive && e.netId) byId.set(e.netId, e);
      for (const r of s.e) {
        const e = byId.get(r[0]);
        if (e) e.applyNet(r[1], r[2], r[3], r[4], r[5], r[7], r[8]);
      }
    }
    if (s.k?.length) {
      const dead = new Set(s.k);
      for (const e of this.enemies) if (e.alive && dead.has(e.netId)) e.alive = false;
      this.enemies = this.enemies.filter((e) => e.alive);
      this.deadIds = [];
    }

    if (s.b) {
      this.bullets = s.b.map(([x, y, vx, vy, team, tint, big, g, ax]) =>
        ({ x, y, vx, vy, team, alive: true, tint: tint ?? undefined, big: !!big, g: g || undefined, ax: ax || undefined }));
    }
    if (s.f) {
      this.effects = s.f.flatMap(([name, x, y, dir, time]) => {
        const a = new Anim(name);
        if (!a.type) return [];
        a.time = time;
        return [{ anim: a, x, y, dir }];
      });
    }
    if (s.ni) for (const [idx, asset, x, y, count] of s.ni) this.addNetItem(idx, asset, x, y, count);
    if (s.i) {
      for (const [idx, x, y, alive, rescue, anim, time] of s.i) {
        const t = this.things[idx];
        if (!t) continue;
        t.x = x; t.y = y;
        t.alive = !!alive;
        t.rescueTime = rescue;
        if (anim && t.anim?.name !== anim) {
          if (ANIMS[anim]) { t.anim = new Anim(anim); t.mapName = null; }
          else { t.anim = new Anim(anim); t.mapName = anim; }
        }
        if (t.anim) t.anim.time = time;
      }
    }

    if (s.s) {
      const [score, coins, cows, totalCows, keysHud, keys] = s.s;
      this.state.score = score;
      this.state.coins = coins;
      this.state.cows = cows;
      this.state.totalCows = totalCows;
      this.state.keysHud = !!keysHud;
      this.state.keys = keys;
    }
    if (s.d) this.soloPenalty = s.d;
    if (s.m && s.m[0] !== this.lastMsg) this.message(s.m[0], s.m[1]);
    if (s.g && this.prevG <= 0) this.events.saving();
    this.prevG = s.g ?? 0;
    if (s.mu && s.mu !== this.music) { this.music = s.mu; playMusic(s.mu); }
    if (s.a?.length) {
      for (const e of s.a) {
        const [q, id, x, y] = e.split('|');
        if (+q <= this.lastSfxQ) continue; // ya sonó (llegó repetido en otra instantánea)
        this.lastSfxQ = +q;
        playSound(id, x !== '' && y !== '' ? { x: +x, y: +y } : undefined);
      }
    }
    this.pointsFx = (s.pf ?? []).map(([value, x, y, t]) => ({ value, x, y, t }));
    if (s.pl) s.pl.forEach(([x, y], i) => { const p = this.platforms[i]; if (p) { p.prevX = p.x; p.prevY = p.y; p.x = x; p.y = y; } });
    if (s.dr) s.dr.forEach((o, i) => { if (o && this.doors[i]) this.doors[i].open = true; });
    this.aheadId = s.ah ?? -1;
    this.hostPaused = !!s.ps;
    // nadie vivo: el anfitrión corta la música; al reaparecer el primero vuelve
    if (s.ms && !this.guestMusicCut) { this.guestMusicCut = true; stopMusic(); }
    else if (!s.ms && this.guestMusicCut) { this.guestMusicCut = false; if (this.music) playMusic(this.music); }
  }

  /** Invitado: entre instantáneas deja correr animaciones, suaviza el mundo y sigue a su propio héroe. */
  updateGuest(dt: number): void {
    for (const pl of this.players) pl.hero.updateGuest(dt);
    for (const e of this.enemies) if (e.alive) e.updateGuest(dt);
    for (const b of this.bullets) {
      if (b.g) b.vy += b.g * dt;
      if (b.ax) b.vx += b.ax * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (const t of this.things) {
      if (!t.alive) continue;
      t.t += dt;
      t.anim?.update(dt);
      if (t.rescueTime >= 0) { t.rescueTime -= dt; if (t.rescueTime < 0) t.alive = false; }
    }
    for (const d of this.doors) d.update(dt);
    this.updateAnimations(dt);
    const h = this.localPlayer.eliminated ? this.hero : this.localPlayer.hero; // eliminado: sigue a un amigo vivo
    this.camera.update(dt, h.pos.x, h.pos.y, h.height, h.dir, 0, 0, this.winner);
    if (this.fadeDir) {
      this.fade = Math.min(1, Math.max(0, this.fade + this.fadeDir * dt));
      if (this.fade <= 0 && this.fadeDir < 0) this.fadeDir = 0;
    }
  }

  /** Scenario::updateAnimations: the volatile effects (blasts, shines, floating points, boss explosion). */
  private updateAnimations(dt: number): void {
    if (this.msgT > 0) this.msgT -= dt;
    if (this.savingT > 0) this.savingT -= dt;
    if (this.sfx.length) {
      for (const f of this.sfx) f.t += dt;
      this.sfx = this.sfx.filter((f) => f.t < SFX_KEEP);
    }
    if (this.deadIds.length) {
      for (const d of this.deadIds) d.t -= dt;
      this.deadIds = this.deadIds.filter((d) => d.t > 0);
    }
    for (const x of this.explosions) {
      x.anim.update(dt);
      x.t -= dt;
      if (x.pop !== undefined) x.pop -= dt;
      if ((x.pop !== undefined ? x.pop > 0 : x.anim.frameNum() < 3) && x.t <= 0) {
        x.t = Math.random() * 0.1;
        const r = x.rect;
        const px = r.x - 20 + Math.random() * (r.w + 35);
        const k = x.pop !== undefined ? 0 : x.anim.frameNum();
        const py = r.y + k * r.h * 0.2 + Math.random() * (r.h - k * r.h * 0.2);
        this.addEffect('MEGA_POWER', px, py, 1);
      }
    }
    for (const x of this.explosions) {
      if (x.puff !== undefined && x.anim.isOver()) { playSound('ENEMY_DEATH', { x: x.x, y: x.y }); this.addEffect('ENEMY_DEATH', x.x, x.y - x.puff, 1); }
    }
    this.explosions = this.explosions.filter((x) => !x.anim.isOver());
    for (const p of this.pointsFx) p.t += dt;
    this.pointsFx = this.pointsFx.filter((p) => p.t < POINTS_FX_TIME);
    for (const e of this.effects) e.anim.update(dt);
    this.effects = this.effects.filter((e) => !e.anim.isOver());
  }

  private touch(t: Thing, pl: PlayerRuntime): void {
    const s = this.state;
    const p = t.o.props;
    switch (t.o.type) {
      case 'Information':
        if (p.pText) this.message(p.pText, 4);
        playSound('INFO');
        return;
      case 'SavePoint':
        // SavePoint::intersects: becomes the restoration point; when it is a NEW checkpoint: SAVING sound, the
        // HUD "saving" anim and reactionOnAction (switch to its pMusic, e.g. xa_boss before the final boss)
        this.restore = { x: t.x, y: t.y };
        if (this.activeSave !== t) {
          playSound('SAVING');
          this.savingT = 3;
          this.events.saving();
          if (p.pMusic) { this.music = p.pMusic; playMusic(this.music); }
          if (this.activeSave?.anim) this.activeSave.anim.goToAndPlay(0);
          this.activeSave = t;
          // coop: solo la PRIMERA activación de cada punto revive a los eliminados (volver a uno viejo no revive)
          if (this.coop && !this.firstSaves.has(t)) { this.firstSaves.add(t); this.reviveAtSave(t.x, t.y); }
        }
        return;
      case 'Cow':
        if (t.rescueTime < 0) {
          // Cow::intersects: points + VolatilePoints, COW_RESCUED_1, HAPPY_COW anim, HeroState::addCows
          t.mapName = 'HAPPY_COW';
          t.anim = new Anim('HAPPY_COW');
          t.rescueTime = 1.0; // blink time once the anim is over
          s.cows++;
          this.award(COW_POINTS, t.x, t.y - 24, pl);
          playSound('COW_RESCUED_1');
        }
        return;
    }
    const req = p.pRequiredItem ?? p.pAsset;
    const count = +(p.pCount ?? 1) || 1;
    const scout = this.coop ? pl : null; // en coop las vidas/energía/power-ups son de cada amigo
    switch (req) {
      case 'POINTS':
        s.coins++;
        this.addScore(ITEM_POINTS, pl);
        playSound('COIN');
        break;
      case 'LIVES':
        if (scout) scout.lives = Math.min(99, scout.lives + count);
        else s.addLives(count);
        playSound('HERO_LIFE');
        break;
      case 'PU_CRYSTAL': case 'PU_POTION': case 'PU_BATTERY': case 'PU_GEARS':
        // mod power-ups (extra-level boss fights): timed, lost on death and when the boss falls
        if (scout) scout.setPower(req, POWER_TIME);
        else s.setPower(req, POWER_TIME);
        playSound('POWERUP');
        this.message(POWER_TEXT[req], 2.5);
        break;
      case 'ENERGY':
        if (scout) scout.energy = Math.min(MAX_ENERGY, scout.energy + count);
        else s.addEnergy(count);
        playSound('HERO_ENERGY');
        break;
      case 'ENERGY_DOUBLE_JUMP':
        if (scout) scout.cereals = Math.min(1, scout.cereals + 1);
        else s.cereals = Math.min(1, s.cereals + 1); // HeroState::addCereals caps at 1
        playSound('POWERUP');
        break;
      case 'ENERGY_JUMP':
        if (scout) scout.heros = Math.min(4, scout.heros + 1);
        else s.heros = Math.min(4, s.heros + 1);
        playSound('POWERUP');
        break;
      case 'ENDING':
        // la salida no cuenta mientras viva un jefe que custodia una puerta cerrada (niveles extra: solo su muerte abre)
        if (this.enemies.some((e) => e.alive && e.isBoss && !!e.dropsKey) && this.doors.some((d) => !d.open)) return;
        if (!this.winner) {
          this.winner = true;
          pl.hero.winner = true;
          playSound('END_LEVEL');
        }
        return;
      default:
        if (p.pIsKey === 'true') s.keys.push(req ?? '');
        playSound('KEY');
    }
    // Item::intersects: pickup flash at the item's centre — POWER for ordinary items, MEGA_POWER for the
    // special power-up (inferred: the double-jump yogurt; ENDING has none)
    const b = t.bounds();
    this.addEffect(req === 'ENERGY_DOUBLE_JUMP' ? 'MEGA_POWER' : 'POWER', b.x + b.w / 2, b.y + b.h / 2, 1);
    t.alive = false;
  }

  // ---------- render ----------
  render(ctx: CanvasRenderingContext2D): void {
    const cam = this.camera;
    const cx = Math.floor(cam.x), cy = Math.floor(cam.y);

    // background (Decoration::reloadTileMap)
    const bg = img(this.bgPath);
    if (bg) {
      const span = this.map.widthPx - VIEW_W;
      const bx = span > 0 ? -Math.floor(((bg.width - VIEW_W) * cam.x) / span) : 0;
      ctx.drawImage(bg, bx, 0);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // tiles
    const tsImg = img(this.tilesetPath);
    const L = this.level, ts = this.map.ts;
    if (tsImg) {
      const cols = Math.floor(tsImg.width / ts);
      const x0 = Math.floor(cx / ts), y0 = Math.floor(cy / ts);
      for (let ty = y0; ty <= y0 + Math.ceil(VIEW_H / ts); ty++) {
        for (let tx = x0; tx <= x0 + Math.ceil(VIEW_W / ts); tx++) {
          if (tx < 0 || ty < 0 || tx >= L.width || ty >= L.height) continue;
          const id = L.tiles[ty * L.width + tx];
          if (L.tileStates.get(id) === TileState.Invisible) continue;
          ctx.drawImage(tsImg, (id % cols) * ts, Math.floor(id / cols) * ts, ts, ts, tx * ts - cx, ty * ts - cy, ts, ts);
        }
      }
    }

    // objects
    for (const t of this.things) {
      if (!t.alive) continue;
      const sx = t.x - cx, sy = t.y - cy;
      if (sx < -200 || sx > VIEW_W + 200) continue;
      if (t.o.type === 'Cow') {
        // original cow: SAD_COW (caged) -> HAPPY_COW hop/fade once rescued
        if (t.rescueTime >= 0) {
          const blinking = !!t.anim?.isOver();
          if (blinking && Math.floor((1 - t.rescueTime) / 0.05) % 2 === 1) continue;
          const f = t.anim?.frame();
          if (f) drawFrame(ctx, f, sx, sy);
        } else {
          const f = frameOf('SAD_COW', 0);
          if (f) drawFrame(ctx, f, sx, sy);
        }
        continue;
      }
      // checkpoints rest on their SAVE image and only the active one plays its SHINE anim
      const idleSave = t.o.type === 'SavePoint' && t !== this.activeSave;
      const f = (idleSave ? null : t.anim?.frame()) ?? (t.mapName ? frameOf(t.mapName, 0) : null);
      // Item: floats up and down 7 px, easeInOutSin yoyo over 1.5 s (Item::Item / internalUpdate)
      let bob = 0;
      if (t.o.type === 'Item' && t.o.props.pAsset !== 'ENDING') {
        const ph = ((t.t + t.phase) % ITEM_FLOAT) / ITEM_FLOAT, k = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        bob = Math.round(-7 * (1 - Math.cos(Math.PI * k)) / 2);
      }
      if (f) drawFrame(ctx, f, sx, sy + bob);
    }

    // doors + platforms (behind the hero)
    for (const d of this.doors) d.render(ctx, cam.x, cam.y);
    for (const p of this.platforms) p.render(ctx, cam.x, cam.y);

    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.x < cam.x - 120 || e.x > cam.x + VIEW_W + 120) continue;
      e.render(ctx, cam.x, cam.y);
    }

    // amigos: solo los que están en cámara; el jugador de esta pestaña se dibuja último (queda arriba)
    const inView = (pl: PlayerRuntime): boolean => {
      const h = pl.hero;
      return h.pos.x > cam.x - 80 && h.pos.x < cam.x + VIEW_W + 80
        && h.pos.y > cam.y - 120 && h.pos.y < cam.y + VIEW_H + 80;
    };
    const local = this.localPlayer;
    for (const pl of this.players) if (!pl.local && inView(pl)) pl.hero.render(ctx, cam.x, cam.y);
    if (inView(local)) local.hero.render(ctx, cam.x, cam.y);

    if (this.coop) this.renderCoopTags(ctx, inView, cx, cy);

    for (const b of this.bullets) {
      const f = frameOf(b.team === 0 ? 'BULLET' : 'BULLET_ENEMY', 0);
      if (f && b.tint) drawTinted(ctx, f, Math.floor(b.x - cx), Math.floor(b.y - cy), Math.sign(b.vx) || 1, b.tint, 0.9, b.big ? 1.35 : 1);
      else if (f) drawFrame(ctx, f, Math.floor(b.x - cx), Math.floor(b.y - cy), Math.sign(b.vx) || 1);
    }
    for (const e of this.explosions) {
      const f = e.anim.frame();
      if (f) drawFrame(ctx, f, Math.floor(e.x - cx), Math.floor(e.y - cy), e.dir);
    }
    for (const e of this.effects) {
      const f = e.anim.frame();
      if (f) drawFrame(ctx, f, Math.floor(e.x - cx), Math.floor(e.y - cy), e.dir);
    }

    for (const p of this.pointsFx) {
      const k = Math.min(1, p.t / POINTS_FX_TIME);
      const rise = 40 * (1 - Math.pow(1 - k, 5)); // easeOutQuint
      drawLine(ctx, String(p.value), Math.round(p.x - cx), Math.round(p.y - cy - rise - 9), 'pixel', 'center', 1);
    }

    if (this.hostPaused && this.coop?.role === 'guest') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      drawLine(ctx, 'PAUSA DEL ANFITRION', VIEW_W / 2, VIEW_H / 2 - 8, 'white', 'center', 1);
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  /** Coop: nombre de cada amigo sobre la cabeza y un puntero que marca cuál es el jugador de esta pestaña. */
  private renderCoopTags(ctx: CanvasRenderingContext2D, inView: (p: PlayerRuntime) => boolean, cx: number, cy: number): void {
    const local = this.localPlayer;
    // el jugador de esta pestaña se dibuja último (queda arriba) y los nombres que se pisan se apilan
    const visible = this.players.filter((p) => {
      const h = p.hero;
      return inView(p) && h.visible && !p.eliminated && h.isAlive();
    }).sort((a, b) => (a === local ? 1 : 0) - (b === local ? 1 : 0));
    // cada nombre va en su plaquita oscura (se lee sobre cielo, piedra o pasto) de 13 px de alto
    const PLATE_H = 13;
    const STEP = PLATE_H + 1;
    const drawn: { x0: number; x1: number; y: number }[] = [];
    for (const pl of visible) {
      const h = pl.hero;
      const x = Math.round(h.pos.x) - cx;
      const top = Math.round(h.pos.y) - cy - 64;
      const label = (pl.id === this.aheadId ? '!' : '') + (pl.name.slice(0, 10) || 'Xa'); // '!' = el que se adelantó (castigo de dificultad)
      const tint = pl.hex ?? '#ffffff';
      const pw = Math.max(18, Math.min(54, label.length * 5 + 6));
      const x0 = x - Math.round(pw / 2), x1 = x0 + pw;
      // si otro nombre ya ocupa esta franja, subirlo hasta que se lea
      let ty = top;
      for (let guard = 0; guard < 5; guard++) {
        if (!drawn.some((d) => x0 < d.x1 && x1 > d.x0 && Math.abs(d.y - ty) < STEP)) break;
        ty -= STEP;
      }
      // plaquita: fondo negro translúcido, borde inferior con el color del amigo y nombre en blanco
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(x0, ty, pw, PLATE_H);
      ctx.fillStyle = tint;
      ctx.fillRect(x0, ty + PLATE_H - 2, pw, 2);
      drawLine(ctx, label, x, ty + 1, 'white', 'center', 0.5);
      drawn.push({ x0, x1, y: ty });
      if (pl === local) {
        // puntero: triángulo con el color del amigo, subiendo y bajando sobre la plaquita
        const bob = Math.round(Math.sin(performance.now() / 180) * 2);
        const apex = ty - 2 + bob;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(x - 6, apex - 8); ctx.lineTo(x + 6, apex - 8); ctx.lineTo(x, apex);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.moveTo(x - 4, apex - 7); ctx.lineTo(x + 4, apex - 7); ctx.lineTo(x, apex - 2);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  get heroState(): HS { return this.hero.state; }

  resumeMusic(): void {
    if (this.music && this.hero.isAlive()) playMusic(this.music);
  }
}
