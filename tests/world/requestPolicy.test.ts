/**
 * The request tag's manners (§2.6): only at a pause, a lost life, a win or loss, or after 5 s of idle;
 * only members seen on screen; once per member every 2 minutes; never while Later snoozes it (12 h).
 */
import { describe, expect, it } from 'vitest';
import type { CastMember, CastSlot, World } from '../../src/model/types';
import { askable, laterUntil, LATER_MS, pickRequest, TAG_COOLDOWN_MS, triggerOf } from '../../src/world/requestPolicy';
import { sampleWorld } from '../foundation/samples';

function member(key: string, over: Partial<CastMember> = {}): CastMember {
  return {
    key, name: key, kind: 'character', role: 'enemy', rig: 'blob', shape: 'capsule', ask: '', about: '', pronoun: 'them', facing: 'right',
    w: 40, h: 40, priority: 10, required: true, spare: false, art: null, status: 'needed', onScreen: true, count: 1, ...over,
  };
}

function world(slots: Partial<Record<string, Partial<CastSlot>>> = {}): World {
  const cast: Record<string, CastSlot> = {};
  for (const [key, over] of Object.entries(slots)) cast[key] = { key, art: null, madeBy: null, extra: null, laterUntil: 0, ...over };
  return sampleWorld({ cast });
}

const NOW = 1_800_000_000_000;

describe('pickRequest', () => {
  const cast = [member('hero', { status: 'drawn', priority: 1 }), member('boss', { priority: 2 }), member('grumble', { priority: 10 })];

  it('asks for nothing without a moment to ask', () => {
    expect(pickRequest(cast, world(), { trigger: null, now: NOW, shownAt: {} })).toBeNull();
  });

  it('asks for the highest-priority undrawn member at a pause, death, win, loss or idle', () => {
    for (const trigger of ['paused', 'death', 'won', 'lost', 'idle'] as const) {
      expect(pickRequest(cast, world(), { trigger, now: NOW, shownAt: {} })?.key).toBe('boss');
    }
  });

  it('only asks for members that have appeared on screen', () => {
    const offscreen = [member('boss', { onScreen: false, priority: 2 }), member('grumble', { priority: 10 })];
    expect(pickRequest(offscreen, world(), { trigger: 'idle', now: NOW, shownAt: {} })?.key).toBe('grumble');
    expect(pickRequest(offscreen, world(), { trigger: 'idle', now: NOW, shownAt: {}, seen: new Set(['boss']) })?.key).toBe('boss');
  });

  it('asks for each member at most once every 2 minutes', () => {
    const shownAt = { boss: NOW - 30_000 };
    expect(pickRequest(cast, world(), { trigger: 'paused', now: NOW, shownAt })?.key).toBe('grumble');
    expect(pickRequest(cast, world(), { trigger: 'paused', now: NOW - 30_000 + TAG_COOLDOWN_MS, shownAt })?.key).toBe('boss');
  });

  it('never asks while Later snoozes a member (12 hours)', () => {
    const snoozed = world({ boss: { laterUntil: laterUntil(NOW) } });
    expect(laterUntil(NOW)).toBe(NOW + LATER_MS);
    expect(pickRequest(cast, snoozed, { trigger: 'won', now: NOW, shownAt: {} })?.key).toBe('grumble');
    expect(pickRequest(cast, snoozed, { trigger: 'won', now: NOW + LATER_MS + 1, shownAt: {} })?.key).toBe('boss');
  });

  it('never asks for optional, spare or drawn members', () => {
    const quiet = [member('sky', { status: 'optional' }), member('bubbles', { status: 'spare' }), member('hero', { status: 'drawn' })];
    expect(pickRequest(quiet, world(), { trigger: 'idle', now: NOW, shownAt: {} })).toBeNull();
    expect(askable(quiet[0], world(), NOW, {})).toBe(false);
  });

  it('asks at once in a Warm-up, even for members not on screen yet', () => {
    const warm = [member('rae', { onScreen: false, priority: 1 })];
    expect(pickRequest(warm, world(), { trigger: 'warmup', now: NOW, shownAt: {} })?.key).toBe('rae');
  });
});

describe('triggerOf', () => {
  it('turns game events into moments to ask', () => {
    expect(triggerOf({ kind: 'win' }, null)).toBe('won');
    expect(triggerOf({ kind: 'lose' }, 3)).toBe('lost');
    expect(triggerOf({ kind: 'lives', value: 2 }, 3)).toBe('death');
    expect(triggerOf({ kind: 'lives', value: 3 }, null)).toBeNull();
    expect(triggerOf({ kind: 'lives', value: 4 }, 3)).toBeNull();
    expect(triggerOf({ kind: 'score', value: 10 }, 3)).toBeNull();
  });
});
