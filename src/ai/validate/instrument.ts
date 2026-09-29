/**
 * Loop guards for code that is about to run: every loop body starts with a call to the runtime's
 * guard (default `__amble.guard()`), which throws "This loop never ends" when one frame spends too
 * long in loops. Inserted on the same line, so error line numbers still match the student's code.
 */
import type { AnyNode, Statement } from 'acorn';
import { simple } from 'acorn-walk';
import MagicString from 'magic-string';
import { parseScript } from './ast';

export interface InstrumentOptions {
  /** The guard call; the runtime defines it. */
  guard?: string;
  /** Appended as `//# sourceURL=` so errors name the file (e.g. `amble:///game.js`). */
  sourceUrl?: string;
}

export function instrument(code: string, o: InstrumentOptions = {}): { code: string; loops: number } {
  const parsed = parseScript(code);
  if (!parsed.ok) return { code, loops: 0 };
  const guard = `${o.guard ?? '__amble.guard()'};`;
  const ms = new MagicString(code);
  let loops = 0;
  const guardBody = (body: Statement) => {
    loops++;
    if (body.type === 'BlockStatement') ms.appendLeft(body.start + 1, ` ${guard}`);
    else {
      ms.appendLeft(body.start, `{ ${guard} `);
      ms.appendRight(body.end, ' }');
    }
  };
  const visit = (n: AnyNode) => {
    if (n.type === 'ForOfStatement' && n.await) return;
    if (n.type === 'WhileStatement' || n.type === 'DoWhileStatement' || n.type === 'ForStatement' || n.type === 'ForInStatement' || n.type === 'ForOfStatement') guardBody(n.body);
  };
  simple(parsed.ast, { WhileStatement: visit, DoWhileStatement: visit, ForStatement: visit, ForInStatement: visit, ForOfStatement: visit });
  let out = ms.toString();
  if (o.sourceUrl) out += `\n//# sourceURL=${o.sourceUrl}`;
  return { code: out, loops };
}
