/**
 * Replayable run seeds. A seed fully determines a run's targets *given the
 * same committed map data*: it packs the game, the difficulty, and a 30-bit
 * PRNG seed that `pickTargets` consumes. Encoded as a 6-char base64url string
 * (36 bits) so it rides comfortably in a `?seed=` query param — and so the
 * whole code is short enough to type into the Seed Entry screen.
 *
 * Bit layout (6 base64url chars = 36 bits):
 *   - char 0 (top 6 bits): (gameIndex << 3) | diffIndex — 3 bits each, so up
 *     to 8 games / 8 difficulties.
 *   - chars 1–5 (30 bits): the PRNG seed.
 *
 * Because only 30 bits survive, `randomSeed()` mints 30-bit seeds so the run a
 * player plays matches the code they share (see its note).
 *
 * Caveat: a seed only reproduces a run against the same `public/data/<game>.json`,
 * area order, and `ENABLED_AREAS` filter it was minted under. Regenerating map
 * data can invalidate old seeds — acceptable for a fan project.
 */

export interface Seed {
  gameIndex: number;
  diffIndex: number;
  prngSeed: number;
}

/**
 * mulberry32 — a tiny, fast, public-domain PRNG. Same seed → same stream of
 * [0,1) values, which is what makes a run reproducible.
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

/**
 * A fresh 30-bit seed from the platform CSPRNG. Browser-only. Kept to 30 bits
 * (the width a 6-char code can hold) so the seed fed to `pickTargets` is exactly
 * the one the shared code decodes back to — otherwise a shared seed would
 * reproduce a different run than the player saw.
 */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] >>> 2;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** The base64url character set, exposed for the Seed Entry keyboard. */
export const SEED_ALPHABET = B64;

/** How many base64url characters a seed code is. */
export const SEED_LENGTH = 6;

/**
 * Encode a run's identity to a 6-char base64url code (36 bits). Char 0 holds
 * (gameIndex << 3) | diffIndex; the next five chars hold the 30-bit PRNG seed,
 * most-significant 6 bits first.
 */
export function encodeSeed({ gameIndex, diffIndex, prngSeed }: Seed): string {
  const combo = ((gameIndex & 0x07) << 3) | (diffIndex & 0x07);
  const s = prngSeed & 0x3fffffff; // 30 bits
  let out = B64[combo];
  for (let shift = 24; shift >= 0; shift -= 6) {
    out += B64[(s >>> shift) & 0x3f];
  }
  return out;
}

/** Parse a seed code; null if malformed (bad chars or wrong length). */
export function decodeSeed(code: string): Seed | null {
  if (code.length !== SEED_LENGTH) return null;
  const combo = B64_INV[code[0]];
  if (combo === undefined) return null;
  let s = 0;
  for (let i = 1; i < SEED_LENGTH; i++) {
    const val = B64_INV[code[i]];
    if (val === undefined) return null;
    s = (s << 6) | val;
  }
  return {
    gameIndex: combo >> 3,
    diffIndex: combo & 0x07,
    prngSeed: s >>> 0
  };
}
