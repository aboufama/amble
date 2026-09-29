/**
 * The stars (§2.11, §3.9): one button per joint, 24 px with a 44 px hit area, lettered L or R. Drag a
 * star and the bones that meet there stretch (the drawing never moves); or Tab to it and nudge it with
 * the arrow keys (Shift: 10), or press Enter to pick it up, move it, and Enter again to drop it (Esc
 * puts it back). In wiggly mode, dragging out of a star (or Enter on it) grows a wiggly bit.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { moveJoint, type Point, type RigData } from '../../cores/rig';
import type { BonesController } from '../../bones/bonesController';
import { clampTo, isArrowKey, nudge, roundPoint, starBounds, toArt, toSky, type Fit } from '../../bones/geometry';
import type { Star } from '../../bones/words';
import { useEscape } from '../../app/keys';
import { t } from '../../i18n';
import { announce } from '../../state/app';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';

export interface JointLayerProps {
  ctl: BonesController;
  rig: RigData;
  /** In a stable Tab order. */
  stars: Star[];
  fit: Fit;
  sky: { w: number; h: number };
  skyEl: RefObject<HTMLDivElement | null>;
  selected: string | null;
  onSelect(id: string | null): void;
  busy: boolean;
  wiggly: boolean;
  /** The wiggly bit being dragged out, in sky px (null when none). */
  onWigglyLine(line: [Point, Point] | null): void;
  /** A wiggly bit was added (its end star's id) or the mode was left. */
  onWigglyDone(tip: string | null): void;
  /** A star that should take focus (a new wiggly bit's end), then `onFocused`. */
  focusStar: string | null;
  onFocused(): void;
}

interface Drag {
  id: string;
  side: Star['joint']['side'];
  pointer: number;
  x0: number;
  y0: number;
  base: RigData;
  from: Point;
  moved: boolean;
  wasSelected: boolean;
  mode: 'move' | 'wiggly';
  last: Point | null;
}

const BUBBLE_W = 236;
const BUBBLE_H = 104;

export function JointLayer({ ctl, rig, stars, fit, sky, skyEl, selected, onSelect, busy, wiggly, onWigglyLine, onWigglyDone, focusStar, onFocused }: JointLayerProps) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const sayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    clearTimeout(sayTimer.current);
  }, []);

  const bounds = starBounds(fit, sky.w, sky.h);
  const byId = new Map(stars.map((s) => [s.sid, s]));

  const sayLater = (text: string) => {
    clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => announce(text), 450);
  };

  // Esc while a star is picked up puts it back where it was
  useEscape(
    () => {
      if (!picked) return false;
      ctl.cancelPreview();
      const star = byId.get(picked);
      setPicked(null);
      if (star) announce(t('bones.jointBack', { label: star.name.toLocaleLowerCase() }));
      return true;
    },
    picked !== null,
  );

  const artAt = (clientX: number, clientY: number): Point | null => {
    const r = skyEl.current?.getBoundingClientRect();
    if (!r) return null;
    return clampTo(toArt(fit, clientX - r.left, clientY - r.top), bounds);
  };

  const apply = () => {
    frame.current = 0;
    const d = drag.current;
    const p = pending.current;
    if (!d || !p) return;
    const at = artAt(p.x, p.y);
    if (!at) return;
    d.last = at;
    if (d.mode === 'move') ctl.preview(moveJoint(d.base, d.id, at[0], at[1]));
    else onWigglyLine([toSky(fit, d.from[0], d.from[1]), toSky(fit, at[0], at[1])]);
  };

  const onDown = (e: PointerEvent<HTMLButtonElement>, star: Star) => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const wasSelected = selected === star.sid;
    e.currentTarget.focus({ preventScroll: true });
    if (picked && picked !== star.sid) {
      ctl.endPreview();
      setPicked(null);
    }
    drag.current = {
      id: star.sid, side: star.joint.side, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, base: rig, from: [star.joint.x, star.joint.y],
      moved: false, wasSelected, mode: wiggly ? 'wiggly' : 'move', last: null,
    };
  };

  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
      d.moved = true;
      if (d.mode === 'move') {
        playUiSound('pick');
        setDragging(d.id);
      }
    }
    pending.current = { x: e.clientX, y: e.clientY };
    if (!frame.current) frame.current = requestAnimationFrame(apply);
  };

  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      apply();
    }
    drag.current = null;
    pending.current = null;
    if (d.mode === 'wiggly') {
      onWigglyLine(null);
      if (d.moved && d.last) onWigglyDone(ctl.addWiggly(d.id, d.last));
      return;
    }
    if (!d.moved) {
      // a tap shows the star's name (a second tap hides it)
      onSelect(d.wasSelected ? null : d.id);
      return;
    }
    setDragging(null);
    ctl.endPreview(d.side);
    playUiSound('put');
    const star = byId.get(d.id);
    if (star && d.last) {
      const [x, y] = roundPoint(d.last[0], d.last[1]);
      announce(t('bones.jointDropped', { label: star.name.toLocaleLowerCase(), x, y }));
    }
  };

  const onCancel = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setDragging(null);
    if (d.mode === 'wiggly') onWigglyLine(null);
    else ctl.cancelPreview();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, star: Star) => {
    if (busy) return;
    const j = star.joint;
    if (isArrowKey(e.key)) {
      e.preventDefault();
      const [x, y] = nudge([j.x, j.y], e.key, e.shiftKey, bounds);
      if (picked === star.sid) ctl.preview(moveJoint(rig, star.sid, x, y));
      else ctl.edit(moveJoint(rig, star.sid, x, y), { coalesce: `nudge:${star.sid}`, side: j.side });
      sayLater(t('bones.jointAt', { x, y }));
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const label = star.name.toLocaleLowerCase();
    if (wiggly) {
      onWigglyDone(ctl.addWigglyFrom(star.sid));
      return;
    }
    if (picked === star.sid) {
      ctl.endPreview(j.side);
      setPicked(null);
      playUiSound('put');
      const [x, y] = roundPoint(j.x, j.y);
      announce(t('bones.jointDropped', { label, x, y }));
    } else {
      if (picked) ctl.endPreview();
      ctl.settle();
      setPicked(star.sid);
      onSelect(star.sid);
      playUiSound('pick');
      announce(t('bones.jointPicked', { label }));
    }
  };

  const onBlur = (star: Star) => {
    // Tab away while holding a star drops it where it is
    if (picked === star.sid) {
      ctl.endPreview(star.joint.side);
      setPicked(null);
    }
    ctl.settle();
  };

  // a new wiggly bit's end star takes focus, so arrows can shape it at once
  useEffect(() => {
    if (!focusStar) return;
    const button = buttons.current.get(focusStar);
    if (!button) return;
    button.focus({ preventScroll: true });
    onFocused();
  }, [focusStar, stars, onFocused]);

  const bubble = selected && !dragging ? byId.get(selected) : undefined;

  return (
    <div className={cx('joints', busy && 'joints--busy', wiggly && 'joints--wiggly')}>
      {stars.map((star) => {
        const j = star.joint;
        const [sx, sy] = toSky(fit, j.x, j.y);
        const [x, y] = roundPoint(j.x, j.y);
        const tip = j.ends.every((end) => end.end === 1);
        return (
          <button
            key={star.sid}
            ref={(el) => {
              if (el) buttons.current.set(star.sid, el);
              else buttons.current.delete(star.sid);
            }}
            type="button"
            className={cx(
              'joint',
              `joint--${j.side}`,
              tip && 'joint--tip',
              selected === star.sid && 'joint--selected',
              picked === star.sid && 'joint--picked',
              dragging === star.sid && 'joint--dragging',
            )}
            style={{ left: sx, top: sy }}
            data-joint={star.sid}
            aria-label={t('bones.jointLabel', { label: star.name, x, y })}
            aria-disabled={busy || undefined}
            onPointerDown={(e) => onDown(e, star)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
            onKeyDown={(e) => onKey(e, star)}
            onFocus={() => onSelect(star.sid)}
            onBlur={() => onBlur(star)}
          >
            <span className="joint__dot" aria-hidden="true">
              {j.side !== 'C' ? j.side : null}
            </span>
            {picked === star.sid && <span className="joint__cross" aria-hidden="true" />}
          </button>
        );
      })}
      {bubble && <NameBubble star={bubble} fit={fit} sky={sky} />}
    </div>
  );
}

/** The star's name and how to move it, beside the star and never over it (§2.11, WCAG 2.4.11). */
function NameBubble({ star, fit, sky }: { star: Star; fit: Fit; sky: { w: number; h: number } }) {
  const joint = star.joint;
  const name = star.name;
  const [sx, sy] = toSky(fit, joint.x, joint.y);
  const gap = 28;
  let side: 'left' | 'right' = joint.side === 'L' ? 'left' : 'right';
  let left = side === 'left' ? sx - gap - BUBBLE_W : sx + gap;
  if (left < 8) {
    side = 'right';
    left = sx + gap;
  } else if (left + BUBBLE_W > sky.w - 8) {
    side = 'left';
    left = sx - gap - BUBBLE_W;
  }
  left = Math.max(8, Math.min(sky.w - BUBBLE_W - 8, left));
  const top = Math.max(8, Math.min(sky.h - BUBBLE_H - 8, sy - BUBBLE_H * 0.7));
  const arrow = Math.max(18, Math.min(BUBBLE_H - 18, sy - top));
  return (
    <div className={cx('joint-tip', `joint-tip--${side}`)} style={{ left, top, width: BUBBLE_W, ['--arrow' as string]: `${arrow}px` }} aria-hidden="true">
      <b className="joint-tip__name">{name}</b>
      <span className="joint-tip__help">{t('bones.jointHelp')}</span>
    </div>
  );
}
