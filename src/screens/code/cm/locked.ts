/**
 * Teacher-locked lines (§2.12, §4.2 `CodeFile.locked`): read-only in Look inside. Locked blocks follow
 * their lines as the student edits around them; any change that would alter a locked line (typing in it,
 * joining it with a neighbour, deleting it) is refused, and a note says "Your teacher locked these lines."
 * A lock mark sits in the gutter and locked lines get a quiet tint.
 */
import { Annotation, EditorState, RangeSet, RangeSetBuilder, RangeValue, StateEffect, StateField, type Extension, type Text, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, showTooltip, ViewPlugin, type DecorationSet, type Tooltip } from '@codemirror/view';
import type { LineRange } from '../../../model/types';

class LockValue extends RangeValue {}
const LOCK = new LockValue();

/** Programmatic edits that may touch locked lines (restoring a file, loading a new version). */
export const lockBypass = Annotation.define<boolean>();

/** Replaces the locked ranges (1-based inclusive line ranges). */
export const setLocked = StateEffect.define<LineRange[]>();

/** A refused edit at a position (shows the note there). */
const refused = StateEffect.define<number | null>();

function rangesToSet(doc: Text, ranges: readonly LineRange[]): RangeSet<LockValue> {
  const builder = new RangeSetBuilder<LockValue>();
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  for (const [a, b] of sorted) {
    const from = Math.max(1, Math.min(a, doc.lines));
    const to = Math.max(from, Math.min(b, doc.lines));
    builder.add(doc.line(from).from, doc.line(to).to, LOCK);
  }
  return builder.finish();
}

export const lockedField = StateField.define<RangeSet<LockValue>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) if (e.is(setLocked)) next = rangesToSet(tr.state.doc, e.value);
    return next;
  },
});

/** The locked ranges as 1-based line ranges (what `CodeFile.locked` stores). */
export function lockedLines(state: EditorState): LineRange[] {
  const out: LineRange[] = [];
  const iter = state.field(lockedField, false)?.iter();
  if (!iter) return out;
  for (; iter.value; iter.next()) out.push([state.doc.lineAt(iter.from).number, state.doc.lineAt(iter.to).number]);
  return out;
}

/** Whether a line (1-based) is locked. */
export function isLineLocked(state: EditorState, line: number): boolean {
  const set = state.field(lockedField, false);
  if (!set || line < 1 || line > state.doc.lines) return false;
  const l = state.doc.line(line);
  let hit = false;
  set.between(l.from, l.to, () => {
    hit = true;
    return false;
  });
  return hit;
}

/**
 * Whether a change leaves every locked block exactly as it was: same text, still whole lines. Blocks are
 * followed through the change (inserts at their edges land outside them).
 */
export function keepsLockedLines(tr: Transaction): boolean {
  const set = tr.startState.field(lockedField, false);
  if (!set || set.size === 0 || !tr.docChanged) return true;
  const oldDoc = tr.startState.doc;
  const newDoc = tr.newDoc;
  for (let iter = set.iter(); iter.value; iter.next()) {
    const text = oldDoc.sliceString(iter.from, iter.to);
    const from = tr.changes.mapPos(iter.from, 1);
    const to = tr.changes.mapPos(iter.to, -1);
    if (to - from !== text.length || newDoc.sliceString(from, to) !== text) return false;
    if (newDoc.lineAt(from).from !== from || newDoc.lineAt(to).to !== to) return false;
  }
  return true;
}

const refuseLockedEdits = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(lockBypass) || keepsLockedLines(tr)) return tr;
  return { effects: refused.of(tr.startState.selection.main.head) };
});

const refusedField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(refused)) return e.value;
    if (value !== null && (tr.docChanged || tr.selection)) return null;
    return value;
  },
  provide: (f) =>
    showTooltip.from(f, (pos): Tooltip | null =>
      pos === null
        ? null
        : {
            pos,
            above: true,
            create: () => {
              const dom = document.createElement('div');
              dom.className = 'cm-locked-note';
              dom.setAttribute('role', 'status');
              dom.textContent = lockedNoteText;
              return { dom };
            },
          },
    ),
});

/** The note's words (set by the setup with the student's language). */
let lockedNoteText = 'Your teacher locked these lines.';

/** Clears the note a few seconds after it appears, and tells the page (for the live region). */
function refusedNotice(onRefused: () => void) {
  return ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      update(u) {
        const now = u.state.field(refusedField);
        if (now !== null && u.startState.field(refusedField) === null) {
          onRefused();
          clearTimeout(timer);
          timer = setTimeout(() => view.dispatch({ effects: refused.of(null) }), 2600);
        }
      },
      destroy() {
        clearTimeout(timer);
      },
    };
  });
}

class LockMarker extends GutterMarker {
  constructor(
    readonly first: boolean,
    readonly title: string,
  ) {
    super();
  }
  eq(other: LockMarker): boolean {
    return other.first === this.first;
  }
  toDOM(): Node {
    const el = document.createElement('div');
    el.className = this.first ? 'cm-lock cm-lock--first' : 'cm-lock';
    if (this.first) {
      el.title = this.title;
      el.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.4 10.8c3.7-.1 7.5-.1 11.2 0 .1 2.8.1 5.6 0 8.4-3.7.1-7.5.1-11.2 0-.1-2.8-.1-5.6 0-8.4z"/><path d="M8.6 10.8V8.2c0-2 1.5-3.6 3.4-3.6s3.4 1.6 3.4 3.6v2.6"/></svg>';
    }
    return el;
  }
}

function lockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const set = state.field(lockedField);
  const line = Decoration.line({ class: 'cm-locked-line' });
  for (let iter = set.iter(); iter.value; iter.next()) {
    for (let n = state.doc.lineAt(iter.from).number; n <= state.doc.lineAt(iter.to).number; n++) {
      const l = state.doc.line(n);
      builder.add(l.from, l.from, line);
    }
  }
  return builder.finish();
}

export interface LockedOptions {
  ranges: readonly LineRange[];
  /** "Your teacher locked these lines." */
  note: string;
  onRefused(): void;
}

/** Everything locked lines need: the field, the filter, the tint, the gutter marks and the note. */
export function lockedLinesExtension(o: LockedOptions): Extension {
  lockedNoteText = o.note;
  return [
    lockedField.init((state) => rangesToSet(state.doc, o.ranges)),
    refuseLockedEdits,
    refusedField,
    refusedNotice(o.onRefused),
    EditorView.decorations.compute(['doc', lockedField], lockDecorations),
    gutter({
      class: 'cm-lock-gutter',
      lineMarker(view, line) {
        const set = view.state.field(lockedField);
        let marker: LockMarker | null = null;
        set.between(line.from, line.to, (from) => {
          marker = new LockMarker(from === line.from, o.note);
          return false;
        });
        return marker;
      },
      lineMarkerChange: (u) => u.docChanged || u.startState.field(lockedField) !== u.state.field(lockedField),
      initialSpacer: () => new LockMarker(false, ''),
    }),
  ];
}
