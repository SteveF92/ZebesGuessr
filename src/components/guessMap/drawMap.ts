import type { AreaCell, Connector, DiagBand, MapGlyph } from '../../types';
import { E, GLYPH_LETTERS, N, RED_WALL_GLYPHS, S, SO, W, type MapPalette } from './constants';
import { connBounds, connHorizontal, defaultLabelPos } from './connectors';

/** everything drawGlyph needs beyond the glyph itself: the (loaded) sprite
 *  images — pass null while a sprite is still loading so the vector fallback
 *  draws — plus the knob-wall lookup and the per-game ship nudge. */
export interface GlyphDrawContext {
  bossImage: HTMLImageElement | null;
  shipImage: HTMLImageElement | null;
  /** Zero Mission's chozo-statue sprite (games without one pass null) */
  chozoImage: HTMLImageElement | null;
  /** knob cells keyed "x,y" -> wall bits (see computeKnobWalls) */
  knobWalls: Map<string, number>;
  /** extra downward nudge for the ship sprite (Zero Mission's Crateria ship) */
  shipYNudge: number;
}

// Room walls a diagonal passage opens through, keyed `x,y,dir`. In-game the
// stairs flow straight into the room they meet, so that room draws no wall
// on the shared edge. The opening is a band's short "cap" edge (its long
// "rail" edges are the real stair walls) — NOT every edge that merely abuts
// a diag cell: a room sitting directly under the staircase still keeps its
// ceiling. So we walk each band's cap edges and mark the room-side wall of
// the cell boundary each one straddles.
export function computeOpenWalls(bands: DiagBand[] | undefined): Set<string> {
  const s = new Set<string>();
  const RAIL = 0.5; // cells: rails span several, caps stay well under
  for (const b of bands ?? []) {
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
}

/** knob cells keyed "x,y" -> wall bits: knobs are sub-cell boxes inset toward
 *  a connector, so an item drawn on one nudges to the box's real centre (away
 *  from the rail side) rather than the cell centre. */
export function computeKnobWalls(cells: AreaCell[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cells) if (c.k === 'knob') m.set(`${c.x},${c.y}`, c.w);
  return m;
}

/** Cells whose walls draw red because a "letter room" glyph sits on them
 *  (GBA-style games only — see RED_WALL_GLYPHS and drawCell's wall color). */
export function computeSpecialCells(glyphs: MapGlyph[], mapStyle: string): Set<string> {
  const s = new Set<string>();
  if (mapStyle !== 'gba') return s;
  for (const g of glyphs) if (RED_WALL_GLYPHS.has(g.t)) s.add(`${Math.floor(g.x)},${Math.floor(g.y)}`);
  return s;
}

/**
 * A stair passage: a pink polygon with a cyan outline, like the in-game
 * map (which draws these sub-cell, not at 45°). The polygon is pre-clipped
 * to the source band's true pixel footprint (see extract_diag_bands), so
 * it mitres flush into the corridors it joins instead of a rotated
 * rectangle's corners poking past them. Clickable diag cells sit under it
 * and draw nothing themselves.
 */
export function drawBand(ctx: CanvasRenderingContext2D, b: DiagBand, COL: MapPalette) {
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

export function drawCell(ctx: CanvasRenderingContext2D, c: AreaCell, COL: MapPalette, walls: { openWalls: Set<string>; specialCells: Set<string> }) {
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
  const open = (dir: string) => walls.openWalls.has(`${c.x},${c.y},${dir}`);
  // Fusion "letter rooms" outline their walls in red (not their doors — those
  // keep their pip color below); every other cell draws plain white walls.
  const special = walls.specialCells.has(`${c.x},${c.y}`);
  ctx.fillStyle = special ? COL.special : COL.wall;
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
          C = 2, // white wall caps flanking it along the wall (the 4x4's top/bottom rows)
          // depth into the cell. A letter room's door stops one source px
          // shorter — it covers only the room's own (red) wall pixel and never
          // spills into the fill, so a lock straddling a Save/Map room reads
          // 3 px wide in-game rather than 4 (checked against the raw rips).
          D = special ? B / 2 : B;
        // white caps first: the wall's white extends a bit past the lock on
        // both ends (D deep, C longer than the color on each along-wall side)
        ctx.fillStyle = COL.wall;
        if (p[0] === 'N') ctx.fillRect(x + S / 2 - B / 2 - C, y, B + 2 * C, D);
        else if (p[0] === 'S') ctx.fillRect(x + S / 2 - B / 2 - C, y + S - D, B + 2 * C, D);
        else if (p[0] === 'W') ctx.fillRect(x, y + S / 2 - B / 2 - C, D, B + 2 * C);
        else if (p[0] === 'E') ctx.fillRect(x + S - D, y + S / 2 - B / 2 - C, D, B + 2 * C);
        // then the lock color, inset between the caps
        ctx.fillStyle = COL.doors[p[1]] ?? COL.wall;
        if (p[0] === 'N') ctx.fillRect(x + S / 2 - B / 2, y, B, D);
        else if (p[0] === 'S') ctx.fillRect(x + S / 2 - B / 2, y + S - D, B, D);
        else if (p[0] === 'W') ctx.fillRect(x, y + S / 2 - B / 2, D, B);
        else if (p[0] === 'E') ctx.fillRect(x + S - D, y + S / 2 - B / 2, D, B);
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

export function drawGlyph(ctx: CanvasRenderingContext2D, g: MapGlyph, COL: MapPalette, gcx: GlyphDrawContext) {
  const cx = g.x * S,
    cy = g.y * S;
  if (g.t === 'boss') {
    const img = gcx.bossImage;
    if (img) {
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
    const w = gcx.knobWalls.get(`${Math.floor(g.x)},${Math.floor(g.y)}`);
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
    // chozo statue room: the statue sprite, sized like a single-cell boss.
    const img = gcx.chozoImage;
    if (img) {
      ctx.imageSmoothingEnabled = false;
      const w = S * 0.9;
      const h = (img.height / img.width) * w;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      ctx.imageSmoothingEnabled = true;
    } else {
      // Fallback: the source map's big red circle.
      ctx.strokeStyle = COL.special;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }
  if (g.t === 'ship') {
    const img = gcx.shipImage;
    if (img) {
      const shipWidth = S * 0.95;
      const shipHeight = (img.height / img.width) * shipWidth;
      // Pixel-art source (16×9 / 8×5) — nearest-neighbor keeps it sharp.
      ctx.imageSmoothingEnabled = false;
      // Nudge the ship one pixel left — reads better centered in both games.
      // (gcx.shipYNudge carries any per-game downward nudge — see the caller.)
      ctx.drawImage(img, cx - shipWidth / 2 - 1, cy - shipHeight / 2 + gcx.shipYNudge, shipWidth, shipHeight);
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
export function drawConnector(ctx: CanvasRenderingContext2D, c: Connector, COL: MapPalette, preview: boolean) {
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
  if (c.label) drawConnectorLabel(ctx, c, b, COL);
  ctx.restore();
}

/** the destination label, positioned on any of the connector's four sides.
 *  A literal `\n` (or a real newline) in the label splits it into stacked
 *  lines — the escape is how the plain-text editor input holds a break. */
function drawConnectorLabel(ctx: CanvasRenderingContext2D, c: Connector, b: ReturnType<typeof connBounds>, COL: MapPalette) {
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
