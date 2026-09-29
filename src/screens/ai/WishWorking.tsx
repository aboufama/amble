/**
 * While a wish is worked on (§2.8 Working, as MAGIC-BRIEF.md has it): "Working on it…" with a thin
 * indeterminate bar and **Stop**. No phases and no counters; the game keeps playing and the robot test
 * runs out of sight. A wish waiting its turn says so in plain words ("Lots of wishes right now…").
 */
import { t } from '../../i18n';
import type { AiJobView } from '../../model/types';
import { useStore } from '../../state/store';
import { Button } from '../../ui/components';
import { useCountdown } from './hooks';
import { waitText } from './words';
import './ai.css';

export interface WishWorkingProps {
  job: AiJobView;
  onStop(): void;
}

/** The thin bar that says "something is happening" without saying how much. */
export function WishBar({ label }: { label: string }) {
  return (
    <span className="wish-bar" role="progressbar" aria-label={label}>
      <span className="wish-bar__run" />
    </span>
  );
}

export function WishWorking({ job, onStop }: WishWorkingProps) {
  const wait = useStore((s) => (s.ai.wait?.worldId === job.worldId ? s.ai.wait : null));
  const left = useCountdown(wait?.until ?? null);
  const waiting = wait && left !== null && left > 0;
  const words = job.task === 'build' ? t('ai.building') : t('ai.working');
  return (
    <div className="wish-working" aria-busy="true" data-testid="ai-progress" data-phase={job.progress.phase}>
      <div className="wish-working__row">
        <p className="wish-working__text">
          {waiting ? (
            <span data-testid="ai-wait">{waitText(left, wait.reason)}</span>
          ) : (
            words
          )}
        </p>
        <Button size={38} variant="ghost" onClick={onStop} data-testid="ai-stop">
          {t('ai.stop')}
        </Button>
      </div>
      <WishBar label={words} />
    </div>
  );
}
