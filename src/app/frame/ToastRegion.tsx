/**
 * The toast region (§2.2): bottom centre, above the Cast line in a world; at most two toasts. While a
 * modal dialog is open it renders inside that dialog (content outside a modal is inert).
 */
import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { dismissToast } from '../../state/app';
import { useStore } from '../../state/store';
import { useLayerRoot } from '../../ui/a11y';
import { ToastView } from '../../ui/components';
import { cx } from '../../ui/cx';

export function ToastRegion() {
  const toasts = useStore((s) => s.app.toasts);
  const inWorld = useStore((s) => s.app.route.name === 'world');
  const root = useLayerRoot();
  const dismiss = useCallback((id: string) => dismissToast(id), []);
  if (!root) return null;
  return createPortal(
    <div className={cx('toast-region', inWorld && 'toast-region--world')} data-testid="toasts">
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>,
    root,
  );
}
