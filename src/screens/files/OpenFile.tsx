/** **Open a file** on the Trail and the First page (§2.4; M6 owns). FOUNDATION-STUB. */
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { showToast } from '../../state/app';
import { Button } from '../../ui/components';

export function OpenFile({ variant = 'ghost' }: { variant?: 'ghost' | 'quiet' }) {
  const { files } = useServices();
  const open = () => {
    files.openPicker({ multiple: false }).catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err), { kind: 'error' }));
  };
  return (
    <Button variant={variant} icon="fileOpen" onClick={open}>
      {t('files.openFile')}
    </Button>
  );
}
