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

interface Spec { key: string; lives: number; points: number; speed: number }
const SPEC: Record<string, Spec> = {
  SvNinja: { key: 'NINJA', lives: 3, points: 40, speed: 70 },        // DemonNinja: walks up and slashes
  SvRedNinja: { key: 'RED_NINJA', lives: 2, points: 45, speed: 110 }, // GenericNinja: leaps at Xa, then strikes
  SvBat: { key: 'BAT', lives: 1, points: 30, speed: 0 },              // Bat: flutters, dives on Xa
  SvBigDemon: { key: 'BIG_DEMON', lives: 14, points: 100, speed: 35 },// BigDemon: armoured, ground slam + stomp
  SvDracula: { key: 'DRACULA', lives: 60, points: 500, speed: 120 },  // Dracula: combo, spell, teleport, dive
};
export const SV_TYPES = new Set(Object.keys(SPEC));

const GRAVITY = 1200;

export function createSvEnemy(o: TmxObject, world: World, x: number, y: number): Enemy | null {
  return SV_TYPES.has(o.type) ? new SvEnemy(world, o, x, y) : null;
}

type St = 'walk' | 'attack' | 'jump' | 'fly' | 'dive' | 'return' | 'slam' | 'tired' | 'stomp' | 'cast' | 'vanish'
  | 'appear' | 'kick';

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
    this.play(o.type === 'SvBat' ? 'STAND' : 'WALK');
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
  override get isBoss(): boolean { return this.type === 'SvDracula'; }
  override get unstompable(): boolean { return this.type === 'SvBigDemon' || this.type === 'SvDracula'; }
  override get contactRemoves(): boolean { return this.type !== 'SvBigDemon' && this.type !== 'SvDracula'; }
  override get isGroundBound(): boolean { return this.type !== 'SvBat'; }
  override get ignoresContact(): boolean { return this.st === 'vanish' || this.st === 'appear'; }
  override get isBulletProof(): boolean { return this.st === 'vanish'; }
  override get dropsKey(): string | null {
    return this.type === 'SvDracula' || this.p.pIsKey === 'true' ? this.p.pRequiredItem ?? 'KEY' : null;
  }

  override onBullet(): boolean {
    const dead = super.onBullet();
    if (!dead && this.type !== 'SvBigDemon' && this.type !== 'SvDracula' && this.st === 'walk') this.play('HIT_IN');
    return dead;
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
  private shockwave(): void {
    // BigDemon slam / stomp: the floor shakes and two shock bullets run along the ground both ways
    this.world.camera.shake(0.5);
    playSound('SV_STRONG_HIT');
    this.world.spawnEnemyBullet(this.x + 26, this.y - 8, 210, 0);
    this.world.spawnEnemyBullet(this.x - 26, this.y - 8, -210, 0);
  }

  // ---------- update ----------
  override update(dt: number): void {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.anim?.update(dt);
    this.stT += dt;
    this.cool -= dt;
    switch (this.type) {
      case 'SvNinja': this.ninja(dt); break;
      case 'SvRedNinja': this.redNinja(dt); break;
      case 'SvBat': this.bat(dt); break;
      case 'SvBigDemon': this.bigDemon(dt); break;
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
        if (this.stT > 1.0) { this.setSt('walk', 'WALK'); this.cool = 2.2; }
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
          if (this.cool <= 0 && adx < 120) { this.setSt('slam', 'ATTACK'); return; }
          if (this.cool <= 0 && adx > 160 && adx < 280) {
            // leaping body press (BigDemon 1500/1505)
            this.setSt('stomp', 'AIR_ATTACK_LOOP');
            this.grounded = false;
            this.vy = -520;
            this.vx = this.dir * Math.min(200, adx);
            playSound('SV_JUMP');
            return;
          }
          if (adx > 40) this.walk(dt, this.spec.speed * 1.6);
        } else {
          this.walk(dt, this.spec.speed);
        }
        if (this.anim?.name !== this.an('WALK') && this.anim?.isOver()) this.play('WALK');
    }
  }

  private dracula(dt: number): void {
    const enraged = this.lives < (SPEC.SvDracula.lives / 2);
    switch (this.st) {
      case 'attack':
        if (this.attackRect() && !this.fired) { this.fired = true; playSound('SV_STRONG_CUT'); }
        if (this.anim && !this.attackRect()) this.fired = false;
        if (this.animOver()) { this.setSt('walk', 'WALK'); this.cool = enraged ? 0.5 : 0.9; }
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
