import { useEffect, useState } from 'react';
import type { Difficulty } from '../scoring';
import { maxForRating } from '../scoring';
import { GAME_URL, buildShareText } from '../share';
import { buildShareImage, downloadBlob } from '../shareImage';
import type { GameData, RoundResult } from '../types';

type Flash = 'idle' | 'done' | 'error';

export interface ShareModalProps {
  data: GameData;
  results: RoundResult[];
  total: number;
  difficulty: Difficulty;
  seedCode: string | null;
  /** Daily Mission number when the run was the daily (brands text + image). */
  dailyNum?: number | null;
  onClose: () => void;
}

/** Label for an action button that flashes a result for a beat after being pressed. */
function flashLabel(state: Flash, idle: string, done: string): string {
  return state === 'done' ? `✓ ${done}` : state === 'error' ? '✗ TRY AGAIN' : idle;
}

export function ShareModal({ data, results, total, difficulty, seedCode, dailyNum, onClose }: ShareModalProps) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [copyImgState, setCopyImgState] = useState<Flash>('idle');
  const [shareImgState, setShareImgState] = useState<Flash>('idle');
  const [copyTextState, setCopyTextState] = useState<Flash>('idle');

  const url = seedCode ? `${GAME_URL}?seed=${seedCode}` : GAME_URL;
  const text = buildShareText(data, results, total, difficulty, url, dailyNum);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Render the scorecard once when the modal opens; the preview and every image
  // action reuse that one blob.
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    const maxTotal = results.reduce((s, r) => s + maxForRating(r.rating), 0);
    buildShareImage({ data, results, total, maxTotal, difficulty, seedCode: seedCode ?? undefined, dailyNum }).then((b) => {
      if (!alive) return;
      if (!b) {
        setImgFailed(true);
        return;
      }
      objectUrl = URL.createObjectURL(b);
      setBlob(b);
      setPreviewUrl(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, results, total, difficulty, seedCode]);

  function flash(set: (s: Flash) => void, s: Flash) {
    set(s);
    setTimeout(() => set('idle'), 2000);
  }

  async function onCopyImage() {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash(setCopyImgState, 'done');
    } catch {
      flash(setCopyImgState, 'error'); // no ClipboardItem support / permission denied
    }
  }

  async function onShareImage() {
    if (!blob) return;
    const file = new File([blob], 'zebesguessr.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], url });
        return; // OS share sheet handled it — no toast needed
      }
      downloadBlob(blob, 'zebesguessr.png'); // no share sheet → save the PNG
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // user cancelled the sheet
      downloadBlob(blob, 'zebesguessr.png'); // share failed → fall back to a download
    }
    flash(setShareImgState, 'done');
  }

  async function onCopyText() {
    try {
      await navigator.clipboard.writeText(text);
      flash(setCopyTextState, 'done');
    } catch {
      flash(setCopyTextState, 'error'); // clipboard blocked (denied permission / insecure context)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" role="dialog" aria-modal="true" aria-label="Share your result" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2>SHARE YOUR RESULT</h2>

        <div className="share-preview">
          {previewUrl ? <img src={previewUrl} alt="Your run, as a shareable scorecard" /> : <div className="share-preview-empty">{imgFailed ? 'IMAGE UNAVAILABLE' : 'RENDERING…'}</div>}
        </div>
        <div className="share-actions">
          <button className="btn secondary share" onClick={onCopyImage} disabled={!blob}>
            {flashLabel(copyImgState, '⎘ COPY IMAGE', 'COPIED')}
          </button>
          <button className="btn secondary share" onClick={onShareImage} disabled={!blob}>
            {flashLabel(shareImgState, '⇪ SHARE IMAGE', 'SAVED')}
          </button>
        </div>

        <div className="share-sep" />

        <pre className="share-text">{text}</pre>
        <div className="share-actions">
          <button className="btn secondary share" onClick={onCopyText}>
            {flashLabel(copyTextState, '⎘ COPY TEXT', 'COPIED')}
          </button>
        </div>
      </div>
    </div>
  );
}
