import { BLOCK_BY_TYPE, CHARACTER_SPECIAL_LABELS, type BlockSpec } from '../blocks/spec';
import type { BlocksState } from '../project/types';

/**
 * Blocks as text, for the compile request and for telling when a project needs compiling again.
 *
 * Notation: `[words]` the author's own words, `"text"` exact text typed into a slot, `(10)` a
 * number, `[name ▾]` a menu choice (an exact name), `(Fox)` a character, `<...>` a condition.
 */

/** Shape of one block in Blockly's JSON serialization (only the parts the compiler reads). */
export interface JsonBlock {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: JsonBlock; shadow?: JsonBlock }>;
  next?: { block?: JsonBlock };
  icons?: { comment?: { text?: string } };
  enabled?: boolean;
  disabledReasons?: string[];
}

interface JsonComment {
  text?: string;
}

export const MENU_MARK = '▾';

export function isDisabled(b: JsonBlock): boolean {
  return b.enabled === false || (Array.isArray(b.disabledReasons) && b.disabledReasons.length > 0);
}

/** The blocks at the top level of a workspace. */
export function topBlocks(state: BlocksState | null | undefined): JsonBlock[] {
  return ((state?.blocks as { blocks?: JsonBlock[] } | undefined)?.blocks ?? []) as JsonBlock[];
}

/** What fills an input: the dropped block, else the shadow. */
export function inputBlock(b: JsonBlock, name: string): JsonBlock | undefined {
  const slot = b.inputs?.[name];
  if (slot?.block && !isDisabled(slot.block)) return slot.block;
  return slot?.shadow;
}

export function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/\s*\n\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A character's name as people read it ("the mouse", "Fox"). */
export function characterLabel(name: string): string {
  return (CHARACTER_SPECIAL_LABELS as Record<string, string>)[name] ?? name;
}

export interface RenderOptions {
  /** Text to add after a block (the compiler marks the parts written in words). */
  mark?(b: JsonBlock): string | undefined;
}

/** One block with its inputs, as text (not the blocks it wraps or that follow it). */
export function blockText(b: JsonBlock, opts: RenderOptions = {}): string {
  const spec = BLOCK_BY_TYPE.get(b.type);
  const text = spec ? spec.label.replace(/\{([A-Z_]+)\}/g, (_, name: string) => (name === 'FLAG' ? '⚑' : inputText(b, spec, name, opts))) : `(unknown block "${b.type}")`;
  const mark = opts.mark?.(b);
  return mark ? `${text} ${mark}` : text;
}

function inputText(b: JsonBlock, spec: BlockSpec, name: string, opts: RenderOptions): string {
  const input = spec.inputs?.[name];
  switch (input?.kind) {
    case 'text':
      return `[${oneLine(b.fields?.[name]) || '…'}]`;
    case 'label':
      return oneLine(b.fields?.[name]);
    case 'menu':
      return `[${oneLine(b.fields?.[name]) || '…'} ${MENU_MARK}]`;
    case 'number':
    case 'value':
    case 'character':
    case 'condition': {
      const inner = inputBlock(b, name);
      if (!inner) return input.kind === 'condition' ? '<>' : '()';
      return valueText(inner, opts);
    }
    default:
      return '';
  }
}

/** A block in a slot: typed values, characters, reporters and conditions. */
export function valueText(v: JsonBlock, opts: RenderOptions = {}): string {
  switch (v.type) {
    case 'sh_num':
      return `(${oneLine(v.fields?.NUM) || '0'})`;
    case 'sh_txt':
      return JSON.stringify(oneLine(v.fields?.TEXT));
    case 'char_menu':
    case 'char_ref':
      return `(${characterLabel(oneLine(v.fields?.NAME))})`;
    default: {
      const inner = blockText(v, opts);
      return BLOCK_BY_TYPE.get(v.type)?.shape === 'boolean' ? `<${inner}>` : `(${inner})`;
    }
  }
}

function renderChain(first: JsonBlock | undefined, depth: number, out: string[], opts: RenderOptions): void {
  let b = first;
  while (b) {
    if (!isDisabled(b)) renderStatement(b, depth, out, opts);
    b = b.next?.block;
  }
}

function renderStatement(b: JsonBlock, depth: number, out: string[], opts: RenderOptions): void {
  const pad = '  '.repeat(depth);
  const spec = BLOCK_BY_TYPE.get(b.type);
  out.push(pad + blockText(b, opts));
  const comment = b.icons?.comment?.text?.trim();
  if (comment) out.push(`${pad}  # note: ${oneLine(comment)}`);
  if (!spec) return;
  if (spec.shape === 'c' || spec.shape === 'c-end' || spec.shape === 'e') {
    const inner = b.inputs?.SUBSTACK?.block;
    if (inner) renderChain(inner, depth + 1, out, opts);
    else out.push(`${pad}  (empty)`);
  }
  if (spec.shape === 'e') {
    out.push(pad + (spec.elseLabel ?? 'else'));
    const inner = b.inputs?.SUBSTACK2?.block;
    if (inner) renderChain(inner, depth + 1, out, opts);
    else out.push(`${pad}  (empty)`);
  }
}

/** A script (a hat block and everything under it), one line per block, indented. */
export function scriptLines(hat: JsonBlock, opts: RenderOptions = {}): string[] {
  const lines: string[] = [];
  renderStatement(hat, 0, lines, opts);
  renderChain(hat.next?.block, 1, lines, opts);
  if (lines.length === 1) lines.push('  (no blocks yet)');
  return lines;
}

export interface SerializedScripts {
  text: string;
  scripts: number;
}

/**
 * A target's program as text. Like Scratch, only scripts that start with a hat block run, so
 * loose blocks are left out. Standalone blocks (brief, rules, checks) and comments count.
 */
export function serializeBlocks(state: BlocksState | null | undefined, opts: RenderOptions = {}): SerializedScripts {
  const comments = ((state?.workspaceComments as JsonComment[] | undefined) ?? []).map((c) => oneLine(c.text)).filter(Boolean);
  const scripts: string[][] = [];
  const standalone: string[] = [];
  for (const b of topBlocks(state)) {
    if (isDisabled(b)) continue;
    const shape = BLOCK_BY_TYPE.get(b.type)?.shape;
    if (shape === 'rule') standalone.push(blockText(b, opts));
    else if (shape === 'hat') scripts.push(scriptLines(b, opts));
  }
  const out: string[] = [];
  for (const line of standalone) out.push(line);
  scripts.forEach((lines, i) => {
    out.push(`Script ${i + 1}:`);
    out.push(...lines.map((l) => '  ' + l));
  });
  for (const c of comments) out.push(`Note from the author: ${c}`);
  return { text: out.join('\n'), scripts: scripts.length };
}
