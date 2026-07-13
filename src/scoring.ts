import type { Guess, RoundTarget } from "./types";

export const MAX_SCORE = 5000;
export const ROUNDS_PER_RUN = 5;

/** Multiplier per zoom-out step. Step 0 = tightest crop. */
export const ZOOM_MULTIPLIERS = [1.0, 0.75, 0.5];
/** Fraction of the cell shown at each zoom step. */
export const ZOOM_CROPS = [0.4, 0.65, 1.0];

export function cellDistance(target: RoundTarget, guess: Guess): number {
  if (target.areaId !== guess.areaId) return Infinity;
  const dx = target.cell.x - guess.cell.x;
  const dy = target.cell.y - guess.cell.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Exact cell = full score. Falls off exponentially with distance
 * (half score at ~4 cells). Wrong area = 0.
 */
export function scoreRound(target: RoundTarget, guess: Guess, zoomStep: number): number {
  const d = cellDistance(target, guess);
  if (!isFinite(d)) return 0;
  const mult = ZOOM_MULTIPLIERS[Math.min(zoomStep, ZOOM_MULTIPLIERS.length - 1)];
  return Math.round(MAX_SCORE * mult * Math.exp(-d / 5.77)); // exp(-4/5.77) ≈ 0.5
}

export function scoreRank(total: number): string {
  const max = MAX_SCORE * ROUNDS_PER_RUN;
  const pct = total / max;
  if (pct >= 0.95) return "Galactic Cartographer";
  if (pct >= 0.8) return "Chozo Scholar";
  if (pct >= 0.6) return "Seasoned Bounty Hunter";
  if (pct >= 0.4) return "Rookie Explorer";
  if (pct >= 0.2) return "Lost in Maridia";
  return "Space Pirate Cannon Fodder";
}
