import type { GameData, MapGlyph, Elevator, DottedLine, RoundTarget, Cell } from "./types";

export const GAMES = [
  { id: "super-metroid", title: "Super Metroid", available: true },
  { id: "metroid-fusion", title: "Metroid Fusion", available: false },
  { id: "metroid-zero-mission", title: "Metroid: Zero Mission", available: false },
];

/** hand-placed landmark icons, keyed by areaId; overrides pipeline extraction */
export type GlyphOverrides = Record<string, MapGlyph[]>;

/** hand-placed elevator shafts + dashed transit lines, keyed by areaId */
export type OverlayOverrides = Record<
  string,
  { elevators?: Elevator[]; lines?: DottedLine[] }
>;

export function glyphOverridesUrl(gameId: string): string {
  return `${import.meta.env.BASE_URL}data/glyphs.${gameId}.json`;
}

export function overlayOverridesUrl(gameId: string): string {
  return `${import.meta.env.BASE_URL}data/overlays.${gameId}.json`;
}

export async function loadGameData(gameId: string): Promise<GameData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${gameId}.json`);
  if (!res.ok) throw new Error(`No data for ${gameId}. Run the pipeline first (see pipeline/README).`);
  const data: GameData = await res.json();

  // Elevators/lines are hand-placed; ensure the arrays exist even for data
  // baked before these fields were added.
  for (const area of data.areas) {
    area.map.elevators ??= [];
    area.map.lines ??= [];
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

  // Elevators + dashed transit lines are likewise hand-curated and win over
  // extraction (which erases them). A present area entry fully replaces that
  // area's layers.
  try {
    const ores = await fetch(overlayOverridesUrl(gameId));
    if (ores.ok) {
      const overrides: OverlayOverrides = await ores.json();
      for (const area of data.areas) {
        const o = overrides[area.id];
        if (!o) continue;
        if (o.elevators) area.map.elevators = o.elevators;
        if (o.lines) area.map.lines = o.lines;
      }
    }
  } catch {
    /* no overlay file yet — keep defaults */
  }
  return data;
}

export function tileUrl(data: GameData, t: RoundTarget): string {
  return `${import.meta.env.BASE_URL}tiles/${data.game}/${t.areaId}/cell_${t.cell.x}_${t.cell.y}.png`;
}

export function roomName(data: GameData, t: RoundTarget): string | undefined {
  return data.roomNames?.[`${t.areaId}:${t.cell.x},${t.cell.y}`];
}

/** Pick n distinct random targets, weighted by area size. */
export function pickTargets(data: GameData, n: number): RoundTarget[] {
  const pool: RoundTarget[] = [];
  for (const area of data.areas) {
    for (const cell of area.cells) pool.push({ areaId: area.id, cell });
  }
  const picked: RoundTarget[] = [];
  const used = new Set<string>();
  while (picked.length < Math.min(n, pool.length)) {
    const t = pool[Math.floor(Math.random() * pool.length)];
    const key = `${t.areaId}:${t.cell.x},${t.cell.y}`;
    if (used.has(key)) continue;
    used.add(key);
    picked.push(t);
  }
  return picked;
}

export function cellKey(areaId: string, cell: Cell): string {
  return `${areaId}:${cell.x},${cell.y}`;
}
