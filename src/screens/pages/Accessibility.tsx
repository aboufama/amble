/**
 * `#/accessibility` the accessibility statement (§2.15, §3.9; map-school §4): the goal (WCAG 2.1 AA, 2.2 AA
 * where practical), what works, the honest limits, how Amble is checked, and how to report a problem.
 */
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import { PageShell, pagesMeta } from './PageShell';
import { Prose } from './Prose';

export function Accessibility() {
  return (
    <PageShell page="accessibility" title={t('school.a11yTitle')} meta={pagesMeta()} lede={<p>{t('school.a11yLede')}</p>}>
      <Prose text={t('school.page_a11y')} />
      <p className="page__links">
        <Link to={{ name: 'settings', section: 'reading' }}>{t('school.a11ySettingsLink')}</Link>
        <Link to={{ name: 'settings', section: 'keys' }}>{t('school.a11yKeysLink')}</Link>
        <a href="https://github.com/aboufama/amble/issues" rel="noreferrer" target="_blank">
          github.com/aboufama/amble/issues
        </a>
      </p>
    </PageShell>
  );
}
