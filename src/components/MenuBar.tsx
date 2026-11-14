import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { downloadProject } from '../project/persistence';
import { exportGameHtml } from '../project/exportHtml';
import { EXAMPLES, loadExample } from '../project/examples';
import { buildNow, compile, flushBlocks, pickSavedProject, signInWithChatGpt } from '../actions';
import { confirmUser } from '../prompt';
import { AmbleMark, CaretDownIcon, FileIcon, PencilIcon, SettingsIcon } from './icons';
import { DEV_TOOLS } from './ProblemsDialog';
import { ModeSwitch, SpendMeter } from './ModeSwitch';
import { ProjectStyleKnob } from './StyleKnob';
import { useServerConfig } from './useServerConfig';

export function MenuBar() {
  const title = useStore((s) => s.project.title);
  const update = useStore((s) => s.update);
  const setProject = useStore((s) => s.setProject);
  const setDialog = useStore((s) => s.setDialog);
  const notify = useStore((s) => s.notify);
  const codex = useStore((s) => s.codex);
  const useChatGpt = useStore((s) => s.settings.useChatGpt);
  const restore = useStore((s) => s.restore);
  const setRestore = useStore((s) => s.setRestore);
  const compiledCount = useStore((s) => s.project.compiled?.code.length ?? 0);
  const lastModel = useStore((s) => s.project.compiled?.model);
  const compiling = useStore((s) => s.compile.status === 'running');
  // A site that builds with its own key has nothing to set up: no Settings (developers still get it).
  const server = useServerConfig();
  const showSettings = DEV_TOOLS || (server !== null && !server.serverKey);
  const [open, setOpen] = useState<'file' | 'edit' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const signedIn = useChatGpt && codex?.auth === 'chatgpt';

  // Like Scratch, a menu closes when you click anywhere else.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const confirmReplace = () =>
    confirmUser({
      title: 'Replace Project',
      message: 'Replace the current project? Save it to your computer first if you want to keep it.',
      confirmLabel: 'Replace',
      danger: true,
    });

  const act = (fn: () => void | Promise<void>) => async () => {
    setOpen(null);
    try {
      await fn();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <header className="menubar">
      <div className="menubar-main">
        {/* The logo is the way home: make a new game, open a saved one, play a demo. */}
        <button className="menubar-brand" aria-label="Amble: home" title="Home" onClick={() => useStore.getState().openHome(true)}>
          <AmbleMark size={28} />
          <span className="logo">amble</span>
        </button>
        {showSettings && (
          <button className="menubar-item" onClick={() => setDialog('settings')} title="Settings (sign-in, API key)">
            <SettingsIcon size={20} />
            <span>Settings</span>
          </button>
        )}
        <div className="menubar-menus" ref={menuRef}>
          <div className={`menubar-item menubar-dropdown ${open === 'file' ? 'active' : ''}`}>
            <button className="menubar-button" aria-haspopup="menu" aria-expanded={open === 'file'} onClick={() => setOpen((o) => (o === 'file' ? null : 'file'))}>
              <FileIcon size={20} />
              <span>File</span>
              <CaretDownIcon size={16} className="dropdown-caret" />
            </button>
            {open === 'file' && (
              <div className="menubar-menu" role="menu">
                <div className="menubar-menu-section">
                  <button role="menuitem" onClick={act(() => useStore.getState().openHome(true))}>
                    New game
                  </button>
                </div>
                <div className="menubar-menu-section">
                  <button
                    role="menuitem"
                    onClick={act(async () => {
                      const project = await pickSavedProject();
                      if (project && (await confirmReplace())) setProject(project);
                    })}
                  >
                    Load from your computer
                  </button>
                  <button
                    role="menuitem"
                    onClick={act(() => {
                      flushBlocks();
                      downloadProject(useStore.getState().project);
                    })}
                  >
                    Save to your computer
                  </button>
                  <button
                    role="menuitem"
                    onClick={act(async () => {
                      // The page holds the game as built: build what changed first.
                      await exportGameHtml(await buildNow());
                    })}
                  >
                    Export playable web page
                  </button>
                </div>
                <div className="menubar-menu-section examples">
                  <div className="menubar-menu-label">Examples</div>
                  {EXAMPLES.map((ex) => (
                    <button key={ex.id} role="menuitem" aria-label={`Example: ${ex.title}`} title={ex.description} onClick={act(async () => void ((await confirmReplace()) && setProject(await loadExample(ex))))}>
                      {ex.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className={`menubar-item menubar-dropdown ${open === 'edit' ? 'active' : ''}`}>
            <button className="menubar-button" aria-haspopup="menu" aria-expanded={open === 'edit'} onClick={() => setOpen((o) => (o === 'edit' ? null : 'edit'))}>
              <PencilIcon size={18} />
              <span>Edit</span>
              <CaretDownIcon size={16} className="dropdown-caret" />
            </button>
            {open === 'edit' && (
              <div className="menubar-menu" role="menu">
                <div className="menubar-menu-section">
                  <button
                    role="menuitem"
                    disabled={!restore}
                    onClick={act(() => {
                      restore?.run();
                      setRestore(null);
                    })}
                  >
                    {restore ? `Restore ${restore.what}` : 'Restore'}
                  </button>
                </div>
                <div className="menubar-menu-section">
                  {DEV_TOOLS && (
                    <button
                      role="menuitem"
                      disabled={!compiledCount}
                      title={compiledCount ? 'The JavaScript your blocks compiled to' : 'Compile the game first'}
                      onClick={act(() => {
                        const s = useStore.getState();
                        s.setOutputTab('code');
                        s.setProblemsOpen(true);
                      })}
                    >
                      Show compiled code
                    </button>
                  )}
                  <button
                    role="menuitem"
                    disabled={compiling}
                    title={`Every block in your own words is built again and its art is made again, so it can come out different${lastModel ? ` (last built with ${lastModel})` : ''}`}
                    onClick={act(() => void compile(undefined, { fresh: true }))}
                  >
                    Build everything again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="menubar-divider" />
        <input
          className="title-input"
          value={title}
          onChange={(e) => update((p) => void (p.title = e.target.value))}
          aria-label="Project title"
          placeholder="Untitled game"
        />
      </div>
      <div className="menubar-build">
        {/* Always there: how much of the game Amble makes, and how it looks. */}
        <ProjectStyleKnob />
        <ModeSwitch />
        <SpendMeter />
      </div>
      <div className="menubar-account">
        {/* Signing in works when Amble runs on your computer and Codex is installed there. */}
        {codex?.installed &&
          (signedIn ? (
            <button className="menu-btn account" onClick={() => setDialog('settings')} title="Signed in: blocks written in words get built">
              <span className="account-dot" aria-hidden="true" /> Signed in
            </button>
          ) : (
            <button
              className="menu-btn sign-in"
              onClick={() => (codex.login.pending ? setDialog('settings') : void signInWithChatGpt())}
              title="Sign in to build blocks written in words"
            >
              {codex.login.pending ? 'Signing in…' : 'Sign in'}
            </button>
          ))}
      </div>
    </header>
  );
}
