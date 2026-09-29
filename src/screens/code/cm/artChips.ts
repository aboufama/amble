/**
 * Art-key chips (§2.12): every string in the code that names a cast member ('moonKing') shows a 16 px
 * thumbnail of the student's drawing, or the member's just-bones glyph with **Draw it**. Hovering the
 * string shows the drawing bigger.
 */
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, hoverTooltip, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Role } from '../../../model/types';

export interface ArtChipInfo {
  key: string;
  name: string;
  drawn: boolean;
  /** Object URL of the drawing's thumbnail (drawn members). */
  thumb: string | null;
  role: Role;
  /** "Pip, drawn by you" / "Grumble, just bones". */
  label: string;
}

export interface ArtChipOptions {
  chips(): ReadonlyMap<string, ArtChipInfo>;
  onDraw(key: string): void;
  drawLabel: string;
}

/** Tells the chips that the drawings changed (a thumbnail arrived, something was drawn). */
export const chipsChanged = StateEffect.define<null>();

const SVG = 'http://www.w3.org/2000/svg';

/** A tiny just-bones glyph: a role-tinted dome, a dashed cream edge and one mint star-joint. */
function glyph(role: Role): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('cm-art-glyph', `tint-${role === 'enemyShot' ? 'projectile' : role === 'background' ? 'decor' : role}`);
  const dome = 'M2.5 14.5C2 8 4.6 2.5 8 2.5s6 5.5 5.5 12Z';
  const fill = document.createElementNS(SVG, 'path');
  fill.setAttribute('d', dome);
  fill.setAttribute('class', 'cm-art-glyph__fill');
  const edge = document.createElementNS(SVG, 'path');
  edge.setAttribute('d', dome);
  edge.setAttribute('class', 'cm-art-glyph__edge');
  const joint = document.createElementNS(SVG, 'circle');
  joint.setAttribute('cx', '8');
  joint.setAttribute('cy', '8.5');
  joint.setAttribute('r', '1.6');
  joint.setAttribute('class', 'cm-art-glyph__joint');
  svg.append(fill, edge, joint);
  return svg;
}

class ArtChipWidget extends WidgetType {
  constructor(
    readonly info: ArtChipInfo,
    readonly o: ArtChipOptions,
  ) {
    super();
  }

  eq(other: ArtChipWidget): boolean {
    return other.info.key === this.info.key && other.info.drawn === this.info.drawn && other.info.thumb === this.info.thumb;
  }

  toDOM(): HTMLElement {
    const { info } = this;
    if (info.drawn) {
      const chip = document.createElement('span');
      chip.className = 'cm-art-chip cm-art-chip--drawn';
      chip.setAttribute('role', 'img');
      chip.setAttribute('aria-label', info.label);
      if (info.thumb) {
        const img = document.createElement('img');
        img.src = info.thumb;
        img.alt = '';
        img.draggable = false;
        chip.append(img);
      }
      return chip;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-art-chip cm-art-chip--bones';
    button.setAttribute('aria-label', `${info.label}. ${this.o.drawLabel}`);
    const label = document.createElement('span');
    label.className = 'cm-art-chip__label';
    label.textContent = this.o.drawLabel;
    button.append(glyph(info.role), label);
    button.addEventListener('click', (e) => {
      e.preventDefault();
      this.o.onDraw(info.key);
    });
    return button;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Properties whose string values are words, not art keys (`role: 'hero'` names a role even when a cast
 * member is called "hero").
 */
const NOT_ART_KEYS = new Set(['role', 'kind', 'rig', 'facing', 'shape', 'pronoun', 'physics', 'aim', 'draw', 'blend', 'name', 'ask', 'about', 'label', 'words', 'title', 'subtitle', 'sub', 'text', 'unit', 'caption', 'preset', 'wave', 'who']);

/** Calls whose string arguments are words (a music style, a sound, a move, text on screen), not art keys. */
const NOT_ART_CALLS = new Set(['play', 'sfx', 'weather', 'hint', 'big', 'pop', 'say', 'text', 'bossBar', 'win', 'lose', 'dialogue', 'button', 'isOn', 'cooldown', 'go', 'tune', 'face', 'setLevel']);

function propertyNameOf(view: EditorView, node: SyntaxNode): string | null {
  const parent = node.parent;
  if (parent?.name !== 'Property') return null;
  const first = parent.firstChild;
  if (!first || first.from === node.from) return null;
  return view.state.doc.sliceString(first.from, first.to).replace(/^['"]|['"]$/g, '');
}

/** The name of the function a string is passed to (`music.play('boss')` → 'play'). */
function calleeOf(view: EditorView, node: SyntaxNode): string | null {
  if (node.parent?.name !== 'ArgList') return null;
  const call = node.parent.parent;
  const callee = call?.name === 'CallExpression' ? call.firstChild : null;
  if (!callee) return null;
  return /([A-Za-z_$][\w$]*)\s*$/.exec(view.state.doc.sliceString(callee.from, callee.to))?.[1] ?? null;
}

/** String literals (quotes stripped) that name a cast member, with their ranges. */
function artStrings(view: EditorView, chips: ReadonlyMap<string, ArtChipInfo>, visit: (from: number, to: number, info: ArtChipInfo) => void, range?: { from: number; to: number }): void {
  const ranges = range ? [range] : view.visibleRanges;
  for (const { from, to } of ranges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.name !== 'String') return;
        const info = chips.get(view.state.doc.sliceString(ref.from + 1, ref.to - 1));
        if (!info) return;
        const prop = propertyNameOf(view, ref.node);
        if (prop && NOT_ART_KEYS.has(prop)) return;
        const callee = calleeOf(view, ref.node);
        if (callee && NOT_ART_CALLS.has(callee)) return;
        visit(ref.from, ref.to, info);
      },
    });
  }
}

export function artChips(o: ArtChipOptions): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    artStrings(view, o.chips(), (from, _to, info) => builder.add(from, from, Decoration.widget({ widget: new ArtChipWidget(info, o), side: -1 })));
    return builder.finish();
  };
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        const refresh = u.transactions.some((tr) => tr.effects.some((e) => e.is(chipsChanged)));
        if (u.docChanged || u.viewportChanged || refresh || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
  const hover = hoverTooltip((view, pos) => {
    let found: { from: number; to: number; info: ArtChipInfo } | null = null;
    artStrings(view, o.chips(), (from, to, info) => {
      if (pos >= from && pos <= to) found = { from, to, info };
    }, { from: view.state.doc.lineAt(pos).from, to: view.state.doc.lineAt(pos).to });
    const hit = found as { from: number; to: number; info: ArtChipInfo } | null;
    if (!hit) return null;
    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-art-peek';
        if (hit.info.drawn && hit.info.thumb) {
          const img = document.createElement('img');
          img.src = hit.info.thumb;
          img.alt = '';
          dom.append(img);
        } else {
          const big = glyph(hit.info.role);
          big.setAttribute('width', '56');
          big.setAttribute('height', '56');
          dom.append(big);
        }
        const label = document.createElement('p');
        label.textContent = hit.info.label;
        dom.append(label);
        return { dom };
      },
    };
  });
  return [plugin, hover];
}
