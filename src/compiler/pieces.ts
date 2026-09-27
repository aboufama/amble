import { parse } from 'acorn';
import { pieceSignature, type PieceKind } from './codegen';

function parses(kind: PieceKind, body: string): string | null {
  try {
    parse(`class Piece extends Sprite {\n  ${pieceSignature(kind, 'piece')} {\n${body}\n  }\n}`, { ecmaVersion: 'latest', sourceType: 'script' });
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

const RETURNS: ReadonlySet<PieceKind> = new Set(['condition', 'value', 'message']);

/**
 * Checks a piece's code (the body of its method) and tidies what's easy to tidy: code fences,
 * a whole method instead of its body, or a bare expression for a condition or value.
 */
export function checkPiece(kind: PieceKind, code: string): { code: string } | { error: string } {
  let body = String(code ?? '').trim();
  const fence = /^```(?:js|javascript)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fence) body = fence[1].trim();

  if (RETURNS.has(kind) && body && !/\breturn\b/.test(body)) {
    const asReturn = `return (${body.replace(/;\s*$/, '')});`;
    if (!parses(kind, asReturn)) return { code: asReturn };
  }
  const error = parses(kind, body);
  if (!error) return { code: body };

  // A whole method (`*piece() { ... }` or `function* () { ... }`): keep what's inside.
  const method = /^(?:async\s+)?(?:function\s*)?\*?\s*[\w$]*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;?$/.exec(body);
  if (method && !parses(kind, method[1])) return { code: method[1].trim() };
  return { error };
}
