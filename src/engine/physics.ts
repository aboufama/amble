import {
  HavokPlugin,
  PhysicsEngine,
  Physics6DoFConstraint,
  PhysicsBody,
  PhysicsConstraintAxis,
  PhysicsEventType,
  PhysicsMotionType,
  PhysicsPrestepType,
  PhysicsRaycastResult,
  PhysicsShapeBox,
  PhysicsShapeCapsule,
  PhysicsShapeSphere,
  Quaternion,
  TransformNode,
  Vector3,
  type IBasePhysicsCollisionEvent,
  type IPhysicsCollisionEvent,
  type PhysicsShape,
  type Scene,
} from './babylon';
import type { WorldMode } from '../player/protocol';

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
  /** Slows movement over time (air resistance). */
  damping?: number;
  /** Collider size as a fraction of the costume size (default 1). */
  scale?: number;
}

export const DEFAULT_GRAVITY: Record<WorldMode, Vector3> = {
  '2d': new Vector3(0, -1600, 0),
  '3d': new Vector3(0, -20, 0),
};

/** Owns the Havok world of one game and turns collision events into (bodyA, bodyB) pairs. */
export class PhysicsWorld {
  readonly plugin: HavokPlugin;
  private anchor: PhysicsBody | null = null;
  private pending: Array<{ a: PhysicsBody; b: PhysicsBody; point: Vector3 | null; normal: Vector3 | null; sensor: boolean }> = [];
  private teleported = new Set<PhysicsBody>();

  constructor(
    private readonly scene: Scene,
    readonly mode: WorldMode,
    havok: unknown,
  ) {
    this.plugin = new HavokPlugin(true, havok);
    scene.enablePhysics(DEFAULT_GRAVITY[mode].clone(), this.plugin);
    if (mode === '2d') this.plugin.setVelocityLimits(50000, 200);
    this.plugin.onCollisionObservable.add((ev: IPhysicsCollisionEvent) => {
      if (ev.type !== PhysicsEventType.COLLISION_STARTED) return;
      this.pending.push({ a: ev.collider, b: ev.collidedAgainst, point: ev.point?.clone() ?? null, normal: ev.normal?.clone() ?? null, sensor: false });
    });
    this.plugin.onTriggerCollisionObservable.add((ev: IBasePhysicsCollisionEvent) => {
      if (ev.type !== PhysicsEventType.TRIGGER_ENTERED) return;
      this.pending.push({ a: ev.collider, b: ev.collidedAgainst, point: null, normal: null, sensor: true });
    });
  }

  get gravity(): Vector3 {
    return this.scene.getPhysicsEngine()?.gravity?.clone() ?? Vector3.Zero();
  }

  set gravity(g: { x?: number; y?: number; z?: number }) {
    const cur = this.gravity;
    this.scene.getPhysicsEngine()?.setGravity(new Vector3(g.x ?? cur.x, g.y ?? cur.y, g.z ?? cur.z));
  }

  /** Collisions reported during the last physics step. */
  takeEvents(): typeof this.pending {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  private plane2DAnchor(): PhysicsBody {
    if (!this.anchor) {
      const node = new TransformNode('amble:plane-anchor', this.scene);
      const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
      const shape = new PhysicsShapeSphere(Vector3.Zero(), 0.01, this.scene);
      shape.filterMembershipMask = 0;
      shape.filterCollideMask = 0;
      body.shape = shape;
      this.anchor = body;
    }
    return this.anchor;
  }

  /**
   * Creates a body on `node`. Size/center describe the collider in the node's local space
   * (world units). In 2D the body is locked to the XY plane.
   */
  createBody(
    node: TransformNode,
    size: { width: number; height: number; depth: number },
    center: Vector3,
    opts: PhysicsOptions,
  ): PhysicsBody {
    const type = opts.type ?? 'dynamic';
    const motion =
      type === 'static' ? PhysicsMotionType.STATIC : type === 'kinematic' ? PhysicsMotionType.ANIMATED : PhysicsMotionType.DYNAMIC;
    const body = new PhysicsBody(node, motion, false, this.scene);
    const k = opts.scale ?? 1;
    const w = Math.max(0.001, size.width * k);
    const h = Math.max(0.001, size.height * k);
    const d = Math.max(0.001, size.depth * k);
    let shape: PhysicsShape;
    const kind = opts.shape ?? 'box';
    if (kind === 'circle' || kind === 'sphere') {
      shape = new PhysicsShapeSphere(center, Math.min(w, h) / 2, this.scene);
    } else if (kind === 'capsule') {
      const r = Math.min(w, d) / 2;
      const half = Math.max(0, h / 2 - r);
      shape = new PhysicsShapeCapsule(center.add(new Vector3(0, -half, 0)), center.add(new Vector3(0, half, 0)), r, this.scene);
    } else {
      shape = new PhysicsShapeBox(center, Quaternion.Identity(), new Vector3(w, h, d), this.scene);
    }
    shape.material = { friction: opts.friction ?? 0.5, restitution: Math.max(0, Math.min(1, opts.bounce ?? 0)) };
    if (opts.sensor) shape.isTrigger = true;
    body.shape = shape;
    body.setCollisionCallbackEnabled(true);

    if (motion === PhysicsMotionType.DYNAMIC) {
      const props = body.computeMassProperties();
      const mass = Math.max(0.0001, opts.mass ?? 1);
      // Havok reports inertia for a unit mass, so it doesn't need scaling.
      const inertia = (props.inertia ?? new Vector3(1, 1, 1)).clone();
      if (this.mode === '2d') {
        inertia.x = 0;
        inertia.y = 0;
        if (opts.fixedRotation) inertia.z = 0;
      } else if (opts.fixedRotation) {
        inertia.setAll(0);
      }
      body.setMassProperties({ mass, inertia, centerOfMass: props.centerOfMass, inertiaOrientation: props.inertiaOrientation });
      body.setGravityFactor(opts.gravity ?? 1);
      if (opts.damping) body.setLinearDamping(opts.damping);
      if (this.mode === '2d') this.lockToPlane(body, Boolean(opts.fixedRotation));
    } else if (motion === PhysicsMotionType.ANIMATED) {
      // Code moves kinematic bodies by moving the node; physics follows and pushes dynamic bodies.
      body.setPrestepType(PhysicsPrestepType.ACTION);
      body.disablePreStep = false;
    }
    return body;
  }

  private lockToPlane(body: PhysicsBody, fixedRotation: boolean): void {
    const limits = [
      { axis: PhysicsConstraintAxis.LINEAR_Z, minLimit: 0, maxLimit: 0 },
      { axis: PhysicsConstraintAxis.ANGULAR_X, minLimit: 0, maxLimit: 0 },
      { axis: PhysicsConstraintAxis.ANGULAR_Y, minLimit: 0, maxLimit: 0 },
    ];
    if (fixedRotation) limits.push({ axis: PhysicsConstraintAxis.ANGULAR_Z, minLimit: 0, maxLimit: 0 });
    const constraint = new Physics6DoFConstraint(
      {
        pivotA: Vector3.Zero(),
        pivotB: Vector3.Zero(),
        axisA: new Vector3(1, 0, 0),
        axisB: new Vector3(1, 0, 0),
        perpAxisA: new Vector3(0, 1, 0),
        perpAxisB: new Vector3(0, 1, 0),
        collision: false,
      },
      limits,
      this.scene,
    );
    this.plane2DAnchor().addConstraint(body, constraint);
  }

  /** Moves a dynamic/static body to its node's transform on the next step. */
  teleport(body: PhysicsBody): void {
    if (body.getMotionType() === PhysicsMotionType.ANIMATED) return;
    body.setPrestepType(PhysicsPrestepType.TELEPORT);
    body.disablePreStep = false;
    this.teleported.add(body);
  }

  /** Called after each physics step. */
  afterStep(): void {
    for (const body of this.teleported) {
      if (!body.isDisposed) body.disablePreStep = true;
    }
    this.teleported.clear();
  }

  raycast(from: Vector3, to: Vector3, ignore?: PhysicsBody): PhysicsRaycastResult {
    const result = new PhysicsRaycastResult();
    const engine = this.scene.getPhysicsEngine() as PhysicsEngine | null;
    engine?.raycastToRef(from, to, result, ignore ? { ignoreBody: ignore } : undefined);
    return result;
  }
}
