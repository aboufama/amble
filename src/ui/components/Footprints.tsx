/**
 * The progress indicator (§3.4): three footprints walking; under reduced motion, three dots filling.
 * `progress` (0..1) fills them in order when known; otherwise they walk.
 */
import { t } from '../../i18n';
import { Icon } from '../icons';
import { cx } from '../cx';

export function Footprints({ label = t('common.working'), progress, className }: { label?: string; progress?: number; className?: string }) {
  const filled = progress === undefined ? null : Math.round(Math.max(0, Math.min(1, progress)) * 3);
  return (
    <span className={cx('footprints', filled === null && 'footprints--walking', className)} role="img" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx('footprints__step', filled !== null && i < filled && 'footprints__step--on')} style={{ ['--i' as string]: i }}>
          <Icon name="footprint" size={16} />
          <span className="footprints__dot" />
        </span>
      ))}
    </span>
  );
}
