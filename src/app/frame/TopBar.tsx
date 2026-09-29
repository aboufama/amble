/**
 * The 60 px top bar every screen except the First page and the Trail uses (§2.2): back link, title,
 * a centre slot, actions and the AI chip. It is the page's `header` (banner) landmark.
 */
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { Link } from '../Link';
import type { Route } from '../routes';
import { AiChip } from './AiChip';

export interface TopBarProps {
  /** Where "◂" goes, and its words (default: the Trail). Null hides it. */
  back?: { to: Route; label: string } | null;
  title?: ReactNode;
  /** Shown left of the title (the hero's sticker in a world). */
  lead?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  /** Show the AI chip before the actions' last item (default true). */
  aiChip?: boolean;
  className?: string;
}

export function TopBar({ back = { to: { name: 'trail', view: 'trail' }, label: t('common.backToTrail') }, title, lead, center, actions, aiChip = true, className }: TopBarProps) {
  return (
    <header className={cx('topbar', className)}>
      <div className="topbar__start">
        {back && (
          <Link to={back.to} className="btn btn--ghost btn--h44 topbar__back">
            <Icon name="back" size={20} />
            <span className="btn__label">{back.label}</span>
          </Link>
        )}
        {lead}
        {title && <h1 className="topbar__title">{title}</h1>}
      </div>
      {center && <div className="topbar__center">{center}</div>}
      <div className="topbar__end">
        {aiChip && <AiChip />}
        {actions}
      </div>
    </header>
  );
}
