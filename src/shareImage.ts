import type { GameData, RoundResult } from './types';
import type { Difficulty } from './scoring';
import { scoreRank } from './scoring';
import { tileUrl } from './data';

export interface ShareImageOpts {
  data: GameData;
  results: RoundResult[];
  total: number;
  maxTotal: number;
  difficulty: Difficulty;
  /** Draw the row of mystery-screen thumbnails. Default true. */
  includeThumbnails?: boolean;
}

// Palette — literal hex mirrored from src/styles.css :root (canvas can't read CSS vars).
const COL = {
  bg: '#05070d',
  panel: '#0c1120',
  line: '#1c2a4a',
  text: '#cfe0ff',
  dim: 'rgba(207,224,255,0.55)',
  accent: '#4dff88',
  cyan: '#a0f8f8',
  gold: '#ffd24d'
};

const DISPLAY = '"Super Metroid Large Alt", monospace';
const MONO = 'ui-monospace, "JetBrains Mono", monospace';

// Logical layout constants (pre-DPR).
const W = 560;
const PAD = 28;
const HEADER_H = 172;
const ROW_H = 52;
const STRIP_GAP = 10;
const STRIP_H = 150;

/** Draw the scorecard and resolve to a PNG Blob (or null if rendering failed). */
export async function buildShareImage(opts: ShareImageOpts): Promise<Blob | null> {
  const { data, results, total, maxTotal, difficulty, includeThumbnails = true } = opts;
  try {
    const H = PAD + HEADER_H + results.length * ROW_H + (includeThumbnails ? STRIP_GAP + STRIP_H : 0) + PAD;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(dpr, dpr);

    // Canvas text does not trigger @font-face loads — nudge the display font in first.
    try {
      await Promise.all([document.fonts.load('700 34px "Super Metroid Large Alt"'), document.fonts.load('700 22px "Super Metroid Large Alt"')]);
      await document.fonts.ready;
    } catch {
      /* fall back to monospace rather than throw */
    }

    // ---- background ----
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, COL.panel);
    grad.addColorStop(1, COL.bg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ---- header ----
    let y = PAD + 8;
    ctx.textBaseline = 'alphabetic';

    ctx.textAlign = 'center';
    ctx.fillStyle = COL.gold;
    ctx.font = `700 24px ${DISPLAY}`;
    ctx.fillText('RUN COMPLETE', W / 2, y + 24);
    y += 48;

    ctx.fillStyle = COL.gold;
    ctx.font = `700 38px ${DISPLAY}`;
    ctx.fillText(`${total.toLocaleString()}`, W / 2, y + 34);
    ctx.fillStyle = COL.dim;
    ctx.font = `500 16px ${MONO}`;
    ctx.fillText(`/ ${maxTotal.toLocaleString()}`, W / 2, y + 56);
    y += 74;

    ctx.fillStyle = COL.accent;
    ctx.font = `700 18px ${DISPLAY}`;
    ctx.fillText(scoreRank(total), W / 2, y + 16);
    y += 26;

    ctx.fillStyle = COL.dim;
    ctx.font = `500 13px ${MONO}`;
    ctx.fillText(`Difficulty: ${difficulty.label}`, W / 2, y + 12);

    // ---- per-round rows ----
    y = PAD + HEADER_H;
    ctx.font = `500 15px ${MONO}`;
    results.forEach((r, i) => {
      const rowY = y + i * ROW_H;
      // card background
      ctx.fillStyle = COL.panel;
      ctx.strokeStyle = COL.line;
      ctx.lineWidth = 1;
      roundRect(ctx, PAD, rowY, W - 2 * PAD, ROW_H - 8, 6);
      ctx.fill();
      ctx.stroke();

      const midY = rowY + (ROW_H - 8) / 2;
      const areaLabel = data.areas.find((a) => a.id === r.target.areaId)?.name ?? r.target.areaId;

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = COL.dim;
      ctx.font = `500 14px ${MONO}`;
      ctx.fillText(`${i + 1}.`, PAD + 12, midY);
      ctx.fillStyle = COL.cyan;
      ctx.font = `500 15px ${MONO}`;
      ctx.fillText(areaLabel, PAD + 40, midY);

      const rating = Math.max(1, Math.min(5, Math.round(r.rating)));
      ctx.fillStyle = COL.gold;
      ctx.font = `500 13px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('★'.repeat(rating) + '☆'.repeat(5 - rating), W / 2 + 70, midY);

      ctx.fillStyle = COL.text;
      ctx.font = `600 15px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(r.score.toLocaleString(), W - PAD - 12, midY);
    });
    ctx.textBaseline = 'alphabetic';

    // ===== THUMBNAIL STRIP (delete this block + STRIP_* constants to remove) =====
    if (includeThumbnails) {
      const stripY = PAD + HEADER_H + results.length * ROW_H + STRIP_GAP;
      await drawThumbnailStrip(ctx, data, results, stripY);
    }
    // ===== END THUMBNAIL STRIP =====

    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

// ===== THUMBNAIL STRIP helper (delete to remove the strip) =====
/** Draw the row of mystery-screen thumbnails (the target tiles) below the rounds. */
async function drawThumbnailStrip(ctx: CanvasRenderingContext2D, data: GameData, results: RoundResult[], stripY: number): Promise<void> {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COL.dim;
  ctx.font = `500 12px ${MONO}`;
  ctx.fillText('THE SCREENS', PAD, stripY + 12);

  const n = results.length;
  const gap = 10;
  const inner = W - 2 * PAD;
  const size = Math.floor((inner - gap * (n - 1)) / n);
  const tilesY = stripY + 24;

  const imgs = await Promise.all(
    results.map(
      (r) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = tileUrl(data, r.target);
        })
    )
  );

  imgs.forEach((img, i) => {
    const x = PAD + i * (size + gap);
    ctx.save();
    roundRect(ctx, x, tilesY, size, size, 4);
    ctx.clip();
    if (img) {
      ctx.drawImage(img, x, tilesY, size, size);
    } else {
      ctx.fillStyle = COL.panel;
      ctx.fillRect(x, tilesY, size, size);
    }
    ctx.restore();
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1;
    roundRect(ctx, x, tilesY, size, size, 4);
    ctx.stroke();
  });
}
// ===== END THUMBNAIL STRIP helper =====

/** Trace a rounded rectangle path (caller fills/strokes/clips). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Trigger a browser download of a Blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
