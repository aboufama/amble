/**
 * Settings → About (§2.15): the version, the promise ("Made to work without accounts…"), links to the
 * privacy notice, terms, accessibility statement and the AI helper's instructions, and the licences of what
 * Amble is built with. Says "Simple graphics mode" when this Chromebook can't run WebGL (§5.9).
 */
import { useMemo } from 'react';
import { BUILD } from '../../app/env';
import { Link } from '../../app/Link';
import type { PageName } from '../../app/routes';
import { t, type MessageKey } from '../../i18n';
import { Icon } from '../../ui/icons';
import { Group } from './parts';

/** What Amble is built with (package.json dependencies that reach the app) and their licences. */
export const LICENCES: Array<{ name: string; licence: string }> = [
  { name: 'Phaser 3.90', licence: 'MIT' },
  { name: 'React, React DOM', licence: 'MIT' },
  { name: 'zustand, immer', licence: 'MIT' },
  { name: 'CodeMirror 6, Lezer', licence: 'MIT' },
  { name: 'acorn, acorn-walk, magic-string', licence: 'MIT' },
  { name: 'fflate', licence: 'MIT' },
  { name: 'qrcode-generator', licence: 'MIT' },
  { name: 'idb-keyval', licence: 'Apache-2.0' },
  { name: 'Fredoka, Atkinson Hyperlegible Next, JetBrains Mono', licence: 'SIL Open Font License 1.1' },
];

const LINKS: Array<[PageName, MessageKey]> = [
  ['privacy', 'common.routePrivacy'],
  ['terms', 'common.routeTerms'],
  ['accessibility', 'common.routeAccessibility'],
  ['ai', 'common.routeAi'],
  ['sent', 'common.routeSent'],
  ['whatsnew', 'common.routeWhatsnew'],
];

function hasWebGl(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function AboutSection() {
  const webgl = useMemo(hasWebGl, []);
  return (
    <div className="set-about">
      <Group>
        <p className="set-about__version">{t('school.setVersion', { version: BUILD.version })}</p>
        <p className="set-about__promise">{t('school.setPromise')}</p>
        {!webgl && (
          <p className="set-lock">
            <Icon name="info" size={16} />
            {t('school.setSimpleGraphics')}
          </p>
        )}
      </Group>
      <Group title={t('school.setPagesTitle')}>
        <ul className="set-links">
          {LINKS.map(([page, label]) => (
            <li key={page}>
              <Link to={{ name: 'page', page }}>{t(label)}</Link>
            </li>
          ))}
        </ul>
      </Group>
      <Group title={t('school.setLicences')}>
        <p className="set-row__hint">{t('school.setLicencesText')}</p>
        <ul className="set-licences">
          {LICENCES.map((l) => (
            <li key={l.name}>
              <span>{l.name}</span>
              <span className="set-row__hint">{l.licence}</span>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}
