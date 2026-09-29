/**
 * `#/poster` "Amble in 5 steps" (§2.14, §2.15): a printable poster for the classroom wall, with the class's
 * QR code when the teacher has built a class link on this Chromebook.
 */
import { useEffect } from 'react';
import { useServices } from '../../app/services';
import { t, type MessageKey } from '../../i18n';
import { classLinkHref } from '../../school/classLink';
import { loadTeacherData, useTeacherData } from '../../school/teacherData';
import { Icon, Lamppost, type IconName } from '../../ui/icons';
import { QrCode } from '../teacher/QrCode';
import { PageShell } from './PageShell';

const STEPS: Array<{ title: MessageKey; text: MessageKey; icon: IconName }> = [
  { title: 'school.posterStep1', text: 'school.posterStep1Text', icon: 'trail' },
  { title: 'school.posterStep2', text: 'school.posterStep2Text', icon: 'teacher' },
  { title: 'school.posterStep3', text: 'school.posterStep3Text', icon: 'draw' },
  { title: 'school.posterStep4', text: 'school.posterStep4Text', icon: 'change' },
  { title: 'school.posterStep5', text: 'school.posterStep5Text', icon: 'handIn' },
];

export function Poster() {
  const { store } = useServices();
  const teacher = useTeacherData();
  useEffect(() => {
    void loadTeacherData(store);
  }, [store]);
  const link = teacher.link?.cls ? teacher.link : null;
  let href: string | null = null;
  try {
    href = link ? classLinkHref(link) : null;
  } catch {
    href = null;
  }
  const host = typeof location === 'undefined' ? '' : `${location.host}${location.pathname.replace(/\/$/, '')}`;
  return (
    <PageShell page="poster" title={t('school.posterTitle')} lede={<p className="no-print">{t('school.posterLede')}</p>}>
      <div className="poster on-paper">
        <div className="poster__top">
          <span className="poster__mark" aria-hidden="true">
            <Lamppost height={56} />
          </span>
          <p className="poster__title">{t('school.posterHeading')}</p>
          {link && <p className="poster__cls">{link.cls}</p>}
        </div>
        <ol className="poster__steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="poster__step">
              <span className="poster__n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="poster__icon" aria-hidden="true">
                <Icon name={s.icon} size={36} />
              </span>
              <span className="poster__words">
                <span className="poster__step-title">{t(s.title)}</span>
                <span className="poster__step-text">{i === 0 ? t(s.text, { host }) : t(s.text)}</span>
              </span>
              {i === 0 && href && <QrCode text={href} label={t('school.staff_qrLabel', { cls: link?.cls ?? '' })} className="poster__qr" />}
            </li>
          ))}
        </ol>
        <p className="poster__foot">{t('school.posterFoot')}</p>
      </div>
    </PageShell>
  );
}
