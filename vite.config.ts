import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Dev-only endpoint for the in-app icon editor: POST the curated map data and
// it is written straight into public/data/*.<game>.json, ready to commit —
// glyphs into glyphs.<game>.json and connectors into overlays.<game>.json.
// Not part of the production build.
function glyphSaver(): Plugin {
  return {
    name: "zg-glyph-saver",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save-map", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { game, glyphs, overlays } = JSON.parse(body);
            if (!/^[a-z0-9-]+$/.test(game ?? "")) throw new Error("bad game id");
            const written: string[] = [];
            const write = async (name: string, data: unknown) => {
              const file = resolve(__dirname, "public/data", `${name}.${game}.json`);
              await writeFile(file, JSON.stringify(data, null, 2) + "\n");
              written.push(file);
            };
            if (glyphs) await write("glyphs", glyphs);
            if (overlays) await write("overlays", overlays);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, files: written }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
    },
  };
}

// base is set for GitHub Pages project-site hosting (github.io/ZebesGuessr/).
// Change or remove if hosting at a root domain.
export default defineConfig({
  plugins: [react(), glyphSaver()],
  base: "/ZebesGuessr/",
});
