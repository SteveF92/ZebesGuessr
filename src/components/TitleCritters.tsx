import { useEffect, useRef, useState } from 'react';

/** Occasional title-screen fauna drifting behind the menu panels: a Metroid
 *  wandering across the starfield, or Samus's ship zooming past. Spawns are
 *  randomly timed; the wrapper cross-fades out (like the haze) when the menu
 *  is left, and in-flight critters simply finish unseen. Reduced-motion users
 *  get none at all. */

interface Critter {
  id: number;
  src: string;
  born: number; // performance.now() at spawn
  dur: number; // ms for the base path to cross
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  scale: number;
  /** wander terms: horizontal sway + two stacked vertical sines (a slow deep
   *  bob and a faster shallow jitter). All zero for the ship's straight run. */
  ax: number;
  wx: number;
  px: number;
  ay1: number;
  wy1: number;
  py1: number;
  ay2: number;
  wy2: number;
  py2: number;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const phase = () => rand(0, Math.PI * 2);

let nextId = 1;

function spawn(): Critter {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ltr = Math.random() < 0.5;
  if (Math.random() < 0.3) {
    // ship: fast straight strafe with a slight diagonal
    const margin = 200;
    const y0 = vh * rand(0.08, 0.55);
    return {
      id: nextId++,
      src: `${import.meta.env.BASE_URL}assets/ship-${ltr ? 'right' : 'left'}.gif`,
      born: performance.now(),
      dur: rand(2200, 3800),
      x0: ltr ? -margin : vw + margin,
      x1: ltr ? vw + margin : -margin,
      y0,
      y1: y0 + vh * rand(-0.12, 0.12),
      scale: 2,
      ax: 0,
      wx: 0,
      px: 0,
      ay1: 0,
      wy1: 0,
      py1: 0,
      ay2: 0,
      wy2: 0,
      py2: 0
    };
  }
  // metroid: slow crossing, wander layered on top
  const scale = Math.random() < 0.5 ? 2 : 3;
  const ax = rand(40, 100);
  const margin = 40 * scale + ax + 24; // sway can never poke it back on-screen at spawn
  const y0 = vh * rand(0.06, 0.55);
  return {
    id: nextId++,
    src: `${import.meta.env.BASE_URL}assets/metroid.gif`,
    born: performance.now(),
    dur: rand(18000, 32000),
    x0: ltr ? -margin : vw + margin,
    x1: ltr ? vw + margin : -margin,
    y0,
    y1: y0 + vh * rand(-0.2, 0.25),
    scale,
    ax,
    wx: rand(0.2, 0.4),
    px: phase(),
    ay1: rand(30, 70),
    wy1: rand(0.25, 0.5),
    py1: phase(),
    ay2: rand(8, 22),
    wy2: rand(0.9, 1.6),
    py2: phase()
  };
}

/** Position at `now`, or null once the base path has fully crossed. */
function transformAt(c: Critter, now: number): string | null {
  const t = (now - c.born) / c.dur;
  if (t >= 1) return null;
  const s = (now - c.born) / 1000;
  const x = c.x0 + (c.x1 - c.x0) * t + c.ax * Math.sin(c.wx * s + c.px);
  const y = c.y0 + (c.y1 - c.y0) * t + c.ay1 * Math.sin(c.wy1 * s + c.py1) + c.ay2 * Math.sin(c.wy2 * s + c.py2);
  return `translate3d(${x}px, ${y}px, 0) scale(${c.scale})`;
}

export function TitleCritters({ active }: { active: boolean }) {
  const [critters, setCritters] = useState<Critter[]>([]);
  const nodes = useRef(new Map<number, HTMLImageElement>());

  // spawner: one critter every so often while the menu is up
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer: number;
    const schedule = (first: boolean) => {
      timer = window.setTimeout(
        () => {
          setCritters((cs) => [...cs, spawn()]);
          schedule(false);
        },
        first ? rand(2500, 6000) : rand(9000, 22000)
      );
    };
    schedule(true);
    return () => clearTimeout(timer);
  }, [active]);

  // flight loop: write transforms straight to the DOM, drop finished critters
  useEffect(() => {
    if (critters.length === 0) return;
    let raf = requestAnimationFrame(function step(now: number) {
      const done: number[] = [];
      for (const c of critters) {
        const tr = transformAt(c, now);
        if (tr === null) {
          done.push(c.id);
          continue;
        }
        nodes.current.get(c.id)?.style.setProperty('transform', tr);
      }
      if (done.length) setCritters((cs) => cs.filter((c) => !done.includes(c.id)));
      else raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [critters]);

  return (
    <div className={`fx-critters${active ? ' on' : ''}`}>
      {critters.map((c) => (
        <img
          key={c.id}
          src={c.src}
          alt=""
          ref={(el) => {
            if (el) nodes.current.set(c.id, el);
            else nodes.current.delete(c.id);
          }}
          style={{ transform: transformAt(c, performance.now()) ?? undefined }}
        />
      ))}
    </div>
  );
}
