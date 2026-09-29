/**
 * Juice: shake, hit-stop, slow-mo, flashes (through the photosensitivity limiter), camera punch, chromatic
 * aberration, particle bursts, explosions, shockwaves, trails, afterimages. Every effect respects reduced
 * motion and the quality level, so chaos stays readable and Chromebooks stay fast.
 */
import Phaser from 'phaser';
import { safeFlashAlpha } from '../shell/flash';
import { colorInt, shade } from './color';
import { env } from './env';
import { quality, type Kit } from './state';
import type { Point } from './types';
import { util } from './util';

const CHROMA_FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uAmount;
varying vec2 outTexCoord;
void main () {
  vec2 d = outTexCoord - vec2(0.5);
  vec2 o = d * uAmount;
  vec4 c = texture2D(uMainSampler, outTexCoord);
  float r = texture2D(uMainSampler, outTexCoord + o).r;
  float b = texture2D(uMainSampler, outTexCoord - o).b;
  gl_FragColor = vec4(r, c.g, b, c.a);
}`;

export const CHROMA_KEY = 'AmbleChroma';

/** The chromatic aberration post pass (one full-screen pass while it is active). */
export class ChromaPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  amount = 0;

  constructor(game: Phaser.Game) {
    super({ game, name: CHROMA_KEY, fragShader: CHROMA_FRAG });
  }

  onPreRender(): void {
    this.set1f('uAmount', this.amount);
  }
}

export interface BurstOptions {
  color?: unknown;
  colors?: unknown[];
  count?: number;
  speed?: number | [number, number];
  angle?: number | [number, number];
  life?: number;
  size?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  alpha?: number;
  frames?: string[];
  frame?: string;
  blend?: 'add' | 'normal';
  shrink?: boolean;
  fade?: boolean;
}

export interface ExplodeOptions {
  size?: number;
  color?: unknown;
  push?: boolean;
  power?: number;
  radius?: number;
  damage?: number;
  source?: object;
  hitstop?: boolean;
}

export interface TrailOptions {
  frame?: string;
  every?: number;
  life?: number;
  size?: number;
  alpha?: number;
  color?: unknown;
  speed?: number;
}

/** What the next burst looks like; the shared emitters read it when particles are emitted. */
interface BurstLook {
  speedMin: number;
  speedMax: number;
  angleMin: number;
  angleMax: number;
  life: number;
  size: number;
  gravity: number;
  colors: number[];
  drag: number;
  spin: number;
  shrink: boolean;
  fade: boolean;
  alpha: number;
  align: boolean;
}

interface KitParticle extends Phaser.GameObjects.Particles.Particle {
  _a?: number;
  _spin?: number;
  _drag?: number;
  _shrink?: boolean;
  _fade?: boolean;
  _s?: number;
  _alpha?: number;
}

/** Per-particle drag: sparks fly out fast, then slow down. */
class DragProcessor extends Phaser.GameObjects.Particles.ParticleProcessor {
  update(particle: Phaser.GameObjects.Particles.Particle, delta: number): void {
    const p = particle as KitParticle;
    if (p._drag && p._drag < 1) {
      const f = Math.pow(p._drag, delta / 16.67);
      p.velocityX *= f;
      p.velocityY *= f;
    }
  }
}

type Shakeable = Phaser.Cameras.Scene2D.Effects.Shake & { intensity: Phaser.Math.Vector2 };

export class Fx {
  private readonly look: BurstLook = {
    speedMin: 60, speedMax: 220, angleMin: 0, angleMax: 360, life: 520, size: 0.6, gravity: 0, colors: [0xffffff], drag: 0.94, spin: 0, shrink: true, fade: true, alpha: 1, align: false,
  };
  private readonly emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private chromaAmt = 0;
  private chromaDecay = 0;
  private chromaPipe: ChromaPipeline | null = null;
  private desat: Phaser.FX.ColorMatrix | null = null;
  private desatT = 0;
  private vignetteFx: Phaser.FX.Vignette | null = null;
  private bloomFx: Phaser.FX.Bloom | null = null;

  constructor(private readonly k: Kit) {}

  private get s(): Phaser.Scene {
    return this.k.scene;
  }

  /** 1, or 0.25 when the player prefers reduced motion. */
  get motion(): number {
    return env().prefs.reducedMotion ? 0.25 : 1;
  }

  private emitter(blend: 'add' | 'normal'): Phaser.GameObjects.Particles.ParticleEmitter {
    const known = this.emitters.get(blend);
    if (known) return known;
    const L = this.look;
    const e = this.s.add.particles(0, 0, 'amble-fx', {
      frame: ['dot'],
      emitting: false,
      blendMode: blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL,
      lifespan: { onEmit: () => L.life * util.rand(0.55, 1.1) },
      speed: { onEmit: () => util.rand(L.speedMin, L.speedMax) },
      rotate: {
        onEmit: (particle?: Phaser.GameObjects.Particles.Particle) => {
          const p = particle as KitParticle;
          p._a = util.rand(L.angleMin, L.angleMax);
          p._spin = L.spin ? util.rand(-L.spin, L.spin) : 0;
          p._drag = L.drag;
          p._shrink = L.shrink;
          p._fade = L.fade;
          p._alpha = L.alpha;
          return L.align ? p._a : util.rand(0, 360);
        },
        onUpdate: (particle: Phaser.GameObjects.Particles.Particle, _key: string, _t: number, value: number) => value + ((particle as KitParticle)._spin ?? 0),
      },
      angle: { onEmit: (particle?: Phaser.GameObjects.Particles.Particle) => (particle as KitParticle)._a ?? 0 },
      scale: {
        onEmit: (particle?: Phaser.GameObjects.Particles.Particle) => {
          const p = particle as KitParticle;
          p._s = L.size * util.rand(0.55, 1.15);
          return p._s;
        },
        onUpdate: (particle: Phaser.GameObjects.Particles.Particle, _key: string, t: number) => {
          const p = particle as KitParticle;
          return p._shrink ? (p._s ?? 1) * (1 - t * 0.9) : (p._s ?? 1) * (1 + t * 0.8);
        },
      },
      alpha: {
        onEmit: () => L.alpha,
        onUpdate: (particle: Phaser.GameObjects.Particles.Particle, _key: string, t: number) => {
          const p = particle as KitParticle;
          return p._fade ? (1 - t * t) * (p._alpha ?? 1) : (p._alpha ?? 1);
        },
      },
      tint: { onEmit: () => util.pick(L.colors) },
      accelerationY: { onEmit: () => L.gravity },
      maxAliveParticles: 1600,
    });
    e.addParticleProcessor(new DragProcessor());
    e.setDepth(blend === 'add' ? 850 : 840);
    this.emitters.set(blend, e);
    return e;
  }

  /** A burst of particles (sparks, smoke, debris, confetti...). */
  burst(x: number, y: number, o: BurstOptions = {}): Phaser.GameObjects.Particles.ParticleEmitter {
    const q = quality.level === 2 ? 1 : quality.level === 1 ? 0.6 : 0.3;
    const count = Math.max(1, Math.round((o.count ?? 14) * q * (env().prefs.reducedMotion ? 0.5 : 1)));
    const L = this.look;
    const sp = Array.isArray(o.speed) ? o.speed : [(o.speed ?? 220) * 0.4, o.speed ?? 220];
    const ang = Array.isArray(o.angle) ? o.angle : o.angle !== undefined ? [o.angle - 20, o.angle + 20] : [0, 360];
    L.speedMin = sp[0];
    L.speedMax = sp[1];
    L.angleMin = ang[0];
    L.angleMax = ang[1];
    L.life = o.life ?? 520;
    L.size = o.size ?? 0.6;
    L.gravity = o.gravity ?? 0;
    L.colors = (o.colors ?? [o.color ?? 0xffffff]).map((v) => colorInt(v));
    L.drag = o.drag ?? 0.94;
    L.spin = o.spin ?? 0;
    L.shrink = o.shrink !== false;
    L.fade = o.fade !== false;
    L.alpha = o.alpha ?? 1;
    const frames = o.frames ?? (o.frame ? [o.frame] : ['dot']);
    L.align = frames.length === 1 && frames[0] === 'spark';
    const normal = frames.some((f) => f === 'smoke' || f === 'square' || f === 'shard');
    const e = this.emitter(o.blend ?? (normal ? 'normal' : 'add'));
    e.setEmitterFrame(frames);
    e.explode(count, x, y);
    return e;
  }

  /** Screen shake. Repeated small shakes never cut a big one short; big ones add a camera kick. */
  shake(intensity = 0.01, ms = 180): void {
    const cam = this.s.cameras.main;
    const i = intensity * this.motion;
    const se = cam.shakeEffect as Shakeable;
    const remaining = se.isRunning ? se.intensity.x * (1 - se.progress) : 0;
    if (i >= remaining) cam.shake(ms, i, true);
    if (intensity >= 0.014 && !env().prefs.reducedMotion) {
      cam.setRotation(util.pick([-1, 1]) * Math.min(0.03, intensity * 1.2));
      this.s.tweens.add({ targets: cam, rotation: 0, duration: ms * 1.4, ease: 'Sine.easeOut' });
    }
  }

  /** Freezes the world for `ms` of real time (the impact pause). */
  hitstop(ms = 60): void {
    this.k.hitstopUntil = Math.max(this.k.hitstopUntil, this.k.now() + ms);
  }

  /** Slows the game to `scale` for `ms` of real time, then eases back. */
  slowmo(scale = 0.3, ms = 900): void {
    this.k.slowTarget = util.clamp(scale, 0.05, 1);
    this.k.slowUntil = this.k.now() + ms;
  }

  /** A soft full-screen flash: at most 3 per second (photosensitivity), softer with reduced motion. */
  flash(color: unknown = 0xffffff, ms = 140, alpha = 0.55): void {
    const e = env();
    if (!e.flash.allow(e.now())) return;
    const c = colorInt(color);
    const a = safeFlashAlpha(alpha, c, { maxPerSecond: 3, maxAlpha: e.flash.maxAlpha });
    this.k.ui.flashOverlay(c, a, ms);
  }

  /** Camera zoom punch. */
  punch(amount = 0.05, ms = 160): void {
    const cam = this.s.cameras.main;
    const base = this.k.baseZoom;
    this.s.tweens.killTweensOf(cam);
    cam.zoom = base * (1 + amount * this.motion);
    this.s.tweens.add({ targets: cam, zoom: base, duration: ms, ease: 'Cubic.easeOut' });
  }

  /** Chromatic aberration pulse (WebGL only; off with reduced motion or low quality). */
  chroma(amount = 0.012, ms = 300): void {
    if (!this.k.webgl || env().prefs.reducedMotion || quality.level < 1) return;
    this.chromaAmt = Math.max(this.chromaAmt, amount);
    this.chromaDecay = amount / Math.max(1, ms);
  }

  /** Grey-out of the world (for slow time looks), fading back over `ms`. */
  desaturate(amount = 0.8, ms = 600): void {
    if (!this.k.webgl || quality.level < 1) return;
    const cam = this.s.cameras.main;
    if (!this.desat) this.desat = cam.postFX.addColorMatrix();
    this.desat.grayscale(util.clamp(amount, 0, 1));
    this.desatT = ms;
  }

  /** A soft dark edge around the screen (quality 2 only). */
  vignette(strength = 0.35): void {
    if (!this.k.webgl || quality.level < 2) return;
    const cam = this.s.cameras.main;
    if (strength <= 0) {
      if (this.vignetteFx) cam.postFX.remove(this.vignetteFx);
      this.vignetteFx = null;
      return;
    }
    if (!this.vignetteFx) this.vignetteFx = cam.postFX.addVignette(0.5, 0.5, 0.9, util.clamp(strength, 0, 1));
    else this.vignetteFx.strength = util.clamp(strength, 0, 1);
  }

  /** Glow on bright things (quality 2 only: bloom is the most expensive effect on weak GPUs). */
  bloom(on = true): void {
    if (!this.k.webgl || quality.level < 2 || env().mode === 'robot') return;
    const cam = this.s.cameras.main;
    if (on && !this.bloomFx) this.bloomFx = cam.postFX.addBloom(0xffffff, 1, 1, 1, 1.2);
    else if (!on && this.bloomFx) {
      cam.postFX.remove(this.bloomFx);
      this.bloomFx = null;
    }
  }

  /** Real-time decay of the chroma and desaturate passes. */
  tick(realDelta: number): void {
    const cam = this.s.cameras.main;
    if (this.desat && this.desatT > 0) {
      this.desatT -= realDelta;
      if (this.desatT <= 0) {
        cam.postFX.remove(this.desat as unknown as Phaser.FX.Controller);
        this.desat = null;
      }
    }
    if (!this.k.webgl || this.chromaAmt <= 0) return;
    // Set by the registered string key: passing the class would name the instance after the JS class,
    // a lookup by name would never find it, and a new full-screen pass would pile up every frame.
    if (!this.chromaPipe) {
      cam.setPostPipeline(CHROMA_KEY);
      const p = cam.getPostPipeline(CHROMA_KEY);
      const pipe = Array.isArray(p) ? p[0] : p;
      this.chromaPipe = pipe instanceof ChromaPipeline ? pipe : null;
    }
    if (this.chromaPipe) this.chromaPipe.amount = this.chromaAmt;
    this.chromaAmt = Math.max(0, this.chromaAmt - this.chromaDecay * realDelta);
    if (this.chromaAmt === 0) {
      cam.removePostPipeline(CHROMA_KEY);
      this.chromaPipe = null;
    }
  }

  /** An expanding ring. */
  shockwave(x: number, y: number, o: { radius?: number; color?: unknown; alpha?: number; ms?: number } = {}): Phaser.GameObjects.Image {
    const r = this.s.add
      .image(x, y, 'amble-fx', 'ring')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(860)
      .setTint(colorInt(o.color ?? 0xffffff))
      .setScale(0.15)
      .setAlpha(o.alpha ?? 0.9);
    const radius = o.radius ?? 110;
    this.s.tweens.add({ targets: r, scale: radius / 30, alpha: 0, duration: o.ms ?? 380, ease: 'Cubic.easeOut', onComplete: () => r.destroy() });
    return r;
  }

  /** One call, a big explosion: sparks, smoke, debris, ring, shake, flash, hit-stop and a sound. */
  explode(x: number, y: number, o: ExplodeOptions = {}): void {
    const size = o.size ?? 1;
    const color = colorInt(o.color ?? 0xff8c42);
    this.burst(x, y, { frames: ['dot'], colors: [0xffffff, 0xfff3b0, 0xffd23f, color], count: 18 * size, speed: [60 * size, 320 * size], life: 420, size: 0.9 * size + 0.3, drag: 0.9, blend: 'add' });
    this.burst(x, y, { frames: ['spark'], colors: [0xffffff, 0xffe066, color], count: 16 * size, speed: [260 * size, 700 * size], life: 380, size: 0.8 + 0.4 * size, drag: 0.9, blend: 'add' });
    this.burst(x, y, { frames: ['smoke'], colors: [0x5c5470, 0x3d3552, 0x8a7f9c], count: 8 * size, speed: [20, 150 * size], life: 1000, size: 0.9 * size + 0.4, gravity: -50, drag: 0.93, shrink: false, alpha: 0.75 });
    this.burst(x, y, { frames: ['shard', 'square'], colors: [color, shade(color, -0.4), 0x1d1233], count: 10 * size, speed: [150, 480 * size], life: 900, size: 0.7, gravity: 900, drag: 0.98, spin: 12 });
    this.shockwave(x, y, { radius: 90 * size + 30, color: 0xfff3b0 });
    const glow = this.s.add.image(x, y, 'amble-fx', 'dot').setBlendMode(Phaser.BlendModes.ADD).setDepth(855).setTint(0xffe8a0).setScale(3 * size);
    this.s.tweens.add({ targets: glow, alpha: 0, scale: 6 * size, duration: 240, onComplete: () => glow.destroy() });
    this.shake(0.006 + 0.01 * size, 180 + 120 * size);
    if (size >= 1.2) {
      this.flash(0xfff3c4, 110, 0.3);
      this.chroma(0.01 * size, 320);
    }
    if (o.hitstop !== false) this.hitstop(Math.min(120, 25 + 35 * size));
    this.k.scene.sfx(size >= 1.6 ? 'boom' : 'explosion', { pitch: util.clamp(1.25 - size * 0.2, 0.6, 1.4) });
    if (o.push !== false && (o.push || o.power)) this.k.scene.blast(x, y, { radius: o.radius ?? 170 * size, power: o.power ?? size });
    const dmg = o.damage;
    if (dmg) {
      const R = o.radius ?? 120 * size;
      this.k.forEachLiving((a) => {
        if (a !== o.source && util.dist(a, { x, y }) < R) a.damage(dmg, { from: { x, y } });
      });
    }
  }

  /** A dust puff at something's feet. */
  dust(obj: Point & { displayHeight?: number; height?: number }, o: { count?: number } = {}): void {
    const h = (obj.displayHeight ?? obj.height ?? 40) / 2;
    const gs = this.k.gravitySign;
    this.burst(obj.x, obj.y + h * gs, {
      frames: ['smoke'], colors: [0xe8e0d0, 0xc8bca8], count: o.count ?? 7, speed: [30, 110], angle: gs > 0 ? [180, 360] : [0, 180],
      life: 420, size: 0.45, drag: 0.9, shrink: false, alpha: 0.8,
    });
  }

  /** Squash and stretch. Characters deform their picture, never their hitbox. */
  squash(obj: Phaser.GameObjects.GameObject, sx = 1.25, sy = 0.8, ms = 140): void {
    const target = obj as Phaser.GameObjects.GameObject & { squashScale?: { x: number; y: number }; scaleX?: number; scaleY?: number; setScale?(x: number, y?: number): unknown; __base?: [number, number] };
    const sq = target.squashScale;
    if (sq) {
      this.s.tweens.killTweensOf(sq);
      sq.x = 1 + (sx - 1) * this.motion;
      sq.y = 1 + (sy - 1) * this.motion;
      this.s.tweens.add({ targets: sq, x: 1, y: 1, duration: ms * 2, ease: 'Back.easeOut' });
      return;
    }
    if (!target.setScale || target.scaleX === undefined || target.scaleY === undefined) return;
    target.__base ??= [target.scaleX, target.scaleY];
    const [bx, by] = target.__base;
    this.s.tweens.killTweensOf(target);
    target.setScale(bx * (1 + (sx - 1) * this.motion), by * (1 + (sy - 1) * this.motion));
    this.s.tweens.add({ targets: target, scaleX: bx, scaleY: by, duration: ms * 2, ease: 'Back.easeOut' });
  }

  /** A particle trail that follows something and cleans up after it. */
  trail(obj: Phaser.GameObjects.GameObject & Point, o: TrailOptions = {}): Phaser.GameObjects.Particles.ParticleEmitter {
    const e = this.s.add.particles(0, 0, 'amble-fx', {
      frame: o.frame ?? 'dot', follow: obj, frequency: o.every ?? 22, quantity: 1,
      lifespan: o.life ?? 320, scale: { start: o.size ?? 0.55, end: 0 }, alpha: { start: o.alpha ?? 0.7, end: 0 },
      tint: colorInt(o.color ?? 0x9ff3ff), blendMode: Phaser.BlendModes.ADD, speed: o.speed ?? 12,
    });
    e.setDepth(((obj as { depth?: number }).depth ?? 0) - 1);
    obj.once(Phaser.GameObjects.Events.DESTROY, () => {
      e.stop();
      this.s.time.delayedCall(600, () => e.destroy());
    });
    return e;
  }

  /** An afterimage (characters copy their whole pose). */
  ghost(obj: Phaser.GameObjects.GameObject, color: unknown = 0x80ffff): void {
    const c = obj as Phaser.GameObjects.GameObject & { afterimage?(color: number, alpha?: number, ms?: number): void };
    if (c.afterimage) {
      c.afterimage(colorInt(color));
      return;
    }
    if (!(obj instanceof Phaser.GameObjects.Image || obj instanceof Phaser.GameObjects.Sprite)) return;
    const g = this.s.add
      .image(obj.x, obj.y, obj.texture.key, obj.frame.name)
      .setOrigin(obj.originX, obj.originY)
      .setRotation(obj.rotation)
      .setScale(obj.scaleX, obj.scaleY)
      .setFlipX(obj.flipX)
      .setTintFill(colorInt(color))
      .setAlpha(0.55)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(obj.depth - 1);
    this.s.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /** The white hurt flash. */
  hurtFlash(obj: Phaser.GameObjects.GameObject, ms = 70): void {
    const t = obj as Phaser.GameObjects.GameObject & { setTintFill?(c: number): unknown; clearTint?(): unknown };
    if (!t.setTintFill) return;
    t.setTintFill(0xffffff);
    this.s.time.delayedCall(ms, () => {
      if (t.active) t.clearTint?.();
    });
  }

  /** A cheap glow: a soft additive dot behind something. */
  halo(obj: Phaser.GameObjects.GameObject & Point & { visible: boolean; displayWidth?: number; depth?: number }, color: unknown = 0xffffff, size = 2.2): Phaser.GameObjects.Image {
    const h = this.s.add
      .image(obj.x, obj.y, 'amble-fx', 'dot')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(colorInt(color))
      .setScale(((obj.displayWidth ?? 32) / 32) * size)
      .setAlpha(0.55)
      .setDepth((obj.depth ?? 0) - 1);
    this.k.followers.push({ obj: obj as unknown as Phaser.GameObjects.Components.Transform & { active: boolean; visible: boolean }, h });
    return h;
  }

  /** A jagged lightning bolt between two points. */
  lightning(x1: number, y1: number, x2: number, y2: number, o: { color?: unknown; width?: number; segments?: number; jag?: number; ms?: number } = {}): Phaser.GameObjects.Graphics {
    const g = this.s.add.graphics().setDepth(870).setBlendMode(Phaser.BlendModes.ADD);
    const segs = o.segments ?? 12;
    const col = colorInt(o.color ?? 0xbde0ff);
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const j = i === 0 || i === segs ? 0 : (o.jag ?? 28);
      pts.push(new Phaser.Math.Vector2(util.lerp(x1, x2, t) + util.rand(-j, j), util.lerp(y1, y2, t) + util.rand(-j, j)));
    }
    g.lineStyle(o.width ?? 6, col, 0.35).strokePoints(pts);
    g.lineStyle((o.width ?? 6) / 2.5, 0xffffff, 1).strokePoints(pts);
    this.s.tweens.add({ targets: g, alpha: 0, duration: o.ms ?? 220, onComplete: () => g.destroy() });
    return g;
  }

  /** Confetti for wins. */
  confetti(count = 80): void {
    const cam = this.s.cameras.main;
    for (let i = 0; i < 4; i++) {
      this.burst(cam.worldView.x + cam.width * (0.15 + i * 0.23), cam.worldView.y - 10, {
        frames: ['square', 'shard'], colors: [0xff4d6d, 0xffd23f, 0x4cc9f0, 0x7ddf8c, 0xc77dff], count: count / 4,
        speed: [80, 380], angle: [40, 140], life: 2600, size: 0.8, gravity: 260, drag: 0.985, spin: 14, blend: 'normal', fade: false, shrink: false,
      });
    }
  }
}
