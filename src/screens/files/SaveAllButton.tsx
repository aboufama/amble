/**
 * **Save all my worlds** (§2.15, §2.16; M6 owns, used by Settings → Storage and the out-of-space card):
 * one zip with every world's `.amble`, through the save picker or a download.
 */
import { useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { showToast } from '../../state/app';
import { getState } from '../../state/store';
import { Button, type ButtonSize, type ButtonVariant } from '../../ui/components';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function SaveAllButton({ variant = 'ghost', size = 44 }: { variant?: ButtonVariant; size?: ButtonSize }) {
  const { files } = useServices();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = async () => {
    if (busyRef.current) return;
    if (!getState().library.worlds.length) {
      showToast(t('files.nothingToSave'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const n = getState().library.worlds.length;
      const out = await files.saveBlob(() => files.saveAll(), `${t('files.allWorldsName', { date: today() })}.zip`, 'zip');
      if (out) showToast(out.method === 'download' ? t('files.savedDownload') : t('files.savedAll', { n }), { kind: 'success' });
    } catch (err) {
      console.warn('Save all my worlds failed:', err);
      showToast(t('files.saveFailed'), { kind: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size={size} icon="drive" busy={busy} onClick={() => void run()} data-testid="save-all">
      {busy ? t('files.saving') : t('files.saveAllWorlds')}
    </Button>
  );
}
