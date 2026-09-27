import { Color3, PhysicsMotionType, Quaternion, TransformNode, Vector3, type AbstractMesh, type PhysicsBody } from './babylon';
import type { SoundHandle, PlayOptions } from './audio';
import type { Coroutine, CoroutineOwner, TimerHandle } from './coroutines';
import type { PhysicsOptions } from './physics';
import { SpriteVisual, type CostumeResource } from './visuals';
import { parseColor } from './effects';
import { warnOnce } from './bridge';
import { normalizeKey } from './input';
import type { Game, TargetDef } from './game';

const DEG = Math.PI / 180;
let nextId = 1;

/** What sprite helpers accept as a target: a sprite, a sprite's name, "mouse", "random", or a point. */
export type TargetLike = Sprite | string | { x: number; y: number; z?: number };

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

export interface VectorLike {
  x: number;
  y: number;
  z: number;
  /** Sets several components at once. */
  set(x: number, y: number, z?: number): void;
}

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

/**
 * Base class for every sprite. Compiled game code extends it:
 * `class Player extends Sprite { start() {...} update(dt) {...} }`.
 */
export class Sprite extends Entity {
  /** Root transform: position and rotation live here. Parent your own meshes to it. */
  readonly node: TransformNode;
  /** True for instances created with clone()/spawn(). */
  isClone = false;
  /** This sprite's own variables ("for this sprite only"). Each copy gets its own copy. */
  vars: Record<string, any> = {};
  /** @internal */ _visual: SpriteVisual;
  /** @internal */ _visualRoot: TransformNode;
  /** @internal */ _body: PhysicsBody | null = null;
  /** @internal */ _physicsOpts: PhysicsOptions | null = null;
  /** @internal */ _vel = new Vector3();
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
  private _tmp = new Vector3();

  constructor(game?: Game, def?: TargetDef) {
    super(game, def);
    const scene = this.game.scene;
    this.node = new TransformNode(`${this.name}#${this.id}`, scene);
    this.node.metadata = { amble: this };
    // Rotation always lives in a quaternion (physics bodies require it); use angle/heading/pitch/roll.
    this.node.rotationQuaternion = Quaternion.Identity();
    this._visualRoot = new TransformNode(`${this.name}#${this.id}:look`, scene);
    this._visualRoot.parent = this.node;
    this._visualRoot.metadata = { amble: this };
    this._visual = new SpriteVisual(this._visualRoot, this.game.mode, scene);
    this._visual.plane.metadata = { amble: this };
    const self = this;
    this._velocityProxy = {
      get x() {
        return self._readVelocity().x;
      },
      set x(v: number) {
        self._writeVelocity('x', v);
      },
      get y() {
        return self._readVelocity().y;
      },
      set y(v: number) {
        self._writeVelocity('y', v);
      },
      get z() {
        return self._readVelocity().z;
      },
      set z(v: number) {
        self._writeVelocity('z', v);
      },
      set(x: number, y: number, z?: number) {
        self.velocity = { x, y, z: z ?? self._readVelocity().z };
      },
    };
    const init = this._def.run;
    this.node.position.set(init.x, init.y, this.game.mode === '3d' ? init.z : 0);
    this._rotationStyle = init.rotationStyle ?? 'all around';
    if (this.game.mode === '2d') this._angle = normalizeDeg(init.direction);
    else this.node.rotationQuaternion = Quaternion.FromEulerAngles(0, init.direction * DEG, 0);
    this._size = init.size;
    this._visible = init.visible;
    this._layer = init.layerOrder;
    this._costumeIndex = Math.max(0, Math.min(this._def.costumes.length - 1, (init.costumeNumber || 1) - 1));
    this._applyLook();
    this._applyTransform();
    this.game._register(this);
  }

  // ---------- position & rotation ----------

  /** Horizontal position. 2D: stage pixels (0 = center, right is +). 3D: meters. */
  get x(): number {
    return this.node.position.x;
  }
  set x(v: number) {
    this.node.position.x = Number(v) || 0;
    this._moved();
  }
  /** Vertical position (up is +). 3D: height above the ground. */
  get y(): number {
    return this.node.position.y;
  }
  set y(v: number) {
    this.node.position.y = Number(v) || 0;
    this._moved();
  }
  /** 3D depth position (+z is away from the default camera). Always 0 in 2D. */
  get z(): number {
    return this.node.position.z;
  }
  set z(v: number) {
    if (this.game.mode === '2d') return;
    this.node.position.z = Number(v) || 0;
    this._moved();
  }
  /** Live position vector (Babylon Vector3). */
  get position(): Vector3 {
    return this.node.position;
  }
  setPosition(x: number, y: number, z?: number): void {
    this.node.position.set(Number(x) || 0, Number(y) || 0, this.game.mode === '3d' ? Number(z ?? this.z) || 0 : 0);
    this._moved();
  }

  /** 2D rotation in degrees, counter-clockwise, 0 = facing right, 90 = up. */
  get angle(): number {
    if (this.game.mode === '2d' && this._rotationStyle === 'all around') {
      return normalizeDeg(this._euler().z / DEG);
    }
    return this._angle;
  }
  set angle(deg: number) {
    this._angle = normalizeDeg(Number(deg) || 0);
    this._applyRotation2D();
    this._moved();
  }

  /** 3D facing in degrees around the up axis: 0 = +z (away from the default camera), 90 = +x (right). */
  get heading(): number {
    return normalizeDeg(this._euler().y / DEG);
  }
  set heading(deg: number) {
    const e = this._euler();
    this._setEuler(e.x, (Number(deg) || 0) * DEG, e.z);
  }
  /** 3D tilt up/down in degrees (positive = nose down). */
  get pitch(): number {
    return normalizeDeg(this._euler().x / DEG);
  }
  set pitch(deg: number) {
    const e = this._euler();
    this._setEuler((Number(deg) || 0) * DEG, e.y, e.z);
  }
  /** 3D roll in degrees. */
  get roll(): number {
    return normalizeDeg(this._euler().z / DEG);
  }
  set roll(deg: number) {
    const e = this._euler();
    this._setEuler(e.x, e.y, (Number(deg) || 0) * DEG);
  }

  private _euler(): Vector3 {
    return (this.node.rotationQuaternion ?? Quaternion.Identity()).toEulerAngles();
  }

  private _setEuler(x: number, y: number, z: number): void {
    this.node.rotationQuaternion = Quaternion.FromEulerAngles(x, y, z);
    this._moved();
  }

  private _applyRotation2D(): void {
    if (this.game.mode !== '2d') return;
    const z = this._rotationStyle === 'all around' ? this._angle * DEG : 0;
    this.node.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, z);
    this._applyScale();
  }

  /** "all around" | "left-right" (only flips horizontally) | "don't rotate". Affects how `angle` is drawn in 2D. */
  get rotationStyle(): string {
    return this._rotationStyle;
  }
  set rotationStyle(v: string) {
    const current = this.angle;
    this._rotationStyle = v === 'left-right' || v === "don't rotate" ? v : 'all around';
    this._angle = current;
    this._applyRotation2D();
    this._moved();
  }

  /** Rotates by `degrees` (2D: counter-clockwise; 3D: turns right for positive values). */
  turn(degrees: number): void {
    if (this.game.mode === '2d') this.angle = this.angle + (Number(degrees) || 0);
    else this.heading = this.heading + (Number(degrees) || 0);
  }

  /** Moves in the facing direction (2D: angle, 3D: heading). */
  moveForward(distance: number): void {
    const d = Number(distance) || 0;
    if (this.game.mode === '2d') {
      const a = this.angle * DEG;
      this.setPosition(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d);
    } else {
      const h = this.heading * DEG;
      this.setPosition(this.x + Math.sin(h) * d, this.y, this.z + Math.cos(h) * d);
    }
  }

  /** 3D: moves to the right of the facing direction (negative = left). 2D: moves perpendicular to angle. */
  moveSideways(distance: number): void {
    const d = Number(distance) || 0;
    if (this.game.mode === '2d') {
      const a = (this.angle - 90) * DEG;
      this.setPosition(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d);
    } else {
      const h = (this.heading + 90) * DEG;
      this.setPosition(this.x + Math.sin(h) * d, this.y, this.z + Math.cos(h) * d);
    }
  }

  /** Points at a target (sprite, sprite name, "mouse", or {x, y, z}). */
  pointTowards(target: TargetLike): void {
    const p = this.game._resolvePoint(target, this);
    if (!p) return;
    if (this.game.mode === '2d') {
      if (p.x === this.x && p.y === this.y) return;
      this.angle = Math.atan2(p.y - this.y, p.x - this.x) / DEG;
    } else {
      if (p.x === this.x && p.z === this.z) return;
      this.heading = Math.atan2(p.x - this.x, p.z - this.z) / DEG;
    }
  }

  /** Direction to a target: 2D angle or 3D heading, in degrees. */
  directionTo(target: TargetLike): number {
    const p = this.game._resolvePoint(target, this);
    if (!p) return this.game.mode === '2d' ? this.angle : this.heading;
    return this.game.mode === '2d' ? Math.atan2(p.y - this.y, p.x - this.x) / DEG : Math.atan2(p.x - this.x, p.z - this.z) / DEG;
  }

  /** Distance to a target (Infinity if it doesn't exist). */
  distanceTo(target: TargetLike): number {
    const p = this.game._resolvePoint(target, this);
    if (!p) return Infinity;
    const dz = this.game.mode === '3d' ? p.z - this.z : 0;
    return Math.hypot(p.x - this.x, p.y - this.y, dz);
  }

  /** Moves up to `step` units toward a target. Returns true once it arrives. */
  moveTowards(target: TargetLike, step: number): boolean {
    const p = this.game._resolvePoint(target, this);
    if (!p) return false;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dz = this.game.mode === '3d' ? p.z - this.z : 0;
    const dist = Math.hypot(dx, dy, dz);
    if (dist <= step || dist === 0) {
      this.setPosition(p.x, p.y, p.z);
      return true;
    }
    const k = step / dist;
    this.setPosition(this.x + dx * k, this.y + dy * k, this.z + dz * k);
    return false;
  }

  /** Jumps to a target (sprite, name, "mouse", "random", or {x, y, z}). */
  goTo(target: TargetLike): void {
    const p = this.game._resolvePoint(target, this);
    if (p) this.setPosition(p.x, p.y, p.z);
  }

  /** Coroutine helper: glides to a target over `seconds`. */
  *glideTo(target: TargetLike, seconds: number, ease: Ease = 'easeInOut'): Generator<void, void, unknown> {
    const p = this.game._resolvePoint(target, this);
    if (!p) return;
    yield* this.tween(this, { x: p.x, y: p.y, ...(this.game.mode === '3d' ? { z: p.z } : {}) }, seconds, ease);
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
    this._costumeIndex = index;
    this._applyLook();
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
    this._applyScale();
    this._refreshCollider();
  }
  /** Mirror horizontally (2D and 3D cutouts). */
  get flipX(): boolean {
    return this._flipX;
  }
  set flipX(v: boolean) {
    this._flipX = Boolean(v);
    this._applyScale();
    this._refreshCollider();
  }
  get visible(): boolean {
    return this._visible;
  }
  set visible(v: boolean) {
    this._visible = Boolean(v);
    this._visualRoot.setEnabled(this._visible);
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
    this._visual.opacity = this._opacity;
  }
  /** Multiplies the costume's colors ("#ff8080" = reddish). null = none. */
  get tint(): string | null {
    return this._tint;
  }
  set tint(color: string | null) {
    this._tint = color || null;
    this._visual.tint = this._tint ? parseColor(this._tint) : null;
  }
  /** 2D draw order: higher layers draw on top. */
  get layer(): number {
    return this._layer;
  }
  set layer(v: number) {
    this._layer = Number(v) || 0;
    this._visual.layer = this._layer;
  }
  bringToFront(): void {
    this.layer = this.game._maxLayer() + 1;
  }
  sendToBack(): void {
    this.layer = this.game._minLayer() - 1;
  }
  /** The mesh showing the current costume (Babylon AbstractMesh). */
  get mesh(): AbstractMesh | null {
    return this._visual.meshes()[0] ?? null;
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
    const screen = this.game._toScreen(this._visual.topPoint());
    if (!screen) {
      this._bubble.style.visibility = 'hidden';
      return;
    }
    this._bubble.style.visibility = '';
    this._bubble.style.left = `${240 + screen.x}px`;
    this._bubble.style.top = `${180 - screen.y - 6}px`;
  }

  // ---------- sensing ----------

  /** World-space bounds of the current look. */
  bounds(shrink = 1): { left: number; right: number; bottom: number; top: number; back: number; front: number } {
    const meshes = this._visual.meshes();
    this.node.computeWorldMatrix(true);
    this._visualRoot.computeWorldMatrix(true);
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      minX = Math.min(minX, bb.minimumWorld.x);
      minY = Math.min(minY, bb.minimumWorld.y);
      minZ = Math.min(minZ, bb.minimumWorld.z);
      maxX = Math.max(maxX, bb.maximumWorld.x);
      maxY = Math.max(maxY, bb.maximumWorld.y);
      maxZ = Math.max(maxZ, bb.maximumWorld.z);
    }
    if (!Number.isFinite(minX)) {
      const p = this.node.position;
      return { left: p.x, right: p.x, bottom: p.y, top: p.y, back: p.z, front: p.z };
    }
    if (shrink !== 1) {
      const sx = ((maxX - minX) * (1 - shrink)) / 2;
      const sy = ((maxY - minY) * (1 - shrink)) / 2;
      const sz = ((maxZ - minZ) * (1 - shrink)) / 2;
      minX += sx;
      maxX -= sx;
      minY += sy;
      maxY -= sy;
      minZ += sz;
      maxZ -= sz;
    }
    return { left: minX, right: maxX, bottom: minY, top: maxY, back: minZ, front: maxZ };
  }

  /**
   * Overlap test (no physics needed). Returns the first touching sprite (or null).
   * target: a sprite name, a sprite, an array of either, or nothing (any sprite).
   * Also: touching("edge") (2D, true/false) and touching("mouse") (true/false).
   */
  touching(target?: TargetLike | TargetLike[] | 'edge' | 'mouse'): Sprite | boolean | null {
    if (!this._visible || this._destroyed) return target === 'edge' || target === 'mouse' ? false : null;
    if (target === 'edge') return this.game.mode === '2d' ? this._touchingEdge() : false;
    if (target === 'mouse') return this.game._mouseOver(this);
    const candidates = this.game._candidates(target, this);
    const a = this.bounds(0.9);
    const is3d = this.game.mode === '3d';
    for (const other of candidates) {
      const b = other.bounds(0.9);
      if (a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom && (!is3d || (a.back < b.front && a.front > b.back))) {
        return other;
      }
    }
    return null;
  }

  private _touchingEdge(): boolean {
    const v = this.game.camera.view();
    const b = this.bounds();
    return b.left < v.left || b.right > v.right || b.bottom < v.bottom || b.top > v.top;
  }

  /** 2D: true when completely outside the visible area. */
  isOffStage(): boolean {
    if (this.game.mode !== '2d') return false;
    const v = this.game.camera.view();
    const b = this.bounds();
    return b.right < v.left || b.left > v.right || b.top < v.bottom || b.bottom > v.top;
  }

  /** 2D: pushes the sprite back inside the visible area. */
  keepOnStage(): void {
    if (this.game.mode !== '2d') return;
    const v = this.game.camera.view();
    const b = this.bounds();
    let dx = 0;
    let dy = 0;
    if (b.left < v.left) dx = v.left - b.left;
    else if (b.right > v.right) dx = v.right - b.right;
    if (b.bottom < v.bottom) dy = v.bottom - b.bottom;
    else if (b.top > v.top) dy = v.top - b.top;
    if (dx || dy) this.setPosition(this.x + dx, this.y + dy);
  }

  /** 2D: bounces off the edges of the visible area (flips angle and velocity). Returns true if it bounced. */
  bounceOffEdges(): boolean {
    if (this.game.mode !== '2d') return false;
    const v = this.game.camera.view();
    const b = this.bounds();
    let bounced = false;
    const vel = this.velocity;
    const a = this.angle;
    if ((b.left < v.left && Math.cos(a * DEG) < 0) || (b.right > v.right && Math.cos(a * DEG) > 0)) {
      this.angle = 180 - a;
      bounced = true;
    }
    const a2 = this.angle;
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
   * Velocity in units per second. Works with or without physics: without a body the engine
   * moves the sprite by velocity * dt every tick. `this.velocity.x = 200` or `this.velocity = {x: 0, y: 300}`.
   */
  get velocity(): VectorLike {
    return this._velocityProxy;
  }
  set velocity(v: { x?: number; y?: number; z?: number }) {
    const cur = this._readVelocity().clone();
    const next = new Vector3(v.x ?? cur.x, v.y ?? cur.y, this.game.mode === '3d' ? (v.z ?? cur.z) : 0);
    if (this._isDynamic()) this._body!.setLinearVelocity(next);
    else this._vel.copyFrom(next);
  }

  private _isDynamic(): boolean {
    return Boolean(this._body && !this._body.isDisposed && this._body.getMotionType() === PhysicsMotionType.DYNAMIC);
  }

  private _readVelocity(): Vector3 {
    if (this._isDynamic()) {
      this._body!.getLinearVelocityToRef(this._tmp);
      return this._tmp;
    }
    return this._vel;
  }

  private _writeVelocity(axis: 'x' | 'y' | 'z', value: number): void {
    if (axis === 'z' && this.game.mode === '2d') return;
    const v = Number(value) || 0;
    if (this._isDynamic()) {
      this._body!.getLinearVelocityToRef(this._tmp);
      this._tmp[axis] = v;
      this._body!.setLinearVelocity(this._tmp);
    } else {
      this._vel[axis] = v;
    }
  }

  /**
   * Gives this sprite a physics body (Havok). Options: type ("dynamic" | "static" | "kinematic"),
   * shape ("box" | "circle" | "capsule"), mass, friction, bounce, fixedRotation, gravity, sensor, damping, scale.
   * Collisions call `onCollide(other, info)` on both sprites.
   */
  addPhysics(opts: PhysicsOptions = {}): PhysicsBody {
    this.removePhysics();
    this._physicsOpts = { ...opts };
    const { size, center } = this._colliderGeometry();
    this._body = this.game._physics.createBody(this.node, size, center, opts);
    if (!this._isDynamic() && this._vel.lengthSquared() === 0) this._vel.setAll(0);
    return this._body;
  }

  removePhysics(): void {
    if (this._body && !this._body.isDisposed) this._body.dispose();
    this._body = null;
    this._physicsOpts = null;
  }

  /** The Havok physics body (null until addPhysics). */
  get body(): PhysicsBody | null {
    return this._body;
  }

  /** Instant push (units: mass * velocity). Without physics it changes velocity directly. */
  applyImpulse(x: number, y: number, z = 0): void {
    const v = new Vector3(Number(x) || 0, Number(y) || 0, this.game.mode === '3d' ? Number(z) || 0 : 0);
    if (this._isDynamic()) this._body!.applyImpulse(v, this._body!.getObjectCenterWorld());
    else this._vel.addInPlace(v);
  }

  /** Continuous push for this tick. */
  applyForce(x: number, y: number, z = 0): void {
    const v = new Vector3(Number(x) || 0, Number(y) || 0, this.game.mode === '3d' ? Number(z) || 0 : 0);
    if (this._isDynamic()) this._body!.applyForce(v, this._body!.getObjectCenterWorld());
    else this._vel.addInPlace(v.scale(this.game.dt));
  }

  /** True when standing on something (physics bodies), or on the ground plane (3D without physics). */
  isOnGround(): boolean {
    const b = this.bounds();
    if (!this._body) return this.game.mode === '3d' ? this.y <= 0.001 : false;
    const is2d = this.game.mode === '2d';
    const reach = is2d ? 3 : 0.08;
    const up = is2d ? 2 : 0.05;
    const cx = (b.left + b.right) / 2;
    const cz = is2d ? 0 : (b.back + b.front) / 2;
    const halfW = ((b.right - b.left) / 2) * 0.8;
    const xs = [cx - halfW, cx, cx + halfW];
    for (const x of xs) {
      const hit = this.game._physics.raycast(new Vector3(x, b.bottom + up, cz), new Vector3(x, b.bottom - reach, cz), this._body);
      if (hit.hasHit) return true;
    }
    return false;
  }

  private _colliderGeometry(): { size: { width: number; height: number; depth: number }; center: Vector3 } {
    const s = this._size / 100;
    const look = this._def.costumes[this._costumeIndex];
    const is2d = this.game.mode === '2d';
    if (!look) return { size: { width: 1, height: 1, depth: 1 }, center: Vector3.Zero() };
    if (look.kind === 'image') {
      const w = look.width * s;
      const h = look.height * s;
      const center = is2d ? new Vector3(look.offsetX * s * (this._flipX ? -1 : 1), look.offsetY * s, 0) : new Vector3(0, h / 2, 0);
      return { size: { width: w, height: h, depth: is2d ? 200 : Math.max(0.1, w) }, center };
    }
    // Model: measure its bounds relative to the node with rotation temporarily cleared.
    const rot = (this.node.rotationQuaternion ?? Quaternion.Identity()).clone();
    this.node.rotationQuaternion = Quaternion.Identity();
    this.node.computeWorldMatrix(true);
    const { min, max } = this._visualRoot.getHierarchyBoundingVectors(true, (m) => m.isEnabled());
    this.node.rotationQuaternion = rot;
    this.node.computeWorldMatrix(true);
    const p = this.node.position;
    const center = new Vector3((min.x + max.x) / 2 - p.x, (min.y + max.y) / 2 - p.y, is2d ? 0 : (min.z + max.z) / 2 - p.z);
    return {
      size: { width: max.x - min.x, height: max.y - min.y, depth: is2d ? 200 : Math.max(0.05, max.z - min.z) },
      center,
    };
  }

  // ---------- ready-made game behaviors (the Game blocks) ----------

  /** Blocks measure distance in steps: pixels in 2D, and 100 steps to a meter in 3D. */
  _fromSteps(steps: number): number {
    const n = Number(steps) || 0;
    return this.game.mode === '3d' ? n / 100 : n;
  }

  /**
   * From now on the player steers this sprite. controls: "arrow keys", "left and right arrows",
   * "WASD", "A and D" or "the mouse". speed: steps per second. In 3D, left/right turn and
   * up/down walk forward and back.
   */
  walkWith(controls = 'arrow keys', speed = 200): void {
    this._walking?.stop();
    const c = String(controls).toLowerCase();
    const letters = c === 'wasd' || c === 'a and d';
    const sideways = c === 'left and right arrows' || c === 'a and d';
    const mouse = c.includes('mouse');
    const v = this._fromSteps(speed);
    const input = this.game.input;
    const is3d = this.game.mode === '3d';
    this._walking = this.run(function* walk() {
      for (;;) {
        if (mouse) {
          const target = is3d ? this.game.mouseGround() : { x: input.mouse.x, y: input.mouse.y };
          if (target) this.moveTowards(target, v * this.game.dt);
        } else {
          const right = input.isDown(letters ? 'd' : 'right') ? 1 : 0;
          const left = input.isDown(letters ? 'a' : 'left') ? 1 : 0;
          const up = input.isDown(letters ? 'w' : 'up') ? 1 : 0;
          const down = input.isDown(letters ? 's' : 'down') ? 1 : 0;
          const dx = right - left;
          const dy = sideways ? 0 : up - down;
          if (is3d) {
            this.turn(dx * 150 * this.game.dt);
            const h = this.heading * DEG;
            this.velocity.x = Math.sin(h) * dy * v;
            this.velocity.z = Math.cos(h) * dy * v;
          } else {
            this.velocity.x = dx * v;
            // With gravity, up and down belong to jumping and falling.
            if (!this._isDynamic()) this.velocity.y = dy * v;
            if (dx) this.flipX = dx < 0;
          }
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

  /** Falls and lands on solid things. In 2D the bottom of the screen is solid too. */
  fallWithGravity(): void {
    if (!this._isDynamic()) this.addPhysics({ type: 'dynamic', fixedRotation: true });
    if (this.game.mode === '2d') this.game._ensureFloor();
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

  /** @internal */
  _moved(): void {
    if (this._body && !this._body.isDisposed) this.game._physics.teleport(this._body);
  }

  /** @internal Integrates velocity for sprites without a dynamic body. */
  _integrate(dt: number): void {
    if (this._isDynamic()) return;
    const v = this._vel;
    if (v.x === 0 && v.y === 0 && v.z === 0) return;
    this.node.position.addInPlace(v.scale(dt));
    if (this._body && this._body.getMotionType() === PhysicsMotionType.STATIC) this._moved();
  }

  /** @internal */
  _applyLook(): void {
    const look: CostumeResource | undefined = this._def.costumes[this._costumeIndex];
    if (!look) {
      this._visual.plane.setEnabled(false);
      return;
    }
    this._visual.show(look);
    this._visual.layer = this._layer;
    if (this._opacity !== 1) this._visual.opacity = this._opacity;
    if (this._tint) this._visual.tint = parseColor(this._tint);
    this._visualRoot.setEnabled(this._visible);
    if (this.game.mode === '3d') for (const m of this._visual.meshes()) this.game._castShadow(m);
  }

  /** @internal Initial placement. */
  _applyTransform(): void {
    this._applyRotation2D();
    this._applyScale();
    this._moved();
  }

  private _applyScale(): void {
    const s = this._size / 100;
    let flip = this._flipX;
    if (this.game.mode === '2d' && this._rotationStyle === 'left-right' && Math.cos(this._angle * DEG) < -1e-6) flip = !flip;
    this._visualRoot.scaling.set(flip ? -s : s, s, s);
  }

  /** Rebuilds the collider after the size/flip/costume changed. */
  private _refreshCollider(): void {
    if (!this._body || !this._physicsOpts) return;
    const opts = this._physicsOpts;
    const vel = this._readVelocity().clone();
    this._body.dispose();
    const { size, center } = this._colliderGeometry();
    this._body = this.game._physics.createBody(this.node, size, center, opts);
    if (this._isDynamic()) this._body.setLinearVelocity(vel);
  }

  /** @internal */
  _dispose(): void {
    this._teardown();
    this.stopAnimation();
    this._hideBubble();
    this._bubble?.remove();
    this.removePhysics();
    this._visual.dispose();
    this.node.dispose();
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

export function colorOf(value: string): Color3 {
  return parseColor(value);
}
