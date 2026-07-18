import { useEffect } from 'react';

export function Credits({ onAbout }: { onAbout: () => void }) {
  return (
    <footer className="credits">
      <p>
        Made by Steve Fallon, creator of <a href="https://www.fantasycritic.games">fantasycritic.games</a>.{' '}
        <button className="link-btn" onClick={onAbout}>
          About
        </button>
      </p>
      <p>Metroid and all game imagery © Nintendo. Not affiliated with Nintendo.</p>
      <p>
        This site uses maps from <a href="https://www.snesmaps.com">snesmaps.com</a> and the <a href="https://www.vgmaps.com">VGMaps</a> community.
      </p>
    </footer>
  );
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="About ZebesGuessr" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2>ABOUT ZEBESGUESSR</h2>
        <p>ZebesGuessr is GeoGuessr for 2D Metroid: you are shown a single screen from a game and your job is to identify where it is on a recreation of the in-game pause map.</p>
        <p>
          The Super Metroid maps are by <strong>Rick Bruns</strong> (<a href="https://www.snesmaps.com">snesmaps.com</a>). The Metroid Fusion maps are by <strong>zerofighter</strong> and{' '}
          <strong>rocktyt</strong>, with in-game map rips by <strong>Narasumas</strong>, all via <a href="https://www.vgmaps.com">VGMaps</a>. Additional maps come from the{' '}
          <a href="https://www.vgmaps.com">VGMaps</a> community.
        </p>
        <p>
          Room names come from the fan communities that mapped these games out: Metroid Fusion's are from the <a href="https://randovania.org">Randovania</a> project and the Fusion community, and
          Super Metroid's are from <a href="https://maprando.com">Map Rando</a> and the Super Metroid community.
        </p>
        <p>
          Metroid and all game imagery are © Nintendo. This is a non-commercial fan project and is not affiliated with or endorsed by Nintendo. If you are a rights holder and want something removed,
          open an issue and I'll remove it.
        </p>
        <p>
          Pixel fonts: <a href="https://fontstruct.com/fontstructions/show/1940859/super-metroid-title">Super Metroid Title</a> by Kitomoto and{' '}
          <a href="https://fontstruct.com/fontstructions/show/2383815/super-metroid-large-alt-snes">Super Metroid (Large Alt)</a> by Patrick H. Lauke (CC BY 3.0), both via FontStruct.
        </p>
        <p>
          Made by Steve Fallon, who also builds <a href="https://www.fantasycritic.games">Fantasy Critic</a> — "Fantasy Football for Video Games". The code for this site is available on{' '}
          <a href="https://github.com/SteveF92/zebesguessr">Github</a>.
        </p>
        <p>
          I built this because (A), I'm a huge Metroid fan and I thought it would be neat; and (B) I wanted to experiment with Claude Code. I'm not hiding it, it was immensely useful for a project
          like this!
        </p>
      </div>
    </div>
  );
}
