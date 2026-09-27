import { BLOCK_BY_TYPE, type BlockSpec } from '../blocks/spec';
import type { BlocksState } from '../project/types';

/** Shape of one block in Blockly's JSON serialization (only the parts we read). */
interface JsonBlock {
  type: string;
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

function isDisabled(b: JsonBlock): boolean {
  return b.enabled === false || (Array.isArray(b.disabledReasons) && b.disabledReasons.length > 0);
}

/** What the author typed: `[jump up high]`. */
function fieldText(value: unknown): string {
  const s = String(value ?? '').replace(/\s*\n\s*/g, ' / ').trim();
  return `[${s || '…'}]`;
}

/** A value picked from a dropdown menu, an exact name or option: `[costume2 ▾]`. */
export const MENU_MARK = '▾';

function menuText(value: unknown): string {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return `[${s || '…'} ${MENU_MARK}]`;
}

function blockLine(b: JsonBlock, spec: BlockSpec | undefined, label = spec?.label): string {
  if (!spec || !label) return `(${b.type})`;
  return label.replace(/\{([A-Z_]+)\}/g, (_, name: string) => {
    if (name === 'FLAG') return 'green flag';
    return spec.menus?.[name] ? menuText(b.fields?.[name]) : fieldText(b.fields?.[name]);
  });
}

function renderChain(first: JsonBlock | undefined, depth: number, out: string[]): void {
  let b = first;
  while (b) {
    if (!isDisabled(b)) renderBlock(b, depth, out);
    b = b.next?.block;
  }
}

function renderBlock(b: JsonBlock, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth);
  const spec = BLOCK_BY_TYPE.get(b.type);
  out.push(pad + blockLine(b, spec));
  const comment = b.icons?.comment?.text?.trim();
  if (comment) out.push(`${pad}  # note: ${comment.replace(/\s*\n\s*/g, ' / ')}`);
  if (!spec) return;
  if (spec.shape === 'c' || spec.shape === 'c-end' || spec.shape === 'e') {
    const inner = b.inputs?.SUBSTACK?.block;
    if (inner) renderChain(inner, depth + 1, out);
    else out.push(`${pad}  (empty)`);
  }
  if (spec.shape === 'e') {
    out.push(pad + (spec.elseLabel ?? 'else'));
    const inner = b.inputs?.SUBSTACK2?.block;
    if (inner) renderChain(inner, depth + 1, out);
    else out.push(`${pad}  (empty)`);
  }
}

export interface SerializedScripts {
  text: string;
  scripts: number;
}

/** Turns a sprite's blocks into indented pseudo-code for the compiler prompt. */
export function serializeBlocks(state: BlocksState | null | undefined): SerializedScripts {
  const top = ((state?.blocks as { blocks?: JsonBlock[] } | undefined)?.blocks ?? []) as JsonBlock[];
  const comments = ((state?.workspaceComments as JsonComment[] | undefined) ?? []).map((c) => c.text?.trim()).filter(Boolean);
  const scripts: string[][] = [];
  const rules: string[] = [];
  const loose: string[][] = [];

  for (const b of top) {
    if (isDisabled(b)) continue;
    const spec = BLOCK_BY_TYPE.get(b.type);
    if (spec?.shape === 'rule') {
      rules.push(blockLine(b, spec));
      continue;
    }
    const lines: string[] = [];
    if (spec?.shape === 'hat') {
      renderBlock(b, 0, lines);
      renderChain(b.next?.block, 1, lines);
      if (lines.length === 1) lines.push('  (no blocks yet)');
      scripts.push(lines);
    } else {
      renderChain(b, 0, lines);
      loose.push(lines);
    }
  }

  const out: string[] = [];
  scripts.forEach((lines, i) => {
    out.push(`Script ${i + 1}:`);
    out.push(...lines.map((l) => '  ' + l));
  });
  for (const rule of rules) out.push(rule.replace(/^rule: /, 'Rule: '));
  if (loose.length) {
    out.push('Loose blocks (not under a "when" block, so they never run on their own; treat them as hints):');
    for (const lines of loose) out.push(...lines.map((l) => '  ' + l));
  }
  for (const c of comments) out.push(`Note from the author: ${String(c).replace(/\s*\n\s*/g, ' / ')}`);
  return { text: out.join('\n'), scripts: scripts.length };
}
