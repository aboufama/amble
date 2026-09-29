/**
 * One toast (§3.4): `role=status`, 4 s (8 s for errors), sticky while it has an action. The app frame's
 * toast region shows at most two (src/state/app.ts `showToast`).
 */
import { useEffect } from 'react';
import { t } from '../../i18n';
import { toastDuration, type Toast } from '../../state/app';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';
import { Button, IconButton } from './Button';

const ICON: Record<Toast['kind'], IconName> = { info: 'info', success: 'check', error: 'warning', ai: 'sparkle' };

export function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss(id: string): void }) {
  useEffect(() => {
    const ms = toastDuration(toast);
    if (ms === null) return;
    const timer = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);
  return (
    <div className={cx('toast', `toast--${toast.kind}`)} role="status">
      <Icon name={ICON[toast.kind]} size={20} className="toast__icon" />
      <p className="toast__text">{toast.text}</p>
      {toast.action && (
        <Button
          size={38}
          variant={toast.kind === 'ai' ? 'ai' : 'ghost'}
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
