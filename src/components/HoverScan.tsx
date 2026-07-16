import { useMemo } from 'react';
import { Stars } from './Stars';
import { areaName, cellRating, roomName, tileUrl } from '../data';
import { EXCLUDED_RATING } from '../scoring';
import type { Cell, GameData } from '../types';

interface Props {
  data: GameData;
  /** hovered cell in tile coords, or null when nothing is hovered */
  hover: { areaId: string; cell: Cell } | null;
  /** extra class on the panel (e.g. "create-scan") */
  className?: string;
}

/**
 * The hovered-cell preview panel, shared by the game's Scan Visor and the
 * Create Seed screen. Idle it reads "SCANNING…"; on hover the heading gives way
 * to the target readout — the hovered room's area, name, and difficulty plus a
 * scanline sweep over its real screen. Room name and rating are read straight
 * from `data` so they appear outside the icon editor too.
 */
export function HoverScan({ data, hover, className }: Props) {
  const playable = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of data.areas) m.set(a.id, new Set(a.cells.map((c) => `${c.x},${c.y}`)));
    return m;
  }, [data]);

  const hasScreen = hover && playable.get(hover.areaId)?.has(`${hover.cell.x},${hover.cell.y}`);
  const name = hasScreen ? roomName(data, hover) : undefined;
  const rating = hasScreen ? cellRating(data, hover.areaId, hover.cell) : 0;

  return (
    <div className={`debug-panel${hover ? ' locked' : ' scanning'}${className ? ' ' + className : ''}`}>
      {hover && hasScreen ? (
        <>
          <p className="scan-status">▸ TARGET ACQUIRED</p>
          <p className="debug-coords">
            {areaName(data, hover.areaId)}
            {name ? (
              <>
                {' '}
                — <strong>{name}</strong>
              </>
            ) : (
              <>
                {' '}
                ({hover.cell.x},{hover.cell.y}) — (unnamed)
              </>
            )}{' '}
            {rating >= EXCLUDED_RATING ? <span className="excluded-badge">EXCLUDED</span> : <Stars rating={rating} />}
          </p>
          <div className="scan-shot">
            <img src={tileUrl(data, { areaId: hover.areaId, cell: hover.cell })} alt="hovered screen" />
          </div>
        </>
      ) : hover ? (
        <>
          <p className="scan-status">▸ SIGNAL LOST</p>
          <p className="debug-coords">
            {areaName(data, hover.areaId)} ({hover.cell.x},{hover.cell.y}) — no screen for this cell (map-only)
          </p>
        </>
      ) : (
        <p className="scan-idle">
          SCANNING<span className="scan-dots" aria-hidden="true"></span>
        </p>
      )}
    </div>
  );
}
