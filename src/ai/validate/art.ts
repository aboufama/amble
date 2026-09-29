/**
 * The Game class's manifest statics, checked and gently fixed (§5.7): `static art` (the pictures the
 * student draws), `static dials` (the numbers they tune), and dial reads that name no dial. The editor
 * reads these literals before the game runs (the Cast line, the Dials card), so their words must be the
 * kit's words and their numbers sane.
 */
import type { AnyNode, Class, Expression, ObjectExpression, Property } from 'acorn';
import { ancestor } from 'acorn-walk';
import { keyName, memberPath, propertyName, src } from './ast';
import type { FileContext } from './context';
import { closest } from './manifest';
import { checkSoundsStatic } from './sounds';
import { staticFields } from './statics';

export const ART_KINDS = ['character', 'item', 'projectile', 'prop', 'terrain', 'background', 'decor'] as const;
export const RIG_KINDS = ['biped', 'quadruped', 'flyer', 'swimmer', 'blob', 'object', 'none'] as const;
export const ROLES = ['hero', 'enemy', 'boss', 'npc', 'item', 'hazard', 'prop', 'terrain', 'projectile', 'enemyShot', 'decor', 'background'] as const;
export const FACINGS = ['viewer', 'right', 'left'] as const;
export const PRONOUNS = ['him', 'her', 'them', 'it'] as const;
export const SHAPES = ['box', 'ellipse', 'capsule', 'diamond', 'star', 'heart', 'coin', 'tile'] as const;

/** At most this many pictures and dials (§4.8); sizes in game px; words on request notes. */
export const ART_LIMITS = { keys: 16, dials: 8, minSize: 8, maxSize: 1200, ask: 80, name: 40, label: 24 } as const;

const ART_KEY = /^[a-z][A-Za-z0-9]{0,23}$/;
/**
 * Names every JavaScript object already has: a cast member keyed by one would shadow it in the world's cast,
 * and a world file refuses `constructor` and `prototype` keys, so the saved world could not be opened again.
 */
const OBJECT_NAMES = new Set(['constructor', 'prototype', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']);

/** What models write instead of the kit's words. */
const ENUM_SYNONYMS: Record<string, Record<string, string>> = {
  kind: {
    enemy: 'character', player: 'character', hero: 'character', boss: 'character', npc: 'character', creature: 'character', monster: 'character',
    platform: 'terrain', ground: 'terrain', floor: 'terrain', wall: 'terrain', tile: 'terrain', bullet: 'projectile', shot: 'projectile',
    powerup: 'item', coin: 'item', pickup: 'item', collectible: 'item', gem: 'item', bg: 'background', sky: 'background', backdrop: 'background',
    scenery: 'decor', decoration: 'decor', obstacle: 'prop', object: 'prop', thing: 'prop', hazard: 'prop',
  },
  rig: {
    humanoid: 'biped', human: 'biped', person: 'biped', robot: 'biped', animal: 'quadruped', dog: 'quadruped', cat: 'quadruped', horse: 'quadruped',
    bird: 'flyer', wings: 'flyer', bat: 'flyer', fish: 'swimmer', slime: 'blob', ball: 'blob', thing: 'object', item: 'object', static: 'none', no: 'none',
  },
  role: {
    player: 'hero', main: 'hero', villain: 'boss', friend: 'npc', ally: 'npc', pet: 'npc', coin: 'item', pickup: 'item', powerup: 'item', collectible: 'item',
    bullet: 'projectile', shot: 'projectile', enemyBullet: 'enemyShot', enemyProjectile: 'enemyShot', platform: 'terrain', ground: 'terrain',
    sky: 'background', backdrop: 'background', obstacle: 'hazard', spike: 'hazard', spikes: 'hazard', lava: 'hazard', trap: 'hazard', scenery: 'decor',
  },
  facing: { front: 'viewer', forward: 'viewer', camera: 'viewer', east: 'right', west: 'left' },
  pronoun: { he: 'him', his: 'him', she: 'her', hers: 'her', they: 'them', their: 'them', its: 'it' },
  shape: { rect: 'box', rectangle: 'box', square: 'box', circle: 'ellipse', oval: 'ellipse', pill: 'capsule', gem: 'diamond', round: 'ellipse' },
};

const ENUMS: Record<string, readonly string[]> = { kind: ART_KINDS, rig: RIG_KINDS, role: ROLES, facing: FACINGS, pronoun: PRONOUNS, shape: SHAPES };

/** The closest word in an enum: a known synonym, a near spelling, else null. */
export function nearestEnum(field: string, value: string): string | null {
  const list = ENUMS[field];
  if (!list) return null;
  if (list.includes(value)) return value;
  const low = value.toLowerCase();
  const exact = list.find((v) => v.toLowerCase() === low);
  if (exact) return exact;
  const syn = ENUM_SYNONYMS[field]?.[value] ?? ENUM_SYNONYMS[field]?.[low];
  if (syn) return syn;
  return closest(value, list, {});
}

/** `kind` from what else the entry says, when the model left it out. */
function kindFromRole(role: string | undefined): (typeof ART_KINDS)[number] {
  switch (role) {
    case 'terrain':
      return 'terrain';
    case 'projectile':
    case 'enemyShot':
      return 'projectile';
    case 'item':
      return 'item';
    case 'background':
      return 'background';
    case 'decor':
      return 'decor';
    case 'prop':
    case 'hazard':
      return 'prop';
    default:
      return 'character';
  }
}

/** "moonKing" -> "Moon King". */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase().replace(/\b(i)\b/g, 'I') : key;
}

/** A JS string literal in the style of the code around it. */
export function jsString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')}'`;
}

/** Trims text to `max` characters at a word boundary. */
export function trimWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,;:.-]+$/, '');
}

interface Entry {
  prop: Property;
  key: string;
  obj: ObjectExpression | null;
  fields: Map<string, Property>;
}

function propKey(p: Property): string {
  if (p.key.type === 'Literal' && (typeof p.key.value === 'string' || typeof p.key.value === 'number')) return String(p.key.value);
  return keyName(p.key, p.computed);
}

function entriesOf(obj: ObjectExpression): Entry[] {
  const out: Entry[] = [];
  for (const p of obj.properties) {
    if (p.type !== 'Property') continue;
    const value = p.value.type === 'ObjectExpression' ? p.value : null;
    const fields = new Map<string, Property>();
    for (const f of value?.properties ?? []) if (f.type === 'Property') fields.set(propKey(f), f);
    out.push({ prop: p, key: propKey(p), obj: value, fields });
  }
  return out;
}

function stringValue(p: Property | undefined): string | undefined {
  return p && p.value.type === 'Literal' && typeof p.value.value === 'string' ? p.value.value : undefined;
}

function numberValue(p: Property | undefined): number | undefined {
  if (!p) return undefined;
  const v = p.value;
  if (v.type === 'Literal' && typeof v.value === 'number') return v.value;
  if (v.type === 'UnaryExpression' && v.operator === '-' && v.argument.type === 'Literal' && typeof v.argument.value === 'number') return -v.argument.value;
  return undefined;
}

/** Inserts `text` (a `name: value` pair) as the first field of an object literal. */
function insertField(ctx: FileContext, obj: ObjectExpression, text: string): void {
  const first = obj.properties[0];
  if (first) ctx.ms.appendLeft(first.start, `${text}, `);
  else ctx.ms.appendLeft(obj.start + 1, ` ${text} `);
}

/** Removes a field and the comma after it (or before it, for the last one). */
function removeField(ctx: FileContext, obj: ObjectExpression, p: Property): void {
  const i = obj.properties.indexOf(p);
  const next = obj.properties[i + 1];
  const prev = obj.properties[i - 1];
  if (next) ctx.ms.remove(p.start, next.start);
  else if (prev) ctx.ms.remove(prev.end, p.end);
  else ctx.ms.remove(p.start, p.end);
}

function checkArtEntry(ctx: FileContext, e: Entry): void {
  if (!ART_KEY.test(e.key)) {
    ctx.add('error', 'art-manifest', e.prop, `Art key \`${e.key}\` must be a short camelCase word (letters and digits, starting with a lower-case letter).`, { name: e.key });
  } else if (OBJECT_NAMES.has(e.key)) {
    ctx.add('error', 'art-manifest', e.prop, `Art key \`${e.key}\` is a name JavaScript objects already use: pick another word for this picture.`, { name: e.key });
  }
  const obj = e.obj;
  if (!obj) {
    if (e.prop.value.type !== 'Literal' || e.prop.value.value !== null) ctx.add('error', 'art-manifest', e.prop, `Art \`${e.key}\` must be an object like \`{ kind: 'character', rig: 'biped', w: 40, h: 64 }\`.`, { name: e.key });
    return;
  }
  const role = stringValue(e.fields.get('role'));
  if (!e.fields.has('kind')) {
    const kind = kindFromRole(role && nearestEnum('role', role) ? (nearestEnum('role', role) as string) : role);
    ctx.add('error', 'art-manifest', e.prop, `Art \`${e.key}\` needs a kind (${ART_KINDS.join(', ')}).`, { name: e.key, fixed: ctx.fix });
    ctx.applyFix('art-manifest', e.prop, `${e.key}: added kind '${kind}'`, () => insertField(ctx, obj, `kind: ${jsString(kind)}`));
  }
  for (const field of Object.keys(ENUMS)) {
    const p = e.fields.get(field);
    if (!p) continue;
    const value = stringValue(p);
    if (value !== undefined && ENUMS[field].includes(value)) continue;
    const near = value === undefined ? null : nearestEnum(field, value);
    const shown = value === undefined ? src(ctx.code, p.value) : `'${value}'`;
    if (near) {
      ctx.add('error', 'art-manifest', p, `\`${e.key}.${field}\` is ${shown}; use one of ${ENUMS[field].join(', ')} (did you mean '${near}'?).`, { name: `${e.key}.${field}`, fixed: ctx.fix });
      ctx.applyFix('art-manifest', p, `${e.key}.${field}: ${shown} -> '${near}'`, () => ctx.ms.overwrite(p.value.start, p.value.end, jsString(near)));
    } else if (field === 'kind' || field === 'role') {
      ctx.add('error', 'art-manifest', p, `\`${e.key}.${field}\` is ${shown}; use one of ${ENUMS[field].join(', ')}.`, { name: `${e.key}.${field}` });
    } else {
      // An unknown optional word: the kit's default is better than a guess.
      ctx.add('error', 'art-manifest', p, `\`${e.key}.${field}\` is ${shown}; use one of ${ENUMS[field].join(', ')}.`, { name: `${e.key}.${field}`, fixed: ctx.fix });
      ctx.applyFix('art-manifest', p, `${e.key}.${field}: removed ${shown}`, () => removeField(ctx, obj, p));
    }
  }
  for (const field of ['w', 'h']) {
    const p = e.fields.get(field);
    if (!p) continue;
    const n = numberValue(p);
    if (n === undefined) {
      ctx.add('error', 'art-manifest', p, `\`${e.key}.${field}\` must be a number of game pixels.`, { name: `${e.key}.${field}` });
      continue;
    }
    const clamped = Math.round(Math.min(ART_LIMITS.maxSize, Math.max(ART_LIMITS.minSize, n)));
    if (clamped === n) continue;
    ctx.add('error', 'art-manifest', p, `\`${e.key}.${field}\` is ${n}; sizes are ${ART_LIMITS.minSize} to ${ART_LIMITS.maxSize} game pixels.`, { name: `${e.key}.${field}`, fixed: ctx.fix });
    ctx.applyFix('art-manifest', p, `${e.key}.${field}: ${n} -> ${clamped}`, () => ctx.ms.overwrite(p.value.start, p.value.end, String(clamped)));
  }
  const name = stringValue(e.fields.get('name'));
  const nameProp = e.fields.get('name');
  if (nameProp && name !== undefined && name.length > ART_LIMITS.name) {
    const short = trimWords(name, ART_LIMITS.name);
    ctx.add('error', 'art-manifest', nameProp, `\`${e.key}.name\` is longer than ${ART_LIMITS.name} characters.`, { name: `${e.key}.name`, fixed: ctx.fix });
    ctx.applyFix('art-manifest', nameProp, `${e.key}.name shortened`, () => ctx.ms.overwrite(nameProp.value.start, nameProp.value.end, jsString(short)));
  }
  const askProp = e.fields.get('ask');
  const ask = stringValue(askProp);
  if (askProp && ask !== undefined && ask.length > ART_LIMITS.ask) {
    const short = trimWords(ask, ART_LIMITS.ask);
    ctx.add('error', 'art-manifest', askProp, `\`${e.key}.ask\` is longer than ${ART_LIMITS.ask} characters.`, { name: `${e.key}.ask`, fixed: ctx.fix });
    ctx.applyFix('art-manifest', askProp, `${e.key}.ask shortened`, () => ctx.ms.overwrite(askProp.value.start, askProp.value.end, jsString(short)));
  }
  const kind = stringValue(e.fields.get('kind')) ?? kindFromRole(role);
  const requiredProp = e.fields.get('required');
  const spareProp = e.fields.get('spare');
  const spare = spareProp !== undefined && spareProp.value.type === 'Literal' && spareProp.value.value === true;
  const required = spare
    ? false
    : requiredProp
      ? requiredProp.value.type === 'Literal' && requiredProp.value.value === true
      : kind === 'character' || role === 'hero' || role === 'boss' || role === 'enemy';
  if (required && !askProp) {
    const text = `Draw the ${name ?? humanize(e.key)}`;
    ctx.add('error', 'art-manifest', e.prop, `Art \`${e.key}\` is required, so it needs an \`ask\` line for the student ("${text}").`, { name: e.key, fixed: ctx.fix });
    ctx.applyFix('art-manifest', e.prop, `${e.key}: added ask`, () => insertField(ctx, obj, `ask: ${jsString(trimWords(text, ART_LIMITS.ask))}`));
  }
}

function checkDialEntry(ctx: FileContext, e: Entry, artKeys: ReadonlySet<string>): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(e.key)) ctx.add('error', 'dials-manifest', e.prop, `Dial \`${e.key}\` must be a plain name (it is read as this.dials.${e.key}).`, { name: e.key });
  else if (OBJECT_NAMES.has(e.key) || e.key === '__proto__') ctx.add('error', 'dials-manifest', e.prop, `Dial \`${e.key}\` is a name JavaScript objects already use: pick another word for this dial.`, { name: e.key });
  const obj = e.obj;
  if (!obj) {
    ctx.add('error', 'dials-manifest', e.prop, `Dial \`${e.key}\` must be an object like \`{ label: 'Jump power', value: 720, min: 400, max: 1100 }\`.`, { name: e.key });
    return;
  }
  const labelProp = e.fields.get('label');
  const label = stringValue(labelProp);
  if (!labelProp) {
    ctx.add('error', 'dials-manifest', e.prop, `Dial \`${e.key}\` needs a label (1-3 plain words).`, { name: e.key, fixed: ctx.fix });
    ctx.applyFix('dials-manifest', e.prop, `${e.key}: added a label`, () => insertField(ctx, obj, `label: ${jsString(trimWords(humanize(e.key), ART_LIMITS.label))}`));
  } else if (label !== undefined && label.length > ART_LIMITS.label) {
    ctx.add('error', 'dials-manifest', labelProp, `Dial label "${label}" is longer than ${ART_LIMITS.label} characters.`, { name: e.key, fixed: ctx.fix });
    ctx.applyFix('dials-manifest', labelProp, `${e.key}: label shortened`, () => ctx.ms.overwrite(labelProp.value.start, labelProp.value.end, jsString(trimWords(label, ART_LIMITS.label))));
  }
  const minP = e.fields.get('min');
  const maxP = e.fields.get('max');
  const valueP = e.fields.get('value');
  const min = numberValue(minP);
  const max = numberValue(maxP);
  const value = numberValue(valueP);
  if (min === undefined || max === undefined || value === undefined || !minP || !maxP || !valueP) {
    ctx.add('error', 'dials-manifest', e.prop, `Dial \`${e.key}\` needs number \`value\`, \`min\` and \`max\`.`, { name: e.key });
    return;
  }
  let lo = min;
  let hi = max;
  if (min > max) {
    ctx.add('error', 'dials-manifest', minP, `Dial \`${e.key}\`: min (${min}) is bigger than max (${max}).`, { name: e.key, fixed: ctx.fix });
    ctx.applyFix('dials-manifest', minP, `${e.key}: swapped min and max`, () => {
      ctx.ms.overwrite(minP.value.start, minP.value.end, String(max));
      ctx.ms.overwrite(maxP.value.start, maxP.value.end, String(min));
    });
    lo = max;
    hi = min;
  } else if (min === max) {
    ctx.add('error', 'dials-manifest', minP, `Dial \`${e.key}\`: min and max are both ${min}; give it room to move.`, { name: e.key });
    return;
  }
  if (value < lo || value > hi) {
    const clamped = Math.min(hi, Math.max(lo, value));
    ctx.add('error', 'dials-manifest', valueP, `Dial \`${e.key}\`: value ${value} is outside ${lo}..${hi}.`, { name: e.key, fixed: ctx.fix });
    ctx.applyFix('dials-manifest', valueP, `${e.key}: value ${value} -> ${clamped}`, () => ctx.ms.overwrite(valueP.value.start, valueP.value.end, String(clamped)));
  }
  const forP = e.fields.get('for');
  const forKey = stringValue(forP);
  if (forP && (forKey === undefined || !artKeys.has(forKey))) {
    ctx.add('error', 'dials-manifest', forP, `Dial \`${e.key}\`: \`for\` must name a key in static art${forKey ? ` ("${forKey}" isn't one)` : ''}.`, { name: e.key, fixed: ctx.fix });
    ctx.applyFix('dials-manifest', forP, `${e.key}: removed for`, () => removeField(ctx, obj, forP));
  }
}

function objectStatic(game: Class, name: string): { field: AnyNode; obj: ObjectExpression } | null {
  const f = staticFields(game).get(name);
  return f?.value?.type === 'ObjectExpression' ? { field: f, obj: f.value } : null;
}

/** Dial names the game declares: `static dials`, `static tune`, and `this.tune('name', ...)` anywhere. */
export function declaredDials(game: Class | null, asts: ReadonlyArray<AnyNode>): Set<string> {
  const out = new Set<string>();
  if (game) {
    for (const name of ['dials', 'tune']) {
      const s = objectStatic(game, name);
      for (const e of s ? entriesOf(s.obj) : []) out.add(e.key);
    }
  }
  for (const ast of asts) {
    ancestor(ast, {
      CallExpression(n) {
        const first = n.arguments[0];
        if (memberPath(n.callee) === 'this.tune' && first?.type === 'Literal' && typeof first.value === 'string') out.add(first.value);
      },
    });
  }
  return out;
}

/** `static art`, `static dials` and `static sounds` of the entry file's Game class. */
export function checkManifestStatics(ctx: FileContext, game: Class): void {
  const art = objectStatic(game, 'art');
  const artKeys = new Set<string>();
  if (art) {
    const entries = entriesOf(art.obj);
    for (const e of entries) artKeys.add(e.key);
    if (entries.length > ART_LIMITS.keys) ctx.add('error', 'art-manifest', art.field, `static art has ${entries.length} pictures; keep it to ${ART_LIMITS.keys} or fewer.`, { name: `${entries.length} pictures` });
    for (const e of entries) checkArtEntry(ctx, e);
  }
  const dials = objectStatic(game, 'dials');
  if (dials) {
    const entries = entriesOf(dials.obj);
    if (entries.length > ART_LIMITS.dials) ctx.add('error', 'dials-manifest', dials.field, `static dials has ${entries.length} dials; keep the ${ART_LIMITS.dials} a player cares about most.`, { name: `${entries.length} dials` });
    for (const e of entries) checkDialEntry(ctx, e, artKeys);
  }
  checkSoundsStatic(ctx, game);
}

/** `this.dials.x` / `this.dial.x` where no dial `x` is declared (a typo reads undefined, and NaN follows). */
export function checkDialReads(ctx: FileContext, declared: ReadonlySet<string>): void {
  ancestor(ctx.ast, {
    MemberExpression(n) {
      const obj = memberPath(n.object);
      if (obj !== 'this.dials' && obj !== 'this.dial') return;
      const name = propertyName(n);
      if (!name || declared.has(name)) return;
      const sug = declared.size ? closest(name, declared, {}) : null;
      const near = sug !== null && editDistance(name, sug) <= 2 ? sug : null;
      ctx.add('error', 'unknown-dial', n, `\`${obj}.${name}\` is not a dial${near ? `; did you mean \`${obj}.${near}\`?` : `. Declare it in static dials (${[...declared].join(', ') || 'none yet'}).`}`, { name, suggestion: near ?? undefined, fixed: Boolean(near) && ctx.fix });
      if (near) {
        const prop = n.property as Expression;
        ctx.applyFix('unknown-dial', n, `${obj}.${name} -> ${obj}.${near}`, () => ctx.ms.overwrite(prop.start, prop.end, n.computed ? jsString(near) : near));
      }
    },
  });
}

function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
