import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING,
  DIFFICULTIES,
  MAX_SCORE,
  ROUNDS_PER_RUN,
  UNLOCK_CREATE,
  UNLOCK_SCAN,
  UNLOCK_XRAY,
  cellDistance,
  computeUnlocks,
  getDifficulty,
  maxForRating,
  scoreRank,
  scoreRound
} from './scoring';
import type { Guess, RoundTarget } from './types';

const at = (areaId: string, x: number, y: number): RoundTarget & Guess => ({
  areaId,
  cell: { x, y }
});

describe('cellDistance', () => {
  it('is 0 for the exact cell', () => {
    expect(cellDistance(at('brinstar', 3, 7), at('brinstar', 3, 7))).toBe(0);
  });

  it('is the euclidean distance within an area', () => {
    expect(cellDistance(at('brinstar', 0, 0), at('brinstar', 3, 4))).toBe(5);
    expect(cellDistance(at('brinstar', 2, 2), at('brinstar', 2, 5))).toBe(3);
  });

  it('is Infinity when the guess is in the wrong area', () => {
    expect(cellDistance(at('brinstar', 3, 7), at('norfair', 3, 7))).toBe(Infinity);
  });
});

describe('maxForRating', () => {
  it('maps the 1–5 rating range onto the score table', () => {
    expect(maxForRating(1)).toBe(4000);
    expect(maxForRating(2)).toBe(4125);
    expect(maxForRating(3)).toBe(4500);
    expect(maxForRating(4)).toBe(4750);
    expect(maxForRating(5)).toBe(MAX_SCORE);
  });

  it('caps a rating-5 exact hit at MAX_SCORE', () => {
    expect(maxForRating(5)).toBe(MAX_SCORE);
  });

  it('gives the default rating 4500', () => {
    expect(maxForRating(DEFAULT_RATING)).toBe(4500);
  });

  it('clamps out-of-range ratings', () => {
    expect(maxForRating(0)).toBe(maxForRating(1));
    expect(maxForRating(9)).toBe(maxForRating(5));
  });
});

describe('scoreRound', () => {
  it('gives the full rating score for an exact guess', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(scoreRound(0, rating, true)).toBe(maxForRating(rating));
    }
  });

  it('gives 0 for a wrong-area guess (infinite distance)', () => {
    expect(scoreRound(Infinity, DEFAULT_RATING, false)).toBe(0);
    expect(scoreRound(Infinity, DEFAULT_RATING, true)).toBe(0);
  });

  it('has a big gap between exact and one cell off', () => {
    const exact = scoreRound(0, 5, false);
    const oneOff = scoreRound(1, 5, false);
    expect(exact - oneOff).toBeGreaterThan(MAX_SCORE * 0.25);
  });

  it('falls off monotonically with distance', () => {
    let prev = Infinity;
    for (const d of [0, 1, 2, 5, 10, 30]) {
      const score = scoreRound(d, DEFAULT_RATING, false);
      expect(score).toBeLessThan(prev);
      prev = score;
    }
  });

  it('keeps a fat tail — still scores well beyond the halfway distance', () => {
    // A guess 10 cells off should still earn a meaningful share, not near-zero.
    expect(scoreRound(10, 5, false)).toBeGreaterThan(MAX_SCORE * 0.2);
  });

  it('rewards the right room: same-room beats an equidistant wrong-room guess', () => {
    for (const d of [1, 2, 4, 8]) {
      expect(scoreRound(d, 5, true)).toBeGreaterThan(scoreRound(d, 5, false));
    }
  });

  it('lets the right room at 2 off beat the wrong room at 2 off, but never beat exact', () => {
    expect(scoreRound(2, 5, true)).toBeGreaterThan(scoreRound(2, 5, false));
    expect(scoreRound(2, 5, true)).toBeLessThan(scoreRound(0, 5, false));
  });

  it('never lets the same-room bonus apply to an exact hit', () => {
    expect(scoreRound(0, 5, true)).toBe(scoreRound(0, 5, false));
  });
});

describe('scoreRank', () => {
  const max = MAX_SCORE * ROUNDS_PER_RUN;

  it.each([
    [1.0, 'Galactic Cartographer'],
    [0.95, 'Galactic Cartographer'],
    [0.94, 'Chozo Scholar'],
    [0.8, 'Chozo Scholar'],
    [0.79, 'Seasoned Bounty Hunter'],
    [0.6, 'Seasoned Bounty Hunter'],
    [0.59, 'Rookie Explorer'],
    [0.4, 'Rookie Explorer'],
    [0.39, 'Lost in Maridia'],
    [0.2, 'Lost in Maridia'],
    [0.19, 'Space Pirate Cannon Fodder'],
    [0, 'Space Pirate Cannon Fodder']
  ])('%f of max total is ranked %s', (fraction, rank) => {
    expect(scoreRank(max * fraction)).toBe(rank);
  });
});

describe('DIFFICULTIES', () => {
  it("every tier's band includes the default rating, so unrated data plays on any tier", () => {
    for (const diff of DIFFICULTIES) {
      expect(diff.min).toBeLessThanOrEqual(DEFAULT_RATING);
      expect(diff.max).toBeGreaterThanOrEqual(DEFAULT_RATING);
    }
  });
});

describe('computeUnlocks', () => {
  const none = { jb: false, narpas: false };

  it('unlocks nothing at a zero PB and no cheats', () => {
    expect(computeUnlocks(0, none)).toEqual({ enterSeed: false, scan: false, xray: false, create: false });
  });

  it('unlocks Enter Seed the moment any run is completed', () => {
    expect(computeUnlocks(1, none).enterSeed).toBe(true);
  });

  it('gates the visors and Create Seed at their thresholds, inclusive', () => {
    expect(computeUnlocks(UNLOCK_SCAN - 1, none).scan).toBe(false);
    expect(computeUnlocks(UNLOCK_SCAN, none).scan).toBe(true);
    expect(computeUnlocks(UNLOCK_XRAY - 1, none).xray).toBe(false);
    expect(computeUnlocks(UNLOCK_XRAY, none).xray).toBe(true);
    expect(computeUnlocks(UNLOCK_CREATE - 1, none).create).toBe(false);
    expect(computeUnlocks(UNLOCK_CREATE, none).create).toBe(true);
  });

  it('escalates in order — Scan before X-Ray before Create', () => {
    expect(UNLOCK_SCAN).toBeLessThan(UNLOCK_XRAY);
    expect(UNLOCK_XRAY).toBeLessThan(UNLOCK_CREATE);
  });

  it('JUSTIN BAILEY grants both visors but never Create Seed', () => {
    const u = computeUnlocks(0, { jb: true, narpas: false });
    expect(u.scan).toBe(true);
    expect(u.xray).toBe(true);
    expect(u.create).toBe(false);
  });

  it('NARPAS SWORD grants Create Seed without touching the visors', () => {
    const u = computeUnlocks(0, { jb: false, narpas: true });
    expect(u.create).toBe(true);
    expect(u.scan).toBe(false);
    expect(u.xray).toBe(false);
  });
});

describe('getDifficulty', () => {
  it('returns the matching preset by id', () => {
    for (const diff of DIFFICULTIES) {
      expect(getDifficulty(diff.id)).toBe(diff);
    }
  });

  it('falls back to Bounty Hunter for null or unknown ids', () => {
    expect(getDifficulty(null)).toBe(DIFFICULTIES[1]);
    expect(getDifficulty('nonsense')).toBe(DIFFICULTIES[1]);
  });
});
