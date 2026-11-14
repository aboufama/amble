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

  /** Shakes the view: `strength` in stage pixels (4 is gentle, 12 is strong). A value under 1 is read as Phaser's share of the screen (0.01 = 1%). */
  shake(strength = 8, seconds = 0.3): void {
    const s = Number(strength) || 0;
    this.shakeStrength = s > 0 && s < 1 ? s * STAGE_WIDTH : s;
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

  /** @internal The middle of the view, in Phaser's world pixels (the shake included). */
  _center(): { x: number; y: number } {
    return { x: STAGE_WIDTH / 2 + this._x + this.shakeX, y: STAGE_HEIGHT / 2 - this._y - this.shakeY };
  }

  /**
   * @internal Points Phaser's camera at the view; `scale` is canvas pixels per stage pixel.
   *
   * The canvas is drawn at the screen's own resolution (full screen, a small stage, a Retina
   * display), so Phaser's camera zooms by `scale`. Phaser zooms around the middle of the canvas and
   * measures scroll in canvas pixels, which is only right for things that scroll with the camera:
   * anything pinned to the screen (`setScrollFactor(0)`: backgrounds, HUD text) or on a parallax
   * layer would land in the wrong place at every scale but 1. So the camera is set up to behave, for
   * every scroll factor, exactly as it would on a 480 x 360 canvas, scaled up: scroll in stage
   * pixels, and the zoom origin placed so that the picture is that one times `scale`.
   */
  _apply(scale: number): void {
    const { scrollX, scrollY, zoom, originX, originY } = cameraSetup(scale, this._zoom, this._x + this.shakeX, this._y + this.shakeY);
    this.cam.setZoom(zoom);
    this.cam.setScroll(scrollX, scrollY);
    this.cam.setOrigin(originX / Math.max(1, this.cam.width), originY / Math.max(1, this.cam.height));
  }
}

/**
 * Phaser camera settings that show, on a canvas of 480 x 360 stage pixels times `scale`, what a
 * 480 x 360 camera centered on stage point (x, y) at `zoom` would show, for every scroll factor.
 *
 * Phaser draws a point p (after scroll) at `Z * (p - O) + O`, with Z its zoom and O its origin in
 * canvas pixels. The 480 x 360 picture, scaled, is `scale * (zoom * (p - 240) + 240)`. They agree
 * when Z = scale * zoom and O = 240 * scale * (1 - zoom) / (1 - Z) (0 without a zoom).
 */
export function cameraSetup(scale: number, zoom: number, x: number, y: number): { scrollX: number; scrollY: number; zoom: number; originX: number; originY: number } {
  let z = scale * zoom;
  // Zoomed, with scale * zoom exactly 1: no origin does it. A zoom a hair off is invisible.
  if (zoom !== 1 && Math.abs(1 - z) < 5e-4) z = 1.0005;
  const k = zoom === 1 ? 0 : (scale * (1 - zoom)) / (1 - z);
  return { scrollX: x, scrollY: -y, zoom: z, originX: (STAGE_WIDTH / 2) * k, originY: (STAGE_HEIGHT / 2) * k };
}
