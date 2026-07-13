import { describe, expect, it } from "vitest";
import {
  DIFFICULTIES,
  MAX_SCORE,
  ROUNDS_PER_RUN,
  cellDistance,
  getDifficulty,
  scoreRank,
  scoreRound,
} from "./scoring";
import type { Guess, RoundTarget } from "./types";

const at = (areaId: string, x: number, y: number): RoundTarget & Guess => ({
  areaId,
  cell: { x, y },
});

const hunter = getDifficulty("hunter");

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

describe("scoreRound", () => {
  it("gives the full score for an exact guess", () => {
    expect(scoreRound(at("brinstar", 5, 5), at("brinstar", 5, 5), hunter)).toBe(MAX_SCORE);
  });

  it("gives 0 for a wrong-area guess", () => {
    expect(scoreRound(at("brinstar", 5, 5), at("norfair", 5, 5), hunter)).toBe(0);
  });

  it("halves the score at roughly 4 cells away", () => {
    const score = scoreRound(at("brinstar", 0, 0), at("brinstar", 4, 0), hunter);
    expect(score).toBeGreaterThan(MAX_SCORE * 0.45);
    expect(score).toBeLessThan(MAX_SCORE * 0.55);
  });

  it("falls off monotonically with distance", () => {
    const target = at("brinstar", 0, 0);
    let prev = Infinity;
    for (const x of [1, 2, 5, 10, 30]) {
      const score = scoreRound(target, at("brinstar", x, 0), hunter);
      expect(score).toBeLessThan(prev);
      prev = score;
    }
  });

  it("applies the difficulty multiplier to an exact guess", () => {
    const target = at("brinstar", 5, 5);
    for (const diff of DIFFICULTIES) {
      expect(scoreRound(target, at("brinstar", 5, 5), diff)).toBe(
        Math.round(MAX_SCORE * diff.mult),
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
