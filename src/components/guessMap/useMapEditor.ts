import { useEffect, useMemo, useRef, useState } from 'react';
import type { AreaData, Cell, GameData, MapGlyph } from '../../types';
import { cellKey } from '../../data';
import { DEFAULT_RATING, EXCLUDED_RATING } from '../../scoring';
import { ISOLATE_HIGHLIGHT, RATING_COLORS, S, type GlyphType, type MapPalette } from './constants';
import { connBounds, connContains, connectorFromDrag, type Overlays } from './connectors';
import { computeSpecialCells, drawConnector } from './drawMap';

export type Tool = GlyphType | 'connector' | 'roomname' | 'difficulty' | 'landmark' | 'roomstate' | 'erase';

/** Subset of the dev /__landmarks/<game> payload the Landmark tint needs to map
 *  each raw-pixel sprite stamp back onto its map cell (mirrors LandmarkEditor). */
interface LandmarkTintData {
  manifest: Record<string, { sprite: string; x: number; y: number }[]>;
  areas: Record<string, { offsetX: number; offsetY: number; cellCropOffsets: Record<string, [number, number]> }>;
  cellWidth: number;
  cellHeight: number;
}

export interface MapEditorOptions {
  data: GameData;
  /** the area currently displayed on the map */
  area: AreaData;
  mapStyle: string;
  /** dev icon-placement mode — gates the tint fetches and click handling */
  editing?: boolean;
  /** every cell of the area, keyed "x,y" (GuessMap's hit-test set) */
  selectable: Set<string>;
  COL: MapPalette;
}

export type MapEditor = ReturnType<typeof useMapEditor>;

/**
 * The dev editor's state and actions: editable copies of every overlay the
 * in-app editor curates (glyphs, connectors, room names, difficulty ratings),
 * the tool selection, the edit-mode tint overlays, and the /__save-map POST.
 *
 * The editable copies (`glyphs`/`overlays`/`roomEdits`) feed play-mode drawing
 * too — the map always renders from them, and hover reports live room names —
 * so this hook runs unconditionally; only the toolbar and click handling are
 * gated on `editing`.
 */
export function useMapEditor({ data, area, mapStyle, editing, selectable, COL }: MapEditorOptions) {
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
  // (GBA-style games only — see computeSpecialCells and drawCell's wall color).
  const specialCells = useMemo(() => computeSpecialCells(glyphs, mapStyle), [glyphs, mapStyle]);

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

  // auto-focus the name box the instant a rectangle is staged
  useEffect(() => {
    if (roomPending) roomInputRef.current?.focus();
  }, [roomPending]);

  /** pick a tool, resetting every tool's in-flight click state */
  function selectTool(t: Tool) {
    setTool(t);
    setAnchor(null);
    setSelConn(null);
    setRoomAnchor(null);
    setRoomPending(null);
    setLandmarkCell(null);
    setRoomStateCell(null);
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

  /** editor-only overlays: selected-connector highlight + placement preview.
   *  Drawn under the glyphs, unlike the tool tints (drawEditorTints). */
  function drawEditingOverlays(ctx: CanvasRenderingContext2D, hover: Cell | null) {
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
      drawConnector(ctx, connectorFromDrag(anchor, hover), COL, true);
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

  /** the active tool's tint overlay, drawn over the tiles (unlike
   *  drawEditingOverlays, which sits under the glyphs) */
  function drawEditorTints(ctx: CanvasRenderingContext2D) {
    if (tool === 'difficulty') drawDiffTint(ctx);
    else if (tool === 'roomname') drawRoomTint(ctx);
    else if (tool === 'landmark') drawLandmarkTint(ctx);
    else if (tool === 'roomstate') drawRoomStateTint(ctx);
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

  return {
    // what play-mode drawing/hover reads (the map always renders live edits)
    glyphs,
    specialCells,
    overlays,
    roomEdits,
    roomKeyAt,
    // click handling + edit-mode drawing
    tool,
    handleEditClick,
    drawEditingOverlays,
    drawEditorTints,
    // panel state the toolbar and the side panels share
    landmarkCell,
    roomStateCell,
    roomStateCells,
    // toolbar plumbing
    selectTool,
    saveMap,
    saveMsg,
    roomInput,
    setRoomInput,
    roomInputRef,
    roomAnchor,
    roomPending,
    setRoomPending,
    commitRoomPending,
    diffEdits,
    diffRating,
    setDiffRating,
    diffIsolate,
    setDiffIsolate,
    diffVisible,
    setDiffVisible,
    selConn,
    updateOverlays
  };
}
