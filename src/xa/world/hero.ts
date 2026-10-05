// Hero: reimplementation of Hero::update / processState / setState / processIntersections from xa.exe.
// Constants come from xa.exe's .data (see MODLOG "Constantes del binario").
import { Anim, ANIMS, drawFrame, frameOf, type Frame } from '../core/sprites';
import { isFirstPress, isPressed } from '../core/input';
import { playSound, stopMusic } from '../core/audio';
import { Place, isFloorPlace, type Rect } from './tilemap';
import type { World } from './world';
import { MAX_ENERGY } from './state';

export const GRAVITY = 1800;
export const VELOCITY_WALK = 250;
export const VELOCITY_GO_DOWN = 150;
export const VELOCITY_JUMP = [-600, -700, -790, -810, -850];
export const VELOCITY_DOUBLE_JUMP = [0, -440, -680, -720, -760];
export const MAX_FALL = 700;
const HERO_W = 24;
const HERO_H = 45;
const IGNORE_Y = 0.49; // InteractiveObject::IGNORE_INTERSECTION.y
const FIRE_RATE = 12;  // bullets per second while holding fire
const BURST = 3;
const BURST_PAUSE = 0.25;
const HIT_FLASH = 0.5;
const SHIELD_REACH = 30; // front edge of the BLOCK_IN shield (HERO frame 25 reaches x+33 from the anchor)
const DEATH_WAIT = 1.0;

export const enum HS {
  Stand = 0, State1 = 1, Walk = 2, GoDown = 3, Ladder = 4, State5 = 5,
  Fall = 6, Jump = 7, DoubleJump = 8, Dead = 9, Entrance = 10, State11 = 11, Block = 12,
}

export class Hero {
  pos = { x: 0, y: 0 };      // feet position (0x1e8)
  prev = { x: 0, y: 0 };     // previous position (0x1f0)
  vel = { x: 0, y: 0 };
  acc = { x: 0, y: GRAVITY };
  rect: Rect = { x: 0, y: 0, w: HERO_W, h: HERO_H };
  dir = 1;                   // Scale2.x
  state: HS = HS.Entrance;
  anim = new Anim('ENTRANCE');
  animName = 'ENTRANCE';
  shooting = false;          // 0x330
  shotWait = 0;              // 0x334
  shotHold = 0;              // 0x33c
  shotCount = 0;             // 0x358
  redTime = 0;               // 0x34c: damage flash
  frameCounter = 0;          // 0x350
  standAfterClimb = true;    // 0x260
  jumpedStraight = false;    // 0x261
  entranceActive = true;     // 0x354
  immortal = false;          // 0x274 (debug)
  deathWait = 0;             // 0x268
  winner = false;
  visible = true;
  platform: { y: number; vx: number; vy: number } | null = null; // 0x294
  limit = { w: 0, h: 0 };    // 0x340

  constructor(private world: World) {}

  // ---------- placement ----------
  setPosition(x: number, y: number): void {
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.pos.x = x;
    this.pos.y = y;
    this.rect.x = x - HERO_W * 0.5 + 2 * this.dir;
    this.rect.y = y - HERO_H;
  }
  translate(dx: number, dy: number): void {
    this.pos.x += dx;
    this.pos.y += dy;
    this.rect.x += dx;
    this.rect.y += dy;
  }
  spawn(x: number, y: number): void {
    this.setPosition(x, y);
    this.prev = { ...this.pos };
    this.vel = { x: 0, y: 0 };
    this.acc = { x: 0, y: 0 };
    this.state = HS.Stand;
    this.entranceActive = true;
    this.anim.set('ENTRANCE');
    this.animName = 'ENTRANCE';
    this.anim.goToAndPlay(2);
    this.setState(HS.Entrance);
  }

  get height(): number { return HERO_H; }
  isAlive(): boolean { return this.state !== HS.Dead; }

  // ---------- animation helpers ----------
  private setAnim(name: string, keepTime = false): void {
    this.animName = name;
    const t = this.anim.time;
    if (this.anim.name !== name) {
      this.anim.set(name);
      if (keepTime) this.anim.time = t;
    }
  }
  private setStandAnim(): void {
    const name = this.shooting ? 'SHOT_STAND' : 'STAND';
    if (this.animName === name && this.anim.name === name) return;
    this.setAnim(name);
    this.anim.playing = true;
  }
  private setJumpAnim(frame: number): void {
    if (this.anim.name === 'SHOT_JUMP') return;
    const name = this.shooting ? 'SHOT_JUMP' : 'JUMP';
    this.animName = name;
    if (this.anim.name !== name && this.anim.name !== name + '_R') {
      this.anim.set(name);
      if (frame !== -1 && !this.shooting) this.anim.goToAndPlay(frame);
    }
  }

  // ---------- Hero::setState ----------
  setState(s: HS): void {
    if (this.state === s) return;
    const W = this.world;
    const ts = W.map.ts;
    switch (s) {
      case HS.Stand: case HS.State1: case HS.Walk: case HS.GoDown: case HS.State5: case HS.Jump:
        if (this.state === HS.Ladder || this.state === HS.Entrance) this.acc = { x: 0, y: GRAVITY };
        this.state = s;
        return;
      case HS.Ladder: {
        const footX = HERO_W * 0.5 + this.rect.x, footY = this.rect.y + HERO_H + 1;
        if (isPressed('up') || !W.map.isHard(footX, footY)) {
          this.vel = { x: 0, y: 0 };
          this.acc = { x: 0, y: 0 };
          const col = Math.floor((this.rect.x + HERO_W * 0.5) / ts);
          // centre on the ladder column (particle position too, or the end-of-frame setPosition(ppos) undoes
          // it and an off-centre hero snags on the walls beside the ladder)
          this.setPosition((col + 0.5) * ts, this.pos.y);
          this.ppos.x = this.pos.x;
          this.state = s;
          this.setAnim('CLIMB');
          this.anim.goToAndPlay(0);
        }
        return;
      }
      case HS.Fall:
        this.platform = null;
        this.setJumpAnim(4);
        if (this.state === HS.Ladder || this.state === HS.Entrance) this.acc = { x: 0, y: GRAVITY };
        this.state = HS.Jump;
        return;
      case HS.DoubleJump: {
        if (this.state === HS.Ladder || this.state === HS.Entrance) this.acc = { x: 0, y: GRAVITY };
        this.state = s;
        const horizontal = dirX() !== 0;
        const fx = this.pos.x, fy = this.pos.y - 5;
        W.addEffect(horizontal ? 'JUMP_EFFECT_RIGHT' : 'JUMP_EFFECT_UP', fx, fy, horizontal && dirX() < 0 ? -1 : 1);
        return;
      }
      case HS.Dead:
        if (W.immortal || this.immortal) return;
        W.state.energy = MAX_ENERGY;
        this.platform = null;
        this.deathWait = DEATH_WAIT;
        W.startDeathTransition(DEATH_WAIT * 2);
        stopMusic();
        playSound('HERO_DEATH');
        this.state = s;
        this.setAnim('HERO_DEATH');
        return;
      case HS.Entrance: {
        this.acc = { x: 0, y: 0 };
        const col = Math.floor((this.rect.x + HERO_W * 0.5) / ts);
        this.translate((col + 0.5) * ts - this.pos.x, 0);
        if (!this.entranceActive) {
          if (dirY() >= 0) {
            this.setAnim('END_CLIMB');
            this.standAfterClimb = true;
          } else {
            this.setAnim('BEGIN_CLIMB');
            this.standAfterClimb = false;
          }
        } else {
          this.setAnim('ENTRANCE');
          this.standAfterClimb = true;
        }
        this.anim.goToAndPlay(0);
        this.state = s;
        return;
      }
      case HS.Block:
        this.vel = { x: 0, y: 0 };
        this.setAnim(this.shooting ? 'SHOT_DUCK' : 'BLOCK_IN');
        this.state = HS.Block;
        return;
      default:
        this.state = s;
    }
  }

  // ---------- damage ----------
  /** Hero::onCollisionEnemy: contact damage. redTime is the invulnerability window after a hit. */
  onCollisionEnemy(damage: number): void {
    if (this.state === HS.Dead || this.redTime > 0) return;
    this.world.state.subEnergy(damage);
    if (this.world.state.energy < 1) {
      this.setState(HS.Dead);
      return;
    }
    this.redTime = HIT_FLASH;
    playSound('HERO_HIT');
  }
  /** Hero::onCollision: hit by an enemy bullet travelling with horizontal velocity sign `bulletDir`. */
  /** Hero::onCollision(Bullet): blocking (state 12, not shooting) stops shots that come from the front. */
  private shieldStops(bulletVx: number): boolean {
    return this.state === HS.Block && !this.shooting && this.dir !== Math.sign(bulletVx);
  }
  /** Area a bullet must touch: the body, plus the raised shield (up to 30 px ahead of the feet) when blocking. */
  hitRectFor(bulletVx: number): Rect {
    const r = this.rect;
    if (!this.shieldStops(bulletVx)) return r;
    const front = this.pos.x + this.dir * SHIELD_REACH;
    const x0 = Math.min(r.x, front), x1 = Math.max(r.x + r.w, front);
    return { x: x0, y: r.y, w: x1 - x0, h: r.h };
  }

  onBullet(bulletX: number, bulletY: number, bulletDir: number): void {
    if (this.state === HS.Dead) return;
    const W = this.world;
    if (this.shieldStops(bulletDir)) {
      // HERO_DEFENSE_1/2 at random + ORANGE_SHINE where the shot meets the shield; no energy lost
      playSound(Math.random() < 0.5 ? 'HERO_DEFENSE_1' : 'HERO_DEFENSE_2');
      W.addEffect('ORANGE_SHINE', bulletX, bulletY, -Math.sign(bulletDir) || -this.dir);
      return;
    }
    W.state.subEnergy(1);
    if (W.state.energy < 1) {
      this.setState(HS.Dead);
      return;
    }
    W.addEffect('ORANGE_SHINE', bulletX, bulletY, -Math.sign(bulletDir));
    this.redTime = HIT_FLASH;
    playSound('HERO_HIT');
  }
  /** Hero::reactionAfterJumpEnemy */
  bounce(): void { this.vel.y = VELOCITY_JUMP[4] * 0.6; }

  /** Land on a one-way moving platform's top surface (Scenario calls this each frame while standing on it). */
  landOnPlatform(topY: number): void {
    if (this.state === HS.Dead || this.state === HS.Entrance) return;
    this.translate(0, topY - this.pos.y);
    this.vel.y = 0;
    if (this.state !== HS.Ladder && this.state !== HS.Block) {
      if (this.vel.x !== 0) { this.setAnim(this.shooting ? 'SHOT_RUN' : 'WALK'); this.setState(HS.Walk); }
      else { this.setStandAnim(); this.setState(HS.Stand); }
    }
    this.ppos = { ...this.pos };
    this.world.camera.setPlatformPos(this.pos.x, this.pos.y, this.rect.h);
  }

  /** Carry the hero along with a moving platform. */
  ridePlatform(dx: number, dy: number): void {
    this.translate(dx, dy);
    this.ppos.x += dx;
    this.ppos.y += dy;
    // safety: don't carry the hero into a wall (undo the horizontal part if it would clip a hard tile)
    const m = this.world.map;
    const my = this.rect.y + this.rect.h * 0.5;
    if (m.isHard(this.rect.x + this.rect.w - 1, my) || m.isHard(this.rect.x, my)) {
      this.translate(-dx, 0);
      this.ppos.x -= dx;
    }
  }

  /** Push the hero back horizontally (door / solid object blocking). */
  pushX(dx: number): void {
    this.translate(dx, 0);
    this.ppos.x += dx;
  }

  // ---------- Hero::update ----------
  update(dt: number): void {
    if (this.state === HS.Dead) {
      if (this.deathWait <= 0) {
        this.integrate(dt);
        this.state = HS.Fall;
        this.world.onHeroDeathFinished();
      } else {
        this.deathWait -= dt;
      }
      this.limitBounds();
      return;
    }
    if (this.state !== HS.Entrance) {
      this.integrate(dt);
      if (this.vel.y > MAX_FALL) this.vel.y = MAX_FALL;
    }
    this.processState(dt);
    this.processIntersections();
    this.limitBounds();
  }

  private integrate(dt: number): void {
    const ax = this.acc.x, ay = this.acc.y;
    const px = this.vel.x * dt + 0.5 * ax * dt * dt;
    const py = this.vel.y * dt + 0.5 * ay * dt * dt;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.ppos.x += px;
    this.ppos.y += py;
  }
  /** particle position (0x214); synced to pos through setPosition at the end of processState */
  private ppos = { x: 0, y: 0 };

  private fire(): void {
    playSound('BULLET_XA');
    const yOff = this.state === HS.Jump ? -20 : this.state === HS.Block ? -13 : -15;
    this.world.spawnHeroBullet(this.pos.x + this.dir * 25, this.pos.y + yOff, this.dir * 500);
    this.shotCount++;
    this.shotWait = 1 / FIRE_RATE;
    if (this.shotCount >= BURST) {
      this.shotCount = 0;
      this.shotWait = BURST_PAUSE;
    }
  }

  // ---------- Hero::processState ----------
  private processState(dt: number): void {
    const W = this.world;
    const ts = W.map.ts;
    this.ppos.x = this.ppos.x || this.pos.x;

    // shooting
    if (isFirstPress('fire') && !this.winner && this.state !== HS.Ladder && this.state !== HS.Entrance) {
      this.shotHold = 0;
      this.fire();
    }
    this.shotHold += dt;
    if (!this.shooting || this.shotHold > 0.05) {
      this.shooting = !this.winner && isPressed('fire');
    }
    if (this.state === HS.Ladder || this.state === HS.Entrance) {
      this.shooting = false;
      this.shotCount = 0;
    } else if (!this.shooting) {
      this.shotCount = 0;
    } else {
      this.shotWait -= dt;
      if (this.shotWait <= 0) this.fire();
    }

    if (dirY() < 0 && (this.state === HS.Stand || this.state === HS.Walk)) this.setState(HS.Block);

    // jump
    const jump = !this.winner && (isFirstPress('jumpHold') || isFirstPress('jumpTap'));
    if (jump && !(this.state === HS.Ladder && dirY() > 0) && this.state !== HS.Entrance && this.state !== HS.DoubleJump) {
      if (this.state === HS.Ladder) {
        if (dirY() < 0) {
          this.setState(HS.Fall);
          this.jumpedStraight = true;
          this.vel.y = 0;
          this.setJumpAnim(1);
          this.platform = null;
        }
      } else if (this.state === HS.Jump) {
        if (W.state.cereals > 0) {
          this.setState(HS.DoubleJump);
          playSound('DOUBLE_JUMP');
          this.vel.y = VELOCITY_DOUBLE_JUMP[Math.min(W.state.cereals, 4)];
          this.setJumpAnim(0);
          this.platform = null;
          this.jumpedStraight = dirX() === 0;
          this.translate(0, -IGNORE_Y);
          this.ppos.y -= IGNORE_Y;
        }
      } else if (this.state !== HS.Fall) {
        this.setState(HS.Jump);
        playSound('HERO_JUMP');
        this.vel.y = VELOCITY_JUMP[Math.min(W.state.heros, 4)];
        this.ppos.y -= IGNORE_Y;
        this.setJumpAnim(0);
        this.platform = null;
        this.jumpedStraight = dirX() === 0;
        this.translate(0, -2);
        this.ppos.y -= 2;
      }
    }

    // entrance / end of ladder
    if (this.state === HS.Entrance) {
      if (this.entranceActive && this.anim.frameNum() > 29) {
        this.entranceActive = false;
        W.camera.shake(0.8);
        W.addEffect('JUMP_EFFECT_UP', this.pos.x, this.pos.y + 5, 1);
        playSound('ENTRANCE');
      }
      if (this.anim.isOver()) {
        this.entranceActive = false;
        if (!this.standAfterClimb) {
          this.translate(0, HERO_H + 7);
          this.ppos = { ...this.pos };
          this.setState(HS.Ladder);
        } else {
          this.setStandAnim();
          this.setState(HS.Stand);
          this.ppos = { ...this.pos };
          this.acc = { x: 0, y: GRAVITY };
        }
      }
    } else {
      // ladders
      const cx = this.rect.x + HERO_W * 0.5;
      if (dirY() > 0 && this.isInLadder()) {
        const top = this.isInLadderEnd();
        if (top !== null && this.state >= HS.Fall && this.state <= HS.DoubleJump) {
          this.setPosition(this.pos.x, Math.floor(top / ts) * ts + 2);
          this.ppos = { ...this.pos };
          this.setState(HS.Entrance);
        } else if (this.state !== HS.Ladder) {
          this.setState(HS.Ladder);
        }
      } else if (dirY() < 0 && W.map.isOverLadder(cx, this.rect.y + HERO_H) && this.state !== HS.Ladder) {
        this.setState(HS.Entrance);
      }
    }

    const sx = this.winner ? 1 : Math.sign(dirX()); // ganador: camina solo hacia la derecha (ControllerHero::process)
    switch (this.state) {
      case HS.Stand: case HS.State1:
        this.vel.x = sx * VELOCITY_WALK;
        this.vel.y = Math.sign(dirY()) * 0 || this.vel.y;
        if (this.vel.x !== 0) {
          this.setAnim(this.shooting ? 'SHOT_RUN' : 'WALK');
          this.setState(HS.Walk);
        }
        break;
      case HS.Walk: {
        const name = this.shooting ? 'SHOT_RUN' : 'WALK';
        if (this.anim.name !== name) this.setAnim(name, true);
        this.vel.x = sx * VELOCITY_WALK;
        break;
      }
      case HS.GoDown:
        this.vel.x = 0;
        this.vel.y = Math.sign(dirY()) * VELOCITY_GO_DOWN;
        break;
      case HS.Ladder: {
        this.vel.x = 0;
        this.vel.y = -Math.sign(dirY()) * VELOCITY_GO_DOWN;
        const above = W.map.isAnyLadder(cxOf(this), this.rect.y - 5);
        const below = W.map.isAnyLadder(cxOf(this), this.rect.y);
        if (!above && below) {
          const top = Math.floor(this.rect.y / ts) * ts + 2;
          this.setPosition(this.pos.x, top);
          this.ppos = { ...this.pos };
          this.setState(HS.Entrance);
        } else if (!this.isInLadder()) {
          this.setState(HS.Fall);
        }
        break;
      }
      case HS.State5:
        this.vel.x = sx * VELOCITY_WALK;
        if (this.vel.y > 25) this.setState(HS.Fall);
        break;
      case HS.Fall: case HS.Jump: case HS.DoubleJump:
        this.setJumpAnim(-1);
        this.vel.x = sx * VELOCITY_WALK;
        break;
      case HS.Block: {
        if (!this.shooting) {
          if (dirY() < 0) {
            if (this.anim.name !== 'BLOCK_IN') this.setAnim('BLOCK_IN');
          } else {
            if (this.anim.name !== 'BLOCK_OUT') {
              const left = this.anim.duration() - this.anim.time;
              this.setAnim('BLOCK_OUT');
              this.anim.time = Math.max(0, left);
            }
            if (this.anim.isOver()) {
              this.setAnim('WALK');
              this.setState(HS.Walk);
            }
          }
        } else {
          if ((this.anim.name === 'BLOCK_OUT' || this.anim.name === 'SHOT_DUCK') && dirY() < 0 && this.anim.isOver()) this.setAnim('SHOT_DUCK');
          else if (this.anim.name !== 'BLOCK_OUT' && this.anim.name !== 'SHOT_DUCK') this.setAnim('BLOCK_OUT');
          if (dirY() >= 0) this.setState(HS.Walk);
        }
        break;
      }
      default:
        break;
    }

    // animation advance (+ footstep / stair sounds)
    if (this.state === HS.Ladder) {
      const before = this.anim.frameNum();
      this.anim.update(-Math.sign(dirY()) * dt);
      const after = this.anim.frameNum();
      if (before !== after) {
        if (after === 1) playSound('STAIR_1');
        else if (after === 3) playSound('STAIR_2');
      }
    } else {
      const before = this.anim.frameNum();
      this.anim.update(dt);
      if (this.state === HS.Walk && !this.immortal) {
        const after = this.anim.frameNum();
        if (before !== after) {
          if (after === 0) playSound(Math.random() < 0.5 ? 'STEP_3' : 'STEP_1');
          else if (after === 5) playSound(Math.random() < 0.5 ? 'STEP_4' : 'STEP_2');
        }
      }
    }
    if (this.redTime > 0) this.redTime -= dt;

    if (this.state !== HS.Entrance) this.setPosition(this.ppos.x, this.ppos.y);
  }

  private isInLadder(): boolean {
    const m = this.world.map, x = cxOf(this);
    const bottom = this.rect.y + HERO_H;
    for (let y = this.rect.y; y < bottom; y += m.ts) if (m.isAnyLadder(x, y)) return true;
    return m.isAnyLadder(x, this.rect.y);
  }
  private isInLadderEnd(): number | null {
    const m = this.world.map, x = cxOf(this);
    const bottom = this.rect.y + HERO_H;
    for (let y = this.rect.y; y < bottom; y += m.ts) if (m.isLadderEnd(x, y)) return y;
    return m.isLadderEnd(x, this.rect.y) ? this.rect.y : null;
  }

  // ---------- Hero::processIntersections ----------
  private processIntersections(): void {
    if (this.state === HS.Dead || this.state === HS.Entrance) {
      this.vel = this.state === HS.Dead ? { x: 0, y: 0 } : this.vel;
      return;
    }
    const W = this.world;
    const mx = this.pos.x - this.prev.x, my = this.pos.y - this.prev.y;
    const hit = W.map.intersect(this.rect, mx, my);
    if (hit.place !== Place.None) {
      this.translate(hit.dx, hit.dy);
      this.ppos.x += hit.dx;
      this.ppos.y += hit.dy;
    }
    if (W.map.isDead(this.rect)) {
      this.setState(HS.Dead);
      return;
    }
    const st = this.state;
    switch (hit.place) {
      case Place.None:
        if ((st === HS.Walk || st === HS.Stand) && !this.platform) this.setState(HS.Fall);
        break;
      case Place.Left: case Place.Right:
        this.vel.x = 0;
        break;
      case Place.Floor: case Place.FloorLeft: case Place.FloorRight:
        if (this.vel.y > 0) {
          if (this.state !== HS.Block) {
            this.setAnim('WALK');
            this.setState(HS.Walk);
          }
          this.vel.y = 0;
        }
        if (this.state !== HS.Ladder && this.vel.x === 0 && this.vel.y === 0 && this.state !== HS.Block) {
          this.setState(HS.Stand);
          this.setStandAnim();
        }
        W.camera.setPlatformPos(this.pos.x, this.pos.y, HERO_H);
        break;
      case Place.Ceiling:
        this.vel.y = 0;
        break;
      case Place.CeilingLeft: case Place.CeilingRight:
        this.vel = { x: 0, y: 0 };
        break;
    }
    if (this.state !== HS.Block && this.state !== HS.Ladder && this.vel.x === 0 && this.vel.y === 0) this.setStandAnim();
    if (!isFloorPlace(hit.place) && this.vel.x !== 0) this.dir = Math.sign(this.vel.x);
    this.setPosition(this.pos.x, this.pos.y);
  }

  private limitBounds(): void {
    const x = Math.min(Math.max(this.pos.x, HERO_W * 0.5 + 2), this.limit.w - HERO_W * 0.5 - 2);
    const y = Math.min(Math.max(this.pos.y, 0), this.limit.h);
    if (x !== this.pos.x || y !== this.pos.y) {
      this.ppos.x += x - this.pos.x;
      this.ppos.y += y - this.pos.y;
    }
    this.setPosition(x, y);
    // Hero::render flips by velocity sign
    if (this.vel.x > 0) this.dir = 1;
    else if (this.vel.x < 0) this.dir = -1;
  }

  // ---------- render ----------
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.visible) return;
    this.frameCounter = (this.frameCounter + 1) & 3;
    const x = Math.floor(this.pos.x) - Math.floor(camX);
    let y = Math.floor(this.pos.y) - Math.floor(camY);
    // entrance: drop in from the top of the screen during the first half of the animation
    if (this.state === HS.Entrance && this.entranceActive) y -= Math.max(0, 1 - this.anim.time / 0.5) * 340;
    const f = this.currentFrame();
    // Hero::render swaps to the red "_R" sheet while flashing after a hit (blinks 2 of every 4 frames).
    if (f) drawFrame(ctx, f, x, y, this.dir);
  }

  /** Current hero frame; resolves the red variant sheet during the damage flash. */
  private currentFrame(): Frame | null {
    const base = this.anim.frame();
    if (!base) return null;
    if (this.redTime > 0 && this.frameCounter >= 2) {
      const r = ANIMS[this.anim.name + '_R'];
      if (r) {
        const fd = r.frames[Math.min(this.anim.frameNum(), r.frames.length - 1)];
        const f = frameOf(fd.map, fd.i);
        if (f) return f;
      }
    }
    return base;
  }
}

function dirX(): number { return (isPressed('right') ? 1 : 0) - (isPressed('left') ? 1 : 0); }
function dirY(): number { return (isPressed('up') ? 1 : 0) - (isPressed('down') ? 1 : 0); }
function cxOf(h: Hero): number { return h.rect.x + HERO_W * 0.5; }
