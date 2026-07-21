import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

/** run a command from the repo root, capturing interleaved stdout+stderr */
function run(cmd: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: __dirname });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ code, out }));
    p.on('error', (e) => res({ code: -1, out: String(e) }));
  });
}

// one pipeline bake at a time, across every bake endpoint (/__bake-landmarks
// runs the full composite → slice → extract chain; /__bake-map just the
// extractor) — they all rewrite public/data/<game>.json
let baking = false;

// Dev-only endpoint for the in-app icon editor: POST the curated map data and
// it is written straight into public/data/*.<game>.json, ready to commit —
// glyphs into glyphs.<game>.json, connectors into overlays.<game>.json, room
// names into roomNames.<game>.json, and per-cell difficulty ratings into
// difficulty.<game>.json. Not part of the production build.
function glyphSaver(): Plugin {
  return {
    name: 'zg-glyph-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-map', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { game, glyphs, overlays, roomNames, difficulty } = JSON.parse(body);
            if (!/^[a-z0-9-]+$/.test(game ?? '')) throw new Error('bad game id');
            const written: string[] = [];
            const write = async (name: string, data: unknown) => {
              const file = resolve(__dirname, 'public/data', `${name}.${game}.json`);
              await writeFile(file, JSON.stringify(data, null, 2) + '\n');
              written.push(file);
            };
            if (glyphs) await write('glyphs', glyphs);
            if (overlays) await write('overlays', overlays);
            if (roomNames) await write('roomNames', roomNames);
            if (difficulty) await write('difficulty', difficulty);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, files: written }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
    }
  };
}

// Dev-only endpoints for the editor's Landmark tool, which positions the
// sprite stamps that composite_landmarks.py bakes into the tiles. Unlike the
// glyph/overlay sidecars (runtime data), landmarks are PIPELINE INPUT: saving
// writes pipeline/landmarks.<game>.json, and the art only reaches the served
// tiles after rerunning composite_landmarks + slice_maps + the extractor.
// The tool previews WYSIWYG anyway by drawing the pristine (unstamped) source
// map + the manifest client-side — the same alpha-over compositing Python does.
function landmarkEditor(): Plugin {
  const GAME_RE = /^[a-z0-9-]+$/;
  const AREA_RE = /^[a-z0-9-]+$/;
  // sprite paths are category-relative: "bosses/box.png", or flat "box.png"
  // (grouped as "other" in the editor). The [a-z0-9-] charset excludes "." and
  // "\", so ".." and backslash traversal can never match — don't loosen it.
  const SPRITE_RE = /^(?:[a-z0-9-]+\/)?[a-z0-9-]+\.png$/;
  return {
    name: 'zg-landmark-editor',
    apply: 'serve',
    configureServer(server) {
      // GET /__landmarks/<game> -> manifest + sprite list + slicing metadata
      server.middlewares.use('/__landmarks', async (req, res) => {
        try {
          const game = (req.url ?? '').replace(/^\//, '').split('?')[0];
          if (!GAME_RE.test(game)) throw new Error('bad game id');
          const config = JSON.parse(await readFile(resolve(__dirname, 'pipeline/maps.config.json'), 'utf8'));
          if (!config[game]) throw new Error('unknown game');
          const manifestPath = resolve(__dirname, 'pipeline', `landmarks.${game}.json`);
          const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
          // one category level deep, walked explicitly (readdir{recursive} is
          // Node>=18.17-only and returns backslashes on Windows)
          const spriteDir = resolve(__dirname, 'pipeline/sprites', game);
          const sprites: string[] = [];
          if (existsSync(spriteDir)) {
            for (const e of await readdir(spriteDir, { withFileTypes: true })) {
              if (e.isDirectory()) {
                for (const f of await readdir(resolve(spriteDir, e.name))) {
                  if (SPRITE_RE.test(`${e.name}/${f}`)) sprites.push(`${e.name}/${f}`);
                }
              } else if (SPRITE_RE.test(e.name)) sprites.push(e.name);
            }
            sprites.sort();
          }
          const areas: Record<string, unknown> = {};
          for (const a of config[game].areas) {
            areas[a.id] = {
              offsetX: a.offsetX ?? 0,
              offsetY: a.offsetY ?? 0,
              cellCropOffsets: a.cellCropOffsets ?? {},
              keepTiles: a.keepTiles ?? []
            };
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              manifest,
              sprites,
              areas,
              cellWidth: config[game].cellWidth ?? config[game].cellSize,
              cellHeight: config[game].cellHeight ?? config[game].cellSize
            })
          );
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e instanceof Error ? e.message : e));
        }
      });
      // GET /__landmark-sprite/<game>/[<category>/]<file>.png
      server.middlewares.use('/__landmark-sprite', async (req, res) => {
        try {
          const parts = (req.url ?? '').replace(/^\//, '').split('?')[0].split('/');
          const game = parts[0];
          const file = parts.slice(1).join('/');
          if (!GAME_RE.test(game) || !SPRITE_RE.test(file)) throw new Error('bad path');
          res.setHeader('Content-Type', 'image/png');
          res.end(await readFile(resolve(__dirname, 'pipeline/sprites', game, file)));
        } catch {
          res.statusCode = 404;
          res.end('not found');
        }
      });
      // GET /__landmark-image/<game>/<area> -> the PRISTINE (unstamped) source
      // map; falls back to the raw download for areas never stamped. Serving
      // pristine matters: the on-disk raw/tiles already contain the previous
      // stamp positions, so previewing over them would double the sprites.
      server.middlewares.use('/__landmark-image', async (req, res) => {
        try {
          const [game, area] = (req.url ?? '').replace(/^\//, '').split('?')[0].split('/');
          if (!GAME_RE.test(game) || !AREA_RE.test(area ?? '')) throw new Error('bad path');
          const pristine = resolve(__dirname, 'Images/raw', game, 'pristine', `${area}.png`);
          const raw = resolve(__dirname, 'Images/raw', game, `${area}.png`);
          res.setHeader('Content-Type', 'image/png');
          res.end(await readFile(existsSync(pristine) ? pristine : raw));
        } catch {
          res.statusCode = 404;
          res.end('not found (run download_maps.py so Images/raw is populated)');
        }
      });
      // POST /__bake-landmarks { game } -> run the pipeline chain that turns
      // the saved manifest into tiles: composite_landmarks -> slice_maps ->
      // the game's extractor, then prettier on the regenerated game JSON
      // (matching `npm run format` so the working tree stays commit-ready).
      // Takes ~30-60s; one bake at a time (the module-level `baking` flag).
      server.middlewares.use('/__bake-landmarks', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { game } = JSON.parse(body);
            if (!GAME_RE.test(game ?? '')) throw new Error('bad game id');
            if (baking) throw new Error('a bake is already running');
            baking = true;
            try {
              const config = JSON.parse(await readFile(resolve(__dirname, 'pipeline/maps.config.json'), 'utf8'));
              if (!config[game]) throw new Error('unknown game');
              const extractor = (config[game].mapStyle ?? 'snes') === 'gba' ? 'extract_gba_maps.py' : 'extract_ingame_maps.py';
              const logs: string[] = [];
              for (const script of ['composite_landmarks.py', 'slice_maps.py', extractor]) {
                const r = await run('python', [`pipeline/${script}`, game]);
                logs.push(`== ${script}\n${r.out.trim()}`);
                if (r.code !== 0) throw new Error(`${script} exited ${r.code}:\n${r.out.slice(-2000)}`);
              }
              const dataFile = resolve(__dirname, 'public/data', `${game}.json`);
              const prettier = await import('prettier');
              const cfg = await prettier.resolveConfig(dataFile);
              await writeFile(dataFile, await prettier.format(await readFile(dataFile, 'utf8'), { ...cfg, filepath: dataFile }));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, log: logs.join('\n') }));
            } finally {
              baking = false;
            }
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
      // POST /__save-landmarks { game, manifest } -> pipeline/landmarks.<game>.json
      server.middlewares.use('/__save-landmarks', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { game, manifest } = JSON.parse(body);
            if (!GAME_RE.test(game ?? '')) throw new Error('bad game id');
            if (typeof manifest !== 'object' || manifest === null) throw new Error('bad manifest');
            const file = resolve(__dirname, 'pipeline', `landmarks.${game}.json`);
            await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
            res.end(JSON.stringify({ ok: true, file }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
    }
  };
}

// Dev-only endpoints for the editor's Room state tool (GBA games only), which
// previews Randovania's per-room renders as tile-override candidates. Like
// landmarks, tile overrides are PIPELINE INPUT: saving writes
// pipeline/tileOverrides.<game>.json and copies each referenced render
// byte-identical from the vendored checkout (randovania/<dir>/assets/maps/,
// gitignored) into the committed pipeline/tile-sources/<game>/<area>/ — so a
// fresh clone reproduces the bake without the checkout. Bake reuses
// /__bake-landmarks (composite_landmarks.py applies overrides too).
function roomStateEditor(): Plugin {
  const AREA_RE = /^[a-z0-9-]+$/;
  const FILE_RE = /^[a-z0-9-]+\.png$/;
  // Randovania render/region basenames are letters+digits+spaces ("Main
  // Deck46", "Sector 1 SRX") — no "." or slashes, so traversal can't match.
  const MAP_NAME_RE = /^[A-Za-z0-9 ]+$/;
  const IMG_RE = /^tile-sources\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.png$/;
  // our game id -> vendored checkout dir under randovania/
  const RANDO_DIR: Record<string, string> = {
    'metroid-fusion': 'fusion',
    'metroid-zero-mission': 'zero_mission'
  };
  // our areaId -> logic-database region basename (mirrors the AREAS tables in
  // pipeline/import_*_room_names.py; region keys are the render room names)
  const REGION: Record<string, Record<string, string>> = {
    'metroid-fusion': {
      'main-deck': 'Main Deck',
      'sector-1': 'Sector 1 SRX',
      'sector-2': 'Sector 2 TRO',
      'sector-3': 'Sector 3 PYR',
      'sector-4': 'Sector 4 AQA',
      'sector-5': 'Sector 5 ARC',
      'sector-6': 'Sector 6 NOC'
    },
    'metroid-zero-mission': {
      brinstar: 'Brinstar',
      kraid: 'Kraid',
      norfair: 'Norfair',
      ridley: 'Ridley',
      tourian: 'Tourian',
      crateria: 'Crateria',
      chozodia: 'Chozodia'
    }
  };
  return {
    name: 'zg-room-state-editor',
    apply: 'serve',
    configureServer(server) {
      // GET /__room-state/<game> -> tileOverrides manifest + slicing metadata
      server.middlewares.use('/__room-state', async (req, res) => {
        try {
          const game = (req.url ?? '').replace(/^\//, '').split('?')[0];
          const dir = RANDO_DIR[game];
          if (!dir) throw new Error('room-state editor only supports GBA games');
          const config = JSON.parse(await readFile(resolve(__dirname, 'pipeline/maps.config.json'), 'utf8'));
          if (!config[game]) throw new Error('unknown game');
          const manifestPath = resolve(__dirname, 'pipeline', `tileOverrides.${game}.json`);
          const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
          const areas: Record<string, unknown> = {};
          for (const a of config[game].areas) {
            areas[a.id] = {
              offsetX: a.offsetX ?? 0,
              offsetY: a.offsetY ?? 0,
              cellCropOffsets: a.cellCropOffsets ?? {},
              keepTiles: a.keepTiles ?? []
            };
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              manifest,
              areas,
              cellWidth: config[game].cellWidth ?? config[game].cellSize,
              cellHeight: config[game].cellHeight ?? config[game].cellSize,
              randovaniaPresent: existsSync(resolve(__dirname, 'randovania', dir, 'assets/maps'))
            })
          );
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e instanceof Error ? e.message : e));
        }
      });
      // GET /__room-map-name/<game>/<area>?room=<encoded room name> ->
      // { mapName } from the logic database (extra.map_name = render basename)
      server.middlewares.use('/__room-map-name', async (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://x');
          const [game, area] = url.pathname.replace(/^\//, '').split('/');
          const room = url.searchParams.get('room') ?? '';
          const dir = RANDO_DIR[game];
          const region = REGION[game]?.[area ?? ''];
          if (!dir || !region || !AREA_RE.test(area)) throw new Error('bad path');
          const db = JSON.parse(await readFile(resolve(__dirname, 'randovania', dir, 'logic_database', `${region}.json`), 'utf8'));
          const mapName = db.areas?.[room]?.extra?.map_name;
          if (typeof mapName !== 'string') {
            res.statusCode = 404;
            return res.end(`room "${room}" not in ${region}.json — sidecar name drifted from the logic DB?`);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ mapName }));
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e instanceof Error ? e.message : e));
        }
      });
      // GET /__room-render/<game>/<mapName>.png -> the vendored room render
      server.middlewares.use('/__room-render', async (req, res) => {
        try {
          const parts = (req.url ?? '').replace(/^\//, '').split('?')[0].split('/');
          const game = parts[0];
          const file = decodeURIComponent(parts.slice(1).join('/'));
          const dir = RANDO_DIR[game];
          if (!dir || !file.endsWith('.png') || !MAP_NAME_RE.test(file.slice(0, -4))) throw new Error('bad path');
          res.setHeader('Content-Type', 'image/png');
          res.end(await readFile(resolve(__dirname, 'randovania', dir, 'assets/maps', file)));
        } catch {
          res.statusCode = 404;
          res.end('not found (is the randovania/ checkout in place?)');
        }
      });
      // POST /__save-tile-overrides { game, manifest, copies } — copies each
      // { area, mapName, file } render into pipeline/tile-sources/ first, then
      // validates that every manifest image exists and writes the manifest.
      server.middlewares.use('/__save-tile-overrides', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { game, manifest, copies } = JSON.parse(body);
            const dir = RANDO_DIR[game];
            if (!dir) throw new Error('bad game id');
            if (typeof manifest !== 'object' || manifest === null) throw new Error('bad manifest');
            const copied: string[] = [];
            for (const c of copies ?? []) {
              if (!AREA_RE.test(c.area ?? '') || !FILE_RE.test(c.file ?? '') || !MAP_NAME_RE.test(c.mapName ?? '')) throw new Error(`bad copy entry ${JSON.stringify(c)}`);
              const src = resolve(__dirname, 'randovania', dir, 'assets/maps', `${c.mapName}.png`);
              if (!existsSync(src)) throw new Error(`no render ${c.mapName}.png in the randovania checkout`);
              const destDir = resolve(__dirname, 'pipeline/tile-sources', game, c.area);
              await mkdir(destDir, { recursive: true });
              await copyFile(src, resolve(destDir, c.file));
              copied.push(`tile-sources/${game}/${c.area}/${c.file}`);
            }
            const referenced = new Set<string>();
            for (const [areaId, entries] of Object.entries(manifest)) {
              if (!AREA_RE.test(areaId) || !Array.isArray(entries)) throw new Error(`bad area ${areaId}`);
              for (const o of entries) {
                if (typeof o.x !== 'number' || typeof o.y !== 'number') throw new Error(`bad cell in ${areaId}`);
                if (o.sx !== undefined && typeof o.sx !== 'number') throw new Error(`bad sx in ${areaId}`);
                if (o.sy !== undefined && typeof o.sy !== 'number') throw new Error(`bad sy in ${areaId}`);
                if (typeof o.image !== 'string' || !IMG_RE.test(o.image)) throw new Error(`bad image path in ${areaId}: ${o.image}`);
                if (!existsSync(resolve(__dirname, 'pipeline', o.image))) throw new Error(`missing source ${o.image}`);
                referenced.add(o.image);
              }
            }
            // report (never delete) committed tile-sources no longer referenced
            const orphans: string[] = [];
            const srcRoot = resolve(__dirname, 'pipeline/tile-sources', game);
            if (existsSync(srcRoot)) {
              for (const a of await readdir(srcRoot, { withFileTypes: true })) {
                if (!a.isDirectory()) continue;
                for (const f of await readdir(resolve(srcRoot, a.name))) {
                  const rel = `tile-sources/${game}/${a.name}/${f}`;
                  if (!referenced.has(rel)) orphans.push(rel);
                }
              }
            }
            const file = resolve(__dirname, 'pipeline', `tileOverrides.${game}.json`);
            await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, file, copied, orphans }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
    }
  };
}

// Dev-only endpoints for the editor's Cell tool, which curates per-cell draw
// data (kind/walls/stair dir/fill/door pips). mapOverrides.<game>.json is
// PIPELINE INPUT like landmarks — the extractor's apply_cell_overrides bakes
// it into <game>.json — but it's also hand-edited (bands, curated cells), so
// saving MERGES the staged deltas into the existing file: cells upserted by
// (x,y), removeCells kept symmetric (setting draw data drops a matching
// removal and vice versa), bands and untouched entries preserved. Written
// through prettier so the file matches `npm run format` byte-for-byte.
function mapOverridesEditor(): Plugin {
  const GAME_RE = /^[a-z0-9-]+$/;
  const KINDS = new Set(['room', 'vshaft', 'hshaft', 'diag', 'knob']);
  const PIP_RE = /^[NESW][rygbn]$/;
  const checkCell = (c: any, areaId: string) => {
    const bad = (why: string) => new Error(`bad cell in ${areaId}: ${why} (${JSON.stringify(c)})`);
    if (!Number.isInteger(c?.x) || !Number.isInteger(c?.y)) throw bad('x/y');
    if (!KINDS.has(c.k)) throw bad('k');
    if (!Number.isInteger(c.w) || c.w < 0 || c.w > 15) throw bad('w');
    if (c.d !== undefined && (c.k !== 'diag' || (c.d !== '/' && c.d !== '\\'))) throw bad('d');
    if (c.f !== undefined && (!Number.isInteger(c.f) || c.f <= 0)) throw bad('f');
    if (c.dr !== undefined && (!Array.isArray(c.dr) || c.dr.length === 0 || !c.dr.every((p: unknown) => typeof p === 'string' && PIP_RE.test(p)))) throw bad('dr');
  };
  return {
    name: 'zg-map-overrides-editor',
    apply: 'serve',
    configureServer(server) {
      // POST /__save-map-overrides { game, deltas: { areaId: { cells, removeCells } } }
      server.middlewares.use('/__save-map-overrides', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { game, deltas } = JSON.parse(body);
            if (!GAME_RE.test(game ?? '')) throw new Error('bad game id');
            if (typeof deltas !== 'object' || deltas === null) throw new Error('bad deltas');
            const file = resolve(__dirname, 'public/data', `mapOverrides.${game}.json`);
            const merged = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
            for (const [areaId, d] of Object.entries<any>(deltas)) {
              if (!GAME_RE.test(areaId)) throw new Error(`bad area id ${areaId}`);
              const area = (merged[areaId] ??= {});
              const cells: any[] = area.cells ?? [];
              const removes: [number, number][] = area.removeCells ?? [];
              const dropRemove = (x: number, y: number) => {
                const i = removes.findIndex((r) => r[0] === x && r[1] === y);
                if (i >= 0) removes.splice(i, 1);
              };
              const dropCell = (x: number, y: number) => {
                const i = cells.findIndex((e) => e.x === x && e.y === y);
                if (i >= 0) cells.splice(i, 1);
                return i;
              };
              const appended: any[] = [];
              for (const c of d.cells ?? []) {
                checkCell(c, areaId);
                // canonical key order, matching the pipeline's _cell_json
                const entry = {
                  x: c.x,
                  y: c.y,
                  k: c.k,
                  w: c.w,
                  ...(c.d !== undefined ? { d: c.d } : {}),
                  ...(c.f !== undefined ? { f: c.f } : {}),
                  ...(c.dr !== undefined ? { dr: c.dr } : {})
                };
                dropRemove(c.x, c.y);
                const i = cells.findIndex((e) => e.x === c.x && e.y === c.y);
                if (i >= 0)
                  cells[i] = entry; // in place — minimal diff
                else appended.push(entry);
              }
              appended.sort((a, b) => a.y - b.y || a.x - b.x);
              cells.push(...appended);
              for (const rc of d.removeCells ?? []) {
                if (!Array.isArray(rc) || rc.length !== 2 || !Number.isInteger(rc[0]) || !Number.isInteger(rc[1])) throw new Error(`bad removeCells entry in ${areaId}: ${JSON.stringify(rc)}`);
                dropCell(rc[0], rc[1]);
                dropRemove(rc[0], rc[1]); // no dupes
                removes.push([rc[0], rc[1]]);
              }
              if (cells.length) area.cells = cells;
              else delete area.cells;
              if (removes.length) area.removeCells = removes;
              else delete area.removeCells;
              if (!Object.keys(area).length) delete merged[areaId]; // bands etc. keep the area alive
            }
            const prettier = await import('prettier');
            const cfg = await prettier.resolveConfig(file);
            await writeFile(file, await prettier.format(JSON.stringify(merged), { ...cfg, filepath: file }));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, file }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
      // POST /__bake-map { game } — the light bake: just the game's extractor
      // (draw-data changes never touch the tiles, so composite/slice are
      // skipped; the extractor re-patches the existing base JSON in place),
      // then prettier on the game JSON. Seconds instead of ~30-60s.
      server.middlewares.use('/__bake-map', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { game } = JSON.parse(body);
            if (!GAME_RE.test(game ?? '')) throw new Error('bad game id');
            if (baking) throw new Error('a bake is already running');
            baking = true;
            try {
              const config = JSON.parse(await readFile(resolve(__dirname, 'pipeline/maps.config.json'), 'utf8'));
              if (!config[game]) throw new Error('unknown game');
              const extractor = (config[game].mapStyle ?? 'snes') === 'gba' ? 'extract_gba_maps.py' : 'extract_ingame_maps.py';
              const r = await run('python', [`pipeline/${extractor}`, game]);
              if (r.code !== 0) throw new Error(`${extractor} exited ${r.code}:\n${r.out.slice(-2000)}`);
              const dataFile = resolve(__dirname, 'public/data', `${game}.json`);
              const prettier = await import('prettier');
              const cfg = await prettier.resolveConfig(dataFile);
              await writeFile(dataFile, await prettier.format(await readFile(dataFile, 'utf8'), { ...cfg, filepath: dataFile }));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, log: `== ${extractor}\n${r.out.trim()}` }));
            } finally {
              baking = false;
            }
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), glyphSaver(), landmarkEditor(), roomStateEditor(), mapOverridesEditor()],
  base: '/'
});
