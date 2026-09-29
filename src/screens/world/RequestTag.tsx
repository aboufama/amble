/**
 * The request tag (§2.6): a flat card at the world view's bottom left, only at a pause, a lost life, a
 * win or loss, or after 5 s of idle ("The Grumbles are only bones. Draw one and they all come alive."
 * [Draw a Grumble] [Later]); in a Warm-up it asks at once. Also the ghost coach mark, once per device:
 * "Dashed = not drawn yet. Tap any dashed outline to draw it. The game keeps its place."
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { CastMember } from '../../model/types';
import { markSeen } from '../../state/prefs';
import { patchSession, updateWorld } from '../../state/session';
import { useStore } from '../../state/store';
import { Button, IconButton, PlaceholderGlyph } from '../../ui/components';
import { cx } from '../../ui/cx';
import type { Box } from '../../world/objects';
import { requestCopy } from '../../world/hints';
import { laterUntil } from '../../world/requestPolicy';
import { problemToShow } from './ProblemCard';

export function RequestTag({ onDraw }: { onDraw(member: CastMember, from: HTMLElement): void }) {
  const request = useStore((s) => s.session.request);
  const member = useStore((s) => (s.session.request ? s.session.cast.find((m) => m.key === s.session.request?.key) ?? null : null));
  // The new-version card and the problem card sit in the same corner and matter more: the tag waits.
  const busyCorner = useStore((s) => !!s.session.newVersion?.ready || !!problemToShow(s.session.problems));
  const glyph = useRef<HTMLSpanElement>(null);
  if (!request || !member || busyCorner) return null;
  const copy = requestCopy(member, request.trigger === 'warmup');
  const later = () => {
    const key = member.key;
    updateWorld((w) => {
      const slot = w.cast[key];
      if (slot) slot.laterUntil = laterUntil(Date.now());
    }, { touch: false });
    patchSession({ request: null });
  };
  return (
    <div className="request-tag world-card" role="status" data-testid="request-tag" data-key={member.key}>
      <span ref={glyph} className="request-tag__glyph" aria-hidden="true">
        <PlaceholderGlyph rig={member.rig} role={member.role} shape={member.shape} size={44} />
      </span>
      <p className="request-tag__text">
        <strong>{copy.title}</strong>
        <span>{copy.body}</span>
      </p>
      <Button
        variant="lantern"
        size={38}
        onClick={() => {
          patchSession({ request: null });
          onDraw(member, glyph.current ?? document.body);
        }}
        data-testid="request-draw"
      >
        {copy.button}
      </Button>
      <Button variant="quiet" size={38} className="request-tag__later" onClick={later}>
        {t('world.later')}
      </Button>
    </div>
  );
}

const NOTE_W = 300;
/** How long the coach mark stays before it counts as seen. */
export const COACH_MS = 12_000;

/** Where the coach mark sits: beside the "just bones" member it points at, inside the world view. */
export function coachPlace(box: Box | null, frame: { width: number; height: number }): { left: number; top: number; side: 'left' | 'right' | null } {
  if (!box) return { left: Math.round((frame.width - NOTE_W) / 2), top: 68, side: null };
  const rightOfIt = box.x + box.w / 2 < frame.width / 2;
  const left = rightOfIt ? box.x + box.w + 24 : box.x - NOTE_W - 24;
  const top = Math.min(Math.max(64, box.y + Math.min(box.h, 120) / 2 - 50), frame.height - 130);
  return { left: Math.min(Math.max(12, left), frame.width - NOTE_W - 12), top, side: rightOfIt ? 'left' : 'right' };
}

/** The ghost coach mark (§2.6), once per device, the first time "just bones" members are on screen. */
export function CoachMark({ pointer, frame, locate }: { pointer: boolean; frame: DOMRect | null; locate(key: string): Promise<Box | null> }) {
  const seen = useStore((s) => !!s.prefs.seen.ghostTip);
  const target = useStore((s) =>
    s.session.ready && s.session.mode === 'play' && !s.session.request && !s.session.problems.some((p) => p.fatal)
      ? (s.session.cast.find((m) => m.status === 'needed' && m.onScreen)?.key ?? null)
      : null,
  );
  const [box, setBox] = useState<Box | null>(null);
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (seen || !target) return;
    let live = true;
    void locate(target).then((b) => {
      if (!live) return;
      setBox(b);
      setPlaced(true);
    });
    return () => {
      live = false;
    };
  }, [seen, target, locate]);
  // Once it has been read for a while, it is seen: it never covers the game for long.
  useEffect(() => {
    if (seen || !placed) return;
    const timer = setTimeout(() => markSeen('ghostTip'), COACH_MS);
    return () => clearTimeout(timer);
  }, [seen, placed]);
  if (seen || !target || !placed || !frame) return null;
  const at = coachPlace(box, frame);
  return (
    <div
      className={cx('coach-mark world-card', at.side && `coach-mark--${at.side}`)}
      style={{ left: at.left, top: at.top }}
      role="note"
      data-testid="coach-mark"
    >
      <p className="coach-mark__text">
        <strong>{pointer ? t('world.coachPointerTitle') : t('world.coachTitle')}</strong>
        <span>{pointer ? t('world.coachPointerBody') : t('world.coachBody')}</span>
      </p>
      <IconButton icon="close" label={t('world.gotIt')} size={38} variant="quiet" className="coach-mark__close" onClick={() => markSeen('ghostTip')} />
    </div>
  );
}
