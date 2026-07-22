import type { RoundResult } from './types';

/**
 * The Mission Log: a localStorage history of completed runs plus the Daily
 * Mission record, and the pure stats derived from them for the log modal.
 *
 * Everything that computes is pure (unit-tested); only the read/append
 * wrappers touch localStorage, and they swallow storage errors — a blocked or
 * full store degrades to "no history", never a crash.
 */

/** One round of a logged run. `dist` is the guess distance in cells — `null`
 *  means wrong area (`Infinity` doesn't survive JSON, so it's converted at
 *  this boundary and back at read time by the stats fns). */
export interface LogRound {
  areaId: string;
  x: number;
  y: number;
  rating: number;
  score: number;
  dist: number | null;
}

export interface LogEntry {
  /** completion time, ms epoch */
  ts: number;
  gameId: string;
  diffId: string;
  total: number;
  maxTotal: number;
  /** run played with a visor on — shown in the list but excluded from stats,
   *  mirroring the PB guard */
  practice?: boolean;
  /** the Daily Mission dateKey this run was launched from, if any */
  daily?: string;
  /** the run's seed code, so any logged run can be replayed/shared */
  seed?: string;
  rounds: LogRound[];
}

const LOG_KEY = 'zg-log';
const DAILY_KEY = 'zg-daily';
/** History cap — five-round entries are ~½KB, so 300 stays well under quota. */
export const LOG_CAP = 300;

/** Round results → log rounds (Infinity → null at the JSON boundary). */
export function toLogRounds(results: RoundResult[]): LogRound[] {
  return results.map((r) => ({
    areaId: r.target.areaId,
    x: r.target.cell.x,
    y: r.target.cell.y,
    rating: r.rating,
    score: r.score,
    dist: isFinite(r.distance) ? r.distance : null
  }));
}

/** Prepend `entry` (newest first), dropping the oldest past `cap`. Pure. */
export function pushEntry(log: LogEntry[], entry: LogEntry, cap: number = LOG_CAP): LogEntry[] {
  return [entry, ...log].slice(0, cap);
}

export function readLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const log = raw ? (JSON.parse(raw) as LogEntry[]) : [];
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

export function appendRun(entry: LogEntry): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(pushEntry(readLog(), entry)));
  } catch {
    /* storage blocked/full — the run just isn't logged */
  }
}

// ------------------------------------------------------------- daily record

/** The Daily Mission record: dateKey ("YYYY-MM-DD", local) → locked-in score. */
export function readDailyRecord(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const rec = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return rec && typeof rec === 'object' ? rec : {};
  } catch {
    return {};
  }
}

/** Record a day's score. First completion counts: an existing entry wins, so
 *  replays never overwrite. Returns the score now on record for the day. */
export function recordDaily(dateKey: string, score: number): number {
  const rec = readDailyRecord();
  if (rec[dateKey] !== undefined) return rec[dateKey];
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ ...rec, [dateKey]: score }));
  } catch {
    /* storage blocked — the day just isn't recorded */
  }
  return score;
}

// ------------------------------------------------------------- date keys

/** Local-calendar date key, "YYYY-MM-DD" — the day rolls at the player's own
 *  midnight (Wordle-style), and everyone sharing a calendar date shares it. */
export function localDateKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The date key one day before/after `key`. Runs the arithmetic in UTC so it
 *  can never be bitten by a DST hour, whatever zone minted the key. */
function stepDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const prevDateKey = (key: string): string => stepDateKey(key, -1);
export const nextDateKey = (key: string): string => stepDateKey(key, 1);

/**
 * Daily streaks from the record. `current` counts back from today — a today
 * not yet played doesn't break it (the player still has all day), it just
 * starts counting from yesterday. `best` is the longest run anywhere in the
 * record.
 */
export function dailyStreak(record: Record<string, number>, todayKey: string): { current: number; best: number } {
  let current = 0;
  for (let k = record[todayKey] !== undefined ? todayKey : prevDateKey(todayKey); record[k] !== undefined; k = prevDateKey(k)) current++;

  let best = 0;
  // Walk each run once, starting only from its end (a key whose next day is
  // also on record sits mid-run and would double-count the walk).
  for (const k of Object.keys(record)) {
    if (record[nextDateKey(k)] !== undefined) continue;
    let len = 0;
    for (let j = k; record[j] !== undefined; j = prevDateKey(j)) len++;
    best = Math.max(best, len);
  }
  return { current, best };
}

// ------------------------------------------------------------- stats

export interface LogStats {
  /** completed non-practice runs */
  missions: number;
  /** mean run total across those, rounded */
  avgScore: number;
  roundsPlayed: number;
  exactHits: number;
  wrongArea: number;
  /** gameId with the most non-practice runs */
  mostPlayed: { gameId: string; count: number } | null;
  /** the area whose screens this player whiffs hardest (wrong area or ≥ 8
   *  cells off), if any area has been whiffed at least twice */
  mostMissed: { gameId: string; areaId: string; count: number } | null;
}

export function computeStats(log: LogEntry[]): LogStats {
  const real = log.filter((e) => !e.practice);
  const stats: LogStats = { missions: real.length, avgScore: 0, roundsPlayed: 0, exactHits: 0, wrongArea: 0, mostPlayed: null, mostMissed: null };
  if (!real.length) return stats;
  stats.avgScore = Math.round(real.reduce((s, e) => s + e.total, 0) / real.length);

  const played = new Map<string, number>();
  const missed = new Map<string, number>();
  for (const e of real) {
    played.set(e.gameId, (played.get(e.gameId) ?? 0) + 1);
    for (const r of e.rounds) {
      stats.roundsPlayed++;
      if (r.dist === 0) stats.exactHits++;
      if (r.dist === null) stats.wrongArea++;
      if (r.dist === null || r.dist >= 8) {
        const k = `${e.gameId}:${r.areaId}`;
        missed.set(k, (missed.get(k) ?? 0) + 1);
      }
    }
  }
  for (const [gameId, count] of played) {
    if (!stats.mostPlayed || count > stats.mostPlayed.count) stats.mostPlayed = { gameId, count };
  }
  for (const [k, count] of missed) {
    if (count >= 2 && (!stats.mostMissed || count > stats.mostMissed.count)) {
      const [gameId, areaId] = k.split(':');
      stats.mostMissed = { gameId, areaId, count };
    }
  }
  return stats;
}
