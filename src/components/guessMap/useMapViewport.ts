import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { MAX_CELL_PX, S, SCALE } from './constants';

/** view transform applied to the canvas: displayed = translate(tx,ty) scale(z) */
export interface MapView {
  z: number;
  tx: number;
  ty: number;
}

export interface MapViewportOptions {
  /** canvas' natural CSS size (backing store is 1:1 with CSS px): cols*S*SCALE,
   *  with W0 widened by xScale while X-Ray is engaged so the fit math tracks */
  W0: number;
  H0: number;
  /** X-Ray's live horizontal stretch (GBA 3:2) — snapView bakes it into the cell width */
  xScale: number;
  /** current area — a switch refits the view */
  areaId: string;
  showTiles?: boolean;
  /** the pan/zoom canvas (pointer-capture target) */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** a click/tap that never became a pan or pinch, in client coords */
  onTap: (clientX: number, clientY: number) => void;
}

const TAP_SLOP = 10; // px of movement below which a touch counts as a tap

/**
 * The map's pan/zoom viewport. The map is a fixed viewport you can pinch /
 * wheel-zoom and drag-pan, its default zoom fitting the whole area on screen.
 * On phones this is the only way the wide maps are usable; on desktop it's an
 * optional deeper look. The desktop viewport is sized to the fitted map (see
 * `fittedSize`) so there's no wasted letterbox space around it at the default
 * zoom — the map fills it edge to edge, exactly as the plain fit-to-viewport
 * canvas used to.
 * Editing (a desktop-only dev mode) rides the same viewport — a click that
 * barely moves is an edit-tool action, a drag pans, the wheel zooms — so the
 * curator can zoom in to judge room difficulty. Every edit tool is
 * click-to-place (two discrete clicks for connectors/name rectangles, never a
 * drag), so nothing collides with the pan gesture.
 */
export function useMapViewport({ W0, H0, xScale, areaId, showTiles, canvasRef, onTap }: MapViewportOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null); // measured region the desktop viewport is fitted into
  const [smallScreen, setSmallScreen] = useState(false);
  const [hoverCapable, setHoverCapable] = useState(false); // a mouse (not touch): drives hover preview
  useEffect(() => {
    const small = window.matchMedia('(max-width: 800px)');
    const hover = window.matchMedia('(hover: hover)');
    const update = () => {
      setSmallScreen(small.matches);
      setHoverCapable(hover.matches);
    };
    update();
    small.addEventListener('change', update);
    hover.addEventListener('change', update);
    return () => {
      small.removeEventListener('change', update);
      hover.removeEventListener('change', update);
    };
  }, []);
  const panEnabled = true; // play and editing both use the pan/zoom viewport
  const desktopPan = panEnabled && !smallScreen;

  // Desktop: the pan viewport (.map-scroll) is sized to the fitted map so no
  // letterbox space surrounds it. `avail` is the region it's fitted into
  // (measured); `fittedSize` is the resulting content-box size. Phones don't
  // use this — their viewport is a CSS full-width / clamped-height window.
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  const fittedSize = useMemo(() => {
    if (!desktopPan || !avail) return null;
    const B = 2; // .map-scroll's 1px border, both sides — leave room for it
    const z = Math.min((avail.w - B) / W0, (avail.h - B) / H0);
    if (!isFinite(z) || z <= 0) return null;
    return { w: Math.round(W0 * z), h: Math.round(H0 * z) };
  }, [desktopPan, avail, W0, H0]);

  const [view, setView] = useState<MapView | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view; // latest view for pointer handlers (no re-binding)
  // live gesture bookkeeping (refs so pointer handlers don't need re-binding).
  // pinch* capture the reference spacing/zoom at the moment the 2nd finger lands.
  const gesture = useRef<{ pointers: Map<number, { x: number; y: number }>; moved: number; multi: boolean; pinchDist: number; pinchZ: number }>({
    pointers: new Map(),
    moved: 0,
    multi: false,
    pinchDist: 0,
    pinchZ: 1
  });

  /** keep the scaled map inside the viewport (centered when smaller than it) */
  function clampView(v: MapView, vw: number, vh: number): MapView {
    const sw = W0 * v.z,
      sh = H0 * v.z;
    const tx = sw <= vw ? (vw - sw) / 2 : Math.min(0, Math.max(vw - sw, v.tx));
    const ty = sh <= vh ? (vh - sh) / 2 : Math.min(0, Math.max(vh - sh, v.ty));
    return { z: v.z, tx, ty };
  }
  /** zoom bounds for the current viewport: out to whole-map, in to MAX_CELL_PX cells */
  function zoomBounds(vw: number, vh: number) {
    const fitZ = Math.min(vw / W0, vh / H0);
    return { fitZ, maxZ: Math.max(fitZ, MAX_CELL_PX / (S * SCALE)) };
  }
  /** reset to whole-area-visible, centered */
  function fitView() {
    const el = scrollRef.current;
    if (!el) return;
    const vw = el.clientWidth,
      vh = el.clientHeight;
    if (!vw || !vh) return;
    const { fitZ } = zoomBounds(vw, vh);
    setView(clampView({ z: fitZ, tx: 0, ty: 0 }, vw, vh));
  }
  /** zoom by a factor around a focal point (viewport-local px) */
  function zoomAround(factor: number, fx: number, fy: number) {
    const el = scrollRef.current;
    if (!el) return;
    const vw = el.clientWidth,
      vh = el.clientHeight;
    const { fitZ, maxZ } = zoomBounds(vw, vh);
    setView((v) => {
      if (!v) return v;
      const z = Math.min(maxZ, Math.max(fitZ, v.z * factor));
      const k = z / v.z;
      return clampView({ z, tx: fx - (fx - v.tx) * k, ty: fy - (fy - v.ty) * k }, vw, vh);
    });
  }

  // latest zoomAround for the native wheel listener (avoids re-binding on pan)
  const zoomAroundRef = useRef(zoomAround);
  zoomAroundRef.current = zoomAround;
  // Desktop: the mouse wheel zooms toward the cursor. A native, non-passive
  // listener so we can preventDefault the page scroll; phones pinch instead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !desktopPan) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAroundRef.current(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [desktopPan]);

  // Desktop: measure the region the viewport is fitted into (the flex box that
  // wraps the map). Re-measured on resize; unused on phones (display:contents
  // there, so the wrapper has no box of its own).
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => setAvail({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panEnabled]);

  // (re)fit whenever pan turns on, the area changes, or the viewport resizes
  // (orientation flip). useLayoutEffect + synchronous fit avoids a first-paint
  // flash of the full-size canvas.
  useLayoutEffect(() => {
    if (!panEnabled) {
      setView(null);
      return;
    }
    fitView();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitView());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panEnabled, areaId, showTiles, fittedSize?.w, fittedSize?.h]);

  /** The view quantized to whole device pixels per cell (plus a rounded pan
   *  offset), so every cell edge lands exactly on a device pixel. Fractional
   *  edges antialias, and adjacent cells' partial coverage lets the layer
   *  underneath bleed through as hairline seams between tiles. Rendering,
   *  hit-testing (cellFromPoint) and the callout anchor must all use these
   *  SAME numbers — mixing snapped and unsnapped math drifts by up to half a
   *  device px per column across the map. */
  function snapView(v: MapView) {
    const dpr = window.devicePixelRatio || 1;
    return {
      dpr,
      cw: Math.max(1, Math.round(v.z * SCALE * xScale * S * dpr)), // device px per cell
      ch: Math.max(1, Math.round(v.z * SCALE * S * dpr)),
      tx: Math.round(v.tx * dpr),
      ty: Math.round(v.ty * dpr)
    };
  }

  /** distance between the two active pointers (pinch only) */
  function pinchSpacing(g: (typeof gesture)['current']) {
    const [a, b] = [...g.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function onPointerDown(e: React.PointerEvent) {
    if (!panEnabled) return;
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer to capture (e.g. synthetic event) */
    }
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 1) {
      g.moved = 0;
      g.multi = false;
    } else if (g.pointers.size === 2) {
      g.multi = true; // a second finger touched: this gesture is a pinch, never a tap
      g.pinchDist = pinchSpacing(g); // reference spacing + zoom at pinch start
      g.pinchZ = viewRef.current?.z ?? 1;
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!panEnabled) return;
    const g = gesture.current;
    const p = g.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (g.pointers.size >= 2) {
      // pinch: zoom to (start zoom × spacing ratio) around the current midpoint
      const pts = [...g.pointers.values()];
      const el = scrollRef.current;
      if (!el || !g.pinchDist) return;
      const rect = el.getBoundingClientRect();
      const fx = (pts[0].x + pts[1].x) / 2 - rect.left;
      const fy = (pts[0].y + pts[1].y) / 2 - rect.top;
      const vw = el.clientWidth,
        vh = el.clientHeight;
      const { fitZ, maxZ } = zoomBounds(vw, vh);
      const z = Math.min(maxZ, Math.max(fitZ, (g.pinchZ * pinchSpacing(g)) / g.pinchDist));
      setView((v) => {
        if (!v) return v;
        const k = z / v.z;
        return clampView({ z, tx: fx - (fx - v.tx) * k, ty: fy - (fy - v.ty) * k }, vw, vh);
      });
    } else {
      // one finger: pan
      g.moved += Math.hypot(dx, dy);
      const el = scrollRef.current;
      if (!el) return;
      const vw = el.clientWidth,
        vh = el.clientHeight;
      setView((v) => (v ? clampView({ z: v.z, tx: v.tx + dx, ty: v.ty + dy }, vw, vh) : v));
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!panEnabled) return;
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    // a lone finger that barely moved (and never became a pinch) is a tap —
    // the caller decides what a tap means (a guess, or an edit-tool action).
    if (g.pointers.size === 0 && !g.multi && g.moved < TAP_SLOP) {
      onTap(e.clientX, e.clientY);
    }
    if (g.pointers.size === 0) g.multi = false;
  }

  return {
    view,
    setView,
    viewRef,
    clampView,
    snapView,
    scrollRef,
    outerRef,
    fittedSize,
    fitView,
    zoomAround,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    panEnabled,
    hoverCapable
  };
}
