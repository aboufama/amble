/**
 * Per-scene kit state: the one game clock (hit-stop, slow-mo, time scale), groups and pools, behaviour
 * drivers, brains and phases, score, and the frame loop hooks. Created by Amble.Scene on every create().
 */
import Phaser from 'phaser';
import type { Action } from '../../play/protocol';
import type { ArtRegistry } from './art';
import type { Combo } from './combo';
import type { Controls } from './controls';
import { env } from './env';
import type { Fx } from './fx';
import type { Music } from './audio';
import type { Pattern } from './pattern';
import type { AmbleScene } from './scene';
import { arcadeBody, type Actor } from './types';
import type { Ui } from './ui';
import { util } from './util';

export interface KitConfig {
  title: string;
  subtitle: string;
  physics: 'arcade' | 'matter' | 'none';
  gravity: number;
  background: string;
  width: number;
  height: number;
  pixelArt: boolean;
  debug: boolean;
  sleeping: boolean;
  damageNumbers: boolean;
  controls: Partial<Record<Action, string>>;
  /** Art key shown on the title card and win screen (default: the hero). */
  star: string | null;
}

export interface BrainState<T> {
  time?: number;
  next?: string | string[];
  enter?(obj: T, b: Brain<T>): void;
  update?(obj: T, dt: number, b: Brain<T>): void;
  exit?(obj: T, b: Brain<T>): void;
}

export interface Brain<T> {
  obj: T;
  state: string;
  time: number;
  states: Record<string, BrainState<T>>;
  stopped: boolean;
  go(state: string | string[]): void;
  stop(): void;
}

export interface PhaseDef<T> {
  at: number;
  name?: string;
  sub?: string;
  invuln?: number;
  enter?(obj: T, index: number): void;
}

export interface PhaseWatch {
  obj: Actor;
  list: PhaseDef<Actor>[];
  index: number;
}

/** A pooled projectile (see Scene.shoot). */
export interface Shot extends Phaser.Physics.Arcade.Sprite {
  born: number;
  life: number;
  damageAmount: number;
  pierce: number;
  hitSet: Set<unknown> | null;
  role: 'hero' | 'enemy';
  homing: (Phaser.Types.Math.Vector2Like & { active?: boolean }) | null;
  turn: number;
  spin: number;
  onExpire: ((shot: Shot) => void) | null;
  solid: boolean;
  bounceSfx: number;
}

export type AnyGroup = Phaser.Physics.Arcade.Group | Phaser.Physics.Arcade.StaticGroup | Phaser.GameObjects.Group;

const nextKey = (states: Record<string, unknown>, cur: string): string => {
  const ks = Object.keys(states);
  return ks[(ks.indexOf(cur) + 1) % ks.length];
};

export class Kit {
  readonly groups = new Map<string, AnyGroup>();
  readonly pools = new Set<string>();
  readonly onceTags = new Set<string>();
  readonly living = new Set<Actor>();
  readonly driven = new Set<Actor>();
  readonly brains: Array<Brain<unknown>> = [];
  readonly phaseWatch: PhaseWatch[] = [];
  readonly postFns: Array<(dt: number) => void> = [];
  readonly followers: Array<{ obj: Phaser.GameObjects.Components.Transform & { active: boolean; visible: boolean }; h: Phaser.GameObjects.Image }> = [];
  readonly cooldowns = new Map<string, number>();
  readonly physicsType: 'arcade' | 'matter' | 'none';
  readonly webgl: boolean;
  hitstopUntil = 0;
  slowUntil = 0;
  slowTarget = 1;
  private slowScale = 1;
  appliedScale = 1;
  /** Game code's `this.timeScale`. */
  userScale = 1;
  /** Twists and the speed-up ramp multiply this. */
  twistScale = 1;
  /** Game ms: slows in slow-mo, stops in hit-stop and pause. */
  clock = 0;
  gravitySign: 1 | -1 = 1;
  hasGravity: boolean;
  score = 0;
  state: 'title' | 'play' | 'won' | 'lost' = 'play';
  /** The in-game pause (P or Escape), not the editor's. */
  paused = false;
  baseZoom = 1;
  hero: Actor | null = null;
  endedAt = 0;
  levelNumber = 1;
  dead = false;
  /** Actions the game asked about (for the touch buttons). */
  readonly actionsUsed = new Set<Action>();
  fx!: Fx;
  ui!: Ui;
  controls!: Controls;
  music!: Music;
  combo!: Combo;
  pattern!: Pattern;
  private lowFps = 0;
  private highFps = 0;
  private fpsTimer = 0;
  private pauseObjs: Phaser.GameObjects.GameObject[] | null = null;
  private readonly failures = new WeakMap<object, number>();

  constructor(
    readonly scene: AmbleScene,
    readonly cfg: KitConfig,
    readonly art: ArtRegistry,
    readonly uiScene: Phaser.Scene,
  ) {
    this.physicsType = cfg.physics;
    this.webgl = scene.game.renderer.type === Phaser.WEBGL;
    const g = scene.physics?.world ? scene.physics.world.gravity.y : 0;
    this.hasGravity = this.physicsType === 'matter' ? true : Math.abs(g) > 0;
  }

  now(): number {
    return env().now();
  }

  /** How much game time passes this frame (0 in hit-stop). Also drives tweens and Matter. */
  frameScale(realDelta: number): number {
    const t = this.now();
    let s: number;
    if (this.state === 'title' || this.paused || env().crashed()) s = 0;
    else if (t < this.hitstopUntil) s = 0;
    else {
      const ended = this.state === 'won' || this.state === 'lost';
      const target = t < this.slowUntil ? this.slowTarget : ended ? 0.3 : 1;
      this.slowScale += (target - this.slowScale) * (1 - Math.exp(-realDelta / 80));
      if (Math.abs(target - this.slowScale) < 0.02) this.slowScale = target;
      s = this.slowScale * this.userScale * this.twistScale * env().prefs.speed;
    }
    if (s !== this.appliedScale) {
      this.appliedScale = s;
      const matter = this.scene.matter?.world;
      if (this.physicsType === 'matter' && matter) matter.engine.timing.timeScale = s;
    }
    return s;
  }

  /** Real-time upkeep: effect decay and the quality governor. */
  realTick(realDelta: number): void {
    this.fx.tick(realDelta);
    const prefs = env().prefs;
    if (prefs.quality !== 'auto' || env().mode === 'robot') return;
    this.fpsTimer += realDelta;
    if (this.fpsTimer < 1000) return;
    this.fpsTimer = 0;
    const fps = this.scene.game.loop.actualFps;
    this.lowFps = fps < 45 ? this.lowFps + 1 : 0;
    this.highFps = fps > 58 ? this.highFps + 1 : 0;
    if (this.lowFps >= 3 && quality.level > 0) {
      quality.level = (quality.level - 1) as 0 | 1 | 2;
      this.lowFps = 0;
    } else if (this.highFps >= 10 && quality.level < 2 && quality.cap >= quality.level + 1) {
      quality.level = (quality.level + 1) as 0 | 1 | 2;
      this.highFps = 0;
    }
  }

  start(quiet = false): void {
    this.ui.clearPanel('title');
    this.state = 'play';
    if (!quiet) this.ui.big('GO!', { ms: 700, color: '#7ddf8c' });
    env().post({ type: 'state', state: 'running' });
    env().post({ type: 'event', event: { kind: 'start' } });
    this.scene.events.emit('start');
  }

  pre(_time: number, delta: number): void {
    this.controls.poll();
    const c = this.controls;
    // The kit's own screens read input without it counting as the game's controls.
    if (this.state === 'title') {
      if (c.kitPressed('jump') || c.kitPressed('fire') || c.kitPressed('action') || c.kitPointer.justDown || c.anyKey) this.start();
      return;
    }
    if (this.state === 'won' || this.state === 'lost') {
      if (this.now() - this.endedAt > 900 && (c.tappedRestart || c.kitPointer.justDown || c.kitPressed('jump'))) this.scene.restart();
      return;
    }
    if (c.kitPressed('pause')) this.togglePause();
    if (env().crashed() || this.paused) return;
    this.clock += delta;
    const dt = delta / 1000;
    for (const o of this.driven) {
      if (!o.active) {
        this.driven.delete(o);
        continue;
      }
      if (!o.alive) continue;
      for (const d of o.drivers) this.guard(() => d(dt), d);
    }
    for (let i = this.brains.length - 1; i >= 0; i--) {
      const b = this.brains[i];
      const obj = b.obj as { active?: boolean; alive?: boolean };
      if (obj.active === false || obj.alive === false || b.stopped) {
        this.brains.splice(i, 1);
        continue;
      }
      b.time += delta;
      const st = b.states[b.state];
      if (!st) continue;
      const update = st.update;
      if (update) this.guard(() => update(b.obj, dt, b), update);
      if (st.time && b.time >= st.time) b.go(st.next ?? nextKey(b.states, b.state));
    }
  }

  post(_time: number, delta: number): void {
    if (env().crashed()) return;
    const dt = delta / 1000;
    const view = this.scene.cameras.main.worldView;
    // The camera's view is only known after its first render: until then nothing counts as off screen.
    const viewKnown = view.width > 0 && view.height > 0;
    for (const name of this.pools) {
      const g = this.groups.get(name);
      if (!g) continue;
      for (const child of g.getChildren()) {
        const s = child as Shot;
        if (!s.active) continue;
        const body = arcadeBody(s);
        if (s.homing && s.homing.active !== false && body) {
          const want = Math.atan2(s.homing.y - s.y, s.homing.x - s.x);
          const cur = Math.atan2(body.velocity.y, body.velocity.x);
          const da = Phaser.Math.Angle.Wrap(want - cur);
          const na = cur + util.clamp(da, -s.turn * dt, s.turn * dt);
          const sp = Math.hypot(body.velocity.x, body.velocity.y);
          body.velocity.set(Math.cos(na) * sp, Math.sin(na) * sp);
          s.rotation = na;
        }
        if (s.spin) s.angle += s.spin * dt;
        const m = 120;
        if (this.clock - s.born > s.life) {
          const expire = s.onExpire;
          if (expire) this.guard(() => expire(s), expire);
          this.killShot(s, !!expire);
        } else if (viewKnown && (s.x < view.x - m || s.x > view.right + m || s.y < view.y - m - 300 || s.y > view.bottom + m)) this.killShot(s, false);
      }
    }
    for (let i = this.followers.length - 1; i >= 0; i--) {
      const f = this.followers[i];
      if (!f.obj.active) {
        f.h.destroy();
        this.followers.splice(i, 1);
        continue;
      }
      f.h.setPosition(f.obj.x, f.obj.y).setVisible(f.obj.visible);
    }
    for (const p of this.phaseWatch) this.tickPhases(p);
    this.combo.tick(delta);
    for (const fn of this.postFns.slice()) this.guard(() => fn(dt), fn);
    this.ui.tick();
  }

  /**
   * Runs a callback the game gave the kit (a timer, a collision, a brain state). An error is reported with
   * its line and the game keeps going; a callback that fails 3 times is switched off. `owner` is the game's
   * own function when `fn` is a wrapper around it.
   */
  guard<T>(fn: () => T, owner: object = fn): T | undefined {
    if ((this.failures.get(owner) ?? 0) >= 3) return undefined;
    try {
      return fn();
    } catch (err) {
      const n = (this.failures.get(owner) ?? 0) + 1;
      this.failures.set(owner, n);
      env().report(err, 'callback', { crash: false });
      return undefined;
    }
  }

  togglePause(): void {
    this.paused = !this.paused;
    if (this.paused) {
      this.pauseObjs = this.ui.panel([['PAUSED', 64, '#ffe45e'], [env().prefs.touch === 'on' ? 'Tap to keep playing' : 'Press P to keep playing', 22]], { top: 0.4 });
      env().post({ type: 'state', state: 'paused' });
    } else {
      this.pauseObjs?.forEach((o) => o.destroy());
      this.pauseObjs = null;
      env().post({ type: 'state', state: 'running' });
    }
  }

  group(name: string, o: { static?: boolean; gravity?: boolean; max?: number } = {}): AnyGroup {
    const known = this.groups.get(name);
    if (known) return known;
    const s = this.scene;
    let g: AnyGroup;
    if (this.physicsType === 'arcade') {
      g = o.static || name === 'platforms' ? s.physics.add.staticGroup() : s.physics.add.group({ allowGravity: o.gravity !== false && !/shots$/i.test(name), maxSize: o.max ?? -1 });
    } else g = s.add.group();
    g.name = name;
    this.groups.set(name, g);
    return g;
  }

  /** A pooled group of projectiles (culled offscreen and by lifetime). */
  pool(name: string): Phaser.Physics.Arcade.Group {
    const known = this.groups.get(name);
    if (known instanceof Phaser.Physics.Arcade.Group) {
      this.pools.add(name);
      return known;
    }
    const g = this.scene.physics.add.group({ classType: Phaser.Physics.Arcade.Sprite, maxSize: quality.level === 0 ? 600 : 1200, allowGravity: false });
    g.name = name;
    this.groups.set(name, g);
    this.pools.add(name);
    return g;
  }

  /** Runs fn only the first time a tag is seen (colliders wired once per scene). */
  once(tag: string, fn: () => void): void {
    if (this.onceTags.has(tag)) return;
    this.onceTags.add(tag);
    fn();
  }

  killShot(s: Shot, burst = true): void {
    if (!s.active) return;
    if (burst) this.fx.burst(s.x, s.y, { colors: [0xffffff, s.tintTopLeft === 0xffffff ? 0x9ff3ff : s.tintTopLeft], count: 4, speed: [40, 160], life: 180, size: 0.35 });
    s.disableBody(true, true);
  }

  forEachLiving(fn: (a: Actor) => void): void {
    for (const o of [...this.living]) if (o.active && o.alive) fn(o);
  }

  addScore(n: number, x?: number, y?: number): number {
    const add = Math.round(n * this.combo.mult);
    this.score += add;
    this.ui.setScore(this.score);
    if (x !== undefined && y !== undefined) this.ui.pop(x, y, '+' + add, { color: this.combo.mult > 1 ? '#ffe45e' : '#ffffff', size: this.combo.mult > 1 ? 26 : 20 });
    return add;
  }

  tickPhases(p: PhaseWatch): void {
    const o = p.obj;
    if (!o.maxHp) return;
    const ratio = o.hp / o.maxHp;
    while (p.index + 1 < p.list.length && ratio <= p.list[p.index + 1].at && o.alive) {
      p.index++;
      const ph = p.list[p.index];
      if (p.index > 0) {
        this.fx.hitstop(150);
        this.fx.shake(0.022, 500);
        this.fx.flash(0xffffff, 180, 0.5);
        this.fx.chroma(0.022, 700);
        this.fx.shockwave(o.x, o.y, { radius: 300, color: 0xffe45e });
        const title = ph.name || 'PHASE ' + (p.index + 1);
        this.ui.big(title, { sub: ph.sub });
        env().post({ type: 'event', event: { kind: 'level', value: p.index + 1, text: title } });
        o.invulnUntil = this.clock + (ph.invuln ?? 1400);
        o.play('attack');
        this.scene.sfx('roar');
        this.music.intensity(Math.min(2, p.index + 1) as 0 | 1 | 2);
      }
      const enter = ph.enter;
      if (enter) this.guard(() => enter(o, p.index), enter);
    }
  }

  shutdown(): void {
    this.dead = true;
    this.driven.clear();
    this.music.stop();
    this.ui.shutdown();
  }
}

/** The effects quality level: 2 full, 1 reduced, 0 minimal. `cap` is the most this machine gets. */
export const quality: { level: 0 | 1 | 2; cap: 0 | 1 | 2 } = { level: 1, cap: 2 };
