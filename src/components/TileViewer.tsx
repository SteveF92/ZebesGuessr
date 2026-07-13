import { useEffect, useState } from "react";

interface Props {
  tileUrl: string;
  /** fraction of the screen shown; 1.0 = whole screen */
  crop: number;
  revealed: boolean;
}

/**
 * Shows the mystery screen, cropped according to the chosen difficulty.
 * Dressed as a scanner "visor": corner brackets + a sweeping scan line
 * while the round is live.
 */
export default function TileViewer({ tileUrl, crop, revealed }: Props) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [tileUrl]);

  const scale = 1 / (revealed ? 1.0 : crop);

  return (
    <div className="tile-viewer">
      <p className="signal-label">UNKNOWN SIGNAL // WHERE IS THIS?</p>
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
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        {!revealed && loaded && <div className="tile-scanline" />}
        {!loaded && <div className="tile-loading">SCANNING…</div>}
      </div>
    </div>
  );
}
