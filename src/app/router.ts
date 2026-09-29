/**
 * Hash routing (§2.1): parse and format every route, `navigate(route, { replace })` and `useRoute()`.
 * The hash always says where the student is, so Back works and a reload comes back to the same place.
 * A `#class=` fragment is not a route: at boot it goes to `SchoolApi.readClassLink` and is removed from
 * the address bar before anything renders.
 */
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { PAGES, SETTINGS_SECTIONS, TEACHER_TABS, type PageName, type Route, type SettingsSection, type TeacherTab } from './routes';
import { isCastKey, isCodePath } from '../model/ids';
import { isStarterId } from '../model/guards';
import { hasClassLink } from '../cores/ai';
import { setJoinIntake, setRoute } from '../state/app';
import type { Services } from './services';
import { withViewTransition } from './transitions';

// ------------------------------------------------------------------ parse and format

const LOOSE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** World ids are `uid('w_')`; routes accept any short id so older or imported worlds still open. */
export function isWorldIdLike(v: unknown): v is string {
  return typeof v === 'string' && LOOSE_ID.test(v);
}

export function isArtIdLike(v: unknown): v is string {
  return typeof v === 'string' && LOOSE_ID.test(v) && v !== 'new';
}

function query(q: string): URLSearchParams {
  return new URLSearchParams(q);
}

/** A hash (`#/w/w_x/draw/moonKing`, with or without `#`) to a route; anything unknown is `notFound`. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?', 2);
  const path = pathPart.replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = path === '' ? [] : path.split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return '\u0000';
    }
  });
  const q = query(queryPart);
  const [a, b, c, d, ...rest] = parts;
  if (parts.length === 0) return { name: 'home' };
  switch (a) {
    case 'first':
      return parts.length === 1 ? { name: 'first' } : { name: 'notFound' };
    case 'trail':
      if (parts.length === 1) return { name: 'trail', view: 'trail' };
      if (parts.length === 2 && (b === 'list' || b === 'lost')) return { name: 'trail', view: b };
      return { name: 'notFound' };
    case 'new': {
      if (parts.length !== 1) return { name: 'notFound' };
      const hero = q.get('hero');
      return { name: 'new', hero: hero && isArtIdLike(hero) ? hero : null, idea: q.get('idea') === '1' };
    }
    case 'plan':
      return parts.length === 1 ? { name: 'plan' } : { name: 'notFound' };
    case 'starter':
      return parts.length === 2 && isStarterId(b) ? { name: 'starter', id: b } : { name: 'notFound' };
    case 'w': {
      if (!b || !isWorldIdLike(b) || rest.length) return { name: 'notFound' };
      if (parts.length === 2) return { name: 'world', id: b };
      if (c === 'draw' && parts.length === 4 && isCastKey(d)) return { name: 'draw', worldId: b, key: d };
      if (c === 'bones' && parts.length === 4 && isCastKey(d)) return { name: 'bones', worldId: b, key: d };
      if (c === 'code' && parts.length === 3) return { name: 'code', worldId: b, file: null };
      if (c === 'code' && parts.length === 4 && isCodePath(d)) return { name: 'code', worldId: b, file: d };
      if (c === 'handin' && parts.length === 3) return { name: 'handin', worldId: b };
      return { name: 'notFound' };
    }
    case 'draw':
      if (parts.length === 2 && (b === 'new' || isArtIdLike(b))) return { name: 'drawFree', artId: b };
      return { name: 'notFound' };
    case 'bones':
      return parts.length === 2 && isArtIdLike(b) ? { name: 'bonesFree', artId: b } : { name: 'notFound' };
    case 'settings':
      if (parts.length === 1) return { name: 'settings', section: null };
      if (parts.length === 2 && (SETTINGS_SECTIONS as readonly string[]).includes(b)) return { name: 'settings', section: b as SettingsSection };
      return { name: 'notFound' };
    case 'teacher':
      if (parts.length === 1) return { name: 'teacher', tab: 'link' };
      if (parts.length === 2 && (TEACHER_TABS as readonly string[]).includes(b)) return { name: 'teacher', tab: b as TeacherTab };
      return { name: 'notFound' };
    default:
      if (parts.length === 1 && (PAGES as readonly string[]).includes(a)) return { name: 'page', page: a as PageName };
      return { name: 'notFound' };
  }
}

const enc = encodeURIComponent;

/** A route to its hash (`#/...`). `notFound` formats as the Trail. */
export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'first':
      return '#/first';
    case 'trail':
      return route.view === 'trail' ? '#/trail' : `#/trail/${route.view}`;
    case 'new': {
      const q = new URLSearchParams();
      if (route.hero) q.set('hero', route.hero);
      if (route.idea) q.set('idea', '1');
      const s = q.toString();
      return s ? `#/new?${s}` : '#/new';
    }
    case 'plan':
      return '#/plan';
    case 'starter':
      return `#/starter/${route.id}`;
    case 'world':
      return `#/w/${enc(route.id)}`;
    case 'draw':
      return `#/w/${enc(route.worldId)}/draw/${route.key}`;
    case 'bones':
      return `#/w/${enc(route.worldId)}/bones/${route.key}`;
    case 'code':
      return route.file ? `#/w/${enc(route.worldId)}/code/${route.file}` : `#/w/${enc(route.worldId)}/code`;
    case 'handin':
      return `#/w/${enc(route.worldId)}/handin`;
    case 'drawFree':
      return `#/draw/${enc(route.artId)}`;
    case 'bonesFree':
      return `#/bones/${enc(route.artId)}`;
    case 'settings':
      return route.section ? `#/settings/${route.section}` : '#/settings';
    case 'teacher':
      return `#/teacher/${route.tab}`;
    case 'page':
      return `#/${route.page}`;
    case 'notFound':
      return '#/trail';
  }
}

// ------------------------------------------------------------------ the current route

const listeners = new Set<() => void>();
let currentHash: string | null = null;
let currentRoute: Route = { name: 'home' };

function locationHash(): string {
  return typeof location === 'undefined' ? '' : location.hash;
}

function snapshot(): Route {
  const hash = locationHash();
  if (hash !== currentHash) {
    currentHash = hash;
    currentRoute = parseHash(hash);
  }
  return currentRoute;
}

function changed(): void {
  const route = snapshot();
  setRoute(route);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The route the address bar shows. */
export function currentRouteNow(): Route {
  return snapshot();
}

/** Re-renders on every route change (back/forward, links, `navigate`). */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, () => currentRoute);
}

export interface NavigateOptions {
  /** Replace the current history entry instead of adding one. */
  replace?: boolean;
  /** Animate with a View Transition when supported and motion is allowed (default true). */
  transition?: boolean;
}

/** Goes to a route: updates the hash, the store's `app.route` and every `useRoute()` synchronously. */
export function navigate(route: Route, o: NavigateOptions = {}): void {
  const hash = formatRoute(route);
  const apply = () => {
    if (hash !== locationHash()) {
      if (o.replace) history.replaceState(history.state, '', hash);
      else history.pushState(null, '', hash);
    }
    changed();
  };
  if (o.transition === false) apply();
  else withViewTransition(() => flushSync(apply));
}

export function hrefOf(route: Route): string {
  return formatRoute(route);
}

/** Hands a `#class=` fragment to the school service (for the Join card) and strips it from the address bar. */
function takeClassLink(services: Pick<Services, 'school'>, hash: string): void {
  let intake = null;
  try {
    intake = services.school.readClassLink(hash);
  } catch (err) {
    console.warn('The class link could not be read:', err);
  }
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/`);
  setJoinIntake(intake);
}

/**
 * Boot: reads a `#class=` link (handing it to the school service for the Join card), strips it from the
 * address bar, restores the last route after a discarded tab, and starts listening for hash changes.
 * Returns a function that stops listening.
 */
export function initRouter(services: Pick<Services, 'school'>, o: { lastRoute?: string | null } = {}): () => void {
  const hash = locationHash();
  if (hasClassLink(hash)) {
    takeClassLink(services, hash);
  } else if (!hash && o.lastRoute && (document as Document & { wasDiscarded?: boolean }).wasDiscarded) {
    const route = parseHash(o.lastRoute);
    if (route.name !== 'notFound') history.replaceState(history.state, '', formatRoute(route));
  }
  // A class link pasted into the address bar of an open tab arrives as a hash change.
  const onChange = () => {
    const now = locationHash();
    if (hasClassLink(now)) takeClassLink(services, now);
    changed();
  };
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  changed();
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}
