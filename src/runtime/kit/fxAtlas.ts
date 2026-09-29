/**
 * The kit's particle and effect sprites, painted once per game into one small canvas texture ('amble-fx'):
 * dot, spark, square, shard, smoke, ring, star, heart and line. All white (tinted at use), so one texture
 * serves every colour and particles batch into few draw calls.
 */
import type Phaser from 'phaser';
import { seeded, TAU } from './util';

export const FX_TEXTURE = 'amble-fx';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const FRAMES: Array<[name: string, x: number, y: number, w: number, h: number, draw: Draw]> = [
  [
    'dot', 0, 0, 32, 32,
    (ctx) => {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
    },
  ],
  [
    'spark', 32, 0, 32, 10,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.7, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0.6)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2 - 1, 0, 0, TAU);
      ctx.fill();
    },
  ],
  [
    'square', 64, 0, 12, 12,
    (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(1, 1, w - 2, h - 2);
    },
  ],
  [
    'shard', 80, 0, 14, 14,
    (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(1, h - 1);
      ctx.lineTo(w / 2, 1);
      ctx.lineTo(w - 1, h - 3);
      ctx.fill();
    },
  ],
  [
    'smoke', 96, 0, 48, 48,
    (ctx, w, h) => {
      const r = seeded(99);
      for (let i = 0; i < 7; i++) {
        const x = 12 + r() * 24;
        const y = 12 + r() * 24;
        const rr = 8 + r() * 10;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    },
  ],
  [
    'ring', 144, 0, 64, 64,
    (ctx) => {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(32, 32, 28, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 10;
      ctx.stroke();
    },
  ],
  [
    'star', 208, 0, 24, 24,
    (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const t = (i / 10) * TAU - Math.PI / 2;
        const rr = i % 2 ? 4.5 : 11;
        ctx.lineTo(12 + Math.cos(t) * rr, 12 + Math.sin(t) * rr);
      }
      ctx.fill();
    },
  ],
  [
    'heart', 232, 0, 24, 24,
    (ctx) => {
      // Hearts keep their red (health icons), with a dark rim so they read on any sky.
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * TAU;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        ctx.lineTo(12 + (x / 17) * 10, 12.8 + (y / 16) * 9.5);
      }
      ctx.closePath();
      ctx.fillStyle = '#ff4d6d';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#17132b';
      ctx.stroke();
    },
  ],
  [
    'line', 0, 40, 64, 6,
    (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 1, w, h - 2);
    },
  ],
];

export const FX_FRAMES: readonly string[] = FRAMES.map((f) => f[0]);

/** Paints the atlas into the game's textures (once per game; later scenes reuse it). */
export function buildFxAtlas(scene: Phaser.Scene): void {
  const tm = scene.sys.textures;
  if (tm.exists(FX_TEXTURE)) return;
  const tex = tm.createCanvas(FX_TEXTURE, 256, 64);
  if (!tex) return;
  const ctx = tex.context;
  for (const [, x, y, w, h, draw] of FRAMES) {
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, w, h);
    ctx.restore();
  }
  tex.refresh();
  for (const [name, x, y, w, h] of FRAMES) tex.add(name, 0, x, y, w, h);
}
