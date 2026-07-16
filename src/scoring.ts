import type { Guess, RoundTarget } from './types';

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
  { id: 'recruit', label: 'Tallon Overworld', min: 1, max: 3, hint: 'FAMILIAR GROUND' },
  { id: 'hunter', label: 'Brinstar', min: 2, max: 4, hint: 'OFF THE BEATEN PATH' },
  { id: 'chozo', label: 'Sanctuary Fortress', min: 3, max: 5, hint: 'DEEP ARCHIVE' }
];

export const DEFAULT_DIFFICULTY = 'hunter';

/** Rating assumed for any cell missing from difficulty.<game>.json. */
export const DEFAULT_RATING = 3;

/** Cells rated 6 are never served as round targets in any mode. */
export const EXCLUDED_RATING = 6;

// ------------------------------------------------------------- scoring knobs
// Tune the game feel here. All three inputs to a round's score — distance,
// rating, and same-room — are combined by `scoreRound` below.

/**
 * Per-rating max score: the points an *exact* guess earns on a tile of that
 * rating. Obscure screens (higher rating) are worth more, topping out at
 * MAX_SCORE for rating 5, so a perfect run of five rating-5 tiles = 25,000.
 * Indexed by rating (1–5); index 0 is unused.
 */
export const RATING_MAX = [0, 4000, 4125, 4500, 4750, 5000];

/** Proximity multiplier at exactly 1 cell off — sets the exact→1-off gap. */
export const NEAR = 0.7;
/** Tail fatness of the distance falloff: larger = slower decay toward zero. */
export const SPREAD = 6;
/** Proximity bonus for guessing inside the target's actual room (non-exact). */
export const SAME_ROOM_BONUS = 0.12;

/** The exact-guess score for a tile of the given rating (clamped to 1–5). */
export function maxForRating(rating: number): number {
  const r = Math.max(1, Math.min(5, Math.round(rating)));
  return RATING_MAX[r];
}

/**
 * Distance → 0..1 proximity multiplier. Exact is a full 1.0; the first cell
 * off drops sharply to NEAR, then decays on a slow reciprocal tail so points
 * trail toward zero gently rather than falling off a cliff.
 */
export function proximity(distance: number): number {
  if (distance <= 0) return 1;
  return NEAR / (1 + (distance - 1) / SPREAD);
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
 * Score a round from its three inputs: `distance` (cells; Infinity = wrong
 * area → 0), the target tile's `rating` (sets the exact-guess ceiling), and
 * whether the guess landed in the target's actual `sameRoom`. Being in the
 * right room adds a proximity bonus, so a same-room near miss beats an
 * equidistant guess in the wrong room. Capped at the exact-guess score.
 */
export function scoreRound(distance: number, rating: number, sameRoom: boolean): number {
  if (!isFinite(distance)) return 0;
  let p = proximity(distance);
  if (sameRoom && distance > 0) p += SAME_ROOM_BONUS;
  p = Math.max(0, Math.min(1, p));
  return Math.round(maxForRating(rating) * p);
}

export function scoreRank(total: number): string {
  const max = MAX_SCORE * ROUNDS_PER_RUN;
  const pct = total / max;
  if (pct >= 0.95) return 'Galactic Cartographer';
  if (pct >= 0.8) return 'Chozo Scholar';
  if (pct >= 0.6) return 'Seasoned Bounty Hunter';
  if (pct >= 0.4) return 'Rookie Explorer';
  if (pct >= 0.2) return 'Lost in Maridia';
  return 'Space Pirate Cannon Fodder';
}

/** Flavour line shown under the rank on the summary screen. */
export function rankFlavor(total: number): string {
  const pct = total / (MAX_SCORE * ROUNDS_PER_RUN);
  if (pct >= 0.95) return 'The whole planet is mapped behind your visor.';
  if (pct >= 0.8) return 'The statues would approve.';
  if (pct >= 0.6) return 'The Federation pays well for eyes like yours.';
  if (pct >= 0.4) return "You'll find your way. Eventually.";
  if (pct >= 0.2) return 'The current keeps pulling you back under.';
  return 'Ridley barely noticed you.';
}

/**
 * Progression gates. Each of the four unlockables is earned by pushing your
 * sticky personal best (best single run, out of MAX_SCORE * ROUNDS_PER_RUN =
 * 25,000) past a threshold — or handed over by a cheat code. The thresholds are
 * rank-aligned so the summary screen's rank name doubles as the unlock notice:
 * Scan = Seasoned Bounty Hunter (60%), X-Ray = Chozo Scholar (80%), Create Seed
 * = Galactic Cartographer (95%). Because `best` only ratchets up and cheats are
 * permanent, unlocks are monotonic — nothing ever re-locks. Runs played with a
 * visor active don't set a PB (see App's visor-taint guard), so the ladder
 * can't be cheesed by the very toys it hands out.
 */
export const UNLOCK_SCAN = 15000; // 60% — Seasoned Bounty Hunter
export const UNLOCK_XRAY = 20000; // 80% — Chozo Scholar
export const UNLOCK_CREATE = 23750; // 95% — Galactic Cartographer

export interface Unlocks {
  /** Manual seed entry (URL seeds bypass this). */
  enterSeed: boolean;
  /** Scan Visor: surgical per-cell screen probe. */
  scan: boolean;
  /** X-Ray Visor: full screen overlay on the map. */
  xray: boolean;
  /** Create Seed: hand-pick and share a run — the grail. */
  create: boolean;
}

/** Derive what's unlocked from the sticky PB plus the two cheat flags.
 *  JUSTIN BAILEY grants both visors; NARPAS SWORD grants Create Seed. */
export function computeUnlocks(best: number, cheats: { jb: boolean; narpas: boolean }): Unlocks {
  return {
    enterSeed: best > 0,
    scan: best >= UNLOCK_SCAN || cheats.jb,
    xray: best >= UNLOCK_XRAY || cheats.jb,
    create: best >= UNLOCK_CREATE || cheats.narpas
  };
}

/** One-liner shown on the reveal card, keyed off how close the guess landed. */
export function revealFlavor(distance: number): string {
  if (!isFinite(distance)) return 'The map betrayed you.';
  if (distance === 0) return 'Chozo blood runs in your veins.';
  if (distance < 2) return 'Dead on the money.';
  if (distance < 5) return 'A confident read.';
  if (distance < 10) return 'In the neighborhood.';
  return "You'll want that map data.";
}
