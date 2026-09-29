/**
 * `#/settings[/<section>]` Settings (§2.15): a full-height sheet with the section list on the left (a row of
 * tabs on small screens), one section at a time, each at its own address so a link can open it.
 */
import { Link } from '../../app/Link';
import type { RouteOf, SettingsSection } from '../../app/routes';
import { ScreenFrame } from '../../app/frame/ScreenFrame';
import { TopBar } from '../../app/frame/TopBar';
import { t, type MessageKey } from '../../i18n';
import { Icon, type IconName } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { SchoolIcon } from '../teacher/SchoolIcon';
import { AboutSection } from './AboutSection';
import { AiSection } from './AiSection';
import { DrawingSection } from './DrawingSection';
import { KeysSection } from './KeysSection';
import { ReadingSection } from './ReadingSection';
import { SoundSection } from './SoundSection';
import { StorageSection } from './StorageSection';
import './settings.css';

/** The AI helper's section shows the school's online service (the server), never a sparkle. */
export const SECTIONS: Array<{ id: SettingsSection; label: MessageKey; icon: IconName | 'server' }> = [
  { id: 'ai', label: 'school.setAi', icon: 'server' },
  { id: 'sound', label: 'school.setSound', icon: 'sound' },
  { id: 'reading', label: 'school.setReading', icon: 'eye' },
  { id: 'drawing', label: 'school.setDrawing', icon: 'draw' },
  { id: 'keys', label: 'school.setKeys', icon: 'list' },
  { id: 'storage', label: 'school.setStorage', icon: 'fileSave' },
  { id: 'about', label: 'school.setAbout', icon: 'info' },
];

function SectionBody({ id }: { id: SettingsSection }) {
  switch (id) {
    case 'ai':
      return <AiSection />;
    case 'sound':
      return <SoundSection />;
    case 'reading':
      return <ReadingSection />;
    case 'drawing':
      return <DrawingSection />;
    case 'keys':
      return <KeysSection />;
    case 'storage':
      return <StorageSection />;
    case 'about':
      return <AboutSection />;
  }
}

export function Settings({ route }: { route: RouteOf<'settings'> }) {
  const section = route.section ?? 'ai';
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <ScreenFrame testId="screen-settings" header={<TopBar title={t('common.routeSettings')} />} className="settings-screen">
      <div className="settings">
        <nav className="settings__nav" aria-label={t('school.setSections')}>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <Link to={{ name: 'settings', section: s.id }} replace className={cx('settings__link', s.id === section && 'settings__link--on')} aria-current={s.id === section ? 'page' : undefined}>
                  {s.icon === 'server' ? <SchoolIcon name="server" size={20} /> : <Icon name={s.icon} size={20} />}
                  <span>{t(s.label)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section className="settings__panel" aria-labelledby="settings-title" data-section={section}>
          <h2 id="settings-title" className="settings__title">
            {t(current.label)}
          </h2>
          <SectionBody id={section} />
        </section>
      </div>
    </ScreenFrame>
  );
}
