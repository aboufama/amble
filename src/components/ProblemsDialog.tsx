import { useMemo, useState } from 'react';
import { fixProblems } from '../actions';
import { useStore, type OutputTab } from '../store';
import { Modal } from './Dialogs';
import { CodeIcon, CopyIcon, WrenchIcon } from './icons';

/** Developer views (the console and the compiled code): on the dev server, or with ?dev in the URL. */
export const DEV_TOOLS = import.meta.env.DEV || new URLSearchParams(window.location.search).has('dev');

const TABS: Array<{ id: Exclude<OutputTab, 'game'>; label: string }> = [
  { id: 'problems', label: 'Problems' },
  { id: 'console', label: 'Console' },
  { id: 'code', label: 'Code' },
];

/** How many problems the last compile and the last run had (compiler notes and runtime errors). */
export function useProblemCount(): { count: number; errors: number } {
  const errors = useStore((s) => s.run.errors.length);
  const warnings = useStore((s) => s.project.compiled?.warnings.length ?? 0);
  return { count: errors + warnings, errors };
}

/**
 * What the compiler and the running game reported, in a Scratch-style dialog opened from
 * the warning button next to the green flag: the problems (with "Fix") and, for
 * developers, the console and the compiled code (read-only).
 */
export function ProblemsDialog() {
  const open = useStore((s) => s.problemsOpen);
  const setOpen = useStore((s) => s.setProblemsOpen);
  const stored = useStore((s) => s.outputTab);
  const setTab = useStore((s) => s.setOutputTab);
  const compiled = useStore((s) => s.project.compiled);
  const errors = useStore((s) => s.run.errors);
  const logs = useStore((s) => s.run.logs);
  const compiling = useStore((s) => s.compile.status === 'running');
  const { count } = useProblemCount();
  if (!open) return null;
  // Kids only see the problems: the other tabs are for developers.
  const tab = !DEV_TOOLS || stored === 'game' ? 'problems' : stored;
  const title = tab === 'code' ? 'Compiled Code' : tab === 'console' ? 'Console' : 'Problems';

  return (
    <Modal title={title} onClose={() => setOpen(false)} wide className="problems-modal">
      {DEV_TOOLS && (
        <div className="info-tabs" role="tablist" aria-label="Game info">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`info-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'problems' && count > 0 && <span className={`count ${errors.length ? 'bad' : ''}`}>{count}</span>}
              {t.id === 'console' && logs.length > 0 && <span className="count">{logs.length}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="info-body">
        {tab === 'problems' && (
          <div className="problems">
            {count === 0 && <p className="muted">No problems.</p>}
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
            {compiled && count > 0 && (
              <button
                className="fix-btn"
                onClick={() => {
                  setOpen(false);
                  fixProblems();
                }}
                disabled={compiling}
              >
                <WrenchIcon size={15} /> Fix
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
    </Modal>
  );
}

function CodeTab() {
  const compiled = useStore((s) => s.project.compiled);
  const selectedId = useStore((s) => s.selectedId);
  const [pick, setPick] = useState<string | null>(null);
  const entries = compiled?.code ?? [];
  const current = useMemo(() => entries.find((c) => c.targetId === (pick ?? selectedId)) ?? entries[0] ?? null, [entries, pick, selectedId]);
  if (!entries.length) return <p className="muted">Nothing compiled yet.</p>;
  return (
    <div className="code-tab">
      <div className="code-toolbar">
        <CodeIcon size={15} />
        <select value={current?.targetId} onChange={(e) => setPick(e.target.value)} aria-label="Sprite">
          {entries.map((c) => (
            <option key={c.targetId} value={c.targetId}>
              {c.targetName} ({c.className})
            </option>
          ))}
        </select>
        <button className="small-btn" onClick={() => current && void navigator.clipboard?.writeText(current.source)} title="Copy" aria-label="Copy">
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
