import type { MapGlyph } from '../../types';

export type GlyphType = MapGlyph['t'];

/** Station glyphs drawn as a single letter (same meaning across games, styled
 *  per `mapStyle`). navigation/data are Fusion-only. */
export const GLYPH_LETTERS = { save: 'S', map: 'M', recharge: 'R', navigation: 'N', data: 'D' } as const;
/** The "letter rooms" GBA games outline in red — every lettered kind. */
export const RED_WALL_GLYPHS = new Set<GlyphType>(['save', 'map', 'recharge', 'navigation', 'data']);

/** Map a game id onto the ship/boss sprite filename prefix in public/assets. */
const SPRITE_PREFIX: Record<string, string> = {
  'super-metroid': 'super',
  'metroid-fusion': 'fusion'
};

/** Per-area ship-sprite overrides for games whose ship art varies by area,
 *  keyed `game → areaId → asset basename` (…/assets/<name>.png). Zero Mission
 *  has two ships — Samus' in Crateria, the pirate frigate in Chozodia — and the
 *  rule is deterministic, so the area picks the image rather than the placer
 *  choosing a glyph type. Falls back to the game-wide `<prefix>-ship`. */
const SHIP_BY_AREA: Record<string, Record<string, string>> = {
  'metroid-zero-mission': { crateria: 'zm-samus-ship', chozodia: 'zm-pirate-ship' }
};

/** Per-area boss-sprite overrides, same shape as SHIP_BY_AREA. Zero Mission
 *  draws a distinct arena statue per boss area. Falls back to `<prefix>-boss`. */
const BOSS_BY_AREA: Record<string, Record<string, string>> = {
  'metroid-zero-mission': { kraid: 'zm-kraid-tile', ridley: 'zm-ridley-tile' }
};

/** Resolve the ship asset basename for a game + current area. */
export function shipAsset(game: string, areaId: string): string {
  return SHIP_BY_AREA[game]?.[areaId] ?? `${SPRITE_PREFIX[game] ?? 'super'}-ship`;
}

/** Resolve the boss asset basename for a game + current area. */
export function bossAsset(game: string, areaId: string): string {
  return BOSS_BY_AREA[game]?.[areaId] ?? `${SPRITE_PREFIX[game] ?? 'super'}-boss`;
}

/** Diff-tool overlay colors, rating 1 (easy) → 5 (hard); 6 = never served. */
export const RATING_COLORS: Record<number, string> = {
  1: '46, 204, 113',
  2: '163, 224, 72',
  3: '241, 196, 15',
  4: '230, 126, 34',
  5: '231, 76, 60',
  6: '25, 25, 25'
};

/** outline color for the Diff tool's isolate mode — picked for max contrast
 *  against every rating color and the map's dark background. */
export const ISOLATE_HIGHLIGHT = '#39ff14';

/** logical units per map cell (all drawing math is in these units) */
export const S = 16;
/** css px per logical unit at view.z = 1 — the unit convention behind the pan/
 *  zoom plumbing (W0/H0, fitZ, zoomBounds) and the editing path's backing
 *  scale. Play-mode rendering is viewport-based (the canvas draws at the
 *  viewport's device resolution whatever the zoom), so this is NOT a quality
 *  knob. */
export const SCALE = 2;
/** deepest zoom-in, expressed as the on-screen size of one map cell (css px).
 *  The map's base scale draws a cell at S*SCALE (32px), so this is the real
 *  zoom ceiling; large enough to inspect a single X-Ray screen up close. */
export const MAX_CELL_PX = 176;

/* Marker colors (scan brackets, dot trail, target ring): shared visual
 * language across games, so they live outside the per-style palettes. */
const MARKERS = {
  hover: 'rgba(160, 248, 248, 0.6)',
  selected: '#ffd24d',
  item: '#f8f8f8',
  target: '#00ff88',
  /* Prime scan-visor brackets: cursor / placed guess markers */
  scan: '#a0f8f8',
  scanOutline: '#08262e',
  /* Zero Mission dot trail + Fusion target dot */
  trailDot: '#f8e048',
  trailOutline: '#1a1400',
  targetRing: '#00f858'
};

// SNES pause-map palette (Super Metroid recreation style)
export const SNES_COL = {
  bg: '#000000',
  /** snes: the purple dot lattice; gba: the empty-cell square color */
  dot: '#40166e',
  room: '#d83890',
  wall: '#a0f8f8',
  map: '#00f858',
  ship: '#f88838',
  /** landmark-letter text color (S/M/R…) */
  letter: '#00f858',
  /** wall color of a "letter room" — Fusion outlines them red; SNES has no
   *  such rooms, so this is never drawn (kept equal to `wall`). */
  special: '#a0f8f8',
  /** room-fill variants (`CellDraw.f` indexes this; [0] === room) */
  fills: ['#d83890'],
  /** door-pip colors by letter (`CellDraw.dr`; gba style only) */
  doors: {} as Record<string, string>,
  /** gba style: a colored door also draws a jamb bar just inside the wall, so
   *  two adjacent cells compose the game's "H" lock. Fusion does this; Zero
   *  Mission draws its doors as small blocks on the border instead (see
   *  drawCell), so it turns this off. */
  doorJambs: true,
  ...MARKERS
};

/** The full map palette shape (every per-style/per-game palette conforms). */
export type MapPalette = typeof SNES_COL;

// GBA pause-map palette (Fusion tile-art style) — exact colors from the
// source rips: navy lattice of empty squares, magenta/green room fills,
// white walls, colored door pips.
export const GBA_COL: MapPalette = {
  bg: '#000090', // lattice grid lines
  dot: '#202048', // empty-cell square interiors
  room: '#f800f8',
  wall: '#f8f8f8',
  map: '#20c068',
  ship: '#f82048',
  letter: '#f8f800', // Fusion draws station letters in yellow
  special: '#f82048', // GBA games outline "letter rooms" (Save/Map/Nav/Data/Recharge) in red
  fills: ['#f800f8', '#20c068'],
  doors: { r: '#f82048', y: '#f8f800', g: '#10f880', b: '#0000f8' },
  doorJambs: true,
  ...MARKERS
};

// Zero Mission shares Fusion's map language but not its colors: dark-green
// lattice, blue/green/orange fills (mapped / unmapped-until-visited /
// super-heated), and pips for every door — light blue is the normal one.
// Chozo-statue and major-item rooms bake a big white icon over the fill, but
// the real room color bleeds through, so they keep their real fill (no white).
const ZM_COL: MapPalette = {
  ...GBA_COL,
  bg: '#085810', // lattice grid lines
  dot: '#202820', // empty-cell square interiors
  room: '#0000f8',
  fills: ['#0000f8', '#20c068', '#f86820'],
  doors: { r: '#f82048', y: '#f8f800', g: '#10f880', b: '#0070f8' },
  // ZM draws no "H" locks — its doors are small border blocks (see drawCell).
  doorJambs: false
};

/** Per-game palette overrides on top of the style default. */
export const GAME_COL: Record<string, MapPalette> = {
  'metroid-zero-mission': ZM_COL
};

/** wall bits (CellDraw.w) */
export const N = 1,
  E = 2,
  SO = 4,
  W = 8;

/** Reveal timeline (ms). Every reveal opens the same way: the scan sweep
 *  passes over the map with only the guess marker showing (it persists from
 *  the selection the player just placed). Then, by outcome:
 *   - exact hit — the TARGET indicator + ring land as the sweep finishes,
 *     with a second ring pulse offset by RING2_DELAY;
 *   - same-area miss — the trail's origin dot lands center-cell as the sweep
 *     clears, holds a beat (DOT_PAUSE_MS), then the dot trail traces to the
 *     target (TRACE_MS) and the indicator locks on, with a shake on arrival
 *     if it's 10+ cells off;
 *   - wrong area — the map holds on the guessed area through the sweep, then
 *     cuts to the target's area with a hard shake and locks on immediately. */
export const SWEEP_MS = 550; // scan sweep — keep in step with zgMapSweep in styles.css
export const DOT_PAUSE_MS = 350; // beat between the guess marker landing and the trail firing
export const TRACE_MS = 900; // dot trail guess→target
export const RING_MS = 650; // target ring pulse
export const RING2_DELAY = 350; // exact hit: second ring pulse offset
/** Fusion-style TARGET callout: palette flip cadence (runs while revealed). */
export const TARGET_BLINK_MS = 350;
