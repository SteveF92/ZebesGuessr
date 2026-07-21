import { DEFAULT_RATING, DIFFICULTIES, EXCLUDED_RATING, type Difficulty } from './scoring';
import type { AreaCell, GameData, MapGlyph, Connector, RoundTarget, Cell } from './types';

/**
 * Is this cell somewhere a player can point at? Only cells the pause map
 * charts (i.e. carrying draw data) qualify: a cell without `k` has a real tile
 * behind it — the X-Ray overlay paints it — but nothing is drawn on the guess
 * map there, so it can be neither found nor fairly clicked. It gates both ends
 * of a round: `pickTargets` won't serve one, and `GuessMap` won't let a click
 * land on one (an undrawn cell under a connector is drawn as transit, not as a
 * room, and counts as uncharted here too).
 */
export const isCharted = (cell: AreaCell): boolean => cell.k !== undefined;

export const GAMES = [
  { id: 'super-metroid', title: 'Super Metroid', available: true },
  { id: 'metroid-fusion', title: 'Metroid Fusion', available: true },
  { id: 'metroid-zero-mission', title: 'Metroid: Zero Mission', available: true }
];

/**
 * Dev-only testing toggle: set an area to `false` here to exclude it from
 * target picking (its tiles/rooms just won't show up as guess targets).
 * Keyed by areaId, per game. Leave a game's entry absent/empty to include
 * everything.
 */
const ENABLED_AREAS: Record<string, Record<string, boolean>> = {
  'super-metroid': {
    ceres: true,
    crateria: true,
    brinstar: true,
    norfair: true,
    'wrecked-ship': true,
    maridia: true,
    tourian: true
  },
  'metroid-fusion': {
    'main-deck': true,
    'sector-1': true,
    'sector-2': true,
    'sector-3': true,
    'sector-4': true,
    'sector-5': true,
    'sector-6': true
  },
  'metroid-zero-mission': {
    brinstar: true,
    norfair: true,
    crateria: true,
    kraid: true,
    ridley: true,
    tourian: true,
    chozodia: true
  }
};

/** hand-placed landmark icons, keyed by areaId; overrides pipeline extraction */
export type GlyphOverrides = Record<string, MapGlyph[]>;

/**
 * Hand-placed transit connectors, keyed by areaId. `connectors` is the current
 * shape; `elevators`/`lines` are the pre-merge legacy fields, still read and
 * normalised so older data files keep working.
 */
export type OverlayOverrides = Record<string, LegacyOverlayLayer>;

type LegacyElevator = { x: number; y0: number; y1: number; label?: string; labelPos?: Connector['labelPos'] };
type LegacyLine = { y: number; x0: number; x1: number };
type LegacyOverlayLayer = {
  connectors?: Connector[];
  elevators?: LegacyElevator[];
  lines?: LegacyLine[];
};

/** fold any legacy elevators/lines into the connector list (in place). */
function normalizeConnectors(layer: LegacyOverlayLayer | undefined): Connector[] | null {
  if (!layer) return null;
  if (layer.connectors) return layer.connectors;
  if (!layer.elevators && !layer.lines) return null;
  return [
    ...(layer.elevators ?? []).map((e) => ({
      x0: e.x,
      y0: e.y0,
      x1: e.x,
      y1: e.y1,
      label: e.label,
      labelPos: e.labelPos
    })),
    ...(layer.lines ?? []).map((l) => ({ x0: l.x0, y0: l.y, x1: l.x1, y1: l.y }))
  ];
}

export function glyphOverridesUrl(gameId: string): string {
  return `${import.meta.env.BASE_URL}data/glyphs.${gameId}.json`;
}

export function overlayOverridesUrl(gameId: string): string {
  return `${import.meta.env.BASE_URL}data/overlays.${gameId}.json`;
}

export function roomNamesUrl(gameId: string): string {
  return `${import.meta.env.BASE_URL}data/roomNames.${gameId}.json`;
}

export function difficultyUrl(gameId: string): string {
  return `${import.meta.env.BASE_URL}data/difficulty.${gameId}.json`;
}

export async function loadGameData(gameId: string): Promise<GameData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${gameId}.json`);
  if (!res.ok) throw new Error(`No data for ${gameId}. Run the pipeline first (see pipeline/README).`);
  const data: GameData = await res.json();

  // Dev-only testing toggle — drop any area flagged `false` in ENABLED_AREAS.
  const enabled = ENABLED_AREAS[gameId];
  if (enabled) {
    data.areas = data.areas.filter((area) => enabled[area.id] !== false);
  }

  // Connectors are hand-placed; ensure the array exists (and fold in any
  // legacy elevators/lines from data baked before the merge).
  for (const area of data.areas) {
    area.map.connectors = normalizeConnectors(area.map as LegacyOverlayLayer) ?? [];
  }

  // Icons are curated by hand in glyphs.<game>.json and win over extraction.
  try {
    const gres = await fetch(glyphOverridesUrl(gameId));
    if (gres.ok) {
      const overrides: GlyphOverrides = await gres.json();
      for (const area of data.areas) {
        if (overrides[area.id]) area.map.glyphs = overrides[area.id];
      }
    }
  } catch {
    /* no override file yet — keep extracted glyphs */
  }

  // Connectors are likewise hand-curated and win over extraction (which erases
  // them). A present area entry fully replaces that area's connectors.
  try {
    const ores = await fetch(overlayOverridesUrl(gameId));
    if (ores.ok) {
      const overrides: OverlayOverrides = await ores.json();
      for (const area of data.areas) {
        const connectors = normalizeConnectors(overrides[area.id]);
        if (connectors) area.map.connectors = connectors;
      }
    }
  } catch {
    /* no overlay file yet — keep defaults */
  }

  // Room names are hand-curated in the icon editor (the "Name" tool) and saved
  // to roomNames.<game>.json; they win over any baked entries, key by key.
  try {
    const rres = await fetch(roomNamesUrl(gameId));
    if (rres.ok) {
      const overrides: Record<string, string> = await rres.json();
      data.roomNames = { ...data.roomNames, ...overrides };
    }
  } catch {
    /* no room-name file yet — keep whatever was baked in */
  }

  // Per-tile difficulty ratings (1–5), same keying as room names. Missing
  // file or missing key both mean the neutral default rating.
  try {
    const dres = await fetch(difficultyUrl(gameId));
    if (dres.ok) {
      const overrides: Record<string, number> = await dres.json();
      data.cellDifficulty = { ...data.cellDifficulty, ...overrides };
    }
  } catch {
    /* no difficulty file yet — every cell rates the default */
  }
  return data;
}

export function tileUrl(data: GameData, t: RoundTarget): string {
  return `${import.meta.env.BASE_URL}tiles/${data.game}/${t.areaId}/cell_${t.cell.x}_${t.cell.y}.png`;
}

export function roomName(data: GameData, t: RoundTarget): string | undefined {
  return data.roomNames?.[`${t.areaId}:${t.cell.x},${t.cell.y}`];
}

/** The cell's difficulty rating (1–5); unrated cells get the default. */
export function cellRating(data: GameData, areaId: string, cell: Cell): number {
  return data.cellDifficulty?.[cellKey(areaId, cell)] ?? DEFAULT_RATING;
}

/** Pick n distinct targets uniformly at random from a flat pool (area-weighted). */
function sampleUniform(pool: RoundTarget[], n: number, rng: () => number): RoundTarget[] {
  const picked: RoundTarget[] = [];
  const used = new Set<string>();
  while (picked.length < Math.min(n, pool.length)) {
    const t = pool[Math.floor(rng() * pool.length)];
    const key = cellKey(t.areaId, t.cell);
    if (used.has(key)) continue;
    used.add(key);
    picked.push(t);
  }
  return picked;
}

/**
 * Pick n distinct random targets. With no difficulty, cells are drawn
 * uniformly (so larger areas appear more often). With a difficulty, the draw
 * is two-step: a rating level inside the band is chosen equally, then a room
 * of that rating — so the band's rarer (harder) ratings show up as often as
 * its common ones instead of being drowned out. If the band holds fewer than
 * n cells, the full uniform pool is used as a fallback. Uncharted cells (see
 * `isCharted`) and cells rated EXCLUDED_RATING never enter either pool.
 *
 * `rng` defaults to Math.random; pass a seeded PRNG (see seed.ts) to make a
 * run reproducible.
 */
export function pickTargets(data: GameData, n: number, diff?: Difficulty, rng: () => number = Math.random): RoundTarget[] {
  const all: RoundTarget[] = [];
  const byRating = new Map<number, RoundTarget[]>();
  for (const area of data.areas) {
    for (const cell of area.cells) {
      if (!isCharted(cell)) continue; // nothing drawn there to click, so never a target
      const r = cellRating(data, area.id, cell);
      if (r >= EXCLUDED_RATING) continue;
      const t = { areaId: area.id, cell };
      all.push(t);
      (byRating.get(r) ?? byRating.set(r, []).get(r)!).push(t);
    }
  }

  if (!diff) return sampleUniform(all, n, rng);

  // The band's rating levels that actually have cells to draw from.
  const bandRatings: number[] = [];
  let banded = 0;
  for (let r = diff.min; r <= diff.max; r++) {
    const cells = byRating.get(r);
    if (cells && cells.length) {
      bandRatings.push(r);
      banded += cells.length;
    }
  }
  if (banded < n) return sampleUniform(all, n, rng);

  const picked: RoundTarget[] = [];
  const used = new Set<string>();
  const active = [...bandRatings];
  while (picked.length < n && active.length) {
    const ai = Math.floor(rng() * active.length);
    const cells = byRating.get(active[ai])!;
    const t = cells[Math.floor(rng() * cells.length)];
    const key = cellKey(t.areaId, t.cell);
    if (used.has(key)) {
      // Drop this rating once all its cells are spoken for, so we never spin
      // forever on an exhausted level while others still have room.
      if (cells.every((c) => used.has(cellKey(c.areaId, c.cell)))) active.splice(ai, 1);
      continue;
    }
    used.add(key);
    picked.push(t);
  }
  return picked;
}

export function cellKey(areaId: string, cell: Cell): string {
  return `${areaId}:${cell.x},${cell.y}`;
}

export function areaName(data: GameData, areaId: string): string {
  return data.areas.find((a) => a.id === areaId)?.name ?? areaId;
}

/**
 * The game's canonical flat cell pool: every playable cell, areas in order,
 * then each area's `cells` in order. A seed stores each tile as its index into
 * this list, so encode and decode must build it identically (see seed.ts).
 */
export function cellPool(data: GameData): RoundTarget[] {
  const pool: RoundTarget[] = [];
  for (const area of data.areas) {
    for (const cell of area.cells) pool.push({ areaId: area.id, cell });
  }
  return pool;
}

/** Resolve a seed's tile indices back to targets against `data`'s cell pool. */
export function targetsFromIndices(data: GameData, indices: number[]): RoundTarget[] {
  const pool = cellPool(data);
  return indices.map((i) => pool[i]).filter((t): t is RoundTarget => !!t);
}

/** Map picked targets to their indices in `pool` (−1 if not found). */
export function indicesFromTargets(pool: RoundTarget[], targets: RoundTarget[]): number[] {
  return targets.map((t) => pool.findIndex((p) => p.areaId === t.areaId && p.cell.x === t.cell.x && p.cell.y === t.cell.y));
}

/**
 * The difficulty tier that best labels a hand-picked run: average the tiles'
 * ratings and snap to the nearest tier centre (tallon≈2, brinstar≈3, sanctuary≈4).
 * Scoring is per-tile regardless — this is purely the share/summary label.
 */
export function deriveDifficultyIndex(data: GameData, targets: RoundTarget[]): number {
  if (!targets.length) return DIFFICULTIES.findIndex((d) => d.id === 'brinstar');
  // Clamp to 5 so a normally-excluded (rating-6) pick doesn't skew the label.
  const mean = targets.reduce((s, t) => s + Math.min(5, cellRating(data, t.areaId, t.cell)), 0) / targets.length;
  const i = mean < 2.5 ? 0 : mean < 3.5 ? 1 : 2;
  return Math.min(i, DIFFICULTIES.length - 1);
}
