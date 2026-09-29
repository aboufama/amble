/**
 * Twists: rule-breakers the student switches on any kit game, live, with no AI (names and words are in
 * twistCatalog.ts). A twist applies to the running scene through a `TwistRun`, which remembers everything
 * it hooked (timers, events, per-frame functions) so switching it off undoes it cleanly. Twist code runs
 * through a guard: an error is reported with the twist's id and switches the twist off for this run, and
 * the game keeps going.
 */
import Phaser from 'phaser';
import { env } from './env';
import type { AmbleScene } from './scene';
import type { Kit } from './state';
import { TWISTS, TWIST_IDS, isTwistId, type TwistId } from './twistCatalog';
import { arcadeBody, isActor, type Actor } from './types';
import { util } from './util';

interface TwistRun {
  readonly scene: AmbleScene;
  readonly k: Kit;
  /** Runs twist code; an error switches the twist off. */
  guard<T>(fn: () => T): T | undefined;
  /** Every `ms` of game time; the first call after `first` ms (default `ms`). */
  every(ms: number, fn: () => void, first?: number): void;
  after(ms: number, fn: () => void): void;
  /** Every frame, after the game's update (dt in seconds). */
  onFrame(fn: (dt: number) => void): void;
  /** A scene event ('spawn', 'defeat'...). */
  on(event: string, fn: (...args: unknown[]) => void): void;
  /** Undo work, run in reverse order when the twist switches off. */
  cleanup(fn: () => void): void;
}

interface TwistImpl {
  /** The game has what the twist needs (checked after create()). */
  available(scene: AmbleScene, k: Kit): boolean;
  apply(run: TwistRun): void;
}

const hasArcade = (k: Kit): boolean => k.physicsType === 'arcade';
const hasHero = (k: Kit): boolean => !!k.hero && k.hero.active;

function hasEnemies(k: Kit): boolean {
  if ((k.groups.get('enemies')?.getLength() ?? 0) > 0) return true;
  for (const s of k.art.specs.values()) if (s.role === 'enemy' || s.role === 'boss') return true;
  return false;
}

function firstKey(k: Kit, roles: string[]): string | null {
  for (const s of k.art.specs.values()) if (s.declared && roles.includes(s.role)) return s.key;
  for (const a of k.living) if (roles.includes(a.role)) return a.key;
  for (const s of k.art.specs.values()) if (roles.includes(s.role)) return s.key;
  return null;
}

/** Twists scale game speed through their own factor (several can be on at once). */
const factors = new WeakMap<Kit, Map<string, number>>();

function setFactor(k: Kit, id: string, f: number): void {
  const m = factors.get(k) ?? new Map<string, number>();
  factors.set(k, m);
  if (f === 1) m.delete(id);
  else m.set(id, f);
  k.twistScale = [...m.values()].reduce((a, b) => a * b, 1);
}

/** Flips gravity without the show (undoing a flip twist). */
function setGravitySign(scene: AmbleScene, k: Kit, sign: 1 | -1): void {
  if (k.gravitySign === sign) return;
  k.gravitySign = sign;
  const arcade = scene.physics?.world;
  if (arcade) arcade.gravity.y *= -1;
  const matter = scene.matter?.world;
  if (matter) matter.localWorld.gravity.y *= -1;
}

/** Applies `fn` to the hero, and again whenever the game replaces its hero. */
function heroTwist(run: TwistRun, fn: (hero: Actor) => () => void): void {
  let hero: Actor | null = null;
  let undo: (() => void) | null = null;
  const sync = () => {
    const h = run.k.hero && run.k.hero.active ? run.k.hero : null;
    if (h === hero) return;
    if (undo && hero?.active) undo();
    undo = null;
    hero = h;
    if (h) undo = run.guard(() => fn(h)) ?? null;
  };
  sync();
  run.onFrame(sync);
  run.cleanup(() => {
    if (undo && hero?.active) undo();
    undo = null;
    hero = null;
  });
}

function scaleActor(a: Actor, f: number): void {
  a.setScale(a.scaleX * f, a.scaleY * f);
}

const IMPLS: Record<TwistId, TwistImpl> = {
  moonGravity: {
    available: (_s, k) => k.hasGravity,
    apply(run) {
      const f = 0.45;
      const arcade = run.scene.physics?.world;
      if (arcade) {
        arcade.gravity.y *= f;
        run.cleanup(() => (arcade.gravity.y /= f));
      }
      const matter = run.scene.matter?.world;
      if (matter) {
        const g = matter.localWorld.gravity;
        g.y *= f;
        run.cleanup(() => (g.y /= f));
      }
    },
  },

  gravityFlips: {
    available: (_s, k) => k.hasGravity && hasHero(k),
    apply(run) {
      const { scene, k } = run;
      const start = k.gravitySign;
      let warned: Phaser.GameObjects.Rectangle | null = null;
      run.every(12000, () => {
        warned?.destroy();
        warned = null;
        scene.flipGravity();
      });
      run.every(12000, () => {
        const ui = k.uiScene;
        warned = ui.add.rectangle(ui.scale.width / 2, ui.scale.height / 2, ui.scale.width, ui.scale.height, 0xc77dff, 0).setDepth(8900);
        ui.tweens.add({ targets: warned, alpha: 0.16, yoyo: true, repeat: 1, duration: 250 });
        k.ui.big('FLIP!', { ms: 900, color: '#c77dff', size: 64 });
      }, 11000);
      run.cleanup(() => {
        warned?.destroy();
        setGravitySign(scene, k, start);
      });
    },
  },

  giantHero: {
    available: (_s, k) => hasHero(k),
    apply(run) {
      heroTwist(run, (h) => {
        const smash = h.smash;
        scaleActor(h, 1.8);
        h.smash = true;
        run.k.fx.burst(h.x, h.y, { colors: [0xffffff, 0xffd23f], count: 18, speed: [80, 300], life: 500, size: 0.7 });
        run.scene.sfx('powerup');
        return () => {
          scaleActor(h, 1 / 1.8);
          h.smash = smash;
        };
      });
    },
  },

  tinyHero: {
    available: (_s, k) => hasHero(k),
    apply(run) {
      heroTwist(run, (h) => {
        scaleActor(h, 0.55);
        const ctl = h.ctl;
        if (ctl) ctl.speedMul *= 1.2;
        run.scene.sfx('blip');
        return () => {
          scaleActor(h, 1 / 0.55);
          if (ctl) ctl.speedMul /= 1.2;
        };
      });
    },
  },

  slowmoHits: {
    available: (_s, k) => hasEnemies(k),
    apply(run) {
      const { scene, k } = run;
      run.on('defeat', (a) => {
        if (!isActor(a) || (a.role !== 'enemy' && a.role !== 'boss')) return;
        k.fx.slowmo(0.35, 500);
        k.fx.chroma(0.02, 400);
        k.fx.burst(a.x, a.y, { frames: ['star', 'spark'], colors: [0xffffff, 0xffe45e, a.spec.color], count: 26, speed: [120, 520], life: 700, size: 0.8, blend: 'add' });
        scene.sfx('slowmo', { volume: 0.5 });
      });
    },
  },

  slowTime: {
    available: () => true,
    apply(run) {
      setFactor(run.k, 'slowTime', 0.6);
      run.cleanup(() => setFactor(run.k, 'slowTime', 1));
    },
  },

  bouncyWorld: {
    available: (_s, k) => k.physicsType !== 'none',
    apply(run) {
      const { scene, k } = run;
      const arcadeSaved: Array<[Phaser.Physics.Arcade.Body, number, number]> = [];
      const matterSaved: Array<[MatterJS.BodyType, number]> = [];
      const seen = new WeakSet<object>();
      const sweep = () => {
        const arcade = scene.physics?.world;
        if (arcade) {
          for (const b of arcade.bodies.entries) {
            if (seen.has(b)) continue;
            seen.add(b);
            arcadeSaved.push([b, b.bounce.x, b.bounce.y]);
            // The hero bounces less, so it can still land and jump.
            const v = b.gameObject === k.hero ? 0.5 : 0.85;
            b.setBounce(Math.max(b.bounce.x, v), Math.max(b.bounce.y, v));
          }
        }
        const matter = scene.matter?.world;
        if (matter) {
          for (const body of matter.getAllBodies()) {
            if (seen.has(body) || body.isStatic) continue;
            seen.add(body);
            matterSaved.push([body, body.restitution]);
            body.restitution = 0.85;
          }
        }
      };
      sweep();
      run.every(250, sweep);
      run.cleanup(() => {
        for (const [b, x, y] of arcadeSaved) if (b.gameObject?.active) b.setBounce(x, y);
        for (const [body, r] of matterSaved) body.restitution = r;
      });
    },
  },

  starRain: {
    available: (_s, k) => hasArcade(k) && hasHero(k),
    apply(run) {
      const { scene, k } = run;
      const key = firstKey(k, ['item']) ?? 'star';
      const rain = () => {
        const view = scene.cameras.main.worldView;
        const top = k.gravitySign > 0;
        let n = 0;
        k.ui.hint('Treasure is falling from the sky!', 2200);
        const drop = () => {
          if (n++ >= 40 || k.dead) return;
          scene.spawnItem(util.rand(view.x + 30, view.right - 30), top ? view.y - 40 : view.bottom + 40, key, { gravity: true, bounce: 0.35, life: 9000, points: 10 });
          run.after(50, drop);
        };
        drop();
      };
      run.every(20000, rain, 4000);
    },
  },

  enemyParty: {
    available: (_s, k) => hasArcade(k) && hasEnemies(k),
    apply(run) {
      const { scene, k } = run;
      const friends = new Set<Actor>();
      run.on('spawn', (a) => {
        if (!isActor(a) || a.role !== 'enemy' || friends.has(a) || friends.size >= 24) return;
        // Next frame: by then the game has given the original its behaviours.
        run.after(0, () => {
          if (!a.active || !a.alive || friends.size >= 24) return;
          const dir = util.chance(0.5) ? 1 : -1;
          const f = scene.spawn(a.x + dir * Math.max(30, a.displayWidth * 0.8), a.y, a.key, { role: 'enemy', hp: Math.max(1, Math.ceil(a.maxHp * 0.6)), points: Math.round(a.points * 0.6) });
          friends.add(f);
          f.once(Phaser.GameObjects.Events.DESTROY, () => friends.delete(f));
          copyBehaviours(a, f);
          for (const [name, g] of k.groups) if (!k.pools.has(name) && name !== 'enemies' && g.contains(a)) g.add(f);
          k.fx.burst(f.x, f.y, { colors: [0xffffff, a.spec.color], count: 8, speed: [40, 160], life: 300, size: 0.5 });
        });
      });
    },
  },

  speedUp: {
    available: () => true,
    apply(run) {
      let t = 0;
      run.onFrame((dt) => {
        t += dt * 1000;
        setFactor(run.k, 'speedUp', 1 + 0.5 * Math.min(1, t / 90000));
      });
      run.cleanup(() => setFactor(run.k, 'speedUp', 1));
    },
  },

  surpriseBoss: {
    available: (_s, k) => hasArcade(k) && hasEnemies(k),
    apply(run) {
      const { scene, k } = run;
      let boss: Actor | null = null;
      let removeBar: (() => void) | null = null;
      run.after(60000, () => {
        const key = firstKey(k, ['enemy', 'boss']) ?? 'boss';
        const view = scene.cameras.main.worldView;
        k.ui.big('SURPRISE BOSS!', { sub: 'Something huge is coming', color: '#ff8fa3' });
        k.fx.shake(0.02, 600);
        scene.sfx('roar');
        // An enemy (not a boss), so beating it scores but does not end the game.
        const b = scene.spawn(view.centerX, view.y + view.height * 0.28, key, { role: 'enemy', hp: 30, points: 5000, gravity: false, immovable: true, scale: 3, depth: 350 });
        boss = b;
        b.contactDamage = 1;
        b.stompDamage = 5;
        b.dieSize = 2.4;
        removeBar = k.ui.removableBossBar(b, 'SURPRISE ' + b.spec.name.toUpperCase());
        scene.phases(b, [{ at: 1 }, { at: 0.66, name: 'PHASE 2' }, { at: 0.33, name: 'PHASE 3', sub: 'It is angry now' }]);
        const phase = () => (b.hp / Math.max(1, b.maxHp) <= 0.33 ? 2 : b.hp / Math.max(1, b.maxHp) <= 0.66 ? 1 : 0);
        scene.brain(b, {
          drift: {
            time: 2400,
            next: ['ring', 'spread'],
            update: (o, _dt, br) => {
              const body = arcadeBody(o);
              if (body) body.setVelocity(Math.sin(br.time / 500) * 140, Math.cos(br.time / 700) * 30);
            },
          },
          ring: { time: 900, next: 'drift', enter: (o) => scene.pattern.ring(o, { count: 10 + phase() * 4, speed: 170 + phase() * 30 }) },
          spread: {
            time: 900,
            next: 'drift',
            enter: (o) => {
              const h = k.hero;
              scene.pattern.spread(o, h ? util.angleTo(o, h) : 90, { count: 5 + phase() * 2, arc: 60, speed: 230 });
            },
          },
        });
      });
      run.cleanup(() => {
        if (boss?.active) {
          k.fx.burst(boss.x, boss.y, { colors: [0xffffff, boss.spec.color], count: 20, speed: [60, 260], life: 500, size: 0.8 });
          boss.destroy();
        }
        removeBar?.();
      });
    },
  },

  earthquake: {
    available: (_s, k) => k.hasGravity && ((k.groups.get('platforms')?.getLength() ?? 0) > 0 || k.physicsType === 'matter'),
    apply(run) {
      const { scene, k } = run;
      const quake = () => {
        k.fx.shake(0.012, 2000);
        k.ui.hint('EARTHQUAKE!', 1800);
        let n = 0;
        const rumble = () => {
          if (n++ >= 8 || k.dead) return;
          scene.sfx('thud', { volume: 0.5, pitch: 0.6 + Math.random() * 0.2 });
          const view = scene.cameras.main.worldView;
          k.fx.dust({ x: util.rand(view.x, view.right), y: k.gravitySign > 0 ? view.bottom - 20 : view.y + 20, displayHeight: 0 }, { count: 4 });
          k.forEachLiving((a) => {
            if (a === k.hero || a.role === 'boss') return;
            const b = arcadeBody(a);
            if (b && b.enable && b.allowGravity && !b.immovable && util.chance(0.5)) b.setVelocity(b.velocity.x + util.rand(-100, 100), -util.rand(120, 260) * k.gravitySign);
          });
          const matter = scene.matter?.world;
          if (matter) {
            for (const body of matter.getAllBodies()) {
              if (body.isStatic || !util.chance(0.4)) continue;
              scene.matter.body.setVelocity(body, { x: body.velocity.x + util.rand(-3, 3), y: body.velocity.y - util.rand(2, 5) });
            }
          }
          run.after(250, rumble);
        };
        rumble();
      };
      run.every(15000, quake);
    },
  },

  doubleJump: {
    available: (_s, k) => !!k.hero?.ctl,
    apply(run) {
      heroTwist(run, (h) => {
        const ctl = h.ctl;
        if (!ctl) return () => undefined;
        ctl.bonusJumps += 1;
        return () => {
          ctl.bonusJumps = Math.max(0, ctl.bonusJumps - 1);
        };
      });
    },
  },
};

/** The enemy-party friend moves like the original. */
function copyBehaviours(a: Actor, f: Actor): void {
  if (a.patrolSpeed !== undefined) f.patrol(a.patrolSpeed, { dir: a.patrolDir === 1 ? -1 : 1, min: a.patrolMin, max: a.patrolMax });
  if (a.chaseTarget) f.chase(a.chaseTarget, a.chaseSpeed);
  if (a.wanderState) f.wander({ speed: a.wanderState.speed, radius: a.wanderState.radius });
  if (a.orbitState) f.orbit(a.orbitState.center, a.orbitState.radius, a.orbitState.speed);
  if (a.flyerOpts) f.flyer(a.flyerOpts);
  if (a.shooterState) f.shooter(a.shooterState.opts);
  f.contactDamage = a.contactDamage;
  f.stompDamage = a.stompDamage;
}

// ---------------------------------------------------------------- running twists in a scene

interface ActiveTwist {
  undo(): void;
}

const active = new WeakMap<Kit, Map<TwistId, ActiveTwist>>();
/** Twists that broke in this run stay off until the student switches them again. */
const broken = new Set<TwistId>();

function startTwist(scene: AmbleScene, k: Kit, id: TwistId): void {
  const map = active.get(k) ?? new Map<TwistId, ActiveTwist>();
  active.set(k, map);
  if (map.has(id) || broken.has(id)) return;
  const cleanups: Array<() => void> = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    map.delete(id);
    for (const fn of cleanups.reverse()) {
      try {
        fn();
      } catch {
        /* undo is best effort */
      }
    }
  };
  const guard = <T>(fn: () => T): T | undefined => {
    if (stopped) return undefined;
    try {
      return fn();
    } catch (err) {
      env().report(err, 'callback', { twist: id, crash: false });
      broken.add(id);
      stop();
      return undefined;
    }
  };
  const run: TwistRun = {
    scene,
    k,
    guard,
    every(ms, fn, first = ms) {
      const ev = scene.time.addEvent({ delay: ms, loop: true, startAt: Math.max(0, ms - first), callback: () => guard(fn) });
      cleanups.push(() => ev.remove(false));
    },
    after(ms, fn) {
      const ev = scene.time.delayedCall(ms, () => guard(fn));
      cleanups.push(() => ev.remove(false));
    },
    onFrame(fn) {
      const wrapped = (dt: number) => {
        guard(() => fn(dt));
      };
      k.postFns.push(wrapped);
      cleanups.push(() => {
        const i = k.postFns.indexOf(wrapped);
        if (i >= 0) k.postFns.splice(i, 1);
      });
    },
    on(event, fn) {
      const wrapped = (...args: unknown[]) => {
        guard(() => fn(...args));
      };
      scene.events.on(event, wrapped);
      cleanups.push(() => scene.events.off(event, wrapped));
    },
    cleanup(fn) {
      cleanups.push(fn);
    },
  };
  map.set(id, { undo: stop });
  guard(() => IMPLS[id].apply(run));
}

function stopTwist(k: Kit, id: TwistId): void {
  active.get(k)?.get(id)?.undo();
}

/** After create(): switches on the twists the student chose (the ones this game can use). */
export function applyTwists(scene: AmbleScene, k: Kit): void {
  for (const id of TWIST_IDS) {
    if (!env().twistsOn.has(id)) continue;
    const impl = IMPLS[id];
    let ok = false;
    try {
      ok = impl.available(scene, k);
    } catch {
      ok = false;
    }
    if (ok) startTwist(scene, k, id);
  }
}

/** The scene is shutting down: undo every twist so nothing leaks into the next run of the level. */
export function undoTwists(_scene: AmbleScene, k: Kit): void {
  const map = active.get(k);
  if (!map) return;
  for (const t of [...map.values()]) t.undo();
  active.delete(k);
}

/** The student flipped a twist while the game runs. Returns false for unknown ids. */
export function setTwist(scene: AmbleScene | null, id: string, on: boolean): boolean {
  if (!isTwistId(id)) return false;
  const e = env();
  if (on) e.twistsOn.add(id);
  else e.twistsOn.delete(id);
  broken.delete(id);
  const k = scene?.__kit;
  if (!scene || !k || k.dead) return true;
  if (!on) {
    stopTwist(k, id);
    return true;
  }
  let ok = false;
  try {
    ok = IMPLS[id].available(scene, k);
  } catch {
    ok = false;
  }
  if (!ok) return true;
  startTwist(scene, k, id);
  const def = TWISTS.find((t) => t.id === id);
  if (def && k.state === 'play') k.ui.big(def.name.toUpperCase() + '!', { ms: 900, size: 44, color: '#c79bff' });
  return true;
}

/** Which twists this game can use (for the editor's manifest). */
export function twistAvailability(scene: AmbleScene | null): Record<TwistId, boolean> {
  const out = {} as Record<TwistId, boolean>;
  const k = scene?.__kit;
  for (const id of TWIST_IDS) {
    let ok = false;
    if (scene && k) {
      try {
        ok = IMPLS[id].available(scene, k);
      } catch {
        ok = false;
      }
    }
    out[id] = ok;
  }
  return out;
}

/** Read-only view for game code: `this.twists.isOn('moonGravity')`. */
export function twistsView(): { isOn(id: string): boolean; readonly list: string[] } {
  const on = env().twistsOn;
  return {
    isOn: (id: string) => on.has(id),
    get list() {
      return TWIST_IDS.filter((id) => on.has(id));
    },
  };
}
