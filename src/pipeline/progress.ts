/**
 * How far along a job looks (§2.5's build pill): an estimate by phase, never a promise. Queued 2 %,
 * writing up to 80 % as characters arrive against the size a reply usually has, validating 85 %, testing
 * 90 %, fixing back to 60-80 %, swapping 98 %.
 */
import type { AiProgress } from '../model/types';

/** Characters a whole build usually streams; changes are smaller. */
export const EXPECTED_CHARS = { build: 12_000, change: 4_000, fix: 3_000, plan: 1_500 } as const;

export function progressPercent(p: AiProgress, task: keyof typeof EXPECTED_CHARS = 'build'): number {
  switch (p.phase) {
    case 'queued':
      return 2;
    case 'checking':
      return 4;
    case 'planning':
      return 10;
    case 'writing':
      return Math.round(6 + Math.min(1, (p.chars ?? 0) / EXPECTED_CHARS[task]) * 74);
    case 'validating':
      return 85;
    case 'testing':
      return 90;
    case 'fixing':
      return p.round === 2 ? 80 : 60;
    case 'swapping':
      return 98;
  }
}
