/**
 * Waiting for the plan (§2.5, 5-20 s): **"Imagining your world…"** with footprints walking across (three
 * dots filling under reduced motion) and **Stop**. The words stay if the student stops.
 */
import { t } from '../../i18n';
import { Button, Footprints } from '../../ui/components';
import { cx } from '../../ui/cx';

export function PlanWaiting({ idea, onStop, className }: { idea: string; onStop(): void; className?: string }) {
  return (
    <div className={cx('plan-waiting', className)} role="status" aria-live="polite" data-testid="plan-waiting">
      <div className="plan-waiting__trail" aria-hidden="true">
        <Footprints />
        <Footprints />
        <Footprints />
      </div>
      <p className="plan-waiting__title">{t('home.imagining')}</p>
      {idea && <p className="plan-waiting__idea">“{idea}”</p>}
      <p className="plan-waiting__hint">{t('home.imaginingHint')}</p>
      <Button variant="ghost" icon="close" onClick={onStop} data-testid="plan-stop">
        {t('home.stop')}
      </Button>
    </div>
  );
}
