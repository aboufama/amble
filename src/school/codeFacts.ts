/**
 * What a world's code does, read statically for the assignment checks (§2.13, §4.2 `AutoCheck`): the boss's
 * distinct attacks (pattern.* and shoot calls inside `brain()` or `phases()`), brain states, win and lose
 * (a `win()`/`lose()` call, or the kit's own ending: a boss that dies wins, a hero that dies loses), the
 * dials it reads, the sounds it plays and their captions. Files that don't parse (a student's typo)
 * are skipped; the checks still say what they found in the rest.
 */
import { parse, type AnyNode, type CallExpression, type Expression, type MemberExpression, type PrivateIdentifier, type Super } from 'acorn';
import { simple } from 'acorn-walk';
import { extractManifest, sourceFilesOf } from '../cores/ai';
import type { CodeFile } from '../model/types';

export interface CodeFacts {
  /** Distinct attacks the boss's brain or phases can make ("pattern.ring", "shoot:orb"). */
  attacks: string[];
  /** The most states in one `brain()`. */
  brainStates: number;
  win: boolean;
  lose: boolean;
  /** Dials declared in `static dials`. */
  dials: string[];
  /** Dials the code reads (`this.dial.jump`). */
  dialsRead: string[];
  /** `static sounds` names and their captions ('' = none). */
  sounds: Record<string, string>;
  /** Sound names the code plays (`this.sfx('roar')`, `this.sound.play('roar')`). */
  sfx: string[];
  /** Files that didn't parse. */
  unreadable: string[];
}

function propName(m: MemberExpression): string | null {
  const p = m.property as Expression | PrivateIdentifier;
  if (!m.computed && p.type === 'Identifier') return p.name;
  if (m.computed && p.type === 'Literal' && typeof p.value === 'string') return p.value;
  return null;
}

function calleeMember(call: CallExpression): MemberExpression | null {
  const c = call.callee as Expression | Super;
  return c.type === 'MemberExpression' ? c : null;
}

/** `pattern.ring(...)` or `this.pattern.ring(...)`: the pattern's name. */
function patternName(call: CallExpression): string | null {
  const m = calleeMember(call);
  if (!m) return null;
  const obj = m.object as Expression | Super;
  const isPattern = (obj.type === 'Identifier' && obj.name === 'pattern') || (obj.type === 'MemberExpression' && propName(obj) === 'pattern');
  return isPattern ? propName(m) : null;
}

function stringArg(call: CallExpression, i: number): string | null {
  const a = call.arguments[i];
  return a && a.type === 'Literal' && typeof a.value === 'string' ? a.value : null;
}

/** The `key` option of a shot (`{ key: 'orb' }`), or the source of the shooter. */
function shotKey(call: CallExpression, src: string): string {
  for (const a of call.arguments) {
    if (a.type !== 'ObjectExpression') continue;
    for (const p of a.properties) {
      if (p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'key' && p.value.type === 'Literal') return String(p.value.value);
    }
  }
  const first = call.arguments[0];
  return first ? src.slice(first.start, first.end) : '';
}

/** `{ boss: true }` among a call's arguments. */
function bossOption(call: CallExpression): boolean {
  return call.arguments.some(
    (a) => a.type === 'ObjectExpression' && a.properties.some((p) => p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'boss' && p.value.type === 'Literal' && p.value.value === true),
  );
}

/** `this.dials.jump` (and the kit's alias `this.dial.jump`). */
function isThisDial(m: MemberExpression): boolean {
  const obj = m.object as Expression | Super;
  if (obj.type !== 'MemberExpression' || obj.object.type !== 'ThisExpression') return false;
  const name = propName(obj);
  return name === 'dials' || name === 'dial';
}

export function codeFacts(code: readonly CodeFile[]): CodeFacts {
  const zones: Array<[number, number, string]> = [];
  const attacksIn: Array<{ file: string; at: number; key: string }> = [];
  const patternsAnywhere = new Set<string>();
  const dialsRead = new Set<string>();
  const sfx = new Set<string>();
  const unreadable: string[] = [];
  let brainStates = 0;
  let win = false;
  let lose = false;
  // The kit ends a game by itself: a boss's death wins it and the hero's loses it (unless the code handles 'die').
  let heroSpawned = false;
  let bossSpawned = false;
  const spawnedKeys = new Set<string>();

  for (const file of code) {
    let ast: AnyNode;
    try {
      ast = parse(file.source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });
    } catch {
      unreadable.push(file.path);
      continue;
    }
    simple(ast, {
      CallExpression(node) {
        const call = node as CallExpression;
        const m = calleeMember(call);
        const name = m ? propName(m) : call.callee.type === 'Identifier' ? call.callee.name : null;
        if (name === 'brain' || name === 'phases') {
          zones.push([call.start, call.end, file.path]);
          if (name === 'brain') {
            const states = call.arguments[1];
            if (states?.type === 'ObjectExpression') brainStates = Math.max(brainStates, states.properties.length);
          }
        }
        if (name === 'win') win = true;
        if (name === 'lose') lose = true;
        if (name && /^spawn/.test(name)) {
          if (name === 'spawnHero') heroSpawned = true;
          if (bossOption(call)) bossSpawned = true;
          const key = stringArg(call, 2);
          if (key) spawnedKeys.add(key);
        }
        if (name === 'sfx') {
          const s = stringArg(call, 0);
          if (s) sfx.add(s);
        }
        if (name === 'play' && m && m.object.type === 'MemberExpression' && propName(m.object) === 'sound') {
          const s = stringArg(call, 0);
          if (s) sfx.add(s);
        }
        const pattern = patternName(call);
        if (pattern) {
          patternsAnywhere.add(`pattern.${pattern}`);
          attacksIn.push({ file: file.path, at: call.start, key: `pattern.${pattern}` });
        } else if (name === 'shoot') {
          attacksIn.push({ file: file.path, at: call.start, key: `shoot:${shotKey(call, file.source)}` });
        }
      },
      MemberExpression(node) {
        const m = node as MemberExpression;
        if (isThisDial(m)) {
          const key = propName(m);
          if (key) dialsRead.add(key);
        }
      },
    });
  }

  const inZone = (a: { file: string; at: number }) => zones.some(([s, e, f]) => f === a.file && a.at >= s && a.at < e);
  const attacks = zones.length ? [...new Set(attacksIn.filter(inZone).map((a) => a.key))] : [...patternsAnywhere];

  let dials: string[] = [];
  let sounds: Record<string, string> = {};
  try {
    const statics = extractManifest(sourceFilesOf(code)).statics;
    const art = statics.art && typeof statics.art === 'object' ? (statics.art as Record<string, unknown>) : {};
    for (const key of spawnedKeys) {
      const role = (art[key] as { role?: unknown } | undefined)?.role;
      if (role === 'boss') bossSpawned = true;
      if (role === 'hero') heroSpawned = true;
    }
    if (statics.dials && typeof statics.dials === 'object') dials = Object.keys(statics.dials as Record<string, unknown>);
    if (statics.sounds && typeof statics.sounds === 'object') {
      for (const [k, v] of Object.entries(statics.sounds as Record<string, unknown>)) {
        const caption = v && typeof v === 'object' ? (v as { caption?: unknown }).caption : undefined;
        sounds[k] = typeof caption === 'string' ? caption.trim() : '';
      }
    }
  } catch {
    dials = [];
    sounds = {};
  }

  return { attacks: attacks.sort(), brainStates, win: win || bossSpawned, lose: lose || heroSpawned, dials, dialsRead: [...dialsRead].sort(), sounds, sfx: [...sfx].sort(), unreadable };
}
