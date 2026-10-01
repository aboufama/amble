import { BLOCK_BY_TYPE } from '../blocks/spec';
import { ambleCostumes, blankBackdrop, block, character, type JsonBlock } from './defaults';
import type { BlocksState, CostumeAsset, ImageAsset, Project, SpriteTarget, Target } from './types';

/**
 * Brings projects saved by older versions of Amble up to date. Every project that is loaded
 * (autosave, file, restore) goes through this.
 *
 * Projects made before Amble's own block language used Scratch-style blocks with free-text
 * inputs. Each becomes its closest new block: an exact one when its text reads clearly
 * ("move [10 steps]" -> move forward (10) steps), otherwise a block in the author's own words
 * ("glide [to the top over 1 second]" -> do [glide to the top] for (1) seconds). Nothing the
 * author wrote is lost.
 *
 * Projects made when Amble also made 3D games open as 2D ones (see `to2d`).
 */

type Old = JsonBlock & { x?: number; y?: number; icons?: unknown; enabled?: boolean; disabledReasons?: string[] };

const text = (b: Old, name: string) => String(b.fields?.[name] ?? '').trim();

/** The first number in some words ("10 steps" -> 10), if any. */
function firstNumber(words: string): number | null {
  const m = /-?\d+(?:\.\d+)?/.exec(words);
  return m ? Number(m[0]) : null;
}

/** Words that are just a number and a unit ("2 seconds", "10 times", "100%"). */
function plainNumber(words: string, units: RegExp): number | null {
  const m = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*(?:${units.source})?$`, 'i').exec(words.trim());
  return m ? Number(m[1]) : null;
}

const SECONDS = /s|secs?|seconds?/;
const TIMES = /times?|x/;
const STEPS = /steps?|px|pixels?/;

const doBlock = (words: string) => block('ga_do', { ACTION: words });
const words = (w: string) => block('cd_words', { TEXT: w });
const valueWords = (w: string) => block('nm_words', { TEXT: w });

/** A number slot from old words: the number, or the words when they aren't just a number. */
function numberArg(w: string, units: RegExp): number | JsonBlock {
  const n = plainNumber(w, units);
  return n !== null ? n : valueWords(w);
}

function characterFor(where: string): string | null {
  const w = where.trim().toLowerCase().replace(/^(towards?|to)\s+/, '');
  if (/^(a )?random( position| spot)?$/.test(w)) return 'random';
  if (/^(the )?mouse( pointer|-pointer)?$/.test(w)) return 'mouse';
  if (/^(the )?(center|centre|middle)( of the (screen|stage))?$/.test(w)) return 'center';
  return null;
}

const CONVERT: Record<string, (b: Old, sprites: Set<string>) => JsonBlock> = {
  mo_move: (b) => {
    const n = plainNumber(text(b, 'HOW'), STEPS);
    return n !== null ? block('mv_move', { DIR: 'forward', STEPS: n }) : doBlock(`move ${text(b, 'HOW')}`);
  },
  mo_turn: (b) => {
    const m = /^(right|left|clockwise|counter-?clockwise|anti-?clockwise)?\s*(-?\d+(?:\.\d+)?)\s*(?:degrees?|°)?$/i.exec(text(b, 'HOW'));
    if (!m) return doBlock(`turn ${text(b, 'HOW')}`);
    const left = /^(left|counter|anti)/i.test(m[1] ?? '');
    return block('mv_turn', { DIR: left ? 'left' : 'right', DEGREES: Number(m[2]) });
  },
  mo_goto: (b, sprites) => {
    const where = text(b, 'WHERE');
    const special = characterFor(where);
    if (special) return block('mv_goto', { WHO: special });
    const name = [...sprites].find((s) => s.toLowerCase() === where.toLowerCase().replace(/^(the )/, ''));
    return name ? block('mv_goto', { WHO: character(name) }) : doBlock(`go to ${where}`);
  },
  mo_glide: (b) => {
    const how = text(b, 'HOW');
    const m = /^(.*?)\s+(?:over|in|for)\s+(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)$/i.exec(how);
    return m ? block('ga_do_for', { ACTION: `glide ${m[1]}`, SECONDS: Number(m[2]) }) : doBlock(`glide ${how}`);
  },
  mo_point: (b, sprites) => {
    const where = text(b, 'WHERE');
    const special = characterFor(where);
    if (special === 'mouse' || special === 'center') return block('mv_point', { WHO: special });
    const target = where.replace(/^towards?\s+(the\s+)?/i, '');
    const name = [...sprites].find((s) => s.toLowerCase() === target.toLowerCase());
    return name ? block('mv_point', { WHO: character(name) }) : doBlock(`point ${where}`);
  },
  mo_control: (b) => {
    const how = text(b, 'CONTROLS');
    if (/^(the )?arrow keys$/i.test(how)) return block('kit_walk', { KEYS: 'arrow keys' });
    if (/^(the )?left and right arrow( key)?s$/i.test(how)) return block('kit_walk', { KEYS: 'left and right arrows' });
    if (/^wasd$/i.test(how)) return block('kit_walk', { KEYS: 'WASD' });
    return doBlock(`from now on, let the player control me with ${how}`);
  },
  mo_bounce: () => block('mv_bounce'),
  mo_rotation: (b) => doBlock(`set my rotation style to ${text(b, 'STYLE')}`),
  lo_say_for: (b) => {
    const n = plainNumber(text(b, 'TIME'), SECONDS);
    return n !== null ? block('lk_say_for', { TEXT: text(b, 'TEXT'), SECONDS: n }) : doBlock(`say "${text(b, 'TEXT')}" for ${text(b, 'TIME')}`);
  },
  lo_say: (b) => block('lk_say', { TEXT: text(b, 'TEXT') }),
  lo_animate: (b) => doBlock(`animate ${text(b, 'HOW')}`),
  lo_size: (b) => {
    const n = plainNumber(text(b, 'SIZE'), /%|percent/);
    return n !== null ? block('lk_size', { SIZE: n }) : doBlock(`set my size to ${text(b, 'SIZE')}`);
  },
  lo_effect_change: (b) => doBlock(`change the ${text(b, 'EFFECT')} effect by ${text(b, 'AMOUNT')}`),
  lo_effect_set: (b) => doBlock(`set the ${text(b, 'EFFECT')} effect to ${text(b, 'VALUE')}`),
  lo_effect_clear: () => doBlock('clear graphic effects'),
  lo_effect: (b) => doBlock(`effect: ${text(b, 'HOW')}`),
  so_music: (b) => doBlock(`play music: ${text(b, 'MUSIC')}`),
  ev_backdrop: (b) => block('ev_when', { COND: words(`the backdrop switches to ${text(b, 'BACKDROP')}`) }),
  co_wait: (b) => block('fl_wait', { SECONDS: numberArg(text(b, 'TIME'), SECONDS) }),
  co_repeat: (b) => block('fl_repeat', { TIMES: numberArg(text(b, 'TIMES'), TIMES) }),
  co_if: (b) => block('fl_if', { COND: words(text(b, 'CONDITION')) }),
  co_if_else: (b) => block('fl_if_else', { COND: words(text(b, 'CONDITION')) }),
  co_wait_until: (b) => block('fl_wait_until', { COND: words(text(b, 'CONDITION')) }),
  co_repeat_until: (b) => block('fl_repeat_until', { COND: words(text(b, 'CONDITION')) }),
  co_stop: (b) => {
    const what = text(b, 'WHAT');
    return what === 'this script' ? block('fl_stop') : doBlock(what === 'all' ? 'stop the whole game' : 'stop my other scripts');
  },
  co_clone_start: () => block('ev_created'),
  co_create_clone: (b) => {
    const what = text(b, 'WHAT');
    return block('cp_make', { WHO: !what || what === 'myself' ? 'me' : character(what) });
  },
  se_ask: (b) => block('mem_ask', { QUESTION: text(b, 'QUESTION') }),
  se_rule_touch: (b) => doBlock(`whenever I touch ${text(b, 'THING')}, ${text(b, 'ACTION')}`),
  va_set: (b) => block('mem_set', { VARIABLE: text(b, 'VARIABLE'), VALUE: text(b, 'VALUE') }),
  va_change: (b) => {
    const n = firstNumber(text(b, 'AMOUNT'));
    return block('mem_change', { VARIABLE: text(b, 'VARIABLE'), AMOUNT: n !== null && String(n) === text(b, 'AMOUNT') ? n : valueWords(text(b, 'AMOUNT')) });
  },
  wo_world: (b) => doBlock(`world: ${text(b, 'HOW')}`),
  wo_camera: (b) => block('ga_camera', { HOW: text(b, 'HOW') }),
  wo_build: (b) => doBlock(`build ${text(b, 'WHAT')}`),
};

/** An old block that needs converting (it no longer exists, or its inputs changed). */
function isOld(b: Old): boolean {
  if (b.type === 'ev_when') return b.fields?.EVENT !== undefined;
  return !BLOCK_BY_TYPE.has(b.type) && b.type in CONVERT;
}

function convert(b: Old, sprites: Set<string>): JsonBlock {
  const out: Old = isOld(b) ? (b.type === 'ev_when' ? block('ev_when', { COND: words(text(b, 'EVENT')) }) : CONVERT[b.type](b, sprites)) : { ...b, inputs: undefined, next: undefined };
  if (!isOld(b) && b.inputs) out.inputs = { ...b.inputs };
  if (b.id) out.id = b.id;
  if (b.x !== undefined) out.x = b.x;
  if (b.y !== undefined) out.y = b.y;
  if (b.icons) out.icons = b.icons;
  if (b.enabled === false) out.enabled = false;
  if (b.disabledReasons) out.disabledReasons = b.disabledReasons;
  // The blocks inside C-blocks and the blocks below come along (converted too).
  for (const slot of ['SUBSTACK', 'SUBSTACK2']) {
    const inner = b.inputs?.[slot]?.block as Old | undefined;
    if (inner) out.inputs = { ...out.inputs, [slot]: { block: convert(inner, sprites) } };
  }
  const next = b.next?.block as Old | undefined;
  if (next) out.next = { block: convert(next, sprites) };
  else delete out.next;
  if (out.inputs && !Object.keys(out.inputs).length) delete out.inputs;
  return out;
}

function hasOld(state: BlocksState | null | undefined): boolean {
  let found = false;
  const visit = (b: Old | undefined): void => {
    for (; b && !found; b = b.next?.block as Old | undefined) {
      if (isOld(b)) found = true;
      for (const slot of Object.values(b.inputs ?? {})) visit(slot.block as Old | undefined);
    }
  };
  for (const b of ((state?.blocks as { blocks?: Old[] } | undefined)?.blocks ?? []) as Old[]) visit(b);
  return found;
}

export function migrateBlocks(state: BlocksState | null | undefined, sprites: Set<string>): BlocksState | null {
  if (!state || !hasOld(state)) return state ?? null;
  const top = ((state.blocks as { blocks?: Old[] } | undefined)?.blocks ?? []) as Old[];
  return { ...state, blocks: { ...(state.blocks as object), blocks: top.map((b) => convert(b, sprites)) } };
}

const isModel = (asset: { kind: string }) => asset.kind === 'model';

/** A target without its 3D models, still showing its costume if that stays; one with no costume left gets `none()`. */
function withoutModels<T extends Target>(t: T, none: () => ImageAsset[]): T {
  const images = t.costumes.filter((c) => !isModel(c));
  const costumes: CostumeAsset[] = images.length ? images : none();
  return { ...t, costumes, currentCostume: Math.max(0, costumes.indexOf(t.costumes[t.currentCostume])) };
}

/**
 * Amble makes 2D games. A project saved as a 3D game opens as a 2D one: positions convert the way
 * the old 2D/3D switch converted them (60 pixels to a meter, and the depth z becomes the height y),
 * 3D models go, a sprite with no costume left gets Amble's (the stage, a blank backdrop), and a game
 * built for 3D builds again. 3D models and builds that the switch left in 2D projects go too.
 */
function to2d(project: Project): Project {
  const was3d = project.mode === '3d';
  const compiled = project.compiled?.mode === '2d' ? project.compiled : null;
  const assets = [...[project.stage, ...project.sprites].flatMap((t) => t.costumes), ...(compiled?.assets ?? [])];
  if (!was3d && compiled === project.compiled && !assets.some(isModel)) return project;
  return {
    ...project,
    mode: '2d',
    stage: withoutModels(project.stage, () => [blankBackdrop()]),
    sprites: project.sprites.map((s): SpriteTarget => {
      const sprite = withoutModels(s, ambleCostumes);
      return was3d ? { ...sprite, x: Math.round(s.x * 60), y: Math.round(s.z * 60), z: 0, direction: 0, rotationStyle: 'left-right' } : sprite;
    }),
    compiled: compiled && { ...compiled, assets: compiled.assets.filter((a) => !isModel(a)) },
  };
}

/** A sprite read from a file, which may come from a 3D project: without its 3D models. */
export function migrateSprite(sprite: SpriteTarget): SpriteTarget {
  return sprite.costumes.some(isModel) ? withoutModels(sprite, ambleCostumes) : sprite;
}

export function migrateProject(saved: Project): Project {
  const project = to2d(saved);
  const targets = [project.stage, ...project.sprites];
  if (!targets.some((t) => hasOld(t.blocks))) return project;
  const sprites = new Set(project.sprites.map((s) => s.name));
  return {
    ...project,
    stage: { ...project.stage, blocks: migrateBlocks(project.stage.blocks, sprites) },
    sprites: project.sprites.map((s) => ({ ...s, blocks: migrateBlocks(s.blocks, sprites) })),
  };
}
