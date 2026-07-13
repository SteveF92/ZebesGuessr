import { useEffect, useState } from "react";

interface Props {
  tileUrl: string;
  /** fraction of the screen shown; 1.0 = whole screen */
  crop: number;
  revealed: boolean;
}

/** Shows the mystery screen, cropped according to the chosen difficulty. */
export default function TileViewer({ tileUrl, crop, revealed }: Props) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [tileUrl]);

  const scale = 1 / (revealed ? 1.0 : crop);

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
    </div>
  );
}
