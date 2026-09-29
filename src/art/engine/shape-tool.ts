/**
 * The Shapes tool (§7.2): Line (Shift: 15° steps), Box (Shift: square), Circle (Shift: round) by dragging,
 * Curve by clicking points (a double click, Enter, Esc or a click back on the first or last point finishes
 * it). Outline shapes are drawn with the current Ink brush; filled ones are only filled (on the fill layer,
 * under the lines). A finished shape stays editable until the next tool: drag its handles to change it.
 *
 * Every shape also works from the keyboard: arrows move a crosshair (Shift: 10 px), Enter places a point,
 * Esc finishes. Previews are drawn as an overlay; only the finished shape is painted and logged (one op).
 */
import type { BrushId } from './brushes';
import type { Compositor } from './compositor';
import type { Point } from './geom';
import type { Sample } from './input';
import type { LogShape } from './log';
import { shapeOutline, curveCloses } from './shape';
import type { Symmetry } from './stroke';
import { type ViewState, docToView } from './view';

export type ShapeToolKind = 'line' | 'rect' | 'ellipse' | 'curve';

export interface ShapeToolState {
  kind: ShapeToolKind;
  filled: boolean;
}

export interface ShapeHost {
  readonly comp: Compositor;
  view(): ViewState;
  frame(): string;
  /** Board size (the crosshair stays on the board). */
  size(): { W: number; H: number };
  /** The outline's brush and colour. */
  style(): { brush: BrushId; size: number; opacity: number; color: string };
  mirror(): Symmetry | null;
  /** Where an outline goes and where a filled shape goes (null: nothing may be drawn there now). */
  outlineLayer(): string | null;
  fillLayer(): string | null;
  /** Paints and records the shape (one undo step). */
  commit(op: LogShape): void;
  /** Takes the last committed shape back (to edit it). */
  undo(): Promise<boolean>;
  /** The overlay changed (repaint). */
  changed(): void;
}

const HANDLE_HIT = 22; // view px (44 px targets)
const CLOSE_HIT = 14; // view px: a click this close to a curve's first or last point finishes it
const SNAP = (15 * Math.PI) / 180;

export class ShapeTool {
  state: ShapeToolState = { kind: 'line', filled: false };
  private phase: 'idle' | 'drag' | 'curve' | 'edit' | 'handle' = 'idle';
  private pts: Point[] = [];
  private hoverPt: Point | null = null;
  private shift = false;
  private handle = -1;
  /** The committed shape that is still editable (its op and kind). */
  private last: { op: LogShape; kind: ShapeToolKind; filled: boolean } | null = null;
  private undoing: Promise<boolean> | null = null;
  private crosshair: Point | null = null;
  private lastClick = 0;

  constructor(private readonly host: ShapeHost) {}

  /** A shape is being drawn or edited (the tool wants the keyboard). */
  get busy(): boolean {
    return this.phase !== 'idle' || this.crosshair !== null;
  }

  setState(s: Partial<ShapeToolState>): void {
    this.end();
    this.state = { kind: s.kind ?? this.state.kind, filled: s.filled ?? this.state.filled };
  }

  // ------------------------------------------------------------------------------------------ pointer

  down(s: Sample, shift: boolean): boolean {
    this.shift = shift;
    const p = { x: s.x, y: s.y };
    if (this.phase === 'edit') {
      const h = this.hit(s);
      if (h >= 0) {
        this.handle = h;
        this.phase = 'handle';
        // The shape comes off the page while it is being changed; it goes back on release.
        this.undoing = this.host.undo();
        this.render();
        return true;
      }
      this.end();
    }
    if (this.state.kind === 'curve') {
      const now = performance.now();
      if (this.phase === 'curve') {
        const doubleClick = now - this.lastClick < 350;
        this.lastClick = now;
        if (doubleClick || this.nearEnd(s)) {
          if (this.nearFirst(s) && this.pts.length >= 3) this.pts.push({ ...this.pts[0] });
          this.finishCurve();
          return true;
        }
        this.pts.push(p);
        this.render();
        return true;
      }
      this.lastClick = now;
      this.pts = [p];
      this.phase = 'curve';
      this.render();
      return true;
    }
    this.pts = [p, { ...p }];
    this.phase = 'drag';
    this.render();
    return true;
  }

  move(samples: Sample[]): void {
    const s = samples[samples.length - 1];
    if (!s) return;
    const p = { x: s.x, y: s.y };
    if (this.phase === 'drag') {
      this.pts[1] = this.constrain(this.pts[0], p);
      this.render();
    } else if (this.phase === 'handle' && this.last) {
      this.pts[this.handle] = this.last.kind === 'curve' ? p : this.constrain(this.pts[1 - this.handle] ?? p, p);
      this.render();
    }
  }

  up(s: Sample | null): void {
    if (this.phase === 'drag') {
      if (s) this.pts[1] = this.constrain(this.pts[0], { x: s.x, y: s.y });
      const [a, b] = this.pts;
      const v = this.host.view();
      if (Math.hypot(b.x - a.x, b.y - a.y) * v.zoom < 4) {
        // A click, not a drag: nothing to draw.
        this.phase = 'idle';
        this.pts = [];
        this.render();
        return;
      }
      void this.commit(this.state.kind, this.state.filled);
    } else if (this.phase === 'handle' && this.last) void this.commit(this.last.kind, this.last.filled);
  }

  /** The rubber band from the last curve point to the pointer. */
  hover(s: Sample | null): void {
    if (this.phase !== 'curve') return;
    this.hoverPt = s ? { x: s.x, y: s.y } : null;
    this.render();
  }

  // ------------------------------------------------------------------------------------------ keyboard

  /** Arrows move the crosshair, Enter places a point, Esc finishes. Returns true when the key was used. */
  key(e: KeyboardEvent): boolean {
    const { W, H } = this.host.size();
    if (e.key.startsWith('Arrow')) {
      const d = e.shiftKey ? 10 : 1;
      const c = this.crosshair ?? this.pts[this.pts.length - 1] ?? { x: W / 2, y: H / 2 };
      const x = Math.max(0, Math.min(W - 1, c.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0)));
      const y = Math.max(0, Math.min(H - 1, c.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0)));
      this.crosshair = { x, y };
      if (this.phase === 'drag') this.pts[1] = this.constrain(this.pts[0], this.crosshair);
      else if (this.phase === 'curve') this.hoverPt = this.crosshair;
      this.render();
      return true;
    }
    if (e.key === 'Enter') {
      if (this.crosshair) {
        const p = { ...this.crosshair };
        if (this.phase === 'edit') this.end();
        if (this.state.kind === 'curve') {
          if (this.phase === 'curve') this.pts.push(p);
          else {
            this.pts = [p];
            this.phase = 'curve';
          }
          this.crosshair = { ...p };
          this.render();
          return true;
        }
        if (this.phase === 'drag') {
          this.pts[1] = this.constrain(this.pts[0], p);
          void this.commit(this.state.kind, this.state.filled);
        } else {
          this.pts = [p, { ...p }];
          this.phase = 'drag';
          this.render();
        }
        return true;
      }
      if (this.phase === 'curve') {
        this.finishCurve();
        return true;
      }
      if (this.phase === 'edit') {
        this.end();
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') {
      if (this.phase === 'curve') this.finishCurve();
      else if (this.phase === 'drag') {
        this.phase = 'idle';
        this.pts = [];
      } else if (this.phase === 'edit') this.end();
      else if (!this.crosshair) return false;
      this.crosshair = null;
      this.render();
      return true;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.phase === 'curve' && this.pts.length > 1) {
      this.pts.pop();
      this.render();
      return true;
    }
    return false;
  }

  /** Finishes whatever is going on (a new tool, an undo, a save): the last shape stops being editable. */
  end(): void {
    if (this.phase === 'curve') this.finishCurve();
    if (this.phase === 'drag' || this.phase === 'handle') return;
    this.phase = 'idle';
    this.pts = [];
    this.last = null;
    this.hoverPt = null;
    this.crosshair = null;
    this.render();
  }

  // ------------------------------------------------------------------------------------------ inside

  private finishCurve(): void {
    if (this.pts.length >= 2) {
      void this.commit('curve', this.state.filled);
      return;
    }
    this.phase = 'idle';
    this.pts = [];
    this.hoverPt = null;
    this.render();
  }

  private async commit(kind: ShapeToolKind, filled: boolean): Promise<void> {
    if (this.undoing) {
      await this.undoing;
      this.undoing = null;
    }
    const pts = this.pts.map((p) => ({ ...p }));
    const fill = filled && kind !== 'line' && (kind !== 'curve' || curveCloses(pts));
    const layer = fill ? this.host.fillLayer() : this.host.outlineLayer();
    this.hoverPt = null;
    if (!layer) {
      this.phase = 'idle';
      this.pts = [];
      this.render();
      return;
    }
    const st = this.host.style();
    const op: LogShape = {
      op: 'shape',
      layer,
      frame: this.host.frame(),
      shape: kind === 'rect' ? 'rect' : kind === 'ellipse' ? 'ellipse' : kind,
      brush: st.brush,
      size: st.size,
      color: st.color,
      opacity: st.opacity,
      points: pts.map((p) => [Math.round(p.x * 8) / 8, Math.round(p.y * 8) / 8]),
      filled: fill,
      mirror: this.host.mirror(),
      ...(fill ? { outline: false } : {}),
    };
    this.host.commit(op);
    this.last = { op, kind, filled };
    this.pts = pts;
    this.phase = 'edit';
    this.render();
  }

  /** Shift: lines in 15° steps, squares and circles. */
  private constrain(a: Point, b: Point): Point {
    if (!this.shift) return b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const kind = this.last?.kind ?? this.state.kind;
    if (kind === 'line') {
      const len = Math.hypot(dx, dy);
      const ang = Math.round(Math.atan2(dy, dx) / SNAP) * SNAP;
      return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    }
    if (kind === 'rect' || kind === 'ellipse') {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
    }
    return b;
  }

  private hit(s: Sample): number {
    const v = this.host.view();
    let best = -1;
    let bd = HANDLE_HIT;
    this.pts.forEach((p, i) => {
      const q = docToView(v, p.x, p.y);
      const d = Math.hypot(q.x - s.vx, q.y - s.vy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private nearEnd(s: Sample): boolean {
    if (this.pts.length < 2) return false;
    const v = this.host.view();
    const last = docToView(v, this.pts[this.pts.length - 1].x, this.pts[this.pts.length - 1].y);
    return Math.hypot(last.x - s.vx, last.y - s.vy) < CLOSE_HIT || this.nearFirst(s);
  }

  private nearFirst(s: Sample): boolean {
    if (this.pts.length < 3) return false;
    const v = this.host.view();
    const first = docToView(v, this.pts[0].x, this.pts[0].y);
    return Math.hypot(first.x - s.vx, first.y - s.vy) < CLOSE_HIT;
  }

  private render(): void {
    const c = this.host.comp;
    const before = c.overlayViewBounds();
    c.overlays.shape = this.overlay();
    const after = c.overlayViewBounds();
    for (const r of [before, after]) if (r) c.invalidateView(r.x0, r.y0, r.x1, r.y1);
    this.host.changed();
  }

  private overlay(): Compositor['overlays']['shape'] {
    if (this.phase === 'idle' && !this.crosshair) return null;
    const kind = this.phase === 'edit' || this.phase === 'handle' ? this.last?.kind ?? this.state.kind : this.state.kind;
    const filled = this.phase === 'edit' || this.phase === 'handle' ? this.last?.filled ?? false : this.state.filled;
    const st = this.host.style();
    let pts = this.pts;
    if (this.phase === 'curve' && this.hoverPt) pts = [...pts, this.hoverPt];
    // A committed, editable shape is already on the page: only its handles show.
    const showPath = this.phase !== 'edit';
    const o = pts.length >= 2 && showPath ? shapeOutline(kind === 'rect' ? 'rect' : kind === 'ellipse' ? 'ellipse' : kind, pts) : null;
    const closed = kind === 'rect' || kind === 'ellipse' || (kind === 'curve' && curveCloses(pts));
    const fill = filled && closed;
    return {
      outline: o ? o.outline : pts.length === 1 && showPath ? [pts[0], pts[0]] : [],
      closed,
      color: st.color,
      width: fill ? 0 : st.size,
      filled: fill,
      handles: this.phase === 'edit' || this.phase === 'handle' || this.phase === 'curve' ? this.pts : [],
      crosshair: this.crosshair,
    };
  }
}
