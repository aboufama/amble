/** Small building blocks the Settings sections share: a labelled choice and a group of settings. */
import { useId, type ReactNode } from 'react';
import { Segmented, type SegmentedOption } from '../../ui/components';
import { Icon } from '../../ui/icons';

export function Choice<T extends string>({ label, hint, options, value, onChange, locked }: { label: string; hint?: string; options: SegmentedOption<T>[]; value: T; onChange(v: T): void; locked?: string | null }) {
  const id = useId();
  return (
    <div className="set-row">
      <div className="set-row__words">
        <span className="set-row__label" id={id}>
          {label}
        </span>
        {hint && <span className="set-row__hint">{hint}</span>}
      </div>
      {locked ? (
        <span className="set-lock">
          <Icon name="lock" size={16} />
          {locked}
        </span>
      ) : (
        <Segmented label={label} options={options} value={value} onChange={onChange} size={38} />
      )}
    </div>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="set-group" aria-labelledby={title ? id : undefined}>
      {title && (
        <h3 id={id} className="set-group__title">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}
