/**
 * An additive pose: identity = the drawing as drawn. Per bone: rotation (radians, + = clockwise on
 * screen), offset of its joint in the parent's frame, and scale along (sx) and across (sy) the bone,
 * not inherited by children (a child's position scales with its parent, its shape doesn't shear).
 * The whole character: offset, rotation and scale about a pivot at the anchor + (0, pivotY), so
 * squash on the ground keeps the feet down and stretch in the air works about the middle.
 */
export class Pose {
  readonly rot: Float32Array;
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  gx = 0;
  gy = 0;
  grot = 0;
  gsx = 1;
  gsy = 1;
  pivotY = 0;
  /** 0..1: keep the lowest foot at its drawn height (walks never float or sink). */
  ground = 0;
  /** 0..1: flash toward a solid colour (hurt). */
  flash = 0;
  alpha = 1;

  constructor(readonly n: number) {
    this.rot = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.sx = new Float32Array(n).fill(1);
    this.sy = new Float32Array(n).fill(1);
  }

  reset(): this {
    this.rot.fill(0);
    this.dx.fill(0);
    this.dy.fill(0);
    this.sx.fill(1);
    this.sy.fill(1);
    this.gx = this.gy = this.grot = this.pivotY = this.ground = this.flash = 0;
    this.gsx = this.gsy = this.alpha = 1;
    return this;
  }

  copyFrom(p: Pose): this {
    this.rot.set(p.rot);
    this.dx.set(p.dx);
    this.dy.set(p.dy);
    this.sx.set(p.sx);
    this.sy.set(p.sy);
    this.gx = p.gx;
    this.gy = p.gy;
    this.grot = p.grot;
    this.gsx = p.gsx;
    this.gsy = p.gsy;
    this.pivotY = p.pivotY;
    this.ground = p.ground;
    this.flash = p.flash;
    this.alpha = p.alpha;
    return this;
  }

  /** this = lerp(a, this, t) for every bone, or only where `mask` is set (with the whole-body part kept). */
  blendFrom(a: Pose, t: number, mask?: Uint8Array): this {
    const u = 1 - t;
    for (let i = 0; i < this.n; i++) {
      if (mask && !mask[i]) continue;
      this.rot[i] = a.rot[i] * u + this.rot[i] * t;
      this.dx[i] = a.dx[i] * u + this.dx[i] * t;
      this.dy[i] = a.dy[i] * u + this.dy[i] * t;
      this.sx[i] = a.sx[i] * u + this.sx[i] * t;
      this.sy[i] = a.sy[i] * u + this.sy[i] * t;
    }
    if (mask) return this;
    this.gx = a.gx * u + this.gx * t;
    this.gy = a.gy * u + this.gy * t;
    this.grot = a.grot * u + this.grot * t;
    this.gsx = a.gsx * u + this.gsx * t;
    this.gsy = a.gsy * u + this.gsy * t;
    this.pivotY = a.pivotY * u + this.pivotY * t;
    this.ground = a.ground * u + this.ground * t;
    this.flash = a.flash * u + this.flash * t;
    this.alpha = a.alpha * u + this.alpha * t;
    return this;
  }
}
