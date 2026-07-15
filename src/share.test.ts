import { describe, expect, it } from 'vitest';
import { GAME_URL, buildShareText, roundEmoji } from './share';
import { getDifficulty, maxForRating } from './scoring';
import type { GameData, RoundResult } from './types';

/** Build a RoundResult for a given rating/score/distance; guess is filler. */
const round = (rating: number, score: number, distance: number): RoundResult => ({
  target: { areaId: 'brinstar', cell: { x: 1, y: 1 } },
  guess: { areaId: 'brinstar', cell: { x: 1, y: 1 } },
  rating,
  distance,
  score
});

const data = { title: 'Super Metroid' } as GameData;

describe('roundEmoji', () => {
  it('is a bullseye for an exact hit, whatever the score', () => {
    expect(roundEmoji(round(5, maxForRating(5), 0))).toBe('🎯');
  });

  it('is a black square for a wrong-area (infinite distance) guess', () => {
    expect(roundEmoji(round(3, 0, Infinity))).toBe('⬛');
  });

  it('bands non-exact finite guesses by score fraction', () => {
    const m = maxForRating(5);
    expect(roundEmoji(round(5, Math.round(m * 0.85), 1))).toBe('🟩');
    expect(roundEmoji(round(5, Math.round(m * 0.5), 3))).toBe('🟨');
    expect(roundEmoji(round(5, Math.round(m * 0.1), 12))).toBe('🟥');
  });

  it('treats the band boundaries as inclusive (>=)', () => {
    const m = maxForRating(5);
    expect(roundEmoji(round(5, m * 0.8, 1))).toBe('🟩');
    expect(roundEmoji(round(5, m * 0.4, 3))).toBe('🟨');
  });
});

describe('buildShareText', () => {
  const results = [
    round(5, maxForRating(5), 0),
    round(4, Math.round(maxForRating(4) * 0.85), 1),
    round(3, Math.round(maxForRating(3) * 0.5), 3),
    round(2, Math.round(maxForRating(2) * 0.1), 12),
    round(1, 0, Infinity)
  ];
  const total = results.reduce((s, r) => s + r.score, 0);
  const text = buildShareText(data, results, total, getDifficulty('hunter'));
  const lines = text.split('\n');

  it('has exactly five lines and no trailing newline', () => {
    expect(lines).toHaveLength(5);
    expect(text.endsWith('\n')).toBe(false);
  });

  it('leads with the app and game title', () => {
    expect(lines[0]).toBe('ZebesGuessr · Super Metroid');
  });

  it('shows the rank and formatted total on the second line', () => {
    expect(lines[1]).toContain(total.toLocaleString());
    expect(lines[1]).toContain(' / ');
  });

  it('emits one emoji per round in order', () => {
    expect([...lines[2]]).toHaveLength(results.length);
    expect(lines[2]).toBe('🎯🟩🟨🟥⬛');
  });

  it('names the difficulty and ends with the game URL', () => {
    expect(lines[3]).toBe('Difficulty: Brinstar');
    expect(lines[4]).toBe(GAME_URL);
  });
});
