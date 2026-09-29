/**
 * `#/ai` the AI helper's instructions (§2.15, §5.3, §5.13): what the helper is and isn't, the content policy
 * by level, what it receives, and the exact instructions it is given, word for word, from
 * `src/pipeline/prompts/*` (the same text every request starts with). Parents may inspect instructional
 * software (RSA 189-B); this page is how.
 */
import { useState } from 'react';
import { Link } from '../../app/Link';
import { t, type MessageKey } from '../../i18n';
import { EXPLAIN_PROMPT } from '../../pipeline/prompts/explain';
import { PLAN_PROMPT } from '../../pipeline/prompts/plan';
import { RIG_PROMPT } from '../../pipeline/prompts/rig';
import { SYSTEM_PROMPT } from '../../pipeline/prompts/system';
import { showToast } from '../../state/app';
import { TButton } from '../teacher/TButton';
import { PageShell, pagesMeta } from './PageShell';
import { SentList } from './SentList';
import { Prose } from './Prose';

const PROMPTS: Array<{ id: string; title: MessageKey; when: MessageKey; text: string }> = [
  { id: 'build', title: 'school.aiPromptBuild', when: 'school.aiPromptBuildWhen', text: SYSTEM_PROMPT },
  { id: 'plan', title: 'school.aiPromptPlan', when: 'school.aiPromptPlanWhen', text: PLAN_PROMPT },
  { id: 'explain', title: 'school.aiPromptExplain', when: 'school.aiPromptExplainWhen', text: EXPLAIN_PROMPT },
  { id: 'rig', title: 'school.aiPromptRig', when: 'school.aiPromptRigWhen', text: RIG_PROMPT },
];

const LEVEL_ROWS: Array<[MessageKey, MessageKey, MessageKey, MessageKey]> = [
  ['school.aiPolCombat', 'school.aiPolCombatE', 'school.aiPolCombatM', 'school.aiPolCombatH'],
  ['school.aiPolWeapons', 'school.aiPolWeaponsE', 'school.aiPolWeaponsM', 'school.aiPolWeaponsH'],
  ['school.aiPolDefeat', 'school.aiPolDefeatE', 'school.aiPolDefeatM', 'school.aiPolDefeatH'],
  ['school.aiPolScary', 'school.aiPolScaryE', 'school.aiPolScaryM', 'school.aiPolScaryH'],
];

function PromptBlock({ id, title, when, text }: { id: string; title: string; when: string; text: string }) {
  const [open, setOpen] = useState(id === 'build');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('school.aiCopied'), { kind: 'success' });
    } catch {
      showToast(t('school.aiCopyByHand'));
    }
  };
  return (
    <section className="prompt" aria-labelledby={`prompt-${id}`}>
      <div className="prompt__head">
        <div>
          <h4 id={`prompt-${id}`} className="page__h4">
            {title}
          </h4>
          <p className="page__meta">{when}</p>
        </div>
        {text && (
          <div className="prompt__tools">
            {/* Each button names its instructions ("Copy Planning a new world"), so four Copy buttons read apart. */}
            <button
              type="button"
              className="btn btn--quiet btn--h38"
              aria-expanded={open}
              aria-label={open ? t('school.aiHideNamed', { title }) : t('school.aiShowNamed', { title })}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="btn__label">{open ? t('school.aiHide') : t('school.aiShow')}</span>
            </button>
            <TButton variant="ghost" size={38} icon="copy" aria-label={t('school.aiCopyNamed', { title })} onClick={() => void copy()}>
              {t('school.aiCopy')}
            </TButton>
          </div>
        )}
      </div>
      {!text ? (
        <p className="page__note">{t('school.aiPromptMissing')}</p>
      ) : (
        open && (
          <pre className="prompt__text" tabIndex={0}>
            {text}
          </pre>
        )
      )}
    </section>
  );
}

export function AiInstructions() {
  return (
    <PageShell page="ai" title={t('school.aiTitle')} meta={pagesMeta()} lede={<p>{t('school.aiLede')}</p>}>
      <section className="page__kid on-paper" aria-labelledby="ai-kid">
        <h2 id="ai-kid" className="page__h2">
          {t('school.aiKidTitle')}
        </h2>
        <Prose text={t('school.page_aiKid')} />
      </section>

      <h2 className="page__h2">{t('school.aiPolicyTitle')}</h2>
      <Prose text={t('school.page_aiPolicy')} />
      <div className="page__table-wrap">
        <table className="page__table">
          <caption>{t('school.aiLevelsCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('school.aiColWhat')}</th>
              <th scope="col">{t('school.levelElementary')}</th>
              <th scope="col">{t('school.levelMiddle')}</th>
              <th scope="col">{t('school.levelHigh')}</th>
            </tr>
          </thead>
          <tbody>
            {LEVEL_ROWS.map(([what, e, m, h]) => (
              <tr key={what}>
                <th scope="row">{t(what)}</th>
                <td>{t(e)}</td>
                <td>{t(m)}</td>
                <td>{t(h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Prose text={t('school.page_aiSafety')} />

      <h2 className="page__h2">{t('school.aiSeesTitle')}</h2>
      <Prose text={t('school.page_aiSeesIntro')} />
      <SentList />
      <Prose text={t('school.page_aiSeesRest')} />
      <p className="page__links">
        <Link to={{ name: 'page', page: 'sent' }}>{t('common.routeSent')}</Link>
        <Link to={{ name: 'page', page: 'privacy' }}>{t('common.routePrivacy')}</Link>
      </p>

      <h2 className="page__h2">{t('school.aiExactTitle')}</h2>
      <p>{t('school.aiExactLede')}</p>
      {PROMPTS.map((p) => (
        <PromptBlock key={p.id} id={p.id} title={t(p.title)} when={t(p.when)} text={p.text} />
      ))}
    </PageShell>
  );
}
