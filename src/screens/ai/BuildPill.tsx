/**
 * The build pill (§2.5 Draw while it builds; M5 content for the Desk's top bar): "Building your world…"
 * with a thin indeterminate bar while a world builds (no percentage: the machinery stays out of sight),
 * then "Your world is ready!". It takes the colour of the bar it sits in (words and edge are
 * `currentColor`), so it reads on a blue top bar and a light one alike. Nothing when there is no build.
 * (The slice announces "Your world is ready!" when the build lands.)
 */
import { t } from '../../i18n';
import type { WorldId } from '../../model/types';
import { useStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import './ai.css';

export function BuildPill({ worldId }: { worldId: WorldId }) {
  const job = useStore((s) => (s.ai.job?.worldId === worldId && s.ai.job.task === 'build' ? s.ai.job : null));
  const outcome = useStore((s) => (s.ai.outcomeFor?.worldId === worldId && s.ai.outcomeFor.task === 'build' ? s.ai.lastOutcome : null));
  if (job) {
    return (
      <div className="wish-pill" data-testid="ai-build-pill" data-state="building">
        <span>{t('ai.buildPill')}</span>
        <span className="wish-bar wish-pill__bar" aria-hidden="true">
          <span className="wish-bar__run" />
        </span>
      </div>
    );
  }
  if (outcome?.kind === 'accepted' || outcome?.kind === 'fallback') {
    return (
      <div className="wish-pill wish-pill--ready" data-testid="ai-build-pill" data-state="ready">
        <Icon name="check" size={18} />
        <span>{t('ai.buildReady')}</span>
      </div>
    );
  }
  return null;
}
