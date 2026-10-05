// Enemies: reimplementation of the Enemy* classes. The TMX object `type` selects the movement pattern and
// the object's own props (pxVel/pyVel/pxDelta/pyDelta/pDuration/pMinTime/pMaxTime/pLives/pLookDir/…) provide
// the parameters — exactly how the original data works. Sprites come from the user's enemy sheets.
import { Anim, ANIMS, drawFrame, frameOf, type Frame } from '../core/sprites';
import { playSound } from '../core/audio';
import type { TmxObject } from './tmx';
import type { World } from './world';

// Points each type awards when killed (InteractiveObject::setPoints in the Windows Scenario::loadObjects:
// `mov [obj+0x394], imm` right after each type-name compare; see tools/xre_points.py).
const POINTS: Record<string, number> = {
  Enemy: 5, Bird: 10, Jumper: 15, Double: 20, Ultraton: 25, Thrower: 30, Cannon: 35, Down3: 40, Jumper2: 45,
  UFO: 50, FloorCannon: 55, PiranhaRobot: 60, Bomb: 65, SmartUFO: 75, Android: 80, Boss: 80,
};

// type -> movement pattern
const FLYERS = new Set(['Bird', 'UFO', 'SmartUFO', 'Double', 'Bomb', 'Rocket']);
const JUMPERS = new Set(['Jumper', 'Jumper2', 'JumperShooter']);
const STATIC = new Set(['Cannon', 'Stub', 'Spikes', 'Stalactite', 'Lava', 'AcidDrop', 'DeathBarrier', 'DummyDeathBarrier', 'Fire', 'Thrower', 'FixedShooter', 'Down3']);
// Shooter subclasses with autoShoot (fire on their own pMinTime..pMaxTime timer, synced to their anim).
// Android / Thrower / Jumper2 / Boss have their own triggers (see update()).
const AUTO_SHOOTERS: Record<string, string> = {
  Cannon: 'PARABLE', Down3: '3_FALL', SmartUFO: 'TO_HERO', Double: 'DOUBLE_SIDE',
  FloorCannon: '4_FALL_RAND', FixedShooter: 'SIMPLE_ENEMY',
  UFO: 'SIMPLE_ENEMY', // EnemyUFO: Shooter SIMPLE_ENEMY, offset (30,-4), toward the side it flies
};
const BOSS = new Set(['Boss']);
const NO_CONTACT = new Set(['Thrower', 'Cannon', 'Down3', 'FixedShooter']);
// InteractiveObject::isInvisibleForBullet → these are ignored by hero bullets.
const BULLET_PROOF = new Set(['Guillotine', 'Rocket']);
// Hazards that kill the hero outright on contact (Hero::setState(9)). "Stub" = the spiky balls (UFO_SPIKY):
// StubEnemy::intersects kills on any overlap with its TMX rect, as the level-1 sign warns ("¡Si pisas estos
// objetos punteagudos morirás al instante!").
// EnemyGuillotine is an EnemyDeathBarrier (isHostile = 1): its blade kills on touch too.
const INSTANT_KILL = new Set(['Stub', 'Guillotine', 'Spikes', 'Stalactite', 'Lava', 'AcidDrop', 'DeathBarrier', 'DummyDeathBarrier', 'Fire']);
// Contact is lethal too, but these remain destructible by bullets (EnemyBomb explodes on death).
// EnemyUltraton::intersects (inherited by EnemyBoss): touching them = Hero::setState(9); bullets only.
const CONTACT_KILL = new Set([...INSTANT_KILL, 'Bomb', 'Ultraton', 'Boss']);
// Never destroyed by bullets/stomps.
const INDESTRUCTIBLE = new Set(INSTANT_KILL);

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
  private t = 0; // EnemyBird::initInterpolaltion starts every cycle at phase 0
  private fireT = 1 + Math.random() * 2;
  private shotPending = false;   // Shooter: waiting for the sync anim to reach the firing frame
  private androidStopped = false; // EnemyAndroid: halted while playing ANDROID_SHOOT
  private walkVel = 0;
  private piranha: 'wait' | 'rise' | 'shoot' | 'sink' = 'wait';
  private phaseT = 0;
  private blade: 'wait' | 'drop' | 'rest' | 'rise' = 'wait';
  private ext = 0; // guillotine blade extension (0..pyDelta)
  private prevFrame = 0;
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
    this.vx = +(this.p.pxVel ?? 0) || 0;
    // Enemy::Enemy: facing = sign(pLookDir) if set, otherwise sign(pxVel) (e.g. pxVel=-120 starts walking left).
    const look = +(this.p.pLookDir ?? 0) || 0;
    this.dir = look ? Math.sign(look) : (this.vx < 0 ? -1 : 1);
    if (this.type === 'Thrower') this.dir = (+(this.p.pxOffset ?? 1) || 1) > 0 ? 1 : -1;
    this.vy = +(this.p.pyVel ?? 0) || 0;
    this.fireT = this.randomWait();
    const animName = o.type === 'Boss' ? 'BOSS' : this.p.pAnim ?? '';
    if (animName) this.anim = new Anim(animName);
    else this.img = this.p.pAsset ?? null;
  }

  bounds(): { x: number; y: number; w: number; h: number } {
    // spiky balls: the object's bound is its image (UFO_SPIKY 38x27, anchor 20,24) where it is drawn, trimmed to
    // the visible spikes, so touching what you see kills and the empty top of the tile doesn't
    if (this.type === 'Stub') {
      const f = this.img ? frameOf(this.img, 0) : null;
      if (f) return { x: this.x - f.ax + 3, y: this.y - f.ay + 3, w: f.sw - 6, h: f.sh - 4 };
    }
    if (this.type === 'Guillotine') {
      const b = this.bladeRect();
      if (b) return { x: b.x + 6, y: b.y, w: b.f.sw - 12, h: b.h };
    }
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  get isBoss(): boolean { return BOSS.has(this.type); }
  /** intersects returns 0 without touching the hero: EnemyThrower and the fixed turrets (Cannon / Down3 share the
   *  EnemyFixedShooter-style ctor 0x434e10 in the Windows loadObjects). */
  get ignoresContact(): boolean { return NO_CONTACT.has(this.type); }
  /** EnemySmartUFO::intersects: any touch hurts (4) and removes it — it can't be stomped. */
  get unstompable(): boolean { return this.type === 'SmartUFO'; }
  get points(): number { return POINTS[this.type] ?? 0; }
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
  /** True when close enough to the hero that its sounds should be audible (audio proximity). */
  private nearHero(): boolean {
    const hero = this.world.hero;
    if (!hero.isAlive()) return false;
    return Math.abs(hero.pos.x - this.x) < 420;
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
      case 'patrol': if (!this.androidStopped) this.patrol(dt); break;
      default: break; // static
    }
    switch (this.type) {
      case 'Android': this.androidShoot(dt); break;
      case 'Thrower': this.thrower(dt); break;
      case 'Jumper2': case 'JumperShooter': this.cobraShoot(); break;
      default:
        if (AUTO_SHOOTERS[this.type]) this.autoShoot(dt, AUTO_SHOOTERS[this.type]);
        break;
    }
  }

  private randomWait(): number {
    const lo = +(this.p.pMinTime ?? 1.5) || 0, hi = +(this.p.pMaxTime ?? 3) || 0;
    return lo + Math.random() * Math.max(0, hi - lo);
  }

  /** Shooter::shooterUpdate with autoShoot: when the timer runs out the sync anim is rewound and played; the
   *  bullets are created when it finishes (frame sync -1), then a new pMinTime..pMaxTime wait starts. */
  private autoShoot(dt: number, pattern: string): void {
    if (!this.shotPending) {
      this.fireT -= dt;
      if (this.fireT > 0) return;
      this.fireT = this.randomWait();
      this.anim?.goToAndPlay(0);
      this.shotPending = true;
    }
    if (this.anim && !this.anim.isOver() && this.anim.type?.loop === 0) return;
    this.shotPending = false;
    this.createBullets(pattern);
  }

  /** XABulletFactory::createBullets for the enemy patterns. */
  private createBullets(pattern: string): void {
    const W = this.world, cx = this.x, cy = this.y - this.h * 0.5;
    switch (pattern) {
      case 'SIMPLE_ENEMY': {
        const [ox, oy] = this.type === 'UFO' ? [30, -4] : [14, 0];
        W.spawnEnemyBullet(cx + this.dir * ox, cy + oy, this.dir * 240, 0);
        break;
      }
      case 'TO_HERO': {
        const hero = W.hero;
        const dx = hero.pos.x - cx, dy = hero.pos.y - 22 - cy;
        const m = Math.hypot(dx, dy) || 1;
        this.dir = dx < 0 ? -1 : 1;
        W.spawnEnemyBullet(cx, cy, (dx / m) * 300, (dy / m) * 300);
        break;
      }
      case 'DOUBLE_SIDE': {
        // two bullets at ±224 from (centre ± 45, top + 17)
        const by = this.y - this.h + 17;
        W.spawnEnemyBullet(cx + 45, by, 224, 0);
        W.spawnEnemyBullet(cx - 45, by, -224, 0);
        break;
      }
      case 'PARABLE': {
        // fountain lob at 12° from vertical, toward the cannon's own facing (sign of pxVel), gravity 400
        const speed = 300 + Math.random() * 80;
        const a = this.dir * (12 * Math.PI / 180);
        W.spawnEnemyBullet(cx, this.y - this.h, Math.sin(a) * speed, -Math.cos(a) * speed, 400);
        break;
      }
      case '3_FALL': {
        // one bullet drops straight down, two drift out at ±100 px/s braking at ∓70, all with gravity 300
        const by = this.y;
        W.spawnEnemyBullet(cx, by, 0, 0, 300);
        W.spawnEnemyBullet(cx, by, 100, 0, 300, -70);
        W.spawnEnemyBullet(cx, by, -100, 0, 300, 70);
        break;
      }
      case '4_FALL': case '4_FALL_RAND': {
        // four bullets launched up at ±30° / ±15°, |v| = base ± 25, x-accel ∓15, gravity 300
        const base = pattern === '4_FALL' ? 220 : 300;
        const by = this.y - this.h;
        const k = Math.PI / 6;
        const shots: [number, number, boolean][] = [[k, -15, true], [-k, 15, true], [k / 2, -15, true], [-k / 2, 15, false]];
        for (const [ang, ax, rnd] of shots) {
          const v = base + (rnd ? Math.random() * 50 - 25 : 0);
          W.spawnEnemyBullet(cx, by, Math.sin(ang) * v, -Math.cos(ang) * v, 300, ax);
        }
        break;
      }
    }
  }

  /** EnemyAndroid::internalUpdate: every pMinTime..pMaxTime s, if the hero is AHEAD in its walking direction it
   *  stops, plays ANDROID_SHOOT and fires SIMPLE_ENEMY on frame 1 (offset 22,5); then resumes walking. A hero
   *  behind it is ignored until the next wait. */
  private androidShoot(dt: number): void {
    if (this.androidStopped) {
      if (this.anim && !this.shotPending && this.anim.frameNum() >= 1) {
        this.shotPending = true;
        this.world.spawnEnemyBullet(this.x + this.dir * 22, this.y - this.h * 0.5 + 5, this.dir * 240, 0);
      }
      if (!this.anim || this.anim.isOver()) {
        this.androidStopped = false;
        this.shotPending = false;
        this.anim?.set(this.p.pAnim ?? 'ANDROID');
        this.fireT = this.randomWait();
      }
      return;
    }
    this.fireT -= dt;
    if (this.fireT > 0) return;
    const hero = this.world.hero;
    const ahead = hero.isAlive() && (this.dir > 0 ? hero.pos.x > this.x : hero.pos.x < this.x);
    if (!ahead) { this.fireT = this.randomWait(); return; }
    this.androidStopped = true;
    this.shotPending = false;
    this.anim?.set('ANDROID_SHOOT');
    this.anim?.goToAndPlay(0);
  }

  /** EnemyThrower (WALLE): idles on frame 0 for pMinTime..pMaxTime, then plays its anim and throws one
   *  BULLET_ENEMY at 240 px/s toward its fixed facing (sign of pxOffset) from object pos + (pxOffset, pyOffset). */
  private thrower(dt: number): void {
    const ox = +(this.p.pxOffset ?? 0) || 0, oy = +(this.p.pyOffset ?? 0) || 0;
    if (!this.shotPending) {
      this.fireT -= dt;
      if (this.anim) this.anim.goToAndPlay(0);
      if (this.fireT > 0) return;
      this.shotPending = true;
      this.prevFrame = 0;
    }
    const f = this.anim ? this.anim.frameNum() : 3;
    if (f > 2 && this.prevFrame <= 2) {
      const dir = ox > 0 ? 1 : -1;
      this.world.spawnEnemyBullet(this.o.x + ox, this.o.y + oy, dir * 240, 0);
    }
    this.prevFrame = f;
    if (!this.anim || this.anim.isOver()) {
      this.shotPending = false;
      this.fireT = this.randomWait();
    }
  }

  /** JumperShooter (COBRA_SHOOT): fires SIMPLE_ENEMY toward its facing each time its hop anim leaves frame 3. */
  private cobraShoot(): void {
    const f = this.anim ? this.anim.frameNum() : 0;
    if (f !== this.prevFrame && this.prevFrame === 3) {
      this.world.spawnEnemyBullet(this.x + this.dir * 26, this.y - this.h * 0.5 - 15, this.dir * 240, 0); // offset (26,-15)
    }
    this.prevFrame = f;
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

  // ground patrol (Enemy + MobileObject::internalUpdate): walks at |pxVel|, reverses on walls (pCollidesH) and
  // when the point (left-5 | right+5, bottom+1) has no floor, one-way platform tile or ladder top (pCollidesFloor).
  private patrol(dt: number): void {
    const spd = Math.abs(+(this.p.pxVel ?? 70) || 70);
    const ts = this.world.map.ts;
    const ahead = (d: number) => (d > 0 ? this.x + this.w / 2 + 5 : this.x - this.w / 2 - 5);
    const blocked = (d: number): boolean => {
      const ax = ahead(d);
      if (this.p.pCollidesH === 'true') {
        // sample the whole vertical span (head→feet) so tall enemies don't walk through walls
        for (let y = this.y - this.h + 2; y < this.y; y += ts) if (this.world.map.isHard(ax, y)) return true;
        if (this.world.map.isHard(ax, this.y - 2)) return true;
      }
      return this.p.pCollidesFloor === 'true' && !this.world.hasFloor(ax, this.y + 1);
    };
    if (blocked(this.dir)) {
      // turn around; if both sides are blocked (1-tile ledge) stay put instead of jittering every frame
      if (blocked(-this.dir)) return;
      this.dir *= -1;
    }
    this.x += this.dir * spd * dt;
  }

  /** EnemyBird::internalUpdate (Bird, UFO, SmartUFO, Double, Bomb): a looping "yoyo" interpolation — x goes
   *  home → home+pxDelta → home with easeInOutSin over ONE pDuration cycle — plus a vertical sin(N·π·phase)·pyDelta
   *  bob (N = pCount, Double forces 4). Faces the way it moves (still = right). */
  private fly(dt: number): void {
    const T = Math.max(0.1, +(this.p.pDuration ?? 4) || 4);
    const phase = (this.t % T) / T;                                  // 0..1 over the whole cycle
    const k = phase < 0.5 ? phase * 2 : 2 - phase * 2;              // yoyo: 0..1..0
    const ease = (1 - Math.cos(Math.PI * k)) / 2;                    // easeInOutSin
    const n = this.type === 'Double' ? 4 : (+(this.p.pCount ?? 1) || 1);
    const prevX = this.x;
    this.x = this.homeX + ease * (+(this.p.pxDelta ?? 0) || 0);
    this.y = this.homeY + Math.sin(n * phase * Math.PI) * (+(this.p.pyDelta ?? 0) || 0);
    this.dir = prevX - this.x <= 0 ? 1 : -1;
    void dt;
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
        if (this.nearHero()) playSound('ENEMY_JUMP');
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

  /** EnemyGuillotine: a blade that slides out of its slot at the top of the TMX rect. It waits pWait, drops
   *  pyDelta px with easeInSin over pDuration (doFadeIn) and clangs ("GUILLOTINE", setNormal), rests 1 s
   *  (setWait), then slides back up along the same curve (doFadeOut). updateSprite only reveals the lower
   *  (imgH - pyDelta + extension) rows of the image, anchored at the slot. */
  private guillotine(dt: number): void {
    const dur = Math.max(0.1, +(this.p.pDuration ?? 0.5) || 0.5);
    const wait = +(this.p.pWait ?? 1.7) || 0;
    const delta = +(this.p.pyDelta ?? 100) || 100;
    const easeInSin = (k: number) => 1 - Math.cos((Math.min(1, Math.max(0, k)) * Math.PI) / 2);
    this.phaseT += dt;
    switch (this.blade) {
      case 'wait':
        this.ext = 0;
        if (this.phaseT >= wait) { this.blade = 'drop'; this.phaseT = 0; }
        break;
      case 'drop':
        this.ext = delta * easeInSin(this.phaseT / dur);
        if (this.phaseT >= dur) {
          this.ext = delta;
          this.blade = 'rest'; this.phaseT = 0;
          if (this.nearHero()) playSound('GUILLOTINE');
        }
        break;
      case 'rest':
        if (this.phaseT >= 1) { this.blade = 'rise'; this.phaseT = 0; }
        break;
      case 'rise':
        this.ext = delta * easeInSin(1 - this.phaseT / dur);
        if (this.phaseT >= dur) { this.ext = 0; this.blade = 'wait'; this.phaseT = 0; }
        break;
    }
  }
  /** Visible blade (frame rows shown + where) for the guillotine's current extension. */
  private bladeRect(): { f: Frame; srcY: number; h: number; x: number; y: number } | null {
    const f = this.img ? frameOf(this.img, 0) : null;
    if (!f) return null;
    const delta = +(this.p.pyDelta ?? 100) || 100;
    const h = Math.max(1, Math.min(f.sh, f.sh - delta + this.ext));
    return { f, srcY: f.sy + (f.sh - h), h, x: this.o.x + (this.o.w || 32) / 2 - f.ax, y: this.o.y };
  }

  /** EnemyPiranhaRobot::update (UFO_CANNON): waits pMinTime..pMaxTime at home, rises pyDelta px with easeOutCubic
   *  over pDuration, plays its anim and on frame 2 fires "4_FALL" (4 bullets fanned upward that rain down), then
   *  sinks back the same way and waits again. */
  private popup(dt: number): void {
    const dur = Math.max(0.1, +(this.p.pDuration ?? 1.5) || 1.5);
    const delta = +(this.p.pyDelta ?? -250) || -250;
    const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3); // easeOutCubic
    switch (this.piranha) {
      case 'wait':
        this.y = this.homeY;
        this.fireT -= dt;
        if (this.fireT <= 0) { this.piranha = 'rise'; this.phaseT = 0; }
        break;
      case 'rise':
        this.phaseT += dt;
        this.y = this.homeY + delta * ease(this.phaseT / dur);
        if (this.phaseT >= dur) {
          this.piranha = 'shoot';
          this.shotPending = false;
          this.anim?.goToAndPlay(0);
        }
        break;
      case 'shoot':
        this.y = this.homeY + delta;
        if (!this.shotPending && (!this.anim || this.anim.frameNum() > 1)) {
          this.shotPending = true;
          this.createBullets('4_FALL');
          this.piranha = 'sink';
          this.phaseT = 0;
        }
        break;
      case 'sink':
        this.phaseT += dt;
        this.y = this.homeY + delta * (1 - ease(this.phaseT / dur));
        if (this.phaseT >= dur) { this.piranha = 'wait'; this.fireT = this.randomWait(); }
        break;
    }
  }

  /** Jumper::onCollision: a cobra shot down bursts into "8_BULLETS" (a stomp kills it cleanly). */
  get burstsOnShotDeath(): boolean { return JUMPERS.has(this.type); }

  // FloorCannon: eases back and forth along X.
  private slide(dt: number): void {
    const w = (2 * Math.PI) / Math.max(0.6, +(this.p.pDuration ?? 4) || 4);
    const p = (Math.sin(this.t * w - Math.PI / 2) + 1) / 2;
    this.x = this.homeX + p * +(this.p.pxDelta ?? 60);
  }

  /** EnemyBoss (an EnemyUltraton): walks like an Android; every pMinTime..pMaxTime s, if the hero is AHEAD in its
   *  walking direction it stops, plays BOSS_SHOOT and on frame 1 fires BOSS_BULLETS (5-bullet fan, 200 px/s,
   *  offset (-22,15)); then resumes walking. A hero behind it is ignored until the next wait. */
  private boss(dt: number): void {
    if (!this.bossShooting) {
      this.patrol(dt);
      this.fireT -= dt;
      if (this.fireT > 0) return;
      const hero = this.world.hero;
      const ahead = hero.isAlive() && (this.dir > 0 ? hero.pos.x > this.x : hero.pos.x < this.x);
      if (!ahead) { this.fireT = this.randomWait(); return; }
      this.bossShooting = true;
      this.shotPending = false;
      this.anim?.set('BOSS_SHOOT');
      this.anim?.goToAndPlay(0);
      return;
    }
    if (!this.shotPending && (!this.anim || this.anim.frameNum() >= 1)) {
      this.shotPending = true;
      const ox = this.x - this.dir * 22, oy = this.y - this.h * 0.5 + 15;
      for (let i = 0; i < 5; i++) {
        const ang = Math.PI / 3 + i * (Math.PI / 12);
        this.world.spawnEnemyBullet(ox, oy, this.dir * Math.sin(ang) * 200, -Math.cos(ang) * 200);
      }
    }
    if (!this.anim || this.anim.isOver()) {
      this.bossShooting = false;
      this.shotPending = false;
      this.anim?.set('BOSS');
      this.fireT = this.randomWait();
    }
  }

  /** Item granted when this object is removed (InteractiveObject::reactionAfterRemove): the boss carries the
   *  BOSS_KEY that opens the last gate. */
  get dropsKey(): string | null {
    if (this.p.pIsKey === 'true' || this.isBoss) return this.p.pRequiredItem ?? null;
    return null;
  }

  // ---------- render ----------
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.type === 'Guillotine') {
      const b = this.bladeRect();
      if (b) ctx.drawImage(b.f.image, b.f.sx, b.srcY, b.f.sw, b.h, Math.round(b.x - camX), Math.round(b.y - camY), b.f.sw, b.h);
      return;
    }
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
