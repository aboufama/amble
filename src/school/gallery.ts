/**
 * The class gallery (§2.14): a teacher opens the Classroom assignment folder (or some files) and every
 * student's `.amble` becomes a card. Only the manifest, the world JSON and the thumbnail are read for a card
 * (`FilesApi.read({ manifestOnly })`); a world's drawings are read only when the teacher opens it. Nothing is
 * imported and nothing is uploaded. Shared by the Gallery tab and Present mode for this page's lifetime.
 */
import { useSyncExternalStore } from 'react';
import { kitManifest, sourceFilesOf, validateGame } from '../cores/ai';
import { t } from '../i18n';
import { blobRefOf } from '../model/ids';
import type { AmbleFile, ArtId, World } from '../model/types';
import type { FilesApi } from '../files/api';
import { castFromCode, type CastInfo } from './assignment';
import type { ArtFacts } from './checks';
import { buildStory, type Story } from './story';

export type GalleryFilter = 'all' | 'art' | 'bones' | 'errors' | 'unreviewed';

export interface GalleryItem {
  /** The file's content hash (notes and checks are kept under it). */
  id: string;
  file: File;
  status: 'loading' | 'ready' | 'problem';
  /** Why a file couldn't be read ("This file isn't an Amble world"). */
  problem: string | null;
  title: string;
  /** The student's initials or nickname (World.credits.madeBy), else from the file name. */
  madeBy: string;
  thumb: string | null;
  world: World | null;
  cast: CastInfo[];
  /** Required drawings the student made, of those needed. */
  drawn: number;
  needed: number;
  story: Story | null;
  /** Problems the code checker finds (the game may still run). */
  errors: number;
  assignmentTitle: string | null;
  /** Who made each drawing, from the art records the card read (may be empty: then the cast slots say). */
  art: Map<ArtId, ArtFacts>;
}

export interface GalleryState {
  items: GalleryItem[];
  source: 'folder' | 'files' | null;
  loading: boolean;
  filter: GalleryFilter;
  /** The open card's id. */
  selected: string | null;
}

const INITIAL: GalleryState = { items: [], source: null, loading: false, filter: 'all', selected: null };

let state: GalleryState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<GalleryState> | ((s: GalleryState) => Partial<GalleryState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function galleryState(): GalleryState {
  return state;
}

export function useGallery(): GalleryState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    galleryState,
    galleryState,
  );
}

export function setGalleryFilter(filter: GalleryFilter): void {
  set({ filter });
}

export function selectGalleryItem(id: string | null): void {
  set({ selected: id });
}

/** Tests and "Open another folder". */
export function resetGallery(): void {
  for (const item of state.items) if (item.thumb) URL.revokeObjectURL(item.thumb);
  state = INITIAL;
  for (const fn of listeners) fn();
}

// ------------------------------------------------------------------ reading files

/** "Moon King - J.R.amble" → "J.R."; otherwise the name without its extension. */
export function initialsFromFileName(name: string): string {
  const base = name.replace(/\.amble$/i, '').trim();
  const dash = base.lastIndexOf(' - ');
  return (dash >= 0 ? base.slice(dash + 3) : base).trim().slice(0, 20);
}

function titleFromFileName(name: string): string {
  const base = name.replace(/\.amble$/i, '').trim();
  const dash = base.lastIndexOf(' - ');
  return (dash >= 0 ? base.slice(0, dash) : base).trim() || name;
}

export interface CardFacts {
  cast: CastInfo[];
  drawn: number;
  needed: number;
  errors: number;
  story: Story;
  art: Map<ArtId, ArtFacts>;
}

/** Everything a card shows about a world (pure; the tests call it). */
export function cardFacts(file: Pick<AmbleFile, 'world' | 'art'>): CardFacts | null {
  const world = file.world;
  if (!world) return null;
  const cast = castFromCode(world.code);
  const art = new Map<ArtId, ArtFacts>();
  for (const record of file.art) {
    art.set(record.id, { madeBy: record.madeBy, onBones: record.mode === 'bones' || record.rigInfo?.made === 'parts' });
  }
  const madeByOf = (id: ArtId) => art.get(id)?.madeBy ?? null;
  const wanted = new Set([...cast.filter((c) => c.required).map((c) => c.key), ...(world.assignment?.require ?? [])]);
  const keys = wanted.size ? [...wanted] : cast.map((c) => c.key);
  const byStudent = (key: string) => {
    const slot = world.cast[key];
    return Boolean(slot?.art) && (madeByOf(slot.art as ArtId) ?? slot.madeBy ?? 'student') === 'student';
  };
  let errors = 0;
  try {
    errors = validateGame(sourceFilesOf(world.code), { manifest: kitManifest(), fix: false }).errors.length;
  } catch {
    errors = 1;
  }
  return { cast, drawn: keys.filter(byStudent).length, needed: keys.length, errors, story: buildStory(world, madeByOf), art };
}

function patchItem(id: string, patch: Partial<GalleryItem>): void {
  set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
}

async function readCard(files: FilesApi, item: GalleryItem): Promise<void> {
  try {
    const amble = await files.read(item.file, { manifestOnly: true });
    const facts = cardFacts(amble);
    if (!amble.world || !facts) throw new Error('no world');
    const world = amble.world;
    patchItem(item.id, {
      status: 'ready',
      world,
      title: world.title || amble.manifest.title || item.title,
      madeBy: world.credits.madeBy.trim() || amble.manifest.madeBy.trim() || item.madeBy,
      thumb: amble.thumb ? URL.createObjectURL(amble.thumb) : null,
      cast: facts.cast,
      drawn: facts.drawn,
      needed: facts.needed,
      story: facts.story,
      errors: facts.errors,
      art: facts.art,
      assignmentTitle: world.assignment?.title ?? null,
    });
  } catch (err) {
    const message = err instanceof Error && err.name === 'FileProblem' ? err.message : t('school.staff_galleryNotAmble');
    patchItem(item.id, { status: 'problem', problem: message });
  }
}

/** Opens files as cards; they stream in, three at a time. */
export async function openGallery(files: FilesApi, list: readonly File[], source: 'folder' | 'files'): Promise<void> {
  resetGallery();
  const amble = list.filter((f) => /\.amble$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const items: GalleryItem[] = [];
  for (const file of amble) {
    let id: string;
    try {
      id = await blobRefOf(file);
    } catch {
      id = `${file.name}:${file.size}:${file.lastModified}`;
    }
    if (items.some((i) => i.id === id)) continue;
    items.push({
      id,
      file,
      status: 'loading',
      problem: null,
      title: titleFromFileName(file.name),
      madeBy: initialsFromFileName(file.name),
      thumb: null,
      world: null,
      cast: [],
      drawn: 0,
      needed: 0,
      story: null,
      errors: 0,
      assignmentTitle: null,
      art: new Map(),
    });
  }
  set({ items, source, loading: true, selected: null, filter: 'all' });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await readCard(files, item);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  set({ loading: false });
}

// ------------------------------------------------------------------ filters

export function reviewed(item: GalleryItem, notes: Record<string, { reviewedAt: number | null }>): boolean {
  return Boolean(notes[item.id]?.reviewedAt);
}

export function matchesFilter(item: GalleryItem, filter: GalleryFilter, notes: Record<string, { reviewedAt: number | null }>): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'art':
      return item.status === 'ready' && item.needed > 0 && item.drawn >= item.needed;
    case 'bones':
      return item.status === 'ready' && item.drawn < item.needed;
    case 'errors':
      return item.status === 'problem' || item.errors > 0;
    case 'unreviewed':
      return !reviewed(item, notes);
  }
}

/** The assignment most files belong to (the gallery's heading). */
export function assignmentName(items: readonly GalleryItem[]): string | null {
  const counts = new Map<string, number>();
  for (const it of items) if (it.assignmentTitle) counts.set(it.assignmentTitle, (counts.get(it.assignmentTitle) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [title, c] of counts) if (c > n) [best, n] = [title, c];
  return best;
}

// ------------------------------------------------------------------ robot results (this page only)

const robotRuns = new Map<string, { errors: number; seconds: number } | null>();

export function setRobotResult(id: string, run: { errors: number; seconds: number } | null): void {
  robotRuns.set(id, run);
  for (const fn of listeners) fn();
}

/** undefined = never tested on this page; null = the test couldn't run. */
export function robotResultOf(id: string): { errors: number; seconds: number } | null | undefined {
  return robotRuns.has(id) ? robotRuns.get(id) : undefined;
}
