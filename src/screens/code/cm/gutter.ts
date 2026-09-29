/**
 * The provenance gutter (§2.12): a quiet 3 px bar per line, one hue for lines that came from a wish, one
 * for lines the student wrote or changed (live, while typing), one for a teacher's, nothing for the
 * starter's; hovering a bar says which ("From a wish", "You wrote this"). The baseline is the version the
 * world runs; edits since then count as the student's.
 */
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { GutterMarker, gutter } from '@codemirror/view';
import { attributeLines, expandAuthors, linesOf } from '../../../history/provenance';
import type { Author, AuthorRun } from '../../../model/types';

export interface Baseline {
  source: string;
  authors: readonly AuthorRun[];
}

/** Resets the version the student's edits are measured against (after Run it, or a new version). */
export const setBaseline = StateEffect.define<Baseline>();

interface Provenance {
  lines: string[];
  authors: Author[];
  live: Author[];
}

function provenanceOf(baseline: Baseline, doc: string): Provenance {
  const lines = linesOf(baseline.source);
  const authors = expandAuthors(baseline.authors, lines.length);
  return { lines, authors, live: attributeLines(lines, authors, linesOf(doc), 'student') };
}

export const provenanceField = StateField.define<Provenance>({
  create: (state) => ({ lines: [], authors: [], live: new Array<Author>(state.doc.lines).fill('starter') }),
  update(value, tr) {
    let base = value;
    for (const e of tr.effects) if (e.is(setBaseline)) base = provenanceOf(e.value, tr.state.doc.toString());
    if (base !== value) return base;
    if (!tr.docChanged) return value;
    return { ...value, live: attributeLines(value.lines, value.authors, linesOf(tr.state.doc.toString()), 'student') };
  },
});

/** Who wrote a line (1-based) as the student sees it now. */
export function authorOfLine(state: EditorState, line: number): Author {
  return state.field(provenanceField, false)?.live[line - 1] ?? 'starter';
}

/** The current per-line authors (what Run it would store). */
export function liveAuthors(state: EditorState): Author[] {
  return state.field(provenanceField, false)?.live ?? [];
}

class AuthorMarker extends GutterMarker {
  constructor(
    readonly who: Author,
    readonly title: string,
  ) {
    super();
  }
  eq(other: AuthorMarker): boolean {
    return other.who === this.who && other.title === this.title;
  }
  toDOM(): Node {
    const el = document.createElement('div');
    el.className = `cm-prov cm-prov--${this.who}`;
    if (this.title) el.title = this.title;
    return el;
  }
}

/** What hovering a bar says, per author (the starter's lines have no bar). */
export type AuthorTitles = Record<Exclude<Author, 'starter'>, string>;

export function provenanceExtension(baseline: Baseline, titles: AuthorTitles = { ai: '', student: '', teacher: '' }): Extension {
  const MARKERS: Record<Exclude<Author, 'starter'>, AuthorMarker> = {
    ai: new AuthorMarker('ai', titles.ai),
    student: new AuthorMarker('student', titles.student),
    teacher: new AuthorMarker('teacher', titles.teacher),
  };
  return [
    provenanceField.init((state) => provenanceOf(baseline, state.doc.toString())),
    gutter({
      class: 'cm-prov-gutter',
      lineMarker(view, line) {
        const who = authorOfLine(view.state, view.state.doc.lineAt(line.from).number);
        return who === 'starter' ? null : MARKERS[who];
      },
      lineMarkerChange: (u) => u.startState.field(provenanceField) !== u.state.field(provenanceField),
    }),
  ];
}
