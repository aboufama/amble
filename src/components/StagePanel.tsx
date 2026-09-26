import { useEffect, useRef, useState } from 'react';
import { PlayerHost } from '../player/host';
import { cancelCompile, compile, needsCompile, previewProject, registerPlayer, startGame, stopGame } from '../actions';
import { useStore } from '../store';
import { FlagIcon, FullscreenIcon, SparkIcon, StopIcon, XIcon } from './icons';

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  if (node.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
}

/** The game stage: a sandboxed player iframe with green flag / stop / compile controls. */
export function StagePanel() {
  const frameRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<PlayerHost | null>(null);
  const project = useStore((s) => s.project);
  const runState = useStore((s) => s.run.state);
  const compileState = useStore((s) => s.compile);
  const [fullscreen, setFullscreen] = useState(false);
  const dirty = needsCompile(project);

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

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen();
  };

  const compiling = compileState.status === 'running';
  const progress = compileState.progress;

  return (
    <div className="stage-panel">
      <div className="stage-controls">
        <button className={`icon-btn flag ${runState === 'running' ? 'active' : ''}`} title="Start (green flag)" onClick={startGame} disabled={compiling}>
          <FlagIcon size={24} />
        </button>
        <button className="icon-btn" title="Stop" onClick={stopGame}>
          <StopIcon size={22} />
        </button>
        <span className="mode-badge" title="World type">
          {project.mode.toUpperCase()}
        </span>
        <div className="spacer" />
        {compiling ? (
          <button className="compile-btn running" onClick={cancelCompile} title="Cancel">
            <span className="spinner" /> Compiling… <XIcon size={14} />
          </button>
        ) : (
          <button
            className={`compile-btn ${dirty ? 'dirty' : ''}`}
            onClick={() => void compile()}
            title={dirty ? 'Your blocks changed since the last build' : 'Build the game again'}
          >
            <SparkIcon size={16} /> Compile{dirty && project.compiled ? ' •' : ''}
          </button>
        )}
        <button className="icon-btn" title="Full screen" onClick={toggleFullscreen}>
          <FullscreenIcon size={18} />
        </button>
      </div>
      <div className={`stage-shell ${fullscreen ? 'is-fullscreen' : ''}`} ref={shellRef}>
        <div className="stage-frame" ref={frameRef} />
        {compiling && progress && (
          <div className="compile-overlay">
            <div className="compile-card">
              <SparkIcon size={22} className="pulse" />
              <b>{progress.message}</b>
              {progress.stage === 'writing' && progress.chars ? <small>{(progress.chars / 1000).toFixed(1)}k characters of code</small> : null}
              {progress.stage === 'thinking' ? <small>Reasoning models can take a minute.</small> : null}
              {progress.stage === 'assets' && progress.assetsTotal ? (
                <div className="bar">
                  <div style={{ width: `${((progress.assetsDone ?? 0) / progress.assetsTotal) * 100}%` }} />
                </div>
              ) : null}
            </div>
          </div>
        )}
        {!compiling && !project.compiled && runState !== 'running' && (
          <div className="stage-hint">
            Build your scripts with blocks, then press <b>Compile</b> to turn them into a game.
          </div>
        )}
      </div>
      {compileState.status === 'error' && compileState.error && (
        <div className="compile-error" role="alert">
          <b>Compile failed:</b> {compileState.error}
        </div>
      )}
    </div>
  );
}
