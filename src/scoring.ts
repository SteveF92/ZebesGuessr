import type { Guess, RoundTarget } from "./types";

export const MAX_SCORE = 5000;
export const ROUNDS_PER_RUN = 5;

/**
 * Difficulty presets — tweak these freely to find the right feel.
 * Each tier draws round targets from a band of per-tile ratings
 * (1 = unmissable landmark … 5 = anonymous corridor). All bands include
 * the default rating (3), so unrated data behaves the same on every tier.
 * `hint`: short blurb shown under the label on the menu.
 */
export interface Difficulty {
  id: string;
  label: string;
  min: number;
  max: number;
  hint: string;
}

export const DIFFICULTIES: Difficulty[] = [
  { id: "recruit", label: "Tallon Overworld", min: 1, max: 3, hint: "FAMILIAR GROUND" },
  { id: "hunter", label: "Brinstar", min: 2, max: 4, hint: "OFF THE BEATEN PATH" },
  { id: "chozo", label: "Sanctuary Fortress", min: 3, max: 5, hint: "DEEP ARCHIVE" },
];

export const DEFAULT_DIFFICULTY = "hunter";

/** Rating assumed for any cell missing from difficulty.<game>.json. */
export const DEFAULT_RATING = 3;

/**
 * Score multiplier carried by the tile itself: obscure screens are worth
 * more. Rating 3 (the default) is ×1.0; the 1–5 range spans ×0.75–×1.25.
 */
export function tileMult(rating: number): number {
  return 0.75 + 0.125 * (rating - 1);
}

export function getDifficulty(id: string | null): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

export function cellDistance(target: RoundTarget, guess: Guess): number {
  if (target.areaId !== guess.areaId) return Infinity;
  const dx = target.cell.x - guess.cell.x;
  const dy = target.cell.y - guess.cell.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Exact cell = full score (scaled by the tile's rating). Falls off
 * exponentially with distance (half score at ~4 cells). Wrong area = 0.
 */
export function scoreRound(target: RoundTarget, guess: Guess, rating: number): number {
  const d = cellDistance(target, guess);
  if (!isFinite(d)) return 0;
  return Math.round(MAX_SCORE * tileMult(rating) * Math.exp(-d / 5.77)); // exp(-4/5.77) ≈ 0.5
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

/** Flavour line shown under the rank on the summary screen. */
export function rankFlavor(total: number): string {
  const pct = total / (MAX_SCORE * ROUNDS_PER_RUN);
  if (pct >= 0.95) return "The whole planet is mapped behind your visor.";
  if (pct >= 0.8) return "The statues would approve.";
  if (pct >= 0.6) return "The Federation pays well for eyes like yours.";
  if (pct >= 0.4) return "You'll find your way. Eventually.";
  if (pct >= 0.2) return "The current keeps pulling you back under.";
  return "Ridley barely noticed you.";
}

/** One-liner shown on the reveal card, keyed off how close the guess landed. */
export function revealFlavor(distance: number): string {
  if (!isFinite(distance)) return "The map betrayed you.";
  if (distance === 0) return "Chozo blood runs in your veins.";
  if (distance < 2) return "Dead on the money.";
  if (distance < 5) return "A confident read.";
  if (distance < 10) return "In the neighborhood.";
  return "You'll want that map data.";
}
