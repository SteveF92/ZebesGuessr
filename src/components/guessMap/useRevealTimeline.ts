import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { AreaData, Cell, RoundResult } from '../../types';
import { DOT_PAUSE_MS, RING2_DELAY, RING_MS, S, SCALE, SWEEP_MS, TARGET_BLINK_MS, TRACE_MS } from './constants';
import type { MapView } from './useMapViewport';

export interface RevealTimelineOptions {
  result: RoundResult | null;
  /** the area currently displayed on the map */
  area: AreaData;
  /** the jump effect cuts the map to the target's area when a round ends */
  setAreaId: (id: string) => void;
  /** current selection — drives the guess-placement pop */
  selected: { areaId: string; cell: Cell } | null;
  /** X-Ray's live horizontal stretch — the follow-tip math mirrors draw()'s */
  xScale: number;
  /* pan/zoom plumbing from useMapViewport, for the follow-the-trail panning */
  panEnabled: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<MapView | null>;
  setView: Dispatch<SetStateAction<MapView | null>>;
  clampView: (v: MapView, vw: number, vh: number) => MapView;
}

/**
 * The reveal's animation state, all staged off one clock: the revealT
 * milliseconds-since-round-end counter that draw() reads, the shake class,
 * the TARGET blink, the guess-placement pop, and the camera panning that
 * follows the dot trail. See the timeline constants for the staging.
 */
export function useRevealTimeline({ result, area, setAreaId, selected, xScale, panEnabled, scrollRef, viewRef, setView, clampView }: RevealTimelineOptions) {
  // Jump to the target's area when a round ends. A wrong-area guess holds on
  // the guessed map while the scan sweep passes — the cut to the real area IS
  // its reveal, landing with the shake once the sweep clears.
  useEffect(() => {
    if (!result) return;
    if (result.target.areaId === result.guess.areaId) {
      setAreaId(result.target.areaId);
      return;
    }
    const t = setTimeout(() => setAreaId(result.target.areaId), SWEEP_MS);
    return () => clearTimeout(t);
  }, [result]);

  // Reveal lock-on timeline: ms elapsed since the round ended. Drives the
  // traced guess→target line, the target blink-in, and the ring pulse(s) —
  // all staged off this one clock inside draw().
  const [revealT, setRevealT] = useState(0);
  // Reveal milestones on the revealT clock (see the timeline constants). The
  // sweep leads every outcome; only a same-area miss adds the dot-pause and
  // trace beats before the TARGET indicator locks on at lockMs.
  const sameAreaMiss = !!result && isFinite(result.distance) && result.distance > 0;
  const traceStartMs = SWEEP_MS + DOT_PAUSE_MS; // same-area miss: shake + trail fire here
  const lockMs = sameAreaMiss ? traceStartMs + TRACE_MS : SWEEP_MS;
  const revealTotal = lockMs + RING_MS + (result?.distance === 0 ? RING2_DELAY : 0);
  // Bad-guess feedback, staged on the same clock and always landing with the
  // TARGET lock-on: a far same-area miss (10+ cells) rattles the map as the
  // trail reaches the target; a wrong-area reveal rattles harder as it cuts to
  // the target's area. Adding the class starts the CSS animation, so the
  // keyframes carry no delays of their own.
  const shakeClass = !result || revealT < lockMs ? '' : !isFinite(result.distance) ? ' shake-wrong' : sameAreaMiss && result.distance >= 10 ? ' shake-far' : '';
  useEffect(() => {
    if (!result) {
      setRevealT(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const el = Math.min(revealTotal, t - start);
      setRevealT(el);
      if (el < revealTotal) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Guess-placement pop: a quick expanding ring on the cell just clicked.
  const [selectPulse, setSelectPulse] = useState(1);
  useEffect(() => {
    if (!selected || result) return;
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 250);
      setSelectPulse(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [selected, result]);

  // When the reveal's target sits outside the current pan view (the player
  // was zoomed in on their guess), follow the dot trail as it draws — keep the
  // tip centered until lock-on, then hand control back. Applies wherever pan is
  // live (phones always, desktop once zoomed past the fitted default).
  const followTip = useRef(false);
  useEffect(() => {
    followTip.current = false;
    if (!result || !panEnabled) return;
    const el = scrollRef.current;
    const v = viewRef.current;
    if (!el || !v) return;
    // only the same-area miss draws a trail; cross-area reveals refit anyway
    if (!isFinite(result.distance) || result.distance <= 0 || result.guess.areaId !== result.target.areaId) return;
    const { dx, dy } = area.map;
    const sx = v.tx + (result.target.cell.x + dx + 0.5) * S * SCALE * xScale * v.z;
    const sy = v.ty + (result.target.cell.y + dy + 0.5) * S * SCALE * v.z;
    const m = 12; // nearly-offscreen counts as hidden
    followTip.current = sx < m || sx > el.clientWidth - m || sy < m || sy > el.clientHeight - m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, panEnabled]);
  useEffect(() => {
    if (!followTip.current || !result || !panEnabled) return;
    const el = scrollRef.current;
    if (!el) return;
    const vw = el.clientWidth,
      vh = el.clientHeight;
    if (!vw || !vh) return;
    // mirror the trail's easing so the view tracks the drawn tip exactly
    const p = Math.max(0, Math.min(1, (revealT - traceStartMs) / TRACE_MS));
    const e = 1 - Math.pow(1 - p, 3);
    const { dx, dy } = area.map;
    const gx = (result.guess.cell.x + dx + 0.5) * S * SCALE * xScale;
    const gy = (result.guess.cell.y + dy + 0.5) * S * SCALE;
    const tx = (result.target.cell.x + dx + 0.5) * S * SCALE * xScale;
    const ty = (result.target.cell.y + dy + 0.5) * S * SCALE;
    const tipX = gx + (tx - gx) * e;
    const tipY = gy + (ty - gy) * e;
    setView((v) => (v ? clampView({ z: v.z, tx: vw / 2 - tipX * v.z, ty: vh / 2 - tipY * v.z }, vw, vh) : v));
    if (p >= 1) followTip.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealT, result, panEnabled]);

  // Fusion-style TARGET callout: flips its palette on a slow interval for as
  // long as the reveal is up (a 3fps repaint, not a rAF loop). Reduced motion
  // holds the steady dark/gold state instead.
  const [targetBlink, setTargetBlink] = useState(false);
  useEffect(() => {
    if (!result) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setTargetBlink((b) => !b), TARGET_BLINK_MS);
    return () => {
      clearInterval(id);
      setTargetBlink(false);
    };
  }, [result]);

  return { revealT, sameAreaMiss, traceStartMs, lockMs, shakeClass, targetBlink, selectPulse };
}
