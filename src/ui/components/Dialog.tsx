/**
 * Dialog (§3.4, §2.16): the native `<dialog>` with `showModal()`, so focus is trapped and only the top
 * dialog handles Esc. Focus returns to where it was when the dialog closes. Never `alert`, `confirm` or
 * `prompt`: use this, or `askUser`/`confirmUser`/`alertUser` from src/ui/dialogs.ts.
 *
 * One look for every dialog and sheet, as in Scratch: a white card with 8 px corners on the blue scrim,
 * with a round close button.
 */
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { t } from '../../i18n';
import { notifyLayers } from '../a11y';
import { cx } from '../cx';
import { IconButton } from './Button';

/**
 * Whether a dialog's content scrolls. A scrolling region must take keyboard focus (so the arrows scroll
 * it) when it may hold nothing focusable, such as a long diff.
 */
function useScrolls(el: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const box = el.current;
    if (!active || !box || typeof ResizeObserver === 'undefined') return;
    const check = () => setScrolls(box.scrollHeight > box.clientHeight + 1);
    const sizes = new ResizeObserver(check);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(box);
      for (const child of box.children) sizes.observe(child);
      check();
    };
    const content = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watch);
    content?.observe(box, { childList: true });
    watch();
    return () => {
      sizes.disconnect();
      content?.disconnect();
    };
  }, [el, active]);
  return scrolls;
}

export type CloseReason = 'escape' | 'close' | 'backdrop';

export interface DialogProps {
  open: boolean;
  onClose(reason: CloseReason): void;
  title: ReactNode;
  /** Hide the title visually (it still names the dialog). */
  titleHidden?: boolean;
  children?: ReactNode;
  /** Buttons, right-aligned at the bottom. */
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Retired: every dialog has the same neutral look now. Accepted from older callers and ignored. */
  tone?: 'night' | 'paper';
  /** A close button in the corner (default true). */
  closeButton?: boolean;
  /** Clicking outside closes it (default false: nothing is lost by a stray click). */
  dismissOnBackdrop?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  /** For sheets: slide from the bottom or the right. */
  variant?: 'dialog' | 'sheet-bottom' | 'sheet-right';
}

export function Dialog({
  open,
  onClose,
  title,
  titleHidden,
  children,
  actions,
  size = 'md',
  closeButton = true,
  dismissOnBackdrop = false,
  initialFocus,
  className,
  variant = 'dialog',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const scrolls = useScrolls(content, open);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      notifyLayers();
      const target = initialFocus?.current ?? dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      notifyLayers();
    }
  }, [open, initialFocus]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
      notifyLayers();
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      close.current('escape');
    };
    const onClosed = () => {
      notifyLayers();
      const back = returnTo.current;
      returnTo.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClosed);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClosed);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx('dialog', `dialog--${size}`, `dialog--${variant}`, className)}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === ref.current) close.current('backdrop');
      }}
    >
      {open && (
        <div className="dialog__body">
          <div className="dialog__head">
            <h2 id={titleId} className={cx('dialog__title', titleHidden && 'sr-only')}>
              {title}
            </h2>
            {closeButton && <IconButton icon="close" label={t('common.close')} size={38} tooltip={false} className="dialog__close" onClick={() => close.current('close')} />}
          </div>
          <div
            ref={content}
            className="dialog__content"
            tabIndex={scrolls ? 0 : undefined}
            role={scrolls ? 'region' : undefined}
            aria-labelledby={scrolls ? titleId : undefined}
          >
            {children}
          </div>
          {actions && <div className="dialog__actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

export interface SheetProps extends Omit<DialogProps, 'variant' | 'size'> {
  side?: 'bottom' | 'right';
}

/** A sheet (§3.4): a modal panel from the bottom or the right. */
export function Sheet({ side = 'bottom', ...rest }: SheetProps) {
  return <Dialog {...rest} size="lg" variant={side === 'right' ? 'sheet-right' : 'sheet-bottom'} />;
}
