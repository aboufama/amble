/**
 * The idea box (§2.3, §2.5): "Or describe a whole new world" on the First page and the New world sheet.
 * It is there only when wishes are available; otherwise the world cards are the whole choice. The words
 * are checked on the device as the student types (400 ms after typing stops): personal info shows the
 * warning, a crisis shows the support card and nothing is sent. Sending starts the plan and goes to the
 * plan card. **How wishes work** opens the short, honest explainer, only when the student asks.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { startPlan, setIdea, usePlanSession, type PlanHero } from '../../home/planSession';
import { useAiView } from '../../home/useAiStatus';
import type { SafetyVerdict } from '../../model/types';
import { getState, useStore } from '../../state/store';
import { Button } from '../../ui/components';
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
  autoFocus?: boolean;
  /** Called once the plan call has started (the sheet shows its waiting state). */
  onPlanning?(): void;
  className?: string;
}

const MAX = 300;

export function IdeaBox({ variant, hero, autoFocus = false, onPlanning, className }: IdeaBoxProps) {
  const { ai, starters } = useServices();
  const view = useAiView();
  const session = usePlanSession();
  const level = useStore((s) => s.config.level);
  const [text, setText] = useState(() => (session.hero?.id === hero?.id || !hero ? session.idea : ''));
  const [verdict, setVerdict] = useState<SafetyVerdict>({ kind: 'allow' });
  const [refusal, setRefusal] = useState<Extract<SafetyVerdict, { kind: 'refuse' }> | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [explainer, setExplainer] = useState(false);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const fieldId = useId();
  const titleId = useId();

  // In a sheet, the dialog focuses its [data-autofocus] element once it opens (showModal() would move focus
  // to its first button after this runs); on a page this puts the caret in the field.
  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus, view.on]);

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

  // Wishes aren't available here (off, not set up, offline, blocked...): just the world cards.
  if (!view.on) return null;

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
  // Beside the title on the wide sheet, under the field in the First page's narrower column.
  const how = (
    <Button variant="quiet" size={38} icon="info" className="idea-box__how" onClick={() => setExplainer(true)} data-testid="how-wishes">
      {t('home.howWishesWork')}
    </Button>
  );

  return (
    <section className={cx('idea-box', `idea-box--${variant}`, className)} aria-labelledby={titleId} data-testid="idea-box">
      <div className="idea-box__head">
        {variant === 'first' ? (
          <h2 id={titleId} className="idea-box__title">
            {t('home.ideaTitle')}
          </h2>
        ) : (
          <label id={titleId} htmlFor={fieldId} className="idea-box__title">
            {t('home.ideaTitle')}
          </label>
        )}
        {variant === 'sheet' && how}
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
        <Button type="submit" variant="lantern" size={44} disabled={blocked || planning || !text.trim()} data-testid="idea-go">
          {variant === 'first' ? t('home.go') : t('home.imagineIt')}
        </Button>
      </form>
      {variant === 'first' && <div className="idea-box__foot">{how}</div>}
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
        onClose={() => setExplainer(false)}
        onWhatsSent={() => {
          // The idea waits in the box for the student's return.
          if (text.trim()) setIdea(text.trim(), hero);
          navigate({ name: 'page', page: 'sent' });
        }}
      />
    </section>
  );
}
