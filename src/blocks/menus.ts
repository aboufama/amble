/**
 * Dropdown menus: where their options come from, what the palette shows by default, and
 * how renaming a costume, sound, sprite or variable updates the blocks that use it.
 *
 * No Blockly dependency: everything works on the project state and on Blockly's JSON
 * serialization of workspaces, so it is shared by the editor, the compiler and the tests.
 */
import type { BlocksState, Project, Target } from '../project/types';
import { BLOCK_BY_TYPE, CHARACTER_SPECIAL_LABELS, MENU_CHOICES, type CharacterSpecial, type MenuKind } from './spec';

export const KEY_OPTIONS = [
  'space',
  'up arrow',
  'down arrow',
  'right arrow',
  'left arrow',
  'any',
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
];
export const BACKDROP_EXTRAS = ['next backdrop', 'previous backdrop', 'random backdrop'];

/** Every special character, in menu order. */
export const ALL_SPECIALS: CharacterSpecial[] = ['me', 'mouse', 'random', 'center', 'edge', 'anyone'];

/** Menu entries that run an action instead of becoming the value. They are never saved. */
export const NEW_MESSAGE = '⁣new-message';
export const RENAME_VARIABLE = '⁣rename-variable';
export const DELETE_VARIABLE = '⁣delete-variable';
export const RECORD_SOUND = '⁣record-sound';

export function isActionValue(value: string): boolean {
  return value === NEW_MESSAGE || value === RENAME_VARIABLE || value === DELETE_VARIABLE || value === RECORD_SOUND;
}

export const SEPARATOR = 'separator';
export type MenuOption = [label: string, value: string] | typeof SEPARATOR;

/** What a dropdown needs to know to list its options. */
export interface MenuContext {
  project: Project;
  /** The sprite or stage being edited. */
  target: Target | null;
  /** The edited target's blocks as the editor shows them right now (newer than `target.blocks`). */
  liveBlocks?: BlocksState | null;
  /** Messages made with "New message" that no block uses yet. */
  newMessages?: string[];
}

// -----------------------------------------------------------------------------
// Walking Blockly's JSON serialization
// -----------------------------------------------------------------------------

/** One block in Blockly's JSON serialization (only the parts menus care about). */
export interface JsonBlockLike {
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: JsonBlockLike; shadow?: JsonBlockLike }>;
  next?: { block?: JsonBlockLike };
}

function topBlocks(state: BlocksState | null | undefined): JsonBlockLike[] {
  return ((state?.blocks as { blocks?: JsonBlockLike[] } | undefined)?.blocks ?? []) as JsonBlockLike[];
}

/** Calls `fn` for every block in a workspace state (nested, dropped-in and following blocks included). */
export function forEachBlock(state: BlocksState | null | undefined, fn: (b: JsonBlockLike) => void): void {
  const visit = (b: JsonBlockLike | undefined) => {
    while (b) {
      fn(b);
      for (const input of Object.values(b.inputs ?? {})) {
        visit(input.block);
        visit(input.shadow);
      }
      b = b.next?.block;
    }
  };
  for (const top of topBlocks(state)) visit(top);
}

/**
 * The fields of a block that name something from a list: its dropdowns, plus the names on
 * character blocks and variable blocks.
 */
export function namedFields(type: string): Array<[field: string, kind: MenuKind]> {
  const out: Array<[string, MenuKind]> = [];
  for (const [name, input] of Object.entries(BLOCK_BY_TYPE.get(type)?.inputs ?? {})) {
    if (input.kind === 'menu' && input.menu) out.push([name, input.menu]);
  }
  if (type === 'char_ref') out.push(['NAME', 'character']);
  if (type === 'mem_var') out.push(['VARIABLE', 'variable']);
  return out;
}

/** Values of every field of the given kinds in a workspace state. */
export function menuValues(state: BlocksState | null | undefined, kinds: MenuKind[]): string[] {
  const out: string[] = [];
  forEachBlock(state, (b) => {
    for (const [field, kind] of namedFields(b.type)) {
      const value = b.fields?.[field];
      if (kinds.includes(kind) && typeof value === 'string' && value) out.push(value);
    }
  });
  return out;
}

/** Sets every field of the given kinds whose value is `from` to `to`. Returns how many changed. */
export function renameInBlocks(state: BlocksState | null | undefined, kinds: MenuKind[], from: string, to: string): number {
  let changed = 0;
  forEachBlock(state, (b) => {
    if (!b.fields) return;
    for (const [field, kind] of namedFields(b.type)) {
      if (kinds.includes(kind) && b.fields[field] === from) {
        b.fields[field] = to;
        changed++;
      }
    }
  });
  return changed;
}

function uniqueSorted(names: Iterable<string>): string[] {
  return [...new Set([...names].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

function allTargets(project: Project): Target[] {
  return [project.stage, ...project.sprites];
}

/** Each target's blocks, using the editor's live copy for the edited target. */
function blocksByTarget(ctx: MenuContext): BlocksState[] {
  return allTargets(ctx.project).map((t) => (ctx.target && t.id === ctx.target.id && ctx.liveBlocks !== undefined ? ctx.liveBlocks : t.blocks) ?? {});
}

// -----------------------------------------------------------------------------
// Messages, variables, skills and characters
// -----------------------------------------------------------------------------

/** Every message used anywhere in the project, sorted (like Scratch). */
export function projectMessages(ctx: MenuContext): string[] {
  return uniqueSorted([...blocksByTarget(ctx).flatMap((state) => menuValues(state, ['message'])), ...(ctx.newMessages ?? [])]);
}

/** Variables for all sprites. Projects saved before variables were declared list the names their blocks use. */
export function globalVariables(project: Project): string[] {
  if (project.variables) return [...project.variables];
  const local = new Set(project.sprites.flatMap((s) => s.variables ?? []));
  return uniqueSorted(allTargets(project).flatMap((t) => menuValues(t.blocks, ['variable'])).filter((n) => !local.has(n)));
}

/** Variables for this sprite only. */
export function localVariables(target: Target | null): string[] {
  return target?.kind === 'sprite' ? [...(target.variables ?? [])] : [];
}

/** The variables a sprite (or the stage) can use, sorted. */
export function variablesFor(project: Project, target: Target | null): string[] {
  return uniqueSorted([...globalVariables(project), ...localVariables(target)]);
}

/** Skills ("skill [...]" blocks) in the edited sprite, in the order they appear. */
export function procedureNames(ctx: MenuContext): string[] {
  const state = ctx.liveBlocks !== undefined ? ctx.liveBlocks : ctx.target?.blocks;
  const names: string[] = [];
  for (const b of topBlocks(state)) {
    const name = b.type === 'pr_define' ? String(b.fields?.NAME ?? '').trim() : '';
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The characters a block can name: the project's sprites (the edited one is "me"), then compiled ones. */
export function characterNames(ctx: MenuContext | null): string[] {
  if (!ctx) return [];
  const own = ctx.project.sprites.filter((s) => s.id !== ctx.target?.id).map((s) => s.name);
  const compiled = (ctx.project.compiled?.sprites ?? []).map((s) => s.name).filter((n) => !ctx.project.sprites.some((s) => s.name === n));
  return [...own, ...compiled];
}

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

const same = (names: string[]): MenuOption[] => names.map((n) => [n, n]);

/**
 * The options a dropdown shows. `current` is the field's value: it is listed only when a
 * menu would otherwise be empty (a value that isn't an option is kept, but not offered).
 * `specials` are the special characters a character slot offers.
 */
export function menuOptions(kind: MenuKind, ctx: MenuContext | null, current = '', specials: CharacterSpecial[] = ALL_SPECIALS): MenuOption[] {
  const target = ctx?.target ?? null;
  const project = ctx?.project;
  const orCurrent = (options: MenuOption[], fallback: string): MenuOption[] =>
    options.length ? options : [[current || fallback, current || fallback]];
  switch (kind) {
    case 'key':
      return same(KEY_OPTIONS);
    case 'costume':
      return orCurrent(same((target?.costumes ?? []).map((c) => c.name)), 'costume1');
    case 'switchBackdrop':
      return [...same((project?.stage.costumes ?? []).map((c) => c.name)), ...same(BACKDROP_EXTRAS)];
    case 'sound':
      return [...orCurrent(same((target?.sounds ?? []).map((s) => s.name)), 'pop'), ['record...', RECORD_SOUND]];
    case 'message': {
      const messages = ctx ? projectMessages(ctx) : [];
      return [...same(messages.length ? messages : [current || 'message1']), ['New message', NEW_MESSAGE]];
    }
    case 'variable': {
      const names = project ? variablesFor(project, target) : [];
      const options = orCurrent(same(names), 'my variable');
      return [...options, ['Rename variable', RENAME_VARIABLE], [`Delete the "${current || names[0] || 'my variable'}" variable`, DELETE_VARIABLE]];
    }
    case 'procedure':
      return orCurrent(same(ctx ? procedureNames(ctx) : []), 'jump');
    case 'character': {
      const shown = target?.kind === 'stage' ? specials.filter((s) => s !== 'me') : specials;
      const options: MenuOption[] = [...shown.map((s): MenuOption => [CHARACTER_SPECIAL_LABELS[s], s]), ...same(characterNames(ctx))];
      const value = current || 'me';
      return options.length ? options : [[(CHARACTER_SPECIAL_LABELS as Record<string, string>)[value] ?? value, value]];
    }
    default:
      return same(MENU_CHOICES[kind] ?? []);
  }
}

/** The value a palette block starts with (Scratch shows the second costume, the last sound...). */
export function menuDefault(kind: MenuKind, ctx: MenuContext | null, fallback: string): string {
  const target = ctx?.target ?? null;
  const project = ctx?.project;
  switch (kind) {
    case 'costume': {
      const costumes = target?.costumes ?? [];
      return costumes[costumes.length > 1 ? 1 : 0]?.name ?? fallback;
    }
    case 'switchBackdrop': {
      const backdrops = project?.stage.costumes ?? [];
      return backdrops[backdrops.length > 1 ? 1 : 0]?.name ?? 'next backdrop';
    }
    case 'sound': {
      const sounds = target?.sounds ?? [];
      return sounds[sounds.length - 1]?.name ?? fallback;
    }
    case 'message':
      return (ctx && projectMessages(ctx)[0]) || 'message1';
    case 'variable':
      return (project && variablesFor(project, target)[0]) || fallback;
    case 'procedure':
      return (ctx && procedureNames(ctx)[0]) || fallback;
    default:
      return fallback || MENU_CHOICES[kind]?.[0] || '';
  }
}

// -----------------------------------------------------------------------------
// Renaming (like Scratch, blocks follow a renamed costume, sound, sprite or variable)
// -----------------------------------------------------------------------------

export type RenameKind = 'costume' | 'sound' | 'sprite' | 'variable';

export interface RenameChange {
  kind: RenameKind;
  /** The sprite or stage that owns the renamed costume or sound; for variables, the sprite that owns
   *  a "this sprite only" variable, or the stage for a variable "for all sprites". */
  targetId: string;
  from: string;
  to: string;
}

/** Which fields a rename touches, and in which targets. */
export function renameScope(project: Project, change: RenameChange): { kinds: MenuKind[]; targetIds: string[] } {
  const all = allTargets(project).map((t) => t.id);
  switch (change.kind) {
    case 'costume':
      return change.targetId === project.stage.id ? { kinds: ['switchBackdrop', 'costume'], targetIds: all } : { kinds: ['costume'], targetIds: [change.targetId] };
    case 'sound':
      return { kinds: ['sound'], targetIds: [change.targetId] };
    case 'sprite':
      return { kinds: ['character'], targetIds: all };
    case 'variable':
      // A sprite's own variable is only used in that sprite; the stage id stands for "all sprites".
      return { kinds: ['variable'], targetIds: change.targetId === project.stage.id ? all : [change.targetId] };
  }
}

/**
 * Updates the blocks of every affected target after a rename (call it on a draft of the
 * project). For a stage costume (backdrop), only the stage's own costume menus change.
 */
export function applyRename(project: Project, change: RenameChange): void {
  if (!change.from || change.from === change.to) return;
  const { kinds, targetIds } = renameScope(project, change);
  for (const t of allTargets(project)) {
    if (!targetIds.includes(t.id) || !t.blocks) continue;
    const ownKinds = kinds.filter((k) => k !== 'costume' || t.id === change.targetId);
    renameInBlocks(t.blocks, ownKinds, change.from, change.to);
  }
}

/** Renames a variable's declaration. Returns the change to apply to blocks with `applyRename`. */
export function renameVariableDeclaration(project: Project, ownerId: string | null, from: string, to: string): RenameChange {
  const owner = project.sprites.find((s) => s.id === ownerId && s.variables?.includes(from));
  if (owner) owner.variables = owner.variables!.map((v) => (v === from ? to : v));
  else project.variables = globalVariables(project).map((v) => (v === from ? to : v));
  return { kind: 'variable', targetId: owner?.id ?? project.stage.id, from, to };
}

/** Removes a variable's declaration (the editor removes the blocks that use it). */
export function deleteVariableDeclaration(project: Project, ownerId: string | null, name: string): void {
  const owner = project.sprites.find((s) => s.id === ownerId && s.variables?.includes(name));
  if (owner) owner.variables = owner.variables!.filter((v) => v !== name);
  else project.variables = globalVariables(project).filter((v) => v !== name);
}
