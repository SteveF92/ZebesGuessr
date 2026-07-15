import type { GameData, RoundResult } from './types';
import type { Difficulty } from './scoring';
import { maxForRating, scoreRank } from './scoring';

/** Where a shared run points a curious friend. Matches the Vite `base` path. */
export const GAME_URL = 'https://stevef92.github.io/ZebesGuessr/';

/**
 * One emoji summarising how a round went, GeoGuessr/Wordle-style. Checked
 * distance-first because an exact hit is also `pct === 1` and a wrong-area
 * guess is `pct === 0` — the score bands only make sense in between.
 */
export function roundEmoji(r: RoundResult): string {
  if (r.distance === 0) return '🎯';
  if (!isFinite(r.distance)) return '⬛';
  const pct = r.score / maxForRating(r.rating);
  if (pct >= 0.8) return '🟩';
  if (pct >= 0.4) return '🟨';
  return '🟥';
}

/** The five-line share blurb: header, score+rank, emoji row, difficulty, URL. */
export function buildShareText(data: GameData, results: RoundResult[], total: number, difficulty: Difficulty, url = GAME_URL): string {
  const maxTotal = results.reduce((s, r) => s + maxForRating(r.rating), 0);
  return [
    `ZebesGuessr · ${data.title}`,
    `${scoreRank(total)} · ${total.toLocaleString()} / ${maxTotal.toLocaleString()}`,
    results.map(roundEmoji).join(''),
    `Difficulty: ${difficulty.label}`,
    url
  ].join('\n');
}
