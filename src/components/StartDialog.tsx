import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { pickSavedProject, startGame } from '../actions';
import type { Dial } from '../blocks/spec';
import { resolveTransport } from '../compiler/openai';
import { DEFAULT_DIAL } from '../project/controls';
import { EXAMPLES, blankProject, loadExample, type Example } from '../project/examples';
import { ideaProject } from '../project/idea';
import type { Project } from '../project/types';
import { confirmUser } from '../prompt';
import { Modal } from './Dialogs';
import { GameDial } from './GameDial';
import { BlocksTabIcon, FileIcon } from './icons';
import { StyleKnob } from './StyleKnob';

/** Ideas to start from: one sentence is all a game needs. (Not the demos' own: those are already built.) */
export const IDEA_STARTERS = [
  'a chameleon ninja sneaks past guard dogs by changing colour to match the floor',
  'a snowman surfs an avalanche and collects carrots before he melts',
  'a robot chef juggles flying ingredients into a giant bubbling soup',
  'a bee with a jetpack races wasps through a field of giant sunflowers',
  'a pirate octopus steals treasure from sleeping sharks without waking them',
  'a wizard cat turns falling raindrops into fish before they hit the ground',
  'an astronaut fixes a spinning space station while aliens unscrew the bolts',
  'a dragon who is afraid of fire runs a lemonade stand in a volcano',
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
 * The home screen: say what you want to make (a sentence is enough), set the dial (how much of the
 * game Amble makes) and the art style, and Amble makes the game; or play one of the demos, open a
 * saved game, or start with an empty project. It opens by itself on the first visit, and from the
 * logo in the top bar and File > New game.
 */
export function StartDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const setProject = useStore((s) => s.setProject);
  const notify = useStore((s) => s.notify);
  // Opened from the logo or the menu, there may be a game to lose: ask before replacing it.
  const fromMenu = useStore((s) => s.startFromMenu);
  const [idea, setIdea] = useState('');
  const [dial, setDial] = useState<Dial>(DEFAULT_DIAL);
  const [style, setStyle] = useState('');
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

  const replace = async (make: () => Promise<Project> | Project, play: boolean) => {
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
  const openSaved = async () => {
    try {
      const project = await pickSavedProject();
      if (project) await replace(() => project, false);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
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
          placeholder={IDEA_STARTERS[0]}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              makeGame();
            }
          }}
        />
        <div className="start-knobs">
          <div className="start-knob">
            <span className="start-knob-label">Size</span>
            <GameDial look="page" value={dial} onChange={setDial} />
          </div>
          <div className="start-knob">
            <span className="start-knob-label">Art style</span>
            <StyleKnob look="page" value={style} onChange={setStyle} />
          </div>
        </div>
        <div className="start-row">
          <button className="btn small" onClick={surprise} title="Fill in an idea to try">
            Give me an idea
          </button>
          <span className="start-note">{makes && account === false ? 'Needs an OpenAI API key (Settings).' : ''}</span>
          <button className="btn primary start-make" disabled={!words || busy} onClick={makeGame}>
            Make my game
          </button>
        </div>
      </div>

      <h3 className="start-heading">Demos</h3>
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
        <button className="btn" onClick={() => void openSaved()} disabled={busy} title="A game you saved to your computer (File > Save to your computer)">
          <FileIcon size={16} /> Open a saved game
        </button>
        <button className="btn" onClick={() => void replace(() => blankProject(), false)} disabled={busy} title="Build it yourself with blocks">
          <BlocksTabIcon size={16} /> Empty project
        </button>
      </div>
    </Modal>
  );
}
