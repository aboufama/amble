/**
 * The app's services (§8.4), created once in main.tsx: `useServices()` in components, `getServices()` in
 * plain code. Each is an interface owned by a module; until the module lands, a stub stands in.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { createFilesStub, type FilesApi } from '../files/api';
import { createHistoryStub, type HistoryApi } from '../history/api';
import { createAiStub, type AiService } from '../pipeline/api';
import { createSchoolStub, type SchoolApi } from '../school/api';
import { createStarterStub, type StarterCatalog } from '../starters/api';
import type { Store } from '../store/api';
import { openStore } from '../store';
import { PlayerHostImpl, type PlayerHost } from './player/host';

export interface Services {
  /** src/store/api.ts (M6). */
  store: Store;
  /** src/files/api.ts (M6; stub throws NotBuiltYet). */
  files: FilesApi;
  /** src/pipeline/api.ts (M5; stub: status 'off'). */
  ai: AiService;
  /** src/history/api.ts (M9; stub appends a StepSummary, no snapshot). */
  history: HistoryApi;
  /** src/starters/api.ts (M8; stub: the fixture world). */
  starters: StarterCatalog;
  /** src/school/api.ts (M7; stub: basic class link, no checks). */
  school: SchoolApi;
  /** src/app/player/host.ts (FOUNDATION). */
  player: PlayerHost;
}

/** Builds the services; any of them can be passed in (tests, and modules as they land). */
export async function createServices(o: Partial<Services> = {}): Promise<Services> {
  const store = o.store ?? (await openStore());
  return {
    store,
    files: o.files ?? createFilesStub(),
    ai: o.ai ?? createAiStub(),
    history: o.history ?? createHistoryStub(),
    starters: o.starters ?? createStarterStub(),
    school: o.school ?? createSchoolStub(store),
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
