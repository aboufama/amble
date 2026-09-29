/** Types shared by the kit's modules. */
import Phaser from 'phaser';
import type { Role } from '../../play/protocol';
import type { Num } from './dials';
import type { ArtSpec } from './spec';
import type { Point } from './util';

export type { Point, Role, Num };

export interface DamageInfo {
  from?: Point;
  x?: number;
  y?: number;
  knockback?: number;
  pop?: boolean;
}

export interface PlatformerOptions {
  speed?: Num;
  accel?: Num;
  decel?: Num;
  jump?: Num;
  jumps?: Num;
  coyoteMs?: number;
  bufferMs?: number;
  maxFall?: Num;
  stomp?: boolean;
  dash?: boolean | { speed?: Num; ms?: number; cooldown?: number };
  /** runner: keeps running right */
  auto?: boolean;
  maxSpeed?: Num;
  speedUp?: Num;
}

export interface TopdownOptions {
  speed?: Num;
  accel?: Num;
  decel?: Num;
  dash?: boolean | { speed?: Num; ms?: number; cooldown?: number };
}

export interface FlyerOptions {
  speed?: Num;
  /** Upward speed of a flap. */
  lift?: Num;
  glide?: boolean;
}

export interface ShooterOptions {
  key?: string;
  speed?: Num;
  every?: Num;
  damage?: Num;
  count?: Num;
  arc?: number;
  spread?: number;
  pierce?: number;
  aim?: 'facing' | '8way' | 'pointer' | 'up';
  auto?: boolean;
  blend?: 'add' | 'normal';
  sound?: string;
  color?: number | string;
  muzzle?: number;
  offsetY?: number;
}

export interface ShotOptions {
  key?: string;
  speed?: Num;
  damage?: Num;
  group?: string;
  role?: 'hero' | 'enemy';
  gravity?: boolean | number;
  bounce?: number;
  solid?: boolean;
  accel?: number;
  life?: number;
  pierce?: number;
  homing?: Point & { active?: boolean };
  turn?: number;
  spin?: number;
  spread?: number;
  muzzle?: number;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  blend?: 'add' | 'normal';
  rotate?: boolean;
  depth?: number;
  hitbox?: number;
  color?: number | string;
  onExpire?: (shot: Phaser.Physics.Arcade.Sprite) => void;
}

/** Live state of a platformer/runner controller. */
export interface PlatformerState {
  opts: PlatformerOptions;
  coyote: number;
  buffer: number;
  airJumps: number;
  dashCd: number;
  dashT: number;
  dashDir: number;
  ghostT: number;
  /** Extra jumps from twists (double jump). */
  bonusJumps: number;
  /** Multiplier from twists (tiny hero runs faster). */
  speedMul: number;
  /** Runners: speed gained over time on top of the (live) base speed. */
  runBonus: number;
}

export interface ShooterState {
  opts: ShooterOptions;
  cd: number;
}

/** The kit fields every spawned thing has (characters, sprites, Matter images). */
export interface ActorFields {
  role: Role;
  key: string;
  spec: ArtSpec;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  alive: boolean;
  invincible: boolean;
  invulnUntil: number;
  iframes: number;
  points: number;
  contactDamage?: number;
  stompDamage?: number;
  hasHealth: boolean;
  smash?: boolean;
  stomper?: boolean;
  dashing?: boolean;
  taken?: boolean;
  sound?: string;
  dieSize?: number;
  keep?: boolean;
  onPickup?: (hero: Actor, item: Actor) => boolean | void;
  ctl?: PlatformerState;
  topdownOpts?: TopdownOptions;
  flyerOpts?: FlyerOptions;
  shooterState?: ShooterState;
  patrolSpeed?: Num;
  patrolDir?: number;
  patrolMin?: number;
  patrolMax?: number;
  chaseTarget?: Point & { active?: boolean };
  chaseSpeed?: Num;
  wanderState?: { speed: Num; radius: number; home: Point; target: Point; t: number };
  orbitState?: { center: Point; radius: number; speed: Num; angle: number };
  /** Behaviour drivers run every game frame. */
  drivers: Array<(dt: number) => void>;
  /** The art fits this box when a drawing arrives (see swap.ts). */
  __ambleFit?: (frame: Phaser.Textures.Frame) => { w: number; h: number } | null;
}

export interface ActorMethods {
  damage(n?: number, d?: DamageInfo): boolean;
  heal(n?: number): void;
  kill(): void;
  platformer(o?: PlatformerOptions): Actor;
  runner(o?: PlatformerOptions): Actor;
  topdown(o?: TopdownOptions): Actor;
  flyer(o?: FlyerOptions): Actor;
  shooter(o?: ShooterOptions): Actor;
  patrol(speed?: Num, o?: { dir?: 1 | -1; min?: number; max?: number }): Actor;
  chase(target: Point, speed?: Num): Actor;
  wander(o?: { speed?: Num; radius?: number }): Actor;
  orbit(center: Point, radius: number, speed?: Num): Actor;
  jump(velocity?: Num): Actor;
  play(clip: string, o?: { once?: boolean; ms?: number; lock?: boolean }): Actor;
  face(dir: number): Actor;
  lookAt(target: Point | null): Actor;
}

/**
 * Anything the kit spawned. It is a Phaser GameObject with a transform (a Character container, an Arcade
 * sprite or a Matter image) plus the kit's fields and methods.
 */
export type Actor = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform &
  Phaser.GameObjects.Components.Visible &
  Phaser.GameObjects.Components.Depth &
  Phaser.GameObjects.Components.AlphaSingle &
  ActorFields &
  ActorMethods & {
    displayWidth: number;
    displayHeight: number;
    setTint(c: number): unknown;
    clearTint(): unknown;
    setTintFill?(c: number): unknown;
  };

export function arcadeBody(o: { body?: unknown } | null | undefined): Phaser.Physics.Arcade.Body | null {
  const b = o?.body;
  return b instanceof Phaser.Physics.Arcade.Body ? b : null;
}

export function isActor(o: unknown): o is Actor {
  return typeof o === 'object' && o !== null && Array.isArray((o as Partial<ActorFields>).drivers) && typeof (o as Partial<ActorFields>).key === 'string';
}
