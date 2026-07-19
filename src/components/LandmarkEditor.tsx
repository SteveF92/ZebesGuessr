import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cell } from '../types';

/** One sprite stamp in pipeline/landmarks.<game>.json: raw source-map pixel
 *  coordinates of the sprite's top-left corner. */
interface Stamp {
  sprite: string;
  x: number;
  y: number;
}
type Manifest = Record<string, Stamp[]>;
interface AreaMeta {
  offsetX: number;
  offsetY: number;
  cellCropOffsets: Record<string, [number, number]>;
  keepTiles: [number, number][];
}
interface LandmarkData {
  manifest: Manifest;
  sprites: string[];
  areas: Record<string, AreaMeta>;
  cellWidth: number;
  cellHeight: number;
}

/** margin of neighbouring source pixels drawn around the clicked cell */
const MARGIN = 60;
const SCALE = 2;

/** collapsible thumbnail chooser, one <details> per category subdir of
 *  pipeline/sprites/<game>/ — clicking a thumbnail stamps it on the cell */
function SpritePalette({ groups, game, onPick }: { groups: [string, string[]][]; game: string; onPick: (sprite: string) => void }) {
  if (!groups.length)
    return (
      <div className="landmark-palette">
        <span className="edit-msg">no sprites — drop PNGs into pipeline/sprites/{game}/ and hit ↻</span>
      </div>
    );
  return (
    <div className="landmark-palette">
      {groups.map(([cat, sprites]) => (
        <details key={cat} open>
          <summary>
            {cat} ({sprites.length})
          </summary>
          <div className="landmark-thumbs">
            {sprites.map((s) => (
              <button key={s} type="button" className="landmark-thumb" title={s} onClick={() => onPick(s)}>
                <img src={`/__landmark-sprite/${game}/${s}`} alt={s} />
                <span>{s.split('/').pop()!.replace('.png', '')}</span>
              </button>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/**
 * Dev-only zoomed placement panel for the editor's Landmark tool. Draws the
 * clicked cell's crop of the PRISTINE source map (served by the dev
 * middleware) and every manifest stamp over it — the exact compositing
 * composite_landmarks.py performs — so dragging a sprite previews the future
 * tile without a pipeline run. Saving writes pipeline/landmarks.<game>.json;
 * the art reaches the served tiles on the next composite → slice → extract.
 */
export default function LandmarkEditor({ game, areaId, cell }: { game: string; areaId: string; cell: Cell }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<LandmarkData | null>(null);
  const [mapImg, setMapImg] = useState<HTMLImageElement | null>(null);
  const [spriteImgs, setSpriteImgs] = useState<Record<string, HTMLImageElement>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [msg, setMsg] = useState('');
  const [baking, setBaking] = useState(false);
  const drag = useRef<{ idx: number; dx: number; dy: number } | null>(null);

  /** keepManifest: the ↻ refresh re-scans sprites/areas without discarding
   *  unsaved stamp edits (the manifest lives in the same state object) */
  const loadData = useCallback(
    (keepManifest: boolean) => {
      fetch(`/__landmarks/${game}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('landmark endpoints need the dev server'))))
        .then((fresh: LandmarkData) => setData((prev) => (keepManifest && prev ? { ...fresh, manifest: prev.manifest } : fresh)))
        .catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
    },
    [game]
  );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  useEffect(() => {
    setMapImg(null);
    const img = new Image();
    img.onload = () => setMapImg(img);
    img.onerror = () => setMsg('no source map — run download_maps.py first');
    img.src = `/__landmark-image/${game}/${areaId}`;
  }, [game, areaId]);

  // lazy-load sprite images as the manifest/list needs them
  useEffect(() => {
    if (!data) return;
    for (const name of data.sprites) {
      if (spriteImgs[name]) continue;
      const img = new Image();
      img.onload = () => setSpriteImgs((prev) => ({ ...prev, [name]: img }));
      img.src = `/__landmark-sprite/${game}/${name}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, game]);

  const meta = data?.areas[areaId];
  const stamps = useMemo(() => data?.manifest[areaId] ?? [], [data, areaId]);

  /** sprites grouped by category subdir; flat files land in "other" (last) */
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of data?.sprites ?? []) {
      const cat = s.includes('/') ? s.split('/')[0] : 'other';
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)));
  }, [data]);

  /** source-map rect of the clicked cell (slice_maps' crop rect, incl. the
   *  displaced-cluster cellCropOffsets) */
  const cellRect = useMemo(() => {
    if (!data || !meta) return null;
    const [dxp, dyp] = meta.cellCropOffsets[`${cell.x},${cell.y}`] ?? [0, 0];
    return {
      x: meta.offsetX + cell.x * data.cellWidth + dxp,
      y: meta.offsetY + cell.y * data.cellHeight + dyp,
      w: data.cellWidth,
      h: data.cellHeight
    };
  }, [data, meta, cell]);

  const win = useMemo(() => (cellRect ? { x: cellRect.x - MARGIN, y: cellRect.y - MARGIN, w: cellRect.w + 2 * MARGIN, h: cellRect.h + 2 * MARGIN } : null), [cellRect]);

  const kept = meta?.keepTiles.some(([kx, ky]) => kx === cell.x && ky === cell.y) ?? false;

  /** stamps whose rect overlaps a keepTiles cell anywhere in the area — the
   *  bake skips those tile PNGs, so the overlap must be hand-mirrored into the
   *  committed tile (this is how a moved Zazabi silently went stale once) */
  const keptOverlaps = useMemo(() => {
    if (!data || !meta) return [];
    const out: string[] = [];
    for (const [kx, ky] of meta.keepTiles) {
      const [dxp, dyp] = meta.cellCropOffsets[`${kx},${ky}`] ?? [0, 0];
      const rx = meta.offsetX + kx * data.cellWidth + dxp;
      const ry = meta.offsetY + ky * data.cellHeight + dyp;
      for (const s of stamps) {
        const img = spriteImgs[s.sprite];
        if (!img) continue;
        if (s.x < rx + data.cellWidth && s.x + img.width > rx && s.y < ry + data.cellHeight && s.y + img.height > ry) {
          out.push(`${s.sprite.replace('.png', '')} → (${kx},${ky})`);
          break;
        }
      }
    }
    return out;
  }, [data, meta, stamps, spriteImgs]);

  const setStamps = useCallback(
    (fn: (prev: Stamp[]) => Stamp[]) => {
      setData((d) => (d ? { ...d, manifest: { ...d.manifest, [areaId]: fn(d.manifest[areaId] ?? []) } } : d));
    },
    [areaId]
  );

  // redraw on any input change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !win || !cellRect || !mapImg) return;
    canvas.width = win.w * SCALE;
    canvas.height = win.h * SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mapImg, win.x, win.y, win.w, win.h, 0, 0, win.w * SCALE, win.h * SCALE);
    for (let i = 0; i < stamps.length; i++) {
      const img = spriteImgs[stamps[i].sprite];
      if (!img) continue;
      ctx.drawImage(img, (stamps[i].x - win.x) * SCALE, (stamps[i].y - win.y) * SCALE, img.width * SCALE, img.height * SCALE);
      if (i === selected) {
        ctx.strokeStyle = '#39ff14';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect((stamps[i].x - win.x) * SCALE - 1, (stamps[i].y - win.y) * SCALE - 1, img.width * SCALE + 2, img.height * SCALE + 2);
        ctx.setLineDash([]);
      }
    }
    // the tile frame: what slice_maps will crop for this cell
    ctx.strokeStyle = 'rgba(255,0,255,0.9)';
    ctx.strokeRect((cellRect.x - win.x) * SCALE + 0.5, (cellRect.y - win.y) * SCALE + 0.5, cellRect.w * SCALE, cellRect.h * SCALE);
  }, [win, cellRect, mapImg, stamps, spriteImgs, selected]);

  function stampAt(px: number, py: number): number | null {
    // topmost (last-drawn) stamp under the pointer wins
    for (let i = stamps.length - 1; i >= 0; i--) {
      const img = spriteImgs[stamps[i].sprite];
      if (!img) continue;
      if (px >= stamps[i].x && px < stamps[i].x + img.width && py >= stamps[i].y && py < stamps[i].y + img.height) return i;
    }
    return null;
  }

  /** canvas event position -> source-map pixels */
  function srcPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    // CSS may shrink the canvas (max-width) — map through the real ratio
    const rx = ((e.clientX - rect.left) / rect.width) * win!.w + win!.x;
    const ry = ((e.clientY - rect.top) / rect.height) * win!.h + win!.y;
    return { x: rx, y: ry };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!win) return;
    const p = srcPos(e);
    const idx = stampAt(p.x, p.y);
    setSelected(idx);
    if (idx !== null) {
      drag.current = { idx, dx: p.x - stamps[idx].x, dy: p.y - stamps[idx].y };
      canvasRef.current!.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !win) return;
    const p = srcPos(e);
    const { idx, dx, dy } = drag.current;
    const nx = Math.round(p.x - dx);
    const ny = Math.round(p.y - dy);
    setStamps((prev) => prev.map((s, i) => (i === idx ? { ...s, x: nx, y: ny } : s)));
    setMsg('');
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drag.current) canvasRef.current!.releasePointerCapture(e.pointerId);
    drag.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (selected === null) return;
    const step = e.shiftKey ? 8 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = d[e.key];
    if (!move) {
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      return;
    }
    e.preventDefault();
    setStamps((prev) => prev.map((s, i) => (i === selected ? { ...s, x: s.x + move[0], y: s.y + move[1] } : s)));
  }

  function addStamp(sprite: string) {
    if (!cellRect) return;
    const img = spriteImgs[sprite];
    const w = img?.width ?? 0;
    const h = img?.height ?? 0;
    setStamps((prev) => [...prev, { sprite, x: Math.round(cellRect.x + (cellRect.w - w) / 2), y: Math.round(cellRect.y + (cellRect.h - h) / 2) }]);
    setSelected(stamps.length);
  }

  function removeSelected() {
    if (selected === null) return;
    setStamps((prev) => prev.filter((_, i) => i !== selected));
    setSelected(null);
  }

  async function save(silent = false): Promise<boolean> {
    if (!data) return false;
    setMsg('saving…');
    // drop areas emptied by deletes so the file stays minimal
    const out: Manifest = {};
    for (const [id, list] of Object.entries(data.manifest)) {
      if (list.length) out[id] = list;
    }
    try {
      const res = await fetch('/__save-landmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, manifest: out })
      });
      if (!res.ok) {
        setMsg(`error: ${await res.text()}`);
        return false;
      }
      if (!silent) setMsg('saved ✓ — Bake (or run the pipeline) to reach the tiles');
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
    } catch (e) {
      setMsg(`bake error: ${e instanceof Error ? e.message : e}`);
    } finally {
      clearInterval(timer);
      setBaking(false);
    }
  }

  if (!data || !win) return <div className="landmark-editor">{msg || 'loading landmark data…'}</div>;

  const sel = selected !== null ? stamps[selected] : null;
  return (
    <div className="landmark-editor" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="landmark-toolbar">
        <span className="edit-msg">
          cell ({cell.x},{cell.y}) — click a palette sprite to stamp, drag it, arrows nudge (shift ×8), Del removes
        </span>
        <button className={`btn tiny${paletteOpen ? ' active' : ''}`} onClick={() => setPaletteOpen((v) => !v)}>
          Sprites {paletteOpen ? '▾' : '▸'}
        </button>
        <button className="btn tiny" onClick={() => loadData(true)} title="re-scan pipeline/sprites/ for freshly dropped PNGs (keeps unsaved edits)">
          ↻
        </button>
        <button className="btn tiny" onClick={removeSelected} disabled={selected === null}>
          Delete
        </button>
        <button className="btn tiny save" onClick={() => save()} disabled={baking}>
          Save landmarks
        </button>
        <button className="btn tiny save" onClick={bake} disabled={baking} title="Save the manifest, then run composite → slice → extract → format server-side (~30-60s)">
          Save + Bake
        </button>
        {sel && (
          <span className="edit-msg">
            {sel.sprite} ({sel.x},{sel.y})
          </span>
        )}
        {msg && <span className="edit-msg">{msg}</span>}
      </div>
      {paletteOpen && <SpritePalette groups={groups} game={game} onPick={addStamp} />}
      {kept && (
        <div className="landmark-warning">
          ⚠ ({cell.x},{cell.y}) is a keepTiles cell: the bake skips its tile PNG — mirror any stamp into the committed tile by hand (see CLAUDE.md).
        </div>
      )}
      {keptOverlaps.length > 0 && (
        <div className="landmark-warning">
          ⚠ stamps overlap keepTiles tile(s) the bake won't touch: {keptOverlaps.join(', ')} — after baking, hand-mirror the overlap into the committed tile PNG (see CLAUDE.md).
        </div>
      )}
      <canvas ref={canvasRef} className="landmark-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
    </div>
  );
}
