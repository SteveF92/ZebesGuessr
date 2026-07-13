import { useEffect, useMemo, useState } from "react";
import GuessMap from "./components/GuessMap";
import TileViewer from "./components/TileViewer";
import { useCountUp } from "./hooks/useCountUp";
import { GAMES, loadGameData, pickTargets, roomName, tileUrl } from "./data";
import {
  DIFFICULTIES, MAX_SCORE, ROUNDS_PER_RUN,
  cellDistance, getDifficulty, rankFlavor, revealFlavor, scoreRank, scoreRound,
} from "./scoring";
import type { Cell, GameData, RoundResult, RoundTarget } from "./types";

type Phase = "menu" | "loading" | "guessing" | "reveal" | "summary";

/** fixed background flare: starfield + CRT scanlines + sweep bar */
function BackdropFX() {
  return (
    <>
      <div className="stars" />
      <div className="fx-scanlines" />
      <div className="fx-flicker" />
      <div className="fx-scanbar" />
    </>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<RoundTarget[]>([]);
  const [round, setRound] = useState(0);
  const [selected, setSelected] = useState<{ areaId: string; cell: Cell } | null>(null);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [best, setBest] = useState<number>(() => Number(localStorage.getItem("zg-best") ?? 0));
  const [difficultyId, setDifficultyId] = useState<string>(
    () => localStorage.getItem("zg-difficulty") ?? "hunter"
  );
  const [debug, setDebug] = useState(false);
  const [editIcons, setEditIcons] = useState(false);
  const [hoverTile, setHoverTile] = useState<{ areaId: string; cell: Cell } | null>(null);

  const difficulty = getDifficulty(difficultyId);
  const total = results.reduce((s, r) => s + r.score, 0);

  // Hooks must run unconditionally (before any early return): pre-compute the
  // reveal result + the two count-ups here.
  const revealResult = phase === "reveal" ? results[results.length - 1] : null;
  const shownRoundScore = Math.round(useCountUp(revealResult?.score ?? 0, 900, [revealResult]));
  const shownTotal = Math.round(useCountUp(total, 1200, [phase]));

  const playable = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of data?.areas ?? []) {
      m.set(a.id, new Set(a.cells.map((c) => `${c.x},${c.y}`)));
    }
    return m;
  }, [data]);

  function pickDifficulty(id: string) {
    setDifficultyId(id);
    localStorage.setItem("zg-difficulty", id);
  }

  async function startGame(gameId: string) {
    setPhase("loading");
    setError(null);
    try {
      const d = await loadGameData(gameId);
      setData(d);
      setTargets(pickTargets(d, ROUNDS_PER_RUN));
      setRound(0);
      setResults([]);
      setSelected(null);
      setPhase("guessing");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("menu");
    }
  }

  function submitGuess() {
    if (!data || !selected) return;
    const target = targets[round];
    const result: RoundResult = {
      target,
      guess: selected,
      difficulty: difficulty.id,
      distance: cellDistance(target, selected),
      score: scoreRound(target, selected, difficulty),
    };
    setResults((r) => [...r, result]);
    setPhase("reveal");
  }

  function nextRound() {
    if (round + 1 >= targets.length) {
      setPhase("summary");
    } else {
      setRound((r) => r + 1);
      setSelected(null);
      setPhase("guessing");
    }
  }

  useEffect(() => {
    if (phase === "summary" && total > best) {
      setBest(total);
      localStorage.setItem("zg-best", String(total));
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- MENU
  if (phase === "menu" || phase === "loading") {
    return (
      <div className="shell menu">
        <BackdropFX />
        <p className="kicker">CHOZO PLANETARY ARCHIVE // SECTOR ZEBES</p>
        <h1 className="logo">ZebesGuessr</h1>
        <p className="tagline">
          You woke up somewhere on the planet. <em>Where?</em>
        </p>
        {error && <p className="error">{error}</p>}

        <div style={{ width: "100%", maxWidth: 560 }}>
          <p className="loadout-label">◇ SUIT LOADOUT ◇</p>
          <div className="diff-row">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                className={`diff-btn ${d.id === difficultyId ? "active" : ""}`}
                onClick={() => pickDifficulty(d.id)}
                title={`${Math.round(d.crop * 100)}% of the screen shown, ×${d.mult} score`}
              >
                {d.label}
                <span className="diff-hint">{Math.round(d.crop * 100)}% VIEW · ×{d.mult}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="game-list">
          {GAMES.map((g) => (
            <button
              key={g.id}
              className="game-btn"
              disabled={!g.available || phase === "loading"}
              onClick={() => startGame(g.id)}
            >
              <span>{g.title}</span>
              {!g.available && <span className="standby">STANDBY</span>}
            </button>
          ))}
        </div>

        {phase === "loading" && (
          <p className="init">INITIALIZING ARCHIVE<span className="cursor">_</span></p>
        )}
        {best > 0 && <p className="best">◆ PERSONAL BEST&nbsp;&nbsp;{best.toLocaleString()}</p>}
        <Credits />
      </div>
    );
  }

  // ---------------------------------------------------------------- SUMMARY
  if (phase === "summary" && data) {
    const maxTotal = Math.round(MAX_SCORE * difficulty.mult) * ROUNDS_PER_RUN;
    return (
      <div className="shell menu">
        <BackdropFX />
        <p className="debrief-kicker">◇ MISSION DEBRIEF ◇</p>
        <h1 className="logo">RUN COMPLETE</h1>
        <p className="total">
          {shownTotal.toLocaleString()} <span className="max">/ {maxTotal.toLocaleString()}</span>
        </p>
        <div className="rank-block">
          <p className="rank">{scoreRank(total)}</p>
          <p className="rank-flavor">{rankFlavor(total)}</p>
        </div>
        {total >= best && total > 0 && <div className="newbest">★ NEW PERSONAL BEST ★</div>}

        <ol className="round-list">
          {results.map((r, i) => {
            const per = MAX_SCORE * getDifficulty(r.difficulty).mult;
            const pct = Math.max(0, Math.min(1, r.score / per));
            const dist = !isFinite(r.distance)
              ? "wrong area"
              : r.distance === 0
                ? "exact!"
                : `${r.distance.toFixed(1)} cells off`;
            return (
              <li key={i} className="round-card" style={{ animationDelay: `${i * 0.06}s` }}>
                <div className="round-head">
                  <span className="round-info">
                    <span className="round-idx">{i + 1}.</span>{" "}
                    <span className="round-area">{areaName(data, r.target.areaId)}</span>{" "}
                    <span className="round-dist">{dist}</span>
                  </span>
                  <span className="round-score">{r.score.toLocaleString()}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${pct * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ol>

        <div className="summary-actions">
          <button className="btn primary" onClick={() => startGame(data.game)}>▶ PLAY AGAIN</button>
          <button className="btn secondary" onClick={() => setPhase("menu")}>MENU</button>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const target = targets[round];
  const result = revealResult;
  const hoverHasTile =
    hoverTile && playable.get(hoverTile.areaId)?.has(`${hoverTile.cell.x},${hoverTile.cell.y}`);

  // ---------------------------------------------------------------- GAME
  return (
    <div className="shell game">
      <BackdropFX />
      <header className="hud">
        <span className="logo small">ZebesGuessr</span>
        <span className="hud-sub">LOCATOR</span>
        <div className="hud-center">
          <div className="pips">
            {targets.map((_, i) => (
              <span
                key={i}
                className={`pip ${i < round ? "past" : i === round ? "current" : "future"}`}
              />
            ))}
          </div>
          <span className="round-label">ROUND {round + 1}/{targets.length}</span>
        </div>
        <div className="hud-right">
          <div className="score-readout">
            <div className="score-label">SCORE</div>
            <div className="score-value">{total.toLocaleString()}</div>
          </div>
          <button
            className={`btn toggle ${debug ? "active" : ""}`}
            onClick={() => setDebug((d) => !d)}
            title="Show the real screen for hovered map cells"
          >
            debug
          </button>
          <button
            className={`btn toggle ${editIcons ? "active" : ""}`}
            onClick={() => setEditIcons((e) => !e)}
            title="Place/erase landmark icons, then Save to file"
          >
            icons
          </button>
        </div>
      </header>

      <div className="panes">
        <section className="pane left">
          <TileViewer
            tileUrl={tileUrl(data, target)}
            crop={difficulty.crop}
            revealed={phase === "reveal"}
          />

          {phase === "reveal" && result && (
            <div className="reveal-box">
              <p className="reveal-label">LOCATION CONFIRMED</p>
              <p className="reveal-area">{areaName(data, result.target.areaId)}</p>
              {roomName(data, result.target) && (
                <p className="reveal-room">“{roomName(data, result.target)}”</p>
              )}
              <p className="reveal-dist">
                {isFinite(result.distance)
                  ? result.distance === 0
                    ? "Exact cell."
                    : `${result.distance.toFixed(1)} cells away`
                  : "Wrong area entirely."}
              </p>
              <div className="reveal-scoreline">
                <span className="reveal-score">{shownRoundScore.toLocaleString()}</span>
                <span className="reveal-pts">PTS</span>
              </div>
              <p className="reveal-flavor">{revealFlavor(result.distance)}</p>
              <button className="btn next" onClick={nextRound}>
                {round + 1 >= targets.length ? "◇ SEE RESULTS" : "NEXT ROUND ▶"}
              </button>
            </div>
          )}

          {phase === "guessing" && (
            <button className="btn confirm" disabled={!selected} onClick={submitGuess}>
              {selected ? "▶ TRANSMIT GUESS" : "SELECT A LOCATION"}
            </button>
          )}

          {debug && (
            <div className="debug-panel">
              <p className="debug-title">debug: hovered cell</p>
              {hoverTile && hoverHasTile ? (
                <>
                  <p className="debug-coords">
                    {areaName(data, hoverTile.areaId)} ({hoverTile.cell.x},{hoverTile.cell.y})
                  </p>
                  <img
                    src={tileUrl(data, { areaId: hoverTile.areaId, cell: hoverTile.cell })}
                    alt="hovered screen"
                  />
                </>
              ) : hoverTile ? (
                <p className="debug-coords">
                  {areaName(data, hoverTile.areaId)} ({hoverTile.cell.x},{hoverTile.cell.y}) — no
                  screen for this cell (map-only)
                </p>
              ) : (
                <p className="debug-coords">hover the map…</p>
              )}
            </div>
          )}
        </section>

        <section className="pane right">
          <GuessMap
            data={data}
            selected={selected}
            onSelect={(areaId, cell) => setSelected({ areaId, cell })}
            onHoverCell={(areaId, cell) => setHoverTile(cell ? { areaId, cell } : null)}
            result={result}
            editing={editIcons}
          />
        </section>
      </div>
    </div>
  );
}

function areaName(data: GameData, areaId: string): string {
  return data.areas.find((a) => a.id === areaId)?.name ?? areaId;
}

function Credits() {
  return (
    <footer className="credits">
      <p>
        A non-commercial fan project. Metroid and all game imagery © Nintendo.
        Maps by Rick Bruns (<a href="https://www.snesmaps.com">snesmaps.com</a>) and the{" "}
        <a href="https://www.vgmaps.com">VGMaps</a> community. Not affiliated with Nintendo.
      </p>
    </footer>
  );
}
