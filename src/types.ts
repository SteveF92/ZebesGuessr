/** A cell coordinate. Everything in this file is in TILE coordinates. */
export interface Cell {
  x: number;
  y: number;
}

/**
 * 'knob' ('gba' style) is a sub-cell passage: a small outlined box inset from
 * the cell boundary. Its `w` bits mark the sides where the box is inset and
 * twin rails bridge the gap to the cell edge (not walls), and its `dr` pips
 * (always "n") mark the sides with openings.
 */
export type MapCellKind = 'room' | 'vshaft' | 'hshaft' | 'diag' | 'knob';

/**
 * Which pause-map art style a game uses — dispatches both the pipeline
 * extractor and the GuessMap palette/renderer. 'snes' is the Super Metroid
 * recreation style (pink rooms, cyan walls); 'gba' is the Fusion/Zero Mission
 * tile-art style (navy lattice, magenta/green rooms, white walls, door pips).
 */
export type MapStyle = 'snes' | 'gba';

/**
 * A door pip on a cell border ('gba' style only): side letter + color letter,
 * e.g. "Nr" = red door on the north wall. Sides N/E/S/W; colors r/y/g/b for
 * locked/special hatches, "n" for a normal door (drawn as a gap in the wall).
 */
export type DoorPip = string;

/**
 * One cell of an area — the single source of truth for "this screen exists".
 * Every cell has a tile PNG behind it, so the X-Ray overlay paints all of
 * them; whether one can be a guess target is decided elsewhere — the map must
 * draw something there (draw data or a connector over it, see `drawnCells`;
 * a cell it draws nothing at offers nothing to click) and difficulty must
 * allow it (`EXCLUDED_RATING` = never served).
 *
 * The draw data is optional, and answers the only question the pause map adds:
 * *what to draw, if anything*. A cell the map charts carries `k`/`w` (plus `d`
 * for stairs); one it doesn't — an elevator shaft or tube run, whose cyan-only
 * rails are drawn as an overlay `Connector` instead — carries none and simply
 * isn't drawn.
 */
export interface CellDraw {
  /** kind */
  k: MapCellKind;
  /** wall bitmask: N=1 E=2 S=4 W=8 */
  w: number;
  /** diagonal direction for k==="diag": "/" (NE-SW) or "\\" (NW-SE) */
  d?: '/' | '\\';
  /** fill-variant index into the game's fill palette ('gba' style; 0 = default, omitted) */
  f?: number;
  /** door pips on this cell's borders ('gba' style), e.g. ["Nr", "En"] */
  dr?: DoorPip[];
}

/** Draw data is all-or-nothing, so `if (!c.k)` narrows `c.w` to a number. */
export type AreaCell = Cell & (CellDraw | { k?: undefined });

export interface MapGlyph {
  /** fractional tile-cell coordinates of the glyph centre */
  x: number;
  y: number;
  /** landmark kind. `navigation` (talk-to-computer + save) and `data`
   *  (ability download) are Fusion-only; `chozo` (statue room, the source
   *  map's big red circle) and `itemMajor` (a major upgrade, circled on the
   *  source map — vs the plain `item` dot) are Zero Mission-only; the rest
   *  are shared across games, drawn per `mapStyle`. */
  t: 'save' | 'map' | 'ship' | 'boss' | 'item' | 'recharge' | 'navigation' | 'data' | 'chozo' | 'itemMajor';
  /** span in cells for a multi-cell glyph, centred on `(x, y)`. Used for the
   *  2×2 boss statues (Zero Mission's Kraid and Ridley); omitted elsewhere. */
  s?: number;
}

/**
 * A transit connector on the pause map (twin cyan rails + a dashed pink core):
 * elevator shafts and dashed tube runs alike. Hand placed in the icon editor;
 * the pipeline erases these as annotations. Axis-aligned between two whole
 * cells — `x0===x1` is vertical, `y0===y1` is horizontal. `label` names the
 * destination area, drawn beside the connector on the chosen side. This is how
 * such a run gets *drawn*; the cells under it are ordinary `AreaCell`s with no
 * draw data (see `AreaCell`), and are real tiles.
 */
export interface Connector {
  /** first endpoint cell column */
  x0: number;
  /** first endpoint cell row */
  y0: number;
  /** second endpoint cell column (inclusive) */
  x1: number;
  /** second endpoint cell row (inclusive) */
  y1: number;
  /** destination area name, shown beside the connector */
  label?: string;
  /** which side of the connector the label sits on (default: "below" for
   *  vertical, "right" for horizontal) */
  labelPos?: 'above' | 'below' | 'left' | 'right';
  /** orientation override for a single-cell connector, where neither axis
   *  dominates. Normally the label side breaks the tie (left/right ⇒
   *  horizontal), but a horizontal stub labelled above/below can't be expressed
   *  that way — set this explicitly for it. Ignored when the span already picks
   *  an axis (x0≠x1 or y0≠y1). */
  horizontal?: boolean;
}

/**
 * A diagonal stair passage: a pink band with cyan edges, fitted to the source
 * pixels (the in-game map draws these sub-cell and not at 45°) and clipped to
 * their true bounding box so the ends mitre flush into the corridors it
 * joins instead of a rotated rectangle's corners poking past them.
 * Coordinates are fractional tile cells. Drawn under the room cells so the
 * junctions merge.
 */
export interface DiagBand {
  /** polygon vertices, in order */
  poly: [number, number][];
}

/**
 * How the pause map is drawn: a viewport plus the overlays that aren't cells.
 * The canvas is `cols`×`rows` cells and the area's tile grid sits at (`dx`,
 * `dy`) within it — the recreation image is larger than the area map and has
 * its own origin (Wrecked Ship's 12×10 grid sits inside a 31×19 canvas at
 * (10,4)). That offset is the *only* thing left of the old map-coordinate
 * space: `GuessMap` translates by it once, and every coordinate in this file
 * — cells, glyphs, bands, connectors — is tile coordinates.
 */
export interface AreaMap {
  cols: number;
  rows: number;
  /** where the tile grid sits on the map canvas; a draw-time translate only */
  dx: number;
  dy: number;
  glyphs: MapGlyph[];
  bands: DiagBand[];
  /** hand-placed transit connectors: elevators + dashed tube runs */
  connectors: Connector[];
  source: 'ingame' | 'fallback';
}

export interface AreaData {
  id: string;
  name: string;
  /** tile-grid dimensions */
  cols: number;
  rows: number;
  /** downscaled guess-map image, relative to BASE_URL (legacy, unused) */
  mapImage: string;
  /** every cell of the area; `k` present = the pause map draws it */
  cells: AreaCell[];
  /** pause-map render viewport + overlays */
  map: AreaMap;
}

export interface GameData {
  game: string;
  title: string;
  /** pause-map art style; absent = 'snes' */
  mapStyle?: MapStyle;
  /** pixel size of one map cell in the source map */
  cellSize: number;
  /** source-map cell dimensions when non-square (GBA: one 240×160 screen per cell) */
  cellWidth?: number;
  cellHeight?: number;
  /** px per cell in the downscaled guess-map image */
  guessMapCellPx: number;
  areas: AreaData[];
  /** optional speedrun/community room names: "areaId:x,y" -> name */
  roomNames?: Record<string, string>;
  /** per-tile difficulty ratings 1–5: "areaId:x,y" -> rating (missing = 3) */
  cellDifficulty?: Record<string, number>;
}

export interface RoundTarget {
  areaId: string;
  cell: Cell;
}

export interface Guess {
  areaId: string;
  cell: Cell;
}

export interface RoundResult {
  target: RoundTarget;
  guess: Guess;
  /** the target tile's difficulty rating (1–5) — sets the round's max score */
  rating: number;
  distance: number; // cells; Infinity if wrong area
  score: number;
}
