/**
 * "This copy is read-only (was it turned in?). Save your own copy to keep working." (§2.16; M6 owns)
 * [Save my own copy] [Not now]. The open flow and Save to Drive show the same words through the dialog
 * layer; this component is for screens that hold the state themselves.
 */
import { useRef } from 'react';
import { t } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { Icon } from '../../ui/icons';
import './files.css';

export interface ReadOnlyDialogProps {
  open: boolean;
  onSaveCopy(): void;
  onClose(): void;
}

export function ReadOnlyDialog({ open, onSaveCopy, onClose }: ReadOnlyDialogProps) {
  const save = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      size="sm"
      title={t('files.readOnlyTitle')}
      onClose={onClose}
      initialFocus={save}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('files.notNow')}
          </Button>
          <Button ref={save} variant="lantern" icon="fileSave" onClick={onSaveCopy}>
            {t('files.saveOwnCopy')}
          </Button>
        </>
      }
    >
      <div className="files-dialog__lead">
        <Icon name="lock" size={22} />
        <p className="files-dialog__text">{t('files.readOnly')}</p>
      </div>
    </Dialog>
  );
}
