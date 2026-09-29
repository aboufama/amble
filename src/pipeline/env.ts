/**
 * Where the AI service meets the running app: the config slice (the resolved AI configuration, the class's
 * mode and level), the app's services (store for the request log, player for the robot test, starters for
 * the ladder, history for provenance) and the online state. Tests build their own `AiEnv` instead.
 */
import { getServices } from '../app/services';
import { transportFor } from '../cores/ai';
import type { InitMessage, PlayerPrefs, RobotRaw } from '../cores/play';
import type { HistoryApi } from '../history/api';
import type { AiStatus, World } from '../model/types';
import type { StarterCatalog } from '../starters/api';
import { getState, subscribe } from '../state/store';
import type { Store } from '../store/api';
import { toInitMessage } from '../world/init';
import type { AiEnv } from './service';

export interface AppServicesLike {
  store: Store;
  player: { robot(init: InitMessage): Promise<{ raw: RobotRaw }> };
  starters: StarterCatalog;
  history: HistoryApi;
  /** World + drawings -> the player's init message (M2's `toInitMessage`). */
  toInit?: (world: World, o: { mode: 'robot'; prefs: PlayerPrefs; robot: { gameMs: number; seed: number; bot: 'auto' }; autostart: boolean }) => Promise<InitMessage>;
}

export function appEnv(publish?: (s: AiStatus) => void): AiEnv {
  return {
    config: () => getState().config,
    onConfig(fn) {
      return subscribe((state, prev) => {
        if (state.config !== prev.config) fn();
      });
    },
    services() {
      try {
        const s = getServices();
        return { store: s.store, player: s.player, starters: s.starters, history: s.history, toInit: toInitMessage };
      } catch {
        return null;
      }
    },
    transport: (c) => transportFor(c),
    random: Math.random,
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    onOnline(fn) {
      if (typeof window === 'undefined') return () => undefined;
      window.addEventListener('online', fn);
      window.addEventListener('offline', fn);
      return () => {
        window.removeEventListener('online', fn);
        window.removeEventListener('offline', fn);
      };
    },
    publish,
  };
}
