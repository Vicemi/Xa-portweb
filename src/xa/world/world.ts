// Scenario equivalent: one loaded level with its tilemap, background, objects, bullets and effects.
import { Anim, drawFrame, frameOf, MAPS } from '../core/sprites';
import { drawLine } from '../core/font';
import { img } from '../core/assets';
import { playMusic, playSound } from '../core/audio';
import { GameCamera, VIEW_H, VIEW_W } from './camera';
import { Enemy, createEnemy } from './enemies';
import { createSvEnemy } from './svnz';
import { Hero, HS } from './hero';
import { Door, Platform } from './objects';
import type { HeroState } from './state';
import { TileMap, type Rect } from './tilemap';
import { TileState, type TmxLevel, type TmxObject } from './tmx';

export interface World {
  map: TileMap;
  camera: GameCamera;
  state: HeroState;
  hero: Hero;
  immortal: boolean;
  addEffect(anim: string, x: number, y: number, dir: number): void;
  spawnHeroBullet(x: number, y: number, vx: number): void;
  spawnEnemyBullet(x: number, y: number, vx: number, vy: number, g?: number, ax?: number): void;
  startDeathTransition(seconds: number): void;
  onHeroDeathFinished(): void;
  /** Is there a floor (hard tile OR moving platform) at the given world point? */
  hasFloor(x: number, y: number): boolean;
}

export interface WorldEvents {
  gameOver(): void;
  levelComplete(): void;
  message(text: string, seconds: number): void;
  saving(): void;
}

interface Effect { anim: Anim; x: number; y: number; dir: number }
/** VolatilePoints: the awarded score in the pixel font, rising 40 px with easeOutQuint over 1.2 s. */
interface PointsFx { value: number; x: number; y: number; t: number }
const POINTS_FX_TIME = 1.2;
const COW_POINTS = 1000; // Cow points (loadObjects: mov [obj+0x394], 0x3e8)
interface Bullet { x: number; y: number; vx: number; vy: number; team: number; alive: boolean; g?: number; ax?: number }

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
  touching = false;
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
  hero: Hero;
  immortal = false;
  winner = false;
  winTime = 6.0;
  fade = 0;
  fadeDir = 0;
  private effects: Effect[] = [];
  private pointsFx: PointsFx[] = [];
  /** current level track (pMusic of the map, or of the last checkpoint that carried one) */
  private music: string | null = null;
  /** SavePoint::mpActualSavePoint: only the active checkpoint shines */
  private activeSave: Thing | null = null;
  private explosions: (Effect & { rect: Rect; t: number })[] = [];
  private bullets: Bullet[] = [];
  private things: Thing[] = [];
  private enemies: Enemy[] = [];
  private platforms: Platform[] = [];
  private doors: Door[] = [];
  private heroOnPlatform: Platform | null = null;
  private restore = { x: 0, y: 0 };
  private bgPath: string;
  private tilesetPath: string;

  constructor(readonly level: TmxLevel, readonly levelNum: number, public state: HeroState, private events: WorldEvents) {
    this.map = new TileMap(level);
    this.hero = new Hero(this);
    this.hero.limit = { w: this.map.widthPx, h: this.map.heightPx };
    this.bgPath = 'assets/images/background/' + (level.props.pBackground ?? 'background_1.jpg');
    this.tilesetPath = level.tilesetImage.replace('/tiles/', '/tiles/win/');
    this.loadObjects();
    this.music = level.props.pMusic ?? null;
    if (this.music) playMusic(this.music);
  }

  /** Every image path this level needs (for preloading). */
  static imagePaths(level: TmxLevel): string[] {
    return [
      'assets/images/background/' + (level.props.pBackground ?? 'background_1.jpg'),
      level.tilesetImage.replace('/tiles/', '/tiles/win/'),
      ...Object.values(MAPS).map((m) => m.path),
    ];
  }

  private loadObjects(): void {
    const ts = this.map.ts;
    let cows = 0, coins = 0;
    for (const o of this.level.objects) {
      const f = feetOf(o.x, o.y, ts);
      switch (o.type) {
        case 'Hero':
          this.restore = f;
          this.hero.spawn(f.x, f.y);
          break;
        case 'Item':
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
          if (e) this.enemies.push(e);
          break;
        }
      }
    }
    this.state.startStage(this.levelNum, cows, coins);
    this.camera.init(this.map.widthPx, this.map.heightPx, this.hero.pos.x, this.hero.pos.y, this.hero.height);
  }

  // ---------- World ----------
  addEffect(anim: string, x: number, y: number, dir: number): void {
    const a = new Anim(anim);
    if (a.type) this.effects.push({ anim: a, x, y, dir });
  }
  spawnHeroBullet(x: number, y: number, vx: number): void {
    this.bullets.push({ x, y, vx, vy: 0, team: 0, alive: true });
  }
  spawnEnemyBullet(x: number, y: number, vx: number, vy: number, g = 0, ax = 0): void {
    this.bullets.push({ x, y, vx, vy, team: 1, alive: true, g, ax });
  }
  /** Remove an enemy with a death burst (no points). */
  private removeEnemy(e: Enemy): void {
    e.alive = false;
    playSound('ENEMY_DEATH');
    this.addEffect('ENEMY_DEATH', e.x, e.y - e.h / 2, 1);
  }
  private killEnemy(e: Enemy, byBullet = false): void {
    if (e.isBomb) {
      // EnemyBomb::onCollision: explode into an 8-way radial burst ("8_BULLETS", speed 200).
      e.alive = false;
      playSound('ENEMY_DEATH');
      this.addEffect('BOMBA_DEATH', e.x, e.y - e.h / 2, 1);
      this.burst8(e);
      this.award(e.points, e.x, e.y - e.h / 2);
      return;
    }
    this.removeEnemy(e);
    if (byBullet && e.burstsOnShotDeath) this.burst8(e); // Jumper::onCollision
    this.award(e.points, e.x, e.y - e.h / 2);
  }
  /** Hero::addItems("POINTS", n) + EnemyHelper::addPointsEffect at the centre of the object's bound. */
  private award(points: number, x: number, y: number): void {
    if (points <= 0) return;
    this.state.addPoints(points);
    this.pointsFx.push({ value: points, x, y, t: 0 });
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
    this.camera.shake(3.0);
    playSound('ENEMY_DEATH');
    const b = e.bounds();
    this.explosions.push({ anim: new Anim('BOSS_DEAD'), x: e.x, y: e.y - e.h / 2, dir: e.dir, rect: b, t: 0 });
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
  onHeroDeathFinished(): void {
    const s = this.state;
    if (s.lives <= 0) {
      s.lives = 3;
      this.events.gameOver();
      return;
    }
    s.lives -= 1;
    if (this.music) playMusic(this.music); // the track a checkpoint switched to keeps playing (AudioLibrary state)
    // Scenario::init(Vector2): every volatile object (bullets, effects, floating points) is removed and the HUD
    // message is cleared
    this.bullets = [];
    this.effects = [];
    this.pointsFx = [];
    this.explosions = [];
    this.events.message('', 0);
    this.hero.vel = { x: 0, y: 0 };
    this.hero.spawn(this.restore.x, this.restore.y);
    this.camera.goToGoal(this.restore.x, this.restore.y, this.hero.height);
    this.fadeDir = -Math.abs(this.fadeDir || 1);
  }

  // ---------- update ----------
  update(dt: number): void {
    const h = this.hero;
    if (!h.isAlive()) {
      // InGame::update: while Xa is dead only the hero (its death wait) and the transition run; the hero itself
      // calls Scenario::updateAnimations, so effects keep playing but enemies, bullets and platforms freeze
      h.update(dt);
      if (!h.isAlive()) { this.updateAnimations(dt); return; }
    } else {
      h.update(dt);
    }
    this.camera.update(dt, h.pos.x, h.pos.y, h.height, h.dir, h.vel.x, h.vel.y, this.winner);

    // platforms: move + hero landing/riding
    for (const p of this.platforms) {
      p.update(dt);
      const onX = h.pos.x > p.x - 8 && h.pos.x < p.x + p.w + 8;
      if (this.heroOnPlatform === p) {
        if (!h.isAlive() || h.vel.y < 0 || !onX) this.heroOnPlatform = null;
        else {
          h.landOnPlatform(p.y);                     // snap feet to the platform top (vertical)
          h.ridePlatform(p.x - p.prevX, 0);          // carry horizontally (vertical already handled)
        }
      } else if (h.isAlive() && h.vel.y >= 0 && onX &&
                 h.pos.y >= p.y - 1 && h.pos.y - h.vel.y * dt <= p.y + 2) {
        // crossed the platform top during this fall (prev is overwritten by collision, so use velocity)
        h.landOnPlatform(p.y);
        this.heroOnPlatform = p;
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
    // doors: block until opened with the right key
    for (const d of this.doors) {
      d.update(dt);
      if (d.gone) continue;
      const db = d.bounds();
      if (overlaps(h.rect, db)) {
        if (!d.open && d.tryOpen(this.state.keys)) continue;
        if (d.open) continue; // sinking: no longer pushes the hero back
        if (h.vel.x > 0) h.pushX(db.x - (h.rect.x + h.rect.w));
        else if (h.vel.x < 0) h.pushX(db.x + db.w - h.rect.x);
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
      if (!h.isAlive()) continue;
      const hit = overlaps(h.rect, t.bounds());
      if (hit && !t.touching) this.touch(t);
      t.touching = hit;
    }

    // enemies: update + hero contact (stomp vs. damage)
    // Scenario::processWorldView: only objects inside the camera rect grown by (400, 100) on each side are awake
    const cam0 = this.camera;
    const wx0 = cam0.x - 400, wx1 = cam0.x + VIEW_W + 400, wy0 = cam0.y - 100, wy1 = cam0.y + VIEW_H + 100;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.x < wx0 || e.x > wx1 || e.y < wy0 || e.y - e.h > wy1) continue;
      e.update(dt);
      if (h.isAlive()) {
        const eb = e.bounds();
        if (!e.ignoresContact && overlaps(h.rect, eb)) {
          if (e.isInstantKill) {
            h.setState(HS.Dead); // StubEnemy/EnemyDeathBarrier: touching = instant death (no damage)
          } else if (e.isIndestructible) {
            h.onCollisionEnemy(4); // hazard: contact damage only, never destroyed
          } else if (!e.unstompable && h.vel.y > 0 && h.rect.y + h.rect.h - eb.y < 24) {
            h.bounce();
            if (e.isBoss) { if (e.onBullet()) this.killBoss(e); }
            else this.killEnemy(e);
          } else {
            h.onCollisionEnemy(4);
            if (e.contactRemoves) this.removeEnemy(e); // original: contact removes the enemy (death effect, no points)
          }
        } else if (e.alive) {
          // extra enemies' melee strikes (SVNZ red rects) hurt like a contact without consuming the enemy
          const ar = e.attackRect();
          if (ar && overlaps(h.rect, ar)) h.onCollisionEnemy(4);
        }
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive);

    const cam = this.camera;
    for (const b of this.bullets) {
      if (!b.alive) continue;
      if (b.g) b.vy += b.g * dt;
      if (b.ax) b.vx += b.ax * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < cam.x - 32 || b.x > cam.x + cam.w + 32 || b.y < cam.y - 32 || b.y > cam.y + cam.h + 32) {
        b.alive = false;
        continue;
      }
      if (this.map.stateAt(b.x, b.y) === TileState.Hard) {
        b.alive = false;
        playSound(Math.random() < 0.5 ? 'BULLET_WALL_1' : 'BULLET_WALL_2');
        const ts = this.map.ts;
        const ex = Math.round(b.x / ts) * ts - 1;
        this.addEffect(b.team === 0 ? 'SHIELD_GREEN' : 'SHIELD', ex, b.y, -Math.sign(b.vx));
        continue;
      }
      if (b.team === 0) {
        for (const e of this.enemies) {
          // only Guillotine / Rocket are isInvisibleForBullet; everything else stops the shot (spikes included, even
          // though they take no damage) and SimpleBullet::onNeutralized leaves a GREEN_SHINE where it hit
          if (!e.alive || e.isBulletProof) continue;
          if (overlaps({ x: b.x - 3, y: b.y - 3, w: 6, h: 6 }, e.bounds())) {
            b.alive = false;
            this.addEffect('GREEN_SHINE', b.x, b.y, -Math.sign(b.vx) || 1);
            if (e.isIndestructible) break;
            if (e.isBoss) {
              this.camera.shake(0.2); // EnemyBoss::onCollision: every hit shakes the camera
              if (e.onBullet()) this.killBoss(e);
            } else if (e.onBullet()) { this.killEnemy(e, true); this.grantKey(e); }
            break;
          }
        }
      } else if (h.isAlive()) {
        // bullets are 6x6 rects (XABulletFactory setSize(6,6)); while Xa blocks facing the shot, the hit area
        // reaches the front of the raised shield so the bullet visibly smashes against it
        const hr = h.hitRectFor(b.vx);
        if (overlaps({ x: b.x - 3, y: b.y - 3, w: 6, h: 6 }, hr)) {
          b.alive = false;
          h.onBullet(b.x, b.y, Math.sign(b.vx));
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.alive);

    this.updateAnimations(dt);
  }

  /** Scenario::updateAnimations: the volatile effects (blasts, shines, floating points, boss explosion). */
  private updateAnimations(dt: number): void {
    for (const x of this.explosions) {
      x.anim.update(dt);
      x.t -= dt;
      if (x.anim.frameNum() < 3 && x.t <= 0) {
        x.t = Math.random() * 0.1;
        const r = x.rect;
        const px = r.x - 20 + Math.random() * (r.w + 35);
        const py = r.y + x.anim.frameNum() * r.h * 0.2 + Math.random() * (r.h - x.anim.frameNum() * r.h * 0.2);
        this.addEffect('MEGA_POWER', px, py, 1);
      }
    }
    this.explosions = this.explosions.filter((x) => !x.anim.isOver());
    for (const p of this.pointsFx) p.t += dt;
    this.pointsFx = this.pointsFx.filter((p) => p.t < POINTS_FX_TIME);
    for (const e of this.effects) e.anim.update(dt);
    this.effects = this.effects.filter((e) => !e.anim.isOver());
  }

  private touch(t: Thing): void {
    const s = this.state;
    const p = t.o.props;
    switch (t.o.type) {
      case 'Information':
        if (p.pText) this.events.message(p.pText, 4);
        playSound('INFO');
        return;
      case 'SavePoint':
        // SavePoint::intersects: becomes the restoration point; when it is a NEW checkpoint: SAVING sound, the
        // HUD "saving" anim and reactionOnAction (switch to its pMusic, e.g. xa_boss before the final boss)
        this.restore = { x: t.x, y: t.y };
        if (this.activeSave !== t) {
          playSound('SAVING');
          this.events.saving();
          if (p.pMusic) { this.music = p.pMusic; playMusic(this.music); }
          if (this.activeSave?.anim) this.activeSave.anim.goToAndPlay(0);
          this.activeSave = t;
        }
        return;
      case 'Cow':
        if (t.rescueTime < 0) {
          // Cow::intersects: points + VolatilePoints, COW_RESCUED_1, HAPPY_COW anim, HeroState::addCows
          t.mapName = 'HAPPY_COW';
          t.anim = new Anim('HAPPY_COW');
          t.rescueTime = 1.0; // blink time once the anim is over
          s.cows++;
          this.award(COW_POINTS, t.x, t.y - 24);
          playSound('COW_RESCUED_1');
        }
        return;
    }
    const req = p.pRequiredItem ?? p.pAsset;
    const count = +(p.pCount ?? 1) || 1;
    switch (req) {
      case 'POINTS':
        s.coins++;
        s.addPoints(ITEM_POINTS);
        playSound('COIN');
        break;
      case 'LIVES':
        s.addLives(count);
        playSound('HERO_LIFE');
        break;
      case 'ENERGY':
        s.addEnergy(count);
        playSound('HERO_ENERGY');
        break;
      case 'ENERGY_DOUBLE_JUMP':
        s.cereals = Math.min(1, s.cereals + 1); // HeroState::addCereals caps at 1
        playSound('POWERUP');
        break;
      case 'ENERGY_JUMP':
        s.heros = Math.min(4, s.heros + 1);
        playSound('POWERUP');
        break;
      case 'ENDING':
        if (!this.winner) {
          this.winner = true;
          this.hero.winner = true;
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

    this.hero.render(ctx, cam.x, cam.y);

    for (const b of this.bullets) {
      const f = frameOf(b.team === 0 ? 'BULLET' : 'BULLET_ENEMY', 0);
      if (f) drawFrame(ctx, f, Math.floor(b.x - cx), Math.floor(b.y - cy), Math.sign(b.vx) || 1);
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

    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  get heroState(): HS { return this.hero.state; }

  resumeMusic(): void {
    if (this.music && this.hero.isAlive()) playMusic(this.music);
  }
}
