import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import { FieldMultilineInput } from '@blockly/field-multilineinput';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { BLOCKS, CATEGORIES, blocksForMode, labelFields, type BlockSpec } from './spec';

const FLAG_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 3v18" stroke="#45993d" stroke-width="2.4" stroke-linecap="round"/><path d="M6 4c4-2 7 2 12 0v9c-5 2-8-2-12 0z" fill="#4cbf56" stroke="#45993d" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  );

/** Word-wraps text for display so long sentences make a block taller, not endlessly wide. */
export function wrapText(text: string, width = 30): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Free-text input used by every block. Enter commits, Shift+Enter adds a line. */
export class FieldAmbleText extends FieldMultilineInput {
  static override fromJson(options: Blockly.FieldConfig & { text?: string }): FieldAmbleText {
    return new FieldAmbleText(options.text ?? '', undefined, options as never);
  }

  protected override getDisplayText_(): string {
    const text = this.getText();
    if (!text) return Blockly.Field.NBSP;
    return wrapText(text)
      .map((l) => l.replace(/\s/g, Blockly.Field.NBSP) || Blockly.Field.NBSP)
      .join('\n');
  }
}

let registered = false;

function blockJson(spec: BlockSpec): Record<string, unknown> {
  const category = CATEGORIES.find((c) => c.id === spec.category)!;
  const args: unknown[] = [];
  const message = spec.label.replace(/\{([A-Z_]+)\}/g, (_, name: string) => {
    if (name === 'FLAG') {
      args.push({ type: 'field_image', src: FLAG_ICON, width: 24, height: 24, alt: 'green flag' });
    } else {
      args.push({ type: 'field_amble_text', name, text: spec.fields?.[name] ?? '', spellcheck: true });
    }
    return `%${args.length}`;
  });
  const json: Record<string, unknown> = {
    type: spec.type,
    message0: message,
    args0: args,
    style: `${category.id}_blocks`,
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
  return json;
}

/** Registers the theme, the text field, the continuous toolbox and every Amble block (once). */
export function registerBlockly(): void {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);
  FieldMultilineInput.showHint = false;
  Blockly.fieldRegistry.register('field_amble_text', FieldAmbleText);
  registerContinuousToolbox();
  Blockly.common.defineBlocksWithJsonArray(BLOCKS.map(blockJson));
}

export const AMBLE_THEME = Blockly.Theme.defineTheme('amble', {
  name: 'amble',
  base: Blockly.Themes.Zelos,
  startHats: true,
  blockStyles: Object.fromEntries(
    CATEGORIES.map((c) => [`${c.id}_blocks`, { colourPrimary: c.colour, colourSecondary: c.secondary, colourTertiary: c.tertiary, hat: '' }]),
  ),
  categoryStyles: Object.fromEntries(CATEGORIES.map((c) => [`${c.id}_category`, { colour: c.colour }])),
  componentStyles: {
    workspaceBackgroundColour: '#f9f9fb',
    toolboxBackgroundColour: '#ffffff',
    toolboxForegroundColour: '#575e75',
    flyoutBackgroundColour: '#f2f3f7',
    flyoutForegroundColour: '#575e75',
    flyoutOpacity: 1,
    scrollbarColour: '#cecdce',
    insertionMarkerColour: '#000000',
    insertionMarkerOpacity: 0.2,
  },
  fontStyle: { family: '"Helvetica Neue", Helvetica, Arial, sans-serif', weight: '600', size: 11 },
});

/** The block palette for a world mode. */
export function toolboxFor(mode: '2d' | '3d'): Blockly.utils.toolbox.ToolboxDefinition {
  const available = blocksForMode(mode);
  return {
    kind: 'categoryToolbox',
    contents: CATEGORIES.filter((c) => !c.modes || c.modes.includes(mode))
      .map((c) => ({
        kind: 'category',
        name: c.name,
        categorystyle: `${c.id}_category`,
        contents: available.filter((b) => b.category === c.id).map((b) => ({ kind: 'block', type: b.type })),
      }))
      .filter((c) => c.contents.length > 0),
  };
}

export { Blockly, labelFields };
