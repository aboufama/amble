/**
 * The Night Trail code theme (§2.12, §3): JetBrains Mono 14/22 on the night well, numbers in lantern amber
 * (the thing to change first), strings in firefly mint, keywords in plum, comments in the quiet text
 * colour. Every colour is a token (code.css maps them per theme), so Day and High contrast just work.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--code-text)',
    backgroundColor: 'var(--code-bg)',
    font: 'var(--type-code)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-code)',
    lineHeight: '1.375rem',
    fontVariantLigatures: 'none',
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--line) transparent',
  },
  '.cm-content': { padding: '10px 0 40px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 16px 0 10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--code-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-gutters': {
    color: 'var(--code-gutter-text)',
    backgroundColor: 'var(--code-bg)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 14px', minWidth: '34px' },
  '.cm-activeLineGutter': { color: 'var(--code-text)', backgroundColor: 'var(--code-active-line)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    color: 'inherit',
    backgroundColor: 'var(--code-bracket)',
    outline: '1px solid var(--alive)',
  },
  '.cm-nonmatchingBracket': { outline: '1px solid var(--warn)' },
  '.cm-searchMatch': { backgroundColor: 'var(--code-search)', outline: '1px solid var(--accent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--code-selection-match)' },
  '.cm-tooltip': {
    border: 'none',
    borderRadius: '12px',
    color: 'var(--text)',
    backgroundColor: 'var(--surface-raised)',
    boxShadow: 'var(--lift-sm), inset 0 0 0 1px var(--line-control)',
    font: 'var(--type-body)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-code)', maxHeight: '15em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px', lineHeight: '1.6' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { color: 'var(--on-accent)', backgroundColor: 'var(--accent)' },
  '.cm-completionDetail': { marginLeft: '0.6em', fontStyle: 'normal', opacity: '0.75' },
  '.cm-completionInfo': { padding: '8px 12px', maxWidth: '280px', font: 'var(--type-meta)' },
  '.cm-tooltip-lint': { padding: '0' },
  '.cm-diagnostic': { padding: '8px 12px', borderLeft: '4px solid transparent', font: 'var(--type-body)', whiteSpace: 'normal', maxWidth: '420px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--warn)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--accent)' },
  '.cm-diagnostic-info': { borderLeftColor: 'var(--ai)' },
  '.cm-diagnosticSource': { display: 'none' },
  '.cm-diagnosticAction': {
    marginLeft: '10px',
    padding: '4px 12px',
    border: 'none',
    borderRadius: '10px',
    font: 'var(--type-chip)',
    color: 'var(--on-accent)',
    backgroundColor: 'var(--accent)',
    cursor: 'pointer',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--warn)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--accent)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-panels': { color: 'var(--text)', backgroundColor: 'var(--surface-raised)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-panel.cm-search': { padding: '8px 12px', font: 'var(--type-chip)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { font: 'var(--type-chip)' },
  '.cm-textfield': {
    padding: '4px 8px',
    border: 'none',
    borderRadius: '8px',
    color: 'var(--text)',
    backgroundColor: 'var(--well)',
    boxShadow: 'inset 0 0 0 1.5px var(--line-control)',
  },
  '.cm-button': {
    padding: '4px 10px',
    border: 'none',
    borderRadius: '8px',
    color: 'var(--text)',
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    boxShadow: 'inset 0 0 0 1.5px var(--line-control)',
  },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--code-keyword)' },
  { tag: [t.self, t.null, t.bool, t.atom], color: 'var(--code-atom)' },
  { tag: [t.number], color: 'var(--code-number)', fontWeight: '700' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--code-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)' },
  { tag: [t.className, t.typeName, t.namespace], color: 'var(--code-class)' },
  { tag: [t.function(t.propertyName), t.function(t.variableName)], color: 'var(--code-call)' },
  { tag: [t.definition(t.propertyName), t.definition(t.variableName), t.definition(t.function(t.variableName))], color: 'var(--code-def)' },
  { tag: [t.propertyName], color: 'var(--code-prop)' },
  { tag: [t.variableName], color: 'var(--code-text)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--code-punct)' },
  { tag: t.invalid, color: 'var(--warn)' },
]);

export const ambleCodeTheme: Extension = [theme, syntaxHighlighting(highlight)];
