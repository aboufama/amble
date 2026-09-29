/** Toggle (§3.4): a switch with its label (and an optional hint) that says On or Off by position and words. */
import { useId } from 'react';
import { cx } from '../cx';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ label, checked, onChange, hint, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <div className={cx('toggle', className)}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        className={cx('toggle__switch', checked && 'toggle__switch--on')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" aria-hidden="true" />
      </button>
      <label htmlFor={id} className="toggle__label">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="toggle__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
