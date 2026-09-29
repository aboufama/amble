/** A Button (§3.4 classes) whose icon comes from the Teacher desk's extra set. */
import type { ComponentProps, ReactNode } from 'react';
import type { ButtonVariant } from '../../ui/components';
import { cx } from '../../ui/cx';
import { SchoolIcon, type SchoolIconName } from './SchoolIcon';

export interface TButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: 38 | 44 | 58;
  icon: SchoolIconName;
  testId?: string;
  children: ReactNode;
}

export function TButton({ variant = 'ghost', size = 44, icon, testId, className, children, type = 'button', ...rest }: TButtonProps) {
  return (
    <button type={type} className={cx('btn', `btn--${variant}`, `btn--h${size}`, className)} data-testid={testId} {...rest}>
      <SchoolIcon name={icon} size={size === 58 ? 24 : 20} />
      <span className="btn__label">{children}</span>
    </button>
  );
}
