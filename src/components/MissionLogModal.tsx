import { useEffect, useMemo } from 'react';
import { GAMES } from '../data';
import { computeStats, dailyStreak, localDateKey, readDailyRecord, readLog } from '../missionLog';
import type { LogEntry } from '../missionLog';
import { getDifficulty, scoreRank } from '../scoring';
import { scoreEmoji } from '../share';

/** How many recent runs the history list shows (the log keeps more). */
const LIST_MAX = 15;

const gameTitle = (gameId: string): string => GAMES.find((g) => g.id === gameId)?.title ?? gameId;
/** areaIds are readable slugs ("wrecked-ship") — good enough as display names
 *  here, where no GameData is loaded to look up the real ones. */
const areaLabel = (areaId: string): string => areaId.replace(/-/g, ' ').toUpperCase();

const dateLabel = (ts: number): string => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function emojiRow(e: LogEntry): string {
  return e.rounds.map((r) => scoreEmoji(r.dist ?? Infinity, r.score, r.rating)).join('');
}

/**
 * The Mission Log: every completed run (from localStorage) distilled into
 * headline stats, per-game bests, and a recent-mission list. Practice runs
 * (visors used) appear in the list but stay out of the stats, mirroring the
 * PB guard.
 */
export function MissionLogModal({ bests, onClose }: { bests: Record<string, number>; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Read once per open — the log can't change while the modal is up.
  const log = useMemo(readLog, []);
  const stats = useMemo(() => computeStats(log), [log]);
  const streak = useMemo(() => dailyStreak(readDailyRecord(), localDateKey()), []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal log-modal" role="dialog" aria-modal="true" aria-label="Mission log" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2>MISSION LOG</h2>

        <div className="log-stats">
          <div className="log-stat">
            <span className="log-stat-value">{stats.missions}</span>
            <span className="log-stat-label">MISSIONS</span>
          </div>
          <div className="log-stat">
            <span className="log-stat-value">{stats.avgScore.toLocaleString()}</span>
            <span className="log-stat-label">AVG SCORE</span>
          </div>
          <div className="log-stat">
            <span className="log-stat-value">{stats.exactHits}</span>
            <span className="log-stat-label">EXACT HITS</span>
          </div>
          <div className="log-stat">
            <span className="log-stat-value">
              {streak.current}
              {streak.best > streak.current && <span className="log-stat-sub"> / {streak.best}</span>}
            </span>
            <span className="log-stat-label">{streak.best > streak.current ? 'DAILY STREAK / BEST' : 'DAILY STREAK'}</span>
          </div>
        </div>

        {(stats.mostPlayed || stats.mostMissed) && (
          <p className="log-insights">
            {stats.mostPlayed && (
              <span>
                MOST FLOWN: <strong>{gameTitle(stats.mostPlayed.gameId)}</strong> ({stats.mostPlayed.count})
              </span>
            )}
            {stats.mostMissed && (
              <span>
                BLIND SPOT: <strong>{areaLabel(stats.mostMissed.areaId)}</strong> ({gameTitle(stats.mostMissed.gameId)})
              </span>
            )}
          </p>
        )}

        <div className="log-bests">
          {GAMES.filter((g) => bests[g.id] > 0).map((g) => (
            <div key={g.id} className="log-best">
              <span className="log-best-game">{g.title}</span>
              <span className="log-best-score">◆ {bests[g.id].toLocaleString()}</span>
              <span className="log-best-rank">{scoreRank(bests[g.id])}</span>
            </div>
          ))}
        </div>

        {log.length > 0 ? (
          <ol className="log-list">
            {log.slice(0, LIST_MAX).map((e, i) => (
              <li key={`${e.ts}-${i}`} className="log-row">
                <span className="log-row-date">{dateLabel(e.ts)}</span>
                <span className="log-row-game">
                  {gameTitle(e.gameId)}
                  <span className="log-row-diff"> · {getDifficulty(e.diffId).label}</span>
                  {e.daily && <span className="log-badge daily">DAILY</span>}
                  {e.practice && <span className="log-badge practice">PRACTICE</span>}
                </span>
                <span className="log-row-emoji">{emojiRow(e)}</span>
                <span className="log-row-score">
                  {e.total.toLocaleString()}
                  <span className="log-row-max"> / {e.maxTotal.toLocaleString()}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="log-empty">No missions on record yet. Fly one.</p>
        )}
      </div>
    </div>
  );
}
