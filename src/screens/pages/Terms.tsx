/**
 * `#/terms` the terms of use (§2.15; map-school §1.4): who Amble is for, the code and licences, no warranty,
 * acceptable use, the AI helper (the school's choice and responsibility), whose work is whose, and changes.
 */
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import { PageShell, pagesMeta } from './PageShell';
import { Prose } from './Prose';

export function Terms() {
  return (
    <PageShell page="terms" title={t('school.termsTitle')} meta={pagesMeta()} lede={<p>{t('school.termsLede')}</p>}>
      <section className="page__kid on-paper" aria-labelledby="terms-kid">
        <h2 id="terms-kid" className="page__h2">
          {t('school.termsKidTitle')}
        </h2>
        <Prose text={t('school.page_termsKid')} />
      </section>
      <Prose text={t('school.page_terms')} />
      <p className="page__links">
        <Link to={{ name: 'page', page: 'privacy' }}>{t('common.routePrivacy')}</Link>
        <Link to={{ name: 'page', page: 'ai' }}>{t('common.routeAi')}</Link>
        <Link to={{ name: 'settings', section: 'about' }}>{t('school.termsLicences')}</Link>
      </p>
    </PageShell>
  );
}
