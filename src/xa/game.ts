// Main loop + screen flow (original Xa screens: logo, loading, comic, menu, level select, help, credits,
// options, game over, victory). The world is drawn into a 512x384 offscreen canvas (integer pixels) and then
// scaled to fit any window, keeping the 4:3 aspect ratio. All art comes from the user's own game files.
import { hasGameFiles, img, listFiles, loadText, pickGameFolder, preloadImages, restoreGameFolder, useBundledAssets, useDevGameFiles } from './core/assets';
import { attachInput, isFirstPress, keyPressed, pollInput } from './core/input';
import { getMusicVolume, getSoundVolume, isMusicEnabled, isSoundEnabled, loadPrefs, playMusic, playSound, preloadSounds, setMusicEnabled, setMusicVolume, setSoundEnabled, setSoundVolume, stopMusic, unlockAudio } from './core/audio';
import { drawText, fontPaths } from './core/font';
import { drawFrame, frameOf } from './core/sprites';
import levelData from './data/levels.json';
import { VIEW_H, VIEW_W } from './world/camera';
import { Hud } from './world/hud';
import { HeroState } from './world/state';
import { parseTmx } from './world/tmx';
import { Scenario } from './world/world';

export const LEVEL_COUNT = 16;
// Built-in texts of xa.exe (Lang::mTitles / mDescriptions / level ids), extracted by tools/extract_texts.py.
const LANG = levelData as unknown as { titles: string[]; descriptions: string[]; ids: string[]; ui: Record<string, string> };
const LEVEL_TITLES = LANG.titles;
const STEP = 1 / 60;
const SPLASH_TIME = 3.5; // SplashScreen: sendMessage("fadeToBlack", delay 3.5 s)
const SPLASH_FADE = 0.5;
// Checkbox centres of the Windows-only options rows in options_win.png ("Pantalla completa", "Estirar pantalla").
const OPT_FULLSCREEN = [292, 260] as const;
const OPT_STRETCH = [292, 285] as const;
// Rows of options_win.png measured on the art (the label lines and the slider bars under them).
const OPT_ROW_MUSIC = 173, OPT_ROW_SFX = 215, OPT_BAR_MUSIC = 197, OPT_BAR_SFX = 240;
// Font placement: bat::TextSprite positions refer to the glyph band, which sits TEXT_TOP px below the 30 px
// cell top; vertically-centred text puts the middle of an 18 px line on the anchor.
const LINE_H = 18;
const TEXT_TOP = 2;
const TEXT_VC = TEXT_TOP + LINE_H / 2;

export type Screen = 'pick' | 'splash' | 'loading' | 'intro' | 'menu' | 'levels' | 'help' | 'credits' | 'options' | 'levelIntro' | 'play' | 'paused' | 'gameover' | 'win' | 'error';

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
  'assets/lang/images/intros/fondo_niveles.png',
  'assets/lang/images/intros/preview_levels_tile.jpg',
  'assets/lang/images/help/ayuda.jpg',
  'assets/lang/images/credits/creditos.jpg',
  'assets/lang/images/menu/press_any_key.png',
  'assets/images/menuElements/cursor.png',
  'assets/images/menuElements/info_map.png',
  'assets/lang/images/menu/banner.png',
  'assets/images/menuElements/exit_confirmation.png',
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
  private introNum = 0;          // level shown on the intro screen (0 = custom map)
  private levelReady = false;    // Intro: level finished loading -> "press any key" replaces "CARGANDO..."
  private readyT = 0;            // seconds since the level finished loading
  private bootReadyAt = 1.2;     // boot preloader: CARGANDO anim shows at least this long...
  private soundsReady = false;   // ...and until every sound is decoded
  private infoT = 0;             // level-select info bar slide-in timer (ButtonInformation, easeInOutQuad 0.3 s)
  private infoIndex = -1;
  private stretch = false;
  private resizeObs: ResizeObserver | null = null;       // "Estirar pantalla"
  private pauseIndex = 0;        // PauseDialog: 0 = JUGAR, 1 = SALIR
  private confirming = false;    // ConfirmationDialog "¿Seguro que quieres volver al menú principal?"
  private confirmIndex = 1;      // 0 = SÍ, 1 = NO
  private cowCache: Record<number, number> = {};
  levelNum = 1;
  /** Current screen (the React shell shows the touch controls only while playing). */
  get currentScreen(): Screen { return this.screen; }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.world.width = VIEW_W;
    this.world.height = VIEW_H;
    this.wctx = this.world.getContext('2d')!;
    this.canvas.style.cursor = 'none';
    loadPrefs();
    this.state.load();
    try { this.stretch = localStorage.getItem('xa-stretch') === '1'; } catch { /* storage unavailable */ }
  }

  async start(): Promise<void> {
    this.detach = attachInput();
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onMouseMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('fullscreenchange', this.resize);
    this.resizeObs = new ResizeObserver(this.resize);
    this.resizeObs.observe(this.canvas);
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
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('fullscreenchange', this.resize);
    this.resizeObs?.disconnect();
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
    this.soundsReady = false;
    void preloadSounds().finally(() => { this.soundsReady = true; }); // PreLoader: CARGANDO until decoded
    const custom = listFiles('assets/data/')
      .filter((p) => p.endsWith('.tmx') && !/\/level\d+\.tmx$/.test(p))
      .map((p) => ({ label: p.split('/').pop()!.replace('.tmx', ''), path: p, num: 0 }));
    this.levels = [
      ...Array.from({ length: LEVEL_COUNT }, (_, i) => ({ label: `Nivel ${i + 1} - ${LEVEL_TITLES[i] ?? ''}`, path: `assets/data/level${i + 1}.tmx`, num: i + 1 })),
      ...custom,
    ];
    // Modding / testing shortcuts: ?level=N jumps straight into level N, ?map=assets/data/x.tmx into any TMX.
    const q = new URLSearchParams(location.search);
    const lv = +(q.get('level') ?? 0), map = q.get('map');
    if (map || (lv >= 1 && lv <= LEVEL_COUNT)) {
      const entry = map
        ? this.levels.find((l) => l.path === map.toLowerCase()) ?? { label: map.split('/').pop()!.replace('.tmx', ''), path: map, num: 0 }
        : this.levels[lv - 1];
      this.levelIndex = Math.max(0, this.levels.indexOf(entry));
      playMusic('xa_menu');
      void this.loadLevel(entry);
      return;
    }
    this.screen = 'splash';
    this.t = 0;
    this.splashStep = 0;
    this.bootReadyAt = 1.2;
    playMusic('intro_piano', false); // SplashScreen: intro_piano.ogg once (not looped) over the two logos
  }

  async loadLevel(entry: LevelEntry): Promise<void> {
    // Intro(levelId): the level card is shown right away with the "CARGANDO..." ribbon while the level loads
    // behind it; once loaded the blinking "press any key" ribbon replaces it (Intro::render / Intro::update).
    this.screen = 'levelIntro';
    this.scenario = null;
    this.levelReady = false;
    this.readyT = 0;
    this.introNum = entry.num;
    this.introLabel = entry.num ? (LEVEL_TITLES[entry.num - 1] ?? entry.label) : entry.label;
    this.t = 0;
    const t0 = performance.now();
    try {
      const level = parseTmx(await loadText(entry.path));
      await preloadImages(Scenario.imagePaths(level));
      stopMusic();
      // keep the "CARGANDO..." ribbon visible for a minimum time (otherwise it flashes for microseconds)
      const elapsed = performance.now() - t0;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
      this.levelNum = entry.num || this.levelNum;
      this.hud = new Hud();
      this.state.beginLevel(); // power-ups/keys/coins never carry over between levels (HeroState::goToLevelSelect)
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
      this.levelReady = true;
      this.readyT = 0;
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
  private onPointerDown = (e: PointerEvent) => {
    this.onMouseMove(e);
    this.clicked = true;
    this.mouseDown = true;
    // the fullscreen request must run inside the click handler itself (user activation)
    if (this.screen === 'options') {
      const m = this.mouseGamePos();
      if (Math.abs(m.x - OPT_FULLSCREEN[0]) <= 16 && Math.abs(m.y - OPT_FULLSCREEN[1]) <= 13) this.toggleFullscreen();
    }
  };
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyF' && !e.repeat) this.toggleFullscreen();
    if (this.screen === 'options' && this.optionIndex === 2 && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) this.toggleFullscreen();
  };
  private setStretch(on: boolean): void {
    this.stretch = on;
    try { localStorage.setItem('xa-stretch', on ? '1' : '0'); } catch { /* storage unavailable */ }
  }
  private onPointerUp = () => { this.mouseDown = false; };

  toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void this.canvas.parentElement?.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    } catch { /* not supported (iOS Safari) */ }
    playSound('CLICK');
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
    this.t += dt;
    this.hoverIndex = -1;
    switch (this.screen) {
      case 'splash': {
        // SplashScreen: each logo is its own state that plays intro_piano once and sends itself "fadeToBlack"
        // after 3.5 s (or on any key/click); leaving the state cuts its sound. Logo 2 → PreLoader with xa_intro.
        if (this.t >= SPLASH_TIME || this.clicked || isFirstPress('any')) {
          this.splashStep++;
          this.t = 0;
          if (this.splashStep >= 2) {
            this.screen = 'loading'; this.loadingIsBoot = true;
            playMusic('xa_intro');
          } else {
            playMusic('intro_piano', false); // restarts the "dong" for the second logo
          }
        }
        break;
      }
      case 'loading':
        if (this.loadingIsBoot && this.t >= this.bootReadyAt && this.soundsReady && (this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold') || isFirstPress('fire'))) { this.screen = 'intro'; this.introPage = 0; this.t = 0; }
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
        const shown = this.hoverIndex >= 0 ? this.hoverIndex : this.levelIndex;
        if (shown !== this.infoIndex) { this.infoIndex = shown; this.infoT = 0; }
        this.infoT += dt;
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
        // OptionsState: rows = music, effects, "Pantalla completa", "Estirar pantalla", ATRÁS.
        // up/down pick the row, left/right move the volume, Enter toggles; Esc / ATRÁS go back.
        const rows = 5;
        if (isFirstPress('up')) { this.optionIndex = (this.optionIndex + rows - 1) % rows; playSound('CLICK'); }
        if (isFirstPress('down')) { this.optionIndex = (this.optionIndex + 1) % rows; playSound('CLICK'); }
        if (isFirstPress('left') || isFirstPress('right')) {
          const d = isFirstPress('left') ? -1 : 1;
          if (this.optionIndex === 0) setMusicVolume(Math.min(1, Math.max(0, getMusicVolume() + d * 0.1)));
          else if (this.optionIndex === 1) setSoundVolume(Math.min(1, Math.max(0, getSoundVolume() + d * 0.1)));
        }
        const back = () => { this.screen = 'menu'; this.menuIndex = -1; this.draggingSlider = null; playSound('CLICK'); };
        if (isFirstPress('confirm')) {
          if (this.optionIndex === 0) { setMusicEnabled(!isMusicEnabled()); playSound('CLICK'); }
          else if (this.optionIndex === 1) { setSoundEnabled(!isSoundEnabled()); playSound('CLICK'); }
          else if (this.optionIndex === 3) { this.setStretch(!this.stretch); playSound('CLICK'); }
          else if (this.optionIndex === 4) { back(); break; }
          // index 2 (fullscreen) is handled in the keydown event (needs user activation)
        }
        // mouse: click the toggles / checkboxes / ATRÁS, click or drag the sliders
        const m = this.mouseGamePos();
        const hit = (cx: number, cy: number, w: number, h: number) => m.x >= cx - w / 2 && m.x <= cx + w / 2 && m.y >= cy - h / 2 && m.y <= cy + h / 2;
        this.hoverIndex = hit(256, 320, 106, 50) ? 4 : -1;
        if (this.clicked && !this.draggingSlider) {
          if (hit(290, OPT_ROW_MUSIC, 27, 26)) { setMusicEnabled(!isMusicEnabled()); playSound('CLICK'); }
          else if (hit(290, OPT_ROW_SFX, 27, 26)) { setSoundEnabled(!isSoundEnabled()); playSound('CLICK'); }
          else if (hit(OPT_STRETCH[0], OPT_STRETCH[1], 32, 26)) { this.setStretch(!this.stretch); playSound('CLICK'); }
          else if (hit(OPT_FULLSCREEN[0], OPT_FULLSCREEN[1], 32, 26)) { /* toggled in the pointerdown handler */ }
          else if (this.hoverIndex === 4) { back(); break; }
          else if (m.x >= 152 && m.x <= 318 && Math.abs(m.y - OPT_BAR_MUSIC) <= 15) this.draggingSlider = 'music';
          else if (m.x >= 152 && m.x <= 318 && Math.abs(m.y - OPT_BAR_SFX) <= 15) this.draggingSlider = 'sound';
        }
        if (this.draggingSlider) {
          if (!this.mouseDown) this.draggingSlider = null;
          else {
            const v = Math.min(1, Math.max(0, (m.x - 152) / 166));
            if (this.draggingSlider === 'sound') setSoundVolume(v); else setMusicVolume(v);
          }
        }
        if (isFirstPress('back')) back();
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
        // Intro::update: any key/click once the level is loaded (after a 0.05 s guard)
        if (this.levelReady) {
          this.readyT += dt;
          if (this.readyT > 0.05 && this.scenario && (this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold') || isFirstPress('fire'))) {
            this.screen = 'play';
          }
        }
        break;
      case 'play':
        if (isFirstPress('back') || keyPressed('KeyP')) {
          this.screen = 'paused';
          this.pauseIndex = 0;
          this.confirming = false;
          playSound('CLICK');
          stopMusic();
          break;
        }
        this.scenario?.update(dt);
        this.hud.update(dt);
        break;
      case 'paused':
        this.updatePause();
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
  /** Where the 512x384 frame lands on the canvas: letterboxed 4:3, or filling the window when the original
   *  "Estirar pantalla" option (Options::setAspectRatioEnabled) is on. */
  private viewport(): { x: number; y: number; w: number; h: number } {
    const cw = this.canvas.width, ch = this.canvas.height;
    if (this.stretch) return { x: 0, y: 0, w: cw, h: ch };
    const s = Math.min(cw / VIEW_W, ch / VIEW_H);
    const w = Math.round(VIEW_W * s), h = Math.round(VIEW_H * s);
    return { x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2), w, h };
  }
  private mouseGamePos(): { x: number; y: number } {
    const v = this.viewport();
    return { x: ((this.mouseX - v.x) * VIEW_W) / v.w, y: ((this.mouseY - v.y) * VIEW_H) / v.h };
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
      const d = (m.x - px - 20) ** 2 + (m.y - py - 15) ** 2; // node centre (sprite is 40x30)
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
    const v = this.viewport();
    const s = v.h / VIEW_H;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, cw, ch);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.world, v.x, v.y, v.w, v.h);

    // custom cursor (original POINTER sprite) — hidden while playing so it doesn't get in the way
    const cur = this.screen === 'play' ? null : frameOf('POINTER', 0);
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
    const a = Math.min(1, this.t / SPLASH_FADE, Math.max(0, (SPLASH_TIME - this.t) / SPLASH_FADE));
    w.fillStyle = '#000';
    w.fillRect(0, 0, VIEW_W, VIEW_H);
    const im = img(logo);
    if (im) {
      w.globalAlpha = a;
      w.drawImage(im, 0, 0, im.width, Math.min(im.height, VIEW_H), 0, 0, VIEW_W, VIEW_H);
      w.globalAlpha = 1;
    }
  }

  /** PreLoader: cargando_tile background; the 3-frame "CARGANDO" ribbon (anchor 260,0 at 512,288) covers the
   *  baked-in "press any key" ribbon until loading finishes. */
  private renderLoading(w: CanvasRenderingContext2D): void {
    w.fillStyle = '#3a1010';
    w.fillRect(0, 0, VIEW_W, VIEW_H);
    const im = img('assets/images/menuElements/cargando_tile.png');
    if (!im) return;
    w.drawImage(im, 0, 0, 512, 384, 0, 0, VIEW_W, VIEW_H);
    if (!this.loadingIsBoot || this.t < this.bootReadyAt || !this.soundsReady) {
      const f = Math.floor(this.t * 3) % 3; // 20 ticks @ 60 fps per frame
      w.drawImage(im, 0, 384 + f * 40, 260, 40, 512 - 260, 288, 260, 40);
    }
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
      if (i === this.levelIndex) {
        // MAP_ANIMATED_SELECTION: glowing ring under the current node
        const ring = frameOf('MAP_ANIMATED_SELECTION', Math.floor(this.t * 6) % 3);
        if (ring) w.drawImage(ring.image, ring.sx, ring.sy, ring.sw, ring.sh, px - 10, py + 4, ring.sw, ring.sh);
      }
      // original node buttons (BUTTONS_LEVELS / BUTTONS_PERFECT_LEVELS sprites from map.png)
      const name = perfect && !locked ? 'BUTTONS_PERFECT_LEVELS' : 'BUTTONS_LEVELS';
      const frame = locked ? 0 : current ? (perfect ? 2 : 3) : (perfect ? 0 : 1);
      const f = frameOf(name, frame);
      if (!f) continue;
      w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, px, py, f.sw, f.sh); // anchor (0,0): NODE_POS is the top-left
      if (i === this.levelIndex) {
        // ARROW (anchor 20,30) at node + (20,10), bobbing up to 6 px
        const a = frameOf('ARROW', 0);
        const bob = Math.round((0.5 + 0.5 * Math.sin(this.t * 6)) * 6);
        if (a) w.drawImage(a.image, a.sx, a.sy, a.sw, a.sh, px + 20 - 20, py + 10 - 30 - bob, a.sw, a.sh);
      }
    }
    this.renderInfoBar(w);
  }

  /** ButtonInformation: info_map.png bar slid up from the bottom (easeInOutQuad, 0.3 s) showing the selected
   *  level's number, cows x / y, coin %, title and 6-digit score, all in the black game font (font 0). */
  private renderInfoBar(w: CanvasRenderingContext2D): void {
    const bar = img('assets/images/menuElements/info_map.png');
    const entry = this.levels[this.infoIndex >= 0 ? this.infoIndex : this.levelIndex];
    if (!bar || !entry) return;
    const k = Math.min(1, this.infoT / 0.3);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const top = VIEW_H - 60 + Math.round((1 - e) * 60);
    w.drawImage(bar, 0, top);
    const num = entry.num;
    const prog = num ? this.state.progress[num] : undefined;
    const totalCows = prog?.totalCows ?? (num ? this.totalCowsOf(num) : 0);
    const pct = prog && prog.totalCoins ? Math.floor((prog.coins * 100) / prog.totalCoins) : 0;
    const score = String(prog?.score ?? 0).padStart(6, '0');
    const c = (t: string, x: number, y: number) => drawText(w, t, x, top + y - TEXT_VC, 'black', 'center');
    c(num ? String(num) : '-', 96, 30);
    c(String(prog?.cows ?? 0), 165, 30);
    c(String(totalCows), 197, 30);
    c(String(pct), 273, 30);
    c(num ? (LEVEL_TITLES[num - 1] ?? entry.label) : entry.label, 257, 11);
    c(score, 448, 30);
  }

  /** Cow count of a level, read once from its TMX, so the bar shows "0 / N" before the level is played. */
  private totalCowsOf(num: number): number {
    if (this.cowCache[num] === undefined) {
      this.cowCache[num] = 0;
      void loadText(`assets/data/level${num}.tmx`).then((t) => { this.cowCache[num] = (t.match(/type="Cow"/g) ?? []).length; }).catch(() => {});
    }
    return this.cowCache[num];
  }

  private renderFull(w: CanvasRenderingContext2D, path: string): void {
    this.cover(w, path);
    if (this.t > 0.3) this.drawPressAnyKey(w);
  }

  /** PRESS_ANY_KEY anim (fondo_niveles.png rows 1/0, 18 ticks each), anchored bottom-right at (512, 384). */
  private drawPressAnyKey(w: CanvasRenderingContext2D, t = this.t): void {
    const idx = Math.floor(t / 0.3) % 2 === 0 ? 1 : 0;
    const f = frameOf('PRESS_ANY_KEY', idx);
    if (f) w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, VIEW_W - f.sw, VIEW_H - f.sh, f.sw, f.sh);
  }

  /** Intro(levelId): the level's preview strip (preview_levels_tile.jpg, 512x115 per level, 8 per column) at
   *  y=128 under the fondo_niveles.png mask; description (font 0, centred on 256,57), "Nivel N" (font 1 at
   *  425,212) and title (font 2, centred at 256,256). "CARGANDO..." shows until the level is ready. */
  private renderLevelIntro(w: CanvasRenderingContext2D): void {
    w.fillStyle = '#000';
    w.fillRect(0, 0, VIEW_W, VIEW_H);
    const n = this.introNum;
    const prev = img('assets/lang/images/intros/preview_levels_tile.jpg');
    if (prev && n >= 1 && n <= LEVEL_COUNT) {
      const sx = n <= 8 ? 0 : 512, sy = ((n - 1) % 8) * 115;
      w.drawImage(prev, sx, sy, 512, 115, 0, 128, 512, 115);
    }
    const mask = img('assets/lang/images/intros/fondo_niveles.png');
    if (mask) w.drawImage(mask, 0, 0, 512, 384, 0, 0, 512, 384);
    const desc = n ? LANG.descriptions[n - 1] ?? '' : '';
    if (desc) {
      const lines = desc.split('\n').length;
      drawText(w, desc, 256, Math.round(57 - (lines * LINE_H) / 2) - TEXT_TOP, 'black', 'center');
    }
    if (n) drawText(w, LANG.ids[n - 1] ?? `Nivel ${n}`, 425, 212 - TEXT_TOP, 'white', 'left');
    drawText(w, this.introLabel, 256, 256 - TEXT_TOP, 'black2', 'center');
    if (!this.levelReady) {
      const f = frameOf('PRESS_ANY_KEY', 3); // "CARGANDO..."
      if (f) w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, VIEW_W - f.sw, VIEW_H - f.sh, f.sw, f.sh);
    } else {
      this.drawPressAnyKey(w, this.readyT);
    }
  }

  private renderOptions(w: CanvasRenderingContext2D): void {
    // OptionsState: background (frame 0), volume knobs on the bars under "Música" and "Efectos", ON/OFF
    // toggles (✓ frame 2 / ✗ frame 3) next to each label, the Windows-only "Pantalla completa" / "Estirar
    // pantalla" checkboxes, and the ATRÁS button (BUTTONS_MENU 12/13 at 256,320).
    const draw = (index: number, x: number, y: number) => {
      const f = frameOf('OPTIONS', index);
      if (f) w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, x - f.sw / 2, y - f.sh / 2, f.sw, f.sh);
    };
    draw(0, VIEW_W / 2, VIEW_H / 2); // background
    draw(isMusicEnabled() ? 1 : 4, getMusicVolume() * 166 + 152, OPT_BAR_MUSIC); // music knob
    draw(isSoundEnabled() ? 1 : 4, getSoundVolume() * 166 + 152, OPT_BAR_SFX); // effects knob
    draw(isMusicEnabled() ? 2 : 3, 290, OPT_ROW_MUSIC); // music toggle
    draw(isSoundEnabled() ? 2 : 3, 290, OPT_ROW_SFX); // effects toggle
    draw(document.fullscreenElement ? 2 : 3, OPT_FULLSCREEN[0], OPT_FULLSCREEN[1]);
    draw(this.stretch ? 2 : 3, OPT_STRETCH[0], OPT_STRETCH[1]);
    const back = frameOf('BUTTONS_MENU', this.optionIndex === 4 || this.hoverIndex === 4 ? 13 : 12);
    if (back) w.drawImage(back.image, back.sx, back.sy, back.sw, back.sh, 256 - back.sw / 2, 320 - back.sh / 2, back.sw, back.sh);
    // keyboard focus marker on the selected row
    const rowY = [OPT_ROW_MUSIC, OPT_ROW_SFX, OPT_FULLSCREEN[1], OPT_STRETCH[1]][this.optionIndex];
    if (rowY !== undefined) {
      w.fillStyle = 'rgba(255,255,140,0.9)';
      w.beginPath();
      w.moveTo(140, rowY - 5); w.lineTo(147, rowY); w.lineTo(140, rowY + 5);
      w.fill();
    }
  }

  /** PauseDialog / ConfirmationDialog hit boxes (512x384 space, BUTTONS_* sprites drawn centred on these). */
  private pauseButtons(): { x: number; y: number; w: number; h: number }[] {
    return this.confirming
      ? [{ x: 256 - 85, y: 292, w: 60, h: 50 }, { x: 256 + 85, y: 292, w: 60, h: 50 }]
      : [{ x: 256, y: 218, w: 106, h: 50 }, { x: 256, y: 268, w: 106, h: 50 }];
  }
  private pauseHover(): number {
    const m = this.mouseGamePos();
    return this.pauseButtons().findIndex((b) => Math.abs(m.x - b.x) <= b.w / 2 && Math.abs(m.y - b.y) <= b.h / 2);
  }

  /** PauseDialog::evaluateKeyboard / onClick: arrows move between the two buttons, Enter/Space/click activate,
   *  Esc/P resumes (or closes the confirmation). JUGAR resumes; SALIR asks for confirmation → main menu. */
  private updatePause(): void {
    const hover = this.pauseHover();
    const move = isFirstPress('up') || isFirstPress('down') || isFirstPress('left') || isFirstPress('right');
    if (this.confirming) {
      if (move) { this.confirmIndex = 1 - this.confirmIndex; playSound('CLICK'); }
      if (hover >= 0) this.confirmIndex = hover;
      const yes = () => {
        playSound('CLICK');
        this.scenario = null;
        this.screen = 'menu';
        this.menuIndex = -1;
        playMusic('xa_menu');
      };
      if (isFirstPress('back')) { this.confirming = false; playSound('CLICK'); return; }
      if ((this.clicked && hover >= 0) || isFirstPress('confirm') || isFirstPress('jumpHold')) {
        if (this.confirmIndex === 0) yes();
        else { this.confirming = false; playSound('CLICK'); }
      }
      return;
    }
    if (move) { this.pauseIndex = 1 - this.pauseIndex; playSound('CLICK'); }
    if (hover >= 0) this.pauseIndex = hover;
    if (isFirstPress('back') || keyPressed('KeyP')) { this.resumeFromPause(); return; }
    if ((this.clicked && hover >= 0) || isFirstPress('confirm') || isFirstPress('jumpHold')) {
      if (this.pauseIndex === 0) this.resumeFromPause();
      else { this.confirming = true; this.confirmIndex = 1; playSound('CLICK'); }
    }
  }
  private resumeFromPause(): void {
    playSound('CLICK');
    this.screen = 'play';
    this.scenario?.resumeMusic();
  }

  /** PAUSE_DIALOG (banner.png: dimmed backdrop + green panel) with the JUGAR / SALIR buttons (BUTTONS_MENU 0/1
   *  and 2/3); SALIR swaps to CONFIRMATION (exit_confirmation.png) with SÍ / NO (BUTTONS_YESNO 0/1, 2/3). */
  private renderPause(w: CanvasRenderingContext2D): void {
    const bg = frameOf(this.confirming ? 'CONFIRMATION' : 'PAUSE_DIALOG', 0);
    if (this.confirming) { w.fillStyle = 'rgba(0,0,0,.55)'; w.fillRect(0, 0, VIEW_W, VIEW_H); } // banner.png has its own dim
    if (bg) w.drawImage(bg.image, bg.sx, bg.sy, bg.sw, bg.sh, 0, 0, VIEW_W, VIEW_H);
    const map = this.confirming ? 'BUTTONS_YESNO' : 'BUTTONS_MENU';
    const sel = this.confirming ? this.confirmIndex : this.pauseIndex;
    this.pauseButtons().forEach((b, i) => {
      const f = frameOf(map, i * 2 + (i === sel ? 1 : 0));
      if (f) w.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, Math.round(b.x - f.sw / 2), Math.round(b.y - f.sh / 2), f.sw, f.sh);
    });
  }

  private text(w: CanvasRenderingContext2D, t: string, x: number, y: number, size = 14, _color = '#e8f0e0', align: CanvasTextAlign = 'center'): void {
    // Use the game's bitmap font (fuente_blanca); fall back to a system font if the sheet isn't loaded yet.
    const scale = size / 18;
    const sheet = img('assets/lang/images/fuente_blanca.png');
    if (sheet) {
      drawText(w, t, x, y - 9 * scale, 'white', align === 'center' ? 'center' : align === 'right' ? 'right' : 'left', scale);
    } else {
      w.font = `bold ${size}px system-ui, sans-serif`;
      w.textAlign = align;
      w.textBaseline = 'middle';
      w.lineWidth = 3;
      w.strokeStyle = 'rgba(0,0,0,0.85)';
      w.strokeText(t, x, y);
      w.fillStyle = '#fff';
      w.fillText(t, x, y);
    }
  }
}
