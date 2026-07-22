import type { GameData, RoundResult } from './types';
import type { Difficulty } from './scoring';
import { maxForRating, scoreRank } from './scoring';

/** Where a shared run points a curious friend. */
export const GAME_URL = 'https://www.zebesguessr.com/';

/**
 * One emoji summarising how a round went, GeoGuessr/Wordle-style. Checked
 * distance-first because an exact hit is also `pct === 1` and a wrong-area
 * guess is `pct === 0` — the score bands only make sense in between.
 * Also consumed by the Mission Log for its logged rounds (whose wrong-area
 * distance is stored as null — pass Infinity).
 */
export function scoreEmoji(distance: number, score: number, rating: number): string {
  if (distance === 0) return '🎯';
  if (!isFinite(distance)) return '⬛';
  const pct = score / maxForRating(rating);
  if (pct >= 0.8) return '🟩';
  if (pct >= 0.4) return '🟨';
  return '🟥';
}

export function roundEmoji(r: RoundResult): string {
  return scoreEmoji(r.distance, r.score, r.rating);
}

/** The five-line share blurb: header, score+rank, emoji row, difficulty, URL.
 *  A Daily Mission run brands the header with its number instead —
 *  "ZebesGuessr Daily #42 · <title>", Wordle-style. */
export function buildShareText(data: GameData, results: RoundResult[], total: number, difficulty: Difficulty, url = GAME_URL, dailyNum?: number | null): string {
  const maxTotal = results.reduce((s, r) => s + maxForRating(r.rating), 0);
  return [
    dailyNum ? `ZebesGuessr Daily #${dailyNum} · ${data.title}` : `ZebesGuessr · ${data.title}`,
    `${scoreRank(total)} · ${total.toLocaleString()} / ${maxTotal.toLocaleString()}`,
    results.map(roundEmoji).join(''),
    `Difficulty: ${difficulty.label}`,
    url
  ].join('\n');
}
