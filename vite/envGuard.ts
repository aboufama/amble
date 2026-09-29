/**
 * Fails a build whose `VITE_*` variables look like keys or tokens (§5.14): every VITE_ value is published
 * inside the app, so keys must stay on the district's AI proxy. The values are never printed.
 */
import type { Plugin } from 'vite';
import { assertNoKeyInEnv } from '../src/ai/config/secrets.ts';

export function envGuard(env: Record<string, string>): Plugin {
  return {
    name: 'amble-env-guard',
    configResolved() {
      assertNoKeyInEnv(env);
    },
  };
}
