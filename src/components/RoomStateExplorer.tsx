import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cell } from '../types';

/** One tile override in pipeline/tileOverrides.<game>.json: whole-screen swap
 *  at tile (x,y), cropping cellWidth×cellHeight at (sx,sy) from `image`
 *  (a pipeline/-relative path under tile-sources/). */
interface OverrideEntry {
  x: number;
  y: number;
  image: string;
  sx?: number;
  sy?: number;
  note?: string;
}
type Manifest = Record<string, OverrideEntry[]>;
interface AreaMeta {
  offsetX: number;
  offsetY: number;
  cellCropOffsets: Record<string, [number, number]>;
  keepTiles: [number, number][];
}
interface RoomStateData {
  manifest: Manifest;
  areas: Record<string, AreaMeta>;
  cellWidth: number;
  cellHeight: number;
  randovaniaPresent: boolean;
}

/** every Randovania room render pads the room with 32px of off-camera tiles */
const MARGIN = 32;
const SCALE = 2;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Dev-only panel for the editor's Room state tool (GBA games). Shows the
 * Randovania render for the clicked cell's room — the alternate room state the
 * vgmaps rip doesn't capture — gridded into screens, each mapped onto a map
 * cell. Clicking a screen toggles a tile override for that cell; saving writes
 * pipeline/tileOverrides.<game>.json and copies the render byte-identical into
 * pipeline/tile-sources/ (the committed source of truth — randovania/ is
 * gitignored). The override reaches the served tiles on the next bake, which
 * reuses the Landmark tool's composite → slice → extract chain.
 */
export default function RoomStateExplorer({ game, areaId, cell, roomName, roomCells }: { game: string; areaId: string; cell: Cell; roomName?: string; roomCells: Cell[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cropRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<RoomStateData | null>(null);
  const [mapName, setMapName] = useState<string | null>(null);
  const [renderImg, setRenderImg] = useState<HTMLImageElement | null>(null);
  const [nudge, setNudge] = useState({ x: 0, y: 0 });
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [lookupErr, setLookupErr] = useState('');
  const [alphaWarn, setAlphaWarn] = useState(false);
  const [baking, setBaking] = useState(false);
  // cache-buster for the committed-tile comparison <img>, bumped after a bake
  const [tileVersion, setTileVersion] = useState(0);
  // renders first referenced this session, so save knows what to copy into
  // tile-sources/ — pre-existing committed sources need no copy
  const pendingCopies = useRef(new Map<string, { area: string; mapName: string; file: string }>());

  useEffect(() => {
    fetch(`/__room-state/${game}`)
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
      .then((d: RoomStateData) => setData(d))
      .catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
  }, [game]);

  // room name -> render basename via the logic database
  useEffect(() => {
    setMapName(null);
    setRenderImg(null);
    setLookupErr('');
    setNudge({ x: 0, y: 0 });
    if (!roomName) return;
    fetch(`/__room-map-name/${game}/${areaId}?room=${encodeURIComponent(roomName)}`)
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
      .then(({ mapName: m }: { mapName: string }) => setMapName(m))
      .catch((e) => setLookupErr(String(e instanceof Error ? e.message : e)));
  }, [game, areaId, roomName]);

  useEffect(() => {
    if (!mapName) return;
    const img = new Image();
    img.onload = () => setRenderImg(img);
    img.onerror = () => setLookupErr(`no render ${mapName}.png in the randovania checkout`);
    img.src = `/__room-render/${game}/${encodeURIComponent(mapName)}.png`;
  }, [game, mapName]);

  const meta = data?.areas[areaId];
  const cw = data?.cellWidth ?? 240;
  const ch = data?.cellHeight ?? 160;
  const entries = useMemo(() => data?.manifest[areaId] ?? [], [data, areaId]);

  /** the room's top-left map cell — min x/y over the cells sharing its name */
  const origin = useMemo(() => {
    if (!roomCells.length) return cell;
    return { x: Math.min(...roomCells.map((c) => c.x)), y: Math.min(...roomCells.map((c) => c.y)) };
  }, [roomCells, cell]);

  /** render interior in screens; null margins mean the 32px assumption broke */
  const grid = useMemo(() => {
    if (!renderImg) return null;
    const cols = (renderImg.width - 2 * MARGIN) / cw;
    const rows = (renderImg.height - 2 * MARGIN) / ch;
    return { cols, rows, exact: Number.isInteger(cols) && Number.isInteger(rows) };
  }, [renderImg, cw, ch]);

  const screenToCell = useCallback((i: number, j: number): Cell => ({ x: origin.x + nudge.x + i, y: origin.y + nudge.y + j }), [origin, nudge]);
  /** the screen the clicked cell maps to (may be off the render under a nudge) */
  const focus = { i: cell.x - origin.x - nudge.x, j: cell.y - origin.y - nudge.y };

  const imagePath = roomName ? `tile-sources/${game}/${areaId}/${slugify(roomName)}.png` : '';
  const roomSet = useMemo(() => new Set(roomCells.map((c) => `${c.x},${c.y}`)), [roomCells]);

  const entryAt = useCallback((c: Cell) => entries.find((o) => o.x === c.x && o.y === c.y), [entries]);

  const setEntries = useCallback(
    (fn: (prev: OverrideEntry[]) => OverrideEntry[]) => {
      setData((d) => (d ? { ...d, manifest: { ...d.manifest, [areaId]: fn(d.manifest[areaId] ?? []) } } : d));
    },
    [areaId]
  );

  /** click a screen: toggle this room's override on its mapped cell (replacing
   *  any entry there that points at a different image) */
  function toggleScreen(i: number, j: number) {
    if (!mapName || !roomName) return;
    const c = screenToCell(i, j);
    const existing = entryAt(c);
    if (existing && existing.image === imagePath) {
      setEntries((prev) => prev.filter((o) => o !== existing));
      setMsg(`removed override at (${c.x},${c.y})`);
      return;
    }
    const entry: OverrideEntry = {
      x: c.x,
      y: c.y,
      image: imagePath,
      sx: MARGIN + i * cw,
      sy: MARGIN + j * ch,
      note: note.trim() || `'${mapName}.png' from the randovania checkout, committed unmodified`
    };
    pendingCopies.current.set(imagePath, { area: areaId, mapName, file: `${slugify(roomName)}.png` });
    setEntries((prev) => [...prev.filter((o) => o !== existing), entry]);
    setMsg(existing ? `replaced (${c.x},${c.y})'s override (was ${existing.image})` : `override staged at (${c.x},${c.y}) — Save to write it`);
  }

  // main canvas: the whole render, gridded into screens with per-cell badges
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderImg || !grid || !meta) return;
    canvas.width = renderImg.width * SCALE;
    canvas.height = renderImg.height * SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(renderImg, 0, 0, canvas.width, canvas.height);
    // dim the off-camera margin so the screen interior reads as the room
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, MARGIN * SCALE);
    ctx.fillRect(0, canvas.height - MARGIN * SCALE, canvas.width, MARGIN * SCALE);
    ctx.fillRect(0, MARGIN * SCALE, MARGIN * SCALE, canvas.height - 2 * MARGIN * SCALE);
    ctx.fillRect(canvas.width - MARGIN * SCALE, MARGIN * SCALE, MARGIN * SCALE, canvas.height - 2 * MARGIN * SCALE);
    for (let j = 0; j < grid.rows; j++) {
      for (let i = 0; i < grid.cols; i++) {
        const x = (MARGIN + i * cw) * SCALE;
        const y = (MARGIN + j * ch) * SCALE;
        const w = cw * SCALE;
        const h = ch * SCALE;
        const c = screenToCell(i, j);
        const key = `${c.x},${c.y}`;
        const existing = entryAt(c);
        if (!roomSet.has(key)) {
          // mapped cell isn't part of this room on our map — likely a name
          // collision or nudge artifact; still clickable, but visibly foreign
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(x, y, w, h);
        }
        if (existing) {
          ctx.fillStyle = existing.image === imagePath ? 'rgba(57,255,20,0.22)' : 'rgba(255,200,0,0.30)';
          ctx.fillRect(x, y, w, h);
        }
        if (meta.keepTiles.some(([kx, ky]) => kx === c.x && ky === c.y)) {
          ctx.fillStyle = 'rgba(255,120,0,0.35)';
          ctx.fillRect(x, y, w, h);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.font = '20px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = 3;
        const label = `${c.x},${c.y}${existing ? (existing.image === imagePath ? ' ✓' : ' ≠') : ''}`;
        ctx.strokeText(label, x + 6, y + 24);
        ctx.fillText(label, x + 6, y + 24);
      }
    }
    if (focus.i >= 0 && focus.i < grid.cols && focus.j >= 0 && focus.j < grid.rows) {
      ctx.strokeStyle = 'rgba(255,0,255,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect((MARGIN + focus.i * cw) * SCALE + 1, (MARGIN + focus.j * ch) * SCALE + 1, cw * SCALE - 2, ch * SCALE - 2);
    }
  }, [renderImg, grid, meta, cw, ch, screenToCell, entryAt, roomSet, imagePath, focus.i, focus.j]);

  // comparison crop: the focused screen at 2×, plus the paste_overrides
  // opacity check (any transparent pixel makes the bake hard-fail)
  useEffect(() => {
    const canvas = cropRef.current;
    setAlphaWarn(false);
    if (!canvas || !renderImg || !grid) return;
    if (focus.i < 0 || focus.i >= grid.cols || focus.j < 0 || focus.j >= grid.rows) return;
    canvas.width = cw * SCALE;
    canvas.height = ch * SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(renderImg, MARGIN + focus.i * cw, MARGIN + focus.j * ch, cw, ch, 0, 0, cw * SCALE, ch * SCALE);
    const probe = document.createElement('canvas');
    probe.width = cw;
    probe.height = ch;
    const pctx = probe.getContext('2d')!;
    pctx.drawImage(renderImg, MARGIN + focus.i * cw, MARGIN + focus.j * ch, cw, ch, 0, 0, cw, ch);
    const px = pctx.getImageData(0, 0, cw, ch).data;
    for (let k = 3; k < px.length; k += 4) {
      if (px[k] < 255) {
        setAlphaWarn(true);
        break;
      }
    }
  }, [renderImg, grid, cw, ch, focus.i, focus.j]);

  async function save(silent = false): Promise<boolean> {
    if (!data) return false;
    setMsg('saving…');
    const out: Manifest = {};
    for (const [id, list] of Object.entries(data.manifest)) {
      if (list.length) out[id] = list;
    }
    try {
      const res = await fetch('/__save-tile-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, manifest: out, copies: [...pendingCopies.current.values()] })
      });
      if (!res.ok) {
        setMsg(`error: ${await res.text()}`);
        return false;
      }
      const { copied, orphans } = (await res.json()) as { copied: string[]; orphans: string[] };
      pendingCopies.current.clear();
      if (!silent) {
        const parts = ['saved ✓ — Bake (or run the pipeline) to reach the tiles'];
        if (copied.length) parts.push(`copied: ${copied.join(', ')}`);
        if (orphans.length) parts.push(`unreferenced tile-sources left on disk: ${orphans.join(', ')}`);
        setMsg(parts.join(' · '));
      }
      return true;
    } catch (e) {
      setMsg(`error: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** save the manifest, then run the whole bake chain server-side
   *  (composite → slice → extract → prettier). ~30-60s. */
  async function bake() {
    setBaking(true);
    const t0 = Date.now();
    const timer = setInterval(() => setMsg(`baking… ${Math.round((Date.now() - t0) / 1000)}s (composite → slice → extract)`), 500);
    try {
      if (!(await save(true))) return;
      const res = await fetch('/__bake-landmarks', {
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
      setMsg(`baked ✓ in ${Math.round((Date.now() - t0) / 1000)}s${warn} — reload to see the new tiles`);
      setTileVersion((v) => v + 1);
    } catch (e) {
      setMsg(`bake error: ${e instanceof Error ? e.message : e}`);
    } finally {
      clearInterval(timer);
      setBaking(false);
    }
  }

  if (!data) return <div className="landmark-editor">{msg || 'loading tile-override data…'}</div>;
  if (!data.randovaniaPresent) return <div className="landmark-editor">no randovania/ checkout — vendor the game packages (with assets/maps) at the repo root first</div>;
  if (!roomName)
    return (
      <div className="landmark-editor">
        cell ({cell.x},{cell.y}) has no room name — name it with the Name tool first (the Randovania lookup is keyed by room name)
      </div>
    );

  const kept = meta?.keepTiles.some(([kx, ky]) => kx === cell.x && ky === cell.y) ?? false;
  const focusOn = grid && focus.i >= 0 && focus.i < grid.cols && focus.j >= 0 && focus.j < grid.rows;

  return (
    <div className="landmark-editor">
      <div className="landmark-toolbar">
        <span className="edit-msg">
          {roomName} {mapName ? `→ ${mapName}.png` : ''} — click a screen to toggle its override
        </span>
        <span className="edit-msg">nudge:</span>
        <button className="btn tiny" onClick={() => setNudge((n) => ({ ...n, x: n.x - 1 }))}>
          ◀
        </button>
        <button className="btn tiny" onClick={() => setNudge((n) => ({ ...n, x: n.x + 1 }))}>
          ▶
        </button>
        <button className="btn tiny" onClick={() => setNudge((n) => ({ ...n, y: n.y - 1 }))}>
          ▲
        </button>
        <button className="btn tiny" onClick={() => setNudge((n) => ({ ...n, y: n.y + 1 }))}>
          ▼
        </button>
        {(nudge.x !== 0 || nudge.y !== 0) && (
          <button className="btn tiny" onClick={() => setNudge({ x: 0, y: 0 })} title="reset the screen↔cell alignment nudge">
            ({nudge.x},{nudge.y}) ✕
          </button>
        )}
        <input
          className="edit-name"
          placeholder="note (provenance)"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          title="stored as the override's note; empty gets a default provenance line"
        />
        <button className="btn tiny save" onClick={() => save()} disabled={baking}>
          Save overrides
        </button>
        <button className="btn tiny save" onClick={bake} disabled={baking} title="Save the manifest, then run composite → slice → extract → format server-side (~30-60s)">
          Save + Bake
        </button>
        {msg && <span className="edit-msg">{msg}</span>}
      </div>
      {lookupErr && <div className="landmark-warning">⚠ {lookupErr}</div>}
      {grid && !grid.exact && (
        <div className="landmark-warning">
          ⚠ render isn't a whole number of {cw}×{ch} screens inside a {MARGIN}px margin ({renderImg?.width}×{renderImg?.height}) — the crop math is off for this room
        </div>
      )}
      {kept && (
        <div className="landmark-warning">
          ⚠ ({cell.x},{cell.y}) is a keepTiles cell: slicing skips its hand-painted tile PNG, so an override only reaches it via Save + Bake (which mirrors it in) — plain Save won't.
        </div>
      )}
      {alphaWarn && <div className="landmark-warning">⚠ this screen's crop has transparent pixels — composite_landmarks.py will reject it (off-camera area of the render?)</div>}
      {renderImg && grid && (
        <div className="roomstate-scroll">
          <canvas
            ref={canvasRef}
            className="landmark-canvas"
            onClick={(e) => {
              const rect = canvasRef.current!.getBoundingClientRect();
              const px = ((e.clientX - rect.left) / rect.width) * renderImg.width;
              const py = ((e.clientY - rect.top) / rect.height) * renderImg.height;
              const i = Math.floor((px - MARGIN) / cw);
              const j = Math.floor((py - MARGIN) / ch);
              if (i < 0 || i >= grid.cols || j < 0 || j >= grid.rows) return;
              toggleScreen(i, j);
            }}
          />
        </div>
      )}
      {focusOn && (
        <div className="roomstate-compare">
          <figure>
            <canvas ref={cropRef} />
            <figcaption>
              render crop for ({cell.x},{cell.y})
            </figcaption>
          </figure>
          <figure>
            <img src={`${import.meta.env.BASE_URL}tiles/${game}/${areaId}/cell_${cell.x}_${cell.y}.png?v=${tileVersion}`} alt="current tile" width={cw * SCALE} height={ch * SCALE} />
            <figcaption>current baked tile</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
