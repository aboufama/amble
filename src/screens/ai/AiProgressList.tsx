/**
 * The footprint list while the AI works (§2.8 Working; M5): Checking your words ✓ → Writing boss.js +34
 * lines → Checking the code → Testing your world → Fixing a small bug (1 of 2) (only when needed), the
 * busy or queued countdown while a request waits to be sent again, **Stop**, and the hero walking along a
 * thin progress line (standing still under reduced motion).
 */
import { useRef, type ReactNode } from 'react';
import { t } from '../../i18n';
import type { AiJobView, AiPhase } from '../../model/types';
import { progressPercent } from '../../pipeline/progress';
import { useStore } from '../../state/store';
import { useReducedMotion } from '../../ui/a11y';
import { Button, PlaceholderGlyph, Sticker } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { heroOf, useArtSticker, useCountdown } from './hooks';
import './ai.css';

export interface AiProgressListProps {
  job: AiJobView;
  onStop(): void;
}

type StepKey = 'checking' | 'writing' | 'validating' | 'testing' | 'fixing';
type StepState = 'done' | 'active' | 'pending';

const RANK: Record<AiPhase, number> = { queued: 0, checking: 1, planning: 1, writing: 2, validating: 3, testing: 4, fixing: 5, swapping: 6 };

function stateOf(step: StepKey, phase: AiPhase, fixing: boolean): StepState {
  if (phase === 'swapping') return 'done';
  if (fixing) return step === 'fixing' ? 'active' : 'done';
  const at = RANK[phase];
  const mine = RANK[step];
  return mine < at ? 'done' : mine === at ? 'active' : 'pending';
}

export function AiProgressList({ job, onStop }: AiProgressListProps) {
  const wait = useStore((s) => (s.ai.wait?.worldId === job.worldId ? s.ai.wait : null));
  const world = useStore((s) => (s.session.world?.id === job.worldId ? s.session.world : null));
  const manifest = useStore((s) => (s.session.world?.id === job.worldId ? s.session.manifest : null));
  const left = useCountdown(wait?.until ?? null);
  const reduced = useReducedMotion();
  const hero = heroOf(world, manifest);
  const sticker = useArtSticker(hero.art);
  const heroRig = manifest?.art.find((a) => a.key === hero.key)?.rig ?? 'biped';

  // A fix round, once started, stays the active step until the job ends (its reply streams again); a
  // retry wait keeps the steps where they were.
  const seen = useRef<{ job: number; round: 0 | 1 | 2; phase: AiPhase | null }>({ job: job.startedAt, round: 0, phase: null });
  if (seen.current.job !== job.startedAt) seen.current = { job: job.startedAt, round: 0, phase: null };
  const p = job.progress;
  if (p.phase === 'fixing') seen.current.round = p.round ?? 1;
  if (p.phase !== 'queued') seen.current.phase = p.phase;
  const phase: AiPhase = p.phase === 'queued' ? (seen.current.phase ?? 'queued') : p.phase;
  const round = seen.current.round;
  const fixing = round > 0 && phase !== 'swapping';

  const writing = phase === 'writing' && !fixing;
  const steps: Array<{ key: StepKey; label: ReactNode }> = [
    { key: 'checking', label: t('ai.stepChecking') },
    {
      key: 'writing',
      label:
        writing && p.file ? (
          <>
            {t('ai.stepWriting')} <span className="ai-step__file">{p.file}</span>
            {p.lines ? <span className="ai-step__lines">{t('ai.stepLines', { n: p.lines })}</span> : null}
          </>
        ) : (
          t('ai.stepWriting')
        ),
    },
    { key: 'validating', label: t('ai.stepValidating') },
    { key: 'testing', label: t('ai.stepTesting') },
  ];
  if (round > 0) steps.push({ key: 'fixing', label: t('ai.stepFixing', { round }) });

  const pct = progressPercent(p, job.task === 'plan' ? 'plan' : job.task);
  const waiting = wait && left !== null && left > 0;
  const stateWords: Record<StepState, string> = { done: t('ai.stepStateDone'), active: t('ai.stepStateNow'), pending: t('ai.stepStateNext') };

  return (
    <div className="ai-progress" aria-busy="true" data-testid="ai-progress" data-phase={p.phase}>
      {waiting && (
        <p className="ai-progress__wait" data-testid="ai-wait">
          {wait.reason === 'rate-limited' ? t('ai.busyRetry', { s: left }) : t('ai.queued', { s: left })}
        </p>
      )}
      <ol className="ai-steps" aria-label={t('ai.progressLabel')}>
        {steps.map((s) => {
          const state = stateOf(s.key, phase, fixing);
          return (
            <li key={s.key} className={cx('ai-step', `ai-step--${state}`)} data-step={s.key} data-state={state}>
              <span className="ai-step__mark" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={16} /> : state === 'active' ? <Icon name="footprint" size={14} /> : null}
              </span>
              <span className="ai-step__label">
                {s.label}
                <span className="sr-only"> ({stateWords[state]})</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="ai-walk" aria-hidden="true">
        <span className="ai-walk__line" />
        <span className="ai-walk__done" style={{ width: `${pct}%` }} />
        <span className={cx('ai-walk__hero', !reduced && 'ai-walk__hero--walking')} style={{ left: `${Math.min(96, Math.max(4, pct))}%` }}>
          {sticker ? <Sticker src={sticker} alt="" size={36} /> : <PlaceholderGlyph rig={heroRig} role="hero" size={36} />}
        </span>
      </div>
      <div className="ai-progress__foot">
        <p className="ai-progress__keep">{t('ai.keepPlaying')}</p>
        <Button size={38} variant="ghost" onClick={onStop} data-testid="ai-stop">
          {t('ai.stop')}
        </Button>
      </div>
    </div>
  );
}
