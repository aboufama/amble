/** Finding a block of lines in a file again after other lines moved (teacher locks, the student's edits). */

const lines = (s: string) => s.split('\n').map((l) => l.trimEnd());

/** Where `block` sits in `content` now (1-based start line), or -1 when it is gone or changed. */
export function findBlock(content: string, block: readonly string[]): number {
  if (!block.length) return 1;
  const all = lines(content);
  const want = block.map((l) => l.trimEnd());
  outer: for (let i = 0; i + want.length <= all.length; i++) {
    for (let j = 0; j < want.length; j++) if (all[i + j] !== want[j]) continue outer;
    return i + 1;
  }
  return -1;
}
