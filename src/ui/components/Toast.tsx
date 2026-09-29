/**
 * One toast (§3.4): `role=status`, a white card with 8 px corners. It goes by itself after 4 s (8 s for
 * errors and toasts with an action); the clock stops while the pointer is on it or focus is inside it, and
 * gives at least a couple of seconds more after. The app frame's toast region shows at most two
 * (src/state/app.ts `showToast`), and a toast goes when the student leaves its screen.
 */
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { t } from '../../i18n';
import { toastDuration, type Toast } from '../../state/app';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';
import { Button, IconButton } from './Button';

const ICON: Record<Toast['kind'], IconName> = { info: 'info', success: 'check', error: 'warning', ai: 'check' };

/** The least time a toast stays once the pointer or focus has left it. */
const AFTER_HOLD_MS = 2500;

export function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss(id: string): void }) {
  const [held, setHeld] = useState(false);
  const left = useRef<number | null>(toastDuration(toast));

  useEffect(() => {
    const ms = left.current;
    if (held || ms === null) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), ms);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(AFTER_HOLD_MS, ms - (Date.now() - started));
    };
  }, [held, toast.id, onDismiss]);

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
  };

  return (
    <div
      className={cx('toast', `toast--${toast.kind}`)}
      role="status"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={onBlur}
    >
      <Icon name={ICON[toast.kind]} size={20} className="toast__icon" />
      <p className="toast__text">{toast.text}</p>
      {toast.action && (
        <Button
          size={38}
          variant="ghost"
          onClick={() => {
            toast.action?.run();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton icon="close" label={t('common.dismiss')} size={38} tooltip={false} onClick={() => onDismiss(toast.id)} />
    </div>
  );
}
