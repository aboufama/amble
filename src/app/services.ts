/**
 * The app's services (§8.4), created once in main.tsx: `useServices()` in components, `getServices()` in
 * plain code. Each is an interface owned by a module; tests pass their own in place of any of them.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { createFiles, type FilesApi } from '../files/api';
import { createHistory, type HistoryApi } from '../history/api';
import { createAppAi, type AiService } from '../pipeline/api';
import { createSchool, type SchoolApi } from '../school/api';
import { createStarterStub, type StarterCatalog } from '../starters/api';
import type { Store } from '../store/api';
import { openStore } from '../store';
import { PlayerHostImpl, type PlayerHost } from './player/host';

export interface Services {
  /** src/store/api.ts (M6). */
  store: Store;
  /** src/files/api.ts (M6): `.amble` files, Save to Drive, open, share, the old-Amble rescue. */
  files: FilesApi;
  /** src/pipeline/api.ts (M5): status 'off' and nothing ever sent until an AI service is set up. */
  ai: AiService;
  /** src/history/api.ts (M9): Footsteps, Go back and provenance. */
  history: HistoryApi;
  /** src/starters/api.ts (M8): the starter worlds and seeds. */
  starters: StarterCatalog;
  /** src/school/api.ts (M7): class links, joining a class, assignment checks. */
  school: SchoolApi;
  /** src/app/player/host.ts (FOUNDATION). */
  player: PlayerHost;
}

/** Builds the services; any of them can be passed in (tests). */
export async function createServices(o: Partial<Services> = {}): Promise<Services> {
  const store = o.store ?? (await openStore());
  return {
    store,
    files: o.files ?? createFiles(),
    ai: o.ai ?? createAppAi(),
    history: o.history ?? createHistory(),
    starters: o.starters ?? createStarterStub(),
    school: o.school ?? createSchool(store),
    player: o.player ?? new PlayerHostImpl(),
  };
}

let current: Services | null = null;

export function setServices(s: Services): void {
  current = s;
}

/** The services from plain code (throws before main.tsx has created them). */
export function getServices(): Services {
  if (!current) throw new Error('Amble services are not ready yet.');
  return current;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children?: ReactNode }) {
  return createElement(ServicesContext.Provider, { value }, children);
}

export function useServices(): Services {
  const s = useContext(ServicesContext) ?? current;
  if (!s) throw new Error('Amble services are not ready yet.');
  return s;
}
