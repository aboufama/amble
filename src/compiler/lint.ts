/**
 * A static check of a compiled game, before it runs: names in the code that point at nothing.
 *
 * - Costumes, backdrops and sounds used by name ("chicken_step") that nobody asked for: these can
 *   simply be made, so they are returned for the asset phase.
 * - Identifiers that aren't declared anywhere and aren't available to games (another sprite's
 *   class, used as if it were global), and sprites looked up by a name no sprite has: these need
 *   the code to change.
 *
 * It errs on the side of silence: anything it can't be sure about (computed names, template
 * strings, variables) is left alone.
 */
import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';

type AnyNode = Node & Record<string, any>;

export interface LintClass {
  /** The sprite's (or stage's) name, as problems mention it. */
  target: string;
  kind: 'sprite' | 'stage';
  source: string;
}

export interface LintInput {
  classes: LintClass[];
  /** Costume names by sprite name (the stage's backdrops under its own name). */
  costumes: Map<string, Set<string>>;
  /** Every sound name in the game (the engine finds a sound on any target). */
  sounds: Set<string>;
  /** Every sprite name in the game. */
  sprites: Set<string>;
  /** The stage's name. */
  stage: string;
  /** Names game code may use without declaring them. Defaults to what this page's global scope has. */
  available?: (name: string) => boolean;
}

export interface LintResult {
  /** Costumes (and backdrops, for the stage) used by name that don't exist yet. */
  missingCostumes: Array<{ target: string; name: string }>;
  /** Sounds used by name that don't exist yet. */
  missingSounds: string[];
  /** Problems only a change to the code can fix, as "Target: what's wrong". */
  problems: string[];
}

/** The engine's own names, always there (see src/engine/game.ts and sandbox.ts). */
const ENGINE = new Set(['Phaser', 'Sprite', 'Stage', 'arguments', 'undefined', 'NaN', 'Infinity', '__ambleGuardYield', '__ambleGuardThrow']);

/**
 * Helpers only sprites have (src/engine/sprite.ts: Sprite's own methods, not the Entity base the
 * stage shares). Stage code that calls one fails as the game runs. Only these are flagged: anything
 * else may be the engine's own (the compiled blocks call internals like this._script()).
 */
const SPRITE_ONLY = new Set(['addPhysics', 'animate', 'applyForce', 'applyImpulse', 'beSolid', 'bounceOffEdges', 'bounds', 'bringToFront', 'clone', 'destroy', 'directionTo', 'distanceTo', 'fallWithGravity', 'glideTo', 'goTo', 'hide', 'isOffStage', 'isOnGround', 'jumpWith', 'keepOnStage', 'moveForward', 'moveSideways', 'moveTowards', 'nextCostume', 'pointTowards', 'previousCostume', 'removePhysics', 'say', 'sayFor', 'sendToBack', 'setPosition', 'show', 'stopAnimation', 'touching', 'turn', 'walkWith']);

const SOUND_CALLS = new Set(['playSound', 'playSoundUntilDone', 'music']);
const SPRITE_CALLS = new Set(['find', 'findAll', 'spawn', 'count']);

function patternNames(p: AnyNode | null | undefined, out: Set<string>): void {
  if (!p) return;
  switch (p.type) {
    case 'Identifier':
      out.add(p.name);
      break;
    case 'ObjectPattern':
      for (const prop of p.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'ArrayPattern':
      for (const el of p.elements) patternNames(el, out);
      break;
    case 'RestElement':
      patternNames(p.argument, out);
      break;
    case 'AssignmentPattern':
      patternNames(p.left, out);
      break;
  }
}

/** Is this Identifier a reference to a variable (not a property name, label or key)? */
function isReference(id: AnyNode, parent: AnyNode | undefined): boolean {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression':
      return parent.object === id || parent.computed;
    case 'Property':
      return parent.shorthand || parent.value === id || (parent.computed && parent.key === id);
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.computed && parent.key === id;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'MetaProperty':
      return false;
    default:
      return true;
  }
}

const stringOf = (n: AnyNode | undefined): string | null => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value : null);

/** The strings an expression can be: a literal, or either side of `a ? "x" : "y"`. */
function stringsOf(n: AnyNode | undefined): string[] {
  if (!n) return [];
  if (n.type === 'ConditionalExpression') return [...stringsOf(n.consequent), ...stringsOf(n.alternate)];
  const s = stringOf(n);
  return s === null ? [] : [s];
}

const isThis = (n: AnyNode | undefined) => n?.type === 'ThisExpression';

/**
 * Is `this` here the class's own instance? Arrow functions keep it; a function or generator of its own
 * has it only as the class's method, or when handed to one of the class's own helpers
 * (`this.run(function* () {...})`); handed to another object (`bird.run(function* () {...})`) it is
 * that object, which this check can't know, so it says no.
 */
function ownThis(anc: AnyNode[]): boolean {
  for (let i = anc.length - 2; i >= 0; i--) {
    const fn = anc[i];
    if (fn.type !== 'FunctionExpression' && fn.type !== 'FunctionDeclaration') continue;
    const parent = anc[i - 1];
    if (parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') return true;
    return parent?.type === 'CallExpression' && parent.arguments.includes(fn) && parent.callee.type === 'MemberExpression' && isThis(parent.callee.object);
  }
  return true;
}
/** `this.game` */
const isGame = (n: AnyNode | undefined) => n?.type === 'MemberExpression' && !n.computed && isThis(n.object) && n.property.name === 'game';

function has(set: Set<string>, name: string): boolean {
  if (set.has(name)) return true;
  const lower = name.toLowerCase();
  for (const n of set) if (n.toLowerCase() === lower) return true;
  return false;
}

export function lintGame(input: LintInput): LintResult {
  const available = input.available ?? ((name: string) => name in globalThis);
  const missingCostumes: LintResult['missingCostumes'] = [];
  const missingSounds = new Set<string>();
  const problems: string[] = [];
  const wantCostume = (target: string, name: string) => {
    const own = input.costumes.get(target) ?? new Set<string>();
    if (!name || has(own, name) || missingCostumes.some((m) => m.target === target && m.name === name)) return;
    missingCostumes.push({ target, name });
  };

  // Sprites' classes are in scope for every class (the engine puts them there): a class may extend
  // another sprite's class, or use it.
  const parsed: Array<{ cls: LintClass; ast: AnyNode; main: AnyNode | null }> = [];
  for (const cls of input.classes) {
    try {
      const ast = parse(cls.source, { ecmaVersion: 'latest', sourceType: 'script', locations: true }) as AnyNode;
      const top = (ast.body as AnyNode[]).filter((n) => n.type === 'ClassDeclaration');
      const main = top.find((c) => c.superClass?.type === 'Identifier' && c.superClass.name === (cls.kind === 'stage' ? 'Stage' : 'Sprite')) ?? top.find((c) => c.superClass?.type === 'Identifier') ?? null;
      parsed.push({ cls, ast, main });
    } catch {
      // The parse check reports it.
    }
  }
  const spriteClasses = new Map(parsed.filter((p) => p.cls.kind === 'sprite' && p.main?.id).map((p) => [p.main!.id.name as string, p.cls.target]));
  /** Costume names each sprite's own code uses, for the sprites whose classes build on it. */
  const usedCostumes = new Map<string, string[]>();
  const wantOwn = (target: string, name: string) => {
    if (!usedCostumes.has(target)) usedCostumes.set(target, []);
    usedCostumes.get(target)!.push(name);
    wantCostume(target, name);
  };

  for (const { cls, ast } of parsed) {
    const declared = new Set<string>(spriteClasses.keys());
    /** The class's own methods and fields (this.x = ...), which `this.x()` may call. */
    const members = new Set<string>();
    const stageCalls: Array<{ name: string; line: number }> = [];
    const refs: Array<{ name: string; line: number }> = [];
    const visit = (node: AnyNode, _state: unknown, anc: AnyNode[]) => {
      const parent = anc[anc.length - 2];
      switch (node.type) {
        case 'VariableDeclarator':
          patternNames(node.id, declared);
          break;
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          if (node.id) declared.add(node.id.name);
          for (const p of node.params) patternNames(p, declared);
          break;
        case 'ClassDeclaration':
        case 'ClassExpression':
          if (node.id) declared.add(node.id.name);
          break;
        case 'CatchClause':
          patternNames(node.param, declared);
          break;
        case 'Identifier':
          if (isReference(node, parent)) refs.push({ name: node.name, line: node.loc?.start.line ?? 0 });
          break;
        case 'MethodDefinition':
        case 'PropertyDefinition':
          if (!node.computed && node.key?.type === 'Identifier') members.add(node.key.name);
          break;
        case 'CallExpression': {
          const callee = node.callee as AnyNode;
          if (callee.type !== 'MemberExpression' || callee.computed) break;
          const method = callee.property.name as string;
          if (cls.kind === 'stage' && isThis(callee.object) && ownThis(anc)) stageCalls.push({ name: method, line: node.loc?.start.line ?? 0 });
          const arg = node.arguments[0] as AnyNode | undefined;
          if (SOUND_CALLS.has(method) && (method !== 'music' || isGame(callee.object))) {
            for (const s of stringsOf(arg)) if (s && !has(input.sounds, s)) missingSounds.add(s);
          } else if (SPRITE_CALLS.has(method) && isGame(callee.object)) {
            for (const s of stringsOf(arg)) if (s && !has(input.sprites, s) && s.toLowerCase() !== 'stage') problems.push(`${cls.target} (line ${node.loc?.start.line}): this.game.${method}("${s}"), but there is no sprite named "${s}". Sprites: ${[...input.sprites].join(', ')}`);
          } else if (method === 'animate' && isThis(callee.object) && cls.kind === 'sprite' && arg?.type === 'ArrayExpression') {
            for (const el of arg.elements as AnyNode[]) for (const s of stringsOf(el)) wantOwn(cls.target, s);
          }
          break;
        }
        case 'AssignmentExpression': {
          const left = node.left as AnyNode;
          if (left.type !== 'MemberExpression' || left.computed) break;
          const prop = left.property.name as string;
          if (isThis(left.object)) members.add(prop);
          if (prop === 'costume' && isThis(left.object) && cls.kind === 'sprite' && ownThis(anc)) for (const s of stringsOf(node.right)) wantOwn(cls.target, s);
          if (prop === 'backdrop' && (isGame(left.object) || (isThis(left.object) && cls.kind === 'stage'))) for (const s of stringsOf(node.right)) wantCostume(input.stage, s);
          break;
        }
      }
    };
    ancestor(ast, { VariableDeclarator: visit, FunctionDeclaration: visit, FunctionExpression: visit, ArrowFunctionExpression: visit, ClassDeclaration: visit, ClassExpression: visit, CatchClause: visit, Identifier: visit, CallExpression: visit, AssignmentExpression: visit, MethodDefinition: visit, PropertyDefinition: visit } as never);
    const missing = new Set<string>();
    for (const c of stageCalls) {
      if (!SPRITE_ONLY.has(c.name) || members.has(c.name) || missing.has(c.name)) continue;
      missing.add(c.name);
      problems.push(`${cls.target} (line ${c.line}): this.${c.name}() doesn't exist on the stage: it's a sprite's helper. Call it on a sprite (this.game.find("Name").${c.name}(...)), or do it with Phaser on this.game.scene.`);
    }
    const reported = new Set<string>();
    for (const r of refs) {
      if (declared.has(r.name) || ENGINE.has(r.name) || reported.has(r.name) || available(r.name)) continue;
      reported.add(r.name);
      const isClass = /^[A-Z]/.test(r.name);
      problems.push(
        `${cls.target} (line ${r.line}): \`${r.name}\` is not defined${isClass ? `. No sprite's class is called ${r.name} (they are ${[...spriteClasses.keys()].join(', ') || 'none'}): extend or use one of those, or reach a sprite with this.game.find("Name") / findAll / spawn.` : '.'}`,
      );
    }
  }
  // A sprite whose class builds on another's runs that code too, so it needs the costumes that code uses.
  for (const { cls, main } of parsed) {
    if (cls.kind !== 'sprite') continue;
    const seen = new Set<string>([cls.target]);
    for (let base = spriteClasses.get(main?.superClass?.name); base && !seen.has(base); ) {
      seen.add(base);
      for (const name of usedCostumes.get(base) ?? []) wantCostume(cls.target, name);
      base = spriteClasses.get(parsed.find((p) => p.cls.target === base)?.main?.superClass?.name);
    }
  }
  return { missingCostumes, missingSounds: [...missingSounds], problems: [...new Set(problems)] };
}
