/**
 * "Turned Jump power up to 900. No AI needed." (§2.6, §5.10; M5): the toast over the world when an Ask was
 * answered by the local matcher, with **Undo** and **Ask the AI instead**. `SteerToastHost` is the
 * connected version (the last steer in the open world; it leaves after 10 s, or when dismissed).
 */
import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import type { LocalSteer } from '../../model/types';
import { clearSteer, steerToAi, undoSteer } from '../../state/ai';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { steerText } from './words';
import './ai.css';

export { steerText };

export interface SteerToastProps {
  steer: LocalSteer;
  onUndo(): void;
  onAskAi(): void;
  /** Hides the toast (the close button). */
  onDismiss?(): void;
}

export function SteerToast({ steer, onUndo, onAskAi, onDismiss }: SteerToastProps) {
  return (
    <div className="ai-steer" role="status" data-testid="ai-steer">
      <Icon name={steer.kind === 'dial' ? 'dial' : 'twist'} size={20} className="ai-steer__icon" />
      <p className="ai-steer__text">{steerText(steer)}</p>
      <div className="ai-steer__actions">
        <Button size={38} variant="ghost" icon="undo" onClick={onUndo}>
          {t('ai.steerUndo')}
        </Button>
        <Button size={38} variant="ai" icon="sparkle" onClick={onAskAi}>
          {t('ai.steerAskAi')}
        </Button>
        {onDismiss && <IconButton icon="close" label={t('common.dismiss')} size={38} tooltip={false} onClick={onDismiss} />}
      </div>
    </div>
  );
}

const SHOW_MS = 10_000;

/** The last steer in this world, over the world view (M2 places it; the e2e harness does too). */
export function SteerToastHost({ worldId }: { worldId: string }) {
  const rec = useStore((s) => (s.ai.steer?.worldId === worldId ? s.ai.steer : null));
  const hovered = useRef(false);
  useEffect(() => {
    if (!rec) return;
    const shownAt = Date.now();
    // It stays while the pointer or focus is on it (WCAG 2.2.1), then leaves on its own.
    const id = setInterval(() => {
      if (!hovered.current && Date.now() - shownAt >= SHOW_MS) clearSteer();
    }, 500);
    return () => clearInterval(id);
  }, [rec]);
  if (!rec) return null;
  return (
    <div
      className="ai-steer-host"
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
      onFocus={() => (hovered.current = true)}
      onBlur={() => (hovered.current = false)}
    >
      <SteerToast steer={rec.steer} onUndo={undoSteer} onAskAi={() => void steerToAi()} onDismiss={clearSteer} />
    </div>
  );
}
