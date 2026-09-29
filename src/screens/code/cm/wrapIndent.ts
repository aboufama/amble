/**
 * Wrapped lines keep their indentation (plus a small hang), so a long `static art` entry still reads as
 * one indented line of code instead of spilling to the left edge.
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

const HANG = 2;
const cache = new Map<number, Decoration>();

function indentDeco(columns: number): Decoration {
  let deco = cache.get(columns);
  if (!deco) {
    const hang = columns + HANG;
    deco = Decoration.line({ attributes: { style: `padding-left: calc(10px + ${hang}ch); text-indent: -${hang}ch` } });
    cache.set(columns, deco);
  }
  return deco;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tab = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      let columns = 0;
      for (const ch of line.text) {
        if (ch === ' ') columns++;
        else if (ch === '\t') columns += tab;
        else break;
      }
      builder.add(line.from, line.from, indentDeco(Math.min(columns, 40)));
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const wrapIndent: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
