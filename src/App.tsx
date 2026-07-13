import { useEffect, useState } from "react";
import GuessMap from "./components/GuessMap";
import TileViewer from "./components/TileViewer";
import { GAMES, loadGameData, pickTargets, roomName, tileUrl } from "./data";
import { MAX_SCORE, ROUNDS_PER_RUN, cellDistance, scoreRank, scoreRound } from "./scoring";
import type { Cell, GameData, RoundResult, RoundTarget } from "./types";

type Phase = "menu" | "loading" | "guessing" | "reveal" | "summary";

export default function App() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<RoundTarget[]>([]);
  const [round, setRound] = useState(0);
  const [zoomStep, setZoomStep] = useState(0);
  const [selected, setSelected] = useState<{ areaId: string; cell: Cell } | null>(null);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [best, setBest] = useState<number>(() => Number(localStorage.getItem("zg-best") ?? 0));

  async function startGame(gameId: string) {
    setPhase("loading");
    setError(null);
    try {
      const d = await loadGameData(gameId);
      setData(d);
      setTargets(pickTargets(d, ROUNDS_PER_RUN));
      setRound(0);
      setResults([]);
      setZoomStep(0);
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
      zoomStep,
      distance: cellDistance(target, selected),
      score: scoreRound(target, selected, zoomStep),
    };
    setResults((r) => [...r, result]);
    setPhase("reveal");
  }

  function nextRound() {
    if (round + 1 >= targets.length) {
      setPhase("summary");
    } else {
      setRound((r) => r + 1);
      setZoomStep(0);
      setSelected(null);
      setPhase("guessing");
    }
  }

  const total = results.reduce((s, r) => s + r.score, 0);

  useEffect(() => {
    if (phase === "summary" && total > best) {
      setBest(total);
      localStorage.setItem("zg-best", String(total));
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "menu" || phase === "loading") {
    return (
      <div className="shell menu">
        <h1 className="logo">ZebesGuessr</h1>
        <p className="tagline">You woke up somewhere on the planet. Where?</p>
        {error && <p className="error">{error}</p>}
        <div className="game-list">
          {GAMES.map((g) => (
            <button
              key={g.id}
              className="btn game-btn"
              disabled={!g.available || phase === "loading"}
              onClick={() => startGame(g.id)}
            >
              {g.title}
              {!g.available && <span className="soon"> — coming soon</span>}
            </button>
          ))}
        </div>
        {best > 0 && <p className="best">Personal best: {best.toLocaleString()}</p>}
        <Credits />
      </div>
    );
  }

  if (phase === "summary" && data) {
    return (
      <div className="shell menu">
        <h1 className="logo">Run complete</h1>
        <p className="total">
          {total.toLocaleString()} / {(MAX_SCORE * ROUNDS_PER_RUN).toLocaleString()}
        </p>
        <p className="rank">{scoreRank(total)}</p>
        <ol className="round-list">
          {results.map((r, i) => (
            <li key={i}>
              {areaName(data, r.target.areaId)}
              {roomName(data, r.target) ? ` — ${roomName(data, r.target)}` : ""}:{" "}
              {isFinite(r.distance)
                ? r.distance === 0
                  ? "exact!"
                  : `${r.distance.toFixed(1)} cells off`
                : "wrong area"}{" "}
              → <strong>{r.score.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
        {total >= best && total > 0 && <p className="best">New personal best!</p>}
        <button className="btn" onClick={() => startGame(data.game)}>Play again</button>{" "}
        <button className="btn secondary" onClick={() => setPhase("menu")}>Menu</button>
      </div>
    );
  }

  if (!data) return null;
  const target = targets[round];
  const result = phase === "reveal" ? results[results.length - 1] : null;

  return (
    <div className="shell game">
      <header className="hud">
        <span className="logo small">ZebesGuessr</span>
        <span>Round {round + 1}/{targets.length}</span>
        <span>Score {total.toLocaleString()}</span>
      </header>
      <div className="panes">
        <section className="pane left">
          <TileViewer
            tileUrl={tileUrl(data, target)}
            zoomStep={zoomStep}
            onZoomOut={() => setZoomStep((z) => z + 1)}
            revealed={phase === "reveal"}
          />
          {phase === "reveal" && result && (
            <div className="reveal-box">
              <p>
                <strong>{areaName(data, result.target.areaId)}</strong>
                {roomName(data, result.target) ? ` — “${roomName(data, result.target)}”` : ""}
              </p>
              <p>
                {isFinite(result.distance)
                  ? result.distance === 0
                    ? "Exact cell. Chozo blood runs in your veins."
                    : `${result.distance.toFixed(1)} cells away`
                  : "Wrong area entirely."}{" "}
                → <strong>{result.score.toLocaleString()} pts</strong>
              </p>
              <button className="btn" onClick={nextRound}>
                {round + 1 >= targets.length ? "See results" : "Next round"}
              </button>
            </div>
          )}
          {phase === "guessing" && (
            <button className="btn confirm" disabled={!selected} onClick={submitGuess}>
              {selected ? "Confirm guess" : "Click the map to guess"}
            </button>
          )}
        </section>
        <section className="pane right">
          <GuessMap data={data} selected={selected} onSelect={(areaId, cell) => setSelected({ areaId, cell })} result={result} />
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
