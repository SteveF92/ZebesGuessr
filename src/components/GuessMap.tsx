import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AreaData, Cell, Connector, DiagBand, GameData, MapCell, MapGlyph, RoundResult } from '../types';
import { cellKey, tileUrl } from '../data';
import { DEFAULT_RATING, EXCLUDED_RATING } from '../scoring';

interface Props {
  data: GameData;
  /** selection in TILE coordinates */
  selected: { areaId: string; cell: Cell } | null;
  onSelect: (areaId: string, cell: Cell) => void;
  /** reports the hovered cell in TILE coordinates (debug preview), plus its
   *  current room name (reflects live editor edits) if any */
  onHoverCell?: (areaId: string, cell: Cell | null, roomName?: string) => void;
  /** reports the area currently displayed on the map (tab/shoulder switches) */
  onAreaChange?: (areaId: string) => void;
  /** when set, the round is over: draw target/guess markers, ignore clicks */
  result: RoundResult | null;
  /** dev icon-placement mode: clicks stamp/erase landmark glyphs */
  editing?: boolean;
  /** dev difficulty-rating aid: paint each playable cell's actual game screen
   *  onto the map so ratings can be judged against the real imagery */
  showTiles?: boolean;
}

type GlyphType = MapGlyph['t'];
type Tool = GlyphType | 'connector' | 'roomname' | 'difficulty' | 'erase';
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'save', label: 'Save (S)' },
  { id: 'map', label: 'Map (M)' },
  { id: 'recharge', label: 'Recharge (R)' },
  { id: 'ship', label: 'Ship' },
  { id: 'boss', label: 'Boss' },
  { id: 'item', label: 'Item' },
  { id: 'connector', label: 'Connector' },
  { id: 'roomname', label: 'Name' },
  { id: 'difficulty', label: 'Diff' },
  { id: 'erase', label: 'Erase' }
];

/** Diff-tool overlay colors, rating 1 (easy) → 5 (hard); 6 = never served. */
const RATING_COLORS: Record<number, string> = {
  1: '46, 204, 113',
  2: '163, 224, 72',
  3: '241, 196, 15',
  4: '230, 126, 34',
  5: '231, 76, 60',
  6: '25, 25, 25'
};

/** outline color for the Diff tool's isolate mode — picked for max contrast
 *  against every rating color and the map's dark background. */
const ISOLATE_HIGHLIGHT = '#39ff14';

type Overlays = { connectors: Connector[] };

/** label-position cycle order for the editor toggle */
type LabelPos = NonNullable<Connector['labelPos']>;
const LABEL_CYCLE: LabelPos[] = ['above', 'right', 'below', 'left'];
const LABEL_ARROW: Record<LabelPos, string> = {
  above: 'above ↑',
  below: 'below ↓',
  left: 'left ←',
  right: 'right →'
};

/** geometry helpers: connectors are axis-aligned between two whole map cells */
function connBounds(c: Connector) {
  return {
    minX: Math.min(c.x0, c.x1),
    maxX: Math.max(c.x0, c.x1),
    minY: Math.min(c.y0, c.y1),
    maxY: Math.max(c.y0, c.y1)
  };
}
/** true when the connector runs left-right (wider than it is tall). For a
 *  single cell (neither axis dominates) the label side breaks the tie, so a
 *  1-cell connector labelled left/right renders as a horizontal stub. */
function connHorizontal(c: Connector) {
  const b = connBounds(c);
  const dx = b.maxX - b.minX,
    dy = b.maxY - b.minY;
  if (dx !== dy) return dx > dy;
  return c.labelPos === 'left' || c.labelPos === 'right';
}
function connContains(c: Connector, cell: Cell) {
  const b = connBounds(c);
  return cell.x >= b.minX && cell.x <= b.maxX && cell.y >= b.minY && cell.y <= b.maxY;
}
function defaultLabelPos(c: Connector): LabelPos {
  return connHorizontal(c) ? 'right' : 'below';
}
/** build a connector from two clicks, locking to the dominant axis */
function connectorFromDrag(a: Cell, c: Cell): Connector {
  if (Math.abs(c.x - a.x) >= Math.abs(c.y - a.y)) {
    return { x0: Math.min(a.x, c.x), y0: a.y, x1: Math.max(a.x, c.x), y1: a.y, label: '' };
  }
  return { x0: a.x, y0: Math.min(a.y, c.y), x1: a.x, y1: Math.max(a.y, c.y), label: '' };
}

/** logical units per map cell (all drawing math is in these units) */
const S = 16;
/** on-screen magnification: the canvas backing store and context are scaled by
 *  this so every cell renders SCALE×S css px. Bump to grow/shrink the whole map
 *  uniformly (cells, walls, glyphs, and the tile overlay together). */
const SCALE = 2;

// SNES pause-map palette
const COL = {
  bg: '#000000',
  dot: '#40166e',
  room: '#d83890',
  wall: '#a0f8f8',
  map: '#00f858',
  ship: '#f88838',
  hover: 'rgba(255,255,255,0.85)',
  selected: '#ffd24d',
  item: '#f8f8f8',
  target: '#00ff88',
  guess: '#ff4444',
  targetOutline: '#004422',
  guessOutline: '#660000'
};

const N = 1,
  E = 2,
  SO = 4,
  W = 8;

/**
 * The clickable guess map, rebuilt as web elements: cells from the actual
 * in-game pause map are drawn on canvas (rooms, shafts, station glyphs,
 * Samus' ship) — no environment art, knowledge only.
 */
export default function GuessMap({ data, selected, onSelect, onHoverCell, onAreaChange, result, editing, showTiles }: Props) {
  const [areaId, setAreaId] = useState(data.areas[0].id);
  const area = data.areas.find((a) => a.id === areaId)!;

  useEffect(() => {
    onAreaChange?.(areaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId]);

  // L/R shoulder buttons cycle areas, like in the real pause screen
  function cycleArea(dir: number) {
    const idx = data.areas.findIndex((a) => a.id === areaId);
    const n = data.areas.length;
    setAreaId(data.areas[(idx + dir + n) % n].id);
  }
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shipImageRef = useRef<HTMLImageElement | null>(null);
  const bossImageRef = useRef<HTMLImageElement | null>(null);
  const [shipLoaded, setShipLoaded] = useState(false);
  const [bossLoaded, setBossLoaded] = useState(false);
  const [hover, setHover] = useState<Cell | null>(null);

  // ---- pan/zoom (touch / small screens only) -----------------------------
  // The wide pause maps are unusable when squeezed to a phone's width, so on
  // small screens the map becomes a pinch-zoomable, drag-pannable viewport.
  // Desktop keeps plain click-to-place (panEnabled stays false there).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [smallScreen, setSmallScreen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 800px)');
    const update = () => setSmallScreen(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const panEnabled = smallScreen && !editing; // editing is a desktop-only dev mode

  // canvas' natural CSS size (backing store is 1:1 with CSS px): cols*S*SCALE
  const W0 = area.map.cols * S * SCALE;
  const H0 = area.map.rows * S * SCALE;

  // view transform applied to the canvas: displayed = translate(tx,ty) scale(z)
  const [view, setView] = useState<{ z: number; tx: number; ty: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view; // latest view for pointer handlers (no re-binding)
  // live gesture bookkeeping (refs so pointer handlers don't need re-binding).
  // pinch* capture the reference spacing/zoom at the moment the 2nd finger lands.
  const gesture = useRef<{ pointers: Map<number, { x: number; y: number }>; moved: number; multi: boolean; pinchDist: number; pinchZ: number }>({
    pointers: new Map(),
    moved: 0,
    multi: false,
    pinchDist: 0,
    pinchZ: 1
  });

  /** keep the scaled map inside the viewport (centered when smaller than it) */
  function clampView(v: { z: number; tx: number; ty: number }, vw: number, vh: number) {
    const sw = W0 * v.z,
      sh = H0 * v.z;
    const tx = sw <= vw ? (vw - sw) / 2 : Math.min(0, Math.max(vw - sw, v.tx));
    const ty = sh <= vh ? (vh - sh) / 2 : Math.min(0, Math.max(vh - sh, v.ty));
    return { z: v.z, tx, ty };
  }
  /** zoom bounds for the current viewport: out to whole-map, in to ~48px cells */
  function zoomBounds(vw: number, vh: number) {
    const fitZ = Math.min(vw / W0, vh / H0);
    return { fitZ, maxZ: Math.max(fitZ, 48 / (S * SCALE)) };
  }
  /** reset to whole-area-visible, centered */
  function fitView() {
    const el = scrollRef.current;
    if (!el) return;
    const vw = el.clientWidth,
      vh = el.clientHeight;
    if (!vw || !vh) return;
    const { fitZ } = zoomBounds(vw, vh);
    setView(clampView({ z: fitZ, tx: 0, ty: 0 }, vw, vh));
  }
  /** zoom by a factor around a focal point (viewport-local px) */
  function zoomAround(factor: number, fx: number, fy: number) {
    const el = scrollRef.current;
    if (!el) return;
    const vw = el.clientWidth,
      vh = el.clientHeight;
    const { fitZ, maxZ } = zoomBounds(vw, vh);
    setView((v) => {
      if (!v) return v;
      const z = Math.min(maxZ, Math.max(fitZ, v.z * factor));
      const k = z / v.z;
      return clampView({ z, tx: fx - (fx - v.tx) * k, ty: fy - (fy - v.ty) * k }, vw, vh);
    });
  }

  // (re)fit whenever pan turns on, the area changes, or the viewport resizes
  // (orientation flip). useLayoutEffect + synchronous fit avoids a first-paint
  // flash of the full-size canvas.
  useLayoutEffect(() => {
    if (!panEnabled) {
      setView(null);
      return;
    }
    fitView();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitView());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panEnabled, area.id]);

  // Actual-game-screen overlay (showTiles): cache of the per-cell tile PNGs,
  // keyed by URL. Bumping tileVersion as they stream in triggers a repaint.
  const tileCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, setTileVersion] = useState(0);

  // editable copy of every area's glyphs; edits win over the loaded data
  const [edits, setEdits] = useState<Record<string, MapGlyph[]>>(() => {
    const m: Record<string, MapGlyph[]> = {};
    for (const a of data.areas) m[a.id] = a.map.glyphs.map((g) => ({ ...g }));
    return m;
  });
  const [tool, setTool] = useState<Tool>('save');
  const [saveMsg, setSaveMsg] = useState('');
  const glyphs = edits[area.id] ?? area.map.glyphs;

  // editable copy of every area's connectors (like `edits`)
  const [overlayEdits, setOverlayEdits] = useState<Record<string, Overlays>>(() => {
    const m: Record<string, Overlays> = {};
    for (const a of data.areas) m[a.id] = { connectors: a.map.connectors.map((c) => ({ ...c })) };
    return m;
  });
  // two-click placement anchor (map coords) and the selected connector (for naming)
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [selConn, setSelConn] = useState<number | null>(null);
  const overlays = overlayEdits[area.id] ?? { connectors: area.map.connectors };

  // editable room-name map: flat "areaId:tileX,tileY" -> name, seeded from data.
  // The Name tool paints this name across a rectangle of playable cells.
  const [roomEdits, setRoomEdits] = useState<Record<string, string>>(() => ({ ...(data.roomNames ?? {}) }));
  const [roomInput, setRoomInput] = useState('');
  const [roomAnchor, setRoomAnchor] = useState<Cell | null>(null);
  // rectangle staged by the second click, awaiting Enter in the auto-focused name box
  const [roomPending, setRoomPending] = useState<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);

  // editable per-cell difficulty ratings ("areaId:tileX,tileY" -> 1..6),
  // seeded from the loaded data. The Diff tool paints one cell per click.
  const [diffEdits, setDiffEdits] = useState<Record<string, number>>(() => ({ ...(data.cellDifficulty ?? {}) }));
  const [diffRating, setDiffRating] = useState(DEFAULT_RATING);
  // when set, the Diff tint only highlights cells matching diffRating
  const [diffIsolate, setDiffIsolate] = useState(false);
  // ratings the tint is allowed to show at all — independent of diffRating
  // (which one paints) and diffIsolate (how the match is highlighted).
  // hidden ratings get no tint, no outline, nothing.
  const [diffVisible, setDiffVisible] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5, 6]));

  /**
   * Cells the pointer can act on (hover outline, selection, rating), in MAP
   * coordinates: every drawn map cell, plus the guessable tiles that aren't
   * drawn. Connector cells — elevator shafts and Maridia's tube runs — are
   * overlay-only so they never enter `map.cells` (the map draws the connector,
   * not a room box), but they are real tiles, so they must still be pointable.
   */
  const selectable = useMemo(() => {
    const s = new Set<string>();
    for (const c of area.map.cells) s.add(`${c.x},${c.y}`);
    const { dx, dy } = area.map;
    for (const c of area.cells) s.add(`${c.x + dx},${c.y + dy}`);
    return s;
  }, [area]);

  // Room walls a diagonal passage opens through, keyed `x,y,dir`. In-game the
  // stairs flow straight into the room they meet, so that room draws no wall
  // on the shared edge. The opening is a band's short "cap" edge (its long
  // "rail" edges are the real stair walls) — NOT every edge that merely abuts
  // a diag cell: a room sitting directly under the staircase still keeps its
  // ceiling. So we walk each band's cap edges and mark the room-side wall of
  // the cell boundary each one straddles.
  const openWalls = useMemo(() => {
    const s = new Set<string>();
    const RAIL = 0.5; // map cells: rails span several, caps stay well under
    for (const b of area.map.bands ?? []) {
      const p = b.poly;
      for (let i = 0; i < p.length; i++) {
        const [ax, ay] = p[i];
        const [bx, by] = p[(i + 1) % p.length];
        const edx = Math.abs(bx - ax),
          edy = Math.abs(by - ay);
        if (edx >= RAIL && edy >= RAIL) continue; // a rail, not a cap
        if (edx < edy) {
          // vertical cap: passage opens E/W across a column boundary
          const col = Math.round((ax + bx) / 2);
          for (let y = Math.floor(Math.min(ay, by)); y <= Math.floor(Math.max(ay, by)); y++) {
            s.add(`${col - 1},${y},E`);
            s.add(`${col},${y},W`);
          }
        } else {
          // horizontal cap: passage opens N/S across a row boundary
          const row = Math.round((ay + by) / 2);
          for (let x = Math.floor(Math.min(ax, bx)); x <= Math.floor(Math.max(ax, bx)); x++) {
            s.add(`${x},${row - 1},SO`);
            s.add(`${x},${row},N`);
          }
        }
      }
    }
    return s;
  }, [area]);

  // playable (guessable) cells in TILE coords — the only cells ratings apply to
  const playableTiles = useMemo(() => new Set(area.cells.map((c) => `${c.x},${c.y}`)), [area]);

  // Jump to the target's area when a round ends.
  useEffect(() => {
    if (result) setAreaId(result.target.areaId);
  }, [result]);

  // Reveal "lock-on": a shrinking ring pulse around the target, 0 → 1 over 650ms.
  const [revealPulse, setRevealPulse] = useState(0);
  useEffect(() => {
    if (!result) {
      setRevealPulse(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 650);
      setRevealPulse(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  // Load ship and boss images
  useEffect(() => {
    const img = new Image();
    img.onload = () => setShipLoaded(true);
    img.src = `${import.meta.env.BASE_URL}assets/ship.png`;
    shipImageRef.current = img;

    const bossImg = new Image();
    bossImg.onload = () => setBossLoaded(true);
    bossImg.src = `${import.meta.env.BASE_URL}assets/boss.png`;
    bossImageRef.current = bossImg;
  }, []);

  // Lazily fetch the actual game screens for the current area while showTiles
  // is on; each arrival repaints so the overlay fills in progressively.
  useEffect(() => {
    if (!showTiles) return;
    let cancelled = false;
    for (const c of area.cells) {
      const url = tileUrl(data, { areaId: area.id, cell: c });
      if (tileCache.current.has(url)) continue;
      const img = new Image();
      img.onload = () => {
        if (!cancelled) setTileVersion((v) => v + 1);
      };
      tileCache.current.set(url, img);
      img.src = url;
    }
    return () => {
      cancelled = true;
    };
  }, [showTiles, area, data]);

  useEffect(draw); // repaint on every state change; canvas is small

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cols, rows, dx, dy } = area.map;
    const w = cols * S,
      h = rows * S; // logical dims (all draw math)
    const bw = w * SCALE,
      bh = h * SCALE; // backing/displayed px
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); // 1 logical unit -> SCALE css px

    // background: black with the purple dot lattice of the pause screen
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COL.dot;
    for (let y = S / 4; y < h; y += S / 2) {
      for (let x = S / 4; x < w; x += S / 2) {
        ctx.fillRect(x, y, 2, 2);
      }
    }

    // stair passages go first so room cells drawn after cover the band ends
    for (const b of area.map.bands ?? []) drawBand(ctx, b);
    for (const c of area.map.cells) drawCell(ctx, c);
    for (const c of overlays.connectors) drawConnector(ctx, c, false);
    if (editing) drawOverlayEditing(ctx);
    for (const g of glyphs) drawGlyph(ctx, g);
    if (showTiles) drawTiles(ctx);
    if (editing) (tool === 'difficulty' ? drawDiffTint : drawRoomTint)(ctx);

    const box = (tile: Cell, color: string, outlineColor: string | null, lw: number) => {
      const x = (tile.x + dx) * S + 1;
      const y = (tile.y + dy) * S + 1;
      const size = S - 2;
      if (outlineColor) {
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = lw + 2;
        ctx.strokeRect(x, y, size, size);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect(x, y, size, size);
    };

    if (!result) {
      if (hover) box({ x: hover.x - dx, y: hover.y - dy }, COL.hover, null, 1.5);
      if (selected && selected.areaId === area.id) box(selected.cell, COL.selected, null, 2.5);
    } else {
      if (result.guess.areaId === area.id) box(result.guess.cell, COL.guess, COL.guessOutline, 3.5);
      if (result.target.areaId === area.id) box(result.target.cell, COL.target, COL.targetOutline, 3.5);
      if (result.target.areaId === area.id && revealPulse < 1) {
        const cx = (result.target.cell.x + dx + 0.5) * S;
        const cy = (result.target.cell.y + dy + 0.5) * S;
        ctx.strokeStyle = COL.target;
        ctx.globalAlpha = 1 - revealPulse;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, S * (0.6 + revealPulse * 1.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (result.guess.areaId === area.id && result.target.areaId === area.id) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo((result.guess.cell.x + dx + 0.5) * S, (result.guess.cell.y + dy + 0.5) * S);
        ctx.lineTo((result.target.cell.x + dx + 0.5) * S, (result.target.cell.y + dy + 0.5) * S);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /**
   * A stair passage: a pink polygon with a cyan outline, like the in-game
   * map (which draws these sub-cell, not at 45°). The polygon is pre-clipped
   * to the source band's true pixel footprint (see extract_diag_bands), so
   * it mitres flush into the corridors it joins instead of a rotated
   * rectangle's corners poking past them. Clickable diag cells sit under it
   * and draw nothing themselves.
   */
  function drawBand(ctx: CanvasRenderingContext2D, b: DiagBand) {
    if (b.poly.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(b.poly[0][0] * S, b.poly[0][1] * S);
    for (const [px, py] of b.poly.slice(1)) ctx.lineTo(px * S, py * S);
    ctx.closePath();
    ctx.fillStyle = COL.room;
    ctx.fill();
    // rasterization can leave a hairline gap between the polygon's clipped
    // edge and the adjoining cell's boundary; a thin room-colored stroke
    // along the whole outline bridges it before the real walls go on top
    ctx.strokeStyle = COL.room;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Only the two long diagonal "rail" edges are real in-game walls. The
    // short edges left over from clipping the fitted band to its pixel
    // bounding box are the left/right end caps, where the passage opens into
    // the square room next door — the in-game map draws no wall there, the
    // diagonal simply bleeds into the room (drawCell likewise omits the
    // room's wall facing a diag cell). So stroke only the long edges and let
    // the pink fill/bridge stroke carry the caps into their neighbours.
    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const RAIL = 0.5; // map cells: rails span several, caps stay well under
    for (let i = 0; i < b.poly.length; i++) {
      const [ax, ay] = b.poly[i];
      const [bx, by] = b.poly[(i + 1) % b.poly.length];
      if (Math.abs(bx - ax) < RAIL || Math.abs(by - ay) < RAIL) continue;
      ctx.beginPath();
      ctx.moveTo(ax * S, ay * S);
      ctx.lineTo(bx * S, by * S);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  function drawCell(ctx: CanvasRenderingContext2D, c: MapCell) {
    const x = c.x * S,
      y = c.y * S;
    if (c.k === 'diag') return; // covered by its band
    if (c.k === 'vshaft') {
      ctx.fillStyle = COL.room;
      ctx.fillRect(x + S / 2 - 2, y, 4, S);
      return;
    }
    if (c.k === 'hshaft') {
      ctx.fillStyle = COL.room;
      ctx.fillRect(x, y + S / 2 - 2, S, 4);
      return;
    }
    ctx.fillStyle = COL.room;
    ctx.fillRect(x, y, S, S);
    // cyan walls — skipping any edge a diagonal passage opens through (see
    // openWalls): there the room flows straight into the stairs, no wall.
    const open = (dir: string) => openWalls.has(`${c.x},${c.y},${dir}`);
    ctx.fillStyle = COL.wall;
    if (c.w & N && !open('N')) ctx.fillRect(x, y, S, 2);
    if (c.w & SO && !open('SO')) ctx.fillRect(x, y + S - 2, S, 2);
    if (c.w & W && !open('W')) ctx.fillRect(x, y, 2, S);
    if (c.w & E && !open('E')) ctx.fillRect(x + S - 2, y, 2, S);
  }

  function drawGlyph(ctx: CanvasRenderingContext2D, g: MapGlyph) {
    const cx = g.x * S,
      cy = g.y * S;
    if (g.t === 'boss') {
      const img = bossImageRef.current;
      if (img && bossLoaded) {
        const bossWidth = S * 1.2;
        const bossHeight = (img.height / img.width) * bossWidth;
        ctx.drawImage(img, cx - bossWidth / 2, cy - bossHeight / 2, bossWidth, bossHeight);
      } else {
        // Fallback: orange diamond with dark core
        ctx.fillStyle = COL.ship;
        ctx.beginPath();
        ctx.moveTo(cx, cy - S * 0.45);
        ctx.lineTo(cx + S * 0.45, cy);
        ctx.lineTo(cx, cy + S * 0.45);
        ctx.lineTo(cx - S * 0.45, cy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#a01008';
        ctx.beginPath();
        ctx.arc(cx, cy, S * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (g.t === 'item') {
      // item blip: small bright dot, like the in-game map's item markers
      ctx.fillStyle = COL.item;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.16, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (g.t === 'ship') {
      const img = shipImageRef.current;
      if (img && shipLoaded) {
        const shipWidth = S * 1.8;
        const shipHeight = (img.height / img.width) * shipWidth;
        ctx.drawImage(img, cx - shipWidth / 2, cy - shipHeight / 2, shipWidth, shipHeight);
      } else {
        // Fallback triangle if image not loaded
        ctx.fillStyle = COL.ship;
        ctx.beginPath();
        ctx.moveTo(cx, cy - S / 2);
        ctx.lineTo(cx + S * 0.7, cy + S / 2);
        ctx.lineTo(cx - S * 0.7, cy + S / 2);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    const letters: Record<'save' | 'map' | 'recharge', string> = { save: 'S', map: 'M', recharge: 'R' };
    const colors: Record<'save' | 'map' | 'recharge', string> = { save: COL.map, map: COL.map, recharge: COL.map };
    const t = g.t as 'save' | 'map' | 'recharge';
    ctx.fillStyle = colors[t];
    ctx.font = `bold ${S - 4}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letters[t], cx, cy + 1);
  }

  /** A transit connector: twin cyan rails with a dashed pink core, in either
   *  orientation, plus the destination-area label on the chosen side. */
  function drawConnector(ctx: CanvasRenderingContext2D, c: Connector, preview: boolean) {
    const b = connBounds(c);
    ctx.save();
    if (preview) ctx.globalAlpha = 0.5;
    ctx.fillStyle = COL.wall; // twin rails, 4px apart, straddling the core
    ctx.strokeStyle = COL.room; // dashed core
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    if (connHorizontal(c)) {
      const cy = b.minY * S + S / 2;
      const left = b.minX * S,
        right = (b.maxX + 1) * S;
      ctx.fillRect(left, cy - 4, right - left, 2);
      ctx.fillRect(left, cy + 2, right - left, 2);
      ctx.beginPath();
      ctx.moveTo(left, cy);
      ctx.lineTo(right, cy);
      ctx.stroke();
    } else {
      const cx = b.minX * S + S / 2;
      const top = b.minY * S,
        bot = (b.maxY + 1) * S;
      ctx.fillRect(cx - 4, top, 2, bot - top);
      ctx.fillRect(cx + 2, top, 2, bot - top);
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, bot);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (c.label) drawConnectorLabel(ctx, c, b);
    ctx.restore();
  }

  /** the destination label, positioned on any of the connector's four sides */
  function drawConnectorLabel(ctx: CanvasRenderingContext2D, c: Connector, b: ReturnType<typeof connBounds>) {
    const midX = ((b.minX + b.maxX + 1) / 2) * S;
    const midY = ((b.minY + b.maxY + 1) / 2) * S;
    ctx.fillStyle = COL.wall;
    ctx.font = `bold ${S - 6}px monospace`;
    switch (c.labelPos ?? defaultLabelPos(c)) {
      case 'above':
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(c.label!, midX, b.minY * S - 2);
        break;
      case 'below':
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(c.label!, midX, (b.maxY + 1) * S + 2);
        break;
      case 'left':
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.label!, b.minX * S - 2, midY);
        break;
      case 'right':
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.label!, (b.maxX + 1) * S + 2, midY);
        break;
    }
  }

  /** editor-only overlays: selected-connector highlight + placement preview */
  function drawOverlayEditing(ctx: CanvasRenderingContext2D) {
    if (tool === 'connector' && selConn !== null) {
      const c = overlays.connectors[selConn];
      if (c) {
        const b = connBounds(c);
        ctx.strokeStyle = COL.selected;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b.minX * S + 0.5, b.minY * S + 0.5, (b.maxX - b.minX + 1) * S - 1, (b.maxY - b.minY + 1) * S - 1);
      }
    }
    if (tool === 'connector' && anchor && hover) {
      drawConnector(ctx, connectorFromDrag(anchor, hover), true);
    }
    // Name tool: rubber-band the fill rectangle from the anchor to the hover.
    if (tool === 'roomname' && roomAnchor && hover) {
      const minX = Math.min(roomAnchor.x, hover.x),
        maxX = Math.max(roomAnchor.x, hover.x);
      const minY = Math.min(roomAnchor.y, hover.y),
        maxY = Math.max(roomAnchor.y, hover.y);
      ctx.strokeStyle = COL.selected;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(minX * S + 0.5, minY * S + 0.5, (maxX - minX + 1) * S - 1, (maxY - minY + 1) * S - 1);
    }
    // Name tool: the rectangle staged after the second click, awaiting Enter.
    if (tool === 'roomname' && roomPending) {
      const { minX, maxX, minY, maxY } = roomPending;
      ctx.strokeStyle = COL.selected;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(minX * S + 0.5, minY * S + 0.5, (maxX - minX + 1) * S - 1, (maxY - minY + 1) * S - 1);
      ctx.setLineDash([]);
    }
  }

  /** Edit-mode overlay: tint named cells so the curator can see coverage at a
   *  glance. The actual name is read off the debug panel on hover (labels drawn
   *  on the small map are too cramped to read). Not drawn during play. */
  function drawRoomTint(ctx: CanvasRenderingContext2D) {
    const { dx, dy } = area.map;
    const prefix = `${area.id}:`;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 210, 77, 0.28)'; // soft yellow tint over named cells
    for (const [key, name] of Object.entries(roomEdits)) {
      if (!name || !key.startsWith(prefix)) continue;
      const [tx, ty] = key.slice(prefix.length).split(',').map(Number);
      ctx.fillRect((tx + dx) * S, (ty + dy) * S, S, S);
    }
    ctx.restore();
  }

  /** showTiles overlay: paint each playable cell's actual game screen (the
   *  sliced tile PNG) into its map position, so difficulty ratings can be
   *  judged against the real imagery. Images stream in asynchronously; cells
   *  whose PNG hasn't loaded yet keep the recreation fill until it arrives.
   *  Drawn under the Diff tint (which stays translucent) and the markers. */
  function drawTiles(ctx: CanvasRenderingContext2D) {
    const { dx, dy } = area.map;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const c of area.cells) {
      const img = tileCache.current.get(tileUrl(data, { areaId: area.id, cell: c }));
      if (!img || !img.complete || img.naturalWidth === 0) continue;
      ctx.drawImage(img, (c.x + dx) * S, (c.y + dy) * S, S, S);
    }
    ctx.restore();
  }

  /** Diff-tool overlay: every playable cell tinted by its rating (green →
   *  red, 6 = blacked out). Cells with no explicit rating show the default's
   *  color at lower alpha so unrated coverage is visible at a glance. */
  function drawDiffTint(ctx: CanvasRenderingContext2D) {
    const { dx, dy } = area.map;
    ctx.save();
    for (const c of area.cells) {
      const key = cellKey(area.id, c);
      const rated = key in diffEdits;
      const rating = rated ? diffEdits[key] : DEFAULT_RATING;
      if (!diffVisible.has(rating)) continue;
      if (diffIsolate) {
        if (rating !== diffRating) continue;
        // bright outline instead of a fill so room detail underneath stays visible
        const x = (c.x + dx) * S + 1.5;
        const y = (c.y + dy) * S + 1.5;
        ctx.strokeStyle = ISOLATE_HIGHLIGHT;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, S - 3, S - 3);
        continue;
      }
      const rgb = RATING_COLORS[rating] ?? RATING_COLORS[DEFAULT_RATING];
      const alpha = rating === EXCLUDED_RATING ? 0.8 : rated ? 0.55 : 0.25;
      ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
      ctx.fillRect((c.x + dx) * S, (c.y + dy) * S, S, S);
    }
    ctx.restore();
  }

  /** returns MAP coordinates. Uses the canvas' on-screen rect, so it accounts
   *  for the pan/zoom CSS transform automatically. */
  function cellFromPoint(clientX: number, clientY: number): Cell | null {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * area.map.cols);
    const y = Math.floor(((clientY - rect.top) / rect.height) * area.map.rows);
    if (x < 0 || y < 0 || x >= area.map.cols || y >= area.map.rows) return null;
    return { x, y };
  }
  const cellFromEvent = (e: { clientX: number; clientY: number }) => cellFromPoint(e.clientX, e.clientY);

  /** place a guess at the tapped/clicked point (shared by mouse click + touch
   *  tap). Converts map -> tile coords for scoring. */
  function selectAtPoint(clientX: number, clientY: number) {
    if (result) return;
    const c = cellFromPoint(clientX, clientY);
    if (!c || !selectable.has(`${c.x},${c.y}`)) return;
    const tileCell = { x: c.x - area.map.dx, y: c.y - area.map.dy };
    onSelect(area.id, tileCell);
    // Touch has no hover, so a tap doubles as the Scan Visor probe: report the
    // tapped cell so the scan panel shows its real screen (mirrors desktop hover).
    onHoverCell?.(area.id, tileCell, roomEdits[roomKeyAt(c)]);
  }

  const TAP_SLOP = 10; // px of movement below which a touch counts as a tap
  /** distance between the two active pointers (pinch only) */
  function pinchSpacing(g: (typeof gesture)['current']) {
    const [a, b] = [...g.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function onPointerDown(e: React.PointerEvent) {
    if (!panEnabled) return;
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer to capture (e.g. synthetic event) */
    }
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 1) {
      g.moved = 0;
      g.multi = false;
    } else if (g.pointers.size === 2) {
      g.multi = true; // a second finger touched: this gesture is a pinch, never a tap
      g.pinchDist = pinchSpacing(g); // reference spacing + zoom at pinch start
      g.pinchZ = viewRef.current?.z ?? 1;
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!panEnabled) return;
    const g = gesture.current;
    const p = g.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (g.pointers.size >= 2) {
      // pinch: zoom to (start zoom × spacing ratio) around the current midpoint
      const pts = [...g.pointers.values()];
      const el = scrollRef.current;
      if (!el || !g.pinchDist) return;
      const rect = el.getBoundingClientRect();
      const fx = (pts[0].x + pts[1].x) / 2 - rect.left;
      const fy = (pts[0].y + pts[1].y) / 2 - rect.top;
      const vw = el.clientWidth,
        vh = el.clientHeight;
      const { fitZ, maxZ } = zoomBounds(vw, vh);
      const z = Math.min(maxZ, Math.max(fitZ, (g.pinchZ * pinchSpacing(g)) / g.pinchDist));
      setView((v) => {
        if (!v) return v;
        const k = z / v.z;
        return clampView({ z, tx: fx - (fx - v.tx) * k, ty: fy - (fy - v.ty) * k }, vw, vh);
      });
    } else {
      // one finger: pan
      g.moved += Math.hypot(dx, dy);
      const el = scrollRef.current;
      if (!el) return;
      const vw = el.clientWidth,
        vh = el.clientHeight;
      setView((v) => (v ? clampView({ z: v.z, tx: v.tx + dx, ty: v.ty + dy }, vw, vh) : v));
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!panEnabled) return;
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    // a lone finger that barely moved (and never became a pinch) is a tap
    if (g.pointers.size === 0 && !g.multi && g.moved < TAP_SLOP) {
      selectAtPoint(e.clientX, e.clientY);
    }
    if (g.pointers.size === 0) g.multi = false;
  }

  function updateOverlays(fn: (o: Overlays) => Overlays) {
    setOverlayEdits((prev) => ({
      ...prev,
      [area.id]: fn(prev[area.id] ?? { connectors: [] })
    }));
  }

  /** stamp a landmark glyph at map cell c (centred in the cell) */
  function stampGlyph(c: Cell, t: GlyphType) {
    setEdits((prev) => {
      const list = (prev[area.id] ?? []).filter((g) => Math.floor(g.x) !== c.x || Math.floor(g.y) !== c.y);
      list.push({ x: c.x + 0.5, y: c.y + 0.5, t });
      return { ...prev, [area.id]: list };
    });
  }

  /** the "areaId:tileX,tileY" key for a map-coord cell (map -> tile: -dx/-dy) */
  function roomKeyAt(c: Cell): string {
    return cellKey(area.id, { x: c.x - area.map.dx, y: c.y - area.map.dy });
  }

  /** erase whatever overlay sits at map cell c (glyph, connector span, or name) */
  function eraseAt(c: Cell) {
    setEdits((prev) => ({
      ...prev,
      [area.id]: (prev[area.id] ?? []).filter((g) => Math.floor(g.x) !== c.x || Math.floor(g.y) !== c.y)
    }));
    updateOverlays((o) => ({ connectors: o.connectors.filter((k) => !connContains(k, c)) }));
    setRoomEdits((prev) => {
      const key = roomKeyAt(c);
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSelConn(null);
  }

  /** two-click room name: first click anchors, second click stages the fill
   *  rectangle and auto-focuses the name box. Enter (in the input) commits the
   *  typed name across every playable cell in the rectangle; empty commits
   *  clear them. Click a lone named cell twice with an empty field to preload
   *  its existing name for editing. */
  function placeRoom(c: Cell) {
    if (roomAnchor === null) {
      if (roomInput === '') {
        const existing = roomEdits[roomKeyAt(c)];
        if (existing) setRoomInput(existing);
      }
      setRoomAnchor(c);
      return;
    }
    const minX = Math.min(roomAnchor.x, c.x),
      maxX = Math.max(roomAnchor.x, c.x);
    const minY = Math.min(roomAnchor.y, c.y),
      maxY = Math.max(roomAnchor.y, c.y);
    setRoomPending({ minX, maxX, minY, maxY });
    setRoomAnchor(null);
  }

  /** commit the staged rectangle's cells to `roomInput`'s text (Enter in the name box) */
  function commitRoomPending() {
    if (!roomPending) return;
    const { minX, maxX, minY, maxY } = roomPending;
    const name = roomInput.trim();
    setRoomEdits((prev) => {
      const next = { ...prev };
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (!selectable.has(`${x},${y}`)) continue;
          const key = roomKeyAt({ x, y });
          if (name) next[key] = name;
          else delete next[key];
        }
      }
      return next;
    });
    setRoomPending(null);
    setRoomInput('');
  }

  // auto-focus the name box the instant a rectangle is staged
  useEffect(() => {
    if (roomPending) roomInputRef.current?.focus();
  }, [roomPending]);

  /** two-click connector: click empty to anchor/commit (orientation follows the
   *  dominant drag axis), click an existing connector to select it for naming */
  function placeConnector(c: Cell) {
    if (anchor === null) {
      const idx = overlays.connectors.findIndex((k) => connContains(k, c));
      if (idx >= 0) return setSelConn(idx); // select existing connector to rename it
      setSelConn(null);
      setAnchor(c);
      return;
    }
    updateOverlays((o) => ({ connectors: [...o.connectors, connectorFromDrag(anchor, c)] }));
    setSelConn(overlays.connectors.length); // index of the connector just added
    setAnchor(null);
  }

  function handleEditClick(c: Cell) {
    setSaveMsg('');
    if (tool === 'connector') return placeConnector(c);
    if (tool === 'roomname') return placeRoom(c);
    if (tool === 'difficulty') return paintDiff(c);
    if (tool === 'erase') return eraseAt(c);
    stampGlyph(c, tool); // tool narrows to GlyphType here
  }

  /** set the clicked cell's rating to the toolbar's selected value */
  function paintDiff(c: Cell) {
    const tile = { x: c.x - area.map.dx, y: c.y - area.map.dy };
    if (!playableTiles.has(`${tile.x},${tile.y}`)) return; // ratings only apply to guessable cells
    setDiffEdits((prev) => ({ ...prev, [cellKey(area.id, tile)]: diffRating }));
  }

  async function saveMap() {
    setSaveMsg('saving…');
    const glyphsOut: Record<string, MapGlyph[]> = {};
    for (const [id, list] of Object.entries(edits)) {
      glyphsOut[id] = list.map((g) => ({
        x: Math.round(g.x * 100) / 100,
        y: Math.round(g.y * 100) / 100,
        t: g.t
      }));
    }
    const overlaysOut: Record<string, Overlays> = {};
    for (const [id, o] of Object.entries(overlayEdits)) {
      if (o.connectors.length) overlaysOut[id] = o;
    }
    // drop empty names; sort keys so the file diffs cleanly between edits
    const roomNamesOut: Record<string, string> = {};
    for (const key of Object.keys(roomEdits).sort()) {
      if (roomEdits[key]) roomNamesOut[key] = roomEdits[key];
    }
    const difficultyOut: Record<string, number> = {};
    for (const key of Object.keys(diffEdits).sort()) {
      difficultyOut[key] = diffEdits[key];
    }
    try {
      const res = await fetch('/__save-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: data.game,
          glyphs: glyphsOut,
          overlays: overlaysOut,
          roomNames: roomNamesOut,
          // omit when empty so a session with no ratings doesn't create the file
          difficulty: Object.keys(difficultyOut).length ? difficultyOut : undefined
        })
      });
      setSaveMsg(res.ok ? 'saved ✓ (commit glyphs/overlays/roomNames/difficulty.*.json)' : `error: ${await res.text()}`);
    } catch (e) {
      setSaveMsg(`error: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="guess-map">
      <div className="area-tabs">
        <button className="shoulder l" title="Previous area" onClick={() => cycleArea(-1)}>
          L
        </button>
        {data.areas.map((a: AreaData) => (
          <button key={a.id} className={`tab ${a.id === areaId ? 'active' : ''}`} onClick={() => setAreaId(a.id)}>
            {a.name}
          </button>
        ))}
        <button className="shoulder r" title="Next area" onClick={() => cycleArea(1)}>
          R
        </button>
      </div>
      {editing && (
        <div className="icon-editor">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`btn tiny ${tool === t.id ? 'active' : ''}`}
              onClick={() => {
                setTool(t.id);
                setAnchor(null);
                setSelConn(null);
                setRoomAnchor(null);
                setRoomPending(null);
              }}
            >
              {t.label}
            </button>
          ))}
          {tool === 'roomname' && (
            <>
              <input
                ref={roomInputRef}
                className="edit-name"
                placeholder="room name"
                value={roomInput}
                onChange={(ev) => setRoomInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') commitRoomPending();
                  else if (ev.key === 'Escape') setRoomPending(null);
                }}
              />
              <span className="edit-msg">{roomPending ? 'type a name, Enter to fill' : roomAnchor ? 'click opposite corner' : "click a room's start corner"}</span>
            </>
          )}
          {tool === 'difficulty' && (
            <>
              {[1, 2, 3, 4, 5, 6].map((r) => (
                <button
                  key={r}
                  className={`btn tiny ${diffRating === r ? 'active' : ''}`}
                  style={{
                    background: `rgba(${RATING_COLORS[r]}, ${diffRating === r ? 0.9 : 0.45})`,
                    color: r === 6 ? '#eee' : '#111'
                  }}
                  title={r === 6 ? '6 — never served as a target' : `rating ${r} (1 easy … 5 hard)`}
                  onClick={() => setDiffRating(r)}
                >
                  {r}
                </button>
              ))}
              <button className={`btn tiny ${diffIsolate ? 'active' : ''}`} title="only tint cells matching the selected rating" onClick={() => setDiffIsolate((v) => !v)}>
                Isolate
              </button>
              <span className="edit-msg">Show:</span>
              {[1, 2, 3, 4, 5, 6].map((r) => {
                const shown = diffVisible.has(r);
                return (
                  <button
                    key={r}
                    className={`btn tiny ${shown ? 'active' : ''}`}
                    style={{
                      background: `rgba(${RATING_COLORS[r]}, ${shown ? 0.75 : 0.15})`,
                      color: r === 6 ? '#eee' : '#111',
                      opacity: shown ? 1 : 0.5
                    }}
                    title={`${shown ? 'hide' : 'show'} rating ${r} in the tint`}
                    onClick={() =>
                      setDiffVisible((prev) => {
                        const next = new Set(prev);
                        if (next.has(r)) next.delete(r);
                        else next.add(r);
                        return next;
                      })
                    }
                  >
                    {r}
                  </button>
                );
              })}
              <span className="edit-msg">
                {hover && selectable.has(`${hover.x},${hover.y}`) ? `hovered: ${diffEdits[roomKeyAt(hover)] ?? `${DEFAULT_RATING} (unrated)`}` : 'click a cell to rate it'}
              </span>
            </>
          )}
          {tool === 'connector' && selConn !== null && overlays.connectors[selConn] && (
            <>
              <input
                className="edit-name"
                placeholder="destination area"
                value={overlays.connectors[selConn].label ?? ''}
                onChange={(ev) => {
                  const label = ev.target.value;
                  updateOverlays((o) => ({
                    connectors: o.connectors.map((c, i) => (i === selConn ? { ...c, label } : c))
                  }));
                }}
              />
              <button
                className="btn tiny"
                title="Cycle the label around the connector's four sides"
                onClick={() => {
                  updateOverlays((o) => ({
                    connectors: o.connectors.map((c, i) => {
                      if (i !== selConn) return c;
                      const cur = c.labelPos ?? defaultLabelPos(c);
                      const next = LABEL_CYCLE[(LABEL_CYCLE.indexOf(cur) + 1) % LABEL_CYCLE.length];
                      return { ...c, labelPos: next };
                    })
                  }));
                }}
              >
                Label: {LABEL_ARROW[overlays.connectors[selConn].labelPos ?? defaultLabelPos(overlays.connectors[selConn])]}
              </button>
            </>
          )}
          <button className="btn tiny save" onClick={saveMap}>
            Save to file
          </button>
          {saveMsg && <span className="edit-msg">{saveMsg}</span>}
        </div>
      )}
      <div className={`map-scroll${panEnabled ? ' pan' : ''}`} ref={scrollRef}>
        <canvas
          ref={canvasRef}
          className={`map-canvas${editing ? ' editing' : ''}${panEnabled ? ' pan' : ''}`}
          style={panEnabled && view ? { transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`, transformOrigin: '0 0' } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseMove={(e) => {
            if (panEnabled) return; // touch/small screens use pointer handlers + no hover
            const c = cellFromEvent(e);
            const occ = c !== null && selectable.has(`${c.x},${c.y}`);
            // Report the pointed-at cell anywhere on the map, not just over drawn
            // rooms — empty cells still have a real coordinate (the scanner shows
            // it as "no signal"). null only when the cursor leaves the map.
            onHoverCell?.(area.id, c ? { x: c.x - area.map.dx, y: c.y - area.map.dy } : null, occ ? roomEdits[roomKeyAt(c!)] : undefined);
            if (editing) {
              setHover(c);
              return;
            }
            if (result) return;
            setHover(occ ? c : null);
          }}
          onMouseLeave={() => {
            setHover(null);
            onHoverCell?.(area.id, null);
          }}
          onClick={(e) => {
            if (panEnabled) return; // selection handled by the tap detector in onPointerUp
            const c = cellFromEvent(e);
            if (!c) return;
            if (editing) {
              handleEditClick(c);
              return;
            }
            if (result) return;
            if (!selectable.has(`${c.x},${c.y}`)) return;
            // convert map -> tile coordinates for scoring
            onSelect(area.id, { x: c.x - area.map.dx, y: c.y - area.map.dy });
          }}
        />
        {panEnabled && view && (
          <div className="map-zoom">
            <button className="map-zoom-btn" aria-label="Zoom in" onClick={() => zoomAround(1.5, (scrollRef.current?.clientWidth ?? 0) / 2, (scrollRef.current?.clientHeight ?? 0) / 2)}>
              +
            </button>
            <button className="map-zoom-btn" aria-label="Zoom out" onClick={() => zoomAround(1 / 1.5, (scrollRef.current?.clientWidth ?? 0) / 2, (scrollRef.current?.clientHeight ?? 0) / 2)}>
              −
            </button>
            <button className="map-zoom-btn" aria-label="Fit whole map" onClick={fitView}>
              ⤢
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
