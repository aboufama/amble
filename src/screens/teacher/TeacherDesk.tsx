/**
 * `#/teacher/<tab>` the Teacher desk (§2.14): reached from **Teacher** on the Trail and the First page. No
 * account and no password; nothing is uploaded. The blue menu bar (`on-brand`): the wordmark, **Teacher
 * desk**, the tabs, **Present** and **◂ Back to Amble**.
 */
import { useEffect } from 'react';
import { Link } from '../../app/Link';
import type { RouteOf, TeacherTab } from '../../app/routes';
import { useServices } from '../../app/services';
import { t, type MessageKey } from '../../i18n';
import { loadTeacherData } from '../../school/teacherData';
import { Wordmark } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { AssignmentsTab } from './AssignmentsTab';
import { ClassLinkTab } from './ClassLinkTab';
import { GalleryTab } from './GalleryTab';
import { HelpTab } from './HelpTab';
import { PresentMode } from './PresentMode';
import { SchoolIcon, type SchoolIconName } from './SchoolIcon';
import './teacher.css';

const TABS: Array<{ id: Exclude<TeacherTab, 'present'>; label: MessageKey; icon: SchoolIconName }> = [
  { id: 'link', label: 'school.staff_tabLink', icon: 'link' },
  { id: 'assignments', label: 'school.staff_tabAssignments', icon: 'clipboard' },
  { id: 'gallery', label: 'school.staff_tabGallery', icon: 'folder' },
  { id: 'help', label: 'school.staff_tabHelp', icon: 'letter' },
];

export function TeacherDesk({ route }: { route: RouteOf<'teacher'> }) {
  const { store } = useServices();
  useEffect(() => {
    void loadTeacherData(store);
  }, [store]);

  if (route.tab === 'present') return <PresentMode />;

  return (
    <div className="screen teacher" data-testid="screen-teacher" data-tab={route.tab}>
      <header className="teacher-top on-brand">
        <Wordmark size={30} className="teacher-top__mark" />
        <h1 className="teacher-top__title">{t('common.routeTeacher')}</h1>
        <nav className="teacher-tabs" aria-label={t('common.routeTeacher')}>
          {TABS.map((tab) => (
            <Link key={tab.id} to={{ name: 'teacher', tab: tab.id }} className={cx('teacher-tabs__tab', route.tab === tab.id && 'teacher-tabs__tab--on')} aria-current={route.tab === tab.id ? 'page' : undefined}>
              <SchoolIcon name={tab.icon} size={18} />
              {t(tab.label)}
            </Link>
          ))}
        </nav>
        <span className="teacher-top__spacer" />
        <Link to={{ name: 'teacher', tab: 'present' }} className="teacher-top__btn teacher-top__present">
          <SchoolIcon name="present" size={20} />
          <span>{t('school.staff_present')}</span>
        </Link>
        <Link to={{ name: 'trail', view: 'trail' }} className="teacher-top__btn">
          <Icon name="back" size={20} />
          <span>{t('school.staff_backToAmble')}</span>
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="teacher__main">
        {route.tab === 'link' && <ClassLinkTab />}
        {route.tab === 'assignments' && <AssignmentsTab />}
        {route.tab === 'gallery' && <GalleryTab />}
        {route.tab === 'help' && <HelpTab />}
      </main>
    </div>
  );
}
