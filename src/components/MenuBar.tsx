import { useState } from 'react';
import { useStore } from '../store';
import { downloadProject, readProjectFile } from '../project/persistence';
import { exportGameHtml } from '../project/exportHtml';
import { pickFile } from '../project/importers';
import { EXAMPLES, blankProject } from '../project/examples';
import { blankBackdrop } from '../project/defaults';
import type { Project, WorldMode } from '../project/types';
import { GearIcon } from './icons';

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
  const [open, setOpen] = useState(false);

  const confirmReplace = () => confirm('Replace the current project? (Save it to your computer first if you want to keep it.)');

  const act = (fn: () => void | Promise<void>) => async () => {
    setOpen(false);
    try {
      await fn();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <header className="menubar">
      <div className="brand">
        <span className="logo">amble</span>
      </div>
      <div className="menu-wrap">
        <button className="menu-btn" onClick={() => setOpen((o) => !o)}>
          File
        </button>
        {open && (
          <div className="menu dropdown" onMouseLeave={() => setOpen(false)}>
            <button onClick={act(() => void (confirmReplace() && setProject(blankProject('2d'))))}>New 2D game</button>
            <button onClick={act(() => void (confirmReplace() && setProject(blankProject('3d'))))}>New 3D game</button>
            <div className="menu-sep" />
            <button
              onClick={act(async () => {
                const files = await pickFile('.amble,application/json');
                if (files.length && confirmReplace()) setProject(await readProjectFile(files[0]));
              })}
            >
              Open from your computer…
            </button>
            <button onClick={act(() => downloadProject(useStore.getState().project))}>Save to your computer</button>
            <button
              onClick={act(async () => {
                if (!useStore.getState().project.compiled) notify('Compile first: the web page contains the compiled game.');
                await exportGameHtml(useStore.getState().project);
              })}
            >
              Export playable web page (.html)
            </button>
            <div className="menu-sep" />
            <div className="menu-label">Examples</div>
            {EXAMPLES.map((ex) => (
              <button key={ex.id} title={ex.description} onClick={act(() => void (confirmReplace() && setProject(ex.make())))}>
                {ex.title}
              </button>
            ))}
          </div>
        )}
      </div>
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
              if (!confirm(`Switch this project to ${m.toUpperCase()}? You'll need to compile again.`)) return;
              update((p) => switchMode(p, m));
            }}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <button className="menu-btn" onClick={() => setDialog('settings')} title="Settings (OpenAI key and model)">
        <GearIcon size={17} /> Settings
      </button>
    </header>
  );
}
