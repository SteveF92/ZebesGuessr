import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AreaData, Cell, Connector, DiagBand, GameData, MapCell, MapGlyph, RoundResult,
} from "../types";
import { cellKey } from "../data";

interface Props {
  data: GameData;
  /** selection in TILE coordinates */
  selected: { areaId: string; cell: Cell } | null;
  onSelect: (areaId: string, cell: Cell) => void;
  /** reports the hovered cell in TILE coordinates (debug preview), plus its
   *  current room name (reflects live editor edits) if any */
  onHoverCell?: (areaId: string, cell: Cell | null, roomName?: string) => void;
  /** when set, the round is over: draw target/guess markers, ignore clicks */
  result: RoundResult | null;
  /** dev icon-placement mode: clicks stamp/erase landmark glyphs */
  editing?: boolean;
}

type GlyphType = MapGlyph["t"];
type Tool = GlyphType | "connector" | "roomname" | "erase";
const TOOLS: { id: Tool; label: string }[] = [
  { id: "save", label: "Save (S)" },
  { id: "map", label: "Map (M)" },
  { id: "recharge", label: "Recharge (R)" },
  { id: "ship", label: "Ship" },
  { id: "boss", label: "Boss" },
  { id: "item", label: "Item" },
  { id: "connector", label: "Connector" },
  { id: "roomname", label: "Name" },
  { id: "erase", label: "Erase" },
];

type Overlays = { connectors: Connector[] };

/** label-position cycle order for the editor toggle */
type LabelPos = NonNullable<Connector["labelPos"]>;
const LABEL_CYCLE: LabelPos[] = ["above", "right", "below", "left"];
const LABEL_ARROW: Record<LabelPos, string> = {
  above: "above ↑", below: "below ↓", left: "left ←", right: "right →",
};

/** geometry helpers: connectors are axis-aligned between two whole map cells */
function connBounds(c: Connector) {
  return {
    minX: Math.min(c.x0, c.x1), maxX: Math.max(c.x0, c.x1),
    minY: Math.min(c.y0, c.y1), maxY: Math.max(c.y0, c.y1),
  };
}
/** true when the connector runs left-right (wider than it is tall). For a
 *  single cell (neither axis dominates) the label side breaks the tie, so a
 *  1-cell connector labelled left/right renders as a horizontal stub. */
function connHorizontal(c: Connector) {
  const b = connBounds(c);
  const dx = b.maxX - b.minX, dy = b.maxY - b.minY;
  if (dx !== dy) return dx > dy;
  return c.labelPos === "left" || c.labelPos === "right";
}
function connContains(c: Connector, cell: Cell) {
  const b = connBounds(c);
  return cell.x >= b.minX && cell.x <= b.maxX && cell.y >= b.minY && cell.y <= b.maxY;
}
function defaultLabelPos(c: Connector): LabelPos {
  return connHorizontal(c) ? "right" : "below";
}
/** build a connector from two clicks, locking to the dominant axis */
function connectorFromDrag(a: Cell, c: Cell): Connector {
  if (Math.abs(c.x - a.x) >= Math.abs(c.y - a.y)) {
    return { x0: Math.min(a.x, c.x), y0: a.y, x1: Math.max(a.x, c.x), y1: a.y, label: "" };
  }
  return { x0: a.x, y0: Math.min(a.y, c.y), x1: a.x, y1: Math.max(a.y, c.y), label: "" };
}

/** css px per map cell */
const S = 16;

// SNES pause-map palette
const COL = {
  bg: "#000000",
  dot: "#40166e",
  room: "#d83890",
  wall: "#a0f8f8",
  map: "#00f858",
  ship: "#f88838",
  hover: "rgba(255,255,255,0.85)",
  selected: "#ffd24d",
  item: "#f8f8f8",
  target: "#4dff88",
  guess: "#ff5d5d",
};

const N = 1, E = 2, SO = 4, W = 8;

/**
 * The clickable guess map, rebuilt as web elements: cells from the actual
 * in-game pause map are drawn on canvas (rooms, shafts, station glyphs,
 * Samus' ship) — no environment art, knowledge only.
 */
export default function GuessMap({ data, selected, onSelect, onHoverCell, result, editing }: Props) {
  const [areaId, setAreaId] = useState(data.areas[0].id);
  const area = data.areas.find((a) => a.id === areaId)!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shipImageRef = useRef<HTMLImageElement | null>(null);
  const bossImageRef = useRef<HTMLImageElement | null>(null);
  const [shipLoaded, setShipLoaded] = useState(false);
  const [bossLoaded, setBossLoaded] = useState(false);
  const [hover, setHover] = useState<Cell | null>(null);

  // editable copy of every area's glyphs; edits win over the loaded data
  const [edits, setEdits] = useState<Record<string, MapGlyph[]>>(() => {
    const m: Record<string, MapGlyph[]> = {};
    for (const a of data.areas) m[a.id] = a.map.glyphs.map((g) => ({ ...g }));
    return m;
  });
  const [tool, setTool] = useState<Tool>("save");
  const [saveMsg, setSaveMsg] = useState("");
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
  const [roomEdits, setRoomEdits] = useState<Record<string, string>>(
    () => ({ ...(data.roomNames ?? {}) })
  );
  const [roomInput, setRoomInput] = useState("");
  const [roomAnchor, setRoomAnchor] = useState<Cell | null>(null);

  const occupied = useMemo(() => {
    const m = new Map<string, MapCell>();
    for (const c of area.map.cells) m.set(`${c.x},${c.y}`, c);
    return m;
  }, [area]);

  // Jump to the target's area when a round ends.
  useEffect(() => {
    if (result) setAreaId(result.target.areaId);
  }, [result]);

  // Reveal "lock-on": a shrinking ring pulse around the target, 0 → 1 over 650ms.
  const [revealPulse, setRevealPulse] = useState(0);
  useEffect(() => {
    if (!result) { setRevealPulse(0); return; }
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

  useEffect(draw); // repaint on every state change; canvas is small

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cols, rows, dx, dy } = area.map;
    const w = cols * S, h = rows * S;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d")!;

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
    if (editing) drawRoomTint(ctx);

    const box = (tile: Cell, color: string, lw: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect((tile.x + dx) * S + 1, (tile.y + dy) * S + 1, S - 2, S - 2);
    };

    if (!result) {
      if (hover) box({ x: hover.x - dx, y: hover.y - dy }, COL.hover, 1.5);
      if (selected && selected.areaId === area.id) box(selected.cell, COL.selected, 2.5);
    } else {
      if (result.guess.areaId === area.id) box(result.guess.cell, COL.guess, 2.5);
      if (result.target.areaId === area.id) box(result.target.cell, COL.target, 2.5);
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
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
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
    // short axis-aligned edges are artifacts of clipping the fitted band to
    // its pixel bounding box (mitring the ends flush into the corridors it
    // joins) — stroking those draws phantom cyan notches at the joints.
    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    const n = b.poly.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = b.poly[i];
      const [x1, y1] = b.poly[(i + 1) % n];
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const axisAligned = dx < 0.02 || dy < 0.02;
      if (axisAligned) continue;
      ctx.beginPath();
      ctx.moveTo(x0 * S, y0 * S);
      ctx.lineTo(x1 * S, y1 * S);
      ctx.stroke();
    }
  }

  function drawCell(ctx: CanvasRenderingContext2D, c: MapCell) {
    const x = c.x * S, y = c.y * S;
    if (c.k === "diag") return; // covered by its band
    if (c.k === "vshaft") {
      ctx.fillStyle = COL.room;
      ctx.fillRect(x + S / 2 - 2, y, 4, S);
      return;
    }
    if (c.k === "hshaft") {
      ctx.fillStyle = COL.room;
      ctx.fillRect(x, y + S / 2 - 2, S, 4);
      return;
    }
    ctx.fillStyle = COL.room;
    ctx.fillRect(x, y, S, S);
    // cyan walls
    ctx.fillStyle = COL.wall;
    if (c.w & N) ctx.fillRect(x, y, S, 2);
    if (c.w & SO) ctx.fillRect(x, y + S - 2, S, 2);
    if (c.w & W) ctx.fillRect(x, y, 2, S);
    if (c.w & E) ctx.fillRect(x + S - 2, y, 2, S);
  }

  function drawGlyph(ctx: CanvasRenderingContext2D, g: MapGlyph) {
    const cx = g.x * S, cy = g.y * S;
    if (g.t === "boss") {
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
        ctx.fillStyle = "#a01008";
        ctx.beginPath();
        ctx.arc(cx, cy, S * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (g.t === "item") {
      // item blip: small bright dot, like the in-game map's item markers
      ctx.fillStyle = COL.item;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.16, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (g.t === "ship") {
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
    const letters: Record<"save" | "map" | "recharge", string> = { save: "S", map: "M", recharge: "R" };
    const colors: Record<"save" | "map" | "recharge", string> = { save: COL.map, map: COL.map, recharge: COL.map };
    const t = g.t as "save" | "map" | "recharge";
    ctx.fillStyle = colors[t];
    ctx.font = `bold ${S - 4}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
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
      const left = b.minX * S, right = (b.maxX + 1) * S;
      ctx.fillRect(left, cy - 4, right - left, 2);
      ctx.fillRect(left, cy + 2, right - left, 2);
      ctx.beginPath();
      ctx.moveTo(left, cy);
      ctx.lineTo(right, cy);
      ctx.stroke();
    } else {
      const cx = b.minX * S + S / 2;
      const top = b.minY * S, bot = (b.maxY + 1) * S;
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
  function drawConnectorLabel(
    ctx: CanvasRenderingContext2D, c: Connector, b: ReturnType<typeof connBounds>
  ) {
    const midX = ((b.minX + b.maxX + 1) / 2) * S;
    const midY = ((b.minY + b.maxY + 1) / 2) * S;
    ctx.fillStyle = COL.wall;
    ctx.font = `bold ${S - 6}px monospace`;
    switch (c.labelPos ?? defaultLabelPos(c)) {
      case "above":
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(c.label!, midX, b.minY * S - 2); break;
      case "below":
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(c.label!, midX, (b.maxY + 1) * S + 2); break;
      case "left":
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(c.label!, b.minX * S - 2, midY); break;
      case "right":
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(c.label!, (b.maxX + 1) * S + 2, midY); break;
    }
  }

  /** editor-only overlays: selected-connector highlight + placement preview */
  function drawOverlayEditing(ctx: CanvasRenderingContext2D) {
    if (tool === "connector" && selConn !== null) {
      const c = overlays.connectors[selConn];
      if (c) {
        const b = connBounds(c);
        ctx.strokeStyle = COL.selected;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          b.minX * S + 0.5, b.minY * S + 0.5,
          (b.maxX - b.minX + 1) * S - 1, (b.maxY - b.minY + 1) * S - 1
        );
      }
    }
    if (tool === "connector" && anchor && hover) {
      drawConnector(ctx, connectorFromDrag(anchor, hover), true);
    }
    // Name tool: rubber-band the fill rectangle from the anchor to the hover.
    if (tool === "roomname" && roomAnchor && hover) {
      const minX = Math.min(roomAnchor.x, hover.x), maxX = Math.max(roomAnchor.x, hover.x);
      const minY = Math.min(roomAnchor.y, hover.y), maxY = Math.max(roomAnchor.y, hover.y);
      ctx.strokeStyle = COL.selected;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        minX * S + 0.5, minY * S + 0.5,
        (maxX - minX + 1) * S - 1, (maxY - minY + 1) * S - 1
      );
    }
  }

  /** Edit-mode overlay: tint named cells so the curator can see coverage at a
   *  glance. The actual name is read off the debug panel on hover (labels drawn
   *  on the small map are too cramped to read). Not drawn during play. */
  function drawRoomTint(ctx: CanvasRenderingContext2D) {
    const { dx, dy } = area.map;
    const prefix = `${area.id}:`;
    ctx.save();
    ctx.fillStyle = "rgba(255, 210, 77, 0.28)"; // soft yellow tint over named cells
    for (const [key, name] of Object.entries(roomEdits)) {
      if (!name || !key.startsWith(prefix)) continue;
      const [tx, ty] = key.slice(prefix.length).split(",").map(Number);
      ctx.fillRect((tx + dx) * S, (ty + dy) * S, S, S);
    }
    ctx.restore();
  }

  /** returns MAP coordinates */
  function cellFromEvent(e: React.MouseEvent): Cell | null {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * area.map.cols);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * area.map.rows);
    if (x < 0 || y < 0 || x >= area.map.cols || y >= area.map.rows) return null;
    return { x, y };
  }

  function updateOverlays(fn: (o: Overlays) => Overlays) {
    setOverlayEdits((prev) => ({
      ...prev,
      [area.id]: fn(prev[area.id] ?? { connectors: [] }),
    }));
  }

  /** stamp a landmark glyph at map cell c (centred in the cell) */
  function stampGlyph(c: Cell, t: GlyphType) {
    setEdits((prev) => {
      const list = (prev[area.id] ?? []).filter(
        (g) => Math.floor(g.x) !== c.x || Math.floor(g.y) !== c.y
      );
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
      [area.id]: (prev[area.id] ?? []).filter(
        (g) => Math.floor(g.x) !== c.x || Math.floor(g.y) !== c.y
      ),
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

  /** two-click room name: first click anchors (and loads an existing name into
   *  the input when the field is empty); second click paints the input's text
   *  across every playable cell in the rectangle. Empty input clears them. */
  function placeRoom(c: Cell) {
    if (roomAnchor === null) {
      if (roomInput === "") {
        const existing = roomEdits[roomKeyAt(c)];
        if (existing) setRoomInput(existing);
      }
      setRoomAnchor(c);
      return;
    }
    const name = roomInput.trim();
    const minX = Math.min(roomAnchor.x, c.x), maxX = Math.max(roomAnchor.x, c.x);
    const minY = Math.min(roomAnchor.y, c.y), maxY = Math.max(roomAnchor.y, c.y);
    setRoomEdits((prev) => {
      const next = { ...prev };
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (!occupied.has(`${x},${y}`)) continue;
          const key = roomKeyAt({ x, y });
          if (name) next[key] = name;
          else delete next[key];
        }
      }
      return next;
    });
    setRoomAnchor(null);
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
    setSaveMsg("");
    if (tool === "connector") return placeConnector(c);
    if (tool === "roomname") return placeRoom(c);
    if (tool === "erase") return eraseAt(c);
    stampGlyph(c, tool); // tool narrows to GlyphType here
  }

  async function saveMap() {
    setSaveMsg("saving…");
    const glyphsOut: Record<string, MapGlyph[]> = {};
    for (const [id, list] of Object.entries(edits)) {
      glyphsOut[id] = list.map((g) => ({
        x: Math.round(g.x * 100) / 100, y: Math.round(g.y * 100) / 100, t: g.t,
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
    try {
      const res = await fetch("/__save-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game: data.game, glyphs: glyphsOut, overlays: overlaysOut, roomNames: roomNamesOut,
        }),
      });
      setSaveMsg(res.ok ? "saved ✓ (commit glyphs/overlays/roomNames.*.json)" : `error: ${await res.text()}`);
    } catch (e) {
      setSaveMsg(`error: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="guess-map">
      <div className="area-tabs">
        {data.areas.map((a: AreaData) => (
          <button
            key={a.id}
            className={`tab ${a.id === areaId ? "active" : ""}`}
            onClick={() => setAreaId(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>
      {editing && (
        <div className="icon-editor">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`btn tiny ${tool === t.id ? "active" : ""}`}
              onClick={() => { setTool(t.id); setAnchor(null); setSelConn(null); setRoomAnchor(null); }}
            >
              {t.label}
            </button>
          ))}
          {tool === "roomname" && (
            <>
              <input
                className="edit-name"
                placeholder="room name"
                value={roomInput}
                onChange={(ev) => setRoomInput(ev.target.value)}
              />
              <span className="edit-msg">
                {roomAnchor
                  ? "click opposite corner to fill"
                  : roomInput
                    ? "click a room’s corner"
                    : "type a name, or click a room to load it"}
              </span>
            </>
          )}
          {tool === "connector" && selConn !== null && overlays.connectors[selConn] && (
            <>
              <input
                className="edit-name"
                placeholder="destination area"
                value={overlays.connectors[selConn].label ?? ""}
                onChange={(ev) => {
                  const label = ev.target.value;
                  updateOverlays((o) => ({
                    connectors: o.connectors.map((c, i) => (i === selConn ? { ...c, label } : c)),
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
                    }),
                  }));
                }}
              >
                Label: {LABEL_ARROW[overlays.connectors[selConn].labelPos ?? defaultLabelPos(overlays.connectors[selConn])]}
              </button>
            </>
          )}
          <button className="btn tiny save" onClick={saveMap}>Save to file</button>
          {saveMsg && <span className="edit-msg">{saveMsg}</span>}
        </div>
      )}
      <div className="map-scroll">
        <canvas
          ref={canvasRef}
          className={`map-canvas${editing ? " editing" : ""}`}
          onMouseMove={(e) => {
            const c = cellFromEvent(e);
            const occ = c !== null && occupied.has(`${c.x},${c.y}`);
            onHoverCell?.(
              area.id,
              occ ? { x: c!.x - area.map.dx, y: c!.y - area.map.dy } : null,
              occ ? roomEdits[roomKeyAt(c!)] : undefined
            );
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
            const c = cellFromEvent(e);
            if (!c) return;
            if (editing) {
              handleEditClick(c);
              return;
            }
            if (result) return;
            if (!occupied.has(`${c.x},${c.y}`)) return;
            // convert map -> tile coordinates for scoring
            onSelect(area.id, { x: c.x - area.map.dx, y: c.y - area.map.dy });
          }}
        />
      </div>
    </div>
  );
}
