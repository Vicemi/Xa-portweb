// HUD: original Xa HUD. Component positions come from Hud::Hud in xa.exe (see MODLOG), the pixels from
// the user's own items_tile.png / hud_message_back.png, and numbers from the bitmap font (GameFont 0 =
// fuente_negra, black, 30px grid).
import { frameOf } from '../core/sprites';
import { drawLine, drawText } from '../core/font';
import { VIEW_W } from './camera';
import type { HeroState } from './state';

const pad = (n: number, len: number) => String(Math.max(0, n)).padStart(len, '0');

export class Hud {
  message = '';
  messageTime = 0;
  private savingTime = 0;

  showMessage(raw: string, seconds = 4): void {
    this.message = raw.replace(/\\!/g, '¡').replace(/\\n/g, '\n');
    this.messageTime = seconds;
  }
  clearMessage(): void { this.message = ''; }
  showSaving(): void { this.savingTime = 1.5; }

  update(dt: number): void {
    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.message = '';
    }
    if (this.savingTime > 0) this.savingTime -= dt;
  }

  render(ctx: CanvasRenderingContext2D, s: HeroState): void {
    // ---- top bar ----
    this.blit(ctx, 'AVATAR', 7, 13);                          // Xa head + "x"
    drawLine(ctx, pad(s.lives, 2), 66, 10, 'black', 'left', 1);
    this.blit(ctx, 'ENERGY_BAR', 8, 48, Math.max(0, Math.min(9, s.energy)));
    this.blit(ctx, s.cereals > 0 ? 'DOUBLE_JUMP' : 'DOUBLE_JUMP_NONE', 100, 8);
    this.blit(ctx, 'BACK_POINTS', 226, 7);
    drawLine(ctx, 'Puntos', 271, 10, 'black', 'center', 1);
    drawLine(ctx, pad(s.score, 6), 271, 25, 'black', 'center', 1);
    this.blit(ctx, 'COINS', 323, 12);
    drawLine(ctx, pad(s.coins, 3), 369, 8, 'black', 'center', 1);
    this.blit(ctx, 'COW', 410, 10);
    drawLine(ctx, pad(s.cows, 2), 450, 10, 'black', 'left', 1);
    drawLine(ctx, pad(s.totalCows, 2), 480, 10, 'black', 'left', 1);
    if (s.keys.length > 0) {
      this.blit(ctx, 'KEY_SMALL', 7, 349);
      drawLine(ctx, String(s.keys.length), 30, 345, 'black', 'left', 1);
    }
    this.blit(ctx, 'LOGO', 448, 348);

    // ---- message balloon (hud_message_back) ----
    if (this.messageTime > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.messageTime * 3);
      this.blit(ctx, 'BACK_HUD', 0, 60);
      drawText(ctx, this.message, VIEW_W / 2, 66, 'black', 'center', 0.7);
      ctx.restore();
    }

    // ---- "guardando" indicator ----
    if (this.savingTime > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.savingTime * 2);
      this.blit(ctx, 'SAVING', VIEW_W / 2 - 50, 350, Math.floor((1.5 - this.savingTime) * 3) % 3);
      ctx.restore();
    }
  }

  /** Draw a HUD image-map component at a top-left position (extracted anchors are unreliable → blit raw). */
  private blit(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, frameIndex = 0): void {
    const f = frameOf(name, frameIndex);
    if (!f) return;
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, Math.round(x), Math.round(y), f.sw, f.sh);
  }
}
