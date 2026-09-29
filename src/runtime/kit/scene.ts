/**
 * `Amble.Scene`: what every game extends.
 *
 *   class Game extends Amble.Scene {
 *     static config = { title: 'MOON KING', physics: 'arcade', gravity: 1500 };
 *     static art = { hero: { kind: 'character', rig: 'biped', role: 'hero', ask: 'Draw your hero' } };
 *     static dials = { jump: { label: 'Jump power', value: 720, min: 400, max: 1100 } };
 *     create() { this.hero = this.spawnHero(140, 420, 'hero').platformer({ jump: () => this.dials.jump }); }
 *     update(time, dt) {}
 *   }
 *
 * All of Phaser stays available on `this`. The kit adds spawning, juice, HUD, controls, sound, patterns,
 * brains, phases, waves, levels, twists and dials, with a forgiving runtime around the game's own code.
 */
import Phaser from 'phaser';
import type { Action, Role } from '../../play/protocol';
import { addHealth, installActor, spriteFallbacks } from './actors';
import { Music, playSfx, type SfxOptions } from './audio';
import { Character } from './character';
import { colorInt } from './color';
import { Combo } from './combo';
import { Controls } from './controls';
import { numOf, type Num } from './dials';
import { env } from './env';
import { fitModeFor, fitSize } from './fit';
import { Fx } from './fx';
import { buildFxAtlas } from './fxAtlas';
import * as matter from './matter';
import { Pattern } from './pattern';
import { applyTwists, twistsView, undoTwists } from './twists';
import { Kit, type Brain, type BrainState, type KitConfig, type PhaseDef, type Shot } from './state';
import { SCENE_SYNONYMS, forgiving } from '../../play/kit/synonyms';
import { arcadeBody, isActor, type Actor, type Point, type ShotOptions } from './types';
import { Ui, UI_SCENE } from './ui';
import { DEG, isPoint, util } from './util';
import * as world from './world';
import type { SynthSegment } from '../../audio/synth';

export interface SpawnOptions {
  role?: Role;
  group?: string;
  hp?: number;
  points?: number;
  score?: number;
  iframes?: number;
  gravity?: boolean | number;
  bounce?: number;
  drag?: number;
  immovable?: boolean;
  static?: boolean;
  bounded?: boolean;
  vx?: number;
  vy?: number;
  speed?: number;
  angle?: number;
  spin?: number;
  hitbox?: number;
  hitboxH?: number;
  circle?: boolean;
  scale?: number;
  depth?: number;
  tint?: unknown;
  life?: number;
  float?: boolean | number;
  trail?: boolean | Record<string, unknown>;
  glow?: boolean | unknown;
  rig?: boolean;
  body?: boolean;
  autoAnim?: boolean;
  runSpeed?: number;
  boss?: boolean;
  onPickup?: (hero: Actor, item: Actor) => boolean | void;
  friction?: number;
  density?: number;
}

type Target = Phaser.GameObjects.GameObject | Phaser.GameObjects.Group | string | Array<Phaser.GameObjects.GameObject | Phaser.GameObjects.Group | string>;
type Collidable = Phaser.Types.Physics.Arcade.ArcadeColliderType;

/** The class config the boot step prepared (static config merged with defaults). */
export interface SceneClass {
  __ambleConfig?: KitConfig;
  config?: unknown;
  art?: unknown;
  dials?: unknown;
  sounds?: unknown;
}

let activeScene: AmbleScene | null = null;

export function currentScene(): AmbleScene | null {
  return activeScene && activeScene.__kit && !activeScene.__kit.dead ? activeScene : null;
}

export class AmbleScene extends Phaser.Scene {
  __kit: Kit | null = null;
  fx!: Fx;
  ui!: Ui;
  controls!: Controls;
  music!: Music;
  combo!: Combo;
  pattern!: Pattern;

  constructor(config?: string | Phaser.Types.Scenes.SettingsConfig) {
    const cfg: Phaser.Types.Scenes.SettingsConfig = typeof config === 'string' ? { key: config } : { key: 'game', ...config };
    // The game scene starts right after the UI scene (only the first scene in a list auto-starts).
    cfg.active = true;
    super(cfg);
    const userCreate = this.create as (data?: object) => void;
    const userUpdate = this.update;
    const sys = this.sys;
    const origStep = sys.step;
    sys.step = (time: number, delta: number) => {
      const k = this.__kit;
      if (!k || k.dead) {
        origStep.call(sys, time, delta);
        return;
      }
      if (env().crashed()) return;
      const s = k.frameScale(delta);
      try {
        origStep.call(sys, time, delta * s);
        k.realTick(delta);
      } catch (err) {
        env().report(err, 'update');
      }
    };
    this.create = function (this: AmbleScene, data?: object) {
      this.setupKit();
      const k = this.__kit;
      if (!k) return;
      env().dials.startBuilding();
      if (typeof userCreate === 'function') {
        try {
          userCreate.call(this, data ?? {});
        } catch (err) {
          env().report(err, 'create');
        }
      }
      applyTwists(this, k);
      env().dials.doneBuilding();
      this.afterCreate();
    };
    this.update = function (this: AmbleScene, time: number, delta: number) {
      const k = this.__kit;
      if (!k || k.state !== 'play' || k.paused || env().crashed()) return;
      if (typeof userUpdate === 'function') {
        try {
          userUpdate.call(this, time, delta);
        } catch (err) {
          env().report(err, 'update');
        }
      }
    };
  }

  create(): void {}

  update(_time?: number, _delta?: number): void {}

  private setupKit(): void {
    activeScene = this;
    const ctor = this.constructor as SceneClass;
    const reg = boot.registry(this.game);
    const cfg = ctor.__ambleConfig ?? boot.defaultConfig();
    const uiScene = this.scene.get(UI_SCENE) ?? this;
    // A level restart reuses this scene: the level it was on carries over, so setLevel(2) then restart()
    // builds level 2 (and R after losing tries the same level again). Playing again after a win starts at 1.
    const before = this.__kit;
    const k = new Kit(this, cfg, reg, uiScene);
    if (before && before.state !== 'won') k.levelNumber = before.levelNumber;
    this.__kit = k;
    buildFxAtlas(this);
    k.fx = new Fx(k);
    this.fx = forgiving(k.fx, 'fx', (m) => env().post({ type: 'warn', message: m }));
    k.ui = new Ui(k);
    this.ui = forgiving(k.ui, 'ui', (m) => env().post({ type: 'warn', message: m }));
    k.controls = new Controls(this, k.actionsUsed);
    this.controls = k.controls;
    k.music = new Music(this);
    this.music = forgiving(k.music, 'music', (m) => env().post({ type: 'warn', message: m }));
    k.combo = new Combo(k);
    this.combo = k.combo;
    k.pattern = new Pattern(k);
    this.pattern = forgiving(k.pattern, 'pattern', (m) => env().post({ type: 'warn', message: m }));
    matter.resetProps();
    this.events.on(Phaser.Scenes.Events.PRE_UPDATE, k.pre, k);
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, k.post, k);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Scene emitters survive restart(): unhook this kit, or the old one keeps running beside the new one.
      this.events.off(Phaser.Scenes.Events.PRE_UPDATE, k.pre, k);
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, k.post, k);
      undoTwists(this, k);
      k.shutdown();
      boot.sceneShutdown(this);
    });
  }

  private afterCreate(): void {
    const k = this.__kit;
    if (!k) return;
    if (k.cfg.background) this.cameras.main.setBackgroundColor(k.cfg.background);
    const titled = !!k.cfg.title && !boot.autostart();
    if (titled) {
      k.state = 'title';
      const touch = env().prefs.touch === 'on';
      const objs = k.ui.panel([[k.cfg.title, 72, '#ffe45e'], [k.cfg.subtitle, 26, '#ffffff'], [touch ? 'TAP TO START' : 'PRESS SPACE OR TAP TO START', 22, '#9ff3ff']], { top: 0.3, gap: 78, alpha: 0.55, name: 'title' });
      const blink = objs[objs.length - 1];
      k.uiScene.tweens.add({ targets: blink, alpha: 0.3, yoyo: true, repeat: -1, duration: 500 });
      env().post({ type: 'event', event: { kind: 'title', text: k.cfg.title, sub: k.cfg.subtitle } });
      env().post({ type: 'state', state: 'title' });
    } else k.start(true);
    boot.afterCreate(this);
  }

  // ---------------------------------------------------------------- kit accessors

  private get k(): Kit {
    if (!this.__kit) throw new Error('The Amble kit is only ready inside create() and update().');
    return this.__kit;
  }

  /** Live dial values: `this.dials.jump` is always the current value. */
  get dials(): Record<string, number> {
    return boot.dialsView();
  }

  /** Same as `this.dials`. */
  get dial(): Record<string, number> {
    return boot.dialsView();
  }

  /** Declares a dial (if new) and returns its current value: `this.tune('jump', 720, { min: 400, max: 1100 })`. */
  tune(name: string, value: number, o: { min?: number; max?: number; step?: number; label?: string; live?: boolean; words?: string } = {}): number {
    const v = env().dials.tune(String(name), Number(value), o);
    boot.dialsMaybeChanged();
    return v;
  }

  /** The student switched these twists on (read-only for game code). */
  get twists(): { isOn(id: string): boolean; readonly list: string[] } {
    return twistsView();
  }

  get hero(): Actor | null {
    return this.__kit?.hero ?? null;
  }

  set hero(v: Actor | null) {
    if (this.__kit) this.__kit.hero = v;
  }

  get score(): number {
    return this.__kit?.score ?? 0;
  }

  set score(v: number) {
    if (!this.__kit) return;
    this.__kit.score = Number(v) || 0;
    this.__kit.ui.setScore(this.__kit.score);
  }

  /** Game time in ms: slows in slow-mo, stops during hit-stop and pause. */
  get clock(): number {
    return this.__kit?.clock ?? 0;
  }

  /** Global game speed (0.25 = slow motion). */
  get timeScale(): number {
    return this.__kit?.userScale ?? 1;
  }

  set timeScale(v: number) {
    // At most 10x: the physics catches up on game time in fixed steps, so an endless speed (a ratio with a
    // zero under it) would never finish a frame, and a huge one freezes the game just the same.
    const n = Number(v);
    if (this.__kit) this.__kit.userScale = n > 0 ? Math.min(10, n) : 0;
  }

  get gravityFlipped(): boolean {
    return (this.__kit?.gravitySign ?? 1) < 0;
  }

  get levelNumber(): number {
    return this.__kit?.levelNumber ?? 1;
  }

  // ---------------------------------------------------------------- art

  /** Texture key for a piece of art (the drawing, or its stand-in), and asks the student for it if missing. */
  art(key: string): string {
    return this.k.art.raw(String(key));
  }

  /** Has the student drawn it yet? */
  hasArt(key: string): boolean {
    return this.k.art.isDrawn(String(key));
  }

  // ---------------------------------------------------------------- spawning

  /** Spawns something from an art key. Characters come back rigged; everything gets health and behaviours. */
  spawn(x: number | string, y: number | string, key: string | number | SpawnOptions, o: SpawnOptions = {}): Actor {
    // Tolerate the other common argument order: spawn('key', x, y, opts).
    if (typeof x === 'string' && typeof y === 'number') {
      const args = [x, y, key, o] as const;
      return this.spawn(args[1], Number(args[2]), args[0], (typeof args[3] === 'object' ? args[3] : {}) as SpawnOptions);
    }
    const k = this.k;
    const px = Number(x) || 0;
    const py = Number(y) || 0;
    const artKey = String(key);
    const spec = k.art.spec(artKey);
    const role: Role = o.role ?? spec.role;
    const scaleMul = o.scale ?? 1;
    let a: Actor;
    if (k.physicsType === 'matter') {
      const round = !!o.circle || spec.shape === 'ellipse' || spec.shape === 'coin';
      const img = this.matter.add.image(px, py, k.art.raw(artKey), undefined, {
        shape: round ? { type: 'circle', radius: Math.min(spec.w, spec.h) / 2 } : { type: 'rectangle', width: spec.w, height: spec.h },
        restitution: o.bounce ?? 0.1,
        friction: o.friction ?? 0.5,
        density: o.density ?? 0.002,
        isStatic: !!o.static,
      });
      if (scaleMul !== 1) img.setScale(scaleMul);
      a = installActor(k, img, artKey, spec, role);
      spriteFallbacks(k, a);
    } else if (spec.kind === 'character' && o.rig !== false) {
      const c = new Character(this, k, px, py, artKey, { role, autoAnim: o.autoAnim, runSpeed: o.runSpeed });
      a = installActor(k, c, artKey, spec, role);
      if (k.physicsType === 'arcade' && o.body !== false) {
        this.physics.add.existing(c);
        const b = arcadeBody(c);
        if (b) {
          const bw = spec.w * (o.hitbox ?? 0.7);
          const bh = spec.h * (o.hitboxH ?? (spec.rig === 'blob' ? 0.8 : 0.95));
          b.setSize(bw, bh, false);
          b.setOffset((spec.w - bw) / 2, spec.rig === 'blob' ? (spec.h - bh) / 2 : spec.h - bh);
        }
      }
      if (scaleMul !== 1) c.setScale(scaleMul);
    } else {
      const tex = k.art.hd(artKey);
      const withBody = k.physicsType === 'arcade' && o.body !== false;
      const sprite = withBody ? this.physics.add.sprite(px, py, tex) : this.add.sprite(px, py, tex);
      const mode = fitModeFor(spec.kind);
      const fitFor = (frame: Phaser.Textures.Frame) => {
        const f = fitSize(mode, spec.w * scaleMul, spec.h * scaleMul, frame.realWidth, frame.realHeight);
        return { w: f.w, h: f.h };
      };
      const size = fitFor(sprite.frame);
      sprite.setDisplaySize(size.w, size.h);
      a = installActor(k, sprite, artKey, spec, role);
      a.__ambleFit = fitFor;
      spriteFallbacks(k, a);
      const b = arcadeBody(sprite);
      if (b) {
        const hb = o.hitbox ?? 0.85;
        const sx = Math.abs(sprite.scaleX) || 1;
        const sy = Math.abs(sprite.scaleY) || 1;
        if (o.circle || spec.shape === 'ellipse' || spec.shape === 'coin') {
          const r = ((Math.min(spec.w, spec.h) * scaleMul) / 2) * hb / sx;
          b.setCircle(r, sprite.width / 2 - r, sprite.height / 2 - r);
        } else b.setSize((spec.w * scaleMul * hb) / sx, (spec.h * scaleMul * hb) / sy, true);
      }
    }
    const groupName = o.group ?? (role === 'enemy' || role === 'boss' ? 'enemies' : role === 'item' ? 'items' : role === 'hazard' ? 'hazards' : null);
    if (groupName && k.physicsType === 'arcade') k.group(groupName).add(a);
    const b = arcadeBody(a);
    if (b && k.physicsType === 'arcade') {
      const grav = o.gravity ?? (role === 'item' || role === 'hazard' || role === 'boss' || role === 'projectile' || role === 'decor' || spec.kind === 'background' ? false : true);
      b.setAllowGravity(grav !== false);
      if (typeof grav === 'number') b.setGravityY(grav);
      if (o.bounce !== undefined) b.setBounce(o.bounce);
      if (o.drag !== undefined) b.setDrag(o.drag, o.drag);
      if (o.immovable || role === 'boss' || o.static) b.setImmovable(true);
      if (o.static) b.setAllowGravity(false);
      if (o.bounded ?? role === 'hero') b.setCollideWorldBounds(true);
      if (o.speed !== undefined && o.angle !== undefined) b.setVelocity(Math.cos(o.angle * DEG) * o.speed, Math.sin(o.angle * DEG) * o.speed);
      else b.setVelocity(o.vx ?? 0, o.vy ?? 0);
      if (grav !== false && role !== 'hero' && (role === 'enemy' || role === 'item' || role === 'npc' || role === 'prop')) {
        k.once('plat:' + (groupName ?? artKey), () => this.collide(groupName ?? a, 'platforms'));
      }
    }
    if (o.hp || role === 'hero' || role === 'boss' || role === 'enemy') {
      addHealth(k, a, o.hp ?? (role === 'hero' ? 3 : role === 'boss' ? 60 : 1), { iframes: o.iframes, points: o.points ?? o.score });
    }
    a.setDepth(o.depth ?? (role === 'hero' ? 400 : role === 'boss' ? 300 : role === 'item' ? 200 : 250));
    if (o.tint !== undefined) a.setTint(colorInt(o.tint));
    if (o.life) this.time.delayedCall(o.life, () => a.active && this.tweens.add({ targets: a, alpha: 0, duration: 200, onComplete: () => a.destroy() }));
    if (o.spin && b) b.setAngularVelocity(o.spin);
    if (o.float) this.tweens.add({ targets: a, y: py - (o.float === true ? 8 : Number(o.float)), yoyo: true, repeat: -1, duration: 700 + Math.random() * 300, ease: 'Sine.easeInOut' });
    if (o.trail) k.fx.trail(a, o.trail === true ? {} : o.trail);
    if (o.glow) k.fx.halo(a, o.glow === true ? spec.color : o.glow);
    if (o.onPickup) a.onPickup = o.onPickup;
    if (o.points !== undefined) a.points = o.points;
    if (role === 'enemy' || role === 'boss') this.wireCombat();
    if (role === 'item') this.wirePickups();
    if (role === 'hazard') this.wireHazards();
    this.events.emit('spawn', a);
    return a;
  }

  /** The player's character: health, hearts-ready, lands on platforms, wired to take hits. */
  spawnHero(x: number, y: number, key: string = 'hero', o: SpawnOptions = {}): Actor {
    if (typeof x === 'string') return this.spawnHero(y, Number(key), x, o);
    const h = this.spawn(x, y, key, { role: 'hero', ...o });
    const k = this.k;
    k.hero = h;
    if (k.physicsType === 'arcade') {
      k.once('hero-plat', () => this.collide(h, 'platforms'));
      this.wireCombat();
      this.wirePickups();
      this.wireHazards();
    }
    boot.controlsChanged();
    return h;
  }

  spawnEnemy(x: number, y: number, key: string = 'enemy', o: SpawnOptions = {}): Actor {
    if (typeof x === 'string') return this.spawnEnemy(y, Number(key), x, o);
    return this.spawn(x, y, key, { role: o.boss ? 'boss' : 'enemy', ...o });
  }

  /** A boss: big health, a bar-ready enemy that does not fall or get knocked back. */
  spawnBoss(x: number, y: number, key: string = 'boss', o: SpawnOptions = {}): Actor {
    if (typeof x === 'string') return this.spawnBoss(y, Number(key), x, o);
    return this.spawn(x, y, key, { role: 'boss', hp: 60, ...o });
  }

  /** A pickup: floats, sparkles when the hero takes it, adds points (or runs onPickup). */
  spawnItem(x: number, y: number, key: string = 'coin', o: SpawnOptions = {}): Actor {
    if (typeof x === 'string') return this.spawnItem(y, Number(key), x, o);
    return this.spawn(x, y, key, { role: 'item', ...o });
  }

  /** A projectile that is not fired by anyone: `spawnProjectile(x, y, 'rock', { angle: 90, speed: 300 })`. */
  spawnProjectile(x: number, y: number, key: string, o: ShotOptions & { angle?: number } = {}): Phaser.Physics.Arcade.Sprite | null {
    return this.shoot({ x, y, role: o.role === 'hero' ? 'hero' : 'enemy' }, o.angle ?? 90, { ...o, key });
  }

  private wireCombat(): void {
    const k = this.k;
    if (k.physicsType !== 'arcade') return;
    k.once('combat-shots', () =>
      this.overlap('heroShots', 'enemies', (shot: Shot, e: Actor) => {
        if (!shot.active || !e.alive) return;
        if (shot.hitSet?.has(e)) return;
        e.damage(shot.damageAmount || 1, { from: shot, x: shot.x, y: shot.y, knockback: 60 });
        if (shot.pierce > 0) {
          (shot.hitSet ??= new Set()).add(e);
          shot.pierce--;
        } else k.killShot(shot);
      }),
    );
    const h = k.hero;
    if (!h) return;
    k.once('combat-hero', () => {
      this.overlap(h, 'enemyShots', (hero: Actor, shot: Shot) => {
        if (!shot.active || !hero.alive) return;
        if (hero.damage(shot.damageAmount || 1, { from: shot })) k.killShot(shot);
      });
      this.overlap(h, 'enemies', (hero: Actor, e: Actor) => {
        if (!hero.alive || !e.alive || e.contactDamage === 0) return;
        const hb = arcadeBody(hero);
        const eb = arcadeBody(e);
        if (!hb || !eb) return;
        const gs = k.gravitySign;
        const falling = hb.velocity.y * gs > 40;
        const above = gs > 0 ? hb.bottom <= eb.top + eb.height * 0.45 : hb.top >= eb.bottom - eb.height * 0.45;
        if ((hero.stomper && falling && above && e.role !== 'boss') || hero.smash) {
          e.damage(hero.smash ? 99 : e.stompDamage ?? 99, { from: hero });
          if (!hero.smash) {
            hb.velocity.y = -(hero.ctl ? numOf(hero.ctl.opts.jump, 640) * 0.85 : 520) * gs;
            if (hero.ctl) hero.ctl.airJumps = Math.max(0, Math.round(numOf(hero.ctl.opts.jumps, 1)) - 1 + hero.ctl.bonusJumps);
          }
          k.fx.hitstop(50);
          k.fx.shake(0.008, 120);
          this.sfx('stomp');
          hero.emit('stomp', e);
          return;
        }
        hero.damage(e.contactDamage ?? 1, { from: e });
      });
    });
  }

  private wirePickups(): void {
    const k = this.k;
    const h = k.hero;
    if (!h || k.physicsType !== 'arcade') return;
    k.once('pickups', () =>
      this.overlap(h, 'items', (hero: Actor, item: Actor) => {
        if (!item.active || item.taken) return;
        item.taken = true;
        const pick = item.onPickup;
        const handled = pick ? k.guard(() => pick(hero, item), pick) : undefined;
        this.events.emit('pickup', item, hero);
        hero.emit('pickup', item);
        if (handled !== false) {
          this.sfx(item.sound ?? 'coin', { pitch: 1 + Math.min(0.6, k.combo.count * 0.04) });
          k.fx.burst(item.x, item.y, { frames: ['star', 'dot'], colors: [0xffffff, item.spec.color], count: 10, speed: [60, 240], life: 420, size: 0.55 });
          if (item.points !== 0) k.addScore(item.points || 10, item.x, item.y - 16);
          const ib = arcadeBody(item);
          if (ib) ib.enable = false;
          this.tweens.killTweensOf(item);
          this.tweens.add({ targets: item, scale: item.scale * 1.8, alpha: 0, y: item.y - 24, duration: 220, onComplete: () => item.destroy() });
        }
      }),
    );
  }

  private wireHazards(): void {
    const k = this.k;
    const h = k.hero;
    if (!h || k.physicsType !== 'arcade') return;
    k.once('hazards', () => this.overlap(h, 'hazards', (hero: Actor, hz: Actor) => hero.damage(hz.contactDamage ?? 1, { from: hz })));
  }

  /** A named group (created on first use). */
  group(name: string, o?: { static?: boolean; gravity?: boolean; max?: number }): Phaser.Physics.Arcade.Group {
    return this.k.group(String(name), o) as Phaser.Physics.Arcade.Group;
  }

  /** Active members of a group (pooled, dead objects are skipped). */
  all(name: string): Actor[] {
    const g = this.k.groups.get(String(name));
    if (!g) return [];
    return g.getChildren().filter((c): c is Actor => c.active && (!isActor(c) || c.alive !== false)) as Actor[];
  }

  private resolve(t: Target): Collidable {
    if (typeof t === 'string') return this.k.group(t) as Collidable;
    if (Array.isArray(t)) return t.map((x) => this.resolve(x)) as unknown as Collidable;
    return t as Collidable;
  }

  /** Solid collisions between objects, groups or group names. The callback gets (a, b) in the order written. */
  collide<A = Actor, B = Actor>(a: Target, b: Target, cb?: (a: A, b: B) => void): Phaser.Physics.Arcade.Collider | null {
    return this.pair('collider', a, b, cb as ((a: unknown, b: unknown) => void) | undefined);
  }

  /** Overlap (pass-through) test. The callback gets (a, b) in the order written. */
  overlap<A = Actor, B = Actor>(a: Target, b: Target, cb?: (a: A, b: B) => void): Phaser.Physics.Arcade.Collider | null {
    return this.pair('overlap', a, b, cb as ((a: unknown, b: unknown) => void) | undefined);
  }

  private pair(kind: 'collider' | 'overlap', a: Target, b: Target, cb?: (a: unknown, b: unknown) => void): Phaser.Physics.Arcade.Collider | null {
    if (!this.physics?.add) return null;
    const A = this.resolve(a);
    const B = this.resolve(b);
    const isGroup = (x: unknown) => x instanceof Phaser.GameObjects.Group || Array.isArray(x);
    const swap = isGroup(A) && !isGroup(B);
    const k = this.k;
    const fn = cb ? (o1: unknown, o2: unknown) => k.guard(() => (swap ? cb(o2, o1) : cb(o1, o2)), cb) : undefined;
    return kind === 'collider' ? this.physics.add.collider(A, B, fn as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback) : this.physics.add.overlap(A, B, fn as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback);
  }

  /** Fires a pooled projectile from something. angle: degrees, or a target to aim at. */
  shoot(from: Point & { role?: string; facing?: number }, angle?: number | Point, o: ShotOptions = {}): Phaser.Physics.Arcade.Sprite | null {
    const k = this.k;
    if (k.physicsType !== 'arcade' || !isPoint(from)) return null;
    let a = typeof angle === 'number' ? angle : isPoint(angle) ? util.angleTo(from, angle) : (from.facing ?? 1) < 0 ? 180 : 0;
    if (o.spread) a += util.rand(-o.spread, o.spread);
    const role: 'hero' | 'enemy' = o.role ?? (from.role === 'hero' ? 'hero' : 'enemy');
    const key = o.key ?? (role === 'hero' ? 'shot' : 'orb');
    if (!k.art.specs.has(key)) k.art.specs.set(key, { ...k.art.spec(key), kind: 'projectile', role: role === 'hero' ? 'projectile' : 'enemyShot' });
    const spec = k.art.spec(key);
    const pool = k.pool(o.group ?? (role === 'hero' ? 'heroShots' : 'enemyShots'));
    const x = from.x + (o.offsetX ?? 0) + Math.cos(a * DEG) * (o.muzzle ?? 0);
    const y = from.y + (o.offsetY ?? 0) + Math.sin(a * DEG) * (o.muzzle ?? 0);
    const tex = k.art.hd(key);
    const s = pool.get(x, y, tex) as Shot | null;
    if (!s) return null;
    s.enableBody(true, x, y, true, true);
    s.setTexture(tex);
    const fit = fitSize('contain', spec.w, spec.h, s.frame.realWidth, s.frame.realHeight);
    const scale = o.scale ?? 1;
    s.setDisplaySize(fit.w * scale, fit.h * scale)
      .setAlpha(1)
      .clearTint()
      .setDepth(o.depth ?? (role === 'hero' ? 450 : 500))
      .setBlendMode(o.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setAngle(o.rotate === false ? 0 : a);
    if (o.color !== undefined) s.setTint(colorInt(o.color));
    const body = arcadeBody(s);
    if (!body) return s;
    const sx = Math.abs(s.scaleX) || 1;
    const r = Math.max(3, ((Math.min(spec.w, spec.h) * scale) / 2) * (o.hitbox ?? 0.8)) / sx;
    body.setCircle(r, s.width / 2 - r, s.height / 2 - r);
    body.setAllowGravity(!!o.gravity);
    body.setGravityY(typeof o.gravity === 'number' ? o.gravity - this.physics.world.gravity.y : 0);
    body.setBounce(o.bounce ?? 0);
    const sp = numOf(o.speed, role === 'hero' ? 820 : 230);
    body.setVelocity(Math.cos(a * DEG) * sp, Math.sin(a * DEG) * sp);
    body.setAcceleration(o.accel ? Math.cos(a * DEG) * o.accel : 0, o.accel ? Math.sin(a * DEG) * o.accel : 0);
    s.born = k.clock;
    s.life = o.life ?? 6000;
    s.damageAmount = numOf(o.damage, 1);
    s.pierce = o.pierce ?? 0;
    s.hitSet = null;
    s.role = role;
    s.homing = o.homing ?? null;
    s.turn = (o.turn ?? 120) * DEG;
    s.spin = o.spin ?? 0;
    s.onExpire = (o.onExpire as ((shot: Shot) => void) | undefined) ?? null;
    s.solid = !!(o.bounce || o.solid);
    if (s.solid) {
      k.once('solid:' + pool.name, () =>
        this.physics.add.collider(
          pool,
          this.group('platforms'),
          (shot) => {
            const sh = shot as Shot;
            if (!sh.bounceSfx || k.clock - sh.bounceSfx > 120) {
              sh.bounceSfx = k.clock;
              this.sfx('thud', { volume: 0.4 });
            }
          },
          (shot) => (shot as Shot).solid,
        ),
      );
    }
    return s;
  }

  // ---------------------------------------------------------------- time (all on the game clock)

  /** Runs fn every `ms` of game time (ms may be live: `() => this.dials.rate`). */
  every(ms: Num, fn: () => void): Phaser.Time.TimerEvent {
    const k = this.k;
    const ev = this.time.addEvent({ delay: Math.max(16, numOf(ms, 1000)), loop: true, callback: () => {
      k.guard(fn);
      // Phaser reads `delay` on every tick, so a live interval can change it (its typings mark it read-only).
      if (typeof ms === 'function') (ev as unknown as { delay: number }).delay = Math.max(16, numOf(ms, ev.delay));
    } });
    return ev;
  }

  after(ms: number, fn: () => void): Phaser.Time.TimerEvent {
    const k = this.k;
    return this.time.delayedCall(Math.max(0, Number(ms) || 0), () => k.guard(fn));
  }

  /** A promise for `await this.wait(500)`; it never resolves after the level restarts. */
  wait(ms: number): Promise<void> {
    const k = this.k;
    return new Promise((resolve) => {
      this.time.delayedCall(Math.max(0, Number(ms) || 0), () => {
        if (!k.dead) resolve();
      });
    });
  }

  /** True at most once every `ms` for a name: `if (this.cooldown('shout', 500)) ...` */
  cooldown(name: string, ms: number): boolean {
    const k = this.k;
    const last = k.cooldowns.get(name) ?? -1e12;
    if (last + ms <= k.clock) {
      k.cooldowns.set(name, k.clock);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- brains, phases, waves

  /** A state machine for enemies and bosses: each state can last `time` ms, then goes to `next`. */
  brain<T>(obj: T, states: Record<string, BrainState<T>>, start?: string): Brain<T> {
    const k = this.k;
    const b: Brain<T> = {
      obj,
      states,
      state: '',
      time: 0,
      stopped: false,
      go: (name: string | string[]) => {
        const next = Array.isArray(name) ? util.pick(name) : name;
        const prev = states[b.state];
        const exit = prev?.exit;
        if (exit) k.guard(() => exit(obj, b), exit);
        b.state = next;
        b.time = 0;
        const st = states[next];
        const enter = st?.enter;
        if (enter) k.guard(() => enter(obj, b), enter);
      },
      stop: () => {
        b.stopped = true;
      },
    };
    k.brains.push(b as Brain<unknown>);
    b.go(start ?? Object.keys(states)[0]);
    return b;
  }

  /** Boss phases by health fraction, with a big transition (title, shake, flash, invulnerability, music). */
  phases(obj: Actor, list: PhaseDef<Actor>[]): { index: number } {
    const k = this.k;
    const p = { obj, list: list.map((ph) => ({ ...ph, at: typeof ph.at === 'number' ? ph.at : 1 })).sort((a, b) => b.at - a.at), index: -1 };
    k.phaseWatch.push(p);
    k.ui.addTicks(obj, p.list.filter((ph) => ph.at < 1).map((ph) => ph.at));
    k.tickPhases(p);
    return p;
  }

  /** Waves of enemies; the next wave starts when all of the last one are gone. */
  waves(list: Array<{ count?: number; every?: number; title?: string; spawn(i: number, wave: number): unknown }>, o: { between?: number; onWave?(n: number): void; onClear?(): void } = {}): { index: number; done: boolean } {
    const k = this.k;
    const w = { index: -1, alive: [] as Array<{ active?: boolean; alive?: boolean }>, spawning: false, waiting: false, done: false };
    const next = () => {
      w.index++;
      if (w.index >= list.length) {
        w.done = true;
        if (o.onClear) k.guard(o.onClear);
        return;
      }
      const wave = list[w.index];
      const title = wave.title || 'WAVE ' + (w.index + 1);
      k.ui.big(title, { ms: 900 });
      env().post({ type: 'event', event: { kind: 'level', value: w.index + 1, text: title } });
      const onWave = o.onWave;
      if (onWave) k.guard(() => onWave(w.index + 1), onWave);
      w.spawning = true;
      let n = 0;
      const total = Math.max(1, wave.count ?? 5);
      this.time.addEvent({
        delay: Math.max(16, wave.every ?? 500),
        repeat: total - 1,
        callback: () => {
          const e = k.guard(() => wave.spawn(n, w.index), wave.spawn);
          n++;
          if (e && typeof e === 'object') w.alive.push(e as { active?: boolean; alive?: boolean });
          if (n >= total) w.spawning = false;
        },
      });
    };
    k.postFns.push(() => {
      if (w.done || w.spawning || w.waiting) return;
      w.alive = w.alive.filter((e) => e.active !== false && e.alive !== false);
      if (!w.alive.length) {
        w.waiting = true;
        this.time.delayedCall(o.between ?? 1500, () => {
          w.waiting = false;
          next();
        });
      }
    });
    next();
    return w;
  }

  // ---------------------------------------------------------------- camera and world

  follow(obj: Point, o?: Parameters<typeof world.follow>[3]): Phaser.Cameras.Scene2D.Camera {
    return world.follow(this, this.k, obj, o);
  }

  worldSize(w: number, h: number): void {
    world.worldSize(this, w, h);
  }

  parallax(layers: world.ParallaxLayer[]): Phaser.GameObjects.TileSprite[] {
    return world.parallax(this, this.k, Array.isArray(layers) ? layers : []);
  }

  weather(kind: string = 'rain', o?: Parameters<typeof world.weather>[3]): Phaser.GameObjects.Particles.ParticleEmitter | null {
    return world.weather(this, this.k, kind, o);
  }

  level(rows: string[], o?: Parameters<typeof world.level>[3]): ReturnType<typeof world.level> {
    return world.level(this, this.k, Array.isArray(rows) ? rows.map(String) : [], o);
  }

  platform(x: number, y: number, w: number, h?: number, key?: string, o?: { oneWay?: boolean; depth?: number }): Phaser.GameObjects.TileSprite {
    return world.platform(this, this.k, x, y, w, h, key, o);
  }

  chunks(o: Parameters<typeof world.chunks>[2]): { next: number; index: number } {
    return world.chunks(this, this.k, o);
  }

  portal(a: Point, b: Point, o?: { color?: unknown; key?: string }): void {
    world.portal(this, this.k, a, b, o);
  }

  /** Flips gravity for everything; characters turn upside down by themselves. */
  flipGravity(): 1 | -1 {
    const k = this.k;
    k.gravitySign = k.gravitySign > 0 ? -1 : 1;
    if (this.physics?.world) this.physics.world.gravity.y *= -1;
    if (this.matter?.world) this.matter.world.localWorld.gravity.y *= -1;
    k.fx.flash(0xc77dff, 160, 0.4);
    k.fx.chroma(0.02, 500);
    k.fx.shake(0.01, 250);
    this.sfx('flip');
    return k.gravitySign;
  }

  // ---------------------------------------------------------------- winning, losing, levels, score

  win(text = 'YOU WIN!'): void {
    const k = this.k;
    if (k.state !== 'play') return;
    k.state = 'won';
    k.endedAt = k.now();
    k.hero?.play('cheer', { lock: true });
    k.fx.confetti(120);
    this.sfx('win');
    k.music.stop();
    this.recordBest();
    this.time.delayedCall(250, () => k.ui.panel([[String(text), 64, '#ffe45e'], ['SCORE ' + k.score, 32, '#ffffff'], [env().prefs.touch === 'on' ? 'Tap to play again' : 'Press R or tap to play again', 20, '#9ff3ff']], { alpha: 0.45 }));
    env().post({ type: 'event', event: { kind: 'win', text: String(text), score: k.score } });
    env().post({ type: 'state', state: 'won' });
    this.events.emit('win');
  }

  lose(text = 'OH NO!'): void {
    const k = this.k;
    if (k.state !== 'play') return;
    k.state = 'lost';
    k.endedAt = k.now();
    k.music.stop();
    this.recordBest();
    k.ui.panel([[String(text), 64, '#ff8fa3'], ['SCORE ' + k.score, 32, '#ffffff'], [env().prefs.touch === 'on' ? 'Tap to try again' : 'Press R or tap to try again', 20, '#9ff3ff']], { alpha: 0.6 });
    env().post({ type: 'event', event: { kind: 'lose', text: String(text), score: k.score } });
    env().post({ type: 'state', state: 'lost' });
    this.events.emit('lose');
  }

  /** Starts the level again (the whole scene). */
  restart(): void {
    boot.restartLevel();
  }

  /** Announces a new level: `this.setLevel(2, 'THE CAVES')`. */
  setLevel(n: number, title?: string): void {
    const k = this.k;
    k.levelNumber = Math.max(1, Math.round(Number(n) || 1));
    const t = title ?? `LEVEL ${k.levelNumber}`;
    k.ui.big(t, { ms: 1200 });
    env().post({ type: 'event', event: { kind: 'level', value: k.levelNumber, text: t } });
  }

  /** Adds points (multiplied by the combo) and pops "+n" at (x, y). */
  addScore(n: number, x?: number, y?: number): number {
    return this.k.addScore(Number(n) || 0, x, y);
  }

  /** The best score ever reached in this game (saved with the game). */
  highScore(): number {
    return Number(env().storage.getItem('amble:best')) || 0;
  }

  setHighScore(n: number): void {
    env().storage.setItem('amble:best', String(Math.max(0, Math.round(Number(n) || 0))));
  }

  private recordBest(): void {
    if (this.k.score > this.highScore()) this.setHighScore(this.k.score);
  }

  /** A sound effect: a kit sound name ('coin', 'jump', 'explosion'...), a `static sounds` name, or segments. */
  sfx(name: string | SynthSegment[], o?: SfxOptions): void {
    playSfx(this.game, name, o);
  }

  // ---------------------------------------------------------------- small helpers

  rand(a?: number, b?: number): number {
    return util.rand(a, b);
  }

  pick<T>(arr: readonly T[]): T {
    return util.pick(arr);
  }

  chance(p: number): boolean {
    return util.chance(p);
  }

  dist(a: Point, b: Point): number {
    return util.dist(a, b);
  }

  /** Degrees from a to b (0 = right, 90 = down). */
  angleTo(a: Point, b: Point): number {
    return util.angleTo(a, b);
  }

  // ---------------------------------------------------------------- physics chaos (Matter)

  blast(x: number, y: number, o?: { radius?: number; power?: number }): void {
    matter.blast(this, x, y, o);
  }

  box(x: number, y: number, w: number, h: number, o?: matter.MatterBoxOptions): Phaser.Physics.Matter.Image {
    return matter.box(this, this.k, x, y, w, h, o);
  }

  ball(x: number, y: number, r: number, o?: matter.MatterBoxOptions): Phaser.Physics.Matter.Image {
    return matter.ball(this, this.k, x, y, r, o);
  }

  stack(x: number, y: number, cols: number, rows: number, o?: matter.MatterBoxOptions & { w?: number; h?: number }): Phaser.Physics.Matter.Image[] {
    return matter.stack(this, this.k, x, y, cols, rows, o);
  }

  pyramid(x: number, y: number, rows: number, o?: matter.MatterBoxOptions & { w?: number; h?: number }): Phaser.Physics.Matter.Image[] {
    return matter.pyramid(this, this.k, x, y, rows, o);
  }

  wreckingBall(ax: number, ay: number, o?: Parameters<typeof matter.wreckingBall>[4]): Phaser.Physics.Matter.Image {
    return matter.wreckingBall(this, this.k, ax, ay, o);
  }

  ragdoll(x: number, y: number, key?: string, o?: { scale?: number; depth?: number }): matter.Ragdoll {
    return matter.ragdoll(this, this.k, x, y, key, o);
  }

  grab(o?: { stiffness?: number }): Phaser.Physics.Matter.PointerConstraint {
    return matter.grab(this, o);
  }

  impacts(o?: { speed?: number }): void {
    matter.impacts(this, this.k, o);
  }

  /** Numbers about the running game (objects, bodies, particles...). */
  stats(): ReturnType<typeof boot.sceneStats> {
    return boot.sceneStats(this);
  }

  /** Which actions the game uses (for touch buttons). */
  usedActions(): Action[] {
    return [...(this.__kit?.actionsUsed ?? [])];
  }
}

// Forgiving aliases for names models invent (this.spawnPlayer -> this.spawnHero), warned once.
{
  const proto = AmbleScene.prototype as unknown as Record<string, unknown>;
  const warned = new Set<string>();
  for (const [alias, real] of Object.entries(SCENE_SYNONYMS)) {
    if (alias in proto || !(real in proto)) continue;
    Object.defineProperty(AmbleScene.prototype, alias, {
      configurable: true,
      get(this: AmbleScene) {
        if (!warned.has(alias)) {
          warned.add(alias);
          env().post({ type: 'warn', message: `this.${alias}() is called this.${real}()` });
        }
        const fn = (this as unknown as Record<string, unknown>)[real];
        return typeof fn === 'function' ? fn.bind(this) : fn;
      },
      set(this: AmbleScene, v: unknown) {
        Object.defineProperty(this, alias, { value: v, writable: true, configurable: true, enumerable: true });
      },
    });
  }
}

/**
 * Hooks the boot module provides (kept as an object so scene.ts does not import boot.ts at load time,
 * which would be a cycle).
 */
export interface BootHooks {
  registry(game: Phaser.Game): import('./art').ArtRegistry;
  defaultConfig(): KitConfig;
  autostart(): boolean;
  afterCreate(scene: AmbleScene): void;
  sceneShutdown(scene: AmbleScene): void;
  dialsView(): Record<string, number>;
  dialsMaybeChanged(): void;
  controlsChanged(): void;
  restartLevel(): void;
  sceneStats(scene: AmbleScene): Record<string, number | string>;
}

let boot: BootHooks;

export function setBootHooks(h: BootHooks): void {
  boot = h;
}

/** Game code's stand-alone value helper, e.g. inside kit options: `num(() => this.dials.jump, 700)`. */
export { numOf };
export type { Target };
