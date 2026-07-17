import { useEffect, useState } from 'react';

/**
 * Types `text` out character-by-character once `active` goes true, like a
 * Prime scan log filling in. Returns the visible prefix. Shows the full text
 * immediately under prefers-reduced-motion.
 */
export function useTypewriter(text: string, active: boolean, msPerChar = 18, startDelay = 500): string {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
    if (!active || !text) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text.length);
      return;
    }
    let raf = 0;
    const start = performance.now() + startDelay;
    const step = (now: number) => {
      const n = Math.min(text.length, Math.max(0, Math.floor((now - start) / msPerChar)));
      setShown(n);
      if (n < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, active, msPerChar, startDelay]);

  return text.slice(0, shown);
}
