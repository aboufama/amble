import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import { BLOCKS, CATEGORIES, blocksFor, labelFields, type BlockSpec } from './spec';
import { menuDefault, procedureNames, variablesFor, type MenuContext } from './menus';
import { FLAG_ICON, REPEAT_ICON } from './icons';
import { registerFields } from './fields';
import { registerComments } from './comments';
import { BLOCK_FONT_FAMILY, registerRenderer } from './renderer';
import { registerWorkspaceUi } from './workspaceUi';

/** Loops get Scratch's little arrow at the bottom right. */
const LOOPS = new Set(['co_repeat', 'co_forever', 'co_repeat_until']);

/** Blocks get a style per category; hats use the "cap" top and "define" the bowler hat. */
function styleFor(spec: BlockSpec): string {
  if (spec.type === 'pr_define') return 'myblocks_define';
  return spec.shape === 'hat' ? `${spec.category}_hat` : `${spec.category}_blocks`;
}

function blockJson(spec: BlockSpec): Record<string, unknown> {
  const args: unknown[] = [];
  const message = spec.label.replace(/\{([A-Z_]+)\}/g, (_, name: string) => {
    const menu = spec.menus?.[name];
    if (name === 'FLAG') {
      args.push({ type: 'field_image', src: FLAG_ICON, width: 24, height: 24, alt: 'green flag' });
    } else if (menu) {
      args.push({ type: 'field_amble_menu', name, menu: menu.kind, shape: menu.shape, value: spec.fields?.[name] ?? '' });
    } else {
      args.push({ type: 'field_amble_text', name, text: spec.fields?.[name] ?? '', spellcheck: true });
    }
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
    case 'rule':
      break;
  }
  if (LOOPS.has(spec.type)) {
    json.message2 = '%1';
    json.args2 = [{ type: 'field_image', src: REPEAT_ICON, width: 24, height: 24, alt: '*', flipRtl: true }];
    json.implicitAlign2 = 'RIGHT';
  }
  if (spec.type === 'co_stop') json.extensions = ['amble_stop_shape'];
  return json;
}

/**
 * Like Scratch, "stop [other scripts in sprite]" can have blocks under it; "stop [all]" and
 * "stop [this script]" end a script. The shape follows the value (also while loading).
 */
function stopShapeExtension(this: Blockly.Block) {
  const field = this.getField('WHAT');
  if (!field) return;
  const update = (value: unknown) => {
    const hasNext = /^other scripts/.test(String(value ?? ''));
    if (hasNext === Boolean(this.nextConnection)) return;
    if (!hasNext) {
      const next = this.nextConnection?.targetBlock();
      if (next) {
        next.unplug();
        if (next instanceof Blockly.BlockSvg) next.moveBy(0, 8);
      }
    }
    this.setNextStatement(hasNext, null);
  };
  field.setValidator((value: unknown) => {
    update(value);
    return undefined;
  });
  update(field.getValue());
}

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
  Blockly.Extensions.register('amble_stop_shape', stopShapeExtension);
  Blockly.common.defineBlocksWithJsonArray(BLOCKS.map(blockJson));
}

const blockStyles: Record<string, Partial<Blockly.Theme.BlockStyle>> = {};
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
    workspaceBackgroundColour: '#f9f9f9',
    toolboxBackgroundColour: '#ffffff',
    toolboxForegroundColour: '#575e75',
    flyoutBackgroundColour: '#f9f9f9',
    flyoutForegroundColour: '#575e75',
    flyoutOpacity: 0.8,
    scrollbarColour: '#cecdce',
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
export const MAKE_BLOCK = 'MAKE_BLOCK';

export interface PaletteContext {
  mode: '2d' | '3d';
  /** Editing the stage (Scratch shows no motion blocks and only stage blocks then). */
  isStage: boolean;
  /** The project and edited sprite, for dropdown defaults (the second costume, the last sound...). */
  menus: MenuContext | null;
}

/** Gap after a group of blocks, and between categories (Scratch's `<sep gap="36"/>`). */
const GROUP_GAP = 36;

function paletteBlock(spec: BlockSpec, ctx: PaletteContext): Blockly.utils.toolbox.BlockInfo {
  const fields: Record<string, string> = {};
  for (const [name, menu] of Object.entries(spec.menus ?? {})) {
    fields[name] = menuDefault(menu.kind, ctx.menus, spec.fields?.[name] ?? '');
  }
  const info: Blockly.utils.toolbox.BlockInfo = { kind: 'block', type: spec.type };
  if (Object.keys(fields).length) info.fields = fields;
  if (spec.groupEnd) info.gap = GROUP_GAP;
  return info;
}

/** The block palette for a world mode and the sprite or stage being edited, like Scratch's. */
export function toolboxFor(ctx: PaletteContext): Blockly.utils.toolbox.ToolboxInfo {
  const available = blocksFor(ctx.mode, ctx.isStage ? 'stage' : 'sprite').filter((b) => !b.hidden);
  const hasVariables = ctx.menus ? variablesFor(ctx.menus.project, ctx.menus.target).length > 0 : false;
  const hasProcedures = ctx.menus ? procedureNames(ctx.menus).length > 0 : false;
  return {
    kind: 'categoryToolbox',
    contents: CATEGORIES.filter((c) => !c.modes || c.modes.includes(ctx.mode)).map((c) => {
      const contents: Blockly.utils.toolbox.FlyoutItemInfoArray = [];
      if (c.id === 'motion' && ctx.isStage) contents.push({ kind: 'label', text: 'Stage selected: no motion blocks' });
      if (c.id === 'variables') contents.push({ kind: 'button', text: 'Make a Variable', callbackkey: MAKE_VARIABLE });
      if (c.id === 'myblocks') contents.push({ kind: 'button', text: 'Make a Block', callbackkey: MAKE_BLOCK });
      const blocks = available.filter((b) => b.category === c.id);
      const show = (c.id !== 'variables' || hasVariables) && (c.id !== 'myblocks' || hasProcedures);
      if (show) for (const b of blocks) contents.push(paletteBlock(b, ctx));
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

export { Blockly, labelFields };
