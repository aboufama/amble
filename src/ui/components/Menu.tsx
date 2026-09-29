/**
 * Menu button (§3.4): opens with Enter, Space or the arrows; items use roving focus (arrows, Home, End,
 * type-ahead); Enter or Space picks; Esc or Tab closes and focus returns to the button.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';
import { pushEscape } from '../../app/keys';
import { layerRoot, rovingIndex, typeAhead } from '../a11y';
import type { ButtonVariant } from './Button';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
  /** A small count or note at the end ("3"). */
  badge?: string;
}

export interface MenuProps {
  /** The button's accessible name (and visible text unless `icon` alone is shown). */
  label: string;
  items: MenuItem[];
  icon?: IconName;
  /** Show the label next to the icon (default: icon-only when an icon is given). */
  showLabel?: boolean;
  variant?: ButtonVariant;
  size?: 38 | 44;
  align?: 'start' | 'end';
  children?: ReactNode;
  className?: string;
}

export function Menu({ label, items, icon, showLabel = !icon, variant = 'quiet', size = 44, align = 'end', className }: MenuProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return;
    const r = button.current.getBoundingClientRect();
    const w = list.current.offsetWidth;
    const h = list.current.offsetHeight;
    const left = align === 'end' ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8);
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setPos({ left, top });
  }, [open, align, items.length]);

  useEffect(() => {
    if (open) refs.current[active]?.focus();
  }, [open, active, pos]);

  useEffect(() => {
    if (!open) return;
    return pushEscape(
      () => {
        setOpen(false);
        button.current?.focus();
        return true;
      },
      () => list.current,
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt(enabled[0] ?? 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(enabled[enabled.length - 1] ?? 0);
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const at = enabled.indexOf(active);
    const next = rovingIndex(e.key, at < 0 ? 0 : at, enabled.length, 'vertical');
    if (next !== null) {
      e.preventDefault();
      setActive(enabled[next]);
      return;
    }
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { text: now - typed.current.at < 700 ? typed.current.text + e.key : e.key, at: now };
      const hit = typeAhead(items.map((it) => it.label), typed.current.text, active);
      if (hit !== null && !items[hit].disabled) setActive(hit);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={cx('btn', `btn--${variant}`, `btn--h${size}`, !showLabel && 'btn--icon', className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={showLabel ? undefined : label}
        onClick={() => (open ? close() : openAt(enabled[0] ?? 0))}
        onKeyDown={onButtonKey}
      >
        {icon && <Icon name={icon} size={22} />}
        {showLabel && <span className="btn__label">{label}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="menu"
            aria-label={label}
            className="menu"
            style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
            onKeyDown={onListKey}
          >
            {items.map((it, i) => (
              <button
                key={it.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={i === active ? 0 : -1}
                disabled={it.disabled}
                aria-disabled={it.disabled || undefined}
                className={cx('menu__item', it.danger && 'menu__item--danger')}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
              >
                {it.icon && <Icon name={it.icon} size={20} />}
                <span className="menu__label">{it.label}</span>
                {it.badge && <span className="menu__badge">{it.badge}</span>}
              </button>
            ))}
          </div>,
          layerRoot(),
        )}
    </>
  );
}
