import { Color3, Color4, DynamicTexture, ParticleSystem, Vector3, type Scene } from './babylon';
import type { WorldMode } from '../player/protocol';

export interface BurstOptions {
  x?: number;
  y?: number;
  z?: number;
  /** Color name or "#rrggbb" (default "#ffcc33"). */
  color?: string;
  count?: number;
  /** Speed of the particles (2D: pixels/s, 3D: meters/s). */
  speed?: number;
  /** Particle size (2D: pixels, 3D: meters). */
  size?: number;
  /** Seconds each particle lives. */
  lifetime?: number;
  /** Pull particles down (true) or float (false). Default true. */
  gravity?: boolean;
}

function toColor(color: string | undefined): Color3 {
  if (!color) return Color3.FromHexString('#ffcc33');
  try {
    if (color.startsWith('#')) return Color3.FromHexString(color.length === 4 ? `#${[...color.slice(1)].map((c) => c + c).join('')}` : color);
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = color;
      return Color3.FromHexString(ctx.fillStyle as string);
    }
  } catch {
    /* fall through */
  }
  return Color3.FromHexString('#ffcc33');
}

export function parseColor(color: string | undefined | null, fallback = '#ffffff'): Color3 {
  return toColor(color ?? fallback);
}

/** Juice: particle bursts. */
export class Effects {
  private dot: DynamicTexture | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly mode: WorldMode,
  ) {}

  private dotTexture(): DynamicTexture {
    if (!this.dot) {
      const tex = new DynamicTexture('amble:dot', { width: 64, height: 64 }, this.scene, false);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      tex.update();
      tex.hasAlpha = true;
      this.dot = tex;
    }
    return this.dot;
  }

  /** A one-shot explosion of particles. */
  burst(opts: BurstOptions = {}): void {
    const is2d = this.mode === '2d';
    const count = Math.max(1, Math.min(500, Math.round(opts.count ?? 24)));
    const speed = opts.speed ?? (is2d ? 180 : 3);
    const size = opts.size ?? (is2d ? 10 : 0.18);
    const life = opts.lifetime ?? 0.6;
    const color = toColor(opts.color);
    const ps = new ParticleSystem('burst', count, this.scene);
    ps.particleTexture = this.dotTexture();
    ps.emitter = new Vector3(opts.x ?? 0, opts.y ?? 0, is2d ? -1 : opts.z ?? 0);
    ps.minEmitBox = Vector3.Zero();
    ps.maxEmitBox = Vector3.Zero();
    ps.color1 = new Color4(color.r, color.g, color.b, 1);
    ps.color2 = new Color4(Math.min(1, color.r + 0.25), Math.min(1, color.g + 0.25), Math.min(1, color.b + 0.25), 1);
    ps.colorDead = new Color4(color.r, color.g, color.b, 0);
    ps.minSize = size * 0.5;
    ps.maxSize = size;
    ps.minLifeTime = life * 0.6;
    ps.maxLifeTime = life;
    ps.minEmitPower = speed * 0.4;
    ps.maxEmitPower = speed;
    ps.updateSpeed = 1 / 60;
    if (is2d) {
      ps.direction1 = new Vector3(-1, -1, 0);
      ps.direction2 = new Vector3(1, 1, 0);
    } else {
      ps.direction1 = new Vector3(-1, -1, -1);
      ps.direction2 = new Vector3(1, 1, 1);
    }
    if (opts.gravity !== false) ps.gravity = new Vector3(0, is2d ? -400 : -6, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.manualEmitCount = count;
    ps.targetStopDuration = life + 0.1;
    ps.disposeOnStop = true;
    ps.renderingGroupId = is2d ? 1 : 0;
    ps.start();
  }

  dispose(): void {
    this.dot?.dispose();
  }
}
