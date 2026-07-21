import type { GameData, RoundResult } from './types';
import type { Difficulty } from './scoring';
import { scoreRank } from './scoring';
import { tileUrl } from './data';
import { GAME_URL } from './share';

export interface ShareImageOpts {
  data: GameData;
  results: RoundResult[];
  total: number;
  maxTotal: number;
  difficulty: Difficulty;
  /** The run's replayable seed code, drawn under the header. */
  seedCode?: string;
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
  gold: '#ffd24d',
  bevelLight: '#ffe9a0',
  bevelDark: '#7a5200'
};

const DISPLAY = '"Super Metroid Large Alt", monospace';
const TITLE = '"Super Metroid Title", monospace';
const MONO = 'ui-monospace, "JetBrains Mono", monospace';

// Logical layout constants (pre-DPR).
const W = 560;
const PAD = 28;
// Header stack: logo 46 + game title 22 + score readout 64+14 + rank 28 +
// difficulty 22 + seed 24 + breathing room 28.
const HEADER_H = 248;
const ROW_H = 52;
const STRIP_GAP = 10;
const THUMB_GAP = 10;
const FOOTER_H = 26;

/** Draw the scorecard and resolve to a PNG Blob (or null if rendering failed). */
export async function buildShareImage(opts: ShareImageOpts): Promise<Blob | null> {
  const { data, results, total, maxTotal, difficulty, seedCode, includeThumbnails = true } = opts;
  try {
    const thumbSize = Math.floor((W - 2 * PAD - THUMB_GAP * (results.length - 1)) / results.length);
    const H = PAD + HEADER_H + results.length * ROW_H + (includeThumbnails ? STRIP_GAP + thumbSize : 0) + FOOTER_H + PAD;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(dpr, dpr);

    // Canvas text does not trigger @font-face loads — nudge the pixel fonts in first.
    try {
      await Promise.all([document.fonts.load('700 18px "Super Metroid Large Alt"'), document.fonts.load('400 34px "Super Metroid Title"')]);
      await document.fonts.ready;
    } catch {
      /* fall back to monospace rather than throw */
    }

    drawBackdrop(ctx, H);

    // ---- header ----
    let y = PAD;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';

    // ZEBESGUESSR wordmark: title-screen treatment — metallic gradient fill,
    // warm glow pass behind, hard dark drop shadow (mirrors .logo).
    ctx.font = `400 34px ${TITLE}`;
    const logoGrad = ctx.createLinearGradient(0, y, 0, y + 34);
    logoGrad.addColorStop(0, '#fff6d8');
    logoGrad.addColorStop(0.22, '#ffe9a0');
    logoGrad.addColorStop(0.42, '#ffb84d');
    logoGrad.addColorStop(0.6, '#f2701d');
    logoGrad.addColorStop(0.8, '#c22c12');
    logoGrad.addColorStop(1, '#6e1206');
    ctx.save();
    ctx.fillStyle = logoGrad;
    ctx.shadowColor = 'rgba(255,122,30,0.45)';
    ctx.shadowBlur = 16;
    ctx.fillText('ZEBESGUESSR', W / 2, y + 32);
    ctx.shadowColor = '#200602';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 3;
    ctx.fillText('ZEBESGUESSR', W / 2, y + 32);
    ctx.restore();
    y += 46;

    // which game was played, mirroring the share text's "ZebesGuessr · <title>"
    ctx.save();
    setLetterSpacing(ctx, '0.18em');
    ctx.shadowColor = 'rgba(160,248,248,0.35)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = COL.cyan;
    ctx.font = `700 12px ${DISPLAY}`;
    ctx.fillText(data.title.toUpperCase(), W / 2, y + 12);
    setLetterSpacing(ctx, '0px');
    ctx.restore();
    y += 22;

    drawScoreReadout(ctx, total, maxTotal, y);
    y += 64 + 14;

    ctx.save();
    ctx.shadowColor = 'rgba(77,255,136,0.4)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = COL.accent;
    ctx.font = `700 18px ${DISPLAY}`;
    ctx.fillText(scoreRank(total), W / 2, y + 16);
    ctx.restore();
    y += 28;

    ctx.fillStyle = COL.dim;
    ctx.font = `500 13px ${MONO}`;
    ctx.fillText(`Difficulty: ${difficulty.label}`, W / 2, y + 12);
    y += 22;

    if (seedCode) {
      ctx.save();
      ctx.shadowColor = 'rgba(160,248,248,0.35)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = COL.cyan;
      ctx.font = `500 14px ${MONO}`;
      ctx.fillText(`SEED: ${seedCode}`, W / 2, y + 14);
      ctx.restore();
    }
    // HEADER_H reserves breathing room below the seed line either way.

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

    // ===== THUMBNAIL STRIP (delete this block + thumbSize uses to remove) =====
    if (includeThumbnails) {
      const stripY = PAD + HEADER_H + results.length * ROW_H + STRIP_GAP;
      await drawThumbnailStrip(ctx, data, results, stripY, thumbSize);
    }
    // ===== END THUMBNAIL STRIP =====

    // ---- footer: where a curious friend goes ----
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.dim;
    ctx.font = `500 11px ${MONO}`;
    ctx.fillText(GAME_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, H - PAD - 8);

    drawFrame(ctx, H);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

/** letterSpacing is missing from older canvas implementations — set it only where supported. */
function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string): void {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
}

/** Deterministic PRNG so the starfield is identical on every render. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Background: dark gradient + pause-map dot grid + seeded starfield (mirrors body/.fx-grid/.stars). */
function drawBackdrop(ctx: CanvasRenderingContext2D, H: number): void {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, COL.panel);
  grad.addColorStop(1, COL.bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(96,112,255,0.16)';
  for (let gy = 13; gy < H; gy += 26) {
    for (let gx = 13; gx < W; gx += 26) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const rand = mulberry32(0x5ab35);
  const starCols = ['#7f9dff', '#4dff88', '#ffffff', '#88aabb'];
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const sy = rand() * H;
    const s = rand() < 0.15 ? 2 : 1;
    ctx.globalAlpha = 0.25 + rand() * 0.35;
    ctx.fillStyle = starCols[Math.floor(rand() * starCols.length)];
    ctx.fillRect(x, sy, s, s);
  }
  ctx.globalAlpha = 1;
}

/** SAMUS-box readout (mirrors .score-readout): SNES bevel borders around the glowing total. */
function drawScoreReadout(ctx: CanvasRenderingContext2D, total: number, maxTotal: number, y: number): void {
  const w = 240;
  const h = 64;
  const x = (W - w) / 2;

  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#231803');
  g.addColorStop(1, '#120c02');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // bevel: dark bottom/right first so the light top/left wins the corners
  ctx.fillStyle = COL.bevelDark;
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = COL.bevelLight;
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y, 2, h);

  ctx.textAlign = 'center';
  setLetterSpacing(ctx, '0.28em');
  ctx.fillStyle = COL.dim;
  ctx.font = `700 11px ${DISPLAY}`;
  ctx.fillText('SCORE', W / 2, y + 20);
  setLetterSpacing(ctx, '0px');

  const totalStr = total.toLocaleString();
  const maxStr = ` / ${maxTotal.toLocaleString()}`;
  ctx.font = `600 26px ${MONO}`;
  const w1 = ctx.measureText(totalStr).width;
  ctx.font = `500 13px ${MONO}`;
  const w2 = ctx.measureText(maxStr).width;
  const startX = W / 2 - (w1 + w2) / 2;
  const base = y + 48;

  ctx.textAlign = 'left';
  ctx.save();
  ctx.shadowColor = 'rgba(255,210,77,0.45)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = COL.gold;
  ctx.font = `600 26px ${MONO}`;
  ctx.fillText(totalStr, startX, base);
  ctx.restore();
  ctx.fillStyle = COL.dim;
  ctx.font = `500 13px ${MONO}`;
  ctx.fillText(maxStr, startX + w1, base);
  ctx.textAlign = 'center';
}

/** Card frame: hairline border + cyan HUD corner brackets (mirrors .unlock-banner-corner). */
function drawFrame(ctx: CanvasRenderingContext2D, H: number): void {
  ctx.strokeStyle = COL.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  ctx.fillStyle = 'rgba(160,248,248,0.9)';
  const l = 16; // leg length
  const t = 2; // thickness
  ctx.fillRect(0, 0, l, t);
  ctx.fillRect(0, 0, t, l);
  ctx.fillRect(W - l, 0, l, t);
  ctx.fillRect(W - t, 0, t, l);
  ctx.fillRect(0, H - t, l, t);
  ctx.fillRect(0, H - l, t, l);
  ctx.fillRect(W - l, H - t, l, t);
  ctx.fillRect(W - t, H - l, t, l);
}

// ===== THUMBNAIL STRIP helper (delete to remove the strip) =====
/** Draw the row of mystery-screen thumbnails (the target tiles) below the rounds. */
async function drawThumbnailStrip(ctx: CanvasRenderingContext2D, data: GameData, results: RoundResult[], stripY: number, size: number): Promise<void> {
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
    const x = PAD + i * (size + THUMB_GAP);
    ctx.save();
    roundRect(ctx, x, stripY, size, size, 4);
    ctx.clip();
    if (img) {
      // letterbox non-square tiles (GBA screens are 3:2) in the square slot
      const scale = size / Math.max(img.naturalWidth, img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.fillStyle = '#000';
      ctx.fillRect(x, stripY, size, size);
      ctx.drawImage(img, x + (size - dw) / 2, stripY + (size - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = COL.panel;
      ctx.fillRect(x, stripY, size, size);
    }
    ctx.restore();
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1;
    roundRect(ctx, x, stripY, size, size, 4);
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
