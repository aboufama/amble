import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayerHost } from '../player/host';
import { addWish, hasGameLine, moveSpriteFromStage, previewProject, registerPlayer, startGame, stopGame } from '../actions';
import { compileNeedsRequest, type CompileProgress } from '../compiler/compile';
import { projectFreedom } from '../compiler/codegen';
import { isDisabled, oneLine, topBlocks } from '../compiler/serialize';
import type { Project } from '../project/types';
import { useStore } from '../store';
import { ExpandIcon, FlagIcon, LargeStageIcon, ShrinkIcon, SmallStageIcon, StopIcon, WarningIcon } from './icons';
import { useProblemCount } from './ProblemsDialog';

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  if (node.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
}

/** The game: line, when the build under way is writing the whole game from it. */
function gameLineBeingBuilt(project: Project, building: Array<{ targetId: string; words: string }>): string | null {
  if (projectFreedom(project) === 'just what I say') return null;
  const line = topBlocks(project.stage.blocks).find((b) => b.type === 'br_game' && !isDisabled(b));
  const words = oneLine(line?.fields?.WHAT);
  return words && building.some((b) => b.targetId === project.stage.id && b.words === words) ? words : null;
}

const MAKING_LINES = [
  'Inventing the characters',
  'Deciding what makes it fun',
  'Planning a big finish',
  'Tuning how it feels to move',
  'Hiding a surprise or two',
  'Picking the sounds',
  'Giving the boss a name',
  'Making it fair',
];

/** Shown over the stage while a whole game is made from an idea: what is happening, and for how long. */
function MakingGame({ progress, idea }: { progress: CompileProgress; idea: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(t);
  }, []);
  let step = 'Thinking up your game';
  let detail = MAKING_LINES[Math.floor(seconds / 6) % MAKING_LINES.length];
  if (progress.stage === 'writing') {
    step = 'Writing the game';
    detail = progress.chars ? `${progress.chars.toLocaleString()} characters of code so far` : 'Writing the code';
  } else if (progress.stage === 'checking' || progress.stage === 'repairing') {
    step = 'Checking the code';
    detail = progress.message;
  } else if (progress.stage === 'assets') {
    step = 'Drawing the art and making the sounds';
    detail = progress.assetsTotal ? `${progress.assetsDone ?? 0} of ${progress.assetsTotal} done` : progress.message;
  }
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="making-game" role="status" aria-live="polite">
      <div className="making-idea">“{idea.length > 110 ? `${idea.slice(0, 108)}…` : idea}”</div>
      <div className="making-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="making-step">{step}</div>
      <div className="making-detail">{detail}</div>
      <div className="making-time">{time} · a whole game takes two or three minutes</div>
    </div>
  );
}

/** "Change something": a wish in plain words, added to the game as a rule and built in. */
function WishBox({ busy }: { busy: boolean }) {
  const [wish, setWish] = useState('');
  const send = () => {
    if (!wish.trim() || busy) return;
    addWish(wish);
    setWish('');
  };
  return (
    <form
      className="wish-box"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder="Change something: “make it snow”, “add a second boss”…" aria-label="Change something in the game" maxLength={300} disabled={busy} />
      <button className="btn primary small" type="submit" disabled={busy || !wish.trim()} title="Adds it to the game as a rule on the stage, and builds it in">
        Change
      </button>
    </form>
  );
}

/** The game stage: a sandboxed player iframe with green flag / stop / compile controls. */
export function StagePanel() {
  const frameRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<PlayerHost | null>(null);
  const project = useStore((s) => s.project);
  const runState = useStore((s) => s.run.state);
  const compileState = useStore((s) => s.compile);
  const stageSize = useStore((s) => s.stageSize);
  const setStageSize = useStore((s) => s.setStageSize);
  const [fullscreen, setFullscreen] = useState(false);
  const problems = useProblemCount();
  // New words (or a new brief) the flag will build first; exact blocks build instantly anyway.
  const needsAccount = useStore((s) => s.needsAccount);
  const dirty = useMemo(() => compileNeedsRequest(project), [project]) && !needsAccount;

  useEffect(() => {
    const store = useStore.getState;
    const host = new PlayerHost(frameRef.current!, {
      onState: (state) => store().setRunState(state),
      onLoaded: () => undefined,
      onError: (e) => {
        store().addError(e);
        store().setOutputTab('problems');
      },
      onLog: (level, message) => store().addLog(level, message),
      onSpriteMoved: moveSpriteFromStage,
    });
    hostRef.current = host;
    registerPlayer(host);
    previewProject(store().project);
    return () => {
      registerPlayer(null);
      host.destroy();
    };
  }, []);

  // Keep the idle stage in sync with the editor (positions, costumes, new sprites...).
  useEffect(() => {
    if (runState === 'running' || runState === 'paused') return;
    const t = setTimeout(() => previewProject(project), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // While the game runs, keys pressed anywhere in the editor (outside text fields) go to the game.
  useEffect(() => {
    if (runState !== 'running') return;
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.('.blocklyWidgetDiv, .blocklyHtmlInput')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!e.repeat) hostRef.current?.key('down', e.key, e.code);
    };
    const up = (e: KeyboardEvent) => hostRef.current?.key('up', e.key, e.code);
    const blur = () => hostRef.current?.releaseKeys();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [runState]);

  // Scratch's full screen mode fills the page (not the screen): the stage header on top,
  // the stage as large as fits below it. Escape leaves it.
  const [fit, setFit] = useState({ width: 480, height: 360 });
  useEffect(() => {
    if (!fullscreen) return;
    const measure = () => {
      let height = window.innerHeight - 44 - 6;
      let width = (height * 4) / 3;
      if (width > window.innerWidth - 6) {
        width = window.innerWidth - 6;
        height = (width * 3) / 4;
      }
      setFit({ width: Math.floor(width), height: Math.floor(height) });
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', key);
    };
  }, [fullscreen]);

  const compiling = compileState.status === 'running';
  const progress = compileState.progress;
  // The flag shows a build it is waiting for; any build shows on its blocks and in a small chip.
  const building = compiling && compileState.forPlay;
  const buildingCount = new Set(compileState.building.map((b) => `${b.targetId}\u0000${b.words}`)).size;
  const running = runState === 'running' || runState === 'paused';
  // A whole game being made from the game: line takes a couple of minutes: the stage says what's happening.
  const makingGame = compiling ? gameLineBeingBuilt(project, compileState.building) : null;
  const howToPlay = project.compiled?.howToPlay?.trim();
  // A game made from an idea can be changed the way it was made: by saying so.
  const canWish = useMemo(() => hasGameLine(project), [project]) && Boolean(project.compiled?.pieces?.some((p) => p.kind === 'game'));

  return (
    <div className={`stage-panel ${fullscreen ? 'full-screen' : ''}`}>
      <div className="stage-header">
        <div className="stage-controls">
          <button
            className={`green-flag ${runState === 'running' ? 'active' : ''} ${building ? 'building' : ''} ${dirty && !compiling ? 'has-new' : ''}`}
            title={building ? 'Building your new blocks. Stop cancels.' : dirty ? 'Start: your new blocks are built first' : 'Start (green flag)'}
            aria-label={building ? 'Building your new blocks' : 'Start (green flag)'}
            onClick={startGame}
            aria-busy={building}
          >
            <FlagIcon size={24} />
          </button>
          <button className={`stop-all ${running || building ? 'active' : ''}`} title="Stop" aria-label="Stop" onClick={stopGame}>
            <StopIcon size={24} />
          </button>
          {compiling && progress && (
            <span className="build-chip" role="status">
              {progress.stage === 'assets' && progress.assetsTotal ? `Making art ${progress.assetsDone ?? 0} of ${progress.assetsTotal}` : buildingCount ? `Building ${buildingCount} block${buildingCount > 1 ? 's' : ''}` : progress.message}
            </span>
          )}
          {compileState.status === 'error' && (
            <button className="build-chip failed" title={compileState.error ? `${compileState.error} Click to try again.` : 'Click to try again.'} onClick={startGame}>
              Didn't build
            </button>
          )}
          {problems.count > 0 && (
            <button
              className={`problems-btn ${problems.errors ? 'has-errors' : ''}`}
              title="Problems"
              aria-label={`${problems.count} ${problems.count === 1 ? 'problem' : 'problems'}`}
              onClick={() => {
                const s = useStore.getState();
                s.setOutputTab('problems');
                s.setProblemsOpen(true);
              }}
            >
              <WarningIcon size={16} />
              {problems.count}
            </button>
          )}
        </div>
        <div className="stage-size-row">
          <div className="stage-size-toggle" role="group" aria-label="Stage size">
            <button aria-pressed={stageSize === 'small'} title="Small stage" onClick={() => setStageSize('small')}>
              <SmallStageIcon size={20} />
            </button>
            <button aria-pressed={stageSize === 'large'} title="Normal stage" onClick={() => setStageSize('large')}>
              <LargeStageIcon size={20} />
            </button>
          </div>
          {fullscreen ? (
            <button className="stage-button" title="Exit full screen" aria-label="Exit full screen" onClick={() => setFullscreen(false)}>
              <ShrinkIcon size={18} />
            </button>
          ) : (
            <button className="stage-button" title="Full screen" aria-label="Full screen" onClick={() => setFullscreen(true)}>
              <ExpandIcon size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="stage-shell" ref={shellRef} style={fullscreen ? fit : undefined}>
        <div className="stage-frame" ref={frameRef} />
        {!compiling && !project.compiled && runState !== 'running' && (
          <div className="stage-hint">
            Click the green flag to play.
          </div>
        )}
        {makingGame && progress && <MakingGame progress={progress} idea={makingGame} />}
      </div>
      {/* How to play a game the compiler made from an idea (it says so itself). */}
      {howToPlay && !fullscreen && (
        <p className="how-to-play" title={howToPlay}>
          {howToPlay}
        </p>
      )}
      {canWish && !fullscreen && <WishBox busy={compiling} />}
    </div>
  );
}
