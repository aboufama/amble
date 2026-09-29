/// <reference types="phaser" />
/**
 * The Amble kit, as game code sees it: `class Game extends Amble.Scene` plus everything on `this`.
 * The AI writes against this file (its cheat sheet is generated from KIT_API in manifest.ts) and starters
 * are type-checked against it. Everything declared here exists in the runtime; keep it that way.
 */
declare namespace Amble {
  // ---------------------------------------------------------------- basics
  /** 0xff00aa, '#ff00aa' or a CSS colour name. */
  type Color = number | string;
  interface Point { x: number; y: number }
  /** A number option that may be live: `() => this.dials.jump` is read every frame. */
  type Num = number | (() => number);
  type Role = 'hero' | 'enemy' | 'boss' | 'npc' | 'item' | 'hazard' | 'prop' | 'terrain' | 'projectile' | 'enemyShot' | 'decor' | 'background';
  type RigKind = 'biped' | 'quadruped' | 'flyer' | 'swimmer' | 'blob' | 'object' | 'none';
  type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'fire' | 'dash' | 'action' | 'pause';
  type Target = Phaser.GameObjects.GameObject | Phaser.GameObjects.Group | string | Array<Phaser.GameObjects.GameObject | Phaser.GameObjects.Group | string>;
  /** One of the words, or any string: JavaScript widens `{ physics: 'arcade' }` to string, and the kit forgives unknown words. */
  type Loose<T extends string> = T | (string & {});

  // ---------------------------------------------------------------- the static fields of Game
  interface GameConfig {
    /** Title card (any key or tap starts). */
    title?: string;
    subtitle?: string;
    /** Default 'arcade'. */
    physics?: Loose<'arcade' | 'matter' | 'none'>;
    /** Arcade: px/s² (0 top-down, about 1500 platformer). Matter: 1 is normal. */
    gravity?: number;
    background?: Color;
    /** Default 960 x 540, scaled to fit. */
    width?: number;
    height?: number;
    pixelArt?: boolean;
    /** Matter bodies at rest sleep (default true). */
    sleeping?: boolean;
    /** Pops "-1" over things that get hurt. */
    damageNumbers?: boolean;
    /** Touch button words: { jump: 'JUMP', fire: 'BUBBLE' }. */
    controls?: Partial<Record<Action, string>>;
    /** The art key that stars on the title card (default: the hero). */
    star?: string;
  }

  /** One picture the game needs. The STUDENT draws it; until then a stand-in ("just bones") plays its part. */
  interface ArtSpec {
    kind: Loose<'character' | 'item' | 'projectile' | 'prop' | 'terrain' | 'background' | 'decor'>;
    /** Characters get bones of this kind. */
    rig?: Loose<RigKind>;
    role?: Loose<Role>;
    /** In-game size (game px): the hitbox and the stand-in. The drawing is fitted to it. */
    w?: number;
    h?: number;
    facing?: Loose<'viewer' | 'right' | 'left'>;
    /** "The Moon King" (default: the key, in words). */
    name?: string;
    /** "Draw the Moon King, a giant grumpy boss". */
    ask?: string;
    about?: string;
    pronoun?: Loose<'him' | 'her' | 'them' | 'it'>;
    /** 1 = ask first (the hero). */
    priority?: number;
    /** Default true for heroes, bosses and enemies. */
    required?: boolean;
    /** Used only once drawn: check with `this.hasArt(key)`. */
    spare?: boolean;
    /** Stand-in outline for things without bones. */
    shape?: Loose<'box' | 'ellipse' | 'capsule' | 'diamond' | 'star' | 'heart' | 'coin' | 'tile'>;
    /** Stand-in tint (default: the role's colour). */
    color?: Color;
    /** Terrain: colour of the top edge. */
    top?: Color;
  }

  /** A number the student tunes live (the Dials card), and can say in words ("jump higher"). */
  interface DialSpec {
    /** "Jump power" (24 characters at most). */
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    /** Default true. false: the level restarts when it changes. */
    live?: boolean;
    /** Other words a student might say: "hop bounce float". */
    words?: string;
    /** The art key it belongs to (shown on that thing's card). */
    for?: string;
    /** "%", "px". */
    unit?: string;
  }

  interface SynthSegment {
    wave: Loose<'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise'>;
    startFreq: number;
    endFreq: number;
    /** Seconds. */
    duration: number;
    startVolume: number;
    endVolume: number;
  }

  /** A game's own sound: a synth recipe with a caption for players who read captions. */
  interface SoundSpec {
    caption?: string;
    segments: SynthSegment[];
  }

  type SoundName = 'coin' | 'jump' | 'laser' | 'shoot' | 'hit' | 'stomp' | 'explosion' | 'boom' | 'powerup' | 'blip' | 'pop'
    | 'dash' | 'zap' | 'thud' | 'roar' | 'flip' | 'slowmo' | 'combo' | 'hurt' | 'win' | 'lose' | 'bubble' | 'splash';

  /** Moves every character knows (drawn or not). 'ko' and 'wave' also work (they mean die and cheer). */
  type Move = 'idle' | 'walk' | 'run' | 'jump' | 'rise' | 'fall' | 'land' | 'dash' | 'attack' | 'shoot' | 'hurt' | 'die'
    | 'cheer' | 'rage' | 'fly' | 'glide' | 'swim' | 'wiggle' | 'spin' | 'ko' | 'wave';

  // ---------------------------------------------------------------- health and behaviours
  interface DamageInfo { from?: Point; x?: number; y?: number; knockback?: number; pop?: boolean }
  interface PlatformerOptions {
    speed?: Num; accel?: Num; decel?: Num; jump?: Num;
    /** Jumps before landing (2 = double jump). */
    jumps?: Num;
    coyoteMs?: number; bufferMs?: number; maxFall?: Num;
    /** Landing on enemies defeats them (default true). */
    stomp?: boolean;
    dash?: boolean | { speed?: Num; ms?: number; cooldown?: number };
  }
  interface RunnerOptions extends PlatformerOptions { maxSpeed?: Num; speedUp?: Num }
  interface TopdownOptions { speed?: Num; accel?: Num; decel?: Num }
  interface FlyerOptions { speed?: Num; lift?: Num; glide?: boolean }
  interface ShooterOptions {
    key?: string; speed?: Num; every?: Num; damage?: Num; count?: Num; arc?: number; spread?: number; pierce?: number;
    aim?: 'facing' | '8way' | 'pointer' | 'up';
    /** Fires without holding fire. */
    auto?: boolean;
    blend?: 'add' | 'normal'; sound?: string; color?: Color; muzzle?: number; offsetY?: number;
  }
  interface ShotOptions {
    key?: string; speed?: Num; damage?: Num; group?: string; role?: 'hero' | 'enemy';
    gravity?: boolean | number; bounce?: number; solid?: boolean; accel?: number;
    /** ms before it expires (default 6000). */
    life?: number;
    pierce?: number; homing?: Point; turn?: number; spin?: number; spread?: number;
    muzzle?: number; offsetX?: number; offsetY?: number; scale?: number; blend?: 'add' | 'normal'; rotate?: boolean; depth?: number; hitbox?: number;
    color?: Color;
    onExpire?: (shot: Phaser.Physics.Arcade.Sprite) => void;
  }

  /** Everything the spawn helpers return: a drawn character on its bones, a stand-in, or a sprite. */
  interface Actor extends Phaser.GameObjects.GameObject, Phaser.GameObjects.Components.Transform, Phaser.GameObjects.Components.Visible, Phaser.GameObjects.Components.Depth, Phaser.GameObjects.Components.AlphaSingle {
    readonly key: string;
    role: Role;
    facing: 1 | -1;
    body: Phaser.Physics.Arcade.Body;
    readonly displayWidth: number;
    readonly displayHeight: number;
    hp: number;
    maxHp: number;
    alive: boolean;
    invincible: boolean;
    /** Game-clock ms until it can be hurt again. */
    invulnUntil: number;
    /** Invulnerable ms after a hit (hero default 1100). */
    iframes: number;
    /** Score when defeated (enemy 100, boss 5000). */
    points: number;
    contactDamage?: number;
    stompDamage?: number;
    /** Touching enemies defeats them (giant mode). */
    smash?: boolean;
    stomper?: boolean;
    dashing?: boolean;
    /** Default juice: a white flash, particles and knockback; hit-stop and shake for heroes. Returns false while invulnerable. */
    damage(n?: number, d?: DamageInfo): boolean;
    heal(n?: number): void;
    kill(): void;
    platformer(o?: PlatformerOptions): this;
    runner(o?: RunnerOptions): this;
    topdown(o?: TopdownOptions): this;
    flyer(o?: FlyerOptions): this;
    shooter(o?: ShooterOptions): this;
    patrol(speed?: Num, o?: { dir?: 1 | -1; min?: number; max?: number }): this;
    chase(target: Point, speed?: Num): this;
    wander(o?: { speed?: Num; radius?: number }): this;
    orbit(center: Point, radius: number, speed?: Num): this;
    jump(velocity?: Num): this;
    /** One-shots (attack, shoot, hurt, land, die) play over the movement; `lock` stops automatic moves. */
    play(move: Move | string, o?: { once?: boolean; ms?: number; lock?: boolean }): this;
    face(dir: number): this;
    lookAt(target: Point | null): this;
    setTint(c: number): this;
    clearTint(): this;
    setVelocity(x: number, y?: number): this;
    setVelocityX(x: number): this;
    setVelocityY(y: number): this;
    setBounce(x: number, y?: number): this;
    setDrag(x: number, y?: number): this;
    setGravityY(y: number): this;
    setImmovable(v?: boolean): this;
    on(event: 'hurt', fn: (n: number, d: DamageInfo) => void, context?: unknown): this;
    on(event: 'die', fn: (d: DamageInfo) => void, context?: unknown): this;
    on(event: 'jump', fn: (inAir: boolean) => void, context?: unknown): this;
    on(event: 'shoot', fn: (angle: number) => void, context?: unknown): this;
    on(event: 'stomp' | 'pickup', fn: (other: Actor) => void, context?: unknown): this;
    on(event: 'land' | 'drawn', fn: () => void, context?: unknown): this;
    on(event: string | symbol, fn: (...args: unknown[]) => void, context?: unknown): this;
  }

  /** A character: the student's drawing on bones (or its stand-in). Behaves like an Arcade sprite. */
  class Character extends Phaser.GameObjects.Container {
    readonly key: string;
    role: Role;
    body: Phaser.Physics.Arcade.Body;
    /** false while it is a stand-in. */
    readonly drawn: boolean;
    /** Standing on something (respects flipped gravity). */
    readonly onGround: boolean;
    facing: 1 | -1;
    /** Picks idle/walk/run/rise/fall/land from its movement (default true). */
    autoAnim: boolean;
    /** Speed (px/s) at which walking becomes running. */
    runSpeed: number;
    animSpeed: number;
    /** Growing keeps the feet on the floor (default true). */
    keepFeet: boolean;
    lockFacing: boolean;
    flipX: boolean;
    play(move: Move | string, o?: { once?: boolean; ms?: number; lock?: boolean }): this;
    face(dir: number): this;
    setFlipX(v: boolean): this;
    lookAt(target: Point | null): this;
    /** Carries something at a place on the body: 'head', 'hat', 'hand', 'handL', 'back', 'body' or 'feet'. */
    attach(obj: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform, where?: string): this;
    /** Turns into another drawing (a transformation): body, health and behaviours stay. */
    setArt(key: string): this;
    /** An afterimage (dash trails). */
    ghost(color?: Color, alpha?: number, ms?: number): void;
    setTint(c: Color): this;
    setTintFill(c?: Color): this;
    clearTint(): this;
    setBodySize(w: number, h: number): this;
  }

  interface SpawnOptions {
    role?: Role; group?: string; hp?: number; points?: number; score?: number; iframes?: number;
    gravity?: boolean | number; bounce?: number; drag?: number; immovable?: boolean; static?: boolean; bounded?: boolean;
    vx?: number; vy?: number; speed?: number; angle?: number; spin?: number;
    /** Hitbox size as a fraction of the art's w (and h). */
    hitbox?: number; hitboxH?: number; circle?: boolean;
    scale?: number; depth?: number; tint?: Color;
    /** ms, then it fades away. */
    life?: number;
    /** Bobs up and down (true or px). */
    float?: boolean | number;
    trail?: boolean | TrailOptions;
    glow?: boolean | Color;
    /** Characters: false = a flat sprite instead of bones. */
    rig?: boolean;
    /** false = no physics body. */
    body?: boolean;
    autoAnim?: boolean; runSpeed?: number;
    /** spawnEnemy(..., { boss: true }) is spawnBoss. */
    boss?: boolean;
    /** Items: return false to keep it. */
    onPickup?: (hero: Actor, item: Actor) => boolean | void;
    /** Matter. */
    friction?: number; density?: number;
  }

  interface BurstOptions {
    color?: Color; colors?: Color[]; count?: number; speed?: number | [number, number]; angle?: number | [number, number];
    life?: number; size?: number; gravity?: number; drag?: number; spin?: number; alpha?: number;
    frames?: Array<'dot' | 'spark' | 'square' | 'shard' | 'smoke' | 'ring' | 'star' | 'heart' | 'line'>;
    blend?: 'add' | 'normal'; shrink?: boolean; fade?: boolean;
  }
  interface ExplodeOptions { size?: number; color?: Color; push?: boolean; power?: number; radius?: number; damage?: number; source?: object; hitstop?: boolean }
  interface TrailOptions { frame?: string; every?: number; life?: number; size?: number; alpha?: number; color?: Color; speed?: number }

  // ---------------------------------------------------------------- juice (rate-limited, reduced-motion aware)
  interface Fx {
    /** 0.005 small … 0.03 huge. */
    shake(intensity?: number, ms?: number): void;
    /** Freezes the world 40-150 ms. */
    hitstop(ms?: number): void;
    /** Slow motion that eases back. */
    slowmo(scale?: number, ms?: number): void;
    /** At most 3 a second, softened; red flashes softer still. */
    flash(color?: Color, ms?: number, alpha?: number): void;
    /** A camera zoom kick. */
    punch(amount?: number, ms?: number): void;
    /** Colour fringing (WebGL; off with reduced motion). */
    chroma(amount?: number, ms?: number): void;
    desaturate(amount?: number, ms?: number): void;
    vignette(strength?: number): void;
    bloom(on?: boolean): void;
    burst(x: number, y: number, o?: BurstOptions): Phaser.GameObjects.Particles.ParticleEmitter;
    /** Sparks, smoke, debris, a ring, shake, flash, hit-stop and a sound, in one call. */
    explode(x: number, y: number, o?: ExplodeOptions): void;
    shockwave(x: number, y: number, o?: { radius?: number; color?: Color; alpha?: number; ms?: number }): Phaser.GameObjects.Image;
    dust(obj: Point & { displayHeight?: number }, o?: { count?: number }): void;
    /** Characters' pictures squash; hitboxes never do. */
    squash(obj: Phaser.GameObjects.GameObject, sx?: number, sy?: number, ms?: number): void;
    trail(obj: Phaser.GameObjects.GameObject & Point, o?: TrailOptions): Phaser.GameObjects.Particles.ParticleEmitter;
    ghost(obj: Phaser.GameObjects.GameObject, color?: Color): void;
    hurtFlash(obj: Phaser.GameObjects.GameObject, ms?: number): void;
    halo(obj: Phaser.GameObjects.GameObject & Point, color?: Color, size?: number): Phaser.GameObjects.Image;
    lightning(x1: number, y1: number, x2: number, y2: number, o?: { color?: Color; width?: number; segments?: number; jag?: number; ms?: number }): Phaser.GameObjects.Graphics;
    confetti(count?: number): void;
    /** 1, or 0.25 with reduced motion. */
    readonly motion: number;
  }

  // ---------------------------------------------------------------- the HUD (its own scene: never shaken, zoomed or slowed)
  interface Health { hp: number; maxHp: number; alive: boolean; active: boolean }
  interface Ui {
    text(x: number, y: number, str: string, o?: { size?: number; color?: Color; stroke?: number; originX?: number; originY?: number }): Phaser.GameObjects.Text;
    /** A big centre title: "PHASE 2!". */
    big(str: string, o?: { sub?: string; color?: Color; size?: number; ms?: number; y?: number }): Phaser.GameObjects.Text;
    /** Floating text in the world: "+100". */
    pop(x: number, y: number, str: string | number, o?: { color?: Color; size?: number; rise?: number; ms?: number }): Phaser.GameObjects.Text;
    hint(str: string, ms?: number): Phaser.GameObjects.Text;
    score(): Phaser.GameObjects.Text;
    setScore(v: number): void;
    /** Hearts for hit points (top left). */
    hearts(obj: Health): object;
    bossBar(obj: Health, name?: string, o?: { color?: Color; width?: number; height?: number; y?: number }): object;
    /** A small bar that floats over something. */
    bar(obj: Health & Point & { displayHeight?: number }, o?: { width?: number; color?: Color }): object;
    /** A speech bubble, kept on screen. */
    say(obj: Point, str: string, ms?: number): void;
    /** Space or a tap moves on. */
    dialogue(lines: Array<string | { who?: string; text: string }>): Promise<void>;
    button(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Container;
    timer(seconds: number, onDone?: () => void): { left: number; stop(): void };
    panel(lines: Array<[string, number?, string?]>, o?: { top?: number; gap?: number; alpha?: number; name?: string }): Phaser.GameObjects.GameObject[];
    clearPanel(name: string): void;
  }

  // ---------------------------------------------------------------- input (keyboard, touch buttons, gamepad)
  interface Controls {
    /** -1..1 */
    readonly x: number;
    readonly y: number;
    readonly left: boolean;
    readonly right: boolean;
    readonly up: boolean;
    readonly down: boolean;
    readonly jump: boolean;
    readonly fire: boolean;
    readonly dash: boolean;
    readonly action: boolean;
    held(a: Action): boolean;
    /** True on the frame the action started (quick taps are never lost). */
    pressed(a: Action): boolean;
    released(a: Action): boolean;
    /** In world coordinates. */
    readonly pointer: { x: number; y: number; down: boolean; justDown: boolean };
    /** Keys per action (arrows/WASD, Space/Z jump, X/J fire, Shift/K dash, E action, P pause). */
    bind: Record<Action, string[]>;
    /** What the touch buttons and the robot press. */
    readonly virtual: Partial<Record<Action, boolean>>;
  }

  // ---------------------------------------------------------------- sound and music (synthesized)
  interface SfxOptions { volume?: number; pitch?: number; vary?: number; gap?: number }
  interface Music {
    play(style?: 'boss' | 'adventure' | 'chase' | 'chill' | 'spooky' | 'chaos', o?: { bpm?: number; root?: number }): this;
    intensity(level: 0 | 1 | 2): this;
    stop(): void;
  }
  interface Combo {
    count: number;
    best: number;
    /** ms without a hit before it ends. */
    window: number;
    /** Score multiplier. */
    readonly mult: number;
    hit(x?: number, y?: number): number;
    reset(): void;
  }

  // ---------------------------------------------------------------- bullet patterns (pooled, culled, capped)
  interface Pattern {
    ring(from: Point, o?: ShotOptions & { count?: number; offset?: number; petals?: number }): Phaser.Physics.Arcade.Sprite[];
    spread(from: Point, angle: number, o?: ShotOptions & { count?: number; arc?: number }): Phaser.Physics.Arcade.Sprite[];
    aimed(from: Point, target: Point, o?: ShotOptions & { count?: number; arc?: number }): Phaser.Physics.Arcade.Sprite[];
    spiral(from: Point, o?: ShotOptions & { arms?: number; turn?: number; every?: number; duration?: number; shots?: number; start?: number }): Phaser.Time.TimerEvent;
    rain(o?: ShotOptions & { count?: number }): void;
    wall(from: Point, angle: number, o?: ShotOptions & { count?: number; gap?: number; space?: number; hole?: number }): void;
    /** Always warns first. */
    laser(from: Point, angle: number, o?: { warn?: number; duration?: number; sweep?: number; width?: number; length?: number; color?: Color }): { angle: number };
  }

  // ---------------------------------------------------------------- structure
  interface BrainState<T> { time?: number; next?: string | string[]; enter?(obj: T, b: Brain<T>): void; update?(obj: T, dt: number, b: Brain<T>): void; exit?(obj: T, b: Brain<T>): void }
  interface Brain<T> { obj: T; state: string; time: number; go(state: string | string[]): void; stop(): void }
  /** `at` = the fraction of health where the phase starts. */
  interface Phase<T> { at: number; name?: string; sub?: string; invuln?: number; enter?(obj: T, index: number): void }
  interface Wave { count?: number; every?: number; title?: string; spawn(i: number, wave: number): unknown }
  interface ParallaxLayer { draw?: 'stars' | 'mountains' | 'hills' | 'clouds' | 'city'; key?: string; color?: Color; factor?: number; y?: number; height?: number; speed?: number; depth?: number; seed?: number }
  type LegendEntry = string | ({ key: string; solid?: boolean; oneWay?: boolean; height?: number; depth?: number } & SpawnOptions) | ((x: number, y: number) => void);
  interface Ragdoll { torso: Phaser.Physics.Matter.Image; head: Phaser.Physics.Matter.Image; parts: Phaser.Physics.Matter.Image[] }
  type TwistId = 'moonGravity' | 'gravityFlips' | 'giantHero' | 'tinyHero' | 'slowmoHits' | 'slowTime' | 'bouncyWorld' | 'starRain' | 'enemyParty' | 'speedUp' | 'surpriseBoss' | 'earthquake' | 'doubleJump';
  /** Read-only: the student switches twists. */
  interface Twists {
    isOn(id: TwistId): boolean;
    readonly list: TwistId[];
  }
  interface Stats { fps: number; objects: number; particles: number; arcadeBodies: number; matterBodies: number; activeShots: number; tweens: number; drawCalls: number; timeScale: number; quality: number; state: string }

  // ---------------------------------------------------------------- the scene every game extends
  class Scene extends Phaser.Scene {
    static config?: GameConfig;
    static art?: Record<string, ArtSpec>;
    static dials?: Record<string, DialSpec>;
    static sounds?: Record<string, SoundSpec | SynthSegment[]>;

    readonly fx: Fx;
    readonly ui: Ui;
    readonly controls: Controls;
    readonly music: Music;
    readonly combo: Combo;
    readonly pattern: Pattern;
    readonly twists: Twists;
    /** Live dial values: this.dials.jump is always the current value. */
    readonly dials: Record<string, number>;
    /** Same as this.dials. */
    readonly dial: Record<string, number>;
    /** Set by spawnHero. */
    hero: Actor | null;
    score: number;
    /** Game ms: slows in slow motion, stops in hit-stop and pause. */
    readonly clock: number;
    /** Game speed (0.25 = slow motion). */
    timeScale: number;
    readonly gravityFlipped: boolean;
    readonly levelNumber: number;

    /** Declares a dial (if new) and returns its current value. */
    tune(name: string, value: number, o?: { min?: number; max?: number; step?: number; label?: string; live?: boolean; words?: string; for?: string; unit?: string }): number;
    /** The texture key for a piece of art: the drawing, or its stand-in (and asks the student for it). */
    art(key: string): string;
    /** Has the student drawn it? */
    hasArt(key: string): boolean;

    spawn(x: number, y: number, key: string, o?: SpawnOptions): Actor;
    spawnHero(x: number, y: number, key?: string, o?: SpawnOptions): Actor;
    spawnEnemy(x: number, y: number, key?: string, o?: SpawnOptions): Actor;
    spawnBoss(x: number, y: number, key?: string, o?: SpawnOptions): Actor;
    spawnItem(x: number, y: number, key?: string, o?: SpawnOptions): Actor;
    spawnProjectile(x: number, y: number, key: string, o?: ShotOptions & { angle?: number }): Phaser.Physics.Arcade.Sprite | null;
    /** Active members of a named group ('enemies', 'items', 'hazards' or your own). */
    all(group: string): Actor[];
    group(name: string, o?: { static?: boolean; gravity?: boolean; max?: number }): Phaser.Physics.Arcade.Group;
    /** A pooled shot; angle in degrees (0 right, 90 down) or a target to aim at. */
    shoot(from: Point & { role?: string; facing?: number }, angleOrTarget?: number | Point, o?: ShotOptions): Phaser.Physics.Arcade.Sprite | null;
    /** The callback gets (a, b) in the order written. */
    collide<A = Actor, B = Actor>(a: Target, b: Target, cb?: (a: A, b: B) => void): Phaser.Physics.Arcade.Collider | null;
    overlap<A = Actor, B = Actor>(a: Target, b: Target, cb?: (a: A, b: B) => void): Phaser.Physics.Arcade.Collider | null;

    every(ms: Num, fn: () => void): Phaser.Time.TimerEvent;
    after(ms: number, fn: () => void): Phaser.Time.TimerEvent;
    /** Never resolves after the level restarts. */
    wait(ms: number): Promise<void>;
    /** True at most once per `ms` for a name. */
    cooldown(name: string, ms: number): boolean;

    brain<T>(obj: T, states: Record<string, BrainState<T>>, start?: string): Brain<T>;
    phases(obj: Actor, list: Phase<Actor>[]): { index: number };
    waves(list: Wave[], o?: { between?: number; onWave?(n: number): void; onClear?(): void }): { index: number; done: boolean };

    follow(obj: Point, o?: { lerp?: number; lerpY?: number; lockY?: boolean | number; offsetX?: number; offsetY?: number; deadzone?: [number, number]; lookahead?: number }): Phaser.Cameras.Scene2D.Camera;
    worldSize(w: number, h: number): void;
    parallax(layers: ParallaxLayer[]): Phaser.GameObjects.TileSprite[];
    weather(kind: 'rain' | 'snow' | 'embers' | 'bubbles', o?: { amount?: number; depth?: number }): Phaser.GameObjects.Particles.ParticleEmitter | null;
    /** '#' is ground; runs of tiles become single platforms. */
    level(rows: string[], o?: { tile?: number; legend?: Record<string, LegendEntry>; bounds?: boolean }): { width: number; height: number; platforms: Phaser.Physics.Arcade.StaticGroup };
    platform(x: number, y: number, w: number, h?: number, key?: string, o?: { oneWay?: boolean; depth?: number }): Phaser.GameObjects.TileSprite;
    /** Endless worlds: make(x0, index) builds each chunk just ahead of the camera. */
    chunks(o: { size?: number; start?: number; ahead?: number; make(x0: number, index: number): void }): { next: number; index: number };
    flipGravity(): 1 | -1;
    portal(a: Point, b: Point, o?: { color?: Color; key?: string }): void;

    win(text?: string): void;
    lose(text?: string): void;
    /** Starts the level again. */
    restart(): void;
    /** Announces a level: this.setLevel(2, 'THE CAVES'). */
    setLevel(n: number, title?: string): void;
    /** Combo-multiplied; pops "+n" at (x, y). */
    addScore(n: number, x?: number, y?: number): number;
    /** Saved with the game. */
    highScore(): number;
    setHighScore(n: number): void;
    sfx(name: SoundName | string | SynthSegment[], o?: SfxOptions): void;

    rand(a?: number, b?: number): number;
    pick<T>(arr: readonly T[]): T;
    chance(p: number): boolean;
    dist(a: Point, b: Point): number;
    /** Degrees from a to b (0 right, 90 down). */
    angleTo(a: Point, b: Point): number;

    // physics chaos (Matter; blast also pushes Arcade bodies)
    blast(x: number, y: number, o?: { radius?: number; power?: number }): void;
    box(x: number, y: number, w: number, h: number, o?: { key?: string; bounce?: number; friction?: number; density?: number; static?: boolean; air?: number; depth?: number }): Phaser.Physics.Matter.Image;
    ball(x: number, y: number, r: number, o?: { key?: string; bounce?: number; friction?: number; density?: number; air?: number; depth?: number }): Phaser.Physics.Matter.Image;
    stack(x: number, y: number, cols: number, rows: number, o?: { w?: number; h?: number; key?: string }): Phaser.Physics.Matter.Image[];
    pyramid(x: number, y: number, rows: number, o?: { w?: number; h?: number; key?: string }): Phaser.Physics.Matter.Image[];
    wreckingBall(ax: number, ay: number, o?: { length?: number; radius?: number; angle?: number; key?: string; density?: number }): Phaser.Physics.Matter.Image;
    /** The character's own picture, cut at its joints. */
    ragdoll(x: number, y: number, key?: string, o?: { scale?: number; depth?: number }): Ragdoll;
    /** Drag Matter bodies with the mouse or a finger. */
    grab(o?: { stiffness?: number }): Phaser.Physics.Matter.PointerConstraint;
    /** Sparks and thuds on hard hits. */
    impacts(o?: { speed?: number }): void;
    stats(): Stats;
    /** The actions the game reads (touch buttons are built from them). */
    usedActions(): Action[];
  }

  /** Read-only player settings. */
  const prefs: { readonly reducedMotion: boolean; readonly muted: boolean; readonly touch: boolean };
  const util: {
    rand(a?: number, b?: number): number;
    randInt(a: number, b: number): number;
    pick<T>(arr: readonly T[]): T;
    chance(p: number): boolean;
    clamp(v: number, a: number, b: number): number;
    lerp(a: number, b: number, t: number): number;
    dist(a: Point, b: Point): number;
    angleTo(a: Point, b: Point): number;
    approach(v: number, target: number, step: number): number;
  };
  /** Reads a live-or-fixed option. */
  function num(v: Num, fallback: number): number;
  const SOUNDS: readonly SoundName[];
  const TWISTS: readonly TwistId[];
  const version: string;
  /** Starts a game from a class (the runtime does this by itself for `class Game`). */
  function boot(GameClass: typeof Scene): Phaser.Game | null;
}
