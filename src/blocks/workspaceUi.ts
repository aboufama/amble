import * as Blockly from 'blockly/core';
import { ContinuousCategory, ContinuousFlyout, ContinuousToolbox, registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { ZOOM_IN_ICON, ZOOM_OUT_ICON, ZOOM_RESET_ICON, categoryMarker } from './icons';
import { BLOCK_FONT_FAMILY, BLOCK_TEXT_COLOUR } from './renderer';
import { fitBoard, type BoardSection } from './board';

/** Width of the block palette when it lists every block by category, like Scratch's. */
export const FLYOUT_WIDTH = 250;
/** Scratch draws blocks at 0.675 (the full palette always, the code area until you zoom). */
export const BLOCK_SCALE = 0.675;

/**
 * The simple palette is a board: every block on screen at once, in titled cards (see board.ts).
 * It takes a share of the editor's width, and its blocks are drawn as large as fits, from their
 * normal size down to the smallest that still reads (after that, the board scrolls).
 */
const BOARD_SHARE = 0.54;
const BOARD_MIN_WIDTH = 340;
const BOARD_MAX_WIDTH = 470;
const BOARD_SCALES = { max: BLOCK_SCALE, min: 0.5, step: 0.005 };
/** Card headings: the group's marker, then its name (pixels). */
const HEADING_ICON = 15;
const HEADING_ICON_GAP = 6;
const HEADING_FONT = `bold 12.5px ${BLOCK_FONT_FAMILY}`;
const NOTE_FONT = `11px ${BLOCK_FONT_FAMILY}`;
const NOTE_GAP = 8;
const CARD_RADIUS = 9;

/** The strip under the palette with the switch between the two palettes, always in view. */
const FOOTER_HEIGHT = 34;
/** The key of the workspace's button callback that switches palettes ("More blocks" / "Fewer blocks"). */
export const TOGGLE_PALETTE = 'TOGGLE_PALETTE';

/** What a palette definition says beyond Blockly's own: how it is laid out. */
export type PaletteInfo = Blockly.utils.toolbox.ToolboxInfo & {
  /** 'board': the simple palette, every block at once. Otherwise a category column and one long list. */
  layout?: 'board';
};

/** What a palette definition says about a category beyond Blockly's own. */
export interface PaletteCategoryInfo {
  categorystyle?: string;
  /** The deeper shade of the category's colour. */
  borderColour?: string;
  /** On the board: a few quiet words after the heading (where the card is wide enough), and what shows when the pointer rests on it. */
  note?: string;
  hint?: string;
  /** On the board: the column the category's card stands in (0 is the left one), or null for a card across the top. */
  column?: number | null;
  /** On the board: block types that share a row when there is room (each list starts a row). */
  rows?: string[][];
}

let measureCtx: CanvasRenderingContext2D | null = null;

function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// -----------------------------------------------------------------------------
// Category column: a squircle of the category's colour with its own glyph, and the label under it
// -----------------------------------------------------------------------------

class AmbleCategory extends ContinuousCategory {
  /** What the palette's definition says about this category. */
  info(): PaletteCategoryInfo {
    return this.toolboxItemDef_ as PaletteCategoryInfo;
  }

  /** The category's marker (SVG markup, 20 x 20): its colour, with its own glyph. */
  marker(): string {
    const def = this.info();
    const id = (def.categorystyle ?? '').replace(/_category$/, '');
    return categoryMarker(id, this.colour_, def.borderColour ?? this.colour_);
  }

  override createIconDom_(): Element {
    const icon = document.createElement('div');
    icon.classList.add('categoryBubble');
    icon.innerHTML = this.marker();
    return icon;
  }

  override setSelected(isSelected: boolean) {
    super.setSelected(isSelected);
    // The selected row is styled in CSS (Scratch's light gray), not with an inline color.
    if (this.rowDiv_) this.rowDiv_.style.backgroundColor = '';
  }
}

// -----------------------------------------------------------------------------
// Adding a block with a click
// -----------------------------------------------------------------------------

/** Where a block added with a click lands: this far in from the top left corner of what is in view (pixels), like the scripts of a sprite when it opens. */
const ADD_INSET = 24;

/**
 * Adds a copy of a palette block to the code area: at the top left of what is in view, or under
 * the scripts that are in the way there (the view follows it). Dragging puts it where you want.
 * A block that takes words opens them, to type your own over the example.
 */
function addBlockToCode(workspace: Blockly.WorkspaceSvg, source: Blockly.BlockSvg): Blockly.BlockSvg | null {
  const state = Blockly.serialization.blocks.save(source, { saveIds: false });
  if (!state || workspace.isReadOnly()) return null;
  const size = source.getHeightWidth();
  const view = workspace.getMetricsManager().getViewMetrics(true);
  // Clear of the other scripts by more than the distance at which blocks pull together (Blockly would push it away).
  const clear = Math.max(Blockly.config.snapRadius, Blockly.config.connectingSnapRadius) + 2;
  const inset = ADD_INSET / workspace.scale;
  const x = view.left + inset;
  let y = view.top + inset;
  const taken = workspace
    .getTopBlocks(false)
    .map((b) => b.getBoundingRectangle())
    .sort((a, b) => a.top - b.top);
  for (const box of taken) {
    const apart = box.left > x + size.width + clear || box.right < x - clear || box.top > y + size.height + clear || box.bottom < y - clear;
    if (!apart) y = box.bottom + clear;
  }
  Blockly.Events.setGroup(true);
  try {
    const block = Blockly.serialization.blocks.append({ ...state, x, y }, workspace, { recordUndo: true }) as Blockly.BlockSvg;
    workspace.scrollBoundsIntoView(block.getBoundingRectangle(), inset);
    // It is the selected block now: Delete takes it away again.
    Blockly.getFocusManager().focusNode(block);
    // A short glow shows where it landed.
    const root = block.getSvgRoot();
    root.classList.add('ambleAdded');
    window.setTimeout(() => root.classList.remove('ambleAdded'), 700);
    const words = block.inputList.flatMap((input) => input.fieldRow).find((field) => field instanceof Blockly.FieldTextInput);
    words?.showEditor();
    return block;
  } finally {
    Blockly.Events.setGroup(false);
  }
}

// -----------------------------------------------------------------------------
// Palette (flyout)
// -----------------------------------------------------------------------------

type PaletteElement = Blockly.BlockSvg | Blockly.FlyoutButton;

/** A card of the board: a category's heading and the blocks and buttons under it. */
interface BoardCard {
  name: string;
  category: AmbleCategory | null;
  label: Blockly.FlyoutButton;
  elements: PaletteElement[];
}

class AmbleFlyout extends ContinuousFlyout {
  override readonly MARGIN = 12;
  override readonly GAP_Y = 12;

  /** The board: its scale, what it was laid out for (see boardKey), how tall it came out (pixels), and its cards' backgrounds. */
  private boardScale = BLOCK_SCALE;
  private boardFor = '';
  private boardHeight = 0;
  private boardLayer: SVGGElement | null = null;

  constructor(options: Blockly.Options) {
    super(options);
    // Blocks line up with the palette's left margin (Scratch leaves no room for output tabs).
    (this as unknown as { tabWidth_: number }).tabWidth_ = 0;
    // Recycling reuses a block by its type only: the palette has many blocks of one type that
    // differ by their values (a character block per sprite, a variable block per variable...).
    this.setRecyclingEnabled(false);
    this.getWorkspace().setMetricsManager(new AmbleFlyoutMetrics(this.getWorkspace(), this));
    // A click on a palette block (not on one of its fields: those can be set before dragging) adds it to the code.
    this.getWorkspace().addChangeListener((e: Blockly.Events.Abstract) => {
      if (e.type !== Blockly.Events.CLICK) return;
      const click = e as Blockly.Events.Click;
      const block = click.targetType === 'block' && click.blockId ? this.getWorkspace().getBlockById(click.blockId) : null;
      if (block?.getRootBlock().isEnabled()) addBlockToCode(this.targetWorkspace, block.getRootBlock());
    });
  }

  private toolbox(): AmbleToolbox | null {
    const toolbox = this.targetWorkspace?.getToolbox();
    return toolbox instanceof AmbleToolbox ? toolbox : null;
  }

  /** The simple palette: every block at once, on a board. */
  private isBoard(): boolean {
    return this.toolbox()?.isBoard() ?? false;
  }

  /** Like Scratch, the palette keeps its size when the code area zooms. The board's blocks are as large as fits. */
  override getFlyoutScale() {
    return this.isBoard() ? this.boardScale : BLOCK_SCALE;
  }

  /** Scratch's palette is always 250 pixels wide; a wider block is cut off at the edge. The board takes a share of the editor. */
  override getWidth() {
    if (!this.isBoard()) return FLYOUT_WIDTH;
    const editor = this.targetWorkspace.getCachedParentSvgSize().width;
    return Math.round(Math.min(BOARD_MAX_WIDTH, Math.max(BOARD_MIN_WIDTH, editor * BOARD_SHARE)));
  }

  /** The palette ends above the strip with the switch between the two palettes. */
  private viewHeight(): number {
    return Math.max(0, this.targetWorkspace.getCachedParentSvgSize().height - FOOTER_HEIGHT);
  }

  protected override positionAt_(width: number, height: number, x: number, y: number) {
    super.positionAt_(width, Math.max(0, height - FOOTER_HEIGHT), x, y);
  }

  override show(flyoutDef: Blockly.utils.toolbox.FlyoutDefinition | string) {
    const board = this.isBoard();
    this.svgGroup_?.classList.toggle('ambleBoard', board);
    // The board's buttons are as compact as its blocks.
    const margins = { x: Blockly.FlyoutButton.TEXT_MARGIN_X, y: Blockly.FlyoutButton.TEXT_MARGIN_Y };
    if (board) Object.assign(Blockly.FlyoutButton, { TEXT_MARGIN_X: 16, TEXT_MARGIN_Y: 9 });
    try {
      super.show(flyoutDef);
    } finally {
      Object.assign(Blockly.FlyoutButton, { TEXT_MARGIN_X: margins.x, TEXT_MARGIN_Y: margins.y });
    }
  }

  /**
   * The board is laid out again when the editor is resized, and when one of its blocks changes
   * size (a longer word typed into it, another choice in one of its menus).
   */
  override position() {
    if (this.isBoard() && this.isVisible() && this.boardFor !== this.boardKey(this.getContents())) {
      this.layoutBoard(this.getContents());
      this.targetWorkspace.recordDragTargets();
    }
    super.position();
  }

  /**
   * Stacks the palette's contents, starting half a gap higher than Blockly does: that is
   * where Scratch shows the first heading (its palette opens scrolled to the first category).
   */
  protected override layout_(contents: Blockly.FlyoutItem[]) {
    if (this.isBoard()) {
      this.layoutBoard(contents);
      return;
    }
    this.boardLayer?.remove();
    this.boardLayer = null;
    this.boardFor = '';
    this.workspace_.scale = this.getFlyoutScale();
    const x = this.MARGIN;
    let y = this.MARGIN - this.GAP_Y / 2;
    for (const item of contents) {
      item.getElement().moveBy(x, y);
      y += item.getElement().getBoundingRectangle().getHeight();
    }
  }

  /** The board's width never follows its contents: its contents are fitted to it. */
  protected override reflowInternal_() {
    if (!this.isBoard()) {
      super.reflowInternal_();
      return;
    }
    this.workspace_.scale = this.getFlyoutScale();
    this.position();
    this.targetWorkspace.resizeContents();
    this.targetWorkspace.recordDragTargets();
  }

  /** The list leaves room under its last category so that it can scroll to the top; the board doesn't scroll to categories. */
  override calculateBottomPadding(contentMetrics: Blockly.MetricsManager.ContainerRegion, viewMetrics: Blockly.MetricsManager.ContainerRegion): number {
    return this.isBoard() ? 0 : super.calculateBottomPadding(contentMetrics, viewMetrics);
  }

  /** How far the board scrolls (pixels): not at all when it fits, which is what it is laid out for. */
  boardScrollHeight(): number | null {
    return this.isBoard() ? Math.max(this.boardHeight, this.viewHeight()) : null;
  }

  /** What a layout of the board depends on: the room it has, and the size of everything on it. */
  private boardKey(contents: Blockly.FlyoutItem[]): string {
    const sizes = contents.map((item) => {
      const box = item.getElement().getBoundingRectangle();
      return `${Math.round(box.getWidth())}x${Math.round(box.getHeight())}`;
    });
    return `${this.getWidth()}x${this.viewHeight()}:${sizes.join(',')}`;
  }

  /** Lays the palette out as a board: a card per category, its blocks flowing in rows, as large as fits. */
  private layoutBoard(contents: Blockly.FlyoutItem[]) {
    const toolbox = this.toolbox();
    const cards: BoardCard[] = [];
    for (const item of contents) {
      const element = item.getElement();
      if (element instanceof Blockly.FlyoutButton && element.isLabel()) {
        const name = element.getButtonText();
        cards.push({ name, category: toolbox?.category(name) ?? null, label: element, elements: [] });
      } else if (cards.length && (element instanceof Blockly.BlockSvg || element instanceof Blockly.FlyoutButton)) {
        cards[cards.length - 1].elements.push(element);
      }
    }
    const sections: BoardSection[] = cards.map((card) => {
      const info = card.category?.info();
      const rowOf = (element: PaletteElement) => (element instanceof Blockly.BlockSvg ? (info?.rows?.findIndex((row) => row.includes(element.type)) ?? -1) : -1);
      return {
        column: info?.column === undefined ? 0 : info.column,
        headingWidth: HEADING_ICON + HEADING_ICON_GAP + textWidth(card.name, HEADING_FONT),
        items: card.elements.map((element, i) => {
          const box = element.getBoundingRectangle();
          const row = rowOf(element);
          return {
            width: box.getWidth(),
            height: box.getHeight(),
            // Round blocks and buttons sit in the middle of their row; blocks that stack hang from its top.
            centred: !(element instanceof Blockly.BlockSvg) || Boolean(element.outputConnection),
            // A block starts a row unless it shares one with the block before it.
            newRow: i > 0 && row >= 0 && row !== rowOf(card.elements[i - 1]),
          };
        }),
      };
    });
    const layout = fitBoard(sections, this.getWidth(), this.viewHeight(), BOARD_SCALES);
    const unit = 1 / layout.scale;
    this.boardScale = layout.scale;
    this.boardHeight = layout.height;
    this.boardFor = this.boardKey(contents);
    this.workspace_.scale = layout.scale;

    Blockly.Events.disable();
    try {
      cards.forEach((card, c) => {
        const placed = layout.sections[c];
        card.label.moveTo(placed.x * unit, placed.y * unit);
        card.elements.forEach((element, i) => {
          const x = placed.items[i].x * unit;
          const y = placed.items[i].y * unit;
          if (element instanceof Blockly.FlyoutButton) {
            element.moveTo(x, y);
          } else {
            const at = element.getRelativeToSurfaceXY();
            element.moveBy(x - at.x, y - at.y);
          }
        });
      });
    } finally {
      Blockly.Events.enable();
    }

    // The cards, under the blocks. They are drawn in pixels (the layer undoes the palette's scale).
    // (Blockly's own headings stay where they are for screen readers, unseen.)
    this.boardLayer?.remove();
    const canvas = this.workspace_.getCanvas();
    const layer = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.G, { class: 'ambleBoardLayer', transform: `scale(${unit})`, 'aria-hidden': 'true' });
    canvas.insertBefore(layer, canvas.firstChild);
    this.boardLayer = layer;
    cards.forEach((card, c) => {
      const { x, y, width, height } = layout.sections[c];
      const across = card.category?.info().column === null;
      Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.RECT, { class: across ? 'ambleBoardCard ambleBoardCardAcross' : 'ambleBoardCard', x, y, width, height, rx: CARD_RADIUS, ry: CARD_RADIUS }, layer);
      const heading = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.G, { class: 'ambleBoardHeading', transform: `translate(${x + layout.style.padX},${y + layout.style.padTop})` }, layer);
      const hint = card.category?.info().hint;
      if (hint) {
        (heading as SVGGElement & { tooltip?: string }).tooltip = hint;
        Blockly.Tooltip.bindMouseEvents(heading);
      }
      const marker = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.G, {}, heading);
      marker.innerHTML = card.category?.marker() ?? '';
      const icon = marker.firstElementChild;
      icon?.setAttribute('width', String(HEADING_ICON));
      icon?.setAttribute('height', String(HEADING_ICON));
      const text = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.TEXT, { x: HEADING_ICON + HEADING_ICON_GAP, y: HEADING_ICON / 2, 'dominant-baseline': 'central' }, heading);
      text.textContent = card.name;
      const note = card.category?.info().note;
      const noteX = HEADING_ICON + HEADING_ICON_GAP + textWidth(card.name, HEADING_FONT) + NOTE_GAP;
      if (note && noteX + textWidth(note, NOTE_FONT) <= width - 2 * layout.style.padX) {
        const quiet = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.TEXT, { class: 'ambleBoardNote', x: noteX, y: HEADING_ICON / 2, 'dominant-baseline': 'central' }, heading);
        quiet.textContent = note;
      }
    });

    // Show it from the top, at its new scale.
    this.workspace_.scrollbar?.resize();
    this.workspace_.scrollbar?.setY(0);
    this.workspace_.translate(this.workspace_.scrollX, this.workspace_.scrollY);
  }
}

/** The board is exactly as tall as it was laid out (Blockly adds margins around a flyout's contents, which would make a board that fits scroll). */
class AmbleFlyoutMetrics extends Blockly.FlyoutMetricsManager {
  override getScrollMetrics(getWorkspaceCoordinates?: boolean, cachedViewMetrics?: Blockly.MetricsManager.ContainerRegion, cachedContentMetrics?: Blockly.MetricsManager.ContainerRegion) {
    const flyout = this.flyout_ as AmbleFlyout;
    const metrics = super.getScrollMetrics(getWorkspaceCoordinates, cachedViewMetrics, cachedContentMetrics);
    const scale = getWorkspaceCoordinates ? this.workspace_.scale : 1;
    const board = flyout.boardScrollHeight();
    if (board !== null) {
      metrics.height = board / scale;
    } else {
      // As in the continuous toolbox: room to scroll the last category to the top.
      const contentMetrics = cachedContentMetrics || this.getContentMetrics(getWorkspaceCoordinates);
      const viewMetrics = cachedViewMetrics || this.getViewMetrics(getWorkspaceCoordinates);
      metrics.height += flyout.calculateBottomPadding(contentMetrics, viewMetrics);
    }
    return metrics;
  }
}

class AmbleToolbox extends ContinuousToolbox {
  private ready = false;
  private board = false;
  private footer: HTMLDivElement | null = null;
  private switchButton: HTMLButtonElement | null = null;

  override init() {
    super.init();
    this.ready = true;
    // The switch between the two palettes, under the palette.
    this.footer = document.createElement('div');
    this.footer.className = 'amblePaletteFooter';
    this.switchButton = document.createElement('button');
    this.switchButton.type = 'button';
    this.switchButton.className = 'amblePaletteSwitch';
    this.switchButton.addEventListener('click', () => {
      // The editor registers what the switch does, like for the palette's other buttons.
      const toggle = this.workspace_.getButtonCallback(TOGGLE_PALETTE) as (() => void) | undefined;
      toggle?.();
    });
    this.footer.appendChild(this.switchButton);
    this.workspace_.getInjectionDiv().appendChild(this.footer);
    this.showMode();
    this.position();
  }

  override dispose() {
    this.footer?.remove();
    this.footer = null;
    super.dispose();
  }

  /** The simple palette: one board with every block, and no category column. */
  isBoard(): boolean {
    return this.board;
  }

  category(name: string): AmbleCategory | null {
    const item = this.getCategoryByName(name);
    return item instanceof AmbleCategory ? item : null;
  }

  /** The column and the switch follow the palette: the board has no categories to jump to, and offers more blocks. */
  private showMode() {
    this.HtmlDiv?.classList.toggle('ambleBoardToolbox', this.board);
    if (!this.switchButton) return;
    const label = this.board ? 'More blocks' : 'Fewer blocks';
    this.switchButton.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${this.board ? SWITCH_MORE : SWITCH_FEWER}" fill="currentColor"/></svg><span></span>`;
    this.switchButton.lastElementChild!.textContent = label;
    this.switchButton.title = this.board ? 'Show every block, by category' : 'Show only the blocks most games need';
  }

  /** The column ends above the switch, which is as wide as the palette (column and blocks). */
  override position() {
    super.position();
    if (this.HtmlDiv) this.HtmlDiv.style.height = `calc(100% - ${FOOTER_HEIGHT}px)`;
    // (The palette has a line down its right side, which the strip continues.)
    if (this.footer) this.footer.style.width = `${this.getWidth() + this.getFlyout().getWidth() + 1}px`;
  }

  /**
   * Re-renders the categories and the palette, keeping the palette's scroll position. When the
   * categories themselves change (the Stage has a brief but no motion), it starts from the top.
   */
  override render(toolboxDef: Blockly.utils.toolbox.ToolboxInfo) {
    const names = () => this.getToolboxItems().map((item) => (item as Blockly.ISelectableToolboxItem).getName?.() ?? '').join('|');
    const before = this.ready ? names() : '';
    const selected = this.getSelectedItem()?.getName();
    const wasBoard = this.board;
    this.board = (toolboxDef as PaletteInfo).layout === 'board';
    this.showMode();
    // The old category rows are about to be replaced.
    this.selectedItem_ = null;
    super.render(toolboxDef);
    if (!this.ready) return;
    const same = names() === before;
    const flyout = this.getFlyout();
    const flyoutWs = flyout.getWorkspace();
    const scroll = same ? -flyoutWs.scrollY : 0;
    // A new set of categories also stops a scroll still gliding to a category of the old set.
    if (!same) (flyout as unknown as { scrollTarget?: number }).scrollTarget = undefined;
    flyout.show(this.getToolboxItems().flatMap((item) => this.convertToolboxItemToFlyoutItems(item)));
    // The column comes and goes with the board: the palette and the code area move over.
    if (wasBoard !== this.board) this.workspace_.resize();
    const metrics = flyoutWs.getMetrics();
    flyoutWs.scrollbar?.setY(Math.min(scroll, Math.max(0, metrics.scrollHeight - metrics.viewHeight)));
    const first = (this.getToolboxItems()[0] as Blockly.ISelectableToolboxItem | undefined)?.getName?.();
    const pick = same ? selected : first;
    if (pick) this.selectCategoryByName(pick);
  }

  /** The palette is refreshed by the editor when its contents change, not after every block edit. */
  override refreshSelection() {}
}

/** The switch's icons: a plus and a minus cut from card. */
const SWITCH_MORE = 'M6.7 2.6A1.3 1.3 0 0 1 9.3 2.6L9.3 6.7L13.4 6.7A1.3 1.3 0 0 1 13.4 9.3L9.3 9.3L9.3 13.4A1.3 1.3 0 0 1 6.7 13.4L6.7 9.3L2.6 9.3A1.3 1.3 0 0 1 2.6 6.7L6.7 6.7Z';
const SWITCH_FEWER = 'M2.6 6.7L13.4 6.7A1.3 1.3 0 0 1 13.4 9.3L2.6 9.3A1.3 1.3 0 0 1 2.6 6.7Z';

// -----------------------------------------------------------------------------
// Zoom buttons (bottom right, like Scratch: zoom in, zoom out, then reset)
// -----------------------------------------------------------------------------

class AmbleZoomControls implements Blockly.IPositionable {
  readonly id = 'zoomControls';
  private readonly size = 36;
  private readonly smallGap = 4;
  private readonly largeGap = 12;
  private readonly margin = 20;
  private group: SVGGElement | null = null;
  private left = 0;
  private top = 0;
  private events: Blockly.browserEvents.Data[] = [];

  constructor(private readonly workspace: Blockly.WorkspaceSvg) {}

  init() {
    this.group = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.G, { class: 'ambleZoomControls' });
    const button = (cls: string, href: string, y: number, tip: string, onDown: (e: PointerEvent) => void) => {
      const g = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.G, { class: `blocklyZoom ${cls}`, transform: `translate(0,${y})`, role: 'button', 'aria-label': tip }, this.group);
      // The tooltip.
      Blockly.utils.dom.createSvgElement('title', {}, g).textContent = tip;
      const image = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.IMAGE, { width: this.size, height: this.size }, g);
      image.setAttributeNS(Blockly.utils.dom.XLINK_NS, 'xlink:href', href);
      this.events.push(Blockly.browserEvents.conditionalBind(g, 'pointerdown', null, onDown));
    };
    button('blocklyZoomIn', ZOOM_IN_ICON, 0, 'Zoom in', (e) => this.zoom(e, 1));
    button('blocklyZoomOut', ZOOM_OUT_ICON, this.size + this.smallGap, 'Zoom out', (e) => this.zoom(e, -1));
    button('blocklyZoomReset', ZOOM_RESET_ICON, 2 * this.size + this.smallGap + this.largeGap, 'Normal size', (e) => this.reset(e));
    this.workspace.getParentSvg().appendChild(this.group);
    this.workspace.getComponentManager().addComponent({ component: this, weight: 2, capabilities: [Blockly.ComponentManager.Capability.POSITIONABLE] });
  }

  dispose() {
    this.workspace.getComponentManager().removeComponent(this.id);
    for (const e of this.events) Blockly.browserEvents.unbind(e);
    this.group?.remove();
  }

  private height() {
    return 3 * this.size + this.smallGap + this.largeGap;
  }

  getBoundingRectangle(): Blockly.utils.Rect {
    return new Blockly.utils.Rect(this.top, this.top + this.height(), this.left, this.left + this.size);
  }

  position(metrics: Blockly.MetricsManager.UiMetrics, savedPositions: Blockly.utils.Rect[]) {
    const corner = Blockly.uiPosition.getCornerOppositeToolbox(this.workspace, metrics);
    const start = Blockly.uiPosition.getStartPositionRect(corner, new Blockly.utils.Size(this.size, this.height()), this.margin, this.margin, metrics, this.workspace);
    const rect = Blockly.uiPosition.bumpPositionRect(start, this.margin, Blockly.uiPosition.bumpDirection.UP, savedPositions);
    this.top = rect.top;
    this.left = rect.left;
    this.group?.setAttribute('transform', `translate(${this.left},${this.top})`);
  }

  private zoom(e: PointerEvent, amount: number) {
    this.workspace.markFocused();
    this.workspace.zoomCenter(amount);
    this.done(e);
  }

  /** Back to the starting zoom, with the scripts in view. */
  private reset(e: PointerEvent) {
    this.workspace.markFocused();
    const { startScale, scaleSpeed } = this.workspace.options.zoomOptions;
    this.workspace.beginCanvasTransition();
    this.workspace.zoomCenter(Math.log(startScale / this.workspace.scale) / Math.log(scaleSpeed));
    this.workspace.scrollCenter();
    setTimeout(() => this.workspace.endCanvasTransition(), 500);
    this.done(e);
  }

  private done(e: PointerEvent) {
    Blockly.Touch.clearTouchIdentifier();
    e.stopPropagation();
    e.preventDefault();
  }
}

/** Adds Scratch's zoom buttons to a workspace (inject it with `zoom.controls: false`). */
export function addZoomControls(workspace: Blockly.WorkspaceSvg): () => void {
  const controls = new AmbleZoomControls(workspace);
  controls.init();
  return () => controls.dispose();
}

// -----------------------------------------------------------------------------
// Context menus: Scratch's items only
// -----------------------------------------------------------------------------

function registerContextMenus() {
  const registry = Blockly.ContextMenuRegistry.registry;
  // Block: Duplicate, Add Comment, Delete Block. Workspace: Undo, Redo, Clean up Blocks, Delete N Blocks, Add Comment.
  for (const id of ['blockInline', 'blockCollapseExpand', 'blockDisable', 'blockHelp', 'collapseWorkspace', 'expandWorkspace']) {
    if (registry.getItem(id)) registry.unregister(id);
  }
  if (!registry.getItem('commentCreate')) Blockly.ContextMenuItems.registerCommentOptions();

  // Like Scratch, "Duplicate" copies the block and every block under it.
  const duplicate = registry.getItem('blockDuplicate');
  if (duplicate && !duplicate.separator) {
    registry.unregister('blockDuplicate');
    registry.register({
      ...duplicate,
      callback(scope: Blockly.ContextMenuRegistry.Scope) {
        const data = scope.block?.toCopyData(true);
        if (data) Blockly.clipboard.paste(data, scope.block!.workspace);
      },
    });
  }
}

// -----------------------------------------------------------------------------
// Scratch's look for everything Blockly draws in HTML (in Amble's colours, like src/styles.css)
// -----------------------------------------------------------------------------

/** Dividers (Scratch's black 15%, with Amble's lilac tint), the panels' inner rim, and floating menus' shadow. */
const LINE = 'hsla(240, 12%, 38%, 0.22)';
const RIM = 'hsla(252, 55%, 62%, 0.2)';
const FLOAT = '0 2px 4px hsla(247, 35%, 25%, 0.08), 0 8px 24px -4px hsla(247, 35%, 25%, 0.24)';
/** The selected category's row and pressed buttons (Scratch's light grey, tinted). */
const SELECTED_ROW = '#ebedf6';
/** Amble's purple (the menu bar's), for what the pointer is on. */
const ACCENT = '#6f62cc';
/** The paper under the board's cards. */
const BOARD_PAPER = '#f0eef9';

const CSS = `
/* Category column */
.blocklyToolbox {
  width: 60px;
  padding: 0;
  background: #fff;
  border-right: 1px solid ${LINE};
  border-bottom: 1px solid ${LINE};
  box-sizing: content-box;
  color: ${BLOCK_TEXT_COLOUR};
  font-family: ${BLOCK_FONT_FAMILY};
  overflow-x: hidden;
  scrollbar-width: none;
}
.blocklyToolbox::-webkit-scrollbar { display: none; }
.blocklyToolboxCategoryGroup { padding: 0; }
.blocklyToolbox .blocklyToolboxCategory {
  height: auto;
  margin: 0;
  padding: 0.375rem 0;
  line-height: 22px;
  color: ${BLOCK_TEXT_COLOUR};
  cursor: pointer;
  white-space: nowrap;
}
.blocklyToolbox .blocklyToolboxCategory:hover { color: #149deb; }
.blocklyToolbox .blocklyToolboxSelected { background-color: ${SELECTED_ROW}; }
.blocklyToolbox .blocklyToolboxCategoryLabel {
  width: 60px;
  margin: 0;
  padding: 0;
  font-family: ${BLOCK_FONT_FAMILY};
  font-size: 0.65rem;
  font-weight: 400;
  line-height: normal;
  text-align: center;
  white-space: normal;
  color: inherit;
  cursor: pointer;
}
.blocklyToolboxSelected .blocklyToolboxCategoryLabel { color: inherit; }
.blocklyToolbox .categoryBubble {
  width: 1.25rem;
  height: 1.25rem;
  margin: 0 auto 0.125rem;
  border: none;
  border-radius: 0;
  box-sizing: border-box;
}
.blocklyToolbox .categoryBubble > svg { display: block; width: 100%; height: 100%; }

/* (Blockly shows the column with an inline style.) */
.blocklyToolbox.ambleBoardToolbox { display: none !important; }

/* The switch between the two palettes, under the palette */
.amblePaletteFooter {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  height: ${FOOTER_HEIGHT}px;
  background: #fff;
  border-top: 1px solid ${LINE};
  border-right: 1px solid ${LINE};
  box-sizing: border-box;
}
.amblePaletteSwitch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 12px 0 9px;
  border: 1px solid ${LINE};
  border-radius: 12px;
  background: #fff;
  color: ${BLOCK_TEXT_COLOUR};
  font: bold 11.5px ${BLOCK_FONT_FAMILY};
  white-space: nowrap;
  cursor: pointer;
}
.amblePaletteSwitch:hover { border-color: ${ACCENT}; color: ${ACCENT}; }
.amblePaletteSwitch:active { background: ${SELECTED_ROW}; }
.amblePaletteSwitch:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 1px; }

/* Palette */
.blocklyFlyout { border-right: 1px solid ${LINE}; box-sizing: content-box; }

/* The board (the simple palette): white cards on lilac paper, each under its heading */
.blocklyFlyout.ambleBoard .blocklyFlyoutBackground { fill: ${BOARD_PAPER}; fill-opacity: 1; }
.ambleBoard .blocklyFlyoutLabel { opacity: 0; pointer-events: none; }
.ambleBoardCard { fill: #fff; stroke: ${RIM}; stroke-width: 1px; }
.ambleBoardHeading { cursor: default; }
.ambleBoardCardAcross { stroke: ${ACCENT}; stroke-opacity: 0.45; }
.ambleBoardHeading > text { font: ${HEADING_FONT}; fill: ${BLOCK_TEXT_COLOUR}; }
.ambleBoardHeading > text.ambleBoardNote { font: ${NOTE_FONT}; fill-opacity: 0.75; }

/* Words aren't typed in the palette (a click there adds the block): they are part of the block to grab */
.injectionDiv .blocklyFlyout .blocklyDraggable .ambleWords,
.injectionDiv .blocklyFlyout .blocklyDraggable .ambleWords > text { cursor: inherit; }

/* A block added with a click glows where it landed */
@keyframes ambleAdded {
  0% { filter: drop-shadow(0 0 0 ${ACCENT}); }
  35% { filter: drop-shadow(0 0 9px ${ACCENT}); }
  100% { filter: drop-shadow(0 0 0 transparent); }
}
.ambleAdded { animation: ambleAdded 0.7s ease-out; }
.blocklyFlyoutBackground { fill: #fbf8fd; fill-opacity: 0.8; }
.blocklyFlyoutLabel { cursor: default; }
.blocklyFlyoutLabelBackground { opacity: 0; }
.blocklyFlyoutButton { fill: none; cursor: pointer; }
.blocklyFlyoutButton:hover { fill: #fff; }
.blocklyFlyoutButton:active { fill: ${SELECTED_ROW}; }
.blocklyFlyoutButtonShadow { fill: transparent; }
.blocklyFlyoutButtonBackground { stroke: #c8c5ca; }
.injectionDiv .blocklyFlyout .blocklyFlyoutButton .blocklyText { fill: ${BLOCK_TEXT_COLOUR}; font: 500 12pt ${BLOCK_FONT_FAMILY}; }
.blocklyFlyout .blocklyScrollbarHandle { fill: #d0ccd2; }

/* Workspace */
.blocklyMainBackground { stroke: none; }
.blocklyScrollbarHandle { fill: #d0ccd2; }
.blocklyScrollbarBackground { opacity: 0; }
.blocklyZoom > image { opacity: 1; cursor: pointer; }
.blocklyZoom > image:hover { opacity: 0.75; }
.blocklyZoom > image:active { opacity: 0.6; }
:not(.blocklyDragging) > .blocklyDragging { filter: drop-shadow(0 0 6px hsla(247, 35%, 12%, 0.6)); }
.blocklyInsertionMarker > .blocklyPath { stroke: none; }

/* Inputs */
.blocklyEditableField > rect.ambleTextRect { stroke-width: 1px; }
.blocklyWidgetDiv textarea.ambleTextInput {
  font-family: ${BLOCK_FONT_FAMILY};
  font-weight: 500;
  color: ${BLOCK_TEXT_COLOUR};
  background: #fff;
  box-sizing: border-box;
  resize: none;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: none;
}

/* Dropdown menus (colored like the block, like Scratch) */
.blocklyDropDownDiv {
  border-radius: 5.75px;
  box-shadow: ${FLOAT};
  padding: 4px;
}
.blocklyDropDownDiv .blocklyMenu { padding: 0; }
.blocklyDropDownDiv .blocklyMenuItem {
  min-height: 32px;
  padding: 4px 7em 4px 28px;
  font: bold 13px ${BLOCK_FONT_FAMILY};
  color: #fff;
  border-radius: 0;
  box-sizing: border-box;
}
.blocklyDropDownDiv .blocklyMenuItemContent { color: #fff; }
.blocklyDropDownDiv .blocklyMenuItem.blocklyMenuItemHighlight { background-color: rgba(0, 0, 0, 0.2); }
.blocklyDropDownContent { max-height: 300px; }

/* Context menus */
.blocklyWidgetDiv .blocklyContextMenu {
  padding: 4px 0;
  background: #fff;
  border: 1px solid ${RIM};
  border-radius: 5.75px;
  box-shadow: ${FLOAT};
  font: 13px ${BLOCK_FONT_FAMILY};
}
.blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem {
  margin: 0;
  padding: 6px 15px;
  border: none;
  border-radius: 0;
  min-height: 0;
  font: 13px ${BLOCK_FONT_FAMILY};
  color: #000;
  line-height: normal;
}
.blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemHighlight { background-color: rgba(89, 187, 242, 0.25); }
.blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItemDisabled { color: #cdcad0; }
.blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItemDisabled.blocklyMenuItemHighlight { background: none; }
.blocklyWidgetDiv .blocklyContextMenu:focus { box-shadow: ${FLOAT}; }
.blocklyWidgetDiv .blocklyContextMenu .blocklyShortcut { display: none; }

/* Comments: Scratch's yellow notes */
.injectionDiv { --commentFillColour: #fef49c; --commentBorderColour: #e2db96; }
.blocklyComment .blocklyCommentTopbarBackground { height: 32px; fill: #e2db96; }
.blocklyComment .blocklyTextarea {
  border: none;
  padding: 12px;
  background: #fef49c;
  color: ${BLOCK_TEXT_COLOUR};
  font: 400 12pt ${BLOCK_FONT_FAMILY};
}
.blocklyComment .blocklyTextarea::placeholder { color: rgba(0, 0, 0, 0.5); font-style: italic; }
.blocklyComment:not(.blocklyCollapsed) .blocklyCommentHighlight,
.blocklyComment.blocklyCollapsed .blocklyCommentTopbarBackground { stroke: #bca903; stroke-width: 1px; }
.blocklyComment .blocklyDeleteIcon { display: block; width: 32px; height: 32px; }
.blocklyComment .blocklyFoldoutIcon { width: 32px; height: 32px; transform-origin: 16px 16px; }
.blocklyComment.blocklyCollapsed .blocklyFoldoutIcon { transform: rotate(-90deg); }
.blocklyComment .blocklyResizeHandle { width: 20px; height: 20px; }
.blocklyComment .blocklyCommentPreview.blocklyText { fill: ${BLOCK_TEXT_COLOUR}; font: 400 12pt ${BLOCK_FONT_FAMILY}; }
.blocklySelected .blocklyCommentHighlight { stroke: #bca903; stroke-width: 1px; }
.ambleCommentLine { stroke-width: 1px; }

.blocklyTooltipDiv {
  font: 12px ${BLOCK_FONT_FAMILY};
  color: ${BLOCK_TEXT_COLOUR};
  background: #fff;
  border: 1px solid ${RIM};
  border-radius: 5.75px;
  box-shadow: ${FLOAT};
  padding: 6px 8px;
  opacity: 1;
}
`;

let registered = false;

/** Registers the continuous toolbox (Scratch-styled), context menus and CSS (once). */
export function registerWorkspaceUi(): void {
  if (registered) return;
  registered = true;
  registerContinuousToolbox();
  Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, AmbleCategory, true);
  Blockly.registry.register(Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX, 'AmbleFlyout', AmbleFlyout, true);
  Blockly.registry.register(Blockly.registry.Type.TOOLBOX, 'AmbleToolbox', AmbleToolbox, true);
  registerContextMenus();
  Blockly.Scrollbar.scrollbarThickness = Blockly.Touch.TOUCH_ENABLED ? 14 : 11;
  Blockly.FlyoutButton.TEXT_MARGIN_X = 40;
  Blockly.FlyoutButton.TEXT_MARGIN_Y = 10;
  // Soft-square buttons, like the rest of Amble's.
  Blockly.FlyoutButton.BORDER_RADIUS = 5.75;
  Blockly.config.dragRadius = 3;
  Blockly.config.snapRadius = 48;
  Blockly.config.connectingSnapRadius = 68;
  Blockly.config.currentConnectionPreference = 20;
  Blockly.config.bumpDelay = 0;
  Blockly.Css.register(CSS);
}
