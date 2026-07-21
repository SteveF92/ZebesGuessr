import type { Cell } from '../../types';
import { S, type MapPalette } from './constants';

/* The reveal/selection visual language: scan brackets, pulse rings, the ZM
 * dot trail, and the Fusion-style target indicator. All pure canvas painters
 * in logical tile units — GuessMap's draw() composes them per frame. */

/** Prime scan-visor brackets: four corner Ls around a cell, in place of a
 *  full box — the same motif as the tile viewer's frame corners. */
export function brackets(ctx: CanvasRenderingContext2D, tile: Cell, color: string, lw: number, outlineColor: string | null) {
  const x = tile.x * S + 1;
  const y = tile.y * S + 1;
  const size = S - 2;
  const leg = 5;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x, y + leg);
    ctx.lineTo(x, y);
    ctx.lineTo(x + leg, y);
    ctx.moveTo(x + size - leg, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size, y + leg);
    ctx.moveTo(x + size, y + size - leg);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x + size - leg, y + size);
    ctx.moveTo(x + leg, y + size);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x, y + size - leg);
  };
  if (outlineColor) {
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = lw + 2;
    path();
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  path();
  ctx.stroke();
}

/** One-shot expanding ring centered on a cell; p in (0,1) — no-op outside. */
export function ring(ctx: CanvasRenderingContext2D, tile: Cell, p: number, color: string) {
  if (p <= 0 || p >= 1) return;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 1 - p;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc((tile.x + 0.5) * S, (tile.y + 0.5) * S, S * (0.6 + p * 1.6), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** A single trail dot — shared by the origin anchor and the traced line. */
export function trailDot(ctx: CanvasRenderingContext2D, COL: MapPalette, px: number, py: number, half: number) {
  ctx.fillStyle = COL.trailOutline;
  ctx.fillRect(px - half - 1, py - half - 1, half * 2 + 2, half * 2 + 2);
  ctx.fillStyle = COL.trailDot;
  ctx.fillRect(px - half, py - half, half * 2, half * 2);
}

/** Zero Mission-style trail: a run of thrown dots along the guess→target
 *  path (no solid line), with a larger head dot leading while it traces. */
export function dotTrail(ctx: CanvasRenderingContext2D, COL: MapPalette, gx: number, gy: number, tx: number, ty: number, prog: number) {
  const dist = Math.hypot(tx - gx, ty - gy);
  const ux = (tx - gx) / dist;
  const uy = (ty - gy) / dist;
  const reach = prog * dist;
  const head = Math.min(reach, dist - 8);
  // dots start clear of the guess brackets and stop short of the target dot
  for (let s = 8; s <= head; s += 9) trailDot(ctx, COL, gx + ux * s, gy + uy * s, 1.5);
  if (prog < 1) trailDot(ctx, COL, gx + ux * head, gy + uy * head, 2.5); // the thrown head dot
}

/** Fusion-style target indicator: a sun-yellow dot in a red dashed ring
 *  (dark under-dash so it reads on the pink rooms), with a blinking TARGET
 *  callout pointing at it. */
export function targetIndicator(ctx: CanvasRenderingContext2D, COL: MapPalette, tile: Cell, blink: boolean) {
  const cx = (tile.x + 0.5) * S;
  const cy = (tile.y + 0.5) * S;
  // the dot + its ticking ring (the dash pattern jumps with each blink)
  ctx.fillStyle = COL.trailOutline;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COL.trailDot;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
  const ringDash = (color: string, lw: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash([3, 2.5]);
    ctx.lineDashOffset = blink ? 2.75 : 0;
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    ctx.stroke();
  };
  ringDash('#04060f', 3.5); // dark under-dash: contrast against room pink
  ringDash(COL.targetRing, 1.5);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  // The TARGET callout itself is a DOM overlay (see calloutPos) — canvas
  // text turns to mush when the canvas is displayed far below its backing
  // resolution, while DOM text rasterizes at screen resolution.
}
