/**
 * The AI helper's light half (§5, §8.4): its status for the AI chip and the Ask card (from the district's
 * configuration, the class's mode, the network and the last error), the one-job-per-world locks, the last
 * robot summaries, and the level and host it works with. The app creates it at boot; the pipeline itself
 * (prompts, the patch parser, the validator, the transport) loads with the first job and builds on this
 * core (`createAiService(env, core)`), so both always agree on the status and the locks.
 */
import { aiAvailable, aiStatusOf, type AiConfig, type AiError, type Transport } from '../cores/ai';
import { t } from '../i18n';
import type { AiMode, AiStatus, ClassLinkV1, Level, World, WorldId } from '../model/types';
import type { AppServicesLike } from './env';
import { JobLocks } from './queue';
import type { RobotRunner } from './robot';

/** What the service reads from the app: the resolved config, and the class's mode and level. */
export interface AiEnvConfig {
  ai: AiConfig | null;
  aiMode: AiMode;
  level: Level;
  levelMax: Level;
  classLink: ClassLinkV1 | null;
  school: boolean;
}

export interface AiEnv {
  config(): AiEnvConfig;
  onConfig(fn: () => void): () => void;
  /** The app's services (store, player, starters, history), or null before boot and in tests. */
  services(): AppServicesLike | null;
  transport(config: AiConfig): Transport | null;
  /** Overrides the robot test (tests use a fake robot). */
  robot?: (world: World) => RobotRunner | null;
  random(): number;
  online(): boolean;
  onOnline(fn: () => void): () => void;
  /** Mirrors the status into the app's store (the AI chip reads it). */
  publish?(status: AiStatus): void;
}

/** A 429 that outlasted the retries clears itself after a minute. */
const BUSY_CLEARS_MS = 60_000;

const LEVELS: Level[] = ['elementary', 'middle', 'high'];
const lowest = (...ls: Array<Level | null | undefined>): Level => LEVELS[Math.min(...ls.filter((l): l is Level => !!l).map((l) => LEVELS.indexOf(l)))] ?? 'middle';

function baseStatus(c: AiEnvConfig): AiStatus {
  const ai = c.ai;
  if (!ai) return 'off';
  if (ai.expired || ai.offReason === 'expired') return 'expired';
  if (!aiAvailable(ai)) return 'off';
  const mode: AiMode = c.classLink ? c.aiMode : c.aiMode === 'explain' ? 'explain' : 'on';
  if (mode === 'off') return 'off';
  return mode === 'explain' ? 'explain-only' : 'ready';
}

export function statusMessage(status: AiStatus, host: string): string {
  switch (status) {
    case 'off':
      return t('ai.offTitle');
    case 'offline':
      return t('ai.offline');
    case 'blocked':
      return t('ai.blocked', { host });
    case 'quota':
      return t('ai.quota');
    case 'expired':
      return t('ai.expired');
    case 'rejected':
      return t('ai.rejected');
    case 'busy':
      return t('ai.busy');
    case 'explain-only':
      return t('ai.askExplainLabel');
    case 'ready':
      return '';
  }
}

export interface AiCore {
  /** The status the chip shows ('ready', 'off', 'offline', a sticky error...). */
  status(): AiStatus;
  /** The status worked out afresh from the config, the network and the sticky error. */
  compute(): AiStatus;
  onStatus(fn: (s: AiStatus) => void): () => void;
  config(): AiConfig | null;
  /** The endpoint's host, for "Amble couldn't reach {host}". */
  host(): string;
  /** The level a world's requests are made at (the class's, lowered by the world's assignment). */
  levelFor(world: World | null): Level;
  /** The district's name for the explainer ("SAU 99"), or null. */
  district(): string | null;
  /** A sticky error status after a failed call (null clears it: Try again, or a call that worked). */
  setSticky(s: AiStatus | null): void;
  /** Records what a failed call means for the status. */
  noteError(err: AiError, tr: Transport): AiStatus | null;
  noteSuccess(): void;
  readonly locks: JobLocks;
  /** "passed · 6 s · hero moved · no errors", per world, after a robot test in this session. */
  readonly robots: Map<WorldId, string>;
}

export function createAiCore(env: Omit<AiEnv, 'transport'>): AiCore {
  const listeners = new Set<(s: AiStatus) => void>();
  let sticky: AiStatus | null = null;
  let stickyTimer: ReturnType<typeof setTimeout> | undefined;

  const compute = (): AiStatus => {
    const base = baseStatus(env.config());
    if (base !== 'ready' && base !== 'explain-only') return base;
    if (!env.online()) return 'offline';
    return sticky ?? base;
  };
  let current = compute();
  const publish = () => {
    const next = compute();
    if (next === current) return;
    current = next;
    env.publish?.(next);
    for (const fn of listeners) fn(next);
  };
  env.publish?.(current);
  env.onConfig(() => {
    sticky = null;
    publish();
  });
  env.onOnline(() => publish());

  const setSticky = (s: AiStatus | null) => {
    clearTimeout(stickyTimer);
    sticky = s;
    if (s === 'busy') stickyTimer = setTimeout(() => setSticky(null), BUSY_CLEARS_MS);
    publish();
  };

  const config = () => env.config().ai;
  return {
    status: () => current,
    compute,
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    config,
    host() {
      const c = config();
      if (!c?.baseUrl) return t('ai.hostFallback');
      try {
        return c.baseUrl.startsWith('/') ? t('ai.hostFallback') : new URL(c.baseUrl).host;
      } catch {
        return t('ai.hostFallback');
      }
    },
    levelFor(world) {
      const c = env.config();
      return lowest(c.level, c.levelMax, world?.assignment?.level ?? null);
    },
    district: () => config()?.district?.name ?? env.config().classLink?.district ?? null,
    setSticky,
    noteError(err, tr) {
      const s = aiStatusOf(err.kind, tr.auth === 'dev' ? 'none' : tr.auth);
      if (s && s !== 'off') setSticky(s);
      return s;
    },
    noteSuccess() {
      if (sticky) setSticky(null);
    },
    locks: new JobLocks(),
    robots: new Map(),
  };
}
