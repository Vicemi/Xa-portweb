// HeroState equivalent: persistent run state (lives, energy, score, items, power-ups, progress).
export const MAX_ENERGY = 10;
export const START_LIVES = 3;

export interface LevelProgress { cows: number; totalCows: number; coins: number; totalCoins: number; score: number; done: boolean }

export class HeroState {
  lives = START_LIVES;
  energy = MAX_ENERGY;
  score = 0;
  coins = 0;
  cows = 0;
  totalCows = 0;
  totalCoinsInLevel = 0;
  /** jump power-ups collected (index into VELOCITY_JUMP) */
  heros = 0;
  /** double-jump power-ups (index into VELOCITY_DOUBLE_JUMP; 0 = no double jump) */
  cereals = 0;
  keys: string[] = [];
  actualLevel = 1;
  lastPlayedLevel = 1;
  highScore = 0;
  progress: Record<number, LevelProgress> = {};

  reset(): void {
    this.lives = START_LIVES;
    this.energy = MAX_ENERGY;
    this.score = 0;
    this.coins = 0;
    this.cows = 0;
    this.heros = 0;
    this.cereals = 0;
    this.keys = [];
  }

  startStage(level: number, totalCows: number, totalCoins: number): void {
    this.actualLevel = level;
    this.lastPlayedLevel = level;
    this.cows = 0;
    this.coins = 0;
    this.totalCows = totalCows;
    this.totalCoinsInLevel = totalCoins;
    this.energy = MAX_ENERGY;
    this.keys = [];
  }

  addPoints(n: number): void {
    this.score += n;
    if (this.score > this.highScore) this.highScore = this.score;
  }
  subEnergy(n: number): void { this.energy = Math.max(0, this.energy - n); }
  addEnergy(n: number): void { this.energy = Math.min(MAX_ENERGY, this.energy + n); }
  coinPercentage(): number { return this.totalCoinsInLevel ? Math.floor((this.coins * 100) / this.totalCoinsInLevel) : 0; }

  save(): void {
    try {
      localStorage.setItem('xa-save', JSON.stringify({ highScore: this.highScore, progress: this.progress, lastPlayedLevel: this.lastPlayedLevel }));
    } catch { /* storage unavailable */ }
  }
  load(): void {
    try {
      const s = JSON.parse(localStorage.getItem('xa-save') ?? 'null');
      if (s) Object.assign(this, { highScore: s.highScore ?? 0, progress: s.progress ?? {}, lastPlayedLevel: s.lastPlayedLevel ?? 1 });
    } catch { /* ignore */ }
  }
}
