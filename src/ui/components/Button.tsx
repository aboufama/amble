/**
 * Buttons (§3.4), in Scratch's shapes: 8 px corners, sentence-case words, 38, 44 or 58 px high, an icon
 * plus words.
 * - `lantern`: the primary action (Scratch blue, white words). One per place.
 * - `ghost` (and `paper`, the same look): secondary (white, a --line-control edge).
 * - `quiet`: words or an icon only (toolbars, icon buttons).
 * - `danger`: destructive (--warn); the words say so too.
 * - `pressed` / `aria-pressed`: selected or toggled on (Scratch's purple).
 * - `ai` is retired (the AI has no look of its own) and draws as secondary.
 * On the top bar (`.topbar`, `.on-brand`) ghosts are white-outlined and the primary is white with blue
 * words. Icon-only buttons are `IconButton`, which requires a label and shows it as a tooltip.
 */
import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';
import { Tooltip } from './Tooltip';

/** `ai` is kept for older callers only: it draws as `ghost`. */
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
