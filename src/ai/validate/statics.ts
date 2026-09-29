/**
 * Reading `static art = {...}` (and config, dials, tune, sounds) without running the game: the
 * editor lists art requests, dials and captions from these literals, so they must be plain values.
 */
import { parseExpressionAt, type AnyNode, type Class, type PropertyDefinition } from 'acorn';
import type { JsonValue } from '../json/schema';
import { keyName } from './ast';

export type LiteralRead = { ok: true; value: JsonValue } | { ok: false; node: AnyNode };

/** The JSON value of a literal expression: objects, arrays, strings, numbers, booleans, null. */
export function literalValue(n: AnyNode): LiteralRead {
  switch (n.type) {
    case 'Literal':
      if (n.value === null || typeof n.value === 'string' || typeof n.value === 'number' || typeof n.value === 'boolean') return { ok: true, value: n.value };
      return { ok: false, node: n };
    case 'TemplateLiteral':
      return n.expressions.length === 0 ? { ok: true, value: n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('') } : { ok: false, node: n };
    case 'UnaryExpression':
      if ((n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return { ok: true, value: n.operator === '-' ? -n.argument.value : n.argument.value };
      return { ok: false, node: n };
    case 'ArrayExpression': {
      const out: JsonValue[] = [];
      for (const el of n.elements) {
        if (!el || el.type === 'SpreadElement') return { ok: false, node: el ?? n };
        const v = literalValue(el);
        if (!v.ok) return v;
        out.push(v.value);
      }
      return { ok: true, value: out };
    }
    case 'ObjectExpression': {
      const out: { [key: string]: JsonValue } = {};
      for (const p of n.properties) {
        if (p.type !== 'Property' || p.kind !== 'init' || p.method) return { ok: false, node: p };
        const key = p.key.type === 'Literal' && (typeof p.key.value === 'string' || typeof p.key.value === 'number') ? String(p.key.value) : keyName(p.key, p.computed);
        if (!key) return { ok: false, node: p.key };
        const v = literalValue(p.value);
        if (!v.ok) return v;
        out[key] = v.value;
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false, node: n };
  }
}

/** A class's `static name = value` fields. */
export function staticFields(cls: Class): Map<string, PropertyDefinition> {
  const out = new Map<string, PropertyDefinition>();
  for (const m of cls.body.body) {
    if (m.type !== 'PropertyDefinition' || !m.static) continue;
    const name = keyName(m.key, m.computed);
    if (name) out.set(name, m);
  }
  return out;
}

/** Statics the editor reads; they must be literals. */
export const MANIFEST_STATICS = ['config', 'art', 'dials', 'tune', 'sounds', 'twists'];

/** The literal values of a class's statics, and the manifest statics that aren't literals. */
export function readStatics(cls: Class): { values: Record<string, JsonValue>; nonLiteral: Array<{ name: string; node: AnyNode }> } {
  const values: Record<string, JsonValue> = {};
  const nonLiteral: Array<{ name: string; node: AnyNode }> = [];
  for (const [name, field] of staticFields(cls)) {
    if (!field.value) continue;
    const v = literalValue(field.value);
    if (v.ok) values[name] = v.value;
    else if (MANIFEST_STATICS.includes(name)) nonLiteral.push({ name, node: v.node });
  }
  return { values, nonLiteral };
}

/** Where the bracket opened at `open` closes, skipping strings and comments; -1 if it doesn't (yet). */
function matchBracket(text: string, open: number): number {
  const closeFor: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (closeFor[ch]) stack.push(closeFor[ch]);
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * Reads `static <name> = {...}` from code that may still be arriving (a streamed reply), as soon as
 * its literal is complete. Undefined until then, or when it isn't a plain literal.
 */
export function peekStaticLiteral(partialCode: string, name: string): JsonValue | undefined {
  const m = new RegExp(`\\bstatic\\s+${name}\\s*=\\s*`).exec(partialCode);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  if (partialCode[start] !== '{' && partialCode[start] !== '[') return undefined;
  if (matchBracket(partialCode, start) < 0) return undefined;
  try {
    const expr = parseExpressionAt(partialCode, start, { ecmaVersion: 'latest' });
    const v = literalValue(expr);
    return v.ok ? v.value : undefined;
  } catch {
    return undefined;
  }
}
