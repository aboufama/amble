/**
 * The hub, from the page: the games people shared (api/hub.ts), sharing one, opening one, and the
 * links that open a game straight away (#play/<id>, or #play/demo-<id> for a demo).
 */
import { isProject } from '../project/persistence';
import { migrateProject } from '../project/migrate';
import type { Project } from '../project/types';

export interface HubEntry {
  id: string;
  title: string;
  author: string;
  about: string;
  createdAt: number;
  updatedAt: number;
}

/** The hub's games, or why there are none to show ("off": this site has no hub). */
export type HubList = { ok: true; projects: HubEntry[] } | { ok: false; reason: 'off' | 'offline' };

export async function listHub(): Promise<HubList> {
  try {
    const res = await fetch('/api/hub', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return { ok: false, reason: res.status === 503 || res.status === 404 ? 'off' : 'offline' };
    const body = (await res.json()) as { projects?: HubEntry[] };
    return { ok: true, projects: Array.isArray(body.projects) ? body.projects : [] };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

async function errorOf(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return new Error(body.error?.message || fallback);
  } catch {
    return new Error(fallback);
  }
}

/** A game from the hub, ready for the editor. */
export async function openHubProject(id: string): Promise<Project> {
  const res = await fetch(`/api/hub/${encodeURIComponent(id)}`);
  if (!res.ok) throw await errorOf(res, "That game couldn't be opened.");
  const text = await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).text();
  const data = JSON.parse(text) as unknown;
  if (!isProject(data)) throw new Error("That game couldn't be opened.");
  return migrateProject(data);
}

const SHARED = 'amble:shared';
const AUTHOR = 'amble:author';

/** The games this browser shared: hub id → its key (to update or remove it) and the project it came from. */
export interface MyShare {
  key: string;
  projectId: string;
  title: string;
}

export function myShares(): Record<string, MyShare> {
  try {
    const v = JSON.parse(localStorage.getItem(SHARED) ?? '{}') as Record<string, MyShare>;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveShares(all: Record<string, MyShare>): void {
  try {
    localStorage.setItem(SHARED, JSON.stringify(all));
  } catch {
    /* private window: the share works, it just can't be changed from here later */
  }
}

/** This project's game in the hub, if this browser shared it. */
export function shareOf(projectId: string): { id: string; share: MyShare } | null {
  const hit = Object.entries(myShares()).find(([, s]) => s.projectId === projectId);
  return hit ? { id: hit[0], share: hit[1] } : null;
}

export function savedAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR) ?? '';
  } catch {
    return '';
  }
}

export interface ShareDetails {
  title: string;
  author: string;
  about: string;
  /** A JPEG of the stage, as a data URL. */
  thumb: string | null;
}

/** Shares the game (or updates the copy this browser shared before). Returns its hub id. */
export async function shareToHub(project: Project, details: ShareDetails, update?: string): Promise<string> {
  const form = new FormData();
  const gz = await new Response(new Blob([JSON.stringify(project)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  form.append('project', gz, 'game.amble.gz');
  if (details.thumb) form.append('thumb', await (await fetch(details.thumb)).blob(), 'thumb.jpg');
  form.append('title', details.title);
  form.append('author', details.author);
  form.append('about', details.about);
  const mine = update ? myShares()[update] : undefined;
  const res = await fetch(mine ? `/api/hub/${encodeURIComponent(update!)}` : '/api/hub', {
    method: mine ? 'PUT' : 'POST',
    headers: mine ? { 'x-amble-hub': '1', 'x-amble-key': mine.key } : { 'x-amble-hub': '1' },
    body: form,
  });
  if (!res.ok) throw await errorOf(res, res.status === 503 || res.status === 404 ? "This site doesn't have a hub yet." : "The game couldn't be shared. Try again in a moment.");
  const body = (await res.json()) as { id: string; key?: string };
  const all = myShares();
  all[body.id] = { key: body.key ?? mine!.key, projectId: project.id, title: details.title };
  saveShares(all);
  try {
    localStorage.setItem(AUTHOR, details.author);
  } catch {
    /* ignore */
  }
  return body.id;
}

export async function removeFromHub(id: string): Promise<void> {
  const mine = myShares()[id];
  if (!mine) throw new Error('Only the browser that shared this game can remove it.');
  const res = await fetch(`/api/hub/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-amble-hub': '1', 'x-amble-key': mine.key } });
  if (!res.ok) throw await errorOf(res, "The game couldn't be removed.");
  const all = myShares();
  delete all[id];
  saveShares(all);
}

export async function reportHub(id: string): Promise<void> {
  const res = await fetch(`/api/hub/${encodeURIComponent(id)}/report`, { method: 'POST', headers: { 'x-amble-hub': '1' } });
  if (!res.ok) throw await errorOf(res, "The report didn't go through.");
}

export const thumbUrl = (id: string) => `/api/hub/${encodeURIComponent(id)}/thumb`;

/** The link that opens a hub game (or a demo: "demo-<id>") in Amble and plays it. */
export function playLink(id: string): string {
  return `${window.location.origin}${window.location.pathname}#play/${encodeURIComponent(id)}`;
}

/** What a page address asks to open: a hub game or a demo. */
export function linkTarget(hash: string): { kind: 'hub' | 'demo'; id: string } | null {
  const m = /^#play\/([\w-]{1,64})$/.exec(hash);
  if (!m) return null;
  return m[1].startsWith('demo-') ? { kind: 'demo', id: m[1].slice(5) } : { kind: 'hub', id: m[1] };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A picture for a game whose stage can't be pictured: its name on Amble's purple card. */
export function titleCard(title: string): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const grad = g.createLinearGradient(0, 0, 480, 360);
    grad.addColorStop(0, 'hsl(250, 55%, 40%)');
    grad.addColorStop(1, 'hsl(300, 50%, 48%)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 480, 360);
    g.fillStyle = 'white';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 40px "Trebuchet MS", "Helvetica Neue", Arial, sans-serif';
    // Wrap the name onto up to three lines.
    const lines: string[] = [];
    let current = '';
    for (const word of (title || 'My game').split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (g.measureText(next).width > 400 && current) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    const shown = lines.slice(0, 3);
    shown.forEach((l, i) => g.fillText(l, 240, 180 + (i - (shown.length - 1) / 2) * 48, 440));
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}
