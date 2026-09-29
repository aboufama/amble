/**
 * The degradation ladder's second rung (§5.9): when a build fails after its repairs, the world becomes the
 * plan's starter with the plan's ideas written in. The plan's title goes in `static config.title`; each
 * plan member lands on the starter slot it plays (`mapsTo`, else the same role): that slot's name, ask,
 * about, size, rig and facing are rewritten in `static art` (acorn + magic-string, keys kept), so the
 * student draws "the Salt King", not "the boss". Dial labels follow the plan where keys match, else where
 * the plan's dial measures the same thing as exactly one starter dial (`bossHp` and `bossHealth`); members
 * with no slot rest on the cast line.
 */
import { parse, type ClassDeclaration, type Node, type ObjectExpression, type Program, type Property } from 'acorn';
import MagicString from 'magic-string';
import type { CastKey, CastSlot, CodeFile, PlanCastItem, PlanReply, World } from '../model/types';
import { artNeedOf, readStatics, type Spec } from './manifest';
import { sizeOf } from './sizes';

export interface LadderResult {
  files: CodeFile[];
  /** Plan key -> the starter key it now plays. */
  mapping: Record<CastKey, CastKey>;
  /** Plan members with no slot: they rest on the cast line. */
  resting: PlanCastItem[];
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')}'`;

function keyOf(p: Property): string {
  if (p.key.type === 'Identifier' && !p.computed) return p.key.name;
  if (p.key.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
  return '';
}

function objectField(cls: ClassDeclaration, name: string): ObjectExpression | null {
  for (const m of cls.body.body) {
    if (m.type === 'PropertyDefinition' && m.static && m.key.type === 'Identifier' && m.key.name === name && m.value?.type === 'ObjectExpression') return m.value;
  }
  return null;
}

/** Sets `field: value` in an object literal: overwrites it, or adds it first. */
function setField(ms: MagicString, obj: ObjectExpression, field: string, value: string): void {
  const p = obj.properties.find((x): x is Property => x.type === 'Property' && keyOf(x) === field);
  if (p) ms.overwrite(p.value.start, p.value.end, value);
  else if (obj.properties[0]) ms.appendLeft(obj.properties[0].start, `${field}: ${value}, `);
  else ms.appendLeft(obj.start + 1, ` ${field}: ${value} `);
}

/** Which starter slot each plan member plays: its `mapsTo`, else a free slot with the same role. */
export function ladderMapping(plan: PlanReply, starterArt: Record<string, Spec>): { mapping: Record<CastKey, CastKey>; resting: PlanCastItem[] } {
  const mapping: Record<CastKey, CastKey> = {};
  const taken = new Set<string>();
  const resting: PlanCastItem[] = [];
  const pending: PlanCastItem[] = [];
  for (const c of plan.cast) {
    if (c.mapsTo && starterArt[c.mapsTo] && !taken.has(c.mapsTo)) {
      mapping[c.key] = c.mapsTo;
      taken.add(c.mapsTo);
    } else pending.push(c);
  }
  // Roles as the kit reads them: the declared role, else the one its kind implies.
  const roles = Object.fromEntries(Object.entries(starterArt).map(([k, spec], i) => [k, artNeedOf(k, spec, i).role]));
  for (const c of pending) {
    const role = c === plan.cast[0] ? 'hero' : c.role;
    const slot = Object.keys(starterArt).find((k) => !taken.has(k) && (roles[k] === role || (role === 'hero' && k === 'hero')));
    if (slot) {
      mapping[c.key] = slot;
      taken.add(slot);
    } else resting.push(c);
  }
  return { mapping, resting };
}

/** Words that measure the same thing (`bossHp` and `bossHealth` are both health). */
const MEASURES: Record<string, string> = { hp: 'health', life: 'health', lives: 'health', hearts: 'health', spd: 'speed', velocity: 'speed', rate: 'speed', height: 'jump', strength: 'power', scale: 'size' };

/** The last word of a camelCase key, as a measure. */
function measureOf(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const last = words[words.length - 1] ?? '';
  return MEASURES[last] ?? last;
}

/** Which plan label each starter dial takes: the same key, else the one starter dial measuring the same thing. */
export function ladderDialLabels(plan: PlanReply, starterDials: readonly string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  const left = plan.dials.filter((d) => {
    if (!d.label || !starterDials.includes(d.key)) return true;
    labels[d.key] = d.label.slice(0, 24);
    return false;
  });
  for (const d of left) {
    if (!d.label) continue;
    const same = starterDials.filter((k) => !(k in labels) && measureOf(k) === measureOf(d.key));
    if (same.length === 1) labels[same[0]] = d.label.slice(0, 24);
  }
  return labels;
}

/**
 * The files with these members' names written into `static art` (keys, lines and authors kept): a world
 * type opened for the student's own hero calls the hero by the name the student gave it ("Give Blorp a
 * world": Blorp is the hero, not the starter's Pip).
 */
export function renameMembers(files: readonly CodeFile[], names: Readonly<Record<CastKey, string>>): CodeFile[] {
  return files.map((f): CodeFile => {
    if (f.path !== 'game.js') return f;
    let ast: Program;
    try {
      ast = parse(f.source, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch {
      return f;
    }
    const game = ast.body.find((n: Node): n is ClassDeclaration => n.type === 'ClassDeclaration' && (n as ClassDeclaration).id?.name === 'Game');
    const art = game ? objectField(game, 'art') : null;
    if (!art) return f;
    const ms = new MagicString(f.source);
    for (const p of art.properties) {
      if (p.type !== 'Property' || p.value.type !== 'ObjectExpression') continue;
      const name = names[keyOf(p)]?.trim();
      if (name) setField(ms, p.value, 'name', quote(name));
    }
    return ms.hasChanged() ? { ...f, source: ms.toString() } : f;
  });
}

/** The starter's files with the plan written into its statics. */
export function ladderFiles(plan: PlanReply, starterFiles: readonly CodeFile[]): LadderResult {
  const statics = readStatics(starterFiles);
  const { mapping, resting } = ladderMapping(plan, statics.art);
  const byKey = new Map(plan.cast.map((c) => [c.key, c]));
  const files = starterFiles.map((f): CodeFile => {
    if (f.path !== 'game.js') return f;
    let ast: Program;
    try {
      ast = parse(f.source, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch {
      return f;
    }
    const game = ast.body.find((n: Node): n is ClassDeclaration => n.type === 'ClassDeclaration' && (n as ClassDeclaration).id?.name === 'Game');
    if (!game) return f;
    const ms = new MagicString(f.source);
    const config = objectField(game, 'config');
    if (config && plan.title) setField(ms, config, 'title', quote(plan.title));
    const art = objectField(game, 'art');
    for (const p of art?.properties ?? []) {
      if (p.type !== 'Property' || p.value.type !== 'ObjectExpression') continue;
      const starterKey = keyOf(p);
      const planKey = Object.keys(mapping).find((k) => mapping[k] === starterKey);
      const c = planKey ? byKey.get(planKey) : undefined;
      if (!c) continue;
      const kind = typeof statics.art[starterKey]?.kind === 'string' ? (statics.art[starterKey].kind as PlanCastItem['kind']) : c.kind;
      const { w, h } = sizeOf(c.size, kind);
      const entry = p.value;
      setField(ms, entry, 'name', quote(c.name));
      setField(ms, entry, 'ask', quote(c.ask));
      if (c.about) setField(ms, entry, 'about', quote(c.about));
      if (kind !== 'terrain' && kind !== 'background') {
        setField(ms, entry, 'w', String(w));
        setField(ms, entry, 'h', String(h));
      }
      if (kind === 'character' && c.rig !== 'none') setField(ms, entry, 'rig', quote(c.rig));
      if (c.facing) setField(ms, entry, 'facing', quote(c.facing));
      setField(ms, entry, 'pronoun', quote(c.pronoun));
    }
    const dials = objectField(game, 'dials');
    const labels = ladderDialLabels(plan, (dials?.properties ?? []).map((p) => (p.type === 'Property' ? keyOf(p) : '')).filter(Boolean));
    for (const p of dials?.properties ?? []) {
      if (p.type !== 'Property' || p.value.type !== 'ObjectExpression') continue;
      const label = labels[keyOf(p)];
      if (label) setField(ms, p.value, 'label', quote(label));
    }
    const source = ms.toString();
    return { ...f, source, authors: [['starter', source.split('\n').length]] };
  });
  return { files, mapping, resting };
}

/** The world's cast after the ladder: drawings move to the slots their members now play; the rest rest. */
export function ladderCast(world: World, mapping: Record<CastKey, CastKey>, resting: readonly PlanCastItem[]): Record<CastKey, CastSlot> {
  const cast: Record<CastKey, CastSlot> = {};
  const empty = (key: CastKey): CastSlot => ({ key, art: null, madeBy: null, extra: null, laterUntil: 0 });
  for (const [planKey, starterKey] of Object.entries(mapping)) {
    const was = world.cast[planKey];
    cast[starterKey] = was ? { ...was, key: starterKey, extra: null } : empty(starterKey);
  }
  for (const c of resting) {
    const was = world.cast[c.key];
    cast[c.key] = { ...(was ?? empty(c.key)), extra: { name: c.name, role: c.role, kind: c.kind, rig: c.rig, note: c.about } };
  }
  // Drawings on keys the plan never named stay where they are.
  for (const slot of Object.values(world.cast)) if (!cast[slot.key] && !(slot.key in mapping) && slot.art) cast[slot.key] = slot;
  return cast;
}
