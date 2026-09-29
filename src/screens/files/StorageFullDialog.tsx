/**
 * Storage full (§2.16; M6 owns): "There's no more space for Amble here. Save your worlds to Drive, then
 * tidy up." [Save all my worlds] [Tidy up]. For screens that want the card rather than the banner.
 */
import { useRef } from 'react';
import { navigate } from '../../app/router';
import { t } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { SaveAllButton } from './SaveAllButton';
import './files.css';

export function StorageFullDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const tidy = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      size="sm"
      title={t('files.storageFullTitle')}
      onClose={onClose}
      initialFocus={tidy}
      actions={
        <>
          <Button
            ref={tidy}
            variant="ghost"
            onClick={() => {
              onClose();
              navigate({ name: 'settings', section: 'storage' });
            }}
          >
            {t('files.tidyUp')}
          </Button>
          <SaveAllButton variant="lantern" />
        </>
      }
    >
      <div className="files-dialog__lead files-dialog__lead--warn">
        <Icon name="warning" size={22} />
        <p className="files-dialog__text">{t('files.storageFull')}</p>
      </div>
    </Dialog>
  );
}
