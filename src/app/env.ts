/** What this build is (read once at startup). */
import { version } from '../../package.json';

const env = (import.meta.env ?? {}) as Record<string, string | boolean | undefined>;

function flag(v: string | boolean | undefined): boolean {
  return v === true || v === 'true' || v === '1';
}

export const BUILD = {
  version,
  /** A school build (`VITE_AMBLE_SCHOOL_MODE`): UI sounds off and games muted by default, no manual keys. */
  school: flag(env.VITE_AMBLE_SCHOOL_MODE),
  dev: Boolean(env.DEV),
} as const;
