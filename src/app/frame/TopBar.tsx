/**
 * The 60 px top bar every screen except the First page and the Trail uses (§2.2), in Scratch's menu-bar
 * look: a --brand fill with white words and icons. Back link, title, a centre slot and actions; on it,
 * ghost buttons are white-outlined and the primary one is white with blue words (components.css). It is
 * the page's `header` (banner) landmark. The AI's state is never shown here: it lives in Settings → AI
 * helper and the Teacher desk.
 */
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { Link } from '../Link';
import type { Route } from '../routes';

export interface TopBarProps {
  /** Where "◂" goes, and its words (default: the Trail). Null hides it. */
  back?: { to: Route; label: string } | null;
  title?: ReactNode;
  /** Shown left of the title (the hero's sticker in a world). */
  lead?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  /** Retired: top bars carry no AI chip. Accepted from older callers and ignored. */
  aiChip?: boolean;
  className?: string;
}

export function TopBar({ back = { to: { name: 'trail', view: 'trail' }, label: t('common.backToTrail') }, title, lead, center, actions, className }: TopBarProps) {
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
      <div className="topbar__end">{actions}</div>
    </header>
  );
}
