import * as BABYLON from './babylon';
import {
  Color4,
  HemisphericLight,
  Layer,
  Matrix,
  Plane,
  Scene,
  Vector3,
  type AbstractMesh,
  type Engine,
  type PickingInfo,
} from './babylon';
import type { RunPackage, RunTarget, WorldMode } from '../player/protocol';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../player/protocol';
import { AudioManager } from './audio';
import { CameraRig } from './camera';
import { Scheduler, STOP_GAME, isGenerator, type Coroutine } from './coroutines';
import { Effects, parseColor } from './effects';
import { Input } from './input';
import { PhysicsWorld } from './physics';
import { Entity, Sprite, Stage, withConstruction, type TargetLike } from './sprite';
import { Ui } from './ui';
import { loadCostumes, type CostumeResource, type ImageCostume } from './visuals';
import { World3D } from './world3d';
import { reportError, warnOnce } from './bridge';
import { beginFrame, evaluateClass, sandboxGlobals } from './sandbox';

export interface TargetDef {
  name: string;
  kind: 'stage' | 'sprite';
  run: RunTarget;
  costumes: CostumeResource[];
  /** sound name -> audio key */
  sounds: Map<string, string>;
  cls: new (game?: Game, def?: TargetDef) => Entity;
}

export interface GameHost {
  engine: Engine;
  canvas: HTMLCanvasElement;
  uiParent: HTMLElement;
  havok: unknown;
  onStateChange(state: GameState): void;
  requestRestart(): void;
}

export type GameState = 'idle' | 'running' | 'paused' | 'stopped';

type HookName = 'start' | 'onSpawn' | 'update' | 'onKeyDown' | 'onKeyUp' | 'onClick' | 'onMessage' | 'onCollide' | 'onDestroy';

/**
 * One loaded game. Game code reaches it as `this.game`.
 * Logic runs in fixed 60 Hz ticks (Babylon deterministic lockstep), independent of the display's frame rate.
 */
export class Game {
  readonly mode: WorldMode;
  readonly scene: Scene;
  readonly input: Input;
  readonly camera: CameraRig;
  readonly ui: Ui;
  readonly effects: Effects;
  /** 3D only: sky, sun, ground, fog. null in 2D. */
  readonly world: World3D | null;
  /** Shared variables for game-wide state (score, lives, level...). */
  vars: Record<string, any> = {};
  /** What the player typed at the last ask. */
  lastAnswer = '';
  /** Seconds of game time since the game started (advances 1/60 per tick). */
  time = 0;
  /** Seconds per tick (always 1/60). */
  readonly dt = 1 / 60;
  readonly width = STAGE_WIDTH;
  readonly height = STAGE_HEIGHT;
  state: GameState = 'idle';
  /** The stage instance. */
  stage!: Stage;

  /** @internal */ readonly _scheduler = new Scheduler();
  /** @internal */ readonly _audio: AudioManager;
  /** @internal */ readonly _physics: PhysicsWorld;
  /** @internal */ readonly _bubbles = new Set<Sprite>();
  private readonly defs = new Map<string, TargetDef>();
  private stageDef!: TargetDef;
  private all: Sprite[] = [];
  private started = new WeakSet<Entity>();
  private pendingDestroy: Sprite[] = [];
  private listeners = new Map<string, Set<{ fn: (data: unknown) => unknown; owner: Entity | null }>>();
  private backdropLayer: Layer | null = null;
  private backdropIndex = 0;
  private tickCount = 0;
  private floor: BABYLON.TransformNode | null = null;
  private failedChecks = new Set<string>();

  private constructor(
    private readonly host: GameHost,
    readonly pkg: RunPackage,
  ) {
    this.mode = pkg.mode;
    const scene = new Scene(host.engine);
    this.scene = scene;
    scene.skipPointerMovePicking = true;
    scene.clearColor = this.mode === '2d' ? new Color4(1, 1, 1, 1) : new Color4(0.6, 0.8, 1, 1);
    this.input = new Input(host.canvas);
    this._physics = new PhysicsWorld(scene, this.mode, host.havok);
    this.camera = new CameraRig(scene, this.mode, this.input);
    this.ui = new Ui(host.uiParent);
    this.effects = new Effects(scene, this.mode);
    this._audio = new AudioManager();
    if (this.mode === '3d') {
      this.world = new World3D(scene);
    } else {
      this.world = null;
      const light = new HemisphericLight('light', new Vector3(0.2, 1, -0.6), scene);
      light.intensity = 1;
    }
    scene.onBeforeStepObservable.add(() => this.tick());
    scene.onAfterStepObservable.add(() => this.afterStep());
  }

  /** Loads assets, evaluates compiled code and places every sprite (the game is idle until start()). */
  static async create(host: GameHost, pkg: RunPackage): Promise<Game> {
    const game = new Game(host, pkg);
    await game.build();
    return game;
  }

  private async build(): Promise<void> {
    const { scene } = this;
    const targets = this.pkg.targets;
    const loaded = await Promise.all(
      targets.map(async (t) => {
        const costumes = await loadCostumes(t.costumes, t.kind === 'stage' ? '2d' : this.mode, scene);
        const sounds = new Map<string, string>();
        await Promise.all(
          t.sounds.map(async (snd) => {
            const key = `${t.name}/${snd.name}`;
            await this._audio.load(key, snd.url);
            if (this._audio.has(key)) sounds.set(snd.name, key);
          }),
        );
        return { t, costumes, sounds };
      }),
    );

    for (const { t, costumes, sounds } of loaded) {
      const base: TargetDef['cls'] =
        t.kind === 'stage' ? (class extends Stage {} as TargetDef['cls']) : (class extends Sprite {} as TargetDef['cls']);
      Object.defineProperty(base, 'name', { value: t.kind === 'stage' ? 'Stage' : 'Sprite' });
      const def: TargetDef = { name: t.name, kind: t.kind, run: t, costumes, sounds, cls: base };
      def.cls = this.evaluate(t, base);
      if (t.kind === 'stage') this.stageDef = def;
      else this.defs.set(t.name, def);
    }
    if (!this.stageDef) {
      const run: RunTarget = {
        kind: 'stage', name: 'Stage', className: null, code: null, costumes: [], sounds: [], costumeNumber: 1,
        x: 0, y: 0, z: 0, size: 100, direction: 0, visible: true, rotationStyle: 'all around', layerOrder: 0,
      };
      this.stageDef = { name: 'Stage', kind: 'stage', run, costumes: [], sounds: new Map(), cls: class extends Stage {} as TargetDef['cls'] };
    }

    // Backdrop (2D always; 3D only if the stage has backdrops).
    const backdrops = this.stageDef.costumes.filter((c): c is ImageCostume => c.kind === 'image');
    if (backdrops.length) {
      this.backdropIndex = Math.max(0, Math.min(backdrops.length - 1, (this.stageDef.run.costumeNumber || 1) - 1));
      this.backdropLayer = new Layer('backdrop', null, scene, true);
      this.backdropLayer.texture = backdrops[this.backdropIndex].texture;
    }

    beginFrame();
    this.stage = this.instantiate(this.stageDef) as Stage;
    const sprites = [...this.defs.values()].sort((a, b) => a.run.layerOrder - b.run.layerOrder);
    for (const def of sprites) {
      beginFrame();
      this.instantiate(def);
    }
  }

  private evaluate(t: RunTarget, base: TargetDef['cls']): TargetDef['cls'] {
    if (!t.code || !t.className) return base;
    try {
      const scope: Record<string, unknown> = {
        ...sandboxGlobals(),
        BABYLON,
        Vector3: BABYLON.Vector3,
        Color3: BABYLON.Color3,
        Sprite: t.kind === 'sprite' ? base : Sprite,
        Stage: t.kind === 'stage' ? base : Stage,
      };
      beginFrame();
      const cls = evaluateClass(t.code, t.className, t.name, scope);
      if (typeof cls !== 'function' || !(cls.prototype instanceof base)) {
        throw new Error(`The code for "${t.name}" must declare \`class ${t.className} extends ${t.kind === 'stage' ? 'Stage' : 'Sprite'}\`.`);
      }
      return cls as TargetDef['cls'];
    } catch (err) {
      reportError(err, { phase: 'load', target: t.name });
      return base;
    }
  }

  private instantiate(def: TargetDef): Entity {
    try {
      return withConstruction(this, def, () => new def.cls(this, def));
    } catch (err) {
      reportError(err, { phase: 'load', target: def.name, script: 'constructor' });
      // Fall back to the plain base class so the sprite still appears.
      const Fallback: TargetDef['cls'] = def.kind === 'stage' ? class extends Stage {} : class extends Sprite {};
      return withConstruction(this, def, () => new Fallback(this, def));
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Starts the game: runs start() on the stage, then on every sprite. */
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.time = 0;
    this._audio.resume();
    this.host.onStateChange(this.state);
    beginFrame();
    try {
      this.started.add(this.stage);
      this.callHook(this.stage, 'start');
      for (const s of [...this.all]) {
        if (s.destroyed || this.started.has(s)) continue;
        this.started.add(s);
        this.callHook(s, s.isClone ? 'onSpawn' : 'start');
      }
    } catch (err) {
      if (err !== STOP_GAME) reportError(err, { phase: 'run', script: 'start' });
    }
  }

  /** Stops the game (logic, physics and sounds freeze). */
  stop(): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    this.scene.physicsEnabled = false;
    this._scheduler.clear();
    this._audio.stopAll();
    this.input.unlockPointer();
    this.host.onStateChange(this.state);
  }

  /** Pauses logic and physics until resume(). */
  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.scene.physicsEnabled = false;
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.scene.physicsEnabled = true;
  }

  /** Shows a "Game Over" banner and stops the game. */
  over(message?: string): void {
    this.ui.showBanner('Game Over', message);
    this.stop();
    throw STOP_GAME;
  }

  /** Shows a "You Win!" banner and stops the game. */
  win(message?: string): void {
    this.ui.showBanner('You Win!', message);
    this.stop();
    throw STOP_GAME;
  }

  /** Restarts the game from the beginning. */
  restart(): void {
    this.host.requestRestart();
    throw STOP_GAME;
  }

  dispose(): void {
    this.state = 'stopped';
    this._scheduler.clear();
    this._audio.dispose();
    this.input.dispose();
    this.ui.dispose();
    this.effects.dispose();
    this.scene.dispose();
  }

  // ---------------------------------------------------------------------------
  // Fixed tick
  // ---------------------------------------------------------------------------

  private tick(): void {
    if (this.state !== 'running') return;
    beginFrame();
    this.tickCount++;
    this.time = this.tickCount * this.dt;
    const input = this.input;
    input.beginTick();
    this.updateMouseWorld();

    try {
      // UI callbacks (buttons)
      const uiQueue = this.ui.queue;
      this.ui.queue = [];
      for (const fn of uiQueue) {
        try {
          const r = fn();
          if (isGenerator(r)) this._scheduler.start(null, 'button', r);
        } catch (err) {
          if (err === STOP_GAME) throw err;
          reportError(err, { phase: 'run', script: 'button' });
        }
      }

      // Input events
      const entities = this.entities();
      for (const key of input.pressedThisTick) for (const e of entities) this.callHook(e, 'onKeyDown', [key]);
      for (const key of input.releasedThisTick) for (const e of entities) this.callHook(e, 'onKeyUp', [key]);
      for (const click of input.clicksThisTick) {
        const hit = this.pickAt(click.canvasX, click.canvasY);
        this.callHook(hit ?? this.stage, 'onClick');
      }

      this._scheduler.runTimers(this.time);
      for (const e of this.entities()) this.callHook(e, 'update', [this.dt]);
      this._scheduler.stepAll();
      for (const s of this.all) if (!s.destroyed) s._integrate(this.dt);
      this.camera.tick(this.dt);
    } catch (err) {
      if (err !== STOP_GAME) reportError(err, { phase: 'run' });
    }
  }

  private afterStep(): void {
    this._physics.afterStep();
    if (this.state !== 'running') {
      this.flushDestroyed();
      return;
    }
    try {
      const seen = new Set<string>();
      for (const ev of this._physics.takeEvents()) {
        const a = entityOfNode(ev.a.transformNode);
        const b = entityOfNode(ev.b.transformNode);
        const key = `${a?.id ?? 'x'}:${b?.id ?? 'x'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        seen.add(`${b?.id ?? 'x'}:${a?.id ?? 'x'}`);
        const info = { point: ev.point, normal: ev.normal, sensor: ev.sensor };
        if (a && !a.destroyed) this.callHook(a, 'onCollide', [b ?? 'ground', info]);
        if (b && !b.destroyed) {
          const flipped = { ...info, normal: ev.normal ? ev.normal.scale(-1) : null };
          this.callHook(b, 'onCollide', [a ?? 'ground', flipped]);
        }
      }
    } catch (err) {
      if (err !== STOP_GAME) reportError(err, { phase: 'run', script: 'onCollide' });
    }
    this.flushDestroyed();
  }

  private flushDestroyed(): void {
    if (!this.pendingDestroy.length) return;
    const dead = new Set(this.pendingDestroy);
    this.pendingDestroy = [];
    for (const s of dead) {
      this._bubbles.delete(s);
      s._dispose();
    }
    this.all = this.all.filter((s) => !dead.has(s));
  }

  /** Called every rendered frame by the host. */
  render(): void {
    this.scene.render();
    this.ui.refresh();
    for (const s of this._bubbles) s._updateBubble();
  }

  private entities(): Entity[] {
    return [this.stage, ...this.all.filter((s) => !s.destroyed)];
  }

  private callHook(e: Entity, name: HookName, args: unknown[] = []): Coroutine | null {
    if (e.destroyed && name !== 'onDestroy') return null;
    const fn = (e as unknown as Record<string, unknown>)[name];
    if (typeof fn !== 'function') return null;
    const errors = e._hookErrors.get(name) ?? 0;
    if (errors >= 3) return null;
    try {
      const result = (fn as (...a: unknown[]) => unknown).apply(e, args);
      if (isGenerator(result)) {
        if (name === 'update') {
          warnOnce(`${e.name}: update() should not be a generator (use start() or this.run() for sequences).`);
          result.next();
          return null;
        }
        return this._scheduler.start(e, name, result);
      }
    } catch (err) {
      if (err === STOP_GAME) throw err;
      e._hookErrors.set(name, errors + 1);
      reportError(err, { phase: 'run', target: e.name, script: name });
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Sprites
  // ---------------------------------------------------------------------------

  /** @internal Called by the Sprite constructor. */
  _register(sprite: Sprite): void {
    this.all.push(sprite);
  }

  /** Every live sprite (originals and copies). */
  get sprites(): Sprite[] {
    return this.all.filter((s) => !s.destroyed);
  }

  /** The first live sprite with this name (or null). */
  find(name: string): Sprite | null {
    return this.all.find((s) => !s.destroyed && s.name === name) ?? null;
  }

  /** All live sprites with this name (the original and its copies). */
  findAll(name: string): Sprite[] {
    return this.all.filter((s) => !s.destroyed && s.name === name);
  }

  count(name: string): number {
    return this.findAll(name).length;
  }

  /**
   * Creates a new copy of a sprite (by name) and runs its onSpawn().
   * props can set x, y, z, angle, heading, size, costume, visible and any custom fields.
   */
  spawn(name: string, props: Record<string, unknown> = {}): Sprite | null {
    const def = this.defs.get(name) ?? [...this.defs.values()].find((d) => d.name.toLowerCase() === String(name).toLowerCase());
    if (!def) {
      warnOnce(`spawn("${name}"): there is no sprite with that name. Sprites: ${[...this.defs.keys()].join(', ')}`);
      return null;
    }
    let sprite: Sprite;
    try {
      sprite = withConstruction(this, def, () => new def.cls(this, def)) as Sprite;
    } catch (err) {
      reportError(err, { phase: 'run', target: def.name, script: 'constructor' });
      return null;
    }
    sprite.isClone = true;
    sprite.visible = true;
    applyProps(sprite, props);
    this.afterCreate(sprite);
    return sprite;
  }

  /** @internal */
  _cloneFrom(src: Sprite, props: Record<string, unknown>): Sprite | null {
    const def = src._def;
    let sprite: Sprite;
    try {
      sprite = withConstruction(this, def, () => new def.cls(this, def)) as Sprite;
    } catch (err) {
      reportError(err, { phase: 'run', target: def.name, script: 'constructor' });
      return null;
    }
    sprite.isClone = true;
    // Copy the look and position, like a Scratch clone.
    sprite.setPosition(src.x, src.y, src.z);
    if (this.mode === '2d') {
      sprite.rotationStyle = src.rotationStyle;
      sprite.angle = src.angle;
    } else {
      sprite.heading = src.heading;
    }
    sprite.size = src.size;
    sprite.costume = src.costume;
    sprite.flipX = src.flipX;
    sprite.opacity = src.opacity;
    sprite.tint = src.tint;
    sprite.layer = src.layer;
    sprite.visible = src.visible;
    // Copy custom fields (speed, health, ...).
    for (const key of Object.keys(src)) {
      if (key.startsWith('_') || RESERVED_FIELDS.has(key)) continue;
      const value = (src as unknown as Record<string, unknown>)[key];
      if (typeof value === 'function') continue;
      (sprite as unknown as Record<string, unknown>)[key] = value;
    }
    // Variables "for this sprite only": each copy gets its own.
    sprite.vars = { ...src.vars };
    if (!src.body) sprite.velocity = { x: src.velocity.x, y: src.velocity.y, z: src.velocity.z };
    applyProps(sprite, props);
    this.afterCreate(sprite);
    return sprite;
  }

  private afterCreate(sprite: Sprite): void {
    if (this.state === 'running' || this.state === 'paused') {
      this.started.add(sprite);
      this.callHook(sprite, 'onSpawn');
    }
  }

  /** @internal */
  _destroy(sprite: Sprite): void {
    if (sprite.destroyed) return;
    this.callHook(sprite, 'onDestroy');
    sprite._destroyed = true;
    this._scheduler.stopOwnedBy(sprite);
    sprite.visible = false;
    this.pendingDestroy.push(sprite);
    if (this.state !== 'running') this.flushDestroyed();
  }

  /** @internal */
  _maxLayer(): number {
    return this.all.reduce((m, s) => Math.max(m, s.layer), 0);
  }

  /** @internal */
  _minLayer(): number {
    return this.all.reduce((m, s) => Math.min(m, s.layer), 0);
  }

  /** @internal */
  _castShadow(mesh: AbstractMesh): void {
    this.world?.addShadowCaster(mesh);
  }

  /** @internal Sprites a touching() check should consider. */
  _candidates(target: unknown, self: Sprite): Sprite[] {
    const alive = (s: Sprite) => s !== self && !s.destroyed && s.visible;
    if (target === undefined || target === null) return this.all.filter(alive);
    if (Array.isArray(target)) return target.flatMap((t) => this._candidates(t, self));
    if (target instanceof Sprite) return alive(target) ? [target] : [];
    if (typeof target === 'string') {
      if (!this.defs.has(target) && !this.all.some((s) => s.name === target)) {
        warnOnce(`touching("${target}"): there is no sprite with that name.`);
      }
      return this.all.filter((s) => alive(s) && s.name === target);
    }
    return [];
  }

  /** @internal Turns a target (sprite, name, "mouse", "random", point) into a position. */
  _resolvePoint(target: TargetLike, self?: Sprite): { x: number; y: number; z: number } | null {
    if (target instanceof Sprite) return target.destroyed ? null : { x: target.x, y: target.y, z: target.z };
    if (typeof target === 'string') {
      if (target === 'mouse') {
        if (this.mode === '2d') return { x: this.input.mouse.x, y: this.input.mouse.y, z: 0 };
        const p = this.mouseGround();
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      }
      if (target === 'random') {
        if (this.mode === '2d') {
          const v = this.camera.view();
          return { x: this.random(v.left, v.right), y: this.random(v.bottom, v.top), z: 0 };
        }
        return { x: this.random(-10, 10), y: 0, z: this.random(-10, 10) };
      }
      let best: Sprite | null = null;
      let bestD = Infinity;
      for (const s of this.all) {
        if (s === self || s.destroyed || s.name !== target) continue;
        const d = self ? Math.hypot(s.x - self.x, s.y - self.y, s.z - self.z) : 0;
        if (d < bestD) {
          best = s;
          bestD = d;
        }
      }
      if (!best && !this.defs.has(target)) warnOnce(`No sprite named "${target}".`);
      return best ? { x: best.x, y: best.y, z: best.z } : null;
    }
    if (target && typeof target === 'object' && 'x' in target) {
      return { x: Number(target.x) || 0, y: Number(target.y) || 0, z: Number((target as { z?: number }).z) || 0 };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Mouse, picking, projection
  // ---------------------------------------------------------------------------

  private updateMouseWorld(): void {
    const m = this.input.mouse;
    if (this.mode === '2d') {
      m.x = this.camera.x + m.screenX / this.camera.zoom;
      m.y = this.camera.y + m.screenY / this.camera.zoom;
    } else {
      m.x = m.screenX;
      m.y = m.screenY;
    }
  }

  private canvasPoint(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.host.canvas.getBoundingClientRect();
    return {
      x: ((screenX + STAGE_WIDTH / 2) / STAGE_WIDTH) * rect.width,
      y: ((STAGE_HEIGHT / 2 - screenY) / STAGE_HEIGHT) * rect.height,
    };
  }

  private pickAt(canvasX: number, canvasY: number): Sprite | null {
    const picks: PickingInfo[] =
      this.scene.multiPick(canvasX, canvasY, (mesh) => {
        const e = entityOfNode(mesh);
        return Boolean(e && e instanceof Sprite && !e.destroyed && e.visible && mesh.isEnabled());
      }) ?? [];
    let best: Sprite | null = null;
    let bestScore = -Infinity;
    for (const p of picks) {
      const e = entityOfNode(p.pickedMesh);
      if (!(e instanceof Sprite)) continue;
      const score = this.mode === '2d' ? e.layer * 1e6 + this.all.indexOf(e) : -p.distance;
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  /** Editor: the frontmost visible sprite at a canvas point (CSS pixels from the canvas's top left). */
  spriteAt(canvasX: number, canvasY: number): Sprite | null {
    return this.pickAt(canvasX, canvasY);
  }

  /** Editor (2D): the stage position under a canvas point (CSS pixels from the canvas's top left). */
  stagePointAt(canvasX: number, canvasY: number): { x: number; y: number } {
    const rect = this.host.canvas.getBoundingClientRect();
    const screenX = (canvasX / rect.width) * STAGE_WIDTH - STAGE_WIDTH / 2;
    const screenY = STAGE_HEIGHT / 2 - (canvasY / rect.height) * STAGE_HEIGHT;
    return { x: this.camera.x + screenX / this.camera.zoom, y: this.camera.y + screenY / this.camera.zoom };
  }

  /** @internal */
  _mouseOver(sprite: Sprite): boolean {
    if (this.mode === '2d') {
      const b = sprite.bounds();
      const m = this.input.mouse;
      return m.x >= b.left && m.x <= b.right && m.y >= b.bottom && m.y <= b.top;
    }
    const p = this.canvasPoint(this.input.mouse.screenX, this.input.mouse.screenY);
    return this.pickAt(p.x, p.y) === sprite;
  }

  /** 3D: the point on the ground plane (y = 0) under the mouse, or null. */
  mouseGround(): Vector3 | null {
    const p = this.canvasPoint(this.input.mouse.screenX, this.input.mouse.screenY);
    const ray = this.scene.createPickingRay(p.x, p.y, Matrix.Identity(), this.camera.babylon);
    const distance = ray.intersectsPlane(Plane.FromPositionAndNormal(Vector3.Zero(), Vector3.Up()));
    return distance === null ? null : ray.origin.add(ray.direction.scale(distance));
  }

  /** @internal World point -> stage coordinates on screen (null if behind the camera). */
  _toScreen(point: Vector3): { x: number; y: number } | null {
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const cam = this.camera.babylon;
    const projected = Vector3.Project(point, Matrix.Identity(), this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    if (projected.z < 0 || projected.z > 1) return null;
    return { x: (projected.x / w) * STAGE_WIDTH - STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 - (projected.y / h) * STAGE_HEIGHT };
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /** Sends a message: every sprite's and the stage's onMessage(name, data) runs, plus `on(name)` listeners. */
  broadcast(name: string, data?: unknown): void {
    this.dispatch(name, data);
  }

  /** Coroutine helper: broadcasts and waits for every handler (and the coroutines they start) to finish. */
  *broadcastAndWait(name: string, data?: unknown): Generator<void, void, unknown> {
    const running = this.dispatch(name, data);
    while (running.some((c) => !c.done)) yield;
  }

  private dispatch(name: string, data: unknown): Coroutine[] {
    const started: Coroutine[] = [];
    for (const e of this.entities()) {
      const co = this.callHook(e, 'onMessage', [name, data]);
      if (co) started.push(co);
    }
    for (const l of [...(this.listeners.get(name) ?? [])]) {
      if (l.owner?.destroyed) continue;
      try {
        const r = l.fn(data);
        if (isGenerator(r)) started.push(this._scheduler.start(l.owner, `on("${name}")`, r));
      } catch (err) {
        if (err === STOP_GAME) throw err;
        reportError(err, { phase: 'run', target: l.owner?.name, script: `on("${name}")` });
      }
    }
    return started;
  }

  /** Listens for a message. Returns a function that stops listening. */
  on(name: string, fn: (data: unknown) => unknown, owner: Entity | null = null): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    const entry = { fn, owner };
    set.add(entry);
    return () => set!.delete(entry);
  }

  // ---------------------------------------------------------------------------
  // Misc API
  // ---------------------------------------------------------------------------

  /** Random number between min and max (inclusive integers when both are integers). */
  random(min: number, max: number): number {
    const lo = Math.min(Number(min), Number(max));
    const hi = Math.max(Number(min), Number(max));
    if (Number.isInteger(lo) && Number.isInteger(hi)) return lo + Math.floor(Math.random() * (hi - lo + 1));
    return lo + Math.random() * (hi - lo);
  }

  /** Coroutine helper: `const name = yield* this.game.ask("What's your name?")`. */
  *ask(question: string): Generator<void, string, unknown> {
    let answer: string | null = null;
    void this.ui.ask(String(question)).then((a) => {
      answer = a;
    });
    while (answer === null) yield;
    this.lastAnswer = answer;
    return answer;
  }

  /** Physics settings: `this.game.physics.gravity = { y: -2000 }`. */
  get physics(): { gravity: Vector3; raycast: PhysicsWorld['raycast'] } {
    const world = this._physics;
    return {
      get gravity() {
        return world.gravity;
      },
      set gravity(g: Vector3) {
        world.gravity = g;
      },
      raycast: world.raycast.bind(world),
    };
  }

  /** Background color behind everything ("#87ceeb"). */
  set background(color: string) {
    const c = parseColor(color);
    this.scene.clearColor = new Color4(c.r, c.g, c.b, 1);
  }

  get backdrop(): string {
    return this._backdropNames()[this.backdropIndex] ?? '';
  }

  set backdrop(name: string | number) {
    const names = this._backdropNames();
    if (!names.length) return;
    let index = typeof name === 'number' ? Math.round(name) - 1 : names.indexOf(name);
    if (index < 0 && typeof name === 'string') index = names.findIndex((n) => n.toLowerCase() === name.toLowerCase());
    if (index < 0 || index >= names.length) {
      warnOnce(`No backdrop named "${name}". Backdrops: ${names.join(', ')}`);
      return;
    }
    this.backdropIndex = index;
    const images = this.stageDef.costumes.filter((c): c is ImageCostume => c.kind === 'image');
    if (this.backdropLayer) this.backdropLayer.texture = images[index].texture;
    this.dispatch(`backdrop:${names[index]}`, names[index]);
  }

  nextBackdrop(): void {
    const n = this._backdropNames().length;
    if (n) this.backdrop = ((this.backdropIndex + 1) % n) + 1;
  }

  previousBackdrop(): void {
    const n = this._backdropNames().length;
    if (n) this.backdrop = ((this.backdropIndex - 1 + n) % n) + 1;
  }

  randomBackdrop(): void {
    const n = this._backdropNames().length;
    if (n > 1) this.backdrop = ((this.backdropIndex + 1 + Math.floor(Math.random() * (n - 1))) % n) + 1;
  }

  /** A copy of a sprite as it is right now (the original, not one of its copies), like "make a copy of". */
  cloneOf(name: string): Sprite | null {
    const wanted = String(name).toLowerCase();
    const matches = this.all.filter((s) => !s.destroyed && s.name.toLowerCase() === wanted);
    const source = matches.find((s) => !s.isClone) ?? matches[0];
    return source ? this._cloneFrom(source, {}) : this.spawn(name);
  }

  /** @internal In 2D, gravity lands on the bottom of the screen: an invisible, endless floor there. */
  _ensureFloor(): void {
    if (this.floor || this.mode !== '2d') return;
    const depth = 100;
    this.floor = new BABYLON.TransformNode('amble-floor', this.scene);
    this.floor.position.set(0, -STAGE_HEIGHT / 2 - depth / 2, 0);
    this._physics.createBody(this.floor, { width: 200000, height: depth, depth: 400 }, BABYLON.Vector3.Zero(), { type: 'static' });
  }

  /** @internal A check block found its condition false: tell the author once per game. */
  _checkFailed(target: string, check: string): void {
    const key = `${target}|${check}`;
    if (this.failedChecks.has(key)) return;
    this.failedChecks.add(key);
    reportError(new Error(`This check wasn't true: ${check}`), { phase: 'run', target, script: 'check' });
  }

  /** @internal */
  _backdropNames(): string[] {
    return this.stageDef.costumes.filter((c) => c.kind === 'image').map((c) => c.name);
  }

  /** Plays a sound as looping background music (one at a time). `music(null)` stops it. */
  music(name: string | null, opts: { volume?: number } = {}): void {
    if (!name) {
      this._audio.music(null);
      return;
    }
    const key = this._findSound(this.stageDef, name);
    if (!key) {
      warnOnce(`music("${name}"): no sound with that name.`);
      return;
    }
    this._audio.music(key, opts);
  }

  stopAllSounds(): void {
    this._audio.stopAll();
  }

  /** @internal */
  _findSound(def: TargetDef, name: string): string | null {
    const exact = def.sounds.get(name) ?? this.stageDef?.sounds.get(name);
    if (exact) return exact;
    const lower = String(name).toLowerCase();
    for (const d of [def, this.stageDef, ...this.defs.values()]) {
      if (!d) continue;
      for (const [n, key] of d.sounds) if (n === name || n.toLowerCase() === lower) return key;
    }
    return null;
  }

  /** Babylon's namespace, for anything the helpers don't cover. */
  get BABYLON(): typeof BABYLON {
    return BABYLON;
  }
}

const RESERVED_FIELDS = new Set(['game', 'name', 'id', 'node', 'isClone']);

function entityOfNode(node: { metadata?: unknown; parent?: unknown } | null | undefined): Entity | null {
  let n = node as { metadata?: { amble?: Entity }; parent?: unknown } | null | undefined;
  while (n) {
    if (n.metadata?.amble) return n.metadata.amble;
    n = n.parent as typeof n;
  }
  return null;
}

function applyProps(sprite: Sprite, props: Record<string, unknown>): void {
  const order = ['size', 'costume', 'rotationStyle', 'angle', 'heading', 'x', 'y', 'z'];
  const keys = Object.keys(props).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const key of keys) {
    if (RESERVED_FIELDS.has(key)) continue;
    try {
      (sprite as unknown as Record<string, unknown>)[key] = props[key];
    } catch (err) {
      reportError(err, { phase: 'run', target: sprite.name, script: 'spawn' });
    }
  }
}
