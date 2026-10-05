// HeroState equivalent: persistent run state (lives, energy, score, items, power-ups, progress).
export const MAX_ENERGY = 10;
export const START_LIVES = 3;

export interface LevelProgress {
  cows: number; totalCows: number; coins: number; totalCoins: number; score: number; done: boolean;
  /** best coin percentage (HeroState::getCoinPercentage), stored like the original save */
  coinPct?: number;
}

export function levelCoinPct(p: LevelProgress | undefined): number {
  if (!p) return 0;
  if (p.coinPct !== undefined) return p.coinPct;
  return p.totalCoins ? Math.floor((p.coins * 100) / p.totalCoins) : 0; // saves from older builds
}

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
  keysHud = false;          // mod: extra levels with a gate show the key counter too
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

  /**
   * HeroState::goToLevelSelect / changeStage: entering a level wipes the per-level run (keys, power-ups, coins,
   * cows, score) and tops lives back up to 3. Power-ups never carry over between levels.
   */
  beginLevel(): void {
    if (this.lives < START_LIVES) this.lives = START_LIVES;
    this.keys = [];
    this.cereals = 0;
    this.heros = 0;
    this.coins = 0;
    this.cows = 0;
    this.score = 0;
  }

  startStage(level: number, totalCows: number, totalCoins: number): void {
    this.actualLevel = level;
    this.keysHud = level >= 14;
    this.lastPlayedLevel = level;
    this.cows = 0;
    this.coins = 0;
    this.totalCows = totalCows;
    this.totalCoinsInLevel = totalCoins;
    this.energy = MAX_ENERGY;
    this.keys = [];
  }

  /** HeroState::getHighScore (+0x4): saveGame sums the best score of every level. */
  recordTotal(): number {
    let sum = 0;
    // the original 16 levels only (the map-2 extra levels keep their own scores, numbered from 101)
    for (const [n, p] of Object.entries(this.progress)) if (+n <= 16) sum += p?.score ?? 0;
    return sum;
  }
  /** HeroState::addLives caps at 99. */
  addLives(n: number): void { this.lives = Math.min(99, this.lives + n); }
  addPoints(n: number): void {
    this.score = Math.min(999999, this.score + n); // HeroState::addPoints caps at 999999
    if (this.score > this.highScore) this.highScore = this.score;
  }
  subEnergy(n: number): void { this.energy = Math.max(0, this.energy - n); }
  addEnergy(n: number): void { this.energy = Math.min(MAX_ENERGY, this.energy + n); }
  /** HeroState::saveGame keeps the BEST result of each level: max cows, max coin %, max score. */
  recordLevel(n: number): void {
    const old = this.progress[n];
    const pct = this.coinPercentage();
    const best = (a: number, b: number | undefined) => Math.max(a, b ?? 0);
    this.progress[n] = {
      cows: best(this.cows, old?.cows), totalCows: this.totalCows,
      coins: best(this.coins, old?.coins), totalCoins: this.totalCoinsInLevel,
      coinPct: best(pct, levelCoinPct(old)), score: best(this.score, old?.score), done: true,
    };
    this.save();
  }
  /** LevelSelectScreen: a level is "perfect" when every cow was rescued and 100% of its coins were taken. */
  isPerfect(n: number): boolean {
    const p = this.progress[n];
    return !!p?.done && p.cows >= p.totalCows && levelCoinPct(p) >= 100;
  }
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
