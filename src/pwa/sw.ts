/**
 * Amble's service worker (§4.3, §6.1, risk 12), built by vite/swPlugin.ts into `sw.js` beside the page.
 * - Install: precaches the whole app of this build (the page, every script and style, fonts, the player,
 *   the icons), resuming where a flaky network left off and retrying each file. The first install takes
 *   over at once; an update waits for the next launch, so a lesson never changes version mid-session.
 * - After it activates, the starter worlds' files are fetched quietly in the background, so a starter
 *   plays even if the network goes before it was ever opened.
 * - Fetch: pages get the cached app; this build's files come from the cache; other same-origin files
 *   (starters) are served from the cache and refreshed behind. Other origins (the AI helper) are never
 *   touched: they go to the network as if there were no worker, and nothing is ever cached for them.
 *   Matching ignores `Vary` (hosts send `Vary: Origin`, and module scripts are requested with CORS).
 */

declare const __AMBLE_VERSION__: string;
declare const __AMBLE_PRECACHE__: string[];
declare const __AMBLE_LATER__: string[];

interface ExtendableEvt extends Event {
  waitUntil(p: Promise<unknown>): void;
}

interface FetchEvt extends ExtendableEvt {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}

interface MessageEvt extends ExtendableEvt {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
}

interface SwScope {
  readonly registration: { readonly scope: string; readonly active: object | null };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvt) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvt) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvt) => void): void;
}

const sw = self as unknown as SwScope;
const VERSION = __AMBLE_VERSION__;
const APP = `amble-app-${VERSION}`;
const RUN = `amble-run-${VERSION}`;
const SCOPE = new URL(sw.registration.scope);
const abs = (path: string) => new URL(path, SCOPE).href;
const INDEX = abs('index.html');
const PRECACHE = new Set(__AMBLE_PRECACHE__.map(abs));
const LATER = __AMBLE_LATER__.map(abs);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetches into a cache, three tries each; resumes: what is cached already is skipped. */
async function fill(cacheName: string, urls: string[], o: { required: boolean; parallel: number }): Promise<void> {
  const cache = await caches.open(cacheName);
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      if (await cache.match(url, { ignoreVary: true })) continue;
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
          if (res.ok) {
            await cache.put(url, res);
            ok = true;
          }
        } catch {
          // A dropped connection: wait, then try again.
        }
        if (!ok) await sleep(400 * (attempt + 1));
      }
      if (!ok && o.required) throw new Error(`Could not keep ${url} for offline use.`);
    }
  };
  await Promise.all(Array.from({ length: o.parallel }, worker));
}

sw.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      await fill(APP, [...PRECACHE], { required: true, parallel: 4 });
      if (!sw.registration.active) await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keep = new Set([APP, RUN]);
      for (const key of await caches.keys()) if (key.startsWith('amble-') && !keep.has(key)) await caches.delete(key);
      await sw.clients.claim();
      // The starters come later, quietly; failures only mean "on first use" instead.
      void fill(RUN, LATER, { required: false, parallel: 2 }).catch(() => undefined);
    })(),
  );
});

async function page(req: Request): Promise<Response> {
  const hit = await caches.match(INDEX, { cacheName: APP, ignoreVary: true, ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch {
    return new Response('<!doctype html><title>Amble</title><p>Amble needs the internet once to get ready. Try again when you are online.</p>', {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}

async function fromApp(req: Request): Promise<Response> {
  const cache = await caches.open(APP);
  const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') await cache.put(req, res.clone());
  return res;
}

async function fromRuntime(e: FetchEvt): Promise<Response> {
  const cache = await caches.open(RUN);
  const hit = await cache.match(e.request, { ignoreVary: true });
  const fresh = fetch(e.request).then(async (res) => {
    if (res.ok && res.type === 'basic') await cache.put(e.request, res.clone());
    return res;
  });
  if (hit) {
    e.waitUntil(fresh.catch(() => undefined));
    return hit;
  }
  return fresh;
}

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.href.startsWith(SCOPE.href)) return;
  if (url.pathname.slice(SCOPE.pathname.length).startsWith('api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(page(req));
    return;
  }
  const bare = url.origin + url.pathname;
  e.respondWith(PRECACHE.has(bare) ? fromApp(req) : fromRuntime(e));
});

sw.addEventListener('message', (e) => {
  const type = (e.data as { type?: unknown } | null)?.type;
  if (type === 'skip-waiting') e.waitUntil(sw.skipWaiting());
  else if (type === 'version') e.ports[0]?.postMessage({ version: VERSION });
});

export {};
