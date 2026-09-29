/**
 * A drawing walking the trail (§2.4, §3.6): its baked walk strip played with `steps(8)` (0.8 s) while it
 * travels back and forth along the path (24-40 s, turning with ease-soft). Until its strip is made, and
 * for drawings without bones, it stands still as its picture, feet where the walk will put them. Paused,
 * or under reduced motion, it stands on its first frame. Clicking it opens the drawing on the Desk.
 */
import type { CSSProperties } from 'react';
import { navigate } from '../../app/router';
import { t } from '../../i18n';
import type { Strip } from '../../home/strips';
import type { ArtId } from '../../model/types';
import { cx } from '../../ui/cx';
import type { StillAt } from './useStrips';

export interface WalkerProps {
  id: ArtId;
  name: string;
  strip: Strip | null;
  still: string | null;
  /** The still picture's feet (default: its bottom centre, in a square box). */
  stillAt?: StillAt | null;
  /** Feet, in the trail's content px (y from the design's 768 px, bottom-anchored). */
  x: number;
  y: number;
  /** Height above the feet on screen. */
  height: number;
  /** How far it strolls (px) and how long a there-and-back takes (s); 0 = stands. */
  travel: number;
  duration: number;
  delay: number;
  /** Idle strip (no travel), for the lamppost's character. */
  idle?: boolean;
  /** In the tab order (each character once; its other copies are for looking at). */
  focusable?: boolean;
  /** What a click opens (default: the drawing on the Desk). */
  onOpen?: () => void;
  /** `y` is in the parent's own px (the lamppost's spot), not the trail's bottom-anchored design px. */
  local?: boolean;
  className?: string;
}

export function Walker({ id, name, strip, still, stillAt = null, x, y, height, travel, duration, delay, idle = false, focusable = false, onOpen, local = false, className }: WalkerProps) {
  const label = t('home.walkerLabel', { name });
  const open = onOpen ?? (() => navigate({ name: 'drawFree', artId: id }));
  const topOf = (py: number) => (local ? `${py}px` : `calc(100% - 768px + ${py}px)`);
  if (strip) {
    const s = height / Math.max(1, strip.footY - 4);
    const w = strip.frameW * s;
    const h = strip.frameH * s;
    const style = {
      left: x - strip.footX * s,
      top: topOf(y - strip.footY * s),
      width: w,
      height: h,
      ['--travel' as string]: `${travel}px`,
      ['--trip' as string]: `${duration}s`,
      ['--delay' as string]: `${delay}s`,
      ['--frames' as string]: strip.frames,
      ['--strip-w' as string]: `${w * strip.frames}px`,
      ['--step' as string]: `${strip.dur}s`,
      ['--foot-x' as string]: `${strip.footX * s}px`,
      ['--foot-y' as string]: `${strip.footY * s}px`,
    } as CSSProperties;
    return (
      <button
        type="button"
        className={cx('walker', idle && 'walker--idle', travel > 0 && 'walker--travels', className)}
        style={style}
        aria-label={label}
        tabIndex={focusable ? 0 : -1}
        onClick={open}
        data-testid="walker"
      >
        <span className="walker__turn">
          <span className="walker__shadow" aria-hidden="true" />
          {/* The strip slides behind a one-frame window (a transform, so the walk plays on the compositor
              and the sticker edge is never repainted); the edge is drawn around the window. */}
          <span className="walker__frame">
            <span className="walker__window">
              <span className="walker__sprite" style={{ backgroundImage: `url("${strip.url}")` }} />
            </span>
          </span>
        </span>
      </button>
    );
  }
  if (!still) return null;
  // The picture stands where its walk will start: feet on (x, y), as tall as its strip will be.
  const at = stillAt ?? { w: 1, h: 1, footX: 0.5, footY: 1 };
  const s = height / Math.max(1e-3, at.footY);
  const box = { left: x - at.footX * s, top: topOf(y - at.footY * s), width: at.w * s, height: at.h * s };
  return (
    <button
      type="button"
      className={cx('walker', 'walker--still', className)}
      style={{ ...box, ['--foot-x' as string]: `${at.footX * s}px`, ['--foot-y' as string]: `${at.footY * s}px` } as CSSProperties}
      aria-label={label}
      tabIndex={focusable ? 0 : -1}
      onClick={open}
      data-testid="walker"
    >
      <span className="walker__turn">
        <span className="walker__shadow" aria-hidden="true" />
        <img src={still} alt="" draggable={false} />
      </span>
    </button>
  );
}
