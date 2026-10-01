import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { downloadProject, readProjectFile } from '../project/persistence';
import { exportGameHtml } from '../project/exportHtml';
import { pickFile } from '../project/importers';
import { EXAMPLES, blankProject } from '../project/examples';
import { blankBackdrop } from '../project/defaults';
import type { Project, WorldMode } from '../project/types';
import { compile, signInWithChatGpt } from '../actions';
import { confirmUser } from '../prompt';
import { AmbleMark, CaretDownIcon, FileIcon, PencilIcon, SettingsIcon } from './icons';
import { DEV_TOOLS } from './ProblemsDialog';

/** Converts a project between 2D and 3D (positions are rescaled; the blank white backdrop is dropped in 3D). */
export function switchMode(p: Project, mode: WorldMode): void {
  if (p.mode === mode) return;
  const toThree = mode === '3d';
  for (const s of p.sprites) {
    if (toThree) {
      s.x = Math.round((s.x / 60) * 10) / 10;
      s.z = Math.round((s.y / 60) * 10) / 10;
      s.y = 0;
      s.rotationStyle = 'all around';
      s.direction = 0;
    } else {
      s.x = Math.round(s.x * 60);
      s.y = Math.round(s.z * 60);
      s.z = 0;
      s.rotationStyle = 'left-right';
      s.direction = 0;
    }
  }
  if (toThree) {
    // The default blank backdrop would hide the 3D sky.
    p.stage.costumes = p.stage.costumes.filter((c) => !(c.kind === 'image' && c.mime === 'image/svg+xml' && c.dataUrl.length < 400));
  } else if (!p.stage.costumes.length) {
    p.stage.costumes = [blankBackdrop()];
  }
  p.stage.currentCostume = 0;
  p.mode = mode;
}

export function MenuBar() {
  const title = useStore((s) => s.project.title);
  const mode = useStore((s) => s.project.mode);
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
        <div className="menubar-brand" aria-label="Amble">
          <AmbleMark size={28} />
          <span className="logo">amble</span>
        </div>
        <button className="menubar-item" onClick={() => setDialog('settings')} title="Settings (sign-in, API key)">
          <SettingsIcon size={20} />
          <span>Settings</span>
        </button>
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
                  <button role="menuitem" onClick={act(async () => void ((await confirmReplace()) && setProject(blankProject('2d'))))}>
                    New 2D game
                  </button>
                  <button role="menuitem" onClick={act(async () => void ((await confirmReplace()) && setProject(blankProject('3d'))))}>
                    New 3D game
                  </button>
                </div>
                <div className="menubar-menu-section">
                  <button
                    role="menuitem"
                    onClick={act(async () => {
                      const files = await pickFile('.amble,application/json');
                      if (!files.length) return;
                      const project = await readProjectFile(files[0]);
                      if (await confirmReplace()) setProject(project);
                    })}
                  >
                    Load from your computer
                  </button>
                  <button role="menuitem" onClick={act(() => downloadProject(useStore.getState().project))}>
                    Save to your computer
                  </button>
                  <button
                    role="menuitem"
                    onClick={act(async () => {
                      if (!useStore.getState().project.compiled) notify('Compile first: the web page contains the compiled game.');
                      await exportGameHtml(useStore.getState().project);
                    })}
                  >
                    Export playable web page
                  </button>
                </div>
                <div className="menubar-menu-section">
                  {EXAMPLES.map((ex) => (
                    <button key={ex.id} role="menuitem" title={ex.description} onClick={act(async () => void ((await confirmReplace()) && setProject(ex.make())))}>
                      Example: {ex.title}
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
        <div className="mode-switch" role="radiogroup" aria-label="World">
          {(['2d', '3d'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                if (mode === m) return;
                void confirmUser({
                  title: `Switch to ${m.toUpperCase()}`,
                  message: `Switch this project to ${m.toUpperCase()}? Sprite positions are converted, and you'll need to compile again.`,
                  confirmLabel: 'Switch',
                }).then((ok) => ok && update((p) => switchMode(p, m)));
              }}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
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
