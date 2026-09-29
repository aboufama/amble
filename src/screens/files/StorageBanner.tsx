/** The files-only banner (§2.16; M6 owns): shown when this browser won't let Amble save. FOUNDATION-STUB. */
import { t } from '../../i18n';
import { useStore } from '../../state/store';

export function StorageBanner() {
  const blocked = useStore((s) => s.library.storage === 'blocked');
  if (!blocked) return null;
  return (
    <p className="paper on-paper storage-banner" role="note">
      {t('files.storageBlocked')}
    </p>
  );
}
