/**
 * Two chips for the Trail's header (§2.4; M6 owns, placed by M1):
 * - "Space is getting low · Tidy up" past 80 % of the storage quota (opens Settings → Storage);
 * - "Amble was updated · What's new" on the first launch after an update only (opens `#/whatsnew`).
 */
import { navigate } from '../../app/router';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { Chip } from '../../ui/components';
import './files.css';

export function SpaceChip() {
  const low = useStore((s) => s.library.space?.low === true);
  if (!low) return null;
  return (
    <Chip icon="warning" className="files-chip" onClick={() => navigate({ name: 'settings', section: 'storage' })}>
      {t('files.spaceLow')}
    </Chip>
  );
}

export function UpdatedChip() {
  const updated = useStore((s) => s.library.updated);
  if (!updated) return null;
  return (
    <Chip icon="info" className="files-chip files-chip--news" onClick={() => navigate({ name: 'page', page: 'whatsnew' })}>
      {t('files.updated')}
    </Chip>
  );
}
