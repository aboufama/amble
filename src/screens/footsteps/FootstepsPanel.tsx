/** Footsteps (§2.9; M9 owns, used in the world's notebook). FOUNDATION-STUB: the steps' texts, newest first. */
import { t } from '../../i18n';
import type { WorldId } from '../../model/types';
import { useStore } from '../../state/store';
import { Panel } from '../../ui/components';

export interface FootstepsPanelProps {
  worldId: WorldId;
  compact?: boolean;
}

export function FootstepsPanel({ worldId }: FootstepsPanelProps) {
  const steps = useStore((s) => (s.session.world?.id === worldId ? s.session.world.steps : []));
  return (
    <Panel title={t('history.title')} className="stub-footsteps">
      <ol reversed>
        {[...steps].reverse().map((step) => (
          <li key={step.id}>{step.text}</li>
        ))}
      </ol>
    </Panel>
  );
}
