/**
 * **Open a file** on the Trail and the First page (§2.4; M6 owns). The open picker (Drive is in it on
 * ChromeOS), or a plain file input where the picker is blocked; then the open flow: checks, dialogs, a
 * new world, and there it opens.
 */
import { useRef, useState } from 'react';
import { openFromPicker } from '../../files/open';
import { t } from '../../i18n';
import { Button, type ButtonSize } from '../../ui/components';
import './files.css';

export interface OpenFileProps {
  variant?: 'ghost' | 'quiet';
  size?: ButtonSize;
  /** Pick several files at once (they all open; the Trail shows them). */
  multiple?: boolean;
  className?: string;
}

export function OpenFile({ variant = 'ghost', size = 44, multiple = false, className }: OpenFileProps) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const open = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await openFromPicker({ multiple });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size={size} icon="fileOpen" busy={busy} className={className} onClick={() => void open()} data-testid="open-file">
      {t('files.openFile')}
    </Button>
  );
}
