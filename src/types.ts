export interface Cell {
  x: number;
  y: number;
}

export interface AreaData {
  id: string;
  name: string;
  /** grid dimensions in map cells */
  cols: number;
  rows: number;
  /** downscaled guess-map image, relative to BASE_URL */
  mapImage: string;
  /** playable (non-empty) cells */
  cells: Cell[];
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
  zoomStep: number;
  distance: number; // cells; Infinity if wrong area
  score: number;
}
