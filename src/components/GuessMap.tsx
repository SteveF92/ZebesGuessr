import { useEffect, useRef, useState } from "react";
import type { AreaData, Cell, GameData, RoundResult } from "../types";

interface Props {
  data: GameData;
  selected: { areaId: string; cell: Cell } | null;
  onSelect: (areaId: string, cell: Cell) => void;
  /** when set, the round is over: draw target/guess markers, ignore clicks */
  result: RoundResult | null;
}

export default function GuessMap({ data, selected, onSelect, result }: Props) {
  const [areaId, setAreaId] = useState(data.areas[0].id);
  const area = data.areas.find((a) => a.id === areaId)!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const px = data.guessMapCellPx;

  // Jump to the target's area when a round ends.
  useEffect(() => {
    if (result) setAreaId(result.target.areaId);
  }, [result]);

  // Load area map image.
  useEffect(() => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}${area.mapImage}`;
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    imgRef.current = null;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.id]);

  useEffect(draw, [hover, selected, result, areaId]); // eslint-disable-line react-hooks/exhaustive-deps

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = area.cols * px;
    const h = area.rows * px;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#04060f";
    ctx.fillRect(0, 0, w, h);
    if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0, w, h);

    // faint grid
    ctx.strokeStyle = "rgba(120,160,255,0.12)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= area.cols; x++) {
      ctx.beginPath(); ctx.moveTo(x * px + 0.5, 0); ctx.lineTo(x * px + 0.5, h); ctx.stroke();
    }
    for (let y = 0; y <= area.rows; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * px + 0.5); ctx.lineTo(w, y * px + 0.5); ctx.stroke();
    }

    const box = (c: Cell, color: string, width = 2) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(c.x * px + 1, c.y * px + 1, px - 2, px - 2);
    };

    if (!result) {
      if (hover) box(hover, "rgba(255,255,255,0.7)", 1.5);
      if (selected && selected.areaId === area.id) box(selected.cell, "#ffd24d", 2.5);
    } else {
      if (result.guess.areaId === area.id) box(result.guess.cell, "#ff5d5d", 2.5);
      if (result.target.areaId === area.id) box(result.target.cell, "#4dff88", 2.5);
      if (result.guess.areaId === area.id && result.target.areaId === area.id) {
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo((result.guess.cell.x + 0.5) * px, (result.guess.cell.y + 0.5) * px);
        ctx.lineTo((result.target.cell.x + 0.5) * px, (result.target.cell.y + 0.5) * px);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function cellFromEvent(e: React.MouseEvent): Cell | null {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * area.cols);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * area.rows);
    if (x < 0 || y < 0 || x >= area.cols || y >= area.rows) return null;
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
          onMouseMove={(e) => !result && setHover(cellFromEvent(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            if (result) return;
            const c = cellFromEvent(e);
            if (c) onSelect(area.id, c);
          }}
        />
      </div>
    </div>
  );
}
