/**
 * `#/it` for IT (§2.15, §5.14; map-school §1.4, §2.3, §2.4, §3.3): the hosts to allow (this copy and the AI
 * address, nothing else), the content security policy this copy runs with, ChromeOS managed configuration,
 * build-time settings, what a district AI proxy must do, provider guidance, Chrome policies that matter, how
 * to check the "nothing else leaves" claim, and self-hosting.
 */
import { useMemo } from 'react';
import { t, type MessageKey } from '../../i18n';
import { useTeacherData } from '../../school/teacherData';
import { hostOf } from '../../school/testConnection';
import { useStore } from '../../state/store';
import { PageShell, pagesMeta, pageUrl } from './PageShell';
import { Prose } from './Prose';

/** The managed configuration a district pushes to a force-installed Amble (the AI core reads this shape). */
export const MANAGED_EXAMPLE = {
  amble: 1,
  district: { name: 'SAU 99', privacyUrl: 'https://sau99.org/amble-privacy', contact: 'tech@sau99.org' },
  ai: {
    enabled: true,
    baseUrl: 'https://amble-ai.sau99.org/v1',
    model: 'amble-default',
    auth: { type: 'class-code', header: 'X-Amble-Class' },
    moderation: 'endpoint',
    capabilities: ['json_schema', 'stream'],
    allowArtToAI: false,
    safetyIdentifier: true,
    requestsMayBeReviewed: false,
    gradeBandsWithAI: ['middle', 'high'],
  },
  content: { max: 'middle', default: 'middle' },
  devices: { shared: true },
  lock: ['ai', 'content'],
};

/** Build-time settings for a district's own copy (`VITE_AMBLE_*`; public values, never keys). */
export const BUILD_VARS: Array<[string, string]> = [
  ['VITE_AMBLE_SCHOOL_MODE', 'true'],
  ['VITE_AMBLE_AI_BASE_URL', 'https://amble-ai.sau99.org/v1'],
  ['VITE_AMBLE_AI_MODEL', 'amble-default'],
  ['VITE_AMBLE_AI_FAST_MODEL', 'amble-fast'],
  ['VITE_AMBLE_AI_VISION_MODEL', 'amble-vision'],
  ['VITE_AMBLE_AI_AUTH', 'class-code | none | user-key'],
  ['VITE_AMBLE_AI_AUTH_HEADER', 'X-Amble-Class'],
  ['VITE_AMBLE_AI_CAPS', 'json_schema,stream,reasoning,vision,moderation'],
  ['VITE_AMBLE_AI_MODERATION', 'endpoint | provider | local-only'],
  ['VITE_AMBLE_AI_SAFETY_ID', 'true | false'],
  ['VITE_AMBLE_ALLOW_ART_TO_AI', 'false | silhouette'],
  ['VITE_AMBLE_CONTENT_MAX', 'elementary | middle | high'],
  ['VITE_AMBLE_CONTENT_DEFAULT', 'middle'],
  ['VITE_AMBLE_AI_BANDS', 'middle,high'],
  ['VITE_AMBLE_LOCK', 'ai,content,vision'],
  ['VITE_AMBLE_REQUESTS_REVIEWED', 'true | false'],
  ['VITE_AMBLE_SHARED_DEVICES', 'true | false'],
  ['VITE_AMBLE_DISTRICT_NAME', 'SAU 99'],
  ['VITE_AMBLE_PRIVACY_URL', 'https://sau99.org/amble-privacy'],
  ['VITE_AMBLE_CONTACT', 'tech@sau99.org'],
];

const POLICIES: Array<[string, MessageKey]> = [
  ['DeviceEphemeralUsersEnabled', 'school.itPolEphemeral'],
  ['AllowFileSelectionDialogs', 'school.itPolFileDialogs'],
  ['DefaultFileSystemWriteGuardSetting', 'school.itPolWriteGuard'],
  ['DownloadDirectory', 'school.itPolDownloads'],
  ['WebAppInstallForceList', 'school.itPolForceInstall'],
  ['ManagedConfigurationPerOrigin', 'school.itPolManaged'],
  ['AudioCaptureAllowed', 'school.itPolAudio'],
  ['DefaultCookiesSetting', 'school.itPolCookies'],
];

/** The policy this copy of Amble runs with, read from the page itself (development copies have none). */
function currentCsp(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null;
}

export function ItPage() {
  const ai = useStore((s) => s.config.ai);
  const csp = useMemo(currentCsp, []);
  const appHost = typeof location === 'undefined' ? '' : location.host;
  const teacherLink = useTeacherData().link;
  const aiHosts = [ai?.baseUrl && !ai.baseUrl.startsWith('/') ? hostOf(ai.baseUrl) : null, teacherLink?.ai?.baseUrl ? hostOf(teacherLink.ai.baseUrl) : null].filter(
    (h, i, all): h is string => Boolean(h) && all.indexOf(h) === i,
  );
  return (
    <PageShell page="it" title={t('school.itTitle')} meta={pagesMeta()} wide lede={<p>{t('school.itLede')}</p>}>
      <h2 className="page__h2">{t('school.itHostsTitle')}</h2>
      <ul className="page__hosts">
        <li>
          <code>{appHost}</code> <span>{t('school.itHostApp')}</span>
        </li>
        {aiHosts.length ? (
          aiHosts.map((h) => (
            <li key={h}>
              <code>{h}</code> <span>{t('school.itHostAi')}</span>
            </li>
          ))
        ) : (
          <li>
            <span>{t('school.itHostAiNone')}</span>
          </li>
        )}
      </ul>
      <Prose text={t('school.page_itHosts')} />

      <h2 className="page__h2">{t('school.itCspTitle')}</h2>
      <p>{t('school.itCspLede')}</p>
      {csp ? <pre className="page__code">{csp.split('; ').join(';\n')}</pre> : <p className="page__note">{t('school.itCspDev')}</p>}
      <Prose text={t('school.page_itCsp')} />

      <h2 className="page__h2">{t('school.itManagedTitle')}</h2>
      <Prose text={t('school.page_itManaged')} />
      <p>
        {t('school.itForceInstall')} <code>{pageUrl('')}</code>
      </p>
      <pre className="page__code">{JSON.stringify(MANAGED_EXAMPLE, null, 2)}</pre>

      <h2 className="page__h2">{t('school.itBuildTitle')}</h2>
      <Prose text={t('school.page_itBuild')} />
      <pre className="page__code">{BUILD_VARS.map(([k, v]) => `${k}=${v}`).join('\n')}</pre>

      <h2 className="page__h2">{t('school.itProxyTitle')}</h2>
      <Prose text={t('school.page_itProxy')} />

      <h2 className="page__h2">{t('school.itProviderTitle')}</h2>
      <Prose text={t('school.page_itProvider')} />

      <h2 className="page__h2">{t('school.itPoliciesTitle')}</h2>
      <div className="page__table-wrap">
        <table className="page__table">
          <thead>
            <tr>
              <th scope="col">{t('school.itColPolicy')}</th>
              <th scope="col">{t('school.itColEffect')}</th>
            </tr>
          </thead>
          <tbody>
            {POLICIES.map(([name, effect]) => (
              <tr key={name}>
                <th scope="row">
                  <code>{name}</code>
                </th>
                <td>{t(effect)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="page__h2">{t('school.itVerifyTitle')}</h2>
      <Prose text={t('school.page_itVerify')} />

      <h2 className="page__h2">{t('school.itHostingTitle')}</h2>
      <Prose text={t('school.page_itHosting')} />
    </PageShell>
  );
}
