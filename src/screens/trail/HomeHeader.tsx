/**
 * The 66 px header over the night landscape (§2.3, §2.4): the wordmark at x 38, then right-aligned the
 * AI chip, **Open a file**, **Teacher** and **Settings**. It is the page's banner landmark.
 */
import type { ReactNode } from 'react';
import { Link } from '../../app/Link';
import { AiChip } from '../../app/frame/AiChip';
import { t } from '../../i18n';
import { Wordmark } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { OpenFile } from '../files/OpenFile';

export function HomeHeader({ pulse = false, extra, className }: { pulse?: boolean; extra?: ReactNode; className?: string }) {
  return (
    <header className={cx('home-header', pulse && 'home-header--pulse', className)}>
      <Link to={{ name: 'home' }} className="home-header__brand" aria-label={t('home.headerLabel')}>
        <Wordmark size={40} />
      </Link>
      <div className="home-header__end">
        {extra}
        <AiChip />
        <OpenFile variant="ghost" />
        <Link to={{ name: 'teacher', tab: 'link' }} className="btn btn--quiet btn--h44">
          <Icon name="teacher" size={20} />
          <span className="btn__label">{t('home.teacher')}</span>
        </Link>
        <Link to={{ name: 'settings', section: null }} className="btn btn--quiet btn--h44">
          <Icon name="settings" size={20} />
          <span className="btn__label">{t('home.settings')}</span>
        </Link>
      </div>
    </header>
  );
}
