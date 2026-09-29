/**
 * The app frame (§2.2, §8.3): the skip link, the current screen (one lazy chunk per screen group), the
 * PlayerLayer, the toast region, the dialog layer, the Join card and the two live regions. Screens render
 * their own landmarks (header, main, complementary) with ScreenFrame or their own layout.
 */
import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { t } from '../i18n';
import { showToast } from '../state/app';
import { LiveRegion } from '../ui/components';
import { JoinCard } from '../screens/join/JoinCard';
import { DialogLayer } from './frame/DialogLayer';
import { ErrorBoundary } from './frame/ErrorBoundary';
import { SkipLink } from './frame/SkipLink';
import { ToastRegion } from './frame/ToastRegion';
import { PlayerLayer } from './player/PlayerLayer';
import { navigate, useRoute } from './router';
import { routeTitleKey, screenKeyOf, type Route, type RouteOf } from './routes';

/** The screen groups (§8.3): each loads as its own chunk, owned by its module. */
export const SCREEN_GROUPS = {
  first: () => import('../screens/first'),
  trail: () => import('../screens/trail'),
  newworld: () => import('../screens/newworld'),
  world: () => import('../screens/world'),
  draw: () => import('../screens/draw'),
  bones: () => import('../screens/bones'),
  code: () => import('../screens/code'),
  teacher: () => import('../screens/teacher'),
  settings: () => import('../screens/settings'),
  pages: () => import('../screens/pages'),
  handin: () => import('../screens/handin'),
} as const;

function screen<P>(load: () => Promise<Record<string, unknown>>, name: string): ComponentType<P> {
  return lazy(async () => ({ default: (await load())[name] as ComponentType<P> }));
}

const Home = screen<object>(SCREEN_GROUPS.trail, 'Home');
const Trail = screen<{ route: RouteOf<'trail'> }>(SCREEN_GROUPS.trail, 'Trail');
const FirstPage = screen<object>(SCREEN_GROUPS.first, 'FirstPage');
const NewWorldSheet = screen<{ route: RouteOf<'new'> }>(SCREEN_GROUPS.newworld, 'NewWorldSheet');
const PlanCard = screen<object>(SCREEN_GROUPS.newworld, 'PlanCard');
const OpenStarter = screen<{ route: RouteOf<'starter'> }>(SCREEN_GROUPS.newworld, 'OpenStarter');
const World = screen<{ route: RouteOf<'world'> }>(SCREEN_GROUPS.world, 'World');
const Desk = screen<{ route: RouteOf<'draw'> | RouteOf<'drawFree'> }>(SCREEN_GROUPS.draw, 'Desk');
const Bones = screen<{ route: RouteOf<'bones'> | RouteOf<'bonesFree'> }>(SCREEN_GROUPS.bones, 'Bones');
const CodeView = screen<{ route: RouteOf<'code'> }>(SCREEN_GROUPS.code, 'CodeView');
const TeacherDesk = screen<{ route: RouteOf<'teacher'> }>(SCREEN_GROUPS.teacher, 'TeacherDesk');
const Settings = screen<{ route: RouteOf<'settings'> }>(SCREEN_GROUPS.settings, 'Settings');
const Page = screen<{ route: RouteOf<'page'> }>(SCREEN_GROUPS.pages, 'Page');
const HandInSheet = screen<{ route: RouteOf<'handin'> }>(SCREEN_GROUPS.handin, 'HandInSheet');

/** Any unknown hash goes to the Trail with a toast (§2.1). */
function NotFound() {
  useEffect(() => {
    navigate({ name: 'trail', view: 'trail' }, { replace: true, transition: false });
    showToast(t('common.notFound'));
  }, []);
  return null;
}

function RouteSwitch({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'first':
      return <FirstPage />;
    case 'trail':
      return <Trail route={route} />;
    case 'new':
      return <NewWorldSheet route={route} />;
    case 'plan':
      return <PlanCard />;
    case 'starter':
      return <OpenStarter route={route} />;
    case 'world':
    case 'handin': {
      // The world stays mounted (and its game running) while the Hand in sheet is open over it.
      const worldId = route.name === 'world' ? route.id : route.worldId;
      return (
        <>
          <World key={worldId} route={{ name: 'world', id: worldId }} />
          {route.name === 'handin' && <HandInSheet route={route} />}
        </>
      );
    }
    case 'draw':
    case 'drawFree':
      return <Desk route={route} />;
    case 'bones':
    case 'bonesFree':
      return <Bones route={route} />;
    case 'code':
      return <CodeView route={route} />;
    case 'teacher':
      return <TeacherDesk route={route} />;
    case 'settings':
      return <Settings route={route} />;
    case 'page':
      return <Page route={route} />;
    case 'notFound':
      return <NotFound />;
  }
}

/** The screen key the page last showed (module scope, so StrictMode's second effect run changes nothing). */
let shownKey: string | null = null;

function isRendered(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

/**
 * After a route change, focus the new screen's main region (its heading is announced). The first screen
 * of a page load keeps the browser's focus. While a screen's chunk loads, the old screen may still be in
 * the page, hidden: only the new screen's own, rendered main counts, and focus is retried until it holds.
 */
function useFocusOnRouteChange(key: string): void {
  useEffect(() => {
    if (shownKey === null || shownKey === key) {
      shownKey = key;
      return;
    }
    shownKey = key;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const host = [...document.querySelectorAll<HTMLElement>('.screen-host')].find((h) => h.dataset.screen === key);
      const main = host?.querySelector<HTMLElement>('#main') ?? document.querySelector<HTMLElement>('.screen--error');
      if (main && isRendered(main)) {
        if (!main.contains(document.activeElement)) main.focus({ preventScroll: true });
        if (main.contains(document.activeElement)) return;
      }
      if (frames++ < 90) raf = requestAnimationFrame(tryFocus);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [key]);
}

export function App() {
  const route = useRoute();
  const key = screenKeyOf(route);
  useFocusOnRouteChange(key);
  useEffect(() => {
    const title = t(routeTitleKey(route));
    document.title = route.name === 'home' ? t('common.appName') : `${title} · ${t('common.appName')}`;
    document.documentElement.dataset.route = route.name;
  }, [route]);

  return (
    <>
      <SkipLink route={route} />
      <div className="app" data-route={route.name}>
        <ErrorBoundary resetKey={key}>
          <Suspense fallback={<div className="screen screen--loading" aria-hidden="true" />}>
            <div className="screen-host" key={key} data-screen={key}>
              <RouteSwitch route={route} />
            </div>
          </Suspense>
        </ErrorBoundary>
      </div>
      <PlayerLayer />
      <ToastRegion />
      <DialogLayer />
      <JoinCard />
      <LiveRegion />
    </>
  );
}
