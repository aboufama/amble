/**
 * The Teacher desk's own data on this device (§2.14): the assignments made here, the class link being
 * built, and the gallery notes (checks and feedback by file hash). Stored in `settings.teacher`; nothing is
 * uploaded. The "Ready for tomorrow?" ticks live in localStorage (they are a to-do list, not work).
 *
 * The desk shows at once, before the saved data has been read: an edit made meanwhile goes on top of the saved
 * data when it arrives, and nothing is written until it has (a partial copy would replace the saved one).
 */
import { useSyncExternalStore } from 'react';
import { isTeacherData } from '../model/guards';
import type { TeacherData } from '../model/types';
import type { Store } from '../store/api';

const EMPTY: TeacherData = { assignments: [], link: null, notes: {} };

let data: TeacherData = EMPTY;
let loading: Promise<void> | null = null;
/** The saved data has been read (or could not be): saving may write it. */
let loaded = false;
/** Edits made before the saved data was read, to replay on top of it. */
let early: Array<(d: TeacherData) => TeacherData> = [];
let store: Pick<Store, 'settings'> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reads the teacher's data once per page (later calls reuse it). */
export function loadTeacherData(from: Pick<Store, 'settings'>): Promise<void> {
  if (loading && store === from) return loading;
  store = from;
  loaded = false;
  const read = from.settings
    .get('teacher')
    .then((stored) => {
      if (read !== loading) return;
      if (stored && isTeacherData(stored)) {
        // Edits made while it was read go on top of what was saved.
        data = early.reduce((d, fn) => fn(d), stored);
        emit();
      }
    })
    .catch(() => undefined)
    .finally(() => {
      if (read !== loading) return;
      loaded = true;
      early = [];
    });
  loading = read;
  return read;
}

export function teacherData(): TeacherData {
  return data;
}

export function useTeacherData(): TeacherData {
  return useSyncExternalStore(subscribe, teacherData, teacherData);
}

/** Changes the data and saves it (debounced, and at once when the page hides). */
export function updateTeacherData(fn: (d: TeacherData) => TeacherData): void {
  if (loading && !loaded) early.push(fn);
  data = fn(data);
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushTeacherData(), 400);
}

/** Saves now (the page hides, Storage settings), once the saved data has been read. */
export async function flushTeacherData(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (loading && !loaded) await loading;
  if (store) await store.settings.put('teacher', data).catch(() => undefined);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void flushTeacherData());

/** Tests. */
export function resetTeacherData(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  data = EMPTY;
  loading = null;
  loaded = false;
  early = [];
  store = null;
  emit();
}

// ------------------------------------------------------------------ "Ready for tomorrow?" ticks

export type ReadyItem = 'test' | 'it' | 'poster' | 'letter';
export type ReadyTicks = Partial<Record<ReadyItem, number>>;

const READY_KEY = 'amble:teacher-ready';
let ticks: ReadyTicks | null = null;
const tickListeners = new Set<() => void>();

function readTicks(): ReadyTicks {
  if (ticks) return ticks;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(READY_KEY) ?? '{}');
    ticks = raw && typeof raw === 'object' ? (raw as ReadyTicks) : {};
  } catch {
    ticks = {};
  }
  return ticks;
}

export function useReadyTicks(): ReadyTicks {
  return useSyncExternalStore(
    (fn) => {
      tickListeners.add(fn);
      return () => tickListeners.delete(fn);
    },
    readTicks,
    readTicks,
  );
}

export function setReadyTick(item: ReadyItem, done: boolean): void {
  const next = { ...readTicks() };
  if (done) next[item] = Date.now();
  else delete next[item];
  ticks = next;
  try {
    localStorage.setItem(READY_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the ticks last for this visit only.
  }
  for (const fn of tickListeners) fn();
}
