import { useEffect, useState } from 'react';
import { GAMES } from '../data';
import { DIFFICULTIES } from '../scoring';
import { type Seed, SEED_ALPHABET, SEED_LENGTH, decodeSeed } from '../seed';

/** The two famous Metroid passwords, minus their spaces — the field strips
 *  non-alphabet chars, so the space types away on its own. JUSTINBAILEY is a
 *  full 12 chars (one seed's worth); NARPASSWORD is 11, so decodeSeed (which
 *  needs exactly 12) can never mistake it for a seed. */
const CHEATS: Record<string, 'jb' | 'narpas'> = {
  JUSTINBAILEY: 'jb',
  NARPASSWORD: 'narpas'
};
/** Confirmation line shown when a cheat lands, keyed by which. */
const CHEAT_MSG: Record<'jb' | 'narpas', string> = {
  jb: '▶ VISORS ONLINE',
  narpas: '▶ SEED FORGE UNLOCKED'
};
/** The cosmetic gap splits the 12-box field into two groups of six. */
const SPACE_AT = SEED_LENGTH / 2;

/**
 * NES password-screen-flavored seed entry. Type or click a 12-char seed code to
 * jump into a locked run — the field reads as two groups of six. Typing a
 * classic Metroid password instead grants an unlockable: JUSTINBAILEY hands over
 * both visors, NARPASSWORD unlocks Create Seed.
 */
export function SeedEntryModal({ onClose, onSubmitSeed, onUnlockCheat }: { onClose: () => void; onSubmitSeed: (seed: Seed) => void; onUnlockCheat: (which: 'jb' | 'narpas') => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function append(ch: string) {
    setMsg(null);
    setCode((cur) => {
      if (!SEED_ALPHABET.includes(ch)) return cur;
      return cur.length >= SEED_LENGTH ? cur : cur + ch;
    });
  }

  function backspace() {
    setMsg(null);
    setCode((cur) => cur.slice(0, -1));
  }

  function submit() {
    const cheat = CHEATS[code.toUpperCase()];
    if (cheat) {
      onUnlockCheat(cheat);
      setMsg(CHEAT_MSG[cheat]);
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
          {Array.from({ length: SEED_LENGTH }).flatMap((_, i) => {
            const box = (
              <div key={i} className={`seed-box${code[i] ? ' filled' : ''}${i === code.length ? ' active' : ''}`}>
                {code[i] ?? ''}
              </div>
            );
            return i === SPACE_AT ? [<span key="gap" className="seed-gap" aria-hidden="true" />, box] : [box];
          })}
        </div>

        <p className={`seed-msg${msg ? (msg.startsWith('▶') ? ' ok' : ' err') : ''}`}>{msg ?? ' '}</p>

        <div className="seed-keys">
          {[...SEED_ALPHABET].map((ch) => (
            <button key={ch} className="seed-key" onClick={() => append(ch)}>
              {ch}
            </button>
          ))}
        </div>

        <div className="seed-controls">
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
