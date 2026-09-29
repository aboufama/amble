/**
 * "This world is 42 MB, which is big for a Chromebook. Amble will still open it." (§2.16; M6 owns). The
 * open flow shows the same words through the dialog layer; this component is for screens that hold the
 * state themselves (the Teacher desk's gallery).
 */
import { useRef } from 'react';
import { t } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { Icon } from '../../ui/icons';
import './files.css';

export interface BigFileDialogProps {
  open: boolean;
  megabytes: number;
  onClose(): void;
}

export function BigFileDialog({ open, megabytes, onClose }: BigFileDialogProps) {
  const ok = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      size="sm"
      title={t('files.bigFileTitle')}
      onClose={onClose}
      initialFocus={ok}
      actions={
        <Button ref={ok} variant="lantern" onClick={onClose}>
          {t('common.ok')}
        </Button>
      }
    >
      <div className="files-dialog__lead">
        <Icon name="info" size={22} />
        <p className="files-dialog__text">{t('files.bigFile', { mb: megabytes })}</p>
      </div>
    </Dialog>
  );
}
