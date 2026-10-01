import type * as Phaser from 'phaser';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../player/protocol';

/** Something the camera can follow (a sprite). */
export interface CameraTarget {
  readonly destroyed: boolean;
  readonly x: number;
  readonly y: number;
}

export interface FollowOptions {
  /** 0 = snap to the target, 0.9 = very floaty. Default 0.85. */
  smooth?: number;
  /** Optional limits for the camera center. */
  bounds?: { minX?: number; maxX?: number; minY?: number; maxY?: number };
  offsetX?: number;
  offsetY?: number;
}

/**
 * The game camera: shows 480 x 360 stage pixels around (x, y), in stage coordinates, at `zoom`.
 * `phaser` is Phaser's own camera, for its effects (fade, flash, pan...).
 */
export class CameraRig {
  private _x = 0;
  private _y = 0;
  private _zoom = 1;
  private following: { target: CameraTarget; opts: Required<Omit<FollowOptions, 'bounds'>> & { bounds?: FollowOptions['bounds'] } } | null = null;
  private shakeStrength = 0;
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeX = 0;
  private shakeY = 0;

  constructor(private readonly cam: Phaser.Cameras.Scene2D.Camera) {}

  /** Phaser's camera (fade, flash, pan, postFX...). Move and zoom with x, y and zoom instead. */
  get phaser(): Phaser.Cameras.Scene2D.Camera {
    return this.cam;
  }

  /** Camera center x (stage pixels). */
  get x(): number {
    return this._x;
  }
  set x(v: number) {
    this._x = Number(v) || 0;
  }
  /** Camera center y (stage pixels, up is +). */
  get y(): number {
    return this._y;
  }
  set y(v: number) {
    this._y = Number(v) || 0;
  }
  /** 1 = normal, 2 = twice as close. */
  get zoom(): number {
    return this._zoom;
  }
  set zoom(v: number) {
    this._zoom = Math.max(0.05, Number(v) || 1);
  }

  /** The visible stage rectangle. */
  view(): { left: number; right: number; top: number; bottom: number } {
    const hw = STAGE_WIDTH / 2 / this._zoom;
    const hh = STAGE_HEIGHT / 2 / this._zoom;
    return { left: this._x - hw, right: this._x + hw, top: this._y + hh, bottom: this._y - hh };
  }

  /** Follows a sprite. Options: smooth, bounds ({ minX, maxX, minY, maxY } for the center), offsetX/Y. `follow(null)` stops. */
  follow(target: CameraTarget | null, opts: FollowOptions = {}): void {
    if (!target) {
      this.following = null;
      return;
    }
    this.following = { target, opts: { smooth: opts.smooth ?? 0.85, offsetX: opts.offsetX ?? 0, offsetY: opts.offsetY ?? 0, bounds: opts.bounds } };
  }

  shake(strength = 8, seconds = 0.3): void {
    this.shakeStrength = Number(strength) || 0;
    this.shakeDuration = Math.max(0.01, Number(seconds) || 0.3);
    this.shakeTime = this.shakeDuration;
  }

  /** Called once per fixed tick. */
  tick(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / this.shakeDuration) * this.shakeStrength;
      this.shakeX = (Math.random() * 2 - 1) * k;
      this.shakeY = (Math.random() * 2 - 1) * k;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    const f = this.following;
    if (!f || f.target.destroyed) return;
    let tx = f.target.x + f.opts.offsetX;
    let ty = f.target.y + f.opts.offsetY;
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

  /** @internal Points Phaser's camera at the view; `scale` is canvas pixels per stage pixel. */
  _apply(scale: number): void {
    this.cam.setZoom(scale * this._zoom);
    this.cam.centerOn(STAGE_WIDTH / 2 + this._x + this.shakeX, STAGE_HEIGHT / 2 - this._y - this.shakeY);
  }
}
