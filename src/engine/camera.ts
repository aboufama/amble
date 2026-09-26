import { Camera, UniversalCamera, Vector3, type Scene } from './babylon';
import { STAGE_HEIGHT, STAGE_WIDTH, type WorldMode } from '../player/protocol';
import type { Input } from './input';

const DEG = Math.PI / 180;

/** Something the camera can follow (a sprite). */
export interface CameraTarget {
  readonly destroyed: boolean;
  readonly position: Vector3;
  /** 3D facing in degrees (0 = +z, 90 = +x). */
  heading: number;
}

export interface Follow2DOptions {
  /** 0 = snap to the target, 0.9 = very floaty. Default 0.85. */
  smooth?: number;
  /** Optional limits for the camera center. */
  bounds?: { minX?: number; maxX?: number; minY?: number; maxY?: number };
  offsetX?: number;
  offsetY?: number;
}

export interface Follow3DOptions {
  distance?: number;
  height?: number;
  /** 0 = snap, 0.9 = floaty. Default 0.85. */
  smooth?: number;
  /** Height above the target's feet to look at. Default 1. */
  lookHeight?: number;
}

export interface FirstPersonOptions {
  /** Eye height above the target's feet. Default 1.6. */
  height?: number;
  /** Turn with the mouse (captures the pointer on click). Default true. */
  mouseLook?: boolean;
  sensitivity?: number;
}

export interface OrbitOptions {
  distance?: number;
  height?: number;
  /** Degrees per second. Default 20. 0 = still. */
  speed?: number;
}

type Mode3D =
  | { kind: 'fixed' }
  | { kind: 'follow'; target: CameraTarget; opts: Required<Follow3DOptions> }
  | { kind: 'firstPerson'; target: CameraTarget; opts: Required<FirstPersonOptions> }
  | { kind: 'orbit'; target: CameraTarget | Vector3; opts: Required<OrbitOptions>; angle: number };

/**
 * The game camera. In 2D it is orthographic and shows 480 x 360 stage pixels around (x, y).
 * In 3D it is a perspective camera with follow / first-person / orbit helpers.
 */
export class CameraRig {
  readonly babylon: UniversalCamera;
  private _x = 0;
  private _y = 0;
  private _zoom = 1;
  private follow2d: { target: CameraTarget; opts: Required<Omit<Follow2DOptions, 'bounds'>> & { bounds?: Follow2DOptions['bounds'] } } | null = null;
  private mode3d: Mode3D = { kind: 'fixed' };
  private pitch = 0;
  private shakeStrength = 0;
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeOffset = Vector3.Zero();

  constructor(
    scene: Scene,
    private readonly mode: WorldMode,
    private readonly input: Input,
  ) {
    if (mode === '2d') {
      this.babylon = new UniversalCamera('camera', new Vector3(0, 0, -1000), scene);
      this.babylon.mode = Camera.ORTHOGRAPHIC_CAMERA;
      this.babylon.minZ = 1;
      this.babylon.maxZ = 5000;
      this.babylon.setTarget(new Vector3(0, 0, 0));
      this.applyOrtho();
    } else {
      this.babylon = new UniversalCamera('camera', new Vector3(0, 4, -9), scene);
      this.babylon.minZ = 0.05;
      this.babylon.maxZ = 3000;
      this.babylon.fov = 60 * DEG;
      this.babylon.setTarget(new Vector3(0, 1, 0));
    }
    this.babylon.inputs.clear();
    scene.activeCamera = this.babylon;
  }

  // ---------- 2D ----------

  private applyOrtho(): void {
    const cam = this.babylon;
    const hw = STAGE_WIDTH / 2 / this._zoom;
    const hh = STAGE_HEIGHT / 2 / this._zoom;
    cam.orthoLeft = -hw;
    cam.orthoRight = hw;
    cam.orthoTop = hh;
    cam.orthoBottom = -hh;
    cam.position.x = this._x + this.shakeOffset.x;
    cam.position.y = this._y + this.shakeOffset.y;
  }

  /** 2D: camera center x (stage pixels). */
  get x(): number {
    return this._x;
  }
  set x(v: number) {
    this._x = Number(v) || 0;
    if (this.mode === '2d') this.applyOrtho();
  }
  /** 2D: camera center y. */
  get y(): number {
    return this._y;
  }
  set y(v: number) {
    this._y = Number(v) || 0;
    if (this.mode === '2d') this.applyOrtho();
  }
  /** 2D: 1 = normal, 2 = twice as close. */
  get zoom(): number {
    return this._zoom;
  }
  set zoom(v: number) {
    this._zoom = Math.max(0.05, Number(v) || 1);
    if (this.mode === '2d') this.applyOrtho();
  }

  /** Visible world rectangle (2D). */
  view(): { left: number; right: number; top: number; bottom: number } {
    const hw = STAGE_WIDTH / 2 / this._zoom;
    const hh = STAGE_HEIGHT / 2 / this._zoom;
    return { left: this._x - hw, right: this._x + hw, top: this._y + hh, bottom: this._y - hh };
  }

  // ---------- both ----------

  /** Follow a sprite. 2D options: smooth, bounds, offsetX/Y. 3D options: distance, height, smooth, lookHeight. */
  follow(target: CameraTarget | null, opts: Follow2DOptions & Follow3DOptions = {}): void {
    this.input.unlockPointer();
    if (!target) {
      this.follow2d = null;
      this.mode3d = { kind: 'fixed' };
      return;
    }
    if (this.mode === '2d') {
      this.follow2d = {
        target,
        opts: { smooth: opts.smooth ?? 0.85, offsetX: opts.offsetX ?? 0, offsetY: opts.offsetY ?? 0, bounds: opts.bounds },
      };
      return;
    }
    this.mode3d = {
      kind: 'follow',
      target,
      opts: { distance: opts.distance ?? 7, height: opts.height ?? 3, smooth: opts.smooth ?? 0.85, lookHeight: opts.lookHeight ?? 1 },
    };
  }

  /** 3D: see through a sprite's eyes. With mouseLook, clicking the game captures the mouse. */
  firstPerson(target: CameraTarget, opts: FirstPersonOptions = {}): void {
    const full = { height: opts.height ?? 1.6, mouseLook: opts.mouseLook ?? true, sensitivity: opts.sensitivity ?? 0.15 };
    this.mode3d = { kind: 'firstPerson', target, opts: full };
    if (full.mouseLook) this.input.lockPointer();
  }

  /** 3D: circle around a sprite or point. */
  orbit(target: CameraTarget | { x: number; y: number; z: number }, opts: OrbitOptions = {}): void {
    this.input.unlockPointer();
    const t = 'destroyed' in target ? (target as CameraTarget) : new Vector3(target.x, target.y, target.z);
    this.mode3d = {
      kind: 'orbit',
      target: t,
      opts: { distance: opts.distance ?? 10, height: opts.height ?? 5, speed: opts.speed ?? 20 },
      angle: 0,
    };
  }

  /** 3D: stop any follow mode and place the camera. */
  set position(p: { x: number; y: number; z?: number }) {
    this.mode3d = { kind: 'fixed' };
    this.follow2d = null;
    if (this.mode === '2d') {
      this.x = p.x;
      this.y = p.y;
    } else {
      this.babylon.position.set(p.x, p.y, p.z ?? this.babylon.position.z);
    }
  }
  get position(): Vector3 {
    return this.babylon.position;
  }

  lookAt(x: number, y: number, z: number): void {
    if (this.mode === '3d') this.babylon.setTarget(new Vector3(x, y, z));
  }

  /** Vertical field of view in degrees (3D). */
  get fov(): number {
    return this.babylon.fov / DEG;
  }
  set fov(deg: number) {
    this.babylon.fov = Math.max(10, Math.min(150, Number(deg) || 60)) * DEG;
  }

  shake(strength?: number, seconds = 0.3): void {
    this.shakeStrength = strength ?? (this.mode === '2d' ? 8 : 0.25);
    this.shakeDuration = Math.max(0.01, seconds);
    this.shakeTime = this.shakeDuration;
  }

  /** Called once per fixed tick. */
  tick(dt: number): void {
    // Shake
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / this.shakeDuration) * this.shakeStrength;
      this.shakeOffset.set((Math.random() * 2 - 1) * k, (Math.random() * 2 - 1) * k, this.mode === '3d' ? (Math.random() * 2 - 1) * k : 0);
    } else if (this.shakeOffset.x !== 0 || this.shakeOffset.y !== 0) {
      this.shakeOffset.setAll(0);
    }

    if (this.mode === '2d') {
      const f = this.follow2d;
      if (f && !f.target.destroyed) {
        let tx = f.target.position.x + f.opts.offsetX;
        let ty = f.target.position.y + f.opts.offsetY;
        const b = f.opts.bounds;
        if (b) {
          if (b.minX !== undefined) tx = Math.max(b.minX, tx);
          if (b.maxX !== undefined) tx = Math.min(b.maxX, tx);
          if (b.minY !== undefined) ty = Math.max(b.minY, ty);
          if (b.maxY !== undefined) ty = Math.min(b.maxY, ty);
        }
        const t = 1 - Math.min(0.99, Math.max(0, f.opts.smooth));
        this._x += (tx - this._x) * t;
        this._y += (ty - this._y) * t;
      }
      this.applyOrtho();
      return;
    }

    const cam = this.babylon;
    const m = this.mode3d;
    if (m.kind === 'follow' && !m.target.destroyed) {
      const p = m.target.position;
      const h = m.target.heading * DEG;
      const desired = new Vector3(p.x - Math.sin(h) * m.opts.distance, p.y + m.opts.height, p.z - Math.cos(h) * m.opts.distance);
      const t = 1 - Math.min(0.99, Math.max(0, m.opts.smooth));
      cam.position.addInPlace(desired.subtract(cam.position).scale(t));
      cam.position.addInPlace(this.shakeOffset);
      cam.setTarget(new Vector3(p.x, p.y + m.opts.lookHeight, p.z));
    } else if (m.kind === 'firstPerson' && !m.target.destroyed) {
      const p = m.target.position;
      if (m.opts.mouseLook && this.input.pointerLocked) {
        m.target.heading += this.input.mouse.dx * m.opts.sensitivity;
        this.pitch = Math.max(-85, Math.min(85, this.pitch + this.input.mouse.dy * m.opts.sensitivity));
      }
      cam.position.set(p.x, p.y + m.opts.height, p.z).addInPlace(this.shakeOffset);
      cam.rotation.set(this.pitch * DEG, m.target.heading * DEG, 0);
    } else if (m.kind === 'orbit') {
      const center = m.target instanceof Vector3 ? m.target : m.target.position;
      m.angle += m.opts.speed * dt;
      const a = m.angle * DEG;
      cam.position.set(center.x + Math.sin(a) * m.opts.distance, center.y + m.opts.height, center.z - Math.cos(a) * m.opts.distance);
      cam.setTarget(center.clone());
    }
  }

  /** Mouse look pitch in degrees (first-person). */
  get lookPitch(): number {
    return this.pitch;
  }
}
