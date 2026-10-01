import type * as Phaser from 'phaser';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../player/protocol';

export interface PhysicsOptions {
  /** "dynamic" (moved by physics), "static" (never moves: floors, walls) or "kinematic" (moved by code, pushes others). */
  type?: 'dynamic' | 'static' | 'kinematic';
  /** Collider shape. Default "box". "circle" and "sphere" are the same. */
  shape?: 'box' | 'circle' | 'sphere' | 'capsule';
  mass?: number;
  friction?: number;
  /** Bounciness 0..1 (restitution). */
  bounce?: number;
  /** Prevent the body from rotating (platformer characters). */
  fixedRotation?: boolean;
  /** Gravity multiplier (0 = floats). */
  gravity?: number;
  /** Detect overlaps (onCollide) without physically blocking. */
  sensor?: boolean;
  /** Slows movement over time (air resistance), per second. */
  damping?: number;
  /** Collider size as a fraction of the costume size (default 1). */
  scale?: number;
}

/** Stage pixels per second squared, up is +. */
export const DEFAULT_GRAVITY = -1600;

/** Matter measures velocity in pixels per 60 Hz step and gravity scaled by 1/1000 (see Matter's Body.update). */
const STEP = 60;
const GRAVITY_UNIT = 1000;

/** The parts of the Matter library Amble uses (Phaser bundles it as `Phaser.Physics.Matter.Matter`). */
export interface Matter {
  Body: typeof MatterJS.Body;
  Bodies: typeof MatterJS.Bodies;
  Composite: typeof MatterJS.Composite;
  Query: typeof MatterJS.Query;
}
export type Body = MatterJS.BodyType;

/** Matter's engine as Phaser runs it (its typings miss `gravity`). */
interface Engine {
  gravity: { x: number; y: number; scale: number };
  world: MatterJS.CompositeType;
}

/** A pair of bodies that started touching (with Matter's collision data). */
interface Pair {
  bodyA: Body;
  bodyB: Body;
  collision: { normal?: Point; supports?: Point[] };
}

/** A point in stage coordinates (0, 0 is the middle of the stage, y is up). */
export interface Point {
  x: number;
  y: number;
}

/** Stage coordinates -> Phaser world coordinates (y down, 0, 0 at the stage's top left). */
export function toWorld(x: number, y: number): Point {
  return { x: x + STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 - y };
}

/** Phaser world coordinates -> stage coordinates. */
export function toStage(x: number, y: number): Point {
  return { x: x - STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 - y };
}

export interface CollisionEvent<T> {
  a: T | null;
  b: T | null;
  /** Where they touched and the direction from a to b, in stage coordinates (null for sensors). */
  point: Point | null;
  normal: Point | null;
  sensor: boolean;
}

/**
 * One game's physics, on Phaser's Matter: bodies in stage units (pixels per second, y up),
 * stepped by the game's fixed ticks, with collisions reported as pairs of owners.
 */
export class PhysicsWorld<T> {
  readonly M: Matter;
  private readonly owners = new Map<number, T>();
  private readonly gravityFactors = new Map<Body, number>();
  private pending: Array<CollisionEvent<T>> = [];
  private gravityStage: Point = { x: 0, y: DEFAULT_GRAVITY };

  constructor(
    private readonly scene: Phaser.Scene,
    matter: Matter,
  ) {
    this.M = matter;
    this.gravity = this.gravityStage;
    scene.matter.world.on('collisionstart', (event: { pairs: Pair[] }) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA.parent ?? pair.bodyA;
        const b = pair.bodyB.parent ?? pair.bodyB;
        const sensor = a.isSensor || b.isSensor;
        const support = pair.collision.supports?.[0];
        const n = pair.collision.normal;
        this.pending.push({
          a: this.owners.get(a.id) ?? null,
          b: this.owners.get(b.id) ?? null,
          point: !sensor && support ? toStage(support.x, support.y) : null,
          normal: !sensor && n ? { x: n.x, y: -n.y } : null,
          sensor,
        });
      }
    });
  }

  private get engine(): Engine {
    return this.scene.matter.world.engine as unknown as Engine;
  }

  /** Gravity in stage pixels per second squared (y up). */
  get gravity(): Point {
    return { ...this.gravityStage };
  }

  set gravity(g: { x?: number; y?: number }) {
    this.gravityStage = { x: Number(g.x ?? this.gravityStage.x) || 0, y: Number(g.y ?? this.gravityStage.y) || 0 };
    this.engine.gravity.x = this.gravityStage.x / GRAVITY_UNIT;
    this.engine.gravity.y = -this.gravityStage.y / GRAVITY_UNIT;
    this.engine.gravity.scale = 0.001;
  }

  /**
   * Creates a body for `owner`: `center` is the collider's middle and `angle` its rotation, in stage
   * coordinates; `size` is in stage pixels.
   */
  createBody(owner: T, center: Point, size: { width: number; height: number }, angle: number, opts: PhysicsOptions): Body {
    const { M } = this;
    const type = opts.type ?? 'dynamic';
    const k = opts.scale ?? 1;
    const w = Math.max(1, size.width * k);
    const h = Math.max(1, size.height * k);
    const at = toWorld(center.x, center.y);
    const options: MatterJS.IChamferableBodyDefinition = {
      isStatic: type !== 'dynamic',
      isSensor: Boolean(opts.sensor),
      friction: opts.friction ?? 0.5,
      frictionStatic: 0.5,
      restitution: Math.max(0, Math.min(1, opts.bounce ?? 0)),
      frictionAir: Math.max(0, Number(opts.damping) || 0) / STEP,
      label: 'amble',
    };
    const kind = opts.shape ?? 'box';
    let body: Body;
    if (kind === 'circle' || kind === 'sphere') body = M.Bodies.circle(at.x, at.y, Math.min(w, h) / 2, options);
    else if (kind === 'capsule') body = M.Bodies.rectangle(at.x, at.y, w, h, { ...options, chamfer: { radius: Math.max(0, Math.min(w, h) / 2 - 0.5) } });
    else body = M.Bodies.rectangle(at.x, at.y, w, h, options);
    M.Body.setAngle(body, (-angle * Math.PI) / 180);
    if (type === 'dynamic') {
      M.Body.setMass(body, Math.max(0.0001, opts.mass ?? 1));
      if (opts.fixedRotation) M.Body.setInertia(body, Infinity);
      const factor = opts.gravity ?? 1;
      if (factor === 0) (body as Body & { ignoreGravity: boolean }).ignoreGravity = true;
      else if (factor !== 1) this.gravityFactors.set(body, factor);
    }
    this.owners.set(body.id, owner);
    this.scene.matter.world.add(body);
    return body;
  }

  removeBody(body: Body): void {
    this.owners.delete(body.id);
    this.gravityFactors.delete(body);
    this.scene.matter.world.remove(body);
  }

  ownerOf(body: Body): T | null {
    return this.owners.get((body.parent ?? body).id) ?? null;
  }

  /** Moves a body (keeping its velocity, unless `carry` turns the move into velocity, for kinematic bodies). */
  place(body: Body, center: Point, angle: number | null, carry = false): void {
    const at = toWorld(center.x, center.y);
    this.M.Body.setPosition(body, at, carry);
    if (angle !== null) this.M.Body.setAngle(body, (-angle * Math.PI) / 180, carry);
  }

  /** Velocity in stage pixels per second (y up). */
  velocityOf(body: Body): Point {
    return { x: body.velocity.x * STEP, y: -body.velocity.y * STEP };
  }

  setVelocity(body: Body, v: Point): void {
    this.M.Body.setVelocity(body, { x: v.x / STEP, y: -v.y / STEP });
  }

  /** A push over one tick, in mass * pixels per second squared. */
  applyForce(body: Body, force: Point): void {
    // Matter turns force / mass into pixels per step, per step, times the step in milliseconds squared:
    // (1/60 s)^2 * (1000/60 ms)^2 makes one unit of Matter force a millionth of ours.
    const k = 1 / (STEP * STEP * (1000 / STEP) ** 2);
    this.M.Body.applyForce(body, body.position, { x: force.x * k, y: -force.y * k });
  }

  /** Steps the world one fixed tick. */
  step(): void {
    const g = this.engine.gravity;
    for (const [body, factor] of this.gravityFactors) {
      body.force.x += body.mass * g.x * g.scale * (factor - 1);
      body.force.y += body.mass * g.y * g.scale * (factor - 1);
    }
    this.scene.matter.world.step(1000 / STEP);
  }

  /** Collisions that started during the last step. */
  takeEvents(): Array<CollisionEvent<T>> {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  /** Bodies that block (not sensors), except `ignore`. */
  private solidBodies(ignore?: Body | null): Body[] {
    return (this.M.Composite.allBodies(this.engine.world) as Body[]).filter((b) => b !== ignore && !b.isSensor);
  }

  /** The bodies a ray from `from` to `to` (stage coordinates) passes through, nearest first. */
  raycast(from: Point, to: Point, ignore?: Body | null): Array<{ body: Body; owner: T | null; distance: number }> {
    const a = toWorld(from.x, from.y);
    const b = toWorld(to.x, to.y);
    const hits = this.M.Query.ray(this.solidBodies(ignore), a, b, 1) as unknown as Array<{ bodyA: Body; bodyB: Body }>;
    const seen = new Set<Body>();
    const out: Array<{ body: Body; owner: T | null; distance: number }> = [];
    for (const hit of hits) {
      const body = (hit.bodyA.parent ?? hit.bodyA) as Body;
      if (seen.has(body)) continue;
      seen.add(body);
      out.push({ body, owner: this.ownerOf(body), distance: Math.hypot(body.position.x - a.x, body.position.y - a.y) });
    }
    return out.sort((p, q) => p.distance - q.distance);
  }
}
