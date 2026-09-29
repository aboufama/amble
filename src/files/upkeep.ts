/**
 * Storage upkeep for the whole app (§4.3, §4.4, §2.16), started once when the services exist:
 * - the Trail's index follows every commit; write health becomes `library.storage` ('full' shows the
 *   out-of-space toast once, with Save to Drive);
 * - files dropped on the Trail and files the installed app is asked to open go to the open flow;
 * - after the first paint: a crash's draft brings the student back to the drawing ("Welcome back. Your
 *   drawing is safe."), a discarded tab says "Welcome back. Everything was saved.";
 * - the old-Amble check, the space watch (the 80 % chip), the first launch after an update;
 * - once a day at idle, 30 s after boot: Lost and found past 30 days is purged, then the blob GC;
 * - in files-only mode and on shared Chromebooks: "Save to Drive before the bell?" nudges, and the
 *   browser's leave prompt while a world has changes no file holds.
 */
import { navigate } from '../app/router';
import type { Route } from '../app/routes';
import { getServices, type Services } from '../app/services';
import { t } from '../i18n';
import { KEEP } from '../model/limits';
import type { WorldId } from '../model/types';
import { installLaunchQueue } from '../pwa/launch';
import { BUILD_ID } from '../pwa/register';
import { announce, showToast } from '../state/app';
import { refreshLibrary, setLegacy, setSpace, setStorageState, setUpdated } from '../state/library';
import { getState } from '../state/store';
import { upkeepOf, type Store, type StoreHealth } from '../store/api';
import { gcDue, GC_DELAY_MS, GC_LAST_KEY } from '../store/gc';
import { installFileDrop } from './drop';
import { openItems } from './open';
import { onSavedToFile } from './saved';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let started = false;

/** Starts the upkeep once the app's services exist (called at boot; later calls do nothing). */
export function startFilesUpkeep(): void {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  void servicesReady()
    .then(run)
    .catch((err: unknown) => console.warn('Storage upkeep did not start:', err));
}

function servicesReady(timeoutMs = 30_000): Promise<Services> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        resolve(getServices());
      } catch (err) {
        if (Date.now() - t0 > timeoutMs) reject(err);
        else setTimeout(tick, 25);
      }
    };
    tick();
  });
}

function afterFirstPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function whenIdle(fn: () => void, timeout = 5000): void {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, 0);
}

/** Saves the open world to Drive from a toast's button (the click is the gesture the picker needs). */
async function saveOpenWorld(): Promise<void> {
  const { files, store } = getServices();
  const open = getState().session.world;
  // The session's copy is the newest: when the store is full it is the only one with the latest changes.
  const stored = open ? await store.worlds.get(open.id).catch(() => null) : null;
  const world = open && (!stored || open.updatedAt >= stored.updatedAt) ? open : stored;
  if (!world) {
    navigate({ name: 'settings', section: 'storage' });
    return;
  }
  try {
    const saved = await files.saveWorld(world);
    if (saved) showToast(saved.method === 'download' ? t('files.savedDownload') : t('files.savedToFile', { name: saved.name }), { kind: 'success' });
  } catch {
    showToast(t('files.saveFailed'), { kind: 'error' });
  }
}

/** Write health → `library.storage`: 'full' shows the out-of-space toast once; the next landed write clears it. */
export function watchHealth(store: Store): void {
  const upkeep = upkeepOf(store);
  if (!upkeep) return;
  let last: StoreHealth = upkeep.health();
  if (last === 'full') setStorageState('full');
  upkeep.onHealth((h) => {
    if (h === 'full') {
      setStorageState('full');
      if (last !== 'full') {
        const inWorld = getState().session.world !== null;
        showToast(t('files.autosaveQuota'), {
          kind: 'error',
          action: inWorld ? { label: t('files.saveToDrive'), run: () => void saveOpenWorld() } : { label: t('files.tidyUp'), run: () => navigate({ name: 'settings', section: 'storage' }) },
        });
        announce(t('files.autosaveQuota'), 'assertive');
      }
    } else if (h === 'ok' && getState().library.storage === 'full') {
      setStorageState('ok');
      showToast(t('files.autosaveBack'), { kind: 'success' });
    }
    last = h;
  });
}

const RESTORED_KEY = 'restore:last';

async function checkRestore(store: Store): Promise<void> {
  const discarded = (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;
  let drafts: Awaited<ReturnType<Store['drafts']['list']>> = [];
  try {
    drafts = await store.drafts.list();
  } catch {
    drafts = [];
  }
  const shown = await store.cache.get<string>(RESTORED_KEY).catch(() => null);
  for (const d of drafts) {
    if (Date.now() - d.at > 7 * DAY) continue;
    const rec = await store.art.get(d.artId).catch(() => null);
    if (rec && rec.updatedAt >= d.at) continue;
    const mark = `${d.artId}:${d.at}`;
    if (shown === mark) break;
    await store.cache.put(RESTORED_KEY, mark).catch(() => undefined);
    const route = getState().app.route;
    const landing = route.name === 'home' || route.name === 'trail' || route.name === 'first';
    const worldOk = d.worldId && d.castKey ? (await store.worlds.get(d.worldId).catch(() => null)) !== null : false;
    const desk: Route = worldOk && d.worldId && d.castKey ? { name: 'draw', worldId: d.worldId, key: d.castKey } : { name: 'drawFree', artId: d.artId };
    if (landing) navigate(desk);
    showToast(t('files.drawingSafe'), { kind: 'success' });
    return;
  }
  if (discarded) showToast(t('files.welcomeBack'), { kind: 'success' });
}

async function detectLegacy(services: Services): Promise<void> {
  try {
    const found = await services.files.legacy.find();
    if (found) setLegacy(found);
  } catch (err) {
    console.warn('The old Amble check failed:', err);
  }
}

function watchSpace(store: Store): void {
  let busy = false;
  let lastAt = 0;
  const check = async () => {
    if (busy) return;
    busy = true;
    lastAt = Date.now();
    try {
      setSpace(await store.estimate());
    } catch {
      // No estimate here (files-only mode, an old browser): no chip.
    } finally {
      busy = false;
    }
  };
  void check();
  setInterval(() => void check(), 5 * MINUTE);
  store.onChange(() => {
    if (Date.now() - lastAt > MINUTE) void check();
  });
}

async function noteBuild(store: Store): Promise<void> {
  try {
    const last = await store.cache.get<string>('pwa:build');
    if (last && last !== BUILD_ID) setUpdated(true);
    if (last !== BUILD_ID) await store.cache.put('pwa:build', BUILD_ID);
  } catch {
    // Nothing to compare with: no chip.
  }
}

/** Lost and found keeps a world 30 days (§2.4); then it goes, with its footsteps. */
export async function purgeExpired(store: Store, now = Date.now()): Promise<number> {
  const cutoff = now - KEEP.lostAndFoundDays * DAY;
  let n = 0;
  for (const m of await store.worlds.list()) {
    if (m.putAwayAt !== null && m.putAwayAt < cutoff) {
      await store.worlds.purge(m.id);
      n++;
    }
  }
  return n;
}

/** The daily tidy: expired Lost and found, then unreferenced blobs. Resolves true when it ran. */
export async function dailyTidy(store: Store, now = Date.now()): Promise<boolean> {
  const upkeep = upkeepOf(store);
  if (!upkeep || store.mode !== 'idb') return false;
  const last = await store.cache.get<number>(GC_LAST_KEY).catch(() => null);
  if (!gcDue(last, now)) return false;
  await purgeExpired(store, now);
  await upkeep.collectGarbage({ now });
  await store.cache.put(GC_LAST_KEY, now);
  return true;
}

function scheduleTidy(store: Store): void {
  setTimeout(() => whenIdle(() => void dailyTidy(store).catch((err: unknown) => console.warn('The daily tidy did not finish:', err))), GC_DELAY_MS);
}

function installNudges(store: Store): void {
  const filesOnly = store.mode === 'memory';
  const shared = () => getState().config.shared;
  const dirty = new Set<WorldId>();
  store.onChange((e) => {
    for (const id of e.worlds ?? []) dirty.add(id);
  });
  onSavedToFile((id) => dirty.delete(id));
  setInterval(
    () => {
      if (!(filesOnly || shared()) || !dirty.size || document.visibilityState !== 'visible') return;
      const inWorld = getState().session.world !== null;
      showToast(t('files.nudge'), inWorld ? { action: { label: t('files.saveToDrive'), run: () => void saveOpenWorld() } } : {});
    },
    filesOnly ? 10 * MINUTE : 30 * MINUTE,
  );
  window.addEventListener('beforeunload', (e) => {
    if (!(filesOnly || shared()) || !dirty.size) return;
    // The one native prompt allowed (§2.16): work that only this tab holds.
    e.preventDefault();
    e.returnValue = '';
  });
}

async function run(services: Services): Promise<void> {
  const { store } = services;
  store.onChange(() => void refreshLibrary(store));
  if (store.mode === 'memory') setStorageState('blocked');
  watchHealth(store);
  installFileDrop((items) => openItems(items));
  installLaunchQueue((items) => openItems(items));
  installNudges(store);
  await afterFirstPaint();
  await checkRestore(store).catch((err: unknown) => console.warn('The restore check failed:', err));
  void detectLegacy(services);
  watchSpace(store);
  void noteBuild(store);
  scheduleTidy(store);
}
