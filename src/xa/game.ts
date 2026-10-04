// Main loop + screen flow (original Xa screens: logo, loading, comic, menu, level select, help, credits,
// options, game over, victory). The world is drawn into a 512x384 offscreen canvas (integer pixels) and then
// scaled to fit any window, keeping the 4:3 aspect ratio. All art comes from the user's own game files.
import { hasGameFiles, img, listFiles, loadText, pickGameFolder, preloadImages, restoreGameFolder, useBundledAssets, useDevGameFiles } from './core/assets';
import { attachInput, isFirstPress, keyPressed, pollInput } from './core/input';
import { getMusicVolume, getSoundVolume, isMusicEnabled, isSoundEnabled, playMusic, playSound, preloadSounds, setMusicEnabled, setMusicVolume, setSoundEnabled, setSoundVolume, stopMusic, unlockAudio } from './core/audio';
import { drawText, fontPaths } from './core/font';
import { drawFrame, frameOf } from './core/sprites';
import levelData from './data/levels.json';
import { VIEW_H, VIEW_W } from './world/camera';
import { Hud } from './world/hud';
import { HeroState } from './world/state';
import { parseTmx } from './world/tmx';
import { Scenario } from './world/world';

export const LEVEL_COUNT = 16;
const LEVEL_TITLES = (levelData as unknown as { titles: string[] }).titles;
const STEP = 1 / 60;

type Screen = 'pick' | 'splash' | 'loading' | 'intro' | 'menu' | 'levels' | 'help' | 'credits' | 'options' | 'levelIntro' | 'play' | 'paused' | 'gameover' | 'win' | 'error';

interface LevelEntry { label: string; path: string; num: number }

// Button sprites (buttons_tile.png) + screen positions, from Menu::Menu (decompiled): [x, y] are the anchor
// centres in the 512x384 menu art; n/h are [sx, sy, sw, sh] source rects for normal / hover states.
const MENU_ITEMS = [
  { action: 'levels', x: 256, y: 295, n: [16, 59, 73, 29], h: [115, 53, 88, 41] },
  { action: 'help', x: 176, y: 330, n: [238, 113, 54, 22], h: [338, 108, 66, 33] },
  { action: 'options', x: 256, y: 330, n: [14, 112, 77, 24], h: [113, 107, 91, 34] },
  { action: 'credits', x: 336, y: 330, n: [13, 161, 79, 27], h: [112, 155, 94, 38] },
  { action: 'splash', x: 251, y: 365, n: [239, 63, 52, 25], h: [338, 56, 66, 36] },
] as const;

// Level-select node positions on map.png (LevelSelectScreen::LevelSelectScreen, decompiled).
const NODE_POS = [
  [190, 295], [338, 298], [295, 260], [420, 240], [303, 185], [442, 136], [300, 115],
  [460, 60], [315, 40], [130, 135], [212, 211], [60, 293], [20, 109], [90, 77], [18, 30], [135, 30],
];

const SCREEN_IMAGES = [
  'assets/images/menuElements/screen_logo_batovi.jpg',
  'assets/images/menuElements/screen_logo_calcar.jpg',
  'assets/images/menuElements/menu_night.jpg',
  'assets/images/menuElements/buttons_tile.png',
  'assets/images/menuElements/map.png',
  'assets/images/menuElements/options_win.png',
  'assets/images/menuElements/cargando_tile.png',
  'assets/images/menuElements/black_back.jpg',
  'assets/lang/images/intros/page_1.jpg',
  'assets/lang/images/intros/page_2.jpg',
  'assets/lang/images/intros/page_3.jpg',
  'assets/lang/images/intros/page_4.jpg',
  'assets/lang/images/intros/page_5.jpg',
  'assets/lang/images/intros/game_over.jpg',
  'assets/lang/images/intros/screen_win.jpg',
  'assets/lang/images/help/ayuda.jpg',
  'assets/lang/images/credits/creditos.jpg',
  'assets/lang/images/menu/press_any_key.png',
  'assets/images/menuElements/cursor.png',
];

const INTRO_PAGES = ['page_1', 'page_2', 'page_3', 'page_4', 'page_5'].map(
  (p, i) => `assets/lang/images/intros/${p}.jpg`,
);

export class XaGame {
  private ctx: CanvasRenderingContext2D;
  private world = document.createElement('canvas');
  private wctx: CanvasRenderingContext2D;
  private state = new HeroState();
  private hud = new Hud();
  scenario: Scenario | null = null;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private detach: () => void = () => {};
  private screen: Screen = 'pick';
  private menuIndex = -1;       // -1 = nothing selected (first arrow selects JUGAR)
  private levelIndex = 0;
  private levels: LevelEntry[] = [];
  private error = '';
  private needsPermission = false;
  private t = 0;                // time in the current screen
  private splashStep = 0;       // 0 = Batovi, 1 = Calcar
  private introPage = 0;
  private loadingIsBoot = false;
  private mouseX = 0;
  private mouseY = 0;
  private clicked = false;
  private hoverIndex = -1;
  private optionIndex = 0;
  private draggingSlider: 'sound' | 'music' | null = null;
  private mouseDown = false;
  private introLabel = '';
  levelNum = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.world.width = VIEW_W;
    this.world.height = VIEW_H;
    this.wctx = this.world.getContext('2d')!;
    this.canvas.style.cursor = 'none';
    this.state.load();
  }

  async start(): Promise<void> {
    this.detach = attachInput();
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onMouseMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    this.resize();
    const r = await restoreGameFolder(false);
    if (r === 'ok') await this.onFilesReady();
    else if (await useBundledAssets()) await this.onFilesReady();
    else if (await useDevGameFiles()) await this.onFilesReady();
    else this.needsPermission = r === 'needs-permission';
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.detach();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onMouseMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    stopMusic();
  }

  /** Called from a click/keydown (browsers require a user gesture for folder access and audio). */
  async userGesture(): Promise<void> {
    unlockAudio();
    if (this.screen !== 'pick' && this.screen !== 'error') return;
    try {
      let ok = false;
      if (this.needsPermission) ok = (await restoreGameFolder(true)) === 'ok';
      if (!ok) ok = await pickGameFolder();
      if (!ok) {
        this.error = 'Esa carpeta no contiene el juego (falta assets/data/level1.tmx).';
        this.screen = 'error';
        return;
      }
      await this.onFilesReady();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.error = String((e as Error).message ?? e);
        this.screen = 'error';
      }
    }
  }

  private async onFilesReady(): Promise<void> {
    await preloadImages([...fontPaths(), ...SCREEN_IMAGES]);
    void preloadSounds();
    const custom = listFiles('assets/data/')
      .filter((p) => p.endsWith('.tmx') && !/\/level\d+\.tmx$/.test(p))
      .map((p) => ({ label: p.split('/').pop()!.replace('.tmx', ''), path: p, num: 0 }));
    this.levels = [
      ...Array.from({ length: LEVEL_COUNT }, (_, i) => ({ label: `Nivel ${i + 1} - ${LEVEL_TITLES[i] ?? ''}`, path: `assets/data/level${i + 1}.tmx`, num: i + 1 })),
      ...custom,
    ];
    this.screen = 'splash';
    this.t = 0;
    this.splashStep = 0;
  }

  async loadLevel(entry: LevelEntry): Promise<void> {
    this.screen = 'loading';
    this.loadingIsBoot = false;
    this.t = 0;
    try {
      const level = parseTmx(await loadText(entry.path));
      await preloadImages(Scenario.imagePaths(level));
      stopMusic();
      this.levelNum = entry.num || this.levelNum;
      this.hud = new Hud();
      this.introLabel = entry.label;
      this.scenario = new Scenario(level, entry.num, this.state, {
        gameOver: () => {
          this.state.reset();
          this.scenario = null;
          this.screen = 'gameover';
          this.t = 0;
          playMusic('lose');
        },
        levelComplete: () => {
          const n = entry.num;
          if (n) {
            this.state.progress[n] = {
              cows: this.state.cows, totalCows: this.state.totalCows, coins: this.state.coins,
              totalCoins: this.state.totalCoinsInLevel, score: this.state.score, done: true,
            };
            this.state.save();
          }
          this.scenario = null;
          this.t = 0;
          if (n && n >= LEVEL_COUNT) {
            // last level only: "game complete" screen
            playMusic('xa_win');
            this.screen = 'win';
          } else {
            // otherwise: back to level select, cursor on the newly unlocked next level
            playMusic('xa_menu');
            this.screen = 'levels';
            if (n) this.levelIndex = n; // index n = level n+1 (next)
          }
        },
        message: (t, seconds) => this.hud.showMessage(t, seconds),
        saving: () => this.hud.showSaving(),
      });
      this.screen = 'levelIntro';
      this.t = 0;
    } catch (e) {
      this.error = String((e as Error).message ?? e);
      this.screen = 'error';
    }
  }

  private resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  };
  private onMouseMove = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mouseX = (e.clientX - r.left) * (this.canvas.width / r.width);
    this.mouseY = (e.clientY - r.top) * (this.canvas.height / r.height);
  };
  private onPointerDown = () => { this.clicked = true; this.mouseDown = true; };
  private onPointerUp = () => { this.mouseDown = false; };

  toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.canvas.parentElement?.requestFullscreen?.();
  }

  private frame = (now: number) => {
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Dev/test helper: advance `frames` fixed steps synchronously (works while the tab is hidden). */
  step(frames = 1, held: string[] = []): void {
    for (let i = 0; i < frames; i++) {
      for (const k of held) window.dispatchEvent(new KeyboardEvent('keydown', { code: k }));
      this.update(STEP);
    }
    for (const k of held) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
    this.render();
  }

  private update(dt: number): void {
    pollInput();
    if (keyPressed('F11') || keyPressed('KeyF')) this.toggleFullscreen();
    this.t += dt;
    this.hoverIndex = -1;
    switch (this.screen) {
      case 'splash': {
        const dur = 1.8; // fade in + hold + fade out per logo
        if (this.t >= dur || this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold')) {
          this.splashStep++;
          this.t = 0;
          if (this.splashStep >= 2) { this.screen = 'loading'; this.loadingIsBoot = true; this.t = 0; }
          else playSound('CLICK');
        }
        break;
      }
      case 'loading':
        if (this.loadingIsBoot && (this.t >= 0.9 || this.clicked || isFirstPress('confirm'))) { this.screen = 'intro'; this.introPage = 0; this.t = 0; playMusic('xa_intro'); }
        break;
      case 'intro':
        if (this.t > 0.4 && (this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold') || isFirstPress('fire'))) {
          this.introPage++;
          this.t = 0;
          if (this.introPage >= INTRO_PAGES.length) { this.screen = 'menu'; this.menuIndex = -1; this.t = 0; playMusic('xa_menu'); }
          else playSound('CLICK');
        }
        break;
      case 'menu': {
        const n = MENU_ITEMS.length;
        if (isFirstPress('up')) { if (this.menuIndex < 0) this.menuIndex = 0; else this.menuIndex = (this.menuIndex + n - 1) % n; playSound('CLICK'); }
        if (isFirstPress('down')) { if (this.menuIndex < 0) this.menuIndex = 0; else this.menuIndex = (this.menuIndex + 1) % n; playSound('CLICK'); }
        this.hoverIndex = this.menuHoverIndex();
        if (this.clicked && this.hoverIndex >= 0) {
          this.menuIndex = this.hoverIndex;
          this.activateMenu(MENU_ITEMS[this.hoverIndex].action);
        } else if (isFirstPress('confirm') || isFirstPress('jumpHold')) {
          if (this.menuIndex < 0) this.menuIndex = 0;
          else this.activateMenu(MENU_ITEMS[this.menuIndex].action);
        }
        break;
      }
      case 'levels': {
        const n = this.levels.length;
        if (isFirstPress('up')) { this.levelIndex = (this.levelIndex + n - 4) % n; playSound('CLICK'); }
        if (isFirstPress('down')) { this.levelIndex = (this.levelIndex + 4) % n; playSound('CLICK'); }
        if (isFirstPress('left')) { this.levelIndex = (this.levelIndex + n - 1) % n; playSound('CLICK'); }
        if (isFirstPress('right')) { this.levelIndex = (this.levelIndex + 1) % n; playSound('CLICK'); }
        if (isFirstPress('back')) { this.screen = 'menu'; this.menuIndex = -1; }
        this.hoverIndex = this.levelHoverIndex();
        if (this.clicked && this.hoverIndex >= 0 && this.isUnlocked(this.hoverIndex)) {
          this.levelIndex = this.hoverIndex;
          void this.loadLevel(this.levels[this.hoverIndex]);
        } else if (isFirstPress('confirm') || isFirstPress('jumpHold')) {
          playSound('CLICK');
          if (this.isUnlocked(this.levelIndex)) void this.loadLevel(this.levels[this.levelIndex]);
        }
        break;
      }
      case 'options': {
        // keyboard: up/down pick the item, left/right adjust, confirm toggles on/off
        if (isFirstPress('up') || isFirstPress('down')) { this.optionIndex = 1 - this.optionIndex; playSound('CLICK'); }
        if (isFirstPress('left') || isFirstPress('right')) {
          const d = isFirstPress('left') ? -1 : 1;
          if (this.optionIndex === 0) setSoundVolume(Math.min(1, Math.max(0, getSoundVolume() + d * 0.1)));
          else setMusicVolume(Math.min(1, Math.max(0, getMusicVolume() + d * 0.1)));
        }
        if (isFirstPress('confirm')) {
          if (this.optionIndex === 0) setSoundEnabled(!isSoundEnabled());
          else setMusicEnabled(!isMusicEnabled());
          playSound('CLICK');
        }
        // mouse: click the toggles, click/drag the sliders
        const m = this.mouseGamePos();
        const hit = (cx: number, cy: number, w: number, h: number) => m.x >= cx - w / 2 && m.x <= cx + w / 2 && m.y >= cy - h / 2 && m.y <= cy + h / 2;
        if (this.clicked && !this.draggingSlider) {
          if (hit(290, 180, 27, 26)) { setMusicEnabled(!isMusicEnabled()); playSound('CLICK'); }
          else if (hit(290, 231, 27, 26)) { setSoundEnabled(!isSoundEnabled()); playSound('CLICK'); }
          else if (m.x >= 152 && m.x <= 318 && Math.abs(m.y - 205) <= 15) this.draggingSlider = 'sound';
          else if (m.x >= 152 && m.x <= 318 && Math.abs(m.y - 256) <= 15) this.draggingSlider = 'music';
        }
        if (this.draggingSlider) {
          if (!this.mouseDown) this.draggingSlider = null;
          else {
            const v = Math.min(1, Math.max(0, (m.x - 152) / 166));
            if (this.draggingSlider === 'sound') setSoundVolume(v); else setMusicVolume(v);
          }
        }
        if (isFirstPress('back')) { this.screen = 'menu'; this.menuIndex = -1; this.draggingSlider = null; }
        break;
      }
      case 'help': case 'credits':
        if (isFirstPress('back') || isFirstPress('confirm')) { this.screen = 'menu'; this.menuIndex = -1; }
        break;
      case 'gameover': case 'win':
        if (this.t > 0.6 && (this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold'))) {
          this.screen = 'levels';
          this.t = 0;
        }
        break;
      case 'levelIntro':
        if (this.t > 0.3 && (this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold'))) {
          this.screen = 'play';
        }
        break;
      case 'play':
        if (isFirstPress('back') || keyPressed('KeyP')) {
          this.screen = 'paused';
          stopMusic();
          break;
        }
        this.scenario?.update(dt);
        this.hud.update(dt);
        break;
      case 'paused':
        if (isFirstPress('back') || keyPressed('KeyP') || isFirstPress('confirm')) {
          this.screen = 'play';
          this.scenario?.resumeMusic();
        }
        if (keyPressed('KeyQ')) {
          this.scenario = null;
          this.screen = 'levels';
        }
        break;
      case 'error':
        if (isFirstPress('back') && hasGameFiles()) this.screen = 'menu';
        break;
      default:
        break;
    }
    this.clicked = false;
  }

  private activateMenu(action: string): void {
    playSound('CLICK');
    switch (action) {
      case 'levels': this.screen = 'levels'; this.levelIndex = 0; this.t = 0; playMusic('xa_menu'); break;
      case 'help': this.screen = 'help'; this.t = 0; break;
      case 'options': this.screen = 'options'; this.t = 0; break;
      case 'credits': this.screen = 'credits'; this.t = 0; break;
      case 'splash': window.location.reload(); break;
    }
  }

  /** Highest level number the player may play (1 + last completed). */
  private unlockedCount(): number {
    let u = 1;
    for (let i = 1; i <= LEVEL_COUNT; i++) if (this.state.progress[i]?.done) u = i + 1;
    return Math.min(LEVEL_COUNT, u);
  }
  private isUnlocked(idx: number): boolean {
    const e = this.levels[idx];
    if (!e) return false;
    if (e.num === 0) return true; // custom/mod levels are always playable
    return e.num <= this.unlockedCount();
  }

  /** Convert the mouse's canvas position into 512x384 game space. */
  private mouseGamePos(): { x: number; y: number } {
    const cw = this.canvas.width, ch = this.canvas.height;
    const s = Math.min(cw / VIEW_W, ch / VIEW_H);
    const ox = (cw - VIEW_W * s) / 2, oy = (ch - VIEW_H * s) / 2;
    return { x: (this.mouseX - ox) / s, y: (this.mouseY - oy) / s };
  }
  private menuHoverIndex(): number {
    const m = this.mouseGamePos();
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      const it = MENU_ITEMS[i];
      const [sx, sy, sw, sh] = it.n;
      if (m.x >= it.x - sw / 2 && m.x <= it.x + sw / 2 && m.y >= it.y - sh / 2 && m.y <= it.y + sh / 2) return i;
    }
    return -1;
  }
  private levelHoverIndex(): number {
    const m = this.mouseGamePos();
    let best = -1, bestD = 18 * 18;
    for (let i = 0; i < NODE_POS.length; i++) {
      const [px, py] = NODE_POS[i];
      const d = (m.x - px) ** 2 + (m.y - py) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ---------- rendering ----------
  private render(): void {
    const w = this.wctx;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.imageSmoothingEnabled = false;
    w.fillStyle = '#05070a';
    w.fillRect(0, 0, VIEW_W, VIEW_H);

    if ((this.screen === 'play' || this.screen === 'paused') && this.scenario) {
      this.scenario.render(w);
      w.imageSmoothingEnabled = true;
      this.hud.render(w, this.state);
      if (this.screen === 'paused') this.renderPause(w);
    } else {
      this.renderScreens(w);
    }

    // scale the 512x384 frame to the canvas, letterboxed to 4:3
    const c = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    const s = Math.min(cw / VIEW_W, ch / VIEW_H);
    const dw = Math.round(VIEW_W * s), dh = Math.round(VIEW_H * s);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, cw, ch);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.world, Math.floor((cw - dw) / 2), Math.floor((ch - dh) / 2), dw, dh);

    // custom cursor (original POINTER sprite)
    const cur = frameOf('POINTER', 0);
    if (cur) {
      const cs = Math.max(16, Math.round(32 * s));
      c.drawImage(cur.image, cur.sx, cur.sy, cur.sw, cur.sh, Math.round(this.mouseX), Math.round(this.mouseY), cs, cs);
    }
  }

  // ---------- screens (original art) ----------
  private cover(w: CanvasRenderingContext2D, path: string): void {
    const im = img(path);
    if (!im) { w.fillStyle = '#000'; w.fillRect(0, 0, VIEW_W, VIEW_H); return; }
    // All 512x512 screen art shows the visible band in the TOP 384px; crop the extra bottom rows.
    const h = Math.min(im.height, VIEW_H);
    w.drawImage(im, 0, 0, im.width, h, 0, 0, VIEW_W, VIEW_H);
  }
  /** Draws the top 512x384 of a 512x512 sheet (menu_night.jpg / map.png art lives in the top band). */
  private coverTop(w: CanvasRenderingContext2D, path: string): void {
    const im = img(path);
    if (!im) { w.fillStyle = '#000'; w.fillRect(0, 0, VIEW_W, VIEW_H); return; }
    const h = Math.min(im.height, VIEW_H);
    w.drawImage(im, 0, 0, im.width, h, 0, 0, VIEW_W, VIEW_H);
  }

  private renderScreens(w: CanvasRenderingContext2D): void {
    switch (this.screen) {
      case 'pick': this.renderPick(w); break;
      case 'error': this.renderError(w); break;
      case 'splash': this.renderSplash(w); break;
      case 'loading': this.renderLoading(w); break;
      case 'intro': this.renderIntro(w); break;
      case 'menu': this.renderMenu(w); break;
      case 'levels': this.renderLevels(w); break;
      case 'help': this.renderFull(w, 'assets/lang/images/help/ayuda.jpg'); break;
      case 'credits': this.renderFull(w, 'assets/lang/images/credits/creditos.jpg'); break;
      case 'options': this.renderOptions(w); break;
      case 'levelIntro': this.renderLevelIntro(w); break;
      case 'gameover': this.renderFull(w, 'assets/lang/images/intros/game_over.jpg'); break;
      case 'win': this.renderFull(w, 'assets/lang/images/intros/screen_win.jpg'); break;
      default: break;
    }
  }

  private renderPick(w: CanvasRenderingContext2D): void {
    this.text(w, 'Haz clic o pulsa una tecla para elegir', VIEW_W / 2, 170, 13);
    this.text(w, 'la carpeta de tu juego instalado', VIEW_W / 2, 190, 13);
    this.text(w, '(por ejemplo F:\\Games\\Xa)', VIEW_W / 2, 214, 11, '#9fb39a');
    this.text(w, 'Los archivos se leen en tu navegador; no se suben a ningún sitio.', VIEW_W / 2, 330, 9, '#7d8c7a');
  }

  private renderError(w: CanvasRenderingContext2D): void {
    this.text(w, this.error, VIEW_W / 2, 180, 11, '#ff8a7a');
    this.text(w, 'Haz clic para elegir otra carpeta', VIEW_W / 2, 210, 12);
  }

  private renderSplash(w: CanvasRenderingContext2D): void {
    const logo = this.splashStep === 0 ? 'assets/images/menuElements/screen_logo_batovi.jpg' : 'assets/images/menuElements/screen_logo_calcar.jpg';
    const a = Math.min(1, Math.min(this.t * 2, Math.max(0, (1.8 - this.t) * 2)));
    w.fillStyle = '#000';
    w.fillRect(0, 0, VIEW_W, VIEW_H);
    const im = img(logo);
    if (im) {
      w.globalAlpha = a;
      w.drawImage(im, 0, 0, im.width, Math.min(im.height, VIEW_H), 0, 0, VIEW_W, VIEW_H);
      w.globalAlpha = 1;
    }
    if (this.t > 0.4) this.drawPressAnyKey(w);
  }

  private renderLoading(w: CanvasRenderingContext2D): void {
    w.fillStyle = '#3a1010';
    w.fillRect(0, 0, VIEW_W, VIEW_H);
    const im = img('assets/images/menuElements/cargando_tile.png');
    if (im) {
      w.drawImage(im, 0, 0, 512, 384, 0, 0, VIEW_W, VIEW_H);
      const f = Math.floor(this.t * 3) % 3;
      w.drawImage(im, 1, 388 + f * 40, 259, 32, VIEW_W / 2 - 259, VIEW_H - 60, 518, 64);
    }
    if (this.t > 0.4) this.drawPressAnyKey(w);
  }

  private renderIntro(w: CanvasRenderingContext2D): void {
    this.cover(w, INTRO_PAGES[this.introPage] ?? INTRO_PAGES[0]);
    if (this.t > 0.3) this.drawPressAnyKey(w);
  }

  private renderMenu(w: CanvasRenderingContext2D): void {
    this.coverTop(w, 'assets/images/menuElements/menu_night.jpg');
    const bt = img('assets/images/menuElements/buttons_tile.png');
    if (!bt) return;
    MENU_ITEMS.forEach((it, i) => {
      const active = i === this.menuIndex || i === this.hoverIndex;
      const [sx, sy, sw, sh] = active ? it.h : it.n;
      w.drawImage(bt, sx, sy, sw, sh, it.x - sw / 2, it.y - sh / 2, sw, sh);
    });
  }

  private renderLevels(w: CanvasRenderingContext2D): void {
    this.coverTop(w, 'assets/images/menuElements/map.png');
    for (let i = 0; i < NODE_POS.length; i++) {
      const [px, py] = NODE_POS[i];
      const entry = this.levels[i];
      const num = entry?.num ?? 0;
      const locked = num !== 0 && num > this.unlockedCount();
      const prog = num ? this.state.progress[num] : undefined;
      const perfect = !!prog?.done && prog.cows === prog.totalCows && prog.coins === prog.totalCoins;
      const current = i === this.levelIndex || i === this.hoverIndex;
      // original node buttons (BUTTONS_LEVELS / BUTTONS_PERFECT_LEVELS sprites from map.png)
      const name = perfect && !locked ? 'BUTTONS_PERFECT_LEVELS' : 'BUTTONS_LEVELS';
      const frame = locked ? 0 : current ? (perfect ? 2 : 3) : (perfect ? 0 : 1);
      const f = frameOf(name, frame);
      if (f) w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, Math.round(px - f.sw / 2), Math.round(py - f.sh / 2), f.sw, f.sh);
      if (current) {
        const ring = frameOf('MAP_ANIMATED_SELECTION', Math.floor(this.t * 3) % 3);
        if (ring) w.drawImage(ring.image, ring.sx, ring.sy, ring.sw, ring.sh, Math.round(px - ring.sw / 2), Math.round(py - ring.sh / 2), ring.sw, ring.sh);
      }
    }
    // bottom bar
    w.fillStyle = 'rgba(0,0,0,.6)';
    w.fillRect(0, VIEW_H - 40, VIEW_W, 40);
    const entry = this.levels[this.levelIndex];
    drawText(w, entry ? entry.label : '', VIEW_W / 2, VIEW_H - 30, 'white', 'center', 0.8);
    drawText(w, 'flechas: elegir · Enter: jugar · Esc: volver', VIEW_W / 2, VIEW_H - 14, 'white', 'center', 0.45);
  }

  private renderFull(w: CanvasRenderingContext2D, path: string): void {
    this.cover(w, path);
    if (this.t > 0.3) this.drawPressAnyKey(w);
  }

  /** Animated "press any key" indicator (2-frame PRESS_ANY_KEY anim, bottom-right). */
  private drawPressAnyKey(w: CanvasRenderingContext2D): void {
    const idx = Math.floor(this.t * 2) % 2 === 0 ? 1 : 0;
    const f = frameOf('PRESS_ANY_KEY', idx);
    if (f) w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, VIEW_W - f.sw - 14, VIEW_H - f.sh - 10, f.sw, f.sh);
  }

  private renderLevelIntro(w: CanvasRenderingContext2D): void {
    const im = img('assets/lang/images/intros/fondo_niveles.png');
    if (im) w.drawImage(im, 0, 0, im.width, Math.min(im.height, VIEW_H), 0, 0, VIEW_W, VIEW_H);
    else { w.fillStyle = '#07131f'; w.fillRect(0, 0, VIEW_W, VIEW_H); }
    w.fillStyle = 'rgba(0,0,0,.62)';
    w.fillRect(0, VIEW_H / 2 - 46, VIEW_W, 92);
    this.text(w, this.introLabel || 'Nivel', VIEW_W / 2, VIEW_H / 2 - 13, 20, '#ffffff');
    this.text(w, 'Pulsa Enter para empezar', VIEW_W / 2, VIEW_H / 2 + 16, 12, '#e8f0e0');
  }

  private renderOptions(w: CanvasRenderingContext2D): void {
    // Background (frame 0) + draggable volume knobs + ON/OFF toggles, matching OptionsState.
    const draw = (index: number, x: number, y: number) => {
      const f = frameOf('OPTIONS', index);
      if (f) w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, x - f.sw / 2, y - f.sh / 2, f.sw, f.sh);
    };
    draw(0, VIEW_W / 2, VIEW_H / 2); // background
    draw(isMusicEnabled() ? 1 : 4, getMusicVolume() * 166 + 152, 256); // music knob
    draw(isSoundEnabled() ? 1 : 4, getSoundVolume() * 166 + 152, 205); // sound knob
    draw(isMusicEnabled() ? 2 : 3, 290, 180); // music toggle
    draw(isSoundEnabled() ? 2 : 3, 290, 231); // sound toggle
  }

  private renderPause(w: CanvasRenderingContext2D): void {
    w.fillStyle = 'rgba(0,0,0,.55)';
    w.fillRect(0, 0, VIEW_W, VIEW_H);
    const f = frameOf('PAUSE_DIALOG', 0);
    if (f) drawFrame(w, f, VIEW_W / 2, VIEW_H / 2);
    this.text(w, 'Esc / P: continuar', VIEW_W / 2, 210, 12);
    this.text(w, 'Q: salir a selección de nivel', VIEW_W / 2, 232, 12);
  }

  private text(w: CanvasRenderingContext2D, t: string, x: number, y: number, size = 14, _color = '#e8f0e0', align: CanvasTextAlign = 'center'): void {
    // Use the game's bitmap font (fuente_blanca) instead of a system font, matching the original typography.
    const scale = size / 18;
    drawText(w, t, x, y - 9 * scale, 'white', align === 'center' ? 'center' : align === 'right' ? 'right' : 'left', scale);
  }
}
