/**
 * The one toast a wish leaves in the world (§2.8 Done, §2.6 local steer, MAGIC-BRIEF.md):
 * - a wish that landed: "Done! The Moon King throws fireballs now." **See what changed** **Undo**;
 * - a wish the device answered with a dial or a twist: "Turned Jump height up to 7." **Undo**
 *   **Make a wish instead**.
 *
 * It lives in the world it belongs to (the World places `WishToastHost` over the world view), so it never
 * follows the student to other screens. It shows once the change is really playing (while the new version
 * loads, or waits for a pause, it waits too), stays while pointed at or focused (WCAG 2.2.1), leaves after
 * 12 s, and is dropped if the student comes back more than 2 minutes later. The newest of the two shows.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { LocalSteer } from '../../model/types';
import { clearLanded, clearSteer, seeWish, steerToWish, undoSteer, undoWish, type LandedWish } from '../../state/ai';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { steerText } from './words';
import './ai.css';

export { steerText };

const SHOW_MS = 12_000;
const STALE_MS = 120_000;

export interface SteerToastProps {
  steer: LocalSteer;
  onUndo(): void;
  /** Make a wish instead (only while wishes can happen). */
  onWish?(): void;
  /** Hides the toast (the close button). */
  onDismiss?(): void;
}

/** "Turned Jump power up to 900." Undo, Make a wish instead. */
export function SteerToast({ steer, onUndo, onWish, onDismiss }: SteerToastProps) {
  return (
    <div className="wish-toast" data-testid="ai-steer">
      <span className="wish-toast__mark wish-toast__mark--steer" aria-hidden="true">
        <Icon name={steer.kind === 'dial' ? 'dial' : 'twist'} size={18} />
      </span>
      <p className="wish-toast__text">{steerText(steer)}</p>
      <div className="wish-toast__actions">
        <Button size={38} variant="ghost" icon="undo" onClick={onUndo}>
          {t('ai.steerUndo')}
        </Button>
        {onWish && (
          <Button size={38} variant="ghost" onClick={onWish}>
            {t('ai.steerWish')}
          </Button>
        )}
        {onDismiss && <IconButton icon="close" label={t('common.dismiss')} size={38} tooltip={false} onClick={onDismiss} />}
      </div>
    </div>
  );
}

/** "Done! The Moon King throws fireballs now." See what changed, Undo. */
export function DoneToast({ landed, onSee, onUndo, onDismiss }: { landed: LandedWish; onSee(): void; onUndo(): void; onDismiss?(): void }) {
  return (
    <div className="wish-toast wish-toast--done" data-testid="wish-done">
      <span className="wish-toast__mark" aria-hidden="true">
        <Icon name="check" size={18} />
      </span>
      <p className="wish-toast__text">{landed.text}</p>
      <div className="wish-toast__actions">
        <Button size={38} variant="ghost" icon="eye" onClick={onSee}>
          {t('ai.seeWhatChanged')}
        </Button>
        {landed.stepId && (
          <Button size={38} variant="ghost" icon="undo" onClick={onUndo}>
            {t('ai.undo')}
          </Button>
        )}
        {onDismiss && <IconButton icon="close" label={t('common.dismiss')} size={38} tooltip={false} onClick={onDismiss} />}
      </div>
    </div>
  );
}

/** The wish toast of one world, over its world view (the World places it; the e2e harness does too). */
export function WishToastHost({ worldId }: { worldId: string }) {
  const steer = useStore((s) => (s.ai.steer?.worldId === worldId ? s.ai.steer : null));
  const landed = useStore((s) => (s.ai.landed?.worldId === worldId ? s.ai.landed : null));
  // Held back until the change really plays: while the new version loads, or waits for a pause.
  const held = useStore((s) => s.session.world?.id === worldId && (!s.session.ready || !!s.session.newVersion?.ready));
  const canWish = useStore((s) => s.ai.status === 'ready');
  const hovered = useRef(false);

  // The newest one shows; a landed wish only once its new version plays.
  const done = landed && !held && (!steer || landed.at >= steer.at) ? landed : null;
  const shown = done ?? (steer && (!landed || steer.at > landed.at) ? steer : null);
  const key = shown ? `${done ? 'done' : 'steer'}:${shown.at}` : null;
  const [since, setSince] = useState<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!key || !shown) return;
    const shownAt = Date.now();
    // Back in the world long after the wish landed: it is old news, and Footsteps has it.
    if (done && shownAt - done.at > STALE_MS) {
      clearLanded();
      return;
    }
    setSince({ key, at: shownAt });
    const clear = done ? clearLanded : clearSteer;
    const id = setInterval(() => {
      if (!hovered.current && Date.now() - shownAt >= SHOW_MS) clear();
    }, 500);
    return () => clearInterval(id);
    // `shown` and `done` are what `key` names: the timer starts once per toast.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown || (done && since?.key !== key && Date.now() - done.at > STALE_MS)) return null;
  return (
    <div
      className="wish-toast-host"
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
      onFocus={() => (hovered.current = true)}
      onBlur={() => (hovered.current = false)}
    >
      {done ? (
        <DoneToast key={key} landed={done} onSee={seeWish} onUndo={() => void undoWish()} onDismiss={clearLanded} />
      ) : (
        steer && <SteerToast key={key} steer={steer.steer} onUndo={undoSteer} onWish={canWish ? () => void steerToWish() : undefined} onDismiss={clearSteer} />
      )}
    </div>
  );
}
