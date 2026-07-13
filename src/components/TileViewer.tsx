import { useEffect, useState } from "react";
import { ZOOM_CROPS, ZOOM_MULTIPLIERS, MAX_SCORE } from "../scoring";

interface Props {
  tileUrl: string;
  zoomStep: number;
  onZoomOut: () => void;
  revealed: boolean;
}

/**
 * Shows the mystery screen. At zoomStep 0 only a tight center crop is
 * visible; each zoom-out reveals more of the 256x256 cell at a score cost.
 */
export default function TileViewer({ tileUrl, zoomStep, onZoomOut, revealed }: Props) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [tileUrl]);

  const crop = revealed ? 1.0 : ZOOM_CROPS[Math.min(zoomStep, ZOOM_CROPS.length - 1)];
  const scale = 1 / crop;
  const canZoomOut = !revealed && zoomStep < ZOOM_CROPS.length - 1;
  const nextMult = ZOOM_MULTIPLIERS[Math.min(zoomStep + 1, ZOOM_MULTIPLIERS.length - 1)];

  return (
    <div className="tile-viewer">
      <div className="tile-frame">
        <img
          src={tileUrl}
          alt="Where is this?"
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={{
            transform: `scale(${scale})`,
            visibility: loaded ? "visible" : "hidden",
          }}
        />
        {!loaded && <div className="tile-loading">Scanning…</div>}
      </div>
      <div className="tile-controls">
        {canZoomOut ? (
          <button className="btn" onClick={onZoomOut}>
            Zoom out (max drops to {Math.round(nextMult * MAX_SCORE)})
          </button>
        ) : (
          <span className="tile-hint">{revealed ? "" : "Fully zoomed out"}</span>
        )}
      </div>
    </div>
  );
}
