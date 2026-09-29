/**
 * `#/parents` the letter for families (§2.14, §2.15; map-school §6.2), filled from the class: the class name,
 * who provides the AI helper and whether requests may be reviewed. On the teacher's Chromebook it uses the
 * class link being built on the Teacher desk; on a student's, the class they joined.
 */
import { t } from '../../i18n';
import { useTeacherData } from '../../school/teacherData';
import { hostOf } from '../../school/testConnection';
import { useStore } from '../../state/store';
import { PageShell, pagesMeta, pageUrl } from './PageShell';

export function ParentLetter() {
  const teacher = useTeacherData();
  const joined = useStore((s) => s.config.classLink);
  const ai = useStore((s) => s.config.ai);
  const link = teacher.link?.cls ? teacher.link : joined;
  const cls = link?.cls || t('school.letterClassBlank');
  const district = ai?.district?.name ?? link?.district ?? null;
  const aiHost = link?.ai?.baseUrl ? hostOf(link.ai.baseUrl) : ai?.baseUrl && !ai.baseUrl.startsWith('/') ? hostOf(ai.baseUrl) : null;
  const mode = link?.mode ?? (ai?.enabled ? 'on' : 'off');
  const usesAi = Boolean(aiHost) && mode !== 'off';
  const contact = ai?.district?.contact ?? null;

  return (
    <PageShell page="parents" title={t('school.letterTitle')} meta={pagesMeta()} lede={<p className="no-print">{t('school.letterLede')}</p>}>
      <div className="letter on-paper">
        <p className="letter__date">{new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</p>
        <p>{t('school.letterHello', { cls })}</p>
        <p>{t('school.page_letterWhat')}</p>
        <p>{t('school.letterNoAccounts')}</p>
        {usesAi ? (
          <>
            <p>{mode === 'explain' ? t('school.page_letterAiExplain', { provider: district ?? t('school.letterOurSchool'), host: aiHost ?? '' }) : t('school.page_letterAiOn', { provider: district ?? t('school.letterOurSchool'), host: aiHost ?? '' })}</p>
            <p>{t('school.letterAiSends')}</p>
            <p>{ai?.requestsMayBeReviewed ? t('school.letterReviewed') : t('school.letterNotReviewed')}</p>
          </>
        ) : (
          <p>{t('school.letterAiOff')}</p>
        )}
        <p>{t('school.letterArt')}</p>
        <p>{t('school.letterSee', { url: pageUrl('') })}</p>
        {usesAi && <p>{t('school.letterNoAi')}</p>}
        <p>
          {t('school.letterMore')} <span className="letter__url">{pageUrl('privacy')}</span> · <span className="letter__url">{pageUrl('ai')}</span>
        </p>
        <p className="letter__sign">{t('school.letterThanks')}</p>
        <p className="letter__blank">{t('school.letterTeacherBlank')}</p>
        {(district || contact) && <p className="letter__contact">{contact ? t('school.letterContact', { district: district ?? '', contact }) : district}</p>}
      </div>
    </PageShell>
  );
}
