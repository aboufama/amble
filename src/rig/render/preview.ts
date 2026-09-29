/**
 * `createRigPreview`: a rigged drawing alive on a Canvas 2D element, without Phaser: the First page's
 * doodle, the Desk's preview, the Bones view's "Watch {name} move", thumbnails. It walks to where it
 * is sent, hops, answers the arrow keys, and freezes on a frame for a thumbnail.
 */
import type { BindOptions } from '../bind';
import { RigPuppet, type BodyLike } from '../runtime/puppet';
import type { AnimTweak, BoundRig, RigData } from '../types';
import type { RigSource } from '../worker/protocol';
import { getRigWorker, type RigWorkerApi } from '../worker/client';
import { bonePointsOf, drawBones, type BonesStyle } from './bones';
import { drawPuppet, type Ctx2D } from './canvas';

export interface RigPreviewOptions {
  /** The drawing's height on the canvas in canvas px (default 72% of the canvas height). */
  height?: number;
  /** The ground line as a fraction of the canvas height (default 0.9). */
  ground?: number;
  /** Where it stands at first, as a fraction of the canvas width (default 0.5). */
  start?: number;
  /** Canvas background (default: cleared to transparent). */
  background?: string | null;
  /** Draw the bones over the drawing. */
  bones?: boolean | BonesStyle;
  /** Tint each part ("Show pieces"). */
  pieces?: boolean;
  /** Start animating when loaded (default true; false under reduced motion until `resume`). */
  autoplay?: boolean;
  /** Walk to random spots by itself now and then (Trail walkers). */
  wander?: boolean;
  /** The rig worker to bind with (default: the shared one). */
  worker?: RigWorkerApi;
  bindOptions?: BindOptions;
  /** Called when the visible move changes ("Walking"). */
  onClip?: (clip: string) => void;
}

export interface RigPreview {
  /** Rigs are bound in the worker; resolves when the drawing is on the canvas. */
  load(image: RigSource['image'], rig: RigData, layers?: RigSource['layers']): Promise<void>;
  /** Shows an already bound rig. */
  show(bound: BoundRig): void;
  /** Plays a move (with a Bouncy/Speedy tweak for this preview). */
  play(clip: string, tweak?: AnimTweak): void;
  /** Hops to x (canvas px); with y above the ground, jumps that high on the way. */
  hop(x: number, y?: number): void;
  /** Walks to x (canvas px). */
  walkTo(x: number): void;
  /** Freezes on a move at time t (seconds): thumbnails and still frames. */
  pose(clip: string, t: number): void;
  /** Keyboard toy: hold left or right to walk, jump to hop. */
  input(keys: { left?: boolean; right?: boolean; jump?: boolean }): void;
  setOptions(o: Partial<RigPreviewOptions>): void;
  pause(): void;
  resume(): void;
  readonly clip: string;
  readonly puppet: RigPuppet | null;
  destroy(): void;
}

const GRAVITY = 5.5; // heights per second²

let previews = 0;

export function createRigPreview(canvas: HTMLCanvasElement | OffscreenCanvas, options: RigPreviewOptions = {}): RigPreview {
  let opts: RigPreviewOptions = { ...options };
  const seqId = ++previews;
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  let puppet: RigPuppet | null = null;
  let bound: BoundRig | null = null;
  let raf = 0;
  let last = 0;
  let running = false;
  let frozen = false;
  let destroyed = false;
  let loadSeq = 0;
  // position in canvas px (feet), velocity in canvas px/s
  let x = 0, y = 0, vx = 0, vy = 0;
  let target: number | null = null;
  let keys = { left: false, right: false, jump: false };
  let wanderAt = 0;
  let lastClip = '';
  const body: BodyLike & { blocked: { down: boolean } } = { velocity: { x: 0, y: 0 }, blocked: { down: true } };
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const groundY = () => canvas.height * (opts.ground ?? 0.9);
  const artH = () => {
    if (!bound) return 1;
    let top = Infinity;
    for (let i = 1; i < bound.rest.length; i += 2) top = Math.min(top, bound.rest[i]);
    return Math.max(1, bound.rig.anchor[1] - top);
  };
  const scale = () => (opts.height ?? canvas.height * 0.72) / artH();
  const heightPx = () => artH() * scale();

  const draw = () => {
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!puppet) return;
    const k = scale();
    drawPuppet(ctx, puppet, { x, y, scale: k, pieces: opts.pieces });
    if (opts.bones && bound) {
      const style = typeof opts.bones === 'object' ? opts.bones : { look: 'diagram' as const, joint: 5, width: 10 };
      drawBones(ctx, bound.rig, bonePointsOf(puppet.skeleton, puppet.flip), { ...style, x, y, scale: k });
    }
  };

  const step = (dt: number) => {
    if (!puppet) return;
    const H = heightPx();
    const walkV = 1.2 * H;
    let want = 0;
    if (keys.left !== keys.right) want = keys.left ? -1 : 1;
    else if (target !== null) {
      const d = target - x;
      if (Math.abs(d) < 2) target = null;
      else want = Math.sign(d) * Math.min(1, Math.abs(d) / (0.25 * H) + 0.3);
    } else if (opts.wander && performance.now() > wanderAt) {
      wanderAt = performance.now() + 2500 + Math.random() * 4000;
      const m = 0.12 * canvas.width;
      target = m + Math.random() * (canvas.width - 2 * m);
    }
    const ground = groundY();
    const onGround = y >= ground - 0.5 && vy >= 0;
    if (onGround) vx = want * walkV;
    if (keys.jump && onGround) {
      vy = -Math.sqrt(2 * GRAVITY * H * 0.55 * H);
      keys.jump = false;
    }
    if (!onGround || vy < 0) vy += GRAVITY * H * dt;
    const px = x, py = y;
    x = Math.max(0, Math.min(canvas.width, x + vx * dt));
    y = Math.min(ground, y + vy * dt);
    if (y >= ground) {
      y = ground;
      if (vy > 0) vy = 0;
    }
    body.velocity.x = (x - px) / Math.max(dt, 1e-3);
    body.velocity.y = vy;
    body.blocked.down = y >= ground - 0.5 && vy >= 0;
    puppet.update(dt, { dx: x - px, dy: y - py, scale: scale() });
    const c = puppet.clip;
    if (c !== lastClip) {
      lastClip = c;
      opts.onClip?.(c);
    }
  };

  const loop = (t: number) => {
    if (!running || destroyed) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
    last = t;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  };

  const start = () => {
    if (running || destroyed || frozen || !puppet) return;
    running = true;
    last = 0;
    if (typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
    raf = 0;
  };

  const api: RigPreview = {
    async load(image, rig, layers) {
      const seq = ++loadSeq;
      const worker = opts.worker ?? getRigWorker();
      const b = await worker.bind({ image, layers }, rig, { ...opts.bindOptions, lane: `preview-${seqId}` });
      if (seq !== loadSeq || destroyed) return;
      api.show(b);
    },
    show(b) {
      const first = !bound;
      bound = b;
      const prev = puppet;
      puppet = new RigPuppet(b);
      puppet.follow(body);
      if (prev) {
        // a rebind (a joint moved): keep facing and the current move
        puppet.face(prev.facing);
        if (prev.clip !== 'idle') puppet.play(prev.clip);
      }
      if (first) {
        x = canvas.width * (opts.start ?? 0.5);
        y = groundY();
      }
      frozen = false;
      draw();
      if (opts.autoplay !== false && !reduced) start();
    },
    play(clip, tweak) {
      if (!puppet) return;
      frozen = false;
      if (tweak) puppet.animator.setTweaks({ ...(puppet.rig.anims ?? {}), [clip]: tweak });
      // a picked move plays on its own (walking in place; a one-shot returns to the last loop) until
      // the preview is sent somewhere
      puppet.follow(null);
      puppet.play(clip, { fade: 0.15 });
      start();
    },
    hop(tx, ty) {
      if (!puppet) return;
      puppet.follow(body);
      const H = heightPx();
      const ground = groundY();
      const peak = ty !== undefined && ty < ground ? Math.max(0.2 * H, ground - ty) : 0.45 * H;
      if (y >= ground - 0.5) {
        vy = -Math.sqrt(2 * GRAVITY * H * peak);
        const flight = (2 * -vy) / (GRAVITY * H);
        vx = (tx - x) / Math.max(0.2, flight);
        target = null;
        y = ground - 0.6;
      }
      start();
    },
    walkTo(tx) {
      if (!puppet) return;
      puppet.follow(body);
      target = Math.max(0, Math.min(canvas.width, tx));
      start();
    },
    pose(clip, t) {
      if (!puppet) return;
      stop();
      frozen = true;
      puppet.follow(null);
      puppet.play(clip, { fade: 0 });
      puppet.animator.seek(t);
      puppet.update(0);
      draw();
    },
    input(k) {
      keys = { left: !!k.left, right: !!k.right, jump: !!k.jump || keys.jump };
      if (puppet) puppet.follow(body);
      start();
    },
    setOptions(o) {
      opts = { ...opts, ...o };
      if (!running) draw();
    },
    pause: stop,
    resume() {
      frozen = false;
      start();
    },
    get clip() {
      return puppet?.clip ?? '';
    },
    get puppet() {
      return puppet;
    },
    destroy() {
      destroyed = true;
      stop();
      puppet = null;
      bound = null;
    },
  };
  return api;
}
