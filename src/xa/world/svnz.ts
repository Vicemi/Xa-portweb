// Extra enemies for the map-2 levels, taken from Super Vampire Ninja Zero (Batoví Games Studio, 2009). Their
// sprites, frame timings, body boxes and melee hit boxes come from the SVNZ FighterFactory data
// (tools/import_svnz.py → svnz.json); their behaviour mixes their SVNZ move sets with Xa's rules (contact damage,
// stomping, bullets, keys).
import { Anim, ANIMS } from '../core/sprites';
import { playSound } from '../core/audio';
import { Enemy } from './enemies';
import type { TmxObject } from './tmx';
import type { World } from './world';

type Rect = { x: number; y: number; w: number; h: number };
type HitBox = [number, number, number, number] | null;

// Extra-level bosses = the SVNZ story-mode bosses (waves.xml storyFirstBoss..storyFinalBoss), with the helpers that
// SVNZ sends with them (listExtras / activeExtras) and the SVNZ announcement (initialTextKey) when the fight starts.
interface BossSpec { name: string; banner: string; extras: string[]; max: number }
interface Spec { key: string; lives: number; points: number; speed: number; boss?: BossSpec }
const SPEC: Record<string, Spec> = {
  SvNinja: { key: 'NINJA', lives: 3, points: 40, speed: 70 },        // DemonNinja: walks up and slashes
  SvRedNinja: { key: 'RED_NINJA', lives: 2, points: 45, speed: 110 }, // GenericNinja: leaps at Xa, then strikes
  SvBat: { key: 'BAT', lives: 1, points: 30, speed: 0 },              // Bat: flutters, dives on Xa
  SvBigDemon: { key: 'BIG_DEMON', lives: 14, points: 100, speed: 35 },// BigDemon: armoured, ground slam + stomp
  SvGoldNinja: {
    key: 'GOLD_NINJA', lives: 80, points: 300, speed: 115,
    boss: { name: 'Ninja Dorado', banner: '¡Se acerca un enemigo peligroso!', extras: ['SvNinja', 'SvRedNinja'], max: 2 },
  },
  SvBigDemonBoss: {
    key: 'BIG_DEMON', lives: 180, points: 400, speed: 45,
    boss: { name: 'Gran Demonio', banner: '¡El que sigue no va a ser\ntan fácil!', extras: ['SvNinja', 'SvRedNinja', 'SvNinja'], max: 3 },
  },
  SvLucy: {
    key: 'LUCY', lives: 110, points: 450, speed: 150,
    boss: { name: 'Lucy Poseída', banner: '¡Lucy, la hermana de Mina,\nfue poseída!', extras: [], max: 0 },
  },
  SvDracula: {
    key: 'DRACULA', lives: 160, points: 500, speed: 120,
    boss: { name: 'Drácula', banner: '¡Llega Drácula!', extras: ['SvBat'], max: 1 },
  },
};
export const SV_TYPES = new Set(Object.keys(SPEC));

const GRAVITY = 1200;

export function createSvEnemy(o: TmxObject, world: World, x: number, y: number): Enemy | null {
  return SV_TYPES.has(o.type) ? new SvEnemy(world, o, x, y) : null;
}

type St = 'walk' | 'attack' | 'jump' | 'fly' | 'dive' | 'return' | 'slam' | 'tired' | 'stomp' | 'cast' | 'vanish'
  | 'appear' | 'kick' | 'dash' | 'idle' | 'retreat';

class SvEnemy extends Enemy {
  private spec: Spec;
  private st: St = 'walk';
  private stT = 0;
  private cool = 1;
  private fired = false;
  private hx: number;
  private hy: number;
  private grounded = false;
  private flyT = Math.random() * 6;
  private awake = false;         // bosses wait in their arena until Xa walks in
  private arena: [number, number];
  private extraT = 1.5;
  private extraK = 0;

  constructor(world: World, o: TmxObject, x: number, y: number) {
    super(world, o, x, y);
    this.spec = SPEC[o.type];
    this.hx = x;
    this.hy = y;
    this.lives = +(o.props.pLives ?? 0) || this.spec.lives;
    const stand = ANIMS[this.an('STAND')];
    const body = (stand?.frames[0] as { body?: HitBox } | undefined)?.body;
    if (body) { this.w = body[2] - body[0]; this.h = -body[1]; }
    this.dir = (+(o.props.pLookDir ?? 0) || 0) < 0 ? -1 : 1;
    if (o.type === 'SvBat') this.st = 'fly';
    if (!this.anim) this.anim = new Anim();
    this.arena = [+(o.props.pArenaX0 ?? 0) || x - 400, +(o.props.pArenaX1 ?? 0) || x + 400];
    if (this.spec.boss) { this.st = 'idle'; this.play('STAND'); }
    else this.play(o.type === 'SvBat' ? 'STAND' : 'WALK');
  }

  private an(name: string): string { return `SV_${this.spec.key}_${name}`; }
  private play(name: string): void {
    const n = this.an(name);
    if (!this.anim) return;
    this.anim.set(n);
    this.anim.goToAndPlay(0);
  }
  private setSt(s: St, anim?: string): void {
    this.st = s;
    this.stT = 0;
    this.fired = false;
    if (anim) this.play(anim);
  }

  override get points(): number { return this.spec.points; }
  override get isBoss(): boolean { return !!this.spec.boss; }
  override get unstompable(): boolean { return this.spec.key === 'BIG_DEMON' || this.type === 'SvDracula'; }
  override get contactRemoves(): boolean { return !this.spec.boss && this.type !== 'SvBigDemon'; }
  override bossBarInfo(): { name: string; lives: number; max: number } | null {
    const b = this.spec.boss;
    return b && this.awake && this.alive ? { name: b.name, lives: Math.max(0, this.lives), max: this.spec.lives } : null;
  }
  override get isGroundBound(): boolean { return this.type !== 'SvBat'; }
  override get ignoresContact(): boolean { return this.st === 'vanish' || this.st === 'appear'; }
  override get isBulletProof(): boolean { return this.st === 'vanish'; }
  override get dropsKey(): string | null {
    return this.spec.boss || this.p.pIsKey === 'true' ? this.p.pRequiredItem ?? 'KEY' : null;
  }

  override onBullet(): boolean {
    if (this.spec.boss && !this.awake) this.wake(); // shooting it from outside the arena starts the fight too
    const dead = super.onBullet();
    // the small ones flinch; the big demon and the bosses have SVNZ armour (armorMode) and keep going
    if (!dead && !this.spec.boss && this.type !== 'SvBigDemon' && this.st === 'walk') this.play('HIT_IN');
    return dead;
  }

  /** The boss stage starts: boss music, the SVNZ announcement and the health bar. */
  private wake(): void {
    const b = this.spec.boss!;
    this.awake = true;
    this.cool = 1.2;
    this.world.setMusic('svnz_boss.ogg');
    this.world.message(b.banner, 3);
    playSound('SV_SPECIAL');
    this.setSt('walk', 'WALK');
  }

  /** SVNZ BossMode: keeps `max` helpers on stage, entering from the arena edge away from Xa. */
  private helpers(dt: number): void {
    const b = this.spec.boss!;
    this.extras = this.extras.filter((e) => e.alive);
    if (!b.max || this.extras.length >= b.max) return;
    this.extraT -= dt;
    if (this.extraT > 0) return;
    this.extraT = 3.5;
    const type = b.extras[this.extraK++ % b.extras.length];
    const [x0, x1] = this.arena;
    const x = this.hero.pos.x > (x0 + x1) / 2 ? x0 + 48 : x1 - 48;
    const y = type === 'SvBat' ? this.hy - 130 : this.hy;
    const e = this.world.spawnEnemy(type, x, y, type === 'SvBat' ? { pxDelta: '60' } : {});
    if (e) this.extras.push(e);
  }

  /** Red rect of the current SVNZ frame, mirrored with the facing (x grows forward, y up from the feet). */
  override attackRect(): Rect | null {
    const a = this.anim;
    if (!a?.type) return null;
    const hit = (a.type.frames[a.frameNum()] as { hit?: HitBox }).hit;
    if (!hit) return null;
    const [x1, y1, x2, y2] = hit;
    const l = this.dir > 0 ? this.x + x1 : this.x - x2;
    return { x: l, y: this.y + y1, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  // ---------- helpers ----------
  private get hero() { return this.world.hero; }
  private heroDx(): number { return this.hero.pos.x - this.x; }
  private heroDy(): number { return this.hero.pos.y - this.y; }
  private heroNear(rx: number, ry: number): boolean {
    return this.hero.isAlive() && Math.abs(this.heroDx()) < rx && Math.abs(this.heroDy()) < ry;
  }
  private face(): void { const dx = this.heroDx(); if (dx) this.dir = Math.sign(dx); }
  private wallAhead(d: number): boolean {
    const ax = d > 0 ? this.x + this.w / 2 + 3 : this.x - this.w / 2 - 3;
    const m = this.world.map;
    for (let y = this.y - this.h + 4; y < this.y - 2; y += 12) if (m.isHard(ax, y)) return true;
    return m.isHard(ax, this.y - 3);
  }
  private ledgeAhead(d: number): boolean {
    const ax = d > 0 ? this.x + this.w / 2 + 4 : this.x - this.w / 2 - 4;
    return !this.world.hasFloor(ax, this.y + 2);
  }
  /** Walk `dir` at `spd`; turns at walls and ledges (unless both sides are blocked). */
  private walk(dt: number, spd: number): void {
    const blocked = (d: number) => this.wallAhead(d) || this.ledgeAhead(d);
    if (blocked(this.dir)) { if (blocked(-this.dir)) return; this.dir *= -1; }
    this.x += this.dir * spd * dt;
  }
  /** Gravity + landing on hard tiles / platforms; walls stop the horizontal motion. */
  private physics(dt: number): void {
    if (this.vx && this.wallAhead(Math.sign(this.vx))) this.vx = 0;
    this.x += this.vx * dt;
    this.vy += GRAVITY * dt;
    this.y += this.vy * dt;
    this.grounded = false;
    if (this.vy > 0 && this.world.hasFloor(this.x, this.y + 1)) {
      const ts = this.world.map.ts;
      if (this.world.map.isHard(this.x, this.y + 1)) this.y = Math.floor((this.y + 1) / ts) * ts - 1;
      this.vy = 0;
      this.vx = 0;
      this.grounded = true;
    }
    if (this.y > this.world.map.heightPx + 64) this.alive = false;
  }
  private animOver(): boolean { return !this.anim || this.anim.isOver(); }
  /** After a melee combo the bosses hop back (like the SVNZ fighters' back-dash), which opens the distance Xa
   *  needs to shoot them. */
  private retreat(): void {
    this.setSt('retreat', 'WALK');
  }
  private stepBack(dt: number): boolean {
    if (this.st !== 'retreat') return false;
    const back = -this.dir;
    if (!this.wallAhead(back) && !this.ledgeAhead(back) && this.x + back * 40 > this.arena[0] && this.x + back * 40 < this.arena[1]) {
      this.x += back * this.spec.speed * 1.6 * dt;
    }
    if (this.stT > 0.45) this.setSt('walk', 'WALK');
    return true;
  }

  private shockwave(): void {
    // BigDemon slam / stomp: the floor shakes and two shock bullets run along the ground both ways
    this.world.camera.shake(0.5);
    playSound('SV_STRONG_HIT');
    this.world.spawnEnemyBullet(this.x + 26, this.y - 8, 210, 0);
    this.world.spawnEnemyBullet(this.x - 26, this.y - 8, -210, 0);
    // the impact itself: Xa standing close on the same floor takes the hit (shield or not)
    const h = this.world.hero;
    if (h.isAlive() && Math.abs(h.pos.x - this.x) < 95 && Math.abs(h.pos.y - this.y) < 24) h.onCollisionEnemy(4);
  }

  // ---------- update ----------
  override update(dt: number): void {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.anim?.update(dt);
    this.stT += dt;
    this.cool -= dt;
    if (this.spec.boss) {
      if (!this.awake) {
        // waiting in its arena, facing the way Xa comes from
        if (!this.grounded) this.physics(dt);
        const hx = this.hero.pos.x;
        if (this.hero.isAlive() && hx >= this.arena[0] && hx <= this.arena[1]) this.wake();
        return;
      }
      this.helpers(dt);
      if (this.stepBack(dt)) return;
    }
    switch (this.type) {
      case 'SvNinja': this.ninja(dt); break;
      case 'SvRedNinja': this.redNinja(dt); break;
      case 'SvGoldNinja': this.goldNinja(dt); break;
      case 'SvBat': this.bat(dt); break;
      case 'SvBigDemon': case 'SvBigDemonBoss': this.bigDemon(dt); break;
      case 'SvLucy': this.lucy(dt); break;
      case 'SvDracula': this.dracula(dt); break;
    }
  }

  private ninja(dt: number): void {
    if (this.st === 'attack') {
      if (this.anim && this.anim.frameNum() === 2 && !this.fired) { this.fired = true; playSound('SV_CUT'); }
      if (this.animOver()) { this.setSt('walk', 'WALK'); this.cool = 0.9; }
      return;
    }
    if (!this.grounded) this.physics(dt);
    // chases Xa when it is close on the same level; slashes when it is right in front
    if (this.heroNear(170, 40)) {
      this.face();
      if (Math.abs(this.heroDx()) < 52 && this.cool <= 0) { this.setSt('attack', 'ATTACK'); return; }
      if (Math.abs(this.heroDx()) > 30) this.walk(dt, this.spec.speed * 1.4);
    } else {
      this.walk(dt, this.spec.speed);
    }
    if (this.anim?.name !== this.an('WALK') && this.anim?.isOver()) this.play('WALK');
  }

  private redNinja(dt: number): void {
    switch (this.st) {
      case 'jump':
        this.physics(dt);
        if (this.grounded) {
          playSound('SV_FALL');
          if (this.heroNear(56, 40)) { this.face(); this.setSt('attack', 'ATTACK'); }
          else this.setSt('walk', 'WALK');
          this.cool = 1.2;
        }
        return;
      case 'attack':
        if (this.anim && this.anim.frameNum() === 1 && !this.fired) { this.fired = true; playSound('SV_HIT'); }
        if (this.animOver()) { this.setSt('walk', 'WALK'); this.cool = 1.0; }
        return;
      default:
        if (!this.grounded) { this.physics(dt); if (!this.grounded) return; }
        if (this.heroNear(190, 70) && this.cool <= 0) {
          this.face();
          if (Math.abs(this.heroDx()) < 48) { this.setSt('attack', 'ATTACK'); return; }
          // leap at Xa (GenericNinja jump), landing next to it
          this.setSt('jump', 'JUMP');
          this.grounded = false;
          this.vy = -430;
          this.vx = this.dir * Math.min(220, Math.abs(this.heroDx()) * 1.1);
          playSound('SV_JUMP');
          return;
        }
        this.walk(dt, this.spec.speed);
        if (this.anim?.name !== this.an('WALK') && this.anim?.isOver()) this.play('WALK');
    }
  }

  private bat(dt: number): void {
    const range = +(this.p.pxDelta ?? 70) || 70;
    this.flyT += dt;
    const px = this.hx + Math.sin(this.flyT * 0.9) * range;
    const py = this.hy + Math.sin(this.flyT * 2.3) * 10;
    switch (this.st) {
      case 'dive': {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.stT > 1.1 || this.world.map.isHard(this.x, this.y)) this.setSt('return', 'STAND');
        return;
      }
      case 'return': {
        const dx = px - this.x, dy = py - this.y, d = Math.hypot(dx, dy);
        if (d < 4) { this.setSt('fly'); this.cool = 2.2; return; }
        const s = Math.min(d, 150 * dt);
        this.x += (dx / d) * s;
        this.y += (dy / d) * s;
        this.dir = dx < 0 ? -1 : 1;
        return;
      }
      default: {
        this.dir = px - this.x < 0 ? -1 : 1;
        this.x = px;
        this.y = py;
        const h = this.hero;
        if (this.cool <= 0 && h.isAlive() && Math.abs(this.heroDx()) < 140 && h.pos.y - this.y > 20 && h.pos.y - this.y < 260) {
          // swoop on Xa (Bat attack frame), then flutter back to its path
          const tx = h.pos.x, ty = h.pos.y - 22, dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy) || 1;
          this.vx = (dx / d) * 250;
          this.vy = (dy / d) * 250;
          this.dir = dx < 0 ? -1 : 1;
          this.setSt('dive', 'ATTACK');
          playSound('SV_ACTION');
        }
      }
    }
  }

  private bigDemon(dt: number): void {
    switch (this.st) {
      case 'slam':
        // the slam lands on the first frame with a red rect (BigDemon 1000.3)
        if (!this.fired && this.attackRect()) { this.fired = true; this.shockwave(); }
        if (this.animOver()) { this.setSt('tired', 'TIRED'); }
        return;
      case 'tired':
        if (this.stT > (this.spec.boss ? 0.7 : 1.0)) { this.setSt('walk', 'WALK'); this.cool = this.spec.boss ? 1.3 : 2.2; }
        return;
      case 'stomp':
        this.physics(dt);
        if (this.grounded) { this.shockwave(); this.setSt('tired', 'LAND'); }
        return;
      default:
        if (!this.grounded) { this.physics(dt); if (!this.grounded) return; }
        if (this.heroNear(320, 90)) {
          this.face();
          const adx = Math.abs(this.heroDx());
          // the slam's red rect only reaches 58 px forward (BigDemon 1000.3/1000.4): close in first
          if (this.cool <= 0 && adx < 62) { this.setSt('slam', 'ATTACK'); return; }
          if (this.cool <= 0 && adx > 160 && adx < 280) {
            // leaping body press (BigDemon 1500/1505)
            this.setSt('stomp', 'AIR_ATTACK_LOOP');
            this.grounded = false;
            this.vy = -520;
            this.vx = this.dir * Math.min(200, adx);
            playSound('SV_JUMP');
            return;
          }
          if (adx > 34) this.walk(dt, this.spec.speed * 1.6);
        } else {
          this.walk(dt, this.spec.speed);
        }
        if (this.anim?.name !== this.an('WALK') && this.anim?.isOver()) this.play('WALK');
    }
  }

  /** Gold Demon Ninja (SVNZ first boss): a faster demon ninja that also leaps at Xa. */
  private goldNinja(dt: number): void {
    switch (this.st) {
      case 'attack':
        if (this.anim && this.anim.frameNum() === 2 && !this.fired) { this.fired = true; playSound('SV_STRONG_CUT'); }
        if (this.animOver()) { this.retreat(); this.cool = this.lives < SPEC.SvGoldNinja.lives / 2 ? 0.35 : 0.6; }
        return;
      case 'jump':
        this.physics(dt);
        if (this.grounded) {
          playSound('SV_FALL');
          this.face();
          if (this.heroNear(60, 40)) this.setSt('attack', 'ATTACK'); else this.setSt('walk', 'WALK');
          this.cool = 0.5;
        }
        return;
      default: {
        if (!this.grounded) { this.physics(dt); if (!this.grounded) return; }
        this.face();
        const adx = Math.abs(this.heroDx());
        if (this.cool <= 0) {
          if (adx < 52) { this.setSt('attack', 'ATTACK'); return; }
          if (adx < 260 && Math.random() < 0.5) {
            this.setSt('jump', 'JUMP');
            this.grounded = false;
            this.vy = -460;
            this.vx = this.dir * Math.min(260, adx * 1.15);
            playSound('SV_JUMP');
            return;
          }
          this.cool = 0.4;
        }
        if (adx > 34) this.walk(dt, this.spec.speed);
        if (this.anim?.name !== this.an('WALK') && this.anim?.isOver()) this.play('WALK');
      }
    }
  }

  /** Lucy, Mina's possessed sister (SVNZ third boss): dash strike, punch and kick combos, diving kick and the
   *  spinning special, with Mina's own frames and hit boxes. */
  private lucy(dt: number): void {
    const enraged = this.lives < SPEC.SvLucy.lives / 2;
    switch (this.st) {
      case 'dash':
        // dash attack (Mina 500): rushes forward with the strike frames active
        if (this.wallAhead(this.dir) || this.ledgeAhead(this.dir)) this.stT = 9;
        else this.x += this.dir * 330 * dt;
        if (this.stT > 0.45) { this.setSt('walk', 'WALK'); this.cool = enraged ? 0.35 : 0.6; }
        return;
      case 'attack':
        if (this.attackRect() && !this.fired) { this.fired = true; playSound('SV_HIT'); }
        if (this.anim && !this.attackRect()) this.fired = false;
        if (this.anim?.name === this.an('SPECIAL') && !this.wallAhead(this.dir)) this.x += this.dir * 70 * dt;
        if (this.animOver()) { this.retreat(); this.cool = enraged ? 0.35 : 0.65; }
        return;
      case 'jump':
        this.physics(dt);
        if (this.vy > -80 && !this.fired) {
          this.fired = true;
          this.face();
          const dx = this.hero.pos.x - this.x, dy = this.hero.pos.y - this.y, d = Math.hypot(dx, dy) || 1;
          this.vx = (dx / d) * 360;
          this.vy = Math.max(220, (dy / d) * 360);
          this.setSt('kick', 'DIVE');
          playSound('SV_ACTION');
        }
        if (this.grounded) this.setSt('walk', 'WALK');
        return;
      case 'kick':
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.vx && this.wallAhead(Math.sign(this.vx))) this.vx = 0;
        if (this.world.hasFloor(this.x, this.y + 1)) {
          const ts = this.world.map.ts;
          if (this.world.map.isHard(this.x, this.y + 1)) this.y = Math.floor((this.y + 1) / ts) * ts - 1;
          this.vx = this.vy = 0;
          this.grounded = true;
          playSound('SV_FALL');
          this.setSt('walk', 'LAND');
          this.cool = 0.5;
        }
        return;
      default: {
        if (!this.grounded) { this.physics(dt); if (!this.grounded) return; }
        this.face();
        const adx = Math.abs(this.heroDx());
        if (this.cool <= 0) {
          const r = Math.random();
          if (adx < 50) {
            this.setSt('attack', r < 0.4 ? 'PUNCH' : r < 0.75 ? 'KICKS' : 'SPECIAL');
            return;
          }
          if (adx < 240) {
            if (r < 0.45) { this.setSt('dash', 'DASH'); playSound('SV_ACTION'); return; }
            if (r < 0.8) {
              this.setSt('jump', 'JUMP');
              this.grounded = false;
              this.vy = -540;
              this.vx = this.dir * 80;
              playSound('SV_JUMP');
              return;
            }
          }
          this.cool = 0.3;
        }
        if (adx > 40) this.walk(dt, this.spec.speed * (enraged ? 1.3 : 1));
        if (this.anim?.name !== this.an('WALK') && this.anim?.isOver()) this.play('WALK');
      }
    }
  }

  private dracula(dt: number): void {
    const enraged = this.lives < (SPEC.SvDracula.lives / 2);
    switch (this.st) {
      case 'attack':
        if (this.attackRect() && !this.fired) { this.fired = true; playSound('SV_STRONG_CUT'); }
        if (this.anim && !this.attackRect()) this.fired = false;
        if (this.animOver()) { this.retreat(); this.cool = enraged ? 0.5 : 0.9; }
        return;
      case 'cast':
        // the spell leaves on the frame where his hand glows (Dracula 2000.1): a fan aimed at Xa
        if (this.anim && this.anim.frameNum() >= 1 && !this.fired) {
          this.fired = true;
          playSound('SV_SPECIAL');
          const ox = this.x + this.dir * 24, oy = this.y - 34;
          const base = Math.atan2(this.hero.pos.y - 22 - oy, this.hero.pos.x - ox);
          const n = enraged ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.22;
            this.world.spawnEnemyBullet(ox, oy, Math.cos(a) * 230, Math.sin(a) * 230);
          }
        }
        if (this.animOver()) { this.setSt('walk', 'WALK'); this.cool = enraged ? 0.6 : 1.1; }
        return;
      case 'vanish':
        // wraps himself in the cape and reappears behind Xa (Dracula 3040)
        if (this.animOver() || this.stT > 1.2) {
          const side = this.hero.dir > 0 ? -1 : 1;
          let nx = this.hero.pos.x + side * 110;
          if (this.world.map.isHard(nx, this.y - 20)) nx = this.hero.pos.x - side * 110;
          this.x = nx;
          this.face();
          playSound('SV_SPECIAL');
          this.setSt('appear', 'STAND');
        }
        return;
      case 'appear':
        if (this.stT > 0.35) { this.setSt('walk', 'WALK'); this.cool = 0.2; }
        return;
      case 'jump':
        this.physics(dt);
        if (this.vy > -60 && !this.fired) {
          // at the top of the leap he dives feet first at Xa (Dracula 1500)
          this.fired = true;
          this.face();
          const dx = this.hero.pos.x - this.x, dy = this.hero.pos.y - this.y, d = Math.hypot(dx, dy) || 1;
          this.vx = (dx / d) * 330;
          this.vy = Math.max(200, (dy / d) * 330);
          this.setSt('kick', 'AIR_ATTACK');
        }
        if (this.grounded) this.setSt('walk', 'WALK');
        return;
      case 'kick':
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.vx && this.wallAhead(Math.sign(this.vx))) this.vx = 0;
        if (this.world.hasFloor(this.x, this.y + 1)) {
          const ts = this.world.map.ts;
          if (this.world.map.isHard(this.x, this.y + 1)) this.y = Math.floor((this.y + 1) / ts) * ts - 1;
          this.vx = this.vy = 0;
          this.grounded = true;
          this.world.camera.shake(0.25);
          playSound('SV_FALL');
          this.setSt('walk', 'WALK');
          this.cool = 0.8;
        }
        return;
      default: {
        if (!this.grounded) { this.physics(dt); if (!this.grounded) return; }
        if (!this.heroNear(420, 160)) { this.walk(dt, this.spec.speed * 0.5); return; }
        this.face();
        const adx = Math.abs(this.heroDx());
        if (this.cool <= 0) {
          const r = Math.random();
          if (adx < 50) {
            // up close: the three-hit combo, or slip away in his cape / leap for a dive kick
            if (r < 0.55) { this.setSt('attack', 'ATTACK'); return; }
            if (r < 0.8) { this.setSt('vanish', 'VANISH'); playSound('SV_ACTION'); return; }
          } else {
            if (r < 0.5) { this.setSt('cast', 'CAST'); return; }
            if (r < 0.7) { this.setSt('vanish', 'VANISH'); playSound('SV_ACTION'); return; }
          }
          if (r < 0.92) {
            this.setSt('jump', 'JUMP');
            this.grounded = false;
            this.vy = -560;
            this.vx = this.dir * 60;
            playSound('SV_JUMP');
            return;
          }
          this.cool = 0.6;
        }
        if (adx > 40) this.walk(dt, this.spec.speed * (enraged ? 1.4 : 1));
        if (this.anim?.name !== this.an('WALK') && this.anim?.isOver()) this.play('WALK');
      }
    }
  }
}
