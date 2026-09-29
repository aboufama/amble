/**
 * The Teacher desk's own data on this device (§2.14): the assignments made here, the class link being
 * built, and the gallery notes (checks and feedback by file hash). Stored in `settings.teacher`; nothing is
 * uploaded. The "Ready for tomorrow?" ticks live in localStorage (they are a to-do list, not work).
 */
import { useSyncExternalStore } from 'react';
import { isTeacherData } from '../model/guards';
import type { TeacherData } from '../model/types';
import type { Store } from '../store/api';

const EMPTY: TeacherData = { assignments: [], link: null, notes: {} };

let data: TeacherData = EMPTY;
let loading: Promise<void> | null = null;
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
  loading = from.settings
    .get('teacher')
    .then((stored) => {
      if (stored && isTeacherData(stored)) {
        data = stored;
        emit();
      }
    })
    .catch(() => undefined);
  return loading;
}

export function teacherData(): TeacherData {
  return data;
}

export function useTeacherData(): TeacherData {
  return useSyncExternalStore(subscribe, teacherData, teacherData);
}

/** Changes the data and saves it (debounced, and at once when the page hides). */
export function updateTeacherData(fn: (d: TeacherData) => TeacherData): void {
  data = fn(data);
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushTeacherData, 400);
}

export function flushTeacherData(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  return store ? store.settings.put('teacher', data).catch(() => undefined) : Promise.resolve();
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void flushTeacherData());

/** Tests. */
export function resetTeacherData(): void {
  data = EMPTY;
  loading = null;
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
