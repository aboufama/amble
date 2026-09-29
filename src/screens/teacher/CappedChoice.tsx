/** A radio group styled like Segmented whose options above a ceiling show a lock and can't be picked. */
import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';

export function CappedChoice<T extends string>({ label, options, value, onChange, locked }: { label: string; options: Array<{ value: T; label: string; aria?: string }>; value: T; onChange(v: T): void; locked(v: T): boolean }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const open = options.filter((o) => !locked(o.value));
  const onKey = (e: KeyboardEvent) => {
    const i = open.findIndex((o) => o.value === value);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = open[(i + step + open.length) % open.length];
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="segmented segmented--h38 capped" onKeyDown={onKey}>
      {options.map((o, i) => {
        const on = o.value === value;
        const isLocked = locked(o.value);
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.aria}
            aria-disabled={isLocked || undefined}
            tabIndex={on ? 0 : -1}
            className={cx('segmented__option', on && 'segmented__option--on', isLocked && 'capped__locked')}
            onClick={() => !isLocked && onChange(o.value)}
          >
            {isLocked && <Icon name="lock" size={14} />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
