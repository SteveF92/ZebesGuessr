import { useState } from 'react';
import type { Cell, CellDraw, MapCellKind } from '../../types';
import { E, N, SO, W } from './constants';
import type { MapEditor } from './useMapEditor';

/** wall-bit checkboxes, in reading order */
const SIDES: { label: string; bit: number }[] = [
  { label: 'N', bit: N },
  { label: 'E', bit: E },
  { label: 'S', bit: SO },
  { label: 'W', bit: W }
];

/** door-pip color letters (see DoorPip); 'n' = normal door */
const PIP_COLORS = ['n', 'r', 'y', 'g', 'b'];

/**
 * Dev-only panel for the editor's Cell tool: shows the selected cell's draw
 * data (kind, wall bits, stair dir, fill variant, door pips) and edits it as
 * an in-session delta that the map renders live (see useMapEditor's
 * effectiveCells). Unlike the glyph/name sidecars, cell draw data is PIPELINE
 * OUTPUT — saving merges the deltas into mapOverrides.<game>.json (pipeline
 * input, applied by the extractor's apply_cell_overrides), and they reach the
 * baked <game>.json on the next extractor run (Save + Bake, seconds — tiles
 * are unaffected by draw data, so composite/slice are skipped).
 */
export default function CellEditorPanel({ editor, game, areaId, mapStyle }: { editor: MapEditor; game: string; areaId: string; mapStyle: string }) {
  const [msg, setMsg] = useState('');
  const [baking, setBaking] = useState(false);
  const cell = editor.cellPanelCell;
  if (!cell) return null;

  const key = `${cell.x},${cell.y}`;
  const delta = editor.cellEdits[areaId]?.[key];
  const baked = editor.bakedDrawAt(cell);
  /** what the map currently draws at the cell: the staged delta, else baked */
  const cur: CellDraw | null = delta !== undefined ? delta : baked;
  const edited = delta !== undefined;
  const gba = mapStyle === 'gba';
  const kinds: MapCellKind[] = gba ? ['room', 'vshaft', 'hshaft', 'knob'] : ['room', 'vshaft', 'hshaft', 'diag'];

  /** build a CellDraw in the sidecar's canonical shape: key order k,w,d,f,dr;
   *  d only on diag, f omitted when 0, dr omitted when empty — mirroring the
   *  pipeline's _cell_json so staged deltas compare clean against baked data */
  function normalize(k: MapCellKind, w: number, d?: '/' | '\\', f?: number, dr?: string[]): CellDraw {
    return {
      k,
      w,
      ...(k === 'diag' ? { d: d ?? '/' } : {}),
      ...(f ? { f } : {}),
      ...(dr?.length ? { dr } : {})
    };
  }

  function setKind(k: MapCellKind | 'none') {
    if (!cell) return;
    if (k === 'none') return editor.setCellEdit(cell, null);
    // walls (and gba extras) survive a kind switch; a cell drawn from nothing
    // starts fully walled
    editor.setCellEdit(cell, normalize(k, cur?.w ?? 15, cur?.d, cur?.f, cur?.dr));
  }

  function patch(p: Partial<Pick<CellDraw, 'w' | 'd' | 'f' | 'dr'>>) {
    if (!cell || !cur) return;
    editor.setCellEdit(cell, normalize(cur.k, p.w ?? cur.w, 'd' in p ? p.d : cur.d, 'f' in p ? p.f : cur.f, 'dr' in p ? p.dr : cur.dr));
  }

  /** the cell's pip color letter on a side, or null */
  function pipAt(side: string): string | null {
    return cur?.dr?.find((p) => p[0] === side)?.[1] ?? null;
  }

  /** set/clear a side's door pip (one pip per side; exotic stacks stay a hand
   *  edit of the JSON). Rebuilt in N/E/S/W order for deterministic output. */
  function setPip(side: string, color: string | null) {
    const kept = (cur?.dr ?? []).filter((p) => p[0] !== side);
    const next = color ? [...kept, `${side}${color}`] : kept;
    const order = 'NESW';
    patch({ dr: next.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])) });
  }

  /** POST every area's staged deltas to be merged into mapOverrides.<game>.json */
  async function save(silent = false): Promise<boolean> {
    const deltas: Record<string, { cells?: (Cell & CellDraw)[]; removeCells?: [number, number][] }> = {};
    for (const [aid, m] of Object.entries(editor.cellEdits)) {
      const entries = Object.entries(m)
        .map(([k, v]) => {
          const [x, y] = k.split(',').map(Number);
          return { x, y, v };
        })
        .sort((a, b) => a.y - b.y || a.x - b.x);
      const cells: (Cell & CellDraw)[] = [];
      const removeCells: [number, number][] = [];
      for (const { x, y, v } of entries) {
        if (v === null) removeCells.push([x, y]);
        else cells.push({ x, y, ...v });
      }
      if (cells.length || removeCells.length) deltas[aid] = { ...(cells.length ? { cells } : {}), ...(removeCells.length ? { removeCells } : {}) };
    }
    if (!Object.keys(deltas).length) {
      if (!silent) setMsg('no cell edits to save');
      return true;
    }
    setMsg('saving…');
    try {
      const res = await fetch('/__save-map-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, deltas })
      });
      if (!res.ok) {
        setMsg(`error: ${await res.text()}`);
        return false;
      }
      if (!silent) setMsg(`saved ✓ — mapOverrides.${game}.json updated; Bake (or rerun the extractor) to fold into ${game}.json`);
      return true;
    } catch (e) {
      setMsg(`error: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** save, then rerun just the extractor server-side (+ prettier) — draw data
   *  never touches the tiles, so the composite/slice steps are skipped */
  async function bake() {
    setBaking(true);
    const t0 = Date.now();
    const timer = setInterval(() => setMsg(`baking… ${Math.round((Date.now() - t0) / 1000)}s (extract → format)`), 500);
    try {
      if (!(await save(true))) return;
      const res = await fetch('/__bake-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game })
      });
      const text = await res.text();
      if (!res.ok) {
        setMsg(`bake error: ${text.slice(0, 300)}`);
        return;
      }
      const { log } = JSON.parse(text) as { log: string };
      console.log('[bake]', log);
      const warn = /WARNING/.test(log) ? ' — pipeline WARNINGs, see console' : '';
      setMsg(`baked ✓ in ${Math.round((Date.now() - t0) / 1000)}s${warn} — reload to resync (edits stay staged until then)`);
    } catch (e) {
      setMsg(`bake error: ${e instanceof Error ? e.message : e}`);
    } finally {
      clearInterval(timer);
      setBaking(false);
    }
  }

  return (
    <div className="landmark-editor">
      <div className="landmark-toolbar">
        <span className="edit-msg">
          ({cell.x},{cell.y}) {edited ? '● edited' : baked ? 'baked' : 'not drawn'}
        </span>
        {edited && (
          <button className="btn tiny" title="drop this cell's staged delta — back to the baked draw data" onClick={() => editor.resetCellEdit(cell)}>
            Reset
          </button>
        )}
        <span className="edit-msg">kind:</span>
        <button className={`btn tiny ${cur === null ? 'active' : ''}`} title="the pause map draws nothing here (the cell stays a real tile — X-Ray still paints it)" onClick={() => setKind('none')}>
          none
        </button>
        {kinds.map((k) => (
          <button key={k} className={`btn tiny ${cur?.k === k ? 'active' : ''}`} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      {cur && (
        <div className="landmark-toolbar">
          <span className="edit-msg">{cur.k === 'knob' ? 'inset sides:' : 'walls:'}</span>
          {SIDES.map(({ label, bit }) => (
            <button key={label} className={`btn tiny ${cur.w & bit ? 'active' : ''}`} onClick={() => patch({ w: cur.w ^ bit })}>
              {label}
            </button>
          ))}
          {cur.k === 'diag' && (
            <>
              <span className="edit-msg">dir:</span>
              {(['/', '\\'] as const).map((d) => (
                <button key={d} className={`btn tiny ${cur.d === d ? 'active' : ''}`} onClick={() => patch({ d })}>
                  {d}
                </button>
              ))}
            </>
          )}
          {gba && (
            <>
              <span className="edit-msg">fill:</span>
              {editor.COL.fills.map((color, i) => (
                <button
                  key={i}
                  className={`btn tiny ${(cur.f ?? 0) === i ? 'active' : ''}`}
                  style={{ background: color, color: '#fff', textShadow: '0 0 2px #000' }}
                  title={i === 0 ? 'default fill' : `fill variant ${i}`}
                  onClick={() => patch({ f: i })}
                >
                  {i}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {cur && gba && (
        <div className="landmark-toolbar">
          <span className="edit-msg">doors:</span>
          {SIDES.map(({ label }) => (
            <span key={label} className="cell-pip-group">
              <span className="edit-msg">{label}</span>
              <button className={`btn tiny ${pipAt(label) === null ? 'active' : ''}`} title="no door" onClick={() => setPip(label, null)}>
                ✕
              </button>
              {PIP_COLORS.map((c) => (
                <button
                  key={c}
                  className={`btn tiny ${pipAt(label) === c ? 'active' : ''}`}
                  style={{ background: c === 'n' ? '#9ab' : editor.COL.doors[c], color: '#111' }}
                  title={c === 'n' ? 'normal door' : `${c} lock`}
                  onClick={() => setPip(label, c)}
                >
                  {c}
                </button>
              ))}
            </span>
          ))}
        </div>
      )}
      <div className="landmark-toolbar">
        <button className="btn tiny save" onClick={() => save()} disabled={baking}>
          Save overrides
        </button>
        <button className="btn tiny save" onClick={bake} disabled={baking} title="merge the deltas into mapOverrides, then rerun the extractor + prettier server-side (seconds — tiles are untouched)">
          Save + Bake
        </button>
        {msg && <span className="edit-msg">{msg}</span>}
      </div>
      {cur?.k === 'diag' && (
        <div className="landmark-warning">
          ⚠ diag cells are drawn by hand-authored `bands` polygons (mapOverrides), not the cell box — the map shows nothing here until a band exists; `d` is extractor metadata.
        </div>
      )}
    </div>
  );
}
