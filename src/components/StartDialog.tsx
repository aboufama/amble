import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { startGame } from '../actions';
import { FREEDOM_LEVELS, type Freedom } from '../blocks/spec';
import { resolveTransport } from '../compiler/openai';
import { EXAMPLES, blankProject, loadExample, type Example } from '../project/examples';
import { ideaProject } from '../project/idea';
import { confirmUser } from '../prompt';
import { Modal } from './Dialogs';

/** Ideas to start from: one sentence is all a game needs. (Not the demos' own: those are already built.) */
export const IDEA_STARTERS = [
  'a hamster in a tiny mech suit defends the cheese from invading cats',
  'a snowman surfs an avalanche and collects carrots before he melts',
  'a robot chef juggles flying ingredients into a giant bubbling soup',
  'a bee with a jetpack races wasps through a field of giant sunflowers',
  'a pirate octopus steals treasure from sleeping sharks without waking them',
  'a wizard cat turns falling raindrops into fish before they hit the ground',
  'an astronaut fixes a spinning space station while aliens unscrew the bolts',
  'a dragon who is afraid of fire runs a lemonade stand in a volcano',
];

const LEVELS: Array<{ level: Freedom; label: string; hint: string }> = [
  { level: 'fill in the gaps', label: 'Just my idea', hint: 'Amble builds the game you describe, and nothing you didn’t ask for.' },
  { level: 'go wild', label: 'Go wild', hint: 'Amble builds your idea, then adds surprises of its own: twists, bosses, secrets.' },
];

const START_SEEN = 'amble:start';

/** Has this browser seen the start screen? (It opens by itself once, on the first visit.) */
export function startSeen(): boolean {
  try {
    return localStorage.getItem(START_SEEN) === 'seen';
  } catch {
    return true;
  }
}

function markStartSeen(): void {
  try {
    localStorage.setItem(START_SEEN, 'seen');
  } catch {
    /* ignore */
  }
}

/**
 * The start screen: say what you want to make (a sentence is enough) and Amble makes the game,
 * or open one of the demos. It opens on the first visit and from File > New game.
 */
export function StartDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const setProject = useStore((s) => s.setProject);
  const notify = useStore((s) => s.notify);
  // Opened from the menu, there may be a game to lose: ask before replacing it.
  const fromMenu = useStore((s) => s.startFromMenu);
  const [idea, setIdea] = useState('');
  const [freedom, setFreedom] = useState<Freedom>('go wild');
  const [busy, setBusy] = useState(false);
  // Can words be built here? (A key in Settings, the site's own key, or a ChatGPT sign-in.) Unknown at first.
  const [account, setAccount] = useState<boolean | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    markStartSeen();
    input.current?.focus();
    resolveTransport(useStore.getState().settings).then(
      (t) => setAccount(Boolean(t)),
      () => setAccount(false),
    );
  }, []);

  const close = () => setDialog(null);

  const replace = async (make: () => Promise<ReturnType<typeof blankProject>> | ReturnType<typeof blankProject>, play: boolean) => {
    if (busy) return;
    if (fromMenu && !(await confirmUser({ title: 'Replace Project', message: 'Replace the current project? Save it to your computer first if you want to keep it.', confirmLabel: 'Replace', danger: true }))) return;
    setBusy(true);
    try {
      setProject(await make());
      close();
      // The flag builds what needs building (a whole game, for an idea), then plays.
      if (play) window.setTimeout(startGame, 50);
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const words = idea.trim();
  const makeGame = () => {
    if (!words) return;
    if (account === false) {
      // Nothing to build with here (a copy of Amble with no key of its own): Settings is where a key goes.
      notify('Making a game from an idea needs an OpenAI API key here. Add one in Settings, then try again.', 'error');
      setDialog('settings');
      return;
    }
    void replace(() => ideaProject(words, freedom), true);
  };
  const openDemo = (ex: Example) => void replace(() => loadExample(ex), Boolean(ex.prebuilt));
  const surprise = () => {
    const others = IDEA_STARTERS.filter((s) => s !== idea);
    setIdea(others[Math.floor(Math.random() * others.length)]);
    input.current?.focus();
  };

  return (
    <Modal title="Make a game" onClose={close} wide className="start">
      <div className="start-idea">
        <label className="start-label" htmlFor="start-idea-input">
          What do you want to make?
        </label>
        <textarea
          id="start-idea-input"
          ref={input}
          value={idea}
          rows={2}
          maxLength={600}
          placeholder={`A sentence is enough, like “${IDEA_STARTERS[0]}”`}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              makeGame();
            }
          }}
        />
        <div className="start-row">
          <div className="start-levels" role="radiogroup" aria-label="Imagination">
            {LEVELS.map((l) => (
              <button key={l.level} role="radio" aria-checked={freedom === l.level} className={freedom === l.level ? 'on' : ''} title={l.hint} onClick={() => setFreedom(l.level)}>
                {l.label}
              </button>
            ))}
          </div>
          <button className="btn small" onClick={surprise} title="Fill in an idea to try">
            Give me an idea
          </button>
          <span className="start-spacer" />
          <button className="btn primary start-make" disabled={!words || busy} onClick={makeGame}>
            Make my game
          </button>
        </div>
        <p className="start-hint">
          {account === false
            ? 'Making a game from an idea needs an OpenAI API key here (Settings). The demos below play without one.'
            : `${LEVELS.find((l) => l.level === freedom)?.hint} It takes two or three minutes; then change any sentence and it builds again.`}
        </p>
      </div>

      <h3 className="start-heading">Or play one of these, and change it</h3>
      <div className="start-demos">
        {EXAMPLES.map((ex) => (
          <button key={ex.id} className="start-demo" onClick={() => openDemo(ex)} disabled={busy} aria-label={`Demo: ${ex.title}`}>
            <span className="start-thumb" data-demo={ex.id}>
              <img src={`demos/${ex.id}.jpg`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
            </span>
            <span className="start-demo-title">{ex.title}</span>
            <span className="start-demo-desc">{ex.description}</span>
          </button>
        ))}
      </div>
      <div className="start-foot">
        <button className="link-btn" onClick={() => void replace(() => blankProject(), false)}>
          Start with an empty project and blocks
        </button>
      </div>
    </Modal>
  );
}

// (The levels offered here are two of the dial's three: "just what I say" is the empty project.)
void FREEDOM_LEVELS;
