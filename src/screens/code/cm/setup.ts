/**
 * The editor for one file of a world (§2.12): CodeMirror 6 with line numbers, JavaScript highlighting in
 * the Night Trail theme, search, bracket matching, kit autocomplete and hover docs, validator diagnostics
 * (pushed by the session), the provenance gutter, teacher locks, art-key chips and Explain notes. Each
 * file keeps its own EditorState (and undo history); one EditorView shows the active one.
 */
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { lintGutter, lintKeymap } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';
import type { LineRange } from '../../../model/types';
import { artChips, type ArtChipOptions } from './artChips';
import { explainNotes } from './explain';
import { provenanceExtension, type Baseline } from './gutter';
import { kitAutocomplete, kitHover } from './kitDocs';
import { lockedLinesExtension } from './locked';
import { ambleCodeTheme } from './theme';
import { wrapIndent } from './wrapIndent';

export interface FileEditorOptions {
  path: string;
  /** What the editor starts with (the running version, or unrun changes brought back). */
  doc: string;
  /** The running version, for provenance. */
  baseline: Baseline;
  locked: readonly LineRange[];
  labels: { editor: string; locked: string; closeNote: string; draw: string };
  chips: ArtChipOptions['chips'];
  onDraw(key: string): void;
  onLockedRefused(): void;
  onUpdate(update: ViewUpdate): void;
}

export function fileExtensions(o: FileEditorOptions): Extension {
  return [
    lintGutter({ hoverTime: 250 }),
    lineNumbers(),
    lockedLinesExtension({ ranges: o.locked, note: o.labels.locked, onRefused: o.onLockedRefused }),
    provenanceExtension(o.baseline),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    javascript(),
    ambleCodeTheme,
    kitAutocomplete(),
    kitHover(),
    artChips({ chips: o.chips, onDraw: o.onDraw, drawLabel: o.labels.draw }),
    explainNotes(o.labels.closeNote),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    EditorView.lineWrapping,
    wrapIndent,
    EditorView.contentAttributes.of({ 'aria-label': o.labels.editor }),
    EditorView.updateListener.of(o.onUpdate),
  ];
}

export function fileState(o: FileEditorOptions): EditorState {
  return EditorState.create({ doc: o.doc, extensions: fileExtensions(o) });
}

export function createView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent });
}
