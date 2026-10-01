import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type * as Blockly from 'blockly/core';
import { fixProblems, signInWithChatGpt, startGame } from '../actions';
import { planTarget } from '../compiler/codegen';
import { findTarget, useStore } from '../store';

/**
 * Notes pinned to the code, beside the block they are about: a question the compiler asked about
 * words it had to guess at (answer it, and the answer joins the words), a block that doesn't work
 * where it is, what went wrong on that script in the last run (with Fix it), words that didn't build
 * (Try again), and words waiting for a sign-in or a key. Each note goes away on its own once its
 * block changes or the next run or build is fine, or when it is closed.
 */

export interface CodeNote {
  id: string;
  blockId: string;
  kind: 'question' | 'issue' | 'problem' | 'waiting';
  text: string;
  /** What the note's button does: answer the question, fix the run's problems, build again, or get an account. */
  action?: 'answer' | 'fix' | 'retry' | 'signin' | 'settings';
  /** For questions: the words the answer joins. */
  words?: string;
}

/** A failed build, in a few words for the blocks it was building. */
function failure(error: string | null): Pick<CodeNote, 'text' | 'action'> {
  const message = (error ?? '').trim();
  if (/\b401\b|api key|incorrect key|unauthori[sz]ed/i.test(message)) return { text: "This didn't build: the key in Settings didn't work.", action: 'settings' };
  return { text: `This didn't build${message ? `: ${message.length > 140 ? `${message.slice(0, 140)}…` : message}` : '.'}`, action: 'retry' };
}

const CHECK = /^This check wasn't true: /;

/** The notes for one sprite (or the stage), from the last build and the last run, kept to blocks that are still as they were. */
export function useCodeNotes(targetId: string | null): CodeNote[] {
  const project = useStore((s) => s.project);
  const errors = useStore((s) => s.run.errors);
  const needsAccount = useStore((s) => s.needsAccount);
  const canSignIn = useStore((s) => Boolean(s.codex?.installed));
  const build = useStore((s) => s.compile);
  const failed = build.status === 'error' ? build.failed : null;
  const error = build.error;
  return useMemo(() => {
    const target = targetId ? findTarget(project, targetId) : null;
    const compiled = project.compiled;
    if (!target || (!compiled && !errors.length && !failed?.length)) return [];
    const plan = planTarget(project, target, 'Notes');
    const notes: CodeNote[] = [];
    const add = (note: Omit<CodeNote, 'id'>) => {
      if (notes.some((n) => n.blockId === note.blockId)) return;
      notes.push({ ...note, id: `${note.kind}\n${note.blockId}\n${note.text}` });
    };
    const blockOf = (key: string) => [...plan.markers].find(([, k]) => k === key)?.[0];
    // Words that didn't build, on their blocks.
    for (const f of failed ?? []) {
      if (f.targetId !== target.id) continue;
      const piece = plan.pieces.find((p) => p.words.trim() === f.words.trim());
      const blockId = piece && blockOf(piece.key);
      if (blockId) add({ blockId, kind: 'problem', ...failure(error) });
    }
    // What went wrong in the last run, on the script it happened in.
    for (const e of errors) {
      if ((e.target ?? '') !== target.name || !e.script) continue;
      const check = e.script === 'check' && CHECK.test(e.message);
      const blockId = plan.scripts.get(check ? e.message.replace(CHECK, '') : e.script);
      if (blockId) add({ blockId, kind: 'problem', action: 'fix', text: check ? "This wasn't true while the game ran." : `This stopped with an error: ${e.message}` });
    }
    // Words waiting for a sign-in or a key.
    if (needsAccount) {
      const built = new Set((compiled?.pieces ?? []).map((p) => p.key));
      for (const piece of plan.pieces) {
        const blockId = built.has(piece.key) ? undefined : blockOf(piece.key);
        if (blockId) add({ blockId, kind: 'waiting', ...(canSignIn ? { text: 'This builds once you sign in.', action: 'signin' } : { text: 'This builds once you add a key in Settings.', action: 'settings' }) });
      }
    }
    // Blocks that don't work where they are (only while they still don't).
    for (const issue of compiled?.issues ?? []) {
      if (issue.targetId !== target.id) continue;
      if (plan.issues.some((i) => i.blockId === issue.blockId && i.text === issue.text)) add({ blockId: issue.blockId, kind: 'issue', text: issue.text });
    }
    // Questions about words, on the block that still says them.
    for (const q of compiled?.questions ?? []) {
      if (q.targetId !== target.id) continue;
      const piece = plan.pieces.find((p) => p.key === q.pieceKey);
      const blockId = blockOf(q.pieceKey);
      if (piece && blockId) add({ blockId, kind: 'question', action: 'answer', text: q.text, words: piece.words });
    }
    return notes;
  }, [project, errors, targetId, needsAccount, canSignIn, failed, error]);
}

const GAP = 28;
const WIDTH = 236;

export function CodeNotes({
  ws,
  targetId,
  visible,
  onAnswer,
}: {
  ws: MutableRefObject<Blockly.WorkspaceSvg | null>;
  targetId: string | null;
  visible: boolean;
  onAnswer(blockId: string, words: string, answer: string): void;
}) {
  const all = useCodeNotes(targetId);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const notes = useMemo(() => all.filter((n) => !closed.has(n.id)), [all, closed]);
  const compiling = useStore((s) => s.compile.status === 'running');
  const layer = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const lines = useRef(new Map<string, SVGPathElement>());

  // Keep each note beside its block as the code area scrolls, zooms and changes.
  useEffect(() => {
    if (!visible || !notes.length) return;
    let frame = 0;
    const place = () => {
      frame = requestAnimationFrame(place);
      const w = ws.current;
      const host = layer.current?.getBoundingClientRect();
      if (!w || !host) return;
      const placed: Array<{ id: string; el: HTMLDivElement; ax: number; ay: number; x: number; y: number }> = [];
      for (const n of notes) {
        const el = cards.current.get(n.id);
        if (!el) continue;
        const block = w.getBlockById(n.blockId) as Blockly.BlockSvg | null;
        const own = block?.rendered ? block.pathObject.svgPath.getBoundingClientRect() : null;
        if (!block || !own || !own.width || own.bottom < host.top || own.top > host.bottom) {
          el.style.visibility = 'hidden';
          lines.current.get(n.id)?.setAttribute('d', '');
          continue;
        }
        const stack = block.getRootBlock().getSvgRoot().getBoundingClientRect();
        const ax = own.right - host.left;
        const ay = own.top - host.top + Math.min(own.height, 48) / 2;
        const x = Math.min(Math.max(own.right, stack.right) - host.left + GAP, host.width - WIDTH - 12);
        placed.push({ id: n.id, el, ax, ay, x, y: own.top - host.top - 2 });
      }
      // One under another when they would overlap.
      placed.sort((a, b) => a.y - b.y);
      let bottom = -Infinity;
      for (const p of placed) {
        const h = p.el.offsetHeight;
        if (p.y < bottom + 8 && p.x < p.ax + WIDTH) p.y = bottom + 8;
        bottom = p.y + h;
        p.el.style.visibility = '';
        p.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        const ex = p.x;
        const ey = p.y + 15;
        const mid = Math.max(10, (ex - p.ax) / 2);
        lines.current.get(p.id)?.setAttribute('d', `M${p.ax + 1},${p.ay} C${p.ax + mid},${p.ay} ${ex - mid},${ey} ${ex},${ey}`);
      }
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [visible, notes, ws]);

  if (!visible || !notes.length) return null;
  const close = (id: string) => setClosed((c) => new Set(c).add(id));
  return (
    <div className="code-notes" ref={layer}>
      <svg className="code-note-lines" aria-hidden="true">
        {notes.map((n) => (
          <path
            key={n.id}
            className="code-note-line"
            data-kind={n.kind}
            ref={(el) => {
              if (el) lines.current.set(n.id, el);
              else lines.current.delete(n.id);
            }}
          />
        ))}
      </svg>
      {notes.map((n) => (
        <div
          key={n.id}
          className="code-note-place"
          style={{ visibility: 'hidden', width: WIDTH }}
          ref={(el) => {
            if (el) cards.current.set(n.id, el);
            else cards.current.delete(n.id);
          }}
        >
          <div className="code-note" data-kind={n.kind} role="note" aria-label={n.kind === 'question' ? 'A question about these words' : 'A note about this block'}>
            <span className="code-note-mark" aria-hidden="true">
              {n.kind === 'question' ? '?' : n.kind === 'waiting' ? 'i' : '!'}
            </span>
            <div className="code-note-body">
              <p>{n.text}</p>
              {n.action === 'answer' && n.words !== undefined && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem('answer') as HTMLInputElement;
                    const answer = input.value.trim();
                    if (!answer) return;
                    close(n.id);
                    onAnswer(n.blockId, n.words!, answer);
                  }}
                >
                  <input name="answer" className="code-note-answer" placeholder="Your answer" aria-label="Your answer" autoComplete="off" />
                </form>
              )}
              {n.action && n.action !== 'answer' && (
                <button
                  className="code-note-fix"
                  disabled={compiling && (n.action === 'fix' || n.action === 'retry')}
                  onClick={() => {
                    if (n.action === 'fix') fixProblems();
                    else if (n.action === 'retry') startGame();
                    else if (n.action === 'signin') void signInWithChatGpt();
                    else useStore.getState().setDialog('settings');
                  }}
                >
                  {n.action === 'fix' ? 'Fix it' : n.action === 'retry' ? 'Try again' : n.action === 'signin' ? 'Sign in' : 'Settings'}
                </button>
              )}
            </div>
            <button className="code-note-close" title="Close" aria-label="Close this note" onClick={() => close(n.id)}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
