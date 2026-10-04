// GameCamera equivalent (behaviour taken from xa.exe: look-ahead, vertical dead zone, shake, limits).
export const VIEW_W = 512;
export const VIEW_H = 384;

export class GameCamera {
  x = 0;
  y = 0;
  w = VIEW_W;
  h = VIEW_H;
  /** viewProportion (0.6, 0.6) */
  propX = 0.6;
  propY = 0.6;
  private velX = 0;
  private velY = 0;
  private goalX = 0;
  private goalY = 0;
  private lastHeroDir = 0;
  private turning = 0;     // state at +0x64
  private turnDir = 0;
  private lastVDir = 0;
  private shakeTime = 0;
  private shakeTick = 0;
  private readonly shakeRate = 1 / 30;
  private worldW = VIEW_W;
  private worldH = VIEW_H;
  private prevHero = { x: 0, y: 0 };

  init(worldW: number, worldH: number, heroX: number, heroY: number, heroH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
    this.velX = this.velY = 0;
    this.turning = 0;
    this.lastHeroDir = 0;
    this.x = heroX - this.w / 2;
    this.y = heroY - heroH * 0.5 - this.h * this.propY;
    this.prevHero = { x: Math.floor(heroX), y: Math.floor(heroY) };
    this.limit();
  }

  shake(seconds: number): void {
    this.shakeTick = 0;
    this.shakeTime = seconds;
  }

  /** GameCamera::setPlatformPos: re-centre vertically on a landing spot at 400 px/s. */
  setPlatformPos(heroX: number, feetY: number, heroH: number): void {
    const y = feetY - heroH * 0.5 - this.h * this.propY;
    this.goalY = y;
    this.velY = Math.sign(y - this.y) * Math.min(2000, 400);
  }

  /** GameCamera::goToGoal: snap to the hero (used on respawn). */
  goToGoal(heroX: number, feetY: number, heroH: number): void {
    this.y = feetY - heroH * 0.5 - this.propY * this.h;
    this.x = (this.propX - 0.5) * this.w + (heroX - this.w / 2);
    this.limit();
  }

  update(dt: number, heroX: number, heroY: number, heroH: number, heroDir: number, heroVx: number, heroVy: number, winner: boolean): void {
    if (winner) return;
    const hx = Math.floor(heroX), hy = Math.floor(heroY);
    const moveX = hx - this.prevHero.x, moveY = hy - this.prevHero.y;
    this.prevHero = { x: hx, y: hy };
    const half = this.w / 2;

    let dir = heroDir || this.lastHeroDir;
    if (this.turning === 0) {
      if (this.lastHeroDir === dir || this.lastHeroDir === 0) {
        const gx = (this.propX - 0.5) * dir * this.w + (hx - half);
        this.goalX = gx;
        this.velX = Math.sign(gx - this.x) * Math.min(2000, 800);
      } else {
        this.turning = 1;
        this.velX = -this.velX;
        this.turnDir = this.lastHeroDir;
      }
    } else if (this.turning === 1) {
      const v = (hx - this.x - (half - (this.propX - 0.5) * this.turnDir * this.w)) * this.turnDir;
      if (v > 0 || v < 5) this.turning = 0;
    }
    this.lastHeroDir = dir;

    let vdir = Math.sign(moveY) || this.lastVDir;
    this.lastVDir = vdir;
    const centreY = hy - heroH * 0.5;
    if (centreY - this.y < (1 - this.propY) * this.h) {
      const speed = Math.min(2000, Math.max(800, heroVy));
      this.goalY = centreY - (1 - this.propY) * this.h;
      this.velY = Math.sign(this.goalY - this.y) * speed;
    }
    if (this.propY * this.h < centreY - this.y) {
      const speed = Math.min(2000, Math.max(800, heroVy));
      this.goalY = centreY - this.h * this.propY;
      this.velY = Math.sign(this.goalY - this.y) * speed;
    }

    const stepX = this.velX * dt, stepY = this.velY * dt;
    if (this.turning === 0) {
      const margin = (1 - this.propX) * this.w;
      if (hx - margin < this.x || this.x + this.w < margin + hx || moveX !== 0) {
        if (Math.abs(stepX) < Math.abs(this.goalX - this.x)) {
          this.x += Math.abs(this.x - hx) <= this.w * this.propX ? stepX : stepX * 3;
        } else {
          this.velX = 0;
          this.x = this.goalX;
        }
      }
    }
    if (Math.abs(stepY) < Math.abs(this.goalY - this.y)) this.y += stepY;
    else {
      this.velY = 0;
      this.y = this.goalY;
    }
    void heroVx;
    this.processShake(dt);
    this.limit();
  }

  private processShake(dt: number): void {
    if (this.shakeTime <= 0) return;
    this.shakeTick -= dt;
    if (this.shakeTick <= 0) {
      const r = () => (2 + Math.random() * 2) * (Math.random() < 0.5 ? -1 : 1);
      this.x += r();
      this.y += r();
      this.shakeTick = this.shakeRate;
    }
    this.shakeTime -= dt;
  }

  private limit(): void {
    const ox = this.x, oy = this.y;
    this.x = Math.min(Math.max(this.x, 0), Math.max(0, this.worldW - this.w));
    this.y = Math.min(Math.max(this.y, 0), Math.max(0, this.worldH - this.h));
    if (this.turning === 0 && ox !== this.x) { this.turning = 1; this.velX = 0; }
    if (oy !== this.y) this.velY = 0;
  }
}
