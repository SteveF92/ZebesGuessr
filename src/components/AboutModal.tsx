import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

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

export function AboutModal({ onClose, onUnlockCheat }: { onClose: () => void; onUnlockCheat: () => void }) {
  const [cheat, setCheat] = useState('');
  const [cheatMsg, setCheatMsg] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submitCheat(e: FormEvent) {
    e.preventDefault();
    if (cheat.trim().toUpperCase() === 'JUSTIN BAILEY') {
      onUnlockCheat();
      setCheatMsg('▶ DEBUG SCAN UNLOCKED');
    }
    setCheat('');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="About ZebesGuessr" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2>ABOUT ZEBESGUESSR</h2>
        <p>ZebesGuessr is GeoGuessr for 2D Metroid: you get a single screen from the game and pin where it is on a recreation of the in-game pause map.</p>
        <p>
          The Super Metroid maps are by <strong>Rick Bruns</strong> (<a href="https://www.snesmaps.com">snesmaps.com</a>); additional maps come from the <a href="https://www.vgmaps.com">VGMaps</a>{' '}
          community.
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
          Made by Steve Fallon, who also builds <a href="https://www.fantasycritic.games">Fantasy Critic</a>, a fantasy league game for video games. The code for this site is available on{' '}
          <a href="https://github.com/SteveF92/zebesguessr">Github</a>.
        </p>
        <form className="cheat-form" onSubmit={submitCheat}>
          <label htmlFor="cheat-input">CHEATS</label>
          <input
            id="cheat-input"
            className="cheat-input edit-name"
            value={cheat}
            onChange={(e) => {
              setCheat(e.target.value);
              setCheatMsg(null);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {cheatMsg && <span className="cheat-msg">{cheatMsg}</span>}
        </form>
      </div>
    </div>
  );
}
