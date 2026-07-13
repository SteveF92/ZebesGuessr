import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is set for GitHub Pages project-site hosting (github.io/ZebesGuessr/).
// Change or remove if hosting at a root domain.
export default defineConfig({
  plugins: [react()],
  base: "/ZebesGuessr/",
});
