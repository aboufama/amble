/**
 * Meter (§3.4): a labelled amount ("Amble is using 38 MB of about 1.2 GB", a build's progress), a thin
 * flat bar. With `busy` it is a progress bar whose amount is unknown ("Working on it…"): a short bar
 * slides along, and holds still under reduced motion.
 */
import { cx } from '../cx';

export interface MeterProps {
  label: string;
  /** The amount (ignored while `busy`). */
  value?: number;
  max?: number;
  /** What a screen reader hears ("64%"); default: the percentage. */
  valueText?: string;
  /** `ai` is kept for older callers: it draws as `accent`. */
  tone?: 'accent' | 'alive' | 'warn' | 'ai';
  /** Working on it, amount unknown: an indeterminate progress bar. */
  busy?: boolean;
  className?: string;
}

export function Meter({ label, value = 0, max = 1, valueText, tone = 'accent', busy = false, className }: MeterProps) {
  if (busy) {
    return (
      <div className={cx('meter', 'meter--busy', `meter--${tone}`, className)} role="progressbar" aria-label={label} aria-valuetext={valueText}>
        <span className="meter__fill" />
      </div>
    );
  }
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      className={cx('meter', `meter--${tone}`, className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText ?? `${Math.round(ratio * 100)}%`}
    >
      <span className="meter__fill" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
