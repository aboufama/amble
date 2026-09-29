/**
 * A tap answers at once (QA: "Draw a character" waited up to 4 s for the View Transition's picture of the
 * old screen under software GL). `navigate` changes the address in the tap itself; the screen follows
 * inside a transition, which is skipped when its picture is late or the page is busy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentRouteNow, navigate } from '../../src/app/router';
import { CAPTURE_BUDGET_MS, noteLongFrame } from '../../src/app/transitions';
import { getState, resetState } from '../../src/state/store';

interface Seen {
  pushed: string[];
  started: number;
  skipped: number;
  update: (() => unknown) | null;
}

/** A browser whose View Transitions take their picture only when the test says so. */
function slowBrowser(): Seen {
  let href = new URL('http://localhost:5240/#/trail');
  const seen: Seen = { pushed: [], started: 0, skipped: 0, update: null };
  vi.stubGlobal('location', {
    get hash() {
      return href.hash;
    },
  });
  vi.stubGlobal('history', {
    state: null,
    pushState(_s: unknown, _t: string, next: string) {
      href = new URL(next, href);
      seen.pushed.push(next);
    },
    replaceState(_s: unknown, _t: string, next: string) {
      href = new URL(next, href);
    },
  });
  vi.stubGlobal('document', {
    documentElement: { dataset: {} },
    visibilityState: 'visible',
    querySelector: () => null,
    startViewTransition(update: () => unknown) {
      seen.started++;
      seen.update = update;
      return {
        finished: new Promise(() => undefined),
        ready: new Promise(() => undefined),
        skipTransition: () => {
          seen.skipped++;
        },
      };
    },
  });
  return seen;
}

describe('navigate answers a tap at once', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetState();
  });

  it('changes the address in the tap, and the screen within the capture budget when the picture is late', () => {
    const b = slowBrowser();
    navigate({ name: 'drawFree', artId: 'new' });
    expect(b.pushed).toEqual(['#/draw/new']);
    expect(currentRouteNow()).toEqual({ name: 'drawFree', artId: 'new' });
    expect(getState().app.route).toEqual({ name: 'home' });
    vi.advanceTimersByTime(CAPTURE_BUDGET_MS);
    expect(b.skipped).toBe(1);
    expect(getState().app.route).toEqual({ name: 'drawFree', artId: 'new' });
    // The browser calls the update late: the screen does not change twice.
    b.update?.();
    expect(getState().app.route).toEqual({ name: 'drawFree', artId: 'new' });
  });

  it('changes inside the transition when the picture comes in time', () => {
    const b = slowBrowser();
    navigate({ name: 'settings', section: null });
    expect(b.started).toBe(1);
    b.update?.();
    expect(getState().app.route).toEqual({ name: 'settings', section: null });
    vi.advanceTimersByTime(CAPTURE_BUDGET_MS * 2);
    expect(b.skipped).toBe(0);
  });

  it('skips the transition on a busy page (a long frame in the last second)', () => {
    const b = slowBrowser();
    noteLongFrame(performance.now());
    navigate({ name: 'trail', view: 'list' });
    expect(b.started).toBe(0);
    expect(b.pushed).toEqual(['#/trail/list']);
    expect(getState().app.route).toEqual({ name: 'trail', view: 'list' });
  });
});
