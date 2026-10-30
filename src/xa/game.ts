// Main loop + screen flow (original Xa screens: logo, loading, comic, menu, level select, help, credits,
// options, game over, victory). The world is drawn into a 512x384 offscreen canvas (integer pixels) and then
// scaled to fit any window, keeping the 4:3 aspect ratio. All art comes from the user's own game files.
import { hasGameFiles, img, listFiles, loadText, pickGameFolder, preloadImages, restoreGameFolder, useBundledAssets, useDevGameFiles } from './core/assets';
import { attachInput, isFirstPress, isPressed, keyPressed, pollInput, resetInput } from './core/input';
import { getMusicVolume, getSoundVolume, isMusicEnabled, isSoundEnabled, loadPrefs, playMusic, playSound, preloadSounds, setMusicEnabled, setMusicVolume, setSoundEnabled, setSoundVolume, stopMusic, unlockAudio } from './core/audio';
import { drawText, fontPaths, lineWidth } from './core/font';
import { drawFrame, drawTinted, frameOf } from './core/sprites';
import { draw9, drawIcon, drawIconTinted, preloadUiArt, uiArt } from './core/nineslice';
import levelData from './data/levels.json';
import type { CoopConfig } from './world/world';
import { VIEW_H, VIEW_W } from './world/camera';
import { Hud } from './world/hud';
import { HeroState, levelCoinPct } from './world/state';
import { parseTmx } from './world/tmx';
import { Scenario } from './world/world';
import { online } from './online/session';
import { levelTitle } from './online/levels';
import type { Difficulty, MenuState } from './online/types';

export const LEVEL_COUNT = 16;
// Built-in texts of xa.exe (Lang::mTitles / mDescriptions / level ids), extracted by tools/extract_texts.py.
const LANG = levelData as unknown as { titles: string[]; descriptions: string[]; ids: string[]; ui: Record<string, string> };
const LEVEL_TITLES = LANG.titles;
const STEP = 1 / 60;
const SPLASH_TIME = 3.5; // SplashScreen: sendMessage("fadeToBlack", delay 3.5 s)
// bat::App state changes go through StateTransition(0.8, 0.8): the old state fades to black in 0.8 s, the new one
// fades in from black in 0.8 s (SplashScreen uses that value as the logo's alpha).
const STATE_FADE = 0.8;
const INTRO_WAIT = 0.6; // Intro wait before a key is accepted on the comic pages
const END_WAIT = 2; // Intro wait (0x314 = 2.0) for the game-over and ending screens
const ARROW_GLIDE = 0.3;  // notifyChangedSelectionSelection: arrow glide, easeInOutSin, 0x3e99999a
const ARROW_BOB = 0.8;    // LevelSelectScreen: arrow yoyo, 0x3f4ccccd
const ARROW_GLIDE_INIT = 0.3;
// Checkbox centres of the Windows-only options rows in options_win.png ("Pantalla completa", "Estirar pantalla").
const OPT_FULLSCREEN = [292, 260] as const;
const OPT_STRETCH = [292, 285] as const;
// Rows of options_win.png measured on the art (the label lines and the slider bars under them).
const OPT_ROW_MUSIC = 173, OPT_ROW_SFX = 215, OPT_BAR_MUSIC = 197, OPT_BAR_SFX = 240;
// Font placement (bat::TextSprite): glyph images have a zero anchor, so a line is drawn with its 30 px cell top on
// the line's y. VAlignUp (the default) puts that on the sprite's position; VAlignCenter moves each line up by
// lines × lineHeight(18) / 2. In fuente_negra the capitals fill cell rows 5-23 and the digits rows 13-23, so with
// VAlignCenter the digits share the baseline of the labels printed on the art (e.g. info_map.png's "Nivel:").
const LINE_H = 18;
const TEXT_VC = LINE_H / 2;

export type Screen = 'pick' | 'splash' | 'loading' | 'intro' | 'menu' | 'online' | 'levels' | 'help' | 'credits' | 'options' | 'levelIntro' | 'play' | 'paused' | 'gameover' | 'win' | 'error' | 'follow';

interface LevelEntry { label: string; path: string; num: number; base?: number; extra?: number }

// ---- Map 2: extra levels (mod) with the enemies of Super Vampire Ninja Zero (tools/gen_extra_levels.py) ----
// Progress is stored under numbers 101..116; `base` is the original level whose terrain, tiles and moving
// platforms the extra level reuses.
const EXTRA_FIRST = 101;
// When true the extra levels only open after the 16 original ones are completed. For now they are open.
const EXTRA_REQUIRES_ORIGINALS = false;
const EXTRA = [
  // tramo 1
  { title: 'La Costa', base: 2, desc: 'Unos ninjas demonio desembarcaron\nen la costa. ¡Detenelos!' },
  { title: 'El Puerto', base: 11, desc: 'Entre contenedores y barcos\nacechan murciélagos y ninjas.' },
  { title: 'El Pueblo Solar', base: 8, desc: 'Un ninja dorado custodia la salida.\n¡Vencelo para conseguir la llave!' },
  // tramo 2
  { title: 'La Capital Tomada', base: 10, desc: 'Los demonios tomaron la capital.\n¡Recuperala!' },
  { title: 'Los Bañados', base: 3, desc: 'Las vacas quedaron atrapadas\nen los bañados. ¡Rescatalas!' },
  { title: 'El Bosque Embrujado', base: 7, desc: 'Al final del bosque espera\nel gran demonio.' },
  // tramo 3
  { title: 'La Ciudad de Noche', base: 9, desc: 'Las calles están tomadas\npor los vampiros.' },
  { title: 'Los Viñedos', base: 1, desc: 'Los ninjas se esconden\nentre los viñedos.' },
  { title: 'La Isla de Lucy', base: 3, desc: 'Lucy, la hermana de Mina,\nfue poseída por Drácula.' },
  // tramo 4
  { title: 'Los Muelles Viejos', base: 11, desc: 'En los muelles viejos hay\ndemonios por todos lados.' },
  { title: 'Los Suburbios', base: 9, desc: 'Drácula está muy cerca.\n¡Preparate!' },
  { title: 'El Castillo de Drácula', base: 7, desc: 'El señor de los vampiros te espera.\n¡Vencelo y salvá al planeta!' },
  // tramo 5 (nuevas rondas: el Ninja Dorado vuelve como jefe del 15)
  { title: 'La Rambla', base: 1, desc: 'Los ninjas patrullan la rambla.\nMirá arriba: hay bichos voladores.' },
  { title: 'Las Sierras', base: 7, desc: 'En las sierras el eco delata\na los demonios.' },
  { title: 'La Revancha', base: 8, desc: 'El Ninja Dorado volvió con ganas\nde revancha. ¡Vencelo otra vez!' },
  { title: 'El Hipódromo', base: 2, desc: 'Hasta el hipódromo lo tomaron.\n¡A limpiar la pista!' },
] as const;
const PAGE_ARROWS = [[494, 200], [18, 200]] as const; // map 1 -> map 2 (right edge), map 2 -> map 1 (left edge)

/** Semilla del mundo coop: el anfitrión y los invitados generan los mismos enemigos y vidas extra. */
function coopSeed(code: string, level: number): number {
  let h = 2166136261;
  for (const ch of `${code}:${level}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Button sprites (buttons_tile.png) + screen positions, from Menu::Menu (decompiled): [x, y] are the anchor
// centres in the 512x384 menu art; n/h are [sx, sy, sw, sh] source rects for normal / hover states.
interface MenuItem {
  action: string;
  x: number;
  y: number;
  /** rectángulo de origen en buttons_tile.png (normal / hover) */
  n?: [number, number, number, number];
  h?: [number, number, number, number];
  /** otra hoja en vez de buttons_tile.png (ONLINE: armado con letras del original, tools/compose_online_button.py) */
  src?: string;
}
const MENU_ITEMS: MenuItem[] = [
  { action: 'levels', x: 256, y: 295, n: [16, 59, 73, 29], h: [115, 53, 88, 41] },
  { action: 'online', x: 256, y: 262, src: 'assets/images/menuElements/online_btn.png', n: [0, 0, 58, 23], h: [0, 25, 78, 39] },
  { action: 'help', x: 176, y: 330, n: [238, 113, 54, 22], h: [338, 108, 66, 33] },
  { action: 'options', x: 256, y: 330, n: [14, 112, 77, 24], h: [113, 107, 91, 34] },
  { action: 'credits', x: 336, y: 330, n: [13, 161, 79, 27], h: [112, 155, 94, 38] },
  { action: 'splash', x: 251, y: 365, n: [239, 63, 52, 25], h: [338, 56, 66, 36] },
];

// Level-select node positions on map.png (LevelSelectScreen::LevelSelectScreen, decompiled).
const NODE_POS = [
  [190, 295], [338, 298], [295, 260], [420, 240], [303, 185], [442, 136], [300, 115],
  [460, 60], [315, 40], [130, 135], [212, 211], [60, 293], [20, 109], [90, 77], [18, 30], [135, 30],
];

// Opening logos, in order: the original's Batoví and Calcar, then the port's own (Vicemi)
const SPLASH_LOGOS = [
  'assets/images/menuElements/screen_logo_batovi.jpg',
  'assets/images/menuElements/screen_logo_calcar.jpg',
  'assets/images/menuElements/screen_logo_vicemi.jpg',
];

const SCREEN_IMAGES = [
  ...SPLASH_LOGOS,
  'assets/images/menuElements/menu.jpg',
  'assets/images/menuElements/menu_night.jpg',
  'assets/images/menuElements/buttons_tile.png',
  'assets/images/menuElements/online_btn.png',
  'assets/images/menuElements/map.png',
  'assets/images/menuElements/map_2.png',
  'assets/images/menuElements/preview_extra.jpg',
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
  'assets/images/menuElements/online_bg.jpg',
  'assets/images/menuElements/items_tile.png', // cabecitas tintadas del roster online del mapa
];

preloadUiArt(); // arte de la interfaz online (public/online/*.png)

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
  private extras: LevelEntry[] = [];
  private page = 0;              // level select: 0 = original map, 1 = map 2 (extra levels)
  private error = '';
  private needsPermission = false;
  private t = 0;                // time in the current screen
  private splashStep = 0;       // index into SPLASH_LOGOS (0 = Batovi, 1 = Calcar, 2 = Vicemi)
  private splashClose = -1;     // >= 0 while the current logo fades out (StateTransition closing)
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
  private introExtra = 0;        // extra level number (1-8) of the level intro card, 0 for the originals
  private arrowFrom = 0;         // level-select arrow glides from this node to levelIndex
  private arrowT = ARROW_GLIDE_INIT;
  private hdArt: string | null = null; // high-res screen art redrawn at display resolution this frame
  private stretch = false;
  private resizeObs: ResizeObserver | null = null;       // "Estirar pantalla"
  private pauseIndex = 0;        // PauseDialog: 0 = JUGAR, 1 = SALIR
  private confirming = false;    // ConfirmationDialog "¿Seguro que quieres volver al menú principal?"
  private confirmIndex = 1;      // 0 = SÍ, 1 = NO
  private cowCache: Record<number, number> = {};
  levelNum = 1;
  /** coop online: configuración de la partida en curso (null = un jugador) */
  private coopConfig: CoopConfig | null = null;
  /** coop online: estamos dentro del selector de niveles del juego (el host elige, los demás votan) */
  private onlinePick = false;
  /** carteles (pick_banner) que se dibujan a la resolución de la pantalla, encima del cuadro de 512x384 */
  private overlay: ((c: CanvasRenderingContext2D) => void)[] = [];
  /** coop (invitado): nodo del mapa donde está su cursor de voto (-1 = todavía no se movió) */
  private followVote = -1;
  /** aviso temporal sobre el menú principal (por ejemplo, por qué se cerró la sala) */
  private notice: { text: string; until: number } | null = null;
  /** coop (invitado): segundos que quedan armada la salida con Esc (se pide dos veces) */
  private leaveArm = 0;
  private followLevel = -1;
  /** coop: pantalla final mostrada, a la espera de volver al lobby */
  private coopEnd: 'win' | 'over' | null = null;
  private skipIntro(): void {
    this.screen = 'menu';
    this.menuIndex = -1;
    this.t = 0;
    playMusic('xa_menu');
  }

  /** Icon for the always-visible mobile back button (it does what Esc / "any key" does on each screen). */
  backLabel(): string {
    switch (this.screen) {
      case 'play': return '❚❚';
      case 'paused': return this.confirming ? '↩' : '▶';
      case 'menu': return document.fullscreenElement ? '🗗' : '⛶';
      case 'splash': case 'loading': case 'intro': return '⏭';
      case 'online': return '↩';
      case 'follow': return '↩';
      case 'levelIntro': return '▶';
      default: return '↩';
    }
  }
  /** Mobile back button action. Runs inside the tap handler, so fullscreen requests are allowed. */
  backAction(): void {
    switch (this.screen) {
      case 'play':
        this.screen = 'paused'; this.pauseIndex = 0; this.confirming = false;
        stopMusic(); playSound('CLICK');
        break;
      case 'paused':
        if (this.confirming) { this.confirming = false; playSound('CLICK'); } else this.resumeFromPause();
        break;
      case 'menu': this.toggleFullscreen(); break;
      case 'online': online.backToMenu(); break;
      case 'follow': this.tryLeave(); break;
      case 'splash': if (this.splashClose < 0) this.splashClose = 0; break; // next logo
      case 'loading': this.clicked = true; break;       // same as tapping the screen (once loaded)
      case 'intro': this.t = INTRO_WAIT; this.clicked = true; break; // same as any key: next page
      case 'levelIntro': if (this.levelReady && this.scenario) this.screen = 'play'; break;
      case 'gameover': case 'win':
        if (this.t > END_WAIT) {
          if (this.coopEnd) this.finishCoopMatch();
          else { this.screen = 'menu'; this.menuIndex = -1; this.t = 0; playMusic('xa_menu'); }
        }
        break;
      case 'levels': case 'options': case 'help': case 'credits':
        this.screen = 'menu'; this.menuIndex = -1; this.draggingSlider = null; playSound('CLICK');
        break;
      default: break;
    }
  }

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
    // puente con el lobby online (React) y con la partida coop
    online.setHooks({
      start: (level, difficulty, settings, room) => { void this.startOnline(level, difficulty, settings, room); },
      ended: () => this.finishOnline(),
      exit: () => this.exitOnline(),
      pick: () => this.openOnlineLevels(),
      input: (from, b, q) => this.scenario?.setRemoteInput(from, b, q),
      snap: (s) => this.scenario?.applySnap(s),
      resetProgress: () => { this.state.wipe(); this.cowCache = {}; this.page = 0; this.selectLevel(0); },
    });
  }

  // ---------------------------------------------------------------- coop: etapa de menús (el anfitrión maneja, los demás miran)
  /** Hay sala en el lobby y el anfitrión ya dijo "todo listo". */
  private browseStage(): boolean {
    const st = online.getState();
    return st.phase === 'lobby' && !!st.room && st.room.stage === 'browse';
  }

  /** Mantiene la pantalla de juego alineada con la etapa de la sala (anfitrión: menús; invitados: espectador). */
  private syncStage(): void {
    const st = online.getState();
    if (st.phase !== 'lobby' || !st.room) return;
    const browse = st.room.stage === 'browse';
    const s = this.screen;
    if (st.host) {
      if (browse && s === 'online') { this.screen = 'menu'; this.menuIndex = -1; this.onlinePick = false; this.t = 0; playMusic('xa_menu'); }
      else if (!browse && (s === 'menu' || s === 'levels' || s === 'options' || s === 'help' || s === 'credits')) {
        this.onlinePick = false; this.screen = 'online'; this.t = 0;
      }
    } else if (browse && s === 'online') {
      this.screen = 'follow'; this.t = 0; this.followVote = -1; this.followLevel = -1; this.leaveArm = 0; playMusic('xa_menu');
    } else if (!browse && s === 'follow') {
      this.screen = 'online'; this.t = 0;
    }
  }

  private doneList(): number[] {
    return Object.entries(this.state.progress).filter(([, p]) => p?.done).map(([n]) => +n);
  }

  /** Anfitrión: publica a los demás en qué parte de los menús está y qué niveles tiene abiertos. */
  private publishMenu(): void {
    const st = online.getState();
    if (!st.host || !st.room || st.phase !== 'lobby') return;
    const s: MenuState['s'] = this.screen === 'levels' ? 'levels' : this.screen === 'online' ? 'lobby' : 'menu';
    const done = this.doneList();
    online.publishMenu({
      s, i: this.hoverIndex >= 0 && s === 'menu' ? this.hoverIndex : this.menuIndex, p: this.page, l: this.levelIndex,
      d: done, f: done.filter((n) => this.state.isPerfect(n)),
    });
  }

  /** Invitado: sigue al anfitrión (pantalla, cursor, mapa) y deja mover su cursor de voto. */
  private updateFollow(dt: number): void {
    online.tick();
    this.hoverIndex = -1;
    this.leaveArm = Math.max(0, this.leaveArm - dt);
    const hm = online.getState().menu;
    if (hm?.s === 'levels') {
      if (this.page !== hm.p) { this.page = hm.p; this.followVote = -1; this.infoIndex = -1; }
      if (hm.l !== this.levelIndex) { this.arrowFrom = this.levelIndex; this.levelIndex = hm.l; this.arrowT = 0; }
      this.arrowT = Math.min(ARROW_GLIDE, this.arrowT + dt);
      if (this.followVote < 0) this.followVote = this.isUnlocked(hm.l) ? hm.l : 0;
      const last = this.lastSelectable();
      if (isFirstPress('right') || isFirstPress('up')) { this.followVote = Math.min(last, this.followVote + 1); playSound('CLICK'); }
      if (isFirstPress('left') || isFirstPress('down')) { this.followVote = Math.max(0, this.followVote - 1); playSound('CLICK'); }
      this.hoverIndex = this.levelHoverIndex();
      let pick = -1;
      if (this.clicked && this.hoverIndex >= 0 && this.isUnlocked(this.hoverIndex)) { this.followVote = this.hoverIndex; pick = this.hoverIndex; }
      else if (isFirstPress('confirm') || isFirstPress('jumpHold') || isFirstPress('jumpTap') || isFirstPress('fire')) pick = this.followVote;
      if (pick >= 0 && this.isUnlocked(pick)) {
        const e = this.pageLevels[pick];
        const num = e?.num ? (e.extra ? EXTRA_FIRST + e.extra - 1 : e.num) : 0;
        if (num) { playSound('CLICK'); online.vote(num); }
      }
    } else {
      this.menuIndex = hm?.i ?? -1;
      this.followVote = -1;
    }
    if (isFirstPress('back')) this.tryLeave();
  }

  /** Invitado: salir de la sala pide apretar dos veces (un Esc de más no te saca del grupo). */
  private tryLeave(): void {
    if (this.leaveArm > 0) { this.leaveArm = 0; online.backToMenu(); return; }
    this.leaveArm = 3;
  }

  /** Datos del anfitrión que mandan sobre el progreso propio mientras se mira su mapa. */
  private remote(): MenuState | null {
    return this.screen === 'follow' ? (online.getState().menu ?? { s: 'menu', i: -1, p: 0, l: 0, d: [], f: [] }) : null;
  }
  private doneOf(n: number): boolean {
    const r = this.remote();
    return r ? r.d.includes(n) : !!this.state.progress[n]?.done;
  }
  private perfectOf(n: number): boolean {
    const r = this.remote();
    return r ? r.f.includes(n) : this.state.isPerfect(n);
  }

  /** Arranca una partida coop con el nivel, la dificultad y el roster que fijó el servidor. */
  private async startOnline(level: number, difficulty: Difficulty, settings: { powerups: boolean }, room: {
    code: string; hostId: number | null; players: { id: number; name: string; color: number }[];
  }): Promise<void> {
    this.onlinePick = false;
    const entry = level >= EXTRA_FIRST ? this.extras[level - EXTRA_FIRST] : this.levels[level - 1];
    if (!entry) {
      this.error = 'El anfitrión eligió un nivel que no existe en este build.';
      this.screen = 'error';
      return;
    }
    const st = online.getState();
    this.coopConfig = {
      role: st.host ? 'host' : 'guest',
      roster: room.players.map((p) => ({
        id: p.id, name: p.name.slice(0, 10), color: p.color, hex: online.playerInfo(p.id).hex,
        plain: p.id === room.hostId,
      })),
      you: st.you,
      difficulty,
      powerups: !!settings.powerups,
      seed: coopSeed(room.code, level),
    };
    await this.loadLevel(entry, this.coopConfig);
  }

  /** La sala volvió al lobby (fin de nivel, derrota o el anfitrión cortó): se muestra el panel otra vez. */
  private finishOnline(): void {
    this.onlinePick = false;
    this.coopConfig = null;
    this.coopEnd = null;
    this.scenario?.dispose();
    this.scenario = null;
    this.hud = new Hud();
    this.screen = 'online';
    this.t = 0;
    playMusic('xa_menu');
  }

  /** Abre el selector de niveles del juego para elegir/votar el nivel de la sala (anfitrión elige, invitados votan). */
  private openOnlineLevels(): void {
    const st = online.getState();
    if (!st.room || st.phase !== 'lobby') return;
    if (this.screen === 'levels' && this.onlinePick) return;
    this.onlinePick = true;
    this.screen = 'levels';
    this.t = 0;
    const level = st.room.level;
    const extra = level >= EXTRA_FIRST;
    this.page = extra ? 1 : 0;
    const idx = this.pageLevels.findIndex((e) => e.num === level || e.extra === level - EXTRA_FIRST);
    this.selectLevel(idx >= 0 ? idx : (extra ? Math.max(0, this.extraUnlocked() - 1) : this.unlockedCount() - 1));
    this.infoIndex = -1;
    playMusic('xa_menu');
  }
  /** Coop: el anfitrión elige el nivel y la partida arranca sola; los invitados solo votan. */
  private chooseOnlineLevel(index: number): void {
    const entry = this.pageLevels[index];
    const num = entry?.num ? (entry.extra ? EXTRA_FIRST + entry.extra - 1 : entry.num) : 0;
    if (!num) return;
    const st = online.getState();
    if (st.host) {
      // se queda en el mapa: si el servidor no deja empezar (falta alguien) el motivo se ve acá; si empieza, llega `start`
      online.setLevel(num);
      online.start(); // el servidor aplica el nivel y arranca en el mismo orden de mensajes
    } else {
      this.onlinePick = false;
      this.screen = 'online';
      online.vote(num);
    }
  }
  private exitOnline(): void {
    this.onlinePick = false;
    this.followVote = -1;
    // si la sala se cerró (anfitrión se fue, expulsión...) el motivo queda en el menú unos segundos
    const why = online.getState().error;
    this.notice = why ? { text: why, until: performance.now() + 7000 } : null;
    this.coopConfig = null;
    this.coopEnd = null;
    this.scenario?.dispose();
    this.scenario = null;
    this.hud = new Hud();
    this.screen = 'menu';
    this.menuIndex = -1;
    this.t = 0;
    playMusic('xa_menu');
  }

  /** Coop: terminó el nivel o perdieron todos. El anfitrión cierra la partida; los invitados esperan el lobby. */
  private finishCoopMatch(): void {
    // los invitados esperan a que el servidor devuelva la sala al lobby (finishOnline)
    if (!this.coopEnd || this.coopConfig?.role !== 'host') return;
    this.coopEnd = null;
    online.endMatch();
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
      .filter((p) => p.endsWith('.tmx') && !/\/level\d+\.tmx$/.test(p) && !p.includes('/extra/'))
      .map((p) => ({ label: p.split('/').pop()!.replace('.tmx', ''), path: p, num: 0 }));
    this.levels = [
      ...Array.from({ length: LEVEL_COUNT }, (_, i) => ({ label: `Nivel ${i + 1} - ${LEVEL_TITLES[i] ?? ''}`, path: `assets/data/level${i + 1}.tmx`, num: i + 1 })),
      ...custom,
    ];
    this.extras = EXTRA.map((e, k) => ({
      label: e.title, path: `assets/data/extra/extra${k + 1}.tmx`, num: EXTRA_FIRST + k, base: e.base, extra: k + 1,
    }));
    // Modding / testing shortcuts: ?level=N jumps straight into level N, ?map=assets/data/x.tmx into any TMX.
    const q = new URLSearchParams(location.search);
    const lv = +(q.get('level') ?? 0), map = q.get('map'), ex = +(q.get('extra') ?? 0);
    if (ex >= 1 && ex <= this.extras.length) {
      this.page = 1;
      this.selectLevel(ex - 1);
      playMusic('xa_menu');
      void this.loadLevel(this.extras[ex - 1]);
      return;
    }
    if (map || (lv >= 1 && lv <= LEVEL_COUNT)) {
      const entry = map
        ? this.levels.find((l) => l.path === map.toLowerCase()) ?? { label: map.split('/').pop()!.replace('.tmx', ''), path: map, num: 0 }
        : this.levels[lv - 1];
      this.selectLevel(Math.max(0, this.levels.indexOf(entry)));
      playMusic('xa_menu');
      void this.loadLevel(entry);
      return;
    }
    // ?sala=CODE: abrir el lobby online con el código ya cargado (los links de invitación usan esto)
    const sala = (q.get('sala') ?? '').trim().toUpperCase();
    if (sala) {
      online.enter();
      this.screen = 'online';
      this.t = 0;
      playMusic('xa_menu');
      return;
    }
    this.screen = 'splash';
    this.t = 0;
    this.splashStep = 0;
    this.bootReadyAt = 1.2;
    playMusic('intro_piano', false); // SplashScreen: intro_piano.ogg once (not looped) over the two logos
  }

  async loadLevel(entry: LevelEntry, coop?: CoopConfig): Promise<void> {
    // Intro(levelId): the level card is shown right away with the "CARGANDO..." ribbon while the level loads
    // behind it; once loaded the blinking "press any key" ribbon replaces it (Intro::render / Intro::update).
    this.coopConfig = coop ?? null;
    this.coopEnd = null;
    this.screen = 'levelIntro';
    this.scenario?.dispose();
    this.scenario = null;
    this.levelReady = false;
    resetInput();
    this.readyT = 0;
    this.introNum = entry.num;
    this.introLabel = entry.num && !entry.extra ? (LEVEL_TITLES[entry.num - 1] ?? entry.label) : entry.label;
    this.introExtra = entry.extra ?? 0;
    this.t = 0;
    const t0 = performance.now();
    try {
      const text = await loadText(entry.path);
      const level = parseTmx(text);
      await preloadImages(Scenario.imagePaths(level));
      stopMusic();
      // keep the "CARGANDO..." ribbon visible for a minimum time (otherwise it flashes for microseconds)
      const elapsed = performance.now() - t0;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
      this.levelNum = entry.num || this.levelNum;
      this.hud = new Hud();
      this.state.beginLevel(); // power-ups/keys/coins never carry over between levels (HeroState::goToLevelSelect)
      this.scenario = new Scenario(level, entry.base ?? entry.num, this.state, {
        gameOver: () => {
          if (coop) {
            // el anfitrión avisa a los invitados; todos ven la pantalla y después vuelven al lobby
            this.coopEnd = 'over';
            if (coop.role === 'host') online.sendEndSnap('over');
            this.screen = 'gameover';
            this.t = 0;
            playMusic('lose');
            return;
          }
          this.state.reset();
          this.scenario?.dispose();
    this.scenario = null;
          this.screen = 'gameover';
          this.t = 0;
          playMusic('lose');
        },
        levelComplete: () => {
          if (coop) {
            this.coopEnd = 'win';
            if (coop.role === 'host') {
              if (entry.num) this.state.recordLevel(entry.num);   // el progreso que cuenta es el del anfitrión
              online.sendEndSnap('win');
            }
            this.screen = 'win';
            this.t = 0;
            playMusic('xa_win');
            return;
          }
          const n = entry.num;
          if (n) this.state.recordLevel(n);
          this.scenario?.dispose();
    this.scenario = null;
          this.t = 0;
          if (entry.extra) {
            // map 2: back to the extra map with the next extra level selected; the last one ends the game
            if (entry.extra >= EXTRA.length) { playMusic('xa_win'); this.screen = 'win'; return; }
            playMusic('xa_menu');
            this.screen = 'levels';
            this.page = 1;
            this.selectLevel(Math.min(entry.extra, this.extraUnlocked() - 1));
            return;
          }
          if (n && n >= LEVEL_COUNT) {
            // last level only: "game complete" screen
            playMusic('xa_win');
            this.screen = 'win';
          } else {
            // otherwise: back to level select, cursor on the newly unlocked next level
            playMusic('xa_menu');
            this.screen = 'levels';
            this.page = 0;
            if (n) this.selectLevel(Math.min(n, this.unlockedCount() - 1)); // cursor on the newly unlocked level
          }
        },
        message: (t, seconds) => this.hud.showMessage(t, seconds),
        saving: () => this.hud.showSaving(),
        // coop: el anfitrión manda instantáneas y el invitado, sus controles; el final llega por red
        onlineEnd: coop ? (kind) => {
          this.coopEnd = kind;
          this.screen = kind === 'win' ? 'win' : 'gameover';
          this.t = 0;
          playMusic(kind === 'win' ? 'xa_win' : 'lose');
        } : undefined,
        snapshot: coop?.role === 'host' ? (s) => online.sendSnapshot(s) : undefined,
        input: coop?.role === 'guest' ? (b, q) => online.sendInput(b, q) : undefined,
      }, coop);
      // the key counter shows from level 14 on, and in extra levels that have a gate
      if (entry.extra) this.state.keysHud = /type="Door"/.test(text);
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
    this.syncStage();
    switch (this.screen) {
      case 'splash': {
        // SplashScreen: each logo is its own state that plays intro_piano once and sends itself "fadeToBlack"
        // after 3.5 s (or on any key/click); leaving the state cuts its sound. After the last logo → PreLoader
        // with xa_intro.
        if (this.splashClose < 0 && (this.t >= SPLASH_TIME || this.clicked || isFirstPress('any'))) this.splashClose = 0;
        if (this.splashClose >= 0) {
          this.splashClose += dt;
          if (this.splashClose >= STATE_FADE) {
            this.splashClose = -1;
            this.splashStep++;
            this.t = 0;
            if (this.splashStep >= SPLASH_LOGOS.length) {
              this.screen = 'loading'; this.loadingIsBoot = true;
              playMusic('xa_intro');
            } else {
              playMusic('intro_piano', false); // restarts the "dong" for the next logo
            }
          }
        }
        break;
      }
      case 'loading':
        if (this.loadingIsBoot && this.t >= this.bootReadyAt && this.soundsReady && (this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold') || isFirstPress('fire'))) { this.screen = 'intro'; this.introPage = 0; this.t = 0; }
        break;
      case 'intro':
        // comic (InGame::loadIntroGeneral → General2..5 → loadMenu): every page is an Intro that turns on ANY key
        // or click after its 0.6 s wait (0x314 = 0x3f19999a); there is no "skip the whole story" key
        if (this.t > INTRO_WAIT && (this.clicked || isFirstPress('any'))) {
          this.introPage++;
          this.t = 0;
          if (this.introPage >= INTRO_PAGES.length) this.skipIntro();
          else playSound('CLICK');
        }
        break;
      case 'menu': {
        const n = MENU_ITEMS.length;
        if (isFirstPress('up')) { if (this.menuIndex < 0) this.menuIndex = 0; else this.menuIndex = (this.menuIndex + n - 1) % n; playSound('CLICK'); }
        if (isFirstPress('down')) { if (this.menuIndex < 0) this.menuIndex = 0; else this.menuIndex = (this.menuIndex + 1) % n; playSound('CLICK'); }
        this.hoverIndex = this.menuHoverIndex();
        if (this.browseStage() && isFirstPress('back')) { online.setBrowse(false); break; }   // la pantalla vuelve al lobby cuando el servidor lo confirma
        if (this.clicked && this.hoverIndex >= 0) {
          this.menuIndex = this.hoverIndex;
          this.activateMenu(MENU_ITEMS[this.hoverIndex].action);
        } else if (isFirstPress('confirm') || isFirstPress('jumpHold')) {
          if (this.menuIndex < 0) this.menuIndex = 0;
          else this.activateMenu(MENU_ITEMS[this.menuIndex].action);
        }
        break;
      }
      case 'online': {
        // el lobby lo dibuja el panel de React; acá solo corre el reloj del ping y la tecla de volver
        online.tick();
        if (isFirstPress('back')) online.backToMenu();
        break;
      }
      case 'follow':
        this.updateFollow(dt);
        break;
      case 'levels': {
        // LevelSelectScreen::update: right/up = next level, left/down = previous, along the map path (no wrap),
        // never past the last unlocked one; holding the key keeps stepping once the arrow has glided over
        this.arrowT = Math.min(ARROW_GLIDE, this.arrowT + dt);
        // map 1 <-> map 2: the arrow on the map edge, or right past the last open level / left before the first
        // extra one
        if ((this.page === 0 && isFirstPress('right') && this.levelIndex === this.lastSelectable())
          || (this.page === 1 && isFirstPress('left') && this.levelIndex === 0)
          || (this.clicked && this.pageArrowHover())) {
          this.openPage(1 - this.page);
          break;
        }
        if (this.arrowT >= ARROW_GLIDE) {
          const next = isPressed('right') || isPressed('up');
          const prev = isPressed('left') || isPressed('down');
          const last = this.lastSelectable();
          let to = this.levelIndex;
          if (next && !prev) to = Math.min(last, this.levelIndex + 1);
          else if (prev && !next) to = Math.max(0, this.levelIndex - 1);
          if (to !== this.levelIndex) {
            this.arrowFrom = this.levelIndex;
            this.levelIndex = to;
            this.arrowT = 0;
            playSound('CLICK');
          }
        }
        if (isFirstPress('back')) {
          if (this.onlinePick) {
            this.onlinePick = false;
            // con los menús abiertos para todos se vuelve al menú principal; si no, al lobby
            this.screen = this.browseStage() ? 'menu' : 'online';
            this.menuIndex = -1;
            return;
          }
          this.screen = 'menu'; this.menuIndex = -1;
        }
        this.hoverIndex = this.levelHoverIndex();
        const shown = this.hoverIndex >= 0 ? this.hoverIndex : this.levelIndex;
        if (shown !== this.infoIndex) { this.infoIndex = shown; this.infoT = 0; }
        this.infoT += dt;
        if (this.clicked && this.hoverIndex >= 0 && this.isUnlocked(this.hoverIndex)) {
          if (this.onlinePick) {
            this.selectLevel(this.hoverIndex);
            this.chooseOnlineLevel(this.hoverIndex);
            return;
          }
          this.selectLevel(this.hoverIndex);
          void this.loadLevel(this.pageLevels[this.hoverIndex]);
        } else if (isFirstPress('confirm') || isFirstPress('jumpHold') || isFirstPress('jumpTap') || isFirstPress('fire')) {
          // isSelectionAccept: fire, jump or Enter
          playSound('CLICK');
          if (this.isUnlocked(this.levelIndex)) {
            if (this.onlinePick) { this.chooseOnlineLevel(this.levelIndex); return; }
            void this.loadLevel(this.pageLevels[this.levelIndex]);
          }
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
        // Credits::update / Help: any key or a click returns to the menu ("Presiona cualquier tecla")
        if (this.t > 0.3 && (isFirstPress('any') || this.clicked)) { this.screen = 'menu'; this.menuIndex = -1; playSound('CLICK'); }
        break;
      case 'gameover': case 'win':
        // InGame::loadGameOver / loadEnding run an Intro(0x12 / 0x11) that accepts a key after 2 s and then calls
        // loadMenu: both go back to the MAIN MENU. En coop, después de la pantalla se vuelve al lobby.
        if (this.coopEnd) {
          if (this.t > END_WAIT + 0.5) this.finishCoopMatch();
          // invitado: si el anfitrión nunca devuelve la sala al lobby, tecla/click a los 6 s o salida sola a los 30 s
          if (this.coopConfig?.role === 'guest' && ((this.t > END_WAIT + 6 && (this.clicked || isFirstPress('any'))) || this.t > 30)) {
            online.backToMenu();
          }
          break;
        }
        if (this.t > END_WAIT && (this.clicked || isFirstPress('any'))) {
          this.screen = 'menu'; this.menuIndex = -1; playMusic('xa_menu');
          this.t = 0;
        }
        break;
      case 'levelIntro':
        // Intro::update: any key/click once the level is loaded (after a 0.05 s guard)
        if (this.levelReady) {
          this.readyT += dt;
          if (this.coopConfig) {
            // todos entran juntos: no se espera una tecla para no desincronizar al grupo
            if (this.readyT > 1.2 && this.scenario) this.screen = 'play';
            break;
          }
          if (this.readyT > 0.05 && this.scenario && (this.clicked || isFirstPress('confirm') || isFirstPress('jumpHold') || isFirstPress('fire'))) {
            this.screen = 'play';
          }
        }
        break;
      case 'play':
        online.tick();
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
        if (this.coopConfig) { online.tick(); this.scenario?.pauseTick(dt); } // coop: los demás siguen y se enteran de la pausa
        this.updatePause();
        break;
      case 'error':
        if (isFirstPress('back') && hasGameFiles()) this.screen = 'menu';
        break;
      default:
        break;
    }
    this.publishMenu();
    this.clicked = false;
  }

  private activateMenu(action: string): void {
    playSound('CLICK');
    // con los menús abiertos para todos, JUGAR y ONLINE llevan al mapa donde el anfitrión elige el nivel de la sala
    if (this.browseStage() && (action === 'levels' || action === 'online')) { this.openOnlineLevels(); return; }
    switch (action) {
      case 'levels': this.screen = 'levels'; this.page = 0; this.selectLevel(this.unlockedCount() - 1); this.t = 0; playMusic('xa_menu'); break; // cursor on the newest unlocked level
      case 'online': this.screen = 'online'; this.t = 0; online.enter(); playMusic('xa_menu'); break;
      case 'help': this.screen = 'help'; this.t = 0; break;
      case 'options': this.screen = 'options'; this.t = 0; break;
      case 'credits': this.screen = 'credits'; this.t = 0; break;
      case 'splash':
        // dentro de una sala, recargar tira a todos del grupo: se pide confirmación
        if (online.getState().room && !window.confirm('Si salís se cierra tu sesión en la sala (si sos el anfitrión, para todos). ¿Salir?')) break;
        window.location.reload();
        break;
    }
  }

  /** Jump the level-select cursor (no glide). */
  private selectLevel(i: number): void {
    this.levelIndex = this.arrowFrom = Math.max(0, i);
    this.arrowT = ARROW_GLIDE;
  }

  /** Index of the last level the cursor may reach (LevelSelectScreen 0x348): the last unlocked one, plus any
   *  custom maps listed after level 16. */
  private lastSelectable(): number {
    let last = 0;
    const list = this.pageLevels;
    for (let i = 0; i < list.length; i++) if (this.isUnlocked(i)) last = i;
    return last;
  }

  /** Levels shown on the current map page. */
  private get pageLevels(): LevelEntry[] { return this.page ? this.extras : this.levels; }

  /** Extra levels open one after another (the first one right away, or after level 16 when required). */
  private extraUnlocked(): number {
    if (EXTRA_REQUIRES_ORIGINALS && !this.doneOf(LEVEL_COUNT)) return 0;
    let u = 1;
    for (let k = 0; k < EXTRA.length; k++) if (this.doneOf(EXTRA_FIRST + k)) u = k + 2;
    return Math.min(EXTRA.length, u);
  }

  private openPage(p: number): void {
    this.page = p;
    this.selectLevel(p ? Math.max(0, this.extraUnlocked() - 1) : this.unlockedCount() - 1);
    this.infoIndex = -1;
    this.t = 0;
    playSound('CLICK');
  }

  /** Is the pointer on the page arrow of the current map? */
  private pageArrowHover(): boolean {
    const m = this.mouseGamePos();
    const [ax, ay] = PAGE_ARROWS[this.page];
    return Math.abs(m.x - ax) < 22 && Math.abs(m.y - ay) < 26;
  }

  /** Highest level number the player may play (1 + last completed). */
  private unlockedCount(): number {
    let u = 1;
    for (let i = 1; i <= LEVEL_COUNT; i++) if (this.doneOf(i)) u = i + 1;
    return Math.min(LEVEL_COUNT, u);
  }
  private isUnlocked(idx: number): boolean {
    const e = this.pageLevels[idx];
    if (!e) return false;
    if (e.extra) return e.extra <= this.extraUnlocked();
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
      const [, , w, h] = it.n!;
      if (m.x >= it.x - w / 2 && m.x <= it.x + w / 2 && m.y >= it.y - h / 2 && m.y <= it.y + h / 2) return i;
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
      const sc = this.scenario;
      const local = sc.players.find((p) => p.local) ?? sc.players[0];
      this.hud.render(w, this.state, sc.coop ? { players: sc.players, local } : undefined);
      const bar = this.scenario.bossBar;
      if (bar) this.hud.renderBossBar(w, bar, STEP);
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
    // high-res screen art goes underneath, straight at display resolution; the 512x384 frame (buttons, texts,
    // ribbons, fades drawn after the art) is laid on top with the art's area left transparent
    if (this.hdArt) this.renderHdArt(c, v);
    c.drawImage(this.world, v.x, v.y, v.w, v.h);
    // carteles en coordenadas del juego pero pintados a la resolución real: la letra chica no se pixela
    if (this.overlay.length) {
      c.setTransform(s, 0, 0, s, v.x, v.y);
      for (const f of this.overlay) f(c);
      c.setTransform(1, 0, 0, 1, 0, 0);
      this.overlay.length = 0;
    }

    // custom cursor (original POINTER sprite) — hidden while playing so it doesn't get in the way
    const cur = this.screen === 'play' ? null : frameOf('POINTER', 0);
    if (cur) {
      const cs = Math.max(16, Math.round(32 * s));
      c.drawImage(cur.image, cur.sx, cur.sy, cur.sw, cur.sh, Math.round(this.mouseX), Math.round(this.mouseY), cs, cs);
    }
  }

  // ---------- screens (original art) ----------
  /** Screen art keeps the visible picture in its TOP 4:3 band (512x512 sheets → top 512x384; a redrawn
   *  1024x1024 sheet → top 1024x768). Returns that band's source height. */
  private static band(im: HTMLImageElement): number {
    return Math.min(im.height, Math.round((im.width * VIEW_H) / VIEW_W));
  }
  private cover(w: CanvasRenderingContext2D, path: string): void {
    const im = img(path);
    if (!im) { w.fillStyle = '#000'; w.fillRect(0, 0, VIEW_W, VIEW_H); return; }
    // art at a higher resolution than the 512x384 frame (redrawn menu.jpg / menu_night.jpg / creditos.jpg) is
    // drawn straight onto the screen canvas in render() so it stays sharp instead of being halved and blown up
    // again; here its area is left transparent so whatever the screen draws next lands on top of it
    if (im.width > VIEW_W) { w.clearRect(0, 0, VIEW_W, VIEW_H); this.hdArt = path; return; }
    w.drawImage(im, 0, 0, im.width, XaGame.band(im), 0, 0, VIEW_W, VIEW_H);
  }
  private coverTop(w: CanvasRenderingContext2D, path: string): void {
    this.cover(w, path);
  }

  /** Full-resolution pass for high-res screen art (redrawn menus and credits, any size): the picture's top 4:3 band
   *  is drawn at the display's own resolution, under the 512x384 frame. */
  private renderHdArt(c: CanvasRenderingContext2D, v: { x: number; y: number; w: number; h: number }): void {
    const im = img(this.hdArt!);
    this.hdArt = null;
    if (!im) return;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(im, 0, 0, im.width, XaGame.band(im), v.x, v.y, v.w, v.h);
  }

  private renderScreens(w: CanvasRenderingContext2D): void {
    this.hdArt = null;
    switch (this.screen) {
      case 'pick': this.renderPick(w); break;
      case 'error': this.renderError(w); break;
      case 'splash': this.renderSplash(w); break;
      case 'loading': this.renderLoading(w); break;
      case 'intro': this.renderIntro(w); break;
      case 'menu': this.renderMenu(w); this.renderBrowseBanner(w); break;
      case 'online': this.renderOnline(w); break;
      case 'levels': this.renderLevels(w); this.renderBrowseBanner(w); break;
      case 'follow':
        if (online.getState().menu?.s === 'levels') this.renderLevels(w); else this.renderMenu(w);
        this.renderFollowBanner(w);
        break;
      case 'help': this.renderFull(w, 'assets/lang/images/help/ayuda.jpg'); break;
      case 'credits': this.renderFull(w, 'assets/lang/images/credits/creditos.jpg'); break;
      case 'options': this.renderOptions(w); break;
      case 'levelIntro': this.renderLevelIntro(w); break;
      case 'gameover': this.renderFull(w, 'assets/lang/images/intros/game_over.jpg', END_WAIT); this.renderCoopScores(w); break;
      case 'win': this.renderFull(w, 'assets/lang/images/intros/screen_win.jpg', END_WAIT); this.renderCoopScores(w); break;
      default: break;
    }
  }

  /** Coop: puntos de cada jugador en la pantalla final (cada uno suma los suyos). */
  private renderCoopScores(w: CanvasRenderingContext2D): void {
    const pls = this.coopEnd ? this.scenario?.players : null;
    if (!pls?.length) return;
    const rowH = 18, pw = 220, ph = pls.length * rowH + 10, x = (VIEW_W - pw) / 2, y = 8;
    w.fillStyle = 'rgba(0,0,0,0.3)'; w.beginPath(); w.roundRect(x + 1, y + 2, pw, ph, 6); w.fill();
    w.fillStyle = '#e2d5ae'; w.strokeStyle = '#1a1818'; w.lineWidth = 2;
    w.beginPath(); w.roundRect(x, y, pw, ph, 6); w.fill(); w.stroke();
    [...pls].sort((a, b) => b.score - a.score).forEach((p, i) => {
      const ry = y + 5 + i * rowH;
      w.fillStyle = p.hex ?? '#fff'; w.fillRect(x + 8, ry + 3, 8, 8);
      drawText(w, (p.name || 'Xa').slice(0, 10), x + 22, ry, 'black', 'left', 0.5);
      drawText(w, String(p.score).padStart(6, '0'), x + pw - 8, ry, 'black', 'right', 0.5);
    });
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
    const logo = SPLASH_LOGOS[Math.min(this.splashStep, SPLASH_LOGOS.length - 1)];
    // StateTransition: opening 0→1 over 0.8 s, closing 1→0 over 0.8 s once the logo is done
    const a = this.splashClose >= 0 ? Math.max(0, 1 - this.splashClose / STATE_FADE) : Math.min(1, this.t / STATE_FADE);
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
    if (this.loadingIsBoot && this.t < STATE_FADE) {
      // entering InGame: StateTransition opening from black
      w.fillStyle = `rgba(0,0,0,${1 - this.t / STATE_FADE})`;
      w.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (!this.loadingIsBoot || this.t < this.bootReadyAt || !this.soundsReady) {
      const f = Math.floor(this.t * 3) % 3; // 20 ticks @ 60 fps per frame
      w.drawImage(im, 0, 384 + f * 40, 260, 40, 512 - 260, 288, 260, 40);
    }
  }

  private renderIntro(w: CanvasRenderingContext2D): void {
    this.cover(w, INTRO_PAGES[this.introPage] ?? INTRO_PAGES[0]);
    if (this.t > INTRO_WAIT) this.drawPressAnyKey(w);
  }

  private renderMenu(w: CanvasRenderingContext2D): void {
    // AssetsGeneral "MENU": the day art between 10:00 and 18:59 of the player's clock, the night art otherwise
    const hour = new Date().getHours();
    this.coverTop(w, hour - 10 >= 0 && hour - 10 < 9 ? 'assets/images/menuElements/menu.jpg' : 'assets/images/menuElements/menu_night.jpg');
    if (this.notice && this.screen === 'menu') {
      if (performance.now() > this.notice.until) this.notice = null;
      else if (uiArt('pick_banner')) this.banner(w, 24, 4, VIEW_W - 48, 22, this.notice.text.slice(0, 70), 0.45, 'error');
      else {
        w.fillStyle = 'rgba(120,10,10,0.88)';
        w.fillRect(0, 0, VIEW_W, 16);
        drawText(w, this.notice.text.slice(0, 70), VIEW_W / 2, 2, 'white', 'center', 0.5);
      }
    }
    const bt = img('assets/images/menuElements/buttons_tile.png');
    if (!bt) return;
    MENU_ITEMS.forEach((it, i) => {
      const active = i === this.menuIndex || i === this.hoverIndex;
      const sheet = it.src ? img(it.src) : bt;
      if (!sheet) return;
      const [sx, sy, sw, sh] = (active ? it.h : it.n)!;
      w.drawImage(sheet, sx, sy, sw, sh, it.x - sw / 2, it.y - sh / 2, sw, sh);
    });
    // Menu::init → setHighScore(HeroState::getHighScore): the record = sum of every level's best score (saveGame),
    // zero-padded to 6 digits, black font (GameFont 0), TextSprite at (419, 8) per Menu::Menu — the glyphs sit low
    // in their 30 px cells, so that lands the digits under "RÉCORD:", inside the box
    drawText(w, String(this.state.recordTotal()).padStart(6, '0'), 419, 8, 'black', 'left');
  }

  /** Pantalla ONLINE: el arte del menú atenuado detrás del panel de React (src/components/OnlinePanel.tsx). */
  private renderOnline(w: CanvasRenderingContext2D): void {
    const hour = new Date().getHours();
    const bg = img('assets/images/menuElements/online_bg.jpg'); // arte final del lobby (si falta, el menú atenuado de antes)
    this.coverTop(w, bg ? 'assets/images/menuElements/online_bg.jpg' : hour - 10 >= 0 && hour - 10 < 9 ? 'assets/images/menuElements/menu.jpg' : 'assets/images/menuElements/menu_night.jpg');
    w.fillStyle = bg ? 'rgba(3, 7, 12, 0.32)' : 'rgba(3, 7, 12, 0.62)';
    w.fillRect(0, 0, VIEW_W, VIEW_H);
    // si el panel no está montado (backend sin configurar) al menos queda el cartel del canvas
    const st = online.getState();
    if (!st.enabled) drawText(w, 'Sin servidor online en este build', VIEW_W / 2, 180, 'white', 'center', 0.7);
  }

  private renderLevels(w: CanvasRenderingContext2D): void {
    this.coverTop(w, this.page ? 'assets/images/menuElements/map_2.png' : 'assets/images/menuElements/map.png');
    const list = this.pageLevels;
    const follow = this.screen === 'follow';
    const pick = this.onlinePick || follow;
    if (this.onlinePick) {
      const st = online.getState();
      const txt = st.host ? 'ELEGÍ EL NIVEL' : 'VOTÁ EL NIVEL';
      if (uiArt('pick_banner')) this.banner(w, VIEW_W - 154, 4, 150, 24, txt, 0.6);
      else drawText(w, txt, VIEW_W - 6, 6, 'black2', 'right', 1.0);
      const chosen = st.room?.level ?? 0;
      if (chosen) {
        const label = `${chosen >= 101 ? 'E' + (chosen - 100) : chosen} - ${levelTitle(chosen)}`;
        if (uiArt('pick_banner')) this.banner(w, 60, VIEW_H - 28, VIEW_W - 120, 24, label, 0.6);
        else {
          w.fillStyle = 'rgba(0,0,0,0.68)';
          w.fillRect(0, VIEW_H - 24, VIEW_W, 20);
          drawText(w, label, VIEW_W / 2, VIEW_H - 22, 'white', 'center', 0.8);
        }
      }
    }
    const late: (() => void)[] = [];
    for (let i = 0; i < NODE_POS.length; i++) {
      const [px, py] = NODE_POS[i];
      const entry = list[i];
      if (!entry && this.page) continue; // map 2 only shows the extra levels that exist
      const num = entry?.num ?? 0;
      const locked = !!entry && !this.isUnlocked(i);
      const perfect = !!num && this.perfectOf(num);
      const current = i === this.levelIndex || i === this.hoverIndex;
      // (se dibujan después de todos los nodos: si no, el botón del nodo las tapa)
      if (pick && online.getState().room) late.push(() => {
        // votos: una ficha con el color y la inicial de cada jugador que votó este nivel
        const lvl = entry?.extra ? EXTRA_FIRST + entry.extra - 1 : entry?.num;
        const room = online.getState().room!;
        const voters = lvl ? (room.votes ?? []).filter((v) => v.level === lvl) : [];
        voters.forEach((v, k) => {
          const who = room.players.find((p) => p.id === v.id);
          const vx = px + k * 15, vy = py - 17;
          const chip = uiArt('vote_chip');
          if (chip) { // ficha final teñida con el color del jugador y su inicial
            drawIconTinted(w, chip, vx - 1, vy - 2, { h: 18 }, online.playerInfo(v.id).hex);
            drawText(w, (who?.name ?? '?').slice(0, 1).toUpperCase(), vx + 8, vy + 1, 'black', 'center', 0.55);
            return;
          }
          // ficha con la cola hacia el nodo: color del jugador, borde de tinta y su inicial
          w.fillStyle = online.playerInfo(v.id).hex;
          w.strokeStyle = '#1a1818';
          w.lineWidth = 1.5;
          w.beginPath(); w.roundRect(vx - 0.5, vy - 1, 10, 11, 3); w.fill(); w.stroke();
          w.beginPath(); w.moveTo(vx + 1.5, vy + 10); w.lineTo(vx + 4.5, vy + 14); w.lineTo(vx + 7.5, vy + 10); w.fill(); w.stroke();
          drawText(w, (who?.name ?? '?').slice(0, 1).toUpperCase(), vx + 4.5, vy + 1, 'black', 'center', 0.4);
        });
        const flag = uiArt('vote_flag'), guestCur = uiArt('cursor_guest'), hostCur = uiArt('cursor_host');
        if (flag && lvl && lvl === room.level) drawIconTinted(w, flag, px + 30, py - 20, { h: 22 }, '#fff602'); // nivel elegido
        if (follow && i === this.levelIndex && hostCur) drawIcon(w, hostCur, px + 26, py + 18, { h: 20 }); // cursor del anfitrión
        if (follow && i === this.followVote && guestCur) { // mi cursor de voto, con mi color
          drawIconTinted(w, guestCur, px + 6, py + 20, { h: 18 }, online.playerInfo(online.getState().you).hex);
        } else
        if (follow && i === this.followVote) {   // mi cursor de voto
          w.strokeStyle = online.playerInfo(online.getState().you).hex;
          w.lineWidth = 2;
          w.strokeRect(px - 3, py - 3, 46, 36);
        }
      });
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
      const lockArt = locked && pick ? uiArt('level_lock') : null;
      if (lockArt) drawIcon(w, lockArt, px + f.sw / 2 - 6, py + f.sh / 2 - 9, { h: 16 });
      if (i === this.levelIndex) {
        // ARROW (anchor 20,30) at node + (20,10), bobbing up to 6 px, gliding from the previous node
        const a = frameOf('ARROW', 0);
        // yoyo interpolation (mode 2) of 0.8 s per full cycle, easeInOutSin, from +(0,0) to +(0,-6)
        const ph = (this.t % ARROW_BOB) / ARROW_BOB, kb = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        const bob = Math.round(((1 - Math.cos(Math.PI * kb)) / 2) * 6);
        const [fx, fy] = NODE_POS[this.arrowFrom] ?? NODE_POS[i];
        const k = this.arrowT / ARROW_GLIDE, e = (1 - Math.cos(Math.PI * k)) / 2; // easeInOutSin
        const ax = Math.round(fx + (px - fx) * e), ay = Math.round(fy + (py - fy) * e);
        if (a) w.drawImage(a.image, a.sx, a.sy, a.sw, a.sh, ax + 20 - 20, ay + 10 - 30 - bob, a.sw, a.sh);
      }
    }
    for (const f of late) f();
    this.renderPageArrow(w);
    if (!follow) this.renderInfoBar(w);
    if (pick) this.renderOnlineRoster(w);
    if (this.onlinePick) {
      const err = online.getState().error;
      if (err && uiArt('pick_banner')) this.banner(w, 40, 30, VIEW_W - 80, 22, err.slice(0, 64), 0.45, 'error');
      else if (err) {
        w.fillStyle = 'rgba(120,10,10,0.85)';
        w.fillRect(0, 28, VIEW_W, 16);
        drawText(w, err.slice(0, 64), VIEW_W / 2, 30, 'white', 'center', 0.55);
      }
    }
  }

  /** Cartel inferior para el anfitrión durante la etapa de menús: todos lo están mirando. */
  private renderBrowseBanner(w: CanvasRenderingContext2D): void {
    if (!this.browseStage() || !online.getState().host) return;
    const y = VIEW_H - 14;
    if (uiArt('pick_banner')) { this.bottomBanner(w, this.screen === 'menu', 'TODOS TE ESTÁN MIRANDO\nEsc: volver a la sala'); return; }
    w.fillStyle = 'rgba(0,0,0,0.7)';
    w.fillRect(0, y, VIEW_W, 14);
    drawText(w, 'TODOS TE ESTÁN MIRANDO  -  Esc: volver a la sala', VIEW_W / 2, y + 1, 'white', 'center', 0.5);
  }

  /** Cartel del invitado: sigue al anfitrión y vota con su propio cursor. */
  private renderFollowBanner(w: CanvasRenderingContext2D): void {
    const st = online.getState();
    const host = st.room?.players.find((p) => p.host);
    const hm = st.menu;
    const lost = !!host && !host.online;
    const lines: string[] = [];
    if (lost) lines.push('El anfitrión perdió la conexión, esperando...');
    else if (this.leaveArm > 0) lines.push('Apretá Esc de nuevo para salir de la sala');
    else if (hm?.s === 'levels') {
      const e = this.pageLevels[this.followVote];
      lines.push(`Mirás a ${(host?.name ?? 'el anfitrión').slice(0, 10)}. Votás: ${e ? e.label.slice(0, 18) : '-'} (flechas+Enter)`);
    } else lines.push(`Mirás a ${(host?.name ?? 'el anfitrión').slice(0, 10)}. Él elige el nivel y empieza.`);
    const y = VIEW_H - 14;
    if (uiArt('pick_banner')) { this.bottomBanner(w, hm?.s !== 'levels', lines[0].slice(0, 70).replace('. ', '.\n'), lost || this.leaveArm > 0 ? 'error' : undefined); return; }
    w.fillStyle = lost || this.leaveArm > 0 ? 'rgba(120,10,10,0.85)' : 'rgba(0,0,0,0.7)';
    w.fillRect(0, y, VIEW_W, 14);
    drawText(w, lines[0].slice(0, 70), VIEW_W / 2, y + 1, 'white', 'center', 0.5);
  }

  /** Coop: durante la elección de nivel, arriba a la izquierda, quiénes están conectados. */
  private renderOnlineRoster(w: CanvasRenderingContext2D): void {
    const room = online.getState().room;
    if (!room) return;
    const players = room.players.filter((p) => p.online);
    if (!players.length) return;
    const scale = 0.5;
    const labels = players.map((p) => (p.name || 'Xa').slice(0, 10));
    const head = frameOf('AVATAR_HEAD', 0), plate = uiArt('roster_plate'), flag = uiArt('host_flag');
    if (plate) {
      // arte final: una placa 9 cortes por jugador (el círculo de la cabecita queda en el corte izquierdo)
      const h = 26, k = h / plate.naturalHeight, pitch = h + 2;
      players.forEach((p, i) => {
        const y = 4 + i * pitch, nw = Math.round(lineWidth(labels[i], 'black') * scale);
        const pw = Math.max(86, 33 + nw + (p.host ? 22 : 8));
        draw9(w, plate, 4, y, pw, h, [50, 50, 50, 135], k);
        const hex = online.playerInfo(p.id).hex ?? '#ffffff';
        if (head) drawTinted(w, head, 4 + 13.5 - 7.5, y + 13 - 5.5, 1, hex, p.host ? 0 : 0.8, 0.34); // anfitrión: cabecita original
        drawText(w, labels[i], 4 + 31, y + 6, 'black', 'left', scale);
        if (p.host && flag) drawIcon(w, flag, 4 + 33 + nw + 3, y + 5, { h: 15 });
      });
      return;
    }
    const widest = Math.max(...labels.map((l) => lineWidth(l, 'black') * scale));
    const rowH = 17;
    const pw = Math.min(VIEW_W - 8, Math.round(widest) + 52);
    const ph = players.length * rowH + 6;
    // plaque de papel como las del HUD, con borde de tinta
    w.fillStyle = 'rgba(0,0,0,0.3)';
    w.beginPath(); w.roundRect(5, 6, pw, ph, 6); w.fill();
    w.fillStyle = '#e2d5ae';
    w.strokeStyle = '#1a1818';
    w.lineWidth = 2;
    w.beginPath(); w.roundRect(4, 4, pw, ph, 6); w.fill(); w.stroke();
    players.forEach((p, i) => {
      const y = 7 + i * rowH, hex = online.playerInfo(p.id).hex ?? '#ffffff';
      if (head) drawTinted(w, head, 9, y, 1, hex, p.host ? 0 : 0.8, 0.42);
      drawText(w, labels[i], 31, y + 1, 'black', 'left', scale);
      if (p.host) { // corona del anfitrión
        const cx = 31 + Math.round(lineWidth(labels[i], 'black') * scale) + 5, cy = y + 4;
        w.fillStyle = '#fff602';
        w.beginPath(); w.moveTo(cx, cy + 9); w.lineTo(cx - 1, cy + 2); w.lineTo(cx + 3, cy + 5); w.lineTo(cx + 6, cy); w.lineTo(cx + 9, cy + 5); w.lineTo(cx + 13, cy + 2); w.lineTo(cx + 12, cy + 9); w.closePath();
        w.fill(); w.stroke();
      }
    });
  }

  /** Cartel de papel con marco dorado (pick_banner, 9 cortes) y texto centrado. */
  /** Cartel inferior de la etapa de menús. En el menú principal va a la izquierda en dos renglones para no tapar
   *  SALIR; en el mapa, a lo ancho. */
  private bottomBanner(w: CanvasRenderingContext2D, side: boolean, text: string, tone?: 'error'): void {
    const lines = side ? text.split('\n') : [text.replace('\n', '  -  ')];
    const bw = side ? 216 : VIEW_W - 80, bh = side ? 38 : 20;
    this.banner(w, side ? 6 : 40, VIEW_H - bh - 4, bw, bh, lines.join('\n'), 0.42, tone);
  }

  /** Cartel pick_banner (9 cortes) con letra negra del juego; tone 'error' lo tiñe de rojo con letra blanca.
   *  Se dibuja en el pase de pantalla (overlay) para que el arte y la letra queden nítidos a cualquier tamaño. */
  private banner(_w: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number, text: string, scale: number, tone?: 'error'): void {
    const im = uiArt('pick_banner');
    if (!im) return;
    this.overlay.push((c) => {
      c.save();
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      if (tone === 'error') c.filter = 'saturate(6) hue-rotate(-50deg) brightness(0.68)'; // papel crema -> rojo
      draw9(c, im, x, y, bw, bh, [70, 70, 70, 70], bh / im.naturalHeight);
      c.filter = 'none';
      // bloque de líneas centrado (celda de 30 px, renglones cada 18 px), un pelo arriba: los glifos se apoyan abajo
      const font = tone === 'error' && 'filter' in c ? 'white' : 'black'; // sin ctx.filter el cartel queda crema
      const n = text.split('\n').length;
      scale = Math.min(scale, (bw - 22) / Math.max(...text.split('\n').map((l) => lineWidth(l, font)))); // que entre
      drawText(c, text, x + bw / 2, y + bh / 2 - (30 + (n - 1) * 18) * scale / 2 - 0.5, font, 'center', scale);
      c.restore();
    });
  }

  /** Mod: arrow on the map edge to switch between the original map and map 2 (the original ARROW sprite turned
   *  sideways, bobbing like the node arrow). */
  private renderPageArrow(w: CanvasRenderingContext2D): void {
    const a = frameOf('ARROW', 0);
    if (!a) return;
    const [ax, ay] = PAGE_ARROWS[this.page];
    const ph = (this.t % ARROW_BOB) / ARROW_BOB, kb = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    const bob = ((1 - Math.cos(Math.PI * kb)) / 2) * 6 * (this.page ? -1 : 1);
    w.save();
    w.translate(Math.round(ax + bob), ay);
    w.rotate(this.page ? Math.PI / 2 : -Math.PI / 2);
    if (this.pageArrowHover()) w.scale(1.15, 1.15);
    w.drawImage(a.image, a.sx, a.sy, a.sw, a.sh, -a.sw / 2, -a.sh / 2, a.sw, a.sh);
    w.restore();
  }

  /** ButtonInformation: info_map.png bar slid up from the bottom (easeInOutQuad, 0.3 s) showing the selected
   *  level's number, cows x / y, coin %, title and 6-digit score, all in the black game font (font 0). */
  private renderInfoBar(w: CanvasRenderingContext2D): void {
    const bar = img('assets/images/menuElements/info_map.png');
    const entry = this.pageLevels[this.infoIndex >= 0 ? this.infoIndex : this.levelIndex];
    if (!bar || !entry) return;
    const k = Math.min(1, this.infoT / 0.3);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const top = VIEW_H - 60 + Math.round((1 - e) * 60);
    w.drawImage(bar, 0, top);
    const num = entry.num;
    const prog = num ? this.state.progress[num] : undefined;
    const totalCows = prog?.totalCows ?? (num ? this.totalCowsOf(num, entry.path) : 0);
    const pct = levelCoinPct(prog);
    const score = String(prog?.score ?? 0).padStart(6, '0');
    const c = (t: string, x: number, y: number) => drawText(w, t, x, top + y - TEXT_VC, 'black', 'center');
    c(entry.extra ? `E${entry.extra}` : num ? String(num) : '-', 96, 30);
    c(String(prog?.cows ?? 0), 165, 30);
    c(String(totalCows), 197, 30);
    c(String(pct), 273, 30);
    c(num && !entry.extra ? (LEVEL_TITLES[num - 1] ?? entry.label) : entry.label, 257, 11);
    c(score, 448, 30);
  }

  /** Cow count of a level, read once from its TMX, so the bar shows "0 / N" before the level is played. */
  private totalCowsOf(num: number, path: string): number {
    if (this.cowCache[num] === undefined) {
      this.cowCache[num] = 0;
      void loadText(path).then((t) => { this.cowCache[num] = (t.match(/type="Cow"/g) ?? []).length; }).catch(() => {});
    }
    return this.cowCache[num];
  }

  private renderFull(w: CanvasRenderingContext2D, path: string, keyAfter = 0.3): void {
    this.cover(w, path);
    if (this.t > keyAfter) this.drawPressAnyKey(w);
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
    const ex = this.introExtra;
    const prevX = img('assets/images/menuElements/preview_extra.jpg');
    if (ex && prevX) w.drawImage(prevX, 0, (ex - 1) * 115, 512, 115, 0, 128, 512, 115);
    else if (prev && n >= 1 && n <= LEVEL_COUNT) {
      const sx = n <= 8 ? 0 : 512, sy = ((n - 1) % 8) * 115;
      w.drawImage(prev, sx, sy, 512, 115, 0, 128, 512, 115);
    }
    const mask = img('assets/lang/images/intros/fondo_niveles.png');
    if (mask) w.drawImage(mask, 0, 0, 512, 384, 0, 0, 512, 384);
    const desc = ex ? EXTRA[ex - 1].desc : n ? LANG.descriptions[n - 1] ?? '' : '';
    if (desc) {
      const lines = desc.split('\n').length;
      drawText(w, desc, 256, Math.round(57 - (lines * LINE_H) / 2), 'black', 'center');
    }
    if (ex) drawText(w, `Extra ${ex}`, 425, 212, 'white', 'left');
    else if (n) drawText(w, LANG.ids[n - 1] ?? `Nivel ${n}`, 425, 212, 'white', 'left');
    drawText(w, this.introLabel, 256, 256, 'black2', 'center');
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
        this.scenario?.dispose();
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
