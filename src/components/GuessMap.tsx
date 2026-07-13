import { useEffect, useMemo, useRef, useState } from "react";
import type { AreaData, Cell, GameData, MapCell, MapGlyph, RoundResult } from "../types";

interface Props {
  data: GameData;
  /** selection in TILE coordinates */
  selected: { areaId: string; cell: Cell } | null;
  onSelect: (areaId: string, cell: Cell) => void;
  /** when set, the round is over: draw target/guess markers, ignore clicks */
  result: RoundResult | null;
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
  target: "#4dff88",
  guess: "#ff5d5d",
};

const N = 1, E = 2, SO = 4, W = 8;

/**
 * The clickable guess map, rebuilt as web elements: cells from the actual
 * in-game pause map are drawn on canvas (rooms, shafts, station glyphs,
 * Samus' ship) — no environment art, knowledge only.
 */
export default function GuessMap({ data, selected, onSelect, result }: Props) {
  const [areaId, setAreaId] = useState(data.areas[0].id);
  const area = data.areas.find((a) => a.id === areaId)!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  const occupied = useMemo(() => {
    const m = new Map<string, MapCell>();
    for (const c of area.map.cells) m.set(`${c.x},${c.y}`, c);
    return m;
  }, [area]);

  // Jump to the target's area when a round ends.
  useEffect(() => {
    if (result) setAreaId(result.target.areaId);
  }, [result]);

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

    for (const c of area.map.cells) drawCell(ctx, c);
    for (const g of area.map.glyphs) drawGlyph(ctx, g);

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

  function drawCell(ctx: CanvasRenderingContext2D, c: MapCell) {
    const x = c.x * S, y = c.y * S;
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
      // boss marker: orange diamond with dark core
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
      return;
    }
    if (g.t === "ship") {
      ctx.fillStyle = COL.ship;
      ctx.beginPath();
      ctx.moveTo(cx, cy - S / 2);
      ctx.lineTo(cx + S * 0.7, cy + S / 2);
      ctx.lineTo(cx - S * 0.7, cy + S / 2);
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.fillStyle = g.t === "save" ? COL.wall : COL.map;
    ctx.font = `bold ${S - 4}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(g.t === "save" ? "S" : "M", cx, cy + 1);
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
      <div className="map-scroll">
        <canvas
          ref={canvasRef}
          className="map-canvas"
          onMouseMove={(e) => {
            if (result) return;
            const c = cellFromEvent(e);
            setHover(c && occupied.has(`${c.x},${c.y}`) ? c : null);
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            if (result) return;
            const c = cellFromEvent(e);
            if (!c || !occupied.has(`${c.x},${c.y}`)) return;
            // convert map -> tile coordinates for scoring
            onSelect(area.id, { x: c.x - area.map.dx, y: c.y - area.map.dy });
          }}
        />
      </div>
    </div>
  );
}
