# ZebesGuessr flare — port notes

Drop-in files for the real repo. Copy each `port/…` file over the matching
path in your project root. **No changes to `GuessMap.tsx`, `data.ts`,
`types.ts`, `main.tsx`, or the Python pipeline** — the pause-map is untouched.

## Files to copy

| Copy this            | To this                     | Change |
|----------------------|-----------------------------|--------|
| `port/index.html`    | `index.html`                | adds the Google-Fonts `<link>` (Press Start 2P, Chakra Petch, JetBrains Mono) |
| `port/src/styles.css`| `src/styles.css`            | full restyle — new palette vars, backdrop FX, HUD, visor, summary bars, keyframes |
| `port/src/App.tsx`   | `src/App.tsx`               | restructured menu / HUD / reveal / summary markup; count-ups; rank & reveal flavor; backdrop FX. **All game logic unchanged.** |
| `port/src/components/TileViewer.tsx` | `src/components/TileViewer.tsx` | scanner "visor" frame: corner brackets + sweep line while guessing |
| `port/src/scoring.ts`| `src/scoring.ts`            | **additive only** — adds `rankFlavor()` and `revealFlavor()`; every existing export is byte-for-byte the same |
| `port/src/hooks/useCountUp.ts` | `src/hooks/useCountUp.ts` | **new file** — eased 0→N count-up hook used by the reveal score and summary total |

No new npm dependencies. Fonts load from Google Fonts over the network (same
approach as the rest of the app's assets); to self-host, download the three
families and swap the `<link>` for an `@font-face` block — the CSS references
them only through the `--font-*` variables at the top of `styles.css`.

## What the flare adds

- **Title / menu** — animated starfield, CRT scanlines + flicker, a sweep bar,
  pulsing glow on the wordmark, a "Chozo Planetary Archive" kicker, restyled
  difficulty cards ("suit loadout") and game list ("standby"), rounded
  personal-best chip.
- **HUD** — round-progress pips (past / current-pulsing / future), mono score
  readout. `debug` + `icons` dev toggles preserved.
- **Mystery screen** — framed as a scanner visor with cyan corner brackets and
  a scan line that sweeps while the round is live.
- **Reveal** — eased score count-up + a distance-based flavor line.
- **Summary** — total count-up, rank + lore flavor, per-round score bars,
  new-best banner.
- **Motion respects `prefers-reduced-motion`** (see the media query in
  `styles.css`) — looping animations switch off, layout is unaffected.

## Optional: reveal "lock-on" ring on the map

This is the one bit that lives inside the canvas, so it's left out of the
drop-in to keep `GuessMap.tsx` as-is. If you want the target to pulse a
shrinking ring when a round ends, add these two small pieces to
`src/components/GuessMap.tsx`:

1. State + a short animation, near the other hooks:

```ts
const [revealPulse, setRevealPulse] = useState(0);
useEffect(() => {
  if (!result) { setRevealPulse(0); return; }
  let raf = 0;
  const start = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / 650);
    setRevealPulse(p);
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}, [result]);
```

2. Inside `draw()`, in the `} else {` branch (the one that runs when `result`
   is set), right after the target `box(...)` call:

```ts
if (result.target.areaId === area.id) {
  const cx = (result.target.cell.x + dx + 0.5) * S;
  const cy = (result.target.cell.y + dy + 0.5) * S;
  ctx.strokeStyle = COL.target;
  ctx.globalAlpha = 1 - revealPulse;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, S * (0.6 + revealPulse * 1.6), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
```

`draw` already re-runs on every render (`useEffect(draw)`), so the `setRevealPulse`
updates repaint it automatically. Nothing else in the map changes.
