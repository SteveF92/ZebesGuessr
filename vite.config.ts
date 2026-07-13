import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Dev-only endpoint for the in-app icon editor: POST the curated glyphs and
// they are written straight into public/data/glyphs.<game>.json, ready to
// commit. Not part of the production build.
function glyphSaver(): Plugin {
  return {
    name: "zg-glyph-saver",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save-glyphs", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { game, glyphs } = JSON.parse(body);
            if (!/^[a-z0-9-]+$/.test(game ?? "")) throw new Error("bad game id");
            const file = resolve(__dirname, "public/data", `glyphs.${game}.json`);
            await writeFile(file, JSON.stringify(glyphs, null, 2) + "\n");
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, file }));
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
