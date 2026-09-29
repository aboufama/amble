/**
 * Buttons (§3.4): lantern (the one primary action), ghost, quiet, paper, ai, danger; 38, 44 or 58 px
 * high; an icon plus words. Icon-only buttons are `IconButton`, which requires a label and shows it as a
 * tooltip.
 */
import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'lantern' | 'ghost' | 'quiet' | 'paper' | 'ai' | 'danger';
export type ButtonSize = 38 | 44 | 58;

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  /** Working on it: announced as busy, clicks still reach the handler (it decides). */
  busy?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'ghost', size = 44, icon, iconRight, busy, className, children, type = 'button', ...rest }: ButtonProps) {
  const iconSize = size === 58 ? 24 : 20;
  return (
    <button type={type} className={cx('btn', `btn--${variant}`, `btn--h${size}`, className)} aria-busy={busy || undefined} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      <span className="btn__label">{children}</span>
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: IconName;
  /** The accessible name, also shown as the tooltip. Required: icons are never the only label. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Toggle buttons (Mirror, Guides): announced as pressed. */
  pressed?: boolean;
  tooltip?: boolean;
}

export function IconButton({ icon, label, variant = 'quiet', size = 44, pressed, tooltip = true, className, type = 'button', ...rest }: IconButtonProps) {
  const button = (
    <button
      type={type}
      className={cx('btn', 'btn--icon', `btn--${variant}`, `btn--h${size}`, className)}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} size={size === 58 ? 26 : size === 38 ? 18 : 22} />
    </button>
  );
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button;
}
