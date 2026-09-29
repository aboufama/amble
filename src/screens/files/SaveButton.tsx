/** **Save to Drive** in the world's top bar (§2.6; M6 owns, used by M2). FOUNDATION-STUB. */
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import type { World } from '../../model/types';
import { showToast } from '../../state/app';
import { Button } from '../../ui/components';

export function SaveButton({ world, compact = false }: { world: World; compact?: boolean }) {
  const { files } = useServices();
  const save = () => {
    files.saveWorld(world).catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err), { kind: 'error' }));
  };
  return (
    <Button variant="ghost" icon="fileSave" size={compact ? 38 : 44} onClick={save}>
      {t('files.saveToDrive')}
    </Button>
  );
}
