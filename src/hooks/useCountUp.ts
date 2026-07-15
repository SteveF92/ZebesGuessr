import { useEffect, useRef, useState } from 'react';

/**
 * Eased count-up from 0 → `target`. Re-runs whenever `target` (or any extra
 * dep) changes. Returns the current animated value; round it at the call site.
 *
 *   const shown = Math.round(useCountUp(score, 900, [result]));
 */
export function useCountUp(target: number, duration = 1000, deps: readonly unknown[] = []): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(target * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, ...deps]);

  return value;
}
