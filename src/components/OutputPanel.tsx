import { useMemo, useState } from 'react';
import { fixWithAi } from '../actions';
import { useStore, type OutputTab } from '../store';
import { CaretDownIcon, CodeIcon, CopyIcon, WandIcon } from './icons';

const TABS: Array<{ id: OutputTab; label: string }> = [
  { id: 'game', label: 'Game' },
  { id: 'problems', label: 'Problems' },
  { id: 'console', label: 'Console' },
  { id: 'code', label: 'Code' },
];

/** What the compiler produced: summary, problems (with "Fix with AI"), console output and the generated code. */
export function OutputPanel() {
  const tab = useStore((s) => s.outputTab);
  const setTab = useStore((s) => s.setOutputTab);
  const open = useStore((s) => s.outputOpen);
  const setOpen = useStore((s) => s.setOutputOpen);
  const compiled = useStore((s) => s.project.compiled);
  const errors = useStore((s) => s.run.errors);
  const logs = useStore((s) => s.run.logs);
  const compiling = useStore((s) => s.compile.status === 'running');
  const problemCount = errors.length + (compiled?.warnings.length ?? 0);

  return (
    <div className={`output-panel ${open ? '' : 'collapsed'}`}>
      <div className="output-header">
        <div className="output-tabs" role="tablist" aria-label="Output">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`output-tab ${tab === t.id && open ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'problems' && problemCount > 0 && <span className={`count ${errors.length ? 'bad' : ''}`}>{problemCount}</span>}
              {t.id === 'console' && logs.length > 0 && <span className="count">{logs.length}</span>}
            </button>
          ))}
        </div>
        <button className="output-toggle" aria-expanded={open} aria-label={open ? 'Hide output' : 'Show output'} title={open ? 'Hide' : 'Show'} onClick={() => setOpen(!open)}>
          <CaretDownIcon size={14} />
        </button>
      </div>
      {open && (
        <div className="output-body">
          {tab === 'game' && <GameTab />}
          {tab === 'problems' && (
            <div className="problems">
              {errors.length === 0 && !compiled?.warnings.length && <p className="muted">No problems.</p>}
              {errors.map((e, i) => (
                <div key={`e${i}`} className="problem error">
                  <b>
                    {e.target ?? 'Game'}
                    {e.script ? ` · ${e.script}` : ''}
                    {e.line ? ` · line ${e.line}` : ''}
                  </b>
                  <span>{e.message}</span>
                </div>
              ))}
              {compiled?.warnings.map((w, i) => (
                <div key={`w${i}`} className="problem warning">
                  <span>{w}</span>
                </div>
              ))}
              {compiled && (
                <button className="fix-btn" onClick={fixWithAi} disabled={compiling}>
                  <WandIcon size={15} /> Fix with AI
                </button>
              )}
            </div>
          )}
          {tab === 'console' && (
            <div className="console">
              {logs.length === 0 && <p className="muted">Messages from the running game appear here.</p>}
              {logs.map((l) => (
                <div key={l.id} className={`log ${l.level}`}>
                  {l.message}
                </div>
              ))}
            </div>
          )}
          {tab === 'code' && <CodeTab />}
        </div>
      )}
    </div>
  );
}

function GameTab() {
  const compiled = useStore((s) => s.project.compiled);
  const mode = useStore((s) => s.project.mode);
  if (!compiled) {
    return (
      <div className="game-tab">
        <p className="muted">
          Nothing compiled yet. Snap blocks together, type what you want in them, and press <b>Compile</b>. The AI writes the game for the{' '}
          {mode === '3d' ? '3D' : '2D'} engine and makes any art or sounds you didn't.
        </p>
      </div>
    );
  }
  return (
    <div className="game-tab">
      {compiled.howToPlay && (
        <div className="how-to-play">
          <b>How to play</b>
          <p>{compiled.howToPlay}</p>
        </div>
      )}
      {compiled.summary && <p>{compiled.summary}</p>}
      <p className="muted small">
        Built with {compiled.model} · {new Date(compiled.createdAt).toLocaleTimeString()} · {compiled.assets.length} compiled asset
        {compiled.assets.length === 1 ? '' : 's'}
        {compiled.sprites.length ? ` · ${compiled.sprites.length} new sprite${compiled.sprites.length === 1 ? '' : 's'}` : ''}
      </p>
    </div>
  );
}

function CodeTab() {
  const compiled = useStore((s) => s.project.compiled);
  const selectedId = useStore((s) => s.selectedId);
  const [pick, setPick] = useState<string | null>(null);
  const entries = compiled?.code ?? [];
  const current = useMemo(
    () => entries.find((c) => c.targetId === (pick ?? selectedId)) ?? entries[0] ?? null,
    [entries, pick, selectedId],
  );
  if (!entries.length) return <p className="muted">No code yet.</p>;
  return (
    <div className="code-tab">
      <div className="code-toolbar">
        <CodeIcon size={15} />
        <select value={current?.targetId} onChange={(e) => setPick(e.target.value)}>
          {entries.map((c) => (
            <option key={c.targetId} value={c.targetId}>
              {c.targetName} ({c.className})
            </option>
          ))}
        </select>
        <button className="small-btn" onClick={() => current && void navigator.clipboard?.writeText(current.source)} title="Copy">
          <CopyIcon size={14} />
        </button>
      </div>
      <pre className="code-view">
        {current?.source.split('\n').map((line, i) => (
          <div key={i}>
            <span className="ln">{i + 1}</span>
            {line || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}
