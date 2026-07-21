import { useEffect, useRef, useState } from 'react';

const GLYPHS = '█▓▒░<>/\\|=+*ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Fizzles the displayed word into `target` whenever it changes: a burst of
 * corrupted glyphs resolving left-to-right, like an X infection taking hold.
 * Returns the frame to render plus whether the scramble is live (for styling).
 * No animation on mount; instant swap under prefers-reduced-motion.
 */
export function useGlitchText(target: string, durationMs = 550): { text: string; glitching: boolean } {
  const [text, setText] = useState(target);
  const [glitching, setGlitching] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setText(target);
      return;
    }
    setGlitching(true);
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const resolved = Math.floor(p * target.length);
      let out = target.slice(0, resolved);
      for (let i = resolved; i < target.length; i++) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      setText(out);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        setGlitching(false);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      // interrupted mid-scramble (target flipped again): land cleanly
      setText(target);
      setGlitching(false);
    };
  }, [target, durationMs]);

  return { text, glitching };
}
