import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, readdir, writeFile } from 'node:fs/promises';
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
  const SPRITE_RE = /^[a-z0-9-]+\.png$/;
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
          const spriteDir = resolve(__dirname, 'pipeline/sprites', game);
          const sprites = existsSync(spriteDir) ? (await readdir(spriteDir)).filter((f) => SPRITE_RE.test(f)).sort() : [];
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
      // GET /__landmark-sprite/<game>/<file>.png
      server.middlewares.use('/__landmark-sprite', async (req, res) => {
        try {
          const [game, file] = (req.url ?? '').replace(/^\//, '').split('?')[0].split('/');
          if (!GAME_RE.test(game) || !SPRITE_RE.test(file ?? '')) throw new Error('bad path');
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
      // Takes ~30-60s; one bake at a time.
      let baking = false;
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

export default defineConfig({
  plugins: [react(), glyphSaver(), landmarkEditor()],
  base: '/'
});
