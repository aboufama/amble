/** Meter (§3.4): a labelled amount ("Amble is using 38 MB of about 1.2 GB", a build's progress). */
import { cx } from '../cx';

export interface MeterProps {
  label: string;
  value: number;
  max?: number;
  /** What a screen reader hears ("64%"); default: the percentage. */
  valueText?: string;
  tone?: 'accent' | 'alive' | 'warn' | 'ai';
  className?: string;
}

export function Meter({ label, value, max = 1, valueText, tone = 'accent', className }: MeterProps) {
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
