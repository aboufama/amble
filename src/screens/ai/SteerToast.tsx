/** "Turned Jump power up to 900. No AI needed." (§2.6; M5 owns). FOUNDATION-STUB: renders nothing. */
import type { LocalSteer } from '../../model/types';

export interface SteerToastProps {
  steer: LocalSteer;
  onUndo(): void;
  onAskAi(): void;
}

export function SteerToast(_props: SteerToastProps) {
  return null;
}
