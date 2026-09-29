/**
 * The build pill (§2.5 Draw while it builds; M5 content for M3's Desk top bar and M2's Warm-up):
 * "Building your world · 64%" with footprints while a world builds (an estimate by phase), then
 * "Your world is ready · tested" in `--alive`. Renders nothing when that world has no build to show.
 */
import { t } from '../../i18n';
import type { WorldId } from '../../model/types';
import { progressPercent } from '../../pipeline/progress';
import { useStore } from '../../state/store';
import { Footprints, Meter } from '../../ui/components';
import { Icon } from '../../ui/icons';
import './ai.css';

export function BuildPill({ worldId }: { worldId: WorldId }) {
  const job = useStore((s) => (s.ai.job?.worldId === worldId && s.ai.job.task === 'build' ? s.ai.job : null));
  const outcome = useStore((s) => (s.ai.outcomeFor?.worldId === worldId && s.ai.outcomeFor.task === 'build' ? s.ai.lastOutcome : null));
  if (job) {
    const pct = progressPercent(job.progress, 'build');
    return (
      <div className="ai-pill" data-testid="ai-build-pill" data-state="building">
        <Footprints label={t('ai.buildPill', { n: pct })} />
        <span>{t('ai.buildPill', { n: pct })}</span>
        <Meter className="ai-pill__meter" label={t('ai.buildPill', { n: pct })} value={pct} max={100} tone="ai" />
      </div>
    );
  }
  if (outcome?.kind === 'accepted' || outcome?.kind === 'fallback') {
    const tested = outcome.kind === 'accepted' && outcome.tested;
    return (
      <div className="ai-pill ai-pill--ready" role="status" data-testid="ai-build-pill" data-state="ready">
        <Icon name="check" size={20} />
        <span>{tested ? t('ai.buildReady') : t('ai.buildReadyUntested')}</span>
      </div>
    );
  }
  return null;
}
