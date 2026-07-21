# Pixel fonts

All four fonts are FontStruct downloads; each TTF's original `license.txt` /
`readme.txt` were renamed with the font's prefix so the archives can share this
folder (FontStruct's terms want them redistributed together, and this folder is
deployed as-is).

- `super-metroid-large-alt-snes.ttf` —
  [Super Metroid (Large Alt) (SNES)](https://fontstruct.com/fontstructions/show/2383815/super-metroid-large-alt-snes)
  by Patrick H. Lauke, CC BY 3.0. Used for display text (falls back to
  "Press Start 2P" if missing).

- `super-metroid-title.ttf` —
  [Super Metroid Title](https://fontstruct.com/fontstructions/show/1940859/super-metroid-title)
  by Kitomoto. Used for the logo. **License note:** the download ships the
  FontStruct Non-Commercial EULA, but the fontstruction's own description says
  "Free for any/all use" — the attached EULA looks unintentional. Asked the
  creator to clarify (comment left 2026-07-13); if they confirm the EULA was
  intended, drop this file and the logo falls back gracefully. This project is
  strictly non-commercial either way.

- `metroid-fusion.ttf` —
  [Metroid Fusion](https://fontstruct.com/fontstructions/show/2393436)
  by Patrick H. Lauke, CC BY 3.0.

- `metroid-zero-mission.ttf` —
  [Metroid: Zero Mission](https://fontstruct.com/fontstructions/show/2394871)
  by Patrick H. Lauke, CC BY 3.0.

The two GBA faces are the `--font-game` swap: picking Fusion or Zero Mission on
the menu re-sets that variable (see the `.skin-fusion` / `.skin-zm` rules in
`src/styles.css`), so the handful of spots that name a place in the game — the
menu kicker's sector line, the reveal card's area name — render in that game's
own font. Everything else stays on `--font-display`. Neither GBA face has a `/`
glyph (nor does the SNES display face), so the kicker's `//` separator falls
back, exactly as it already did.

`fonts.css` declares the `@font-face` rules and is linked from `index.html`
with a relative href on purpose — the BASE_URL placeholder gets double-prefixed
by Vite's dev-server HTML rewrite.
