/**
 * Text fields (§3.4): a label, an optional hint, an error, a character counter and a slot under the
 * field (the PII warning goes there). Everything is tied to the input with ids for screen readers.
 */
import { useId, type ComponentProps, type ReactNode } from 'react';
import { t } from '../../i18n';
import { cx } from '../cx';

interface FieldBase {
  label: string;
  /** Hide the label visually (it still names the field). */
  labelHidden?: boolean;
  hint?: string;
  error?: string | null;
  /** Show "12 of 40" under the field (needs maxLength). */
  counter?: boolean;
  /** Content under the field (the PII warning). */
  slot?: ReactNode;
  className?: string;
}

function describedBy(id: string, hint?: string, error?: string | null, counter?: boolean): string | undefined {
  const ids = [hint && `${id}-hint`, error && `${id}-error`, counter && `${id}-count`].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function Frame({ id, label, labelHidden, hint, error, counter, length, max, slot, className, children }: FieldBase & { id: string; length: number; max?: number; children: ReactNode }) {
  return (
    <div className={cx('field', error && 'field--error', className)}>
      <label htmlFor={id} className={cx('field__label', labelHidden && 'sr-only')}>
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {children}
      <div className="field__foot">
        {error && (
          <p id={`${id}-error`} className="field__error">
            {error}
          </p>
        )}
        {counter && max !== undefined && (
          <p id={`${id}-count`} className="field__count" aria-live="off">
            {t('common.counter', { n: length, max })}
          </p>
        )}
      </div>
      {slot}
    </div>
  );
}

export type FieldProps = FieldBase & Omit<ComponentProps<'input'>, 'className'>;

export function Field({ label, labelHidden, hint, error, counter, slot, className, id: given, ...input }: FieldProps) {
  const auto = useId();
  const id = given ?? auto;
  const length = typeof input.value === 'string' ? input.value.length : 0;
  return (
    <Frame {...{ id, label, labelHidden, hint, error, counter, slot, className, length, max: input.maxLength }}>
      <input id={id} className="field__input" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, counter)} {...input} />
    </Frame>
  );
}

export type TextAreaProps = FieldBase & Omit<ComponentProps<'textarea'>, 'className'>;

export function TextArea({ label, labelHidden, hint, error, counter, slot, className, id: given, rows = 3, ...input }: TextAreaProps) {
  const auto = useId();
  const id = given ?? auto;
  const length = typeof input.value === 'string' ? input.value.length : 0;
  return (
    <Frame {...{ id, label, labelHidden, hint, error, counter, slot, className, length, max: input.maxLength }}>
      <textarea id={id} rows={rows} className="field__input field__input--area" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, counter)} {...input} />
    </Frame>
  );
}
