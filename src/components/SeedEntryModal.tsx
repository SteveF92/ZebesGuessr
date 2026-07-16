import { useEffect, useState } from 'react';
import { GAMES } from '../data';
import { DIFFICULTIES } from '../scoring';
import { type Seed, SEED_ALPHABET, SEED_LENGTH, decodeSeed } from '../seed';

const JUSTIN = 'JUSTIN'; // 6 chars — the same length as a seed code, on purpose
const CHEAT = 'JUSTIN BAILEY';
const CHEAT_MAX = CHEAT.length; // 13, including the space
const SPACE_AT = JUSTIN.length; // the gap sits between box 6 and 7

/**
 * NES password-screen-flavored seed entry. Type or click a 6-char seed code to
 * jump into a locked run. The field looks like it only takes 6 characters — but
 * typing exactly "JUSTIN" and pressing space extends it so the classic
 * "JUSTIN BAILEY" password still fits and unlocks the debug scan.
 */
export function SeedEntryModal({ onClose, onSubmitSeed, onUnlockCheat }: { onClose: () => void; onSubmitSeed: (seed: Seed) => void; onUnlockCheat: () => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const extended = code.includes(' '); // the JUSTIN + space easter egg opened the longer field
  const boxCount = extended ? CHEAT_MAX : SEED_LENGTH;

  function append(ch: string) {
    setMsg(null);
    setCode((cur) => {
      if (ch === ' ') {
        // Space only does anything as the JUSTIN → BAILEY bridge.
        return cur.toUpperCase() === JUSTIN ? cur + ' ' : cur;
      }
      if (!SEED_ALPHABET.includes(ch)) return cur;
      const max = cur.includes(' ') ? CHEAT_MAX : SEED_LENGTH;
      return cur.length >= max ? cur : cur + ch;
    });
  }

  function backspace() {
    setMsg(null);
    setCode((cur) => cur.slice(0, -1));
  }

  function submit() {
    if (code.trim().toUpperCase() === CHEAT) {
      onUnlockCheat();
      setMsg('▶ DEBUG SCAN UNLOCKED');
      setCode('');
      return;
    }
    const seed = decodeSeed(code);
    if (seed && GAMES[seed.gameIndex]?.available && DIFFICULTIES[seed.diffIndex]) {
      onSubmitSeed(seed);
      return;
    }
    setMsg('SEED REJECTED');
  }

  // Re-bound every render (no deps) so the handlers close over the latest `code`.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onClose();
      if (e.key === 'Enter') {
        e.preventDefault();
        return submit();
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        return backspace();
      }
      if (e.key === ' ') {
        e.preventDefault();
        return append(' ');
      }
      if (e.key.length === 1) append(e.key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal seed-modal" role="dialog" aria-modal="true" aria-label="Enter a seed" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 className="seed-title">SEED PLEASE</h2>

        <div className="seed-boxes" role="textbox" aria-label="Seed code">
          {Array.from({ length: boxCount }).map((_, i) => {
            if (extended && i === SPACE_AT) return <span key="gap" className="seed-gap" aria-hidden="true" />;
            const ch = code[i] && code[i] !== ' ' ? code[i] : '';
            return (
              <div key={i} className={`seed-box${ch ? ' filled' : ''}${i === code.length ? ' active' : ''}`}>
                {ch}
              </div>
            );
          })}
        </div>

        <p className={`seed-msg${msg ? (msg.startsWith('▶') ? ' ok' : ' err') : ''}`}>{msg ?? ' '}</p>

        <div className="seed-keys">
          {[...SEED_ALPHABET].map((ch) => (
            <button key={ch} className="seed-key" onClick={() => append(ch)}>
              {ch}
            </button>
          ))}
        </div>

        <div className="seed-controls">
          <button className="seed-key wide" onClick={() => append(' ')} title="Space">
            ␣
          </button>
          <button className="seed-key wide" onClick={backspace} title="Delete">
            DEL
          </button>
          <button className="btn primary seed-enter" onClick={submit}>
            ENTER ▶
          </button>
        </div>

        <p className="seed-hint">Enter a {SEED_LENGTH}-character seed to replay someone's exact run.</p>
      </div>
    </div>
  );
}
