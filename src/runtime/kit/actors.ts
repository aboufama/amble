/**
 * What every spawned thing can do: health with default juice (flash, particles, knockback, hit-stop), and
 * one-line behaviours with tuned game feel (coyote time, jump buffering, variable jump height, double
 * jump, dash with i-frames, 8-way shooting, patrol, chase, wander, orbit, flying).
 *
 * Every number option may be live: `platformer({ jump: () => this.dials.jump })` is read every frame, so
 * turning a dial changes the running game at once.
 */
import Phaser from 'phaser';
import type { Role } from '../../play/protocol';
import { colorInt } from './color';
import { numOf, type Num } from './dials';
import type { ArtSpec } from './spec';
import type { Kit } from './state';
import {
  arcadeBody,
  type Actor,
  type DamageInfo,
  type FlyerOptions,
  type PlatformerOptions,
  type Point,
  type ShooterOptions,
  type TopdownOptions,
} from './types';
import { DEG, util } from './util';

// ------------------------------------------------------------------ health

export function addHealth(k: Kit, a: Actor, hp: number, o: { iframes?: number; points?: number } = {}): void {
  a.hasHealth = true;
  a.hp = a.maxHp = Math.max(1, Math.round(hp));
  a.alive = true;
  a.iframes = o.iframes ?? (a.role === 'hero' ? 1100 : 0);
  a.invulnUntil = 0;
  a.points = o.points ?? (a.role === 'boss' ? 5000 : a.role === 'enemy' ? 100 : 0);
  k.living.add(a);
  a.once(Phaser.GameObjects.Events.DESTROY, () => k.living.delete(a));
}

export function damage(k: Kit, a: Actor, n: number, d: DamageInfo): boolean {
  if (!a.hasHealth || !a.alive || !a.active || a.invincible || a.invulnUntil > k.clock) return false;
  const amount = Number.isFinite(n) ? n : 1;
  a.hp -= amount;
  const s = k.scene;
  a.emit('hurt', amount, d);
  k.fx.hurtFlash(a, a.role === 'boss' ? 50 : 80);
  a.play('hurt');
  k.fx.burst(d.x ?? a.x, d.y ?? a.y, { colors: [0xffffff, a.spec.color], count: a.role === 'boss' ? 5 : 9, speed: [80, 280], life: 300, size: 0.45 });
  if (k.cfg.damageNumbers || d.pop) k.ui.pop(a.x, a.y - a.displayHeight / 2, `-${amount}`, { color: '#ff8fa3', size: 20 });
  const b = arcadeBody(a);
  if (d.from && b && d.knockback !== 0 && a.role !== 'boss' && !b.immovable) {
    const kb = d.knockback ?? (a.role === 'hero' ? 330 : 200);
    b.velocity.x = Math.sign(a.x - d.from.x || 1) * kb;
    if (k.hasGravity) b.velocity.y = -kb * 0.7 * k.gravitySign;
  }
  if (a.role === 'hero') {
    k.fx.shake(0.015, 240);
    k.fx.hitstop(100);
    k.fx.chroma(0.016, 380);
    s.sfx('hurt');
    a.invulnUntil = k.clock + a.iframes;
    s.tweens.add({ targets: a, alpha: 0.25, yoyo: true, repeat: Math.floor(a.iframes / 120), duration: 60, onComplete: () => a.setAlpha(1) });
  } else {
    s.sfx('hit', { pitch: a.role === 'boss' ? 0.65 : 1.1, volume: 0.45 });
    if (a.role === 'boss') k.fx.shake(0.003, 60);
  }
  if (a.hp <= 0) die(k, a, d);
  return true;
}

export function die(k: Kit, a: Actor, d: DamageInfo): void {
  if (!a.alive) return;
  a.alive = false;
  a.hp = 0;
  const s = k.scene;
  const b = arcadeBody(a);
  if (b) {
    b.velocity.set(0, 0);
    b.enable = false;
  }
  if (a.role === 'hero') {
    a.play('die', { lock: true });
    k.fx.slowmo(0.2, 1000);
    k.fx.shake(0.02, 400);
    s.sfx('lose');
    const handled = a.listenerCount('die') > 0;
    a.emit('die', d);
    if (!handled) s.time.delayedCall(500, () => s.lose());
    return;
  }
  s.events.emit('defeat', a);
  if (a.role === 'boss') {
    k.fx.slowmo(0.3, 2600);
    a.play('rage', { lock: true });
    const w = a.spec.w;
    const h = a.spec.h;
    let n = 0;
    s.time.addEvent({
      delay: 110,
      repeat: 9,
      callback: () => {
        n++;
        k.fx.explode(a.x + util.rand(-w / 2, w / 2), a.y + util.rand(-h / 2, h / 2), { size: 0.6 + n * 0.08, color: a.spec.color, hitstop: false });
        if (n === 10) {
          k.fx.explode(a.x, a.y, { size: 2.4, color: 0xffe45e });
          k.fx.flash(0xffffff, 300, 0.7);
          k.addScore(a.points, a.x, a.y);
          const handled = a.listenerCount('die') > 0;
          a.emit('die', d);
          a.destroy();
          if (!handled) s.time.delayedCall(600, () => s.win());
        }
      },
    });
    return;
  }
  k.fx.explode(a.x, a.y, { size: a.dieSize ?? 0.6, color: a.spec.color, hitstop: false });
  if (a.points) k.addScore(a.points, a.x, a.y - 20);
  a.emit('die', d);
  a.destroy();
}

// ------------------------------------------------------------------ behaviours

function dashOpts(o: PlatformerOptions['dash']): { speed: Num; ms: number; cooldown: number } | null {
  if (!o) return null;
  return { speed: 820, ms: 170, cooldown: 450, ...(o === true ? {} : o) };
}

function drivePlatformer(k: Kit, a: Actor, dt: number): void {
  const c = k.controls;
  const b = arcadeBody(a);
  const P = a.ctl;
  if (!b || !b.enable || !P) return;
  const o = P.opts;
  const gs = k.gravitySign;
  const og = onGround(k, a);
  const jumps = Math.max(1, Math.round(numOf(o.jumps, 1))) + P.bonusJumps;
  P.coyote = og ? (o.coyoteMs ?? 100) : P.coyote - dt * 1000;
  if (og) P.airJumps = jumps - 1;
  P.buffer = c.pressed('jump') ? (o.bufferMs ?? 130) : P.buffer - dt * 1000;
  const dash = dashOpts(o.dash);
  if (dash) {
    P.dashCd -= dt * 1000;
    if (c.pressed('dash') && P.dashCd <= 0 && !a.dashing) {
      a.dashing = true;
      P.dashT = dash.ms;
      P.dashDir = c.x ? Math.sign(c.x) : a.facing || 1;
      P.dashCd = dash.cooldown;
      b.setAllowGravity(false);
      a.invulnUntil = Math.max(a.invulnUntil || 0, k.clock + dash.ms + 60);
      k.scene.sfx('dash');
      k.fx.burst(a.x, a.y, { frames: ['smoke'], colors: [0xffffff], count: 5, speed: [30, 90], life: 300, size: 0.5, shrink: false });
    }
    if (a.dashing) {
      P.dashT -= dt * 1000;
      b.velocity.x = P.dashDir * numOf(dash.speed, 820);
      b.velocity.y = 0;
      P.ghostT -= dt * 1000;
      if (P.ghostT <= 0) {
        P.ghostT = 28;
        k.fx.ghost(a, 0x80ffff);
      }
      if (P.dashT <= 0) {
        a.dashing = false;
        b.setAllowGravity(true);
        b.velocity.x *= 0.4;
      }
      return;
    }
  }
  const auto = !!o.auto;
  // Runners speed up over time; the base speed stays live (a dial can change it mid-run).
  const base = numOf(o.speed, auto ? 360 : 300);
  if (auto) P.runBonus = Math.min(Math.max(0, numOf(o.maxSpeed, 620) - base), P.runBonus + numOf(o.speedUp, 6) * dt);
  const speed = (auto ? base + P.runBonus : base) * P.speedMul;
  const target = auto ? speed : c.x * speed;
  const accel = (target === 0 ? numOf(o.decel, 3200) : numOf(o.accel, 2600)) * (og ? 1 : 0.7) * dt;
  b.velocity.x = util.approach(b.velocity.x, target, accel);
  if (P.buffer > 0 && (P.coyote > 0 || P.airJumps > 0)) {
    const air = P.coyote <= 0;
    if (air) P.airJumps--;
    P.buffer = 0;
    P.coyote = 0;
    b.velocity.y = -numOf(o.jump, 640) * gs * (air ? 0.92 : 1);
    a.play('jump');
    k.fx.squash(a, 0.7, 1.32, 120);
    if (!air) k.fx.dust(a);
    else k.fx.shockwave(a.x, a.y + 20 * gs, { radius: 36, color: 0x9ff3ff });
    k.scene.sfx('jump', { pitch: air ? 1.35 : 1 });
    a.emit('jump', air);
  }
  if (c.released('jump') && b.velocity.y * gs < -80) b.velocity.y *= 0.5;
  const maxFall = numOf(o.maxFall, 900);
  if (b.velocity.y * gs > maxFall) b.velocity.y = maxFall * gs;
}

function driveTopdown(k: Kit, a: Actor, dt: number): void {
  const c = k.controls;
  const b = arcadeBody(a);
  const o = a.topdownOpts;
  if (!b || !b.enable || !o) return;
  let x = c.x;
  let y = c.y;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  const speed = numOf(o.speed, 280) * (a.ctl?.speedMul ?? 1);
  const acc = (len ? numOf(o.accel, 2400) : numOf(o.decel, 2800)) * dt;
  b.velocity.x = util.approach(b.velocity.x, x * speed, acc);
  b.velocity.y = util.approach(b.velocity.y, y * speed, acc);
}

function driveFlyer(k: Kit, a: Actor, dt: number): void {
  const c = k.controls;
  const b = arcadeBody(a);
  const o = a.flyerOpts;
  if (!b || !b.enable || !o) return;
  const gs = k.gravitySign;
  const speed = numOf(o.speed, 260);
  b.velocity.x = util.approach(b.velocity.x, c.x * speed, 1800 * dt);
  if (c.pressed('jump') || c.pressed('up')) {
    b.velocity.y = -numOf(o.lift, 420) * gs;
    a.play('fly');
    k.fx.squash(a, 0.85, 1.15, 90);
    k.scene.sfx('jump', { pitch: 1.5, volume: 0.4 });
    a.emit('jump', true);
  }
  if (o.glide !== false && (c.held('jump') || c.held('up')) && b.velocity.y * gs > 120) b.velocity.y = 120 * gs;
  if (!k.hasGravity) b.velocity.y = util.approach(b.velocity.y, c.y * speed, 1800 * dt);
}

function driveShooter(k: Kit, a: Actor, dt: number): void {
  const c = k.controls;
  const S = a.shooterState;
  if (!S) return;
  const o = S.opts;
  S.cd -= dt * 1000;
  if (!(o.auto || c.held('fire')) || S.cd > 0 || a.dashing) return;
  S.cd = Math.max(30, numOf(o.every, 120));
  let angle = a.facing < 0 ? 180 : 0;
  if (o.aim === 'pointer') angle = util.angleTo(a, c.kitPointer);
  else if (o.aim === 'up') angle = -90;
  else if (o.aim === '8way' && c.up) angle = c.x ? Math.atan2(-1, c.x) / DEG : -90;
  else if (o.aim === '8way' && c.down && !onGround(k, a)) angle = c.x ? Math.atan2(1, c.x) / DEG : 90;
  const n = Math.max(1, Math.min(12, Math.round(numOf(o.count, 1))));
  for (let i = 0; i < n; i++) {
    const aa = angle + (n > 1 ? (i - (n - 1) / 2) * (o.arc ?? 12) : 0) + util.rand(-(o.spread ?? 0), o.spread ?? 0);
    k.scene.shoot(a, aa, { key: o.key, speed: numOf(o.speed, 900), damage: numOf(o.damage, 1), role: 'hero', muzzle: o.muzzle ?? 24, offsetY: o.offsetY ?? -4, blend: o.blend ?? 'add', pierce: o.pierce });
  }
  a.play('shoot');
  const mx = a.x + Math.cos(angle * DEG) * 28;
  const my = a.y - 4 + Math.sin(angle * DEG) * 28;
  k.fx.burst(mx, my, { colors: [0xffffff, colorInt(o.color ?? 0x9ff3ff)], count: 3, speed: [20, 90], life: 90, size: 0.55 });
  k.scene.sfx(o.sound ?? 'shoot', { volume: 0.25 });
  a.emit('shoot', angle);
}

function drivePatrol(_k: Kit, a: Actor): void {
  const b = arcadeBody(a);
  if (!b || !b.enable) return;
  if (b.blocked.left || b.touching.left) a.patrolDir = 1;
  if (b.blocked.right || b.touching.right) a.patrolDir = -1;
  if (a.patrolMin !== undefined && a.x < a.patrolMin) a.patrolDir = 1;
  if (a.patrolMax !== undefined && a.x > a.patrolMax) a.patrolDir = -1;
  b.velocity.x = (a.patrolDir ?? -1) * numOf(a.patrolSpeed, 90);
}

function driveChase(k: Kit, a: Actor, dt: number): void {
  const b = arcadeBody(a);
  const t = a.chaseTarget;
  if (!b || !b.enable || !t || t.active === false) return;
  const speed = numOf(a.chaseSpeed, 120);
  const ang = Math.atan2(t.y - a.y, t.x - a.x);
  if (b.allowGravity && k.hasGravity) b.velocity.x = util.approach(b.velocity.x, Math.sign(t.x - a.x) * speed, 900 * dt);
  else {
    b.velocity.x = util.approach(b.velocity.x, Math.cos(ang) * speed, 600 * dt);
    b.velocity.y = util.approach(b.velocity.y, Math.sin(ang) * speed, 600 * dt);
  }
}

function driveWander(k: Kit, a: Actor, dt: number): void {
  const b = arcadeBody(a);
  const w = a.wanderState;
  if (!b || !b.enable || !w) return;
  w.t -= dt;
  if (w.t <= 0 || util.dist(a, w.target) < 12) {
    w.t = util.rand(1.2, 3);
    const ang = util.rand(0, Math.PI * 2);
    const r = util.rand(w.radius * 0.3, w.radius);
    w.target = { x: w.home.x + Math.cos(ang) * r, y: b.allowGravity && k.hasGravity ? a.y : w.home.y + Math.sin(ang) * r };
  }
  const speed = numOf(w.speed, 80);
  const dx = w.target.x - a.x;
  const dy = w.target.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  b.velocity.x = util.approach(b.velocity.x, (dx / d) * speed, 500 * dt);
  if (!(b.allowGravity && k.hasGravity)) b.velocity.y = util.approach(b.velocity.y, (dy / d) * speed, 500 * dt);
}

function driveOrbit(_k: Kit, a: Actor, dt: number): void {
  const o = a.orbitState;
  if (!o) return;
  o.angle += numOf(o.speed, 90) * DEG * dt;
  const x = o.center.x + Math.cos(o.angle) * o.radius;
  const y = o.center.y + Math.sin(o.angle) * o.radius;
  const b = arcadeBody(a);
  if (b && b.enable && dt > 0) {
    b.velocity.set((x - a.x) / dt, (y - a.y) / dt);
  } else a.setPosition(x, y);
}

/** Is it standing on something? (Respects flipped gravity.) */
export function onGround(k: Kit, a: { body?: unknown }): boolean {
  const b = arcadeBody(a);
  if (!b) return false;
  return k.gravitySign > 0 ? b.blocked.down || b.touching.down : b.blocked.up || b.touching.up;
}

function use(k: Kit, a: Actor, fn: (dt: number) => void, tag: string): Actor {
  const tagged = fn as ((dt: number) => void) & { tag?: string };
  tagged.tag = tag;
  if (!a.drivers.some((d) => (d as { tag?: string }).tag === tag)) a.drivers.push(tagged);
  k.driven.add(a);
  return a;
}

// ------------------------------------------------------------------ install

export interface SpawnFlags {
  hp?: number;
  iframes?: number;
  points?: number;
}

/**
 * Gives a game object the kit's fields and methods (health, behaviours, play/face fallbacks).
 * Characters bring their own play/face/lookAt.
 */
export function installActor(k: Kit, obj: Phaser.GameObjects.GameObject, key: string, spec: ArtSpec, role: Role): Actor {
  const a = obj as Actor;
  a.role = role;
  a.key = key;
  a.spec = spec;
  a.facing ??= 1;
  a.drivers = [];
  a.hp = 0;
  a.maxHp = 0;
  a.alive = true;
  a.invincible = false;
  a.invulnUntil = 0;
  a.iframes = 0;
  a.points = 0;
  a.hasHealth = false;
  a.damage = (n = 1, d: DamageInfo = {}) => damage(k, a, n, d);
  a.heal = (n = 1) => {
    if (!a.hasHealth || !a.alive) return;
    a.hp = Math.min(a.maxHp, a.hp + n);
    k.ui.pop(a.x, a.y - 30, '+' + n + ' HP', { color: '#7ddf8c' });
  };
  a.kill = () => {
    if (!a.hasHealth) {
      a.alive = false;
      a.destroy();
      return;
    }
    die(k, a, {});
  };
  const ctl = (o: PlatformerOptions): void => {
    a.ctl = { opts: o, coyote: 0, buffer: 0, airJumps: 0, dashCd: 0, dashT: 0, dashDir: 1, ghostT: 0, bonusJumps: a.ctl?.bonusJumps ?? 0, speedMul: a.ctl?.speedMul ?? 1, runBonus: 0 };
    a.stomper = o.stomp !== false;
  };
  a.platformer = (o: PlatformerOptions = {}) => {
    ctl(o);
    return use(k, a, (dt) => drivePlatformer(k, a, dt), 'move');
  };
  a.runner = (o: PlatformerOptions = {}) => {
    // Runners leave the screen-sized world and must be able to fall into pits.
    arcadeBody(a)?.setCollideWorldBounds(false);
    ctl({ speed: 360, maxSpeed: 620, speedUp: 6, jump: 700, jumps: 2, ...o, auto: true });
    return use(k, a, (dt) => drivePlatformer(k, a, dt), 'move');
  };
  a.topdown = (o: TopdownOptions = {}) => {
    a.topdownOpts = o;
    return use(k, a, (dt) => driveTopdown(k, a, dt), 'move');
  };
  a.flyer = (o: FlyerOptions = {}) => {
    a.flyerOpts = o;
    return use(k, a, (dt) => driveFlyer(k, a, dt), 'move');
  };
  a.shooter = (o: ShooterOptions = {}) => {
    a.shooterState = { opts: { key: 'shot', aim: 'facing', ...o }, cd: 0 };
    // Aiming with UP must not also jump.
    if (o.aim === '8way') k.controls.bind.jump = k.controls.bind.jump.filter((n) => n !== 'UP' && n !== 'W');
    return use(k, a, (dt) => driveShooter(k, a, dt), 'shoot');
  };
  a.patrol = (speed: Num = 90, o: { dir?: 1 | -1; min?: number; max?: number } = {}) => {
    a.patrolSpeed = speed;
    a.patrolDir = o.dir ?? -1;
    a.patrolMin = o.min;
    a.patrolMax = o.max;
    return use(k, a, () => drivePatrol(k, a), 'ai');
  };
  a.chase = (target: Point, speed: Num = 120) => {
    a.chaseTarget = target;
    a.chaseSpeed = speed;
    return use(k, a, (dt) => driveChase(k, a, dt), 'ai');
  };
  a.wander = (o: { speed?: Num; radius?: number } = {}) => {
    a.wanderState = { speed: o.speed ?? 80, radius: o.radius ?? 160, home: { x: a.x, y: a.y }, target: { x: a.x, y: a.y }, t: 0 };
    return use(k, a, (dt) => driveWander(k, a, dt), 'ai');
  };
  a.orbit = (center: Point, radius: number, speed: Num = 90) => {
    a.orbitState = { center, radius, speed, angle: Math.atan2(a.y - center.y, a.x - center.x) };
    return use(k, a, (dt) => driveOrbit(k, a, dt), 'ai');
  };
  a.jump = (v?: Num) => {
    const b = arcadeBody(a);
    if (b) {
      b.velocity.y = -numOf(v, a.ctl ? numOf(a.ctl.opts.jump, 640) : 600) * k.gravitySign;
      a.play('jump');
      k.fx.squash(a, 0.72, 1.3, 120);
    }
    return a;
  };
  return a;
}

/** Plain sprites answer play/face/lookAt too, so game code never needs to know what is rigged. */
export function spriteFallbacks(k: Kit, a: Actor): void {
  const sprite = a as Actor & Partial<Phaser.GameObjects.Sprite>;
  const phaserPlay = sprite instanceof Phaser.GameObjects.Sprite ? sprite.play.bind(sprite) : null;
  a.play = (name: string) => {
    if (phaserPlay && k.scene.anims.exists(name)) {
      phaserPlay(name, true);
      return a;
    }
    if (name === 'hurt') k.fx.squash(a, 1.2, 0.8, 90);
    else if (name === 'attack' || name === 'shoot') k.fx.squash(a, 0.85, 1.2, 90);
    else if (name === 'jump') k.fx.squash(a, 0.75, 1.3, 110);
    else if (name === 'cheer' || name === 'victory') k.scene.tweens.add({ targets: a, y: a.y - 20, yoyo: true, repeat: 3, duration: 160 });
    return a;
  };
  a.face = (d: number) => {
    if (d) {
      a.facing = d < 0 ? -1 : 1;
      if (sprite.setFlipX) sprite.setFlipX(d < 0);
    }
    return a;
  };
  a.lookAt = () => a;
}
