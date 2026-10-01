import type * as Phaser from 'phaser';
import type { RunPackage, RunTarget } from '../player/protocol';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../player/protocol';
import { AudioManager } from './audio';
import { CameraRig } from './camera';
import { Scheduler, STOP_GAME, isGenerator, type Coroutine } from './coroutines';
import { Effects, ensureDot } from './effects';
import { Input } from './input';
import { PhysicsWorld, toWorld, type Body, type Matter, type Point } from './physics';
import { Entity, Sprite, Stage, withConstruction, type TargetLike } from './sprite';
import { Ui } from './ui';
import { loadCostumes, parseColor, type Costume } from './visuals';
import { reportError, warnOnce } from './bridge';
import { beginFrame, evaluateClass, sandboxGlobals } from './sandbox';

export interface TargetDef {
  name: string;
  kind: 'stage' | 'sprite';
  run: RunTarget;
  costumes: Costume[];
  /** sound name -> audio key */
  sounds: Map<string, string>;
  cls: new (game?: Game, def?: TargetDef) => Entity;
}

export interface GameHost {
  /** Phaser's namespace (the player bundles it; game code reaches it as `Phaser`). */
  Phaser: typeof Phaser;
  /** The player's one Phaser game: each Amble game runs in a scene of its own. */
  phaser: Phaser.Game;
  canvas: HTMLCanvasElement;
  uiParent: HTMLElement;
  /** Canvas pixels per stage pixel (the stage is drawn at the screen's own resolution). */
  scale(): number;
  onStateChange(state: GameState): void;
  requestRestart(): void;
}

export type GameState = 'idle' | 'running' | 'paused' | 'stopped';

type HookName = 'start' | 'onSpawn' | 'update' | 'onKeyDown' | 'onKeyUp' | 'onClick' | 'onMessage' | 'onCollide' | 'onDestroy';

const TICK_MS = 1000 / 60;
/** At most this many ticks per drawn frame, so a slow computer slows the game down rather than freezing it. */
const MAX_TICKS_PER_FRAME = 4;
let scenes = 0;

/**
 * One loaded game, in a Phaser scene of its own. Game code reaches it as `this.game`.
 * Logic runs in fixed 60 Hz ticks (and Matter physics steps once per tick), independent of the
 * display's frame rate.
 */
export class Game {
  readonly mode = '2d' as const;
  readonly input: Input;
  readonly camera: CameraRig;
  readonly ui: Ui;
  readonly effects: Effects;
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
  /** @internal */ readonly _physics: PhysicsWorld<Sprite>;
  /** @internal */ readonly _bubbles = new Set<Sprite>();
  private readonly defs = new Map<string, TargetDef>();
  private stageDef!: TargetDef;
  private all: Sprite[] = [];
  private started = new WeakSet<Entity>();
  private pendingDestroy: Sprite[] = [];
  private listeners = new Map<string, Set<{ fn: (data: unknown) => unknown; owner: Entity | null }>>();
  private backdropImage: Phaser.GameObjects.Image | null = null;
  private backdropIndex = 0;
  private tickCount = 0;
  private pendingMs = 0;
  private floor: Body | null = null;
  private failedChecks = new Set<string>();
  private textureKeys: string[] = [];
  private readonly prefix: string;

  private constructor(
    private readonly host: GameHost,
    readonly pkg: RunPackage,
    /** The Phaser scene this game runs in (`this.game.scene.add`, `.tweens`, `.matter`...). */
    readonly scene: Phaser.Scene,
  ) {
    this.prefix = `${scene.sys.settings.key}:`;
    this.input = new Input(host.canvas);
    this._physics = new PhysicsWorld<Sprite>(scene, (host.Phaser.Physics.Matter as unknown as { Matter: Matter }).Matter);
    this.camera = new CameraRig(scene.cameras.main);
    scene.cameras.main.setBackgroundColor(0xffffff);
    this.ui = new Ui(host.uiParent);
    this.effects = new Effects(scene);
    ensureDot(scene.textures);
    this._audio = new AudioManager();
  }

  /** Loads assets, evaluates compiled code and places every sprite (the game is idle until start()). */
  static async create(host: GameHost, pkg: RunPackage): Promise<Game> {
    const P = host.Phaser;
    const key = `amble-${++scenes}`;
    let game: Game | null = null;
    let created: (scene: Phaser.Scene) => void = () => undefined;
    const ready = new Promise<Phaser.Scene>((resolve) => (created = resolve));
    class AmbleScene extends P.Scene {
      constructor() {
        super({ key, physics: { default: 'matter', matter: { gravity: { x: 0, y: 1.6 }, autoUpdate: false, enableSleeping: false } } });
      }
      create(): void {
        created(this);
      }
      update(_time: number, delta: number): void {
        game?._frame(delta);
      }
    }
    // Added between frames it starts at once; during one, at the next (create() says when).
    host.phaser.scene.add(key, AmbleScene, true);
    const scene = await ready;
    game = new Game(host, pkg, scene);
    try {
      await game.build();
    } catch (err) {
      game.dispose();
      throw err;
    }
    return game;
  }

  private async build(): Promise<void> {
    const textures = this.scene.textures;
    const loaded = await Promise.all(
      this.pkg.targets.map(async (t) => {
        const costumes = await loadCostumes(t.costumes, textures, this.prefix);
        this.textureKeys.push(...costumes.map((c) => c.key));
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

    // The backdrop fills the view, behind everything.
    const backdrops = this.stageDef.costumes;
    if (backdrops.length) {
      this.backdropIndex = Math.max(0, Math.min(backdrops.length - 1, (this.stageDef.run.costumeNumber || 1) - 1));
      this.backdropImage = this.scene.add.image(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, backdrops[this.backdropIndex].key);
      this.backdropImage.setDepth(-1e9);
    }

    beginFrame();
    this.stage = this.instantiate(this.stageDef) as Stage;
    const sprites = [...this.defs.values()].sort((a, b) => a.run.layerOrder - b.run.layerOrder);
    for (const def of sprites) {
      beginFrame();
      this.instantiate(def);
    }
    this._render();
  }

  private evaluate(t: RunTarget, base: TargetDef['cls']): TargetDef['cls'] {
    if (!t.code || !t.className) return base;
    try {
      const scope: Record<string, unknown> = {
        ...sandboxGlobals(),
        Phaser: this.host.Phaser,
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
    this.pendingMs = 0;
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

  /** Stops the game (logic, physics, Phaser's tweens and timers, and sounds freeze). */
  stop(): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    this._scheduler.clear();
    this._audio.stopAll();
    this.input.unlockPointer();
    this.freeze(true);
    this.host.onStateChange(this.state);
  }

  /** Pauses logic and physics until resume(). */
  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.freeze(true);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.freeze(false);
  }

  /** Phaser's own clocks (tweens, timers, particles, animations) stop and go with the game. */
  private freeze(frozen: boolean): void {
    const scene = this.scene;
    if (!scene.sys) return;
    scene.time.paused = frozen;
    if (frozen) scene.tweens.pauseAll();
    else scene.tweens.resumeAll();
    for (const obj of scene.children.list) {
      const emitter = obj as unknown as { pause?: () => void; resume?: () => void; type?: string };
      if (emitter.type === 'ParticleEmitter') {
        if (frozen) emitter.pause?.();
        else emitter.resume?.();
      }
    }
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
    const manager = this.host.phaser.scene;
    if (manager.getScene(this.scene.sys.settings.key)) manager.remove(this.scene.sys.settings.key);
    for (const key of this.textureKeys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.textureKeys = [];
  }

  // ---------------------------------------------------------------------------
  // Frames and fixed ticks
  // ---------------------------------------------------------------------------

  /** @internal Called by the scene every drawn frame: runs the ticks due, then draws. */
  _frame(deltaMs: number): void {
    if (this.state === 'running') {
      this.pendingMs = Math.min(this.pendingMs + deltaMs, TICK_MS * MAX_TICKS_PER_FRAME);
      while (this.pendingMs >= TICK_MS - 0.01 && this.state === 'running') {
        this.pendingMs -= TICK_MS;
        this.tick();
      }
    }
    this._render();
  }

  private tick(): void {
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
      this._scheduler.stepAll();
      // After the scripts, so "when I touch" and "when <...>" see what the scripts just did.
      for (const e of this.entities()) this.callHook(e, 'update', [this.dt]);
      for (const s of this.all) if (!s.destroyed) s._integrate(this.dt);
      this.camera.tick(this.dt);
    } catch (err) {
      if (err !== STOP_GAME) reportError(err, { phase: 'run' });
    }
    if (this.state === 'running') {
      this._physics.step();
      for (const s of this.all) if (!s.destroyed) s._fromBody();
      this.collisions();
    }
    this.flushDestroyed();
  }

  private collisions(): void {
    try {
      const seen = new Set<string>();
      for (const ev of this._physics.takeEvents()) {
        const { a, b } = ev;
        const key = `${a?.id ?? 'x'}:${b?.id ?? 'x'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        seen.add(`${b?.id ?? 'x'}:${a?.id ?? 'x'}`);
        const info = { point: ev.point, normal: ev.normal, sensor: ev.sensor };
        if (a && !a.destroyed) this.callHook(a, 'onCollide', [b ?? 'ground', info]);
        if (b && !b.destroyed) this.callHook(b, 'onCollide', [a ?? 'ground', { ...info, normal: ev.normal ? { x: -ev.normal.x, y: -ev.normal.y } : null }]);
      }
    } catch (err) {
      if (err !== STOP_GAME) reportError(err, { phase: 'run', script: 'onCollide' });
    }
  }

  private flushDestroyed(): void {
    if (!this.pendingDestroy.length) return;
    const dead = new Set(this.pendingDestroy);
    this.pendingDestroy = [];
    for (const s of dead) {
      this._bubbles.delete(s);
      s._goneThisTick = false;
      s._dispose();
    }
    this.all = this.all.filter((s) => !dead.has(s));
  }

  /** @internal Points the camera, fits the backdrop to the view and places the overlays (every frame). */
  _render(): void {
    if (!this.scene.sys) return;
    const scale = this.host.scale();
    this.camera._apply(scale);
    if (this.backdropImage) {
      // Fixed to the screen, like Scratch's: it fills the view whatever the camera does.
      const look = this.stageDef.costumes[this.backdropIndex];
      const mid = this.scene.cameras.main.midPoint;
      this.backdropImage.setPosition(mid.x, mid.y);
      this.backdropImage.setOrigin(0.5, 0.5);
      this.backdropImage.setScale(STAGE_WIDTH / (look.width * look.density) / this.camera.zoom, STAGE_HEIGHT / (look.height * look.density) / this.camera.zoom);
    }
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
   * props can set x, y, angle, size, costume, visible and any custom fields.
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
    sprite.setPosition(src.x, src.y);
    sprite.rotationStyle = src.rotationStyle;
    sprite.angle = src.angle;
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
    if (!src.body) sprite.velocity = { x: src.velocity.x, y: src.velocity.y };
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
    sprite._goneThisTick = sprite.visible;
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

  /**
   * @internal Sprites a touching() check should consider. A copy deleted during this tick still
   * counts until the tick ends, so a star that deletes itself when it touches Amble is still seen
   * by Amble's "when I touch Star", whichever of the two runs first.
   */
  _candidates(target: unknown, self: Sprite): Sprite[] {
    const alive = (s: Sprite) => s !== self && (s.destroyed ? s._goneThisTick : s.visible);
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
  _resolvePoint(target: TargetLike, self?: Sprite): Point | null {
    if (target instanceof Sprite) return target.destroyed ? null : { x: target.x, y: target.y };
    if (typeof target === 'string') {
      if (target === 'mouse') return { x: this.input.mouse.x, y: this.input.mouse.y };
      if (target === 'random') {
        const v = this.camera.view();
        return { x: this.random(v.left, v.right), y: this.random(v.bottom, v.top) };
      }
      let best: Sprite | null = null;
      let bestD = Infinity;
      for (const s of this.all) {
        if (s === self || s.destroyed || s.name !== target) continue;
        const d = self ? Math.hypot(s.x - self.x, s.y - self.y) : 0;
        if (d < bestD) {
          best = s;
          bestD = d;
        }
      }
      if (!best && !this.defs.has(target)) warnOnce(`No sprite named "${target}".`);
      return best ? { x: best.x, y: best.y } : null;
    }
    if (target && typeof target === 'object' && 'x' in target) {
      return { x: Number(target.x) || 0, y: Number(target.y) || 0 };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Mouse, picking, projection
  // ---------------------------------------------------------------------------

  private updateMouseWorld(): void {
    const m = this.input.mouse;
    m.x = this.camera.x + m.screenX / this.camera.zoom;
    m.y = this.camera.y + m.screenY / this.camera.zoom;
  }

  /** The frontmost visible sprite whose costume has a visible pixel at a point (stage coordinates). */
  private spriteAtPoint(p: Point): Sprite | null {
    const at = toWorld(p.x, p.y);
    const order = this.all.map((s, i) => ({ s, i })).filter(({ s }) => !s.destroyed && s.visible && s._look());
    order.sort((a, b) => b.s.layer - a.s.layer || b.i - a.i);
    for (const { s } of order) {
      const look = s._look()!;
      const local = s._image.getLocalPoint(at.x, at.y);
      const w = s._image.frame.width;
      const h = s._image.frame.height;
      if (local.x < 0 || local.y < 0 || local.x >= w || local.y >= h) continue;
      const alpha = this.scene.textures.getPixelAlpha(Math.floor(local.x), Math.floor(local.y), look.key);
      if (alpha === null || alpha > 8) return s;
    }
    return null;
  }

  private pickAt(canvasX: number, canvasY: number): Sprite | null {
    return this.spriteAtPoint(this.stagePointAt(canvasX, canvasY));
  }

  /** Editor: the frontmost visible sprite at a canvas point (CSS pixels from the canvas's top left). */
  spriteAt(canvasX: number, canvasY: number): Sprite | null {
    return this.pickAt(canvasX, canvasY);
  }

  /** Editor: the stage position under a canvas point (CSS pixels from the canvas's top left). */
  stagePointAt(canvasX: number, canvasY: number): Point {
    const rect = this.host.canvas.getBoundingClientRect();
    const screenX = (canvasX / (rect.width || STAGE_WIDTH)) * STAGE_WIDTH - STAGE_WIDTH / 2;
    const screenY = STAGE_HEIGHT / 2 - (canvasY / (rect.height || STAGE_HEIGHT)) * STAGE_HEIGHT;
    return { x: this.camera.x + screenX / this.camera.zoom, y: this.camera.y + screenY / this.camera.zoom };
  }

  /** @internal */
  _mouseOver(sprite: Sprite): boolean {
    const b = sprite.bounds();
    const m = this.input.mouse;
    return m.x >= b.left && m.x <= b.right && m.y >= b.bottom && m.y <= b.top;
  }

  /** @internal A stage point -> where it shows on the screen, in stage coordinates (-240..240, -180..180). */
  _toScreen(point: Point): Point {
    return { x: (point.x - this.camera.x) * this.camera.zoom, y: (point.y - this.camera.y) * this.camera.zoom };
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

  /**
   * Physics settings: `this.game.physics.gravity = { y: -2000 }` (stage pixels per second squared, up is +);
   * `raycast(from, to)` gives the first sprite in the way (or null); `matter` is Phaser's Matter.
   */
  get physics(): { gravity: Point; raycast(from: Point, to: Point): Sprite | null; readonly matter: Phaser.Physics.Matter.MatterPhysics } {
    const world = this._physics;
    const scene = this.scene;
    return {
      get gravity() {
        return world.gravity;
      },
      set gravity(g: Point) {
        world.gravity = g;
      },
      raycast(from: Point, to: Point) {
        return world.raycast(from, to).find((h) => h.owner && !h.owner.destroyed)?.owner ?? null;
      },
      get matter() {
        return scene.matter;
      },
    };
  }

  /** Background color behind everything ("#87ceeb"). */
  set background(color: string) {
    this.scene.cameras.main.setBackgroundColor(parseColor(color));
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
    this.backdropImage?.setTexture(this.stageDef.costumes[index].key);
    this._render();
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

  /** @internal Gravity lands on the bottom of the screen: an invisible, endless floor there. */
  _ensureFloor(): void {
    if (this.floor) return;
    const depth = 100;
    this.floor = this._physics.createBody(null as unknown as Sprite, { x: 0, y: -STAGE_HEIGHT / 2 - depth / 2 }, { width: 200000, height: depth }, 0, { type: 'static' });
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
    return this.stageDef.costumes.map((c) => c.name);
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

  /** Phaser's namespace, for anything the helpers don't cover (also a global in game code). */
  get Phaser(): typeof Phaser {
    return this.host.Phaser;
  }
}

const RESERVED_FIELDS = new Set(['game', 'name', 'id', 'isClone', 'image']);

function applyProps(sprite: Sprite, props: Record<string, unknown>): void {
  const order = ['size', 'costume', 'rotationStyle', 'angle', 'x', 'y'];
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
