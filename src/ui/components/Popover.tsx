/**
 * Popover (§3.4): an anchored, non-modal card with an arrow (thing cards, cast menus). Focus moves into
 * it when it opens and back to the anchor when it closes; Esc and a click outside close it. It never
 * covers the focused element (it sits beside its anchor).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushEscape } from '../../app/keys';
import { layerRoot } from '../a11y';
import { cx } from '../cx';

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface PopoverProps {
  open: boolean;
  /** The element (or screen rect) the card points at. */
  anchor: HTMLElement | DOMRect | null;
  onClose(): void;
  /** Names the card for screen readers. */
  label: string;
  placement?: Placement;
  /** Lantern border (Change mode's thing card). */
  tone?: 'night' | 'lantern' | 'paper';
  className?: string;
  children?: ReactNode;
}

const GAP = 12;

function rectOf(anchor: HTMLElement | DOMRect): DOMRect {
  return anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
}

export function Popover({ open, anchor, onClose, label, placement = 'bottom', tone = 'night', className, children }: PopoverProps) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: Placement; arrow: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !anchor || !card.current) return;
    const a = rectOf(anchor);
    const w = card.current.offsetWidth;
    const h = card.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = placement;
    if (side === 'bottom' && a.bottom + GAP + h > vh) side = 'top';
    else if (side === 'top' && a.top - GAP - h < 0) side = 'bottom';
    else if (side === 'right' && a.right + GAP + w > vw) side = 'left';
    else if (side === 'left' && a.left - GAP - w < 0) side = 'right';
    let left: number;
    let top: number;
    if (side === 'top' || side === 'bottom') {
      left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), vw - w - 8);
      top = side === 'bottom' ? a.bottom + GAP : a.top - GAP - h;
    } else {
      top = Math.min(Math.max(8, a.top + a.height / 2 - h / 2), vh - h - 8);
      left = side === 'right' ? a.right + GAP : a.left - GAP - w;
    }
    const arrow = side === 'top' || side === 'bottom' ? a.left + a.width / 2 - left : a.top + a.height / 2 - top;
    setPos({ left, top, side, arrow });
  }, [open, anchor, placement]);

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = card.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first ?? card.current)?.focus({ preventScroll: true });
    const offEsc = pushEscape(
      () => {
        closeRef.current();
        return true;
      },
      () => card.current,
    );
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (card.current?.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      closeRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      offEsc();
      window.removeEventListener('pointerdown', onDown, true);
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={card}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cx('popover', `popover--${tone}`, pos && `popover--${pos.side}`, tone === 'paper' && 'on-paper', className)}
      style={pos ? { left: pos.left, top: pos.top, ['--arrow' as string]: `${pos.arrow}px` } : { visibility: 'hidden', left: 0, top: 0 }}
    >
      {children}
    </div>,
    layerRoot(),
  );
}
