/**
 * Every place a student can be (§2.1). Hash routing only: the site is served from a sub-path with
 * `base: './'` and GitHub Pages has no SPA fallback. `router.ts` parses and formats these.
 */
import type { ArtId, CastKey, StarterId, WorldId } from '../model/types';
import type { MessageKey } from '../i18n';

export const SETTINGS_SECTIONS = ['ai', 'sound', 'reading', 'drawing', 'keys', 'storage', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const TEACHER_TABS = ['link', 'assignments', 'gallery', 'help', 'present'] as const;
export type TeacherTab = (typeof TEACHER_TABS)[number];

export const PAGES = ['privacy', 'terms', 'ai', 'it', 'parents', 'accessibility', 'poster', 'sent', 'whatsnew'] as const;
export type PageName = (typeof PAGES)[number];

export type Route =
  | { name: 'home' } // #/
  | { name: 'first' } // #/first
  | { name: 'trail'; view: 'trail' | 'list' | 'lost' } // #/trail  #/trail/list  #/trail/lost
  | { name: 'new'; hero: ArtId | null; idea: boolean } // #/new  #/new?hero=a_x  #/new?idea=1
  | { name: 'plan' } // #/plan
  | { name: 'starter'; id: StarterId } // #/starter/moon-king
  | { name: 'world'; id: WorldId } // #/w/w_x
  | { name: 'draw'; worldId: WorldId; key: CastKey } // #/w/w_x/draw/moonKing
  | { name: 'bones'; worldId: WorldId; key: CastKey } // #/w/w_x/bones/hero
  | { name: 'code'; worldId: WorldId; file: string | null } // #/w/w_x/code  #/w/w_x/code/boss.js
  | { name: 'handin'; worldId: WorldId } // #/w/w_x/handin
  | { name: 'drawFree'; artId: ArtId | 'new' } // #/draw/new  #/draw/a_x
  | { name: 'bonesFree'; artId: ArtId } // #/bones/a_x
  | { name: 'settings'; section: SettingsSection | null } // #/settings[/ai]
  | { name: 'teacher'; tab: TeacherTab } // #/teacher/link ...
  | { name: 'page'; page: PageName } // #/privacy ...
  | { name: 'notFound' };

export type RouteName = Route['name'];
export type RouteOf<N extends RouteName> = Extract<Route, { name: N }>;

const PAGE_TITLES: Record<PageName, MessageKey> = {
  privacy: 'common.routePrivacy',
  terms: 'common.routeTerms',
  ai: 'common.routeAi',
  it: 'common.routeIt',
  parents: 'common.routeParents',
  accessibility: 'common.routeAccessibility',
  poster: 'common.routePoster',
  sent: 'common.routeSent',
  whatsnew: 'common.routeWhatsnew',
};

/** The string key of a route's title (document title and screen headings). */
export function routeTitleKey(route: Route): MessageKey {
  switch (route.name) {
    case 'home':
      return 'common.routeHome';
    case 'first':
      return 'common.routeFirst';
    case 'trail':
      return route.view === 'list' ? 'common.routeTrailList' : route.view === 'lost' ? 'common.routeTrailLost' : 'common.routeTrail';
    case 'new':
      return 'common.routeNew';
    case 'plan':
      return 'common.routePlan';
    case 'starter':
      return 'common.routeStarter';
    case 'world':
      return 'common.routeWorld';
    case 'draw':
    case 'drawFree':
      return 'common.routeDraw';
    case 'bones':
    case 'bonesFree':
      return 'common.routeBones';
    case 'code':
      return 'common.routeCode';
    case 'handin':
      return 'common.routeHandin';
    case 'settings':
      return 'common.routeSettings';
    case 'teacher':
      return 'common.routeTeacher';
    case 'page':
      return PAGE_TITLES[route.page];
    case 'notFound':
      return 'common.routeNotFound';
  }
}

/** Routes whose screen shows a running world (the skip link says "Skip to the game"). */
export function hasGame(route: Route): boolean {
  return route.name === 'world' || route.name === 'code' || route.name === 'handin';
}

/**
 * Which screen a route shows, as a stable key: a screen keeps its state across small route changes (a
 * settings section, the Hand in sheet over its world), and toasts belong to one.
 */
export function screenKeyOf(route: Route): string {
  switch (route.name) {
    case 'world':
      return `world:${route.id}`;
    case 'handin':
      return `world:${route.worldId}`;
    case 'draw':
      return `draw:${route.worldId}:${route.key}`;
    case 'drawFree':
      return `draw:${route.artId}`;
    case 'bones':
      return `bones:${route.worldId}:${route.key}`;
    case 'bonesFree':
      return `bones:${route.artId}`;
    case 'code':
      return `code:${route.worldId}`;
    case 'trail':
      return 'trail';
    default:
      return route.name;
  }
}
