// AudioLibrary equivalent: sound ids -> the user's own .ogg files (names from xa.exe's AudioLibrary table).
import { loadArrayBuffer } from './assets';
const FX_DIR = 'assets/audio/fx/win/';
const MUSIC_DIR = 'assets/audio/music/win/';

const FX: Record<string, string> = {
  BULLET_CANNON: 'bullet_cannon', BULLET_WALL_1: 'bullet_wall_1', BULLET_WALL_2: 'bullet_wall_2',
  BULLET_XA: 'bullet', END_LEVEL: 'end_level', ENEMY_DEATH: 'enemy_death', ENEMY_JUMP: 'jump_enemy',
  HERO_JUMP: 'jump_hero', ENEMY_HIT_1: 'm_1', ENEMY_HIT_2: 'm_2', ENEMY_HIT_3: 'm_3', ENEMY_HIT_4: 'm_4',
  ENEMY_HIT_5: 'm_5', ENEMY_HIT_6: 'm_6', HERO_DEATH: 'player_death', POWERUP: 'powerup',
  HERO_DEFENSE_1: 's_1', HERO_DEFENSE_2: 's_2', HERO_HIT: 'hurt', HERO_ENERGY: 'energy',
  HERO_LIFE: 'extra_life', KEY: 'key', COW_RESCUED_1: 'gracias_01', STEP_1: 'foot_1', STEP_2: 'foot_2',
  STEP_3: 'foot_3', STEP_4: 'foot_4', STAIR_1: 'stair_1', STAIR_2: 'stair_2', DOOR_OPENED: 'door_1',
  GUILLOTINE: 'guillotina', SAVING: 'save', CLICK: 'click', DOUBLE_JUMP: 'double_jump', COIN: 'coin',
  ENTRANCE: 'init_fall', INFO: 'info', SHOOT_ENEMY: 'enemy_shot',
};

let ctx: AudioContext | null = null;
let fxGain: GainNode, musicGain: GainNode;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let music: { src: AudioBufferSourceNode; name: string } | null = null;
let currentMusic = '';
let soundOn = true;
let musicOn = true;
let soundVol = 1;
let musicVol = 1;

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    fxGain = ctx.createGain();
    musicGain = ctx.createGain();
    fxGain.gain.value = soundVol;
    musicGain.gain.value = musicVol;
    fxGain.connect(ctx.destination);
    musicGain.connect(ctx.destination);
  }
  return ctx;
}

/** Browsers only start audio after a user gesture; call from the first keydown/click. */
export function unlockAudio(): void {
  const c = ac();
  if (c.state === 'suspended') void c.resume();
}

function buffer(path: string): Promise<AudioBuffer | null> {
  let p = buffers.get(path);
  if (!p) {
    p = loadArrayBuffer(path)
      .then((b) => (b ? ac().decodeAudioData(b) : null))
      .catch(() => null);
    buffers.set(path, p);
  }
  return p;
}

export function preloadSounds(): Promise<unknown> {
  return Promise.all(Object.values(FX).map((f) => buffer(FX_DIR + f + '.ogg')));
}

export function playSound(id: string): void {
  if (!soundOn) return;
  const f = FX[id];
  if (!f) return;
  void buffer(FX_DIR + f + '.ogg').then((b) => {
    if (!b) return;
    const s = ac().createBufferSource();
    s.buffer = b;
    s.connect(fxGain);
    s.start();
  });
}

/** `file` like "xa_1.ogg" (TMX pMusic) or a bare name. */
export function setMusic(file: string): void {
  currentMusic = file.endsWith('.ogg') ? file : file + '.ogg';
}

export function playMusic(file?: string, loop = true): void {
  if (file) setMusic(file);
  stopMusic();
  if (!musicOn || !currentMusic) return;
  const name = currentMusic;
  void buffer(MUSIC_DIR + name).then((b) => {
    if (!b || currentMusic !== name || music) return;
    const s = ac().createBufferSource();
    s.buffer = b;
    s.loop = loop;
    s.connect(musicGain);
    s.start();
    music = { src: s, name };
  });
}

export function stopMusic(): void {
  if (music) {
    try { music.src.stop(); } catch { /* already stopped */ }
    music = null;
  }
}

export function setSoundEnabled(on: boolean): void { soundOn = on; }
export function setMusicEnabled(on: boolean): void { musicOn = on; if (!on) stopMusic(); }
export function isSoundEnabled(): boolean { return soundOn; }
export function isMusicEnabled(): boolean { return musicOn; }
export function setSoundVolume(v: number): void { soundVol = v; if (ctx) fxGain.gain.value = v; }
export function setMusicVolume(v: number): void { musicVol = v; if (ctx) musicGain.gain.value = v; }
export function getSoundVolume(): number { return soundVol; }
export function getMusicVolume(): number { return musicVol; }
