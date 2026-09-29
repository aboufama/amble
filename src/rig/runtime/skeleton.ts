/**
 * Renderer-independent rig runtime: pose → forward kinematics (scale not inherited) → ground lock →
 * secondary motion (verlet tips on dynamic bones) → skin matrices → linear blend skinning.
 * Coordinates: art pixels, y down, radians (+ = clockwise on screen).
 */
import type { BoneRole, BoundRig, RigData } from '../types';
import type { Pose } from './pose';

interface Tip {
  x: number;
  y: number;
  px: number;
  py: number;
  init: boolean;
}

const FOOT = /^leg[A-Z]*2$/;
const THIGH = /^leg[A-Z]*1$/;

export class Skeleton {
  readonly n: number;
  readonly rig: RigData;
  readonly parent: Int16Array;
  readonly restX: Float32Array;
  readonly restY: Float32Array;
  readonly restA: Float32Array;
  readonly len: Float32Array;
  readonly localX: Float32Array;
  readonly localY: Float32Array;
  readonly localA: Float32Array;
  /** World joint position, angle and scale after `solve` (before the whole-body transform G). */
  readonly wx: Float32Array;
  readonly wy: Float32Array;
  readonly wa: Float32Array;
  readonly wsx: Float32Array;
  readonly wsy: Float32Array;
  /** Skin matrices [a b c d e f] per bone: x' = a x + c y + e, y' = b x + d y + f (includes G). */
  readonly K: Float32Array;
  readonly anchorX: number;
  readonly anchorY: number;
  /** Height of the character in art px (clip amplitudes scale with it). */
  readonly height: number;
  /** Bones whose tips touch the ground (feet). */
  readonly feet: number[];
  /** +1 if a positive rotation moves the bone tip toward +x (forward when facing right). */
  readonly fwd: Float32Array;
  /** +1 if a positive rotation raises the bone tip (outward and up for hanging limbs). */
  readonly up: Float32Array;
  private readonly roles = new Map<string, number>();
  private readonly dyn: (Tip | null)[];
  private readonly G = new Float32Array(6);
  private readonly restFootY: number;

  constructor(rig: RigData, opts: { height?: number } = {}) {
    this.rig = rig;
    const bones = rig.bones;
    const n = (this.n = bones.length);
    this.anchorX = rig.anchor[0];
    this.anchorY = rig.anchor[1];
    this.parent = Int16Array.from(bones.map((b) => b.parent));
    this.restX = Float32Array.from(bones.map((b) => b.x));
    this.restY = Float32Array.from(bones.map((b) => b.y));
    this.restA = Float32Array.from(bones.map((b) => Math.atan2(b.y2 - b.y, b.x2 - b.x)));
    this.len = Float32Array.from(bones.map((b) => Math.hypot(b.x2 - b.x, b.y2 - b.y)));
    this.localX = new Float32Array(n);
    this.localY = new Float32Array(n);
    this.localA = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.parent[i];
      if (p < 0) {
        this.localX[i] = this.restX[i] - this.anchorX;
        this.localY[i] = this.restY[i] - this.anchorY;
        this.localA[i] = this.restA[i];
      } else {
        const c = Math.cos(-this.restA[p]), s = Math.sin(-this.restA[p]);
        const vx = this.restX[i] - this.restX[p], vy = this.restY[i] - this.restY[p];
        this.localX[i] = c * vx - s * vy;
        this.localY[i] = s * vx + c * vy;
        this.localA[i] = this.restA[i] - this.restA[p];
      }
    }
    this.wx = new Float32Array(n);
    this.wy = new Float32Array(n);
    this.wa = new Float32Array(n);
    this.wsx = new Float32Array(n);
    this.wsy = new Float32Array(n);
    this.K = new Float32Array(n * 6);
    bones.forEach((b, i) => {
      this.roles.set(b.name, i);
      if (b.role !== 'extra') this.roles.set(b.role, i);
    });
    this.feet = [];
    bones.forEach((b, i) => {
      if (FOOT.test(b.role) || (THIGH.test(b.role) && !bones.some((c) => c.parent === i))) this.feet.push(i);
    });
    let top = Infinity;
    for (const b of bones) top = Math.min(top, b.y, b.y2);
    this.height = Math.max(8, opts.height ?? this.anchorY - top);
    this.fwd = new Float32Array(n);
    this.up = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dx = Math.cos(this.restA[i]), dy = Math.sin(this.restA[i]);
      this.fwd[i] = dy > 0 ? -1 : 1;
      const left = /L\d$/.test(bones[i].role) || (bones[i].role === 'extra' && bones[i].x2 < this.anchorX);
      this.up[i] = Math.abs(dx) > 0.25 ? (dx > 0 ? -1 : 1) : left ? 1 : -1;
    }
    this.dyn = bones.map((b) => (b.dynamic ? { x: 0, y: 0, px: 0, py: 0, init: false } : null));
    let foot = -Infinity;
    for (const f of this.feet) foot = Math.max(foot, bones[f].y2, bones[f].y);
    this.restFootY = Number.isFinite(foot) ? foot : this.anchorY;
  }

  /** Bone index by role (or, for extras, by name); -1 if absent. */
  role(r: BoneRole | string): number {
    return this.roles.get(r) ?? -1;
  }

  private fk(pose: Pose, lock: number, dt: number, mdx: number, mdy: number, springs: boolean): void {
    const { parent, localX, localY, localA, wx, wy, wa, wsx, wsy, len } = this;
    const G = this.G;
    const bones = this.rig.bones;
    for (let i = 0; i < this.n; i++) {
      const p = parent[i];
      const lx = localX[i] + pose.dx[i], ly = localY[i] + pose.dy[i];
      if (p < 0) {
        wx[i] = this.anchorX + lx;
        wy[i] = this.anchorY + ly + lock;
        wa[i] = localA[i] + pose.rot[i];
      } else {
        const c = Math.cos(wa[p]), s = Math.sin(wa[p]);
        const vx = lx * wsx[p], vy = ly * wsy[p];
        wx[i] = wx[p] + c * vx - s * vy;
        wy[i] = wy[p] + s * vx + c * vy;
        wa[i] = wa[p] + localA[i] + pose.rot[i];
      }
      wsx[i] = pose.sx[i];
      wsy[i] = pose.sy[i];
      const st = this.dyn[i];
      if (!springs || !st) continue;
      const spec = bones[i].dynamic!;
      const L = len[i] * wsx[i];
      const tx = wx[i] + Math.cos(wa[i]) * L, ty = wy[i] + Math.sin(wa[i]) * L;
      // in whole-character space, so jumps and squashes are felt
      const gtx = G[0] * tx + G[2] * ty + G[4], gty = G[1] * tx + G[3] * ty + G[5];
      const gjx = G[0] * wx[i] + G[2] * wy[i] + G[4], gjy = G[1] * wx[i] + G[3] * wy[i] + G[5];
      if (!st.init) {
        st.x = st.px = gtx;
        st.y = st.py = gty;
        st.init = true;
      }
      st.x -= mdx;
      st.px -= mdx;
      st.y -= mdy;
      st.py -= mdy;
      const k = Math.min(1, dt * 60);
      const vx = (st.x - st.px) * spec.damping, vy = (st.y - st.py) * spec.damping;
      st.px = st.x;
      st.py = st.y;
      st.x += vx + (gtx - st.x) * spec.stiffness * k;
      st.y += vy + (gty - st.y) * spec.stiffness * k + spec.gravity * dt * dt;
      const ddx = st.x - gjx, ddy = st.y - gjy;
      const dl = Math.hypot(ddx, ddy) || 1, gl = Math.hypot(gtx - gjx, gty - gjy);
      st.x = gjx + (ddx / dl) * gl;
      st.y = gjy + (ddy / dl) * gl;
      let d = Math.atan2(ddy, ddx) - Math.atan2(gty - gjy, gtx - gjx);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      wa[i] += Math.max(-1.3, Math.min(1.3, d));
    }
  }

  /** Forget spring momentum (after a teleport or a hot swap). */
  resetSprings(): void {
    for (const st of this.dyn) if (st) st.init = false;
  }

  /** Mirror spring state when the character turns around (anchor-relative x flips). */
  mirrorSprings(): void {
    for (const st of this.dyn) if (st) {
      st.x = 2 * this.anchorX - st.x;
      st.px = 2 * this.anchorX - st.px;
    }
  }

  /**
   * Solves a pose into skin matrices. `mdx/mdy` = how far the character moved in the world since the
   * last frame, in art px (already un-flipped), so springs trail real motion. `springs: false` for
   * still images.
   */
  solve(pose: Pose, dt: number, mdx = 0, mdy = 0, springs = true): void {
    this.fk(pose, 0, dt, 0, 0, false);
    let lock = 0;
    if (pose.ground > 0 && this.feet.length) {
      let lowest = -Infinity;
      for (const f of this.feet) {
        const L = this.len[f] * this.wsx[f];
        lowest = Math.max(lowest, this.wy[f] + Math.sin(this.wa[f]) * L, this.wy[f]);
      }
      lock = (this.restFootY - lowest) * pose.ground;
    }
    // G = T(pivot + g) R(grot) S(gsx, gsy) T(-pivot)
    const px = this.anchorX, py = this.anchorY + pose.pivotY;
    const c = Math.cos(pose.grot), s = Math.sin(pose.grot);
    const G = this.G;
    G[0] = c * pose.gsx;
    G[1] = s * pose.gsx;
    G[2] = -s * pose.gsy;
    G[3] = c * pose.gsy;
    G[4] = px + pose.gx - (G[0] * px + G[2] * py);
    G[5] = py + pose.gy - (G[1] * px + G[3] * py);
    this.fk(pose, lock, dt, mdx, mdy, springs);
    const K = this.K;
    for (let i = 0; i < this.n; i++) {
      // M = T(w) R(wa) S(wsx, wsy);  R0^-1 = R(-a0) T(-rest)
      const ca = Math.cos(this.wa[i]), sa = Math.sin(this.wa[i]);
      const m0 = ca * this.wsx[i], m1 = sa * this.wsx[i], m2 = -sa * this.wsy[i], m3 = ca * this.wsy[i];
      const c0 = Math.cos(-this.restA[i]), s0 = Math.sin(-this.restA[i]);
      const r4 = -(c0 * this.restX[i] - s0 * this.restY[i]), r5 = -(s0 * this.restX[i] + c0 * this.restY[i]);
      const a0 = m0 * c0 + m2 * s0, a1 = m1 * c0 + m3 * s0, a2 = m0 * -s0 + m2 * c0, a3 = m1 * -s0 + m3 * c0;
      const a4 = m0 * r4 + m2 * r5 + this.wx[i], a5 = m1 * r4 + m3 * r5 + this.wy[i];
      const o = i * 6;
      K[o] = G[0] * a0 + G[2] * a1;
      K[o + 1] = G[1] * a0 + G[3] * a1;
      K[o + 2] = G[0] * a2 + G[2] * a3;
      K[o + 3] = G[1] * a2 + G[3] * a3;
      K[o + 4] = G[0] * a4 + G[2] * a5 + G[4];
      K[o + 5] = G[1] * a4 + G[3] * a5 + G[5];
    }
  }

  /** Joint and tip of bone i after `solve`, anchor-relative, including the whole-body transform. */
  bonePoints(i: number): [number, number, number, number] {
    const K = this.K, o = i * 6;
    const b = this.rig.bones[i];
    return [
      K[o] * b.x + K[o + 2] * b.y + K[o + 4] - this.anchorX,
      K[o + 1] * b.x + K[o + 3] * b.y + K[o + 5] - this.anchorY,
      K[o] * b.x2 + K[o + 2] * b.y2 + K[o + 4] - this.anchorX,
      K[o + 1] * b.x2 + K[o + 3] * b.y2 + K[o + 5] - this.anchorY,
    ];
  }
}

/** Linear blend skinning of the rest mesh into `out` (anchor-relative art px). */
export function skinVertices(sk: Skeleton, bound: Pick<BoundRig, 'rest' | 'boneIdx' | 'boneW'>, out: Float32Array): void {
  const { rest, boneIdx, boneW } = bound;
  const K = sk.K;
  const ax = sk.anchorX, ay = sk.anchorY;
  const nv = rest.length >> 1;
  for (let v = 0; v < nv; v++) {
    const x = rest[2 * v], y = rest[2 * v + 1];
    let ox = 0, oy = 0;
    const o4 = v * 4;
    for (let k = 0; k < 4; k++) {
      const wgt = boneW[o4 + k];
      if (wgt === 0) break;
      const m = boneIdx[o4 + k] * 6;
      ox += wgt * (K[m] * x + K[m + 2] * y + K[m + 4]);
      oy += wgt * (K[m + 1] * x + K[m + 3] * y + K[m + 5]);
    }
    out[2 * v] = ox - ax;
    out[2 * v + 1] = oy - ay;
  }
}
