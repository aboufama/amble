/**
 * Segmented control (§3.4): a radio group of 2-4 options (Play | Change, Dials | Twists, On the bones |
 * Freehand) in Scratch's tab style: a --bg-deep well whose chosen option is a white face with purple words
 * and a purple edge. Arrow keys move and select; only the selected option is in the tab order.
 */
import { useRef, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';
import { rovingIndex } from '../a11y';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedProps<T extends string> {
  /** Names the group for screen readers. */
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Retired: the chosen option is always Scratch's purple now. Accepted from older callers. */
  tone?: 'lantern' | 'change';
  size?: 38 | 44;
  className?: string;
}

export function Segmented<T extends string>({ label, options, value, onChange, size = 44, className }: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e.key, index, options.length, 'both');
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx('segmented', `segmented--h${size}`, className)} onKeyDown={onKey}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={cx('segmented__option', on && 'segmented__option--on')}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={20} />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
