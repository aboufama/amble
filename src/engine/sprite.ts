import type * as Phaser from 'phaser';
import type { SoundHandle, PlayOptions } from './audio';
import type { Coroutine, CoroutineOwner, TimerHandle } from './coroutines';
import type { Body, PhysicsOptions, Point } from './physics';
import { toStage, toWorld } from './physics';
import { parseColor, type Costume } from './visuals';
import { warnOnce } from './bridge';
import { normalizeKey } from './input';
import type { Game, TargetDef } from './game';

const DEG = Math.PI / 180;
let nextId = 1;

/** What sprite helpers accept as a target: a sprite, a sprite's name, "mouse", "random", or a point. */
export type TargetLike = Sprite | string | { x: number; y: number };

export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bounce' | 'elastic' | 'back';

export const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  back: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  bounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/** Set by the game while it constructs an instance, so `super()` without arguments still works. */
let constructing: { game: Game; def: TargetDef } | null = null;

export function withConstruction<T>(game: Game, def: TargetDef, fn: () => T): T {
  const prev = constructing;
  constructing = { game, def };
  try {
    return fn();
  } finally {
    constructing = prev;
  }
}

/** Shared by sprites and the stage: coroutines, timers, messages, sounds. */
export abstract class Entity implements CoroutineOwner {
  /** The running game: input, camera, ui, vars, spawning, messages... */
  readonly game: Game;
  /** The sprite's name as shown in the editor. */
  readonly name: string;
  /** Unique number for this instance. */
  readonly id: number;
  /** @internal */ readonly _def: TargetDef;
  /** @internal */ _destroyed = false;
  /** @internal Deleted this tick while showing: other sprites still touch it until the tick ends. */
  _goneThisTick = false;
  /** @internal */ _hookErrors: Map<string, number> = new Map();
  /** @internal Compiled scripts that are running, by method name. */
  _running = new Map<string, Coroutine>();
  private _subs: Array<() => void> = [];
  private _sounds = new Set<SoundHandle>();

  constructor(game?: Game, def?: TargetDef) {
    const ctx = game && def ? { game, def } : constructing;
    if (!ctx) throw new Error('Sprites are created by the game. Use this.game.spawn(name) instead of `new`.');
    this.game = ctx.game;
    this._def = ctx.def;
    this.name = ctx.def.name;
    this.id = nextId++;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  /**
   * @internal Starts one of this target's compiled scripts. If its trigger fires again while it
   * still runs, `restart` starts it over (clicks, messages) or leaves it running (keys, timers).
   */
  _script(method: string, restart: boolean, label?: string): Coroutine | null {
    const running = this._running.get(method);
    if (running && !running.done) {
      if (!restart) return running;
      running.stop();
    }
    const fn = (this as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function') return null;
    const co = this.game._scheduler.start(this, label ?? method, (fn as () => Generator<unknown, unknown, unknown>).call(this));
    this._running.set(method, co);
    return co;
  }

  /** @internal The ÷ block: dividing by zero gives 0 (never NaN or Infinity). */
  _divide(a: number, b: number): number {
    const q = Number(a) / Number(b);
    return Number.isFinite(q) ? q : 0;
  }

  /** @internal The compare block: numbers when both sides are numbers, otherwise words (ignoring case). */
  _compare(a: unknown, op: string, b: unknown): boolean {
    const x = Number(a);
    const y = Number(b);
    if (String(a ?? '').trim() !== '' && String(b ?? '').trim() !== '' && Number.isFinite(x) && Number.isFinite(y)) {
      return op === '<' ? x < y : op === '>' ? x > y : x === y;
    }
    const s = String(a ?? '').toLowerCase();
    const t = String(b ?? '').toLowerCase();
    return op === '<' ? s < t : op === '>' ? s > t : s === t;
  }

  // ---------- coroutines & timers (game clock) ----------

  /** Starts a coroutine: `this.run(function* () { ...; yield* this.wait(1); ... })`. */
  run(fn: (this: this) => Generator<unknown, unknown, unknown>): Coroutine {
    return this.game._scheduler.start(this, fn.name || 'run', fn.call(this));
  }

  /** Coroutine helper: `yield* this.wait(0.5)` pauses for 0.5 seconds of game time. */
  *wait(seconds: number): Generator<void, void, unknown> {
    const until = this.game.time + Math.max(0, Number(seconds) || 0);
    while (this.game.time < until - 1e-9) yield;
  }

  /** Coroutine helper: `yield* this.waitUntil(() => condition)`. Optional timeout in seconds. */
  *waitUntil(condition: () => unknown, timeout?: number): Generator<void, boolean, unknown> {
    const until = timeout === undefined ? Infinity : this.game.time + timeout;
    while (!condition()) {
      if (this.game.time >= until) return false;
      yield;
    }
    return true;
  }

  /** Calls `fn` once after `seconds` of game time. */
  after(seconds: number, fn: () => void): TimerHandle {
    return this.game._scheduler.after(this, this.game.time, seconds, fn.bind(this), 'after');
  }

  /** Calls `fn` every `seconds` of game time until this sprite is destroyed (or the handle is cancelled). */
  every(seconds: number, fn: () => void): TimerHandle {
    return this.game._scheduler.every(this, this.game.time, seconds, fn.bind(this), 'every');
  }

  /** Random number between min and max (inclusive integers if both are integers). */
  random(min: number, max: number): number {
    return this.game.random(min, max);
  }

  // ---------- messages ----------

  /** Sends a message to every sprite and the stage (their onMessage(name, data) and `on` listeners). */
  broadcast(name: string, data?: unknown): void {
    this.game.broadcast(name, data);
  }

  /** Coroutine helper: broadcasts and waits until every handler (including coroutines) has finished. */
  *broadcastAndWait(name: string, data?: unknown): Generator<void, void, unknown> {
    yield* this.game.broadcastAndWait(name, data);
  }

  /** Listens for a message; the listener is removed when this sprite is destroyed. */
  on(name: string, fn: (data: unknown) => unknown): () => void {
    const off = this.game.on(name, fn.bind(this), this);
    this._subs.push(off);
    return off;
  }

  // ---------- sound ----------

  /** @internal */
  _soundKey(name: string): string | null {
    return this.game._findSound(this._def, name);
  }

  /** Plays a sound by name (this sprite's sounds first, then the stage's, then anyone's). */
  playSound(name: string, opts: PlayOptions = {}): SoundHandle {
    const key = this._soundKey(name);
    if (!key) {
      warnOnce(`${this.name}: no sound named "${name}"`);
      return { stop() {}, playing: false };
    }
    const handle = this.game._audio.play(key, opts);
    this._sounds.add(handle);
    return handle;
  }

  /** Coroutine helper: plays a sound and waits until it finishes. */
  *playSoundUntilDone(name: string, opts: PlayOptions = {}): Generator<void, void, unknown> {
    const handle = this.playSound(name, opts);
    const key = this._soundKey(name);
    const length = key ? this.game._audio.duration(key) / Math.max(0.05, opts.pitch ?? 1) : 0;
    yield* this.wait(length);
    void handle;
  }

  /** Stops sounds started by this sprite. */
  stopSounds(): void {
    this._sounds.forEach((h) => h.stop());
    this._sounds.clear();
  }

  /** @internal */
  _teardown(): void {
    this._subs.forEach((off) => off());
    this._subs = [];
    this.stopSounds();
  }
}

export interface VectorLike {
  x: number;
  y: number;
  /** Sets both components at once. */
  set(x: number, y: number): void;
}

/**
 * Base class for every sprite. Compiled game code extends it:
 * `class Player extends Sprite { start() {...} update(dt) {...} }`.
 * Positions are stage pixels (0, 0 is the middle, y is up); angles are degrees counter-clockwise.
 */
export class Sprite extends Entity {
  /** True for instances created with clone()/spawn(). */
  isClone = false;
  /** This sprite's own variables ("for this sprite only"). Each copy gets its own copy. */
  vars: Record<string, any> = {};
  /** The Phaser image that draws this sprite (for Phaser's effects: postFX, blend modes, masks...). */
  image: Phaser.GameObjects.Image;
  /** @internal The same image (game code may reuse the name `image` for its own things). */ readonly _image: Phaser.GameObjects.Image;
  /** @internal */ _body: Body | null = null;
  /** @internal */ _physicsOpts: PhysicsOptions | null = null;
  /** @internal */ _vel: Point = { x: 0, y: 0 };
  private _x = 0;
  private _y = 0;
  private _costumeIndex = 0;
  private _size = 100;
  private _flipX = false;
  private _visible = true;
  private _layer = 0;
  private _opacity = 1;
  private _tint: string | null = null;
  private _angle = 0;
  private _rotationStyle: 'all around' | 'left-right' | "don't rotate" = 'all around';
  private _animation: Coroutine | null = null;
  private _walking: Coroutine | null = null;
  private _jumping: Coroutine | null = null;
  private _bubble: HTMLDivElement | null = null;
  private _velocityProxy: VectorLike;

  constructor(game?: Game, def?: TargetDef) {
    super(game, def);
    this._image = this.game.scene.add.image(0, 0, '__DEFAULT');
    this._image.setData('amble', this);
    this.image = this._image;
    const self = this;
    this._velocityProxy = {
      get x() {
        return self._readVelocity().x;
      },
      set x(v: number) {
        self.velocity = { x: v };
      },
      get y() {
        return self._readVelocity().y;
      },
      set y(v: number) {
        self.velocity = { y: v };
      },
      set(x: number, y: number) {
        self.velocity = { x, y };
      },
    };
    const init = this._def.run;
    this._x = Number(init.x) || 0;
    this._y = Number(init.y) || 0;
    this._rotationStyle = init.rotationStyle ?? 'all around';
    this._angle = normalizeDeg(init.direction);
    this._size = init.size;
    this._visible = init.visible;
    this._layer = init.layerOrder;
    this._costumeIndex = Math.max(0, Math.min(this._def.costumes.length - 1, (init.costumeNumber || 1) - 1));
    this._sync();
    this.game._register(this);
  }

  // ---------- position & rotation ----------

  /** Horizontal position in stage pixels (0 = center, right is +). */
  get x(): number {
    return this._x;
  }
  set x(v: number) {
    this._x = Number(v) || 0;
    this._moved();
  }
  /** Vertical position in stage pixels (up is +). */
  get y(): number {
    return this._y;
  }
  set y(v: number) {
    this._y = Number(v) || 0;
    this._moved();
  }
  /** Where the sprite is now, as { x, y }. */
  get position(): Point {
    return { x: this._x, y: this._y };
  }
  setPosition(x: number, y: number): void {
    this._x = Number(x) || 0;
    this._y = Number(y) || 0;
    this._moved();
  }

  /** Rotation in degrees, counter-clockwise, 0 = facing right, 90 = up. */
  get angle(): number {
    return this._angle;
  }
  set angle(deg: number) {
    this._angle = normalizeDeg(Number(deg) || 0);
    this._moved();
  }

  /** "all around" | "left-right" (only flips horizontally) | "don't rotate": how `angle` is drawn. */
  get rotationStyle(): string {
    return this._rotationStyle;
  }
  set rotationStyle(v: string) {
    this._rotationStyle = v === 'left-right' || v === "don't rotate" ? v : 'all around';
    this._moved();
  }

  /** Rotates by `degrees` (counter-clockwise). */
  turn(degrees: number): void {
    this.angle = this._angle + (Number(degrees) || 0);
  }

  /** Moves in the facing direction. */
  moveForward(distance: number): void {
    const d = Number(distance) || 0;
    const a = this._angle * DEG;
    this.setPosition(this._x + Math.cos(a) * d, this._y + Math.sin(a) * d);
  }

  /** Moves at a right angle to the facing direction (positive = to the right of it). */
  moveSideways(distance: number): void {
    const d = Number(distance) || 0;
    const a = (this._angle - 90) * DEG;
    this.setPosition(this._x + Math.cos(a) * d, this._y + Math.sin(a) * d);
  }

  /** Points at a target (sprite, sprite name, "mouse", or {x, y}). */
  pointTowards(target: TargetLike): void {
    const p = this.game._resolvePoint(target, this);
    if (!p || (p.x === this._x && p.y === this._y)) return;
    this.angle = Math.atan2(p.y - this._y, p.x - this._x) / DEG;
  }

  /** Direction to a target in degrees (counter-clockwise from facing right). */
  directionTo(target: TargetLike): number {
    const p = this.game._resolvePoint(target, this);
    return p ? Math.atan2(p.y - this._y, p.x - this._x) / DEG : this._angle;
  }

  /** Distance to a target (Infinity if it doesn't exist). */
  distanceTo(target: TargetLike): number {
    const p = this.game._resolvePoint(target, this);
    return p ? Math.hypot(p.x - this._x, p.y - this._y) : Infinity;
  }

  /** Moves up to `step` pixels toward a target. Returns true once it arrives. */
  moveTowards(target: TargetLike, step: number): boolean {
    const p = this.game._resolvePoint(target, this);
    if (!p) return false;
    const dx = p.x - this._x;
    const dy = p.y - this._y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step || dist === 0) {
      this.setPosition(p.x, p.y);
      return true;
    }
    const k = step / dist;
    this.setPosition(this._x + dx * k, this._y + dy * k);
    return false;
  }

  /** Jumps to a target (sprite, name, "mouse", "random", or {x, y}). */
  goTo(target: TargetLike): void {
    const p = this.game._resolvePoint(target, this);
    if (p) this.setPosition(p.x, p.y);
  }

  /** Coroutine helper: glides to a target over `seconds`. */
  *glideTo(target: TargetLike, seconds: number, ease: Ease = 'easeInOut'): Generator<void, void, unknown> {
    const p = this.game._resolvePoint(target, this);
    if (!p) return;
    yield* this.tween(this, { x: p.x, y: p.y }, seconds, ease);
  }

  /** Coroutine helper: animates numeric properties of any object, e.g. `yield* this.tween(this, { size: 150 }, 0.5)`. */
  *tween(target: object, props: Record<string, number>, seconds: number, ease: Ease = 'easeInOut'): Generator<void, void, unknown> {
    const obj = target as Record<string, number>;
    const from: Record<string, number> = {};
    for (const k of Object.keys(props)) from[k] = Number(obj[k]) || 0;
    const fn = EASES[ease] ?? EASES.easeInOut;
    const start = this.game.time;
    const total = Math.max(1e-6, Number(seconds) || 0);
    for (;;) {
      const t = Math.min(1, (this.game.time - start) / total);
      const e = fn(t);
      for (const k of Object.keys(props)) obj[k] = from[k] + (props[k] - from[k]) * e;
      if (t >= 1) return;
      yield;
    }
  }

  // ---------- looks ----------

  /** Current costume name. Set by name (or 1-based number) to switch. */
  get costume(): string {
    return this._def.costumes[this._costumeIndex]?.name ?? '';
  }
  set costume(value: string | number) {
    const list = this._def.costumes;
    if (!list.length) return;
    let index = -1;
    if (typeof value === 'number') index = Math.round(value) - 1;
    else {
      index = list.findIndex((c) => c.name === value);
      if (index < 0) index = list.findIndex((c) => c.name.toLowerCase() === String(value).toLowerCase());
    }
    if (index < 0 || index >= list.length) {
      warnOnce(`${this.name}: no costume named "${value}". Costumes: ${list.map((c) => c.name).join(', ')}`);
      return;
    }
    if (index === this._costumeIndex) return;
    this._costumeIndex = index;
    this._sync();
    this._refreshCollider();
  }
  /** Names of this sprite's costumes (yours first, then compiled ones). */
  get costumes(): string[] {
    return this._def.costumes.map((c) => c.name);
  }
  nextCostume(): void {
    const n = this._def.costumes.length;
    if (n) this.costume = ((this._costumeIndex + 1) % n) + 1;
  }
  previousCostume(): void {
    const n = this._def.costumes.length;
    if (n) this.costume = ((this._costumeIndex - 1 + n) % n) + 1;
  }

  /** Flip-book animation through costumes (default: all), `fps` frames per second. */
  animate(costumes?: string[], fps = 8, loop = true): void {
    this.stopAnimation();
    const frames = costumes?.length ? costumes : this.costumes;
    if (!frames.length) return;
    const self = this;
    this._animation = this.run(function* animation() {
      do {
        for (const frame of frames) {
          self.costume = frame;
          yield* self.wait(1 / Math.max(0.1, fps));
        }
      } while (loop);
    });
  }
  stopAnimation(): void {
    this._animation?.stop();
    this._animation = null;
  }

  /** Size in percent (100 = costume's natural size). */
  get size(): number {
    return this._size;
  }
  set size(v: number) {
    this._size = Math.max(0, Number(v) || 0);
    this._sync();
    this._refreshCollider();
  }
  /** Mirror horizontally. */
  get flipX(): boolean {
    return this._flipX;
  }
  set flipX(v: boolean) {
    if (this._flipX === Boolean(v)) return;
    this._flipX = Boolean(v);
    this._sync();
    this._refreshCollider();
  }
  get visible(): boolean {
    return this._visible;
  }
  set visible(v: boolean) {
    this._visible = Boolean(v);
    this._sync();
    if (!this._visible) this._hideBubble();
  }
  show(): void {
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  /** 0 = invisible, 1 = solid. */
  get opacity(): number {
    return this._opacity;
  }
  set opacity(v: number) {
    this._opacity = Math.max(0, Math.min(1, Number(v)));
    this._image.setAlpha(this._opacity);
  }
  /** Multiplies the costume's colors ("#ff8080" = reddish). null = none. */
  get tint(): string | null {
    return this._tint;
  }
  set tint(color: string | null) {
    this._tint = color || null;
    if (this._tint) this._image.setTint(parseColor(this._tint));
    else this._image.clearTint();
  }
  /** Draw order: higher layers draw on top. */
  get layer(): number {
    return this._layer;
  }
  set layer(v: number) {
    this._layer = Number(v) || 0;
    this._image.setDepth(this._layer);
  }
  bringToFront(): void {
    this.layer = this.game._maxLayer() + 1;
  }
  sendToBack(): void {
    this.layer = this.game._minLayer() - 1;
  }

  /** Speech bubble above the sprite. `say(null)` or `say("")` hides it. */
  say(text: unknown): void {
    const s = text === null || text === undefined ? '' : String(text);
    if (!s) {
      this._hideBubble();
      return;
    }
    if (!this._bubble) this._bubble = this.game.ui.createBubble();
    this._bubble.textContent = s;
    this._bubble.style.display = this._visible ? '' : 'none';
    this.game._bubbles.add(this);
  }
  /** Coroutine helper: says something for `seconds`. */
  *sayFor(text: unknown, seconds: number): Generator<void, void, unknown> {
    this.say(text);
    yield* this.wait(seconds);
    this.say('');
  }
  private _hideBubble(): void {
    if (this._bubble) this._bubble.style.display = 'none';
    this.game._bubbles.delete(this);
  }
  /** @internal */
  _updateBubble(): void {
    if (!this._bubble || this._bubble.style.display === 'none') return;
    const b = this.bounds();
    const screen = this.game._toScreen({ x: (b.left + b.right) / 2, y: b.top });
    // Keep the whole bubble on the stage; its tail still points at the sprite.
    const width = this._bubble.offsetWidth;
    const want = 240 + screen.x;
    const x = width ? Math.min(480 - 4 - width / 2, Math.max(4 + width / 2, want)) : want;
    this._bubble.style.left = `${x}px`;
    this._bubble.style.setProperty('--tail', width ? `${Math.min(width - 14, Math.max(14, width / 2 + want - x))}px` : '50%');
    this._bubble.style.top = `${180 - screen.y - 6}px`;
  }

  // ---------- sensing ----------

  /** Bounds of the current look, in stage coordinates (rotation included). */
  bounds(shrink = 1): { left: number; right: number; bottom: number; top: number } {
    if (!this._look()) return { left: this._x, right: this._x, bottom: this._y, top: this._y };
    const r = this._image.getBounds();
    let left = r.x - 240;
    let right = r.right - 240;
    let top = 180 - r.y;
    let bottom = 180 - r.bottom;
    if (shrink !== 1) {
      const sx = ((right - left) * (1 - shrink)) / 2;
      const sy = ((top - bottom) * (1 - shrink)) / 2;
      left += sx;
      right -= sx;
      bottom += sy;
      top -= sy;
    }
    return { left, right, bottom, top };
  }

  /**
   * Overlap test (no physics needed). Returns the first touching sprite (or null).
   * target: a sprite name, a sprite, an array of either, or nothing (any sprite).
   * Also: touching("edge") and touching("mouse") (true/false).
   */
  touching(target?: TargetLike | TargetLike[] | 'edge' | 'mouse'): Sprite | boolean | null {
    if (!this._visible || this._destroyed) return target === 'edge' || target === 'mouse' ? false : null;
    if (target === 'edge') return this._touchingEdge();
    if (target === 'mouse') return this.game._mouseOver(this);
    const candidates = this.game._candidates(target, this);
    const a = this.bounds(0.9);
    for (const other of candidates) {
      const b = other.bounds(0.9);
      if (a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom) return other;
    }
    return null;
  }

  private _touchingEdge(): boolean {
    const v = this.game.camera.view();
    const b = this.bounds();
    return b.left < v.left || b.right > v.right || b.bottom < v.bottom || b.top > v.top;
  }

  /** True when completely outside the visible area. */
  isOffStage(): boolean {
    const v = this.game.camera.view();
    const b = this.bounds();
    return b.right < v.left || b.left > v.right || b.top < v.bottom || b.bottom > v.top;
  }

  /** Pushes the sprite back inside the visible area. */
  keepOnStage(): void {
    const v = this.game.camera.view();
    const b = this.bounds();
    let dx = 0;
    let dy = 0;
    if (b.left < v.left) dx = v.left - b.left;
    else if (b.right > v.right) dx = v.right - b.right;
    if (b.bottom < v.bottom) dy = v.bottom - b.bottom;
    else if (b.top > v.top) dy = v.top - b.top;
    if (dx || dy) this.setPosition(this._x + dx, this._y + dy);
  }

  /** Bounces off the edges of the visible area (flips angle and velocity). Returns true if it bounced. */
  bounceOffEdges(): boolean {
    const v = this.game.camera.view();
    const b = this.bounds();
    let bounced = false;
    const vel = this.velocity;
    const a = this._angle;
    if ((b.left < v.left && Math.cos(a * DEG) < 0) || (b.right > v.right && Math.cos(a * DEG) > 0)) {
      this.angle = 180 - a;
      bounced = true;
    }
    const a2 = this._angle;
    if ((b.bottom < v.bottom && Math.sin(a2 * DEG) < 0) || (b.top > v.top && Math.sin(a2 * DEG) > 0)) {
      this.angle = -a2;
      bounced = true;
    }
    if ((b.left < v.left && vel.x < 0) || (b.right > v.right && vel.x > 0)) {
      vel.x = -vel.x;
      bounced = true;
    }
    if ((b.bottom < v.bottom && vel.y < 0) || (b.top > v.top && vel.y > 0)) {
      vel.y = -vel.y;
      bounced = true;
    }
    if (bounced) this.keepOnStage();
    return bounced;
  }

  // ---------- velocity & physics ----------

  /**
   * Velocity in pixels per second. Works with or without physics: without a body the engine
   * moves the sprite by velocity * dt every tick. `this.velocity.x = 200` or `this.velocity = {x: 0, y: 300}`.
   */
  get velocity(): VectorLike {
    return this._velocityProxy;
  }
  set velocity(v: { x?: number; y?: number }) {
    const cur = this._readVelocity();
    const next = { x: Number(v.x ?? cur.x) || 0, y: Number(v.y ?? cur.y) || 0 };
    if (this._isDynamic()) this.game._physics.setVelocity(this._body!, next);
    else this._vel = next;
  }

  private _isDynamic(): boolean {
    return Boolean(this._body && !this._body.isStatic);
  }

  private _readVelocity(): Point {
    return this._isDynamic() ? this.game._physics.velocityOf(this._body!) : { ...this._vel };
  }

  /**
   * Gives this sprite a physics body (Matter). Options: type ("dynamic" | "static" | "kinematic"),
   * shape ("box" | "circle" | "capsule"), mass, friction, bounce, fixedRotation, gravity, sensor, damping, scale.
   * Collisions call `onCollide(other, info)` on both sprites.
   */
  addPhysics(opts: PhysicsOptions = {}): Body {
    this.removePhysics();
    this._physicsOpts = { ...opts };
    this._body = this._createBody(opts);
    return this._body;
  }

  removePhysics(): void {
    if (this._body) this.game._physics.removeBody(this._body);
    this._body = null;
    this._physicsOpts = null;
  }

  /** The Matter physics body (null until addPhysics). */
  get body(): Body | null {
    return this._body;
  }

  /** Instant push (units: mass * velocity). Without physics it changes velocity directly. */
  applyImpulse(x: number, y: number): void {
    const dx = Number(x) || 0;
    const dy = Number(y) || 0;
    if (this._isDynamic()) {
      const m = this._body!.mass || 1;
      const v = this.game._physics.velocityOf(this._body!);
      this.game._physics.setVelocity(this._body!, { x: v.x + dx / m, y: v.y + dy / m });
    } else {
      this._vel = { x: this._vel.x + dx, y: this._vel.y + dy };
    }
  }

  /** Continuous push for this tick (units: mass * pixels per second squared). */
  applyForce(x: number, y: number): void {
    const fx = Number(x) || 0;
    const fy = Number(y) || 0;
    if (this._isDynamic()) this.game._physics.applyForce(this._body!, { x: fx, y: fy });
    else this._vel = { x: this._vel.x + fx * this.game.dt, y: this._vel.y + fy * this.game.dt };
  }

  /** True when standing on something solid (needs physics). */
  isOnGround(): boolean {
    if (!this._body) return false;
    const b = this.bounds();
    const cx = (b.left + b.right) / 2;
    const halfW = ((b.right - b.left) / 2) * 0.8;
    for (const x of [cx - halfW, cx, cx + halfW]) {
      if (this.game._physics.raycast({ x, y: b.bottom + 2 }, { x, y: b.bottom - 3 }, this._body).length) return true;
    }
    return false;
  }

  /** The collider: costume size, its middle relative to the rotation center (unrotated), all in stage pixels. */
  private _collider(): { width: number; height: number; dx: number; dy: number } {
    const look = this._look();
    if (!look) return { width: 1, height: 1, dx: 0, dy: 0 };
    const s = this._size / 100;
    const w = look.width * s;
    const h = look.height * s;
    return { width: w, height: h, dx: (0.5 - look.originX) * w * (this._drawnFlipped() ? -1 : 1), dy: -(0.5 - look.originY) * h };
  }

  /** The angle the look is drawn at. */
  private _drawnAngle(): number {
    return this._rotationStyle === 'all around' ? this._angle : 0;
  }

  private _bodyCenter(): Point {
    const c = this._collider();
    const a = this._drawnAngle() * DEG;
    return { x: this._x + c.dx * Math.cos(a) - c.dy * Math.sin(a), y: this._y + c.dx * Math.sin(a) + c.dy * Math.cos(a) };
  }

  private _createBody(opts: PhysicsOptions): Body {
    const c = this._collider();
    return this.game._physics.createBody(this, this._bodyCenter(), { width: c.width, height: c.height }, this._drawnAngle(), opts);
  }

  // ---------- ready-made game behaviors (the Game blocks) ----------

  /** Blocks measure distance in steps: one step is one pixel. */
  _fromSteps(steps: number): number {
    return Number(steps) || 0;
  }

  /**
   * From now on the player steers this sprite. controls: "arrow keys", "left and right arrows",
   * "WASD", "A and D" or "the mouse". speed: steps per second.
   */
  walkWith(controls = 'arrow keys', speed = 200): void {
    this._walking?.stop();
    const c = String(controls).toLowerCase();
    const letters = c === 'wasd' || c === 'a and d';
    const sideways = c === 'left and right arrows' || c === 'a and d';
    const mouse = c.includes('mouse');
    const v = this._fromSteps(speed);
    const input = this.game.input;
    this._walking = this.run(function* walk() {
      for (;;) {
        if (mouse) {
          this.moveTowards({ x: input.mouse.x, y: input.mouse.y }, v * this.game.dt);
        } else {
          const right = input.isDown(letters ? 'd' : 'right') ? 1 : 0;
          const left = input.isDown(letters ? 'a' : 'left') ? 1 : 0;
          const up = input.isDown(letters ? 'w' : 'up') ? 1 : 0;
          const down = input.isDown(letters ? 's' : 'down') ? 1 : 0;
          const dx = right - left;
          const dy = sideways ? 0 : up - down;
          this.velocity.x = dx * v;
          // With gravity, up and down belong to jumping and falling.
          if (!this._isDynamic()) this.velocity.y = dy * v;
          if (dx) this.flipX = dx < 0;
        }
        yield;
      }
    });
  }

  /** From now on the key makes this sprite jump when it stands on something. Turns on gravity. strength: steps per second upward. */
  jumpWith(key = 'space', strength = 600): void {
    this._jumping?.stop();
    if (!this._isDynamic()) this.fallWithGravity();
    const k = normalizeKey(key);
    const v = this._fromSteps(strength);
    this._jumping = this.run(function* jump() {
      for (;;) {
        if (this.game.input.wasPressed(k) && this.isOnGround()) this.velocity.y = v;
        yield;
      }
    });
  }

  /** Falls and lands on solid things. The bottom of the screen is solid too. */
  fallWithGravity(): void {
    if (!this._isDynamic()) this.addPhysics({ type: 'dynamic', fixedRotation: true });
    this.game._ensureFloor();
  }

  /** Others can stand on this sprite, like a floor or a platform. */
  beSolid(): void {
    this.addPhysics({ type: 'static' });
  }

  // ---------- spawning ----------

  /** Makes a copy of this sprite (like a Scratch clone) and runs its start(). Props override copied values. */
  clone(props: Record<string, unknown> = {}): Sprite | null {
    return this.game._cloneFrom(this, props);
  }

  /** Removes this sprite from the game (after onDestroy). */
  destroy(): void {
    this.game._destroy(this);
  }

  // ---------- internals ----------

  /** @internal The current costume. */
  _look(): Costume | null {
    return this._def.costumes[this._costumeIndex] ?? null;
  }

  private _drawnFlipped(): boolean {
    let flip = this._flipX;
    if (this._rotationStyle === 'left-right' && Math.cos(this._angle * DEG) < -1e-6) flip = !flip;
    return flip;
  }

  /** @internal Draws the sprite as it is now. */
  _sync(): void {
    const img = this._image;
    const look = this._look();
    if (!look) {
      img.setVisible(false);
      return;
    }
    if (img.texture.key !== look.key) img.setTexture(look.key);
    img.setOrigin(look.originX, look.originY);
    const s = this._size / 100 / look.density;
    img.setScale(this._drawnFlipped() ? -s : s, s);
    img.setAngle(-this._drawnAngle());
    const at = toWorld(this._x, this._y);
    img.setPosition(at.x, at.y);
    img.setDepth(this._layer);
    img.setVisible(this._visible && !this._destroyed);
  }

  /** @internal The sprite moved or turned (by code): draw it there, and take its body along. */
  _moved(): void {
    this._sync();
    if (this._body) {
      const kinematic = this._physicsOpts?.type === 'kinematic';
      this.game._physics.place(this._body, this._bodyCenter(), this._physicsOpts?.fixedRotation && !kinematic ? null : this._drawnAngle(), kinematic);
    }
  }

  /** @internal Integrates velocity for sprites without a dynamic body. */
  _integrate(dt: number): void {
    if (this._isDynamic()) return;
    const v = this._vel;
    if (v.x === 0 && v.y === 0) return;
    this.setPosition(this._x + v.x * dt, this._y + v.y * dt);
  }

  /** @internal After a physics step: a dynamic body moves the sprite. */
  _fromBody(): void {
    const body = this._body;
    if (!body || body.isStatic) return;
    const free = this._rotationStyle === 'all around' && !this._physicsOpts?.fixedRotation;
    if (free) this._angle = normalizeDeg((-body.angle * 180) / Math.PI);
    const c = this._collider();
    const a = this._drawnAngle() * DEG;
    const center = toStage(body.position.x, body.position.y);
    this._x = center.x - (c.dx * Math.cos(a) - c.dy * Math.sin(a));
    this._y = center.y - (c.dx * Math.sin(a) + c.dy * Math.cos(a));
    this._sync();
  }

  /** Rebuilds the collider after the size/flip/costume changed. */
  private _refreshCollider(): void {
    if (!this._body || !this._physicsOpts) return;
    const vel = this._readVelocity();
    this.game._physics.removeBody(this._body);
    this._body = this._createBody(this._physicsOpts);
    if (this._isDynamic()) this.game._physics.setVelocity(this._body, vel);
  }

  /** @internal */
  _dispose(): void {
    this._teardown();
    this.stopAnimation();
    this._hideBubble();
    this._bubble?.remove();
    this.removePhysics();
    this._image.destroy();
  }
}

/** Base class for the stage (game-wide scripts and backdrops): `class Level extends Stage { ... }`. */
export class Stage extends Entity {
  /** Current backdrop name. */
  get backdrop(): string {
    return this.game.backdrop;
  }
  set backdrop(name: string | number) {
    this.game.backdrop = name;
  }
  get backdrops(): string[] {
    return this.game._backdropNames();
  }
  nextBackdrop(): void {
    this.game.nextBackdrop();
  }
  /** @internal */
  _dispose(): void {
    this._teardown();
  }
}

export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
