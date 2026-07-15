import { useEffect, useMemo, useState } from 'react';
import GuessMap from './components/GuessMap';
import TileViewer from './components/TileViewer';
import { AboutModal, Credits } from './components/AboutModal';
import { useCountUp } from './hooks/useCountUp';
import { GAMES, cellRating, loadGameData, pickTargets, roomName, tileUrl } from './data';
import { DIFFICULTIES, ROUNDS_PER_RUN, cellDistance, getDifficulty, maxForRating, rankFlavor, revealFlavor, scoreRank, scoreRound } from './scoring';
import { GAME_URL, buildShareText } from './share';
import { buildShareImage, downloadBlob } from './shareImage';
import type { Cell, GameData, RoundResult, RoundTarget } from './types';

type Phase = 'menu' | 'loading' | 'guessing' | 'reveal' | 'summary';

/** fixed background flare: starfield + CRT scanlines + sweep bar.
 *  The green haze only shows on the title screen, and cross-fades out when
 *  leaving it (BackdropFX persists across phases, so the transition fires). */
function BackdropFX({ phase }: { phase: Phase }) {
  const hazeOn = phase === 'menu' || phase === 'loading';
  return (
    <div className="fx-layer">
      <div className="stars" />
      <div className="fx-grid" />
      <div className={`fx-haze${hazeOn ? ' on' : ''}`}>
        <div className="fx-haze__glow" />
      </div>
      <div className="fx-scanlines" />
      <div className="fx-scanbar" />
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('menu');
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<RoundTarget[]>([]);
  const [round, setRound] = useState(0);
  const [selected, setSelected] = useState<{ areaId: string; cell: Cell } | null>(null);
  const [viewingAreaId, setViewingAreaId] = useState<string | null>(null);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [best, setBest] = useState<number>(() => Number(localStorage.getItem('zg-best') ?? 0));
  const [difficultyId, setDifficultyId] = useState<string>(() => localStorage.getItem('zg-difficulty') ?? 'recruit');
  const [selectedGameId, setSelectedGameId] = useState<string>(() => GAMES.find((g) => g.available)?.id ?? GAMES[0].id);
  const [debug, setDebug] = useState(false);
  const [editIcons, setEditIcons] = useState(false);
  const [showTiles, setShowTiles] = useState(false);
  const [hoverTile, setHoverTile] = useState<{ areaId: string; cell: Cell; name?: string } | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [cheatEnabled, setCheatEnabled] = useState(() => localStorage.getItem('zg-cheat') === '1');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [imgState, setImgState] = useState<'idle' | 'saved' | 'error'>('idle');

  const difficulty = getDifficulty(difficultyId);
  const total = results.reduce((s, r) => s + r.score, 0);

  // Hooks must run unconditionally (before any early return): pre-compute the
  // reveal result + the two count-ups here.
  const revealResult = phase === 'reveal' ? results[results.length - 1] : null;
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
    localStorage.setItem('zg-difficulty', id);
  }

  function unlockCheat() {
    setCheatEnabled(true);
    localStorage.setItem('zg-cheat', '1');
  }

  async function startGame(gameId: string) {
    setPhase('loading');
    setError(null);
    try {
      const d = await loadGameData(gameId);
      setData(d);
      setTargets(pickTargets(d, ROUNDS_PER_RUN, difficulty));
      setRound(0);
      setResults([]);
      setSelected(null);
      setPhase('guessing');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('menu');
    }
  }

  async function onCopyText() {
    if (!data) return;
    const text = buildShareText(data, results, total, difficulty);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('error'); // clipboard blocked (denied permission / insecure context)
    }
    setTimeout(() => setCopyState('idle'), 2000);
  }

  async function onShareImage() {
    if (!data) return;
    const maxTotal = results.reduce((s, r) => s + maxForRating(r.rating), 0);
    const blob = await buildShareImage({ data, results, total, maxTotal, difficulty });
    if (!blob) {
      setImgState('error');
      setTimeout(() => setImgState('idle'), 2000);
      return;
    }
    const file = new File([blob], 'zebesguessr.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], url: GAME_URL });
        return; // OS share sheet handled it — no toast needed
      }
      downloadBlob(blob, 'zebesguessr.png'); // no share sheet → save the PNG
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // user cancelled the sheet
      downloadBlob(blob, 'zebesguessr.png'); // share failed → fall back to a download
    }
    setImgState('saved');
    setTimeout(() => setImgState('idle'), 2000);
  }

  const canSubmit = !!selected && (!viewingAreaId || selected.areaId === viewingAreaId);

  function submitGuess() {
    if (!data || !selected || !canSubmit) return;
    const target = targets[round];
    const rating = cellRating(data, target.areaId, target.cell);
    const distance = cellDistance(target, selected);
    const tn = roomName(data, target);
    const sameRoom = !!tn && target.areaId === selected.areaId && tn === roomName(data, selected);
    const result: RoundResult = {
      target,
      guess: selected,
      rating,
      distance,
      score: scoreRound(distance, rating, sameRoom)
    };
    setResults((r) => [...r, result]);
    setPhase('reveal');
  }

  function nextRound() {
    if (round + 1 >= targets.length) {
      setPhase('summary');
    } else {
      setRound((r) => r + 1);
      setSelected(null);
      setPhase('guessing');
    }
  }

  useEffect(() => {
    if (phase === 'summary' && total > best) {
      setBest(total);
      localStorage.setItem('zg-best', String(total));
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      if (phase === 'guessing' && canSubmit) {
        submitGuess();
      } else if (phase === 'reveal') {
        nextRound();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- MENU
  if (phase === 'menu' || phase === 'loading') {
    return (
      <div className="shell menu">
        <BackdropFX phase={phase} />
        <p className="kicker">CHOZO PLANETARY ARCHIVE // SECTOR ZEBES</p>
        <h1 className="logo">ZebesGuessr</h1>
        <p className="tagline">
          You woke up somewhere on the planet. <em>Where?</em>
        </p>
        {error && <p className="error">{error}</p>}

        <div style={{ width: '100%', maxWidth: 760 }}>
          <p className="loadout-label">◇ CHOOSE YOUR MISSION ◇</p>

          <div className="game-list">
            {GAMES.map((g) => (
              <button key={g.id} className={`game-btn ${g.id === selectedGameId ? 'active' : ''}`} disabled={!g.available || phase === 'loading'} onClick={() => setSelectedGameId(g.id)}>
                <span>{g.title}</span>
                {!g.available && <span className="standby">STANDBY</span>}
              </button>
            ))}
          </div>

          <p className="loadout-label">◇ CHOOSE YOUR DIFFICULTY ◇</p>

          <div className="diff-row">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                className={`diff-btn ${d.id === difficultyId ? 'active' : ''}`}
                onClick={() => pickDifficulty(d.id)}
                title={`Draws screens rated ${d.min}–${d.max} of 5; obscure screens score more`}
              >
                {d.label}
                <span className="diff-hint">{d.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {phase === 'loading' && (
          <p className="init">
            INITIALIZING ARCHIVE<span className="cursor">_</span>
          </p>
        )}
        <button className="btn primary start" disabled={phase === 'loading'} onClick={() => startGame(selectedGameId)}>
          ▶ START MISSION
        </button>
        {best > 0 && <p className="best">◆ PERSONAL BEST&nbsp;&nbsp;{best.toLocaleString()}</p>}
        <Credits onAbout={() => setShowAbout(true)} />
        {showAbout && <AboutModal onClose={() => setShowAbout(false)} onUnlockCheat={unlockCheat} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- SUMMARY
  if (phase === 'summary' && data) {
    const maxTotal = results.reduce((s, r) => s + maxForRating(r.rating), 0);
    return (
      <div className="shell menu summary">
        <BackdropFX phase={phase} />
        <div className="debrief-grid">
          <div className="debrief-hero">
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
            <p className="sign-off">SEE YOU NEXT MISSION</p>
          </div>

          <ol className="round-list">
            {results.map((r, i) => {
              const per = maxForRating(r.rating);
              const pct = Math.max(0, Math.min(1, r.score / per));
              const dist = !isFinite(r.distance) ? 'wrong area' : r.distance === 0 ? 'exact!' : `${r.distance.toFixed(1)} cells off`;
              const rn = roomName(data, r.target);
              return (
                <li key={i} className="round-card" style={{ animationDelay: `${i * 0.06}s` }}>
                  <div className="round-head">
                    <span className="round-info">
                      <span className="round-idx">{i + 1}.</span> <span className="round-area">{areaName(data, r.target.areaId)}</span> <span className="round-dist">{dist}</span>
                    </span>
                    <span className="round-score">{r.score.toLocaleString()}</span>
                  </div>
                  <div className="round-sub">
                    {rn && <span className="round-room">“{rn}”</span>}
                    <span className="round-stars" title={`Difficulty ${r.rating}/5`}>
                      <span className="round-stars-label">DIFFICULTY</span> {'★'.repeat(r.rating)}
                      {'☆'.repeat(5 - r.rating)}
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="summary-note">Tougher screens are worth more — play the hardest difficulty to max out your score.</p>

        <div className="summary-actions">
          <button className="btn secondary share" onClick={onCopyText}>
            {copyState === 'copied' ? '✓ COPIED' : copyState === 'error' ? '✗ TRY AGAIN' : '⎘ COPY TEXT'}
          </button>
          <button className="btn secondary share" onClick={onShareImage}>
            {imgState === 'saved' ? '✓ SAVED' : imgState === 'error' ? '✗ TRY AGAIN' : '⇪ SHARE IMAGE'}
          </button>
          <button className="btn primary" onClick={() => startGame(data.game)}>
            ▶ PLAY AGAIN
          </button>
          <button className="btn secondary" onClick={() => setPhase('menu')}>
            MENU
          </button>
          <button className="btn secondary" onClick={() => setShowAbout(true)}>
            ABOUT
          </button>
        </div>
        <Credits onAbout={() => setShowAbout(true)} />
        {showAbout && <AboutModal onClose={() => setShowAbout(false)} onUnlockCheat={unlockCheat} />}
      </div>
    );
  }

  if (!data) return null;
  const target = targets[round];
  const result = revealResult;
  const hoverHasTile = hoverTile && playable.get(hoverTile.areaId)?.has(`${hoverTile.cell.x},${hoverTile.cell.y}`);

  // ---------------------------------------------------------------- GAME
  return (
    <div className="shell game">
      <BackdropFX phase={phase} />
      <header className="hud">
        <span className="logo small">ZebesGuessr</span>
        <span className="hud-sub">LOCATOR</span>
        <div className="hud-center">
          <div className="pips">
            {targets.map((_, i) => (
              <span key={i} className={`pip ${i < round ? 'past' : i === round ? 'current' : 'future'}`} />
            ))}
          </div>
          <span className="round-label">
            ROUND {round + 1}/{targets.length}
          </span>
        </div>
        <div className="hud-right">
          <div className="score-readout">
            <div className="score-label">SCORE</div>
            <div className="score-value">{total.toLocaleString()}</div>
          </div>
          {(import.meta.env.DEV || cheatEnabled) && (
            <button className={`btn toggle ${debug ? 'active' : ''}`} onClick={() => setDebug((d) => !d)} title="Show the real screen for hovered map cells">
              debug
            </button>
          )}
          {import.meta.env.DEV && (
            <>
              <button className={`btn toggle ${editIcons ? 'active' : ''}`} onClick={() => setEditIcons((e) => !e)} title="Place/erase landmark icons, then Save to file">
                icons
              </button>
              <button className={`btn toggle ${showTiles ? 'active' : ''}`} onClick={() => setShowTiles((t) => !t)} title="Overlay the real game screens on the map (aids the Diff tool)">
                tiles
              </button>
              <button className="btn toggle" onClick={() => loadGameData(data.game).then(setData)} title="Re-fetch data/<game>.json without losing round state (for tweaking map data by hand)">
                reload
              </button>
            </>
          )}
        </div>
      </header>

      <div className="panes">
        <section className="pane left">
          <TileViewer tileUrl={tileUrl(data, target)} revealed={phase === 'reveal'} />

          {phase === 'reveal' && result && (
            <div className="reveal-box">
              <p className="reveal-label">LOCATION CONFIRMED</p>
              <p className="reveal-area">{areaName(data, result.target.areaId)}</p>
              {roomName(data, result.target) && <p className="reveal-room">“{roomName(data, result.target)}”</p>}
              <p className="reveal-rating">
                DIFFICULTY{' '}
                <span className="rating-stars">
                  {'★'.repeat(result.rating)}
                  {'☆'.repeat(5 - result.rating)}
                </span>
              </p>
              <p className="reveal-dist">{isFinite(result.distance) ? (result.distance === 0 ? 'Exact cell.' : `${result.distance.toFixed(1)} cells away`) : 'Wrong area entirely.'}</p>
              <div className="reveal-scoreline">
                <span className="reveal-score">{shownRoundScore.toLocaleString()}</span>
                <span className="reveal-pts">PTS</span>
              </div>
              <p className="reveal-flavor">{revealFlavor(result.distance)}</p>
              <button className="btn next" onClick={nextRound}>
                {round + 1 >= targets.length ? '◇ SEE RESULTS ↵' : 'NEXT ROUND ▶ ↵'}
              </button>
            </div>
          )}

          {phase === 'guessing' && (
            <button className="btn confirm" disabled={!canSubmit} onClick={submitGuess}>
              {!selected ? 'SELECT A LOCATION' : canSubmit ? '▶ TRANSMIT GUESS ↵' : 'RETURN TO YOUR GUESS TO TRANSMIT'}
            </button>
          )}

          {debug && (
            <div className="debug-panel">
              <p className="debug-title">debug: hovered cell</p>
              {hoverTile && hoverHasTile ? (
                <>
                  <p className="debug-coords">
                    {areaName(data, hoverTile.areaId)} ({hoverTile.cell.x},{hoverTile.cell.y})
                    {hoverTile.name ? (
                      <>
                        {' '}
                        — <strong>{hoverTile.name}</strong>
                      </>
                    ) : (
                      ' — (unnamed)'
                    )}
                  </p>
                  <img src={tileUrl(data, { areaId: hoverTile.areaId, cell: hoverTile.cell })} alt="hovered screen" />
                </>
              ) : hoverTile ? (
                <p className="debug-coords">
                  {areaName(data, hoverTile.areaId)} ({hoverTile.cell.x},{hoverTile.cell.y}) — no screen for this cell (map-only)
                </p>
              ) : (
                <p className="debug-coords">hover the map…</p>
              )}
            </div>
          )}
        </section>

        <section className={`pane right${phase === 'reveal' ? ' map-hidden' : ''}`}>
          <GuessMap
            data={data}
            selected={selected}
            onSelect={(areaId, cell) => setSelected({ areaId, cell })}
            onHoverCell={(areaId, cell, name) => setHoverTile(cell ? { areaId, cell, name } : null)}
            onAreaChange={setViewingAreaId}
            result={result}
            editing={editIcons}
            showTiles={showTiles}
          />
        </section>
      </div>
    </div>
  );
}

function areaName(data: GameData, areaId: string): string {
  return data.areas.find((a) => a.id === areaId)?.name ?? areaId;
}
