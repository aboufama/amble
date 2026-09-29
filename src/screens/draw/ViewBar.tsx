/**
 * The view bar under the sheet (§2.10): **− 62 % +**, **Fit**, and the **Mirror**, **Guides** and
 * **Steady** switches. Pan and zoom always have buttons here (WCAG 2.5.7), besides pinch and Ctrl+wheel.
 */
import type { DeskController, DeskState } from '../../draw/deskController';
import { t } from '../../i18n';
import { cx } from '../../ui/cx';
import { Icon } from '../../ui/icons';

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={cx('viewbar__switch', on && 'viewbar__switch--on')} onClick={() => onChange(!on)}>
      <span className="viewbar__knob" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function ViewBar({ ctrl, s }: { ctrl: DeskController; s: DeskState }) {
  return (
    <div className="viewbar" role="toolbar" aria-label={t('draw.viewLabel')}>
      <div className="viewbar__zoom">
        <button type="button" className="viewbar__icon" aria-label={t('draw.zoomOut')} onClick={() => ctrl.zoomBy(1 / 1.25)}>
          <Icon name="zoomOut" size={20} />
        </button>
        <output className="viewbar__pct" aria-live="off">
          {t('draw.zoomLevel', { n: s.zoom })}
        </output>
        <button type="button" className="viewbar__icon" aria-label={t('draw.zoomIn')} onClick={() => ctrl.zoomBy(1.25)}>
          <Icon name="zoomIn" size={20} />
        </button>
      </div>
      <button type="button" className="viewbar__btn" onClick={() => ctrl.fit()} aria-keyshortcuts="F">
        {t('draw.fit')}
      </button>
      <Switch label={t('draw.mirror')} on={s.mirror} onChange={(on) => ctrl.setMirror(on)} />
      <Switch label={t('draw.guides')} on={s.guides} onChange={(on) => ctrl.setGuides(on)} />
      <Switch label={t('draw.steady')} on={s.steady} onChange={(on) => ctrl.toggleSteady(on)} />
    </div>
  );
}
