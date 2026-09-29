/**
 * One footstep (§2.9): a row with its footprint (the newest filled blue, a small dot for Amble's own
 * fixes), its words, a drawing's picture, the ✓ tested tag, the time, and — on hover or focus — ↺ Go back
 * to this step. A wish reads as the student's own step: "You wished: '…'", then what changed with See what
 * changed.
 */
import type { KeyboardEvent, Ref } from 'react';
import { t } from '../../i18n';
import { canSeeChange, fullTime, lookOf, splitText, timeAgo } from '../../history/summary';
import type { StepSummary } from '../../model/types';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { useStepSticker } from './useFootsteps';

export interface FootstepItemProps {
  step: StepSummary;
  now: number;
  /** The step the world is at (the newest). */
  isNow: boolean;
  /** Its snapshot is kept, and it isn't "now". */
  canGoBack: boolean;
  /** Folded: too old to go back to (shown under Earlier). */
  folded: boolean;
  /** Roving tabindex: the one step in the tab order. */
  tabbable: boolean;
  /** Just printed (plays the footstep print). */
  fresh: boolean;
  compact: boolean;
  busy: boolean;
  itemRef?: Ref<HTMLLIElement>;
  onFocusStep(): void;
  onKeyDown(e: KeyboardEvent<HTMLLIElement>): void;
  onGoBack(): void;
  onSeeChange(): void;
}

export function FootstepItem({ step, now, isNow, canGoBack, folded, tabbable, fresh, compact, busy, itemRef, onFocusStep, onKeyDown, onGoBack, onSeeChange }: FootstepItemProps) {
  const look = lookOf(step);
  const wish = step.request !== undefined;
  const { lead, rest } = splitText(step);
  const sticker = useStepSticker(step, !compact);
  const inner = tabbable ? 0 : -1;
  const change = canSeeChange(step) && look !== 'fix';
  const inlineChange = change && wish;
  const seeChange = (
    <button type="button" className="step__link" tabIndex={inner} onClick={onSeeChange}>
      {t('history.seeChange')}
    </button>
  );
  return (
    <li
      ref={itemRef}
      className={cx('step', `step--${look}`, isNow && 'step--now', fresh && 'step--fresh', folded && 'step--folded', compact && 'step--compact')}
      tabIndex={tabbable ? 0 : -1}
      data-step-id={step.id}
      data-kind={step.kind}
      onFocus={(e) => e.target === e.currentTarget && onFocusStep()}
      onKeyDown={onKeyDown}
    >
      <span className="step__fp" aria-hidden="true">
        {look !== 'fix' && <Icon name="footprint" size={16} />}
      </span>
      <div className="step__body">
        {wish ? (
          <>
            <p className="step__text">
              {isNow && <span className="sr-only">{t('history.now')} </span>}
              <b className="step__lead">{t('history.youWishedLead')}</b> {t('history.youWishedWords', { request: step.request ?? '' })}
            </p>
            <p className="step__sub">
              {step.text} {inlineChange && seeChange}
            </p>
          </>
        ) : (
          <p className="step__text">
            {isNow && <span className="sr-only">{t('history.now')} </span>}
            {lead && <b className="step__lead">{lead}</b>}
            {rest}
          </p>
        )}
        {(sticker || step.tested) && (
          <div className="step__extras">
            {sticker && <img className="step__thumb" src={sticker} alt="" draggable={false} />}
            {step.tested && (
              <span className="step__tested" title={t('history.testedHint')}>
                <Icon name="check" size={14} />
                {t('history.tested')}
              </span>
            )}
          </div>
        )}
        {(canGoBack || (change && !inlineChange)) && (
          <div className="step__actions">
            {canGoBack && (
              <button type="button" className="step__goback" tabIndex={inner} disabled={busy} onClick={onGoBack}>
                <Icon name="restart" size={16} />
                {t('history.goBack')}
              </button>
            )}
            {change && !inlineChange && seeChange}
          </div>
        )}
        {folded && <p className="step__folded">{t('history.goBackOld')}</p>}
      </div>
      <time className="step__time" dateTime={new Date(step.at).toISOString()} title={fullTime(step.at)}>
        {timeAgo(step.at, now)}
      </time>
    </li>
  );
}
