/**
 * A drawing walking the trail (§2.4, §3.6): its baked walk strip played with `steps(8)` (0.8 s) while it
 * travels back and forth in its pool of light (24-40 s, turning with ease-soft). Paused, or under
 * reduced motion, it stands on its first frame. Clicking it opens the drawing on the Desk.
 */
import type { CSSProperties } from 'react';
import { navigate } from '../../app/router';
import { t } from '../../i18n';
import type { Strip } from '../../home/strips';
import type { ArtId } from '../../model/types';
import { cx } from '../../ui/cx';

export interface WalkerProps {
  id: ArtId;
  name: string;
  strip: Strip | null;
  still: string | null;
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

export function Walker({ id, name, strip, still, x, y, height, travel, duration, delay, idle = false, focusable = false, onOpen, local = false, className }: WalkerProps) {
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
          {/* The strip slides behind a one-frame window (a transform, so the walk plays on the compositor
              and the sticker edge is never repainted); the edge is drawn around the window. */}
          <span className="walker__sprite">
            <span className="walker__window">
              <span className="walker__strip" style={{ backgroundImage: `url("${strip.url}")` }} />
            </span>
          </span>
        </span>
      </button>
    );
  }
  if (!still) return null;
  return (
    <button
      type="button"
      className={cx('walker', 'walker--still', className)}
      style={{ left: x - height * 0.5, top: topOf(y - height), width: height, height } as CSSProperties}
      aria-label={label}
      tabIndex={focusable ? 0 : -1}
      onClick={open}
      data-testid="walker"
    >
      <img src={still} alt="" draggable={false} />
    </button>
  );
}
