import { useEffect, useState } from 'react';

interface Props {
  tileUrl: string;
  revealed: boolean;
  /** tile width / height; 1 for square SNES screens, 1.5 for GBA's 240×160 */
  aspect?: number;
}

/**
 * Shows the mystery screen. Dressed as a scanner "visor": corner brackets
 * + a sweeping scan line while the round is live.
 */
export default function TileViewer({ tileUrl, revealed, aspect = 1 }: Props) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [tileUrl]);

  return (
    <div className="tile-viewer">
      <p className="signal-label">
        UNKNOWN SIGNAL
        <br />
        WHERE IS THIS?
      </p>
      <div className="tile-frame" style={{ aspectRatio: aspect }}>
        <img src={tileUrl} alt="Where is this?" draggable={false} onLoad={() => setLoaded(true)} style={{ visibility: loaded ? 'visible' : 'hidden' }} />
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
