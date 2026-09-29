/**
 * Pointer input for the drawing surface.
 * - Pen/mouse/finger samples come from `pointerrawupdate` with getCoalescedEvents(), drawn immediately under
 *   an adaptive budget: render now only if the last render ended at least clamp(2.5 x its smoothed cost,
 *   1, 12) ms ago, otherwise leave the samples for the next animation frame (a slow machine coalesces
 *   instead of starving its frames).
 * - Fingers: one draws; two pan, pinch and rotate (CSS transform during the gesture); a two-finger tap
 *   undoes and a three-finger tap redoes. A second finger within 150 ms of the first cancels the first
 *   finger's stroke (it was a pinch). Once a pen has been seen, fingers only navigate (palm rejection).
 * - Wheel: ctrl/cmd (trackpad pinch) zooms around the pointer; otherwise it pans. Space-drag and the
 *   middle button pan.
 */
import { type Point } from './geom';
import { type TouchSummary, type ViewState, classifyTap, rotateAt, snapRotation, twoFingerView, viewToDoc, zoomAt } from './view';

export type PointerKind = 'pen' | 'mouse' | 'touch';

export interface Sample {
  /** Document px. */
  x: number;
  y: number;
  /** View CSS px. */
  vx: number;
  vy: number;
  /** Raw pressure 0..1 (0.5 for mice). */
  p: number;
  /** Event time, ms (performance.now timebase). */
  t: number;
}

export interface DownInfo {
  kind: PointerKind;
  /** The pen's eraser end. */
  eraser: boolean;
  /** The pen's barrel button (pick a colour). */
  barrel: boolean;
  /** A finger tap for a tap tool (fill, eyedropper) is delivered on release, after the two-finger check. */
  deferredTap: boolean;
  /** Shift was held (a straight line from the last stroke's end; square boxes; 15° lines). */
  shift?: boolean;
}

/** What the surface does with input. */
export interface InputSink {
  /** Starts a tool interaction; returns false when nothing started. */
  down(s: Sample, info: DownInfo): boolean;
  move(samples: Sample[]): void;
  up(s: Sample | null, cancelled: boolean): void;
  /** Whether the current tool wants deferred finger taps (fill, eyedropper). */
  tapTool(): boolean;
  hover(s: Sample | null, kind: PointerKind): void;
  /** Engine + composite work for pending samples (called under the render budget). */
  render(): void;
  view(): ViewState;
  setView(v: ViewState): void;
  gestureStart(): void;
  gestureEnd(): void;
  undo(): void;
  redo(): void;
  key(e: KeyboardEvent, down: boolean): boolean;
  /** A brush stroke is in progress (Tap to ink keeps one going between two clicks). */
  isStroke(): boolean;
}

interface Touch {
  x: number;
  y: number;
  x0: number;
  y0: number;
}

/** Sticky for the session: once a pen draws, fingers stop drawing. */
let penSeen = false;

export function resetPalmRejection(): void {
  penSeen = false;
}

export class InputController {
  private readonly el: HTMLElement;
  private readonly sink: InputSink;
  private active: { id: number; kind: PointerKind; t0: number } | null = null;
  private touches = new Map<number, Touch>();
  private gesture: { ids: [number, number]; start: ViewState; a0: Point; b0: Point } | null = null;
  private tap: { t0: number; max: number; moved: boolean; used: boolean } | null = null;
  private pendingTap: { s: Sample; info: DownInfo } | null = null;
  private pan: { id: number; x: number; y: number; start: ViewState } | null = null;
  private spin: { id: number; a0: number; cx: number; cy: number; start: ViewState } | null = null;
  private spaceDown = false;
  private rDown = false;
  /** Tap to ink: a stroke started by a click follows the pointer until the next click. */
  tapToInk = false;
  private tapInk: { kind: PointerKind } | null = null;
  private pressAt: { x: number; y: number; t: number } | null = null;
  private rafPending = 0;
  private lastRenderEnd = -1e9;
  /** Smoothed cost of one render, ms. */
  renderCost = 0.5;
  private wheelTimer = 0;
  private readonly raw: boolean;
  private readonly off: Array<() => void> = [];
  /** Allow two-finger rotation. */
  rotate = true;
  /** Pending input timestamps, for the latency stat. */
  readonly pendingStamps: number[] = [];

  constructor(el: HTMLElement, sink: InputSink) {
    this.el = el;
    this.sink = sink;
    this.raw = 'onpointerrawupdate' in window;
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    (el.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e, false));
    on('pointercancel', (e) => this.onUp(e, true));
    on('lostpointercapture', (e) => {
      if (this.active && e.pointerId === this.active.id) this.onUp(e, false);
    });
    on('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && !this.active) this.sink.hover(null, e.pointerType as PointerKind);
    });
    if (this.raw) {
      const fn = (e: Event): void => this.onRaw(e as PointerEvent);
      el.addEventListener('pointerrawupdate', fn);
      this.off.push(() => el.removeEventListener('pointerrawupdate', fn));
    }
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('contextmenu', (e) => e.preventDefault());
    on('keydown', (e) => this.onKey(e, true));
    on('keyup', (e) => this.onKey(e, false));
    on('blur', () => {
      this.spaceDown = false;
      this.rDown = false;
      this.endTapInk(null);
    });
  }

  /** Ends a Tap to ink stroke (at `s`, or where it is). */
  endTapInk(s: Sample | null): void {
    if (!this.tapInk) return;
    this.tapInk = null;
    this.sink.up(s, false);
  }

  destroy(): void {
    for (const f of this.off) f();
    if (this.rafPending) cancelAnimationFrame(this.rafPending);
    clearTimeout(this.wheelTimer);
  }

  get drawing(): boolean {
    return this.active !== null;
  }

  get penSeen(): boolean {
    return penSeen;
  }

  private sample(e: PointerEvent, kind: PointerKind): Sample {
    const r = this.el.getBoundingClientRect();
    const vx = e.clientX - r.left;
    const vy = e.clientY - r.top;
    const d = viewToDoc(this.sink.view(), vx, vy);
    return { x: d.x, y: d.y, vx, vy, p: kind === 'pen' ? e.pressure : 0.5, t: e.timeStamp };
  }

  private onDown(e: PointerEvent): void {
    const kind = (e.pointerType || 'mouse') as PointerKind;
    this.el.focus({ preventScroll: true });
    if (kind === 'touch') {
      e.preventDefault();
      this.onTouchDown(e);
      return;
    }
    if (kind === 'pen') penSeen = true;
    if (this.tapInk) {
      // The click that ends a Tap to ink stroke.
      e.preventDefault();
      this.endTapInk(this.sample(e, this.tapInk.kind));
      return;
    }
    if (this.active || this.gesture) return;
    if (kind === 'mouse' && e.button === 1) {
      this.startPan(e);
      return;
    }
    if (this.spaceDown) {
      this.startPan(e);
      return;
    }
    if (this.rDown) {
      this.startSpin(e);
      return;
    }
    const barrel = kind === 'pen' && (e.button === 2 || (e.buttons & 2) !== 0);
    const eraser = kind === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (kind === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.begin(e, kind, { kind, eraser, barrel, deferredTap: false, shift: e.shiftKey });
  }

  private begin(e: PointerEvent, kind: PointerKind, info: DownInfo): void {
    const s = this.sample(e, kind);
    if (!this.sink.down(s, info)) return;
    this.pressAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.active = { id: e.pointerId, kind, t0: performance.now() };
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
    this.pendingStamps.push(e.timeStamp);
    this.renderNowOrLater();
  }

  private onTouchDown(e: PointerEvent): void {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (!this.tap) this.tap = { t0: performance.now(), max: 0, moved: false, used: false };
    this.tap.max = Math.max(this.tap.max, this.touches.size);
    // A pen stroke in progress: the palm is resting on the screen.
    if (this.active?.kind === 'pen') return;
    if (this.touches.size === 2) {
      if (this.active?.kind === 'touch') {
        if (performance.now() - this.active.t0 < 150) this.cancelActive();
        else return; // a second finger long after the first: keep drawing
      }
      this.pendingTap = null;
      this.pan = null;
      this.startGesture();
      return;
    }
    if (this.touches.size > 2) {
      this.pendingTap = null;
      return;
    }
    // One finger.
    if (penSeen) {
      this.startPan(e);
      return;
    }
    const s = this.sample(e, 'touch');
    const info: DownInfo = { kind: 'touch', eraser: false, barrel: false, deferredTap: this.sink.tapTool() };
    if (info.deferredTap) {
      this.pendingTap = { s, info };
      return;
    }
    this.begin(e, 'touch', info);
  }

  private startGesture(): void {
    const ids = [...this.touches.keys()].slice(0, 2) as [number, number];
    const a = this.touches.get(ids[0])!;
    const b = this.touches.get(ids[1])!;
    this.gesture = { ids, start: { ...this.sink.view() }, a0: { x: a.x, y: a.y }, b0: { x: b.x, y: b.y } };
    this.sink.gestureStart();
  }

  private startPan(e: PointerEvent): void {
    this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, start: { ...this.sink.view() } };
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    this.sink.gestureStart();
  }

  /** R-drag: turns the paper around the middle of the view. */
  private startSpin(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.spin = { id: e.pointerId, a0: Math.atan2(e.clientY - cy, e.clientX - cx), cx, cy, start: { ...this.sink.view() } };
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    this.sink.gestureStart();
  }

  private cancelActive(): void {
    if (!this.active) return;
    this.active = null;
    this.sink.up(null, true);
    if (this.tap) this.tap.used = false;
  }

  private onRaw(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.active.id) return;
    this.feed(e);
  }

  private feed(e: PointerEvent): void {
    const kind = this.active!.kind;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const src = list.length ? list : [e];
    const out: Sample[] = [];
    for (const c of src) out.push(this.sample(c, kind));
    this.sink.move(out);
    this.pendingStamps.push(e.timeStamp);
    this.renderNowOrLater();
  }

  /** Draw right away when the last draw was a while ago; otherwise let the next frame pick the samples up. */
  private renderNowOrLater(): void {
    const gap = Math.min(12, Math.max(1, this.renderCost * 2.5));
    if (performance.now() - this.lastRenderEnd >= gap) this.renderNow();
    else if (!this.rafPending)
      this.rafPending = requestAnimationFrame(() => {
        this.rafPending = 0;
        this.renderNow();
      });
  }

  renderNow(): void {
    if (this.rafPending) {
      cancelAnimationFrame(this.rafPending);
      this.rafPending = 0;
    }
    const t0 = performance.now();
    this.sink.render();
    const t1 = performance.now();
    this.lastRenderEnd = t1;
    this.renderCost += (t1 - t0 - this.renderCost) * 0.2;
  }

  private onMove(e: PointerEvent): void {
    const kind = (e.pointerType || 'mouse') as PointerKind;
    if (kind === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId)!;
      t.x = e.clientX;
      t.y = e.clientY;
      if (this.tap && Math.hypot(t.x - t.x0, t.y - t.y0) > 12) this.tap.moved = true;
      if (this.pendingTap && Math.hypot(t.x - t.x0, t.y - t.y0) > 12) this.pendingTap = null;
    }
    if (this.gesture) {
      const [ia, ib] = this.gesture.ids;
      const a = this.touches.get(ia);
      const b = this.touches.get(ib);
      if (a && b) this.sink.setView(twoFingerView(this.gesture.start, this.gesture.a0, this.gesture.b0, { x: a.x, y: a.y }, { x: b.x, y: b.y }, this.rotate));
      return;
    }
    if (this.pan && e.pointerId === this.pan.id) {
      const s = this.pan.start;
      this.sink.setView({ ...s, panX: s.panX + e.clientX - this.pan.x, panY: s.panY + e.clientY - this.pan.y });
      return;
    }
    if (this.spin && e.pointerId === this.spin.id) {
      const sp = this.spin;
      const r = this.el.getBoundingClientRect();
      const a = Math.atan2(e.clientY - sp.cy, e.clientX - sp.cx);
      const v = rotateAt(sp.start, a - sp.a0, sp.cx - r.left, sp.cy - r.top);
      this.sink.setView({ ...v, rot: snapRotation(v.rot) });
      return;
    }
    if (this.active && e.pointerId === this.active.id) {
      if (!this.raw) this.feed(e);
      return;
    }
    if (this.tapInk && kind === this.tapInk.kind && e.buttons === 0) {
      // Tap to ink: the stroke follows the pointer with no button held.
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      this.sink.move((list.length ? list : [e]).map((c) => this.sample(c, kind)));
      this.pendingStamps.push(e.timeStamp);
      this.renderNowOrLater();
      return;
    }
    if (!this.active && kind !== 'touch' && e.buttons === 0) this.sink.hover(this.sample(e, kind), kind);
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const kind = (e.pointerType || 'mouse') as PointerKind;
    if (this.active && e.pointerId === this.active.id) {
      const a = this.active;
      this.active = null;
      // Pen-up is timed as the commit, not as input latency.
      this.pendingStamps.length = 0;
      const p = this.pressAt;
      const click = !cancelled && p !== null && performance.now() - p.t < 350 && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6;
      if (this.tapToInk && click && a.kind !== 'touch' && this.sink.isStroke()) {
        // Tap to ink: that click started a stroke; it follows the pointer until the next click.
        this.tapInk = { kind: a.kind };
        try {
          this.el.releasePointerCapture(e.pointerId);
        } catch {
          // Synthetic pointers were never captured.
        }
      } else this.sink.up(cancelled ? null : this.sample(e, a.kind), false);
      if (this.tap) this.tap.used = true;
    }
    if (this.pan && e.pointerId === this.pan.id) {
      this.pan = null;
      this.sink.gestureEnd();
    }
    if (this.spin && e.pointerId === this.spin.id) {
      this.spin = null;
      this.sink.gestureEnd();
    }
    if (kind !== 'touch') return;
    this.touches.delete(e.pointerId);
    if (this.gesture && !(this.touches.has(this.gesture.ids[0]) && this.touches.has(this.gesture.ids[1]))) {
      this.gesture = null;
      this.sink.gestureEnd();
    }
    if (this.pendingTap && !cancelled && this.touches.size === 0) {
      const { s, info } = this.pendingTap;
      this.pendingTap = null;
      if (this.tap && this.tap.max === 1 && this.sink.down(s, info)) {
        this.sink.up(s, false);
        this.tap.used = true;
      }
    }
    if (this.touches.size === 0 && this.tap) {
      const t = this.tap;
      this.tap = null;
      const summary: TouchSummary = { maxFingers: t.max, duration: performance.now() - t.t0, moved: t.moved ? 99 : 0 };
      const act = t.used ? null : classifyTap(summary);
      if (act === 'undo') this.sink.undo();
      else if (act === 'redo') this.sink.redo();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.active) return;
    const r = this.el.getBoundingClientRect();
    const v = this.sink.view();
    if (!this.wheelTimer) this.sink.gestureStart();
    clearTimeout(this.wheelTimer);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
    if (e.ctrlKey || e.metaKey) this.sink.setView(zoomAt(v, Math.exp(-e.deltaY * unit * 0.01), e.clientX - r.left, e.clientY - r.top));
    else {
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
      this.sink.setView({ ...v, panX: v.panX - dx, panY: v.panY - dy });
    }
    this.wheelTimer = window.setTimeout(() => {
      this.wheelTimer = 0;
      this.sink.gestureEnd();
    }, 160);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.key === ' ' || e.code === 'Space') {
      this.spaceDown = down;
      e.preventDefault();
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.rDown = down;
      return;
    }
    if (down && this.tapInk && (e.key === 'Escape' || e.key === 'Enter')) {
      this.endTapInk(null);
      e.preventDefault();
      return;
    }
    if (this.sink.key(e, down)) e.preventDefault();
  }
}
