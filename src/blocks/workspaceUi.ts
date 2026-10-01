import * as Blockly from 'blockly/core';
import { ContinuousCategory, ContinuousFlyout, ContinuousToolbox, registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { ZOOM_IN_ICON, ZOOM_OUT_ICON, ZOOM_RESET_ICON } from './icons';
import { BLOCK_FONT_FAMILY, BLOCK_TEXT_COLOUR } from './renderer';

/** Width of the block palette, like Scratch's. */
export const FLYOUT_WIDTH = 250;
/** Scratch draws blocks at 0.675 (the palette always, the code area until you zoom). */
export const BLOCK_SCALE = 0.675;

// -----------------------------------------------------------------------------
// Category column: small colored circles with labels under them
// -----------------------------------------------------------------------------

class AmbleCategory extends ContinuousCategory {
  override createIconDom_(): Element {
    const icon = super.createIconDom_() as HTMLElement;
    const border = (this.toolboxItemDef_ as { borderColour?: string }).borderColour;
    if (border) icon.style.borderColor = border;
    return icon;
  }

  override setSelected(isSelected: boolean) {
    super.setSelected(isSelected);
    // The selected row is styled in CSS (Scratch's light gray), not with an inline color.
    if (this.rowDiv_) this.rowDiv_.style.backgroundColor = '';
  }
}

// -----------------------------------------------------------------------------
// Palette (flyout)
// -----------------------------------------------------------------------------

class AmbleFlyout extends ContinuousFlyout {
  override readonly MARGIN = 12;
  override readonly GAP_Y = 12;

  constructor(options: Blockly.Options) {
    super(options);
    // Blocks line up with the palette's left margin (Scratch leaves no room for output tabs).
    (this as unknown as { tabWidth_: number }).tabWidth_ = 0;
    // Recycling reuses a block by its type only: the palette has many blocks of one type that
    // differ by their values (a character block per sprite, a variable block per variable...).
    this.setRecyclingEnabled(false);
  }

  /** Like Scratch, the palette keeps its size when the code area zooms. */
  override getFlyoutScale() {
    return BLOCK_SCALE;
  }

  /** Scratch's palette is always 250 pixels wide; a wider block is cut off at the edge. */
  override getWidth() {
    return FLYOUT_WIDTH;
  }

  /**
   * Stacks the palette's contents, starting half a gap higher than Blockly does: that is
   * where Scratch shows the first heading (its palette opens scrolled to the first category).
   */
  protected override layout_(contents: Blockly.FlyoutItem[]) {
    this.workspace_.scale = this.getFlyoutScale();
    const x = this.MARGIN;
    let y = this.MARGIN - this.GAP_Y / 2;
    for (const item of contents) {
      item.getElement().moveBy(x, y);
      y += item.getElement().getBoundingRectangle().getHeight();
    }
  }
}

class AmbleToolbox extends ContinuousToolbox {
  private ready = false;

  override init() {
    super.init();
    this.ready = true;
  }

  /**
   * Re-renders the categories and the palette, keeping the palette's scroll position. When the
   * categories themselves change (the Stage has a brief but no motion), it starts from the top.
   */
  override render(toolboxDef: Blockly.utils.toolbox.ToolboxInfo) {
    const names = () => this.getToolboxItems().map((item) => (item as Blockly.ISelectableToolboxItem).getName?.() ?? '').join('|');
    const before = this.ready ? names() : '';
    const selected = this.getSelectedItem()?.getName();
    // The old category rows are about to be replaced.
    this.selectedItem_ = null;
    super.render(toolboxDef);
    if (!this.ready) return;
    const same = names() === before;
    const flyout = this.getFlyout();
    const flyoutWs = flyout.getWorkspace();
    const scroll = same ? -flyoutWs.scrollY : 0;
    flyout.show(this.getToolboxItems().flatMap((item) => this.convertToolboxItemToFlyoutItems(item)));
    const metrics = flyoutWs.getMetrics();
    flyoutWs.scrollbar?.setY(Math.min(scroll, Math.max(0, metrics.scrollHeight - metrics.viewHeight)));
    const first = (this.getToolboxItems()[0] as Blockly.ISelectableToolboxItem | undefined)?.getName?.();
    const pick = same ? selected : first;
    if (pick) this.selectCategoryByName(pick);
  }

  /** The palette is refreshed by the editor when its contents change, not after every block edit. */
  override refreshSelection() {}
}

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
const LINE = 'hsla(240, 18%, 40%, 0.22)';
const RIM = 'hsla(255, 55%, 62%, 0.2)';
const FLOAT = '0 2px 4px hsla(250, 35%, 25%, 0.08), 0 8px 24px -4px hsla(250, 35%, 25%, 0.24)';
/** The selected category's row and pressed buttons (Scratch's light grey, tinted). */
const SELECTED_ROW = '#ecedf8';

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
.blocklyToolbox .blocklyToolboxCategory:hover { color: #2a9dee; }
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
  border: 1px solid;
  border-radius: 100%;
  box-sizing: border-box;
}

/* Palette */
.blocklyFlyout { border-right: 1px solid ${LINE}; box-sizing: content-box; }
.blocklyFlyoutBackground { fill: #fbf8ff; fill-opacity: 0.8; }
.blocklyFlyoutLabel { cursor: default; }
.blocklyFlyoutLabelBackground { opacity: 0; }
.blocklyFlyoutButton { fill: none; cursor: pointer; }
.blocklyFlyoutButton:hover { fill: #fff; }
.blocklyFlyoutButton:active { fill: ${SELECTED_ROW}; }
.blocklyFlyoutButtonShadow { fill: transparent; }
.blocklyFlyoutButtonBackground { stroke: #c8c5cc; }
.injectionDiv .blocklyFlyout .blocklyFlyoutButton .blocklyText { fill: ${BLOCK_TEXT_COLOUR}; font: 500 12pt ${BLOCK_FONT_FAMILY}; }
.blocklyFlyout .blocklyScrollbarHandle { fill: #d0ccd4; }

/* Workspace */
.blocklyMainBackground { stroke: none; }
.blocklyScrollbarHandle { fill: #d0ccd4; }
.blocklyScrollbarBackground { opacity: 0; }
.blocklyZoom > image { opacity: 1; cursor: pointer; }
.blocklyZoom > image:hover { opacity: 0.75; }
.blocklyZoom > image:active { opacity: 0.6; }
:not(.blocklyDragging) > .blocklyDragging { filter: drop-shadow(0 0 6px hsla(250, 35%, 12%, 0.6)); }
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
  border-radius: 6px;
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
  border-radius: 6px;
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
.blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemHighlight { background-color: rgba(89, 179, 242, 0.25); }
.blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItemDisabled { color: #cdcad1; }
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
  border-radius: 6px;
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
  Blockly.FlyoutButton.BORDER_RADIUS = 6;
  Blockly.config.dragRadius = 3;
  Blockly.config.snapRadius = 48;
  Blockly.config.connectingSnapRadius = 68;
  Blockly.config.currentConnectionPreference = 20;
  Blockly.config.bumpDelay = 0;
  Blockly.Css.register(CSS);
}
