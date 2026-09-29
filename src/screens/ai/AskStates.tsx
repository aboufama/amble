/**
 * The inside of the Ask card, in every state of §2.8 (M5 owns; M2's AskCard is the shell).
 * FOUNDATION-STUB: the AI-off line.
 */
import type { GameManifest } from '../../cores/play';
import { t } from '../../i18n';
import type { CastKey, World } from '../../model/types';

export interface AskStatesProps {
  world: World;
  manifest: GameManifest | null;
  /** Change mode's scope ("About the Moon King ✕"). */
  scope: CastKey | null;
  onClearScope(): void;
}

export function AskStates(_props: AskStatesProps) {
  return <p className="stub-ai">{t('common.aiOff')}</p>;
}
