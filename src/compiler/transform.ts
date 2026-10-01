import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';
import MagicString from 'magic-string';

/** Engine hooks the Game calls. */
export const HOOKS = ['start', 'onSpawn', 'update', 'onKeyDown', 'onKeyUp', 'onClick', 'onMessage', 'onCollide', 'onDestroy'];

/** Engine helpers that are generators and must be called with `yield*`. */
const THIS_GENERATORS = new Set(['wait', 'waitUntil', 'glideTo', 'tween', 'sayFor', 'playSoundUntilDone', 'broadcastAndWait']);
const GAME_GENERATORS = new Set(['broadcastAndWait', 'ask']);

/** Identifiers the sandbox reserves; a class can't be named like these. */
const RESERVED_CLASS_NAMES = new Set(['Sprite', 'Stage', 'BABYLON', 'Vector3', 'Color3', 'Math', 'Object', 'Array', 'String', 'Number', 'Game']);

export interface TransformResult {
  className: string | null;
  /** Instrumented code (what runs). Same line numbers as the input. */
  runSource: string;
  /** Problems that stop this code from running at all. */
  errors: string[];
  /** Things that were auto-fixed or look suspicious. */
  warnings: string[];
}

type AnyNode = Node & Record<string, any>;

function isFunction(n: AnyNode): boolean {
  return n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
}

function enclosingFunction(ancestors: AnyNode[]): AnyNode | null {
  for (let i = ancestors.length - 2; i >= 0; i--) if (isFunction(ancestors[i])) return ancestors[i];
  return null;
}

/** `this.wait(...)` / `this.game.ask(...)` style call to an engine generator (or a class generator method). */
function generatorCallName(call: AnyNode, classGenerators: Set<string>): string | null {
  if (call?.type !== 'CallExpression') return null;
  const callee = call.callee as AnyNode;
  if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return null;
  const name = callee.property.name as string;
  const obj = callee.object as AnyNode;
  if (obj.type === 'ThisExpression' && (THIS_GENERATORS.has(name) || classGenerators.has(name))) return name;
  if (
    obj.type === 'MemberExpression' &&
    !obj.computed &&
    obj.object.type === 'ThisExpression' &&
    obj.property.type === 'Identifier' &&
    obj.property.name === 'game' &&
    GAME_GENERATORS.has(name)
  ) {
    return `game.${name}`;
  }
  return null;
}

function formatSyntaxError(err: unknown): string {
  const e = err as { message?: string; loc?: { line: number; column: number } };
  const msg = (e.message ?? String(err)).replace(/\s*\(\d+:\d+\)$/, '');
  return e.loc ? `Syntax error at line ${e.loc.line}, column ${e.loc.column + 1}: ${msg}` : `Syntax error: ${msg}`;
}

/**
 * Validates one target's class and makes it safe to run:
 * - checks it parses and declares `class X extends Sprite|Stage`
 * - adds runaway-loop guards (a pause in generators, a stop elsewhere)
 * - adds missing `yield*` before engine generators (this.wait(), this.glideTo()...)
 * - turns hook methods that use waits into generators
 */
export function instrumentTargetCode(source: string, kind: 'sprite' | 'stage'): TransformResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const expectedBase = kind === 'stage' ? 'Stage' : 'Sprite';
  const otherBase = kind === 'stage' ? 'Sprite' : 'Stage';

  let ast: AnyNode;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true }) as AnyNode;
  } catch (err) {
    return { className: null, runSource: source, errors: [formatSyntaxError(err)], warnings };
  }

  const ms = new MagicString(source);

  // ---- Find the target class
  const classes = (ast.body as AnyNode[]).filter((n) => n.type === 'ClassDeclaration');
  const extendsName = (c: AnyNode) => (c.superClass?.type === 'Identifier' ? (c.superClass.name as string) : null);
  let cls = classes.find((c) => extendsName(c) === expectedBase) ?? null;
  if (!cls) {
    const wrong = classes.find((c) => extendsName(c) === otherBase || extendsName(c) === 'Actor' || extendsName(c) === 'World');
    if (wrong) {
      ms.overwrite(wrong.superClass.start, wrong.superClass.end, expectedBase);
      warnings.push(`Changed \`extends ${extendsName(wrong)}\` to \`extends ${expectedBase}\`.`);
      cls = wrong;
    }
  }
  if (!cls) {
    errors.push(`No \`class ... extends ${expectedBase}\` declaration was found.`);
    return { className: null, runSource: source, errors, warnings };
  }
  let className = cls.id.name as string;
  if (RESERVED_CLASS_NAMES.has(className)) {
    const renamed = `${className}Script`;
    ms.overwrite(cls.id.start, cls.id.end, renamed);
    warnings.push(`Renamed class ${className} to ${renamed} (the name is reserved).`);
    className = renamed;
  }

  // ---- Class methods
  const methods = (cls.body.body as AnyNode[]).filter((m) => m.type === 'MethodDefinition');
  const classGenerators = new Set<string>(
    methods.filter((m) => m.value.generator && m.key.type === 'Identifier').map((m) => m.key.name as string),
  );
  const methodNames = new Set(methods.filter((m) => m.key.type === 'Identifier').map((m) => m.key.name as string));

  // Hook methods (not update) that call engine generators become generators themselves.
  const convert = new Set<AnyNode>();
  for (const m of methods) {
    if (m.kind !== 'method' || m.static || m.value.generator || m.value.async) continue;
    const name = m.key.type === 'Identifier' ? (m.key.name as string) : '';
    if (name === 'update' || name === 'constructor') continue;
    let needs = false;
    ancestor(m.value.body, {
      CallExpression(node: Node, _state: unknown, anc: Node[]) {
        if (needs) return;
        const fn = enclosingFunction(anc as AnyNode[]);
        if (fn && fn !== m.value) return;
        if (generatorCallName(node as AnyNode, classGenerators)) needs = true;
      },
    });
    if (needs) convert.add(m.value);
  }
  for (const m of methods) {
    if (!convert.has(m.value)) continue;
    ms.appendLeft(m.key.start, '*');
    warnings.push(`Made ${m.key.name}() a generator so its waits work.`);
    if (m.key.type === 'Identifier') classGenerators.add(m.key.name);
  }
  const isGen = (fn: AnyNode | null) => Boolean(fn && (fn.generator || convert.has(fn)));

  // ---- Walk the whole program: loop guards + yield* fixes + suspicious APIs
  const fixed = new Set<number>();
  const loopTypes = ['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'];
  const visitors: Record<string, (node: Node, state: unknown, anc: Node[]) => void> = {};
  for (const t of loopTypes) {
    visitors[t] = (node, _s, anc) => {
      const loop = node as AnyNode;
      if (loop.await) return;
      const fn = enclosingFunction(anc as AnyNode[]);
      const guard = isGen(fn) ? 'if (__ambleGuardYield()) yield;' : '__ambleGuardThrow();';
      const body = loop.body as AnyNode;
      if (body.type === 'BlockStatement') {
        ms.appendLeft(body.start + 1, ` ${guard} `);
      } else {
        ms.appendLeft(body.start, `{ ${guard} `);
        ms.appendRight(body.end, ' }');
      }
    };
  }
  visitors.ExpressionStatement = (node, _s, anc) => {
    const stmt = node as AnyNode;
    const expr = stmt.expression as AnyNode;
    const name = generatorCallName(expr, classGenerators);
    if (!name) return;
    const fn = enclosingFunction(anc as AnyNode[]);
    if (isGen(fn)) {
      if (!fixed.has(expr.start)) {
        ms.appendLeft(expr.start, 'yield* ');
        fixed.add(expr.start);
        warnings.push(`Added missing \`yield*\` before ${name}() (line ${stmt.loc!.start.line}).`);
      }
    } else {
      warnings.push(`${name}() on line ${stmt.loc!.start.line} does nothing outside a generator method.`);
    }
  };
  visitors.YieldExpression = (node) => {
    const y = node as AnyNode;
    if (!y.delegate && y.argument && generatorCallName(y.argument, classGenerators)) {
      ms.overwrite(y.start, y.argument.start, 'yield* ');
      fixed.add(y.argument.start);
      warnings.push(`Changed \`yield\` to \`yield*\` on line ${y.loc!.start.line}.`);
    }
  };
  const fixInit = (expr: AnyNode | null | undefined, anc: AnyNode[], line: number) => {
    if (!expr || fixed.has(expr.start)) return;
    const name = generatorCallName(expr, classGenerators);
    if (!name) return;
    if (!isGen(enclosingFunction(anc))) return;
    ms.appendLeft(expr.start, 'yield* ');
    fixed.add(expr.start);
    warnings.push(`Added missing \`yield*\` before ${name}() (line ${line}).`);
  };
  visitors.VariableDeclarator = (node, _s, anc) => {
    const d = node as AnyNode;
    fixInit(d.init, anc as AnyNode[], d.loc!.start.line);
  };
  visitors.AssignmentExpression = (node, _s, anc) => {
    const a = node as AnyNode;
    fixInit(a.right, anc as AnyNode[], a.loc!.start.line);
  };
  let usesAsync = false;
  visitors.AwaitExpression = () => {
    usesAsync = true;
  };
  visitors.Identifier = (node) => {
    const id = node as AnyNode;
    if (['document', 'localStorage', 'XMLHttpRequest', 'WebSocket'].includes(id.name)) {
      warnings.push(`Uses \`${id.name}\` (line ${id.loc!.start.line}), which isn't available to games.`);
    }
  };
  ancestor(ast, visitors as never);
  if (usesAsync) warnings.push('Uses async/await; game logic should use coroutines (`yield* this.wait(...)`) instead.');

  // Methods that look like hooks but will never be called.
  for (const name of methodNames) {
    if (/^on[A-Z]/.test(name) && !HOOKS.includes(name) && !new RegExp(`this\\.${name}\\b`).test(source)) {
      warnings.push(`${name}() is never called by the engine (hooks: ${HOOKS.join(', ')}).`);
    }
  }

  return { className, runSource: ms.toString(), errors, warnings: [...new Set(warnings)] };
}
