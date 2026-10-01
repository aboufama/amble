import type * as Phaser from 'phaser';
import { parseColor } from './visuals';
import { toWorld } from './physics';

export interface BurstOptions {
  x?: number;
  y?: number;
  /** Color name or "#rrggbb" (default "#ffcc33"). */
  color?: string;
  count?: number;
  /** Speed of the particles (pixels per second). */
  speed?: number;
  /** Particle size (pixels). */
  size?: number;
  /** Seconds each particle lives. */
  lifetime?: number;
  /** Pull particles down (true) or float (false). Default true. */
  gravity?: boolean;
}

/** A soft round dot, shared by every burst of the session. */
export const DOT_TEXTURE = 'amble-dot';

export function ensureDot(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists(DOT_TEXTURE)) return;
  const canvas = textures.createCanvas(DOT_TEXTURE, 64, 64);
  const ctx = canvas?.getContext();
  if (!canvas || !ctx) return;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  canvas.refresh();
}

/** Lightens a 0xrrggbb color a little. */
function lighter(color: number): number {
  const r = Math.min(255, ((color >> 16) & 255) + 64);
  const g = Math.min(255, ((color >> 8) & 255) + 64);
  const b = Math.min(255, (color & 255) + 64);
  return (r << 16) | (g << 8) | b;
}

/** Juice: particle bursts, drawn above the sprites. */
export class Effects {
  constructor(private readonly scene: Phaser.Scene) {}

  /** A one-shot explosion of particles at (x, y), in stage coordinates. */
  burst(opts: BurstOptions = {}): void {
    ensureDot(this.scene.textures);
    const count = Math.max(1, Math.min(500, Math.round(opts.count ?? 24)));
    const speed = opts.speed ?? 180;
    const size = opts.size ?? 10;
    const life = Math.max(0.05, opts.lifetime ?? 0.6);
    const color = parseColor(opts.color, 0xffcc33);
    const at = toWorld(opts.x ?? 0, opts.y ?? 0);
    const emitter = this.scene.add.particles(at.x, at.y, DOT_TEXTURE, {
      speed: { min: speed * 0.4, max: speed },
      angle: { min: 0, max: 360 },
      lifespan: { min: life * 600, max: life * 1000 },
      scale: { start: size / 64, end: (size / 64) * 0.5 },
      alpha: { start: 1, end: 0 },
      tint: [color, lighter(color)],
      gravityY: opts.gravity === false ? 0 : 400,
      emitting: false,
    });
    emitter.setDepth(1e9);
    emitter.explode(count);
    this.scene.time.delayedCall(life * 1000 + 200, () => emitter.destroy());
  }
}
