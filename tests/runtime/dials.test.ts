import { describe, expect, it } from 'vitest';
import { DialRegistry, clampDial, defaultStep, labelFromKey, normalizeDial, numOf } from '../../src/runtime/kit/dials';

describe('normalizeDial', () => {
  it('keeps a well-formed dial', () => {
    expect(normalizeDial('jump', { label: 'Jump power', value: 780, min: 400, max: 1100, step: 10, words: 'hop' })).toEqual({
      label: 'Jump power', value: 780, min: 400, max: 1100, step: 10, live: true, words: 'hop',
    });
  });

  it('repairs what a model might get wrong', () => {
    const d = normalizeDial('bossHealth', { value: 5000, min: 400, max: 50, live: false });
    expect(d).toMatchObject({ label: 'Boss health', min: 50, max: 400, value: 400, live: false });
    expect(normalizeDial('speed', { value: 300 })).toMatchObject({ min: 0, max: 600, value: 300 });
    expect(normalizeDial('x', { value: 5, min: 5, max: 5 })).toMatchObject({ min: 5, max: 10 });
    expect(normalizeDial('x', { label: 'A very very long label for a dial' })).toBeNull();
    expect(normalizeDial('x', 'nope')).toBeNull();
  });

  it('snaps the value to the step', () => {
    expect(normalizeDial('n', { value: 7.3, min: 0, max: 20, step: 2 })?.value).toBe(8);
  });
});

describe('clampDial, defaultStep, labelFromKey', () => {
  it('clamps and snaps', () => {
    const spec = { min: 400, max: 1100, step: 10 };
    expect(clampDial(spec, 9999)).toBe(1100);
    expect(clampDial(spec, -3)).toBe(400);
    expect(clampDial(spec, 784)).toBe(780);
    expect(clampDial(spec, Number.NaN)).toBe(400);
    expect(clampDial({ min: 0, max: 1, step: 0.1 }, 0.33)).toBe(0.3);
  });

  it('picks readable steps', () => {
    expect(defaultStep(0, 100)).toBe(1);
    expect(defaultStep(400, 1100)).toBe(10);
    expect(defaultStep(0, 1)).toBe(0.01);
    expect(defaultStep(0, 30)).toBe(0.5);
  });

  it('turns keys into labels', () => {
    expect(labelFromKey('jumpPower')).toBe('Jump power');
    expect(labelFromKey('boss_hp')).toBe('Boss hp');
  });
});

describe('DialRegistry', () => {
  it('declares static dials and applies editor values', () => {
    const r = new DialRegistry({ jump: 950 });
    r.declareAll({ jump: { label: 'Jump', value: 720, min: 400, max: 1100, step: 10 }, count: 5, broken: 'x' });
    expect(r.values()).toEqual({ jump: 950, count: 5 });
    expect(r.list().map((d) => d.key)).toEqual(['jump', 'count']);
    expect(r.takeChanged()).toBe(true);
    expect(r.takeChanged()).toBe(false);
  });

  it('applies a change live when the game reads the dial every frame', () => {
    const r = new DialRegistry();
    r.declareAll({ jump: { value: 720, min: 400, max: 1100, step: 10 } });
    r.startBuilding();
    expect(r.read('jump')).toBe(720);
    r.doneBuilding();
    expect(r.read('jump')).toBe(720); // an update() read
    expect(r.set('jump', 900)).toEqual({ key: 'jump', value: 900, restart: false });
    expect(r.read('jump')).toBe(900);
  });

  it('restarts the level when the dial was only read while building, or is not live', () => {
    const r = new DialRegistry();
    r.declareAll({ hp: { value: 100, min: 10, max: 400, live: true }, count: { value: 3, min: 1, max: 9, live: false } });
    r.startBuilding();
    r.read('hp');
    r.read('count');
    r.doneBuilding();
    r.read('count');
    expect(r.set('hp', 200)).toEqual({ key: 'hp', value: 200, restart: true });
    expect(r.set('count', 5)).toEqual({ key: 'count', value: 5, restart: true });
    expect(r.set('count', 5)).toEqual({ key: 'count', value: 5, restart: false });
  });

  it('tune() declares a dial once and returns the current value', () => {
    const r = new DialRegistry({ speed: 450 });
    expect(r.tune('speed', 300, { min: 100, max: 600, label: 'Run speed' })).toBe(450);
    expect(r.tune('speed', 999)).toBe(450);
    expect(r.list()[0]).toMatchObject({ key: 'speed', label: 'Run speed', source: 'tune', value: 300, current: 450 });
    expect(r.set('unknown', 3)).toBeNull();
  });

  it('keeps values sent before the dial exists', () => {
    const r = new DialRegistry();
    expect(r.set('late', 42)).toBeNull();
    expect(r.tune('late', 10, { min: 0, max: 100 })).toBe(42);
  });

  it('exposes a read-only live view', () => {
    const r = new DialRegistry();
    r.declareAll({ jump: 700 });
    const dials = r.view();
    expect(dials.jump).toBe(700);
    r.set('jump', 800);
    expect(dials.jump).toBe(800);
    expect(Object.keys(dials)).toEqual(['jump']);
    expect('jump' in dials).toBe(true);
    expect(() => {
      (dials as Record<string, number>).jump = 1;
    }).toThrow();
  });
});

describe('numOf', () => {
  it('reads numbers and live functions', () => {
    let v = 5;
    const live = () => v;
    expect(numOf(live, 1)).toBe(5);
    v = 9;
    expect(numOf(live, 1)).toBe(9);
    expect(numOf(12, 1)).toBe(12);
    expect(numOf('12', 1)).toBe(1);
    expect(numOf(() => Number.NaN, 3)).toBe(3);
    expect(
      numOf(() => {
        throw new Error('x');
      }, 4),
    ).toBe(4);
  });
});
