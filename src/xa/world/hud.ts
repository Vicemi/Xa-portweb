// HUD: original Xa HUD. Component positions come from Hud::Hud in xa.exe (see MODLOG), the pixels from
// the user's own items_tile.png / hud_message_back.png, and numbers from the bitmap font (GameFont 0 =
// fuente_negra, black, 30px grid).
import { drawTinted, frameOf } from '../core/sprites';
import { img } from '../core/assets';
import { drawLine, drawText, lineWidth } from '../core/font';
import { draw9, drawIcon, uiArt, preloadUiArt } from '../core/nineslice';
import { online } from '../online/session';

preloadUiArt();
import { VIEW_W } from './camera';
import type { HeroState } from './state';
import type { PlayerRuntime } from './player';

const pad = (n: number, len: number) => String(Math.max(0, n)).padStart(len, '0');

/** Coop: quién juega y cuál es el jugador de esta pestaña (para la fila de amigos y su energía). */
export interface HudCoop {
  players: PlayerRuntime[];
  local: PlayerRuntime;
}

// Coop: fila de amigos arriba a la izquierda (cabecita + nombre + vidas), una por jugador.
const CHIP_X = 2;
const CHIP_Y = 2;
const CHIP_W = 56;
const CHIP_H = 32;

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

  render(ctx: CanvasRenderingContext2D, s: HeroState, coop?: HudCoop): void {
    const me = coop?.local;
    const energy = me ? me.energy : s.energy;
    const cereals = me ? me.cereals : s.cereals;
    const power = me ? me.power : s.power;
    const powerT = me ? me.powerT : s.powerT;
    // ---- top bar ----
    if (coop) this.renderFriends(ctx, coop);
    else {
      this.blit(ctx, 'AVATAR', 7, 13);                          // Xa head + "x"
      drawLine(ctx, pad(s.lives, 2), 66, 10, 'black', 'left', 1);
    }
    // Hud::render: ENERGY_BAR frame = energy - 1
    if (energy !== this.lastEnergy) {
      // Hud::setEnergy → initEnergyLoseDo: the lost chunk is drawn with ENERGY_BAR_LOSE and shrinks over 1 s
      if (this.lastEnergy >= 0 && energy < this.lastEnergy) this.lose = { from: energy, w: (this.lastEnergy - energy) * 4 + 2, t: 1 };
      else this.lose = null;
      this.lastEnergy = energy;
    }
    const barX = this.coopEnergyX(coop), barY = coop ? CHIP_Y + 45 : 48; // coop: debajo del nombre
    if (energy > 0) this.blit(ctx, 'ENERGY_BAR', barX, barY, Math.max(0, Math.min(9, energy - 1)));
    if (this.lose) {
      const f = frameOf('ENERGY_BAR_LOSE', 0);
      const x0 = this.lose.from * 4 + 2, w = Math.round(this.lose.w * this.lose.t);
      if (f && w > 0) ctx.drawImage(f.image, f.sx + x0, f.sy, Math.min(w, f.sw - x0), f.sh, barX + x0, barY, Math.min(w, f.sw - x0), f.sh);
    }
    // Hud::setDouble: the power-up plays DOUBLE_JUMP_HUD (8 frames x 3 ticks) and rests on its last frame.
    // Coop: the friends row takes the top-left, so these two indicators drop to the bottom-left corner.
    const djX = coop ? 8 : 100, djY = coop ? 282 : 8;
    if (cereals > 0) {
      if (this.doubleT < 0) this.doubleT = 0;
      this.blit(ctx, 'DOUBLE_JUMP_HUD', djX, djY, Math.min(7, Math.floor(this.doubleT / 0.1)));
    } else {
      this.doubleT = -1;
      this.blit(ctx, 'DOUBLE_JUMP_NONE', djX, djY);
    }
    if (power) this.renderPower(ctx, power, powerT, coop ? 72 : 100, coop ? 282 : 60);
    this.blit(ctx, 'BACK_POINTS', 226, 7);
    drawLine(ctx, 'Puntos', 271, 10, 'black', 'center', 1);
    drawLine(ctx, pad(s.score, 6), 271, 25, 'black', 'center', 1);
    this.blit(ctx, 'COINS', 323, 12);
    drawLine(ctx, pad(s.coinPercentage(), 3), 369, 8, 'black', 'center', 1); // Hud::setCoins: coin %, 3 digits
    this.blit(ctx, 'COW', 410, 10);
    drawLine(ctx, pad(s.cows, 2), 450, 10, 'black', 'left', 1);
    drawLine(ctx, pad(s.totalCows, 2), 480, 10, 'black', 'left', 1);
    // Hud::start: the key counter is only shown from level 14 on (the levels with doors), even at 0
    if (s.keysHud) {
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

  /** Mod (extra levels only): health bar of the boss being fought, with the SVNZ life bar art — the frame of
   *  hud/bars.png (168x12, inner 128x7 at 20,3) filled with the green line of hud/fullBars.png — scaled 1.5x at the
   *  bottom centre, the boss name above it. A yellow chunk shows the life just lost, shrinking like Xa's bar. */
  renderBossBar(ctx: CanvasRenderingContext2D, b: { name: string; lives: number; max: number }, dt: number): void {
    const frame = img('assets/svnz/hud/bars.png'), fill = img('assets/svnz/hud/fullBars.png');
    if (!frame || !fill) return;
    const k = 1.5, x = Math.round(VIEW_W / 2 - 84 * k), y = 356;
    const ratio = Math.max(0, Math.min(1, b.lives / b.max));
    if (this.bossShown < ratio || this.bossShown > 1) this.bossShown = ratio;
    else this.bossShown = Math.max(ratio, this.bossShown - dt * 0.6);
    ctx.drawImage(frame, 0, 0, 168, 12, x, y, 168 * k, 12 * k);
    const lag = Math.round(128 * this.bossShown), now = Math.round(128 * ratio);
    if (lag > now) ctx.drawImage(fill, 0, 27, lag, 7, x + 20 * k, y + 3 * k, lag * k, 7 * k);
    if (now > 0) ctx.drawImage(fill, 0, 1, now, 7, x + 20 * k, y + 3 * k, now * k, 7 * k);
    drawLine(ctx, b.name, VIEW_W / 2, y - 22, 'white', 'center', 1);
  }
  private bossShown = 2;

  /** Mod power-up: paper plaque (like the score one) with the item icon and, under it, the time left drawn with the
   *  game's own ENERGY_BAR frames (10 steps, green to red). The whole plaque blinks during the last 3 s. */
  private renderPower(ctx: CanvasRenderingContext2D, power: string, powerT: number, x: number, y: number): void {
    const plate = uiArt('powerup_plate'), frame = uiArt('powerbar_frame');
    const fill = uiArt(powerT <= 3 ? 'powerbar_fill_warn' : 'powerbar_fill'), f = frameOf(power, 0);
    if (plate && frame && fill && f) {
      // arte final: placa 9 cortes + marco de barra 9 cortes; el relleno se recorta (no se estira) a lo que queda
      const W = 96, H = 34, k = H / plate.naturalHeight;
      ctx.save();
      if (powerT <= 3 && Math.floor(powerT * 4) % 2) ctx.globalAlpha = 0.4;
      draw9(ctx, plate, x, y, W, H, [38, 50, 38, 100], k);
      const ik = 18 / f.sh, iw = f.sw * ik; // el ícono entra en el círculo de la placa (unos 20 px)
      ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, x + 11.5 - iw / 2, y + 17 - 9, iw, 18);
      const bx = x + 28, by = y + 13, bw = 52, bh = 8;
      draw9(ctx, frame, bx, by, bw, bh, [10, 12, 10, 12], bh / frame.naturalHeight);
      const b = 1.6, ratio = Math.max(0, Math.min(1, powerT / 15));
      ctx.drawImage(fill, 0, 0, fill.naturalWidth * ratio, fill.naturalHeight, bx + b, by + b, (bw - 2 * b) * ratio, bh - 2 * b);
      ctx.restore();
      return;
    }
    const bar = frameOf('ENERGY_BAR', Math.max(0, Math.min(9, Math.ceil((powerT / 15) * 10) - 1)));
    if (!f || !bar) return;
    ctx.save();
    if (powerT <= 3 && Math.floor(powerT * 4) % 2) ctx.globalAlpha = 0.4;
    this.plaque(ctx, x, y, 62, 50, '#fff602');
    const k = 0.72, w = Math.round(f.sw * k), h = Math.round(f.sh * k);
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, x + Math.round((62 - w) / 2), y + 4, w, h);
    ctx.drawImage(bar.image, bar.sx, bar.sy, bar.sw, bar.sh, x + 9, y + 36, bar.sw, bar.sh);
    ctx.restore();
  }

  /** Cream paper plaque with the game's ink outline (colours of info_map.png / hud_message_back.png). */
  private plaque(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, edge?: string): void {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.roundRect(x + 1, y + 2, w, h, 6); ctx.fill();
    ctx.fillStyle = '#e2d5ae';
    ctx.strokeStyle = '#1a1818';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
    if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x + 2.5, y + 2.5, w - 5, h - 5, 4); ctx.stroke(); }
  }

  /** Coop: x de la barra de energía, debajo de la cabecita del jugador de esta pestaña. */
  private coopEnergyX(coop?: HudCoop): number {
    if (!coop) return 8;
    return CHIP_X + Math.max(0, coop.players.indexOf(coop.local)) * CHIP_W;
  }

  /** Coop: una ficha por amigo — cabecita de Xa con su color, apodo (máx. 10) y vidas. */
  private renderFriends(ctx: CanvasRenderingContext2D, coop: HudCoop): void {
    const plate = uiArt('friend_plate'), heart = uiArt('heart'), flag = uiArt('host_flag'), down = uiArt('down_badge');
    const hostId = online.getState().room?.hostId ?? -1;
    coop.players.forEach((p, i) => {
      const x = CHIP_X + i * CHIP_W;
      const me = p === coop.local;
      const head = frameOf('AVATAR_HEAD', 0), hex = p.hex ?? '#ffffff';
      if (plate && heart) {
        // arte final: placa 9 cortes (la ranura cuadrada de la cabecita queda en el corte izquierdo, sin deformarse)
        const w = CHIP_W - 2, h = 27;
        ctx.save();
        if (p.eliminated) ctx.globalAlpha = 0.65;
        draw9(ctx, plate, x, CHIP_Y, w, h, [28, 40, 28, 100], h / plate.naturalHeight);
        if (head) drawTinted(ctx, head, x + 5, CHIP_Y + 6, 1, hex, 0.75, 0.42);
        if (p.eliminated && down) drawIcon(ctx, down, x + 5, CHIP_Y + 5, { h: 17 });
        drawIcon(ctx, heart, x + 27, CHIP_Y + 9, { h: 8 });
        drawLine(ctx, String(Math.max(0, p.lives)), x + 36, CHIP_Y + 3, 'black', 'left', 0.7);
        ctx.restore();
        if (me) { // el que juega en esta pestaña: contorno amarillo alrededor de la placa
          ctx.strokeStyle = '#fff602'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect(x - 0.5, CHIP_Y - 0.5, w + 1, h + 1, 6); ctx.stroke();
        }
        if (p.id === hostId && flag) drawIcon(ctx, flag, x + w - 14, CHIP_Y - 5, { w: 14 });
        // nombre debajo de la placa (no entra dentro), con el color del héroe en el trazo
        let name = p.name.slice(0, 10) || 'Xa';
        while (name.length > 1 && lineWidth(name, 'white') * 0.4 > CHIP_W - 4) name = name.slice(0, -1);
        drawLine(ctx, name, x + 2, CHIP_Y + h + 1, 'white', 'left', 0.4);
        return;
      }
      this.plaque(ctx, x, CHIP_Y, CHIP_W - 4, CHIP_H, me ? '#fff602' : undefined);
      ctx.fillStyle = hex; // the hero colour as a rounded stripe along the bottom edge
      ctx.beginPath(); ctx.roundRect(x + 4, CHIP_Y + CHIP_H - 6, CHIP_W - 12, 3, 1.5); ctx.fill();
      ctx.strokeStyle = '#1a1818'; ctx.lineWidth = 1; ctx.stroke();
      if (head) drawTinted(ctx, head, x + 4, CHIP_Y + 2, 1, hex, 0.7, 0.5);
      drawLine(ctx, 'x' + Math.max(0, p.lives), x + 27, CHIP_Y + 3, 'black', 'left', 0.5);
      drawLine(ctx, p.name.slice(0, 10) || 'Xa', x + 5, CHIP_Y + 16, 'black', 'left', 0.4);
    });
  }

  /** Draw a HUD image-map component at a top-left position (extracted anchors are unreliable → blit raw). */
  private blit(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, frameIndex = 0): void {
    const f = frameOf(name, frameIndex);
    if (!f) return;
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, Math.round(x), Math.round(y), f.sw, f.sh);
  }
}
