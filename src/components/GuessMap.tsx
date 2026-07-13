import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AreaData, Cell, DiagBand, DottedLine, Elevator, GameData, MapCell, MapGlyph, RoundResult,
} from "../types";

interface Props {
  data: GameData;
  /** selection in TILE coordinates */
  selected: { areaId: string; cell: Cell } | null;
  onSelect: (areaId: string, cell: Cell) => void;
  /** reports the hovered cell in TILE coordinates (debug preview) */
  onHoverCell?: (areaId: string, cell: Cell | null) => void;
  /** when set, the round is over: draw target/guess markers, ignore clicks */
  result: RoundResult | null;
  /** dev icon-placement mode: clicks stamp/erase landmark glyphs */
  editing?: boolean;
}

type GlyphType = MapGlyph["t"];
type Tool = GlyphType | "elevator" | "line" | "erase";
const TOOLS: { id: Tool; label: string }[] = [
  { id: "save", label: "Save (S)" },
  { id: "map", label: "Map (M)" },
  { id: "ship", label: "Ship" },
  { id: "boss", label: "Boss" },
  { id: "item", label: "Item" },
  { id: "elevator", label: "Elevator" },
  { id: "line", label: "Dotted line" },
  { id: "erase", label: "Erase" },
];

type Overlays = { elevators: Elevator[]; lines: DottedLine[] };

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

  // editable copy of every area's elevators + dashed lines (like `edits`)
  const [overlayEdits, setOverlayEdits] = useState<Record<string, Overlays>>(() => {
    const m: Record<string, Overlays> = {};
    for (const a of data.areas) {
      m[a.id] = {
        elevators: a.map.elevators.map((e) => ({ ...e })),
        lines: a.map.lines.map((l) => ({ ...l })),
      };
    }
    return m;
  });
  // two-click placement anchor (map coords) and the selected elevator (for naming)
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [selEl, setSelEl] = useState<number | null>(null);
  const overlays = overlayEdits[area.id] ?? { elevators: area.map.elevators, lines: area.map.lines };

  const occupied = useMemo(() => {
    const m = new Map<string, MapCell>();
    for (const c of area.map.cells) m.set(`${c.x},${c.y}`, c);
    return m;
  }, [area]);

  // Jump to the target's area when a round ends.
  useEffect(() => {
    if (result) setAreaId(result.target.areaId);
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
    for (const e of overlays.elevators) drawElevator(ctx, e, false);
    for (const l of overlays.lines) drawDottedLine(ctx, l, false);
    if (editing) drawOverlayEditing(ctx);
    for (const g of glyphs) drawGlyph(ctx, g);

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
    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
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
    ctx.fillStyle = g.t === "save" ? COL.wall : COL.map;
    ctx.font = `bold ${S - 4}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(g.t === "save" ? "S" : "M", cx, cy + 1);
  }

  /** A vertical elevator shaft: twin cyan rails with a dashed pink core, plus
   *  the destination-area label beside it. Spans whole cells y0..y1. */
  function drawElevator(ctx: CanvasRenderingContext2D, e: Elevator, preview: boolean) {
    const cx = e.x * S + S / 2;
    const top = e.y0 * S, bot = (e.y1 + 1) * S;
    ctx.save();
    if (preview) ctx.globalAlpha = 0.5;
    ctx.fillStyle = COL.wall; // twin rails, 4px apart
    ctx.fillRect(cx - 4, top, 2, bot - top);
    ctx.fillRect(cx + 2, top, 2, bot - top);
    ctx.strokeStyle = COL.room; // dashed core
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bot);
    ctx.stroke();
    ctx.setLineDash([]);
    if (e.label) {
      ctx.fillStyle = COL.wall;
      ctx.font = `bold ${S - 6}px monospace`;
      ctx.textAlign = "center";
      if ((e.labelPos ?? "below") === "above") {
        ctx.textBaseline = "bottom";
        ctx.fillText(e.label, cx, top - 2);
      } else {
        ctx.textBaseline = "top";
        ctx.fillText(e.label, cx, bot + 2);
      }
    }
    ctx.restore();
  }

  /** A horizontal dashed transit line across row y, x0..x1. */
  function drawDottedLine(ctx: CanvasRenderingContext2D, l: DottedLine, preview: boolean) {
    const y = l.y * S + S / 2;
    ctx.save();
    if (preview) ctx.globalAlpha = 0.5;
    ctx.strokeStyle = COL.room;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(l.x0 * S, y);
    ctx.lineTo((l.x1 + 1) * S, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** editor-only overlays: selected-shaft highlight + placement preview */
  function drawOverlayEditing(ctx: CanvasRenderingContext2D) {
    if (tool === "elevator" && selEl !== null) {
      const e = overlays.elevators[selEl];
      if (e) {
        ctx.strokeStyle = COL.selected;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(e.x * S + 0.5, e.y0 * S + 0.5, S - 1, (e.y1 - e.y0 + 1) * S - 1);
      }
    }
    if (anchor && hover) {
      if (tool === "elevator") {
        drawElevator(
          ctx,
          { x: anchor.x, y0: Math.min(anchor.y, hover.y), y1: Math.max(anchor.y, hover.y) },
          true
        );
      } else if (tool === "line") {
        drawDottedLine(
          ctx,
          { y: anchor.y, x0: Math.min(anchor.x, hover.x), x1: Math.max(anchor.x, hover.x) },
          true
        );
      }
    }
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
      [area.id]: fn(prev[area.id] ?? { elevators: [], lines: [] }),
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

  /** erase whatever overlay sits at map cell c (glyph, elevator span, or line) */
  function eraseAt(c: Cell) {
    setEdits((prev) => ({
      ...prev,
      [area.id]: (prev[area.id] ?? []).filter(
        (g) => Math.floor(g.x) !== c.x || Math.floor(g.y) !== c.y
      ),
    }));
    updateOverlays((o) => ({
      elevators: o.elevators.filter((e) => !(e.x === c.x && c.y >= e.y0 && c.y <= e.y1)),
      lines: o.lines.filter((l) => !(l.y === c.y && c.x >= l.x0 && c.x <= l.x1)),
    }));
    setSelEl(null);
  }

  /** two-click vertical shaft: click empty to anchor/commit, click a shaft to select */
  function placeShaft(c: Cell) {
    if (anchor === null) {
      const idx = overlays.elevators.findIndex(
        (e) => e.x === c.x && c.y >= e.y0 && c.y <= e.y1
      );
      if (idx >= 0) return setSelEl(idx); // select existing shaft to rename it
      setSelEl(null);
      setAnchor(c);
      return;
    }
    const y0 = Math.min(anchor.y, c.y), y1 = Math.max(anchor.y, c.y);
    updateOverlays((o) => ({ ...o, elevators: [...o.elevators, { x: anchor.x, y0, y1, label: "" }] }));
    setSelEl(overlays.elevators.length); // index of the shaft just added
    setAnchor(null);
  }

  /** two-click horizontal dashed line locked to the anchor's row */
  function placeLine(c: Cell) {
    if (anchor === null) return setAnchor(c);
    const x0 = Math.min(anchor.x, c.x), x1 = Math.max(anchor.x, c.x);
    updateOverlays((o) => ({ ...o, lines: [...o.lines, { y: anchor.y, x0, x1 }] }));
    setAnchor(null);
  }

  function handleEditClick(c: Cell) {
    setSaveMsg("");
    if (tool === "elevator") return placeShaft(c);
    if (tool === "line") return placeLine(c);
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
      if (o.elevators.length || o.lines.length) overlaysOut[id] = o;
    }
    try {
      const res = await fetch("/__save-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: data.game, glyphs: glyphsOut, overlays: overlaysOut }),
      });
      setSaveMsg(res.ok ? "saved ✓ (commit glyphs/overlays.*.json)" : `error: ${await res.text()}`);
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
              onClick={() => { setTool(t.id); setAnchor(null); setSelEl(null); }}
            >
              {t.label}
            </button>
          ))}
          {tool === "elevator" && selEl !== null && overlays.elevators[selEl] && (
            <>
              <input
                className="edit-name"
                placeholder="destination area"
                value={overlays.elevators[selEl].label ?? ""}
                onChange={(ev) => {
                  const label = ev.target.value;
                  updateOverlays((o) => ({
                    ...o,
                    elevators: o.elevators.map((e, i) => (i === selEl ? { ...e, label } : e)),
                  }));
                }}
              />
              <button
                className="btn tiny"
                title="Move label above/below the shaft"
                onClick={() => {
                  updateOverlays((o) => ({
                    ...o,
                    elevators: o.elevators.map((e, i) =>
                      i === selEl
                        ? { ...e, labelPos: (e.labelPos ?? "below") === "below" ? "above" : "below" }
                        : e
                    ),
                  }));
                }}
              >
                Label: {(overlays.elevators[selEl].labelPos ?? "below") === "below" ? "below ↓" : "above ↑"}
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
              occ ? { x: c!.x - area.map.dx, y: c!.y - area.map.dy } : null
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
