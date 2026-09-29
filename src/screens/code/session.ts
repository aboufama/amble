/**
 * The Look inside session: one world's files in CodeMirror (one EditorState per file, one view), live
 * validation 300 ms after typing stops, Run it, Undo my edits, Explain this, runtime errors from the
 * game, and unrun changes kept in the store so leaving the screen never loses them. The screen renders
 * its snapshot (useSyncExternalStore).
 */
import { setDiagnostics } from '@codemirror/lint';
import { EditorSelection, type EditorState } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { Services } from '../../app/services';
import { extractManifest, sourceFilesOf, type SourceFile } from '../../cores/ai';
import type { PlayerError } from '../../cores/play';
import { playWorld, setSessionWorld } from '../../history/live';
import { t } from '../../i18n';
import type { Author, CodeFile, ExplainOutcome, Role, World } from '../../model/types';
import { announce } from '../../state/app';
import type { ArtChipInfo } from './cm/artChips';
import { chipsChanged } from './cm/artChips';
import { addNote, removeNote, type ExplainNote } from './cm/explain';
import { authorOfLine, setBaseline } from './cm/gutter';
import { kitCall, kitDocAtCursor, kitDocsInRange, type KitDoc } from './cm/kitDocs';
import { lineChanges, nearLine } from './cm/lineEdits';
import { lintSources, toDiagnostic, type CodeIssue } from './cm/lint';
import { isLineLocked, lockBypass, lockedLines, setLocked } from './cm/locked';
import { createView, fileState } from './cm/setup';
import { runIt, type FileEdit } from './run';

export type RunState =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'starting' }
  | { kind: 'done' }
  | { kind: 'blocked'; count: number; line: number; file: string }
  | { kind: 'failed' }
  | { kind: 'runtime'; line: number | null; file: string | null };

export interface CursorInfo {
  file: string;
  line: number;
  author: Author;
  locked: boolean;
  kit: KitDoc | null;
  art: ArtChipInfo | null;
}

export interface CodeSnapshot {
  active: string;
  files: Array<{ path: string; dirty: boolean; edited: boolean }>;
  issues: CodeIssue[];
  run: RunState;
  cursor: CursorInfo | null;
  /** Unrun changes from an older version of the world, waiting for "Bring them back". */
  oldDraft: boolean;
  explaining: boolean;
}

interface DraftEntry {
  base: string;
  text: string;
}
type Draft = Record<string, DraftEntry>;

const LINT_DELAY_MS = 300;
const DRAFT_DELAY_MS = 800;

/** game.js first, then helpers (the order students read them in). */
export function tabOrder(code: readonly CodeFile[]): string[] {
  return [...code.map((f) => f.path)].sort((a, b) => (a === 'game.js' ? -1 : b === 'game.js' ? 1 : a.localeCompare(b)));
}

function draftKey(worldId: string): string {
  return `code-draft:${worldId}`;
}

export interface SessionOptions {
  services: Services;
  world: World;
  file: string | null;
  onDraw(key: string): void;
  onFileChange(path: string): void;
  onCrisis(): void;
}

export class CodeSession {
  private world: World;
  private readonly states = new Map<string, EditorState>();
  private view: EditorView | null = null;
  private active: string;
  private snapshot: CodeSnapshot;
  private readonly listeners = new Set<() => void>();
  private lintTimer: ReturnType<typeof setTimeout> | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private issues: CodeIssue[] = [];
  private runtime: CodeIssue[] = [];
  private run: RunState = { kind: 'clean' };
  private chips = new Map<string, ArtChipInfo>();
  private pendingDraft: Draft | null = null;
  private noteId = 0;
  private explainAbort: AbortController | null = null;
  private disposed = false;
  private readonly offPlayer: () => void;

  constructor(private readonly o: SessionOptions) {
    this.world = o.world;
    const order = tabOrder(o.world.code);
    this.active = o.file && order.includes(o.file) ? o.file : (order[0] ?? 'game.js');
    for (const file of o.world.code) this.states.set(file.path, this.makeState(file, file.source));
    this.snapshot = this.buildSnapshot();
    this.offPlayer = o.services.player.on('error', (m) => this.onRuntimeError(m.error));
    void this.loadChips();
    void this.restoreDraft();
    this.scheduleLint(0);
  }

  // ---------------------------------------------------------------- React glue

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): CodeSnapshot => this.snapshot;

  private emit(): void {
    if (this.disposed) return;
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn();
  }

  private buildSnapshot(): CodeSnapshot {
    const files = tabOrder(this.world.code).map((path) => {
      const base = this.world.code.find((f) => f.path === path);
      const dirty = this.isDirty(path);
      const edited = dirty || !!base?.authors.some(([who]) => who === 'student');
      return { path, dirty, edited };
    });
    return {
      active: this.active,
      files,
      issues: [...this.runtime, ...this.issues],
      run: this.run,
      cursor: this.cursorInfo(),
      oldDraft: this.pendingDraft !== null,
      explaining: this.explainAbort !== null,
    };
  }

  // ---------------------------------------------------------------- editors

  private makeState(file: CodeFile, doc: string): EditorState {
    return fileState({
      path: file.path,
      doc,
      baseline: { source: file.source, authors: file.authors },
      locked: file.locked,
      labels: { editor: t('history.editorLabel', { file: file.path }), locked: t('history.lockedLines'), closeNote: t('history.closeNote'), draw: t('history.drawIt') },
      chips: () => this.chips,
      onDraw: (key) => this.o.onDraw(key),
      onLockedRefused: () => announce(t('history.lockedLines')),
      onUpdate: (u) => this.onUpdate(file.path, u),
    });
  }

  mount(host: HTMLElement): void {
    const state = this.states.get(this.active);
    if (!state || this.view) return;
    this.view = createView(host, state);
    this.emit();
  }

  focusEditor(): void {
    this.view?.focus();
  }

  private stateOf(path: string): EditorState | undefined {
    return path === this.active && this.view ? this.view.state : this.states.get(path);
  }

  private textOf(path: string): string {
    return this.stateOf(path)?.doc.toString() ?? this.world.code.find((f) => f.path === path)?.source ?? '';
  }

  isDirty(path: string): boolean {
    const base = this.world.code.find((f) => f.path === path);
    return !!base && this.textOf(path) !== base.source;
  }

  private dirtyFiles(): string[] {
    return this.world.code.filter((f) => this.isDirty(f.path)).map((f) => f.path);
  }

  private onUpdate(path: string, u: ViewUpdate): void {
    if (path !== this.active) return;
    if (u.docChanged) {
      if (this.runtime.some((i) => i.file === path)) this.runtime = this.runtime.filter((i) => i.file !== path);
      if (this.run.kind !== 'starting') this.run = this.dirtyFiles().length ? { kind: 'dirty' } : { kind: 'clean' };
      this.scheduleLint(LINT_DELAY_MS);
      this.scheduleDraft();
      this.emit();
    } else if (u.selectionSet || u.transactions.some((tr) => tr.effects.length)) {
      this.emit();
    }
  }

  /** Shows another file (keeps each file's own undo history and cursor). */
  open(path: string): void {
    if (path === this.active || !this.states.has(path)) return;
    if (this.view) {
      this.states.set(this.active, this.view.state);
      this.view.setState(this.states.get(path)!);
    }
    this.active = path;
    this.applyDiagnostics();
    this.emit();
    this.o.onFileChange(path);
  }

  /** Moves the cursor to a line (opening its file) and focuses the editor. */
  jumpTo(file: string, line: number): void {
    this.open(file);
    const view = this.view;
    if (!view) return;
    const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
    const at = l.from + (l.text.length - l.text.trimStart().length);
    view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    view.focus();
  }

  // ---------------------------------------------------------------- validation

  private scheduleLint(delay: number): void {
    clearTimeout(this.lintTimer);
    this.lintTimer = setTimeout(() => this.lint(), delay);
  }

  private currentSources(): SourceFile[] {
    return this.world.code.map((f) => ({ path: f.path, content: this.textOf(f.path) }));
  }

  private lint(): void {
    if (this.disposed) return;
    this.issues = lintSources(this.currentSources()).issues;
    this.applyDiagnostics();
    this.emit();
  }

  private applyDiagnostics(): void {
    for (const path of this.states.keys()) {
      const state = this.stateOf(path);
      if (!state) continue;
      const mine = [...this.runtime, ...this.issues].filter((i) => i.file === path);
      const diagnostics = mine.map((i) => toDiagnostic(state.doc, i, t('history.fix'), () => announce(t('history.fixed'))));
      const spec = setDiagnostics(state, diagnostics);
      if (path === this.active && this.view) this.view.dispatch(spec);
      else this.states.set(path, state.update(spec).state);
    }
  }

  private onRuntimeError(error: PlayerError): void {
    const file = error.file && this.states.has(error.file) ? error.file : null;
    this.run = { kind: 'runtime', line: file ? (error.line ?? null) : null, file };
    if (file && error.line) {
      this.runtime = [{ file, line: error.line, column: error.column ?? 0, severity: 'error', rule: 'runtime', message: error.message, fixed: null, runtime: true }];
      this.applyDiagnostics();
    }
    this.emit();
  }

  /** Applies a problem's auto-fix (from the Problems list). */
  fix(issue: CodeIssue): void {
    if (!issue.fixed) return;
    this.open(issue.file);
    const view = this.view;
    if (!view) return;
    view.dispatch({ changes: lineChanges(view.state.doc, issue.fixed, nearLine(view.state.doc, issue.fixed, issue.line - 1)), userEvent: 'input.fix' });
    announce(t('history.fixed'));
  }

  // ---------------------------------------------------------------- Run it

  private edits(): Record<string, FileEdit> {
    const out: Record<string, FileEdit> = {};
    for (const f of this.world.code) {
      const state = this.stateOf(f.path);
      if (state) out[f.path] = { source: state.doc.toString(), locked: lockedLines(state) };
    }
    return out;
  }

  async runIt(): Promise<void> {
    if (this.run.kind === 'starting') return;
    this.lint();
    this.run = { kind: 'starting' };
    this.emit();
    const outcome = await runIt(this.world, this.edits(), {
      history: this.o.services.history,
      play: (w) => playWorld(w),
      setWorld: (w) => setSessionWorld(w),
    });
    if (this.disposed) return;
    if (outcome.kind === 'blocked') {
      const first = outcome.errors[0];
      this.run = { kind: 'blocked', count: outcome.errors.length, line: first.line, file: first.file };
      announce(this.runMessage(), 'polite');
    } else if (outcome.kind === 'failed') {
      this.run = { kind: 'failed' };
      announce(t('history.runFailed'), 'assertive');
    } else {
      this.runtime = [];
      this.adopt(outcome.world, true);
      this.run = { kind: 'done' };
      void this.o.services.store.cache.put(draftKey(this.world.id), null).catch(() => undefined);
      announce(t('history.runDone'));
      this.applyDiagnostics();
    }
    this.emit();
  }

  /** The words of the run bar for the current state. */
  runMessage(): string {
    const r = this.run;
    switch (r.kind) {
      case 'clean':
        return t('history.runClean');
      case 'dirty': {
        const dirty = this.dirtyFiles();
        return dirty.length === 1 ? t('history.runDirtyOne', { file: dirty[0] }) : t('history.runDirtyMany', { n: dirty.length });
      }
      case 'starting':
        return t('history.runStarting');
      case 'done':
        return t('history.runDone');
      case 'failed':
        return t('history.runFailed');
      case 'runtime':
        return r.line && r.file ? t('history.runtimeBroke', { line: r.line, file: r.file }) : t('history.runtimeBrokeNoLine');
      case 'blocked': {
        const other = r.file !== this.active || this.world.code.length > 1;
        if (r.count === 1) return other ? t('history.runBlockedOneIn', { line: r.line, file: r.file }) : t('history.runBlockedOne', { line: r.line });
        return other ? t('history.runBlockedManyIn', { n: r.count, line: r.line, file: r.file }) : t('history.runBlockedMany', { n: r.count, line: r.line });
      }
    }
  }

  // ---------------------------------------------------------------- a new version of the world

  /**
   * Takes in a newer version of the world (after Run it, an AI change or Go back elsewhere). Files the
   * student hasn't touched show the new code; unrun edits stay, measured against the new version.
   */
  adopt(world: World, ranHere = false): void {
    if (world === this.world) return;
    const prev = this.world;
    this.world = world;
    for (const file of world.code) {
      const state = this.stateOf(file.path);
      if (!state) {
        this.states.set(file.path, this.makeState(file, file.source));
        continue;
      }
      const text = state.doc.toString();
      const baseline = setBaseline.of({ source: file.source, authors: file.authors });
      const before = prev.code.find((f) => f.path === file.path)?.source;
      if (ranHere || text === file.source) this.dispatchTo(file.path, { effects: [baseline, setLocked.of(file.locked)] });
      else if (text === before) this.replaceState(file);
      else this.dispatchTo(file.path, { effects: baseline });
    }
    for (const path of [...this.states.keys()]) if (!world.code.some((f) => f.path === path)) this.states.delete(path);
    if (!this.states.has(this.active)) this.open(tabOrder(world.code)[0]);
    void this.loadChips();
    this.scheduleLint(0);
    this.emit();
  }

  /** A fresh editor for a file that has a new version (no undo back into the old one). */
  private replaceState(file: CodeFile): void {
    const state = this.makeState(file, file.source);
    this.states.set(file.path, state);
    if (file.path === this.active && this.view) this.view.setState(state);
  }

  private dispatchTo(path: string, spec: Parameters<EditorView['dispatch']>[0]): void {
    if (path === this.active && this.view) this.view.dispatch(spec);
    else {
      const state = this.states.get(path);
      if (state) this.states.set(path, state.update(spec).state);
    }
  }

  // ---------------------------------------------------------------- Undo my edits

  /** Restores the active file to the running version (Ctrl+Z brings the edits back). */
  undoEdits(): void {
    const view = this.view;
    const base = this.world.code.find((f) => f.path === this.active);
    if (!view || !base || !this.isDirty(this.active)) return;
    view.dispatch({ changes: lineChanges(view.state.doc, base.source), effects: setLocked.of(base.locked), annotations: lockBypass.of(true), userEvent: 'undo.edits' });
    announce(t('history.undoneEdits', { file: this.active }));
  }

  // ---------------------------------------------------------------- unrun changes survive leaving

  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.saveDraft(), DRAFT_DELAY_MS);
  }

  private async saveDraft(): Promise<void> {
    const draft: Draft = {};
    for (const path of this.dirtyFiles()) draft[path] = { base: this.world.code.find((f) => f.path === path)!.source, text: this.textOf(path) };
    await this.o.services.store.cache.put(draftKey(this.world.id), Object.keys(draft).length ? draft : null).catch(() => undefined);
  }

  /** Flushes a pending draft (the screen is closing). */
  flush(): void {
    if (this.draftTimer === undefined) return;
    clearTimeout(this.draftTimer);
    void this.saveDraft();
  }

  private async restoreDraft(): Promise<void> {
    const draft = await this.o.services.store.cache.get<Draft>(draftKey(this.world.id)).catch(() => null);
    if (!draft || this.disposed) return;
    const stale: Draft = {};
    let restored = 0;
    for (const [path, entry] of Object.entries(draft)) {
      const file = this.world.code.find((f) => f.path === path);
      if (!file || entry.text === file.source) continue;
      if (entry.base === file.source) {
        const state = this.stateOf(path);
        if (state) {
          this.dispatchTo(path, { changes: lineChanges(state.doc, entry.text) });
          restored++;
        }
      } else stale[path] = entry;
    }
    if (Object.keys(stale).length) this.pendingDraft = stale;
    if (restored) {
      this.run = { kind: 'dirty' };
      announce(t('history.draftBack'));
      this.scheduleLint(0);
    }
    this.emit();
  }

  /** "Bring them back": unrun changes made on an older version replace the files they touched. */
  bringBackDraft(): void {
    const draft = this.pendingDraft;
    if (!draft) return;
    this.pendingDraft = null;
    for (const [path, entry] of Object.entries(draft)) {
      const state = this.stateOf(path);
      if (state) this.dispatchTo(path, { changes: lineChanges(state.doc, entry.text) });
    }
    this.run = this.dirtyFiles().length ? { kind: 'dirty' } : this.run;
    this.scheduleLint(0);
    this.emit();
  }

  // ---------------------------------------------------------------- Explain this

  /** The lines to explain: the selection, or the line the cursor is on. */
  private explainRange(state: EditorState): { from: number; to: number } {
    const sel = state.selection.main;
    const from = state.doc.lineAt(sel.from).number;
    let to = state.doc.lineAt(sel.to).number;
    if (sel.to > sel.from && to > from && state.doc.lineAt(sel.to).from === sel.to) to--;
    return { from, to };
  }

  async explain(): Promise<void> {
    const view = this.view;
    if (!view) return;
    const state = view.state;
    const { from, to } = this.explainRange(state);
    const where = from === to ? t('history.explainLine', { n: from }) : t('history.explainLines', { from, to });
    const pos = state.doc.line(to).to;
    const id = ++this.noteId;
    const docs = kitDocsInRange(state.doc, state.doc.line(from).from, state.doc.line(to).to).map((d) => ({ call: kitCall(d), doc: d.member.doc }));
    const docsNote = (text?: string): ExplainNote => ({ id, pos, kind: 'docs', label: t('history.explainDocs'), text: text ?? (docs.length ? undefined : t('history.explainNoKit')), docs });
    const status = this.o.services.ai.status();
    if (status !== 'ready' && status !== 'explain-only') {
      view.dispatch({ effects: addNote.of(docsNote()) });
      return;
    }
    this.explainAbort?.abort();
    const abort = new AbortController();
    this.explainAbort = abort;
    view.dispatch({ effects: addNote.of({ id, pos, kind: 'waiting', label: t('history.explainAi'), text: t('history.explainReading', { lines: where }) }) });
    announce(t('history.explainReading', { lines: where }));
    this.emit();
    const path = this.active;
    const world: World = { ...this.world, code: this.world.code.map((f) => (f.path === path ? { ...f, source: this.textOf(path) } : f)) };
    let outcome: ExplainOutcome;
    try {
      outcome = await this.o.services.ai.explain(world, { path, from, to, question: t('history.explainQuestion') }, { signal: abort.signal });
    } catch {
      outcome = { kind: 'failed', reason: 'transport', message: '', details: [] };
    }
    if (this.explainAbort === abort) this.explainAbort = null;
    if (this.disposed || !this.view) return;
    const target = this.active === path ? this.view : null;
    const put = (note: ExplainNote | null) => {
      if (target) target.dispatch({ effects: note ? addNote.of(note) : removeNote.of(id) });
      else this.dispatchTo(path, { effects: note ? addNote.of(note) : removeNote.of(id) });
    };
    switch (outcome.kind) {
      case 'explained': {
        const reply = outcome.reply;
        const lines = reply.lines.map((l) => ({ where: `${l.from === l.to ? t('history.lineOne', { n: l.from }) : t('history.linesRange', { from: l.from, to: l.to })}:`, note: l.note }));
        put({ id, pos, kind: 'ai', label: t('history.explainAi'), text: [reply.answer, reply.safetyNote].filter(Boolean).join(' '), lines });
        announce(reply.answer);
        break;
      }
      case 'crisis':
        put(null);
        this.o.onCrisis();
        break;
      case 'cancelled':
        put(null);
        break;
      case 'refused':
        put({ ...docsNote(outcome.note), kind: 'problem', label: t('history.explainAi') });
        break;
      default:
        put({ ...docsNote(t('history.explainFailed')), kind: 'problem' });
    }
    this.emit();
  }

  // ---------------------------------------------------------------- the cast, for art chips

  private async loadChips(): Promise<void> {
    const { store } = this.o.services;
    const world = this.world;
    let declared: Record<string, { name?: unknown; role?: unknown }> = {};
    try {
      const art = extractManifest(sourceFilesOf(world.code)).statics.art;
      if (art && typeof art === 'object') declared = art as typeof declared;
    } catch {
      declared = {};
    }
    const keys = new Set([...Object.keys(declared), ...Object.keys(world.cast)]);
    const next = new Map<string, ArtChipInfo>();
    for (const key of keys) {
      const slot = world.cast[key];
      const spec = declared[key] ?? {};
      const record = slot?.art ? await store.art.get(slot.art).catch(() => null) : null;
      const thumbRef = record?.export?.thumb ?? record?.export?.sticker ?? null;
      const thumb = thumbRef ? await store.blobs.url(thumbRef).catch(() => null) : null;
      const name = (typeof spec.name === 'string' && spec.name) || record?.name || slot?.extra?.name || key;
      const role = ((typeof spec.role === 'string' && spec.role) || slot?.extra?.role || 'npc') as Role;
      const drawn = !!record;
      next.set(key, { key, name, drawn, thumb, role, label: drawn ? t('history.artDrawn', { name }) : t('history.artBones', { name }) });
    }
    if (this.disposed || world !== this.world) return;
    this.chips = next;
    for (const path of this.states.keys()) this.dispatchTo(path, { effects: chipsChanged.of(null) });
    this.emit();
  }

  // ---------------------------------------------------------------- the cursor, for "What's this?"

  private cursorInfo(): CursorInfo | null {
    const state = this.view?.state;
    if (!state) return null;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    let art: ArtChipInfo | null = null;
    const quoted = /(['"])([A-Za-z][A-Za-z0-9]*)\1/g;
    for (const m of line.text.matchAll(quoted)) {
      const start = line.from + (m.index ?? 0);
      if (head >= start && head <= start + m[0].length) art = this.chips.get(m[2]) ?? null;
    }
    return { file: this.active, line: line.number, author: authorOfLine(state, line.number), locked: isLineLocked(state, line.number), kit: kitDocAtCursor(state), art };
  }

  destroy(): void {
    this.flush();
    this.disposed = true;
    clearTimeout(this.lintTimer);
    this.explainAbort?.abort();
    this.offPlayer();
    this.view?.destroy();
    this.view = null;
  }
}
