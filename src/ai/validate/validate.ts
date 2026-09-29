/**
 * Validates AI-written (or student-written) game code before it runs: parse, rules, safe
 * auto-fixes, then a second pass over the fixed code so the result lists only what is still wrong.
 * About 1-3 ms for a typical game, so it can also run as the student types.
 */
import type { AnyNode, Class, ClassDeclaration, Identifier, Pattern, Program } from 'acorn';
import { ancestor } from 'acorn-walk';
import MagicString from 'magic-string';
import type { JsonValue } from '../json/schema';
import { byteLength, ENTRY_FILE, isSafeGamePath } from '../gameFiles';
import { columnOf, keyName, lineOf, memberPath, parseScript, src, thisIsScene } from './ast';
import { FileContext, type GameFacts } from './context';
import { checkManifestStatics, checkDialReads, declaredDials } from './art';
import { checkDials, restartDials } from './dials';
import { checkGlobals, collectDeclared } from './globals';
import { normalizeManifest, type Api } from './manifest';
import { kidMessage } from './messages';
import { runRules } from './rules';
import { readStatics, staticFields } from './statics';
import { visibleStrings } from './strings';
import type { GameFile, Issue, ValidateOptions, ValidationResult, WorldFacts } from './types';
import { checkGraphicsArt, checkWorldArt, directiveLines, isKitTexture, lockedLineIssues } from './world';

const DEFAULT_LIMITS: Limits = { maxFiles: 12, maxFileBytes: 40_000, maxTotalBytes: 120_000 };

interface Limits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Lines per file (unchecked when absent). */
  maxFileLines?: number;
}

interface Parsed {
  file: GameFile;
  ast: Program;
}

function superName(code: string, cls: Class): string {
  return cls.superClass ? src(code, cls.superClass) : '';
}

function isSceneBase(name: string): boolean {
  return name === 'Amble.Scene' || name === 'Phaser.Scene';
}

function topClasses(ast: Program): ClassDeclaration[] {
  return ast.body.filter((n): n is ClassDeclaration => n.type === 'ClassDeclaration');
}

function findGameClass(ast: Program): ClassDeclaration | null {
  const classes = topClasses(ast);
  return classes.find((c) => c.id.name === 'Game') ?? classes.find((c) => c.superClass) ?? null;
}

function sceneClassesOf(p: Parsed, isEntry: boolean): Set<AnyNode> {
  const out = new Set<AnyNode>();
  const game = isEntry ? findGameClass(p.ast) : null;
  if (game) out.add(game);
  ancestor(p.ast, {
    ClassDeclaration(n) {
      if (isSceneBase(superName(p.file.content, n))) out.add(n);
    },
    ClassExpression(n) {
      if (isSceneBase(superName(p.file.content, n))) out.add(n);
    },
  });
  return out;
}

/** Scene members: methods and fields of scene classes, and `this.x = ...` inside them. */
function collectOwn(p: Parsed, scenes: ReadonlySet<AnyNode>, own: Set<string>): void {
  for (const cls of scenes) {
    if (cls.type !== 'ClassDeclaration' && cls.type !== 'ClassExpression') continue;
    for (const m of cls.body.body) if (m.type !== 'StaticBlock') {
      const name = keyName(m.key, m.computed);
      if (name) own.add(name);
    }
  }
  ancestor(p.ast, {
    AssignmentExpression(n, _s, anc) {
      const m = /^this\.(\w+)$/.exec(memberPath(n.left));
      if (m && thisIsScene(anc, scenes)) own.add(m[1]);
    },
  });
}

function checkGameClass(ctx: FileContext, isEntry: boolean): void {
  if (!isEntry) {
    for (const c of topClasses(ctx.ast)) {
      if (c.id.name === 'Game') ctx.add('error', 'duplicate-game-class', c, `Only ${ENTRY_FILE} may declare \`class Game\`; rename this class.`);
    }
    return;
  }
  const game = ctx.gameClass;
  if (!game) {
    ctx.add('error', 'no-game-class', null, 'Declare `class Game extends Amble.Scene { create() {...} update() {...} }`.');
    return;
  }
  const sup = superName(ctx.code, game);
  if (sup === 'Phaser.Scene' && game.superClass) {
    const superClass = game.superClass;
    ctx.add('warning', 'extends-phaser-scene', game, 'Extend `Amble.Scene` (a Phaser.Scene with the kit).', { fixed: ctx.fix });
    ctx.applyFix('extends-phaser-scene', game, 'extends Phaser.Scene -> Amble.Scene', () => ctx.ms.overwrite(superClass.start, superClass.end, 'Amble.Scene'));
  } else if (sup !== 'Amble.Scene') {
    ctx.add('error', 'bad-base-class', game, `The game class must extend Amble.Scene (found \`${sup || 'nothing'}\`).`, { name: sup || 'nothing' });
  }
  const id = game.id;
  if (id && id.name !== 'Game') {
    ctx.add('warning', 'class-name', game, `Rename class ${id.name} to Game.`, { name: id.name, fixed: ctx.fix });
    ctx.applyFix('class-name', game, `class ${id.name} -> Game`, () => ctx.ms.overwrite(id.start, id.end, 'Game'));
  }
  for (const m of game.body.body) {
    if (m.type !== 'MethodDefinition') continue;
    const name = keyName(m.key, m.computed);
    if (m.kind === 'constructor') {
      let hasSuper = false;
      ancestor(m.value.body, {
        CallExpression(n) {
          if (n.callee.type === 'Super') hasSuper = true;
        },
      });
      if (!hasSuper) {
        ctx.add('error', 'missing-super', m, 'A scene constructor must call super() first.', { fixed: ctx.fix });
        ctx.applyFix('missing-super', m, 'inserted super()', () => ctx.ms.appendLeft(m.value.body.start + 1, ' super(); '));
      }
    }
    if (['create', 'preload', 'init'].includes(name) && m.value.async) {
      ctx.add('warning', 'async-lifecycle', m, `Phaser does not await \`async ${name}()\`: code after the first await runs after the game started.`, { name: `async ${name}()` });
    }
  }
}

/** The names a declaration pattern binds: `a`, `{ a, b: c }`, `[a, ...rest]`. */
function boundNames(p: Pattern | null): Identifier[] {
  if (!p) return [];
  switch (p.type) {
    case 'Identifier':
      return [p];
    case 'ObjectPattern':
      return p.properties.flatMap((q) => (q.type === 'RestElement' ? boundNames(q.argument) : boundNames(q.value)));
    case 'ArrayPattern':
      return p.elements.flatMap((e) => boundNames(e));
    case 'AssignmentPattern':
      return boundNames(p.left);
    case 'RestElement':
      return boundNames(p.argument);
    default:
      return [];
  }
}

/** A file's top-level names; `const`, `let` and `class` are lexical (they clash with any other declaration). */
function topLevelDeclarations(ast: Program): Array<{ id: Identifier; lexical: boolean }> {
  const out: Array<{ id: Identifier; lexical: boolean }> = [];
  for (const n of ast.body) {
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) for (const id of boundNames(d.id)) out.push({ id, lexical: n.kind !== 'var' });
    if (n.type === 'ClassDeclaration' && n.id) out.push({ id: n.id, lexical: true });
    if (n.type === 'FunctionDeclaration' && n.id) out.push({ id: n.id, lexical: false });
  }
  return out;
}

/**
 * Every file runs as its own classic script in one shared scope, so a `const`, `let` or `class` declared
 * again in a later file (or next to a function or var of the same name) stops that file from loading at all.
 * Files load helpers first in alphabetical order, then the entry file.
 */
function duplicateDeclarations(parsed: readonly Parsed[], entry: string): Issue[] {
  const order = [...parsed].sort((a, b) => (a.file.path === entry ? 1 : b.file.path === entry ? -1 : a.file.path.localeCompare(b.file.path)));
  const first = new Map<string, { file: string; lexical: boolean }>();
  const out: Issue[] = [];
  for (const p of order) {
    for (const { id, lexical } of topLevelDeclarations(p.ast)) {
      // Only game.js may declare the Game class: duplicate-game-class says so.
      if (id.name === 'Game') continue;
      const before = first.get(id.name);
      if (!before) {
        first.set(id.name, { file: p.file.path, lexical });
        continue;
      }
      if (before.file === p.file.path || !(before.lexical || lexical)) continue;
      const line = lineOf(id);
      out.push({
        rule: 'duplicate-declaration',
        severity: 'error',
        file: p.file.path,
        line,
        column: columnOf(id),
        message: `\`${id.name}\` is already declared in ${before.file}. Every file runs as its own script, so each top-level name can be declared only once in the whole game: use the one in ${before.file}, or give this one another name.`,
        kid: kidMessage('duplicate-declaration', { line, name: id.name }),
      });
    }
  }
  return out;
}

function sizeIssues(files: readonly GameFile[], limits: Limits, entry: string): Issue[] {
  const out: Issue[] = [];
  const issue = (rule: 'size' | 'bad-path', file: string, message: string, name?: string): Issue => ({ rule, severity: 'error', file, line: 0, column: 0, message, kid: kidMessage(rule, { line: 0, name }) });
  if (files.length > limits.maxFiles) out.push(issue('size', entry, `A game has at most ${limits.maxFiles} files (this one has ${files.length}).`, `${files.length} files`));
  let total = 0;
  for (const f of files) {
    const bytes = byteLength(f.content);
    total += bytes;
    if (!isSafeGamePath(f.path)) out.push(issue('bad-path', f.path, `\`${f.path}\` is not a valid file name: use letters, digits, - and _, one folder at most, ending in .js.`, f.path));
    if (bytes > limits.maxFileBytes) out.push(issue('size', f.path, `${f.path} is ${Math.round(bytes / 1000)} KB; keep each file under ${Math.round(limits.maxFileBytes / 1000)} KB (split it).`, `${f.path} is too long`));
    const count = f.content.split('\n').length;
    if (limits.maxFileLines && count > limits.maxFileLines) out.push(issue('size', f.path, `${f.path} has ${count} lines; keep each file under ${limits.maxFileLines} lines (move parts into another file).`, `${f.path} is too long`));
  }
  if (total > limits.maxTotalBytes) out.push(issue('size', entry, `The game is ${Math.round(total / 1000)} KB; keep it under ${Math.round(limits.maxTotalBytes / 1000)} KB.`, `${Math.round(total / 1000)} KB`));
  return out;
}

/** Stray `@@` lines and changed teacher-locked lines: checked on the raw text, parsed or not. */
function worldIssues(files: readonly GameFile[], world: WorldFacts | undefined): Issue[] {
  const out: Issue[] = [];
  for (const f of files) {
    for (const d of directiveLines(f)) {
      out.push({ rule: 'patch-directive-in-code', severity: 'error', file: f.path, line: d.line, column: d.column, message: `Line ${d.line} starts with @@, which is not JavaScript: remove it.`, kid: kidMessage('patch-directive-in-code', { line: d.line }) });
    }
  }
  for (const l of lockedLineIssues(files, world)) {
    out.push({ rule: 'locked-lines', severity: 'error', file: l.path, line: l.line, column: 0, message: l.message, kid: kidMessage('locked-lines', { line: l.line }) });
  }
  return out;
}

interface Pass {
  issues: Issue[];
  fixes: ValidationResult['fixes'];
  files: GameFile[];
  truncated: boolean;
  syntaxErrors: number;
  art: ValidationResult['art'];
  statics: Record<string, JsonValue>;
  strings: ValidationResult['strings'];
  renamed: ValidationResult['renamed'];
}

function runPass(files: readonly GameFile[], api: Api, entry: string, fix: boolean, limits: Limits, world?: WorldFacts): Pass {
  const issues: Issue[] = [...sizeIssues(files, limits, entry), ...worldIssues(files, world)];
  const parsed: Parsed[] = [];
  let truncated = false;
  let syntaxErrors = 0;
  for (const file of files) {
    const r = parseScript(file.content);
    if (r.ok) {
      parsed.push({ file, ast: r.ast });
      continue;
    }
    syntaxErrors++;
    truncated ||= r.atEnd;
    const message = r.atEnd ? `Syntax error: ${r.message}. The code stops in the middle, as if the reply was cut off.` : `Syntax error: ${r.message}.`;
    issues.push({ rule: 'syntax', severity: 'error', file: file.path, line: r.line, column: r.column, message, kid: kidMessage('syntax', { line: r.line }) });
  }
  if (!files.some((f) => f.path === entry)) {
    issues.push({ rule: 'no-game-class', severity: 'error', file: entry, line: 0, column: 0, message: `The game needs ${entry} with \`class Game extends Amble.Scene\`.`, kid: kidMessage('no-game-class', { line: 0 }) });
  }

  issues.push(...duplicateDeclarations(parsed, entry));
  const entryParsed = parsed.find((p) => p.file.path === entry);
  const entryGame = entryParsed ? findGameClass(entryParsed.ast) : null;
  const asts = parsed.map((p) => p.ast);
  const facts: GameFacts = { api, own: new Set(), declared: new Set(), artDeclared: new Set(), artUsed: new Set(), restartDials: restartDials(entryGame, asts) };
  const scenes = new Map<Parsed, Set<AnyNode>>();
  for (const p of parsed) {
    collectDeclared(p.ast, facts.declared);
    const s = sceneClassesOf(p, p.file.path === entry);
    scenes.set(p, s);
    collectOwn(p, s, facts.own);
  }

  const dialNames = declaredDials(entryGame, asts);
  const renamed: ValidationResult['renamed'] = [];
  let statics: Record<string, JsonValue> = {};
  const staticLines: Record<string, number> = {};
  const fixes: ValidationResult['fixes'] = [];
  const strings: ValidationResult['strings'] = [];
  const out = new Map<string, string>();
  for (const p of parsed) {
    const isEntry = p.file.path === entry;
    const game = isEntry ? findGameClass(p.ast) : null;
    const ms = new MagicString(p.file.content);
    const ctx = new FileContext(p.file.path, p.file.content, p.ast, ms, fix, facts, scenes.get(p) ?? new Set(), game);
    let fileStatics: Record<string, JsonValue> = {};
    if (game) {
      const art = staticFields(game).get('art');
      if (art?.value?.type === 'ObjectExpression') {
        for (const prop of art.value.properties) if (prop.type === 'Property') facts.artDeclared.add(keyName(prop.key, prop.computed) || String((prop.key.type === 'Literal' && prop.key.value) || ''));
      }
      const read = readStatics(game);
      fileStatics = read.values;
      statics = read.values;
      for (const [name, field] of staticFields(game)) staticLines[name] = lineOf(field);
      for (const bad of read.nonLiteral) ctx.add('warning', 'static-literal', bad.node, `\`static ${bad.name}\` must be a plain literal (numbers, strings, true/false, arrays, objects) so the editor can read it without running the game.`, { name: bad.name });
    }
    checkGameClass(ctx, isEntry);
    runRules(ctx);
    checkDials(ctx);
    checkGlobals(ctx);
    checkGraphicsArt(ctx);
    checkDialReads(ctx, dialNames);
    if (game) {
      checkManifestStatics(ctx, game);
      checkWorldArt(ctx, game, world, renamed);
    }
    strings.push(...visibleStrings(p.file.path, p.ast, fileStatics, staticLines));
    issues.push(...ctx.issues);
    fixes.push(...ctx.fixes);
    if (ctx.fixes.length) out.set(p.file.path, ms.toString());
  }

  facts.artDeclared.delete('');
  // The kit's effects atlas and Phaser's own textures are shown, never drawn: they are not art.
  for (const key of facts.artUsed) if (isKitTexture(key)) facts.artUsed.delete(key);
  const missing = [...facts.artUsed].filter((k) => !facts.artDeclared.has(k));
  if (missing.length) {
    issues.push({
      rule: 'undeclared-art',
      severity: 'warning',
      file: entry,
      line: 0,
      column: 0,
      message: `Art used but not in static art: ${missing.join(', ')} (stand-ins will be shown; add them so Amble can ask the student to draw them).`,
      kid: kidMessage('undeclared-art', { line: 0, name: missing.join(', ') }),
    });
  }
  const order = new Map(files.map((f, i) => [f.path, i]));
  issues.sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0) || a.line - b.line || a.column - b.column);
  return {
    issues,
    fixes,
    files: files.map((f) => (out.has(f.path) ? { path: f.path, content: out.get(f.path) as string } : f)),
    truncated,
    syntaxErrors,
    art: { declared: [...facts.artDeclared], used: [...facts.artUsed], missing },
    statics,
    strings,
    renamed,
  };
}

function result(p: Pass, fixes = p.fixes): ValidationResult {
  const errors = p.issues.filter((i) => i.severity === 'error');
  return { ok: errors.length === 0, errors, warnings: p.issues.filter((i) => i.severity === 'warning'), fixes, files: p.files, truncated: p.truncated, art: p.art, statics: p.statics, strings: p.strings, renamed: p.renamed };
}

/**
 * Checks a game's files. With `fix` (the default) safe auto-fixes are applied and the result
 * describes the fixed files: what's left to fix, and which fixes were made.
 */
export function validateGame(files: readonly GameFile[], options: ValidateOptions): ValidationResult {
  const api = normalizeManifest(options.manifest);
  const entry = options.entry ?? ENTRY_FILE;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const fix = options.fix !== false;
  const world = options.world;
  const first = runPass(files, api, entry, fix, limits, world);
  if (!fix || first.fixes.length === 0) return result(first);
  const second = runPass(first.files, api, entry, false, limits, world);
  // A fix must never break the code; if one did, report the original problems unfixed.
  if (second.syntaxErrors > first.syntaxErrors) return result(runPass(files, api, entry, false, limits, world), []);
  return result(second, first.fixes);
}

/** Checks a one-file game (`game.js`). */
export function validateCode(code: string, options: ValidateOptions): ValidationResult {
  return validateGame([{ path: options.entry ?? ENTRY_FILE, content: code }], options);
}
