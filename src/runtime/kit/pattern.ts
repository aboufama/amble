/** Bullet patterns (pooled, culled, capped): rings, fans, aimed shots, spirals, rain, walls, lasers. */
import Phaser from 'phaser';
import { colorInt } from './color';
import { numOf } from './dials';
import type { Kit } from './state';
import type { Point, ShotOptions } from './types';
import { DEG, TAU, util } from './util';

type From = Point & { role?: string; active?: boolean; alive?: boolean; facing?: number };

export class Pattern {
  constructor(private readonly k: Kit) {}

  private get s() {
    return this.k.scene;
  }

  ring(from: From, o: ShotOptions & { count?: number; offset?: number; petals?: number } = {}): Phaser.Physics.Arcade.Sprite[] {
    const n = Math.max(1, Math.min(200, o.count ?? 12));
    const off = o.offset ?? util.rand(0, 360 / n);
    const out: Phaser.Physics.Arcade.Sprite[] = [];
    for (let i = 0; i < n; i++) {
      const base = numOf(o.speed, 200);
      const speed = o.petals ? base * (1 + 0.45 * Math.sin((i / n) * TAU * o.petals)) : o.speed;
      const shot = this.s.shoot(from, off + (i * 360) / n, { ...o, speed });
      if (shot) out.push(shot);
    }
    return out;
  }

  spread(from: From, angle: number, o: ShotOptions & { count?: number; arc?: number } = {}): Phaser.Physics.Arcade.Sprite[] {
    const n = Math.max(1, Math.min(100, o.count ?? 5));
    const arc = o.arc ?? 50;
    const out: Phaser.Physics.Arcade.Sprite[] = [];
    for (let i = 0; i < n; i++) {
      const shot = this.s.shoot(from, n === 1 ? angle : angle - arc / 2 + (arc * i) / (n - 1), o);
      if (shot) out.push(shot);
    }
    return out;
  }

  aimed(from: From, target: Point, o: ShotOptions & { count?: number; arc?: number } = {}): Phaser.Physics.Arcade.Sprite[] {
    return this.spread(from, util.angleTo(from, target), { count: 1, ...o });
  }

  spiral(from: From, o: ShotOptions & { arms?: number; turn?: number; every?: number; duration?: number; shots?: number; start?: number } = {}): Phaser.Time.TimerEvent {
    let a = o.start ?? 0;
    const arms = Math.max(1, Math.min(12, o.arms ?? 2));
    let shots = 0;
    const max = o.shots ?? Math.floor((o.duration ?? 2500) / (o.every ?? 90));
    const t = this.s.time.addEvent({
      delay: Math.max(16, o.every ?? 90),
      loop: true,
      callback: () => {
        if (from.active === false || from.alive === false || ++shots > max) {
          t.remove();
          return;
        }
        for (let i = 0; i < arms; i++) this.s.shoot(from, a + (i * 360) / arms, o);
        a += o.turn ?? 13;
      },
    });
    return t;
  }

  rain(o: ShotOptions & { count?: number } = {}): void {
    const cam = this.s.cameras.main.worldView;
    const n = Math.max(1, Math.min(100, o.count ?? 8));
    for (let i = 0; i < n; i++) this.s.shoot({ x: cam.x + util.rand(20, cam.width - 20), y: cam.y - 20, role: 'enemy' }, 90 + util.rand(-8, 8), { speed: util.rand(160, 260), ...o });
  }

  wall(from: From, angle: number, o: ShotOptions & { count?: number; gap?: number; space?: number; hole?: number } = {}): void {
    const n = Math.max(2, Math.min(60, o.count ?? 10));
    const gap = o.gap ?? 2;
    const space = o.space ?? 42;
    const hole = o.hole ?? util.randInt(1, Math.max(1, n - gap - 1));
    const px = Math.cos((angle + 90) * DEG);
    const py = Math.sin((angle + 90) * DEG);
    for (let i = 0; i < n; i++) {
      if (i >= hole && i < hole + gap) continue;
      const d = (i - (n - 1) / 2) * space;
      this.s.shoot({ x: from.x + px * d, y: from.y + py * d, role: from.role }, angle, o);
    }
  }

  /** A telegraphed laser: a thin blinking warning line first, then a beam that hurts (and can sweep). */
  laser(from: From, angle: number, o: { warn?: number; duration?: number; sweep?: number; width?: number; length?: number; color?: unknown } = {}): { angle: number } {
    const s = this.s;
    const k = this.k;
    const len = o.length ?? 1400;
    const width = o.width ?? 26;
    const color = colorInt(o.color ?? 0xff5ea8);
    const warn = s.add.image(from.x, from.y, 'amble-fx', 'line').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setAlpha(0.5).setDepth(700);
    warn.setScale(len / 64, 0.4).setAngle(angle);
    s.tweens.add({ targets: warn, alpha: 0.15, yoyo: true, repeat: -1, duration: 90 });
    const st = { angle, t: 0 };
    s.time.delayedCall(o.warn ?? 700, () => {
      warn.destroy();
      if (from.active === false || from.alive === false) return;
      const beam = s.add.image(from.x, from.y, 'amble-fx', 'line').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setDepth(701).setAlpha(0.75);
      const core = s.add.image(from.x, from.y, 'amble-fx', 'line').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffffff).setDepth(702);
      k.fx.shake(0.008, o.duration ?? 1200);
      s.sfx('laser', { pitch: 0.5 });
      const fn = (dt: number) => {
        st.t += dt * 1000;
        if (st.t > (o.duration ?? 1200) || from.active === false || from.alive === false) {
          s.tweens.add({ targets: [beam, core], scaleY: 0, duration: 120, onComplete: () => { beam.destroy(); core.destroy(); } });
          k.postFns.splice(k.postFns.indexOf(fn), 1);
          return;
        }
        st.angle += (o.sweep ?? 0) * dt;
        const wob = 1 + Math.sin(st.t * 0.05) * 0.12;
        beam.setPosition(from.x, from.y).setAngle(st.angle).setScale(len / 64, (width / 6) * wob);
        core.setPosition(from.x, from.y).setAngle(st.angle).setScale(len / 64, ((width * 0.35) / 6) * wob);
        const h = k.hero;
        if (h && h.alive) {
          const ax = Math.cos(st.angle * DEG);
          const ay = Math.sin(st.angle * DEG);
          const dx = h.x - from.x;
          const dy = h.y - from.y;
          const along = dx * ax + dy * ay;
          const perp = Math.abs(dx * ay - dy * ax);
          if (along > 0 && along < len && perp < width / 2 + 14) h.damage(1, { from });
        }
        if (Math.random() < 0.5) {
          const d = util.rand(40, 700);
          k.fx.burst(from.x + Math.cos(st.angle * DEG) * d, from.y + Math.sin(st.angle * DEG) * d, { colors: [color, 0xffffff], count: 1, speed: [40, 120], life: 200, size: 0.4 });
        }
      };
      k.postFns.push(fn);
    });
    return st;
  }
}
