/**
 * Chips, tags and keycaps (§3.4). A chip with `onClick` is a button (pressed state when `selected` is
 * given); otherwise it is text. Tags come in paper and dark, and in a role variant with its word.
 */
import type { ReactNode } from 'react';
import { t, type MessageKey } from '../../i18n';
import type { Role } from '../../model/types';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';

export type ChipDot = 'alive' | 'ai' | 'warn' | 'change' | 'off';

export interface ChipProps {
  children: ReactNode;
  icon?: IconName;
  dot?: ChipDot;
  onClick?: () => void;
  selected?: boolean;
  title?: string;
  className?: string;
}

export function Chip({ children, icon, dot, onClick, selected, title, className }: ChipProps) {
  const inner = (
    <>
      {dot && <span className={cx('chip__dot', `chip__dot--${dot}`)} aria-hidden="true" />}
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </>
  );
  if (!onClick) {
    return (
      <span className={cx('chip', className)} title={title}>
        {inner}
      </span>
    );
  }
  return (
    <button type="button" className={cx('chip', 'chip--button', selected && 'chip--selected', className)} aria-pressed={selected} onClick={onClick} title={title}>
      {inner}
    </button>
  );
}

const ROLE_WORDS: Record<Role | 'friend', MessageKey> = {
  hero: 'common.roleHero',
  enemy: 'common.roleEnemy',
  boss: 'common.roleBoss',
  npc: 'common.roleNpc',
  friend: 'common.roleNpc',
  item: 'common.roleItem',
  hazard: 'common.roleHazard',
  prop: 'common.roleProp',
  terrain: 'common.roleTerrain',
  projectile: 'common.roleProjectile',
  enemyShot: 'common.roleEnemyShot',
  decor: 'common.roleDecor',
  background: 'common.roleBackground',
};

/** The word for a role ("Boss"); colour is never the only cue. */
export function roleWord(role: Role | 'friend'): string {
  return t(ROLE_WORDS[role]);
}

export interface TagProps {
  children?: ReactNode;
  variant?: 'paper' | 'dark';
  /** Role variant: the role's word in caps with a 3 px role underline. */
  role?: Role | 'friend';
  icon?: IconName;
  className?: string;
}

export function Tag({ children, variant = 'paper', role, icon, className }: TagProps) {
  return (
    <span className={cx('tag', `tag--${variant}`, role && 'tag--role', role && `tint-${role}`, className)}>
      {icon && <Icon name={icon} size={14} />}
      {children ?? (role ? roleWord(role) : null)}
    </span>
  );
}

export function Keycap({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <kbd className="keycap" aria-label={label}>
      {children}
    </kbd>
  );
}
