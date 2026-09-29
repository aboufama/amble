/**
 * Routes (§2.1): every route parses and formats round-trip, unknown hashes are `notFound`, and a `#class=`
 * fragment is read and stripped from the address bar before anything renders.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatRoute, initRouter, parseHash } from '../../src/app/router';
import { PAGES, SETTINGS_SECTIONS, TEACHER_TABS, routeTitleKey, type Route } from '../../src/app/routes';
import { hasClassLink } from '../../src/cores/ai';
import { lookup } from '../../src/i18n';
import type { ClassLinkIntake } from '../../src/model/types';
import { getState, resetState } from '../../src/state/store';
import { sampleClassLink } from './samples';

const ROUTES: Route[] = [
  { name: 'home' },
  { name: 'first' },
  { name: 'trail', view: 'trail' },
  { name: 'trail', view: 'list' },
  { name: 'trail', view: 'lost' },
  { name: 'new', hero: null, idea: false },
  { name: 'new', hero: 'a_x1y2z3', idea: false },
  { name: 'new', hero: null, idea: true },
  { name: 'plan' },
  { name: 'starter', id: 'moon-king' },
  { name: 'starter', id: 'clanks-climb' },
  { name: 'world', id: 'w_abc123' },
  { name: 'draw', worldId: 'w_abc123', key: 'moonKing' },
  { name: 'bones', worldId: 'w_abc123', key: 'hero' },
  { name: 'code', worldId: 'w_abc123', file: null },
  { name: 'code', worldId: 'w_abc123', file: 'boss.js' },
  { name: 'handin', worldId: 'w_abc123' },
  { name: 'drawFree', artId: 'new' },
  { name: 'drawFree', artId: 'a_x1y2z3' },
  { name: 'bonesFree', artId: 'a_x1y2z3' },
  { name: 'settings', section: null },
  ...SETTINGS_SECTIONS.map((section) => ({ name: 'settings', section }) as Route),
  ...TEACHER_TABS.map((tab) => ({ name: 'teacher', tab }) as Route),
  ...PAGES.map((page) => ({ name: 'page', page }) as Route),
];

describe('routes', () => {
  it.each(ROUTES.map((r) => [formatRoute(r), r] as const))('%s round-trips', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
    expect(formatRoute(parseHash(hash))).toBe(hash);
  });

  it('covers every route name', () => {
    const names = new Set(ROUTES.map((r) => r.name));
    for (const n of ['home', 'first', 'trail', 'new', 'plan', 'starter', 'world', 'draw', 'bones', 'code', 'handin', 'drawFree', 'bonesFree', 'settings', 'teacher', 'page']) {
      expect(names.has(n as Route['name'])).toBe(true);
    }
  });

  it('reads the spec examples', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/teacher')).toEqual({ name: 'teacher', tab: 'link' });
    expect(parseHash('#/new?hero=a_x&idea=1')).toEqual({ name: 'new', hero: 'a_x', idea: true });
    expect(parseHash('#/w/w_x/draw/moonKing')).toEqual({ name: 'draw', worldId: 'w_x', key: 'moonKing' });
    expect(parseHash('#/trail/')).toEqual({ name: 'trail', view: 'trail' });
  });

  it.each([
    '#/nope',
    '#/trail/everything',
    '#/starter/not-a-starter',
    '#/w/',
    '#/w/w_x/draw/Moon King',
    '#/w/w_x/draw/1bad',
    '#/w/w_x/code/../../etc.js',
    '#/w/w_x/code/Boss.JS',
    '#/w/w_x/bones',
    '#/settings/secret',
    '#/teacher/root',
    '#/bones/new',
    '#/draw/a/b',
    '#/w/%E0%A4%A',
    '#class',
  ])('%s is not found', (hash) => {
    expect(parseHash(hash)).toEqual({ name: 'notFound' });
  });

  it('formats notFound as the Trail', () => {
    expect(formatRoute({ name: 'notFound' })).toBe('#/trail');
  });

  it('has a title for every route', () => {
    for (const r of [...ROUTES, { name: 'notFound' } as Route]) expect(lookup(routeTitleKey(r))).toBeTypeOf('string');
  });
});

// ------------------------------------------------------------------ boot: the class link

function fakeBrowser(url: string, o: { wasDiscarded?: boolean } = {}) {
  let href = new URL(url);
  const replaced: string[] = [];
  const location = {
    get hash() {
      return href.hash;
    },
    get pathname() {
      return href.pathname;
    },
    get search() {
      return href.search;
    },
  };
  const history = {
    state: null,
    replaceState(_s: unknown, _t: string, next: string) {
      href = new URL(next, href);
      replaced.push(next);
    },
    pushState(_s: unknown, _t: string, next: string) {
      href = new URL(next, href);
    },
  };
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', history);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { wasDiscarded: o.wasDiscarded ?? false });
  return { replaced, href: () => href.href };
}

const payload = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('boot and the class link', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetState();
  });

  it('detects class links', () => {
    expect(hasClassLink(`#class=${payload(sampleClassLink())}`)).toBe(true);
    expect(hasClassLink('#/trail')).toBe(false);
  });

  it('reads the link, strips it before render and opens the Join card', () => {
    const b = fakeBrowser(`http://localhost:5200/amble/?x=1#class=${payload(sampleClassLink())}`);
    const seen: string[] = [];
    const intake: ClassLinkIntake = { ok: true, link: sampleClassLink(), switchingFrom: null };
    const stop = initRouter({
      school: {
        readClassLink: (fragment: string) => {
          seen.push(fragment);
          return intake;
        },
        join: async () => undefined,
        leave: async () => undefined,
        check: async () => [],
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^#class=/);
    expect(b.href()).toBe('http://localhost:5200/amble/?x=1#/');
    expect(getState().app.joinIntake).toEqual(intake);
    expect(getState().app.route).toEqual({ name: 'home' });
    stop();
  });

  it('strips a damaged link too', () => {
    const b = fakeBrowser('http://localhost:5200/#class=%%%');
    initRouter({
      school: {
        readClassLink: () => {
          throw new Error('bad');
        },
        join: async () => undefined,
        leave: async () => undefined,
        check: async () => [],
      },
    })();
    expect(b.href()).toBe('http://localhost:5200/#/');
    expect(getState().app.joinIntake).toBeNull();
  });

  it('reads a class link pasted into an open tab (a hash change)', () => {
    const b = fakeBrowser('http://localhost:5200/#/trail');
    const intake: ClassLinkIntake = { ok: false, reason: 'expired' };
    const stop = initRouter({ school: { readClassLink: () => intake, join: async () => undefined, leave: async () => undefined, check: async () => [] } });
    expect(getState().app.joinIntake).toBeNull();
    history.pushState(null, '', `#class=${payload(sampleClassLink())}`);
    window.dispatchEvent(new Event('hashchange'));
    expect(b.href()).toBe('http://localhost:5200/#/');
    expect(getState().app.joinIntake).toEqual(intake);
    expect(getState().app.route).toEqual({ name: 'home' });
    stop();
  });

  it('restores the last route after a discarded tab', () => {
    const b = fakeBrowser('http://localhost:5200/', { wasDiscarded: true });
    initRouter({ school: { readClassLink: () => null, join: async () => undefined, leave: async () => undefined, check: async () => [] } }, { lastRoute: '#/w/w_abc/draw/hero' })();
    expect(b.href()).toBe('http://localhost:5200/#/w/w_abc/draw/hero');
    expect(getState().app.route).toEqual({ name: 'draw', worldId: 'w_abc', key: 'hero' });
  });
});
