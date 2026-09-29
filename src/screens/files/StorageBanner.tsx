/**
 * The storage banner under the Trail's header (§2.4, §2.16; M6 owns, placed by M1):
 * - files-only mode: "This browser isn't letting Amble save here. Your work will only be kept in files
 *   you save." [Why?]
 * - out of space: "There's no more space for Amble here. Save your worlds to Drive, then tidy up."
 *   [Save all my worlds] [Tidy up]
 * Nothing shows while saving works.
 */
import { useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { Button, Dialog } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { SaveAllButton } from './SaveAllButton';
import './files.css';

export function WhyDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const ok = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      size="sm"
      title={t('files.whyTitle')}
      onClose={onClose}
      initialFocus={ok}
      actions={
        <Button ref={ok} variant="lantern" onClick={onClose}>
          {t('common.ok')}
        </Button>
      }
    >
      <p className="files-dialog__text">{t('files.whyBody')}</p>
      <p className="files-dialog__text">{t('files.whyBody2')}</p>
    </Dialog>
  );
}

export function StorageBanner() {
  const storage = useStore((s) => s.library.storage);
  const [why, setWhy] = useState(false);
  if (storage === 'ok') return null;
  if (storage === 'full') {
    return (
      <div className="paper on-paper files-banner" role="note" data-testid="storage-banner" data-storage="full">
        <Icon name="warning" size={22} />
        <p className="files-banner__text">{t('files.storageFull')}</p>
        <div className="files-banner__actions">
          <SaveAllButton variant="paper" size={38} />
          <Button variant="paper" size={38} onClick={() => navigate({ name: 'settings', section: 'storage' })}>
            {t('files.tidyUp')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="paper on-paper files-banner" role="note" data-testid="storage-banner" data-storage="blocked">
      <Icon name="lock" size={22} />
      <p className="files-banner__text">{t('files.storageBlocked')}</p>
      <div className="files-banner__actions">
        <Button variant="paper" size={38} icon="info" onClick={() => setWhy(true)}>
          {t('files.why')}
        </Button>
      </div>
      <WhyDialog open={why} onClose={() => setWhy(false)} />
    </div>
  );
}
