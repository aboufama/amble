/** `#/whatsnew` What's new (§2.15, §2.16): what changed in this version of Amble, in students' words. */
import { BUILD } from '../../app/env';
import { t } from '../../i18n';
import { PageShell } from './PageShell';
import { Prose } from './Prose';

export function WhatsNew() {
  return (
    <PageShell page="whatsnew" title={t('common.routeWhatsnew')} meta={t('school.newMeta', { version: BUILD.version })}>
      <Prose text={t('school.page_whatsnew')} />
    </PageShell>
  );
}
