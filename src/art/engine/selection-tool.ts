/**
 * The lasso and rectangle selection tools: draw an outline, lift the pixels, then move (drag inside),
 * scale (corner handles), rotate (the round handle) or flip them, and put them down (commit), back
 * (cancel), away (delete) or onto a new body-part layer ("make this a part").
 *
 * A selection lifts the whole drawing there (every visible, unlocked lines, colors and paint layer), so
 * moving a head moves its lines and its colours together. Scope 'layer', or an active part, sketch or
 * trace layer, lifts just the active layer.
 */
import { type Point, type Rect, isEmpty, union } from './geom';
import type { Board } from './board';
import type { Compositor, SelectionOverlay } from './compositor';
import { copyIn } from './blend';
import { type History, type PixelChange, type Step, tilesOf } from './history';
import type { Affine6, LogTransform } from './log';
import { makeLayer, uid } from './model';
import { type Floating, IDENTITY, type SelectionTransform, apply, lift, matrixOf, mergeFloating, polygonMask, rectPolygon, stamp, stampInto, stampRect } from './select';
import { addLayer } from './structure';
import type { SelectionInfo } from './surface-types';
import { type ViewState, docToView } from './view';
import type { Sample } from './input';

/** What a selection lifts: the drawing (its lines, colors and paint layers together) or the active layer. */
export type SelectScope = 'drawing' | 'layer';

const DRAWING_ROLES: ReadonlySet<string> = new Set(['lines', 'colors', 'paint']);

/** The layers a selection lifts, bottom to top (visible and unlocked ones only). */
export function selectionLayers(board: Board, active: string, scope: SelectScope): string[] {
  const a = board.layer(active);
  if (!a) return [];
  if (scope === 'layer' || !DRAWING_ROLES.has(a.role)) return a.visible && !a.locked ? [active] : [];
  return board.layers.filter((l) => DRAWING_ROLES.has(l.role) && l.visible && !l.locked).map((l) => l.id);
}

export interface SelectionHost {
  readonly board: Board;
  readonly comp: Compositor;
  readonly history: History;
  frame(): string;
  layer(): string;
  scope(): SelectScope;
  view(): ViewState;
  preview(): { buf: Uint8ClampedArray; img: ImageData };
  /** Records a finished operation (history entry + log) and announces it. */
  commit(label: string, steps: Step[], op: LogTransform): void;
  setActiveLayer(id: string): void;
  canAddLayer(): boolean;
  toast(message: string): void;
  changed(info: SelectionInfo | null): void;
}

type Drag = { kind: 'move' | 'scale' | 'rotate'; start: SelectionTransform; p0: Point; d0: number; a0: number };

const HANDLE_HIT = 22; // view px (44 px targets)

/** One lifted layer, and its pixels as they were (the lifted box's tiles; commit adds where they land). */
interface Item {
  fl: Floating;
  before: PixelChange;
}

export class SelectionTool {
  private phase: 'idle' | 'drawing' | 'floating' = 'idle';
  private mode: 'lasso' | 'select' = 'lasso';
  private path: Point[] = [];
  private start: Point = { x: 0, y: 0 };
  private items: Item[] = [];
  /** The active layer when the pixels were lifted. */
  private owner = '';
  private t: SelectionTransform = { ...IDENTITY };
  private cx = 0;
  private cy = 0;
  private drag: Drag | null = null;
  private lastRect: Rect | null = null;

  constructor(private readonly host: SelectionHost) {}

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get floating(): boolean {
    return this.phase === 'floating';
  }

  info(): SelectionInfo | null {
    if (this.phase === 'idle') return null;
    const b = this.items[0]?.fl.box;
    return {
      layer: this.items.length ? this.owner : this.host.layer(),
      layers: this.items.map((it) => it.fl.layer),
      floating: this.phase === 'floating',
      transform: { ...this.t },
      box: b ? [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0] : [0, 0, 0, 0],
    };
  }

  private matrix(): Affine6 {
    return matrixOf(this.t, this.cx, this.cy);
  }

  // ------------------------------------------------------------------------------------------ pointer

  down(s: Sample, mode: 'lasso' | 'select'): boolean {
    if (this.phase === 'floating') {
      const hit = this.hitTest(s);
      if (hit) {
        const c = { x: this.cx + this.t.tx, y: this.cy + this.t.ty };
        this.drag = { kind: hit, start: { ...this.t }, p0: { x: s.x, y: s.y }, d0: Math.max(1, Math.hypot(s.x - c.x, s.y - c.y)), a0: Math.atan2(s.y - c.y, s.x - c.x) };
        return true;
      }
      this.commit();
    }
    this.mode = mode;
    this.phase = 'drawing';
    this.start = { x: s.x, y: s.y };
    this.path = [{ x: s.x, y: s.y }];
    this.overlay();
    return true;
  }

  move(s: Sample): void {
    if (this.phase === 'drawing') {
      if (this.mode === 'select') this.path = rectPolygon(this.start.x, this.start.y, s.x, s.y);
      else {
        const last = this.path[this.path.length - 1];
        const z = this.host.view().zoom;
        if (Math.hypot(s.x - last.x, s.y - last.y) * z >= 2) this.path.push({ x: s.x, y: s.y });
      }
      this.overlay();
      return;
    }
    const d = this.drag;
    if (this.phase !== 'floating' || !d) return;
    const c = { x: this.cx + d.start.tx, y: this.cy + d.start.ty };
    if (d.kind === 'move') this.t = { ...d.start, tx: d.start.tx + s.x - d.p0.x, ty: d.start.ty + s.y - d.p0.y };
    else if (d.kind === 'scale') {
      const k = Math.max(0.02, Math.hypot(s.x - c.x, s.y - c.y) / d.d0);
      this.t = { ...d.start, sx: d.start.sx * k, sy: d.start.sy * k };
    } else {
      let rot = d.start.rot + Math.atan2(s.y - c.y, s.x - c.x) - d.a0;
      const q = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      if (Math.abs(rot - q) < (3 * Math.PI) / 180) rot = q;
      this.t = { ...d.start, rot };
    }
  }

  up(): void {
    if (this.phase === 'drawing') {
      const poly = this.path;
      this.host.comp.overlays.lasso = null;
      this.invalidateOverlays();
      if (poly.length < 3 || Math.abs(area(poly)) < 4) {
        this.phase = 'idle';
        this.host.changed(null);
        return;
      }
      this.liftPolygon(poly);
      return;
    }
    if (this.drag) {
      this.drag = null;
      this.host.changed(this.info());
    }
  }

  /** Renders the floating pixels at the current transform (called under the render budget). */
  render(): void {
    if (this.phase !== 'floating' || !this.items.length) return;
    const { board, comp } = this.host;
    const m = this.matrix();
    const first = this.items[0].fl;
    const now = stampRect(first, m, board.W, board.H);
    const rect = union(now, this.lastRect ?? first.box);
    if (!isEmpty(rect)) {
      const { buf, img } = this.host.preview();
      let caches = false;
      for (const { fl } of this.items) {
        const src = board.pixels(fl.frame, fl.layer, true);
        for (let y = rect.y0; y < rect.y1; y++) buf.set(src.subarray((y * board.W + rect.x0) * 4, (y * board.W + rect.x1) * 4), (y * board.W + rect.x0) * 4);
        stampInto(buf, board.W, board.H, fl, m, board.pixelArt, rect);
        comp.showPreview(fl.layer, img, rect);
        if (fl.layer !== comp.active) caches = true;
      }
      if (caches) comp.rebuildCaches(rect);
      comp.invalidateDoc(rect);
    }
    this.lastRect = now;
    this.overlay();
  }

  // ------------------------------------------------------------------------------------------ actions

  selectAll(): void {
    if (this.phase === 'floating') this.commit();
    const { W, H } = this.host.board;
    this.liftPolygon(rectPolygon(0, 0, W, H));
  }

  private liftPolygon(poly: Point[]): void {
    const { board, history } = this.host;
    const frame = this.host.frame();
    const owner = this.host.layer();
    const ids = selectionLayers(board, owner, this.host.scope());
    const pm = ids.length ? polygonMask(poly, board.W, board.H, board.pixelArt) : null;
    const items: Item[] = [];
    if (pm) {
      const tiles = tilesOf(pm.box, board.W, board.H);
      for (const id of ids) {
        const before = history.snapshot(frame, id, tiles);
        const fl = lift(board, frame, id, poly, pm);
        if (fl) items.push({ fl, before });
      }
    }
    if (!items.length) {
      const l = board.layer(owner);
      this.phase = 'idle';
      this.host.toast(!ids.length && l?.locked ? 'This layer is locked' : !ids.length && l && !l.visible ? 'This layer is hidden' : 'Nothing to select there');
      this.host.changed(null);
      return;
    }
    const box = items[0].fl.box;
    this.items = items;
    this.owner = owner;
    this.t = { ...IDENTITY };
    this.cx = (box.x0 + box.x1) / 2;
    this.cy = (box.y0 + box.y1) / 2;
    this.lastRect = null;
    this.phase = 'floating';
    this.render();
    this.host.comp.flush();
    this.host.changed(this.info());
  }

  transform(patch: Partial<SelectionTransform>): void {
    if (this.phase !== 'floating') return;
    this.t = { ...this.t, ...patch };
    this.render();
    this.host.comp.flush();
    this.host.changed(this.info());
  }

  flip(axis: 'h' | 'v'): void {
    this.transform(axis === 'h' ? { sx: -this.t.sx } : { sy: -this.t.sy });
  }

  /** Puts the pixels down where they are (one undo step). */
  commit(): void {
    if (this.phase === 'drawing') {
      this.reset();
      return;
    }
    if (this.phase !== 'floating' || !this.items.length) return;
    const { board } = this.host;
    const m = this.matrix();
    const dest = stampRect(this.items[0].fl, m, board.W, board.H);
    for (const it of this.items) {
      this.coverBefore(it, dest);
      stamp(board, it.fl.frame, it.fl.layer, it.fl, m);
    }
    this.host.commit('Move', this.beforeSteps(), this.logOp('move', m));
    this.reset();
  }

  /** Puts everything back as it was (no undo step). */
  cancel(): void {
    if (this.phase === 'floating') {
      // The snapshots are not in the history yet, so their tiles are raw (never packed).
      const { board } = this.host;
      for (const { fl, before } of this.items) {
        const data = board.pixels(before.frame, before.layer, true);
        for (const t of before.tiles) copyIn(data, board.W, { x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h }, t.before instanceof Uint8ClampedArray ? t.before : null);
        board.changed(before.frame, before.layer, this.lastRect ? union(fl.box, this.lastRect) : fl.box);
      }
    }
    this.reset();
  }

  /** Throws the lifted pixels away (one undo step). */
  remove(): void {
    if (this.phase !== 'floating' || !this.items.length) return;
    for (const { fl } of this.items) if (this.lastRect) this.host.comp.layerChanged(fl.layer, this.lastRect);
    this.host.commit('Delete', this.beforeSteps(), this.logOp('delete', [1, 0, 0, 1, 0, 0]));
    this.reset();
  }

  /**
   * Moves the selection onto a new part:<name> layer above the layers it came from, merged into one piece
   * (lines, colours and shading together); returns the new layer id.
   */
  toPart(name: string): string | null {
    if (this.phase !== 'floating' || !this.items.length) return null;
    if (!this.host.canAddLayer()) {
      this.host.toast('That is a lot of layers! Merge some first.');
      return null;
    }
    const clean = name.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'part';
    const { board, history } = this.host;
    const frame = this.items[0].fl.frame;
    const m = this.matrix();
    const meta = makeLayer(uid('l'), `part:${clean}`, name.trim().slice(0, 40) || clean);
    const index = Math.max(...this.items.map((it) => board.layerIndex(it.fl.layer))) + 1;
    const add = addLayer(board, meta, index);
    const piece = mergeFloating(board, this.items.map((it) => it.fl));
    const dest = history.snapshot(frame, meta.id, tilesOf(stampRect(piece, m, board.W, board.H), board.W, board.H));
    stamp(board, frame, meta.id, piece, m);
    for (const { fl } of this.items) if (this.lastRect) this.host.comp.layerChanged(fl.layer, this.lastRect);
    this.host.commit('Make a part', [...this.beforeSteps(), { struct: add }, { pixels: dest }], { ...this.logOp('part', m), to: meta, index });
    this.reset();
    this.host.setActiveLayer(meta.id);
    return meta.id;
  }

  private beforeSteps(): Step[] {
    return this.items.map((it) => ({ pixels: it.before }));
  }

  /** Adds the tiles the pixels land on to the undo snapshot (outside the lifted box they are unchanged). */
  private coverBefore(it: Item, dest: Rect): void {
    const { board, history } = this.host;
    const have = new Set(it.before.tiles.map((t) => t.y * board.W + t.x));
    const extra = tilesOf(dest, board.W, board.H).filter((t) => !have.has(t.y0 * board.W + t.x0));
    if (extra.length) it.before.tiles.push(...history.snapshot(it.before.frame, it.before.layer, extra).tiles);
  }

  private logOp(action: LogTransform['action'], matrix: Affine6): LogTransform {
    const fl = this.items[0].fl;
    return { op: 'transform', layer: this.owner, layers: this.items.map((it) => it.fl.layer), frame: fl.frame, polygon: fl.polygon.map((p) => [p.x, p.y]), matrix, action };
  }

  private reset(): void {
    this.phase = 'idle';
    this.items = [];
    this.drag = null;
    this.lastRect = null;
    this.path = [];
    this.t = { ...IDENTITY };
    this.invalidateOverlays();
    this.host.comp.overlays.selection = null;
    this.host.comp.overlays.lasso = null;
    this.host.changed(null);
  }

  // ------------------------------------------------------------------------------------------ overlay

  private handles(): { corners: Point[]; rotate: Point; outline: Point[] } | null {
    const fl = this.items[0]?.fl;
    if (!fl) return null;
    const m = this.matrix();
    const b = fl.box;
    const corners = [apply(m, b.x0, b.y0), apply(m, b.x1, b.y0), apply(m, b.x1, b.y1), apply(m, b.x0, b.y1)];
    // Beyond the (local) top edge, away from the centre, 30 view px out.
    const top = apply(m, (b.x0 + b.x1) / 2, b.y0);
    const up = { x: -m[2], y: -m[3] };
    const len = Math.hypot(up.x, up.y) || 1;
    const k = 30 / this.host.view().zoom;
    const rotate = { x: top.x + (up.x / len) * k, y: top.y + (up.y / len) * k };
    return { corners, rotate, outline: fl.polygon.map((p) => apply(m, p.x, p.y)) };
  }

  private hitTest(s: Sample): Drag['kind'] | null {
    const h = this.handles();
    if (!h) return null;
    const v = this.host.view();
    const near = (p: Point): boolean => {
      const q = docToView(v, p.x, p.y);
      return Math.hypot(q.x - s.vx, q.y - s.vy) <= HANDLE_HIT;
    };
    if (near(h.rotate)) return 'rotate';
    if (h.corners.some(near)) return 'scale';
    if (pointInPolygon({ x: s.x, y: s.y }, h.corners)) return 'move';
    return null;
  }

  private overlay(): void {
    this.invalidateOverlays();
    const o = this.host.comp.overlays;
    if (this.phase === 'drawing') {
      o.lasso = this.mode === 'select' ? [...this.path, this.path[0]] : this.path;
      o.selection = null;
    } else if (this.phase === 'floating') {
      const h = this.handles();
      o.lasso = null;
      o.selection = h ? ({ outline: h.outline, handles: h.corners, rotate: h.rotate } satisfies SelectionOverlay) : null;
    }
    this.invalidateOverlays();
  }

  private invalidateOverlays(): void {
    const r = this.host.comp.overlayViewBounds();
    if (r) this.host.comp.invalidateView(r.x0, r.y0, r.x1, r.y1);
  }
}

function area(p: Point[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
