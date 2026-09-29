/**
 * Teacher desk → Help & letters (§2.14): the "Amble in 5 steps" poster, the parent letter, the IT page, the
 * privacy notice, the accessibility statement, the published AI instructions, What Amble sends, and a
 * teacher FAQ ("Can Amble see my students' work?" "No. Amble has no server.").
 */
import { Link } from '../../app/Link';
import type { PageName } from '../../app/routes';
import { t, type MessageKey } from '../../i18n';
import { Icon, type IconName } from '../../ui/icons';
import { SchoolIcon, type SchoolIconName } from './SchoolIcon';

interface Doc {
  page: PageName;
  title: MessageKey;
  text: MessageKey;
  icon: { school: SchoolIconName } | { app: IconName };
}

const DOCS: Doc[] = [
  { page: 'poster', title: 'school.staff_helpPoster', text: 'school.staff_helpPosterText', icon: { school: 'print' } },
  { page: 'parents', title: 'school.staff_helpLetter', text: 'school.staff_helpLetterText', icon: { school: 'letter' } },
  { page: 'it', title: 'school.staff_helpIt', text: 'school.staff_helpItText', icon: { school: 'shield' } },
  { page: 'privacy', title: 'school.staff_helpPrivacy', text: 'school.staff_helpPrivacyText', icon: { app: 'lock' } },
  { page: 'ai', title: 'school.staff_helpAi', text: 'school.staff_helpAiText', icon: { school: 'server' } },
  { page: 'accessibility', title: 'school.staff_helpA11y', text: 'school.staff_helpA11yText', icon: { app: 'eye' } },
  { page: 'terms', title: 'school.staff_helpTerms', text: 'school.staff_helpTermsText', icon: { school: 'clipboard' } },
  { page: 'sent', title: 'school.staff_helpSent', text: 'school.staff_helpSentText', icon: { app: 'info' } },
];

const FAQ: Array<[MessageKey, MessageKey]> = [
  ['school.staff_faqSeeQ', 'school.staff_faqSeeA'],
  ['school.staff_faqSavedQ', 'school.staff_faqSavedA'],
  ['school.staff_faqAiSeesQ', 'school.staff_faqAiSeesA'],
  ['school.staff_faqAiOffQ', 'school.staff_faqAiOffA'],
  ['school.staff_faqTurnInQ', 'school.staff_faqTurnInA'],
  ['school.staff_faqBlockedQ', 'school.staff_faqBlockedA'],
  ['school.staff_faqAccountsQ', 'school.staff_faqAccountsA'],
  ['school.staff_faqArtQ', 'school.staff_faqArtA'],
];

export function HelpTab() {
  return (
    <div className="help" data-testid="teacher-help">
      <h2 className="teacher__h1">{t('school.staff_helpTitle')}</h2>
      <p className="teacher__lede">{t('school.staff_helpLede')}</p>
      <ul className="help__docs">
        {DOCS.map((d) => (
          <li key={d.page}>
            <Link to={{ name: 'page', page: d.page }} className="help-doc tpanel">
              <span className="help-doc__icon" aria-hidden="true">
                {'school' in d.icon ? <SchoolIcon name={d.icon.school} size={24} /> : <Icon name={d.icon.app} size={24} />}
              </span>
              <span className="help-doc__words">
                <span className="help-doc__title">{t(d.title)}</span>
                <span className="help-doc__text">{t(d.text)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <section className="help__faq" aria-labelledby="teacher-faq">
        <h3 id="teacher-faq" className="tpanel__h">
          {t('school.staff_faqTitle')}
        </h3>
        {FAQ.map(([q, a]) => (
          <details key={q} className="faq">
            <summary className="faq__q">{t(q)}</summary>
            <p className="faq__a">{t(a)}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
