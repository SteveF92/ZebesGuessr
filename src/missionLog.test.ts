import { describe, expect, it } from 'vitest';
import { computeStats, dailyStreak, localDateKey, nextDateKey, prevDateKey, pushEntry, toLogRounds } from './missionLog';
import type { LogEntry } from './missionLog';
import type { RoundResult } from './types';

const round = (over: Partial<RoundResult> = {}): RoundResult => ({
  target: { areaId: 'crateria', cell: { x: 3, y: 4 } },
  guess: { areaId: 'crateria', cell: { x: 3, y: 4 } },
  rating: 3,
  distance: 0,
  score: 4500,
  ...over
});

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  ts: 1_700_000_000_000,
  gameId: 'super-metroid',
  diffId: 'brinstar',
  total: 15000,
  maxTotal: 22500,
  rounds: toLogRounds([round(), round({ distance: 2.5, score: 3000 }), round({ distance: Infinity, score: 0 })]),
  ...over
});

describe('toLogRounds', () => {
  it('converts Infinity distance to null at the JSON boundary', () => {
    const rounds = toLogRounds([round({ distance: Infinity, score: 0 }), round({ distance: 1.5 })]);
    expect(rounds[0].dist).toBeNull();
    expect(rounds[1].dist).toBe(1.5);
    // and the whole thing round-trips through JSON intact
    expect(JSON.parse(JSON.stringify(rounds))).toEqual(rounds);
  });

  it('captures target coordinates, rating, and score', () => {
    const [r] = toLogRounds([round()]);
    expect(r).toEqual({ areaId: 'crateria', x: 3, y: 4, rating: 3, score: 4500, dist: 0 });
  });
});

describe('pushEntry', () => {
  it('prepends newest-first and enforces the cap', () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < 5; i++) log = pushEntry(log, entry({ ts: i }), 3);
    expect(log).toHaveLength(3);
    expect(log.map((e) => e.ts)).toEqual([4, 3, 2]);
  });
});

describe('date keys', () => {
  it('formats a local date key', () => {
    expect(localDateKey(new Date(2026, 6, 22, 23, 59))).toBe('2026-07-22');
    expect(localDateKey(new Date(2026, 0, 3, 0, 0))).toBe('2026-01-03');
  });

  it('steps across month and year boundaries', () => {
    expect(prevDateKey('2026-07-01')).toBe('2026-06-30');
    expect(prevDateKey('2026-01-01')).toBe('2025-12-31');
    expect(nextDateKey('2026-02-28')).toBe('2026-03-01');
    expect(nextDateKey('2028-02-28')).toBe('2028-02-29'); // leap year
  });
});

describe('dailyStreak', () => {
  const rec = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, 10000]));

  it('is zero on an empty record', () => {
    expect(dailyStreak({}, '2026-07-22')).toEqual({ current: 0, best: 0 });
  });

  it('counts back from today when today is played', () => {
    const r = rec('2026-07-20', '2026-07-21', '2026-07-22');
    expect(dailyStreak(r, '2026-07-22')).toEqual({ current: 3, best: 3 });
  });

  it("keeps the streak alive when today isn't played yet", () => {
    const r = rec('2026-07-20', '2026-07-21');
    expect(dailyStreak(r, '2026-07-22')).toEqual({ current: 2, best: 2 });
  });

  it('breaks the current streak on a missed day but remembers the best', () => {
    const r = rec('2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-21', '2026-07-22');
    expect(dailyStreak(r, '2026-07-22')).toEqual({ current: 2, best: 4 });
  });

  it('finds the best run even when it is not the latest', () => {
    const r = rec('2026-06-01', '2026-06-02', '2026-06-03', '2026-07-22');
    expect(dailyStreak(r, '2026-07-22')).toEqual({ current: 1, best: 3 });
  });

  it('crosses month boundaries', () => {
    const r = rec('2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02');
    expect(dailyStreak(r, '2026-07-02')).toEqual({ current: 4, best: 4 });
  });
});

describe('computeStats', () => {
  it('is empty-safe', () => {
    const s = computeStats([]);
    expect(s.missions).toBe(0);
    expect(s.avgScore).toBe(0);
    expect(s.mostPlayed).toBeNull();
    expect(s.mostMissed).toBeNull();
  });

  it('aggregates rounds and averages totals', () => {
    const s = computeStats([entry({ total: 10000 }), entry({ total: 20000 })]);
    expect(s.missions).toBe(2);
    expect(s.avgScore).toBe(15000);
    expect(s.roundsPlayed).toBe(6);
    expect(s.exactHits).toBe(2); // one exact per entry
    expect(s.wrongArea).toBe(2); // one wrong-area per entry
  });

  it('excludes practice runs from every stat', () => {
    const s = computeStats([entry({ total: 10000 }), entry({ total: 999, practice: true })]);
    expect(s.missions).toBe(1);
    expect(s.avgScore).toBe(10000);
    expect(s.roundsPlayed).toBe(3);
  });

  it('finds the most-played game and the most-missed area (threshold 2)', () => {
    const whiff = () => round({ distance: Infinity, score: 0, target: { areaId: 'maridia', cell: { x: 1, y: 1 } } });
    const log = [
      entry({ gameId: 'super-metroid', rounds: toLogRounds([whiff(), whiff()]) }),
      entry({ gameId: 'super-metroid', rounds: toLogRounds([round()]) }),
      entry({ gameId: 'metroid-fusion', rounds: toLogRounds([round()]) })
    ];
    const s = computeStats(log);
    expect(s.mostPlayed).toEqual({ gameId: 'super-metroid', count: 2 });
    expect(s.mostMissed).toEqual({ gameId: 'super-metroid', areaId: 'maridia', count: 2 });
  });

  it('treats a single whiff as noise, not a blind spot', () => {
    const s = computeStats([entry()]); // one wrong-area round only
    expect(s.mostMissed).toBeNull();
  });

  it('counts far misses (>= 8 cells) toward the blind spot', () => {
    const far = () => round({ distance: 9, score: 500, target: { areaId: 'norfair', cell: { x: 2, y: 2 } } });
    const s = computeStats([entry({ rounds: toLogRounds([far(), far()]) })]);
    expect(s.mostMissed).toEqual({ gameId: 'super-metroid', areaId: 'norfair', count: 2 });
  });
});
