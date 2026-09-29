/**
 * `#/privacy` the privacy notice (§2.15; map-school §1.4): a short version students can read, then the full
 * notice for families, schools and IT: who publishes Amble, what it keeps and where, what never leaves the
 * Chromebook, the AI helper, who can see what, rights, laws, security and changes. Districts list this page
 * in their RSA 189:66 V inventory, so it describes what this copy of Amble actually does.
 */
import { Link } from '../../app/Link';
import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';
import { hostOf } from '../../school/testConnection';
import { PageShell, pagesMeta } from './PageShell';
import { Prose } from './Prose';

const REPO = 'https://github.com/aboufama/amble';

const INVENTORY: Array<[MessageKey, MessageKey, MessageKey, MessageKey]> = [
  ['school.privInvWorlds', 'school.privWhereDevice', 'school.privKeepUntilDeleted', 'school.privLeavesWorlds'],
  ['school.privInvStrokes', 'school.privWhereDevice', 'school.privKeepWithDrawing', 'school.privLeavesNever'],
  ['school.privInvFiles', 'school.privWhereFiles', 'school.privKeepSchool', 'school.privLeavesStudent'],
  ['school.privInvSettings', 'school.privWhereSettings', 'school.privKeepSettings', 'school.privLeavesCode'],
  ['school.privInvLog', 'school.privWhereDevice', 'school.privKeepLog', 'school.privLeavesNever'],
  ['school.privInvTeacher', 'school.privWhereTeacher', 'school.privKeepUntilDeleted', 'school.privLeavesTeacher'],
  ['school.privInvCache', 'school.privWhereCache', 'school.privKeepCache', 'school.privLeavesNever'],
];

export function Privacy() {
  const ai = useStore((s) => s.config.ai);
  const district = ai?.district ?? null;
  const aiHost = ai?.baseUrl && !ai.baseUrl.startsWith('/') ? hostOf(ai.baseUrl) : null;
  const appHost = typeof location === 'undefined' ? '' : location.host;
  return (
    <PageShell page="privacy" title={t('school.privTitle')} meta={pagesMeta()} lede={<p>{t('school.privLede')}</p>}>
      <section className="page__kid on-paper" aria-labelledby="priv-kid">
        <h2 id="priv-kid" className="page__h2">
          {t('school.privKidTitle')}
        </h2>
        <Prose text={t('school.page_privacyKid')} />
      </section>

      <h2 className="page__h2">{t('school.privFullTitle')}</h2>

      <h3 className="page__h">{t('school.privWhoTitle')}</h3>
      <Prose text={t('school.page_privacyWho')} />
      {district && (
        <p className="page__note">
          {t('school.privDistrict', { district: district.name })}
          {district.contact && ` ${t('school.privDistrictContact', { contact: district.contact })}`}{' '}
          {district.privacyUrl && (
            <a href={district.privacyUrl} rel="noreferrer" target="_blank">
              {t('school.privDistrictNotice', { district: district.name })}
            </a>
          )}
        </p>
      )}
      <p>
        {t('school.privContact')}{' '}
        <a href={`${REPO}/issues`} rel="noreferrer" target="_blank">
          github.com/aboufama/amble/issues
        </a>
      </p>

      <h3 className="page__h">{t('school.privKeepsTitle')}</h3>
      <p>{t('school.privKeepsLede')}</p>
      <div className="page__table-wrap">
        <table className="page__table">
          <thead>
            <tr>
              <th scope="col">{t('school.privColWhat')}</th>
              <th scope="col">{t('school.privColWhere')}</th>
              <th scope="col">{t('school.privColHowLong')}</th>
              <th scope="col">{t('school.privColLeaves')}</th>
            </tr>
          </thead>
          <tbody>
            {INVENTORY.map(([what, where, keep, leaves]) => (
              <tr key={what}>
                <th scope="row">{t(what)}</th>
                <td>{t(where)}</td>
                <td>{t(keep)}</td>
                <td>{t(leaves)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t('school.page_privacyNothingElse')}</p>

      <h3 className="page__h">{t('school.privNetTitle')}</h3>
      <div className="page__table-wrap">
        <table className="page__table">
          <thead>
            <tr>
              <th scope="col">{t('school.privColHost')}</th>
              <th scope="col">{t('school.privColWhy')}</th>
              <th scope="col">{t('school.privColWhen')}</th>
              <th scope="col">{t('school.privColSees')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                <code>{appHost}</code>
              </th>
              <td>{t('school.privNetAppWhy')}</td>
              <td>{t('school.privNetAppWhen')}</td>
              <td>{t('school.privNetAppSees')}</td>
            </tr>
            <tr>
              <th scope="row">{aiHost ? <code>{aiHost}</code> : t('school.privNetAiNone')}</th>
              <td>{t('school.privNetAiWhy')}</td>
              <td>{t('school.privNetAiWhen')}</td>
              <td>{t('school.privNetAiSees')}</td>
            </tr>
            <tr>
              <th scope="row">{t('school.privNetOther')}</th>
              <td>{t('school.privNetNone')}</td>
              <td>{t('school.privNetNever')}</td>
              <td>{t('school.privNetNothing')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="page__h">{t('school.privNeverTitle')}</h3>
      <Prose text={t('school.page_privacyNever')} />

      <h3 className="page__h">{t('school.privAiTitle')}</h3>
      <Prose text={t('school.page_privacyAi')} />
      <p>{ai?.requestsMayBeReviewed ? t('school.privAiReviewed') : t('school.privAiAskSchool')}</p>
      <p className="page__links">
        <Link to={{ name: 'page', page: 'sent' }}>{t('common.routeSent')}</Link>
        <Link to={{ name: 'page', page: 'ai' }}>{t('common.routeAi')}</Link>
      </p>

      <h3 className="page__h">{t('school.privSeeTitle')}</h3>
      <Prose text={t('school.page_privacySee')} />

      <h3 className="page__h">{t('school.privRightsTitle')}</h3>
      <Prose text={t('school.page_privacyRights')} />

      <h3 className="page__h">{t('school.privLawsTitle')}</h3>
      <Prose text={t('school.page_privacyLaws')} />

      <h3 className="page__h">{t('school.privSecurityTitle')}</h3>
      <Prose text={t('school.page_privacySecurity')} />
      <p className="page__links">
        <Link to={{ name: 'page', page: 'it' }}>{t('common.routeIt')}</Link>
        <a href={REPO} rel="noreferrer" target="_blank">
          github.com/aboufama/amble
        </a>
      </p>

      <h3 className="page__h">{t('school.privChangesTitle')}</h3>
      <Prose text={t('school.page_privacyChanges')} />
    </PageShell>
  );
}
