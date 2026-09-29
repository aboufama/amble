/**
 * Promise dialogs over `<dialog>` (§3.4): `alertUser`, `confirmUser`, `askUser`. The app frame's dialog
 * layer renders them. Never `alert`, `confirm` or `prompt`.
 */
import { t } from '../i18n';
import { pushDialog, removeDialog } from '../state/app';

let counter = 0;
const nextId = () => `dlg${++counter}`;

export function alertUser(o: { title: string; body?: string; ok?: string }): Promise<void> {
  return new Promise((resolve) => {
    const id = nextId();
    pushDialog({
      id,
      kind: 'alert',
      title: o.title,
      body: o.body ?? '',
      ok: o.ok ?? t('common.ok'),
      resolve: () => {
        removeDialog(id);
        resolve();
      },
    });
  });
}

export function confirmUser(o: { title: string; body?: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId();
    pushDialog({
      id,
      kind: 'confirm',
      title: o.title,
      body: o.body ?? '',
      ok: o.ok ?? t('common.ok'),
      cancel: o.cancel ?? t('common.cancel'),
      danger: o.danger ?? false,
      resolve: (ok: boolean) => {
        removeDialog(id);
        resolve(ok);
      },
    });
  });
}

/** Resolves with the typed text, or null when cancelled. `danger` draws the OK button as destructive. */
export function askUser(o: { title: string; body?: string; label: string; value?: string; placeholder?: string; maxLength?: number; ok?: string; cancel?: string; danger?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextId();
    pushDialog({
      id,
      kind: 'ask',
      title: o.title,
      body: o.body ?? '',
      label: o.label,
      value: o.value ?? '',
      placeholder: o.placeholder ?? '',
      maxLength: o.maxLength ?? 200,
      ok: o.ok ?? t('common.ok'),
      cancel: o.cancel ?? t('common.cancel'),
      danger: o.danger ?? false,
      resolve: (value: string | null) => {
        removeDialog(id);
        resolve(value);
      },
    });
  });
}
