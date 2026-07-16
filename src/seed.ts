/**
 * Replayable run seeds. A seed is an *explicit* list of the run's five tiles —
 * not a PRNG seed. Every run (random or hand-picked in the Create Seed screen)
 * is encoded the same way: a normal "Start Mission" just lets `pickTargets`
 * choose five tiles at random, then encodes the tiles it landed on. So random
 * and custom runs produce identical codes, and a seed fully determines a run
 * *given the same committed map data*.
 *
 * A tile is stored as its index into the game's canonical flat cell pool
 * (`cellPool` in data.ts: areas in order, then each area's cells in order).
 *
 * Bit layout (12 base64url chars = 72 bits, 71 used + 1 pad):
 *   - game (3 bits): gameIndex, up to 8 games
 *   - diff (3 bits): diffIndex — a cosmetic label on replay (per-tile ratings
 *     drive scoring). Up to 8 difficulties.
 *   - 5 × index (13 bits each): the five tile indices, in play order.
 *
 * 13-bit indices cap the pool at 8192 cells (it's ~1,227 today) — plenty of
 * headroom. If a map regen ever pushes the pool past 8192, widen this field.
 *
 * The field is 12 chars so it splits cleanly into two groups of six in the
 * Seed Entry screen — which also lets the classic "JUSTINBAILEY" password fill
 * it exactly.
 *
 * Caveat: a code only reproduces a run against the same `public/data/<game>.json`,
 * area order, and `ENABLED_AREAS` filter it was minted under. Regenerating map
 * data can invalidate old codes (indices are positional) — acceptable for a
 * fan project.
 */

export interface Seed {
  gameIndex: number;
  diffIndex: number;
  /** the run's five tile indices into the canonical cell pool, in play order */
  indices: number[];
}

/**
 * mulberry32 — a tiny, fast, public-domain PRNG. Same seed → same stream of
 * [0,1) values. No longer used for run seeds (those are explicit tile lists);
 * kept for deterministic `pickTargets` in the unit tests.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** The base64url character set, exposed for the Seed Entry keyboard. */
export const SEED_ALPHABET = B64;

/** How many base64url characters a seed code is. */
export const SEED_LENGTH = 12;

/** How many tiles a run (and therefore a seed) holds. */
export const SEED_TILES = 5;

/** Bit widths of the packed fields. */
const GAME_BITS = 3;
const DIFF_BITS = 3;
const INDEX_BITS = 13;
/** Highest tile index a seed can hold (0..8191). */
export const MAX_CELL_INDEX = (1 << INDEX_BITS) - 1;

/**
 * Encode a run to its 12-char base64url code. Packs game, difficulty, then the
 * five tile indices MSB-first into 72 bits (bottom bit is padding).
 */
export function encodeSeed({ gameIndex, diffIndex, indices }: Seed): string {
  // Accumulate the 71 payload bits into a BigInt (JS numbers can't hold >53
  // bits), then read them back out six at a time as base64url chars.
  let bits = 0n;
  const push = (value: number, width: number) => {
    bits = (bits << BigInt(width)) | BigInt(value & ((1 << width) - 1));
  };
  push(gameIndex, GAME_BITS);
  push(diffIndex, DIFF_BITS);
  for (let i = 0; i < SEED_TILES; i++) push(indices[i] ?? 0, INDEX_BITS);
  bits <<= 1n; // pad the low bit so the total is 72 = 12 * 6

  let out = '';
  for (let shift = (SEED_LENGTH - 1) * 6; shift >= 0; shift -= 6) {
    out += B64[Number((bits >> BigInt(shift)) & 0x3fn)];
  }
  return out;
}

/** Parse a seed code; null if malformed (bad chars or wrong length). */
export function decodeSeed(code: string): Seed | null {
  if (code.length !== SEED_LENGTH) return null;
  let bits = 0n;
  for (const ch of code) {
    const val = B64_INV[ch];
    if (val === undefined) return null;
    bits = (bits << 6n) | BigInt(val);
  }
  bits >>= 1n; // drop the padding bit

  const indices: number[] = [];
  for (let i = 0; i < SEED_TILES; i++) {
    indices.unshift(Number(bits & BigInt(MAX_CELL_INDEX)));
    bits >>= BigInt(INDEX_BITS);
  }
  const diffIndex = Number(bits & BigInt((1 << DIFF_BITS) - 1));
  bits >>= BigInt(DIFF_BITS);
  const gameIndex = Number(bits & BigInt((1 << GAME_BITS) - 1));

  return { gameIndex, diffIndex, indices };
}
