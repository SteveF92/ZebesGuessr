import { useMemo, useState } from 'react';
import GuessMap from './GuessMap';
import TileViewer from './TileViewer';
import { HoverScan } from './HoverScan';
import { Stars } from './Stars';
import { GAMES, areaName, cellKey, cellPool, cellRating, deriveDifficultyIndex, indicesFromTargets, roomName, tileUrl } from '../data';
import { EXCLUDED_RATING } from '../scoring';
import { SEED_TILES, encodeSeed } from '../seed';
import { GAME_URL } from '../share';
import type { Cell, GameData, RoundTarget } from '../types';

interface Props {
  data: GameData;
  gameId: string;
  onExit: () => void;
  onPlay: (indices: number[], diffIndex: number) => void;
}

type Pick = { areaId: string; cell: Cell };

/**
 * Create Seed screen: hand-pick five screens instead of getting random ones.
 * Click a tile to preview it (image + name + difficulty), LOCK IN to add it,
 * then FINALIZE to mint a shareable seed. No scoring happens here, so the
 * result view offers the code + a link but no results image.
 */
export function CreateSeed({ data, gameId, onExit, onPlay }: Props) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [selected, setSelected] = useState<Pick | null>(null);
  const [hoverTile, setHoverTile] = useState<{ areaId: string; cell: Cell; name?: string } | null>(null);
  const [done, setDone] = useState<{ code: string; indices: number[]; diffIndex: number } | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'code' | 'link' | 'error'>('idle');

  const gameIndex = GAMES.findIndex((g) => g.id === gameId);

  // Playable (has a real screen) cells per area — GuessMap reports every drawn
  // map cell, but only these are guessable targets worth picking.
  const playable = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of data.areas) m.set(a.id, new Set(a.cells.map((c) => `${c.x},${c.y}`)));
    return m;
  }, [data]);

  const hasScreen = (areaId: string, cell: Cell) => !!playable.get(areaId)?.has(`${cell.x},${cell.y}`);
  // Any real screen is pickable — including ones normally excluded from random
  // runs (rated EXCLUDED_RATING); those just get a warning on the card.
  const isPickable = (areaId: string, cell: Cell) => hasScreen(areaId, cell);
  const inPicks = (p: Pick) => picks.some((q) => q.areaId === p.areaId && q.cell.x === p.cell.x && q.cell.y === p.cell.y);

  const full = picks.length >= SEED_TILES;
  const canLock = !!selected && isPickable(selected.areaId, selected.cell) && !inPicks(selected) && !full;

  function lockIn() {
    if (!selected || !canLock) return;
    setPicks((p) => [...p, selected]);
    setSelected(null);
  }

  function removePick(i: number) {
    setPicks((p) => p.filter((_, j) => j !== i));
  }

  function finalize() {
    const indices = indicesFromTargets(cellPool(data), picks as RoundTarget[]);
    const diffIndex = deriveDifficultyIndex(data, picks as RoundTarget[]);
    const code = encodeSeed({ gameIndex, diffIndex, indices });
    setDone({ code, indices, diffIndex });
  }

  async function copy(kind: 'code' | 'link') {
    if (!done) return;
    const text = kind === 'code' ? done.code : `${GAME_URL}?seed=${done.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(kind);
    } catch {
      setCopyState('error');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  }

  // ------------------------------------------------------------- RESULT VIEW
  if (done) {
    return (
      <div className="shell menu summary">
        <div className="debrief-hero create-done">
          <p className="debrief-kicker">◇ SEED FORGED ◇</p>
          <h1 className="logo">READY TO SHARE</h1>
          <p className="create-done-sub">Five screens locked in. Send this seed to a friend — they'll get your exact run.</p>
          <p className="seed-line big">{done.code}</p>

          <div className="summary-actions">
            <button className="btn secondary share" onClick={() => copy('code')}>
              {copyState === 'code' ? '✓ COPIED' : copyState === 'error' ? '✗ TRY AGAIN' : '⎘ COPY CODE'}
            </button>
            <button className="btn secondary share" onClick={() => copy('link')}>
              {copyState === 'link' ? '✓ COPIED' : copyState === 'error' ? '✗ TRY AGAIN' : '⎘ COPY LINK'}
            </button>
            <button className="btn primary" onClick={() => onPlay(done.indices, done.diffIndex)}>
              ▶ PLAY THIS SEED
            </button>
            <button className="btn secondary" onClick={onExit}>
              BACK TO MENU
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- CREATE VIEW
  const selRating = selected ? cellRating(data, selected.areaId, selected.cell) : 0;
  const selName = selected ? roomName(data, selected) : undefined;
  const selExcluded = selRating >= EXCLUDED_RATING;

  return (
    <div className="shell game create-mode">
      <header className="hud">
        <span className="logo small">ZebesGuessr</span>
        <span className="hud-sub">SEED FORGE</span>
        <div className="hud-center">
          <div className="pips">
            {Array.from({ length: SEED_TILES }).map((_, i) => (
              <span key={i} className={`pip ${i < picks.length ? 'past' : i === picks.length ? 'current' : 'future'}`} />
            ))}
          </div>
          <span className="round-label">
            {picks.length}/{SEED_TILES} LOCKED IN
          </span>
        </div>
        <div className="hud-right">
          <button className="btn toggle" onClick={onExit} title="Discard and return to the menu">
            ✕ CANCEL
          </button>
        </div>
      </header>

      <div className="panes">
        <section className="pane left">
          {selected ? (
            <>
              <TileViewer tileUrl={tileUrl(data, selected)} revealed />
              <div className="reveal-box">
                <p className="reveal-label">SELECTED SCREEN</p>
                <p className="reveal-area">{areaName(data, selected.areaId)}</p>
                {selName && <p className="reveal-room">“{selName}”</p>}
                <p className="reveal-rating">DIFFICULTY {selExcluded ? <span className="excluded-badge">EXCLUDED</span> : <Stars rating={selRating} />}</p>
                {selExcluded && <p className="pick-warn">⚠ Normally excluded from runs — unusual pick</p>}
                <button className="btn confirm" disabled={!canLock} onClick={lockIn}>
                  {inPicks(selected) ? 'ALREADY LOCKED IN' : full ? 'FIVE SCREENS — FINALIZE BELOW' : '◈ LOCK IN ↵'}
                </button>
                <button className="btn secondary pick-another" onClick={() => setSelected(null)}>
                  ◇ CHOOSE ANOTHER SCREEN
                </button>
              </div>
            </>
          ) : (
            <div className="create-hint-card">
              <p className="signal-label">
                {full ? 'FIVE SCREENS SET' : 'PICK A SCREEN'}
                <br />
                {full ? 'FINALIZE BELOW' : 'CLICK THE MAP'}
              </p>
              {!full && <p className="create-hint">Choose the five screens for your custom run. Hover any room to preview its screen.</p>}
            </div>
          )}

          {picks.length > 0 && (
            <ol className="pick-strip">
              {picks.map((p, i) => (
                <li key={cellKey(p.areaId, p.cell)} className="pick-item">
                  <img src={tileUrl(data, p)} alt="" />
                  <span className="pick-meta">
                    <span className="pick-idx">{i + 1}.</span> {areaName(data, p.areaId)}
                    {roomName(data, p) ? <span className="pick-room"> “{roomName(data, p)}”</span> : null}
                  </span>
                  <button className="pick-remove" onClick={() => removePick(i)} aria-label="Remove screen" title="Remove">
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}

          {full && (
            <button className="btn confirm finalize" onClick={finalize}>
              ▶ FINALIZE SEED
            </button>
          )}

          {/* Scanner only while actively choosing — hidden with a screen
              selected or on the finalize step, so hovering can't jitter the layout. */}
          {!selected && !full && <HoverScan data={data} hover={hoverTile} title="scan: hovered cell" className="create-scan" />}
        </section>

        <section className="pane right">
          <GuessMap
            data={data}
            selected={selected}
            onSelect={(areaId, cell) => {
              if (isPickable(areaId, cell)) setSelected({ areaId, cell });
            }}
            onHoverCell={(areaId, cell, name) => setHoverTile(cell ? { areaId, cell, name } : null)}
            result={null}
          />
        </section>
      </div>
    </div>
  );
}
