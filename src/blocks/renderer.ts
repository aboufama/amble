import * as Blockly from 'blockly/core';

/**
 * Amble's block renderer: Blockly's zelos renderer tuned to draw blocks the way Scratch 3
 * does (Scratch's own renderer is also built on zelos). Differences from plain zelos:
 * - no glowing outline on the selected block (Scratch shows none),
 * - label text in regular weight (500) instead of bold,
 * - "define" blocks get Scratch's rounded "bowler hat" top,
 * - no connection highlight; insertion markers show where a block will go.
 */

export const BLOCK_FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

type BlockWithHat = Blockly.BlockSvg & { hat?: string };

class AmbleConstants extends Blockly.zelos.ConstantProvider {
  override SELECTED_GLOW_COLOUR = '#ffffff';
  override FIELD_TEXT_FONTWEIGHT = '500';
  override FIELD_TEXT_FONTFAMILY = BLOCK_FONT_FAMILY;
  /** Height of the rounded top of "define" blocks. */
  BOWLER_HAT_HEIGHT = 20;

  override createDom(svg: SVGElement, selector: string, injectionDivIfIsParent?: HTMLElement) {
    super.createDom(svg, selector, injectionDivIfIsParent);
    this.selectedGlowFilterId = '';
  }

  /** The rounded top of a "define" block of the given width. */
  makeBowlerHatPath(width: number): string {
    const r = this.BOWLER_HAT_HEIGHT;
    return `a${r},${r} 0 0,1 ${r},-${r} h ${width - 2 * r} a${r},${r} 0 0,1 ${r},${r}`;
  }

  override getCSS_(selector: string): string[] {
    return [
      ...super.getCSS_(selector),
      // Scratch has no hover outline on editable fields and no selection glow.
      `${selector} .blocklyDraggable:not(.blocklyDisabled) .blocklyEditableField:not(.blocklyEditing):hover>rect,`,
      `${selector} .blocklyDraggable:not(.blocklyDisabled) .blocklyEditableField:not(.blocklyEditing):hover>.blocklyPath {`,
      `stroke: revert-layer;`,
      `stroke-width: 1;`,
      `}`,
      `${selector} .blocklySelected>.blocklyPath.blocklyPathSelected {`,
      `display: none;`,
      `}`,
      `${selector} .blocklyFlyoutLabelText {`,
      `font: bold 14pt ${BLOCK_FONT_FAMILY};`,
      `fill: #575E75;`,
      `}`,
    ];
  }
}

class BowlerHat extends Blockly.blockRendering.Hat {
  constructor(constants: AmbleConstants) {
    super(constants);
    this.width = 0; // Set to the block's width once it is known.
    this.height = constants.BOWLER_HAT_HEIGHT;
    this.ascenderHeight = this.height;
  }
}

class AmbleRenderInfo extends Blockly.zelos.RenderInfo {
  declare constants_: AmbleConstants;

  isBowlerHat(): boolean {
    return (this.block_ as BlockWithHat).hat === 'bowler';
  }

  protected override populateTopRow_() {
    if (!this.isBowlerHat()) {
      super.populateTopRow_();
      return;
    }
    const hat = new BowlerHat(this.constants_);
    this.topRow.elements.push(new Blockly.blockRendering.SquareCorner(this.constants_));
    this.topRow.elements.push(hat);
    this.topRow.elements.push(new Blockly.blockRendering.SquareCorner(this.constants_));
    this.topRow.minHeight = 0;
    this.topRow.capline = hat.ascenderHeight;
  }

  protected override populateBottomRow_() {
    super.populateBottomRow_();
    if (this.isBowlerHat()) this.bottomRow.minHeight = this.constants_.MEDIUM_PADDING;
  }

  protected override computeBounds_() {
    super.computeBounds_();
    if (!this.isBowlerHat()) return;
    const hat = this.topRow.elements.find((e) => Blockly.blockRendering.Types.isHat(e));
    if (hat) {
      hat.width = this.width;
      this.topRow.measure();
    }
  }

  override getInRowSpacing_(prev: Blockly.blockRendering.Measurable | null, next: Blockly.blockRendering.Measurable | null): number {
    if (this.isBowlerHat() && ((prev && Blockly.blockRendering.Types.isHat(prev)) || (next && Blockly.blockRendering.Types.isHat(next)))) return 0;
    return super.getInRowSpacing_(prev, next);
  }

  override getSpacerRowHeight_(prev: Blockly.blockRendering.Row, next: Blockly.blockRendering.Row): number {
    if (this.isBowlerHat() && prev === this.topRow) return 0;
    return super.getSpacerRowHeight_(prev, next);
  }
}

class AmbleDrawer extends Blockly.zelos.Drawer {
  declare constants_: AmbleConstants;
  declare info_: AmbleRenderInfo;

  protected override drawTop_() {
    super.drawTop_();
    if (this.info_.isBowlerHat()) {
      this.outlinePath_ = this.outlinePath_.replace(this.constants_.START_HAT.path, this.constants_.makeBowlerHatPath(this.info_.width));
    }
  }
}

class AmblePathObject extends Blockly.zelos.PathObject {
  /** Selected blocks look the same as the others, like in Scratch. */
  override updateSelected(enable: boolean) {
    this.setClass_('blocklySelected', enable);
  }
}

export class AmbleRenderer extends Blockly.zelos.Renderer {
  protected override makeConstants_(): AmbleConstants {
    return new AmbleConstants();
  }

  protected override makeRenderInfo_(block: Blockly.BlockSvg): AmbleRenderInfo {
    return new AmbleRenderInfo(this, block);
  }

  protected override makeDrawer_(block: Blockly.BlockSvg, info: Blockly.blockRendering.RenderInfo): AmbleDrawer {
    return new AmbleDrawer(block, info as AmbleRenderInfo);
  }

  override makePathObject(root: SVGElement, style: Blockly.Theme.BlockStyle): AmblePathObject {
    return new AmblePathObject(root, style, this.getConstants() as AmbleConstants);
  }

  /** Scratch never highlights statement connections: the insertion marker shows the spot. */
  override shouldHighlightConnection(connection: Blockly.RenderedConnection): boolean {
    return connection.type === Blockly.ConnectionType.INPUT_VALUE;
  }
}

let registered = false;

export function registerRenderer(): void {
  if (registered) return;
  registered = true;
  Blockly.blockRendering.register('amble', AmbleRenderer);
}
