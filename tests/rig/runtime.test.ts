import { describe, expect, it } from 'vitest';
import { clipsFor, resolveClip } from '../../src/rig/clips/library';
import { RigPuppet, type BodyLike } from '../../src/rig/runtime/puppet';
import { templateFor } from '../../src/rig/templates';
import { CHARACTER_KINDS } from '../../src/rig/types';
import { bound, SAMPLE_NAMES } from './helpers';

const KIT_CLIPS = ['idle', 'walk', 'run', 'jump', 'rise', 'fall', 'land', 'dash', 'attack', 'shoot', 'hurt', 'die', 'cheer', 'rage', 'fly', 'glide', 'swim', 'wiggle', 'spin'];

const step = (p: RigPuppet, seconds: number, motion: { dx?: number } = {}) => {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) p.update(1 / 60, motion);
};

/** Lowest point of a set of bones' tips (art px from the anchor). */
function lowestFoot(p: RigPuppet): number {
  let low = -Infinity;
  for (const f of p.skeleton.feet) {
    const [, y1, , y2] = p.skeleton.bonePoints(f);
    low = Math.max(low, y1, y2);
  }
  return low;
}

describe('clips', () => {
  it('every clip name the game kit uses plays on every kind', () => {
    for (const kind of CHARACTER_KINDS) for (const name of KIT_CLIPS) expect(resolveClip(kind, name), `${kind} ${name}`).not.toBeNull();
  });

  it('lists clips in a friendly order', () => {
    expect(clipsFor('biped').slice(0, 3)).toEqual(['idle', 'walk', 'run']);
    expect(clipsFor('flyer')).toContain('fly');
    expect(clipsFor('swimmer')).toContain('swim');
    expect(clipsFor('object')).toContain('spin');
  });

  it('never produce NaN, for any clip of any sample', () => {
    for (const name of SAMPLE_NAMES) {
      const b = bound(name);
      for (const clip of clipsFor(b.rig.kind)) {
        const p = new RigPuppet(b);
        p.play(clip, { fade: 0 });
        step(p, 1.5, { dx: 1 });
        for (const v of p.vertices!) expect(Number.isFinite(v), `${name} ${clip}`).toBe(true);
      }
    }
  }, 120_000);

  it('templates animate too (just bones)', () => {
    for (const kind of CHARACTER_KINDS) {
      const p = new RigPuppet(templateFor(kind, 120, 160));
      for (const clip of clipsFor(kind)) {
        p.play(clip);
        step(p, 0.5);
      }
      expect(p.vertices).toBeNull();
      expect(Number.isFinite(p.bone(p.rig.bones[0].name)!.x)).toBe(true);
    }
  });
});

describe('the runtime', () => {
  it('walking keeps the feet on the ground line', () => {
    for (const name of ['hero', 'dog', 'stick']) {
      const p = new RigPuppet(bound(name));
      p.play('walk', { fade: 0 });
      step(p, 0.3);
      let worst = 0;
      for (let i = 0; i < 90; i++) {
        p.update(1 / 60);
        const drawnFoot = Math.max(...p.skeleton.feet.map((f) => Math.max(p.rig.bones[f].y, p.rig.bones[f].y2))) - p.rig.anchor[1];
        worst = Math.max(worst, Math.abs(lowestFoot(p) - drawnFoot));
      }
      expect(worst, name).toBeLessThan(1.5);
    }
  }, 60_000);

  it('crossfades without jumps', () => {
    const jumpAtSwitch = (fade?: number) => {
      const p = new RigPuppet(bound('hero'));
      p.play('run', { fade: 0 });
      step(p, 0.13);
      p.play('attack', { fade: 0 });
      step(p, 0.2);
      const before = Float32Array.from(p.vertices!);
      p.play('idle', fade === undefined ? {} : { fade });
      p.update(1 / 60);
      let worst = 0;
      p.vertices!.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - before[k]))));
      return worst;
    };
    const cut = jumpAtSwitch(0);
    const faded = jumpAtSwitch();
    expect(cut).toBeGreaterThan(5);
    expect(faded).toBeLessThan(cut * 0.35);
  }, 60_000);

  it('one-shots return to what was playing', () => {
    const p = new RigPuppet(bound('hero'));
    p.play('walk');
    step(p, 0.5);
    p.play('jump');
    expect(p.clip).toBe('jump');
    step(p, 1.5);
    expect(p.clip).toBe('walk');
    p.play('die');
    step(p, 3);
    expect(p.clip).toBe('die');
    expect(p.pose.alpha).toBeLessThan(0.05);
  }, 60_000);

  it('attacks play on the arms while the legs keep running', () => {
    const p = new RigPuppet(bound('hero'));
    p.play('run');
    step(p, 0.4);
    p.play('attack');
    expect(p.clip).toBe('attack');
    expect(p.animator.baseClip).toBe('run');
    step(p, 0.6);
    expect(p.clip).toBe('run');
  }, 60_000);

  it('follows a physics body: idle, walk, run, rise, fall, land', () => {
    const p = new RigPuppet(bound('hero'));
    const body: BodyLike & { blocked: { down: boolean } } = { velocity: { x: 0, y: 0 }, blocked: { down: true } };
    p.follow(body);
    step(p, 0.2);
    expect(p.clip).toBe('idle');
    const H = p.skeleton.height;
    body.velocity.x = 1.2 * H;
    step(p, 0.2);
    expect(p.clip).toBe('walk');
    body.velocity.x = 4 * H;
    step(p, 0.2);
    expect(p.clip).toBe('run');
    body.blocked.down = false;
    body.velocity.y = -300;
    step(p, 0.1);
    expect(p.clip).toBe('rise');
    body.velocity.y = 300;
    step(p, 0.1);
    expect(p.clip).toBe('fall');
    body.blocked.down = true;
    body.velocity.y = 0;
    step(p, 1 / 60);
    expect(p.clip).toBe('land');
    body.velocity.x = -4 * H;
    step(p, 0.6);
    expect(p.facing).toBe(-1);
    p.follow(null);
    p.play('wiggle');
    step(p, 0.2);
    expect(p.clip).toBe('wiggle');
  }, 60_000);

  it('a top-down body (no ground) walks and runs without falling', () => {
    const p = new RigPuppet(bound('dog'));
    const body = { velocity: { x: 0, y: 1.2 * 60 } };
    p.follow(body);
    step(p, 0.3);
    expect(p.clip).not.toBe('fall');
  }, 60_000);

  it('side views turn with a quick paper flip; drawings facing the viewer never mirror', () => {
    const dog = new RigPuppet(bound('dog'));
    const x0 = dog.vertices![0];
    dog.face(-1);
    step(dog, 0.2);
    expect(dog.flip).toBe(-1);
    expect(dog.vertices![0]).toBeCloseTo(-x0, 0);
    const hero = new RigPuppet(bound('hero'));
    hero.face(-1);
    step(hero, 0.2);
    expect(hero.flip).toBe(1);
    expect(hero.facing).toBe(-1);
  }, 60_000);

  it('Bouncy and Speedy change a move; Off turns it off', () => {
    const b = bound('slime');
    const amplitude = (anims?: Record<string, { amount?: number; speed?: number; off?: boolean }>) => {
      const p = new RigPuppet({ ...b, rig: { ...b.rig, anims } });
      p.play('idle', { fade: 0 });
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 120; i++) {
        p.update(1 / 60);
        lo = Math.min(lo, p.pose.gsx);
        hi = Math.max(hi, p.pose.gsx);
      }
      return hi - lo;
    };
    const normal = amplitude();
    expect(amplitude({ idle: { amount: 2 } })).toBeGreaterThan(normal * 1.5);
    expect(amplitude({ idle: { amount: 0 } })).toBeLessThan(1e-6);
    const off = new RigPuppet({ ...b, rig: { ...b.rig, anims: { jump: { off: true } } } });
    expect(off.play('jump')).toBe(false);
  }, 60_000);

  it('wheels turn with the distance travelled', () => {
    const p = new RigPuppet(bound('car'));
    const w = p.skeleton.role('wheel1');
    p.play('walk', { fade: 0 });
    for (let i = 0; i < 30; i++) p.update(1 / 60, { dx: 2 });
    const turned = p.skeleton.wa[w] - p.skeleton.restA[w];
    expect(Math.abs(turned)).toBeGreaterThan(0.5);
  }, 60_000);
});
