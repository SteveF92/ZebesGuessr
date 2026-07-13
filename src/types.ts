export interface Cell {
  x: number;
  y: number;
}

export type MapCellKind = "room" | "vshaft" | "hshaft" | "diag";

export interface MapCell {
  x: number;
  y: number;
  /** kind */
  k: MapCellKind;
  /** wall bitmask: N=1 E=2 S=4 W=8 */
  w: number;
  /** diagonal direction for k==="diag": "/" (NE-SW) or "\\" (NW-SE) */
  d?: "/" | "\\";
}

export interface MapGlyph {
  /** fractional MAP cell coordinates of the glyph centre */
  x: number;
  y: number;
  t: "save" | "map" | "ship" | "boss";
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
  source: "ingame" | "fallback";
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
  difficulty: string;
  distance: number; // cells; Infinity if wrong area
  score: number;
}
