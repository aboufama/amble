/**
 * The hub: games people share, for everyone to open, play and remix.
 *
 *   GET    /api/hub                 the shared games, newest first ({ projects: HubEntry[] })
 *   POST   /api/hub                 share a game (multipart: project = the .amble file gzipped,
 *                                   thumb = a JPEG of its stage, title, author, about); answers
 *                                   { id, key }: the key lets this browser update or remove it
 *   GET    /api/hub/<id>            the game (gzipped .amble)
 *   GET    /api/hub/<id>/thumb      its picture
 *   PUT    /api/hub/<id>            update it (same form as sharing; header x-amble-key)
 *   DELETE /api/hub/<id>            remove it (header x-amble-key, or the hub's admin key)
 *   POST   /api/hub/<id>/report     someone says it shouldn't be here: three reports hide it
 *
 * On Vercel the files live in Vercel Blob (BLOB_READ_WRITE_TOKEN, set by connecting a Blob store
 * to the project); on your computer, in the `.hub` folder. Without either there is no hub, and
 * GET /api/hub says so (503).
 *
 * Self-contained on purpose (no local imports), so Vercel can bundle it as it is.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/** What the hub lists for each game. */
export interface HubEntry {
  id: string;
  title: string;
  /** A first name or nickname, or "". */
  author: string;
  /** How to play, or what it is, in a line. */
  about: string;
  createdAt: number;
  updatedAt: number;
}

/** What the index keeps besides (never sent to the page). */
interface IndexEntry extends HubEntry {
  keyHash: string;
  reports: string[];
  hidden: boolean;
}

interface HubIndex {
  projects: IndexEntry[];
}

/** Where the hub keeps its files. */
export interface HubStore {
  read(name: string): Promise<{ body: Uint8Array; etag: string } | null>;
  /** With `ifMatch`, writes only if the file is still that version (else throws a StaleError). */
  write(name: string, body: Uint8Array, contentType: string, ifMatch?: string): Promise<void>;
  remove(names: string[]): Promise<void>;
}

export class StaleError extends Error {}

export interface HubOptions {
  store: HubStore | null;
  /** A public site: shares only from its own page, and a limit per visitor. */
  hosted: boolean;
  /** Largest gzipped game, in bytes (Vercel takes request bodies up to 4.5 MB). */
  maxProjectBytes: number;
  maxThumbBytes: number;
  /** Shares and reports per visitor (by IP) per hour, hosted mode; 0 turns it off. */
  shareLimit: number;
  /** AMBLE_HUB_ADMIN_KEY: removes any game (to take down one that shouldn't be there). */
  adminKey: string;
  now?: () => number;
}

const INDEX = 'hub/index.json';
const projectFile = (id: string) => `hub/projects/${id}.amble.gz`;
const thumbFile = (id: string) => `hub/thumbs/${id}.jpg`;
const REPORTS_TO_HIDE = 3;
const MAX_LISTED = 300;

/** The hub's files in Vercel Blob. */
export function blobStore(token: string, access: 'public' | 'private' = 'public'): HubStore {
  const blob = () => import('@vercel/blob');
  return {
    async read(name) {
      const { get } = await blob();
      const r = await get(name, { access, token, useCache: false }).catch((err: Error) => {
        if (err?.name === 'BlobNotFoundError') return null;
        throw err;
      });
      if (!r || r.statusCode !== 200) return null;
      return { body: new Uint8Array(await new Response(r.stream).arrayBuffer()), etag: r.blob.etag };
    },
    async write(name, body, contentType, ifMatch) {
      const { put, BlobPreconditionFailedError } = await blob();
      try {
        await put(name, Buffer.from(body), { access, token, contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, ...(ifMatch ? { ifMatch } : {}) });
      } catch (err) {
        if (err instanceof BlobPreconditionFailedError) throw new StaleError(name);
        throw err;
      }
    },
    async remove(names) {
      const { del } = await blob();
      await del(names, { token }).catch(() => undefined);
    },
  };
}

/** The hub's files in a folder (the dev server on your computer). */
export function folderStore(dir: string): HubStore {
  const file = (name: string) => path.join(dir, ...name.split('/'));
  const tag = (body: Uint8Array) => createHash('sha1').update(body).digest('hex');
  return {
    async read(name) {
      try {
        const body = new Uint8Array(await readFile(file(name)));
        return { body, etag: tag(body) };
      } catch {
        return null;
      }
    },
    async write(name, body, _type, ifMatch) {
      if (ifMatch) {
        const now = await this.read(name);
        if (now && now.etag !== ifMatch) throw new StaleError(name);
      }
      await mkdir(path.dirname(file(name)), { recursive: true });
      await writeFile(file(name), body);
    },
    async remove(names) {
      await Promise.all(names.map((n) => rm(file(n), { force: true })));
    },
  };
}

/** A store that keeps everything in memory (tests). */
export function memoryStore(): HubStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  let version = 0;
  const tags = new Map<string, string>();
  return {
    files,
    async read(name) {
      const body = files.get(name);
      return body ? { body, etag: tags.get(name)! } : null;
    },
    async write(name, body, _type, ifMatch) {
      if (ifMatch && files.has(name) && tags.get(name) !== ifMatch) throw new StaleError(name);
      files.set(name, body);
      tags.set(name, `v${++version}`);
    },
    async remove(names) {
      for (const n of names) files.delete(n);
    },
  };
}

/** Hub options from the environment: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else a folder when `folder` is given (the dev server), else no hub. */
export function hubOptions(env: Record<string, string | undefined>, hosted: boolean, folder?: string): HubOptions {
  const token = (env.BLOB_READ_WRITE_TOKEN ?? '').trim();
  const access = env.AMBLE_HUB_ACCESS === 'private' ? 'private' : 'public';
  return {
    store: token ? blobStore(token, access) : folder ? folderStore(folder) : null,
    hosted,
    maxProjectBytes: 4_000_000,
    maxThumbBytes: 200_000,
    shareLimit: hosted ? 12 : 0,
    adminKey: (env.AMBLE_HUB_ADMIN_KEY ?? '').trim(),
  };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}

const fail = (status: number, message: string) => json(status, { error: { message } });

/** The request came from the site's own page (same origin, from a browser). */
function isOwnPage(request: Request): boolean {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return Boolean(site || origin);
}

const visitorOf = (request: Request) => (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
const hits = new Map<string, number[]>();

function limited(request: Request, opts: HubOptions): boolean {
  if (opts.shareLimit <= 0) return false;
  const who = visitorOf(request);
  const now = (opts.now ?? Date.now)();
  const recent = (hits.get(who) ?? []).filter((t) => now - t < 3_600_000);
  if (hits.size > 5000) hits.clear();
  const over = recent.length >= opts.shareLimit;
  if (!over) recent.push(now);
  hits.set(who, recent);
  return over;
}

/** For tests: forget who shared what when. */
export function resetHubLimits(): void {
  hits.clear();
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const newId = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);

/** One line of plain text: no control characters, trimmed, at most `max` characters. */
function line(v: FormDataEntryValue | null, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

async function readIndex(store: HubStore): Promise<{ index: HubIndex; etag?: string }> {
  const r = await store.read(INDEX);
  if (!r) return { index: { projects: [] } };
  try {
    const index = JSON.parse(new TextDecoder().decode(r.body)) as HubIndex;
    return { index: Array.isArray(index.projects) ? index : { projects: [] }, etag: r.etag };
  } catch {
    return { index: { projects: [] }, etag: r.etag };
  }
}

/** Changes the index, again on a fresh copy if someone else changed it meanwhile. */
async function updateIndex<T>(store: HubStore, change: (index: HubIndex) => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { index, etag } = await readIndex(store);
    const out = change(index);
    try {
      await store.write(INDEX, new TextEncoder().encode(JSON.stringify(index)), 'application/json', etag);
      return out;
    } catch (err) {
      if (!(err instanceof StaleError) || attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 160));
    }
  }
}

const listed = (e: IndexEntry): HubEntry => ({ id: e.id, title: e.title, author: e.author, about: e.about, createdAt: e.createdAt, updatedAt: e.updatedAt });

/** Reads and checks a shared game: a gzipped .amble file. */
async function readForm(request: Request, opts: HubOptions): Promise<{ project: Uint8Array; thumb: Uint8Array | null; title: string; author: string; about: string } | Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Send the game as a form.');
  }
  const file = form.get('project');
  if (!file || typeof file === 'string') return fail(400, 'The game is missing.');
  if (file.size > opts.maxProjectBytes) return fail(413, 'This game is too big to share (its pictures and sounds take up too much room).');
  const project = new Uint8Array(await file.arrayBuffer());
  let parsed: { format?: unknown; stage?: unknown; sprites?: unknown; title?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(gunzipSync(project, { maxOutputLength: 60_000_000 })));
  } catch {
    return fail(400, "That isn't an Amble game.");
  }
  if (!parsed || parsed.format !== 'amble' || !parsed.stage || !Array.isArray(parsed.sprites)) return fail(400, "That isn't an Amble game.");
  const t = form.get('thumb');
  let thumb: Uint8Array | null = null;
  if (t && typeof t !== 'string' && t.size > 0) {
    if (t.size > opts.maxThumbBytes) return fail(413, 'The picture is too big.');
    thumb = new Uint8Array(await t.arrayBuffer());
    if (thumb[0] !== 0xff || thumb[1] !== 0xd8) return fail(400, 'The picture must be a JPEG.');
  }
  const title = line(form.get('title'), 60) || line(typeof parsed.title === 'string' ? parsed.title : null, 60) || 'Untitled game';
  return { project, thumb, title, author: line(form.get('author'), 24), about: line(form.get('about'), 200) };
}

async function share(request: Request, opts: HubOptions, store: HubStore): Promise<Response> {
  const form = await readForm(request, opts);
  if (form instanceof Response) return form;
  const id = newId();
  const key = randomBytes(18).toString('base64url');
  await store.write(projectFile(id), form.project, 'application/gzip');
  if (form.thumb) await store.write(thumbFile(id), form.thumb, 'image/jpeg');
  const now = (opts.now ?? Date.now)();
  await updateIndex(store, (index) => {
    index.projects.unshift({ id, title: form.title, author: form.author, about: form.about, createdAt: now, updatedAt: now, keyHash: hash(key), reports: [], hidden: false });
  });
  return json(201, { id, key });
}

async function update(request: Request, id: string, opts: HubOptions, store: HubStore): Promise<Response> {
  const key = request.headers.get('x-amble-key') ?? '';
  const { index } = await readIndex(store);
  const entry = index.projects.find((p) => p.id === id);
  if (!entry) return fail(404, 'That game is no longer in the hub.');
  if (!key || hash(key) !== entry.keyHash) return fail(403, 'Only the browser that shared this game can change it.');
  const form = await readForm(request, opts);
  if (form instanceof Response) return form;
  await store.write(projectFile(id), form.project, 'application/gzip');
  if (form.thumb) await store.write(thumbFile(id), form.thumb, 'image/jpeg');
  const now = (opts.now ?? Date.now)();
  await updateIndex(store, (ix) => {
    const e = ix.projects.find((p) => p.id === id);
    if (e) Object.assign(e, { title: form.title, author: form.author, about: form.about, updatedAt: now });
  });
  return json(200, { id });
}

async function remove(request: Request, id: string, opts: HubOptions, store: HubStore): Promise<Response> {
  const key = request.headers.get('x-amble-key') ?? '';
  const admin = Boolean(opts.adminKey) && request.headers.get('x-amble-admin') === opts.adminKey;
  const { index } = await readIndex(store);
  const entry = index.projects.find((p) => p.id === id);
  if (!entry) return json(200, { removed: false });
  if (!admin && (!key || hash(key) !== entry.keyHash)) return fail(403, 'Only the browser that shared this game can remove it.');
  await updateIndex(store, (ix) => {
    ix.projects = ix.projects.filter((p) => p.id !== id);
  });
  await store.remove([projectFile(id), thumbFile(id)]);
  return json(200, { removed: true });
}

async function report(request: Request, id: string, opts: HubOptions, store: HubStore): Promise<Response> {
  const who = hash(`report:${visitorOf(request)}`).slice(0, 16);
  const hidden = await updateIndex(store, (ix) => {
    const e = ix.projects.find((p) => p.id === id);
    if (!e) return false;
    if (!e.reports.includes(who)) e.reports.push(who);
    if (e.reports.length >= REPORTS_TO_HIDE) e.hidden = true;
    return e.hidden;
  });
  return json(200, { hidden });
}

/** The part of the address after /api/hub ("", "<id>", "<id>/thumb", "<id>/report"), or null if it isn't the hub's. */
export function hubPath(request: Request): string | null {
  const url = new URL(request.url);
  const q = url.searchParams.get('path');
  if (q !== null && url.pathname.replace(/\/+$/, '') === '/api/hub') return q.replace(/^\/+|\/+$/g, '');
  const m = /^\/api\/hub(?:\/(.*))?$/.exec(url.pathname);
  return m ? (m[1] ?? '').replace(/\/+$/, '') : null;
}

export async function handleHubApi(request: Request, opts: HubOptions): Promise<Response> {
  const route = hubPath(request);
  if (route === null) return fail(404, 'Not found.');
  const store = opts.store;
  if (!store) return fail(503, "This site doesn't have a hub yet.");
  const [id, part, ...rest] = route ? route.split('/') : [];
  if (rest.length || (id !== undefined && !/^[A-Za-z0-9]{6,16}$/.test(id))) return fail(404, 'Not found.');
  const method = request.method;
  const writes = method !== 'GET' && method !== 'HEAD';
  // Writes come from the site's own page: a header another site can't send without asking first, and (hosted) the page's own origin.
  // The admin (taking a game down with curl) has the hub's admin key instead of a page.
  const admin = Boolean(opts.adminKey) && request.headers.get('x-amble-admin') === opts.adminKey;
  if (writes && (request.headers.get('x-amble-hub') !== '1' || (opts.hosted && !isOwnPage(request) && !admin))) return fail(403, 'Not allowed.');
  try {
    if (!id) {
      if (method === 'GET') {
        const { index } = await readIndex(store);
        const projects = index.projects.filter((p) => !p.hidden).slice(0, MAX_LISTED).map(listed);
        return json(200, { projects }, { 'cache-control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=30' });
      }
      if (method === 'POST') {
        if (limited(request, opts)) return fail(429, 'Lots of games shared from here in the last hour. Try again later.');
        return await share(request, opts, store);
      }
      return fail(405, 'Use GET or POST.');
    }
    if (part === 'thumb' && method === 'GET') {
      const r = await store.read(thumbFile(id));
      if (!r) return fail(404, 'No picture.');
      return new Response(Buffer.from(r.body), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=60, s-maxage=300' } });
    }
    if (part === 'report' && method === 'POST') {
      if (limited(request, opts)) return fail(429, 'Lots of reports from here in the last hour. Try again later.');
      return await report(request, id, opts, store);
    }
    if (part) return fail(404, 'Not found.');
    if (method === 'GET') {
      const { index } = await readIndex(store);
      if (!index.projects.some((p) => p.id === id && !p.hidden)) return fail(404, 'That game is no longer in the hub.');
      const r = await store.read(projectFile(id));
      if (!r) return fail(404, 'That game is no longer in the hub.');
      return new Response(Buffer.from(r.body), { headers: { 'content-type': 'application/gzip', 'cache-control': 'public, max-age=0, s-maxage=30' } });
    }
    if (method === 'PUT') return await update(request, id, opts, store);
    if (method === 'DELETE') return await remove(request, id, opts, store);
    return fail(405, 'Use GET, PUT or DELETE.');
  } catch (err) {
    return fail(502, `The hub's storage didn't answer: ${(err as Error).message}`);
  }
}

// The Vercel function (Web standard `fetch` export, Node.js runtime).
export default {
  fetch(request: Request): Promise<Response> {
    return handleHubApi(request, hubOptions(process.env, true));
  },
};
