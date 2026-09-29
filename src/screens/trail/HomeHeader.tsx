/**
 * The bar over the First page and the Trail (§2.3, §2.4), like every screen's top bar: the wordmark on
 * the left, then **Open a file**, **Teacher** and **Settings** on the right. It is the page's banner
 * landmark.
 */
import type { ReactNode } from 'react';
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import { Wordmark } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { OpenFile } from '../files/OpenFile';
import './header.css';

export function HomeHeader({ extra, className }: { extra?: ReactNode; className?: string }) {
  return (
    <header className={cx('home-bar', 'on-brand', 'home-header', className)}>
      <Link to={{ name: 'home' }} className="home-bar__brand" aria-label={t('home.headerLabel')}>
        <Wordmark size={34} />
      </Link>
      <div className="home-header__end">
        {extra}
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
