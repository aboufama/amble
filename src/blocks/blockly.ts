import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import {
  BLOCKS,
  CATEGORIES,
  CHARACTER_SPECIAL_LABELS,
  SHADOW_TYPES,
  blocksFor,
  labelInputs,
  type BlockSpec,
  type CharacterSpecial,
  type InputSpec,
  type MenuKind,
  type OutputKind,
} from './spec';
import { menuDefault, procedureNames, variablesFor, type MenuContext } from './menus';
import { FLAG_ICON, REPEAT_ICON } from './icons';
import { registerFields } from './fields';
import { registerComments } from './comments';
import { BLOCK_FONT_FAMILY, BLOCK_TEXT_COLOUR, registerRenderer } from './renderer';
import { registerWorkspaceUi } from './workspaceUi';

/** Loops get Scratch's little arrow at the bottom right. */
const LOOPS = new Set(['fl_repeat', 'co_forever', 'fl_repeat_until']);

/** Menus drawn as ovals (a choice of a thing) rather than square fields (a setting). */
const ROUND_MENUS: ReadonlySet<MenuKind> = new Set(['costume', 'switchBackdrop', 'sound', 'message', 'character']);

/** What reporters give, and what slots take: numbers and words mix; characters and conditions don't. */
const OUTPUT_CHECK: Record<OutputKind, string> = { number: 'Number', value: 'Value', character: 'Character' };
const SLOT_CHECK: Partial<Record<InputSpec['kind'], string[]>> = {
  number: ['Number', 'Value', 'Boolean'],
  value: ['Number', 'Value', 'Boolean'],
  character: ['Character'],
  condition: ['Boolean'],
};

/** zelos output shapes. */
const HEXAGONAL = 1;
const ROUND = 2;

/** Blocks get a style per category; hats use the "cap" top and skills the bowler hat. */
function styleFor(spec: BlockSpec): string {
  if (spec.type === 'pr_define') return 'myblocks_define';
  return spec.shape === 'hat' ? `${spec.category}_hat` : `${spec.category}_blocks`;
}

function fieldFor(spec: BlockSpec, name: string, input: InputSpec): Record<string, unknown> {
  switch (input.kind) {
    case 'text':
      return { type: 'field_amble_text', name, text: input.default ?? '', spellcheck: true };
    case 'label':
      return spec.type === 'char_ref' ? { type: 'field_amble_character', name, text: input.default ?? '' } : { type: 'field_label_serializable', name, text: input.default ?? '' };
    case 'menu':
      return { type: 'field_amble_menu', name, menu: input.menu, shape: ROUND_MENUS.has(input.menu!) ? 'round' : 'square', value: input.default ?? '' };
    default:
      return { type: 'input_value', name, check: SLOT_CHECK[input.kind] };
  }
}

function blockJson(spec: BlockSpec): Record<string, unknown> {
  const args: unknown[] = [];
  const message = spec.label.replace(/\{([A-Z_]+)\}/g, (_, name: string) => {
    if (name === 'FLAG') args.push({ type: 'field_image', src: FLAG_ICON, width: 24, height: 24, alt: 'green flag' });
    else args.push(fieldFor(spec, name, spec.inputs![name]));
    return `%${args.length}`;
  });
  const json: Record<string, unknown> = {
    type: spec.type,
    message0: message,
    args0: args,
    style: styleFor(spec),
    tooltip: spec.tooltip,
    inputsInline: true,
  };
  switch (spec.shape) {
    case 'hat':
      json.nextStatement = null;
      break;
    case 'stack':
      json.previousStatement = null;
      json.nextStatement = null;
      break;
    case 'cap':
      json.previousStatement = null;
      break;
    case 'c':
    case 'c-end':
      json.message1 = '%1';
      json.args1 = [{ type: 'input_statement', name: 'SUBSTACK' }];
      json.previousStatement = null;
      if (spec.shape === 'c') json.nextStatement = null;
      break;
    case 'e':
      json.message1 = '%1';
      json.args1 = [{ type: 'input_statement', name: 'SUBSTACK' }];
      json.message2 = spec.elseLabel ?? 'else';
      json.message3 = '%1';
      json.args3 = [{ type: 'input_statement', name: 'SUBSTACK2' }];
      json.previousStatement = null;
      json.nextStatement = null;
      break;
    case 'reporter':
      json.output = OUTPUT_CHECK[spec.output ?? 'value'];
      json.outputShape = ROUND;
      break;
    case 'boolean':
      json.output = 'Boolean';
      json.outputShape = HEXAGONAL;
      break;
    case 'rule':
      break;
  }
  if (LOOPS.has(spec.type)) {
    json.message2 = '%1';
    json.args2 = [{ type: 'field_image', src: REPEAT_ICON, width: 24, height: 24, alt: '*', flipRtl: true }];
    json.implicitAlign2 = 'RIGHT';
  }
  return json;
}

/** The white ovals that fill number and word slots until a block is dropped in. */
const SHADOW_BLOCKS = [
  { type: SHADOW_TYPES.number, message0: '%1', args0: [{ type: 'field_number', name: 'NUM', value: 0 }], output: 'Number', outputShape: ROUND, style: 'shadow_blocks' },
  { type: SHADOW_TYPES.value, message0: '%1', args0: [{ type: 'field_input', name: 'TEXT', text: '' }], output: 'Value', outputShape: ROUND, style: 'shadow_blocks' },
];

let registered = false;

/** Registers the renderer, fields, palette, menus and every Amble block (once). */
export function registerBlockly(): void {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);
  registerRenderer();
  registerFields();
  registerWorkspaceUi();
  registerComments();
  Blockly.common.defineBlocksWithJsonArray([...SHADOW_BLOCKS, ...BLOCKS.map(blockJson)]);
}

const blockStyles: Record<string, Partial<Blockly.Theme.BlockStyle>> = {
  // Typed-in numbers and words: white ovals (zelos fills a shadow with its secondary colour).
  shadow_blocks: { colourPrimary: '#ffffff', colourSecondary: '#ffffff', colourTertiary: '#c8c5cc', hat: '' },
};
for (const c of CATEGORIES) {
  const colours = { colourPrimary: c.colour, colourSecondary: c.secondary, colourTertiary: c.tertiary };
  blockStyles[`${c.id}_blocks`] = { ...colours, hat: '' };
  blockStyles[`${c.id}_hat`] = { ...colours, hat: 'cap' };
  if (c.id === 'myblocks') blockStyles.myblocks_define = { ...colours, hat: 'bowler' };
}

export const AMBLE_THEME = Blockly.Theme.defineTheme('amble', {
  name: 'amble',
  base: Blockly.Themes.Classic,
  startHats: false,
  blockStyles,
  categoryStyles: Object.fromEntries(CATEGORIES.map((c) => [`${c.id}_category`, { colour: c.colour }])),
  componentStyles: {
    // Scratch's greys with Amble's lilac tint.
    workspaceBackgroundColour: '#fbf8ff',
    toolboxBackgroundColour: '#ffffff',
    toolboxForegroundColour: BLOCK_TEXT_COLOUR,
    flyoutBackgroundColour: '#fbf8ff',
    flyoutForegroundColour: BLOCK_TEXT_COLOUR,
    flyoutOpacity: 0.8,
    scrollbarColour: '#d0ccd4',
    scrollbarOpacity: 1,
    insertionMarkerColour: '#000000',
    insertionMarkerOpacity: 0.2,
  },
  fontStyle: { family: BLOCK_FONT_FAMILY, weight: '500', size: 12 },
});

// -----------------------------------------------------------------------------
// The palette
// -----------------------------------------------------------------------------

export const MAKE_VARIABLE = 'MAKE_VARIABLE';
export const MAKE_SKILL = 'MAKE_SKILL';

export interface PaletteContext {
  /** Editing the stage (it has no motion blocks, and only stage blocks). */
  isStage: boolean;
  /** The project and edited sprite, for menu defaults and the character and variable blocks. */
  menus: MenuContext | null;
}

/** Gap after a group of blocks, and between categories (Scratch's `<sep gap="36"/>`). */
const GROUP_GAP = 36;

type BlockInfo = Blockly.utils.toolbox.BlockInfo;
type Inputs = NonNullable<BlockInfo['inputs']>;

/** A block for the palette with its inputs filled in (typed values as shadows, like Scratch). */
export function paletteBlock(spec: BlockSpec, ctx: PaletteContext, values: Record<string, string> = {}): BlockInfo {
  const fields: Record<string, string> = {};
  const inputs: Inputs = {};
  for (const [name, input] of Object.entries(spec.inputs ?? {})) {
    const given = values[name];
    switch (input.kind) {
      case 'text':
      case 'label':
        fields[name] = given ?? input.default ?? '';
        break;
      case 'menu':
        fields[name] = given ?? menuDefault(input.menu!, ctx.menus, input.default ?? '');
        break;
      case 'number':
        inputs[name] = { shadow: { type: SHADOW_TYPES.number, fields: { NUM: Number(given ?? input.default ?? 0) } } };
        break;
      case 'value':
        inputs[name] = { shadow: { type: SHADOW_TYPES.value, fields: { TEXT: given ?? input.default ?? '' } } };
        break;
      case 'character': {
        // The stage isn't a character: its blocks start with the first sprite instead of "me".
        let who = given ?? input.default ?? 'me';
        if (who === 'me' && ctx.isStage) who = ctx.menus?.project.sprites[0]?.name ?? who;
        inputs[name] = { shadow: { type: SHADOW_TYPES.character, fields: { NAME: who } } };
        break;
      }
      case 'condition':
        break;
    }
  }
  const info: BlockInfo = { kind: 'block', type: spec.type };
  if (Object.keys(fields).length) info.fields = fields;
  if (Object.keys(inputs).length) info.inputs = inputs;
  if (spec.groupEnd) info.gap = GROUP_GAP;
  return info;
}

const CHARACTER_SPECIALS: CharacterSpecial[] = ['me', 'mouse', 'random', 'center', 'edge', 'anyone'];

/** Characters: one block per sprite (with its picture), then the special ones. */
function characterBlocks(ctx: PaletteContext): Blockly.utils.toolbox.FlyoutItemInfoArray {
  const project = ctx.menus?.project;
  const names = [...(project?.sprites ?? []).map((s) => s.name), ...(project?.compiled?.sprites ?? []).filter((s) => !project?.sprites.some((u) => u.name === s.name)).map((s) => s.name)];
  const items: Blockly.utils.toolbox.FlyoutItemInfoArray = names.map((name) => ({ kind: 'block', type: 'char_ref', fields: { NAME: name } }));
  if (items.length) (items[items.length - 1] as BlockInfo).gap = GROUP_GAP;
  const specials = CHARACTER_SPECIALS.filter((s) => !(ctx.isStage && s === 'me'));
  specials.forEach((s, i) => items.push({ kind: 'block', type: 'char_ref', fields: { NAME: s }, ...(i === specials.length - 1 ? { gap: GROUP_GAP } : {}) }));
  return items;
}

/** The block palette for the sprite or stage being edited. */
export function toolboxFor(ctx: PaletteContext): Blockly.utils.toolbox.ToolboxInfo {
  const available = blocksFor(ctx.isStage ? 'stage' : 'sprite').filter((b) => !b.hidden);
  const variables = ctx.menus ? variablesFor(ctx.menus.project, ctx.menus.target) : [];
  const skills = ctx.menus ? procedureNames(ctx.menus) : [];
  return {
    kind: 'categoryToolbox',
    // The brief (game, made for, art style, win and lose) is the Stage's; the Stage doesn't move.
    contents: CATEGORIES.filter((c) => !(c.id === 'brief' && !ctx.isStage) && !(c.id === 'motion' && ctx.isStage)).map((c) => {
      const contents: Blockly.utils.toolbox.FlyoutItemInfoArray = [];
      const blocks = available.filter((b) => b.category === c.id);
      switch (c.id) {
        case 'characters':
          contents.push(...characterBlocks(ctx));
          for (const b of blocks) contents.push(paletteBlock(b, ctx));
          break;
        case 'variables':
          contents.push({ kind: 'button', text: 'Make a Variable', callbackkey: MAKE_VARIABLE });
          variables.forEach((v, i) => contents.push({ kind: 'block', type: 'mem_var', fields: { VARIABLE: v }, ...(i === variables.length - 1 ? { gap: GROUP_GAP } : {}) }));
          // Like Scratch, "set" and "change" appear once there is a variable.
          for (const b of blocks) if (variables.length || !['mem_set', 'mem_change', 'va_show'].includes(b.type)) contents.push(paletteBlock(b, ctx));
          break;
        case 'myblocks':
          contents.push({ kind: 'button', text: 'Make a Skill', callbackkey: MAKE_SKILL });
          for (const name of skills) contents.push(paletteBlock(blocks.find((b) => b.type === 'pr_call')!, ctx, { NAME: name }));
          break;
        default:
          for (const b of blocks) contents.push(paletteBlock(b, ctx));
      }
      contents.push({ kind: 'sep', gap: GROUP_GAP });
      return {
        kind: 'category',
        name: c.name,
        categorystyle: `${c.id}_category`,
        borderColour: c.tertiary,
        contents,
      } as unknown as Blockly.utils.toolbox.CategoryInfo;
    }),
  };
}

/** How a character is written on blocks and in menus ("the mouse", "Fox"). */
export function characterLabel(name: string): string {
  return (CHARACTER_SPECIAL_LABELS as Record<string, string>)[name] ?? name;
}

export { Blockly, labelInputs };
