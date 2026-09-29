/**
 * The text a game will show on screen, found by where it is used: titles and asks in the statics,
 * `ui.*` and `add.text` arguments, `win`/`lose` messages, speech (`say`), and dialogue lists. Only
 * these go through the output safety check; code (`killSlime()`, `bloodParticles`) never does.
 */
import type { AnyNode, Expression, Program, SpreadElement } from 'acorn';
import { ancestor } from 'acorn-walk';
import type { JsonValue } from '../json/schema';
import { lineOf, memberPath, propertyName } from './ast';
import type { VisibleString } from './types';

/** Names of lists that hold lines of text. */
const DIALOGUE_NAME = /dialog|lines|messages|quotes|taunts|speech|story|captions|hints|tips|texts?$|names$|titles$/i;
const STATIC_TEXT_KEYS = new Set(['title', 'subtitle', 'name', 'ask', 'about', 'label', 'caption', 'words', 'text', 'hint', 'description']);

/** The shown text in an expression: literals, template text, and the literal parts of `+` joins. */
function texts(n: Expression | SpreadElement | AnyNode | null | undefined): string[] {
  if (!n) return [];
  switch (n.type) {
    case 'Literal':
      return typeof n.value === 'string' ? [n.value] : [];
    case 'TemplateLiteral': {
      const t = n.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' … ').trim();
      return t ? [t] : [];
    }
    case 'BinaryExpression':
      return n.operator === '+' ? [[...texts(n.left), ...texts(n.right)].join(' … ')].filter(Boolean) : [];
    case 'ConditionalExpression':
      return [...texts(n.consequent), ...texts(n.alternate)];
    case 'LogicalExpression':
      return [...texts(n.left), ...texts(n.right)];
    default:
      return [];
  }
}

/** Worth checking: has letters, and isn't a color or a bare identifier-like key. */
function shown(t: string): boolean {
  return /\p{L}/u.test(t) && !/^#[0-9a-f]{3,8}$/i.test(t.trim());
}

/** Which arguments of a call are shown on screen, by callee. */
function shownArgs(callee: string, prop: string): number[] | 'all' | null {
  if (/^this\.ui\.\w+$/.test(callee)) return 'all';
  if (callee === 'this.add.text' || callee === 'this.make.text') return [2];
  if (callee === 'this.add.bitmapText') return [3];
  if (callee === 'this.win' || callee === 'this.lose' || callee === 'this.announce') return [0];
  if (prop === 'setText' || prop === 'say' || prop === 'speak' || prop === 'toast' || prop === 'banner') return [0];
  return null;
}

function staticTexts(value: JsonValue, path: string, out: Array<{ text: string; where: string }>): void {
  if (typeof value === 'string') return;
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'string') out.push({ text: v, where: path });
    return;
  }
  if (!value || typeof value !== 'object') return;
  const where = (k: string) => `${path.split('.')[0]}.${k}`;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      if (STATIC_TEXT_KEYS.has(k)) out.push({ text: v, where: where(k) });
    } else if (Array.isArray(v)) {
      if (STATIC_TEXT_KEYS.has(k)) {
        for (const x of v) if (typeof x === 'string') out.push({ text: x, where: where(k) });
      }
    } else if (v && typeof v === 'object') {
      staticTexts(v, `${path}.${k}`, out);
    }
  }
}

/** Visible strings in one file. `statics` are the Game class's literal statics (entry file only). */
export function visibleStrings(file: string, ast: Program, statics: Record<string, JsonValue>, staticLines: Record<string, number>): VisibleString[] {
  const out: VisibleString[] = [];
  const push = (text: string, line: number, where: string) => {
    const t = text.trim();
    if (t && shown(t)) out.push({ text: t, file, line, where });
  };
  for (const [name, value] of Object.entries(statics)) {
    const found: Array<{ text: string; where: string }> = [];
    staticTexts(value, name, found);
    for (const f of found) push(f.text, staticLines[name] ?? 0, f.where);
  }
  ancestor(ast, {
    CallExpression(n) {
      const callee = memberPath(n.callee);
      const which = shownArgs(callee, propertyName(n.callee));
      if (!which) return;
      const where = callee.replace(/^this\./, '') || propertyName(n.callee);
      const args = which === 'all' ? n.arguments : which.map((i) => n.arguments[i]);
      for (const a of args) for (const t of texts(a)) push(t, lineOf(n), where);
    },
    VariableDeclarator(n) {
      if (n.id.type === 'Identifier' && DIALOGUE_NAME.test(n.id.name) && n.init?.type === 'ArrayExpression') {
        for (const el of n.init.elements) for (const t of texts(el)) push(t, lineOf(el), 'dialogue');
      }
    },
    AssignmentExpression(n) {
      const name = propertyName(n.left) || (n.left.type === 'Identifier' ? n.left.name : '');
      if (name && DIALOGUE_NAME.test(name) && n.right.type === 'ArrayExpression') {
        for (const el of n.right.elements) for (const t of texts(el)) push(t, lineOf(el), 'dialogue');
      }
    },
    Property(n) {
      const key = n.key.type === 'Identifier' && !n.computed ? n.key.name : '';
      if (key && DIALOGUE_NAME.test(key) && n.value.type === 'ArrayExpression') {
        for (const el of n.value.elements) for (const t of texts(el)) push(t, lineOf(el), 'dialogue');
      }
    },
  });
  return out;
}
