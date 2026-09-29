/** The footprint list while the AI works (§2.8; M5 owns). FOUNDATION-STUB: the footprints and the phase. */
import type { AiJobView } from '../../model/types';
import { Footprints } from '../../ui/components';

export interface AiProgressListProps {
  job: AiJobView;
  onStop(): void;
}

export function AiProgressList({ job }: AiProgressListProps) {
  return <Footprints label={job.progress.phase} />;
}
