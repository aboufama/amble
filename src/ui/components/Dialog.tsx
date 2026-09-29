/**
 * Dialog (§3.4, §2.16): the native `<dialog>` with `showModal()`, so focus is trapped and only the top
 * dialog handles Esc. Focus returns to where it was when the dialog closes. Never `alert`, `confirm` or
 * `prompt`: use this, or `askUser`/`confirmUser`/`alertUser` from src/ui/dialogs.ts.
 */
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { t } from '../../i18n';
import { cx } from '../cx';
import { IconButton } from './Button';

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
  /** 'paper' for cards that are the student's (the AI explainer, the crisis card). */
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
  tone = 'night',
  closeButton = true,
  dismissOnBackdrop = false,
  initialFocus,
  className,
  variant = 'dialog',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const target = initialFocus?.current ?? dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
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
      className={cx('dialog', `dialog--${size}`, `dialog--${tone}`, `dialog--${variant}`, tone === 'paper' && 'on-paper', className)}
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
          <div className="dialog__content">{children}</div>
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
