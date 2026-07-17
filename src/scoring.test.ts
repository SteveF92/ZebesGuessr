import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_RATING,
  DIFFICULTIES,
  MAX_SCORE,
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
  // Each tier's threshold and the score one point below it, so a retune of
  // the RANKS ladder in scoring.ts must be mirrored here deliberately.
  it.each([
    [25000, 'Galactic Cartographer'],
    [23000, 'Galactic Cartographer'],
    [22999, 'Chozo Scholar'],
    [19000, 'Chozo Scholar'],
    [18999, 'Seasoned Bounty Hunter'],
    [15000, 'Seasoned Bounty Hunter'],
    [14999, 'Federation Scout'],
    [10000, 'Federation Scout'],
    [9999, 'Unreliable Navigator'],
    [5000, 'Unreliable Navigator'],
    [4999, 'Hint System Candidate'],
    [0, 'Hint System Candidate']
  ])('a run total of %i is ranked %s', (total, rank) => {
    expect(scoreRank(total)).toBe(rank);
  });
});

describe('DIFFICULTIES', () => {
  it('keeps every band inside the 1–5 rating scale', () => {
    for (const diff of DIFFICULTIES) {
      expect(diff.min).toBeGreaterThanOrEqual(1);
      expect(diff.max).toBeLessThanOrEqual(5);
      expect(diff.min).toBeLessThanOrEqual(diff.max);
    }
  });

  it("the default tier's band includes the default rating, so unrated data plays there", () => {
    const def = getDifficulty(DEFAULT_DIFFICULTY);
    expect(def.min).toBeLessThanOrEqual(DEFAULT_RATING);
    expect(def.max).toBeGreaterThanOrEqual(DEFAULT_RATING);
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

  it('falls back to Brinstar for null or unknown ids', () => {
    expect(getDifficulty(null)).toBe(DIFFICULTIES[1]);
    expect(getDifficulty('nonsense')).toBe(DIFFICULTIES[1]);
  });
});
