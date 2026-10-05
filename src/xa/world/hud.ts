// HUD: original Xa HUD. Component positions come from Hud::Hud in xa.exe (see MODLOG), the pixels from
// the user's own items_tile.png / hud_message_back.png, and numbers from the bitmap font (GameFont 0 =
// fuente_negra, black, 30px grid).
import { frameOf } from '../core/sprites';
import { drawLine, drawText } from '../core/font';
import { VIEW_W } from './camera';
import type { HeroState } from './state';

const pad = (n: number, len: number) => String(Math.max(0, n)).padStart(len, '0');

// Escape codes of the TMX sign texts, decoded exactly like the original (switch on the char after '\'):
// ! ¡  ? ¿  a/e/i/o/u → á/é/í/ó/ú (upper-case too), m/M → ñ/Ñ, n → newline, \ → backslash.
const ESCAPES: Record<string, string> = {
  '!': '¡', '?': '¿', a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', m: 'ñ', n: '\n',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', M: 'Ñ', '\\': '\\',
};
export function decodeGameText(raw: string): string {
  return raw.replace(/\\(.)/g, (m, c: string) => ESCAPES[c] ?? m);
}
const LINE_H = 18;
const SAVING_TIME = 3;
const MSG_X = VIEW_W / 2 + 24;
const MSG_Y = 80;

export class Hud {
  message = '';
  messageTime = 0;
  private savingTime = 0;
  private doubleT = -1;
  private lastEnergy = -1;
  private lose: { from: number; w: number; t: number } | null = null;

  showMessage(raw: string, seconds = 4): void {
    this.message = decodeGameText(raw);
    this.messageTime = seconds;
  }
  clearMessage(): void { this.message = ''; }
  showSaving(): void { this.savingTime = SAVING_TIME; }

  update(dt: number): void {
    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.message = '';
    }
    if (this.savingTime > 0) this.savingTime -= dt;
    if (this.lose) { this.lose.t -= dt; if (this.lose.t <= 0) this.lose = null; }
    if (this.doubleT >= 0) this.doubleT += dt;
  }

  render(ctx: CanvasRenderingContext2D, s: HeroState): void {
    // ---- top bar ----
    this.blit(ctx, 'AVATAR', 7, 13);                          // Xa head + "x"
    drawLine(ctx, pad(s.lives, 2), 66, 10, 'black', 'left', 1);
    // Hud::render: ENERGY_BAR frame = energy - 1
    if (s.energy !== this.lastEnergy) {
      // Hud::setEnergy → initEnergyLoseDo: the lost chunk is drawn with ENERGY_BAR_LOSE and shrinks over 1 s
      if (this.lastEnergy >= 0 && s.energy < this.lastEnergy) this.lose = { from: s.energy, w: (this.lastEnergy - s.energy) * 4 + 2, t: 1 };
      else this.lose = null;
      this.lastEnergy = s.energy;
    }
    if (s.energy > 0) this.blit(ctx, 'ENERGY_BAR', 8, 48, Math.max(0, Math.min(9, s.energy - 1)));
    if (this.lose) {
      const f = frameOf('ENERGY_BAR_LOSE', 0);
      const x0 = this.lose.from * 4 + 2, w = Math.round(this.lose.w * this.lose.t);
      if (f && w > 0) ctx.drawImage(f.image, f.sx + x0, f.sy, Math.min(w, f.sw - x0), f.sh, 8 + x0, 48, Math.min(w, f.sw - x0), f.sh);
    }
    // Hud::setDouble: the power-up plays DOUBLE_JUMP_HUD (8 frames x 3 ticks) and rests on its last frame
    if (s.cereals > 0) {
      if (this.doubleT < 0) this.doubleT = 0;
      this.blit(ctx, 'DOUBLE_JUMP_HUD', 100, 8, Math.min(7, Math.floor(this.doubleT / 0.1)));
    } else {
      this.doubleT = -1;
      this.blit(ctx, 'DOUBLE_JUMP_NONE', 100, 8);
    }
    this.blit(ctx, 'BACK_POINTS', 226, 7);
    drawLine(ctx, 'Puntos', 271, 10, 'black', 'center', 1);
    drawLine(ctx, pad(s.score, 6), 271, 25, 'black', 'center', 1);
    this.blit(ctx, 'COINS', 323, 12);
    drawLine(ctx, pad(s.coinPercentage(), 3), 369, 8, 'black', 'center', 1); // Hud::setCoins: coin %, 3 digits
    this.blit(ctx, 'COW', 410, 10);
    drawLine(ctx, pad(s.cows, 2), 450, 10, 'black', 'left', 1);
    drawLine(ctx, pad(s.totalCows, 2), 480, 10, 'black', 'left', 1);
    // Hud::start: the key counter is only shown from level 14 on (the levels with doors), even at 0
    if (s.actualLevel >= 14) {
      this.blit(ctx, 'KEY_SMALL', 7, 349);
      drawLine(ctx, String(s.keys.filter((k) => k === 'KEY').length), 30, 345, 'black', 'left', 1);
    }
    this.blit(ctx, 'LOGO', 448, 348);

    // ---- message balloon: BACK_HUD (anchor 280,20) inside a container at (256+24, 80); the text (font 0,
    // scale 1) is centred horizontally and vertically 5 px below the container origin (Hud::Hud). ----
    if (this.messageTime > 0 && this.message) {
      this.blit(ctx, 'BACK_HUD', MSG_X - 280, MSG_Y - 20);
      const lines = this.message.split('\n').length;
      drawText(ctx, this.message, MSG_X, Math.round(MSG_Y + 5 - (lines * LINE_H) / 2), 'black', 'center', 1);
    }

    // ---- "guardando" indicator ----
    if (this.savingTime > 0) {
      // SAVING anim: frames 0,1,2 x 6 ticks @30 fps, five times (3 s), centred at (256, 365); Hud::update hides it
      // as soon as the anim is over (no fade)
      this.blit(ctx, 'SAVING', VIEW_W / 2 - 50, 352, Math.floor((SAVING_TIME - this.savingTime) / 0.2) % 3);
    }
  }

  /** Draw a HUD image-map component at a top-left position (extracted anchors are unreliable → blit raw). */
  private blit(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, frameIndex = 0): void {
    const f = frameOf(name, frameIndex);
    if (!f) return;
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, Math.round(x), Math.round(y), f.sw, f.sh);
  }
}
