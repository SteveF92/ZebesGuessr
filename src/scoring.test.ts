import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATING,
  DIFFICULTIES,
  MAX_SCORE,
  ROUNDS_PER_RUN,
  cellDistance,
  getDifficulty,
  scoreRank,
  scoreRound,
  tileMult,
} from "./scoring";
import type { Guess, RoundTarget } from "./types";

const at = (areaId: string, x: number, y: number): RoundTarget & Guess => ({
  areaId,
  cell: { x, y },
});

describe("cellDistance", () => {
  it("is 0 for the exact cell", () => {
    expect(cellDistance(at("brinstar", 3, 7), at("brinstar", 3, 7))).toBe(0);
  });

  it("is the euclidean distance within an area", () => {
    expect(cellDistance(at("brinstar", 0, 0), at("brinstar", 3, 4))).toBe(5);
    expect(cellDistance(at("brinstar", 2, 2), at("brinstar", 2, 5))).toBe(3);
  });

  it("is Infinity when the guess is in the wrong area", () => {
    expect(cellDistance(at("brinstar", 3, 7), at("norfair", 3, 7))).toBe(Infinity);
  });
});

describe("tileMult", () => {
  it("maps the 1–5 rating range onto ×0.75–×1.25", () => {
    expect(tileMult(1)).toBe(0.75);
    expect(tileMult(2)).toBe(0.875);
    expect(tileMult(3)).toBe(1.0);
    expect(tileMult(4)).toBe(1.125);
    expect(tileMult(5)).toBe(1.25);
  });

  it("is neutral for the default rating", () => {
    expect(tileMult(DEFAULT_RATING)).toBe(1.0);
  });
});

describe("scoreRound", () => {
  it("gives the full score for an exact guess at the default rating", () => {
    expect(scoreRound(at("brinstar", 5, 5), at("brinstar", 5, 5), DEFAULT_RATING)).toBe(MAX_SCORE);
  });

  it("gives 0 for a wrong-area guess", () => {
    expect(scoreRound(at("brinstar", 5, 5), at("norfair", 5, 5), DEFAULT_RATING)).toBe(0);
  });

  it("halves the score at roughly 4 cells away", () => {
    const score = scoreRound(at("brinstar", 0, 0), at("brinstar", 4, 0), DEFAULT_RATING);
    expect(score).toBeGreaterThan(MAX_SCORE * 0.45);
    expect(score).toBeLessThan(MAX_SCORE * 0.55);
  });

  it("falls off monotonically with distance", () => {
    const target = at("brinstar", 0, 0);
    let prev = Infinity;
    for (const x of [1, 2, 5, 10, 30]) {
      const score = scoreRound(target, at("brinstar", x, 0), DEFAULT_RATING);
      expect(score).toBeLessThan(prev);
      prev = score;
    }
  });

  it("applies the tile multiplier to an exact guess", () => {
    const target = at("brinstar", 5, 5);
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(scoreRound(target, at("brinstar", 5, 5), rating)).toBe(
        Math.round(MAX_SCORE * tileMult(rating)),
      );
    }
  });
});

describe("scoreRank", () => {
  const max = MAX_SCORE * ROUNDS_PER_RUN;

  it.each([
    [1.0, "Galactic Cartographer"],
    [0.95, "Galactic Cartographer"],
    [0.94, "Chozo Scholar"],
    [0.8, "Chozo Scholar"],
    [0.79, "Seasoned Bounty Hunter"],
    [0.6, "Seasoned Bounty Hunter"],
    [0.59, "Rookie Explorer"],
    [0.4, "Rookie Explorer"],
    [0.39, "Lost in Maridia"],
    [0.2, "Lost in Maridia"],
    [0.19, "Space Pirate Cannon Fodder"],
    [0, "Space Pirate Cannon Fodder"],
  ])("%f of max total is ranked %s", (fraction, rank) => {
    expect(scoreRank(max * fraction)).toBe(rank);
  });
});

describe("DIFFICULTIES", () => {
  it("every tier's band includes the default rating, so unrated data plays on any tier", () => {
    for (const diff of DIFFICULTIES) {
      expect(diff.min).toBeLessThanOrEqual(DEFAULT_RATING);
      expect(diff.max).toBeGreaterThanOrEqual(DEFAULT_RATING);
    }
  });
});

describe("getDifficulty", () => {
  it("returns the matching preset by id", () => {
    for (const diff of DIFFICULTIES) {
      expect(getDifficulty(diff.id)).toBe(diff);
    }
  });

  it("falls back to Bounty Hunter for null or unknown ids", () => {
    expect(getDifficulty(null)).toBe(DIFFICULTIES[1]);
    expect(getDifficulty("nonsense")).toBe(DIFFICULTIES[1]);
  });
});
