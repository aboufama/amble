/** The wordmark (§3.5): "amble" in Fredoka 700 with the "l" drawn as a lamppost whose lantern glows. */
import { t } from '../../i18n';
import { Lamppost } from '../icons';
import { cx } from '../cx';

export function Wordmark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('wordmark', className)} role="img" aria-label={t('common.appName')} style={{ fontSize: size }}>
      <span aria-hidden="true">amb</span>
      <Lamppost height={Math.round(size * 1.02)} />
      <span aria-hidden="true">e</span>
    </span>
  );
}
