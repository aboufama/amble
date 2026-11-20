import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { getPlayer, pickSavedProject, startGame } from '../actions';
import type { Dial } from '../blocks/spec';
import { resolveTransport } from '../compiler/openai';
import { DEFAULT_DIAL } from '../project/controls';
import { EXAMPLES, blankProject, loadExample, type Example } from '../project/examples';
import { ideaProject } from '../project/idea';
import type { Project } from '../project/types';
import { confirmUser } from '../prompt';
import { GameDial } from './GameDial';
import { AmbleMark, BackIcon, BlocksTabIcon, CopyIcon, FileIcon } from './icons';
import { StyleKnob } from './StyleKnob';
import { copyText, listHub, myShares, openHubProject, playLink, removeFromHub, reportHub, thumbUrl, type HubEntry, type HubList } from '../hub/hub';

const HOME_SEEN = 'amble:start';

/** Has this browser seen Home? (It shows by itself once, on the first visit.) */
export function homeSeen(): boolean {
  try {
    return localStorage.getItem(HOME_SEEN) === 'seen';
  } catch {
    return true;
  }
}

function markHomeSeen(): void {
  try {
    localStorage.setItem(HOME_SEEN, 'seen');
  } catch {
    /* ignore */
  }
}

/** Home's address. The editor's is the page without it. */
const HOME_HASH = '#home';

/** Is the page at Home's address? (A page loaded there starts on Home.) */
export function atHome(): boolean {
  return window.location.hash === HOME_HASH;
}

/**
 * Keeps Home and the address in step, once the page has loaded. Opening Home from the editor adds
 * a history entry (#home), so the browser's Back button returns to the editor and Forward comes
 * back. Leaving Home any other way steps back over that entry, so Back never lands on a Home that
 * was left. The first visit starts on Home with nothing under it to go back to: only the address changes.
 */
export function useHomeAddress(loaded: boolean): void {
  useEffect(() => {
    if (!loaded) return;
    /** Stepping back over Home's entry: history.back() lands a moment later, with a popstate. */
    let leaving = false;
    const toAddress = () => {
      if (leaving) return;
      const { home, homeFromEditor } = useStore.getState();
      if (home && !atHome()) {
        if (homeFromEditor) window.history.pushState({ ambleHome: true }, '', HOME_HASH);
        else window.history.replaceState(null, '', HOME_HASH);
      } else if (!home && atHome()) {
        // The entry under one of ours is the editor's. (A page opened at #home has none: the address loses its #home.)
        if ((window.history.state as { ambleHome?: boolean } | null)?.ambleHome && window.history.length > 1) {
          leaving = true;
          window.history.back();
        } else window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    const fromAddress = () => {
      if (leaving) {
        // Our own step back has landed. (Home may have been opened again meanwhile.)
        leaving = false;
        toAddress();
        return;
      }
      const s = useStore.getState();
      if (atHome() && !s.home) s.openHome(true);
      else if (!atHome() && s.home) s.closeHome();
    };
    toAddress();
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.home !== prev.home) toAddress();
    });
    window.addEventListener('popstate', fromAddress);
    window.addEventListener('hashchange', fromAddress);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', fromAddress);
      window.removeEventListener('hashchange', fromAddress);
    };
  }, [loaded]);
}

/**
 * Home: a page of its own, in place of the editor (which stays as it is underneath). Say what you
 * want to make, set the dial (how much of the game Amble makes) and the art style, and Amble makes
 * the game; or open a demo, a saved game, or an empty project. It shows by itself on the first
 * visit, and from the logo in the editor's top bar and File > New game.
 */
export function HomePage() {
  const closeHome = useStore((s) => s.closeHome);
  const setDialog = useStore((s) => s.setDialog);
  const setProject = useStore((s) => s.setProject);
  const notify = useStore((s) => s.notify);
  // Opened from the editor, there may be a game to lose: ask before replacing it.
  const fromEditor = useStore((s) => s.homeFromEditor);
  const [idea, setIdea] = useState('');
  const [dial, setDial] = useState<Dial>(DEFAULT_DIAL);
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState(false);
  // Can words be built here? (A key in Settings, the site's own key, or a ChatGPT sign-in.) Unknown at first.
  const [account, setAccount] = useState<boolean | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // The hub: games players shared (null while it loads).
  const [hub, setHub] = useState<HubList | null>(null);
  const [mine, setMine] = useState(() => myShares());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    void listHub().then(setHub);
  }, []);

  useEffect(() => {
    markHomeSeen();
    // Ready to type (on a phone that would raise the keyboard over the page: there, a tap does it).
    if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus();
    resolveTransport(useStore.getState().settings).then(
      (t) => setAccount(Boolean(t)),
      () => setAccount(false),
    );
  }, []);

  useEffect(() => {
    // The editor is out of sight: a game playing on its stage stops. A build carries on under Home;
    // when it is done its game would start unseen, so that one stops too, and waits for the flag.
    const stop = () => {
      const s = useStore.getState();
      if (s.home && (s.run.state === 'running' || s.run.state === 'paused')) getPlayer()?.stop();
    };
    stop();
    return useStore.subscribe((s, prev) => {
      if (s.run.state !== prev.run.state) stop();
    });
  }, []);

  useEffect(() => {
    // Escape goes back to the editor, unless a dialog over Home takes it (the dialog closes, Home stays).
    let covered = false;
    const before = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useStore.getState();
      covered = Boolean(s.dialog || s.prompt);
    };
    const after = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !covered) closeHome();
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', after);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', after);
    };
  }, [closeHome]);

  const replace = async (make: () => Promise<Project> | Project, play: boolean) => {
    if (busy) return;
    if (fromEditor && !(await confirmUser({ title: 'Replace Project', message: 'Replace the current project? Save it to your computer first if you want to keep it.', confirmLabel: 'Replace', danger: true }))) return;
    setBusy(true);
    try {
      setProject(await make());
      closeHome();
      // The flag builds what needs building (a whole game, for an idea), then plays.
      if (play) window.setTimeout(startGame, 50);
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const words = idea.trim();
  // On "My blocks" Amble makes nothing: the sentence goes on the stage, and the blocks are the game.
  const makes = dial > 0;
  const makeGame = () => {
    if (!words) return;
    if (makes && account === false) {
      // Nothing to build with here (a copy of Amble with no key of its own): Settings is where a key goes.
      notify('Making a game from an idea needs an OpenAI API key here. Add one in Settings, then try again.', 'error');
      setDialog('settings');
      return;
    }
    void replace(() => ideaProject(words, dial, style), makes);
  };
  const openDemo = (ex: Example) => void replace(() => loadExample(ex), Boolean(ex.prebuilt));
  const openHub = (entry: HubEntry) => void replace(() => openHubProject(entry.id), true);
  const copyLink = async (id: string) => {
    if (await copyText(playLink(id))) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } else notify(playLink(id), 'info');
  };
  const remove = async (entry: HubEntry) => {
    if (!(await confirmUser({ title: 'Take it out of the hub', message: `Take “${entry.title}” out of the hub? Its link stops working. The game stays in your editor if it's open there.`, confirmLabel: 'Take it out', danger: true }))) return;
    try {
      await removeFromHub(entry.id);
      setMine(myShares());
      setHub((h) => (h?.ok ? { ok: true, projects: h.projects.filter((p) => p.id !== entry.id) } : h));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const report = async (entry: HubEntry) => {
    if (!(await confirmUser({ title: 'Report a game', message: `Report “${entry.title}” as something that shouldn't be in the hub (mean, scary, or someone's private details)? Games a few people report are hidden.`, confirmLabel: 'Report it', danger: true }))) return;
    try {
      await reportHub(entry.id);
      notify('Thanks. Someone will take a look.', 'info');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const openSaved = async () => {
    try {
      const project = await pickSavedProject();
      if (project) await replace(() => project, false);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <section className="home" aria-label="Home" tabIndex={-1}>
      <header className="home-bar">
        <h1 className="home-brand">
          <AmbleMark size={28} />
          <span className="logo">amble</span>
        </h1>
        <button className="menu-btn" onClick={closeHome}>
          <BackIcon size={18} />
          <span>Back to editor</span>
        </button>
      </header>
      <div className="home-page">
        <div className="home-make">
          <label className="home-label" htmlFor="home-idea">
            What do you want to make?
          </label>
          <textarea
            id="home-idea"
            ref={input}
            value={idea}
            rows={2}
            maxLength={600}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                makeGame();
              }
            }}
          />
          <div className="home-knobs">
            <div className="home-knob">
              <span className="home-knob-label">Size</span>
              <GameDial look="page" value={dial} onChange={setDial} />
            </div>
            <div className="home-knob">
              <span className="home-knob-label">Art style</span>
              <StyleKnob look="page" value={style} onChange={setStyle} />
            </div>
            <button className="btn primary home-make-button" disabled={!words || busy} onClick={makeGame}>
              Make my game
            </button>
          </div>
          {makes && account === false && <p className="home-note">Needs an OpenAI API key (Settings).</p>}
        </div>

        <h2 className="home-heading">The hub</h2>
        <p className="home-hub-lead">Open a game to play it, change it, and make it yours. Press <b>Share</b> in the editor to put your own game here.</p>

        <h3 className="home-subheading">From Amble</h3>
        <div className="home-demos">
          {EXAMPLES.map((ex) => (
            <div key={ex.id} className="home-demo hub-card">
              <button className="hub-open" onClick={() => openDemo(ex)} disabled={busy} aria-label={`Demo: ${ex.title}`}>
                <span className="home-thumb" data-demo={ex.id}>
                  <img src={`demos/${ex.id}.jpg`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
                </span>
                <span className="home-demo-title">{ex.title}</span>
                <span className="home-demo-desc">{ex.description}</span>
              </button>
              <div className="hub-actions">
                <button className="hub-action" onClick={() => void copyLink(`demo-${ex.id}`)}>
                  <CopyIcon size={13} /> {copiedId === `demo-${ex.id}` ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <h3 className="home-subheading">Shared by players</h3>
        {hub === null ? (
          <p className="home-hub-empty">Looking for games…</p>
        ) : !hub.ok ? (
          <p className="home-hub-empty">{hub.reason === 'off' ? "Sharing isn't switched on for this copy of Amble yet." : "The hub can't be reached right now."}</p>
        ) : hub.projects.length === 0 ? (
          <p className="home-hub-empty">Nothing here yet. Make a game and press Share to be the first!</p>
        ) : (
          <div className="home-demos">
            {hub.projects.map((entry) => (
              <div key={entry.id} className="home-demo hub-card">
                <button className="hub-open" onClick={() => openHub(entry)} disabled={busy} aria-label={`${entry.title}${entry.author ? ` by ${entry.author}` : ''}`}>
                  <span className="home-thumb">
                    <img src={thumbUrl(entry.id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  </span>
                  <span className="home-demo-title">{entry.title}</span>
                  <span className="home-demo-desc">
                    {entry.author && <span className="hub-author">by {entry.author}</span>}
                    {entry.author && entry.about ? ' · ' : ''}
                    {entry.about}
                  </span>
                </button>
                <div className="hub-actions">
                  <button className="hub-action" onClick={() => void copyLink(entry.id)}>
                    <CopyIcon size={13} /> {copiedId === entry.id ? 'Copied!' : 'Copy link'}
                  </button>
                  {mine[entry.id] ? (
                    <button className="hub-action quiet" onClick={() => void remove(entry)}>
                      Take it out
                    </button>
                  ) : (
                    <button className="hub-action quiet" onClick={() => void report(entry)}>
                      Report
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="home-foot">
          <button className="btn" onClick={() => void openSaved()} disabled={busy}>
            <FileIcon size={18} /> Open a saved game
          </button>
          <button className="btn" onClick={() => void replace(() => blankProject(), false)} disabled={busy}>
            <BlocksTabIcon size={18} /> Empty project
          </button>
        </div>
      </div>
    </section>
  );
}
