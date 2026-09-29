/**
 * The idea box (§2.3, §2.5): "Tell Amble your idea" on the First page and "Or describe your own world…"
 * on the New world sheet. The words are checked on the device as the student types (400 ms after typing
 * stops): personal info shows the warning, a crisis shows the support card and nothing is sent. Sending
 * starts the plan call and goes to the plan card. With the AI helper off, it says so plainly.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from '../../app/Link';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { startPlan, setIdea, usePlanSession, type PlanHero } from '../../home/planSession';
import { useAiView } from '../../home/useAiStatus';
import type { SafetyVerdict } from '../../model/types';
import { markSeen } from '../../state/prefs';
import { getState, useStore } from '../../state/store';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';
import { AiExplainer } from '../ai/AiExplainer';
import { CrisisCard } from '../ai/CrisisCard';
import { PiiWarning } from '../ai/PiiWarning';
import { RefusalCard } from '../ai/RefusalCard';
import './cards.css';

export interface IdeaBoxProps {
  variant: 'first' | 'sheet';
  hero: PlanHero | null;
  /** The First page before Bring it to life: "Or tell Amble your idea". */
  lead?: boolean;
  autoFocus?: boolean;
  /** Called once the plan call has started (the sheet shows its waiting state). */
  onPlanning?(): void;
  /** With the AI helper off, show nothing (the New world sheet: world types only). */
  hideWhenOff?: boolean;
  className?: string;
}

const MAX = 300;

export function IdeaBox({ variant, hero, lead = false, autoFocus = false, onPlanning, hideWhenOff = false, className }: IdeaBoxProps) {
  const { ai, starters } = useServices();
  const view = useAiView();
  const session = usePlanSession();
  const level = useStore((s) => s.config.level);
  const seenExplainer = useStore((s) => Boolean(s.prefs.seen.aiExplainer));
  const [text, setText] = useState(() => (session.hero?.id === hero?.id || !hero ? session.idea : ''));
  const [verdict, setVerdict] = useState<SafetyVerdict>({ kind: 'allow' });
  const [refusal, setRefusal] = useState<Extract<SafetyVerdict, { kind: 'refuse' }> | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [explainer, setExplainer] = useState(false);
  const pending = useRef<string | null>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const fieldId = useId();
  const statusId = useId();

  // In a sheet, the dialog focuses its [data-autofocus] element once it opens (showModal() would move focus
  // to its first button after this runs); on a page this puts the caret in the field.
  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // The local safety floor runs 400 ms after typing stops (§5.13).
  useEffect(() => {
    if (!text.trim()) {
      setVerdict({ kind: 'allow' });
      return;
    }
    const id = setTimeout(() => setVerdict(ai.checkText(text, level)), 400);
    return () => clearTimeout(id);
  }, [text, ai, level]);

  const send = (idea: string) => {
    playUiSound('sent');
    setIdea(idea, hero);
    void startPlan(ai, idea, hero, getState().config.level, (i) => starters.matchIdea(i));
    onPlanning?.();
    if (variant === 'first') navigate({ name: 'plan' });
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const idea = text.replace(/\s+/g, ' ').trim().slice(0, MAX);
    if (!idea) {
      field.current?.focus();
      return;
    }
    const v = ai.checkText(idea, level);
    setVerdict(v);
    if (v.kind === 'crisis') {
      setCrisis(true);
      return;
    }
    if (v.kind === 'refuse') {
      setRefusal(v);
      return;
    }
    if (v.kind === 'pii' && v.block) return;
    // The explainer card opens before the first idea on this device; the idea goes when it closes.
    if (!seenExplainer) {
      markSeen('aiExplainer');
      pending.current = idea;
      setExplainer(true);
      return;
    }
    send(idea);
  };

  // The one-line field submits with Enter through its form; the sheet's two-line field sends on Enter
  // too (Shift+Enter makes a new line).
  const onKey = (e: KeyboardEvent) => {
    if (variant === 'sheet' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  if (!view.on && hideWhenOff) return null;
  if (!view.on) {
    const blocked = view.status === 'blocked' || view.status === 'offline';
    return (
      <section className={cx('idea-box', 'idea-box--off', `idea-box--${variant}`, className)} aria-labelledby={statusId} data-testid="idea-box-off">
        <Icon name={blocked ? 'warning' : 'info'} size={22} className="idea-box__off-icon" />
        <div className="idea-box__off-text">
          <p id={statusId}>{blocked ? t('home.ideaAiBlocked', { host: view.host ?? t('home.aiHostFallback') }) : t('home.ideaAiOff')}</p>
          {!blocked &&
            (view.school ? (
              <p className="idea-box__meta">{t('home.ideaAiOffSchool')}</p>
            ) : (
              <Link to={{ name: 'settings', section: 'ai' }} className="btn btn--ghost btn--h38 idea-box__setup">
                <Icon name="settings" size={18} />
                <span className="btn__label">{t('home.setUpAi')}</span>
              </Link>
            ))}
        </div>
      </section>
    );
  }

  const placeholder =
    variant === 'sheet'
      ? hero
        ? t('home.describePlaceholderHero', { name: hero.name })
        : t('home.describePlaceholder')
      : hero
        ? t('home.ideaPlaceholderHero', { name: hero.name })
        : t('home.ideaPlaceholder');
  const blocked = verdict.kind === 'pii' && verdict.block;
  const planning = session.status === 'waiting';
  const status = view.district ? t('home.aiOnFrom', { district: view.district }) : t('home.aiOn');

  return (
    <section className={cx('idea-box', `idea-box--${variant}`, className)} aria-labelledby={statusId} data-testid="idea-box">
      <div className="idea-box__head">
        {variant === 'first' ? (
          <h2 id={statusId} className="idea-box__title">
            <span className="idea-box__nib" aria-hidden="true">
              <Icon name="sparkle" size={18} />
            </span>
            {lead ? t('home.ideaTitleFirst') : t('home.ideaTitle')}
          </h2>
        ) : (
          <label id={statusId} htmlFor={fieldId} className="idea-box__title idea-box__title--sheet">
            {t('home.describe')}
          </label>
        )}
        <span className="idea-box__status">
          <span className="chip__dot chip__dot--alive" aria-hidden="true" />
          {status}
        </span>
      </div>
      <form className="idea-box__row" onSubmit={submit}>
        {variant === 'first' ? (
          <input
            ref={field}
            id={fieldId}
            className="idea-box__field"
            value={text}
            maxLength={MAX}
            placeholder={placeholder}
            aria-label={t('home.ideaField')}
            onChange={(e) => setText(e.target.value)}
            enterKeyHint="go"
            autoComplete="off"
            data-autofocus={autoFocus || undefined}
            data-testid="idea-field"
          />
        ) : (
          <textarea
            ref={field}
            id={fieldId}
            className="idea-box__field idea-box__field--area"
            rows={2}
            value={text}
            maxLength={MAX}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            data-autofocus={autoFocus || undefined}
            data-testid="idea-field"
          />
        )}
        <Button type="submit" variant="ai" size={variant === 'first' ? 38 : 44} icon={variant === 'first' ? 'star' : 'sparkle'} disabled={blocked || planning || !text.trim()} data-testid="idea-go">
          {variant === 'first' ? t('home.go') : t('home.imagineIt')}
        </Button>
      </form>
      {verdict.kind === 'pii' && (
        <PiiWarning
          text={text}
          verdict={verdict}
          onRemove={(cleaned) => {
            setText(cleaned);
            setVerdict({ kind: 'allow' });
            field.current?.focus();
          }}
          onSendAnyway={verdict.block ? undefined : () => submit()}
        />
      )}
      {refusal && (
        <RefusalCard
          note={refusal.message}
          alternatives={refusal.alternatives}
          onPick={(alt) => {
            setRefusal(null);
            setText(alt);
            field.current?.focus();
          }}
        />
      )}
      <CrisisCard
        open={crisis}
        onClose={() => {
          setCrisis(false);
          setText('');
        }}
      />
      <AiExplainer
        open={explainer}
        onClose={() => {
          setExplainer(false);
          const idea = pending.current;
          pending.current = null;
          if (idea) send(idea);
        }}
        onWhatsSent={() => {
          // The idea waits in the box for the student's return.
          if (pending.current) setIdea(pending.current, hero);
          navigate({ name: 'page', page: 'sent' });
        }}
      />
    </section>
  );
}
