import { GAMES, pickTargets } from './data';
import { localDateKey } from './missionLog';
import { ROUNDS_PER_RUN, getDifficulty, type Difficulty } from './scoring';
import { mulberry32 } from './seed';
import type { GameData, RoundTarget } from './types';

/**
 * The Daily Mission: one shared run per calendar day, no backend. The local
 * date key (see `localDateKey` — the day rolls at the player's own midnight,
 * Wordle-style) hashes into a PRNG seed, which picks the day's game and its
 * five screens; the difficulty band ramps by weekday. Everyone on the same
 * date gets the same mission.
 *
 * Caveat (accepted): the screens derive from the current committed
 * `<game>.json`, so a mid-day data redeploy changes the day's puzzle for
 * players who load after it. In-flight runs are unaffected (targets are held
 * in state), and shares embed explicit seed codes, which pin exact tiles.
 */

/** The date of Daily Mission #1. */
export const DAILY_EPOCH = '2026-07-22';

/** Today's daily key — just the local date key, re-exported for call sites. */
export const dailyKey = (): string => localDateKey();

/** The 1-based daily number for a date key (#1 on DAILY_EPOCH). Diffed in UTC
 *  so no timezone or DST hour can ever skew the count. */
export function dailyNumber(key: string): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(key) - utc(DAILY_EPOCH)) / 86400000) + 1;
}

/** FNV-1a over the date key → 32-bit PRNG seed. */
export function hashDateKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The day's game, drawn from the available list by the date hash. */
export function dailyGameId(key: string): string {
  const avail = GAMES.filter((g) => g.available);
  return avail[Math.floor(mulberry32(hashDateKey(key))() * avail.length)].id;
}

/**
 * The day's difficulty band: an NYT-crossword-style weekday ramp. Mon–Tue
 * ease in on Tallon Overworld, Wed–Fri run the Brinstar mid-band, and the
 * weekend goes to Sanctuary Fortress.
 */
export function dailyDifficulty(key: string): Difficulty {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return getDifficulty(dow === 1 || dow === 2 ? 'tallon' : dow >= 3 && dow <= 5 ? 'brinstar' : 'sanctuary');
}

/** The day's five screens — deterministic given the same map data. Salted so
 *  the tile stream is independent of the game-pick draw. */
export function dailyTargets(data: GameData, key: string): RoundTarget[] {
  return pickTargets(data, ROUNDS_PER_RUN, dailyDifficulty(key), mulberry32(hashDateKey(key) ^ 0x9e3779b9));
}
