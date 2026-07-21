import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { AreaData, Cell, GameData, RoundResult } from '../types';
import { drawnCells, tileUrl } from '../data';
import { bossAsset, chozoAsset, GAME_COL, GBA_COL, RING2_DELAY, RING_MS, S, SCALE, shipAsset, SNES_COL, SWEEP_MS, TRACE_MS } from './guessMap/constants';
import { computeKnobWalls, computeOpenWalls, drawBand, drawCell, drawConnector, drawGlyph, type GlyphDrawContext } from './guessMap/drawMap';
import { brackets, dotTrail, ring, targetIndicator, trailDot } from './guessMap/drawMarkers';
import { useMapViewport } from './guessMap/useMapViewport';
import { useRevealTimeline } from './guessMap/useRevealTimeline';
import { useMapEditor } from './guessMap/useMapEditor';
import EditorToolbar from './guessMap/EditorToolbar';

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

  // The physical L/R keys (Q/E as WASD-friendly aliases) work the shoulder
  // buttons too; `pressed` mirrors the keypress onto the on-screen button.
  // Off while editing — the editor has its own text fields and arrow-key nudges.
  const [pressedShoulder, setPressedShoulder] = useState<'l' | 'r' | null>(null);
  useEffect(() => {
    if (editing) return;
    const dirFor = (key: string) => (key === 'l' || key === 'q' ? -1 : key === 'r' || key === 'e' ? 1 : 0);
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const dir = dirFor(e.key.toLowerCase());
      if (!dir) return;
      cycleArea(dir);
      setPressedShoulder(dir < 0 ? 'l' : 'r');
    };
    const onUp = (e: KeyboardEvent) => {
      if (dirFor(e.key.toLowerCase())) setPressedShoulder(null);
    };
    const onBlur = () => setPressedShoulder(null);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }); // no deps: cycleArea closes over areaId (same pattern as App's Enter handler)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shipImageRef = useRef<HTMLImageElement | null>(null);
  const bossImageRef = useRef<HTMLImageElement | null>(null);
  const chozoImageRef = useRef<HTMLImageElement | null>(null);
  const [shipLoaded, setShipLoaded] = useState(false);
  const [bossLoaded, setBossLoaded] = useState(false);
  const [chozoLoaded, setChozoLoaded] = useState(false);
  const [hover, setHover] = useState<Cell | null>(null);

  // canvas' natural CSS size (backing store is 1:1 with CSS px): cols*S*SCALE.
  // xScale widens it while X-Ray is engaged so the pan fit math tracks the map.
  const W0 = area.map.cols * S * SCALE * xScale;
  const H0 = area.map.rows * S * SCALE;

  // The pan/zoom viewport (see useMapViewport). A tap that never became a
  // pan/pinch is an edit-tool action while editing, otherwise a guess.
  const { view, setView, viewRef, clampView, snapView, scrollRef, outerRef, fittedSize, fitView, zoomAround, onPointerDown, onPointerMove, onPointerUp, panEnabled, hoverCapable } = useMapViewport({
    W0,
    H0,
    xScale,
    areaId: area.id,
    showTiles,
    canvasRef,
    onTap: (x, y) => {
      if (editing) {
        const c = cellFromPoint(x, y);
        if (c) handleEditClick(c);
      } else {
        selectAtPoint(x, y);
      }
    }
  });

  // Actual-game-screen overlay (showTiles): cache of the per-cell tile PNGs,
  // keyed by URL. Bumping tileVersion as they stream in triggers a repaint.
  const tileCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, setTileVersion] = useState(0);

  /** every cell of the area — what the editor's tools may act on (tile coords) */
  const cellSet = useMemo(() => new Set(area.cells.map((c) => `${c.x},${c.y}`)), [area]);
  // The dev editor's state + actions (see useMapEditor). The editable copies
  // it holds (glyphs/overlays/roomEdits) feed play-mode drawing too, so the
  // hook always runs; only the toolbar and click handling gate on `editing`.
  const editor = useMapEditor({ data, area, mapStyle, editing, cellSet, COL });
  const { glyphs, specialCells, overlays, effectiveCells, roomEdits, roomKeyAt, handleEditClick, drawEditingOverlays, drawEditorTints } = editor;

  /** the area with the editor's live cell-draw deltas applied — identical to
   *  `area` until the Cell tool stages an edit (effectiveCells' fast path) */
  const effArea = useMemo(() => (effectiveCells === area.cells ? area : { ...area, cells: effectiveCells }), [area, effectiveCells]);

  /** the subset a guess may land on: cells the map draws (see `drawnCells`).
   *  A cell it draws nothing at is a real screen — X-Ray paints it — but a
   *  click there could only ever be a mis-click, and `pickTargets` won't serve
   *  one either, so nothing findable is lost. Built from the editor's live
   *  connector list and cell-draw deltas, the same ones `draw` paints from, so
   *  a connector or room drawn mid-session makes its cells clickable
   *  immediately (and a cleared room stops being clickable). */
  const guessable = useMemo(() => drawnCells(effArea, overlays.connectors), [effArea, overlays.connectors]);

  /** knob cells keyed "x,y" -> wall bits (see computeKnobWalls) */
  const knobWalls = useMemo(() => computeKnobWalls(effectiveCells), [effectiveCells]);

  // Room walls a diagonal passage opens through, keyed `x,y,dir` — see
  // computeOpenWalls for the band cap-edge walk and why only caps open walls.
  const openWalls = useMemo(() => computeOpenWalls(area.map.bands), [area]);

  // Reveal animation state, all staged off one revealT clock: the area jump,
  // the shake, the TARGET blink, the guess-placement pop, and the camera
  // panning that follows the dot trail (see useRevealTimeline).
  const { revealT, sameAreaMiss, traceStartMs, lockMs, shakeClass, targetBlink, selectPulse } = useRevealTimeline({
    result,
    area,
    setAreaId,
    selected,
    xScale,
    panEnabled,
    scrollRef,
    viewRef,
    setView,
    clampView
  });

  // Load the ship and boss sprites. Both can vary by area (Zero Mission's two
  // ships and its per-arena boss statues), so each is resolved from game + area
  // and reloaded when the player moves between areas. The chozo statue is
  // game-wide, and absent for games that don't chart statue rooms.
  useEffect(() => {
    setShipLoaded(false);
    setBossLoaded(false);
    setChozoLoaded(false);

    const img = new Image();
    img.onload = () => setShipLoaded(true);
    img.src = `${import.meta.env.BASE_URL}assets/${shipAsset(data.game, area.id)}.png`;
    shipImageRef.current = img;

    const bossImg = new Image();
    bossImg.onload = () => setBossLoaded(true);
    bossImg.src = `${import.meta.env.BASE_URL}assets/${bossAsset(data.game, area.id)}.png`;
    bossImageRef.current = bossImg;

    const chozoName = chozoAsset(data.game);
    if (chozoName) {
      const chozoImg = new Image();
      chozoImg.onload = () => setChozoLoaded(true);
      chozoImg.src = `${import.meta.env.BASE_URL}assets/${chozoName}.png`;
      chozoImageRef.current = chozoImg;
    } else {
      chozoImageRef.current = null;
    }
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
    for (const b of area.map.bands ?? []) drawBand(ctx, b, COL);
    for (const c of effectiveCells) {
      if (c.x < vis.x0 || c.x > vis.x1 || c.y < vis.y0 || c.y > vis.y1) continue;
      drawCell(ctx, c, COL, { openWalls, specialCells });
    }
    for (const c of overlays.connectors) drawConnector(ctx, c, COL, false);
    if (editing) drawEditingOverlays(ctx, hover);
    // Zero Mission's Crateria ship reads better nudged two pixels down.
    const glyphCtx: GlyphDrawContext = {
      bossImage: bossLoaded ? bossImageRef.current : null,
      shipImage: shipLoaded ? shipImageRef.current : null,
      chozoImage: chozoLoaded ? chozoImageRef.current : null,
      knobWalls,
      shipYNudge: data.game === 'metroid-zero-mission' && area.id === 'crateria' ? 2 : 0
    };
    for (const g of glyphs) drawGlyph(ctx, g, COL, glyphCtx);
    if (tileP > 0) drawTiles(ctx, vis);
    if (editing) drawEditorTints(ctx);

    if (!result) {
      if (hover) brackets(ctx, hover, COL.hover, 1.5, null);
      if (selected && selected.areaId === area.id) {
        brackets(ctx, selected.cell, COL.scan, 2.5, COL.scanOutline);
        ring(ctx, selected.cell, selectPulse, COL.scan);
      }
    } else {
      // Reveal, staged on the revealT clock. The guess marker stays put from
      // the moment of submit — continuity with the selection brackets the
      // player just placed — while everything else (trail, shake, TARGET)
      // waits out the scan sweep (see timeline constants).
      if (result.guess.areaId === area.id) brackets(ctx, result.guess.cell, COL.scan, 3, COL.scanOutline);
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
            trailDot(ctx, COL, gx, gy, 2.5);
            const p = Math.max(0, Math.min(1, (revealT - traceStartMs) / TRACE_MS));
            const e = 1 - Math.pow(1 - p, 3);
            if (p > 0) dotTrail(ctx, COL, gx, gy, tcx, tcy, e);
          }
        }
        if (result.target.areaId === area.id && lockT >= 0) {
          ring(ctx, result.target.cell, lockT / RING_MS, COL.target);
          // Exact guess: a second pulse for the direct hit.
          if (result.distance === 0) ring(ctx, result.target.cell, (lockT - RING2_DELAY) / RING_MS, COL.target);
          targetIndicator(ctx, COL, result.target.cell, targetBlink);
        }
      }
    }
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
    if (!c || !guessable.has(`${c.x},${c.y}`)) return;
    onSelect(area.id, c);
    // Touch has no hover, so a tap doubles as the Scan Visor probe: report the
    // tapped cell so the scan panel shows its real screen (mirrors desktop hover).
    onHoverCell?.(area.id, c, roomEdits[roomKeyAt(c)]);
  }

  // GBA games restyle the tab bar + shoulders (see `.tab.gba`/`.shoulder.gba`);
  // the vars carry each game's own palette so Fusion and ZM keep their colors.
  const gba = mapStyle === 'gba' ? ' gba' : '';
  const mapVars = { '--map-accent': COL.room, '--map-lattice': COL.bg } as CSSProperties;

  return (
    <div className="guess-map" style={mapVars}>
      <div className="area-tabs">
        <button className={`shoulder l${gba}${pressedShoulder === 'l' ? ' pressed' : ''}`} title="Previous area (L/Q)" onClick={() => cycleArea(-1)}>
          L
        </button>
        {data.areas.map((a: AreaData) => (
          <button key={a.id} className={`tab${gba} ${a.id === areaId ? 'active' : ''}`} onClick={() => setAreaId(a.id)}>
            {a.name}
          </button>
        ))}
        <button className={`shoulder r${gba}${pressedShoulder === 'r' ? ' pressed' : ''}`} title="Next area (R/E)" onClick={() => cycleArea(1)}>
          R
        </button>
      </div>
      {editing && <EditorToolbar editor={editor} game={data.game} areaId={area.id} mapStyle={mapStyle} hover={hover} cellSet={cellSet} />}
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
              const occ = c !== null && cellSet.has(`${c.x},${c.y}`);
              // Report the pointed-at cell anywhere on the map, not just over drawn
              // rooms — empty cells still have a real coordinate (the scanner shows
              // it as "no signal"). null only when the cursor leaves the map. The
              // scan preview covers every real cell, charted or not: an uncharted
              // one has a screen to show even though it can't be guessed.
              onHoverCell?.(area.id, c, occ ? roomEdits[roomKeyAt(c!)] : undefined);
              if (editing) {
                setHover(c);
                return;
              }
              if (result) return;
              // The hover highlight must promise exactly what a click delivers.
              setHover(c !== null && guessable.has(`${c.x},${c.y}`) ? c : null);
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
