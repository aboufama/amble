/**
 * The app state (§8.4): one zustand store with immer, one slice per owner. Components read it with narrow
 * selectors (`useStore((s) => s.app.route)`); actions live in each slice's file and write with `setState`.
 *
 * The store is created on first use, not at import time, so slice files can import it freely (their
 * initial values are read only when the store is first touched, after every module has loaded).
 */
import type { Draft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { initialAi, type AiSlice } from './ai';
import { initialApp, type AppSlice } from './app';
import { initialConfig, type ConfigSlice } from './config';
import { initialDraw, type DrawSlice } from './draw';
import { initialLibrary, type LibrarySlice } from './library';
import { initialPrefs } from './prefs';
import { initialSession, type SessionSlice } from './session';
import type { ArtId, CastKey, Prefs } from '../model/types';

export interface AppState {
  /** FOUNDATION: route, layout, toasts, dialogs, live announcements. */
  app: AppSlice;
  /** M7 (§4.2). */
  prefs: Prefs;
  /** M7. */
  config: ConfigSlice;
  /** M6. */
  library: LibrarySlice;
  /** M2. */
  session: SessionSlice;
  /** M5. */
  ai: AiSlice;
  /** M3. */
  draw: DrawSlice;
}

export type LayoutClass = 'full' | 'tab' | 'touch' | 'small' | 'portrait';

/** The come-alive flight (§2.17): set by M3 on Bring to life, played by M2 or M1. */
export interface ComeAlive {
  key: CastKey | null;
  artId: ArtId;
  /** Object URL of the sticker. */
  sticker: string;
  from: DOMRect;
}

export function initialState(): AppState {
  return {
    app: initialApp(),
    prefs: initialPrefs(),
    config: initialConfig(),
    library: initialLibrary(),
    session: initialSession(),
    ai: initialAi(),
    draw: initialDraw(),
  };
}

function createAppStore() {
  return create<AppState>()(immer(() => initialState()));
}

type AppStore = ReturnType<typeof createAppStore>;

let store: AppStore | null = null;

function api(): AppStore {
  store ??= createAppStore();
  return store;
}

/** Subscribes a component to one narrow piece of state. */
export function useStore<T>(selector: (s: AppState) => T): T {
  return api()(selector);
}

export function getState(): AppState {
  return api().getState();
}

/** Writes with an immer recipe: `setState((s) => { s.app.layout = 'tab'; })`. */
export function setState(recipe: (draft: Draft<AppState>) => void): void {
  api().setState(recipe);
}

export function subscribe(listener: (state: AppState, prev: AppState) => void): () => void {
  return api().subscribe(listener);
}

/** Back to the initial state (tests, and "Delete everything"). */
export function resetState(): void {
  api().setState(initialState(), true);
}
