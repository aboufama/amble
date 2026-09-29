/**
 * The frame of an in-app page (§2.15): a top bar back to where these pages are listed, a readable article
 * with the page's version and date, and Print (`@media print` gives black on white, no top bar).
 */
import type { ReactNode } from 'react';
import { ScreenFrame } from '../../app/frame/ScreenFrame';
import { TopBar } from '../../app/frame/TopBar';
import type { PageName, Route } from '../../app/routes';
import { t } from '../../i18n';
import { cx } from '../../ui/cx';
import { TButton } from '../teacher/TButton';
import './pages.css';

/** Teachers reach these pages from Help & letters; students and families from Settings → About. */
const TEACHER_PAGES: readonly PageName[] = ['it', 'parents', 'poster'];

export function backFor(page: PageName): { to: Route; label: string } {
  return TEACHER_PAGES.includes(page)
    ? { to: { name: 'teacher', tab: 'help' }, label: t('school.pageBackTeacher') }
    : { to: { name: 'settings', section: 'about' }, label: t('school.pageBackSettings') };
}

export interface PageShellProps {
  page: PageName;
  title: string;
  /** "Version 1 · September 29, 2026" */
  meta?: string;
  lede?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}

export function PageShell({ page, title, meta, lede, children, wide, className }: PageShellProps) {
  return (
    <div data-page={page} className="page-host">
      <ScreenFrame
        testId={`screen-page-${page}`}
        className="page-screen"
        header={
          <TopBar
            back={backFor(page)}
            aiChip={false}
            actions={
              <TButton variant="ghost" icon="print" onClick={() => window.print()}>
                {t('school.pagePrint')}
              </TButton>
            }
          />
        }
      >
        <article className={cx('page', wide && 'page--wide', className)} aria-labelledby={`page-${page}-title`}>
          <header className="page__head">
            <h1 id={`page-${page}-title`} className="page__title">
              {title}
            </h1>
            {meta && <p className="page__meta">{meta}</p>}
            {lede && <div className="page__lede">{lede}</div>}
          </header>
          {children}
        </article>
      </ScreenFrame>
    </div>
  );
}

/** A printable address for a page of this copy of Amble ("https://amble.sau99.org/#/privacy"). */
export function pageUrl(page: PageName | ''): string {
  if (typeof location === 'undefined') return '';
  return `${location.origin}${location.pathname}${page ? `#/${page}` : ''}`;
}

export const PAGES_VERSION = 1;
/** The date these pages were last changed (shown on each). */
export const PAGES_DATE = '2026-09-29';

export function pagesMeta(): string {
  const date = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${PAGES_DATE}T12:00:00`));
  return t('school.pageMeta', { version: PAGES_VERSION, date });
}
