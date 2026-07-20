import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AreaCell, AreaData, Cell, Connector, DiagBand, GameData, MapGlyph, RoundResult } from '../types';
import { cellKey, tileUrl } from '../data';
import { DEFAULT_RATING, EXCLUDED_RATING } from '../scoring';
import LandmarkEditor from './LandmarkEditor';
import RoomStateExplorer from './RoomStateExplorer';

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
type Tool = GlyphType | 'connector' | 'roomname' | 'difficulty' | 'landmark' | 'roomstate' | 'erase';

/** Subset of the dev /__landmarks/<game> payload the Landmark tint needs to map
 *  each raw-pixel sprite stamp back onto its map cell (mirrors LandmarkEditor). */
interface LandmarkTintData {
  manifest: Record<string, { sprite: string; x: number; y: number }[]>;
  areas: Record<string, { offsetX: number; offsetY: number; cellCropOffsets: Record<string, [number, number]> }>;
  cellWidth: number;
  cellHeight: number;
}

/** Station glyphs drawn as a single letter (same meaning across games, styled
 *  per `mapStyle`). navigation/data are Fusion-only. */
const GLYPH_LETTERS = { save: 'S', map: 'M', recharge: 'R', navigation: 'N', data: 'D' } as const;
/** The "letter rooms" GBA games outline in red — every lettered kind. */
const RED_WALL_GLYPHS = new Set<GlyphType>(['save', 'map', 'recharge', 'navigation', 'data']);
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'save', label: 'Save (S)' },
  { id: 'map', label: 'Map (M)' },
  { id: 'recharge', label: 'Recharge (R)' },
  { id: 'navigation', label: 'Nav' },
  { id: 'data', label: 'Data' },
  { id: 'ship', label: 'Ship' },
  { id: 'boss', label: 'Boss' },
  { id: 'item', label: 'Item' },
  { id: 'itemMajor', label: 'Major' },
  { id: 'chozo', label: 'Chozo' },
  { id: 'connector', label: 'Connector' },
  { id: 'roomname', label: 'Name' },
  { id: 'difficulty', label: 'Diff' },
  { id: 'landmark', label: 'Landmark' },
  { id: 'roomstate', label: 'Room state' },
  { id: 'erase', label: 'Erase' }
];

/** Map a game id onto the ship/boss sprite filename prefix in public/assets. */
const SPRITE_PREFIX: Record<string, string> = {
  'super-metroid': 'super',
  'metroid-fusion': 'fusion'
};

/** Per-area ship-sprite overrides for games whose ship art varies by area,
 *  keyed `game → areaId → asset basename` (…/assets/<name>.png). Zero Mission
 *  has two ships — Samus' in Crateria, the pirate frigate in Chozodia — and the
 *  rule is deterministic, so the area picks the image rather than the placer
 *  choosing a glyph type. Falls back to the game-wide `<prefix>-ship`. */
const SHIP_BY_AREA: Record<string, Record<string, string>> = {
  'metroid-zero-mission': { crateria: 'zm-samus-ship', chozodia: 'zm-pirate-ship' }
};

/** Per-area boss-sprite overrides, same shape as SHIP_BY_AREA. Zero Mission
 *  draws a distinct arena statue per boss area. Falls back to `<prefix>-boss`. */
const BOSS_BY_AREA: Record<string, Record<string, string>> = {
  'metroid-zero-mission': { kraid: 'zm-kraid-tile', ridley: 'zm-ridley-tile' }
};

/** Resolve the ship asset basename for a game + current area. */
function shipAsset(game: string, areaId: string): string {
  return SHIP_BY_AREA[game]?.[areaId] ?? `${SPRITE_PREFIX[game] ?? 'super'}-ship`;
}

/** Resolve the boss asset basename for a game + current area. */
function bossAsset(game: string, areaId: string): string {
  return BOSS_BY_AREA[game]?.[areaId] ?? `${SPRITE_PREFIX[game] ?? 'super'}-boss`;
}

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
 *  single cell (neither axis dominates) an explicit `horizontal` wins;
 *  otherwise the label side breaks the tie, so a 1-cell connector labelled
 *  left/right renders as a horizontal stub. The override exists for the one
 *  case the label can't cover: a horizontal stub labelled above/below. */
function connHorizontal(c: Connector) {
  const b = connBounds(c);
  const dx = b.maxX - b.minX,
    dy = b.maxY - b.minY;
  if (dx !== dy) return dx > dy;
  if (c.horizontal !== undefined) return c.horizontal;
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
/** css px per logical unit at view.z = 1 — the unit convention behind the pan/
 *  zoom plumbing (W0/H0, fitZ, zoomBounds) and the editing path's backing
 *  scale. Play-mode rendering is viewport-based (the canvas draws at the
 *  viewport's device resolution whatever the zoom), so this is NOT a quality
 *  knob. */
const SCALE = 2;
/** deepest zoom-in, expressed as the on-screen size of one map cell (css px).
 *  The map's base scale draws a cell at S*SCALE (32px), so this is the real
 *  zoom ceiling; large enough to inspect a single X-Ray screen up close. */
const MAX_CELL_PX = 176;

/* Marker colors (scan brackets, dot trail, target ring): shared visual
 * language across games, so they live outside the per-style palettes. */
const MARKERS = {
  hover: 'rgba(160, 248, 248, 0.6)',
  selected: '#ffd24d',
  item: '#f8f8f8',
  target: '#00ff88',
  /* Prime scan-visor brackets: cursor / placed guess markers */
  scan: '#a0f8f8',
  scanOutline: '#08262e',
  /* Zero Mission dot trail + Fusion target dot */
  trailDot: '#f8e048',
  trailOutline: '#1a1400',
  targetRing: '#00f858'
};

// SNES pause-map palette (Super Metroid recreation style)
const SNES_COL = {
  bg: '#000000',
  /** snes: the purple dot lattice; gba: the empty-cell square color */
  dot: '#40166e',
  room: '#d83890',
  wall: '#a0f8f8',
  map: '#00f858',
  ship: '#f88838',
  /** landmark-letter text color (S/M/R…) */
  letter: '#00f858',
  /** wall color of a "letter room" — Fusion outlines them red; SNES has no
   *  such rooms, so this is never drawn (kept equal to `wall`). */
  special: '#a0f8f8',
  /** room-fill variants (`CellDraw.f` indexes this; [0] === room) */
  fills: ['#d83890'],
  /** door-pip colors by letter (`CellDraw.dr`; gba style only) */
  doors: {} as Record<string, string>,
  /** gba style: a colored door also draws a jamb bar just inside the wall, so
   *  two adjacent cells compose the game's "H" lock. Fusion does this; Zero
   *  Mission draws its doors as small blocks on the border instead (see
   *  drawCell), so it turns this off. */
  doorJambs: true,
  ...MARKERS
};

// GBA pause-map palette (Fusion tile-art style) — exact colors from the
// source rips: navy lattice of empty squares, magenta/green room fills,
// white walls, colored door pips.
const GBA_COL: typeof SNES_COL = {
  bg: '#000090', // lattice grid lines
  dot: '#202048', // empty-cell square interiors
  room: '#f800f8',
  wall: '#f8f8f8',
  map: '#20c068',
  ship: '#f82048',
  letter: '#f8f800', // Fusion draws station letters in yellow
  special: '#f82048', // GBA games outline "letter rooms" (Save/Map/Nav/Data/Recharge) in red
  fills: ['#f800f8', '#20c068'],
  doors: { r: '#f82048', y: '#f8f800', g: '#10f880', b: '#0000f8' },
  doorJambs: true,
  ...MARKERS
};

// Zero Mission shares Fusion's map language but not its colors: dark-green
// lattice, blue/green/orange fills (mapped / unmapped-until-visited /
// super-heated), and pips for every door — light blue is the normal one.
// Chozo-statue and major-item rooms bake a big white icon over the fill, but
// the real room color bleeds through, so they keep their real fill (no white).
const ZM_COL: typeof SNES_COL = {
  ...GBA_COL,
  bg: '#085810', // lattice grid lines
  dot: '#202820', // empty-cell square interiors
  room: '#0000f8',
  fills: ['#0000f8', '#20c068', '#f86820'],
  doors: { r: '#f82048', y: '#f8f800', g: '#10f880', b: '#0070f8' },
  // ZM draws no "H" locks — its doors are small border blocks (see drawCell).
  doorJambs: false
};

/** Per-game palette overrides on top of the style default. */
const GAME_COL: Record<string, typeof SNES_COL> = {
  'metroid-zero-mission': ZM_COL
};

const N = 1,
  E = 2,
  SO = 4,
  W = 8;

/** Reveal timeline (ms). Every reveal opens the same way: the scan sweep
 *  passes over the map with only the guess marker showing (it persists from
 *  the selection the player just placed). Then, by outcome:
 *   - exact hit — the TARGET indicator + ring land as the sweep finishes,
 *     with a second ring pulse offset by RING2_DELAY;
 *   - same-area miss — the trail's origin dot lands center-cell as the sweep
 *     clears, holds a beat (DOT_PAUSE_MS), then the dot trail traces to the
 *     target (TRACE_MS) and the indicator locks on, with a shake on arrival
 *     if it's 10+ cells off;
 *   - wrong area — the map holds on the guessed area through the sweep, then
 *     cuts to the target's area with a hard shake and locks on immediately. */
const SWEEP_MS = 550; // scan sweep — keep in step with zgMapSweep in styles.css
const DOT_PAUSE_MS = 350; // beat between the guess marker landing and the trail firing
const TRACE_MS = 900; // dot trail guess→target
const RING_MS = 650; // target ring pulse
const RING2_DELAY = 350; // exact hit: second ring pulse offset
/** Fusion-style TARGET callout: palette flip cadence (runs while revealed). */
const TARGET_BLINK_MS = 350;

/**
 * The clickable guess map, rebuilt as web elements: cells from the actual
 * in-game pause map are drawn on canvas (rooms, shafts, station glyphs,
 * Samus' ship) — no environment art, knowledge only.
 */
export default function GuessMap({ data, selected, onSelect, onHoverCell, onAreaChange, result, editing, showTiles }: Props) {
  const mapStyle = data.mapStyle ?? 'snes';
  const COL = GAME_COL[data.game] ?? (mapStyle === 'gba' ? GBA_COL : SNES_COL);
  const [areaId, setAreaId] = useState(data.areas[0].id);
  const area = data.areas.find((a) => a.id === areaId)!;

  // GBA screens are 3:2 but their pause-map cells are square (true to the
  // game), so the X-Ray tile overlay smushes the screenshots. When X-Ray
  // engages we stretch the whole map horizontally to the screen's aspect, then
  // fade the real screens in. `aspect` is 1 for SNES (no stretch, instant).
  const aspect = mapStyle === 'gba' && data.cellWidth && data.cellHeight ? data.cellWidth / data.cellHeight : 1;
  // Engage timeline: 0 = square map, 1 = fully stretched with screens shown.
  const [xrayP, setXrayP] = useState(0);
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
  // Two-step: cells widen over the first 60% of the timeline, then the screens
  // fade in over the last 40% (and reverse cleanly on disengage).
  const stretchP = easeOut(Math.min(1, Math.max(0, xrayP / 0.6)));
  const tileP = easeOut(Math.min(1, Math.max(0, (xrayP - 0.6) / 0.4)));
  const xScale = 1 + (aspect - 1) * stretchP; // current horizontal scale (1 → aspect)
  // Animate xrayP toward showTiles. SNES has nothing to stretch, so it snaps
  // instantly (preserving the original instant toggle). Re-toggling mid-anim
  // eases from the current value.
  useEffect(() => {
    const to = showTiles ? 1 : 0;
    if (aspect === 1 || xrayP === to) {
      setXrayP(to);
      return;
    }
    let raf = 0;
    const from = xrayP;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 500);
      setXrayP(from + (to - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTiles]);

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

  // ---- pan/zoom ----------------------------------------------------------
  // The map is a fixed viewport you can pinch / wheel-zoom and drag-pan, its
  // default zoom fitting the whole area on screen. On phones this is the only
  // way the wide maps are usable; on desktop it's an optional deeper look. The
  // desktop viewport is sized to the fitted map (see `fittedSize`) so there's
  // no wasted letterbox space around it at the default zoom — the map fills it
  // edge to edge, exactly as the plain fit-to-viewport canvas used to.
  // Editing (a desktop-only dev mode) rides the same viewport — a click that
  // barely moves is an edit-tool action, a drag pans, the wheel zooms — so the
  // curator can zoom in to judge room difficulty. Every edit tool is
  // click-to-place (two discrete clicks for connectors/name rectangles, never a
  // drag), so nothing collides with the pan gesture.
  const scrollRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null); // measured region the desktop viewport is fitted into
  const [smallScreen, setSmallScreen] = useState(false);
  const [hoverCapable, setHoverCapable] = useState(false); // a mouse (not touch): drives hover preview
  useEffect(() => {
    const small = window.matchMedia('(max-width: 800px)');
    const hover = window.matchMedia('(hover: hover)');
    const update = () => {
      setSmallScreen(small.matches);
      setHoverCapable(hover.matches);
    };
    update();
    small.addEventListener('change', update);
    hover.addEventListener('change', update);
    return () => {
      small.removeEventListener('change', update);
      hover.removeEventListener('change', update);
    };
  }, []);
  const panEnabled = true; // play and editing both use the pan/zoom viewport
  const desktopPan = panEnabled && !smallScreen;

  // canvas' natural CSS size (backing store is 1:1 with CSS px): cols*S*SCALE.
  // xScale widens it while X-Ray is engaged so the pan fit math tracks the map.
  const W0 = area.map.cols * S * SCALE * xScale;
  const H0 = area.map.rows * S * SCALE;

  // Desktop: the pan viewport (.map-scroll) is sized to the fitted map so no
  // letterbox space surrounds it. `avail` is the region it's fitted into
  // (measured); `fittedSize` is the resulting content-box size. Phones don't
  // use this — their viewport is a CSS full-width / clamped-height window.
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  const fittedSize = useMemo(() => {
    if (!desktopPan || !avail) return null;
    const B = 2; // .map-scroll's 1px border, both sides — leave room for it
    const z = Math.min((avail.w - B) / W0, (avail.h - B) / H0);
    if (!isFinite(z) || z <= 0) return null;
    return { w: Math.round(W0 * z), h: Math.round(H0 * z) };
  }, [desktopPan, avail, W0, H0]);

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
  /** zoom bounds for the current viewport: out to whole-map, in to MAX_CELL_PX cells */
  function zoomBounds(vw: number, vh: number) {
    const fitZ = Math.min(vw / W0, vh / H0);
    return { fitZ, maxZ: Math.max(fitZ, MAX_CELL_PX / (S * SCALE)) };
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

  // latest zoomAround for the native wheel listener (avoids re-binding on pan)
  const zoomAroundRef = useRef(zoomAround);
  zoomAroundRef.current = zoomAround;
  // Desktop: the mouse wheel zooms toward the cursor. A native, non-passive
  // listener so we can preventDefault the page scroll; phones pinch instead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !desktopPan) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAroundRef.current(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [desktopPan]);

  // Desktop: measure the region the viewport is fitted into (the flex box that
  // wraps the map). Re-measured on resize; unused on phones (display:contents
  // there, so the wrapper has no box of its own).
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => setAvail({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panEnabled]);

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
  }, [panEnabled, area.id, showTiles, fittedSize?.w, fittedSize?.h]);

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
  // Cells whose walls draw red because a "letter room" glyph sits on them
  // (GBA-style games only — see RED_WALL_GLYPHS and drawCell's wall color).
  const specialCells = useMemo(() => {
    const s = new Set<string>();
    if (mapStyle !== 'gba') return s;
    for (const g of glyphs) if (RED_WALL_GLYPHS.has(g.t)) s.add(`${Math.floor(g.x)},${Math.floor(g.y)}`);
    return s;
  }, [glyphs, mapStyle]);

  // editable copy of every area's connectors (like `edits`)
  const [overlayEdits, setOverlayEdits] = useState<Record<string, Overlays>>(() => {
    const m: Record<string, Overlays> = {};
    for (const a of data.areas) m[a.id] = { connectors: a.map.connectors.map((c) => ({ ...c })) };
    return m;
  });
  // two-click placement anchor and the selected connector (for naming)
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [selConn, setSelConn] = useState<number | null>(null);
  // cell whose landmark stamps the zoomed Landmark panel is editing
  const [landmarkCell, setLandmarkCell] = useState<Cell | null>(null);
  // a cell is only meaningful within its area — close the panel on area switch
  useEffect(() => setLandmarkCell(null), [area.id]);
  // cell whose Randovania room render the Room state panel is exploring
  const [roomStateCell, setRoomStateCell] = useState<Cell | null>(null);
  useEffect(() => setRoomStateCell(null), [area.id]);
  // the tool is GBA-only (its toolbar button is hidden elsewhere) — drop it if
  // a non-GBA game arrives with it still selected
  useEffect(() => {
    if (tool === 'roomstate' && mapStyle !== 'gba') setTool('save');
  }, [tool, mapStyle]);
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

  // Landmark-tint data: the baked sprite manifest (dev-only endpoint), fetched
  // lazily the first time the Landmark tool is picked in edit mode. Used only to
  // tint cells that already hold a stamp, so the curator sees coverage. In a
  // built site (no dev server) the fetch fails and nothing tints — the editor is
  // dev-only anyway.
  const [landmarkData, setLandmarkData] = useState<LandmarkTintData | null>(null);
  // stamp sprite -> pixel dimensions, needed to test a stamp's overlap with a cell
  const [landmarkDims, setLandmarkDims] = useState<Record<string, { w: number; h: number }>>({});
  useEffect(() => {
    if (!editing || tool !== 'landmark' || landmarkData) return;
    fetch(`/__landmarks/${data.game}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: LandmarkTintData) => setLandmarkData(d))
      .catch(() => {});
  }, [editing, tool, data.game, landmarkData]);
  useEffect(() => {
    if (!landmarkData) return;
    for (const list of Object.values(landmarkData.manifest)) {
      for (const st of list) {
        if (landmarkDims[st.sprite]) continue;
        const img = new Image();
        img.onload = () => setLandmarkDims((prev) => ({ ...prev, [st.sprite]: { w: img.width, h: img.height } }));
        img.src = `/__landmark-sprite/${data.game}/${st.sprite}`;
      }
    }
  }, [landmarkData, data.game, landmarkDims]);
  /** cells of the current area whose source rect overlaps a manifest stamp */
  const landmarkCells = useMemo(() => {
    const s = new Set<string>();
    const meta = landmarkData?.areas[area.id];
    const stamps = landmarkData?.manifest[area.id];
    if (!landmarkData || !meta || !stamps) return s;
    const { cellWidth, cellHeight } = landmarkData;
    for (const c of area.cells) {
      const [dxp, dyp] = meta.cellCropOffsets[`${c.x},${c.y}`] ?? [0, 0];
      const rx = meta.offsetX + c.x * cellWidth + dxp;
      const ry = meta.offsetY + c.y * cellHeight + dyp;
      for (const st of stamps) {
        const dim = landmarkDims[st.sprite];
        if (!dim) continue;
        if (st.x < rx + cellWidth && st.x + dim.w > rx && st.y < ry + cellHeight && st.y + dim.h > ry) {
          s.add(`${c.x},${c.y}`);
          break;
        }
      }
    }
    return s;
  }, [landmarkData, landmarkDims, area]);

  // Room-state tint data: the saved tileOverrides manifest (dev-only endpoint),
  // fetched lazily the first time the Room state tool is picked — tints cells
  // that already carry a baked override so the curator sees coverage.
  const [roomStateTint, setRoomStateTint] = useState<Record<string, { x: number; y: number }[]> | null>(null);
  useEffect(() => {
    if (!editing || tool !== 'roomstate' || roomStateTint) return;
    fetch(`/__room-state/${data.game}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { manifest: Record<string, { x: number; y: number }[]> }) => setRoomStateTint(d.manifest))
      .catch(() => {});
  }, [editing, tool, data.game, roomStateTint]);

  /** cells of the area sharing the explored cell's room name (live Name-tool
   *  edits included) — the Room state panel derives the room's origin from them */
  const roomStateCells = useMemo(() => {
    if (!roomStateCell) return [];
    const name = roomEdits[cellKey(area.id, roomStateCell)];
    if (!name) return [];
    const prefix = `${area.id}:`;
    const out: Cell[] = [];
    for (const [key, n] of Object.entries(roomEdits)) {
      if (n !== name || !key.startsWith(prefix)) continue;
      const [x, y] = key.slice(prefix.length).split(',').map(Number);
      out.push({ x, y });
    }
    return out;
  }, [roomEdits, area.id, roomStateCell]);

  /** every cell of the area, for pointer hit-testing (tile coords) */
  const selectable = useMemo(() => new Set(area.cells.map((c) => `${c.x},${c.y}`)), [area]);

  /** knob cells keyed "x,y" -> wall bits: knobs are sub-cell boxes inset toward
   *  a connector, so an item drawn on one nudges to the box's real centre (away
   *  from the rail side) rather than the cell centre. */
  const knobWalls = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of area.cells) if (c.k === 'knob') m.set(`${c.x},${c.y}`, c.w);
    return m;
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
    const RAIL = 0.5; // cells: rails span several, caps stay well under
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

  // Jump to the target's area when a round ends. A wrong-area guess holds on
  // the guessed map while the scan sweep passes — the cut to the real area IS
  // its reveal, landing with the shake once the sweep clears.
  useEffect(() => {
    if (!result) return;
    if (result.target.areaId === result.guess.areaId) {
      setAreaId(result.target.areaId);
      return;
    }
    const t = setTimeout(() => setAreaId(result.target.areaId), SWEEP_MS);
    return () => clearTimeout(t);
  }, [result]);

  // Reveal lock-on timeline: ms elapsed since the round ended. Drives the
  // traced guess→target line, the target blink-in, and the ring pulse(s) —
  // all staged off this one clock inside draw().
  const [revealT, setRevealT] = useState(0);
  // Reveal milestones on the revealT clock (see the timeline constants). The
  // sweep leads every outcome; only a same-area miss adds the dot-pause and
  // trace beats before the TARGET indicator locks on at lockMs.
  const sameAreaMiss = !!result && isFinite(result.distance) && result.distance > 0;
  const traceStartMs = SWEEP_MS + DOT_PAUSE_MS; // same-area miss: shake + trail fire here
  const lockMs = sameAreaMiss ? traceStartMs + TRACE_MS : SWEEP_MS;
  const revealTotal = lockMs + RING_MS + (result?.distance === 0 ? RING2_DELAY : 0);
  // Bad-guess feedback, staged on the same clock and always landing with the
  // TARGET lock-on: a far same-area miss (10+ cells) rattles the map as the
  // trail reaches the target; a wrong-area reveal rattles harder as it cuts to
  // the target's area. Adding the class starts the CSS animation, so the
  // keyframes carry no delays of their own.
  const shakeClass = !result || revealT < lockMs ? '' : !isFinite(result.distance) ? ' shake-wrong' : sameAreaMiss && result.distance >= 10 ? ' shake-far' : '';
  useEffect(() => {
    if (!result) {
      setRevealT(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const el = Math.min(revealTotal, t - start);
      setRevealT(el);
      if (el < revealTotal) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Guess-placement pop: a quick expanding ring on the cell just clicked.
  const [selectPulse, setSelectPulse] = useState(1);
  useEffect(() => {
    if (!selected || result) return;
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 250);
      setSelectPulse(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [selected, result]);

  // When the reveal's target sits outside the current pan view (the player
  // was zoomed in on their guess), follow the dot trail as it draws — keep the
  // tip centered until lock-on, then hand control back. Applies wherever pan is
  // live (phones always, desktop once zoomed past the fitted default).
  const followTip = useRef(false);
  useEffect(() => {
    followTip.current = false;
    if (!result || !panEnabled) return;
    const el = scrollRef.current;
    const v = viewRef.current;
    if (!el || !v) return;
    // only the same-area miss draws a trail; cross-area reveals refit anyway
    if (!isFinite(result.distance) || result.distance <= 0 || result.guess.areaId !== result.target.areaId) return;
    const { dx, dy } = area.map;
    const sx = v.tx + (result.target.cell.x + dx + 0.5) * S * SCALE * xScale * v.z;
    const sy = v.ty + (result.target.cell.y + dy + 0.5) * S * SCALE * v.z;
    const m = 12; // nearly-offscreen counts as hidden
    followTip.current = sx < m || sx > el.clientWidth - m || sy < m || sy > el.clientHeight - m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, panEnabled]);
  useEffect(() => {
    if (!followTip.current || !result || !panEnabled) return;
    const el = scrollRef.current;
    if (!el) return;
    const vw = el.clientWidth,
      vh = el.clientHeight;
    if (!vw || !vh) return;
    // mirror the trail's easing so the view tracks the drawn tip exactly
    const p = Math.max(0, Math.min(1, (revealT - traceStartMs) / TRACE_MS));
    const e = 1 - Math.pow(1 - p, 3);
    const { dx, dy } = area.map;
    const gx = (result.guess.cell.x + dx + 0.5) * S * SCALE * xScale;
    const gy = (result.guess.cell.y + dy + 0.5) * S * SCALE;
    const tx = (result.target.cell.x + dx + 0.5) * S * SCALE * xScale;
    const ty = (result.target.cell.y + dy + 0.5) * S * SCALE;
    const tipX = gx + (tx - gx) * e;
    const tipY = gy + (ty - gy) * e;
    setView((v) => (v ? clampView({ z: v.z, tx: vw / 2 - tipX * v.z, ty: vh / 2 - tipY * v.z }, vw, vh) : v));
    if (p >= 1) followTip.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealT, result, panEnabled]);

  // Fusion-style TARGET callout: flips its palette on a slow interval for as
  // long as the reveal is up (a 3fps repaint, not a rAF loop). Reduced motion
  // holds the steady dark/gold state instead.
  const [targetBlink, setTargetBlink] = useState(false);
  useEffect(() => {
    if (!result) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setTargetBlink((b) => !b), TARGET_BLINK_MS);
    return () => {
      clearInterval(id);
      setTargetBlink(false);
    };
  }, [result]);

  // Load the ship and boss sprites. Both can vary by area (Zero Mission's two
  // ships and its per-arena boss statues), so each is resolved from game + area
  // and reloaded when the player moves between areas.
  useEffect(() => {
    setShipLoaded(false);
    setBossLoaded(false);

    const img = new Image();
    img.onload = () => setShipLoaded(true);
    img.src = `${import.meta.env.BASE_URL}assets/${shipAsset(data.game, area.id)}.png`;
    shipImageRef.current = img;

    const bossImg = new Image();
    bossImg.onload = () => setBossLoaded(true);
    bossImg.src = `${import.meta.env.BASE_URL}assets/${bossAsset(data.game, area.id)}.png`;
    bossImageRef.current = bossImg;
  }, [data.game, area.id]);

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

  useEffect(draw); // repaint on every state change (incl. each pan/zoom step; draws are culled to the viewport)

  /**
   * Anchor for the DOM TARGET callout, in map-scroll content coordinates
   * (rect-based, so pan/zoom transforms and fitted scaling are handled for
   * free). Sits opposite the incoming dot trail so the two never overlap;
   * defaults left (Fusion style) on wrong-area reveals; flips when the
   * viewport edge would cut it off. Null while the trail is still tracing or
   * the target's area isn't on screen. Re-measured every render — the blink
   * interval keeps that fresh through resizes while the callout is up.
   */
  function calloutPos(): { x: number; y: number; right: boolean } | null {
    const cv = canvasRef.current;
    const sc = scrollRef.current;
    if (!cv || !sc || !result || result.target.areaId !== area.id) return null;
    if (revealT < lockMs) return null;
    const cr = cv.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    if (cr.width === 0 || sr.width === 0) return null;
    const { cols, rows, dx, dy } = area.map;
    let ax: number, ay: number, gap: number;
    if (view) {
      // viewport rendering: the canvas is the viewport, so the anchor comes
      // from the view transform (canvas sits at the scroll box's origin)
      const sv = snapView(view); // mirror the snapped draw transform exactly
      ax = (sv.tx + (result.target.cell.x + dx + 0.5) * sv.cw) / sv.dpr;
      ay = (sv.ty + (result.target.cell.y + dy + 0.5) * sv.ch) / sv.dpr;
      gap = (8 / S) * (sv.cw / sv.dpr) + 10; // clear the dashed ring + tail (8 logical px, in css px)
    } else {
      // editing (legacy full-map canvas, CSS-fitted): rect proportions
      ax = cr.left - sr.left + sc.scrollLeft + ((result.target.cell.x + dx + 0.5) / cols) * cr.width;
      ay = cr.top - sr.top + sc.scrollTop + ((result.target.cell.y + dy + 0.5) / rows) * cr.height;
      gap = (8 / (cols * S)) * cr.width + 10;
    }
    const estW = 84; // label + frame + tail estimate, for edge flipping
    const hasTrail = isFinite(result.distance) && result.distance > 0 && result.guess.areaId === result.target.areaId;
    let right = hasTrail ? result.guess.cell.x <= result.target.cell.x : false;
    const lo = sc.scrollLeft;
    const hi = sc.scrollLeft + sr.width;
    if (right && ax + gap + estW > hi && ax - gap - estW >= lo) right = false;
    if (!right && ax - gap - estW < lo && ax + gap + estW <= hi) right = true;
    const y = Math.max(sc.scrollTop + 16, Math.min(sc.scrollTop + sr.height - 16, ay));
    return { x: right ? ax + gap : ax - gap, y, right };
  }
  const callout = calloutPos();

  /** The view quantized to whole device pixels per cell (plus a rounded pan
   *  offset), so every cell edge lands exactly on a device pixel. Fractional
   *  edges antialias, and adjacent cells' partial coverage lets the layer
   *  underneath bleed through as hairline seams between tiles. Rendering,
   *  hit-testing (cellFromPoint) and the callout anchor must all use these
   *  SAME numbers — mixing snapped and unsnapped math drifts by up to half a
   *  device px per column across the map. */
  function snapView(v: { z: number; tx: number; ty: number }) {
    const dpr = window.devicePixelRatio || 1;
    return {
      dpr,
      cw: Math.max(1, Math.round(v.z * SCALE * xScale * S * dpr)), // device px per cell
      ch: Math.max(1, Math.round(v.z * SCALE * S * dpr)),
      tx: Math.round(v.tx * dpr),
      ty: Math.round(v.ty * dpr)
    };
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cols, rows, dx, dy } = area.map;
    const w = cols * S,
      h = rows * S; // logical dims (all draw math)
    const ctx = canvas.getContext('2d')!;
    // Visible-cell culling bounds in canvas-grid columns/rows (whole map when
    // the legacy path draws, the on-screen slice under viewport rendering).
    let gx0 = 0,
      gy0 = 0,
      gx1 = cols - 1,
      gy1 = rows - 1;
    if (view) {
      // Viewport rendering (all play modes): the canvas IS the .map-scroll
      // viewport, backed at device resolution, and the pan/zoom view is
      // composed into the draw transform — each frame renders just the visible
      // slice of the map at its current zoom, so vectors stay crisp at any
      // depth and memory is bounded by the viewport regardless of map size.
      // xScale (X-Ray's GBA 3:2 stretch) rides the same transform.
      const sc = scrollRef.current;
      if (!sc) return;
      const sv = snapView(view);
      const bw = Math.round(sc.clientWidth * sv.dpr),
        bh = Math.round(sc.clientHeight * sv.dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bh); // letterbox around the map shows .map-scroll's bg
      // device-snapped: sv.cw/sv.ch device px per cell, origin at (sv.tx, sv.ty)
      ctx.setTransform(sv.cw / S, 0, 0, sv.ch / S, sv.tx, sv.ty);
      gx0 = Math.max(0, Math.floor(-sv.tx / sv.cw));
      gy0 = Math.max(0, Math.floor(-sv.ty / sv.ch));
      gx1 = Math.min(cols - 1, Math.floor((bw - sv.tx) / sv.cw));
      gy1 = Math.min(rows - 1, Math.floor((bh - sv.ty) / sv.ch));
    } else {
      // Editing (desktop-only dev mode, no pan/zoom): legacy full-map backing,
      // CSS-fitted. xScale widens it while X-Ray is engaged.
      const bw = Math.round(w * SCALE * xScale),
        bh = h * SCALE; // backing/displayed px
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      ctx.setTransform(SCALE * xScale, 0, 0, SCALE, 0, 0); // 1 logical unit -> SCALE css px (x widened by xScale)
    }
    // Tile-coordinate culling bounds for the cell loops (mirror of gx/gy).
    const vis = { x0: gx0 - dx, y0: gy0 - dy, x1: gx1 - dx, y1: gy1 - dy };

    // background: the pause screen's empty-space treatment, drawn only over
    // the visible cell range. SNES draws a purple dot lattice on black; GBA
    // draws a grid of dark squares on navy lines (1 source px of line = 2
    // logical px around each 8px cell).
    ctx.fillStyle = COL.bg;
    ctx.fillRect(gx0 * S, gy0 * S, (gx1 - gx0 + 1) * S, (gy1 - gy0 + 1) * S);
    ctx.fillStyle = COL.dot;
    if (mapStyle === 'gba') {
      for (let cy = gy0; cy <= gy1; cy++) {
        for (let cx = gx0; cx <= gx1; cx++) {
          ctx.fillRect(cx * S + 2, cy * S + 2, S - 4, S - 4);
        }
      }
    } else {
      // dot phase: lattice points sit at S/4 + k*S/2, so a row's first is gy*S + S/4
      for (let y = gy0 * S + S / 4; y < (gy1 + 1) * S; y += S / 2) {
        for (let x = gx0 * S + S / 4; x < (gx1 + 1) * S; x += S / 2) {
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }

    // The tile grid sits at (dx,dy) on the map canvas. Translate once here and
    // every draw below is plain tile coordinates — the only place the two
    // grids meet (its mirror is `cellFromPoint`).
    ctx.save();
    ctx.translate(dx * S, dy * S);

    // stair passages go first so room cells drawn after cover the band ends
    for (const b of area.map.bands ?? []) drawBand(ctx, b);
    for (const c of area.cells) {
      if (c.x < vis.x0 || c.x > vis.x1 || c.y < vis.y0 || c.y > vis.y1) continue;
      drawCell(ctx, c);
    }
    for (const c of overlays.connectors) drawConnector(ctx, c, false);
    if (editing) drawOverlayEditing(ctx);
    for (const g of glyphs) drawGlyph(ctx, g);
    if (tileP > 0) drawTiles(ctx, vis);
    if (editing) {
      if (tool === 'difficulty') drawDiffTint(ctx);
      else if (tool === 'roomname') drawRoomTint(ctx);
      else if (tool === 'landmark') drawLandmarkTint(ctx);
      else if (tool === 'roomstate') drawRoomStateTint(ctx);
    }

    // Prime scan-visor brackets: four corner Ls around a cell, in place of a
    // full box — the same motif as the tile viewer's frame corners.
    const brackets = (tile: Cell, color: string, lw: number, outlineColor: string | null) => {
      const x = tile.x * S + 1;
      const y = tile.y * S + 1;
      const size = S - 2;
      const leg = 5;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(x, y + leg);
        ctx.lineTo(x, y);
        ctx.lineTo(x + leg, y);
        ctx.moveTo(x + size - leg, y);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x + size, y + leg);
        ctx.moveTo(x + size, y + size - leg);
        ctx.lineTo(x + size, y + size);
        ctx.lineTo(x + size - leg, y + size);
        ctx.moveTo(x + leg, y + size);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x, y + size - leg);
      };
      if (outlineColor) {
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = lw + 2;
        path();
        ctx.stroke();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      path();
      ctx.stroke();
    };

    // One-shot expanding ring centered on a cell; p in (0,1) — no-op outside.
    const ring = (tile: Cell, p: number, color: string) => {
      if (p <= 0 || p >= 1) return;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((tile.x + 0.5) * S, (tile.y + 0.5) * S, S * (0.6 + p * 1.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // A single trail dot — shared by the origin anchor and the traced line.
    const trailDot = (px: number, py: number, half: number) => {
      ctx.fillStyle = COL.trailOutline;
      ctx.fillRect(px - half - 1, py - half - 1, half * 2 + 2, half * 2 + 2);
      ctx.fillStyle = COL.trailDot;
      ctx.fillRect(px - half, py - half, half * 2, half * 2);
    };
    // Zero Mission-style trail: a run of thrown dots along the guess→target
    // path (no solid line), with a larger head dot leading while it traces.
    const dotTrail = (gx: number, gy: number, tx: number, ty: number, prog: number) => {
      const dist = Math.hypot(tx - gx, ty - gy);
      const ux = (tx - gx) / dist;
      const uy = (ty - gy) / dist;
      const reach = prog * dist;
      const head = Math.min(reach, dist - 8);
      // dots start clear of the guess brackets and stop short of the target dot
      for (let s = 8; s <= head; s += 9) trailDot(gx + ux * s, gy + uy * s, 1.5);
      if (prog < 1) trailDot(gx + ux * head, gy + uy * head, 2.5); // the thrown head dot
    };

    // Fusion-style target indicator: a sun-yellow dot in a red dashed ring
    // (dark under-dash so it reads on the pink rooms), with a blinking TARGET
    // callout pointing at it.
    const targetIndicator = (tile: Cell, blink: boolean) => {
      const cx = (tile.x + 0.5) * S;
      const cy = (tile.y + 0.5) * S;
      // the dot + its ticking ring (the dash pattern jumps with each blink)
      ctx.fillStyle = COL.trailOutline;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COL.trailDot;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      const ringDash = (color: string, lw: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.setLineDash([3, 2.5]);
        ctx.lineDashOffset = blink ? 2.75 : 0;
        ctx.beginPath();
        ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
        ctx.stroke();
      };
      ringDash('#04060f', 3.5); // dark under-dash: contrast against room pink
      ringDash(COL.targetRing, 1.5);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      // The TARGET callout itself is a DOM overlay (see calloutPos) — canvas
      // text turns to mush when the canvas is displayed far below its backing
      // resolution, while DOM text rasterizes at screen resolution.
    };

    if (!result) {
      if (hover) brackets(hover, COL.hover, 1.5, null);
      if (selected && selected.areaId === area.id) {
        brackets(selected.cell, COL.scan, 2.5, COL.scanOutline);
        ring(selected.cell, selectPulse, COL.scan);
      }
    } else {
      // Reveal, staged on the revealT clock. The guess marker stays put from
      // the moment of submit — continuity with the selection brackets the
      // player just placed — while everything else (trail, shake, TARGET)
      // waits out the scan sweep (see timeline constants).
      if (result.guess.areaId === area.id) brackets(result.guess.cell, COL.scan, 3, COL.scanOutline);
      if (revealT >= SWEEP_MS) {
        const lockT = revealT - lockMs; // ms since the target lock-on began
        if (sameAreaMiss && result.guess.areaId === area.id && result.target.areaId === area.id) {
          const gx = (result.guess.cell.x + 0.5) * S;
          const gy = (result.guess.cell.y + 0.5) * S;
          const tcx = (result.target.cell.x + 0.5) * S;
          const tcy = (result.target.cell.y + 0.5) * S;
          // adjacent cells skip the whole trail: markers alone tell the story
          if (Math.hypot(tcx - gx, tcy - gy) > 12) {
            // the origin dot lands center-cell the moment the sweep clears and
            // holds through the dot pause; the trail then stretches out from it
            trailDot(gx, gy, 2.5);
            const p = Math.max(0, Math.min(1, (revealT - traceStartMs) / TRACE_MS));
            const e = 1 - Math.pow(1 - p, 3);
            if (p > 0) dotTrail(gx, gy, tcx, tcy, e);
          }
        }
        if (result.target.areaId === area.id && lockT >= 0) {
          ring(result.target.cell, lockT / RING_MS, COL.target);
          // Exact guess: a second pulse for the direct hit.
          if (result.distance === 0) ring(result.target.cell, (lockT - RING2_DELAY) / RING_MS, COL.target);
          targetIndicator(result.target.cell, targetBlink);
        }
      }
    }
    ctx.restore();
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
    const RAIL = 0.5; // cells: rails span several, caps stay well under
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

  function drawCell(ctx: CanvasRenderingContext2D, c: AreaCell) {
    const x = c.x * S,
      y = c.y * S;
    if (!c.k) return; // a real tile the pause map doesn't chart (see AreaCell)
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
    if (c.k === 'knob') {
      // Sub-cell passage (gba style): a small outlined box, inset from the
      // cell edge on each w-bit side (there twin rails bridge the gap), with
      // an opening per dr pip. See MapCellKind.
      const fill = COL.fills[c.f ?? 0] ?? COL.room;
      const iN = c.w & N ? S / 4 : 0;
      const iS = c.w & SO ? S / 4 : 0;
      const iW = c.w & W ? S / 4 : 0;
      const iE = c.w & E ? S / 4 : 0;
      ctx.fillStyle = COL.wall;
      ctx.fillRect(x + iW, y + iN, S - iW - iE, S - iN - iS);
      ctx.fillStyle = fill;
      ctx.fillRect(x + iW + 2, y + iN + 2, S - iW - iE - 4, S - iN - iS - 4);
      for (const p of c.dr ?? []) {
        ctx.fillStyle = fill;
        if (p[0] === 'N') ctx.fillRect(x + S / 2 - 2, y + iN, 4, 2);
        else if (p[0] === 'S') ctx.fillRect(x + S / 2 - 2, y + S - iS - 2, 4, 2);
        else if (p[0] === 'W') ctx.fillRect(x + iW, y + S / 2 - 2, 2, 4);
        else if (p[0] === 'E') ctx.fillRect(x + S - iE - 2, y + S / 2 - 2, 2, 4);
        ctx.fillStyle = COL.wall;
        if (p[0] === 'N' && iN) {
          ctx.fillRect(x + S / 2 - 4, y, 2, iN);
          ctx.fillRect(x + S / 2 + 2, y, 2, iN);
        } else if (p[0] === 'S' && iS) {
          ctx.fillRect(x + S / 2 - 4, y + S - iS, 2, iS);
          ctx.fillRect(x + S / 2 + 2, y + S - iS, 2, iS);
        } else if (p[0] === 'W' && iW) {
          ctx.fillRect(x, y + S / 2 - 4, iW, 2);
          ctx.fillRect(x, y + S / 2 + 2, iW, 2);
        } else if (p[0] === 'E' && iE) {
          ctx.fillRect(x + S - iE, y + S / 2 - 4, iE, 2);
          ctx.fillRect(x + S - iE, y + S / 2 + 2, iE, 2);
        }
      }
      return;
    }
    const fill = COL.fills[c.f ?? 0] ?? COL.room;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, S, S);
    // walls — skipping any edge a diagonal passage opens through (see
    // openWalls): there the room flows straight into the stairs, no wall.
    const open = (dir: string) => openWalls.has(`${c.x},${c.y},${dir}`);
    // Fusion "letter rooms" outline their walls in red (not their doors — those
    // keep their pip color below); every other cell draws plain white walls.
    ctx.fillStyle = specialCells.has(`${c.x},${c.y}`) ? COL.special : COL.wall;
    if (c.w & N && !open('N')) ctx.fillRect(x, y, S, 2);
    if (c.w & SO && !open('SO')) ctx.fillRect(x, y + S - 2, S, 2);
    if (c.w & W && !open('W')) ctx.fillRect(x, y, 2, S);
    if (c.w & E && !open('E')) ctx.fillRect(x + S - 2, y, 2, S);
    // doors (gba style). Fusion draws a small gap in the wall — room fill for a
    // plain hatch, lock color for a colored one — plus a jamb bar inside the
    // wall so two adjacent cells compose the game's H lock (asymmetric → half-H).
    //
    // ZM (COL.doorJambs === false) draws every colored door — the common
    // light-blue normal door and the rarer r/g/y locks alike — as one small
    // block on the border: in the source it's a 4x4 mark, 2 px of color capped
    // top and bottom by the white wall (matched against the raw pause maps).
    // Rendered as a 4-logical square flush to each cell's own border, so a
    // symmetric pip pair composes the full straddling block while a one-sided
    // door (very common on normal doors) reads as a lone block on its room.
    // Each square stays inside its own cell, so neither the neighbour's fill
    // nor draw order can clip it. Plain 'n' still shows as a bare gap.
    if (c.dr) {
      for (const p of c.dr) {
        const colored = p[1] !== 'n';
        if (!COL.doorJambs && colored) {
          const B = 4, // 2 source px of color, flush to the border
            C = 2; // white wall caps flanking it along the wall (the 4x4's top/bottom rows)
          // white caps first: the wall's white extends a bit past the lock on
          // both ends (B deep, C longer than the color on each along-wall side)
          ctx.fillStyle = COL.wall;
          if (p[0] === 'N') ctx.fillRect(x + S / 2 - B / 2 - C, y, B + 2 * C, B);
          else if (p[0] === 'S') ctx.fillRect(x + S / 2 - B / 2 - C, y + S - B, B + 2 * C, B);
          else if (p[0] === 'W') ctx.fillRect(x, y + S / 2 - B / 2 - C, B, B + 2 * C);
          else if (p[0] === 'E') ctx.fillRect(x + S - B, y + S / 2 - B / 2 - C, B, B + 2 * C);
          // then the lock color, inset between the caps
          ctx.fillStyle = COL.doors[p[1]] ?? COL.wall;
          if (p[0] === 'N') ctx.fillRect(x + S / 2 - B / 2, y, B, B);
          else if (p[0] === 'S') ctx.fillRect(x + S / 2 - B / 2, y + S - B, B, B);
          else if (p[0] === 'W') ctx.fillRect(x, y + S / 2 - B / 2, B, B);
          else if (p[0] === 'E') ctx.fillRect(x + S - B, y + S / 2 - B / 2, B, B);
          continue;
        }
        ctx.fillStyle = colored ? (COL.doors[p[1]] ?? COL.wall) : fill;
        if (p[0] === 'N') ctx.fillRect(x + S / 2 - 2, y, 4, 2);
        else if (p[0] === 'S') ctx.fillRect(x + S / 2 - 2, y + S - 2, 4, 2);
        else if (p[0] === 'W') ctx.fillRect(x, y + S / 2 - 2, 2, 4);
        else if (p[0] === 'E') ctx.fillRect(x + S - 2, y + S / 2 - 2, 2, 4);
        if (!colored || !COL.doorJambs) continue;
        if (p[0] === 'N') ctx.fillRect(x + S / 2 - 4, y + 2, 8, 2);
        else if (p[0] === 'S') ctx.fillRect(x + S / 2 - 4, y + S - 4, 8, 2);
        else if (p[0] === 'W') ctx.fillRect(x + 2, y + S / 2 - 4, 2, 8);
        else if (p[0] === 'E') ctx.fillRect(x + S - 4, y + S / 2 - 4, 2, 8);
      }
    }
  }

  function drawGlyph(ctx: CanvasRenderingContext2D, g: MapGlyph) {
    const cx = g.x * S,
      cy = g.y * S;
    if (g.t === 'boss') {
      const img = bossImageRef.current;
      if (img && bossLoaded) {
        // Pixel-art source (a few px square) — nearest-neighbor keeps it sharp.
        ctx.imageSmoothingEnabled = false;
        if (g.s) {
          // Spanning boss (2×2 arena statue): fill the s×s block, centred on (x, y).
          const size = S * g.s * 0.8;
          ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
        } else {
          const bossWidth = S * 0.7;
          const bossHeight = (img.height / img.width) * bossWidth;
          ctx.drawImage(img, cx - bossWidth / 2, cy - bossHeight / 2, bossWidth, bossHeight);
        }
        ctx.imageSmoothingEnabled = true;
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
      // item blip: small bright square, like the in-game map's item markers. On
      // a knob (a sub-cell box inset toward its connector), nudge the marker to
      // the box's true centre — away from the inset rail side — so it doesn't
      // sit on the tunnel out.
      let dotX = cx,
        dotY = cy;
      const w = knobWalls.get(`${Math.floor(g.x)},${Math.floor(g.y)}`);
      if (w !== undefined) {
        const iN = w & N ? S / 4 : 0,
          iS = w & SO ? S / 4 : 0,
          iW = w & W ? S / 4 : 0,
          iE = w & E ? S / 4 : 0;
        dotX += (iW - iE) / 2;
        dotY += (iN - iS) / 2;
      }
      const half = S * 0.1;
      ctx.fillStyle = COL.item;
      ctx.fillRect(dotX - half, dotY - half, half * 2, half * 2);
      return;
    }
    if (g.t === 'itemMajor') {
      // major upgrade: an open ring, echoing the source map's circled majors
      // (vs the plain square dot minors get).
      ctx.strokeStyle = COL.item;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    if (g.t === 'chozo') {
      // chozo statue room: the source map's big red circle.
      ctx.strokeStyle = COL.special;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    if (g.t === 'ship') {
      const img = shipImageRef.current;
      if (img && shipLoaded) {
        const shipWidth = S * 0.95;
        const shipHeight = (img.height / img.width) * shipWidth;
        // Pixel-art source (16×9 / 8×5) — nearest-neighbor keeps it sharp.
        ctx.imageSmoothingEnabled = false;
        // Nudge the ship one pixel left — reads better centered in both games.
        // Zero Mission's Crateria ship also reads better nudged two pixels down.
        const shipYNudge = data.game === 'metroid-zero-mission' && area.id === 'crateria' ? 2 : 0;
        ctx.drawImage(img, cx - shipWidth / 2 - 1, cy - shipHeight / 2 + shipYNudge, shipWidth, shipHeight);
        ctx.imageSmoothingEnabled = true;
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
    // Station letter (S/M/R/N/D). Same meaning across games; Super draws them
    // green, Fusion yellow (paired with the red room outline in drawCell).
    ctx.fillStyle = COL.letter;
    ctx.font = `bold ${S - 4}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(GLYPH_LETTERS[g.t], cx, cy + 1);
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

  /** the destination label, positioned on any of the connector's four sides.
   *  A literal `\n` (or a real newline) in the label splits it into stacked
   *  lines — the escape is how the plain-text editor input holds a break. */
  function drawConnectorLabel(ctx: CanvasRenderingContext2D, c: Connector, b: ReturnType<typeof connBounds>) {
    const midX = ((b.minX + b.maxX + 1) / 2) * S;
    const midY = ((b.minY + b.maxY + 1) / 2) * S;
    const lines = c.label!.split(/\\n|\r?\n/);
    const lineH = S - 4;
    ctx.fillStyle = COL.wall;
    ctx.font = `bold ${S - 6}px monospace`;
    const draw = (x: number, yTop: number) => lines.forEach((ln, i) => ctx.fillText(ln, x, yTop + i * lineH));
    switch (c.labelPos ?? defaultLabelPos(c)) {
      case 'above':
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        // the block grows upward, its last line hugging the connector
        draw(midX, b.minY * S - 2 - (lines.length - 1) * lineH);
        break;
      case 'below':
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        draw(midX, (b.maxY + 1) * S + 2);
        break;
      case 'left':
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        draw(b.minX * S - 2, midY - ((lines.length - 1) / 2) * lineH);
        break;
      case 'right':
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        draw((b.maxX + 1) * S + 2, midY - ((lines.length - 1) / 2) * lineH);
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
    const prefix = `${area.id}:`;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 210, 77, 0.28)'; // soft yellow tint over named cells
    for (const [key, name] of Object.entries(roomEdits)) {
      if (!name || !key.startsWith(prefix)) continue;
      const [tx, ty] = key.slice(prefix.length).split(',').map(Number);
      ctx.fillRect(tx * S, ty * S, S, S);
    }
    ctx.restore();
  }

  /** Edit-mode overlay for the Landmark tool: tint cells that already hold a
   *  baked sprite stamp, so the curator sees which arenas are placed. */
  function drawLandmarkTint(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = 'rgba(120, 200, 255, 0.30)'; // soft cyan over cells with a landmark
    for (const key of landmarkCells) {
      const [tx, ty] = key.split(',').map(Number);
      ctx.fillRect(tx * S, ty * S, S, S);
    }
    ctx.restore();
  }

  /** Edit-mode overlay for the Room state tool: tint cells that already carry
   *  a saved tile override (green, matching the panel's ✓ badge). */
  function drawRoomStateTint(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = 'rgba(57, 255, 20, 0.25)';
    for (const o of roomStateTint?.[area.id] ?? []) ctx.fillRect(o.x * S, o.y * S, S, S);
    ctx.restore();
  }

  /** showTiles overlay: paint each playable cell's actual game screen (the
   *  sliced tile PNG) into its map position, so difficulty ratings can be
   *  judged against the real imagery. Images stream in asynchronously; cells
   *  whose PNG hasn't loaded yet keep the recreation fill until it arrives.
   *  Drawn under the Diff tint (which stays translucent) and the markers. */
  function drawTiles(ctx: CanvasRenderingContext2D, vis: { x0: number; y0: number; x1: number; y1: number }) {
    ctx.save();
    ctx.globalAlpha = tileP; // step two: the real screens fade in over the stretched cells
    // Minified (cell smaller than the native screen), nearest-neighbor
    // point-samples one source pixel per block and aliases fine art into mud
    // (worst on GBA), so high-quality smoothing area-averages instead — the
    // cell reads as a clean minimap. Magnified (zoomed to/past native res),
    // smoothing would blur, so it flips off for authentic sharp pixels.
    ctx.imageSmoothingQuality = 'high';
    const cellDevW = view ? snapView(view).cw : S * SCALE * xScale; // device px per cell
    for (const c of area.cells) {
      if (c.x < vis.x0 || c.x > vis.x1 || c.y < vis.y0 || c.y > vis.y1) continue;
      const img = tileCache.current.get(tileUrl(data, { areaId: area.id, cell: c }));
      if (!img || !img.complete || img.naturalWidth === 0) continue;
      ctx.imageSmoothingEnabled = cellDevW < img.naturalWidth;
      ctx.drawImage(img, c.x * S, c.y * S, S, S);
    }
    ctx.restore();
  }

  /** Diff-tool overlay: every playable cell tinted by its rating (green →
   *  red, 6 = blacked out). Cells with no explicit rating show the default's
   *  color at lower alpha so unrated coverage is visible at a glance. */
  function drawDiffTint(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const c of area.cells) {
      const key = cellKey(area.id, c);
      const rated = key in diffEdits;
      const rating = rated ? diffEdits[key] : DEFAULT_RATING;
      if (!diffVisible.has(rating)) continue;
      if (diffIsolate) {
        if (rating !== diffRating) continue;
        // bright outline instead of a fill so room detail underneath stays visible
        ctx.strokeStyle = ISOLATE_HIGHLIGHT;
        ctx.lineWidth = 3;
        ctx.strokeRect(c.x * S + 1.5, c.y * S + 1.5, S - 3, S - 3);
        continue;
      }
      const rgb = RATING_COLORS[rating] ?? RATING_COLORS[DEFAULT_RATING];
      const alpha = rating === EXCLUDED_RATING ? 0.8 : rated ? 0.55 : 0.25;
      ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
      ctx.fillRect(c.x * S, c.y * S, S, S);
    }
    ctx.restore();
  }

  /** Returns TILE coordinates — the mirror of the view/base transform in
   *  `draw`, and the only other place the map canvas' own grid is
   *  acknowledged. Under viewport rendering the canvas rect is the viewport,
   *  so the map position comes from the view transform; the editing path's
   *  full-map canvas keeps the rect-proportion math. */
  function cellFromPoint(clientX: number, clientY: number): Cell | null {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let x: number, y: number;
    if (view) {
      const sv = snapView(view); // mirror the snapped draw transform exactly
      x = Math.floor(((clientX - rect.left) * sv.dpr - sv.tx) / sv.cw);
      y = Math.floor(((clientY - rect.top) * sv.dpr - sv.ty) / sv.ch);
    } else {
      x = Math.floor(((clientX - rect.left) / rect.width) * area.map.cols);
      y = Math.floor(((clientY - rect.top) / rect.height) * area.map.rows);
    }
    if (x < 0 || y < 0 || x >= area.map.cols || y >= area.map.rows) return null;
    return { x: x - area.map.dx, y: y - area.map.dy };
  }
  const cellFromEvent = (e: { clientX: number; clientY: number }) => cellFromPoint(e.clientX, e.clientY);

  /** place a guess at the tapped/clicked point (shared by mouse click + touch
   *  tap) */
  function selectAtPoint(clientX: number, clientY: number) {
    if (result) return;
    const c = cellFromPoint(clientX, clientY);
    if (!c || !selectable.has(`${c.x},${c.y}`)) return;
    onSelect(area.id, c);
    // Touch has no hover, so a tap doubles as the Scan Visor probe: report the
    // tapped cell so the scan panel shows its real screen (mirrors desktop hover).
    onHoverCell?.(area.id, c, roomEdits[roomKeyAt(c)]);
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
    // a lone finger that barely moved (and never became a pinch) is a tap:
    // an edit-tool action while editing, otherwise a guess.
    if (g.pointers.size === 0 && !g.multi && g.moved < TAP_SLOP) {
      if (editing) {
        const c = cellFromPoint(e.clientX, e.clientY);
        if (c) handleEditClick(c);
      } else {
        selectAtPoint(e.clientX, e.clientY);
      }
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

  /** the "areaId:x,y" key for a cell */
  function roomKeyAt(c: Cell): string {
    return cellKey(area.id, c);
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
    if (tool === 'landmark') return setLandmarkCell(c);
    if (tool === 'roomstate') return setRoomStateCell(c);
    if (tool === 'erase') return eraseAt(c);
    stampGlyph(c, tool); // tool narrows to GlyphType here
  }

  /** set the clicked cell's rating to the toolbar's selected value */
  function paintDiff(c: Cell) {
    if (!selectable.has(`${c.x},${c.y}`)) return; // ratings only apply to real cells
    setDiffEdits((prev) => ({ ...prev, [cellKey(area.id, c)]: diffRating }));
  }

  async function saveMap() {
    setSaveMsg('saving…');
    const glyphsOut: Record<string, MapGlyph[]> = {};
    for (const [id, list] of Object.entries(edits)) {
      glyphsOut[id] = list.map((g) => ({
        x: Math.round(g.x * 100) / 100,
        y: Math.round(g.y * 100) / 100,
        t: g.t,
        ...(g.s !== undefined ? { s: g.s } : {})
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
          {TOOLS.filter((t) => t.id !== 'roomstate' || mapStyle === 'gba').map((t) => (
            <button
              key={t.id}
              className={`btn tiny ${tool === t.id ? 'active' : ''}`}
              onClick={() => {
                setTool(t.id);
                setAnchor(null);
                setSelConn(null);
                setRoomAnchor(null);
                setRoomPending(null);
                setLandmarkCell(null);
                setRoomStateCell(null);
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
              {(() => {
                const b = connBounds(overlays.connectors[selConn]);
                // orientation is only ambiguous (and this override only matters)
                // for a single-cell connector
                if (b.maxX !== b.minX || b.maxY !== b.minY) return null;
                return (
                  <button
                    className="btn tiny"
                    title="Flip a single-cell connector between horizontal and vertical"
                    onClick={() => {
                      updateOverlays((o) => ({
                        connectors: o.connectors.map((c, i) => (i === selConn ? { ...c, horizontal: !connHorizontal(c) } : c))
                      }));
                    }}
                  >
                    Axis: {connHorizontal(overlays.connectors[selConn]) ? '↔' : '↕'}
                  </button>
                );
              })()}
            </>
          )}
          {tool === 'landmark' && !landmarkCell && <span className="edit-msg">click a cell to open its landmark view (X-Ray helps find the arenas)</span>}
          {tool === 'roomstate' && !roomStateCell && <span className="edit-msg">click a cell to preview its room's Randovania render (X-Ray helps)</span>}
          <button className="btn tiny save" onClick={saveMap}>
            Save to file
          </button>
          {saveMsg && <span className="edit-msg">{saveMsg}</span>}
        </div>
      )}
      {editing && tool === 'landmark' && landmarkCell && <LandmarkEditor game={data.game} areaId={area.id} cell={landmarkCell} />}
      {editing && tool === 'roomstate' && roomStateCell && (
        <RoomStateExplorer game={data.game} areaId={area.id} cell={roomStateCell} roomName={roomEdits[cellKey(area.id, roomStateCell)]} roomCells={roomStateCells} />
      )}
      <div className="map-viewport" ref={outerRef}>
        <div className={`map-scroll${panEnabled ? ' pan' : ''}${shakeClass}`} ref={scrollRef} style={fittedSize ? { width: fittedSize.w, height: fittedSize.h, boxSizing: 'content-box' } : undefined}>
          {result && <div className="map-scan-sweep" aria-hidden="true" />}
          {callout && (
            <div className={`target-callout${targetBlink ? ' alt' : ''}${callout.right ? ' right' : ''}`} style={{ left: callout.x, top: callout.y }} aria-hidden="true">
              TARGET
            </div>
          )}
          <canvas
            ref={canvasRef}
            className={`map-canvas${editing ? ' editing' : ''}${panEnabled ? ' pan' : ''}${showTiles ? ' xray' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onMouseMove={(e) => {
              if (!hoverCapable) return; // touch screens have no hover (pointer handlers drive them)
              const c = cellFromEvent(e);
              const occ = c !== null && selectable.has(`${c.x},${c.y}`);
              // Report the pointed-at cell anywhere on the map, not just over drawn
              // rooms — empty cells still have a real coordinate (the scanner shows
              // it as "no signal"). null only when the cursor leaves the map.
              onHoverCell?.(area.id, c, occ ? roomEdits[roomKeyAt(c!)] : undefined);
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
    </div>
  );
}
