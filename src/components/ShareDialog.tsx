import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { buildNow, flushBlocks, getPlayer } from '../actions';
import { compileNeedsRequest } from '../compiler/compile';
import { copyText, listHub, playLink, savedAuthor, shareOf, shareToHub, titleCard } from '../hub/hub';
import { Modal } from './Dialogs';

type Step = { kind: 'form' } | { kind: 'sharing'; what: string } | { kind: 'done'; id: string; updated: boolean } | { kind: 'error'; message: string };

/**
 * Share: puts the game in the hub, where anyone can open it, play it and make their own version,
 * and gives a link that opens it straight away. A game this browser shared before can be updated
 * (the same link) or shared again as a new one.
 */
export function ShareDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const project = useStore((s) => s.project);
  const before = shareOf(project.id);
  const [title, setTitle] = useState(project.title || '');
  const [author, setAuthor] = useState(savedAuthor());
  const [about, setAbout] = useState(project.compiled?.howToPlay?.split('\n')[0]?.slice(0, 200) ?? '');
  const [thumb, setThumb] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [copied, setCopied] = useState(false);
  // Is there a hub here to share to? (null while asking.)
  const [hubHere, setHubHere] = useState<boolean | null>(null);
  const close = () => setDialog(null);

  useEffect(() => {
    void listHub().then((h) => setHubHere(h.ok || h.reason !== 'off'));
  }, []);

  useEffect(() => {
    // The card's picture: the stage as it is now.
    void getPlayer()
      ?.snapshot()
      .then((url) => setThumb(url));
  }, []);

  const share = async (asNew: boolean) => {
    try {
      flushBlocks();
      let game = useStore.getState().project;
      if (compileNeedsRequest(game)) {
        // So it plays for everyone the moment they open it, with nothing left to build.
        setStep({ kind: 'sharing', what: 'Building your game first…' });
        try {
          game = await buildNow();
        } catch {
          game = useStore.getState().project;
        }
      }
      setStep({ kind: 'sharing', what: 'Sharing…' });
      const name = title.trim() || 'Untitled game';
      const id = await shareToHub(game, { title: name, author: author.trim(), about: about.trim(), thumb: thumb ?? titleCard(name) }, asNew ? undefined : before?.id);
      setStep({ kind: 'done', id, updated: !asNew && Boolean(before) });
    } catch (err) {
      setStep({ kind: 'error', message: (err as Error).message });
    }
  };

  if (step.kind === 'done') {
    const link = playLink(step.id);
    return (
      <Modal title="Shared!" onClose={close} className="share-modal">
        <p className="share-lead">{step.updated ? 'Your game in the hub is up to date.' : 'Your game is in the hub. Anyone with this link can play it and make their own version:'}</p>
        <div className="share-link">
          <input className="prompt-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link to your game" />
          <button
            className="prompt-button ok"
            onClick={async () => {
              setCopied(await copyText(link));
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <div className="prompt-buttons">
          <button
            onClick={() => {
              close();
              useStore.getState().openHome(true);
            }}
          >
            See the hub
          </button>
          <button className="ok" onClick={close}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  const busy = step.kind === 'sharing';
  return (
    <Modal title="Share your game" onClose={close} className="share-modal">
      <div className="share-top">
        <div className="share-thumb">{thumb ? <img src={thumb} alt="" /> : <span>{title || 'Your game'}</span>}</div>
        <div className="share-fields">
          <label className="share-field">
            <span>Name of the game</span>
            <input className="prompt-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} disabled={busy} autoFocus />
          </label>
          <label className="share-field">
            <span>Your name</span>
            <input className="prompt-input" value={author} maxLength={24} placeholder="A first name or a nickname" onChange={(e) => setAuthor(e.target.value)} disabled={busy} />
          </label>
        </div>
      </div>
      <label className="share-field">
        <span>What is it? How do you play?</span>
        <input className="prompt-input" value={about} maxLength={200} placeholder="Arrows to fly, catch the stars" onChange={(e) => setAbout(e.target.value)} disabled={busy} />
      </label>
      <p className="share-note">Everyone can see, play and remix games in the hub. Use a nickname, never your full name.</p>
      {hubHere === false && <p className="share-error">Sharing isn't switched on for this copy of Amble yet. You can still save your game to your computer (File menu) and send the file.</p>}
      {step.kind === 'error' && <p className="share-error">{step.message}</p>}
      <div className="prompt-buttons">
        {busy ? (
          <span className="share-busy">{step.what}</span>
        ) : before ? (
          <>
            <button onClick={() => void share(true)}>Share as a new game</button>
            <button className="ok" onClick={() => void share(false)} disabled={hubHere === false}>
              Update my shared game
            </button>
          </>
        ) : (
          <>
            <button onClick={close}>Cancel</button>
            <button className="ok" onClick={() => void share(true)} disabled={hubHere === false}>
              Share
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
