/** A checkbox in the design system's style: a real (visually hidden) input, so keys and screen readers work. */
import type { ReactNode } from 'react';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';

export function Check({ checked, onChange, children, className }: { checked: boolean; onChange(): void; children: ReactNode; className?: string }) {
  return (
    <label className={cx('tcheck', className)}>
      <input type="checkbox" className="tcheck__input" checked={checked} onChange={onChange} />
      <span className={cx('tcheck__box', checked && 'tcheck__box--on')} aria-hidden="true">
        {checked && <Icon name="check" size={14} />}
      </span>
      <span className="tcheck__text">{children}</span>
    </label>
  );
}
