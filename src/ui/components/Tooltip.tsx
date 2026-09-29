/**
 * Tooltip (§3.4): shows on hover and on keyboard focus after 500 ms, hides on leave, blur or Esc
 * (WCAG 1.4.13). Never the only label: the wrapped control keeps its own name; the tooltip repeats or adds
 * to it (`describe` links it as a description when it says more than the name).
 */
import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { layerRoot } from '../a11y';

const DELAY_MS = 500;

export interface TooltipProps {
  label: string;
  /** One control (it keeps its own accessible name). */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  placement?: 'top' | 'bottom';
  /** Link the tooltip as the control's description (when it adds words the name lacks). */
  describe?: boolean;
}

export function Tooltip({ label, children, placement = 'bottom', describe = false }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), DELAY_MS);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const tw = tip.current.offsetWidth;
    const th = tip.current.offsetHeight;
    const left = Math.min(Math.max(8, a.left + a.width / 2 - tw / 2), window.innerWidth - tw - 8);
    const below = a.bottom + 8;
    const top = placement === 'top' || below + th > window.innerHeight - 8 ? Math.max(8, a.top - th - 8) : below;
    setPos({ left, top });
  }, [open, placement, label]);

  return (
    <span
      ref={anchor}
      className="tooltip-anchor"
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={hide}
      onFocus={(e) => (e.target as HTMLElement).matches(':focus-visible') && show()}
      onBlur={hide}
    >
      {describe && open ? cloneElement(children, { 'aria-describedby': id }) : children}
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
            onPointerEnter={() => timer.current && clearTimeout(timer.current)}
          >
            {label}
          </div>,
          layerRoot(),
        )}
    </span>
  );
}
