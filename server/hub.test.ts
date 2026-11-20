import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleHubApi, hubPath, memoryStore, resetHubLimits, type HubOptions } from '../api/hub.ts';

const SITE = 'https://amble.example';
const game = (title = 'Slime Towers') => gzipSync(JSON.stringify({ format: 'amble', version: 1, id: 'p1', title, mode: '2d', stage: {}, sprites: [], compiled: null }));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function options(over: Partial<HubOptions> = {}) {
  const store = memoryStore();
  const opts: HubOptions = { store, hosted: true, maxProjectBytes: 4_000_000, maxThumbBytes: 200_000, shareLimit: 12, adminKey: 'admin-secret', ...over };
  return { store, opts };
}

function form(fields: Record<string, string | Uint8Array>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') f.append(k, v);
    else f.append(k, new Blob([v as Uint8Array<ArrayBuffer>]), k);
  }
  return f;
}

/** A request from the site's own page. */
const own = (route: string, init: RequestInit = {}) => new Request(`${SITE}/api/hub${route}`, { ...init, headers: { origin: SITE, 'sec-fetch-site': 'same-origin', 'x-amble-hub': '1', 'x-forwarded-for': '1.2.3.4', ...(init.headers as Record<string, string>) } });

beforeEach(() => resetHubLimits());

describe('the hub', () => {
  it('shares a game, lists it, and hands it and its picture back', async () => {
    const { opts } = options();
    const res = await handleHubApi(own('', { method: 'POST', body: form({ project: game(), thumb: JPEG, title: '  Slime\nTowers ', author: 'Andre', about: 'Place towers, stop slimes' }) }), opts);
    expect(res.status).toBe(201);
    const { id, key } = await res.json();
    expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(key.length).toBeGreaterThan(16);

    const list = await (await handleHubApi(new Request(`${SITE}/api/hub`), opts)).json();
    expect(list.projects).toEqual([expect.objectContaining({ id, title: 'Slime Towers', author: 'Andre', about: 'Place towers, stop slimes' })]);
    // The key's hash stays on the server.
    expect(JSON.stringify(list)).not.toMatch(/keyHash|reports/);

    const got = await handleHubApi(new Request(`${SITE}/api/hub/${id}`), opts);
    expect(got.headers.get('content-type')).toBe('application/gzip');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array(game()));
    const thumb = await handleHubApi(new Request(`${SITE}/api/hub/${id}/thumb`), opts);
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(JPEG);
  });

  it('lets only the browser that shared a game change or remove it (or the admin)', async () => {
    const { opts } = options();
    const { id, key } = await (await handleHubApi(own('', { method: 'POST', body: form({ project: game() }) }), opts)).json();
    const put = (k: string, title: string) => handleHubApi(own(`/${id}`, { method: 'PUT', headers: { 'x-amble-key': k }, body: form({ project: game(title), title }) }), opts);
    expect((await put('wrong', 'Mine now')).status).toBe(403);
    expect((await put(key, 'Slime Towers 2')).status).toBe(200);
    const list = await (await handleHubApi(new Request(`${SITE}/api/hub`), opts)).json();
    expect(list.projects[0].title).toBe('Slime Towers 2');

    expect((await handleHubApi(own(`/${id}`, { method: 'DELETE', headers: { 'x-amble-key': 'wrong' } }), opts)).status).toBe(403);
    expect((await handleHubApi(own(`/${id}`, { method: 'DELETE', headers: { 'x-amble-key': key } }), opts)).status).toBe(200);
    expect((await (await handleHubApi(new Request(`${SITE}/api/hub`), opts)).json()).projects).toEqual([]);
    expect((await handleHubApi(new Request(`${SITE}/api/hub/${id}`), opts)).status).toBe(404);

    const other = await (await handleHubApi(own('', { method: 'POST', body: form({ project: game() }) }), opts)).json();
    // The admin takes one down from outside the page (curl): no origin, just the header and the key.
    const curl = new Request(`${SITE}/api/hub/${other.id}`, { method: 'DELETE', headers: { 'x-amble-hub': '1', 'x-amble-admin': 'admin-secret' } });
    expect((await handleHubApi(curl, opts)).status).toBe(200);
    expect((await (await handleHubApi(new Request(`${SITE}/api/hub`), opts)).json()).projects).toEqual([]);
  });

  it('hides a game three people report', async () => {
    const { opts } = options();
    const { id } = await (await handleHubApi(own('', { method: 'POST', body: form({ project: game() }) }), opts)).json();
    const report = (ip: string) => handleHubApi(own(`/${id}/report`, { method: 'POST', headers: { 'x-forwarded-for': ip } }), opts).then((r) => r.json());
    expect(await report('9.9.9.1')).toEqual({ hidden: false });
    expect(await report('9.9.9.1')).toEqual({ hidden: false }); // the same person twice counts once
    expect(await report('9.9.9.2')).toEqual({ hidden: false });
    expect(await report('9.9.9.3')).toEqual({ hidden: true });
    expect((await (await handleHubApi(new Request(`${SITE}/api/hub`), opts)).json()).projects).toEqual([]);
    expect((await handleHubApi(new Request(`${SITE}/api/hub/${id}`), opts)).status).toBe(404);
  });

  it("turns down what isn't a game, a picture that isn't a JPEG, other sites, and too many shares", async () => {
    const { opts } = options();
    const post = (body: FormData, headers: Record<string, string> = {}) => handleHubApi(own('', { method: 'POST', body, headers }), opts);
    expect((await post(form({ project: gzipSync('{"format":"other"}') }))).status).toBe(400);
    expect((await post(form({ project: new TextEncoder().encode('not gzip') }))).status).toBe(400);
    expect((await post(form({ project: game(), thumb: new Uint8Array([1, 2, 3]) }))).status).toBe(400);
    resetHubLimits();
    opts.shareLimit = 2;
    const elsewhere = new Request(`${SITE}/api/hub`, { method: 'POST', body: form({ project: game() }), headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect((await handleHubApi(elsewhere, opts)).status).toBe(403);
    // A form posted without the page's header (another site's form) is turned down too.
    const noHeader = new Request(`${SITE}/api/hub`, { method: 'POST', body: form({ project: game() }), headers: { origin: SITE, 'sec-fetch-site': 'same-origin' } });
    expect((await handleHubApi(noHeader, { ...opts, hosted: false })).status).toBe(403);
    expect((await post(form({ project: game() }))).status).toBe(201);
    expect((await post(form({ project: game() }))).status).toBe(201);
    expect((await post(form({ project: game() }))).status).toBe(429);
    expect((await handleHubApi(own('', { method: 'POST', body: form({ project: game() }) }), { ...options({ maxProjectBytes: 10 }).opts })).status).toBe(413);
  });

  it('says when the site has no hub', async () => {
    const res = await handleHubApi(new Request(`${SITE}/api/hub`), { ...options().opts, store: null });
    expect(res.status).toBe(503);
  });

  it("reads its route from the address or Vercel's rewrite", () => {
    expect(hubPath(new Request(`${SITE}/api/hub`))).toBe('');
    expect(hubPath(new Request(`${SITE}/api/hub/abc12345/thumb`))).toBe('abc12345/thumb');
    expect(hubPath(new Request(`${SITE}/api/hub?path=abc12345`))).toBe('abc12345');
    expect(hubPath(new Request(`${SITE}/api/other`))).toBeNull();
  });
});
