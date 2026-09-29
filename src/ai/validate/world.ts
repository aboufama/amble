/**
 * Rules that need to know the world the code belongs to (§5.7): the student's drawings keep their keys,
 * the plan's keys are declared, teacher-locked lines stay exactly as they were, and characters are never
 * drawn by code (art is human). Plus a line starting with `@@`, which is a stray envelope directive.
 */
import type { AnyNode, CallExpression, ClassDeclaration, Expression, ObjectExpression } from 'acorn';
import { ancestor } from 'acorn-walk';
import { memberPath, propertyName, src } from './ast';
import type { FileContext } from './context';
import { humanize, jsString, trimWords } from './art';
import { staticFields } from './statics';
import type { ArtLiteral, GameFile, WorldFacts } from './types';

/** `{ kind: 'character', w: 40 }` as JS source. */
export function artLiteralSource(spec: ArtLiteral): string {
  const fields = Object.entries(spec).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : jsString(k)}: ${typeof v === 'string' ? jsString(v) : String(v)}`);
  return `{ ${fields.join(', ')} }`;
}

/** A minimal spec for a key the code needs but never declared. */
export function minimalArt(key: string, from?: ArtLiteral): ArtLiteral {
  const name = typeof from?.name === 'string' ? from.name : humanize(key);
  return { kind: 'character', name, ask: trimWords(`Draw the ${name}`, 80), ...(from ?? {}) };
}

function artObject(game: ClassDeclaration): ObjectExpression | null {
  const f = staticFields(game).get('art');
  return f?.value?.type === 'ObjectExpression' ? f.value : null;
}

/** Adds `key: {...}` entries to `static art` (creating it when the class has none). */
function addArtEntries(ctx: FileContext, game: ClassDeclaration, entries: Array<[string, ArtLiteral]>): void {
  if (!entries.length) return;
  const text = entries.map(([k, spec]) => `    ${k}: ${artLiteralSource(spec)},`).join('\n');
  const obj = artObject(game);
  if (obj) {
    const last = obj.properties[obj.properties.length - 1];
    if (!last) {
      ctx.ms.appendLeft(obj.start + 1, `\n${text}\n  `);
      return;
    }
    // After the last entry's trailing comma when it has one, else after the entry with a comma.
    const comma = ctx.code.slice(last.end, obj.end - 1).indexOf(',');
    if (comma >= 0) ctx.ms.appendLeft(last.end + comma + 1, `\n${text}`);
    else ctx.ms.appendLeft(last.end, `,\n${text}`);
    return;
  }
  ctx.ms.appendLeft(game.body.start + 1, `\n  static art = {\n${text}\n  };`);
}

// ------------------------------------------------------------------ art keys: plan, drawings, renames

export function checkWorldArt(ctx: FileContext, game: ClassDeclaration, world: WorldFacts | undefined, renamed: Array<{ from: string; to: string }>): void {
  if (!world) return;
  const declared = ctx.facts.artDeclared;
  const add: Array<[string, ArtLiteral]> = [];

  for (const [key, spec] of Object.entries(world.planArt ?? {})) {
    if (declared.has(key)) continue;
    ctx.add('warning', 'plan-keys', game, `The plan's art key \`${key}\` is not in static art; Amble added it.`, { name: key, fixed: ctx.fix });
    if (ctx.fix) {
      add.push([key, minimalArt(key, spec)]);
      ctx.applyFix('plan-keys', game, `added art key ${key}`, () => undefined);
    }
  }

  const previous = world.previousArt ?? {};
  const missing = (world.drawn ?? []).filter((k) => !declared.has(k) && !add.some(([a]) => a === k));
  const known = new Set([...Object.keys(previous), ...Object.keys(world.planArt ?? {})]);
  const appeared = [...declared].filter((k) => !known.has(k));
  if (missing.length === 1 && appeared.length === 1) {
    const from = missing[0];
    const to = appeared[0];
    const was = previous[from]?.kind;
    const now = readKind(game, to);
    if (!was || !now || was === now) {
      renamed.push({ from, to });
      ctx.add('warning', 'renamed-art', game, `The drawn art key \`${from}\` became \`${to}\`; the drawing moves to \`${to}\`.`, { name: `${from} -> ${to}` });
      return finish();
    }
  }
  for (const key of missing) {
    ctx.add('error', 'drawn-art-kept', game, `\`${key}\` is a drawing the student made, so it must stay in static art (keep the key; add new art with new keys).`, { name: key, fixed: ctx.fix });
    if (ctx.fix) {
      add.push([key, minimalArt(key, previous[key])]);
      ctx.applyFix('drawn-art-kept', game, `re-declared drawn art ${key}`, () => undefined);
    }
  }
  finish();

  function finish(): void {
    if (ctx.fix) addArtEntries(ctx, game, add);
  }
}

function readKind(game: ClassDeclaration, key: string): string | null {
  const obj = artObject(game);
  const entry = obj?.properties.find((p) => p.type === 'Property' && ((p.key.type === 'Identifier' && p.key.name === key) || (p.key.type === 'Literal' && p.key.value === key)));
  if (!entry || entry.type !== 'Property' || entry.value.type !== 'ObjectExpression') return null;
  const kind = entry.value.properties.find((p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'kind');
  return kind && kind.type === 'Property' && kind.value.type === 'Literal' && typeof kind.value.value === 'string' ? kind.value.value : null;
}

// ------------------------------------------------------------------ teacher-locked lines

const lines = (s: string) => s.split('\n').map((l) => l.trimEnd());

/** Where a block of lines sits in a file now (1-based start), or -1 when it is gone or changed. */
export function findBlock(content: string, block: readonly string[]): number {
  if (!block.length) return 1;
  const all = lines(content);
  outer: for (let i = 0; i + block.length <= all.length; i++) {
    for (let j = 0; j < block.length; j++) if (all[i + j] !== block[j]) continue outer;
    return i + 1;
  }
  return -1;
}

/** The locked blocks of the previous version, by file. */
function lockedBlocks(world: WorldFacts): Array<{ path: string; range: readonly [number, number]; block: string[] }> {
  const out: Array<{ path: string; range: readonly [number, number]; block: string[] }> = [];
  for (const [path, ranges] of Object.entries(world.locked ?? {})) {
    const prev = world.previous?.find((f) => f.path === path);
    if (!prev) continue;
    const all = lines(prev.content);
    for (const range of ranges) {
      const [a, b] = range;
      if (a < 1 || b < a) continue;
      out.push({ path, range, block: all.slice(a - 1, b) });
    }
  }
  return out;
}

/** Every locked block must still be in its file, unchanged (it may have moved). Game-level: files can vanish. */
export function lockedLineIssues(files: readonly GameFile[], world: WorldFacts | undefined): Array<{ path: string; line: number; message: string }> {
  if (!world?.locked) return [];
  const out: Array<{ path: string; line: number; message: string }> = [];
  for (const { path, range, block } of lockedBlocks(world)) {
    const file = files.find((f) => f.path === path);
    if (!file) {
      out.push({ path, line: 0, message: `${path} has lines the teacher locked (${range[0]}-${range[1]}); it can't be deleted.` });
      continue;
    }
    if (findBlock(file.content, block) < 0) out.push({ path, line: range[0], message: `Lines ${range[0]}-${range[1]} of ${path} are locked by the teacher; keep them exactly as they were.` });
  }
  return out;
}

// ------------------------------------------------------------------ art is human: no characters drawn by code

const SHAPES = new Set(['graphics', 'rectangle', 'circle', 'ellipse', 'star', 'triangle', 'polygon', 'arc', 'text', 'isobox', 'isotriangle']);
const TEXTURE_MAKERS = /\.textures\.(create|createCanvas|addCanvas|addBase64|addImage|addSpriteSheet|addAtlas|addDynamicTexture)$/;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const CHARACTER_NAMES = /^this\.(hero|player|boss|enemy|enemies|monster|villain|character|pet|npc)\w*$/i;

/** `this.add.rectangle(...)`, `this.add.graphics()`, `this.make.text(...)`: a code-drawn shape. */
function isShapeCall(n: AnyNode | null | undefined): n is CallExpression {
  if (!n || n.type !== 'CallExpression') return false;
  const m = /^this\.(?:add|make)\.(\w+)$/.exec(memberPath(n.callee));
  return Boolean(m && SHAPES.has(m[1]));
}

/** A string made only of emoji ("👾", "🐱🐶"). */
function emojiOnly(s: string): boolean {
  const t = s.replace(/[\s️‍]/g, '');
  return t.length > 0 && t.length <= 12 && [...t].every((ch) => PICTOGRAPH.test(ch));
}

export function checkGraphicsArt(ctx: FileContext): void {
  const shapeNames = new Set<string>();
  ancestor(ctx.ast, {
    VariableDeclarator(n) {
      if (n.id.type === 'Identifier' && isShapeCall(n.init)) shapeNames.add(n.id.name);
    },
    AssignmentExpression(n) {
      const left = memberPath(n.left);
      if (!isShapeCall(n.right)) return;
      if (left) shapeNames.add(left);
      const shape = /^this\.(?:add|make)\.(\w+)$/.exec(memberPath(n.right.callee))?.[1];
      if (CHARACTER_NAMES.test(left) && shape !== 'text') {
        ctx.add('error', 'graphics-art', n, `\`${left}\` is drawn with \`this.add.${shape}\`. Characters are pictures the student draws: declare an art key in static art and use this.spawn*(x, y, key).`, { name: left });
      }
    },
  });
  const isShape = (arg: Expression | undefined): boolean => Boolean(arg && (isShapeCall(arg) || shapeNames.has(memberPath(arg))));
  ancestor(ctx.ast, {
    CallExpression(n) {
      const callee = memberPath(n.callee);
      const prop = propertyName(n.callee);
      if (prop === 'generateTexture') {
        ctx.add('error', 'graphics-art', n, '`generateTexture` makes a picture with code. Every picture is art the student draws: declare it in static art and use its key.', { name: 'generateTexture' });
        return;
      }
      if (TEXTURE_MAKERS.test(callee)) {
        ctx.add('error', 'graphics-art', n, `\`${callee}\` makes a picture with code. Declare art in static art and use its key instead.`, { name: callee });
        return;
      }
      if ((callee === 'this.physics.add.existing' || callee === 'this.matter.add.gameObject') && isShape(n.arguments[0] as Expression | undefined)) {
        ctx.add('error', 'graphics-art', n, 'A shape drawn with code was given a physics body, so it acts as a character or item. Declare art in static art and use this.spawn*(x, y, key).', { name: src(ctx.code, n.arguments[0]).slice(0, 40) });
        return;
      }
      if (/^this\.(?:add|make)\.text$|^this\.ui\.(?:text|pop|big)$/.test(callee)) {
        const str = n.arguments.find((a) => a.type === 'Literal' && typeof a.value === 'string');
        if (str && str.type === 'Literal' && typeof str.value === 'string' && emojiOnly(str.value)) {
          ctx.add('error', 'graphics-art', n, `The emoji "${str.value}" is used as a picture. Characters and items are drawn by the student: declare art in static art and use its key.`, { name: str.value });
        }
      }
    },
  });
}

/** A line starting with `@@` is an envelope directive that ended up inside a file (it may not even parse). */
export function directiveLines(file: GameFile): Array<{ line: number; column: number }> {
  const out: Array<{ line: number; column: number }> = [];
  file.content.split('\n').forEach((line, i) => {
    if (/^\s*@@/.test(line)) out.push({ line: i + 1, column: line.indexOf('@@') + 1 });
  });
  return out;
}
