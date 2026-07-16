/**
 * Replayable run seeds. A seed fully determines a run's targets *given the
 * same committed map data*: it packs the game, the difficulty, and a 32-bit
 * PRNG seed that `pickTargets` consumes. Encoded as a 7-char base64url string
 * so it rides comfortably in a `?seed=` query param.
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

/** A fresh 32-bit seed from the platform CSPRNG. Browser-only. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** base64url-encode a byte array, no padding. */
function bytesToBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 0x3f];
  }
  return out;
}

/** Decode a base64url string (no padding) back to bytes; null on bad chars. */
function base64urlToBytes(str: string): Uint8Array | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of str) {
    const val = B64_INV[ch];
    if (val === undefined) return null;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Encode a run's identity to a 7-char base64url code. Payload is 5 bytes:
 * byte0 = (gameIndex << 4) | diffIndex, then the uint32 PRNG seed big-endian.
 */
export function encodeSeed({ gameIndex, diffIndex, prngSeed }: Seed): string {
  const s = prngSeed >>> 0;
  const bytes = new Uint8Array([((gameIndex & 0x0f) << 4) | (diffIndex & 0x0f), (s >>> 24) & 0xff, (s >>> 16) & 0xff, (s >>> 8) & 0xff, s & 0xff]);
  return bytesToBase64url(bytes);
}

/** Parse a seed code; null if malformed (bad chars or wrong length). */
export function decodeSeed(code: string): Seed | null {
  const bytes = base64urlToBytes(code);
  if (!bytes || bytes.length !== 5) return null;
  return {
    gameIndex: bytes[0] >> 4,
    diffIndex: bytes[0] & 0x0f,
    prngSeed: ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0
  };
}
