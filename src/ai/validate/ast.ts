/** Parsing and small AST helpers shared by the validator's rules. */
import { parse, type AnyNode, type Class, type Expression, type Function as FunctionNode, type Node, type Program, type Super } from 'acorn';
import { full, base } from 'acorn-walk';

export type ParseResult = { ok: true; ast: Program } | { ok: false; line: number; column: number; message: string; atEnd: boolean };

/** Parses a game file as a classic script (games load as scripts in one shared scope). */
export function parseScript(code: string): ParseResult {
  try {
    return { ok: true, ast: parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true }) };
  } catch (err) {
    const e = err as { message?: string; loc?: { line: number; column: number }; pos?: number };
    const message = (e.message ?? String(err)).replace(/\s*\(\d+:\d+\)$/, '');
    const atEnd = typeof e.pos === 'number' && e.pos >= code.trimEnd().length;
    return { ok: false, line: e.loc?.line ?? 0, column: (e.loc?.column ?? -1) + 1, message, atEnd };
  }
}

export function lineOf(n: Node | null | undefined): number {
  return n?.loc?.start.line ?? 0;
}

export function columnOf(n: Node | null | undefined): number {
  return n?.loc ? n.loc.start.column + 1 : 0;
}

export function src(code: string, n: Node): string {
  return code.slice(n.start, n.end);
}

/**
 * The dotted path of a member expression: `this.fx.shake`, `window.fetch`, `a.b().c` -> `a.b().c`.
 * `obj['name']` counts as `obj.name`. Anything else yields ''.
 */
export function memberPath(n: AnyNode | Expression | Super | null | undefined): string {
  if (!n) return '';
  switch (n.type) {
    case 'Identifier':
      return n.name;
    case 'ThisExpression':
      return 'this';
    case 'MemberExpression': {
      const obj = memberPath(n.object);
      if (!obj) return '';
      if (!n.computed && n.property.type === 'Identifier') return `${obj}.${n.property.name}`;
      if (n.computed && n.property.type === 'Literal' && typeof n.property.value === 'string') return `${obj}.${n.property.value}`;
      return '';
    }
    case 'CallExpression':
      return memberPath(n.callee) ? `${memberPath(n.callee)}()` : '';
    case 'ChainExpression':
      return memberPath(n.expression);
    case 'ParenthesizedExpression':
      return memberPath(n.expression);
    default:
      return '';
  }
}

/** The property name of a non-computed member (or `obj['name']`), else ''. */
export function propertyName(n: AnyNode): string {
  if (n.type !== 'MemberExpression') return '';
  if (!n.computed && n.property.type === 'Identifier') return n.property.name;
  if (n.computed && n.property.type === 'Literal' && typeof n.property.value === 'string') return n.property.value;
  return '';
}

/** A class member's key name, when it is a plain name. */
export function keyName(key: Expression | { type: 'PrivateIdentifier'; name: string }, computed: boolean): string {
  if (key.type === 'Identifier' && !computed) return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return '';
}

/** Does `fn` use `this` (or `arguments`) itself, outside nested non-arrow functions? */
function usesOwn(fn: FunctionNode, test: (n: AnyNode) => boolean): boolean {
  let found = false;
  const skipFunctions = { ...base, FunctionExpression() {}, FunctionDeclaration() {} };
  full(fn.body, (n) => {
    if (test(n)) found = true;
  }, skipFunctions);
  return found;
}

export function usesThis(fn: FunctionNode): boolean {
  return usesOwn(fn, (n) => n.type === 'ThisExpression');
}

export function usesArguments(fn: FunctionNode): boolean {
  return usesOwn(fn, (n) => n.type === 'Identifier' && n.name === 'arguments');
}

/** Does a loop body contain a way out (break, return or throw)? */
export function hasExit(body: Node): boolean {
  let exit = false;
  full(body, (n) => {
    if (n.type === 'BreakStatement' || n.type === 'ReturnStatement' || n.type === 'ThrowStatement') exit = true;
  });
  return exit;
}

export function isClass(n: AnyNode | undefined): n is Extract<AnyNode, Class> {
  return n?.type === 'ClassDeclaration' || n?.type === 'ClassExpression';
}

/**
 * Is `this` at the end of `ancestors` the scene? It is inside a scene class's methods and field
 * initializers, looking through arrow functions but not through `function` expressions.
 */
export function thisIsScene(ancestors: readonly AnyNode[], sceneClasses: ReadonlySet<AnyNode>): boolean {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'ArrowFunctionExpression') continue;
    if (a.type === 'FunctionExpression' || a.type === 'FunctionDeclaration') {
      const method = ancestors[i - 1];
      return method?.type === 'MethodDefinition' && sceneClasses.has(ancestors[i - 3]);
    }
    if (a.type === 'PropertyDefinition' || a.type === 'StaticBlock') return sceneClasses.has(ancestors[i - 2]);
  }
  return false;
}

/** The innermost enclosing function (of any kind), or null at the top level. */
export function enclosingFunction(ancestors: readonly AnyNode[]): FunctionNode | null {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'FunctionExpression' || a.type === 'FunctionDeclaration' || a.type === 'ArrowFunctionExpression') return a;
  }
  return null;
}
