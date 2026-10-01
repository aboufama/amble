import * as Blockly from 'blockly/core';

/**
 * Block comments drawn the way Scratch draws them: a yellow note next to the block,
 * joined to it by a line, that can be moved, resized and minimized. There is no
 * comment icon on the block. Saved like Blockly's own comments (`icons.comment.text`).
 */

interface AmbleCommentState {
  text?: string;
  width?: number;
  height?: number;
  /** Position relative to the block. */
  x?: number;
  y?: number;
  collapsed?: boolean;
  /** Blockly's own comments saved this; old projects may have it. */
  pinned?: boolean;
}

/** Fired when a block comment moves, resizes or folds, so the project is saved (not undoable). */
class CommentLayoutChange extends Blockly.Events.BlockBase {
  override type = 'amble_comment_layout';
  override isBlank = false;
  constructor(block?: Blockly.BlockSvg) {
    super(block);
    this.recordUndo = false;
  }
  override run() {}
}
Blockly.registry.register(Blockly.registry.Type.EVENT, 'amble_comment_layout', CommentLayoutChange);

class AmbleCommentBubble extends Blockly.comments.CommentView {
  readonly id: string;
  private block: Blockly.BlockSvg | null;
  private anchor: Blockly.utils.Coordinate | null = null;
  private line: SVGLineElement | null = null;
  private dragStart: Blockly.utils.Coordinate | null = null;

  constructor(block: Blockly.BlockSvg) {
    super(block.workspace, `${block.id}_comment`);
    this.id = `${block.id}_comment`;
    this.block = block;
    this.setPlaceholderText(Blockly.Msg.WORKSPACE_COMMENT_DEFAULT_TEXT);
    this.getSvgRoot().classList.add('ambleBlockComment');
    // Notes float above the blocks (the block layer reorders itself, which would steal the text focus).
    this.workspace.getLayerManager()?.append(this, Blockly.layers.BUBBLE);
    // Typing goes straight to the text box, without Blockly moving focus to the block.
    this.getSvgRoot().addEventListener(
      'pointerdown',
      (e) => {
        if ((e.target as Element).closest('textarea')) e.stopPropagation();
      },
      true,
    );
    Blockly.browserEvents.conditionalBind(this.getSvgRoot(), 'pointerdown', this, (e: PointerEvent) => {
      const gesture = this.workspace.getGesture(e);
      if (gesture) gesture.handleBubbleStart(e, this as unknown as Blockly.IBubble);
    });
    // Scroll the workspace (not zoom) when the wheel turns over a note.
    Blockly.browserEvents.conditionalBind(this.getSvgRoot(), 'wheel', this, (e: WheelEvent) => e.stopPropagation());
  }

  // IBubble: a note is dragged on its own; it never deletes anything.
  isMovable() {
    return true;
  }
  setDragging() {}
  setDeleteStyle() {}
  showContextMenu() {}
  select() {}
  unselect() {}
  getId() {
    return this.id;
  }
  getSourceBlock() {
    return this.block;
  }
  getFocusableElement() {
    return this.getSvgRoot();
  }
  getFocusableTree() {
    return this.workspace;
  }
  onNodeFocus() {}
  onNodeBlur() {}
  canBeFocused() {
    return false;
  }
  /** The note's size when open (also while it is minimized). */
  fullSize(): Blockly.utils.Size {
    return (this as unknown as { size?: Blockly.utils.Size }).size ?? this.getSize();
  }

  getBoundingRectangle(): Blockly.utils.Rect {
    const xy = this.getRelativeToSurfaceXY();
    const size = this.getSize();
    return new Blockly.utils.Rect(xy.y, xy.y + size.height, xy.x, xy.x + size.width);
  }

  startDrag() {
    this.dragStart = this.getRelativeToSurfaceXY();
    this.workspace.setResizesEnabled(false);
    this.workspace.getLayerManager()?.moveToDragLayer(this);
    this.getSvgRoot().classList.add('blocklyDragging');
    return this as unknown as Blockly.IDraggable;
  }

  drag(to: Blockly.utils.Coordinate) {
    this.moveTo(to);
  }

  moveDuringDrag(to: Blockly.utils.Coordinate) {
    this.moveTo(to);
  }

  endDrag() {
    this.workspace.getLayerManager()?.moveOffDragLayer(this, Blockly.layers.BUBBLE);
    this.workspace.setResizesEnabled(true);
    this.getSvgRoot().classList.remove('blocklyDragging');
    if (this.block) Blockly.Events.fire(new CommentLayoutChange(this.block));
  }

  revertDrag() {
    if (this.dragStart) this.moveTo(this.dragStart);
  }

  override moveTo(to: Blockly.utils.Coordinate | number, y?: number) {
    super.moveTo(to instanceof Blockly.utils.Coordinate ? to : new Blockly.utils.Coordinate(to, y ?? 0));
    this.drawLine();
  }

  /** Keeps the note beside its block: the first time it is placed, then it follows the block. */
  setAnchor(anchor: Blockly.utils.Coordinate) {
    const old = this.anchor;
    this.anchor = anchor;
    if (!old) {
      const rtl = this.workspace.RTL ? -1 : 1;
      this.moveTo(new Blockly.utils.Coordinate(anchor.x + 40 * rtl, anchor.y - 16));
      this.line = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.LINE, { class: 'ambleCommentLine' });
      this.getSvgRoot().insertBefore(this.line, this.getSvgRoot().firstChild);
      if (this.block) this.line.style.stroke = this.block.getColourTertiary();
      this.drawLine();
      return;
    }
    const at = this.getRelativeToSurfaceXY();
    this.moveTo(Blockly.utils.Coordinate.sum(at, Blockly.utils.Coordinate.difference(anchor, old)));
  }

  private drawLine() {
    if (!this.line || !this.anchor) return;
    const at = this.getRelativeToSurfaceXY();
    this.line.setAttribute('x1', String(this.anchor.x - at.x));
    this.line.setAttribute('y1', String(this.anchor.y - at.y));
    this.line.setAttribute('x2', String((this.getSize().width / 2) * (this.workspace.RTL ? -1 : 1)));
    this.line.setAttribute('y2', '16');
  }

  override dispose() {
    if (this.disposing) return;
    this.disposing = true;
    this.line?.remove();
    const block = this.block;
    this.block = null;
    if (block && !block.isDeadOrDying()) block.setCommentText(null);
    super.dispose();
  }
}

class AmbleCommentIcon extends Blockly.icons.Icon implements Blockly.IHasBubble, Blockly.ISerializable {
  private readonly bubble: AmbleCommentBubble;

  constructor(protected override sourceBlock: Blockly.BlockSvg) {
    super(sourceBlock);
    this.bubble = new AmbleCommentBubble(sourceBlock);
    this.bubble.setSize(new Blockly.utils.Size(200, 200));
    this.bubble.addTextChangeListener((oldText, newText) => {
      Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(this.sourceBlock, 'comment', null, oldText, newText));
    });
    const layoutChanged = () => Blockly.Events.fire(new CommentLayoutChange(this.sourceBlock));
    this.bubble.addSizeChangeListener(layoutChanged);
    this.bubble.addOnCollapseListener(layoutChanged);
  }

  override getType(): Blockly.icons.IconType<AmbleCommentIcon> {
    return Blockly.icons.IconType.COMMENT as unknown as Blockly.icons.IconType<AmbleCommentIcon>;
  }

  /** No icon on the block. */
  override initView() {}

  /** Cancels the padding Blockly leaves for icons. */
  override getSize(): Blockly.utils.Size {
    return new Blockly.utils.Size(-8, 0);
  }

  private anchorPoint(): Blockly.utils.Coordinate {
    const rect = this.sourceBlock.getBoundingRectangleWithoutChildren();
    return new Blockly.utils.Coordinate(this.sourceBlock.workspace.RTL ? rect.left : rect.right, rect.top + this.offsetInBlock.y);
  }

  override onLocationChange(blockOrigin: Blockly.utils.Coordinate) {
    if (this.sourceBlock.isInsertionMarker()) {
      this.bubble.dispose();
      return;
    }
    super.onLocationChange(blockOrigin);
    this.bubble.setAnchor(this.anchorPoint());
  }

  setText(text: string) {
    this.bubble.setText(text);
  }
  getText(): string {
    return this.bubble.getText();
  }
  setBubbleSize(size: Blockly.utils.Size) {
    this.bubble.setSize(size);
  }
  getBubbleSize(): Blockly.utils.Size {
    return this.bubble.fullSize();
  }
  setBubbleLocation(location: Blockly.utils.Coordinate) {
    this.bubble.moveTo(location);
  }
  getBubbleLocation(): Blockly.utils.Coordinate {
    return this.bubble.getRelativeToSurfaceXY();
  }
  bubbleIsVisible(): boolean {
    return true;
  }
  setBubbleVisible(visible: boolean): Promise<void> {
    this.bubble.setCollapsed(!visible);
    return Promise.resolve();
  }
  getBubble(): Blockly.IBubble | null {
    return this.bubble as unknown as Blockly.IBubble;
  }
  override canBeFocused() {
    return false;
  }

  saveState(): AmbleCommentState {
    const size = this.bubble.fullSize();
    const offset = Blockly.utils.Coordinate.difference(this.bubble.getRelativeToSurfaceXY(), this.workspaceLocation);
    return { text: this.getText(), width: size.width, height: size.height, x: offset.x, y: offset.y, collapsed: this.bubble.isCollapsed() };
  }

  loadState(state: AmbleCommentState) {
    this.setText(state.text ?? '');
    if (state.width && state.height) this.bubble.setSizeWithoutFiringEvents(new Blockly.utils.Size(Math.max(state.width, 120), Math.max(state.height, 60)));
    if (typeof state.x === 'number' && typeof state.y === 'number') {
      this.bubble.moveTo(Blockly.utils.Coordinate.sum(this.workspaceLocation, new Blockly.utils.Coordinate(state.x, state.y)));
    }
    this.bubble.setCollapsed(Boolean(state.collapsed));
  }

  override dispose() {
    this.bubble.dispose();
    super.dispose();
  }
}

let registered = false;

export function registerComments(): void {
  if (registered) return;
  registered = true;
  Blockly.registry.register(Blockly.registry.Type.ICON, Blockly.icons.IconType.COMMENT.toString(), AmbleCommentIcon, true);
  Blockly.comments.CommentView.defaultCommentSize = new Blockly.utils.Size(200, 200);
}
