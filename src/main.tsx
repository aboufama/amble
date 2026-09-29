/**
 * Boot (§8.3): fonts and styles, the services (the store opens first), the student's prefs applied to
 * `<html>` before the first paint (theme, motion, text size, spacing, layout), the router (a `#class=`
 * link is read and stripped before anything renders), global keys, then the app.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/fonts';
import './ui/tokens.css';
import './ui/themes.css';
import './ui/base.css';
import './ui/components/components.css';
import './app/frame/frame.css';
import { App } from './app/App';
import { applyHtmlPrefs } from './app/htmlPrefs';
import { installGlobalKeys } from './app/keys';
import { watchLayout } from './app/layout';
import { initRouter, navigate } from './app/router';
import { createServices, ServicesProvider, setServices, type Services } from './app/services';
import { AI_CORE, resolveAiConfig } from './cores/ai';
import { PLAYER_CORE } from './cores/play';
import { startFilesUpkeep } from './files/api';
import { registerServiceWorker } from './pwa/register';
import { setConfig } from './state/config';
import { refreshLibrary } from './state/library';
import { loadPrefs, onPrefsChange, readPrefs, setPrefs } from './state/prefs';
import { getState, setState, subscribe } from './state/store';
import { unlockUiSounds } from './ui/sounds';

function watchPrefs(services: Services): void {
  let last = getState().prefs;
  applyHtmlPrefs(last);
  subscribe((state) => {
    if (state.prefs === last) return;
    last = state.prefs;
    applyHtmlPrefs(last);
  });
  const reapply = () => applyHtmlPrefs(getState().prefs);
  matchMedia('(forced-colors: active)').addEventListener('change', reapply);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', reapply);
  onPrefsChange((prefs) => void services.store.settings.put('prefs', prefs).catch(() => undefined));
}

function rememberRoute(services: Services): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = location.hash;
  subscribe((state, prev) => {
    if (state.app.route === prev.app.route) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (location.hash === last) return;
      last = location.hash;
      void services.store.settings.put('lastRoute', last).catch(() => undefined);
    }, 1000);
  });
}

function unlockOnFirstGesture(): void {
  const unlock = () => {
    unlockUiSounds();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

async function boot(): Promise<void> {
  const services = await createServices();
  setServices(services);
  startFilesUpkeep();
  const [prefs, lastRoute] = await Promise.all([
    services.store.settings.get('prefs').catch(() => null),
    services.store.settings.get('lastRoute').catch(() => null),
  ]);
  if (prefs) loadPrefs(readPrefs(prefs));
  watchPrefs(services);
  watchLayout();
  initRouter(services, { lastRoute });
  rememberRoute(services);
  installGlobalKeys();
  unlockOnFirstGesture();
  if (services.store.mode === 'memory') void refreshLibrary(services.store);
  void resolveAiConfig()
    .then((ai) => setConfig({ ai }))
    .catch(() => undefined);

  // The editor's test hook (§10.2), in dev builds only. The art and rig barrels load lazily (their
  // engines belong in the Desk's chunks, not the first one).
  if (import.meta.env.DEV) {
    const [{ ART_CORE }, { RIG_CORE }] = await Promise.all([import('./cores/art'), import('./cores/rig')]);
    (window as unknown as { __amble: unknown }).__amble = {
      services,
      store: services.store,
      getState,
      setState,
      setPrefs,
      navigate,
      route: () => getState().app.route,
      /** Which core barrels are real ('stub' until the core merges). */
      cores: { art: ART_CORE, rig: RIG_CORE, play: PLAYER_CORE, ai: AI_CORE },
    };
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Amble needs a #root element.');
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <App />
      </ServicesProvider>
    </StrictMode>,
  );
  if (import.meta.env.PROD) registerServiceWorker();
}

void boot();
