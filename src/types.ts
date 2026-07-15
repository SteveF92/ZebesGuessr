export interface Cell {
  x: number;
  y: number;
  /** a real, guessable room the in-game pause map never charts (e.g. Lower
   *  Norfair Fireflea Room's hidden east half). Kept out of `AreaMap.cells`
   *  so it isn't drawn or clickable; still a valid target (guessed blind). */
  secret?: boolean;
}

export type MapCellKind = 'room' | 'vshaft' | 'hshaft' | 'diag';

export interface MapCell {
  x: number;
  y: number;
  /** kind */
  k: MapCellKind;
  /** wall bitmask: N=1 E=2 S=4 W=8 */
  w: number;
  /** diagonal direction for k==="diag": "/" (NE-SW) or "\\" (NW-SE) */
  d?: '/' | '\\';
}

export interface MapGlyph {
  /** fractional MAP cell coordinates of the glyph centre */
  x: number;
  y: number;
  t: 'save' | 'map' | 'ship' | 'boss' | 'item' | 'recharge';
}

/**
 * A transit connector on the pause map (twin cyan rails + a dashed pink core):
 * elevator shafts and dashed tube runs alike. Hand placed in the icon editor;
 * the pipeline erases these as annotations. Axis-aligned between two whole MAP
 * cells — `x0===x1` is vertical, `y0===y1` is horizontal. `label` names the
 * destination area, drawn beside the connector on the chosen side. Overlay
 * only, never a guess target.
 */
export interface Connector {
  /** first endpoint map-cell column */
  x0: number;
  /** first endpoint map-cell row */
  y0: number;
  /** second endpoint map-cell column (inclusive) */
  x1: number;
  /** second endpoint map-cell row (inclusive) */
  y1: number;
  /** destination area name, shown beside the connector */
  label?: string;
  /** which side of the connector the label sits on (default: "below" for
   *  vertical, "right" for horizontal) */
  labelPos?: 'above' | 'below' | 'left' | 'right';
}

/**
 * A diagonal stair passage: a pink band with cyan edges, fitted to the source
 * pixels (the in-game map draws these sub-cell and not at 45°) and clipped to
 * their true bounding box so the ends mitre flush into the corridors it
 * joins instead of a rotated rectangle's corners poking past them.
 * Coordinates are fractional MAP cells. Drawn under the room cells so the
 * junctions merge.
 */
export interface DiagBand {
  /** polygon vertices, in order */
  poly: [number, number][];
}

export interface AreaMap {
  cols: number;
  rows: number;
  /** tile grid -> map grid offset: map (x,y) = tile (x+dx, y+dy) */
  dx: number;
  dy: number;
  cells: MapCell[];
  glyphs: MapGlyph[];
  bands: DiagBand[];
  /** hand-placed transit connectors: elevators + dashed tube runs, either
   *  orientation (overlay only, not guessable) */
  connectors: Connector[];
  source: 'ingame' | 'fallback';
}

export interface AreaData {
  id: string;
  name: string;
  /** grid dimensions in map cells */
  cols: number;
  rows: number;
  /** downscaled guess-map image, relative to BASE_URL (legacy, unused) */
  mapImage: string;
  /** playable (non-empty) cells */
  cells: Cell[];
  /** in-game pause-map recreation data */
  map: AreaMap;
}

export interface GameData {
  game: string;
  title: string;
  /** pixel size of one map cell in the source map */
  cellSize: number;
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
