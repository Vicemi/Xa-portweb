// Enemies: reimplementation of the Enemy* classes. The TMX object `type` selects the movement pattern and
// the object's own props (pxVel/pyVel/pxDelta/pyDelta/pDuration/pMinTime/pMaxTime/pLives/pLookDir/…) provide
// the parameters — exactly how the original data works. Sprites come from the user's enemy sheets.
import { Anim, ANIMS, drawFrame, frameOf, type Frame } from '../core/sprites';
import { playSound } from '../core/audio';
import type { TmxObject } from './tmx';
import type { World } from './world';

const ENEMY_POINTS = 100;

// type -> movement pattern
const FLYERS = new Set(['Bird', 'UFO', 'SmartUFO', 'Double', 'Bomb', 'Rocket']);
const JUMPERS = new Set(['Jumper', 'Jumper2', 'JumperShooter']);
const STATIC = new Set(['Cannon', 'Stub', 'Spikes', 'Stalactite', 'Lava', 'AcidDrop', 'DeathBarrier', 'DummyDeathBarrier', 'Fire', 'Thrower', 'FixedShooter', 'Down3']);
const SHOOTERS = new Set(['Thrower', 'FloorCannon', 'FixedShooter', 'JumperShooter', 'Cannon', 'Down3', 'Jumper2', 'SmartUFO', 'Double', 'PiranhaRobot']);
const BOSS = new Set(['Boss']);
// InteractiveObject::isInvisibleForBullet → these are ignored by hero bullets.
const BULLET_PROOF = new Set(['Guillotine', 'Rocket']);
// Hazards that kill the hero outright on contact (EnemyDeathBarrier::intersects → Hero::setState(Dead)).
// NOTE: "Stub" (los pinchos) NO está aquí: el usuario confirmó que resta vida, no mata.
const INSTANT_KILL = new Set(['Spikes', 'Stalactite', 'Lava', 'AcidDrop', 'DeathBarrier', 'DummyDeathBarrier', 'Fire']);
// Contact is lethal too, but these remain destructible by bullets (EnemyBomb explodes on death).
const CONTACT_KILL = new Set([...INSTANT_KILL, 'Bomb']);
// Never destroyed by bullets/stomps. "Stub" deals contact damage (no instant death).
const INDESTRUCTIBLE = new Set(['Stub', ...INSTANT_KILL]);

export class Enemy {
  alive = true;
  x: number;      // feet x
  y: number;      // feet y
  w: number;      // collision box
  h: number;
  vx = 0;
  vy = 0;
  dir: number;
  lives: number;
  private anim: Anim | null = null;
  private img: string | null = null;
  private readonly type: string;
  private readonly p: Record<string, string>;
  private readonly homeX: number;
  private readonly homeY: number;
  private t = Math.random() * 6;
  private fireT = 1 + Math.random() * 2;
  private jumpPhase: 'ground' | 'air' = 'ground';
  private jumpT = Math.random() * 1.5;
  private hitFlash = 0;
  private bossShooting = false;

  constructor(private world: World, public o: TmxObject, x: number, y: number) {
    this.type = o.type;
    this.p = o.props;
    this.x = this.homeX = x;
    this.y = this.homeY = y;
    this.w = +(o.w || 32) || 32;
    this.h = +(o.h || 32) || 32;
    this.lives = Math.max(1, +(this.p.pLives ?? 1) || 1);
    this.dir = (+(this.p.pLookDir ?? 1)) || 1;
    this.vx = +(this.p.pxVel ?? 0) || 0;
    this.vy = +(this.p.pyVel ?? 0) || 0;
    const animName = this.p.pAnim ?? '';
    if (animName) this.anim = new Anim(animName);
    else this.img = this.p.pAsset ?? null;
  }

  bounds(): { x: number; y: number; w: number; h: number } {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  get isBoss(): boolean { return BOSS.has(this.type); }
  get isBulletProof(): boolean { return BULLET_PROOF.has(this.type); }
  get isIndestructible(): boolean { return INDESTRUCTIBLE.has(this.type); }
  get isInstantKill(): boolean { return CONTACT_KILL.has(this.type); }
  /** Explodes into a radial burst when killed (EnemyBomb::onCollision). */
  get isBomb(): boolean { return this.type === 'Bomb'; }
  /** Ground-based enemies (walk/patrol/static) ride moving platforms; airborne ones don't. */
  get isGroundBound(): boolean {
    const m = this.movement();
    return m === 'patrol' || m === 'static' || m === 'boss' || m === 'slide';
  }

  /** Called when a hero bullet (team 0) hits this enemy. Returns true if it died. */
  onBullet(): boolean {
    this.lives -= 1;
    this.hitFlash = 0.5;
    playSound('ENEMY_HIT_' + (1 + ((Math.random() * 6) | 0)));
    return this.lives < 1;
  }

  // ---------- update ----------
  update(dt: number): void {
    if (!this.alive) return;
    this.t += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.anim?.update(dt);
    switch (this.movement()) {
      case 'fly': this.fly(dt); break;
      case 'jumper': this.jumper(dt); break;
      case 'guillotine': this.guillotine(dt); break;
      case 'popup': this.popup(dt); break;
      case 'slide': this.slide(dt); break;
      case 'boss': this.boss(dt); break;
      case 'patrol': this.patrol(dt); break;
      default: break; // static
    }
    if (this.canShoot()) {
      switch (this.type) {
        case 'Cannon': this.shootParabola(dt); break;
        case 'SmartUFO': this.shootToHero(dt); break;
        case 'Double': this.shootDoubleSide(dt); break;
        case 'PiranhaRobot': this.shootFall(dt); break;
        case 'FloorCannon': this.shootFallRand(dt); break;
        default: this.shoot(dt); break;
      }
    }
  }

  private movement(): string {
    if (FLYERS.has(this.type)) return 'fly';
    if (JUMPERS.has(this.type)) return 'jumper';
    if (this.type === 'Guillotine') return 'guillotine';
    if (this.type === 'PiranhaRobot') return 'popup';
    if (this.type === 'FloorCannon') return 'slide';
    if (STATIC.has(this.type)) return 'static';
    if (BOSS.has(this.type)) return 'boss';
    return 'patrol';
  }

  private canShoot(): boolean {
    return !!this.p.pBulletAsset || SHOOTERS.has(this.type);
  }

  // ground patrol: walks at pxVel, turns at walls (pCollidesH) and at edges (pCollidesFloor).
  private patrol(dt: number): void {
    const spd = Math.abs(+(this.p.pxVel ?? 70) || 70);
    this.x += this.dir * spd * dt;
    const ts = this.world.map.ts;
    const aheadX = this.dir > 0 ? this.x + this.w / 2 + 2 : this.x - this.w / 2 - 2;
    // Sample the whole vertical span (head→feet) so tall enemies don't walk through walls.
    let wall = false;
    if (this.p.pCollidesH === 'true') {
      for (let y = this.y - this.h + 2; y < this.y && !wall; y += ts) wall = this.world.map.isHard(aheadX, y);
      if (!wall) wall = this.world.map.isHard(aheadX, this.y - 2);
    }
    const edge = this.p.pCollidesFloor === 'true' && !this.world.hasFloor(aheadX, this.y + 2);
    if (wall || edge) {
      this.dir *= -1;
      this.x += this.dir * 4;
    }
  }

  // flying: EnemyBird eases back and forth (easeInOutSin) over pDuration with a sine vertical bob.
  private fly(dt: number): void {
    const dur = Math.max(0.6, +(this.p.pDuration ?? 4) || 4);
    const ph = (this.t % (dur * 2)) / dur;      // 0..2 over a full out-and-back cycle
    const e = ph <= 1 ? ph : 2 - ph;            // 0..1..0
    const ease = (1 - Math.cos(Math.PI * e)) / 2; // easeInOutSin
    const pxDelta = +(this.p.pxDelta ?? 40);
    const pyDelta = +(this.p.pyDelta ?? 20);
    this.x = this.homeX + ease * pxDelta;
    this.y = this.homeY + Math.sin(ph * Math.PI) * pyDelta;
    this.dir = ph <= 1 ? (pxDelta >= 0 ? 1 : -1) : (pxDelta >= 0 ? -1 : 1);
  }

  // Jumper: physics hop — lands (plays its anim), then leaps up at a fixed -200 with pxVel, gravity pyAccel,
  // and bounces off walls (Jumper::internalUpdate / intersectVertical / intersectHorizontal).
  private jumper(dt: number): void {
    const grav = +(this.p.pyAccel ?? 300) || 300;
    const spd = Math.abs(+(this.p.pxVel ?? 120)) || 120;
    if (this.jumpPhase === 'ground') {
      this.jumpT -= dt;
      if (this.jumpT <= 0) {
        this.jumpPhase = 'air';
        this.vy = -200;
        this.vx = this.dir * spd;
        playSound('ENEMY_JUMP');
      }
    } else {
      this.vy += grav * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      // bounce off walls
      const midY = this.y - this.h * 0.5;
      const aheadX = this.vx > 0 ? this.x + this.w / 2 + 2 : this.x - this.w / 2 - 2;
      if (this.p.pCollidesH === 'true' && this.world.map.isHard(aheadX, midY)) {
        this.vx *= -1;
        this.dir *= -1;
      }
      // land on floor/platform → pause for the "ready" animation, then hop again
      if (this.vy > 0 && this.world.hasFloor(this.x, this.y + 2)) {
        const ts = this.world.map.ts;
        this.y = Math.floor((this.y + 2) / ts) * ts - 1;
        this.vy = 0;
        this.vx = 0;
        this.jumpPhase = 'ground';
        this.anim?.goToAndPlay(0);
        this.jumpT = this.anim ? this.anim.duration() : 0.25;
      }
    }
  }

  // trap that waits at the top (pWait), falls (pDuration over pyDelta) and retracts cyclically.
  private guillotine(dt: number): void {
    const fall = Math.max(0.1, +(this.p.pDuration ?? 0.5) || 0.5);
    const wait = +(this.p.pWait ?? 1.7) || 0;
    const retract = 0.4;
    const delta = +(this.p.pyDelta ?? 100) || 100;
    const cyc = wait + fall + retract, ph = this.t % cyc;
    if (ph < wait) this.y = this.homeY;
    else if (ph < wait + fall) this.y = this.homeY + ((ph - wait) / fall) * delta;
    else this.y = this.homeY + delta * Math.max(0, 1 - (ph - wait - fall) / retract);
  }

  // vertical thrust (PiranhaRobot).
  private popup(dt: number): void {
    const dur = Math.max(0.1, +(this.p.pDuration ?? 1) || 1);
    const wait = Math.max(0.1, +(this.p.pMinTime ?? 1) || 1);
    const delta = +(this.p.pyDelta ?? -120) || -120;
    const cyc = dur + wait, ph = this.t % cyc;
    this.y = this.homeY + delta * (ph < dur ? Math.min(1, ph / dur) : Math.max(0, 1 - (ph - dur) / dur));
  }

  // FloorCannon: eases back and forth along X.
  private slide(dt: number): void {
    const w = (2 * Math.PI) / Math.max(0.6, +(this.p.pDuration ?? 4) || 4);
    const p = (Math.sin(this.t * w - Math.PI / 2) + 1) / 2;
    this.x = this.homeX + p * +(this.p.pxDelta ?? 60);
  }

  // boss: patrols, stops to play "BOSS_SHOOT", and fires a 5-bullet fan ("BOSS_BULLETS") toward the hero.
  private boss(dt: number): void {
    if (!this.bossShooting) {
      this.patrol(dt);
      this.fireT -= dt;
      if (this.fireT <= 0) {
        const hero = this.world.hero;
        if (hero.isAlive() && Math.abs(hero.pos.x - this.x) < 500) {
          this.dir = hero.pos.x < this.x ? -1 : 1;
          this.bossShooting = true;
          this.anim?.set('BOSS_SHOOT');
          // 5-bullet fan at 60°..120° from "up", speed 200, mirrored by facing direction.
          for (let i = 0; i < 5; i++) {
            const ang = Math.PI / 3 + i * (Math.PI / 12);
            this.world.spawnEnemyBullet(
              this.x + this.dir * 20, this.y - this.h * 0.5,
              this.dir * Math.sin(ang) * 200, -Math.cos(ang) * 200,
            );
          }
        }
      }
    } else if (this.anim && this.anim.isOver()) {
      this.bossShooting = false;
      this.anim.set(this.p.pAnim ?? 'BOSS');
      this.fireT = +(this.p.pMinTime ?? 0.5) + Math.random() * Math.max(0, +(this.p.pMaxTime ?? 1.5) - +(this.p.pMinTime ?? 0.5));
    }
  }

  // stationary turret: fires toward the hero on a pMinTime..pMaxTime cadence.
  private shoot(dt: number): void {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    const hero = this.world.hero;
    if (!hero.isAlive()) return;
    const dx = hero.pos.x - this.x;
    if (Math.abs(dx) > 420) return;
    const dir = dx < 0 ? -1 : 1;
    this.dir = dir;
    this.world.spawnEnemyBullet(this.x + dir * 14, this.y - this.h * 0.5, dir * 240, 0);
    this.fireT = +(this.p.pMinTime ?? 1.5) + Math.random() * Math.max(0, +(this.p.pMaxTime ?? 3) - +(this.p.pMinTime ?? 1.5));
  }

  // "Cannon" (Parabolon): lobs a projectile in a fountain arc (XABulletFactory: launch up at 12°, gravity 400).
  private shootParabola(dt: number): void {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    const hero = this.world.hero;
    if (!hero.isAlive()) return;
    const dx = hero.pos.x - this.x;
    if (Math.abs(dx) > 420) return;
    this.dir = dx < 0 ? -1 : 1;
    const speed = 300 + Math.random() * 80;
    const a = this.dir * (12 * Math.PI / 180);
    this.world.spawnEnemyBullet(this.x, this.y - this.h, Math.sin(a) * speed, -Math.cos(a) * speed, 400);
    this.fireT = +(this.p.pMinTime ?? 1.5) + Math.random() * Math.max(0, +(this.p.pMaxTime ?? 3) - +(this.p.pMinTime ?? 1.5));
  }

  // SmartUFO: "TO_HERO" — fires straight at the hero (speed 300).
  private shootToHero(dt: number): void {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    const hero = this.world.hero;
    if (!hero.isAlive()) return;
    const y = this.y - this.h * 0.5;
    const dx = hero.pos.x - this.x;
    const dy = hero.pos.y - 22 - y;
    const m = Math.hypot(dx, dy) || 1;
    this.dir = dx < 0 ? -1 : 1;
    this.world.spawnEnemyBullet(this.x, y, (dx / m) * 300, (dy / m) * 300);
    this.fireT = +(this.p.pMinTime ?? 1.5) + Math.random() * Math.max(0, +(this.p.pMaxTime ?? 3) - +(this.p.pMinTime ?? 1.5));
  }

  // Double: "DOUBLE_SIDE" — two horizontal bullets, one left and one right (speed 224).
  private shootDoubleSide(dt: number): void {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    if (!this.world.hero.isAlive()) return;
    const y = this.y - this.h * 0.5;
    this.world.spawnEnemyBullet(this.x, y, 224, 0);
    this.world.spawnEnemyBullet(this.x, y, -224, 0);
    this.fireT = +(this.p.pMinTime ?? 1) + Math.random() * Math.max(0, +(this.p.pMaxTime ?? 3) - +(this.p.pMinTime ?? 1));
  }

  // PiranhaRobot: "4_FALL" — drops a bullet that falls straight down (gravity 300).
  private shootFall(dt: number): void {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    if (!this.world.hero.isAlive()) return;
    this.world.spawnEnemyBullet(this.x, this.y - this.h, 0, 0, 300);
    this.fireT = +(this.p.pMinTime ?? 1.2) + Math.random() * Math.max(0, +(this.p.pMaxTime ?? 1.5) - +(this.p.pMinTime ?? 1.2));
  }

  // FloorCannon: "4_FALL_RAND" — four bullets launched up at ±30°/±15°, arcing back down (gravity 300).
  private shootFallRand(dt: number): void {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    if (!this.world.hero.isAlive()) return;
    const y = this.y - this.h;
    const base = Math.PI / 6; // 30°
    for (const a of [base, -base, base * 0.5, -base * 0.5]) {
      const spd = 220 + (Math.random() * 50 - 25);
      this.world.spawnEnemyBullet(this.x, y, Math.sin(a) * spd, -Math.cos(a) * spd, 300);
    }
    this.fireT = +(this.p.pMinTime ?? 2) + Math.random() * Math.max(0, +(this.p.pMaxTime ?? 3) - +(this.p.pMinTime ?? 2));
  }

  // ---------- render ----------
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const x = Math.round(this.x - camX);
    const y = Math.round(this.y - camY);
    const f = this.currentFrame();
    if (!f) return;
    drawFrame(ctx, f, x, y, this.dir);
  }

  private currentFrame(): Frame | null {
    const flash = this.hitFlash > 0;
    if (this.anim) {
      const base = this.anim.frame();
      if (flash) {
        const r = ANIMS[this.anim.name + '_R'];
        if (r) {
          const fd = r.frames[Math.min(this.anim.frameNum(), r.frames.length - 1)];
          const f = frameOf(fd.map, fd.i);
          if (f) return f;
        }
      }
      return base;
    }
    if (this.img) {
      const name = flash ? this.img + '_R' : this.img;
      return frameOf(name, 0) ?? frameOf(this.img, 0);
    }
    return null;
  }
}

/** Creates an enemy from a TMX object (feet already resolved to `x`,`y`). Returns null for non-enemies. */
export function createEnemy(o: TmxObject, world: World, x: number, y: number): Enemy | null {
  switch (o.type) {
    case 'Enemy': case 'Android': case 'Ultraton': case 'Stub': case 'Bird':
    case 'UFO': case 'SmartUFO': case 'Double': case 'Bomb': case 'Rocket':
    case 'Jumper': case 'Jumper2': case 'JumperShooter': case 'Thrower': case 'FloorCannon':
    case 'Cannon': case 'Down3': case 'FixedShooter': case 'PiranhaRobot': case 'Guillotine':
    case 'Spikes': case 'Stalactite': case 'Lava': case 'AcidDrop':
    case 'DeathBarrier': case 'DummyDeathBarrier': case 'Fire': case 'Boss':
    case 'Meteorite':
      return new Enemy(world, o, x, y);
    default:
      return null;
  }
}
