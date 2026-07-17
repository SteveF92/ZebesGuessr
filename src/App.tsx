import { useEffect, useMemo, useState } from 'react';
import GuessMap from './components/GuessMap';
import TileViewer from './components/TileViewer';
import { AboutModal, Credits } from './components/AboutModal';
import { SeedEntryModal } from './components/SeedEntryModal';
import { CreateSeed } from './components/CreateSeed';
import { HoverScan } from './components/HoverScan';
import { useCountUp } from './hooks/useCountUp';
import { useTypewriter } from './hooks/useTypewriter';
import { GAMES, areaName, cellPool, cellRating, indicesFromTargets, loadGameData, pickTargets, roomName, targetsFromIndices, tileUrl } from './data';
import { DIFFICULTIES, ROUNDS_PER_RUN, cellDistance, computeUnlocks, getDifficulty, maxForRating, rankFlavor, revealFlavor, scoreRank, scoreRound } from './scoring';
import type { Unlocks } from './scoring';

// Display labels for the acquired banner, in progression order. The Prime-style
// banner reads "<label> ACQUIRED", so these name the feature, not its gate.
const UNLOCK_LABELS: Record<keyof Unlocks, string> = {
  enterSeed: 'Enter Seed',
  scan: 'Scan Visor',
  xray: 'X-Ray Visor',
  create: 'Create Seed'
};
const UNLOCK_ORDER: (keyof Unlocks)[] = ['enterSeed', 'scan', 'xray', 'create'];
import { ShareModal } from './components/ShareModal';
import { type Seed, decodeSeed, encodeSeed } from './seed';
import type { Cell, GameData, RoundResult, RoundTarget } from './types';

type Phase = 'menu' | 'loading' | 'creating' | 'guessing' | 'reveal' | 'summary';

/** On phones the reveal plays as two beats: first the map (so you see where the
 *  room actually was), then the result card. Desktop shows both at once and
 *  ignores this. Time in ms the map beat holds before auto-advancing. */
const REVEAL_MAP_MS = 2400;
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 800px)').matches;

/** Read a `?seed=` code from the URL and decode it (null if absent/malformed). */
function readSeedFromUrl(): Seed | null {
  const code = new URLSearchParams(window.location.search).get('seed');
  return code ? decodeSeed(code) : null;
}

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
  const [loadedSeed, setLoadedSeed] = useState<Seed | null>(readSeedFromUrl);
  const [activeSeedCode, setActiveSeedCode] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('menu');
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<RoundTarget[]>([]);
  const [round, setRound] = useState(0);
  const [selected, setSelected] = useState<{ areaId: string; cell: Cell } | null>(null);
  const [viewingAreaId, setViewingAreaId] = useState<string | null>(null);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [best, setBest] = useState<number>(() => Number(localStorage.getItem('zg-best') ?? 0));
  const [difficultyId, setDifficultyId] = useState<string>(() => (loadedSeed ? DIFFICULTIES[loadedSeed.diffIndex]?.id : null) ?? localStorage.getItem('zg-difficulty') ?? 'tallon');
  const [selectedGameId, setSelectedGameId] = useState<string>(() => (loadedSeed ? GAMES[loadedSeed.gameIndex]?.id : null) ?? GAMES.find((g) => g.available)?.id ?? GAMES[0].id);
  const [debug, setDebug] = useState(false);
  const [editIcons, setEditIcons] = useState(false);
  const [showTiles, setShowTiles] = useState(false);
  const [hoverTile, setHoverTile] = useState<{ areaId: string; cell: Cell; name?: string } | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showSeedEntry, setShowSeedEntry] = useState(false);
  // Two cheat codes, each a permanent unlock. The legacy `zg-cheat` flag only
  // ever unlocked the scan, so fold it into JUSTIN BAILEY (both visors).
  const [cheatJB, setCheatJB] = useState(() => localStorage.getItem('zg-cheat-jb') === '1' || localStorage.getItem('zg-cheat') === '1');
  const [cheatNarpas, setCheatNarpas] = useState(() => localStorage.getItem('zg-cheat-narpas') === '1');
  // Latches true the moment a visor is switched on during a run, so the run
  // can't set a personal best. Reset at the start of each run.
  const [visorsUsed, setVisorsUsed] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // Features whose gate this run just crossed — drives the Prime-style acquired
  // banner on the summary. Populated once when we bump the PB; cleared per run.
  const [justUnlocked, setJustUnlocked] = useState<(keyof Unlocks)[]>([]);
  // Which beat of the reveal we're on (phones only — desktop shows both at once).
  const [revealStage, setRevealStage] = useState<'map' | 'result'>('result');

  const difficulty = getDifficulty(difficultyId);
  const total = results.reduce((s, r) => s + r.score, 0);
  // What the player has earned: the four unlockables, off the sticky PB plus the
  // two cheat flags. DEV keeps everything on so the editor/dev tools stay handy.
  const unlocks = useMemo(() => computeUnlocks(best, { jb: cheatJB, narpas: cheatNarpas }), [best, cheatJB, cheatNarpas]);

  // Hooks must run unconditionally (before any early return): pre-compute the
  // reveal result + the two count-ups here.
  const revealResult = phase === 'reveal' ? results[results.length - 1] : null;
  // The result card is always visible on desktop; on phones only during the
  // second reveal beat. Gate the score count-up on that so it animates when the
  // card actually appears rather than finishing behind the map beat.
  const cardVisible = phase === 'reveal' && revealStage === 'result';
  const shownRoundScore = Math.round(useCountUp(cardVisible ? (revealResult?.score ?? 0) : 0, 900, [revealResult, cardVisible]));
  const shownTotal = Math.round(useCountUp(total, 1200, [phase]));
  // Scan-log typewriter for the reveal card's flavor line, gated like the
  // score count-up so it starts when the card actually appears.
  const shownFlavor = useTypewriter(revealResult ? revealFlavor(revealResult.distance) : '', cardVisible);

  function pickDifficulty(id: string) {
    setDifficultyId(id);
    localStorage.setItem('zg-difficulty', id);
  }

  function unlockCheat(which: 'jb' | 'narpas') {
    if (which === 'jb') {
      setCheatJB(true);
      localStorage.setItem('zg-cheat-jb', '1');
    } else {
      setCheatNarpas(true);
      localStorage.setItem('zg-cheat-narpas', '1');
    }
  }

  async function startGame(gameId: string, runSeed: Seed | null = loadedSeed) {
    setPhase('loading');
    setError(null);
    try {
      const d = await loadGameData(gameId);
      setData(d);
      // Every run is an explicit five-tile list. A loaded seed replays its
      // tiles; a fresh run lets pickTargets choose, then encodes those tiles —
      // so the code held for sharing at the summary always round-trips.
      const gameIndex = GAMES.findIndex((g) => g.id === gameId);
      const targets = runSeed ? targetsFromIndices(d, runSeed.indices) : pickTargets(d, ROUNDS_PER_RUN, difficulty, Math.random);
      const indices = runSeed ? runSeed.indices : indicesFromTargets(cellPool(d), targets);
      const diffIndex = runSeed ? runSeed.diffIndex : DIFFICULTIES.findIndex((dd) => dd.id === difficultyId);
      setActiveSeedCode(encodeSeed({ gameIndex, diffIndex, indices }));
      setTargets(targets);
      setRound(0);
      setResults([]);
      setSelected(null);
      setVisorsUsed(false);
      setJustUnlocked([]);
      setPhase('guessing');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('menu');
    }
  }

  /** Load map data, then drop into the hand-pick Create Seed screen. */
  async function startCreate() {
    setPhase('loading');
    setError(null);
    try {
      const d = await loadGameData(selectedGameId);
      setData(d);
      setPhase('creating');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('menu');
    }
  }

  /** Play a hand-picked run: lock the menu to its seed, mirror it into the URL,
   *  and launch — passing the seed explicitly so startGame doesn't race state. */
  function playIndices(indices: number[], diffIndex: number) {
    const gameIndex = GAMES.findIndex((g) => g.id === selectedGameId);
    const seed: Seed = { gameIndex, diffIndex, indices };
    setLoadedSeed(seed);
    setDifficultyId(DIFFICULTIES[diffIndex]?.id ?? difficultyId);
    window.history.replaceState({}, '', '?seed=' + encodeSeed(seed));
    startGame(selectedGameId, seed);
  }

  /** Apply a manually entered seed: lock the menu to it, just like a URL seed. */
  function applySeed(seed: Seed) {
    setLoadedSeed(seed);
    setSelectedGameId(GAMES[seed.gameIndex].id);
    setDifficultyId(DIFFICULTIES[seed.diffIndex].id);
    // Reflect it in the address bar so refresh preserves it and clearSeed can strip it.
    window.history.replaceState({}, '', '?seed=' + encodeSeed(seed));
    setShowSeedEntry(false);
  }

  /** Strip `?seed` from the URL and unlock the menu selectors. */
  function clearSeed() {
    window.history.replaceState({}, '', window.location.pathname);
    setLoadedSeed(null);
    setPhase('menu');
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
    // Phones open the reveal on the map beat; desktop jumps straight to the card
    // (it shows the map alongside anyway).
    setRevealStage(isPhone() ? 'map' : 'result');
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

  // Phone reveal: hold on the map beat, then auto-advance to the result card.
  useEffect(() => {
    if (phase !== 'reveal' || revealStage !== 'map') return;
    const t = setTimeout(() => setRevealStage('result'), REVEAL_MAP_MS);
    return () => clearTimeout(t);
  }, [phase, revealStage]);

  // Flipping on either visor (Scan = debug, X-Ray = showTiles) taints the run so
  // it can't set a PB — the ladder mustn't be climbable with the toys it hands
  // out. Latches; only startGame clears it.
  useEffect(() => {
    if (debug || showTiles) setVisorsUsed(true);
  }, [debug, showTiles]);

  useEffect(() => {
    if (phase === 'summary' && !visorsUsed && total > best) {
      // Diff the unlock set at the old PB against the new one so the banner
      // announces only the gates this run actually pushed past.
      const before = computeUnlocks(best, { jb: cheatJB, narpas: cheatNarpas });
      const after = computeUnlocks(total, { jb: cheatJB, narpas: cheatNarpas });
      setJustUnlocked(UNLOCK_ORDER.filter((k) => after[k] && !before[k]));
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
        <p className="kicker">CHOZO OBSERVATORY // SECTOR ZEBES</p>
        <h1 className="logo">ZebesGuessr</h1>
        <p className="tagline">
          Unidentified signal detected. <em>Locate it.</em>
        </p>
        {error && <p className="error">{error}</p>}

        <div style={{ width: '100%', maxWidth: 760 }}>
          <p className="loadout-label">◇ CHOOSE YOUR MISSION ◇</p>

          <div className="game-list">
            {GAMES.map((g) => (
              <button
                key={g.id}
                className={`game-btn ${g.id === selectedGameId ? 'active' : ''}`}
                disabled={!g.available || phase === 'loading' || !!loadedSeed}
                onClick={() => setSelectedGameId(g.id)}
              >
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
                disabled={!!loadedSeed || phase === 'loading'}
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
        <div className="menu-actions">
          {(import.meta.env.DEV || unlocks.create) && (
            <button className="btn secondary seed-entry-btn menu-btn-create" disabled={phase === 'loading' || !!loadedSeed} onClick={startCreate} title="Hand-pick five screens and share the seed">
              ◈ CREATE SEED
            </button>
          )}
          <button className="btn primary start" disabled={phase === 'loading'} onClick={() => startGame(selectedGameId)}>
            START MISSION ▶
          </button>
          {(import.meta.env.DEV || unlocks.enterSeed) && (
            <button
              className={`btn secondary seed-entry-btn menu-btn-seed${import.meta.env.DEV || unlocks.create ? '' : ' seed-solo'}${loadedSeed ? ' locked' : ''}`}
              onClick={() => setShowSeedEntry(true)}
            >
              {loadedSeed ? '◈ SEED LOCKED' : '◈ SEED ENTRY'}
            </button>
          )}
        </div>
        {best > 0 && <p className="best">◆ PERSONAL BEST&nbsp;&nbsp;{best.toLocaleString()}</p>}
        <Credits onAbout={() => setShowAbout(true)} />
        {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
        {showSeedEntry && <SeedEntryModal onClose={() => setShowSeedEntry(false)} onSubmitSeed={applySeed} onUnlockCheat={unlockCheat} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- CREATE
  if (phase === 'creating' && data) {
    return <CreateSeed data={data} gameId={selectedGameId} onExit={() => setPhase('menu')} onPlay={playIndices} />;
  }

  // ---------------------------------------------------------------- SUMMARY
  if (phase === 'summary' && data) {
    const maxTotal = results.reduce((s, r) => s + maxForRating(r.rating), 0);
    return (
      <div className="shell menu summary">
        <BackdropFX phase={phase} />
        <div className="debrief-grid">
          <div className="debrief-hero">
            <h1 className="debrief-title">MISSION FINAL</h1>
            <p className="total">
              {shownTotal.toLocaleString()} <span className="max">/ {maxTotal.toLocaleString()}</span>
            </p>
            <div className="rank-block">
              <p className="rank">{scoreRank(total)}</p>
              <p className="rank-flavor">{rankFlavor(total)}</p>
            </div>
            {visorsUsed ? <div className="practice-note">◈ PRACTICE RUN — visors used, score not recorded</div> : total >= best && total > 0 && <div className="newbest">★ NEW PERSONAL BEST ★</div>}
            {justUnlocked.length > 0 && (
              <div className="unlock-banners">
                {justUnlocked.map((k, i) => (
                  <div key={k} className="unlock-banner" style={{ animationDelay: `${0.5 + i * 0.7}s` }}>
                    <span className="unlock-banner-corner tl" />
                    <span className="unlock-banner-corner tr" />
                    <span className="unlock-banner-corner bl" />
                    <span className="unlock-banner-corner br" />
                    <span className="unlock-banner-kicker">◆ UNLOCKED ◆</span>
                    <span className="unlock-banner-label">{UNLOCK_LABELS[k]}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="sign-off">SEE YOU NEXT MISSION</p>
            {activeSeedCode && <p className="seed-line">SEED: {activeSeedCode}</p>}
          </div>

          <ol className="round-list">
            {results.map((r, i) => {
              const per = maxForRating(r.rating);
              const pct = Math.max(0, Math.min(1, r.score / per));
              const dist = !isFinite(r.distance) ? 'wrong area' : r.distance === 0 ? 'exact!' : `${r.distance.toFixed(1)} cells off`;
              const rn = roomName(data, r.target);
              return (
                <li key={i} className="round-card" style={{ animationDelay: `${0.35 + i * 0.12}s` }}>
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
                    <div className="bar-fill" style={{ width: `${pct * 100}%`, animationDelay: `${0.7 + i * 0.12}s` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="summary-note">Tougher screens are worth more points. To get the best possible score, try "{DIFFICULTIES[DIFFICULTIES.length - 1].label}" mode.</p>

        <div className="summary-actions">
          <button className="btn secondary share" onClick={() => setShowShare(true)}>
            ⇪ SHARE
          </button>
          {loadedSeed ? (
            <button className="btn primary" onClick={clearSeed}>
              ▶ RETURN TO MENU
            </button>
          ) : (
            <>
              <button className="btn primary" onClick={() => startGame(data.game)}>
                ▶ PLAY AGAIN
              </button>
              <button className="btn secondary" onClick={() => setPhase('menu')}>
                MENU
              </button>
            </>
          )}
          <button className="btn secondary" onClick={() => setShowAbout(true)}>
            ABOUT
          </button>
        </div>
        <Credits onAbout={() => setShowAbout(true)} />
        {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
        {showShare && <ShareModal data={data} results={results} total={total} difficulty={difficulty} seedCode={activeSeedCode} onClose={() => setShowShare(false)} />}
      </div>
    );
  }

  if (!data) return null;
  const target = targets[round];
  const result = revealResult;

  // ---------------------------------------------------------------- GAME
  return (
    <div className={`shell game${phase === 'reveal' ? (revealStage === 'map' ? ' reveal-map' : ' reveal-result') : ''}`}>
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
          <div className="hud-tools">
            {(import.meta.env.DEV || unlocks.scan) && (
              <button className={`btn hud-tool ${debug ? 'active' : ''}`} onClick={() => setDebug((d) => !d)} title="Show the real screen for hovered map cells">
                <img className="tool-icon scan" src={`${import.meta.env.BASE_URL}assets/scan-visor.png`} alt="" aria-hidden="true" />
                <span>Scan Visor</span>
              </button>
            )}
            {(import.meta.env.DEV || unlocks.xray) && (
              <button className={`btn hud-tool ${showTiles ? 'active' : ''}`} onClick={() => setShowTiles((t) => !t)} title="Overlay the real game screens on the map (aids the Diff tool)">
                <img className="tool-icon xray" src={`${import.meta.env.BASE_URL}assets/xray-visor.png`} alt="" aria-hidden="true" />
                <span>X-Ray Visor</span>
              </button>
            )}
            {import.meta.env.DEV && (
              <>
                <button className={`btn hud-tool ${editIcons ? 'active' : ''}`} onClick={() => setEditIcons((e) => !e)} title="Place/erase landmark icons, then Save to file">
                  <span className="tool-glyph" aria-hidden="true">
                    ✎
                  </span>
                  <span>Icons</span>
                </button>
                <button className="btn hud-tool" onClick={() => loadGameData(data.game).then(setData)} title="Re-fetch data/<game>.json without losing round state (for tweaking map data by hand)">
                  <span className="tool-glyph" aria-hidden="true">
                    ↻
                  </span>
                  <span>Reload</span>
                </button>
              </>
            )}
          </div>
          <div className="score-readout">
            <div className="score-label">SCORE</div>
            <div className="score-value">{total.toLocaleString()}</div>
          </div>
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
              <div className={`reveal-scoreline${result.distance === 0 ? ' exact' : ''}`}>
                <span className="reveal-score">{shownRoundScore.toLocaleString()}</span>
                <span className="reveal-pts">PTS</span>
              </div>
              <p className="reveal-flavor">{shownFlavor}</p>
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

          {debug && <HoverScan data={data} hover={hoverTile} />}
        </section>

        <section className="pane right">
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
