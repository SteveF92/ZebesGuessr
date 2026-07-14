# Pixel fonts

Both fonts are FontStruct downloads; each TTF's original `license.txt` /
`readme.txt` were renamed with the font's prefix so the two archives can share
this folder (FontStruct's terms want them redistributed together, and this
folder is deployed as-is).

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

`fonts.css` declares the `@font-face` rules and is linked from `index.html`
with a relative href on purpose — the BASE_URL placeholder gets double-prefixed
by Vite's dev-server HTML rewrite.
