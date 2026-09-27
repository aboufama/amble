import * as Blockly from 'blockly/core';
import { FieldMultilineInput } from '@blockly/field-multilineinput';
import type { MenuKind } from './spec';
import { DELETE_VARIABLE, NEW_MESSAGE, RENAME_VARIABLE, isActionValue, menuOptions, type MenuContext } from './menus';

// -----------------------------------------------------------------------------
// The editor's hooks for menus that need the project or a dialog
// -----------------------------------------------------------------------------

export interface MenuHost {
  /** The project and the sprite being edited. */
  context(): MenuContext | null;
  /** Asks for a new message name ("New message"). */
  newMessage(): Promise<string | null>;
  renameVariable(name: string): void;
  deleteVariable(name: string): void;
}

let host: MenuHost | null = null;

export function setMenuHost(next: MenuHost | null): void {
  host = next;
}

// -----------------------------------------------------------------------------
// Word wrapping
// -----------------------------------------------------------------------------

/**
 * Word-wraps text so that no line is wider than `maxWidth`, breaking long words.
 * `measure` returns the width of a piece of text. Explicit newlines are kept.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

let measureCtx: CanvasRenderingContext2D | null = null;

function measureWith(font: string): (s: string) => number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  return (s) => {
    if (!ctx) return s.length * 8;
    ctx.font = font;
    return ctx.measureText(s).width;
  };
}

// -----------------------------------------------------------------------------
// Free text: a white oval like Scratch's number and text inputs, taller when it wraps
// -----------------------------------------------------------------------------

/** Height of a one-line input, like Scratch's white ovals. */
const OVAL_HEIGHT = 32;
/** Space left and right of the text. */
const OVAL_PADDING_X = 11;
const OVAL_MIN_WIDTH = 40;
/** Vertical distance between wrapped lines. */
const LINE_HEIGHT = 19;
/** Longest line before the text wraps. */
export const TEXT_WRAP_WIDTH = 210;

/** Free-text input used by most blocks. Enter commits, Shift+Enter adds a line. */
export class FieldAmbleText extends FieldMultilineInput {
  static override fromJson(options: Blockly.FieldConfig & { text?: string }): FieldAmbleText {
    return new FieldAmbleText(options.text ?? '', undefined, options as never);
  }

  private lines: string[] = [];

  private font(): string {
    const c = this.getConstants()!;
    return `${c.FIELD_TEXT_FONTWEIGHT} ${c.FIELD_TEXT_FONTSIZE}pt ${c.FIELD_TEXT_FONTFAMILY}`;
  }

  private wrappedLines(): string[] {
    const text = this.getText();
    if (!text.trim()) return [''];
    return wrapText(text, TEXT_WRAP_WIDTH, measureWith(this.font()));
  }

  override initView() {
    super.initView();
    this.borderRect_?.classList.add('ambleTextRect');
  }

  protected override getDisplayText_(): string {
    return this.wrappedLines()
      .map((l) => l.replace(/\s/g, Blockly.Field.NBSP) || Blockly.Field.NBSP)
      .join('\n');
  }

  protected override render_() {
    const group = this.textGroup as SVGGElement;
    while (group.firstChild) group.removeChild(group.firstChild);
    const c = this.getConstants()!;
    this.lines = this.getDisplayText_().split('\n');
    const top = (OVAL_HEIGHT - c.FIELD_TEXT_HEIGHT) / 2;
    this.lines.forEach((line, i) => {
      const text = Blockly.utils.dom.createSvgElement(
        Blockly.utils.Svg.TEXT,
        { class: 'blocklyText blocklyMultilineText', x: OVAL_PADDING_X, y: top + i * LINE_HEIGHT + c.FIELD_TEXT_HEIGHT / 2, 'dominant-baseline': 'central' },
        group,
      );
      text.appendChild(document.createTextNode(line));
    });
    this.updateSize_();
    if (this.isBeingEdited_ && this.htmlInput_) {
      this.htmlInput_.style.textAlign = this.lines.length > 1 ? 'left' : 'center';
      this.resizeEditor_();
    }
  }

  protected override updateSize_() {
    const texts = [...(this.textGroup as SVGGElement).childNodes] as SVGTextElement[];
    const widths = texts.map((t) => Blockly.utils.dom.getTextWidth(t));
    const textWidth = Math.max(0, ...widths);
    let width = Math.max(OVAL_MIN_WIDTH, textWidth + 2 * OVAL_PADDING_X);
    if (this.isBeingEdited_ && texts.length > 1) width = Math.max(width, TEXT_WRAP_WIDTH + 2 * OVAL_PADDING_X + 2);
    const height = OVAL_HEIGHT + (texts.length - 1) * LINE_HEIGHT;
    // One line is centered (like Scratch); wrapped text is left-aligned.
    texts.forEach((t, i) => t.setAttribute('x', String(texts.length === 1 ? (width - widths[i]) / 2 : OVAL_PADDING_X)));
    this.size_.width = width;
    this.size_.height = height;
    this.positionBorderRect_();
  }

  protected override positionBorderRect_() {
    if (!this.borderRect_) return;
    this.borderRect_.setAttribute('width', String(this.size_.width));
    this.borderRect_.setAttribute('height', String(this.size_.height));
    this.borderRect_.setAttribute('rx', String(OVAL_HEIGHT / 2));
    this.borderRect_.setAttribute('ry', String(OVAL_HEIGHT / 2));
  }

  override applyColour() {
    const block = this.getSourceBlock() as Blockly.BlockSvg | null;
    if (!block || !this.borderRect_) return;
    this.borderRect_.style.display = 'block';
    this.borderRect_.setAttribute('fill', '#ffffff');
    this.borderRect_.setAttribute('stroke', block.getColourTertiary());
  }

  protected override widgetCreate_(): HTMLTextAreaElement {
    const block = this.getSourceBlock() as Blockly.BlockSvg;
    Blockly.Events.setGroup(true);
    const div = Blockly.WidgetDiv.getDiv()!;
    this.getClickTarget_()?.classList.add('blocklyEditing');
    const scale = (this.workspace_ as Blockly.WorkspaceSvg).getScale();
    const c = this.getConstants()!;
    const input = document.createElement('textarea');
    input.className = 'blocklyHtmlInput blocklyHtmlTextAreaInput ambleTextInput';
    input.setAttribute('spellcheck', String(this.spellcheck_));
    const fontSize = `${c.FIELD_TEXT_FONTSIZE * scale}pt`;
    div.style.fontSize = fontSize;
    input.style.fontSize = fontSize;
    input.style.lineHeight = `${LINE_HEIGHT * scale}px`;
    input.style.padding = `${((OVAL_HEIGHT - LINE_HEIGHT) / 2 - 1) * scale}px ${(OVAL_PADDING_X - 1) * scale}px 0`;
    input.style.borderRadius = `${(OVAL_HEIGHT / 2) * scale}px`;
    input.style.border = `${scale}px solid ${block.getColourTertiary()}`;
    input.style.boxShadow = `rgba(255, 255, 255, 0.3) 0 0 0 ${4 * scale}px`;
    input.style.textAlign = this.lines.length > 1 ? 'left' : 'center';
    div.appendChild(input);
    input.value = input.defaultValue = this.getEditorText_(this.value_);
    input.setAttribute('data-untyped-default-value', String(this.value_));
    input.setAttribute('data-old-value', '');
    this.resizeEditor_();
    this.bindInputEvents_(input);
    return input;
  }
}

// -----------------------------------------------------------------------------
// Dropdown menus
// -----------------------------------------------------------------------------

interface MenuFieldConfig extends Blockly.FieldConfig {
  menu: MenuKind;
  shape?: 'round' | 'square';
  value?: string;
}

/** Height and side padding of round menus (Scratch's reporter-shaped menus). */
const ROUND_HEIGHT = 32;
const ROUND_PADDING_X = 12;

/**
 * A dropdown whose options come from the project (costumes, sounds, sprites, messages,
 * variables...) or a fixed list. Like Scratch's, it keeps a saved value that is not an
 * option (for example a costume that was deleted) instead of replacing it.
 */
export class FieldAmbleMenu extends Blockly.FieldDropdown {
  readonly menuKind: MenuKind;
  readonly menuShape: 'round' | 'square';

  static override fromJson(options: MenuFieldConfig): FieldAmbleMenu {
    return new FieldAmbleMenu(options.menu, options.shape ?? 'square', options.value ?? '', options);
  }

  constructor(kind: MenuKind, shape: 'round' | 'square', value: string, config?: Blockly.FieldConfig) {
    super(Blockly.Field.SKIP_SETUP);
    this.menuKind = kind;
    this.menuShape = shape;
    this.menuGenerator_ = () => menuOptions(this.menuKind, host?.context() ?? null, String(this.getValue() ?? '')) as Blockly.MenuOption[];
    if (config) this.configure_(config);
    this.setValue(value);
  }

  protected override doClassValidation_(newValue?: string): string | null {
    return typeof newValue === 'string' && !isActionValue(newValue) ? newValue : null;
  }

  protected override getText_(): string | null {
    const value = String(this.getValue() ?? '');
    for (const option of this.getOptions(true)) {
      if (option !== Blockly.FieldDropdown.SEPARATOR && option[1] === value && typeof option[0] === 'string') return option[0];
    }
    return value;
  }

  protected override onItemSelected_(menu: Blockly.Menu, menuItem: Blockly.MenuItem) {
    const value = menuItem.getValue() as string;
    const current = String(this.getValue() ?? '');
    if (value === NEW_MESSAGE) {
      void host?.newMessage().then((name) => {
        if (name && this.getSourceBlock() && !this.getSourceBlock()!.isDeadOrDying()) this.setValue(name);
      });
    } else if (value === RENAME_VARIABLE) {
      host?.renameVariable(current);
    } else if (value === DELETE_VARIABLE) {
      host?.deleteVariable(current);
    } else {
      super.onItemSelected_(menu, menuItem);
    }
  }

  protected override render_() {
    super.render_();
    if (this.menuShape !== 'round' || !this.borderRect_) return;
    // Scratch draws these menus as reporter-shaped ovals: a little taller and roomier.
    const c = this.getConstants()!;
    const text = this.getTextElement();
    const textWidth = Blockly.utils.dom.getTextWidth(text);
    const arrow = (this as unknown as { svgArrow?: SVGElement | null }).svgArrow;
    const arrowSpace = arrow ? c.FIELD_DROPDOWN_SVG_ARROW_PADDING + c.FIELD_DROPDOWN_SVG_ARROW_SIZE : 0;
    this.size_ = new Blockly.utils.Size(ROUND_PADDING_X * 2 + textWidth + arrowSpace, ROUND_HEIGHT);
    this.positionTextElement_(ROUND_PADDING_X, textWidth);
    arrow?.setAttribute(
      'transform',
      `translate(${ROUND_PADDING_X + textWidth + c.FIELD_DROPDOWN_SVG_ARROW_PADDING},${(ROUND_HEIGHT - c.FIELD_DROPDOWN_SVG_ARROW_SIZE) / 2})`,
    );
    this.positionBorderRect_();
  }

  protected override positionBorderRect_() {
    super.positionBorderRect_();
    if (this.menuShape === 'round' && this.borderRect_) {
      this.borderRect_.setAttribute('rx', String(this.size_.height / 2));
      this.borderRect_.setAttribute('ry', String(this.size_.height / 2));
    }
  }

  override applyColour() {
    super.applyColour();
    const block = this.getSourceBlock() as Blockly.BlockSvg | null;
    if (!block || !this.borderRect_) return;
    this.borderRect_.classList.toggle('ambleRoundMenu', this.menuShape === 'round');
    if (this.menuShape === 'round') {
      // Scratch's menus are a darker shade of the block, darker still while open.
      this.borderRect_.setAttribute('fill', this.menu_ ? block.getColourTertiary() : block.getColourSecondary());
    }
  }
}

let registered = false;

export function registerFields(): void {
  if (registered) return;
  registered = true;
  FieldMultilineInput.showHint = false;
  Blockly.fieldRegistry.register('field_amble_text', FieldAmbleText);
  Blockly.fieldRegistry.register('field_amble_menu', FieldAmbleMenu);
}
