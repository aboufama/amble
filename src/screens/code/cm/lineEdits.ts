/**
 * Whole-line edits between two versions of a file, as CodeMirror changes: used by Fix (only the lines
 * near a problem), Undo my edits and bringing back unrun changes. Small edits keep the cursor, the undo
 * history and the lines around them untouched.
 */
import type { ChangeSpec, Text } from '@codemirror/state';
import { diffLines } from '../../../history/myers';

/** Old lines [a0, a1) become new lines [b0, b1) (0-based). */
export interface LineBlock {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** The changed blocks between two line lists (CodeMirror's model: '' is one empty line). */
export function lineBlocks(a: readonly string[], b: readonly string[]): LineBlock[] {
  const blocks: LineBlock[] = [];
  for (const r of diffLines(a, b)) {
    if (r.op === '=') continue;
    const block: LineBlock = { a0: r.a, a1: r.op === '-' ? r.a + r.n : r.a, b0: r.b, b1: r.op === '+' ? r.b + r.n : r.b };
    const last = blocks[blocks.length - 1];
    if (last && last.a1 === block.a0 && last.b1 === block.b0) {
      last.a1 = block.a1;
      last.b1 = block.b1;
    } else blocks.push(block);
  }
  return blocks;
}

/** One block as a change on `doc` (whose lines are `a`), with `b` the new lines. */
function blockChange(doc: Text, block: LineBlock, b: readonly string[]): ChangeSpec {
  const n = doc.lines;
  const lines = b.slice(block.b0, block.b1);
  if (block.a0 === block.a1) {
    // Pure insertion: before an old line, or after the last one.
    if (block.a0 < n) return { from: doc.line(block.a0 + 1).from, insert: `${lines.join('\n')}\n` };
    return { from: doc.length, insert: `\n${lines.join('\n')}` };
  }
  if (block.a1 < n) {
    const from = doc.line(block.a0 + 1).from;
    const to = doc.line(block.a1 + 1).from;
    return { from, to, insert: lines.length ? `${lines.join('\n')}\n` : '' };
  }
  // The block runs to the end of the file.
  if (lines.length) return { from: doc.line(block.a0 + 1).from, to: doc.length, insert: lines.join('\n') };
  return { from: block.a0 > 0 ? doc.line(block.a0).to : 0, to: doc.length, insert: '' };
}

/**
 * The changes that turn `doc` into `target`. `pick` chooses blocks (by their old line range); the rest
 * stay as they are.
 */
export function lineChanges(doc: Text, target: string, pick: (block: LineBlock) => boolean = () => true): ChangeSpec[] {
  const a = doc.toString().split('\n');
  const b = target.split('\n');
  return lineBlocks(a, b)
    .filter(pick)
    .map((block) => blockChange(doc, block, b));
}

/** Blocks within a couple of lines of `line` (0-based), or every block when none is that close. */
export function nearLine(doc: Text, target: string, line: number): (block: LineBlock) => boolean {
  const blocks = lineBlocks(doc.toString().split('\n'), target.split('\n'));
  const near = blocks.filter((k) => line >= k.a0 - 2 && line <= k.a1 + 1);
  const chosen = new Set(near.length ? near.map((k) => `${k.a0}:${k.b0}`) : blocks.map((k) => `${k.a0}:${k.b0}`));
  return (k) => chosen.has(`${k.a0}:${k.b0}`);
}
