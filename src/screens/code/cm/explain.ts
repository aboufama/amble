/**
 * Explain this (§2.12): notes that sit right under the lines they explain. With the AI helper on, a
 * dusk-blue note with its answer (and notes for line ranges); with it off, the docs of every kit call in
 * the selection. Notes move with their lines and close with ✕.
 */
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

export interface ExplainNote {
  id: number;
  /** Where the note hangs: the end of the last explained line. */
  pos: number;
  kind: 'ai' | 'docs' | 'waiting' | 'problem';
  label: string;
  /** A paragraph (the AI's answer, or a short message). */
  text?: string;
  /** Line notes from the AI ("Lines 12 to 14" → what they do). */
  lines?: Array<{ where: string; note: string }>;
  /** Kit docs (with the AI off). */
  docs?: Array<{ call: string; doc: string }>;
}

export const addNote = StateEffect.define<ExplainNote>({ map: (n, change) => ({ ...n, pos: change.mapPos(n.pos, 1) }) });
export const removeNote = StateEffect.define<number>();

class NoteWidget extends WidgetType {
  constructor(
    readonly note: ExplainNote,
    readonly closeLabel: string,
  ) {
    super();
  }

  eq(other: NoteWidget): boolean {
    const a = other.note;
    const b = this.note;
    return a.id === b.id && a.kind === b.kind && a.text === b.text && a.lines === b.lines && a.docs === b.docs && a.label === b.label;
  }

  toDOM(view: EditorView): HTMLElement {
    const n = this.note;
    const box = document.createElement('div');
    box.className = `cm-explain cm-explain--${n.kind}`;
    box.setAttribute('role', 'note');
    const head = document.createElement('div');
    head.className = 'cm-explain__head';
    const label = document.createElement('span');
    label.className = 'cm-explain__label';
    label.textContent = n.label;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cm-explain__close';
    close.setAttribute('aria-label', this.closeLabel);
    close.title = this.closeLabel;
    close.textContent = '✕';
    close.addEventListener('click', () => view.dispatch({ effects: removeNote.of(n.id) }));
    head.append(label, close);
    box.append(head);
    if (n.text) {
      const p = document.createElement('p');
      p.className = 'cm-explain__text';
      p.textContent = n.text;
      box.append(p);
    }
    if (n.lines?.length) {
      const list = document.createElement('ul');
      list.className = 'cm-explain__lines';
      for (const l of n.lines) {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = `${l.where} `;
        li.append(b, l.note);
        list.append(li);
      }
      box.append(list);
    }
    if (n.docs?.length) {
      const list = document.createElement('ul');
      list.className = 'cm-explain__docs';
      for (const d of n.docs) {
        const li = document.createElement('li');
        const code = document.createElement('code');
        code.textContent = d.call;
        const p = document.createElement('span');
        p.textContent = d.doc;
        li.append(code, p);
        list.append(li);
      }
      box.append(list);
    }
    return box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function explainNotes(closeLabel: string): Extension {
  const field = StateField.define<ExplainNote[]>({
    create: () => [],
    update(notes, tr) {
      let next = tr.docChanged ? notes.map((n) => ({ ...n, pos: Math.min(tr.changes.mapPos(n.pos, 1), tr.state.doc.length) })) : notes;
      for (const e of tr.effects) {
        if (e.is(addNote)) next = [...next.filter((n) => n.id !== e.value.id), e.value];
        else if (e.is(removeNote)) next = next.filter((n) => n.id !== e.value);
      }
      return next;
    },
    provide: (f) =>
      EditorView.decorations.from(f, (notes): DecorationSet =>
        Decoration.set(
          notes.map((n) => Decoration.widget({ widget: new NoteWidget(n, closeLabel), block: true, side: 1 }).range(n.pos)),
          true,
        ),
      ),
  });
  return field;
}
